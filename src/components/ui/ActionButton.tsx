'use client'

import { useFormStatus } from 'react-dom'
import { TOUCH_MIN } from '@/lib/spacing'
import { cn } from '@/lib/utils'

export type ActionButtonTone = 'primary' | 'danger'

/** 누를 수 있을 때의 색. tone 은 여기서만 정한다 — className 으로 덮이지 않도록 마지막에 병합한다. */
const TONE_CLASS: Record<ActionButtonTone, string> = {
  primary: 'inline-flex items-center bg-cta font-bold text-cta-text enabled:hover:brightness-95',
  danger: 'border border-interactive font-bold text-state-danger enabled:hover:bg-surface-soft',
}

/**
 * 🔴 누름 피드백은 enabled: 로 잠근다.
 *    disabled 인 버튼도 hover 에서 색이 바뀌면 "아직 누를 수 있다" 로 읽힌다.
 *
 * 🔴 못 누르는 버튼은 흐린 브랜드색이 아니라 회색이다.
 *    opacity 로만 죽이면 브랜드색이 옅어질 뿐이라 "누를 수 있는데 흐린 것" 으로 보인다.
 *    실제로 글쓰기 화면에서 그렇게 읽혔다 — 제목을 안 썼는데 올리기 버튼이
 *    산호색이라 눌러 보고서야 안 된다는 걸 알았다.
 *    색을 바꾸면 눌러 보기 전에 알 수 있다.
 *
 * 🔴 tone 보다 늦게 이기도록 disabled: 로 적는다.
 *    TONE_CLASS 가 뒤에 병합되지만 :disabled 가 붙은 쪽이 더 좁아 그때만 이긴다.
 *    두 tone 모두 같은 회색으로 간다 — 못 누르는 상태에 빨강·산호를 남겨 둘 이유가 없다.
 */
const BASE_CLASS =
  `${TOUCH_MIN} rounded-lg px-5 transition duration-150 enabled:active:scale-95 ` +
  'disabled:bg-surface-page disabled:text-content-muted disabled:border-subtle'

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
