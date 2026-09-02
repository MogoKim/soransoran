'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import CommentDock from '@/components/features/CommentDock'
import { useReplyOpen } from '@/components/features/ReplyOpenProvider'
import { resolveDockVisible } from '@/lib/comment-dock-visibility'

/** 열린 동안만 붙는다. 데스크탑은 원래 자리 그대로다. */
const COMPOSER_CLASS =
  'max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-30 max-md:max-h-[70dvh] max-md:overflow-y-auto max-md:overscroll-contain max-md:border-t max-md:border-subtle max-md:bg-surface-card max-md:px-4 max-md:pb-[max(12px,env(safe-area-inset-bottom))] max-md:pt-2'

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
  // fixed 로 빠지면 흐름에서 나가 아래 콘텐츠가 위로 밀린다 — 원래 높이를 자리로 남긴다
  const [reservedHeight, setReservedHeight] = useState<number>()
  const { openParentId } = useReplyOpen()

  const open = useCallback(() => {
    setReservedHeight(areaRef.current?.getBoundingClientRect().height)
    setComposing(true)
  }, [])

  const close = useCallback(() => {
    setComposing(false)
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
   * 키보드가 올라온 만큼 바닥을 올린다 — PostEditor 툴바와 같은 방식이다.
   * iOS 는 화면 자체를 밀어 올리므로 offsetTop 을 반드시 뺀다.
   * 키보드가 layout viewport 를 줄이는 환경은 계산값이 0 이라 저절로 no-op 이 된다.
   */
  useEffect(() => {
    if (!composing) return
    const el = areaRef.current
    const viewport = window.visualViewport
    if (!el || !viewport) return

    const update = () => {
      const keyboard = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
      el.style.bottom = keyboard > 0 ? `${Math.round(keyboard)}px` : ''
    }

    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      el.style.bottom = ''
    }
  }, [composing])

  return (
    <div className="mt-4" style={reservedHeight ? { minHeight: reservedHeight } : undefined}>
      <div ref={areaRef} className={composing ? COMPOSER_CLASS : undefined}>
        {composing ? (
          <div className="mb-2 flex items-center justify-between md:hidden">
            <span className="text-sm font-bold text-content-primary">댓글 쓰기</span>
            <button
              type="button"
              onClick={close}
              className="min-h-[52px] px-2 text-sm text-content-muted transition duration-150 active:scale-[0.98]"
            >
              그만두기
            </button>
          </div>
        ) : null}
        {children}
      </div>

      {dockVisible && !composing && openParentId === null ? <CommentDock onOpen={open} /> : null}
    </div>
  )
}
