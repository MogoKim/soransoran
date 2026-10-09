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
  'gpt-5-mini': 'OPENAI_API_KEY',
  'claude-haiku-4.5': 'ANTHROPIC_API_KEY',
  // 🔴 오리지널 게시글 초안 실험용 (2026-09-01). VE-M3 판정 기준선과 무관하다.
  //    2.5-pro 는 이 계정에서 generateContent 가 404 다("no longer available to
  //    new users", 실측) — 목록에 보인다고 호출되는 것이 아니라서 등록하지 않는다
  'gemini-3.7-flash': 'GEMINI_API_KEY',
} as const

export type ProviderModel = keyof typeof PROVIDER_KEY_ENV

/** provider 엔드포인트. 🔴 호출은 아래 함수 안에서만 일어난다 */
const ENDPOINT = {
  'gpt-5-nano': 'https://api.openai.com/v1/chat/completions',
  'gpt-5-mini': 'https://api.openai.com/v1/chat/completions',
  'claude-haiku-4.5': 'https://api.anthropic.com/v1/messages',
  // 🔴 모델 ID 가 경로에 들어간다. 아래 callProvider 가 apiModelId 로 치환한다 —
  //    ENDPOINT 에 내부 라벨을 그대로 박으면 Haiku 404 를 Gemini 에서 되풀이한다
  'gemini-3.7-flash': 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
} as const

/**
 * 🔴 Gemini 응답 형식 강제 (2026-09-01).
 *
 * Anthropic 은 assistant prefill 로 ```json 울타리를 구조적으로 막았지만
 * Gemini 에는 prefill 이 없다. 대신 **`responseMimeType`** 이 있다 —
 * 모델이 JSON 만 내보내도록 API 가 강제하므로 울타리가 나올 자리가 없다.
 * 프롬프트로 부탁하는 것과 달리 형식이 계약으로 보장된다.
 */
export const GEMINI_RESPONSE_MIME = 'application/json'

/**
 * 🔴 **Anthropic 전용 assistant prefill** (2026-08-27).
 *
 * Haiku 30건 재실행이 `JSON_PARSE:fenced` 5건으로 중단됐다.
 * 응답은 정상 도착했고(`finish=end_turn`, 잘림 없음) 판정 내용도 들어 있었는데,
 * 모델이 그것을 ```json 코드 울타리로 감싸 보냈다. 우리 파서는 `{` 로 시작하는
 * 문자열만 받으므로 통째로 버려졌다 — **Haiku 품질 실패가 아니라 출력 형식 문제**다.
 *
 * 🔴 왜 prefill 인가
 *    응답 첫 글자를 우리가 정해 주면 모델은 **그 뒤를 이어 쓴다.** `{` 로 시작한
 *    문장에 울타리를 덧댈 자리가 없다 — 프롬프트로 부탁하는 것과 달리
 *    **구조적으로 불가능**해진다.
 *
 * 🔴 프롬프트를 바꾸지 않는 이유
 *    문구를 고치면 `M3_PROMPT_VERSION` 을 올려야 하고, 그러면 cacheKey 가 달라져
 *    **gpt-5-nano 30건 기준선이 통째로 무효**가 된다($0.056 재소진).
 *    prefill 은 요청 조립 방식일 뿐 프롬프트가 아니라서 그 대가를 치르지 않는다.
 *
 * ⚠️ 값에 **뒤쪽 공백을 넣지 않는다.** Anthropic 은 trailing whitespace 가 있는
 *    assistant prefill 을 400 으로 거부한다.
 */
