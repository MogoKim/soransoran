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
    /* 구분선은 목록이 `[&>li+li]` 로 긋는다. 이 <a> 는 <li> 의 유일한 자식이라
       `last:` 가 항상 참이 되어, 여기 두면 선이 한 줄도 그려지지 않는다.
       가로 여백도 행이 가진다 — 목록에 주면 hover 면이 눌리는 폭보다 좁아진다. */
    <Link
      href={`${boardHref}/${post.id}`}
      className="block px-4 py-3 no-underline transition-colors duration-150 hover:bg-surface-page active:bg-surface-soft"
    >
      <h3 className="m-0 line-clamp-2 break-keep text-lg font-bold leading-[1.35] text-content-primary">
        {post.title}
      </h3>

      {/* 미리보기는 글의 일부다. 본문 크기(text-base 18px)와 줄간격을 줄이지 않는다.
          밀도는 padding·여백으로만 잡는다. */}
      {preview ? (
        <p className="m-0 mt-1.5 line-clamp-2 break-keep text-base text-content-secondary">
          {preview}
        </p>
      ) : null}

      {/* 메타는 한 줄이다 — 두 줄이면 화면당 글이 한 건 덜 들어온다.
          작성자·시간을 한 span 으로 묶어, 줄이 바뀌어도 "누가"와 "언제"가 갈라지지 않게 한다. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-content-muted">
        <span className="flex items-center gap-1.5">
          {post.author.name ?? '회원'}
          <span aria-hidden>·</span>
          {formatRelativeTime(post.createdAt)}
        </span>
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
