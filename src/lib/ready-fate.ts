/**
 * 🔴 **자동 READY 결말 · 원천 수율 · 유료 묶음 크기 · 비용 귀속** (2026-10-04 · canon §3.1 · P0-2) — 순수 함수
 *
 *   P0-1 보정은 결말이 없는 READY(대기)를 통째로 "전부 공개 / 전부 손실" 두 극단으로만 다뤘다.
 *   여기서는 대기 행 하나하나를 **정본 `judgeSlotRelease` 하나로** 세 갈래로 나눈다 — 새 신선도 · 화제성 점수 없음.
 *     · `scheduled` 다가오는 예정 슬롯에 정본 짝짓기(`matchOpportunitiesToSlots`)로 이미 걸렸다
 *     · `lost`      시간이 지나도 바뀌지 않는 이유로 정본 판정이 그 행을 다시는 eligible 로 내지 않는다
 *                   (예정 슬롯 시점 원문 나이 한도 초과 — 나이는 줄지 않는다 · 저장된 증거 자체의 부재 · 손상)
 *     · `unknown`   그 밖 전부 — 짝이 없지만 아직 eligible · Persona · 시계 관련 · 판정 불가. 🔴 PASS 도 FAIL 도 아니다
 *
 *   🔴 발행 시점 재검사는 그대로다 — `scheduled` 는 공개가 아니다. 발행 트랜잭션이 그 시각에 다시 판정한다.
 */
import type { LedgerEntry } from './llm-ledger'
import { judgeSlotRelease, type ReleaseReason } from './source-slot-release'
import { SUPPLY_JIT_CONTRACT } from './supply-intent'

// ─────────────────────────────────────────────────────────
// 🔴 대기 행 결말
// ─────────────────────────────────────────────────────────

export type PendingFate = 'scheduled' | 'lost' | 'unknown'

/**
 * 🔴 **시간이 지나도 풀리지 않는 정본 실패 사유** — 행에 저장된 증거 기록은 READY 이후 바뀌지 않는다.
 *    이 사유로 판정이 막힌 행은 발행 트랜잭션이 만나는 즉시 `EXPIRED` 로 옮긴다(구제 없음).
 *    🔴 시계에 기대는 사유(`*_IN_FUTURE` · 중첩 시각 순서 `EVIDENCE_INVALID`)는 넣지 않는다 — 시간이 풀 수 있다.
 *    🔴 나이 한도(`SOURCE_TOO_OLD_AT_SLOT`)는 따로 본다 — 가장 이른 예정 슬롯에서 넘었으면 이후 슬롯에서도 넘는다.
 */
export const TIME_INVARIANT_LOSS_REASONS: readonly ReleaseReason[] = [
  'EVIDENCE_MISSING', 'POSTED_MISSING', 'POSTED_CORRUPT', 'CAPTURED_MISSING', 'CAPTURED_CORRUPT',
  'POSTED_AFTER_CAPTURE', 'RESPONSE_UNOBSERVED', 'RESPONSE_UNNORMALIZED', 'DRIVER_UNKNOWN',
]

/**
 * 🔴 **대기 행 하나의 결말.** `matched` 는 호출부가 정본 짝짓기(커버리지와 **같은** 호출)에서 얻은 값이다.
 *    짝이 없으면 가장 이른 다가오는 슬롯(없으면 지금)에서 정본 판정을 한 번 부른다 — Persona 는 손실 사유가 아니다.
 */
export function pendingFateOf(i: {
  gateResults: unknown
  matched: boolean
  horizon: readonly Date[]
  now: Date
  tieBreak: string
}): { fate: PendingFate; reason: ReleaseReason | null } {
  if (i.matched) return { fate: 'scheduled', reason: null }
  const future = i.horizon.filter((d) => d.getTime() >= i.now.getTime()).sort((a, b) => a.getTime() - b.getTime())
  const v = judgeSlotRelease({
    gateResults: i.gateResults, slotAt: future[0] ?? i.now, now: i.now,
    hardGates: { ok: true, codes: [] }, assignment: { ok: true }, tieBreak: i.tieBreak,
  })
  const reason = v.reasons[0] ?? null
  if (v.verdict === 'ineligible' && reason === 'SOURCE_TOO_OLD_AT_SLOT') return { fate: 'lost', reason }
  if (v.verdict === 'unknown' && reason !== null && TIME_INVARIANT_LOSS_REASONS.includes(reason)) return { fate: 'lost', reason }
  return { fate: 'unknown', reason }
}

/** 🔴 결말이 난 상태 — 공개 · 손실(발행 직전 판정 만료 · 철회) */
export const READY_LOSS_STATUSES: readonly string[] = ['EXPIRED', 'DECLINED']

export type FateCounts = { published: number; lost: number; scheduled: number; unknown: number }

/**
 * 🔴 **cohort 결말 합계.** 상태가 결말을 말하면 그것이 이긴다. 대기 행은 `fate`(없으면 unknown)로 센다.
 *    대기 행의 손실 확정은 `lost` 에 더한다 — 상태 손실과 같은 무게다.
 */
