'use client'

import { useEffect, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { createComment, type CommentActionState } from '@/lib/actions/comments'
import {
  COMMENT_PLACEHOLDER,
  MAX_COMMENT_LENGTH,
  MIN_COMMENT_LENGTH,
} from '@/lib/comment-policy'

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="inline-flex min-h-[52px] shrink-0 items-center rounded-lg bg-cta px-5 font-bold text-cta-text disabled:opacity-60"
    >
      {pending ? '등록 중…' : '등록'}
    </button>
  )
}

export default function CommentForm({
  postId,
  boardSlug,
}: {
  postId: string
  boardSlug: string
}) {
  const [state, formAction] = useFormState<CommentActionState, FormData>(createComment, {})
  const [content, setContent] = useState('')

  useEffect(() => {
    if (state.ok) setContent('')
  }, [state])

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="postId" value={postId} />
      <input type="hidden" name="boardSlug" value={boardSlug} />

      {state.error ? (
        <p role="alert" className="text-sm text-state-danger">
          {state.error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <textarea
          name="content"
          rows={2}
          maxLength={MAX_COMMENT_LENGTH}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="min-h-[52px] flex-1 rounded-lg border border-subtle bg-surface-card p-3"
          placeholder={COMMENT_PLACEHOLDER}
        />
        <SubmitButton disabled={content.trim().length < MIN_COMMENT_LENGTH} />
      </div>
    </form>
  )
}
