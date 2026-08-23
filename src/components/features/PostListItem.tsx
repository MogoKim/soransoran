import Link from 'next/link'
import { formatRelativeTime } from '@/lib/date'
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

/**
 * 홈용 한 줄 항목 — 목록 카드(PostCard)보다 밀도가 높다.
 * 첫 화면에 글이 여러 개 보이는 것이 목적이라 미리보기를 싣지 않는다.
 */
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
    <Link
      href={`${board.href}/${post.id}`}
      className="flex min-h-[64px] items-start gap-3 border-b border-subtle py-3 no-underline last:border-b-0"
    >
      <span className="w-6 shrink-0 text-center text-lg font-bold italic text-brand-ink">
        {rank}
      </span>

      <span className="flex min-w-0 flex-col gap-1">
        <span className="line-clamp-2 font-bold leading-snug text-content-primary">
          {post.title}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 text-xs text-content-muted">
          <span
            className="rounded-full px-2 py-0.5 font-bold"
            style={{
              backgroundColor: `var(${board.iconBgVar})`,
              color: `var(${board.iconStrokeVar})`,
            }}
          >
            {board.label}
          </span>
          <span>댓글 {post._count.comments}</span>
          <span aria-hidden>·</span>
          <span>조회 {post.viewCount}</span>
          <span aria-hidden>·</span>
          <span>{formatRelativeTime(post.createdAt)}</span>
        </span>
      </span>
    </Link>
  )
}
