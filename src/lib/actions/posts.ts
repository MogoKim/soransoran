'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { getBoardBySlug, type CommunityBoardSlug } from '@/lib/board-registry'
import { checkActionRateLimit, retryMessage } from '@/lib/rate-limit'
import { checkContent } from '@/lib/content-guard'
import { requireOnboarded } from '@/lib/onboarding-guard'
import {
  MIN_POST_TITLE_LENGTH,
  MAX_POST_TITLE_LENGTH,
  MIN_POST_CONTENT_LENGTH,
  MAX_POST_CONTENT_LENGTH,
  POST_TITLE_TOO_SHORT,
  POST_TITLE_TOO_LONG,
  POST_CONTENT_TOO_SHORT,
  POST_CONTENT_TOO_LONG,
  POST_NOT_FOUND,
} from '@/lib/post-policy'
import { sanitizePostHtml, isHtmlContent, postContentToText } from '@/lib/post-html'
import { firstImageUrl } from '@/lib/post-media'
import type { BoardType } from '@prisma/client'

/**
 * 에디터가 낸 본문을 저장 가능한 형태로 만든다.
 *
 * 🔴 저장 시점에 sanitize 한다. 화면에서 한 번 더 거르지만(PostBody),
 *    이 액션은 주소만 알면 누구나 부를 수 있어 에디터를 거치지 않은 HTML 이
 *    들어올 수 있다. DB 에 깨끗한 것만 넣어야 thumbnailUrl 추출도 믿을 수 있다.
 *
 * 🔴 길이·금칙어는 태그를 뺀 글자로 잰다.
 *    사진 주소 한 줄이 100 자를 넘어 HTML 그대로 재면 사진 몇 장에 5000 자가 차고,
 *    content-guard 의 URL 개수 판정(3개)은 사진 세 장에서 "링크가 너무 많습니다" 가 된다.
 *    상한도 판정도 사람이 쓴 글자를 뜻하는 것이었다.
 *
 * 🔴 평문으로 온 것은 평문으로 둔다. 옛 글과 같은 형식이라 렌더가 알아서 가른다.
 */
function preparePostContent(raw: string): { content: string; text: string } {
  const content = isHtmlContent(raw) ? sanitizePostHtml(raw) : raw
  return { content, text: postContentToText(content) }
}

/** 글쓰기: 사용자당 10분에 3건 */
const POST_LIMIT = 3
const POST_WINDOW_MS = 10 * 60 * 1000

/**
 * 🔴 needsOnboarding 은 optional 이다.
 *    지금 화면들은 error 만 읽는다. 필수로 두면 기존 반환 경로가 전부 깨진다.
 *    O3-B 에서 화면이 이 값으로 온보딩 안내를 띄울지 정한다.
 *
 * 🔴 ok·destination·boardSlug 는 createPost 만 채운다.
 *    updatePost 는 지금도 redirect 로 끝나고, 그 화면(PostEditForm)은 error 만 읽는다 —
 *    선택 필드라 기존 경로는 그대로다.
 */
export type ActionState = {
  error?: string
  needsOnboarding?: true
  ok?: true
  /** 저장된 글로 갈 곳. 화면 이동에만 쓴다 — 글 id 가 들어 있어 계측에 싣지 않는다 */
  destination?: string
  /** 계측 정본. 화면이 들고 있던 값이 아니라 서버가 실제로 저장한 게시판이다 */
  boardSlug?: CommunityBoardSlug
}

/**
 * 글 생성
 *
 * 🔴 로그인 회원만 쓸 수 있다. 게스트 쓰기는 열지 않는다.
 * 🔴 source 는 항상 USER 다. 봇 발행 경로를 만들지 않는다.
 *
 * 🔴 redirect 로 끝내지 않고 목적지를 돌려준다.
 *    redirect() 는 NEXT_REDIRECT 를 던지므로 useFormState 의 state 에 성공이 **도달하지 않는다**.
 *    그러면 화면은 "글이 실제로 저장됐다" 를 알 수 없고, 저장 전에 미리 이벤트를 보내면
 *    금칙어·글자수·rate limit 으로 거절된 글까지 발행으로 세게 된다.
 *    이동은 화면이 router.replace 로 잇는다 — 그 편이 한 tick 늦지만, 무엇이 저장됐는지
 *    아는 자리에서 한 번만 세는 편이 정확하다.
 *
 * 🔴 목적지는 서버가 조립한다. board.href 는 레지스트리 상수이고 post.id 는 DB 가 만든 값이라
 *    사용자 입력이 닿을 자리가 없다 — open redirect 가 성립하지 않는다.
 */
