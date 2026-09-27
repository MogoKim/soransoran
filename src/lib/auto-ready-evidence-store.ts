/**
 * 🔴 **자동 READY 증거 — 저장 경로 둘** (2026-09-25)
 *
 *   A. **의미 검수 복원** — 사람이 결정한 기계 후보에 비어 있는 `gateResults.semanticReview` 를
 *      artifact 정본의 **기존 판정**으로 채운다. 새로 판정하지 않는다(`semanticSummaryOf` 그대로).
 *   B. **배치 검토 기록** — 검토 묶음을 본 검토자의 판정(`hardDefect`)을 출처와 함께
 *      `editDiff.evidenceReviews` 에 남긴다.
 *
 * 🔴 둘 다 **계획(plan) → 적용(apply)** 두 단계다. 계획은 읽기만 한다. 적용은 계획이 읽은
 *    스냅샷(`updatedAt` · 초안 제목·본문 · 결정 칸)이 그대로일 때만 쓴다(CAS). 다르면 0건.
 * 🔴 쓰는 칸은 하나씩이다 — A 는 `gateResults`, B 는 `editDiff`. `@updatedAt` 은 Prisma 가
 *    함께 바꾼다. `decidedBy` · `status` · `createdPostId` · Post · Persona 배정은 쓰지 않는다.
 * 🔴 같은 입력으로 다시 돌리면 바뀌는 것이 없다(idempotent) — 이미 같은 값이면 계획이 `unchanged` 다.
 */
import { Prisma, type PrismaClient } from '@prisma/client'

import {
  restoreRow, humanSampleOf, digestOf, bindingOf, bindingHolds, effectiveHumanReviews,
  EVIDENCE_REVIEW_KEY, EVIDENCE_REVIEW_CONTRACT, readEvidenceReviews,
  type ArtifactDoc, type CandidateDoc, type DecidedRow, type EvidenceReview, type HumanSampleVerdict, type RestoreClass,
} from './auto-ready-evidence'
import { HUMAN_DECIDER } from './auto-ready-v2'
import { profileOf } from './original-post-auto-publish'
import { semanticSummaryOf } from './micro-seed-supply-autofill'
import { completeReview, type ReviewAction, type ReviewRow } from './original-post-machine-review'
import { isDeclineReasonCode } from './original-post-decision'
import { withdrawOriginalPostInTx } from './original-post-withdrawal'
import {
  parseReviewerKind, isHumanReviewer, LEGACY_DECISION_MARK, NON_HUMAN_IMPORTABLE, type ReviewerKind, type HumanReviewerKind,
} from './review-provenance'
import type { EvidenceRowState, MyReview } from './auto-ready-evidence-batch-plan'

type Db = PrismaClient | Prisma.TransactionClient

const rec = (v: unknown): Record<string, unknown> =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x !== null && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort()) : x)) ?? 'undefined'

export const EVIDENCE_ROW_SELECT = {
  id: true, updatedAt: true, decidedBy: true, decidedAt: true, status: true, createdPostId: true, matchedPersonaId: true,
  matchedPersona: { select: { code: true } },
  draftTitle: true, draftBody: true, editedTitle: true, editedBody: true,
  gateVerdict: true, gateResults: true, editDiff: true, declineReason: true, promptVersion: true, model: true,
  rawContent: { select: { sourceSite: true, sourceArticleId: true, sourceCapturedAt: true } },
} as const satisfies Prisma.OriginalPostApprovalQueueSelect

export type EvidenceRow = Prisma.OriginalPostApprovalQueueGetPayload<{ select: typeof EVIDENCE_ROW_SELECT }>

export const decidedRowOf = (r: EvidenceRow): DecidedRow => ({
  id: r.id, decidedBy: r.decidedBy, draftTitle: r.draftTitle, draftBody: r.draftBody,
  gateVerdict: r.gateVerdict, gateResults: r.gateResults, editDiff: r.editDiff,
  declineReason: r.declineReason, rawSourceSite: r.rawContent.sourceSite,
  rawSourceArticleId: r.rawContent.sourceArticleId, sourceCapturedAt: r.rawContent.sourceCapturedAt,
  matchedPersonaCode: r.matchedPersona?.code ?? null,
})

/**
 * 🔴 CAS 스냅샷 — 계획이 읽은 값. 적용은 이 값이 전부 그대로일 때만 쓴다.
 * 🔴 **`updatedAt` 만으로는 모자란다** (격리 DB 실측). ms 단위라 같은 ms 안의 경쟁 수정은
 *    값이 같아 통과했다. 그래서 **쓰려는 JSON 칸 자체**(`gateResults`·`editDiff`)도 값으로 대조한다.
 */
