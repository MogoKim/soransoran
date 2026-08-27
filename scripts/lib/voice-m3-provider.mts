/**
 * VE-M3 provider adapter — 🔴 **이 저장소에서 유료 API 를 부르는 유일한 파일**
 *
 * 정본: docs/operations/2026-08-27-voice-m3-llm-experiment-contract.md §E · §F
 *
 * 🔴 왜 여기만 허용하는가
 *    VE-M2 까지는 어디에도 네트워크 호출이 없었고 fixture 가 그것을 잠갔다.
 *    이제 실행 경로가 필요하지만, **경로가 하나면 감시할 곳도 하나**다.
 *    dry-run · check 파일에서는 여전히 금지이며 fixture 가 그것을 검사한다.
 *
 * 🔴 import 만으로는 아무 일도 일어나지 않는다
 *    top-level 에서 호출하지 않는다. 함수를 명시적으로 불러야 나간다.
 *    모듈을 읽는 것만으로 돈이 나가는 구조를 만들지 않는다.
 *
 * 🔴 API key 를 로그에 찍지 않는다
 *    존재 여부(boolean)와 앞 4자만 다룬다. 값은 어디에도 남기지 않는다.
 */

// 🔴 상한 도달 판정은 계약에 있다. 여기서 다시 쓰지 않는다 —
//    두 곳에 각각 적으면 한쪽만 바뀌는 날이 온다(20자 임계값에서 같은 결정을 했다).
// 🔴 provider 에 보낼 **실제 모델 ID** 도 계약에서 가져온다.
//    내부 라벨을 그대로 body.model 에 넣어 Haiku 30건이 HTTP_404 로 전멸했다(2026-08-27).
import { isMaxTokensReached, apiModelIdFor } from './voice-m3-contract.mjs'

/** provider 별 key 환경변수. 🔴 값이 아니라 이름이다 */
export const PROVIDER_KEY_ENV = {
  'gpt-5-nano': 'OPENAI_API_KEY',
  'claude-haiku-4.5': 'ANTHROPIC_API_KEY',
} as const

export type ProviderModel = keyof typeof PROVIDER_KEY_ENV

/** provider 엔드포인트. 🔴 호출은 아래 함수 안에서만 일어난다 */
const ENDPOINT = {
  'gpt-5-nano': 'https://api.openai.com/v1/chat/completions',
  'claude-haiku-4.5': 'https://api.anthropic.com/v1/messages',
} as const

/**
 * key 가 있는가. 🔴 **값을 한 조각도 반환하지 않는다.**
 *
 * 초판은 `sk-a…` 같은 앞 4자 힌트를 돌려줬다. 그것도 값의 일부다 —
 * prefix 만으로 어느 provider 의 어떤 종류 키인지가 드러나고,
 * 로그는 우리가 통제하지 못하는 곳(터미널 기록 · CI · 화면 공유)에 남는다.
 *
 * 🔴 반환은 **환경변수 이름과 boolean 뿐**이다.
 *    길이도 주지 않는다. 길이는 키 종류를 좁히는 단서가 된다.
 */
export function keyStatus(model: string): {
  envName: string
  present: boolean
} {
  const envName = (PROVIDER_KEY_ENV as Record<string, string>)[model] ?? ''
  const raw = envName ? (process.env[envName] ?? '') : ''
  return {
    envName,
    present: raw.trim().length > 0,
  }
}

export type LlmRequest = {
  model: ProviderModel
  systemPrompt: string
  userPayload: string
  maxOutputTokens: number
  timeoutMs: number
}

export type LlmResponse = {
  ok: boolean
  /** 원문이 아니라 **모델이 만든 JSON 문자열**. 저장 전 유출 대조를 통과해야 한다 */
  rawText: string
  inputTokens: number
  outputTokens: number
  /**
   * 🔴 종료 사유. OpenAI `finish_reason` · Anthropic `stop_reason`.
   *
   * 1차 실행이 이 값을 안 받아서 "왜 잘렸는가" 를 확정하지 못했다.
   * 이제 **비어 있으면 실패로 처리한다** — 잘림 여부를 판정할 수 없는 응답을
   * 성공으로 세면 같은 사고가 조용히 반복된다.
   */
  finishReason: string
  /** reasoning 모델만. 없으면 null. 🔴 이 값이 상한을 먹은 범인이었다 */
  reasoningTokens: number | null
  /** 🔴 응답 **길이**만. 응답 자체는 여기 담기지 않는다 */
  responseChars: number
  /** 상한에 닿았는가. 종료 사유 + 토큰 대조 둘 다 본다 */
  maxTokensReached: boolean
  errorCode: string | null
  /** 🔴 사유 요약만. 응답 본문을 그대로 담지 않는다 */
  errorMessage: string | null
}

/** 실패 응답을 만든다. 🔴 진단 필드를 빠뜨리지 않기 위한 한 자리 */
function failure(
  errorCode: string, errorMessage: string,
  partial?: Partial<Pick<LlmResponse, 'inputTokens' | 'outputTokens' | 'finishReason'
    | 'reasoningTokens' | 'responseChars' | 'maxTokensReached'>>,
): LlmResponse {
  return {
    ok: false, rawText: '',
    inputTokens: 0, outputTokens: 0,
    finishReason: '', reasoningTokens: null, responseChars: 0, maxTokensReached: false,
    ...partial,
    errorCode, errorMessage,
  }
}

