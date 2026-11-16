/**
 * 🔴 **단계 controller — 사다리(`planStageDecision`) 위에 운영 신호 브레이크를 얹는다** (2026-09-28 · 2026-09-30 단순화)
 *
 * 🔴 **새 문턱값을 만들지 않는다.** 판정은 전부 정본이 한다:
 *    · 시험 대상    `trialPlanOf`(전날 결정 + 전날 운영 증거 + 이어진 계획) → TRIAL / RETEST · 계획 없음 = 평상일(다음 단계 preflight PASS 인 날만 현재 단계 재인증 REPROVE)
 *    · 다음 칸      `judgeNextPreflight`(D3~D100 한 함수) — 기회 · 처리량 · 지연 · Persona · 비용 · 러너
 *    · 운영 증거    `judgeStageEvidence`(조항 ⑦ source-slot-v1 도장 포함)
 *    · 품질        자동 READY 감사 정본 — 확정 결함 · 글 유실 · 재시도 가능 실패 · 판정 시한 초과(6h)
 *    · 비용        장부 정본의 막는 코드 — LEDGER_ERROR · SETTLE_ERROR · UNSETTLED_OVERRUN · DAILY_EXHAUSTED
 *    · 오류        발행·공급 job 의 최근 회차 실패(launchd 종료 값 + 회차 기록)
 *
 * 🔴 **지운 입력 (2026-09-30)** — 14일 준비도(`stageVerdicts`/`safeStageFor`) · 하루 시뮬레이션(`judgeOneDayCanary`) ·
 *    지속 승격(`judgePromotion` · `d100:readiness` 자식 프로세스) · env 단계(`SORAN_RELEASE_STAGE`)와 env 천장
 *    (`SORAN_CAPACITY_STAGE`) · canary/window 허가. **현재 단계의 입력원은 StageDecision 하나다.**
 *
 * 🔴 **브레이크의 두 모양.**
 *    · 신호가 `bad`     → **감속**: 지속 공개 단계의 바로 아래 칸. 승격·시험·증명일 없음.
 *    · 신호가 `unknown` → **유지**: 승격·시험·증명일만 막는다. 지금 단계를 지킨다.
 *
 * 🔴 **controller 실패는 지금 공개 단계를 지킨다(fail-closed · keep current).**
 *
 * 🔴 순수 함수다 — DB · 파일 · 시각 조회 0.
 */
import {
  RUNTIME_STAGES, SAFEST_STAGE, stageRank, profileOf, RELEASE_ENV, CAPACITY_ENV,
  type RuntimeStage,
} from './scale-profile'
import { planStageDecision, preparedStageOf } from './stage-ladder'
import {
  DECISION_WRITER, STAGE_DECISION_VERSION, validateStoredDecision, isLegacyDecision, previousKstDate,
  type StageDecision, type ValidatedStageDecision,
} from './stage-decision-contract'
import { PROOF_DATE_ENV, PROOF_ENV_KEYS, PROOF_STAGE_ENV } from './stage-proof-day'
import { STAGE_DECISION_MARK_ENV } from './scale-runtime'
import type { ConsumeOutcome } from './stage-decision-store'
import type { StageEvidenceVerdict, TrialPlan } from './stage-evidence'
import type { PreflightVerdict } from './stage-ladder-generic'
import type { Health } from './ops-status'

/** 🔴 브레이크가 보는 축 */
export const SIGNAL_AXES = ['quality', 'cost', 'errors'] as const
export type SignalAxis = (typeof SIGNAL_AXES)[number]

export type HealthSignal = {
  axis: SignalAxis
  health: Health
  reasons: readonly string[]
}

/** 🔴 바로 아래 칸 — `nextStage` 의 거울(러너 단계 위). d1 아래는 없다 */
export function previousStage(s: RuntimeStage): RuntimeStage {
  const i = RUNTIME_STAGES.indexOf(s)
  return i <= 0 ? SAFEST_STAGE : RUNTIME_STAGES[i - 1]!
}