type Snapshot = Pick<EvidenceRow, 'id' | 'updatedAt' | 'draftTitle' | 'draftBody' | 'decidedBy' | 'status' | 'createdPostId' | 'matchedPersonaId' | 'gateResults' | 'editDiff'>
const snapshotOf = (r: EvidenceRow): Snapshot => ({
  id: r.id, updatedAt: r.updatedAt, draftTitle: r.draftTitle, draftBody: r.draftBody,
  decidedBy: r.decidedBy, status: r.status, createdPostId: r.createdPostId, matchedPersonaId: r.matchedPersonaId,
  gateResults: r.gateResults, editDiff: r.editDiff,
})
const jsonIs = (v: unknown): Prisma.JsonNullableFilter => (v === null
  ? { equals: Prisma.DbNull } : { equals: v as Prisma.InputJsonValue })
const casWhere = (s: Snapshot): Prisma.OriginalPostApprovalQueueWhereInput => ({
  id: s.id, updatedAt: s.updatedAt, draftTitle: s.draftTitle, draftBody: s.draftBody,
  decidedBy: s.decidedBy, status: s.status, createdPostId: s.createdPostId, matchedPersonaId: s.matchedPersonaId,
  gateResults: { equals: s.gateResults as Prisma.InputJsonValue }, editDiff: jsonIs(s.editDiff),
})

// ─────────────────────────────────────────────────────────
// A. 의미 검수 복원
// ─────────────────────────────────────────────────────────

export const SEMANTIC_RESTORE_KEY = 'semanticRestore'
export const SEMANTIC_RESTORE_CONTRACT = 'semantic-restore-v1'

export type RestorePlanItem = {
  id: string
  klass: RestoreClass
  reasons: string[]
  /** 🔴 `write` 만 적용 대상이다. 나머지는 쓰지 않는다 */
  action: 'write' | 'unchanged' | 'skip'
  snapshot: Snapshot
  /** 🔴 이 행이 사람 정답 표본인가 — 복원과 무관하다(사람 검토 기록이 따로 있어야 한다) */
  human: HumanSampleVerdict
  /** 바뀌는 칸 — 지금은 `gateResults` 하나 */
  changes: { column: 'gateResults'; keys: string[] } | null
  nextGateResults: Record<string, unknown> | null
}

/**
 * 🔴 **복원 계획 — 읽기만 한다.** 사람 결정 표식이 있는 기계 후보 전부를 `restoreRow` 로 나눈다.
 *    `clean` 만 쓰기 대상이다 — artifact 가 정확히 한 장이고 출처·Persona·초안이 모두 같다.
 *    `warning` 은 복원해도 표본이 되지 않으므로 쓰지 않는다. 나머지 넷은 쓸 근거가 없다.
 */
export async function planSemanticRestore(
  db: Db, artifacts: ReadonlyMap<string, readonly ArtifactDoc[]>, candidates: ReadonlyMap<string, readonly CandidateDoc[]>,
  now: Date,
): Promise<RestorePlanItem[]> {
  const rows = (await db.originalPostApprovalQueue.findMany({
    where: { decidedBy: HUMAN_DECIDER }, select: EVIDENCE_ROW_SELECT, orderBy: { createdAt: 'asc' },
  })).filter((r) => profileOf({
    promptVersion: r.promptVersion, model: r.model, sourceSite: r.rawContent.sourceSite, gateResults: r.gateResults,
  } as never) === 'machine')
  return rows.map((r) => {
    const res = restoreRow(decidedRowOf(r), artifacts, candidates)
    const base = { id: r.id, klass: res.klass, reasons: res.reasons, snapshot: snapshotOf(r), human: humanSampleOf(r) }
    if (res.klass !== 'clean') return { ...base, action: 'skip' as const, changes: null, nextGateResults: null }
    const a = artifacts.get(String(rec(rec(r.gateResults).autoDraft).artifactId))![0]!
    const g = rec(r.gateResults)
    const summary = semanticSummaryOf(a.review)
    const mark = {
      contract: SEMANTIC_RESTORE_CONTRACT, artifactId: a.artifactId, artifactFile: a.file,
      reviewDigest: digestOf(stable(a.review)),
    }
    const prev = rec(g[SEMANTIC_RESTORE_KEY])
    if (stable(g.semanticReview) === stable(summary) && prev.contract === mark.contract
      && prev.artifactId === mark.artifactId && prev.reviewDigest === mark.reviewDigest) {
      return { ...base, action: 'unchanged' as const, changes: null, nextGateResults: null }
    }
    return {
      ...base, action: 'write' as const,
      changes: { column: 'gateResults' as const, keys: ['semanticReview', SEMANTIC_RESTORE_KEY] },
      nextGateResults: { ...g, semanticReview: summary, [SEMANTIC_RESTORE_KEY]: { ...mark, restoredAt: now.toISOString() } },
    }
  })
}

/** 🔴 한 건 적용 — 스냅샷이 그대로일 때만 `gateResults` 한 칸을 쓴다. 돌려주는 값은 바뀐 행 수(0|1) */
export async function applySemanticRestore(db: Db, item: RestorePlanItem): Promise<number> {
  if (item.action !== 'write' || item.nextGateResults === null) return 0
  const r = await db.originalPostApprovalQueue.updateMany({
    where: casWhere(item.snapshot),
    data: { gateResults: item.nextGateResults as Prisma.InputJsonValue },
  })
  return r.count
}

