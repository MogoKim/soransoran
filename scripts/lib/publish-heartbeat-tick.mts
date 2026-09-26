/**
 * 발행 heartbeat **틱 잠금** — 🔴 같은 10분 틱에서 두 번째 wake 가 선택 단계로 들어가지 못하게 한다
 *
 * 🔴 **이것은 최종 권한이 아니다.** 발행 여부·건수는 발행 트랜잭션(`publishOriginalPostTx` ·
 *    scheduled)이 **도래 슬롯 − 오늘 발행 수**로 정한다. 이 잠금은 같은 맥에서 겹친 wake 가
 *    둘 다 재고를 읽고 둘 다 트랜잭션을 두드리는 **헛일**을 막을 뿐이다. 잠금이 없어도 중복은 0 이다
 *    (격리 DB 검사 `publish:heartbeat-db-check` 가 잠금 없이 동시 실행해서 본다).
 *
 * 🔴 **새 잠금 프로토콜을 만들지 않는다.** `collect-lock` 의 `acquireLock`(`wx` 하나 · 뺏기 없음)을
 *    그대로 쓴다. 다른 점은 **경로에 틱 키가 들어간다**는 것 하나다 —
 *
 *      · 같은 틱의 두 번째 wake → `EEXIST` → 물러난다(exit 0)
 *      · 쥔 채로 죽었다 → 그 **틱 하나만** 잃는다. 다음 틱은 다른 파일이다.
 *        collect-lock 은 쥔 채로 죽으면 사람이 치울 때까지 멈춘다 — 여기서 그렇게 하면
 *        맥 한 번 강제 종료로 로컬 발행이 영원히 멈춘다(fail-closed 는 공짜가 아니다).
 *        틱 키 경로에서는 뺏을 필요 자체가 없다. rename · 시효 회수 코드는 여전히 없다.
 *      · 끝나도 지우지 않는다 — 파일이 곧 "이 틱은 이미 돌았다" 표식이다.
 *        지난 날짜의 표식만 지운다(오늘 것은 건드리지 않는다).
 *
 * 🔴 틱 경계를 넘는 느린 회차(10분 초과)는 다음 틱과 겹칠 수 있다. 그 경우는 트랜잭션이 막는다
 *    (Serializable + 트랜잭션 안 재계산) — 여기서 시효로 막으려 들면 위의 영구 정지가 돌아온다.
 */
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { acquireLock } from './collect-lock.mjs'
import { kstMinuteOfDay, PUBLISH_WINDOW_END_MINUTE, PUBLISH_WINDOW_START_MINUTE } from '../../src/lib/publish-slot-catchup'
import { kstDateString } from '../../src/lib/release-canary'
import { HEARTBEAT_INTERVAL_MINUTES } from './original-post-runner-template'

/** 🔴 저장소 밖이다 — runtime 작업트리를 더럽히지 않는다. 정본 env 와 같은 부모 디렉터리 */
export const HEARTBEAT_TICK_DIR = join(homedir(), 'Library', 'Application Support', 'soransoran', 'publish-heartbeat')

const TICK_FILE = /^tick-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})\.lock$/

/** 🔴 KST 날짜 + 10분 내림 — `2026-09-26T16-50`. 16:53 에 깨도 16:50 틱이다 */
export function heartbeatTickKey(now: Date): string {
  const m = kstMinuteOfDay(now)
  const floored = m - (m % HEARTBEAT_INTERVAL_MINUTES)
  const hh = String(Math.floor(floored / 60)).padStart(2, '0')
  const mm = String(floored % 60).padStart(2, '0')
  return `${kstDateString(now)}T${hh}-${mm}`
}

/**
 * 🔴 **운영 창 안인가** — heartbeat 가 DB 에 붙기 전에 보는 **생략 판정**이다.
 *    창 밖이면 트랜잭션도 `SLOT_CLOSED` 로 막는다. 여기서는 그 헛걸음(재고 조립·DB 연결)을 줄일 뿐,
 *    발행을 여는 길이 아니다 — 창 안이라고 내는 것이 아니라 트랜잭션에 물으러 갈 뿐이다.
 */
export function heartbeatInWindow(now: Date): boolean {
  const m = kstMinuteOfDay(now)
  return m >= PUBLISH_WINDOW_START_MINUTE && m <= PUBLISH_WINDOW_END_MINUTE
}

export type TickClaim =
  | { ok: true; tick: string; path: string; pruned: number }
  | { ok: false; kind: 'TICK_TAKEN' | 'UNWRITABLE'; tick: string; reason: string }

/**
 * 🔴 **이 틱을 차지한다 — 비차단.** 이미 누가 차지했으면 기다리지 않고 물러난다.
 *    디렉터리를 만들지 못하면 `UNWRITABLE` — 부르는 쪽은 **발행하지 않고 실패**한다(fail-closed).
 */
export function claimHeartbeatTick(dir: string, now: Date): TickClaim {
  const tick = heartbeatTickKey(now)
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  } catch (e) {
    return { ok: false, kind: 'UNWRITABLE', tick, reason: `틱 디렉터리를 만들지 못했다 — ${(e as { code?: string }).code ?? 'UNKNOWN'}` }
  }
  const path = join(dir, `tick-${tick}.lock`)
  const r = acquireLock(path, now.getTime(), HEARTBEAT_INTERVAL_MINUTES * 60_000)
  if (!r.ok) {
    // 🔴 `wx` 가 EEXIST 가 아닌 이유로 실패한 경우만 collect-lock 이 이 문구를 쓴다 — 쓰기 불가다
    return r.kind === 'UNREADABLE' && r.reason.startsWith('락을 만들지 못했다')
      ? { ok: false, kind: 'UNWRITABLE', tick, reason: r.reason }
      : { ok: false, kind: 'TICK_TAKEN', tick, reason: `이 틱(${tick})은 이미 다른 wake 가 차지했다 — ${r.reason}` }
  }
  return { ok: true, tick, path, pruned: pruneOldTicks(dir, now) }
}

/** 🔴 **지난 날짜의 표식만** 지운다. 오늘 것 · 모르는 파일은 건드리지 않는다 */
export function pruneOldTicks(dir: string, now: Date): number {
  const today = kstDateString(now)
  let n = 0
  let names: string[] = []
  try { names = readdirSync(dir) } catch { return 0 }
  for (const name of names) {
    const m = TICK_FILE.exec(name)
    if (m === null || m[1]! >= today) continue
    try { unlinkSync(join(dir, name)); n += 1 } catch { /* 이미 없다 — 다른 wake 가 지웠다 */ }
  }
  return n
}
