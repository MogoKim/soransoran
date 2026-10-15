/**
 * 🔴 **단계 승격의 운영 증거 — 날짜가 아니라 그날 실제로 일어난 일로 올린다** (2026-09-29 P0)
 *
 * 🔴 **왜 생겼나 (운영 반례).**
 *    controller 는 내일 시험 대상을 `nextStage(전날 결정의 release)` 로 골랐다. 전날 시험이
 *    실제로 성공했는지는 보지 않았다. 그래서 09-29 TRIAL d3 는 09:30 글의 첫 Persona 댓글이
 *    60분 안에 붙지 않아 댓글 계약을 이미 어겼는데도, 09-30 07:00 에 D5 · 10-01 07:00 에 D10 을
 *    **날짜만으로** 열 참이었다.
 *
 * 🔴 **계약 (마스터 결정 · 사람 승인을 더하지 않는다).**
 *    KST 날짜 D 의 단계 S **운영 PASS** 는 아래 여섯이 **전부** 참일 때만이다.
 *      ① D 의 StageDecision 을 controller 가 자동으로 골랐다 — `decidedBy=controller` ·
 *         상태 TRIAL/SUSTAIN/REPROVE(증명일) · 공개 = S. 수동 실행 · 단계 override · env canary/window ·
 *         사람 승인은 **세지 않는다**.
 *      ② **자동 target 물량** = `profileOf(S).dailyTarget` 이상 — 자동 READY 도장(`AUTO_DECIDER`)으로
 *         만들어져 **무인 러너 표식**으로 예약 발행된 글만 센다(2026-09-29 마스터 최종 보정).
 *         🔴 사람이 승인한 글은 정상 발행·감사 면제일 수 있지만 **자동화 성공 물량으로는 0건**이다.
 *            혼합 물량도 자동 target 만 센다. 모자라면 `PUBLISH_NOT_AUTO_READY`.
 *         🔴 그날 전체 발행(사람 글 포함)이 목표를 넘으면 상한 초과다 → `PUBLISH_OVER`.
 *      ③ 댓글 — 두 판정으로 나눈다 (2026-09-29 마스터 보정).
 *         (a) **첫 댓글 보장** — **자동 target 글마다** Persona 최상위 댓글(글쓴 Persona 아님)이 발행 후
 *             `AUTO_FIRST_COMMENT_WINDOW_MINUTES` 안에 **1건 이상**.
 *             🔴 **자동 출처가 연결된 댓글만 센다** (2026-10-11 Batch A3) — `commentProvenanceOf` 가 `auto` 인 것.
 *                `commentOrigin=PERSONA` 만으로는 증거가 아니다(사람이 어드민에서 낸 Persona 댓글도 PERSONA 다).
 *                연결이 깨진 댓글(로그 없음 · 대상 불일치 · 표식 불일치 · 중복 · 시각 불일치)이 하나라도 있으면
 *                `COMMENT_PROVENANCE_BROKEN` FAIL 이다.
 *         (b) **추가 댓글 계약** — 글당 Persona 댓글 수 ≤ 그 댓글 단계의 상한(`personaCommentCapFor`) ·
 *             같은 Persona 두 번 0 · 자기 글 0. 🔴 "60분 안 2건" 자체는 실패가 아니다 — 상한을 넘을 때만이다.
 *             (bootstrap-auto 의 상한 1 이 "글당 정확히 1건" 을 지금 그대로 지킨다. 장기 1~5 는 상한 5 로 같은 판정이 받는다)
 *         (c) 🔴 **추가 댓글은 단계 증거 밖이다** (2026-10-13 · PR #704 E1) — 추가 댓글 표식(`FOLLOWUP_LANE_*`)으로
 *             연결된 댓글(`followup` · `followup-broken`)은 (a) 분자 · (b) 상한 · 중복 · 자기 글 어디에도 세지 않는다.
 *             🔴 상한을 1→5 로 올리지 않는다 — 첫 댓글 레인 · 수동 · 깨진 출처는 지금 상한 그대로다.
 *             추가 댓글의 결함은 **대화 감사**(`judgeConversationAudit` · 판정의 `conversation` 칸)에서만 FAIL 이다 —
 *             첫 댓글 성공을 소급해서 지우지 않는다. 두 레인 표식이 섞인 행은 첫 댓글 축의 `broken` 이다(위 FAIL).
 *      ④ 사후 감사 — 🔴 **전수 감사가 아니라 정본 표본 계약이다** (마스터 정본 정정).
 *         그날 자동 target N 에 대해 expected = `auditTarget(N)` = ceil(N × 20%) (N>0 이면 최소 1).
 *         · 중복 없는 표본(글 기준) 수 ≥ expected — 0 이면 `AUDIT_COVERAGE_ZERO`, 미달이면 `AUDIT_COVERAGE_SHORT`
 *         · 표본은 **그날 자동 target 집합**에 속해야 한다(postId · queueId 둘 다) — 밖이면 `AUDIT_OUTSIDE_TARGET`
 *         · 표본은 전부 판정됐고 결함 yes · 재시도 가능 · 시한 초과 · 글 유실 0
 *         🔴 모든 글의 감사를 새 선행조건으로 만들지 않는다 — 그것은 새 병목이다.
 *         · 누가 결정했는지 모르는 글은 자동 target 인지도 모른다 → UNKNOWN(공백을 PASS 로 삼키지 않는다).
 *      ⑤ 중복 0 — Queue→Post 1:1 · 발행 기록 1:1 · (글, Persona) 댓글 1건.
 *      ⑥ 비용 · 러너 정상 — 그날 장부(공급 · 댓글 · 감사)에 막는 코드 0 · 발행/공급 러너 실패 0.
 *      ⑦ 🔴 **공개 증명 행 자체가 지금 원천 → 슬롯 계약을 만족한다** (2026-09-30 · source-slot-v1).
 *         자동 target 글마다 발행 트랜잭션이 같은 트랜잭션에서 남긴 도장(`gateResults.release`)이
 *         `source-slot-v1` · eligible 이어야 한다. 없으면 `RELEASE_CONTRACT_MISSING`, 판이 다르거나 eligible 이
 *         아니면 `STALE_RELEASE` — 둘 다 FAIL 이다. 🔴 이 계약 이전 날의 증거는 이 조항으로 PASS 가 날 수 없다 —
 *         옛 PASS 는 승급 · 이어진 계획 · 지속 단계의 근거가 되지 않는다(같은 단계를 다시 증명한다).
 *         (다음 단계를 채울 기회가 있는가는 정본 `judgeNextPreflight` 가 시험 대상에 대해 본다)
 *
 * 🔴 **fail-closed = 지금 단계에 머문다.** 하나라도 어긋나면 FAIL, 하나라도 못 읽으면 UNKNOWN.
 *    둘 다 PASS 가 아니다 — 올라가지 않고 **같은 단계를 다음 날 다시 시험**한다(`trialPlanOf`).
 *    이 게이트는 하루를 비우지 않는다 — 올라갈 칸을 막을 뿐, 지금 공개 단계는 그대로 둔다.
 *
 * 🔴 **범위 — 러너 단계 전체(`RUNTIME_STAGES` d1~d50)** (2026-09-29 generic scheduler 배선).
 *    앞판은 D3·D5·D10 까지만 닫았다(`nextStage(d10)` 없음). 이제 `nextStage(d10)=d20` 이고,
 *    D20·D30·D50 도 **같은 여섯 조건 · 같은 본체**로 판정한다. 목표는 `profileOf(S).dailyTarget`.
 *    🔴 D100 은 러너 밖이다(`stage-ladder-generic.resolveCeiling` — 표현은 되지만 열 수 없다).
 *    🔴 다음 칸이 있다고 열리는 것이 아니다 — 승인 천장과 D20 이상 preflight 가 사다리에서 막는다.
 *
 * 🔴 순수 함수다 — DB · 파일 · 시각 조회 0. 모으기는 `stage-evidence-repo` 가 한다.
 * 🔴 판정 결과에 원문·닉네임·id 를 담지 않는다 — **코드와 개수만**.
 */
