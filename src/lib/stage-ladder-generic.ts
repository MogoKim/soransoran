/**
 * 🔴 **D1 → D100 단계 부품 — 운영 사다리가 부른다** (2026-09-29 · 2026-09-30 source-slot-v1)
 *
 * 🔴 **무엇을 하나.** 운영 사다리(`stage-ladder.planStageDecision`)에 들어가는 계산만 준다. 상태 기계는 하나다.
 *      · 슬롯 파생(`deriveSlots`) — 운영 창 안 · heartbeat 격자 위 · 60분 안 댓글 회차 3번 이상
 *      · 다음 단계 preflight(`judgeNextPreflight`) — **D3 부터 D100 까지 같은 한 함수** (숫자는 기존 profile)
 *      · 시험 관문(`trialBlocks`) — preflight PASS + 첫 슬롯 전(LATE_START 아님)
 *
 * 🔴 **이 파일이 대신한 옛 정본 (실행 경로에서 지웠다 · 2026-09-30)**
 *      · `resolveCeiling`(env `SORAN_CAPACITY_STAGE` 사람 천장) — 천장은 이제 비용 preflight 가 정한다
 *      · `needsExtendedGate` · `extendedTrialBlocks` — D3~D10 은 하루 시뮬레이션, D20+ 만 preflight 로 가르던 두 벌 관문
 *      · `STOCK_SHORT` = "다음 단계 하루치 **완성 글**이 미리 있어야 연다" — 완성 글 재고 게이트
 *      · Persona 를 **활성 행 수**로 보던 입력(정본: active rows are not capacity)
 *
 * 🔴 **전이 규칙** — 날짜로 기다리지 않는다 · 사람이 env 를 고치지 않는다.
 *    다음 단계 시험은 지금 단계의 완전한 자동 운영 PASS 뒤, 이 preflight 가 PASS 일 때만 열린다.
 *    FAIL · UNKNOWN 은 **어느 하나라도** 열지 않는다(같은 단계 재증명).
 *
 * 🔴 순수 함수다 — DB · 파일 · env · 시각 조회 0. 러너 격자 · 댓글 예약표 · 비용 · 기회 사실은 호출부가 주입한다.
 */
import {
  RUNTIME_STAGES, MAX_DAILY_TARGET, HIGHEST_RUNTIME_STAGE,
  minuteOfDay, slotLabel, kstMidnight, verifyProfile, isRuntimeStage, profileOf,
  type RuntimeStage, type ScaleProfile, type Slot,
} from './scale-profile'
import { PUBLISH_WINDOW_START_MINUTE, PUBLISH_WINDOW_END_MINUTE } from './publish-slot-catchup'
import { AUTO_FIRST_COMMENT_WINDOW_MINUTES, AUTO_PERSONA_COMMENTS_PER_POST_MAX } from './persona-comment-auto-lane'
import { auditTarget } from './auto-ready-v2'
import { PERSONA_CANARY_FLOOR } from './d100-capacity'
import { SUPPLY_RUNS_PER_DAY, SUPPLY_WORKSET_PER_RUN } from './supply-schedule-contract'
import type { Health } from './ops-status'
import type { StageBlock } from './stage-decision-contract'
import type { EvidenceVerdictKind } from './stage-evidence'

export { HIGHEST_RUNTIME_STAGE, isRuntimeStage }

// ─────────────────────────────────────────────────────────
// 🔴 단계 목록 — 러너 단계(d1~d50) + 표현만 되는 d100
// ─────────────────────────────────────────────────────────

export const GENERIC_STAGES = [...RUNTIME_STAGES, 'd100'] as const
export type GenericStage = (typeof GENERIC_STAGES)[number]

/**
 * 🔴 **D100 의 하루 목표** — 창업자 확정 계획(`d100-capacity` 의 `publicPostsPerDay`)과 같은 값이다.
 *    검사가 `d100Plan(stage).publicPostsPerDay` 와 대조한다. d1~d50 은 러너 프로필(`profileOf`)이 정본이다.
 */
