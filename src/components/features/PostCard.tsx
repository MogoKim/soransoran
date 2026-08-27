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
          이 <a> 는 감싸는 <li> 의 유일한 자식이라 `last:` 가 항상 참이 된다.
          한때 `border-b … last:border-b-0` 을 여기 두었다가 선이 한 줄도
          그려지지 않았다. 선은 목록이 `[&>li+li]` 로 항목 사이에만 긋는다.

       가로 여백도 행이 가진다. 목록에 주면 hover 면이 눌리는 폭보다 좁아진다. */
    <Link
      href={`${boardHref}/${post.id}`}
      className="block px-4 py-5 no-underline transition-colors duration-150 hover:bg-surface-page active:bg-surface-soft"
    >
      {/* 🔴 목록에서 먼저 읽히는 것은 제목이다. 한 단계 키운다 (text-lg = 20px).
             본문 크기(18px)와 같으면 제목이 미리보기와 같은 무게로 보여
             무엇을 먼저 읽어야 하는지가 흐려진다. */}
      <h3 className="m-0 line-clamp-2 break-keep text-lg font-bold leading-[1.35] text-content-primary">
        {post.title}
      </h3>

      {/* 미리보기도 한 단계 올린다 (text-base = 18px).
          16px 두 줄은 40~60대가 모바일에서 훑어 읽기에 작았다.
          줄간격은 text-base 토큰이 1.6 을 이미 준다 — 여기서 다시 적지 않는다. */}
      {preview ? (
        <p className="m-0 mt-2 line-clamp-2 break-keep text-base text-content-secondary">
          {preview}
        </p>
      ) : null}

      {/* 메타 두 줄은 한 덩어리다 — 본문과는 떨어지고 서로는 붙는다.
          글자가 커진 만큼 본문과의 사이도 함께 벌려 세 덩어리(제목·미리보기·메타)가
          각자 하나로 뭉쳐 보이게 한다. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-content-muted">
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
