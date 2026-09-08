/**
 * 발행 규모 프로필 — 🔴 **capacity 와 공개 release 를 나눈다** (2026-09-08)
 *
 * 🔴 왜 나누는가.
 *    "몇 명을 준비했는가"(capacity)와 "실제로 몇 건을 공개하는가"(release)는 다른 결정이다.
 *    19명을 켜 두고도 공개는 1/day 로 두는 것이 정상이고, 그 반대는 사고다.
 *    한 값으로 묶으면 사람을 늘리는 순간 발행량이 따라 올라간다.
 *
 * 🔴 **운영 설정은 env 로 읽는다.** 예전 판은 `ACTIVE_PROFILE` 이 코드 리터럴이라
 *    규모를 바꿀 때마다 fixture 를 함께 고쳐야 했다 — 그 계약을 없앴다.
 *    설정을 읽지 못하면 **가장 안전한 단계로 떨어진다**(fail-closed).
 *
 * 🔴 이 파일은 계산만 한다. DB 도 네트워크도 없다. env 는 주입받는다.
 */

/** 🔴 재고를 며칠치로 잡는가 */
export const HORIZON_DAYS = 14

/** 🔴 이 구조가 답하는 상한 */
export const MAX_DAILY_TARGET = 100

// ─────────────────────────────────────────────────────────
// 🔴 rolling 7일 경계 — P1-4
// ─────────────────────────────────────────────────────────

/**
 * 🔴 최소 간격 `g` 일 때 **rolling 7일 창에 최대 몇 건**인가.
 *
 *    0일차에 쓰고 `g` 일마다 쓰면 7일 창에 `floor(6/g)+1` 건이 들어간다.
 *    예: g=3 → 0·3·6 일 = **3건**. 옛 판정 `g × w > 7` 은 이것을 9로 보고 거부했다 —
 *    가능한 조합을 막고 있었다.
 */
export function maxPostsPerWeek(minDaysBetween: number): number {
  if (!Number.isInteger(minDaysBetween) || minDaysBetween < 0) return 0
  if (minDaysBetween === 0) return Number.POSITIVE_INFINITY
  return Math.floor(6 / minDaysBetween) + 1
}

/** 🔴 실제로 쓸 수 있는 주간 상한 — 선언한 cap 과 간격이 허용하는 값 중 작은 쪽 */
export function effectiveWeeklyCap(postsPerWeek: number, minDaysBetween: number): number {
  return Math.min(postsPerWeek, maxPostsPerWeek(minDaysBetween))
}

// ─────────────────────────────────────────────────────────
// 🔴 슬롯 — P1-6
// ─────────────────────────────────────────────────────────

/** 🔴 분 단위다. 정시 배열로는 `00:05 KST` 를 표현할 수 없었다 */
export type Slot = { hour: number; minute: number; count: number }

/** `{hour, minute}` → 하루 중 분 */
export function minuteOfDay(s: { hour: number; minute: number }): number {
  return s.hour * 60 + s.minute
}

/** `HH:MM` */
export function slotLabel(s: { hour: number; minute: number }): string {
  return `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`
}

/** cron 표현 — 🔴 GitHub Actions 는 UTC 다. KST 는 +9 */
export function slotCronUtc(s: { hour: number; minute: number }): string {
  const utcHour = (s.hour - 9 + 24) % 24
  return `${s.minute} ${utcHour} * * *`
}

// ─────────────────────────────────────────────────────────

export type ScaleProfile = {
  /** 하루 몇 건 */
  dailyTarget: number
  /** persona 한 명이 주에 몇 건까지 (선언값) */
  postsPerWeek: number
  /** 같은 persona 가 다시 쓰기까지 최소 며칠 */
  minDaysBetween: number
  /** 🔴 분 단위 슬롯. 합이 `dailyTarget` 이어야 한다 */
  slots: readonly Slot[]
}

/**
 * 🔴 **공개 release 단계 allowlist.**
 *    운영 설정이 이 중 하나를 고른다. 임의 숫자를 받지 않는다 —
 *    슬롯·간격·인원이 함께 검증된 조합만 연다.
 */
export const RELEASE_STAGES = ['d1', 'd3', 'd5', 'd10'] as const
export type ReleaseStage = (typeof RELEASE_STAGES)[number]

