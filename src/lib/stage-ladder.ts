/**
 * 🔴 **단계는 사람이 날짜를 바꿔 주지 않아도 오르내려야 한다** (2026-09-24)
 *
 *   지금 운영: `SORAN_RELEASE_CANARY_DATE` 를 **매일** 손으로 바꾸고,
 *   `SORAN_RELEASE_WINDOW_FROM/UNTIL` 을 **주마다** 갱신한다. 사람이 하루 잊으면
 *   그날은 조용히 d1 로 떨어진다. 반대로 올려 둔 값을 잊으면 재고·화자가 말라도
 *   단계가 그대로 남는다 — 2026-09-24 실측: capacity 만 d5 로 올리고 공급 쪽
 *   canonical 을 d3 로 둔 채 하루가 갔고, 화자 여력이 0명이 되어 후보가 0건이었다.
 *
 * 🔴 **이 파일은 순수 함수다.** DB·env·파일을 모른다 — 관측치를 받아 **다음 단계**만 낸다.
 *    그래야 러너·관제·검사가 같은 답을 낸다.
 *
 * 🔴 **한 번에 한 칸만 움직인다.** 재고가 아무리 많아도 d1 → d10 으로 뛰지 않는다.
 *    올라간 단계가 유지되는지 하루 더 보고 다음 칸으로 간다.
 */
import {
  PROFILES, RELEASE_STAGES, SAFEST_STAGE, stageRank, type ReleaseStage,
} from './scale-profile'

/**
 * 🔴 **한 단계를 유지하려면 있어야 하는 것.**
 *    `dailyTarget` 에서 파생하지 않고 **명시**한다 — 파생하면 프로필을 손댈 때
 *    요구치가 조용히 따라 움직여서, 무엇이 기준이었는지 뒤에 알 수 없다.
 */
export type StageRequirement = {
  /** 사람이 검토를 마친 발행 가능 재고 (`decidedBy` 가 machine: 이 아닌 행) */
  readyStock: number
  /** 그날 배정 가능한 화자 수 — 슬롯을 채우려면 서로 다른 사람이 필요하다 */
  eligibleSpeakers: number
  /** 🔴 **올라가기 전에** 이 상태가 며칠 연속이어야 하는가 */
  goodDaysToEnter: number
}

/**
 * 🔴 **요구치는 슬롯 수보다 넉넉하다.** 딱 맞게 두면 하루만 어긋나도 곧바로 감속한다 —
 *    올랐다 내렸다 하는 것이 사람 눈에는 "글이 들쭉날쭉한 커뮤니티" 로 보인다.
 */
export const STAGE_REQUIREMENTS: Readonly<Record<ReleaseStage, StageRequirement>> = Object.freeze({
  d1: { readyStock: 1, eligibleSpeakers: 1, goodDaysToEnter: 0 },
  d3: { readyStock: 6, eligibleSpeakers: 3, goodDaysToEnter: 2 },
  d5: { readyStock: 15, eligibleSpeakers: 5, goodDaysToEnter: 3 },
  d10: { readyStock: 40, eligibleSpeakers: 8, goodDaysToEnter: 5 },
})

/** 🔴 안전·비용은 **올리는 조건이 아니라 내리는 조건**이다 */
export type LadderSafety = {
  /** 발행 전 사람 검토를 기다리는 건수 */
  auditPending: number
  /** 그날 하드 차단이 몇 건 있었나 */
  hardBlocks: number
}

export type LadderObservation = {
  /** 판정 기준 KST 날짜 — 스냅샷에 그대로 남는다 */
  kstDate: string
  /** 지금 지속 단계 */
  currentStage: ReleaseStage
  readyStock: number
  eligibleSpeakers: number
  /** 그날 이미 낸 편수 */
  publishedToday: number
  /**
   * 🔴 **현 단계 요구를 연속으로 충족한 날 수** (오늘 포함 전까지).
   *    부르는 쪽이 기록에서 센다 — 이 파일은 과거를 모른다.
   */
  goodDays: number
  safety: LadderSafety
  /** 그날 쓴 금액과 상한 */
  costUsdToday: number
  budgetUsd: number
}

export const LADDER_DIRECTIONS = ['up', 'hold', 'down'] as const
export type LadderDirection = (typeof LADDER_DIRECTIONS)[number]

export type LadderDecision = {
  stage: ReleaseStage
  direction: LadderDirection
  /** 왜 그렇게 정했나 — 사람이 읽는 줄 */
  reasons: string[]
  /** 🔴 다음 칸에 가려면 무엇이 얼마나 모자란가 — 값으로 낸다 */
  needs: string[]
  /** 🔴 그날 이미 낸 것 때문에 단계를 내리지 못했는가 */
  dayPinned: boolean
}

const next = (s: ReleaseStage): ReleaseStage | null => {
  const i = RELEASE_STAGES.indexOf(s)
  return i < 0 || i + 1 >= RELEASE_STAGES.length ? null : RELEASE_STAGES[i + 1]!
}
const prev = (s: ReleaseStage): ReleaseStage | null => {
  const i = RELEASE_STAGES.indexOf(s)
  return i <= 0 ? null : RELEASE_STAGES[i - 1]!
}

/** 🔴 그 단계를 **버틸 수 있는가** — 올라갈 수 있는가와 다르다(연속일수는 보지 않는다) */
export function sustains(o: LadderObservation, s: ReleaseStage): { ok: boolean; missing: string[] } {
  const r = STAGE_REQUIREMENTS[s]
  const missing: string[] = []
  if (o.readyStock < r.readyStock) missing.push(`재고 ${o.readyStock}/${r.readyStock}`)
  if (o.eligibleSpeakers < r.eligibleSpeakers) {
    missing.push(`화자 ${o.eligibleSpeakers}/${r.eligibleSpeakers}`)
  }
  return { ok: missing.length === 0, missing }
}

