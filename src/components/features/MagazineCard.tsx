import Image from 'next/image'
import Link from 'next/link'
import { MAGAZINE_CLUSTER_LABELS, type MagazineArticle } from '@/content/magazine/types'

/**
 * 목록 카드 — 왼쪽 썸네일 · 오른쪽 글.
 *
 * 🔴 그림이 없는 글은 썸네일 칸 자체를 두지 않는다.
 *    빈 회색 상자를 세우면 "이미지를 못 불러왔다" 로 읽힌다.
 *    글이 가로를 다 쓰면 그 자체로 완결된 카드가 된다.
 *
 * 🔴 items-start 를 빼지 마라.
 *    flex 기본값(stretch)이면 썸네일이 카드 높이만큼 늘어나 aspect-[4/3] 이 무시된다.
 *    그러면 글자 줄 수가 이미지 비율을 정하게 되어 카드마다 그림 모양이 달라진다.
 */
export default function MagazineCard({ article }: { article: MagazineArticle }) {
  const image = article.heroImage

  return (
    <Link
      href={`/magazine/${article.slug}`}
      className="flex items-start gap-3 rounded-lg border border-subtle bg-surface-card p-3 no-underline transition-colors duration-150 hover:bg-surface-page active:bg-surface-soft sm:gap-4 sm:p-4"
    >
      {image ? (
        <span className="relative aspect-[4/3] w-28 shrink-0 overflow-hidden rounded-lg bg-surface-soft sm:w-40">
          <Image
            src={image.src}
            alt={image.alt}
            fill
            sizes="(max-width: 640px) 112px, 160px"
            className="object-cover"
          />
        </span>
      ) : null}

      <span className="flex min-w-0 flex-col justify-center gap-1.5">
        <span className="inline-flex w-fit items-center rounded-full bg-surface-soft px-2 py-0.5 text-xs font-bold text-brand-ink">
          {MAGAZINE_CLUSTER_LABELS[article.cluster]}
        </span>

        <span className="line-clamp-2 break-keep font-bold leading-[1.4] text-content-primary sm:text-lg">
          {article.title}
        </span>

        <span className="line-clamp-2 break-keep text-sm leading-[1.6] text-content-secondary">
          {article.description}
        </span>

        <span className="text-xs text-content-muted">{article.publishedAt}</span>
      </span>
    </Link>
  )
}
