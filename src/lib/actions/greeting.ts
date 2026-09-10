'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { getBoardByType } from '@/lib/board-registry'
import { checkActionRateLimit, retryMessage } from '@/lib/rate-limit'
import { checkContent } from '@/lib/content-guard'
import { requireOnboarded, MEMBER_NOT_FOUND } from '@/lib/onboarding-guard'
import {
  FIRST_GREETING_BOARD_TYPE,
  FIRST_GREETING_MAX_LENGTH,
  FIRST_GREETING_MIN_LENGTH,
  FIRST_GREETING_WINDOW_MS,
  GREETING_CATEGORY,
} from '@/lib/greeting-policy'
import { GREETING_POST_VISIBILITY_FLAGS } from '@/lib/post-visibility'
import type { BoardType } from '@prisma/client'

/** 첫 인사는 평생 한 번이다. 오타를 고쳐 다시 누르는 정도만 열어 둔다 */
const GREETING_LIMIT = 5
const GREETING_WINDOW_MS = 10 * 60 * 1000

/** 제목은 사용자가 정하지 않는다. 인사말 한 줄만 받는다 */
const GREETING_TITLE = '처음 인사드려요'

const TOO_SHORT = `인사말을 ${FIRST_GREETING_MIN_LENGTH}자 이상 적어주세요.`
const TOO_LONG = `인사말은 ${FIRST_GREETING_MAX_LENGTH}자까지 쓸 수 있어요.`
const WINDOW_CLOSED = '첫 인사를 남기는 기간이 지났어요. 자유게시판에 이야기를 남겨보세요.'
const ALREADY_GREETED = '이미 첫 인사를 남기셨어요.'
const SAVE_FAILED = '인사를 남기는 중 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.'

/**
 * 🔴 needsOnboarding 은 optional 이다 — 다른 액션들과 같은 규약이다.
 *    호출하는 화면이 error 만 읽어도 깨지지 않아야 한다.
 */
export type GreetingActionState = {
  error?: string
  needsOnboarding?: true
  /** 성공했을 때만 채운다. 이동은 화면이 정한다 */
  postId?: string
  href?: string
}

/**
 * 첫 가입 인사 저장
 *
 * 새로 온 사람이 한 줄 인사를 남긴다. 일반 글쓰기와 다른 경로이고,
 * 저장되는 자리도 보이는 자리도 다르다 —
 * 자유게시판 목록에서는 빠지고(category), 색인·추천에서도 빠진다(3축 플래그).
 *
 * 🔴 redirect 하지 않는다.
 *    이 액션은 홈 위젯에서 불린다. 인사 하나 남겼다고 사람을 홈 밖으로
 *    끌어내면, 방금 "여기 있어도 된다" 고 말해 놓고 내보내는 셈이 된다.
 *    갈 곳은 돌려주되 갈지 말지는 화면이 정한다.
 *
 * 🔴 제목을 받지 않는다.
 *    첫 인사에 제목까지 지어내라고 하면 한 줄 쓰자던 약속이 깨진다.
 */
export async function submitGreeting(
  _prev: GreetingActionState,
  formData: FormData,
): Promise<GreetingActionState> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { error: '로그인이 필요합니다.' }

  // 저장 전에 막는다. 여기서 통과해야 아래 어떤 write 도 일어나지 않는다.
  const blocked = await requireOnboarded(userId)
  if (blocked) return blocked

  const content = String(formData.get('content') ?? '').trim()
  if (content.length < FIRST_GREETING_MIN_LENGTH) return { error: TOO_SHORT }
  if (content.length > FIRST_GREETING_MAX_LENGTH) return { error: TOO_LONG }

  const guard = checkContent(content, { audience: 'user' })
  if (!guard.ok) return { error: guard.reason }

  const limited = checkActionRateLimit('greeting', userId, GREETING_LIMIT, GREETING_WINDOW_MS)
  if (!limited.ok) return { error: retryMessage(limited.retryAfterSec) }

  const member = await prisma.user.findUnique({
    where: { id: userId },
    select: { createdAt: true, firstGreetingAt: true },
  })
  if (!member) return { error: MEMBER_NOT_FOUND }

  /**
   * 🔴 기간이 지나면 받지 않는다.
   *    첫 인사는 "막 온 사람" 의 자리다. 몇 달 뒤에 남긴 인사가 홈의
   *    '새로 온 이웃' 에 뜨면 그 자리의 뜻이 없어진다.
   */
  if (Date.now() - member.createdAt.getTime() > FIRST_GREETING_WINDOW_MS) {
    return { error: WINDOW_CLOSED }
  }
  if (member.firstGreetingAt) return { error: ALREADY_GREETED }

  /**
   * 🔴 slug 를 손으로 적지 않는다.
   *    저장은 FIRST_GREETING_BOARD_TYPE 을 쓰는데 링크만 'free' 를 박아 두면,
   *    나중에 첫 인사가 다른 게시판으로 옮겨질 때 글은 옮겨가고 링크는
   *    남은 자리를 가리킨다. 같은 상수에서 둘 다 나오게 둔다.
   */
  const board = getBoardByType(FIRST_GREETING_BOARD_TYPE)
  if (!board) return { error: SAVE_FAILED }

  try {
    /**
     * 🔴 자리를 먼저 잡고 글을 쓴다.
     *    updateMany 의 where 에 firstGreetingAt: null 을 두면, 두 요청이 동시에
     *    들어와도 UPDATE 를 성공시키는 쪽은 하나뿐이다. count 가 0 이면 진 쪽이니
     *    글을 만들지 않고 트랜잭션을 되돌린다 — 위의 findUnique 검사만으로는
     *    두 요청이 나란히 통과해 인사 글이 두 개 생긴다.
     *
     * 🔴 Post 생성과 User 기록이 한 트랜잭션에 있다.
     *    글만 남고 이력이 빠지면 위젯이 계속 뜨고, 이력만 남고 글이 빠지면
     *    홈 '새로 온 이웃' 이 빈 곳을 가리킨다.
     */
    const post = await prisma.$transaction(async (tx) => {
      const claimed = await tx.user.updateMany({
        where: { id: userId, firstGreetingAt: null },
        data: { firstGreetingAt: new Date() },
      })
      if (claimed.count === 0) throw new Error('ALREADY_GREETED')

      const created = await tx.post.create({
        data: {
          boardType: FIRST_GREETING_BOARD_TYPE as BoardType,
          category: GREETING_CATEGORY,
          title: GREETING_TITLE,
          content,
          authorId: userId,
          source: 'USER',
          // 🔴 항상 마지막. 호출자가 무엇을 넘기든 이 값이 이긴다.
          ...GREETING_POST_VISIBILITY_FLAGS,
        },
        select: { id: true },
      })

      await tx.user.update({
        where: { id: userId },
        data: { firstGreetingPostId: created.id },
      })

      return created
    })

    revalidatePath('/')
    return { postId: post.id, href: `${board.href}/${post.id}` }
  } catch (error) {
    if (error instanceof Error && error.message === 'ALREADY_GREETED') {
      return { error: ALREADY_GREETED }
    }
    // 🔴 어느 계정인지 남기지 않는다.
    console.error('[greeting] save failed:', (error as Error).message)
    return { error: SAVE_FAILED }
  }
}
