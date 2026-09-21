/**
 * D3→D100 **공개 발행 확대 정본** — 🔴 순수 함수. 파일도 DB 도 읽지 않는다
 *
 * 🔴 **목표 (2026-09-21 창업자 정본)**
 *    "지금의 커뮤니티형 원문 기반 글을 Persona 가 자연스럽게 쓰고,
 *     하루 3→5→10→20→30→50→100편으로 **공개 발행**을 확대한다.
 *     SEO 는 별도 글 종류가 아니라, 이 커뮤니티 글들이 검색에 노출되어
 *     유입을 만드는 **결과**다."
 *
 * 🔴 **North Star 는 주간 재방문 참여 실사용자다.** Persona 글 100/day 는 그것을
 *    움직이기 위한 **수단**이지 목표 지표가 아니다. 발행량·Persona 활동을
 *    North Star 에 넣지 않는다(`src/lib/north-star.ts` 가 그것을 타입으로 막는다).
 *
 * 🔴 **금지** — 별도 SEO 정보형 레인 · 검색용 기사/가이드/매거진을 D100 목표에 섞기 ·
 *    Shadow 100/day 를 공개 100/day 의 대체 목표로 바꾸기.
 *
 * 🔴 **숫자를 문서에 복사하지 않는다.** 보고서는 이 파일에서 생성된다.
 */

/** 공개 발행 단계 — 🔴 이 목록 밖의 단계는 없다 */
import { PROFILES, RELEASE_STAGES, RELEASE_ENV, type ReleaseStage } from './scale-profile'

export const D100_STAGES = ['d3', 'd5', 'd10', 'd20', 'd30', 'd50', 'd100'] as const
export type D100Stage = (typeof D100_STAGES)[number]

/**
 * 🔴 **한 편을 공개하려면 원천 몇 건이 필요한가.**
 *
 *    실측 전환율이 아직 없다(§ `unmeasured`). 그래서 계획값을 **이 한 곳에** 두고,
 *    측정이 생기면 여기만 고친다. 🔴 보고서가 이 값을 "측정값" 이라고 부르지 않는다.
 */
export const PLANNED_DETAIL_PER_PUBLIC_POST = 3.82

/** 🔴 재고는 14일치를 든다 — 공급이 하루 끊겨도 발행이 멎지 않게 */
export const STOCK_DAYS = 14

/**
 * 🔴 **READY 순증가는 공개량보다 많아야 한다** (2026-09-21 보정).
 *
 *    앞판은 `readyNetRequiredPerDay = publicPostsPerDay` 였다. 그러면 하루에 만든 만큼
 *    그날 다 나가야 본전이고, **재고는 영원히 늘지 않는다.** 14일치 재고를 목표로 두면서
 *    순증가를 0 으로 설계한 셈이다.
 *
 *    또 READY 가 전부 나가지도 않는다 — 사람이 보류하거나 내리는 것이 있고,
 *    TTL 이 지나 신선도에서 떨어지는 것이 있다. 20% 는 그 몫이다.
 *
 * 🔴 이 값을 낮추려면 "실제 탈락률이 20% 미만" 을 먼저 측정한다. 추정으로 내리지 않는다.
 */
export const READY_NET_MARGIN = 1.2

/**
 * 🔴 **발행 러너는 회차당 1건만 낸다.** (`scripts/original-post-auto-publish.mts` ③-b
 *    "이번에 나갈 한 건"). 그래서 하루 발행 가능량은 슬롯 수와 같다 —
 *    프로필의 `count` 를 2 로 적어도 2건이 나가지 않는다.
 */
export const POSTS_PER_INVOCATION = 1

export type D100Plan = {
  stage: D100Stage
  /** 하루 공개 발행 편수 */
  publicPostsPerDay: number
  /** 하루 필요한 상세 수집 건수 */
  detailedSourcesRequiredPerDay: number
  /**
   * 🔴 하루 필요한 **READY 생산량** — 공개량 × `READY_NET_MARGIN` (올림).
   *
   * 🔴 **재고 증감에 이 값을 요구하지 않는다** (2026-09-21 4차 보정).
   *    앞판은 이 값을 `readyNetPerDay`(재고 차이)와 견줬다. 그러면 D3 에서
   *    **4건 만들고 3건 내보내 재고가 +1** 인 정상 운영이 "순증가 1 < 필요 4" 로 막힌다.
   *    여유율 20% 는 *만들어야 할 양*에 붙는 것이지 *쌓여야 할 양*이 아니다.
   */
  readyQualifiedRequiredPerDay: number
  /** 14일치 재고 목표 */
  readyStock14Days: number
  /** 필요한 활성 Persona 수 */
  activePersonaTarget: number
  commentMinPerDay: number
  commentMaxPerDay: number
  /** 하루 발행 슬롯 수 */
  publishSlotCount: number
  /** 다음 단계로 올리기 전 최소 관측 일수 */
  minimumObservationDays: number
  /** 🔴 **계획이 아니라 실제 스케줄러가 할 수 있는 것** */
  scheduler: SchedulerSupport
}

