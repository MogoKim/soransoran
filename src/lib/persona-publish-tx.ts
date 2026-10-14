import type { Prisma, PrismaClient } from '@prisma/client'
import { planPublish, type PublishBlock } from './persona-publish-rules'
import {
  recheckBeforePublish, type PublishActor, type QueueStatus,
} from './persona-comment-queue'
import {
  judgeReadiness, windowFromRows, RATIO_WINDOW_DAYS,
} from './persona-comment-governor'
import { legacyRunModeFor, readCommentStage, stagePowers } from './persona-comment-stage'
import { countManagedPostsToday } from './persona-comment-bootstrap-source'
import { judgeRealMember } from './real-member-gate'
import { judgeLifeHistory, readPostRequirements } from './original-post-persona-match'
import type { GateLine } from './persona-comment-gate-report'
import { readConfirmedSelection, verifyProvenance } from './persona-comment-provenance'
import { requireCapContext, kstDayStart, weekWindowStart } from './persona-cap'
import type { CandidateStatus } from './persona-candidate-rules'
import {
  judgeAutoLane, AUTO_LANE_ACTIVITY_DECIDED_BY, AUTO_LANE_DECIDED_BY,
} from './persona-comment-auto-lane'
import { readFileSync } from 'node:fs'
import {
  followupStageOf, judgeFollowupPublish, readFollowupProfileRaw, readFollowupSwitch, stampFromEditDiff, verifyStamp,
  type FollowupCommentRow,
} from './persona-comment-followup'
import {
  FOLLOWUP_LANE_ACTIVITY_DECIDED_BY, FOLLOWUP_LANE_DECIDED_BY, personaCommentProvenanceOf,
} from './stage-evidence'
import { decisionStageEnv } from './scale-runtime'
import { OPEN_STATUSES } from './persona-comment-queue'

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

/**
 * 🔴 저장된 Gate 결과를 다시 읽는다. 모양이 아니면 **빈 배열**을 돌려준다 —
 *    그러면 `judgeGateReport` 가 `shaped: false` 로 막는다(fail-closed).
 *    손상된 JSON 을 통과로 세지 않는다.
 */
function readStoredGates(raw: unknown): GateLine[] {
  if (!Array.isArray(raw)) return []
  const out: GateLine[] = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object') return []
    const g = item as Record<string, unknown>
    if (typeof g.gate !== 'string' || typeof g.outcome !== 'string') return []
    out.push({ gate: g.gate, outcome: g.outcome })
  }
  return out
}

/** identity JSON 에서 생활사 축만 읽는다. 🔴 없으면 undefined — 0 으로 보정하지 않는다 */
function readIdentityLife(identity: unknown): {
  maritalStatus?: string | null
  childrenCount?: number | null
  childrenAgeBands?: never
  parentCare?: string | null
  menopauseStatus?: string | null
} {
  const id = (identity ?? {}) as Record<string, unknown>
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)
  return {
    maritalStatus: str(id.maritalStatus),
    childrenCount: num(id.childrenCount),
    childrenAgeBands: (Array.isArray(id.childrenAgeBands)
      ? (id.childrenAgeBands as unknown[]).filter((x): x is string => typeof x === 'string')
      : undefined) as never,
    parentCare: str(id.parentCare),
    menopauseStatus: str(id.menopauseStatus),
  }
}

/**
 * 🔴 Serializable 트랜잭션의 시간 손잡이.
 *    `maxWait` 는 잠금을 기다리는 시간, `timeout` 은 트랜잭션 자체의 상한이다.
 *    persona-cohort 가 기본 5초에 걸려 2/2 실패했던 자리와 같은 이유로 넉넉히 둔다.
 */
export const TX_MAX_WAIT_MS = 20_000
export const TX_TIMEOUT_MS = 30_000

/**
 * 🔴 직렬화 충돌인가. Prisma 는 `P2034` 로 준다.
 *    코드가 없는 드라이버 오류도 있으므로 메시지도 함께 본다 — 모르면 충돌로 보지 않는다.
 */
