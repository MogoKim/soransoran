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
import { getPostDetail } from '@/lib/queries/posts'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: { boardSlug: string; postId: string }
}): Promise<Metadata> {
  const board = getBoardBySlug(params.boardSlug)
  const detail = await getPostDetail(params.postId)
  if (!board || !detail) return {}

  const { post } = detail
  const description = post.content.replace(/\s+/g, ' ').slice(0, 120)

  return {
    title: post.title,
    description,
    alternates: { canonical: `${board.href}/${post.id}` },
    openGraph: { title: post.title, description, type: 'article' },
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
  if (!detail) notFound()

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

        <article className="rounded-lg border border-subtle bg-surface-card p-5">
          <h1 className="text-xl font-bold text-content-primary">{post.title}</h1>
          <p className="mt-1 text-xs text-content-muted">{post.author.name ?? '회원'}</p>
          <div className="mt-4 whitespace-pre-wrap break-keep leading-[1.85] text-content-primary [overflow-wrap:anywhere]">
            {post.content}
          </div>
          {session?.user ? (
            <div className="mt-4 flex items-center gap-3 border-t border-subtle pt-3">
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
