/**
 * 발행 여력 예측 (§4-AW ③-b)
 *
 * 🔴 **여기에 새 판정이 없다.** 매칭은 `planBatch`, 순서는 `compareAutoRow`·`splitTargets`,
 *    상한은 `POST_CAP_PER_WEEK`·`MIN_DAYS_BETWEEN_POSTS`·`DAILY_PUBLISH_CAP` 이 정한다.
 *    이 파일은 그 함수들을 **날짜를 밀어 가며 여러 번 부를** 뿐이다.
 *
 * 왜 필요한가 — 2026-09-07 실측:
 * 재고가 14/14 라 관제 화면은 초록인데, persona 5명의 `matchedAt` 을 놓고 계산하면
 * 앞으로 14일 중 **5일이 발행 공백**이다. 재고는 "며칠치" 가 아니다 —
 * persona 회전이 막히면 재고가 아무리 많아도 나가지 못한다.
 * 그 사실이 화면에 보이지 않으면 사람은 큐가 빌 때까지 모른다.
 *
 * 🔴 read-only. DB 도 파일도 건드리지 않는다.
 */

import {
  MIN_DAYS_BETWEEN_POSTS, POST_CAP_PER_WEEK, planBatch,
  type BatchDraft, type PersonaForMatch,
} from './original-post-persona-match'
import type { Finding } from './supply-health'

/** 🔴 발행 러너와 같은 하루 상한 */
export const DAILY_CAP_FOR_FORECAST = 1

/** 🔴 00:05 KST — auto-publish workflow 의 예약 시각 */
export const PUBLISH_HOUR_KST = 0
export const PUBLISH_MINUTE_KST = 5

const DAY_MS = 86_400_000
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/** KST 기준 하루의 시작(UTC Date) — 🔴 표시도 계산도 KST 로 한다 */
export function kstDayStartOf(now: Date): Date {
  const kst = new Date(now.getTime() + KST_OFFSET_MS)
  kst.setUTCHours(0, 0, 0, 0)
  return new Date(kst.getTime() - KST_OFFSET_MS)
}

/** `YYYY-MM-DD` (KST) — 🔴 UTC 날짜를 KST 처럼 보여주지 않는다 */
export function kstDateLabel(d: Date): string {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10)
}

/** `MM-DD HH:mm KST` */
export function kstStamp(d: Date): string {
  return `${new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(5, 16).replace('T', ' ')} KST`
}

/**
 * 다음 발행 예약 시각 — 🔴 **오늘 이미 상한을 채웠으면 내일이다.**
 *
 * 2026-09-07 에 이미 1/1 을 채웠는데 그날 발행을 한 번 더 세면
 * 예측이 하루씩 앞당겨져 공백이 가려진다.
 */
export function nextScheduleAt(input: {
  now: Date
  publishedToday: number
  dailyCap?: number
}): Date {
  const cap = input.dailyCap ?? DAILY_CAP_FOR_FORECAST
  const day = kstDayStartOf(input.now)
  const todayAt = new Date(day.getTime() + (PUBLISH_HOUR_KST * 60 + PUBLISH_MINUTE_KST) * 60_000)
  // 오늘 예약이 아직 안 왔고 상한도 안 찼으면 오늘이다
  if (input.now.getTime() < todayAt.getTime() && input.publishedToday < cap) return todayAt
  return new Date(todayAt.getTime() + DAY_MS)
}

/** persona 한 명의 발행 이력 — 🔴 `matchedAt` 이 정본이다 */
export type PersonaHistory = {
  code: string
  /** 과거 배정 시각들 (UTC Date) */
  matchedAts: Date[]
}

/**
 * 그 시점에 이 persona 가 쓸 수 있는가 — 🔴 **실제 게이트와 같은 두 조건**이다.
 *
 * · 주간 상한: `matchedAt >= at - 7일` 인 건수 < `POST_CAP_PER_WEEK`
 *   🔴 rolling 7일이다. 달력 주가 아니다. 경계는 **포함**(`>=`)이며 러너 쿼리와 같다
 * · 최소 간격: 마지막 배정에서 `MIN_DAYS_BETWEEN_POSTS` 일 경과
 */
