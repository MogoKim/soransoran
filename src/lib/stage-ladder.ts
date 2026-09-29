/**
 * 🔴 **단계 결정 — 정본 넷을 묶기만 한다. 새 규칙도 새 숫자도 만들지 않는다** (2026-09-24 4차)
 *
 * 🔴 **capacity 는 이 판정이 올리는 값이 아니다** (마스터 지적).
 *   `authorizedCapacityCeiling` 은 **예산·운영 승인을 받은 천장**이다.
 *   · 공개 승격(SUSTAIN)이 천장을 올리지 않는다 — D3→D5 공개가 D10 승인을 뜻하지 않는다
 *   · `nextPreflight.ready` 도 천장을 만들지 않는다 — 그것은 **준비 진행률과 시험 가능 여부**다
 *   · 공개가 천장을 넘으려 하면 **공개를 막는다**(천장을 올리지 않는다)
 *
 * 🔴 **세 입력은 서로 다른 것이다.**
 *   · `sustainedRelease`          지속 운영으로 확정된 공개 단계
 *   · `authorizedCapacityCeiling` 승인된 내부 생산·비용 천장
 *   · `daily`                     그 KST 날짜의 하루 판정 (TRIAL 근거)
 *
 * 🔴 **PREPARE 는 승인된 천장이 공개보다 높을 때 그 차이로 재고를 쌓는 상태다.**
 *   앞판은 `nextPreflight.ready` 를 보고 천장을 올렸다 — 순서가 반대였다.
 *
 * 정본:
 * ```
 * judgeOneDayCanary (release-canary)  하루 시험      → TRIAL
 * judgePromotion    (d100-capacity)   지속 승격      → SUSTAIN
 * stageVerdicts     (scale-readiness) 14일 readiness
 * safeStageFor      (scale-profile)   감속
 * ```
 *
 * 🔴 **D1 → D50 한 사다리** (2026-09-29 generic scheduler 배선). 러너 단계(`RUNTIME_STAGES`)가 d50 까지다.
 *    · 다음 칸 `nextStage` 는 d10 → d20 을 준다 — 승인 천장이 d10 이면 CEILING 이 막는다(천장은 사람이 올린다).
 *    · D20 이상 시험은 preflight(`judgeNextPreflight`) PASS · 첫 슬롯 전일 때만 열린다(`extendedTrialBlocks`).
 *    · 시험이 안 열린 날은 조건이 맞으면 `REPROVE`(증명일) — PASS 뒤 하루 막혔다고 영구 정체하지 않는다.
 */
import {
  SAFEST_STAGE, safeStageFor, stageRank, profileOf,
  type RuntimeStage, type StageVerdict,
} from './scale-profile'
import {
  STAGE_DECISION_VERSION, DECISION_WRITER, TRANSITION_STATES, BLOCK_CODES,
  SUPPLY_EXCLUDE_REASONS, previousKstDate, nextStage, kstDateOfIso, isCalendarDate,
  validateStoredDecision, REQUIRED_KEYS, TRANSITION_FATAL_BLOCKS,
  type DecisionWriter, type TransitionState, type BlockCode, type StageBlock,
  type SupplySignal, type TransitionProvenance, type StageDecision,
  type ValidatedStageDecision, type ValidateResult,
} from './stage-decision-contract'
import type { CanaryVerdict } from './release-canary'
import { trialPlanOf, evidenceReasonOf, type StageEvidenceVerdict, type TrialPlan } from './stage-evidence'
import type { PromotionVerdict } from './d100-capacity'
import { needsExtendedGate, extendedTrialBlocks, type PreflightVerdict } from './stage-ladder-generic'

/**
 * 🔴 **계약 정의는 `stage-decision-contract` 하나다** (2026-09-24 7차).
 *    여기서 다시 적으면 두 벌이 되고, 갈라진 순간부터 한쪽만 고쳐진다.
 *    호출부 호환을 위해 그대로 재수출한다.
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

/**
 * 🔴 **하루 판정에 날짜와 대상 단계를 붙인다.** `CanaryVerdict` 자체에는 날짜가 없어서
 *    어제 결과를 오늘 결정에 넣어도 알 수 없었다. assembler 가 같은 `runAt` 에서 만든다.
 */