/** 🔴 가장 안전한 단계 — 설정을 읽지 못하면 여기로 떨어진다 */
export const SAFEST_STAGE: ReleaseStage = 'd1'

/**
 * 🔴 단계별 프로필. `d10` 의 `postsPerWeek: 5` 는 **실측**이다 —
 *    Pool 19명·주 4건에서 14일 135/140 이었고, 주 5건에서 140/140 이 됐다.
 *    산술 하한(`ceil(70/4)=18명`)은 생활사 hardFilter 를 반영하지 못한다.
 */
export const PROFILES: Readonly<Record<ReleaseStage, ScaleProfile>> = {
  // 🔴 지금 운영 중 — `auto-publish.yml` 의 `5 15 * * *` = 00:05 KST 와 정확히 같다
  d1: { dailyTarget: 1, postsPerWeek: 1, minDaysBetween: 5, slots: [{ hour: 0, minute: 5, count: 1 }] },
  d3: {
    dailyTarget: 3, postsPerWeek: 3, minDaysBetween: 2,
    slots: [{ hour: 0, minute: 5, count: 1 }, { hour: 9, minute: 20, count: 1 }, { hour: 19, minute: 40, count: 1 }],
  },
  d5: {
    dailyTarget: 5, postsPerWeek: 4, minDaysBetween: 1,
    slots: [
      { hour: 0, minute: 5, count: 1 }, { hour: 8, minute: 15, count: 1 }, { hour: 12, minute: 35, count: 1 },
      { hour: 17, minute: 10, count: 1 }, { hour: 21, minute: 45, count: 1 },
    ],
  },
  d10: {
    dailyTarget: 10, postsPerWeek: 5, minDaysBetween: 1,
    slots: [
      { hour: 0, minute: 5, count: 1 }, { hour: 7, minute: 20, count: 1 }, { hour: 9, minute: 10, count: 1 },
      { hour: 11, minute: 35, count: 1 }, { hour: 13, minute: 25, count: 1 }, { hour: 15, minute: 50, count: 1 },
      { hour: 17, minute: 15, count: 1 }, { hour: 19, minute: 40, count: 1 }, { hour: 21, minute: 5, count: 1 },
      { hour: 22, minute: 30, count: 1 },
    ],
  },
}

// ─────────────────────────────────────────────────────────
// 🔴 운영 설정 — env 주입. 코드 리터럴이 아니다
// ─────────────────────────────────────────────────────────

/** 공개 release 단계를 정하는 env 이름 */
export const RELEASE_ENV = 'SORAN_RELEASE_STAGE'
/** 준비된 capacity 단계 — 사람을 몇 단계까지 켜 뒀는가 */
export const CAPACITY_ENV = 'SORAN_CAPACITY_STAGE'

export type StageResolution = {
  stage: ReleaseStage
  /** 설정이 그대로 쓰였는가 */
  fromEnv: boolean
  /** 안전 단계로 떨어졌다면 그 이유 */
  fallbackReason: string | null
}

/**
 * 🔴 env → 단계. **모르는 값은 안전 단계로 떨어진다.**
 *    "설정이 이상하니 일단 많이 낸다" 는 없다.
 */
export function resolveStage(raw: string | undefined, label = 'release'): StageResolution {
  const v = (raw ?? '').trim()
  if (v === '') return { stage: SAFEST_STAGE, fromEnv: false, fallbackReason: `${label} 설정이 없다 — 가장 안전한 ${SAFEST_STAGE} 로 둔다` }
  if (!(RELEASE_STAGES as readonly string[]).includes(v)) {
    return { stage: SAFEST_STAGE, fromEnv: false, fallbackReason: `${label} 설정 "${v}" 는 허용 단계가 아니다 (${RELEASE_STAGES.join('·')}) — ${SAFEST_STAGE} 로 둔다` }
  }
  return { stage: v as ReleaseStage, fromEnv: true, fallbackReason: null }
}

/** 단계 순서 비교 — 공개량이 준비량을 넘지 못하게 한다 */
export function stageRank(s: ReleaseStage): number {
  return RELEASE_STAGES.indexOf(s)
}

export type ProfileProblem = string

