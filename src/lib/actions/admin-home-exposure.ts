'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin'
import { DISCOVERY_ELIGIBLE_WHERE } from '@/lib/post-visibility'
import { resolveExpiresAt, type ExpiryChoice } from '@/lib/home-exposure-rules'

/**
 * 홈 노출 예외 write — 🔴 이 파일이 유일한 지점이다.
 *
 * 🔴 Post 를 고치지 않는다. status·title·content 어느 것도 건드리지 않는다.
 *    "홈에서 안 보인다" 와 "글이 숨겨졌다" 는 다른 일이고, 섞으면 되돌릴 수 없다.
 *    Comment · Report · User 도 이 파일의 대상이 아니다.
 *
 * 🔴 만료된 행을 지우지 않는다. isActive=false 로 끄고 이력으로 남긴다.
 *    무엇을 언제 왜 올렸는지가 남아야 나중에 설명할 수 있다.
 *
 * 🔴 대상은 홈 인기글 하나(HOME_POPULAR), 커뮤니티 글(MENOPAUSE·FREE)뿐이다.
 *    매거진은 파일 기반이라 Post 가 아니고, /best 는 이번 범위가 아니다.
 *
 * 🔴 PIN 대상은 discovery 조건을 통과한 글만이다.
 *    Micro Seed · indexPromotionBlocked · HIDDEN 글이 PIN 으로 새어 나가면
 *    3축 판정을 어드민이 우회하는 구멍이 된다.
 */

const SURFACE = 'HOME_POPULAR' as const

/** 홈 인기글이 다루는 게시판. 매거진은 대상이 아니다. */
const TARGET_BOARDS = ['MENOPAUSE', 'FREE'] as const

export type HomeExposureState = { error?: string; ok?: true }

const DENIED: HomeExposureState = { error: '권한이 없습니다.' }

function revalidateHome(): void {
  revalidatePath('/')
  revalidatePath('/admin/home')
}

/** 지금 살아 있는 PIN 중 가장 큰 position + 1. 비어 있으면 0 */
async function nextPinPosition(): Promise<number> {
  const last = await prisma.homeExposureOverride.findFirst({
    where: { surface: SURFACE, action: 'PIN', isActive: true },
    orderBy: { position: 'desc' },
    select: { position: true },
  })
  return (last?.position ?? -1) + 1
}

/**
 * 예외를 건다.
 *
 * 🔴 같은 글에 같은 자리의 활성 예외가 이미 있으면 그것을 끄고 새로 만든다.
 *    행을 고치지 않고 갈아 끼우는 이유는 이력이다 — 언제 무엇으로 바뀌었는지가 남는다.
 */
export async function createHomeOverride(
  _prev: HomeExposureState,
  formData: FormData,
): Promise<HomeExposureState> {
  const { ok } = await requireAdmin()
  if (!ok) return DENIED

  const postId = String(formData.get('postId') ?? '')
  const action = String(formData.get('action') ?? '')
  const expiry = String(formData.get('expiry') ?? 'MANUAL') as ExpiryChoice

  if (!postId) return { error: '글을 찾지 못했습니다.' }
  if (action !== 'PIN' && action !== 'HIDE') return { error: '알 수 없는 동작입니다.' }
  if (expiry !== 'FOUR_HOURS' && expiry !== 'TODAY_KST' && expiry !== 'MANUAL') {
    return { error: '만료 선택이 올바르지 않습니다.' }
  }

  // 🔴 PIN·HIDE 모두 같은 조건을 본다.
  //    HIDE 는 애초에 홈에 나올 수 있는 글에만 의미가 있다.
  const post = await prisma.post.findFirst({
    where: {
      id: postId,
      boardType: { in: [...TARGET_BOARDS] },
      ...DISCOVERY_ELIGIBLE_WHERE,
    },
    select: { id: true },
  })
  if (!post) {
    return { error: '홈에 오를 수 있는 글이 아닙니다. 공개된 갱년기톡·자유게시판 글만 됩니다.' }
  }

  const session = await auth()
  const actorId = session?.user?.id ?? null

  const expiresAt = resolveExpiresAt(expiry)
  const position = action === 'PIN' ? await nextPinPosition() : null

  await prisma.$transaction([
    // 같은 자리의 기존 활성 예외를 끈다 (지우지 않는다)
    prisma.homeExposureOverride.updateMany({
      where: { surface: SURFACE, postId, action, isActive: true },
      data: { isActive: false },
    }),
    prisma.homeExposureOverride.create({
      data: {
        surface: SURFACE,
        postId,
        action,
        position,
        expiresAt,
        createdByUserId: actorId,
      },
    }),
  ])

  revalidateHome()
  return { ok: true }
}

/** 예외 해제 — 행을 지우지 않고 끈다 */
export async function deactivateHomeOverride(overrideId: string): Promise<HomeExposureState> {
  const { ok } = await requireAdmin()
  if (!ok) return DENIED
  if (!overrideId) return { error: '예외를 찾지 못했습니다.' }

  const row = await prisma.homeExposureOverride.findUnique({
    where: { id: overrideId },
    select: { id: true },
  })
  if (!row) return { error: '예외를 찾지 못했습니다.' }

  await prisma.homeExposureOverride.update({
    where: { id: overrideId },
    data: { isActive: false },
  })

  revalidateHome()
  return { ok: true }
}

/**
 * PIN 순서를 한 칸 옮긴다.
 *
 * 🔴 두 행의 position 을 맞바꾼다. 전체를 다시 번호 매기지 않는다 —
 *    다시 매기는 동안 다른 사람이 끼어들면 순서가 통째로 흔들린다.
 */
export async function moveHomePin(
  overrideId: string,
  direction: 'up' | 'down',
): Promise<HomeExposureState> {
  const { ok } = await requireAdmin()
  if (!ok) return DENIED
  if (!overrideId) return { error: '예외를 찾지 못했습니다.' }

  const current = await prisma.homeExposureOverride.findUnique({
    where: { id: overrideId },
    select: { id: true, position: true, action: true, isActive: true },
  })
  if (!current || current.action !== 'PIN' || !current.isActive) {
    return { error: '옮길 수 있는 고정이 아닙니다.' }
  }

  const pos = current.position ?? 0
  const neighbour = await prisma.homeExposureOverride.findFirst({
    where: {
      surface: SURFACE,
      action: 'PIN',
      isActive: true,
      position: direction === 'up' ? { lt: pos } : { gt: pos },
    },
    orderBy: { position: direction === 'up' ? 'desc' : 'asc' },
    select: { id: true, position: true },
  })
  if (!neighbour) return { error: '더 옮길 곳이 없습니다.' }

  await prisma.$transaction([
    prisma.homeExposureOverride.update({
      where: { id: current.id },
      data: { position: neighbour.position },
    }),
    prisma.homeExposureOverride.update({
      where: { id: neighbour.id },
      data: { position: pos },
    }),
  ])

  revalidateHome()
  return { ok: true }
}
