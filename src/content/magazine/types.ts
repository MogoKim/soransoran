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
  /** 본문 마지막에서 커뮤니티로 넘긴다. 내부 경로만 쓴다 */
  | { type: 'cta'; href: string; label: string; text?: string }

/**
 * 공개 상태. 없으면 'PUBLISHED' 로 본다 — 기존 글을 고치지 않기 위해서다.
 *   DRAFT      아직 낼 준비가 안 됨. 언제나 숨김
 *   SCHEDULED  publishAt 이 지나면 공개
 *   PUBLISHED  publishAt 이 지나면 공개 (SCHEDULED 와 판정은 같다. 표기 구분용)
 *   BLOCKED    사람이 열기 전까지 언제나 숨김 (HIGH 등급 대기 포함)
 */
export type MagazineStatus = 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' | 'BLOCKED'

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

  /** 없으면 'PUBLISHED'. 제작과 공개를 분리하는 축이다 */
  status?: MagazineStatus

  /**
   * 공개 시각. **ISO 8601 with offset** 으로 적는다 — 예: '2026-08-25T10:30:00+09:00'
   * 없으면 `publishedAt` 을 KST 10:30 으로 해석한다.
   * 오프셋을 문자열에 박아야 서버 타임존(UTC)과 무관하게 같은 시각을 가리킨다.
   */
  publishAt?: string
}

export type MagazineArticle = MagazineArticleBody & {
  /** 영문 kebab-case. 한 번 정하면 바꾸지 않는다 */
  slug: string
}
