import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import PageShell from '@/components/layouts/PageShell'
import CommentForm from '@/components/features/CommentForm'
import DeleteButton from '@/components/features/DeleteButton'
import CommentItem from '@/components/features/CommentItem'
import NextToRead from '@/components/features/NextToRead'
import { getPostLikeState } from '@/lib/queries/post-like'
import { getPostScrapState } from '@/lib/queries/post-scrap'
import PostActionBar from '@/components/features/PostActionBar'
import PostViewBeacon from '@/components/features/PostViewBeacon'
import WriteCta from '@/components/features/WriteCta'
import { auth } from '@/lib/auth'
import { getBoardBySlug } from '@/lib/board-registry'
import { loginHref } from '@/lib/callback-url'
import { formatRelativeTime } from '@/lib/date'
import { getPostDetail, getRecentDiscoveryPosts } from '@/lib/queries/posts'
import { isSearchIndexable, robotsMetaFor } from '@/lib/post-visibility'
import { displayName } from '@/lib/display-name'

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
  const description = indexable
    ? post.content.replace(/\s+/g, ' ').slice(0, 120)
    : undefined

  return {
    title: post.title,
    ...(description ? { description } : {}),
    // noindex 페이지의 canonical 값은 크롤러가 무시한다. 만들지 않는다.
    ...(indexable ? { alternates: { canonical: `${board.href}/${post.id}` } } : {}),
    ...(indexable
      ? { openGraph: { title: post.title, description, type: 'article' as const } }
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

  const { post, comments } = detail
  const session = await auth()
  // 현재 글이 pool 에 섞여 있을 수 있어 넉넉히 받아 NextToRead 가 걸러낸다.
  // 공감 상태는 getPostDetail 을 넓히지 않고 따로 읽는다 — 그 select 는 목록과 함께 쓴다.
  const [nextPosts, likeState, isScrapped] = await Promise.all([
    getRecentDiscoveryPosts(6),
    getPostLikeState(post.id, session?.user?.id),
    getPostScrapState(post.id, session?.user?.id),
  ])

  return (
    <PageShell>
      {/* 화면이 실제로 열린 뒤에만 조회를 알린다. 아무것도 그리지 않는다. */}
      <PostViewBeacon postId={post.id} />

      <main className="mx-auto max-w-3xl px-4 pb-16">
        <nav className="py-2">
          <Link
            href={board.href}
            className="inline-flex min-h-[52px] items-center text-sm text-link"
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

          <p className="mt-3 flex flex-wrap items-center gap-x-2 text-xs text-content-muted">
            <span className="font-bold text-brand-ink">{displayName(post.author)}</span>
            <span aria-hidden>·</span>
            <span>{formatRelativeTime(post.createdAt)}</span>
            <span aria-hidden>·</span>
            <span>조회 {post.viewCount}</span>
          </p>
          <div className="mt-5 whitespace-pre-wrap break-keep leading-[1.85] text-content-primary [overflow-wrap:anywhere]">
            {post.content}
          </div>
          {session?.user?.id === post.author.id ? (
            <div className="mt-6 flex items-center gap-3 border-t border-subtle pt-3">
              {/* 🔴 코랄 fill 을 쓰지 않는다. 여기는 글을 읽는 화면이고
                    수정·삭제는 필요할 때만 찾는 손잡이다. 삭제와 같은 무게로 둔다. */}
              <Link
                href={`${board.href}/${post.id}/edit`}
                className="inline-flex min-h-[52px] items-center px-3 text-sm text-content-muted underline"
              >
                수정
              </Link>
              <DeleteButton boardSlug={board.slug} postId={post.id} />
            </div>
          ) : null}
        </article>

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

        <section className="mt-8">
          <h2 className="text-lg font-bold text-content-primary">
            댓글 {comments.length}
          </h2>

          {comments.length === 0 ? (
            <div className="py-8 text-center">
              <p className="font-bold text-content-primary">아직 댓글이 없어요</p>
              <p className="mt-1 text-sm leading-relaxed text-content-muted">
                짧아도 괜찮습니다. 첫 마디를 남겨보세요.
              </p>
            </div>
          ) : (
            <ul className="my-4 flex list-none flex-col gap-3 p-0">
              {comments.map((comment) => (
                <CommentItem
                  key={comment.id}
                  comment={comment}
                  boardSlug={board.slug}
                  postId={post.id}
                  currentUserId={session?.user?.id}
                />
              ))}
            </ul>
          )}

          {session?.user ? (
            <CommentForm postId={post.id} boardSlug={board.slug} />
          ) : (
            /* 🔴 코랄 fill 을 쓰지 않는다. 아래 WriteCta 와 FAB 이 이미 코랄이라
                  같은 화면에 주 버튼이 셋이 되면 어느 것도 주가 아니게 된다.
                  여기는 보더로 자기를 알리는 자리다 (--border-interactive). */
            <div className="rounded-2xl border border-subtle bg-surface-card p-5 text-center">
              <p className="break-keep leading-relaxed text-content-primary">
                이 글을 읽고 든 생각을 한 줄로 남겨주세요.
              </p>
              <Link
                href={loginHref(`${board.href}/${post.id}`)}
                className="mt-4 inline-flex min-h-[52px] items-center rounded-lg border border-interactive px-6 font-bold text-brand-ink no-underline transition duration-150 hover:bg-surface-soft active:scale-[0.98]"
              >
                로그인하고 댓글 쓰기
              </Link>
              <p className="mt-2 text-xs leading-relaxed text-content-muted">
                로그인하면 읽던 글로 다시 돌아옵니다.
              </p>
            </div>
          )}
        </section>

        <NextToRead posts={nextPosts} currentPostId={post.id} />

        <WriteCta boardSlug={board.slug} isLoggedIn={Boolean(session?.user)} />
      </main>
    </PageShell>
  )
}
