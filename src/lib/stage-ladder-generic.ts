/**
 * 🔴 **D1 → D100 일반 단계 스케줄러 — 운영 controller 에 배선했다** (2026-09-29)
 *
 * 🔴 **무엇을 하나.** 운영 사다리(`stage-ladder.planStageDecision`)가 D20 이상을 다룰 때 쓰는 부품이다.
 *    상태 기계는 **하나**다 — 운영 사다리가 그것이고, 이 파일은 거기에 들어가는 계산만 준다.
 *      · 승인 천장 해석(`resolveCeiling`) — d100 을 표현하되 열 수 있는 천장은 러너 단계(d50) 이하
 *      · 슬롯 파생(`deriveSlots`) — 운영 창 안 · heartbeat 격자 위 · 60분 안 댓글 회차 3번 이상
 *      · 다음 칸 preflight(`judgeNextPreflight`) — 재고 · Persona canary 하한 · 댓글/감사/공급 비용 · 러너 용량
 *      · D20 이상 시험 관문(`extendedTrialBlocks`) — preflight PASS + 첫 슬롯 전(LATE_START 아님)
 *    🔴 앞판(#622 골격)의 별도 상태 기계(`planGenericStage`)는 지웠다 — 운영 사다리와 두 벌이 되면
 *       갈라진 순간부터 한쪽만 고쳐진다. 그 전이 규칙(PASS 뒤 한 칸 · FAIL/UNKNOWN 재시험 · 막힌 날 증명일)은
 *       운영 사다리의 `trialPlanOf` · `REPROVE` 로 옮겼고, 검사는 운영 `decideStage` 를 여러 날 돌려 본다.
 *
 * 🔴 **전이 규칙은 #620 과 같다 — 새 규칙을 만들지 않는다.**
 *    · 다음 단계 시험은 **지금 단계의 완전한 자동 운영 PASS 뒤에만** 열린다(`judgeEvidenceForTarget` 여섯 조건).
 *    · FAIL · UNKNOWN → 같은 단계 재시험. 사람 승인 물량은 0건으로 센다.
 *    · 날짜로 기다리지 않는다 · 사람이 env 를 고치지 않는다 — PASS 다음 날 07:00 controller 가 연다.
 *
 * 🔴 **D3·D5·D10 시험은 이 관문을 지나지 않는다** — #620 관문(하루 시뮬레이션 `judgeOneDayCanary`) 그대로다.
 *    D20 이상만 그 위에 preflight 와 첫 슬롯 시각을 더 본다(`needsExtendedGate`). 지금 운영을 바꾸지 않는다.
 *
 * 🔴 순수 함수다 — DB · 파일 · env · 시각 조회 0. 러너 격자·댓글 예약표·비용 사실은 호출부가 주입한다
 *    (그 정본은 `scripts/lib/*-runner-template.ts` · 장부이고 `src/lib` 가 `scripts` 를 import 하지 않는다).
 */
import {
  RELEASE_STAGES, RUNTIME_STAGES, MAX_DAILY_TARGET, SAFEST_STAGE, HIGHEST_RUNTIME_STAGE,
  minuteOfDay, slotLabel, kstMidnight, verifyProfile, isRuntimeStage, profileOf, stageRank,
  type RuntimeStage, type ScaleProfile, type Slot,
} from './scale-profile'
import { PUBLISH_WINDOW_START_MINUTE, PUBLISH_WINDOW_END_MINUTE } from './publish-slot-catchup'
import { AUTO_FIRST_COMMENT_WINDOW_MINUTES, AUTO_PERSONA_COMMENTS_PER_POST_MAX } from './persona-comment-auto-lane'
import { auditTarget } from './auto-ready-v2'
import { PERSONA_CANARY_FLOOR, READY_NET_MARGIN } from './d100-capacity'
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
// 🔴 승인 천장 — d100 을 표현하되 fail-closed
// ─────────────────────────────────────────────────────────

