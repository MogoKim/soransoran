/**
 * 🔴 **확정 결함 해소 — 운영 승인 결속** (2026-10-02 · Phase G)
 *
 *   dry-run 이 결정적 계획 지문(`defectPlanDigestOf`)과 기대 상태(미해소 결함 수 지금:적용 뒤)를 낸다.
 *   운영 apply 는 그 둘과 reason 이 **지금 다시 잰 값과 같을 때만** 정본 쓰기(`applyDefectResolution`)를 부른다.
 *
 * 🔴 정본 판정 · 쓰기 파일(`auto-ready-defect-resolution*.ts`)은 품질 계약 지문 대상이라 **고치지 않는다** — 그 위에 얹는다.
 *    정본 쓰기는 Serializable 트랜잭션에서 다시 평가해 계획과 한 칸이라도 다르면 쓰지 않고(감사 지문 · 큐 updatedAt CAS ·
 *    재검증 결과 · 계약), 큐 행 `editDiff` 해소 배열에 **덧붙이기만** 한다. 감사 행 · 큐의 다른 칸 · 글 · 초안은 그대로다.
 * 🔴 같은 승인을 다시 보내면 정본 평가가 `already` 다 — write 0 no-op 이다.
 */
import { createHash } from 'node:crypto'

import type { PrismaClient } from '@prisma/client'

import { unresolvedDefectCount } from '../../src/lib/auto-ready-repo'
import {
  DEFECT_RESOLUTION_KEY, DEFECT_RESOLVER, SEMANTIC_DEFECT_RESOLUTION_RECORD_VERSION,
  judgeDefectResolution, resolutionEntriesOf,
} from '../../src/lib/auto-ready-defect-resolution'
import {
  applyDefectResolution, applySemanticDefectResolution, planDefectResolution,
  type ContextLoader, type ResolutionPlan, type SemanticResolutionContextLoader,
} from '../../src/lib/auto-ready-defect-resolution-store'
import {
  SEMANTIC_AUDIT_CONTRACT_VERSION, SEMANTIC_AUDIT_MODEL, SEMANTIC_AUDIT_PROMPT_VERSION,
} from '../../src/lib/auto-ready-semantic-audit'
import { currentQualityContract } from '../../src/lib/quality-contract'
import type { Approval } from '../../src/lib/production-activation-guard'

const stableJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x !== null && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort()) : x))

/** 🔴 결정적 계획 지문 — 기록 시각(`resolvedAt`)만 빼고 계획 전부. 같은 DB 상태 · 같은 계약이면 언제나 같다 */
export function defectPlanDigestOf(p: ResolutionPlan): string {
  return createHash('sha256').update(stableJson({ ...p, record: { ...p.record, resolvedAt: '' } }), 'utf8').digest('hex')
}

const SEMANTIC_PLAN_TOKEN_VERSION = 'semantic-resolution-plan-v1'
const rec = (v: unknown): Record<string, unknown> | null =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null)
const text = (v: unknown): string | null => typeof v === 'string' && v.length > 0 ? v : null
const hex64 = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)

/** 의미 재감사 계획은 본문 없이 id·hash·계약만 담은 불투명 토큰으로 승인 단계에 넘긴다. */
export function semanticPlanTokenOf(plan: ResolutionPlan): string {
  return Buffer.from(stableJson({ version: SEMANTIC_PLAN_TOKEN_VERSION, plan }), 'utf8').toString('base64url')
}

