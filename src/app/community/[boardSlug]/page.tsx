import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import Header from '@/components/layouts/Header'
import IconMenu from '@/components/layouts/IconMenu'
import EmptyState from '@/components/layouts/EmptyState'
import { getBoardBySlug } from '@/lib/board-registry'
import { getPostsByBoard } from '@/lib/queries/posts'
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
    <>
      <Header />
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
          <ul className="flex list-none flex-col gap-2 p-0">
            {posts.map((post) => (
              <li key={post.id}>
                <Link
                  href={`${board.href}/${post.id}`}
                  className="block rounded-lg border border-subtle bg-surface-card p-4 no-underline"
                >
                  <p className="font-bold text-content-primary">{post.title}</p>
                  <p className="mt-1 text-xs text-content-muted">
                    {post.author.name ?? '회원'} · 댓글 {post._count.comments}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>

      <Link
        href={`/write?board=${board.slug}`}
        className="fixed bottom-6 right-5 inline-flex min-h-[56px] items-center rounded-full bg-cta px-6 font-bold text-cta-text no-underline shadow-lg hover:bg-cta-hover"
      >
        ✏️ 글쓰기
      </Link>
    </>
  )
}
