import Link from 'next/link'
import { formatRelativeTime, toPreview } from '@/lib/date'

export type PostCardData = {
  id: string
  title: string
  content: string
  createdAt: Date
  viewCount: number
  author: { name: string | null }
  _count: { comments: number }
}

type PostCardProps = {
  post: PostCardData
  boardHref: string
}

export default function PostCard({ post, boardHref }: PostCardProps) {
  const preview = toPreview(post.content)
  const commentCount = post._count.comments

  return (
    <Link
      href={`${boardHref}/${post.id}`}
      className="flex min-h-[88px] flex-col justify-center rounded-lg border border-subtle bg-surface-card p-4 no-underline"
    >
      <h3 className="m-0 line-clamp-2 text-lg font-bold leading-snug text-content-primary">
        {post.title}
      </h3>

      {preview ? (
        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-content-secondary">
          {preview}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-2 text-xs text-content-muted">
        <span>{post.author.name ?? '회원'}</span>
        <span aria-hidden>·</span>
        <span>{formatRelativeTime(post.createdAt)}</span>
        {commentCount > 0 ? (
          <>
            <span aria-hidden>·</span>
            <span className="font-bold text-brand-ink">댓글 {commentCount}</span>
          </>
        ) : null}
        <span aria-hidden>·</span>
        <span>조회 {post.viewCount}</span>
      </div>
    </Link>
  )
}
