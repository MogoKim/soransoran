#!/usr/bin/env node
/**
 * CTA 수리 write ↔ auto-register write 직렬화 — 같은 전역 잠금 (2026-10-29 Codex P1).
 *
 * 🔴 auto-register 가 pending:false 를 본 직후 CTA 수리가 시작되면, 옛 원고로 변환한 것을 등록하거나 rollback 이
 *    새 원고를 되돌릴 수 있었다. CTA 수리 write 는 이제 auto-register 회차와 **같은 파일**
 *    (`<drafts>/_runs/.auto-register.lock`)을 먼저 잡고, 그다음 원고 lease 를 잡는다(해제는 역순).
 *
 * 🔴 실제 다중 프로세스다 — 잠금을 쥔 자식 · 멈춘 수리 자식 · 실제 auto-register write 진입(`magazine-auto-register-ready.mjs --write`).
 *    모든 경로는 임시 루트다(시험 모드 · 임시 HOME). 운영 잠금 · 장부 경로에 닿지 않는다(L05 가 경로를 확인한다).
 *
 * 반례
 *   L01 다른 프로세스가 전역 잠금(+ 원고 lease)을 쥔다 → 수리 write LOCK_HELD · 원고 lease · 조각 · 원고 · 영수증 · 장부 0 ·
 *       미리보기는 잠금과 무관하게 같은 결과 · 잠금 바이트 불변
 *   L02 수리가 전역 잠금을 쥔 채 commit 직전 멈춤 → 실제 auto-register write 진입이 LOCK_HELD · 후보 처리 · 변환 · 등록 0
 *   L03 수리 완료 · 두 잠금 해제 → auto-register 가 잠금을 잡고 진입 · drive 는 새 원고만 읽는다
 *   L04 두 잠금을 쥔 수리 자식 SIGKILL → 실제 auto-register 가 죽은 잠금을 회수(LOCK_STALE)하고 조각은 건드리지 않는다 ·
 *       다음 수리 --write 가 transaction 을 복구해 끝낸다 · 잠금 0
 *   L05 잠금 자리 = 그 저장소 auto-register 의 LOCK_PATH · 시험 자리는 임시 루트 밖으로 나가지 않는다
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { makeRoot, runCases } from './magazine-direct-topic-forbidden-check.mjs'
import { repairWorld } from './magazine-draft-cta-repair-check.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SLUG = 'dtf-direct-01'
const NOW = Date.parse('2026-10-28T21:00:00+09:00')

const envOf = (w) => ({ ...process.env, SORAN_MAGAZINE_TEST_MODE: '1', HOME: join(w.root, 'home') })
const lockPathOf = (w) => w.lib.ctaRepairGlobalLockPath(w.draftsDir)
const leaseFiles = (w) => {
  const d = dirname(w.quarantinePath)
  return readdirSync(d).filter((f) => f !== 'quarantine.json' && !f.includes('.')).flatMap((sub) => readdirSync(join(d, sub)).map((f) => join(sub, f)))
}
const fragmentsOf = (w) => readdirSync(dirname(w.draftPath)).filter((f) => f.includes('cta-repair')).sort()
const receiptsOf = (w) => { const d = join(w.draftsDir, '_runs', '2026-10-28'); return existsSync(d) ? readdirSync(d).filter((f) => f.startsWith('draft-cta-repair-')) : [] }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 자식이 한 줄을 찍을 때까지 기다린다 — 준비 신호 */
function readyLine(child, ms = 30000) {
  return new Promise((res, rej) => {
    let buf = ''
    const t = setTimeout(() => rej(new Error(`자식 준비 신호 없음: ${buf}`)), ms)
    child.stdout.on('data', (d) => { buf += d; const i = buf.indexOf('\n'); if (i >= 0) { clearTimeout(t); res(buf.slice(0, i)) } })
    child.on('exit', (c, s) => { clearTimeout(t); rej(new Error(`자식이 먼저 끝났다 (${c ?? s}): ${buf}`)) })
  })
}
const exited = (child) => new Promise((r) => (child.exitCode !== null || child.signalCode ? r({ code: child.exitCode, signal: child.signalCode }) : child.once('exit', (code, signal) => r({ code, signal }))))

