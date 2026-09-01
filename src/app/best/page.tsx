import PageShell from '@/components/layouts/PageShell'
import EmptyState from '@/components/layouts/EmptyState'
import ListHeader from '@/components/ui/list-header'
import PostListItem from '@/components/features/PostListItem'
import { getBoardBySlug } from '@/lib/board-registry'
import { getPopularDiscoveryPosts } from '@/lib/queries/posts'

import type { Metadata } from 'next'

// 인기 점수는 시간이 지나면 값이 달라진다. 요청 시점 기준으로 계산해야 한다.
export const dynamic = 'force-dynamic'

/**
 * 한 페이지에 싣는 글 수.
 *
 * 20 개만 보여주는 화면이 아니라 페이지 하나의 크기다. 뒤 페이지는 아직 없다 —
 * 넘기는 버튼은 서버가 실제로 page 를 처리하게 된 뒤에 붙인다.
 */
const BEST_PAGE_SIZE = 20

export const metadata: Metadata = {
  title: '베스트',
  // layout 의 canonical:'/' 를 상속하면 홈의 복제로 잡힌다. 개별 경로로 고정한다.
  alternates: { canonical: '/best' },
  // 첫 페이지가 홈 인기글과 같은 글로 채워진다 — 지금 색인시키면 홈의 복제로 잡힌다.
  // 목록이 홈과 갈라진 뒤에 다시 판단한다. 메뉴 링크는 따라갈 수 있게 둔다.
  robots: { index: false, follow: true },
}

/**
 * 베스트 — 순수 인기글 모아보기.
 *
 * 🔴 getPopularDiscoveryPosts 를 쓴다. getHomePopularPosts 가 아니다.
 *    홈 운영 큐레이션(PIN·HIDE)은 홈(/) 과 /admin/home 의 것이고,
 *    여기는 점수만으로 줄을 세운다 — 운영자가 홈에 고정한 글이
 *    베스트 상단에 따라 올라오면 "베스트"가 거짓말이 된다.
 *
 * 점수·제외 규칙(Micro Seed · 첫 인사 · 차단 사용자)과 갱년기톡 최소 노출은
 * 홈과 같은 함수가 책임진다. 갈라지는 것은 노출 예외 한 겹뿐이다.
 */
export default async function BestPage() {
  const board = getBoardBySlug('best')!
  const posts = await getPopularDiscoveryPosts(BEST_PAGE_SIZE)

  return (
    <PageShell>
      <main className="mx-auto max-w-3xl px-4 pb-16">
        <ListHeader board={board} />

        {posts.length === 0 ? (
          // 베스트는 모아보기 영역이다. 글쓰기 진입점을 두지 않는다.
          <EmptyState title={board.emptyTitle} body={board.emptyBody} />
        ) : (
          /* -mx-4 로 바깥 여백을 되돌린다 — 행이 자기 px-4 를 가지므로
             그대로 두면 32px 이 된다.
             구분선은 항목 사이에만 긋는다. */
          <ol className="m-0 -mx-4 flex list-none flex-col p-0 [&>li+li]:border-t [&>li+li]:border-subtle">
            {posts.map((post, index) => (
              <li key={post.id}>
                <PostListItem
                  post={post}
                  rank={index + 1}
                  surface="page"
                  emphasis
                  hideEmptyStats
                />
              </li>
            ))}
          </ol>
        )}
      </main>
    </PageShell>
  )
}
