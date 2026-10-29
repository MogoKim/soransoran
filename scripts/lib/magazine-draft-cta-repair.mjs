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
 *      - 🔴 쓰기는 **복구 가능한 no-clobber transaction** 이다 (2026-10-29 Codex P1 — rename 덮어쓰기 · 급사 뒤 영수증 없음).
 *          journal(wx · fsync) → new 조각 → canonical 을 owned 로 떼어 냄 → owned = 옛 해시 재확인
 *          → new 를 canonical 에 link(no-clobber) → 영수증 link(no-clobber) · 다시 읽어 검증 → 조각 정리(journal 마지막).
 *        경쟁 writer 가 canonical 을 먼저 차지하면 덮지도 되돌리지도 않는다. 되돌릴 수 없으면 조각을 남기고
 *        CTA_REPAIR_RECOVERY_REQUIRED 로 멈춘다. 다음 실행은 lease 안에서 남은 transaction 부터 끝낸다(`settle`).
 *      - 수리 뒤 원고가 형식 계약 · 저장 전 관문 · 변환 판정(같은 파서)을 다시 지난다 — 다른 블록은 그대로다.
 *      - 영수증은 `drafts/magazine/_runs/<KST 날짜>/draft-cta-repair-<slug>-<옛 해시 앞 12>.json` 에 no-clobber 로 쓴다.
 *        같은 입력 재실행은 멱등(쓰기 0) · 다른 영수증 · 다른 원고면 fail-closed.
 *      - ChatGPT · Chrome · CDP · 네트워크 0. 재생성 0.
 */
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'

import { canonicalJson } from './magazine-article-spec.mjs'
import { BANNED_WORDS, MEDICAL_ASSERTIONS } from './magazine-brief-policy.mjs'
import {
  ARTICLE_SPEC_REGISTER_LEDGER, DIRECT_CTA_DIRECTIVE_HEAD, DIRECT_SPEC_MODE, LEGACY_DIRECT_CTA_LEAD, readDirectSpec, resolveMagazineAutoMode,
} from './magazine-direct-spec.mjs'
import { draftHashOf, draftTopicViolations, verifyDirectSpecOnDisk } from './magazine-direct-spec-source.mjs'
import { judgeManuscriptFormat } from './magazine-manuscript-format.mjs'
import { MACHINE_APPROVER } from './magazine-g8-promoter.mjs'
import { isRealKstAt } from './magazine-graph-build.mjs'
import { validateManuscript } from './magazine-manuscript-guard.mjs'
import { acquireManuscriptLease, readQuarantine } from './magazine-quarantine.mjs'

export const CTA_REPAIR_RECEIPT_SCHEMA = 'draft-cta-repair/1'
export const CTA_TEXT_MAX = 120
export const CTA_REPAIR_JOURNAL_SCHEMA = 'draft-cta-repair-journal/1'
export const CTA_REPAIR_RECOVERY_REQUIRED = 'CTA_REPAIR_RECOVERY_REQUIRED'
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SHA256_RE = /^sha256:[0-9a-f]{64}$/
const KST_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/
/** 마지막 `[CTA]` 줄의 세 칸과 그 사이 공백을 글자 그대로 나눈다 — 셋째 칸 구간만 바꾸기 위해서다 */
const CTA_LINE_RE = /^(\s*\[CTA\]\s*)([^|]*?)(\s*\|\s*)([^|]*?)(\s*\|\s*)([^|]*?)(\s*)$/

/** 수리 조각 — 이름이 고정이라 다음 실행이 찾는다. 원고와 같은 디렉터리(같은 파일 시스템)라 link 가 원자적이다 */
export function ctaRepairFragments({ draftsDir, slug }) {
  const dir = join(draftsDir, slug)
  return { dir, draft: join(dir, 'draft.md'), journal: join(dir, '.cta-repair.journal.json'), owned: join(dir, '.cta-repair.owned'),
    next: join(dir, '.cta-repair.new'), receipt: join(dir, '.cta-repair.receipt') }
}