export function isSerializationConflict(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false
  const e = err as { code?: unknown; message?: unknown }
  if (e.code === 'P2034') return true
  return typeof e.message === 'string'
    && /could not serialize|serialization failure|write conflict|deadlock detected/i.test(e.message)
}

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
  args: {
    id: string
    now?: Date
    /**
     * 🔴 **누가 시켰는가.** 생략하면 `automation` 이다(fail-closed).
     *    `manual-admin` 은 server action 이 `requireAdmin()` 을 통과한 뒤에만 넘긴다 —
     *    CLI·runner 는 넘기지 않으므로 bootstrap 후보를 발행할 수 없다.
     */
    actor?: PublishActor
    /**
     * 🔴 **무인 레인(bootstrap-auto) 발행** (2026-09-28 · Track B).
     *
     *    사람 승인 단계가 없는 레인이다. 그래서 이 트랜잭션이 **PENDING 을 직접 PUBLISHED 로**
     *    옮긴다 — 승인과 발행 사이의 틈을 만들지 않는다(틈이 있으면 APPROVED 로 남은 행을
     *    나중에 누가 60분 뒤에 발행할 수 있다).
     *
     *    🔴 기존 재검사(9관문 · 실회원 댓글 3건 · 같은 Persona · kill switch · 일일 상한 ·
     *       provenance · 생활사 · cap)는 **하나도 빠지지 않고** 그대로 돈다. 그 위에
     *       `judgeAutoLane`(60분 · 글당 1건 · 자기 글 · 단계·주체·상태)이 더해진다.
     *    🔴 `manual-admin` 과 함께 쓸 수 없다 — 사람 발행은 이 레인이 아니다.
     */
    autoLane?: boolean
    /**
     * 🔴 **추가 댓글 레인** (2026-10-14 · PR #704 · 기본 OFF). 첫 댓글 뒤 선택적 추가 0~4건.
     *    `autoLane`(60분 · 글당 1건) 대신 `judgeFollowupPublish`(스위치 · profile · 도장 · 순번 · 대상 · 시간차 · 실회원 우선)를 본다.
     *    기존 재검사는 **하나도 빠지지 않고** 그대로 돈다. 표식은 #707 정본(`FOLLOWUP_LANE_*`)이다 —
     *    단계 증거는 이 댓글을 첫 댓글로 세지 않는다. `autoLane` · `manual-admin` 과 함께 쓸 수 없다.
     */
    followupLane?: boolean
  },
): Promise<PublishTxResult> {
  const id = (args.id ?? '').trim()
  if (id === '') return { kind: 'error', message: '대상을 찾을 수 없습니다.' }
  if (args.followupLane === true && (args.autoLane === true || args.actor === 'manual-admin')) {
    return { kind: 'blocked', blocks: [{ code: 'FOLLOWUP_LANE', message: '추가 댓글 레인은 첫 댓글 레인·사람 발행과 섞을 수 없다' }] }
  }
  const now = args.now ?? new Date()

  try {
    /**
     * 🔴 **Serializable 이어야 하는 이유** (2026-09-09).
     *
     *    글로벌 일일 상한은 "이 후보가 몇 번째인가" 로 판정한다. 그런데 기본 격리
     *    (Read Committed)에서는 **서로 다른 후보의 두 트랜잭션이 같은 스냅샷을 읽는다** —
     *    둘 다 `publishedToday=0` 을 보고 둘 다 통과한다. 상한이 1 인데 2건이 나간다.
     *
     *    조건부 `updateMany` 는 **같은 후보**의 경쟁만 막는다. 다른 후보끼리는
     *    막을 것이 없었다. 그래서 격리 수준으로 막는다 —
     *    Serializable 에서 두 번째 트랜잭션은 직렬화 실패(P2034)로 되돌아간다.
     *
     * 🔴 `timeout` 은 넉넉히 둔다. 이 트랜잭션은 판정 쿼리가 여러 개다 —
     *    기본 5초로는 부하가 있을 때 판정 도중 잘린다.
     */
    return await db.$transaction(async (tx): Promise<PublishTxResult> => {
      const row = await tx.personaApprovalQueue.findUnique({
        where: { id },
        select: {
          id: true, status: true, targetPostId: true, publishedCommentId: true,
          candidateText: true, editedText: true, personaId: true,
          gateStatus: true, gateResults: true, aiToneTags: true,
          // 🔴 생성 근거 — 자동 발행 경로가 다시 검증한다 (0024 전용 컬럼)
          generatedModel: true, canonRunId: true, canonDigest: true,
          // 🔴 추가 댓글 레인 — 멱등 열쇠 · 도장(editDiff.followupStamp)
          dedupKey: true, editDiff: true,
          persona: {
            select: {
              id: true, status: true, userId: true, dailyCap: true, weeklyCap: true,
              // 🔴 생활사·No-Go 재검사에 필요하다
              identity: true, noGoTopics: true,
              // 🔴 seed 완전성 판정에 쓴다
              voiceCore: true, lifeStage: true,
            },
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
            // 🔴 생활사 판정은 본문을 읽어야 한다
            select: {
              id: true, status: true, boardType: true, title: true, content: true,
              // 🔴 무인 레인의 60분 창 · 자기 글 판정 재료 (`publishAt ?? createdAt` 이 공개 시각이다)
              publishAt: true, createdAt: true, personaId: true,
            },
          })
        : null

      // 그 글에 이미 달린 페르소나 댓글 — 내려간 것은 세지 않는다
      const personaCommentsOnPost = row.targetPostId
        ? await tx.comment.count({
            where: { postId: row.targetPostId, personaId: { not: null }, isDeleted: false },
          })
        : 0
      /**
       * 🔴 **이 Persona 가 그 글에 이미 달았는가** — 수와 별개의 질문이다.
       *    글당 5건을 연 대가로 반드시 지켜야 하는 쪽이 이것이다.
       *    막아야 할 것은 "여럿이 말하는 것" 이 아니라 "한 사람이 여럿인 척하는 것" 이다.
       */
      const personaAlreadyOnPost = row.targetPostId === null
        ? null
        : (await tx.comment.count({
            where: {
              postId: row.targetPostId, personaId: row.persona.id, isDeleted: false,
            },
          })) > 0

      // 🔴 cap 실측. 못 세면 requireCapContext 가 throw 한다 — 0 으로 보정하지 않는다
      const [usedToday, usedWeek] = await Promise.all([
        tx.personaActivityLog.count({
          where: { personaId: row.personaId, kind: 'comment', createdAt: { gte: kstDayStart(now) } },
        }),
        tx.personaActivityLog.count({
          where: { personaId: row.personaId, kind: 'comment', createdAt: { gte: weekWindowStart(now) } },
        }),
      ])

      /**
       * 🔴 **댓글 레인 재검사 — 이 트랜잭션 안에서 다시 읽는다** (2026-09-09).
       *
       *    `planPublish` 는 상태·cap·kill switch 를 본다. 그것만으로는 부족하다 —
       *    ratio 30% · 실회원(Account/providerId) · 생활사·No-Go · 저장된 Gate ·
       *    bootstrap 은 댓글 레인에만 있는 축이고, 그 계약이 fixture 에만 있고
       *    실제 발행 경로에 닿지 않으면 아무것도 지키지 못한다.
       *
       * 🔴 밖에서 한 판정은 그 순간의 사진이다. 적재와 발행 사이에 글이 지워지고,
       *    사람이 댓글을 달고, Persona 가 멈추고, Account 가 붙는다.
       */
      const commentWindowStart = new Date(now.getTime() - RATIO_WINDOW_DAYS * 86_400_000)
      const [
        windowRows, personaUser, memberCommentsOnPost, publishedTodayInTx,
        personaPriorTexts, bootstrapUsedTotal,
      ] = await Promise.all([
        tx.comment.findMany({
          where: { isDeleted: false, createdAt: { gte: commentWindowStart, lte: now } },
          select: { commentOrigin: true, personaId: true },
        }),
        tx.user.findUnique({
          where: { id: row.persona.userId },
          // 🔴 실회원 판별 정본이 요구하는 두 값을 **모두** 넣는다
          select: { providerId: true, _count: { select: { accounts: true } } },
        }),
        row.targetPostId === null ? Promise.resolve(0) : tx.comment.count({
          where: {
            postId: row.targetPostId, isDeleted: false, personaId: null,
            commentOrigin: { in: ['MEMBER', 'GUEST'] },
          },
        }),
        // 🔴 이 트랜잭션 안에서 다시 센다 — 밖에서 센 값은 다른 후보의 발행을 모른다
        tx.comment.count({
          where: {
            isDeleted: false, commentOrigin: 'PERSONA',
            createdAt: { gte: kstDayStart(now) },
          },
        }),
        // 🔴 이 Persona 의 발행된 댓글 수 — bootstrap cold-start 종료 판정에 쓴다
        tx.comment.count({
          where: { personaId: row.persona.id, isDeleted: false, commentOrigin: 'PERSONA' },
        }),
        // 🔴 bootstrap 사용량. 발행된 것 중 ⑧ 이 안 돌았던 것을 세야 정확하지만,
        //    지금은 그 표식이 없으므로 **발행 수 자체**로 보수적으로 센다(더 빨리 막힌다)
        tx.comment.count({
          where: { personaId: row.persona.id, isDeleted: false, commentOrigin: 'PERSONA' },
        }),
      ])

      const commentWindow = windowFromRows(windowRows, RATIO_WINDOW_DAYS)
      /**
       * 🔴 **단계는 env 에서 읽는다** — 호출부가 넘긴 값을 믿지 않는다.
       *
       *    옛 판은 `readRunMode` 를 썼다. 그 파서는 `bootstrap-review`·`bootstrap-auto`
       *    를 **모르는 값**으로 보고 `shadow` 로 내렸다 — 단계를 올려도 트랜잭션이
       *    "shadow 모드다" 로 막았다. 게다가 `judgeReadiness` 를 **stage 없이** 불러
       *    예산이 언제나 30% ratio 였고, 실회원 댓글이 0 인 지금 그 값은 항상 0 이다.
       *    즉 bootstrap 공개 경로는 코드상 **닫혀 있었다**. 두 축을 하나로 합친다.
       */
      const stage = readCommentStage(process.env)
      /**
       * 🔴 **예산도 트랜잭션 안에서 다시 센다.** 밖에서 센 값은 그 사이 다른 후보가
       *    가져간 자리를 모른다 — 상한 1 에서 2건이 나가던 그 자리와 같은 이유다.
       */
      const managed = stagePowers(stage.stage).budget === 'bootstrap'
        ? await countManagedPostsToday(tx, kstDayStart(now), now)
        : null
      const commentReadiness = judgeReadiness({
        window: commentWindow,
        mode: legacyRunModeFor(stage.stage),
        stage: stage.stage,
        bootstrap: {
          openSlots: managed?.openSlots ?? Number.NaN,
          publishedToday: publishedTodayInTx,
          killSwitchOff: sw?.enabled === true ? false : true,
        },
        publishedToday: publishedTodayInTx,
        killSwitchOff: sw?.enabled === true ? false : true,
      })
      const realMember = judgeRealMember({
        accountCount: personaUser?._count.accounts ?? null,
        providerId: personaUser?.providerId ?? null,
      })
      // 🔴 생활사·No-Go — 글 매칭과 **같은 함수**를 부른다
      const lifeBlocks = post === null ? [] : judgeLifeHistory(
        {
          code: row.persona.id, status: 'active', accountCount: 0, providerId: null,
          postsThisWeek: 0, daysSinceLastPost: null,
          noGoTopics: row.persona.noGoTopics,
          // 🔴 대상 글(남의 글)에는 말버릇 판정을 하지 않는다 — `judgeLifeHistory` 는 소재만 본다
          noGoExpressions: [],
          ...readIdentityLife(row.persona.identity),
        },
        readPostRequirements(post.title, post.content),
        post.title, post.content,
      )
      /**
       * 🔴 **무인 레인 규칙을 이 트랜잭션 안에서 본다** (2026-09-28).
       *    밖에서 본 "댓글 0건" 은 그 순간의 사진이다 — 다른 회차가 같은 글에 먼저 달았을 수 있다.
       *    Serializable 이므로 두 회차가 같은 0 을 읽고 둘 다 쓰면 뒤의 것이 직렬화 실패로 진다.
       */
      const autoLane = args.autoLane === true
      if (autoLane) {
        const lane = judgeAutoLane({
          stage: stage.stage,
          actor: args.actor ?? 'automation',
          queueStatus: row.status,
          nowMs: now.getTime(),
          postPublishedAtMs: post === null ? null : (post.publishAt ?? post.createdAt).getTime(),
          personaCommentsOnPost: row.targetPostId === null ? null : personaCommentsOnPost,
          postAuthorPersonaId: post === null ? undefined : post.personaId,
          candidatePersonaId: row.persona.id,
          memberCommentsOnPost: row.targetPostId === null ? null : memberCommentsOnPost,
        })
        if (!lane.ok) {
          return {
            kind: 'blocked',
            blocks: lane.blockers.map((message): PublishBlock => ({ code: 'AUTO_LANE', message })),
          }
        }
      }
      /**
       * 🔴 **추가 댓글 레인 — 이 트랜잭션 안에서 다시 읽은 사실로 판정한다** (2026-10-14).
       *    댓글·출처(Queue·ActivityLog)·신고·다른 열린 후보·오늘 추가 수·profile·그날 단계를 전부 여기서 다시 읽는다.
       */
      const followupLane = args.followupLane === true
      let followupParentId: string | null = null
      if (followupLane) {
        if (post === null) return { kind: 'blocked', blocks: [{ code: 'FOLLOWUP_LANE', message: '대상 글이 없다' }] }
        const rows = await tx.comment.findMany({
          where: { postId: post.id },
          select: {
            id: true, postId: true, parentId: true, createdAt: true, isDeleted: true, authorId: true,
            commentOrigin: true, personaId: true, operatorWriterId: true,
          },
        })
        const ids = rows.map((c) => c.id)
        const personaIds = rows.filter((c) => c.commentOrigin === 'PERSONA').map((c) => c.id)
        const dayStart = kstDayStart(now)
        const [qs, ls, reports, otherOpen, fuToday, fuPersonaToday] = await Promise.all([
          tx.personaApprovalQueue.findMany({
            where: { publishedCommentId: { in: personaIds } },
            select: { publishedCommentId: true, targetPostId: true, personaId: true, status: true, decidedBy: true, decidedAt: true },
          }),
          tx.personaActivityLog.findMany({
            where: { kind: 'comment', targetId: { in: personaIds } },
            select: { targetId: true, personaId: true, decidedBy: true, publishedAt: true },
          }),
          tx.report.findMany({ where: { commentId: { in: ids } }, select: { commentId: true } }),
          tx.personaApprovalQueue.count({
            where: { targetPostId: post.id, status: { in: [...OPEN_STATUSES] }, id: { not: row.id } },
          }),
          tx.personaApprovalQueue.count({
            where: { decidedBy: FOLLOWUP_LANE_DECIDED_BY, status: 'PUBLISHED', decidedAt: { gte: dayStart } },
          }),
          tx.personaApprovalQueue.count({
            where: { decidedBy: FOLLOWUP_LANE_DECIDED_BY, status: 'PUBLISHED', decidedAt: { gte: dayStart }, personaId: row.persona.id },
          }),
        ])
        const reported = new Set(reports.map((r) => r.commentId))
        const comments: FollowupCommentRow[] = rows.map((c) => ({
          ...c,
          // 🔴 트랜잭션은 반응을 다시 분류하지 않는다 — 대상은 도장이 가리키고, 유효성만 다시 본다
          reaction: null,
          reported: reported.has(c.id),
          provenance: c.commentOrigin !== 'PERSONA' ? null : personaCommentProvenanceOf({
            comment: { postId: c.postId, personaId: c.personaId, createdAtMs: c.createdAt.getTime(), topLevel: c.parentId === null },
            queues: qs.filter((q) => q.publishedCommentId === c.id).map((q) => ({
              targetPostId: q.targetPostId, personaId: q.personaId, status: q.status, decidedBy: q.decidedBy,
              decidedAtMs: q.decidedAt?.getTime() ?? null,
            })),
            logs: ls.filter((l) => l.targetId === c.id).map((l) => ({
              personaId: l.personaId, decidedBy: l.decidedBy, publishedAtMs: l.publishedAt?.getTime() ?? null,
            })),
          }),
        }))
        const fu = judgeFollowupPublish({
          switch: readFollowupSwitch(process.env),
          commentStage: stage.stage,
          actor: args.actor ?? 'automation',
          queueStatus: row.status,
          dedupKey: row.dedupKey,
          editDiff: row.editDiff,
          post: {
            postId: post.id, publishedAtMs: (post.publishAt ?? post.createdAt).getTime(), postStatus: post.status,
            authorPersonaId: post.personaId,
            // 🔴 Persona 가 쓴 글만 관리형이다 — 실회원·운영자 글에는 잇지 않는다
            autoManagedPost: post.personaId !== null,
            postReaction: null, comments, hasOpenQueue: false,
          },
          candidatePersonaId: row.persona.id,
          otherOpenQueue: otherOpen > 0,
          profile: readFollowupProfileRaw(process.env, (p) => readFileSync(p, 'utf-8')),
          // 🔴 그날 단계는 consumer 가 넣은 결정 env 로만 — 러너·트랜잭션은 결정 표를 직접 읽지 않는다(두 번째 판독 금지)
          runtimeStage: followupStageOf(decisionStageEnv(process.env), now).stage,
          followupsTodayInTx: fuToday,
          personaFollowupsTodayInTx: fuPersonaToday,
          nowMs: now.getTime(),
        })
        if (!fu.ok) {
          return { kind: 'blocked', blocks: fu.blockers.map((message): PublishBlock => ({ code: 'FOLLOWUP_LANE', message })) }
        }
        const st = verifyStamp(stampFromEditDiff(row.editDiff), { postId: post.id, dedupKey: row.dedupKey })
        if (!st.ok) return { kind: 'blocked', blocks: [{ code: 'FOLLOWUP_LANE', message: st.reason }] }
        followupParentId = st.stamp.parentCommentId
      }
      /**
       * 🔴 **무인 레인에서는 이 트랜잭션이 곧 기계 승인이다.** 위 판정을 통과한 PENDING 만
       *    APPROVED 로 **보고** 아래 재검사를 그대로 태운다 — 재검사를 건너뛰지 않는다.
       *    DB 의 상태는 아래 조건부 UPDATE 가 PENDING → PUBLISHED 로 한 번에 옮긴다.
       */
      const machineLane = autoLane || followupLane
      const effectiveStatus = machineLane ? 'APPROVED' : row.status
      const storedGates = readStoredGates(row.gateResults)
      /**
       * 🔴 **생성 근거를 트랜잭션 안에서 다시 본다.**
       *    적재 시점에 붙인 표식이 지금도 유효한지 — 정본이 바뀌었으면 근거도 바뀐 것이다.
       *    표식이 아예 없는 옛 행은 자동 발행 대상이 아니다(사람 승인은 가능하다).
       */
      const prov = verifyProvenance({
        stored: row.canonRunId === null ? null : {
          model: row.generatedModel, canonRunId: row.canonRunId, canonDigest: row.canonDigest,
        },
        // 🔴 **확정 정본과 대조**한다. 모양만 보면 아무 값이나 적어 둔 행이 통과한다
        canon: readConfirmedSelection().canon,
      })
      const commentCheck = recheckBeforePublish({
        postStatus: post?.status ?? null,
        personaActive: row.persona.status === 'active',
        personaRealMember: realMember.real,
        personaCommentsOnPost,
        personaAlreadyOnPost,
        memberCommentsOnPost,
        // 🔴 **총 상한**을 넘긴다. 남은 수량은 트랜잭션이 사용량으로 다시 뺀다
        allowanceCap: commentReadiness.allowance.cap,
        stage: stage.stage,
        publishedTodayInTx,
        lifeConflict: lifeBlocks.length > 0,
        gates: storedGates,
        gateStatus: row.gateStatus,
        // 🔴 호출자 주장이 없으므로 저장된 Gate 모양으로만 판정한다
        isBootstrap: false,
        queueStatus: effectiveStatus as QueueStatus,
        publishedCommentId: row.publishedCommentId,
        // 🔴 주체. 생략되면 automation 으로 본다
        actor: args.actor ?? 'automation',
        // 🔴 생성 근거를 트랜잭션 안에서 **확정 정본과 대조**한다
        provenanceOk: prov.ok,
        provenanceReason: prov.reason,
        // 🔴 bootstrap governor 입력 — 사람 수동 발행일 때 다시 본다
        bootstrapPriorTextCount: personaPriorTexts,
        bootstrapUsedTotal: bootstrapUsedTotal,
        seedComplete: row.persona.identity !== null && row.persona.voiceCore !== null
          && row.persona.lifeStage !== null && row.persona.lifeStage.trim() !== '',
      })
      if (!commentCheck.ok) {
        return {
          kind: 'blocked',
          blocks: commentCheck.blockers.map((message): PublishBlock => ({ code: 'COMMENT_RECHECK', message })),
        }
      }

      const plan = planPublish({
        candidate: {
          status: effectiveStatus as CandidateStatus,
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
          // 🔴 추가 댓글 답글만 부모가 있다 — 첫 댓글 · 사람 발행은 언제나 최상위다
          ...(followupLane && followupParentId !== null ? { parentId: followupParentId } : {}),
        },
        select: { id: true },
      })

      // ── ② Queue ──
      // 🔴 조건부 UPDATE. 읽은 뒤 쓰는 사이에 누가 먼저 발행했으면 0건이 되어 롤백한다
      /**
       * 🔴 **`EDITED` 도 사람이 승인한 것이다** (2026-09-09 정정).
       *
       *    재검사는 `APPROVED`·`EDITED` 를 둘 다 허용하는데 여기 `updateMany` 는
       *    `APPROVED` 만 봤다. 그래서 수정 승인본은 판정을 통과하고도
       *    `count === 0` 으로 `QUEUE_RACE` 를 던져 **영원히 발행되지 않았다** —
       *    경쟁이 아니라 상태 불일치였는데 경쟁 오류로 보고됐다.
       *
       * 🔴 조건부 UPDATE 의 목적은 그대로다 — 읽은 뒤 쓰는 사이에 누가 먼저 발행했으면 0 건이 된다.
       */
      const updated = await tx.personaApprovalQueue.updateMany({
        // 🔴 무인 레인은 PENDING 에서 바로 간다 — 사람 승인 행(APPROVED·EDITED)을 이 경로로 잡지 않는다
        where: machineLane
          ? { id: row.id, status: 'PENDING', publishedCommentId: null }
          : {
            id: row.id,
            status: { in: ['APPROVED', 'EDITED'] },
            publishedCommentId: null,
          },
        data: {
          status: 'PUBLISHED', publishedCommentId: comment.id,
          // 🔴 누가 결정했는가 — 기계 결정은 decidedBy 로만 구분된다
          ...(autoLane ? { decidedBy: AUTO_LANE_DECIDED_BY, decidedAt: now } : {}),
          ...(followupLane ? { decidedBy: FOLLOWUP_LANE_DECIDED_BY, decidedAt: now } : {}),
        },
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
          decidedBy: autoLane ? AUTO_LANE_ACTIVITY_DECIDED_BY : followupLane ? FOLLOWUP_LANE_ACTIVITY_DECIDED_BY : 'operator',
          publishedAt: now,
        },
      })

      return {
        kind: 'published',
        commentId: comment.id,
        postId: post.id,
        boardType: post.boardType,
      }
    }, {
      isolationLevel: 'Serializable',
      maxWait: TX_MAX_WAIT_MS,
      timeout: TX_TIMEOUT_MS,
    })
  } catch (err) {
    if (err instanceof Error && err.message === QUEUE_RACE) {
      return { kind: 'error', message: '이미 발행된 후보입니다. 새로고침해 주세요.' }
    }
    /**
     * 🔴 **직렬화 실패는 실패다.** 재시도하지 않는다.
     *
     *    P2034 는 "다른 트랜잭션이 먼저 자리를 가져갔다" 는 뜻이다.
     *    여기서 재시도하면 상한을 넘기려고 다시 시도하는 셈이 된다 —
     *    막으려던 바로 그 일이다. 이 회차는 그냥 지고, 공개 write 는 남지 않는다.
     */
    if (isSerializationConflict(err)) {
      return { kind: 'error', message: '다른 발행이 먼저 진행됐습니다. 잠시 후 다시 확인해 주세요.' }
    }
    // 🔴 예외 원문을 호출부로 흘리지 않는다
    return { kind: 'error', message: '발행하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }
}
