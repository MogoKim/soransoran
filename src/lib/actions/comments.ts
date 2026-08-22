'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { getBoardBySlug } from '@/lib/board-registry'
import { checkActionRateLimit, retryMessage } from '@/lib/rate-limit'
import { checkContent } from '@/lib/content-guard'
import {
  MIN_COMMENT_LENGTH,
  MAX_COMMENT_LENGTH,
  COMMENT_TOO_SHORT,
  COMMENT_TOO_LONG,
} from '@/lib/comment-policy'

/** 댓글: 사용자당 5분에 10건 */
const COMMENT_LIMIT = 10
const COMMENT_WINDOW_MS = 5 * 60 * 1000

export type CommentActionState = { error?: string; ok?: true }

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

  const postId = String(formData.get('postId') ?? '')
  const boardSlug = String(formData.get('boardSlug') ?? '')
  const content = String(formData.get('content') ?? '').trim()

  if (content.length < MIN_COMMENT_LENGTH) {
    return { error: COMMENT_TOO_SHORT }
  }
  if (content.length > MAX_COMMENT_LENGTH) {
    return { error: COMMENT_TOO_LONG }
  }

  const guard = checkContent(content)
  if (!guard.ok) return { error: guard.reason }

  const limited = checkActionRateLimit('comment', userId, COMMENT_LIMIT, COMMENT_WINDOW_MS)
  if (!limited.ok) return { error: retryMessage(limited.retryAfterSec) }

  const post = await prisma.post.findFirst({
    where: { id: postId, status: 'PUBLISHED' },
    select: { id: true },
  })
  if (!post) return { error: '글을 찾을 수 없습니다.' }

  await prisma.comment.create({
    data: { postId, authorId: userId, content, source: 'USER' },
  })

  const board = getBoardBySlug(boardSlug)
  if (board) revalidatePath(`${board.href}/${postId}`)

  return { ok: true }
}
