#!/usr/bin/env node
/**
 * 매거진 자동 레인 잠금 — **실제 다중 프로세스** 경합 검사 (2026-10-09 Codex 재검토 P1).
 *
 *   앞판 `acquireLock` 은 readLock → 판정 → 일반 writeFileSync 였다. 두 프로세스가 동시에 "없다" 를 보면
 *   둘 다 쓰고 둘 다 진입했다. 이제 생성은 `wx`, 잠금마다 owner token, 해제·회수는 token·원문 대조다.
 *
 *   실제 자식 프로세스 2개가 barrier 파일을 기다렸다가 동시에 출발한다. 판정과 생성 사이를
 *   `SORAN_LOCK_RACE_PAUSE_MS`(시험 모드 전용)로 벌려 **둘 다 "없다" 를 본 뒤** 생성을 다투게 한다 —
 *   운에 맡기지 않고 경합을 매번 재현한다.
 *
 * 🔴 운영 경로에 닿지 않는다 — 잠금은 전부 임시 폴더 · HOME 도 임시 폴더.
 *
 * 사용: node scripts/magazine-auto-lock-race-check.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'auto-lock-race-')))
process.env.HOME = T
process.on('exit', () => fs.rmSync(T, { recursive: true, force: true }))
const LIB = path.join(HERE, 'lib', 'magazine-auto-lock.mjs')
const L = await import(pathToFileURL(LIB).href)

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) pass++
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const finish = () => console.log(`\n${fail ? '🔴' : '✅'} 잠금 다중 프로세스 검사 ${pass}/${pass + fail}\n`)
process.on('uncaughtException', (e) => { fail++; console.log(`  ❌ 예외로 중단 — ${e?.message ?? e}`); finish(); process.exit(1) })
process.on('unhandledRejection', (e) => { fail++; console.log(`  ❌ 예외로 중단 — ${e?.message ?? e}`); finish(); process.exit(1) })

/** 자식 — barrier 를 기다렸다 잠금을 잡고, 잡았으면 임계구역에서 다른 진입자가 있는지 본다 */
const CHILD = path.join(T, 'child.mjs')
fs.writeFileSync(CHILD, `
import fs from 'node:fs'
const L = await import(${JSON.stringify(pathToFileURL(LIB).href)})
const { LOCK, BARRIER, READY, OUT, CS } = process.env
fs.writeFileSync(READY, String(process.pid))
const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const until = Date.now() + 20000
while (!fs.existsSync(BARRIER)) { if (Date.now() > until) { fs.writeFileSync(OUT, JSON.stringify({ error: 'barrier timeout' })); process.exit(2) } nap(1) }
const r = L.acquireLock({ path: LOCK, label: 'race' })
let overlap = false
if (r.ok) {
  fs.appendFileSync(CS, 'in\\n')
  nap(300)
  const lines = fs.readFileSync(CS, 'utf8').trim().split('\\n')
  overlap = lines.filter((x) => x === 'in').length - lines.filter((x) => x === 'out').length > 1
  fs.appendFileSync(CS, 'out\\n')
  r.release()
}
fs.writeFileSync(OUT, JSON.stringify({ ok: r.ok, code: r.code, takeover: r.takeover ?? false, overlap }))
`)

async function race(round, { pauseMs = 200, seed = null } = {}) {
  const dir = path.join(T, `round-${round}`)
  fs.mkdirSync(dir)
  const env = (i) => ({ ...process.env, HOME: T, SORAN_MAGAZINE_TEST_MODE: '1', SORAN_LOCK_RACE_PAUSE_MS: String(pauseMs),
    LOCK: path.join(dir, '.auto-merge.lock'), BARRIER: path.join(dir, 'go'), READY: path.join(dir, `ready-${i}`),
    OUT: path.join(dir, `out-${i}.json`), CS: path.join(dir, 'cs.log') })
  if (seed) fs.writeFileSync(path.join(dir, '.auto-merge.lock'), seed)
  const kids = [0, 1].map((i) => spawn(process.execPath, [CHILD], { env: env(i), stdio: 'ignore' }))
  const exits = kids.map((k) => new Promise((res) => k.on('exit', (code) => res(code))))
  const t0 = Date.now()
  while (![0, 1].every((i) => fs.existsSync(path.join(dir, `ready-${i}`)))) {
    if (Date.now() - t0 > 20000) throw new Error('자식이 준비되지 않았다')
    await new Promise((r) => setTimeout(r, 5))
  }
  fs.writeFileSync(path.join(dir, 'go'), '1')
  await Promise.all(exits)
  const outs = [0, 1].map((i) => { try { return JSON.parse(fs.readFileSync(path.join(dir, `out-${i}.json`), 'utf8')) } catch (e) { return { ok: null, code: `CHILD_NO_RESULT: ${e.message}` } } })
  const cs = fs.existsSync(path.join(dir, 'cs.log')) ? fs.readFileSync(path.join(dir, 'cs.log'), 'utf8').trim().split('\n') : []
  return { outs, cs, lockLeft: fs.existsSync(path.join(dir, '.auto-merge.lock')), reclaimLeft: fs.existsSync(path.join(dir, '.auto-merge.lock.reclaim')) }
}

