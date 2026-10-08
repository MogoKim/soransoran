'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { usePathname } from 'next/navigation'
import KakaoSignInButton from '@/components/features/KakaoSignInButton'
import type { SignupFunnelContentType } from '@/lib/signup-funnel'
import { TOUCH_MIN } from '@/lib/spacing'
import {
  createPromptFlow,
  nextFocusIndex,
  scrollbarCompensation,
  type PromptCloseSource,
} from '@/lib/signup-prompt-flow'
import { signupCallbackPath } from '@/lib/signup-return'

/**
 * 가입 제안 dialog — B안 「이야기를 이어가는 자리」.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §6 · §8-1.
 *
 * 🔴 문구·구조는 정본 §6-2 그대로다. 둘째 줄만 브랜드색, 불렛은 정확히 셋.
 * 🔴 레이어: Toast z-70 > 이 dialog z-60(dim 포함) > Header z-50. fixed overlay 라 본문 흐름에 끼지 않는다.
 * 🔴 열린 동안만 스크롤을 잠근다. 스크롤바가 있던 화면은 그 자리를 비워 둬 본문이 옆으로 밀리지 않게 한다.
 * 🔴 닫기 다섯 길: X · dim · ESC · 「계속 둘러볼게요」 · 뒤로가기. 뒤로가기는 페이지를 떠나지 않고 dialog 만 닫는다.
 *    history 에는 고정 boolean 하나만 넣는다(URL·콘텐츠 값 없음).
 * 🔴 CTA 는 기존 카카오 버튼 하나를 지난다. 인증 호출을 여기서 다시 쓰지 않는다.
 *    첫 시도만 받아들이고 그 순간 「카카오로 이동 중…」, 나머지 버튼은 비활성이다.
 * 🔴 인증 왕복 뒤 bfcache 로 돌아오면 dialog 를 닫는다. 이벤트·표식을 다시 만들지 않고 history 를 되돌리지 않는다.
 * 🔴 callbackUrl 은 지금 상세 경로 + 콘텐츠 유형의 고정 성공 fragment 다(signup-return.ts). 인증 목적에만 쓴다.
 */

const HISTORY_MARKER = 'signupPrompt'
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

