/**
 * 규모 준비도 — 🔴 **산술 최소 인원과 실제 검증 인원을 나눈다** (2026-09-08)
 *
 * 🔴 왜 나누는가.
 *    `ceil(dailyTarget × 7 / weeklyCap)` 은 **생활사 hardFilter 를 모른다.**
 *    d10 산술은 14명이라 했지만, 그 14명으로 돌린 실측은 **14일 129/140** 이었다.
 *    Pool 유효 카드 **19명 전원**을 켜도 **139/140** 으로 1건이 모자란다.
 *    산술값만 보고 READY 라고 하면 그날 큐가 마른다.
 *
 * 🔴 판정은 **시뮬레이션**이 한다. 이 파일은 그 결과를 받아 등급을 매긴다 — 순수 함수다.
 */

import {
  PROFILES, RELEASE_STAGES, SAFEST_STAGE, derive, safeStageFor, nextSlotAnchor, horizonStart,
  type ReleaseStage, type ScaleProfile, type StageVerdict,
} from './scale-profile'

// 🔴 감속 정본은 `scale-profile` 하나뿐이다 — 여기서 다시 만들지 않고 그대로 내보낸다.
//    두 곳에서 감속하면 화면이 말하는 단계와 러너가 쓰는 단계가 갈린다 (P0-1)
export { safeStageFor } from './scale-profile'
export type { StageVerdict } from './scale-profile'
import { forecastPublishing, type PersonaHistory } from './supply-capacity-forecast'
import type { PersonaForMatch } from './original-post-persona-match'
import { prepareCandidates, type QueueCandidate } from './supply-candidates'

export type SimOutcome = {
  stage: ReleaseStage
  /** 14일에 실제로 나간 건수 */
  in14: number
  /** 목표 */
  want14: number
  /** 공백일 */
  gaps: number
  /** 기배정 복구가 깨진 건수 */
  recoveryBroken: number
  /** 시뮬레이션에 넣은 active persona 수 */
  personas: number
  /** 시뮬레이션에 넣은 재고 */
  stock: number
  /**
   * 🔴 **준비도 지평의 시작점** — 다음 KST 운영일 0시. 단계가 달라도 같은 값이다.
   *    오늘(조각 하루)은 여기 들어가지 않는다 — 그래야 오늘 낸 몫이 다시 계산되지 않는다.
   */
  horizonStartAt: Date
  /**
   * 🔴 **다음 실제 발행 슬롯** — 단계마다 다르다. 화면이 "다음에 언제 나가는가" 를 말할 때 쓴다.
   *    🔴 준비도 계산에는 쓰지 않는다. 쓰면 오늘 상한이 두 번 계산된다.
   */
  nextSlotAt: Date
  /** 지평이 덮는 완전한 KST 운영일 수 */
  horizonDays: number
}

export type ReadinessVerdict = {
  stage: ReleaseStage
  ready: boolean
  reasons: string[]
  /** 🔴 산술 최소 — 참고값이다 */
  arithmeticPersonas: number
}

/**
 * 🔴 **시뮬레이션 결과로 판정한다.** 산술 인원은 참고로만 적는다.
 *
 *    `recoveryBroken > 0` 이면 레인이 멈춘 상태이므로 무조건 not-ready 다.
 */
export function judgeReadiness(sim: SimOutcome): ReadinessVerdict {
  const p = PROFILES[sim.stage]
  const d = derive(p)
  const reasons: string[] = []
  if (sim.recoveryBroken > 0) reasons.push(`기배정 복구가 깨진 행 ${sim.recoveryBroken}건 — 레인이 멈춘다`)
  if (sim.in14 < sim.want14) reasons.push(`14일 ${sim.in14}/${sim.want14}건 — ${sim.want14 - sim.in14}건 미달`)
  if (sim.gaps > 0) reasons.push(`공백 ${sim.gaps}일`)
  if (sim.stock < d.stockTarget) reasons.push(`재고 ${sim.stock}/${d.stockTarget}건`)
  return {
    stage: sim.stage,
    ready: reasons.length === 0,
    reasons,
    arithmeticPersonas: d.personasNeededArithmetic,
  }
}

/** 사람이 읽을 한 줄 */
export function describeReadiness(v: ReadinessVerdict, sim: SimOutcome): string {
  const p: ScaleProfile = PROFILES[v.stage]
  return `${v.stage} (${p.dailyTarget}/day) — persona ${sim.personas}명 · 재고 ${sim.stock}건`
    + ` → 14일 ${sim.in14}/${sim.want14} · 공백 ${sim.gaps}일`
    + ` ${v.ready ? '✅ READY' : `🔴 ${v.reasons.join(' / ')}`}`
    + `  (산술 최소 ${v.arithmeticPersonas}명 — 참고값)`
}

