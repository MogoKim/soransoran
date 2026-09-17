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
 */
import { appendFileSync } from 'node:fs'

const LOG = process.env.FAKE_PROVIDER_LOG ?? ''

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

globalThis.fetch = async (url) => {
  if (LOG !== '') appendFileSync(LOG, `${String(url)}\n`)
  return new Response(JSON.stringify({
    content: [{ text: TEXT }],
    usage: { input_tokens: 11, output_tokens: 22 },
    stop_reason: 'end_turn',
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}
