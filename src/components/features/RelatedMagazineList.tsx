import Link from 'next/link'
import { MAGAZINE_CLUSTER_LABELS, type MagazineArticle } from '@/content/magazine/types'
import { formatMagazinePublishedDate } from '@/lib/magazine-date'

/**
 * 상세 하단 관련글.
 *
 * 🔴 그림을 싣지 않는다.
 *    관련글은 같은 분류에서만 뽑는데 그림이 없는 글이 적지 않아,
 *    섞이면 줄마다 높이와 눈길이 흔들린다. 글만 두면 어떤 글이 와도 같은 모양이다.
 *
 * 🔴 목록 카드를 쓰지 않는다.
 *    본문이 이미 흰 면 위에 있어 그 아래 면을 또 쌓으면 읽기의 끝이 무거워진다.
 *    여기는 다음 글로 넘어가는 손잡이지 새로운 읽을거리 진열장이 아니다.
 */
export default function RelatedMagazineList({ articles }: { articles: MagazineArticle[] }) {
  if (articles.length === 0) return null

  return (
    <section className="mt-8 border-t border-subtle pt-6">
      <h2 className="text-lg font-bold text-content-primary">함께 읽어보세요</h2>

      <ul className="mt-2 flex flex-col [&>li+li]:border-t [&>li+li]:border-subtle">
        {articles.map((article) => (
          <li key={article.slug}>
            <Link
              href={`/magazine/${article.slug}`}
              className="group flex min-h-[72px] items-center gap-3 py-3 no-underline"
            >
              <span className="flex min-w-0 flex-col gap-1">
                <span className="line-clamp-2 break-keep font-bold leading-[1.4] text-content-primary transition-colors duration-150 group-hover:text-brand-ink group-active:text-brand-ink">
                  {article.title}
                </span>
                <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-content-muted">
                  <span className="font-bold text-brand-ink">
                    {MAGAZINE_CLUSTER_LABELS[article.cluster]}
                  </span>
                  <span aria-hidden>·</span>
                  {formatMagazinePublishedDate(article.publishedAt)}
                </span>
              </span>

              {/* 넘어간다는 신호다. 글자가 아니라 표시라 낭독하지 않는다. */}
              <span aria-hidden className="ml-auto shrink-0 text-content-muted">
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
