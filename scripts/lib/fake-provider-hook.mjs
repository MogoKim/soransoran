/**
 * 🔴 **fixture 전용 가짜 provider** — `NODE_OPTIONS=--import` 로만 들어간다.
 *
 * 🔴 **왜 필요한가** (2026-09-17).
 *    앞선 판의 fixture 는 API 키를 지우고 *"키 오류가 났는가"* 로 유료 경로 도달을 쟀다.
 *    그것은 **도달하지 않았다**는 것만 증명하고, **정상 생성 경로가 제대로 도는지**는
 *    증명하지 못한다. 그래서 `fetch` 를 가로채 **호출 수를 정확히 센다.**
 *
 * 🔴 **네트워크에 나가지 않는다.** 운영 코드는 한 줄도 바뀌지 않는다 —
 *    이 파일은 운영 경로에서 import 되지 않고, 테스트가 `--import` 로만 끼운다.
 *
 * 🔴 **한 응답이 Content Core v2 세 파서를 모두 만족한다** (2026-09-20).
 *    `parseSpeakerPlan` 은 `decision`·`personaCode`·`stance`·`selfBasis`,
 *    `parseDraft` 는 `title`·`body`,
 *    `parseSemanticReview` 는 `confidence`·`issues` 를 본다 — 키가 겹치지 않아 한 객체다.
 *
 * 🔴 **제공사가 둘이다.** Anthropic(`/messages`)과 Google(`:generateContent`)은
 *    응답 모양도 usage 칸 이름도 다르다. 같은 내용을 **각 제공사 모양으로** 돌려준다.
 *
 * 🔴 Anthropic 은 assistant prefill `{` 를 쓰므로 **여는 중괄호 없이** 이어 쓴 모양을 돌려준다.
 *
 * 🔴 **사전 계산(`/count_tokens`)과 유료 생성(`/messages`)을 갈라 기록한다** (2026-09-17).
 *    둘을 한 줄로 세면 "무료 호출이 늘었나 유료 호출이 늘었나" 를 구분할 수 없다.
 *    로그 한 줄은 `count<TAB>url` 또는 `paid<TAB>url` 이다.
 */
import { appendFileSync } from 'node:fs'

const LOG = process.env.FAKE_PROVIDER_LOG ?? ''

/**
 * 🔴 시험 모드 — **가짜 provider 안에서만 뜻이 있다.** 운영 env 가 아니다.
 *
 *    ok            정상 — 사용량을 준다
 *    no-usage      🔴 응답은 오는데 `usage` 가 없다 (정산 불가 경로)
 *    timeout       🔴 응답이 오지 않는다
 *    count-fail    🔴 사전 계산만 실패한다 (계산 없이 유료 요청이 나가는지 본다)
 *    over-reserve  🔴 실제 사용량이 예약액을 크게 넘는다 (불일치 뒤 보류를 본다)
 */

/**
 * 🔴 **정산 줄 기록 실패를 심는다** (2026-09-20). `FAKE_LEDGER_SETTLE_FAIL` 에
 *    단계 이름(`draftQuality` 등)을 주면 그 단계의 **정산 줄만** 못 적게 한다.
 *    예약 줄은 정상으로 적힌다 — 그래야 "요청은 나갔는데 정산이 안 적힌" 상태가 된다.
 *
 * 🔴 **시험 전용 이음매다.** 운영 경로는 이 파일을 import 하지 않고,
 *    `REAL_LEDGER_IO.append` 를 여기서만 감싼다. 운영 코드는 한 줄도 바뀌지 않는다.
 */
const SETTLE_FAIL_STAGE = process.env.FAKE_LEDGER_SETTLE_FAIL ?? ''
let settleFailArmed = false
/**
 * 🔴 **첫 요청 때 건다.** 이 훅은 `--import` 로 tsx 로더보다 **먼저** 돌아서
 *    그 시점에는 `.mts` 를 아직 해결하지 못한다. 첫 provider 요청이 나갈 무렵이면
 *    러너가 이미 그 모듈을 읽었고 로더도 서 있다 — 3번째 단계의 정산보다 충분히 앞이다.
 */
