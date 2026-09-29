/**
 * 🔴 **단계 controller — 사다리(`planStageDecision`) 위에 운영 신호 브레이크를 얹는다** (2026-09-28)
 *
 * 🔴 **새 문턱값을 만들지 않는다.** 판정은 전부 정본이 한다:
 *    · 재고        `stageVerdicts` → 사다리 안의 `safeStageFor`        (이미 사다리가 감속한다)
 *    · 하루 시험    `judgeOneDayCanary`  → TRIAL
 *    · 지속 승격    `judgePromotion`     → SUSTAIN (승인 천장 안에서만 · `RELEASE_STAGES` 는 d1~d10)
 *    · 품질        자동 READY 감사 정본 — 확정 결함 · 글 유실 · 재시도 가능 실패 · 판정 시한 초과(6h)
 *    · 비용        장부 정본의 막는 코드 — LEDGER_ERROR · SETTLE_ERROR · UNSETTLED_OVERRUN · DAILY_EXHAUSTED
 *    · 오류        발행·공급 job 의 최근 회차 실패(launchd 종료 값 + 회차 기록)
 *
 * 🔴 **브레이크의 두 모양.**
 *    · 신호가 `bad`     → **감속**: 지속 공개 단계의 바로 아래 칸(`nextStage` 의 거울). 승격·시험 없음.
 *    · 신호가 `unknown` → **유지**: 승격·시험만 막는다. 지금 단계를 지킨다(모르는 것으로 내리지도 올리지도 않는다).
 *    감속 폭(한 칸)은 사다리가 올릴 때 쓰는 폭(한 칸)과 같다 — 새 숫자가 아니다.
 *
 * 🔴 **controller 실패는 지금 공개 단계를 지킨다(fail-closed · keep current).**
 *    입력을 못 읽으면 `holdAtCurrent` — 지속 공개 단계 그대로의 HOLD 결정이다. 사다리 정본의
 *    "판정이 하나도 없으면 d1"(`planStageDecision`) 경로로 **떨어뜨리지 않는다** — 그 규칙은
 *    "새 날에 아무 판정도 없는 상태"를 위한 것이고, controller 가 읽기에 실패한 날은 그 상태가 아니다.
 *    그래서 재고 판정을 못 읽은 경우는 사다리에 빈 `verdicts` 를 넘기지 않고 여기서 멈춘다.
 *
 * 🔴 순수 함수다 — DB · 파일 · 시각 조회 0.
 */
import {
  PROFILES, RELEASE_STAGES, SAFEST_STAGE, safeStageFor, stageRank,
  type ReleaseStage, type StageVerdict,
} from './scale-profile'
import { planStageDecision, type DatedCanary } from './stage-ladder'
import {
  DECISION_WRITER, STAGE_DECISION_VERSION, validateStoredDecision,
  type StageDecision, type ValidatedStageDecision,
} from './stage-decision-contract'
import { PUBLISH_ONLY_KEYS } from './stage-source'
import { CANARY_DATE_ENV, CANARY_STAGE_ENV } from './release-canary'
import { PROOF_DATE_ENV, PROOF_ENV_KEYS, PROOF_STAGE_ENV } from './stage-proof-day'
import type { ConsumeOutcome } from './stage-decision-store'
import type { PromotionVerdict } from './d100-capacity'
import type { StageEvidenceVerdict } from './stage-evidence'
import type { Health } from './ops-status'

/** 🔴 브레이크가 보는 축 — 재고는 사다리가 이미 본다 */
export const SIGNAL_AXES = ['quality', 'cost', 'errors'] as const
export type SignalAxis = (typeof SIGNAL_AXES)[number]

export type HealthSignal = {
  axis: SignalAxis
  health: Health
  reasons: readonly string[]
}

/** 🔴 바로 아래 칸 — `nextStage` 의 거울. d1 아래는 없다 */
export function previousStage(s: ReleaseStage): ReleaseStage {
  const i = RELEASE_STAGES.indexOf(s)
  return i <= 0 ? SAFEST_STAGE : RELEASE_STAGES[i - 1]!
}

