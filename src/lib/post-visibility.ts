import type { Prisma } from '@prisma/client'

/**
 * Post 노출 판정 — 3축 단일 진실
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §4
 *
 * 🔴 "보인다 / 안 보인다" 는 하나의 축이 아니다. 최소 세 개다.
 *
 *   커뮤니티에서 사람에게 보이는가  ≠  검색엔진이 색인해도 되는가
 *                                  ≠  추천·모아보기에 올라도 되는가
 *
 * Micro Seed 는 첫째는 true, 둘째는 항상 false, 셋째는 기본 false 다.
 * 2축(isIndexable/isInternalOnly)으로 쓰면 "커뮤니티에서도 숨긴다" 로 오해되어
 * 레인의 존재 이유가 사라진다.
 *
 * 🚫 status · boardType · source · isMicroSeed 를 각 파일에서 "직접 비교" 하지 마라 (C-2).
 *    우나어는 판정이 세 곳으로 갈라졌고 제외 조각이 49곳/9파일로 확산됐다.
 *    이 파일이 유일한 판정 지점이다.
 *
 * 런타임 술어(isXxx)와 Prisma where 조각(XXX_WHERE)을 같은 파일에 둔다.
 * 둘이 다른 파일에 있으면 반드시 어긋난다.
 */

/** 판정에 필요한 최소 입력. 이 이상을 요구하지 않는다. */
export type PostVisibilityInput = {
  status: 'PUBLISHED' | 'HIDDEN' | 'DELETED'
  isMicroSeed: boolean
  permanentNoindex: boolean
  /** 미지정이면 !isMicroSeed 로 폴백한다. M0 에서는 컬럼을 만들지 않는다. */
  discoveryEligible?: boolean | null
}

/**
 * 🚫 source: AuthorSource 를 입력에 넣지 않는다.
 *    SYSTEM 은 "내부 공급" 을 뜻하지만 매거진도 SYSTEM 일 수 있다.
 *    판정 축이 섞이면 한 필드가 두 질문에 답하려다 실패한다.
 */

/** Prisma select 에 최소로 포함되어야 하는 필드 — 판정 함수의 입력과 1:1 이다. */
export const POST_VISIBILITY_SELECT = {
  status: true,
  isMicroSeed: true,
  permanentNoindex: true,
} as const satisfies Prisma.PostSelect

// ─────────────────────────────────────────────────────────
// 축 1 — 커뮤니티 노출
// ─────────────────────────────────────────────────────────

/**
 * 커뮤니티 목록·상세에 보여도 되는가.
 *
 * 🟢 Micro Seed 는 PUBLISHED 이면 true 다.
 *    여기서 빼면 레인의 목적(커뮤니티 생활감)이 사라진다.
 *    isMicroSeed 를 보지 않는 것이 이 함수의 핵심이다.
 */
export function isCommunityVisible(p: PostVisibilityInput): boolean {
  return p.status === 'PUBLISHED'
}

/** 커뮤니티 목록·상세 쿼리용. Micro Seed 를 제외하지 않는다. */
export const COMMUNITY_VISIBLE_WHERE = {
  status: 'PUBLISHED',
} as const satisfies Prisma.PostWhereInput

// ─────────────────────────────────────────────────────────
// 축 2 — 검색 색인
// ─────────────────────────────────────────────────────────

/**
 * sitemap · meta robots · canonical · JSON-LD · OG 에 들어가도 되는가.
 *
 * 🔴 Micro Seed 는 항상 false (정책 8·10). index 전환은 영구 금지다.
 *
 * ⚠️ publishAt(예약 발행 시각)은 "커뮤니티 노출 시각" 일 뿐
 *    SEO 허용 신호가 아니다. 이 판정에 넣지 마라.
 */
export function isSearchIndexable(p: PostVisibilityInput): boolean {
  return p.status === 'PUBLISHED' && !p.isMicroSeed && !p.permanentNoindex
}

/** sitemap 등 색인 대상 조회용 where 조각. */
export const SEARCH_INDEXABLE_WHERE = {
  status: 'PUBLISHED',
  isMicroSeed: false,
  permanentNoindex: false,
} as const satisfies Prisma.PostWhereInput

/** meta robots 값. isSearchIndexable === false 면 noindex 를 붙인다. */
export function robotsMetaFor(p: PostVisibilityInput): { index: boolean; follow: boolean } {
  // follow 는 유지한다 — 내부 링크(게시판 목록 등)를 따라가는 것 자체는 막을 이유가 없다.
  // nofollow 여부는 정본 TODO-18 에서 확정한다.
  return isSearchIndexable(p) ? { index: true, follow: true } : { index: false, follow: true }
}

// ─────────────────────────────────────────────────────────
// 축 3 — Discovery / 추천
// ─────────────────────────────────────────────────────────

/**
 * best · trending · related · search · topic hub · public API ·
 * notification · activity feed 에 들어가도 되는가.
 *
 * 🔴 Micro Seed 는 기본 false. 예외 허용은 정본 TODO-14 확정 사항이다.
 */
export function isDiscoveryEligible(p: PostVisibilityInput): boolean {
  if (p.status !== 'PUBLISHED') return false
  return p.discoveryEligible ?? !p.isMicroSeed
}

/** best/trending/related/search 등 추천 표면 조회용 where 조각. */
export const DISCOVERY_ELIGIBLE_WHERE = {
  status: 'PUBLISHED',
  isMicroSeed: false,
} as const satisfies Prisma.PostWhereInput

// ─────────────────────────────────────────────────────────
// 불변식 (문서 §4-2)
//   isSearchIndexable(p)   === true  →  isCommunityVisible(p) === true
//   isDiscoveryEligible(p) === true  →  isCommunityVisible(p) === true
//   그 역은 성립하지 않는다. 커뮤니티 노출이 가장 넓고 색인·추천이 부분집합이다.
// ─────────────────────────────────────────────────────────

/** 개발/검증용 — 불변식이 깨지면 true 를 반환한다. */
export function violatesVisibilityInvariant(p: PostVisibilityInput): boolean {
  const community = isCommunityVisible(p)
  if (isSearchIndexable(p) && !community) return true
  if (isDiscoveryEligible(p) && !community) return true
  return false
}
