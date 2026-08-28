import type { Metadata } from 'next'
import LoginOnboarding from '@/components/features/login/LoginOnboarding'

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
  searchParams: { callbackUrl?: string }
}) {
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
