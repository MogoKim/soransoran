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
  /**
   * 🔴 **canary 하한** — 이 단계를 **하루 시험**으로 켜 볼 수 있는 최소 활성 Persona 수.
   *    `PERSONA_CANARY_FLOOR` 가 정본이다. 🔴 이 값을 채웠다고 지속 운영 준비라 말하지 않는다
   */
  personaCanaryFloor: number
  /**
   * 🔴 **지속 다양성 목표** — 이 단계를 **계속** 운영하는 데 필요한 활성 Persona 수.
   *    `PERSONA_SUSTAINED_TARGET` 이 정본이다. 🔴 canary 를 막는 데 쓰지 않는다
   */
  personaSustainedTarget: number
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
 * 🔴 **Persona 목표는 두 개다. 섞지 않는다** (2026-09-29 마스터 결정).
 *
 *    앞판은 `activePersonaTarget` 한 칸이 두 질문에 동시에 답했다 —
 *      ① 이 단계를 **하루 시험(canary)** 으로 켜 볼 수 있는가
 *      ② 이 단계를 **계속** 운영해도 사람들이 같은 얼굴로 반복되지 않는가
 *    한 숫자로 두면 둘 중 하나가 틀린다. ①에 맞추면 지속 준비가 부풀고(40명으로
 *    D20 을 계속 돌릴 수 있다고 읽힌다), ②에 맞추면 첫 시험이 막힌다.
 *
 *    `PERSONA_CANARY_FLOOR`      ① — **옛 `activePersonaTarget` 값 그대로**다. 승격 preflight 가 쓴다
 *    `PERSONA_SUSTAINED_TARGET`  ② — 보고만 한다. 🔴 canary·preflight 를 막지 않는다
 *
 * 🔴 D3·D5·D10 은 두 값이 같다. D20 부터 갈린다 — release 프로필이 아직 없는 단계도
 *    지속 목표는 **지금** 보고한다(없는 프로필을 이유로 숫자를 숨기지 않는다).
 * 🔴 D100 지속 목표는 "300명 이상" 이다 — 여기 적는 300 은 **하한**이다.
 */
export const PERSONA_CANARY_FLOOR: Readonly<Record<D100Stage, number>> = {
  d3: 24, d5: 24, d10: 30, d20: 40, d30: 60, d50: 100, d100: 180,
}

export const PERSONA_SUSTAINED_TARGET: Readonly<Record<D100Stage, number>> = {
  d3: 24, d5: 24, d10: 30, d20: 60, d30: 90, d50: 150, d100: 300,
}

/**
 * 🔴 **단계별 계획.** 창업자가 확정한 값이다 —
 *    `publicPostsPerDay` · 댓글 범위 · 관측 일수가 입력이고,
 *    상세 필요량과 재고는 위 상수로 **계산한다**(손으로 적지 않는다).
 *    Persona 두 목표는 위 두 표가 정본이다 — 여기 다시 적지 않는다.
 */
const INPUT: Readonly<Record<D100Stage, {
  publicPostsPerDay: number
  commentMinPerDay: number
  commentMaxPerDay: number
  publishSlotCount: number
  minimumObservationDays: number
}>> = {
  d3: { publicPostsPerDay: 3, commentMinPerDay: 3, commentMaxPerDay: 15, publishSlotCount: 3, minimumObservationDays: 7 },
  d5: { publicPostsPerDay: 5, commentMinPerDay: 5, commentMaxPerDay: 25, publishSlotCount: 5, minimumObservationDays: 7 },
  d10: { publicPostsPerDay: 10, commentMinPerDay: 10, commentMaxPerDay: 50, publishSlotCount: 10, minimumObservationDays: 14 },
  d20: { publicPostsPerDay: 20, commentMinPerDay: 20, commentMaxPerDay: 100, publishSlotCount: 10, minimumObservationDays: 14 },
  d30: { publicPostsPerDay: 30, commentMinPerDay: 30, commentMaxPerDay: 150, publishSlotCount: 15, minimumObservationDays: 14 },
  d50: { publicPostsPerDay: 50, commentMinPerDay: 50, commentMaxPerDay: 250, publishSlotCount: 20, minimumObservationDays: 21 },
  d100: { publicPostsPerDay: 100, commentMinPerDay: 100, commentMaxPerDay: 500, publishSlotCount: 25, minimumObservationDays: 21 },
}

