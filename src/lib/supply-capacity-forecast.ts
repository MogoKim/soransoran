/**
 * 발행 여력 예측 (§4-AW ③-b)
 *
 * 🔴 **여기에 새 판정이 없다.** 매칭은 `planBatch`, 순서는 `compareAutoRow`·`splitTargets`,
 *    상한은 `POST_CAP_PER_WEEK`·`MIN_DAYS_BETWEEN_POSTS`·`DAILY_PUBLISH_CAP` 이 정한다.
 *    이 파일은 그 함수들을 **날짜를 밀어 가며 여러 번 부를** 뿐이다.
 *
 * 왜 필요한가 — 2026-09-07 실측:
 * 재고가 가득 차 관제 화면이 초록이어도, persona 의 `matchedAt` 을 놓고 계산하면
 * 앞으로 며칠이 발행 공백일 수 있다. 재고는 "며칠치" 가 아니다 —
 * persona 회전이 막히면 재고가 아무리 많아도 나가지 못한다.
 * 그 사실이 화면에 보이지 않으면 사람은 큐가 빌 때까지 모른다.
 *
 * 🔴 read-only. DB 도 파일도 건드리지 않는다.
 */

import {
  MIN_DAYS_BETWEEN_POSTS, POST_CAP_PER_WEEK, planBatch, type BatchCaps,
  type BatchDraft, type PersonaForMatch,
} from './original-post-persona-match'
// 🔴 KST 자정은 **정본 하나**를 쓴다. 여기서 다시 구현하면 언젠가 한쪽만 고쳐진다
import { kstDayStart } from './original-post-publish'
import { pickPublishTarget } from './original-post-auto-publish'
import type { Finding } from './supply-health'

/** 🔴 00:05 KST — auto-publish workflow 의 예약 시각 */
export const PUBLISH_HOUR_KST = 0
export const PUBLISH_MINUTE_KST = 5

const DAY_MS = 86_400_000
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

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
  /** 🔴 필수다 — 상한을 여기서 정하지 않는다. 러너의 DAILY_PUBLISH_CAP 을 주입받는다 */
  dailyCap: number
}): Date {
  const cap = input.dailyCap
  const day = kstDayStart(input.now)
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
export function personaAvailableAt(h: PersonaHistory, at: Date, caps: BatchCaps = {}): boolean {
  // 🔴 상한은 **주입값이 먼저**다. 넘기지 않으면 가장 안전한 상수로 떨어진다
  const weekCap = caps.postsPerWeek ?? POST_CAP_PER_WEEK
  const minGap = caps.minDaysBetween ?? MIN_DAYS_BETWEEN_POSTS
  const weekAgo = new Date(at.getTime() - 7 * DAY_MS)
  const inWeek = h.matchedAts.filter((d) => d.getTime() >= weekAgo.getTime() && d.getTime() <= at.getTime()).length
  if (inWeek >= weekCap) return false
  const last = h.matchedAts.length === 0 ? null
    : h.matchedAts.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b))
  if (last === null) return true
  return at.getTime() - last.getTime() >= minGap * DAY_MS
}

/** 그 시점에 쓸 수 있는 persona 코드들 */
export function availablePersonasAt(hist: readonly PersonaHistory[], at: Date, caps: BatchCaps = {}): string[] {
  return hist.filter((h) => personaAvailableAt(h, at, caps)).map((h) => h.code).sort()
}

/**
 * 🔴 발행하지 못한 이유 — **서로 다른 대응이 필요하므로 코드를 나눈다.**
 *
 *   LIFE_BLOCKED   맨 앞 글이 생활사로 **영구** 매칭 불가 (persona 를 늘려야 풀린다)
 *   CAPACITY_WAIT  맞는 persona 는 있는데 주간 cap·최소 간격으로 **일시** 대기
 *   BATCH_EXHAUSTED 배치 배정에서 여력이 소진됨 (다른 글이 먼저 가져갔다)
 *   NO_CANDIDATE   큐가 비었다
 *   DAILY_CAP_DONE 그날 상한을 이미 채웠다
 */