/** 🔴 프로필이 자기모순이 아닌가 — rolling 경계로 본다 */
export function verifyProfile(p: ScaleProfile): ProfileProblem[] {
  const out: ProfileProblem[] = []
  if (!Number.isInteger(p.dailyTarget) || p.dailyTarget < 1 || p.dailyTarget > MAX_DAILY_TARGET) {
    out.push(`dailyTarget ${p.dailyTarget} — 1~${MAX_DAILY_TARGET} 정수여야 한다`)
  }
  if (!Number.isInteger(p.postsPerWeek) || p.postsPerWeek < 1) out.push(`postsPerWeek ${p.postsPerWeek} — 1 이상 정수`)
  if (!Number.isInteger(p.minDaysBetween) || p.minDaysBetween < 0) out.push(`minDaysBetween ${p.minDaysBetween} — 0 이상 정수`)
  // 🔴 rolling 7일 경계 — `g × w > 7` 이 아니다
  const max = maxPostsPerWeek(p.minDaysBetween)
  if (Number.isFinite(max) && p.postsPerWeek > max) {
    out.push(`주 ${p.postsPerWeek}건인데 간격 ${p.minDaysBetween}일로는 7일에 최대 ${max}건 — 도달할 수 없다`)
  }
  if (p.slots.length === 0) out.push('slots 가 비었다')
  for (const s of p.slots) {
    if (!Number.isInteger(s.hour) || s.hour < 0 || s.hour > 23) out.push(`슬롯 시각 ${s.hour} — 0~23`)
    if (!Number.isInteger(s.minute) || s.minute < 0 || s.minute > 59) out.push(`슬롯 분 ${s.minute} — 0~59`)
    if (!Number.isInteger(s.count) || s.count < 1) out.push(`슬롯 ${slotLabel(s)} count ${s.count} — 1 이상`)
  }
  const mins = p.slots.map(minuteOfDay)
  if (new Set(mins).size !== mins.length) out.push('같은 시각 슬롯이 두 번 있다')
  const total = p.slots.reduce((n, s) => n + s.count, 0)
  if (total !== p.dailyTarget) out.push(`슬롯 합 ${total} ≠ 목표 ${p.dailyTarget}`)
  return out
}

export type Derived = {
  dailyPublishCap: number
  stockTarget: number
  stockMin: number
  stockWarn: number
  /** 🔴 산술 최소 인원 — 실제 검증치가 아니다 */
  personasNeededArithmetic: number
  /** 간격까지 반영한 실효 주간 상한 */
  effectiveWeeklyCap: number
  postsInHorizon: number
  slotCount: number
}

export function derive(p: ScaleProfile): Derived {
  const eff = effectiveWeeklyCap(p.postsPerWeek, p.minDaysBetween)
  return {
    dailyPublishCap: p.dailyTarget,
    stockTarget: p.dailyTarget * HORIZON_DAYS,
    stockMin: Math.max(1, Math.ceil(p.dailyTarget * 5)),
    stockWarn: Math.max(1, Math.ceil(p.dailyTarget * 3)),
    // 🔴 **산술값이다.** 생활사 hardFilter 를 반영하지 않는다 —
    //    READY 판정에 이 값만 쓰면 안 된다 (`scale-readiness` 가 시뮬레이션으로 판정한다)
    personasNeededArithmetic: Math.ceil((p.dailyTarget * 7) / eff),
    effectiveWeeklyCap: eff,
    postsInHorizon: p.dailyTarget * HORIZON_DAYS,
    slotCount: p.slots.length,
  }
}

/** 🔴 슬롯을 시각순으로 펴서 하나씩 — 중복 실행에도 전역 cap 이 지켜지는지 계산에 쓴다 */
export function expandSlots(p: ScaleProfile): { minuteOfDay: number; label: string; index: number }[] {
  const out: { minuteOfDay: number; label: string; index: number }[] = []
  let i = 0
  for (const s of [...p.slots].sort((a, b) => minuteOfDay(a) - minuteOfDay(b))) {
    for (let k = 0; k < s.count; k += 1) { out.push({ minuteOfDay: minuteOfDay(s), label: slotLabel(s), index: i }); i += 1 }
  }
  return out
}

export function describeProfile(p: ScaleProfile): string {
  const d = derive(p)
  return `${p.dailyTarget}/day · 주 ${p.postsPerWeek}건(실효 ${d.effectiveWeeklyCap}) · 최소 ${p.minDaysBetween}일`
    + ` · 재고 ${d.stockTarget}건 · 슬롯 ${p.slots.map(slotLabel).join(' ')}`
}

