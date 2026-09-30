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
 * 🔴 **실행 숫자의 정본은 이 파일이다.** 운영 문서의 단계 표는 사람이 읽는 계약이며,
 *    검사가 이 파일에서 계산한 값과 전 행을 대조한다.
 */

/** 공개 발행 단계 — 🔴 이 목록 밖의 단계는 없다 */
import {
  PROFILES, RUNTIME_STAGES, isRuntimeStage, profileOf, type ReleaseStage, type RuntimeStage,
} from './scale-profile'

export const D100_STAGES = ['d3', 'd5', 'd10', 'd20', 'd30', 'd50', 'd100'] as const
export type D100Stage = (typeof D100_STAGES)[number]

/**
 * 🔴 **한 편을 공개하려면 원천 몇 건이 필요한가.**
 *
 *    실측 전환율이 아직 없다(§ `unmeasured`). 그래서 계획값을 **이 한 곳에** 두고,
 *    측정이 생기면 여기만 고친다. 🔴 보고서가 이 값을 "측정값" 이라고 부르지 않는다.
 */
export const PLANNED_DETAIL_PER_PUBLIC_POST = 3.82

/**
 * 🔴 **`STOCK_DAYS`(14일치 재고) · `readyStock14Days` 를 지웠다** (2026-09-30 · source-slot-v1).
 *    정본: fourteen-day finished-post inventory 는 지속 준비도가 아니다. 완성 글을 쌓아 두는 목표는 없다 —
 *    다음 단계 준비도는 `judgeNextPreflight`(증명일 slot-valid 기회 · 처리량 · Persona · 비용)가 본다.
 */

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
 *    앞판은 `publishSlotCount` 를 계획값으로만 적어 두었다. 실제 슬롯은 **러너 프로필
 *    `scale-profile.RUNTIME_PROFILES` 하나**가 정본이다 (2026-09-29 generic scheduler 배선).
 *    · d1·d3·d5·d10 — `PROFILES` 그대로(launchd 발행 러너 — 2026-09-30 GitHub 예약 제거)
 *    · d20·d30·d50 — 파생 슬롯(로컬 heartbeat 10분 격자). 🔴 감당한다는 뜻이지 열렸다는 뜻이 아니다 —
 *      승인 천장(`SORAN_CAPACITY_STAGE`)이 막고, 시험은 D20+ preflight 가 막는다
 *    · d100 — 러너 프로필이 없다. 지금 러너 용량·댓글 예산으로는 열 수 없다(열 수 있는 천장 d50) → `supported: false`
 */
export type SchedulerSupport = {
  /** 대응하는 러너 단계 — 없으면 `null` (d100) */
  releaseStage: RuntimeStage | null
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

/** 🔴 D100 단계 이름과 러너 단계 이름이 같을 때만 대응한다 */
function releaseStageOf(stage: D100Stage): RuntimeStage | null {
  return isRuntimeStage(stage) ? stage : null
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
      detail: `${stage} 에 대응하는 러너 프로필이 없다`
        + ` (있는 것은 ${RUNTIME_STAGES.join('·')}) — 지금 러너 용량·댓글 예산으로 열 수 없다`,
    }
  }
  const slots = profileOf(rs).slots.length
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
 * 🔴 **지운 판정 (2026-09-30 · source-slot-v1)** — `targetStageFor` · `currentPlanOf`(env 로 "지금 단계" 를 정하던
 *    두 번째 출처) · `judgePromotion`(현 단계 **연속 달력 일수** stable + 다음 단계 **14일치 재고** preflight + 사람
 *    `SORAN_RELEASE_STAGE` 수동 승격 문구) · `PROMOTION_PHASES` · `stableObservationDaysOf` · `dailyTargetOf`.
 *    현재 단계의 입력원은 StageDecision 하나이고, 승급은 운영 증거 PASS + `judgeNextPreflight` 하나다.
 */
