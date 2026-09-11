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
  /** 승격·추천 write-path 차단 플래그 (C-4). discovery 판정에 반영한다. */
  indexPromotionBlocked: boolean
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
  indexPromotionBlocked: true,
} as const satisfies Prisma.PostSelect

/**
 * 🔴 **select 결과에서 3축만 뽑는다** (2026-09-11).
 *
 *    `POST_VISIBILITY_SELECT` 로 읽어 온 행을 판정 함수에 넘기려면 누군가는
 *    `{ status, isMicroSeed, permanentNoindex, indexPromotionBlocked }` 를 손으로 적어야 했다.
 *    그 순간 **축 이름이 호출부로 새어 나간다** — `check-post-visibility` 가 막는 바로 그 일이고,
 *    우나어에서 49곳 9파일로 퍼졌던 구조다.
 *
 *    축 이름은 이 파일만 안다. 호출부는 이 함수만 부른다.
 */
export function pickPostVisibility(row: PostVisibilityInput): PostVisibilityInput {
  return {
    status: row.status,
    isMicroSeed: row.isMicroSeed,
    permanentNoindex: row.permanentNoindex,
    indexPromotionBlocked: row.indexPromotionBlocked,
  }
}

/**
 * 🔴 **본문이 외부 커뮤니티에서 온 것인가** — 외부 모델 전송 정책이 쓴다 (2026-09-09).
 *
 *    Persona 댓글 생성은 대상 글의 본문을 프롬프트에 싣는다. 그때 물어야 하는 것은
 *    "이 글이 우리가 쓴 것인가" 이고, micro seed 글은 **남의 커뮤니티 원문**이다.
 *    가져온 글을 다시 외부로 보내지 않는다.
 *
 * 🔴 이 판정을 여기 두는 이유: `isMicroSeed` 축은 이 파일이 소유한다(C-2).
 *    호출부가 직접 비교하면 판정이 갈라지고, 한 곳을 고쳐도 나머지가 따라오지 않는다 —
 *    우나어에서 49곳 9파일로 확산됐던 그 구조다.
 *
 * 🔴 노출 판정이 아니다. 화면·검색·추천에 쓰지 않는다.
 */
export function isExternalSourcedBody(p: PostVisibilityInput): boolean {
  return p.isMicroSeed
}

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
 * notification · activity feed · **홈 최신글** 에 들어가도 되는가.
 *
 * 🔴 홈 "지금 올라온 이야기" 는 community list 가 아니라 discovery 표면이다.
 *    특정 게시판을 열어 보는 것과, 서비스가 대표로 골라 첫 화면에 올리는 것은 다르다.
 *
 * 🔴 Micro Seed 는 기본 false. 예외 허용은 정본 TODO-14 확정 사항이다.
 * 🔴 indexPromotionBlocked 는 승격·추천 write-path 차단이므로 여기서도 막는다 (C-4).
 *    이게 빠지면 "차단 플래그가 켜졌는데 추천에는 올라가는" 상태가 된다.
 */
export function isDiscoveryEligible(p: PostVisibilityInput): boolean {
  if (p.status !== 'PUBLISHED') return false
  if (p.indexPromotionBlocked) return false
  return p.discoveryEligible ?? !p.isMicroSeed
}

