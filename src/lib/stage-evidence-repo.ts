/**
 * 🔴 **단계 운영 증거 읽기 — read-only. write 0** (2026-09-29 P0)
 *
 * 🔴 KST 날짜 D 에 실제로 일어난 일을 DB 에서 모은다. 판정은 `judgeStageEvidence`(순수)가 한다.
 *    · 발행   `PersonaActivityLog(kind=post)` — 일일 상한의 정본과 **같은 표 · 같은 KST 경계**
 *    · 표식   `decidedBy = UNATTENDED_PUBLISH_DECIDED_BY` 만 무인 러너 발행이다
 *    · 1:1    Queue(`createdPostId`) · 발행 기록 · Post 를 id 로 대조한다
 *             (🔴 관계 `is:null` 필터를 쓰지 않는다 — FK 쪽 null 검사로 바뀌어 유실을 0 으로 센다)
 *    · 댓글   `commentOrigin=PERSONA` · 지워지지 않은 것
 *    · 감사   그날 고른 감사 + 그날 글의 감사(postId·queueId 로 표본 소속 대조) · 표 전체의 정본 카운트(결함 yes · 시한 초과 · 재시도 가능 · 글 유실)
 *    · 도장   Queue `gateResults.release` — 발행 트랜잭션이 같은 트랜잭션에서 남긴 source-slot-v1 도장(조항 ⑦).
 *             🔴 도장 시각이 **그 글의 발행 기록 시각과 정확히 같아야** 증명이다(`publishEventAtOf` · `releaseStampCheck`)
 *    · 공개 시각 🔴 발행 기록(`PersonaActivityLog.createdAt` — 상한 정본과 같은 칸)이다. Post 시각을 쓰지 않는다
 *             (Post.createdAt 은 DB 기본값 · publishAt 은 원글 레인에서 늘 null — 발행 사건의 시계가 아니다)
 *
 * 🔴 결정(StageDecision)은 여기서 읽지 않는다 — 읽는 곳은 잠겨 있다(`stage-decision-repo` 주석).
 *    부르는 쪽(controller)이 이미 검증한 전날 결정을 넘긴다.
 * 🔴 원문 · 닉네임을 select 하지 않는다 — id 와 시각만.
 */
import type { PrismaClient } from '@prisma/client'

import type { RuntimeStage } from './scale-profile'
import { isCalendarDate, type ValidatedStageDecision } from './stage-decision-contract'
import { UNATTENDED_PUBLISH_DECIDED_BY } from './original-post-publish-tx'
import { unresolvedDefectCount, missingAutoPostCount } from './auto-ready-repo'
import { overdueAuditCount, retryableFailureCount, RETRYABLE_NOTE_PREFIX, AUDIT_OVERDUE_MS } from './auto-ready-audit-store'
import { AUTO_DECIDER } from './auto-ready-v2'
import { machineReviewedByHuman } from './original-post-auto-publish'
import type { EvidencePost, PostDecider, StageEvidenceFacts } from './stage-evidence'
import { publishEventAtOf, releaseStampStatusOf } from './source-slot-release'

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
  stage: RuntimeStage
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
    select: { targetId: true, decidedBy: true, publishedAt: true, createdAt: true },
  })
  const targetIds = [...new Set(logs.map((l) => l.targetId).filter((t): t is string => t !== null && t !== ''))]
  const posts = targetIds.length === 0 ? [] : await db.post.findMany({
    where: { id: { in: targetIds } },
    select: { id: true, personaId: true },
  })
  const queue = targetIds.length === 0 ? [] : await db.originalPostApprovalQueue.findMany({
    where: { createdPostId: { in: targetIds } },
    // 🔴 `gateResults` 는 도장(`release`) 한 칸만 읽는다 — 원문 · 본문은 여기 없다
    select: { id: true, createdPostId: true, status: true, decidedBy: true, gateResults: true },
  })
  /**
   * 🔴 **도장 사건 검증은 그 글의 모든 발행 기록으로 한다**(리뷰 후속 P0-A). 그날 기록만 넘기면 창 밖 두 번째 기록이
   *    가려져 "정확히 한 줄" 이 거짓이 된다. 일일 대상 · 일일 수량(`publishLogs`)은 그대로 그날 기록(`logs`)이다.
   */
  const allLogs = targetIds.length === 0 ? [] : await db.personaActivityLog.findMany({
    where: { kind: 'post', targetId: { in: targetIds } },
    select: { targetId: true, publishedAt: true, createdAt: true },
  })
  const queueOf = new Map<string, number>()
  const releaseOfPost = new Map<string, 'STAMPED_ELIGIBLE' | 'MISSING' | 'STALE'>()
  const logsOf = (postId: string): typeof logs => logs.filter((l) => l.targetId === postId)
  const deciderOfPost = new Map<string, PostDecider>()
  const queueIdOfPost = new Map<string, string>()
  for (const q of queue) {
    if (q.status !== 'PUBLISHED') continue
    queueOf.set(q.createdPostId!, (queueOf.get(q.createdPostId!) ?? 0) + 1)
    deciderOfPost.set(q.createdPostId!, deciderOf(q.decidedBy))
    queueIdOfPost.set(q.createdPostId!, q.id)
    // 🔴 도장 시각 = 그 글의 발행 기록 시각이어야 한다 — 같은 트랜잭션의 같은 사건
    releaseOfPost.set(q.createdPostId!, releaseStampStatusOf(q.gateResults, publishEventAtOf(allLogs.filter((l) => l.targetId === q.createdPostId))))
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
    select: { postId: true, queueId: true, defect: true, note: true, selectedAt: true },
  })

  const evidencePosts: EvidencePost[] = posts.map((p) => {
    const mine = logsOf(p.id)
    return {
      postId: p.id,
      queueId: queueIdOfPost.get(p.id) ?? null,
      // 🔴 공개 시각 = 발행 기록 시각(가장 이른 줄 — 중복은 DUP_PUBLISH_LOG 가 따로 잡는다). posts 는 logs 에서 왔으므로 mine ≥ 1
      publishedAtMs: Math.min(...mine.map((l) => l.createdAt.getTime())),
      // 🔴 발행 기록이 여럿이면 전부 표식이 있어야 무인이다 — 중복은 아래 DUP_PUBLISH_LOG 가 따로 잡는다
      unattended: mine.length > 0 && mine.every((l) => l.decidedBy === UNATTENDED_PUBLISH_DECIDED_BY),
      queueRows: queueOf.get(p.id) ?? 0,
      publishLogs: mine.length,
      authorPersonaId: p.personaId,
      decider: deciderOfPost.get(p.id) ?? 'unknown',
      personaComments: comments.filter((c) => c.postId === p.id).map((c) => ({
        personaId: c.personaId, createdAtMs: c.createdAt.getTime(), topLevel: c.parentId === null,
      })),
      release: releaseOfPost.get(p.id) ?? 'MISSING',
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
        postId: a.postId,
        queueId: a.queueId,
        judged: a.defect !== null,
        defectYes: a.defect === 'yes',
        retryable: a.defect === null && (a.note ?? '').startsWith(RETRYABLE_NOTE_PREFIX),
        overdue: a.defect === null && a.selectedAt.getTime() < i.now.getTime() - AUDIT_OVERDUE_MS,
      })),
      globalUnresolvedDefects: await unresolvedDefectCount(db),
      globalOverdue: await overdueAuditCount(db, i.now),
      globalRetryable: await retryableFailureCount(db),
      globalMissingPosts: await missingAutoPostCount(db),
    },
  }
}