/** 살아 있는 다른 프로세스가 잠금을 쥔다 — `withLease` 면 같은 slug 의 원고 lease 도 */
function spawnHolder(w, { withLease = false } = {}) {
  const src = `
const L = await import(${JSON.stringify(pathToFileURL(join(w.root, 'scripts/lib/magazine-auto-lock.mjs')).href)})
const Q = await import(${JSON.stringify(pathToFileURL(join(w.root, 'scripts/lib/magazine-quarantine.mjs')).href)})
const g = L.acquireLock({ path: ${JSON.stringify(lockPathOf(w))}, label: 'holder' })
const l = ${withLease} ? Q.acquireManuscriptLease({ slug: ${JSON.stringify(SLUG)}, work: 'holder', path: ${JSON.stringify(w.quarantinePath)} }) : { ok: true }
console.log(JSON.stringify({ global: g.ok, lease: l.ok }))
setInterval(() => {}, 1000)`
  return spawn(process.execPath, ['--input-type=module', '-e', src], { env: envOf(w), stdio: ['ignore', 'pipe', 'inherit'] })
}

/** 실제 수리 자식 — `pauseAt` 단계에서 go 파일이 생길 때까지 멈춘다 · `killAt` 단계에서 SIGKILL */
function spawnRepair(w, { pauseAt = null, killAt = null, go = join(w.root, 'go') } = {}) {
  const argsPath = join(w.root, `repair-args-${Math.random().toString(16).slice(2)}.json`)
  writeFileSync(argsPath, JSON.stringify(w.args))
  const src = `
import { existsSync, readFileSync } from 'node:fs'
const { repairDraftCta } = await import(${JSON.stringify(pathToFileURL(join(w.root, 'scripts/lib/magazine-draft-cta-repair.mjs')).href)})
const args = JSON.parse(readFileSync(${JSON.stringify(argsPath)}, 'utf8'))
const wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const r = repairDraftCta({ ...args, write: true, hooks: { fault: (s) => {
  if (s === ${JSON.stringify(pauseAt)}) { console.log('PAUSED ' + s); for (let i = 0; i < 1200 && !existsSync(${JSON.stringify(go)}); i++) wait(50) }
  if (s === ${JSON.stringify(killAt)}) { console.log('KILL ' + s); process.kill(process.pid, 'SIGKILL'); wait(10000) }
} } })
console.log(JSON.stringify(r))`
  return spawn(process.execPath, ['--input-type=module', '-e', src], { env: envOf(w), stdio: ['ignore', 'pipe', 'inherit'] })
}

/** 실제 auto-register write 진입 — 그 루트 사본의 CLI(그 루트의 LOCK_PATH · 시험 모드) */
function runAutoRegister(w) {
  const r = spawnSync(process.execPath, [join(w.root, 'scripts/magazine-auto-register-ready.mjs'), '--write', '--json'],
    { env: envOf(w), encoding: 'utf8', cwd: w.root, timeout: 120000 })
  let report = null
  try { report = JSON.parse(r.stdout) } catch { report = null }
  return { status: r.status, report, stderr: r.stderr }
}

const world = async (root) => {
  const w = await repairWorld(realpathSync(root()))
  const ledger = () => readFileSync(w.quarantinePath, 'utf8')
  return { ...w, ledger }
}

