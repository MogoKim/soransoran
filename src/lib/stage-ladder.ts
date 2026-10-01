/**
 * 🔴 **단계 결정 — 한 사다리 · 한 관문** (2026-09-24 · 2026-09-30 source-slot-v1 단순화)
 *
 *   정본 계약(Sep 30): `D1 → D3 → D5 → D10 → D20 → D30 → D50 (→ D100)` 자동 사다리.
 *   · PASS + 다음 칸 preflight 초록 → 다음 증명일에 그 칸을 시험한다(TRIAL)
 *   · FAIL · UNKNOWN → 같은 단계를 다시 시험한다(RETEST) — 날짜로 기다리지 않는다
 *   · 시험이 열리지 않은 날은 지금 단계를 **증명일로 다시 돈다**(REPROVE) — 바닥(d1) 제외
 *   · 단계가 바꾸는 것은 처리량과 필요 용량뿐이다 — 콘텐츠 선택 철학(`judgeSlotRelease`)은 같다
 *
 * 🔴 **이 파일이 지운 옛 권위 (2026-09-30)**
 *   · `judgePromotion`(d100-capacity) → SUSTAIN — 7/14일 **연속 달력 일수** + 14일 완성 재고로 오르던 두 번째 승격 길
 *   · `stageVerdicts`/`safeStageFor` 14일 준비도 감속 — 14일 완성 글 재고를 지속 성공으로 보던 규칙
 *   · `judgeOneDayCanary` 하루 시뮬레이션 관문(D3~D10) — 기존 완성 글 큐로 하루를 흉내 내던 판정
 *   · `checkProvenance` 의 `PROVENANCE_CURRENT/NEXT` — 단계 출처가 둘(env · 결정)이라 생긴 가드
 *   · 승인 천장(`SORAN_CAPACITY_STAGE` env)을 넘는 공개를 막던 `CEILING` — 천장은 이제 비용 preflight 가 정한다
 *
 * 🔴 **capacity 칸의 뜻** — "다음에 증명할 단계"(= 공개 단계의 다음 칸). 공급(JIT)이 다음 증명일 슬롯을
 *    준비하는 눈금이다. 공개가 이것을 넘지 못한다(저장 검증). 사람이 올리는 값이 아니다.
 *
 * 🔴 순수 함수다 — DB · 파일 · 시각 조회 0.
 */
import {
  SAFEST_STAGE, stageRank, profileOf,
  type RuntimeStage,
} from './scale-profile'
import {
  STAGE_DECISION_VERSION, DECISION_WRITER, TRANSITION_STATES, BLOCK_CODES,
  SUPPLY_EXCLUDE_REASONS, previousKstDate, nextStage, kstDateOfIso, isCalendarDate,
  validateStoredDecision, REQUIRED_KEYS, TRANSITION_FATAL_BLOCKS,
  type DecisionWriter, type TransitionState, type BlockCode, type StageBlock,
  type SupplySignal, type TransitionProvenance, type StageDecision,
  type ValidatedStageDecision, type ValidateResult,
} from './stage-decision-contract'
import { trialPlanOf, evidenceReasonOf, type StageEvidenceVerdict, type TrialPlan } from './stage-evidence'
import { trialBlocks, type PreflightVerdict } from './stage-ladder-generic'

/**
 * 🔴 **계약 정의는 `stage-decision-contract` 하나다** (2026-09-24 7차) — 호출부 호환을 위해 그대로 재수출한다.
 */
export {
  STAGE_DECISION_VERSION, DECISION_WRITER, TRANSITION_STATES, BLOCK_CODES,
  SUPPLY_EXCLUDE_REASONS, previousKstDate, nextStage, kstDateOfIso, isCalendarDate,
  validateStoredDecision, REQUIRED_KEYS, TRANSITION_FATAL_BLOCKS,
}
export type {
  DecisionWriter, TransitionState, BlockCode, StageBlock, SupplySignal,
  TransitionProvenance, StageDecision, ValidatedStageDecision, ValidateResult,
}