/**
 * 🔴 **발행 계획과 실제 스케줄러를 잇는다** (2026-09-21 보정).
 *
 *    앞판은 `publishSlotCount` 를 계획값으로만 적어 두었다. 그런데 실제 cron 은
 *    `scale-profile.PROFILES` 에만 있고 그것은 **d1·d3·d5·d10 네 단계뿐**이다.
 *    d20 이상은 슬롯이 아예 없다 — 표에 20·30·50·100 을 적어 두면 "설정만 바꾸면 된다"
 *    로 읽히지만, 바꿀 설정이 없다. 그 사실을 `supported: false` 로 낸다.
 */
export type SchedulerSupport = {
  /** 대응하는 release 단계 — 없으면 `null` */
  releaseStage: ReleaseStage | null
  /** 하루 예약된 회차 수 — 프로필이 없으면 `null` */
  scheduledSlotsPerDay: number | null
  /** 🔴 회차당 실제 발행 건수 */
  actualPostsPerInvocation: number
  /** 🔴 실제로 하루에 낼 수 있는 편수 = 회차 수 × 회차당 건수 */
  actualDailyPublishable: number | null
  /** 🔴 이 단계의 공개량을 스케줄러가 감당하는가 */
  supported: boolean
  /** 막는 이유 — 감당하면 `null` */
  reason: 'schedulerUnsupported' | 'slotsInsufficient' | null
  detail: string | null
}

/** 🔴 D100 단계 이름과 release 단계 이름이 같을 때만 대응한다 */
function releaseStageOf(stage: D100Stage): ReleaseStage | null {
  return (RELEASE_STAGES as readonly string[]).includes(stage) ? (stage as ReleaseStage) : null
}

export function schedulerSupportOf(stage: D100Stage): SchedulerSupport {
  const want = INPUT[stage].publicPostsPerDay
  const rs = releaseStageOf(stage)
  if (rs === null) {
    return {
      releaseStage: null, scheduledSlotsPerDay: null,
      actualPostsPerInvocation: POSTS_PER_INVOCATION,
      actualDailyPublishable: null, supported: false,
      reason: 'schedulerUnsupported',
      detail: `${stage} 에 대응하는 release 프로필이 없다`
        + ` (있는 것은 ${RELEASE_STAGES.join('·')}) — 설정으로 올릴 수 없다`,
    }
  }
  const slots = PROFILES[rs].slots.length
  const actual = slots * POSTS_PER_INVOCATION
  return {
    releaseStage: rs, scheduledSlotsPerDay: slots,
    actualPostsPerInvocation: POSTS_PER_INVOCATION,
    actualDailyPublishable: actual,
    supported: actual >= want,
    reason: actual >= want ? null : 'slotsInsufficient',
    detail: actual >= want ? null
      : `회차 ${slots} × 회차당 ${POSTS_PER_INVOCATION}건 = ${actual}건/day < 공개 ${want}건/day`,
  }
}

/**
 * 🔴 **단계별 계획.** 창업자가 확정한 값이다 —
 *    `publicPostsPerDay` · `activePersonaTarget` · 댓글 범위 · 관측 일수가 입력이고,
 *    상세 필요량과 재고는 위 상수로 **계산한다**(손으로 적지 않는다).
 */
