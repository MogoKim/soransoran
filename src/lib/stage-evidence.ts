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
 *         상태 TRIAL/SUSTAIN · 공개 = S. 수동 실행 · 단계 override · env canary/window ·
 *         사람 승인은 **세지 않는다**.
 *      ② 그날 예약 발행 수 = `PROFILES[S].dailyTarget` — 무인 러너 표식이 있는 발행만 센다.
 *         표식이 없는 발행이 하나라도 있으면(수동 · 표식 이전) 증명이 없는 것이다 → FAIL.
 *      ③ 댓글 — 두 판정으로 나눈다 (2026-09-29 마스터 보정).
 *         (a) **첫 댓글 보장** — 그 글마다 Persona 최상위 댓글(글쓴 Persona 아님)이 발행 후
 *             `AUTO_FIRST_COMMENT_WINDOW_MINUTES` 안에 **1건 이상**.
 *         (b) **추가 댓글 계약** — 글당 Persona 댓글 수 ≤ 그 댓글 단계의 상한(`personaCommentCapFor`) ·
 *             같은 Persona 두 번 0 · 자기 글 0. 🔴 "60분 안 2건" 자체는 실패가 아니다 — 상한을 넘을 때만이다.
 *             (bootstrap-auto 의 상한 1 이 "글당 정확히 1건" 을 지금 그대로 지킨다. 장기 1~5 는 상한 5 로 같은 판정이 받는다)
 *      ④ 사후 감사 — 그날 글을 **하나씩** 감사 대상인지 가른다.
 *         · 자동 READY 글(`AUTO_DECIDER`)은 감사 대상이다 — 그날 대상 수 A 에 대해 감사 행이
 *           정본 표본 수 `auditTarget(A)` 이상 있어야 한다(0 이면 닫는다). 행마다 판정 전 · 결함 yes ·
 *           시한 초과 · 재시도 가능 실패를 따로 본다.
 *         · 사람이 발행 전에 검토한 글은 사후 감사 대상이 아니다 — 그것이 **이유를 가진** 0 이다.
 *         · 누가 결정했는지 모르는 글은 대상인지도 모른다 → FAIL(공백을 PASS 로 삼키지 않는다).
 *      ⑤ 중복 0 — Queue→Post 1:1 · 발행 기록 1:1 · (글, Persona) 댓글 1건.
 *      ⑥ 비용 · 러너 정상 — 그날 장부(공급 · 댓글 · 감사)에 막는 코드 0 · 발행/공급 러너 실패 0.
 *         (READY 재고가 다음 단계를 채우는가는 정본 `judgeOneDayCanary` 가 시험 대상에 대해 본다)
 *
 * 🔴 **fail-closed = 지금 단계에 머문다.** 하나라도 어긋나면 FAIL, 하나라도 못 읽으면 UNKNOWN.
 *    둘 다 PASS 가 아니다 — 올라가지 않고 **같은 단계를 다음 날 다시 시험**한다(`trialPlanOf`).
 *    이 게이트는 하루를 비우지 않는다 — 올라갈 칸을 막을 뿐, 지금 공개 단계는 그대로 둔다.
 *
 * 🔴 순수 함수다 — DB · 파일 · 시각 조회 0. 모으기는 `stage-evidence-repo` 가 한다.
 * 🔴 판정 결과에 원문·닉네임·id 를 담지 않는다 — **코드와 개수만**.
 */
import { PROFILES, SAFEST_STAGE, type ReleaseStage } from './scale-profile'
import { DECISION_WRITER, nextStage, type TrialBasis, type ValidatedStageDecision } from './stage-decision-contract'
import { AUTO_FIRST_COMMENT_WINDOW_MS, AUTO_PERSONA_COMMENTS_PER_POST_MAX } from './persona-comment-auto-lane'
import { PERSONA_COMMENTS_PER_POST_MAX } from './persona-target-rules'
import type { CommentStage } from './persona-comment-stage'
import { auditTarget } from './auto-ready-v2'
import type { Health } from './ops-status'

