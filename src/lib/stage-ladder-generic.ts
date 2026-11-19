/**
 * 🔴 **D1 → D100 단계 부품 — 운영 사다리가 부른다** (2026-09-29 · 2026-09-30 source-slot-v1)
 *
 * 🔴 **무엇을 하나.** 운영 사다리(`stage-ladder.planStageDecision`)에 들어가는 계산만 준다. 상태 기계는 하나다.
 *      · 슬롯 파생(`deriveSlots`) — 운영 창 안 · heartbeat 격자 위 · 60분 안 댓글 회차 3번 이상
 *      · 올라갈 칸의 관문(`judgeNextPreflight`) — **D3 부터 D100 까지 같은 한 함수**. 막는 것은 발행 구조와 Persona 하한뿐이다
 *      · 올림 관문(`preflightBlocks`) — 그 관문이 PASS 인가
 *
 * 🔴 **이 파일이 대신한 옛 정본 (실행 경로에서 지웠다 · 2026-09-30)**
 *      · `resolveCeiling`(env `SORAN_CAPACITY_STAGE` 사람 천장) — 천장은 이제 비용 preflight 가 정한다
 *      · `needsExtendedGate` · `extendedTrialBlocks` — D3~D10 은 하루 시뮬레이션, D20+ 만 preflight 로 가르던 두 벌 관문
 *      · `STOCK_SHORT` = "다음 단계 하루치 **완성 글**이 미리 있어야 연다" — 완성 글 재고 게이트
 *      · Persona 를 **활성 행 수**로 보던 입력(정본: active rows are not capacity)
 *
 * 🔴 **막는 것과 알리는 것.** 막는 `codes` 는 "올려도 그 편수를 낼 수 없는" 구조 결함뿐이다(슬롯 · Persona).
 *    추정 비용은 막지 않는다 — 하루 지출은 장부가 요청마다 천장으로 막고, 장부 결함은 브레이크 비용 축이 잡는다.
 *    편수 × 추정 단가로 미리 닫던 관문은 단가가 흔들릴 때마다 단계를 닫았다(14일에 5번 · 그동안 천장 소진 0회).
 *    공급·READY 예측 5코드는 `forecastWarnings`, 공급 비용 추정은 `warnings` 로 남아 사람이 읽는 줄에 찍힌다.
 *
 * 🔴 순수 함수다 — DB · 파일 · env · 시각 조회 0. 러너 격자 · 댓글 예약표 · 비용 · 기회 사실은 호출부가 주입한다.
 */
import {
  RUNTIME_STAGES, MAX_DAILY_TARGET, HIGHEST_RUNTIME_STAGE,
  minuteOfDay, slotLabel, kstMidnight, verifyProfile, isRuntimeStage, profileOf,
  type RuntimeStage, type ScaleProfile, type Slot,
} from './scale-profile'
import { PUBLISH_WINDOW_START_MINUTE, PUBLISH_WINDOW_END_MINUTE } from './publish-slot-catchup'
import { AUTO_FIRST_COMMENT_WINDOW_MINUTES } from './persona-comment-auto-lane'
import { ladderRowOf } from './ladder-table'
import { SUPPLY_PROOF_RUNS_PER_DAY, SUPPLY_WORKSET_PER_RUN } from './supply-schedule-contract'
import {
  FORECAST_WARNING_CODES, type ForecastSupplySignal, type ForecastWarningCode, type StageBlock,
} from './stage-decision-contract'
import type { EvidenceVerdictKind } from './stage-evidence'
import { judgeSupplyCostEnvelope, supplyCostMinResultSampleOf, supplyCostProofBudgetUsd } from './supply-cost-envelope'

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
 */
