'use client'

import { Fragment, useMemo, useState, type ReactNode } from 'react'
import ReplyOpenProvider from '@/components/features/ReplyOpenProvider'

type Sort = 'oldest' | 'likes'

export type SortableCommentItem = {
  id: string
  likeCount: number
  /** 서버가 이미 그려 놓은 댓글 한 줄. 여기서는 순서만 바꾼다. */
  node: ReactNode
}

const TAB =
  'inline-flex min-h-[52px] items-center rounded-full px-4 text-sm transition duration-150 active:scale-[0.98]'
const TAB_ON = `${TAB} border border-interactive bg-surface-soft font-bold text-brand-ink`
const TAB_OFF = `${TAB} border border-transparent text-content-muted hover:text-brand-ink`

/**
 * 🔴 서버가 그린 댓글을 받아 순서만 바꾼다. 여기서 다시 그리지 않는다 —
 *    CommentItem 을 client 로 끌어오면 이름·시간·배지까지 브라우저로 따라온다.
 *    정렬은 이미 받아 둔 배열 안에서 끝나므로 DB 를 다시 읽지 않는다.
 */
export default function SortableCommentList({
  items,
  showTabs,
  listClassName,
}: {
  items: SortableCommentItem[]
  showTabs: boolean
  listClassName: string
}) {
  const [sort, setSort] = useState<Sort>('oldest')

  const sorted = useMemo(() => {
    if (sort === 'oldest') return items
    // sort 는 안정 정렬이라 공감 수가 같으면 등록순이 그대로 남는다
    return [...items].sort((a, b) => b.likeCount - a.likeCount)
  }, [items, sort])

  return (
    <>
      {showTabs ? (
        <div className="mt-3 flex items-center gap-1">
          <button
            type="button"
            onClick={() => setSort('oldest')}
            aria-pressed={sort === 'oldest'}
            className={sort === 'oldest' ? TAB_ON : TAB_OFF}
          >
            등록순
          </button>
          <button
            type="button"
            onClick={() => setSort('likes')}
            aria-pressed={sort === 'likes'}
            className={sort === 'likes' ? TAB_ON : TAB_OFF}
          >
            공감순
          </button>
        </div>
      ) : null}

      {/* CommentItem 이 <li> 를 그린다 — Fragment 로 감싸 <li> 가 <ul> 의 직계로 남게 한다.
          한 겹이라도 끼면 목록이 사이에 긋는 구분선(`[&>li+li]`)이 걸리지 않는다. */}
      <ReplyOpenProvider>
        <ul className={listClassName}>
          {sorted.map((item) => (
            <Fragment key={item.id}>{item.node}</Fragment>
          ))}
        </ul>
      </ReplyOpenProvider>
    </>
  )
}