/** 새 문장 — 수리 계획 · 영수증 검증이 같은 규칙을 쓴다 */
function newTextProblem(text, oldText) {
  if (typeof text !== 'string' || text !== text.trim() || !text || /[|\r\n]/.test(text) || [...text].length > CTA_TEXT_MAX) {
    return { code: 'TEXT_INVALID', why: `새 문장은 앞뒤 공백 · | · 줄바꿈 없는 ${CTA_TEXT_MAX}자 이하 한 줄이어야 한다` }
  }
  if (text === oldText) return { code: 'TEXT_UNCHANGED', why: '새 문장이 옛 문장과 같다 — 고칠 것이 없다' }
  if (text === LEGACY_DIRECT_CTA_LEAD || text.includes(DIRECT_CTA_DIRECTIVE_HEAD)) return { code: 'TEXT_TEMPLATE_COPY', why: '새 문장이 brief 템플릿 문구다' }
  const common = [...BANNED_WORDS, ...MEDICAL_ASSERTIONS].filter((w) => text.includes(w))
  if (common.length) return { code: 'TEXT_FORBIDDEN', why: `새 문장에 공통 금지어가 있다: ${common.join(',')}` }
  return null
}
const isHumanApprover = (a) => typeof a === 'string' && !!a.trim() && !MACHINE_APPROVER.test(a.trim())
const isPastKst = (at, nowMs) => KST_RE.test(String(at ?? '')) && isRealKstAt(at) && Date.parse(at) <= nowMs

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
  if (!SLUG_RE.test(String(slug ?? ''))) return fail('SLUG_REQUIRED', 'slug 가 kebab-case 가 아니다')
  if (!SHA256_RE.test(String(expectDraftHash ?? ''))) return fail('EXPECT_HASH_INVALID', '--expect-draft-hash 는 sha256:<64 hex> 여야 한다')
  if (typeof expectOldText !== 'string' || !expectOldText) return fail('EXPECT_OLD_TEXT_REQUIRED', '--expect-old-text 가 비었다')
  if (typeof approver !== 'string' || !approver.trim()) return fail('APPROVER_REQUIRED', '승인자가 비었다')
  if (!isHumanApprover(approver)) return fail('APPROVER_MACHINE', `기계 승인 표식이다: ${approver}`)
  if (!KST_RE.test(String(at ?? '')) || !isRealKstAt(at)) return fail('AT_INVALID', '--at 은 초까지 포함한 실제 KST(+09:00) 시각이어야 한다')
  if (Date.parse(at) > nowMs) return fail('AT_FUTURE', '--at 이 지금보다 뒤다')
  // ── 새 문장 ──
  const tp = newTextProblem(text, expectOldText)
  if (tp) return fail(tp.code, tp.why)

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
const journalBytes = (j) => `${JSON.stringify(j, null, 2)}\n`
const RECEIPT_KEYS = ['approver', 'at', 'ctaLine', 'href', 'label', 'newDraftHash', 'newText', 'oldDraftHash', 'oldText', 'schema', 'slug']
const JOURNAL_KEYS = [...RECEIPT_KEYS, 'receiptPath'].sort()
function leaseHeld(lease) {
  if (!lease?.ok || !lease.lease || !lease.token) return false
  try { return JSON.parse(readFileSync(lease.lease, 'utf8'))?.token === lease.token } catch { return false }
}
/** 없으면 null — 그 밖의 읽기 오류는 던진다(없는 것과 못 읽은 것을 섞지 않는다) */
function readOr(path) {
  try { return readFileSync(path) } catch (e) { if (e?.code === 'ENOENT') return null; throw e }
}
const hashOr = (bytes) => (bytes === null ? null : draftHashOf(bytes))
function fsyncDir(dir) {
  try { const fd = openSync(dir, 'r'); try { fsyncSync(fd) } finally { closeSync(fd) } } catch { /* 디렉터리 fsync 를 못 하는 파일 시스템 */ }
}
/** 고정 조각을 wx 로 끝까지 쓰고 fsync 한다. 내가 만든 조각이 쓰다 실패하면 그 조각만 지운다 */
function writeFragment(path, bytes, tag, step) {
  step(`${tag}:open`)
  const fd = openSync(path, 'wx')
  try {
    try { step(`${tag}:write`); writeSync(fd, bytes); step(`${tag}:fsync`); fsyncSync(fd) } finally { closeSync(fd) }
  } catch (e) { try { unlinkSync(path) } catch { /* 없다 */ } throw e }
}

