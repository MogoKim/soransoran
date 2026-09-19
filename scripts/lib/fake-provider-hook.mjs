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
 * 🔴 한 응답이 생성·품질·나이 세 파서를 **모두** 만족한다.
 *    `parseGen` 은 `drafts`, `parseQuality` 는 `decision`·`issues`·`harms`·`lifeConflict`,
 *    `parseAgeCheck` 는 `conflict` 를 본다 — 키가 겹치지 않아 한 객체에 담긴다.
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
const MODE = process.env.FAKE_PROVIDER_MODE ?? 'ok'
/** 🔴 사전 계산이 돌려줄 입력 토큰 수 — 예약액을 시험에서 조절하는 손잡이 */
const COUNT_TOKENS = Number(process.env.FAKE_PROVIDER_COUNT_TOKENS ?? '100')
/** 🔴 응답이 신고할 출력 토큰 수 */
const OUT_TOKENS = Number(process.env.FAKE_PROVIDER_OUTPUT_TOKENS ?? '22')

/**
 * 🔴 **원천별로 다른 글을 돌려주는 모드** (2026-09-19 추가 · 기본 꺼짐).
 *
 *    끄면 앞판과 **똑같은 고정 응답**이다 — 기존 fixture 는 한 줄도 달라지지 않는다.
 *    켜면 요청 payload 의 `sourceTitle` 에서 짧은 표식을 만들어 글에 심는다.
 *    🔴 왜 필요한가: 모든 원천에 같은 글을 돌려주면 두 번째 원천부터
 *       `duplicateTitle` 로 떨어져 **시험이 우연히 짧아진다.** 그러면 "원천마다
 *       검수가 도는가" 를 재려던 검사가 아무것도 재지 못한다.
 *    🔴 표식은 원문 낱말을 쓰지 않는다 — 베낌 판정에 걸리면 그 또한 시험이 짧아진다.
 */
const VARY_BY_SOURCE = process.env.FAKE_PROVIDER_VARY_BY_SOURCE === '1'
/**
 * 🔴 **어느 단계만 깨뜨릴지** (기본 꺼짐) — `gen` · `quality` · `age`.
 *    회차 전체를 망가뜨리면 "앞 원천의 재시도가 뒤 원천 기회를 빼앗는가" 를 잴 수 없다.
 *    🔴 단계는 **요청의 모양**으로 가른다 — 프롬프트 문구를 여기 적지 않는다.
 *       생성만 `sourceBodyHead` 를 싣고, 나이 검수만 짧은 출력 상한을 쓴다.
 */
const BAD_JSON_STAGE = process.env.FAKE_PROVIDER_BAD_JSON_STAGE ?? ''
/** 🔴 함께 주면 **요청 본문에 이 문구가 있을 때만** 깨뜨린다 (원천 하나만 고르는 손잡이) */
const BAD_JSON_FOR = process.env.FAKE_PROVIDER_BAD_JSON_FOR ?? ''
/** 🔴 나이 검수의 출력 상한 — 정본(`AGE_CHECK_MAX_TOKENS`)과 같은 값이다 */
const AGE_MAX_TOKENS = 200

const stageOf = (init, payload) => {
  if (payload !== null && typeof payload === 'object' && 'sourceBodyHead' in payload) return 'gen'
  try {
    const b = JSON.parse(String(init?.body ?? '{}'))
    if (Number(b.max_tokens) === AGE_MAX_TOKENS) return 'age'
  } catch { /* 모양을 못 읽으면 품질로 둔다 */ }
  return 'quality'
}
/** 🔴 품질 판정이 돌려줄 위해 축 (JSON 배열 문자열) */
const HARMS = (() => {
  try { return JSON.parse(process.env.FAKE_PROVIDER_HARMS ?? '[]') } catch { return [] }
})()
/** 🔴 품질 판정이 생활사 충돌을 말하게 한다 — 근거는 **그 글의 본문 앞부분**에서 딴다 */
const LIFE_CONFLICT = process.env.FAKE_PROVIDER_LIFE_CONFLICT === '1'

/** 🔴 안전한 표식 — 원문 낱말을 쓰지 않는다. 숫자 하나로 줄인다 */
const tagOf = (s) => {
  let h = 0
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 100000
  return String(h)
}

