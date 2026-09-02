import { prisma } from '@/lib/prisma'

/** 댓글 수와 무관하게 한 번만 묻는다. 비로그인이면 DB 를 두드리지 않는다. */
export async function getLikedCommentIds(
  commentIds: string[],
  viewerId?: string,
): Promise<Set<string>> {
  if (!viewerId || commentIds.length === 0) return new Set()

  const rows = await prisma.commentLike.findMany({
    where: { userId: viewerId, commentId: { in: commentIds } },
    select: { commentId: true },
  })

  return new Set(rows.map((row) => row.commentId))
}
