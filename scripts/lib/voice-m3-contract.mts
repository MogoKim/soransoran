/**
 * VE-M3 계약을 코드로 (VE-M3-2)
 *
 * 정본: docs/operations/2026-08-27-voice-m3-llm-experiment-contract.md
 *
 * 🔴 이 파일에는 LLM 이 없다
 *    SDK import · 네트워크 호출이 **하나도 없다.** 계약을 값으로 옮겨 놓은 것뿐이다.
 *    실제 호출은 VE-M3-3 이고, 그전까지 비용은 0원이다.
 *
 * 🔴 여기 있는 상수가 흔들리면 돈이 샌다
 *    cacheKey 구성 · cap · 금지어는 문서와 코드 양쪽에 있어야 한다.
 *    문서는 읽히지 않을 수 있지만 fixture 는 읽힌다.
 */
import { createHash } from 'node:crypto'
import { SORANSORAN_REGISTER_TERMS, TARGET_DESCRIPTOR_TERMS } from './voice-style-signals.mjs'
// 🔴 임계값 20자는 VE-R3.1 에서 확립됐다. 여기서 새로 정하지 않고 가져다 쓴다 —
//    두 곳에 각각 적으면 한쪽만 바뀌는 날이 온다.
import { LEAK_RUN_MIN } from './voice-unao-readonly.mjs'

// ── 모델 단가 (계약 §E) ──────────────────────────────────

export type ModelPricing = {
  /** 입력 100만 토큰당 USD */
  inputPerMTok: number
  /** 출력 100만 토큰당 USD */
  outputPerMTok: number
  /** 🔴 어디서 언제 확인했는가. 없으면 이 단가를 쓰지 않는다 */
  source: string
  checkedAt: string
}

// ── 버전 상수 ─────────────────────────────────────────────

/** VE-M3 작업 정의 버전. 판단 대상 · 입력 구성이 바뀌면 올린다 */
export const M3_TASK_VERSION = 'voice-m3-task-v1'
/** 프롬프트 버전. 문구가 바뀌면 결과가 달라지므로 올린다 */
export const M3_PROMPT_VERSION = 'voice-m3-prompt-v1'
/** 출력 스키마 버전. 필드가 바뀌면 파싱 결과가 달라지므로 올린다 */
export const M3_OUTPUT_SCHEMA_VERSION = 'voice-m3-output-v1'

/**
 * 후보 모델의 공식 단가. 🔴 **출처와 확인일이 없으면 여기 넣지 않는다.**
 *
 * 계약 §E 가 요구한 형식이다. 확인되지 않은 단가로 만든 금액은
 * "확인된 비용" 처럼 읽힌다 — 이전에 실제로 그런 일이 있었다.
 *
 * ⚠️ 가격은 바뀐다. **실행 직전 한 번 더 대조한다.**
 *
 * 🔴 모델 선택은 이 표로 하지 않는다. 20건 실험 결과를 사람이 읽고 정한다
 *    (정본: docs/operations/2026-08-27-voice-m3-model-selection-criteria.md).
 *    입력 20배 · 출력 12.5배 차이지만, 20건 실험 총액은 $0.077 로 둘 다 사실상 공짜다.
 *    격차가 드러나는 곳은 전량 확대 시점이고 그때 차이는 약 34달러다.
 */
export const M3_MODEL_CANDIDATES = {
  'gpt-5-nano': {
    inputPerMTok: 0.05,
    outputPerMTok: 0.40,
    source: 'https://platform.openai.com/pricing',
    checkedAt: '2026-08-27',
  },
  'claude-haiku-4.5': {
    inputPerMTok: 1.0,
    outputPerMTok: 5.0,
    source: 'https://claude.com/pricing',
    checkedAt: '2026-08-27',
  },
} as const satisfies Record<string, ModelPricing>

export type M3ModelName = keyof typeof M3_MODEL_CANDIDATES

/**
 * 🔴 첫 실험은 **총 20건** — 같은 표본 10건을 두 모델에 각각 넣는다.
 *    표본이 다르면 모델 차이인지 글 차이인지 알 수 없다.
 *
 * 🔴 `itemLimit` 10 을 넘지 않는다. **모델당 10건씩 두 번 실행**이고
 *    cap 은 실행 단위로 걸린다. 한 실행에서 20건을 처리하지 않는다.
 */
export const M3_EXPERIMENT_PER_MODEL = 10

