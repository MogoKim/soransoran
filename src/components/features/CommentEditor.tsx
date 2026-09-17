'use client'

import { useEffect, useRef, useState } from 'react'
import { TOUCH_MIN } from '@/lib/spacing'
import { usePathname } from 'next/navigation'
import { useFormState } from 'react-dom'
import ActionButton from '@/components/ui/ActionButton'
import DeleteButton from '@/components/features/DeleteButton'
import { useAutoResize } from '@/lib/use-auto-resize'
import { useSubmitGuard } from '@/lib/use-submit-guard'
import { useComposeLock } from '@/components/features/ComposeModeProvider'
import { updateComment, type CommentActionState } from '@/lib/actions/comments'
import OnboardingNotice from '@/components/features/onboarding/onboarding-notice'
import { useToast } from '@/components/ui/toast'
import {
  COMMENT_TEXTAREA_MAX_HEIGHT,
  COMMENT_UPDATED,
  MAX_COMMENT_LENGTH,
  MIN_COMMENT_LENGTH,
} from '@/lib/comment-policy'

/**
 * 본인 댓글의 읽기 ↔ 고치기 전환
 *
 * 🔴 읽기 모드의 본문을 여기서 다시 그리지 않는다.
 *    서버가 그린 것을 children 으로 받아 그대로 보여준다.
 *    같은 문단을 두 곳에서 그리면 한쪽만 고쳐지는 날이 온다.
 *
 * 🔴 CommentForm 을 재사용하지 않는다.
 *    그쪽은 "새로 남기기" 라 비우고 성공 문구를 띄우는 것이 일이고,
 *    이쪽은 "고쳐 두기" 라 채운 채로 시작해 닫히는 것이 일이다.
 *
 * 🔴 삭제 UX 는 건드리지 않는다. DeleteButton 을 그대로 옆에 둔다.
 */
export default function CommentEditor({
  commentId,
  postId,
  boardSlug,
  initialContent,
  children,
}: {
  commentId: string
  postId: string
  boardSlug: string
  initialContent: string
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const toast = useToast()
  const [state, formAction] = useFormState<CommentActionState, FormData>(updateComment, {})
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(initialContent)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useAutoResize(textareaRef, content, COMMENT_TEXTAREA_MAX_HEIGHT)

  /** 🔴 등록 폼과 같은 연타 차단을 쓴다 */
  const { guardSubmit } = useSubmitGuard(state)

  /**
   * 🔴 고치는 동안에는 하단 작성 바가 비킨다.
   *    이 화면에 작성할 자리가 둘이면, 쓴 글이 어디로 가는지 알 수 없다.
   */
  useComposeLock(editing)

  /**
   * 저장이 끝나면 닫는다. 바뀐 본문은 서버가 다시 그려 준다.
   * 🔴 닫히는 것만으로는 저장됐는지 알 수 없어 토스트로 알린다.
   */
  useEffect(() => {
    if (!state.ok) return
    setEditing(false)
    toast.success(COMMENT_UPDATED, { key: `comment-edit:${commentId}` })
    // toast 는 매 렌더 새 객체라 의존성에 넣으면 같은 상태로 다시 뜬다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  if (!editing) {
    return (
      <>
        {children}
        {/* 오른쪽 끝으로 민다 — 본문 왼쪽 아래에 두면 읽는 줄 바로 밑이라 잘못 눌린다 */}
        <div className="mt-2 flex justify-end gap-1">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={`inline-flex ${TOUCH_MIN} items-center px-3 text-sm text-content-muted underline`}
          >
            수정
          </button>
          <DeleteButton boardSlug={boardSlug} postId={postId} commentId={commentId} />
        </div>
      </>
    )
  }

  return (
    <form action={formAction} onSubmit={guardSubmit} className="mt-2 flex flex-col gap-2">
      <input type="hidden" name="commentId" value={commentId} />
      <input type="hidden" name="postId" value={postId} />
      <input type="hidden" name="boardSlug" value={boardSlug} />

      {state.error ? (
        state.needsOnboarding ? (
          <OnboardingNotice message={state.error} callbackUrl={pathname} />
        ) : (
          <p role="alert" className="text-sm text-state-danger">
            {state.error}
          </p>
        )
      ) : null}

      <textarea
        ref={textareaRef}
        name="content"
        rows={2}
        maxLength={MAX_COMMENT_LENGTH}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="min-h-[52px] w-full resize-none overflow-y-auto rounded-lg border border-subtle bg-surface-page p-3 leading-[1.7]"
      />

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setContent(initialContent)
            setEditing(false)
          }}
          className={`inline-flex ${TOUCH_MIN} items-center px-4 text-content-muted`}
        >
          그만두기
        </button>
        <ActionButton
          tone="primary"
          label="저장"
          pendingLabel="저장 중…"
          disabled={
            content.trim().length < MIN_COMMENT_LENGTH || content.trim() === initialContent.trim()
          }
          className="min-w-[76px] shrink-0 whitespace-nowrap"
        />
      </div>
    </form>
  )
}
