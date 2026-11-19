/**
 * 🔴 **단계 controller — 사다리(`planStageDecision`) 위에 운영 신호 브레이크를 얹는다**
 *
 * 🔴 **새 문턱값을 만들지 않는다.** 판정은 전부 정본이 한다:
 *    · 올림        `planStageDecision` — 열린 단계의 하루 판정이 연속 통과하고 올라갈 칸의 관문이 PASS 인 날
 *    · 하루 판정   `judgeStageEvidence` — 수 + 결의 비율 + 무결성(`ladder-table`)
 *    · 품질        자동 READY 감사 정본 — 확정 결함 · 글 유실 · 재시도 가능 실패 · 판정 시한 초과
 *    · 비용        장부 정본의 막는 코드 — LEDGER_ERROR · SETTLE_ERROR · UNSETTLED_OVERRUN · DAILY_EXHAUSTED
 *    · 오류        발행·공급 job 의 최근 회차 실패(launchd 종료 값 + 회차 기록)
 *
 * 🔴 **공개 단계가 내려가는 길은 브레이크 하나다.**
 *    · 신호가 `bad`     → **감속**: 그날 하루 열린 단계의 바로 아래 칸. 열린 단계는 행의 `CERTIFIED` 칸이 다음 날로 들고 간다.
 *    · 신호가 `unknown` → **유지**: 올림만 막는다. 지금 단계를 지킨다.
 *    하루 판정이 미달이어도 내리지 않는다 — 올리지 않을 뿐이다.
 *
 * 🔴 **controller 실패는 지금 공개 단계를 지킨다(fail-closed · keep current).**
 * 🔴 **현재 단계의 입력원은 StageDecision 하나다** — env 단계 값을 읽지 않는다.
 *
 * 🔴 순수 함수다 — DB · 파일 · 시각 조회 0.
 */
import {
  RUNTIME_STAGES, SAFEST_STAGE, stageRank, profileOf, RELEASE_ENV, CAPACITY_ENV,
  type RuntimeStage,
} from './scale-profile'
import {
  planStageDecision, preparedStageOf, openStageHeldBy, consecutivePassDays, type LadderDay,
} from './stage-ladder'
import {
  DECISION_WRITER, STAGE_DECISION_VERSION, validateStoredDecision, isLegacyDecision, previousKstDate,
  type StageDecision, type ValidatedStageDecision,
} from './stage-decision-contract'
import { STAGE_DECISION_MARK_ENV } from './scale-runtime'
import type { ConsumeOutcome } from './stage-decision-store'
import type { StageEvidenceVerdict } from './stage-evidence'
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

const higher = (a: RuntimeStage, b: RuntimeStage): RuntimeStage => (stageRank(a) >= stageRank(b) ? a : b)

/**
 * 🔴 **열린 단계 — StageDecision 행에서만 온다.** 전날 행이 들고 있는 단계(`openStageHeldBy`)다.
 *    전날 결정이 없거나 옛 판(v4)이면 바닥(d1)이다 — env 단계를 읽지 않는다.
 *
 *    `dayBefore`(이틀 전 행)가 더 높은 단계를 들고 있으면 그쪽을 쓴다. 되돌림을 쓰던 옛 사다리가 남긴 행
 *    (실패한 시험 다음 날 아래 칸으로 적힌 `PREPARE`)에서 열린 단계를 되찾기 위한 전환 경로다.
 *    새 사다리가 쓴 행은 낮춘 날마다 `CERTIFIED` 를 들고 있어 두 값이 언제나 같다 — 최근 이틀이 전부 새 사다리의 행이 되고
 *    옛 runtime 으로 되돌릴 일이 없어지면 이 인자를 지워도 된다.
 */
export function openStageOf(
  prev: ValidatedStageDecision | null, dayBefore: ValidatedStageDecision | null = null,
): RuntimeStage {
  if (prev === null || isLegacyDecision(prev)) return SAFEST_STAGE
  const held = openStageHeldBy(prev)
  if (dayBefore === null || isLegacyDecision(dayBefore) || dayBefore.kstDate !== previousKstDate(prev.kstDate)) return held
  return higher(held, openStageHeldBy(dayBefore))
}

/** 공개가 열린 단계보다 낮은 날만 열린 단계를 따로 적는다 — 낮춘 공개가 다음 날의 단계가 되지 않게 */
const certifiedProvenance = (release: RuntimeStage, certified: RuntimeStage): StageDecision['transition'] =>
  stageRank(certified) > stageRank(release) ? { kind: 'CERTIFIED', certified } : null

