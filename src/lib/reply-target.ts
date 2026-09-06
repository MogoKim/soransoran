import 'server-only'
import { prisma } from '@/lib/prisma'
import { COMMENT_NOT_FOUND } from '@/lib/comment-policy'

/**
 * 🔴 댓글 공감·수정·삭제와 **같은 문장**을 쓴다. 답글을 달려던 상대가 사라진 것도
 *    "댓글이 그 자리에 없다" 는 같은 사실이다 — 정본 §12-20.
 */
export const REPLY_TARGET_GONE = COMMENT_NOT_FOUND
export const REPLY_DEPTH_LIMIT = '답글에는 다시 답글을 달 수 없어요.'

export type ReplyTarget = { ok: true; parentId: string | null } | { ok: false; error: string }

/**
 * 답글을 달 상대를 확인한다. 회원·비회원 두 경로가 같은 함수를 쓴다.
 *
 * 🔴 버튼을 감추는 것으로는 막히지 않는다 — depth 2 는 여기서 끊는다.
 */
export async function resolveReplyTarget(
  rawParentId: string,
  postId: string,
): Promise<ReplyTarget> {
  const parentId = rawParentId.trim()
  if (!parentId) return { ok: true, parentId: null }

  const parent = await prisma.comment.findUnique({
    where: { id: parentId },
    select: { id: true, postId: true, parentId: true, isDeleted: true },
  })

  if (!parent || parent.isDeleted) return { ok: false, error: REPLY_TARGET_GONE }
  if (parent.postId !== postId) return { ok: false, error: REPLY_TARGET_GONE }
  if (parent.parentId !== null) return { ok: false, error: REPLY_DEPTH_LIMIT }

  return { ok: true, parentId: parent.id }
}