export type StageInputs = {
  kstDate: string
  /** 🔴 증명된 지속 공개 단계 — `sustainedReleaseOf`(전날 결정 · 전날 증거 · 계약 판)가 정한다 */
  sustainedRelease: RuntimeStage
  /**
   * 🔴 **바로 전 KST 날짜의 저장된 결정 — `ValidatedStageDecision` 만 받는다.**
   *    검증을 지나지 않은 값은 타입이 막는다(검증 로직을 여기 복제하지 않는다).
   */
  previousDecision: ValidatedStageDecision | null
  /** 🔴 전날 운영 증거(`judgeStageEvidence` · 조항 ⑦ 포함). 없으면 모른다(= PASS 아님) */
  previousEvidence?: StageEvidenceVerdict | null
  /** 🔴 전날(브레이크 날)이 이은 계획 — controller 가 저장된 결정·증거로 되짚은 값(`trialPlanThrough`) */
  carriedPlan?: TrialPlan | null
  /**
   * 🔴 **시험 대상의 preflight** — `judgeNextPreflight`(D3~D100 한 함수). 시험 대상이 있을 때 반드시 그 단계 것이어야 한다.
   */
  nextPreflight: PreflightVerdict | null
  publishedToday: number
  supply?: SupplySignal
  decidedAt: string
}

/** 🔴 공개 단계의 다음 칸 — "다음에 증명할 단계" 이자 공급이 준비하는 눈금. 맨 위면 자기 자신 */
export const preparedStageOf = (release: RuntimeStage): RuntimeStage => nextStage(release) ?? release

/**
 * 🔴 **전날 결정에서 시험 계획을 꺼낸다 — 못 꺼내면 `null` 이고 시험은 열리지 않는다.**
 *    첫 controller 실행일(전날 결정 없음)에는 아무도 판단하지 않은 기반이므로 열지 않는다(fail-closed).
 */
function authoritativeTrialPlan(input: StageInputs, out: StageBlock[]): TrialPlan | null {
  const prev = input.previousDecision
  const want = previousKstDate(input.kstDate)
  if (want === null) {
    out.push({ code: 'PROVENANCE_PREVIOUS', reason: `결정 날짜가 달력에 없다 — "${input.kstDate}"` })
    return null
  }
  if (prev === null) {
    out.push({ code: 'PROVENANCE_PREVIOUS', reason: `${want} 결정이 없다 — 🔴 시험을 열지 않는다(기반을 아무도 판단하지 않았다)` })
    return null
  }
  if (prev.kstDate !== want) {
    out.push({
      code: 'PROVENANCE_PREVIOUS',
      reason: `이전 결정 날짜 ${prev.kstDate} ≠ 바로 전날 ${want} — 이틀 전 결정을 기반으로 쓰지 않는다`,
    })
    return null
  }
  const plan = trialPlanOf(prev, input.previousEvidence ?? null, input.carriedPlan ?? null)
  if (plan === null) {
    out.push({
      code: 'PROVENANCE_PREVIOUS',
      reason: `${want} ${prev.release} 는 운영 PASS 가 아니다 — 🔴 증거 없이 올라갈 칸이 없다(지금 단계를 다시 증명한다)`,
    })
  }
  return plan
}

/**
 * 🔴 **한 결정.** 시험(TRIAL) 은 계획 + 그 대상 preflight PASS + 첫 슬롯 전일 때만 · 아니면 지금 단계 REPROVE/HOLD.
 */