// ─────────────────────────────────────────────────────────
// 🔴 단계 감속 — **여기 한 곳에서만 정한다** (2026-09-08)
//
//    준비도 판정(`scale-readiness`)과 런타임 해석(`scale-runtime`) 이 각자 감속하면
//    화면이 말하는 단계와 실제로 쓰이는 단계가 갈린다 — 그것이 P0-1 결함이었다.
//    이 파일은 아무것도 import 하지 않으므로 양쪽이 순환 없이 같은 함수를 쓸 수 있다.
// ─────────────────────────────────────────────────────────

/** 한 단계가 지금 달성 가능한가 — 판정 근거는 호출부(시뮬레이션)가 만든다 */
export type StageVerdict = { stage: ReleaseStage; ready: boolean; reasons: readonly string[] }

/**
 * 🔴 요청 단계가 준비되지 않았으면 **ready 인 가장 높은 하위 단계**로 내린다.
 *    아무 단계도 준비되지 않았으면 가장 안전한 단계다.
 *
 *    🔴 판정이 아예 없으면(`verdicts` 가 비었으면) **감속하지 않는다** —
 *    "모른다" 를 "준비됐다" 로도 "실패" 로도 읽지 않는다. 모를 때의 안전장치는
 *    호출부가 정한다(운영 러너는 판정을 반드시 만들어 넘긴다).
 */
export type SafeStage = {
  stage: ReleaseStage
  throttled: boolean
  reason: string | null
  /**
   * 🔴 **고른 단계가 실제로 달성 가능한가.**
   *
   *    최저 단계마저 미달이면 `stage` 는 여전히 d1 이고 `throttled` 는 false 다
   *    (더 내려갈 곳이 없으므로). 그 상태에서 "달성 가능" 이라고 적으면
   *    화면이 미달을 초록으로 보여 준다 — 실제로 그런 모순이 나왔다.
   *    그래서 **고른 단계의 준비 여부를 따로 들고 다닌다.**
   */
  chosenReady: boolean
  /** 판정을 받지 못했다 (모른다). `chosenReady` 를 신뢰하지 않는다 */
  unknown: boolean
}

export function safeStageFor(requested: ReleaseStage, verdicts: readonly StageVerdict[]): SafeStage {
  if (verdicts.length === 0) {
    return { stage: requested, throttled: false, reason: null, chosenReady: false, unknown: true }
  }
  const byStage = new Map(verdicts.map((v) => [v.stage, v]))
  if (byStage.get(requested)?.ready === true) {
    return { stage: requested, throttled: false, reason: null, chosenReady: true, unknown: false }
  }
  const lower = [...RELEASE_STAGES].filter((s) => stageRank(s) <= stageRank(requested)).reverse()
  for (const s of lower) {
    if (byStage.get(s)?.ready === true) {
      return {
        stage: s, throttled: s !== requested, chosenReady: true, unknown: false,
        reason: s === requested ? null
          : `${requested} 는 준비되지 않았다 (${(byStage.get(requested)?.reasons ?? ['판정 없음']).join(' / ')}) — ${s} 로 감속`,
      }
    }
  }
  // 🔴 최저 단계마저 미달이다. 더 내려갈 곳이 없으니 d1 을 유지하되 **NOT_READY 로 말한다**
  return {
    stage: SAFEST_STAGE, throttled: requested !== SAFEST_STAGE,
    chosenReady: false, unknown: false,
    reason: `어느 단계도 준비되지 않았다 — 가장 안전한 ${SAFEST_STAGE} 를 유지하지만 그 단계도 미달이다`
      + ` (${(byStage.get(SAFEST_STAGE)?.reasons ?? ['판정 없음']).join(' / ')})`,
  }
}

