/**
 * 🔴 **원고 CTA 앞 문장 무전송 수리** (2026-10-28 · age-learning "밤 이야기" 노출).
 *
 *    spec/1 DIRECT brief 가 CTA 셋째 칸에 고정 문장을 넣어, 이미 회수한 원고 끝에 주제와 무관한 문장이 남았다.
 *    원고 전체를 다시 받으면 전송이다. 이 수리는 **사람이 승인한 문장 하나**로 마지막 `[CTA]` 줄의 셋째 칸만 바꾼다.
 *
 *    계약
 *      - 기본은 미리보기 — `write: true` 일 때만 쓴다. 쓰기는 같은 slug 원고 lease 안에서만 한다.
 *      - 원고 전체 sha256 = 기대값 · CTA 정확히 1개 · 마지막 블록 · 셋째 칸 옛 문장 = 기대 문장(글자 그대로).
 *      - href · label · 다른 줄 · 줄바꿈은 바이트까지 그대로 — 셋째 칸 글자 구간만 바꾼다.
 *      - 등록 영수증 · 미정산 전송 예약 · article-draft.ts 중 하나라도 있으면 쓰기 0 (article-draft.ts 를 만들거나 덮지 않는다).
 *      - 정본 큐 행 · 현재 승인 source · 제품 판으로 다시 맞춘 spec 이 디스크 spec 과 바이트까지 같아야 한다.
 *      - 쓰기 직전 · 직후 원고 바이트를 다시 본다 — 경쟁 writer 의 바이트를 덮지도 되돌리지도 않는다.
 *      - 수리 뒤 원고가 형식 계약 · 저장 전 관문 · 변환 판정(같은 파서)을 다시 지난다 — 다른 블록은 그대로다.
 *      - 영수증은 `drafts/magazine/_runs/<KST 날짜>/draft-cta-repair-<slug>-<옛 해시 앞 12>.json` 에 no-clobber 로 쓴다.
 *        같은 입력 재실행은 멱등(쓰기 0) · 다른 영수증 · 다른 원고면 fail-closed.
 *      - ChatGPT · Chrome · CDP · 네트워크 0. 재생성 0.
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { canonicalJson } from './magazine-article-spec.mjs'
import { BANNED_WORDS, MEDICAL_ASSERTIONS } from './magazine-brief-policy.mjs'
import {
  ARTICLE_SPEC_REGISTER_LEDGER, DIRECT_CTA_DIRECTIVE_HEAD, DIRECT_SPEC_MODE, LEGACY_DIRECT_CTA_LEAD, readDirectSpec, resolveMagazineAutoMode,
} from './magazine-direct-spec.mjs'
import { draftHashOf, draftTopicViolations, verifyDirectSpecOnDisk } from './magazine-direct-spec-source.mjs'
import { judgeManuscriptFormat } from './magazine-manuscript-format.mjs'
import { validateManuscript } from './magazine-manuscript-guard.mjs'
import { acquireManuscriptLease, readQuarantine } from './magazine-quarantine.mjs'

export const CTA_REPAIR_RECEIPT_SCHEMA = 'draft-cta-repair/1'
export const CTA_TEXT_MAX = 120
const SHA256_RE = /^sha256:[0-9a-f]{64}$/
const KST_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/
/** 마지막 `[CTA]` 줄의 세 칸과 그 사이 공백을 글자 그대로 나눈다 — 셋째 칸 구간만 바꾸기 위해서다 */
const CTA_LINE_RE = /^(\s*\[CTA\]\s*)([^|]*?)(\s*\|\s*)([^|]*?)(\s*\|\s*)([^|]*?)(\s*)$/

/** 영수증 자리 — 옛 원고 해시로 정한다(같은 입력이면 같은 자리) */
export function ctaRepairReceiptPath({ draftsDir, slug, at, oldDraftHash }) {
  return join(draftsDir, '_runs', String(at).slice(0, 10), `draft-cta-repair-${slug}-${String(oldDraftHash).replace(/^sha256:/, '').slice(0, 12)}.json`)
}

