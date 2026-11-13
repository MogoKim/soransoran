/**
 * 공급 비용 **진단** — 🔴 보고 전용. 판정(preflight `SUPPLY_COST_*` · 증거 envelope)은 이 파일을 읽지 않는다 (2026-11-13)
 *
 * 🔴 **왜 따로 두는가.** 단계 preflight 의 비용 판정은 판정 시각 직전 rolling 72h cohort 하나가 권위다(canon §3.4).
 *    재시도 권위 단일화(PR 838 · 2026-11-11 병합)는 공급 계약 표식을 바꾸지 않았다 — 그래서 72h 창에 PR 838 이전 회차가
 *    "현재 계약" 으로 함께 들어갈 수 있다. 그 사실을 **보는** 것은 필요하지만, 유리한 회차만 골라 판정하는 것은 금지다.
 *    이 파일은 같은 권위 함수(`costAttributionOf`)를 좁은 회차 집합으로 한 번 더 불러 **숫자만** 낸다.
 *
 * 🔴 경계 시각은 PR 838 **병합 시각**이다 — 실제 runtime 배포 시각이 아니다. 병합 뒤·배포 전 회차가 섞일 수 있으므로
 *    이 값은 "PR 838 이후" 의 상한도 하한도 아니다(`basis: 'mergedAtLowerBound'`). 배포 시각은 runtime 기록에서 따로 본다.
 * 🔴 결과 수는 이 회차들의 장부 원천 열쇠 중 결말이 공개·예정인 고유 원천이다 — 권위 cohort 의 큐 행 수가 아니다.
 *    결말이 아직 안 난 원천의 비용은 분자에만 들어가므로, 최근 회차만 자르면 단가가 위로 치우친다(보고에 그대로 적는다).
 */
import { pipelineRunOfLedger, costAttributionOf, type CostAttribution, type CostFate } from './ready-fate'
import type { LedgerEntry, LedgerStage } from './llm-ledger'
import { runIdStartMs } from './ops-shadow-plan'

/** PR 838(재시도 권위 단일화) main 병합 시각 — 🔴 배포 시각이 아니다 */
export const RETRY_AUTHORITY_V7_MERGED_AT = '2026-11-11T01:40:12+09:00'

export type CostEpochDiagnostic = {
  kind: 'diagnostic-only'
  basis: 'mergedAtLowerBound'
  epochFrom: string
  /** 경계 뒤에 시작한 cohort 회차 수 */
  epochRuns: number
  /** 경계 앞이라 뺀 cohort 회차 수 */
  excludedRuns: number
  /** 회차 id 를 시각으로 읽지 못해 뺀 회차 수 — 🔴 조용히 넣지 않는다 */
  unparsedRuns: number
  results: { published: number; scheduled: number }
  /** 같은 권위 함수의 결과 — 연결이 불완전하면 단가는 `null` 이다 */
  attribution: CostAttribution | null
  usdPerSlotValidResult: number | null
  notes: string[]
}

/**
 * 🔴 PR 838 경계 뒤 회차만의 결과당 비용 — 진단 전용.
 *    입력이 없거나(`entries === null`) 경계 시각을 읽지 못하면 단가는 `null` 이다(모름).
 */
export function costEpochDiagnosticOf(i: {
  entries: readonly LedgerEntry[] | null
  fateByKey: ReadonlyMap<string, CostFate>
  cohortRuns: ReadonlySet<string>
  epochFromIso?: string
}): CostEpochDiagnostic {
  const epochFrom = i.epochFromIso ?? RETRY_AUTHORITY_V7_MERGED_AT
  const fromMs = Date.parse(epochFrom)
  const notes: string[] = [
    '진단 전용 — 단계 preflight·증거 판정은 rolling 72h 권위 cohort 만 쓴다',
    '경계는 PR 838 병합 시각이다 — 배포 시각이 아니라 병합 뒤·배포 전 회차가 섞일 수 있다',
  ]
  const epochRuns = new Set<string>()
  let excluded = 0
  let unparsed = 0
  for (const run of i.cohortRuns) {
    const at = runIdStartMs(run)
    if (at === null || !Number.isFinite(fromMs)) { unparsed += 1; continue }
    if (at >= fromMs) epochRuns.add(run)
    else excluded += 1
  }
  if (unparsed > 0) notes.push(`회차 id 를 시각으로 읽지 못한 회차 ${unparsed}개를 뺐다`)
  const published = new Set<string>()
  const scheduled = new Set<string>()
  for (const e of i.entries ?? []) {
    const run = pipelineRunOfLedger(e.runId)
    if (run === null || !epochRuns.has(run)) continue
    const key = typeof e.sourceKey === 'string' && e.sourceKey !== '' ? e.sourceKey : null
    if (key === null) continue
    const fate = i.fateByKey.get(key)
    if (fate === 'published') published.add(key)
    else if (fate === 'scheduled') scheduled.add(key)
  }
  const results = { published: published.size, scheduled: scheduled.size }
  const attribution = i.entries === null || !Number.isFinite(fromMs) ? null
    : costAttributionOf({ entries: i.entries, fateByKey: i.fateByKey, counts: results, cohortRuns: epochRuns })
  if (attribution !== null && attribution.byFate.unknown > 0) {
    notes.push('결말이 아직 안 난 원천의 비용이 분자에 있다 — 최근 회차일수록 단가가 위로 치우친다')
  }
  return {
    kind: 'diagnostic-only', basis: 'mergedAtLowerBound', epochFrom,
    epochRuns: epochRuns.size, excludedRuns: excluded, unparsedRuns: unparsed,
    results, attribution, usdPerSlotValidResult: attribution?.usdPerSlotValidResult ?? null, notes,
  }
}

/** 🔴 noReady 단계 분해 요약 — 재시도 단계는 장부 단계 이름이 `…Retry` 인 것뿐이다(이름 밖 추정 0) */
export function noReadyBreakdownOf(a: CostAttribution | null): {
  byStage: Readonly<Partial<Record<LedgerStage, number>>> | null
  retryUsd: number | null
  firstPassUsd: number | null
  /** 장부에 원천 종류·막은 gate 칸이 없다 — 여기서 만들지 않는다 */
  bySource: 'unknown'
  byGate: 'unknown'
} {
  const byStage = a?.noReadyByStage ?? null
  if (byStage === null) return { byStage: null, retryUsd: null, firstPassUsd: null, bySource: 'unknown', byGate: 'unknown' }
  let retry = 0
  let first = 0
  for (const [stage, usd] of Object.entries(byStage) as [LedgerStage, number][]) {
    if (stage.endsWith('Retry')) retry += usd
    else first += usd
  }
  return { byStage, retryUsd: retry, firstPassUsd: first, bySource: 'unknown', byGate: 'unknown' }
}
