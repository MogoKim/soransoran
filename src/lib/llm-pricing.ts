/**
 * 공급 AI 가격표 — 🔴 **순수 함수. 네트워크·파일·시각 조회 0**
 *
 * 🔴 **이 값은 공식 문서에서 직접 확인한 것이다** (2026-09-17 조회).
 *    출처: https://platform.claude.com/docs/en/about-claude/pricing
 *    추정하거나 기억으로 적지 않는다. 바뀌면 `PRICING_VERSION` 을 올린다.
 *
 * 🔴 **여기 없는 모델은 `null` 이다.** "아마 이 정도" 로 계산하지 않는다 —
 *    모르는 단가로 계산한 금액은 숫자만 있고 근거가 없다.
 */

/**
 * 🔴 **가격표 판.** 장부의 모든 줄이 어느 판으로 계산됐는지 적는다.
 *    나중에 청구서와 대조할 때 "그때 무슨 값을 썼나" 를 알 수 있어야 한다.
 */
export const PRICING_VERSION = 'anthropic-2026-09-17'

/** 🔴 사람이 다시 확인할 수 있게 출처를 코드에 남긴다 */
export const PRICING_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing'
export const PRICING_CHECKED_AT = '2026-09-17'

/** USD per 1,000,000 tokens */
export type ModelPrice = {
  /** Base input tokens */
  inputPerMTok: number
  /** Output tokens */
  outputPerMTok: number
  /** 5분 캐시 쓰기 (1.25x base) */
  cacheWrite5mPerMTok: number
  /** 1시간 캐시 쓰기 (2x base) */
  cacheWrite1hPerMTok: number
  /** 캐시 읽기·갱신 (0.1x base) */
  cacheReadPerMTok: number
}

/**
 * 🔴 **공급이 실제로 쓰는 모델만 적는다.**
 *    `micro-seed-auto-judge` · `micro-seed-auto-draft` 가 `claude-haiku-4.5` 하나를 쓴다.
 *    다른 모델을 미리 적어 두면 쓰지도 않는 값이 낡아 간다.
 *
 * 🔴 key 는 이 저장소의 **내부 라벨**이다 — provider 가 아는 이름(`apiModelId`)과 다르다.
 */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = Object.freeze({
  'claude-haiku-4.5': Object.freeze({
    inputPerMTok: 1,
    outputPerMTok: 5,
    cacheWrite5mPerMTok: 1.25,
    cacheWrite1hPerMTok: 2,
    cacheReadPerMTok: 0.1,
  }),
})

export function priceOf(model: string): ModelPrice | null {
  return MODEL_PRICES[model] ?? null
}

/**
 * 🔴 **지금 요청 방식에 적용되는 과금 요소** (2026-09-17 공식 문서 대조).
 *
 *    적용    입력 토큰 · 출력 토큰
 *    비적용  프롬프트 캐시 — `cache_control` 을 보내지 않는다
 *            도구 사용    — `tools` 를 보내지 않는다
 *            Batch 할인   — Batch API 를 쓰지 않는다
 *            데이터 residency 1.1x — `inference_geo` 는 Claude 4.6 이후 모델만 지원한다.
 *                          Haiku 4.5 는 파라미터 자체가 없어 항상 표준가다
 *            long context · fast mode — 각각 4.6 이후 · Opus 전용
 *
 * 🔴 **"비적용" 은 "무시해도 된다" 가 아니다.** 요청 모양이 바뀌면 여기부터 다시 본다.
 *    그래서 장부가 제공사 `usage` 의 **키 이름 목록**을 남긴다 — 우리가 안 읽는
 *    과금 항목이 응답에 나타나면 그 사실이 드러나야 한다.
 */
export const BILLABLE_NOW: readonly string[] = ['inputTokens', 'outputTokens'] as const

/** 🔴 제공사가 준 사용량. **모르면 `null`** — 0 과 구분한다 */
export type Usage = {
  inputTokens: number | null
  outputTokens: number | null
  cacheWriteTokens: number | null
  cacheReadTokens: number | null
}

export type CostVerdict =
  | { known: true; usd: number; pricingVersion: string }
  /**
   * 🔴 계산할 수 없는 이유를 남긴다 — `0원` 으로 적지 않는다.
   *    `NO_PRICE` 단가를 모른다 · `NO_USAGE` 사용량을 모른다
   */
  | { known: false; code: 'NO_PRICE' | 'NO_USAGE'; reason: string }

