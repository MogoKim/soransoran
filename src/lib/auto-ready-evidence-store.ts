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
  restoreRow, humanSampleOf, digestOf, EVIDENCE_REVIEW_KEY, EVIDENCE_REVIEW_CONTRACT, readEvidenceReviews,
  type ArtifactDoc, type CandidateDoc, type DecidedRow, type EvidenceReview, type HumanSampleVerdict, type RestoreClass,
} from './auto-ready-evidence'
import { HUMAN_DECIDER } from './auto-ready-v2'
import { profileOf } from './original-post-auto-publish'
import { semanticSummaryOf } from './micro-seed-supply-autofill'
import { parseReviewerKind, type ReviewerKind } from './review-provenance'

type Db = PrismaClient | Prisma.TransactionClient

const rec = (v: unknown): Record<string, unknown> =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x !== null && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort()) : x)) ?? 'undefined'

export const EVIDENCE_ROW_SELECT = {
  id: true, updatedAt: true, decidedBy: true, status: true, createdPostId: true, matchedPersonaId: true,
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
    const base = { id: r.id, klass: res.klass, reasons: res.reasons, snapshot: snapshotOf(r), human: humanSampleOf(decidedRowOf(r)) }
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
// B. 배치 검토 기록
// ─────────────────────────────────────────────────────────

/** 검토 묶음 한 줄 — 생성기가 쓰고 importer 가 대조한다 */
export type BundleItem = { queueId: string; draftTitleDigest: string; draftBodyDigest: string }

/** 검토자가 돌려준 파일 */
export type ReviewFile = {
  contract: unknown
  reviewer: unknown
  bundleDigest: unknown
  reviewedAt: unknown
  items: unknown
}

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
 * 🔴 **검토 기록 계획 — 읽기만 한다.**
 *    · 검토자 종류는 닫힌 목록과 **정확히** 같아야 한다 — 아니면 파일 전체를 거절한다
 *    · 파일이 가리키는 묶음 digest 가 실제 묶음과 같아야 한다
 *    · 각 줄의 초안 digest 가 묶음과 **지금 DB** 모두와 같아야 한다 — 그 사이 초안이 바뀌면 거절
 *    · `hardDefect` 가 비었으면 `unmeasured` 다(`no` 가 아니다). 모르는 값이면 그 줄을 거절한다
 *    · 같은 검토자의 기록이 이미 있으면: 같으면 `unchanged`, 다르면 **덮지 않고 거절**
 */
export async function planReviewImport(
  db: Db, file: ReviewFile, bundle: { digest: string; items: readonly BundleItem[] },
): Promise<ImportPlan> {
  if (file.contract !== EVIDENCE_REVIEW_CONTRACT) return { ok: false, why: `contract 가 ${EVIDENCE_REVIEW_CONTRACT} 가 아니다`, items: [] }
  const reviewer = parseReviewerKind(file.reviewer)
  if (reviewer === null) return { ok: false, why: `검토자 "${String(file.reviewer)}" 는 계약 목록에 없다`, items: [] }
  if (file.bundleDigest !== bundle.digest) return { ok: false, why: '검토 파일이 가리키는 묶음 digest 가 이 묶음과 다르다', items: [] }
  if (typeof file.reviewedAt !== 'string' || Number.isNaN(Date.parse(file.reviewedAt))) {
    return { ok: false, why: 'reviewedAt 이 시각이 아니다', items: [] }
  }
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
    const hd = it.hardDefect === undefined || it.hardDefect === null ? 'unmeasured' : it.hardDefect
    if (hd !== 'yes' && hd !== 'no' && hd !== 'unmeasured') { out.push(reject(queueId, `hardDefect "${String(hd)}" 는 yes|no 가 아니다`)); continue }
    const reasons = Array.isArray(it.reasons) ? it.reasons.filter((x): x is string => typeof x === 'string') : []
    if (hd === 'yes' && reasons.length === 0) { out.push(reject(queueId, 'hardDefect yes 인데 근거가 없다')); continue }
    const row = await db.originalPostApprovalQueue.findUnique({ where: { id: queueId }, select: EVIDENCE_ROW_SELECT })
    if (row === null) { out.push(reject(queueId, 'DB 에 행이 없다')); continue }
    const snap = snapshotOf(row)
    if (digestOf(row.draftTitle) !== b.draftTitleDigest || digestOf(row.draftBody) !== b.draftBodyDigest) {
      out.push(reject(queueId, '묶음을 만든 뒤 DB 초안이 바뀌었다', snap)); continue
    }
    const entry: EvidenceReview = {
      contract: EVIDENCE_REVIEW_CONTRACT, reviewer, draftTitleDigest: b.draftTitleDigest, draftBodyDigest: b.draftBodyDigest,
      hardDefect: hd, reasons, bundleDigest: bundle.digest, reviewedAt: file.reviewedAt,
    }
    const existing = readEvidenceReviews(row.editDiff).filter((r) => r.reviewer === reviewer)
    if (existing.some((r) => stable(r) === stable(entry))) {
      out.push({ queueId, action: 'unchanged', why: '같은 검토 기록이 이미 있다', snapshot: snap, entry, nextEditDiff: null }); continue
    }
    if (existing.length > 0) { out.push(reject(queueId, `${reviewer} 의 다른 기록이 이미 있다 — 덮지 않는다`, snap)); continue }
    const ed = rec(row.editDiff)
    const prev = Array.isArray(ed[EVIDENCE_REVIEW_KEY]) ? ed[EVIDENCE_REVIEW_KEY] as unknown[] : []
    out.push({
      queueId, action: 'write', why: '새 검토 기록', snapshot: snap, entry,
      nextEditDiff: { ...ed, [EVIDENCE_REVIEW_KEY]: [...prev, entry] },
    })
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