// ── ① 빈 자리에서 동시에 출발 — 정확히 1개만 진입 ─────────────
console.log('\n① 실제 자식 2개 · barrier 뒤 동시 출발 · 판정과 생성 사이 200ms — 정확히 1개만 진입')
for (let i = 1; i <= 5; i++) {
  const r = await race(i)
  const winners = r.outs.filter((o) => o.ok)
  const losers = r.outs.filter((o) => !o.ok)
  check(`① ${i}회차 — 진입 1 · 패자 1 (LOCK_HELD)`, winners.length === 1 && losers.length === 1 && losers[0].code === 'LOCK_HELD', JSON.stringify(r.outs))
  check(`① ${i}회차 — 임계구역 동시 진입 0 · 들어간 기록 1`, !r.outs.some((o) => o.overlap) && r.cs.filter((x) => x === 'in').length === 1, r.cs.join(','))
  check(`① ${i}회차 — 승자가 끝난 뒤 잠금 잔여 0`, !r.lockLeft && !r.reclaimLeft)
}

// ── ② 죽은 잠금을 둘이 동시에 회수 — 정확히 1개만 ─────────────
console.log('\n② 죽은 잠금(주인 없음)을 자식 2개가 동시에 회수 — 회수 소유권 아래 재대조 · 정확히 1개만 진입')
for (let i = 1; i <= 3; i++) {
  const dead = JSON.stringify({ pid: 2 ** 22 + 12345, startedAt: Date.now() - 10 * 60 * 1000, label: 'dead', token: 'tok-dead' })
  const r = await race(`dead-${i}`, { seed: dead })
  const winners = r.outs.filter((o) => o.ok)
  check(`② ${i}회차 — 회수 뒤 진입 1 · 패자는 막힌다 (LOCK_HELD · LOCK_RECLAIM_BUSY)`,
    winners.length === 1 && winners[0].takeover === true && r.outs.filter((o) => !o.ok).every((o) => ['LOCK_HELD', 'LOCK_RECLAIM_BUSY'].includes(o.code)),
    JSON.stringify(r.outs))
  check(`② ${i}회차 — 임계구역 동시 진입 0 · 잠금·회수 잔여 0`, !r.outs.some((o) => o.overlap) && !r.lockLeft && !r.reclaimLeft, `${r.cs.join(',')} · lock ${r.lockLeft} · reclaim ${r.reclaimLeft}`)
}

// ── ②-b 회수 직전 잠금이 바뀐다 — 재대조가 막아야 한다 (결정적) ─────
console.log('\n②-b 죽은 잠금을 본 뒤 회수 직전에 살아 있는 잠금으로 바뀜 — 재대조로 손대지 않는다')
{
  const dir = path.join(T, 'swap')
  fs.mkdirSync(dir)
  const lock = path.join(dir, '.auto-merge.lock')
  fs.writeFileSync(lock, JSON.stringify({ pid: 2 ** 22 + 4321, startedAt: Date.now() - 10 * 60 * 1000, label: 'dead', token: 'tok-dead' }))
  const env = { ...process.env, HOME: T, SORAN_MAGAZINE_TEST_MODE: '1', SORAN_LOCK_RACE_PAUSE_MS: '600',
    LOCK: lock, BARRIER: path.join(dir, 'go'), READY: path.join(dir, 'ready'), OUT: path.join(dir, 'out.json'), CS: path.join(dir, 'cs.log') }
  const kid = spawn(process.execPath, [CHILD], { env, stdio: 'ignore' })
  const exited = new Promise((res) => kid.on('exit', res))
  while (!fs.existsSync(env.READY)) await new Promise((r) => setTimeout(r, 5))
  fs.writeFileSync(env.BARRIER, '1')
  await new Promise((r) => setTimeout(r, 250)) // 자식은 "죽은 잠금" 판정 뒤 600ms 멈춰 있다
  const LIVE = JSON.stringify({ pid: process.pid, startedAt: Date.now(), label: 'live', token: 'tok-live' })
  fs.writeFileSync(lock, LIVE)
  await exited
  let out
  try { out = JSON.parse(fs.readFileSync(env.OUT, 'utf8')) } catch (e) { out = { ok: null, code: `CHILD_NO_RESULT: ${e.message}` } }
  check('②-b 회수 직전에 바뀐 살아 있는 잠금 → 진입 0 · LOCK_HELD', out.ok === false && out.code === 'LOCK_HELD', JSON.stringify(out))
  check('②-b 살아 있는 잠금을 지우지 않는다 · 회수 잔여 0', fs.existsSync(lock) && fs.readFileSync(lock, 'utf8') === LIVE && !fs.existsSync(`${lock}.reclaim`))
}

