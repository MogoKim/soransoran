import type { Metadata } from 'next'
import PageShell from '@/components/layouts/PageShell'
import KakaoSignInButton from '@/components/features/KakaoSignInButton'

export const metadata: Metadata = {
  title: '로그인',
  robots: { index: false, follow: false },
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: { callbackUrl?: string }
}) {
  return (
    <PageShell chrome="minimal">
      <main className="mx-auto flex max-w-3xl flex-col items-center px-4 py-16 text-center">
        <h1 className="text-xl font-bold text-content-primary">로그인</h1>
        <p className="mt-2 text-sm text-content-muted">
          카카오 계정으로 시작할 수 있습니다.
        </p>
        <div className="mt-8 w-full max-w-xs">
          <KakaoSignInButton callbackUrl={searchParams.callbackUrl ?? '/'} />
        </div>
      </main>
    </PageShell>
  )
}
