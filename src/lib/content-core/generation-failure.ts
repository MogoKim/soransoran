/**
 * 생성 실패 분류 — 🔴 **한 유료 요청의 결과와 한 원천의 최종 실패를 값으로 가른다** (2026-10-12 Batch B)
 *
 * 🔴 **왜 따로 두는가.** 72시간 실측(10-08~10-11) 유료 생성 89회 중 기술 실패 35회가
 *    `noResponse` 하나에 timeout 과 제공사 오류를 섞어 담았다. 둘은 다음 행동이 다르다 —
 *    timeout·429·5xx 는 다시 물으면 달라질 수 있고, 400·401 은 다시 물어도 같다.
 *
 * 🔴 **재시도 자격의 단일 권위다** (2026-11-10 retry-authority-v7). 회차 안의 요청 재시도(`isTransientCall`)와
 *    회차를 넘는 원천 재선정(`retryClassOf` · `artifactRetryClass`)을 **이 파일 하나**가 정한다.
 *    앞판은 `review.ts` 의 `RETRYABLE_CAUSES` 가 따로 있어, 답을 받은 화자 부적격(`speakerSlotNarrowed`)·
 *    형식 오류(`parseFailed`)를 회차마다 다시 샀다 — 11-09·11-10 실측 12회차에서 lastCall 은 전부 `ok` 였고,
 *    같은 원천이 최대 11회 다시 뽑혔다. 그 목록은 지웠다(옛 소비처 0 은 `check:retry-authority` 가 막는다).
 *
 * 🔴 **같은 입력으로 원천을 다시 생성하지 않는다.** 같은 요청을 다시 물어 다른 답을 받는 것은 판정을 우회하는 것이다 —
 *    안전·품질 · 형식 오류 · 사용량 미상 · 전체 후보 자격 없음 · 뜻 보존 불가는 결론(`terminal`)이다.
 *    회차를 넘어 다시 보는 길은 둘뿐이고, 둘 다 같은 근거 지문(`evidenceFingerprintOf`)당 **딱 한 번**이다:
 *      · `transient`    답을 받지 못한 요청(timeout · 429 · 5xx · 네트워크 · 출력 절단) — 같은 입력으로 한 번 더
 *      · `speakerBound` 그 화자 묶음에서의 Persona 부적격 — 입력이 **달라진** 시도로만: 해법(`speakerRemedyOf`)이
 *                       `speakerSet` 이면 다른 화자 묶음, `stance` 이면 같은 사람 · 1인칭을 금지한 다른 자리
 *    같은 화자 묶음 재구매는 러너가 유료 호출 앞에서 막고(`speakerSetAlreadyFailed`), 두 번째도 끝나지 않으면 결론이다.
 */
import { createHash } from 'node:crypto'

/**
 * 🔴 **의존 방향은 한쪽이다** — `review.ts`(원인 어휘 · 검수 칸 모양의 주인) ← 이 파일(타입만) ← 소비자(런타임).
 *    이 파일은 `review.ts` 의 런타임 값을 import 하지 않고, `review.ts` 는 이 파일을 import 하지 않는다.
 *    검수 칸 모양 판정(`reviewShapeOk`)은 소비자가 먼저 하고 읽은 완주 기록만 넘긴다(`check:retry-authority` 의 순환 검사).
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

// ─────────────────────────────────────────────────────────
// 🔴 **회차를 넘는 원천 재선정 — 단일 권위** (2026-11-10 retry-authority-v7)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 판 이름 — 실패 지문에 들어간다. 이 규칙이 바뀌면 지문이 바뀌어 옛 결론을 새 규칙으로 다시 본다.
 */
export const RETRY_POLICY_VERSION = 'retry-authority-v7'