// ─────────────────────────────────────────────────────────
// B. 검토 기록 — 🔴 사람 기록과 비사람 기록의 **경로가 다르다**
// ─────────────────────────────────────────────────────────

/** 검토 묶음 한 줄 — 생성기가 쓰고 기록 경로가 대조한다 */
export type BundleItem = { queueId: string; draftTitleDigest: string; draftBodyDigest: string }

const stableNoTime = (r: EvidenceReview): string => stable({ ...r, reviewedAt: '' })

/** 🔴 기존 기록과 견주어 새 기록을 붙인다 — 같은 검토자(사람이면 같은 사용자)의 다른 기록은 덮지 않는다 */
function mergeReview(editDiff: unknown, entry: EvidenceReview):
  | { kind: 'write'; next: Record<string, unknown> } | { kind: 'unchanged' } | { kind: 'conflict' } {
  const same = readEvidenceReviews(editDiff).filter((r) => r.reviewer === entry.reviewer && r.reviewerUserId === entry.reviewerUserId)
  if (same.some((r) => stableNoTime(r) === stableNoTime(entry))) return { kind: 'unchanged' }
  if (same.length > 0) return { kind: 'conflict' }
  const ed = rec(editDiff)
  const prev = Array.isArray(ed[EVIDENCE_REVIEW_KEY]) ? ed[EVIDENCE_REVIEW_KEY] as unknown[] : []
  return { kind: 'write', next: { ...ed, [EVIDENCE_REVIEW_KEY]: [...prev, entry] } }
}

/**
 * 🔴 **사람 기록 — 덮지 않고 쌓는다(append-only)** (2026-09-25 마스터 P0).
 *    이 사용자의 **지금 결속에 맞는 최신 기록**이 같은 판정(hardDefect · 근거)이면 `unchanged`.
 *    그 밖이면 새 기록을 뒤에 붙인다 — 판정을 바꾸거나, 결속이 깨진 뒤 새 상태를 다시 검토하는 경우다.
 *    옛 기록은 지우지 않는다(이력).
 */
function appendHumanReview(editDiff: unknown, entry: EvidenceReview, row: Parameters<typeof bindingHolds>[1]):
  | { kind: 'write'; next: Record<string, unknown> } | { kind: 'unchanged' } {
  const mine = readEvidenceReviews(editDiff)
    .filter((r) => r.reviewerUserId === entry.reviewerUserId && isHumanReviewer(r.reviewer) && bindingHolds(r, row))
  const latest = effectiveHumanReviews(mine)[0]
  if (latest !== undefined && latest.hardDefect === entry.hardDefect && stable(latest.reasons) === stable(entry.reasons)) {
    return { kind: 'unchanged' }
  }
  const ed = rec(editDiff)
  const prev = Array.isArray(ed[EVIDENCE_REVIEW_KEY]) ? ed[EVIDENCE_REVIEW_KEY] as unknown[] : []
  return { kind: 'write', next: { ...ed, [EVIDENCE_REVIEW_KEY]: [...prev, entry] } }
}

const readDefect = (it: Record<string, unknown>):
  { ok: true; hardDefect: EvidenceReview['hardDefect']; reasons: string[] } | { ok: false; why: string } => {
  // 🔴 비어 있으면 unmeasured — `no` 로 읽지 않는다
  const hd = it.hardDefect === undefined || it.hardDefect === null || it.hardDefect === '' ? 'unmeasured' : it.hardDefect
  if (hd !== 'yes' && hd !== 'no' && hd !== 'unmeasured') return { ok: false, why: `hardDefect "${String(hd)}" 는 yes|no 가 아니다` }
  const reasons = Array.isArray(it.reasons) ? it.reasons.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []
  if (hd === 'yes' && reasons.length === 0) return { ok: false, why: 'hardDefect yes 인데 근거가 없다' }
  return { ok: true, hardDefect: hd, reasons }
}

// ── B-1. CLI importer — 🔴 비사람 기록만 ──

export type ReviewFile = { contract: unknown; reviewer: unknown; bundleDigest: unknown; items: unknown; reviewedAt?: unknown }

export type ImportPlanItem = {
  queueId: string
  action: 'write' | 'unchanged' | 'reject'
  why: string
  snapshot: Snapshot | null
  entry: EvidenceReview | null
  nextEditDiff: Record<string, unknown> | null
}

export type ImportPlan =
  | { ok: false; why: string; items: [] }
  | { ok: true; reviewer: ReviewerKind; items: ImportPlanItem[] }

