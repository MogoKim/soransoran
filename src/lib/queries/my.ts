import { prisma } from '@/lib/prisma'
import { COMMUNITY_VISIBLE_WHERE } from '@/lib/post-visibility'
import type { BoardType } from '@prisma/client'

/** 마이페이지 목록은 "최근 것부터 조금만". 훑어보는 자리지 관리하는 자리가 아니다 */
export const MY_LIST_LIMIT = 10

export type MyProfile = {
  nickname: string | null
  name: string | null
  createdAt: Date
}

export type MyPostRow = {
  id: string
  title: string
  boardType: BoardType
  createdAt: Date
}

export type MyCommentRow = {
  id: string
  content: string
  createdAt: Date
  post: { id: string; title: string; boardType: BoardType }
}

/**
 * 마이페이지가 쓰는 조회를 한곳에 모은다.
 *
 * 🔴 세 조회를 한 번에 보낸다. 화면이 셋을 다 받아야 그려지므로
 *    순서대로 기다릴 이유가 없다.
 *
 * 🔴 노출 판정을 여기서 직접 쓰지 않는다 — COMMUNITY_VISIBLE_WHERE 를 그대로 가져온다.
 *    status 를 이 파일에서 비교하면 판정이 두 곳이 되어, 정책이 바뀐 날 목록과
 *    마이페이지가 서로 다른 글을 보여주게 된다 (post-visibility C-2).
 *
 * 🔴 "작성자 본인에게는 숨김 글도 보인다" 는 별도의 노출 축이다.
 *    그 축은 3축과 함께 설계해야 하므로 1차에서는 열지 않는다.
 */
export async function getMyPageData(userId: string): Promise<{
  profile: MyProfile | null
  posts: MyPostRow[]
  comments: MyCommentRow[]
}> {
  const [profile, posts, comments] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { nickname: true, name: true, createdAt: true },
    }),
    prisma.post.findMany({
      where: { authorId: userId, ...COMMUNITY_VISIBLE_WHERE },
      select: { id: true, title: true, boardType: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: MY_LIST_LIMIT,
    }),
    prisma.comment.findMany({
      // 지운 댓글과, 원글이 내려간 댓글은 보이지 않는다 — 눌러도 갈 곳이 없다
      where: { authorId: userId, isDeleted: false, post: { ...COMMUNITY_VISIBLE_WHERE } },
      select: {
        id: true,
        content: true,
        createdAt: true,
        post: { select: { id: true, title: true, boardType: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: MY_LIST_LIMIT,
    }),
  ])

  return { profile, posts, comments }
}