const lower = (a: RuntimeStage, b: RuntimeStage): RuntimeStage => (stageRank(a) <= stageRank(b) ? a : b)

/**
 * 🔴 **증명된 지속 공개 단계 — StageDecision 하나에서만 온다** (2026-09-30).
 *    · 전날 결정이 없다 → 바닥(d1). env(`SORAN_RELEASE_STAGE`)를 읽지 않는다
 *    · 전날 결정이 옛 판(v4 · source-slot-v1 이전) → 바닥(d1) — 옛 계약의 단계는 근거가 아니다(재증명)
 *    · 전날이 TRIAL 이고 그날 운영 증거가 PASS 면 **그 시험 단계**(증명됐다 · PR3 KEEP)
 *    · 전날이 TRIAL 인데 PASS 가 아니면 그 **시험 기반**
 *    · 전날이 인증보다 낮춘 HOLD·PREPARE(`transition.kind === 'CERTIFIED'`)면 그 **인증 단계**
 *      — brake·lease HOLD 가 낮춘 공개는 그날 하루의 값이다. 인증 권한은 행 하나가 들고 간다(이력 검색 없음)
 *    · 그 밖(HOLD · PREPARE · REPROVE)이면 전날 공개 단계
 *    · 인증 칸이 없는 HOLD·PREPARE 는, controller 가 되짚은 `carriedPlan` 의 기반이 전날 공개보다 높으면 그 기반을 쓴다.
 *      🔴 `READER_READY` 판(`CERTIFIED_ROLLOUT_PHASE`)에서는 controller 가 새 행에도 인증 칸을 쓰지 않으므로
 *      새 감속 행도 이 길을 탄다(3일 이월 밖이면 감속 공개가 남는다). writer 활성 뒤에는 옛 행만 이 길을 탄다
 */
export function sustainedReleaseOf(
  prev: ValidatedStageDecision | null, evidence: StageEvidenceVerdict | null = null,
  carried: TrialPlan | null = null,
): RuntimeStage {
  if (prev === null || isLegacyDecision(prev)) return SAFEST_STAGE
  if (prev.state === 'TRIAL' && prev.transition !== null && prev.transition.kind === 'TRIAL') {
    const passed = evidence !== null && evidence.verdict === 'PASS'
      && evidence.kstDate === prev.kstDate && evidence.stage === prev.release
    return passed ? prev.release : prev.transition.trialBase
  }
  if (prev.state !== 'HOLD' && prev.state !== 'PREPARE') return prev.release
  if (prev.transition !== null && prev.transition.kind === 'CERTIFIED') return prev.transition.certified
  if (prev.transition === null && carried !== null
    && stageRank(carried.base) > stageRank(prev.release)) return carried.base
  return prev.release
}

/**
 * 🔴 **`CERTIFIED` 배포 단계 — 코드 상수 하나다** (2026-11-02 H2). env · 문자열 파싱으로 바꾸지 않는다.
 *    · `READER_READY`  — validator · `sustainedReleaseOf` 는 `CERTIFIED` 행을 읽지만, controller 는 **쓰지 않는다**.
 *    · `WRITER_ACTIVE` — controller 가 인증보다 낮춘 HOLD·PREPARE 에 `CERTIFIED` 를 쓴다.
 *    🔴 **이 판은 `READER_READY` 다.** 옛 runtime 의 validator 는 `CERTIFIED` 가 붙은 HOLD·PREPARE 를 깨진 행으로 거절한다.
 *       reader 판이 운영에 배포되어 rollback 대상까지 이 칸을 읽을 수 있게 된 뒤에만, **별도 writer 활성 릴리스**에서
 *       이 값을 `WRITER_ACTIVE` 로 바꾼다. 한 번에 둘을 켜면 rollback 한 runtime 이 다음 날 전날 행을 못 읽어 멈춘다.
 *    🔴 reader 판에서는 `BRAKE_DEMOTION_PERSISTS` 가 **다 닫히지 않았다** — 3일 이월 계획(`carriedPlan`)이 닿는 감속만
 *       인증을 되찾고, 인증 PASS 가 이월 밖이면 감속 release 가 다음 날 지속 단계로 남는다. writer 활성이 그 나머지를 닫는다.
 */
