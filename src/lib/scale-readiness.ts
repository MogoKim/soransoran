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
  PROFILES, RELEASE_STAGES, SAFEST_STAGE, derive, safeStageFor,
  type ReleaseStage, type ScaleProfile, type StageVerdict,
} from './scale-profile'

// 🔴 감속 정본은 `scale-profile` 하나뿐이다 — 여기서 다시 만들지 않고 그대로 내보낸다.
//    두 곳에서 감속하면 화면이 말하는 단계와 러너가 쓰는 단계가 갈린다 (P0-1)
export { safeStageFor } from './scale-profile'
export type { StageVerdict } from './scale-profile'
import { forecastPublishing, type PersonaHistory } from './supply-capacity-forecast'
import type { BatchDraft, PersonaForMatch } from './original-post-persona-match'

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
export function simulateStage(input: {
  stage: ReleaseStage
  queue: readonly BatchDraft[]
  personas: readonly PersonaForMatch[]
  history?: readonly PersonaHistory[]
  startAt: Date
  days?: number
}): SimOutcome {
  const p = PROFILES[input.stage]
  const days = input.days ?? 14
  const f = forecastPublishing({
    queue: input.queue,
    personas: input.personas,
    history: input.history ?? input.personas.map((x) => ({ code: x.code, matchedAts: [] })),
    startAt: input.startAt,
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
    stock: input.queue.length,
  }
}

/** 🔴 모든 단계를 한 번에 — 감속 판정은 이 목록 위에서 한다 */
export function simulateAllStages(input: {
  queue: readonly BatchDraft[]
  personas: readonly PersonaForMatch[]
  history?: readonly PersonaHistory[]
  startAt: Date
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
  queue: readonly BatchDraft[]
  personas: readonly PersonaForMatch[]
  history?: readonly PersonaHistory[]
  startAt: Date
  days?: number
}): StageVerdict[] {
  return simulateAllStages(input).map((x) => ({
    stage: x.verdict.stage, ready: x.verdict.ready, reasons: x.verdict.reasons,
  }))
}
