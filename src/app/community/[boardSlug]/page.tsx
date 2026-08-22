import { notFound } from 'next/navigation'
import Header from '@/components/layouts/Header'
import IconMenu from '@/components/layouts/IconMenu'
import EmptyState from '@/components/layouts/EmptyState'
import { getBoardBySlug } from '@/lib/board-registry'

export default function BoardPage({ params }: { params: { boardSlug: string } }) {
  const board = getBoardBySlug(params.boardSlug)
  if (!board || !board.isCommunity) notFound()

  return (
    <>
      <Header />
      <IconMenu />
      <main className="mx-auto max-w-3xl px-4">
        <h1 className="py-6 text-xl font-bold text-content-primary">{board.label}</h1>
        {/* 글 목록은 DB 연결 후 구현한다. scaffold 단계에서는 empty state 만 둔다. */}
        <EmptyState
          title={board.emptyTitle}
          body={board.emptyBody}
          ctaLabel={board.emptyCta}
          ctaHref="/write"
        />
      </main>
    </>
  )
}
