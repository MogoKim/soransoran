/**
 * 🔴 **단계의 하루 판정 — 양을 늘려도 결이 유지되는가를 그날 실제로 일어난 일로 잰다**
 *
 *    KST 날짜 D · 단계 S 의 PASS = **무결성 0건** ∧ **수** ∧ **결**. 숫자는 전부 `ladder-table` 에서 읽는다.
 *
 *    · **수**   자동 READY 로 만들어져 무인 러너가 낸 글(자동 target) ≥ 목표 편수 × `countRatio`.
 *               사람이 승인한 글은 정상 발행일 수 있지만 자동 물량으로는 0건이다.
 *    · **결**   ① 첫 댓글이 창 안에 달린 글의 비율 ② 글당 Persona 댓글 평균(그날 글에 효력이 있던 목표 평균 × `countRatio`)
 *               ③ 글쓴이 아닌 Persona 3명 이상이 말한 글의 비율 ④ 수집에서 공개까지 걸린 시간의 중앙값.
 *               **비율로 잰다** — 글 한 편의 누락이 하루를 무효로 만들지 않는다. 창이 아직 닫히지 않은 글은 분모에서 빠진다.
 *    · **무결성** 숫자를 믿을 수 없게 만드는 것은 한 건이어도 그대로 막는다: 출처가 깨진 댓글 · 사람이 자동 글에 단
 *               Persona 댓글 · 큐/글/발행 기록 1:1 불일치 · 상한 초과 · release 도장 · 장부 결함 · 감사 표본 부족.
 *
 *    여기서 보지 않는 것(다른 곳이 같은 판정을 한다 — 두 번 막지 않는다):
 *      · 감사 표본의 결함·시한·재시도 → 브레이크 품질 축(`stage-controller.qualitySignalOf`)이 같은 해소 판정으로 그날 감속한다
 *      · 공급 회차의 성패           → 양은 수가 재고, 당일 러너 결함은 브레이크 오류 축이 본다
 *      · 글쓴이 겹침                → 발행 트랜잭션의 글쓴이 간격 규칙
 *
 * 🔴 PASS 가 아니면(FAIL · UNKNOWN) **올리지 않을 뿐**이다. 공개 단계를 내리지 않는다(`stage-ladder`).
 * 🔴 순수 함수다 — DB · 파일 · 시각 조회 0. 모으기는 `stage-evidence-repo` 가 한다.
 * 🔴 판정 결과에 원문·닉네임·id 를 담지 않는다 — 코드와 개수만.
 */
import { profileOf, type RuntimeStage } from './scale-profile'
import { DECISION_WRITER, type ValidatedStageDecision } from './stage-decision-contract'
import {
  AUTO_FIRST_COMMENT_WINDOW_MS, AUTO_LANE_DECIDED_BY, AUTO_LANE_ACTIVITY_DECIDED_BY,
} from './persona-comment-auto-lane'
import {
  otherPersonaTurnsExceed, PERSONA_AUTHOR_FOLLOWUPS_PER_POST_MAX, PERSONA_COMMENTS_PER_POST_MAX, PERSONA_REPLY_CHAIN_MAX,
} from './persona-target-rules'
import { THREAD_DEADLINE_MS, threadMeanSizeAt } from './persona-thread-target'
import { auditTarget } from './auto-ready-v2'
import type { Health } from './ops-status'
import { judgeSupplyCostEnvelope, usesSupplyCostEnvelope, type SupplyCostEvidence } from './supply-cost-envelope'
import { LADDER_RULE, commentDepthFloorOf, countFloorOf, ladderRowOf } from './ladder-table'

/**
 * 🔴 **무결성 코드** — 하나라도 있으면 그날 숫자를 믿을 수 없다. 비율로 풀지 않는다.
 *    `…_UNKNOWN` · `READ_ERROR` · `AUDIT_COVERAGE_SHORT` 는 "몰라서"다(`UNKNOWN_CODES`) — FAIL 코드가 없을 때 UNKNOWN 이 된다.
 */
export const INTEGRITY_CODES = [
  'READ_ERROR',
  'DECISION_MISSING', 'DECISION_NOT_CONTROLLER', 'DECISION_STAGE_MISMATCH',
  // 그날 전체 발행(사람 글 포함)이 단계 상한을 넘었다
  'PUBLISH_OVER',
  'DUP_QUEUE', 'DUP_PUBLISH_LOG', 'UNLOGGED_PUBLISH', 'PUBLISH_LOG_ORPHAN',
  // 댓글 — 첫 댓글·추가 댓글 어느 레인이든 출처 연결이 깨졌다 / 자동 글에 사람이 단 Persona 댓글(canon §6)
  'COMMENT_PROVENANCE_BROKEN', 'COMMENT_MANUAL_PERSONA', 'COMMENT_SELF', 'DUP_COMMENT',
  // 누가 결정했는지 모르는 글 — 분모를 모른다 / 판정이 끝난 감사 표본이 기대보다 적다 — 품질을 보지 못한 날
  'AUDIT_TARGET_UNKNOWN', 'AUDIT_COVERAGE_SHORT',
  'RELEASE_CONTRACT_MISSING', 'STALE_RELEASE',
  'COST_BAD', 'COST_UNKNOWN',
] as const
/** 🔴 **양의 코드** — 비율이 통과선에 못 미쳤다. `TEXTURE_UNKNOWN` 은 창이 닫힌 글이 너무 적어 결을 잴 수 없다는 뜻이다 */
export const QUANTITY_CODES = [
  'PUBLISH_SHORT', 'FIRST_COMMENT_SHORT', 'COMMENT_DEPTH_SHORT', 'THREE_VOICES_SHORT', 'COLLECT_LATENCY_SHORT',
  'TEXTURE_UNKNOWN',
] as const
export const STAGE_EVIDENCE_CODES = [...INTEGRITY_CODES, ...QUANTITY_CODES] as const
export type StageEvidenceCode = (typeof STAGE_EVIDENCE_CODES)[number]