/** 🔴 왜 PASS 가 아닌가 — 문구가 아니라 코드다 */
export const STAGE_EVIDENCE_CODES = [
  // ① 결정
  'DECISION_MISSING', 'DECISION_NOT_CONTROLLER', 'DECISION_NOT_TRANSITION', 'DECISION_STAGE_MISMATCH',
  // ② 발행
  'PUBLISH_SHORT', 'PUBLISH_OVER', 'PUBLISH_NOT_UNATTENDED',
  // ③ 첫 댓글
  'COMMENT_MISSING', 'COMMENT_LATE', 'COMMENT_OVER_CAP', 'COMMENT_SELF', 'COMMENT_CAP_UNKNOWN',
  // ④ 감사
  'AUDIT_TARGET_UNKNOWN', 'AUDIT_COVERAGE_ZERO', 'AUDIT_COVERAGE_SHORT',
  'AUDIT_UNJUDGED', 'AUDIT_DEFECT', 'AUDIT_OVERDUE', 'AUDIT_RETRYABLE', 'AUDIT_MISSING_POST',
  // ⑤ 중복
  'DUP_QUEUE', 'DUP_PUBLISH_LOG', 'UNLOGGED_PUBLISH', 'PUBLISH_LOG_ORPHAN', 'DUP_COMMENT',
  // ⑥ 비용 · 러너
  'COST_BAD', 'COST_UNKNOWN', 'RUNNER_BAD', 'RUNNER_UNKNOWN',
  // 못 읽음
  'READ_ERROR',
] as const
export type StageEvidenceCode = (typeof STAGE_EVIDENCE_CODES)[number]

/** 🔴 PASS 가 아닌 것 중 "몰라서" 인 코드 — FAIL 코드가 하나도 없을 때만 UNKNOWN 이 된다 */
const UNKNOWN_CODES: readonly StageEvidenceCode[] = [
  'COST_UNKNOWN', 'RUNNER_UNKNOWN', 'READ_ERROR', 'COMMENT_CAP_UNKNOWN', 'AUDIT_COVERAGE_SHORT',
]

export type EvidenceVerdictKind = 'PASS' | 'FAIL' | 'UNKNOWN'

export type StageEvidenceVerdict = {
  readonly kstDate: string
  readonly stage: ReleaseStage
  readonly verdict: EvidenceVerdictKind
  /** 🔴 코드만 — 중복 없이 정본 순서 */
  readonly codes: readonly StageEvidenceCode[]
  /** 🔴 개수만 — 사람이 어느 조건이 모자랐는지 본다 */
  readonly counts: Readonly<Record<string, number>>
}

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

/** 🔴 누가 발행을 결정했나 — 사후 감사 대상인지를 가른다 */
export type PostDecider = 'auto' | 'human' | 'unknown'

/** 그날 발행된 글 하나 — 🔴 제목·본문 없음 */
export type EvidencePost = {
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
  /** 이 글에 감사 행이 있는가 */
  audited: boolean
  /** 이 글의 살아 있는 Persona 댓글 전부 */
  personaComments: readonly { personaId: string | null; createdAtMs: number; topLevel: boolean }[]
}