const UNWIRED_DAILY_TARGET: Readonly<Record<Exclude<GenericStage, RuntimeStage>, number>> = { d100: 100 }

export const isGenericStage = (v: unknown): v is GenericStage =>
  typeof v === 'string' && (GENERIC_STAGES as readonly string[]).includes(v)

export function genericRank(s: GenericStage): number {
  return GENERIC_STAGES.indexOf(s)
}

/** 🔴 다음 칸 — d100 위는 없다 */
export function genericNextStage(s: GenericStage): GenericStage | null {
  const i = GENERIC_STAGES.indexOf(s)
  return i < 0 || i + 1 >= GENERIC_STAGES.length ? null : GENERIC_STAGES[i + 1]!
}

export function genericDailyTarget(s: GenericStage): number {
  return isRuntimeStage(s) ? profileOf(s).dailyTarget : UNWIRED_DAILY_TARGET[s]
}

// ─────────────────────────────────────────────────────────
// 🔴 슬롯 — 운영 창 안 · 러너 격자 위 · 댓글 예약표가 덮는 자리에서만 파생한다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **슬롯을 만드는 데 필요한 러너 사실** — 정본은 `scripts/lib` 템플릿이다. 호출부가 주입한다.
 *    · `gridMinutes`      발행 heartbeat 간격(`HEARTBEAT_INTERVAL_MINUTES`)
 *    · `perRunMax`        한 회차 최대 발행(`PER_RUN_MAX`)
 *    · `commentSlots`     댓글 러너 예약표(`COMMENT_RUNNER_SLOTS`)
 *    · `attempts`         60분 안 첫 댓글 시도 횟수(`FIRST_COMMENT_ATTEMPTS`)
 *    · `commentRunRequestCap` 댓글 한 회차 유료 요청 상한(`COMMENT_LOOP_RUN_REQUEST_CAP_DEFAULT`)
 */
export type RunnerGrid = {
  gridMinutes: number
  perRunMax: number
  commentSlots: readonly { hour: number; minute: number }[]
  attempts: number
  commentRunRequestCap: number
}

/** 🔴 발행 분 `m` 뒤 60분 안(초과 없음)에 도는 댓글 회차 수와 첫 대기 */
export function commentCoverageOf(m: number, grid: RunnerGrid): { runs: number; firstWait: number | null } {
  const after = grid.commentSlots.map(minuteOfDay).filter((c) => c > m && c - m <= AUTO_FIRST_COMMENT_WINDOW_MINUTES)
  return { runs: after.length, firstWait: after.length === 0 ? null : Math.min(...after) - m }
}

/**
 * 🔴 **발행해도 되는 분** — 운영 창(08:00~22:00) 안 · 격자 위 · 60분 안 댓글 시도가 `attempts` 번 이상.
 *    이 목록의 길이 × 회차당 건수가 하루 발행 용량이다.
 */
export function validPublishMinutes(grid: RunnerGrid): number[] {
  const out: number[] = []
  if (!Number.isInteger(grid.gridMinutes) || grid.gridMinutes < 1) return out
  const first = Math.ceil(PUBLISH_WINDOW_START_MINUTE / grid.gridMinutes) * grid.gridMinutes
  for (let m = first; m <= PUBLISH_WINDOW_END_MINUTE; m += grid.gridMinutes) {
    if (commentCoverageOf(m, grid).runs >= grid.attempts) out.push(m)
  }
  return out
}

export function publishCapacityOf(grid: RunnerGrid): number {
  return validPublishMinutes(grid).length * Math.max(0, grid.perRunMax)
}

export type SlotDerivation =
  | { ok: true; slots: Slot[] }
  | { ok: false; problems: string[] }

