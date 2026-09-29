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
 *      ② **자동 target 물량** = `PROFILES[S].dailyTarget` 이상 — 자동 READY 도장(`AUTO_DECIDER`)으로
 *         만들어져 **무인 러너 표식**으로 예약 발행된 글만 센다(2026-09-29 마스터 최종 보정).
 *         🔴 사람이 승인한 글은 정상 발행·감사 면제일 수 있지만 **자동화 성공 물량으로는 0건**이다.
 *            혼합 물량도 자동 target 만 센다. 모자라면 `PUBLISH_NOT_AUTO_READY`.
 *         🔴 그날 전체 발행(사람 글 포함)이 목표를 넘으면 상한 초과다 → `PUBLISH_OVER`.
 *      ③ 댓글 — 두 판정으로 나눈다 (2026-09-29 마스터 보정).
 *         (a) **첫 댓글 보장** — **자동 target 글마다** Persona 최상위 댓글(글쓴 Persona 아님)이 발행 후
 *             `AUTO_FIRST_COMMENT_WINDOW_MINUTES` 안에 **1건 이상**.
 *         (b) **추가 댓글 계약** — 글당 Persona 댓글 수 ≤ 그 댓글 단계의 상한(`personaCommentCapFor`) ·
 *             같은 Persona 두 번 0 · 자기 글 0. 🔴 "60분 안 2건" 자체는 실패가 아니다 — 상한을 넘을 때만이다.
 *             (bootstrap-auto 의 상한 1 이 "글당 정확히 1건" 을 지금 그대로 지킨다. 장기 1~5 는 상한 5 로 같은 판정이 받는다)
 *      ④ 사후 감사 — 🔴 **전수 감사가 아니라 정본 표본 계약이다** (마스터 정본 정정).
 *         그날 자동 target N 에 대해 expected = `auditTarget(N)` = ceil(N × 20%) (N>0 이면 최소 1).
 *         · 중복 없는 표본(글 기준) 수 ≥ expected — 0 이면 `AUDIT_COVERAGE_ZERO`, 미달이면 `AUDIT_COVERAGE_SHORT`
 *         · 표본은 **그날 자동 target 집합**에 속해야 한다(postId · queueId 둘 다) — 밖이면 `AUDIT_OUTSIDE_TARGET`
 *         · 표본은 전부 판정됐고 결함 yes · 재시도 가능 · 시한 초과 · 글 유실 0
 *         🔴 모든 글의 감사를 새 선행조건으로 만들지 않는다 — 그것은 새 병목이다.
 *         · 누가 결정했는지 모르는 글은 자동 target 인지도 모른다 → UNKNOWN(공백을 PASS 로 삼키지 않는다).
 *      ⑤ 중복 0 — Queue→Post 1:1 · 발행 기록 1:1 · (글, Persona) 댓글 1건.
 *      ⑥ 비용 · 러너 정상 — 그날 장부(공급 · 댓글 · 감사)에 막는 코드 0 · 발행/공급 러너 실패 0.
 *         (READY 재고가 다음 단계를 채우는가는 정본 `judgeOneDayCanary` 가 시험 대상에 대해 본다)
 *
 * 🔴 **fail-closed = 지금 단계에 머문다.** 하나라도 어긋나면 FAIL, 하나라도 못 읽으면 UNKNOWN.
 *    둘 다 PASS 가 아니다 — 올라가지 않고 **같은 단계를 다음 날 다시 시험**한다(`trialPlanOf`).
 *    이 게이트는 하루를 비우지 않는다 — 올라갈 칸을 막을 뿐, 지금 공개 단계는 그대로 둔다.
 *
 * 🔴 **범위 — D3 · D5 · D10 전이까지만 닫는다.** `RELEASE_STAGES` 는 d1~d10 이고 `nextStage(d10)` 은 없다.
 *    D20 이상은 운영 release profile · 저장 계약 · 러너 배선이 아직 없다 —
 *    이 파일이 여는 것이 아니라 **별도 blocker** 다. D10 PASS 뒤 계획은 `null`(시험 없음)이다.
 *    🔴 D20~D100 의 판정 골격은 `stage-ladder-generic` 에 있다 — 판정 본체(`judgeEvidenceForTarget`)는
 *       이 파일 하나를 같이 쓴다. 그 골격은 운영 controller 에 **배선되지 않았다**.
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
  'PUBLISH_NOT_AUTO_READY', 'PUBLISH_OVER',
  // ③ 첫 댓글
  'COMMENT_MISSING', 'COMMENT_LATE', 'COMMENT_OVER_CAP', 'COMMENT_SELF', 'COMMENT_CAP_UNKNOWN',
  // ④ 감사
  'AUDIT_TARGET_UNKNOWN', 'AUDIT_COVERAGE_ZERO', 'AUDIT_COVERAGE_SHORT', 'AUDIT_OUTSIDE_TARGET',
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
}
export type StageEvidenceVerdict = EvidenceVerdictFor<ReleaseStage>

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
  /** 이 글의 살아 있는 Persona 댓글 전부 */
  personaComments: readonly { personaId: string | null; createdAtMs: number; topLevel: boolean }[]
}

/**
 * 🔴 단계 칸만 일반화한 사실 묶음 — `StageEvidenceFacts` 는 d1~d10 판이다.
 *    결정 칸도 `release` 를 문자열로 받는다(D20 이상 결정 행은 아직 저장 계약에 없다 — 별도 blocker).
 */
export type EvidenceFactsFor<S extends string> = Omit<StageEvidenceFacts, 'stage' | 'decision'> & {
  stage: S
  decision: { kstDate: string; state: string; release: string; decidedBy: string } | null
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
    /** 🔴 그날 고른 감사 + 그날 글의 감사 — **행마다** 따로 본다. postId·queueId 로 표본 소속을 대조한다 */
    rows: readonly {
      postId: string; queueId: string
      judged: boolean; defectYes: boolean; retryable: boolean; overdue: boolean
    }[]
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
  return judgeEvidenceForTarget(kstDate, stage, PROFILES[stage].dailyTarget, facts, side)
}

/**
 * 🔴 **단계 이름과 하루 목표를 받는 판정 본체** (2026-09-29 generic scheduler 골격).
 *    `judgeStageEvidence` 는 d1~d10(`PROFILES`) 목표로 이것을 부른다 — 동작은 한 글자도 바뀌지 않는다.
 *    D20 이상(`stage-ladder-generic`)은 같은 여섯 조건을 **같은 본체**로 판정한다. 판정 규칙을 두 벌로 적지 않는다.
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
      if (d.state !== 'TRIAL' && d.state !== 'SUSTAIN') codes.add('DECISION_NOT_TRANSITION')
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
      // (a) 첫 댓글 보장 — 🔴 자동 target 글만 · 60분 안 최상위 · 다른 Persona **1건 이상**
      if (!(p.decider === 'auto' && p.unattended)) continue
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
    if (inSet.some((r) => r.defectYes) || a.globalDefectYes > 0) codes.add('AUDIT_DEFECT')
    if (inSet.some((r) => r.overdue) || a.globalOverdue > 0) codes.add('AUDIT_OVERDUE')
    if (inSet.some((r) => r.retryable) || a.globalRetryable > 0) codes.add('AUDIT_RETRYABLE')
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
