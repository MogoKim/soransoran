'use client'

import { useState } from 'react'
import { useFormState } from 'react-dom'
import ActionButton from '@/components/ui/ActionButton'
import { createReport, type ReportActionState } from '@/lib/actions/reports'
import { REPORT_REASONS } from '@/lib/report-reasons'

/**
 * 신고 버튼
 *
 * danger 는 fill 버튼을 쓰지 않는다 (정본 §3-2).
 * cta(#B64235)와 danger(#B3261E)는 명도가 거의 같아 색만으로 구분되지 않으므로
 * 아웃라인 + 명시 문구 + 확인 단계를 함께 둔다.
 */
export default function ReportButton({
  postId,
  commentId,
}: {
  postId?: string
  commentId?: string
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction] = useFormState<ReportActionState, FormData>(createReport, {})

  if (state.done) {
    return <p className="text-xs text-content-muted">신고가 접수됐습니다. 운영자가 확인합니다.</p>
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[52px] items-center px-3 text-sm text-content-muted underline"
      >
        신고
      </button>
    )
  }

  return (
    <form action={formAction} className="mt-2 flex flex-col gap-2 rounded-lg bg-surface-soft p-3">
      {postId ? <input type="hidden" name="postId" value={postId} /> : null}
      {commentId ? <input type="hidden" name="commentId" value={commentId} /> : null}

      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold text-content-primary">신고 사유</span>
        <select
          name="reason"
          defaultValue=""
          className="min-h-[52px] rounded-lg border border-subtle bg-surface-card px-3"
        >
          <option value="" disabled>
            선택해 주세요
          </option>
          {REPORT_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>

      <input
        name="detail"
        type="text"
        maxLength={200}
        placeholder="자세한 내용 (선택)"
        className="min-h-[52px] rounded-lg border border-subtle bg-surface-card px-3"
      />

      {state.error ? (
        <p role="alert" className="text-xs text-state-danger">
          {state.error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <ActionButton tone="danger" label="신고" pendingLabel="신고 중…" />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-[52px] px-4 text-content-muted"
        >
          취소
        </button>
      </div>
    </form>
  )
}
