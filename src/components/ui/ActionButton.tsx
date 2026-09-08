'use client'

import { useFormStatus } from 'react-dom'
import { TOUCH_MIN } from '@/lib/spacing'
import { cn } from '@/lib/utils'

export type ActionButtonTone = 'primary' | 'danger'

/**
 * 크기·밀도 — 🔴 도메인 이름(admin/customer)이 아니라 **밀도**로 부른다.
 *
 *   default   고객 화면. 라벨이 커야 흰 글씨가 대비 조건을 넘는다(아래 TONE_CLASS 주석)
 *   compact   좁은 운영 표처럼 밀도가 높은 화면. 라벨을 키우지 않으므로 먹색을 쓴다
 *
 * 🔴 compact 를 고객 화면에 쓰지 않는다. 고객 primary CTA 는 **전부 흰색**이고
 *    흰색은 큰 굵은 글씨로만 대비를 넘는다 — compact 는 라벨을 키우지 않아 그 조건을 못 만든다.
 *    현재 허용 경로는 AdminPostEditForm · AdminCommentEditForm 두 곳뿐이며
 *    check:contrast 의 COMPACT_ALLOWED 가 그 밖의 사용을 막는다.
 *
 * 이름을 'admin' 이 아니라 밀도로 둔 것은 색·크기 규칙이 도메인이 아니라
 * **자리의 밀도**에서 나오기 때문이다.
 */
export type ActionButtonSize = 'default' | 'compact'

/**
 * 누를 수 있을 때의 색. tone 은 여기서만 정한다 — className 으로 덮이지 않도록 마지막에 병합한다.
 *
 * 🔴 primary 의 흰 글씨는 **크기와 한 몸**이다.
 *    --cta-content on --cta 는 3.53:1 이라 큰 굵은 글씨(18.66px+700)로만 통과한다.
 *    그래서 default 에는 text-lg 를 함께 건다. compact 는 라벨을 키우지 않으므로
 *    흰색을 쓸 수 없고 --text-primary(4.65:1)를 쓴다.
 *
 * 🔴 text-lg 를 BASE_CLASS 에 넣지 않는다. 그러면 danger 버튼까지 커진다.
 */
const TONE_CLASS: Record<ActionButtonTone, Record<ActionButtonSize, string>> = {
  primary: {
    default: 'inline-flex items-center bg-cta text-lg font-bold text-cta-content enabled:hover:brightness-95',
    compact: 'inline-flex items-center bg-cta font-bold text-content-primary enabled:hover:brightness-95',
  },
  danger: {
    default: 'border border-interactive font-bold text-state-danger enabled:hover:bg-surface-soft',
    compact: 'border border-interactive font-bold text-state-danger enabled:hover:bg-surface-soft',
  },
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
  /** 밀도. 좁은 표·툴바에서만 compact 를 쓴다 — 기본은 고객 화면 크기다. */
  size?: ActionButtonSize
  /** 레이아웃 보정 전용 — 색·크기·상태를 여기서 바꾸지 않는다. */
  className?: string
}

export default function ActionButton({
  tone,
  label,
  pendingLabel,
  disabled,
  size = 'default',
  className,
}: ActionButtonProps) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className={cn(BASE_CLASS, className, TONE_CLASS[tone][size])}
    >
      {pending ? pendingLabel : label}
    </button>
  )
}
