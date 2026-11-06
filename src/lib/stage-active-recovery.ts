import type { RuntimeStage } from './scale-profile'
import type { HealthSignal } from './stage-controller'
import type { PreflightVerdict } from './stage-ladder-generic'
import { SUPPLY_WORKSET_PER_RUN } from './supply-schedule-contract'

/**
 * 아침 단계 판정의 제한 복구 계약.
 *
 * 이것은 FAIL을 PASS로 바꾸는 우회로가 아니다. 오늘 결정을 아직 쓰지 않았고,
 * 품질·비용·오류가 모두 정상이며, 결함이 기회·처리량 부족 범위 안에만 있을 때
 * 한 번의 추가 수집·공급을 요청한다. recovery 산출물이 생긴 날은 중간 슬롯(07:00·07:20·07:40)이
 * 결정을 쓰지 않고, final 슬롯(07:55·07:58)만 실제 복구 supply run에 귀속된 slot-valid READY와
 * 그 회차의 exact 비용을 확인해 같은 정본으로 한 번 저장한다(canon §3.2.1).
 */
export const ACTIVE_RECOVERY_VERSION = 'stage-active-recovery-v2' as const
/** 검증된 recovery claim을 소비한 공급 본체만 자식 provider에 전파한다. */
export const ACTIVE_RECOVERY_DATE_ENV = 'SORAN_STAGE_ACTIVE_RECOVERY_DATE' as const
export const ACTIVE_RECOVERY_NONCE_ENV = 'SORAN_STAGE_ACTIVE_RECOVERY_NONCE' as const
export const ACTIVE_RECOVERY_DEFICIT_ENV = 'SORAN_STAGE_ACTIVE_RECOVERY_DEFICIT' as const
export const ACTIVE_RECOVERY_DEADLINE_ENV = 'SORAN_STAGE_ACTIVE_RECOVERY_DEADLINE' as const
export const ACTIVE_RECOVERY_MAX_DEFICIT = 10
export const ACTIVE_RECOVERY_COLLECTOR_MAX = 10
export const ACTIVE_RECOVERY_WORKSET_LIMIT = SUPPLY_WORKSET_PER_RUN
export const ACTIVE_RECOVERY_START_MINUTE_KST = 7 * 60
export const ACTIVE_RECOVERY_PAID_CUTOFF_MINUTE_KST = 7 * 60 + 30
export const ACTIVE_RECOVERY_FINAL_MINUTE_KST = 7 * 60 + 55
export const ACTIVE_RECOVERY_FINAL_WRITE_ATTEMPTS = 3
/** 07:55 최종 controller가 살아 있는 worker와 경합하지 않도록 5분 앞에서 전부 끝낸다. */
export const ACTIVE_RECOVERY_COMPLETION_DEADLINE_MINUTE_KST = 7 * 60 + 50
/** 07:00에 시작해도 07:50까지 기존 공급 본체가 결말 기록을 닫을 수 있다. */
export const ACTIVE_RECOVERY_MAX_RUNTIME_MS = 50 * 60_000
// RuntimeStage가 실제로 배선된 단계만 연다. d100은 GenericStage 문서 단계이지만
// 아직 controller runtime target이 아니므로 별도 scheduler/profile 배선 전에는 열지 않는다.
const ACTIVE_RECOVERY_TARGETS = new Set<RuntimeStage>(['d20', 'd30', 'd50'])

export function kstMinuteOf(d: Date): number {
  const shifted = new Date(d.getTime() + 9 * 60 * 60_000)
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
}

export function isFinalRecoveryControllerSlot(d: Date): boolean {
  return kstMinuteOf(d) >= ACTIVE_RECOVERY_FINAL_MINUTE_KST
}

export function activeRecoveryDeadlineAt(kstDate: string, createdAt: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(kstDate)) return null
  const created = new Date(createdAt)
  const final = new Date(`${kstDate}T07:50:00+09:00`)
  if (!Number.isFinite(created.getTime()) || !Number.isFinite(final.getTime())) return null
  return new Date(Math.min(created.getTime() + ACTIVE_RECOVERY_MAX_RUNTIME_MS, final.getTime()))
}

/**
 * 한 controller 프로세스가 계산한 최종 StageDecision의 짧은 저장 장애만 같은 값으로 재시도한다.
 * 07:58 별도 fallback 프로세스는 이 함수의 연장이 아니다. 결정이 여전히 없을 때 정본 read-only
 * 사실을 다시 계산하되 새 recovery/provider를 열지 않고 create-only 저장으로 기존 결정을 덮지 않는다.
 */
export async function retryFinalStageDecisionWrite<T>(
  write: () => Promise<T>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  let last: unknown = new Error('최종 StageDecision 저장을 시작하지 못했다')
  for (let attempt = 1; attempt <= ACTIVE_RECOVERY_FINAL_WRITE_ATTEMPTS; attempt += 1) {
    try { return await write() } catch (error) {
      last = error
      if (attempt < ACTIVE_RECOVERY_FINAL_WRITE_ATTEMPTS) await wait(attempt * 500)
    }
  }
  throw last
}

