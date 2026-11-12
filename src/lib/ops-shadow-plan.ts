/**
 * 🔴 **운영 봉투 → 하루 계획 → 부족분 계획 → 하루 결과 — SHADOW 전용 순수 계산** (2026-11-11 · Phase 1 S1/S2)
 *
 *    Observe → Plan → Act → Verify → Sleep 루프의 **Plan 칸**이다. 이 파일은 아무것도 실행하지 않는다 —
 *    DB · 장부 · stage · 발행 · 댓글 · provider · 수집 호출이 없다. 결과는 호출부가 저장소 밖 ops 감사 장부
 *    (`scripts/lib/ops-shadow-io.mts`)에 덧붙일 뿐이고, **권위는 0**이다. 운영 결정의 유일한 권위는 지금도
 *    controller(`StageDecision`)와 공급 러너(`supply-process`)다.
 *
 *    🔴 **판정을 새로 만들지 않는다 — 지금 권위를 그대로 부른다.**
 *       · 부족분          `judgeJitDemand`(supply-process) — 운영 러너가 쓰는 그 함수
 *       · 유료 원천 수    `paidSourcesFor`(ready-fate) — 같은 함수 · 같은 묶음 천장
 *       · 지출 가능 여부  `judgeSpend`(llm-ledger) — 같은 함수. 속도 상한은 그 함수의 `protect.ceilingUsd` 입력으로만 준다
 *       · 요청 수 상한    `judgeStageBudget`(supply-workset) — 원천 1건 = judge 1 + draft 최대 4. 공급 러너가 단계 장부 회차
 *                         (`<runId>-j`·`<runId>-d`)에 주는 상한 그대로다(`LEDGER_CAP_ENV`)
 *       · 증명일 여부     `PROOF_STATES`(stage-evidence) — controller 결정의 상태를 읽을 뿐 다시 판정하지 않는다
 *       · 공급 회차 슬롯  `supplyRunSlotMinuteOf`(supply-schedule-contract)
 *       · 글당 대화 상한  `PERSONA_COMMENTS_PER_POST_MAX`(10 · 구조 상한이지 할당량이 아니다)
 *       · 신선 원천 용량  선택 권위(`selectWorkset` → `judgeSlotRelease`)가 슬롯마다 남긴 판정(`slotAgesH[i]`)에서만 센다 —
 *                         나이 · 72h 를 여기서 다시 판정하지 않는다. 형식은 정본 판독기(`readSupplySelectionTrace`)가 본다
 *    🔴 단계 이름(D20·D30…)으로 분기하지 않는다 — 봉투는 숫자만 받는다(하네스가 단계 리터럴 0 을 ratchet 한다).
 *
 *    🔴 **이 PR 이 판정하지 않는 두 경계** (Codex 결정 대기 — 보고서 참조):
 *       ① 하루 결과의 Dn 판정 — `judgeEvidenceForTarget` 의 결정 검사가 `StageDecision` 의미에 묶여 있다.
 *          여기서는 측정값(자동 발행 수 · 글당 Persona 댓글 최대)만 적고 판정은 controller 몫으로 둔다(`authorityVerdict: null`).
 *       ② 다음 날 증명일 지정 — 준비도 판정 코드 집합(preflight)은 정책이다. 여기서는 controller 결정을 관측만 한다.
 */
import { createHash } from 'node:crypto'

import type { BudgetLimits, DayTally, GateVerdict, ReservationVerdict } from './llm-ledger'
import { judgeSpend } from './llm-ledger'
import { PERSONA_COMMENTS_PER_POST_MAX } from './persona-target-rules'
import { paidSourcesFor } from './ready-fate'
import { PROOF_STATES } from './stage-evidence'
import { judgeJitDemand, type SupplyPolicy } from './supply-process'
import { readSupplySelectionTrace, type TraceReason } from './supply-selection-trace'
import { judgeStageBudget, WORKSET_TOTAL_PER_SOURCE } from './supply-workset'
import { SUPPLY_RUN_SLOTS_KST, SUPPLY_WORKSET_PER_RUN, supplyRunSlotMinuteOf } from './supply-schedule-contract'

export const OPS_SHADOW_VERSION = 'ops-shadow-v1' as const

/**
 * 🔴 **한 회차에 가상으로 보낼 원천 상한** — 작은 묶음 → 검증 → 다음 묶음. 회차 묶음 천장(`SUPPLY_WORKSET_PER_RUN`)과
 *    별개로 더 작게 자른다. shadow 관찰값으로 다음 단계에서 다시 정한다(권위 없음 · 실행 없음).
 */
export const SHADOW_BATCH_MAX_SOURCES = 6

