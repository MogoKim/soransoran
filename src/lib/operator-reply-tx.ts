/**
 * 운영자 직접 작성 — 🔴 **원글 작성자 이름의 대댓글** 트랜잭션 (2026-10-21)
 *
 * 🔴 **작성자를 원글에서 고정한다.** 입력에 작성자가 없다(postId · parentId · content · actorUserId · requestKey).
 *    `operatorWriterId` · `authorId` 는 이 트랜잭션이 원글 행에서 읽어 넣는다 — 화면이 무엇을 보내든 쓰지 않는다.
 *    최상위 댓글(`operator-compose-tx.createOperatorCommentTx`)은 작성자를 고르는 계약 그대로이고,
 *    이 파일은 그 함수도 그 assert 도 건드리지 않는다.
 *
 * 🔴 **저장과 감사 기록은 한 트랜잭션이다** — Comment 와 OperatorWriteLog 가 함께 남거나 함께 사라진다.
 *    중복 등록은 OperatorWriteLog.requestKey 의 unique 제약이 막는다(같은 키 두 번째는 댓글까지 롤백).
 *
 * 🔴 **부모 댓글은 회원 답글 경로와 같은 계약이다**(`reply-target.ts`) — 있다 · 같은 글이다 · 지워지지 않았다.
 *    저장 직전에 부모 행을 잠근다(`holdReplyTarget`). 차단 관계는 이번 계약에 넣지 않는다(viewerId=null).
 *    Serializable 이고, 직렬화 충돌(P2034)은 **정해진 횟수만** 다시 시도한다 — 회원 댓글(comment-write.ts)과 같은 모양.
 *
 * 🔴 운영 댓글은 /best W · 홈 인기 · 고객 구성 · Persona 집계의 입력이 아니다(commentOrigin=OPERATOR ·
 *    operatorWriterId 축) — 그래서 syncBestEligibility 를 부르지 않는다. 최상위 운영 댓글과 같다.
 *
 * 🔴 이 파일은 고객 화면에서 import 되지 않는다. `reply-target.ts`(server-only)를 쓰므로
 *    스크립트에서는 `tsx --tsconfig tsconfig.ops.json` 으로 부른다.
 */
import { Prisma, type PrismaClient } from '@prisma/client'

import { resolveReplyTarget, holdReplyTarget } from './reply-target'
import { POST_VISIBILITY_SELECT, belongsToMicroSeedLane, pickPostVisibility } from './post-visibility'
import { assertOperatorReplyData, buildOperatorReplyData, judgeOperatorReplyPost } from './operator-writer'
import { TX_MAX_WAIT_MS, TX_TIMEOUT_MS, isDuplicateRequest, type ComposeResult } from './operator-compose-tx'

/** 직렬화 충돌 재시도 상한 — 넘으면 "잠시 후 다시" 로 끝낸다(무한 재시도 0) */
export const OPERATOR_REPLY_MAX_ATTEMPTS = 3

export const OPERATOR_REPLY_MESSAGE = {
  postGone: '대상 글을 찾을 수 없습니다.',
  parentEmpty: '답할 댓글을 골라 주세요.',
  parentGone: '선택한 댓글이 삭제되었거나 더 이상 존재하지 않습니다.',
  duplicate: '이미 처리된 요청입니다. 작성 내역에서 확인해 주세요.',
  busy: '다른 요청과 겹쳤습니다. 잠시 후 다시 시도해 주세요.',
  error: '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
} as const

export type CreateReplyInput = {
  postId: string
  parentId: string
  content: string
  /** 🔴 서버 세션의 관리자 User.id. 클라이언트 입력이 아니다 */
  actorUserId: string
  requestKey: string
}

/** 🔴 시험 전용 — 원자성 반례에서 저장 사이를 깨뜨릴 자리. 운영 호출부는 넘기지 않는다 */
export type ReplyFaults = { beforeComment?: () => Promise<void>; afterComment?: () => Promise<void> }

class Refused extends Error {
  constructor(readonly userMessage: string) { super(userMessage) }
}

