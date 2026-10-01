'use client'

import { useEffect, useRef, useState } from 'react'
import { TOUCH_MIN } from '@/lib/spacing'
import { useFormState } from 'react-dom'
import ActionButton from '@/components/ui/ActionButton'
import { createReport, type ReportActionState } from '@/lib/actions/reports'
import { REPORT_REASONS } from '@/lib/report-reasons'
import { useToast } from '@/components/ui/toast'
import {
  REPORT_ALREADY,
  REPORT_ALREADY_REVIEW_HINT,
  REPORT_RECEIVED,
  REPORT_REVIEW_HINT,
} from '@/lib/comment-policy'

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
  defaultOpen = false,
}: {
  postId?: string
  commentId?: string
  /** 더보기에서 이미 "신고" 를 고른 뒤라면 폼부터 편다 — 같은 선택을 두 번 시키지 않는다 */
  defaultOpen?: boolean
}) {
  const toast = useToast()
  const [open, setOpen] = useState(defaultOpen)
  const [state, formAction] = useFormState<ReportActionState, FormData>(createReport, {})
  const errorRef = useRef<HTMLParagraphElement>(null)
  const doneRef = useRef<HTMLParagraphElement>(null)
  const selectRef = useRef<HTMLSelectElement>(null)
  const openButtonRef = useRef<HTMLButtonElement>(null)
  /** 열고 닫은 뒤 포커스를 옮길 곳. 처음부터 열린 폼(더보기 → 신고)이면 사유 칸으로 간다.
   *  닫힌 채 처음 그려질 때는 비어 있다 — 아무것도 옮기지 않는다. */
  const focusAfterToggle = useRef<'select' | 'button' | null>(defaultOpen ? 'select' : null)

  /* 🔴 접수됐다는 사실은 토스트가 알린다. 폼 자리에는 상태 표시만 남는다 */
  useEffect(() => {
    if (!state.done) return
    /* 🔴 중복은 새 접수를 만들지 않았다 — 최초 신고와 같은 말을 하지 않는다 */
    toast.success(state.already ? REPORT_ALREADY : REPORT_RECEIVED, {
      key: `report:${commentId ?? postId}`,
    })
    // toast 는 매 렌더 새 객체라 의존성에 넣으면 같은 상태로 다시 뜬다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  /* 🔴 서버 응답 뒤 결과 문구로 포커스를 옮긴다 — 키보드·스크린리더 사용자가 결과 위치를 잃지 않게.
       제출 버튼이 처리 중 비활성으로 바뀌고, 완료되면 폼이 통째로 사라져 포커스가 문서 본문으로 빠졌다.
       effect 는 새 상태가 화면에 반영된 뒤에 돈다 — 그때 문구(ref)가 있다. 응답마다 새 상태라 같은 오류도 다시 옮긴다.
       첫 렌더(빈 상태)에서는 옮기지 않는다. */
  useEffect(() => {
    if (state.done) doneRef.current?.focus()
    else if (state.error) errorRef.current?.focus()
  }, [state])

  /* 🔴 열면 사유 칸으로, 취소하면 다시 나타난 "신고" 버튼으로 — 누른 버튼이 사라져 포커스가 본문으로 빠지지 않게.
       열림 상태가 화면에 반영된 뒤에 돈다 — 그때 옮길 요소(ref)가 있다. */
  useEffect(() => {
    const to = focusAfterToggle.current
    focusAfterToggle.current = null
    if (to === 'select' && open) selectRef.current?.focus()
    else if (to === 'button' && !open) openButtonRef.current?.focus()
  }, [open])

  /* 🔴 접수 뒤에는 폼을 다시 열지 않는다 — 같은 대상을 두 번 신고하게 만들지 않는다
       🔴 토스트와 다른 말을 쓴다. 접수·중복이라는 사실은 토스트가 이미 알렸고,
          여기 남는 것은 '이 폼은 끝났다' 는 상태 표시다.
       🔴 크기만 sm 이다. 신고를 마친 사람이 읽어야 하는 안심 문구인데
          caption(메타·배지) 크기였다. 색은 muted 그대로 둔다 — 정본 §12-14 ② 판단. */
  if (state.done) {
    return (
      <p ref={doneRef} role="status" tabIndex={-1} className="text-sm text-content-muted">
        {state.already ? REPORT_ALREADY_REVIEW_HINT : REPORT_REVIEW_HINT}
      </p>
    )
  }

  if (!open) {
    return (
      <button
        ref={openButtonRef}
        type="button"
        onClick={() => {
          focusAfterToggle.current = 'select'
          setOpen(true)
        }}
        className={`inline-flex ${TOUCH_MIN} items-center px-3 text-sm text-content-muted underline`}
      >
        신고
      </button>
    )
  }

  return (
    /* 🔴 부모 폭 안에서 줄어든다(w-full · min-w-0). 댓글 신고는 오른쪽 정렬 줄(flex justify-end)의 한 칸이라,
          기본 최소 폭(내용 폭)이면 WebKit 이 가장 긴 선택지로 잰 select 폭(419px)만큼 넓어져
          넘친 만큼 왼쪽 목록 밖으로 밀려 잘렸다(2026-10-01 실측). */
    <form action={formAction} className="mt-2 flex w-full min-w-0 flex-col gap-2 rounded-lg bg-surface-soft p-3">
      {postId ? <input type="hidden" name="postId" value={postId} /> : null}
      {commentId ? <input type="hidden" name="commentId" value={commentId} /> : null}

      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-sm font-bold text-content-primary">신고 사유</span>
        {/* 🔴 높이를 명시한다 — WebKit 은 기본 모양 select 에 min-height 를 적용하지 않아 29~34px 로 그렸다 */}
        <select
          ref={selectRef}
          name="reason"
          defaultValue=""
          className="h-[52px] w-full min-w-0 rounded-lg border border-subtle bg-surface-card px-3"
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
        className="min-h-[52px] w-full min-w-0 rounded-lg border border-subtle bg-surface-card px-3"
      />

      {state.error ? (
        <p ref={errorRef} role="alert" tabIndex={-1} className="text-sm text-state-danger">
          {state.error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <ActionButton tone="danger" label="신고" pendingLabel="신고 중…" />
        <button
          type="button"
          onClick={() => {
            focusAfterToggle.current = 'button'
            setOpen(false)
          }}
          className={`${TOUCH_MIN} px-4 text-content-muted`}
        >
          취소
        </button>
      </div>
    </form>
  )
}