/**
 * 🔴 영수증이 **그 자체로 완전한 수리 증거**인가 — exact schema · 필드 집합 · 해시 형식 · 문장 · CTA 행 · href · label · 사람 승인자 · 실제 KST.
 * @returns {string|null} 문제 설명(없으면 null)
 */
function receiptProblem(r, nowMs) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return '영수증이 객체가 아니다'
  const keys = Object.keys(r).sort()
  if (keys.join(',') !== RECEIPT_KEYS.join(',')) return `필드 집합이 다르다: ${keys.join(',')}`
  if (r.schema !== CTA_REPAIR_RECEIPT_SCHEMA) return `판이 ${CTA_REPAIR_RECEIPT_SCHEMA} 가 아니다`
  if (!SHA256_RE.test(String(r.oldDraftHash)) || !SHA256_RE.test(String(r.newDraftHash)) || r.oldDraftHash === r.newDraftHash) return '옛 · 새 원고 해시 형식이 아니다'
  if (typeof r.oldText !== 'string' || !r.oldText || /[|\r\n]/.test(r.oldText)) return '옛 문장이 CTA 셋째 칸 모양이 아니다'
  const tp = newTextProblem(r.newText, r.oldText)
  if (tp) return `새 문장: ${tp.why}`
  if (!Number.isInteger(r.ctaLine) || r.ctaLine < 1) return 'CTA 행이 1 이상 정수가 아니다'
  if (typeof r.href !== 'string' || !/^\/[^\s|]*$/.test(r.href)) return 'href 가 내부 경로가 아니다'
  if (typeof r.label !== 'string' || !r.label || r.label !== r.label.trim() || /[|\r\n]/.test(r.label)) return 'label 모양이 아니다'
  if (!isHumanApprover(r.approver) || r.approver !== r.approver.trim()) return `사람 승인자가 아니다: ${JSON.stringify(r.approver)}`
  if (!isPastKst(r.at, nowMs)) return `at 이 지난 실제 KST 시각이 아니다: ${JSON.stringify(r.at)}`
  return null
}

/** 이미 같은 수리가 끝났는가 — 영수증이 이 입력과 같고 지금 원고가 그 새 해시다 */
function alreadyRepaired(args) {
  const { draftsDir, slug, at, expectDraftHash, expectOldText, text, approver, nowMs = Date.now() } = args
  const path = ctaRepairReceiptPath({ draftsDir, slug, at, oldDraftHash: expectDraftHash })
  if (!existsSync(path)) return null
  let r
  try { r = JSON.parse(readFileSync(path, 'utf8')) } catch { return { ok: false, code: 'RECEIPT_CONFLICT', why: `영수증을 읽지 못했다: ${path}` } }
  const bad = receiptProblem(r, nowMs)
  if (bad) return { ok: false, code: 'RECEIPT_CONFLICT', why: `영수증이 완전한 수리 증거가 아니다 (${bad}): ${path}` }
  let now = null
  try { now = draftHashOf(readFileSync(join(draftsDir, slug, 'draft.md'))) } catch { now = null }
  const same = r.slug === slug && r.oldDraftHash === expectDraftHash && r.oldText === expectOldText
    && r.newText === text && r.approver === String(approver).trim() && r.at === at
  if (!same) return { ok: false, code: 'RECEIPT_CONFLICT', why: `같은 원고에 다른 수리 영수증이 있다: ${path}` }
  if (now !== r.newDraftHash) return { ok: false, code: 'RECEIPT_CONFLICT', why: '영수증의 새 원고 해시와 지금 원고가 다르다' }
  return { ok: true, written: false, idempotent: true, receipt: r, receiptPath: path, oldDraftHash: r.oldDraftHash, newDraftHash: r.newDraftHash }
}