const INPUT: Readonly<Record<D100Stage, {
  publicPostsPerDay: number
  activePersonaTarget: number
  commentMinPerDay: number
  commentMaxPerDay: number
  publishSlotCount: number
  minimumObservationDays: number
}>> = {
  d3: { publicPostsPerDay: 3, activePersonaTarget: 24, commentMinPerDay: 3, commentMaxPerDay: 15, publishSlotCount: 3, minimumObservationDays: 7 },
  d5: { publicPostsPerDay: 5, activePersonaTarget: 24, commentMinPerDay: 5, commentMaxPerDay: 25, publishSlotCount: 5, minimumObservationDays: 7 },
  d10: { publicPostsPerDay: 10, activePersonaTarget: 30, commentMinPerDay: 10, commentMaxPerDay: 50, publishSlotCount: 10, minimumObservationDays: 14 },
  d20: { publicPostsPerDay: 20, activePersonaTarget: 40, commentMinPerDay: 20, commentMaxPerDay: 100, publishSlotCount: 10, minimumObservationDays: 14 },
  d30: { publicPostsPerDay: 30, activePersonaTarget: 60, commentMinPerDay: 30, commentMaxPerDay: 150, publishSlotCount: 15, minimumObservationDays: 14 },
  d50: { publicPostsPerDay: 50, activePersonaTarget: 100, commentMinPerDay: 50, commentMaxPerDay: 250, publishSlotCount: 20, minimumObservationDays: 21 },
  d100: { publicPostsPerDay: 100, activePersonaTarget: 180, commentMinPerDay: 100, commentMaxPerDay: 500, publishSlotCount: 25, minimumObservationDays: 21 },
}

/** 🔴 D100 은 180~200 명이다 — 상한도 정본에 적는다 */
export const D100_PERSONA_TARGET_MAX = 200

export function d100Plan(stage: D100Stage): D100Plan {
  const i = INPUT[stage]
  return {
    stage,
    publicPostsPerDay: i.publicPostsPerDay,
    // 🔴 올림한다 — 모자라면 그 단계가 서지 않는다
    detailedSourcesRequiredPerDay:
      Math.ceil(i.publicPostsPerDay * PLANNED_DETAIL_PER_PUBLIC_POST),
    // 🔴 공개량과 같게 두면 재고가 늘지 않는다 — 여유율을 곱하고 올린다
    readyQualifiedRequiredPerDay: Math.ceil(i.publicPostsPerDay * READY_NET_MARGIN),
    readyStock14Days: i.publicPostsPerDay * STOCK_DAYS,
    activePersonaTarget: i.activePersonaTarget,
    commentMinPerDay: i.commentMinPerDay,
    commentMaxPerDay: i.commentMaxPerDay,
    publishSlotCount: i.publishSlotCount,
    minimumObservationDays: i.minimumObservationDays,
    scheduler: schedulerSupportOf(stage),
  }
}

export function allD100Plans(): D100Plan[] {
  return D100_STAGES.map(d100Plan)
}

/** 🔴 다음 단계 — 마지막이면 `null` */
export function nextStage(stage: D100Stage): D100Stage | null {
  const i = D100_STAGES.indexOf(stage)
  return i < 0 || i + 1 >= D100_STAGES.length ? null : D100_STAGES[i + 1]!
}

/**
 * 🔴 **운영 중인 단계와 목표 단계는 다른 것이다** (2026-09-21 3차 보정).
 *
 *    앞판은 계기판이 `stage = 'd3'` 를 **코드에 박아** 두고 그것을 "지금 단계" 라고 불렀다.
 *    실제 운영값은 `SORAN_RELEASE_STAGE` 이고 지금은 **d1** 이다 —
 *    하루 1편 내는 레인을 하루 3편이라고 적어 두고, 그 위에서 "d5 로 올려도 되는가" 를
 *    물었다. 한 칸이 통째로 건너뛰어진 것이다.
 *
 * 🔴 `d1` 은 D100 단계표에 없다. release 단계(d1·d3·d5·d10)와 D100 용량 단계
 *    (d3~d100)는 겹치되 같지 않다 — 그래서 변환을 한 곳에 둔다.
 */
export function targetStageFor(current: ReleaseStage): D100Stage {
  // 🔴 d1 의 다음은 D100 표의 첫 칸이다
  if (current === 'd1') return D100_STAGES[0]
  const nxt = nextStage(current as D100Stage)
  // 🔴 마지막이면 자기 자신 — 더 올릴 곳이 없다
  return nxt ?? (current as D100Stage)
}

/**
 * 🔴 지금 운영 중인 단계의 **필요량**. release 단계 `d1` 은 D100 표에 없으므로
 *    "표에 없는 단계" 임을 그대로 말한다 — 없는 칸을 d3 으로 올려 읽지 않는다.
 */
export function currentPlanOf(current: ReleaseStage): D100Plan | null {
  return (D100_STAGES as readonly string[]).includes(current) ? d100Plan(current as D100Stage) : null
}

