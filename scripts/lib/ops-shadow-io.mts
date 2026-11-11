/**
 * 🔴 **ops shadow — 관측 조립 · 부작용 차단 · 저장소 밖 append-only 감사 장부** (2026-11-11 · Phase 1 S1/S2)
 *
 *    계산은 `src/lib/ops-shadow-plan.ts` 하나가 한다. 이 파일은 **지금 권위가 이미 쓰는 판독기**로 관측을 모으고,
 *    결과를 저장소 밖 한 디렉터리의 일별 jsonl 에 덧붙일 뿐이다. 권위는 0 이다.
 *
 *    🔴 **실행이 구조적으로 불가능하다** — `installShadowCallGuard` 가 fetch · 자식 프로세스를 막고,
 *       `readOnlyDb` 가 모든 DB 쓰기 · raw · 트랜잭션을 막는다. shadow CLI 는 이 둘을 **먼저** 건 뒤에만 읽는다.
 *    🔴 판독기는 운영과 같은 것을 부른다: `snapshot`(supply-process) · `tallyOf`·`classifyReservations`(llm-ledger) ·
 *       `readSettleHold`·`readOpenReservations`·`pidAlive`(llm-ledger-store) · `readSpeakerLoad` · `createAttemptPool` ·
 *       `readStageDecision` · `readStageEvidenceFacts`. 덧붙이기 잠금은 장부와 같은 `withLedgerLock` 이다.
 */
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { homedir, userInfo } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runIdStartMs, type ShadowRecord, type SupplyRunView } from '../../src/lib/ops-shadow-plan'
import { naturalScheduledRunEvidenceAt } from '../../src/lib/supply-run-token'
import { pidAlive, withLedgerLock } from './llm-ledger-store.mjs'

/** 🔴 감사 장부 디렉터리 — 저장소 밖 · 운영 데이터 정본 옆(Application Support) */
export const OPS_SHADOW_DIR_NAME = 'ops-shadow'
export function defaultOpsShadowDir(home: string = homedir()): string {
  return join(home, 'Library', 'Application Support', 'soransoran', OPS_SHADOW_DIR_NAME)
}

/**
 * 🔴 **주입 시각(`--now`)은 버려도 되는 격리 시험에서만** (2026-11-11 · Phase 2 반론 U2).
 *    주입 시각은 "그 시각에 보았다" 를 적는데, 관측 재료(DB · StageDecision · LLM 장부 · 공급 기록)는 **지금** 것이다.
 *    운영 DB · 실제 홈의 장부로 지난 시각의 관측 · dayClose 를 재구성하면 거짓 기록이 된다. 그래서 주입 시각은
 *    ① `SORAN_ISOLATED_DB=yes-throwaway` ② DB 주소 둘 다 localhost 의 `soran_test` ③ HOME 이 실제 계정 홈이 아님 — 셋이 모두일 때만 받는다.
 *    🔴 `fillDbConnection` 이 env 파일로 빈 주소를 채우기 **전에** 판정한다(빈 주소는 격리가 아니다).
 */
export function injectedClockProblems(env: NodeJS.ProcessEnv, home: string = homedir(), realHome: string = userInfo().homedir): string[] {
  const out: string[] = []
  const isolated = (v: string | undefined): boolean => /^postgresql:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\/soran_test(\?|$)/.test(v ?? '')
  if ((env.SORAN_ISOLATED_DB ?? '').trim() !== 'yes-throwaway') out.push('SORAN_ISOLATED_DB=yes-throwaway 가 없다')
  if (!isolated(env.DATABASE_URL)) out.push('DATABASE_URL 이 localhost 의 soran_test 가 아니다')
  if (!isolated(env.DIRECT_URL)) out.push('DIRECT_URL 이 localhost 의 soran_test 가 아니다')
  if (home === realHome) out.push('HOME 이 실제 계정 홈이다 — 운영 장부 · 공급 기록을 지난 시각처럼 읽는다')
  return out
}

/**
 * 🔴 **배포 중이면 observer 는 아무것도 하지 않는다** — runtime:deploy 의 잠금(`runtime-deploy.lock`)이 있으면
 *    tick 을 바로 끝낸다(감사 장부 디렉터리 · 잠금 · DB · 공급 기록 0). 배포가 observer 를 bootout 하기 전의 틈에도
 *    새 tick 이 일을 시작하지 않게 — 배포기 자체의 판정(실행 중이면 멈춤 · bootout · 되올림)은 바꾸지 않는다.
 */
