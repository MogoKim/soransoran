import PageShell from '@/components/layouts/PageShell'
import EmptyState from '@/components/layouts/EmptyState'
import MagazineList from '@/components/features/MagazineList'
import ListHeader from '@/components/ui/list-header'
import { getBoardBySlug } from '@/lib/board-registry'
import { getAllMagazineArticles } from '@/lib/magazine'

import type { Metadata } from 'next'

/**
 * publishAt 공개 판정이 **요청 시점**에 일어나야 한다.
 * 지금은 HeaderAuth 의 auth() 부작용 때문에 우연히 동적이지만,
 * 인증 구조가 바뀌면 이 페이지가 정적이 되어 예약 공개가 조용히 멈춘다.
 * 그 우연에 기대지 않는다.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '매거진',
  // layout 의 canonical:'/' 를 상속하면 홈의 복제로 잡힌다. 개별 경로로 고정한다.
  alternates: { canonical: '/magazine' },
}

export default function MagazinePage() {
  const board = getBoardBySlug('magazine')!
  const articles = getAllMagazineArticles()

  return (
    <PageShell>
      <main className="mx-auto max-w-3xl px-4 pb-16">
        <ListHeader board={board} />
        {/* 매거진에는 글쓰기 버튼을 노출하지 않는다 (IA 정본) */}

        {articles.length === 0 ? (
          <EmptyState title={board.emptyTitle} body={board.emptyBody} />
        ) : (
          <MagazineList articles={articles} />
        )}
      </main>
    </PageShell>
  )
}
