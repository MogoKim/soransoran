/**
 * 🔴 **단계 controller — 사다리(`planStageDecision`) 위에 운영 신호 브레이크를 얹는다** (2026-09-28 · 2026-09-30 단순화)
 *
 * 🔴 **새 문턱값을 만들지 않는다.** 판정은 전부 정본이 한다:
 *    · 시험 대상    `trialPlanOf`(전날 결정 + 전날 운영 증거 + 이어진 계획) → TRIAL / RETEST / REPROVE
 *    · 다음 칸      `judgeNextPreflight`(D3~D100 한 함수) — 기회 · 처리량 · 지연 · Persona · 비용 · 러너
 *    · 운영 증거    `judgeStageEvidence`(조항 ⑦ source-slot-v1 도장 포함)
 *    · 품질        자동 READY 감사 정본 — 확정 결함 · 글 유실 · 재시도 가능 실패 · 판정 시한 초과(6h)
 *    · 비용        장부 정본의 막는 코드 — LEDGER_ERROR · SETTLE_ERROR · UNSETTLED_OVERRUN · DAILY_EXHAUSTED
 *    · 오류        발행·공급 job 의 최근 회차 실패(launchd 종료 값 + 회차 기록)
 *
 * 🔴 **지운 입력 (2026-09-30)** — 14일 준비도(`stageVerdicts`/`safeStageFor`) · 하루 시뮬레이션(`judgeOneDayCanary`) ·
 *    지속 승격(`judgePromotion` · `d100:readiness` 자식 프로세스) · env 단계(`SORAN_RELEASE_STAGE`)와 env 천장
 *    (`SORAN_CAPACITY_STAGE`) · canary/window 허가. **현재 단계의 입력원은 StageDecision 하나다.**
 *
 * 🔴 **브레이크의 두 모양.**
 *    · 신호가 `bad`     → **감속**: 지속 공개 단계의 바로 아래 칸. 승격·시험·증명일 없음.
 *    · 신호가 `unknown` → **유지**: 승격·시험·증명일만 막는다. 지금 단계를 지킨다.
 *
 * 🔴 **controller 실패는 지금 공개 단계를 지킨다(fail-closed · keep current).**
 *
 * 🔴 순수 함수다 — DB · 파일 · 시각 조회 0.
 */
import {
  RUNTIME_STAGES, SAFEST_STAGE, stageRank, profileOf, RELEASE_ENV, CAPACITY_ENV,
  type RuntimeStage,
} from './scale-profile'
import { planStageDecision, preparedStageOf } from './stage-ladder'
import {
  DECISION_WRITER, STAGE_DECISION_VERSION, validateStoredDecision, isLegacyDecision,
  type StageDecision, type ValidatedStageDecision,
} from './stage-decision-contract'
import { PROOF_DATE_ENV, PROOF_ENV_KEYS, PROOF_STAGE_ENV } from './stage-proof-day'
import { STAGE_DECISION_MARK_ENV } from './scale-runtime'
import type { ConsumeOutcome } from './stage-decision-store'
import type { StageEvidenceVerdict, TrialPlan } from './stage-evidence'
import type { PreflightVerdict } from './stage-ladder-generic'
import type { Health } from './ops-status'

/** 🔴 브레이크가 보는 축 */
export const SIGNAL_AXES = ['quality', 'cost', 'errors'] as const
export type SignalAxis = (typeof SIGNAL_AXES)[number]

export type HealthSignal = {
  axis: SignalAxis
  health: Health
  reasons: readonly string[]
}

/** 🔴 바로 아래 칸 — `nextStage` 의 거울(러너 단계 위). d1 아래는 없다 */
export function previousStage(s: RuntimeStage): RuntimeStage {
  const i = RUNTIME_STAGES.indexOf(s)
  return i <= 0 ? SAFEST_STAGE : RUNTIME_STAGES[i - 1]!
}

const lower = (a: RuntimeStage, b: RuntimeStage): RuntimeStage => (stageRank(a) <= stageRank(b) ? a : b)

