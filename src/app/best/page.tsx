import PageShell from '@/components/layouts/PageShell'
import EmptyState from '@/components/layouts/EmptyState'
import { getBoardBySlug } from '@/lib/board-registry'

import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '베스트',
  // layout 의 canonical:'/' 를 상속하면 홈의 복제로 잡힌다. 개별 경로로 고정한다.
  alternates: { canonical: '/best' },
}

export default function BestPage() {
  const board = getBoardBySlug('best')!
  return (
    <PageShell>
      <main className="mx-auto max-w-3xl px-4">
        <h1 className="py-6 text-xl font-bold text-content-primary">베스트</h1>
        {/* 베스트는 모아보기 영역이다. 글쓰기 진입점을 두지 않는다. */}
        <EmptyState title={board.emptyTitle} body={board.emptyBody} />
      </main>
    </PageShell>
  )
}
