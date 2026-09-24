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
 */
import {
  PROFILES, RELEASE_STAGES, SAFEST_STAGE, safeStageFor, stageRank,
  type ReleaseStage, type StageVerdict,
} from './scale-profile'
import type { CanaryVerdict } from './release-canary'
import type { PromotionVerdict } from './d100-capacity'

export const STAGE_DECISION_VERSION = 'stage-decision-v3'

export const TRANSITION_STATES = ['SUSTAIN', 'TRIAL', 'PREPARE', 'HOLD'] as const
export type TransitionState = (typeof TRANSITION_STATES)[number]

/** 🔴 왜 막혔나 — 문구가 아니라 코드다 */
export const BLOCK_CODES = [
  'CEILING', 'PROVENANCE_CURRENT', 'PROVENANCE_NEXT', 'PROVENANCE_STAGE', 'STALE_DAILY',
] as const
export type BlockCode = (typeof BLOCK_CODES)[number]

/**
 * 🔴 **하루 판정에 날짜와 대상 단계를 붙인다.** `CanaryVerdict` 자체에는 날짜가 없어서
 *    어제 결과를 오늘 결정에 넣어도 알 수 없었다. assembler 가 같은 `runAt` 에서 만든다.
 */
export type DatedCanary = {
  kstDate: string
  /** 시험 대상 단계 */
  stage: ReleaseStage
  verdict: CanaryVerdict
  /** assembler 가 쓴 시각 — 같은 회차·같은 KST 날짜에서 나왔는지 본다 */
  builtAt: string
  /**
   * 🔴 **무엇을 기반으로 한 시험인가** (2026-09-24).
   *    하루 시험은 **지금 기반 단계의 바로 다음 칸**만 열 수 있다 —
   *    d1→d5 나 d3→d10 같은 점프를 허용하면 "하루 시험" 이 승격 우회로가 된다.
   */
  trialBase: ReleaseStage
}

/** 🔴 ISO 시각의 KST 날짜 — 정본과 같은 경계다 */
export function kstDateOfIso(iso: string): string | null {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  return new Date(ms + 9 * 3600_000).toISOString().slice(0, 10)
}

/** 🔴 보고용 신호 — 결정에 쓰지 않는다 */
export type SupplySignal = {
  eligibleSpeakers: number
  excluded: { reason: 'noOpenDay' | 'holdingStock'; codes: string[] }[]
}

export type StageInputs = {
  kstDate: string
  /** 지속 운영으로 확정된 공개 단계 */
  sustainedRelease: ReleaseStage
  /** 🔴 **승인된 내부 생산·비용 천장.** 이 판정이 올리지 않는다 */
  authorizedCapacityCeiling: ReleaseStage
  /** 정본 `stageVerdicts` — 14일 지속 readiness */
  verdicts: readonly StageVerdict[]
  /** 그 KST 날짜의 하루 판정. 없으면 `null` */
  daily: DatedCanary | null
  /** 정본 `judgePromotion`. 없으면 `null` */
  promotion: PromotionVerdict | null
  publishedToday: number
  supply?: SupplySignal
  decidedAt: string
}

export type StageBlock = { code: BlockCode; reason: string }

export type StageDecision = {
  kstDate: string
  /** 🔴 승인 천장 그대로 — 이 판정은 올리지 않는다 */
  capacity: ReleaseStage
  release: ReleaseStage
  state: TransitionState
  reasons: string[]
  /** 🔴 막힌 것 — 코드로 분기한다 */
  blocks: StageBlock[]
  dayPinned: boolean
  supply: SupplySignal | null
  decidedAt: string
  contractVersion: typeof STAGE_DECISION_VERSION
}

const next = (s: ReleaseStage): ReleaseStage | null => {
  const i = RELEASE_STAGES.indexOf(s)
  return i < 0 || i + 1 >= RELEASE_STAGES.length ? null : RELEASE_STAGES[i + 1]!
}

/**
 * 🔴 **판정의 출처를 검증한다** — 외부에서 아무 verdict 나 끼워 넣지 못하게.
 *    막힌 것은 코드로 남기고, 그 판정은 **쓰지 않는다**(fail-closed).
 */