export type CertifiedRolloutPhase = 'READER_READY' | 'WRITER_ACTIVE'
export const CERTIFIED_ROLLOUT_PHASE: CertifiedRolloutPhase = 'READER_READY'

/**
 * 🔴 인증보다 낮춘 날만 인증 권한을 따로 적는다 — 같으면 전이 근거 없음. `READER_READY` 면 언제나 `null`(write 0).
 *    🔴 `CERTIFIED` 를 **쓰는 곳은 이 함수 하나**다. 읽는 쪽(validator · `sustainedReleaseOf`)과 떨어져 있다.
 */
export function certifiedProvenanceOf(
  phase: CertifiedRolloutPhase, release: RuntimeStage, certified: RuntimeStage,
): StageDecision['transition'] {
  if (phase !== 'WRITER_ACTIVE') return null
  return stageRank(certified) > stageRank(release) ? { kind: 'CERTIFIED', certified } : null
}
const certifiedProvenance = (release: RuntimeStage, certified: RuntimeStage): StageDecision['transition'] =>
  certifiedProvenanceOf(CERTIFIED_ROLLOUT_PHASE, release, certified)

export type ControllerInputs = {
  kstDate: string
  decidedAt: string
  previousDecision: ValidatedStageDecision | null
  /** 🔴 전날 운영 증거 — PASS 가 아니면(FAIL · 모름 · 없음) 올라가지 않고 같은 단계를 다시 시험한다 */
  previousEvidence?: StageEvidenceVerdict | null
  /** 🔴 전날(브레이크 날)이 이은 계획 — `trialPlanThrough` 로 되짚은 값 */
  carriedPlan?: TrialPlan | null
  /** 🔴 시험 대상의 preflight(`judgeNextPreflight`) — 모든 단계 같은 관문 */
  nextPreflight: PreflightVerdict | null
  publishedToday: number
  signals: readonly HealthSignal[]
}

export type ControllerResult = {
  decision: StageDecision
  /** 🔴 브레이크가 무엇을 했는가 — 없으면 `none` */
  brake: 'none' | 'slowdown' | 'holdUnknown' | 'controllerFailure'
  sustained: RuntimeStage
}

/**
 * 🔴 **controller 실패 — 지금 공개 단계를 지킨다.** 상태는 HOLD, 전이 근거 없음. 이유를 남긴다.
 */
export function holdAtCurrent(input: {
  kstDate: string; decidedAt: string; current: RuntimeStage; reason: string; headline?: string
  /** 🔴 공개보다 높은 인증 단계 — writer 활성 판에서만 행에 남는다(`certifiedProvenance`) · 없으면 공개 그대로 */
  certified?: RuntimeStage
}): StageDecision {
  const release = input.current
  return {
    kstDate: input.kstDate, capacity: release, release, state: 'HOLD',
    reasons: [
      input.headline ?? `🔴 controller 입력 실패 — 지금 공개 단계 ${release} 를 지킨다(fail-closed · 올리지도 내리지도 않는다)`,
      `🔴 ${input.reason}`,
    ],
    blocks: [], dayPinned: false, supply: null, decidedAt: input.decidedAt,
    contractVersion: STAGE_DECISION_VERSION, decidedBy: DECISION_WRITER,
    transition: certifiedProvenance(release, input.certified ?? release),
  }
}

/**
 * 🔴 **오늘 신호를 판정하지 못한 HOLD 의 공개** — 전날 보이던 공개와 인증 중 낮은 쪽.
 *    인증 복원(올리기)은 품질·비용·오류를 본 정상 controller 경로에서만 한다.
 */