const UNKNOWN_CODES: readonly StageEvidenceCode[] = [
  'READ_ERROR', 'AUDIT_TARGET_UNKNOWN', 'AUDIT_COVERAGE_SHORT', 'COST_UNKNOWN', 'TEXTURE_UNKNOWN',
]

export type EvidenceVerdictKind = 'PASS' | 'FAIL' | 'UNKNOWN'

export type EvidenceVerdictFor<S extends string> = {
  readonly kstDate: string
  readonly stage: S
  readonly verdict: EvidenceVerdictKind
  /** 코드만 — 중복 없이 정본 순서 */
  readonly codes: readonly StageEvidenceCode[]
  /** 개수와 비율만 — 사람이 어느 칸이 모자랐는지 본다 */
  readonly counts: Readonly<Record<string, number>>
  /**
   * 대화 감사(추가 댓글의 구조) — 단계 판정(`verdict`)에 들어가지 않는다. 사실을 못 읽었으면 없다.
   * 추가 댓글의 **출처 깨짐**만은 판정 숫자(글당 댓글 · 타인 3명)의 근거라 위 `COMMENT_PROVENANCE_BROKEN` 으로도 막는다.
   */
  readonly conversation?: ConversationAudit
}
export type StageEvidenceVerdict = EvidenceVerdictFor<RuntimeStage>


/**
 * 🔴 **자동 첫 댓글 출처** (2026-10-11 Batch A3 · 스키마 변경 0).
 *    · `auto`   Comment ↔ PersonaApprovalQueue(`publishedCommentId`) ↔ PersonaActivityLog(`kind=comment` · `targetId=Comment.id`)
 *               세 행이 **한 줄씩** 있고 무인 레인 표식 · 대상 글 · Persona · 시각이 모두 맞는다
 *    · `none`   자동 표식이 어디에도 없다 — 사람(운영자) 발행이거나 연결 행이 없다. 🔴 증거 0건(실패는 아니다)
 *    · `broken` 자동 표식이 한 곳이라도 있는데 나머지가 빠졌거나 · 겹치거나 · 어긋난다 — 🔴 FAIL
 */
export type CommentProvenance = 'auto' | 'none' | 'broken'

/**
 * 🔴 **시각 일치의 허용 폭.** 무인 레인 트랜잭션은 Queue `decidedAt` 과 ActivityLog `publishedAt` 에 **같은 값**(`now`)을 쓴다 —
 *    둘은 정확히 같아야 한다. Comment `createdAt` 은 DB 기본값이라 그 값과 다를 수 있다:
 *    회차 시각(`now`)은 회차 시작에 한 번 정해지고 적재 뒤 sweep 이 같은 값으로 발행한다 — 그래서 댓글이 `now` 보다
 *    늦을 수는 있어도 첫 댓글 창(60분)을 넘을 수는 없다. 앞쪽은 앱·DB 시계 차이만큼만 허용한다.
 */
export const AUTO_COMMENT_CLOCK_SKEW_MS = 60_000

export type CommentLinkFacts = {
  comment: { postId: string; personaId: string | null; createdAtMs: number; topLevel: boolean }
  /** `publishedCommentId = Comment.id` 인 Queue 행 전부 */
  queues: readonly { targetPostId: string | null; personaId: string; status: string; decidedBy: string | null; decidedAtMs: number | null }[]
  /** `kind=comment · targetId = Comment.id` 인 ActivityLog 행 전부 */
  logs: readonly { personaId: string; decidedBy: string | null; publishedAtMs: number | null }[]
}

/** 🔴 순수 — 세 행이 같은 사건을 말하는가 */
export function commentProvenanceOf(f: CommentLinkFacts): CommentProvenance {
  const autoMarked = f.queues.some((q) => (q.decidedBy ?? '').trim() === AUTO_LANE_DECIDED_BY)
    || f.logs.some((l) => (l.decidedBy ?? '').trim() === AUTO_LANE_ACTIVITY_DECIDED_BY)
  // 🔴 겹침은 표식과 무관하게 깨짐이다 — 한 댓글에 두 결정 · 두 기록은 같은 사건일 수 없다
  if (f.queues.length > 1 || f.logs.length > 1) return 'broken'
  if (!autoMarked) return 'none'
  const q = f.queues[0]
  const l = f.logs[0]
  if (q === undefined || l === undefined) return 'broken'
  if (q.status !== 'PUBLISHED' || (q.decidedBy ?? '').trim() !== AUTO_LANE_DECIDED_BY) return 'broken'
  if ((l.decidedBy ?? '').trim() !== AUTO_LANE_ACTIVITY_DECIDED_BY) return 'broken'
  const c = f.comment
  if (c.personaId === null || q.personaId !== c.personaId || l.personaId !== c.personaId) return 'broken'
  if (q.targetPostId !== c.postId) return 'broken'
  if (!c.topLevel) return 'broken'
  if (q.decidedAtMs === null || l.publishedAtMs === null || q.decidedAtMs !== l.publishedAtMs) return 'broken'
  const lag = c.createdAtMs - q.decidedAtMs
  if (lag < -AUTO_COMMENT_CLOCK_SKEW_MS || lag > AUTO_FIRST_COMMENT_WINDOW_MS) return 'broken'
  return 'auto'
}