const lower = (a: ReleaseStage, b: ReleaseStage): ReleaseStage => (stageRank(a) <= stageRank(b) ? a : b)

/**
 * 🔴 **지속 공개 단계의 원천.**
 *    · 전날 결정이 없으면 env(`SORAN_RELEASE_STAGE`) — legacy 가 지금 돌고 있는 값이다
 *    · 전날이 TRIAL 이면 그 **시험 기반** — 시험은 그날 하루였다
 *    · 그 밖(SUSTAIN · HOLD · PREPARE)이면 전날 공개 단계 — 그것이 지금 돌고 있는 값이다
 */
export function sustainedReleaseOf(prev: ValidatedStageDecision | null, envRelease: ReleaseStage): ReleaseStage {
  if (prev === null) return envRelease
  if (prev.state === 'TRIAL' && prev.transition !== null && prev.transition.kind === 'TRIAL') {
    return prev.transition.trialBase
  }
  return prev.release
}

export type ControllerInputs = {
  kstDate: string
  decidedAt: string
  /** env 의 지속 공개 단계 — 전날 결정이 없을 때만 쓴다 */
  envRelease: ReleaseStage
  /** 🔴 사람이 승인한 천장(`SORAN_CAPACITY_STAGE`) — 이 controller 가 올리지 않는다 */
  authorizedCeiling: ReleaseStage
  previousDecision: ValidatedStageDecision | null
  /**
   * 🔴 **전날 운영 증거** (2026-09-29 P0) — 사다리가 시험 대상·기반을 이 값과 전날 결정으로 다시 정한다.
   *    PASS 가 아니면(FAIL · 모름 · 없음) 올라가지 않고 같은 단계를 다시 시험한다.
   */
  previousEvidence?: StageEvidenceVerdict | null
  /** 🔴 정본 `stageVerdicts` — 비어 있으면 **읽기 실패**로 본다(아래 `decideStage` 참고) */
  verdicts: readonly StageVerdict[]
  daily: DatedCanary | null
  promotion: PromotionVerdict | null
  publishedToday: number
  signals: readonly HealthSignal[]
}

export type ControllerResult = {
  decision: StageDecision
  /** 🔴 브레이크가 무엇을 했는가 — 없으면 `none` */
  brake: 'none' | 'slowdown' | 'holdUnknown' | 'controllerFailure'
  sustained: ReleaseStage
}

/**
 * 🔴 **controller 실패 — 지금 공개 단계를 지킨다.** 천장보다 높을 수는 없다(검증기 불변식).
 *    상태는 HOLD, 전이 근거 없음. 이유를 남긴다.
 */
export function holdAtCurrent(input: {
  kstDate: string; decidedAt: string; current: ReleaseStage; ceiling: ReleaseStage; reason: string
}): StageDecision {
  const release = lower(input.current, input.ceiling)
  return {
    kstDate: input.kstDate, capacity: input.ceiling, release, state: 'HOLD',
    reasons: [
      `🔴 controller 입력 실패 — 지금 공개 단계 ${release} 를 지킨다(fail-closed · 올리지도 내리지도 않는다)`,
      `🔴 ${input.reason}`,
    ],
    blocks: [], dayPinned: false, supply: null, decidedAt: input.decidedAt,
    contractVersion: STAGE_DECISION_VERSION, decidedBy: DECISION_WRITER, transition: null,
  }
}