/** 단가를 꺼낸다. 🔴 등록되지 않은 모델은 던진다 — 금액을 지어내지 않는다 */
export function pricingFor(model: string): ModelPricing {
  const found = (M3_MODEL_CANDIDATES as Record<string, ModelPricing>)[model]
  if (!found) {
    throw new Error(
      `단가가 등록되지 않은 모델이다: ${model}
` +
        `  후보: ${Object.keys(M3_MODEL_CANDIDATES).join(' · ')}
` +
        '  공식 단가를 출처 · 확인일과 함께 M3_MODEL_CANDIDATES 에 넣은 뒤 쓴다(계약 §E).',
    )
  }
  return found
}

/**
 * 🔴 모델은 아직 확정되지 않았다 — **그런데도 빈 문자열이 아니라 placeholder 다.**
 *
 * `''` 이나 `null` 로 두면 안 되는 이유가 둘이다.
 *   ① Postgres 에서 NULL 은 서로 같지 않아 `cacheKey` UNIQUE 가 중복을 못 막는다
 *   ② 나중에 "이 캐시가 어느 모델 결과인가" 를 물었을 때 답이 없다.
 *      빈 문자열이면 "모델이 없다" 와 "모델을 아직 안 정했다" 가 구분되지 않는다
 *
 * 이 값이 그대로 캐시에 들어가면 **모델 미확정 상태에서 만든 결과**라는 뜻이고,
 * 실제 모델이 정해지면 키가 달라져 자연히 새 결과로 분리된다.
 *
 * 모델 확정은 **10건 실험 전 창업자 승인 사항**이다(계약 §F).
 */
export const M3_MODEL_UNDETERMINED = 'undetermined'

// ── cap (계약 §E) ────────────────────────────────────────

export const M3_CAPS = {
  /** 대표성이 아니라 **사람이 전량을 눈으로 읽을 수 있는 크기** */
  itemLimit: 10,
  /** 🔴 건수 cap 만으로는 못 막는다. 3,000자 글이 몰리면 같은 건수에 토큰이 3배다 */
  tokenCap: 500_000,
  /** 사람이 감당 가능한 상한 */
  dollarCap: 5,
  softDaily: 200,
  hardDaily: 1_000,
  timeoutSec: 30,
  /** 🔴 retry 도 cap 에 포함한다. 밖에 두면 실패가 많을수록 비용이 커진다 */
  maxRetry: 3,
  /** 연속 실패가 이만큼이면 배치 전체를 멈춘다 */
  consecutiveFailureStop: 5,
} as const

/**
 * 한국어 토큰 환산 계수.
 * ⚠️ 실측이 아니라 **가정**이다. 실제 토큰 수는 모델 토크나이저에 달렸다.
 *    입력 글자 수(1건당 약 1,173자)는 실측이지만 이 계수는 아니다.
 */
export const TOKENS_PER_CHAR = 1.3
/** 출력 JSON 한 건의 대략 크기. 7종 스칼라 + 근거 메모 기준 */
export const ESTIMATED_OUTPUT_TOKENS_PER_ITEM = 450

// ── 출력 스키마 (계약 §B) ────────────────────────────────

/**
 * 🔴 VE-M3 가 LLM 에게 요구할 JSON. **이번 단계에서 계산하지 않는다.**
 *    여기 있는 것은 "나중에 이런 모양으로 받겠다" 는 약속뿐이다.
 *
 * 🔴 **7종 전부 자동 발행 조건으로 쓰지 않는다** (계약 §B · §I).
 *    점수가 좋아서 발행하는 구조를 만드는 순간 사람이 건너뛰어진다.
 *    이 값들은 **사람이 무엇을 먼저 볼지 정하는 순서**에만 쓴다.
 */
export const M3_SIGNAL_KEYS = [
  // 🟢 높을수록 좋다
  'naturalnessScore',
  'voiceRetention',
  'originalityDelta',
  // 🔴 높을수록 위험 — overSanitized 와 overMimicry 는 서로 반대 방향이라 함께 읽는다
  'overSanitizedRisk',
  'overMimicryRisk',
  'expressionRisk',
  'sequenceSimilarityRisk',
] as const

export type M3SignalKey = (typeof M3_SIGNAL_KEYS)[number]

/** LLM 이 반환해야 할 JSON schema. 값은 전부 0~100 정수다 */
export const M3_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [...M3_SIGNAL_KEYS, 'notes'],
  properties: {
    ...Object.fromEntries(
      M3_SIGNAL_KEYS.map((k) => [k, { type: 'integer', minimum: 0, maximum: 100 }]),
    ),
    /**
     * 판단 근거 메모.
     * 🔴 **원문을 인용하지 않는다.** 20자 이상 연속 일치는 저장 전에 걸러진다(§H).
     */
    notes: { type: 'string', maxLength: 500 },
  },
} as const

