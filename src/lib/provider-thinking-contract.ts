/**
 * 🔴 **Gemini thinkingLevel 호환 계약 — 한 곳** (2026-10-24 D10 댓글 HTTP_400)
 *
 *    `gemini-3.7-flash` 는 `low` · `medium` · `high` 만 받는다. `minimal` 을 보내면 provider 가 400 으로 돌려준다.
 *    #793 이 댓글 생성에 `minimal` 을 넣어 D10 첫 댓글 3/3 이 전부 HTTP_400 으로 끝났다.
 *
 *    · 상수는 `SupportedThinkingLevel<모델>` 타입으로 적는다 — 지원하지 않는 값은 tsc 가 막는다
 *    · 실제 요청 직전에는 `thinkingLevelVerdict` 로 다시 본다 — 런타임 값도 네트워크 전에 거부한다
 *
 *    표에 없는 Gemini 모델에 thinkingLevel 을 넣으면 거부한다(fail-closed). thinkingLevel 을 쓰지 않는
 *    provider(Anthropic · OpenAI)는 이 값을 요청에 싣지 않으므로 판정 대상이 아니다.
 */

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high'

export const GEMINI_THINKING_LEVELS = Object.freeze({
  'gemini-3.7-flash': ['low', 'medium', 'high'],
} as const) satisfies Readonly<Record<string, readonly ThinkingLevel[]>>

export type GeminiThinkingModel = keyof typeof GEMINI_THINKING_LEVELS
export type SupportedThinkingLevel<M extends GeminiThinkingModel> = (typeof GEMINI_THINKING_LEVELS)[M][number]

export function thinkingLevelVerdict(
  model: string, level: ThinkingLevel | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (level === undefined || !model.startsWith('gemini-')) return { ok: true }
  const supported: readonly ThinkingLevel[] | undefined =
    (GEMINI_THINKING_LEVELS as Readonly<Record<string, readonly ThinkingLevel[]>>)[model]
  if (supported === undefined) return { ok: false, reason: `${model} 의 thinkingLevel 계약이 없다` }
  if (!supported.includes(level)) {
    return { ok: false, reason: `${model} 는 thinkingLevel=${level} 을 받지 않는다 (${supported.join('/')})` }
  }
  return { ok: true }
}