import { SAFEST_STAGE, profileOf, type RuntimeStage } from './scale-profile'
import { DECISION_WRITER, isLegacyDecision, nextStage, type TrialBasis, type ValidatedStageDecision } from './stage-decision-contract'
import {
  AUTO_FIRST_COMMENT_WINDOW_MS, AUTO_PERSONA_COMMENTS_PER_POST_MAX, AUTO_LANE_DECIDED_BY, AUTO_LANE_ACTIVITY_DECIDED_BY,
} from './persona-comment-auto-lane'
import { PERSONA_COMMENTS_PER_POST_MAX } from './persona-target-rules'
import type { CommentStage } from './persona-comment-stage'
import { auditTarget } from './auto-ready-v2'
import type { Health } from './ops-status'

/** 🔴 왜 PASS 가 아닌가 — 문구가 아니라 코드다 */
export const STAGE_EVIDENCE_CODES = [
  // ① 결정
  'DECISION_MISSING', 'DECISION_NOT_CONTROLLER', 'DECISION_NOT_TRANSITION', 'DECISION_STAGE_MISMATCH',
  // ② 발행
  'PUBLISH_NOT_AUTO_READY', 'PUBLISH_OVER', 'PERSONA_REPEAT',
  // ③ 첫 댓글
  'COMMENT_MISSING', 'COMMENT_LATE', 'COMMENT_OVER_CAP', 'COMMENT_SELF', 'COMMENT_CAP_UNKNOWN', 'COMMENT_PROVENANCE_BROKEN',
  // ④ 감사
  'AUDIT_TARGET_UNKNOWN', 'AUDIT_COVERAGE_ZERO', 'AUDIT_COVERAGE_SHORT', 'AUDIT_OUTSIDE_TARGET',
  'AUDIT_UNJUDGED', 'AUDIT_DEFECT', 'AUDIT_OVERDUE', 'AUDIT_RETRYABLE', 'AUDIT_MISSING_POST',
  // ⑤ 중복
  'DUP_QUEUE', 'DUP_PUBLISH_LOG', 'UNLOGGED_PUBLISH', 'PUBLISH_LOG_ORPHAN', 'DUP_COMMENT',
  // ⑥ 비용 · 러너
  'COST_BAD', 'COST_UNKNOWN', 'RUNNER_BAD', 'RUNNER_UNKNOWN',
  // ⑦ 공개 증명 행의 release 계약 도장
  'RELEASE_CONTRACT_MISSING', 'STALE_RELEASE',
  // 못 읽음
  'READ_ERROR',
] as const
export type StageEvidenceCode = (typeof STAGE_EVIDENCE_CODES)[number]