// ── cacheKey (계약 §D) ───────────────────────────────────

/**
 * cacheKey 를 이루는 8요소. 🔴 하나라도 빠지면 캐시가 틀린다.
 * fixture 가 이 배열의 길이와 내용을 검사한다.
 */
export const CACHE_KEY_PARTS = [
  'origin',
  'sourceRef',
  'contentHash',
  'ruleVersion',
  'taskVersion',
  'model',
  'promptVersion',
  'outputSchemaVersion',
] as const

export type CacheKeyInput = {
  origin: string
  sourceRef: string
  /** 원문이 없으면 null 일 수 있다 — 그때는 빈 문자열로 접힌다 */
  contentHash: string | null
  ruleVersion: string
  taskVersion: string
  model: string
  promptVersion: string
  outputSchemaVersion: string
}

/**
 * 🔴 같은 원문 · 같은 모델 · 같은 프롬프트 · 같은 스키마면 **다시 부르지 않는다.**
 *    캐시 미스 하나가 돈이다.
 *
 * 🔴 `model` · `promptVersion` · `outputSchemaVersion` 이 비면 **던진다.**
 *    빈 값을 허용하면 서로 다른 실행이 같은 키를 갖게 되고, 그러면
 *    "어느 모델 결과인가" 를 알 수 없어 캐시가 무의미해진다.
 */
export function buildCacheKey(input: CacheKeyInput): string {
  const required: Array<[string, string]> = [
    ['origin', input.origin],
    ['sourceRef', input.sourceRef],
    ['ruleVersion', input.ruleVersion],
    ['taskVersion', input.taskVersion],
    ['model', input.model],
    ['promptVersion', input.promptVersion],
    ['outputSchemaVersion', input.outputSchemaVersion],
  ]
  for (const [name, value] of required) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(
        `cacheKey: ${name} 이 비어 있다.\n` +
          '  빈 값을 허용하면 서로 다른 실행이 같은 키를 갖는다 —\n' +
          '  모델이 미확정이면 M3_MODEL_UNDETERMINED 같은 placeholder 를 쓴다.',
      )
    }
  }
  // 🔴 구분자를 넣는다. 없으면 ('ab','c') 와 ('a','bc') 가 같은 키가 된다
  const material = [
    input.origin, input.sourceRef, input.contentHash ?? '',
    input.ruleVersion, input.taskVersion, input.model,
    input.promptVersion, input.outputSchemaVersion,
  ].join(' | ')
  return `sha256:${createHash('sha256').update(material, 'utf8').digest('hex')}`
}

// ── 비용 추정 (계약 §E) ──────────────────────────────────

export type CostEstimate = {
  estimatedInputTokens: number
  estimatedOutputTokens: number
  estimatedTotalTokens: number
  /**
   * 🔴 **공식 단가 없이는 금액을 만들지 않는다.**
   *    확인되지 않은 단가로 계산한 숫자는 "확인된 비용" 처럼 읽힌다 —
   *    이전 문서에서 실제로 그런 일이 있었고(추정치를 확정처럼 적었다), 정정했다.
   */
  estimatedCostUsd: number | null
  /** 금액이 null 인 이유 */
  costStatus: 'unavailable_no_official_price' | 'estimated'
  /** 단가를 확인했다면 출처와 날짜 */
  priceSource: string | null
}

/**
 * 토큰을 세고, **단가가 있을 때만** 금액을 만든다.
 *
 * 🔴 `pricing` 이 없으면 `estimatedCostUsd = null` 이다. 0 이 아니다 —
 *    0 은 "공짜" 로 읽히고 null 은 "모른다" 로 읽힌다. 둘은 다르다.
 */
