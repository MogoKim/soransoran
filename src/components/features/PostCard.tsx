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
    /* 🔴 구분선을 여기서 긋지 않는다.
          이전에는 `border-b … last:border-b-0` 을 이 <a> 에 두었는데,
          <a> 는 감싸는 <li> 의 **유일한 자식**이라 `:last-child` 가 항상 참이었다.
          그래서 모든 행이 border-b-0 이 되어 **구분선이 한 줄도 그려지지 않았다.**
          선은 목록이 `[&>li+li]` 로 항목 사이에만 긋는다 — 마지막 예외가 필요 없어진다.

       가로 여백은 행이 가진다. 목록에 주면 hover 면이 눌리는 폭보다 좁아진다. */
    <Link
      href={`${boardHref}/${post.id}`}
      className="block px-4 py-[18px] no-underline transition-colors duration-150 hover:bg-surface-page active:bg-surface-soft"
    >
      <h3 className="m-0 line-clamp-2 break-keep font-bold leading-[1.4] text-content-primary">
        {post.title}
      </h3>

      {preview ? (
        <p className="m-0 mt-1.5 line-clamp-2 text-sm leading-[1.6] text-content-secondary">
          {preview}
        </p>
      ) : null}

      {/* 메타 두 줄은 한 덩어리다 — 본문과는 떨어지고 서로는 붙는다.
          이전 mt-4(16px)는 미리보기와 작성자 사이가 지표 사이보다 넓어
          두 줄이 서로 다른 정보처럼 흩어져 보였다. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-content-muted">
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