const receiptOfJournal = (j) => ({ schema: CTA_REPAIR_RECEIPT_SCHEMA, slug: j.slug, oldDraftHash: j.oldDraftHash, newDraftHash: j.newDraftHash,
  oldText: j.oldText, newText: j.newText, ctaLine: j.ctaLine, href: j.href, label: j.label, approver: j.approver, at: j.at })

/** journal 을 읽고 신원을 고정한다 — 이 slug · 이 drafts 루트의 그 영수증 자리만. 하나라도 어긋나면 아무것도 쓰거나 지우지 않는다 */
function readJournal({ F, draftsDir, slug, nowMs }) {
  let j
  try { j = JSON.parse(readFileSync(F.journal, 'utf8')) } catch (e) { return { ok: false, why: `journal 을 읽지 못했다 (${e?.code ?? e?.message})` } }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, why: 'journal 이 객체가 아니다' }
  if (Object.keys(j).sort().join(',') !== JOURNAL_KEYS.join(',') || j.schema !== CTA_REPAIR_JOURNAL_SCHEMA) return { ok: false, why: 'journal 판 · 필드 집합이 다르다' }
  if (j.slug !== slug) return { ok: false, why: `journal slug(${j.slug})가 이 원고가 아니다` }
  const bad = receiptProblem(receiptOfJournal(j), nowMs)
  if (bad) return { ok: false, why: `journal 이 완전한 수리 기록이 아니다: ${bad}` }
  if (j.receiptPath !== relative(draftsDir, ctaRepairReceiptPath({ draftsDir, slug, at: j.at, oldDraftHash: j.oldDraftHash }))) return { ok: false, why: 'journal 의 영수증 자리가 정해진 자리가 아니다' }
  return { ok: true, journal: j }
}

/**
 * 🔴 **남은 transaction 을 끝낸다** (lease 안에서만). journal 에 적힌 옛 · 새 해시와 조각을 대조한다.
 *    - canonical 없음 + owned(옛) → owned 를 no-clobber 로 되돌린 뒤 아래 「옛」으로
 *    - canonical 옛 → 조각을 치운다(다시 수리 가능)
 *    - canonical 새 + 영수증 없음 → journal 로 영수증 완성 · 검증 → 정리
 *    - canonical 새 + 영수증 일치 → 정리
 *    - canonical 외부 바이트 · 조각 해시 불일치 · 영수증 자리 다른 기록 → 아무것도 지우지 않고 RECOVERY_REQUIRED
 */
