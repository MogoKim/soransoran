/**
 * 수집 **락** — 🔴 `wx` 로만 생기고, 주인만 지운다. **자동 회수 없음**
 *
 * 🔴 **2026-09-10 정정 — 금지된 패턴을 다시 들여왔었다.**
 *
 *    앞선 판은 stale 인수를 `readLock → rename` 으로 했다.
 *    이 저장소는 **이미 2026-09-09(PR #483)에 그 길이 안 된다는 결론**을 내고
 *    `collect-guard-store.mts` 에 적어 두었다:
 *
 *      "A 와 B 가 같은 stale 을 읽는다 → A 가 교체하고 확인을 통과한다 →
 *       B 가 **과거 관측을 근거로** 다시 교체한다. A 의 확인은 이미 지나갔다.
 *       재확인·token·rename 을 어떻게 조합해도 안 된다 —
 *       검사를 하나 더 붙일 때마다 그 검사와 다음 조작 사이가 새 창이 된다."
 *
 *    그래서 여기서도 **같은 결론을 그대로 쓴다.** 새 프로토콜을 만들지 않는다.
 *
 * 🔴 **불변식 A — 락은 진짜로 배타적이다**
 *    · 생기는 길은 `wx` **하나뿐**이다 (원자적 · 승자 하나)
 *    · 사라지는 길은 **주인의 token 대조 삭제** 하나뿐이다
 *    · rename 하거나 시효로 뺏는 코드는 **없다**
 *    ⇒ 획득 경로에 관측→조작 쌍이 아예 없다. TOCTOU 가 생길 자리가 없다.
 *
 * 🔴 **release 의 창도 이것으로 닫힌다.**
 *    `readLock → unlink` 사이에 후임이 생기려면 누군가 내 락을 지워야 하는데,
 *    지우는 길은 token 대조 삭제뿐이고 내 token 은 나만 안다.
 *    자동 회수를 없앤 순간 그 경쟁 자체가 불가능해진다.
 *
 * 🔴 **치르는 대가: 쥔 채로 죽으면 자동으로 풀리지 않는다.**
 *    그때 이 수집은 **멈춘다**(fail-closed). 뺏는 것보다 멈추는 것이 낫다 —
 *    뺏으면 두 프로세스가 같이 들어가 남의 서버에 두 배로 요청한다.
 *    남은 락은 `lockAnomaly` 가 **사람이 봐야 할 이상**으로 낸다.
 */
