/**
 * Dn 공급 비용의 bounded-unknown 판정 — 순수 함수, 파일·DB·시각 조회 0.
 *
 * 미상 사용량을 실제 비용으로 정산하지 않는다. 다만 현재 계약의 양수 예약으로
 * 위험액을 전부 덮고, 충분한 정산 표본과 비율이 있으며 승인 예산 안이면
 * "정확한 금액은 미상이지만 예산 위험은 유한하다"고 판정한다.
 * preflight와 운영 증거는 반드시 이 함수 하나를 공유한다.
 */

import {
  SUPPLY_RUN_SLOTS_KST, SUPPLY_RUN_WINDOW_MS, supplyRunSlotMinuteOf,
} from './supply-schedule-contract'
import { isNaturalScheduledRunTag, parseRunTokenShadowTag } from './supply-run-token'

export const SUPPLY_COST_ENVELOPE_VERSION = 'supply-cost-envelope-v2' as const
export const SUPPLY_COST_ENVELOPE_EFFECTIVE_KST_DATE = '2026-11-05' as const
export const SUPPLY_COST_ENVELOPE_MIN_CLEAN_SETTLED_REQUESTS = 1
export const SUPPLY_COST_ENVELOPE_MIN_BOUNDED_SETTLED_REQUESTS = 20
export const SUPPLY_COST_ENVELOPE_MIN_SETTLED_RATIO = 0.95
/**
 * proof 날짜가 어떤 장부 계약을 기대하는지 고정한다. 현재 상수를 직접 비교하면 나중에
 * 가격표나 공급 계약을 올린 날 과거 PASS까지 소급 UNKNOWN이 된다. 새 판을 배포할 때는
 * 기존 행을 바꾸지 않고 날짜 경계 행을 추가한다.
 */
export type SupplyCostContractWindow = {
  fromKstDate: string
  supplyContract: string
  pricingVersion: string
  approvedDailyUsd: number
  trustedBudgetSources: readonly string[]
  proofFullBudgetAtUsd: number
  proofBudgetNumerator: number
  proofBudgetDenominator: number
}

const SUPPLY_COST_CONTRACT_WINDOWS: readonly SupplyCostContractWindow[] = [
  {
    // 첫 배포 전에만 실제 배포 창에 맞춰 시행일 상수와 이 행을 함께 옮긴다.
    // 한 번 배포된 역사 행은 고치지 말고 다음 계약을 뒤에 추가한다.
    fromKstDate: '2026-11-05',
    supplyContract: 'supply-jit-v2',
    pricingVersion: 'supply-2026-09-19',
    approvedDailyUsd: 1.20,
    trustedBudgetSources: ['env.local', 'process', 'process-override'] as const,
    proofFullBudgetAtUsd: 1.20,
    proofBudgetNumerator: 5,
    proofBudgetDenominator: 7,
  },
] as const

const strictKstDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/**
 * 계약 창은 첫 시행일에서 시작해 날짜가 엄격히 증가해야 한다. 과거 행을 수정하거나
 * 날짜 순서를 뒤집은 배포는 조용히 현재 계약을 선택하지 않고 fail-closed 한다.
 */
export function validSupplyCostContractHistory(
  windows: readonly SupplyCostContractWindow[],
  effectiveKstDate = SUPPLY_COST_ENVELOPE_EFFECTIVE_KST_DATE,
): boolean {
  if (!strictKstDate(effectiveKstDate) || windows.length === 0
    || windows[0]?.fromKstDate !== effectiveKstDate) return false
  let previous = ''
  for (const window of windows) {
    if (!strictKstDate(window.fromKstDate) || (previous !== '' && window.fromKstDate <= previous)
      || window.supplyContract === '' || window.pricingVersion === ''
      || !Number.isFinite(window.approvedDailyUsd) || window.approvedDailyUsd <= 0
      || window.trustedBudgetSources.length === 0
      || new Set(window.trustedBudgetSources).size !== window.trustedBudgetSources.length
      || window.trustedBudgetSources.some((source) => source === '')
      || !Number.isFinite(window.proofFullBudgetAtUsd) || window.proofFullBudgetAtUsd <= 0
      || !Number.isInteger(window.proofBudgetNumerator) || window.proofBudgetNumerator <= 0
      || !Number.isInteger(window.proofBudgetDenominator)
      || window.proofBudgetDenominator < window.proofBudgetNumerator) return false
    previous = window.fromKstDate
  }
  return true
}

