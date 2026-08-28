import type { Prisma } from '@prisma/client'

/**
 * 첫 가입 인사 — 정책 상수와 제외 조각
 *
 * 새로 온 사람이 한 줄 인사를 남기고, 홈에서 다른 회원이 그 인사를 본다.
 * 그것만 한다 — 일반 글쓰기와 다른 경로이고, 다른 자리에 보인다.
 *
 * 🔴 3축 플래그 값은 여기 두지 않는다.
 *    isMicroSeed · permanentNoindex · indexPromotionBlocked 는 post-visibility.ts 가
 *    유일한 자리다 (C-2). 이 파일이 답하는 것은 "어떤 종류의 글인가" 뿐이고,
 *    "보이는가 · 색인되는가 · 추천되는가" 는 그쪽이 답한다.
 *    한 파일이 두 질문에 답하기 시작하면 언젠가 한쪽이 틀린다.
 */

/** Post.category 에 들어가는 값. 일반 글은 null 이다 */
export const GREETING_CATEGORY = '가입인사'

/**
 * 첫 인사가 저장되는 게시판.
 *
 * 🔴 전용 BoardType 을 새로 만들지 않는다.
 *    enum 을 늘리면 게시판 목록·네비게이션·sitemap·발행 화이트리스트까지 번지는데,
 *    첫 인사는 게시판이 아니라 한 종류의 글이다.
 */
export const FIRST_GREETING_BOARD_TYPE = 'FREE'

/**
 * 첫 인사를 권하는 기간 — 가입 후 72시간.
 *
 * 🔴 지나면 다시 권하지 않는다. 며칠 뒤에 "처음 오셨군요" 라고 말하는 화면은
 *    반갑기보다 우리가 그를 기억하지 못한다는 뜻으로 읽힌다.
 */
export const FIRST_GREETING_WINDOW_MS = 72 * 60 * 60 * 1000

/**
 * 인사말 길이.
 *
 * 🔴 일반 글(post-policy.ts)보다 훨씬 짧다.
 *    한 줄이면 충분하다고 말해 놓고 열 줄을 요구하면 아무도 쓰지 않는다.
 */
export const FIRST_GREETING_MIN_LENGTH = 5
export const FIRST_GREETING_MAX_LENGTH = 200

/**
 * 목록에서 첫 인사를 빼는 where 조각.
 *
 * 🔴 `category: { not: GREETING_CATEGORY }` 단독으로 쓰면 안 된다.
 *    Postgres 는 NULL 과의 비교를 참도 거짓도 아닌 unknown 으로 두고,
 *    where 는 unknown 행을 버린다. 그래서 not 비교 하나만 두면
 *    category 가 null 인 **일반 글이 전부 사라진다**. 지금 글의 대부분이 그렇다.
 *    null 을 명시적으로 살려 두는 이 형태를 쓴다.
 *
 * 🔴 쓰는 쪽에서 다시 적지 않는다.
 *    같은 조건을 두 곳에 두면 한쪽만 고쳐지는 날이 오고,
 *    그때 어느 쪽이 실제로 쓰이는지 알 수 없게 된다.
 *
 * 사용법
 *   최상위 where 에 다른 OR 가 없으면 그대로 펼친다:
 *     where: { ...base, ...EXCLUDE_GREETING }
 *   이미 OR 이 있으면 키가 부딪히므로 AND 로 묶는다:
 *     where: { ...base, AND: [EXCLUDE_GREETING] }
 */
export const EXCLUDE_GREETING = {
  OR: [{ category: { not: GREETING_CATEGORY } }, { category: null }],
} as const satisfies Prisma.PostWhereInput

/**
 * 이 글이 첫 인사인가.
 *
 * 🔴 3축 플래그로 판정하지 않는다.
 *    permanentNoindex 가 켜진 글이 첫 인사뿐이라는 보장이 없고,
 *    노출 축으로 종류를 되짚는 것은 축을 섞는 일이다. category 하나만 본다.
 */
export function isGreetingPost(post: { category: string | null }): boolean {
  return post.category === GREETING_CATEGORY
}
