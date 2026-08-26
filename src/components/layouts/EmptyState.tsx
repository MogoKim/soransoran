import Link from 'next/link'

/**
 * empty state
 *
 * 톤 정본 (soransoran-brand-design-spec.md §10)
 *   - "아직 아무도 없어요" 처럼 쓸쓸함을 강조하지 않는다
 *   - 접속자 수 / 게시글 수 / 실시간 배지를 넣지 않는다 (활발한 척 금지)
 *   - 짧게 써도 된다는 신호를 준다
 */
type EmptyStateProps = {
  title: string
  body?: string
  ctaLabel?: string
  ctaHref?: string
}

export default function EmptyState({ title, body, ctaLabel, ctaHref }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <p className="text-lg font-bold text-content-primary">{title}</p>
      {body ? <p className="text-sm text-content-muted">{body}</p> : null}
      {ctaLabel && ctaHref ? (
        <Link
          href={ctaHref}
          className="mt-3 inline-flex min-h-[52px] items-center rounded-lg bg-cta px-6 font-bold text-cta-text no-underline transition duration-150 hover:brightness-95 active:scale-95"
        >
          {ctaLabel}
        </Link>
      ) : null}
    </div>
  )
}