// ─────────────────────────────────────────────────────────
// 🔴 시간축 — **두 개다. 섞으면 준비도가 부풀거나 깎인다** (2026-09-08)
//
//    ① `nextSlotAnchor`   그 단계의 **다음 실제 발행 슬롯**. 러너·화면이 "다음에 언제
//       나가는가" 를 말할 때 쓴다. 오늘 몫이 남았으면 오늘, 다 채웠으면 내일이다.
//
//    ② `horizonStart`     **준비도 14일 지평의 시작점.** 언제나 다음 KST 운영일 0시다.
//
//    🔴 왜 나눠야 하는가 — ②에 ①을 쓰면 두 가지가 동시에 깨진다.
//       · **오늘 몫이 한 번 더 계산된다.** d10 에서 오늘 3건을 내고 13:25 를 시작점으로
//         잡으면, 예측기는 그 지점부터 하루를 세어 **오늘 하루에 10건을 다시 배정**한다
//         (= 오늘 13건). 재고·인원이 실제보다 넉넉해 보인다.
//       · **단계 비교가 성립하지 않는다.** d1 은 내일 00:05, d10 은 오늘 13:25 가 되어
//         서로 다른 창(그것도 반나절짜리 조각 하루가 섞인 창)을 비교하게 된다.
//
//    🔴 그래서 지평은 **모든 단계가 같은, 완전한 KST 운영일 14일**이다.
//       오늘(이미 일부가 지나갔고 이미 일부를 낸 날)은 지평에 넣지 않는다.
// ─────────────────────────────────────────────────────────

const DAY_MS = 86_400_000
const KST_OFFSET_MS = 9 * 3600_000

/** KST 자정 (UTC Date) — 하루 경계는 러너와 같아야 한다 */
export function kstMidnight(now: Date): Date {
  const k = new Date(now.getTime() + KST_OFFSET_MS)
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KST_OFFSET_MS)
}

/**
 * 🔴 그 단계의 **다음 실제 발행 슬롯**.
 *
 *    · 오늘 이미 그 단계의 하루 상한을 채웠으면 → 내일 첫 슬롯
 *    · 아니면 오늘 남은 슬롯 중 `now` 이후 첫 번째, 없으면 내일 첫 슬롯
 *
 *    🔴 슬롯이 여러 건을 내는 경우(`count > 1`)도 슬롯 단위로 본다 —
 *       한 슬롯이 3건을 내면 그 슬롯 하나가 3건을 담당한다.
 */
export function nextSlotAnchor(p: ScaleProfile, input: { now: Date; publishedToday: number }): Date {
  const midnight = kstMidnight(input.now)
  const minutes = [...p.slots].map(minuteOfDay).sort((a, b) => a - b)
  const first = minutes[0] ?? 0
  if (minutes.length === 0) return new Date(midnight.getTime() + DAY_MS)
  // 🔴 오늘 상한을 채웠으면 오늘 남은 슬롯은 의미가 없다
  if (input.publishedToday >= p.dailyTarget) {
    return new Date(midnight.getTime() + DAY_MS + first * 60_000)
  }
  const elapsed = Math.floor((input.now.getTime() - midnight.getTime()) / 60_000)
  const next = minutes.find((m) => m > elapsed)
  return next === undefined
    ? new Date(midnight.getTime() + DAY_MS + first * 60_000)
    : new Date(midnight.getTime() + next * 60_000)
}

/**
 * 🔴 **준비도 지평의 시작점 — 다음 KST 운영일 0시.**
 *
 *    · 단계에 의존하지 않는다. d1·d3·d5·d10 이 **같은 창**을 본다
 *    · 오늘은 지평에 들어가지 않는다 — 이미 일부가 지나갔고 이미 일부를 냈다.
 *      조각 하루를 하루로 세면 그날 상한이 두 번 계산된다
 *    · 그래서 `publishedToday` 를 보지 않는다. 오늘 몫은 지평 밖이라 뺄 것도 더할 것도 없다
 *
 *    🔴 이 값이 `nextSlotAnchor` 와 같아지면 위 두 성질이 깨진다. fixture 가 그것을 본다.
 */
export function horizonStart(now: Date): Date {
  return new Date(kstMidnight(now).getTime() + DAY_MS)
}

/** 🔴 지평이 덮는 KST 운영일 수 — 재고 지평과 같은 값이어야 한다 */
export const HORIZON_ANCHOR_DAYS = HORIZON_DAYS

/** 🔴 주입을 잊었을 때 쓰이는 값. 지금 운영값과 정확히 같다 */
export const SAFEST_PROFILE: ScaleProfile = PROFILES[SAFEST_STAGE]
