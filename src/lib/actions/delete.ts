'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { getBoardBySlug } from '@/lib/board-registry'
import { requireOnboarded } from '@/lib/onboarding-guard'
import { POST_NOT_FOUND } from '@/lib/post-policy'
import { COMMENT_NOT_FOUND } from '@/lib/comment-policy'

/**
 * 작성자 본인 삭제
 *
 * 🔴 물리 삭제하지 않는다.
 *    글   Post.status = 'DELETED'
 *    댓글 Comment.isDeleted = true
 *
 * 목록·상세·sitemap 쿼리가 이미 status='PUBLISHED' / isDeleted=false 로
 * 필터하고 있으므로, 상태만 바꾸면 노출에서 즉시 빠진다.
 *
 * 관리자 삭제·숨김은 이번 범위가 아니다. 작성자 본인만 지울 수 있다.
 */
export type DeleteActionState = {
  error?: string
  /**
   * 삭제 성공 후 이동할 경로.
   *
   * server action 에서 redirect() 를 호출하면 useFormState 의 에러 반환 경로와
   * 충돌하므로(리다이렉트가 예외로 던져진다), 경로만 돌려주고 이동은 client 에서 한다.
   */
  redirectTo?: string
  /**
   * 🔴 optional 이다. 지금 화면들은 error 만 읽는다 —
   *    필수로 두면 기존 반환 경로가 전부 깨진다.
   *    O3-B 에서 화면이 이 값으로 온보딩 안내를 띄울지 정한다.
   */
  needsOnboarding?: true
}

export async function deletePost(
  _prev: DeleteActionState,
  formData: FormData,
): Promise<DeleteActionState> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { error: '로그인이 필요합니다.' }

  // 🔴 저장 전에 막는다. 여기서 통과해야 아래 어떤 write 도 일어나지 않는다.
  const blocked = await requireOnboarded(userId)
  if (blocked) return blocked

  const postId = String(formData.get('postId') ?? '')
  const boardSlug = String(formData.get('boardSlug') ?? '')
  if (!postId) return { error: POST_NOT_FOUND }

  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, authorId: true, status: true },
  })
  if (!post || post.status === 'DELETED') return { error: POST_NOT_FOUND }

  // 🔴 본인 확인 — 서버에서 반드시 검증한다. UI 노출 제어만으로는 부족하다.
  if (post.authorId !== userId) return { error: '본인이 쓴 글만 지울 수 있습니다.' }

  await prisma.post.update({
    where: { id: postId },
    data: { status: 'DELETED' },
  })

  const board = getBoardBySlug(boardSlug)
  if (board) {
    revalidatePath(board.href)
    revalidatePath(`${board.href}/${postId}`)
  }

  // 상세 페이지는 삭제 직후 notFound() 가 된다.
  // 사용자가 404 를 보지 않도록 목록 경로를 돌려준다.
  return { redirectTo: board?.href ?? '/' }
}

export async function deleteComment(
  _prev: DeleteActionState,
  formData: FormData,
): Promise<DeleteActionState> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { error: '로그인이 필요합니다.' }

  // 🔴 저장 전에 막는다. 여기서 통과해야 아래 어떤 write 도 일어나지 않는다.
  const blocked = await requireOnboarded(userId)
  if (blocked) return blocked

  const commentId = String(formData.get('commentId') ?? '')
  const postId = String(formData.get('postId') ?? '')
  const boardSlug = String(formData.get('boardSlug') ?? '')
  if (!commentId) return { error: COMMENT_NOT_FOUND }

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, authorId: true, isDeleted: true },
  })
  if (!comment || comment.isDeleted) return { error: COMMENT_NOT_FOUND }

  if (comment.authorId !== userId) return { error: '본인이 쓴 댓글만 지울 수 있습니다.' }

  await prisma.comment.update({
    where: { id: commentId },
    data: { isDeleted: true },
  })

  const board = getBoardBySlug(boardSlug)
  if (board && postId) revalidatePath(`${board.href}/${postId}`)

  return {}
}
