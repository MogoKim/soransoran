'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import CommentDock from '@/components/features/CommentDock'
import { useComposeMode } from '@/components/features/ComposeModeProvider'
import {
  FORM_NEAR_MARGIN_PX,
  KEYBOARD_MIN_SHRINK_PX,
  resolveComposeBarVisible,
  resolveScrollBehavior,
} from '@/lib/comment-compose-bar'

/** Tailwind md 미만 — CommentDock 의 `md:hidden` 과 같은 경계다 */
const MOBILE_QUERY = '(max-width: 767.98px)'

/** 스크롤해서 세울 때 고정 헤더 아래로 남기는 숨 */
const SCROLL_GAP = 12

/** 키보드가 올라온 뒤 가림을 한 번 더 보정할 때 입력칸 아래에 남기는 숨 */
const KEYBOARD_SAFE_GAP = 8

/** 키보드가 자리를 잡기를 기다리는 시간. 지나면 보정을 포기한다 */
const KEYBOARD_SETTLE_MS = 700

/**
 * 화면 위에 붙어 있는 것들의 아래 끝(px).
 *
 * 🔴 값을 상수로 적지 않는다. Header(64) · IconMenu(90) 는 각자의 파일이 정하고,
 *    토스트가 이미 그 숫자를 따로 갖고 있다. 여기까지 세 번째 사본을 만들면
 *    셋 중 하나는 반드시 낡는다. 지금 화면에 붙어 있는 것을 그때그때 잰다.
 * 🔴 위쪽에 붙은 것만 센다. 아래에 붙는 것(하단 바 자신)을 세면 목적지가 거꾸로 간다.
 */
function stickyChromeBottom(): number {
  let bottom = 0
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('header, nav'))) {
    const position = window.getComputedStyle(el).position
    if (position !== 'sticky' && position !== 'fixed') continue
    const rect = el.getBoundingClientRect()
    if (rect.top > window.innerHeight / 2) continue
    bottom = Math.max(bottom, rect.bottom)
  }
  return bottom
}

/**
 * 댓글 작성 영역과 하단 진입 바를 잇는다.
 *
 * 🔴 폼을 옮기지 않는다. 예전에는 바를 누르면 같은 폼을 화면 아래 시트로 보내고
 *    뒤를 어둡게 덮었는데, 쓰는 동안 읽던 댓글이 보이지 않았다.
 *    지금은 **가리키기만 한다** — 원래 자리로 데려가 커서를 놓는다.
 *    그래서 폼은 여전히 한 벌이고, 쓰던 내용도 Turnstile 위젯도 옮겨질 일이 없다.
 *
 * 🔴 스크롤·포커스는 여기 한 곳에서만 한다. 회원 폼과 비회원 폼이 각자 하면
 *    한쪽만 고쳐지는 날이 온다 — 이 컴포넌트가 둘을 함께 감싸는 이유다.
 */
