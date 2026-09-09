/**
 * Gate ⑧ 말투 지문 **임계 정본** — 🔴 순수 상수
 *
 * 🔴 **왜 여기로 올렸나** (2026-09-09).
 *
 *    bootstrap 종료 기준을 `2` 라고 따로 적어 두었는데, Gate ⑧ 의 실제 기준은
 *    `minSamples: 5` 였다. 두 숫자가 어긋나서 **prior 가 1·2·3 건인 Persona 는
 *    bootstrap 도 막히고 ⑧ 도 돌지 않는 사각지대**에 빠졌다.
 *    첫 댓글을 하나 만들고 나면 두 번째부터 아무 데로도 갈 수 없었다.
 *
 *    같은 것을 두 곳에 적으면 언젠가 어긋난다. 그래서 임계를 여기 두고
 *    `scripts/lib/persona-gate-78.mts` 는 다시 내보내기만 한다.
 *    scripts 는 src 를 import 할 수 있지만 그 반대는 Next 빌드 경계를 넘는다 —
 *    그래서 방향은 이쪽이다.
 */

export type FingerprintThresholds = {
  /** 🔴 표본이 적으면 비율이 튄다 — 이 수 미만은 재지 않는다(관문이 notRun 이 된다) */
  minSamples: number
  endingReview: number
  endingRegen: number
  hookReview: number
  hookRegen: number
  ngramReview: number
  ngramRegen: number
  /** seed 재사용은 persona 단위가 아니라 **전체 단위**로 본다 (§3-⑧) */
  seedReuseReview: number
  seedReuseRegen: number
}

export const DEFAULT_FINGERPRINT_THRESHOLDS: FingerprintThresholds = {
  minSamples: 5,
  endingReview: 0.33,
  endingRegen: 0.40,
  hookReview: 0.25,
  hookRegen: 0.35,
  ngramReview: 0.67,
  ngramRegen: 0.80,
  seedReuseReview: 2,
  seedReuseRegen: 3,
}

/**
 * 🔴 **후보 자신이 표본에 들어간다.**
 *
 *    `persona-gate-78` 은 `sample = [...prior, candidateText]` 로 센다.
 *    그래서 관문이 돌려면 이전 발화가 `minSamples - 1` 건 있으면 된다 —
 *    `minSamples` 건이 아니다. 이 한 칸 차이를 손으로 적으면 또 어긋난다.
 */
export const REQUIRED_PRIOR_TEXTS = DEFAULT_FINGERPRINT_THRESHOLDS.minSamples - 1

/** 후보 1건을 더한 표본이 관문을 돌릴 만큼 되는가 */
export const gateEightCanRun = (priorCount: number): boolean =>
  priorCount + 1 >= DEFAULT_FINGERPRINT_THRESHOLDS.minSamples
