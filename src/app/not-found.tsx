import Link from 'next/link'
import PageShell from '@/components/layouts/PageShell'

export default function NotFound() {
  return (
    <PageShell>
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-xl font-bold text-content-primary">페이지를 찾을 수 없습니다</h1>
        <p className="mt-2 text-sm text-content-muted">주소가 바뀌었거나 삭제된 글일 수 있습니다.</p>
        <Link href="/" className="mt-6 inline-block text-link">홈으로 가기</Link>
      </main>
    </PageShell>
  )
}
