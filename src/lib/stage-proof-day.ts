/**
 * 🔴 **단계 증명일 — 자동 target 증거 부족분 관측** (2026-10-19 fresh-first 보정 · 순수)
 *
 * 🔴 **계약.**
 *    · 자동 단계 TRIAL/RETEST/REPROVE 증명일에는 그 단계 `dailyTarget` 중 자동 target 부족분을 센다.
 *    · 부족분은 관측·보고·단계 증거에만 쓴다. human/auto lane, 복구 여부, 재시도 상태는 source-time 순서를 뒤집지 않는다.
 *    · 사람 글은 정상 재고로 발행될 수 있지만 자동 증명 물량으로 세지 않는다. 부족하면 `PUBLISH_NOT_AUTO_READY` 로 재시험한다.
 *    · 중복 · 일 상한 · 신선도 · 안전 게이트 · 발행 트랜잭션은 이 값과 무관하게 그대로 돈다.
 *
 * 🔴 값의 출처는 **그날 검증된 StageDecision 하나**다 — consumer(`consumerEnvOf`)가 넣는다.
 *    env 를 사람이 손으로 적어 증명일을 만들 수 없게, 날짜가 오늘이 아니면 꺼진다.
 */
import { isRuntimeStage, profileOf, type RuntimeStage } from './scale-profile'
import { kstDateString } from './release-canary'
import { decisionStageEnv } from './scale-runtime'

/** 🔴 consumer 가 넣는 두 칸 — 결정의 공개 단계 · 그 KST 날짜 */
export const PROOF_STAGE_ENV = 'SORAN_STAGE_PROOF_STAGE'
export const PROOF_DATE_ENV = 'SORAN_STAGE_PROOF_DATE'
export const PROOF_ENV_KEYS = [PROOF_STAGE_ENV, PROOF_DATE_ENV] as const

export type ProofDay = { stage: RuntimeStage; kstDate: string; target: number }

/**
 * 🔴 **오늘이 증명일인가.** 두 칸이 다 있고 · 단계가 러너 단계(`RUNTIME_STAGES`) 안이고 · 날짜가 **오늘(KST)** 일 때만.
 *    하나라도 어긋나면 `null` — 비시험일(기존 공정성)이다.
 * 🔴 **StageDecision 표식이 있어야 한다** (2026-09-30 · Lane A) — 단계 칸과 같은 문(`decisionStageEnv`)을 지난다.
 *    consumer 없이 손으로 두 칸을 적어 증명일을 만들 수 없다.
 */
export function proofDayOf(env: Readonly<Record<string, string | undefined>>, now: Date): ProofDay | null {
  if (!decisionStageEnv(env).marked) return null
  const stage = (env[PROOF_STAGE_ENV] ?? '').trim()
  const date = (env[PROOF_DATE_ENV] ?? '').trim()
  if (stage === '' || date === '') return null
  if (!isRuntimeStage(stage)) return null
  if (date !== kstDateString(now)) return null
  return { stage, kstDate: date, target: profileOf(stage).dailyTarget }
}

/** 🔴 오늘 자동 target 증거가 몇 건 더 필요한가 — 관측값이며 선택 우선권이 아니다 */
export function autoProofNeeded(proof: ProofDay | null, autoTargetsToday: number): number {
  if (proof === null) return 0
  return Math.max(0, proof.target - Math.max(0, autoTargetsToday))
}
