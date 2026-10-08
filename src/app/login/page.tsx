import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import LoginOnboarding from '@/components/features/login/LoginOnboarding'
import SignupBlockedNotice from '@/components/features/login/SignupBlockedNotice'
import { AUTH_CALLBACK_COOKIE_NAMES, resolveSignupFailureReturn } from '@/lib/signup-auth-return'

export const metadata: Metadata = {
  title: '로그인',
  robots: { index: false, follow: false },
}

/**
 * 가입 자격 안내를 띄우는 error 값 — 가입 판정(auth.ts)이 신규 가입을 막을 때
 * signup-policy.ts 의 SIGNUP_BLOCKED_PATH 로 이 값을 붙여 보낸다.
 */
const SIGNUP_BLOCKED = 'female_only'

/**
 * 카카오 인증 취소·실패 — Auth.js 가 callback 정보 없이 이 값으로 보낸다.
 * 🔴 이 값 하나만 가입 제안 복귀를 시도한다. 다른 Auth.js 오류는 지금처럼 평소 로그인 화면이다.
 */
const OAUTH_CALLBACK_ERROR = 'OAuthCallbackError'

/** 이 요청의 origin — Auth.js 가 callback 쿠키에 담는 절대 URL 과 비교한다 */
function requestOrigin(): string {
  const h = headers()
  const host = (h.get('x-forwarded-host') ?? h.get('host') ?? '').split(',')[0].trim()
  const proto = (h.get('x-forwarded-proto') ?? 'https').split(',')[0].trim()
  return `${proto}://${host}`
}

/**
 * 🔴 주소의 callbackUrl 은 이 화면에서 거르지 않는다. 받은 값을 그대로 쓰고 없을 때만 홈으로 둔다.
 *    값을 만들고 거르는 곳은 loginHref 하나다 — 두 번째 규칙을 두면
 *    두 곳이 어긋나는 순간 로그인 후 엉뚱한 화면으로 간다.
 *
 * 🔴 카카오 취소·실패(OAuthCallbackError)는 다르다. 그때 Auth.js 는 주소에 callbackUrl 을 남기지 않고
 *    callback 쿠키에만 둔다. 그 쿠키 값은 resolveSignupFailureReturn 이 검증해 커뮤니티·매거진 상세의
 *    고정 실패 위치로만 돌려보낸다. 검증을 통과하지 못하면 이 화면에 그대로 남는다.
 *
 * 🔴 PageShell 을 쓰지 않는다.
 *    이 화면은 헤더·푸터 없이 화면 전체를 쓴다. 온보딩을 보는 동안
 *    나가는 길이 여럿이면 어느 것도 눌리지 않는다.
 */
export default function LoginPage({
  searchParams,
}: {
  searchParams: { callbackUrl?: string; error?: string }
}) {
  if (searchParams.error === OAUTH_CALLBACK_ERROR) {
    const jar = cookies()
    const target = resolveSignupFailureReturn(
      AUTH_CALLBACK_COOKIE_NAMES.map((name) => jar.get(name)?.value),
      requestOrigin(),
    )
    if (target) redirect(target)
  }

  /**
   * 🔴 가입이 막힌 사람에게 로그인 화면을 다시 보여주지 않는다.
   *    같은 버튼을 또 누르게 되고, 눌러도 같은 자리로 돌아온다.
   *
   * 🔴 아는 값에만 반응한다. 그 밖의 error 로는 안내를 지어내지 않고
   *    평소 로그인 화면을 둔다 — 무슨 일인지 모르면서 설명하면 거짓이 된다.
   */
  if (searchParams.error === SIGNUP_BLOCKED) {
    return (
      <div className="bg-surface-card sm:flex sm:min-h-dvh sm:items-center sm:justify-center sm:bg-surface-page sm:px-4 sm:py-12">
        <SignupBlockedNotice />
      </div>
    )
  }

  return (
    <div className="bg-surface-page sm:flex sm:min-h-dvh sm:items-center sm:justify-center sm:px-4 sm:py-12">
      <h1 className="sr-only">로그인</h1>
      <LoginOnboarding
        callbackUrl={searchParams.callbackUrl ?? '/'}
        hasReturnPath={Boolean(searchParams.callbackUrl)}
      />
    </div>
  )
}
