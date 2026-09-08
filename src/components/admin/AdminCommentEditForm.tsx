'use client'

import { useState } from 'react'
import { useFormState } from 'react-dom'
import ActionButton from '@/components/ui/ActionButton'
import { updateCommentContent, type AdminActionState } from '@/lib/actions/admin'
import { MAX_COMMENT_LENGTH } from '@/lib/comment-policy'

/**
 * 댓글 본문 수정 — 운영자용.
 *
 * 🔴 기본은 접혀 있다. 댓글마다 textarea 를 펼쳐 두면 목록을 읽을 수 없고,
 *    읽으려던 사람이 실수로 고치게 된다. "수정" 을 눌러야 열린다.
 *
 * 🔴 저장 버튼을 눌러야 반영된다. 자동 저장을 넣지 않는다.
 *
 * 🔴 숨김 상태를 여기서 바꾸지 않는다. 가리기·되살리기는 옆 버튼의 일이다.
 *
 * 🔴 저장 버튼은 ActionButton 이 진다 — 저장하는 동안 잠긴다.
 *    "닫기" 는 그대로 둔다. 저장 중에도 닫을 수 있어야 한다.
 */
export default function AdminCommentEditForm({
  commentId,
  content,
}: {
  commentId: string
  content: string
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction] = useFormState<AdminActionState, FormData>(updateCommentContent, {})

  if (!open) {
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-[52px] items-center justify-center rounded-lg border border-interactive px-4 font-bold text-brand-ink transition duration-150 hover:bg-surface-soft active:scale-[0.98]"
        >
          댓글 수정
        </button>
        {state.ok ? <p className="text-sm text-state-success">저장했습니다.</p> : null}
      </div>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="commentId" value={commentId} />

      <label className="flex flex-col gap-1">
        <span className="text-sm text-content-muted">댓글 내용</span>
        <textarea
          name="content"
          defaultValue={content}
          rows={4}
          maxLength={MAX_COMMENT_LENGTH}
          className="w-full rounded-lg border border-subtle bg-surface-card p-3 text-content-primary"
        />
      </label>

      {state.error ? <p className="text-sm text-state-danger">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-state-success">저장했습니다.</p> : null}

      {/* 좁은 화면에서 두 버튼이 겹치지 않게 감싼다 */}
      <div className="flex flex-wrap gap-2">
        <ActionButton
          tone="primary"
          size="compact"
          label="저장"
          pendingLabel="저장 중…"
          className="flex-1 px-4 justify-center"
        />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex min-h-[52px] items-center justify-center rounded-lg border border-interactive px-4 font-bold text-brand-ink transition duration-150 hover:bg-surface-soft active:scale-[0.98]"
        >
          닫기
        </button>
      </div>
    </form>
  )
}
