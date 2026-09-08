/**
 * 수집 보호장치 상태 저장 — 🔴 **판정은 하지 않는다. 읽고 쓰고 잠그기만 한다**
 *
 * 🔴 판정부(`src/lib/collect-guard.ts`)는 순수 함수여야 fixture 로 역검증할 수 있다.
 *    시각·파일·잠금은 전부 여기서 들어온다.
 *
 * 🔴 DB 를 쓰지 않는다. 수집기는 DB 를 붙이지 않는 계약이고, 그 계약을 이 파일이 깨면 안 된다.
 *    상태는 `.microseed-data/collect-guard-<source>.json` 한 벌이다.
 *
 * 🔴 **차단기는 날이 바뀌어도 남는다.** 예산만 KST 하루 단위로 초기화한다 —
 *    403 을 자정이 지났다고 잊으면 다음 날 같은 자리에서 다시 맞는다.
 *
 * ─────────────────────────────────────────────────────────
 * 🔴 **왜 잠금이 필요한가** (2026-09-08 재현)
 *
 *    앞으로 82cook 독립 job 과 `supply-autopilot` 이 **같은 상태 파일**을 쓴다.
 *    읽고-판단하고-기록하는 사이에 다른 프로세스가 끼어들면 두 가지가 깨진다.
 *
 *      ① 예산 유실   둘 다 `requestsToday=0` 을 읽고 둘 다 1 을 쓴다 → 2건 보내고 1건으로 기록
 *      ② 시험 중복   둘 다 `half-open` 을 보고 **각자 시험 요청**을 보낸다.
 *                    "한 건만 시험한다" 는 계약이 그 순간 무너진다
 *
 *    그래서 **예약(read-decide-record)을 파일 잠금 안에서 한 번에** 한다.
 *    네트워크 요청은 잠금 **밖**에서 한다 — 남의 서버 응답을 기다리는 동안
 *    다른 job 을 통째로 세우지 않기 위해서다.
 * ─────────────────────────────────────────────────────────
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'

import {
  backoffMs, canRequest, canRetry, classifyFailure, newGuardState,
  recordFailure, recordRequest, recordSuccess, rollBudgetDay,
  type FailureClass, type GuardState, type SourceId,
} from '../../src/lib/collect-guard'

/**
 * 🔴 상태·잠금이 놓이는 뿌리. **운영 기본값은 바뀌지 않는다.**
 *    테스트가 `mkdtemp` 를 주입해 저장소의 `.microseed-data` 를 건드리지 않게 하려고 뺐다.
 */
const DEFAULT_ROOT = './.microseed-data'
let ROOT = DEFAULT_ROOT
export function guardRoot(): string { return ROOT }
export function setGuardRoot(dir: string): void { ROOT = dir }
export function resetGuardRoot(): void { ROOT = DEFAULT_ROOT }

/** 🔴 잠금 시효. 프로세스가 죽어 잠금을 못 놓으면 이만큼 뒤에 뺏는다 */
export const LOCK_TTL_MS = 60_000
/** 잠금을 기다리는 최대 시간 — 넘으면 **요청하지 않고 멈춘다**(fail-closed) */
export const LOCK_WAIT_MS = 15_000
/**
 * 🔴 **reaper 가 "너무 오래 남았다" 고 볼 기준.** reaper 를 쥔 구간에는 `await` 가 하나도 없다 —
 *    실제 점유는 마이크로초다. 그래서 이 값은 실제 점유의 수십만 배로 넉넉히 둔다.
 *
 *    🔴 **이 값을 넘겨도 뺏지 않는다.** 시효는 회수의 근거가 아니라
 *    "사람이 봐야 한다" 는 신호일 뿐이다 — `reaperAnomaly` 참조.
 */
export const REAPER_TTL_MS = 15_000
const LOCK_POLL_MS = 25
const LOCK_POLL_MAX_MS = 400

/** `YYYY-MM-DD` (KST) — 예산 하루의 경계 */
export function kstDayOf(now: Date): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10)
}

export function guardPath(source: SourceId): string {
  return join(ROOT, `collect-guard-${source.replace(/[^a-z0-9]+/gi, '-')}.json`)
}

export function lockPath(source: SourceId): string {
  return `${guardPath(source)}.lock`
}

/**
 * 🔴 **회수(reaper) 잠금.** 이 파일을 **`wx` 로 직접 만든** 프로세스만 `lockPath` 를 **바꿀 수** 있다.
 *    stale 회수와 정상 획득·해제를 한 줄로 세우는 직렬화 지점이다.
 *
 *    🔴 이 파일 자체는 **시효로 회수되지 않는다.** 남아 있으면 사람이 치운다(`reaperAnomaly`).
 */
