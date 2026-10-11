/**
 * 🔴 **러너 공통 lease — 정기 · (다음) 사건 · 복구 회차가 같은 문 하나를 지난다** (2026-10-11 Batch A4)
 *
 * 🔴 **새 잠금 프로토콜을 만들지 않는다.** 획득 · 해제는 `collect-lock` 그대로다 —
 *    `wx` 하나로만 생기고 · 주인의 token 대조 삭제로만 사라지고 · **시효로 뺏는 길이 없다**.
 *    살아 있는 lease 를 나이로 뺏지 않는다. pid 로 "죽었다" 고 판정하지 않는다.
 *
 * 🔴 **겹친 깨움은 follow-up 한 번으로 합친다.**
 *    lease 를 못 잡은 회차는 물러나며 표식 파일 하나를 `wx` 로 만든다(이미 있으면 그대로 — 합쳐진다).
 *    lease 주인은 회차를 시작할 때 표식을 거두고(이번 회차가 그 깨움을 받는다), 끝낸 뒤 그 사이 생긴 표식이 있으면
 *    **딱 한 번 더** 돈다. 그 뒤 생긴 표식은 다음 회차가 시작할 때 거둔다 — 깨움은 사라지지 않고, 늘지도 않는다.
 *
 * 🔴 **표식을 지우는 것은 lease 주인뿐이다 (fencing).** 지우기 직전에 lease 파일의 token 이 내 것인지 본다.
 *    lease 를 뺏는 길이 없으므로, 내 token 이 맞는 동안 다른 회차는 표식을 지울 수 없다.
 *    rename 은 쓰지 않는다.
 *
 * 🔴 **치르는 대가 — 쥔 채로 죽은 lease 는 자동으로 풀리지 않는다.** 안전한 자동 회수(fencing token 을 쓰는
 *    저장소 · 원자적 비교-교체)는 새 의존성이나 스키마가 필요하다 — 이 판은 **BLOCK** 으로 남기고 사람이 치운다
 *    (`lockAnomaly` 가 관제에 낸다).
 */
import { unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { acquireLock, currentLockToken, releaseLock, type AcquireResult, type LockHandle, type ReleaseResult } from './collect-lock.mjs'

/** 🔴 겹친 깨움을 합친 뒤 더 도는 회차 수의 상한 — 하나다 */
export const MAX_FOLLOW_UPS = 1
export const FOLLOW_UP_FILE = 'follow-up.request'

export type LeaseTrigger = 'scheduled' | 'event' | 'recovery' | 'manual'

/** 🔴 획득 — `collect-lock` 그대로(`wx` · 자동 회수 없음) */
export function acquireRunnerLease(dir: string, file: string, nowMs: number, ttlMs: number): AcquireResult {
  return acquireLock(join(dir, file), nowMs, ttlMs)
}

export function releaseRunnerLease(handle: LockHandle): ReleaseResult {
  return releaseLock(handle)
}

export type FollowUpRequest = 'REQUESTED' | 'COALESCED' | 'ERROR'

/**
 * 🔴 **lease 를 못 잡은 회차가 남기는 깨움** — `wx` 하나. 이미 있으면 합쳐진 것이다(새 표식을 만들지 않는다).
 *    무엇을 할지는 적지 않는다 — 다음 회차는 지금 DB 를 다시 읽어 스스로 정한다.
 */
export function requestFollowUp(dir: string, nowMs: number, trigger: LeaseTrigger): FollowUpRequest {
  try {
    writeFileSync(join(dir, FOLLOW_UP_FILE), JSON.stringify({ at: new Date(nowMs).toISOString(), trigger }), { flag: 'wx', mode: 0o600 })
    return 'REQUESTED'
  } catch (e) {
    return (e as { code?: string }).code === 'EEXIST' ? 'COALESCED' : 'ERROR'
  }
}

export type FollowUpTake = 'TAKEN' | 'NONE' | 'NOT_HOLDER' | 'ERROR'

/**
 * 🔴 **표식 거두기 — lease 주인만.** 내 token 이 lease 파일에 그대로 있을 때만 지운다(fencing).
 *    주인이 아니면 아무것도 하지 않는다 — 남의 깨움을 지우지 않는다.
 */
export function takeFollowUp(handle: LockHandle, dir: string): FollowUpTake {
  if (currentLockToken(handle.path) !== handle.token) return 'NOT_HOLDER'
  // 🔴 지운 뒤에 생긴 깨움은 다음 회차가 거둔다 · 지우기 직전에 생긴 깨움은 지금 거둔 것이 받는다(곧 돌 회차)
  try { unlinkSync(join(dir, FOLLOW_UP_FILE)); return 'TAKEN' } catch (e) {
    return (e as { code?: string }).code === 'ENOENT' ? 'NONE' : 'ERROR'
  }
}

/**
 * 🔴 **회차 순서 — 첫 회차 + follow-up 최대 `MAX_FOLLOW_UPS`.** 순수 판정만 하고 실행은 부르는 쪽이 한다.
 *    `pass` 는 방금 끝낸 회차 번호(0 부터). 표식을 거두었을 때만 한 번 더 돈다.
 */
export function shouldRunFollowUp(pass: number, take: FollowUpTake): boolean {
  return pass < MAX_FOLLOW_UPS && take === 'TAKEN'
}
