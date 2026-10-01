'use server'

import bcrypt from 'bcryptjs'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getBoardBySlug } from '@/lib/board-registry'
import { checkRateLimit, getClientIp, retryMessage } from '@/lib/rate-limit'
import { checkContent } from '@/lib/content-guard'
import { verifyTurnstile } from '@/lib/turnstile'
import { writeComment } from '@/lib/comment-write'
import { toPublishState, type CommentPublishState } from '@/lib/comment-publish'
import { checkGuestCredential, type VerifiedGuestComment } from '@/lib/guest-credential'
import {
  MIN_COMMENT_LENGTH,
  MAX_COMMENT_LENGTH,
  COMMENT_TOO_SHORT,
  COMMENT_TOO_LONG,
} from '@/lib/comment-policy'
import { POST_NOT_FOUND } from '@/lib/post-policy'
import { syncBestEligibility } from '@/lib/best-ranking-db'
import {
  GUEST_NICKNAME_MIN,
  GUEST_NICKNAME_MAX,
  GUEST_PASSWORD_PATTERN,
  GUEST_NICKNAME_INVALID,
  GUEST_PASSWORD_INVALID,
  GUEST_NICKNAME_TAKEN,
} from '@/lib/guest-comment-policy'

/**
 * 비회원 댓글 — 로그인하지 않은 사람이 닉네임과 비밀번호로 쓰고 고치고 지운다.
 *
 * 🔴 회원 경로(actions/comments.ts)와 섞지 않는다.
 *    회원은 세션으로, 비회원은 비밀번호로 신원을 증명한다. 한 함수에 두면
 *    한쪽 분기를 고치다 다른 쪽 권한이 열린다.
 *
 * 🔴 authorId 는 null, commentOrigin 은 GUEST 다.
 *    source 는 USER 를 유지한다 — AuthorSource 는 "사람이 썼나 시스템이 썼나" 축이고
 *    비회원도 사람이다. SYSTEM 으로 두면 Micro Seed·페르소나와 같은 칸에 들어간다.
 *
 * 🔴 삭제는 isDeleted=true 다. 지우지 않는다 —
 *    신고 근거가 함께 사라지면 왜 조치했는지 설명할 수 없다.
 *
 * 🔴 Post 에는 commentCount·lastEngagedAt 이 없다. 댓글 수는 _count 로 센다.
 *    그래서 회원 경로와 마찬가지로 Post 를 건드리지 않는다.
 */

/** 회원 경로와 같은 결과 모양이다(comment-publish.ts) — 고치기·지우기는 error/ok 만 쓴다 */
export type GuestCommentState = CommentPublishState

/** 비회원 댓글: IP 당 5분에 5건. 회원(10건)보다 좁게 둔다. */
const GUEST_COMMENT_LIMIT = 5
const GUEST_COMMENT_WINDOW_MS = 5 * 60 * 1000

/** 비밀번호 확인: IP 당 5분에 20회. 대입 시도를 늦춘다. */
const GUEST_VERIFY_LIMIT = 20
const GUEST_VERIFY_WINDOW_MS = 5 * 60 * 1000

function revalidateBoardPost(boardSlug: string, postId: string): void {
  const board = getBoardBySlug(boardSlug)
  if (board) revalidatePath(`${board.href}/${postId}`)
}

/** 본문 공통 검증 — 회원 댓글과 같은 기준을 쓴다. */
function checkBody(content: string): string | null {
  if (content.length < MIN_COMMENT_LENGTH) return COMMENT_TOO_SHORT
  if (content.length > MAX_COMMENT_LENGTH) return COMMENT_TOO_LONG
  const guard = checkContent(content, { audience: 'user' })
  if (!guard.ok) return guard.reason
  return null
}

