/**
 * 🔴 **D1 → D100 일반 단계 스케줄러 골격 — 순수 함수 · 운영 controller 에 배선하지 않았다** (2026-09-29)
 *
 * 🔴 **왜 생겼나.** 운영 사다리(`stage-ladder` · `stage-controller`)는 `RELEASE_STAGES`(d1·d3·d5·d10)
 *    위에서만 돈다. `nextStage(d10)` 은 `null` 이고, 저장 계약(`validateStoredDecision`)·러너 프로필
 *    (`PROFILES`)·승인 천장(`resolveStage`) 전부 d10 이 끝이다. D20 이상은 "설정만 바꾸면 되는" 칸이 없다.
 *    이 파일은 그 칸을 **숫자와 규칙으로** 먼저 세운다 — 러너가 쓰는 값은 하나도 바꾸지 않는다.
 *
 * 🔴 **전이 규칙은 #620 과 같다 — 새 규칙을 만들지 않는다.**
 *    · 다음 단계 시험은 **지금 단계의 완전한 자동 운영 PASS 뒤에만** 열린다
 *      (판정 본체는 `stage-evidence.judgeEvidenceForTarget` 하나 — 자동 READY · 무인 물량 = 목표 ·
 *       자동 글마다 60분 안 첫 Persona 댓글 · 20% 감사 표본 · 중복 0 · 비용·러너 정상).
 *    · FAIL · UNKNOWN → **같은 단계 재시험**. 사람 승인 물량은 0건으로 센다.
 *    · 날짜로 기다리지 않는다 · 사람이 env 를 고치지 않는다 — PASS 뒤 다음 단계 preflight
 *      (재고 · Persona · 댓글 비용 · 댓글 러너 · 감사 비용)가 초록이면, 07:00 controller 가 그날
 *      첫 유효 슬롯에서 canary 를 연다(`opensAt`).
 *
 * 🔴 **#620 과 다른 점 하나 — 정체(stall)를 없앤다.** 운영 사다리는 PASS 뒤 천장·준비도에 막히면
 *    다음 날 HOLD 가 되고, HOLD 날의 증거는 `DECISION_NOT_TRANSITION` 이라 **다시는 PASS 를 못 만든다**
 *    (지속 승격 경로 밖에서는 영구 정체 — `stage-scheduler-check` 가 실측한다).
 *    여기서는 막힌 날을 `REPROVE`(지금 단계를 증명일로 다시 돈다)로 둔다. 올라가지 않고, 증거는 계속 쌓인다.
 *
 * 🔴 **승인 천장은 fail-closed 다.** 천장보다 높은 단계는 어떤 경우에도 열리지 않는다.
 *    천장 타입은 d20 이상을 **표현할 수 있지만**, 지금 운영값(d10)을 바꾸지 않는다.
 *    러너 배선이 없는 단계(`RUNTIME_UNWIRED`)도 천장과 별개로 막는다 — 표현할 수 있다고 열 수 있는 것이 아니다.
 *
 * 🔴 순수 함수다 — DB · 파일 · env · 시각 조회 0. 러너 격자·댓글 예약표는 호출부가 주입한다
 *    (그 정본은 `scripts/lib/*-runner-template.ts` 이고 `src/lib` 가 `scripts` 를 import 하지 않는다).
 */
import {
  PROFILES, RELEASE_STAGES, MAX_DAILY_TARGET, SAFEST_STAGE, minuteOfDay, slotLabel, kstMidnight,
  verifyProfile, type ReleaseStage, type ScaleProfile, type Slot,
} from './scale-profile'
import { PUBLISH_WINDOW_START_MINUTE, PUBLISH_WINDOW_END_MINUTE } from './publish-slot-catchup'
import { AUTO_FIRST_COMMENT_WINDOW_MINUTES, AUTO_PERSONA_COMMENTS_PER_POST_MAX } from './persona-comment-auto-lane'
import { auditTarget } from './auto-ready-v2'
import { PERSONA_CANARY_FLOOR } from './d100-capacity'
import { DECISION_WRITER, previousKstDate } from './stage-decision-contract'
import type { EvidenceVerdictKind } from './stage-evidence'