export function personaAvailableAt(h: PersonaHistory, at: Date): boolean {
  const weekAgo = new Date(at.getTime() - 7 * DAY_MS)
  const inWeek = h.matchedAts.filter((d) => d.getTime() >= weekAgo.getTime() && d.getTime() <= at.getTime()).length
  if (inWeek >= POST_CAP_PER_WEEK) return false
  const last = h.matchedAts.length === 0 ? null
    : h.matchedAts.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b))
  if (last === null) return true
  return at.getTime() - last.getTime() >= MIN_DAYS_BETWEEN_POSTS * DAY_MS
}

/** 그 시점에 쓸 수 있는 persona 코드들 */
export function availablePersonasAt(hist: readonly PersonaHistory[], at: Date): string[] {
  return hist.filter((h) => personaAvailableAt(h, at)).map((h) => h.code).sort()
}

export type ForecastDay = {
  /** KST 날짜 */
  date: string
  scheduledAt: Date
  /** 그날 쓸 수 있던 persona */
  availableCodes: string[]
  /** 실제로 발행됐다고 본 글 */
  publishedQueueId: string | null
  publishedPersona: string | null
  /** 🔴 발행하지 못한 이유 */
  blockedReason: 'NONE' | 'NO_PERSONA' | 'NO_CANDIDATE' | 'MATCH_BLOCKED'
}

export type Forecast = {
  days: ForecastDay[]
  in7: number
  in14: number
  gapDates7: string[]
  gapDates14: string[]
  /** 다음 예약에 나갈 글 */
  nextQueueId: string | null
  nextPersonaCandidates: string[]
  nextScheduleAt: Date
  /** 오늘(또는 다음 예약) 발행 가능한가 */
  nextScheduleWillPublish: boolean
}

/**
 * 며칠 뒤까지 몇 건이 나갈 수 있는가 — 🔴 **실제 러너의 동작을 그대로 재현한다.**
 *
 * · 큐 순서는 `compareAutoRow` 로 이미 정렬된 것을 받는다 (`selectAutoTargets` 통과분만)
 * · 하루에 `DAILY_CAP` 만큼만
 * · 🔴 **맨 앞 글에 배정이 안 되면 그날은 거른다.** 뒤 글로 우회하지 않는다 —
 *   러너가 `splitTargets` 로 첫 글만 집어 멈추기 때문이다.
 *   우회하면 예측이 실제보다 낙관적이 되고, 그 낙관 위에서 cap 을 올리게 된다
 * · 가상 발행한 건 그 persona 의 `matchedAt` 에 더해 다음 날 계산에 반영한다
 */