/** usage 에서 숫자만 안전하게 꺼낸다 */
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/**
 * 🔴 **여기서 돈이 나간다.**
 *
 * 이 함수를 부르는 곳은 `voice-m3-run.mts` 의 유료 게이트 뒤 한 곳뿐이며,
 * 그 게이트는 `--apply` · `--confirm-paid-call` · 모델 · 단계 · cap · key 를 전부 요구한다.
 *
 * 🔴 이 파일은 게이트를 검사하지 않는다. 게이트는 호출부의 책임이다 —
 *    여기서도 검사하면 "어디서 막히는가" 가 두 곳이 되어 추적이 어려워진다.
 */
export async function callProvider(req: LlmRequest): Promise<LlmResponse> {
  const status = keyStatus(req.model)
  if (!status.present) {
    return failure('NO_API_KEY', `${status.envName} 가 없다`)
  }
  const url = ENDPOINT[req.model]
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, req.timeoutMs)

  try {
    const isAnthropic = req.model === 'claude-haiku-4.5'
    const key = process.env[status.envName] ?? ''
    const headers: Record<string, string> = isAnthropic
      ? {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        }
      : {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
        }
    // 🔴 **`req.model` 을 그대로 넣지 않는다.** 그것은 우리가 붙인 내부 라벨이고,
    //    provider 가 아는 이름이 아니다. `claude-haiku-4.5` 를 그대로 보냈다가
    //    30건이 전부 HTTP_404 로 돌아왔다(2026-08-27, 비용 0원).
    const apiModelId = apiModelIdFor(req.model)
    const body = isAnthropic
      ? {
          model: apiModelId,
          max_tokens: req.maxOutputTokens,
          system: req.systemPrompt,
          messages: [{ role: 'user', content: req.userPayload }],
        }
      : {
          model: apiModelId,
          max_completion_tokens: req.maxOutputTokens,
          messages: [
            { role: 'system', content: req.systemPrompt },
            { role: 'user', content: req.userPayload },
          ],
        }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      // 🔴 응답 본문을 그대로 담지 않는다. 상태 코드와 짧은 사유만
      return failure(`HTTP_${res.status}`, `provider 가 ${res.status} 로 응답했다`)
    }

    const json = (await res.json()) as Record<string, unknown>
    const usage = (json.usage ?? {}) as Record<string, unknown>
    const choice = (json.choices as Array<{
      message?: { content?: string }
      finish_reason?: string
    }> | undefined)?.[0]
    const text = isAnthropic
      ? String(((json.content as Array<{ text?: string }> | undefined)?.[0]?.text) ?? '')
      : String(choice?.message?.content ?? '')

    const inputTokens = num(usage.input_tokens) || num(usage.prompt_tokens)
    const outputTokens = num(usage.output_tokens) || num(usage.completion_tokens)
    // 🔴 reasoning 토큰. OpenAI 는 completion_tokens_details 안에 준다.
    //    Anthropic 은 thinking 을 켜지 않았으므로 null 이다 — 0 이 아니다.
    //    0 이면 "추론을 안 썼다", null 이면 "알 수 없다" 로 읽힌다. 둘은 다르다.
    const details = (usage.completion_tokens_details ?? null) as Record<string, unknown> | null
    const reasoningTokens = isAnthropic || details === null
      ? null
      : num(details.reasoning_tokens)
    const finishReason = isAnthropic
      ? String(json.stop_reason ?? '')
      : String(choice?.finish_reason ?? '')
    const maxTokensReached = isMaxTokensReached(finishReason, outputTokens, req.maxOutputTokens)

    // 🔴 종료 사유가 없으면 성공으로 세지 않는다.
    //    "잘렸는지 알 수 없는 응답" 을 통과시킨 것이 1차 실행의 진단 공백이었다.
    //    토큰은 이미 청구됐으므로 수치는 그대로 실어 보낸다 — cap 계상이 어긋나면 안 된다.
    if (finishReason.trim() === '') {
      return failure('NO_FINISH_REASON', 'provider 응답에 종료 사유가 없다 — 잘림 여부를 판정할 수 없다', {
        inputTokens, outputTokens, reasoningTokens,
        responseChars: text.length, maxTokensReached,
      })
    }

    return {
      ok: true,
      rawText: text,
      inputTokens, outputTokens,
      finishReason, reasoningTokens,
      responseChars: text.length,
      maxTokensReached,
      errorCode: null,
      errorMessage: null,
    }
  } catch (e: unknown) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    // 🔴 예외 메시지에 payload 가 섞일 수 있어 유형만 남긴다
    return failure(
      aborted ? 'TIMEOUT' : 'NETWORK',
      aborted ? `${req.timeoutMs}ms 안에 응답이 없었다` : '네트워크 오류',
    )
  } finally {
    clearTimeout(timer)
  }
}
