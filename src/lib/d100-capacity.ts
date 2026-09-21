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

export type D100Plan = {
  stage: D100Stage
  /** 하루 공개 발행 편수 */
  publicPostsPerDay: number
  /** 하루 필요한 상세 수집 건수 */
  detailedSourcesRequiredPerDay: number
  /** 하루 필요한 READY 순증가 */
  readyNetRequiredPerDay: number
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
    readyNetRequiredPerDay: i.publicPostsPerDay,
    readyStock14Days: i.publicPostsPerDay * STOCK_DAYS,
    activePersonaTarget: i.activePersonaTarget,
    commentMinPerDay: i.commentMinPerDay,
    commentMaxPerDay: i.commentMaxPerDay,
    publishSlotCount: i.publishSlotCount,
    minimumObservationDays: i.minimumObservationDays,
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

export type PromotionInput = {
  /** 지금 단계 */
  stage: D100Stage
  /** 지금 쓸 수 있는 재고 (`publishableNow` 가 아니라 usable 재고) */
  readyStock: number
  /** 실제 활성 Persona 수 */
  activePersonas: number
  /** 🔴 측정되지 않았으면 `null` — 0 으로 채우지 않는다 */
  detailPerDay: number | null
  readyNetPerDay: number | null
  /** 이 단계에서 무사히 관측한 일수 */
  observedDays: number
  /** 발행 runner 가 실제로 돌 수 있는가 */
  publishRunnerReady: boolean
  /** 댓글 runner 가 실제로 돌 수 있는가 */
  commentRunnerReady: boolean
}

export type PromotionVerdict = {
  ready: boolean
  /** 🔴 막는 이유 — 비어 있으면 올려도 된다 */
  blocking: string[]
  /** 🔴 측정되지 않아 판단할 수 없는 것 — `blocking` 과 다르다 */
  unmeasured: string[]
}

/**
 * 🔴 **다음 단계로 올려도 되는가.** 측정되지 않은 값은 **통과로 세지 않는다** —
 *    모르는 것을 "괜찮다" 로 읽으면 확대가 관측 없이 일어난다.
 */
export function judgePromotion(input: PromotionInput): PromotionVerdict {
  const cur = d100Plan(input.stage)
  const blocking: string[] = []
  const unmeasured: string[] = []

  if (input.readyStock < cur.readyStock14Days) {
    blocking.push(`재고 ${input.readyStock} < 14일치 ${cur.readyStock14Days}`)
  }
  if (input.activePersonas < cur.activePersonaTarget) {
    blocking.push(`활성 Persona ${input.activePersonas} < 필요 ${cur.activePersonaTarget}`)
  }
  if (input.observedDays < cur.minimumObservationDays) {
    blocking.push(`관측 ${input.observedDays}일 < 최소 ${cur.minimumObservationDays}일`)
  }
  if (!input.publishRunnerReady) blocking.push('발행 runner 가 돌 수 없다')
  if (!input.commentRunnerReady) blocking.push('댓글 runner 가 돌 수 없다')

  if (input.detailPerDay === null) unmeasured.push('상세 수집/day')
  else if (input.detailPerDay < cur.detailedSourcesRequiredPerDay) {
    blocking.push(`상세 ${input.detailPerDay}/day < 필요 ${cur.detailedSourcesRequiredPerDay}/day`)
  }
  if (input.readyNetPerDay === null) unmeasured.push('READY 순증가/day')
  else if (input.readyNetPerDay < cur.readyNetRequiredPerDay) {
    blocking.push(`READY 순증가 ${input.readyNetPerDay}/day < 필요 ${cur.readyNetRequiredPerDay}/day`)
  }

  // 🔴 측정되지 않은 값이 하나라도 있으면 올리지 않는다
  return { ready: blocking.length === 0 && unmeasured.length === 0, blocking, unmeasured }
}
