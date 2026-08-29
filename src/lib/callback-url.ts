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

/** 가입을 마치는 화면. 로그인 뒤 모두가 한 번 지난다 */
const ONBOARDING_PATH = '/onboarding'

/** 쿼리를 떼고 온보딩 화면인지 본다 */
function isOnboardingPath(path: string): boolean {
  const pathname = path.split('?')[0]
  return pathname === ONBOARDING_PATH || pathname === `${ONBOARDING_PATH}/`
}

/**
 * 로그인 뒤 돌아올 곳을 온보딩으로 한 번 감싼다.
 *
 * 🔴 신규와 기존을 여기서 가르지 않는다.
 *    누가 처음인지는 로그인 시점에 알 수 없고, 알아내려면 인증 설정에
 *    손을 대야 한다 — 그 파일은 건드리는 순간 로그인 전체가 흔들린 전력이 있다.
 *    그래서 모두를 온보딩으로 보내고, 이미 마친 사람은 그 화면이
 *    isOnboarded 를 보고 곧바로 돌려보낸다 (app/onboarding/page.tsx).
 *    기존 회원에게는 스쳐 지나가는 한 번의 리다이렉트로 끝난다.
 *
 * 🔴 가려던 곳을 잃지 않는다.
 *    '/write?board=free' 로 가려던 사람은 가입을 마친 뒤 그 자리로 돌아온다.
 *    이 값을 버리면 로그인 한 번에 하려던 일이 사라진다.
 *
 * 🔴 두 겹으로 감싸지 않는다.
 *    이미 온보딩을 가리키는 값이 들어오면 그대로 둔다. 겹쳐 감으면
 *    가입을 마치고 또 가입 화면으로 가는 고리가 생긴다.
 *
 * 🔴 거를 수 없는 값은 홈으로 바꾼다.
 *    open redirect 판정은 toInternalPath 하나가 한다 — 여기서 다시 짜지 않는다.
 */
export function onboardingHref(callbackPath: unknown): string {
  const safe = toInternalPath(callbackPath)
  if (safe && isOnboardingPath(safe)) return safe
  return `${ONBOARDING_PATH}?callbackUrl=${encodeURIComponent(safe ?? '/')}`
}
