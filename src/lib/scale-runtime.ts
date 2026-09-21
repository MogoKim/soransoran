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
  RELEASE_STAGES,
  type ReleaseStage, type ScaleProfile, type StageVerdict,
} from './scale-profile'
import { canaryAuthorization, type CanaryVerdict } from './release-canary'

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
  /**
   * 🔴 **고른 단계가 실제로 달성 가능한가.**
   *    최저 단계마저 미달이면 더 내려갈 곳이 없어 `throttledByReadiness` 는 false 다.
   *    그때 "달성 가능" 이라고 적으면 화면이 미달을 초록으로 보여 준다 —
   *    그래서 이 값을 따로 들고 다니고, 화면은 이것으로 색을 정한다.
   */
  chosenReady: boolean
  /**
   * 🔴 **하루짜리 첫 시험으로 올라간 단계인가** (2026-09-21).
   *
   *    `true` 면 이 회차는 **지속 운영이 아니다.** 준비도 감속을 그날 하루만
   *    비켜 간 것이고, `chosenReady` 는 여전히 `false` 다 —
   *    14일 누적·공백·재고 조건은 그대로 미달이라는 뜻이다.
   *    🔴 두 값을 같은 이름으로 부르지 않으려고 칸을 따로 둔다.
   */
  canaryStage: boolean
  /** 그 허가가 묶인 KST 날짜. 허가가 없으면 null */
  canaryDate: string | null
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
  chosenReady: false,
  canaryStage: false,
  canaryDate: null,
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
  opts: {
    readiness?: readonly StageVerdict[]
    /**
     * 🔴 **하루짜리 첫 시험.** 호출부가 그날치 시뮬레이션으로 판정해 넘긴다 —
     *    이 파일은 DB 를 모르므로 여기서 계산하지 않는다(`readiness` 와 같은 방식).
     */
    canary?: { now: Date; verdict: CanaryVerdict | null }
  } = {},
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

  /**
   * ②-a 🔴 **하루짜리 첫 시험 허가** (2026-09-21).
   *
   *    허가는 `SORAN_RELEASE_CANARY_STAGE` 와 `SORAN_RELEASE_CANARY_DATE` 를
   *    **둘 다** 요구하고, 그 KST 날짜 하루만 산다. 날짜가 지나면 아무도 끄지
   *    않아도 꺼진다 — "설정을 올려 두었다" 가 조용히 상시 승격이 되지 않게 한다.
   *
   * 🔴 **capacity 상한은 비켜 가지 않는다.** 위 ① 을 통과한 뒤에만 본다 —
   *    내부 공급이 준비한 것보다 많이 내는 길은 시험이라도 열지 않는다.
   *
   * 🔴 그날치 판정이 `ok` 가 아니면 켜지지 않는다. 허가만으로는 올라가지 않는다.
   */
  const canary = opts.canary
  let canaryStage = false
  let canaryDate: string | null = null
  if (canary !== undefined) {
    const auth = canaryAuthorization(env, canary.now, RELEASE_STAGES)
    canaryDate = auth.date
    if (auth.note !== null) notes.push(auth.note)
    if (auth.activeToday && auth.stage !== null) {
      if (stageRank(auth.stage) > stageRank(cap.stage)) {
        notes.push(`🔴 첫 시험 ${auth.stage} 가 capacity=${cap.stage} 를 넘는다 — 시험이라도 열지 않는다`)
      } else if (canary.verdict === null) {
        notes.push('🔴 첫 시험 허가는 있으나 그날치 판정을 받지 못했다 — 켜지 않는다(fail-closed)')
      } else if (!canary.verdict.ok) {
        notes.push(`🔴 첫 시험 ${auth.stage} 를 켜지 않는다 — ${canary.verdict.reasons.join(' / ')}`)
      } else if (stageRank(auth.stage) <= stageRank(stage)) {
        notes.push(`첫 시험 ${auth.stage} 는 지금 단계보다 높지 않다 — 그대로 둔다`)
      } else {
        stage = auth.stage
        canaryStage = true
        notes.push(`🔴 **하루짜리 첫 시험** ${auth.stage} · ${auth.date} — 그날 ${canary.verdict.can}/${canary.verdict.want}건`)
        notes.push('🔴 지속 운영 승격이 아니다 — 14일 누적·공백·재고 조건은 그대로 미달이다')
      }
    }
  }

  // ② 준비도 감속 — 🔴 표시가 아니라 **실제 프로필을 낮춘다**
  let throttledByReadiness = false
  let chosenReady = false
  const readiness = opts.readiness
  if (canaryStage) {
    /**
     * 🔴 **시험 회차는 준비도 감속을 건너뛴다.** 그것이 이 기능의 전부다 —
     *    다른 안전장치(하루 상한 · 슬롯 · 신선도 · persona 적격 · 중복 · 트랜잭션)는
     *    아래 경로에서 그대로 돈다. 🔴 `chosenReady` 는 **false 로 남긴다.**
     */
    notes.push('🔴 시험 회차라 준비도 감속을 적용하지 않았다 — 준비됐다는 뜻이 아니다')
  } else if (readiness !== undefined && readiness.length > 0) {
    const safe = safeStageFor(stage, readiness)
    if (safe.stage !== stage) {
      throttledByReadiness = true
      notes.push(safe.reason ?? `${stage} → ${safe.stage} 감속`)
      stage = safe.stage
    }
    chosenReady = safe.chosenReady
    // 🔴 더 내려갈 곳이 없어 감속 플래그가 안 서는 경우도 **사유는 남긴다**
    if (!safe.chosenReady && !throttledByReadiness && safe.reason !== null) notes.push(safe.reason)
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
    readinessApplied: !canaryStage && readiness !== undefined && readiness.length > 0,
    chosenReady,
    canaryStage,
    canaryDate,
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
  opts: {
    readiness?: readonly StageVerdict[]
    canary?: { now: Date; verdict: CanaryVerdict | null }
  } = {},
): ResolvedScale {
  return applyScale(resolveScale(env, opts))
}

/** 사람이 읽을 한 줄 — 화면과 JSON 이 같은 문장을 쓴다 */
export function describeScale(r: ResolvedScale): string {
  return `capacity=${r.capacityStage}(내부 ${r.capacityProfile.dailyTarget}/day 기준)`
    + ` · release=${r.releaseStage}(공개 ${r.releaseProfile.dailyTarget}/day)`
    + (r.requestedRelease !== r.releaseStage ? ` · 요청 ${r.requestedRelease} 에서 감속` : '')
}