export function lockCases({ root = () => makeRoot() } = {}) {
  return [
    ['L01 다른 프로세스가 전역 잠금(+ 원고 lease)을 쥔다 → 수리 write LOCK_HELD · lease · 조각 · 원고 · 영수증 · 장부 0 · 미리보기는 같은 결과 · 잠금 불변', async () => {
      for (const withLease of [false, true]) {
        const w = await world(root)
        const pv0 = w.lib.repairDraftCta(w.args)
        const holder = spawnHolder(w, { withLease })
        try {
          assert.deepEqual(JSON.parse(await readyLine(holder)), { global: true, lease: true })
          const lockBytes = readFileSync(lockPathOf(w), 'utf8'); const leases = leaseFiles(w); const ledger = w.ledger()
          const r = w.lib.repairDraftCta({ ...w.args, write: true })
          // 🔴 원고 lease 도 막혀 있을 때도 전역 잠금 코드다 — 잠금 순서가 전역 → lease 라는 증거
          assert.equal(r.code, 'LOCK_HELD', `withLease=${withLease}: ${r.code} ${r.why}`)
          assert.deepEqual(leaseFiles(w), leases, '원고 lease 를 잡았거나 남겼다')
          assert.deepEqual(fragmentsOf(w), []); assert.equal(readFileSync(w.draftPath, 'utf8'), w.oldBytes); assert.deepEqual(receiptsOf(w), [])
          assert.equal(w.ledger(), ledger); assert.equal(readFileSync(lockPathOf(w), 'utf8'), lockBytes, '남의 전역 잠금을 바꿨다')
          const pv = w.lib.repairDraftCta(w.args)
          assert.deepEqual(pv, pv0, '잠금이 있을 때 미리보기 결과가 달라졌다'); assert.equal(readFileSync(lockPathOf(w), 'utf8'), lockBytes)
        } finally { holder.kill('SIGKILL'); await exited(holder) }
      }
      // 미리보기는 잠금을 만들지 않는다
      const w = await world(root)
      w.lib.repairDraftCta(w.args)
      assert.equal(existsSync(lockPathOf(w)), false, '미리보기가 전역 잠금을 만들었다')
    }],
    ['L02 수리가 전역 잠금을 쥔 채 commit 직전 멈춤 → 실제 auto-register write 진입 LOCK_HELD · 후보 처리 · 변환 · 등록 0 → 수리 재개 · 완료 · 두 잠금 해제', async () => {
      const w = await world(root)
      const child = spawnRepair(w, { pauseAt: 'journal:open' })
      try {
        assert.equal(await readyLine(child), 'PAUSED journal:open')
        assert.equal(existsSync(lockPathOf(w)), true, '수리가 전역 잠금을 쥐지 않았다')
        assert.equal(leaseFiles(w).length, 1, '수리가 원고 lease 를 쥐지 않았다')
        const ar = runAutoRegister(w)
        assert.equal(ar.status, 1, ar.stderr.slice(0, 300)); assert.equal(ar.report?.lock?.code, 'LOCK_HELD', JSON.stringify(ar.report?.lock))
        assert.equal(ar.report.processed, undefined, 'auto-register 가 후보 처리에 들어갔다')
        assert.equal(existsSync(join(dirname(w.draftPath), 'article-draft.ts')), false, '변환물을 만들었다')
        assert.equal(readFileSync(w.draftPath, 'utf8'), w.oldBytes)
        writeFileSync(join(w.root, 'go'), '')
        const out = await new Promise((res) => { let b = ''; child.stdout.on('data', (d) => { b += d }); child.on('exit', () => res(b)) })
        const r = JSON.parse(out.trim().split('\n').pop())
        assert.equal(r.ok, true, `${r.code} ${r.why}`); assert.equal(r.written, true)
      } finally { if (child.exitCode === null) child.kill('SIGKILL'); await exited(child) }
      assert.equal(existsSync(lockPathOf(w)), false, '전역 잠금이 남았다'); assert.deepEqual(leaseFiles(w), [], '원고 lease 가 남았다')
      assert.deepEqual(fragmentsOf(w), [])
    }],
    ['L03 수리 완료 · 두 잠금 해제 뒤 → 실제 auto-register 가 잠금을 잡고 진입 · drive 는 새 원고만 읽는다', async () => {
      const w = await world(root)
      const r = w.lib.repairDraftCta({ ...w.args, write: true }); assert.equal(r.ok, true, r.why)
      assert.equal(existsSync(lockPathOf(w)), false)
      const ar = runAutoRegister(w)
      assert.equal(ar.report?.lock?.ok, true, `잠금을 잡지 못했다 ${JSON.stringify(ar.report?.lock)}`)
      assert.equal(existsSync(lockPathOf(w)), false, 'auto-register 가 잠금을 풀지 않았다')
      // drive — 큐 · 변환 단계가 보는 원고가 새 원고다 (변환 호출 순간의 draft.md 해시를 센다)
      const seen = []
      const autoReg = await import(pathToFileURL(join(w.root, 'scripts/magazine-auto-register.mjs')).href)
      const item = w.args.queue.find((q) => q.slug === SLUG)
      const d = autoReg.drive(SLUG, { write: false, publishAt: '2026-10-30', autoLane: true }, {
        draftsDir: w.draftsDir, quarantinePath: w.quarantinePath, queueItem: item, loadQueue: () => w.args.queue,
        run: () => { seen.push(w.src.draftHashOf(readFileSync(w.draftPath))); return { code: 1, stdout: '', stderr: '' } },
        heroFilePath: () => join(w.root, 'hero.webp'), progress: () => ({ hasDraftMd: true }), now: NOW })
      assert.equal(d.blockedBy.some((x) => String(x.code).startsWith('CTA_REPAIR')), false, JSON.stringify(d.blockedBy))
      assert.ok(d.steps.some((s) => s.stage === 'gate' && s.status === 'ok'), JSON.stringify(d.blockedBy))
      assert.ok(seen.length > 0, 'drive 가 하위 단계에 닿지 않았다 — 반례 준비 실패')
      assert.deepEqual([...new Set(seen)], [r.newDraftHash], 'drive 가 새 원고가 아닌 바이트를 읽었다')
    }],
    ['L04 두 잠금을 쥔 수리 자식 SIGKILL → auto-register 가 죽은 잠금 회수(LOCK_STALE) · 조각 불변 → 다음 수리 --write 가 복구 · 완료 · 잠금 0', async () => {
      const w = await world(root)
      const child = spawnRepair(w, { killAt: 'detached' })
      await readyLine(child)
      const ex = await exited(child)
      assert.equal(ex.signal, 'SIGKILL')
      assert.equal(existsSync(lockPathOf(w)), true, '죽은 수리의 전역 잠금이 없다 — 반례 준비 실패')
      assert.equal(existsSync(w.draftPath), false, '떼어 낸 뒤인데 canonical 이 있다')
      const frag = fragmentsOf(w)
      const fragBytes = frag.map((f) => readFileSync(join(dirname(w.draftPath), f), 'base64'))
      const ar = runAutoRegister(w)
      assert.equal(ar.report?.lock?.ok, true, JSON.stringify(ar.report?.lock)); assert.equal(ar.report.lock.code, 'LOCK_STALE')
      assert.equal(existsSync(lockPathOf(w)), false)
      assert.deepEqual(fragmentsOf(w), frag, 'auto-register 가 수리 조각을 바꿨다')
      assert.deepEqual(frag.map((f) => readFileSync(join(dirname(w.draftPath), f), 'base64')), fragBytes)
      const r = w.lib.repairDraftCta({ ...w.args, write: true })
      assert.equal(r.ok, true, `${r.code} ${r.why}`); assert.equal(r.recovered, 'RESTORED_OLD'); assert.equal(r.written, true)
      assert.deepEqual(fragmentsOf(w), []); assert.equal(existsSync(lockPathOf(w)), false); assert.deepEqual(leaseFiles(w), [])
      // 수리 자식이 남긴 죽은 전역 잠금을 수리 쪽이 먼저 만나도 같은 stale 계약으로 회수한다
      const w2 = await world(root)
      const c2 = spawnRepair(w2, { killAt: 'journal:written' }); await readyLine(c2); await exited(c2)
      assert.equal(existsSync(lockPathOf(w2)), true)
      const r2 = w2.lib.repairDraftCta({ ...w2.args, write: true })
      assert.equal(r2.ok, true, `${r2.code} ${r2.why}`); assert.equal(r2.recovered, 'RESTORED_OLD')
      assert.equal(existsSync(lockPathOf(w2)), false)
    }],
    ['L05 잠금 자리 = 그 저장소 auto-register 의 LOCK_PATH · 시험 자리는 임시 루트 안', async () => {
      const lib = await import(pathToFileURL(join(HERE, 'lib/magazine-draft-cta-repair.mjs')).href)
      const L = await import(pathToFileURL(join(HERE, 'lib/magazine-auto-lock.mjs')).href)
      const D = await import(pathToFileURL(join(HERE, 'lib/magazine-load.mjs')).href)
      assert.equal(lib.ctaRepairGlobalLockPath(D.DRAFTS_DIR), L.LOCK_PATH, 'CTA 수리 잠금이 auto-register 잠금과 다른 파일이다')
      const w = await world(root)
      assert.ok(lockPathOf(w).startsWith(`${w.root}/`), `시험 잠금이 임시 루트 밖이다: ${lockPathOf(w)}`)
      assert.notEqual(lockPathOf(w), L.LOCK_PATH)
    }],
  ]
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const r = await runCases(lockCases())
  console.log(`\nCTA 수리 ↔ auto-register 전역 잠금 검사: ${r.pass} pass, ${r.fail} fail`)
  if (r.fail) process.exitCode = 1
  await sleep(0)
}