export async function createPost(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { error: '로그인이 필요합니다.' }

  // 🔴 저장 전에 막는다. 여기서 통과해야 아래 어떤 write 도 일어나지 않는다.
  const blocked = await requireOnboarded(userId)
  if (blocked) return blocked

  const boardSlug = String(formData.get('boardSlug') ?? '')
  const title = String(formData.get('title') ?? '').trim()
  const { content, text } = preparePostContent(String(formData.get('content') ?? '').trim())

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
  // 🔴 사진만 올린 글을 막지 않는다. 글자가 짧아도 사진이 있으면 할 말을 한 것이다.
  const hasImage = firstImageUrl(content) !== null
  if (!hasImage && text.length < MIN_POST_CONTENT_LENGTH) {
    return { error: POST_CONTENT_TOO_SHORT }
  }
  if (text.length > MAX_POST_CONTENT_LENGTH) {
    return { error: POST_CONTENT_TOO_LONG }
  }

  const titleGuard = checkContent(title, { isTitle: true })
  if (!titleGuard.ok) return { error: titleGuard.reason }
  const contentGuard = checkContent(text)
  if (!contentGuard.ok) return { error: contentGuard.reason }

  const limited = checkActionRateLimit('post', userId, POST_LIMIT, POST_WINDOW_MS)
  if (!limited.ok) return { error: retryMessage(limited.retryAfterSec) }

  const post = await prisma.post.create({
    data: {
      boardType: board.type as BoardType,
      title,
      content,
      thumbnailUrl: firstImageUrl(content),
      authorId: userId,
      source: 'USER',
    },
    select: { id: true },
  })

  revalidatePath(board.href)
  /**
   * 🔴 board 는 레지스트리에서 찾은 값이고, 위에서 `!board.isCommunity` 를 이미 걸렀다.
   *    그러니 slug 는 커뮤니티 게시판 상수다 — getBoardBySlug 의 반환 타입이
   *    BoardMeta(slug: string)라 넓어져 있을 뿐, formData 의 문자열이 이 자리에 올 수 없다.
   */
  return {
    ok: true,
    destination: `${board.href}/${post.id}`,
    boardSlug: board.slug as CommunityBoardSlug,
  }
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

  // 🔴 저장 전에 막는다. 여기서 통과해야 아래 어떤 write 도 일어나지 않는다.
  const blocked = await requireOnboarded(userId)
  if (blocked) return blocked

  const postId = String(formData.get('postId') ?? '')
  const boardSlug = String(formData.get('boardSlug') ?? '')
  const title = String(formData.get('title') ?? '').trim()
  const { content, text } = preparePostContent(String(formData.get('content') ?? '').trim())

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
  const hasImage = firstImageUrl(content) !== null
  if (!hasImage && text.length < MIN_POST_CONTENT_LENGTH) {
    return { error: POST_CONTENT_TOO_SHORT }
  }
  if (text.length > MAX_POST_CONTENT_LENGTH) {
    return { error: POST_CONTENT_TOO_LONG }
  }

  const titleGuard = checkContent(title, { isTitle: true })
  if (!titleGuard.ok) return { error: titleGuard.reason }
  const contentGuard = checkContent(text)
  if (!contentGuard.ok) return { error: contentGuard.reason }

  const limited = checkActionRateLimit('post-edit', userId, POST_EDIT_LIMIT, POST_EDIT_WINDOW_MS)
  if (!limited.ok) return { error: retryMessage(limited.retryAfterSec) }

  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, authorId: true, status: true, boardType: true },
  })
  // 🔴 없는 글·지운 글·주소의 게시판과 다른 글은 같은 문장으로 막는다.
  //    무엇이 존재하는지 하나씩 알려주는 통로가 되면 안 된다.
  if (!post || post.status !== 'PUBLISHED') return { error: POST_NOT_FOUND }
  if (post.boardType !== board.type) return { error: POST_NOT_FOUND }
  if (post.authorId !== userId) return { error: '본인이 쓴 글만 고칠 수 있습니다.' }

  /**
   * 🔴 본문에서 빠진 사진을 R2 에서 지우지 않는다.
   *    무엇이 빠졌는지는 lib/post-media.ts 의 removedImageKeys 로 셀 수 있지만,
   *    "이 글에서 빠졌다" 와 "아무 데서도 안 쓴다" 는 다른 말이다 —
   *    같은 주소가 다른 글에 복사돼 있으면 살아 있는 글의 사진이 깨진다.
   *    판단과 보류 사유: docs/decisions/post-media-orphan-files.md
   */
  await prisma.post.update({
    where: { id: postId },
    data: { title, content, thumbnailUrl: firstImageUrl(content) },
  })

  revalidatePath(board.href)
  revalidatePath(`${board.href}/${postId}`)
  redirect(`${board.href}/${postId}`)
}