/** 테스트·감사용 복사본. 호출자가 내부 정본 배열을 바꿀 수 없다. */
export function supplyCostContractHistory(): readonly SupplyCostContractWindow[] {
  return SUPPLY_COST_CONTRACT_WINDOWS.map((window) => ({
    ...window, trustedBudgetSources: [...window.trustedBudgetSources],
  }))
}

export function supplyCostContractOf(kstDate: string): {
  supplyContract: string
  pricingVersion: string
  approvedDailyUsd: number
  trustedBudgetSources: readonly string[]
  proofFullBudgetAtUsd: number
  proofBudgetNumerator: number
  proofBudgetDenominator: number
} | null {
  if (!usesSupplyCostEnvelope(kstDate)
    || !validSupplyCostContractHistory(SUPPLY_COST_CONTRACT_WINDOWS)) return null
  const match = [...SUPPLY_COST_CONTRACT_WINDOWS].reverse().find((w) => kstDate >= w.fromKstDate)
  return match === undefined ? null : {
    supplyContract: match.supplyContract,
    pricingVersion: match.pricingVersion,
    approvedDailyUsd: match.approvedDailyUsd,
    trustedBudgetSources: match.trustedBudgetSources,
    proofFullBudgetAtUsd: match.proofFullBudgetAtUsd,
    proofBudgetNumerator: match.proofBudgetNumerator,
    proofBudgetDenominator: match.proofBudgetDenominator,
  }
}

/** 과거 proof 예산을 현재 스케줄 상수로 다시 계산하지 않고 날짜 계약에 고정한다. */
export function supplyCostProofBudgetUsd(kstDate: string, capUsd: number): number | null {
  const contract = supplyCostContractOf(kstDate)
  if (contract === null || !Number.isFinite(capUsd) || capUsd <= 0) return null
  return capUsd >= contract.proofFullBudgetAtUsd
    ? capUsd
    : capUsd * contract.proofBudgetNumerator / contract.proofBudgetDenominator
}

export type SupplyCostScheduledSlot = { kstDate: string; minute: number }

const KST_OFFSET_MS = 9 * 60 * 60_000

/**
 * 장부의 요청 시각으로 회차를 재추측하지 않고, 런처가 UTC로 기록한 회차 id와
 * KST 슬롯 태그가 같은 자연 예약 슬롯을 말하는지 본다.
 */
export function supplyCostScheduledSlotOf(i: {
  runId: string
  runKind?: 'scheduled' | 'manual' | null
  runSlot?: string | null
}): SupplyCostScheduledSlot | null {
  if (i.runKind !== 'scheduled' || typeof i.runSlot !== 'string') return null
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-[jd]$/.exec(i.runId)
  if (m === null) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const hour = Number(m[4])
  const minute = Number(m[5])
  const second = Number(m[6])
  if (![year, month, day, hour, minute, second].every(Number.isInteger)
    || month < 1 || month > 12 || day < 1 || day > 31
    || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second)
  const utc = new Date(utcMs)
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day
    || utc.getUTCHours() !== hour || utc.getUTCMinutes() !== minute || utc.getUTCSeconds() !== second) return null
  const kst = new Date(utcMs + KST_OFFSET_MS)
  const kstDate = kst.toISOString().slice(0, 10)
  const slotMinute = supplyRunSlotMinuteOf(
    kst.getUTCHours() * 60 + kst.getUTCMinutes(), SUPPLY_RUN_SLOTS_KST,
  )
  if (slotMinute === null) return null
  const label = `${kstDate} ${String(Math.floor(slotMinute / 60)).padStart(2, '0')}:${String(slotMinute % 60).padStart(2, '0')}`
  return i.runSlot === label ? { kstDate, minute: slotMinute } : null
}

/**
 * 장부 요청이 태그된 자연 슬롯의 실제 45분 창 안에서 시작했는지 본다.
 * runId가 창 안에 있어도 유료 요청 자체가 창 밖에서 시작했다면 같은 자연 회차 증거가 아니다.
 */
export function supplyCostRequestStartedInScheduledWindow(i: {
  startedAt: string
  runId: string
  runKind?: 'scheduled' | 'manual' | null
  runSlot?: string | null
}): boolean {
  const scheduled = supplyCostScheduledSlotOf(i)
  const startedMs = Date.parse(i.startedAt)
  if (scheduled === null || !Number.isFinite(startedMs)) return false
  const slotHour = Math.floor(scheduled.minute / 60)
  const slotMinute = scheduled.minute % 60
  const slotStartMs = Date.parse(
    `${scheduled.kstDate}T${String(slotHour).padStart(2, '0')}:${String(slotMinute).padStart(2, '0')}:00.000+09:00`,
  )
  return startedMs >= slotStartMs && startedMs < slotStartMs + SUPPLY_RUN_WINDOW_MS
}

