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
 *   ③ **감속은 표시가 아니라 강제여야 한다.** 준비도 판정 결과가 `releaseProfile` 을
 *      실제로 낮춘다. 화면 문구만 바꾸면 관제는 d1 이라 말하는데 러너는 10건을 낸다.
 *
 * 🔴 설치를 잊으면 **가장 안전한 d1** 이다. 조용히 큰 값으로 열리지 않는다.
 */

import {
  PROFILES, RELEASE_ENV, CAPACITY_ENV, SAFEST_STAGE, resolveStage, safeStageFor, stageRank,
  type ReleaseStage, type ScaleProfile, type StageVerdict,
} from './scale-profile'

export type ResolvedScale = {
  /** 준비된 능력 — 내부 공급(재고·수집)이 이것을 따른다 */
  capacityStage: ReleaseStage
  /** env 가 요청한 공개량 */
  requestedRelease: ReleaseStage
  /** 🔴 capacity 상한과 준비도 감속을 **모두 적용한** 실제 공개량 */
  releaseStage: ReleaseStage
  /** 🔴 내부 공급 정본 */
  capacityProfile: ScaleProfile
  /** 🔴 공개 발행 정본 */
  releaseProfile: ScaleProfile
  throttledByCapacity: boolean
  throttledByReadiness: boolean
  /** 준비도 판정을 받았는가. false 면 감속이 적용되지 않았다는 뜻이다 */
  readinessApplied: boolean
  notes: readonly string[]
  /** 이 설정이 어디서 왔는가 — 화면·JSON 에 같이 적는다 */
  source: 'default-safest' | 'env'
}

/** 🔴 아무것도 설치되지 않았을 때의 값 — 지금 운영값과 정확히 같다 */
export const SAFEST_SCALE: ResolvedScale = Object.freeze({
  capacityStage: SAFEST_STAGE,
  requestedRelease: SAFEST_STAGE,
  releaseStage: SAFEST_STAGE,
  capacityProfile: PROFILES[SAFEST_STAGE],
  releaseProfile: PROFILES[SAFEST_STAGE],
  throttledByCapacity: false,
  throttledByReadiness: false,
  readinessApplied: false,
  notes: Object.freeze([`규모 설정이 설치되지 않았다 — 가장 안전한 ${SAFEST_STAGE} 로 둔다`]),
  source: 'default-safest',
})

/**
 * 🔴 env → 설정. **순수 함수다** — `process.env` 를 직접 읽지 않는다.
 *
 *    `readiness` 를 주면 준비되지 않은 단계를 실제로 낮춘다.
 *    주지 않으면 `throttledByReadiness=false` · `readinessApplied=false` 로 남고,
 *    그 사실이 `notes` 에 적힌다 — "감속을 안 했다" 를 숨기지 않는다.
 */
export function resolveScale(
  env: Readonly<Record<string, string | undefined>>,
  opts: { readiness?: readonly StageVerdict[] } = {},
): ResolvedScale {
  const cap = resolveStage(env[CAPACITY_ENV], 'capacity')
  const rel = resolveStage(env[RELEASE_ENV], 'release')
  const notes: string[] = [cap.fallbackReason, rel.fallbackReason].filter((x): x is string => x !== null)

  // ① capacity 상한 — 준비한 것보다 많이 낼 수 없다
  let stage = rel.stage
  let throttledByCapacity = false
  if (stageRank(rel.stage) > stageRank(cap.stage)) {
    stage = cap.stage
    throttledByCapacity = true
    notes.push(`release=${rel.stage} 가 capacity=${cap.stage} 를 넘는다 — ${cap.stage} 로 감속`)
  }

  // ② 준비도 감속 — 🔴 표시가 아니라 **실제 프로필을 낮춘다**
  let throttledByReadiness = false
  const readiness = opts.readiness
  if (readiness !== undefined && readiness.length > 0) {
    const safe = safeStageFor(stage, readiness)
    if (safe.stage !== stage) {
      throttledByReadiness = true
      notes.push(safe.reason ?? `${stage} → ${safe.stage} 감속`)
      stage = safe.stage
    }
  } else {
    notes.push('준비도 판정을 받지 않았다 — 준비도 감속은 적용되지 않았다')
  }

  return {
    capacityStage: cap.stage,
    requestedRelease: rel.stage,
    releaseStage: stage,
    capacityProfile: PROFILES[cap.stage],
    releaseProfile: PROFILES[stage],
    throttledByCapacity,
    throttledByReadiness,
    readinessApplied: readiness !== undefined && readiness.length > 0,
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

/**
 * 🔴 편의 함수 — `loadEnvLocal()` 뒤에 이 한 줄이면 된다.
 *    준비도는 DB 를 읽어야 나오므로, 그것을 만든 뒤 다시 부른다(2단계).
 */
export function installFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  opts: { readiness?: readonly StageVerdict[] } = {},
): ResolvedScale {
  return applyScale(resolveScale(env, opts))
}

/** 사람이 읽을 한 줄 — 화면과 JSON 이 같은 문장을 쓴다 */
export function describeScale(r: ResolvedScale): string {
  return `capacity=${r.capacityStage}(내부 ${r.capacityProfile.dailyTarget}/day 기준)`
    + ` · release=${r.releaseStage}(공개 ${r.releaseProfile.dailyTarget}/day)`
    + (r.requestedRelease !== r.releaseStage ? ` · 요청 ${r.requestedRelease} 에서 감속` : '')
}