/**
 * 🔴 **승격은 한 번의 판정이 아니라 세 칸을 지나는 이동이다** (2026-09-21 4차 보정).
 *
 *    앞판은 목표 단계의 **발행량까지** 사전 조건에 넣었다. 그래서 d1 에서 d3 으로
 *    올라가려면 *이미 하루 3편을 내고 있어야* 했다 — 올라가야 낼 수 있는 양을
 *    올라가기 전에 요구한 것이라, 논리적으로 영원히 통과할 수 없다.
 *
 *      `preflight`  재고·Persona·수집·생성·스케줄러가 목표를 감당하는가
 *                   🔴 **목표 발행량은 묻지 않는다**
 *      `canary`     목표 단계 제한을 실제로 켰는가 (env 가 올라갔는가)
 *      `stable`     그 단계에서 **실제로** 목표 발행량을 최소 관측일 동안 냈는가
 *
 * 🔴 그리고 **다음 칸으로 가려면 지금 단계가 `stable` 이어야 한다** —
 *    d3→d5 는 d3 이 3/day 를 7일 낸 뒤에만 열린다.
 */
export const PROMOTION_PHASES = ['preflight', 'canary', 'stable'] as const
export type PromotionPhase = (typeof PROMOTION_PHASES)[number]

/**
 * 🔴 D100 표에 없는 release 단계(d1)의 관측 일수. d3·d5 와 같은 7일이다 —
 *    표에 없다고 관측을 면제하지 않는다.
 */
export const DEFAULT_STABLE_OBSERVATION_DAYS = 7

/** 🔴 이 단계가 하루에 내야 하는 편수 — release 프로필이 정본이다 */
export function dailyTargetOf(stage: ReleaseStage): number {
  return PROFILES[stage].dailyTarget
}

/** 🔴 이 단계가 stable 로 인정받기까지 필요한 연속 관측 일수 */
export function stableObservationDaysOf(stage: ReleaseStage): number {
  return currentPlanOf(stage)?.minimumObservationDays ?? DEFAULT_STABLE_OBSERVATION_DAYS
}

export type GateVerdict = {
  ready: boolean
  blocking: string[]
  /** 🔴 재지 못해 판단할 수 없는 것 — `blocking` 과 다르다 */
  unmeasured: string[]
}

export type PromotionInput = {
  /** 🔴 지금 **운영 중인** release 단계 (env 정본에서 읽는다) */
  current: ReleaseStage
  /**
   * 🔴 **올라가려는 단계.** 판정은 전부 이 단계의 필요량으로 한다 —
   *    지금 단계 필요량만 채우고 다음 칸으로 올라가는 것이 앞판의 결함이었다.
   */
  target: D100Stage
  /** 🔴 지금 쓸 수 있는 재고. **재지 못했으면 `null`** — 0 도 -1 도 아니다 */
  readyStock: number | null
  /** 🔴 실제 활성 Persona 수. 재지 못했으면 `null` */
  activePersonas: number | null
  /** 🔴 측정되지 않았으면 `null` — 0 으로 채우지 않는다 */
  detailPerDay: number | null
  /**
   * 🔴 **새로 품질을 통과한 READY 생산량.** 여유율 20% 는 여기에 붙는다.
   *    (앞판 이름 `readyNetPerDay` 는 재고 차이와 뒤섞였다)
   */
  readyQualifiedPerDay: number | null
  /**
   * 🔴 **두 스냅샷 사이의 실제 재고 증감.** 여기에 4/day·120/day 를 요구하지 않는다 —
   *    만든 만큼 내보내면 증감은 작은 양수가 정상이다.
   *    재고 목표를 채운 뒤 **음수**면 고갈 위험으로 따로 막는다.
   */
  readyStockDeltaPerDay: number | null
  /**
   * 🔴 **지금 단계에서 목표 발행량을 연속으로 달성한 날 수.**
   *    앞판의 `observedDays: 14` 상수를 없앤 자리다 — 상수는 "14일 관측했다" 는
   *    주장인데 아무도 재지 않았다.
   */
  currentStableStreakDays: number | null
  /** 발행 runner 가 실제로 돌 수 있는가 */
  publishRunnerReady: boolean
  /** 댓글 runner 가 실제로 돌 수 있는가 */
  commentRunnerReady: boolean
  /**
   * 🔴 **관측된 하루 공개 발행 편수.** 재지 않았으면 `null`.
   *    🔴 이 값은 **지금 단계가 stable 인가**를 볼 때만 쓴다 —
   *    목표 단계의 발행량을 사전 조건으로 요구하지 않는다.
   */
  publishedPerDay: number | null
  /** 🔴 목표 단계 제한이 실제로 켜져 있는가 (env 가 올라갔는가) */
  targetLimitsActive: boolean
}