export function cohortFatesOf(rows: readonly { status: string; fate: PendingFate | null }[]): FateCounts {
  const c: FateCounts = { published: 0, lost: 0, scheduled: 0, unknown: 0 }
  for (const r of rows) {
    if (r.status === 'PUBLISHED') c.published += 1
    else if (READY_LOSS_STATUSES.includes(r.status)) c.lost += 1
    else if (r.fate === 'scheduled') c.scheduled += 1
    else if (r.fate === 'lost') c.lost += 1
    else c.unknown += 1
  }
  return c
}

// ─────────────────────────────────────────────────────────
// 🔴 원천 수율 — 대기 포함 raw 수율이 아니라 결말 기준
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **원천 1건당 slot-valid 결과 수율 구간.** 분모는 같은 창 공급 묶음 원천 수다.
 *    `low` = (공개 + 예정 슬롯에 걸린 대기) ÷ 원천 · `high` = low + 모르는 대기 ÷ 원천. 손실은 어느 쪽에도 없다.
 *    원천 수를 모르거나 0 이면 `null`(모름).
 */
export function terminalYieldOf(c: FateCounts, sources: number | null): { low: number; high: number } | null {
  if (sources === null || !Number.isInteger(sources) || sources <= 0) return null
  const ok = c.published + c.scheduled
  return { low: ok / sources, high: (ok + c.unknown) / sources }
}

// ─────────────────────────────────────────────────────────
// 🔴 유료 묶음 크기 — 부족분에서만
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **이번 회차에 유료로 보낼 원천 수.** 수요(다가오는 슬롯 − 그 슬롯에 eligible 인 READY)가 0 이면 0 이다.
 *    부족분보다 많은 원천을 보내는 근거는 **실측 수율** 하나다 — `ceil(부족 ÷ 수율 상한)`.
 *    🔴 상한(`high`)을 쓰는 이유: 근거가 허락하는 **가장 작은 증폭**이다. 모르는 대기를 실패로 보고 더 사지 않는다.
 *    🔴 수율을 모르거나 0 이면 증폭하지 않는다 — 부족분만큼만(돈을 더 써도 결과가 는다는 근거가 없다).
 *    회차 묶음 천장(`cap`)은 안전장치다 — 소비 목표가 아니다.
 */
export function paidSourcesFor(i: { deficit: number; yieldHigh: number | null; cap: number }): {
  sources: number; basis: 'noDemand' | 'deficitOnly' | 'measuredYield'
} {
  const cap = Number.isInteger(i.cap) && i.cap > 0 ? i.cap : 0
  if (!Number.isInteger(i.deficit) || i.deficit <= 0 || cap === 0) return { sources: 0, basis: 'noDemand' }
  if (i.yieldHigh === null || !(i.yieldHigh > 0)) return { sources: Math.min(cap, i.deficit), basis: 'deficitOnly' }
  return { sources: Math.min(cap, Math.ceil(i.deficit / i.yieldHigh)), basis: 'measuredYield' }
}

// ─────────────────────────────────────────────────────────
// 🔴 비용 귀속 — 장부 요청 → 원천 해시 → 결과 행
// ─────────────────────────────────────────────────────────

export type CostFate = PendingFate | 'published' | 'noReady'

/**
 * 🔴 **장부 회차 id → 파이프라인 회차 id** — `supply-process.ledgerRunIdOf`(`<runId>-j` · `<runId>-d`)의 역.
 *    모양이 다르면 `null`(어느 cohort 회차인지 모른다).
 */
export function pipelineRunOfLedger(ledgerRunId: string): string | null {
  const m = /^(\d{8}-\d{6})-[jd]$/.exec(ledgerRunId)
  return m === null ? null : m[1]!
}

export type CostAttribution = {
  /** 🔴 현재 JIT 계약(`supply-jit-v1`) 정산 합계 — 결과당 단가의 분자는 이것 하나다 */
  totalUsd: number
  /** 원천 해시가 없는 현재 계약 정산 — 🔴 0 이 아니면 결과당 단가를 내지 않는다 */
  unlinkedUsd: number
  /**
   * 🔴 JIT 계약 표식이 없는 정산(옛 장부 · 손 실행) — 보고만 한다. 구제하지 않고 현재 계약 단가에도 넣지 않는다.
   *    (2026-10-04 P0-2 최종) 분리 가능한 legacy 는 현재 계약 단가 계산을 막지 않는다 — 3일 창을 인위로 기다리지 않는다.
   */
  legacyUsd: number
  /** 예약만 있고 정산이 없는 **현재 계약** 유료 요청 수 — 🔴 0 이 아니면 합계를 모른다 */
  openRequests: number
  /** 예약만 있는 legacy 요청 수 — 보고만 한다 */
  legacyOpenRequests: number
  /** 🔴 현재 계약이지만 **다른 cohort 회차**(창 밖 묶음)의 정산 — 이 cohort 의 분자가 아니다 · 보고만 한다 */
  otherCohortUsd: number
  byFate: Record<CostFate, number>
  /**
   * 🔴 확인된 slot-valid 결과(공개 + 예정 슬롯 대기) 1건당 전 비용의 보수적 상한.
   * 현재 계약의 결말 모름 · 손실 · READY 미생성 비용까지 분자에 모두 넣고, 확인된 결과만 분모에 넣는다.
   */
  usdPerSlotValidResult: number | null
  /** 🔴 공개 1건당 전 비용 — 위 조건 + 대기 결과가 없을 때만 */
  usdPerPublished: number | null
  /** 🔴 손실(만료 · 철회 · 손실 확정 대기)로 끝난 원천에 쓴 돈 — 연결이 완전할 때만 */
  wasteUsd: number | null
  /** 🔴 READY 가 되지 못한 원천(판정 HOLD · 생성 실패 · 재시도)에 쓴 돈 — 연결이 완전할 때만 */
  noReadyUsd: number | null
}