/**
 * 🔴 **증명된 지속 공개 단계 — StageDecision 하나에서만 온다** (2026-09-30).
 *    · 전날 결정이 없다 → 바닥(d1). env(`SORAN_RELEASE_STAGE`)를 읽지 않는다
 *    · 전날 결정이 옛 판(v4 · source-slot-v1 이전) → 바닥(d1) — 옛 계약의 단계는 근거가 아니다(재증명)
 *    · 전날이 TRIAL 이고 그날 운영 증거가 PASS 면 **그 시험 단계**(증명됐다 · PR3 KEEP)
 *    · 전날이 TRIAL 인데 PASS 가 아니면 그 **시험 기반**
 *    · 그 밖(HOLD · PREPARE · REPROVE)이면 전날 공개 단계
 */
export function sustainedReleaseOf(
  prev: ValidatedStageDecision | null, evidence: StageEvidenceVerdict | null = null,
): RuntimeStage {
  if (prev === null || isLegacyDecision(prev)) return SAFEST_STAGE
  if (prev.state === 'TRIAL' && prev.transition !== null && prev.transition.kind === 'TRIAL') {
    const passed = evidence !== null && evidence.verdict === 'PASS'
      && evidence.kstDate === prev.kstDate && evidence.stage === prev.release
    return passed ? prev.release : prev.transition.trialBase
  }
  return prev.release
}

export type ControllerInputs = {
  kstDate: string
  decidedAt: string
  previousDecision: ValidatedStageDecision | null
  /** 🔴 전날 운영 증거 — PASS 가 아니면(FAIL · 모름 · 없음) 올라가지 않고 같은 단계를 다시 시험한다 */
  previousEvidence?: StageEvidenceVerdict | null
  /** 🔴 전날(브레이크 날)이 이은 계획 — `trialPlanThrough` 로 되짚은 값 */
  carriedPlan?: TrialPlan | null
  /** 🔴 시험 대상의 preflight(`judgeNextPreflight`) — 모든 단계 같은 관문 */
  nextPreflight: PreflightVerdict | null
  publishedToday: number
  signals: readonly HealthSignal[]
}

export type ControllerResult = {
  decision: StageDecision
  /** 🔴 브레이크가 무엇을 했는가 — 없으면 `none` */
  brake: 'none' | 'slowdown' | 'holdUnknown' | 'controllerFailure'
  sustained: RuntimeStage
}

/**
 * 🔴 **controller 실패 — 지금 공개 단계를 지킨다.** 상태는 HOLD, 전이 근거 없음. 이유를 남긴다.
 */
export function holdAtCurrent(input: {
  kstDate: string; decidedAt: string; current: RuntimeStage; reason: string
}): StageDecision {
  const release = input.current
  return {
    kstDate: input.kstDate, capacity: release, release, state: 'HOLD',
    reasons: [
      `🔴 controller 입력 실패 — 지금 공개 단계 ${release} 를 지킨다(fail-closed · 올리지도 내리지도 않는다)`,
      `🔴 ${input.reason}`,
    ],
    blocks: [], dayPinned: false, supply: null, decidedAt: input.decidedAt,
    contractVersion: STAGE_DECISION_VERSION, decidedBy: DECISION_WRITER, transition: null,
  }
}

/** 🔴 브레이크가 정한 공개로 결정을 닫는다 — 시험·증명일 없음 */
function finishHold(d: StageDecision, release: RuntimeStage, sustained: RuntimeStage, publishedToday: number,
  reasons: string[]): StageDecision {
  let rel = release
  let dayPinned = d.dayPinned
  // 오늘 이미 낸 편수가 낮춘 단계의 하루 목표를 넘으면 오늘은 지속 단계를 고정한다(이미 낸 것이 상한 초과가 된다)
  if (stageRank(rel) < stageRank(sustained) && publishedToday > profileOf(rel).dailyTarget) {
    reasons.push(`🔴 오늘 이미 ${publishedToday}건 냈다 — ${rel} 로 내리면 상한 초과다. 오늘은 ${sustained} 를 고정한다`)
    rel = sustained
    dayPinned = true
  }
  const capacity = preparedStageOf(rel)
  const state = stageRank(capacity) > stageRank(rel) ? 'PREPARE' as const : 'HOLD' as const
  return { ...d, capacity, release: rel, state, transition: null, dayPinned, reasons }
}

/**
 * 🔴 **하루 결정.** 사다리를 먼저 부르고, 운영 신호 브레이크를 그 위에 얹는다.
 *    브레이크는 **내리거나 붙잡기만** 한다 — 어떤 경우에도 사다리보다 높게 올리지 않는다.
 */