export type CeilingResolution = {
  /** 사람이 승인한 천장 — 모르는 값이면 가장 안전한 단계 */
  authorized: GenericStage
  /** 🔴 실제로 열 수 있는 천장 — 승인 천장과 러너 단계 상한 중 낮은 쪽 */
  operable: RuntimeStage
  fallbackReason: string | null
}

/**
 * 🔴 **천장 env 문자열 → 천장.** 모르는 값은 가장 안전한 단계다(운영 `resolveStage` 와 같은 방향).
 *    `d100` 은 승인 천장 d100 으로 읽고, 열 수 있는 천장은 러너 단계 상한(d50)으로 묶는다.
 *    🔴 어느 쪽도 천장보다 높은 단계를 열지 않는다. 지금 운영값(d10)은 d10 그대로다.
 */
export function resolveCeiling(raw: string | undefined): CeilingResolution {
  const v = (raw ?? '').trim()
  if (!isGenericStage(v)) {
    return {
      authorized: SAFEST_STAGE, operable: SAFEST_STAGE,
      fallbackReason: v === '' ? '천장 설정이 없다 — 가장 안전한 d1' : `천장 "${v}" 는 허용 단계가 아니다 — d1`,
    }
  }
  const operable: RuntimeStage = isRuntimeStage(v) ? v : HIGHEST_RUNTIME_STAGE
  return { authorized: v, operable, fallbackReason: null }
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
// 🔴 다음 단계 preflight — 시험을 열어도 되는가 (재고 · Persona · 비용 · 용량)
// ─────────────────────────────────────────────────────────

export const PREFLIGHT_CODES = [
  'SLOTS_INFEASIBLE', 'PUBLISH_CAPACITY_SHORT',
  'STOCK_SHORT', 'STOCK_UNKNOWN',
  'PERSONA_SHORT', 'PERSONA_UNKNOWN',
  'COMMENT_COST_SHORT', 'COMMENT_COST_UNKNOWN', 'COMMENT_RUNNER_SHORT',
  'AUDIT_COST_SHORT', 'AUDIT_COST_UNKNOWN',
  'SUPPLY_COST_SHORT', 'SUPPLY_COST_UNKNOWN',
] as const
export type PreflightCode = (typeof PREFLIGHT_CODES)[number]
const PREFLIGHT_UNKNOWN: readonly PreflightCode[] = [
  'STOCK_UNKNOWN', 'PERSONA_UNKNOWN', 'COMMENT_COST_UNKNOWN', 'AUDIT_COST_UNKNOWN', 'SUPPLY_COST_UNKNOWN',
]

/**
 * 🔴 **preflight 사실** — 모르면 `null`. 모르는 것은 초록이 아니다.
 *    상한은 정본(env 값을 정본 천장으로 누른 것)을, 단가는 장부 실측을 호출부가 넣는다.
 */
export type PreflightFacts = {
  /** 자동 READY 재고(발행 가능) */
  readyAutoStock: number | null
  /** 활성 Persona 수 */
  activePersonas: number | null
  /** 댓글 1건 정산 단가(USD) — 장부 실측 */
  commentUsdPerRequest: number | null
  /** 댓글 레인 하루 상한(USD) — 정본 최대 $0.20 */
  commentDailyUsdCap: number | null
  /** 감사 1건 정산 단가(USD) — 장부 실측 */
  auditUsdPerCall: number | null
  /** 감사 레인 하루 상한(USD) — 모르면 null */
  auditDailyUsdCap: number | null
  /** 🔴 자동 READY 한 건을 만드는 데 든 공급 비용(USD) — 장부 정산액 ÷ 그날 자동 READY 수. 모르면 null */
  supplyUsdPerReady: number | null
  /** 공급 하루 상한(USD) — 정본 최대 $0.50. 모르면 null */
  supplyDailyUsdCap: number | null
}

export type PreflightVerdict = {
  stage: GenericStage
  verdict: EvidenceVerdictKind
  codes: readonly PreflightCode[]
  counts: Readonly<Record<string, number>>
}

/**
 * 🔴 **다음 단계 preflight.** FAIL 코드가 하나라도 있으면 FAIL · 없고 모름이 있으면 UNKNOWN.
 *    둘 다 시험을 열지 않는다.
 *    🔴 Persona 는 **canary 하한**(`PERSONA_CANARY_FLOOR`)으로 본다 — 지속 다양성 목표
 *       (`PERSONA_SUSTAINED_TARGET`)는 하루 시험을 막지 않는다(#618 정본 구분).
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
  // 재고 — 하루 시험은 목표만큼 자동 READY 가 있어야 한다(정본 `judgeOneDayCanary` 와 같은 요구)
  if (facts.readyAutoStock === null) codes.add('STOCK_UNKNOWN')
  else { counts.stock = facts.readyAutoStock; if (facts.readyAutoStock < n) codes.add('STOCK_SHORT') }
  // Persona — canary 하한(정본 `PERSONA_CANARY_FLOOR`). d1 은 표에 없다 → 산술 하한 1
  const floor = stage === 'd1' ? 1 : PERSONA_CANARY_FLOOR[stage]
  counts.personaFloor = floor
  if (facts.activePersonas === null) codes.add('PERSONA_UNKNOWN')
  else { counts.personas = facts.activePersonas; if (facts.activePersonas < floor) codes.add('PERSONA_SHORT') }
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
  // 공급 — 하루 READY 생산 요구(공개 × `READY_NET_MARGIN`) × 건당 공급 비용 ≤ 공급 하루 상한
  const readyNeeded = Math.ceil(n * READY_NET_MARGIN)
  counts.readyNeeded = readyNeeded
  if (facts.supplyUsdPerReady === null || !(facts.supplyUsdPerReady > 0) || facts.supplyDailyUsdCap === null) {
    codes.add('SUPPLY_COST_UNKNOWN')
  } else if (readyNeeded * facts.supplyUsdPerReady > facts.supplyDailyUsdCap) codes.add('SUPPLY_COST_SHORT')
  const ordered = PREFLIGHT_CODES.filter((c) => codes.has(c))
  const failing = ordered.filter((c) => !PREFLIGHT_UNKNOWN.includes(c))
  const verdict: EvidenceVerdictKind = failing.length > 0 ? 'FAIL' : ordered.length > 0 ? 'UNKNOWN' : 'PASS'
  return { stage, verdict, codes: ordered, counts }
}

// ─────────────────────────────────────────────────────────
// 🔴 D20 이상 시험 관문 — 운영 사다리가 부른다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **이 시험 대상이 D20 이상 관문을 지나야 하는가** — #620 이 닫은 d1~d10 밖이면 그렇다.
 *    d3·d5·d10 시험은 #620 관문 그대로다(바꾸지 않는다).
 */
export function needsExtendedGate(target: RuntimeStage): boolean {
  return !(RELEASE_STAGES as readonly string[]).includes(target)
}

/** 🔴 그 KST 날짜의 그 프로필 첫 슬롯(UTC Date) */
export function firstSlotOn(kstDate: string, p: ScaleProfile): Date | null {
  const first = [...p.slots].map(minuteOfDay).sort((a, b) => a - b)[0]
  if (first === undefined) return null
  const mid = kstMidnight(new Date(`${kstDate}T12:00:00+09:00`))
  return new Date(mid.getTime() + first * 60_000)
}

/**
 * 🔴 **D20 이상 시험을 막는 이유들** — 비었으면 열 수 있다.
 *    · preflight 가 없거나 · 다른 단계 것이거나 · PASS 가 아니면 막는다(`PREFLIGHT_FAIL`·`PREFLIGHT_UNKNOWN`)
 *    · 그 단계 오늘 첫 슬롯이 controller 실행보다 먼저면 막는다(`LATE_START`) — 조각 하루로 시험하지 않는다.
 *      07:00 controller 는 08:00 첫 슬롯 전이다 — **다음 KST 날 07:00 이 가장 이른 시험**이다.
 */
export function extendedTrialBlocks(i: {
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

/** 🔴 두 단계 중 높은 쪽 — 보고용 */
export const higherRuntime = (a: RuntimeStage, b: RuntimeStage): RuntimeStage => (stageRank(a) >= stageRank(b) ? a : b)
