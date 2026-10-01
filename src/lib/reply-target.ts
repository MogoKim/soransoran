import 'server-only'
import type { Prisma } from '@prisma/client'
import { REPLY_TARGET_BLOCKED, REPLY_TARGET_GONE } from '@/lib/comment-policy'

export type ReplyTarget =
  | { ok: true; parentId: null }
  | { ok: true; parentId: string; updatedAt: Date }
  | { ok: false; code: 'TARGET_GONE' | 'TARGET_BLOCKED'; error: string }

/**
 * 답글을 달 상대를 확인한다. 회원·비회원 두 경로가 같은 함수를 쓴다(comment-write.ts).
 *
 * 🔴 깊이는 막지 않는다. 답글에 다시 답글을 달 수 있다 — 대화는 필요한 만큼 이어진다.
 *    화면이 들여쓰기를 한 단계로 고정하므로 깊이가 모바일 폭을 먹지 않는다(comment-thread.ts).
 * 🔴 클라이언트가 보낸 id 를 믿지 않는다. 다음을 **저장과 같은 트랜잭션에서** 다시 본다 —
 *    확인과 저장 사이에 대상이 지워지는 틈을 남기지 않기 위해서다.
 *    · 대상이 있다 · 같은 글에 있다 · 지워지지 않았다
 *    · 보는 사람이 대상 작성자를 차단하지 않았다(화면에서 그 자리는 이름 없는 자리다)
 * 🔴 버튼을 감추는 것으로는 막히지 않는다 — 여기서 끊는다.
 */
export async function resolveReplyTarget(
  db: Prisma.TransactionClient,
  rawParentId: string,
  postId: string,
  viewerId: string | null,
): Promise<ReplyTarget> {
  const parentId = rawParentId.trim()
  if (!parentId) return { ok: true, parentId: null }

  const parent = await db.comment.findUnique({
    where: { id: parentId },
    select: { id: true, postId: true, isDeleted: true, authorId: true, updatedAt: true },
  })

  // 🔴 없는 댓글 · 지운 댓글 · 다른 글의 댓글을 같은 문장으로 돌려준다 — 무엇이 있는지 알려 주지 않는다
  if (!parent || parent.isDeleted || parent.postId !== postId) {
    return { ok: false, code: 'TARGET_GONE', error: REPLY_TARGET_GONE }
  }

  if (viewerId && parent.authorId) {
    const blocked = await db.userBlock.findUnique({
      where: { blockerId_blockedUserId: { blockerId: viewerId, blockedUserId: parent.authorId } },
      select: { id: true },
    })
    if (blocked) return { ok: false, code: 'TARGET_BLOCKED', error: REPLY_TARGET_BLOCKED }
  }

  return { ok: true, parentId: parent.id, updatedAt: parent.updatedAt }
}

/**
 * 🔴 대상 자격을 **저장 시점에 확정**한다 — 대상 행을 잠근다. 저장(create) 직전에 부른다.
 *
 *    읽기만 하면 "읽은 뒤 · 저장 전" 에 다른 세션이 대상을 지우고 먼저 커밋할 수 있다
 *    (Serializable 도 막지 못한다 — 삭제 경로는 Serializable 트랜잭션이 아니다).
 *    그래서 "지워지지 않은 이 대상" 에만 걸리는 조건부 쓰기로 행 잠금을 잡는다.
 *    · 삭제가 먼저 확정됐으면 → 0건이거나 직렬화 충돌 → 다시 시도하면 resolveReplyTarget 이 TARGET_GONE
 *    · 이쪽이 먼저 잠갔으면 → 삭제는 이 트랜잭션이 끝날 때까지 기다린다(답글은 자리 아래 남는다)
 * 🔴 쓰는 값은 방금 읽은 updatedAt **그대로**다 — 값을 바꾸지 않는다.
 *    Prisma 는 SELECT … FOR UPDATE 를 주지 않고 Raw SQL 은 쓰지 않으므로, 이것이 잠금을 잡는 방법이다.
 *    그 사이 다른 세션이 이 행을 고쳐 커밋했다면 Serializable 이 이 쓰기를 충돌로 돌려보낸다 —
 *    오래된 값으로 덮어쓰는 일은 없다.
 */
export async function holdReplyTarget(
  db: Prisma.TransactionClient,
  target: { parentId: string; updatedAt: Date },
  postId: string,
): Promise<boolean> {
  const held = await db.comment.updateMany({
    where: { id: target.parentId, postId, isDeleted: false },
    data: { updatedAt: target.updatedAt },
  })
  return held.count === 1
}
