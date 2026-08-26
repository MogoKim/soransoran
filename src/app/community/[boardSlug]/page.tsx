import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import PageShell from '@/components/layouts/PageShell'
import EmptyState from '@/components/layouts/EmptyState'
import ListHeader from '@/components/ui/list-header'
import { getBoardBySlug } from '@/lib/board-registry'
import { getPostsByBoard } from '@/lib/queries/posts'
import PostCard from '@/components/features/PostCard'
import type { BoardType } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * 🔴 M0 안정성 우선 — 커뮤니티 board list 는 noindex, follow 다.
 *
 * Micro Seed 는 이 목록에 "보여야" 한다(정본 §7-A). 그런데 목록 페이지가 색인되면
 * Micro Seed 제목·본문 일부가 목록 카드를 통해 검색에 잡힌다.
 * 글 단위 noindex 만으로는 목록 페이지에 실린 발췌를 막지 못한다.
 *
 * follow 는 유지한다 — 색인 대상인 개별 글로 크롤러가 이동하는 경로는 남긴다.
 *
 * ⚠️ M0 의 보수적 기본값이다. 목록에서 Micro Seed 를 분리해 렌더할 수 있게 되면
 *    재검토한다(정본 TODO-17). 매거진 목록은 이 정책의 대상이 아니다.
 */
export function generateMetadata({ params }: { params: { boardSlug: string } }): Metadata {
  const board = getBoardBySlug(params.boardSlug)
  if (!board) return {}
  return {
    title: board.label,
    // noindex 면 canonical 값은 크롤러가 무시한다. 내부 정본 표기로만 남긴다.
    alternates: { canonical: board.href },
    robots: { index: false, follow: true },
  }
}

export default async function BoardPage({ params }: { params: { boardSlug: string } }) {
  const board = getBoardBySlug(params.boardSlug)
  if (!board || !board.isCommunity) notFound()

  const posts = await getPostsByBoard(board.type as BoardType)

  return (
    <PageShell>
      <main className="mx-auto max-w-3xl px-4 pb-24">
        <ListHeader board={board} />

        {posts.length === 0 ? (
          <EmptyState
            title={board.emptyTitle}
            body={board.emptyBody}
            ctaLabel={board.emptyCta}
            ctaHref={`/write?board=${board.slug}`}
          />
        ) : (
          <ul className="flex list-none flex-col p-0">
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