/**
 * 🔴 **CLI 가 만들 수 있는 기록은 비사람 기록뿐이다** (2026-09-25 마스터 P0-1).
 *    파일의 `reviewer` 는 자기신고 문자열이다 — 닫힌 목록 철자가 맞아도 신원 증명이 아니다.
 *    그래서 `human:*` 이면 **파일 전체를 거절**한다. 사람 기록은 관리자 서버 경계(`recordHumanBatch`)만 쓴다.
 * 🔴 시각은 파일 값을 쓰지 않는다 — 이 프로세스의 시계(`now`)다.
 * 🔴 결과(outcome)도 파일이 정하지 않는다 — 지금 행 상태로 결속한다(`bindingOf`).
 */
export async function planNonHumanImport(
  db: Db, file: ReviewFile, bundle: { digest: string; items: readonly BundleItem[] }, now: Date,
): Promise<ImportPlan> {
  if (file.contract !== EVIDENCE_REVIEW_CONTRACT) return { ok: false, why: `contract 가 ${EVIDENCE_REVIEW_CONTRACT} 가 아니다`, items: [] }
  const reviewer = parseReviewerKind(file.reviewer)
  if (reviewer === null) return { ok: false, why: `검토자 "${String(file.reviewer)}" 는 계약 목록에 없다`, items: [] }
  if (isHumanReviewer(reviewer)) {
    return { ok: false, why: `${reviewer} 기록은 CLI 로 만들 수 없다 — 사람 검토는 관리자 화면(로그인 세션)에서만 기록한다`, items: [] }
  }
  if (!NON_HUMAN_IMPORTABLE.includes(reviewer)) return { ok: false, why: `${reviewer} 는 importer 가 쓰는 종류가 아니다`, items: [] }
  if (file.bundleDigest !== bundle.digest) return { ok: false, why: '검토 파일이 가리키는 묶음 digest 가 이 묶음과 다르다', items: [] }
  if (!Array.isArray(file.items)) return { ok: false, why: 'items 가 배열이 아니다', items: [] }
  const inBundle = new Map(bundle.items.map((b) => [b.queueId, b]))
  const out: ImportPlanItem[] = []
  const reject = (queueId: string, why: string, snapshot: Snapshot | null = null): ImportPlanItem =>
    ({ queueId, action: 'reject', why, snapshot, entry: null, nextEditDiff: null })
  const seen = new Set<string>()
  for (const raw of file.items as unknown[]) {
    const it = rec(raw)
    const queueId = typeof it.queueId === 'string' ? it.queueId : ''
    if (queueId === '') { out.push(reject('(없음)', 'queueId 가 없다')); continue }
    if (seen.has(queueId)) { out.push(reject(queueId, '같은 queueId 가 파일에 두 번 있다')); continue }
    seen.add(queueId)
    const b = inBundle.get(queueId)
    if (b === undefined) { out.push(reject(queueId, '묶음에 없는 행이다')); continue }
    if (it.draftTitleDigest !== b.draftTitleDigest || it.draftBodyDigest !== b.draftBodyDigest) {
      out.push(reject(queueId, '검토 파일의 초안 digest 가 묶음과 다르다')); continue
    }
    const d = readDefect(it)
    if (!d.ok) { out.push(reject(queueId, d.why)); continue }
    const row = await db.originalPostApprovalQueue.findUnique({ where: { id: queueId }, select: EVIDENCE_ROW_SELECT })
    if (row === null) { out.push(reject(queueId, 'DB 에 행이 없다')); continue }
    const snap = snapshotOf(row)
    if (digestOf(row.draftTitle) !== b.draftTitleDigest || digestOf(row.draftBody) !== b.draftBodyDigest) {
      out.push(reject(queueId, '묶음을 만든 뒤 DB 초안이 바뀌었다', snap)); continue
    }
    const entry: EvidenceReview = {
      contract: EVIDENCE_REVIEW_CONTRACT, reviewer, reviewerUserId: null, ...bindingOf(row),
      hardDefect: d.hardDefect, reasons: d.reasons, bundleDigest: bundle.digest, reviewedAt: now.toISOString(),
    }
    const m = mergeReview(row.editDiff, entry)
    if (m.kind === 'unchanged') { out.push({ queueId, action: 'unchanged', why: '같은 검토 기록이 이미 있다', snapshot: snap, entry, nextEditDiff: null }); continue }
    if (m.kind === 'conflict') { out.push(reject(queueId, `${reviewer} 의 다른 기록이 이미 있다 — 덮지 않는다`, snap)); continue }
    out.push({ queueId, action: 'write', why: '새 검토 기록', snapshot: snap, entry, nextEditDiff: m.next })
  }
  return { ok: true, reviewer, items: out }
}

/** 🔴 한 건 적용 — 스냅샷이 그대로일 때만 `editDiff` 한 칸을 쓴다 */
export async function applyReviewImport(db: Db, item: ImportPlanItem): Promise<number> {
  if (item.action !== 'write' || item.snapshot === null || item.nextEditDiff === null) return 0
  const r = await db.originalPostApprovalQueue.updateMany({
    where: casWhere(item.snapshot),
    data: { editDiff: item.nextEditDiff as Prisma.InputJsonValue },
  })
  return r.count
}

// ── B-2. 사람 기록 — 🔴 관리자 서버 경계의 핵심. 로그인 세션이 정한 검토자만 받는다 ──