export const RUNTIME_DEPLOY_LOCK_NAME = 'runtime-deploy.lock'
export function deployLockPresent(home: string = homedir()): boolean {
  return existsSync(join(home, 'Library', 'Application Support', 'soransoran', RUNTIME_DEPLOY_LOCK_NAME))
}

/** 이 저장소의 뿌리 — 감사 장부가 저장소 안에 생기지 않게 막는 데만 쓴다 */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const real = (p: string): string => {
  // 아직 없는 경로는 가장 가까운 존재하는 조상으로 실경로를 구한다(심볼릭 우회 차단)
  let cur = resolve(p)
  const tail: string[] = []
  while (!existsSync(cur)) {
    const up = dirname(cur)
    if (up === cur) break
    tail.unshift(cur.slice(up.length + 1))
    cur = up
  }
  return join(realpathSync(cur), ...tail)
}

/** 🔴 감사 장부 경로 판정 — 저장소 안이면 거부한다. 이름이 `ops-shadow` 인 디렉터리만 받는다 */
export function assertShadowDir(dir: string): string {
  const d = real(dir)
  const root = real(REPO_ROOT)
  if (d === root || d.startsWith(root + sep)) throw new Error(`OPS_SHADOW_IN_REPO: ${d}`)
  if (d.split(sep).pop() !== OPS_SHADOW_DIR_NAME) throw new Error(`OPS_SHADOW_BAD_DIR: ${d}`)
  return d
}

/**
 * 🔴 **append-only · 사이클 하나에 한 줄** — 같은 `cycleId` 가 이미 있으면 쓰지 않는다(재실행 · 동시 기상 안전).
 *    확인과 덧붙이기를 **장부와 같은 잠금**(`withLedgerLock` · 배타 생성 · 대기 상한 · 오래된 잠금은 빼앗지 않고 실패)
 *    한 구간에서 한다. 잠금을 못 잡으면 던진다(그 사이클은 기록되지 않는다 — 두 줄보다 안전하다).
 *    덮어쓰지 않는다 · 지우지 않는다. 파일은 KST 날짜별 하나다.
 */
/**
 * 🔴 **observer 단일 실행 잠금** (2026-11-11 · causal/backfill 경계 경합) — tick 전체(선택 → 기록)를 감싼다.
 *    완료 +4:59 에 causal 을 고른 observer 가 아직 DB 를 읽는 동안 +5:01 tick 이 같은 회차를 backfill 로 골라
 *    marker 가 먼저 잠금을 잡으면, 같은 cycle id 라 더 풍부한 causal 기록이 영영 못 들어간다.
 *    launchd 는 같은 label 을 겹쳐 띄우지 않지만 손 실행과 launchd tick 은 겹칠 수 있다 — 그래서 여기서 막는다.
 *
 * 🔴 **죽은 잠금 정리 계약** — 정리와 획득을 나눈다(지우고 다시 거는 사이에 남의 새 잠금을 지우는 경합 0).
 *    · 잠금 · claim 은 내용을 다 쓴 임시 파일을 `link` 로 건다(EEXIST 면 남의 것) · 내용에 nonce 가 있어 원문이 유일하다
 *    · 정리 claim(`.observer-cleanup.lock`)이 있으면 잡으려는 쪽은 **물러난다**(이번 tick 0)
 *    · 죽은 pid · 깨진 잠금을 본 쪽은 claim 을 **하나만** 잡고, claim 안에서 잠금 원문이 처음 본 원문과 **바이트로 같고**
 *      여전히 죽었을 때만 지운다 · claim 을 풀고 **이번 tick 은 잡지 않는다**(다음 tick 이 잡는다)
 *    · 잠금이 있는 동안 아무도 새 잠금을 걸 수 없고 살아 있는 주인은 자기 원문만 지우므로, 재검증과 삭제 사이에 바뀔 수 없다
 *    · 풀 때는 원문이 내 것일 때만 지운다
 *    · 🔴 정리 claim 의 주인이 죽어 남으면(정리 중 크래시) **자동으로 지우지 않는다** — `cleanupStranded` 로 tick 을 실패시킨다
 *      (같은 경합이 claim 에서 되풀이되므로 사람이 확인하고 지운다)
 */