/** 🔴 PASS 가 아닌 것 중 "몰라서" 인 코드 — FAIL 코드가 하나도 없을 때만 UNKNOWN 이 된다 */
const UNKNOWN_CODES: readonly StageEvidenceCode[] = [
  'COST_UNKNOWN', 'RUNNER_UNKNOWN', 'READ_ERROR', 'COMMENT_CAP_UNKNOWN', 'AUDIT_TARGET_UNKNOWN',
]

export type EvidenceVerdictKind = 'PASS' | 'FAIL' | 'UNKNOWN'

export type EvidenceVerdictFor<S extends string> = {
  readonly kstDate: string
  readonly stage: S
  readonly verdict: EvidenceVerdictKind
  /** 🔴 코드만 — 중복 없이 정본 순서 */
  readonly codes: readonly StageEvidenceCode[]
  /** 🔴 개수만 — 사람이 어느 조건이 모자랐는지 본다 */
  readonly counts: Readonly<Record<string, number>>
  /**
   * 🔴 **대화 감사(추가 댓글) — 단계 판정(`verdict`)에 들어가지 않는다** (2026-10-13).
   *    사실을 못 읽었으면 없다. 추가 댓글 결함은 여기서만 FAIL 이다 — 첫 댓글 성공을 지우지 않는다.
   */
  readonly conversation?: ConversationAudit
}
export type StageEvidenceVerdict = EvidenceVerdictFor<RuntimeStage>

/**
 * 🔴 **글당 Persona 댓글 상한 — 댓글 단계의 정본 상수를 그대로 쓴다** (새 숫자 0).
 *    · `bootstrap-auto`             `AUTO_PERSONA_COMMENTS_PER_POST_MAX`(1) — 지금 무인 레인의 "글당 1건"
 *    · `bootstrap-review`·`organic` `PERSONA_COMMENTS_PER_POST_MAX`(5) — 장기 1~5
 *    · `shadow`                     0 — 공개 write 가 없는 단계다
 */
export function personaCommentCapFor(stage: CommentStage): number {
  if (stage === 'bootstrap-auto') return AUTO_PERSONA_COMMENTS_PER_POST_MAX
  if (stage === 'shadow') return 0
  return PERSONA_COMMENTS_PER_POST_MAX
}

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
 *    첫 댓글 뒤 선택적 추가 댓글 0~4건(`persona-comment-followup`)이 Queue `decidedBy` · ActivityLog `decidedBy` 에 남긴다.
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
] as const
export type ConversationAuditCode = (typeof CONVERSATION_AUDIT_CODES)[number]

export type ConversationAudit = {
  readonly verdict: 'PASS' | 'FAIL'
  readonly codes: readonly ConversationAuditCode[]
  readonly counts: Readonly<Record<string, number>>
}

/**
 * 🔴 **대화 감사 — 추가 댓글만 본다. 단계 증거와 따로 판정한다** (2026-10-13).
 *    추가 댓글의 결함은 여기서 FAIL 이지만 🔴 그 글의 첫 댓글 성공을 소급해서 지우지 않는다(단계 증거는 그대로).
 *    · 출처가 깨진 추가 댓글                                           FOLLOWUP_PROVENANCE_BROKEN
 *    · 자동 첫 댓글(`auto`)이 없는 글 · 첫 댓글보다 앞선 추가 댓글         FOLLOWUP_WITHOUT_FIRST
 *    · 그 글의 Persona 댓글 총수 > 장기 정본 `PERSONA_COMMENTS_PER_POST_MAX` FOLLOWUP_OVER_TOTAL
 *    · 추가 댓글 Persona 가 그 글에 이미 쓴 Persona                       FOLLOWUP_DUP_PERSONA
 *    · 추가 댓글 Persona 가 글쓴이                                         FOLLOWUP_SELF
 *    🔴 추가 댓글이 하나도 없으면 PASS 다(대화를 잇지 않는 글이 정상이다).
 */
