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
 *   R10 lease 상실 · R11 쓰기 직전 · 직후 경쟁 writer → 남의 바이트 보존 · 영수증 0
 *   R12 영수증 충돌 · R13 같은 수리 재실행 멱등 · R14 큐 · source 가 정본이 아니다
 *   R15 실제 CLI — 미리보기 기본 · --write · 사용법 · 전송 경로 import 0
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
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
    ['R10 교체 직전 lease 상실 → LOCK_LOST · 원고 · 남의 lease 그대로', async () => {
      const w = await repairWorld(root())
      let lease = null
      const r = w.lib.repairDraftCta({ ...w.args, write: true, hooks: { beforeRename: ({ lease: l }) => { lease = l.lease; writeFileSync(l.lease, JSON.stringify({ token: 'someone-else' })) } } })
      untouched(w, r, 'LOCK_LOST')
      assert.equal(JSON.parse(readFileSync(lease, 'utf8')).token, 'someone-else', '남의 lease 를 지웠다')
    }],
    ['R11 쓰기 직전 · 직후 경쟁 writer → CONCURRENT_WRITER · 그 바이트 보존 · 영수증 0', async () => {
      const a = await repairWorld(root()); const ext = `${a.oldBytes}\n외부 writer 앞\n`
      const ra = a.lib.repairDraftCta({ ...a.args, write: true, hooks: { beforeRename: () => writeFileSync(a.draftPath, ext) } })
      assert.equal(ra.code, 'CONCURRENT_WRITER'); assert.equal(readFileSync(a.draftPath, 'utf8'), ext); assert.deepEqual(receiptsOf(a), [])
      assert.deepEqual(readdirSync(dirname(a.draftPath)).filter((f) => f.includes('cta-repair')), [])
      const b = await repairWorld(root()); const ext2 = `${b.oldBytes}\n외부 writer 뒤\n`
      const rb = b.lib.repairDraftCta({ ...b.args, write: true, hooks: { afterWrite: () => writeFileSync(b.draftPath, ext2) } })
      assert.equal(rb.code, 'CONCURRENT_WRITER'); assert.equal(readFileSync(b.draftPath, 'utf8'), ext2, '경쟁 writer 를 덮거나 되돌렸다')
      assert.deepEqual(receiptsOf(b), [])
    }],
    ['R12 영수증 자리에 다른 기록 → RECEIPT_CONFLICT · 쓰기 0 · R13 같은 수리 재실행 → 멱등 (쓰기 0 · 바이트 그대로)', async () => {
      const a = await repairWorld(root())
      const p = a.lib.ctaRepairReceiptPath({ draftsDir: a.draftsDir, slug: SLUG, at: AT, oldDraftHash: a.args.expectDraftHash })
      mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, '{"schema":"draft-cta-repair/1","slug":"other"}\n')
      const ra = a.lib.repairDraftCta({ ...a.args, write: true })
      assert.equal(ra.code, 'RECEIPT_CONFLICT'); assert.equal(readFileSync(a.draftPath, 'utf8'), a.oldBytes)
      assert.equal(readFileSync(p, 'utf8'), '{"schema":"draft-cta-repair/1","slug":"other"}\n')
      const b = await repairWorld(root())
      const first = b.lib.repairDraftCta({ ...b.args, write: true }); assert.equal(first.written, true)
      const bytes = readFileSync(b.draftPath, 'utf8'); const rec = readFileSync(first.receiptPath, 'utf8')
      const again = b.lib.repairDraftCta({ ...b.args, write: true })
      assert.equal(again.ok, true); assert.equal(again.written, false); assert.equal(again.idempotent, true)
      assert.equal(readFileSync(b.draftPath, 'utf8'), bytes); assert.equal(readFileSync(first.receiptPath, 'utf8'), rec)
      // 원고 교체 직후 영수증 자리를 다른 기록이 차지했다 → 덮지 않는다(no-clobber) · RECEIPT_CONFLICT
      const c = await repairWorld(root())
      const cp = c.lib.ctaRepairReceiptPath({ draftsDir: c.draftsDir, slug: SLUG, at: AT, oldDraftHash: c.args.expectDraftHash })
      const rc = c.lib.repairDraftCta({ ...c.args, write: true, hooks: { afterWrite: () => { mkdirSync(dirname(cp), { recursive: true }); writeFileSync(cp, '{"race":1}\n') } } })
      assert.equal(rc.code, 'RECEIPT_CONFLICT'); assert.equal(readFileSync(cp, 'utf8'), '{"race":1}\n', '남의 영수증을 덮었다')
      // 같은 원고에 다른 문장으로 다시 → 충돌
      assert.equal(b.lib.repairDraftCta({ ...b.args, text: `${NEW} 다시`, write: true }).code, 'RECEIPT_CONFLICT')
      assert.equal(readFileSync(b.draftPath, 'utf8'), bytes)
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
  ]
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const r = await runCases(ctaRepairCases())
  console.log(`\n원고 CTA 무전송 수리 검사: ${r.pass} pass, ${r.fail} fail`)
  if (r.fail) process.exitCode = 1
}
