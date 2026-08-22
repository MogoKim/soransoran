'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { getBoardBySlug } from '@/lib/board-registry'

const MIN_COMMENT_LENGTH = 2

export type CommentActionState = { error?: string }

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
    return { error: '댓글을 조금만 더 적어주세요.' }
  }

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

  return {}
}
