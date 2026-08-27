'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { getBoardBySlug } from '@/lib/board-registry'
import { checkActionRateLimit, retryMessage } from '@/lib/rate-limit'
import { checkContent } from '@/lib/content-guard'
import {
  MIN_POST_TITLE_LENGTH,
  MAX_POST_TITLE_LENGTH,
  MIN_POST_CONTENT_LENGTH,
  MAX_POST_CONTENT_LENGTH,
  POST_TITLE_TOO_SHORT,
  POST_TITLE_TOO_LONG,
  POST_CONTENT_TOO_SHORT,
  POST_CONTENT_TOO_LONG,
} from '@/lib/post-policy'
import type { BoardType } from '@prisma/client'

/** 글쓰기: 사용자당 10분에 3건 */
const POST_LIMIT = 3
const POST_WINDOW_MS = 10 * 60 * 1000

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
  if (title.length < MIN_POST_TITLE_LENGTH) {
    return { error: POST_TITLE_TOO_SHORT }
  }
  if (title.length > MAX_POST_TITLE_LENGTH) {
    return { error: POST_TITLE_TOO_LONG }
  }
  if (content.length < MIN_POST_CONTENT_LENGTH) {
    return { error: POST_CONTENT_TOO_SHORT }
  }
  if (content.length > MAX_POST_CONTENT_LENGTH) {
    return { error: POST_CONTENT_TOO_LONG }
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

/** 글 수정: 사용자당 10분에 10건 */
const POST_EDIT_LIMIT = 10
const POST_EDIT_WINDOW_MS = 10 * 60 * 1000

/**
 * 글 수정
 *
 * 🔴 본인 확인을 서버에서 다시 한다.
 *    UI 에서 버튼을 감추는 것은 안내이지 방어가 아니다.
 *    이 액션은 주소만 알면 누구나 부를 수 있다.
 *
 * 🔴 게시판은 바꾸지 않는다. 제목과 내용만 고친다.
 *    글이 게시판을 옮기면 목록·이미 달린 댓글의 맥락이 함께 흔들린다.
 *    옮기는 것은 수정이 아니라 다른 동작이다.
 *
 * 🔴 길이 정책과 checkContent 는 새로 쓸 때와 같은 것을 쓴다.
 *    수정 경로만 느슨하면 그쪽으로 우회한다.
 */
export async function updatePost(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { error: '로그인이 필요합니다.' }

  const postId = String(formData.get('postId') ?? '')
  const boardSlug = String(formData.get('boardSlug') ?? '')
  const title = String(formData.get('title') ?? '').trim()
  const content = String(formData.get('content') ?? '').trim()

  const board = getBoardBySlug(boardSlug)
  if (!board || !board.isCommunity) {
    return { error: '글을 쓸 수 없는 게시판입니다.' }
  }
  if (title.length < MIN_POST_TITLE_LENGTH) {
    return { error: POST_TITLE_TOO_SHORT }
  }
  if (title.length > MAX_POST_TITLE_LENGTH) {
    return { error: POST_TITLE_TOO_LONG }
  }
  if (content.length < MIN_POST_CONTENT_LENGTH) {
    return { error: POST_CONTENT_TOO_SHORT }
  }
  if (content.length > MAX_POST_CONTENT_LENGTH) {
    return { error: POST_CONTENT_TOO_LONG }
  }

  const titleGuard = checkContent(title, { isTitle: true })
  if (!titleGuard.ok) return { error: titleGuard.reason }
  const contentGuard = checkContent(content)
  if (!contentGuard.ok) return { error: contentGuard.reason }

  const limited = checkActionRateLimit('post-edit', userId, POST_EDIT_LIMIT, POST_EDIT_WINDOW_MS)
  if (!limited.ok) return { error: retryMessage(limited.retryAfterSec) }

  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, authorId: true, status: true, boardType: true },
  })
  // 🔴 없는 글·지운 글·주소의 게시판과 다른 글은 같은 문장으로 막는다.
  //    무엇이 존재하는지 하나씩 알려주는 통로가 되면 안 된다.
  if (!post || post.status !== 'PUBLISHED') return { error: '글을 찾을 수 없습니다.' }
  if (post.boardType !== board.type) return { error: '글을 찾을 수 없습니다.' }
  if (post.authorId !== userId) return { error: '본인이 쓴 글만 고칠 수 있습니다.' }

  await prisma.post.update({
    where: { id: postId },
    data: { title, content },
  })

  revalidatePath(board.href)
  revalidatePath(`${board.href}/${postId}`)
  redirect(`${board.href}/${postId}`)
}
