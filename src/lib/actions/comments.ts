'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { getBoardBySlug } from '@/lib/board-registry'
import { resolveReplyTarget } from '@/lib/reply-target'
import { checkActionRateLimit, retryMessage } from '@/lib/rate-limit'
import { checkContent } from '@/lib/content-guard'
import { requireOnboarded } from '@/lib/onboarding-guard'
import {
  MIN_COMMENT_LENGTH,
  MAX_COMMENT_LENGTH,
  COMMENT_TOO_SHORT,
  COMMENT_TOO_LONG,
  COMMENT_NOT_FOUND,
} from '@/lib/comment-policy'
import { POST_NOT_FOUND } from '@/lib/post-policy'
import { refreshBestRanking } from '@/lib/best-ranking-db'

/** 댓글: 사용자당 5분에 10건 */
const COMMENT_LIMIT = 10
const COMMENT_WINDOW_MS = 5 * 60 * 1000

/**
 * 🔴 needsOnboarding 은 optional 이다.
 *    지금 화면들은 error 만 읽는다. 필수로 두면 기존 반환 경로가 전부 깨진다.
 *    O3-B 에서 화면이 이 값으로 온보딩 안내를 띄울지 정한다.
 */
export type CommentActionState = { error?: string; ok?: true; needsOnboarding?: true }

/**
 * 댓글 작성
 *
 * 🔴 로그인 회원만 쓸 수 있다.
 * 🔴 source 는 항상 USER 다. 봇 댓글 경로를 만들지 않는다.
 */
export async function createComment(
  _prev: CommentActionState,
  formData: FormData,
): Promise<CommentActionState> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { error: '로그인이 필요합니다.' }

  // 🔴 저장 전에 막는다. 여기서 통과해야 아래 어떤 write 도 일어나지 않는다.
  const blocked = await requireOnboarded(userId)
  if (blocked) return blocked

  const postId = String(formData.get('postId') ?? '')
  const boardSlug = String(formData.get('boardSlug') ?? '')
  const content = String(formData.get('content') ?? '').trim()

  if (content.length < MIN_COMMENT_LENGTH) {
    return { error: COMMENT_TOO_SHORT }
  }
  if (content.length > MAX_COMMENT_LENGTH) {
    return { error: COMMENT_TOO_LONG }
  }

  const guard = checkContent(content, { audience: 'user' })
  if (!guard.ok) return { error: guard.reason }

  const limited = checkActionRateLimit('comment', userId, COMMENT_LIMIT, COMMENT_WINDOW_MS)
  if (!limited.ok) return { error: retryMessage(limited.retryAfterSec) }

  const post = await prisma.post.findFirst({
    where: { id: postId, status: 'PUBLISHED' },
    select: { id: true },
  })
  if (!post) return { error: POST_NOT_FOUND }

  // 답글이면 상대를 확인한다 — depth 2 와 지워진 댓글은 여기서 끊는다
  const target = await resolveReplyTarget(String(formData.get('parentId') ?? ''), postId)
  if (!target.ok) return { error: target.error }

  // /best 순위·기록을 댓글과 같은 트랜잭션에 둔다 — 댓글만 남고 순위가 빠지는 일이 없다.
  await prisma.$transaction(async (tx) => {
    await tx.comment.create({
      data: { postId, authorId: userId, content, source: 'USER', parentId: target.parentId },
      select: { id: true },
    })
    await refreshBestRanking(tx, postId)
  })

  const board = getBoardBySlug(boardSlug)
  if (board) revalidatePath(`${board.href}/${postId}`)

  return { ok: true }
}

/** 댓글 수정: 사용자당 5분에 20건 */
const COMMENT_EDIT_LIMIT = 20
const COMMENT_EDIT_WINDOW_MS = 5 * 60 * 1000

/**
 * 댓글 수정
 *
 * 🔴 본인 확인을 서버에서 다시 한다. 버튼을 감추는 것만으로는 막히지 않는다.
 * 🔴 지운 댓글은 되살리지 않는다. 삭제는 삭제로 남는다.
 * 🔴 길이 정책과 checkContent 는 새로 쓸 때와 같은 것을 쓴다.
 */
export async function updateComment(
  _prev: CommentActionState,
  formData: FormData,
): Promise<CommentActionState> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { error: '로그인이 필요합니다.' }

  // 🔴 저장 전에 막는다. 여기서 통과해야 아래 어떤 write 도 일어나지 않는다.
  const blocked = await requireOnboarded(userId)
  if (blocked) return blocked

  const commentId = String(formData.get('commentId') ?? '')
  const postId = String(formData.get('postId') ?? '')
  const boardSlug = String(formData.get('boardSlug') ?? '')
  const content = String(formData.get('content') ?? '').trim()

  if (content.length < MIN_COMMENT_LENGTH) {
    return { error: COMMENT_TOO_SHORT }
  }
  if (content.length > MAX_COMMENT_LENGTH) {
    return { error: COMMENT_TOO_LONG }
  }

  const guard = checkContent(content, { audience: 'user' })
  if (!guard.ok) return { error: guard.reason }

  const limited = checkActionRateLimit(
    'comment-edit',
    userId,
    COMMENT_EDIT_LIMIT,
    COMMENT_EDIT_WINDOW_MS,
  )
  if (!limited.ok) return { error: retryMessage(limited.retryAfterSec) }

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: {
      id: true,
      authorId: true,
      isDeleted: true,
      postId: true,
      post: { select: { status: true, boardType: true } },
    },
  })
  if (!comment || comment.isDeleted) return { error: COMMENT_NOT_FOUND }
  // 글이 내려간 뒤에는 댓글도 고치지 않는다. 읽을 수 없는 자리에 글자만 바뀐다.
  if (comment.post.status !== 'PUBLISHED') return { error: POST_NOT_FOUND }

  const board = getBoardBySlug(boardSlug)
  // 주소가 가리키는 게시판과 댓글이 달린 글의 게시판이 다르면 요청 자체가 틀렸다.
  // 댓글이 사는 곳은 커뮤니티 게시판뿐이라, 그 밖의 slug 는 받지 않는다.
  if (!board || !board.isCommunity || comment.post.boardType !== board.type) {
    return { error: COMMENT_NOT_FOUND }
  }
  if (comment.postId !== postId) return { error: COMMENT_NOT_FOUND }

  if (comment.authorId !== userId) return { error: '본인이 쓴 댓글만 고칠 수 있습니다.' }

  await prisma.comment.update({
    where: { id: commentId },
    data: { content },
  })

  revalidatePath(`${board.href}/${postId}`)

  return { ok: true }
}
