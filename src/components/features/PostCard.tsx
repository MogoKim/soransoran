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

       🔴 hover 는 바탕 위에서 흰색으로 떠오른다.
          목록에 면이 없으므로 surface-page 를 쓰면 바탕색과 같아져 아무 일도 일어나지 않는다.
          방향만 반대일 뿐 대비는 같다 (정본 §7).

       가로 여백은 <main> 의 px-4 가 준다 — 여기서 또 주면 글자가 안쪽으로 밀린다. */
    <Link
      href={`${boardHref}/${post.id}`}
      className="block py-3 no-underline transition-colors duration-150 hover:bg-surface-card active:bg-surface-soft"
    >
      <h3 className="line-clamp-2 break-keep text-lg font-bold leading-[1.35] text-content-primary">
        {post.title}
      </h3>

      {/* 미리보기는 글의 일부다. 본문 크기(text-base 18px)와 줄간격을 줄이지 않는다.
          밀도는 padding·여백으로만 잡는다. */}
      {preview ? (
        <p className="mt-1.5 line-clamp-2 break-keep text-base text-content-secondary">
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