export function estimateCost(
  inputChars: number, itemCount: number, pricing?: ModelPricing,
): CostEstimate {
  const estimatedInputTokens = Math.round(inputChars * TOKENS_PER_CHAR)
  const estimatedOutputTokens = itemCount * ESTIMATED_OUTPUT_TOKENS_PER_ITEM
  const estimatedTotalTokens = estimatedInputTokens + estimatedOutputTokens
  if (!pricing) {
    return {
      estimatedInputTokens, estimatedOutputTokens, estimatedTotalTokens,
      estimatedCostUsd: null,
      costStatus: 'unavailable_no_official_price',
      priceSource: null,
    }
  }
  const usd =
    (estimatedInputTokens / 1_000_000) * pricing.inputPerMTok +
    (estimatedOutputTokens / 1_000_000) * pricing.outputPerMTok
  return {
    estimatedInputTokens, estimatedOutputTokens, estimatedTotalTokens,
    estimatedCostUsd: Math.round(usd * 10_000) / 10_000,
    costStatus: 'estimated',
    priceSource: `${pricing.source} (${pricing.checkedAt})`,
  }
}

/** cap 을 넘었는가. 🔴 하나라도 넘으면 실행하지 않는다 */
export function checkCaps(e: CostEstimate, itemCount: number): {
  ok: boolean
  violations: string[]
} {
  const violations: string[] = []
  if (itemCount > M3_CAPS.itemLimit) {
    violations.push(`itemLimit 초과: ${itemCount} > ${M3_CAPS.itemLimit}`)
  }
  if (e.estimatedTotalTokens > M3_CAPS.tokenCap) {
    violations.push(`tokenCap 초과: ${e.estimatedTotalTokens} > ${M3_CAPS.tokenCap}`)
  }
  // 🔴 금액을 모르면 "넘지 않았다" 고 말하지 않는다. 모른다고 말한다
  if (e.estimatedCostUsd === null) {
    violations.push('dollarCap 판정 불가 — 공식 단가 미확정 (계약 §E)')
  } else if (e.estimatedCostUsd > M3_CAPS.dollarCap) {
    violations.push(`dollarCap 초과: $${e.estimatedCostUsd} > $${M3_CAPS.dollarCap}`)
  }
  return { ok: violations.length === 0, violations }
}

// ── 호칭 (계약 §H) ──────────────────────────────────────

/** ✅ 소란소란 글에서 쓸 수 있는 호칭. 이 목록 밖은 생성 후보가 아니다 */
export const M3_ALLOWED_ADDRESS_TERMS = [...SORANSORAN_REGISTER_TERMS] as const
/** 🔴 생성 금지어. 원문에 있어도 **우리가 만들어내지 않는다** */
export const M3_FORBIDDEN_ADDRESS_TERMS = [...TARGET_DESCRIPTOR_TERMS] as const

/**
 * 생성 후보 호칭이 계약을 지키는가.
 *
 * 🔴 이 함수의 존재 이유: "우리 또래분들" 이 한 번 좋은 치환어로 문서에 적혔다가
 *    폐기됐다(PR #100). 사람은 같은 실수를 반복한다.
 */
export function validateAddressCandidates(terms: readonly string[]): {
  ok: boolean
  forbidden: string[]
  unknown: string[]
} {
  const forbidden = terms.filter((t) => (M3_FORBIDDEN_ADDRESS_TERMS as readonly string[]).includes(t))
  const unknown = terms.filter(
    (t) => !(M3_ALLOWED_ADDRESS_TERMS as readonly string[]).includes(t) && !forbidden.includes(t),
  )
  return { ok: forbidden.length === 0 && unknown.length === 0, forbidden, unknown }
}

// ── 원문 유출 대조 (계약 §H) ────────────────────────────

/** 임계값은 VE-R3.1 에서 확립됐다. 한국어 20자면 한 문장에 가깝다 */
export const M3_LEAK_RUN_MIN = LEAK_RUN_MIN

/**
 * 🔴 **저장 전 마지막 관문.** LLM 출력에 원문이 묻어 있으면 저장하지 않는다.
 *
 * 이번 단계에서는 호출이 없어 통과시킬 출력도 없지만,
 * **함수가 먼저 있어야 VE-M3-3 에서 빠뜨리지 않는다.**
 * fixture 가 이 함수의 존재와 동작을 검사한다.
 */
export function assertNoSourceLeak(
  outputText: string, sourceTexts: readonly string[], minRun = M3_LEAK_RUN_MIN,
): { ok: boolean; leaked: boolean } {
  const norm = (s: string): string => s.replace(/\s+/g, '')
  const out = norm(outputText)
  const hay = norm(sourceTexts.join('\n'))
  if (out.length < minRun || hay.length < minRun) return { ok: true, leaked: false }
  for (let i = 0; i + minRun <= out.length; i += 1) {
    if (hay.includes(out.slice(i, i + minRun))) return { ok: false, leaked: true }
  }
  return { ok: true, leaked: false }
}