export const ANTHROPIC_JSON_PREFILL = '{'

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
  /**
   * 🔴 **사용량을 실제로 읽었는가** (2026-09-17 추가).
   *
   *    이전 판은 실패할 때도 `inputTokens: 0, outputTokens: 0` 을 돌려줬다.
   *    그래서 "정말 0 토큰" 과 "모른다" 가 **구분되지 않았고**, 장부가 모르는 건을
   *    0원으로 적을 수 있었다. 기존 두 칸의 타입은 그대로 두고(호출부 호환),
   *    이 칸으로 그 둘을 가른다 — `false` 면 위 두 숫자는 값이 아니라 자리 채움이다.
   */
  usageKnown: boolean
  /** 캐시 쓰기 토큰. 🔴 사용량을 못 읽었으면 null */
  cacheWriteTokens: number | null
  /** 캐시 읽기 토큰. 🔴 사용량을 못 읽었으면 null */
  cacheReadTokens: number | null
  /**
   * 🔴 제공사 usage 객체의 **키 이름만**. 값은 담지 않는다.
   *    우리가 읽지 않는 과금 항목이 응답에 나타나면 그 사실이 드러나야 한다.
   */
  usageKeys: string[]
  /**
   * 🔴 **제공사 usage 의 숫자 칸 원값** (2026-10-09 P0) — 최상위의 유한한 숫자만(토큰 수). 문자열 · 중첩 객체 · 본문 없음.
   *    사용량을 해석하지 못한 건도 이 원값이 장부에 남아야 사후에 근거로 대조할 수 있다(앞판은 키 이름만 남겼다).
   */
  usageNumbers?: Record<string, number>
}

/** 실패 응답을 만든다. 🔴 진단 필드를 빠뜨리지 않기 위한 한 자리 */
function failure(
  errorCode: string, errorMessage: string,
  partial?: Partial<Pick<LlmResponse, 'inputTokens' | 'outputTokens' | 'finishReason'
    | 'reasoningTokens' | 'responseChars' | 'maxTokensReached'
    | 'usageKnown' | 'cacheWriteTokens' | 'cacheReadTokens' | 'usageKeys' | 'usageNumbers'>>,
): LlmResponse {
  return {
    ok: false, rawText: '',
    inputTokens: 0, outputTokens: 0,
    finishReason: '', reasoningTokens: null, responseChars: 0, maxTokensReached: false,
    // 🔴 실패는 기본이 **모름**이다. 위의 0 두 개를 값으로 읽지 않게 한다
    usageKnown: false, cacheWriteTokens: null, cacheReadTokens: null, usageKeys: [],
    ...partial,
    errorCode, errorMessage,
  }
}

