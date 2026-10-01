import 'server-only'
import bcrypt from 'bcryptjs'
import type { PrismaClient } from '@prisma/client'
import {
  GUEST_LOCK_MS,
  GUEST_LOCKED,
  GUEST_NOT_FOUND,
  GUEST_ONLY,
  GUEST_PASSWORD_MAX_ATTEMPTS,
  GUEST_PASSWORD_WRONG,
} from '@/lib/guest-comment-policy'

/**
 * 비회원 댓글의 번호 확인 — 맞으면 댓글을 돌려준다. 고치기 · 지우기가 이 확인을 통과해야 한다.
 *
 * actions/guest-comments.ts 의 verifyGuestPassword 에서 **DB · bcrypt 부분만** 옮겼다(동작 그대로).
 * IP 속도 제한은 요청 헤더가 필요해 action 에 남는다. 이렇게 나눠 두면 격리 DB 검사가
 * 실제 확인 경로를 그대로 부를 수 있다.
 *
 * 🔴 회원 댓글에는 쓰지 않는다. authorId 가 있으면 거절한다 —
 *    비밀번호가 비어 있는 회원 댓글을 이 경로로 건드릴 수 없게 한다.
 * 🔴 실패 횟수는 댓글 행에 쌓는다. 3회면 1분 잠근다.
 *    잠금 중에는 bcrypt.compare 자체를 하지 않는다 — 연산 비용도 공격 표면이다.
 * 🔴 원문 번호는 비교에만 쓴다. 저장 · 로그 · 오류에 넣지 않는다.
 */
export type VerifiedGuestComment = { postId: string; boardType: string }

export async function checkGuestCredential(
  db: Pick<PrismaClient, 'comment'>,
  commentId: string,
  password: string,
): Promise<{ ok: true; comment: VerifiedGuestComment } | { ok: false; error: string }> {
  const comment = await db.comment.findUnique({
    where: { id: commentId },
    select: {
      id: true,
      authorId: true,
      isDeleted: true,
      postId: true,
      guestPasswordHash: true,
      guestPasswordAttempts: true,
      guestLockedUntil: true,
      post: { select: { status: true, boardType: true } },
    },
  })

  if (!comment || comment.isDeleted) return { ok: false, error: GUEST_NOT_FOUND }
  if (comment.authorId) return { ok: false, error: GUEST_ONLY }
  if (!comment.guestPasswordHash) return { ok: false, error: GUEST_ONLY }
  // 글이 내려간 뒤에는 댓글도 손대지 않는다. 읽을 수 없는 자리에 글자만 바뀐다.
  if (comment.post.status !== 'PUBLISHED') return { ok: false, error: GUEST_NOT_FOUND }

  if (comment.guestLockedUntil && comment.guestLockedUntil > new Date()) {
    return { ok: false, error: GUEST_LOCKED }
  }

  const matched = await bcrypt.compare(password, comment.guestPasswordHash)

  if (!matched) {
    const attempts = comment.guestPasswordAttempts + 1
    const locked = attempts >= GUEST_PASSWORD_MAX_ATTEMPTS
    await db.comment.update({
      where: { id: commentId },
      data: {
        guestPasswordAttempts: locked ? 0 : attempts,
        guestLockedUntil: locked ? new Date(Date.now() + GUEST_LOCK_MS) : null,
      },
    })
    return { ok: false, error: locked ? GUEST_LOCKED : GUEST_PASSWORD_WRONG }
  }

  if (comment.guestPasswordAttempts > 0 || comment.guestLockedUntil) {
    await db.comment.update({
      where: { id: commentId },
      data: { guestPasswordAttempts: 0, guestLockedUntil: null },
    })
  }

  return { ok: true, comment: { postId: comment.postId, boardType: comment.post.boardType } }
}