/** 홈 최신글 · best · trending · related · search 등 추천 표면 조회용 where 조각. */
export const DISCOVERY_ELIGIBLE_WHERE = {
  status: 'PUBLISHED',
  isMicroSeed: false,
  indexPromotionBlocked: false,
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

// ─────────────────────────────────────────────────────────
// write-path — Micro Seed Post 를 만들 때 박는 값 (§6-9-C)
// ─────────────────────────────────────────────────────────

/**
 * Micro Seed Post 생성 시 3축 필드의 **고정값**.
 *
 * 🔴 Sheet 입력도, 후보 필드도, 설정값도 아니다. 코드 상수다 (§6-9-C).
 *    셋 중 하나라도 조건부로 만들면 그 조건이 언젠가 잘못 평가된다 (C-1).
 *
 * 🔴 이 상수가 여기 있는 이유
 *    위 함수들이 "이 Post 가 보이는가" 를 읽는다면 이건 "새 Post 에 무엇을 박는가" 다.
 *    읽기와 쓰기가 다른 파일에 있으면 두 값이 갈라진다 — 판정은 noindex 인데
 *    생성은 index 로 만드는 상태가 조용히 생긴다.
 *    C-2 가 3축을 이 파일 하나로 모은 이유가 그것이고, write 쪽도 예외가 아니다.
 *
 * 🚫 source(AuthorSource) 를 여기 넣지 않는다.
 *    "내부 공급인가" 와 "보이는가" 는 다른 축이다(파일 상단 주석). 판정 축이 섞이면
 *    한 필드가 두 질문에 답하려다 실패한다. 작성자 축은 write-guard 가 다룬다.
 */
export const MICRO_SEED_POST_VISIBILITY_FLAGS = {
  isMicroSeed: true,
  permanentNoindex: true,
  indexPromotionBlocked: true,
} as const

/**
 * 첫 가입 인사 Post 생성 시 3축 필드의 **고정값**.
 *
 * 🔴 왜 이 파일에 있나
 *    가드(scripts/check-post-visibility.mjs)는 이 파일 밖에서 3축 토큰을 쓰는 것을
 *    전부 위반으로 잡는다 (C-2). 3축 값을 박는 자리는 언제나 여기다 —
 *    greeting 쪽 파일에 리터럴로 적으면 판정이 두 곳으로 갈라지고, 그것이
 *    이 게이트가 막으려는 바로 그 상태다.
 *
 * 🔴 isMicroSeed 는 false 다.
 *    첫 인사는 회원이 직접 쓴 글이지 Micro Seed 레인 발행물이 아니다.
 *    여기에 true 를 넣으면 두 레인의 통계·takedown·정책이 뒤섞인다.
 *
 * 🔴 나머지 둘은 true 다.
 *    검색에 넣을 글이 아니고(내부 환대 콘텐츠), 추천·모아보기에 올릴 글도 아니다.
 *    그 결과 상세는 접근 가능하되 noindex 이고, 홈 discovery 와 sitemap 에서 빠진다.
 *
 * 🔴 "자유게시판 목록에서 숨긴다" 는 여기 없다.
 *    그건 노출 축이 아니라 콘텐츠 종류의 문제라 Post.category 가 답한다
 *    (greeting-policy.ts 의 EXCLUDE_GREETING). 축을 섞지 않는다.
 */
export const GREETING_POST_VISIBILITY_FLAGS = {
  isMicroSeed: false,
  permanentNoindex: true,
  indexPromotionBlocked: true,
} as const

/**
 * Original Post 발행 시 3축 필드의 **고정값**.
 *
 * 🔴 세 축이 전부 false 인 유일한 레인이다. 그래서 더 조심해야 한다 —
 *    이 값으로 나간 글은 sitemap 에 실리고 검색에 노출된다.
 *
 * 🔴 왜 index 가 허용되는가
 *    헌법 §10-5 — *"'원문 그대로' 와 '검색 노출' 은 함께 갈 수 없다.
 *    둘 중 하나를 고르는 것이 레인 분리다."*
 *    Micro Seed 는 원문을 그대로 쓰는 대가로 영구 noindex 를 받았고,
 *    Original Post 는 **Derived(재창작)** 이라 index 자격을 얻는다.
 *    🔴 뒤집어 말하면 **Derived 가 아니게 되는 순간 index 자격도 사라진다** —
 *    Originality Gate 가 존재하는 이유가 이것이다.
 *
 * 🔴 isMicroSeed 는 false 다. 두 레인의 통계 · takedown · 정책이 뒤섞이면 안 된다.
 *
 * 🔴 이 파일에 있는 이유
 *    가드(scripts/check-post-visibility.mjs)가 **src/ 전체를 훑어** 3축 토큰을
 *    이 파일 밖에서 쓰면 전부 위반으로 잡는다 (C-2). 예외는 이 파일 하나뿐이다.
 *    발행 쪽에 리터럴로 적으면 판정이 두 곳으로 갈라지고,
 *    그것이 이 게이트가 막으려는 바로 그 상태다.
 */
export const ORIGINAL_POST_VISIBILITY_FLAGS = {
  isMicroSeed: false,
  permanentNoindex: false,
  indexPromotionBlocked: false,
} as const
