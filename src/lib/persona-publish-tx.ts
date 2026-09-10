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
  },
): Promise<PublishTxResult> {
  const id = (args.id ?? '').trim()
  if (id === '') return { kind: 'error', message: '대상을 찾을 수 없습니다.' }
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
            select: { id: true, status: true, boardType: true, title: true, content: true },
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
          ...readIdentityLife(row.persona.identity),
        },
        readPostRequirements(post.title, post.content),
        post.title, post.content,
      )
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
        queueStatus: row.status as QueueStatus,
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
        where: {
          id: row.id,
          status: { in: ['APPROVED', 'EDITED'] },
          publishedCommentId: null,
        },
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
