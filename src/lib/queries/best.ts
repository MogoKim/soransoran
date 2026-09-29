import type { Prisma } from '@prisma/client'
import { BEST_PUBLIC_WHERE } from '@/lib/best-ranking-db'
import { BEST_PAGE_SIZE, isPageOutOfRange, lastPageOf } from '@/lib/list-query'
import { POST_LIST_ITEM_SELECT } from '@/lib/queries/post-list-item-select'

/**
 * /best 읽기 — 베스트에 입성한 글 전체를 최초 입성 최신순으로 12개씩.
 *
 * 🔴 읽기 전용이다. 어떤 행도 만들거나 고치지 않는다 — 기록은 쓰기 경로의 일이다(best-ranking-db.ts).
 * 🔴 `prisma` 를 import 하지 않는다. 화면은 prisma 를, 격리 DB 검사는 자기 클라이언트를 넘긴다.
 * 🔴 1쪽과 2쪽의 뜻이 같다 — 1~12번째 입성 글, 13~24번째 입성 글. "현재" 와 "지난" 을 나누지 않는다.
 *
 * 보는 사람 필터
 *   숨김·삭제 글과 차단한 작성자의 글은 뺀다. **목록과 개수가 같은 where 를 쓴다.**
 *   전역 기록(BestSelection)은 보는 사람과 무관하다 — 여기서는 거르기만 한다.
 *   숨김 글은 행이 남아 있어, 되살리면 원래 입성 시각 자리로 돌아온다.
 */

type Db = Prisma.TransactionClient

export type BestPageResult =
  | { outOfRange: true }
  | {
      outOfRange: false
      page: number
      lastPage: number
      /** 이 보는 사람에게 보이는 입성 글 전체 수 */
      total: number
      posts: Prisma.PostGetPayload<{ select: typeof POST_LIST_ITEM_SELECT }>[]
    }

function visibleTo(blockedIds: readonly string[]): Prisma.BestSelectionWhereInput {
  return {
    post: {
      is: {
        ...BEST_PUBLIC_WHERE,
        ...(blockedIds.length ? { authorId: { notIn: [...blockedIds] } } : {}),
      },
    },
  }
}

export async function loadBestPage(
  db: Db,
  { page, blockedIds }: { page: number; blockedIds: readonly string[] },
): Promise<BestPageResult> {
  const where = visibleTo(blockedIds)

  /**
   * 🔴 개수를 먼저 센다. 범위 밖이면 skip 을 만들지 않는다 —
   *    거대한 page 가 skip 에 닿으면 Prisma 가 Int 범위를 넘겨 500 이 난다(게시판과 같은 계약).
   * 🔴 기록이 0건이어도 1쪽은 있다(빈 상태 화면). 2쪽부터는 404 — lastPageOf 가 하한을 1로 잡는다.
   */
  const total = await db.bestSelection.count({ where })
  if (isPageOutOfRange(page, total, BEST_PAGE_SIZE)) return { outOfRange: true }

  const rows = await db.bestSelection.findMany({
    where,
    // 최근 최초 입성순. postId 가 같은 시각(한 트랜잭션에서 여러 글이 입성)을 가른다 — 안정적인 고유 키다.
    orderBy: [{ firstEnteredAt: 'desc' }, { postId: 'desc' }],
    skip: (page - 1) * BEST_PAGE_SIZE,
    take: BEST_PAGE_SIZE,
    select: { post: { select: POST_LIST_ITEM_SELECT } },
  })

  return {
    outOfRange: false,
    page,
    lastPage: lastPageOf(total, BEST_PAGE_SIZE),
    total,
    posts: rows.map((r) => r.post),
  }
}
