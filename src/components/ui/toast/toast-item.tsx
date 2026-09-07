'use client'

import { useEffect } from 'react'
import { cn } from '@/lib/utils'
import { TOAST_CLOSABLE, type ToastVariant } from '@/components/ui/toast/toast-tokens'
import type { ToastRecord } from '@/components/ui/toast/toast-context'

/**
 * 토스트 한 줄의 생김새 — 🔴 이 파일은 기능을 모른다.
 *
 * 🔴 면을 색으로 칠하지 않는다. 배경은 네 가지 모두 흰 카드다.
 *    전체를 초록·빨강으로 칠하면 같은 화면의 CTA·FAB 코랄과 자리를 다투고,
 *    바탕을 브랜드 계열로 덮지 않는다는 정본 §2-3-A 판단과도 어긋난다.
 *    상태는 왼쪽 4px 선과 문구가 진다.
 *
 * 🔴 색만으로 알리지 않는다. --state-danger 와 --cta 는 두 색 사이 1.19:1 이라
 *    색으로는 구분되지 않는다(정본 §2-2). 문구가 상태를 말해야 한다 —
 *    "등록됐어요" 와 "다시 시도해 주세요" 는 색 없이도 갈린다.
 *
 * 🔴 아이콘을 쓰지 않는다. 이모지는 읽는 사람마다 다르게 보이고,
 *    아이콘 패키지는 이번 범위 밖이다.
 */
const STRIPE: Record<ToastVariant, string> = {
  success: 'border-l-state-success',
  error: 'border-l-state-danger',
  warning: 'border-l-state-warning',
  info: 'border-l-state-info',
}

/** 🔴 radius 8px. pill 로 두면 안내가 아니라 배지로 읽힌다 */
const BASE =
  'pointer-events-auto flex items-start gap-3 rounded-lg border border-subtle border-l-4 bg-surface-card px-4 py-3.5 text-sm font-medium leading-[1.5] text-content-primary shadow-toast [overflow-wrap:anywhere] [word-break:keep-all] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-200'

export default function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastRecord
  onDismiss: (id: number) => void
}) {
  /* 머무는 시간은 자기가 센다 — seq 가 바뀌면(같은 key 재호출) 처음부터 다시 센다 */
  useEffect(() => {
    if (toast.duration <= 0) return
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.duration)
    return () => window.clearTimeout(timer)
  }, [toast.id, toast.duration, toast.seq, onDismiss])

  return (
    <div className={cn(BASE, STRIPE[toast.variant])}>
      <span className="min-w-0 flex-1">{toast.message}</span>

      {TOAST_CLOSABLE[toast.variant] ? (
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          aria-label="안내 닫기"
          /* 토스트 안이라 전역 하한 44px 를 쓴다 — 52px 은 한 줄 안내에 비해 크다 */
          className="-my-2 -mr-2 flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md text-content-muted transition duration-150 active:scale-[0.98]"
        >
          <svg
            width="18"
            height="18"
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
      ) : null}
    </div>
  )
}