/**
 * 수리 계획 — 파일을 쓰지 않는다. 미리보기 · 쓰기가 같은 함수로 판정한다.
 * @returns {{ok:true, plan:object}|{ok:false, code:string, why:string}}
 */
export function planCtaRepair({ slug, draftsDir, expectDraftHash, expectOldText, text, approver, at, queue, expectedGraphVersion, productRoot, quarantinePath, nowMs = Date.now() }) {
  const fail = (code, why) => ({ ok: false, code, why })
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(slug ?? ''))) return fail('SLUG_REQUIRED', 'slug 가 kebab-case 가 아니다')
  if (!SHA256_RE.test(String(expectDraftHash ?? ''))) return fail('EXPECT_HASH_INVALID', '--expect-draft-hash 는 sha256:<64 hex> 여야 한다')
  if (typeof expectOldText !== 'string' || !expectOldText) return fail('EXPECT_OLD_TEXT_REQUIRED', '--expect-old-text 가 비었다')
  if (typeof approver !== 'string' || !approver.trim()) return fail('APPROVER_REQUIRED', '승인자가 비었다')
  if (!KST_RE.test(String(at ?? '')) || Number.isNaN(Date.parse(at))) return fail('AT_INVALID', '--at 은 초까지 포함한 KST(+09:00) 시각이어야 한다')
  if (Date.parse(at) > nowMs) return fail('AT_FUTURE', '--at 이 지금보다 뒤다')
  // ── 새 문장 ──
  if (typeof text !== 'string' || text !== text.trim() || !text || /[|\r\n]/.test(text) || [...text].length > CTA_TEXT_MAX) {
    return fail('TEXT_INVALID', `새 문장은 앞뒤 공백 · | · 줄바꿈 없는 ${CTA_TEXT_MAX}자 이하 한 줄이어야 한다`)
  }
  if (text === expectOldText) return fail('TEXT_UNCHANGED', '새 문장이 옛 문장과 같다 — 고칠 것이 없다')
  if (text === LEGACY_DIRECT_CTA_LEAD || text.includes(DIRECT_CTA_DIRECTIVE_HEAD)) return fail('TEXT_TEMPLATE_COPY', '새 문장이 brief 템플릿 문구다')
  const common = [...BANNED_WORDS, ...MEDICAL_ASSERTIONS].filter((w) => text.includes(w))
  if (common.length) return fail('TEXT_FORBIDDEN', `새 문장에 공통 금지어가 있다: ${common.join(',')}`)

  // ── 정본 큐 · 승인 source · spec ──
  const row = (queue ?? []).filter((q) => q?.slug === slug)
  if (row.length !== 1) return fail('QUEUE_ROW_INVALID', `정본 큐에 ${slug} 행이 정확히 하나가 아니다 (${row.length}개)`)
  const mode = resolveMagazineAutoMode(row[0])
  if (!mode.ok || mode.mode !== DIRECT_SPEC_MODE) return fail('NOT_DIRECT', 'DIRECT_SPEC_V1 글만 수리한다')
  const disk = readDirectSpec({ slug, draftsDir })
  if (!disk.ok) return fail(disk.code, disk.why)
  const v = verifyDirectSpecOnDisk({ slug, queue, draftsDir, expectedGraphVersion, productRoot })
  if (!v.ok) return fail(v.code, `승인 source · 큐 · spec 이 정본이 아니다: ${v.why}`)

  // ── 막는 흔적 ──
  const dir = join(draftsDir, slug)
  if (existsSync(join(dir, ARTICLE_SPEC_REGISTER_LEDGER))) return fail('REGISTERED', '등록 영수증이 있다 — 등록된 원고는 고치지 않는다')
  if (existsSync(join(dir, 'article-draft.ts'))) return fail('ARTICLE_DRAFT_EXISTS', 'article-draft.ts 가 있다 — 변환물을 만들거나 덮지 않는다')
  const ledger = readQuarantine(quarantinePath)
  if (!ledger.ok) return fail(ledger.code ?? 'LEDGER_UNREADABLE', `격리 장부를 읽지 못했다: ${ledger.why}`)
  const entry = ledger.store?.[slug] ?? null
  const d = entry?.delivery
  if (d?.reservationId || d?.kind === 'DELIVERY_UNCERTAIN' || entry?.sent === null) return fail('DELIVERY_UNSETTLED', '미정산 전송 예약이 있다 — 원고를 고치지 않는다')

  // ── 원고 ──
  const draftPath = join(dir, 'draft.md')
  let oldBytes
  try { oldBytes = readFileSync(draftPath, 'utf8') } catch { return fail('DRAFT_MISSING', 'draft.md 가 없다') }
  const oldDraftHash = draftHashOf(oldBytes)
  if (oldDraftHash !== expectDraftHash) return { ...fail('DRAFT_HASH_MISMATCH', `원고 해시가 기대값과 다르다 (${oldDraftHash.slice(0, 19)}…)`), oldDraftHash }
  const before = judgeManuscriptFormat(oldBytes)
  const ctaBlocks = before.blocks.filter((b) => b.type === 'cta')
  if (before.blocks[before.blocks.length - 1]?.type !== 'cta') return fail('CTA_NOT_LAST', 'CTA 가 마지막 블록이 아니다')
  const lines = oldBytes.split('\n')
  const ctaIdx = lines.map((l, i) => (l.trim().startsWith('[CTA]') ? i : -1)).filter((i) => i >= 0)
  if (ctaIdx.length !== 1) return fail('CTA_COUNT', `[CTA] 줄이 정확히 1개가 아니다 (${ctaIdx.length}개)`)
  const m = CTA_LINE_RE.exec(lines[ctaIdx[0]])
  if (!m) return fail('CTA_SHAPE', '[CTA] 줄이 "href | label | text" 세 칸이 아니다')
  const [, head, href, sep1, label, sep2, oldText, tail] = m
  if (ctaBlocks.length !== 1 || href !== ctaBlocks[0].href || label !== ctaBlocks[0].label) return fail('CTA_SHAPE', '[CTA] 줄 판독이 변환 판정과 다르다')
  if (oldText !== expectOldText) return fail('OLD_TEXT_MISMATCH', `셋째 칸 옛 문장이 기대 문장과 다르다: ${JSON.stringify(oldText)}`)
  const nextLines = [...lines]
  nextLines[ctaIdx[0]] = `${head}${href}${sep1}${label}${sep2}${text}${tail}`
  const newBytes = nextLines.join('\n')

  // ── 수리 뒤 판정 — 같은 파서 · 저장 전 관문 · 다른 블록 그대로 ──
  const after = judgeManuscriptFormat(newBytes)
  if (!after.ok) return fail('REPAIRED_FORMAT_INVALID', '수리한 원고가 형식 계약을 지키지 않는다')
  if (!validateManuscript(newBytes).ok) return fail('REPAIRED_MANUSCRIPT_INVALID', '수리한 원고가 저장 전 관문을 지나지 않는다')
  const afterCta = after.blocks.filter((b) => b.type === 'cta')
  const expectBlocks = before.blocks.map((b) => (b.type === 'cta' ? { ...b, text } : b))
  if (afterCta.length !== 1 || afterCta[0].href !== href || afterCta[0].label !== label || canonicalJson(after.blocks) !== canonicalJson(expectBlocks)
    || canonicalJson(after.meta) !== canonicalJson(before.meta)) {
    return fail('REPAIR_SCOPE', '수리가 CTA 셋째 칸 밖을 바꿨다')
  }
  const topic = draftTopicViolations(text, v.spec.safety?.topicForbiddenPatterns)
  if (topic.length) return fail('TEXT_FORBIDDEN', `새 문장에 글별 주제 금지 패턴이 있다: ${topic.join(',')}`)

  const newDraftHash = draftHashOf(newBytes)
  const receipt = {
    schema: CTA_REPAIR_RECEIPT_SCHEMA, slug, oldDraftHash, newDraftHash, oldText, newText: text,
    ctaLine: ctaIdx[0] + 1, href, label, approver: approver.trim(), at,
  }
  return { ok: true, plan: { slug, draftPath, oldBytes, newBytes, oldDraftHash, newDraftHash, receipt,
    receiptPath: ctaRepairReceiptPath({ draftsDir, slug, at, oldDraftHash }) } }
}

