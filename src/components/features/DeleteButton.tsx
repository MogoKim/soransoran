'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useFormState } from 'react-dom'
import ActionButton from '@/components/ui/ActionButton'
import { deletePost, deleteComment, type DeleteActionState } from '@/lib/actions/delete'

/**
 * 작성자 본인 삭제 버튼
 *
 * danger 는 fill 버튼을 쓰지 않는다 (정본 §3-2).
 * 되돌릴 수 없는 동작이므로 한 번 더 확인하는 단계를 둔다.
 *
 * 글을 지우면 상세 페이지가 notFound() 가 되므로,
 * action 이 돌려준 redirectTo 로 목록으로 이동시킨다.
 */
type DeleteButtonProps = {
  boardSlug: string
  postId: string
  /** 있으면 댓글 삭제, 없으면 글 삭제 */
  commentId?: string
}

export default function DeleteButton({ boardSlug, postId, commentId }: DeleteButtonProps) {
  const isComment = Boolean(commentId)
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [state, formAction] = useFormState<DeleteActionState, FormData>(
    isComment ? deleteComment : deletePost,
    {},
  )

  useEffect(() => {
    if (state.redirectTo) router.replace(state.redirectTo)
  }, [state, router])

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[52px] items-center px-3 text-sm text-content-muted underline"
      >
        삭제
      </button>
    )
  }

  return (
    <form action={formAction} className="mt-2 flex flex-col gap-2 rounded-lg bg-surface-soft p-3">
      <input type="hidden" name="boardSlug" value={boardSlug} />
      <input type="hidden" name="postId" value={postId} />
      {commentId ? <input type="hidden" name="commentId" value={commentId} /> : null}

      <p className="text-sm text-content-primary">
        {isComment ? '이 댓글을 지울까요?' : '이 글을 지울까요?'} 지운 뒤에는 되돌릴 수 없습니다.
      </p>

      {state.error ? (
        <p role="alert" className="text-xs text-state-danger">
          {state.error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <ActionButton tone="danger" label="삭제" pendingLabel="삭제 중…" />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-[52px] px-4 text-content-muted"
        >
          그대로 두기
        </button>
      </div>
    </form>
  )
}