export function heldReleaseOf(prev: ValidatedStageDecision | null, certified: RuntimeStage): RuntimeStage {
  return prev === null || isLegacyDecision(prev) ? certified : lower(prev.release, certified)
}

/** 🔴 오늘 결정의 권한 중 멈춤이 아닌 것 — 신호를 못 본 HOLD 가 어느 행에 기대는지 호출자가 밝힌다 */
export type SignalBlindAuthority = Exclude<PreviousAuthority, { kind: 'stop' }>

/** 🔴 권한 행 — 전날 행(exact) · 이틀 전 행(bridge) · 없음(first-run) */
export function authorityRowOf(a: SignalBlindAuthority): ValidatedStageDecision | null {
  return a.kind === 'exact' ? a.previous : a.kind === 'bridge' ? a.bridge : null
}

/**
 * 🔴 **신호를 보지 못한 HOLD 의 보이는 공개 — 이 규칙의 단일 자리** (입력 실패 · 공급 lease 안전 HOLD).
 *    · exact              — 인접한 전날 행이 보이던 공개와 인증 중 낮은 쪽(`heldReleaseOf`)
 *    · bridge · first-run — 전날 행이 없어 consumer 는 오늘 결정 전에 d1 을 본다. 이틀 전 공개를 되살리지 않고
 *      **바닥(d1)을 보이게 붙잡는다**. 숨은 인증 권한(`certified`)은 행에 남길 수 있으나, 쓰는 것은
 *      `WRITER_ACTIVE` 판뿐이다(`READER_READY` 면 `CERTIFIED` 0)
 */
export function signalBlindReleaseOf(authority: SignalBlindAuthority, certified: RuntimeStage): RuntimeStage {
  return authority.kind === 'exact' ? heldReleaseOf(authority.previous, certified) : SAFEST_STAGE
}

/** 🔴 **입력 실패 HOLD** — 오늘 신호를 판정하지 못했다. 공개는 `signalBlindReleaseOf`, 인증은 행에 따로 남긴다 */
export function inputFailureHoldOf(input: {
  kstDate: string; decidedAt: string; authority: SignalBlindAuthority; certified: RuntimeStage; reason: string
}): StageDecision {
  return holdAtCurrent({
    kstDate: input.kstDate, decidedAt: input.decidedAt, reason: input.reason, certified: input.certified,
    current: signalBlindReleaseOf(input.authority, input.certified),
  })
}

/**
 * 🔴 **공급 lease 안전 HOLD** — 마지막 controller 예약에도 공급 lease 가 busy·unknown 인 날.
 *    오늘 품질·비용·오류 신호를 보지 않았으므로 **전날 보이던 공개보다 올리지 않는다**(`signalBlindReleaseOf`).
 *    인증 권한은 공개와 따로 이어 준다 — 다음 정상 controller 가 신호를 보고 복원한다.
 *    전날 행이 없으면(bridge · first-run) 공개는 바닥(d1)이다.
 */
export function leaseSafeHoldOf(input: {
  kstDate: string; decidedAt: string; lease: 'busy' | 'unknown'
  authority: SignalBlindAuthority
  previousEvidence: StageEvidenceVerdict | null
  carriedPlan: TrialPlan | null
}): { decision: StageDecision; certified: RuntimeStage } {
  const certified = sustainedReleaseOf(authorityRowOf(input.authority), input.previousEvidence, input.carriedPlan)
  const current = signalBlindReleaseOf(input.authority, certified)
  const decision = holdAtCurrent({
    kstDate: input.kstDate, decidedAt: input.decidedAt, current, certified,
    headline: `🟡 공급 lease 충돌 — 공개 ${current} 를 안전 HOLD한다(부분 재고·오늘 신호 없이 올리지 않는다 · 인증 ${certified})`,
    reason: `마지막 controller 예약에도 공급 lease가 ${input.lease} — 오늘의 부분 재고를 읽지 않고 승격을 막는다`,
  })
  return { decision, certified }
}