export const OBSERVER_LOCK_FILE = '.observer.lock'
export const OBSERVER_CLEANUP_FILE = '.observer-cleanup.lock'
export type ObserverLockReason = 'busy' | 'cleanupInProgress' | 'cleaned' | 'cleanupStranded' | 'raced'
export type ObserverLock =
  | { acquired: true; release: () => void }
  | { acquired: false; reason: ObserverLockReason; holderPid: number | null }

const readRaw = (path: string): string | null => {
  try { return readFileSync(path, 'utf-8') } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}
const pidOfRaw = (raw: string | null): number | null => {
  if (raw === null) return null
  try {
    const pid = (JSON.parse(raw) as { pid?: unknown }).pid
    return typeof pid === 'number' && Number.isInteger(pid) && pid > 0 ? pid : null
  } catch { return null }
}
const ownerRaw = (): string => JSON.stringify({ pid: process.pid, at: new Date().toISOString(), nonce: randomUUID() })
/** 내용을 다 쓴 임시 파일을 원자적으로 건다 — 이미 있으면 false. 임시 이름은 `.tmp-` 를 품어 호스트 이전이 싣지 않는다 */
function linkExclusive(d: string, path: string, raw: string): boolean {
  const tmp = join(d, `.observer.tmp-${process.pid}-${randomUUID()}`)
  writeFileSync(tmp, raw, { mode: 0o600 })
  try { linkSync(tmp, path); return true } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw e
  } finally { unlinkSync(tmp) }
}
const unlinkIfRaw = (path: string, raw: string): boolean => {
  if (readRaw(path) !== raw) return false
  unlinkSync(path)
  return true
}

/**
 * 죽은 잠금 정리 — **claim 하나** 안에서 재검증한 뒤 처음 본 원문(`seenRaw`)만 지운다. 이번 tick 은 잡지 않는다.
 *    (검사가 경합 순서를 직접 만들려고 export 한다)
 */
export function cleanupStaleObserverLock(dir: string, seenRaw: string): ObserverLock {
  const d = assertShadowDir(dir)
  const lockPath = join(d, OBSERVER_LOCK_FILE)
  const claimPath = join(d, OBSERVER_CLEANUP_FILE)
  const claim = ownerRaw()
  if (!linkExclusive(d, claimPath, claim)) return { acquired: false, reason: 'cleanupInProgress', holderPid: pidOfRaw(readRaw(claimPath)) }
  try {
    const now = readRaw(lockPath)
    const pid = pidOfRaw(now)
    if (now !== seenRaw || (pid !== null && pidAlive(pid))) return { acquired: false, reason: 'raced', holderPid: pid }
    unlinkSync(lockPath)
    return { acquired: false, reason: 'cleaned', holderPid: pid }
  } finally { unlinkIfRaw(claimPath, claim) }
}

export function acquireObserverLock(dir: string): ObserverLock {
  const d = assertShadowDir(dir)
  mkdirSync(d, { recursive: true, mode: 0o700 })
  const lockPath = join(d, OBSERVER_LOCK_FILE)
  const claimPath = join(d, OBSERVER_CLEANUP_FILE)
  // ① 정리 중이면 물러난다 — 주인이 죽은 claim 은 지우지 않고 실패로 알린다
  const claimRaw = readRaw(claimPath)
  if (claimRaw !== null) {
    const pid = pidOfRaw(claimRaw)
    return { acquired: false, reason: pid !== null && pidAlive(pid) ? 'cleanupInProgress' : 'cleanupStranded', holderPid: pid }
  }
  // ② 건다
  const mine = ownerRaw()
  if (linkExclusive(d, lockPath, mine)) return { acquired: true, release: () => { unlinkIfRaw(lockPath, mine) } }
  // ③ 남의 잠금 — 살아 있으면 물러나고, 죽었거나 깨졌으면 정리만 한다(이번 tick 은 잡지 않는다)
  const seen = readRaw(lockPath)
  if (seen === null) return { acquired: false, reason: 'raced', holderPid: null }
  const pid = pidOfRaw(seen)
  if (pid !== null && pidAlive(pid)) return { acquired: false, reason: 'busy', holderPid: pid }
  return cleanupStaleObserverLock(d, seen)
}

export function appendShadowRecord(dir: string, record: ShadowRecord): { written: boolean; path: string } {
  const d = assertShadowDir(dir)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.kstDate)) throw new Error('OPS_SHADOW_BAD_DATE')
  mkdirSync(d, { recursive: true, mode: 0o700 })
  const path = join(d, `${record.kstDate}.jsonl`)
  return withLedgerLock(d, () => appendLocked(path, record))
}

