/**
 * 🔴 **지난 실패를 다음 계획의 입력으로 준다** (2026-09-23 마스터 지적)
 *
 *   앞판은 실패한 Persona 를 후보에서 빼기만 했다. 계획기는 **왜 실패했는지 모른 채**
 *   다음 사람으로 **똑같은 1인칭 계획**을 다시 세웠다. 그래서 세 명이 같은 자리에서
 *   같은 이유로 탔다.
 *
 * 🔴 **유료 호출을 늘리지 않는다.** 같은 speakerPlan 요청의 **입력**에 한 칸을 더한다.
 */
import type { IncompleteCause } from './review'

export type PriorPlanFailure = {
  /** 그 시도가 고른 사람 — 없으면 사람과 무관한 실패다 */
  personaCode: string | null
  /** 그 시도가 고른 자리 */
  stance: string | null
  /** 🔴 코드다. 문구를 파싱하지 않는다 */
  cause: IncompleteCause | string | null
}

/**
 * 🔴 **1인칭을 금지해야 하는가.** 지난 시도가 "조건을 만족하는 사람이 없다" 로
 *    멈췄으면 다음 계획은 1인칭을 쓰면 안 된다 — 쓰면 같은 자리에서 또 멈춘다.
 */
export function selfForbiddenBy(prior: readonly PriorPlanFailure[]): boolean {
  return prior.some((f) => f.cause === 'loadBearingSelfImpossible')
}

/**
 * 🔴 **요청에 실을 한 줄씩.** 사람이 읽는 문구가 아니라 **모델이 받는 입력**이다.
 *    비어 있으면 칸 자체를 넣지 않는다 — 빈 칸은 "지난 시도가 없다" 와 구분되지 않는다.
 */
export function priorFailureLines(prior: readonly PriorPlanFailure[]): string[] {
  return prior
    .filter((f) => f.cause !== null && String(f.cause).trim() !== '')
    .map((f) => `${f.personaCode ?? '(사람 무관)'} · ${f.stance ?? '(자리 없음)'} · ${String(f.cause)}`)
}