export function reaperPath(source: SourceId): string {
  return `${guardPath(source)}.reap`
}

/** 🔴 원자적 write — 임시 파일에 쓰고 rename 한다. 반쯤 쓰인 JSON 을 남기지 않는다 */
export function writeGuardAtomic(state: GuardState): void {
  const path = guardPath(state.source)
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf-8')
  renameSync(tmp, path)
}

/**
 * 🔴 **읽기 전용.** 잠그지 않는다 — 관제 화면·dry-run 이 쓰는 경로다.
 *    이 경로는 절대 쓰지 않는다. 쓰는 것은 `withGuardLock` 안에서만 한다.
 */
export function readGuard(source: SourceId, now: Date): GuardState {
  const path = guardPath(source)
  if (!existsSync(path)) return newGuardState(source, kstDayOf(now))
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as GuardState
  if (parsed.source !== source) {
    throw new Error(`${path} 의 source 가 ${parsed.source} 다 — ${source} 상태 파일이 아니다`)
  }
  return rollBudgetDay(parsed, kstDayOf(now))
}

/** 🔴 예전 이름 — 읽기 전용이라는 것이 이름에 드러나도록 `readGuard` 를 쓴다 */
export const loadGuard = readGuard

const lockedSources = new Set<SourceId>()
/** 🔴 내가 지금 쥐고 있는 잠금의 token — 해제할 때 대조한다 */
const myToken = new Map<SourceId, string>()
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * 잠금 파일 내용 — 누가 언제 잡았는지 남긴다.
 *
 * 🔴 `token` 은 **이 획득만의 고유 값**이다. 해제할 때 이것이 맞아야 지운다 —
 *    시효로 잠금을 뺏긴 옛 주인이 뒤늦게 끝나며 **새 주인의 잠금을 지우는 것**을 막는다.
 */
type LockInfo = { pid: number; at: number; host: string; token: string }

/**
 * 🔴 잠금을 읽는다. **읽지 못한 것을 "없다" 로 읽지 않는다.**
 *
 *    `absent` 는 **`ENOENT` 하나뿐**이다. 예전 판은 모든 읽기 실패를 `absent` 로 삼켰다.
 *    그러면 `EACCES`·`EISDIR` 로 못 읽는 잠금이 "없다" 가 되어
 *      · 그 자리에서 `wx` 를 다시 시도하고 → `EEXIST` → 다시 `absent` → …
 *      · `continue` 가 대기·마감 검사를 건너뛰므로 **동기 무한 루프**가 된다.
 *    실측: `EISDIR` 잠금에서 300초를 넘겨도 끝나지 않았고, 이벤트 루프가 굶어
 *    watchdog 타이머조차 뜨지 못했다.
 *
 *    그래서 네 갈래로 나눈다.
 *      `info`       내용을 읽었다 — `at` 으로 나이를 잰다
 *      `unreadable` 내용은 못 읽었지만 **mtime 으로 나이는 안다** — TTL 뒤에만 회수
 *      `opaque`     나이조차 모른다(stat 도 실패) — 🔴 **절대 회수하지 않는다**(fail-closed)
 *      `absent`     ENOENT
 */
type LockRead =
  | { kind: 'info'; info: LockInfo }
  | { kind: 'unreadable'; code: string; ageMs: number }
  | { kind: 'opaque'; code: string }
  | { kind: 'absent' }

const errnoOf = (e: unknown): string => (e as NodeJS.ErrnoException)?.code ?? 'UNKNOWN'

/** 파일 나이 (mtime 기준). stat 도 못 하면 null */
function fileAgeMs(path: string, nowMs: number): number | null {
  try { return nowMs - statSync(path).mtimeMs } catch { return null }
}

function readLockAt(path: string, nowMs: number): LockRead {
  let raw: string
  try { raw = readFileSync(path, 'utf-8') } catch (e) {
    const code = errnoOf(e)
    // 🔴 **ENOENT 만 absent 다.** 나머지는 "모른다" 이고, 모르면 새 실행을 열지 않는다
    if (code === 'ENOENT') return { kind: 'absent' }
    const age = fileAgeMs(path, nowMs)
    return age === null ? { kind: 'opaque', code } : { kind: 'unreadable', code, ageMs: age }
  }
  try {
    const info = JSON.parse(raw) as LockInfo
    if (typeof info?.token === 'string' && typeof info?.at === 'number') return { kind: 'info', info }
  } catch { /* 아래로 떨어진다 */ }
  const age = fileAgeMs(path, nowMs)
  return age === null ? { kind: 'opaque', code: 'CORRUPT' } : { kind: 'unreadable', code: 'CORRUPT', ageMs: age }
}

