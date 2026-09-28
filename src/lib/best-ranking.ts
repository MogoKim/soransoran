/**
 * /best 순위 식 — 정본. 계수·상한·판정이 전부 여기 있다. DB 를 모르는 순수 함수다.
 * (무엇을 실반응으로 세는가의 DB 조건은 best-ranking-db.ts 가 정본이다)
 *
 * ── 식 ─────────────────────────────────────────────────────────────
 *   유효 시각(초) = 작성 시각 + 실반응 기여
 *   클수록 위. 같으면 id 가 큰 쪽이 위(best-ranking-db.ts 의 BEST_RANK_ORDER 가 고정한다).
 *
 *   실반응 가중치 W = 실회원 공감 수 × 1
 *                   + 댓글 단 실회원 수 × 2
 *                   + min(비회원 댓글 수, 3) × 2
 *   실반응 기여     = min(8시간 × log2(1 + W), 72시간)
 *
 * ── 쓰지 않는 것 (정본 C-4) ────────────────────────────────────────
 *   🔴 조회수를 쓰지 않는다. 비정규화 카운터이고, 쿠키만 지우면 누구나 올릴 수 있다.
 *   🔴 Post.likeCount · 무필터 댓글 수(_count.comments)를 쓰지 않는다. 화면 표시용 숫자다 —
 *      자기 공감·Persona·운영 댓글이 섞여 있다.
 *   이 식의 입력은 **출처를 확인한 정규화 행**뿐이다 — Like 행과 MEMBER·GUEST Comment 행을
 *   실회원·자기 반응 조건으로 거른 것. C-4 보조 규칙이 막는 "화면용 카운터를 승격 입력으로 쓰기" 가 아니다.
 *   Micro Seed·첫 인사처럼 승격이 막힌 글은 계산 자체에 들어오지 않는다(isPromotionWriteBlocked).
 *
 * ── "시간 감쇠" 라는 말에 대해 ──────────────────────────────────────
 *   🔴 이 값은 시간이 흐른다고 다시 쓰지 않는다. 스케줄러도 없다.
 *      오래된 글이 내려가는 것은 **새 글이 더 늦은 유효 시각을 들고 들어오기 때문**이다.
 *      그래서 새 글도 반응도 없으면 순서는 그대로다(흔들 이유가 없다).
 *   🔴 실반응 기여는 72시간에서 멈춘다 — 아무리 인기 글이어도 사흘 더 새 글 대접이 끝이다.
 *
 * ── 계수의 근거 (`npm run check:best` 의 계수 비교표가 증거다) ─────────
 *   · 한 번 두 배 = 8시간: 하루 3건(8시간 간격)일 때 첫 실반응 하나가 적어도 한 칸 올린다(≥8h).
 *     동시에 공감 1(8h)·댓글 1명(12.7h) 이 하루보다 짧아, 하루 넘게 새 글을 덮지 않는다(<24h).
 *     두 조건을 만족하는 값 중 가장 작다 — 반응이 순위를 붙드는 시간을 최소로 둔다.
 *   · 상한 72시간: 48h 이면 W=63 에서 이미 상한에 닿아 인기 글끼리 구분이 사라진다(W=255 까지는
 *     구분해야 한다). 72h 와 96h 가 둘 다 그 기준을 지나고, 그중 인기 글이 더 빨리 내려가는 쪽이 72h 다
 *     (최대 사흘 더 새 글 대접). 72h 는 W≈511 까지 구분한다.
 *   · 댓글 × 2: 댓글이 이 서비스의 목적(대화)에 공감보다 가깝다. 한 사람은 한 번만 센다.
 *   · 비회원 × 2, 3건 상한: 영속 식별자가 없어 서로 다른 사람 수가 아니라 **댓글 수**로 세고 멈춘다.
 *
 * ── 계수를 바꾸려면 ───────────────────────────────────────────────
 *   여기 숫자만 바꾸고 BEST_POLICY_VERSION 을 올린 뒤 `npm run best:backfill -- --apply` 로
 *   기존 글 키를 다시 쓴다. schema 는 바꾸지 않는다.
 */

const HOUR = 3600

/** 실회원 공감 한 건의 가중치 */
export const LIKE_WEIGHT = 1
/** 댓글을 단 실회원 한 명의 가중치. 한 사람이 여러 번 달아도 한 번이다 */
export const MEMBER_COMMENTER_WEIGHT = 2
/** 비회원 댓글 한 건의 가중치 */
export const GUEST_COMMENT_WEIGHT = 2
/** 비회원 댓글은 이 건수까지만 센다 — 사람을 구분할 수단이 없어 무한히 늘지 않게 막는다 */
export const GUEST_COMMENT_CAP = 3

/** 실반응 가중치가 두 배가 될 때마다 더해지는 시간 */
export const REACTION_HOURS_PER_DOUBLING = 8
/** 실반응 기여 상한 */
export const REACTION_BOOST_MAX_HOURS = 72

/** 현재 베스트의 크기이자 과거 기록 대상이 되는 순위 경계 */
export const BEST_CURRENT_SIZE = 12

/** 과거 기록에 남는 정책 판. 계수·조건을 바꾸면 올린다 */
export const BEST_POLICY_VERSION = 'best-v1'

/** BestSelection.recordedBy 값 */
export const BEST_RECORDED_BY = { event: 'event', backfill: 'backfill' } as const

/** 가중치 상한 — Int 칼럼과 log 입력을 안전하게 둔다. 이 값에서도 기여는 이미 72h 상한이다 */
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

/** 과거 베스트에 기록될 자격 — 실반응이 1 이상 */
export function hasValidReaction(weight: number): boolean {
  return toCount(weight) > 0
}

/**
 * 계수를 인자로 받는 실반응 기여(초). 계수 비교(check:best)가 쓴다.
 * 화면·쓰기 경로는 아래 reactionBoostSeconds 만 쓴다.
 */
export function reactionBoostSecondsWith(
  weight: number,
  hoursPerDoubling: number,
  maxHours: number,
): number {
  const w = Math.min(toCount(weight), MAX_WEIGHT)
  return Math.min(hoursPerDoubling * Math.log2(1 + w), maxHours) * HOUR
}

/** 실반응 기여(초) */
export function reactionBoostSeconds(weight: number): number {
  return reactionBoostSecondsWith(weight, REACTION_HOURS_PER_DOUBLING, REACTION_BOOST_MAX_HOURS)
}

/** 유효 시각(초). 순위 키 전체를 처음부터 계산한다 */
export function bestRankScore(input: { createdAt: Date; weight: number }): number {
  const base = input.createdAt.getTime() / 1000
  const safeBase = Number.isFinite(base) ? base : 0
  return safeBase + reactionBoostSeconds(input.weight)
}

/**
 * 저장된 키와 새로 계산한 키가 "같은가".
 * 🔴 기본값(삽입 시각 = 트랜잭션 시작 시각)과 작성 시각은 조금 다를 수 있다
 *    (실측: Prisma 단건 생성 0.001초, 긴 트랜잭션이면 초 단위).
 *    그 차이로 재계산 스크립트가 쓰지 않게 1초 안쪽은 같다고 본다.
 *    가장 작은 실제 차이는 공감 하나(8시간)라 이 허용폭이 불일치를 가리지 않는다.
 */
export function sameRankScore(a: number, b: number): boolean {
  return Math.abs(a - b) < 1
}
