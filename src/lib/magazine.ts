import { MAGAZINE_ARTICLES } from '@/content/magazine/articles'
import type { MagazineArticle, MagazineCluster } from '@/content/magazine/types'
import { MAGAZINE_ALL_CLUSTER, MAGAZINE_PAGE_SIZE, isPageOutOfRange } from '@/lib/list-query'

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

/** 목록에서 고른 분류. `'all'` 은 "고르지 않음" 이지 분류가 아니다. */
export type MagazineListCluster = MagazineCluster | typeof MAGAZINE_ALL_CLUSTER

export type MagazineListState = {
  /** 칩으로 세울 분류 — 공개 글 전체 기준 */
  clusters: MagazineCluster[]
  /** 정규화된 분류. 칩에 없는 값은 전체로 되돌아온다 */
  cluster: MagazineListCluster
  /** 이 쪽에 실을 글 */
  articles: MagazineArticle[]
  /** 고른 분류 기준 전체 개수 — 쪽 수와 404 경계가 이 값에서 나온다 */
  total: number
}

/**
 * 목록 한 화면에 필요한 것을 **한 번의 공개 글 스냅샷에서** 전부 계산한다.
 *
 * 🔴 **스냅샷을 인자로 받는 것이 이 함수의 핵심이다.**
 *    화면이 칩 목록 · 분류 정규화 · 개수 · 자르기를 따로 물으면 그때마다
 *    `getAllMagazineArticles()` 가 다시 돌아 `MAGAZINE_ARTICLES` 전체를
 *    거르고 정렬한다. 같은 요청 안에서 같은 답을 네 번 만드는 일이었다.
 *    더 나쁜 것은 네 번의 결과가 **서로 다른 순간을 볼 수 있다는 점**이다 —
 *    예약 공개 시각을 막 지난 글이 칩 계산에는 없고 목록에는 있으면,
 *    고를 수 없는 분류의 글이 화면에 실린다.
 *
 * 🔴 배열을 받으므로 **합성 표본을 그대로 넣을 수 있다.**
 *    실제 콘텐츠는 분류별 최대 9건이라 "분류 + 2쪽" 이 실데이터로는 열리지 않는다.
 *    콘텐츠를 늘리는 대신 여기로 13건짜리 배열을 넣어 그 경로를 검사한다.
 *
 * 🔴 분류 판정 기준은 "타입에 있는가" 가 아니라 **"칩이 있는가"** 다.
 *    공개 글이 0건인 분류는 칩도 없다. 그 주소로 들어오면 고를 수 없는 것이
 *    골라진 화면이 되므로 전체로 되돌린다. 404 를 주지 않는 것은
 *    `parseBoardSort` 와 같은 태도다 — 되돌아갈 곳이 언제나 있다.
 *
 * 🔴 범위를 넘긴 쪽은 **자르지 않고 빈 배열**을 준다.
 *    `parsePageParam` 이 자릿수가 긴 값을 안전 정수까지 허용하므로 `(page-1)*12` 가
 *    1e17 같은 값이 될 수 있다. 호출부는 같은 `isPageOutOfRange` 로 404 를 낸다 —
 *    판정이 두 곳이면 한쪽만 고쳐져 빈 200 이 되돌아온다.
 */
export function resolveMagazineList(
  published: readonly MagazineArticle[],
  requested: string | undefined,
  page: number,
): MagazineListState {
  const clusters = [...new Set(published.map((a) => a.cluster))]

  const cluster: MagazineListCluster =
    requested && (clusters as string[]).includes(requested)
      ? (requested as MagazineCluster)
      : MAGAZINE_ALL_CLUSTER

  const filtered =
    cluster === MAGAZINE_ALL_CLUSTER
      ? [...published]
      : published.filter((a) => a.cluster === cluster)
  const total = filtered.length

  if (isPageOutOfRange(page, total, MAGAZINE_PAGE_SIZE)) {
    return { clusters, cluster, articles: [], total }
  }

  const start = (page - 1) * MAGAZINE_PAGE_SIZE
  return {
    clusters,
    cluster,
    articles: filtered.slice(start, start + MAGAZINE_PAGE_SIZE),
    total,
  }
}

/**
 * 화면이 부르는 입구. 공개 관문을 거쳐 스냅샷을 얻고 위 순수 계산에 넘긴다.
 *
 * 🔴 `MAGAZINE_ARTICLES` 를 직접 읽지 않는다 — 관문을 거쳐야
 *    DRAFT·BLOCKED·예약 글이 목록에도 total 에도 섞이지 않는다.
 *
 * 🔴 인자가 **원시값 둘**이다. 배열(`?cluster=a&cluster=b`)을 여기까지 들여보내지 않는다 —
 *    호출부가 React `cache` 로 감싸는데, `cache` 는 인자의 동일성만 보므로 내용이 같은
 *    다른 배열은 다른 키가 되어 같은 요청에서 계산이 두 번 돈다.
 *    배열을 문자열로 누르는 일은 주소 해석의 첫 관문(`firstParam`)이 맡는다.
 *
 * ⚠️ 이 함수 자체에는 요청 단위 공유 장치가 없다.
 *    `generateMetadata` 와 렌더가 같은 답을 봐야 하므로 **공유는 호출부
 *    (`app/magazine/page.tsx`)가 React `cache` 로 건다.**
 *    그 장치를 여기 두지 않는 이유는 이 모듈이 `npm run check:pagination` 에서도
 *    돌기 때문이다 — Node 로 부르면 `react` 의 `cache` 가 `undefined` 다(실측).
 */
export function getMagazineListState(
  cluster: string | undefined,
  page: number,
): MagazineListState {
  return resolveMagazineList(getAllMagazineArticles(), cluster, page)
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