export function decideStage(i: ControllerInputs): ControllerResult {
  const sustained = sustainedReleaseOf(i.previousDecision, i.previousEvidence ?? null)
  const planned = planStageDecision({
    kstDate: i.kstDate, sustainedRelease: sustained, previousDecision: i.previousDecision,
    previousEvidence: i.previousEvidence ?? null, carriedPlan: i.carriedPlan ?? null,
    nextPreflight: i.nextPreflight, publishedToday: i.publishedToday, decidedAt: i.decidedAt,
  })
  const bad = i.signals.filter((s) => s.health === 'bad')
  const unknown = i.signals.filter((s) => s.health === 'unknown')
  if (bad.length > 0) {
    const target = lower(planned.release, previousStage(sustained))
    const reasons = [
      ...planned.reasons,
      ...bad.map((s) => `🔴 감속(${s.axis}): ${s.reasons.join(' · ') || '나쁨'}`),
      `🔴 운영 신호 ${bad.map((s) => s.axis).join('·')} 가 나쁘다 — 시험·증명일 없이 ${sustained} → ${target}`,
    ]
    return { decision: finishHold(planned, target, sustained, i.publishedToday, reasons), brake: 'slowdown', sustained }
  }
  /**
   * 🔴 모르는 신호로 올리지 않는다. REPROVE(증명일)도 되돌린다 — 품질·비용·오류를 모르는 날 자동 target 을 앞세우지 않는다.
   */
  if (unknown.length > 0 && (planned.state === 'TRIAL' || planned.state === 'REPROVE')) {
    const reasons = [
      ...planned.reasons,
      ...unknown.map((s) => `⬚ 모름(${s.axis}): ${s.reasons.join(' · ') || '관측 없음'}`),
      `🔴 ${planned.state} 를 되돌린다 — 운영 신호 ${unknown.map((s) => s.axis).join('·')} 를 확인하지 못했다. ${sustained} 를 지킨다`,
    ]
    return { decision: finishHold(planned, sustained, sustained, i.publishedToday, reasons), brake: 'holdUnknown', sustained }
  }
  if (unknown.length > 0) {
    return {
      decision: { ...planned, reasons: [...planned.reasons, ...unknown.map((s) => `⬚ 모름(${s.axis}): ${s.reasons.join(' · ') || '관측 없음'}`)] },
      brake: 'none', sustained,
    }
  }
  return { decision: planned, brake: 'none', sustained }
}

/** 🔴 저장 전 검증 — 정본 validator 한 벌. 통과 못 하면 저장하지 않는다 */
export function validateForToday(d: StageDecision): ReturnType<typeof validateStoredDecision> {
  return validateStoredDecision({ row: d, expectKstDate: d.kstDate })
}

// ─────────────────────────────────────────────────────────
// 🔴 consumer — 러너가 실제로 읽는 env 로 옮긴다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **결정을 러너 env 로 옮긴다** — 결정이 유일한 단계 입력이다(2026-09-30).
 *    · 결정 OK      → 공개 = 결정의 `release`(TRIAL 이면 시험 단계 그대로) · 준비 눈금 = `capacity`
 *                     · 증명일(TRIAL · REPROVE)이면 증명일 두 칸(`stage-proof-day`), 아니면 빈 값
 *    · safest      → 결정이 없거나 깨졌다 · controller flag OFF(kill switch) → d1
 * 🔴 **legacy(아무것도 넣지 않아 env 파일의 단계가 이기던 경로)는 지웠다** (2026-09-30 · Lane A).
 *    그 경로에서는 `.env.local` · GitHub Variables 의 손으로 적은 단계가 결정을 대신했다 — 두 번째 권위다.
 * 🔴 결정 OK 일 때만 **표식**(`STAGE_DECISION_MARK_ENV` = 결정의 KST 날짜)을 넣는다. 표식 없는 단계 칸은
 *    `scale-runtime.decisionStageEnv` 가 읽지 않는다(= d1) — safest 에 표식을 붙이지 않아도 결과는 같다.
 * 🔴 **canary · window 는 없다** — 앞판은 TRIAL 을 "기반 + canary 허가" 로 옮겨 러너가 14일 준비도로
 *    다시 깎았다(09-29 TRIAL d3 → 러너 d1). 이제 러너는 결정의 단계를 그대로 쓴다.
 */