export default function SignupPromptDialog({
  contentType,
  onImpression,
  onAuthStart,
  onClosed,
}: {
  contentType: SignupFunnelContentType
  /** dialog 가 실제로 mount 된 뒤 부른다 — ③ 의 한 번은 부르는 쪽 guard 가 보장한다 */
  onImpression: () => void
  /** CTA 가 받아들여진 순간 — 표식·④. 실패해도 인증은 시작한다 */
  onAuthStart: () => void
  onClosed: () => void
}) {
  const titleId = useId()
  const pathname = usePathname()
  const panelRef = useRef<HTMLDivElement>(null)
  const flow = useRef(createPromptFlow()).current
  const [pending, setPending] = useState(false)
  const restore = useRef<{ focus: HTMLElement | null; scrollY: number } | null>(null)
  const historyPushed = useRef(false)
  const closed = useRef(false)

  // 열림 — 초점 · 스크롤 잠금 · 뒤로가기 · bfcache · ③
  useEffect(() => {
    flow.open()
    if (!restore.current) {
      const active = document.activeElement
      restore.current = { focus: active instanceof HTMLElement ? active : null, scrollY: window.scrollY }
    }

    const html = document.documentElement
    const body = document.body
    const previous = { overflow: body.style.overflow, gutter: html.style.scrollbarGutter }
    if (scrollbarCompensation(window.innerWidth, html.clientWidth) > 0) html.style.scrollbarGutter = 'stable'
    body.style.overflow = 'hidden'

    if (!historyPushed.current) {
      historyPushed.current = true
      window.history.pushState({ [HISTORY_MARKER]: true }, '')
    }
    const onPopState = () => {
      if (flow.close('back')) finish()
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted && flow.restoreFromCache()) finish()
    }
    window.addEventListener('popstate', onPopState)
    window.addEventListener('pageshow', onPageShow)

    panelRef.current?.focus({ preventScroll: true })
    onImpression()

    return () => {
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('pageshow', onPageShow)
      body.style.overflow = previous.overflow
      html.style.scrollbarGutter = previous.gutter
      if (closed.current && restore.current) {
        window.scrollTo(0, restore.current.scrollY)
        restore.current.focus?.focus({ preventScroll: true })
      }
    }
    // 🔴 mount 한 번의 일이다. 부르는 쪽 함수가 바뀌어도 다시 열지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function finish(): void {
    closed.current = true
    onClosed()
  }

  function requestClose(source: PromptCloseSource): void {
    if (!flow.close(source)) return
    // 뒤로가기가 아닌 닫기는 우리가 넣은 history 한 칸을 되돌린다 — 다음 뒤로가기가 글을 떠나게
    if (historyPushed.current && (window.history.state as Record<string, unknown> | null)?.[HISTORY_MARKER] === true) {
      window.history.back()
    }
    finish()
  }

  function handleSignInStart(): boolean {
    if (!flow.startSignIn()) return false
    setPending(true)
    try {
      onAuthStart()
    } catch {
      // 계측·표식 실패가 인증 시작을 막지 않는다
    }
    return true
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      requestClose('escape')
      return
    }
    if (event.key !== 'Tab') return
    const panel = panelRef.current
    if (!panel) return
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
    event.preventDefault()
    const next = nextFocusIndex(items.length, items.indexOf(document.activeElement as HTMLElement), event.shiftKey)
    if (next < 0) panel.focus({ preventScroll: true })
    else items[next].focus({ preventScroll: true })
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      <div aria-hidden className="absolute inset-0 bg-content-primary opacity-[0.48]" onClick={() => requestClose('dim')} />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="relative w-full rounded-t-[22px] bg-surface-card px-5 pb-[calc(16px+env(safe-area-inset-bottom,0px))] pt-6 shadow-modal outline-none motion-safe:duration-200 motion-safe:animate-in motion-safe:slide-in-from-bottom md:mb-6 md:max-w-[600px] md:rounded-[22px]"
      >
        <button
          type="button"
          aria-label="가입 제안 닫기"
          disabled={pending}
          onClick={() => requestClose('close-button')}
          className="absolute right-1 top-1 inline-flex h-[52px] w-[52px] items-center justify-center rounded-full text-content-muted transition duration-150 hover:bg-surface-soft disabled:opacity-50"
        >
          <svg aria-hidden width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        <h2 id={titleId} className="m-0 pr-12 text-xl font-bold leading-[1.35] text-content-primary">
          마음에 남은 이야기를
          <br />
          <span className="text-brand-ink">계속 이어가세요</span>
        </h2>

        <ul className="m-0 mt-[14px] flex list-disc flex-col gap-[10px] pl-5 text-content-primary">
          <li>내 이야기를 글로 남기기</li>
          <li>마음에 닿은 글에 공감하기</li>
          <li>댓글로 편하게 이야기 나누기</li>
        </ul>

        <div className="mt-[22px] flex flex-col gap-1">
          <KakaoSignInButton
            variant="prompt"
            label={pending ? '카카오로 이동 중…' : '카카오로 시작하기'}
            disabled={pending}
            callbackUrl={signupCallbackPath(pathname, contentType)}
            onSignInStart={handleSignInStart}
          />
          <button
            type="button"
            disabled={pending}
            onClick={() => requestClose('secondary')}
            className={`inline-flex ${TOUCH_MIN} w-full items-center justify-center rounded-xl text-content-muted transition duration-150 hover:bg-surface-soft disabled:opacity-50`}
          >
            계속 둘러볼게요
          </button>
        </div>
      </div>
    </div>
  )
}