const SERIALIZABLE = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: TX_MAX_WAIT_MS,
  timeout: TX_TIMEOUT_MS,
} as const

const isSerializationConflict = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034'

export async function createOperatorReplyTx(
  db: PrismaClient,
  input: CreateReplyInput,
  faults?: ReplyFaults,
): Promise<ComposeResult> {
  for (let attempt = 1; attempt <= OPERATOR_REPLY_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await db.$transaction(async (tx): Promise<ComposeResult> => {
        // ── 원글과 그 작성자를 한 번에 읽는다 — 작성자는 여기서 정해진다
        const post = await tx.post.findUnique({
          where: { id: input.postId },
          select: {
            id: true, boardType: true, personaId: true, operatorWriterId: true, authorId: true,
            // status 는 여기 들어 있다(3축 판정 입력)
            ...POST_VISIBILITY_SELECT,
            originalPostQueue: { select: { id: true } },
            operatorWriter: {
              select: {
                userId: true, status: true,
                user: { select: { providerId: true, persona: { select: { id: true } }, _count: { select: { accounts: true } } } },
              },
            },
          },
        })
        if (post === null) throw new Refused(OPERATOR_REPLY_MESSAGE.postGone)
        const w = post.operatorWriter
        const verdict = judgeOperatorReplyPost({
          status: post.status,
          boardType: post.boardType,
          personaId: post.personaId,
          microSeedLane: belongsToMicroSeedLane(pickPostVisibility(post)),
          originalQueueLinked: post.originalPostQueue !== null,
          operatorWriterId: post.operatorWriterId,
          authorId: post.authorId,
          writerUserId: w?.userId ?? null,
          writer: w === null ? null : {
            status: w.status, accountCount: w.user._count.accounts, providerId: w.user.providerId, hasPersona: w.user.persona !== null,
          },
        })
        if (!verdict.ok) throw new Refused(verdict.reason)

        // ── 부모 댓글 — 회원 답글과 같은 계약(있다 · 같은 글 · 안 지워짐). 차단 관계는 보지 않는다
        if (input.parentId.trim() === '') throw new Refused(OPERATOR_REPLY_MESSAGE.parentEmpty)
        const target = await resolveReplyTarget(tx, input.parentId, post.id, null)
        if (!target.ok || target.parentId === null) throw new Refused(OPERATOR_REPLY_MESSAGE.parentGone)
        if (!(await holdReplyTarget(tx, target, post.id))) throw new Refused(OPERATOR_REPLY_MESSAGE.parentGone)

        if (faults?.beforeComment) await faults.beforeComment()
        const data = buildOperatorReplyData({
          postId: post.id,
          parentId: target.parentId,
          content: input.content,
          authorId: verdict.authorId,
          operatorWriterId: verdict.operatorWriterId,
        })
        // 🔴 create 직전 — 함수가 있다는 것과 그 함수만 쓰인다는 것은 다르다
        assertOperatorReplyData(data)
        const comment = await tx.comment.create({
          data: data as unknown as Prisma.CommentUncheckedCreateInput,
          select: { id: true },
        })
        if (faults?.afterComment) await faults.afterComment()

        // ── 감사 기록 — 🔴 unique 위반이면 위 댓글까지 되돌아간다
        await tx.operatorWriteLog.create({
          data: {
            operatorWriterId: verdict.operatorWriterId,
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
      }, SERIALIZABLE)
    } catch (err) {
      if (err instanceof Refused) return { kind: 'blocked', message: err.userMessage }
      if (isDuplicateRequest(err)) return { kind: 'duplicate', message: OPERATOR_REPLY_MESSAGE.duplicate }
      if (isSerializationConflict(err)) {
        if (attempt < OPERATOR_REPLY_MAX_ATTEMPTS) continue
        return { kind: 'error', message: OPERATOR_REPLY_MESSAGE.busy }
      }
      console.error('[operator-reply]', (err as Error)?.message)
      return { kind: 'error', message: OPERATOR_REPLY_MESSAGE.error }
    }
  }
  return { kind: 'error', message: OPERATOR_REPLY_MESSAGE.busy }
}
