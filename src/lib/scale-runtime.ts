/**
 * 규모 런타임 설정 — 🔴 **env 를 읽는 유일한 곳이자, 유일하게 "지금 적용된 값" 을 가진 곳**
 *
 * 🔴 왜 다시 만들었나 (2026-09-08, Codex P0-1·P0-2·P0-3).
 *
 *   ① **module-load 시점 평가는 틀렸다.** ESM 은 정적 import 를 모듈 본문보다 먼저 평가한다.
 *      운영 스크립트가 `await loadEnvLocal()` 로 `.env.local` 을 읽기 **전에**
 *      이 파일이 `process.env` 를 읽어 상수를 굳혔다 — 즉 `.env.local` 설정은 애초에
 *      반영되지 않았고, 사람은 화면 문구만 보고 반영됐다고 믿었다.
 *      → 이제 import 시점에 env 를 **읽지 않는다.** 스크립트가 `loadEnvLocal()` 뒤에
 *        `applyScale(resolveScale(process.env, …))` 로 **명시적으로 설치**한다.
 *
 *   ② **capacity 와 release 는 서로 다른 프로필을 만든다.**
 *      내부 공급(재고·수집)은 capacity 기준으로 크게 잡고,
 *      공개 발행(하루 상한·주 cap·간격·슬롯)은 release 기준으로 작게 잡는다.
 *      하나의 프로필로 둘을 다루면 `capacity=d10, release=d1` 에서 재고 목표가 14가 된다.
 *
 *   ③ **단계의 정본은 StageDecision 하나다** (2026-09-30). 준비도 · canary · window 로 여기서 다시 올리거나
 *      깎지 않는다 — 결정이 이미 증거와 preflight 로 정했다.
 *
 * 🔴 설치를 잊으면 **가장 안전한 d1** 이다. 조용히 큰 값으로 열리지 않는다.
 */

import {
  RELEASE_ENV, CAPACITY_ENV, SAFEST_STAGE, resolveRuntimeStage, stageRank,
  RUNTIME_STAGES, profileOf,
  type RuntimeStage, type ScaleProfile,
} from './scale-profile'

/**
 * 🔴 **StageDecision 경유 표식** (2026-09-30 · Lane A 단일 실행 authority).
 *
 *    `SORAN_RELEASE_STAGE` · `SORAN_CAPACITY_STAGE` 는 이제 **운반용 칸**이다 — 사람이 적는 설정이 아니다.
 *    consumer(`stage-consume-exec` → `consumerEnvOf`)가 그날 검증된 결정을 넣을 때 **이 표식에 결정의 KST 날짜**를
 *    함께 넣는다. 표식이 없으면 두 칸은 **읽지 않는다** — 가장 안전한 단계다.
 *
 *    🔴 지운 권위: GitHub Variables(`vars.SORAN_*_STAGE`) · `.env.local` 의 손으로 적은 단계 ·
 *       controller 가 꺼졌을 때 env 값을 그대로 쓰던 legacy 경로. 셋 다 결정 밖에서 단계를 정했다.
 *    🔴 이 키를 워크플로 · plist · package.json · 운영 셸이나 허용 밖 코드에 적으면
 *       `stage-authority-graph`(runtime-isolation-check ⑦)가 CI 에서 막는다 — 표식을 손으로 만드는 길을 코드에 두지 않는다.
 *    🔴 날짜를 "오늘" 과 견주지 않는다. 표식은 **출처**의 증거이지 유효기간이 아니다 — 하루의 경계는 결정 자체
 *       (`validateStoredDecision` 의 `expectKstDate`)와 증명일(`proofDayOf`)이 이미 지킨다.
 */
export const STAGE_DECISION_MARK_ENV = 'SORAN_STAGE_DECISION_DATE'

/** 🔴 결정이 넣은 단계 칸 — 표식이 있을 때만 값이 있다. 아니면 둘 다 undefined(= 가장 안전한 단계) */
export type DecisionStageEnv = { capacity: string | undefined; release: string | undefined; marked: boolean; reason: string | null }