async function armSettleFail() {
  if (SETTLE_FAIL_STAGE === '' || settleFailArmed) return
  settleFailArmed = true
  const mod = await import('./supply-llm-call.mjs')
  const real = mod.REAL_LEDGER_IO.append
  mod.REAL_LEDGER_IO.append = (path, entry) => {
    // 🔴 정산 줄만 막는다 — 예약 줄(`reserved`)은 그대로 적힌다
    if (entry.stage === SETTLE_FAIL_STAGE && entry.status !== 'reserved' && entry.endedAt !== null) {
      throw new Error('fixture: 정산 줄을 적지 못했다')
    }
    real(path, entry)
  }
}
const MODE = process.env.FAKE_PROVIDER_MODE ?? 'ok'
/** 🔴 사전 계산이 돌려줄 입력 토큰 수 — 예약액을 시험에서 조절하는 손잡이 */
const COUNT_TOKENS = Number(process.env.FAKE_PROVIDER_COUNT_TOKENS ?? '100')
/** 🔴 응답이 신고할 출력 토큰 수 */
const OUT_TOKENS = Number(process.env.FAKE_PROVIDER_OUTPUT_TOKENS ?? '22')

/** 🔴 fixture 가 고르게 할 Persona — 없으면 계획이 unknownPersona 로 막힌다 */
const PERSONA = process.env.FAKE_PROVIDER_PERSONA ?? 'P01'

const PAYLOAD = {
  // ── speakerPlan ──
  decision: 'ok',
  personaCode: PERSONA,
  stance: 'SELF_EXPERIENCE',
  // 🔴 자격 근거가 필요 없는 보편 글로 선언한다 — 합성 원문에 생활사 요구가 없다
  selfBasis: 'noLifeFactNeeded',
  universalReason: 'fixture 합성 원문 — 특정 생활사 자격이 필요 없다',
  speakerWarrants: [],
  protectedFacts: [],
  closingIntent: 'share',
  contentRoles: ['conversationSpark'],
  // ── draftGen ──
  /**
   * 🔴 **합성 원문과 겹치지 않는 낱말로만 채운다.** 짧은 초안은 조금만 겹쳐도
   *    덮인 비율이 올라가 `copiedFromSource` 로 막힌다 — 그러면 fixture 가
   *    배선이 아니라 제 문장을 시험하게 된다.
   */
  title: '오늘 있었던 작은 일',
  body: '아침에 창문을 열어 두었더니 바람이 제법 선선하더라고요.\n'
    + '다들 어떻게 지내시는지 궁금해서 한 줄 남겨 봅니다.',
  // ── semanticReview ──
  confidence: 0.9,
  issues: [],
  droppedFromSource: [],
  unsupportedAdditions: [],
  lifeContradictions: [],
  note: '',
}

/**
 * 🔴 **판정 요청은 응답 모양이 다르다** (2026-09-20).
 *
 *    의미 판정기는 `decision`(AUTO_*) 과 `confidence` 를 기다린다. 위 payload 의
 *    `decision: 'ok'` 는 화자 계획의 값이라 판정기가 읽으면 `parseError` 가 된다 —
 *    그러면 어떤 검사도 **판정이 끝난 상태**를 만들어 보지 못한다.
 *
 * 🔴 **보낸 프롬프트로 가른다.** 판정 지시문에만 들어 있는 선택지 열거를 본다 —
 *    검사가 지어낸 표시가 아니라 실제로 나간 요청의 내용이다.
 */
const JUDGE_MARK = 'AUTO_SEED|AUTO_RAW|AUTO_HOLD|AUTO_DROP'
const JUDGE_PAYLOAD = {
  decision: process.env.FAKE_PROVIDER_JUDGE_DECISION ?? 'AUTO_HOLD',
  confidence: 0.8,
  risks: [],
  communityAngle: '우리 또래가 겪는 이야기',
}

// 🔴 prefill 뒤를 이어 쓰는 모양 — 여는 `{` 를 뺀다 (Anthropic 전용)
/**
 * 🔴 **제안받은 후보 중에서 고른다** (2026-09-22).
 *
 *    앞판은 언제나 `P01` 을 돌려줬다. 그런데 생성 계획은 원천마다
 *    **서로 다른 후보 묶음**을 제안한다(화자 여력 계획) — 제안에 없는 이름을
 *    돌려주는 provider 는 현실에 없고, 그런 가짜는 **실제보다 강하다.**
 *    요청 본문의 `후보` 목록을 읽어 그 안에서 고른다. 못 읽으면 기본값이다.
 */
