#!/usr/bin/env node
/**
 * 원고 CTA 앞 문장 무전송 수리 검사 (2026-10-28 · age-learning "밤 이야기").
 *
 * 🔴 운영 모양을 임시 루트에 만든다 — source/2 승인 · spec/1 · 정본 큐 행 · 회수된 원고(옛 고정 CTA 문장) · article-draft.ts 없음.
 *    실제 `repairDraftCta`(lib)와 실제 CLI 를 태운다. 장부 · lease 는 임시 경로다. ChatGPT · Chrome · CDP · 네트워크 0.
 *
 * 반례
 *   R01 미리보기 — 쓰기 0 (원고 · 영수증 · lease)
 *   R02 쓰기 — CTA 셋째 칸만 바뀐다 (다른 줄 · 줄바꿈 · href · label 바이트 그대로) · 영수증 필드
 *   R03 옛 원고 해시 불일치 · R04 옛 문장 불일치 · R05 CTA 0개 · 2개 · R06 href·label 을 바꾸려는 새 문장
 *   R07 등록 영수증 · R08 미정산 전송 예약 · R09 article-draft.ts 존재 → 쓰기 0
 *   R10 lease 상실(떼어 내기 직전 · 설치 직전) · R11 단계별 경쟁 writer → 남의 바이트 보존 · 덮지도 되돌리지도 않는다
 *   R12 영수증 충돌 · 영수증 자리 경쟁 · 영수증 쓰기 실패 → 다음 실행이 완성 · R13 같은 수리 재실행 멱등 · 조각 없는 정상 수리
 *   R14 큐 · source 가 정본이 아니다 · R15 실제 CLI — 미리보기 기본 · --write · 사용법 · 전송 경로 import 0
 *   R16 실제 fs 경쟁 — 원고를 k 번째로 읽은 직후 외부 writer 가 쓴다(코드 무변경 · fs 감싸기). 모든 k 에서 외부 바이트 보존
 *   R17 실제 자식 프로세스 SIGKILL — journal 뒤 · 떼어 낸 뒤 · 설치 뒤 영수증 전 · 영수증 뒤 정리 전 → 다음 실행 자동 복구
 *   R18 조각 open · write · fsync · 설치 link 실패 · 옛 원고 복구 실패 → 옛 원고 그대로 또는 RECOVERY_REQUIRED(조각 보존)
 *   R19 복구할 수 없는 상태 — canonical 외부 바이트 · journal 없는 조각 · 변조 journal · 변조 owned → 아무것도 지우지 않는다
 *   R20 영수증 검증(P2) — exact schema · 필드 집합 · 해시 · 문장 · CTA 행 · href · label · 사람 승인자 · KST · 자리
 *   R21 미리보기는 남은 transaction 을 알리기만 한다 — 쓰기 0
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs, { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { directWorld, makeRoot, runCases } from './magazine-direct-topic-forbidden-check.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const LIB = 'scripts/lib/magazine-draft-cta-repair.mjs'
const SLUG = 'dtf-direct-01'
const OLD = '지금 떠오른 밤 이야기 한 조각을 남겨 주세요'
const NEW = '요즘 새로 배우고 싶은 것이 있다면, 그 이유와 함께 편하게 이야기해 주세요.'
const AT = '2026-10-28T20:00:00+09:00'
const NOW = Date.parse('2026-10-28T21:00:00+09:00')

/**
 * 수리 세계 — `root` 의 라이브러리로 판정한다(변이 하네스는 변이된 사본 루트를 준다).
 * fixture 는 원본 저장소 라이브러리로 만든다(topic check 의 directWorld).
 */
export async function repairWorld(root, { draftEdit = null } = {}) {
  const w = await directWorld(root, { schema: 'v2' })
  rmSync(join(w.dir, 'article-draft.ts'))
  const draftPath = join(w.dir, 'draft.md')
  let text = readFileSync(draftPath, 'utf8').replace(/^(\[CTA\][^|\n]*\|[^|\n]*\| ).*$/m, `$1${OLD}`)
  if (draftEdit) text = draftEdit(text)
  writeFileSync(draftPath, text)
  const lib = await import(pathToFileURL(join(root, LIB)).href)
  const src = await import(pathToFileURL(join(root, 'scripts/lib/magazine-direct-spec-source.mjs')).href)
  const { parseQueueSource } = await import(pathToFileURL(join(root, 'scripts/lib/magazine-load.mjs')).href)
  const draftsDir = join(root, 'drafts/magazine')
  const quarantinePath = join(root, 'q', 'quarantine.json')
  mkdirSync(dirname(quarantinePath), { recursive: true })
  writeFileSync(quarantinePath, '{}\n')
  const base = () => ({
    slug: SLUG, draftsDir, expectDraftHash: src.draftHashOf(readFileSync(draftPath)), expectOldText: OLD, text: NEW, approver: 'yanadoo', at: AT,
    queue: parseQueueSource(readFileSync(join(draftsDir, 'topic-queue.ts'), 'utf8')),
    expectedGraphVersion: src.readProductGraphVersion(join(root, 'src/content/magazine/graph/current.ts')), productRoot: root, quarantinePath, nowMs: NOW,
  })
  const args = base()
  return { root, lib, src, draftPath, draftsDir, quarantinePath, args, oldBytes: readFileSync(draftPath, 'utf8'), base }
}