/**
 * 사용량 → 금액. 🔴 **하나라도 모르면 계산하지 않는다.**
 *
 * 🔴 캐시 토큰이 `null` 인 것과 `0` 인 것은 다르다.
 *    `null` 은 **우리가 안 읽었다**는 뜻이고, 그 상태를 "캐시 안 씀(0원)" 으로 적으면
 *    정산이 조용히 틀린다. 그래서 `null` 이면 **미상**으로 끝낸다.
 */
export function costOf(input: { model: string; usage: Usage }): CostVerdict {
  const p = priceOf(input.model)
  if (p === null) {
    return { known: false, code: 'NO_PRICE', reason: `단가를 모르는 모델이다 — ${input.model}` }
  }
  const u = input.usage
  if (u.inputTokens === null || u.outputTokens === null) {
    return { known: false, code: 'NO_USAGE', reason: '제공사가 준 입력·출력 토큰을 모른다' }
  }
  if (u.cacheWriteTokens === null || u.cacheReadTokens === null) {
    return {
      known: false, code: 'NO_USAGE',
      reason: '캐시 사용량을 읽지 못했다 — 0 으로 두고 계산하지 않는다',
    }
  }
  const usd = (u.inputTokens * p.inputPerMTok
    + u.outputTokens * p.outputPerMTok
    // 🔴 5분·1시간 쓰기를 구분해 주지 않는 응답이면 **비싼 쪽**으로 센다.
    //    싼 쪽으로 세면 장부가 실제보다 적게 나온다
    + u.cacheWriteTokens * p.cacheWrite1hPerMTok
    + u.cacheReadTokens * p.cacheReadPerMTok) / 1_000_000
  return { known: true, usd, pricingVersion: PRICING_VERSION }
}

/**
 * 🔴 **요청 전 예약액** — 확정 상한이 아니다.
 *
 *    `countedInputTokens` 는 공식 `count_tokens` 가 준 값이고, 공식 문서가
 *    **"estimate"** 라고 명시한다. 실제 과금 입력 토큰과 "a small amount" 만큼
 *    다를 수 있고, 시스템이 더한 토큰은 세어지되 과금되지 않는다.
 *    그래서 이 값에 **여유를 곱해** 예약하지만, 그 결과도 **상한이 아니라 예약**이다.
 *
 * 🔴 출력 쪽은 다르다 — `maxOutputTokens` 는 요청 body 에 실려 나가는 값이라
 *    그보다 많은 출력 토큰이 과금될 수 없다. 이쪽만 "한도" 라고 부른다.
 *
 * 🔴 **여유 계수를 여기서 정하지 않는다.** 호출부가 넘긴다 —
 *    운영 값은 창업자가 정할 일이고, 코드가 임의로 고르면 그 숫자가 근거 없이 굳는다.
 */
export function reserveOf(input: {
  model: string
  /** 공식 count_tokens 결과. 🔴 추정이다 */
  countedInputTokens: number
  /** 요청 body 의 `max_tokens` — 이건 확정 한도다 */
  maxOutputTokens: number
  /** 추정 오차를 덮기 위한 여유 배수 (1.0 이면 여유 없음) */
  headroomMultiplier: number
}): CostVerdict {
  const p = priceOf(input.model)
  if (p === null) {
    return { known: false, code: 'NO_PRICE', reason: `단가를 모르는 모델이다 — ${input.model}` }
  }
  if (!Number.isFinite(input.countedInputTokens) || input.countedInputTokens < 0) {
    return { known: false, code: 'NO_USAGE', reason: '공식 입력 토큰 계산값이 없다' }
  }
  if (!Number.isFinite(input.headroomMultiplier) || input.headroomMultiplier < 1) {
    return { known: false, code: 'NO_USAGE', reason: '여유 배수가 1 미만이거나 숫자가 아니다' }
  }
  const usd = (input.countedInputTokens * input.headroomMultiplier * p.inputPerMTok
    + input.maxOutputTokens * p.outputPerMTok) / 1_000_000
  return { known: true, usd, pricingVersion: PRICING_VERSION }
}