/**
 * 🔴 **n 건을 유효 분 위에 고르게 편다** — 한 분에 한 건(count 1).
 *    `PER_RUN_MAX=1` 이라 한 슬롯이 두 건을 맡으면 그 둘째 건은 다음 틱으로 밀린다 — 그래서 겹치지 않는다.
 *    유효 분이 모자라면 **만들지 않는다**(부족을 늦은 슬롯·창 밖 슬롯으로 메우지 않는다).
 *    🔴 러너 프로필(`RUNTIME_PROFILES`)의 D20·D30·D50 슬롯은 이 함수의 결과를 그대로 적은 것이다 —
 *       검사가 둘을 대조한다.
 */
export function deriveSlots(n: number, grid: RunnerGrid): SlotDerivation {
  if (!Number.isInteger(n) || n < 1 || n > MAX_DAILY_TARGET) return { ok: false, problems: [`목표 ${n} — 1~${MAX_DAILY_TARGET} 정수`] }
  const valid = validPublishMinutes(grid)
  const cap = valid.length * Math.max(0, grid.perRunMax)
  if (n > valid.length || n > cap) {
    return {
      ok: false,
      problems: [`하루 ${n}건인데 유효 발행 분 ${valid.length}개 × 회차당 ${grid.perRunMax}건 = ${cap}건 — `
        + `격자 ${grid.gridMinutes}분 · 첫 댓글 ${grid.attempts}회 시도 계약으로는 담을 수 없다`],
    }
  }
  const idx = Array.from({ length: n }, (_, i) =>
    n === 1 ? 0 : Math.round((i * (valid.length - 1)) / (n - 1)))
  const slots = idx.map((k) => {
    const m = valid[k]!
    return { hour: Math.floor(m / 60), minute: m % 60, count: 1 }
  })
  return { ok: true, slots }
}

export type GenericProfile =
  | { ok: true; stage: GenericStage; profile: ScaleProfile; source: 'runtime' | 'derived' }
  | { ok: false; stage: GenericStage; problems: string[] }

/**
 * 🔴 **단계 프로필.** d1~d50 은 러너 프로필(`profileOf`)을 **그대로** 돌려주되, 러너 격자 계약으로 다시 본다.
 *    d100 은 목표·슬롯을 파생한다 — 슬롯이 담기지 않으면 프로필이 없다.
 */
export function genericProfileOf(stage: GenericStage, grid: RunnerGrid): GenericProfile {
  if (isRuntimeStage(stage)) {
    const profile = profileOf(stage)
    const problems = verifyGenericProfile(profile, grid)
    return problems.length > 0 ? { ok: false, stage, problems } : { ok: true, stage, profile, source: 'runtime' }
  }
  const n = genericDailyTarget(stage)
  const d = deriveSlots(n, grid)
  if (!d.ok) return { ok: false, stage, problems: d.problems }
  const top = profileOf(HIGHEST_RUNTIME_STAGE)
  const profile: ScaleProfile = { dailyTarget: n, postsPerWeek: top.postsPerWeek, minDaysBetween: top.minDaysBetween, slots: d.slots }
  const problems = verifyGenericProfile(profile, grid)
  return problems.length > 0 ? { ok: false, stage, problems } : { ok: true, stage, profile, source: 'derived' }
}

/**
 * 🔴 **프로필 계약** — 운영 `verifyProfile` + 슬롯 셋(창 안 · 격자 위 · 첫 댓글 시도).
 *    운영 d1~d10 도 같은 함수로 본다(검사가 기준선으로 쓴다).
 */