/** 🔴 공개가 정해진 뒤의 정본 규칙 둘 — 사다리와 같은 순서·같은 규칙 */
function finishHold(d: StageDecision, release: ReleaseStage, sustained: ReleaseStage, publishedToday: number,
  reasons: string[]): StageDecision {
  let rel = release
  let dayPinned = d.dayPinned
  // 사다리 정본: 오늘 이미 낸 편수가 낮춘 단계의 하루 목표를 넘으면 오늘은 지속 단계를 고정한다
  if (stageRank(rel) < stageRank(sustained) && publishedToday > PROFILES[rel].dailyTarget) {
    reasons.push(`🔴 오늘 이미 ${publishedToday}건 냈다 — ${rel} 로 내리면 상한 초과다. 오늘은 ${sustained} 를 고정한다`)
    rel = lower(sustained, d.capacity)
    dayPinned = true
  }
  // 사다리 정본: 이미 승인된 천장이 공개보다 높으면 PREPARE(재고를 쌓는다)
  const state = stageRank(d.capacity) > stageRank(rel) ? 'PREPARE' as const : 'HOLD' as const
  return { ...d, release: rel, state, transition: null, dayPinned, reasons }
}

/**
 * 🔴 **하루 결정.** 사다리를 먼저 부르고, 운영 신호 브레이크를 그 위에 얹는다.
 *    브레이크는 **내리거나 붙잡기만** 한다 — 어떤 경우에도 사다리보다 높게 올리지 않는다.
 */