/**
 * 🔴 **다음 단계를 정한다.**
 *
 *    ① 안전·비용이 걸리면 무조건 감속한다 — 올릴 이유가 아무리 많아도 먼저다
 *    ② 현 단계를 못 버티면 한 칸 내린다
 *    ③ 다음 칸을 버틸 수 있고 연속일수를 채웠으면 한 칸 올린다
 *    ④ 그 밖에는 유지한다
 *
 * 🔴 **그날 이미 냈으면 내리지 않는다.** 아침에 3편을 내고 낮에 d1 로 내려가면
 *    이미 나간 그 3편이 상한 초과가 된다 — 기존 `resolveScale` 과 같은 계약이다.
 */
export function planStage(o: LadderObservation): LadderDecision {
  const reasons: string[] = []
  const needs: string[] = []
  const cur = o.currentStage
  const down = prev(cur)
  const up = next(cur)

  /** 🔴 그날 이미 낸 편수가 내리려는 단계의 상한을 넘으면 내릴 수 없다 */
  const pinnedBy = (to: ReleaseStage): boolean => o.publishedToday > PROFILES[to].dailyTarget
  const godown = (why: string): LadderDecision => {
    if (down === null) {
      reasons.push(`${why} — 이미 가장 낮은 단계 ${cur} 다`)
      return { stage: cur, direction: 'hold', reasons, needs, dayPinned: false }
    }
    if (pinnedBy(down)) {
      reasons.push(`${why} — 그러나 오늘 이미 ${o.publishedToday}건 냈다`)
      reasons.push(`🔴 ${down} 으로 내리면 이미 낸 것이 상한 초과가 된다 — 오늘은 ${cur} 를 고정한다`)
      return { stage: cur, direction: 'hold', reasons, needs, dayPinned: true }
    }
    reasons.push(`${why} — ${cur} → ${down} 으로 한 칸 내린다`)
    return { stage: down, direction: 'down', reasons, needs, dayPinned: false }
  }

  // ① 안전 — 사람 검토 적체·하드 차단은 올릴 이유를 이긴다
  if (o.safety.hardBlocks > 0) {
    return godown(`🔴 하드 차단 ${o.safety.hardBlocks}건`)
  }
  /**
   * 🔴 **검토 적체는 단계에 비례한다.** d10 에서 10건 밀린 것과 d1 에서 10건 밀린 것은
   *    다르다 — 그날 목표의 2배를 넘으면 사람이 따라오지 못하는 것이다.
   */
  const auditCap = PROFILES[cur].dailyTarget * 2
  if (o.safety.auditPending > auditCap) {
    return godown(`🔴 사람 검토 대기 ${o.safety.auditPending}건 > ${cur} 허용 ${auditCap}건`)
  }
  // ① -b 비용 — 상한을 넘겼으면 내린다
  if (o.budgetUsd > 0 && o.costUsdToday > o.budgetUsd) {
    return godown(`🔴 당일 비용 $${o.costUsdToday.toFixed(4)} > 상한 $${o.budgetUsd.toFixed(2)}`)
  }

  // ② 현 단계를 못 버티는가
  const now = sustains(o, cur)
  if (!now.ok) return godown(`🔴 ${cur} 를 버티지 못한다 — ${now.missing.join(' · ')}`)

  // ③ 한 칸 올릴 수 있는가
  if (up === null) {
    reasons.push(`${cur} 가 가장 높은 단계다 — 유지한다`)
    return { stage: cur, direction: 'hold', reasons, needs, dayPinned: false }
  }
  const upOk = sustains(o, up)
  const needDays = STAGE_REQUIREMENTS[up].goodDaysToEnter
  if (!upOk.ok) needs.push(...upOk.missing.map((m) => `${up}: ${m}`))
  if (o.goodDays < needDays) needs.push(`${up}: 연속 충족 ${o.goodDays}/${needDays}일`)
  if (upOk.ok && o.goodDays >= needDays) {
    reasons.push(`🟢 ${up} 요구를 충족했고 ${o.goodDays}일 연속이다 — ${cur} → ${up} 한 칸 올린다`)
    return { stage: up, direction: 'up', reasons, needs: [], dayPinned: false }
  }
  reasons.push(`${cur} 를 유지한다 — 다음 칸까지 ${needs.join(' · ') || '조건 없음'}`)
  return { stage: cur, direction: 'hold', reasons, needs, dayPinned: false }
}

/**
 * 🔴 **관측을 못 했으면 올리지 않는다** (fail-closed).
 *    값이 하나라도 비면 가장 안전한 단계로 내려간다 — "모른다" 를 "괜찮다" 로 읽지 않는다.
 */
export function planStageSafe(o: Partial<LadderObservation>): LadderDecision {
  const missing = (['currentStage', 'readyStock', 'eligibleSpeakers', 'publishedToday',
    'goodDays', 'safety', 'costUsdToday', 'budgetUsd'] as const)
    .filter((k) => o[k] === undefined || o[k] === null)
  if (missing.length > 0) {
    return {
      stage: SAFEST_STAGE, direction: stageRank(o.currentStage ?? SAFEST_STAGE) > stageRank(SAFEST_STAGE)
        ? 'down' : 'hold',
      reasons: [`🔴 관측값이 없다(${missing.join(' · ')}) — 가장 안전한 ${SAFEST_STAGE} 로 둔다`],
      needs: [], dayPinned: false,
    }
  }
  return planStage(o as LadderObservation)
}
