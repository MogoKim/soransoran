'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useFormState } from 'react-dom'
import ActionButton from '@/components/ui/ActionButton'
import { useAutoResize } from '@/lib/use-auto-resize'
import { useSubmitGuard } from '@/lib/use-submit-guard'
import { createComment, type CommentActionState } from '@/lib/actions/comments'
import { trackEvent } from '@/lib/analytics/track'
import { countsAsNewComment } from '@/lib/comment-publish'
import OnboardingNotice from '@/components/features/onboarding/onboarding-notice'
import { useToast } from '@/components/ui/toast'
import ReplyTargetHeader, { replyTargetGoneOf, type ReplyTargetInfo } from '@/components/features/ReplyTargetHeader'
import { useThreadNav } from '@/components/features/ThreadNavProvider'
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

export default function CommentForm({
  postId,
  boardSlug,
  parentId,
  replyTarget,
  onPosted,
}: {
  postId: string
  boardSlug: string
  /** 답글이면 직접 답하는 댓글 id. 새 댓글이면 undefined */
  parentId?: string
  /** 답글이면 작성칸 맨 위에 보일 대상 */
  replyTarget?: ReplyTargetInfo
  /** 저장된 뒤 — 답글 작성칸은 여기서 닫힌다 */
  onPosted?: () => void
}) {
  const pathname = usePathname()
  const toast = useToast()
  const [state, formAction] = useFormState<CommentActionState, FormData>(createComment, {})
  const [content, setContent] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const nav = useThreadNav()
  /** 🔴 쓰는 도중 대상을 쓸 수 없게 됐다(지움 · 차단) — 이름·원문을 숨기고 등록을 막는다. 쓴 글(content)은 지우지 않는다 */
  const goneReason = replyTargetGoneOf(state.code)
  const targetGone = goneReason !== null

  /**
   * 이미 처리한 서버 응답.
   *
   * 🔴 값이 아니라 **객체 그 자체**를 기억한다. 성공은 늘 {ok:true} 라 값으로는
   *    "방금 온 답" 과 "아까 그 답" 을 가를 수 없다. 새 결과가 올 때만 다른 객체가 오므로
   *    같은 객체면 이미 처리한 것이다. 댓글을 연달아 두 번 달면 서로 다른 객체라
   *    정상적으로 두 번 센다 — 막는 것은 같은 성공을 두 번 세는 일뿐이다.
   */
  const handledRef = useRef<CommentActionState | null>(null)

  /** 🔴 연타 차단. 비회원 폼·수정 폼과 같은 것을 쓴다 — 한쪽만 막히면 일관되지 않다. */
  const { guardSubmit } = useSubmitGuard(state)

  /**
   * 🔴 성공은 토스트가 알린다. 예전에는 이 자리에 문구를 띄웠는데,
   *    다시 타자를 치기 전까지 사라지지 않아 다음 댓글을 쓰는 동안에도 남아 있었다.
   *
   * 🔴 key 를 두어 연타로 여러 줄이 쌓이지 않게 한다.
   *    답글은 부모마다 자리가 다르므로 parentId 를 쓴다 —
   *    서로 다른 댓글에 이어서 답글을 달면 각각 뜬다.
   */
  useEffect(() => {
    if (!state.ok) return
    if (handledRef.current === state) return
    handledRef.current = state

    setContent('')
    toast.success(parentId ? REPLY_CREATED : COMMENT_CREATED, {
      key: `comment:${parentId ?? postId}`,
    })
    /**
     * 🔴 서버가 {ok:true} 를 돌려준 뒤에만 센다. 그 앞에는 길이·금칙어·rate limit ·
     *    글 존재 확인이 있고, 하나라도 걸리면 error 로 돌아와 이 자리에 오지 않는다.
     * 🔴 본문·postId·parentId 를 보내지 않는다. 답글인지 여부만 boolean 으로 남긴다.
     */
    // 🔴 중복(연타 · 재전송)으로 기존 댓글을 돌려받은 요청은 새 등록으로 세지 않는다(comment-publish.ts)
    if (countsAsNewComment(state)) {
      trackEvent('comment_publish', { member_type: 'member', is_reply: Boolean(parentId) })
    }
    // 새로 그려진 그 댓글로 이동·포커스한다(서버가 새 목록을 그릴 때까지 기다린다)
    if (state.commentId) nav?.focusPosted(state.commentId)
    onPosted?.()
    // toast 는 매 렌더 새 객체라 의존성에 넣으면 같은 상태로 다시 뜬다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  useAutoResize(textareaRef, content, COMMENT_TEXTAREA_MAX_HEIGHT)

  const showCounter = content.length >= COMMENT_COUNTER_FROM

  return (
    <form
      action={formAction}
      onSubmit={guardSubmit}
      className="flex flex-col gap-2 rounded-2xl border border-subtle bg-surface-card p-4"
    >
      <input type="hidden" name="postId" value={postId} />
      <input type="hidden" name="boardSlug" value={boardSlug} />
      {parentId ? <input type="hidden" name="parentId" value={parentId} /> : null}

      {replyTarget ? <ReplyTargetHeader target={replyTarget} gone={goneReason} /> : null}

      {state.error ? (
        state.needsOnboarding ? (
          <OnboardingNotice message={state.error} callbackUrl={pathname} />
        ) : (
          <p role="alert" className="text-sm text-state-danger">
            {state.error}
          </p>
        )
      ) : null}

      {/* items-end — 입력창이 길어져도 등록 버튼은 손가락 가까운 아래에 남는다 */}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          name="content"
          rows={1}
          maxLength={MAX_COMMENT_LENGTH}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          aria-label={replyTarget && !targetGone ? `${replyTarget.name}님에게 보낼 답글` : parentId ? '답글' : '댓글'}
          className="min-h-[52px] flex-1 resize-none overflow-y-auto rounded-lg border border-subtle bg-surface-page p-3 leading-[1.7]"
          placeholder={COMMENT_PLACEHOLDER}
        />
        <ActionButton
          tone="primary"
          label="등록"
          pendingLabel="등록 중…"
          disabled={targetGone || content.trim().length < MIN_COMMENT_LENGTH}
          className="min-w-[76px] shrink-0 whitespace-nowrap"
        />
      </div>

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
    </form>
  )
}
