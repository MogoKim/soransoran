import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import PageShell from '@/components/layouts/PageShell'
import EmptyState from '@/components/layouts/EmptyState'
import ListHeader from '@/components/ui/list-header'
import { getBoardBySlug } from '@/lib/board-registry'
import { getPostsByBoard, parseBoardSort } from '@/lib/queries/posts'
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

/**
 * 정렬 탭.
 *
 * 🔴 두 개로 끝낸다. 공감순·댓글순·인기순은 넣지 않는다 —
 *    고를 것이 늘수록 고르지 않게 되고, 목록의 기본 순서가 무엇인지 흐려진다.
 *
 * 🔴 최신순은 쿼리 없는 맨 주소로 돌아간다.
 *    기본값이 주소에 남지 않아야 링크를 주고받을 때 같은 화면이 열린다.
 */
const SORT_TABS = [
  { key: 'latest', label: '최신순' },
  { key: 'views', label: '조회순' },
] as const

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: { boardSlug: string }
  searchParams: { sort?: string }
}) {
  const board = getBoardBySlug(params.boardSlug)
  if (!board || !board.isCommunity) notFound()

  const sort = parseBoardSort(searchParams.sort)
  const posts = await getPostsByBoard(board.type as BoardType, sort)

  return (
    <PageShell showWriteFab>
      {/* 제목을 감춘 자리라 메뉴와 목록이 맞붙는다. 위 여백은 이 pt 가 혼자 만든다.
          아래 여백은 pb-16 이면 충분하다 — FAB 자리는 PageShell 이 따로 확보한다. */}
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-3">
        {/* 상단 메뉴가 이미 어느 방인지 말한다. 눈에서만 감추고 <h1> 텍스트는 남긴다
            (매거진도 필터 칩이 있어 같이 감춘다. 조작 줄이 없는 베스트만 제목을 보인다). */}
        <ListHeader board={board} visuallyHidden />

        {/* 🔴 글이 없으면 탭도 없다. 정렬할 것이 없는데 고르게 하면 눌러도 아무 일이 없다.
               제목이 sr-only 라, 글이 있을 때는 이 줄이 화면의 첫 줄이 된다.
               -mr-3 은 마지막 탭의 좌우 여백을 되돌린다 — 그래야 '조회순' 의 오른쪽 끝이
               아래 글 카드의 글자 끝과 같은 선에 선다. */}
        {posts.length > 0 ? (
          <nav aria-label="정렬" className="-mr-3 flex items-center justify-end">
            {SORT_TABS.map((tab) => {
              const active = tab.key === sort
              return (
                <Link
                  key={tab.key}
                  href={tab.key === 'latest' ? board.href : `${board.href}?sort=${tab.key}`}
                  aria-current={active ? 'page' : undefined}
                  /* 밑줄은 border-b-2 로 항상 자리를 차지한다. 비활성일 때 투명하게 두면
                     고를 때마다 글자가 위아래로 흔들리지 않는다.
                     brand 는 글자로는 대비가 모자라 밑줄로만 쓴다 (globals.css §브랜드). */
                  className={`inline-flex min-h-[52px] shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-sm no-underline transition-colors duration-150 ${
                    active
                      ? 'border-brand font-bold text-content-primary'
                      : 'border-transparent text-content-muted hover:text-content-primary'
                  }`}
                >
                  {tab.label}
                </Link>
              )
            })}
          </nav>
        ) : null}

        {posts.length === 0 ? (
          <EmptyState
            title={board.emptyTitle}
            body={board.emptyBody}
            ctaLabel={board.emptyCta}
            ctaHref={`/write?board=${board.slug}`}
          />
        ) : (
          /* 🔴 목록에 면을 주지 않는다.
                흰 면 + 위아래 선 + 화면 끝까지 닿는 폭이 겹치면 목록이 "표" 로 읽힌다.
                글은 바탕 위에 그대로 얹고, 사이를 가르는 선만 남긴다.
                행 hover 는 PostCard 가 제목색으로 처리한다 — 면을 만들지 않는다. */
          <ul className="flex flex-col [&>li+li]:border-t [&>li+li]:border-subtle">
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