export function decideStage(i: ControllerInputs): ControllerResult {
  const sustained = lower(sustainedReleaseOf(i.previousDecision, i.envRelease), i.authorizedCeiling)
  if (i.verdicts.length === 0) {
    return {
      decision: holdAtCurrent({
        kstDate: i.kstDate, decidedAt: i.decidedAt, current: sustained, ceiling: i.authorizedCeiling,
        reason: '재고 판정(stageVerdicts)을 받지 못했다 — 빈 판정으로 사다리의 d1 경로에 떨어뜨리지 않는다',
      }),
      brake: 'controllerFailure', sustained,
    }
  }
  const planned = planStageDecision({
    kstDate: i.kstDate, sustainedRelease: sustained, authorizedCapacityCeiling: i.authorizedCeiling,
    verdicts: i.verdicts, daily: i.daily, previousDecision: i.previousDecision,
    previousEvidence: i.previousEvidence ?? null,
    promotion: i.promotion, publishedToday: i.publishedToday, decidedAt: i.decidedAt,
  })
  const bad = i.signals.filter((s) => s.health === 'bad')
  const unknown = i.signals.filter((s) => s.health === 'unknown')
  if (bad.length > 0) {
    const target = lower(planned.release, previousStage(sustained))
    const reasons = [
      ...planned.reasons,
      ...bad.map((s) => `🔴 감속(${s.axis}): ${s.reasons.join(' · ') || '나쁨'}`),
      `🔴 운영 신호 ${bad.map((s) => s.axis).join('·')} 가 나쁘다 — 승격·시험 없이 ${sustained} → ${target}`,
    ]
    return { decision: finishHold(planned, target, sustained, i.publishedToday, reasons), brake: 'slowdown', sustained }
  }
  if (unknown.length > 0 && (planned.state === 'TRIAL' || planned.state === 'SUSTAIN')) {
    // 🔴 모르는 신호로 올리지 않는다. 재고 감속(정본)은 그대로 둔다
    const keep = safeStageFor(sustained, i.verdicts).stage
    const reasons = [
      ...planned.reasons,
      ...unknown.map((s) => `⬚ 모름(${s.axis}): ${s.reasons.join(' · ') || '관측 없음'}`),
      `🔴 ${planned.state} 를 되돌린다 — 운영 신호 ${unknown.map((s) => s.axis).join('·')} 를 확인하지 못했다. ${keep} 를 지킨다`,
    ]
    return { decision: finishHold(planned, keep, sustained, i.publishedToday, reasons), brake: 'holdUnknown', sustained }
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
 * 🔴 **결정을 러너 env 로 옮긴다.** 러너(`original-post-auto-publish` · `supply-process`)는
 *    `loadEnvLocal()` 로 `.env.local` 을 읽되 **이미 있는 값은 덮지 않는다** — 그래서 실행 직전에
 *    이 값을 넣으면 러너 코드를 한 줄도 바꾸지 않고 결정이 적용된다.
 *
 *    · 결정 OK      → 공개·천장 = 결정 값 · 발행 전용 허가(canary·window)는 **빈 값**으로 막는다
 *                     (결정이 유일한 권한이다 — TRIAL 이 canary 의 자리다)
 *    · legacy      → 아무것도 넣지 않는다 (flag OFF · 기존 env/canary 경로 그대로)
 *    · safest      → 정본 `consumeStageDecision` 의 fallback: 결정이 없거나 깨졌다 → d1
 */
export function consumerEnvOf(o: ConsumeOutcome): Record<string, string> {
  // 🔴 증명일 두 칸(`stage-proof-day`)도 허가처럼 비운다 — 결정이 주지 않으면 비시험일이다
  const blankAuth = Object.fromEntries([...PUBLISH_ONLY_KEYS, ...PROOF_ENV_KEYS].map((k) => [k, '']))
  /**
   * 🔴 **자동 단계 증명일** (2026-09-29 마스터 결정) — TRIAL(재시험 포함) · SUSTAIN 날에는
   *    그 단계 목표 슬롯을 자동 target 이 먼저 채우도록 러너에 알린다(`proofDayOf` · `autoFirstNeeded`).
   *    HOLD · PREPARE 날과 fallback 은 빈 값 — 기존 human/auto 공정성 그대로다.
   */
  const proofOf = (d: { release: string; kstDate: string }): Record<string, string> =>
    ({ [PROOF_STAGE_ENV]: d.release, [PROOF_DATE_ENV]: d.kstDate })
  if (o.ok) {
    /**
     * 🔴 **TRIAL 이 canary 의 자리다 — 말로만이 아니라 값으로** (2026-09-29).
     *    앞판은 TRIAL 날에도 canary 를 빈 값으로 넣었다. 발행 러너(`resolvePublishScale`)는 canary·window
     *    허가가 있을 때만 준비도 감속을 건너뛰므로, 09-29 TRIAL d3 가 러너에서 "준비도 미달 → d1" 로
     *    내려앉아 09:30 에 "발행 0 / 1건" 으로 돌았다.
     *    러너의 canary 모양은 **"지속 단계 + 그날 하루 더 높은 단계"** 다(`resolvePublishScale` — 허가 단계가
     *    지금 단계보다 높을 때만 시험으로 켠다). 그래서 TRIAL 날에는 공개 = 시험 기반(`trialBase`),
     *    canary = (결정의 공개 단계 · 그 날짜) 로 넘긴다. 러너는 그 허가로 **회차마다** 정본
     *    `judgeOneDayCanary` 를 다시 돌린다(판정을 건너뛰지 않는다). window 는 여전히 빈 값이다.
     *    TRIAL 이 아닌 날(HOLD · PREPARE · SUSTAIN)은 공개 = 결정 값 · canary 도 빈 값이다.
     */
    const t = o.decision.transition
    if (o.decision.state === 'TRIAL' && t !== null && t.kind === 'TRIAL') {
      return {
        SORAN_RELEASE_STAGE: t.trialBase,
        SORAN_CAPACITY_STAGE: o.decision.capacity,
        ...blankAuth,
        [CANARY_STAGE_ENV]: o.decision.release,
        [CANARY_DATE_ENV]: o.decision.kstDate,
        ...proofOf(o.decision),
      }
    }
    return {
      SORAN_RELEASE_STAGE: o.decision.release,
      SORAN_CAPACITY_STAGE: o.decision.capacity,
      ...blankAuth,
      ...(o.decision.state === 'SUSTAIN' ? proofOf(o.decision) : {}),
    }
  }
  if (o.fallback === 'legacy') return {}
  return { SORAN_RELEASE_STAGE: SAFEST_STAGE, SORAN_CAPACITY_STAGE: SAFEST_STAGE, ...blankAuth }
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
