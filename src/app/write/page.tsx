import Header from '@/components/layouts/Header'

export const metadata = { title: '글쓰기' }

export default function WritePage() {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-xl font-bold text-content-primary">글쓰기</h1>
        <p className="mt-3 text-sm text-content-muted">
          로그인한 회원만 글을 쓸 수 있습니다. 에디터는 DB 연결 후 구현합니다.
        </p>
      </main>
    </>
  )
}
