'use client'

import { useFormStatus } from 'react-dom'
import { cn } from '@/lib/utils'

export type ActionButtonTone = 'primary' | 'danger'

/** 색과 tone 은 여기서만 정한다 — className 으로 덮이지 않도록 마지막에 병합한다. */
const TONE_CLASS: Record<ActionButtonTone, string> = {
  primary: 'inline-flex items-center bg-cta font-bold text-cta-text',
  danger: 'border border-interactive font-bold text-state-danger',
}

const BASE_CLASS = 'min-h-[52px] rounded-lg px-5 disabled:opacity-60'

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
