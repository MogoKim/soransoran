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
 */

export const AUTH_CALLBACK_COOKIE_NAMES = ['__Secure-authjs.callback-url', 'authjs.callback-url'] as const

const SEGMENT = /^[A-Za-z0-9_-]{1,128}$/

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
  origin: string,
): string | null {
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