export function verifyGenericProfile(p: ScaleProfile, grid: RunnerGrid): string[] {
  const out = [...verifyProfile(p)]
  for (const s of p.slots) {
    const m = minuteOfDay(s)
    if (m < PUBLISH_WINDOW_START_MINUTE || m > PUBLISH_WINDOW_END_MINUTE) out.push(`슬롯 ${slotLabel(s)} 가 운영 창 밖이다`)
    if (m % grid.gridMinutes !== 0) out.push(`슬롯 ${slotLabel(s)} 가 ${grid.gridMinutes}분 격자 위가 아니다 — heartbeat 가 늦게 낸다`)
    const c = commentCoverageOf(m, grid)
    if (c.runs < grid.attempts) out.push(`슬롯 ${slotLabel(s)} 뒤 60분 안 댓글 시도 ${c.runs}회 < ${grid.attempts}회`)
    if (s.count > grid.perRunMax) out.push(`슬롯 ${slotLabel(s)} count ${s.count} > 회차당 ${grid.perRunMax}건`)
  }
  return out
}

// ─────────────────────────────────────────────────────────
// 🔴 다음 단계 preflight — 시험을 열어도 되는가 (D3 ~ D100 한 함수)
// ─────────────────────────────────────────────────────────

export const PREFLIGHT_CODES = [
  'SLOTS_INFEASIBLE', 'PUBLISH_CAPACITY_SHORT',
  'OPPORTUNITY_SHORT', 'OPPORTUNITY_UNKNOWN',
  'THROUGHPUT_SHORT', 'THROUGHPUT_UNKNOWN', 'READY_REQUIREMENT_UNKNOWN',
  'LATENCY_UNKNOWN',
  'PERSONA_SHORT', 'PERSONA_UNKNOWN',
  'COMMENT_COST_SHORT', 'COMMENT_COST_UNKNOWN', 'COMMENT_RUNNER_SHORT',
  'AUDIT_COST_SHORT', 'AUDIT_COST_UNKNOWN',
  'SUPPLY_COST_SHORT', 'SUPPLY_COST_UNKNOWN',
  'RUNNER_BAD', 'RUNNER_UNKNOWN',
] as const
export type PreflightCode = (typeof PREFLIGHT_CODES)[number]
const PREFLIGHT_UNKNOWN: readonly PreflightCode[] = [
  'OPPORTUNITY_UNKNOWN', 'THROUGHPUT_UNKNOWN', 'READY_REQUIREMENT_UNKNOWN', 'LATENCY_UNKNOWN', 'PERSONA_UNKNOWN',
  'COMMENT_COST_UNKNOWN', 'AUDIT_COST_UNKNOWN', 'SUPPLY_COST_UNKNOWN', 'RUNNER_UNKNOWN',
]

/**
 * 🔴 **preflight 사실** — 모르면 `null`. 모르는 것은 초록이 아니다(하나라도 모르면 열지 않는다).
 */
export type PreflightFacts = {
  /**
   * 🔴 **다음 증명일 전체 슬롯 중 slot-valid 기회로 덮이는 슬롯 수** — 정본 `judgeSlotRelease` 가 **그 슬롯 시각에**
   *    eligible 로 본 READY 와, 아직 초안이 없는 원천 기회(측정 수율로 할인)를 슬롯에 짝지은 수.
   *    완성 글 며칠치가 아니다 — 그 하루의 슬롯을 그 슬롯 시점 가치로 채울 수 있는가다.
   */
  slotValidOpportunities: number | null
  /**
   * 🔴 **자동 READY cohort** — 생산능력 · 손실 · 공급 비용이 **같은 행 묶음 · 같은 창**에서 나온다. 모르면 `null`.
   *    처리량 · 필요 READY · 비용 단가는 전부 이 한 사실에서 판정이 계산한다(따로 받은 수율 · 단가와 섞지 않는다).
   */
  readyCohort: ReadyCohortFact | null
  /** 🔴 원천 게시 → 공개 지연(시간) p50 · p90 — 지금 계약 도장으로 나간 글만(최근 3일). 관측이 없으면 null */
  latencyP50H: number | null
  latencyP90H: number | null
  /**
   * 🔴 **계약 유효 Persona 수 — Persona 레인이 제공한다(주입 인터페이스).** 활성 행 수로 대체하지 않는다.
   *    Persona 4상태 정본(`readContractValidPersonas`)이 넣는다. 읽기 실패만 `null`(모름).
   *    2026-09-30 운영 실측은 0 — D3 하한 24 가 막아 **D1→D3 시험부터** 열리지 않는다(PERSONA_SHORT).
   */
  contractValidPersonas: number | null
  /** 댓글 1건 정산 단가(USD) — 장부 실측(최근 3일) */
  commentUsdPerRequest: number | null
  /** 댓글 레인 하루 상한(USD) — 정본 최대 $0.20 */
  commentDailyUsdCap: number | null
  /** 감사 1건 정산 단가(USD) — 장부 실측(최근 3일) */
  auditUsdPerCall: number | null
  /** 감사 레인 하루 상한(USD) — 감사 레인 env 판독기(`auditLimitsFromEnv`) 값 */
  auditDailyUsdCap: number | null
  /** 공급 하루 상한(USD) — 정본 최대 $0.50 */
  supplyDailyUsdCap: number | null
  /** 🔴 발행 · 공급 러너 최근 회차(`errorSignalOf`) — 모르면 null */
  runnerHealth: Health | null
}