/**
 * 🔴 **한 릴리스 rollback 호환 경로** (PR1b · 2026-11-06 · canon §11 · §11.1). 현재 `judgeNextPreflight` 는 이 예측
 *    코드들을 막는 `codes` 가 아니라 `forecastWarnings` 로 보내 PASS 를 낸다 — 그래서 `planActiveRecovery` 는
 *    `이미 preflight PASS` 로 끝나고 이 판정에 도달하지 않는다(`stage:forecast-warning-check` ⑤). 옛 runtime 으로
 *    되돌렸을 때만 다시 쓰인다. 다음 릴리스에서 이 경로를 지운다.
 */
const ACTIVE_RECOVERY_SHORTAGE_CODES = new Set([
  'OPPORTUNITY_SHORT', 'OPPORTUNITY_UNKNOWN', 'THROUGHPUT_SHORT',
])

export function isBoundedSupplyShortage(preflight: PreflightVerdict | null): boolean {
  return preflight !== null
    && preflight.verdict !== 'PASS'
    && preflight.codes.length > 0
    && preflight.codes.every((code) => ACTIVE_RECOVERY_SHORTAGE_CODES.has(code))
}

/** 재고를 읽지 못한 복구는 부족분을 추정해 유료 요청을 열지 않고 닫는다. */
export function recoveryJitDemand<T extends { upTo: number }>(base: T, deficit: number, inventoryKnown: boolean): T & {
  llm: true; fill: true; upTo: number; reason: string
} {
  if (!inventoryKnown) throw new Error('제한 복구 재고 snapshot을 읽지 못했다 — provider 0 · DB write 0')
  return {
    ...base, llm: true, fill: true, upTo: deficit,
    reason: `제한 복구는 증명 부족분 ${deficit}건만 채운다 (기존 JIT 수요 ${base.upTo}건은 자연 회차가 담당)`,
  }
}

export type ActiveRecoveryPlan =
  | {
      kind: 'recover'
      target: RuntimeStage
      deficit: number
      baselineReadyStock: number
      collectMax: number
      worksetLimit: number
      reason: string
    }
  | { kind: 'none'; reason: string; hardBlock: boolean }

export type ActiveRecoveryIntentState = 'requested' | 'running' | 'done' | 'failed'

/**
 * 오늘 recovery 산출물의 판독 결과 — 세 상태뿐이다.
 * `absent`는 intent와 실행권·시작 claim·영수증이 **하나도 없을 때만**이다. 읽기 오류·파싱 실패·
 * intent 없이 남은 claim/영수증은 `corrupt`다. 손상을 없음으로 읽으면 복구 비용·READY를 자연분처럼 센다.
 */
export type ActiveRecoveryArtifact =
  | { kind: 'absent' }
  | { kind: 'valid'; state: ActiveRecoveryIntentState }
  | { kind: 'corrupt'; reason: string }

export type ActiveRecoveryPhase = 'intermediate' | 'final'

export function activeRecoveryPhaseOf(d: Date): ActiveRecoveryPhase {
  return isFinalRecoveryControllerSlot(d) ? 'final' : 'intermediate'
}

/**
 * controller 한 슬롯이 recovery에 대해 할 일 하나.
 *  · `decide-now`            — 산출물이 없고 복구 대상도 아니다. 기존 즉시 결정(07:55까지 미루지 않는다)
 *  · `start-recovery`        — 복구를 시작하거나(산출물 없음) requested intent의 실행권을 잡는다. StageDecision write 0
 *  · `wait-final`            — 산출물이 있다(손상 포함). StageDecision write 0
 *  · `cancel-and-wait-final` — active intent 중 중대 결함. intent를 failed로 닫고 write 0
 *  · `finalize`              — final 슬롯. 이 판정에서만 lineage·exact READY gain·exact 비용을 넣어 한 번 결정한다
 * 기존 결정 읽기·lease·create-only 저장은 이 함수 밖(`stage-controller-recovery-step`)이 소유한다.
 */
export type ActiveRecoveryDirective =
  | { kind: 'decide-now' }
  | { kind: 'start-recovery' }
  | { kind: 'wait-final' }
  | { kind: 'cancel-and-wait-final' }
  | { kind: 'finalize'; closeActive: boolean; recoveryFacts: 'none' | 'evaluate' | 'unknown' }

export function activeRecoveryDirective(
  i: { phase: 'final'; artifact: ActiveRecoveryArtifact }
    | { phase: 'intermediate'; artifact: ActiveRecoveryArtifact; plan: ActiveRecoveryPlan },
): ActiveRecoveryDirective {
  const a = i.artifact
  if (i.phase === 'final') {
    if (a.kind === 'absent') return { kind: 'finalize', closeActive: false, recoveryFacts: 'none' }
    if (a.kind === 'corrupt') return { kind: 'finalize', closeActive: false, recoveryFacts: 'unknown' }
    return {
      kind: 'finalize',
      closeActive: a.state === 'requested' || a.state === 'running',
      recoveryFacts: 'evaluate',
    }
  }
  if (a.kind === 'absent') return i.plan.kind === 'recover' ? { kind: 'start-recovery' } : { kind: 'decide-now' }
  if (a.kind === 'corrupt') return { kind: 'wait-final' }
  if (a.state === 'requested' || a.state === 'running') {
    if (i.plan.kind === 'none' && i.plan.hardBlock) return { kind: 'cancel-and-wait-final' }
    if (a.state === 'requested' && i.plan.kind === 'recover') return { kind: 'start-recovery' }
  }
  return { kind: 'wait-final' }
}

