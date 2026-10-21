import type { BoardType, PostStatus, Prisma } from '@prisma/client'

/**
 * 게시글 단위 공용 mutex — Post 행을 잠근다 (2026-10-21 · PR #780 경쟁 조건 보정).
 *
 * 🔴 같은 글의 게시판 · 열린 Persona 후보를 함께 바꾸는 쓰기는 **모두 이 잠금을 먼저** 잡는다.
 *      어드민 게시판 변경(board-move-tx.ts) · 자동 후보 적재(persona-candidate-write.ts) ·
 *      수동 대상 지정(actions/persona-target.ts)
 *    순서는 하나다 — Post 행 잠금 → 지금 상태 · boardType 재확인 → 열린 후보 재확인 → 쓰기 → commit.
 *    그래서 "옮긴 글에 옛 게시판 문맥의 열린 후보가 남는" 상태가 생기지 않는다.
 *
 * 🔴 잠그는 방법은 best-ranking-db.ts lockPost 와 같다 — UPDATE 로 잠그되 값은 그대로다.
 *    Prisma 에는 SELECT … FOR UPDATE 가 없고, raw SQL · table lock · advisory lock 은 쓰지 않는다.
 *    읽은 updatedAt 을 조건에 넣고 **그 값을 그대로 다시 쓴다**(bestReactionWeight +0) —
 *    의미 있는 값도 updatedAt(sitemap lastModified · 어드민 수정 시각)도 바뀌지 않는다.
 *    읽은 뒤 잠그기 전에 다른 쓰기가 커밋되면 조건이 어긋나 0 건이고, 다시 읽어 새 값으로 잠근다 —
 *    돌려주는 값은 잠근 순간의 현재 값이다. 잠금은 호출부 트랜잭션이 끝날 때까지 이어진다.
 *
 * 🔴 반드시 트랜잭션 안에서 부른다. 트랜잭션 밖에서 부르면 잠금이 즉시 풀려 아무것도 막지 못한다.
 * 🔴 provider 호출 · 문장 생성 동안에는 이 잠금도 트랜잭션도 잡지 않는다 — 저장 직전에만 잡는다.
 */

/** 잠금 재시도 한도 — 읽고 잠그는 사이에 다른 쓰기가 끼어든 횟수. 넘으면 트랜잭션을 실패시킨다 */
export const POST_LOCK_ATTEMPTS = 5

export type LockedPost = { id: string; boardType: BoardType; status: PostStatus; updatedAt: Date }

export async function lockPostRow(tx: Prisma.TransactionClient, postId: string): Promise<LockedPost | null> {
  for (let attempt = 0; attempt < POST_LOCK_ATTEMPTS; attempt += 1) {
    const seen = await tx.post.findUnique({
      where: { id: postId },
      select: { id: true, boardType: true, status: true, updatedAt: true },
    })
    if (!seen) return null
    const locked = await tx.post.updateMany({
      where: { id: postId, updatedAt: seen.updatedAt },
      data: { bestReactionWeight: { increment: 0 }, updatedAt: seen.updatedAt },
    })
    if (locked.count === 1) return seen
  }
  throw new Error(`post-row-lock: 글 ${postId} 을 ${POST_LOCK_ATTEMPTS}번 연속 잠그지 못했다(경합)`)
}

/** 시험 전용 — 잠근 직후 · 판정 전에 멈출 자리. 운영 호출부는 넘기지 않는다 */
export type AfterPostLock = () => Promise<void>