/** 🔴 한 날짜의 저장 결정 판독 — 없음과 깨짐을 가른다. 읽기 예외는 부르는 쪽이 던진다 */
export type DecisionRead =
  | { kind: 'valid'; decision: ValidatedStageDecision }
  | { kind: 'absent' }
  | { kind: 'broken'; reason: string }

/** 🔴 오늘 결정의 권한 출처 — 전날 행 · 이틀 전 행(다리) · 첫 시작 · 멈춤(계산·저장 0) */
export type PreviousAuthority =
  | { kind: 'exact'; previous: ValidatedStageDecision }
  | { kind: 'bridge'; bridge: ValidatedStageDecision }
  | { kind: 'first-run' }
  | { kind: 'stop'; code: 'PREVIOUS_BROKEN' | 'PREVIOUS_READ_ERROR'; reason: string }

/**
 * 🔴 **전날 결정의 권한을 정한다 — 최대 이틀 전 행 하나까지만 읽는다** (2026-11-02 M3).
 *    · 전날 행이 유효 → 그 행(정상 연속)
 *    · 전날 행이 깨짐 · 읽기 예외 → **멈춤**. 대체 d1 결정을 계산·저장하지 않는다 — 다음 예약이 다시 읽는다.
 *      깨진 전날 행을 이틀 전 행으로 건너뛰지 않는다
 *    · 전날 행이 없음 → 이틀 전 행만 본다. 유효 → 다리(시험 없이 권한만 잇는다) · 없음 → 첫 시작(d1) ·
 *      깨짐 · 예외 → 멈춤. 그보다 앞은 읽지 않는다
 */
export async function resolvePreviousAuthority(
  today: string, read: (kstDate: string) => Promise<DecisionRead>,
): Promise<PreviousAuthority> {
  const exactDate = previousKstDate(today)
  const bridgeDate = exactDate === null ? null : previousKstDate(exactDate)
  if (exactDate === null || bridgeDate === null) {
    return { kind: 'stop', code: 'PREVIOUS_READ_ERROR', reason: `오늘 날짜가 달력에 없다 — ${today}` }
  }
  const at = async (date: string): Promise<DecisionRead | { kind: 'error'; reason: string }> => {
    try { return await read(date) } catch (e) { return { kind: 'error', reason: (e as Error).name } }
  }
  const exact = await at(exactDate)
  if (exact.kind === 'valid') return { kind: 'exact', previous: exact.decision }
  if (exact.kind === 'broken') return { kind: 'stop', code: 'PREVIOUS_BROKEN', reason: `전날(${exactDate}) 결정이 깨졌다 — ${exact.reason}` }
  if (exact.kind === 'error') return { kind: 'stop', code: 'PREVIOUS_READ_ERROR', reason: `전날(${exactDate}) 결정을 읽지 못했다 — ${exact.reason}` }
  const bridge = await at(bridgeDate)
  if (bridge.kind === 'valid') return { kind: 'bridge', bridge: bridge.decision }
  if (bridge.kind === 'absent') return { kind: 'first-run' }
  return {
    kind: 'stop', code: bridge.kind === 'broken' ? 'PREVIOUS_BROKEN' : 'PREVIOUS_READ_ERROR',
    reason: `전날(${exactDate}) 결정이 없고 이틀 전(${bridgeDate}) 결정을 ${bridge.kind === 'broken' ? '판독하지 못했다(깨짐)' : '읽지 못했다'} — ${bridge.reason}`,
  }
}

/**
 * 🔴 **다리 날 — 전날 행이 없고 이틀 전 행만 유효한 날** (2026-11-02 M3).
 *    인접하지 않은 행으로 시험·증명일·재인증을 열지 않는다 — HOLD·PREPARE 만 쓴다.
 *    공개는 이틀 전 공개와 인증 중 낮은 쪽이고, 나쁜 신호면 인증 아래 칸까지 낮춘다.
 *    인증 권한(`CERTIFIED`)은 writer 활성 판에서만 행에 남는다(`CERTIFIED_ROLLOUT_PHASE`) — reader 판은 쓰지 않는다.
 */