/**
 * 🔴 **추가 댓글(followup) 표식 — 첫 댓글 표식과 다른 값이다** (2026-10-13 · PR #704 E1).
 *    첫 댓글 뒤 선택적 추가 댓글 0~9건(`persona-comment-followup`)이 Queue `decidedBy` · ActivityLog `decidedBy` 에 남긴다.
 *    🔴 단계 증거가 이 값을 알아야 추가 댓글을 첫 댓글 증거 · 수동 Persona 댓글 · 상한 어디에도 섞지 않는다 —
 *       그래서 정본은 증거 쪽(여기)이다. 추가 댓글 레인은 이 상수를 가져다 쓴다.
 */
export const FOLLOWUP_LANE_DECIDED_BY = 'machine:persona-comment-followup'
export const FOLLOWUP_LANE_ACTIVITY_DECIDED_BY = 'auto-followup'

/**
 * 🔴 **Persona 댓글 한 건의 출처 — 첫 댓글 축과 추가 댓글 축을 나눈다** (2026-10-13).
 *    · `auto` · `none` · `broken`  `commentProvenanceOf` 그대로 — 단계 증거(첫 댓글 · 상한 · 출처 FAIL)가 본다
 *    · `followup`                 추가 댓글 표식만 있고 세 행이 한 사건이다 — 🔴 단계 증거의 분자·상한 밖
 *    · `followup-broken`          추가 댓글 표식만 있는데 연결이 깨졌다 — 🔴 대화 감사 FAIL · 단계 증거 밖
 */
export type PersonaCommentProvenance = CommentProvenance | 'followup' | 'followup-broken'

/** 🔴 추가 댓글 축인가 — 단계 증거는 이 둘을 세지 않는다 */
export const isFollowupProvenance = (p: PersonaCommentProvenance): p is 'followup' | 'followup-broken' =>
  p === 'followup' || p === 'followup-broken'

/**
 * 🔴 순수 — 첫 댓글 표식이 **한 곳이라도** 있으면 첫 댓글 판정(`commentProvenanceOf`)이 정한다.
 *    두 레인 표식이 섞인 행은 거기서 `broken` 이 된다 — 🔴 추가 댓글 표식으로 첫 댓글 출처 FAIL 을 피할 수 없다.
 *    추가 댓글 표식만 있을 때만 추가 댓글 축으로 간다. 표식이 없으면 `none`(수동) · 겹침이면 `broken` 그대로다.
 */
export function personaCommentProvenanceOf(f: CommentLinkFacts): PersonaCommentProvenance {
  const firstMarked = f.queues.some((q) => (q.decidedBy ?? '').trim() === AUTO_LANE_DECIDED_BY)
    || f.logs.some((l) => (l.decidedBy ?? '').trim() === AUTO_LANE_ACTIVITY_DECIDED_BY)
  const followupMarked = f.queues.some((q) => (q.decidedBy ?? '').trim() === FOLLOWUP_LANE_DECIDED_BY)
    || f.logs.some((l) => (l.decidedBy ?? '').trim() === FOLLOWUP_LANE_ACTIVITY_DECIDED_BY)
  if (firstMarked || !followupMarked) return commentProvenanceOf(f)
  if (f.queues.length !== 1 || f.logs.length !== 1) return 'followup-broken'
  const q = f.queues[0]!
  const l = f.logs[0]!
  if (q.status !== 'PUBLISHED' || (q.decidedBy ?? '').trim() !== FOLLOWUP_LANE_DECIDED_BY) return 'followup-broken'
  if ((l.decidedBy ?? '').trim() !== FOLLOWUP_LANE_ACTIVITY_DECIDED_BY) return 'followup-broken'
  const c = f.comment
  if (c.personaId === null || q.personaId !== c.personaId || l.personaId !== c.personaId) return 'followup-broken'
  if (q.targetPostId !== c.postId) return 'followup-broken'
  if (q.decidedAtMs === null || l.publishedAtMs === null || q.decidedAtMs !== l.publishedAtMs) return 'followup-broken'
  // 🔴 추가 댓글은 60분 창이 없다(시간차로 이어 붙는다) — 앞쪽 시계 차이만 본다
  if (c.createdAtMs - q.decidedAtMs < -AUTO_COMMENT_CLOCK_SKEW_MS) return 'followup-broken'
  return 'followup'
}

/** 🔴 대화 감사 코드 — 단계 증거 코드(`STAGE_EVIDENCE_CODES`)와 섞지 않는다 */
export const CONVERSATION_AUDIT_CODES = [
  'FOLLOWUP_PROVENANCE_BROKEN', 'FOLLOWUP_WITHOUT_FIRST', 'FOLLOWUP_OVER_TOTAL', 'FOLLOWUP_DUP_PERSONA', 'FOLLOWUP_SELF',
  'FOLLOWUP_TARGET_INVALID', 'FOLLOWUP_TARGET_REUSED', 'FOLLOWUP_CHAIN_OVER_DEPTH',
] as const
export type ConversationAuditCode = (typeof CONVERSATION_AUDIT_CODES)[number]

