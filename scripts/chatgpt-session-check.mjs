#!/usr/bin/env node
/**
 * ChatGPT 세션 판정 회귀 — 🔴 **브라우저도 네트워크도 부르지 않는다.**
 *
 * ─────────────────────────────────────────────────────────
 * 🔴 **왜 생겼나** (2026-09-16 실측).
 *
 *    `connectOverCDP` 제한이 15초였다. 탭이 여러 개 열린 실제 창에 붙는 데
 *    **45,418ms** 가 걸렸고, 15초에서 끊긴 그 실패가 `chrome_not_running` 으로
 *    분류됐다 — **살아 있는 Chrome 을 죽은 것으로 보고**해 원고 회수가 통째로 막혔다.
 *
 *    같은 계열의 오분류를 2026-08-27 에 이미 한 번 겪었다. 그때는 `connect` 를
 *    부분 문자열로 잡아서였고, 이번엔 `timeout … exceeded` 를 통째로 보내서였다.
 *    **문구를 고치는 것으로는 다시 막지 못한다** — 판정에 "CDP 가 살아 있는가" 를 넣는다.
 *
 * 🔴 **45초를 실제로 기다리는 테스트는 만들지 않는다.**
 *    connector 와 clock 을 주입해 느린 연결·제한 시간 초과를 즉시 재현한다.
 *
 * 🔴 로그인·쿠키·URL·본문·토큰을 출력하지 않는다. 상태 코드와 불리언만 본다.
 *
 * 사용법: npm run chatgpt:session-check
 */
import {
  CDP_CONNECT_TIMEOUT_MS, MESSAGE, SEVERITY, STATUS,
  classifyConnectError, connectCdp,
} from './lib/chatgpt-session.mjs'