// ─────────────────────────────────────────────────────────
// 🔴 시뮬레이션 — planner 와 fixture 가 **같은 함수**를 쓴다
// ─────────────────────────────────────────────────────────


/**
 * 🔴 한 단계를 실제 예측기로 돌린다. **여기에 새 계산이 없다** —
 *    러너와 같은 `forecastPublishing` · `planBatch` 를 부른다.
 *    planner 와 fixture 가 각자 돌리면 두 화면이 다른 말을 하게 된다.
 */
/**
 * 🔴 **시간축 입력** — 시작점을 호출부가 만들지 않는다.
 *
 *    `startAt` 을 직접 받던 예전 판은 호출부마다 다른 시작점을 썼다
 *    (러너는 `now`, 관제는 `nextScheduleAt`). 그러면 같은 DB 를 보고도
 *    화면과 러너가 다른 준비도를 말한다. 이제 `now` 와 `publishedToday` 만 받는다.
 *
 *    🔴 그 둘이 쓰이는 곳이 다르다.
 *      · `now` → **지평 시작점**(다음 KST 운영일 0시). 준비도는 여기서 센다
 *      · `publishedToday` → **다음 발행 슬롯**(표시용). 준비도에는 들어가지 않는다
 */
export type TimeAxis = {
  now: Date
  /** 오늘(KST) 이미 발행된 수 — 러너가 세는 것과 같은 값. 🔴 표시용 슬롯 계산에만 쓴다 */
  publishedToday: number
}

/**
 * 🔴 **단계마다 처음부터 다시 계산한다** (2026-09-08).
 *
 *    `queue` 는 **아직 아무것도 거르지 않은 후보**다. d1 기준으로 한 번 준비해 둔 목록을
 *    d10 계산에 돌려쓰면, d1 cap 에서 막힌 persona 때문에 빠진 글이 d10 에서도 빠진다 —
 *    d10 은 cap 이 달라 그 글을 낼 수 있는데도. 그래서 자동/hold 갈림과 배정은
 *    **그 단계의 cap 과 그 날짜의 여력**으로 `forecastPublishing` 안에서 매일 다시 정한다.
 */
export function simulateStage(input: {
  stage: ReleaseStage
  queue: readonly QueueCandidate[]
  personas: readonly PersonaForMatch[]
  history?: readonly PersonaHistory[]
  axis: TimeAxis
  days?: number
}): SimOutcome {
  const p = PROFILES[input.stage]
  const days = input.days ?? 14
  /**
   * 🔴 **지평은 다음 운영일 0시부터 완전한 하루 `days` 개다.**
   *
   *    다음 발행 슬롯(`nextSlotAt`)을 여기에 쓰면 두 가지가 깨진다 —
   *    오늘 이미 낸 몫 위에 그 단계의 하루 상한이 통째로 다시 얹히고
   *    (d10 · 오늘 3건 → 오늘 13건), 단계마다 창이 달라 비교가 성립하지 않는다.
   */
  const horizonStartAt = horizonStart(input.axis.now)
  const nextSlotAt = nextSlotAnchor(p, input.axis)
  const f = forecastPublishing({
    queue: input.queue,
    personas: input.personas,
    history: input.history ?? input.personas.map((x) => ({ code: x.code, matchedAts: [] })),
    startAt: horizonStartAt,
    days,
    dailyCap: p.dailyTarget,
    // 🔴 단계별 주 cap · 간격을 주입한다. 넘기지 않으면 운영 프로필로 돌아 단계 비교가 무의미해진다
    caps: { postsPerWeek: p.postsPerWeek, minDaysBetween: p.minDaysBetween },
  })
  return {
    stage: input.stage,
    in14: f.in14,
    want14: p.dailyTarget * days,
    gaps: f.days.filter((d) => d.published.length === 0).length,
    recoveryBroken: f.recoveryBroken.length,
    personas: input.personas.length,
    /**
     * 🔴 **그 단계 · 그 시점에 실제로 자동 발행할 수 있는 재고**다.
     *    필터 전 큐 길이를 재고로 세면 hold 된 몫까지 세어 READY 라고 적게 된다.
     */
    /**
     * 🔴 자동/hold 갈림은 **freshness 뿐**이라 cap 과 무관하다 — 그래서 cap 을 넘기지 않는다.
     *    단계별 cap 이 실제로 갈리는 곳은 아래 `forecastPublishing` 이고, 그것이 정본이다.
     */
    stock: prepareCandidates({
      candidates: input.queue, personas: input.personas, at: horizonStartAt,
    }).auto.length,
    horizonStartAt,
    nextSlotAt,
    horizonDays: days,
  }
}