export type ConversationAudit = {
  readonly verdict: 'PASS' | 'FAIL'
  readonly codes: readonly ConversationAuditCode[]
  readonly counts: Readonly<Record<string, number>>
}

/**
 * 대화 감사용 시간순 장부. 현재 화면에 보이는 살아 있는 Persona 댓글과 섞지 않는다.
 * 삭제된 댓글도 발행 당시의 화자·대상·사슬 사실은 남기고, 나중에 생긴 신고·답글이
 * 이미 정상 발행된 대화를 소급해서 실패로 바꾸지 않게 시각을 보존한다.
 */
export type EvidenceConversationComment = {
  id: string
  personaId: string | null
  parentId: string | null
  commentOrigin: string
  isDeleted: boolean
  createdAtMs: number
  /** 첫 신고 시각. null 은 신고 없음이다. */
  reportedAtMs: number | null
  /** Persona 댓글만 자동 출처를 갖는다. */
  provenance: PersonaCommentProvenance | null
}

/**
 * 🔴 **대화 감사 — 추가 댓글만 본다. 단계 증거와 따로 판정한다** (2026-10-13).
 *    추가 댓글의 결함은 여기서 FAIL 이지만 🔴 그 글의 첫 댓글 성공을 소급해서 지우지 않는다(단계 증거는 그대로).
 *    · 출처가 깨진 추가 댓글                                           FOLLOWUP_PROVENANCE_BROKEN
 *    · 자동 첫 댓글(`auto`)이 없는 글 · 첫 댓글보다 앞선 추가 댓글         FOLLOWUP_WITHOUT_FIRST
 *    · 그 글의 Persona 댓글 총수 > 장기 정본 `PERSONA_COMMENTS_PER_POST_MAX` FOLLOWUP_OVER_TOTAL
 *    · 글쓴이가 아닌 Persona 가 한 글에 두 번 넘게 말했거나 새 댓글을 두 번 달았다  FOLLOWUP_DUP_PERSONA
 *    · 글쓴이의 추가 댓글이 최상위이거나 승인 상한을 넘음                  FOLLOWUP_SELF
 *    · 발행 시점에 대상이 없거나 Persona가 아니거나 이미 신고됨                 FOLLOWUP_TARGET_INVALID
 *    · 발행 시점까지 한 댓글을 둘 이상이 답글 대상으로 소비함                  FOLLOWUP_TARGET_REUSED
 *    · 답글 사슬이 정본 상한을 넘음                                         FOLLOWUP_CHAIN_OVER_DEPTH
 *    🔴 추가 댓글이 하나도 없으면 PASS 다(대화를 잇지 않는 글이 정상이다).
 */