/** 🔴 서버 경계가 세션으로 정한 검토자 — 요청 본문에서 오지 않는다 */
export type HumanActor = { userId: string; reviewer: HumanReviewerKind }

/**
 * 한 줄 입력 — 🔴 `reviewer`·`reviewedAt` 칸이 **없다.** 들어와도 읽지 않는다.
 *    결정 전 그림자면 `decision` 이 있어야 하고, 이미 결정된 행이면 없어야 한다.
 */
export type HumanBatchEntry = {
  queueId: string
  decision?: unknown
  declineReason?: unknown
  hardDefect?: unknown
  reasons?: unknown
  /** 🔴 미발행 승인 행에 결함 yes 를 기록할 때 **명시적으로** 철회한다(true 일 때만) */
  withdraw?: unknown
}

export type HumanBatchResult = { queueId: string; result: 'recorded' | 'decidedAndRecorded' | 'withdrawnAndRecorded' | 'unchanged' | 'skip' | 'reject'; why: string }

class Abort extends Error {}

/**
 * 🔴 **같은 사람 · 같은 묶음 · 같은 판정의 재제출인가** (2026-09-27 운영 P0 — 반복 클릭).
 *    결정 전 그림자에 ready·reject 를 낸 뒤 같은 요청이 한 번 더 오면, 행은 이미 사람 결정 표식이다.
 *    앞판은 이것을 "이미 결정된 행" **거절**로 돌려줘 운영자가 실패로 읽고 또 눌렀다.
 *    이 사람의 지금 결속 최신 기록이 **같은 묶음 digest · 같은 결함 · 같은 근거**이고,
 *    지금 상태가 요청한 결정(ready → 무수정 · reject/철회 → 같은 사유로 폐기)과 같으면
 *    **이미 기록됨(unchanged)** 이다 — 결정도 기록도 다시 쓰지 않는다.
 *    하나라도 다르면 null — 부르는 쪽이 그대로 거절한다(결정을 바꾸지 않는다 · 다시 폐기하지 않는다).
 */
function sameReplay(
  row: EvidenceRow, userId: string, bundleDigest: string,
  want: { decision: 'ready' | 'reject' | null; withdraw: boolean; declineReason: unknown; hardDefect: EvidenceReview['hardDefect']; reasons: string[] },
): boolean {
  const mine = readEvidenceReviews(row.editDiff)
    .filter((r) => r.reviewerUserId === userId && isHumanReviewer(r.reviewer) && bindingHolds(r, row))
  const latest = effectiveHumanReviews(mine)[0]
  if (latest === undefined || latest.bundleDigest !== bundleDigest) return false
  if (latest.hardDefect !== want.hardDefect || stable(latest.reasons) !== stable(want.reasons)) return false
  const b = bindingOf(row)
  if (want.decision === 'ready') return b.outcome === 'noEdit'
  if (want.decision === 'reject' || want.withdraw) return b.outcome === 'declined' && b.declineReason === want.declineReason
  return false
}

/** 🔴 직렬화 충돌(P2034)은 같은 행을 다시 읽어 한 번 더 잰다 — 두 번째는 대개 unchanged 로 끝난다 */
const SERIALIZATION_RETRIES = 3

/**
 * 🔴 **사람 검토 한 묶음을 기록한다 — 행마다 한 Serializable 트랜잭션.**
 *    · 이미 사람 결정 표식이 있는 행: 결정을 바꾸지 않는다. 지금 상태를 결속해 사람 기록을 붙인다
 *    · 결정 전 그림자(`machine:*`): `ready`(그대로) · `reject`(폐기) 결정을 **정본 `completeReview`** 로
 *      같은 트랜잭션 안에서 저장한 뒤, 그 결과 상태를 결속해 사람 기록을 붙인다.
 *      결정이 저장되지 않으면 기록도 없다(함께 되돌아간다).
 *    · 🔴 중대 결함을 비운 행은 건너뛴다(결정·기록 0). 사람 기록은 yes·no 를 명시한 행만 쓴다
 *    · 🔴 사람 기록은 쌓는다 — 같은 사람의 지금 판정과 같으면 unchanged, 다르면 새 기록(이력 보존)
 *    · 🔴 같은 사람 · 같은 묶음 · 같은 결정·판정의 재제출(더블 클릭 · 재시도)은 **unchanged** 다(`sameReplay`).
 *      이미 결정된 행을 다시 결정하지 않고 · 폐기된 행을 다시 폐기하지 않으며 · 기록을 두 번 붙이지 않는다.
 *      직렬화 충돌은 최대 3번 다시 읽어 잰다 — 동시 두 요청도 기록 1 · unchanged 1 로 끝난다
 *    · 🔴 `edit` 은 받지 않는다(batch edit 미지원) — 편집이 필요한 그림자는 결정 전으로 남아 표본이 아니다.
 *      수정본은 artifact 원문으로 게이트를 다시 재야 하는데
 *      그 게이트는 로컬 artifact 를 읽는다. 서버는 그 파일이 없다. 수정은 게이트가 있는
 *      기존 명령으로 먼저 저장하고, 이 경로는 그 **최종 상태**를 사람이 확정하게 한다.
 */
