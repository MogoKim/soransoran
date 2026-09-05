'use client'

import { useEffect, useRef } from 'react'
import { TOUCH_MIN } from '@/lib/spacing'

/**
 * 아래에서 올라오는 시트. 넓은 화면에서는 가운데 모달이 된다.
 *
 * 🔴 열려 있는 동안 뒤 화면이 스크롤되지 않게 잠근다.
 *    시트를 밀었는데 뒤 목록이 움직이면 어디를 만지고 있는지 알 수 없다.
 *
 * 🔴 Esc 와 바깥 누르기로 닫는다. 닫는 길을 하나만 두지 않는다.
 */
export default function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // 열리면 시트 안으로 초점을 옮긴다 — 뒤 화면에 초점이 남으면 화면 밖을 조작하게 된다
    panelRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      {/* 바깥 면. 버튼이 아니라 배경이라 aria-hidden 으로 두고 닫기만 맡긴다.
          🔴 새 색을 만들지 않는다 — 본문 먹색을 반투명으로 깐다. 중립 검정보다 화면 톤에 맞는다.
          🔴 색과 투명도를 나눠 적는다. 토큰이 var() 라서 `bg-x/50` 형태의 투명도 표기는
             유틸리티 자체가 생성되지 않는다(실측: CSS 에 클래스 없음 → 스크림이 투명해짐). */}
      <div aria-hidden className="absolute inset-0 bg-content-primary opacity-50" onClick={onClose} />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border border-subtle bg-surface-card px-4 pb-6 pt-3 outline-none sm:max-w-[420px] sm:rounded-2xl sm:pb-4"
      >
        {/* 손잡이 — 밀어 내릴 수 있는 면이라는 표시. 넓은 화면에서는 없앤다 */}
        <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-surface-page sm:hidden" />

        <p className="text-sm font-bold text-content-primary">{title}</p>
        <div className="mt-2">{children}</div>

        <button
          type="button"
          onClick={onClose}
          className={`mt-2 ${TOUCH_MIN} w-full rounded-lg text-sm text-content-muted transition duration-150 hover:bg-surface-soft active:scale-[0.98]`}
        >
          닫기
        </button>
      </div>
    </div>
  )
}
