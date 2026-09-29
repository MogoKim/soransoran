/**
 * 🔴 **단계 증명일 — 목표 슬롯을 자동 target 이 먼저 채운다** (2026-09-29 마스터 결정 · 순수)
 *
 * 🔴 **왜 생겼나 (운영 충돌).**
 *    단계 PASS 는 자동 READY(`AUTO_DECIDER`) + 무인 발행 글만 물량으로 센다(`stage-evidence`).
 *    그런데 발행 lane 공정성(`preferredLane`)은 human/auto 를 슬롯마다 번갈아 냈다 —
 *    d3 3슬롯 중 자동은 ~절반이라, 사람 승인 재고가 남아 있는 한 D3 PASS 가 구조적으로 불가능했다.
 *
 * 🔴 **계약.**
 *    · 자동 단계 TRIAL/RETEST/SUSTAIN/REPROVE 증명일에는 그 단계 `dailyTarget` N 슬롯을 자동 target 이 **먼저** 채운다.
 *      사람 승인 재고는 정상 재고지만, 그날 자동 target 이 N 에 닿기 전에는 **복구 행이어도** 앞서지 못한다.
 *    · N 을 채운 뒤 남는 합법 슬롯과 비시험일에는 기존 human/auto 공정성 그대로다.
 *    · 자동 후보가 없으면(재고 부족 · 선정과 트랜잭션 사이에 사라짐) 사람 글이 나갈 수는 있다 —
 *      🔴 그러나 그것은 **증명 물량이 아니다.** 증거 판정은 자동 target 만 세므로 그날은
 *      `PUBLISH_NOT_AUTO_READY` 로 같은 단계를 다시 시험한다. 사람 글로 PASS 를 만들지 않는다.
 *    · 중복 · 일 상한 · 신선도 · 안전 게이트 · 발행 트랜잭션은 이 값과 무관하게 그대로 돈다.
 *
 * 🔴 값의 출처는 **그날 검증된 StageDecision 하나**다 — consumer(`consumerEnvOf`)가 넣는다.
 *    env 를 사람이 손으로 적어 증명일을 만들 수 없게, 날짜가 오늘이 아니면 꺼진다.
 */
import { isRuntimeStage, profileOf, type RuntimeStage } from './scale-profile'
import { kstDateString } from './release-canary'

/** 🔴 consumer 가 넣는 두 칸 — 결정의 공개 단계 · 그 KST 날짜 */
export const PROOF_STAGE_ENV = 'SORAN_STAGE_PROOF_STAGE'
export const PROOF_DATE_ENV = 'SORAN_STAGE_PROOF_DATE'
export const PROOF_ENV_KEYS = [PROOF_STAGE_ENV, PROOF_DATE_ENV] as const

export type ProofDay = { stage: RuntimeStage; kstDate: string; target: number }

/**
 * 🔴 **오늘이 증명일인가.** 두 칸이 다 있고 · 단계가 러너 단계(`RUNTIME_STAGES`) 안이고 · 날짜가 **오늘(KST)** 일 때만.
 *    하나라도 어긋나면 `null` — 비시험일(기존 공정성)이다.
 */
export function proofDayOf(env: Readonly<Record<string, string | undefined>>, now: Date): ProofDay | null {
  const stage = (env[PROOF_STAGE_ENV] ?? '').trim()
  const date = (env[PROOF_DATE_ENV] ?? '').trim()
  if (stage === '' || date === '') return null
  if (!isRuntimeStage(stage)) return null
  if (date !== kstDateString(now)) return null
  return { stage, kstDate: date, target: profileOf(stage).dailyTarget }
}

/** 🔴 오늘 자동 target 이 몇 건 더 필요한가 — 증명일이 아니면 0(기존 공정성) */
export function autoFirstNeeded(proof: ProofDay | null, autoTargetsToday: number): number {
  if (proof === null) return 0
  return Math.max(0, proof.target - Math.max(0, autoTargetsToday))
}
