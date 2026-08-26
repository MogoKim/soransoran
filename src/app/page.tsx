import Link from 'next/link'
import PageShell from '@/components/layouts/PageShell'
import PostListItem from '@/components/features/PostListItem'
import MagazineCard from '@/components/features/MagazineCard'
import HomeJoinCta from '@/components/features/HomeJoinCta'
import Logo from '@/components/brand/Logo'
import MenuIcon from '@/components/icons/MenuIcon'
import { auth } from '@/lib/auth'
import { getBoardBySlug, type BoardMeta } from '@/lib/board-registry'
import { getRecentDiscoveryPosts } from '@/lib/queries/posts'
import { getAllMagazineArticles } from '@/lib/magazine'
import type { MagazineArticle } from '@/content/magazine/types'

export const dynamic = 'force-dynamic'

/** 홈에 싣는 매거진 글 수. 더 실으면 가입 카드가 화면 밖으로 밀린다. */
const HOME_MAGAZINE_COUNT = 3

/**
 * 홈에 실을 글을 고른다 — 그림 있는 글이 먼저, 모자라면 최신 순으로 채운다.
 *
 * 🔴 목록(/magazine)의 최신순은 건드리지 않는다. 여기서만 앞뒤를 바꾼다.
 *    홈은 지나가는 사람을 붙드는 자리라 그림이 한 장도 없으면 지나쳐 버린다.
 *    목록은 찾아 들어온 사람이 보는 곳이라 최신순이 맞다.
 *
 * 두 갈래로 나눠 이어 붙인다. 한 배열을 정렬로 뒤집으면 그림 없는 글끼리의
 * 최신 순서가 정렬 안정성에 기대게 된다.
 */
function pickForHome(articles: MagazineArticle[], count: number): MagazineArticle[] {
  const withImage = articles.filter((a) => a.heroImage)
  const withoutImage = articles.filter((a) => !a.heroImage)
  return [...withImage, ...withoutImage].slice(0, count)
}

/**
 * 섹션 머리 — 아이콘 배지 · 제목 · 더보기.
 *
 * 🔴 색과 아이콘은 board-registry 가 정한다. 여기서 토큰명을 직접 쓰지 않는다.
 *    두 섹션이 각자 배지를 그리면 한쪽만 고쳐지는 날이 온다.
 */
function SectionHeading({
  board,
  title,
  moreHref,
}: {
  board: BoardMeta
  title: string
  moreHref: string
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="flex items-center gap-2 text-lg font-bold text-content-primary">
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]"
          style={{
            backgroundColor: `var(${board.iconBgVar})`,
            color: `var(${board.iconStrokeVar})`,
          }}
        >
          <MenuIcon name={board.icon} size={18} />
        </span>
        {title}
      </h2>
      <Link
        href={moreHref}
        className="inline-flex min-h-[52px] shrink-0 items-center text-sm text-link"
      >
        더보기 →
      </Link>
    </div>
  )
}

/**
 * 홈 — 첫 화면에서 "여기 사람이 있다"가 보여야 한다.
 * 브랜드 문구는 짧게 두고 실제 글을 위로 올린다.
 *
 * 🔴 접속자 수 / 실시간 배지 / 게시글 수를 넣지 않는다.
 *
 * 커뮤니티 글이 위, 매거진이 아래다. 참여가 먼저이고 읽을거리가 그다음이다.
 * 매거진 띠만 웜 아이보리를 깔아 흰 카드가 살아나게 한다 — 흰 바탕에 흰 카드는
 * 보더 한 줄로만 구분돼 목록으로 읽히지 않는다.
 */
export default async function HomePage() {
  const posts = await getRecentDiscoveryPosts(6)
  // 카드는 비로그인에게만 나간다. JWT 전략이라 auth() 는 쿠키 디코드뿐이다.
  const session = await auth()
  const articles = pickForHome(getAllMagazineArticles(), HOME_MAGAZINE_COUNT)
  const best = getBoardBySlug('best')!
  const magazine = getBoardBySlug('magazine')!

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
            <SectionHeading board={best} title="지금 뜨는 이야기" moreHref="/best" />

            <ol className="m-0 flex list-none flex-col p-0">
              {posts.map((post, index) => (
                <li key={post.id}>
                  <PostListItem post={post} rank={index + 1} />
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {articles.length > 0 ? (
          <section className="bg-surface-page px-4 py-6">
            <SectionHeading board={magazine} title="읽어볼 이야기" moreHref="/magazine" />

            <ul className="flex list-none flex-col gap-3 p-0">
              {articles.map((article) => (
                <li key={article.slug}>
                  <MagazineCard article={article} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <HomeJoinCta isLoggedIn={Boolean(session?.user)} />
      </main>
    </PageShell>
  )
}
