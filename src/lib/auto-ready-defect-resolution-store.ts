/**
 * 🔴 **확정 결함 해소 기록 — 쓰는 길은 이것 하나** (2026-10-01 · Lane E)
 *
 *   계획(plan) → 적용(apply) 두 단계다. 둘 다 **같은 평가 함수**(`evaluateInTx`)를 트랜잭션 안에서 돈다:
 *     ① 감사 행 · 큐 행 · 글을 읽고 해소 대상 전제를 본다(`resolvableDefectProblem`)
 *     ② 저장된 초안(`draftTitle`·`draftBody` — 감사가 묶은 발행 글과 같은 글자)에 **지금 초안 게이트**(`judgeDraftLife`)를
 *        다시 돌린다. 계획·카드·원천·시각은 부르는 쪽이 주는 `contextOf` 가 정본 파일에서 결속을 대조해 꺼낸다
 *        (이 파일은 파일을 읽지 않는다). 확정 차단(failures ≥ 1)이 아니면 기록하지 않는다
 *     ③ 기록 한 줄을 만든다 — 지금 품질 계약 판·digest · 감사 행 지문 · 큐·글 id · 초안 hash · 차단 코드 · 입력 지문
 *   적용은 Serializable 트랜잭션에서 평가를 **다시** 하고, 계획과 한 칸이라도 다르면(감사 행 지문 · 큐 `updatedAt` ·
 *   차단 코드 · 입력 지문 · 계약) **쓰지 않는다**. 쓰기는 큐 행 `updatedAt` CAS 이고, 기록은 배열에 **덧붙이기만** 한다.
 *   같은 계약·같은 감사 지문의 기록이 이미 있으면 쓰지 않는다(두 번째 적용 write 0).
 *
 * 🔴 감사 행(`AutoReadyAudit`)에는 **어떤 쓰기도 하지 않는다**. 큐 행의 다른 칸(도장 · 상태 · 초안)도 건드리지 않는다.
 * 🔴 판정은 `auto-ready-defect-resolution` 의 정본을 그대로 부른다 — 여기서 다시 세지 않는다.
 */
import { Prisma, type PrismaClient } from '@prisma/client'

import { digestOf } from './auto-ready-v2'
import {
  DEFECT_RESOLUTION_KEY, DEFECT_RESOLUTION_RECORD_VERSION, DEFECT_RESOLVER,
  auditFingerprintOf, judgeDefectResolution, resolvableDefectProblem, resolutionEntriesOf, reverifyInputDigestOf,
  type DefectResolutionRecord,
} from './auto-ready-defect-resolution'
import { DRAFT_GATE_VERSION, judgeDraftLife, type DraftGateCard, type DraftGatePlan, type DraftGateSource } from './content-core/draft-life-gates'
import { currentQualityContract } from './quality-contract'

type Tx = Prisma.TransactionClient

/** 🔴 재검증에 넣을 초안 밖의 입력 — 부르는 쪽이 정본 파일에서 결속을 대조해 꺼낸다 */
export type ReverifyContext = {
  artifactId: string
  plan: DraftGatePlan
  card: DraftGateCard
  source: DraftGateSource
  at: Date
}
export type ReverifyQueueRow = {
  id: string; decidedBy: string | null; draftTitle: string; draftBody: string; gateVerdict: string
  gateResults: unknown; editDiff: unknown; declineReason: string | null
  rawSourceSite: string; rawSourceArticleId: string; matchedPersonaCode: string | null
}
export type ContextLoader = (row: ReverifyQueueRow) => { ok: true; ctx: ReverifyContext } | { ok: false; code: string; reason: string }

export type ResolutionPlan = {
  queueId: string
  postId: string
  auditFingerprint: string
  queueUpdatedAt: string
  record: DefectResolutionRecord
}

export type Evaluation =
  | { kind: 'plan'; plan: ResolutionPlan }
  /** 🔴 같은 계약에서 이미 해소됐다 — 쓰지 않는다 */
  | { kind: 'already'; reason: string }
  | { kind: 'refuse'; code: string; reason: string }

export type ApplyOutcome =
  | { kind: 'written'; written: 1 }
  | { kind: 'already'; written: 0; reason: string }
  | { kind: 'refuse'; written: 0; code: string; reason: string }
  /** 🔴 계획과 지금이 다르다 — 그 사이 바뀌었다. 쓰지 않는다 */
  | { kind: 'changed'; written: 0; reason: string }
  | { kind: 'race'; written: 0; reason: string }