function settle({ F, j, draftsDir, lease, step, nowMs }) {
  const hold = (why) => ({ ok: false, code: CTA_REPAIR_RECOVERY_REQUIRED, why: `${why} — journal · 조각을 그대로 두었다. 사람이 확인한다` })
  if (!leaseHeld(lease)) return { ok: false, code: 'LOCK_LOST', why: '복구 중 원고 lease 소유권을 잃었다 — 조각을 그대로 두었다' }
  if (hashOr(readOr(F.owned)) !== null && hashOr(readOr(F.owned)) !== j.oldDraftHash) return hold('owned 조각이 journal 의 옛 원고가 아니다')
  if (hashOr(readOr(F.next)) !== null && hashOr(readOr(F.next)) !== j.newDraftHash) return hold('new 조각이 journal 의 새 원고가 아니다')
  const expected = receiptBytes(receiptOfJournal(j))
  const frag = readOr(F.receipt)
  if (frag !== null && frag.toString('utf8') !== expected) return hold('receipt 조각이 journal 의 영수증이 아니다')
  const receiptAbs = join(draftsDir, j.receiptPath)
  const clean = () => {
    for (const p of [F.receipt, F.owned, F.next, F.journal]) { try { unlinkSync(p) } catch (e) { if (e?.code !== 'ENOENT') throw e } }
    fsyncDir(F.dir)
  }
  let canon = hashOr(readOr(F.draft))
  if (canon === null) {
    if (!existsSync(F.owned)) return hold('canonical 원고와 owned 조각이 모두 없다')
    // 떼어 낸 뒤 멈췄다 — 옛 원고를 no-clobber 로 되돌린다(그 사이 누가 canonical 을 차지했으면 덮지 않는다)
    try { step('restore:link'); linkSync(F.owned, F.draft) } catch (e) { return hold(`옛 원고를 canonical 로 되돌리지 못했다 (${e?.code ?? e?.message})`) }
    fsyncDir(F.dir)
    canon = hashOr(readOr(F.draft))
  }
  if (canon === j.oldDraftHash) {
    if (existsSync(receiptAbs)) return hold('원고는 옛 바이트인데 영수증 자리에 기록이 있다')
    clean()
    return { ok: true, state: 'RESTORED_OLD' }
  }
  if (canon !== j.newDraftHash) return hold('canonical 원고가 journal 의 옛 · 새 원고 어느 쪽도 아니다 (외부 바이트)')
  // ── 새 원고가 놓였다 — 영수증을 완성한다 ──
  if (!leaseHeld(lease)) return { ok: false, code: 'LOCK_LOST', why: '영수증 직전 원고 lease 소유권을 잃었다 — 조각을 그대로 두었다' }
  const existing = readOr(receiptAbs)
  if (existing === null) {
    try {
      if (frag !== null) unlinkSync(F.receipt)
      writeFragment(F.receipt, expected, 'receipt', step)
      mkdirSync(dirname(receiptAbs), { recursive: true })
      step('receipt:link')
      linkSync(F.receipt, receiptAbs)
      fsyncDir(dirname(receiptAbs))
    } catch (e) {
      if (e?.code === 'EEXIST') return hold(`영수증 자리를 다른 기록이 먼저 차지했다: ${receiptAbs}`)
      return { ok: false, code: 'RECEIPT_WRITE_FAILED', why: `영수증을 쓰지 못했다 (${e?.code ?? e?.message}) — 원고는 새 바이트다. journal 을 남겼다 — 다음 --write 가 영수증을 완성한다` }
    }
    step('receipt:written')
  } else if (existing.toString('utf8') !== expected) return hold(`영수증 자리에 journal 과 다른 기록이 있다: ${receiptAbs}`)
  // 🔴 다시 읽어 검증한다 — 영수증 자체 · 지금 원고. 둘 다 맞을 때만 조각을 치운다
  const v = verifyCtaRepairReceipt({ receiptPath: receiptAbs, slug: j.slug, draftHash: j.newDraftHash, nowMs })
  if (!v.ok || readOr(receiptAbs)?.toString('utf8') !== expected) return hold(`쓴 영수증이 검증을 지나지 않는다: ${v.why ?? '바이트가 다르다'}`)
  step('receipt:verified')
  if (hashOr(readOr(F.draft)) !== j.newDraftHash) return hold('정리 직전 canonical 원고가 새 원고가 아니다')
  clean()
  return { ok: true, state: 'COMPLETED', receipt: v.receipt, receiptPath: receiptAbs }
}