export function judgeConversationAudit(posts: readonly EvidencePost[]): ConversationAudit {
  const codes = new Set<ConversationAuditCode>()
  let followups = 0
  let broken = 0
  let postsWithFollowup = 0
  let invalidTargets = 0
  let reusedTargets = 0
  let overDepth = 0
  for (const p of posts) {
    const liveFollowups = p.personaComments.filter((c) => isFollowupProvenance(c.provenance))
    const history = p.conversationComments
    if (history === undefined) {
      if (liveFollowups.length === 0) continue
      invalidTargets += 1
      codes.add('FOLLOWUP_TARGET_INVALID')
      followups += liveFollowups.length
      postsWithFollowup += 1
      continue
    }
    const personaHistory = history.filter((c) => c.commentOrigin === 'PERSONA')
    const fu = personaHistory.filter((c) => c.provenance !== null && isFollowupProvenance(c.provenance))
    if (fu.length === 0) continue
    followups += fu.length
    postsWithFollowup += 1
    broken += fu.filter((c) => c.provenance === 'followup-broken').length
    const firsts = personaHistory.filter((c) => c.provenance === 'auto')
    const firstAt = firsts.length === 0 ? null : Math.min(...firsts.map((c) => c.createdAtMs))
    if (firstAt === null || fu.some((c) => c.createdAtMs < firstAt)) codes.add('FOLLOWUP_WITHOUT_FIRST')
    if (p.personaComments.length > PERSONA_COMMENTS_PER_POST_MAX) codes.add('FOLLOWUP_OVER_TOTAL')
    // 🔴 글쓴이 아닌 사람은 한 글에 두 번까지 — 한 번을 넘는 말은 답글이어야 한다(`otherPersonaTurnsExceed`)
    const turns = new Map<string, EvidenceConversationComment[]>()
    for (const c of personaHistory) {
      if (c.personaId !== null && c.personaId !== p.authorPersonaId) turns.set(c.personaId, [...(turns.get(c.personaId) ?? []), c])
    }
    if (fu.some((c) => c.personaId === null) || [...turns.values()].some((mine) =>
      otherPersonaTurnsExceed(mine.map((c) => ({ isReply: c.parentId !== null }))))) codes.add('FOLLOWUP_DUP_PERSONA')
    // 🔴 삭제된 과거 턴도 셌다. 삭제로 글쓴이 3회 상한이 다시 열리면 안 된다.
    const own = p.authorPersonaId === null ? [] : fu.filter((c) => c.personaId === p.authorPersonaId)
    if (own.some((c) => c.parentId === null) || own.length > PERSONA_AUTHOR_FOLLOWUPS_PER_POST_MAX) codes.add('FOLLOWUP_SELF')

    /**
     * 🔴 발행 트랜잭션만 믿지 않는다. 운영 DB가 우회 write·옛 코드·부분 복구로 깨졌어도
     *    사후 대화 감사가 같은 구조 계약을 다시 검출해야 한다.
     */
    const byId = new Map<string, EvidenceConversationComment>()
    for (const c of history) {
      if (c.id.trim() === '' || byId.has(c.id)) {
        invalidTargets += 1
        codes.add('FOLLOWUP_TARGET_INVALID')
        continue
      }
      byId.set(c.id, c)
    }
    for (const c of fu) {
      if (c.parentId === null) continue
      const parent = byId.get(c.parentId)
      if (parent === undefined || parent.commentOrigin !== 'PERSONA' || parent.createdAtMs > c.createdAtMs
        || (parent.reportedAtMs !== null && parent.reportedAtMs <= c.createdAtMs)) {
        invalidTargets += 1
        codes.add('FOLLOWUP_TARGET_INVALID')
      } else if (c.personaId !== null && parent.personaId === c.personaId) {
        codes.add('FOLLOWUP_SELF')
      }
      // 🔴 이 댓글이 발행된 시점까지만 본다. 나중에 실회원이 같은 대상에 답해도 과거 발행은 정상이다.
      const usesAtPublish = history.filter((x) => x.parentId === c.parentId && x.createdAtMs <= c.createdAtMs).length
      if (usesAtPublish > 1) {
        reusedTargets += 1
        codes.add('FOLLOWUP_TARGET_REUSED')
      }

      let depth = 1
      let cursor: EvidenceConversationComment | undefined = c
      const visited = new Set<string>()
      while (cursor !== undefined && cursor.parentId !== null) {
        if (visited.has(cursor.id)) {
          invalidTargets += 1
          codes.add('FOLLOWUP_TARGET_INVALID')
          break
        }
        visited.add(cursor.id)
        cursor = byId.get(cursor.parentId)
        if (cursor === undefined) {
          invalidTargets += 1
          codes.add('FOLLOWUP_TARGET_INVALID')
          break
        }
        depth += 1
        if (depth > PERSONA_REPLY_CHAIN_MAX) {
          overDepth += 1
          codes.add('FOLLOWUP_CHAIN_OVER_DEPTH')
          break
        }
      }
    }
  }
  if (broken > 0) codes.add('FOLLOWUP_PROVENANCE_BROKEN')
  const ordered = CONVERSATION_AUDIT_CODES.filter((c) => codes.has(c))
  return {
    verdict: ordered.length > 0 ? 'FAIL' : 'PASS',
    codes: ordered,
    counts: {
      followupComments: followups, followupBroken: broken, postsWithFollowup,
      followupInvalidTargets: invalidTargets, followupReusedTargets: reusedTargets, followupOverDepth: overDepth,
    },
  }
}

/** 누가 발행을 결정했나 — 자동 target 인지를 가른다 */
export type PostDecider = 'auto' | 'human' | 'unknown'

/** 그날 발행된 글 하나 — 🔴 제목·본문 없음 */
export type EvidencePost = {
  /** 판정 안에서 감사 표본 소속을 대조하는 데만 쓴다 — 판정 결과에는 싣지 않는다 */
  postId: string
  /** 이 글을 만든 PUBLISHED Queue 행 — 없으면 null */
  queueId: string | null
  /** 공개 시각(발행 기록 시각) — 첫 댓글 창·대화 마감·수집→공개의 기준 */
  publishedAtMs: number
  /** 원천을 수집한 시각(큐의 원문 증거 `capturedAt`) — 못 읽었으면 없다 */
  capturedAtMs?: number | null
  /** 무인 러너 표식이 있는 발행 기록인가 */
  unattended: boolean
  /** 이 글을 가리키는 Queue 행 수 — 1 이어야 한다 */
  queueRows: number
  /** 이 글의 발행 기록(ActivityLog kind=post) 수 — 1 이어야 한다 */
  publishLogs: number
  /** 글을 쓴 Persona — 없으면 null */
  authorPersonaId: string | null
  /** Queue 결정자 — 자동 READY(`auto`)이고 무인 발행인 글만 자동 target 이다 */
  decider: PostDecider
  /** 이 글의 살아 있는 Persona 댓글 전부 — `provenance` 는 `personaCommentProvenanceOf` 결과다 */
  personaComments: readonly {
    personaId: string | null
    createdAtMs: number
    topLevel: boolean
    provenance: PersonaCommentProvenance
  }[]
  /** 대화 감사용 전체 시간순 장부. 회원·운영자·삭제된 댓글도 포함한다 */
  conversationComments?: readonly EvidenceConversationComment[]
  /** 발행 트랜잭션이 남긴 release 도장 상태(`releaseStampStatusOf`). Queue 가 없으면 `MISSING` */
  release: 'STAMPED_ELIGIBLE' | 'MISSING' | 'STALE'
}

/** 단계 칸만 일반화한 사실 묶음 — 결정 칸은 `release` 를 문자열로 받는다 */
export type EvidenceFactsFor<S extends string> = Omit<StageEvidenceFacts, 'stage' | 'decision'> & {
  stage: S
  decision: { kstDate: string; release: string; decidedBy: string } | null
}