let pass = 0
let fail = 0
function expect(label, actual, want) {
  const ok = JSON.stringify(actual) === JSON.stringify(want)
  console.log(`  ${ok ? '✅' : '🔴'} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)} want ${JSON.stringify(want)}`}`)
  ok ? (pass += 1) : (fail += 1)
}

const timeoutErr = (ms = 15000) => new Error(`browserType.connectOverCDP: Timeout ${ms}ms exceeded.`)
const refusedErr = () => new Error('browserType.connectOverCDP: connect ECONNREFUSED 127.0.0.1:9333')

console.log('\n══════ 제한 시간 — 운영 현실에 맞는가')
// 🔴 실측 45,418ms. 그보다 넉넉해야 한다
expect('연결 제한이 90초 이상이다', CDP_CONNECT_TIMEOUT_MS >= 90_000, true)
expect('실측 45,418ms 보다 넉넉하다', CDP_CONNECT_TIMEOUT_MS > 45_418, true)

console.log('\n══════ 오분류 차단 — CDP 가 살아 있는데 timeout')
/**
 * 🔴 이것이 이번 장애의 심장이다.
 *    HTTP 엔드포인트가 200 인데 연결만 늦은 것은 "Chrome 이 없다" 가 아니다.
 */
expect(
  '🔴 CDP 살아 있음 + timeout → cdp_connect_timeout',
  classifyConnectError(timeoutErr(), { cdpAlive: true }),
  STATUS.CDP_CONNECT_TIMEOUT,
)
expect(
  '🔴 살아 있는 Chrome 을 chrome_not_running 으로 보내지 않는다',
  classifyConnectError(timeoutErr(), { cdpAlive: true }) === STATUS.CHROME_NOT_RUNNING,
  false,
)
expect(
  'CDP 없음 + timeout → chrome_not_running (기존 유지)',
  classifyConnectError(timeoutErr(), { cdpAlive: false }),
  STATUS.CHROME_NOT_RUNNING,
)
expect(
  'cdpAlive 를 안 주면 보수적으로 chrome_not_running',
  classifyConnectError(timeoutErr()),
  STATUS.CHROME_NOT_RUNNING,
)
// 문구가 달라도 같은 판정이어야 한다 — 문자열 하나에 기대지 않는다
for (const m of ['Timeout 15000ms exceeded.', 'timeout 90000ms exceeded', 'connection timed out']) {
  expect(`"${m.slice(0, 26)}…" 도 timeout 으로 본다`, classifyConnectError(new Error(m), { cdpAlive: true }), STATUS.CDP_CONNECT_TIMEOUT)
}

console.log('\n══════ 나머지 분류 — 기존 동작 유지')
expect('ECONNREFUSED → chrome_not_running', classifyConnectError(refusedErr(), { cdpAlive: false }), STATUS.CHROME_NOT_RUNNING)
expect('socket hang up → chrome_not_running', classifyConnectError(new Error('socket hang up'), { cdpAlive: false }), STATUS.CHROME_NOT_RUNNING)
expect('protocol error → protocol_error', classifyConnectError(new Error('Protocol error (Browser.setDownloadBehavior)'), { cdpAlive: true }), STATUS.PROTOCOL_ERROR)
expect('permission → permission_blocked', classifyConnectError(new Error('EACCES permission denied'), { cdpAlive: false }), STATUS.PERMISSION_BLOCKED)
expect('모르는 실패 → unknown', classifyConnectError(new Error('something else'), { cdpAlive: true }), STATUS.UNKNOWN)
// 🔴 2026-08-27 오분류의 화석 — 메서드 이름의 connect 에 걸리면 안 된다
expect(
  'connectOverCDP 라는 메서드 이름에 걸리지 않는다',
  classifyConnectError(new Error('browserType.connectOverCDP: Something unrelated'), { cdpAlive: true }),
  STATUS.UNKNOWN,
)

console.log('\n══════ connectCdp — 주입식 connector 로 동작을 본다')
/** 가짜 시계. 실제로 기다리지 않는다 */
function fakeClock(startMs = 0) {
  let t = startMs
  return { now: () => t, advance: (ms) => { t += ms } }
}

// ① CDP 살아 있음 + 느린 연결이지만 제한 안에 성공
{
  const clock = fakeClock(1000)
  const r = await connectCdp({
    connector: async ({ timeout }) => {
      // 🔴 실제로 45초를 기다리지 않는다 — 시계만 민다
      clock.advance(45_418)
      if (45_418 > timeout) throw timeoutErr(timeout)
      return { fake: 'browser' }
    },
    timeoutMs: CDP_CONNECT_TIMEOUT_MS,
    isCdpAlive: async () => true,
    now: clock.now,
  })
  expect('🔴 45,418ms 연결이 성공한다 (옛 15초 제한이면 실패했다)', r.ok, true)
  expect('연결 시간을 기록한다', r.elapsedMs, 45_418)
  expect('브라우저를 돌려준다', r.browser, { fake: 'browser' })
}

// ② 옛 제한(15초)이었다면 같은 연결이 실패했음을 보인다 — 회귀의 근거
{
  const clock = fakeClock(0)
  const r = await connectCdp({
    connector: async ({ timeout }) => {
      clock.advance(45_418)
      if (45_418 > timeout) throw timeoutErr(timeout)
      return { fake: 'browser' }
    },
    timeoutMs: 15_000, // 옛 값
    isCdpAlive: async () => true,
    now: clock.now,
  })
  expect('옛 15초 제한이면 같은 연결이 실패한다', r.ok, false)
  // 🔴 그래도 chrome_not_running 이 아니다 — 이것이 보정의 핵심
  expect('🔴 그래도 chrome_not_running 이 아니다', r.status, STATUS.CDP_CONNECT_TIMEOUT)
}

// ③ CDP 살아 있음 + 제한 초과 → 오분류하지 않는다
{
  const r = await connectCdp({
    connector: async ({ timeout }) => { throw timeoutErr(timeout) },
    timeoutMs: CDP_CONNECT_TIMEOUT_MS,
    isCdpAlive: async () => true,
    now: () => 0,
  })
  expect('CDP 살아 있는데 timeout → cdp_connect_timeout', r.status, STATUS.CDP_CONNECT_TIMEOUT)
  expect('ok=false 로 분명히 실패로 남긴다', r.ok, false)
}

// ④ 진짜 Chrome 없음 → 기존 chrome_not_running 유지
{
  const r = await connectCdp({
    connector: async () => { throw refusedErr() },
    timeoutMs: CDP_CONNECT_TIMEOUT_MS,
    isCdpAlive: async () => false,
    now: () => 0,
  })
  expect('CDP 없음 → chrome_not_running (기존 유지)', r.status, STATUS.CHROME_NOT_RUNNING)
}
{
  const r = await connectCdp({
    connector: async ({ timeout }) => { throw timeoutErr(timeout) },
    timeoutMs: CDP_CONNECT_TIMEOUT_MS,
    isCdpAlive: async () => false,
    now: () => 0,
  })
  expect('CDP 없음 + timeout → chrome_not_running', r.status, STATUS.CHROME_NOT_RUNNING)
}

// ⑤ 연결 중 Chrome 이 죽은 경우 — 실패 시점의 생존을 본다
{
  let alive = true
  const r = await connectCdp({
    connector: async ({ timeout }) => { alive = false; throw timeoutErr(timeout) },
    timeoutMs: CDP_CONNECT_TIMEOUT_MS,
    isCdpAlive: async () => alive,
    now: () => 0,
  })
  expect('연결 도중 죽었으면 chrome_not_running', r.status, STATUS.CHROME_NOT_RUNNING)
}

// ⑥ 제한 시간을 connector 에 그대로 넘긴다
{
  let seen = null
  await connectCdp({
    connector: async ({ timeout, url }) => { seen = { timeout, url }; return {} },
    timeoutMs: 123_456,
    isCdpAlive: async () => true,
    now: () => 0,
  })
  expect('connector 에 제한 시간을 넘긴다', seen.timeout, 123_456)
  expect('CDP 주소를 넘긴다', seen.url.startsWith('http://127.0.0.1:'), true)
}

console.log('\n══════ 새 상태의 운영 표기')
expect('심각도가 정의돼 있다', SEVERITY[STATUS.CDP_CONNECT_TIMEOUT], 'ERROR')
expect('사람이 읽을 문구가 있다', typeof MESSAGE[STATUS.CDP_CONNECT_TIMEOUT], 'string')
// 🔴 BLOCKED 로 두면 "사람이 로그인해야 한다" 로 읽힌다 — 로그인 문제가 아니다
expect('BLOCKED(로그인 대기)로 분류하지 않는다', SEVERITY[STATUS.CDP_CONNECT_TIMEOUT] === 'BLOCKED', false)
// 🔴 문구에 계정·URL·쿠키가 없어야 한다
expect('문구에 URL 이 없다', /https?:\/\//.test(MESSAGE[STATUS.CDP_CONNECT_TIMEOUT]), false)

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} PASS · ${fail} FAIL\n`)
process.exit(fail === 0 ? 0 : 1)