/**
 * 🔴 **장부 요청을 원천 결과에 붙인다.** 현재 JIT 계약 표식(`supplyContract`)이 있는 요청만 `sourceKey`(원천 해시)로
 *    결과 행의 결말에 붙인다. 표식 없는 요청은 legacy 다 — 따로 보고하고 현재 계약 단가에는 넣지도 막지도 않는다.
 *    현재 계약 요청 중 미연결 · 미정산이 하나라도 있거나, 현재 계약 정산 0 · slot-valid 결과 0 이면 단가는 모른다.
 *    결말 모름 비용은 분자에 포함한다. 그 행이 나중에 성공하면 분모만 늘어 단가가 낮아지고, 실패하면 지금 상한이 그대로라
 *    `전체 정산 ÷ 현재 확인된 결과`는 예산을 과소평가하지 않는다.
 *    장부를 못 읽었으면 `null`. 해시 없는 요청 · 끝나지 않은 요청이 있으면 결과당 단가는 `null` 이다 —
 *    🔴 raw 단가(정산 ÷ 행 수)로 대신하지 않는다.
 */
export function costAttributionOf(i: {
  entries: readonly LedgerEntry[] | null
  fateByKey: ReadonlyMap<string, CostFate>
  counts: { published: number; scheduled: number }
  /**
   * 🔴 **이 cohort 의 회차 집합**(같은 창 `workset-v3` 색인) — 큐 결과 · 묶음 원천 수와 **같은 cohort** 의 비용만 분자에 넣는다.
   *    회차 id 를 읽을 수 없는 현재 계약 줄은 미연결이다(모름).
   */
  cohortRuns: ReadonlySet<string>
}): CostAttribution | null {
  if (i.entries === null) return null
  const byFate: Record<CostFate, number> = { published: 0, scheduled: 0, lost: 0, unknown: 0, noReady: 0 }
  let total = 0
  let unlinked = 0
  let legacy = 0
  let open = 0
  let legacyOpen = 0
  let otherCohort = 0
  for (const e of i.entries) {
    if (e.stage === 'countTokens' || e.status === 'blocked') continue
    const current = e.supplyContract === SUPPLY_JIT_CONTRACT
    if (e.status !== 'settled' || e.settledUsd === null) {
      // 🔴 미정산도 같은 cohort 회차 것만 이 cohort 를 막는다 — 다른 회차 · legacy 는 보고만
      const run = current ? pipelineRunOfLedger(e.runId) : null
      if (!current) legacyOpen += 1
      else if (run === null || i.cohortRuns.has(run)) open += 1
      continue
    }
    if (!current) { legacy += e.settledUsd; continue }
    const run = pipelineRunOfLedger(e.runId)
    if (run === null) { unlinked += e.settledUsd; continue }
    if (!i.cohortRuns.has(run)) { otherCohort += e.settledUsd; continue }
    total += e.settledUsd
    const key = typeof e.sourceKey === 'string' && e.sourceKey !== '' ? e.sourceKey : null
    if (key === null) { unlinked += e.settledUsd; continue }
    byFate[i.fateByKey.get(key) ?? 'noReady'] += e.settledUsd
  }
  const complete = unlinked === 0 && open === 0
  const results = i.counts.published + i.counts.scheduled
  return {
    totalUsd: total, unlinkedUsd: unlinked, legacyUsd: legacy, openRequests: open, legacyOpenRequests: legacyOpen, otherCohortUsd: otherCohort, byFate,
    // 🔴 정산 0 으로 결과가 났다는 것은 지출이 장부에 없다는 뜻이다 — 0 단가를 근거로 쓰지 않는다
    usdPerSlotValidResult: complete && total > 0 && results > 0 ? total / results : null,
    usdPerPublished: complete && total > 0 && byFate.unknown === 0 && i.counts.scheduled === 0 && i.counts.published > 0
      ? total / i.counts.published : null,
    wasteUsd: complete ? byFate.lost : null,
    noReadyUsd: complete ? byFate.noReady : null,
  }
}
