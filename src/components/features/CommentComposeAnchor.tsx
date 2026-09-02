'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import CommentDock from '@/components/features/CommentDock'
import { useReplyOpen } from '@/components/features/ReplyOpenProvider'
import { resolveDockVisible } from '@/lib/comment-dock-visibility'

/** max-md 가 켜지는 폭. 이보다 넓으면 키보드 보정을 걸지 않는다 */
const FIXED_MAX_WIDTH = 768
/** 이 이하는 키보드가 올라온 것으로 보지 않는다 */
const KEYBOARD_THRESHOLD = 30
/** 시트 위에 남기는 여백 — 전체 화면이 아니라 올라온 시트로 읽히게 한다 */
const SHEET_TOP_GAP = 24
/** 가로 키보드 같은 극단 상황의 하한 */
const SHEET_MIN_HEIGHT = 200

/**
 * z-[61] 은 Header(50)·IconMenu(40) 위다.
 * 그 아래에 두면 키보드가 올라와 화면이 좁아졌을 때 시트 윗부분이 메뉴에 덮인다.
 */
const COMPOSER_CLASS =
  'max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-[61] max-md:max-h-[55dvh] max-md:overflow-y-auto max-md:overscroll-contain max-md:border-t max-md:border-subtle max-md:bg-surface-card max-md:px-4 max-md:pb-[max(12px,env(safe-area-inset-bottom))] max-md:pt-2'

/**
 * 댓글 입력 영역을 감싸 하단 진입점과 연결한다.
 *
 * 🔴 폼은 한 벌뿐이다. 여는 것은 자리를 바꾸는 일이지 새로 만드는 일이 아니다 —
 *    같은 인스턴스의 className 만 바뀌므로 쓰던 내용도 이름·비밀번호도
 *    Turnstile 위젯도 그대로 남는다.
 */
export default function CommentComposeAnchor({ children }: { children: ReactNode }) {
  const areaRef = useRef<HTMLDivElement>(null)
  const [dockVisible, setDockVisible] = useState(false)
  const [composing, setComposing] = useState(false)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  // fixed 로 빠지면 흐름에서 나가 아래 콘텐츠가 위로 밀린다 — 원래 높이를 자리로 남긴다
  const [reservedHeight, setReservedHeight] = useState<number>()
  const { openParentId } = useReplyOpen()

  const open = useCallback(() => {
    setReservedHeight(areaRef.current?.getBoundingClientRect().height)
    setComposing(true)
  }, [])

  const close = useCallback(() => {
    setComposing(false)
    setKeyboardOpen(false)
    setReservedHeight(undefined)
  }, [])

  // 답글을 열면 이쪽은 물러난다 — 하단에 입력이 둘이면 어디에 쓰는지 알 수 없다
  useEffect(() => {
    if (openParentId !== null) close()
  }, [openParentId, close])

  useEffect(() => {
    if (composing) return

    let frame = 0
    const evaluate = () => {
      frame = 0
      const node = areaRef.current
      if (!node) return
      const rect = node.getBoundingClientRect()
      // 섹션을 못 잡으면 입력폼 위치로 대신한다
      const section = node.closest('section')
      setDockVisible(
        resolveDockVisible({
          inputTop: rect.top,
          inputBottom: rect.bottom,
          sectionTop: section ? section.getBoundingClientRect().top : rect.top,
          viewportHeight: window.innerHeight,
          scrollY: window.scrollY,
        }),
      )
    }

    // 스크롤마다 레이아웃을 재는 대신 프레임당 1회로 묶는다
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(evaluate)
    }

    evaluate()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [composing])

  // 전환 렌더가 끝난 뒤여야 커서가 잡힌다
  useEffect(() => {
    if (!composing) return
    const id = window.setTimeout(() => {
      areaRef.current?.querySelector('textarea')?.focus({ preventScroll: true })
    }, 60)
    return () => window.clearTimeout(id)
  }, [composing])

  /**
   * 키보드가 올라온 만큼 바닥을 올리고, 보이는 높이에 맞춰 시트를 자른다.
   *
   * 🔴 maxHeight 를 함께 보정해야 한다. dvh 는 주소창에는 반응하지만 키보드에는 반응하지 않아,
   *    상한만 믿으면 시트가 가시 영역보다 커져 입력창과 등록 버튼이 키보드에 덮인다.
   * 🔴 iOS 는 화면 자체를 밀어 올리므로 offsetTop 을 반드시 뺀다.
   * 키보드가 layout viewport 를 줄이는 환경은 계산값이 0 이라 저절로 no-op 이 된다.
   */
  useEffect(() => {
    if (!composing) return
    const el = areaRef.current
    const viewport = window.visualViewport
    if (!el || !viewport) return

    const clear = () => {
      el.style.bottom = ''
      el.style.maxHeight = ''
      setKeyboardOpen(false)
    }

    const update = () => {
      // max-md 가 꺼지는 폭에서 걸면 fixed 가 아닌 데스크탑 레이아웃까지 잘린다
      if (window.innerWidth >= FIXED_MAX_WIDTH) {
        clear()
        return
      }
      const keyboard = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
      if (keyboard <= KEYBOARD_THRESHOLD) {
        clear()
        return
      }
      el.style.bottom = `${Math.round(keyboard)}px`
      el.style.maxHeight = `${Math.max(SHEET_MIN_HEIGHT, Math.round(viewport.height - SHEET_TOP_GAP))}px`
      setKeyboardOpen(true)
    }

    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      // 인라인 스타일이 남으면 인라인 상태의 레이아웃을 깬다
      clear()
    }
  }, [composing])

  return (
    <div className="mt-4" style={reservedHeight ? { minHeight: reservedHeight } : undefined}>
      <div
        ref={areaRef}
        className={
          composing
            ? `${COMPOSER_CLASS}${keyboardOpen ? ' max-md:rounded-t-2xl' : ''}`
            : undefined
        }
      >
        {composing ? (
          <div className="sticky top-0 z-10 -mx-4 mb-2 flex items-center justify-between bg-surface-card px-4 pt-1 md:hidden">
            <span className="text-sm font-bold text-content-primary">댓글 쓰는 중</span>
            <button
              type="button"
              onClick={close}
              aria-label="댓글 입력 닫기"
              className="flex min-h-[52px] min-w-[52px] items-center justify-center rounded-full text-content-muted transition duration-150 active:scale-[0.98]"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : null}
        {children}
      </div>

      {/* 뒤를 가라앉힌다. 눌러도 닫지 않는다 — 바깥 탭으로 닫으면 쓰던 글을 잃었다고 느낀다.
          면을 덮는 것만으로 뒤 링크 오클릭은 막힌다.
          🔴 입력 영역 뒤에 둔다. 앞에 넣으면 자식 index 가 밀려 Turnstile 이 remount 된다.
          🔴 색과 투명도를 나눠 적는다 — 토큰이 var() 라 bg-x/50 은 유틸리티가 생성되지 않는다. */}
      {composing ? (
        <div aria-hidden className="fixed inset-0 z-[60] bg-content-primary opacity-50 md:hidden" />
      ) : null}

      {dockVisible && !composing && openParentId === null ? <CommentDock onOpen={open} /> : null}
    </div>
  )
}