/**
 * 🔴 D100 **canary 하한의 범위**는 180~200 명이다 — 상한도 정본에 적는다.
 *    🔴 지속 목표(300명 이상)의 상한이 아니다. 지속 목표에는 상한이 없다
 */
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
    personaCanaryFloor: PERSONA_CANARY_FLOOR[stage],
    personaSustainedTarget: PERSONA_SUSTAINED_TARGET[stage],
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

/**
 * 🔴 **Persona 두 목표를 한 줄에 나란히 적는다** — 보고서는 이 값만 찍는다.
 *
 *    `canaryFloorMet`   하루 시험을 켤 수 있는 인원인가 — **승격 preflight 가 보는 것은 이것뿐**
 *    `sustainedMet`     계속 돌릴 인원인가 — 🔴 **보고만 한다.** canary 를 막지 않는다
 *
 * 🔴 canary 하한을 채웠다고 `sustainedMet` 가 참이 되지 않는다 — 두 값은 따로 잰다.
 * 🔴 재지 못했으면(`active === null`) 둘 다 `null` 이다. 0 으로도 통과로도 읽지 않는다.
 */
export type PersonaTargetReport = {
  stage: D100Stage
  /** 🔴 재지 못했으면 `null` */
  active: number | null
  canaryFloor: number
  canaryFloorMet: boolean | null
  canaryFloorShortfall: number | null
  sustainedTarget: number
  sustainedMet: boolean | null
  sustainedShortfall: number | null
}

export function personaTargetReport(stage: D100Stage, active: number | null): PersonaTargetReport {
  const floor = PERSONA_CANARY_FLOOR[stage]
  const sustained = PERSONA_SUSTAINED_TARGET[stage]
  return {
    stage, active,
    canaryFloor: floor,
    canaryFloorMet: active === null ? null : active >= floor,
    canaryFloorShortfall: active === null ? null : Math.max(0, floor - active),
    sustainedTarget: sustained,
    sustainedMet: active === null ? null : active >= sustained,
    sustainedShortfall: active === null ? null : Math.max(0, sustained - active),
  }
}

/** 🔴 보고서 한 줄 — `canary 하한 N · 지속 목표 M` 을 항상 같이 적는다 */
export function describePersonaTargets(r: PersonaTargetReport): string {
  const mark = (met: boolean | null): string => met === null ? '⬚ 미측정' : met ? '🟢 충족' : '🔴 미달'
  const act = r.active === null ? '?' : String(r.active)
  return `${r.stage} 활성 Persona ${act}명 — canary 하한 ${r.canaryFloor}명 ${mark(r.canaryFloorMet)}`
    + ` · 지속 목표 ${r.sustainedTarget}명${r.stage === 'd100' ? ' 이상' : ''} ${mark(r.sustainedMet)}`
    + (r.sustainedShortfall !== null && r.sustainedShortfall > 0 ? ` (지속까지 ${r.sustainedShortfall}명 부족)` : '')
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
 *      `canary`     🔴 **지금 켜진 단계**의 제한이 힘을 쓰고 있는가
 *      `stable`     🔴 **지금 켜진 단계**가 자기 목표를 최소 관측일 동안 냈는가
 *      `preflight`  🔴 **다음 단계**를 재고·Persona·수집·생성·스케줄러가 감당하는가
 *                   (다음 단계 발행량은 묻지 않는다 — 올라가야 낼 수 있는 양이다)
 *
 * 🔴 **canary/stable 은 지금 단계의 것이고 preflight 는 다음 단계의 것이다** (5차 보정).
 *    앞판은 셋을 모두 *다음* 단계에 걸었고, canary 를 `현재 === 다음` 으로 계산했다 —
 *    정의상 언제나 거짓이라 canary 가 통과할 수 있는 경우가 없었다.
 *
 * 🔴 제한을 올리려면 **지금 단계가 stable** 이고 **다음 단계 preflight** 가 끝나야 한다 —
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
   * 🔴 **다음 단계.** 사전 준비(preflight)는 이 단계의 필요량으로 잰다 —
   *    지금 단계 필요량만 채우고 다음 칸으로 올라가는 것이 앞판의 결함이었다.
   */
  next: D100Stage
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
   * 🔴 **최근 창의 하루 평균 발행 편수 — 진단값이다** (2026-09-21 6차 보정).
   *
   *    안정화 판정에 쓰지 않는다. 단계를 막 올린 직후에는 이전 단계의 낮은 실적이
   *    평균에 섞여 있어, 새 단계 조건을 다 채워도 이 값은 한동안 미달로 남는다.
   *    안정화는 `currentStableStreakDays` 하나가 답한다.
   */
  publishedPerDay: number | null
  /**
   * 🔴 **지금 단계의 제한이 실제로 힘을 쓰고 있는가** (2026-09-21 5차 보정).
   *
   *    앞판은 이 칸을 `현재 === 목표` 로 채웠다. 그런데 목표는 정의상 **다음** 단계라
   *    정상 전이에서는 언제나 `false` 였다 — canary 칸이 통과할 수 있는 경우가
   *    아예 없었다는 뜻이다.
   *
   *    물어야 할 것은 "지금 켜진 단계가 제대로 돌고 있는가" 다:
   *    env 가 그 단계를 명시했고, 발행 러너가 실제로 돌 수 있는가.
   */
  currentLimitsActive: boolean
}