/**
 * 🔴 **한 원천의 지난 생성 결과를 다음 회차가 어떻게 다루는가**
 *
 *    `transient`    답을 받지 못했다(timeout · 429 · 5xx · 네트워크 · 출력 절단) — 같은 근거 지문으로 한 번 더 볼 수 있다
 *    `speakerBound` 답을 받았고 **그 화자 묶음에서** Persona 가 맞지 않았다(좁힌 묶음 · 화자 사실 변환 · load-bearing) —
 *                   같은 입력 재생성이 아니라 입력이 **달라진** 시도로만, 같은 근거 지문당 딱 한 번 다시 볼 수 있다.
 *                   해법은 `speakerRemedyOf` 가 원인별로 정한다:
 *                     · `speakerSet` (speakerSlotNarrowed · personaTransformFailed · loadBearingMismatch) — 다른 화자 묶음
 *                     · `stance`     (loadBearingSelfImpossible) — 같은 사람 · 1인칭(SELF)이 아닌 자리
 *                   (11-09·11-10 실측: 49회 재구매 중 채택 1 — 두 번째 시도였다)
 *    `terminal`     답을 받았고 결론이 났다(안전·품질 · 전체 후보 자격 없음 · 형식 오류 · 사용량 미상 · 구조 결함) —
 *                   같은 지문으로 다시 사지 않는다. 계약(원문 지문 · 모델 · 프롬프트 · 검수판 · Persona 풀 · 이 정책판)이
 *                   바뀌면 지문이 바뀌어 다시 볼 수 있다
 *    `unattempted`  유료 요청이 **나가지 않았다**(예산·상한 차단) — 시도가 아니다. 신규와 같은 자리에 선다
 */
export const RETRY_CLASSES = ['transient', 'speakerBound', 'terminal', 'unattempted'] as const
export type RetryClass = (typeof RETRY_CLASSES)[number]

/**
 * 🔴 **같은 근거 지문으로 회차를 넘어 다시 보는 횟수 상한** — 끝나지 않은 시도(transient · speakerBound · 읽지 못함)
 *    하나 뒤 한 번. 두 번째도 끝나지 않으면 결론이다(원인이 바뀌어도 초기화되지 않는다).
 *    회차 안의 요청 재시도(`GENERATION_RETRY_MAX`)와 별개다.
 */
export const CROSS_RUN_TRANSIENT_RETRY_MAX = 1

/**
 * 🔴 **원인 하나 → 재선정 처리.** `noResponse` 만 마지막 요청 결과로 가른다 —
 *    제공사가 요청 모양을 거절한 것(`providerPermanent` · 400 · 401 · 403 · 404 · 모름)은 다시 보내도 같다.
 *    🔴 이 함수 밖에서 원인 목록으로 재시도를 정하지 않는다(`check:retry-authority` ratchet).
 */
export function retryClassOf(cause: IncompleteCause, lastCall: CallOutcome | null): RetryClass {
  switch (cause) {
    case 'budgetBlocked': return 'unattempted'
    case 'noResponse':
      // 🔴 마지막 결과를 모르면(옛 artifact) 무응답으로 본다 — 무응답은 일시 실패 목록에 있다
      return lastCall === 'providerPermanent' ? 'terminal' : 'transient'
    case 'truncated': return 'transient'
    // 🔴 답을 받았다 — 형식을 어겼거나 사용량을 못 읽었을 뿐 다시 물으면 다시 돈이 든다
    case 'parseFailed':
    case 'usageUnknown':
      return 'terminal'
    // 🔴 그 화자 묶음에서의 Persona 부적격 — 원천 탓이 아니다. 해법(`speakerRemedyOf`)별로 **입력이 달라진** 시도로만
    //    근거 지문당 딱 한 번: `speakerSet` 이면 다른 화자 묶음, `stance`(loadBearingSelfImpossible)이면 같은 사람 · SELF 아닌 자리
    //    (같은 화자 묶음 재구매는 러너가 유료 호출 앞에서 막는다)
    case 'speakerSlotNarrowed':
    case 'personaTransformFailed':
    case 'loadBearingMismatch':
    case 'loadBearingSelfImpossible':
      return 'speakerBound'
    // 🔴 전체 후보에서도 자격이 없다 · 어떤 자리로도 뜻이 보존되지 않는다 — 결론
    case 'speakerUnqualified':
    case 'voiceUnready':
    case 'meaningUnpreservable':
    case 'contextInsufficient':
    case 'evidenceBudgetViolated':
    case 'wiringBroken':
    case 'deterministicFailed':
      return 'terminal'
    default: {
      const never: never = cause
      return never
    }
  }
}