/**
 * 🔴 **자동 READY cohort 사실** (2026-10-04 · canon §3.1 실측 보충 계약 · P0-1 보정).
 *    같은 창(최근 3일)에서 자동 READY 로 도장된 행 **전부**를 결말로 나눈다 — 원천 · 정산액도 같은 창이다.
 *    · `sources`   창 안 공급 묶음 원천 수
 *    · `published` 공개로 끝난 행 · `lost` 공개되지 못하고 끝난 행(발행 직전 판정 만료 `EXPIRED` · 철회 `DECLINED`)
 *    · `pending`   아직 결말이 없는 행 — 🔴 성공도 손실도 아니다
 *    · `supplyUsd` 같은 창 공급 정산 합계(USD) — 모르면 `null`
 *    🔴 생산능력은 `published + lost + pending`(raw READY) 에서 나오므로, 대기 행은 손실률에서도 같은 무게로 다룬다
 *       (`replenishmentOf` — 전부 성공 / 전부 손실 두 극단).
 *    생성 전 탈락(게이트 · 의미 감사 HOLD)은 READY 가 아니므로 raw 에 이미 없다 — 여기서 다시 세지 않는다.
 */
export type ReadyCohortFact = { sources: number; published: number; lost: number; pending: number; supplyUsd: number | null }

/**
 * 🔴 **필요 READY 구간 = 증명일 목표 슬롯 + 실측 손실 보충** — 처리량 · 공급 비용이 같이 쓰는 **한 계산**.
 *    보충 = `ceil(목표 × 손실 ÷ 공개)`. 대기 행은 결말을 모르므로 두 극단으로 구간을 만든다:
 *      `min` 대기 전부 공개 · `max` 대기 전부 손실. 대기 0 이면 두 값이 같다.
 *    공개 관측이 0 인 극단은 비율을 계산할 수 없어 `null`(모름)이다 — 🔴 "영원히 불능" 이 아니다.
 *    🔴 어떤 경우에도 필요량은 목표 아래로 내려가지 않는다 — `low` 는 항상 확정된 하한이다.
 *    🔴 상세 원천 계획값(`PLANNED_DETAIL_PER_PUBLIC_POST`)은 이 계산에 들어오지 않는다.
 */
export type Replenishment = { target: number; min: number | null; max: number | null; low: number }

const needOf = (target: number, published: number, lost: number): number | null =>
  published <= 0 ? null : target + Math.ceil((target * lost) / published)

export const isCount = (v: number): boolean => Number.isInteger(v) && v >= 0

export function replenishmentOf(target: number, c: ReadyCohortFact | null): Replenishment {
  if (c === null || !isCount(c.published) || !isCount(c.lost) || !isCount(c.pending)) {
    return { target, min: null, max: null, low: target }
  }
  const min = needOf(target, c.published + c.pending, c.lost)
  const max = needOf(target, c.published, c.lost + c.pending)
  return { target, min, max, low: min ?? target }
}

