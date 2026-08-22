'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { getBoardBySlug } from '@/lib/board-registry'
import { checkActionRateLimit, retryMessage } from '@/lib/rate-limit'
import { checkContent } from '@/lib/content-guard'
import type { BoardType } from '@prisma/client'

/** 글쓰기: 사용자당 10분에 3건 */
const POST_LIMIT = 3
const POST_WINDOW_MS = 10 * 60 * 1000

/** 글쓰기 최소 길이 — 우나어의 "300자 미만 71%" 를 반복하지 않기 위한 하한 */
const MIN_TITLE_LENGTH = 2
const MIN_CONTENT_LENGTH = 10

export type ActionState = { error?: string }

/**
 * 글 생성
 *
 * 🔴 로그인 회원만 쓸 수 있다. 게스트 쓰기는 열지 않는다.
 * 🔴 source 는 항상 USER 다. 봇 발행 경로를 만들지 않는다.
 */
export async function createPost(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { error: '로그인이 필요합니다.' }

  const boardSlug = String(formData.get('boardSlug') ?? '')
  const title = String(formData.get('title') ?? '').trim()
  const content = String(formData.get('content') ?? '').trim()

  const board = getBoardBySlug(boardSlug)
  if (!board || !board.isCommunity) {
    return { error: '글을 쓸 수 없는 게시판입니다.' }
  }
  if (title.length < MIN_TITLE_LENGTH) {
    return { error: '제목을 조금만 더 적어주세요.' }
  }
  if (content.length < MIN_CONTENT_LENGTH) {
    return { error: '내용을 조금만 더 적어주세요.' }
  }

  const titleGuard = checkContent(title, { isTitle: true })
  if (!titleGuard.ok) return { error: titleGuard.reason }
  const contentGuard = checkContent(content)
  if (!contentGuard.ok) return { error: contentGuard.reason }

  const limited = checkActionRateLimit('post', userId, POST_LIMIT, POST_WINDOW_MS)
  if (!limited.ok) return { error: retryMessage(limited.retryAfterSec) }

  // User row 존재 확인 — Adapter 가 만들었어야 한다
  const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (!exists) return { error: '회원 정보를 찾을 수 없습니다. 다시 로그인해 주세요.' }

  const post = await prisma.post.create({
    data: {
      boardType: board.type as BoardType,
      title,
      content,
      authorId: userId,
      source: 'USER',
    },
    select: { id: true },
  })

  revalidatePath(board.href)
  redirect(`${board.href}/${post.id}`)
}