export function planActiveRecovery(i: {
  target: RuntimeStage | null
  preflight: PreflightVerdict | null
  signals: readonly HealthSignal[]
  failures: readonly string[]
  now: Date
}): ActiveRecoveryPlan {
  if (i.failures.length > 0) return { kind: 'none', reason: 'controller 입력 실패', hardBlock: true }
  if (i.target === null || i.preflight === null) {
    return { kind: 'none', reason: '시험 대상 또는 preflight 없음', hardBlock: true }
  }
  if (!ACTIVE_RECOVERY_TARGETS.has(i.target)) {
    return { kind: 'none', reason: `제한 복구 대상 단계가 아님: ${i.target}`, hardBlock: true }
  }
  const badSignals = i.signals.filter((s) => s.health !== 'ok')
  if (badSignals.length > 0) {
    return { kind: 'none', reason: `운영 신호 비정상: ${badSignals.map((s) => s.axis).join(',')}`, hardBlock: true }
  }
  if (i.preflight.verdict === 'PASS') return { kind: 'none', reason: '이미 preflight PASS', hardBlock: false }
  if (!isBoundedSupplyShortage(i.preflight)) {
    return { kind: 'none', reason: `복구 대상이 아닌 preflight: ${i.preflight.codes.join(',') || i.preflight.verdict}`, hardBlock: true }
  }
  const target = i.preflight.counts.target
  const opportunities = i.preflight.counts.opportunitiesCurrent ?? i.preflight.counts.opportunities
  const baselineReadyStock = i.preflight.counts.readyStock
  if (!Number.isInteger(target) || !Number.isInteger(baselineReadyStock) || baselineReadyStock < 0) {
    return { kind: 'none', reason: '목표 또는 READY 기준 재고 근거가 불완전함', hardBlock: true }
  }
  const opportunityBlocked = i.preflight.codes.some((code) => code === 'OPPORTUNITY_SHORT' || code === 'OPPORTUNITY_UNKNOWN')
  if (opportunityBlocked && (!Number.isInteger(opportunities) || opportunities < 0)) {
    return { kind: 'none', reason: '기회 수 근거가 불완전함', hardBlock: true }
  }
  const opportunityGap = opportunityBlocked ? Math.max(0, target - opportunities) : 0
  const throughputBlocked = i.preflight.codes.includes('THROUGHPUT_SHORT')
  const readyNeeded = i.preflight.counts.readyNeededMax
  const naturalCapacity = i.preflight.counts.readyCapacityNatural
  if (throughputBlocked && (!Number.isInteger(readyNeeded) || !Number.isInteger(naturalCapacity)
    || readyNeeded < 0 || naturalCapacity < 0)) {
    return { kind: 'none', reason: '처리량 부족 근거가 불완전함', hardBlock: true }
  }
  const throughputGap = throughputBlocked ? Math.max(0, readyNeeded - naturalCapacity) : 0
  const deficit = Math.max(opportunityGap, throughputGap)
  if (deficit <= 0 || deficit > ACTIVE_RECOVERY_MAX_DEFICIT) {
    return { kind: 'none', reason: `복구 부족분 범위 밖: ${deficit}`, hardBlock: true }
  }
  const minute = kstMinuteOf(i.now)
  if (minute < ACTIVE_RECOVERY_START_MINUTE_KST || minute >= ACTIVE_RECOVERY_PAID_CUTOFF_MINUTE_KST) {
    // 새 유료 공급을 시작할 수 없다는 뜻이지 품질·비용 결함은 아니다. active intent가 있으면
    // 07:55 최종 controller까지 기다리고, intent가 없거나 끝났으면 현재 슬롯이 같은 정본으로 결정한다.
    return { kind: 'none', reason: `추가 유료 공급 시작 창 밖: ${minute}`, hardBlock: false }
  }
  return {
    kind: 'recover', target: i.target, deficit, baselineReadyStock,
    // `deficit`은 최종 slot-valid 기회 수이고 collector의 `--max`는 분류 전 상세 조회 수다.
    // 둘을 1:1로 두면 수집 뒤 drop/HOLD/생성 손실 때문에 복구가 구조적으로 모자란다.
    // 무료 수집은 승인된 작은 상한 10건을 충분히 보고, 유료 단계는 아래와 별개로
    // `paidSourcesFor(deficit, measuredYield)`가 부족분·수율·workset 천장 안에서 다시 제한한다.
    collectMax: ACTIVE_RECOVERY_COLLECTOR_MAX,
    worksetLimit: ACTIVE_RECOVERY_WORKSET_LIMIT,
    reason: `제한 공급 부족 ${i.preflight.codes.join('+')} — 기회 ${opportunityGap}, 처리량 ${throughputGap}, 복구 ${deficit}`,
  }
}
