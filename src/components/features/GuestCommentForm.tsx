'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useFormState } from 'react-dom'
import ActionButton from '@/components/ui/ActionButton'
import GuestTurnstile from '@/components/features/GuestTurnstile'
import { useAutoResize } from '@/lib/use-auto-resize'
import { createGuestComment, type GuestCommentState } from '@/lib/actions/guest-comments'
import {
  COMMENT_CREATED,
  COMMENT_COUNTER_FROM,
  COMMENT_COUNTER_WARN_FROM,
  COMMENT_PLACEHOLDER,
  COMMENT_TEXTAREA_MAX_HEIGHT,
  MAX_COMMENT_LENGTH,
  MIN_COMMENT_LENGTH,
} from '@/lib/comment-policy'
import {
  GUEST_NICKNAME_MAX,
  GUEST_NICKNAME_PLACEHOLDER,
  GUEST_PASSWORD_LENGTH,
  GUEST_PASSWORD_PLACEHOLDER,
  GUEST_SIGNUP_HINT,
} from '@/lib/guest-comment-policy'

/**
 * 비로그인 댓글 입력.
 *
 * 🔴 회원 폼(CommentForm)과 같은 모양을 유지한다. 비회원이라고 다른 화면을 만들면
 *    같은 자리에서 두 가지 사용법을 배우게 된다.
 *
 * 🔴 이름·비밀번호를 본문 아래에 둔다. 처음 오는 사람이 무엇을 쓰는 칸인지
 *    먼저 보고, 그다음에 신원을 적게 한다.
 *
 * 🔴 가입을 막지 않는다. 등록 뒤 한 줄로 권하기만 한다 —
 *    비회원 댓글은 문턱을 낮추려는 것이지 가입을 대신하려는 것이 아니다.
 */
export default function GuestCommentForm({
  postId,
  boardSlug,
}: {
  postId: string
  boardSlug: string
}) {
  const pathname = usePathname()
  const [state, formAction] = useFormState<GuestCommentState, FormData>(createGuestComment, {})
  const [content, setContent] = useState('')
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [showSuccess, setShowSuccess] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!state.ok) return
    setContent('')
    setPassword('')
    setShowSuccess(true)
  }, [state])

  useAutoResize(textareaRef, content, COMMENT_TEXTAREA_MAX_HEIGHT)

  const showCounter = content.length >= COMMENT_COUNTER_FROM
  const canSubmit =
    content.trim().length >= MIN_COMMENT_LENGTH &&
    nickname.trim().length > 0 &&
    password.length === GUEST_PASSWORD_LENGTH

  return (
    <form
      action={formAction}
      className="flex flex-col gap-2 rounded-2xl border border-subtle bg-surface-card p-4"
    >
      <input type="hidden" name="postId" value={postId} />
      <input type="hidden" name="boardSlug" value={boardSlug} />

      {state.error ? (
        <p role="alert" className="text-sm text-state-danger">
          {state.error}
        </p>
      ) : showSuccess ? (
        <div role="status" className="text-sm">
          <p className="m-0 text-state-success">{COMMENT_CREATED}</p>
          <p className="mt-1 text-content-muted">
            {GUEST_SIGNUP_HINT}{' '}
            <Link href={`/login?callbackUrl=${encodeURIComponent(pathname)}`} className="text-link">
              카카오로 시작하기
            </Link>
          </p>
        </div>
      ) : null}

      <textarea
        ref={textareaRef}
        name="content"
        rows={1}
        maxLength={MAX_COMMENT_LENGTH}
        value={content}
        onChange={(e) => {
          setContent(e.target.value)
          setShowSuccess(false)
        }}
        className="min-h-[52px] resize-none overflow-y-auto rounded-lg border border-subtle bg-surface-page p-3 leading-[1.7]"
        placeholder={COMMENT_PLACEHOLDER}
      />

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

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs text-content-muted">이름</span>
          <input
            type="text"
            name="guestNickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={GUEST_NICKNAME_MAX}
            placeholder={GUEST_NICKNAME_PLACEHOLDER}
            autoComplete="nickname"
            className="min-h-[52px] rounded-lg border border-subtle bg-surface-page px-3"
          />
        </label>

        <label className="flex w-[120px] flex-col gap-1">
          <span className="text-xs text-content-muted">비밀번호</span>
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

        <ActionButton
          tone="primary"
          label="등록"
          pendingLabel="등록 중…"
          disabled={!canSubmit}
          className="min-w-[76px] shrink-0 whitespace-nowrap"
        />
      </div>

      <GuestTurnstile />

      <p className="m-0 text-xs text-content-muted">
        비밀번호는 이 댓글을 고치거나 지울 때 씁니다. 잊으면 되찾을 수 없어요.
      </p>
    </form>
  )
}