// ── ③ owner token — 남의 잠금은 풀지 못한다 ───────────────────
console.log('\n③ owner token — 같은 pid 라도 다른 token 의 잠금은 지우지 못한다')
{
  const p = path.join(T, 'token.lock')
  const a = L.acquireLock({ path: p, label: 'mine' })
  const mine = JSON.parse(fs.readFileSync(p, 'utf8'))
  check('③ 잠금에 추측 불가능한 owner token 이 있다', a.ok && typeof mine.token === 'string' && mine.token.length >= 32 && mine.token === a.token, JSON.stringify(mine))
  const b = L.acquireLock({ path: path.join(T, 'token2.lock'), label: 'mine' })
  check('③ 잠금마다 token 이 다르다', b.ok && b.token !== a.token)
  b.release()
  // 내 잠금이 사라지고 같은 pid 의 다른 잠금(다른 token)이 그 자리를 차지했다
  fs.writeFileSync(p, `${JSON.stringify({ ...mine, token: 'someone-else-token' })}\n`)
  a.release()
  check('③ 같은 pid · 다른 token 의 잠금 → release 가 지우지 않는다', fs.existsSync(p) && JSON.parse(fs.readFileSync(p, 'utf8')).token === 'someone-else-token')
  check('③ releaseIfMine — token 이 다르면 NOT_MINE · 같으면 RELEASED', L.releaseIfMine(p, 'x') === 'NOT_MINE' && L.releaseIfMine(p, 'someone-else-token') === 'RELEASED' && !fs.existsSync(p))
  check('③ 이미 없으면 ABSENT', L.releaseIfMine(p, 'x') === 'ABSENT')
}

// ── ④ fail-closed 유지 · 기존 계약 ────────────────────────────
console.log('\n④ fail-closed 유지 — 살아 있는 주인 · 손상 · LOCK_STUCK · 회수 중 · 기존 producer/auto-register 계약')
{
  const p = path.join(T, 'fc.lock')
  fs.writeFileSync(p, JSON.stringify({ pid: process.pid, startedAt: Date.now(), label: 'live', token: 't' }))
  check('④ 살아 있는 주인 → LOCK_HELD · 파일 그대로', L.acquireLock({ path: p }).code === 'LOCK_HELD' && fs.existsSync(p))
  fs.writeFileSync(p, JSON.stringify({ pid: process.pid, startedAt: Date.now() - L.STALE_AFTER_MS - 1000, label: 'stuck', token: 't' }))
  check('④ 살아 있는데 오래됨 → LOCK_STUCK · 뺏지 않는다', L.acquireLock({ path: p }).code === 'LOCK_STUCK' && fs.existsSync(p))
  fs.writeFileSync(p, '{ 깨진')
  check('④ 손상 → LOCK_CORRUPT · 지우지 않는다', L.acquireLock({ path: p }).code === 'LOCK_CORRUPT' && fs.readFileSync(p, 'utf8') === '{ 깨진')
  fs.writeFileSync(p, JSON.stringify({ pid: 2 ** 22 + 999, startedAt: Date.now() - 60000, label: 'dead', token: 'td' }))
  fs.writeFileSync(`${p}.reclaim`, JSON.stringify({ pid: process.pid, startedAt: Date.now(), token: 'r' }))
  const busy = L.acquireLock({ path: p })
  check('④ 다른 회차가 회수 중 → LOCK_RECLAIM_BUSY · 죽은 잠금도 그대로', busy.code === 'LOCK_RECLAIM_BUSY' && JSON.parse(fs.readFileSync(p, 'utf8')).token === 'td', busy.code)
  fs.rmSync(`${p}.reclaim`, { force: true })
  const take = L.acquireLock({ path: p })
  check('④ 회수 소유권이 비면 죽은 잠금을 회수하고 진입 (takeover · 새 token)', take.ok && take.takeover === true && JSON.parse(fs.readFileSync(p, 'utf8')).token === take.token && !fs.existsSync(`${p}.reclaim`))
  take.release()
  check('④ 기존 소비자 계약 — readLock 이 pid·startedAt 을 그대로 준다 (등록 실행기가 producer 잠금을 읽는다)', (() => {
    const q = path.join(T, 'prod.lock'); const h = L.acquireLock({ path: q, label: 'producer' }); const r = L.readLock(q); h.release()
    return Number.isInteger(r.pid) && Number.isFinite(r.startedAt) && r.label === 'producer'
  })())
  check('④ 기존 판정 함수 judgeLock 은 그대로 (FREE · LOCK_HELD · LOCK_STALE · LOCK_CORRUPT)',
    L.judgeLock({ existing: null, now: 1, pidAlive: () => true }).code === 'FREE'
    && L.judgeLock({ existing: { pid: 1, startedAt: 0 }, now: 1, pidAlive: () => true }).code === 'LOCK_HELD'
    && L.judgeLock({ existing: { pid: 1, startedAt: 0 }, now: 1, pidAlive: () => false }).code === 'LOCK_STALE'
    && L.judgeLock({ existing: {}, now: 1, pidAlive: () => false }).code === 'LOCK_CORRUPT')
}

finish()
process.exitCode = fail ? 1 : 0
