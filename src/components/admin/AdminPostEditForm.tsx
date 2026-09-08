'use client'

import { useFormState } from 'react-dom'
import ActionButton from '@/components/ui/ActionButton'
import { updatePost, type AdminActionState } from '@/lib/actions/admin'

/**
 * 글 제목·본문 수정.
 *
 * 🔴 수정은 저장 버튼을 눌러야 일어난다. 자동 저장을 넣지 않는다 —
 *    운영자가 읽다가 실수로 고친 것이 그대로 반영되면 되돌릴 근거가 없다.
 * 🔴 숨김·공개는 이 폼에 넣지 않는다. 저장과 가림은 다른 판단이다.
 *
 * 🔴 저장 버튼은 ActionButton 이 진다. 저장하는 동안 잠겨야 하는데,
 *    생 button 은 그 상태를 모른다 — 응답이 늦으면 "안 눌렸나" 하고 다시 누르게 된다.
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

      <ActionButton tone="primary" size="compact" label="저장" pendingLabel="저장 중…" className="px-4 justify-center" />
    </form>
  )
}