export function judgeConversationAudit(posts: readonly EvidencePost[]): ConversationAudit {
  const codes = new Set<ConversationAuditCode>()
  let followups = 0
  let broken = 0
  let postsWithFollowup = 0
  for (const p of posts) {
    const fu = p.personaComments.filter((c) => isFollowupProvenance(c.provenance))
    if (fu.length === 0) continue
    followups += fu.length
    postsWithFollowup += 1
    broken += fu.filter((c) => c.provenance === 'followup-broken').length
    const firsts = p.personaComments.filter((c) => c.provenance === 'auto')
    const firstAt = firsts.length === 0 ? null : Math.min(...firsts.map((c) => c.createdAtMs))
    if (firstAt === null || fu.some((c) => c.createdAtMs < firstAt)) codes.add('FOLLOWUP_WITHOUT_FIRST')
    if (p.personaComments.length > PERSONA_COMMENTS_PER_POST_MAX) codes.add('FOLLOWUP_OVER_TOTAL')
    const seen = p.personaComments.map((c) => c.personaId ?? '(없음)')
    if (fu.some((c) => c.personaId === null || seen.filter((x) => x === c.personaId).length > 1)) codes.add('FOLLOWUP_DUP_PERSONA')
    if (p.authorPersonaId !== null && fu.some((c) => c.personaId === p.authorPersonaId)) codes.add('FOLLOWUP_SELF')
  }
  if (broken > 0) codes.add('FOLLOWUP_PROVENANCE_BROKEN')
  const ordered = CONVERSATION_AUDIT_CODES.filter((c) => codes.has(c))
  return {
    verdict: ordered.length > 0 ? 'FAIL' : 'PASS',
    codes: ordered,
    counts: { followupComments: followups, followupBroken: broken, postsWithFollowup },
  }
}

/** 🔴 누가 발행을 결정했나 — 사후 감사 대상인지를 가른다 */
export type PostDecider = 'auto' | 'human' | 'unknown'

/** 그날 발행된 글 하나 — 🔴 제목·본문 없음 */
export type EvidencePost = {
  /** 🔴 판정 안에서 감사 표본 소속을 대조하는 데만 쓴다 — 판정 결과에는 싣지 않는다 */
  postId: string
  /** 이 글을 만든 PUBLISHED Queue 행 — 없으면 null */
  queueId: string | null
  /** 발행 시각(`publishAt ?? createdAt`) — 첫 댓글 시한의 기준 */
  publishedAtMs: number
  /** 🔴 무인 러너 표식이 있는 발행 기록인가 */
  unattended: boolean
  /** 이 글을 가리키는 Queue 행 수 — 1 이어야 한다 */
  queueRows: number
  /** 이 글의 발행 기록(ActivityLog kind=post) 수 — 1 이어야 한다 */
  publishLogs: number
  /** 글을 쓴 Persona — 없으면 null */
  authorPersonaId: string | null
  /** 🔴 Queue 결정자 — 자동 READY(`auto`)만 사후 감사 대상이다 */
  decider: PostDecider
  /**
   * 이 글의 살아 있는 Persona 댓글 전부 — 🔴 `provenance` 는 `personaCommentProvenanceOf` 결과다.
   *    첫 댓글 보장은 `auto` 만 센다 · 추가 댓글(`followup*`)은 단계 증거 밖이고 대화 감사가 본다.
   */
  personaComments: readonly { personaId: string | null; createdAtMs: number; topLevel: boolean; provenance: PersonaCommentProvenance }[]
  /**
   * 🔴 **발행 트랜잭션이 남긴 release 도장 상태**(`releaseStampStatusOf`) — 조항 ⑦.
   *    Queue 가 없으면 `MISSING` 이다(도장을 확인할 곳이 없다).
   */
  release: 'STAMPED_ELIGIBLE' | 'MISSING' | 'STALE'
}

/**
 * 🔴 단계 칸만 일반화한 사실 묶음 — `StageEvidenceFacts` 는 러너 단계(d1~d50) 판이다.
 *    결정 칸은 `release` 를 문자열로 받는다 — 판정 본체는 결정의 단계가 판정 단계와 같은지만 본다.
 */
export type EvidenceFactsFor<S extends string> = Omit<StageEvidenceFacts, 'stage' | 'decision'> & {
  stage: S
  decision: { kstDate: string; state: string; release: string; decidedBy: string } | null
}

