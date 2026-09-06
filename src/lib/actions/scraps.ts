'use server'

import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { checkActionRateLimit, retryMessage } from '@/lib/rate-limit'
import { requireOnboarded } from '@/lib/onboarding-guard'
import { COMMUNITY_VISIBLE_WHERE } from '@/lib/post-visibility'
import { POST_NOT_FOUND } from '@/lib/post-policy'

/** 스크랩: 사용자당 1분에 30건. 공감과 같은 한도를 쓴다 — 누르고 되돌리는 결이 같다 */
const SCRAP_LIMIT = 30
const SCRAP_WINDOW_MS = 60 * 1000

export type ScrapToggleState = { error?: string; scrapped?: boolean }

/**
 * 스크랩 토글.
 *
 * 🔴 공감과 같은 순서를 쓴다 — auth → 온보딩 → rate limit → 노출 판정.
 *    쓰기 액션마다 게이트가 다르면 어디는 되고 어디는 안 되는 이유를 설명할 수 없다.
 *
 * 🔴 카운터를 올리지 않는다. Post 를 건드리지 않으므로 트랜잭션이 지키는 것은
 *    Scrap 한 행뿐이지만, 나중에 카운터가 생겨도 이 자리를 고치지 않도록 묶어 둔다.
 *
 * 🔴 revalidatePath 를 부르지 않는다. 스크랩은 화면에 숫자를 남기지 않고,
 *    /my/scraps 는 force-dynamic 이라 들어갈 때마다 다시 읽는다.
 */
export async function togglePostScrap(postId: string): Promise<ScrapToggleState> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { error: '로그인이 필요합니다.' }

  const blocked = await requireOnboarded(userId)
  if (blocked) return { error: blocked.error }

  const limited = checkActionRateLimit('post-scrap', userId, SCRAP_LIMIT, SCRAP_WINDOW_MS)
  if (!limited.ok) return { error: retryMessage(limited.retryAfterSec) }

  const target = await prisma.post.findFirst({
    where: { id: postId, ...COMMUNITY_VISIBLE_WHERE },
    select: { id: true },
  })
  if (!target) return { error: POST_NOT_FOUND }

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.scrap.findUnique({
        where: { postId_userId: { postId, userId } },
        select: { id: true },
      })

      if (existing) {
        await tx.scrap.delete({ where: { id: existing.id } })
        return { scrapped: false }
      }

      await tx.scrap.create({ data: { postId, userId } })
      return { scrapped: true }
    })
  } catch (error) {
    // 🔴 어느 계정인지 남기지 않는다.
    console.error('[scraps] toggle failed:', (error as Error).message)
    return { error: '스크랩 처리에 실패했어요. 잠시 뒤 다시 시도해 주세요.' }
  }
}
