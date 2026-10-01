'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import CommentIcon from '@/components/icons/CommentIcon'
import { useThreadNav } from '@/components/features/ThreadNavProvider'
import { commentAnchorId } from '@/lib/comment-view'
import { TOUCH_MIN } from '@/lib/spacing'

/**
 * 원댓글 아래 대화선 하나 — 후속 답변 전부가 같은 들여쓰기로 선다.
 *
 * 🔴 깊이에 따라 여백이 늘지 않는다. 답글의 답글도 이 선 안 같은 자리다.
 * 🔴 긴 스레드는 이 선 **안에서** 접는다. 새 면·카드를 만들지 않는다.
 *    접힌 버튼은 대화 규모와 마지막 활동을 말한다 — "18개 중 3개 보는 중 · 마지막 답글 3분 전 · 박마음".
 * 🔴 펼치면 새로 나타난 첫 답글이 버튼이 있던 자리에 오고 포커스가 거기로 간다.
 *    접으면 원댓글과 "더 보기" 버튼이 함께 보이는 자리로 — 둘이 한 화면에 안 들어가면
 *    버튼을 화면 아래쪽에 두고 그 위 답글을 보인다. 포커스는 "더 보기" 버튼이다.
 * 🔴 숨긴 답글도 DOM 에 남는다(hidden). 대상 이동·등록 직후 포커스가 그 id 를 찾아 먼저 편다.
 */
export type ThreadReplyItem = { id: string; node: ReactNode }

export default function ThreadReplies({
  threadId,
  rootId,
  label,
  items,
  collapsible,
  preview,
  lastReply,
}: {
  threadId: string
  rootId: string
  label: string
  items: ThreadReplyItem[]
  collapsible: boolean
  preview: number
  /** "3분 전 · 박마음" — 서버가 시각을 글자로 만들어 넘긴다 */
  lastReply: string | null
}) {
  const nav = useThreadNav()
  const [expanded, setExpanded] = useState(false)
  const pending = useRef<{ kind: 'expand' | 'collapse'; top: number } | null>(null)
  const listId = `thread-${threadId}`
  const collapsed = collapsible && !expanded
  const hiddenCount = collapsed ? Math.max(0, items.length - preview) : 0
  const ids = items.map((i) => i.id).join(' ')

  // 대상 이동 · 등록 직후 포커스가 접힌 곳을 가리키면 먼저 편다
  useEffect(() => {
    if (!nav) return
    return nav.registerThread(threadId, ids.split(' '), () => setExpanded(true))
  }, [nav, threadId, ids])

  useLayoutEffect(() => {
    const p = pending.current
    if (!p) return
    pending.current = null
    if (p.kind === 'expand') {
      const first = document.getElementById(commentAnchorId(items[preview]?.id ?? ''))
      if (!first) return
      window.scrollBy(0, first.getBoundingClientRect().top - p.top)
      first.focus({ preventScroll: true })
      return
    }
    const root = document.getElementById(commentAnchorId(rootId))
    const toggle = document.getElementById(`${listId}-more`)
    if (!root || !toggle) return
    const vh = window.innerHeight
    const rootTop = root.getBoundingClientRect().top + window.scrollY
    const toggleBottom = toggle.getBoundingClientRect().bottom + window.scrollY
    window.scrollTo(0, toggleBottom - rootTop + 32 <= vh ? rootTop - 16 : toggleBottom - vh + 96)
    toggle.focus({ preventScroll: true })
  }, [expanded, items, preview, rootId, listId])

  const toggle = (e: React.MouseEvent<HTMLButtonElement>, next: boolean) => {
    pending.current = { kind: next ? 'expand' : 'collapse', top: e.currentTarget.getBoundingClientRect().top }
    setExpanded(next)
  }

  const last = items.length - 1

  return (
    <ul
      id={listId}
      aria-label={label}
      className="m-0 mt-2 flex list-none flex-col gap-1.5 border-l-2 border-subtle p-0 pl-3.5"
    >
      {items.map((item, i) => (
        <li key={item.id} hidden={collapsed && i >= preview}>
          {item.node}
        </li>
      ))}
      {collapsed && hiddenCount > 0 ? (
        <li>
          <button
            id={`${listId}-more`}
            type="button"
            onClick={(e) => toggle(e, true)}
            aria-expanded={false}
            aria-controls={listId}
            aria-label={`답글 ${hiddenCount}개 더 보기. 전체 ${items.length}개 중 ${preview}개 보는 중${lastReply ? `. 마지막 답글 ${lastReply}` : ''}`}
            className={`-ml-2 grid ${TOUCH_MIN} grid-cols-[auto_minmax(0,1fr)] items-center gap-x-1.5 rounded-lg px-2 py-1.5 text-left`}
          >
            <span className="text-brand-strong">
              <CommentIcon name="expand" />
            </span>
            <span className="text-sm font-bold text-brand-strong">답글 {hiddenCount}개 더 보기</span>
            <span className="col-start-2 text-meta leading-[1.4] text-content-muted">
              <span className="block">
                {items.length}개 중 {preview}개 보는 중
              </span>
              {lastReply ? (
                <span className="block break-keep [overflow-wrap:anywhere]">마지막 답글 {lastReply}</span>
              ) : null}
            </span>
          </button>
        </li>
      ) : null}
      {collapsible && expanded && last >= preview ? (
        <li>
          <button
            type="button"
            onClick={(e) => toggle(e, false)}
            aria-expanded
            aria-controls={listId}
            aria-label={`답글 접기. 지금 ${items.length}개 모두 보는 중`}
            className={`-ml-2 grid ${TOUCH_MIN} grid-cols-[auto_minmax(0,1fr)] items-center gap-x-1.5 rounded-lg px-2 py-1.5 text-left`}
          >
            <span className="text-brand-strong">
              <CommentIcon name="collapse" />
            </span>
            <span className="text-sm font-bold text-brand-strong">답글 접기</span>
            <span className="col-start-2 text-meta leading-[1.4] text-content-muted">
              <span className="block">{items.length}개 모두 보는 중</span>
              <span className="block">접으면 처음 {preview}개만 남아요</span>
            </span>
          </button>
        </li>
      ) : null}
    </ul>
  )
}