export type StageEvidenceFacts = {
  kstDate: string
  stage: RuntimeStage
  /** D 의 저장된 결정 — 없거나 검증에 떨어졌으면 null */
  decision: Pick<ValidatedStageDecision, 'kstDate' | 'state' | 'release' | 'decidedBy'> | null
  posts: readonly EvidencePost[]
  /** Post 가 없는 발행 기록 · targetId 가 비었거나 Queue 가 없는 기록 */
  orphanPublishLogs: number
  /** Queue 로 발행된 그날 글인데 발행 기록이 없는 것 */
  unloggedPublishes: number
  /** 🔴 그 날 댓글 단계의 글당 Persona 댓글 상한(`personaCommentCapFor`) — 모르면 null */
  commentCapPerPost: number | null
  audits: {
    /** 🔴 그날 고른 감사 + 그날 글의 감사 — **행마다** 따로 본다. postId·queueId 로 표본 소속을 대조한다 */
    rows: readonly {
      postId: string; queueId: string
      judged: boolean; defectYes: boolean; retryable: boolean; overdue: boolean
    }[]
    /** 🔴 지금 표 전체 — 정본 `unresolvedDefectCount`(지금 계약에서 해소되지 않은 확정 결함) · `overdueAuditCount` · `retryableFailureCount` · `missingAutoPostCount` */
    globalUnresolvedDefects: number
    globalOverdue: number
    globalRetryable: number
    globalMissingPosts: number
  }
}

export type EvidenceSideSignals = {
  /** 그날 장부 판정(정본 `judgeCost`) — 공급 · 댓글 · 감사 */
  cost: readonly { name: string; health: Health }[]
  /** 발행·공급 러너 최근 회차(정본 `errorSignalOf`) */
  errors: Health
}

/**
 * 🔴 **D 의 운영 PASS 판정.** 못 읽었으면 `facts=null` → UNKNOWN.
 *    FAIL 코드가 하나라도 있으면 FAIL · 없고 모르는 것이 있으면 UNKNOWN · 둘 다 없으면 PASS.
 */
export function judgeStageEvidence(
  kstDate: string, stage: RuntimeStage,
  facts: StageEvidenceFacts | null, side: EvidenceSideSignals | null,
): StageEvidenceVerdict {
  return judgeEvidenceForTarget(kstDate, stage, profileOf(stage).dailyTarget, facts, side)
}

/**
 * 🔴 **지정 증명일 상태** — `consumerEnvOf` 가 목표 슬롯을 먼저 채우도록 연 날이다.
 *    평상일 HOLD·PREPARE도 자연스럽게 exact N을 채우고 나머지 증거를 전부 만족하면 같은 운영능력의 증거로 인정한다.
 *    N 미만인 평상일은 정상 운영이며, PASS가 아닐 뿐 재시험 빚을 만들지 않는다.
 */
export const PROOF_STATES: readonly string[] = ['TRIAL', 'REPROVE']
export const EVIDENCE_STATES: readonly string[] = [...PROOF_STATES, 'HOLD', 'PREPARE']

/**
 * 🔴 **단계 이름과 하루 목표를 받는 판정 본체** (2026-09-29 generic scheduler 골격).
 *    `judgeStageEvidence` 는 러너 프로필(`profileOf`) 목표로 이것을 부른다 — d1~d10 목표는 예전 `PROFILES` 그대로다.
 *    D100(`stage-ladder-generic`)도 같은 여섯 조건을 **같은 본체**로 판정한다. 판정 규칙을 두 벌로 적지 않는다.
 *    🔴 목표는 호출부가 정본 프로필에서 꺼내 넘긴다 — 여기서 숫자를 만들지 않는다.
 */
