'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useFormState } from 'react-dom'
import ActionButton from '@/components/ui/ActionButton'
import GuestTurnstile, { TURNSTILE_SITE_KEY } from '@/components/features/GuestTurnstile'
import { useAutoResize } from '@/lib/use-auto-resize'
import { createGuestComment, type GuestCommentState } from '@/lib/actions/guest-comments'
import { useToast } from '@/components/ui/toast'
import {
  COMMENT_CREATED,
  REPLY_CREATED,
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
  parentId,
}: {
  postId: string
  boardSlug: string
  /** 답글이면 부모 댓글 id. 새 댓글이면 undefined */
  parentId?: string
}) {
  const pathname = usePathname()
  const toast = useToast()
  const [state, formAction] = useFormState<GuestCommentState, FormData>(createGuestComment, {})
  const [content, setContent] = useState('')
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [showSuccess, setShowSuccess] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  /**
   * 🔴 토큰을 state 로 들고 controlled hidden input 으로 낸다.
   *    DOM 에 직접 쓰면 이름·비밀번호를 한 글자 칠 때마다 React 가 defaultValue 를
   *    다시 적용하면서 값을 지운다 — 화면에는 "성공!" 이 떠 있는데 서버는 빈 토큰을 받았다.
   */
  const [token, setToken] = useState('')
  const [resetSignal, setResetSignal] = useState(0)

  useEffect(() => {
    if (!state.ok && !state.error) return
    // 🔴 토큰은 1회용이다. 성공이든 실패든 응답을 받으면 새로 받아야 한다.
    setToken('')
    setResetSignal((n) => n + 1)
    if (!state.ok) return
    setContent('')
    setPassword('')
    setShowSuccess(true)
    /* 🔴 등록됐다는 사실은 토스트가 알린다. 이 자리에는 누를 것(가입 링크)만 남는다 */
    toast.success(parentId ? REPLY_CREATED : COMMENT_CREATED, {
      key: `comment:${parentId ?? postId}`,
    })
    // toast 는 매 렌더 새 객체라 의존성에 넣으면 같은 상태로 다시 뜬다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  useAutoResize(textareaRef, content, COMMENT_TEXTAREA_MAX_HEIGHT)

  const showCounter = content.length >= COMMENT_COUNTER_FROM
  /**
   * 🔴 토큰이 오기 전에는 등록을 막는다.
   *    누를 수 있게 두면 사람이 먼저 누르고 "잠시 후 다시 시도해 주세요" 만 보게 된다 —
   *    무엇을 기다려야 하는지 화면이 말해 주지 않는다.
   *    사이트 키가 없는 환경(로컬)에서는 위젯이 없으므로 이 조건을 걸지 않는다.
   */
  const needsToken = TURNSTILE_SITE_KEY.length > 0
  const canSubmit =
    content.trim().length >= MIN_COMMENT_LENGTH &&
    nickname.trim().length > 0 &&
    password.length === GUEST_PASSWORD_LENGTH &&
    (!needsToken || token.length > 0)

  return (
    <form
      action={formAction}
      className="flex flex-col gap-2 rounded-2xl border border-subtle bg-surface-card p-4"
    >
      <input type="hidden" name="postId" value={postId} />
      <input type="hidden" name="boardSlug" value={boardSlug} />
      {parentId ? <input type="hidden" name="parentId" value={parentId} /> : null}

      {state.error ? (
        <p role="alert" className="text-sm text-state-danger">
          {state.error}
        </p>
      ) : showSuccess ? (
        /* 🔴 성공 문구는 토스트로 갔다. 누를 것이 있는 안내만 여기 남는다 —
              사라지는 자리에 링크를 두면 누르기 전에 없어진다. */
        <div role="status" className="text-sm">
          <p className="m-0 text-content-muted">
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
        aria-label="댓글"
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
          <span className="text-sm text-content-muted">이름</span>
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

        <ActionButton
          tone="primary"
          label="등록"
          pendingLabel="등록 중…"
          disabled={!canSubmit}
          className="min-w-[76px] shrink-0 whitespace-nowrap"
        />
      </div>

      <input type="hidden" name="turnstileToken" value={token} readOnly />
      <GuestTurnstile onToken={setToken} resetSignal={resetSignal} />

      {needsToken && !token ? (
        <p className="m-0 text-xs text-content-muted">
          위 확인이 끝나면 등록할 수 있어요.
        </p>
      ) : null}

      <p className="m-0 text-xs text-content-muted">
        비밀번호는 이 댓글을 고치거나 지울 때 씁니다. 잊으면 되찾을 수 없어요.
      </p>
    </form>
  )
}
