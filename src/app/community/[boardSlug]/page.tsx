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
      {/* 제목을 감춘 자리라 위 여백은 숨 쉴 틈만큼만 둔다 */}
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-2">
        {/* 상단 메뉴가 이미 어느 방인지 말한다. 눈에서만 감추고 <h1> 텍스트는 남긴다
            (매거진·베스트는 기본값 그대로 보인다). */}
        <ListHeader board={board} visuallyHidden />

        {posts.length === 0 ? (
          <EmptyState
            title={board.emptyTitle}
            body={board.emptyBody}
            ctaLabel={board.emptyCta}
            ctaHref={`/write?board=${board.slug}`}
          />
        ) : (
          /* 떠 있는 카드가 아니라 바닥에 깔린 지면으로 둔다 — 라운드·사방 테두리는 위젯으로 읽힌다.
             흰 면 자체는 없애지 않는다: 바탕 위에 행을 직접 놓으면 hover 색이 바탕색과 같아져
             아무 일도 일어나지 않는다 (globals.css 표면 규칙).
             -mx-4 는 <main> 의 가로 여백을 되돌린다 — 글자 위치는 행의 px-4 가 유지한다. */
          <ul className="-mx-4 flex list-none flex-col border-y border-subtle bg-surface-card p-0 [&>li+li]:border-t [&>li+li]:border-subtle">
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