/**
 * 🔴 **속도 상한 여유** — 지금까지 도래한 슬롯 비율만큼의 하루 예산에 이 비율을 더한 천장을 넘지 않는다.
 *    하루 첫 회차가 하루 예산을 다 쓰지 못하게 하는 장치다. 실제 강제는 여전히 장부 예약(`judgeSpend`)이다.
 */
export const SHADOW_PACE_BUFFER_RATIO = 0.25
/** 속도 상한 lead — 다음 슬롯 몇 칸 앞까지 미리 쓸 수 있는가 */
export const SHADOW_PACE_LEAD_SLOTS = 2

/** 선택 트레이스가 이보다 오래됐으면 신선 원천 용량을 모른다(가상 지출 0) */
export const SHADOW_TRACE_MAX_AGE_MS = 3 * 3_600_000

/** writer 관측 창 — 🔴 권위가 아니다. 트리거는 마지막 자연 공급 회차의 완료다 */
export const SHADOW_WRITER_EXPECTED_WINDOW_KST = '22:45-23:00'

// ─────────────────────────────────────────────────────────
// S1 — 봉투 · 하루 계획
// ─────────────────────────────────────────────────────────

export type OperatingEnvelope = {
  version: typeof OPS_SHADOW_VERSION
  /** 하루 공개 상한 — 지금 결정의 공개 프로필 목표(숫자). 단계 이름을 싣지 않는다 */
  publishHardCapPerDay: number
  /** 그날 공개 슬롯 수 — 속도 상한의 분모 */
  publishSlotsPerDay: number
  /** 공급 lane 하루 예산 — 장부 정본 env(`limitsFromEnv`). 모르면 null(가상 지출 0) */
  supplyDailyUsd: number | null
  worksetCapPerRun: number
  batchMaxSources: number
  paceBufferRatio: number
  paceLeadSlots: number
  conversationHardCapPerPost: number
}

const posInt = (n: number): boolean => Number.isInteger(n) && n > 0

export function operatingEnvelopeOf(i: {
  publishHardCapPerDay: number
  publishSlotsPerDay: number
  supplyDailyUsd: number | null
}): OperatingEnvelope {
  if (!posInt(i.publishHardCapPerDay)) throw new Error('OPS_ENVELOPE_BAD_CAP')
  if (!posInt(i.publishSlotsPerDay)) throw new Error('OPS_ENVELOPE_BAD_SLOTS')
  const usd = i.supplyDailyUsd !== null && Number.isFinite(i.supplyDailyUsd) && i.supplyDailyUsd > 0 ? i.supplyDailyUsd : null
  return {
    version: OPS_SHADOW_VERSION,
    publishHardCapPerDay: i.publishHardCapPerDay,
    publishSlotsPerDay: i.publishSlotsPerDay,
    supplyDailyUsd: usd,
    worksetCapPerRun: SUPPLY_WORKSET_PER_RUN,
    batchMaxSources: SHADOW_BATCH_MAX_SOURCES,
    paceBufferRatio: SHADOW_PACE_BUFFER_RATIO,
    paceLeadSlots: SHADOW_PACE_LEAD_SLOTS,
    conversationHardCapPerPost: PERSONA_COMMENTS_PER_POST_MAX,
  }
}

/** controller 결정에서 읽는 칸 — 🔴 읽기만 한다. 의미를 바꾸거나 다시 쓰지 않는다 */
export type ControllerDecisionView = { kstDate: string; state: string; releaseDailyTarget: number } | null

export type DailyOperatingPlan = {
  version: typeof OPS_SHADOW_VERSION
  kstDate: string
  /** `proof` = 정확히 N 을 증명하려는 날 · `ordinary` = 0..cap · `unknown` = controller 의도를 못 읽음 */
  dayKind: 'proof' | 'ordinary' | 'unknown'
  /** 🔴 하루 공개 상한 — **봉투에서만** 온다. controller 목표가 상한이 되지 않는다 */
  publishCap: number
  exactN: number | null
  /** controller 결정 — 🔴 관측된 증명 의도 · 이력일 뿐이다. 이 계획의 권위가 아니다 */
  controllerIntent: { state: string; target: number } | null
  /** 의도가 봉투 상한을 넘었는가 — 넘으면 증명 N 을 싣지 않는다(상한이 이긴다) */
  intentExceedsCap: boolean
  authority: 'none'
}

export function dailyOperatingPlanOf(
  env: OperatingEnvelope, kstDate: string, decision: ControllerDecisionView,
): DailyOperatingPlan {
  const base = { version: OPS_SHADOW_VERSION, kstDate, publishCap: env.publishHardCapPerDay, authority: 'none' as const }
  if (decision === null || decision.kstDate !== kstDate || !posInt(decision.releaseDailyTarget)) {
    return { ...base, dayKind: 'unknown', exactN: null, controllerIntent: null, intentExceedsCap: false }
  }
  const intent = { state: decision.state, target: decision.releaseDailyTarget }
  const over = intent.target > env.publishHardCapPerDay
  const proof = PROOF_STATES.includes(decision.state)
  return {
    ...base,
    dayKind: proof ? 'proof' : 'ordinary',
    exactN: proof && !over ? intent.target : null,
    controllerIntent: intent,
    intentExceedsCap: over,
  }
}