/**
 * 🔴 **읽은 완주 기록 하나 → 재선정 처리.** 검수 칸 모양 판정은 부르는 쪽 몫이다 — 모양을 못 읽었으면 이 함수를
 *    부르지 않고 `unknown` 으로 둔다(이 파일이 `review.ts` 런타임에 기대지 않게 하는 경계).
 *    완주했으면(ADOPT·HOLD·DROP 결론) `terminal` 이다. 채택 여부는 부르는 쪽이 `machineOutcome` 으로 가른다.
 */
export function completionRetryClass(
  c: { complete: boolean; cause: IncompleteCause | null }, lastCall: CallOutcome | null,
): RetryClass {
  if (c.complete || c.cause === null) return 'terminal'
  return retryClassOf(c.cause, lastCall)
}

/**
 * 🔴 **speakerBound 의 해법 — 무엇이 바뀌어야 다시 볼 가치가 있나** (단일 권위).
 *    `speakerSet` 좁힌 묶음 · 화자 사실 변환 · 조건 불일치 — **다른 화자 묶음**이어야 한다(같은 묶음 재구매는 러너가 막는다).
 *                 사실 변환 · 조건 불일치는 회차 안 재계획이 실패 화자를 빼므로 묶음 열쇠(`|excl=`)가 저절로 달라진다.
 *    `stance`     조건을 만족하는 화자가 없다 — 사람은 그대로, 1인칭을 금지한 **다른 자리**로 다시 계획한다.
 *    speakerBound 가 아니면 `null`.
 */
export type SpeakerRemedy = 'speakerSet' | 'stance'
export function speakerRemedyOf(cause: IncompleteCause | null | undefined): SpeakerRemedy | null {
  switch (cause) {
    case 'speakerSlotNarrowed':
    case 'personaTransformFailed':
    case 'loadBearingMismatch':
      return 'speakerSet'
    case 'loadBearingSelfImpossible':
      return 'stance'
    default:
      return null
  }
}

/** 🔴 artifact 비용 칸의 마지막 요청 결과 — 모양이 다르거나 없으면 `null` */
export function lastCallOutcomeOf(cost: unknown): CallOutcome | null {
  if (cost === null || typeof cost !== 'object') return null
  const calls = (cost as { calls?: unknown }).calls
  if (!Array.isArray(calls) || calls.length === 0) return null
  const last = calls[calls.length - 1] as { outcome?: unknown } | null
  const o = last !== null && typeof last === 'object' ? last.outcome : undefined
  return typeof o === 'string' && (CALL_OUTCOMES as readonly string[]).includes(o) ? o as CallOutcome : null
}

const sha32 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 32)

/**
 * 🔴 **근거 지문** — 같은 원문 지문 · 같은 생성 계약(프롬프트 · 모델 · 검수판 · 출력 상한 · 말투 자산 · Persona 풀) ·
 *    같은 artifact 판 · 같은 재시도 정책판이면 같은 값이다. 어느 하나가 바뀌면 새 지문이다.
 *    🔴 회차를 넘는 transient 상한은 **이 지문**에 건다 — 원인이 timeout → truncated 로 바뀌어도 상한이 초기화되지 않는다.
 *    🔴 입력은 이미 해시·판 이름뿐이다 — 원문 · 제목 · 작성자 · 원문 id 평문을 받지 않는다.
 */
export function evidenceFingerprintOf(i: { artifactVersion: string; contractIdentity: string }): string {
  return sha32(`${RETRY_POLICY_VERSION}|${i.artifactVersion}|${i.contractIdentity}`)
}

/**
 * 🔴 **화자 묶음 열쇠 — 단일 helper** (2026-11-10). 생성 캐시 key 와 결론 판독(실패 지문 · 같은 묶음 재구매 차단)이
 *    **이 함수 하나**를 쓴다. 두 곳이 문자열을 따로 이으면 캐시와 결론이 다시 두 권위가 된다.
 *    🔴 바이트가 앞판 캐시 key 꼬리(`speakers=<16>` + `|excl=<16>`)와 같다 — 캐시를 무효화하지 않는다.
 *    입력은 Persona 코드(공개 원문 아님)뿐이고 출력은 해시다.
 */
