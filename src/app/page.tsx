import Link from 'next/link'
import PageShell from '@/components/layouts/PageShell'
import PostListItem from '@/components/features/PostListItem'
import Logo from '@/components/brand/Logo'
import { COMMUNITY_BOARDS } from '@/lib/board-registry'
import { getRecentDiscoveryPosts } from '@/lib/queries/posts'

export const dynamic = 'force-dynamic'

/**
 * 홈 — 첫 화면에서 "여기 사람이 있다"가 보여야 한다.
 * 브랜드 문구는 짧게 두고 실제 글을 위로 올린다.
 *
 * 🔴 접속자 수 / 실시간 배지 / 게시글 수를 넣지 않는다.
 */
export default async function HomePage() {
  const posts = await getRecentDiscoveryPosts(6)

  return (
    <PageShell>
      {/* 섹션마다 흰 블록을 두고 그 사이로 페이지 바탕이 비치게 한다.
          바탕색을 화면 전체에 그대로 두면 어디까지가 한 덩어리인지 읽히지 않는다. */}
      <main className="mx-auto flex max-w-3xl flex-col gap-2 pb-24">
        <section className="bg-surface-card px-4 py-6 text-center sm:rounded-lg">
          <Logo className="text-3xl" />
          <p className="mt-2 text-sm text-content-muted">
            40대 50대 여성이 갱년기와 사는 이야기를 나누는 곳
          </p>
        </section>

        {posts.length > 0 ? (
          <section className="bg-surface-card px-4 py-5 sm:rounded-lg">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-content-primary">지금 올라온 이야기</h2>
              <Link
                href={COMMUNITY_BOARDS[0].href}
                className="inline-flex min-h-[52px] items-center text-sm text-link"
              >
                더보기 →
              </Link>
            </div>

            <ul className="mt-1 flex list-none flex-col p-0">
              {posts.map((post, index) => (
                <li key={post.id}>
                  <PostListItem post={post} rank={index + 1} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* 게시판은 카드가 이미 흰색이다. 섹션까지 흰색으로 덮으면 카드가 묻힌다 */}
        <section className="mt-4 flex flex-col gap-3 px-4">
          {COMMUNITY_BOARDS.map((board) => (
            <Link
              key={board.type}
              href={board.href}
              className="flex min-h-[64px] items-center justify-between rounded-lg border border-subtle bg-surface-card px-5 py-4 no-underline"
            >
              <span className="font-bold text-content-primary">{board.label}</span>
              <span className="text-sm text-content-muted">바로가기 →</span>
            </Link>
          ))}
        </section>
      </main>
    </PageShell>
  )
}
