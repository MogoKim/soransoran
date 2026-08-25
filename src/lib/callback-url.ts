/**
 * 로그인 후 돌아올 경로 만들기
 *
 * 🔴 내부 경로만 허용한다.
 *    callbackUrl 은 화면에 링크로 박히고 사용자가 URL 로 바꿔 넣을 수 있다.
 *    외부 주소가 통과하면 우리 도메인이 남의 사이트로 보내는 통로가 된다
 *    (open redirect). 그래서 값을 만들 때 한 번 거른다.
 *
 * 🔴 "/" 로 시작하는지만 보는 것으로는 모자라다.
 *    "//evil.com" 은 프로토콜 상대 URL 이라 브라우저가 외부로 읽고,
 *    "/\evil.com" 도 같게 해석하는 브라우저가 있다. 둘 다 막는다.
 *
 * NextAuth 기본 redirect 콜백이 baseUrl 밖을 거부하는 2차 방어지만,
 * 그건 auth.config.ts 에 redirect 콜백을 추가하는 순간 덮어써진다.
 * 값을 만드는 쪽에서 거르는 것이 이 함수의 역할이다.
 */

/** 링크 하나가 감당할 길이. 넘으면 사람이 만든 값이 아니라고 본다 */
const MAX_LENGTH = 512

/** 공백·제어문자 — 정상 경로에는 없다 */
const UNSAFE_CHARS = /[\u0000-\u0020\u007f]/

/**
 * 내부 경로면 그대로, 아니면 null 을 준다.
 * null 이면 부르는 쪽이 callbackUrl 없는 평범한 '/login' 으로 보낸다.
 */
export function toInternalPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null

  const path = raw.trim()
  if (!path || path.length > MAX_LENGTH) return null
  if (UNSAFE_CHARS.test(path)) return null

  if (!path.startsWith('/')) return null
  // 프로토콜 상대 URL — 외부로 나간다
  if (path.startsWith('//') || path.startsWith('/\\')) return null

  return path
}

/**
 * 로그인 링크를 만든다.
 *
 * @param callbackPath 로그인 후 돌아올 내부 경로
 * @returns 걸러지면 callbackUrl 없는 '/login'
 */
export function loginHref(callbackPath: unknown): string {
  const safe = toInternalPath(callbackPath)
  if (!safe) return '/login'
  return `/login?callbackUrl=${encodeURIComponent(safe)}`
}