export type StageEvidenceFacts = {
  kstDate: string
  stage: RuntimeStage
  /** D 의 저장된 결정 — 없거나 검증에 떨어졌으면 null */
  decision: Pick<ValidatedStageDecision, 'kstDate' | 'release' | 'decidedBy'> | null
  /**
   * 사실을 읽은 시각. 첫 댓글 창·대화 마감이 이 시각까지 닫힌 글만 결의 분모에 든다 —
   * 방금 나간 글에 "아직 댓글이 없다"를 미달로 세지 않는다.
   */
  readAtMs: number
  posts: readonly EvidencePost[]
  /** Post 가 없는 발행 기록 · targetId 가 비었거나 Queue 가 없는 기록 */
  orphanPublishLogs: number
  /** Queue 로 발행된 그날 글인데 발행 기록이 없는 것 */
  unloggedPublishes: number
  audits: {
    /** 그날 고른 감사 + 그날 글의 감사 — postId·queueId 로 표본 소속을 대조한다 */
    rows: readonly { postId: string; queueId: string; judged: boolean }[]
  }
}

export type EvidenceSideSignals = {
  /** 그날 댓글·감사 장부 판정(정본 `judgeCost`). 공급은 아래 envelope 하나로 본다 */
  cost: readonly { lane: 'comment' | 'audit'; name: string; health: Health }[]
  /** 그날 공급 장부의 중대 무결성과 자연 회차 비용 envelope. 운영 호출에서 필수다 */
  supplyCostEvidence: SupplyCostEvidence | null
}

/** D 의 하루 판정. 못 읽었으면 `facts=null` → UNKNOWN */
export function judgeStageEvidence(
  kstDate: string, stage: RuntimeStage,
  facts: StageEvidenceFacts | null, side: EvidenceSideSignals | null,
): StageEvidenceVerdict {
  return judgeEvidenceForTarget(kstDate, stage, profileOf(stage).dailyTarget, facts, side)
}

const isAutoTarget = (p: EvidencePost): boolean => p.decider === 'auto' && p.unattended
const round2 = (v: number): number => Math.round(v * 100) / 100
const medianOf = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/**
 * 단계 이름과 하루 목표를 받는 판정 본체. 목표 편수는 호출부가 정본 프로필에서 꺼내 넘기고,
 * 비율과 창은 `ladder-table` 에서 읽는다 — 여기서 숫자를 만들지 않는다.
 */