export function bridgeHoldOf(i: {
  kstDate: string; decidedAt: string
  bridge: ValidatedStageDecision; bridgeEvidence: StageEvidenceVerdict | null
  publishedToday: number; signals: readonly HealthSignal[]
}): ControllerResult {
  const sustained = sustainedReleaseOf(i.bridge, i.bridgeEvidence)
  const bad = i.signals.filter((s) => s.health === 'bad')
  const held = heldReleaseOf(i.bridge, sustained)
  const target = bad.length > 0 ? lower(held, previousStage(sustained)) : held
  const base = holdAtCurrent({
    kstDate: i.kstDate, decidedAt: i.decidedAt, current: target, certified: sustained,
    headline: `🟡 전날 결정이 없다 — 이틀 전(${i.bridge.kstDate}) 결정으로 권한만 잇고 공개 ${target} 를 HOLD한다(시험 없음 · 인증 ${sustained})`,
    reason: '인접하지 않은 결정으로는 시험·증명일을 열지 않는다',
  })
  const reasons = [...base.reasons, ...bad.map((s) => `🔴 감속(${s.axis}): ${s.reasons.join(' · ') || '나쁨'}`)]
  return {
    decision: finishHold(base, target, sustained, i.publishedToday, reasons),
    brake: bad.length > 0 ? 'slowdown' : 'holdUnknown', sustained,
  }
}

/** 🔴 브레이크가 정한 공개로 결정을 닫는다 — 시험·증명일 없음 */
function finishHold(d: StageDecision, release: RuntimeStage, sustained: RuntimeStage, publishedToday: number,
  reasons: string[]): StageDecision {
  let rel = release
  let dayPinned = d.dayPinned
  // 오늘 이미 낸 편수가 낮춘 단계의 하루 목표를 넘으면 오늘은 지속 단계를 고정한다(이미 낸 것이 상한 초과가 된다)
  if (stageRank(rel) < stageRank(sustained) && publishedToday > profileOf(rel).dailyTarget) {
    reasons.push(`🔴 오늘 이미 ${publishedToday}건 냈다 — ${rel} 로 내리면 상한 초과다. 오늘은 ${sustained} 를 고정한다`)
    rel = sustained
    dayPinned = true
  }
  const capacity = preparedStageOf(rel)
  const state = stageRank(capacity) > stageRank(rel) ? 'PREPARE' as const : 'HOLD' as const
  return { ...d, capacity, release: rel, state, transition: certifiedProvenance(rel, sustained), dayPinned, reasons }
}

/**
 * 🔴 **하루 결정.** 사다리를 먼저 부르고, 운영 신호 브레이크를 그 위에 얹는다.
 *    브레이크는 **내리거나 붙잡기만** 한다 — 어떤 경우에도 사다리보다 높게 올리지 않는다.
 */
