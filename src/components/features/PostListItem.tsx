import Link from 'next/link'
import { formatRelativeTime } from '@/lib/date'
import BoardBadge from '@/components/ui/board-badge'
import StatIcon from '@/components/icons/StatIcon'
import { getBoardByType } from '@/lib/board-registry'
import { cn } from '@/lib/utils'
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
 * 리스트 한 줄 — 순위 · 제목 · 보드 배지 · 통계. 미리보기는 싣지 않는다.
 *
 * 🔴 두 화면이 이 한 줄을 나눠 쓴다 — 홈과 글 상세 하단(이어읽기).
 *    그래서 세 갈래를 prop 으로 열되 **기본값은 지금 화면 그대로**다.
 *    기본값을 바꾸면 넘기지 않은 쪽이 조용히 같이 변한다.
 *
 * 🔴 hover 는 면을 만들지 않는다. 제목만 브랜드색으로 반응한다.
 *    목록에 면이 없는데 가리킬 때만 네모가 생기면, 그 네모가 글보다 먼저 읽힌다.
 *
 * 🔴 surface 는 이 줄이 놓이는 면을 말한다. 지금은 모양을 정하지 않는다 —
 *    hover 가 면을 쓰지 않게 되어 대비를 뒤집을 일이 없어졌다.
 *
 * 🔴 hideEmptyStats 는 0 을 감출 뿐 숫자를 만들지 않는다.
 *    0 이 아닌 값은 언제나 그대로 나간다.
 */
export default function PostListItem({
  post,
  rank,
  surface = 'card',
  emphasis = false,
  hideEmptyStats = false,
}: {
  post: PostListItemData
  rank: number
  surface?: 'card' | 'page'
  emphasis?: boolean
  hideEmptyStats?: boolean
}) {
  const board = getBoardByType(post.boardType)
  if (!board) return null

  const showComments = !hideEmptyStats || post._count.comments > 0
  const showViews = !hideEmptyStats || post.viewCount > 0

  return (
    /* 🔴 구분선을 여기서 긋지 않는다 — PostCard 와 같은 이유다.
          `last:border-b-0` 은 <a> 가 <li> 의 유일한 자식이라 항상 참이었고,
          그래서 선이 한 줄도 그려지지 않았다. 목록이 `[&>li+li]` 로 사이에만 긋는다. */
    <Link
      href={`${board.href}/${post.id}`}
      data-surface={surface}
      className="group flex min-h-[52px] items-start gap-3 px-4 py-3.5 no-underline"
    >
      {/* 순번이 목록의 리듬을 만든다 — 굵기와 기울임은 여기 한 곳에만 둔다. */}
      <span className="w-8 shrink-0 text-center text-[22px] font-bold italic leading-none text-brand-ink">
        {rank}
      </span>

      <span className="flex min-w-0 flex-col gap-1.5">
        <span
          /* 강조 행은 크기만 키우고 굵기는 순번에 양보한다 — 한 줄에서 굵은 것은 하나면 된다.
             줄간격은 두 갈래에 각각 적는다 — 공통 자리에 두면 뒤따르는 글자 크기와
             충돌로 보고 지워진다. */
          className={cn(
            'line-clamp-2 break-keep font-medium text-content-primary',
            'transition-colors duration-150 group-hover:text-brand-ink group-active:text-brand-ink',
            emphasis ? 'text-lg leading-[1.5]' : 'leading-[1.5]',
          )}
        >
          {post.title}
        </span>
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-content-muted">
          <BoardBadge boardType={post.boardType} quiet={emphasis} />
          {showComments ? (
            <span className="flex items-center gap-1">
              <StatIcon name="comment" /> {post._count.comments}
            </span>
          ) : null}
          {showViews ? (
            <span className="flex items-center gap-1">
              <StatIcon name="eye" /> {post.viewCount}
            </span>
          ) : null}
          <span>{formatRelativeTime(post.createdAt)}</span>
        </span>
      </span>
    </Link>
  )
}
