import Link from 'next/link'

/**
 * empty state
 *
 * 톤 정본 (soransoran-brand-design-spec.md §10)
 *   - "아직 아무도 없어요" 처럼 쓸쓸함을 강조하지 않는다
 *   - 접속자 수 / 게시글 수 / 실시간 배지를 넣지 않는다 (활발한 척 금지)
 *   - 짧게 써도 된다는 신호를 준다
 *
 * 🔴 면을 가진다.
 *    이전에는 바탕 위에 글자만 가운데 놓였다. 내용이 없는 화면에서 면까지 없으면
 *    "빈 방" 이 아니라 "덜 그려진 화면" 으로 읽힌다 — /best 가 실제로 그랬다.
 *    카드 한 장을 두면 같은 문구가 "여기가 채워질 자리" 로 읽힌다.
 *
 * 🔴 점선을 쓰지 않는다.
 *    점선 테두리는 업로드·드롭 영역의 관용구다. 여기는 넣는 자리가 아니라
 *    쌓이는 자리라 실선으로 조용히 둔다.
 */
type EmptyStateProps = {
  title: string
  body?: string
  ctaLabel?: string
  ctaHref?: string
  /** 링크가 아니라 그 자리에서 무언가를 실행하는 버튼을 놓을 때 쓴다. */
  action?: React.ReactNode
}

export default function EmptyState({ title, body, ctaLabel, ctaHref, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-subtle bg-surface-card px-6 py-14 text-center">
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
      {action ? <div className="mt-3 flex w-full flex-col items-center">{action}</div> : null}
    </div>
  )
}
