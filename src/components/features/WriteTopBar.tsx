'use client'

import { useCallback, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useFormStatus } from 'react-dom'
import { cn } from '@/lib/utils'

/** 상단바 높이. 본문 위쪽 여백이 같은 값을 쓴다. */
export const WRITE_TOP_BAR_HEIGHT = 56

/**
 * 글쓰기·수정 전용 상단바.
 *
 * 🔴 이 화면에서는 로고·게시판 메뉴·Footer 를 걷어 내고 이것만 남긴다.
 *    글을 쓰는 동안 갈 수 있는 곳이 여러 군데 보이면 "구경 중" 이 된다.
 *    나가는 길 하나(취소)와 끝내는 길 하나(등록)만 둔다.
 *
 * 🔴 등록 버튼을 여기 둔다. 키보드가 열려 화면 아래가 통째로 덮여도
 *    누를 곳이 남아 있어야 한다. 아래쪽 버튼 하나만 두면 키보드 뒤로 숨는다.
 *
 * 🔴 되는지 안 되는지를 색이 아니라 '채워진 알약 vs 회색 알약' 으로 가른다.
 *    모양이 고정이라 같은 자리에서 항상 보이고, 색만으로 가르면
 *    화면을 밝게 보는 분께는 두 상태가 같아 보인다.
 *
 * 🔴 바깥 button 이 터치 영역(52px)을 지고 안쪽 span 이 보이는 알약이다.
 *    알약을 그대로 키우면 글씨 옆 여백까지 커져 상단바가 두꺼워진다.
 */
export default function WriteTopBar({
  title,
  submitLabel,
  pendingLabel,
  canSubmit,
  cancelHref,
}: {
  title: string
  submitLabel: string
  pendingLabel: string
  canSubmit: boolean
  cancelHref: string
}) {
  const { pending } = useFormStatus()

  /**
   * 🔴 키보드가 열리면 상단바가 화면 위로 밀려 나간다.
   *    position:fixed 의 기준은 layout viewport 인데, 모바일 브라우저는 키보드를
   *    올릴 때 layout viewport 를 그대로 두고 visual viewport 만 아래로 민다.
   *    밀린 만큼(offsetTop) 되돌려 내려야 상단바가 화면 맨 위에 남는다.
   *
   * 🔴 ref 콜백으로 입힌다. 폼이 다시 그려져 상단바가 새로 붙어도
   *    그 자리에서 마지막 값을 바로 다시 입힌다 — effect 를 기다리면 한 프레임 튄다.
   */
  const barRef = useRef<HTMLDivElement | null>(null)
  const offsetRef = useRef(0)
  const apply = useCallback((el: HTMLDivElement | null) => {
    if (el) el.style.transform = `translateY(${offsetRef.current}px)`
  }, [])
  const setBar = useCallback(
    (el: HTMLDivElement | null) => {
      barRef.current = el
      apply(el)
    },
    [apply],
  )

  useEffect(() => {
    const vv = window.visualViewport
    // visualViewport 가 없는 브라우저는 손대지 않는다 — 그냥 fixed top-0 으로 둔다.
    if (!vv) return
    const update = () => {
      const next = Math.max(0, Math.round(vv.offsetTop))
      if (next === offsetRef.current) return
      offsetRef.current = next
      apply(barRef.current)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [apply])

  const ready = canSubmit && !pending

  return (
    <div
      ref={setBar}
      className="fixed inset-x-0 top-0 z-40 flex h-[56px] items-center justify-between border-b border-subtle bg-surface-card px-2 will-change-transform"
    >
      <Link
        href={cancelHref}
        className="inline-flex min-h-[52px] min-w-[52px] items-center px-2 text-content-muted no-underline"
      >
        취소
      </Link>

      {/* 🔴 제목은 가운데 한 줄로 묶는다. 게시판 이름이 길어도 좌우 버튼을 밀지 않게
             넘치는 만큼 줄임표로 접는다. */}
      <span className="truncate px-2 font-bold text-content-primary">{title}</span>

      <button
        type="submit"
        disabled={!ready}
        className="inline-flex min-h-[52px] min-w-[52px] items-center justify-end px-2"
      >
        <span
          className={cn(
            'inline-flex h-[40px] items-center rounded-full px-4 font-bold transition-colors',
            ready ? 'bg-cta text-cta-text' : 'bg-surface-page text-content-muted',
          )}
        >
          {pending ? pendingLabel : submitLabel}
        </span>
      </button>
    </div>
  )
}
