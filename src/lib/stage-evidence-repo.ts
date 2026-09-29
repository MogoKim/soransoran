/**
 * 🔴 **단계 운영 증거 읽기 — read-only. write 0** (2026-09-29 P0)
 *
 * 🔴 KST 날짜 D 에 실제로 일어난 일을 DB 에서 모은다. 판정은 `judgeStageEvidence`(순수)가 한다.
 *    · 발행   `PersonaActivityLog(kind=post)` — 일일 상한의 정본과 **같은 표 · 같은 KST 경계**
 *    · 표식   `decidedBy = UNATTENDED_PUBLISH_DECIDED_BY` 만 무인 러너 발행이다
 *    · 1:1    Queue(`createdPostId`) · 발행 기록 · Post 를 id 로 대조한다
 *             (🔴 관계 `is:null` 필터를 쓰지 않는다 — FK 쪽 null 검사로 바뀌어 유실을 0 으로 센다)
 *    · 댓글   `commentOrigin=PERSONA` · 지워지지 않은 것
 *    · 감사   그날 고른 감사 + 그날 글의 감사 · 표 전체의 정본 카운트(결함 yes · 시한 초과 · 재시도 가능 · 글 유실)
 *
 * 🔴 결정(StageDecision)은 여기서 읽지 않는다 — 읽는 곳은 잠겨 있다(`stage-decision-repo` 주석).
 *    부르는 쪽(controller)이 이미 검증한 전날 결정을 넘긴다.
 * 🔴 원문 · 닉네임을 select 하지 않는다 — id 와 시각만.
 */
import type { PrismaClient } from '@prisma/client'

import type { ReleaseStage } from './scale-profile'
import { isCalendarDate, type ValidatedStageDecision } from './stage-decision-contract'
import { UNATTENDED_PUBLISH_DECIDED_BY } from './original-post-publish-tx'
import { confirmedDefectCount, missingAutoPostCount } from './auto-ready-repo'
import { overdueAuditCount, retryableFailureCount, RETRYABLE_NOTE_PREFIX, AUDIT_OVERDUE_MS } from './auto-ready-audit-store'
import { AUTO_DECIDER } from './auto-ready-v2'
import { machineReviewedByHuman } from './original-post-auto-publish'
import type { EvidencePost, PostDecider, StageEvidenceFacts } from './stage-evidence'

/**
 * 🔴 **Queue 결정자 → 사후 감사 대상 여부.**
 *    · `AUTO_DECIDER`                       자동 READY — 사후 감사 대상
 *    · 사람 표식(`machine:` 가 아닌 값 · 사람이 확인한 기계 행) 사람이 발행 전에 검토했다 — 대상 아님
 *    · 비었거나 확인 안 된 `machine:*`       모른다 — 🔴 대상 아님으로 삼키지 않는다
 */
export function deciderOf(decidedBy: string | null): PostDecider {
  const d = (decidedBy ?? '').trim()
  if (d === '') return 'unknown'
  if (d === AUTO_DECIDER) return 'auto'
  if (d.startsWith('machine:') && !machineReviewedByHuman(d)) return 'unknown'
  return 'human'
}

/** 🔴 KST 날짜 D 의 [시작, 끝) — 발행 상한과 같은 경계(KST 자정) */
export function kstDayBounds(kstDate: string): { start: Date; end: Date } | null {
  if (!isCalendarDate(kstDate)) return null
  const start = new Date(`${kstDate}T00:00:00+09:00`)
  return { start, end: new Date(start.getTime() + 86_400_000) }
}

