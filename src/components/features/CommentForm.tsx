'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useFormState } from 'react-dom'
import ActionButton from '@/components/ui/ActionButton'
import { useAutoResize } from '@/lib/use-auto-resize'
import { createComment, type CommentActionState } from '@/lib/actions/comments'
import OnboardingNotice from '@/components/features/onboarding/onboarding-notice'
import {
  COMMENT_CREATED,
  COMMENT_COUNTER_FROM,
  COMMENT_COUNTER_WARN_FROM,
  COMMENT_PLACEHOLDER,
  COMMENT_TEXTAREA_MAX_HEIGHT,
  MAX_COMMENT_LENGTH,
  MIN_COMMENT_LENGTH,
} from '@/lib/comment-policy'

export default function CommentForm({
  postId,
  boardSlug,
  parentId,
}: {
  postId: string
  boardSlug: string
  /** 답글이면 부모 댓글 id. 새 댓글이면 undefined */
  parentId?: string
}) {
  const pathname = usePathname()
  const [state, formAction] = useFormState<CommentActionState, FormData>(createComment, {})
  const [content, setContent] = useState('')
  const [showSuccess, setShowSuccess] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!state.ok) return
    setContent('')
    setShowSuccess(true)
  }, [state])

  useAutoResize(textareaRef, content, COMMENT_TEXTAREA_MAX_HEIGHT)

  const showCounter = content.length >= COMMENT_COUNTER_FROM

  return (
    <form
      action={formAction}
      className="flex flex-col gap-2 rounded-2xl border border-subtle bg-surface-card p-4"
    >
      <input type="hidden" name="postId" value={postId} />
      <input type="hidden" name="boardSlug" value={boardSlug} />
      {parentId ? <input type="hidden" name="parentId" value={parentId} /> : null}

      {state.error ? (
        state.needsOnboarding ? (
          <OnboardingNotice message={state.error} callbackUrl={pathname} />
        ) : (
          <p role="alert" className="text-sm text-state-danger">
            {state.error}
          </p>
        )
      ) : showSuccess ? (
        <p role="status" className="text-sm text-state-success">
          {COMMENT_CREATED}
        </p>
      ) : null}

      {/* items-end — 입력창이 길어져도 등록 버튼은 손가락 가까운 아래에 남는다 */}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          name="content"
          rows={1}
          maxLength={MAX_COMMENT_LENGTH}
          value={content}
          onChange={(e) => {
            setContent(e.target.value)
            setShowSuccess(false)
          }}
          className="min-h-[52px] flex-1 resize-none overflow-y-auto rounded-lg border border-subtle bg-surface-page p-3 leading-[1.7]"
          placeholder={COMMENT_PLACEHOLDER}
        />
        <ActionButton
          tone="primary"
          label="등록"
          pendingLabel="등록 중…"
          disabled={content.trim().length < MIN_COMMENT_LENGTH}
          className="min-w-[76px] shrink-0 whitespace-nowrap"
        />
      </div>

      {showCounter ? (
        <p
          className={`self-end text-xs ${
            content.length >= COMMENT_COUNTER_WARN_FROM
              ? 'text-state-warning'
              : 'text-content-muted'
          }`}
        >
          {content.length}/{MAX_COMMENT_LENGTH}
        </p>
      ) : null}
    </form>
  )
}
