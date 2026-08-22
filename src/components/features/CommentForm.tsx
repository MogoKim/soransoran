'use client'

import { useEffect, useRef } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { createComment, type CommentActionState } from '@/lib/actions/comments'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
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
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (!state.error) formRef.current?.reset()
  }, [state])

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="postId" value={postId} />
      <input type="hidden" name="boardSlug" value={boardSlug} />
      <div className="flex gap-2">
        <textarea
          name="content"
          rows={2}
          className="flex-1 rounded-lg border border-subtle bg-surface-card p-3"
          placeholder="댓글을 남겨보세요."
        />
        <SubmitButton />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-state-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  )
}
