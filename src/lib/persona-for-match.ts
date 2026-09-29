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

import {
  hardFilter, readPostRequirements,
  type BatchCaps, type ChildAgeBand, type PersonaForMatch,
} from './original-post-persona-match'
import { judgeVoiceMatch, voiceOfGateResults } from './original-post-voice-match'
/** 🔴 적응 레인 격리 행 — Persona 사용량(WIP)에 넣지 않는다 (2026-09-29) */
import { carriesRawAdaptMark } from './raw-adapt-lane'

export const PERSONA_FOR_MATCH_SELECT = {
  id: true, code: true, status: true, userId: true, identity: true, voiceCore: true, noGoTopics: true,
  user: { select: { providerId: true, _count: { select: { accounts: true } } } },
} as const satisfies Prisma.PersonaSelect

export type PersonaRowForMatch = Prisma.PersonaGetPayload<{ select: typeof PERSONA_FOR_MATCH_SELECT }>

/**
 * 🔴 **Persona 한 명의 배정 사용량 — 주간 수 · 마지막 배정** (2026-09-29 분리).
 *    배정기(`personaForMatchOf`)와 수동 배정 도구가 이 함수 하나를 쓴다.
 *
 * 🔴 **적응 레인 격리 행은 세지 않는다** — 내부 실험이라 발행 경로가 없다. 그 행에 배정이 잘못 남아 있어도
 *    화자의 주간 상한 · 최소 간격을 점유하지 않는다(판정은 `carriesRawAdaptMark` 하나).
 * 🔴 그 밖의 값은 앞판 쿼리 그대로다 — 주간 수는 `matchedAt ≥ weekAgo` 인 행 수,
 *    마지막 배정은 `matchedAt desc` 첫 행(Postgres 는 desc 에서 NULL 이 먼저다 — 배정 시각 없는 행이 있으면 `null`).
 */
export async function personaMatchUsageOf(
  db: PrismaClient | Prisma.TransactionClient, code: string, weekAgo: Date,
  opts: { excludeQueueId?: string } = {},
): Promise<{ postsThisWeek: number; last: { matchedAt: Date | null } | null }> {
  const notSelf = opts.excludeQueueId === undefined ? {} : { id: { not: opts.excludeQueueId } }
  const postsThisWeek = (await db.originalPostApprovalQueue.findMany({
    where: { matchedPersona: { code }, matchedAt: { gte: weekAgo }, ...notSelf },
    select: { gateResults: true },
  })).filter((x) => !carriesRawAdaptMark(x.gateResults)).length
  const rows = (await db.originalPostApprovalQueue.findMany({
    where: { matchedPersona: { code }, ...notSelf },
    select: { matchedAt: true, gateResults: true },
  })).filter((x) => !carriesRawAdaptMark(x.gateResults))
  if (rows.length === 0) return { postsThisWeek, last: null }
  if (rows.some((x) => x.matchedAt === null)) return { postsThisWeek, last: { matchedAt: null } }
  const latest = rows.reduce((m, x) => (x.matchedAt!.getTime() > m.getTime() ? x.matchedAt! : m), rows[0]!.matchedAt!)
  return { postsThisWeek, last: { matchedAt: latest } }
}

/**
 * 🔴 `excludeQueueId` — 이미 이 Persona 에 배정된 큐 행을 **자기 자신**으로 다시 판정할 때 쓴다
 *    (2026-09-25 마스터 지적). 자기 배정을 주간 사용량·최소 간격에 넣으면 정상 행이
 *    자기 `matchedAt` 때문에 WEEKLY_CAP·TOO_SOON 으로 막힌다 — 이중 계산이다.
 */
export async function personaForMatchOf(
  db: PrismaClient | Prisma.TransactionClient, r: PersonaRowForMatch, now: Date,
  opts: { excludeQueueId?: string } = {},
): Promise<PersonaForMatch> {
  const WEEK_AGO = new Date(now.getTime() - 7 * 864e5)
  const id = (r.identity ?? {}) as Record<string, unknown>
  const { postsThisWeek, last } = await personaMatchUsageOf(db, r.code, WEEK_AGO, opts)
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

/**
 * 🔴 **자동 행 배정 판정 — 계획기와 발행 트랜잭션이 이 함수 하나를 쓴다** (2026-09-25 마스터 P0).
 *
 *    앞판은 발행 트랜잭션만 기존 배정을 다시 판정했다. 계획기는 기존 배정을 "복구" 로 보고
 *    맨 앞에 세웠다 — 그래서 트랜잭션이 막는 행이 **매 회차 선두를 차지하고** 러너가 멈춰,
 *    뒤의 정상 행이 굶었다(격리 DB 러너 사슬에서 재현). 이제 둘이 같은 판정을 본다.
 *
 * 🔴 **갈래는 정본 코드에서 나온다 — 새 상수가 아니다.**
 *    · `defer`     — 사유가 **전부** `hardFilter` 의 시간 상한(`WEEKLY_CAP`·`TOO_SOON`)이다.
 *                    시간이 지나면 풀린다. 그 행만 이번 회차에서 빼고 다른 정상 행을 진행한다.
 *    · `exception` — 말투·생활사·비활성·실회원·Persona 없음. 시간이 지나도 풀리지 않는다.
 *                    자동 발행에서 빼고 예외로 드러낸다. 🔴 다른 Persona 로 바꾸지 않는다.
 */
export const TIME_BOUND_ASSIGN_CODES: readonly string[] = ['WEEKLY_CAP', 'TOO_SOON']

export type AutoAssignVerdict =
  | { ok: true }
  | { ok: false; route: 'defer' | 'exception'; codes: string[] }

export function judgeAutoAssignment(i: {
  persona: PersonaForMatch | null
  gateResults: unknown
  title: string
  body: string
  caps: BatchCaps
}): AutoAssignVerdict {
  if (i.persona === null) return { ok: false, route: 'exception', codes: ['PERSONA_MISSING'] }
  const voice = judgeVoiceMatch({ voice: voiceOfGateResults(i.gateResults), personaCode: i.persona.code, profile: 'machine' })
  const blocks = hardFilter(i.persona, readPostRequirements(i.title, i.body), i.title, i.body, i.caps)
  const codes = [...(voice.ok ? [] : [`VOICE_MISMATCH(${voice.code})`]), ...blocks.map((b) => b.code)]
  if (codes.length === 0) return { ok: true }
  return { ok: false, route: codes.every((c) => TIME_BOUND_ASSIGN_CODES.includes(c)) ? 'defer' : 'exception', codes }
}
