import type { Metadata } from 'next'
import { TOUCH_MIN } from '@/lib/spacing'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import PageShell from '@/components/layouts/PageShell'
import EmptyState from '@/components/layouts/EmptyState'
import ListHeader from '@/components/ui/list-header'
import { getBoardBySlug } from '@/lib/board-registry'
import { getPostsByBoard } from '@/lib/queries/posts'
import {
  buildBoardListHref,
  isPageOutOfRange,
  lastPageOf,
  parseBoardSort,
  parsePageParam,
  type BoardSort,
} from '@/lib/list-query'
import PostCard from '@/components/features/PostCard'
import Pagination from '@/components/features/Pagination'
import type { BoardType } from '@prisma/client'

export const dynamic = 'force-dynamic'

/** 🔴 page 가 `string[]` 일 수 있다 — `?page=2&page=5` 처럼 같은 키가 둘이면 Next 가 배열을 준다. */
type BoardSearchParams = { sort?: string; page?: string | string[] }

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
 *
 * 🔴 canonical 은 **지금 보고 있는 쪽**을 가리킨다. 2쪽의 정본을 1쪽으로 적지 않는다.
 *    지금은 noindex 라 크롤러가 이 값을 읽지 않지만, 색인을 여는 날
 *    2쪽 이후가 통째로 1쪽의 복제로 처리되어 깊은 글이 색인에서 사라진다.
 *    (우나어가 그 상태다 — `?page=2` 의 canonical 이 `/community/stories` 다. 2026-09-21 실측)
 */
export function generateMetadata({
  params,
  searchParams,
}: {
  params: { boardSlug: string }
  searchParams: BoardSearchParams
}): Metadata {
  const board = getBoardBySlug(params.boardSlug)
  if (!board) return {}
  return {
    title: board.label,
    alternates: {
      canonical: buildBoardListHref(board.href, {
        page: parsePageParam(searchParams.page),
        sort: parseBoardSort(searchParams.sort),
      }),
    },
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
 *    page 도 같은 규칙이다 — 주소 만들기는 buildBoardListHref 한 곳이 맡는다.
 *
 * 🔴 정렬을 바꾸면 page 를 버린다.
 *    buildBoardListHref 에 page 를 넘기지 않아 1쪽으로 돌아간다. 3쪽에서 조회순을
 *    눌렀을 때 3쪽에 머무르면, 방금 고른 정렬의 맨 위를 보지 못한 채
 *    전혀 다른 글 묶음이 나온다.
 */
const SORT_TABS: ReadonlyArray<{ key: BoardSort; label: string }> = [
  { key: 'latest', label: '최신순' },
  { key: 'views', label: '조회순' },
]

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: { boardSlug: string }
  searchParams: BoardSearchParams
}) {
  const board = getBoardBySlug(params.boardSlug)
  if (!board || !board.isCommunity) notFound()

  const sort = parseBoardSort(searchParams.sort)
  const page = parsePageParam(searchParams.page)
  const { posts, total } = await getPostsByBoard(board.type as BoardType, sort, page)

  /**
   * 🔴 없는 쪽을 200 으로 주지 않는다.
   *    빈 목록을 돌려주면 사용자에게는 "이전" 이 또 빈 쪽으로 가는 막다른 골목이 되고
   *    (우나어 `/best?page=50` 실측), 색인을 여는 날에는 끝없이 이어지는 soft-404 가 된다.
   *
   * 🔴 글이 하나도 없는 게시판의 1쪽은 여기 걸리지 않는다.
   *    게시판은 존재하고 "아직 글이 없습니다" 는 정상 화면이다 — lastPageOf 하한이 1이다.
   */
  if (isPageOutOfRange(page, total)) notFound()

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
                  href={buildBoardListHref(board.href, { sort: tab.key })}
                  /* 🔴 'page' 가 아니라 'true' 다. 값은 **이 묶음이 무엇의 집합인가**로 고른다.
                     'page' 는 "여러 쪽 중 지금 쪽" 을 뜻하고, 그 집합은 아래 페이지 이동이다.
                     여기는 쪽의 집합이 아니라 **정렬 방식의 집합**이라 'true'(이 묶음에서 지금 것)가 맞다.

                     문서 전체에 aria-current 가 몇 개인지는 기준이 아니다 —
                     nav 가 여럿이면 각 nav 가 자기 집합의 현재 항목을 표시하는 것이 정상이고,
                     보조기술도 묶음 단위로 읽는다. 상단 메뉴(IconMenu)가 현재 게시판에
                     'page' 를 쓰는 것도 같은 이유로 고치지 않는다. */
                  aria-current={active ? 'true' : undefined}
                  /* 밑줄은 border-b-2 로 항상 자리를 차지한다. 비활성일 때 투명하게 두면
                     고를 때마다 글자가 위아래로 흔들리지 않는다.
                     brand 는 글자로는 대비가 모자라 밑줄로만 쓴다 (globals.css §브랜드). */
                  className={`inline-flex ${TOUCH_MIN} shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-sm no-underline transition-colors duration-150 ${
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

        {/* 🔴 쪽이 하나뿐이면 Pagination 이 스스로 아무것도 그리지 않는다.
               "1 / 1" 만 남은 조작부는 누를 것이 없는데 자리를 차지한다.
               글이 0건일 때도 같다 — total 이 0이면 마지막 쪽은 1이다. */}
        <Pagination
          currentPage={page}
          totalPages={lastPageOf(total)}
          basePath={board.href}
          sort={sort}
        />
      </main>
    </PageShell>
  )
}