export async function readStageEvidenceFacts(db: PrismaClient, i: {
  kstDate: string
  stage: ReleaseStage
  /** 🔴 D 의 **검증된** 결정 — 없거나 검증에 떨어졌으면 null */
  decision: ValidatedStageDecision | null
  /** 시한 초과 감사를 세는 시각 — 판정하는 지금 */
  now: Date
  /** 🔴 그 댓글 단계의 글당 Persona 댓글 상한(`personaCommentCapFor`) — 부르는 쪽이 정본 env 에서 읽는다. 모르면 null */
  commentCapPerPost: number | null
}): Promise<StageEvidenceFacts> {
  const day = kstDayBounds(i.kstDate)
  if (day === null) throw new Error('STAGE_EVIDENCE_BAD_DATE')
  const inDay = { gte: day.start, lt: day.end }

  const logs = await db.personaActivityLog.findMany({
    where: { kind: 'post', createdAt: inDay },
    select: { targetId: true, decidedBy: true },
  })
  const targetIds = [...new Set(logs.map((l) => l.targetId).filter((t): t is string => t !== null && t !== ''))]
  const posts = targetIds.length === 0 ? [] : await db.post.findMany({
    where: { id: { in: targetIds } },
    select: { id: true, personaId: true, publishAt: true, createdAt: true },
  })
  const queue = targetIds.length === 0 ? [] : await db.originalPostApprovalQueue.findMany({
    where: { createdPostId: { in: targetIds } },
    select: { id: true, createdPostId: true, status: true, decidedBy: true },
  })
  const queueOf = new Map<string, number>()
  const deciderOfPost = new Map<string, PostDecider>()
  for (const q of queue) {
    if (q.status !== 'PUBLISHED') continue
    queueOf.set(q.createdPostId!, (queueOf.get(q.createdPostId!) ?? 0) + 1)
    deciderOfPost.set(q.createdPostId!, deciderOf(q.decidedBy))
  }
  const postOf = new Map(posts.map((p) => [p.id, p]))
  /** 🔴 Post 가 없거나 Queue 가 없는 발행 기록 — 원글 레인 밖이거나 유실이다 */
  const orphanPublishLogs = logs.filter((l) =>
    l.targetId === null || l.targetId === '' || !postOf.has(l.targetId) || !queueOf.has(l.targetId)).length

  const comments = posts.length === 0 ? [] : await db.comment.findMany({
    where: { postId: { in: posts.map((p) => p.id) }, commentOrigin: 'PERSONA', isDeleted: false },
    select: { postId: true, personaId: true, parentId: true, createdAt: true },
  })

  const audits = await db.autoReadyAudit.findMany({
    where: { OR: [{ selectedAt: inDay }, ...(targetIds.length === 0 ? [] : [{ postId: { in: targetIds } }])] },
    select: { postId: true, defect: true, note: true, selectedAt: true },
  })
  const auditedPosts = new Set(audits.map((a) => a.postId))

  const evidencePosts: EvidencePost[] = posts.map((p) => {
    const mine = logs.filter((l) => l.targetId === p.id)
    return {
      publishedAtMs: (p.publishAt ?? p.createdAt).getTime(),
      // 🔴 발행 기록이 여럿이면 전부 표식이 있어야 무인이다 — 중복은 아래 DUP_PUBLISH_LOG 가 따로 잡는다
      unattended: mine.length > 0 && mine.every((l) => l.decidedBy === UNATTENDED_PUBLISH_DECIDED_BY),
      queueRows: queueOf.get(p.id) ?? 0,
      publishLogs: mine.length,
      authorPersonaId: p.personaId,
      decider: deciderOfPost.get(p.id) ?? 'unknown',
      audited: auditedPosts.has(p.id),
      personaComments: comments.filter((c) => c.postId === p.id).map((c) => ({
        personaId: c.personaId, createdAtMs: c.createdAt.getTime(), topLevel: c.parentId === null,
      })),
    }
  })

  /** 🔴 Queue 로 발행된 그날 글인데 발행 기록이 없는 것 — 상한 정본을 비껴간 발행이다 */
  const dayPosts = await db.post.findMany({ where: { createdAt: inDay, personaId: { not: null } }, select: { id: true } })
  const dayQueue = dayPosts.length === 0 ? [] : await db.originalPostApprovalQueue.findMany({
    where: { createdPostId: { in: dayPosts.map((p) => p.id) } }, select: { createdPostId: true },
  })
  const logged = new Set(targetIds)
  const unloggedPublishes = dayQueue.filter((q) => !logged.has(q.createdPostId!)).length

  return {
    kstDate: i.kstDate, stage: i.stage,
    decision: i.decision === null ? null : {
      kstDate: i.decision.kstDate, state: i.decision.state, release: i.decision.release, decidedBy: i.decision.decidedBy,
    },
    posts: evidencePosts,
    orphanPublishLogs,
    unloggedPublishes,
    commentCapPerPost: i.commentCapPerPost,
    audits: {
      // 🔴 행마다 — 규칙은 정본 카운트와 같다(`retryableFailureCount` · `overdueAuditCount`)
      rows: audits.map((a) => ({
        judged: a.defect !== null,
        defectYes: a.defect === 'yes',
        retryable: a.defect === null && (a.note ?? '').startsWith(RETRYABLE_NOTE_PREFIX),
        overdue: a.defect === null && a.selectedAt.getTime() < i.now.getTime() - AUDIT_OVERDUE_MS,
      })),
      globalDefectYes: await confirmedDefectCount(db),
      globalOverdue: await overdueAuditCount(db, i.now),
      globalRetryable: await retryableFailureCount(db),
      globalMissingPosts: await missingAutoPostCount(db),
    },
  }
}
