import Link from 'next/link'
import PageShell from '@/components/layouts/PageShell'
import PostListItem from '@/components/features/PostListItem'
import HomeJoinCta from '@/components/features/HomeJoinCta'
import Logo from '@/components/brand/Logo'
import MenuIcon from '@/components/icons/MenuIcon'
import { auth } from '@/lib/auth'
import { getBoardBySlug } from '@/lib/board-registry'
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
  // 카드는 비로그인에게만 나간다. JWT 전략이라 auth() 는 쿠키 디코드뿐이다.
  const session = await auth()
  // 섹션 아이콘의 색과 모양은 board-registry 가 정한다. 여기서 토큰명을 직접 쓰지 않는다.
  const best = getBoardBySlug('best')!

  return (
    <PageShell>
      <main className="mx-auto max-w-3xl bg-surface-card pb-24">
        <section className="px-4 py-6 text-center">
          <Logo className="text-3xl" />
          <p className="mt-2 text-sm text-content-muted">
            40대 50대 여성이 갱년기와 사는 이야기를 나누는 곳
          </p>
        </section>

        {posts.length > 0 ? (
          <section className="border-t-4 border-surface-page px-4 py-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-bold text-content-primary">
                <span
                  aria-hidden
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]"
                  style={{
                    backgroundColor: `var(${best.iconBgVar})`,
                    color: `var(${best.iconStrokeVar})`,
                  }}
                >
                  <MenuIcon name={best.icon} size={18} />
                </span>
                지금 뜨는 이야기
              </h2>
              <Link
                href="/best"
                className="inline-flex min-h-[52px] shrink-0 items-center text-sm text-link"
              >
                더보기 →
              </Link>
            </div>

            <ol className="m-0 flex list-none flex-col p-0">
              {posts.map((post, index) => (
                <li key={post.id}>
                  <PostListItem post={post} rank={index + 1} />
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <HomeJoinCta isLoggedIn={Boolean(session?.user)} />
      </main>
    </PageShell>
  )
}