/**
 * 🔴 **단계 env 를 읽는 유일한 문** — `resolveScale` · `releaseStageCeiling` · 증명일이 전부 이것을 지난다.
 *    표식이 KST 날짜 모양(`YYYY-MM-DD`)일 때만 두 칸을 돌려준다.
 */
export function decisionStageEnv(env: Readonly<Record<string, string | undefined>>): DecisionStageEnv {
  const mark = (env[STAGE_DECISION_MARK_ENV] ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mark)) {
    return {
      capacity: undefined, release: undefined, marked: false,
      reason: 'StageDecision 경유가 아니다(표식 없음) — env 단계 칸은 읽지 않는다 · 가장 안전한 단계',
    }
  }
  return { capacity: env[CAPACITY_ENV], release: env[RELEASE_ENV], marked: true, reason: null }
}

export type ResolvedScale = {
  /** 🔴 다음에 증명할 단계(결정의 `capacity`) — 공급 준비 눈금 */
  capacityStage: RuntimeStage
  /** env(= consumer 가 넣은 결정 값)가 요청한 공개량 */
  requestedRelease: RuntimeStage
  /** 🔴 capacity 상한을 적용한 실제 공개량 */
  releaseStage: RuntimeStage
  /** 🔴 내부 공급 정본 */
  capacityProfile: ScaleProfile
  /** 🔴 공개 발행 정본 */
  releaseProfile: ScaleProfile
  throttledByCapacity: boolean
  notes: readonly string[]
  /** 이 설정이 어디서 왔는가 — 화면·JSON 에 같이 적는다 */
  source: 'default-safest' | 'env'
}

/** 🔴 아무것도 설치되지 않았을 때의 값 — 가장 안전한 d1 */
export const SAFEST_SCALE: ResolvedScale = Object.freeze({
  capacityStage: SAFEST_STAGE,
  requestedRelease: SAFEST_STAGE,
  releaseStage: SAFEST_STAGE,
  capacityProfile: profileOf(SAFEST_STAGE),
  releaseProfile: profileOf(SAFEST_STAGE),
  throttledByCapacity: false,
  notes: Object.freeze([`규모 설정이 설치되지 않았다 — 가장 안전한 ${SAFEST_STAGE} 로 둔다`]),
  source: 'default-safest',
})

/**
 * 🔴 env → 설정. **순수 함수다** — `process.env` 를 직접 읽지 않는다.
 *
 * 🔴 **단계의 정본은 StageDecision 하나다** (2026-09-30 · source-slot-v1). consumer(`stage-consume-exec`)가
 *    그날 결정의 `release` · `capacity` 를 env 로 넣는다 — 이 함수는 그것을 읽을 뿐이다.
 *    🔴 **지운 입력**: 14일 준비도 감속(`readiness` · `safeStageFor`) · 하루짜리 시험 허가(canary) ·
 *    기간형 허가(window). 셋 다 결정 밖에서 단계를 올리거나 깎던 두 번째 · 세 번째 정본이었다.
 *    🔴 **표식(`STAGE_DECISION_MARK_ENV`)이 붙은 env 만 읽는다.** 표식이 없으면(GitHub Variables · 손으로 적은
 *    `.env.local` · 러너 직접 실행) 가장 안전한 단계다. controller flag 가 꺼지면 consumer 도 가장 안전한 단계를
 *    넣는다 — env 로 돌아가는 legacy 롤백 경로는 지웠다.
 */
export function resolveScale(env: Readonly<Record<string, string | undefined>>): ResolvedScale {
  const d = decisionStageEnv(env)
  const cap = resolveRuntimeStage(d.capacity, 'capacity')
  const rel = resolveRuntimeStage(d.release, 'release')
  const notes: string[] = [d.reason, cap.fallbackReason, rel.fallbackReason].filter((x): x is string => x !== null)
  // capacity 상한 — 결정 검증이 이미 release ≤ capacity 를 지킨다. 여기서는 손으로 적은 env 도 같은 규칙을 지나게 한다
  let stage = rel.stage
  let throttledByCapacity = false
  if (stageRank(rel.stage) > stageRank(cap.stage)) {
    stage = cap.stage
    throttledByCapacity = true
    notes.push(`release=${rel.stage} 가 capacity=${cap.stage} 를 넘는다 — ${cap.stage} 로 감속`)
  }
  return {
    capacityStage: cap.stage,
    requestedRelease: rel.stage,
    releaseStage: stage,
    capacityProfile: profileOf(cap.stage),
    releaseProfile: profileOf(stage),
    throttledByCapacity,
    notes,
    source: 'env',
  }
}