export type StageEvidenceFacts = {
  kstDate: string
  stage: ReleaseStage
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
    /** 🔴 그날 고른 감사 + 그날 글의 감사 — **행마다** 따로 본다 */
    rows: readonly { judged: boolean; defectYes: boolean; retryable: boolean; overdue: boolean }[]
    /** 🔴 지금 표 전체 — 정본 `confirmedDefectCount` · `overdueAuditCount` · `retryableFailureCount` · `missingAutoPostCount` */
    globalDefectYes: number
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
  kstDate: string, stage: ReleaseStage,
  facts: StageEvidenceFacts | null, side: EvidenceSideSignals | null,
): StageEvidenceVerdict {
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
      if (d.state !== 'TRIAL' && d.state !== 'SUSTAIN') codes.add('DECISION_NOT_TRANSITION')
      if (d.release !== stage) codes.add('DECISION_STAGE_MISMATCH')
    }
    // ② 발행 — 무인 표식이 있는 발행만 센다
    const target = PROFILES[stage].dailyTarget
    const unattended = facts.posts.filter((p) => p.unattended).length
    const other = facts.posts.length - unattended
    counts.target = target
    counts.published = facts.posts.length
    counts.unattended = unattended
    if (other > 0) codes.add('PUBLISH_NOT_UNATTENDED')
    if (unattended < target) codes.add('PUBLISH_SHORT')
    if (facts.posts.length > target) codes.add('PUBLISH_OVER')
    // ③ 댓글 · ⑤ 중복
    const cap = facts.commentCapPerPost
    if (cap === null) codes.add('COMMENT_CAP_UNKNOWN')
    else counts.commentCap = cap
    let firstOk = 0
    for (const p of facts.posts) {
      if (p.queueRows !== 1) codes.add('DUP_QUEUE')
      if (p.publishLogs !== 1) codes.add('DUP_PUBLISH_LOG')
      // (b) 추가 댓글 계약 — 같은 Persona 두 번 0 · 자기 글 0 · 상한 이내
      const byPersona = new Map<string, number>()
      for (const c of p.personaComments) {
        const k = c.personaId ?? '(없음)'
        byPersona.set(k, (byPersona.get(k) ?? 0) + 1)
      }
      if ([...byPersona.values()].some((n) => n > 1)) codes.add('DUP_COMMENT')
      const own = p.personaComments.filter((c) => p.authorPersonaId !== null && c.personaId === p.authorPersonaId)
      if (own.length > 0) codes.add('COMMENT_SELF')
      if (cap !== null && p.personaComments.length > cap) codes.add('COMMENT_OVER_CAP')
      // (a) 첫 댓글 보장 — 60분 안 최상위 · 다른 Persona **1건 이상**
      const eligible = p.personaComments.filter((c) =>
        c.topLevel && c.personaId !== null && c.personaId !== p.authorPersonaId)
      const inWindow = eligible.filter((c) =>
        c.createdAtMs >= p.publishedAtMs && c.createdAtMs - p.publishedAtMs <= AUTO_FIRST_COMMENT_WINDOW_MS)
      if (inWindow.length >= 1) firstOk += 1
      else if (eligible.length > 0) codes.add('COMMENT_LATE')
      else codes.add('COMMENT_MISSING')
    }
    counts.firstCommentOk = firstOk
    if (facts.orphanPublishLogs > 0) codes.add('PUBLISH_LOG_ORPHAN')
    if (facts.unloggedPublishes > 0) codes.add('UNLOGGED_PUBLISH')
    // ④ 감사 — 대상 가르기 → 표본 수 → 행마다
    const targets = facts.posts.filter((p) => p.decider === 'auto')
    const human = facts.posts.filter((p) => p.decider === 'human').length
    const unknownDecider = facts.posts.filter((p) => p.decider === 'unknown').length
    const expected = auditTarget(targets.length)
    const covered = targets.filter((p) => p.audited).length
    counts.auditTargets = targets.length
    counts.auditExpected = expected
    counts.auditCovered = covered
    counts.humanReviewed = human
    // 🔴 대상인지 모르는 글 — 감사 0 을 "대상 없음" 으로 읽지 않는다
    if (unknownDecider > 0) codes.add('AUDIT_TARGET_UNKNOWN')
    if (targets.length > 0 && covered === 0) codes.add('AUDIT_COVERAGE_ZERO')
    else if (covered < expected) codes.add('AUDIT_COVERAGE_SHORT')
    const a = facts.audits
    counts.auditRows = a.rows.length
    if (a.rows.some((r) => !r.judged)) codes.add('AUDIT_UNJUDGED')
    if (a.rows.some((r) => r.defectYes) || a.globalDefectYes > 0) codes.add('AUDIT_DEFECT')
    if (a.rows.some((r) => r.overdue) || a.globalOverdue > 0) codes.add('AUDIT_OVERDUE')
    if (a.rows.some((r) => r.retryable) || a.globalRetryable > 0) codes.add('AUDIT_RETRYABLE')
    if (a.globalMissingPosts > 0) codes.add('AUDIT_MISSING_POST')
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
  return { kstDate, stage, verdict, codes: ordered, counts }
}

/** 🔴 결정 reasons 에 남기는 한 줄 — 코드와 개수만 */
export function evidenceReasonOf(v: StageEvidenceVerdict): string {
  const n = Object.entries(v.counts).map(([k, x]) => `${k}=${x}`).join(',')
  return `EVIDENCE ${v.kstDate} ${v.stage} ${v.verdict}${v.codes.length > 0 ? ` [${v.codes.join(',')}]` : ''}${n === '' ? '' : ` (${n})`}`
}

export type TrialPlan = { base: ReleaseStage; target: ReleaseStage; basis: TrialBasis }

/**
 * 🔴 **오늘 무엇을 시험하는가 — 전날 결정 + 전날 운영 증거로만 정한다.**
 *
 *    · 전날 단계 S 가 운영 PASS            → S 의 다음 칸을 시험한다 (`PASS` · 기반 S)
 *    · 전날이 TRIAL 인데 PASS 가 아니다     → **같은 단계를 다시** 시험한다 (`RETEST` · 기반은 전날 시험 기반)
 *    · 전날 공개가 바닥(d1)이다             → 바닥의 다음 칸을 시험한다 (`FLOOR` · 증명할 아래 칸이 없다)
 *    · 그 밖(증거 없는 d3 이상 유지 날)      → 시험하지 않는다 — 지금 단계를 지킨다
 *
 *    🔴 PASS 는 `kstDate`·`stage` 가 전날 결정과 **정확히** 같은 증거만 받는다 — 다른 날의 PASS 로 올리지 않는다.
 */
export function trialPlanOf(
  prev: ValidatedStageDecision, evidence: StageEvidenceVerdict | null,
): TrialPlan | null {
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
  if (prev.release === SAFEST_STAGE) {
    const up = nextStage(SAFEST_STAGE)
    return up === null ? null : { base: SAFEST_STAGE, target: up, basis: 'FLOOR' }
  }
  return null
}
