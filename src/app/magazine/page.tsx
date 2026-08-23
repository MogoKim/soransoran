import PageShell from '@/components/layouts/PageShell'
import EmptyState from '@/components/layouts/EmptyState'
import { getBoardBySlug } from '@/lib/board-registry'

import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '매거진',
  // layout 의 canonical:'/' 를 상속하면 홈의 복제로 잡힌다. 개별 경로로 고정한다.
  alternates: { canonical: '/magazine' },
  // 발행 경로와 콘텐츠가 아직 없다 — 빈 페이지를 색인시키지 않는다. 단 메뉴 링크는 따라갈 수 있게 둔다.
  robots: { index: false, follow: true },
}

export default function MagazinePage() {
  const board = getBoardBySlug('magazine')!
  return (
    <PageShell>
      <main className="mx-auto max-w-3xl px-4">
        <h1 className="py-6 text-xl font-bold text-content-primary">매거진</h1>
        {/* 매거진에는 글쓰기 버튼을 노출하지 않는다 (IA 정본) */}
        <EmptyState title={board.emptyTitle} body={board.emptyBody} />
      </main>
    </PageShell>
  )
}
