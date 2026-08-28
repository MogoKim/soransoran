import Image from 'next/image'
import Link from 'next/link'
import { MAGAZINE_CLUSTER_LABELS, type MagazineArticle } from '@/content/magazine/types'
import { formatMagazinePublishedDate } from '@/lib/magazine-date'

/**
 * 홈 전용 매거진 진열 — 좁은 화면은 옆으로 미는 레일, 넓은 화면은 세 칸.
 * 목록 카드(MagazineCard)는 /magazine 목록을 지키려고 쓰지 않는다.
 */

/** 한 장이 화면 안에 온전히 들어오는 너비 — 옆 장이 보이게 해 레일임을 알린다 */
const CARD_WIDTH = 'w-[72vw] max-w-[340px]'

export default function HomeMagazineRail({ articles }: { articles: MagazineArticle[] }) {
  if (articles.length === 0) return null

  return (
    /* -mx-4 + px-4 로 칸이 화면 끝까지 이어지게 한다. 막대는 숨기고 스크롤은 남긴다. */
    <ul
      className={
        '-mx-4 flex snap-x snap-mandatory list-none gap-3 overflow-x-auto px-4 pb-1 ' +
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden ' +
        'sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0'
      }
    >
      {articles.map((article) => (
        <li key={article.slug} className={`${CARD_WIDTH} shrink-0 snap-start sm:w-auto`}>
          <Card article={article} />
        </li>
      ))}
    </ul>
  )
}

/** 칸 하나 — 그림 위, 글 아래. h-full 로 칸끼리 키를 맞춘다. */
function Card({ article }: { article: MagazineArticle }) {
  const image = article.heroImage

  return (
    <Link
      href={`/magazine/${article.slug}`}
      className="flex h-full flex-col overflow-hidden rounded-lg border border-subtle bg-surface-card no-underline transition-colors duration-150 hover:bg-surface-page active:bg-surface-soft"
    >
      {image ? (
        <span className="relative block aspect-video w-full shrink-0 bg-surface-soft">
          <Image
            src={image.src}
            alt={image.alt}
            fill
            sizes="(max-width: 640px) 60vw, 240px"
            className="object-cover"
          />
        </span>
      ) : null}

      <span className="flex flex-1 flex-col gap-1.5 p-3">
        <span className="inline-flex w-fit items-center rounded-full bg-surface-soft px-2 py-0.5 text-xs font-medium text-brand-ink">
          {MAGAZINE_CLUSTER_LABELS[article.cluster]}
        </span>

        <span className="line-clamp-2 break-keep text-lg font-bold leading-[1.4] text-content-primary">
          {article.title}
        </span>

        <span className="mt-auto text-xs text-content-muted">
          {formatMagazinePublishedDate(article.publishedAt)}
        </span>
      </span>
    </Link>
  )
}