export function judgeEvidenceForTarget<S extends string>(
  kstDate: string, stage: S, target: number,
  facts: EvidenceFactsFor<string> | null, side: EvidenceSideSignals | null,
): EvidenceVerdictFor<S> {
  const codes = new Set<StageEvidenceCode>()
  const counts: Record<string, number> = {}
  const row = ladderRowOf(stage)
  if (facts === null || row === null) codes.add('READ_ERROR')
  else {
    // 다른 날·다른 단계의 사실로 판정하지 않는다
    if (facts.kstDate !== kstDate || facts.stage !== stage) codes.add('READ_ERROR')
    const d = facts.decision
    if (d === null || d.kstDate !== kstDate) codes.add('DECISION_MISSING')
    else {
      if (d.decidedBy !== DECISION_WRITER) codes.add('DECISION_NOT_CONTROLLER')
      if (d.release !== stage) codes.add('DECISION_STAGE_MISMATCH')
    }

    // ── 수
    const autoTargets = facts.posts.filter(isAutoTarget)
    const n = autoTargets.length
    counts.target = target
    counts.countFloor = countFloorOf(target)
    counts.published = facts.posts.length
    counts.autoTargets = n
    counts.humanApproved = facts.posts.filter((p) => p.decider === 'human').length
    if (n < counts.countFloor) codes.add('PUBLISH_SHORT')
    if (facts.posts.length > target) codes.add('PUBLISH_OVER')

    // ── 무결성: 1:1 · 댓글 출처 · 사람 손
    let brokenProv = 0
    let manualOnTargets = 0
    for (const p of facts.posts) {
      if (p.queueRows !== 1) codes.add('DUP_QUEUE')
      if (p.publishLogs !== 1) codes.add('DUP_PUBLISH_LOG')
      brokenProv += p.personaComments.filter((c) => c.provenance === 'broken' || c.provenance === 'followup-broken').length
      // 첫 댓글 레인(자동 · 수동 · 깨진 출처)에서는 같은 Persona 두 번 · 글쓴이 자기 댓글이 있을 수 없다
      const firstLane = p.personaComments.filter((c) => !isFollowupProvenance(c.provenance))
      const byPersona = new Map<string, number>()
      for (const c of firstLane) byPersona.set(c.personaId ?? '(없음)', (byPersona.get(c.personaId ?? '(없음)') ?? 0) + 1)
      if ([...byPersona.values()].some((k) => k > 1)) codes.add('DUP_COMMENT')
      if (p.authorPersonaId !== null && firstLane.some((c) => c.personaId === p.authorPersonaId)) codes.add('COMMENT_SELF')
      if (isAutoTarget(p)) manualOnTargets += firstLane.filter((c) => c.provenance === 'none').length
    }
    counts.commentProvenanceBroken = brokenProv
    counts.manualPersonaOnTargets = manualOnTargets
    if (brokenProv > 0) codes.add('COMMENT_PROVENANCE_BROKEN')
    if (manualOnTargets > 0) codes.add('COMMENT_MANUAL_PERSONA')
    if (facts.orphanPublishLogs > 0) codes.add('PUBLISH_LOG_ORPHAN')
    if (facts.unloggedPublishes > 0) codes.add('UNLOGGED_PUBLISH')
    if (facts.posts.some((p) => p.decider === 'unknown')) codes.add('AUDIT_TARGET_UNKNOWN')

    // ── 무결성: 감사 표본 — 판정이 끝난 표본(글 기준 · 그날 자동 target 안)이 기대만큼 있는가
    const targetKey = new Set(autoTargets.map((p) => `${p.postId}\u0000${p.queueId ?? ''}`))
    const judgedSample = new Set(facts.audits.rows
      .filter((r) => r.judged && targetKey.has(`${r.postId}\u0000${r.queueId}`)).map((r) => r.postId))
    counts.auditExpected = auditTarget(n)
    counts.auditSampled = judgedSample.size
    if (judgedSample.size < counts.auditExpected) codes.add('AUDIT_COVERAGE_SHORT')

    // ── 무결성: release 도장
    counts.releaseStamped = autoTargets.filter((p) => p.release === 'STAMPED_ELIGIBLE').length
    if (autoTargets.some((p) => p.release === 'MISSING')) codes.add('RELEASE_CONTRACT_MISSING')
    if (autoTargets.some((p) => p.release === 'STALE')) codes.add('STALE_RELEASE')

    // ── 결 — 창이 닫힌 글만 분모에 든다. 닫힌 글이 너무 적으면 모름이다
    const enough = (closed: number): boolean => closed > 0 && closed >= n * LADDER_RULE.closedShareMin
    // 비율 × 개수의 부동소수 오차로 통과선 위의 값이 미달이 되지 않게
    const below = (value: number, line: number): boolean => value < line - 1e-9
    const counted = (p: EvidencePost) => p.personaComments.filter((c) => c.provenance === 'auto' || c.provenance === 'followup')

    // ① 첫 댓글 — 최상위 · 글쓴이 아닌 Persona · 자동 출처 · 공개 뒤 창 안
    const firstClosed = autoTargets.filter((p) => p.publishedAtMs + LADDER_RULE.firstCommentWindowMs <= facts.readAtMs)
    const firstOk = firstClosed.filter((p) => p.personaComments.some((c) =>
      c.provenance === 'auto' && c.topLevel && c.personaId !== null && c.personaId !== p.authorPersonaId
      && c.createdAtMs >= p.publishedAtMs && c.createdAtMs - p.publishedAtMs <= LADDER_RULE.firstCommentWindowMs)).length
    counts.firstCommentOk = firstOk
    counts.firstCommentClosed = firstClosed.length
    if (n > 0 && !enough(firstClosed.length)) codes.add('TEXTURE_UNKNOWN')
    else if (n > 0 && below(firstOk, firstClosed.length * LADDER_RULE.firstCommentRatio)) codes.add('FIRST_COMMENT_SHORT')

    // ② 글당 댓글 · ③ 타인 3명 — 대화 마감이 지난 글
    const talkClosed = autoTargets.filter((p) => p.publishedAtMs + THREAD_DEADLINE_MS <= facts.readAtMs)
    counts.conversationClosed = talkClosed.length
    if (n > 0 && !enough(talkClosed.length)) codes.add('TEXTURE_UNKNOWN')
    else if (n > 0) {
      const total = talkClosed.reduce((sum, p) => sum + counted(p).length, 0)
      const targetMean = talkClosed.reduce((sum, p) => sum + threadMeanSizeAt(p.publishedAtMs), 0) / talkClosed.length
      const voices = talkClosed.filter((p) => new Set(counted(p)
        .map((c) => c.personaId).filter((id) => id !== null && id !== p.authorPersonaId)).size >= 3).length
      counts.personaComments = total
      counts.commentDepthAvg = round2(total / talkClosed.length)
      counts.commentDepthFloor = round2(commentDepthFloorOf(targetMean))
      counts.threeVoicesPosts = voices
      if (below(total / talkClosed.length, commentDepthFloorOf(targetMean))) codes.add('COMMENT_DEPTH_SHORT')
      if (below(voices, talkClosed.length * row.threeVoicesRatio)) codes.add('THREE_VOICES_SHORT')
    }

    // ④ 수집→공개 — `gate` 가 꺼져 있는 동안은 재고 찍기만 한다
    const lags = autoTargets.flatMap((p) => (
      p.capturedAtMs === null || p.capturedAtMs === undefined || p.capturedAtMs > p.publishedAtMs
        ? [] : [(p.publishedAtMs - p.capturedAtMs) / 3_600_000]))
    const lagKnown = lags.length > 0 && lags.length >= n * LADDER_RULE.collectKnownShareMin
    counts.collectKnown = lags.length
    if (lagKnown) counts.collectToPublishMedianH = round2(medianOf(lags))
    if (LADDER_RULE.collectToPublish.gate && n > 0) {
      if (!lagKnown) codes.add('TEXTURE_UNKNOWN')
      else if (medianOf(lags) > LADDER_RULE.collectToPublish.medianMaxH) codes.add('COLLECT_LATENCY_SHORT')
    }
  }

  // ── 무결성: 비용 장부 — 못 받았으면 모른다
  if (side === null || side.supplyCostEvidence === null) codes.add('COST_UNKNOWN')
  else {
    // 댓글·감사 lane 은 둘 다 있어야 한다 — 하나만 넘긴 호출이 "나머지도 ok" 로 읽히지 않게
    const lanes: readonly ('comment' | 'audit')[] = ['comment', 'audit']
    if (lanes.some((lane) => !side.cost.some((c) => c.lane === lane)) || side.cost.some((c) => c.health === 'unknown')) codes.add('COST_UNKNOWN')
    if (side.cost.some((c) => c.health === 'bad')) codes.add('COST_BAD')
    const supply = side.supplyCostEvidence
    // 공급 비용 계약(envelope) 이전 날짜는 판정할 근거가 없다 — 모름
    if (!usesSupplyCostEnvelope(kstDate) || supply.wholeDayCriticalHealth === 'unknown') codes.add('COST_UNKNOWN')
    if (supply.wholeDayCriticalHealth === 'bad') codes.add('COST_BAD')
    const envelope = judgeSupplyCostEnvelope(supply.envelope)
    counts.supplySettledRequests = supply.envelope.settledRequests
    counts.supplyUsageUnknown = supply.envelope.usageUnknownRequests
    counts.supplyCostOverrunRequests = supply.envelope.overrunRequests
    counts.supplyCostIneligibleRequests = supply.envelope.ineligibleRequests
    if (envelope.settledRatio !== null) counts.supplySettledRatio = envelope.settledRatio
    if (supply.envelope.riskUsd !== null) counts.supplyCostRiskUsd = supply.envelope.riskUsd
    if (supply.envelope.budgetUsd !== null) counts.supplyCostBudgetUsd = supply.envelope.budgetUsd
    if (envelope.kind === 'unknown') codes.add('COST_UNKNOWN')
    if (envelope.kind === 'bad') codes.add('COST_BAD')
  }
  const ordered = STAGE_EVIDENCE_CODES.filter((c) => codes.has(c))
  const failing = ordered.filter((c) => !UNKNOWN_CODES.includes(c))
  const verdict: EvidenceVerdictKind = failing.length > 0 ? 'FAIL' : ordered.length > 0 ? 'UNKNOWN' : 'PASS'
  const conversation = facts === null ? undefined : judgeConversationAudit(facts.posts)
  return { kstDate, stage, verdict, codes: ordered, counts, ...(conversation === undefined ? {} : { conversation }) }
}

