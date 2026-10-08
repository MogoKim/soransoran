import { getBoardBySlug } from '@/lib/board-registry'
import { toInternalPath } from '@/lib/callback-url'
import type { SignupFunnelContentType } from '@/lib/signup-funnel'
import { signupFailedFragment } from '@/lib/signup-return'

/**
 * 카카오 취소·실패(OAuthCallbackError) 뒤 원래 글로 돌아갈 주소 — 순수 판정.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §6-5 「취소·실패 복귀 경로」.
 *
 * Auth.js(이 저장소 설치본)는 인증 시작 때 callbackUrl 을 기본 redirect 콜백으로 정리해
 * `authjs.callback-url`(https 에서는 `__Secure-authjs.callback-url`) 쿠키에 같은 origin 의 절대 URL 로 둔다.
 * 오류로 /login 에 올 때 그 값은 쿠키에만 남는다.
 *
 * 🔴 검증 순서가 계약이다. 하나라도 걸리면 null — 부르는 쪽은 안전한 로그인 오류 화면에 남는다.
 *      1 쿠키 값이 없거나 두 이름의 값이 서로 다르면 거부
 *      2 내부 절대경로는 toInternalPath, 절대 URL 은 요청 origin 과 정확히 같을 때만
 *      3 protocol-relative · 다른 origin · 다른 scheme · 깨진 URL 거부
 *      4 /onboarding?callbackUrl=… 은 정확히 한 단계만 벗기고 같은 검증을 다시 한다(겹쳐 감싼 값은 거부)
 *      5 커뮤니티 · 매거진 상세 경로만
 *      6 query 와 원래 fragment 는 버리고 콘텐츠 유형의 고정 실패 fragment 를 붙인다
 * 🔴 요청 origin 을 정하지 못하거나 어떤 값이 들어와도 throw 하지 않는다 — null 로 닫힌다(fail-closed).
 *    인증 오류 화면이 계측·복귀 판정 때문에 500 이 되면 안 된다.
 */

export const AUTH_CALLBACK_COOKIE_NAMES = ['__Secure-authjs.callback-url', 'authjs.callback-url'] as const

const SEGMENT = /^[A-Za-z0-9_-]{1,128}$/

/** host 헤더에 올 수 있는 글자 — 영숫자 · 점 · 하이픈 · 포트 콜론 · IPv6 대괄호. userinfo·경로·query·fragment·백슬래시·공백·제어문자는 여기서 걸린다 */
const HOST_CHARS = /^[A-Za-z0-9.:[\]-]+$/
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

function firstHeaderValue(value: string | null): string | null {
  if (value === null) return null
  const first = value.split(',')[0].trim()
  return first === '' ? null : first
}

/**
 * 요청 헤더로 이 요청의 origin 을 정한다. 정할 수 없으면 null — 부르는 쪽은 로그인 오류 화면에 남는다.
 *
 *   host   x-forwarded-host 의 첫 값, 없으면 host 의 첫 값
 *   proto  x-forwarded-proto 가 있으면 정확히 http · https 만. 없으면 localhost · 127.0.0.1 · [::1] 은 http,
 *          그 밖은 https
 *   결과   URL 파서가 정규화한 origin 만
 */
export function originFromRequestHeaders(headers: { get(name: string): string | null }): string | null {
  const host = firstHeaderValue(headers.get('x-forwarded-host')) ?? firstHeaderValue(headers.get('host'))
  if (!host || !HOST_CHARS.test(host)) return null

  let proto: string
  const forwarded = headers.get('x-forwarded-proto')
  if (forwarded !== null) {
    const value = firstHeaderValue(forwarded)
    if (value !== 'http' && value !== 'https') return null
    proto = value
  } else {
    const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
    proto = LOCAL_HOSTNAMES.has(hostname.toLowerCase()) ? 'http' : 'https'
  }

  let url: URL
  try {
    url = new URL(`${proto}://${host}`)
  } catch {
    return null
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
  return url.origin
}

/** 2·3 단계 — 내부 경로로 바꿀 수 있으면 경로, 아니면 null */
function toSameOriginPath(value: string, origin: string): string | null {
  if (value.startsWith('/')) return toInternalPath(value)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.origin !== origin) return null
  return toInternalPath(`${url.pathname}${url.search}${url.hash}`)
}

/** 5 단계 — 상세 경로면 콘텐츠 유형, 아니면 null */
function detailContentType(pathname: string): SignupFunnelContentType | null {
  const parts = pathname.split('/')
  if (parts.length === 4 && parts[0] === '' && parts[1] === 'community' && SEGMENT.test(parts[2]) && SEGMENT.test(parts[3]))
    return getBoardBySlug(parts[2])?.isCommunity ? 'community' : null
  if (parts.length === 3 && parts[0] === '' && parts[1] === 'magazine' && SEGMENT.test(parts[2])) return 'magazine'
  return null
}

export function resolveSignupFailureReturn(
  cookieValues: ReadonlyArray<string | undefined>,
  origin: string | null,
): string | null {
  try {
    return resolveOrThrow(cookieValues, origin)
  } catch {
    return null
  }
}

function resolveOrThrow(cookieValues: ReadonlyArray<string | undefined>, origin: string | null): string | null {
  if (!origin) return null
  const values = [...new Set(cookieValues.filter((v): v is string => typeof v === 'string' && v !== ''))]
  if (values.length !== 1) return null

  let path = toSameOriginPath(values[0], origin)
  if (!path) return null

  const outer = new URL(path, origin)
  if (outer.pathname === '/onboarding') {
    const inner = outer.searchParams.get('callbackUrl')
    if (!inner) return null
    path = toSameOriginPath(inner, origin)
    if (!path) return null
  }

  const target = new URL(path, origin)
  if (target.pathname === '/onboarding') return null
  const contentType = detailContentType(target.pathname)
  if (!contentType) return null

  return `${target.pathname}${signupFailedFragment(contentType)}`
}