function semanticPlanProblem(plan: ResolutionPlan): string | null {
  const contract = currentQualityContract()
  const r = rec(plan.record)
  const audit = rec(r?.audit)
  const draft = rec(r?.draft)
  const quality = rec(r?.qualityContract)
  const reverify = rec(r?.reverify)
  if (text(plan.queueId) === null || text(plan.postId) === null || text(plan.queueUpdatedAt) === null
    || !hex64(plan.auditFingerprint) || Number.isNaN(Date.parse(plan.queueUpdatedAt))) return '계획 머리가 깨졌다'
  if (r === null || audit === null || draft === null || quality === null || reverify === null) return '계획 기록 모양이 깨졌다'
  if (r.recordVersion !== SEMANTIC_DEFECT_RESOLUTION_RECORD_VERSION || r.resolvedBy !== DEFECT_RESOLVER
    || text(r.resolvedAt) === null || Number.isNaN(Date.parse(String(r.resolvedAt)))) return '의미 해소 기록 판이 아니다'
  if (quality.version !== contract.version || quality.digest !== contract.digest) return '지금 품질 계약 계획이 아니다'
  if (audit.queueId !== plan.queueId || audit.postId !== plan.postId || audit.fingerprint !== plan.auditFingerprint) return '감사 결속이 다르다'
  if (!hex64(draft.titleHash) || !hex64(draft.bodyHash)) return '초안 지문이 깨졌다'
  if (reverify.gateVersion !== 'semantic-only' || reverify.outcome !== 'semanticCleared'
    || !Array.isArray(reverify.failureCodes) || reverify.failureCodes.length !== 0
    || !Array.isArray(reverify.reviewCodes) || reverify.reviewCodes.length !== 0
    || !hex64(reverify.inputDigest) || text(reverify.artifactId) === null) return '의미 해소 판정이 아니다'
  if (reverify.semanticContractVersion !== SEMANTIC_AUDIT_CONTRACT_VERSION
    || reverify.semanticModel !== SEMANTIC_AUDIT_MODEL
    || reverify.semanticPromptVersion !== SEMANTIC_AUDIT_PROMPT_VERSION) return '지금 의미 감사 계약 계획이 아니다'
  return null
}

export type SemanticPlanTokenResult =
  | { ok: true; plan: ResolutionPlan }
  | { ok: false; reason: string }

/** 토큰은 신뢰하지 않는다. 현재 계약과 의미 감사 판까지 모두 확인한 뒤에만 계획으로 복원한다. */
export function semanticPlanFromToken(token: string): SemanticPlanTokenResult {
  if (token.length === 0 || token.length > 16_384 || !/^[A-Za-z0-9_-]+$/.test(token)) return { ok: false, reason: '토큰 모양이 깨졌다' }
  try {
    const envelope = rec(JSON.parse(Buffer.from(token, 'base64url').toString('utf8')))
    const plan = rec(envelope?.plan)
    if (envelope?.version !== SEMANTIC_PLAN_TOKEN_VERSION || plan === null) return { ok: false, reason: '토큰 판이 다르다' }
    const candidate = plan as unknown as ResolutionPlan
    const problem = semanticPlanProblem(candidate)
    return problem === null ? { ok: true, plan: candidate } : { ok: false, reason: problem }
  } catch {
    return { ok: false, reason: '토큰을 읽을 수 없다' }
  }
}

export type DefectExpectation = { before: number; after: number }

/** 🔴 기대 상태 — 지금 미해소 수와, 이 기록을 덧붙였을 때 정본 판정이 내는 미해소 수(쓰지 않고 계산) */
export async function expectationOf(prisma: PrismaClient, plan: ResolutionPlan): Promise<DefectExpectation> {
  const before = await unresolvedDefectCount(prisma)
  const audit = await prisma.autoReadyAudit.findUniqueOrThrow({ where: { queueId: plan.queueId } })
  const q = await prisma.originalPostApprovalQueue.findUniqueOrThrow({
    where: { id: plan.queueId }, select: { id: true, createdPostId: true, draftTitle: true, draftBody: true, gateResults: true, editDiff: true },
  })
  const ed = (q.editDiff !== null && typeof q.editDiff === 'object' && !Array.isArray(q.editDiff) ? q.editDiff : {}) as Record<string, unknown>
  const simulated = { ...q, editDiff: { ...ed, [DEFECT_RESOLUTION_KEY]: [...resolutionEntriesOf(q.editDiff), plan.record] } }
  const wasResolved = judgeDefectResolution(audit, q, currentQualityContract()).resolved
  const willResolve = judgeDefectResolution(audit, simulated, currentQualityContract()).resolved
  return { before, after: before - (!wasResolved && willResolve ? 1 : 0) }
}

export type ApprovedOutcome =
  | { kind: 'written'; written: 1; after: number }
  | { kind: 'noop'; written: 0; reason: string }
  | { kind: 'refuse'; written: 0; code: string; reason: string }
  /** 🔴 쓴 뒤 다시 센 값이 승인과 다르다 — 그 사이 다른 결함이 바뀌었다(이 기록은 정본이 계획과 같을 때만 썼다) */
  | { kind: 'post-mismatch'; written: 1; after: number; reason: string }