export type RunnerGrid = {
  gridMinutes: number
  perRunMax: number
  commentSlots: readonly { hour: number; minute: number }[]
  attempts: number
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

/**
 * 🔴 preflight 코드 어휘. 원천 기회·처리량·READY 필요량 **예측 5코드**(`FORECAST_WARNING_CODES`)는 계산은 여기서 하지만
 *    판정을 막지 않는다 — 판정 직전에 `forecastWarnings` 로 분리된다. 나머지가 막는 코드다(슬롯 구조 · Persona 하한).
 *    `PERSONA_ACTIVE_*` — reserve 만 늘리면 `PERSONA_SHORT` 는 풀려도 러너는 옛 active 인원으로 돈다. 그래서 표가 정한
 *    단계(`ladder-table` 의 `activeFloor`)는 실제 투입 인원도 하한을 넘어야 연다.
 */
export const PREFLIGHT_CODES = [
  'SLOTS_INFEASIBLE', 'PUBLISH_CAPACITY_SHORT',
  'OPPORTUNITY_SHORT', 'OPPORTUNITY_UNKNOWN',
  'THROUGHPUT_SHORT', 'THROUGHPUT_UNKNOWN', 'READY_REQUIREMENT_UNKNOWN',
  'PERSONA_SHORT', 'PERSONA_UNKNOWN',
  'PERSONA_ACTIVE_SHORT', 'PERSONA_ACTIVE_UNKNOWN',
] as const
export type PreflightCode = (typeof PREFLIGHT_CODES)[number]
const PREFLIGHT_UNKNOWN: readonly PreflightCode[] = ['PERSONA_UNKNOWN', 'PERSONA_ACTIVE_UNKNOWN']

/** 실제 투입 인원(stage-active)도 하한을 넘어야 하는 단계인가 — 표(`ladder-table`)가 정한다 */
export const requiresStageActiveFloor = (s: GenericStage): boolean => ladderRowOf(s)?.activeFloor === true

/**
 * 🔴 **preflight 사실** — 모르면 `null`. 모르는 것은 초록이 아니다. 막는 사실(Persona)을 모르면 열지 않고,
 *    예측 사실(기회·처리량·필요 READY · 공급 비용)을 모르면 막지 않는 경고로 남는다(지어내 초록으로 만들지 않는다).
 */
export type PreflightFacts = {
  /** 다음 시험이 실제로 열릴 KST 날짜 — 날짜별 비용 계약 선택에 쓴다. 모르면 열지 않는다. */
  proofKstDate: string | null
  /**
   * 🔴 **다음 증명일 전체 슬롯 중 slot-valid 기회로 덮이는 슬롯 수** — 정본 `judgeSlotRelease` 가 **그 슬롯 시각에**
   *    eligible 로 본 READY 와, 아직 초안이 없는 원천 기회(측정 수율로 할인)를 슬롯에 짝지은 수.
   *    완성 글 며칠치가 아니다 — 그 하루의 슬롯을 그 슬롯 시점 가치로 채울 수 있는가다.
   */
  slotValidOpportunities: number | null
  /**
   * 🔴 **현재 DB에서 다시 읽은 증명 슬롯 유효 자동 READY 재고 수.** 자연 공급 수율을 추정한 값이 아니라,
   *    `judgeSlotRelease`와 같은 슬롯 짝짓기로 실제 READY가 덮은 슬롯 수다. 복구 시작 시점의 값은
   *    intent 신원·감사용 기준선이며, 복구 성과 숫자는 아래 exact lineage 사실에서만 얻는다.
   */
  slotValidReadyStock?: number | null
  /**
   * 🔴 **현재 복구 intent가 수집한 원천에서 새로 생겨 슬롯에 실제 매칭된 READY 수.**
   *    날짜 전체 READY 증분이 아니다. intent의 정확한 nonce 영수증, intent 이후 생성 시각,
   *    source identity, 슬롯 매칭을 모두 통과한 고유 원천만 센다. lineage를 주지 않으면 `null`이다.
   */
  slotValidRecoveryReadyStock?: number | null
  /**
   * 🔴 **아직 시작하지 않은 당일 정기 공급의 보수 추가 기회.** READY 재고가 아니다.
   *    과거 3일 같은 공급 시각에 기준선 뒤 새로 관측된 고유 원천을, 오늘 READY·현재 원천이 못 채운 슬롯에만
   *    짝지은 합집합 추가분의 최솟값이다(`measuredFutureSourceOpportunities`). 그래서 `slotValidOpportunities` 에
   *    더해도 같은 슬롯을 두 번 세지 않는다. 설정상 회차 상한은 쓰지 않으며, 측정할 수 없으면 `null`이다.
   *    옛 호출부가 생략하면 0으로 읽어 기존 current-only 계약을 보존한다.
   */
  futureSupplyCapacity?: number | null
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
  /**
   * 🔴 **계약 유효이면서 DB `active` 인 Persona 수**(4상태 정본의 `stage-active`) — Persona 레인이 같은 판독으로 넣는다.
   *    active 행 수가 아니다 — active 인데 계약을 통과하지 못한 사람은 세지 않는다.
   *    표의 `activeFloor` 단계에서만 본다. 생략(`undefined`)·읽기 실패(`null`)는 모름이다.
   */
  stageActivePersonas?: number | null
  /** 공급 하루 상한(USD) — env 값을 그 증명일의 날짜 계약 승인 천장(`supplyApprovedDailyUsdOf`)으로 누른 값 */
  supplyDailyUsdCap: number | null
  /**
   * 🔴 **비용 단가 표본의 승계 후보** — 창 안에 다른 품질 계약 회차가 있을 때만 준다(없으면 `null`·생략).
   *    판정은 현재 계약 결과 편수가 최소 표본(`supplyCostMinResultSampleOf`)에 못 미칠 때만 이것을 쓴다.
   *    🔴 비용 단가 한 칸뿐이다 — READY 재고·수율·처리량·손실 보충은 언제나 `readyCohort`(현재 계약)만 본다.
   */
  supplyCostCarryover?: SupplyCostCarryoverFact | null
}

/**
 * 🔴 **72시간 창 안 모든 품질 계약 회차를 합친 비용 표본.** 품질 계약 판이 바뀌어도 원천 1건을 사는 값은 그대로다 —
 *    새 판 표본이 쌓일 때까지 같은 창의 옛 판 표본을 이어 쓴다. 범위는 창이 묶는다(판을 따로 고르지 않는다).
 *    옛 판의 대기 READY 는 결과로 세지 않는다(공개된 편수만 — 보수적).
 */
export type SupplyCostCarryoverFact = {
  /** 합친 품질 계약 판 이름 — 옛 판부터, 현재 판이 마지막. 판정 줄에 그대로 찍는다 */
  versions: readonly string[]
  /** 합친 표본의 확인된 결과 편수(현재 공개+예정 · 옛 판 공개) */
  results: number
  usdPerSlotValidResult: number | null
  trialCost: ReadyCohortFact['trialCost']
}

/**
 * 🔴 **자동 READY cohort 사실** (2026-10-04 · canon §3.1 실측 보충 계약 · P0-1 보정).
 *    같은 창(최근 3일)에서 자동 READY 로 도장된 행 **전부**를 결말로 나눈다 — 원천 · 정산액도 같은 창이다.
 *    · `sources`   창 안 공급 묶음 원천 수
 *    · `published` 공개로 끝난 행 · `lost` 공개되지 못하고 끝난 행(발행 직전 판정 만료 `EXPIRED` · 철회 `DECLINED`)
 *    · 아직 결말이 없는 대기 행은 정본 `judgeSlotRelease` 로 나눈다(`ready-fate.pendingFateOf` · P0-2):
 *        `scheduled` 다가오는 예정 슬롯에 정본 짝짓기로 걸렸다 · 손실 확정은 `lost` 에 더한다 ·
 *        `unknown` 그 밖 — 🔴 성공도 손실도 아니다
 *    · 🔴 (P0-2 보정) 현재 JIT 계약(`gateResults.supplyIntent` · `workset-v3`) 행 · 묶음만 센다 — legacy 는 세지 않는다
 *    🔴 생산능력은 `published + lost + scheduled + unknown`(raw READY) 에서 나오므로, 모르는 대기는 손실률에서도
 *       같은 무게로 다룬다(`replenishmentOf` — 모르는 대기 전부 성공 / 전부 손실 두 극단).
 *    🔴 `scheduled` 는 공개가 아니다 — 발행 트랜잭션이 그 시각에 다시 판정한다(발행 시점 재검사 유지).
 *    생성 전 탈락(게이트 · 의미 감사 HOLD)은 READY 가 아니므로 raw 에 이미 없다 — 여기서 다시 세지 않는다.
 */
export type ReadyCohortFact = {
  sources: number; published: number; lost: number; scheduled: number; unknown: number
  /**
   * 🔴 **slot-valid 결과 1건당 전 비용(USD)** — 현재 JIT 계약 장부가 원천에 **완전히** 연결됐을 때만(`costAttributionOf`).
   *    손실 · 선별 · 결말 모름 비용이 이미 들어 있다. legacy-only · 미연결 · 미정산이거나 확인된 결과가 0이면 `null`(모름).
   *    결말 모름은 전체 비용을 분자에 넣은 보수적 상한으로 판정한다.
   *    🔴 raw READY 단가(정산 ÷ 행 수)를 대신 쓰지 않는다.
   */
  usdPerSlotValidResult: number | null
  /** 실제 단가를 만들지 않고, 다음 단계 제한 trial 에만 쓰는 미상 비용 위험 표본 */
  trialCost: {
    settledRequests: number
    usageUnknownRequests: number
    /** 자연 표본에서는 제외하고 위험액·bounded 판정에만 남기는 제한 복구 요청. */
    recoverySettledRequests?: number
    recoveryUsageUnknownRequests?: number
    overrunRequests: number
    ineligibleRequests: number
    riskUsdPerSlotValidResult: number | null
  } | null
}
/**
 * 🔴 **막지 않는 공급 비용 경고** — 판정에 들어가지 않는다. 결정 로그의 사람이 읽는 줄(`preflightPlainLinesOf`)에 반드시 찍힌다.
 *    v6 `supply` 에는 들어가지 않는다(rollback reader 가 닫힌 예측 5코드만 받는다).
 *    · `SUPPLY_COST_SHORT`      편수 × 추정 단가가 하루 예산을 넘는다(또는 예약액을 넘은 요청이 표본에 있다)
 *    · `SUPPLY_COST_UNKNOWN`    표본이 모자라거나 미정산·미연결이라 추정할 수 없다
 *    · `SUPPLY_COST_TRIAL_RISK` 미상 소수가 있지만 위험액이 예산 안이다(bounded)
 */
export const PREFLIGHT_WARNING_CODES = ['SUPPLY_COST_SHORT', 'SUPPLY_COST_UNKNOWN', 'SUPPLY_COST_TRIAL_RISK'] as const
export type PreflightWarningCode = (typeof PREFLIGHT_WARNING_CODES)[number]

/**
 * 🔴 **필요 READY 구간 = 증명일 목표 슬롯 + 실측 손실 보충** — 처리량 · 공급 비용이 같이 쓰는 **한 계산**.
 *    보충 = `ceil(목표 × 손실 ÷ 성공)` — 성공 = 공개 + 예정 슬롯에 걸린 대기. 모르는 대기는 두 극단으로 구간을 만든다:
 *      `min` 모르는 대기 전부 성공 · `max` 전부 손실. 모르는 대기 0 이면 두 값이 같다.
 *    공개 관측이 0 인 극단은 비율을 계산할 수 없어 `null`(모름)이다 — 🔴 "영원히 불능" 이 아니다.
 *    🔴 어떤 경우에도 필요량은 목표 아래로 내려가지 않는다 — `low` 는 항상 확정된 하한이다.
 *    🔴 상세 원천 계획값(`PLANNED_DETAIL_PER_PUBLIC_POST`)은 이 계산에 들어오지 않는다.
 */
export type Replenishment = { target: number; min: number | null; max: number | null; low: number }

const needOf = (target: number, published: number, lost: number): number | null =>
  published <= 0 ? null : target + Math.ceil((target * lost) / published)

export const isCount = (v: number): boolean => Number.isInteger(v) && v >= 0

export function replenishmentOf(target: number, c: ReadyCohortFact | null): Replenishment {
  if (c === null || !isCount(c.published) || !isCount(c.lost) || !isCount(c.scheduled) || !isCount(c.unknown)) {
    return { target, min: null, max: null, low: target }
  }
  const ok = c.published + c.scheduled
  const min = needOf(target, ok + c.unknown, c.lost)
  const max = needOf(target, ok, c.lost + c.unknown)
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
  /** 🔴 막는 코드 — 슬롯 구조와 Persona 하한뿐이다. 예측 5코드와 비용 추정은 여기 오지 않는다 */
  codes: readonly PreflightCode[]
  /** 🔴 원천 기회·처리량·READY 필요량 예측 — 판정을 막지 않는다. v6 결정 행에 남는 유일한 경고다(`forecastSupplyOf`) */
  forecastWarnings: readonly ForecastWarningCode[]
  /** 🔴 막지 않는 공급 비용 경고 — 결정 행에 넣지 않는다 */
  warnings: readonly PreflightWarningCode[]
  counts: Readonly<Record<string, number>>
  /**
   * 공급 비용 단가를 낸 표본 — `current`(현재 품질 계약만) 또는 `window72h(<옛 판>+…+<현재 판>)`(창 전체 승계).
   * 비용 단가 한 칸에만 해당한다. 나머지 counts 는 언제나 현재 계약 값이다.
   */
  costCohort: string
}

/**
 * 🔴 **v6 결정 행의 `supply` 투영 — 하나뿐이다.** preflight 를 평가하지 않았으면 `null`, 평가했으면 정확히
 *    `{forecastWarnings}` 다(빈 배열 = 경고 없음). `warnings`(공급 비용 추정)는 넣지 않는다 —
 *    rollback reader 가 닫힌 5코드만 받는다.
 */
export function forecastSupplyOf(pf: PreflightVerdict | null): ForecastSupplySignal | null {
  return pf === null ? null : { forecastWarnings: [...pf.forecastWarnings] }
}

/**
 * 🔴 controller 운영 로그의 preflight 한 줄 — 세 갈래를 **따로** 보인다.
 *    막는 `codes`(`[...]`) · 막지 않는 운영 경고 `WARN [...]` · 막지 않는 공급·READY 예측 `FORECAST [...]`.
 *    예측 경고를 판정 PASS 뒤에 숨기지 않는다(canon §3.1·§3.2 — 경고는 보여야 계획 입력이 된다).
 */
export function preflightLogLine(target: string, pf: PreflightVerdict): string {
  return `   ${target} preflight ${pf.verdict}${pf.codes.length > 0 ? ` [${pf.codes.join(',')}]` : ''}`
    + `${pf.warnings.length > 0 ? ` WARN [${pf.warnings.join(',')}]` : ''}`
    + `${pf.forecastWarnings.length > 0 ? ` FORECAST [${pf.forecastWarnings.join(',')}]` : ''}`
    + ` costCohort=${pf.costCohort}`
    + ` (${Object.entries(pf.counts).map(([k, x]) => `${k}=${x}`).join(',')})`
}

/**
 * 🔴 **사람이 읽는 공급 비용 경고 줄** — 경고 코드마다 한 줄을 반드시 낸다. 판정에는 쓰지 않는다.
 *    이 줄들은 단계를 막지 않는다 — 실제 지출은 장부가 요청마다 하루 천장으로 막는다.
 */
export function preflightPlainLinesOf(pf: PreflightVerdict): string[] {
  const out: string[] = []
  const c = pf.counts
  const usd = (v: number): string => `$${v.toFixed(2)}`
  const results = c.supplyCostResults
  const min = c.supplyCostResultsMin
  const sampleShort = results !== undefined && min !== undefined && results < min
  if (pf.costCohort !== 'current') {
    out.push(`공급 비용 단가는 현재 품질 계약 표본이 모자라 최근 72시간의 모든 판 표본을 합쳐 냈다 — ${pf.costCohort} · 결과 ${results ?? '?'}편`)
  }
  if (pf.warnings.includes('SUPPLY_COST_UNKNOWN')) {
    out.push(sampleShort
      ? `비용 경고(막지 않음) — 표본이 글 ${results}편뿐이라 추정할 수 없다(최소 ${min}편)`
      : '비용 경고(막지 않음) — 공급 비용을 추정하지 못했다(미정산·미연결 요청이 있거나 장부를 읽지 못했다)')
  }
  if (pf.warnings.includes('SUPPLY_COST_SHORT')) {
    const need = c.supplyDailyUsdNeeded
    const budget = c.supplyProofBudgetUsd
    out.push(need !== undefined && budget !== undefined && c.usdPerSlotValidResult !== undefined && need > budget
      ? `비용 경고(막지 않음) — 추정 공급 비용이 예산을 넘는다: 글 1편당 $${c.usdPerSlotValidResult.toFixed(4)} × ${c.target}편 = ${usd(need)} > 하루 예산 ${usd(budget)} (표본 ${results ?? '?'}편). 실제 지출은 장부의 하루 천장이 막는다`
      : '비용 경고(막지 않음) — 표본에 실제 정산액이 예약액을 넘은 요청이 있다(장부 결함은 브레이크 비용 축이 본다)')
  }
  if (pf.warnings.includes('SUPPLY_COST_TRIAL_RISK')) {
    out.push('비용 경고(막지 않음) — 미상 사용량이 조금 있다. 위험액은 하루 예산 안이다')
  }
  return out
}

export type PreflightJudgeOptions = {
  /**
   * 검증된 제한 복구가 완주한 뒤 exact nonce·supply run·원천 hash로 귀속되고 실제 proof slot에
   * 매칭된 READY 수. 날짜 전체 또는 baseline 대비 READY 증분은 쓰지 않는다. 나머지
   * 품질·비용·Persona·러너 관문은 하나도 완화하지 않는다.
   */
  boundedRecoveryReadyGain?: number | null
}

/** current-quality 원천 수와 READY 수를 같은 날 공급 계약으로 환산한 보수 용량. */
export function readyCapacityOf(
  rawReady: number,
  sources: number,
  worksetPerRun: number = SUPPLY_WORKSET_PER_RUN,
  proofRunsPerDay: number = SUPPLY_PROOF_RUNS_PER_DAY,
): number | null {
  if (!Number.isFinite(rawReady) || rawReady < 0 || !Number.isFinite(sources) || sources <= 0
    || !Number.isInteger(worksetPerRun) || worksetPerRun <= 0
    || !Number.isInteger(proofRunsPerDay) || proofRunsPerDay <= 0) return null
  return Math.floor((rawReady * worksetPerRun * proofRunsPerDay) / sources)
}

/**
 * 🔴 **올라갈 칸의 관문 — D3~D100 같은 구조.** 막는 `codes` 에 FAIL 코드가 하나라도 있으면 FAIL · 없고 모름이 있으면
 *    UNKNOWN. 둘 다 올리지 않는다. 예측 5코드는 `forecastWarnings`, 공급 비용 추정은 `warnings` 로만 낸다 — 판정에 들지 않는다.
 *      · 하루 목표 · 슬롯 — 러너 프로필(`profileOf`) · Persona 하한 — `ladder-table`
 *      · 필요 READY — `replenishmentOf`(목표 + 실측 손실 보충 구간) · 공급 용량 — 회차당 묶음 × 당일 증명 회차
 *    지연(원천 게시→공개)은 counts 에 찍기만 한다 — 수집→공개는 하루 판정(`stage-evidence`)이 잰다.
 */
export function judgeNextPreflight(
  stage: GenericStage,
  facts: PreflightFacts,
  grid: RunnerGrid,
  options: PreflightJudgeOptions = {},
): PreflightVerdict {
  const codes = new Set<PreflightCode>()
  const warnings = new Set<PreflightWarningCode>()
  const n = genericDailyTarget(stage)
  const counts: Record<string, number> = { target: n }
  const prof = genericProfileOf(stage, grid)
  if (!prof.ok) codes.add('SLOTS_INFEASIBLE')
  const pubCap = publishCapacityOf(grid)
  counts.publishCapacity = pubCap
  if (pubCap < n) codes.add('PUBLISH_CAPACITY_SHORT')
  // 기회 — 증명일 전체 슬롯이 슬롯 시점 가치로 덮이는가
  if (facts.slotValidOpportunities === null) codes.add('OPPORTUNITY_UNKNOWN')
  else {
    const future = facts.futureSupplyCapacity
    counts.opportunitiesCurrent = facts.slotValidOpportunities
    if (future === null) {
      if (facts.slotValidOpportunities < n) codes.add('OPPORTUNITY_UNKNOWN')
      else counts.opportunities = facts.slotValidOpportunities
    } else {
      const futureKnown = future ?? 0
      counts.opportunitiesFuture = futureKnown
      counts.opportunities = Math.min(n, facts.slotValidOpportunities + futureKnown)
      if (counts.opportunities < n) codes.add('OPPORTUNITY_SHORT')
    }
  }
  // 처리량 — 같은 cohort 의 raw READY 수율 × 공급 회차 용량이 필요 READY 구간(목표 + 실측 손실 보충)을 채우는가
  const c = facts.readyCohort
  const req = replenishmentOf(n, c)
  const raw = c === null ? null : c.published + c.lost + c.scheduled + c.unknown
  if (c !== null) {
    Object.assign(counts, {
      readyRaw: raw, readyPublished: c.published, readyLost: c.lost,
      readyScheduled: c.scheduled, readyUnknown: c.unknown, readySources: c.sources,
    })
  }
  const readyStock = facts.slotValidReadyStock
  if (readyStock !== null && readyStock !== undefined && isCount(readyStock)) counts.readyStock = readyStock
  if (req.min !== null) counts.readyNeededMin = req.min
  if (req.max !== null) counts.readyNeededMax = req.max
  if (req.min !== null && req.min === req.max) counts.readyNeeded = req.min
  let requirementUnknown = false
  if (c === null || raw === null || !(c.sources > 0)) codes.add('THROUGHPUT_UNKNOWN')
  else {
    const naturalCapacity = readyCapacityOf(raw, c.sources)
    if (naturalCapacity === null) {
      codes.add('THROUGHPUT_UNKNOWN')
    } else {
      counts.readyCapacityNatural = naturalCapacity
      const requestedGain = options.boundedRecoveryReadyGain
      const recoveryGain = requestedGain !== null && requestedGain !== undefined && isCount(requestedGain)
        ? Math.min(requestedGain, n)
        : 0
      if (recoveryGain > 0) counts.readyCapacityRecoveryGain = recoveryGain
      const capacity = naturalCapacity + recoveryGain
      counts.readyCapacity = capacity
      const t = judgeAgainst(req, (need) => capacity >= need)
      if (t === 'short') codes.add('THROUGHPUT_SHORT')
      if (t === 'unknown') requirementUnknown = true
    }
  }
  if (facts.latencyP50H !== null && facts.latencyP90H !== null) {
    counts.latencyP50H = facts.latencyP50H
    counts.latencyP90H = facts.latencyP90H
  }
  // Persona — 계약 유효 reserve 가 표의 하한 이상인가(행 수로 대체하지 않는다). 표에 없는 단계는 열 수 없다
  const floor = ladderRowOf(stage)?.personaFloor ?? Number.POSITIVE_INFINITY
  counts.personaFloor = floor
  if (facts.contractValidPersonas === null) codes.add('PERSONA_UNKNOWN')
  else { counts.personas = facts.contractValidPersonas; if (facts.contractValidPersonas < floor) codes.add('PERSONA_SHORT') }
  // 같은 하한을 실제 투입 인원(stage-active)도 넘어야 한다. stage-active 는 계약 유효의 부분집합이다 —
  // 더 크면 두 판독이 어긋난 것이라 모름으로 닫는다
  if (requiresStageActiveFloor(stage)) {
    const active = facts.stageActivePersonas
    if (active === undefined || active === null || !isCount(active)
      || (facts.contractValidPersonas !== null && active > facts.contractValidPersonas)) codes.add('PERSONA_ACTIVE_UNKNOWN')
    else { counts.personasActive = active; if (active < floor) codes.add('PERSONA_ACTIVE_SHORT') }
  }
  /**
   * 공급 — 하루 필요 비용 = 목표 슬롯 수 × slot-valid 결과 1건당 전 비용 ≤ 공급 하루 상한(안전장치 · 소비 목표 아님).
   *   🔴 결과당 비용에는 손실 비용이 이미 들어 있다 — 손실률(필요 READY 구간)을 다시 곱하지 않는다.
   *   🔴 완전히 연결된 현재 계약 비용이 없으면 모른다 — raw READY 단가로 대신하지 않는다.
   */
  /**
   *   🔴 표본 — 현재 품질 계약의 결과 편수가 최소 표본 이상이면 현재 계약만 쓴다. 못 미치고 승계 후보가 있으면
   *   72시간 창 전체를 합친 표본을 쓴다. 어느 쪽도 최소 표본에 못 미치면 envelope 가 모름으로 닫는다.
   *   승계는 이 비용 단가에만 닿는다 — 위 처리량·필요 READY 는 `c`(현재 계약) 그대로다.
   */
  const costSampleMin = supplyCostMinResultSampleOf(n)
  const currentResults = c === null ? 0 : c.published + c.scheduled
  const carry = c !== null && currentResults < costSampleMin ? facts.supplyCostCarryover ?? null : null
  const costResults = carry === null ? currentResults : carry.results
  const perResult = carry !== null ? carry.usdPerSlotValidResult : c === null ? null : c.usdPerSlotValidResult
  const trial = carry !== null ? carry.trialCost : c?.trialCost ?? null
  counts.supplyCostResults = costResults
  counts.supplyCostResultsMin = costSampleMin
  const observed = trial === null ? 0 : trial.settledRequests + trial.usageUnknownRequests
  const settledRatio = observed > 0 && trial !== null ? trial.settledRequests / observed : 0
  if (perResult !== null && perResult > 0) {
    counts.usdPerSlotValidResult = perResult
    counts.supplyDailyUsdNeeded = n * perResult
  }
  if (trial !== null) {
    counts.supplySettledRequests = trial.settledRequests
    counts.supplyUsageUnknownRequests = trial.usageUnknownRequests
    counts.supplyTrialIneligibleRequests = trial.ineligibleRequests
    counts.supplySettledRatio = settledRatio
    if (trial.riskUsdPerSlotValidResult !== null) {
      counts.supplyTrialRiskUsdPerSlotValidResult = trial.riskUsdPerSlotValidResult
      counts.supplyTrialRiskUsdNeeded = n * trial.riskUsdPerSlotValidResult
    }
  }
  if (facts.supplyDailyUsdCap === null) warnings.add('SUPPLY_COST_UNKNOWN')
  else {
    const proofBudget = facts.proofKstDate === null
      ? null
      : supplyCostProofBudgetUsd(facts.proofKstDate, facts.supplyDailyUsdCap)
    if (proofBudget !== null) counts.supplyProofBudgetUsd = proofBudget
    const riskUsd = perResult !== null && perResult > 0
      ? n * perResult
      : trial?.riskUsdPerSlotValidResult === null || trial?.riskUsdPerSlotValidResult === undefined
        ? null
        : n * trial.riskUsdPerSlotValidResult
    const envelope = trial === null ? null : judgeSupplyCostEnvelope({
      settledRequests: trial.settledRequests,
      usageUnknownRequests: trial.usageUnknownRequests,
      recoveryUsageUnknownRequests: trial.recoveryUsageUnknownRequests ?? 0,
      overrunRequests: trial.overrunRequests,
      ineligibleRequests: trial.ineligibleRequests,
      riskUsd,
      budgetUsd: proofBudget,
      resultSample: { results: costResults, minimum: costSampleMin },
    })
    if (envelope === null || envelope.kind === 'unknown') warnings.add('SUPPLY_COST_UNKNOWN')
    else if (envelope.kind === 'bad') warnings.add('SUPPLY_COST_SHORT')
    else if (envelope.kind === 'bounded') warnings.add('SUPPLY_COST_TRIAL_RISK')
  }
  if (requirementUnknown) codes.add('READY_REQUIREMENT_UNKNOWN')
  /**
   * 🔴 **분리는 여기 한 곳이다** (2026-11-06 · canon §3.1). 예측 5코드는 막는 코드에서 빼 `forecastWarnings` 로 보낸다 —
   *    판정·`preflightBlocks`·제한 복구 계획은 막는 코드만 본다. 계산·counts 는 그대로 남아 계획 입력으로 쓰인다.
   */
  const isForecast = (c: PreflightCode): c is ForecastWarningCode => (FORECAST_WARNING_CODES as readonly string[]).includes(c)
  const ordered = PREFLIGHT_CODES.filter((c) => codes.has(c) && !isForecast(c))
  const forecastWarnings = FORECAST_WARNING_CODES.filter((c) => codes.has(c))
  const failing = ordered.filter((c) => !PREFLIGHT_UNKNOWN.includes(c))
  const verdict: EvidenceVerdictKind = failing.length > 0 ? 'FAIL' : ordered.length > 0 ? 'UNKNOWN' : 'PASS'
  return {
    stage, verdict, codes: ordered, forecastWarnings,
    warnings: PREFLIGHT_WARNING_CODES.filter((c) => warnings.has(c)), counts,
    costCohort: carry === null ? 'current' : `window72h(${carry.versions.join('+')})`,
  }
}

// ─────────────────────────────────────────────────────────
// 🔴 올림 관문 — 운영 사다리가 부른다 (모든 단계)
// ─────────────────────────────────────────────────────────

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
 * 🔴 **올림을 막는 이유들** — 비었으면 올릴 수 있다. 모든 단계가 같은 관문이다(D3 도 D50 도).
 *    관문 판정이 없거나 · 다른 단계 것이거나 · PASS 가 아니면 막는다(`PREFLIGHT_FAIL`·`PREFLIGHT_UNKNOWN`).
 */
export function preflightBlocks(i: { target: RuntimeStage; preflight: PreflightVerdict | null }): StageBlock[] {
  const pf = i.preflight
  if (pf === null) {
    return [{ code: 'PREFLIGHT_UNKNOWN', reason: `${i.target} 관문 판정을 받지 못했다 — 올리지 않는다` }]
  }
  if (pf.stage !== i.target) {
    return [{ code: 'PREFLIGHT_UNKNOWN', reason: `관문 대상 ${pf.stage} ≠ 올라갈 칸 ${i.target} — 다른 단계의 초록으로 올리지 않는다` }]
  }
  if (pf.verdict !== 'PASS') {
    return [{
      code: pf.verdict === 'FAIL' ? 'PREFLIGHT_FAIL' : 'PREFLIGHT_UNKNOWN',
      reason: `${i.target} preflight ${pf.verdict} [${pf.codes.join(',')}]`,
    }]
  }
  return []
}