function readLock(source: SourceId, nowMs: number): LockRead {
  return readLockAt(lockPath(source), nowMs)
}

/**
 * 🔴 회수해도 되는가. **`opaque` 는 언제까지나 아니다** — 나이를 모르는 것을
 *    "오래됐으니 죽었다" 로 읽으면 살아 있는 잠금을 뺏는다.
 */
function isStale(held: LockRead, nowMs: number, ttlMs: number): boolean {
  if (held.kind === 'info') return nowMs - held.info.at > ttlMs
  if (held.kind === 'unreadable') return held.ageMs > ttlMs
  return false
}

// ─────────────────────────────────────────────────────────
// 🔴 **회수(reaper) 잠금 — 이 파일의 핵심** (2026-09-09)
//
//    ① primary 계층의 경쟁 (실측 `MAX_CONCURRENT=2`):
//      A 와 B 가 **같은 stale 잠금을 읽는다** → A 가 지우고 새 잠금을 만든다 →
//      B 가 **과거 관측을 근거로** 지운다(= A 의 새 잠금을 지운다) → B 도 만든다.
//
//    ② reaper 계층의 **똑같은** 경쟁 (실측 `MAX_CONCURRENT=2`, 2026-09-09):
//      "stale reaper 를 교체하고 읽어서 내 token 인지 확인한다" 를 두면,
//      A 가 reaper 를 교체하고 확인을 통과한 **뒤에** B 가 과거 stale 관측으로
//      그 reaper 를 다시 교체한다. A 의 확인은 이미 지나갔다.
//      둘 다 자기가 reaper 주인이라 믿고 둘 다 primary 를 바꿔 들어간다.
//
//    🔴 여기서 얻은 결론: **재확인·token·rename 을 어떻게 조합해도 안 된다.**
//       관측과 조작 사이는 계속 열려 있고, 검사를 하나 더 붙일 때마다
//       그 검사와 다음 조작 사이가 새 창이 된다. 문제를 한 층 아래로 옮길 뿐이다.
//       임시 잠금을 하나 더 두는 것도 같은 이유로 답이 아니다(재귀적으로 옮겨질 뿐).
//
//    그래서 **자동 회수를 없앤다.** reaper 는 `wx` 로만 생기고, 주인만 지운다.
//
//    🔴 불변식 A — **reaper 는 진짜로 배타적이다**
//       · 생기는 길은 `wx` **하나뿐**이다 (원자적 · 승자 하나)
//       · 사라지는 길은 **주인의 token 대조 삭제** 하나뿐이다
//       · reaper 를 rename 하거나 시효로 뺏는 코드는 **없다**
//       ⇒ 획득 경로에 관측→조작 쌍이 아예 없다. TOCTOU 가 생길 자리가 없다.
//
//    🔴 불변식 B — `lockPath` 를 **바꾸는** 길은 둘뿐이다
//       (a) 경로가 **비어 있을 때**의 `wx` 생성 — 원자적이라 승자가 하나뿐이다
//       (b) **`wx` 로 갓 얻은 reaper 를 쥔 채**의 조작 — 불변식 A 로 하나씩 줄을 선다
//       해제(release)도 (b) 다.
//
//    두 주인이 불가능한 이유:
//      · (a)끼리 → `wx` 가 하나만 통과시킨다
//      · (b)끼리 → 불변식 A 가 직렬화한다
//      · (a)와 (b) → (b) 를 쥔 구간에서 경로는 **비지 않는다.**
//        비려면 삭제가 필요한데 삭제는 (b) 이고 그 (b) 는 지금 내가 쥐고 있다.
//      · 회수는 **삭제 후 생성이 아니라 `rename` 한 번의 교체**다 — 비는 순간 자체가 없다.
//
//    🔴 **치르는 대가: reaper 를 쥔 채 죽으면 자동으로 풀리지 않는다.**
//       그 구간에는 `await` 가 없어 실제로는 마이크로초지만 0 은 아니다.
//       그때 이 source 의 수집은 **멈춘다**(fail-closed). 뺏는 것보다 멈추는 것이 낫다 —
//       뺏으면 두 프로세스가 같이 들어가 남의 서버에 두 배로 요청한다.
//       사람 복구 절차: `docs/operations/2026-09-08-d10-activation-prep.md` §12
// ─────────────────────────────────────────────────────────

function reaperBody(nowMs: number, token: string): string {
  return JSON.stringify({ pid: process.pid, at: nowMs, host: 'local', token } satisfies LockInfo)
}

/**
 * 🔴 reaper 를 얻는다. 얻으면 token, 못 얻으면 null. **길은 `wx` 하나뿐이다.**
 *
 *    `EEXIST` 면 그대로 실패다 — 살아 있든 시효가 지났든
 *    **rename 하지도 삭제하지도 않는다.** 부르는 쪽은 물러났다가 다시 온다.
 */
