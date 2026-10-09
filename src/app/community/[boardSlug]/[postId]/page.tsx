import type { Metadata } from 'next'
import { TOUCH_MIN } from '@/lib/spacing'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import PageShell from '@/components/layouts/PageShell'
import CommentSection from '@/components/features/CommentSection'
import DeleteButton from '@/components/features/DeleteButton'
import NextToRead from '@/components/features/NextToRead'
import { getPostLikeState } from '@/lib/queries/post-like'
import { getPostScrapState } from '@/lib/queries/post-scrap'
import { getLikedCommentIds } from '@/lib/queries/comment-like'
import PostActionBar from '@/components/features/PostActionBar'
import PostViewBeacon from '@/components/features/PostViewBeacon'
import SignupFunnelBoundary from '@/components/features/signup-funnel/SignupFunnelBoundary'
import SignupFunnelCommentsEnd from '@/components/features/signup-funnel/SignupFunnelCommentsEnd'
import SignupFunnelMarker from '@/components/features/signup-funnel/SignupFunnelMarker'
import SignupReturnHandler from '@/components/features/signup-funnel/SignupReturnHandler'
import WriteCta from '@/components/features/WriteCta'
import { getRequestSession } from '@/lib/request-session'
import { isSignupFunnelTracking } from '@/lib/signup-funnel-tracking'
import { SIGNUP_RETURN_ANCHORS } from '@/lib/signup-return'
import { getBoardBySlug } from '@/lib/board-registry'
import { formatRelativeTime } from '@/lib/date'
import { getPostDetail, getRecentDiscoveryPosts } from '@/lib/queries/posts'
import { isSearchIndexable, robotsMetaFor } from '@/lib/post-visibility'
import { displayName } from '@/lib/display-name'
import PostBody from '@/components/features/PostBody'
import { postContentToSummary } from '@/lib/post-html'
import { SCROLL_START_MARK } from '@/lib/comment-compose-bar'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: { boardSlug: string; postId: string }
}): Promise<Metadata> {
  const board = getBoardBySlug(params.boardSlug)
  const detail = await getPostDetail(params.postId)
  // 글이 실제로 속한 게시판이 아니면 canonical 을 만들지 않는다 — 같은 글이 두 URL 로 색인된다.
  if (!board || !detail || detail.post.boardType !== board.type) return {}

  const { post } = detail
  // 🔴 판정은 post-visibility 3축 함수가 유일한 지점이다 (C-2).
  //    여기서 status/isMicroSeed 를 직접 비교하지 마라.
  const indexable = isSearchIndexable(post)

  // 🔴 Micro Seed 는 본문을 description·OG 로 흘리지 않는다.
  //    원문 본문이 메타데이터로 구조화 노출되면 noindex 로도 막지 못한다.
  // 🔴 태그를 뺀 글자만 넣는다. 본문이 HTML 이 된 뒤로 그대로 자르면
  //    description 첫머리가 "<p><img src=..." 로 나간다 — 검색 결과에 그대로 보인다.
  const description = indexable
    ? postContentToSummary(post.content).slice(0, 120)
    : undefined

  // 공유 카드에 쓰는 절대 경로. canonical 과 같은 주소여야 한다 —
  // 카톡이 보여준 주소와 검색이 대표로 삼는 주소가 갈리면 같은 글이 둘로 읽힌다.
  const path = `${board.href}/${post.id}`

  return {
    title: post.title,
    ...(description ? { description } : {}),
    // noindex 페이지의 canonical 값은 크롤러가 무시한다. 만들지 않는다.
    ...(indexable ? { alternates: { canonical: path } } : {}),
    /* 🔴 openGraph 를 여기서 만들면 layout 것을 통째로 덮는다.
          images 를 적지 않으면 그 글만 그림 없는 카드가 된다 — 실측으로 잡은 문제다.
          (검색 비노출 글은 이 블록을 만들지 않아 layout 의 브랜드 카드를 그대로 받는다) */
    ...(indexable
      ? {
          openGraph: {
            title: post.title,
            description,
            type: 'article' as const,
            url: path,
            images: [{ url: `${path}/opengraph-image`, width: 1200, height: 630, alt: post.title }],
          },
        }
      : {}),
    // 🔴 접근은 허용하되 색인은 막는다. "접근 가능" 과 "색인 가능" 은 다른 축이다.
    robots: robotsMetaFor(post),
  }
}