/** 🔴 구간 판정 — 하한도 못 채우면 FAIL · 상한까지 채우면 통과 · 그 사이(또는 상한 모름)는 모름 */
export function judgeAgainst(r: Replenishment, fits: (need: number) => boolean): 'ok' | 'short' | 'unknown' {
  if (!fits(r.low)) return 'short'
  return r.max !== null && fits(r.max) ? 'ok' : 'unknown'
}

export type PreflightVerdict = {
  stage: GenericStage
  verdict: EvidenceVerdictKind
  codes: readonly PreflightCode[]
  counts: Readonly<Record<string, number>>
}

/**
 * 🔴 **다음 단계 preflight — D3~D100 같은 구조.** FAIL 코드가 하나라도 있으면 FAIL · 없고 모름이 있으면 UNKNOWN.
 *    둘 다 시험을 열지 않는다. 숫자는 기존 정본뿐이다:
 *      · 하루 목표 · 슬롯 — 러너 프로필(`profileOf`)
 *      · 필요 READY — `replenishmentOf`(목표 + 실측 손실 보충 구간 · 고정 할증 없음) · Persona canary 하한 `PERSONA_CANARY_FLOOR`
 *      · 공급 용량 — 회차당 묶음(`SUPPLY_WORKSET_PER_RUN`) × 하루 회차(`SUPPLY_RUNS_PER_DAY`)
 *      · 비용 상한 — 호출부가 각 레인 정본 판독기로 읽은 값(공급은 승인 천장 $0.50 으로 누른다)
 *    🔴 지연은 **관측됐는가**만 본다 — 행마다의 나이 상한은 `judgeSlotRelease` 가 이미 지킨다(두 번째 문턱을 만들지 않는다).
 */