export type PromotionVerdict = {
  /** 🔴 **제한을 올려도 되는가** — 지금 단계 stable + 다음 단계 preflight */
  ready: boolean
  /** 🔴 지금 서 있는 칸 */
  phase: PromotionPhase
  /** 🔴 지금 해야 할 일 한 줄 */
  nextAction: string
  /** 지금 켜져 있는 단계 */
  current: ReleaseStage
  /** 🔴 그 단계의 D100 필요량 — 표에 없는 칸(d1)이면 `null` */
  currentPlan: D100Plan | null
  /** 다음 단계 */
  next: D100Stage
  /** 다음 단계의 필요량 그 자체 */
  requirement: D100Plan
  /** 🔴 **지금 단계**의 제한이 힘을 쓰고 있는가 */
  currentCanary: GateVerdict
  /** 🔴 **지금 단계**가 자기 목표를 냈는가 */
  currentStable: GateVerdict
  /** 🔴 **다음 단계**의 사전 준비 — 다음 단계 발행량은 묻지 않는다 */
  nextPreflight: GateVerdict
  /**
   * 🔴 **다음 단계 Persona 두 목표.** `canaryFloorMet` 만 preflight 에 들어가고,
   *    `sustainedMet` 는 **보고만** 한다 — `ready`·`blocking` 에 섞이지 않는다.
   *    판정에 넘어간 인원(`activePersonas`)을 그대로 쓴다.
   */
  persona: PersonaTargetReport
  /** 🔴 세 칸을 합친 것 */
  blocking: string[]
  unmeasured: string[]
}

/**
 * 🔴 **다음 단계로 올려도 되는가.** 측정되지 않은 값은 **통과로 세지 않는다** —
 *    모르는 것을 "괜찮다" 로 읽으면 확대가 관측 없이 일어난다.
 */
