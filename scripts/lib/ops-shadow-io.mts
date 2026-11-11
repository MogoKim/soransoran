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
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runIdStartMs, type ShadowRecord, type SupplyRunView } from '../../src/lib/ops-shadow-plan'
import { withLedgerLock } from './llm-ledger-store.mjs'

/** 🔴 감사 장부 디렉터리 — 저장소 밖 · 운영 데이터 정본 옆(Application Support) */
export const OPS_SHADOW_DIR_NAME = 'ops-shadow'
export function defaultOpsShadowDir(home: string = homedir()): string {
  return join(home, 'Library', 'Application Support', 'soransoran', OPS_SHADOW_DIR_NAME)
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
export function installShadowCallGuard(): () => void {
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
    const tok = (r.runTokenShadow ?? null) as Record<string, unknown> | null
    out.push({
      runId: r.runId as string, startedAt: r.startedAt,
      status: typeof r.status === 'string' ? r.status : 'unknown',
      completedAt: typeof r.completedAt === 'string' ? r.completedAt : null,
      trigger: tok !== null && typeof tok.trigger === 'string' ? tok.trigger : null,
      paidSources: jit !== null && Number.isInteger(jit.paidSources) ? jit.paidSources as number : null,
    })
  }
  return {
    runs: out.sort((a, b) => (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0)),
    malformed: malformed.sort(),
    readable: true,
  }
}

/** 가장 최근 선택 트레이스(파일 이름의 회차 순) — 없으면 null */
export function readLatestTrace(dataDir: string): unknown {
  let names: string[]
  try { names = readdirSync(dataDir) } catch { return null }
  const last = names.filter((f) => TRACE_FILE.test(f)).sort().pop()
  return last === undefined ? null : readJson(join(dataDir, last))
}
