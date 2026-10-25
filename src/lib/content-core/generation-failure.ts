/**
 * 생성 실패 분류 — 🔴 **한 유료 요청의 결과와 한 원천의 최종 실패를 값으로 가른다** (2026-10-12 Batch B)
 *
 * 🔴 **왜 따로 두는가.** 72시간 실측(10-08~10-11) 유료 생성 89회 중 기술 실패 35회가
 *    `noResponse` 하나에 timeout 과 제공사 오류를 섞어 담았다. 둘은 다음 행동이 다르다 —
 *    timeout·429·5xx 는 다시 물으면 달라질 수 있고, 400·401 은 다시 물어도 같다.
 *    🔴 요청 결과의 재시도 자격은 **이 파일 하나**가 정한다. 다만 같은 출력 상한을 다시 쓰면 조건이
 *    바뀌지 않는 화자 계획 잘림은 파이프라인이 단계 정보와 함께 제외한다.
 *
 * 🔴 **안전·품질·Persona 부적격은 재시도 대상이 아니다.** 다시 물어 다른 답을 받는 것은
 *    판정을 우회하는 것이다. 재시도는 **답을 받지 못한** 요청에만 있다.
 */
import type { IncompleteCause } from './review'

/** 🔴 유료 요청 한 건의 결과 — 장부 정산 상태와 별개로 "답을 받았는가" 를 가른다 */
export const CALL_OUTCOMES = [
  'ok',
  /** 회차 요청 상한·장부 예산에 막혀 **나가지 않았다** — 과금 0 */
  'blocked',
  /** 정해진 시간 안에 답이 없었다 */
  'timeout',
  /** 출력 상한에서 잘렸다 — Gemini 는 thinking 과 본문이 같은 한도를 쓴다 */
  'truncated',
  /** 네트워크 오류 · 429 · 5xx — 제공사 쪽 일시 오류 */
  'providerTransient',
  /** 400 · 401 · 403 · 404 · 모르는 오류 — 다시 물어도 같거나 모른다 */
  'providerPermanent',
  /** 답은 왔는데 사용량을 읽지 못했다 — 🔴 비용은 UNKNOWN 으로 남는다 */
  'usageUnknown',
] as const
export type CallOutcome = (typeof CALL_OUTCOMES)[number]

/**
 * 🔴 **원천 하나가 한 회차에 쓸 수 있는 재시도 수.** 일시적 기술 실패 한 번만 다시 묻는다.
 *    정상 경로 3회 + 조건부 확인 1회 + 재시도 1회 = 5 — 회차 공동 예산을 넘지 않는다.
 *    🔴 이 값을 올리면 원천당 요청량이 늘어난다 — 요청량 결정은 이 배치의 권한이 아니다.
 */
export const GENERATION_RETRY_MAX = 1

/** 🔴 다시 물으면 달라질 수 있는 결과 — 단계별 제외를 적용하기 전의 후보 집합 */
export const TRANSIENT_CALL_OUTCOMES = [
  'timeout', 'truncated', 'providerTransient',
] as const satisfies readonly CallOutcome[]

/**
 * 🔴 **제공사 오류 코드가 일시적인가.** 모르는 코드는 일시적이 아니다(fail-closed) —
 *    모르는 실패에 돈을 한 번 더 쓰지 않는다.
 */
export function transientProviderError(code: string | null | undefined): boolean {
  const c = (code ?? '').trim()
  if (c === 'NETWORK') return true
  if (c === 'HTTP_429') return true
  return /^HTTP_5\d\d$/.test(c)
}

/**
 * 🔴 **요청 모양을 제공사가 받지 않았는가** (2026-10-24 D10 첫 댓글 HTTP_400). 400 은 같은 모양으로 다시 보내면
 *    같은 400 이다 — 같은 회차의 다른 대상·다른 Persona 에 다시 보내지 않는다. 일시 오류(429 · 5xx · NETWORK · TIMEOUT)는
 *    여기에 들지 않는다.
 */