// ─────────────────────────────────────────────────────────
// S2 — 부족분 계획 (관측 전용)
// ─────────────────────────────────────────────────────────

export type DeficitObservation = {
  /** 관측 시각(ISO) */
  at: string
  kstDate: string
  /** 운영 러너와 같은 판독(`snapshot().jit`) — 못 읽으면 null */
  jit: { slots: number; readyFilled: number } | null
  /** 적재됐지만 도장을 기다리는 자동 적격 행(곧 READY) — 못 읽으면 null */
  inFlightExpectedReady: number | null
  /** 결말 수율 상한(`snapshot().sourceYield.high`) — 모르면 null */
  sourceYieldHigh: number | null
  /** 지금 배정 가능한 화자 수(화자 여력 파일 · `remainingCapacity`) — 모르면 null(가상 지출 0) · 가상 묶음을 이 수로 자른다 */
  attemptableSpeakers: number | null
  /** 🔴 선택 권위가 slot-valid 로 판정했고 아직 쓰지 않은 원천 수(`freshCapacityFromTrace`) — 모르면 null */
  freshSourceCandidates: number | null
  /**
   * 🔴 장부 정본 — 공급 호출부(`supply-llm-call`)와 **같은 판독**이다: 오늘 집계 · 정산 보류 표식 · 끝을 기록하지 못한 예약.
   *    하나라도 못 읽으면 `ok: false`(지출 판정이 보류한다). 회차 유료 수는 받지 않는다 — 가상 묶음은 언제나 **새 단계
   *    장부 회차**라 그 값은 정의상 0 이다(`spendOf`). 보류 사유 · 예약 원문은 메모리에서 판정에만 쓰고 기록하지 않는다
   *    (`sanitizeObservation`).
   */
  ledger: {
    ok: boolean; limits: BudgetLimits; tally: DayTally
    settleHold: string | null; unresolved: readonly ReservationVerdict[]
  }
  /** 최근 장부의 유료 원천 1건당 정산 평균 — 모르면 null(가상 지출 0) */
  costPerPaidSourceUsd: number | null
  /** 지금까지 도래한 공개 슬롯 수 · 하루 공개 슬롯 수 */
  slotsDueSoFar: number
  /**
   * 🔴 공급 회차가 지금 돌고 있는가 — 돌고 있으면 lease 때문에 새 회차가 시작되지 않는다(가상 묶음 0).
   *    모르면 null(fail-closed).
   */
  supplyRunInProgress: boolean | null
}

export type DeficitPlan = {
  /** 🔴 운영 권위가 낸 수요 판정 그대로 */
  demand: SupplyPolicy
  /** 진행 중 작업을 뺀 부족분 */
  deficitAfterInFlight: number
  /** 🔴 운영 권위가 낸 유료 원천 수 그대로(묶음 천장 · 수율 근거) */
  paid: ReturnType<typeof paidSourcesFor>
  /** 이번 사이클이 **가상으로** 보낼 원천 수(작은 묶음 · 속도 · 예산 · 신선 원천으로 자른 뒤) */
  wouldRunSources: number
  wouldSpendUsd: number
  paceCeilingUsd: number | null
  /** 지출 권위의 마지막 판정 — 🔴 코드 · 금액만(사유 문장에는 예약 id · 경로가 들어갈 수 있어 싣지 않는다) */
  spendVerdict: { ok: boolean; code: string | null; remainingUsd: number | null } | null
  /** 🔴 가상 묶음이 쓸 요청 수 — `judgeStageBudget` 의 단계 상한 그대로 */
  requests: { judge: number; draft: number; total: number } | null
  limitedBy: string[]
  action: 'none' | 'supplyBatch'
  /** 🔴 shadow 는 실행하지 않는다 — 항상 false */
  executed: false
}

/**
 * 🔴 **속도 상한 천장** — `하루 예산 × min(1, (도래 슬롯 + lead) ÷ 하루 슬롯) × (1 + 여유)` 를 하루 예산으로 자른다.
 *    하루 예산을 모르면 null(가상 지출 0 — fail-closed).
 */
export function paceCeilingUsdOf(env: OperatingEnvelope, slotsDueSoFar: number): number | null {
  if (env.supplyDailyUsd === null) return null
  const due = Number.isInteger(slotsDueSoFar) && slotsDueSoFar >= 0 ? slotsDueSoFar : 0
  const frac = Math.min(1, (due + env.paceLeadSlots) / env.publishSlotsPerDay)
  return Math.min(env.supplyDailyUsd, env.supplyDailyUsd * frac * (1 + env.paceBufferRatio))
}

