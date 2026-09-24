/**
 * 🔴 **단계 결정은 정본이 이미 갖고 있다 — 새 규칙도 새 숫자도 만들지 않는다** (2026-09-24 3차)
 *
 *   이 파일이 하는 일은 **정본 넷을 한 결정으로 묶는 것**뿐이다.
 *   ```
 *   judgeOneDayCanary (release-canary)   오늘 하루 그 단계로 낼 수 있는가   → TRIAL
 *   judgePromotion    (d100-capacity)    지속 승격(stable+preflight)        → SUSTAIN / PREPARE
 *   stageVerdicts     (scale-readiness)  14일 지속 readiness (실제 배정 시뮬)
 *   safeStageFor      (scale-profile)    감속
 *   ```
 *
 * 🔴 **capacity 와 release 는 다른 눈금이다** (2026-09-24 마스터 지적).
 *   · `capacity` — **다음 단계 재고를 준비하는 내부 생산 눈금.** 공개보다 앞서 갈 수 있다.
 *   · `release`  — **실제 공개 단계.** capacity 를 넘지 못한다.
 *   D3 로 공개하면서 capacity D5 로 재고를 쌓는 것이 정상 운영이다 —
 *   두 값을 늘 같게 돌려주면 그 상태를 표현할 수 없다.
 *
 * 🔴 **지속 readiness 와 하루 시험을 섞지 않는다.**
 *   2026-09-24 실제: 지속 14일 readiness 는 **미달**인데 D5 는 **하루짜리 canary 로 GO** 였다.
 *   7일 안정화는 *지속 승격* 조건이지 *하루 시험*의 선행조건이 아니다.
 *
 * 🔴 공급 생성 가용성은 결정에 쓰지 않는다 — 발행 배정 가능성과 다른 값이다.
 */
import {
  PROFILES, RELEASE_STAGES, SAFEST_STAGE, safeStageFor, stageRank,
  type ReleaseStage, type StageVerdict,
} from './scale-profile'
import type { CanaryVerdict } from './release-canary'
import type { PromotionVerdict } from './d100-capacity'

export const STAGE_DECISION_VERSION = 'stage-decision-v2'

/**
 * 🔴 **전환 상태 넷.** 하나의 stage 값으로는 "지금 무엇을 하는 중인가" 를 말할 수 없다.
 *   · `SUSTAIN`  — 지속 승격 조건을 채웠다. 공개 단계를 올린다
 *   · `TRIAL`    — 지속은 아직이지만 **오늘 하루** 그 단계로 낼 수 있다
 *   · `PREPARE`  — 공개는 지금 단계, **capacity 만** 다음 단계로 올려 재고를 쌓는다
 *   · `HOLD`     — 셋 다 아니다
 */
export const TRANSITION_STATES = ['SUSTAIN', 'TRIAL', 'PREPARE', 'HOLD'] as const
export type TransitionState = (typeof TRANSITION_STATES)[number]

/** 🔴 보고용 신호 — 결정에 쓰지 않는다 */
export type SupplySignal = {
  eligibleSpeakers: number
  excluded: { reason: 'noOpenDay' | 'holdingStock'; codes: string[] }[]
}

export type StageInputs = {
  kstDate: string
  /** 지금 공개 단계 */
  currentRelease: ReleaseStage
  /** 지금 내부 생산 눈금 */
  currentCapacity: ReleaseStage
  /** 🔴 정본 `stageVerdicts` — 14일 지속 readiness */
  verdicts: readonly StageVerdict[]
  /** 🔴 정본 `judgeOneDayCanary` — 오늘 하루 판정. 없으면 `null`(못 물었다) */
  today: CanaryVerdict | null
  /** 🔴 정본 `judgePromotion` — 지속 승격. 없으면 `null` */
  promotion: PromotionVerdict | null
  publishedToday: number
  supply?: SupplySignal
  decidedAt: string
}

export type StageDecision = {
  kstDate: string
  capacity: ReleaseStage
  release: ReleaseStage
  state: TransitionState
  reasons: string[]
  dayPinned: boolean
  supply: SupplySignal | null
  decidedAt: string
  contractVersion: typeof STAGE_DECISION_VERSION
}

const next = (s: ReleaseStage): ReleaseStage | null => {
  const i = RELEASE_STAGES.indexOf(s)
  return i < 0 || i + 1 >= RELEASE_STAGES.length ? null : RELEASE_STAGES[i + 1]!
}

/**
 * 🔴 **정본 넷을 한 결정으로 묶는다.**
 *
 *   ① `judgePromotion.ready`               → **SUSTAIN**
 *   ② `judgeOneDayCanary.ok`               → **TRIAL** (오늘만 공개를 올린다)
 *   ③ `judgePromotion.nextPreflight.ready` → **PREPARE** (capacity 만 올린다)
 *   ④ 그 밖                                 → **HOLD**
 *   ⑤ 감속은 `safeStageFor`, 그날 이미 낸 편수는 고정
 *
 * 🔴 여기서 새 문턱값을 만들지 않는다 — 판정은 전부 정본이 낸 것이다.
 */