/**
 * 🔴 **네 단계가 같은 창을 봤는가.** 지평 시작점·일수가 하나라도 다르면 비교가 성립하지 않는다.
 *    (예전 판은 단계마다 다음 슬롯을 시작점으로 써서 d1 은 내일 00:05, d10 은 오늘 13:25 였다)
 */
export function horizonMismatches(rows: readonly { sim: SimOutcome }[]): string[] {
  if (rows.length === 0) return []
  const base = rows[0]!.sim
  const out: string[] = []
  for (const { sim } of rows) {
    if (sim.horizonStartAt.getTime() !== base.horizonStartAt.getTime()) {
      out.push(`${sim.stage} 지평 시작점이 ${base.stage} 와 다르다`)
    }
    if (sim.horizonDays !== base.horizonDays) out.push(`${sim.stage} 지평 일수가 ${base.stage} 와 다르다`)
  }
  return out
}

/** 🔴 모든 단계를 한 번에 — 감속 판정은 이 목록 위에서 한다. 지평은 네 단계가 공유한다 */
export function simulateAllStages(input: {
  queue: readonly QueueCandidate[]
  personas: readonly PersonaForMatch[]
  history?: readonly PersonaHistory[]
  axis: TimeAxis
  days?: number
}): { sim: SimOutcome; verdict: ReadinessVerdict }[] {
  return RELEASE_STAGES.map((stage) => {
    const sim = simulateStage({ ...input, stage })
    return { sim, verdict: judgeReadiness(sim) }
  })
}

/**
 * 🔴 **런타임 설정에 넘길 판정.** publisher · supply · health · planner 가
 *    전부 이 함수를 거쳐 같은 근거로 감속한다.
 */
export function stageVerdicts(input: {
  queue: readonly QueueCandidate[]
  personas: readonly PersonaForMatch[]
  history?: readonly PersonaHistory[]
  axis: TimeAxis
  days?: number
}): StageVerdict[] {
  return simulateAllStages(input).map((x) => ({
    stage: x.verdict.stage, ready: x.verdict.ready, reasons: x.verdict.reasons,
  }))
}

// ─────────────────────────────────────────────────────────
// 🔴 승격·감속 조건 — **무엇이 채워지면 올라가는가**를 숫자로 적는다 (2026-09-08)
//
//    "d10 미달" 만 적으면 사람은 무엇을 해야 하는지 모른다.
//    부족한 것이 재고인지 인원인지 조합인지에 따라 할 일이 완전히 다르다.
// ─────────────────────────────────────────────────────────

export type StagePlan = {
  stage: ReleaseStage
  ready: boolean
  /** 이 단계로 올라가려면 채워야 하는 것 */
  missing: string[]
  /** 지금 → 필요 */
  need: { stock: { now: number; want: number }; personas: { now: number; arithmetic: number } }
}

/**
 * 🔴 단계별 승격 조건. `ready` 인 단계까지는 올릴 수 있고, 그 위는 `missing` 을 채워야 한다.
 *    🔴 **감속 조건은 같은 표의 뒤집음이다** — ready 였던 단계가 아니게 되면 내려간다.
 */
export function promotionPlan(
  rows: readonly { sim: SimOutcome; verdict: ReadinessVerdict }[],
): StagePlan[] {
  return rows.map(({ sim, verdict }) => {
    const missing: string[] = []
    if (sim.stock < sim.want14) missing.push(`재고 +${sim.want14 - sim.stock}건 (지금 ${sim.stock} / 필요 ${sim.want14})`)
    if (sim.in14 < sim.want14) {
      const short = sim.want14 - sim.in14
      missing.push(sim.stock >= sim.want14
        // 재고는 있는데 못 낸다 = 사람이나 조합의 문제다
        ? `발행 여력 +${short}건 — 재고는 있으나 배정이 안 된다 (인원·생활사 조합)`
        : `발행 여력 +${short}건`)
    }
    if (sim.gaps > 0) missing.push(`공백 ${sim.gaps}일 해소`)
    if (sim.recoveryBroken > 0) missing.push(`기배정 복구 ${sim.recoveryBroken}건 — 사람이 먼저 확인해야 한다`)
    return {
      stage: sim.stage, ready: verdict.ready, missing,
      need: {
        stock: { now: sim.stock, want: sim.want14 },
        personas: { now: sim.personas, arithmetic: verdict.arithmeticPersonas },
      },
    }
  })
}

/** 지금 올릴 수 있는 가장 높은 단계 — 없으면 null */
export function highestReady(rows: readonly { verdict: ReadinessVerdict }[]): ReleaseStage | null {
  const ready = rows.filter((r) => r.verdict.ready).map((r) => r.verdict.stage)
  return ready.length === 0 ? null : ready[ready.length - 1]!
}