/** 쓰기 transaction — lease 안 · 계획을 마친 뒤에만 부른다 */
function commit({ q, F, draftsDir, lease, step, nowMs }) {
  const fail = (code, why) => ({ ok: false, code, why })
  const hold = (why) => fail(CTA_REPAIR_RECOVERY_REQUIRED, `${why} — journal · 조각을 그대로 두었다. 사람이 확인한다`)
  const journal = { ...receiptOfJournal({ ...q.receipt }), schema: CTA_REPAIR_JOURNAL_SCHEMA, receiptPath: relative(draftsDir, q.receiptPath) }
  // ① journal — 이것이 있어야 다음 실행이 무엇을 하던 중인지 안다
  if (!leaseHeld(lease)) return fail('LOCK_LOST', 'journal 직전 원고 lease 소유권을 잃었다 — 아무것도 쓰지 않았다')
  try { writeFragment(F.journal, journalBytes(journal), 'journal', step) } catch (e) { return fail('WRITE_FAILED', `journal 을 쓰지 못했다 (${e?.code ?? e?.message}) — 원고를 건드리지 않았다`) }
  fsyncDir(F.dir)
  step('journal:written')
  const back = (code, why) => {
    const s = settle({ F, j: journal, draftsDir, lease, step, nowMs })
    return s.ok ? fail(code, `${why} — 옛 원고 그대로 · 조각을 치웠다`) : s
  }
  // ② new 조각
  try { writeFragment(F.next, q.newBytes, 'new', step) } catch (e) { return back('WRITE_FAILED', `새 원고 조각을 쓰지 못했다 (${e?.code ?? e?.message})`) }
  // ③ canonical 을 owned 로 떼어 낸다 — 이 뒤로 canonical 자리는 비어 있고, 누가 차지하면 그 바이트는 남의 것이다
  step('detach:before')
  if (!leaseHeld(lease)) return fail('LOCK_LOST', '떼어 내기 직전 원고 lease 소유권을 잃었다 — 원고를 건드리지 않았다(조각은 다음 실행이 치운다)')
  try { renameSync(F.draft, F.owned) } catch (e) { return hold(`canonical 원고를 떼어 내지 못했다 (${e?.code ?? e?.message})`) }
  fsyncDir(F.dir)
  step('detached')
  // ④ 떼어 낸 바이트가 계획한 옛 원고인가 — 아니면 경쟁 writer 의 바이트다. no-clobber 로 제자리에 돌려놓는다
  if (hashOr(readOr(F.owned)) !== q.oldDraftHash) {
    try { linkSync(F.owned, F.draft) } catch (e) { return hold(`떼어 낸 경쟁 writer 바이트를 제자리에 되돌리지 못했다 (${e?.code ?? e?.message})`) }
    unlinkSync(F.owned)
    for (const p of [F.next, F.journal]) { try { unlinkSync(p) } catch { /* 없다 */ } }
    fsyncDir(F.dir)
    return fail('CONCURRENT_WRITER', '떼어 낸 원고가 계획한 옛 원고가 아니다 — 그 바이트를 제자리에 두었다')
  }
  // ⑤ 새 원고를 no-clobber link 로 놓는다 — 덮어쓰기 rename 을 쓰지 않는다
  step('install:before')
  if (!leaseHeld(lease)) {
    // lease 없이는 지우지 않는다 — 옛 원고만 no-clobber 로 제자리에 놓는다(그 사이 누가 차지했으면 그대로 둔다)
    try { linkSync(F.owned, F.draft) } catch { /* 차지했다 — 덮지 않는다 */ }
    return fail('LOCK_LOST', '설치 직전 원고 lease 소유권을 잃었다 — 옛 원고를 no-clobber 로 되돌려 놓고 조각을 남겼다(다음 실행이 치운다)')
  }
  try { step('install:link'); linkSync(F.next, F.draft) } catch (e) {
    if (e?.code === 'EEXIST') return hold('경쟁 writer 가 canonical 자리를 먼저 차지했다 — 덮지도 되돌리지도 않는다')
    return back('INSTALL_FAILED', `새 원고를 놓지 못했다 (${e?.code ?? e?.message})`)
  }
  fsyncDir(F.dir)
  step('installed')
  // ⑥ 영수증 · 검증 · 정리 — canonical 이 새 원고인지는 settle 이 판정한다(아니면 RECOVERY_REQUIRED)
  const s = settle({ F, j: journal, draftsDir, lease, step, nowMs })
  if (!s.ok) return s
  return { ok: true, written: true, oldDraftHash: q.oldDraftHash, newDraftHash: q.newDraftHash, receipt: q.receipt, receiptPath: q.receiptPath }
}

const pendingFragments = (F) => [F.journal, F.owned, F.next, F.receipt].filter((p) => existsSync(p)).map((p) => basename(p))