export type BlockReason =
  | 'NONE' | 'LIFE_BLOCKED' | 'CAPACITY_WAIT' | 'BATCH_EXHAUSTED'
  | 'NO_CANDIDATE' | 'DAILY_CAP_DONE'
  /**
   * 🔴 기존 배정이 쓸 수 없는 persona 를 가리킨다 — 없는 사람 · 비활성 · 실계정.
   *    러너는 이때 **아무것도 발행하지 않고 멈춘다.** 예측도 같아야 한다 —
   *    "다른 글로 우회하면 나갈 수 있다" 고 보여주면, 사람은 멈춘 레인을 초록으로 본다.
   */
  | 'RECOVERY_BROKEN'

export type ForecastDay = {
  /** KST 날짜 */
  date: string
  scheduledAt: Date
  /** 그날 쓸 수 있던 persona */
  availableCodes: string[]
  /**
   * 🔴 그날 발행된 것들 — **배열이다.**
   * `dailyCap` 이 2 이상이면 하루에 여러 건이 나간다. 한 필드에 덮어쓰면 뒤엣것만 남는다.
   */
  published: { queueId: string; persona: string }[]
  /** 🔴 발행하지 못한 이유 (그날 마지막으로 막힌 사유) */
  blockedReason: BlockReason
  /** 막힌 글 — 사람이 어느 글인지 알아야 한다 */
  blockedQueueId: string | null
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
  /** 🔴 다음 예약이 막힌 이유 */
  nextBlockReason: BlockReason
  nextScheduleAt: Date
  /** 오늘(또는 다음 예약) 발행 가능한가 */
  nextScheduleWillPublish: boolean
  /**
   * 🔴 기존 배정이 깨진 행 — 있으면 **레인 전체가 멈춘 것**이다.
   *    러너가 fail-closed 로 중단하므로 예측도 발행 0 을 보여준다.
   */
  recoveryBroken: { queueId: string; problem: string }[]
}

/**
 * 며칠 뒤까지 몇 건이 나갈 수 있는가 — 🔴 **실제 러너의 동작을 그대로 재현한다.**
 *
 * · 큐 순서는 `compareAutoRow` 로 이미 정렬된 것을 받는다 (`selectAutoTargets` 통과분만)
 * · 하루에 `DAILY_CAP` 만큼만
 * · 🔴 **발행 대상은 `pickPublishTarget` 이 고른다 — 러너와 같은 함수다.**
 *   여기서 다시 구현하면 언젠가 한쪽만 고쳐지고, 그날 예측은 조용히 거짓말을 한다.
 *   배정이 없는 앞 글은 건너뛰되(그 글은 다음 회차에 다시 맨 앞이다), 한 회차 발행은 여전히 1건이다
 * · 가상 발행한 건 그 persona 의 `matchedAt` 에 더해 다음 날 계산에 반영한다
 */
/**
 * 왜 한 건도 못 나갔는가 — 🔴 **persona 조합 단위로 본다.**
 *
 * 🔴 입력은 **남은 후보 전체를 합친 것**이다 (2026-09-07). 맨 앞 글 하나만 보면,
 *    그 글이 생활사로 막혔을 때 뒤에 나갈 수 있는 글이 있어도 `LIFE_BLOCKED` 로 보인다.
 *
 * 전체 blocked 에서 "생활사가 하나라도 있나 / capacity 가 하나라도 있나" 를 따로 세면
 * 서로 다른 persona 의 사유가 섞인다. 그러면
 * `P1: NO_CHILDREN+WEEKLY_CAP · P2: NO_CHILDREN` 처럼 **아무도 시간이 지나서 풀리지 않는**
 * 경우가 CAPACITY_WAIT 로 잘못 읽힌다 — 기다리면 된다고 착각하게 된다.
 *
 * 규칙: **생활사 차단 없이 capacity 사유만 있는 persona 가 한 명이라도 있으면** 기다리면 풀린다.
 * 한 persona 에 `NO_CHILDREN + WEEKLY_CAP` 이 함께 있으면 그 사람은 시간이 지나도 못 맡는다.
 */
export function classifyHeadBlock(input: {
  eligibleCount: number
  /** persona 별 차단 사유 코드 묶음 */
  blocked: readonly (readonly string[])[]
}): BlockReason {
  // 🔴 후보가 있는데 배정이 안 됐다 = 배치에서 다른 글이 여력을 가져갔다
  if (input.eligibleCount > 0) return 'BATCH_EXHAUSTED'
  const waitable = input.blocked.some((reasons) =>
    !reasons.some((c) => LIFE_BLOCK_CODES.includes(c))
    && reasons.some((c) => CAPACITY_BLOCK_CODES.includes(c)))
  return waitable ? 'CAPACITY_WAIT' : 'LIFE_BLOCKED'
}