function appendLocked(path: string, record: ShadowRecord): { written: boolean; path: string } {
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'utf-8').split('\n')) {
      if (line.trim() === '') continue
      let id: unknown = null
      try { id = (JSON.parse(line) as { cycleId?: unknown }).cycleId } catch { throw new Error(`OPS_SHADOW_CORRUPT: ${path}`) }
      if (id === record.cycleId) return { written: false, path }
    }
  }
  appendFileSync(path, `${JSON.stringify(record)}\n`, { encoding: 'utf-8', mode: 0o600, flag: 'a' })
  return { written: true, path }
}

// ─────────────────────────────────────────────────────────
// 부작용 차단
// ─────────────────────────────────────────────────────────

const CHILD_FNS = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'] as const

/**
 * 🔴 **shadow 는 밖으로 아무것도 부르지 않는다** — provider(fetch) · 수집 · 공급 · 발행 · 댓글 러너(자식 프로세스) 전부.
 *    `fetch` 를 던지는 함수로 바꾸고, `child_process` 의 실행 함수를 던지는 함수로 바꾼 뒤 ESM 바인딩까지 맞춘다.
 *    되돌리는 함수를 돌려준다(검사 전용).
 */
let guardInstalled = false
/** 설치마다 늘어나는 세대 — 되돌리는 함수는 **자기 세대가 지금 걸려 있을 때만** 되돌린다 */
let guardGeneration = 0
/** 🔴 공용 사이클(`runShadowCycle`)은 가드가 걸렸을 때만 돈다 — 가드 없이 부르면 던진다 */
export function isShadowGuardInstalled(): boolean { return guardInstalled }

/**
 * 🔴 **중첩 금지** — 이미 걸려 있으면 던진다(두 번째 설치가 "진짜" fetch 대신 첫 가드를 저장했다가
 *    먼저 풀리면 가드가 사라지는 순서 사고를 막는다). 되돌리기는 자기 세대에서 한 번만 — 두 번 · 남의 세대면 던진다.
 */
export function installShadowCallGuard(): () => void {
  if (guardInstalled) throw new Error('OPS_SHADOW_GUARD_NESTED — 가드가 이미 걸려 있다')
  guardInstalled = true
  guardGeneration += 1
  const generation = guardGeneration
  const realFetch = globalThis.fetch
  globalThis.fetch = (() => { throw new Error('OPS_SHADOW_NO_NETWORK') }) as typeof fetch
  const cp = createRequire(import.meta.url)('node:child_process') as Record<string, unknown>
  const saved = new Map<string, unknown>()
  for (const fn of CHILD_FNS) {
    saved.set(fn, cp[fn])
    cp[fn] = () => { throw new Error(`OPS_SHADOW_NO_CHILD_PROCESS: ${fn}`) }
  }
  syncBuiltinESMExports()
  return () => {
    if (!guardInstalled || guardGeneration !== generation) throw new Error('OPS_SHADOW_GUARD_RESTORE_MISUSE — 이미 풀렸거나 다른 설치의 되돌리기다')
    guardInstalled = false
    globalThis.fetch = realFetch
    for (const [k, v] of saved) cp[k] = v
    syncBuiltinESMExports()
  }
}

const WRITE_OPS = new Set([
  'create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'updateManyAndReturn',
  'upsert', 'delete', 'deleteMany',
])
const BLOCKED_ROOT = new Set([
  '$executeRaw', '$executeRawUnsafe', '$queryRaw', '$queryRawUnsafe', '$transaction', '$runCommandRaw',
])

/**
 * 🔴 **읽기 전용 DB** — 모델의 쓰기 연산 · raw · 트랜잭션을 부르면 던진다. 읽기(find · count · aggregate)만 통과한다.
 */
export function readOnlyDb<T extends object>(db: T): T {
  return new Proxy(db, {
    get(target, prop, recv) {
      if (typeof prop === 'string' && BLOCKED_ROOT.has(prop)) {
        return () => { throw new Error(`OPS_SHADOW_DB_BLOCKED: ${prop}`) }
      }
      const v = Reflect.get(target, prop, recv) as unknown
      if (typeof prop === 'string' && !prop.startsWith('$') && v !== null && typeof v === 'object') {
        return new Proxy(v as object, {
          get(m, op, r) {
            if (typeof op === 'string' && WRITE_OPS.has(op)) {
              return () => { throw new Error(`OPS_SHADOW_DB_WRITE_BLOCKED: ${prop}.${op}`) }
            }
            const f = Reflect.get(m, op, r) as unknown
            return typeof f === 'function' ? (f as (...a: unknown[]) => unknown).bind(m) : f
          },
        })
      }
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v
    },
  })
}