/** 🔴 usage 객체의 최상위 **유한한 숫자 칸만** — 장부 근거용(문자열 · 중첩 객체는 담지 않는다) */
export function usageNumbersOf(u: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(u)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
  return out
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
  // 🔴 Gemini 는 모델 ID 가 **경로**에 들어간다. 내부 라벨을 그대로 쓰면
  //    Haiku 가 겪은 404 를 URL 쪽에서 되풀이한다 — apiModelId 로 치환한다
  const url = ENDPOINT[req.model].replace('{model}', apiModelIdFor(req.model))
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, req.timeoutMs)

  try {
    const isAnthropic = req.model === 'claude-haiku-4.5'
    // 🔴 Gemini 는 요청·응답 형태가 둘 다와 다르다. 여기서만 분기하고
    //    바깥(생성기·run)에는 한 줄도 새지 않는다 — 유료 경로가 하나여야 감시도 하나다
    // 🔴 모델명을 하나 박지 않는다. Gemini 계열은 요청·응답 형태가 같으므로
    //    모델이 바뀔 때마다 이 줄을 고치게 두면 언젠가 빠뜨린다 —
    //    실제로 2.5-pro → 3.7-flash 교체가 하루 만에 일어났다.
    const isGemini = req.model.startsWith('gemini-')
    const key = process.env[status.envName] ?? ''
    const headers: Record<string, string> = isAnthropic
      ? {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        }
      : isGemini
        ? {
            'content-type': 'application/json',
            // 🔴 key 를 URL 쿼리 문자열에 붙이지 않는다. Gemini 는 그 방식도 받지만
            //    URL 은 로그·에러 메시지·프록시 기록에 남는다. 헤더로 보내면 그 경로가 닫힌다
            'x-goog-api-key': key,
          }
        : {
            'content-type': 'application/json',
            authorization: `Bearer ${key}`,
          }
    // 🔴 **`req.model` 을 그대로 넣지 않는다.** 그것은 우리가 붙인 내부 라벨이고,
    //    provider 가 아는 이름이 아니다. `claude-haiku-4.5` 를 그대로 보냈다가
    //    30건이 전부 HTTP_404 로 돌아왔다(2026-08-27, 비용 0원).
    const apiModelId = apiModelIdFor(req.model)
    // 🔴 분기 순서를 Anthropic → Gemini → OpenAI 로 둔다.
    //    voice-m3-check 가 `const body = isAnthropic` 를 기준점으로 body 조립부를
    //    찾아 "양쪽 다 apiModelId 를 쓰는가 · prefill 이 Anthropic 에만 붙는가" 를 본다.
    //    Gemini 를 앞에 두면 그 가드가 조립부를 못 찾아 조용히 무력화된다 —
    //    새 분기를 넣느라 기존 가드를 눈멀게 하지 않는다.
    const body = isAnthropic
      ? {
          model: apiModelId,
          max_tokens: req.maxOutputTokens,
          system: req.systemPrompt,
          messages: [
            { role: 'user', content: req.userPayload },
            // 🔴 assistant prefill — 모델이 `{` 뒤를 이어 쓴다.
            //    ```json 울타리가 나올 자리를 없앤다(2026-08-27 fenced 5건).
            //    OpenAI 쪽에는 붙이지 않는다 — nano 는 순수 JSON 을 잘 반환했고,
            //    불필요한 prefill 은 기준선을 흔들 뿐이다.
            { role: 'assistant', content: ANTHROPIC_JSON_PREFILL },
          ],
        }
      : isGemini
        ? {
            // 🔴 모델 ID 는 body 가 아니라 **URL 경로**에 들어간다(위 url 참조).
            //    그래서 이 분기에만 body.model 이 없다 — 빠뜨린 것이 아니다.
            // 🔴 systemInstruction 은 contents 와 **다른 자리**다.
            //    system 을 user 턴에 합치면 모델이 그것을 사용자 발화로 읽는다.
            systemInstruction: { parts: [{ text: req.systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: req.userPayload }] }],
            generationConfig: {
              maxOutputTokens: req.maxOutputTokens,
              // 🔴 울타리를 막는 자리. Anthropic prefill 과 같은 목적이고,
              //    prefill 이 없는 provider 라 API 계약으로 대신한다.
              responseMimeType: GEMINI_RESPONSE_MIME,
            },
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
    // 🔴 prefill 을 쓰면 응답에 **여는 `{` 가 들어 있지 않다.**
    //    모델은 우리가 준 첫 글자 뒤부터 이어 쓰기 때문이다.
    //    다시 앞에 붙여야 완전한 JSON 이 된다 — 빠뜨리면 이번엔 `not_json` 으로 전멸한다.
    //    유출 대조 · 금지어 검사도 이 재조립된 문자열을 본다.
    // 🔴 Gemini 는 candidates[0].content.parts[] 에 나눠 담아 보낼 수 있다.
    //    parts[0] 만 읽으면 긴 응답이 조용히 잘린다 — 전부 이어 붙인다
    const geminiCand = (json.candidates as Array<{
      content?: { parts?: Array<{ text?: string }> }
      finishReason?: string
    }> | undefined)?.[0]
    const geminiText = (geminiCand?.content?.parts ?? [])
      .map((pt) => String(pt.text ?? ''))
      .join('')

    const continuation = isGemini
      ? geminiText
      : isAnthropic
        ? String(((json.content as Array<{ text?: string }> | undefined)?.[0]?.text) ?? '')
        : String(choice?.message?.content ?? '')
    const text = isAnthropic && continuation !== ''
      ? ANTHROPIC_JSON_PREFILL + continuation
      : continuation

    // 🔴 Gemini 는 usageMetadata 에 담고 이름도 다르다(promptTokenCount 등)
    const gUsage = (json.usageMetadata ?? {}) as Record<string, unknown>
    // 🔴 Gemini 해석은 순수 함수 하나로 모은다 — 두 곳에 적으면 한쪽이 낡는다
    const gRead = isGemini ? readGeminiUsage(gUsage) : null
    const inputTokens = gRead !== null
      ? gRead.inputTokens
      : num(usage.input_tokens) || num(usage.prompt_tokens)
    /**
     * 🔴 **Gemini 출력 과금 = 보이는 출력 + thinking** (2026-09-19 공식 문서 확인).
     *
     *    https://ai.google.dev/gemini-api/docs/thinking —
     *    *"When thinking is turned on, response pricing is the sum of output tokens
     *    and thinking tokens."* 앞판은 `candidatesTokenCount` 만 셌다. 그러면
     *    **thinking 비용이 통째로 장부에서 빠진다.**
     *    `totalTokenCount` 도 *"prompt + thoughts + response candidates"* 다.
     */
    const outputTokens = gRead !== null
      ? gRead.outputTokens
      : num(usage.output_tokens) || num(usage.completion_tokens)
    // 🔴 reasoning 토큰. OpenAI 는 completion_tokens_details 안에 준다.
    //    Anthropic 은 thinking 을 켜지 않았으므로 null 이다 — 0 이 아니다.
    //    0 이면 "추론을 안 썼다", null 이면 "알 수 없다" 로 읽힌다. 둘은 다르다.
    const details = (usage.completion_tokens_details ?? null) as Record<string, unknown> | null
    // 🔴 Gemini 2.5 는 thinking 토큰을 usageMetadata.thoughtsTokenCount 로 준다.
    //    없으면 null 이다 — 0 이 아니다. 0 은 "안 썼다", null 은 "알 수 없다" 로 읽힌다
    const reasoningTokens = gRead !== null
      ? gRead.thoughtsTokens
      : isAnthropic || details === null
        ? null
        : num(details.reasoning_tokens)
    const finishReason = isGemini
      ? String(geminiCand?.finishReason ?? '')
      : isAnthropic
        ? String(json.stop_reason ?? '')
        : String(choice?.finish_reason ?? '')
    const maxTokensReached = isMaxTokensReached(finishReason, outputTokens, req.maxOutputTokens)

    /**
     * 🔴 **사용량을 실제로 읽었는지 판정한다** (2026-09-17).
     *
     *    `num()` 은 없는 값을 0 으로 바꾼다 — 편하지만 위험하다.
     *    여기서는 **키가 있고 숫자였는가**를 따로 본다. 하나라도 아니면 `usageKnown=false`
     *    이고, 장부는 그 건을 **미정산**으로 남긴다. 0원으로 적지 않는다.
     */
    const usageObj = isGemini ? gUsage : usage
    const usageKeys = Object.keys(usageObj)
    const usageNumbers = usageNumbersOf(usageObj)
    const isNum = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v)
    /**
     * 🔴 **thinking 토큰을 못 읽으면 `usageUnknown` 이다** (2026-09-19).
     *    싸게 추정하지 않는다 — 모르면 미정산으로 남기는 것이 장부의 계약이다.
     *    `thoughtsTokenCount` 는 thinking 을 쓰지 않은 응답에서 **아예 없을 수** 있다 —
     *    그때는 `readGeminiUsage` 가 공식 합계(`total − prompt − candidates`)로 계산한다(2026-10-09). total 도 없으면 미상이다.
     */
    const usageKnown = gRead !== null
      ? gRead.usageKnown
      : (isNum(usage.input_tokens) || isNum(usage.prompt_tokens))
        && (isNum(usage.output_tokens) || isNum(usage.completion_tokens))
    /**
     * 🔴 캐시 토큰. **사용량 자체를 못 읽었으면 `null`(모름)** 이다.
     *
     *    읽었는데 캐시 칸이 없으면 `0` 으로 본다 — 우리는 `cache_control` 을 보내지 않으므로
     *    캐시 쓰기·읽기가 일어날 수 없다. 🔴 이것은 **요청 모양에 근거한 판단**이고,
     *    요청이 바뀌면 틀린다. 그래서 `usageKeys` 를 함께 남겨 사람이 대조할 수 있게 한다 —
     *    응답에 우리가 안 읽는 과금 칸이 생기면 장부에 그 이름이 나타난다.
     */
    const cacheNum = (v: unknown): number => (isNum(v) ? (v as number) : 0)
    /**
     * 🔴 **Gemini 는 캐시 칸 이름이 다르다** — `cachedContentTokenCount` 하나다
     *    (공식 문서: *"Number of tokens in the cached part of the prompt"*).
     *    우리는 `cachedContent` 를 보내지 않으므로 나타날 수 없지만, 나타나면
     *    0 으로 뭉개지 않고 **읽기 쪽 단가로** 계산한다.
     */
    const cacheWriteTokens = gRead !== null ? gRead.cacheWriteTokens
      : !usageKnown ? null
        : cacheNum(usage.cache_creation_input_tokens) + cacheNum(usage.cache_creation)
    const cacheReadTokens = gRead !== null ? gRead.cacheReadTokens
      : !usageKnown ? null : cacheNum(usage.cache_read_input_tokens)

    // 🔴 종료 사유가 없으면 성공으로 세지 않는다.
    //    "잘렸는지 알 수 없는 응답" 을 통과시킨 것이 1차 실행의 진단 공백이었다.
    //    토큰은 이미 청구됐으므로 수치는 그대로 실어 보낸다 — cap 계상이 어긋나면 안 된다.
    if (finishReason.trim() === '') {
      return failure('NO_FINISH_REASON', 'provider 응답에 종료 사유가 없다 — 잘림 여부를 판정할 수 없다', {
        inputTokens, outputTokens, reasoningTokens,
        responseChars: text.length, maxTokensReached,
        // 🔴 종료 사유가 없어도 **토큰은 이미 청구됐다.** 사용량을 그대로 실어 보낸다 —
        //    정산에서 빠지면 장부가 실제보다 적게 남는다
        usageKnown, cacheWriteTokens, cacheReadTokens, usageKeys, usageNumbers,
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
      usageKnown, cacheWriteTokens, cacheReadTokens, usageKeys, usageNumbers,
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

/**
 * 🔴 **공식 사전 토큰 계산** — `POST /v1/messages/count_tokens` (2026-09-17).
 *
 * 🔴 **이 호출은 무료다.** 공식 문서가 "free to use" 라고 적는다.
 *    그래도 장부는 이것을 **따로 센다** — 유료 요청 수와 섞이면 회차 상한이 왜곡된다.
 *
 * 🔴 **결과는 추정이다.** 공식 문서 원문:
 *      "The token count is an estimate. In some cases, the actual number of input
 *       tokens used when creating a message might differ by a small amount."
 *    그리고 "You are not billed for system-added tokens" 이다.
 *    그래서 이 값을 **검증된 입력 상한**이라고 부르지 않는다. 예약의 근거일 뿐이다.
 *
 * 🔴 **실제 요청과 같은 것을 센다.** 모델 · system · messages · prefill 이 같아야 한다.
 *    `max_tokens` 만 빠진다 — 그 칸은 입력 토큰 수에 영향을 주지 않고,
 *    count_tokens 는 받지도 않는다.
 *    🔴 이 동일성을 말로 주장하지 않는다. fixture 가 두 조립부를 대조한다.
 *
 * 🔴 **Anthropic 전용이다.** 다른 provider 에는 같은 계약의 무료 사전 계산이 없다 —
 *    모르면 `null` 을 돌려주고, 장부 게이트가 그 요청을 보류한다. 추측하지 않는다.
 */
export type CountTokensRequest = {
  model: ProviderModel
  systemPrompt: string
  userPayload: string
  timeoutMs: number
}

export type CountTokensResult = {
  ok: boolean
  /** 🔴 공식 계산값. 추정이다. 못 받았으면 null */
  inputTokens: number | null
  errorCode: string | null
  /** 🔴 사유 요약만. 응답 본문을 담지 않는다 */
  errorMessage: string | null
}

/**
 * 🔴 **Gemini `usageMetadata` 해석 — 순수 함수.** 네트워크 없이 검사할 수 있어야 한다.
 *
 *    공식 계약 (2026-09-19 확인 · https://ai.google.dev/api/generate-content):
 *      · `promptTokenCount`        입력
 *      · `candidatesTokenCount`    보이는 출력
 *      · `thoughtsTokenCount`      thinking — 🔴 **출력 과금에 포함된다**
 *      · `totalTokenCount`         prompt + thoughts + candidates
 *      · `cachedContentTokenCount` 캐시된 프롬프트 (우리는 요청하지 않는다)
 */
export type GeminiUsageRead = {
  inputTokens: number
  /** 🔴 과금 기준 출력 = candidates + thoughts */
  outputTokens: number
  thoughtsTokens: number | null
  /**
   * 🔴 thinking 토큰을 어디서 얻었나 — `reported` 칸이 있었다 · `derived` 칸이 없어 `total − prompt − candidates` 로 계산 ·
   *    `null` 얻지 못했다(미상)
   */
  thoughtsSource: 'reported' | 'derived' | null
  usageKnown: boolean
  cacheWriteTokens: number | null
  cacheReadTokens: number | null
  usageKeys: string[]
}

export function readGeminiUsage(g: Record<string, unknown>): GeminiUsageRead {
  const isNum = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v)
  const n = (v: unknown): number => (isNum(v) ? (v as number) : 0)
  /**
   * 🔴 **thinking 토큰 — 보고된 칸이 먼저, 없으면 공식 합계 관계로 결정적으로 계산한다** (2026-10-09 P0).
   *    `thoughtsTokenCount: 0` 은 "안 썼다" 로 통과한다. 칸이 **없을 때**는 공식 계약
   *    `totalTokenCount = prompt + thoughts + candidates` 로 `thoughts = total − prompt − candidates` 다 —
   *    prompt · candidates · total 이 모두 유한한 숫자이고 차이가 0 이상일 때만. total 이 없거나 모순(음수)이면 미상이다.
   *    🔴 싸게 추정하지 않는다 — 차이에 다른 과금 항목이 섞여 있어도 출력 단가(더 비싼 쪽)로 세므로 과소 계상이 없다.
   *    (2026-10-08 운영 실측: 칸이 빠진 응답 2건이 미정산으로 남아 D10 공급 비용 판정을 막았다)
   */
  const baseKnown = isNum(g.promptTokenCount) && isNum(g.candidatesTokenCount)
  let thoughts: number | null = null
  let thoughtsSource: GeminiUsageRead['thoughtsSource'] = null
  if (isNum(g.thoughtsTokenCount)) { thoughts = n(g.thoughtsTokenCount); thoughtsSource = 'reported' }
  else if (baseKnown && isNum(g.totalTokenCount)) {
    const d = n(g.totalTokenCount) - n(g.promptTokenCount) - n(g.candidatesTokenCount)
    if (d >= 0) { thoughts = d; thoughtsSource = 'derived' }
  }
  const usageKnown = baseKnown && thoughts !== null
  return {
    inputTokens: n(g.promptTokenCount),
    outputTokens: n(g.candidatesTokenCount) + (thoughts ?? 0),
    thoughtsTokens: thoughts,
    thoughtsSource,
    usageKnown,
    // 🔴 우리는 `cachedContent` 를 보내지 않는다 — 쓰기는 일어날 수 없다
    cacheWriteTokens: usageKnown ? 0 : null,
    // 🔴 그래도 나타나면 0 으로 뭉개지 않고 읽는다
    cacheReadTokens: usageKnown ? n(g.cachedContentTokenCount) : null,
    usageKeys: Object.keys(g),
  }
}

/**
 * 🔴 **사전 계산 요청 본문 — `generateContent` 와 같은 입력을 센다.** 순수 함수다.
 *    `contents` 와 `generateContentRequest` 는 상호 배타이고, systemInstruction 을
 *    함께 세려면 후자를 써야 한다 (2026-09-19 확인 · https://ai.google.dev/api/tokens).
 */
export function geminiCountBody(
  systemPrompt: string, userPayload: string, apiModelId: string,
): string {
  return JSON.stringify({
    generateContentRequest: {
      model: `models/${apiModelId}`,
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPayload }] }],
    },
  })
}

