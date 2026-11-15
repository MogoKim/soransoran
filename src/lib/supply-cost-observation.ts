/**
 * 공급 비용 관측 — 🔴 순수 함수 · **진단 전용**. 판정은 이 파일을 읽지 않는다 (2026-11-15)
 *
 * 🔴 **권위 단가는 UNKNOWN 이다.** preflight 의 결과당 단가는 controller 가 그 판정 시각에 가진 입력
 *    (다가오는 슬롯 짝짓기 `matched` · `horizon`)으로 계산된다. 관측기는 그 입력을 재현하지 못하므로
 *    `authoritativeUsdPerSlotValidResult` 는 언제나 null 이고, 정본 함수를 비운 입력으로 부른 값은 **진단값**으로만 낸다.
 * 🔴 모르는 것은 0 이 아니다 — 장부를 못 읽은 날 · null/비유한 금액·토큰은 그 칸을 null 로 만든다.
 * 🔴 coverage 기준 시각은 **실제 배포 증거**(manifest.sha = pin 일 때의 manifest.deployedAt)나 명시 인자에서만 온다.
 *    배포되지 않은 SHA 의 시각을 상수로 박지 않는다.
 */
export type CostLedgerLine = {
  runId: string; stage: string; status: string; settledUsd: unknown; reservedUsd: unknown
  startedAt: string; provider: string; model: string
  inputTokens: unknown; outputTokens: unknown
}
type N = number | null
export type CostDay = {
  ledgerDate: string
  readable: boolean
  requests: N; settled: N; usageUnknown: N; reserved: N; blocked: N
  settledUsd: N; unknownReservedUsd: N
  byModel: Record<string, { requests: number; settledUsd: N; inputTokens: N; outputTokens: N }> | null
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const addN = (acc: N, v: unknown): N => (acc === null || !finite(v) ? null : acc + v)
const round6 = (v: N): N => (v === null ? null : Math.round(v * 1e6) / 1e6)

export function costDaysOf(days: readonly { date: string; entries: readonly CostLedgerLine[] | null }[], isContentStage: (s: string) => boolean): CostDay[] {
  return days.map(({ date, entries }) => {
    if (entries === null) {
      return { ledgerDate: date, readable: false, requests: null, settled: null, usageUnknown: null, reserved: null, blocked: null, settledUsd: null, unknownReservedUsd: null, byModel: null }
    }
    let requests = 0; let settled = 0; let usageUnknown = 0; let reserved = 0; let blocked = 0
    let settledUsd: N = 0; let unknownReservedUsd: N = 0
    const byModel: NonNullable<CostDay['byModel']> = {}
    for (const e of entries) {
      if (!isContentStage(e.stage)) continue
      requests += 1
      const k = `${e.provider}/${e.model}`
      const m = byModel[k] ?? { requests: 0, settledUsd: 0, inputTokens: 0, outputTokens: 0 }
      m.requests += 1
      if (e.status === 'settled') {
        settled += 1
        settledUsd = addN(settledUsd, e.settledUsd)
        m.settledUsd = addN(m.settledUsd, e.settledUsd)
        // 🔴 정산 줄의 토큰이 null·비유한이면 그 모델 토큰은 모른다
        m.inputTokens = addN(m.inputTokens, e.inputTokens)
        m.outputTokens = addN(m.outputTokens, e.outputTokens)
      } else if (e.status === 'usageUnknown') {
        usageUnknown += 1
        unknownReservedUsd = addN(unknownReservedUsd, e.reservedUsd)
        // 🔴 사용량을 모르는 요청이 있으면 그 모델의 토큰 합은 모른다
        m.inputTokens = null; m.outputTokens = null
      } else if (e.status === 'reserved') { reserved += 1; m.inputTokens = null; m.outputTokens = null }
      else if (e.status === 'blocked') blocked += 1
      byModel[k] = { ...m, settledUsd: round6(m.settledUsd) }
    }
    return { ledgerDate: date, readable: true, requests, settled, usageUnknown, reserved, blocked, settledUsd: round6(settledUsd), unknownReservedUsd: round6(unknownReservedUsd), byModel }
  })
}

/**
 * 🔴 coverage 기준 시각 — 실제 배포 증거만. manifest.sha 가 pin 과 같을 때의 deployedAt, 또는 명시 인자.
 *    둘 다 없으면 null(기준 뒤 비율 UNKNOWN). 배포 안 된 SHA 시각을 지어내지 않는다.
 */
export function coverageSinceOf(i: { explicitSince: string | null; manifest: { sha?: unknown; deployedAt?: unknown } | null; pin: string | null }): { sinceMs: number | null; basis: 'explicit' | 'manifest-pin' | 'none' } {
  if (i.explicitSince !== null) {
    const t = Date.parse(i.explicitSince)
    return Number.isNaN(t) ? { sinceMs: null, basis: 'none' } : { sinceMs: t, basis: 'explicit' }
  }
  const m = i.manifest
  if (m !== null && typeof m.sha === 'string' && i.pin !== null && m.sha === i.pin && typeof m.deployedAt === 'string') {
    const t = Date.parse(m.deployedAt)
    if (!Number.isNaN(t)) return { sinceMs: t, basis: 'manifest-pin' }
  }
  return { sinceMs: null, basis: 'none' }
}

export function costCoverageOf(i: {
  days: readonly CostDay[]
  cohortRuns: readonly string[] | null
  runStartMs: (runId: string) => number | null
  sinceMs: number | null
}): { ledgerDays: number; readableDays: number; cohortRuns: N; runsAfterSince: N; unparsedRuns: N; afterSinceRatio: N } {
  const base = { ledgerDays: i.days.length, readableDays: i.days.filter((d) => d.readable).length }
  if (i.cohortRuns === null) return { ...base, cohortRuns: null, runsAfterSince: null, unparsedRuns: null, afterSinceRatio: null }
  let after = 0; let unparsed = 0
  for (const r of i.cohortRuns) {
    const t = i.runStartMs(r)
    if (t === null) { unparsed += 1; continue }
    if (i.sinceMs !== null && t >= i.sinceMs) after += 1
  }
  const parsed = i.cohortRuns.length - unparsed
  return {
    ...base, cohortRuns: i.cohortRuns.length, runsAfterSince: i.sinceMs === null ? null : after, unparsedRuns: unparsed,
    afterSinceRatio: i.sinceMs === null || parsed === 0 ? null : Math.round((after / parsed) * 1000) / 1000,
  }
}

/**
 * 🔴 **정본 `CostAttribution` 의 칸을 그대로 옮긴다** — 다시 계산하지 않는다. 칸 목록은 원본 타입의 수치 칸 전부다.
 *    · 원본이 null 인 칸(`trialRisk…` · `usdPerSlotValidResult` · `usdPerPublished` · `wasteUsd` · `noReadyUsd`)은 원본에서 이미 "모름"이다 → null
 *    · 칸이 없거나 숫자가 아니거나 비유한이면 오염이다 → null(UNKNOWN). 🔴 0 으로 채우지 않는다
 */
export const CANONICAL_COST_FIELDS = [
  'totalUsd', 'unlinkedUsd', 'legacyUsd', 'openRequests', 'openReservedUsd', 'legacyOpenRequests',
  'settledRequests', 'usageUnknownRequests', 'recoverySettledRequests', 'recoveryUsageUnknownRequests',
  'trialOverrunRequests', 'trialIneligibleRequests', 'trialRiskUsdPerSlotValidResult', 'otherCohortUsd',
  'usdPerSlotValidResult', 'usdPerPublished', 'wasteUsd', 'noReadyUsd',
] as const
/** 원본 `CostFate` 의 키 — `ready-fate.ts` 의 byFate 초기값과 같은 다섯 개 */
export const COST_FATES = ['published', 'scheduled', 'lost', 'unknown', 'noReady'] as const
export type CanonicalCost = Record<(typeof CANONICAL_COST_FIELDS)[number], N> & {
  /** 운명별 정산액 — 키마다 검증. 원본 칸 자체가 없거나 객체가 아니면 null */
  byFate: Record<(typeof COST_FATES)[number], N> | null
  /** 단계별 noReady 정산액 — 🔴 원본 null 은 "연결 불완전"이라는 뜻이라 null 로 보존한다 */
  noReadyByStage: Record<string, N> | null
}
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
export function canonicalCostFieldsOf(attribution: Record<string, unknown> | null): CanonicalCost {
  const flat = Object.fromEntries(CANONICAL_COST_FIELDS.map((k) => {
    const v = attribution?.[k]
    return [k, finite(v) ? v : null]
  })) as Record<(typeof CANONICAL_COST_FIELDS)[number], N>
  const bf = attribution?.byFate
  const byFate = isObj(bf)
    ? Object.fromEntries(COST_FATES.map((f) => [f, finite(bf[f]) ? bf[f] : null])) as Record<(typeof COST_FATES)[number], N>
    : null
  const ns = attribution?.noReadyByStage
  const noReadyByStage = isObj(ns) ? Object.fromEntries(Object.entries(ns).map(([k, v]) => [k, finite(v) ? v : null])) : null
  return { ...flat, byFate, noReadyByStage }
}

/** 🔴 상한 대비 — 진단 단가로만. 권위 단가가 아니다. null 이면 UNKNOWN. 상한은 바꾸지 않는다 */
export function costVersusCap(usdPerSlotValidResult: N, capUsd: number): 'UNKNOWN' | 'AT_OR_BELOW_CAP' | 'ABOVE_CAP' {
  if (usdPerSlotValidResult === null) return 'UNKNOWN'
  return usdPerSlotValidResult <= capUsd ? 'AT_OR_BELOW_CAP' : 'ABOVE_CAP'
}