function tryAcquireReaper(source: SourceId, nowMs: number): string | null {
  const token = randomUUID()
  try {
    writeFileSync(reaperPath(source), reaperBody(nowMs, token), { flag: 'wx' })
    return token
  } catch (e) {
    if (errnoOf(e) !== 'EEXIST') throw e
  }
  // 🔴 남의 reaper 다. 시효를 봤든 안 봤든 **손대지 않는다** — 이번 회차는 물러난다
  return null
}

/** 🔴 남아 있는 reaper — 자동 회수하지 않으므로 **사람이 봐야 할 운영 이상**이다 */
export type ReaperAnomaly = { path: string; ageMs: number | null; detail: string }

/**
 * 🔴 시효를 넘겨 남아 있는 reaper 를 찾는다. 없으면 null.
 *
 *    나이를 모르는(`opaque`) reaper 는 **항상 이상으로 본다** — 모르면 정상이라고 하지 않는다.
 */
export function reaperAnomaly(source: SourceId, nowMs: number): ReaperAnomaly | null {
  const path = reaperPath(source)
  const cur = readLockAt(path, nowMs)
  if (cur.kind === 'absent') return null
  if (cur.kind === 'opaque') return { path, ageMs: null, detail: `나이 미상 (${cur.code})` }
  if (cur.kind === 'unreadable') {
    return cur.ageMs > REAPER_TTL_MS ? { path, ageMs: cur.ageMs, detail: cur.code } : null
  }
  const ageMs = nowMs - cur.info.at
  return ageMs > REAPER_TTL_MS ? { path, ageMs, detail: `pid ${cur.info.pid}` } : null
}

/** 🔴 사람이 읽을 문장 — **무엇을 하지 않는지**와 복구 절차를 함께 적는다 */
export function reaperAnomalyMessage(a: ReaperAnomaly): string {
  const age = a.ageMs === null ? '나이 미상' : `${Math.round(a.ageMs / 1000)}초째`
  return `🔴 회수 잠금(reaper)이 ${age} 남아 있다 — ${a.path} (${a.detail}).`
    + ' 이 파일은 **자동으로 회수하지 않는다** — 뺏으면 두 프로세스가 같이 들어간다.'
    + ' 사람 복구: ① 이 source 의 수집 job 을 모두 멈춘다'
    + ' ② 소유 프로세스가 없음을 확인한다 (launchctl list · ps)'
    + ' ③ 그 뒤에만 이 파일을 지운다'
}

/**
 * 🔴 아직 내가 쥐고 있는가 — 파괴적 조작 **직전마다** 확인한다.
 *
 *    불변식 A 가 성립하면 이 검사는 언제나 참이다. 그래도 남긴다 —
 *    사람이 복구 절차로 reaper 를 지운 직후 다른 프로세스가 새로 잡을 수 있다.
 *    🔴 이 검사는 **안전의 근거가 아니다**(근거는 불변식 A 다). 마지막 방어선일 뿐이다.
 */
function stillHoldsReaper(source: SourceId, token: string, nowMs: number): boolean {
  const cur = readLockAt(reaperPath(source), nowMs)
  return cur.kind === 'info' && cur.info.token === token
}

/** 🔴 내 token 일 때만 푼다 — 남의 reaper 를 풀지 않는다 */
function releaseReaper(source: SourceId, token: string, nowMs: number): void {
  if (stillHoldsReaper(source, token, nowMs)) rmSync(reaperPath(source), { force: true })
}

/** 지수 backoff — 🔴 결정적이다(난수 없음). 마감을 넘겨 자지 않는다 */
function pollDelayMs(attempt: number, remainingMs: number): number {
  const raw = Math.min(LOCK_POLL_MAX_MS, LOCK_POLL_MS * 2 ** Math.max(0, attempt - 1))
  return Math.max(1, Math.min(raw, remainingMs))
}

/**
 * 🔴 **파일 단위 잠금.**
 *
 *    · 비어 있으면 `wx` 하나로 끝난다 (경합이 없을 때의 빠른 길)
 *    · 경합하면 **reaper 뒤로 줄을 선다** — 회수·생성·해제가 모두 그 안에서 일어난다
 *    · 기다리다 `waitMs` 를 넘기면 **요청하지 않고 멈춘다**(fail-closed)
 *    · 어떤 실패 경로도 대기·마감 검사를 건너뛰지 않는다 — 무한 루프가 생길 자리가 없다
 */
