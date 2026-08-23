import type { MagazineArticle, MagazineArticleBody } from '@/content/magazine/types'

/**
 * 발행된 매거진 글. key 가 곧 slug 라 같은 slug 를 두 번 선언할 수 없다.
 * 발행 전 체크리스트는 전략 문서 §10.
 */
const MAGAZINE_ARTICLE_RECORD = {} satisfies Record<string, MagazineArticleBody>

export const MAGAZINE_ARTICLES: MagazineArticle[] = Object.entries(
  MAGAZINE_ARTICLE_RECORD as Record<string, MagazineArticleBody>,
).map(([slug, article]) => ({ slug, ...article }))
