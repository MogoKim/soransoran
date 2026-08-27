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
 * key 가 있는가. 🔴 **값을 반환하지 않는다.**
 *    있는지 없는지와, 사람이 "그 키가 맞나" 를 알아볼 최소한의 힌트만 준다.
 */
export function keyStatus(model: string): {
  envName: string
  present: boolean
  /** `sk-a…` 형태. 🔴 앞 4자뿐이고 나머지는 어디에도 남지 않는다 */
  hint: string
} {
  const envName = (PROVIDER_KEY_ENV as Record<string, string>)[model] ?? ''
  const raw = envName ? (process.env[envName] ?? '') : ''
  return {
    envName,
    present: raw.trim().length > 0,
    hint: raw.trim().length > 0 ? `${raw.slice(0, 4)}…` : '(없음)',
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
  errorCode: string | null
  /** 🔴 사유 요약만. 응답 본문을 그대로 담지 않는다 */
  errorMessage: string | null
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
    return {
      ok: false, rawText: '', inputTokens: 0, outputTokens: 0,
      errorCode: 'NO_API_KEY',
      errorMessage: `${status.envName} 가 없다`,
    }
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
    const body = isAnthropic
      ? {
          model: req.model,
          max_tokens: req.maxOutputTokens,
          system: req.systemPrompt,
          messages: [{ role: 'user', content: req.userPayload }],
        }
      : {
          model: req.model,
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
      return {
        ok: false, rawText: '', inputTokens: 0, outputTokens: 0,
        errorCode: `HTTP_${res.status}`,
        errorMessage: `provider 가 ${res.status} 로 응답했다`,
      }
    }

    const json = (await res.json()) as Record<string, unknown>
    const usage = (json.usage ?? {}) as Record<string, number>
    const text = isAnthropic
      ? String(((json.content as Array<{ text?: string }> | undefined)?.[0]?.text) ?? '')
      : String(
          ((json.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]
            ?.message?.content) ?? '',
        )

    return {
      ok: true,
      rawText: text,
      inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? 0,
      outputTokens: usage.output_tokens ?? usage.completion_tokens ?? 0,
      errorCode: null,
      errorMessage: null,
    }
  } catch (e: unknown) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return {
      ok: false, rawText: '', inputTokens: 0, outputTokens: 0,
      errorCode: aborted ? 'TIMEOUT' : 'NETWORK',
      // 🔴 예외 메시지에 payload 가 섞일 수 있어 유형만 남긴다
      errorMessage: aborted ? `${req.timeoutMs}ms 안에 응답이 없었다` : '네트워크 오류',
    }
  } finally {
    clearTimeout(timer)
  }
}
