/**
 * 운영자 직접 작성 트랜잭션 — 🔴 **공개 write 가 일어나는 유일한 지점**
 *
 * 🔴 **저장과 감사 기록은 한 트랜잭션이다.**
 *      ① Post 또는 Comment   글이 생긴다
 *      ② OperatorWriteLog    누가(관리자) 누구 이름으로(작성자) 무엇을 했는가
 *    둘을 나누면 "공개는 됐는데 누가 올렸는지 모르는" 행이 생기고,
 *    그 상태에서는 takedown 도 책임 추적도 할 수 없다.
 *
 * 🔴 **판정을 트랜잭션 안에서 한다.** 밖에서 한 판정은 그 시점의 사진이다 —
 *    그 사이 작성자가 retired 되거나, 대상 글이 내려갔거나, 계정이 붙었을 수 있다.
 *    persona-publish-tx · original-post-publish-tx 가 같은 이유로 같은 모양을 한다.
 *
 * 🔴 **중복 등록은 `requestKey` 의 unique 제약이 막는다.**
 *    연속 클릭·새로고침 재전송은 같은 키로 두 번째 INSERT 를 시도하고,
 *    유니크 위반으로 **글까지 함께 롤백**된다. 애플리케이션 카운터로 막지 않는다 —
 *    두 요청이 동시에 오면 그런 카운터는 둘 다 통과시킨다.
 *
 * 🔴 **provider 를 부르지 않는다. AI 검수 큐에 넣지 않는다.**
 *    창업자가 자기 손으로 쓴 글이다. 승인 대기열은 생성물을 사람이 읽기 위한 장치이고,
 *    사람이 쓴 것을 그 줄에 세우면 자기 글을 자기가 승인하는 절차가 된다.
 *
 * 🔴 이 파일은 고객 화면에서 import 되지 않는다.
 */
import type { Prisma, PrismaClient } from '@prisma/client'

import {
  assertOperatorCommentData,
  assertOperatorPostData,
  buildOperatorCommentData,
  buildOperatorPostData,
  judgeOperatorOwnership,
  judgeOperatorWriter,
  type OperatorBoard,
} from './operator-writer'

/** 🔴 판정 쿼리가 여럿이라 기본 5초로는 부하가 있을 때 판정 도중 잘린다 */
export const TX_MAX_WAIT_MS = 10_000
export const TX_TIMEOUT_MS = 20_000

/** Prisma 가 unique 위반에 주는 코드 */
const UNIQUE_VIOLATION = 'P2002'

export function isDuplicateRequest(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false
  return (err as { code?: unknown }).code === UNIQUE_VIOLATION
}

export type ComposeResult =
  | { kind: 'created'; targetId: string; postId: string; boardType: string }
  | { kind: 'updated'; targetId: string; postId: string }
  | { kind: 'deleted'; targetId: string; postId: string }
  | { kind: 'duplicate'; message: string }
  | { kind: 'blocked'; message: string }
  | { kind: 'error'; message: string }

/**
 * 🔴 **작성자 자격을 트랜잭션 안에서 다시 읽는다.**
 *    `_count.accounts` 와 `persona` 를 함께 읽어야 `judgeOperatorWriter` 가 판정할 수 있다 —
 *    하나라도 빠지면 fail-closed 로 막힌다(그래야 조용히 통과하지 않는다).
 */
async function readWriter(
  tx: Prisma.TransactionClient,
  operatorWriterId: string,
): Promise<{ id: string; userId: string } | { blocked: string }> {
  const row = await tx.operatorWriter.findUnique({
    where: { id: operatorWriterId },
    select: {
      id: true,
      userId: true,
      status: true,
      user: {
        select: {
          providerId: true,
          persona: { select: { id: true } },
          _count: { select: { accounts: true } },
        },
      },
    },
  })
  const verdict = judgeOperatorWriter(
    row === null
      ? null
      : {
          status: row.status,
          accountCount: row.user._count.accounts,
          providerId: row.user.providerId,
          hasPersona: row.user.persona !== null,
        },
  )
  if (!verdict.ok) return { blocked: verdict.reason }
  return { id: row!.id, userId: row!.userId }
}

// ─────────────────────────────────────────────────────────
// ① 글 쓰기
// ─────────────────────────────────────────────────────────

export type CreatePostInput = {
  operatorWriterId: string
  boardType: OperatorBoard
  title: string
  content: string
  /** 🔴 서버 세션에서 온 관리자 User.id. 클라이언트 입력이 아니다 */
  actorUserId: string
  /** 🔴 중복 등록 차단 키. 화면이 작성 1회당 하나를 만든다 */
  requestKey: string
}