export function judgePromotion(input: PromotionInput): PromotionVerdict {
  const cur = currentPlanOf(input.current)
  const req = d100Plan(input.next)
  const curTarget = dailyTargetOf(input.current)
  const needDays = stableObservationDaysOf(input.current)

  // ── ① 지금 단계 canary — 제한이 켜져 있고 실제로 돌 수 있는가 ──
  const canary: GateVerdict = { ready: false, blocking: [], unmeasured: [] }
  if (!input.currentLimitsActive) {
    canary.blocking.push(`${input.current} 제한이 ${RELEASE_ENV} 로 확정되지 않았다`)
  }
  if (!input.publishRunnerReady) canary.blocking.push('발행 runner 가 돌 수 없다')
  canary.ready = canary.blocking.length === 0

  // ── ② 지금 단계 stable — 자기 목표를 최소 관측일 동안 냈는가 ──
  /**
   * 🔴 **안정화는 연속 달성 일수 하나로만 판정한다** (2026-09-21 6차 보정).
   *
   *    앞판은 여기에 `publishedPerDay`(최근 14일 평균)까지 요구했다. 그런데 두 조건은
   *    **서로 다른 창**을 본다 — 한쪽은 7일 연속, 한쪽은 14일 평균이다.
   *
   *    d1 에서 7일 동안 1편/day 를 내고 d3 으로 올려 7일 동안 3편/day 를 내면,
   *    연속 달성은 7일로 채워지지만 14일 평균은 (7×1 + 7×3)/14 = **2편/day** 다.
   *    그래서 조건을 다 채운 순간에도 "3/day 미달" 로 막힌다 — 단계를 막 올린 직후가
   *    가장 오래 막히는 구조였고, 7일 조건이 사실상 14일 조건으로 늘어난 것이다.
   *
   * 🔴 14일 평균은 **진단값으로만** 남긴다(`publishedPerDay`). 안정화 조건이 아니다.
   */
  const stable: GateVerdict = { ready: false, blocking: [], unmeasured: [] }
  if (!canary.ready) stable.blocking.push(`${input.current} canary 를 통과하지 못했다`)
  if (input.currentStableStreakDays === null) stable.unmeasured.push('연속 달성 일수')
  else if (input.currentStableStreakDays < needDays) {
    stable.blocking.push(
      `${input.current} 연속 달성 ${input.currentStableStreakDays}일 < 필요 ${needDays}일`
      + ` (완료된 KST 날짜에서 ${curTarget}편/day 이상)`,
    )
  }
  stable.ready = stable.blocking.length === 0 && stable.unmeasured.length === 0

  /**
   * ── ③ 다음 단계 preflight — 🔴 **지금 단계 실적과 따로 잰다** ──
   *
   *    d1 을 돌리는 동안에도 d3 준비는 진행된다. 그래서 여기서 지금 단계가 stable 인지
   *    묻지 않는다 — 그 조건은 아래 `ready`(실제 전환)에서 본다.
   * 🔴 그리고 **다음 단계의 발행량은 묻지 않는다.** 올라가야 낼 수 있는 양이다.
   */
  const pre: GateVerdict = { ready: false, blocking: [], unmeasured: [] }
  if (input.readyStock === null) pre.unmeasured.push('재고')
  else if (input.readyStock < req.readyStock14Days) {
    pre.blocking.push(`재고 ${input.readyStock} < 14일치 ${req.readyStock14Days}`)
  }
  if (input.activePersonas === null) pre.unmeasured.push('활성 Persona')
  /**
   * 🔴 **preflight 는 canary 하한만 본다.** 다음 단계를 하루 시험으로 켜 볼 수 있는가가
   *    이 칸의 질문이다 — 지속 목표로 막으면 D20 첫 시험이 60명을 채울 때까지 열리지 않는다.
   *    지속 목표는 `persona` 칸에 따로 적는다.
   */
  else if (input.activePersonas < req.personaCanaryFloor) {
    pre.blocking.push(`활성 Persona ${input.activePersonas} < canary 하한 ${req.personaCanaryFloor}`)
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
  const sc = schedulerSupportOf(input.next)
  if (!sc.supported) pre.blocking.push(`다음 단계 ${input.next} 를 스케줄러가 감당하지 못한다 — ${sc.detail}`)
  pre.ready = pre.blocking.length === 0 && pre.unmeasured.length === 0

  /**
   * 🔴 **전환은 둘 다 되어야 한다.** 지금 단계가 자리를 잡았고(stable),
   *    다음 단계 준비가 끝났을 때(preflight)만 제한을 올린다 —
   *    d3→d5 는 d3 이 3/day 를 7일 낸 뒤에만 열린다.
   */
  const ready = stable.ready && pre.ready
  const phase: PromotionPhase = !canary.ready ? 'canary'
    : !stable.ready ? 'stable' : 'preflight'
  const nextAction = !canary.ready
    ? `${input.current} 가 제대로 돌게 한다 — ${canary.blocking[0] ?? ''}`
    : !stable.ready
      ? `${input.current} 에서 ${curTarget}/day 를 ${needDays}일 낸다`
      + ` (${[...stable.blocking, ...stable.unmeasured.map((u) => `${u} 미측정`)][0] ?? ''})`
      : !pre.ready
        ? `${input.next} 사전 준비를 채운다 — ${[...pre.blocking, ...pre.unmeasured.map((u) => `${u} 미측정`)][0] ?? ''}`
        : `🔴 사람이 ${RELEASE_ENV} 를 ${input.next} 로 올린다 (이 PR 에서는 하지 않는다)`

  return {
    ready, phase, nextAction,
    current: input.current, currentPlan: cur,
    next: input.next, requirement: req,
    currentCanary: canary, currentStable: stable, nextPreflight: pre,
    persona: personaTargetReport(input.next, input.activePersonas),
    blocking: [...canary.blocking, ...stable.blocking, ...pre.blocking],
    unmeasured: [...new Set([...stable.unmeasured, ...pre.unmeasured])],
  }
}
