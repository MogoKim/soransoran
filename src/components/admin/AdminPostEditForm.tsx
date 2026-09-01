'use client'

import { useFormState } from 'react-dom'
import { updatePost, type AdminActionState } from '@/lib/actions/admin'

/**
 * 글 제목·본문 수정.
 *
 * 🔴 수정은 저장 버튼을 눌러야 일어난다. 자동 저장을 넣지 않는다 —
 *    운영자가 읽다가 실수로 고친 것이 그대로 반영되면 되돌릴 근거가 없다.
 * 🔴 숨김·공개는 이 폼에 넣지 않는다. 저장과 가림은 다른 판단이다.
 */
export default function AdminPostEditForm({
  postId,
  title,
  content,
}: {
  postId: string
  title: string
  content: string
}) {
  const [state, formAction] = useFormState<AdminActionState, FormData>(updatePost, {})

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="postId" value={postId} />

      <label className="flex flex-col gap-1">
        <span className="text-sm text-content-muted">제목</span>
        <input
          name="title"
          defaultValue={title}
          maxLength={200}
          className="min-h-[52px] rounded-lg border border-subtle bg-surface-card px-3 text-content-primary"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-content-muted">본문</span>
        <textarea
          name="content"
          defaultValue={content}
          rows={12}
          className="rounded-lg border border-subtle bg-surface-card p-3 text-content-primary"
        />
      </label>

      {state.error ? <p className="text-sm text-state-danger">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-state-success">저장했습니다.</p> : null}

      <button
        type="submit"
        className="inline-flex min-h-[52px] items-center justify-center rounded-lg bg-cta px-4 font-bold text-cta-text transition duration-150 hover:brightness-95 active:scale-[0.98]"
      >
        저장
      </button>
    </form>
  )
}
