import Link from 'next/link'
import { MAGAZINE_CLUSTER_LABELS, type MagazineArticle } from '@/content/magazine/types'

/** 목록 카드 */
export default function MagazineCard({ article }: { article: MagazineArticle }) {
  return (
    <Link
      href={`/magazine/${article.slug}`}
      className="flex min-h-[88px] flex-col justify-center rounded-lg border border-subtle bg-surface-card p-4 no-underline"
    >
      <h3 className="m-0 line-clamp-2 text-lg font-bold leading-snug text-content-primary">
        {article.title}
      </h3>

      <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-content-secondary">
        {article.description}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-2 text-xs text-content-muted">
        <span className="font-bold text-brand-ink">
          {MAGAZINE_CLUSTER_LABELS[article.cluster]}
        </span>
        <span aria-hidden>·</span>
        <span>{article.publishedAt}</span>
      </div>
    </Link>
  )
}