export type DatedCanary = {
  kstDate: string
  /** 시험 대상 단계 */
  stage: RuntimeStage
  verdict: CanaryVerdict
  /** assembler 가 쓴 시각 — 같은 회차·같은 KST 날짜에서 나왔는지 본다 */
  builtAt: string
  /**
   * 🔴 **이 값은 주장일 뿐 근거가 아니다.** 정본은 **바로 전 KST 날짜의 검증된
   *    StageDecision 의 `release`** 다. 다르면 `PROVENANCE_PREVIOUS` 로 막는다.
   */
  trialBase: RuntimeStage
}

export type StageInputs = {
  kstDate: string
  /** 지속 운영으로 확정된 공개 단계 */
  sustainedRelease: RuntimeStage
  /**
   * 🔴 사람이 승인한 천장 — 이 판정이 올리지 않는다.
   *    러너가 담는 천장(`resolveCeiling(...).operable`)이다 — 승인이 d100 이어도 여기는 d50 이하다.
   */
  authorizedCapacityCeiling: RuntimeStage
  verdicts: readonly StageVerdict[]
  /** 그 KST 날짜의 하루 판정. 없으면 `null` */
  daily: DatedCanary | null
  /**
   * 🔴 **바로 전 KST 날짜의 저장된 결정 — `ValidatedStageDecision` 만 받는다.**
   *
   *    앞판은 raw `StageDecision` 을 받았고, 사다리는 날짜·판·writer·release **넷만**
   *    봤다. 그래서 아래 행이 기반으로 통과했다(2026-09-24 7차 실측):
   *    `capacity=d1 · release=d3 · decidedAt=2020-01-01` → `TRIAL d5 · blocks=[]`.
   *    🔴 이제 `validateStoredDecision` 을 지나지 않은 값은 **타입이 막는다.**
   *    검증 로직을 여기 복제하지 않고 게이트를 하나로 만든 것이다.
   *
   * 🔴 `sustainedRelease` 와 합치지 않는다 — 그쪽은 **지속 승격** 판단용이다.
   */
  previousDecision: ValidatedStageDecision | null
  /**
   * 🔴 **전날 운영 증거** (2026-09-29 P0) — `judgeStageEvidence` 의 판정. 없으면 모른다(= PASS 아님).
   *    바닥 위로 올라가는 시험은 이 값이 **전날 결정과 같은 날짜·같은 단계의 PASS** 일 때만 열린다.
   *    PASS 가 아니면 전날 시험 단계를 다시 시험한다(`trialPlanOf`). 날짜만으로 올라가지 않는다.
   */
  previousEvidence?: StageEvidenceVerdict | null
  /**
   * 🔴 **D20 이상 시험 대상의 preflight** (2026-09-29 generic scheduler 배선) — `judgeNextPreflight`.
   *    D3·D5·D10 시험은 이 값을 보지 않는다(#620 관문 그대로 — 하루 시뮬레이션 `judgeOneDayCanary`).
   *    D20 이상은 이 값이 **그 대상의 PASS** 여야 열린다 — 없거나 다른 단계거나 PASS 가 아니면 막는다.
   */
  nextPreflight?: PreflightVerdict | null
  /** 정본 `judgePromotion`. 없으면 `null` */
  promotion: PromotionVerdict | null
  publishedToday: number
  supply?: SupplySignal
  decidedAt: string
}

const next = nextStage

/**
 * 🔴 **판정의 출처를 검증한다** — 외부에서 아무 verdict 나 끼워 넣지 못하게.
 *    막힌 것은 코드로 남기고, 그 판정은 **쓰지 않는다**(fail-closed).
 */