/**
 * 🔴 **CTA 수리 transaction 이 남았는가 — 읽기만 한다** (2026-10-29 Codex P1).
 *    떼어 낸 뒤 급사하면 draft.md 가 잠시 없다 — producer plan 이 이것을 「회수 필요」로 읽으면 같은 글을 다시 보낸다.
 *    producer plan · fetchSlug · fetchBatch · recoverSlug · auto-register 가 **이 함수 하나**로 그 slug 를 HOLD 한다.
 *    🔴 지우지도 복구하지도 않는다 — settle 은 명시적 CTA repair `--write` 와 그 lease 에만 있다.
 *    🔴 이 transaction 의 고정 조각(journal · owned · new · 내부 receipt)만 본다 — 정상 완료 영수증(_runs)은 조각이 아니다.
 * @returns {{pending:false}|{pending:true, code:'CTA_REPAIR_PENDING'|'CTA_REPAIR_RECOVERY_REQUIRED', why:string, fragments:string[]}}
 */
export function ctaRepairPendingState({ draftsDir, slug, nowMs = Date.now() }) {
  if (!SLUG_RE.test(String(slug ?? ''))) return { pending: false }
  const F = ctaRepairFragments({ draftsDir, slug })
  const fragments = pendingFragments(F)
  if (!fragments.length) return { pending: false }
  const hold = (why) => ({ pending: true, code: CTA_REPAIR_RECOVERY_REQUIRED, fragments,
    why: `${why} — CTA 수리 조각(${fragments.join(', ')})을 사람이 확인한다. 아무것도 지우지 않았다` })
  if (!existsSync(F.journal)) return hold('journal 없이 CTA 수리 조각이 있다')
  try {
    const rj = readJournal({ F, draftsDir, slug, nowMs })
    if (!rj.ok) return hold(rj.why)
    const j = rj.journal
    const owned = hashOr(readOr(F.owned))
    const next = hashOr(readOr(F.next))
    const canon = hashOr(readOr(F.draft))
    if (owned !== null && owned !== j.oldDraftHash) return hold('owned 조각이 journal 의 옛 원고가 아니다')
    if (next !== null && next !== j.newDraftHash) return hold('new 조각이 journal 의 새 원고가 아니다')
    if (canon === null && owned === null) return hold('canonical 원고와 owned 조각이 모두 없다')
    if (canon !== null && canon !== j.oldDraftHash && canon !== j.newDraftHash) return hold('canonical 원고가 journal 의 옛 · 새 원고 어느 쪽도 아니다 (외부 바이트)')
  } catch (e) {
    return hold(`CTA 수리 조각을 읽지 못했다 (${e?.code ?? e?.message})`)
  }
  return { pending: true, code: 'CTA_REPAIR_PENDING', fragments,
    why: `끝나지 않은 CTA 수리 transaction 이 있다 (${fragments.join(', ')}) — magazine:draft-cta-repair --write 가 lease 안에서 먼저 끝낸다` }
}

/**
 * 미리보기(기본) · 쓰기(`write: true`).
 * `hooks.fault(stage)` 는 시험 전용이다 — 던지면 그 단계의 실패, 멈추면(SIGKILL) 그 단계 뒤의 급사, 쓰면 경쟁 writer 다.
 * @returns {{ok:true, written:boolean, preview?:boolean, idempotent?:boolean, recovered?:string, oldDraftHash, newDraftHash, receipt, receiptPath}
 *          |{ok:false, code:string, why:string}}
 */
