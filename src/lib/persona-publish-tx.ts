import type { Prisma, PrismaClient } from '@prisma/client'
import { planPublish, type PublishBlock } from './persona-publish-rules'
import { requireCapContext, kstDayStart, weekWindowStart } from './persona-cap'
import type { CandidateStatus } from './persona-candidate-rules'

/**
 * 후보 발행 트랜잭션 — 🔴 실제 write 가 일어나는 유일한 함수
 *
 * 정본: docs/operations/2026-08-30-persona-architecture-design.md §13
 *
 * 🔴 server action 과 CLI 가 **이 함수를 공유한다.** 각자 구현하지 않는다 —
 *    write 경로가 둘이면 게이트도 둘이 되고, 반드시 한쪽만 고쳐지는 날이 온다.
 *    micro-seed 가 publisher 와 recover scanner 에 같은 함수를 쓰게 한 이유와 같다.
 *
 * 🔴 write 는 세 테이블 · 각 1행이다.
 *      ① Comment                INSERT 1
 *      ② PersonaApprovalQueue   UPDATE 1 (조건부)
 *      ③ PersonaActivityLog     INSERT 1
 *    Persona · User · Post · PersonaAuditLog · PersonaGlobalSwitch 를 건드리지 않는다.
 *    active 전환은 여기서 일어나지 않는다.
 *
 * 🔴 판정을 트랜잭션 **안에서** 한다.
 *    밖에서 한 판정은 그 시점의 사진이다. 그 사이 kill switch 가 켜졌거나
 *    다른 세션이 같은 후보를 발행했을 수 있다.
 *
 * 🔴 이 파일은 고객 화면에서 import 되지 않는다.
 */

export type PublishTxResult =
  | { kind: 'error'; message: string }
  | { kind: 'blocked'; blocks: PublishBlock[] }
  | {
      kind: 'published'
      commentId: string
      postId: string
      boardType: 'MENOPAUSE' | 'FREE' | 'MAGAZINE'
    }

/** 대기열이 그 사이에 바뀌었다는 뜻. 🔴 throw 해야 Comment 까지 되돌아간다 */
const QUEUE_RACE = 'PERSONA_PUBLISH_QUEUE_RACE'

export async function publishCandidateTx(
  db: PrismaClient,
  args: { id: string; now?: Date },
): Promise<PublishTxResult> {
  const id = (args.id ?? '').trim()
  if (id === '') return { kind: 'error', message: '대상을 찾을 수 없습니다.' }
  const now = args.now ?? new Date()

  try {
    return await db.$transaction(async (tx): Promise<PublishTxResult> => {
      const row = await tx.personaApprovalQueue.findUnique({
        where: { id },
        select: {
          id: true, status: true, targetPostId: true, publishedCommentId: true,
          candidateText: true, editedText: true, personaId: true,
          gateStatus: true, gateResults: true, aiToneTags: true,
          persona: {
            select: { id: true, status: true, userId: true, dailyCap: true, weeklyCap: true },
          },
        },
      })
      if (row === null) return { kind: 'error', message: '대상을 찾을 수 없습니다.' }

      // kill switch — 🔴 행이 없으면 "중지 꺼짐" 과 같다
      const sw = await tx.personaGlobalSwitch.findUnique({
        where: { id: 'global' },
        select: { enabled: true },
      })

      const post = row.targetPostId
        ? await tx.post.findUnique({
            where: { id: row.targetPostId },
            select: { id: true, status: true, boardType: true },
          })
        : null

      // 그 글에 이미 달린 페르소나 댓글 — 내려간 것은 세지 않는다
      const personaCommentsOnPost = row.targetPostId
        ? await tx.comment.count({
            where: { postId: row.targetPostId, personaId: { not: null }, isDeleted: false },
          })
        : 0

      // 🔴 cap 실측. 못 세면 requireCapContext 가 throw 한다 — 0 으로 보정하지 않는다
      const [usedToday, usedWeek] = await Promise.all([
        tx.personaActivityLog.count({
          where: { personaId: row.personaId, kind: 'comment', createdAt: { gte: kstDayStart(now) } },
        }),
        tx.personaActivityLog.count({
          where: { personaId: row.personaId, kind: 'comment', createdAt: { gte: weekWindowStart(now) } },
        }),
      ])

      const plan = planPublish({
        candidate: {
          status: row.status as CandidateStatus,
          targetPostId: row.targetPostId,
          publishedCommentId: row.publishedCommentId,
          candidateText: row.candidateText,
          editedText: row.editedText,
        },
        persona: {
          status: row.persona.status,
          dailyCap: row.persona.dailyCap,
          weeklyCap: row.persona.weeklyCap,
        },
        killSwitchEnabled: sw?.enabled === true,
        cap: requireCapContext({ usedToday, usedWeek }),
        targetPost: post ? { status: post.status } : null,
        personaCommentsOnPost,
      })
      if (!plan.ok) return { kind: 'blocked', blocks: plan.blocks }

      // plan 이 통과했으면 post 는 반드시 있다. 타입을 좁히기 위한 방어다
      if (post === null) return { kind: 'error', message: '대상 글을 찾을 수 없습니다.' }

      // ── ① Comment ──
      // 🔴 세 축을 전부 명시한다. commentOrigin 을 기본값에 맡기면 MEMBER 로 적재된다
      const comment = await tx.comment.create({
        data: {
          postId: post.id,
          authorId: row.persona.userId,
          content: plan.content,
          source: 'SYSTEM',
          commentOrigin: 'PERSONA',
          personaId: row.persona.id,
        },
        select: { id: true },
      })

      // ── ② Queue ──
      // 🔴 조건부 UPDATE. 읽은 뒤 쓰는 사이에 누가 먼저 발행했으면 0건이 되어 롤백한다
      const updated = await tx.personaApprovalQueue.updateMany({
        where: { id: row.id, status: 'APPROVED', publishedCommentId: null },
        data: { status: 'PUBLISHED', publishedCommentId: comment.id },
      })
      if (updated.count === 0) throw new Error(QUEUE_RACE)

      // ── ③ ActivityLog ──
      // 🔴 cap 의 정본이다. 이것이 빠지면 다음 발행에서 상한이 조용히 열린다
      await tx.personaActivityLog.create({
        data: {
          personaId: row.persona.id,
          kind: 'comment',
          targetId: comment.id,
          gateStatus: row.gateStatus,
          ...(row.gateResults === null
            ? {}
            : { gateHits: row.gateResults as Prisma.InputJsonValue }),
          aiToneTags: row.aiToneTags,
          decidedBy: 'operator',
          publishedAt: now,
        },
      })

      return {
        kind: 'published',
        commentId: comment.id,
        postId: post.id,
        boardType: post.boardType,
      }
    })
  } catch (err) {
    if (err instanceof Error && err.message === QUEUE_RACE) {
      return { kind: 'error', message: '이미 발행된 후보입니다. 새로고침해 주세요.' }
    }
    // 🔴 예외 원문을 호출부로 흘리지 않는다
    return { kind: 'error', message: '발행하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }
}