export function judgeNextPreflight(stage: GenericStage, facts: PreflightFacts, grid: RunnerGrid): PreflightVerdict {
  const codes = new Set<PreflightCode>()
  const n = genericDailyTarget(stage)
  const counts: Record<string, number> = { target: n }
  const prof = genericProfileOf(stage, grid)
  if (!prof.ok) codes.add('SLOTS_INFEASIBLE')
  const pubCap = publishCapacityOf(grid)
  counts.publishCapacity = pubCap
  if (pubCap < n) codes.add('PUBLISH_CAPACITY_SHORT')
  // 기회 — 증명일 전체 슬롯이 슬롯 시점 가치로 덮이는가
  if (facts.slotValidOpportunities === null) codes.add('OPPORTUNITY_UNKNOWN')
  else { counts.opportunities = facts.slotValidOpportunities; if (facts.slotValidOpportunities < n) codes.add('OPPORTUNITY_SHORT') }
  // 처리량 — 같은 cohort 의 raw READY 수율 × 공급 회차 용량이 필요 READY 구간(목표 + 실측 손실 보충)을 채우는가
  const c = facts.readyCohort
  const req = replenishmentOf(n, c)
  const raw = c === null ? null : c.published + c.lost + c.pending
  if (c !== null) {
    Object.assign(counts, { readyRaw: raw, readyPublished: c.published, readyLost: c.lost, readyPending: c.pending, readySources: c.sources })
  }
  if (req.min !== null) counts.readyNeededMin = req.min
  if (req.max !== null) counts.readyNeededMax = req.max
  if (req.min !== null && req.min === req.max) counts.readyNeeded = req.min
  let requirementUnknown = false
  if (c === null || raw === null || !(c.sources > 0)) codes.add('THROUGHPUT_UNKNOWN')
  else {
    const capacity = Math.floor((raw * SUPPLY_WORKSET_PER_RUN * SUPPLY_RUNS_PER_DAY) / c.sources)
    counts.readyCapacity = capacity
    const t = judgeAgainst(req, (need) => capacity >= need)
    if (t === 'short') codes.add('THROUGHPUT_SHORT')
    if (t === 'unknown') requirementUnknown = true
  }
  // 지연 — 관측됐는가
  if (facts.latencyP50H === null || facts.latencyP90H === null) codes.add('LATENCY_UNKNOWN')
  else { counts.latencyP50H = facts.latencyP50H; counts.latencyP90H = facts.latencyP90H }
  // Persona — 계약 유효 reserve 가 canary 하한 이상인가(행 수로 대체하지 않는다)
  const floor = stage === 'd1' ? 1 : PERSONA_CANARY_FLOOR[stage]
  counts.personaFloor = floor
  if (facts.contractValidPersonas === null) codes.add('PERSONA_UNKNOWN')
  else { counts.personas = facts.contractValidPersonas; if (facts.contractValidPersonas < floor) codes.add('PERSONA_SHORT') }
  // 댓글 — 자동 글마다 첫 댓글 1건(무인 레인 상한) · 하루 비용 상한 · 러너 회차 용량
  const firstComments = n * AUTO_PERSONA_COMMENTS_PER_POST_MAX
  counts.firstComments = firstComments
  if (facts.commentUsdPerRequest === null || !(facts.commentUsdPerRequest > 0) || facts.commentDailyUsdCap === null) {
    codes.add('COMMENT_COST_UNKNOWN')
  } else {
    const affordable = Math.floor(facts.commentDailyUsdCap / facts.commentUsdPerRequest)
    counts.commentAffordable = affordable
    if (affordable < firstComments) codes.add('COMMENT_COST_SHORT')
  }
  const runnerCap = grid.commentSlots.length * grid.commentRunRequestCap
  counts.commentRunnerCapacity = runnerCap
  if (runnerCap < firstComments) codes.add('COMMENT_RUNNER_SHORT')
  // 감사 — 정본 표본 수(20%) × 단가 ≤ 감사 하루 상한
  const audits = auditTarget(n)
  counts.auditExpected = audits
  if (facts.auditUsdPerCall === null || facts.auditDailyUsdCap === null) codes.add('AUDIT_COST_UNKNOWN')
  else if (audits * facts.auditUsdPerCall > facts.auditDailyUsdCap) codes.add('AUDIT_COST_SHORT')
  // 공급 — 처리량과 **같은** 필요 READY 구간 × 같은 cohort 의 raw READY 단가 ≤ 공급 하루 상한(안전장치 · 소비 목표 아님).
  //   raw 단가 × raw 필요량 = 공개 1건 비용 × 목표 — 대기 행이 분모를 키우면 상한 쪽 필요량도 같이 커진다
  const rawUnit = c === null || raw === null || !(raw > 0) || c.supplyUsd === null || !(c.supplyUsd > 0) ? null : c.supplyUsd / raw
  if (rawUnit !== null) {
    counts.rawReadyUsd = rawUnit
    // 🔴 공개 1건 단가는 결말이 전부 났을 때만 — 대기가 있으면 모른다(raw 단가로 대신하지 않는다)
    if (c !== null && c.pending === 0 && c.published > 0 && c.supplyUsd !== null) counts.publicPostUsd = c.supplyUsd / c.published
  }
  if (rawUnit === null || facts.supplyDailyUsdCap === null) codes.add('SUPPLY_COST_UNKNOWN')
  else {
    const cap = facts.supplyDailyUsdCap
    const t = judgeAgainst(req, (need) => need * rawUnit <= cap)
    if (t === 'short') codes.add('SUPPLY_COST_SHORT')
    if (t === 'unknown') { codes.add('SUPPLY_COST_UNKNOWN'); requirementUnknown = true }
  }
  if (requirementUnknown) codes.add('READY_REQUIREMENT_UNKNOWN')
  // 러너 건강
  if (facts.runnerHealth === null || facts.runnerHealth === 'unknown') codes.add('RUNNER_UNKNOWN')
  else if (facts.runnerHealth === 'bad') codes.add('RUNNER_BAD')
  const ordered = PREFLIGHT_CODES.filter((c) => codes.has(c))
  const failing = ordered.filter((c) => !PREFLIGHT_UNKNOWN.includes(c))
  const verdict: EvidenceVerdictKind = failing.length > 0 ? 'FAIL' : ordered.length > 0 ? 'UNKNOWN' : 'PASS'
  return { stage, verdict, codes: ordered, counts }
}

