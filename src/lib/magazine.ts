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
