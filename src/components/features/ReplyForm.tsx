'use client'

import { useEffect, useRef } from 'react'
import CommentForm from '@/components/features/CommentForm'
import { TOUCH_MIN } from '@/lib/spacing'
import GuestCommentForm from '@/components/features/GuestCommentForm'
import { useComposeMode } from '@/components/features/ComposeModeProvider'
import type { ReplyTargetInfo } from '@/components/features/ReplyTargetHeader'

/**
 * 살아 있는 모든 댓글 아래의 "답글" — 원댓글이든 답글이든 같다(깊이 제한 없음).
 *
 * 🔴 한 번에 작성칸 하나만 연다(ComposeModeProvider.openParentId).
 * 🔴 취소(버튼 · Esc)하면 포커스가 이 "답글" 버튼으로 돌아온다 — 키보드 사용자가 제자리를 잃지 않게.
 * 🔴 등록되면 작성칸을 닫고, 포커스는 새 답글로 간다(폼이 ThreadNav 에 알린다).
 * 🔴 모바일 키보드가 올라와 화면이 줄면 작성칸 전체(받는 사람 · 원문 · 버튼)를 보이는 곳으로 올린다.
 */
export default function ReplyForm({
  postId,
  boardSlug,
  parentId,
  isLoggedIn,
  target,
}: {
  postId: string
  boardSlug: string
  parentId: string
  isLoggedIn: boolean
  target: ReplyTargetInfo
}) {
  const { openParentId, setOpenParentId } = useComposeMode()
  const open = openParentId === parentId
  const buttonRef = useRef<HTMLButtonElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef(false)

  useEffect(() => {
    if (!open && returnFocus.current) {
      returnFocus.current = false
      buttonRef.current?.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const box = boxRef.current
    if (!box) return
    const keepVisible = () => {
      const vv = window.visualViewport
      const visible = vv ? vv.height : window.innerHeight
      const r = box.getBoundingClientRect()
      if (r.bottom > visible - 8) window.scrollBy(0, r.height <= visible - 16 ? r.bottom - visible + 8 : r.top - 8)
    }
    box.querySelector('textarea')?.focus({ preventScroll: true })
    keepVisible()
    window.visualViewport?.addEventListener('resize', keepVisible)
    return () => window.visualViewport?.removeEventListener('resize', keepVisible)
  }, [open])

  const cancel = () => {
    returnFocus.current = true
    setOpenParentId(null)
  }

  if (!open) {
    return (
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpenParentId(parentId)}
        aria-expanded={false}
        aria-label={`${target.name}님 댓글에 답글 쓰기`}
        className={`inline-flex ${TOUCH_MIN} min-w-[52px] items-center justify-center rounded-lg px-2 text-sm text-content-muted transition duration-150 hover:text-brand-strong active:scale-[0.98]`}
      >
        답글
      </button>
    )
  }

  return (
    <div
      ref={boxRef}
      className="mt-2 w-full"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          cancel()
        }
      }}
    >
      {/* 입력은 만들지 않고 댓글 폼을 그대로 부른다 — 확인 절차·비밀번호·글자수는 그쪽 규칙이다. */}
      {isLoggedIn ? (
        <CommentForm
          postId={postId}
          boardSlug={boardSlug}
          parentId={parentId}
          replyTarget={target}
          onPosted={() => setOpenParentId(null)}
        />
      ) : (
        <GuestCommentForm
          postId={postId}
          boardSlug={boardSlug}
          parentId={parentId}
          replyTarget={target}
          onPosted={() => setOpenParentId(null)}
        />
      )}
      <button
        type="button"
        onClick={cancel}
        className={`mt-1 inline-flex ${TOUCH_MIN} min-w-[52px] items-center px-2 text-sm text-content-muted`}
      >
        그만두기
      </button>
    </div>
  )
}
