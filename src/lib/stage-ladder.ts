/**
 * 🔴 **단계 결정 — 한 사다리** `D1 → D3 → D5 → D10 → D20 → D30 → D50 (→ D100)`
 *
 *   · **올림**: 열린 단계에서 하루 판정(`judgeStageEvidence` — 수 + 결의 비율 + 무결성)이 `LADDER_RULE.consecutiveDays`
 *     일 연속 PASS 이고, 올라갈 칸의 관문(`judgeNextPreflight` — Persona · 발행 구조)이 PASS 인 날 한 칸 올린다.
 *   · **유지**: 그 밖의 모든 날. 어제 판정이 미달이어도 **아래 칸으로 되돌리지 않는다** — 실패한 하루가 다음 날 공개량을
 *     반으로 줄이면 사다리가 편수를 끌어내린다(10-29~11-12 사이 20편과 10편을 오갔다).
 *   · **내림**: 여기에는 없다. 품질·비용·오류 브레이크(`stage-controller.decideStage`)만 그날 하루 한 칸 낮춘다.
 *
 *   공개 단계 Dn 은 상한이다 — 그날 0..Dn 편을 낸다. 모자란 편수는 다음 날 빚이 아니고, 올림 조건을 못 채웠을 뿐이다.
 *   `capacity` 칸은 공개 단계의 다음 칸(공급이 준비하는 눈금)이다. 공개가 이것을 넘지 못한다(저장 검증).
 *
 * 🔴 순수 함수다 — DB · 파일 · 시각 조회 0.
 */
import { SAFEST_STAGE, stageRank, type RuntimeStage } from './scale-profile'
import {
  STAGE_DECISION_VERSION, DECISION_WRITER, TRANSITION_STATES, BLOCK_CODES,
  SUPPLY_EXCLUDE_REASONS, previousKstDate, nextStage, kstDateOfIso, isCalendarDate,
  validateStoredDecision, REQUIRED_KEYS, TRANSITION_FATAL_BLOCKS,
  type DecisionWriter, type TransitionState, type BlockCode, type StageBlock,
  type SupplySignal, type TransitionProvenance, type StageDecision,
  type ValidatedStageDecision, type ValidateResult,
} from './stage-decision-contract'
import { evidenceReasonOf, type StageEvidenceVerdict } from './stage-evidence'
import { preflightBlocks, forecastSupplyOf, type PreflightVerdict } from './stage-ladder-generic'
import { LADDER_RULE } from './ladder-table'

/** 계약 정의는 `stage-decision-contract` 하나다 — 호출부 호환을 위해 그대로 재수출한다 */
export {
  STAGE_DECISION_VERSION, DECISION_WRITER, TRANSITION_STATES, BLOCK_CODES,
  SUPPLY_EXCLUDE_REASONS, previousKstDate, nextStage, kstDateOfIso, isCalendarDate,
  validateStoredDecision, REQUIRED_KEYS, TRANSITION_FATAL_BLOCKS,
}
export type {
  DecisionWriter, TransitionState, BlockCode, StageBlock, SupplySignal,
  TransitionProvenance, StageDecision, ValidatedStageDecision, ValidateResult,
}

/** 한 날의 결정과 그날의 판정 — 올림 조건을 세는 단위 */
export type LadderDay = { decision: ValidatedStageDecision; evidence: StageEvidenceVerdict | null }

/**
 * 그 결정 행이 들고 있는 열린 단계. 브레이크로 낮춘 날은 `CERTIFIED` 칸이, 그 밖에는 공개 단계가 그것이다.
 * 올린 날(`TRIAL`)도 그날 판정과 무관하게 공개 단계다 — 미달이어도 되돌리지 않는다.
 */
export function openStageHeldBy(d: ValidatedStageDecision): RuntimeStage {
  return d.transition !== null && d.transition.kind === 'CERTIFIED' ? d.transition.certified : d.release
}

/**
 * 🔴 **열린 단계의 연속 통과 일수** — 전날부터 거꾸로 센다. 날짜가 이어지고 · 그날 공개가 열린 단계였고 ·
 *    그 날짜·그 단계의 판정이 PASS 인 날만 센다. 브레이크로 낮춘 날 · 미달 · 모름 · 빠진 날에서 끊긴다.
 *    저장하지 않고 매일 다시 센다 — 결정 행에 칸을 더하지 않기 위해서다.
 */