export async function withGuardLock<T>(
  source: SourceId,
  /**
   * 🔴 **동기 함수만 받는다.** 잠금 안에서 `await` 하면 TTL 을 넘긴 옛 callback 이
   *    회수 뒤에 돌아와 부작용을 만든다. Promise 를 돌려주면 실행 중에 던진다.
   */
  fn: () => T,
  opts: { now?: () => Date; waitMs?: number } = {},
): Promise<T> {
  const now = opts.now ?? ((): Date => new Date())
  const waitMs = opts.waitMs ?? LOCK_WAIT_MS
  const deadline = now().getTime() + waitMs
  const path = lockPath(source)
  mkdirSync(dirname(path), { recursive: true })

  const token = randomUUID()
  const body = (): string => reaperBody(now().getTime(), token)
  let attempt = 0
  /** 마지막으로 본 상태 — 마감 초과 오류에 왜 못 얻었는지 적는다 */
  let lastSeen = 'unknown'
  /** 🔴 reaper 가 이미 있어 물러난 횟수 — 남은 reaper 를 오류에 드러내려고 센다 */
  let reaperBusy = 0
  let acquired = false

  while (!acquired) {
    // ── (a) 빠른 길: 경로가 비어 있으면 `wx` 가 유일한 승자를 정한다 ──
    try {
      writeFileSync(path, body(), { flag: 'wx' })
      acquired = true
      break
    } catch (e) {
      if (errnoOf(e) !== 'EEXIST') throw e
    }

    // ── (b) 경합: `wx` 로 reaper 를 **새로 얻은** 프로세스만 `lockPath` 를 바꾼다 ──
    const nowMs = now().getTime()
    const reap = tryAcquireReaper(source, nowMs)
    if (reap === null) {
      // 🔴 reaper 가 이미 있다. **살아 있든 시효가 지났든 뺏지 않는다** — 물러났다 다시 온다
      reaperBusy += 1
    } else {
      try {
        const held = readLock(source, nowMs)
        lastSeen = held.kind === 'info' ? `info(age ${nowMs - held.info.at}ms)` : held.kind
        if (held.kind === 'absent') {
          // 🔴 reaper 를 쥔 채로 만든다. 해제도 reaper 를 요구하므로 이 사이에 비지 않는다
          if (stillHoldsReaper(source, reap, nowMs)) {
            try { writeFileSync(path, body(), { flag: 'wx' }); acquired = true }
            catch (e) { if (errnoOf(e) !== 'EEXIST') throw e }
          }
        } else if (isStale(held, nowMs, LOCK_TTL_MS) && stillHoldsReaper(source, reap, nowMs)) {
          /**
           * 🔴 **원자적 교체.** 지우고 만들지 않는다 — 비는 순간이 있으면
           *    그 틈에 빠른 길이 끼어들고, 우리가 그 새 잠금을 덮게 된다.
           */
          const tmp = `${path}.tmp-${process.pid}-${token.slice(0, 8)}`
          writeFileSync(tmp, body())
          renameSync(tmp, path)
          acquired = true
        }
      } finally {
        releaseReaper(source, reap, now().getTime())
      }
      if (acquired) break
    }

    // ── 대기 — 🔴 **모든 실패 경로가 여기를 지난다** ──
    const remaining = deadline - now().getTime()
    if (remaining <= 0) {
      // 🔴 남은 reaper 가 원인일 수 있다 — 그렇다면 **운영 조치까지** 오류에 적는다
      const anomaly = reaperAnomaly(source, now().getTime())
      throw new Error(`${source} 보호장치 잠금을 ${waitMs}ms 안에 얻지 못했다`
        + ` (마지막 관측: ${lastSeen} · 회수 잠금에 막힘 ${reaperBusy}회)`
        + ' — 이번 회차는 요청하지 않는다'
        + (anomaly === null ? '' : `\n   ${reaperAnomalyMessage(anomaly)}`))
    }
    attempt += 1
    await sleep(pollDelayMs(attempt, remaining))
  }

  lockedSources.add(source)
  myToken.set(source, token)
  try {
    const out = fn()
    /**
     * 🔴 **잠금을 쥔 채 이벤트 루프를 놓지 않는다.**
     *    `await` 가 하나라도 있으면 잠금이 TTL(60초)을 넘길 수 있고, 그러면 남이 회수한 뒤에
     *    **옛 callback 이 뒤늦게 돌아와** 부작용을 만든다. 상태 처리는 동기로 끝내고,
     *    네트워크·대기는 잠금 **밖**에서 한다(`guardedGet`·`guardedNavigate` 가 그 구조다).
     *    🔴 타입만으로는 async 함수를 막지 못하므로 **실행으로** 막는다.
     */
    if (typeof (out as { then?: unknown } | null | undefined)?.then === 'function') {
      throw new Error(`${source} 잠금 안에서 Promise 를 돌려줬다`
        + ' — 상태 처리는 동기여야 한다. 네트워크·대기는 잠금 밖에서 한다')
    }
    return out
  } finally {
    lockedSources.delete(source)
    myToken.delete(source)
    await releasePrimary(source, token, now, waitMs)
  }
}