// ─────────────────────────────────────────────────────────
// 🔴 단계 목록 — 앞 넷은 운영 `RELEASE_STAGES` 그대로다
// ─────────────────────────────────────────────────────────

export const GENERIC_STAGES = ['d1', 'd3', 'd5', 'd10', 'd20', 'd30', 'd50', 'd100'] as const
export type GenericStage = (typeof GENERIC_STAGES)[number]

/**
 * 🔴 **D20 이상의 하루 목표** — 창업자 확정 계획(`d100-capacity` 의 `publicPostsPerDay`)과 같은 값이다.
 *    검사가 `d100Plan(stage).publicPostsPerDay` 와 대조한다. d1~d10 은 `PROFILES` 가 정본이다.
 */
const EXTENDED_DAILY_TARGET: Readonly<Record<Exclude<GenericStage, ReleaseStage>, number>> = {
  d20: 20, d30: 30, d50: 50, d100: 100,
}

export const isGenericStage = (v: unknown): v is GenericStage =>
  typeof v === 'string' && (GENERIC_STAGES as readonly string[]).includes(v)

export const isRuntimeStage = (s: GenericStage): s is ReleaseStage =>
  (RELEASE_STAGES as readonly string[]).includes(s)

export function genericRank(s: GenericStage): number {
  return GENERIC_STAGES.indexOf(s)
}

/** 🔴 다음 칸 — d100 위는 없다 */
export function genericNextStage(s: GenericStage): GenericStage | null {
  const i = GENERIC_STAGES.indexOf(s)
  return i < 0 || i + 1 >= GENERIC_STAGES.length ? null : GENERIC_STAGES[i + 1]!
}

export function genericDailyTarget(s: GenericStage): number {
  return isRuntimeStage(s) ? PROFILES[s].dailyTarget : EXTENDED_DAILY_TARGET[s]
}

// ─────────────────────────────────────────────────────────
// 🔴 승인 천장 — d20 이상을 표현하되 fail-closed
// ─────────────────────────────────────────────────────────

export type CeilingResolution = {
  /** 사람이 승인한 천장 — 모르는 값이면 가장 안전한 단계 */
  authorized: GenericStage
  /** 🔴 실제로 열 수 있는 천장 — 승인 천장과 러너 배선 상한 중 낮은 쪽 */
  operable: ReleaseStage
  fallbackReason: string | null
}

/** 🔴 러너가 배선된 가장 높은 단계 — 지금은 d10 */
export const HIGHEST_RUNTIME_STAGE: ReleaseStage = RELEASE_STAGES[RELEASE_STAGES.length - 1]!

/**
 * 🔴 **천장 env 문자열 → 천장.** 모르는 값은 가장 안전한 단계다(운영 `resolveStage` 와 같은 방향).
 *    다른 점은 하나다 — `d20` 을 적으면 운영 `resolveStage` 는 **d1 로 떨어뜨린다**(모르는 값).
 *    여기서는 승인 천장 d20 으로 읽고, 열 수 있는 천장은 러너 배선 상한(d10)으로 묶는다.
 *    🔴 어느 쪽도 천장보다 높은 단계를 열지 않는다.
 */