import { writeFileSync, readFileSync, unlinkSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

export type LockHandle = { path: string; token: string }

export type AcquireResult =
  | { ok: true; handle: LockHandle }
  | {
    ok: false
    /** 🔴 살아 있어서 진 것과, 죽은 락이 남아 사람이 필요한 것은 다르다 */
    kind: 'HELD' | 'STALE_HELD' | 'UNREADABLE'
    reason: string
    heldForMs: number | null
  }

type LockBody = { token: string; pid: number; at: string }

function readLock(path: string): LockBody | null {
  try {
    const j = JSON.parse(readFileSync(path, 'utf-8')) as Partial<LockBody>
    return typeof j.token === 'string' && typeof j.at === 'string'
      ? { token: j.token, pid: typeof j.pid === 'number' ? j.pid : -1, at: j.at }
      : null
  } catch { return null }
}

const errnoOf = (e: unknown): string =>
  (e !== null && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '')

/**
 * 🔴 **획득 — 길은 `wx` 하나뿐이다.**
 *
 *    `EEXIST` 면 그대로 실패다. 살아 있든 시효가 지났든
 *    **rename 하지도 삭제하지도 않는다.** 부르는 쪽은 물러난다.
 */
export function acquireLock(path: string, nowMs: number, maxAgeMs: number): AcquireResult {
  const token = randomUUID()
  const body: LockBody = { token, pid: process.pid, at: new Date(nowMs).toISOString() }
  try {
    writeFileSync(path, JSON.stringify(body), { flag: 'wx', mode: 0o600 })
    return { ok: true, handle: { path, token } }
  } catch (e) {
    if (errnoOf(e) !== 'EEXIST') {
      return { ok: false, kind: 'UNREADABLE', reason: `락을 만들지 못했다 — ${errnoOf(e)}`, heldForMs: null }
    }
  }

  // 🔴 남의 락이다. **손대지 않는다.** 나이만 읽어 사람에게 알린다
  const held = readLock(path)
  const mtime = ((): number | null => {
    try { return statSync(path).mtimeMs } catch { return null }
  })()
  const startedAt = held === null ? mtime : Date.parse(held.at)
  const age = startedAt === null || Number.isNaN(startedAt) ? null : nowMs - startedAt

  if (age === null) {
    return {
      ok: false,
      kind: 'UNREADABLE',
      reason: '락이 있는데 나이를 읽지 못했다 — 살아 있다고 본다(fail-closed)',
      heldForMs: null,
    }
  }
  if (age <= maxAgeMs) {
    return {
      ok: false,
      kind: 'HELD',
      reason: `다른 실행이 ${Math.round(age / 60_000)}분째 쥐고 있다 (TTL ${Math.round(maxAgeMs / 60_000)}분)`,
      heldForMs: age,
    }
  }
  /**
   * 🔴 **시효가 지났어도 뺏지 않는다.**
   *    뺏는 순간 관측→조작 창이 열리고, 그 창이 두 회차를 동시에 들여보낸다.
   *    멈추고 사람을 부른다.
   */
  return {
    ok: false,
    kind: 'STALE_HELD',
    reason: `죽은 것으로 보이는 락이 ${Math.round(age / 60_000)}분째 남아 있다`
      + ' — 🔴 자동으로 뺏지 않는다(뺏으면 두 회차가 같이 들어간다). 사람이 치운다',
    heldForMs: age,
  }
}

export type ReleaseResult = 'RELEASED' | 'NOT_MINE' | 'ABSENT' | 'ERROR'

/**
 * 🔴 **내 락일 때만 지운다.**
 *
 *    자동 회수를 없앴으므로, 내가 쥔 동안 남이 그 자리를 비울 수 없다 —
 *    비우려면 token 대조 삭제가 필요한데 그 token 은 나만 안다.
 *    그래서 `read → unlink` 사이에 후임이 끼어들 수 없다.
 */
export function releaseLock(handle: LockHandle): ReleaseResult {
  const held = readLock(handle.path)
  if (held === null) {
    try { statSync(handle.path); return 'NOT_MINE' } catch { return 'ABSENT' }
  }
  if (held.token !== handle.token) return 'NOT_MINE'
  try { unlinkSync(handle.path); return 'RELEASED' } catch { return 'ERROR' }
}

/** 🔴 시험·관제용 — 지금 락을 쥔 token (없으면 null) */
export function currentLockToken(path: string): string | null {
  return readLock(path)?.token ?? null
}

/**
 * 🔴 **남아 있는 죽은 락은 사람이 봐야 할 운영 이상이다.**
 *    자동으로 회수하지 않으므로, 관제가 이것을 내지 않으면 조용히 멈춘 채로 남는다.
 */
export type LockAnomaly = { path: string; ageMs: number | null; detail: string }

export function lockAnomaly(path: string, nowMs: number, maxAgeMs: number): LockAnomaly | null {
  const held = readLock(path)
  const mtime = ((): number | null => {
    try { return statSync(path).mtimeMs } catch { return null }
  })()
  if (held === null && mtime === null) return null
  const startedAt = held === null ? mtime : Date.parse(held.at)
  if (startedAt === null || Number.isNaN(startedAt)) {
    // 🔴 나이를 모르면 항상 이상으로 본다 — 모르는 것을 정상이라고 하지 않는다
    return { path, ageMs: null, detail: '락 나이 미상' }
  }
  const age = nowMs - startedAt
  return age > maxAgeMs
    ? { path, ageMs: age, detail: `pid ${held?.pid ?? -1} · ${Math.round(age / 60_000)}분째` }
    : null
}
