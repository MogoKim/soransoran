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
import { isSupplyContentCostStage, ledgerDateOf, type LedgerEntry } from './llm-ledger'
import type { RetryClass } from './content-core/generation-failure'
import { judgeSlotRelease, type ReleaseReason } from './source-slot-release'
import { SUPPLY_JIT_CONTRACT } from './supply-intent'
import {
  isSupplyCostRecoveryTagged, supplyCostRecoveryRequestMetadataEligible,
  supplyCostRequestMetadataEligible, usesSupplyCostEnvelope,
} from './supply-cost-envelope'

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
 *    부족분보다 많은 원천을 보내는 근거는 실측 수율 또는 **작은 회복 canary**다.
 *    🔴 상한(`high`)을 쓰는 이유: 근거가 허락하는 **가장 작은 증폭**이다. 모르는 대기를 실패로 보고 더 사지 않는다.
 *    🔴 수율을 모르거나 0 이면 부족 슬롯당 최대 3개 원천만 시도한다. 단일 원천 HOLD가 가까운 슬롯 전체를
 *       굶긴 운영 결함을 복구하되, 묶음 전체를 근거 없이 소진하지 않는 작은 canary다.
 *    회차 묶음 천장(`cap`)은 안전장치다 — 소비 목표가 아니다.
 */
export const COLD_START_SOURCES_PER_DEFICIT = 3