// ─────────────────────────────────────────────────────────
// 🔴 설치 — `loadEnvLocal()` **뒤에** 스크립트가 한 번 부른다
// ─────────────────────────────────────────────────────────

let installed: ResolvedScale = SAFEST_SCALE

/**
 * 🔴 지금 적용된 설정. **화면·JSON·publisher·supply 가 전부 이것을 읽는다** —
 *    각자 다시 계산하면 관제와 러너가 다른 말을 한다.
 */
export function activeScale(): ResolvedScale {
  return installed
}

/**
 * 🔴 설정을 설치한다. 운영 스크립트는 `await loadEnvLocal()` 뒤에 **정확히 한 번** 부른다.
 *    두 번 부르는 것 자체는 막지 않는다 — 준비도를 계산한 뒤 다시 설치하는 흐름이 정상이다.
 */
export function applyScale(r: ResolvedScale): ResolvedScale {
  installed = r
  return installed
}

/** fixture 전용 — 설치 상태를 되돌린다 */
export function resetScale(): void {
  installed = SAFEST_SCALE
}

/** 🔴 편의 함수 — `loadEnvLocal()` 뒤에 이 한 줄이면 된다 */
export function installFromEnv(env: Readonly<Record<string, string | undefined>>): ResolvedScale {
  return applyScale(resolveScale(env))
}

/** 사람이 읽을 한 줄 — 화면과 JSON 이 같은 문장을 쓴다 */
export function describeScale(r: ResolvedScale): string {
  return `capacity=${r.capacityStage}(내부 ${r.capacityProfile.dailyTarget}/day 기준)`
    + ` · release=${r.releaseStage}(공개 ${r.releaseProfile.dailyTarget}/day)`
    + (r.requestedRelease !== r.releaseStage ? ` · 요청 ${r.requestedRelease} 에서 감속` : '')
}

/**
 * 🔴 **결정 표식이 붙은 env 로 정하는 공개 단계 천장** (2026-09-25 · 2026-09-30 단순화) — `min(capacity, release)`.
 *    발행 트랜잭션은 호출자가 넘긴 단계를 이 천장으로 누른다 — 호출자 숫자가 상한을 여는 길을 없앤다.
 *    🔴 canary · window 허가로 천장을 올리던 경로는 지웠다(결정이 유일한 단계 입력이다).
 *    🔴 표식이 없으면(러너를 consumer 없이 직접 실행) 천장은 가장 안전한 단계다 — 트랜잭션 안에서도 같다.
 */
export function releaseStageCeiling(env: Readonly<Record<string, string | undefined>>, now: Date): RuntimeStage {
  void now
  const d = decisionStageEnv(env)
  const cap = resolveRuntimeStage(d.capacity, 'capacity').stage
  const top = resolveRuntimeStage(d.release, 'release').stage
  return stageRank(top) > stageRank(cap) ? cap : top
}

/** 🔴 넘겨받은 단계(모르는 값은 가장 안전한 단계)를 env 천장으로 누른다 */
export function boundedReleaseStage(
  requested: unknown, env: Readonly<Record<string, string | undefined>>, now: Date,
): RuntimeStage {
  const asked: RuntimeStage = typeof requested === 'string' && (RUNTIME_STAGES as readonly string[]).includes(requested)
    ? requested as RuntimeStage : SAFEST_STAGE
  const ceil = releaseStageCeiling(env, now)
  return stageRank(asked) > stageRank(ceil) ? ceil : asked
}