export function judgeEvidenceForTarget<S extends string>(
  kstDate: string, stage: S, target: number,
  facts: EvidenceFactsFor<string> | null, side: EvidenceSideSignals | null,
): EvidenceVerdictFor<S> {
  const codes = new Set<StageEvidenceCode>()
  const counts: Record<string, number> = {}
  if (facts === null) codes.add('READ_ERROR')
  else {
    // 🔴 다른 날·다른 단계의 사실로 판정하지 않는다
    if (facts.kstDate !== kstDate || facts.stage !== stage) codes.add('READ_ERROR')
    // ① 결정
    const d = facts.decision
    if (d === null) codes.add('DECISION_MISSING')
    else {
      if (d.kstDate !== kstDate) codes.add('DECISION_MISSING')
      if (d.decidedBy !== DECISION_WRITER) codes.add('DECISION_NOT_CONTROLLER')
      if (!EVIDENCE_STATES.includes(d.state)) codes.add('DECISION_NOT_TRANSITION')
      if (d.release !== stage) codes.add('DECISION_STAGE_MISMATCH')
    }
    // ② 발행 — 🔴 자동 READY 로 만들어져 무인 러너가 낸 글만 자동 target 이다. 사람 승인 글은 0건으로 센다
    const autoTargets = facts.posts.filter((p) => p.decider === 'auto' && p.unattended)
    counts.target = target
    counts.published = facts.posts.length
    counts.autoTargets = autoTargets.length
    counts.humanApproved = facts.posts.filter((p) => p.decider === 'human').length
    if (autoTargets.length < target) codes.add('PUBLISH_NOT_AUTO_READY')
    if (facts.posts.length > target) codes.add('PUBLISH_OVER')
    /**
     * 🔴 **서로 다른 Persona 로 채운다** (canon §6-3 · 2026-10-01 C9). 자동 target 글의 글쓴이가 겹치면 FAIL.
     *    소재 다양성의 회차 조건이다 — 소재 라벨 없이 **배정 근거**(글쓴이)로 본다. 글쓴이를 모르는 글도 겹침으로 센다.
     */
    const authors = autoTargets.map((p) => p.authorPersonaId ?? '(없음)')
    counts.distinctAuthors = new Set(authors.filter((a) => a !== '(없음)')).size
    if (authors.includes('(없음)') || new Set(authors).size < authors.length) codes.add('PERSONA_REPEAT')
    // ③ 댓글 · ⑤ 중복
    const cap = facts.commentCapPerPost
    if (cap === null) codes.add('COMMENT_CAP_UNKNOWN')
    else counts.commentCap = cap
    let firstOk = 0
    let brokenProv = 0
    let manualPersona = 0
    let followupCount = 0
    for (const p of facts.posts) {
      if (p.queueRows !== 1) codes.add('DUP_QUEUE')
      if (p.publishLogs !== 1) codes.add('DUP_PUBLISH_LOG')
      /**
       * 🔴 **추가 댓글(`followup*`)은 단계 증거의 분자·상한·중복 밖이다** (2026-10-13 · PR #704 E1).
       *    상한을 1→5 로 올리지 않는다 — 첫 댓글 레인 · 수동 · 깨진 출처만 지금 상한으로 센다.
       *    추가 댓글의 결함(출처 · 중복 · 자기 글 · 총량)은 대화 감사(`judgeConversationAudit`)가 따로 본다.
       */
      const stageComments = p.personaComments.filter((c) => !isFollowupProvenance(c.provenance))
      followupCount += p.personaComments.length - stageComments.length
      // (b) 추가 댓글 계약 — 같은 Persona 두 번 0 · 자기 글 0 · 상한 이내
      const byPersona = new Map<string, number>()
      for (const c of stageComments) {
        const k = c.personaId ?? '(없음)'
        byPersona.set(k, (byPersona.get(k) ?? 0) + 1)
      }
      if ([...byPersona.values()].some((n) => n > 1)) codes.add('DUP_COMMENT')
      const own = stageComments.filter((c) => p.authorPersonaId !== null && c.personaId === p.authorPersonaId)
      if (own.length > 0) codes.add('COMMENT_SELF')
      if (cap !== null && stageComments.length > cap) codes.add('COMMENT_OVER_CAP')
      // 🔴 출처가 깨진 댓글 — 어느 글이든 FAIL(자동 표식을 흉내 낸 행 · 반쯤 남은 행)
      for (const c of stageComments) {
        if (c.provenance === 'broken') brokenProv += 1
        else if (c.provenance === 'none') manualPersona += 1
      }
      // (a) 첫 댓글 보장 — 🔴 자동 target 글만 · 60분 안 최상위 · 다른 Persona · **자동 출처 연결** **1건 이상**
      if (!(p.decider === 'auto' && p.unattended)) continue
      const eligible = stageComments.filter((c) =>
        c.topLevel && c.personaId !== null && c.personaId !== p.authorPersonaId && c.provenance === 'auto')
      const inWindow = eligible.filter((c) =>
        c.createdAtMs >= p.publishedAtMs && c.createdAtMs - p.publishedAtMs <= AUTO_FIRST_COMMENT_WINDOW_MS)
      if (inWindow.length >= 1) firstOk += 1
      else if (eligible.length > 0) codes.add('COMMENT_LATE')
      else codes.add('COMMENT_MISSING')
    }
    counts.firstCommentOk = firstOk
    counts.commentProvenanceBroken = brokenProv
    counts.manualPersonaComments = manualPersona
    counts.followupComments = followupCount
    if (brokenProv > 0) codes.add('COMMENT_PROVENANCE_BROKEN')
    if (facts.orphanPublishLogs > 0) codes.add('PUBLISH_LOG_ORPHAN')
    if (facts.unloggedPublishes > 0) codes.add('UNLOGGED_PUBLISH')
    // ④ 감사 — 🔴 정본 표본 계약: expected = auditTarget(자동 target N) · 표본은 그 집합 안 · 표본 전부 판정·결함 0
    const unknownDecider = facts.posts.filter((p) => p.decider === 'unknown').length
    if (unknownDecider > 0) codes.add('AUDIT_TARGET_UNKNOWN')
    const targetKey = new Set(autoTargets.map((p) => `${p.postId}\u0000${p.queueId ?? ''}`))
    const targetPost = new Set(autoTargets.map((p) => p.postId))
    const a = facts.audits
    // 🔴 표본 = 그날 자동 target 집합에 postId·queueId 가 **둘 다** 맞는 행 — 글 기준으로 중복 없이 센다
    const inSet = a.rows.filter((r) => targetKey.has(`${r.postId}\u0000${r.queueId}`))
    const outside = a.rows.filter((r) => !targetKey.has(`${r.postId}\u0000${r.queueId}`))
    const sampled = new Set(inSet.map((r) => r.postId).filter((id) => targetPost.has(id)))
    const expected = auditTarget(autoTargets.length)
    counts.auditExpected = expected
    counts.auditSampled = sampled.size
    counts.auditRows = a.rows.length
    if (outside.length > 0) codes.add('AUDIT_OUTSIDE_TARGET')
    if (autoTargets.length > 0 && sampled.size === 0) codes.add('AUDIT_COVERAGE_ZERO')
    else if (sampled.size < expected) codes.add('AUDIT_COVERAGE_SHORT')
    if (inSet.some((r) => !r.judged)) codes.add('AUDIT_UNJUDGED')
    if (inSet.some((r) => r.defectYes) || a.globalUnresolvedDefects > 0) codes.add('AUDIT_DEFECT')
    if (inSet.some((r) => r.overdue) || a.globalOverdue > 0) codes.add('AUDIT_OVERDUE')
    if (inSet.some((r) => r.retryable) || a.globalRetryable > 0) codes.add('AUDIT_RETRYABLE')
    if (a.globalMissingPosts > 0) codes.add('AUDIT_MISSING_POST')
    // ⑦ 🔴 공개 증명 행 — 자동 target 전부가 지금 계약 · eligible 도장을 가져야 한다
    const stamped = autoTargets.filter((p) => p.release === 'STAMPED_ELIGIBLE').length
    counts.releaseStamped = stamped
    if (autoTargets.some((p) => p.release === 'MISSING')) codes.add('RELEASE_CONTRACT_MISSING')
    if (autoTargets.some((p) => p.release === 'STALE')) codes.add('STALE_RELEASE')
  }
  // ⑥ 비용 · 러너 — 못 받았으면 모른다
  if (side === null) { codes.add('COST_UNKNOWN'); codes.add('RUNNER_UNKNOWN') } else {
    if (side.cost.length === 0 || side.cost.some((c) => c.health === 'unknown')) codes.add('COST_UNKNOWN')
    if (side.cost.some((c) => c.health === 'bad')) codes.add('COST_BAD')
    if (side.errors === 'bad') codes.add('RUNNER_BAD')
    if (side.errors === 'unknown') codes.add('RUNNER_UNKNOWN')
  }
  const ordered = STAGE_EVIDENCE_CODES.filter((c) => codes.has(c))
  const failing = ordered.filter((c) => !UNKNOWN_CODES.includes(c))
  const verdict: EvidenceVerdictKind = failing.length > 0 ? 'FAIL' : ordered.length > 0 ? 'UNKNOWN' : 'PASS'
  const conversation = facts === null ? undefined : judgeConversationAudit(facts.posts)
  return { kstDate, stage, verdict, codes: ordered, counts, ...(conversation === undefined ? {} : { conversation }) }
}

