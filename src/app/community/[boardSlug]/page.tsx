import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import PageShell from '@/components/layouts/PageShell'
import IconMenu from '@/components/layouts/IconMenu'
import EmptyState from '@/components/layouts/EmptyState'
import { getBoardBySlug } from '@/lib/board-registry'
import { getPostsByBoard } from '@/lib/queries/posts'
import PostCard from '@/components/features/PostCard'
import type { BoardType } from '@prisma/client'

export const dynamic = 'force-dynamic'

export function generateMetadata({ params }: { params: { boardSlug: string } }): Metadata {
  const board = getBoardBySlug(params.boardSlug)
  if (!board) return {}
  return {
    title: board.label,
    alternates: { canonical: board.href },
  }
}

export default async function BoardPage({ params }: { params: { boardSlug: string } }) {
  const board = getBoardBySlug(params.boardSlug)
  if (!board || !board.isCommunity) notFound()

  const posts = await getPostsByBoard(board.type as BoardType)

  return (
    <PageShell>
      <IconMenu />
      <main className="mx-auto max-w-3xl px-4 pb-24">
        <h1 className="py-6 text-xl font-bold text-content-primary">{board.label}</h1>

        {posts.length === 0 ? (
          <EmptyState
            title={board.emptyTitle}
            body={board.emptyBody}
            ctaLabel={board.emptyCta}
            ctaHref={`/write?board=${board.slug}`}
          />
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {posts.map((post) => (
              <li key={post.id}>
                <PostCard post={post} boardHref={board.href} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </PageShell>
  )
}
