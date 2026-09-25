/**
 * 🔴 **Persona 한 명 → 배정 판정 입력(`PersonaForMatch`) — 조립은 여기 하나다** (2026-09-25)
 *
 * 앞판은 이 조립이 공용 로더(`scripts/lib/publishable-stock.mts`) 안에 있었다. 그래서
 * `src/lib` 의 발행 트랜잭션은 같은 조립을 쓸 수 없었고, 자동 행 배정 때 **호출자가 넘긴
 * personaId 를 그대로 믿었다**(마스터 지적). 이제 로더와 발행 트랜잭션이 이 함수 하나를 쓴다 —
 * 한쪽만 바뀌면 "계획할 때와 쓸 때" 의 판정이 갈린다.
 *
 * 🔴 값은 앞판 로더 그대로다. `workStatus`·`economicStatus`·`region` 은 러너가 `null` 로
 *    넘기던 의미를 그대로 옮긴다 — 여기서 채우면 배정 결과가 러너와 달라진다.
 * 🔴 읽기만 한다. db 는 PrismaClient 든 트랜잭션 클라이언트든 받는다 — 트랜잭션 안에서 부르면
 *    그 스냅샷에서 주간 사용량과 최소 간격을 센다.
 */
import type { Prisma, PrismaClient } from '@prisma/client'

import type { ChildAgeBand, PersonaForMatch } from './original-post-persona-match'

export const PERSONA_FOR_MATCH_SELECT = {
  id: true, code: true, status: true, userId: true, identity: true, voiceCore: true, noGoTopics: true,
  user: { select: { providerId: true, _count: { select: { accounts: true } } } },
} as const satisfies Prisma.PersonaSelect

export type PersonaRowForMatch = Prisma.PersonaGetPayload<{ select: typeof PERSONA_FOR_MATCH_SELECT }>

export async function personaForMatchOf(
  db: PrismaClient | Prisma.TransactionClient, r: PersonaRowForMatch, now: Date,
): Promise<PersonaForMatch> {
  const WEEK_AGO = new Date(now.getTime() - 7 * 864e5)
  const id = (r.identity ?? {}) as Record<string, unknown>
  const postsThisWeek = await db.originalPostApprovalQueue.count({
    where: { matchedPersona: { code: r.code }, matchedAt: { gte: WEEK_AGO } },
  })
  const last = await db.originalPostApprovalQueue.findFirst({
    where: { matchedPersona: { code: r.code } },
    orderBy: { matchedAt: 'desc' }, select: { matchedAt: true },
  })
  const vc = (r.voiceCore ?? {}) as Record<string, unknown>
  return {
    code: r.code, status: r.status,
    providerId: r.user?.providerId ?? null,
    accountCount: r.user?._count.accounts ?? null,
    ageBand: typeof id.ageBand === 'string' ? id.ageBand : null,
    maritalStatus: typeof id.maritalStatus === 'string' ? id.maritalStatus : null,
    childrenCount: typeof id.childrenCount === 'number' ? id.childrenCount : null,
    ...(Array.isArray(id.childrenAgeBands) ? { childrenAgeBands: id.childrenAgeBands as ChildAgeBand[] } : {}),
    parentCare: typeof id.parentCare === 'string' ? id.parentCare : null,
    menopauseStatus: typeof id.menopauseStatus === 'string' ? id.menopauseStatus : null,
    workStatus: null, economicStatus: null, region: null,
    noGoTopics: r.noGoTopics,
    voiceLength: typeof vc.length === 'string' ? vc.length : null,
    postsThisWeek,
    daysSinceLastPost: last?.matchedAt == null ? null
      : Math.floor((now.getTime() - last.matchedAt.getTime()) / 864e5),
  }
}