export type ControllerInputs = {
  kstDate: string
  decidedAt: string
  previousDecision: ValidatedStageDecision | null
  /** 전날 하루 판정 — PASS 가 아니면(FAIL · 모름 · 없음) 연속 통과가 끊긴다 */
  previousEvidence?: StageEvidenceVerdict | null
  /** 이틀 전 결정과 그날 판정 — 연속 통과를 세고, 옛 사다리 행에서 열린 단계를 되찾는 데 쓴다 */
  dayBefore?: LadderDay | null
  /** 올라갈 칸(열린 단계의 다음 칸)의 관문(`judgeNextPreflight`) — 모든 단계 같은 관문 */
  nextPreflight: PreflightVerdict | null
  /** 오늘 이미 낸 편수 — 감속한 단계의 상한을 이미 넘었으면 오늘은 낮추지 않는다 */
  publishedToday: number
  signals: readonly HealthSignal[]
}

export type ControllerResult = {
  decision: StageDecision
  /** 🔴 브레이크가 무엇을 했는가 — 없으면 `none` */
  brake: 'none' | 'slowdown' | 'holdUnknown' | 'controllerFailure'
  /** 열린 단계 — 브레이크가 오늘 공개를 낮춰도 이 값은 그대로다 */
  sustained: RuntimeStage
  /** 열린 단계의 연속 통과 일수(사다리를 부르지 않은 경로는 0) */
  passDays: number
}

/**
 * 🔴 **controller 실패 — 지금 공개 단계를 지킨다.** 상태는 HOLD, 전이 근거 없음. 이유를 남긴다.
 */
export function holdAtCurrent(input: {
  kstDate: string; decidedAt: string; current: RuntimeStage; reason: string; headline?: string
  /** 공개보다 높은 열린 단계 — 행의 `CERTIFIED` 칸에 남는다 · 없으면 공개 그대로 */
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
 *      **바닥(d1)을 보이게 붙잡는다**. 열린 단계(`certified`)는 행의 `CERTIFIED` 칸에 남아 다음 정상 결정이 되찾는다
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
  /** 권한 행의 바로 전날 행 — 옛 사다리 행에서 열린 단계를 되찾는 데만 쓴다(`openStageOf`) */
  dayBefore?: ValidatedStageDecision | null
}): { decision: StageDecision; certified: RuntimeStage } {
  const certified = openStageOf(authorityRowOf(input.authority), input.dayBefore ?? null)
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
 *    인접하지 않은 행으로는 올리지 않는다 — HOLD·PREPARE 만 쓴다.
 *    공개는 이틀 전 공개와 열린 단계 중 낮은 쪽이고, 나쁜 신호면 열린 단계의 아래 칸까지 낮춘다.
 */
export function bridgeHoldOf(i: {
  kstDate: string; decidedAt: string
  bridge: ValidatedStageDecision
  publishedToday: number; signals: readonly HealthSignal[]
}): ControllerResult {
  const sustained = openStageOf(i.bridge)
  const bad = i.signals.filter((s) => s.health === 'bad')
  const held = heldReleaseOf(i.bridge, sustained)
  const target = bad.length > 0 ? lower(held, previousStage(sustained)) : held
  const base = holdAtCurrent({
    kstDate: i.kstDate, decidedAt: i.decidedAt, current: target, certified: sustained,
    headline: `🟡 전날 결정이 없다 — 이틀 전(${i.bridge.kstDate}) 결정으로 권한만 잇고 공개 ${target} 를 HOLD한다(올림 없음 · 열린 단계 ${sustained})`,
    reason: '인접하지 않은 결정으로는 올리지 않는다',
  })
  const reasons = [...base.reasons, ...bad.map((s) => `🔴 감속(${s.axis}): ${s.reasons.join(' · ') || '나쁨'}`)]
  return {
    decision: finishHold(base, target, sustained, i.publishedToday, reasons),
    brake: bad.length > 0 ? 'slowdown' : 'holdUnknown', sustained, passDays: 0,
  }
}

/** 🔴 브레이크가 정한 공개로 결정을 닫는다 — 올림 없음. 낮춘 날은 열린 단계를 `CERTIFIED` 로 남긴다 */
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
  const prev = i.previousDecision
  const sustained = openStageOf(prev, i.dayBefore?.decision ?? null)
  const passDays = consecutivePassDays(i.kstDate, sustained, [
    prev === null ? null : { decision: prev, evidence: i.previousEvidence ?? null },
    i.dayBefore ?? null,
  ])
  const planned = planStageDecision({
    kstDate: i.kstDate, openStage: sustained, previousDecision: prev,
    previousEvidence: i.previousEvidence ?? null, passDays,
    nextPreflight: i.nextPreflight, decidedAt: i.decidedAt,
  })
  const bad = i.signals.filter((s) => s.health === 'bad')
  const unknown = i.signals.filter((s) => s.health === 'unknown')
  if (bad.length > 0) {
    const target = lower(planned.release, previousStage(sustained))
    const reasons = [
      ...planned.reasons,
      ...bad.map((s) => `🔴 감속(${s.axis}): ${s.reasons.join(' · ') || '나쁨'}`),
      `🔴 운영 신호 ${bad.map((s) => s.axis).join('·')} 가 나쁘다 — 오늘 하루 ${sustained} → ${target} (열린 단계 ${sustained} 는 유지)`,
    ]
    return { decision: finishHold(planned, target, sustained, i.publishedToday, reasons), brake: 'slowdown', sustained, passDays }
  }
  // 모르는 신호로 올리지 않는다 — 품질·비용·오류를 확인하지 못한 날은 지금 단계를 지킨다
  if (unknown.length > 0 && planned.state === 'TRIAL') {
    const reasons = [
      ...planned.reasons,
      ...unknown.map((s) => `⬚ 모름(${s.axis}): ${s.reasons.join(' · ') || '관측 없음'}`),
      `🔴 올림을 보류한다 — 운영 신호 ${unknown.map((s) => s.axis).join('·')} 를 확인하지 못했다. ${sustained} 를 지킨다`,
    ]
    return { decision: finishHold(planned, sustained, sustained, i.publishedToday, reasons), brake: 'holdUnknown', sustained, passDays }
  }
  if (unknown.length > 0) {
    return {
      decision: { ...planned, reasons: [...planned.reasons, ...unknown.map((s) => `⬚ 모름(${s.axis}): ${s.reasons.join(' · ') || '관측 없음'}`)] },
      brake: 'none', sustained, passDays,
    }
  }
  return { decision: planned, brake: 'none', sustained, passDays }
}

