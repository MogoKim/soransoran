import { prisma } from '@/lib/prisma'

/**
 * 상세 액션바가 쓰는 스크랩 상태.
 *
 * 🔴 개수를 세지 않는다. 스크랩 수는 어느 화면에도 표시하지 않는다 —
 *    내가 담아 뒀는지만 알면 된다.
 *
 * 🔴 비로그인은 DB 를 두드리지 않는다. 내 스크랩이 있을 수 없는 상태다.
 */
export async function getPostScrapState(postId: string, viewerId?: string): Promise<boolean> {
  if (!viewerId) return false

  const mine = await prisma.scrap.findUnique({
    where: { postId_userId: { postId, userId: viewerId } },
    select: { id: true },
  })
  return Boolean(mine)
}