export function requestShapeRejected(code: string | null | undefined): boolean {
  return (code ?? '').trim() === 'HTTP_400'
}

/** 🔴 `content-core-run` 의 `AskResult` 에서 분류에 필요한 칸만 */
export type CallResultLike = {
  ok: boolean
  truncated: boolean
  usageKnown: boolean
  blocked: boolean
  errorCode?: string | null
}

/**
 * 🔴 **한 요청의 결과를 분류한다.** 순서가 규칙이다 —
 *    나가지 않은 것 → 답이 없는 것 → 잘린 것 → 사용량 모르는 것.
 *    `completionOf`(content-core-run)와 같은 순서다. 둘이 다르면 같은 요청이 두 이름을 갖는다.
 */
export function classifyCall(r: CallResultLike): CallOutcome {
  if (r.blocked) return 'blocked'
  if (!r.ok) {
    const code = (r.errorCode ?? '').trim()
    if (code === 'TIMEOUT') return 'timeout'
    return transientProviderError(code) ? 'providerTransient' : 'providerPermanent'
  }
  if (r.truncated) return 'truncated'
  if (!r.usageKnown) return 'usageUnknown'
  return 'ok'
}

export function isTransientCall(o: CallOutcome): boolean {
  return (TRANSIENT_CALL_OUTCOMES as readonly string[]).includes(o)
}

/**
 * 🔴 **원천 하나의 최종 실패 유형** — 72시간 손실표와 같은 이름으로 센다.
 *    `IncompleteCause` 는 "다음 회차에 다시 볼까" 를 정하고, 이 값은 "무엇 때문에 잃었나" 를 말한다.
 *    둘을 한 칸에 담지 않는다 — 앞판이 그래서 timeout 과 400 을 구분하지 못했다.
 */
export const GENERATION_FAILURE_KINDS = [
  'timeout', 'truncated', 'parseSchema', 'provider', 'usageUnknown', 'budgetBlocked',
  'personaEligibility', 'safetyQuality', 'sourceContext', 'wiring',
] as const
export type GenerationFailureKind = (typeof GENERATION_FAILURE_KINDS)[number]

/** 🔴 어느 자리에서 잃었나 — 유료 단계 셋과 코드 단계 둘 */
export const GENERATION_FAILURE_STAGES = [
  'sourceNeed', 'personaDecision', 'draftGen', 'deterministic', 'semanticReview',
] as const
export type GenerationFailureStage = (typeof GENERATION_FAILURE_STAGES)[number]

export type GenerationFailure = {
  stage: GenerationFailureStage
  kind: GenerationFailureKind
  /** 🔴 이 실패 전에 같은 원천에서 재시도를 썼는가 — 재시도 뒤 다시 실패했으면 true */
  retried: boolean
}

/**
 * 🔴 **완주하지 못한 원인 → 손실 유형.** `noResponse` 만 마지막 요청 결과로 가른다
 *    (timeout 과 제공사 오류가 같은 원인 값을 쓴다).
 */
export function failureKindOf(
  cause: IncompleteCause, lastCall: CallOutcome | null,
): GenerationFailureKind {
  switch (cause) {
    case 'budgetBlocked': return 'budgetBlocked'
    case 'noResponse': return lastCall === 'timeout' ? 'timeout' : 'provider'
    case 'truncated': return 'truncated'
    case 'usageUnknown': return 'usageUnknown'
    case 'parseFailed': return 'parseSchema'
    case 'speakerUnqualified':
    case 'speakerSlotNarrowed':
    case 'voiceUnready':
    case 'personaTransformFailed':
    case 'loadBearingMismatch':
    case 'loadBearingSelfImpossible':
    case 'meaningUnpreservable':
      return 'personaEligibility'
    case 'deterministicFailed': return 'safetyQuality'
    case 'contextInsufficient':
    case 'evidenceBudgetViolated':
      return 'sourceContext'
    case 'wiringBroken': return 'wiring'
    default: {
      const never: never = cause
      return never
    }
  }
}