/**
 * 요청 전에 기록한 하루 공급 예산 provenance. 값 하나만 보지 않고 env 값·계약 천장·
 * 실제 적용 cap·출처가 서로 맞고 승인 천장을 넘지 않는지 한 곳에서 판정한다.
 */
export function supplyCostRecordedBudgetCapOf(i: {
  budgetDailyUsd?: number | null
  budgetCeilingUsd?: number | null
  budgetCapUsd?: number | null
  budgetSource?: string | null
}, kstDate: string): number | null {
  const contract = supplyCostContractOf(kstDate)
  const daily = i.budgetDailyUsd
  const ceiling = i.budgetCeilingUsd
  const cap = i.budgetCapUsd
  const trustedSource = contract !== null && i.budgetSource !== null && i.budgetSource !== undefined
    && contract.trustedBudgetSources.includes(i.budgetSource)
  if (typeof daily !== 'number' || !Number.isFinite(daily) || daily <= 0
    || typeof ceiling !== 'number' || !Number.isFinite(ceiling) || ceiling <= 0
    || typeof cap !== 'number' || !Number.isFinite(cap) || cap <= 0
    || !trustedSource || cap !== Math.min(daily, ceiling)
    || contract === null || ceiling > contract.approvedDailyUsd
    || cap > contract.approvedDailyUsd) return null
  return cap
}

/**
 * 시행일 이후 유료 공급 요청 한 줄의 비용 provenance.
 * preflight 비용 귀속과 당일 proof가 이 판정을 공유해야 아침 PASS가 밤 UNKNOWN으로 뒤집히지 않는다.
 * 상태·cohort 소속은 각 소비자가 별도로 확인하고, 여기서는 요청 자체의 불변 메타데이터와
 * 태그된 자연 슬롯의 실제 45분 시작 경계를 본다.
 */
export function supplyCostRequestMetadataEligible(i: {
  startedAt: string
  supplyContract?: string | null
  pricingVersion?: string | null
  sourceKey?: string | null
  runId: string
  reservedUsd: number | null
  budgetDailyUsd?: number | null
  budgetCeilingUsd?: number | null
  budgetCapUsd?: number | null
  budgetSource?: string | null
  runKind?: 'scheduled' | 'manual' | null
  runSlot?: string | null
  runTokenShadow?: unknown
  resolvedBy?: string | null
}, kstDate: string): boolean {
  const expected = supplyCostContractOf(kstDate)
  const scheduled = supplyCostScheduledSlotOf(i)
  const recordedBudget = supplyCostRecordedBudgetCapOf(i, kstDate)
  const runToken = parseRunTokenShadowTag(i.runTokenShadow)
  if (expected === null) return false
  return i.supplyContract === expected.supplyContract
    && i.pricingVersion === expected.pricingVersion
    && scheduled !== null && scheduled.kstDate === kstDate
    && supplyCostRequestStartedInScheduledWindow(i)
    && runToken?.ok === true
    && runToken.budgetWindow === i.runSlot
    && isNaturalScheduledRunTag(runToken)
    && (i.resolvedBy === null || i.resolvedBy === undefined)
    && typeof i.sourceKey === 'string' && i.sourceKey !== ''
    && i.reservedUsd !== null && Number.isFinite(i.reservedUsd) && i.reservedUsd > 0
    && recordedBudget !== null
}

export type SupplyCostEnvelopeInput = {
  settledRequests: number
  usageUnknownRequests: number
  /** 실제 정산액이 요청 전 예약액을 넘은 요청 — 1건이라도 알려진 비용 결함이다 */
  overrunRequests: number
  /** 현재 계약·원천·자연 proof 회차·양수 예약을 증명하지 못한 요청 수 */
  ineligibleRequests: number
  /** 정산액 + 미상 예약액 또는 목표 단계 투영 위험액 */
  riskUsd: number | null
  /** 같은 판정 범위에 승인된 공급 예산 */
  budgetUsd: number | null
}