// ─────────────────────────────────────────────────────────
// 파일 관측 — 공급 러너가 남긴 기록
// ─────────────────────────────────────────────────────────

const RUN_FILE = /^supply-process-(\d{8}-\d{6})\.run\.json$/
const TRACE_FILE = /^supply-selection-trace-(\d{8}-\d{6})\.json$/

const readJson = (p: string): unknown => {
  try { return JSON.parse(readFileSync(p, 'utf-8')) } catch { return null }
}

/**
 * 공급 회차 기록 → writer 트리거 입력 · 회차별 유료 원천 수.
 * 🔴 깨진 기록을 조용히 건너뛰지 않는다 — 파일 이름의 회차 id 를 `malformed` 로 돌려준다(writer 가 fail-closed 로 쓴다).
 *    깨짐: 회차 id 가 달력에 없는 값(`runIdStartMs`) · JSON 아님 · runId 없음/파일 이름과 다름 · 시작 시각이 엄격 ISO 가 아님.
 */
export function readSupplyRuns(dataDir: string): {
  runs: (SupplyRunView & { paidSources: number | null })[]
  malformed: string[]
  readable: boolean
} {
  let names: string[]
  try { names = readdirSync(dataDir) } catch { return { runs: [], malformed: [], readable: false } }
  const out: (SupplyRunView & { paidSources: number | null })[] = []
  const malformed: string[] = []
  for (const f of names) {
    const m = RUN_FILE.exec(f)
    if (m === null) continue
    const r = readJson(join(dataDir, f)) as Record<string, unknown> | null
    const strictIso = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v
    if (runIdStartMs(m[1]!) === null || r === null || typeof r !== 'object' || r.runId !== m[1] || !strictIso(r.startedAt)) {
      malformed.push(m[1]!)
      continue
    }
    const jit = (r.jit ?? null) as Record<string, unknown> | null
    out.push({
      runId: r.runId as string, startedAt: r.startedAt,
      status: typeof r.status === 'string' ? r.status : 'unknown',
      completedAt: typeof r.completedAt === 'string' ? r.completedAt : null,
      // 🔴 자연 회차 판단은 정본 하나 — 완전한 tag(trigger · launchTrigger 모두 scheduled · 흡수 규칙)만 시각을 낸다
      naturalAt: naturalScheduledRunEvidenceAt(r.runTokenShadow, r.startedAt),
      paidSources: jit !== null && Number.isInteger(jit.paidSources) ? jit.paidSources as number : null,
    })
  }
  return {
    runs: out.sort((a, b) => (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0)),
    malformed: malformed.sort(),
    readable: true,
  }
}

/**
 * 🔴 이미 기록된 cycle id — 주어진 KST 날짜 파일들만 읽는다. 깨진 줄이 있으면 던진다(모르는 채로 다시 쓰지 않는다 —
 *    sink 도 같은 이유로 거부한다). 파일이 없으면 빈 집합이다.
 */
export function readShadowCycleIds(dir: string, kstDates: Iterable<string>): Set<string> {
  const d = assertShadowDir(dir)
  const out = new Set<string>()
  for (const date of new Set(kstDates)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('OPS_SHADOW_BAD_DATE')
    const path = join(d, `${date}.jsonl`)
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, 'utf-8').split('\n')) {
      if (line.trim() === '') continue
      let id: unknown = null
      try { id = (JSON.parse(line) as { cycleId?: unknown }).cycleId } catch { throw new Error(`OPS_SHADOW_CORRUPT: ${path}`) }
      if (typeof id === 'string') out.add(id)
    }
  }
  return out
}

/** 가장 최근 선택 트레이스(파일 이름의 회차 순) — 없으면 null */
export function readLatestTrace(dataDir: string): unknown {
  let names: string[]
  try { names = readdirSync(dataDir) } catch { return null }
  const last = names.filter((f) => TRACE_FILE.test(f)).sort().pop()
  return last === undefined ? null : readJson(join(dataDir, last))
}