export function consecutivePassDays(
  kstDate: string, open: RuntimeStage, recent: readonly (LadderDay | null)[],
): number {
  let expect = previousKstDate(kstDate)
  let n = 0
  for (const day of recent) {
    if (expect === null || day === null) break
    const { decision: d, evidence: e } = day
    if (d.kstDate !== expect || d.release !== open) break
    if (e === null || e.verdict !== 'PASS' || e.kstDate !== d.kstDate || e.stage !== d.release) break
    n += 1
    expect = previousKstDate(expect)
  }
  return n
}

export type StageInputs = {
  kstDate: string
  /** 열린 단계 — `openStageOf`(전날·이틀 전 결정 행)가 정한다 */
  openStage: RuntimeStage
  /** 바로 전 KST 날짜의 저장된 결정 — 검증을 지난 값만 받는다. 인접하지 않으면 올리지 않는다 */
  previousDecision: ValidatedStageDecision | null
  /** 전날 판정 — 결정 행의 reasons 에 한 줄로 남긴다 */
  previousEvidence?: StageEvidenceVerdict | null
  /** 열린 단계의 연속 통과 일수(`consecutivePassDays`) */
  passDays: number
  /** 올라갈 칸(`nextStage(openStage)`)의 관문 판정 */
  nextPreflight: PreflightVerdict | null
  decidedAt: string
}

/** 공개 단계의 다음 칸 — 공급이 준비하는 눈금. 맨 위면 자기 자신 */
export const preparedStageOf = (release: RuntimeStage): RuntimeStage => nextStage(release) ?? release

export function planStageDecision(input: StageInputs): StageDecision {
  const open = input.openStage
  const prev = input.previousDecision
  const reasons: string[] = []
  const blocks: StageBlock[] = []
  if (input.previousEvidence !== undefined && input.previousEvidence !== null) {
    reasons.push(evidenceReasonOf(input.previousEvidence))
  }

  let release: RuntimeStage = open
  let state: TransitionState = 'HOLD'
  let transition: TransitionProvenance | null = null
  const up = nextStage(open)
  const need = LADDER_RULE.consecutiveDays
  // 인접한 전날 행이 아니면 연속을 셀 근거가 없다 — 올리지 않는다
  const adjacentPrev = prev !== null && prev.kstDate === previousKstDate(input.kstDate) ? prev : null

  if (up === null) {
    reasons.push(`유지 — ${open} 가 맨 위 단계다 (연속 통과 ${Math.min(input.passDays, need)}/${need}일)`)
  } else if (adjacentPrev === null || input.passDays < need) {
    reasons.push(`유지 — 공개 ${open} · ${up} 로 올리려면 ${need}일 연속 통과가 필요하다(지금 ${Math.max(0, input.passDays)}/${need}일)`)
  } else {
    const gate = preflightBlocks({ target: up, preflight: input.nextPreflight })
    if (gate.length > 0) {
      blocks.push(...gate)
      reasons.push(`유지 — ${open} 는 ${need}일 연속 통과했지만 ${up} 관문이 막혀 있다`)
      reasons.push(...gate.map((b) => `🔴 ${b.code}: ${b.reason}`))
    } else {
      release = up
      state = 'TRIAL'
      transition = { kind: 'TRIAL', trialBase: open, previousKstDate: adjacentPrev.kstDate, target: up, basis: 'PASS' }
      reasons.push(`🟢 올림 — ${open} ${need}일 연속 통과 · ${up} 관문 PASS → 오늘부터 공개 ${up}`)
    }
  }

  const capacity = preparedStageOf(release)
  if (state === 'HOLD' && stageRank(capacity) > stageRank(release)) state = 'PREPARE'
  return {
    kstDate: input.kstDate, capacity, release, state, blocks, reasons, transition,
    // 읽는 러너가 없는 칸이다. 저장 계약의 필수 키라 값만 채운다
    dayPinned: false,
    supply: forecastSupplyOf(input.nextPreflight),
    decidedAt: input.decidedAt,
    contractVersion: STAGE_DECISION_VERSION,
    decidedBy: DECISION_WRITER,
  }
}

/** 아무것도 읽지 못했을 때 */
export function safestDecision(kstDate: string, decidedAt: string): StageDecision {
  return {
    kstDate, capacity: SAFEST_STAGE, release: SAFEST_STAGE, state: 'HOLD',
    dayPinned: false, blocks: [], supply: null, decidedAt,
    contractVersion: STAGE_DECISION_VERSION, decidedBy: DECISION_WRITER, transition: null,
    reasons: [`🔴 단계 입력을 읽지 못했다 — 가장 안전한 ${SAFEST_STAGE} 로 둔다`],
  }
}
