import Link from 'next/link'
import StatIcon from '@/components/icons/StatIcon'
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
      className="block border-b border-subtle py-[18px] no-underline last:border-b-0"
    >
      <h3 className="m-0 line-clamp-2 font-bold leading-[1.4] text-content-primary">
        {post.title}
      </h3>

      {preview ? (
        <p className="m-0 mt-1.5 line-clamp-2 text-sm leading-[1.6] text-content-secondary">
          {preview}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-content-muted">
        <span>{post.author.name ?? '회원'}</span>
        <span aria-hidden>·</span>
        <span>{formatRelativeTime(post.createdAt)}</span>
      </div>

      <div className="mt-1.5 flex items-center gap-4 text-xs text-content-muted">
        <span className="flex items-center gap-1">
          <StatIcon name="comment" /> {commentCount}
        </span>
        <span className="flex items-center gap-1">
          <StatIcon name="eye" /> {post.viewCount}
        </span>
      </div>
    </Link>
  )
}
