/**
 * Persona 댓글 상한 **사용량 읽기** — 🔴 read-only. 발행 트랜잭션과 고르는 쪽이 **같은 셈법**을 쓴다
 *
 * 🔴 왜 있는가 (2026-11-21 · 11-20 운영 로그): 상한(dailyCap · weeklyCap)을 발행 트랜잭션만 봤다.
 *    planner 는 그날 상한을 채운 P18 을 골라 생성 · 적재했고, 발행에서 `dailyCap 2 초과` 로 닫혀 첫 댓글이 600초 창을 넘겼다(6편).
 *    추가 댓글 레인은 적재 145건 중 40건이 상한으로 닫혔다 — 매번 유료 생성을 하고 버렸다.
 *    그래서 고르는 순간에도 같은 `planCap` 을 같은 사용량으로 한 번 더 쓴다. 발행 트랜잭션의 판정은 그대로다(최종 방어선).
 *
 * 🔴 셈법(발행 트랜잭션 정본 그대로): `PersonaActivityLog` kind=comment 를 KST 오늘(`kstDayStart`) · 최근 7일(`weekWindowStart`)로 센다.
 *    고르는 쪽은 여기에 **아직 발행되지 않은 열린 대기(`OPEN_STATUSES`)** 를 더한다(`withOpenQueue`) — 안 세면 같은 틱 · 연속 틱에서
 *    같은 사람에게 상한보다 많이 적재한다. 발행 트랜잭션은 더하지 않는다 — 발행하려는 행 자신이 대기 행이다.
 */
import type { Prisma } from '@prisma/client'

import { kstDayStart, planCap, weekWindowStart, type CapBlock, type CapContext, type CapLimits } from './persona-cap'
import { OPEN_STATUSES } from './persona-comment-queue'

type CapUsageDb = Pick<Prisma.TransactionClient, 'personaActivityLog' | 'personaApprovalQueue'>

/**
 * Persona id 마다 상한 사용량. 목록의 id 는 0건이어도 결과에 있다.
 * 🔴 조회가 실패하면 throw 한다 — 0 으로 보정하지 않는다(부르는 쪽이 "못 읽음" 경로로 바꾼다).
 */
export async function countCapUsage(
  db: CapUsageDb,
  personaIds: readonly string[],
  now: Date,
  opts: { withOpenQueue: boolean },
): Promise<Map<string, CapContext>> {
  const ids = [...new Set(personaIds)]
  const out = new Map<string, CapContext>(ids.map((id) => [id, { usedToday: 0, usedWeek: 0 }]))
  if (ids.length === 0) return out
  const [today, week, open] = await Promise.all([
    db.personaActivityLog.groupBy({
      by: ['personaId'], _count: { _all: true },
      where: { personaId: { in: ids }, kind: 'comment', createdAt: { gte: kstDayStart(now) } },
    }),
    db.personaActivityLog.groupBy({
      by: ['personaId'], _count: { _all: true },
      where: { personaId: { in: ids }, kind: 'comment', createdAt: { gte: weekWindowStart(now) } },
    }),
    opts.withOpenQueue
      ? db.personaApprovalQueue.groupBy({
        by: ['personaId'], _count: { _all: true },
        where: { personaId: { in: ids }, status: { in: [...OPEN_STATUSES] } },
      })
      : Promise.resolve([] as { personaId: string; _count: { _all: number } }[]),
  ])
  for (const r of today) out.get(r.personaId)!.usedToday += r._count._all
  for (const r of week) out.get(r.personaId)!.usedWeek += r._count._all
  // 🔴 열린 대기는 곧 발행될 몫이다 — 오늘과 7일 모두에 더한다
  for (const r of open) {
    const cur = out.get(r.personaId)!
    cur.usedToday += r._count._all
    cur.usedWeek += r._count._all
  }
  return out
}

/** 고르는 쪽이 들고 다니는 한 사람의 상한 사실 */
export type PersonaCapState = { limits: CapLimits; used: CapContext }

/**
 * 🔴 **이 사람이 지금 한 건 더 달면 상한을 넘는가** — 발행 트랜잭션과 같은 `planCap` 이다.
 *    막히면 그 블록(코드 · 사유)을 그대로 돌려준다. 사실이 없으면(null) 상한 미설정과 같게 막는다 — 발행도 그렇게 막는다.
 */
export function capBlocksForOneMore(state: PersonaCapState | null | undefined): CapBlock[] {
  if (state === null || state === undefined) {
    return planCap({ dailyCap: null, weeklyCap: null }, { usedToday: 0, usedWeek: 0 }).blocks
  }
  return planCap(state.limits, state.used).blocks
}
