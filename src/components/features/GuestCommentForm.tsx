'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useFormState } from 'react-dom'
import ActionButton from '@/components/ui/ActionButton'
import GuestTurnstile, { TURNSTILE_SITE_KEY } from '@/components/features/GuestTurnstile'
import { useAutoResize } from '@/lib/use-auto-resize'
import { useSubmitGuard } from '@/lib/use-submit-guard'
import { createGuestComment, type GuestCommentState } from '@/lib/actions/guest-comments'
import { trackEvent } from '@/lib/analytics/track'
import { countsAsNewComment } from '@/lib/comment-publish'
import { useToast } from '@/components/ui/toast'
import ReplyTargetHeader, { replyTargetGoneOf, type ReplyTargetInfo } from '@/components/features/ReplyTargetHeader'
import { useThreadNav } from '@/components/features/ThreadNavProvider'
import {
  canSubmitGuestComment,
  evaluateTokenWait,
  planSubmit,
  resolveIdentityOpen,
  submitPendingLabel,
  type SubmitPhase,
} from '@/lib/guest-comment-compose'
import {
  COMMENT_CREATED,
  REPLY_CREATED,
  COMMENT_COUNTER_WARN_FROM,
  MAX_COMMENT_LENGTH,
} from '@/lib/comment-policy'
import {
  GUEST_NICKNAME_LABEL,
  GUEST_NICKNAME_MAX,
  GUEST_NICKNAME_PLACEHOLDER,
  GUEST_PASSWORD_HINT,
  GUEST_PASSWORD_LABEL,
  GUEST_PASSWORD_LENGTH,
  GUEST_PASSWORD_PLACEHOLDER,
  GUEST_SIGNUP_HINT,
  GUEST_COMMENT_PLACEHOLDER,
  GUEST_COMPOSE_TITLE,
  GUEST_REPLY_SUBMIT_LABEL,
  GUEST_SUBMIT_LABEL,
  GUEST_TEXTAREA_MAX_HEIGHT,
  GUEST_CHALLENGE_PENDING,
  GUEST_CHALLENGE_TIMEOUT,
  GUEST_TURNSTILE_TIMEOUT,
} from '@/lib/guest-comment-policy'

/**
 * 아무 일도 일어나지 않는 조용한 대기의 상한(ms).
 * 🔴 사람이 확인 상자를 푸는 동안에는 이 시계가 멈춘다 — evaluateTokenWait 주석 참고.
 */
const QUIET_WAIT_MS = 10_000
/**
 * 확인 상자가 떠 있는 동안의 상한(ms).
 * 🔴 넉넉해야 한다. 읽고 누르는 데 걸리는 시간은 사람마다 다르고,
 *    우리 고객은 서두르지 않는다. 제한 시간을 실제로 재는 것은 Cloudflare 이고
 *    이 값은 그 콜백이 오지 않을 때를 위한 안전망이다.
 */
const CHALLENGE_WAIT_MS = 120_000
/** 토큰이 왔는지 들여다보는 간격(ms) */
const TOKEN_POLL_MS = 100

/**
 * 비로그인 댓글 입력.
 *
 * 🔴 첫 화면에는 쓸 칸 하나만 둔다.
 *    예전에는 이름·비밀번호·인증 상자·안내문 두 줄이 처음부터 전부 펼쳐져 있었다.
 *    한 줄 남기러 온 사람에게 가입 양식처럼 보였다.
 *    쓰기 시작하면 그때 신원을 묻는다 — 이미 쓴 글이 있으면 마저 하게 된다.
 *
 * 🔴 회원 폼(CommentForm)과 같은 계약을 쓴다.
 *    길이·금칙어·성공 문구·중복 제출 차단은 comment-policy 와 ActionButton 이 정한다.
 *
 * 🔴 가입을 막지 않는다. 등록 뒤 한 줄로 권하기만 한다 —
 *    비회원 댓글은 문턱을 낮추려는 것이지 가입을 대신하려는 것이 아니다.
 *    권유가 **폼을 대신하지 않는다**. 폼이 사라지면 두 줄째를 쓸 수 없다.
 */