export default async function PostDetailPage({
  params,
}: {
  params: { boardSlug: string; postId: string }
}) {
  const board = getBoardBySlug(params.boardSlug)
  if (!board || !board.isCommunity) notFound()

  const detail = await getPostDetail(params.postId)
  if (!detail || detail.post.boardType !== board.type) notFound()

  const { post, threads } = detail
  const session = await getRequestSession()
  // 회원가입 전환 — 수집 gate 가 열리고 로그인되지 않은 방문일 때만 tracker 와 감지 지점을 그린다.
  const tracking = await isSignupFunnelTracking()
  // 현재 글이 pool 에 섞여 있을 수 있어 넉넉히 받아 NextToRead 가 걸러낸다.
  // 공감 상태는 getPostDetail 을 넓히지 않고 따로 읽는다 — 그 select 는 목록과 함께 쓴다.
  const [nextPosts, likeState, isScrapped, likedCommentIds] = await Promise.all([
    getRecentDiscoveryPosts(6),
    getPostLikeState(post.id, session?.user?.id),
    getPostScrapState(post.id, session?.user?.id),
    // 댓글 수와 무관하게 한 번만 묻는다. 비로그인이면 DB 를 두드리지 않는다.
    // 답글 id 도 함께 넘긴다 — 답글에도 공감 버튼이 있다. 지운·차단 자리에는 공감이 없다.
    getLikedCommentIds(
      threads.flatMap((t) => [t.root, ...t.replies]).filter((c) => c.state === 'live').map((c) => c.id),
      session?.user?.id,
    ),
  ])

  return (
    <PageShell>
      {/* 화면이 실제로 열린 뒤에만 조회를 알린다. 아무것도 그리지 않는다. */}
      <PostViewBeacon postId={post.id} />
      {/* 가입 제안 인증 왕복에서 돌아온 순간만 일한다. gate · 로그인과 무관하게 늘 있다. 아무것도 그리지 않는다. */}
      <SignupReturnHandler contentType="community" />

      <SignupFunnelBoundary active={tracking} contentType="community">
        <main className="mx-auto max-w-3xl px-4 pb-16">
          {/* 🔴 글 맨 위를 가리키는 표시. 하단 댓글 바가 "여기서 얼마나 내려왔는지" 를 잰다.
                높이 0 이라 화면에는 아무것도 더하지 않는다. 지우면 짧은 글에서 바가
                첫 화면부터 뜬다(comment-compose-bar 의 SCROLL_START_GAP_PX 주석). */}
          <div {...{ [SCROLL_START_MARK]: '' }} aria-hidden />

          <nav className="py-2">
            <Link
              href={board.href}
              className={`inline-flex ${TOUCH_MIN} items-center text-sm text-link`}
            >
              ← {board.label}
            </Link>
          </nav>

          {/* 🔴 본문도 흰 면 위에 올린다.
              바탕이 중립 회색이 된 뒤, 상세만 바탕 위에 글자를 직접 두면
              서비스에서 가장 오래 읽는 화면이 유일하게 "종이 없는 화면" 이 된다.
              목록·매거진 카드와 같은 면을 써서 읽는 자리를 분명히 한다. */}
          <article className="rounded-2xl border border-subtle bg-surface-card px-4 py-5 sm:px-6 sm:py-6">
            <h1 className="text-2xl font-bold leading-snug text-content-primary">{post.title}</h1>

            <p className="mt-3 flex flex-wrap items-center gap-x-2 text-meta text-content-muted">
              <span className="font-bold text-brand-strong">{displayName(post.author)}</span>
              <span aria-hidden>·</span>
              <span>{formatRelativeTime(post.createdAt)}</span>
              <span aria-hidden>·</span>
              <span>조회 {post.viewCount}</span>
            </p>
            {/* 🔴 sanitize 는 PostBody 안에서 한다 — 이 화면이 잊을 수 있는 일이 아니게. */}
            <PostBody content={post.content} className="mt-5" />
            {session?.user?.id === post.author.id ? (
              <div className="mt-6 flex items-center gap-3 border-t border-subtle pt-3">
                {/* 🔴 코랄 fill 을 쓰지 않는다. 여기는 글을 읽는 화면이고
                      수정·삭제는 필요할 때만 찾는 손잡이다. 삭제와 같은 무게로 둔다. */}
                <Link
                  href={`${board.href}/${post.id}/edit`}
                  className={`inline-flex ${TOUCH_MIN} items-center px-3 text-sm text-content-muted underline`}
                >
                  수정
                </Link>
                <DeleteButton boardSlug={board.slug} postId={post.id} />
              </div>
            ) : null}
          </article>
          {/* 회원가입 전환 — 본문 끝 감지 지점. 높이 0 이라 화면에 아무것도 더하지 않는다. */}
          {tracking ? <SignupFunnelMarker kind="body-end" /> : null}

          {/* 🔴 행동 줄은 본문 밖에 둔다. 카드 안에 넣으면 글의 일부로 읽힌다 —
                여기는 다 읽은 뒤 무엇을 할지 고르는 자리다.
                신고는 여기 더보기 안으로 옮겼다. 글마다 신고 버튼이 상시 떠 있을 자리가 아니다. */}
          <PostActionBar
            postId={post.id}
            title={post.title}
            currentPath={`${board.href}/${post.id}`}
            isLoggedIn={Boolean(session?.user)}
            likeCount={likeState.likeCount}
            isLiked={likeState.isLiked}
            isScrapped={isScrapped}
          />

          {/* 가입 제안 복귀 위치(댓글 영역) — 로그인한 사람에게도 늘 있다. 높이 0 · 고정 헤더 아래로 멈춘다. */}
          <div id={SIGNUP_RETURN_ANCHORS.community} aria-hidden className="scroll-mt-40" />
          <CommentSection
            threads={threads}
            boardSlug={board.slug}
            postId={post.id}
            isLoggedIn={Boolean(session?.user)}
            currentUserId={session?.user?.id}
            likedCommentIds={likedCommentIds}
            afterComments={tracking ? <SignupFunnelCommentsEnd /> : undefined}
          />

          <NextToRead posts={nextPosts} currentPostId={post.id} />

          <WriteCta boardSlug={board.slug} />
        </main>
      </SignupFunnelBoundary>
    </PageShell>
  )
}
