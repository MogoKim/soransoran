import type { Prisma } from '@prisma/client'
import { BEST_REAL_MEMBER_WHERE } from '@/lib/best-ranking-db'

/**
 * 홈 인기 점수가 세는 댓글 — 실제 사람 반응만. 무엇을 세는가의 정본.
 *
 * 🔴 화면의 댓글 수(POST_LIST_ITEM_SELECT `_count.comments`)와 **다른 숫자다.**
 *    화면은 지금 글 아래 실제로 달린 댓글 개수를 그대로 보여준다 — Persona 댓글도 실제로 달린 댓글이라
 *    거기서 빼면 화면이 거짓말이 된다. 점수는 "사람들이 반응했는가" 를 묻는다 —
 *    Persona 댓글을 세면 활발한 척하는 글이 홈 상단을 차지한다.
 *
 *   세는 것    MEMBER — 작성자 relation 이 실회원(BEST_REAL_MEMBER_WHERE)인 댓글
 *                       (commentOrigin 표기만 믿지 않는다. /best 와 같은 기준이다)
 *              GUEST  — 비회원 댓글
 *   세지 않는 것 PERSONA · OPERATOR · MICRO_SEED_VERBATIM · 삭제된 댓글
 *
 * 🔴 personaId · operatorWriterId 를 함께 막는다. 레인 표기(commentOrigin)와 작성자 축이
 *    어긋난 행이 생겨도 Persona·운영 댓글이 MEMBER 로 새지 않게 한다.
 *
 * /best 는 이 정의를 쓰지 않는다 — 자기 실반응 정본(best-ranking-db.ts countRealReactions)이 있다.
 * 두 곳의 "실회원" 판정은 BEST_REAL_MEMBER_WHERE 하나로 같다.
 */
export const HOME_POPULAR_COMMENT_WHERE = {
  isDeleted: false,
  personaId: null,
  operatorWriterId: null,
  OR: [
    { commentOrigin: 'MEMBER', author: { is: BEST_REAL_MEMBER_WHERE } },
    { commentOrigin: 'GUEST' },
  ],
} satisfies Prisma.CommentWhereInput

type Db = Prisma.TransactionClient

/**
 * 글마다 실반응 댓글 수를 붙인다 — 점수 입력(ScorablePost.realComments)은 여기서만 만든다.
 *
 * 🔴 `prisma` 를 import 하지 않는다. 화면은 prisma 를, 검사·replay 는 자기 클라이언트를 넘긴다.
 * 🔴 한 번의 groupBy 로 센다. 후보마다 count 를 날리지 않는다.
 * 🔴 넘겨받은 글의 다른 필드(화면 표시용 `_count.comments` 포함)는 건드리지 않는다.
 */
export async function withRealCommentCounts<T extends { id: string }>(
  db: Db,
  posts: readonly T[],
): Promise<(T & { realComments: number })[]> {
  if (posts.length === 0) return []
  const ids = [...new Set(posts.map((p) => p.id))]
  const rows = await db.comment.groupBy({
    by: ['postId'],
    where: { postId: { in: ids }, ...HOME_POPULAR_COMMENT_WHERE },
    _count: { _all: true },
  })
  const counts = new Map(rows.map((r) => [r.postId, r._count._all]))
  return posts.map((p) => ({ ...p, realComments: counts.get(p.id) ?? 0 }))
}