const verdictView = (v: GateVerdict): NonNullable<DeficitPlan['spendVerdict']> =>
  v.ok ? { ok: true, code: null, remainingUsd: v.remainingUsd } : { ok: false, code: v.code, remainingUsd: null }

/**
 * 🔴 지출 판정 — 가상 회차는 **새 단계 장부 회차**다(유료 0건에서 시작 · `runPaid` 0 은 정의다). 회차 요청 상한은 공급 러너가 그 단계에 주는
 *    `judgeStageBudget(n).perStage.judge` 이고, 묶음 금액 전체를 한 번에 예약해 본다(요청별 순차 예약의 합과 같은 판정 —
 *    여력은 줄기만 한다). 오늘 집계 · 정산 보류 · 미해결 예약은 장부 정본 판독 그대로다.
 */
const spendOf = (
  obs: DeficitObservation, usd: number, ceiling: number | null, judgeRunCap: number,
): GateVerdict =>
  judgeSpend({
    limits: { ...obs.ledger.limits, runRequestCap: judgeRunCap },
    tally: obs.ledger.tally,
    runPaid: 0,
    reserve: { known: true, usd, pricingVersion: OPS_SHADOW_VERSION },
    ledgerOk: obs.ledger.ok,
    settleHold: obs.ledger.settleHold,
    unresolved: obs.ledger.unresolved,
    protect: ceiling === null ? null : { reservedForOthersUsd: 0, ceilingUsd: ceiling, reason: `shadow 속도 상한 $${ceiling.toFixed(6)}` },
  })

export function planDeficit(env: OperatingEnvelope, obs: DeficitObservation): DeficitPlan {
  const limitedBy: string[] = []
  const demand = judgeJitDemand(obs.jit)
  let deficit = demand.upTo
  if (obs.inFlightExpectedReady === null) limitedBy.push('inFlightUnknown')
  else deficit = Math.max(0, deficit - Math.max(0, Math.floor(obs.inFlightExpectedReady)))
  const paid = paidSourcesFor({ deficit, yieldHigh: obs.sourceYieldHigh, cap: env.worksetCapPerRun })
  const ceiling = paceCeilingUsdOf(env, obs.slotsDueSoFar)
  const none = (why: string): DeficitPlan => ({
    demand, deficitAfterInFlight: deficit, paid, wouldRunSources: 0, wouldSpendUsd: 0, paceCeilingUsd: ceiling,
    spendVerdict: null, requests: null, limitedBy: [...limitedBy, why], action: 'none', executed: false,
  })
  if (!demand.llm || paid.sources === 0) return none('noDemand')
  if (obs.supplyRunInProgress === null) return none('runStateUnknown')
  if (obs.supplyRunInProgress) return none('supplyRunInProgress')
  let n = Math.min(paid.sources, env.batchMaxSources)
  if (n < paid.sources) limitedBy.push('batchMax')
  if (obs.freshSourceCandidates === null) return none('freshSourcesUnknown')
  if (obs.freshSourceCandidates < n) { n = Math.max(0, obs.freshSourceCandidates); limitedBy.push('freshSources') }
  if (n === 0) return none('noFreshSources')
  // 🔴 Persona-at-slot — 배정할 화자가 없으면 만들지 않는다(fail-closed). 화자 수보다 큰 묶음을 보내지 않는다
  if (obs.attemptableSpeakers === null) return none('speakersUnknown')
  if (obs.attemptableSpeakers < n) { n = Math.max(0, obs.attemptableSpeakers); limitedBy.push('speakers') }
  if (n === 0) return none('noSpeakers')
  if (obs.costPerPaidSourceUsd === null || !(obs.costPerPaidSourceUsd > 0)) return none('costUnknown')
  if (ceiling === null) return none('budgetUnknown')
  // 🔴 요청 상한 · 지출 권위가 허락하는 가장 큰 묶음 — 속도 상한은 지출 권위의 입력으로만 들어간다
  const unit = obs.costPerPaidSourceUsd
  const judgeAt = (k: number): { verdict: GateVerdict; budget: ReturnType<typeof judgeStageBudget> } => {
    const budget = judgeStageBudget(k)
    if (!budget.ok) return { verdict: { ok: false, code: 'RUN_CAP', reason: budget.reason }, budget }
    return { verdict: spendOf(obs, k * unit, ceiling, budget.perStage.judge), budget }
  }
  let cur = judgeAt(n)
  while (!cur.verdict.ok && n > 1) {
    n -= 1
    cur = judgeAt(n)
  }
  if (!cur.verdict.ok || !cur.budget.ok) return { ...none(cur.verdict.ok ? 'noBudget' : cur.verdict.code), spendVerdict: verdictView(cur.verdict) }
  const verdict = verdictView(cur.verdict)
  const requests = { judge: cur.budget.perStage.judge, draft: cur.budget.perStage.draft, total: n * WORKSET_TOTAL_PER_SOURCE }
  if (n < Math.min(paid.sources, env.batchMaxSources, obs.freshSourceCandidates, obs.attemptableSpeakers)) limitedBy.push('spendOrPace')
  return {
    demand, deficitAfterInFlight: deficit, paid, wouldRunSources: n,
    wouldSpendUsd: n * unit, paceCeilingUsd: ceiling, spendVerdict: verdict, requests,
    limitedBy, action: 'supplyBatch', executed: false,
  }
}

