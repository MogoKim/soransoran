import { MAGAZINE_ARTICLES } from '@/content/magazine/articles'
import type { MagazineArticle } from '@/content/magazine/types'

/** 최신 발행순 */
export function getAllMagazineArticles(): MagazineArticle[] {
  return [...MAGAZINE_ARTICLES].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}

export function getMagazineArticleBySlug(slug: string): MagazineArticle | undefined {
  if (!slug) return undefined
  return MAGAZINE_ARTICLES.find((a) => a.slug === slug)
}

/** 같은 클러스터 안에서만 연결한다 */
export function getRelatedMagazineArticles(
  article: MagazineArticle,
  limit = 3,
): MagazineArticle[] {
  return getAllMagazineArticles()
    .filter((a) => a.slug !== article.slug && a.cluster === article.cluster)
    .slice(0, limit)
}

/** 같은 시리즈의 글을 순서대로. seriesOrder 가 없으면 뒤로 보낸다. */
export function getSeriesArticles(article: MagazineArticle): MagazineArticle[] {
  const seriesId = article.seriesId
  if (!seriesId) return []

  return MAGAZINE_ARTICLES.filter((a) => a.seriesId === seriesId).sort((a, b) => {
    const orderA = a.seriesOrder ?? Number.MAX_SAFE_INTEGER
    const orderB = b.seriesOrder ?? Number.MAX_SAFE_INTEGER
    if (orderA !== orderB) return orderA - orderB
    // 같은 순서면 먼저 낸 글이 앞이다 — 읽는 순서와 발행 순서를 맞춘다.
    return a.publishedAt.localeCompare(b.publishedAt)
  })
}

/** 이전/다음은 저장하지 않고 seriesId + seriesOrder 로 계산한다. */
export function getAdjacentMagazineArticles(article: MagazineArticle): {
  previous?: MagazineArticle
  next?: MagazineArticle
} {
  const series = getSeriesArticles(article)
  if (series.length < 2) return {}

  const index = series.findIndex((a) => a.slug === article.slug)
  if (index === -1) return {}

  return { previous: series[index - 1], next: series[index + 1] }
}