export async function recordHumanBatch(prisma: PrismaClient, i: {
  actor: HumanActor
  now: Date
  bundle: { digest: string; items: readonly BundleItem[] }
  entries: readonly HumanBatchEntry[]
}): Promise<HumanBatchResult[]> {
  if (!isHumanReviewer(i.actor.reviewer) || i.actor.userId.trim() === '') {
    return i.entries.map((e) => ({ queueId: e.queueId, result: 'reject' as const, why: '인증된 사람 검토자가 아니다' }))
  }
  const actorUser = await prisma.user.findUnique({ where: { id: i.actor.userId }, select: { id: true } })
  if (actorUser === null) {
    return i.entries.map((e) => ({ queueId: e.queueId, result: 'reject' as const, why: '검토자 사용자가 DB 에 없다' }))
  }
  const inBundle = new Map(i.bundle.items.map((b) => [b.queueId, b]))
  const out: HumanBatchResult[] = []
  const seen = new Set<string>()
  for (const e of i.entries) {
    const reject = (why: string): void => { out.push({ queueId: e.queueId, result: 'reject', why }) }
    if (seen.has(e.queueId)) { reject('같은 행이 두 번 있다'); continue }
    seen.add(e.queueId)
    const b = inBundle.get(e.queueId)
    if (b === undefined) { reject('묶음에 없는 행이다'); continue }
    /**
     * 🔴 **중대 결함을 비운 행은 건너뛴다 — 결정도 기록도 0** (2026-09-25 마스터 P0).
     *    앞판은 빈 값을 `unmeasured` 사람 기록으로 저장했다. 그러면 같은 사람이 나중에 yes·no 를
     *    내려도 막혔고, 다른 사람의 no 도 가렸다. 사람 표본 기록은 yes·no 를 **명시한** 행만 쓴다.
     */
    const blank = e.hardDefect === undefined || e.hardDefect === null || e.hardDefect === ''
    if (blank) { out.push({ queueId: e.queueId, result: 'skip', why: '중대 결함을 비웠다 — 기록하지 않는다(DB write 0)' }); continue }
    if (e.hardDefect !== 'yes' && e.hardDefect !== 'no') { reject(`중대 결함 "${String(e.hardDefect)}" 은 yes·no 가 아니다 — 사람 기록은 둘 중 하나만 받는다`); continue }
    const d = readDefect(e as Record<string, unknown>)
    if (!d.ok) { reject(d.why); continue }
    const decision = e.decision === undefined || e.decision === null || e.decision === '' ? null : e.decision
    if (decision !== null && decision !== 'ready' && decision !== 'reject') {
      reject(`결정 "${String(decision)}" 은 이 화면에서 받지 않는다 (ready · reject 만 — 수정은 게이트가 있는 기존 명령으로)`); continue
    }
    if (decision === 'reject' && !isDeclineReasonCode(e.declineReason)) { reject('폐기에는 사유 코드가 필요하다'); continue }
    /**
     * 🔴 **중대 결함이 있는데 발행 가능한 상태를 남기지 않는다** (2026-09-26 마스터 P0).
     *    결정 전 행에 "그대로 내보낸다" + 결함 yes 는 모순이다 — 전체 거절, write 0.
     */
    if (decision === 'ready' && d.hardDefect === 'yes') { reject('중대 결함이 있으면 그대로 내보낼 수 없다 — 폐기(사유 필수)만 받는다'); continue }
    const withdraw = e.withdraw === true
    if (withdraw && decision !== null) { reject('결정 전 행은 철회가 아니라 결정(ready·reject)으로 처리한다'); continue }
    for (let attempt = 1; ; attempt += 1) {
      try {
        const res = await prisma.$transaction(async (tx): Promise<HumanBatchResult> => {
          const row = await tx.originalPostApprovalQueue.findUnique({ where: { id: e.queueId }, select: EVIDENCE_ROW_SELECT })
          if (row === null) throw new Abort('DB 에 행이 없다')
          if (digestOf(row.draftTitle) !== b.draftTitleDigest || digestOf(row.draftBody) !== b.draftBodyDigest) {
            throw new Abort('묶음을 만든 뒤 DB 초안이 바뀌었다')
          }
          const machine = profileOf({
            promptVersion: row.promptVersion, model: row.model, sourceSite: row.rawContent.sourceSite, gateResults: row.gateResults,
          } as never) === 'machine'
          if (!machine) throw new Abort('기계 후보가 아니다')
          const decidedBy = (row.decidedBy ?? '').trim()
          let decided = false
          let withdrawn = false
          if (decidedBy.startsWith('machine:')) {
            // ── 결정 전 그림자 — 결정을 먼저 정본 경로로 저장한다 ──
            if (decision === null) throw new Abort('결정 전 행이다 — ready · reject 중 하나를 골라야 기록한다')
            if (row.createdPostId !== null) throw new Abort('이미 발행된 행이다')
            const before: ReviewRow = {
              status: row.status, createdPostId: row.createdPostId, decidedBy: row.decidedBy, updatedAt: row.updatedAt,
              title: row.editedTitle ?? row.draftTitle, body: row.editedBody ?? row.draftBody,
              promptVersion: row.promptVersion, model: row.model, gateResults: row.gateResults,
              decidedAt: row.decidedAt, editDiff: row.editDiff, declineReason: row.declineReason,
            }
            const action: ReviewAction = decision === 'reject'
              ? { decision: 'reject', declineReason: e.declineReason as string } : { decision: 'ready' }
            const v = await completeReview({
              id: row.id, before, decidedBy: LEGACY_DECISION_MARK, now: i.now, action,
              draftTitle: row.draftTitle, draftBody: row.draftBody,
              store: {
                transaction: async (fn) => fn({
                  read: async (id) => {
                    const r = await tx.originalPostApprovalQueue.findUnique({ where: { id }, select: EVIDENCE_ROW_SELECT })
                    return r === null ? null : {
                      status: r.status, createdPostId: r.createdPostId, decidedBy: r.decidedBy, updatedAt: r.updatedAt,
                      decidedAt: r.decidedAt, title: r.editedTitle ?? r.draftTitle, body: r.editedBody ?? r.draftBody,
                      promptVersion: r.promptVersion, model: r.model, gateResults: r.gateResults,
                      editDiff: r.editDiff, declineReason: r.declineReason,
                    }
                  },
                  stamp: async (s) => (await tx.originalPostApprovalQueue.updateMany({
                    where: { id: s.id, status: row.status, createdPostId: null, decidedBy: s.where.decidedBy, updatedAt: s.where.updatedAt },
                    data: {
                      decidedBy: s.decidedBy, decidedAt: s.decidedAt, status: s.patch.status as never,
                      ...(s.patch.declineReason === undefined ? {} : { declineReason: s.patch.declineReason as never }),
                    },
                  })).count,
                }),
              },
            })
            if (!v.ok) throw new Abort(`결정 저장 실패 — ${v.reason}`)
            decided = true
          } else if (decidedBy === HUMAN_DECIDER) {
            if ((decision !== null || withdraw) && sameReplay(row, i.actor.userId, i.bundle.digest, {
              decision: decision as 'ready' | 'reject' | null, withdraw, declineReason: e.declineReason, hardDefect: d.hardDefect, reasons: d.reasons,
            })) {
              return { queueId: row.id, result: 'unchanged', why: '이미 기록됐다 — 같은 묶음 · 같은 판정의 재제출이라 다시 쓰지 않는다' }
            }
            if (decision !== null) throw new Abort('이미 결정된 행이다 — 결정을 바꾸지 않는다(결과 확정만 한다)')
            /**
             * 🔴 **이미 결정된 행 — 상태별로 받는 것이 다르다** (2026-09-26 마스터 P0).
             *    · 발행됨: 결함 yes·no 모두 사후 기록만. 상태는 바꾸지 않는다(철회 불가)
             *    · 폐기됨: 결함 yes·no 기록
             *    · 승인·수정 미발행 + no: 기록
             *    · 승인·수정 미발행 + yes: **같은 트랜잭션에서 명시적 철회**(사유 필수)가 있어야 기록한다.
             *      철회가 실패하면 기록도 0 — 결함 기록과 발행 가능 상태가 공존하지 않는다
             */
            const published = row.createdPostId !== null
            const openApproved = !published && (row.status === 'APPROVED' || row.status === 'EDITED')
            if (published || row.status === 'DECLINED') {
              if (withdraw) throw new Abort(published ? '이미 발행된 글은 철회할 수 없다 — 사후 기록만 남긴다' : '이미 폐기된 글이다 — 철회할 것이 없다')
            } else if (openApproved) {
              if (d.hardDefect === 'yes') {
                if (!withdraw) throw new Abort('중대 결함이 있는 미발행 승인 글이다 — 철회와 폐기 사유를 함께 골라야 기록한다')
                const w = await withdrawOriginalPostInTx(tx, { row, reason: e.declineReason, actorUserId: i.actor.userId, now: i.now })
                if (!w.ok) throw new Abort(`철회 실패 — ${w.error}`)
                withdrawn = true
              } else if (withdraw) {
                throw new Abort('결함 없음이면 철회하지 않는다')
              }
            } else {
              throw new Abort(`상태 ${row.status} 인 행은 기록하지 않는다`)
            }
          } else {
            throw new Abort(`decidedBy=${decidedBy || '(없음)'} — 사람 결정 경로의 행이 아니다`)
          }
          // ── 결정 뒤(또는 기존) 상태를 다시 읽어 결속한다 ──
          const now = await tx.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: row.id }, select: EVIDENCE_ROW_SELECT })
          const entry: EvidenceReview = {
            contract: EVIDENCE_REVIEW_CONTRACT, reviewer: i.actor.reviewer, reviewerUserId: i.actor.userId, ...bindingOf(now),
            hardDefect: d.hardDefect, reasons: d.reasons, bundleDigest: i.bundle.digest, reviewedAt: i.now.toISOString(),
          }
          const m = appendHumanReview(now.editDiff, entry, now)
          if (m.kind === 'unchanged') return { queueId: row.id, result: 'unchanged', why: '이 사람의 지금 판정과 같다' }
          const n = await tx.originalPostApprovalQueue.updateMany({
            where: casWhere(snapshotOf(now)), data: { editDiff: m.next as Prisma.InputJsonValue },
          })
          if (n.count !== 1) throw new Abort('기록 중 행이 바뀌었다(CAS 0)')
          return { queueId: row.id, result: withdrawn ? 'withdrawnAndRecorded' : decided ? 'decidedAndRecorded' : 'recorded', why: '' }
        }, { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 20_000 })
        out.push(res)
        break
      } catch (err) {
        if (err instanceof Abort) { reject(err.message); break }
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
          if (attempt < SERIALIZATION_RETRIES) continue
          reject('직렬화 충돌 — 잠시 뒤 다시 시도해 주세요'); break
        }
        throw err
      }
    }
  }
  return out
}