export function consumerEnvOf(o: ConsumeOutcome): Record<string, string> {
  const blankProof = Object.fromEntries(PROOF_ENV_KEYS.map((k) => [k, '']))
  if (o.ok) {
    const proof = o.decision.state === 'TRIAL' || o.decision.state === 'REPROVE'
      ? { [PROOF_STAGE_ENV]: o.decision.release, [PROOF_DATE_ENV]: o.decision.kstDate }
      : blankProof
    return {
      [RELEASE_ENV]: o.decision.release,
      [CAPACITY_ENV]: o.decision.capacity,
      [STAGE_DECISION_MARK_ENV]: o.decision.kstDate,
      ...proof,
    }
  }
  return { [RELEASE_ENV]: SAFEST_STAGE, [CAPACITY_ENV]: SAFEST_STAGE, [STAGE_DECISION_MARK_ENV]: '', ...blankProof }
}

// ─────────────────────────────────────────────────────────
// 🔴 신호 만들기 — 정본 값을 그대로 옮긴다. 새 문턱값 0
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **품질** — 자동 READY 감사 정본이 자동 회차를 닫는 네 가지 중 하나라도 있으면 나쁘다.
 *    (확정 결함 yes · 글 유실 · 재시도 가능 감사 실패 · 판정 시한 초과) 못 읽었으면 모른다.
 */
export function qualitySignalOf(c: {
  confirmedDefects: number; missingPosts: number; retryableFailures: number; overdueAudits: number
} | null, readError: string | null = null): HealthSignal {
  if (c === null) return { axis: 'quality', health: 'unknown', reasons: [`감사 표를 읽지 못했다 — ${readError ?? '이유 모름'}`] }
  const reasons: string[] = []
  if (c.confirmedDefects > 0) reasons.push(`확정 결함 ${c.confirmedDefects}건`)
  if (c.missingPosts > 0) reasons.push(`글이 사라진 자동 발행 ${c.missingPosts}건`)
  if (c.retryableFailures > 0) reasons.push(`재시도 가능 감사 실패 ${c.retryableFailures}건`)
  if (c.overdueAudits > 0) reasons.push(`판정 시한 초과 감사 ${c.overdueAudits}건`)
  return { axis: 'quality', health: reasons.length > 0 ? 'bad' : 'ok', reasons }
}

/** 🔴 **비용** — 장부 판정(`judgeCost`)을 합친다. 나쁨이 이기고, 나쁨이 없을 때 모름이 이긴다 */
export function costSignalOf(parts: readonly { name: string; health: Health; reasons: readonly string[] }[]): HealthSignal {
  const bad = parts.filter((p) => p.health === 'bad')
  if (bad.length > 0) return { axis: 'cost', health: 'bad', reasons: bad.map((p) => `${p.name}: ${p.reasons.join(' · ')}`) }
  const unk = parts.filter((p) => p.health === 'unknown')
  if (unk.length > 0) return { axis: 'cost', health: 'unknown', reasons: unk.map((p) => `${p.name}: ${p.reasons.join(' · ')}`) }
  return { axis: 'cost', health: 'ok', reasons: [] }
}

/**
 * 🔴 **오류** — 발행·공급 job 의 최근 회차. 실패(`true`)면 나쁘다, 모르면(`null` · load 안 됨) 모른다.
 *    load 가 안 된 job 은 "오류" 가 아니라 "돌지 않는다" 이지만, 그 상태로 승격하지 않는다(모름).
 */
export function errorSignalOf(jobs: readonly { label: string; loaded: boolean; failing: boolean | null }[]): HealthSignal {
  const bad = jobs.filter((j) => j.loaded && j.failing === true)
  if (bad.length > 0) return { axis: 'errors', health: 'bad', reasons: bad.map((j) => `${j.label} 최근 회차 실패`) }
  const unk = jobs.filter((j) => !j.loaded || j.failing === null)
  if (unk.length > 0) {
    return {
      axis: 'errors', health: 'unknown',
      reasons: unk.map((j) => `${j.label} ${j.loaded ? '최근 회차 성패 모름' : 'load 되어 있지 않다'}`),
    }
  }
  return { axis: 'errors', health: 'ok', reasons: [] }
}
