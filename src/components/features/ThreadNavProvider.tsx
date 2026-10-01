'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import CommentIcon from '@/components/icons/CommentIcon'
import { TOUCH_MIN } from '@/lib/spacing'
import { commentAnchorId } from '@/lib/comment-view'

/**
 * 댓글 대화 안에서 "어디로 갔다가 어디로 돌아오는가" 를 한 곳에서 안다.
 *
 *   · 답글 위의 "↳ 누구님에게 답글" 을 누르면 → 그 댓글로 이동 · 잠시 강조 · 포커스
 *   · "읽던 곳으로 돌아가기" → 누르기 전 페이지 위치와 원래 답글로
 *   · 댓글을 등록하면 → 새로 그려진 그 댓글로 이동 · 포커스
 *   · #comment-<id> 로 들어오면 → 그 댓글로
 *
 * 🔴 접힌 스레드 안의 댓글로 가야 하면 먼저 그 스레드를 편다(registerThread).
 * 🔴 강조 면은 몇 초 뒤 사라진다. 무슨 일이 있었는지는 글자(CommentStateBadge)가 남아서 말한다 —
 *    색만으로 말하지 않는다.
 */


type MarkKind = 'target' | 'back' | 'posted' | 'linked'
type Mark = { id: string; kind: MarkKind }

type ThreadNav = {
  mark: Mark | null
  jump: (fromId: string, toId: string) => void
  focusPosted: (id: string) => void
  /** 접힌 스레드가 자기 댓글 id 와 펴는 방법을 알린다. 정리 함수를 돌려준다 */
  registerThread: (threadId: string, ids: string[], reveal: () => void) => () => void
}

const ThreadNavContext = createContext<ThreadNav | null>(null)

export function useThreadNav(): ThreadNav | null {
  return useContext(ThreadNavContext)
}

const FLASH_MS = 2400
/** 등록 뒤 서버가 새 목록을 그려 올 때까지 기다리는 상한 */
const POSTED_WAIT_MS = 8000
const REVEAL_WAIT_MS = 1500

/**
 * 강조 면을 이 댓글 하나에만 켠다.
 * 🔴 앞서 켠 강조를 먼저 끈다 — 남아 있으면 상태 글자가 이미 옮겨 간 댓글에 색만 남는다.
 */
function flash(el: HTMLElement) {
  document.querySelectorAll<HTMLElement>('[data-flash]').forEach((other) => {
    if (other !== el) delete other.dataset.flash
  })
  el.dataset.flash = 'true'
  window.setTimeout(() => {
    if (el.dataset.flash === 'true') delete el.dataset.flash
  }, FLASH_MS)
}

function visibleComment(id: string): HTMLElement | null {
  const el = document.getElementById(commentAnchorId(id))
  if (!el || el.closest('[hidden]')) return null
  return el
}

