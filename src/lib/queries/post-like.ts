import { prisma } from '@/lib/prisma'

export type PostLikeState = { likeCount: number; isLiked: boolean }

/**
 * 상세 액션바가 쓰는 공감 상태.
 *
 * 🔴 getPostDetail 을 넓히지 않고 따로 읽는다.
 *    그 함수는 목록·상세가 함께 쓰는 select 를 들고 있어, 공감 때문에 손대면
 *    이번 범위 밖(목록·홈·베스트)까지 영향이 번진다.
 *
 * 🔴 비로그인은 DB 를 두드리지 않는다. 내 공감이 있을 수 없는 상태다.
 */
export async function getPostLikeState(
  postId: string,
  viewerId?: string,
): Promise<PostLikeState> {
  const [post, mine] = await Promise.all([
    prisma.post.findUnique({ where: { id: postId }, select: { likeCount: true } }),
    viewerId
      ? prisma.like.findUnique({
          where: { postId_userId: { postId, userId: viewerId } },
          select: { id: true },
        })
      : Promise.resolve(null),
  ])

  return { likeCount: post?.likeCount ?? 0, isLiked: Boolean(mine) }
}