/** 🔴 운영 승인 적용 — digest · expect · reason 이 지금과 같을 때만 정본 쓰기를 부른다 */
export async function applyApprovedDefectResolution(prisma: PrismaClient, i: {
  queueId: string; approval: Approval; contextOf: ContextLoader; now: Date
}): Promise<ApprovedOutcome> {
  if (i.approval.reason.trim() === '') return { kind: 'refuse', written: 0, code: 'NO_REASON', reason: 'reason 이 비었다' }
  const e = await planDefectResolution(prisma, { queueId: i.queueId, contextOf: i.contextOf, now: i.now })
  if (e.kind === 'already') return { kind: 'noop', written: 0, reason: `이미 해소 — ${e.reason}` }
  if (e.kind === 'refuse') return { kind: 'refuse', written: 0, code: e.code, reason: e.reason }
  const digest = defectPlanDigestOf(e.plan)
  if (digest !== i.approval.digest) {
    return { kind: 'refuse', written: 0, code: 'PLAN_STALE', reason: `승인 ${i.approval.digest.slice(0, 16)} · 지금 ${digest.slice(0, 16)}` }
  }
  const ex = await expectationOf(prisma, e.plan)
  if (ex.before !== i.approval.expected.before || ex.after !== i.approval.expected.after) {
    return { kind: 'refuse', written: 0, code: 'EXPECTATION_MISMATCH', reason: `승인 ${i.approval.expected.before}:${i.approval.expected.after} · 지금 ${ex.before}:${ex.after}` }
  }
  const a = await applyDefectResolution(prisma, { plan: e.plan, contextOf: i.contextOf, now: i.now })
  if (a.kind === 'already') return { kind: 'noop', written: 0, reason: a.reason }
  if (a.kind !== 'written') return { kind: 'refuse', written: 0, code: a.kind.toUpperCase(), reason: a.reason }
  const after = await unresolvedDefectCount(prisma)
  if (after !== i.approval.expected.after) {
    return { kind: 'post-mismatch', written: 1, after, reason: `쓴 뒤 미해소 ${after} ≠ 승인 ${i.approval.expected.after}` }
  }
  return { kind: 'written', written: 1, after }
}

/** 의미 재감사 해소의 운영 승인 적용 — 측정된 `no` 계획도 같은 digest·expect·reason에 묶는다. */
export async function applyApprovedSemanticDefectResolution(prisma: PrismaClient, i: {
  queueId: string; approval: Approval; loadContext: SemanticResolutionContextLoader; plan: ResolutionPlan; now: Date
}): Promise<ApprovedOutcome> {
  if (i.approval.reason.trim() === '') return { kind: 'refuse', written: 0, code: 'NO_REASON', reason: 'reason 이 비었다' }
  const problem = semanticPlanProblem(i.plan)
  if (problem !== null) return { kind: 'refuse', written: 0, code: 'INVALID_SEMANTIC_PLAN', reason: problem }
  if (i.plan.queueId !== i.queueId) return { kind: 'refuse', written: 0, code: 'WRONG_QUEUE', reason: '승인 계획의 큐가 요청과 다르다' }
  if (i.approval.expected.before !== i.approval.expected.after + 1) {
    return { kind: 'refuse', written: 0, code: 'INVALID_EXPECTATION', reason: '의미 해소 승인은 미해소 결함 정확히 1건을 줄여야 한다' }
  }
  const digest = defectPlanDigestOf(i.plan)
  if (digest !== i.approval.digest) {
    return { kind: 'refuse', written: 0, code: 'PLAN_STALE', reason: `승인 ${i.approval.digest.slice(0, 16)} · 지금 ${digest.slice(0, 16)}` }
  }
  const ex = await expectationOf(prisma, i.plan)
  const exact = ex.before === i.approval.expected.before && ex.after === i.approval.expected.after
  const possibleReplay = ex.before === ex.after && ex.after === i.approval.expected.after
  if (!exact && !possibleReplay) {
    return { kind: 'refuse', written: 0, code: 'EXPECTATION_MISMATCH', reason: `승인 ${i.approval.expected.before}:${i.approval.expected.after} · 지금 ${ex.before}:${ex.after}` }
  }
  const a = await applySemanticDefectResolution(prisma, { plan: i.plan, loadContext: i.loadContext, now: i.now })
  if (a.kind === 'already') return { kind: 'noop', written: 0, reason: a.reason }
  if (a.kind !== 'written') return { kind: 'refuse', written: 0, code: a.kind.toUpperCase(), reason: a.reason }
  const after = await unresolvedDefectCount(prisma)
  if (after !== i.approval.expected.after) {
    return { kind: 'post-mismatch', written: 1, after, reason: `쓴 뒤 미해소 ${after} ≠ 승인 ${i.approval.expected.after}` }
  }
  return { kind: 'written', written: 1, after }
}