export default function ThreadNavProvider({ children }: { children: ReactNode }) {
  const [mark, setMark] = useState<Mark | null>(null)
  const [returnTo, setReturnTo] = useState<{ id: string; scrollY: number } | null>(null)
  const threads = useRef(new Map<string, { ids: Set<string>; reveal: () => void }>())
  const waiting = useRef<number | null>(null)

  const registerThread = useCallback((threadId: string, ids: string[], reveal: () => void) => {
    threads.current.set(threadId, { ids: new Set(ids), reveal })
    return () => {
      threads.current.delete(threadId)
    }
  }, [])

  /** 댓글이 화면에 보일 때까지(펼침 · 서버 재렌더) 기다렸다가 fn 을 부른다 */
  const whenVisible = useCallback((id: string, limitMs: number, fn: (el: HTMLElement) => void) => {
    if (waiting.current !== null) cancelAnimationFrame(waiting.current)
    for (const t of threads.current.values()) if (t.ids.has(id)) t.reveal()
    const started = performance.now()
    const tick = () => {
      const el = visibleComment(id)
      if (el) {
        waiting.current = null
        fn(el)
        return
      }
      // 서버가 새 목록을 그린 뒤에야 접힌 스레드가 이 id 를 알게 되는 경우가 있다 — 다시 편다
      for (const t of threads.current.values()) if (t.ids.has(id)) t.reveal()
      if (performance.now() - started < limitMs) waiting.current = requestAnimationFrame(tick)
      else waiting.current = null
    }
    waiting.current = requestAnimationFrame(tick)
  }, [])

  const land = useCallback((el: HTMLElement, id: string, kind: MarkKind) => {
    el.scrollIntoView({ block: 'center' })
    el.focus({ preventScroll: true })
    flash(el)
    setMark({ id, kind })
  }, [])

  const jump = useCallback(
    (fromId: string, toId: string) => {
      setReturnTo({ id: fromId, scrollY: window.scrollY })
      whenVisible(toId, REVEAL_WAIT_MS, (el) => land(el, toId, 'target'))
    },
    [whenVisible, land],
  )

  const goBack = useCallback(() => {
    if (!returnTo) return
    const { id, scrollY } = returnTo
    setReturnTo(null)
    // 🔴 누르기 전 페이지 위치 그대로 — 다시 찾게 하지 않는다
    window.scrollTo(0, scrollY)
    const el = visibleComment(id)
    if (el) {
      el.focus({ preventScroll: true })
      flash(el)
    }
    setMark({ id, kind: 'back' })
  }, [returnTo])

  const focusPosted = useCallback(
    (id: string) => {
      setReturnTo(null)
      whenVisible(id, POSTED_WAIT_MS, (el) => land(el, id, 'posted'))
    },
    [whenVisible, land],
  )

  // 댓글 링크(#comment-<id>)로 들어오면 그 댓글로
  useEffect(() => {
    const m = /^#comment-([\w-]+)$/.exec(window.location.hash)
    if (m) whenVisible(m[1], REVEAL_WAIT_MS, (el) => land(el, m[1], 'linked'))
  }, [whenVisible, land])

  useEffect(() => () => {
    if (waiting.current !== null) cancelAnimationFrame(waiting.current)
  }, [])

  const value = useMemo<ThreadNav>(
    () => ({ mark, jump, focusPosted, registerThread }),
    [mark, jump, focusPosted, registerThread],
  )

  return (
    <ThreadNavContext.Provider value={value}>
      {children}
      {returnTo ? (
        /* 🔴 모바일 하단 작성 바(CommentDock) 위에 뜬다 — 겹치면 둘 다 못 누른다 */
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(max(8px,env(safe-area-inset-bottom))+84px)] z-40 flex justify-center px-4 md:bottom-6">
          <button
            type="button"
            onClick={goBack}
            aria-label="읽던 답글로 돌아가기"
            className={`pointer-events-auto inline-flex ${TOUCH_MIN} items-center gap-2 whitespace-nowrap rounded-xl border border-interactive bg-surface-card px-5 text-sm font-bold text-content-primary shadow-modal`}
          >
            <CommentIcon name="back" />
            읽던 곳으로 돌아가기
          </button>
        </div>
      ) : null}
    </ThreadNavContext.Provider>
  )
}

const MARK_LABEL: Record<MarkKind, string> = {
  target: '대상 댓글',
  back: '읽던 답글',
  posted: '방금 등록',
  linked: '링크한 댓글',
}

/** 방금 무슨 일이 이 댓글에 있었는지 글자로 남긴다 — 강조 면이 사라져도 남는다 */
export function CommentStateBadge({ commentId }: { commentId: string }) {
  const nav = useThreadNav()
  if (!nav?.mark || nav.mark.id !== commentId) return null
  return (
    <span className="whitespace-nowrap rounded border border-interactive px-1.5 font-bold text-content-secondary">
      {MARK_LABEL[nav.mark.kind]}
    </span>
  )
}