export function forecastPublishing(input: {
  /** 🔴 `selectAutoTargets` 를 통과한 자동 발행 후보만. legacy 는 이미 빠져 있다 */
  queue: readonly BatchDraft[]
  personas: readonly PersonaForMatch[]
  history: readonly PersonaHistory[]
  startAt: Date
  days: number
  dailyCap?: number
}): Forecast {
  const cap = input.dailyCap ?? DAILY_CAP_FOR_FORECAST
  // 🔴 이력을 복사해 쓴다 — 호출자의 배열을 바꾸지 않는다
  const hist: PersonaHistory[] = input.history.map((h) => ({ code: h.code, matchedAts: [...h.matchedAts] }))
  const remaining = [...input.queue]
  const days: ForecastDay[] = []
  let nextQueueId: string | null = null
  let nextPersonaCandidates: string[] = []

  for (let i = 0; i < input.days; i += 1) {
    const at = new Date(input.startAt.getTime() + i * DAY_MS)
    const availableCodes = availablePersonasAt(hist, at)
    let publishedQueueId: string | null = null
    let publishedPersona: string | null = null
    let blockedReason: ForecastDay['blockedReason'] = 'NONE'

    for (let n = 0; n < cap; n += 1) {
      const head = remaining[0]
      if (head === undefined) { blockedReason = 'NO_CANDIDATE'; break }
      if (availableCodes.length === 0) { blockedReason = 'NO_PERSONA'; break }

      // 🔴 그 시점에 여력이 있는 persona 만 후보로 넘긴다 —
      //    `planBatch` 는 `postsThisWeek` 로 여력을 보므로 그 값을 시뮬레이션 시점으로 맞춘다
      const weekAgo = new Date(at.getTime() - 7 * DAY_MS)
      const personasNow: PersonaForMatch[] = input.personas.map((p) => {
        const h = hist.find((x) => x.code === p.code)
        const used = (h?.matchedAts ?? []).filter(
          (d) => d.getTime() >= weekAgo.getTime() && d.getTime() <= at.getTime()).length
        const last = (h?.matchedAts ?? []).length === 0 ? null
          : (h?.matchedAts ?? []).reduce((a, b) => (a.getTime() >= b.getTime() ? a : b))
        const daysSince = last === null ? null : Math.floor((at.getTime() - last.getTime()) / DAY_MS)
        return { ...p, postsThisWeek: used, daysSinceLastPost: daysSince }
      })

      // 🔴 맨 앞 글 하나만 본다 — 러너의 splitTargets 와 같다
      const batch = planBatch([head], personasNow)
      const a = batch.assignments.find((x) => x.queueId === head.queueId)
      if (i === 0) {
        nextQueueId = head.queueId
        nextPersonaCandidates = (a?.eligible ?? []).map((c) => c.code)
      }
      if (a?.assigned == null) { blockedReason = 'MATCH_BLOCKED'; break }

      // 🔴 assigned 는 persona **코드 문자열**이다 (BatchAssignment 계약)
      publishedQueueId = head.queueId
      publishedPersona = a.assigned
      remaining.shift()
      const h = hist.find((x) => x.code === a.assigned)
      if (h !== undefined) h.matchedAts.push(at)
    }

    days.push({
      date: kstDateLabel(at), scheduledAt: at, availableCodes,
      publishedQueueId, publishedPersona, blockedReason,
    })
  }

  const in7 = days.slice(0, 7).filter((d) => d.publishedQueueId !== null).length
  const in14 = days.filter((d) => d.publishedQueueId !== null).length
  return {
    days, in7, in14,
    gapDates7: days.slice(0, 7).filter((d) => d.publishedQueueId === null).map((d) => d.date),
    gapDates14: days.filter((d) => d.publishedQueueId === null).map((d) => d.date),
    nextQueueId, nextPersonaCandidates,
    nextScheduleAt: input.startAt,
    nextScheduleWillPublish: days[0]?.publishedQueueId !== null,
  }
}

/**
 * 이론상 persona capacity 와 큐 실매칭 capacity — 🔴 **둘은 다르다.**
 *
 * 이론상: persona 수와 상한만 본 값. "사람이 몇 명이면 몇 건" 이다.
 * 실매칭: 지금 큐에 있는 글들이 실제로 그 사람들에게 붙는가. 생활사 조건이 깎는다.
 */
export function capacityOf(input: {
  activePersonas: number
  /** 큐 후보 × persona 조합 중 생활사로 **영구** 막힌 비율 (0~1) */
  lifeBlockRate: number
}): { theoreticalPerWeek: number; theoreticalPerDay: number; effectivePerDay: number } {
  const perWeek = input.activePersonas * POST_CAP_PER_WEEK
  const perDay = perWeek / 7
  return {
    theoreticalPerWeek: perWeek,
    theoreticalPerDay: perDay,
    effectivePerDay: perDay * (1 - input.lifeBlockRate),
  }
}

/**
 * 목표를 채우려면 몇 명이 더 필요한가 — 🔴 **범위로 낸다.**
 *
 * 표본이 14건뿐이다. 그 비율을 확정값처럼 쓰면 20명이 필요한데 18명만 뽑는 일이 생긴다.
 * 하한은 생활사 탈락 0 을 가정하고, 상한은 관측 탈락률을 그대로 적용한다.
 */
