import type { Metadata } from 'next'
import LoginOnboarding from '@/components/features/login/LoginOnboarding'
import SignupBlockedNotice from '@/components/features/login/SignupBlockedNotice'
import { SIGNUP_BLOCKED } from '@/lib/signup-policy'

export const metadata: Metadata = {
  title: '로그인',
  robots: { index: false, follow: false },
}

/**
 * 🔴 callbackUrl 을 거르지 않는다. 받은 값을 그대로 쓰고 없을 때만 홈으로 둔다.
 *    값을 만들고 거르는 곳은 loginHref 하나다 — 두 번째 규칙을 두면
 *    두 곳이 어긋나는 순간 로그인 후 엉뚱한 화면으로 간다.
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
  /**
   * 🔴 가입이 막힌 사람에게 로그인 화면을 다시 보여주지 않는다.
   *    같은 버튼을 또 누르게 되고, 눌러도 같은 자리로 돌아온다.
   *    error 는 signIn 게이트가 붙인다 — 그 밖의 값은 안내를 지어내지 않고 로그인 화면을 둔다.
   */
  if (searchParams.error === SIGNUP_BLOCKED) {
    return (
      <div className="bg-surface-card sm:flex sm:min-h-dvh sm:items-center sm:justify-center sm:bg-surface-page sm:px-4 sm:py-12">
        <div className="w-full sm:max-w-[420px] sm:rounded-2xl sm:bg-surface-card">
          <SignupBlockedNotice />
        </div>
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