export function decideStage(i: ControllerInputs): ControllerResult {
  const sustained = sustainedReleaseOf(i.previousDecision, i.previousEvidence ?? null, i.carriedPlan ?? null)
  const planned = planStageDecision({
    kstDate: i.kstDate, sustainedRelease: sustained, previousDecision: i.previousDecision,
    previousEvidence: i.previousEvidence ?? null, carriedPlan: i.carriedPlan ?? null,
    nextPreflight: i.nextPreflight, publishedToday: i.publishedToday, decidedAt: i.decidedAt,
  })
  const bad = i.signals.filter((s) => s.health === 'bad')
  const unknown = i.signals.filter((s) => s.health === 'unknown')
  if (bad.length > 0) {
    const target = lower(planned.release, previousStage(sustained))
    const reasons = [
      ...planned.reasons,
      ...bad.map((s) => `🔴 감속(${s.axis}): ${s.reasons.join(' · ') || '나쁨'}`),
      `🔴 운영 신호 ${bad.map((s) => s.axis).join('·')} 가 나쁘다 — 시험·증명일 없이 ${sustained} → ${target}`,
    ]
    return { decision: finishHold(planned, target, sustained, i.publishedToday, reasons), brake: 'slowdown', sustained }
  }
  /**
   * 🔴 모르는 신호로 올리지 않는다. REPROVE(증명일)도 되돌린다 — 품질·비용·오류를 모르는 날 자동 target 을 앞세우지 않는다.
   */
  if (unknown.length > 0 && (planned.state === 'TRIAL' || planned.state === 'REPROVE')) {
    const reasons = [
      ...planned.reasons,
      ...unknown.map((s) => `⬚ 모름(${s.axis}): ${s.reasons.join(' · ') || '관측 없음'}`),
      `🔴 ${planned.state} 를 되돌린다 — 운영 신호 ${unknown.map((s) => s.axis).join('·')} 를 확인하지 못했다. ${sustained} 를 지킨다`,
    ]
    return { decision: finishHold(planned, sustained, sustained, i.publishedToday, reasons), brake: 'holdUnknown', sustained }
  }
  if (unknown.length > 0) {
    return {
      decision: { ...planned, reasons: [...planned.reasons, ...unknown.map((s) => `⬚ 모름(${s.axis}): ${s.reasons.join(' · ') || '관측 없음'}`)] },
      brake: 'none', sustained,
    }
  }
  return { decision: planned, brake: 'none', sustained }
}

/** 🔴 저장 전 검증 — 정본 validator 한 벌. 통과 못 하면 저장하지 않는다 */
export function validateForToday(d: StageDecision): ReturnType<typeof validateStoredDecision> {
  return validateStoredDecision({ row: d, expectKstDate: d.kstDate })
}

// ─────────────────────────────────────────────────────────
// 🔴 consumer — 러너가 실제로 읽는 env 로 옮긴다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **결정을 러너 env 로 옮긴다** — 결정이 유일한 단계 입력이다(2026-09-30).
 *    · 결정 OK      → 공개 = 결정의 `release`(TRIAL 이면 시험 단계 그대로) · 준비 눈금 = `capacity`
 *                     · 증명일(TRIAL · REPROVE)이면 증명일 두 칸(`stage-proof-day`), 🔴 평상일(HOLD · PREPARE)은 빈 값
 *                       (빈 값 = 0..Dn · 자동 target 앞세움 없음 · exact N 강제 없음)
 *    · safest      → 결정이 없거나 깨졌다 · controller flag OFF(kill switch) → d1
 * 🔴 **legacy(아무것도 넣지 않아 env 파일의 단계가 이기던 경로)는 지웠다** (2026-09-30 · Lane A).
 *    그 경로에서는 `.env.local` · GitHub Variables 의 손으로 적은 단계가 결정을 대신했다 — 두 번째 권위다.
 * 🔴 결정 OK 일 때만 **표식**(`STAGE_DECISION_MARK_ENV` = 결정의 KST 날짜)을 넣는다. 표식 없는 단계 칸은
 *    `scale-runtime.decisionStageEnv` 가 읽지 않는다(= d1) — safest 에 표식을 붙이지 않아도 결과는 같다.
 * 🔴 **canary · window 는 없다** — 앞판은 TRIAL 을 "기반 + canary 허가" 로 옮겨 러너가 14일 준비도로
 *    다시 깎았다(09-29 TRIAL d3 → 러너 d1). 이제 러너는 결정의 단계를 그대로 쓴다.
 */