/** 🔴 기록 · 해시용 관측 — 보류 사유 · 예약 원문(id · 세션 · pid · 경로 · 사유) 없이 개수 · 코드 · 불리언만 */
export type SanitizedObservation = Omit<DeficitObservation, 'ledger'> & {
  ledger: {
    ok: boolean; limits: BudgetLimits; tally: DayTally
    settleHold: boolean; unresolved: { count: number; codes: string[] }
  }
}

export function sanitizeObservation(o: DeficitObservation): SanitizedObservation {
  return {
    ...o,
    ledger: {
      ok: o.ledger.ok, limits: o.ledger.limits, tally: o.ledger.tally,
      settleHold: o.ledger.settleHold !== null,
      unresolved: { count: o.ledger.unresolved.length, codes: [...new Set(o.ledger.unresolved.map((u) => u.code))].sort() },
    },
  }
}

/**
 * 🔴 **신선 원천 용량 — 선택 권위의 슬롯별 판정을 그대로 센다** (2026-11-11 3차 검토).
 *    정본 판독기(`readSupplySelectionTrace` · v2)가 통과시킨 트레이스에서, 이번 회차 상한 때문에 남은(`CAP_REACHED`)
 *    미선택 후보 중 **관측 시각보다 뒤인 트레이스 슬롯** 하나 이상에서 권위가 eligible 로 판정한(`slotAgesH[i] !== null`)
 *    것만 센다. 이미 지나간 슬롯에서만 유효했던 후보는 세지 않는다. 나이 · 신선도는 다시 판정하지 않는다.
 *    판독 실패(슬롯 길이 불일치 포함 — 정본 판독기가 거부한다) · v1 · 오래됨(`SHADOW_TRACE_MAX_AGE_MS`) · 미래 시각이면 모른다(null).
 */
export function freshCapacityFromTrace(raw: unknown, now: Date): number | null {
  const read = readSupplySelectionTrace(raw)
  if (!read.ok || read.version !== 'v2') return null
  const t = read.trace
  const taken = Date.parse(t.takenAt)
  if (Number.isNaN(taken) || now.getTime() - taken > SHADOW_TRACE_MAX_AGE_MS || taken > now.getTime()) return null
  const slotMs = t.slots.map((s) => Date.parse(s))
  if (slotMs.some((m) => Number.isNaN(m))) return null
  const remaining: TraceReason = 'CAP_REACHED'
  let n = 0
  for (const c of t.candidates) {
    if (c.selected || c.reason !== remaining || c.slotAgesH === null) continue
    if (c.slotAgesH.some((age, i) => age !== null && slotMs[i]! > now.getTime())) n += 1
  }
  return n
}

/** 장부 회차 하나(`<runId>-j` · `<runId>-d`)의 정산 증거 */
export type LedgerRunEvidence = { settledUsd: number; settled: number; unsettled: number; blocked: number }

/**
 * 🔴 **유료 원천 1건당 정산 평균 — 표본이 완전할 때만** (2026-11-11 4차 검토).
 *    표본 = 장부 날짜가 `days` 에 든 유료 회차(`paidSources > 0`). 하나라도 아래면 **null**(가상 지출 0 · fail-closed):
 *      · 그 날 장부를 읽지 못했다(깨짐)
 *      · 그 회차의 judge(`-j`) · draft(`-d`) 장부 회차 중 **하나라도** 정산 · 차단 기록이 없다(파일 없음 · 부분 유실 ·
 *        요청 0건 — 회차 기록은 단계별 요청 수를 남기지 않아 "정당한 0건" 을 증명할 수 없다)
 *      · 그 회차에 미정산(예약 · 사용량 미상) 요청이 있다
 *    모든 요청이 차단된 회차는 쓴 돈이 0 인 것이 사실이라 표본에서만 뺀다.
 */
