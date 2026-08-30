'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { checkActionRateLimit, retryMessage } from '@/lib/rate-limit'
import { NICKNAME_TAKEN, validateNicknameFormat } from '@/lib/nickname'
import { requireOnboarded } from '@/lib/onboarding-guard'

/** 닉네임 변경: 사용자당 1분에 5건. 확인(30건)보다 좁게 둔다 — 저장은 자주 할 일이 아니다 */
const NICKNAME_SAVE_LIMIT = 5
const NICKNAME_SAVE_WINDOW_MS = 60 * 1000

export type NicknameSaveState = { error?: string; ok?: true; unchanged?: true }

/**
 * 닉네임 변경 — 마이페이지 전용.
 *
 * 🔴 온보딩의 completeOnboarding 을 재사용하지 않는다.
 *    그쪽은 최초 1회 게이트라 이미 마친 회원을 거부한다. 여기는 그 반대다.
 *
 * 🔴 지금과 같은 이름을 저장하는 것은 실패가 아니다.
 *    자기 이름은 unique 검사에서 자기 자신과 부딪히는데, 이것을 중복으로 돌려주면
 *    "내 이름을 내가 못 쓴다" 는 화면이 된다. 쓸 일이 없으니 무변경으로 끝낸다.
 */
export async function updateNickname(nickname: string): Promise<NicknameSaveState> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { error: '로그인이 필요합니다.' }

  const blocked = await requireOnboarded(userId)
  if (blocked) return { error: blocked.error }

  const limited = checkActionRateLimit(
    'nickname-save',
    userId,
    NICKNAME_SAVE_LIMIT,
    NICKNAME_SAVE_WINDOW_MS,
  )
  if (!limited.ok) return { error: retryMessage(limited.retryAfterSec) }

  const trimmed = nickname.trim()
  const formatError = validateNicknameFormat(trimmed)
  if (formatError) return { error: formatError }

  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { nickname: true },
  })
  if (!me) return { error: '회원 정보를 찾을 수 없어요. 다시 로그인해 주세요.' }
  if (me.nickname === trimmed) return { ok: true, unchanged: true }

  // 화면에서 확인했더라도 그 사이에 누가 가져갔을 수 있다. 저장 직전에 다시 본다.
  const taken = await prisma.user.findUnique({
    where: { nickname: trimmed },
    select: { id: true },
  })
  if (taken && taken.id !== userId) return { error: NICKNAME_TAKEN }

  try {
    await prisma.user.update({ where: { id: userId }, data: { nickname: trimmed } })
  } catch (error) {
    // 🔴 어느 계정인지 남기지 않는다.
    console.error('[profile] nickname save failed:', (error as Error).message)
    return { error: '저장 중 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.' }
  }

  revalidatePath('/my')
  return { ok: true }
}