export function consumerEnvOf(o: ConsumeOutcome): Record<string, string> {
  const blankProof = Object.fromEntries(PROOF_ENV_KEYS.map((k) => [k, '']))
  if (o.ok) {
    const proof = o.decision.state === 'TRIAL' || o.decision.state === 'REPROVE'
      ? { [PROOF_STAGE_ENV]: o.decision.release, [PROOF_DATE_ENV]: o.decision.kstDate }
      : blankProof
    return {
      [RELEASE_ENV]: o.decision.release,
      [CAPACITY_ENV]: o.decision.capacity,
      [STAGE_DECISION_MARK_ENV]: o.decision.kstDate,
      ...proof,
    }
  }
  return { [RELEASE_ENV]: SAFEST_STAGE, [CAPACITY_ENV]: SAFEST_STAGE, [STAGE_DECISION_MARK_ENV]: '', ...blankProof }
}

// ─────────────────────────────────────────────────────────
// 🔴 신호 만들기 — 정본 값을 그대로 옮긴다. 새 문턱값 0
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **품질** — 자동 READY 감사 정본이 자동 회차를 닫는 네 가지 중 하나라도 있으면 나쁘다.
 *    (지금 계약에서 해소되지 않은 확정 결함 yes · 글 유실 · 재시도 가능 감사 실패 · 판정 시한 초과) 못 읽었으면 모른다.
 */
export function qualitySignalOf(c: {
  unresolvedDefects: number; missingPosts: number; retryableFailures: number; overdueAudits: number
} | null, readError: string | null = null): HealthSignal {
  if (c === null) return { axis: 'quality', health: 'unknown', reasons: [`감사 표를 읽지 못했다 — ${readError ?? '이유 모름'}`] }
  const reasons: string[] = []
  if (c.unresolvedDefects > 0) reasons.push(`미해소 확정 결함 ${c.unresolvedDefects}건`)
  if (c.missingPosts > 0) reasons.push(`글이 사라진 자동 발행 ${c.missingPosts}건`)
  if (c.retryableFailures > 0) reasons.push(`재시도 가능 감사 실패 ${c.retryableFailures}건`)
  if (c.overdueAudits > 0) reasons.push(`판정 시한 초과 감사 ${c.overdueAudits}건`)
  return { axis: 'quality', health: reasons.length > 0 ? 'bad' : 'ok', reasons }
}

/** 🔴 **비용** — 장부 판정(`judgeCost`)을 합친다. 나쁨이 이기고, 나쁨이 없을 때 모름이 이긴다 */
export function costSignalOf(parts: readonly { name: string; health: Health; reasons: readonly string[] }[]): HealthSignal {
  const bad = parts.filter((p) => p.health === 'bad')
  if (bad.length > 0) return { axis: 'cost', health: 'bad', reasons: bad.map((p) => `${p.name}: ${p.reasons.join(' · ')}`) }
  const unk = parts.filter((p) => p.health === 'unknown')
  if (unk.length > 0) return { axis: 'cost', health: 'unknown', reasons: unk.map((p) => `${p.name}: ${p.reasons.join(' · ')}`) }
  return { axis: 'cost', health: 'ok', reasons: [] }
}

/**
 * 🔴 **오류** — 발행·공급 job 의 최근 회차. 실패(`true`)면 나쁘다, 모르면(`null` · load 안 됨) 모른다.
 *    load 가 안 된 job 은 "오류" 가 아니라 "돌지 않는다" 이지만, 그 상태로 승격하지 않는다(모름).
 */
export function errorSignalOf(jobs: readonly { label: string; loaded: boolean; failing: boolean | null }[]): HealthSignal {
  const bad = jobs.filter((j) => j.loaded && j.failing === true)
  if (bad.length > 0) return { axis: 'errors', health: 'bad', reasons: bad.map((j) => `${j.label} 최근 회차 실패`) }
  const unk = jobs.filter((j) => !j.loaded || j.failing === null)
  if (unk.length > 0) {
    return {
      axis: 'errors', health: 'unknown',
      reasons: unk.map((j) => `${j.label} ${j.loaded ? '최근 회차 성패 모름' : 'load 되어 있지 않다'}`),
    }
  }
  return { axis: 'errors', health: 'ok', reasons: [] }
}