export default function CommentComposeAnchor({
  children,
  enabled,
}: {
  children: ReactNode
  /** 바를 둘 만한 글인가 — 댓글이 있는가를 부모가 판단해 넘긴다 */
  enabled: boolean
}) {
  const areaRef = useRef<HTMLDivElement>(null)
  const [isMobile, setIsMobile] = useState(false)
  const [sectionPassed, setSectionPassed] = useState(false)
  const [formNear, setFormNear] = useState(true)
  const [composing, setComposing] = useState(false)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const [tallEnough, setTallEnough] = useState(false)
  const { otherComposerOpen } = useComposeMode()

  /** 키보드 보정을 도중에 그만두는 손잡이. 화면을 떠날 때 반드시 부른다 */
  const settleCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY)
    const update = () => setIsMobile(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  /**
   * 🔴 좌표를 재지 않고 브라우저에게 묻는다.
   *    기준은 두 가지뿐이다 — 댓글 섹션이 화면에 걸쳐 있는가, 폼이 코앞인가.
   *    섹션을 통째로 지나가면(다음 읽을 글 · 글쓰기 CTA 자리) 관찰이 저절로 꺼져
   *    바도 함께 사라진다.
   */
  useEffect(() => {
    const area = areaRef.current
    if (!area || !isMobile) return

    // 섹션을 못 잡으면 바로 위 묶음으로 대신한다 — 그래도 "지났는가" 는 답할 수 있다
    const section = area.closest('section') ?? area.parentElement
    if (!section) return

    const measure = () => setTallEnough(section.getBoundingClientRect().height >= window.innerHeight)
    measure()

    const sectionObserver = new IntersectionObserver(
      ([entry]) => setSectionPassed(entry?.isIntersecting ?? false),
      { threshold: 0 },
    )
    sectionObserver.observe(section)

    const formObserver = new IntersectionObserver(
      ([entry]) => setFormNear(entry?.isIntersecting ?? true),
      { threshold: 0, rootMargin: `0px 0px ${FORM_NEAR_MARGIN_PX}px 0px` },
    )
    formObserver.observe(area)

    // 글자 크기를 바꾸거나 화면을 돌리면 섹션 높이가 달라진다
    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(section)

    return () => {
      sectionObserver.disconnect()
      formObserver.disconnect()
      resizeObserver.disconnect()
    }
  }, [isMobile])

  /**
   * 소프트 키보드 보조 감지.
   *
   * 🔴 focus 만 믿지 않는다. 키보드를 열어 둔 채 화면을 건드리면 포커스가 빠지는
   *    브라우저가 있고, 그때 바가 키보드 뒤에서 되살아난다.
   * 🔴 이것은 **감지**만 한다. 예전처럼 bottom·maxHeight 를 계산해 넣지 않는다 —
   *    그 계산은 화면 아래 시트를 키보드 위로 올리려던 것이고, 시트는 이제 없다.
   *    인라인 폼의 가림은 브라우저(viewport interactive-widget)와 아래 보정이 맡는다.
   */
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const update = () => {
      const shrink = window.innerHeight - viewport.height - viewport.offsetTop
      setKeyboardOpen(shrink > KEYBOARD_MIN_SHRINK_PX)
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])

  /**
   * 화면을 떠날 때 기다리던 보정을 반드시 놓는다.
   * 🔴 리스너·타이머뿐 아니라 **예약된 프레임까지** 함께 취소된다(abort) —
   *    그러지 않으면 다음 페이지에서 스크롤이 튄다.
   */
  useEffect(() => () => settleCleanupRef.current?.(), [])

  /**
   * 키보드가 올라온 뒤 입력칸이 가려졌으면 한 번만 끌어올린다.
   *
   * 🔴 우리가 세운 위치는 키보드가 열리기 **전** 기준이다. 키보드가 올라오면
   *    보이는 높이가 줄고, 브라우저가 알아서 스크롤하는 폭도 기기마다 다르다.
   *    그래서 자리가 잡힌 뒤 실제로 가려졌을 때만 그만큼 민다.
   * 🔴 한 번만 한다. 계속 붙어 있으면 사용자가 스크롤해 둔 자리를 계속 되돌린다.
   */
  const correctAfterKeyboard = useCallback((field: HTMLElement) => {
    const viewport = window.visualViewport
    if (!viewport) return

    // 앞선 보정이 아직 살아 있으면 전부 놓고 시작한다
    settleCleanupRef.current?.()

    /**
     * 예약해 둔 보정의 번호. 0 이면 예약된 것이 없다.
     *
     * 🔴 번호를 들고 있어야 취소할 수 있다. 예전에는 requestAnimationFrame 을 부르고
     *    번호를 버렸다. 리스너와 타이머는 정리되는데 **예약된 프레임만 살아남아**,
     *    화면을 떠난 뒤에 다음 페이지에서 scrollBy 가 실행됐다.
     */
    let frame = 0
    let stopped = false

    const cancelFrame = () => {
      if (!frame) return
      window.cancelAnimationFrame(frame)
      frame = 0
    }

    /** 더 듣지 않는다. 이미 예약된 보정은 건드리지 않는다 */
    const stopListening = () => {
      if (stopped) return
      stopped = true
      viewport.removeEventListener('resize', onResize)
      window.clearTimeout(timer)
    }

    /**
     * 전부 놓는다 — 화면을 떠날 때, 새 보정을 시작할 때, 기다리다 지쳤을 때.
     * 🔴 손잡이를 비우는 것은 **아직 내 것일 때만** 한다.
     *    새 보정이 이미 자리를 잡았는데 지난 보정이 비우면 새 것을 놓치게 된다.
     */
    const abort = () => {
      stopListening()
      cancelFrame()
      if (settleCleanupRef.current === abort) settleCleanupRef.current = null
    }

    function onResize() {
      // 🔴 한 번만 본다. 듣기를 먼저 끊고, 혹시 남아 있을 예약도 지운 뒤 새로 잡는다.
      stopListening()
      cancelFrame()
      frame = window.requestAnimationFrame(() => {
        frame = 0
        const vv = window.visualViewport
        if (!vv) return
        const rect = field.getBoundingClientRect()
        const visibleBottom = vv.height + vv.offsetTop
        const overflow = rect.bottom - (visibleBottom - KEYBOARD_SAFE_GAP)
        if (overflow > 0) window.scrollBy({ top: overflow, behavior: 'auto' })
      })
    }

    const timer = window.setTimeout(abort, KEYBOARD_SETTLE_MS)
    viewport.addEventListener('resize', onResize)
    settleCleanupRef.current = abort
  }, [])

  const focusComposer = useCallback(() => {
    const area = areaRef.current
    const field = area?.querySelector('textarea')
    if (!area || !field) return

    /**
     * 🔴 focus 가 먼저다. iOS 는 사용자가 누른 것과 **같은 tick** 에서 focus() 해야
     *    키보드를 연다. 스크롤이 끝나기를 기다렸다 부르면 키보드가 열리지 않는다.
     * 🔴 preventScroll 로 브라우저의 기본 스크롤을 끈다. 어디로 갈지는 우리가 정한다.
     */
    field.focus({ preventScroll: true })

    const top = Math.max(
      0,
      area.getBoundingClientRect().top + window.scrollY - stickyChromeBottom() - SCROLL_GAP,
    )
    const behavior = resolveScrollBehavior({
      distance: Math.abs(top - window.scrollY),
      viewportHeight: window.innerHeight,
      reduceMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    })
    window.scrollTo({ top, behavior })

    correctAfterKeyboard(field)
  }, [correctAfterKeyboard])

  const visible = resolveComposeBarVisible({
    enabled: enabled && tallEnough,
    sectionPassed,
    formNear,
    composing,
    keyboardOpen,
    otherComposerOpen,
  })

  return (
    <>
      {/* 🔴 포커스 추적은 이 묶음만 본다. 바를 여기 안에 두면 바를 누르는 순간
            포커스가 들어와 바가 사라지고, 그 클릭이 끝나지 못한다. */}
      <div
        ref={areaRef}
        className="mt-4"
        onFocus={() => setComposing(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setComposing(false)
        }}
      >
        {children}
      </div>

      {visible ? <CommentDock onActivate={focusComposer} /> : null}
    </>
  )
}