export async function createOperatorPostTx(
  db: PrismaClient,
  input: CreatePostInput,
): Promise<ComposeResult> {
  try {
    return await db.$transaction(async (tx): Promise<ComposeResult> => {
      const writer = await readWriter(tx, input.operatorWriterId)
      if ('blocked' in writer) return { kind: 'blocked', message: writer.blocked }

      // ── ① Post ──
      const data = buildOperatorPostData({
        boardType: input.boardType,
        title: input.title,
        content: input.content,
        authorId: writer.userId,
        operatorWriterId: writer.id,
      })
      // 🔴 create 직전. 함수가 있다는 것과 그 함수만 쓰인다는 것은 다르다
      assertOperatorPostData(data)
      const post = await tx.post.create({
        data: data as unknown as Prisma.PostUncheckedCreateInput,
        select: { id: true, boardType: true },
      })

      // ── ② 감사 기록 ── 🔴 unique 위반이면 위 Post 까지 되돌아간다
      await tx.operatorWriteLog.create({
        data: {
          operatorWriterId: writer.id,
          actorUserId: input.actorUserId,
          kind: 'post',
          action: 'create',
          targetId: post.id,
          postId: post.id,
          requestKey: input.requestKey,
        },
        select: { id: true },
      })

      return { kind: 'created', targetId: post.id, postId: post.id, boardType: post.boardType }
    }, { maxWait: TX_MAX_WAIT_MS, timeout: TX_TIMEOUT_MS })
  } catch (err) {
    return toFailure(err)
  }
}

// ─────────────────────────────────────────────────────────
// ② 댓글 쓰기
// ─────────────────────────────────────────────────────────

export type CreateCommentInput = {
  operatorWriterId: string
  postId: string
  content: string
  actorUserId: string
  requestKey: string
}

export async function createOperatorCommentTx(
  db: PrismaClient,
  input: CreateCommentInput,
): Promise<ComposeResult> {
  try {
    return await db.$transaction(async (tx): Promise<ComposeResult> => {
      const writer = await readWriter(tx, input.operatorWriterId)
      if ('blocked' in writer) return { kind: 'blocked', message: writer.blocked }

      /**
       * 🔴 **대상 글을 서버에서 다시 확인한다.** 화면이 보낸 id 를 믿지 않는다 —
       *    내려간 글·매거진·없는 글에 댓글이 달리는 것을 여기서 끊는다.
       */
      const post = await tx.post.findUnique({
        where: { id: input.postId },
        select: { id: true, status: true, boardType: true },
      })
      if (post === null || post.status !== 'PUBLISHED') {
        return { kind: 'blocked', message: '대상 글을 찾을 수 없습니다.' }
      }
      if (post.boardType === 'MAGAZINE') {
        return { kind: 'blocked', message: '매거진에는 댓글을 달지 않습니다.' }
      }

      const data = buildOperatorCommentData({
        postId: post.id,
        content: input.content,
        authorId: writer.userId,
        operatorWriterId: writer.id,
      })
      assertOperatorCommentData(data)
      const comment = await tx.comment.create({
        data: data as unknown as Prisma.CommentUncheckedCreateInput,
        select: { id: true },
      })

      await tx.operatorWriteLog.create({
        data: {
          operatorWriterId: writer.id,
          actorUserId: input.actorUserId,
          kind: 'comment',
          action: 'create',
          targetId: comment.id,
          postId: post.id,
          requestKey: input.requestKey,
        },
        select: { id: true },
      })

      return { kind: 'created', targetId: comment.id, postId: post.id, boardType: post.boardType }
    }, { maxWait: TX_MAX_WAIT_MS, timeout: TX_TIMEOUT_MS })
  } catch (err) {
    return toFailure(err)
  }
}

// ─────────────────────────────────────────────────────────
// ③ 수정 — 🔴 이 도구의 것만
// ─────────────────────────────────────────────────────────

export async function updateOperatorPostTx(
  db: PrismaClient,
  input: { postId: string; title: string; content: string; actorUserId: string },
): Promise<ComposeResult> {
  try {
    return await db.$transaction(async (tx): Promise<ComposeResult> => {
      const post = await tx.post.findUnique({
        where: { id: input.postId },
        select: { id: true, status: true, operatorWriterId: true, personaId: true },
      })
      /**
       * 🔴 **권한은 서버가 다시 판정한다.** 화면에서 수정 버튼을 감추는 것만으로는
       *    막히지 않는다 — 회원 글의 id 를 그대로 보내는 요청이 이 자리에 온다.
       */
      const own = judgeOperatorOwnership(post)
      if (!own.ok) return { kind: 'blocked', message: own.reason }
      if (post!.status === 'DELETED') return { kind: 'blocked', message: '이미 지운 글입니다.' }

      await tx.post.update({
        where: { id: post!.id },
        data: { title: input.title, content: input.content },
        select: { id: true },
      })
      await tx.operatorWriteLog.create({
        data: {
          operatorWriterId: own.operatorWriterId,
          actorUserId: input.actorUserId,
          kind: 'post',
          action: 'update',
          targetId: post!.id,
          postId: post!.id,
        },
        select: { id: true },
      })
      return { kind: 'updated', targetId: post!.id, postId: post!.id }
    }, { maxWait: TX_MAX_WAIT_MS, timeout: TX_TIMEOUT_MS })
  } catch (err) {
    return toFailure(err)
  }
}