export function costPerPaidSourceOf(
  runs: readonly { runId: string; paidSources: number | null; ledgerDate: string }[],
  days: ReadonlyMap<string, boolean>,
  byLedgerRun: ReadonlyMap<string, LedgerRunEvidence>,
): number | null {
  let usd = 0
  let sources = 0
  for (const r of runs) {
    if (!days.has(r.ledgerDate) || r.paidSources === null || !(r.paidSources > 0)) continue
    if (days.get(r.ledgerDate) !== true) return null
    const judge = byLedgerRun.get(`${r.runId}-j`)
    const draft = byLedgerRun.get(`${r.runId}-d`)
    // 🔴 두 단계 증거가 모두 있어야 한다 — 한쪽만 있으면 그쪽 비용만 세어 단가가 낮게 나온다
    if (judge === undefined || judge.settled + judge.blocked === 0) return null
    if (draft === undefined || draft.settled + draft.blocked === 0) return null
    const ev = [judge, draft]
    if (ev.some((e) => e.unsettled > 0)) return null
    // 모든 요청이 차단된 회차는 쓴 돈이 0 인 것이 사실이다 — 표본에서만 뺀다
    if (ev.every((e) => e.settled === 0)) continue
    usd += ev.reduce((n, e) => n + e.settledUsd, 0)
    sources += r.paidSources
  }
  return sources > 0 ? usd / sources : null
}

// ─────────────────────────────────────────────────────────
// writer 트리거 — 마지막 자연 공급 회차의 완료
// ─────────────────────────────────────────────────────────

export type SupplyRunView = {
  runId: string
  /** 회차 시작(ISO) */
  startedAt: string
  status: string
  completedAt: string | null
  /**
   * 🔴 **자연 예약 회차 증거 시각** — 정본 `naturalScheduledRunEvidenceAt`(supply-run-token)이 완전한 tag
   *    (trigger · launchTrigger 모두 `scheduled` · 흡수 규칙)에서만 낸 값. manual · recovery · event · 손상 tag 는 null.
   *    follow-up pass 는 원래 marker 시각이다 — 슬롯 귀속은 이 시각으로 한다. 판독은 IO 가 하고 여기서 다시 하지 않는다.
   */
  naturalAt: string | null
}

const KST_MS = 9 * 3_600_000
const kstMinuteOfIso = (iso: string): number | null => {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const d = new Date(t + KST_MS)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}
const kstDateOfIso = (iso: string): string | null => {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : new Date(t + KST_MS).toISOString().slice(0, 10)
}

/**
 * 회차 id(UTC `YYYYMMDD-HHMMSS`) → 시작 시각 — 모양이 다르거나 **달력에 없는 값**(13월 · 32일 · 24시 등)이면 null.
 *    `Date.UTC` 는 넘친 값을 다음 달로 굴리므로, 되돌린 연·월·일·시·분·초가 입력과 정확히 같을 때만 받는다.
 */
export function runIdStartMs(runId: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(runId)
  if (m === null) return null
  const [y, mo, d, h, mi, s] = [+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, +m[6]!]
  const t = Date.UTC(y, mo - 1, d, h, mi, s)
  if (Number.isNaN(t)) return null
  const back = new Date(t)
  const same = back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d
    && back.getUTCHours() === h && back.getUTCMinutes() === mi && back.getUTCSeconds() === s
  return same ? t : null
}

const strictIsoMs = (v: string | null): number | null => {
  if (v === null) return null
  const t = Date.parse(v)
  return Number.isNaN(t) || new Date(t).toISOString() !== v ? null : t
}

/**
 * 🔴 **하루 계획 writer 를 깨울 때인가** — 그날 마지막 자연 공급 회차(정본 슬롯 마지막 칸)가 `scheduled` 로 시작해
 *    **관측 시각 전에** `done` 으로 끝났을 때만이다. 시계(22:30 등)로 깨우지 않는다. 관측 창은 기록용이다.
 *    🔴 fail-closed (2026-11-11 5차 검토):
 *       · 마지막 슬롯 창의 자연 회차가 하나라도 끝나지 않았거나
 *       · 시작 · 완료 시각이 깨졌거나 관측 시각보다 미래이거나 완료가 시작보다 이르거나
 *       · 회차 기록 파일이 깨져 그 회차가 마지막 슬롯 창(또는 알 수 없는 시각)에 있을 수 있으면 → due 아님
 */
