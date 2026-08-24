import { MAGAZINE_ARTICLES } from '@/content/magazine/articles'
import type { MagazineArticle } from '@/content/magazine/types'

/**
 * 매거진 공개 관문
 *
 * 제작과 공개를 분리한다 (운영 전략서 §3 원칙 1).
 * articles.ts 에 예약 글이 들어 있어도 publishAt 이전에는 어디에서도 보이지 않는다.
 *
 * ⚠️ **다섯 표면이 전부 이 파일의 getAllMagazineArticles() 를 거쳐야 한다.**
 *    목록 · 상세 · sitemap · 관련글 · 시리즈 UI
 *    한 곳이라도 MAGAZINE_ARTICLES 를 직접 읽으면, 목록에는 없는데 상세 URL 이 200 이 되어
 *    검색엔진이 미완성 글을 색인한다. 그래서 아래 함수들도 전부 관문을 경유한다.
 */

/** KST 기본 공개 시각. 운영 전략서 §4 */
const KST_PUBLISH_TIME = 'T10:30:00+09:00'

/**
 * 공개 시각을 밀리초로 돌려준다.
 * publishAt 이 없으면 publishedAt 을 KST 10:30 으로 본다.
 * 오프셋이 문자열에 있어 서버 타임존(Vercel = UTC)과 무관하게 같은 순간을 가리킨다.
 */
export function resolvePublishAt(article: MagazineArticle): number {
  return new Date(article.publishAt ?? `${article.publishedAt}${KST_PUBLISH_TIME}`).getTime()
}

/**
 * 지금 공개해도 되는 글인가.
 *
 * qaStatus · riskLevel 은 여기서 보지 않는다 — 런타임 필드가 아니다.
 * QA 는 발행 전 절차(magazine-qa.mjs)가 판정하고, HIGH 차단은 검수 단계가 한다.
 * 런타임에서 막아야 할 것은 status: 'BLOCKED' 로 표현한다.
 */
export function isPublicMagazineArticle(article: MagazineArticle, now = Date.now()): boolean {
  if (article.status === 'DRAFT' || article.status === 'BLOCKED') return false
  return resolvePublishAt(article) <= now
}

/** 공개된 글만, 최신 발행순 */
export function getAllMagazineArticles(): MagazineArticle[] {
  return MAGAZINE_ARTICLES.filter((a) => isPublicMagazineArticle(a)).sort((a, b) =>
    b.publishedAt.localeCompare(a.publishedAt),
  )
}

export function getMagazineArticleBySlug(slug: string): MagazineArticle | undefined {
  if (!slug) return undefined
  // MAGAZINE_ARTICLES 를 직접 find 하지 않는다 — 미래 글 상세가 200 이 되어버린다.
  return getAllMagazineArticles().find((a) => a.slug === slug)
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

  // 여기도 관문을 거친다 — 예약된 다음 회차가 시리즈 목차에 미리 뜨면 안 된다.
  return getAllMagazineArticles()
    .filter((a) => a.seriesId === seriesId)
    .sort((a, b) => {
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