export function planStageDecision(input: StageInputs): StageDecision {
  const base = {
    kstDate: input.kstDate,
    supply: input.supply ?? null,
    decidedAt: input.decidedAt,
    contractVersion: STAGE_DECISION_VERSION,
  } as const
  const reasons: string[] = []
  const up = next(input.currentRelease)
  const upCap = next(input.currentCapacity)

  /**
   * 🔴 **새 KST 날짜에 판정이 하나도 없으면 d1 이다** (fail-closed).
   *    빈 verdict 를 근거로 어제의 D5 를 이어 가지 않는다 — 모르는 것은 근거가 아니다.
   */
  if (input.verdicts.length === 0 && input.today === null) {
    return {
      ...base, capacity: SAFEST_STAGE, release: SAFEST_STAGE, state: 'HOLD', dayPinned: false,
      reasons: [`🔴 ${input.kstDate} 판정이 하나도 없다 — 가장 안전한 ${SAFEST_STAGE} 로 둔다`],
    }
  }

  let release = input.currentRelease
  let capacity = input.currentCapacity
  let state: TransitionState = 'HOLD'

  if (input.promotion?.ready === true && up !== null) {
    // ── ① 지속 승격 ──
    release = up
    capacity = next(up) ?? up
    state = 'SUSTAIN'
    reasons.push(`🟢 지속 승격 조건 충족(정본 judgePromotion) — 공개 ${input.currentRelease} → ${up}`)
  } else if (input.today?.ok === true) {
    /**
     * ── ② 하루 시험 ──
     * 🔴 지속 readiness 가 미달이어도 **오늘 하루는** 낼 수 있다.
     *    7일 안정화는 지속 승격 조건이지 하루 시험의 선행조건이 아니다.
     */
    release = input.today.stage
    state = 'TRIAL'
    reasons.push(`🟢 오늘 하루 ${input.today.stage} 로 낼 수 있다(정본 judgeOneDayCanary)`)
    if (input.promotion !== null && !input.promotion.currentStable.ready) {
      reasons.push('🔴 지속 승격은 아직이다 — 오늘만이다(내일 다시 판정한다)')
    }
  } else if (input.promotion?.nextPreflight.ready === true && upCap !== null) {
    // ── ③ 재고 준비 — 공개는 그대로, 생산 눈금만 올린다 ──
    capacity = upCap
    state = 'PREPARE'
    reasons.push(`🟢 다음 단계 사전 준비 완료(정본 nextPreflight) — 공개는 ${release} 유지, `
      + `생산 눈금만 ${input.currentCapacity} → ${upCap}`)
  } else {
    const why = input.promotion?.nextAction ?? input.today?.reasons.join(' / ') ?? '판정 근거 없음'
    reasons.push(`유지 — ${why}`)
  }

  // ── ⑤ 감속은 정본에 맡긴다 ──
  const safe = safeStageFor(release, input.verdicts)
  if (safe.reason !== null) reasons.push(safe.reason)
  if (safe.unknown) reasons.push('🔴 지속 판정을 받지 못했다 — `chosenReady` 를 신뢰하지 않는다')
  /**
   * 🔴 **하루 시험은 지속 판정으로 깎지 않는다.** 그것이 하루 시험의 뜻이다 —
   *    지속이 미달이라서 시험을 하는 것이므로, 여기서 다시 지속을 물으면 시험이 영영 열리지 않는다.
   */
  if (state !== 'TRIAL') release = safe.stage

  let dayPinned = false
  if (stageRank(release) < stageRank(input.currentRelease)
    && input.publishedToday > PROFILES[release].dailyTarget) {
    reasons.push(
      `🔴 오늘 이미 ${input.publishedToday}건 냈다 — ${release} 로 내리면 상한 초과가 된다. `
      + `오늘은 ${input.currentRelease} 를 고정한다`,
    )
    release = input.currentRelease
    dayPinned = true
  }

  /** 🔴 **release 는 capacity 를 넘지 못한다** — 준비한 것보다 많이 낼 수 없다 */
  if (stageRank(release) > stageRank(capacity)) {
    reasons.push(`🔴 공개 ${release} 가 생산 눈금 ${capacity} 를 넘는다 — 생산 눈금을 맞춘다`)
    capacity = release
  }
  return { ...base, capacity, release, state, dayPinned, reasons }
}

/** 🔴 아무것도 읽지 못했을 때 */
export function safestDecision(kstDate: string, decidedAt: string): StageDecision {
  return {
    kstDate, capacity: SAFEST_STAGE, release: SAFEST_STAGE, state: 'HOLD',
    dayPinned: false, supply: null, decidedAt, contractVersion: STAGE_DECISION_VERSION,
    reasons: [`🔴 단계 입력을 읽지 못했다 — 가장 안전한 ${SAFEST_STAGE} 로 둔다`],
  }
}