export type SupplyCostEvidence = {
  /** 시행일 전 판정을 소급 변경하지 않기 위한 옛 하루 전체 미상 수 */
  legacyUsageUnknownRequests: number
  /**
   * 하루 공급 장부의 중대 무결성. 늦은 준비 회차의 단순 사용량 미상·상한 소진은 제외하고,
   * 장부 판독 실패·정산 보류·예약 초과·기록 예산 초과는 bad다. 기록 예산 provenance가
   * 불완전하면 unknown이다.
   */
  wholeDayCriticalHealth: 'ok' | 'bad' | 'unknown'
  /** 시행일부터 쓰는 자연 proof 슬롯 비용 표본 */
  envelope: SupplyCostEnvelopeInput
}

export type SupplyCostEnvelopeVerdict = {
  version: typeof SUPPLY_COST_ENVELOPE_VERSION
  kind: 'clean' | 'bounded' | 'unknown' | 'bad'
  settledRatio: number | null
  reasons: readonly string[]
}

const count = (v: number): boolean => Number.isInteger(v) && v >= 0
const positive = (v: number | null): v is number => v !== null && Number.isFinite(v) && v > 0

export function usesSupplyCostEnvelope(kstDate: string): boolean {
  return strictKstDate(kstDate) && kstDate >= SUPPLY_COST_ENVELOPE_EFFECTIVE_KST_DATE
}

export function judgeSupplyCostEnvelope(input: SupplyCostEnvelopeInput): SupplyCostEnvelopeVerdict {
  const reasons: string[] = []
  if (!count(input.settledRequests) || !count(input.usageUnknownRequests)
    || !count(input.overrunRequests) || !count(input.ineligibleRequests)) {
    return { version: SUPPLY_COST_ENVELOPE_VERSION, kind: 'unknown', settledRatio: null, reasons: ['요청 수 모양이 올바르지 않다'] }
  }

  const observed = input.settledRequests + input.usageUnknownRequests
  const settledRatio = observed > 0 ? input.settledRequests / observed : null

  if (input.overrunRequests > 0) {
    return {
      version: SUPPLY_COST_ENVELOPE_VERSION,
      kind: 'bad',
      settledRatio,
      reasons: [`실제 정산액이 예약액을 넘은 요청 ${input.overrunRequests}건`],
    }
  }

  if (input.ineligibleRequests > 0) reasons.push(`귀속·예약을 증명하지 못한 요청 ${input.ineligibleRequests}건`)
  const minimumSettled = input.usageUnknownRequests > 0
    ? SUPPLY_COST_ENVELOPE_MIN_BOUNDED_SETTLED_REQUESTS
    : SUPPLY_COST_ENVELOPE_MIN_CLEAN_SETTLED_REQUESTS
  if (input.settledRequests < minimumSettled) {
    reasons.push(`정산 표본 ${input.settledRequests}건 < ${minimumSettled}건`)
  }
  if (settledRatio === null || settledRatio < SUPPLY_COST_ENVELOPE_MIN_SETTLED_RATIO) {
    reasons.push(`정산 비율 ${settledRatio === null ? '모름' : settledRatio.toFixed(4)} < ${SUPPLY_COST_ENVELOPE_MIN_SETTLED_RATIO}`)
  }
  if (!positive(input.riskUsd)) reasons.push('위험액을 확정할 수 없다')
  if (!positive(input.budgetUsd)) reasons.push('승인 예산을 확정할 수 없다')
  // 승인 예산 초과는 귀속 불명·표본 부족과 함께 있어도 알려진 FAIL이다.
  // UNKNOWN을 먼저 반환하면 이미 입증된 예산 초과가 안전한 보류로 약화된다.
  if (positive(input.riskUsd) && positive(input.budgetUsd) && input.riskUsd > input.budgetUsd) {
    return {
      version: SUPPLY_COST_ENVELOPE_VERSION,
      kind: 'bad',
      settledRatio,
      reasons: [`위험액 $${input.riskUsd.toFixed(6)} > 승인 예산 $${input.budgetUsd.toFixed(6)}`],
    }
  }
  if (reasons.length > 0) {
    return { version: SUPPLY_COST_ENVELOPE_VERSION, kind: 'unknown', settledRatio, reasons }
  }
  return {
    version: SUPPLY_COST_ENVELOPE_VERSION,
    kind: input.usageUnknownRequests === 0 ? 'clean' : 'bounded',
    settledRatio,
    reasons: input.usageUnknownRequests === 0
      ? ['정산 표본·귀속·예산이 완전하고 전체 위험액이 승인 예산 안이다']
      : ['미상 사용량은 열린 예약으로 유지되고 전체 위험액이 승인 예산 안이다'],
  }
}