export function forecastPublishing(input: {
  /** 🔴 `selectAutoTargets` 를 통과한 자동 발행 후보만. legacy 는 이미 빠져 있다 */
  queue: readonly BatchDraft[]
  personas: readonly PersonaForMatch[]
  history: readonly PersonaHistory[]
  startAt: Date
  days: number
  /** 🔴 필수 — 러너의 DAILY_PUBLISH_CAP 을 주입받는다 */
  dailyCap: number
  /** 🔴 시뮬레이션용 cap. 운영은 넘기지 않아 `RUNTIME_PROFILE` 을 쓴다 */
  caps?: BatchCaps
}): Forecast {
  const cap = input.dailyCap
  // 🔴 이력을 복사해 쓴다 — 호출자의 배열을 바꾸지 않는다
  const hist: PersonaHistory[] = input.history.map((h) => ({ code: h.code, matchedAts: [...h.matchedAts] }))
  const remaining = [...input.queue]
  const days: ForecastDay[] = []
  let nextQueueId: string | null = null
  let nextPersonaCandidates: string[] = []
  let nextBlockReason: BlockReason = 'NONE'

  // ── 🔴 기존 배정이 깨졌는가 — 날짜를 밀기 **전에** 본다 ──
  //    러너는 이때 아무것도 발행하지 않고 멈춘다. 예측이 다른 글로 우회해 발행 건수를
  //    보여주면, 멈춘 레인이 초록으로 보이고 사람은 큐가 빌 때까지 모른다
  const recoveryBroken: { queueId: string; problem: string }[] = []
  {
    const probe = planBatch(input.queue, input.personas, input.caps ?? {})
    for (const a of probe.assignments) {
      if (a.recoveryProblem !== null) recoveryBroken.push({ queueId: a.queueId, problem: a.recoveryProblem })
    }
  }

  for (let i = 0; i < input.days; i += 1) {
    const at = new Date(input.startAt.getTime() + i * DAY_MS)
    const availableCodes = availablePersonasAt(hist, at, input.caps ?? {})
    const published: { queueId: string; persona: string }[] = []
    let blockedReason: BlockReason = 'NONE'
    let blockedQueueId: string | null = null

    for (let n = 0; n < cap; n += 1) {
      // 🔴 fail-closed — 러너와 같이 멈춘다. 우회하지 않는다
      if (recoveryBroken.length > 0) {
        blockedReason = 'RECOVERY_BROKEN'
        blockedQueueId = recoveryBroken[0]!.queueId
        if (i === 0 && n === 0) {
          nextQueueId = recoveryBroken[0]!.queueId
          nextPersonaCandidates = []
          nextBlockReason = 'RECOVERY_BROKEN'
        }
        break
      }
      if (remaining.length === 0) { blockedReason = 'NO_CANDIDATE'; break }

      // 🔴 그 시점의 여력을 persona 에 반영한다 — planBatch 는 postsThisWeek 로 여력을 본다
      const weekAgo = new Date(at.getTime() - 7 * DAY_MS)
      const personasNow: PersonaForMatch[] = input.personas.map((p) => {
        const h = hist.find((x) => x.code === p.code)
        const ats = h?.matchedAts ?? []
        const used = ats.filter((d) => d.getTime() >= weekAgo.getTime() && d.getTime() <= at.getTime()).length
        const last = ats.length === 0 ? null : ats.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b))
        return {
          ...p, postsThisWeek: used,
          daysSinceLastPost: last === null ? null : Math.floor((at.getTime() - last.getTime()) / DAY_MS),
        }
      })

      // 🔴 **남은 후보 전체**를 planBatch 에 넘긴다 — 러너가 그렇게 한다.
      //    head 하나만 넘기면 배치 여력 경쟁이 사라져 예측이 낙관적이 된다.
      const batch = planBatch(remaining, personasNow, input.caps ?? {})
      const assignOf = new Map(batch.assignments.map((a) => [a.queueId, a]))

      // 🔴 러너와 **같은 함수**로 고른다. 여기서 다시 고르지 않는다
      // 🔴 러너와 **같은 함수**로 고른다. 복구 우선 규칙도 함께 따라온다
      const { picked } = pickPublishTarget({
        ordered: remaining.map((d) => ({ id: d.queueId })),
        assignedOf: (id) => assignOf.get(id)?.assigned ?? null,
        isRecovery: (id) => assignOf.get(id)?.recovery === true,
      })

      if (i === 0 && n === 0) {
        nextQueueId = picked?.id ?? remaining[0]!.queueId
        const na = assignOf.get(nextQueueId)
        // 🔴 복구 행은 재계산을 하지 않으므로 `eligible` 이 비어 있다.
        //    그대로 쓰면 "배정 가능한 persona 0명" 으로 **거짓 표시**된다 —
        //    실제로는 기존 배정 한 명이 확정되어 있다
        nextPersonaCandidates = na?.recovery === true && na.assigned !== null
          ? [na.assigned]
          : (na?.eligible ?? []).map((c) => c.code)
      }

      if (picked === null) {
        // 🔴 한 건도 배정되지 않았다. 사유는 **남은 후보 전체**를 합쳐 판단한다
        blockedQueueId = remaining[0]!.queueId
        blockedReason = classifyHeadBlock({
          eligibleCount: Math.max(0, ...remaining.map((d) => assignOf.get(d.queueId)?.eligible.length ?? 0)),
          blocked: remaining.flatMap((d) => (assignOf.get(d.queueId)?.blocked ?? []).map((b) => b.reasons.map((r) => r.code))),
        })
        if (i === 0 && n === 0) nextBlockReason = blockedReason
        break
      }

      const plan = assignOf.get(picked.id)!
      const persona = plan.assigned!
      published.push({ queueId: picked.id, persona })
      // 🔴 나간 것만 뺀다. 건너뛴 앞 글은 그대로 줄에 남아 다음 날 다시 맨 앞이다
      remaining.splice(remaining.findIndex((d) => d.queueId === picked.id), 1)
      // 🔴 **기존 배정 행은 이력에 더하지 않는다.** 그 `matchedAt` 은 이미 `history` 에 들어 있다 —
      //    여기서 또 더하면 한 건이 두 번 세어져 그 persona 의 여력이 실제보다 적게 보인다
      if (!plan.recovery) {
        const h = hist.find((x) => x.code === persona)
        if (h !== undefined) h.matchedAts.push(at)
      }
      // 상한을 다 채웠으면 그 사유를 남긴다
      if (n === cap - 1) blockedReason = 'DAILY_CAP_DONE'
    }

    days.push({
      date: kstDateLabel(at), scheduledAt: at, availableCodes,
      published, blockedReason, blockedQueueId,
    })
  }

  const count = (ds: readonly ForecastDay[]): number => ds.reduce((a, d) => a + d.published.length, 0)
  const gaps = (ds: readonly ForecastDay[]): string[] => ds.filter((d) => d.published.length === 0).map((d) => d.date)
  return {
    days,
    in7: count(days.slice(0, 7)), in14: count(days),
    gapDates7: gaps(days.slice(0, 7)), gapDates14: gaps(days),
    nextQueueId, nextPersonaCandidates, nextBlockReason, recoveryBroken,
    nextScheduleAt: input.startAt,
    nextScheduleWillPublish: (days[0]?.published.length ?? 0) > 0,
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
  /** 🔴 release 프로필의 주 cap. 넘기지 않으면 가장 안전한 상수 */
  weeklyCap?: number
}): { theoreticalPerWeek: number; theoreticalPerDay: number; effectivePerDay: number } {
  const perWeek = input.activePersonas * (input.weeklyCap ?? POST_CAP_PER_WEEK)
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
  /** 🔴 release 프로필의 주 cap. 넘기지 않으면 가장 안전한 상수 */
  weeklyCap?: number
}): { min: number; max: number; shortfallMin: number; shortfallMax: number } {
  const weekCap = input.weeklyCap ?? POST_CAP_PER_WEEK
  const perWeek = input.targetPerDay * 7
  const min = Math.ceil(perWeek / weekCap)
  // 🔴 탈락률이 1 에 가까우면 나눗셈이 폭주한다 — 표본이 작을 때 그런 값이 나온다.
  //    "700명 필요" 같은 수는 근거가 아니라 잡음이다. 상한을 min 의 3배로 묶는다.
  const raw = Math.ceil(perWeek / weekCap / Math.max(0.05, 1 - input.lifeBlockRate))
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
 * 관제 화면이 "재고 초록" 만 보여주면 사람은 앞으로 며칠이 공백인지 모른다.
 * 🔴 숫자는 그날그날 다르다 — 이 주석에 특정 실측치를 박아 두면 며칠 뒤 거짓말이 된다.
 */
// 🔴 관제 화면과 **같은 Finding 타입**을 쓴다 — 두 벌이면 등급 규칙이 갈린다
export type CapacityFinding = Finding

export function judgeCapacity(input: {
  stockUsable: number
  in7: number
  nextWillPublish: boolean
  nextCandidates: number
  shortfallMin: number
  /** 🔴 명시적으로 받는다 — 기대량은 상한에 따라 달라진다 */
  dailyCap: number
  /** 🔴 기존 배정이 깨진 행 — 있으면 레인이 멈춰 있다 */
  recoveryBroken?: readonly { queueId: string; problem: string }[]
}): CapacityFinding[] {
  const out: CapacityFinding[] = []

  // 🔴 **가장 먼저 본다.** 이 상태에서는 다른 수치가 다 의미를 잃는다 —
  //    러너가 아무것도 발행하지 않고 멈추므로, "7일 N건 예상" 은 나오지 않을 숫자다
  const broken = input.recoveryBroken ?? []
  if (broken.length > 0) {
    out.push({
      level: 'CRITICAL', code: 'RECOVERY_BROKEN',
      message: `기존 배정을 쓸 수 없는 행 ${broken.length}건 — 러너가 멈춰 아무것도 나가지 않는다`
        + ` (${broken.map((b) => `${b.queueId}: ${b.problem}`).join(' · ')})`,
    })
    // 🔴 여기서 끝낸다. 뒤 판정은 "발행이 돌아간다" 를 전제하므로 섞으면 사람을 헷갈리게 한다
    return out
  }
  // 🔴 기대량은 상한 × 7 이다. 그 절반에 못 미치면 경고한다 —
  //    "다음 한 건은 나간다" 는 사실이 그 뒤 엿새가 막힌 것을 가리면 안 된다.
  const expected = input.dailyCap * 7
  const half = expected / 2

  // 🔴 7일 내내 0건이면 재고가 아무리 많아도 레인이 멈춘 것이다
  if (input.in7 === 0) {
    out.push({
      level: 'CRITICAL', code: 'FORECAST_EMPTY',
      message: `향후 7일 예상 발행 0건 — 재고 ${input.stockUsable}건이 있어도 나가지 못한다`,
    })
  } else if (input.in7 < half) {
    // 🔴 **경계는 "절반 미만" 이다.** 정확히 절반이면 경고하지 않는다 —
    //    상한이 홀수일 때 반올림 방향을 두고 헷갈리지 않도록 부등호를 하나로 못박는다.
    out.push({
      level: 'WARNING', code: 'FORECAST_LOW',
      message: `향후 7일 예상 ${input.in7}건 — 기대 ${expected}건의 절반(${half}건)에 못 미친다`,
    })
  }
  if (!input.nextWillPublish) {
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

/**
 * 🔴 **조합 단위**로 센다 — 사유 개수가 아니다.
 *
 * 한 조합(글 하나 × persona 한 명)에 차단 사유가 여러 개 붙을 수 있다.
 * 사유를 세면 "이유가 많은 조합" 이 비율을 끌어올려, 실제로는 몇 조합이 막혔는지 알 수 없다.
 * 분모는 **후보 × persona 조합 수**이고, 한 조합은 한 번만 센다.
 */
export function blockRatesByCombination(input: {
  candidates: number
  personas: number
  /** 조합별 차단 사유 코드들 — 막히지 않은 조합은 넣지 않는다 */
  blockedCombos: readonly (readonly string[])[]
}): {
  total: number; lifeBlocked: number; capacityBlocked: number
  lifeRate: number; capacityRate: number; eligible: number
} {
  const total = input.candidates * input.personas
  let life = 0
  let capacity = 0
  for (const reasons of input.blockedCombos) {
    // 🔴 생활사가 하나라도 있으면 그 조합은 **영구** 차단이다 — 시간이 지나도 안 풀린다
    if (reasons.some((c) => LIFE_BLOCK_CODES.includes(c))) life += 1
    else if (reasons.some((c) => CAPACITY_BLOCK_CODES.includes(c))) capacity += 1
  }
  return {
    total, lifeBlocked: life, capacityBlocked: capacity,
    lifeRate: total === 0 ? 0 : life / total,
    capacityRate: total === 0 ? 0 : capacity / total,
    eligible: total - life - capacity,
  }
}

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
