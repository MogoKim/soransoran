/**
 * D100 단계 회복 계획의 첫 경계.
 *
 * preflight 결과를 하나의 다음 행동으로 분류하지만, 이 모듈은 어떤 행동도 실행하지 않는다.
 * 특히 StageDecision, DB, 파일, env, provider, 수집기와 발행기를 건드리지 않는다. 부족 원천 수와
 * 공급 요청 수 계산도 복제하지 않는다. 실제 원천 요청량은 기존 JIT 수율·비용 계약이 맡는다.
 */
import type { PreflightCode, PreflightVerdict } from './stage-ladder-generic'

export const STAGE_RECOVERY_SHADOW_VERSION = 'stage-recovery-shadow-v1' as const

export const STAGE_RECOVERY_HARD_BLOCKERS = [
  'SLOTS_INFEASIBLE', 'PUBLISH_CAPACITY_SHORT',
  'PERSONA_SHORT', 'PERSONA_UNKNOWN',
  'COMMENT_COST_SHORT', 'COMMENT_COST_UNKNOWN', 'COMMENT_RUNNER_SHORT',
  'AUDIT_COST_SHORT', 'AUDIT_COST_UNKNOWN',
  'SUPPLY_COST_SHORT', 'SUPPLY_COST_UNKNOWN',
  'RUNNER_BAD', 'RUNNER_UNKNOWN',
] as const satisfies readonly PreflightCode[]

export type StageRecoveryLane = 'done' | 'source' | 'supply' | 'observe' | 'blocked'
export type StageRecoveryAction =
  | 'none'
  | 'acquire_fresh_sources'
  | 'restore_ready_capacity'
  | 'measure_ready_yield'
  | 'remeasure'
  | 'stop'
export type StageRecoveryDeficitUnit = 'public_slot' | 'ready_result' | 'none'
export type StageRecoveryDeficitBasis =
  | 'exact' | 'lower_bound' | 'upper_bound' | 'conservative' | 'unknown' | 'not_applicable'

export type StageRecoveryPlan = {
  version: typeof STAGE_RECOVERY_SHADOW_VERSION
  mode: 'shadow'
  stage: PreflightVerdict['stage']
  preflightVerdict: PreflightVerdict['verdict']
  preflightCodes: readonly PreflightCode[]
  lane: StageRecoveryLane
  action: StageRecoveryAction
  /** 지배 lane 밖의 finding. 하나를 고른다고 다른 부족이 사라진 것으로 기록하지 않는다. */
  secondaryCodes: readonly PreflightCode[]
  /** 공개 슬롯과 READY 결과를 섞지 않는 부족량 단위. 원천 요청 수는 어느 경우에도 아니다. */
  deficitUnit: StageRecoveryDeficitUnit
  deficitMin: number | null
  deficitMax: number | null
  deficitBasis: StageRecoveryDeficitBasis
  reasons: readonly string[]
  /** shadow가 운영 권한으로 오인되지 않도록 기계가 읽는 불변값으로 둔다. */
  authorizesWrites: false
  authorizesStageChange: false
}

const SOURCE_CODES = new Set<PreflightCode>(['OPPORTUNITY_SHORT', 'OPPORTUNITY_UNKNOWN'])
const SUPPLY_CODES = new Set<PreflightCode>(['THROUGHPUT_SHORT', 'THROUGHPUT_UNKNOWN'])
const OBSERVE_CODES = new Set<PreflightCode>(['READY_REQUIREMENT_UNKNOWN', 'LATENCY_UNKNOWN'])
const HARD_BLOCKERS = new Set<PreflightCode>(STAGE_RECOVERY_HARD_BLOCKERS)

const countOf = (counts: Readonly<Record<string, number>>, key: string): number | null => {
  const value = counts[key]
  return value !== undefined && Number.isInteger(value) && value >= 0 ? value : null
}

const nonnegativeNumberOf = (counts: Readonly<Record<string, number>>, key: string): number | null => {
  const value = counts[key]
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : null
}

const deficitOf = (needed: number | null, available: number | null): number | null =>
  needed === null || available === null ? null : Math.max(0, needed - available)

function planOf(
  preflight: PreflightVerdict,
  i: Pick<StageRecoveryPlan,
    'lane' | 'action' | 'secondaryCodes' | 'deficitUnit' | 'deficitMin' | 'deficitMax' | 'deficitBasis' | 'reasons'>,
): StageRecoveryPlan {
  return {
    version: STAGE_RECOVERY_SHADOW_VERSION,
    mode: 'shadow',
    stage: preflight.stage,
    preflightVerdict: preflight.verdict,
    preflightCodes: [...preflight.codes],
    ...i,
    authorizesWrites: false,
    authorizesStageChange: false,
  }
}

const inconsistentOf = (preflight: PreflightVerdict, reason: string): StageRecoveryPlan => planOf(preflight, {
  lane: 'blocked', action: 'stop', secondaryCodes: [...preflight.codes],
  deficitUnit: 'none', deficitMin: null, deficitMax: null, deficitBasis: 'unknown',
  reasons: [`PREFLIGHT_INCONSISTENT:${reason}`],
})

const secondaryOf = (preflight: PreflightVerdict, primary: ReadonlySet<PreflightCode>): PreflightCode[] =>
  preflight.codes.filter((code) => !primary.has(code))

/**
 * preflight의 여러 finding을 하나의 지배적인 회복 lane으로 줄인다.
 *
 * 우선순위는 안전·비용·권한 blocker > 신선 원천 > READY 처리 > 관측이다. 원천과 처리량이 같이
 * 부족하면 원천부터 회복한다. 원천이 없는데 생성만 반복하는 낭비를 막기 위해서다.
 */
