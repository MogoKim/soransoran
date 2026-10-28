import type { BoardType, Prisma, PrismaClient } from '@prisma/client'
import { lockPostRow, type AfterPostLock } from './post-row-lock'

/**
 * 자동 Persona 댓글 후보 PENDING 적재 — 🔴 세 자동 writer(첫 댓글 Queue CLI · 루프 · 추가 댓글)의 유일한 저장 지점.
 *
 * 🔴 provider 호출 · 문장 생성 · 9관문은 **이 함수 밖에서 끝난 뒤** 부른다. 트랜잭션과 Post 잠금은
 *    여기서 처음 잡는다 — 유료 호출 동안 DB 행을 붙잡지 않는다.
 * 🔴 순서(공용 계약 · post-row-lock.ts): 트랜잭션 → Post 행 잠금 → 지금 상태 · boardType 재확인 → create → commit.
 *    생성 시작 때 본 게시판(expectedBoardType)과 지금 게시판이 다르면 **만들지 않는다** —
 *    어드민이 그 사이 글을 옮겼다. 새 게시판 문맥에 맞게 후보를 고치거나 다시 만들지 않는다.
 *    반대로 이 함수가 먼저 잠그면 게시판 변경은 잠금을 기다렸다가 이 후보를 보고 OPEN_PERSONA_CANDIDATE 로 멈춘다.
 * 🔴 중복은 여전히 unique constraint(dedupKey)가 가른다 — 미리 조회해서 이기려 하지 않는다.
 */

const BOARD_TYPES: readonly string[] = ['MENOPAUSE', 'FREE', 'MAGAZINE'] satisfies readonly BoardType[]

export type CandidateWriteCode = 'POST_GONE' | 'BOARD_UNKNOWN' | 'BOARD_CHANGED' | 'NOT_PUBLISHED' | 'DUPLICATE' | 'ERROR'

export type CandidateWriteResult =
  | { created: true }
  | { created: false; code: CandidateWriteCode; reason: string; errorCode?: string }

export type PendingCandidateData = Omit<Prisma.PersonaApprovalQueueCreateInput, 'targetPostId' | 'status'>

export async function createPendingCandidateLocked(
  db: PrismaClient,
  args: { postId: string; expectedBoardType: string; data: PendingCandidateData },
  afterLock?: AfterPostLock,
): Promise<CandidateWriteResult> {
  if (!BOARD_TYPES.includes(args.expectedBoardType)) {
    return { created: false, code: 'BOARD_UNKNOWN', reason: `생성 때 게시판을 알 수 없다(${args.expectedBoardType}) — 적재 0` }
  }
  try {
    return await db.$transaction(async (tx) => {
      const post = await lockPostRow(tx, args.postId)
      if (afterLock) await afterLock()
      if (!post) return { created: false, code: 'POST_GONE', reason: '대상 글이 없다 — 적재 0' } as const
      if (post.boardType !== args.expectedBoardType) {
        return {
          created: false, code: 'BOARD_CHANGED',
          reason: `생성 뒤 게시판이 바뀌었다(${args.expectedBoardType} → ${post.boardType}) — 적재 0`,
        } as const
      }
      if (post.status !== 'PUBLISHED') return { created: false, code: 'NOT_PUBLISHED', reason: `대상 글이 공개가 아니다(${post.status}) — 적재 0` } as const
      await tx.personaApprovalQueue.create({
        data: { ...args.data, targetPostId: args.postId, status: 'PENDING' },
        select: { id: true },
      })
      return { created: true } as const
    }, { maxWait: 10_000, timeout: 20_000 })
  } catch (e) {
    const code = (e as { code?: string }).code
    if (code === 'P2002') return { created: false, code: 'DUPLICATE', reason: 'dedupKey 중복', errorCode: code }
    return { created: false, code: 'ERROR', reason: `적재 실패 — ${code ?? 'UNKNOWN'}`, errorCode: code }
  }
}
