import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { COMMUNITY_BOARDS } from '@/lib/board-registry'
import type { BoardType } from '@prisma/client'

const COMMUNITY_BOARD_TYPES = COMMUNITY_BOARDS.map((b) => b.type) as BoardType[]

/**
 * 🔴 차단 사용자 필터
 *
 * 우나어는 UserBlock 을 저장만 하고 어떤 쿼리도 필터로 쓰지 않는다.
 * 사용자는 보호받는다고 믿는데 실제로는 아니다 — 미구현보다 나쁘다.
 * 소란소란은 목록·상세 쿼리 모두에서 처음부터 필터를 적용한다.
 *
 * 차단 UI 를 D-day 에 숨기더라도 이 필터는 유지한다.
 */
async function getBlockedUserIds(): Promise<string[]> {
  const session = await auth()
  const viewerId = session?.user?.id
  if (!viewerId) return []

  const blocks = await prisma.userBlock.findMany({
    where: { blockerId: viewerId },
    select: { blockedUserId: true },
  })
  return blocks.map((b) => b.blockedUserId)
}

const POST_LIST_SELECT = {
  id: true,
  title: true,
  // 목록 미리보기용. 전체를 실어 나르지 않도록 화면에서 잘라 쓴다.
  content: true,
  createdAt: true,
  viewCount: true,
  author: { select: { id: true, name: true, image: true } },
  // 삭제된 댓글은 세지 않는다 — 목록의 숫자와 상세에 보이는 개수가 어긋나면 안 된다.
  _count: { select: { comments: { where: { isDeleted: false } }, likes: true } },
} as const

export async function getPostsByBoard(boardType: BoardType, take = 30) {
  const blockedIds = await getBlockedUserIds()

  return prisma.post.findMany({
    where: {
      boardType,
      status: 'PUBLISHED',
      ...(blockedIds.length ? { authorId: { notIn: blockedIds } } : {}),
    },
    select: POST_LIST_SELECT,
    orderBy: { createdAt: 'desc' },
    take,
  })
}

/** 홈용 — 커뮤니티 보드 전체에서 최신 글을 섞어 가져온다. */
export async function getRecentPosts(take = 6) {
  const blockedIds = await getBlockedUserIds()

  return prisma.post.findMany({
    where: {
      boardType: { in: COMMUNITY_BOARD_TYPES },
      status: 'PUBLISHED',
      ...(blockedIds.length ? { authorId: { notIn: blockedIds } } : {}),
    },
    select: { ...POST_LIST_SELECT, boardType: true },
    orderBy: { createdAt: 'desc' },
    take,
  })
}

export async function getPostDetail(postId: string) {
  const blockedIds = await getBlockedUserIds()

  const post = await prisma.post.findFirst({
    where: {
      id: postId,
      status: 'PUBLISHED',
      ...(blockedIds.length ? { authorId: { notIn: blockedIds } } : {}),
    },
    select: {
      id: true,
      boardType: true,
      title: true,
      content: true,
      createdAt: true,
      viewCount: true,
      author: { select: { id: true, name: true, image: true } },
    },
  })
  if (!post) return null

  const comments = await prisma.comment.findMany({
    where: {
      postId,
      isDeleted: false,
      ...(blockedIds.length ? { authorId: { notIn: blockedIds } } : {}),
    },
    select: {
      id: true,
      content: true,
      createdAt: true,
      author: { select: { id: true, name: true, image: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  return { post, comments }
}
