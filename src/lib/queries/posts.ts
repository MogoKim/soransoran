import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { COMMUNITY_BOARDS } from '@/lib/board-registry'
import {
  COMMUNITY_VISIBLE_WHERE,
  DISCOVERY_ELIGIBLE_WHERE,
  POST_VISIBILITY_SELECT,
} from '@/lib/post-visibility'
import type { BoardType } from '@prisma/client'

const COMMUNITY_BOARD_TYPES = COMMUNITY_BOARDS.map((b) => b.type) as BoardType[]

/**
 * 🟢 Micro Seed 는 여기서 제외하지 않는다.
 *
 * 커뮤니티 목록·상세는 Micro Seed 가 "보여야 하는" 표면이다.
 * 제외 대상은 sitemap · JSON-LD · OG · best · trending · related · search ·
 * topic hub · public API 이지 커뮤니티 화면이 아니다.
 * 목록·상세에서 빼면 레인의 목적(커뮤니티 생활감)이 사라진다.
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §2-0 · §4 · §7-A
 */

/**
 * 🔴 차단 사용자 필터
 *
 * 차단을 저장만 해 두고 어느 쿼리에서도 걸러내지 않으면, 사용자는 보호받는다고
 * 믿는데 실제로는 아니다 — 미구현보다 나쁘다.
 * 그래서 목록·상세 쿼리 모두에서 처음부터 필터를 적용한다.
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
  author: { select: { id: true, name: true, nickname: true, image: true } },
  // 삭제된 댓글은 세지 않는다 — 목록의 숫자와 상세에 보이는 개수가 어긋나면 안 된다.
  _count: { select: { comments: { where: { isDeleted: false } }, likes: true } },
} as const

export async function getPostsByBoard(boardType: BoardType, take = 30) {
  const blockedIds = await getBlockedUserIds()

  return prisma.post.findMany({
    where: {
      boardType,
      ...COMMUNITY_VISIBLE_WHERE,
      ...(blockedIds.length ? { authorId: { notIn: blockedIds } } : {}),
    },
    select: POST_LIST_SELECT,
    orderBy: { createdAt: 'desc' },
    take,
  })
}

/**
 * 홈 "지금 올라온 이야기" 용 — 커뮤니티 보드 전체에서 최신 글을 섞어 가져온다.
 *
 * 🔴 이건 community list 가 아니라 **discovery 표면**이다.
 *    특정 게시판을 열어 보는 것과, 서비스가 대표로 골라 첫 화면에 올리는 것은 다르다.
 *    따라서 DISCOVERY_ELIGIBLE_WHERE 를 쓰고 Micro Seed 를 제외한다.
 *
 * 게시판 목록·상세(getPostsByBoard · getPostDetail)는 COMMUNITY_VISIBLE_WHERE 를
 * 그대로 쓴다 — 거기서는 Micro Seed 가 보여야 한다.
 */
export async function getRecentDiscoveryPosts(take = 6) {
  const blockedIds = await getBlockedUserIds()

  return prisma.post.findMany({
    where: {
      boardType: { in: COMMUNITY_BOARD_TYPES },
      ...DISCOVERY_ELIGIBLE_WHERE,
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
      ...COMMUNITY_VISIBLE_WHERE,
      ...(blockedIds.length ? { authorId: { notIn: blockedIds } } : {}),
    },
    select: {
      id: true,
      boardType: true,
      title: true,
      content: true,
      createdAt: true,
      viewCount: true,
      author: { select: { id: true, name: true, nickname: true, image: true } },
      // 상세 metadata 가 robotsMetaFor() 로 noindex 를 판정하는 데 쓴다.
      ...POST_VISIBILITY_SELECT,
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
      author: { select: { id: true, name: true, nickname: true, image: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  return { post, comments }
}