/**
 * 🔴 **화면이 믿는 지금 상태 — 읽기만 한다(write 0)** (2026-09-27 운영 P0).
 *    묶음을 올릴 때와 제출 직후, 화면은 이 값으로 행마다 입력 칸을 정한다.
 *    · 이미 결정된 행은 ready · reject 칸이 **다시 나오지 않는다**(decided · recorded)
 *    · 이 사용자의 지금 결속 기록이 있으면 `recorded` — 화면이 잠근다
 *    · 묶음의 초안 digest 와 DB 가 다르면 `stale` — 새 묶음이 필요하다
 *    판정 규칙은 `recordHumanBatch` 와 같은 순서다(행 없음 → 초안 digest → 기계 후보 → 결정 경로 → 상태).
 */
export async function readHumanRowStates(db: Db, i: { userId: string; items: readonly BundleItem[] }): Promise<EvidenceRowState[]> {
  const ids = [...new Set(i.items.map((b) => b.queueId))]
  const rows = await db.originalPostApprovalQueue.findMany({ where: { id: { in: ids } }, select: EVIDENCE_ROW_SELECT })
  const byId = new Map(rows.map((r) => [r.id, r]))
  return i.items.map((b): EvidenceRowState => {
    const row = byId.get(b.queueId)
    const base = { queueId: b.queueId, status: null, decidedBy: null, published: false, outcome: null, declineReason: null, mine: null }
    if (row === undefined) return { ...base, phase: 'missing', why: 'DB 에 행이 없다' }
    const bound = bindingOf(row)
    const cur = {
      ...base, status: row.status as string, decidedBy: row.decidedBy, published: row.createdPostId !== null,
      outcome: bound.outcome, declineReason: bound.declineReason,
    }
    if (digestOf(row.draftTitle) !== b.draftTitleDigest || digestOf(row.draftBody) !== b.draftBodyDigest) {
      return { ...cur, phase: 'stale', why: '묶음을 만든 뒤 DB 초안이 바뀌었다 — 새 묶음이 필요하다' }
    }
    const machine = profileOf({
      promptVersion: row.promptVersion, model: row.model, sourceSite: row.rawContent.sourceSite, gateResults: row.gateResults,
    } as never) === 'machine'
    if (!machine) return { ...cur, phase: 'unsupported', why: '기계 후보가 아니다' }
    const decidedBy = (row.decidedBy ?? '').trim()
    if (decidedBy.startsWith('machine:')) {
      return row.createdPostId === null
        ? { ...cur, phase: 'undecided', why: '' }
        : { ...cur, phase: 'unsupported', why: '이미 발행된 행이다' }
    }
    if (decidedBy !== HUMAN_DECIDER) return { ...cur, phase: 'unsupported', why: '사람 결정 경로의 행이 아니다' }
    const published = row.createdPostId !== null
    if (!published && !['DECLINED', 'APPROVED', 'EDITED'].includes(row.status)) {
      return { ...cur, phase: 'unsupported', why: `상태 ${row.status} 인 행은 기록하지 않는다` }
    }
    const latest = effectiveHumanReviews(readEvidenceReviews(row.editDiff)
      .filter((r) => r.reviewerUserId === i.userId && isHumanReviewer(r.reviewer) && bindingHolds(r, row)))[0]
    const mine: MyReview | null = latest === undefined ? null
      : { hardDefect: latest.hardDefect, reasons: latest.reasons, reviewedAt: latest.reviewedAt, bundleDigest: latest.bundleDigest }
    return mine === null ? { ...cur, phase: 'decided', why: '' } : { ...cur, phase: 'recorded', mine, why: '' }
  })
}