export function personasNeededFor(input: {
  targetPerDay: number
  lifeBlockRate: number
  activePersonas: number
}): { min: number; max: number; shortfallMin: number; shortfallMax: number } {
  const perWeek = input.targetPerDay * 7
  const min = Math.ceil(perWeek / POST_CAP_PER_WEEK)
  // 🔴 탈락률이 1 에 가까우면 나눗셈이 폭주한다 — 표본이 작을 때 그런 값이 나온다.
  //    "700명 필요" 같은 수는 근거가 아니라 잡음이다. 상한을 min 의 3배로 묶는다.
  const raw = Math.ceil(perWeek / POST_CAP_PER_WEEK / Math.max(0.05, 1 - input.lifeBlockRate))
  const max = Math.min(raw, min * MAX_NEED_MULTIPLIER)
  return {
    min, max,
    shortfallMin: Math.max(0, min - input.activePersonas),
    shortfallMax: Math.max(0, max - input.activePersonas),
  }
}

/**
 * 등급 — 🔴 **재고가 있어도 나가지 못하면 경고다.**
 *
 * 관제 화면이 "재고 14/14 초록" 만 보여주면 사람은 앞으로 5일 공백을 모른다.
 */
// 🔴 관제 화면과 **같은 Finding 타입**을 쓴다 — 두 벌이면 등급 규칙이 갈린다
export type CapacityFinding = Finding

export function judgeCapacity(input: {
  stockUsable: number
  in7: number
  nextWillPublish: boolean
  nextCandidates: number
  shortfallMin: number
}): CapacityFinding[] {
  const out: CapacityFinding[] = []

  // 🔴 7일 내내 0건이면 재고가 아무리 많아도 레인이 멈춘 것이다
  if (input.in7 === 0) {
    out.push({
      level: 'CRITICAL', code: 'FORECAST_EMPTY',
      message: `향후 7일 예상 발행 0건 — 재고 ${input.stockUsable}건이 있어도 나가지 못한다`,
    })
  } else if (!input.nextWillPublish) {
    // 재고는 있는데 **다음 후보**가 배정 불가
    out.push({
      level: 'WARNING', code: 'NEXT_NOT_ASSIGNABLE',
      message: `다음 예약에 나갈 수 없다 — 맨 앞 글에 배정 가능한 persona ${input.nextCandidates}명`,
    })
  }
  if (input.shortfallMin > 0) {
    out.push({
      level: 'WARNING', code: 'PERSONA_SHORTFALL',
      message: `목표를 채우려면 persona 가 최소 ${input.shortfallMin}명 더 필요하다`,
    })
  }
  if (out.length === 0) {
    out.push({
      level: 'HEALTHY', code: 'CAPACITY_OK',
      message: `향후 7일 ${input.in7}건 예상 · 다음 예약 발행 가능`,
    })
  }
  return out
}

/** 🔴 생활사(영구) 차단과 여력(임시) 차단을 나눈다 */
/** 🔴 표본이 작을 때 권장 persona 수가 폭주하지 않게 묶는 배수 */
export const MAX_NEED_MULTIPLIER = 3

export const LIFE_BLOCK_CODES: readonly string[] = [
  'NO_CHILDREN', 'CHILD_AGE_CONFLICT', 'CHILD_AGE_UNKNOWN', 'MARITAL_CONFLICT',
  'NO_PARENT_CARE', 'MENOPAUSE_NOT_YET', 'NOGO_TOPIC', 'REAL_MEMBER', 'NOT_ACTIVE',
] as const
export const CAPACITY_BLOCK_CODES: readonly string[] = ['WEEKLY_CAP', 'TOO_SOON'] as const

export function splitBlockReasons(counts: Readonly<Record<string, number>>): {
  life: number; capacity: number; lifeRate: number
} {
  let life = 0
  let capacity = 0
  for (const [code, n] of Object.entries(counts)) {
    if (LIFE_BLOCK_CODES.includes(code)) life += n
    else if (CAPACITY_BLOCK_CODES.includes(code)) capacity += n
  }
  const total = life + capacity
  return { life, capacity, lifeRate: total === 0 ? 0 : life / total }
}
