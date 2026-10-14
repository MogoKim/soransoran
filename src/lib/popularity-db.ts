import type { Prisma } from '@prisma/client'
import { BEST_REAL_MEMBER_WHERE } from '@/lib/best-ranking-db'
import { GUEST_COMMENT_CAP } from '@/lib/best-ranking'

/**
 * 홈 인기 점수의 반응 신호 — 실제 사람이 반응했는가. 무엇을 세는가의 정본.
 *
 * 🔴 화면의 댓글 수(POST_LIST_ITEM_SELECT `_count.comments`)와 **다른 숫자다.**
 *    화면은 지금 글 아래 실제로 달린 댓글 개수를 그대로 보여준다 — Persona 댓글도 실제로 달린 댓글이라
 *    거기서 빼면 화면이 거짓말이 된다. 점수는 "몇 사람이 반응했는가" 를 묻는다 —
 *    Persona 댓글이나 한 사람의 연속 댓글을 세면 활발한 척하는 글이 홈 상단을 차지한다.
 *
 *   신호 = 댓글 단 실회원 **사람 수**(글쓴이 제외) + min(비회원 댓글 수, GUEST_COMMENT_CAP)
 *
 *   실회원  — commentOrigin MEMBER 이고 작성자 relation 이 BEST_REAL_MEMBER_WHERE(/best 와 같은 기준).
 *             한 사람이 10번 달아도 1명이다. 글쓴이 본인 답글은 반응이 아니라 0 이다.
 *   비회원  — 영속 식별자가 없어 사람을 가를 수 없다. 건수로 세되 /best 와 같은 상한에서 멈춘다.
 *   제외    — PERSONA · OPERATOR · MICRO_SEED_VERBATIM · 삭제 · personaId/operatorWriterId 가 붙은 모순 행
 *
 * 🔴 North Star(재방문 + 글/댓글 쓴 고유 사용자)와 같은 축이다 — 사람을 센다, 행을 세지 않는다.
 * 🔴 /best 정책은 이 파일이 정하지 않는다. 실회원 판정과 비회원 상한만 그쪽 정본을 빌려 쓴다.
 */
const REAL_COMMENT_BASE = {
  isDeleted: false,
  personaId: null,
  operatorWriterId: null,
} satisfies Prisma.CommentWhereInput

export const HOME_MEMBER_COMMENT_WHERE = {
  ...REAL_COMMENT_BASE,
  commentOrigin: 'MEMBER',
  author: { is: BEST_REAL_MEMBER_WHERE },
} satisfies Prisma.CommentWhereInput

export const HOME_GUEST_COMMENT_WHERE = {
  ...REAL_COMMENT_BASE,
  commentOrigin: 'GUEST',
} satisfies Prisma.CommentWhereInput

/** 음수·NaN·소수를 0 이상의 정수로 누른다 */
function toCount(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** 두 원재료를 신호 하나로 — 순수 함수. 상한은 /best 의 GUEST_COMMENT_CAP 정본이다 */
export function homeReactionSignal(r: { memberCommenters: number; guestComments: number }): number {
  return toCount(r.memberCommenters) + Math.min(toCount(r.guestComments), GUEST_COMMENT_CAP)
}

type Db = Prisma.TransactionClient

/**
 * 글마다 반응 신호를 붙인다 — 점수 입력(ScorablePost.realReactions)은 여기서만 만든다.
 *
 * 🔴 `prisma` 를 import 하지 않는다. 화면은 prisma 를, 검사·replay 는 자기 클라이언트를 넘긴다.
 * 🔴 글 수와 무관하게 쿼리 셋이다 — 글쓴이 · (글, 실회원) 짝 · 비회원 건수.
 *    글쓴이는 목록 select 에 싣지 않고 여기서 따로 읽는다 — 화면 props 로 작성자 id 를 흘리지 않는다.
 * 🔴 넘겨받은 글의 다른 필드(화면 표시용 `_count.comments` 포함)는 건드리지 않는다.
 */
export async function withRealReactions<T extends { id: string }>(
  db: Db,
  posts: readonly T[],
  /** replay 전용 — 이 시각까지 달린 댓글만 센다. 화면 경로는 넘기지 않는다 */
  { asOf }: { asOf?: Date } = {},
): Promise<(T & { realReactions: number })[]> {
  if (posts.length === 0) return []
  const ids = [...new Set(posts.map((p) => p.id))]
  const at = asOf ? { createdAt: { lte: asOf } } : {}
  const [authors, memberPairs, guests] = await Promise.all([
    db.post.findMany({ where: { id: { in: ids } }, select: { id: true, authorId: true } }),
    // (글, 작성자) 짝 하나가 한 사람이다 — 같은 사람의 여러 댓글이 한 줄로 접힌다
    db.comment.groupBy({
      by: ['postId', 'authorId'],
      where: { postId: { in: ids }, ...at, ...HOME_MEMBER_COMMENT_WHERE },
    }),
    db.comment.groupBy({
      by: ['postId'],
      where: { postId: { in: ids }, ...at, ...HOME_GUEST_COMMENT_WHERE },
      _count: { _all: true },
    }),
  ])
  const authorOf = new Map(authors.map((a) => [a.id, a.authorId]))
  const members = new Map<string, number>()
  for (const { postId, authorId } of memberPairs) {
    // 🔴 글쓴이 본인 답글은 반응이 아니다
    if (authorId === null || authorId === authorOf.get(postId)) continue
    members.set(postId, (members.get(postId) ?? 0) + 1)
  }
  const guestCount = new Map(guests.map((g) => [g.postId, g._count._all]))
  return posts.map((p) => ({
    ...p,
    realReactions: homeReactionSignal({
      memberCommenters: members.get(p.id) ?? 0,
      guestComments: guestCount.get(p.id) ?? 0,
    }),
  }))
}