export default function GuestCommentForm({
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
  const [state, formAction] = useFormState<GuestCommentState, FormData>(createGuestComment, {})
  const [content, setContent] = useState('')
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [identityOpen, setIdentityOpen] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [phase, setPhase] = useState<SubmitPhase>('idle')
  /**
   * 폼 안에 보여 줄 오류 — 🔴 **출처가 하나다.**
   *
   *    예전에는 `state.error ?? clientError` 로 두 곳을 봤다. useFormState 의 state 는
   *    다음 제출이 끝날 때까지 **그대로 남아 있어서**, 이름을 고쳐 다시 누르면
   *    새로 뜬 "확인 중" 이나 시간 초과 안내보다 **지난번 서버 오류가 먼저** 보였다.
   *    서버 응답도 이 한 칸으로 옮겨 담아, 새 시도를 시작할 때 한 번만 비우면 되게 한다.
   */
  const [formError, setFormError] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const nav = useThreadNav()
  /** 🔴 쓰는 도중 대상을 쓸 수 없게 됐다(지움 · 차단) — 이름·원문을 숨기고 등록을 막는다. 쓴 글(content)은 지우지 않는다 */
  const goneReason = replyTargetGoneOf(state.code)
  const targetGone = goneReason !== null

  /**
   * 🔴 토큰을 state 로 들고 controlled hidden input 으로 낸다.
   *    DOM 에 직접 쓰면 이름·비밀번호를 한 글자 칠 때마다 React 가 defaultValue 를
   *    다시 적용하면서 값을 지운다 — 화면에는 "성공!" 이 떠 있는데 서버는 빈 토큰을 받았다.
   */
  const [token, setToken] = useState('')
  const [resetSignal, setResetSignal] = useState(0)

  /** 기다리는 루프가 최신 토큰을 보게 한다 — state 는 클로저에 고정된다 */
  const tokenRef = useRef('')
  tokenRef.current = token

  /** 기다림을 도중에 그만두는 손잡이 */
  const waitCleanupRef = useRef<(() => void) | null>(null)

  /**
   * 확인 상자가 화면에 떠 있는가 — 🔴 ref 와 state 를 함께 둔다.
   *    대기 루프(setInterval)는 최신 값을 **그 자리에서** 읽어야 하므로 ref 를 보고,
   *    버튼 문구와 안내는 다시 그려야 하므로 state 를 본다.
   */
  const challengeActiveRef = useRef(false)
  const [challengeActive, setChallengeActive] = useState(false)
  /** 확인 상자가 떠 있기 시작한 시각 */
  const challengeStartedAtRef = useRef(0)


  /**
   * 🔴 막는 일은 공용 가드(ref)가 하고, `phase` 는 **보여 줄 말**만 정한다.
   *    둘을 한 값에 맡기면 같은 tick 에 들어온 두 번째 클릭을 놓친다 —
   *    그 사고와 근거는 use-submit-guard 주석에 있다.
   */
  const { guardSubmit, releaseSubmit } = useSubmitGuard(state)

  /** 이미 처리한 성공 응답. 회원 폼(CommentForm)과 같은 계약이다 */
  const handledRef = useRef<GuestCommentState | null>(null)

  useEffect(() => {
    if (!state.ok && !state.error) return
    /**
     * 🔴 토큰은 1회용이다. 성공이든 실패든 응답을 받으면 새로 받아야 한다.
     *    이 세 줄은 아래 성공 판정보다 **위**에 있어야 한다 — 실패했을 때도 새 토큰이 필요하다.
     */
    setToken('')
    setResetSignal((n) => n + 1)
    setPhase('idle')

    /**
     * 🔴 서버가 방금 한 말로 폼의 오류 칸을 **덮어쓴다**(성공이면 비운다).
     *    렌더에서 state.error 를 직접 읽지 않는 이유다 — 그렇게 하면 지난 응답이
     *    다음 시도 내내 화면에 남아 새 안내를 가린다.
     */
    setFormError(state.error ?? '')

    /**
     * 🔴 여기부터가 성공이다. 위 자리에 계측을 두면 Turnstile 실패·금칙어 같은
     *    거절까지 등록으로 세게 된다 — 이 effect 는 실패에도 들어온다.
     */
    if (!state.ok) return
    if (handledRef.current === state) return
    handledRef.current = state

    /**
     * 🔴 본문과 번호만 비운다. 이름은 남긴다 —
     *    같은 글에 두 줄째를 쓰는 사람에게 이름을 다시 묻지 않는다.
     * 🔴 이름이 남아 있으므로 신원 칸도 열어 둔다.
     */
    setContent('')
    setPassword('')
    setShowSuccess(true)
    /* 🔴 등록됐다는 사실은 토스트가 알린다. 이 자리에는 누를 것(가입 링크)만 남는다 */
    toast.success(parentId ? REPLY_CREATED : COMMENT_CREATED, {
      key: `comment:${parentId ?? postId}`,
    })
    /**
     * 🔴 회원/비회원은 컴포넌트가 이미 갈라져 있으므로 리터럴로 적는다.
     *    세션을 다시 묻지 않는다 — 물으면 두 곳이 되고 언젠가 어긋난다.
     * 🔴 게스트 닉네임·비밀번호·본문은 보내지 않는다. 답글 여부만 boolean 으로 남긴다.
     */
    // 🔴 중복(연타 · 재전송)으로 기존 댓글을 돌려받은 요청은 새 등록으로 세지 않는다(comment-publish.ts)
    if (countsAsNewComment(state)) {
      trackEvent('comment_publish', { member_type: 'guest', is_reply: Boolean(parentId) })
    }
    // 새로 그려진 그 댓글로 이동·포커스한다(서버가 새 목록을 그릴 때까지 기다린다)
    if (state.commentId) nav?.focusPosted(state.commentId)
    onPosted?.()
    // toast 는 매 렌더 새 객체라 의존성에 넣으면 같은 상태로 다시 뜬다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  // 화면을 떠나면 기다림을 놓는다 — 타이머가 남으면 사라진 폼을 다시 보내려 한다
  useEffect(() => () => waitCleanupRef.current?.(), [])

  /**
   * 확인 상자가 떴다/사라졌다는 소식.
   *
   * 🔴 기다리는 중이 아닐 때도 올 수 있다(등록을 누르기 전에 위젯이 먼저 챌린지를 띄우는 경우).
   *    그때는 상태만 적어 두고 화면은 건드리지 않는다.
   */
  const handleInteractiveChange = useCallback((active: boolean) => {
    challengeActiveRef.current = active
    if (active) challengeStartedAtRef.current = Date.now()
    setChallengeActive(active)
    setPhase((current) => {
      if (current === 'idle' || current === 'submitting') return current
      return active ? 'solving-challenge' : 'awaiting-token'
    })
  }, [])

  useAutoResize(textareaRef, content, GUEST_TEXTAREA_MAX_HEIGHT)

  /** 사이트 키가 없는 환경(로컬)에는 위젯이 없다 — 기다릴 것도 없다 */
  const needsToken = TURNSTILE_SITE_KEY.length > 0
  const canSubmit = canSubmitGuestComment({ content, nickname, password })

  /**
   * 토큰이 올 때까지 기다렸다가 폼을 다시 보낸다.
   *
   * 🔴 제한 시간이 있다. 위젯이 끝내 답하지 않으면 사용자는 아무 말도 없는 버튼 앞에
   *    영영 서 있게 된다.
   * 🔴 requestSubmit 으로 다시 보낸다. formAction 을 직접 부르면 폼 제출이 아니라
   *    useFormStatus 가 pending 을 보지 못해 등록 중 표시와 중복 차단이 함께 꺼진다.
   */
  const waitForTokenThenSubmit = useCallback(() => {
    let quietStartedAt = Date.now()

    const stop = () => {
      window.clearInterval(timer)
      waitCleanupRef.current = null
    }

    /**
     * 🔴 기다림을 끝낼 때는 **잠금을 직접 푼다**. 서버까지 가지 못했으므로
     *    useSubmitGuard 가 응답으로 풀어 줄 일이 없다.
     * 🔴 순서: 멈춘다 → 잠금을 푼다 → 단계를 되돌린다 → 말한다.
     *    말을 먼저 하면, 그 사이에 들어온 클릭이 아직 잠긴 폼에 막혀
     *    "안내는 떴는데 눌리지 않는" 한 박자가 생긴다.
     * 🔴 위젯을 reset 하지 않는다. 확인 상자가 떠 있었다면 refresh-timeout(auto)이
     *    Cloudflare 쪽에서 알아서 새로 띄우고, 조용한 대기였다면 굳은 것이 없다.
     */
    const giveUp = (reason: 'quiet' | 'challenge') => {
      stop()
      releaseSubmit()
      setPhase('idle')
      setFormError(reason === 'challenge' ? GUEST_CHALLENGE_TIMEOUT : GUEST_TURNSTILE_TIMEOUT)
    }

    let wasChallengeActive = challengeActiveRef.current

    const timer = window.setInterval(() => {
      /**
       * 🔴 확인 상자가 사라진 순간 조용한 대기를 **새로** 센다.
       *    그러지 않으면 확인을 푸는 데 쓴 시간이 조용한 대기에 그대로 얹혀,
       *    다 풀고 토큰을 받기 직전에 시간 초과로 끊긴다.
       */
      if (wasChallengeActive && !challengeActiveRef.current) quietStartedAt = Date.now()
      wasChallengeActive = challengeActiveRef.current

      const tick = evaluateTokenWait({
        hasToken: tokenRef.current.length > 0,
        challengeActive: challengeActiveRef.current,
        // 확인 상자가 떠 있는 동안에는 조용한 대기 시계를 계속 뒤로 민다 = 멈춘 것과 같다
        quietElapsedMs: challengeActiveRef.current ? 0 : Date.now() - quietStartedAt,
        challengeElapsedMs: challengeActiveRef.current
          ? Date.now() - challengeStartedAtRef.current
          : 0,
        quietLimitMs: QUIET_WAIT_MS,
        challengeLimitMs: CHALLENGE_WAIT_MS,
      })

      if (tick.action === 'submit') {
        stop()
        // 🔴 우리가 보내는 제출도 새 제출이다 — 잠금을 풀었다가 가드가 다시 잠그게 한다
        releaseSubmit()
        formRef.current?.requestSubmit()
        return
      }
      if (tick.action === 'give-up') giveUp(tick.reason)
    }, TOKEN_POLL_MS)

    waitCleanupRef.current = stop
  }, [releaseSubmit])

  /**
   * Cloudflare 가 "확인을 제한 시간 안에 풀지 못했다" 고 알려 줄 때.
   *
   * 🔴 기다리는 중이 **아니면** 화면을 건드리지 않는다. 누르기도 전에 위젯이 혼자
   *    시간 초과된 경우까지 오류로 말하면, 아무 일도 하지 않은 사람에게 경고가 뜬다.
   */
  const handleChallengeTimeout = useCallback(() => {
    if (!waitCleanupRef.current) return
    waitCleanupRef.current()
    releaseSubmit()
    setPhase('idle')
    setFormError(GUEST_CHALLENGE_TIMEOUT)
  }, [releaseSubmit])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    // 🔴 재진입 차단이 먼저다. 막혔으면 아래 판단까지 갈 일이 없다.
    if (!guardSubmit(event)) return

    const plan = planSubmit({ needsToken, hasToken: tokenRef.current.length > 0 })
    if (plan.action === 'send') {
      setFormError('')
      setPhase('submitting')
      return
    }
    // 🔴 여기서부터는 이번 제출을 흘려보내지 않는다 — 기다렸다 우리가 다시 보낸다
    event.preventDefault()
    // 🔴 새 시도다. 지난 응답의 말은 여기서 지운다 — 이 한 줄이 §2 의 핵심이다.
    setFormError('')
    setPhase(challengeActiveRef.current ? 'solving-challenge' : 'awaiting-token')
    waitForTokenThenSubmit()
  }

  /* 🔴 읽는 곳도 하나다. state.error 를 여기서 다시 읽지 않는다 — 그러면 두 출처가 된다. */
  const error = formError || null
  const busy = phase !== 'idle'

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 rounded-2xl border border-subtle bg-surface-card p-4"
    >
      <input type="hidden" name="postId" value={postId} />
      <input type="hidden" name="boardSlug" value={boardSlug} />
      {parentId ? <input type="hidden" name="parentId" value={parentId} /> : null}

      {/* 🔴 답글에는 제목 대신 대상 머리를 둔다 — 누구의 무슨 말에 답하는지 */}
      {parentId && replyTarget ? <ReplyTargetHeader target={replyTarget} gone={goneReason} /> : null}
      {parentId ? null : (
        <p className="m-0 mb-1 text-lg font-bold text-content-primary">{GUEST_COMPOSE_TITLE}</p>
      )}

      {error ? (
        <p role="alert" className="text-sm text-state-danger">
          {error}
        </p>
      ) : showSuccess ? (
        /* 🔴 성공 문구는 토스트로 갔다. 누를 것이 있는 안내만 여기 남는다 —
              사라지는 자리에 링크를 두면 누르기 전에 없어진다.
              🔴 폼 위의 한 줄이다. 폼을 대신하지 않는다 — 두 줄째를 막지 않기 위해서다. */
        <div role="status" className="text-sm">
          <p className="m-0 text-content-muted">
            {GUEST_SIGNUP_HINT}{' '}
            {/* 🔴 밑줄을 붙인다. 색만으로 링크를 구분하지 않는다 —
                   `PostActionBar` · `CommentLikeButton` 의 같은 자리는 이미 갖고 있었다
                   (§12-18 · §12-26). 크기·display 는 건드리지 않는다 — 정본 §13-4. */}
            <Link
              href={`/login?callbackUrl=${encodeURIComponent(pathname)}`}
              className="text-link underline underline-offset-2"
            >
              카카오로 시작하기
            </Link>
          </p>
        </div>
      ) : null}

      {/* 🔴 처음부터 세 줄로 연다. 한 줄짜리 칸은 "한 줄만 쓰라" 는 말처럼 읽혀,
             하고 싶은 말이 있어도 짧게 끊게 만든다.
             🔴 min-h 는 em 이다 — useAutoResize 가 내용에 맞춰 style.height 를 바꿔도
             min-height 가 이기고, em 이라 글자 크기 3단계에서 모두 세 줄을 지킨다.
             rows 만으로는 안 된다: 빈 칸의 scrollHeight 는 한 줄이라 곧바로 줄어든다. */}
      <textarea
        ref={textareaRef}
        name="content"
        rows={3}
        maxLength={MAX_COMMENT_LENGTH}
        value={content}
        onChange={(e) => {
          const next = e.target.value
          setContent(next)
          setIdentityOpen((open) => resolveIdentityOpen(open, next))
          setShowSuccess(false)
          setFormError('')
        }}
        aria-label={replyTarget && !targetGone ? `${replyTarget.name}님에게 보낼 답글` : parentId ? '답글' : '댓글'}
        className="min-h-[6.5em] resize-none overflow-y-auto rounded-lg border border-subtle bg-surface-page p-3 leading-[1.7]"
        placeholder={GUEST_COMMENT_PLACEHOLDER}
      />

      {/* 🔴 처음부터 보여준다. 첫 화면이 칸 하나뿐이라 시끄럽지 않고,
             500 자라는 상한을 다 쓰고 나서야 알게 되는 일이 없다.
             회원 폼은 400 자부터 나타난다 — 그쪽은 첫 화면이 이미 단출하다. */}
      <p
        className={`self-end text-xs ${
          content.length >= COMMENT_COUNTER_WARN_FROM ? 'text-state-warning' : 'text-content-muted'
        }`}
      >
        {content.length}/{MAX_COMMENT_LENGTH}
      </p>

      {/* 🔴 모바일에서는 세로로 쌓는다. 이름·번호·등록을 한 줄에 두면
             글자 크기 "크게" 에서 이름 칸이 두 글자 폭까지 눌린다. */}
      {identityOpen ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-sm text-content-muted">{GUEST_NICKNAME_LABEL}</span>
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

          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-sm text-content-muted">{GUEST_PASSWORD_LABEL}</span>
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
            <span className="text-xs text-content-muted">{GUEST_PASSWORD_HINT}</span>
          </label>
        </div>
      ) : null}

      <input type="hidden" name="turnstileToken" value={token} readOnly />
      {/* 🔴 폼과 함께 한 번만 붙인다. 신원 칸을 따라 붙였다 떼면
             그때마다 새 위젯이 되어 받아 둔 토큰을 잃는다. */}
      <GuestTurnstile
        onToken={setToken}
        resetSignal={resetSignal}
        onInteractiveChange={handleInteractiveChange}
        onChallengeTimeout={handleChallengeTimeout}
      />

      {/* 🔴 확인 상자가 떠 있고 우리가 기다리는 중일 때만 말한다.
             누르기 전에는 아무 말도 하지 않는다 — 아직 사용자의 차례가 아니다. */}
      {challengeActive && phase === 'solving-challenge' ? (
        <p role="status" className="m-0 text-xs text-content-muted">
          {GUEST_CHALLENGE_PENDING}
        </p>
      ) : null}

      {/* 🔴 내용을 가운데로 모은다(justify-center). ActionButton 의 기본은 inline-flex 왼쪽
             정렬이라 전폭으로 늘리면 글자가 왼쪽에 붙어 버튼으로 읽히지 않는다.
             🔴 못 누를 때 윤곽선을 준다. 비활성 배경(--surface-page)은 카드(흰색)와
             1.12:1 이라 면만으로는 버튼이 거기 있는지 보이지 않는다.
             새 색을 만들지 않고 이미 있는 구분선 토큰으로 모양만 세운다.
             🔴 공용 ActionButton 을 고치지 않는다 — 다른 화면의 버튼까지 함께 바뀐다. */}
      <ActionButton
        tone="primary"
        label={parentId ? GUEST_REPLY_SUBMIT_LABEL : GUEST_SUBMIT_LABEL}
        pendingLabel={submitPendingLabel(phase)}
        busy={busy}
        disabled={targetGone || !canSubmit}
        className="mt-1 w-full justify-center disabled:border disabled:border-subtle"
      />
    </form>
  )
}