const draftsFor = (payload) => {
  if (!VARY_BY_SOURCE) {
    return [
      { title: '가짜 초안 하나', body: '이건 fixture 가 만든 본문입니다. 충분히 길게 적어 둡니다.', intendedQuestion: '', sourceAngle: '' },
      { title: '가짜 초안 둘', body: '두 번째 본문입니다. 서로 다른 말로 적어 둡니다.', intendedQuestion: '', sourceAngle: '' },
    ]
  }
  const t = tagOf(String(payload?.sourceTitle ?? ''))
  return [
    {
      title: `합성 ${t} 이야기 한 자락`,
      body: `합성 ${t} 자리에서 요즘 마음이 좀 복잡했습니다.`
        + ' 별것 아닌 일인데 자꾸 생각이 나서 여기 적어 봅니다. 다들 어떻게 지내시는지 궁금하네요.',
      intendedQuestion: '', sourceAngle: '',
    },
    {
      title: `합성 ${t} 이야기 둘째 자락`,
      body: `합성 ${t} 쪽은 또 다른 결이었습니다.`
        + ' 같은 자리에 서 있어도 날마다 다르게 느껴집니다. 그냥 털어놓고 싶어 적어 둡니다.',
      intendedQuestion: '', sourceAngle: '',
    },
  ]
}

const bodyOf = (payload) => {
  const life = LIFE_CONFLICT
    ? { conflict: true, evidence: String(payload?.body ?? '').trim().slice(0, 10) }
    : { conflict: false, evidence: '' }
  return {
    drafts: draftsFor(payload),
    decision: 'AUTO_ADOPT',
    confidence: 0.9,
    harms: HARMS,
    issues: [],
    lifeConflict: life,
    conflict: false,
    evidence: '',
  }
}

/** 요청 본문에서 user 메시지(= payload)를 꺼낸다 — 표식을 만들 재료다 */
const payloadOf = (init) => {
  try {
    const b = JSON.parse(String(init?.body ?? '{}'))
    const u = (b.messages ?? []).find((m) => m.role === 'user')
    return JSON.parse(String(u?.content ?? '{}'))
  } catch { return {} }
}

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
  const u = String(url)
  const isCount = u.includes('/count_tokens')
  if (LOG !== '') appendFileSync(LOG, `${isCount ? 'count' : 'paid'}\t${u}\n`)
  if (BODY_LOG !== '' && !isCount) {
    // 🔴 한 줄 JSON 으로 남긴다 — 검사가 줄 단위로 읽는다
    appendFileSync(BODY_LOG, `${String(init?.body ?? '{}')}\n`)
  }

  if (isCount) {
    if (MODE === 'count-fail') return json({ error: 'fixture' }, 500)
    return json({ input_tokens: COUNT_TOKENS })
  }

  if (MODE === 'timeout') {
    // 🔴 실제로 기다리지 않는다 — provider 가 abort 를 보는 것과 같은 예외를 던진다
    const e = new Error('fixture timeout')
    e.name = 'AbortError'
    throw e
  }
  if (MODE === 'no-usage') {
    // 🔴 `usage` 자체가 없다. "0 토큰" 이 아니라 **모름**이어야 한다
    return json({ content: [{ text: JSON.stringify(bodyOf(payloadOf(init))).slice(1) }], stop_reason: 'end_turn' })
  }
  const outTokens = MODE === 'over-reserve' ? OUT_TOKENS * 1000 : OUT_TOKENS
  const payload = payloadOf(init)
  /**
   * 🔴 **그 원천에만** 깨진 답을 준다 (기본 꺼짐).
   *    회차 전체를 망가뜨리면 "앞 원천의 재시도가 뒤 원천 기회를 빼앗는가" 를 잴 수 없다.
   */
  const bad = BAD_JSON_STAGE !== '' && stageOf(init, payload) === BAD_JSON_STAGE
    && (BAD_JSON_FOR === '' || String(init?.body ?? '').includes(BAD_JSON_FOR))
  if (bad) {
    return json({
      content: [{ text: '이건 JSON 이 아닙니다. fixture 가 일부러 깨뜨린 답입니다.' }],
      usage: { input_tokens: 11, output_tokens: outTokens },
      stop_reason: 'end_turn',
    })
  }
  // 🔴 prefill 뒤를 이어 쓰는 모양 — 여는 `{` 를 뺀다
  return json({
    content: [{ text: JSON.stringify(bodyOf(payload)).slice(1) }],
    usage: { input_tokens: 11, output_tokens: outTokens },
    stop_reason: 'end_turn',
  })
}