function checkProvenance(input: StageInputs): { blocks: StageBlock[]; plan: TrialPlan | null } {
  const out: StageBlock[] = []
  let plan: TrialPlan | null = null
  const up = next(input.sustainedRelease)
  const p = input.promotion
  if (p !== null) {
    if (p.current !== input.sustainedRelease) {
      out.push({
        code: 'PROVENANCE_CURRENT',
        reason: `promotion.current ${p.current} ≠ 지속 공개 단계 ${input.sustainedRelease}`,
      })
    }
    if (up !== null && String(p.next) !== String(up)) {
      out.push({
        code: 'PROVENANCE_NEXT',
        reason: `promotion.next ${String(p.next)} ≠ 바로 다음 단계 ${up}`,
      })
    }
  }
  const d = input.daily
  if (d !== null) {
    if (d.kstDate !== input.kstDate) {
      out.push({
        code: 'STALE_DAILY',
        reason: `하루 판정 날짜 ${d.kstDate} ≠ 결정 날짜 ${input.kstDate} — 전날 결과를 쓰지 않는다`,
      })
    }
    /**
     * 🔴 **`builtAt` 의 KST 날짜도 같아야 한다.** `kstDate` 칸만 맞춰 놓고
     *    어제 만든 verdict 를 넣는 것을 막는다 — 라벨이 아니라 만든 시각을 본다.
     */
    const builtDate = kstDateOfIso(d.builtAt)
    if (builtDate === null) {
      out.push({ code: 'STALE_DAILY', reason: `builtAt 을 읽을 수 없다 — "${d.builtAt}"` })
    } else if (builtDate !== input.kstDate) {
      out.push({
        code: 'STALE_DAILY',
        reason: `builtAt 의 KST 날짜 ${builtDate} ≠ 결정 날짜 ${input.kstDate}`
          + ' — 라벨만 바꾼 어제 판정을 쓰지 않는다',
      })
    }
    if (d.verdict.stage !== d.stage) {
      out.push({
        code: 'PROVENANCE_STAGE',
        reason: `하루 판정 대상 ${d.stage} ≠ verdict.stage ${d.verdict.stage}`,
      })
    }
    /**
     * 🔴 **시험 기반의 정본은 전날 실제 결정이다** (2026-09-24 6차 · 마스터 지적).
     *
     *    앞판은 기반을 `sustainedRelease`(= env 문자열)에서 가져왔다. 그러면
     *    전날 D3 로 실제 공개한 날에도 env 가 d1 이면 D3→D5 시험이 **막혔다.**
     *    반대로 env 만 올려 두면 있지도 않은 기반으로 시험이 열렸다.
     *    🔴 이제 기반은 **바로 전 KST 날짜의 검증된 StageDecision 의 `release`** 뿐이다.
     *    `sustainedRelease` 는 **지속 승격** 판단에만 남는다 — 두 축을 합치지 않는다.
     */
    plan = authoritativeTrialPlan(input, out)
    if (plan !== null) {
      /** 🔴 caller 가 적어 온 `trialBase` 는 **주장**이다 — 정본과 다르면 막는다 */
      if (d.trialBase !== plan.base) {
        out.push({
          code: 'PROVENANCE_PREVIOUS',
          reason: `시험 기반 주장 ${d.trialBase} ≠ 전날 결정·운영 증거가 정한 기반 ${plan.base}(${plan.basis})`
            + ' — caller 문자열로 전날 결정을 우회하지 않는다',
        })
      }
      if (d.stage !== plan.target || next(plan.base) !== plan.target) {
        out.push({
          code: 'PROVENANCE_STAGE',
          reason: `시험 대상 ${d.stage} ≠ 전날 결정·운영 증거가 정한 대상 ${plan.target}(${plan.basis})`
            + ' — 단계 점프를 하루 시험으로 우회하지 않는다(PASS 없이 올라가지 않는다)',
        })
      }
    }
  }
  return { blocks: out, plan }
}

/**
 * 🔴 **전날 결정에서 시험 기반을 꺼낸다 — 못 꺼내면 `null` 이고 시험은 열리지 않는다.**
 *
 *    🔴 **첫 controller 실행일에는 전날 결정이 없다.** 그때 시험을 여는 것은
 *       "아무도 판단하지 않은 기반" 위에서 단계를 올리는 것이다. 열지 않는다(fail-closed).
 *       그날은 legacy 경로(`STAGE_CONTROLLER_ENABLED` 가 꺼진 상태)가 그대로 돈다.
 */
