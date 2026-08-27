import Link from 'next/link'
import { formatRelativeTime } from '@/lib/date'
import BoardBadge from '@/components/ui/board-badge'
import StatIcon from '@/components/icons/StatIcon'
import { getBoardByType } from '@/lib/board-registry'
import type { BoardType } from '@prisma/client'

export type PostListItemData = {
  id: string
  title: string
  boardType: BoardType
  createdAt: Date
  viewCount: number
  _count: { comments: number }
}

/** 홈 리스트 한 줄 — 순위 · 제목 · 보드 배지 · 통계. 미리보기는 싣지 않는다. */
export default function PostListItem({
  post,
  rank,
}: {
  post: PostListItemData
  rank: number
}) {
  const board = getBoardByType(post.boardType)
  if (!board) return null

  return (
    /* 🔴 구분선을 여기서 긋지 않는다 — PostCard 와 같은 이유다.
          `last:border-b-0` 은 <a> 가 <li> 의 유일한 자식이라 항상 참이었고,
          그래서 선이 한 줄도 그려지지 않았다. 목록이 `[&>li+li]` 로 사이에만 긋는다. */
    <Link
      href={`${board.href}/${post.id}`}
      className="flex min-h-[52px] items-start gap-3 px-4 py-3.5 no-underline transition-colors duration-150 hover:bg-surface-page active:bg-surface-soft"
    >
      <span className="w-8 shrink-0 text-center text-[22px] font-bold italic leading-none text-brand-ink">
        {rank}
      </span>

      <span className="flex min-w-0 flex-col gap-1.5">
        <span className="line-clamp-2 break-keep font-medium leading-[1.5] text-content-primary">
          {post.title}
        </span>
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-content-muted">
          <BoardBadge boardType={post.boardType} />
          <span className="flex items-center gap-1">
            <StatIcon name="comment" /> {post._count.comments}
          </span>
          <span className="flex items-center gap-1">
            <StatIcon name="eye" /> {post.viewCount}
          </span>
          <span>{formatRelativeTime(post.createdAt)}</span>
        </span>
      </span>
    </Link>
  )
}
