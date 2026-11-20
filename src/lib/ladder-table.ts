/**
 * 🔴 **사다리가 판정에 쓰는 숫자 — 여기 한 곳이다.** 순수 상수와 산수뿐(DB · 파일 · env · 시각 조회 0).
 *
 *    사다리는 양을 늘려도 결이 유지되는지를 **재는** 장치다. 하루 판정(`stage-evidence`)과 올림 관문
 *    (`stage-ladder-generic`)이 숫자를 각자 적으면 한쪽만 바뀐 날 단계가 닫힌다 — 그래서 둘 다 여기서 읽는다.
 *
 *    여기 적지 않는 숫자(원천이 따로 있다 — 다시 적으면 두 번째 원천이 된다):
 *      · 하루 편수            `profileOf(stage).dailyTarget` (scale-profile)
 *      · 글당 댓글 목표 평균   `threadMeanSizeAt(공개 시각)` (persona-thread-target) — 통과선은 그 값 × `countRatio`
 *      · 대화 마감            `THREAD_DEADLINE_MS` (persona-thread-target)
 *      · 첫 댓글 대기 상한     `FIRST_COMMENT_DELAY_MAX_MS` (persona-comment-auto-lane)
 *      · 감사 표본 비율        `auditTarget` (auto-ready-v2)
 *
 *    단계를 더하는 일은 `LADDER` 에 한 줄이다(러너 프로필은 scale-profile 이 따로 연다).
 */
import { FIRST_COMMENT_DELAY_MAX_MS } from './persona-comment-auto-lane'

export type LadderRow = {
  stage: string
  /** 이 단계로 **올라가기 전에** 채워야 하는 계약 유효 Persona 수 */
  personaFloor: number
  /** 실제로 투입되는 인원(stage-active)도 같은 하한을 넘어야 하는가 — reserve 만 늘려 숫자만 통과하는 것을 막는다 */
  activeFloor: boolean
  /** 결: 글쓴이 아닌 Persona 3명 이상이 말한 글의 최소 비율 */
  threeVoicesRatio: number
}

export const LADDER: readonly LadderRow[] = [
  { stage: 'd1', personaFloor: 1, activeFloor: false, threeVoicesRatio: 0.6 },
  { stage: 'd3', personaFloor: 24, activeFloor: false, threeVoicesRatio: 0.6 },
  { stage: 'd5', personaFloor: 24, activeFloor: false, threeVoicesRatio: 0.6 },
  { stage: 'd10', personaFloor: 30, activeFloor: false, threeVoicesRatio: 0.6 },
  { stage: 'd20', personaFloor: 40, activeFloor: false, threeVoicesRatio: 0.6 },
  { stage: 'd30', personaFloor: 60, activeFloor: true, threeVoicesRatio: 0.6 },
  { stage: 'd50', personaFloor: 100, activeFloor: true, threeVoicesRatio: 0.7 },
  { stage: 'd100', personaFloor: 180, activeFloor: true, threeVoicesRatio: 0.7 },
]

export function ladderRowOf(stage: string): LadderRow | null {
  return LADDER.find((r) => r.stage === stage) ?? null
}

export const LADDER_RULE = {
  /** 수: 자동 공개가 목표의 이 비율 이상. 글당 댓글 통과선도 목표 평균에 같은 비율을 곱한다 */
  countRatio: 0.9,
  /** 올림: 같은 단계에서 PASS 가 이만큼 연속 */
  consecutiveDays: 2,
  /** 결: 첫 댓글이 창 안에 달린 글의 최소 비율 — 한 건 누락이 하루를 무효로 만들지 않게 */
  firstCommentRatio: 0.95,
  /**
   * 첫 댓글 판정 창 = 댓글 러너의 대기 상한 + 처리 여유. 대기 상한과 같은 값이면 대기를 끝까지 채운 글이
   * 생성·발행에 걸린 몇 십 초 때문에 매일 창을 넘는다.
   */
  firstCommentWindowMs: FIRST_COMMENT_DELAY_MAX_MS + 60_000,
  /**
   * 결: 수집에서 공개까지 걸린 시간의 중앙값. 🔴 `gate: false` 인 동안은 재고 찍기만 하고 판정을 막지 않는다 —
   * 이 기준은 바퀴 몫 + 6시간 만료 구조가 있어야 닿는다. 그 구조를 넣는 변경이 이 한 칸을 `true` 로 켠다.
   */
  collectToPublish: { medianMaxH: 2, gate: false as boolean },
  /** 창이 닫힌 글이 이 비율보다 적으면 그 결은 모름이다(일부만 보고 통과시키지 않는다) */
  closedShareMin: 0.5,
  /** 수집 시각을 읽은 글이 이 비율보다 적으면 수집→공개는 모름이다 */
  collectKnownShareMin: 0.9,
} as const

/** 수의 통과선 — 목표 편수의 `countRatio` 이상(올림). 목표가 0 이하이면 0 */
export function countFloorOf(postsPerDay: number): number {
  return postsPerDay > 0 ? Math.ceil(postsPerDay * LADDER_RULE.countRatio - 1e-9) : 0
}

/** 글당 댓글의 통과선 — 그날 글에 효력이 있던 목표 평균의 `countRatio` */
export function commentDepthFloorOf(targetMean: number): number {
  return targetMean * LADDER_RULE.countRatio
}