/** 🔴 결정 reasons 에 남기는 한 줄 — 코드와 개수만 */
export function evidenceReasonOf(v: StageEvidenceVerdict): string {
  const n = Object.entries(v.counts).map(([k, x]) => `${k}=${x}`).join(',')
  // 🔴 대화 감사는 FAIL 일 때만 붙인다 — 단계 판정과 다른 칸이라는 것이 줄에서도 보이게(`CONVERSATION`)
  const conv = v.conversation?.verdict === 'FAIL' ? ` CONVERSATION FAIL [${v.conversation.codes.join(',')}]` : ''
  return `EVIDENCE ${v.kstDate} ${v.stage} ${v.verdict}${v.codes.length > 0 ? ` [${v.codes.join(',')}]` : ''}${n === '' ? '' : ` (${n})`}${conv}`
}

export type TrialPlan = { base: RuntimeStage; target: RuntimeStage; basis: TrialBasis }

/**
 * 🔴 **오늘 무엇을 시험하는가 — 전날 결정 + 전날 운영 증거로만 정한다.**
 *
 *    🔴 **계약 경계** (2026-09-30) — 전날 결정이 옛 판(`isLegacyDecision`)이면 그 위의 PASS · RETEST · 이어진 계획을
 *       쓰지 않는다. 바닥(d1)에서 다시 증명한다(FLOOR). 지속 단계도 같은 규칙이다(`sustainedReleaseOf`).
 *
 *    · 전날 단계 S 가 운영 PASS            → S 의 다음 칸을 시험한다 (`PASS` · 기반 S)
 *      (지정 증명일 또는 평상일의 자연 exact-N 모두 같은 본체로 판정한다)
 *    · 전날이 TRIAL 인데 PASS 가 아니다     → **같은 단계를 다시** 시험한다 (`RETEST` · 기반은 전날 시험 기반)
 *    · 전날 공개가 바닥(d1)이다             → 바닥의 다음 칸을 시험한다 (`FLOOR` · 증명할 아래 칸이 없다)
 *    · 그 밖(증거 없는 d3 이상 유지 날)      → 시험하지 않는다 — 지금 단계를 지킨다(평상일 0..Dn)
 *      (사다리는 다음 칸 preflight 가 PASS 인 날에만 그날을 REPROVE 증명일로 둔다 — 막힌 날은 평상일)
 *
 *    🔴 PASS 는 `kstDate`·`stage` 가 전날 결정과 **정확히** 같은 증거만 받는다 — 다른 날의 PASS 로 올리지 않는다.
 */