export async function updateOperatorCommentTx(
  db: PrismaClient,
  input: { commentId: string; content: string; actorUserId: string },
): Promise<ComposeResult> {
  try {
    return await db.$transaction(async (tx): Promise<ComposeResult> => {
      const comment = await tx.comment.findUnique({
        where: { id: input.commentId },
        select: { id: true, postId: true, isDeleted: true, operatorWriterId: true, personaId: true },
      })
      const own = judgeOperatorOwnership(comment)
      if (!own.ok) return { kind: 'blocked', message: own.reason }
      if (comment!.isDeleted) return { kind: 'blocked', message: '이미 지운 댓글입니다.' }

      await tx.comment.update({
        where: { id: comment!.id },
        data: { content: input.content },
        select: { id: true },
      })
      await tx.operatorWriteLog.create({
        data: {
          operatorWriterId: own.operatorWriterId,
          actorUserId: input.actorUserId,
          kind: 'comment',
          action: 'update',
          targetId: comment!.id,
          postId: comment!.postId,
        },
        select: { id: true },
      })
      return { kind: 'updated', targetId: comment!.id, postId: comment!.postId }
    }, { maxWait: TX_MAX_WAIT_MS, timeout: TX_TIMEOUT_MS })
  } catch (err) {
    return toFailure(err)
  }
}

// ─────────────────────────────────────────────────────────
// ④ 삭제 — 🔴 hard delete 를 하지 않는다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **지우지 않고 가린다.** 어드민이 같은 계약을 쓴다(`actions/admin.ts`) —
 *    되돌릴 수 없는 조치는 운영 화면에 두지 않는다. 글은 `status='HIDDEN'`,
 *    댓글은 `isDeleted=true` 다.
 *
 * 🔴 `PostStatus.DELETED` 를 쓰지 않는다. 화면 효과는 같은데 이름이 삭제라
 *    나중에 정리 배치의 대상이 된다 — 어드민이 같은 이유로 같은 판단을 했다.
 */
export async function deleteOperatorPostTx(
  db: PrismaClient,
  input: { postId: string; actorUserId: string },
): Promise<ComposeResult> {
  try {
    return await db.$transaction(async (tx): Promise<ComposeResult> => {
      const post = await tx.post.findUnique({
        where: { id: input.postId },
        select: { id: true, status: true, operatorWriterId: true, personaId: true },
      })
      const own = judgeOperatorOwnership(post)
      if (!own.ok) return { kind: 'blocked', message: own.reason }

      await tx.post.update({
        where: { id: post!.id },
        data: { status: 'HIDDEN' },
        select: { id: true },
      })
      await tx.operatorWriteLog.create({
        data: {
          operatorWriterId: own.operatorWriterId,
          actorUserId: input.actorUserId,
          kind: 'post',
          action: 'delete',
          targetId: post!.id,
          postId: post!.id,
        },
        select: { id: true },
      })
      return { kind: 'deleted', targetId: post!.id, postId: post!.id }
    }, { maxWait: TX_MAX_WAIT_MS, timeout: TX_TIMEOUT_MS })
  } catch (err) {
    return toFailure(err)
  }
}

export async function deleteOperatorCommentTx(
  db: PrismaClient,
  input: { commentId: string; actorUserId: string },
): Promise<ComposeResult> {
  try {
    return await db.$transaction(async (tx): Promise<ComposeResult> => {
      const comment = await tx.comment.findUnique({
        where: { id: input.commentId },
        select: { id: true, postId: true, isDeleted: true, operatorWriterId: true, personaId: true },
      })
      const own = judgeOperatorOwnership(comment)
      if (!own.ok) return { kind: 'blocked', message: own.reason }

      await tx.comment.update({
        where: { id: comment!.id },
        data: { isDeleted: true },
        select: { id: true },
      })
      await tx.operatorWriteLog.create({
        data: {
          operatorWriterId: own.operatorWriterId,
          actorUserId: input.actorUserId,
          kind: 'comment',
          action: 'delete',
          targetId: comment!.id,
          postId: comment!.postId,
        },
        select: { id: true },
      })
      return { kind: 'deleted', targetId: comment!.id, postId: comment!.postId }
    }, { maxWait: TX_MAX_WAIT_MS, timeout: TX_TIMEOUT_MS })
  } catch (err) {
    return toFailure(err)
  }
}

/**
 * 🔴 예외 원문을 호출부로 흘리지 않는다. 다만 **중복은 중복이라 말한다** —
 *    "실패했습니다" 로 뭉개면 운영자가 같은 버튼을 한 번 더 누른다.
 */
function toFailure(err: unknown): ComposeResult {
  if (isDuplicateRequest(err)) {
    return { kind: 'duplicate', message: '이미 등록된 글입니다. 작성 내역에서 확인해 주세요.' }
  }
  console.error('[operator-compose]', (err as Error)?.message)
  return { kind: 'error', message: '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
}
