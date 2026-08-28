'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'

type Badge = 'required' | 'optional'

const BADGE_TEXT: Record<Badge, string> = {
  required: '[필수]',
  optional: '[선택]',
}

/** 🔴 --brand 는 글자로 못 쓴다(바탕 위 2.46:1). 읽는 브랜드색은 brand-ink 다 */
const BADGE_CLASS: Record<Badge, string> = {
  required: 'font-bold text-brand-ink',
  optional: 'text-content-muted',
}

/**
 * 동의 한 줄.
 *
 * 🔴 진짜 checkbox 를 쓴다.
 *    span 에 role="checkbox" 를 얹으면 키보드 조작과 스크린리더 안내를 손으로 다시
 *    만들어야 하고, 하나라도 빠지면 그 사람에게만 조용히 망가진다.
 *    label 로 감싸면 줄 전체가 누를 곳이 되는 덤도 따라온다.
 *
 * 🔴 '보기' 는 label 밖에 둔다.
 *    안에 두면 약관을 읽으려고 누른 것이 동의를 켜고 끄는 일이 된다.
 *
 * 🔴 배지를 이름과 같은 흐름에 둔다.
 *    따로 떼면 320px 에서 이름 쪽 폭이 눌려 한 줄이 서너 줄로 접힌다.
 */
export default function AgreementCheck({
  id,
  label,
  checked,
  onToggle,
  badge,
  href,
  variant = 'item',
}: {
  id: string
  label: string
  checked: boolean
  onToggle: () => void
  /** 없으면 배지를 붙이지 않는다 (전체 동의) */
  badge?: Badge
  /** 전문을 볼 수 있는 곳. 없으면 '보기' 를 두지 않는다 */
  href?: string
  /** summary = 아래 항목 전체를 대표하는 줄 */
  variant?: 'item' | 'summary'
}) {
  const isSummary = variant === 'summary'

  return (
    <div className="flex items-center gap-1">
      <label
        htmlFor={id}
        className={cn(
          'flex min-h-[52px] min-w-0 flex-1 cursor-pointer items-center gap-3 text-content-primary transition-colors',
          isSummary
            ? cn(
                'rounded-xl border-2 px-4 py-3 font-bold',
                checked ? 'border-cta bg-surface-soft' : 'border-subtle bg-surface-page',
              )
            : 'rounded-lg px-2 py-2 hover:bg-surface-page',
        )}
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="h-6 w-6 shrink-0 accent-cta"
        />
        <span className="min-w-0 flex-1 break-keep leading-snug">
          {label}
          {badge ? <span className={cn('ml-1', BADGE_CLASS[badge])}>{BADGE_TEXT[badge]}</span> : null}
        </span>
      </label>

      {href ? (
        <Link
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${label} 전문 보기`}
          className="inline-flex min-h-[52px] min-w-[52px] shrink-0 items-center justify-center text-link underline underline-offset-2"
        >
          보기
        </Link>
      ) : null}
    </div>
  )
}
