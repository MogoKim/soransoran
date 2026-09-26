/**
 * 🔴 **오리지널 초안 — 미발행 승인 철회의 정본** (2026-09-26 · auto-ready 증거 P0)
 *
 * 왜 필요한가 — 사람이 승인해 둔(APPROVED·EDITED) 미발행 글에 **중대 결함**을 기록해도, 상태가
 * 그대로면 그 글은 일반 발행 대상에 남는다(격리 DB 재현). 결함 기록과 발행 가능 상태가 공존하면 안 된다.
 * 그래서 결함 yes 를 기록하려면 **같은 트랜잭션에서 명시적으로 철회**해야 한다.
 *
 * 🔴 Persona 후보 철회(`persona-candidate-rules.planWithdrawal`)를 참고했지만 별도 계약이다 —
 *    테이블·발행 경로가 다르다.
 * 🔴 허용 상태는 APPROVED · EDITED 뿐 · 이미 발행(createdPostId)된 행은 거둘 수 없다.
 * 🔴 결과는 DECLINED + **유효한 폐기 사유 코드**(`DECLINE_REASONS`). 기본값·숨은 자동 폐기는 없다 —
 *    사유를 고르지 않으면 철회하지 않는다.
 * 🔴 **원래 승인 도장을 덮지 않는다.** `decidedBy`·`decidedAt` 은 그대로 두고, 철회한 사람·시각·
 *    이전 상태는 `editDiff.withdrawal` 에 남긴다. 승인 시각을 철회 시각으로 바꾸면 기록이 거짓이 된다.
 * 🔴 조건부 쓰기 — 읽은 상태·updatedAt·editDiff 값이 그대로이고 `createdPostId` 가 여전히 null 일 때만.
 *    발행 트랜잭션과 경쟁하면 둘 중 하나만 성공한다.
 */
import { Prisma } from '@prisma/client'

import { isDeclineReasonCode, type DeclineReasonCode } from './original-post-decision'

export const OP_WITHDRAWABLE_STATUSES = ['APPROVED', 'EDITED'] as const
export const WITHDRAWAL_KEY = 'withdrawal'
export const WITHDRAWAL_CONTRACT = 'op-withdrawal-v1'

export type WithdrawalPlan =
  | { ok: true; declineReason: DeclineReasonCode }
  | { ok: false; error: string }

/** 🔴 철회해도 되는가 — 순수 판정 */
export function planOriginalPostWithdrawal(i: { status: string; createdPostId: string | null; reason: unknown }): WithdrawalPlan {
  if (i.createdPostId !== null && i.createdPostId !== '') return { ok: false, error: '이미 발행된 글이다 — 철회할 수 없다(사후 기록만)' }
  if (!(OP_WITHDRAWABLE_STATUSES as readonly string[]).includes(i.status)) {
    return { ok: false, error: `승인된 미발행 글만 철회한다 (${OP_WITHDRAWABLE_STATUSES.join(' · ')}) — 현재 ${i.status}` }
  }
  if (!isDeclineReasonCode(i.reason)) return { ok: false, error: '철회 사유 코드를 골라야 한다 — 기본 사유는 없다' }
  return { ok: true, declineReason: i.reason }
}

type WithdrawRow = {
  id: string; status: string; createdPostId: string | null; updatedAt: Date
  decidedBy: string | null; decidedAt: Date | null; editDiff: unknown
}

const rec = (v: unknown): Record<string, unknown> =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})

/**
 * 🔴 **트랜잭션 안에서 철회한다.** 부르는 쪽이 같은 트랜잭션에서 증거 기록까지 쓰고, 어느 쪽이든
 *    실패하면 함께 되돌린다. 돌려주는 값은 바뀐 행 수(0|1) — 0 이면 부르는 쪽이 되돌린다.
 */
export async function withdrawOriginalPostInTx(tx: Prisma.TransactionClient, i: {
  row: WithdrawRow; reason: unknown; actorUserId: string; now: Date
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const plan = planOriginalPostWithdrawal({ status: i.row.status, createdPostId: i.row.createdPostId, reason: i.reason })
  if (!plan.ok) return plan
  const ed = rec(i.row.editDiff)
  const r = await tx.originalPostApprovalQueue.updateMany({
    where: {
      id: i.row.id, status: i.row.status as never, createdPostId: null, updatedAt: i.row.updatedAt,
      editDiff: i.row.editDiff === null ? { equals: Prisma.DbNull } : { equals: i.row.editDiff as Prisma.InputJsonValue },
    },
    data: {
      status: 'DECLINED',
      declineReason: plan.declineReason,
      // 🔴 decidedBy · decidedAt 은 쓰지 않는다 — 원래 승인 도장이다
      editDiff: {
        ...ed,
        [WITHDRAWAL_KEY]: {
          contract: WITHDRAWAL_CONTRACT, reasonCode: plan.declineReason, prevStatus: i.row.status,
          prevDecidedBy: i.row.decidedBy, prevDecidedAt: i.row.decidedAt?.toISOString() ?? null,
          withdrawnByUserId: i.actorUserId, withdrawnAt: i.now.toISOString(),
        },
      } as Prisma.InputJsonValue,
    },
  })
  return r.count === 1 ? { ok: true } : { ok: false, error: '철회 중 행이 바뀌었다(발행됐거나 다른 기록) — 쓰지 않았다' }
}