function authoritativeTrialPlan(input: StageInputs, out: StageBlock[]): TrialPlan | null {
  const prev = input.previousDecision
  const want = previousKstDate(input.kstDate)
  if (want === null) {
    out.push({ code: 'PROVENANCE_PREVIOUS', reason: `결정 날짜가 달력에 없다 — "${input.kstDate}"` })
    return null
  }
  if (prev === null) {
    out.push({
      code: 'PROVENANCE_PREVIOUS',
      reason: `${want} 결정이 없다 — 🔴 시험을 열지 않는다(기반을 아무도 판단하지 않았다)`,
    })
    return null
  }
  /**
   * 🔴 **계약·writer·enum·불변식은 여기서 다시 보지 않는다.**
   *    `prev` 는 `ValidatedStageDecision` 이다 — `validateStoredDecision` 을 지나야만
   *    그 타입이 된다. 여기서 같은 검사를 또 적으면 **두 벌**이 되고, 갈라진 순간부터
   *    한쪽만 고쳐진다. 이 함수가 묻는 것은 **저장 검증이 알 수 없는 것 하나**뿐이다:
   *    "그 행이 **오늘의** 직전 날짜인가."
   */
  if (prev.kstDate !== want) {
    out.push({
      code: 'PROVENANCE_PREVIOUS',
      reason: `이전 결정 날짜 ${prev.kstDate} ≠ 바로 전날 ${want} — 이틀 전 결정을 기반으로 쓰지 않는다`,
    })
    return null
  }
  /**
   * 🔴 **기반은 전날 결정 + 전날 운영 증거가 함께 정한다** (2026-09-29 P0).
   *    앞판은 `prev.release` 를 그대로 기반으로 썼다 — 전날 시험이 실패했어도 다음 칸이 열렸다.
   *    이제 PASS 면 한 칸 올리고, 전날이 시험인데 PASS 가 아니면 **같은 단계를 다시** 시험한다.
   */
  const plan = trialPlanOf(prev, input.previousEvidence ?? null)
  if (plan === null) {
    out.push({
      code: 'PROVENANCE_PREVIOUS',
      reason: `${want} ${prev.release} 는 운영 PASS 가 아니다 — 🔴 증거 없이 올라갈 칸이 없다(지금 단계를 지킨다)`,
    })
  }
  return plan
}

/**
 * 🔴 **정본 넷을 한 결정으로 묶는다.** 여기서 천장을 올리지 않고 새 문턱값도 만들지 않는다.
 */
