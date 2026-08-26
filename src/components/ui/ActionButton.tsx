'use client'

import { useFormStatus } from 'react-dom'
import { cn } from '@/lib/utils'

export type ActionButtonTone = 'primary' | 'danger'

/** 색과 tone 은 여기서만 정한다 — className 으로 덮이지 않도록 마지막에 병합한다. */
const TONE_CLASS: Record<ActionButtonTone, string> = {
  primary: 'inline-flex items-center bg-cta font-bold text-cta-text enabled:hover:bg-cta-hover',
  danger: 'border border-interactive font-bold text-state-danger enabled:hover:bg-surface-soft',
}

/**
 * 🔴 누름 피드백은 enabled: 로 잠근다.
 *    disabled:opacity-60 만 두면 제출 중인 버튼도 hover 에서 색이 바뀌어
 *    "아직 누를 수 있다" 로 읽힌다.
 */
const BASE_CLASS =
  'min-h-[52px] rounded-lg px-5 transition duration-150 enabled:active:scale-95 disabled:opacity-60'

type ActionButtonProps = {
  tone: ActionButtonTone
  label: string
  pendingLabel: string
  disabled?: boolean
  /** 레이아웃 보정 전용 — 색·상태를 여기서 바꾸지 않는다. */
  className?: string
}

export default function ActionButton({
  tone,
  label,
  pendingLabel,
  disabled,
  className,
}: ActionButtonProps) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className={cn(BASE_CLASS, className, TONE_CLASS[tone])}
    >
      {pending ? pendingLabel : label}
    </button>
  )
}
