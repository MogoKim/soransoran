'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { checkActionRateLimit, retryMessage } from '@/lib/rate-limit'
import { requireOnboarded } from '@/lib/onboarding-guard'
import { COMMUNITY_VISIBLE_WHERE } from '@/lib/post-visibility'

/** 글 공감과 같은 한도를 쓴다 — 누르고 취소하는 일이 잦은 것도 같다 */
const LIKE_LIMIT = 30
const LIKE_WINDOW_MS = 60 * 1000

export type CommentLikeState = { error?: string; liked?: boolean; likeCount?: number }

/**
 * 댓글 공감 토글 — 회원 전용.
 *
 * 🔴 비회원은 조용히 성공시키지 않는다. 누를 수는 있는데 아무 일도 일어나지 않으면
 *    사람은 자기가 잘못 눌렀다고 생각하고 다시 누른다. 로그인이 필요하다고 말한다.
 *
 * 🔴 지워진 댓글에는 공감하지 않는다. 화면에서 사라진 뒤 남아 있던 요청이
 *    도착하면 아무도 못 보는 댓글의 숫자만 올라간다.
 *
 * 🔴 안 보이는 글의 댓글에도 공감하지 않는다. 글 공감과 같은 판정을 쓴다
 *    (COMMUNITY_VISIBLE_WHERE). 여기서 status 를 직접 비교하지 않는다.
 *
 * 🔴 지운 뒤에 세지 않고, 트랜잭션 안에서 갱신한 값을 돌려준다.
 *    바깥에서 다시 읽으면 그 사이 다른 사람의 공감이 섞여 화면 숫자가 튄다.
 */
export async function toggleCommentLike(commentId: string): Promise<CommentLikeState> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { error: '로그인이 필요합니다.' }

  const blocked = await requireOnboarded(userId)
  if (blocked) return { error: blocked.error }

  const limited = checkActionRateLimit('comment-like', userId, LIKE_LIMIT, LIKE_WINDOW_MS)
  if (!limited.ok) return { error: retryMessage(limited.retryAfterSec) }

  const target = await prisma.comment.findFirst({
    where: { id: commentId, isDeleted: false, post: COMMUNITY_VISIBLE_WHERE },
    select: { id: true },
  })
  if (!target) return { error: '댓글을 찾을 수 없습니다.' }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.commentLike.findUnique({
        where: { commentId_userId: { commentId, userId } },
        select: { id: true },
      })

      if (existing) {
        await tx.commentLike.delete({ where: { id: existing.id } })
        // 🔴 0 아래로 내려가지 않게 조건을 걸어 뺀다. 카운터가 음수가 되면
        //    화면이 "공감 -1" 을 보여주고, 그 뒤로는 무엇이 맞는 값인지 알 수 없다.
        await tx.comment.updateMany({
          where: { id: commentId, likeCount: { gt: 0 } },
          data: { likeCount: { decrement: 1 } },
        })
      } else {
        await tx.commentLike.create({ data: { commentId, userId } })
        await tx.comment.update({
          where: { id: commentId },
          data: { likeCount: { increment: 1 } },
        })
      }

      const after = await tx.comment.findUnique({
        where: { id: commentId },
        select: { likeCount: true },
      })
      return { liked: !existing, likeCount: after?.likeCount ?? 0 }
    })

    revalidatePath(`/community/[boardSlug]/[postId]`, 'page')
    return result
  } catch (error) {
    // 🔴 어느 계정인지 남기지 않는다.
    console.error('[comment-likes] toggle failed:', (error as Error).message)
    return { error: '공감 처리에 실패했어요. 잠시 뒤 다시 시도해 주세요.' }
  }
}