export function planStageDecision(input: StageInputs): StageDecision {
  const ceiling = input.authorizedCapacityCeiling
  const base = {
    kstDate: input.kstDate,
    // 🔴 **승인 천장 그대로.** 어떤 판정도 이 값을 올리지 않는다
    capacity: ceiling,
    supply: input.supply ?? null,
    decidedAt: input.decidedAt,
    contractVersion: STAGE_DECISION_VERSION,
    /** 🔴 이 함수가 만든 결정은 언제나 controller 의 것이다 */
    decidedBy: DECISION_WRITER as string,
  } as const
  const { blocks, plan } = checkProvenance(input)
  const reasons: string[] = blocks.map((b) => `🔴 ${b.code}: ${b.reason}`)
  /** 🔴 전날 운영 증거 판정 — 코드와 개수만 남긴다 */
  if (input.previousEvidence !== undefined && input.previousEvidence !== null) {
    reasons.push(evidenceReasonOf(input.previousEvidence))
  }

  /** 🔴 출처가 어긋난 판정은 **쓰지 않는다** */
  const promotion = blocks.some((b) => b.code.startsWith('PROVENANCE_C') || b.code === 'PROVENANCE_NEXT')
    ? null : input.promotion
  /**
   * 🔴 **`PROVENANCE_PREVIOUS` 도 여기 들어간다** (2026-09-24 6차).
   *    앞판은 이 코드를 `blocks` 에 적기만 하고 **그 판정을 그대로 썼다** —
   *    "막았다" 고 기록해 놓고 시험을 연 것이다. 죽은 게이트였다.
   */
  let daily = blocks.some((b) =>
    b.code === 'STALE_DAILY' || b.code === 'PROVENANCE_STAGE' || b.code === 'PROVENANCE_PREVIOUS')
    ? null : input.daily
  /**
   * 🔴 **D20 이상 시험 관문** (2026-09-29 generic scheduler 배선).
   *    D20 이상 대상은 하루 시뮬레이션(`judgeOneDayCanary`) 위에 preflight(재고 · Persona canary 하한 ·
   *    댓글/감사/공급 비용 · 댓글 러너 용량 · 슬롯)와 첫 슬롯 시각(LATE_START)을 더 본다.
   *    🔴 천장 위 대상은 여기서 보지 않는다 — 아래 CEILING 이 막고, 이유가 둘로 갈리지 않게 한다.
   *    🔴 막히면 판정을 **쓰지 않는다**(TRIAL 없음) — 코드만 남기고 시험을 여는 죽은 게이트를 만들지 않는다.
   */
  if (daily !== null && needsExtendedGate(daily.stage) && stageRank(daily.stage) <= stageRank(ceiling)) {
    const gate = extendedTrialBlocks({
      target: daily.stage, kstDate: input.kstDate, runAt: input.decidedAt, preflight: input.nextPreflight ?? null,
    })
    if (gate.length > 0) {
      blocks.push(...gate)
      reasons.push(...gate.map((b) => `🔴 ${b.code}: ${b.reason}`))
      daily = null
    }
  }

  /** 🔴 새 KST 날짜에 판정이 하나도 없으면 d1 — 빈 값을 근거로 어제를 잇지 않는다 */
  if (input.verdicts.length === 0 && daily === null) {
    return {
      ...base, capacity: SAFEST_STAGE, release: SAFEST_STAGE, state: 'HOLD',
      dayPinned: false, blocks, transition: null,
      reasons: [...reasons, `🔴 ${input.kstDate} 판정이 하나도 없다 — 가장 안전한 ${SAFEST_STAGE}`],
    }
  }

  let release = input.sustainedRelease
  let state: TransitionState = 'HOLD'
  /** 🔴 전이 근거 — 구조화된 값으로 남긴다. 저장 검증이 문구를 파싱하지 않게 한다 */
  let transition: TransitionProvenance | null = null
  const up = next(input.sustainedRelease)

  /**
   * 🔴 **D20 이상은 지속 승격(SUSTAIN)으로 건너가지 않는다** (2026-09-29 계약 정렬).
   *    D100 용량표(`schedulerSupportOf`)가 이제 d20~d50 러너 프로필을 "감당한다" 고 말한다 —
   *    그러면 `judgePromotion` 이 d10→d20 을 ready 로 낼 수 있다. 그 길로 가면 D20+ 관문
   *    (preflight · LATE_START · 운영 증거 PASS)을 거치지 않고 공개가 오른다.
   *    D20 이상은 **하루 시험(TRIAL) → 운영 증거 PASS** 로만 오른다 — 앞판 동작(SUSTAIN 은 d10 까지) 그대로다.
   */
  if (promotion?.ready === true && up !== null && !needsExtendedGate(up)) {
    /**
     * ── ① 지속 승격 ──
     * 🔴 **천장은 그대로다.** D3→D5 공개 승격이 D10 승인을 뜻하지 않는다.
     */
    if (stageRank(up) > stageRank(ceiling)) {
      blocks.push({
        code: 'CEILING',
        reason: `지속 승격 대상 ${up} 가 승인 천장 ${ceiling} 를 넘는다 — 공개를 올리지 않는다`,
      })
      reasons.push(`🔴 CEILING: ${up} > 승인 천장 ${ceiling} — 승격을 보류한다(천장을 올리지 않는다)`)
    } else {
      release = up
      state = 'SUSTAIN'
      transition = { kind: 'SUSTAIN', from: input.sustainedRelease, to: up }
      reasons.push(`🟢 지속 승격(정본 judgePromotion) — 공개 ${input.sustainedRelease} → ${up}`)
      reasons.push(`🔴 승인 천장 ${ceiling} 는 그대로다 — 자동으로 올라가지 않는다`)
    }
  } else if (daily?.verdict.ok === true) {
    /**
     * ── ② 하루 시험 ──
     * 🔴 지속 미달이어도 열린다. 다만 **승인 천장을 넘지 못한다.**
     */
    if (stageRank(daily.stage) > stageRank(ceiling)) {
      blocks.push({
        code: 'CEILING',
        reason: `하루 시험 대상 ${daily.stage} 가 승인 천장 ${ceiling} 를 넘는다 — 공개하지 않는다`,
      })
      reasons.push(`🔴 CEILING: 하루 시험 ${daily.stage} > 승인 천장 ${ceiling} — 시험을 열지 않는다`)
    } else {
      release = daily.stage
      state = 'TRIAL'
      /** 🔴 기반은 전날 결정에서 나온 값이다 — caller 주장이 아니다(위에서 대조했다) */
      transition = {
        kind: 'TRIAL', trialBase: daily.trialBase,
        previousKstDate: input.previousDecision?.kstDate ?? '',
        target: daily.stage,
        /** 🔴 위에서 대조를 통과했으면 `plan` 이 있다 — 근거 칸도 정본에서만 온다 */
        ...(plan === null ? {} : { basis: plan.basis }),
      }
      if (plan?.basis === 'RETEST') reasons.push(`🔴 RETEST — 전날 ${daily.stage} 가 운영 PASS 가 아니다. 같은 단계를 다시 시험한다`)
      reasons.push(`🟢 오늘 하루 ${daily.stage} 로 낸다(정본 judgeOneDayCanary)`)
      if (promotion !== null && !promotion.currentStable.ready) {
        reasons.push('🔴 지속 승격은 아직이다 — 오늘만이다')
      }
    }
  }

  /**
   * ── ③ PREPARE ──
   * 🔴 **이미 승인된 천장이 공개보다 높으면** 그 차이로 다음 단계 재고를 쌓는다.
   *    `nextPreflight` 는 준비 진행률·시험 가능 여부를 말할 뿐 천장을 만들지 않는다.
   */
  // 🔴 **PREPARE 판단은 공개가 확정된 뒤에 한다** — 아래 ⑤ 로 옮겼다(2026-09-24 8차).
  //    감속·고정·천장 제한이 공개를 바꾸므로, 여기서 정하면 "쌓는 중" 이 거짓이 될 수 있다

  // ── ④ 감속은 정본에 맡긴다 ──
  const safe = safeStageFor(release, input.verdicts)
  if (safe.reason !== null) reasons.push(safe.reason)
  if (safe.unknown) reasons.push('🔴 지속 판정을 받지 못했다 — `chosenReady` 를 신뢰하지 않는다')
  // 🔴 하루 시험은 지속 판정으로 깎지 않는다 — 그러면 시험이 영영 열리지 않는다
  if (state !== 'TRIAL') release = safe.stage

  let dayPinned = false
  if (stageRank(release) < stageRank(input.sustainedRelease)
    && input.publishedToday > profileOf(release).dailyTarget) {
    reasons.push(
      `🔴 오늘 이미 ${input.publishedToday}건 냈다 — ${release} 로 내리면 상한 초과가 된다. `
      + `오늘은 ${input.sustainedRelease} 를 고정한다`,
    )
    release = input.sustainedRelease
    dayPinned = true
  }

  /**
   * 🔴 **공개가 천장을 넘으면 공개를 제한한다 — 천장을 올리지 않는다.**
   *    준비되지 않은 양을 내보내는 길은 어떤 경우에도 열지 않는다.
   */
  if (stageRank(release) > stageRank(ceiling)) {
    blocks.push({
      code: 'CEILING',
      reason: `공개 ${release} 가 승인 천장 ${ceiling} 를 넘는다 — ${ceiling} 로 제한한다`,
    })
    reasons.push(`🔴 CEILING: 공개 ${release} > 승인 천장 ${ceiling} — ${ceiling} 로 제한한다`)
    release = ceiling
    // 🔴 천장에 걸려 상태가 내려가면 그 전이 근거도 함께 버린다 — 남기면 거짓이 된다
    if (state === 'TRIAL' || state === 'SUSTAIN') { state = 'HOLD'; transition = null }
  }
  /**
   * ── 🔴 **전이 근거와 실제 공개가 어긋나면 그 전이는 사실이 아니다** (2026-09-24 8차) ──
   *
   *    실측 결함: `sustainedRelease=d3` · 승격 ready · 천장 d5 인데 **준비도 감속**(④)이
   *    공개를 d1 로 내렸다. 그런데 `state` 는 `SUSTAIN` 이고 전이 근거는 `d3→d5` 로
   *    남아 있었다 — **"d5 로 올렸다" 고 적힌 행이 실제로는 d1 로 낸다.**
   *    정본 validator 가 이 모순을 잡아 드러났다(자기 일관성 검사).
   */
  if (transition !== null) {
    const target = transition.kind === 'TRIAL' ? transition.target : transition.to
    if (release !== target) {
      reasons.push(
        `🔴 ${state} 전이 대상 ${target} 와 실제 공개 ${release} 가 다르다 — 그 전이를 되돌린다`,
      )
      state = 'HOLD'
      transition = null
    }
  }

  /**
   * ── ⑤ PREPARE ──
   * 🔴 **이미 승인된 천장이 공개보다 높으면** 그 차이로 다음 단계 재고를 쌓는다.
   *    🔴 공개가 **확정된 뒤**에 판단한다 — 감속·고정·천장 제한 전에 정하면 거짓이 된다.
   */
  if (state === 'HOLD' && stageRank(ceiling) > stageRank(release)) {
    state = 'PREPARE'
    const pct = promotion?.nextPreflight.ready === true ? '준비 완료'
      : `준비 중 — ${promotion?.nextPreflight.blocking[0] ?? '진행률 미측정'}`
    reasons.push(`🟢 PREPARE — 공개 ${release} · 승인 천장 ${ceiling} 로 재고를 쌓는다 (${pct})`)
  }
  /**
   * ── ⑥ REPROVE — 지금 단계를 증명일로 다시 돈다 (2026-09-29 generic scheduler 배선) ──
   *
   * 🔴 **왜.** 앞판은 시험이 열리지 않은 날을 HOLD·PREPARE 로 두었다. 그날은 증명일이 아니라서
   *    (`stage-proof-day` 공정성 그대로) 증거가 `DECISION_NOT_TRANSITION` 이 되고, 다음 날 시험 계획이
   *    다시 없다 — **PASS 뒤 하루라도 막히면 지속 승격 밖에서는 영구 정체**였다(실측 반례).
   * 🔴 **언제.** 전날 결정이 바로 전날 것으로 검증됐고 · 공개가 바닥 위이고 · 다음 칸이 **승인 천장 안**
   *    이고 · 그날 단계를 고정하지 않았을 때. 공개는 **그대로**다 — 올리지 않는다.
   *    · 천장에 닿은 단계는 HOLD 로 남는다 — 올라갈 칸이 없는데 공정성을 바꾸지 않는다.
   *      천장이 올라간 다음 날 이 규칙이 REPROVE 를 열고, 그 PASS 뒤 날 다음 칸 시험이 열린다.
   *    · 바닥(d1)은 증거 없이 FLOOR 시험을 연다 — 여기 오지 않는다.
   * 🔴 운영 신호 브레이크(`decideStage`)는 REPROVE 를 HOLD·PREPARE 로 되돌린다 — 품질·비용·오류가
   *    나쁘거나 모르는 날 자동 target 을 앞세우지 않는다.
   */
  if ((state === 'HOLD' || state === 'PREPARE') && !dayPinned) {
    const prev = input.previousDecision
    const upNext = next(release)
    if (prev !== null && prev.kstDate === previousKstDate(input.kstDate) && release !== SAFEST_STAGE
      && upNext !== null && stageRank(upNext) <= stageRank(ceiling)) {
      state = 'REPROVE'
      reasons.push(`🟢 REPROVE — 공개 ${release} 를 증명일로 다시 돈다(자동 target 먼저). `
        + `PASS 면 다음 날 ${upNext} 시험 — 승인 천장 ${ceiling} 안이다`)
    }
  }
  if (state === 'HOLD' && reasons.length === 0) {
    reasons.push(`유지 — ${promotion?.nextAction ?? '판정 근거 없음'}`)
  }
  return { ...base, release, state, blocks, dayPinned, reasons, transition }
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