export async function createGuestComment(
  _prev: GuestCommentState,
  formData: FormData,
): Promise<GuestCommentState> {
  const postId = String(formData.get('postId') ?? '')
  const boardSlug = String(formData.get('boardSlug') ?? '')
  const content = String(formData.get('content') ?? '').trim()
  const nickname = String(formData.get('guestNickname') ?? '').trim()
  const password = String(formData.get('guestPassword') ?? '')
  const token = String(formData.get('turnstileToken') ?? '')

  const bodyError = checkBody(content)
  if (bodyError) return { error: bodyError }

  if (nickname.length < GUEST_NICKNAME_MIN || nickname.length > GUEST_NICKNAME_MAX) {
    return { error: GUEST_NICKNAME_INVALID }
  }
  const nicknameGuard = checkContent(nickname, { audience: 'nickname' })
  if (!nicknameGuard.ok) return { error: nicknameGuard.reason }

  if (!GUEST_PASSWORD_PATTERN.test(password)) return { error: GUEST_PASSWORD_INVALID }

  // 🔴 봇 검증을 write 전에 한다. 여기서 통과해야 아래 어떤 write 도 일어나지 않는다.
  const human = await verifyTurnstile(token)
  if (!human.ok) return { error: human.reason ?? '잠시 후 다시 시도해 주세요.' }

  // 🔴 비회원은 사용자 id 가 없다. IP 로만 센다.
  const ip = getClientIp()
  if (ip !== 'unknown') {
    const limited = checkRateLimit(
      `guest-comment:ip:${ip}`,
      GUEST_COMMENT_LIMIT,
      GUEST_COMMENT_WINDOW_MS,
    )
    if (!limited.ok) return { error: retryMessage(limited.retryAfterSec) }
  }

  /**
   * 🔴 회원 이름과 겹치면 막는다.
   *    회원이 쓰던 이름을 비회원이 쓰면 같은 화면에서 다른 사람이 같은 이름으로 보인다.
   *    nickname 과 name 둘 다 본다 — 화면에 나가는 이름은 displayName 이 둘 중 하나를 고른다.
   */
  const taken = await prisma.user.findFirst({
    where: { OR: [{ nickname }, { name: nickname }] },
    select: { id: true },
  })
  if (taken) return { error: GUEST_NICKNAME_TAKEN }

  // 🔴 해시 전에 한 번 거른다 — 없는 글에 bcrypt 비용을 쓰지 않는다. 최종 확인은 저장 트랜잭션이 다시 한다.
  const post = await prisma.post.findFirst({
    where: { id: postId, status: 'PUBLISHED' },
    select: { id: true },
  })
  if (!post) return { error: POST_NOT_FOUND }

  const guestPasswordHash = await bcrypt.hash(password, 10)

  // 글 상태 · 답글 대상 · 중복 · 저장을 한 트랜잭션에서 — 회원 경로와 같은 함수다.
  // 봇 검증·IP 제한·비밀번호 해시는 모두 이 앞에서 끝났다.
  const saved = await writeComment(prisma, {
    postId,
    rawParentId: String(formData.get('parentId') ?? ''),
    content,
    author: { kind: 'guest', nickname, password, passwordHash: guestPasswordHash },
  })
  if (!saved.ok) return toPublishState(saved)

  revalidateBoardPost(boardSlug, postId)
  // 중복이면 duplicate 가 함께 간다 — 화면은 그 댓글로 이동하되 새 등록으로 세지 않는다
  return toPublishState(saved)
}

/**
 * 비밀번호 확인 — 맞으면 댓글을 돌려준다.
 *
 * 🔴 IP 속도 제한만 여기서 한다(요청 헤더가 필요하다). 회원 댓글 거절 · 실패 횟수 · 1분 잠금 ·
 *    번호 대조는 guest-credential.ts 의 checkGuestCredential 이 한다.
 */
async function verifyGuestPassword(
  commentId: string,
  password: string,
): Promise<{ ok: true; comment: VerifiedGuestComment } | { ok: false; error: string }> {
  const ip = getClientIp()
  if (ip !== 'unknown') {
    const limited = checkRateLimit(
      `guest-verify:ip:${ip}`,
      GUEST_VERIFY_LIMIT,
      GUEST_VERIFY_WINDOW_MS,
    )
    if (!limited.ok) return { ok: false, error: retryMessage(limited.retryAfterSec) }
  }
  // 번호 대조 · 실패 횟수 · 잠금은 guest-credential.ts 가 한다(격리 DB 검사가 같은 함수를 부른다)
  return checkGuestCredential(prisma, commentId, password)
}

export async function updateGuestComment(
  _prev: GuestCommentState,
  formData: FormData,
): Promise<GuestCommentState> {
  const commentId = String(formData.get('commentId') ?? '')
  const boardSlug = String(formData.get('boardSlug') ?? '')
  const content = String(formData.get('content') ?? '').trim()
  const password = String(formData.get('guestPassword') ?? '')

  const bodyError = checkBody(content)
  if (bodyError) return { error: bodyError }
  if (!GUEST_PASSWORD_PATTERN.test(password)) return { error: GUEST_PASSWORD_INVALID }

  const verified = await verifyGuestPassword(commentId, password)
  if (!verified.ok) return { error: verified.error }

  // 🔴 content 만 바꾼다. 닉네임·비밀번호·isDeleted 는 이 경로가 건드리지 않는다.
  await prisma.comment.update({ where: { id: commentId }, data: { content } })

  revalidateBoardPost(boardSlug, verified.comment.postId)
  return { ok: true }
}

export async function deleteGuestComment(
  _prev: GuestCommentState,
  formData: FormData,
): Promise<GuestCommentState> {
  const commentId = String(formData.get('commentId') ?? '')
  const boardSlug = String(formData.get('boardSlug') ?? '')
  const password = String(formData.get('guestPassword') ?? '')

  if (!GUEST_PASSWORD_PATTERN.test(password)) return { error: GUEST_PASSWORD_INVALID }

  const verified = await verifyGuestPassword(commentId, password)
  if (!verified.ok) return { error: verified.error }

  // 🔴 지우지 않는다. 소란소란의 댓글 삭제는 언제나 isDeleted=true 다.
  //    /best W 는 같은 트랜잭션에서 다시 센다. 이미 남은 입성 기록은 지우지 않는다.
  await prisma.$transaction(async (tx) => {
    await tx.comment.update({ where: { id: commentId }, data: { isDeleted: true }, select: { id: true } })
    await syncBestEligibility(tx, verified.comment.postId)
  })

  revalidateBoardPost(boardSlug, verified.comment.postId)
  return { ok: true }
}