function checkProvenance(input: StageInputs): StageBlock[] {
  const out: StageBlock[] = []
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
     * 🔴 **시험은 기반 단계의 바로 다음 칸만이다.** d1→d5 · d3→d10 점프를 막는다.
     *    기반은 지속 공개 단계여야 한다 — 임의 기반을 실어 우회하지 못하게.
     */
    if (d.trialBase !== input.sustainedRelease) {
      out.push({
        code: 'PROVENANCE_STAGE',
        reason: `시험 기반 ${d.trialBase} ≠ 지속 공개 단계 ${input.sustainedRelease}`,
      })
    } else {
      const base = next(d.trialBase)
      if (base === null || d.stage !== base) {
        out.push({
          code: 'PROVENANCE_STAGE',
          reason: `시험 대상 ${d.stage} 가 기반 ${d.trialBase} 의 바로 다음 칸(${base ?? '없음'})이 아니다`
            + ' — 단계 점프를 하루 시험으로 우회하지 않는다',
        })
      }
    }
  }
  return out
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
  } as const
  const blocks = checkProvenance(input)
  const reasons: string[] = blocks.map((b) => `🔴 ${b.code}: ${b.reason}`)

  /** 🔴 출처가 어긋난 판정은 **쓰지 않는다** */
  const promotion = blocks.some((b) => b.code.startsWith('PROVENANCE_C') || b.code === 'PROVENANCE_NEXT')
    ? null : input.promotion
  const daily = blocks.some((b) => b.code === 'STALE_DAILY' || b.code === 'PROVENANCE_STAGE')
    ? null : input.daily

  /** 🔴 새 KST 날짜에 판정이 하나도 없으면 d1 — 빈 값을 근거로 어제를 잇지 않는다 */
  if (input.verdicts.length === 0 && daily === null) {
    return {
      ...base, capacity: SAFEST_STAGE, release: SAFEST_STAGE, state: 'HOLD',
      dayPinned: false, blocks,
      reasons: [...reasons, `🔴 ${input.kstDate} 판정이 하나도 없다 — 가장 안전한 ${SAFEST_STAGE}`],
    }
  }

  let release = input.sustainedRelease
  let state: TransitionState = 'HOLD'
  const up = next(input.sustainedRelease)

  if (promotion?.ready === true && up !== null) {
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
  if (state === 'HOLD' && stageRank(ceiling) > stageRank(release)) {
    state = 'PREPARE'
    const pct = promotion?.nextPreflight.ready === true ? '준비 완료'
      : `준비 중 — ${promotion?.nextPreflight.blocking[0] ?? '진행률 미측정'}`
    reasons.push(`🟢 PREPARE — 공개 ${release} · 승인 천장 ${ceiling} 로 재고를 쌓는다 (${pct})`)
  }

  // ── ④ 감속은 정본에 맡긴다 ──
  const safe = safeStageFor(release, input.verdicts)
  if (safe.reason !== null) reasons.push(safe.reason)
  if (safe.unknown) reasons.push('🔴 지속 판정을 받지 못했다 — `chosenReady` 를 신뢰하지 않는다')
  // 🔴 하루 시험은 지속 판정으로 깎지 않는다 — 그러면 시험이 영영 열리지 않는다
  if (state !== 'TRIAL') release = safe.stage

  let dayPinned = false
  if (stageRank(release) < stageRank(input.sustainedRelease)
    && input.publishedToday > PROFILES[release].dailyTarget) {
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
    if (state === 'TRIAL' || state === 'SUSTAIN') state = 'HOLD'
  }
  if (state === 'HOLD' && reasons.length === 0) {
    reasons.push(`유지 — ${promotion?.nextAction ?? '판정 근거 없음'}`)
  }
  return { ...base, release, state, blocks, dayPinned, reasons }
}

/** 🔴 아무것도 읽지 못했을 때 */
export function safestDecision(kstDate: string, decidedAt: string): StageDecision {
  return {
    kstDate, capacity: SAFEST_STAGE, release: SAFEST_STAGE, state: 'HOLD',
    dayPinned: false, blocks: [], supply: null, decidedAt,
    contractVersion: STAGE_DECISION_VERSION,
    reasons: [`🔴 단계 입력을 읽지 못했다 — 가장 안전한 ${SAFEST_STAGE} 로 둔다`],
  }
}