const receiptsOf = (w) => {
  const d = join(w.draftsDir, '_runs', AT.slice(0, 10))
  return existsSync(d) ? readdirSync(d).filter((f) => f.startsWith('draft-cta-repair-')) : []
}
const leasesOf = (w) => {
  const d = join(dirname(w.quarantinePath))
  return readdirSync(d).filter((f) => f !== 'quarantine.json').flatMap((f) => (existsSync(join(d, f)) && !f.includes('.') ? readdirSync(join(d, f)) : []))
}
const fragmentsOf = (w) => readdirSync(dirname(w.draftPath)).filter((f) => f.includes('cta-repair')).sort()
const repaired = (w) => w.oldBytes.replace(`| ${OLD}`, `| ${NEW}`)
/** 정상 완료 — 원고 새 바이트 · 영수증 검증 통과 · 조각 0 · lease 0 */
const completed = (w) => {
  assert.equal(readFileSync(w.draftPath, 'utf8'), repaired(w), '원고가 새 바이트가 아니다')
  assert.equal(receiptsOf(w).length, 1, '영수증이 정확히 1개가 아니다')
  const rp = join(w.draftsDir, '_runs', AT.slice(0, 10), receiptsOf(w)[0])
  const v = w.lib.verifyCtaRepairReceipt({ receiptPath: rp, slug: SLUG, draftHash: w.src.draftHashOf(readFileSync(w.draftPath)), nowMs: NOW })
  assert.equal(v.ok, true, v.why)
  assert.deepEqual(fragmentsOf(w), [], '조각이 남았다')
  assert.deepEqual(leasesOf(w), [], 'lease 가 남았다')
}
/** 남이 lease 를 가져갔다 — lease 파일의 token 을 바꾼다. 그 경로를 돌려준다 */
const stealLease = (w) => {
  const d = dirname(w.quarantinePath)
  for (const sub of readdirSync(d).filter((f) => f !== 'quarantine.json' && !f.includes('.'))) {
    for (const f of readdirSync(join(d, sub))) { const p = join(d, sub, f); writeFileSync(p, JSON.stringify({ token: 'someone-else' })); return p }
  }
  throw new Error('lease 파일이 없다')
}
/** 시험 안 급사 — 그 단계 뒤에서 멈춘다(던진 예외는 lib 가 잡지 않는 단계에서만 쓴다) */
const crashAt = (stage) => ({ fault: (s) => { if (s === stage) throw Object.assign(new Error(`CRASH@${stage}`), { code: 'CRASH' }) } })
const failAt = (stage, code = 'EIO') => ({ fault: (s) => { if (s === stage) throw Object.assign(new Error(`${code}@${stage}`), { code }) } })
const crashed = (w, stage) => assert.throws(() => w.lib.repairDraftCta({ ...w.args, write: true, hooks: crashAt(stage) }), /CRASH@/)

/**
 * 🔴 실제 fs 경쟁 — 라이브러리 코드를 바꾸지 않고, 원고를 k 번째로 읽은 **직후** 외부 writer 가 같은 경로에 쓴다.
 *    (`syncBuiltinESMExports` 가 named import 의 readFileSync 까지 감싼다) 수정 전 코드 재현에도 같은 함수를 쓴다.
 */
export function raceAtRead(w, k, ext) {
  const orig = fs.readFileSync
  let n = 0
  let hit = false
  fs.readFileSync = function wrapped(p, ...rest) {
    const r = orig.call(this, p, ...rest)
    if (typeof p === 'string' && resolve(p) === resolve(w.draftPath) && ++n === k) { hit = true; fs.writeFileSync(w.draftPath, ext) }
    return r
  }
  syncBuiltinESMExports()
  try { return { r: w.lib.repairDraftCta({ ...w.args, write: true }), hit, reads: n } } finally { fs.readFileSync = orig; syncBuiltinESMExports() }
}

/** 실제 자식 프로세스를 그 단계에서 SIGKILL 한다 — lease 는 죽은 주인 것으로 남는다 */
function killChildAt(w, stage) {
  const child = join(w.root, 'cta-repair-kill-child.mjs')
  writeFileSync(child, `import { readFileSync } from 'node:fs'
const [lib, argsPath, killAt] = process.argv.slice(2)
const { repairDraftCta } = await import(lib)
const args = JSON.parse(readFileSync(argsPath, 'utf8'))
const r = repairDraftCta({ ...args, write: true, hooks: { fault: (s) => { if (s === killAt) { process.kill(process.pid, 'SIGKILL'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000) } } } })
console.log(JSON.stringify(r))
`)
  const argsPath = join(w.root, 'cta-repair-kill-args.json')
  writeFileSync(argsPath, JSON.stringify(w.args))
  return spawnSync(process.execPath, [child, pathToFileURL(join(w.root, LIB)).href, argsPath, stage],
    { encoding: 'utf8', env: { ...process.env, HOME: join(w.root, 'home'), SORAN_MAGAZINE_TEST_MODE: '1' } })
}

/** 쓰기 0 — 원고 바이트 · 영수증 · 조각 */
const untouched = (w, r, code) => {
  assert.equal(r.code, code, JSON.stringify(r).slice(0, 240))
  assert.equal(readFileSync(w.draftPath, 'utf8'), w.oldBytes, '거부했는데 원고가 바뀌었다')
  assert.deepEqual(receiptsOf(w), [], '거부했는데 영수증을 썼다')
  assert.deepEqual(readdirSync(dirname(w.draftPath)).filter((f) => f.includes('cta-repair')), [], 'tmp 조각이 남았다')
}