/**
 * 🔴 해제도 **reaper 안에서** 한다.
 *
 *    해제가 reaper 밖에 있으면, 회수 판정을 하는 프로세스의 눈앞에서 경로가 비고
 *    그 틈에 빠른 길이 새 잠금을 만들어, 회수자가 **그 새 잠금을 덮는다.**
 *    그래서 해제도 같은 줄에 세운다. token 이 내 것일 때만 지운다.
 *
 *    🔴 못 풀면 **강제로 지우지 않는다**(fail-closed). 그 뒤 일어나는 일은 두 갈래다.
 *      · reaper 가 남지 않았다 → TTL 이 지나면 다른 프로세스가 새 reaper 를 `wx` 로 얻어 회수한다
 *      · 🔴 **reaper 가 남았다 → 자동 회수는 없다.** 그 source 의 수집은 멈추고 사람이 치운다
 *        (MASTER §8.4 · runbook §12). "TTL 뒤에 알아서 풀린다" 고 적으면 거짓이다.
 */
async function releasePrimary(
  source: SourceId, token: string, now: () => Date, waitMs: number,
): Promise<void> {
  const deadline = now().getTime() + waitMs
  let attempt = 0
  for (;;) {
    const nowMs = now().getTime()
    const reap = tryAcquireReaper(source, nowMs)
    if (reap !== null) {
      try {
        if (stillHoldsReaper(source, reap, nowMs)) {
          const cur = readLock(source, nowMs)
          if (cur.kind === 'info' && cur.info.token === token) rmSync(lockPath(source), { force: true })
          return
        }
      } finally {
        releaseReaper(source, reap, now().getTime())
      }
    }
    const remaining = deadline - now().getTime()
    if (remaining <= 0) {
      // 🔴 못 풀었다. **강제로 지우지 않는다** — 대신 왜 못 풀었는지 사람에게 남긴다.
      //    🔴 **"TTL 뒤에 알아서 회수된다" 고 적지 않는다** — reaper 가 남았으면 거짓이다.
      //       reaper 가 없을 때만 다른 프로세스가 새 reaper 를 얻어 회수한다.
      const anomaly = reaperAnomaly(source, now().getTime())
      // 🔴 세 갈래를 구분한다. "reaper 가 없다" 와 "있지만 아직 시효 전이다" 는 다른 상황이다
      const after = anomaly !== null
        ? `   ${reaperAnomalyMessage(anomaly)}\n`
          + '   🔴 이 상태에서는 잠금이 **자동으로 회수되지 않는다** — 사람이 치울 때까지 수집이 멈춘다\n'
        : existsSync(reaperPath(source))
          ? '   회수 잠금을 남이 쥐고 있다(아직 시효 전) — 그 프로세스가 끝나면 다음 회차에 회수된다\n'
          : '   회수 잠금은 없다 — TTL 뒤 다른 프로세스가 새 reaper 를 얻어 회수한다\n'
      process.stderr.write(`🔴 ${source} 잠금을 ${waitMs}ms 안에 풀지 못했다`
        + ` — ${lockPath(source)} 가 남는다\n${after}`)
      return
    }
    attempt += 1
    await sleep(pollDelayMs(attempt, remaining))
  }
}

/**
 * 🔴 **상태를 쓰는 유일한 관문 — fencing 한다.**
 *
 *    🔴 **2026-09-09 재현**: `lockedSources.has(source)` 만 보던 판은
 *    **승계당한 옛 owner 의 write 를 받아들였다**(`staleOwnerWriteAccepted = true`).
 *    `myToken` 을 들고만 있고 실제 잠금 파일의 token 과 대조하지 않았기 때문이다.
 *    그 판에서는 시효로 잠금을 뺏긴 프로세스가 **새 주인의 예산·차단기를 덮어쓴다** —
 *    2건 보내고 1건으로 기록하거나, 열린 403 차단기를 닫힌 것으로 되돌린다.
 *
 *    그래서 write 직전에 **fence** 한다.
 *      ① `wx` 로 **새 reaper** 를 얻는다 — 못 얻으면 쓰지 않고 던진다(fail-closed)
 *      ② reaper 안에서 실제 primary 의 token 이 내 token 인지 확인한다
 *      ③ 같을 때만 쓴다. 다르거나 읽을 수 없거나 없으면 쓰지 않고 던진다
 *      ④ `finally` 에서 **내 reaper 만** 푼다
 *
 *    🔴 **"token 을 읽고 바로 쓴다" 는 다시 TOCTOU 다** — 읽기와 쓰기 사이에 회수가 끼어들면
 *    내가 이미 옛 주인이 된 채로 쓴다. 회수는 reaper 를 요구하므로(불변식 B),
 *    확인과 write 를 **같은 reaper 구간 안**에 두면 그 사이에 회수가 들어올 수 없다.
 *
 *    🔴 stale reaper 자동 회수 금지 계약은 그대로다 — 여기서도 `wx` 로만 얻고 뺏지 않는다.
 */
