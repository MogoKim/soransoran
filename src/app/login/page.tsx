import Header from '@/components/layouts/Header'

export const metadata = { title: '로그인' }

export default function LoginPage() {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-12 text-center">
        <h1 className="text-xl font-bold text-content-primary">로그인</h1>
        <p className="mt-3 text-sm text-content-muted">
          카카오 계정으로 로그인합니다. 인증 배선은 Kakao 앱 설정 후 연결합니다.
        </p>
      </main>
    </>
  )
}