// ─────────────────────────────────────────────────────────
// 🔴 시험 관문 — 운영 사다리가 부른다 (모든 단계)
// ─────────────────────────────────────────────────────────

/** 🔴 그 KST 날짜의 그 프로필 첫 슬롯(UTC Date) */
export function firstSlotOn(kstDate: string, p: ScaleProfile): Date | null {
  const first = [...p.slots].map(minuteOfDay).sort((a, b) => a - b)[0]
  if (first === undefined) return null
  const mid = kstMidnight(new Date(`${kstDate}T12:00:00+09:00`))
  return new Date(mid.getTime() + first * 60_000)
}

/** 🔴 그 KST 날짜의 그 프로필 슬롯 시각 전부(UTC Date · 오름차순) — 증명일 기회 짝짓기 · JIT 수요가 쓴다 */
export function slotTimesOn(kstDate: string, p: ScaleProfile): Date[] {
  const mid = kstMidnight(new Date(`${kstDate}T12:00:00+09:00`))
  const out: Date[] = []
  for (const s of [...p.slots].sort((a, b) => minuteOfDay(a) - minuteOfDay(b))) {
    for (let k = 0; k < s.count; k += 1) out.push(new Date(mid.getTime() + minuteOfDay(s) * 60_000))
  }
  return out
}

/**
 * 🔴 **시험을 막는 이유들** — 비었으면 열 수 있다. **모든 시험 대상이 같은 관문이다**(D3 도 D50 도).
 *    · preflight 가 없거나 · 다른 단계 것이거나 · PASS 가 아니면 막는다(`PREFLIGHT_FAIL`·`PREFLIGHT_UNKNOWN`)
 *    · 그 단계 오늘 첫 슬롯이 controller 실행보다 먼저면 막는다(`LATE_START`) — 조각 하루로 시험하지 않는다.
 */
export function trialBlocks(i: {
  target: RuntimeStage; kstDate: string; runAt: string; preflight: PreflightVerdict | null
}): StageBlock[] {
  const out: StageBlock[] = []
  const pf = i.preflight
  if (pf === null) {
    out.push({ code: 'PREFLIGHT_UNKNOWN', reason: `${i.target} preflight 를 받지 못했다 — 시험을 열지 않는다` })
  } else if (pf.stage !== i.target) {
    out.push({ code: 'PREFLIGHT_UNKNOWN', reason: `preflight 대상 ${pf.stage} ≠ 시험 대상 ${i.target} — 다른 단계의 초록으로 열지 않는다` })
  } else if (pf.verdict !== 'PASS') {
    out.push({
      code: pf.verdict === 'FAIL' ? 'PREFLIGHT_FAIL' : 'PREFLIGHT_UNKNOWN',
      reason: `${i.target} preflight ${pf.verdict} [${pf.codes.join(',')}]`,
    })
  }
  const opens = firstSlotOn(i.kstDate, profileOf(i.target))
  const runMs = Date.parse(i.runAt)
  if (opens === null || !Number.isFinite(runMs) || runMs > opens.getTime()) {
    out.push({
      code: 'LATE_START',
      reason: `${i.target} 의 ${i.kstDate} 첫 슬롯(${opens === null ? '없음' : opens.toISOString()})이 결정 시각보다 앞이다`
        + ' — 조각 하루로 시험하지 않는다',
    })
  }
  return out
}