const SERIALIZABLE = { isolationLevel: 'Serializable' as const, maxWait: 5_000, timeout: 20_000 }
const rec = (v: unknown): Record<string, unknown> =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})

/** 🔴 평가 — 읽기만 한다. 계획과 적용이 같은 함수를 부른다 */
async function evaluateInTx(tx: Tx, i: { queueId: string; contextOf: ContextLoader; now: Date }): Promise<Evaluation & { updatedAt?: Date }> {
  const audit = await tx.autoReadyAudit.findUnique({ where: { queueId: i.queueId } })
  if (audit === null) return { kind: 'refuse', code: 'NO_AUDIT', reason: '감사 행이 없다' }
  const q = await tx.originalPostApprovalQueue.findUnique({
    where: { id: i.queueId },
    select: {
      id: true, status: true, decidedBy: true, createdPostId: true, updatedAt: true, draftTitle: true, draftBody: true,
      gateVerdict: true, gateResults: true, editDiff: true, declineReason: true,
      matchedPersona: { select: { code: true } }, rawContent: { select: { sourceSite: true, sourceArticleId: true } },
    },
  })
  const qr = q === null ? null : {
    id: q.id, createdPostId: q.createdPostId, draftTitle: q.draftTitle, draftBody: q.draftBody, gateResults: q.gateResults, editDiff: q.editDiff,
  }
  const pre = resolvableDefectProblem(audit, qr)
  if (pre !== null) return { kind: 'refuse', code: 'NOT_RESOLVABLE', reason: pre }
  if (q!.status !== 'PUBLISHED') return { kind: 'refuse', code: 'NOT_PUBLISHED', reason: `큐 상태 ${q!.status}` }
  const post = await tx.post.findUnique({ where: { id: audit.postId }, select: { title: true, content: true } })
  if (post === null) return { kind: 'refuse', code: 'NO_POST', reason: '감사 대상 글이 없다' }
  if (digestOf(post.title) !== audit.publishedTitleHash || digestOf(post.content) !== audit.publishedBodyHash) {
    return { kind: 'refuse', code: 'POST_CHANGED', reason: '발행 글이 감사가 묶은 글과 다르다' }
  }
  const contract = currentQualityContract()
  const already = judgeDefectResolution(audit, qr, contract)
  if (already.resolved) return { kind: 'already', reason: already.reason }

  const c = i.contextOf({
    id: q!.id, decidedBy: q!.decidedBy, draftTitle: q!.draftTitle, draftBody: q!.draftBody, gateVerdict: q!.gateVerdict,
    gateResults: q!.gateResults, editDiff: q!.editDiff, declineReason: q!.declineReason,
    rawSourceSite: q!.rawContent.sourceSite, rawSourceArticleId: q!.rawContent.sourceArticleId,
    matchedPersonaCode: q!.matchedPersona?.code ?? null,
  })
  if (!c.ok) return { kind: 'refuse', code: c.code, reason: c.reason }
  const rowArtifactId = rec(rec(q!.gateResults).autoDraft).artifactId
  if (c.ctx.artifactId !== rowArtifactId) return { kind: 'refuse', code: 'ARTIFACT_MISMATCH', reason: '재검증 문맥의 artifact 가 큐 행의 것이 아니다' }
  // 🔴 저장된 초안 그대로 — 지금 초안 게이트(확정 + 사람 검토)
  const out = judgeDraftLife({
    title: q!.draftTitle, body: q!.draftBody, plan: c.ctx.plan, card: c.ctx.card,
    context: { at: c.ctx.at, source: c.ctx.source },
  })
  const failureCodes = [...new Set(out.failures.map((f) => f.code))].sort()
  const reviewCodes = [...new Set(out.reviews.map((f) => f.code))].sort()
  if (failureCodes.length === 0) {
    return {
      kind: 'refuse', code: 'NOT_BLOCKED',
      reason: `지금 초안 게이트가 이 초안을 확정 차단하지 않는다${reviewCodes.length > 0 ? ` (사람 검토 ${reviewCodes.join(',')})` : ''} — 해소가 아니다`,
    }
  }
  const record: DefectResolutionRecord = {
    recordVersion: DEFECT_RESOLUTION_RECORD_VERSION,
    qualityContract: contract,
    audit: { queueId: audit.queueId, postId: audit.postId, fingerprint: auditFingerprintOf(audit) },
    draft: { titleHash: digestOf(q!.draftTitle), bodyHash: digestOf(q!.draftBody) },
    reverify: {
      gateVersion: DRAFT_GATE_VERSION, outcome: 'blocked', failureCodes, reviewCodes,
      inputDigest: reverifyInputDigestOf({
        plan: c.ctx.plan, card: c.ctx.card, at: c.ctx.at.toISOString(),
        source: { ...c.ctx.source, postedAt: c.ctx.source.postedAt?.toISOString() ?? null, capturedAt: c.ctx.source.capturedAt?.toISOString() ?? null },
      }),
      artifactId: c.ctx.artifactId,
    },
    resolvedAt: i.now.toISOString(),
    resolvedBy: DEFECT_RESOLVER,
  }
  return {
    kind: 'plan',
    plan: { queueId: audit.queueId, postId: audit.postId, auditFingerprint: record.audit.fingerprint, queueUpdatedAt: q!.updatedAt.toISOString(), record },
    updatedAt: q!.updatedAt,
  }
}