export function repairDraftCta(args) {
  const { write = false, hooks = {}, quarantinePath, slug, draftsDir, nowMs = Date.now() } = args
  const fail = (code, why) => ({ ok: false, code, why })
  if (!SLUG_RE.test(String(slug ?? ''))) return fail('SLUG_REQUIRED', 'slug 가 kebab-case 가 아니다')
  const F = ctaRepairFragments({ draftsDir, slug })
  const step = (stage) => hooks.fault?.(stage)
  if (!write) {
    // 미리보기는 쓰지 않는다 — 남은 transaction 은 복구하지 않고 알리기만 한다
    const pending = pendingFragments(F)
    if (pending.length) return fail('CTA_REPAIR_PENDING', `끝나지 않은 수리 조각이 있다 (${pending.join(', ')}) — --write 실행이 lease 안에서 먼저 복구한다`)
    const done = alreadyRepaired(args)
    if (done) return done
    const first = planCtaRepair(args)
    if (!first.ok) return first
    const p = first.plan
    return { ok: true, written: false, preview: true, oldDraftHash: p.oldDraftHash, newDraftHash: p.newDraftHash, receipt: p.receipt, receiptPath: p.receiptPath }
  }

  const lease = acquireManuscriptLease({ slug, work: 'cta-repair', path: quarantinePath })
  if (!lease.ok) return fail(lease.code, lease.why)
  try {
    // 🔴 남은 transaction 부터 끝낸다 — 그 전에는 새 수리를 시작하지 않는다
    let recovered = null
    if (existsSync(F.journal)) {
      const rj = readJournal({ F, draftsDir, slug, nowMs })
      if (!rj.ok) return fail(CTA_REPAIR_RECOVERY_REQUIRED, `${rj.why} — journal · 조각을 그대로 두었다. 사람이 확인한다`)
      const s = settle({ F, j: rj.journal, draftsDir, lease, step, nowMs })
      if (!s.ok) return s
      recovered = s.state
    } else {
      const stray = pendingFragments(F)
      if (stray.length) return fail(CTA_REPAIR_RECOVERY_REQUIRED, `journal 없이 수리 조각이 있다 (${stray.join(', ')}) — 지우지 않는다. 사람이 확인한다`)
    }
    const tag = (r) => (recovered ? { ...r, recovered } : r)
    const done = alreadyRepaired(args)
    if (done) return tag(done)
    // 🔴 lease 안에서 처음부터 다시 판정한다 — 판정 뒤 바뀐 것을 믿지 않는다
    const again = planCtaRepair(args)
    if (!again.ok) return tag(again)
    return tag(commit({ q: again.plan, F, draftsDir, lease, step, nowMs }))
  } finally {
    lease.release()
  }
}

/**
 * 🔴 **안전 개정과 잇기** — 영수증이 그 자체로 완전한 수리 증거이고(P2), 새 원고 해시가 지금 원고(안전 개정이 고정할 해시)와 같은가.
 *    영수증 파일 이름 · 날짜 폴더도 영수증 내용(slug · 옛 해시 · at)이 정한 자리여야 한다.
 * @returns {{ok:true, receipt:object}|{ok:false, code:'CTA_REPAIR_RECEIPT_MISMATCH', why:string}}
 */
export function verifyCtaRepairReceipt({ receiptPath, slug, draftHash, nowMs = Date.now() }) {
  const fail = (why) => ({ ok: false, code: 'CTA_REPAIR_RECEIPT_MISMATCH', why })
  let r
  try { r = JSON.parse(readFileSync(receiptPath, 'utf8')) } catch { return fail(`수리 영수증을 읽지 못했다: ${receiptPath}`) }
  const bad = receiptProblem(r, nowMs)
  if (bad) return fail(`수리 영수증이 완전한 수리 증거가 아니다: ${bad}`)
  if (r.slug !== slug) return fail('수리 영수증의 slug 가 다르다')
  const place = ctaRepairReceiptPath({ draftsDir: '', slug: r.slug, at: r.at, oldDraftHash: r.oldDraftHash })
  if (basename(receiptPath) !== basename(place) || basename(dirname(receiptPath)) !== basename(dirname(place))) return fail('수리 영수증이 정해진 자리(날짜 폴더 · 이름)에 있지 않다')
  if (r.newDraftHash !== draftHash) return fail(`수리 영수증의 새 원고 해시(${String(r.newDraftHash).slice(0, 19)}…)가 고정할 원고와 다르다`)
  return { ok: true, receipt: r }
}