export function planStageDecision(input: StageInputs): StageDecision {
  const base = {
    kstDate: input.kstDate,
    supply: input.supply ?? null,
    decidedAt: input.decidedAt,
    contractVersion: STAGE_DECISION_VERSION,
    decidedBy: DECISION_WRITER as string,
  } as const
  const blocks: StageBlock[] = []
  const plan = authoritativeTrialPlan(input, blocks)
  const reasons: string[] = blocks.map((b) => `🔴 ${b.code}: ${b.reason}`)
  if (input.previousEvidence !== undefined && input.previousEvidence !== null) {
    reasons.push(evidenceReasonOf(input.previousEvidence))
  }

  const sustained = input.sustainedRelease
  let release: RuntimeStage = sustained
  let state: TransitionState = 'HOLD'
  let transition: TransitionProvenance | null = null

  if (plan !== null) {
    /**
     * 🔴 **계획의 기반은 지금 지속 단계여야 한다.** 다르면(예: 계약 경계로 지속 단계가 바닥으로 내려갔는데
     *    옛 계획이 d3 을 기반으로 삼는다) 그 계획으로 두 칸을 뛰지 않는다.
     */
    if (plan.base !== sustained) {
      blocks.push({ code: 'PROVENANCE_STAGE', reason: `시험 기반 ${plan.base} ≠ 지속 단계 ${sustained} — 그 계획을 쓰지 않는다` })
      reasons.push(`🔴 PROVENANCE_STAGE: 시험 기반 ${plan.base} ≠ 지속 단계 ${sustained}`)
    } else {
      const gate = trialBlocks({
        target: plan.target, kstDate: input.kstDate, runAt: input.decidedAt, preflight: input.nextPreflight,
      })
      if (gate.length > 0) {
        blocks.push(...gate)
        reasons.push(...gate.map((b) => `🔴 ${b.code}: ${b.reason}`))
      } else {
        release = plan.target
        state = 'TRIAL'
        transition = {
          kind: 'TRIAL', trialBase: plan.base,
          previousKstDate: input.previousDecision?.kstDate ?? '',
          target: plan.target, basis: plan.basis,
        }
        if (plan.basis === 'RETEST') reasons.push(`🔴 RETEST — 전날 ${plan.target} 가 운영 PASS 가 아니다. 같은 단계를 다시 시험한다`)
        reasons.push(`🟢 ${plan.target} 증명일 — preflight PASS(${plan.basis})`)
      }
    }
  }

  /**
   * ── 시험이 열리지 않은 날 ──
   * 🔴 지금 단계를 **증명일로 다시 돈다**(REPROVE) — 전날 결정이 바로 전날 것이고 바닥 위일 때.
   *    공개는 올라가지 않는다. 그날 자동 target 이 슬롯을 먼저 채워 내일 판정할 증거를 만든다.
   */
  let dayPinned = false
  if (state !== 'TRIAL') {
    const prev = input.previousDecision
    if (prev !== null && prev.kstDate === previousKstDate(input.kstDate) && release !== SAFEST_STAGE) {
      state = 'REPROVE'
      reasons.push(`🟢 REPROVE — 공개 ${release} 를 증명일로 다시 돈다(자동 target 먼저)`)
    }
    /** 🔴 오늘 이미 그 단계 목표보다 많이 냈으면 그 단계를 낮추지 않는다 — 이미 낸 것이 상한 초과가 된다 */
    if (input.publishedToday > profileOf(release).dailyTarget) dayPinned = true
  }

  const capacity = preparedStageOf(release)
  if (state === 'HOLD' && stageRank(capacity) > stageRank(release)) {
    state = 'PREPARE'
    reasons.push(`🟢 PREPARE — 공개 ${release} · 다음 증명 ${capacity} 의 기회를 준비한다(JIT)`)
  }
  if (reasons.length === 0) reasons.push(`유지 — ${release}`)
  return { ...base, capacity, release, state, blocks, dayPinned, reasons, transition }
}

/** 🔴 아무것도 읽지 못했을 때 */
export function safestDecision(kstDate: string, decidedAt: string): StageDecision {
  return {
    kstDate, capacity: SAFEST_STAGE, release: SAFEST_STAGE, state: 'HOLD',
    dayPinned: false, blocks: [], supply: null, decidedAt,
    contractVersion: STAGE_DECISION_VERSION, decidedBy: DECISION_WRITER, transition: null,
    reasons: [`🔴 단계 입력을 읽지 못했다 — 가장 안전한 ${SAFEST_STAGE} 로 둔다`],
  }
}