export function trialPlanOf(
  prev: ValidatedStageDecision, evidence: StageEvidenceVerdict | null, carried: TrialPlan | null = null,
): TrialPlan | null {
  if (isLegacyDecision(prev)) {
    const up = nextStage(SAFEST_STAGE)
    return up === null ? null : { base: SAFEST_STAGE, target: up, basis: 'FLOOR' }
  }
  const passed = evidence !== null && evidence.verdict === 'PASS'
    && evidence.kstDate === prev.kstDate && evidence.stage === prev.release
  if (passed) {
    const up = nextStage(prev.release)
    return up === null ? null : { base: prev.release, target: up, basis: 'PASS' }
  }
  const t = prev.transition
  if (prev.state === 'TRIAL' && t !== null && t.kind === 'TRIAL') {
    return { base: t.trialBase, target: prev.release, basis: 'RETEST' }
  }
  /**
   * 🔴 **브레이크 날을 건너 계획을 잇는다** (PR3 · 2026-09-30 자동 승급 부품 보존). `carried` 는 **전날(prev)의 계획**이다.
   *    전날이 HOLD·PREPARE(증명일 아님 — 운영 신호 브레이크로 시험이 되돌려진 날)이고 그날 공개가 계획의 기반과
   *    같으면 그 계획을 잇는다. 🔴 증명일(TRIAL·REPROVE)의 결과는 잇지 않는다 — 그날 증거가 스스로 말한다.
   */
  if (carried !== null && CARRY_STATES.includes(prev.state) && prev.release === carried.base) return carried
  if (prev.release === SAFEST_STAGE) {
    const up = nextStage(SAFEST_STAGE)
    return up === null ? null : { base: SAFEST_STAGE, target: up, basis: 'FLOOR' }
  }
  return null
}

/** 🔴 계획을 잇는 날 — 증명일이 아닌 두 상태뿐이다 */
const CARRY_STATES: readonly string[] = ['HOLD', 'PREPARE']

/**
 * 🔴 **계획을 잇는 브레이크 날 수의 상한** — 이만큼 넘게 연속으로 막히면 계획을 버린다(오래된 증거로 올리지 않는다).
 *    controller 가 읽는 지난 결정 행 수도 이 값으로 묶인다(PR3 KEEP).
 */
export const PLAN_CARRY_MAX_DAYS = 3

/**
 * 🔴 **연속된 날들의 결정·증거로 그 다음 날 계획을 되짚는다** — 오래된 날부터. 날짜가 이어지지 않으면 계획을 버린다.
 *    `days` 의 마지막 날이 오늘의 전날이다. 증명일이 아닌 날(HOLD·PREPARE)의 증거는 `null` 이어도 된다(PASS 가 날 수 없다).
 */
export function trialPlanThrough(
  days: readonly { decision: ValidatedStageDecision; evidence: StageEvidenceVerdict | null }[],
): TrialPlan | null {
  let plan: TrialPlan | null = null
  let prevDate: string | null = null
  for (const d of days) {
    if (prevDate !== null && nextKstDate(prevDate) !== d.decision.kstDate) plan = null
    plan = trialPlanOf(d.decision, d.evidence, plan)
    prevDate = d.decision.kstDate
  }
  return plan
}

const nextKstDate = (d: string): string =>
  new Date(Date.parse(`${d}T00:00:00Z`) + 864e5).toISOString().slice(0, 10)
