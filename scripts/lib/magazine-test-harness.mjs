/**
 * 🔴 **CLI 시험이 브라우저·spawn 을 갈아끼우는 유일한 자리** (2026-09-28 · P0-2).
 *
 * ─────────────────────────────────────────────────────────
 * 🔴 **왜 생겼나.**
 *    `--login` 시험(㉚)은 실제 CLI 를 돌렸지만 브라우저 판정은 **실제 환경**을 읽었다.
 *      · Linux CI 에는 macOS Chrome 절대경로가 없다 → 표식을 만들기 전에
 *        `BROWSER_MISSING` 으로 끝나 로컬 초록 / CI 빨강이 된다.
 *      · 로컬에서 9344 가 비어 있으면 시험이 **실제 Chrome 을 띄운다.**
 *    시험이 환경을 읽으면 그건 코드 판정이 아니다.
 *
 * 🔴 **원칙**
 *    ① 주입은 `SORAN_MAGAZINE_TEST_MODE=1` 일 때만 받는다 (`magazine-load` 의 폴더 주입과 같은 규칙).
 *    ② 시험 모드에서는 **실제 Chrome 을 절대 띄우지 않는다.** fixture 가 주지 않은 자리는
 *       거부 stub 이 채운다 — 빠뜨린 자리가 조용히 운영 기본값으로 떨어지지 않는다.
 *    ③ 운영 모드에서 주입값이 보이면 **첫 read/write·브라우저 접근 전에** 멈춘다.
 *       무시하고 기본값으로 가지 않는다 — 누군가 설정한 값을 말없이 버리는 것도 사고다.
 *
 * 🔴 fixture 는 **파일 경로 하나**로 넘긴다. 그 모듈이 내보내는 값만 쓴다:
 *      browserAvailable · cdpAvailable · profileInUse · spawn · verifyProfileFn
 *      probe · connect · ensureTab · quarantinePath
 */
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

export const TEST_MODE_ENV = 'SORAN_MAGAZINE_TEST_MODE'
export const TEST_FIXTURE_ENV = 'SORAN_MAGAZINE_TEST_FIXTURE'

/** fixture 가 채울 수 있는 자리 — 이 밖의 이름은 받지 않는다 */
export const INJECTABLE = Object.freeze([
  'browserAvailable', 'cdpAvailable', 'profileInUse', 'spawn', 'verifyProfileFn',
  'probe', 'connect', 'ensureTab', 'quarantinePath', 'fetchTiming',
])

/**
 * 🔴 시험 모드의 응답 관찰 타이밍 기본값 — 가짜 브라우저가 "응답 없음" 일 때 5분을 기다리지 않게 한다.
 *    운영에는 들어가지 않는다 (운영 모드면 주입 자체를 거부한다).
 */
const TEST_FETCH_TIMING = Object.freeze({ pollMs: 5, stablePolls: 2, timeoutMs: 300 })

const refused = (name) => () => {
  throw new Error(`TEST_MODE_NOT_INJECTED — 시험 모드에서 ${name} 를 주입하지 않았다 (실제 브라우저를 쓰지 않는다)`)
}

/**
 * 🔴 **시험 모드의 기본값은 전부 "거부" 다.** 운영 함수로 떨어지지 않는다.
 *    browserAvailable 도 `false` 가 아니라 거부다 — `false` 로 두면 "Chrome 없음" 이라는
 *    그럴듯한 운영 결과가 나와서 fixture 를 빠뜨린 시험이 초록으로 보인다.
 */
const REFUSE = Object.freeze(Object.fromEntries(
  INJECTABLE.filter((k) => k !== 'quarantinePath' && k !== 'fetchTiming').map((k) => [k, refused(k)]),
))

/**
 * 주입을 받아도 되는가 — **파일을 읽지 않는다.**
 * @returns {{ok:true, test:boolean, fixturePath:string|null}|{ok:false, code:string, why:string}}
 */
export function resolveTestHarness(env = process.env) {
  const test = env[TEST_MODE_ENV] === '1'
  const fixture = env[TEST_FIXTURE_ENV]
  if (fixture && !test) {
    return {
      ok: false,
      code: 'TEST_INJECTION_BLOCKED',
      why: `${TEST_FIXTURE_ENV} 는 ${TEST_MODE_ENV}=1 일 때만 쓴다 — 운영에서는 금지다`,
    }
  }
  return { ok: true, test, fixturePath: test && fixture ? resolve(fixture) : null }
}

/**
 * 실제로 쓸 의존성. 운영이면 **빈 객체** — 호출부의 기본값(실제 함수)이 그대로 돈다.
 * 시험이면 거부 stub 위에 fixture 를 얹는다.
 */
export async function loadTestHarness(env = process.env) {
  const h = resolveTestHarness(env)
  if (!h.ok) return h
  if (!h.test) return { ok: true, test: false, deps: {} }
  let fx = {}
  if (h.fixturePath) {
    const mod = await import(pathToFileURL(h.fixturePath).href)
    fx = mod.default ?? mod
  }
  const unknown = Object.keys(fx).filter((k) => !INJECTABLE.includes(k))
  if (unknown.length) {
    return { ok: false, code: 'TEST_FIXTURE_UNKNOWN_KEY', why: `fixture 에 모르는 자리가 있다: ${unknown.join(', ')}` }
  }
  const picked = Object.fromEntries(INJECTABLE.filter((k) => fx[k] !== undefined).map((k) => [k, fx[k]]))
  return { ok: true, test: true, deps: { ...REFUSE, ...picked, fetchTiming: { ...TEST_FETCH_TIMING, ...(picked.fetchTiming ?? {}) } } }
}