const receiptBytes = (r) => `${JSON.stringify(r, null, 2)}\n`
function leaseHeld(lease) {
  if (!lease?.ok || !lease.lease || !lease.token) return false
  try { return JSON.parse(readFileSync(lease.lease, 'utf8'))?.token === lease.token } catch { return false }
}

/** 이미 같은 수리가 끝났는가 — 영수증이 이 입력과 같고 지금 원고가 그 새 해시다 */
function alreadyRepaired(args) {
  const { draftsDir, slug, at, expectDraftHash, expectOldText, text, approver } = args
  const path = ctaRepairReceiptPath({ draftsDir, slug, at, oldDraftHash: expectDraftHash })
  if (!existsSync(path)) return null
  let r
  try { r = JSON.parse(readFileSync(path, 'utf8')) } catch { return { ok: false, code: 'RECEIPT_CONFLICT', why: `영수증을 읽지 못했다: ${path}` } }
  let now = null
  try { now = draftHashOf(readFileSync(join(draftsDir, slug, 'draft.md'))) } catch { now = null }
  const same = r?.schema === CTA_REPAIR_RECEIPT_SCHEMA && r.slug === slug && r.oldDraftHash === expectDraftHash && r.oldText === expectOldText
    && r.newText === text && r.approver === String(approver).trim() && r.at === at
  if (!same) return { ok: false, code: 'RECEIPT_CONFLICT', why: `같은 원고에 다른 수리 영수증이 있다: ${path}` }
  if (now !== r.newDraftHash) return { ok: false, code: 'RECEIPT_CONFLICT', why: '영수증의 새 원고 해시와 지금 원고가 다르다' }
  return { ok: true, written: false, idempotent: true, receipt: r, receiptPath: path, oldDraftHash: r.oldDraftHash, newDraftHash: r.newDraftHash }
}

