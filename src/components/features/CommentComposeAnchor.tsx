'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import CommentDock from '@/components/features/CommentDock'
import { useComposeMode } from '@/components/features/ComposeModeProvider'
import {
  ACTION_BAR_HIDE_OUTSET_PX,
  ACTION_BAR_MARK,
  ACTION_BAR_SHOW_INSET_PX,
  FORM_NEAR_MARGIN_PX,
  KEYBOARD_MIN_SHRINK_PX,
  SCROLL_JUMP_RATIO,
  SCROLL_SETTLE_MS,
  SCROLL_START_GAP_PX,
  SCROLL_START_MARK,
  resolveActionBarPassed,
  resolveComposeBarVisible,
  resolveFormPosition,
  resolveMovedFromTop,
  resolveScrollBehavior,
  type FormPosition,
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
export default function CommentComposeAnchor({ children }: { children: ReactNode }) {
  const areaRef = useRef<HTMLDivElement>(null)
  const [isMobile, setIsMobile] = useState(false)
  const [actionBarPassed, setActionBarPassed] = useState(false)
  const [movedFromTop, setMovedFromTop] = useState(false)
  const [formPosition, setFormPosition] = useState<FormPosition>('below')
  const [composing, setComposing] = useState(false)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
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
   * 🔴 관찰은 **"지금 다시 재 보라" 는 신호**로만 쓴다. 판단은 measure() 한 곳에서만 한다.
   *
   *    예전에는 IntersectionObserver 의 isIntersecting 을 그대로 상태로 삼았다.
   *    그 값은 "교차하지 않는다" 만 말할 뿐 위인지 아래인지를 구분하지 못하고,
   *    큰 폭으로 건너뛴 스크롤(스크롤 복원 · 해시 이동)에서는 교차 상태가 바뀌지 않아
   *    **콜백 자체가 오지 않는다**. 그래서 판단과 신호를 갈랐다 —
   *    관찰이 와도, 우리가 직접 재도, 답을 내는 함수는 언제나 같다.
   *
   * 🔴 신호는 셋이다: 관찰(경계 통과) · 큰 폭 이동 · 화면 크기 변화.
   *    평소 스크롤에서는 scrollY 만 읽고 아무것도 재지 않는다.
   */
  useEffect(() => {
    const area = areaRef.current
    if (!area || !isMobile) return

    const actionBar = document.querySelector(`[${ACTION_BAR_MARK}]`)
    const scrollStart = document.querySelector(`[${SCROLL_START_MARK}]`)

    let frame = 0

    const measure = () => {
      frame = 0
      const viewportHeight = window.innerHeight

      const areaRect = area.getBoundingClientRect()
      setFormPosition(
        resolveFormPosition({ top: areaRect.top, bottom: areaRect.bottom, viewportHeight }),
      )

      if (actionBar) {
        const { top } = actionBar.getBoundingClientRect()
        setActionBarPassed((previous) => resolveActionBarPassed({ previous, top, viewportHeight }))
      }
      if (scrollStart) {
        setMovedFromTop(resolveMovedFromTop({ top: scrollStart.getBoundingClientRect().top }))
      }
    }

    // 여러 신호가 한 프레임에 겹쳐도 재는 일은 한 번이다
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure)
    }

    measure()

    /**
     * 🔴 경계마다 신호가 필요하다. 공감·공유 줄은 선이 둘이라(표시 -24 · 숨김 +64)
     *    관찰도 둘이다 — 한 관찰만 두면 나머지 선을 지날 때 아무 신호도 오지 않는다.
     */
    /**
     * 🔴 관찰 선을 **판정 선과 같은 자리**에 둔다. 어긋나면 그 사이 구간에 신호가 없어
     *    멈춤 타이머가 메꿀 때까지 판단이 낡는다(실측 fx-empty y=2220~2400).
     *
     *    폼의 판정 선은 화면 바닥보다 96px **아래**다(resolveFormPosition).
     *    rootMargin 의 아래쪽 값을 +96 으로 주면 관찰 범위가 딱 그 선까지 넓어져,
     *    폼이 화면에 들어오기 전에 신호가 온다 — 비키는 일이 먼저 끝난다.
     */
    const watch: Array<{ target: Element; rootMargin: string }> = [
      { target: area, rootMargin: `0px 0px ${FORM_NEAR_MARGIN_PX}px 0px` },
    ]
    if (actionBar) {
      watch.push({ target: actionBar, rootMargin: `0px 0px -${ACTION_BAR_SHOW_INSET_PX}px 0px` })
      watch.push({ target: actionBar, rootMargin: `0px 0px ${ACTION_BAR_HIDE_OUTSET_PX}px 0px` })
    }
    if (scrollStart) {
      watch.push({ target: scrollStart, rootMargin: `-${SCROLL_START_GAP_PX}px 0px 0px 0px` })
    }

    const observers = watch.map(({ target, rootMargin }) => {
      const observer = new IntersectionObserver(schedule, { threshold: 0, rootMargin })
      observer.observe(target)
      return observer
    })

    /**
     * 🔴 스크롤 중에는 아무것도 재지 않는다. **멈추면** 한 번 잰다.
     *
     *    관찰은 경계를 지날 때만 온다. 경계를 건드리지 않는 이동에서는 신호가 없어
     *    판단이 낡는다 — 그래서 멈춤을 마지막 신호로 삼는다.
     *    크게 뛴 이동은 멈춤을 기다리지 않고 그 자리에서 맞춘다.
     */
    let settleTimer = 0
    let lastY = window.scrollY

    const onScroll = () => {
      const y = window.scrollY
      const jumped = Math.abs(y - lastY) > window.innerHeight * SCROLL_JUMP_RATIO
      lastY = y
      window.clearTimeout(settleTimer)
      if (jumped) {
        schedule()
        return
      }
      settleTimer = window.setTimeout(schedule, SCROLL_SETTLE_MS)
    }

    /** 뒤로가기로 되살아난 화면은 다시 그리지 않는다 — 그때도 한 번 잰다 */
    const onPageShow = () => {
      lastY = window.scrollY
      schedule()
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    window.addEventListener('pageshow', onPageShow)

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.clearTimeout(settleTimer)
      observers.forEach((observer) => observer.disconnect())
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('pageshow', onPageShow)
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
    actionBarPassed,
    movedFromTop,
    formPosition,
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