export function writerDueOf(kstDate: string, now: Date, runs: readonly SupplyRunView[], malformedRunIds: readonly string[] = []): {
  due: boolean; lastNaturalSlotMinute: number; runId: string | null; reason: string; expectedWindowKst: string
  /** due 일 때 고른 회차의 완료 시각 — dayClose 열쇠(`naturalRunKeyOf`)의 재료 */
  completedAt: string | null
  /** 마지막 슬롯 창에 든 회차(자연 예약 · 그 밖) — 결정적 순서 */
  slotRuns: { runId: string; natural: boolean; status: string }[]
} {
  const last = Math.max(...SUPPLY_RUN_SLOTS_KST.map((s) => s.hour * 60 + s.minute))
  const nowMs = now.getTime()
  const inLastSlot = (startMs: number): boolean => {
    const iso = new Date(startMs).toISOString()
    if (kstDateOfIso(iso) !== kstDate) return false
    const m = kstMinuteOfIso(iso)
    return m !== null && supplyRunSlotMinuteOf(m) === last
  }
  // 🔴 슬롯 귀속 시각 — 자연 회차는 정본 증거 시각(follow-up 이면 원래 marker), 그 밖은 시작 시각
  const slotAt = (r: SupplyRunView): number => Date.parse(r.naturalAt ?? r.startedAt)
  // 🔴 결정적 순서 — 귀속 시각 → runId. 입력 순서가 결과를 바꾸지 않는다
  const inSlot = runs.filter((r) => {
    const t = slotAt(r)
    return !Number.isNaN(t) && inLastSlot(t)
  }).sort((x, y) => (slotAt(x) - slotAt(y)) || (x.runId < y.runId ? -1 : x.runId > y.runId ? 1 : 0))
  const natural = inSlot.filter((r) => r.naturalAt !== null)
  const base = {
    lastNaturalSlotMinute: last, expectedWindowKst: SHADOW_WRITER_EXPECTED_WINDOW_KST, completedAt: null,
    slotRuns: inSlot.map((r) => ({ runId: r.runId, natural: r.naturalAt !== null, status: r.status })),
  }
  const blockedBy = malformedRunIds.find((id) => {
    const t = runIdStartMs(id)
    return t === null || inLastSlot(t)
  })
  if (blockedBy !== undefined) return { ...base, due: false, runId: null, reason: '마지막 슬롯 창에 있을 수 있는 회차 기록이 깨졌다' }
  if (natural.length === 0) {
    return { ...base, due: false, runId: null, reason: inSlot.length > 0 ? '마지막 슬롯 창의 회차가 자연 예약이 아니다' : '마지막 자연 공급 회차가 아직 없다' }
  }
  for (const r of natural) {
    const start = strictIsoMs(r.startedAt)
    if (start === null) return { ...base, due: false, runId: r.runId, reason: '회차 시작 시각이 깨졌다' }
    if (r.status !== 'done' || r.completedAt === null) return { ...base, due: false, runId: r.runId, reason: '마지막 자연 공급 회차가 끝나지 않았다' }
    const end = strictIsoMs(r.completedAt)
    // 🔴 미래에 시작한 회차는 여기서 막힌다 — 완료는 시작 이후여야 하므로(end ≥ start) 시작이 미래면 완료도 미래다
    if (end === null || end < start || end > nowMs) return { ...base, due: false, runId: r.runId, reason: '회차 완료 시각이 깨졌거나 시작보다 이르거나 관측 시각보다 미래다' }
  }
  const done = [...natural].sort((x, y) => (Date.parse(x.completedAt!) - Date.parse(y.completedAt!)) || (x.runId < y.runId ? -1 : 1))
  const pick = done[done.length - 1]!
  return {
    ...base, due: true, runId: pick.runId, completedAt: pick.completedAt,
    reason: natural.length > 1 ? `마지막 슬롯 자연 회차 ${natural.length}개 모두 완료 — 가장 늦게 끝난 회차` : '마지막 자연 공급 회차 완료',
  }
}

// ─────────────────────────────────────────────────────────
// S1 — 하루 결과 (측정만 · 판정은 controller)
// ─────────────────────────────────────────────────────────

export type OutcomePostView = {
  decider: string
  unattended: boolean
  personaComments: readonly unknown[]
}

export type DailyOutcome = {
  version: typeof OPS_SHADOW_VERSION
  kstDate: string
  publishedAuto: number | null
  /** 🔴 봉투 상한 — 계획·controller 의도가 아니라 봉투에서 바로 읽는다 */
  publishHardCap: number
  overCap: boolean | null
  exactNMet: boolean | null
  maxPersonaCommentsPerPost: number | null
  conversationCapRespected: boolean | null
  supplySpentUsd: number | null
  supplyBudgetUsd: number | null
  spendWithinBudget: boolean | null
  /** 🔴 Dn 판정은 controller 의 다음 날 증거 판정이다 — shadow 는 판정하지 않는다 */
  authorityVerdict: null
}

