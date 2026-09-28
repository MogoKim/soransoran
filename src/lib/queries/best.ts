import type { Prisma } from '@prisma/client'
import { BEST_GLOBAL_WHERE, BEST_RANK_ORDER } from '@/lib/best-ranking-db'
import { BEST_CURRENT_SIZE } from '@/lib/best-ranking'
import { BEST_PAGE_SIZE, bestLastPage } from '@/lib/list-query'
import { POST_LIST_ITEM_SELECT } from '@/lib/queries/post-list-item-select'

/**
 * /best 읽기 — 1쪽 현재 베스트, 2쪽부터 과거 베스트 기록.
 *
 * 🔴 읽기 전용이다. 어떤 행도 만들거나 고치지 않는다 — 기록은 쓰기 경로의 일이다(best-ranking-db.ts).
 * 🔴 `prisma` 를 import 하지 않는다. 화면은 prisma 를, 격리 DB 검사는 자기 클라이언트를 넘긴다.
 *
 * 보는 사람 필터
 *   차단한 작성자의 글은 현재 베스트에서도 기록에서도 뺀다. **목록과 개수가 같은 where 를 쓴다.**
 *   현재 베스트는 뺀 뒤 다음 글로 12개를 채운다(전역 순위를 잘라 내지 않는다).
 *   전역 기록(BestSelection)은 보는 사람과 무관하다 — 여기서는 거르기만 한다.
 *
 * 중복 없음
 *   지금 1쪽에 보이는 글은 2쪽부터의 기록에서 뺀다. 개수에서도 같이 뺀다.
 */

type Db = Prisma.TransactionClient

export type BestPageResult =
  | { outOfRange: true }
  | {
      outOfRange: false
      page: number
      lastPage: number
      /** 1쪽이면 현재 베스트(순위 있음), 2쪽부터는 과거 기록(순위 없음) */
      kind: 'current' | 'archive'
      posts: Prisma.PostGetPayload<{ select: typeof POST_LIST_ITEM_SELECT }>[]
    }

function visibleTo(blockedIds: readonly string[]): Prisma.PostWhereInput {
  return {
    ...BEST_GLOBAL_WHERE,
    ...(blockedIds.length ? { authorId: { notIn: [...blockedIds] } } : {}),
  }
}

export async function loadBestPage(
  db: Db,
  { page, blockedIds }: { page: number; blockedIds: readonly string[] },
): Promise<BestPageResult> {
  const postWhere = visibleTo(blockedIds)

  const current = await db.post.findMany({
    where: postWhere,
    orderBy: BEST_RANK_ORDER,
    take: BEST_CURRENT_SIZE,
    select: POST_LIST_ITEM_SELECT,
  })

  const archiveWhere: Prisma.BestSelectionWhereInput = {
    post: { is: postWhere },
    ...(current.length ? { postId: { notIn: current.map((p) => p.id) } } : {}),
  }

  /**
   * 🔴 개수를 먼저 센다. 범위 밖이면 skip 을 만들지 않는다 —
   *    거대한 page 가 skip 에 닿으면 Prisma 가 Int 범위를 넘겨 500 이 난다(게시판과 같은 계약).
   */
  const archiveTotal = await db.bestSelection.count({ where: archiveWhere })
  const lastPage = bestLastPage(archiveTotal)
  if (page > lastPage) return { outOfRange: true }

  if (page === 1) {
    return { outOfRange: false, page, lastPage, kind: 'current', posts: current }
  }

  const rows = await db.bestSelection.findMany({
    where: archiveWhere,
    // 최근 최초 진입순. postId 가 동점을 가른다 — 나중에 cursor 로 바꿔도 같은 키다.
    orderBy: [{ firstEnteredAt: 'desc' }, { postId: 'desc' }],
    skip: (page - 2) * BEST_PAGE_SIZE,
    take: BEST_PAGE_SIZE,
    select: { post: { select: POST_LIST_ITEM_SELECT } },
  })

  return { outOfRange: false, page, lastPage, kind: 'archive', posts: rows.map((r) => r.post) }
}