const pickOffered = (body) => {
  try {
    const parsed = JSON.parse(String(body ?? '{}'))
    const raw = JSON.stringify(parsed)
    const codes = [...raw.matchAll(/\b(P\d{2})\b/g)].map((m) => m[1])
    if (codes.length === 0) return PERSONA
    return codes.includes(PERSONA) ? PERSONA : codes[0]
  } catch { return PERSONA }
}
const payloadFor = (body) => ({ ...PAYLOAD, personaCode: pickOffered(body) })

const TEXT = JSON.stringify(PAYLOAD).slice(1)
/** 🔴 Gemini 는 prefill 이 없다 — 완전한 JSON 을 돌려준다 */
const GEMINI_TEXT = JSON.stringify(PAYLOAD)
const JUDGE_TEXT = JSON.stringify(JUDGE_PAYLOAD).slice(1)
const JUDGE_GEMINI_TEXT = JSON.stringify(JUDGE_PAYLOAD)

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
})

/**
 * 🔴 **보낸 요청 본문을 따로 남긴다** (2026-09-17 추가).
 *    "무엇이 실려 나갔는가" 를 검사가 값으로 볼 수 있어야 한다 —
 *    프롬프트·payload 배선은 주석이나 정규식이 아니라 **나간 요청**이 증거다.
 *    🔴 시험 전용이다. 운영 경로는 이 파일을 import 하지 않는다.
 */
const BODY_LOG = process.env.FAKE_PROVIDER_BODY_LOG ?? ''

globalThis.fetch = async (url, init) => {
  await armSettleFail()
  const u = String(url)
  // 🔴 제공사마다 사전 계산 경로 이름이 다르다 — 둘 다 무료다
  const isCount = u.includes('/count_tokens') || u.includes(':countTokens')
  const isGemini = u.includes('generativelanguage.googleapis.com')
  const isJudge = String(init?.body ?? '').includes(JUDGE_MARK)
  // 🔴 계획 요청이면 **제안받은 후보 중에서** 고른 응답을 만든다
  const planText = JSON.stringify(payloadFor(init?.body))
  const text = isJudge ? JUDGE_TEXT : planText.slice(1)
  const geminiText = isJudge ? JUDGE_GEMINI_TEXT : planText
  if (LOG !== '') appendFileSync(LOG, `${isCount ? 'count' : 'paid'}\t${u}\n`)
  if (BODY_LOG !== '' && !isCount) {
    // 🔴 한 줄 JSON 으로 남긴다 — 검사가 줄 단위로 읽는다. url 을 함께 적어
    //    어느 제공사로 갔는지 값으로 확인된다
    appendFileSync(BODY_LOG, `${JSON.stringify({ url: u, body: String(init?.body ?? '{}') })}\n`)
  }

  if (isCount) {
    if (MODE === 'count-fail') return json({ error: 'fixture' }, 500)
    // 🔴 Gemini 는 `totalTokens`, Anthropic 은 `input_tokens`
    return isGemini ? json({ totalTokens: COUNT_TOKENS }) : json({ input_tokens: COUNT_TOKENS })
  }

  if (MODE === 'timeout') {
    // 🔴 실제로 기다리지 않는다 — provider 가 abort 를 보는 것과 같은 예외를 던진다
    const e = new Error('fixture timeout')
    e.name = 'AbortError'
    throw e
  }
  if (MODE === 'no-usage') {
    // 🔴 `usage` 자체가 없다. "0 토큰" 이 아니라 **모름**이어야 한다
    return isGemini
      ? json({ candidates: [{ content: { parts: [{ text: geminiText }] }, finishReason: 'STOP' }] })
      : json({ content: [{ text }], stop_reason: 'end_turn' })
  }
  const outTokens = MODE === 'over-reserve' ? OUT_TOKENS * 1000 : OUT_TOKENS
  if (isGemini) {
    /**
     * 🔴 **thinking 토큰을 함께 신고한다** — 없으면 `usageKnown=false` 여야 한다.
     *    `no-thoughts` 모드가 그 경로를 시험한다.
     */
    const usage = { promptTokenCount: 11, candidatesTokenCount: outTokens, totalTokenCount: 11 + outTokens }
    if (MODE !== 'no-thoughts') usage.thoughtsTokenCount = Number(process.env.FAKE_PROVIDER_THOUGHTS ?? '7')
    return json({
      candidates: [{ content: { parts: [{ text: geminiText }] }, finishReason: 'STOP' }],
      usageMetadata: usage,
    })
  }
  return json({
    content: [{ text }],
    usage: { input_tokens: 11, output_tokens: outTokens },
    stop_reason: 'end_turn',
  })
}