export type PromotionVerdict = {
  /** 🔴 세 칸을 모두 지났는가 — 즉 **다음 목표로 넘어가도 되는가** */
  ready: boolean
  /** 🔴 지금 서 있는 칸 */
  phase: PromotionPhase
  /** 🔴 지금 해야 할 일 한 줄 */
  nextAction: string
  /** 🔴 어느 단계의 필요량으로 쟀는가 — 보고서가 이 값을 그대로 적는다 */
  target: D100Stage
  /** 목표 단계의 필요량 그 자체 */
  requirement: D100Plan
  /** 🔴 지금 단계가 자기 목표를 냈는가 — 다음 칸의 전제다 */
  currentStable: GateVerdict
  preflight: GateVerdict
  canary: GateVerdict
  stable: GateVerdict
  /** 🔴 세 칸을 합친 것 — 옛 호출부가 읽던 자리다 */
  blocking: string[]
  unmeasured: string[]
}

/**
 * 🔴 **다음 단계로 올려도 되는가.** 측정되지 않은 값은 **통과로 세지 않는다** —
 *    모르는 것을 "괜찮다" 로 읽으면 확대가 관측 없이 일어난다.
 */
export function judgePromotion(input: PromotionInput): PromotionVerdict {
  /**
   * 🔴 **목표 단계의 필요량으로 잰다.** `d100Plan(현재)` 로 재면 d3 수치(재고 42 ·
   *    READY 4/day)만 채우고 d5 로 올라간다 — d5 는 70 · 6/day 를 요구한다.
   */
  const req = d100Plan(input.target)

  // ── ⓪ 지금 단계가 자기 목표를 내고 있는가 — 🔴 다음 칸의 전제다 ──
  const curTarget = dailyTargetOf(input.current)
  const needDays = stableObservationDaysOf(input.current)
  const currentStable: GateVerdict = { ready: false, blocking: [], unmeasured: [] }
  if (input.publishedPerDay === null) currentStable.unmeasured.push('공개 발행/day')
  else if (input.publishedPerDay < curTarget) {
    currentStable.blocking.push(`${input.current} 공개 발행 ${input.publishedPerDay}/day < 자기 목표 ${curTarget}/day`)
  }
  if (input.currentStableStreakDays === null) currentStable.unmeasured.push('연속 달성 일수')
  else if (input.currentStableStreakDays < needDays) {
    currentStable.blocking.push(`${input.current} 연속 달성 ${input.currentStableStreakDays}일 < 필요 ${needDays}일`)
  }
  currentStable.ready = currentStable.blocking.length === 0 && currentStable.unmeasured.length === 0

  // ── ① preflight — 🔴 목표 발행량은 **묻지 않는다** ──
  const pre: GateVerdict = { ready: false, blocking: [], unmeasured: [] }
  if (input.readyStock === null) pre.unmeasured.push('재고')
  else if (input.readyStock < req.readyStock14Days) {
    pre.blocking.push(`재고 ${input.readyStock} < 14일치 ${req.readyStock14Days}`)
  }
  if (input.activePersonas === null) pre.unmeasured.push('활성 Persona')
  else if (input.activePersonas < req.activePersonaTarget) {
    pre.blocking.push(`활성 Persona ${input.activePersonas} < 필요 ${req.activePersonaTarget}`)
  }
  if (input.detailPerDay === null) pre.unmeasured.push('상세 수집/day')
  else if (input.detailPerDay < req.detailedSourcesRequiredPerDay) {
    pre.blocking.push(`상세 ${input.detailPerDay}/day < 필요 ${req.detailedSourcesRequiredPerDay}/day`)
  }
  /**
   * 🔴 **생산량에 여유율이 붙는다.** 재고 증감이 아니다 —
   *    4건 만들어 3건 내보내 +1 인 것은 정상이고, 그것을 막으면 정상 운영이 막힌다.
   */
  if (input.readyQualifiedPerDay === null) pre.unmeasured.push('READY 생산량/day')
  else if (input.readyQualifiedPerDay < req.readyQualifiedRequiredPerDay) {
    pre.blocking.push(`READY 생산 ${input.readyQualifiedPerDay}/day < 필요 ${req.readyQualifiedRequiredPerDay}/day`)
  }
  /**
   * 🔴 **재고 증감은 고갈 감시용이다.** 목표 재고를 채운 뒤 줄고 있으면 막는다 —
   *    채우기 전이라면 아직 쌓는 중이라 음수도 이상하지 않다.
   */
  const stockMet = input.readyStock !== null && input.readyStock >= req.readyStock14Days
  if (stockMet) {
    if (input.readyStockDeltaPerDay === null) pre.unmeasured.push('재고 증감/day')
    else if (input.readyStockDeltaPerDay < 0) {
      pre.blocking.push(`🔴 고갈 위험 — 재고가 하루 ${input.readyStockDeltaPerDay}씩 줄고 있다`)
    }
  }
  if (!input.publishRunnerReady) pre.blocking.push('발행 runner 가 돌 수 없다')
  if (!input.commentRunnerReady) pre.blocking.push('댓글 runner 가 돌 수 없다')
  // 🔴 스케줄러가 못 하는 단계로는 올리지 않는다. 재고가 아무리 많아도 나갈 길이 없다
  const sc = schedulerSupportOf(input.target)
  if (!sc.supported) pre.blocking.push(`목표 ${input.target} 를 스케줄러가 감당하지 못한다 — ${sc.detail}`)
  // 🔴 지금 단계가 자리를 잡지 못했으면 다음 준비를 통과로 보지 않는다
  if (!currentStable.ready) {
    pre.blocking.push(`${input.current} 가 아직 stable 이 아니다`)
    for (const u of currentStable.unmeasured) pre.unmeasured.push(`${input.current} ${u}`)
  }
  pre.ready = pre.blocking.length === 0 && pre.unmeasured.length === 0

  // ── ② canary — 목표 단계 제한을 실제로 켰는가 ──
  const canary: GateVerdict = { ready: false, blocking: [], unmeasured: [] }
  if (!pre.ready) canary.blocking.push('preflight 를 통과하지 못했다')
  if (!input.targetLimitsActive) {
    canary.blocking.push(`${input.target} 제한이 아직 켜지지 않았다 (${RELEASE_ENV})`)
  }
  canary.ready = canary.blocking.length === 0

  // ── ③ stable — 목표 단계에서 실제로 그 양을 냈는가 ──
  const stable: GateVerdict = { ready: false, blocking: [], unmeasured: [] }
  if (!canary.ready) stable.blocking.push('canary 를 통과하지 못했다')
  if (input.publishedPerDay === null) stable.unmeasured.push('공개 발행/day')
  else if (input.publishedPerDay < req.publicPostsPerDay) {
    stable.blocking.push(`공개 발행 ${input.publishedPerDay}/day < 목표 ${req.publicPostsPerDay}/day`)
  }
  if (input.currentStableStreakDays === null) stable.unmeasured.push('연속 달성 일수')
  else if (input.currentStableStreakDays < req.minimumObservationDays) {
    stable.blocking.push(`연속 달성 ${input.currentStableStreakDays}일 < 최소 ${req.minimumObservationDays}일`)
  }
  stable.ready = stable.blocking.length === 0 && stable.unmeasured.length === 0

  const phase: PromotionPhase = !pre.ready ? 'preflight' : !canary.ready ? 'canary' : 'stable'
  const nextAction = !pre.ready
    ? `preflight 를 채운다 — ${[...pre.blocking, ...pre.unmeasured.map((u) => `${u} 미측정`)][0] ?? ''}`
    : !canary.ready
      ? `🔴 사람이 ${RELEASE_ENV} 를 ${input.target} 로 올린다 (이 PR 에서는 하지 않는다)`
      : stable.ready
        ? `${input.target} 가 자리를 잡았다 — 다음 목표로 넘어갈 수 있다`
        : `${input.target} 에서 ${req.publicPostsPerDay}/day 를 ${req.minimumObservationDays}일 낸다`

  return {
    ready: stable.ready,
    phase, nextAction,
    target: input.target, requirement: req,
    currentStable, preflight: pre, canary, stable,
    blocking: [...pre.blocking, ...canary.blocking, ...stable.blocking],
    unmeasured: [...new Set([...pre.unmeasured, ...stable.unmeasured])],
  }
}