export function paidSourcesFor(i: { deficit: number; yieldHigh: number | null; cap: number }): {
  sources: number; basis: 'noDemand' | 'boundedRecovery' | 'measuredYield'
} {
  const cap = Number.isInteger(i.cap) && i.cap > 0 ? i.cap : 0
  if (!Number.isInteger(i.deficit) || i.deficit <= 0 || cap === 0) return { sources: 0, basis: 'noDemand' }
  if (i.yieldHigh === null || !(i.yieldHigh > 0)) {
    return { sources: Math.min(cap, i.deficit * COLD_START_SOURCES_PER_DEFICIT), basis: 'boundedRecovery' }
  }
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
  /** 🔴 해당 날짜의 현재 JIT 계약 정산 합계 — 결과당 단가의 분자는 이것 하나다 */
  totalUsd: number
  /** 원천 해시가 없는 현재 계약 정산 — 🔴 0 이 아니면 결과당 단가를 내지 않는다 */
  unlinkedUsd: number
  /**
   * 🔴 JIT 계약 표식이 없는 정산(옛 장부 · 손 실행) — 보고만 한다. 구제하지 않고 현재 계약 단가에도 넣지 않는다.
   *    (2026-10-04 P0-2 최종) 분리 가능한 legacy 는 현재 계약 단가 계산을 막지 않는다 — 3일 창을 인위로 기다리지 않는다.
   */
  legacyUsd: number
  /** 예약만 있고 정산이 없는 **현재 계약** 유료 요청 수(이 cohort) — 🔴 0 이 아니면 합계를 모른다(단가 `null`) */
  openRequests: number
  /**
   * 🔴 **미정산 요청의 추정 예약액 합(USD) — 보고용** (2026-10-09). 실제 비용이 아니고 비용의 한계도 아니다 —
   *    예약은 count_tokens 추정 위에 잡은 값이라 실제 정산이 넘을 수 있다(`judgeSettle.overran` · `llm-pricing.reserveOf`).
   *    `totalUsd` 에 넣지 않는다. 판정에 쓰지 않는다.
   */
  openReservedUsd: number
  /** 예약만 있는 legacy 요청 수 — 보고만 한다 */
  legacyOpenRequests: number
  /** 이 cohort 에서 실제 사용량으로 정산된 현재 계약 요청 수 */
  settledRequests: number
  /** 이 cohort 에 남은 usageUnknown 요청 수 — 장부 상태는 그대로 유지한다 */
  usageUnknownRequests: number
  /** 제한 복구는 자연 정산 표본에서 분리하지만 비용 위험·결과당 비용에는 포함한다. */
  recoverySettledRequests: number
  recoveryUsageUnknownRequests: number
  /** 실제 정산액이 예약액을 넘은 현재 계약 요청 수 */
  trialOverrunRequests: number
  /** trial 위험 계산에 쓸 수 없는 요청 수(계약·가격판·원천·회차·예약·예산 provenance 불완전) */
  trialIneligibleRequests: number
  /**
   * 🔴 **제한 trial 위험 단가** — 정산액 + usageUnknown 예약액을 확인된 결과로 나눈 관측 envelope.
   * 실제 비용도 상한도 아니며 정산 단가를 대신하지 않는다. 다음 단계 trial 허용 여부에만 쓴다.
   */
  trialRiskUsdPerSlotValidResult: number | null
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
 *    🔴 미정산 요청의 예약액은 실제 비용도 그 한계도 아니다 — 예약이 있어도 단가를 확정하지 않는다(보고용 합계만).
 *    결말 모름 비용은 분자에 포함한다. 그 행이 나중에 성공하면 분모만 늘어 단가가 낮아지고, 실패하면 지금 상한이 그대로라
 *    `전체 정산 ÷ 현재 확인된 결과`는 예산을 과소평가하지 않는다.
 *    장부를 못 읽었으면 `null`. 해시 없는 요청 · 끝나지 않은 요청이 있으면 결과당 단가는 `null` 이다 —
 *    🔴 raw 단가(정산 ÷ 행 수)로 대신하지 않는다.
 */
// ─────────────────────────────────────────────────────────
// 🔴 **재선정 비용 귀속 — 원 opportunity · attempt · 원인** (2026-11-10 retry-authority-v7)
//
//   같은 통합 장부의 현행 칸만 쓴다 — `sourceKey`(원천 해시 · opportunity) · `runId`(→ 파이프라인 회차 · attempt) ·
//   `settledUsd`. 원인은 그 회차 artifact 의 원인(`cause`)·재선정 처리(`retryClass`)를 붙인다. 새 schema · migration 0.
//   🔴 proof · business 비용 계약(`costAttributionOf` · 공용 envelope)은 바꾸지 않는다 — 이것은 관측 view 하나다.
//   🔴 품질·안전 HOLD 는 낭비로 세지 않는다. **확정 회피 비용**은 "선택 시점에 이미 같은 지문으로 결론(`terminal`)이
//   난 원천을 재선정 자리에서 다시 산" 시도의 정산액뿐이다 — 지금 정본(`concludedSourceKeys`)이 그 선택을 막는다.
// ─────────────────────────────────────────────────────────

export type RetryAttempt = {
  /** 파이프라인 회차 id(`YYYYMMDD-HHMMSS`) — 장부 `runId`(`<회차>-j` · `<회차>-d`)와 묶인다 */
  runId: string
  /** 원천 해시 — 장부 `sourceKey` 와 같은 값 */
  sourceKey: string
  /** 선택 자리 — 신규(처음 사는 원천) · 재선정 */
  lane: 'fresh' | 'retry'
  /** 선택 시점 지난 결과의 처리 — 없으면 `none`, 창 밖이거나 못 읽었으면 `unknown` */
  priorRetryClass: RetryClass | 'none' | 'unknown'
  /** 이번 시도의 원인(완주면 `null`) · 처리 */
  cause: string | null
  retryClass: RetryClass | null
  /** 이번 시도가 채택(AUTO_ADOPT)으로 끝났는가 — 채택된 재구매는 낭비가 아니라 v7 이 포기하는 수율이다 */
  adopted: boolean
}

export type RetryCostAttribution = {
  totalUsd: number
  /** 시도와 짝이 없는 정산 — 0 이 아니면 귀속이 불완전하다 */
  unlinkedUsd: number
  /** 정산이 없는 요청 수(예약 · 사용량 미상) — 금액에 넣지 않는다 */
  openRequests: number
  byLane: Record<'fresh' | 'retry', number>
  byCause: Record<string, number>
  byRetryClass: Record<string, number>
  /** 🔴 같은 지문 결론(`terminal`)을 재선정 자리에서 다시 사서 **채택 없이** 끝난 시도의 정산 합 — v7 이 막는 낭비 */
  confirmedAvoidableUsd: number
  confirmedAvoidableAttempts: number
  /** 🔴 같은 지문 결론을 다시 사서 **채택된** 시도 — 낭비가 아니다. v7 이 이 채택을 포기한다(수율 위험 · 따로 보고) */
  reselectedAdoptedUsd: number
  reselectedAdoptedAttempts: number
}

export function retryCostAttributionOf(i: {
  entries: readonly LedgerEntry[] | null
  attempts: readonly RetryAttempt[]
}): RetryCostAttribution | null {
  if (i.entries === null) return null
  const key = (run: string, src: string): string => `${run}\u0000${src}`
  const byKey = new Map(i.attempts.map((a) => [key(a.runId, a.sourceKey), a]))
  const out: RetryCostAttribution = {
    totalUsd: 0, unlinkedUsd: 0, openRequests: 0, byLane: { fresh: 0, retry: 0 },
    byCause: {}, byRetryClass: {}, confirmedAvoidableUsd: 0, confirmedAvoidableAttempts: 0,
    reselectedAdoptedUsd: 0, reselectedAdoptedAttempts: 0,
  }
  const avoidable = new Set<string>()
  const adoptedSet = new Set<string>()
  for (const e of i.entries) {
    if (!isSupplyContentCostStage(e.stage) || e.status === 'blocked') continue
    if (e.status !== 'settled' || e.settledUsd === null) { out.openRequests += 1; continue }
    out.totalUsd += e.settledUsd
    const run = pipelineRunOfLedger(e.runId)
    const a = run === null || typeof e.sourceKey !== 'string' ? undefined : byKey.get(key(run, e.sourceKey))
    if (a === undefined) { out.unlinkedUsd += e.settledUsd; continue }
    out.byLane[a.lane] += e.settledUsd
    const c = a.cause ?? 'complete'
    out.byCause[c] = (out.byCause[c] ?? 0) + e.settledUsd
    const rc = a.retryClass ?? 'unknown'
    out.byRetryClass[rc] = (out.byRetryClass[rc] ?? 0) + e.settledUsd
    if (a.lane === 'retry' && a.priorRetryClass === 'terminal') {
      if (a.adopted) {
        out.reselectedAdoptedUsd += e.settledUsd
        adoptedSet.add(key(a.runId, a.sourceKey))
      } else {
        out.confirmedAvoidableUsd += e.settledUsd
        avoidable.add(key(a.runId, a.sourceKey))
      }
    }
  }
  out.confirmedAvoidableAttempts = avoidable.size
  out.reselectedAdoptedAttempts = adoptedSet.size
  return out
}

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
  let openReserved = 0
  let legacyOpen = 0
  let otherCohort = 0
  let settledRequests = 0
  let usageUnknownRequests = 0
  let recoverySettledRequests = 0
  let recoveryUsageUnknownRequests = 0
  let trialOverrunRequests = 0
  let trialIneligibleRequests = 0
  for (const e of i.entries) {
    if (!isSupplyContentCostStage(e.stage) || e.status === 'blocked') continue
    const started = new Date(e.startedAt)
    const startedDate = Number.isFinite(started.getTime()) ? ledgerDateOf(started) : null
    const strictMetadata = startedDate !== null && usesSupplyCostEnvelope(startedDate)
    const metadataEligible = !strictMetadata
      || (startedDate !== null && supplyCostRequestMetadataEligible(e, startedDate))
    const recoveryTagged = strictMetadata && isSupplyCostRecoveryTagged(e.runTokenShadow)
    const recoveryEligible = strictMetadata && startedDate !== null
      && supplyCostRecoveryRequestMetadataEligible(e, startedDate)
    // 시행일 이후는 날짜 계약 창이 권위다. 현재 상수로 과거 판을 다시 읽지 않는다.
    const current = strictMetadata
      ? ((!recoveryTagged && metadataEligible) || recoveryEligible)
      : e.supplyContract === SUPPLY_JIT_CONTRACT
    const key = typeof e.sourceKey === 'string' && e.sourceKey !== '' ? e.sourceKey : null
    const run = pipelineRunOfLedger(e.runId)
    const belongsToCohort = run === null || i.cohortRuns.has(run)
    const manuallyResolved = e.resolvedBy !== null && e.resolvedBy !== undefined
    /**
     * 예약 초과는 후보 귀속·metadata보다 먼저 보되, 이 preflight가 판정하는 cohort에만
     * 귀속한다. 다른 회차의 전역 초과는 당일 whole-day 비용 브레이크가 맡는다. 둘을
     * 섞으면 다음 날 파일에 함께 든 무관한 회차 하나가 목표 cohort를 거짓 차단한다.
     * run을 읽지 못한 행은 이 cohort가 아니라고 증명할 수 없으므로 보수적으로 포함한다.
     */
    const overranReservation = strictMetadata
      && e.status === 'settled'
      && e.settledUsd !== null
      && e.reservedUsd !== null
      && Number.isFinite(e.reservedUsd)
      && e.reservedUsd > 0
      && e.settledUsd > e.reservedUsd
    if (overranReservation && belongsToCohort) trialOverrunRequests += 1
    // 사람이 제공사 사용량과 대조해 마감한 행은 whole-day 지출에는 남지만 자연 표본은 아니다.
    // 행 날짜가 시행일 전이어도 대상 cohort에 속하면 지우거나 legacy로 완화하지 않고 UNKNOWN으로 닫는다.
    if (manuallyResolved && belongsToCohort) {
      trialIneligibleRequests += 1
      if (e.status === 'settled' && e.settledUsd !== null) {
        total += e.settledUsd
        unlinked += e.settledUsd
      } else {
        open += 1
        if (e.status === 'usageUnknown') {
          if (recoveryEligible) recoveryUsageUnknownRequests += 1
          else usageUnknownRequests += 1
        }
        if (e.reservedUsd !== null && Number.isFinite(e.reservedUsd) && e.reservedUsd > 0) {
          openReserved += e.reservedUsd
        }
      }
      continue
    }
    if (e.status !== 'settled' || e.settledUsd === null) {
      // 🔴 미정산도 같은 cohort 회차 것만 이 cohort 를 막는다 — 다른 회차 · legacy 는 보고만
      if (!current) {
        if (strictMetadata && belongsToCohort) {
          open += 1
          trialIneligibleRequests += 1
          if (e.reservedUsd !== null && Number.isFinite(e.reservedUsd) && e.reservedUsd > 0) openReserved += e.reservedUsd
        } else legacyOpen += 1
        continue
      }
      if (run !== null && !i.cohortRuns.has(run)) continue
      open += 1
      // 🔴 추정 예약액은 보고만 한다 — 실제 비용도 그 한계도 아니다(정산이 예약을 넘을 수 있다). 분자에 넣지 않는다
      const positiveReservation = e.reservedUsd !== null && Number.isFinite(e.reservedUsd) && e.reservedUsd > 0
      if (positiveReservation && e.reservedUsd !== null) openReserved += e.reservedUsd
      if (e.status === 'usageUnknown') {
        if (recoveryEligible) recoveryUsageUnknownRequests += 1
        else usageUnknownRequests += 1
      }
      if (e.status !== 'usageUnknown' || run === null || key === null || !positiveReservation) trialIneligibleRequests += 1
      continue
    }
    if (!current) {
      if (strictMetadata && belongsToCohort) {
        total += e.settledUsd
        unlinked += e.settledUsd
        trialIneligibleRequests += 1
      } else legacy += e.settledUsd
      continue
    }
    if (run === null) { unlinked += e.settledUsd; continue }
    if (!i.cohortRuns.has(run)) { otherCohort += e.settledUsd; continue }
    if (recoveryEligible) recoverySettledRequests += 1
    else settledRequests += 1
    total += e.settledUsd
    if (key === null) { unlinked += e.settledUsd; continue }
    if (overranReservation) {
      unlinked += e.settledUsd
      continue
    }
    byFate[i.fateByKey.get(key) ?? 'noReady'] += e.settledUsd
  }
  const complete = unlinked === 0 && open === 0
  const results = i.counts.published + i.counts.scheduled
  const trialRisk = unlinked === 0 && open > 0 && trialIneligibleRequests === 0
    && total > 0 && results > 0
    ? (total + openReserved) / results
    : null
  return {
    totalUsd: total, unlinkedUsd: unlinked, legacyUsd: legacy, openRequests: open, openReservedUsd: openReserved,
    legacyOpenRequests: legacyOpen, settledRequests, usageUnknownRequests,
    recoverySettledRequests, recoveryUsageUnknownRequests,
    trialOverrunRequests, trialIneligibleRequests,
    trialRiskUsdPerSlotValidResult: trialRisk, otherCohortUsd: otherCohort, byFate,
    // 🔴 정산 0 으로 결과가 났다는 것은 지출이 장부에 없다는 뜻이다 — 0 단가를 근거로 쓰지 않는다
    usdPerSlotValidResult: complete && total > 0 && results > 0 ? total / results : null,
    usdPerPublished: complete && total > 0 && byFate.unknown === 0 && i.counts.scheduled === 0 && i.counts.published > 0
      ? total / i.counts.published : null,
    wasteUsd: complete ? byFate.lost : null,
    noReadyUsd: complete ? byFate.noReady : null,
  }
}