export function saveGuard(state: GuardState): void {
  const source = state.source
  if (!lockedSources.has(source)) {
    throw new Error(`${source} 상태를 잠금 없이 저장하려 했다 — withGuardLock 안에서만 쓴다`)
  }
  const token = myToken.get(source)
  if (token === undefined) {
    throw new Error(`${source} 상태를 저장하려는데 내 잠금 token 이 없다 — 쓰지 않는다(fail-closed)`)
  }
  const nowMs = Date.now()
  const reap = tryAcquireReaper(source, nowMs)
  if (reap === null) {
    // 🔴 지금 누가 회수를 돌리고 있을 수 있다. 뺏지 않고, 쓰지도 않는다
    const anomaly = reaperAnomaly(source, nowMs)
    throw new Error(`${source} 상태를 저장할 회수 잠금을 얻지 못했다 — 쓰지 않는다(fail-closed)`
      + (anomaly === null ? '' : `\n   ${reaperAnomalyMessage(anomaly)}`))
  }
  try {
    const held = readLock(source, nowMs)
    if (held.kind !== 'info') {
      throw new Error(`${source} 잠금을 확인할 수 없다 (${held.kind}) — 상태를 쓰지 않는다(fail-closed)`)
    }
    if (held.info.token !== token) {
      throw new Error(`${source} 잠금이 이미 다른 프로세스(pid ${held.info.pid})에게 넘어갔다`
        + ' — 승계당한 옛 주인은 상태를 쓰지 않는다(fail-closed)')
    }
    // 🔴 확인과 write 가 **같은 reaper 구간 안**이다 — 그 사이에 회수가 끼어들 수 없다
    writeGuardAtomic(state)
  } finally {
    releaseReaper(source, reap, Date.now())
  }
}

export type Reservation = { ok: true; state: GuardState } | { ok: false; reason: string }

/**
 * 🔴 **예약 — 읽고·판단하고·기록하는 것을 잠금 안에서 한 번에 한다.**
 *    이 셋이 갈라져 있으면 두 프로세스가 같은 예산과 같은 시험 자리를 두 번 쓴다.
 */
export async function reserveRequest(source: SourceId, now: Date): Promise<Reservation> {
  return withGuardLock(source, () => {
    const state = readGuard(source, now)
    const gate = canRequest(state, now.getTime())
    if (!gate.ok) return { ok: false as const, reason: gate.reason }
    // 🔴 여기서 예산을 쓰고 half-open 이면 "시험 중" 을 함께 박는다
    const next = recordRequest(state, now.getTime())
    saveGuard(next)
    return { ok: true as const, state: next }
  })
}

/** 🔴 결과 기록 — 역시 잠금 안이다. 다른 프로세스가 그 사이 올린 예산을 덮지 않는다 */
export async function settleRequest(
  source: SourceId,
  now: Date,
  outcome: { ok: true } | { ok: false; cls: FailureClass },
): Promise<GuardState> {
  return withGuardLock(source, () => {
    const fresh = readGuard(source, now)
    const next = outcome.ok ? recordSuccess(fresh) : recordFailure(fresh, outcome.cls, now.getTime())
    saveGuard(next)
    return next
  })
}

export type GuardedFetchResult = { text: string; state: GuardState }

/**
 * 🔴 **보호장치를 통과한 요청 하나.**
 *
 *    ① **잠금 안에서** 예산·차단기를 보고 예약한다 — 막혀 있으면 요청을 보내지 않고 던진다
 *    ② 네트워크 요청은 **잠금 밖**에서 한다 (남의 서버를 기다리는 동안 다른 job 을 세우지 않는다)
 *    ③ 결과를 다시 **잠금 안에서** 기록한다
 *    ④ 실패하면 분류별 지수 backoff 만큼 물러난 뒤 ①부터 다시 — 그때도 차단기를 다시 본다
 *    ⑤ 403 은 재시도하지 않는다(`BACKOFF.FORBIDDEN.maxAttempts = 0`) — 두드릴수록 나빠진다
 */
