import { notFound } from 'next/navigation'
import PageShell from '@/components/layouts/PageShell'
import EmptyState from '@/components/layouts/EmptyState'
import ListHeader from '@/components/ui/list-header'
import PostListItem from '@/components/features/PostListItem'
import Pagination from '@/components/features/Pagination'
import { getBoardBySlug } from '@/lib/board-registry'
import { buildListHref, parsePageParam } from '@/lib/list-query'
import { prisma } from '@/lib/prisma'
import { getBlockedUserIds } from '@/lib/queries/posts'
import { loadBestPage } from '@/lib/queries/best'

import type { Metadata } from 'next'

// 보는 사람마다 차단 필터가 다르고, 1쪽은 반응이 생길 때마다 바뀐다 — 캐시하지 않는다.
export const dynamic = 'force-dynamic'

/** 🔴 page 가 `string[]` 일 수 있다 — `?page=2&page=5` 면 Next 가 배열을 준다. 첫 값을 쓴다. */
type BestSearchParams = { page?: string | string[] }

/**
 * 🔴 canonical 은 지금 보고 있는 쪽이다. 1쪽은 `/best`(`?page=1` 도 여기로), 2쪽부터는 자기 자신.
 * 🔴 noindex 는 유지한다. 1쪽은 순위가 수시로 바뀌는 목록이라 색인 대상이 아니고,
 *    기록 쪽의 색인 여부는 따로 정할 일이다. 메뉴·쪽 링크는 따라갈 수 있게 둔다.
 */
export function generateMetadata({ searchParams }: { searchParams: BestSearchParams }): Metadata {
  return {
    title: '베스트',
    alternates: { canonical: buildListHref('/best', { page: parsePageParam(searchParams.page) }) },
    robots: { index: false, follow: true },
  }
}

/**
 * 베스트 — 1쪽은 지금 베스트 12개(순위 표시), 2쪽부터는 지난 베스트 기록(순위 없음).
 *
 * 순위 식은 src/lib/best-ranking.ts, 읽기는 src/lib/queries/best.ts 다.
 * 🔴 홈 "지금 뜨는 이야기" 와는 공개 자격(DISCOVERY_ELIGIBLE_WHERE · 차단 필터)만 공유한다.
 *    점수·후보·개수·정렬·기록은 따로 둔다 — 홈은 홈의 함수(getHomePopularPosts)가 있고,
 *    홈 운영 큐레이션(PIN·HIDE)은 여기로 따라오지 않는다.
 * 🔴 이 화면은 읽기만 한다. 기록은 공감·댓글·노출 변경이 일어나는 쓰기 경로가 남긴다
 *    (best-ranking-db.ts syncBestRanking).
 * 🔴 모아보기 영역이다. 글쓰기 진입점(FAB·빈 상태 버튼)을 두지 않는다.
 */
export default async function BestPage({ searchParams }: { searchParams: BestSearchParams }) {
  const board = getBoardBySlug('best')!
  const page = parsePageParam(searchParams.page)
  const blockedIds = await getBlockedUserIds()
  const result = await loadBestPage(prisma, { page, blockedIds })

  // 없는 쪽은 빈 200 이 아니라 404 다 — 게시판과 같은 계약. 기록이 0건이면 2쪽부터 404 다.
  if (result.outOfRange) notFound()

  const isCurrent = result.kind === 'current'

  return (
    <PageShell>
      <main className="mx-auto max-w-3xl px-4 pb-16">
        <ListHeader board={board} />

        {!isCurrent ? (
          <h2 className="mb-1 mt-2 text-sm font-bold text-content-secondary">지난 베스트</h2>
        ) : null}

        {result.posts.length === 0 ? (
          <EmptyState title={board.emptyTitle} body={board.emptyBody} />
        ) : isCurrent ? (
          /* -mx-4 로 바깥 여백을 되돌린다 — 행이 자기 px-4 를 가지므로 그대로 두면 32px 이 된다.
             구분선은 항목 사이에만 긋는다. */
          <ol className="m-0 -mx-4 flex list-none flex-col p-0 [&>li+li]:border-t [&>li+li]:border-subtle">
            {result.posts.map((post, index) => (
              <li key={post.id}>
                <PostListItem post={post} rank={index + 1} surface="page" emphasis hideEmptyStats />
              </li>
            ))}
          </ol>
        ) : (
          /* 🔴 순위 숫자를 붙이지 않는다. 기록은 들어온 순서이지 13위·14위가 아니다. */
          <ul className="m-0 -mx-4 flex list-none flex-col p-0 [&>li+li]:border-t [&>li+li]:border-subtle">
            {result.posts.map((post) => (
              <li key={post.id}>
                <PostListItem post={post} surface="page" emphasis hideEmptyStats />
              </li>
            ))}
          </ul>
        )}

        {/* 쪽이 하나뿐이면 Pagination 이 스스로 아무것도 그리지 않는다. */}
        <Pagination currentPage={result.page} totalPages={result.lastPage} basePath="/best" />
      </main>
    </PageShell>
  )
}