export const COUNT_TOKENS_URL = 'https://api.anthropic.com/v1/messages/count_tokens'
/**
 * 🔴 **Gemini 공식 사전 계산** (2026-09-19 확인 · https://ai.google.dev/api/tokens).
 *    `POST .../v1beta/{model=models/*}:countTokens` · 응답은 `totalTokens`.
 *    `contents` 와 `generateContentRequest` 는 **상호 배타**라서,
 *    systemInstruction 을 함께 세려면 `generateContentRequest` 쪽을 쓴다.
 */
export const GEMINI_COUNT_TOKENS_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/{model}:countTokens'

/**
 * 🔴 **Gemini 사전 계산 어댑터** — 실제 `generateContent` 와 **같은 입력**을 센다.
 *    같은 `apiModelId` · 같은 `systemInstruction` · 같은 `contents`.
 *    🔴 원문·프롬프트·키를 로그나 장부에 남기지 않는다. 실패하면 추정치로 대체하지 않는다.
 */
async function countGeminiTokens(req: CountTokensRequest): Promise<CountTokensResult> {
  const status = keyStatus(req.model)
  if (!status.present) {
    return { ok: false, inputTokens: null, errorCode: 'NO_API_KEY', errorMessage: `${status.envName} 가 없다` }
  }
  const apiModelId = apiModelIdFor(req.model)
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, req.timeoutMs)
  try {
    const res = await fetch(GEMINI_COUNT_TOKENS_URL.replace('{model}', apiModelId), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // 🔴 키는 헤더로 보낸다 — URL 에 넣으면 로그·오류 메시지에 남을 수 있다
        'x-goog-api-key': process.env[status.envName] ?? '',
      },
      // 🔴 `generateContent` 가 보내는 것과 **같은 모양**이어야 같은 입력을 센다.
      //    `generationConfig` 는 입력 토큰 수에 영향이 없어 넣지 않는다.
      body: geminiCountBody(req.systemPrompt, req.userPayload, apiModelId),
      signal: controller.signal,
    })
    if (!res.ok) {
      return {
        ok: false, inputTokens: null, errorCode: `HTTP_${res.status}`,
        errorMessage: `사전 계산이 ${res.status} 로 응답했다`,
      }
    }
    const json = (await res.json()) as Record<string, unknown>
    const n = json.totalTokens
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
      // 🔴 모양이 다르거나 비정상이면 **추측하지 않는다.** 모른다고 끝낸다
      return {
        ok: false, inputTokens: null, errorCode: 'COUNT_SHAPE',
        errorMessage: '사전 계산 응답에 정상적인 totalTokens 가 없다',
      }
    }
    return { ok: true, inputTokens: n, errorCode: null, errorMessage: null }
  } catch (e: unknown) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return {
      ok: false, inputTokens: null,
      errorCode: aborted ? 'TIMEOUT' : 'NETWORK',
      errorMessage: aborted ? `${req.timeoutMs}ms 안에 응답이 없었다` : '네트워크 오류',
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 🔴 **공식 사전 계산.** 제공사마다 경로가 다르다 — 없는 제공사는 통과시키지 않는다.
 *    (2026-09-19: Anthropic 과 Google 두 곳에 공식 경로가 있다.
 *     앞판 주석의 *"다른 provider 에는 공식 사전 계산 경로가 없다"* 는 틀린 말이었다.)
 */
export async function countInputTokens(req: CountTokensRequest): Promise<CountTokensResult> {
  if (req.model.startsWith('gemini-')) return countGeminiTokens(req)
  if (req.model !== 'claude-haiku-4.5') {
    return {
      ok: false, inputTokens: null, errorCode: 'COUNT_UNSUPPORTED',
      errorMessage: `${req.model} 에는 우리가 구현한 공식 사전 계산 경로가 없다`,
    }
  }
  const status = keyStatus(req.model)
  if (!status.present) {
    return { ok: false, inputTokens: null, errorCode: 'NO_API_KEY', errorMessage: `${status.envName} 가 없다` }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, req.timeoutMs)
  try {
    const res = await fetch(COUNT_TOKENS_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env[status.envName] ?? '',
        'anthropic-version': '2023-06-01',
      },
      // 🔴 실제 요청과 **같은 모델 · system · messages · prefill**.
      //    `max_tokens` 만 없다 — count_tokens 가 받지 않는 칸이다
      body: JSON.stringify({
        model: apiModelIdFor(req.model),
        system: req.systemPrompt,
        messages: [
          { role: 'user', content: req.userPayload },
          { role: 'assistant', content: ANTHROPIC_JSON_PREFILL },
        ],
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      return {
        ok: false, inputTokens: null, errorCode: `HTTP_${res.status}`,
        errorMessage: `사전 계산이 ${res.status} 로 응답했다`,
      }
    }
    const json = (await res.json()) as Record<string, unknown>
    const n = json.input_tokens
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
      // 🔴 모양이 다르면 **추측하지 않는다.** 모른다고 끝낸다
      return {
        ok: false, inputTokens: null, errorCode: 'COUNT_SHAPE',
        errorMessage: '사전 계산 응답에 input_tokens 숫자가 없다',
      }
    }
    return { ok: true, inputTokens: n, errorCode: null, errorMessage: null }
  } catch (e: unknown) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return {
      ok: false, inputTokens: null,
      errorCode: aborted ? 'TIMEOUT' : 'NETWORK',
      errorMessage: aborted ? `${req.timeoutMs}ms 안에 응답이 없었다` : '네트워크 오류',
    }
  } finally {
    clearTimeout(timer)
  }
}
