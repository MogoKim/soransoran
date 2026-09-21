import { cache } from 'react'
import { notFound } from 'next/navigation'
import PageShell from '@/components/layouts/PageShell'
import EmptyState from '@/components/layouts/EmptyState'
import MagazineList from '@/components/features/MagazineList'
import Pagination from '@/components/features/Pagination'
import ListHeader from '@/components/ui/list-header'
import { getBoardBySlug } from '@/lib/board-registry'
import { getMagazineListState } from '@/lib/magazine'
import {
  buildMagazineListHref,
  firstParam,
  isPageOutOfRange,
  lastPageOf,
  magazineListKeep,
  MAGAZINE_PAGE_SIZE,
  parsePageParam,
} from '@/lib/list-query'

import type { Metadata } from 'next'

/**
 * publishAt 공개 판정이 **요청 시점**에 일어나야 한다.
 * 지금은 HeaderAuth 의 auth() 부작용 때문에 우연히 동적이지만,
 * 인증 구조가 바뀌면 이 페이지가 정적이 되어 예약 공개가 조용히 멈춘다.
 * 그 우연에 기대지 않는다.
 */
export const dynamic = 'force-dynamic'

/** 🔴 같은 키가 둘이면 Next 가 배열을 준다 — `?page=2&page=5` · `?cluster=a&cluster=b` */
type MagazineSearchParams = { cluster?: string | string[]; page?: string | string[] }

/**
 * 🔴 `generateMetadata` 와 렌더가 **같은 계산 하나**를 본다.
 *    Next 는 이 둘을 따로 부르므로, 감싸지 않으면 한 요청에서 공개 글을 두 번 고른다.
 *    두 번 고르면 비용도 두 배지만 더 나쁜 것은 **두 결과가 갈릴 수 있다는 점**이다 —
 *    예약 공개 시각을 그 사이에 지난 글이 canonical 과 화면에서 다르게 잡힌다.
 *
 * 🔴 인자는 **원시값 둘**이어야 한다. `cache` 는 인자의 **동일성**으로 재사용을 판단한다.
 *    객체 리터럴을 넘기면 매번 새 객체라 캐시가 한 번도 맞지 않고,
 *    `?cluster=a&cluster=b` 처럼 배열이 들어와도 같은 일이 난다 —
 *    내용이 같아도 다른 배열이면 다른 키다. 그래서 `firstParam` 으로 먼저 누른다.
 */
const magazineList = cache(getMagazineListState)

/**
 * 🔴 canonical 은 **지금 보고 있는 목록**을 가리킨다.
 *    2쪽과 수면 분류를 전부 `/magazine` 으로 몰면 그 화면들이 1쪽의 복제로 처리되어
 *    깊은 글로 가는 내부 링크가 색인에서 끊긴다. 매거진 목록은 게시판(noindex)과 달리
 *    **색인 대상 화면**이라 이 차이가 그대로 노출에 반영된다.
 *
 * 🔴 기본값은 정본 주소에서 뺀다 — `?page=1` 과 `?cluster=all` 은 `/magazine` 이다.
 *    `buildMagazineListHref` 가 그 규칙을 이미 갖고 있어 여기서 다시 적지 않는다.
 */
export function generateMetadata({
  searchParams,
}: {
  searchParams: MagazineSearchParams
}): Metadata {
  const board = getBoardBySlug('magazine')!
  const page = parsePageParam(searchParams.page)
  const { cluster } = magazineList(firstParam(searchParams.cluster), page)
  return {
    title: '매거진',
    alternates: { canonical: buildMagazineListHref(board.href, { page, cluster }) },
  }
}

export default function MagazinePage({ searchParams }: { searchParams: MagazineSearchParams }) {
  const board = getBoardBySlug('magazine')!
  const page = parsePageParam(searchParams.page)
  const { clusters, cluster, articles, total } = magazineList(firstParam(searchParams.cluster), page)

  /**
   * 🔴 없는 쪽을 200 으로 주지 않는다.
   *    빈 목록을 돌려주면 사람에게는 "이전" 이 또 빈 쪽으로 가는 막다른 골목이 되고,
   *    색인 대상 화면이라 수집기에게는 끝없이 이어지는 soft-404 가 된다.
   *
   * 🔴 공개 글이 하나도 없을 때의 1쪽은 여기 걸리지 않는다 — lastPageOf 하한이 1이다.
   *    그 경우는 아래 빈 상태가 받는다.
   */
  if (isPageOutOfRange(page, total, MAGAZINE_PAGE_SIZE)) notFound()

  return (
    <PageShell>
      {/* 제목이 sr-only 라 메뉴와 필터가 맞붙는다. 게시판과 같은 pt-3 으로 맞춘다. */}
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-3">
        {/* 상단 메뉴가 이미 어느 화면인지 말한다. 제목은 눈에서만 감추고 문서 구조는 남긴다. */}
        <ListHeader board={board} visuallyHidden />
        {/* 매거진에는 글쓰기 버튼을 노출하지 않는다 (IA 정본) */}

        {total === 0 ? (
          <EmptyState title={board.emptyTitle} body={board.emptyBody} />
        ) : (
          <>
            <MagazineList
              articles={articles}
              clusters={clusters}
              activeCluster={cluster}
              basePath={board.href}
            />

            {/* 🔴 쪽이 하나뿐이면 Pagination 이 스스로 아무것도 그리지 않는다. */}
            <Pagination
              currentPage={page}
              totalPages={lastPageOf(total, MAGAZINE_PAGE_SIZE)}
              basePath={board.href}
              keep={magazineListKeep(cluster)}
            />
          </>
        )}
      </main>
    </PageShell>
  )
}
