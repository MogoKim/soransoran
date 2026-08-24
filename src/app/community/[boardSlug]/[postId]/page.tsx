import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import PageShell from '@/components/layouts/PageShell'
import CommentForm from '@/components/features/CommentForm'
import ReportButton from '@/components/features/ReportButton'
import DeleteButton from '@/components/features/DeleteButton'
import CommentItem from '@/components/features/CommentItem'
import { auth } from '@/lib/auth'
import { getBoardBySlug } from '@/lib/board-registry'
import { formatRelativeTime } from '@/lib/date'
import { getPostDetail } from '@/lib/queries/posts'
import { isSearchIndexable, robotsMetaFor } from '@/lib/post-visibility'

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

  return (
    <PageShell>
      <main className="mx-auto max-w-3xl px-4 pb-16">
        <nav className="py-2">
          <Link
            href={board.href}
            className="inline-flex min-h-[52px] items-center text-sm text-link"
          >
            ← {board.label}
          </Link>
        </nav>

        <article className="pb-6">
          <h1 className="text-2xl font-bold leading-snug text-content-primary">{post.title}</h1>

          <p className="mt-3 flex flex-wrap items-center gap-x-2 text-xs text-content-muted">
            <span className="font-bold text-brand-ink">{post.author.name ?? '회원'}</span>
            <span aria-hidden>·</span>
            <span>{formatRelativeTime(post.createdAt)}</span>
            <span aria-hidden>·</span>
            <span>조회 {post.viewCount}</span>
          </p>
          <div className="mt-5 whitespace-pre-wrap break-keep leading-[1.85] text-content-primary [overflow-wrap:anywhere]">
            {post.content}
          </div>
          {session?.user ? (
            <div className="mt-6 flex items-center gap-3 border-t border-subtle pt-3">
              {session.user.id === post.author.id ? (
                <DeleteButton boardSlug={board.slug} postId={post.id} />
              ) : (
                <ReportButton postId={post.id} />
              )}
            </div>
          ) : null}
        </article>

        <section className="mt-8">
          <h2 className="text-lg font-bold text-content-primary">
            댓글 {comments.length}
          </h2>

          {comments.length === 0 ? (
            <p className="py-6 text-sm text-content-muted">
              첫 댓글을 남겨보세요. 짧아도 괜찮습니다.
            </p>
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
            <p className="text-sm text-content-muted">
              <Link
                href="/login"
                className="inline-flex min-h-[52px] items-center text-link"
              >
                로그인
              </Link>
              하면 댓글을 남길 수 있습니다.
            </p>
          )}
        </section>
      </main>
    </PageShell>
  )
}
