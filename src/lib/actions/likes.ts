'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { checkActionRateLimit, retryMessage } from '@/lib/rate-limit'
import { requireOnboarded } from '@/lib/onboarding-guard'
import { COMMUNITY_VISIBLE_WHERE } from '@/lib/post-visibility'
import { POST_NOT_FOUND } from '@/lib/post-policy'

/** 공감: 사용자당 1분에 30건. 누르고 취소하는 일이 잦아 넉넉히 둔다 */
const LIKE_LIMIT = 30
const LIKE_WINDOW_MS = 60 * 1000

export type LikeToggleState = { error?: string; liked?: boolean; likeCount?: number }

/**
 * 공감 토글.
 *
 * 🔴 온보딩을 요구한다. 글·댓글·신고가 모두 그렇다 —
 *    공감만 열어 두면 닉네임 없는 계정이 남기는 흔적이 생긴다.
 *
 * 🔴 지금 보이는 글에만 공감한다. 목록·상세와 같은 판정을 쓴다
 *    (COMMUNITY_VISIBLE_WHERE). 여기서 status 를 직접 비교하지 않는다.
 *
 * 🔴 자기 글 공감을 막지 않는다. 막을 이유가 없고, 막으면 그 사실을 또 설명해야 한다.
 *
 * 🔴 지운 뒤에 세지 않고, 트랜잭션 안에서 갱신한 값을 돌려준다.
 *    바깥에서 다시 읽으면 그 사이 다른 사람의 공감이 섞여 화면 숫자가 튄다.
 */
export async function togglePostLike(postId: string): Promise<LikeToggleState> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { error: '로그인이 필요합니다.' }

  const blocked = await requireOnboarded(userId)
  if (blocked) return { error: blocked.error }

  const limited = checkActionRateLimit('post-like', userId, LIKE_LIMIT, LIKE_WINDOW_MS)
  if (!limited.ok) return { error: retryMessage(limited.retryAfterSec) }

  const target = await prisma.post.findFirst({
    where: { id: postId, ...COMMUNITY_VISIBLE_WHERE },
    select: { id: true },
  })
  if (!target) return { error: POST_NOT_FOUND }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.like.findUnique({
        where: { postId_userId: { postId, userId } },
        select: { id: true },
      })

      if (existing) {
        await tx.like.delete({ where: { id: existing.id } })
        // 🔴 0 아래로 내려가지 않게 조건을 걸어 뺀다. 카운터가 음수가 되면
        //    화면이 "공감 -1" 을 보여주고, 그 뒤로는 무엇이 맞는 값인지 알 수 없다.
        await tx.post.updateMany({
          where: { id: postId, likeCount: { gt: 0 } },
          data: { likeCount: { decrement: 1 } },
        })
      } else {
        await tx.like.create({ data: { postId, userId } })
        await tx.post.update({
          where: { id: postId },
          data: { likeCount: { increment: 1 } },
        })
      }

      const after = await tx.post.findUnique({
        where: { id: postId },
        select: { likeCount: true },
      })
      return { liked: !existing, likeCount: after?.likeCount ?? 0 }
    })

    revalidatePath(`/community/[boardSlug]/[postId]`, 'page')
    return result
  } catch (error) {
    // 🔴 어느 계정인지 남기지 않는다.
    console.error('[likes] toggle failed:', (error as Error).message)
    return { error: '공감 처리에 실패했어요. 잠시 뒤 다시 시도해 주세요.' }
  }
}
