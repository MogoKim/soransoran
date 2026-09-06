'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useFormState } from 'react-dom'
import ActionButton from '@/components/ui/ActionButton'
import { useAutoResize } from '@/lib/use-auto-resize'
import { createComment, type CommentActionState } from '@/lib/actions/comments'
import OnboardingNotice from '@/components/features/onboarding/onboarding-notice'
import { useToast } from '@/components/ui/toast'
import {
  COMMENT_CREATED,
  REPLY_CREATED,
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
  const toast = useToast()
  const [state, formAction] = useFormState<CommentActionState, FormData>(createComment, {})
  const [content, setContent] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  /**
   * 🔴 성공은 토스트가 알린다. 예전에는 이 자리에 문구를 띄웠는데,
   *    다시 타자를 치기 전까지 사라지지 않아 다음 댓글을 쓰는 동안에도 남아 있었다.
   *
   * 🔴 key 를 두어 연타로 여러 줄이 쌓이지 않게 한다.
   *    답글은 부모마다 자리가 다르므로 parentId 를 쓴다 —
   *    서로 다른 댓글에 이어서 답글을 달면 각각 뜬다.
   */
  useEffect(() => {
    if (!state.ok) return
    setContent('')
    toast.success(parentId ? REPLY_CREATED : COMMENT_CREATED, {
      key: `comment:${parentId ?? postId}`,
    })
    // toast 는 매 렌더 새 객체라 의존성에 넣으면 같은 상태로 다시 뜬다
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      ) : null}

      {/* items-end — 입력창이 길어져도 등록 버튼은 손가락 가까운 아래에 남는다 */}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          name="content"
          rows={1}
          maxLength={MAX_COMMENT_LENGTH}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          aria-label="댓글"
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
