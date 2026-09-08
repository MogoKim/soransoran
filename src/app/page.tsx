import Link from 'next/link'
import { TOUCH_MIN } from '@/lib/spacing'
import PageShell from '@/components/layouts/PageShell'
import PostListItem from '@/components/features/PostListItem'
import HomeMagazineRail from '@/components/features/HomeMagazineRail'
import HomeHero from '@/components/features/HomeHero'
import HomeJoinCta from '@/components/features/HomeJoinCta'
import FirstGreetingWidget from '@/components/features/greeting/first-greeting-widget'
import NewcomerGreetings from '@/components/features/greeting/newcomer-greetings'
import MenuIcon from '@/components/icons/MenuIcon'
import { auth } from '@/lib/auth'
import { getBoardBySlug, type BoardMeta } from '@/lib/board-registry'
import { getHomePopularPosts } from '@/lib/queries/posts'
import { getRecentGreetings, shouldShowFirstGreeting } from '@/lib/queries/greeting'
import { HOME_MAGAZINE_COUNT, HOME_POPULAR_COUNT } from '@/lib/home-exposure'
import { getAllMagazineArticles } from '@/lib/magazine'
import type { MagazineArticle } from '@/content/magazine/types'

export const dynamic = 'force-dynamic'

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
 * 🔴 색과 기본 아이콘은 board-registry 가 정한다. 여기서 토큰명을 직접 쓰지 않는다.
 *    다만 홈의 "지금 뜨는 이야기"는 베스트 방이 아니라 현재 인기 신호를 말하므로
 *    우나어와 같은 불 아이콘을 쓴다. /best와 상단 메뉴의 별 아이콘은 바꾸지 않는다.
 *
 * 🔴 갈 곳이 없으면 더보기를 그리지 않는다.
 *    눌렀는데 빈 화면이 나오는 링크는 없느니만 못하다.
 */
function SectionHeading({
  board,
  title,
  moreHref,
  trending = false,
}: {
  board: BoardMeta
  title: string
  moreHref?: string
  trending?: boolean
}) {
  return (
    <div
      /* 더보기 유무와 관계없이 홈 섹션 머리 높이를 맞춘다. */
      className="mb-3 flex min-h-[52px] items-center justify-between"
    >
      {/* 🔴 섹션 제목은 title 축이다. heading 축에 두면 "크게" 에서 32px 이 되어
          정작 읽을 글 제목(24px)보다 섹션 이름이 더 크게 선다. */}
      <h2 className="flex items-center gap-2 text-lg font-bold text-content-primary">
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]"
          style={{
            backgroundColor: `var(${board.iconBgVar})`,
            color: `var(${board.iconStrokeVar})`,
          }}
        >
          {trending ? (
            /* 🔴 24px 고정이다. 본문 글자 크기(작게·기본·크게)를 따라가지 않는다.
               이 이모지는 읽는 글이 아니라 배지 안의 장식 아이콘이고,
               바깥 배지가 32px 고정이라 글자를 키우면 배지를 밀고 나간다.
               text-xl 을 쓰면 --text-heading 을 상속해 기본에서 28px 이 된다 —
               같은 자리의 MenuIcon 은 18px 이고 우나어의 같은 배지는 24px 이다. */
            <span className="text-[24px] leading-none">🔥</span>
          ) : (
            <MenuIcon name={board.icon} size={18} />
          )}
        </span>
        {title}
      </h2>
      {moreHref ? (
        <Link
          href={moreHref}
          className={`inline-flex ${TOUCH_MIN} shrink-0 items-center text-sm font-medium text-link`}
        >
          더보기 →
        </Link>
      ) : null}
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
 *
 * 🔴 홈에 면을 따로 깔지 않는다.
 *    글 목록·매거진과 같은 바탕 위에 그대로 얹는다. 홈만 흰 판을 두면
 *    같은 서비스의 다른 화면으로 넘어갈 때마다 바닥색이 바뀐다.
 *    섹션은 머리글과 여백이 가르고, 줄 사이는 선 하나가 가른다.
 */
export default async function HomePage() {
  const posts = await getHomePopularPosts(HOME_POPULAR_COUNT)
  // 카드는 비로그인에게만 나간다. JWT 전략이라 auth() 는 쿠키 디코드뿐이다.
  const session = await auth()
  // 막 온 사람에게만 첫 인사를 권한다. 판정은 queries/greeting 이 한다.
  const showFirstGreeting = await shouldShowFirstGreeting(session?.user?.id)
  // 인사는 목록에도 인기글에도 안 나온다. 여기가 유일한 창구다.
  const greetings = await getRecentGreetings()
  const articles = pickForHome(getAllMagazineArticles(), HOME_MAGAZINE_COUNT)
  const best = getBoardBySlug('best')!
  const magazine = getBoardBySlug('magazine')!

  return (
    <PageShell showWriteFab>
      <main className="mx-auto max-w-3xl pb-16">
        <HomeHero />

        {showFirstGreeting ? <FirstGreetingWidget /> : null}

        {posts.length > 0 ? (
          <section className="px-4 py-5">
            <SectionHeading board={best} title="지금 뜨는 이야기" moreHref="/best" trending />

            {/* -mx-4 로 섹션 여백을 되돌린다 — 행이 자기 px-4 를 가지므로
                그대로 두면 32px 이 된다.
                구분선은 항목 사이에만 긋는다(마지막 예외를 둘 필요가 없다). */}
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
          </section>
        ) : null}

        {greetings.length > 0 ? <NewcomerGreetings greetings={greetings} /> : null}

        {articles.length > 0 ? (
          <section className="px-4 py-6">
            <SectionHeading board={magazine} title="읽어볼 이야기" moreHref="/magazine" />

            <HomeMagazineRail articles={articles} />
          </section>
        ) : null}

        <HomeJoinCta isLoggedIn={Boolean(session?.user)} />
      </main>
    </PageShell>
  )
}