export function ctaRepairCases({ root = () => makeRoot() } = {}) {
  return [
    ['R01 미리보기 — 새 해시만 계산하고 쓰기 0', async () => {
      const w = await repairWorld(root())
      const r = w.lib.repairDraftCta(w.args)
      assert.equal(r.ok, true, r.why); assert.equal(r.written, false); assert.equal(r.preview, true)
      assert.equal(readFileSync(w.draftPath, 'utf8'), w.oldBytes); assert.deepEqual(receiptsOf(w), [])
      assert.equal(r.newDraftHash, w.src.draftHashOf(w.oldBytes.replace(`| ${OLD}`, `| ${NEW}`)))
    }],
    ['R02 쓰기 — CTA 셋째 칸만 바뀐다 · 다른 줄 · 줄바꿈 · href · label 바이트 그대로 · 영수증', async () => {
      const w = await repairWorld(root())
      const r = w.lib.repairDraftCta({ ...w.args, write: true })
      assert.equal(r.ok, true, r.why); assert.equal(r.written, true)
      const now = readFileSync(w.draftPath, 'utf8')
      assert.equal(now, w.oldBytes.replace(`| ${OLD}`, `| ${NEW}`))
      const a = w.oldBytes.split('\n'); const b = now.split('\n')
      assert.equal(a.length, b.length)
      const changed = a.map((l, i) => (l === b[i] ? -1 : i)).filter((i) => i >= 0)
      assert.equal(changed.length, 1, '바뀐 줄이 하나가 아니다')
      const rec = JSON.parse(readFileSync(r.receiptPath, 'utf8'))
      assert.deepEqual(Object.keys(rec).sort(), ['approver', 'at', 'ctaLine', 'href', 'label', 'newDraftHash', 'newText', 'oldDraftHash', 'oldText', 'schema', 'slug'])
      assert.equal(rec.oldDraftHash, w.args.expectDraftHash); assert.equal(rec.newDraftHash, w.src.draftHashOf(now))
      assert.equal(rec.oldText, OLD); assert.equal(rec.newText, NEW); assert.equal(rec.ctaLine, changed[0] + 1)
      assert.ok(b[changed[0]].startsWith(`[CTA] ${rec.href} | ${rec.label} | `)); assert.equal(rec.approver, 'yanadoo'); assert.equal(rec.at, AT)
      assert.ok(r.receiptPath.includes(join('_runs', '2026-10-28', 'draft-cta-repair-')), r.receiptPath)
      assert.deepEqual(leasesOf(w), [], 'lease 가 남았다')
    }],
    ['R03 옛 원고 해시 불일치 → DRAFT_HASH_MISMATCH · 쓰기 0', async () => {
      const w = await repairWorld(root())
      untouched(w, w.lib.repairDraftCta({ ...w.args, expectDraftHash: `sha256:${'0'.repeat(64)}`, write: true }), 'DRAFT_HASH_MISMATCH')
    }],
    ['R04 셋째 칸 옛 문장 불일치 → OLD_TEXT_MISMATCH · 쓰기 0', async () => {
      const w = await repairWorld(root())
      untouched(w, w.lib.repairDraftCta({ ...w.args, expectOldText: `${OLD} `, write: true }), 'OLD_TEXT_MISMATCH')
    }],
    ['R05 CTA 0개 · 2개 → 쓰기 0', async () => {
      const w0 = await repairWorld(root(), { draftEdit: (t) => t.replace(/^\[CTA\].*$/m, '') })
      assert.equal(w0.lib.repairDraftCta({ ...w0.base(), write: true }).ok, false)
      assert.equal(readFileSync(w0.draftPath, 'utf8'), w0.oldBytes); assert.deepEqual(receiptsOf(w0), [])
      const w2 = await repairWorld(root(), { draftEdit: (t) => t.replace(/^(\[CTA\].*)$/m, '$1\n\n$1') })
      const r2 = w2.lib.repairDraftCta({ ...w2.base(), write: true })
      assert.equal(r2.ok, false); assert.ok(['CTA_COUNT', 'CTA_NOT_LAST'].includes(r2.code), r2.code)
      assert.equal(readFileSync(w2.draftPath, 'utf8'), w2.oldBytes)
    }],
    ['R06 href · label 을 바꾸려는 새 문장(| 포함) · 줄바꿈 · 템플릿 문구 · 공통 금지어 → 쓰기 0', async () => {
      for (const [text, code] of [[`${NEW} | /community/menopause`, 'TEXT_INVALID'], [`${NEW}\n다음 줄`, 'TEXT_INVALID'], [OLD, 'TEXT_UNCHANGED'], ['어르신들의 이야기를 남겨 주세요', 'TEXT_FORBIDDEN']]) {
        const w = await repairWorld(root())
        untouched(w, w.lib.repairDraftCta({ ...w.args, text, write: true }), code)
      }
    }],
    ['R07 등록 영수증 → REGISTERED · R08 미정산 전송 예약 → DELIVERY_UNSETTLED · R09 article-draft.ts → ARTICLE_DRAFT_EXISTS (덮지 않는다)', async () => {
      const a = await repairWorld(root()); writeFileSync(join(dirname(a.draftPath), 'article-spec.registered.json'), '{}')
      untouched(a, a.lib.repairDraftCta({ ...a.args, write: true }), 'REGISTERED')
      const b = await repairWorld(root())
      writeFileSync(b.quarantinePath, JSON.stringify({ [SLUG]: { kind: 'CONTENT', sent: false, attempts: 1, lastAt: 1, fingerprint: null,
        delivery: { sent: null, kind: 'DELIVERY_UNCERTAIN', reason: 'sending', stage: 'send', messageFingerprint: `sha256:${'9'.repeat(64)}`, reservationId: 'r08', at: 1 } } }))
      untouched(b, b.lib.repairDraftCta({ ...b.args, write: true }), 'DELIVERY_UNSETTLED')
      const c = await repairWorld(root()); const art = join(dirname(c.draftPath), 'article-draft.ts'); writeFileSync(art, 'export const DRAFT = {}\n')
      untouched(c, c.lib.repairDraftCta({ ...c.args, write: true }), 'ARTICLE_DRAFT_EXISTS')
      assert.equal(readFileSync(art, 'utf8'), 'export const DRAFT = {}\n')
    }],
    ['R10 lease 상실 — 떼어 내기 직전 · 설치 직전 → LOCK_LOST · 원고는 옛 바이트 · 남의 lease 그대로 · 영수증 0 · lease 가 풀리면 다음 실행이 치우고 완료', async () => {
      for (const stage of ['detach:before', 'install:before']) {
        const w = await repairWorld(root())
        let stolen = null
        const r = w.lib.repairDraftCta({ ...w.args, write: true, hooks: { fault: (s) => { if (s === stage) stolen = stealLease(w) } } })
        assert.equal(r.code, 'LOCK_LOST', `${stage}: ${r.code} ${r.why}`)
        assert.equal(readFileSync(w.draftPath, 'utf8'), w.oldBytes, `${stage}: 원고가 옛 바이트가 아니다`)
        assert.deepEqual(receiptsOf(w), [])
        assert.equal(JSON.parse(readFileSync(stolen, 'utf8')).token, 'someone-else', '남의 lease 를 지웠다')
        if (stage === 'detach:before') assert.equal(fragmentsOf(w).includes('.cta-repair.owned'), false, 'lease 없이 canonical 을 떼어 냈다')
        rmSync(stolen)
        const next = w.lib.repairDraftCta({ ...w.args, write: true })
        assert.equal(next.ok, true, `${stage} 다음 실행: ${next.code} ${next.why}`); assert.equal(next.recovered, 'RESTORED_OLD')
        completed(w)
      }
    }],
    ['R11 경쟁 writer — 떼어 내기 직전 → CONCURRENT_WRITER(제자리 복귀) · 설치 직전 · 설치 뒤 · 정리 직전 → RECOVERY_REQUIRED · 외부 바이트 보존 · 재실행도 지우지 않는다', async () => {
      const a = await repairWorld(root()); const ext = `${a.oldBytes}\n외부 writer\n`
      const ra = a.lib.repairDraftCta({ ...a.args, write: true, hooks: { fault: (s) => { if (s === 'detach:before') writeFileSync(a.draftPath, ext) } } })
      assert.equal(ra.code, 'CONCURRENT_WRITER', ra.why); assert.equal(readFileSync(a.draftPath, 'utf8'), ext, '경쟁 writer 를 덮었다')
      assert.deepEqual(receiptsOf(a), []); assert.deepEqual(fragmentsOf(a), [])
      for (const stage of ['install:before', 'installed', 'receipt:verified']) {
        const w = await repairWorld(root()); const e = `${w.oldBytes}\n외부 writer ${stage}\n`
        const r = w.lib.repairDraftCta({ ...w.args, write: true, hooks: { fault: (s) => { if (s === stage) writeFileSync(w.draftPath, e) } } })
        assert.equal(r.code, w.lib.CTA_REPAIR_RECOVERY_REQUIRED, `${stage}: ${r.code} ${r.why}`)
        assert.equal(readFileSync(w.draftPath, 'utf8'), e, `${stage}: 외부 바이트를 덮거나 되돌렸다`)
        const frag = fragmentsOf(w)
        assert.ok(frag.includes('.cta-repair.journal.json'), `${stage}: journal 을 지웠다`)
        if (stage !== 'receipt:verified') assert.deepEqual(receiptsOf(w), [], `${stage}: 외부 바이트 위에 영수증을 썼다`)
        const again = w.lib.repairDraftCta({ ...w.args, write: true })
        assert.equal(again.code, w.lib.CTA_REPAIR_RECOVERY_REQUIRED, `${stage} 재실행: ${again.code} ${again.why}`)
        assert.equal(readFileSync(w.draftPath, 'utf8'), e); assert.deepEqual(fragmentsOf(w), frag, `${stage}: 재실행이 조각을 지웠다`)
      }
    }],
    ['R12 영수증 — 시작 전 다른 기록 → RECEIPT_CONFLICT · 쓰기 0 · 자리 경쟁 → RECOVERY_REQUIRED(남의 영수증 보존) · 쓰기 실패 → 다음 실행이 journal 로 완성', async () => {
      const a = await repairWorld(root())
      const p = a.lib.ctaRepairReceiptPath({ draftsDir: a.draftsDir, slug: SLUG, at: AT, oldDraftHash: a.args.expectDraftHash })
      mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, '{"schema":"draft-cta-repair/1","slug":"other"}\n')
      const ra = a.lib.repairDraftCta({ ...a.args, write: true })
      assert.equal(ra.code, 'RECEIPT_CONFLICT'); assert.equal(readFileSync(a.draftPath, 'utf8'), a.oldBytes)
      assert.equal(readFileSync(p, 'utf8'), '{"schema":"draft-cta-repair/1","slug":"other"}\n'); assert.deepEqual(fragmentsOf(a), [])
      // 원고를 놓은 뒤 영수증 자리를 다른 기록이 먼저 차지했다 → 덮지 않는다(no-clobber) · 재실행도 덮지 않는다
      const c = await repairWorld(root())
      const cp = c.lib.ctaRepairReceiptPath({ draftsDir: c.draftsDir, slug: SLUG, at: AT, oldDraftHash: c.args.expectDraftHash })
      const rc = c.lib.repairDraftCta({ ...c.args, write: true, hooks: { fault: (s) => { if (s === 'receipt:link') { mkdirSync(dirname(cp), { recursive: true }); writeFileSync(cp, '{"race":1}\n') } } } })
      assert.equal(rc.code, c.lib.CTA_REPAIR_RECOVERY_REQUIRED, rc.why); assert.equal(readFileSync(cp, 'utf8'), '{"race":1}\n', '남의 영수증을 덮었다')
      assert.equal(readFileSync(c.draftPath, 'utf8'), repaired(c)); assert.ok(fragmentsOf(c).includes('.cta-repair.journal.json'))
      assert.equal(c.lib.repairDraftCta({ ...c.args, write: true }).code, c.lib.CTA_REPAIR_RECOVERY_REQUIRED)
      assert.equal(readFileSync(cp, 'utf8'), '{"race":1}\n')
      // 영수증을 놓은 직후 그 자리가 다른 바이트로 바뀌었다 → 다시 읽어 검증이 막는다 · 남의 바이트 보존
      const t = await repairWorld(root())
      const tp = t.lib.ctaRepairReceiptPath({ draftsDir: t.draftsDir, slug: SLUG, at: AT, oldDraftHash: t.args.expectDraftHash })
      const rt = t.lib.repairDraftCta({ ...t.args, write: true, hooks: { fault: (s) => { if (s === 'receipt:written') writeFileSync(tp, '{"tampered":1}\n') } } })
      assert.equal(rt.code, t.lib.CTA_REPAIR_RECOVERY_REQUIRED, rt.why); assert.equal(readFileSync(tp, 'utf8'), '{"tampered":1}\n')
      assert.ok(fragmentsOf(t).includes('.cta-repair.journal.json'), '검증 전에 journal 을 지웠다')
      // 영수증 open · write · fsync · link 실패 → 원고는 새 바이트 · journal 남김 → 다음 실행이 영수증을 완성한다
      for (const stage of ['receipt:open', 'receipt:write', 'receipt:fsync', 'receipt:link']) {
        const w = await repairWorld(root())
        const r = w.lib.repairDraftCta({ ...w.args, write: true, hooks: failAt(stage) })
        assert.equal(r.code, 'RECEIPT_WRITE_FAILED', `${stage}: ${r.code} ${r.why}`)
        assert.equal(readFileSync(w.draftPath, 'utf8'), repaired(w)); assert.deepEqual(receiptsOf(w), [])
        assert.ok(fragmentsOf(w).includes('.cta-repair.journal.json'), `${stage}: journal 을 지웠다`)
        const next = w.lib.repairDraftCta({ ...w.args, write: true })
        assert.equal(next.ok, true, `${stage} 다음 실행: ${next.code} ${next.why}`); assert.equal(next.recovered, 'COMPLETED'); assert.equal(next.idempotent, true)
        completed(w)
      }
    }],
    ['R13 조각 없는 정상 수리 · 같은 수리 재실행 멱등 (쓰기 0 · 바이트 그대로) · 같은 원고에 다른 문장 → 충돌', async () => {
      const b = await repairWorld(root())
      const first = b.lib.repairDraftCta({ ...b.args, write: true }); assert.equal(first.written, true); assert.equal(first.recovered, undefined)
      completed(b)
      const bytes = readFileSync(b.draftPath, 'utf8'); const rec = readFileSync(first.receiptPath, 'utf8')
      const again = b.lib.repairDraftCta({ ...b.args, write: true })
      assert.equal(again.ok, true); assert.equal(again.written, false); assert.equal(again.idempotent, true)
      assert.equal(readFileSync(b.draftPath, 'utf8'), bytes); assert.equal(readFileSync(first.receiptPath, 'utf8'), rec); completed(b)
      assert.equal(b.lib.repairDraftCta({ ...b.args, text: `${NEW} 다시`, write: true }).code, 'RECEIPT_CONFLICT')
      assert.equal(readFileSync(b.draftPath, 'utf8'), bytes); assert.deepEqual(fragmentsOf(b), [])
    }],
    ['R14 큐 행이 승인과 다르다 · DIRECT 가 아니다 → 쓰기 0', async () => {
      const a = await repairWorld(root())
      const queue = a.args.queue.map((q) => (q.slug === SLUG ? { ...q, articlePlanHash: `sha256:${'f'.repeat(64)}` } : q))
      const ra = a.lib.repairDraftCta({ ...a.args, queue, write: true })
      assert.equal(ra.ok, false); assert.equal(readFileSync(a.draftPath, 'utf8'), a.oldBytes); assert.deepEqual(receiptsOf(a), [])
      const b = await repairWorld(root())
      const legacy = b.args.queue.map((q) => (q.slug === SLUG ? (({ directSpecMode: _m, g8ManifestHash: _g, articlePlanHash: _p, ...x }) => x)(q) : q))
      untouched(b, b.lib.repairDraftCta({ ...b.args, queue: legacy, write: true }), 'NOT_DIRECT')
    }],
    ['R15 실제 CLI — 기본은 미리보기 · --write 로만 쓴다 · 필수 인자 누락은 사용법 오류 · 전송 경로 import 0', async () => {
      const w = await repairWorld(root())
      const cli = (extra) => spawnSync(process.execPath, [join(w.root, 'scripts/magazine-draft-cta-repair.mjs'), '--drafts-dir', w.draftsDir, '--slug', SLUG,
        '--expect-draft-hash', w.args.expectDraftHash, '--expect-old-text', OLD, '--text', NEW, '--approver', 'yanadoo', '--at', AT, ...extra],
      { encoding: 'utf8', env: { ...process.env, HOME: join(w.root, 'home'), SORAN_MAGAZINE_TEST_MODE: '1' } })
      const pv = cli([]); assert.equal(pv.status, 0, pv.stdout + pv.stderr)
      assert.equal(JSON.parse(pv.stdout).preview, true); assert.equal(readFileSync(w.draftPath, 'utf8'), w.oldBytes)
      const wr = cli(['--write']); assert.equal(wr.status, 0, wr.stdout + wr.stderr); assert.equal(JSON.parse(wr.stdout).written, true)
      assert.equal(readFileSync(w.draftPath, 'utf8'), w.oldBytes.replace(`| ${OLD}`, `| ${NEW}`))
      assert.equal(spawnSync(process.execPath, [join(w.root, 'scripts/magazine-draft-cta-repair.mjs'), '--slug', SLUG], { encoding: 'utf8' }).status, 2)
      for (const f of [LIB, 'scripts/magazine-draft-cta-repair.mjs']) {
        const t = readFileSync(join(ROOT, f), 'utf8')
        assert.equal(/webui-runner|chatgpt-session|connectOverCDP|playwright|ensureChrome|fetch\(/.test(t), false, `${f} 가 전송 경로를 부른다`)
      }
    }],
    ['R16 실제 fs 경쟁 — 원고를 k 번째로 읽은 직후 외부 writer(코드 무변경) → 모든 k 에서 외부 바이트 보존 · 외부 바이트를 새 원고라 부르는 영수증 0', async () => {
      let hits = 0
      for (let k = 1; k <= 20; k += 1) {
        const w = await repairWorld(root()); const ext = `${w.oldBytes}\n외부 writer k=${k}\n`
        const { r, hit } = raceAtRead(w, k, ext)
        if (!hit) { assert.equal(r.ok, true, r.why); completed(w); break }
        hits += 1
        assert.equal(readFileSync(w.draftPath, 'utf8'), ext, `k=${k}: 외부 바이트를 덮었다 (${r.code ?? 'ok'})`)
        for (const f of receiptsOf(w)) {
          assert.notEqual(JSON.parse(readFileSync(join(w.draftsDir, '_runs', AT.slice(0, 10), f), 'utf8')).newDraftHash, w.src.draftHashOf(ext), `k=${k}: 외부 바이트를 새 원고라 불렀다`)
        }
      }
      assert.ok(hits >= 3, `경쟁 지점이 너무 적다 (${hits}) — 시험이 원고 읽기를 보지 못한다`)
    }],
    ['R17 실제 자식 프로세스 SIGKILL — journal 뒤 · 떼어 낸 뒤 · 설치 뒤 영수증 전 · 영수증 뒤 검증 전 · 검증 뒤 정리 전 → 다음 실행이 lease 안에서 자동 복구 · 완료', async () => {
      const expect = [['journal:written', 'RESTORED_OLD', true], ['detached', 'RESTORED_OLD', true], ['installed', 'COMPLETED', false],
        ['receipt:written', 'COMPLETED', false], ['receipt:verified', 'COMPLETED', false]]
      for (const [stage, state, rewrites] of expect) {
        const w = await repairWorld(root())
        const k = killChildAt(w, stage)
        assert.equal(k.signal, 'SIGKILL', `${stage}: 자식이 그 단계에서 죽지 않았다 (${k.status} ${k.stdout}${k.stderr})`)
        assert.ok(fragmentsOf(w).includes('.cta-repair.journal.json'), `${stage}: journal 이 없다`)
        if (stage === 'detached') assert.equal(existsSync(w.draftPath), false, 'detached 뒤인데 canonical 이 있다')
        if (stage === 'installed') assert.deepEqual(receiptsOf(w), [])
        const pv = w.lib.repairDraftCta(w.args)
        assert.equal(pv.code, 'CTA_REPAIR_PENDING', `${stage}: 미리보기가 남은 transaction 을 알리지 않는다`)
        const r = w.lib.repairDraftCta({ ...w.args, write: true })
        assert.equal(r.ok, true, `${stage}: ${r.code} ${r.why}`); assert.equal(r.recovered, state, stage); assert.equal(r.written, rewrites, stage)
        completed(w)
      }
    }],
    ['R18 조각 open · write · fsync 실패 · 설치 link 실패 → 옛 원고 그대로 · 조각 0 · 옛 원고 복구까지 실패 → RECOVERY_REQUIRED(owned · journal 보존) → 다음 실행이 복구 · 완료', async () => {
      for (const stage of ['journal:open', 'journal:write', 'journal:fsync', 'new:open', 'new:write', 'new:fsync', 'install:link']) {
        const w = await repairWorld(root())
        untouched(w, w.lib.repairDraftCta({ ...w.args, write: true, hooks: failAt(stage) }), stage === 'install:link' ? 'INSTALL_FAILED' : 'WRITE_FAILED')
        assert.deepEqual(leasesOf(w), [], `${stage}: lease 가 남았다`)
        assert.equal(w.lib.repairDraftCta({ ...w.args, write: true }).written, true, `${stage}: 다음 실행이 수리하지 못했다`)
        completed(w)
      }
      const w = await repairWorld(root())
      const r = w.lib.repairDraftCta({ ...w.args, write: true, hooks: { fault: (s) => { if (s === 'install:link' || s === 'restore:link') throw Object.assign(new Error(s), { code: 'EIO' }) } } })
      assert.equal(r.code, w.lib.CTA_REPAIR_RECOVERY_REQUIRED, r.why)
      assert.equal(existsSync(w.draftPath), false)
      assert.equal(readFileSync(join(dirname(w.draftPath), '.cta-repair.owned'), 'utf8'), w.oldBytes, 'owned 를 잃었다')
      assert.ok(fragmentsOf(w).includes('.cta-repair.journal.json')); assert.deepEqual(receiptsOf(w), [])
      const next = w.lib.repairDraftCta({ ...w.args, write: true })
      assert.equal(next.ok, true, next.why); assert.equal(next.recovered, 'RESTORED_OLD'); completed(w)
    }],
    ['R19 복구할 수 없는 상태 — canonical 외부 바이트 · 되돌리는 사이 차지 · journal 없는 조각 · 변조 journal · 변조 owned → RECOVERY_REQUIRED · 아무것도 지우지 않는다', async () => {
      const RR = 'CTA_REPAIR_RECOVERY_REQUIRED'
      const ext = '외부 writer 원고\n'
      const snapshot = (w) => Object.fromEntries([...fragmentsOf(w), 'draft.md'].filter((f) => existsSync(join(dirname(w.draftPath), f))).map((f) => [f, readFileSync(join(dirname(w.draftPath), f), 'utf8')]))
      const holds = async (label, w, hooks = {}) => {
        const before = snapshot(w)
        const r = w.lib.repairDraftCta({ ...w.args, write: true, hooks })
        assert.equal(r.code, RR, `${label}: ${r.code} ${r.why}`)
        if (!hooks.fault) assert.deepEqual(snapshot(w), before, `${label}: 바이트 · 조각이 바뀌었다`)
        assert.deepEqual(receiptsOf(w), [], `${label}: 영수증을 썼다`)
      }
      const a = await repairWorld(root()); crashed(a, 'detached'); writeFileSync(a.draftPath, ext)
      await holds('떼어 낸 뒤 외부 writer 가 canonical 을 차지', a)
      const b = await repairWorld(root()); crashed(b, 'installed')
      const tmp = join(b.root, 'ext.tmp'); writeFileSync(tmp, ext); renameSync(tmp, b.draftPath)
      await holds('설치 뒤 외부 writer 가 canonical 을 교체', b)
      assert.equal(readFileSync(join(dirname(b.draftPath), '.cta-repair.new'), 'utf8'), repaired(b))
      const c = await repairWorld(root()); writeFileSync(join(dirname(c.draftPath), '.cta-repair.owned'), c.oldBytes)
      await holds('journal 없이 owned 조각', c)
      const d = await repairWorld(root()); crashed(d, 'journal:written')
      const jp = join(dirname(d.draftPath), '.cta-repair.journal.json'); writeFileSync(jp, JSON.stringify({ ...JSON.parse(readFileSync(jp, 'utf8')), extra: 1 }))
      await holds('변조 journal(필드 추가)', d)
      const d2 = await repairWorld(root()); crashed(d2, 'journal:written')
      const jp2 = join(dirname(d2.draftPath), '.cta-repair.journal.json'); writeFileSync(jp2, JSON.stringify({ ...JSON.parse(readFileSync(jp2, 'utf8')), receiptPath: '../elsewhere.json' }))
      await holds('변조 journal(영수증 자리)', d2)
      const e = await repairWorld(root()); crashed(e, 'detached'); writeFileSync(join(dirname(e.draftPath), '.cta-repair.owned'), 'tampered\n')
      await holds('변조 owned', e)
      const g = await repairWorld(root()); crashed(g, 'journal:written')
      const gp = g.lib.ctaRepairReceiptPath({ draftsDir: g.draftsDir, slug: SLUG, at: AT, oldDraftHash: g.args.expectDraftHash })
      mkdirSync(dirname(gp), { recursive: true }); writeFileSync(gp, '{"other":1}\n')
      const rg = g.lib.repairDraftCta({ ...g.args, write: true })
      assert.equal(rg.code, RR, `옛 원고인데 영수증 자리에 기록: ${rg.code}`); assert.equal(readFileSync(gp, 'utf8'), '{"other":1}\n')
      assert.ok(fragmentsOf(g).includes('.cta-repair.journal.json'), '옛 원고 + 영수증 상태에서 journal 을 지웠다')
      const f = await repairWorld(root()); crashed(f, 'detached')
      await holds('옛 원고를 되돌리는 사이 외부 writer 가 차지', f, { fault: (s) => { if (s === 'restore:link') writeFileSync(f.draftPath, ext) } })
      assert.equal(readFileSync(f.draftPath, 'utf8'), ext, '되돌리면서 외부 바이트를 덮었다')
      assert.equal(readFileSync(join(dirname(f.draftPath), '.cta-repair.owned'), 'utf8'), f.oldBytes, 'owned 를 잃었다')
    }],
    ['R20 영수증 검증(P2) — 완전한 영수증만 수리 증거다 · 누락 · 추가 · 변조 필드 · 자리 → CTA_REPAIR_RECEIPT_MISMATCH', async () => {
      const w = await repairWorld(root()); const r = w.lib.repairDraftCta({ ...w.args, write: true }); assert.equal(r.ok, true, r.why)
      const good = JSON.parse(readFileSync(r.receiptPath, 'utf8'))
      const verify = (rec, { name = basename(r.receiptPath), day = AT.slice(0, 10), draftHash = rec.newDraftHash } = {}) => {
        const p = join(w.root, 'p20', `${Math.random()}`.slice(2), day, name)
        mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(rec))
        return w.lib.verifyCtaRepairReceipt({ receiptPath: p, slug: SLUG, draftHash, nowMs: NOW })
      }
      assert.equal(verify(good).ok, true, verify(good).why)
      const omit = (k) => (x) => Object.fromEntries(Object.entries(x).filter(([key]) => key !== k))
      const set = (k, v) => (x) => ({ ...x, [k]: v })
      const cases = [
        ['schema 누락', omit('schema')], ['approver 누락', omit('approver')], ['ctaLine 누락', omit('ctaLine')], ['필드 추가', set('extra', 1)],
        ['schema 변조', set('schema', 'draft-cta-repair/2')], ['slug 형식', set('slug', 'Other Slug')],
        ['newDraftHash 형식', set('newDraftHash', good.newDraftHash.toUpperCase())], ['옛 = 새 해시', set('newDraftHash', good.oldDraftHash)],
        ['oldText 비움', set('oldText', '')], ['oldText 에 |', set('oldText', 'a | b')],
        ['newText 에 |', set('newText', `${NEW} | /community/menopause`)], ['newText 템플릿', set('newText', '(지시 — 그대로 옮기지 않는다) 남겨 주세요')],
        ['newText 금지어', set('newText', '어르신들의 이야기를 남겨 주세요')], ['newText = oldText', set('newText', good.oldText)],
        ['ctaLine 0', set('ctaLine', 0)], ['ctaLine 문자열', set('ctaLine', String(good.ctaLine))],
        ['href 외부', set('href', 'https://example.com')], ['href 비움', set('href', '')], ['label 비움', set('label', '')], ['label 에 |', set('label', 'a | b')],
        ['approver 기계', set('approver', 'codex')], ['approver 공백', set('approver', '  ')], ['approver 둘레 공백', set('approver', ' yanadoo ')],
        ['at UTC', set('at', '2026-10-28T11:00:00Z')], ['at 미래', set('at', '2026-10-28T23:00:00+09:00')], ['at 없는 시각', set('at', '2026-10-28T24:00:00+09:00')],
      ]
      for (const [label, mut] of cases) {
        const v = verify(mut(good))
        assert.equal(v.code, 'CTA_REPAIR_RECEIPT_MISMATCH', `${label}: 받아 줬다`)
      }
      assert.equal(verify(good, { draftHash: `sha256:${'a'.repeat(64)}` }).code, 'CTA_REPAIR_RECEIPT_MISMATCH', '지금 원고와 다른 새 해시')
      assert.equal(verify(good, { name: `draft-cta-repair-${SLUG}-000000000000.json` }).code, 'CTA_REPAIR_RECEIPT_MISMATCH', '다른 이름 자리')
      assert.equal(verify(good, { day: '2026-10-27' }).code, 'CTA_REPAIR_RECEIPT_MISMATCH', '다른 날짜 폴더')
      assert.equal(w.lib.verifyCtaRepairReceipt({ receiptPath: r.receiptPath, slug: 'other-slug', draftHash: good.newDraftHash, nowMs: NOW }).code, 'CTA_REPAIR_RECEIPT_MISMATCH')
      // 쓰는 쪽도 같은 판정을 지난다 — 기계 승인자는 시작부터 막는다
      const m = await repairWorld(root())
      untouched(m, m.lib.repairDraftCta({ ...m.args, approver: 'claude', write: true }), 'APPROVER_MACHINE')
    }],
    ['R21 미리보기 — 남은 조각이 있으면 CTA_REPAIR_PENDING · 쓰기 0 (복구하지 않는다)', async () => {
      const w = await repairWorld(root()); crashed(w, 'journal:written'); const f = fragmentsOf(w)
      const r = w.lib.repairDraftCta(w.args)
      assert.equal(r.code, 'CTA_REPAIR_PENDING', r.why); assert.deepEqual(fragmentsOf(w), f)
      assert.equal(readFileSync(w.draftPath, 'utf8'), w.oldBytes); assert.deepEqual(leasesOf(w), [])
    }],
  ]
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const r = await runCases(ctaRepairCases())
  console.log(`\n원고 CTA 무전송 수리 검사: ${r.pass} pass, ${r.fail} fail`)
  if (r.fail) process.exitCode = 1
}