export function dailyOutcomeOf(
  env: OperatingEnvelope, plan: DailyOperatingPlan,
  facts: { posts: readonly OutcomePostView[]; tally: DayTally | null } | null,
): DailyOutcome {
  const posts = facts?.posts ?? null
  const auto = posts === null ? null : posts.filter((p) => p.decider === 'auto' && p.unattended).length
  const maxC = posts === null ? null : posts.reduce((m, p) => Math.max(m, p.personaComments.length), 0)
  const spent = facts?.tally === null || facts?.tally === undefined ? null : facts.tally.settledUsd + facts.tally.openReservedUsd
  return {
    version: OPS_SHADOW_VERSION, kstDate: plan.kstDate,
    publishedAuto: auto, publishHardCap: env.publishHardCapPerDay,
    overCap: auto === null ? null : auto > env.publishHardCapPerDay,
    exactNMet: auto === null || plan.exactN === null ? null : auto === plan.exactN,
    maxPersonaCommentsPerPost: maxC,
    conversationCapRespected: maxC === null ? null : maxC <= env.conversationHardCapPerPost,
    supplySpentUsd: spent, supplyBudgetUsd: env.supplyDailyUsd,
    spendWithinBudget: spent === null || env.supplyDailyUsd === null ? null : spent <= env.supplyDailyUsd + 1e-9,
    authorityVerdict: null,
  }
}

// ─────────────────────────────────────────────────────────
// 기록 열쇠 — 같은 입력이면 같은 사이클
// ─────────────────────────────────────────────────────────

/** 🔴 키 순서와 무관한 정규 JSON — 같은 관측이면 같은 해시 */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`
}

export function inputHashOf(input: unknown): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex')
}

export type ShadowRecordKind = 'cycle' | 'dayClose'

/**
 * 🔴 **자연 회차 열쇠** — `runId` 와 `completedAt` 만으로 정해지는 결정적 해시(개인정보 0). heartbeat 시각은 들어가지 않는다 —
 *    같은 회차를 1,440번 · 동시에 · 재부팅 뒤에 다시 봐도 같은 열쇠다.
 */
export function naturalRunKeyOf(runId: string, completedAt: string): string {
  return inputHashOf({ kind: 'naturalRun', runId, completedAt })
}

/**
 * 🔴 **이 기록이 무엇에 대한 관측인가.**
 *    · `manual` — 손으로 돌린 한 사이클(관측 시각 = 실행 시각 · 시험은 과거 주입)
 *    · `naturalRun` — 자연 예약 공급 회차 하나의 완료 뒤 관측(observer). `completedAt` 은 **출처(provenance)일 뿐**이고
 *      기록의 관측 시각(`at`)은 언제나 observer 가 실제로 본 시각이다.
 *      `causal` — 완료 뒤 짧은 지연 안에 본 회차. 지금 상태를 snapshot 하고, 그날 마지막 자연 회차면 하루를 닫는다.
 *      `backfill` — 늦게 본 회차. 🔴 **최소 marker 한 줄만** 적는다 — 결정 · 장부 · DB 를 읽지 않고
 *      봉투 · 계획 · 관측 · 부족분 · 결과 · writer · dayClose 가 전부 없다(지금 상태를 그 시각처럼 적지 않는다).
 *      🔴 `status: done` 은 완료 관측일 뿐 공급 최종 exit 0 이 아니다 — `integrity: 'unknown'` 으로 적는다.
 */
export type NaturalRunSource<M extends 'causal' | 'backfill'> =
  { kind: 'naturalRun'; runId: string; completedAt: string; key: string; mode: M; integrity: 'unknown' }
export type ShadowSource = { kind: 'manual' } | NaturalRunSource<'causal'> | NaturalRunSource<'backfill'>

export function cycleIdOf(kind: ShadowRecordKind, kstDate: string, inputHash: string): string {
  return `${kstDate}:${kind}:${inputHash.slice(0, 16)}`
}

type ShadowRecordBase = {
  v: typeof OPS_SHADOW_VERSION
  cycleId: string
  kind: ShadowRecordKind
  kstDate: string
  /** 🔴 실제 관측 시각 — 손 실행은 실행 시각(시험은 과거 주입) · observer 는 그 tick 의 시각. 회차 완료 시각이 아니다 */
  at: string
  inputHash: string
  runtimeSha: string | null
  /** 관측 시각의 출처 — 실제 시계(`real`) · 시험 · 재생(`injected` · 과거만 허용) */
  clock: 'real' | 'injected'
  authority: 'none'
}
/** 지금 상태를 관측한 기록 — 손 실행 · causal observer */
export type ShadowObservedRecord = ShadowRecordBase & {
  source: { kind: 'manual' } | NaturalRunSource<'causal'>
  envelope: OperatingEnvelope
  plan: DailyOperatingPlan
  observation: SanitizedObservation | null
  deficit: DeficitPlan | null
  outcome: DailyOutcome | null
  writer: ReturnType<typeof writerDueOf> | null
}
/** 🔴 backfill marker — "이 회차를 늦게 보았다" 한 줄. 지금 상태에서 온 칸이 하나도 없다 */
export type ShadowBackfillMarker = ShadowRecordBase & {
  kind: 'cycle'
  source: NaturalRunSource<'backfill'>
  envelope: null
  plan: null
  observation: null
  deficit: null
  outcome: null
  writer: null
}
export type ShadowRecord = ShadowObservedRecord | ShadowBackfillMarker
