/**
 * /best 입성 기준 — 정본. 가중치·기준·정책 판이 전부 여기 있다. DB 를 모르는 순수 함수다.
 * (무엇을 실반응으로 세는가의 DB 조건은 best-ranking-db.ts 가 정본이다)
 *
 * ── 계약 (best-v2) ─────────────────────────────────────────────────
 *   유효 반응 기준을 **처음** 통과한 글을 영구 기록하고(BestSelection),
 *   최초 입성 시각 최신순으로 12개씩 제한 없이 보여준다. 12 는 전체 상한이 아니라 쪽 크기다.
 *
 *   실반응 가중치 W = 실회원 공감 수 × 1
 *                   + 댓글 단 실회원 수 × 2
 *                   + min(비회원 댓글 수, 3) × 2
 *   입성 기준       = W ≥ 2  (댓글 단 실회원 1명 · 공감 2 · 비회원 댓글 1 중 하나면 된다)
 *
 *   🔴 한 번 입성하면 끝이다. 반응이 줄거나 반응한 회원이 차단돼도 기록은 지우지 않고,
 *      다시 인기가 올라도 재등록·상단 복귀하지 않는다. 한 번도 입성하지 않은 오래된 글이
 *      오늘 기준을 넘으면 오늘 입성한다.
 *
 * ── 쓰지 않는 것 (정본 C-4) ────────────────────────────────────────
 *   🔴 조회수를 쓰지 않는다. 비정규화 카운터이고, 쿠키만 지우면 누구나 올릴 수 있다.
 *   🔴 Post.likeCount · 무필터 댓글 수(_count.comments)를 쓰지 않는다. 화면 표시용 숫자다 —
 *      자기 공감·Persona·운영 댓글이 섞여 있다.
 *   입력은 **출처를 확인한 정규화 행**뿐이다 — Like 행과 MEMBER·GUEST Comment 행을
 *   실회원·자기 반응 조건으로 거른 것. Micro Seed·첫 인사처럼 승격이 막힌 글은
 *   계산 자체에 들어오지 않는다(isPromotionWriteBlocked).
 *
 * ── best-v1 에서 바뀐 것 ───────────────────────────────────────────
 *   best-v1 은 "유효 시각" 순위 키(Post.bestRankScore)로 전역 12개를 골라 1쪽에 순위와 함께
 *   보여주고, 12개에 든 글만 기록했다. 13위부터는 탐색할 수 없었다.
 *   best-v2 는 순위 키를 쓰지 않는다. Post.bestRankScore · BestSelection.scoreAtEntry ·
 *   BestSelection.peakRank 는 deprecated 다(schema.prisma 주석) — 칼럼 삭제는 별도 migration 과제다.
 */

/** 실회원 공감 한 건의 가중치 */
export const LIKE_WEIGHT = 1
/** 댓글을 단 실회원 한 명의 가중치. 한 사람이 여러 번 달아도 한 번이다 */
export const MEMBER_COMMENTER_WEIGHT = 2
/** 비회원 댓글 한 건의 가중치 */
export const GUEST_COMMENT_WEIGHT = 2
/** 비회원 댓글은 이 건수까지만 센다 — 사람을 구분할 수단이 없어 무한히 늘지 않게 막는다 */
export const GUEST_COMMENT_CAP = 3
/** 베스트 입성 기준 — W 가 이 값 이상이 되는 첫 순간 기록한다 */
export const BEST_ENTRY_WEIGHT = 2

/** 기록에 남는 정책 판. 기준·가중치를 바꾸면 올린다 */
export const BEST_POLICY_VERSION = 'best-v2'
/** BestSelection.recordedBy 값 */
export const BEST_RECORDED_BY = { event: 'event', backfill: 'backfill' } as const
export type BestRecordedBy = (typeof BEST_RECORDED_BY)[keyof typeof BEST_RECORDED_BY]

/**
 * best-v2 가 쓰지 않는 필수 칼럼에 넣는 값. **"해당 없음" 표시다 — 다른 뜻으로 재사용하지 않는다.**
 * 칼럼이 NOT NULL 이라 값은 넣어야 하고, migration 없이 칼럼을 뺄 수 없다.
 * best-v1 행과는 policyVersion 으로 구분한다. 칼럼을 지우는 migration 이 들어오면 이 상수도 지운다.
 */
export const BEST_V2_UNUSED_COLUMNS = { scoreAtEntry: 0, peakRank: 0 } as const

/** 가중치 상한 — Int 칼럼을 안전하게 둔다 */
const MAX_WEIGHT = 1_000_000_000

/** 음수·NaN·Infinity·소수를 0 이상의 안전한 정수로 누른다 */
function toCount(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.floor(Math.min(n, Number.MAX_SAFE_INTEGER))
}

export type RealReactions = {
  /** 작성자 본인을 뺀 실회원 공감 수 */
  likes: number
  /** 작성자 본인을 뺀, 댓글을 단 실회원 수(삭제 제외) */
  memberCommenters: number
  /** 비회원 댓글 수(삭제 제외) */
  guestComments: number
}

/** 실반응 가중치 W. 0 이면 실반응이 없다 */
export function reactionWeight(r: RealReactions): number {
  const w =
    toCount(r.likes) * LIKE_WEIGHT +
    toCount(r.memberCommenters) * MEMBER_COMMENTER_WEIGHT +
    Math.min(toCount(r.guestComments), GUEST_COMMENT_CAP) * GUEST_COMMENT_WEIGHT
  return Math.min(w, MAX_WEIGHT)
}

/** 베스트 입성 기준을 넘었는가 — W ≥ BEST_ENTRY_WEIGHT */
export function meetsBestEntry(weight: number): boolean {
  return toCount(weight) >= BEST_ENTRY_WEIGHT
}