/** 🔴 저장 전 검증 — 정본 validator 한 벌. 통과 못 하면 저장하지 않는다 */
export function validateForToday(d: StageDecision): ReturnType<typeof validateStoredDecision> {
  return validateStoredDecision({ row: d, expectKstDate: d.kstDate })
}

// ─────────────────────────────────────────────────────────
// 🔴 consumer — 러너가 실제로 읽는 env 로 옮긴다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **결정을 러너 env 로 옮긴다** — 결정이 유일한 단계 입력이다.
 *    · 결정 OK → 공개 = 결정의 `release` · 준비 눈금 = `capacity` · 표식(`STAGE_DECISION_MARK_ENV`) = 결정의 KST 날짜
 *    · 결정이 없거나 깨졌다 · controller flag OFF(kill switch) → d1 · 표식 없음
 *    표식 없는 단계 칸은 `scale-runtime.decisionStageEnv` 가 읽지 않는다(= d1).
 *    공개 단계는 그날의 상한일 뿐이다 — 올린 날과 유지하는 날의 러너 동작은 같다.
 */
export function consumerEnvOf(o: ConsumeOutcome): Record<string, string> {
  if (o.ok) {
    return {
      [RELEASE_ENV]: o.decision.release,
      [CAPACITY_ENV]: o.decision.capacity,
      [STAGE_DECISION_MARK_ENV]: o.decision.kstDate,
    }
  }
  return { [RELEASE_ENV]: SAFEST_STAGE, [CAPACITY_ENV]: SAFEST_STAGE, [STAGE_DECISION_MARK_ENV]: '' }
}

/**
 * 🔴 **아침 공급 회차의 미리 사기 env** — 그날 결정이 아직 없을 때 공급 러너에만 넣는다(`readSupplyHeadStart`).
 *    두 단계 칸 모두 전날이 지킨 단계 · 표식은 그 전날 결정의 날짜(출처)다.
 */
export function supplyHeadStartEnvOf(h: { stage: RuntimeStage; previousKstDate: string }): Record<string, string> {
  return { [RELEASE_ENV]: h.stage, [CAPACITY_ENV]: h.stage, [STAGE_DECISION_MARK_ENV]: h.previousKstDate }
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
