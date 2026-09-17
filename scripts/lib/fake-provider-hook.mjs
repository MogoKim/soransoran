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

const PAYLOAD = {
  drafts: [
    { title: '가짜 초안 하나', body: '이건 fixture 가 만든 본문입니다. 충분히 길게 적어 둡니다.', intendedQuestion: '', sourceAngle: '' },
    { title: '가짜 초안 둘', body: '두 번째 본문입니다. 서로 다른 말로 적어 둡니다.', intendedQuestion: '', sourceAngle: '' },
  ],
  decision: 'AUTO_ADOPT',
  confidence: 0.9,
  harms: [],
  issues: [],
  lifeConflict: { conflict: false, evidence: '' },
  conflict: false,
  evidence: '',
}

// 🔴 prefill 뒤를 이어 쓰는 모양 — 여는 `{` 를 뺀다
const TEXT = JSON.stringify(PAYLOAD).slice(1)

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
})

globalThis.fetch = async (url) => {
  const u = String(url)
  const isCount = u.includes('/count_tokens')
  if (LOG !== '') appendFileSync(LOG, `${isCount ? 'count' : 'paid'}\t${u}\n`)

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
    return json({ content: [{ text: TEXT }], stop_reason: 'end_turn' })
  }
  const outTokens = MODE === 'over-reserve' ? OUT_TOKENS * 1000 : OUT_TOKENS
  return json({
    content: [{ text: TEXT }],
    usage: { input_tokens: 11, output_tokens: outTokens },
    stop_reason: 'end_turn',
  })
}
