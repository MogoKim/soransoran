/** 상세: docs/operations/2026-08-23-soransoran-magazine-strategy.md */

/** 관련글은 같은 클러스터 안에서만 연결한다. */
export type MagazineCluster =
  | 'menopause-symptom'
  | 'sleep'
  | 'emotion'
  | 'family'
  | 'clinic'
  | 'daily'
  | 'money-work'
  | 'relationship'

export const MAGAZINE_CLUSTER_LABELS: Record<MagazineCluster, string> = {
  'menopause-symptom': '갱년기 증상',
  sleep: '수면',
  emotion: '감정',
  family: '부부·가족',
  clinic: '병원·검진',
  daily: '일상관리',
  'money-work': '돈·일',
  relationship: '관계 회복',
}

/** next/image 에 필요한 값을 전부 필수로 둔다. 하나라도 빠지면 빌드가 막는다. */
export type MagazineImage = {
  src: string
  alt: string
  width: number
  height: number
}

/** 본문 블록 6종. 본문은 HTML 문자열이 아니라 이 배열이다. */
export type MagazineBlock =
  | { type: 'p'; text: string }
  | { type: 'h2'; text: string }
  | { type: 'h3'; text: string }
  | { type: 'list'; items: string[]; ordered?: boolean }
  | { type: 'callout'; text: string }
  | { type: 'image'; image: MagazineImage }

export type MagazineSeries = {
  id: string
  title: string
  description: string
}

/** slug 를 뺀 본문 — slug 는 레코드 key 에서 주입된다. */
export type MagazineArticleBody = {
  title: string
  /** 본문 자동 절단이 아니라 직접 쓴 요약 */
  description: string
  cluster: MagazineCluster
  /** YYYY-MM-DD */
  publishedAt: string
  heroImage?: MagazineImage
  body: MagazineBlock[]
  /** 건강 글이면 true — 하단 상담 권장 문구가 자동으로 붙는다 */
  medical?: boolean
  /** 없으면 단발 글 */
  seriesId?: string
  /** 시리즈 안에서의 순서. 1 부터 */
  seriesOrder?: number
}

export type MagazineArticle = MagazineArticleBody & {
  /** 영문 kebab-case. 한 번 정하면 바꾸지 않는다 */
  slug: string
}