export function resolveCeiling(raw: string | undefined): CeilingResolution {
  const v = (raw ?? '').trim()
  if (!isGenericStage(v)) {
    return {
      authorized: SAFEST_STAGE, operable: SAFEST_STAGE,
      fallbackReason: v === '' ? '천장 설정이 없다 — 가장 안전한 d1' : `천장 "${v}" 는 허용 단계가 아니다 — d1`,
    }
  }
  const operable: ReleaseStage = isRuntimeStage(v) ? v : HIGHEST_RUNTIME_STAGE
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

/** 🔴 D20 이상 Persona 발행 간격 — 새 숫자가 아니라 d10 운영값 그대로다 */
const EXTENDED_PERSONA_CAPS = { postsPerWeek: PROFILES.d10.postsPerWeek, minDaysBetween: PROFILES.d10.minDaysBetween }

export type GenericProfile =
  | { ok: true; stage: GenericStage; profile: ScaleProfile; source: 'runtime' | 'derived' }
  | { ok: false; stage: GenericStage; problems: string[] }

/**
 * 🔴 **단계 프로필.** d1~d10 은 운영 `PROFILES` 를 **그대로** 돌려준다(바꾸지 않는다).
 *    d20 이상은 목표·Persona 간격·슬롯을 파생한다 — 슬롯이 담기지 않으면 프로필이 없다.
 */
export function genericProfileOf(stage: GenericStage, grid: RunnerGrid): GenericProfile {
  if (isRuntimeStage(stage)) return { ok: true, stage, profile: PROFILES[stage], source: 'runtime' }
  const n = genericDailyTarget(stage)
  const d = deriveSlots(n, grid)
  if (!d.ok) return { ok: false, stage, problems: d.problems }
  const profile: ScaleProfile = { dailyTarget: n, ...EXTENDED_PERSONA_CAPS, slots: d.slots }
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
] as const
export type PreflightCode = (typeof PREFLIGHT_CODES)[number]
const PREFLIGHT_UNKNOWN: readonly PreflightCode[] = ['STOCK_UNKNOWN', 'PERSONA_UNKNOWN', 'COMMENT_COST_UNKNOWN', 'AUDIT_COST_UNKNOWN']

/**
 * 🔴 **preflight 사실** — 모르면 `null`. 모르는 것은 초록이 아니다.
 *    비용 상한은 정본 상수(`COMMENT_LOOP_DAILY_USD_MAX` 등)를, 단가는 장부 실측을 호출부가 넣는다.
 */
export type PreflightFacts = {
  /** 자동 READY 재고(발행 가능) */
  readyAutoStock: number | null
  /** 활성 Persona 수 */
  activePersonas: number | null
  /** 댓글 1건 정산 단가(USD) — 장부 실측 */
  commentUsdPerRequest: number | null
  /** 댓글 레인 하루 상한(USD) */
  commentDailyUsdCap: number
  /** 감사 1건 정산 단가(USD) — 장부 실측 */
  auditUsdPerCall: number | null
  /** 감사 레인 하루 상한(USD) — 모르면 null */
  auditDailyUsdCap: number | null
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
  if (facts.commentUsdPerRequest === null || !(facts.commentUsdPerRequest > 0)) codes.add('COMMENT_COST_UNKNOWN')
  else {
    const affordable = Math.floor(facts.commentDailyUsdCap / facts.commentUsdPerRequest)
    counts.commentAffordable = affordable
    if (affordable < firstComments) codes.add('COMMENT_COST_SHORT')
  }
  const runnerCap = grid.commentSlots.length * grid.commentRunRequestCap
  counts.commentRunnerCapacity = runnerCap
  if (runnerCap < firstComments) codes.add('COMMENT_RUNNER_SHORT')
  // 감사 — 정본 표본 수 × 단가 ≤ 감사 하루 상한
  const audits = auditTarget(n)
  counts.auditExpected = audits
  if (facts.auditUsdPerCall === null || facts.auditDailyUsdCap === null) codes.add('AUDIT_COST_UNKNOWN')
  else if (audits * facts.auditUsdPerCall > facts.auditDailyUsdCap) codes.add('AUDIT_COST_SHORT')
  const ordered = PREFLIGHT_CODES.filter((c) => codes.has(c))
  const failing = ordered.filter((c) => !PREFLIGHT_UNKNOWN.includes(c))
  const verdict: EvidenceVerdictKind = failing.length > 0 ? 'FAIL' : ordered.length > 0 ? 'UNKNOWN' : 'PASS'
  return { stage, verdict, codes: ordered, counts }
}

// ─────────────────────────────────────────────────────────
// 🔴 상태 기계 — 전날 결정 + 전날 운영 증거 → 오늘
// ─────────────────────────────────────────────────────────

export const GENERIC_STATES = ['TRIAL', 'REPROVE', 'HOLD'] as const
export type GenericState = (typeof GENERIC_STATES)[number]
export type GenericBasis = 'PASS' | 'RETEST' | 'FLOOR'

export const GENERIC_BLOCK_CODES = [
  'PROVENANCE_PREVIOUS', 'CEILING', 'RUNTIME_UNWIRED', 'PREFLIGHT_FAIL', 'PREFLIGHT_UNKNOWN', 'LATE_START', 'TOP',
] as const
export type GenericBlockCode = (typeof GENERIC_BLOCK_CODES)[number]

/** 🔴 전날 결정 — controller 가 쓴 것만 기반이 된다 */
export type GenericPrevious = {
  kstDate: string
  release: GenericStage
  state: 'TRIAL' | 'SUSTAIN' | 'REPROVE' | 'HOLD' | 'PREPARE'
  decidedBy: string
  /** TRIAL 이면 시험 기반 — 아니면 null */
  trialBase: GenericStage | null
}

/** 🔴 전날 운영 증거 — `judgeEvidenceForTarget` 결과에서 세 칸만 */
export type GenericEvidence = { kstDate: string; stage: GenericStage; verdict: EvidenceVerdictKind }

export type GenericPlanInput = {
  kstDate: string
  /** controller 가 도는 시각 — `opensAt` 이 이미 지났는지 본다 */
  runAt: Date
  previous: GenericPrevious | null
  evidence: GenericEvidence | null
  /** 🔴 승인 천장(`resolveCeiling(...).authorized`) — 이 기계가 올리지 않는다 */
  ceiling: GenericStage
  /** 러너 배선 여부 — 기본은 `isRuntimeStage` */
  runtimeWired?: (s: GenericStage) => boolean
  /** 시험 대상의 preflight — 호출부가 사실을 모아 `judgeNextPreflight` 로 만든다 */
  preflight: (s: GenericStage) => PreflightVerdict
  grid: RunnerGrid
}

export type GenericPlan = {
  kstDate: string
  state: GenericState
  /** 오늘 공개 단계 */
  release: GenericStage
  base: GenericStage | null
  target: GenericStage | null
  basis: GenericBasis | null
  /** 🔴 증명일인가 — 자동 target 이 목표 슬롯을 먼저 채운다(`stage-proof-day`) */
  proofDay: boolean
  /** TRIAL 이 열리는 첫 슬롯(ISO) */
  opensAt: string | null
  blocks: readonly { code: GenericBlockCode; reason: string }[]
}

const TRANSITION_OR_PROOF: readonly GenericPrevious['state'][] = ['TRIAL', 'SUSTAIN', 'REPROVE']

/** 🔴 그 KST 날짜의 그 프로필 첫 슬롯(UTC Date) */
export function firstSlotOn(kstDate: string, p: ScaleProfile): Date | null {
  const first = [...p.slots].map(minuteOfDay).sort((a, b) => a - b)[0]
  if (first === undefined) return null
  const mid = kstMidnight(new Date(`${kstDate}T12:00:00+09:00`))
  return new Date(mid.getTime() + first * 60_000)
}

/**
 * 🔴 **오늘의 계획.** 위에서 아래로 한 번만 간다.
 *    ① 전날 결정이 없거나 · 직전 날짜가 아니거나 · controller 가 쓴 것이 아니면 → HOLD (시험 없음)
 *    ② 전날 단계 S 가 운영 PASS                → 후보 S→next(S)  (`PASS`)
 *       전날 TRIAL 인데 PASS 아님               → 후보 기반→같은 대상 (`RETEST`)
 *       전날 공개가 바닥(d1)                     → 후보 d1→d3     (`FLOOR`)
 *       그 밖(증명 없는 d3 이상)                 → REPROVE S      (지금 단계를 증명일로 다시 돈다)
 *    ③ 후보 관문 — 천장 · 러너 배선 · preflight · 첫 슬롯 시각. 하나라도 막히면 **REPROVE 기반**
 *       (올리지 않고, 내일 다시 볼 증거를 만든다). 전부 열리면 TRIAL.
 */
export function planGenericStage(i: GenericPlanInput): GenericPlan {
  const wired = i.runtimeWired ?? isRuntimeStage
  const blocks: { code: GenericBlockCode; reason: string }[] = []
  const hold = (release: GenericStage): GenericPlan => ({
    kstDate: i.kstDate, state: 'HOLD', release, base: null, target: null, basis: null,
    proofDay: false, opensAt: null, blocks,
  })
  const reprove = (release: GenericStage): GenericPlan => ({
    kstDate: i.kstDate, state: 'REPROVE', release, base: release, target: null, basis: null,
    proofDay: true, opensAt: null, blocks,
  })
  const p = i.previous
  const want = previousKstDate(i.kstDate)
  if (p === null || want === null || p.kstDate !== want || p.decidedBy !== DECISION_WRITER) {
    blocks.push({
      code: 'PROVENANCE_PREVIOUS',
      reason: p === null ? `${String(want)} 결정이 없다 — 시험을 열지 않는다`
        : p.kstDate !== want ? `이전 결정 ${p.kstDate} ≠ 직전 날짜 ${String(want)}`
          : `이전 결정을 ${p.decidedBy} 가 썼다 — ${DECISION_WRITER} 만 기반이 된다`,
    })
    // 🔴 천장 위로는 두지 않는다
    const cur = p === null ? SAFEST_STAGE : p.release
    return hold(genericRank(cur) > genericRank(i.ceiling) ? i.ceiling : cur)
  }
  // 🔴 증거는 전날 결정과 **같은 날짜 · 같은 단계** 의 PASS 만 받는다 — 결정이 전이/증명일이어야 한다
  const e = i.evidence
  const passed = e !== null && e.verdict === 'PASS' && e.kstDate === p.kstDate && e.stage === p.release
    && TRANSITION_OR_PROOF.includes(p.state)
  let cand: { base: GenericStage; target: GenericStage; basis: GenericBasis } | null = null
  if (passed) {
    const up = genericNextStage(p.release)
    if (up === null) {
      blocks.push({ code: 'TOP', reason: `${p.release} 가 마지막 단계다 — 지금 단계를 계속 증명한다` })
      return reprove(p.release)
    }
    cand = { base: p.release, target: up, basis: 'PASS' }
  } else if (p.state === 'TRIAL' && p.trialBase !== null) {
    cand = { base: p.trialBase, target: p.release, basis: 'RETEST' }
  } else if (p.release === SAFEST_STAGE) {
    cand = { base: SAFEST_STAGE, target: genericNextStage(SAFEST_STAGE)!, basis: 'FLOOR' }
  } else {
    return reprove(genericRank(p.release) > genericRank(i.ceiling) ? i.ceiling : p.release)
  }
  // ③ 관문 — 🔴 기반도 천장 위로는 두지 않는다
  const base = genericRank(cand.base) > genericRank(i.ceiling) ? i.ceiling : cand.base
  if (genericRank(cand.target) > genericRank(i.ceiling)) {
    blocks.push({ code: 'CEILING', reason: `시험 대상 ${cand.target} 가 승인 천장 ${i.ceiling} 를 넘는다 — 열지 않는다` })
    return reprove(base)
  }
  if (!wired(cand.target)) {
    blocks.push({ code: 'RUNTIME_UNWIRED', reason: `${cand.target} 는 러너·저장 계약에 배선되지 않았다 — 열지 않는다` })
    return reprove(base)
  }
  const pf = i.preflight(cand.target)
  if (pf.stage !== cand.target || pf.verdict !== 'PASS') {
    blocks.push({
      code: pf.stage === cand.target && pf.verdict === 'FAIL' ? 'PREFLIGHT_FAIL' : 'PREFLIGHT_UNKNOWN',
      reason: `${cand.target} preflight ${pf.stage === cand.target ? pf.verdict : `대상 불일치(${pf.stage})`} [${pf.codes.join(',')}]`,
    })
    return reprove(base)
  }
  const prof = genericProfileOf(cand.target, i.grid)
  const opens = prof.ok ? firstSlotOn(i.kstDate, prof.profile) : null
  if (opens === null || i.runAt.getTime() > opens.getTime()) {
    blocks.push({
      code: 'LATE_START',
      reason: `${cand.target} 의 오늘 첫 슬롯이 이미 지났다(또는 없다) — 조각 하루로 시험하지 않는다. 기반을 증명일로 돈다`,
    })
    return reprove(base)
  }
  return {
    kstDate: i.kstDate, state: 'TRIAL', release: cand.target, base, target: cand.target, basis: cand.basis,
    proofDay: true, opensAt: opens.toISOString(), blocks,
  }
}
