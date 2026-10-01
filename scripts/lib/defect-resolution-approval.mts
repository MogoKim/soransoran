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
import { DEFECT_RESOLUTION_KEY, judgeDefectResolution, resolutionEntriesOf } from '../../src/lib/auto-ready-defect-resolution'
import {
  applyDefectResolution, planDefectResolution, type ContextLoader, type ResolutionPlan,
} from '../../src/lib/auto-ready-defect-resolution-store'
import { currentQualityContract } from '../../src/lib/quality-contract'
import type { Approval } from '../../src/lib/production-activation-guard'

const stableJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x !== null && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort()) : x))

/** 🔴 결정적 계획 지문 — 기록 시각(`resolvedAt`)만 빼고 계획 전부. 같은 DB 상태 · 같은 계약이면 언제나 같다 */
export function defectPlanDigestOf(p: ResolutionPlan): string {
  return createHash('sha256').update(stableJson({ ...p, record: { ...p.record, resolvedAt: '' } }), 'utf8').digest('hex')
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
