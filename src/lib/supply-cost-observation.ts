/**
 * 공급 비용 **동일 분모 관측** — 🔴 순수 함수 · 보고 전용. 판정은 이 파일을 읽지 않는다 (2026-11-15)
 *
 * 🔴 결과당 단가는 **정본 `costAttributionOf` 의 값을 그대로** 받는다(preflight 와 같은 cohort · 같은 분모).
 *    여기서 단가를 다시 계산하지 않는다. 이 파일이 더하는 것은 일자별 정산·미상·예약 분해와 coverage 뿐이다.
 * 🔴 coverage = rolling 창의 장부 날짜 중 읽힌 날 수 · 그리고 cohort 회차 중 기준 시각(runtime 배포) 뒤에 시작한 회차 비율.
 *    "새 코드만으로 채워진 창" 인지 보는 값이다 — 유리한 회차만 고르는 데 쓰지 않는다.
 */
export type CostLedgerLine = {
  runId: string; stage: string; status: string; settledUsd: number | null; reservedUsd: number | null
  startedAt: string; provider: string; model: string
  inputTokens: number | null; outputTokens: number | null
}
export type CostDay = {
  ledgerDate: string
  readable: boolean
  requests: number; settled: number; usageUnknown: number; reserved: number; blocked: number
  settledUsd: number; unknownReservedUsd: number
  byModel: Record<string, { requests: number; settledUsd: number; inputTokens: number; outputTokens: number }>
}

export function costDaysOf(days: readonly { date: string; entries: readonly CostLedgerLine[] | null }[], isContentStage: (s: string) => boolean): CostDay[] {
  return days.map(({ date, entries }) => {
    const d: CostDay = { ledgerDate: date, readable: entries !== null, requests: 0, settled: 0, usageUnknown: 0, reserved: 0, blocked: 0, settledUsd: 0, unknownReservedUsd: 0, byModel: {} }
    for (const e of entries ?? []) {
      if (!isContentStage(e.stage)) continue
      d.requests += 1
      if (e.status === 'settled') { d.settled += 1; d.settledUsd += e.settledUsd ?? 0 }
      else if (e.status === 'usageUnknown') { d.usageUnknown += 1; d.unknownReservedUsd += e.reservedUsd ?? 0 }
      else if (e.status === 'reserved') d.reserved += 1
      else if (e.status === 'blocked') d.blocked += 1
      const k = `${e.provider}/${e.model}`
      const m = d.byModel[k] ?? { requests: 0, settledUsd: 0, inputTokens: 0, outputTokens: 0 }
      m.requests += 1; m.settledUsd += e.status === 'settled' ? (e.settledUsd ?? 0) : 0
      m.inputTokens += e.inputTokens ?? 0; m.outputTokens += e.outputTokens ?? 0
      d.byModel[k] = m
    }
    d.settledUsd = Math.round(d.settledUsd * 1e6) / 1e6
    d.unknownReservedUsd = Math.round(d.unknownReservedUsd * 1e6) / 1e6
    return d
  })
}

/** 🔴 coverage — 창 장부 날짜 읽힘 · cohort 회차 중 기준 시각 뒤 시작 비율. 시각을 읽지 못한 회차는 따로 센다 */
export function costCoverageOf(i: {
  days: readonly CostDay[]
  cohortRuns: readonly string[]
  runStartMs: (runId: string) => number | null
  sinceMs: number | null
}): { ledgerDays: number; readableDays: number; cohortRuns: number; runsAfterSince: number | null; unparsedRuns: number; afterSinceRatio: number | null } {
  let after = 0; let unparsed = 0
  for (const r of i.cohortRuns) {
    const t = i.runStartMs(r)
    if (t === null) { unparsed += 1; continue }
    if (i.sinceMs !== null && t >= i.sinceMs) after += 1
  }
  const parsed = i.cohortRuns.length - unparsed
  return {
    ledgerDays: i.days.length, readableDays: i.days.filter((d) => d.readable).length,
    cohortRuns: i.cohortRuns.length, runsAfterSince: i.sinceMs === null ? null : after, unparsedRuns: unparsed,
    afterSinceRatio: i.sinceMs === null || parsed === 0 ? null : Math.round((after / parsed) * 1000) / 1000,
  }
}

/** 🔴 상한 대비 — 단가가 null 이면 판정하지 않는다(UNKNOWN). 상한은 바꾸지 않는다 */
export function costVersusCap(usdPerSlotValidResult: number | null, capUsd: number): 'UNKNOWN' | 'AT_OR_BELOW_CAP' | 'ABOVE_CAP' {
  if (usdPerSlotValidResult === null) return 'UNKNOWN'
  return usdPerSlotValidResult <= capUsd ? 'AT_OR_BELOW_CAP' : 'ABOVE_CAP'
}