export function speakerSetKeyOf(i: { speakerCodes: readonly string[]; excludedCodes: readonly string[] }): string {
  const d16 = (x: string): string => createHash('sha256').update(x, 'utf8').digest('hex').slice(0, 16)
  const excl = i.excludedCodes.length === 0 ? '' : `|excl=${d16([...i.excludedCodes].sort().join(','))}`
  return `speakers=${d16(i.speakerCodes.join(','))}${excl}`
}

/**
 * 🔴 **화자 묶음 열쇠의 단일 형식** — `speakerSetKeyOf` 가 내는 모양만 받는다(`speakers=<16 hex>` + 선택 `|excl=<16 hex>`).
 *    artifact 의 `speakerSetDigest` 를 읽는 쪽은 이 판정으로 거르고, 모양이 틀리면 fail-closed(그 기록을 믿지 않는다).
 */
export const SPEAKER_SET_KEY_RE = /^speakers=[0-9a-f]{16}(?:\|excl=[0-9a-f]{16})?$/
export function isSpeakerSetKey(v: unknown): v is string {
  return typeof v === 'string' && SPEAKER_SET_KEY_RE.test(v)
}

/** 🔴 **시도 열쇠** — artifact 판 · 생성 계약 · 화자 묶음. 생성 캐시 key 가 이 값을 그대로 쓴다 */
export function generationAttemptKeyOf(i: { artifactVersion: string; contractIdentity: string; speakerSetKey: string }): string {
  return `${i.artifactVersion}|${i.contractIdentity}|${i.speakerSetKey}`
}

/**
 * 🔴 **실패 지문** — 근거 지문 + 화자 묶음 + 원인 + 마지막 요청 결과 + 재선정 처리. 원인 · 화자 묶음이 다르면 다른 지문이다
 *    (결론 · 비용 귀속의 열쇠). 회차를 넘는 상한(`CROSS_RUN_TRANSIENT_RETRY_MAX`)은 이보다 넓은 **근거 지문**에 걸리므로
 *    "같은 실패 지문당 1회" 는 "같은 근거 지문당 1회" 로 더 강하게 보장된다. 화자 묶음을 모르면(옛 artifact) `unknown`.
 */
export function failureFingerprintOf(i: {
  evidenceFingerprint: string; speakerSetKey: string | null; cause: IncompleteCause | null; lastCall: CallOutcome | null
}): string {
  const cls = i.cause === null ? 'terminal' : retryClassOf(i.cause, i.lastCall)
  return sha32(`${i.evidenceFingerprint}|${i.speakerSetKey ?? 'unknown'}|${i.cause ?? 'complete'}|${i.lastCall ?? 'none'}|${cls}`)
}

/**
 * 🔴 **유료 생성 재선정 몫** — 신규 원천을 언제나 먼저 처리하고, 재선정은 묶음 상한의 10% 까지만 쓴다.
 *    상한이 10 보다 작으면 0 이다(억지로 채우지 않는다). `freshOnly` 는 축소 운영 — 재선정 0.
 */
export const RETRY_SHARE_MAX = 0.1
export const RETRY_MODES = ['normal', 'freshOnly'] as const
export type RetryMode = (typeof RETRY_MODES)[number]

export function retrySlotsFor(i: { limit: number; mode: RetryMode }): number {
  if (i.mode === 'freshOnly') return 0
  const limit = Number.isInteger(i.limit) && i.limit > 0 ? i.limit : 0
  return Math.floor(limit * RETRY_SHARE_MAX)
}

/**
 * 🔴 **축소 운영 선택 — 순수 함수 · 새 env 없음.** 실측 수율이 없는 회복 canary(`boundedRecovery`)는 신규 원천의
 *    수율을 재는 자리라 재선정을 섞지 않는다. 그 밖에는 `normal` 이다. 부르는 쪽이 더 강한 신호로 `freshOnly` 를 줄 수 있다.
 */
export function retryModeFor(i: { paidBasis: 'noDemand' | 'boundedRecovery' | 'measuredYield' }): RetryMode {
  return i.paidBasis === 'measuredYield' ? 'normal' : 'freshOnly'
}
