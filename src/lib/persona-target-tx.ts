import type { PrismaClient } from '@prisma/client'
import { planSetTarget, type TargetBlock, type TargetPostFacts } from './persona-target-rules'
import type { CandidateStatus } from './persona-candidate-rules'
import { lockPostRow, type AfterPostLock } from './post-row-lock'

/**
 * 수동 대상 지정 — DB 쪽. 인증 · revalidate 는 actions/persona-target.ts 가 한다.
 *
 * 🔴 'use server' 파일에 두지 않는다 — 거기서 export 한 함수는 전부 서버 action 으로 열린다.
 * 🔴 순서(공용 계약 · post-row-lock.ts): 트랜잭션 → 대상 Post 행 잠금 → 화면이 본 게시판과 지금 게시판 대조 →
 *    후보 · 글 상태 다시 읽기 → 기존 판정(planSetTarget) → 조건부 targetPostId update → commit.
 *    어드민 게시판 변경과 같은 잠금이라, 옮겨진 글에 옛 게시판을 보고 고른 후보가 붙지 않는다(STALE),
 *    이쪽이 먼저 잠그면 게시판 변경이 이 후보를 보고 멈춘다(OPEN_PERSONA_CANDIDATE).
 * 🔴 쓰는 값은 그대로 targetPostId 한 칼럼이다. status · 승인 · 발행 · 철회는 건드리지 않는다.
 */

/**
 * 대상 글의 댓글 수 — 🔴 목록(searchTargetPosts)과 저장 트랜잭션이 **이 함수 하나**로 센다 (2026-10-21).
 *
 * 🔴 **회원 댓글 = 실회원 · 비회원이 단 것만.** `commentOrigin` MEMBER · GUEST 이고 personaId · operatorWriterId 가
 *    모두 null 이어야 한다. 운영 직접 작성 댓글 · 작성자 대댓글(commentOrigin=OPERATOR)과 Micro Seed 원문 댓글은
 *    회원 댓글이 아니다 — 예전에는 personaId 만 보아 그것들까지 회원 댓글로 셌다(Codex [3] 승인 보정).
 * 🔴 Persona 댓글 수(personaId 가 있는 것)는 그대로다. 상한 · 판정(persona-target-rules)은 바꾸지 않는다.
 */
export const TARGET_COMMENT_SELECT = { personaId: true, operatorWriterId: true, commentOrigin: true } as const

type TargetCommentRow = { personaId: string | null; operatorWriterId: string | null; commentOrigin: string }

export function targetCommentCounts(comments: readonly TargetCommentRow[]): { personaComments: number; memberComments: number } {
  return {
    personaComments: comments.filter((c) => c.personaId !== null).length,
    memberComments: comments.filter((c) =>
      (c.commentOrigin === 'MEMBER' || c.commentOrigin === 'GUEST') && c.personaId === null && c.operatorWriterId === null).length,
  }
}

export type SetTargetTxResult =
  | { ok: true; targetPostId: string }
  | { ok: false; code: 'NOT_FOUND'; error: string }
  | { ok: false; code: 'STALE'; error: string }
  | { ok: false; code: 'ALREADY_HANDLED'; error: string }
  | { ok: false; code: 'BLOCKED'; blocks: TargetBlock[] }

export const TARGET_STALE_MESSAGE = '화면을 연 뒤 이 글의 게시판이 바뀌었습니다. 다시 검색해 주세요.'

export async function setCandidateTargetTx(
  db: PrismaClient,
  input: { candidateId: string; postId: string; expectedBoardType: string },
  afterLock?: AfterPostLock,
): Promise<SetTargetTxResult> {
  const wanted = input.postId.trim()
  return db.$transaction(async (tx) => {
    // 🔴 글을 골랐을 때만 잠근다. 고르지 않았으면 쓸 일이 없다(planSetTarget 이 POST_ID_EMPTY 로 막는다)
    const locked = wanted === '' ? null : await lockPostRow(tx, wanted)
    if (afterLock) await afterLock()
    if (locked !== null && locked.boardType !== input.expectedBoardType) {
      return { ok: false, code: 'STALE', error: TARGET_STALE_MESSAGE } as const
    }

    const row = await tx.personaApprovalQueue.findUnique({
      where: { id: input.candidateId },
      select: { id: true, status: true, publishedCommentId: true },
    })
    if (row === null) return { ok: false, code: 'NOT_FOUND', error: '대상을 찾을 수 없습니다.' } as const

    // 🔴 저장 직전에 글 상태를 다시 읽는다(잠금 아래). 목록을 띄운 뒤 댓글이 달렸을 수 있다
    const post = locked === null
      ? null
      : await tx.post.findUnique({
          where: { id: wanted },
          select: { status: true, comments: { where: { isDeleted: false }, select: TARGET_COMMENT_SELECT } },
        })
    const facts: TargetPostFacts | null = post
      ? {
          status: post.status,
          ...targetCommentCounts(post.comments),
        }
      : null

    const plan = planSetTarget({
      candidate: { status: row.status as CandidateStatus, publishedCommentId: row.publishedCommentId },
      postId: wanted,
      post: facts,
    })
    if (!plan.ok) return { ok: false, code: 'BLOCKED', blocks: plan.blocks } as const

    // 🔴 조건부 UPDATE — 읽은 뒤 쓰는 사이에 발행됐으면 0건이 되어 덮어쓰지 않는다.
    //    🔴 targetPostId 한 컬럼만 쓴다. status 는 건드리지 않는다
    const res = await tx.personaApprovalQueue.updateMany({
      where: { id: row.id, status: { in: ['PENDING', 'APPROVED'] }, publishedCommentId: null },
      data: { targetPostId: plan.postId },
    })
    if (res.count === 0) return { ok: false, code: 'ALREADY_HANDLED', error: '이미 처리된 후보입니다. 새로고침해 주세요.' } as const
    return { ok: true, targetPostId: plan.postId } as const
  }, { maxWait: 10_000, timeout: 20_000 })
}