export function planStageRecovery(preflight: PreflightVerdict): StageRecoveryPlan {
  const codes = new Set(preflight.codes)

  if (preflight.verdict === 'PASS') {
    return codes.size === 0
      ? planOf(preflight, {
        lane: 'done', action: 'none', secondaryCodes: [], deficitUnit: 'none',
        deficitMin: null, deficitMax: null, deficitBasis: 'not_applicable', reasons: ['PREFLIGHT_PASS'],
      })
      : inconsistentOf(preflight, 'PASS_WITH_CODES')
  }
  if (codes.size === 0) return inconsistentOf(preflight, 'NON_PASS_WITHOUT_CODES')

  /** 장부·귀속은 정상이고 결과만 0인 무표본은 비용 장애와 다르다. 예산을 아는 작은 측정 canary 후보로 남긴다. */
  const unobservedSupplyCost = codes.has('SUPPLY_COST_UNKNOWN')
    && countOf(preflight.counts, 'supplyCostUnobserved') === 1
    && nonnegativeNumberOf(preflight.counts, 'supplyProofBudgetUsd') !== null
  const blockers = preflight.codes.filter((code) =>
    HARD_BLOCKERS.has(code) && !(code === 'SUPPLY_COST_UNKNOWN' && unobservedSupplyCost))
  if (blockers.length > 0) {
    const blockingCodes = new Set<PreflightCode>(blockers)
    return planOf(preflight, {
      lane: 'blocked', action: 'stop', secondaryCodes: secondaryOf(preflight, blockingCodes), deficitUnit: 'none',
      deficitMin: null, deficitMax: null, deficitBasis: 'not_applicable', reasons: blockers,
    })
  }

  if (preflight.codes.some((code) => SOURCE_CODES.has(code))) {
    const target = countOf(preflight.counts, 'target')
    if (codes.has('OPPORTUNITY_SHORT')) {
      const deficit = deficitOf(target, countOf(preflight.counts, 'opportunities'))
      if (deficit === null || deficit === 0) return inconsistentOf(preflight, 'OPPORTUNITY_SHORT_COUNTS')
      return planOf(preflight, {
        lane: 'source', action: 'acquire_fresh_sources', secondaryCodes: secondaryOf(preflight, SOURCE_CODES),
        deficitUnit: 'public_slot', deficitMin: 0, deficitMax: deficit, deficitBasis: 'upper_bound',
        reasons: ['OPPORTUNITY_SHORT'],
      })
    }
    const deficit = deficitOf(target, countOf(preflight.counts, 'opportunitiesCurrent'))
    if (deficit === 0) return inconsistentOf(preflight, 'OPPORTUNITY_UNKNOWN_COUNTS')
    return planOf(preflight, {
      lane: 'source', action: 'acquire_fresh_sources', secondaryCodes: secondaryOf(preflight, SOURCE_CODES),
      deficitUnit: 'public_slot', deficitMin: deficit === null ? null : 0, deficitMax: deficit,
      deficitBasis: deficit === null ? 'unknown' : 'conservative', reasons: ['OPPORTUNITY_UNKNOWN'],
    })
  }

  if (preflight.codes.some((code) => SUPPLY_CODES.has(code)) || unobservedSupplyCost) {
    const supplyPrimary = new Set<PreflightCode>(SUPPLY_CODES)
    if (unobservedSupplyCost) supplyPrimary.add('SUPPLY_COST_UNKNOWN')
    if (codes.has('THROUGHPUT_SHORT')) {
      const target = countOf(preflight.counts, 'target')
      const capacity = countOf(preflight.counts, 'readyCapacity')
      const low = countOf(preflight.counts, 'readyNeededMin') ?? target
      const high = countOf(preflight.counts, 'readyNeededMax')
      const deficitMin = deficitOf(low, capacity)
      const deficitMax = deficitOf(high, capacity)
      if (deficitMin === null || deficitMin === 0) return inconsistentOf(preflight, 'THROUGHPUT_SHORT_COUNTS')
      return planOf(preflight, {
        lane: 'supply', action: unobservedSupplyCost ? 'measure_ready_yield' : 'restore_ready_capacity',
        secondaryCodes: secondaryOf(preflight, supplyPrimary),
        deficitUnit: 'ready_result', deficitMin, deficitMax,
        deficitBasis: deficitMax !== null && deficitMax === deficitMin ? 'exact' : 'lower_bound',
        reasons: preflight.codes.filter((code) => supplyPrimary.has(code)),
      })
    }
    return planOf(preflight, {
      lane: 'supply', action: unobservedSupplyCost ? 'measure_ready_yield' : 'restore_ready_capacity',
      secondaryCodes: secondaryOf(preflight, supplyPrimary),
      deficitUnit: 'ready_result', deficitMin: null, deficitMax: null, deficitBasis: 'unknown',
      reasons: preflight.codes.filter((code) => supplyPrimary.has(code)),
    })
  }

  if (preflight.codes.some((code) => OBSERVE_CODES.has(code))) {
    return planOf(preflight, {
      lane: 'observe', action: 'remeasure', secondaryCodes: secondaryOf(preflight, OBSERVE_CODES),
      deficitUnit: 'none', deficitMin: null, deficitMax: null, deficitBasis: 'not_applicable',
      reasons: preflight.codes.filter((code) => OBSERVE_CODES.has(code)),
    })
  }

  return inconsistentOf(preflight, 'UNCLASSIFIED_CODES')
}