/** 결정 reasons 에 남기는 한 줄 — 코드와 개수만 */
export function evidenceReasonOf(v: StageEvidenceVerdict): string {
  const n = Object.entries(v.counts).map(([k, x]) => `${k}=${x}`).join(',')
  // 대화 감사는 FAIL 일 때만 붙인다 — 단계 판정과 다른 칸이라는 것이 줄에서도 보이게(`CONVERSATION`)
  const conv = v.conversation?.verdict === 'FAIL' ? ` CONVERSATION FAIL [${v.conversation.codes.join(',')}]` : ''
  return `EVIDENCE ${v.kstDate} ${v.stage} ${v.verdict}${v.codes.length > 0 ? ` [${v.codes.join(',')}]` : ''}${n === '' ? '' : ` (${n})`}${conv}`
}

/**
 * 사람이 읽는 하루 한 줄 — 수와 결 네 칸의 실제 값과 통과선. 판정에는 쓰지 않는다.
 * 예: `11-19 공개 28/30편(93%) · 첫 댓글 27/28 · 글당 댓글 5.6(통과선 5.4) · 타인 3명 64%(통과선 60%) · 수집→공개 2.4시간(재기만) → PASS`
 */
export function evidencePlainLineOf(v: EvidenceVerdictFor<string>): string | null {
  const c = v.counts
  if (c.target === undefined || c.autoTargets === undefined) return null
  const pct = (a: number, b: number): string => (b > 0 ? `${Math.round((a / b) * 100)}%` : '모름')
  const row = ladderRowOf(v.stage)
  const closed = c.conversationClosed ?? 0
  const parts = [
    `공개 ${c.autoTargets}/${c.target}편(${pct(c.autoTargets, c.target)})`,
    `첫 댓글 ${c.firstCommentOk ?? 0}/${c.firstCommentClosed ?? 0}`,
    c.commentDepthAvg === undefined ? '글당 댓글 모름' : `글당 댓글 ${c.commentDepthAvg}(통과선 ${c.commentDepthFloor})`,
    c.threeVoicesPosts === undefined ? '타인 3명 모름'
      : `타인 3명 ${pct(c.threeVoicesPosts, closed)}${row === null ? '' : `(통과선 ${Math.round(row.threeVoicesRatio * 100)}%)`}`,
    c.collectToPublishMedianH === undefined ? '수집→공개 모름'
      : `수집→공개 ${c.collectToPublishMedianH}시간(${LADDER_RULE.collectToPublish.gate ? `통과선 ${LADDER_RULE.collectToPublish.medianMaxH}시간` : '재기만'})`,
  ]
  const integrity = v.codes.filter((x) => (INTEGRITY_CODES as readonly string[]).includes(x))
  return `${v.kstDate.slice(5)} ${parts.join(' · ')} → ${v.verdict}${integrity.length > 0 ? ` (무결성 ${integrity.join(',')})` : ''}`
}