export async function guardedGet(input: {
  url: string
  source: SourceId
  now: () => Date
  headers: Record<string, string>
  /** 테스트에서 갈아 끼운다. 기본은 전역 fetch */
  fetchImpl?: typeof fetch
  /** 물러나는 동안 사람에게 보이는 로그 */
  log?: (m: string) => void
}): Promise<GuardedFetchResult> {
  const doFetch = input.fetchImpl ?? fetch
  const log = input.log ?? ((): void => {})
  let attempt = 0

  for (;;) {
    const reserved = await reserveRequest(input.source, input.now())
    if (!reserved.ok) {
      throw new Error(`수집 보호장치가 막았다 — ${reserved.reason} (${input.url})`)
    }

    let cls: FailureClass | null = null
    let detail = ''
    try {
      const res = await doFetch(input.url, { headers: input.headers })
      if (res.ok) {
        const text = await res.text()
        const state = await settleRequest(input.source, input.now(), { ok: true })
        return { text, state }
      }
      cls = classifyFailure({ status: res.status })
      detail = `HTTP ${res.status}`
    } catch (e) {
      const err = e as { code?: string; cause?: { code?: string }; message?: string }
      cls = classifyFailure({ code: err.code ?? err.cause?.code ?? err.message ?? null })
      detail = err.message ?? String(e)
    }

    const after = await settleRequest(input.source, input.now(), { ok: false, cls })
    attempt += 1
    if (!canRetry(cls, attempt)) {
      throw new Error(`${input.url} → ${detail} (${cls}) — 재시도 상한. 차단기 상태를 남겼다`)
    }
    const wait = backoffMs(cls, attempt, after.requestsToday)
    log(`   ⏳ ${cls} ${detail} — ${Math.round(wait / 1000)}초 물러난 뒤 ${attempt + 1}번째 시도`)
    await sleep(wait)
  }
}

/**
 * 🔴 **Playwright 경로도 같은 보호장치를 지난다** (2026-09-08).
 *
 *    82cook 은 `fetch` 라 `guardedGet` 으로 감쌌지만, Naver 카페는 Playwright 라
 *    그 경로가 **보호장치를 통째로 우회**했다. 그 상태에서 "source 별 보호장치 구현 완료" 라고
 *    적으면 문서가 거짓이 된다 — 그래서 목록·상세 이동을 여기서 감싼다.
 *
 *    🔴 `page.goto` 는 `Response | null` 을 준다. 상태 코드가 있으면 그것이 분류의 정본이고,
 *       연결 자체가 안 되면 오류 코드로 분류한다(403 과 TCP 를 합치지 않는다).
 */
export type NavigationResponse = { status: () => number } | null

export function classifyNavigation(input: { status?: number | null; error?: unknown }): FailureClass | null {
  if (input.error !== undefined && input.error !== null) {
    const e = input.error as { code?: string; cause?: { code?: string }; message?: string }
    // 🔴 Playwright timeout 은 연결/응답이 늦은 것이다 — TCP 계열로 본다
    const raw = e.code ?? e.cause?.code ?? e.message ?? ''
    if (/timeout/i.test(raw)) return 'NETWORK'
    return classifyFailure({ code: raw })
  }
  const s = input.status ?? null
  if (s === null) return null
  if (s >= 200 && s < 400) return null
  return classifyFailure({ status: s })
}

/**
 * 🔴 보호장치를 지나는 페이지 이동 하나.
 *
 *    예약 → 이동 → 결과 기록. `guardedGet` 과 **같은 계약**이고 같은 상태 파일을 쓴다.
 *    🔴 재시도는 하지 않는다 — 브라우저 세션은 재시도가 싸지 않고, 실패는 차단기가 센다.
 */
export async function guardedNavigate(input: {
  url: string
  source: SourceId
  now: () => Date
  goto: (url: string) => Promise<NavigationResponse>
}): Promise<{ response: NavigationResponse; state: GuardState }> {
  const reserved = await reserveRequest(input.source, input.now())
  if (!reserved.ok) {
    throw new Error(`수집 보호장치가 막았다 — ${reserved.reason} (${input.url})`)
  }
  let response: NavigationResponse = null
  try {
    response = await input.goto(input.url)
  } catch (e) {
    const cls = classifyNavigation({ error: e }) ?? 'OTHER'
    await settleRequest(input.source, input.now(), { ok: false, cls })
    throw e
  }
  const cls = classifyNavigation({ status: response === null ? null : response.status() })
  const state = cls === null
    ? await settleRequest(input.source, input.now(), { ok: true })
    : await settleRequest(input.source, input.now(), { ok: false, cls })
  if (cls !== null) {
    throw new Error(`${input.url} → HTTP ${response?.status()} (${cls}) — 차단기 상태를 남겼다`)
  }
  return { response, state }
}
