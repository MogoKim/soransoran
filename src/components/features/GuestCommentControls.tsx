'use client'

import { useEffect, useState } from 'react'
import { TOUCH_MIN } from '@/lib/spacing'
import { useFormState } from 'react-dom'
import ActionButton from '@/components/ui/ActionButton'
import { useComposeLock } from '@/components/features/ComposeModeProvider'
import {
  updateGuestComment,
  deleteGuestComment,
  type GuestCommentState,
} from '@/lib/actions/guest-comments'
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from '@/lib/comment-policy'
import { GUEST_PASSWORD_LENGTH, GUEST_PASSWORD_PLACEHOLDER } from '@/lib/guest-comment-policy'

/**
 * 비회원 댓글의 고치기·지우기.
 *
 * 🔴 비밀번호는 눌러야 열린다. 댓글마다 입력칸을 펼쳐 두면 목록을 읽을 수 없고,
 *    읽으려던 사람이 실수로 고치게 된다.
 *
 * 🔴 고치기와 지우기를 각각 독립 form 으로 둔다.
 *    한 form 에 버튼 둘을 두면 어느 것을 눌렀는지 구분할 방법이 submitter 로 돌아가는데,
 *    react-dom 18 + useFormState 에서는 submitter 의 name·value 가 FormData 에 오지 않는다.
 *
 * 🔴 우나어의 바텀시트를 가져오지 않는다. 이 자리에서 바로 끝내는 편이 짧다.
 */
type Mode = 'edit' | 'delete' | null

const SMALL_BTN =
  `inline-flex ${TOUCH_MIN} min-w-[52px] items-center justify-center rounded-lg px-2 text-sm text-content-muted hover:text-content-primary`

export default function GuestCommentControls({
  commentId,
  boardSlug,
  content,
}: {
  commentId: string
  boardSlug: string
  content: string
}) {
  const [mode, setMode] = useState<Mode>(null)
  const [password, setPassword] = useState('')
  const [draft, setDraft] = useState(content)

  const [editState, editAction] = useFormState<GuestCommentState, FormData>(updateGuestComment, {})
  const [deleteState, deleteAction] = useFormState<GuestCommentState, FormData>(
    deleteGuestComment,
    {},
  )

  const state = mode === 'delete' ? deleteState : editState

  /** 🔴 회원 수정(CommentEditor)과 같은 계약이다 — 열려 있는 동안 하단 바가 비킨다. */
  useComposeLock(mode !== null)

  // 성공하면 닫는다. 지운 댓글은 다시 그려지며 사라진다.
  useEffect(() => {
    if (editState.ok || deleteState.ok) {
      setMode(null)
      setPassword('')
    }
  }, [editState.ok, deleteState.ok])

  if (!mode) {
    return (
      <div className="mt-1 flex gap-1">
        <button type="button" className={SMALL_BTN} onClick={() => setMode('edit')}>
          고치기
        </button>
        <button type="button" className={SMALL_BTN} onClick={() => setMode('delete')}>
          지우기
        </button>
      </div>
    )
  }

  const passwordField = (
    <label className="flex w-[120px] flex-col gap-1">
      <span className="text-sm text-content-muted">비밀번호</span>
      <input
        type="password"
        name="guestPassword"
        value={password}
        onChange={(e) => setPassword(e.target.value.replace(/\D/g, ''))}
        inputMode="numeric"
        maxLength={GUEST_PASSWORD_LENGTH}
        placeholder={GUEST_PASSWORD_PLACEHOLDER}
        autoComplete="off"
        className="min-h-[52px] rounded-lg border border-subtle bg-surface-page px-3"
      />
    </label>
  )

  const cancel = (
    <button
      type="button"
      className={SMALL_BTN}
      onClick={() => {
        setMode(null)
        setPassword('')
        setDraft(content)
      }}
    >
      취소
    </button>
  )

  return (
    <form
      action={mode === 'delete' ? deleteAction : editAction}
      className="mt-2 flex flex-col gap-2 rounded-lg border border-subtle bg-surface-page p-3"
    >
      <input type="hidden" name="commentId" value={commentId} />
      <input type="hidden" name="boardSlug" value={boardSlug} />

      {mode === 'edit' ? (
        <>
          <textarea
            name="content"
            rows={3}
            maxLength={MAX_COMMENT_LENGTH}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="resize-none rounded-lg border border-subtle bg-surface-card p-3 leading-[1.7]"
          />
        </>
      ) : (
        <p className="m-0 text-sm text-content-primary">이 댓글을 지울까요?</p>
      )}

      {state.error ? (
        <p role="alert" className="m-0 text-sm text-state-danger">
          {state.error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        {passwordField}
        <ActionButton
          tone={mode === 'delete' ? 'danger' : 'primary'}
          label={mode === 'delete' ? '지우기' : '저장'}
          pendingLabel="처리 중…"
          disabled={
            password.length !== GUEST_PASSWORD_LENGTH ||
            (mode === 'edit' && draft.trim().length < MIN_COMMENT_LENGTH)
          }
          className="min-w-[76px] shrink-0 whitespace-nowrap"
        />
        {cancel}
      </div>
    </form>
  )
}