/** 🔴 계획 — 쓰지 않는다(dry-run 기본) */
export async function planDefectResolution(prisma: PrismaClient, i: { queueId: string; contextOf: ContextLoader; now: Date }): Promise<Evaluation> {
  const e = await prisma.$transaction((tx) => evaluateInTx(tx, i), { isolationLevel: 'RepeatableRead', maxWait: 5_000, timeout: 20_000 })
  if (e.kind === 'plan') return { kind: 'plan', plan: e.plan }
  return e
}

/** 🔴 계획과 지금 평가가 같은가 — `resolvedAt` 만 빼고 전부 */
function samePlan(a: ResolutionPlan, b: ResolutionPlan): string | null {
  if (a.queueId !== b.queueId || a.postId !== b.postId) return '다른 감사 행이다'
  if (a.auditFingerprint !== b.auditFingerprint) return '계획 뒤 감사 행이 바뀌었다'
  if (a.queueUpdatedAt !== b.queueUpdatedAt) return '계획 뒤 큐 행이 바뀌었다'
  const strip = (r: DefectResolutionRecord): string => JSON.stringify({ ...r, resolvedAt: '' })
  if (strip(a.record) !== strip(b.record)) return '계획 뒤 재검증 결과·계약·입력이 바뀌었다'
  return null
}

/**
 * 🔴 **적용** — Serializable 트랜잭션에서 다시 평가하고, 계획과 같을 때만 큐 행 `updatedAt` CAS 로 덧붙인다.
 *    부르는 쪽(러너)이 운영 DB 적용을 막는다 — 이 함수는 DB 를 고르지 않는다.
 */
export async function applyDefectResolution(prisma: PrismaClient, i: {
  plan: ResolutionPlan; contextOf: ContextLoader; now: Date
}): Promise<ApplyOutcome> {
  try {
    return await prisma.$transaction(async (tx): Promise<ApplyOutcome> => {
      const e = await evaluateInTx(tx, { queueId: i.plan.queueId, contextOf: i.contextOf, now: i.now })
      if (e.kind === 'already') return { kind: 'already', written: 0, reason: e.reason }
      if (e.kind === 'refuse') return { kind: 'refuse', written: 0, code: e.code, reason: e.reason }
      const diff = samePlan(i.plan, e.plan)
      if (diff !== null) return { kind: 'changed', written: 0, reason: diff }
      const q = await tx.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: i.plan.queueId }, select: { editDiff: true } })
      const ed = rec(q.editDiff)
      const r = await tx.originalPostApprovalQueue.updateMany({
        where: { id: i.plan.queueId, updatedAt: e.updatedAt! },
        data: {
          editDiff: {
            ...ed,
            // 🔴 덧붙이기만 — 앞 기록(옛 계약)을 지우거나 고치지 않는다
            [DEFECT_RESOLUTION_KEY]: [...resolutionEntriesOf(q.editDiff), { ...i.plan.record, resolvedAt: i.now.toISOString() }],
          } as Prisma.InputJsonValue,
        },
      })
      if (r.count !== 1) return { kind: 'changed', written: 0, reason: '쓰는 순간 큐 행이 바뀌었다' }
      return { kind: 'written', written: 1 }
    }, SERIALIZABLE)
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
      return { kind: 'race', written: 0, reason: '직렬화 충돌 — 다른 쓰기가 먼저였다' }
    }
    throw e
  }
}
