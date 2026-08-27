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
      {/* 제목을 감춘 만큼 위 여백을 직접 준다 — 메뉴에 목록이 바로 붙지 않게 한다 */}
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-4">
        {/* 상단 아이콘 메뉴가 이미 어느 방인지 말하고 있어 제목을 눈에서만 감춘다.
            <h1> 텍스트는 남는다 (매거진·베스트는 그대로 보인다). */}
        <ListHeader board={board} visuallyHidden />

        {posts.length === 0 ? (
          <EmptyState
            title={board.emptyTitle}
            body={board.emptyBody}
            ctaLabel={board.emptyCta}
            ctaHref={`/write?board=${board.slug}`}
          />
        ) : (
          /* 🔴 흰 면은 유지하되, 떠 있는 카드가 아니라 바닥에 깔린 지면으로 둔다.
                둥근 모서리와 사방 테두리가 있으면 목록이 화면 위에 얹힌 위젯처럼 보인다.
                게시판은 위젯이 아니라 계속 이어지는 지면이라, 가로로 꽉 채우고
                위아래 선으로만 시작과 끝을 알린다.

             🔴 흰 면 자체는 없애지 않는다.
                바탕 위에 행을 직접 놓으면 hover 색이 바탕색과 같아져 아무 일도 일어나지 않고
                (globals.css 표면 규칙) 구분선 대비도 함께 떨어진다.

             -mx-4 는 <main> 의 가로 여백을 되돌려 지면을 화면 끝까지 잇는다.
             글자 위치는 그대로다 — 가로 여백은 행(PostCard)이 자기 px-4 로 가진다.
             FAB 자리는 <main> 의 pb-24 가 이미 확보한다. */
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