/**
 * 미리보기(기본) · 쓰기(`write: true`).
 * `hooks.beforeWrite` · `hooks.afterWrite` · `hooks.beforeRename` 은 시험 전용(경쟁 writer · lease 상실 주입)이다.
 * @returns {{ok:true, written:boolean, preview?:boolean, idempotent?:boolean, oldDraftHash, newDraftHash, receipt, receiptPath}
 *          |{ok:false, code:string, why:string}}
 */
export function repairDraftCta(args) {
  const { write = false, hooks = {}, quarantinePath, slug } = args
  const fail = (code, why) => ({ ok: false, code, why })
  // 🔴 같은 입력 재실행 — 이미 끝났으면 쓰기 0 (원고 해시가 기대값과 달라도 영수증이 증명한다)
  const done = alreadyRepaired(args)
  if (done) return done
  const first = planCtaRepair(args)
  if (!first.ok) return first
  const p = first.plan
  if (!write) return { ok: true, written: false, preview: true, oldDraftHash: p.oldDraftHash, newDraftHash: p.newDraftHash, receipt: p.receipt, receiptPath: p.receiptPath }

  const lease = acquireManuscriptLease({ slug, work: 'cta-repair', path: quarantinePath })
  if (!lease.ok) return fail(lease.code, lease.why)
  try {
    // 🔴 lease 안에서 처음부터 다시 판정한다 — 판정 뒤 바뀐 것을 믿지 않는다
    const again = planCtaRepair(args)
    if (!again.ok) return again
    const q = again.plan
    if (q.newDraftHash !== p.newDraftHash) return fail('CONCURRENT_WRITER', 'lease 를 잡는 사이 원고가 바뀌었다')
    hooks.beforeWrite?.({ draftPath: q.draftPath, lease })
    const tmp = `${q.draftPath}.cta-repair-${process.pid}`
    try {
      const fd = openSync(tmp, 'wx')
      try { writeSync(fd, q.newBytes); fsyncSync(fd) } finally { closeSync(fd) }
    } catch (e) { try { unlinkSync(tmp) } catch { /* 없다 */ } return fail('WRITE_FAILED', `새 원고 tmp 를 쓰지 못했다: ${e?.code ?? e?.message}`) }
    hooks.beforeRename?.({ draftPath: q.draftPath, lease })
    // 🔴 교체 직전 — lease · 원고 바이트를 다시 본다. 다르면 쓰지 않는다(남의 바이트를 덮지 않는다)
    if (!leaseHeld(lease)) { try { unlinkSync(tmp) } catch { /* 없다 */ } return fail('LOCK_LOST', '교체 직전 원고 lease 소유권을 잃었다 — 원고를 건드리지 않았다') }
    let current = null
    try { current = readFileSync(q.draftPath, 'utf8') } catch { current = null }
    if (current !== q.oldBytes) { try { unlinkSync(tmp) } catch { /* 없다 */ } return fail('CONCURRENT_WRITER', '교체 직전 원고가 바뀌었다 — 그 바이트를 그대로 둔다') }
    renameSync(tmp, q.draftPath)
    hooks.afterWrite?.({ draftPath: q.draftPath, lease })
    // 🔴 교체 뒤 — 지금 바이트가 내 새 원고가 아니면 덮지도 되돌리지도 않고 멈춘다(영수증 0)
    let observed = null
    try { observed = readFileSync(q.draftPath, 'utf8') } catch { observed = null }
    if (observed !== q.newBytes) return fail('CONCURRENT_WRITER', '교체 뒤 원고가 새 바이트가 아니다 — 지금 바이트를 그대로 두고 영수증을 쓰지 않는다')
    mkdirSync(dirname(q.receiptPath), { recursive: true })
    try {
      const fd = openSync(q.receiptPath, 'wx')
      try { writeSync(fd, receiptBytes(q.receipt)); fsyncSync(fd) } finally { closeSync(fd) }
    } catch (e) {
      if (e?.code === 'EEXIST') return fail('RECEIPT_CONFLICT', `영수증 자리에 다른 기록이 있다: ${q.receiptPath} — 원고는 이미 고쳐졌다. 사람이 확인한다`)
      return fail('RECEIPT_WRITE_FAILED', `영수증을 쓰지 못했다: ${e?.code ?? e?.message} — 원고는 이미 고쳐졌다`)
    }
    return { ok: true, written: true, oldDraftHash: q.oldDraftHash, newDraftHash: q.newDraftHash, receipt: q.receipt, receiptPath: q.receiptPath }
  } finally {
    lease.release()
  }
}

/**
 * 🔴 **안전 개정과 잇기** — 수리 영수증의 새 원고 해시가 지금 원고(안전 개정이 고정할 해시)와 같은가.
 * @returns {{ok:true, receipt:object}|{ok:false, code:'CTA_REPAIR_RECEIPT_MISMATCH', why:string}}
 */
export function verifyCtaRepairReceipt({ receiptPath, slug, draftHash }) {
  const fail = (why) => ({ ok: false, code: 'CTA_REPAIR_RECEIPT_MISMATCH', why })
  let r
  try { r = JSON.parse(readFileSync(receiptPath, 'utf8')) } catch { return fail(`수리 영수증을 읽지 못했다: ${receiptPath}`) }
  if (r?.schema !== CTA_REPAIR_RECEIPT_SCHEMA || r.slug !== slug) return fail('수리 영수증의 판 · slug 가 다르다')
  if (r.newDraftHash !== draftHash) return fail(`수리 영수증의 새 원고 해시(${String(r.newDraftHash).slice(0, 19)}…)가 고정할 원고와 다르다`)
  return { ok: true, receipt: r }
}
