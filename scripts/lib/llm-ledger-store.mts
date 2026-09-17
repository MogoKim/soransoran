/**
 * 공급 AI 비용 장부 **저장소** — 🔴 판정은 하지 않는다. 읽고 쓰기만 한다.
 *
 * 정본 판정: `src/lib/llm-ledger.ts` · 단가: `src/lib/llm-pricing.ts`
 *
 * 🔴 **왜 append-only JSONL 인가**
 *    한 요청은 두 번 기록된다 — 보내기 직전(예약)과 응답 뒤(정산).
 *    파일을 다시 쓰면 그 사이에 죽었을 때 **이미 보낸 요청의 예약이 통째로 사라진다.**
 *    줄을 덧붙이기만 하면 마지막에 죽어도 앞줄은 남는다.
 *    읽을 때 `attemptId` 로 접어 **마지막 줄이 이긴다.**
 *
 * 🔴 **왜 잠그는가**
 *    "읽고 · 남은 여력을 보고 · 예약을 적는" 세 동작 사이에 다른 회차가 끼어들면
 *    둘 다 같은 여력을 보고 둘 다 통과한다. 그래서 그 셋을 한 잠금 안에서 한다.
 *
 * 🔴 **DB 를 쓰지 않는다.** 운영 DB migration 을 만들지 않는 것이 이번 범위다.
 *
 * 🔴 **원문·프롬프트·응답 본문·API 키·개인정보를 쓰지 않는다.** 줄의 모양이 그것을 막는다.
 */
import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync,
  statSync, writeSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  LEDGER_STAGES, previousLedgerDate,
  type LedgerEntry, type LedgerStage, type LedgerStatus, type OpenReservation,
} from '../../src/lib/llm-ledger'

/** 🔴 운영 자산과 같은 자리 규칙을 따른다 — `$HOME` 을 존중하므로 시험은 임시 HOME 을 준다 */
export const LEDGER_DIR_NAME = 'llm-ledger'

export function defaultLedgerDir(): string {
  return join(homedir(), 'Library', 'Application Support', 'soransoran', LEDGER_DIR_NAME)
}

export function ledgerPathOf(dir: string, date: string): string {
  return join(dir, `${date}.jsonl`)
}

export function lockPathOf(dir: string): string {
  return join(dir, '.lock')
}

/**
 * 🔴 **오래된 잠금을 빼앗지 않는다** (2026-09-17 보정).
 *
 *    앞판은 mtime 이 이 시간보다 오래되면 잠금 파일을 지우고 들어갔다. 그것이 위험하다 —
 *    잠금을 쥔 쪽이 **살아 있는데 느린 것**일 수 있다. 유료 요청 하나가 타임아웃까지
 *    가면 그 회차는 그동안 잠금을 쥐고 있고, 그 사이 다른 회차가 잠금을 빼앗으면
 *    **둘이 같은 여력을 보고 둘 다 통과**한다. 막으려던 바로 그 일이 일어난다.
 *
 *    이제 이 값은 **지우는 기준이 아니라 사람에게 알리는 기준**이다.
 *    오래됐다고 판단되면 그 사실을 사유에 적고 **보류**한다. 잠금은 그대로 둔다.
 */
export const LOCK_STALE_REPORT_MS = 120_000
export const LOCK_WAIT_MS = 20_000
const LOCK_POLL_MS = 25

/** 🔴 동기 대기 — 잠금 구간을 async 로 쪼개면 그 사이에 다른 요청이 끼어든다 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export class LedgerLockError extends Error {}

/** 잠금 파일에 적는 것 — 🔴 **누가 쥐었는지**. 개인정보도 본문도 아니다 */
type LockOwner = { owner: string; pid: number; at: string }

/** 잠금이 얼마나 오래됐는지 — 못 읽으면 null */
function lockAgeMs(lock: string): number | null {
  try { return Date.now() - statSync(lock).mtimeMs } catch { return null }
}

/**
 * 잠금을 잡고 `fn` 을 돌린다 — 🔴 **읽기·판정·기록을 쪼개지 않는다.**
 *
 * 🔴 `fn` 은 **동기**여야 한다. 안에서 await 하면 그 사이에 다른 회차가 들어온다.
 * 🔴 잠금을 못 잡으면 **던진다.** 그냥 진행하면 두 회차가 같은 여력을 두 번 쓴다.
 * 🔴 **남의 잠금을 지우지 않는다.** 오래됐어도 빼앗지 않고 사유에 적어 보류한다 —
 *    잠금 문제를 예산 우회나 장부 초기화로 풀지 않는다.
 */
export function withLedgerLock<T>(dir: string, fn: () => T): T {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const lock = lockPathOf(dir)
  const until = Date.now() + LOCK_WAIT_MS
  // 🔴 이번 잠금의 표식. 풀 때 **내 것인지** 확인하는 근거다
  const owner: LockOwner = { owner: randomUUID(), pid: process.pid, at: new Date().toISOString() }
  let fd: number | null = null
  for (;;) {
    try {
      fd = openSync(lock, 'wx', 0o600)
      writeSync(fd, JSON.stringify(owner))
      fsyncSync(fd)
      break
    } catch {
      if (Date.now() > until) {
        const age = lockAgeMs(lock)
        const stale = age !== null && age > LOCK_STALE_REPORT_MS
        throw new LedgerLockError(
          `장부 잠금을 ${LOCK_WAIT_MS}ms 안에 잡지 못했다`
          + (stale
            ? ` — 잠금이 ${Math.round(age / 1000)}초째 남아 있다.`
              + ` 🔴 자동으로 지우지 않는다. ${lock} 을 쥔 회차가 정말 끝났는지 사람이 확인하고 지운다`
            : ''),
        )
      }
      sleepSync(LOCK_POLL_MS)
    }
  }
  try {
    return fn()
  } finally {
    try { closeSync(fd) } catch { /* 이미 닫혔다 */ }
    /**
     * 🔴 **내 잠금일 때만 지운다.** 표식이 다르면 그 사이 주인이 바뀐 것이고,
     *    그때 지우면 **남이 쥔 잠금을 푸는 것**이 된다 — 두 회차가 동시에 들어간다.
     *    지우지 못한 잠금은 남지만, 남는 쪽이 두 번 쓰는 것보다 안전하다.
     */
    try {
      const raw = readFileSync(lock, 'utf-8')
      const cur = JSON.parse(raw) as LockOwner
      if (cur.owner === owner.owner) rmSync(lock, { force: true })
    } catch { /* 이미 지워졌거나 읽을 수 없다 — 건드리지 않는다 */ }
  }
}

export type LedgerRead =
  | { ok: true; entries: LedgerEntry[] }
  /** 🔴 읽지 못했다 — 게이트는 이때 유료 요청을 보류한다 */
  | { ok: false; reason: string }

const STATUSES: readonly LedgerStatus[] = ['reserved', 'settled', 'usageUnknown', 'blocked']

/** 🔴 모양을 확인한다. 모르는 줄을 통과시키면 집계가 조용히 틀린다 */
function asEntry(v: unknown): LedgerEntry | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (typeof o.runId !== 'string' || typeof o.attemptId !== 'string' || o.attemptId === '') return null
  if (!LEDGER_STAGES.includes(o.stage as LedgerStage)) return null
  if (!STATUSES.includes(o.status as LedgerStatus)) return null
  if (o.reservedUsd !== null && typeof o.reservedUsd !== 'number') return null
  if (o.settledUsd !== null && typeof o.settledUsd !== 'number') return null
  return o as unknown as LedgerEntry
}

/**
 * 하루치를 읽는다 — 🔴 **`attemptId` 로 접고, 마지막 줄이 이긴다.**
 *
 * 🔴 깨진 줄이 하나라도 있으면 **실패로 끝낸다.** 건너뛰면 그 줄이 예약이었을 때
 *    이미 보낸 요청이 장부에서 사라지고, 여력이 실제보다 많아 보인다.
 */
export function readLedgerDay(path: string): LedgerRead {
  if (!existsSync(path)) return { ok: true, entries: [] }
  let raw: string
  try { raw = readFileSync(path, 'utf-8') } catch (e) {
    return { ok: false, reason: `장부 파일을 읽지 못했다 — ${e instanceof Error ? e.name : 'unknown'}` }
  }
  const folded = new Map<string, LedgerEntry>()
  const lines = raw.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (line.trim() === '') continue
    let parsed: unknown
    try { parsed = JSON.parse(line) } catch {
      return { ok: false, reason: `장부 ${i + 1}번째 줄이 JSON 이 아니다` }
    }
    const e = asEntry(parsed)
    if (e === null) return { ok: false, reason: `장부 ${i + 1}번째 줄이 장부 모양이 아니다` }
    folded.set(e.attemptId, e)
  }
  return { ok: true, entries: [...folded.values()] }
}

/**
 * 한 줄을 덧붙인다 — 🔴 **덮어쓰지 않는다.**
 *
 * 🔴 `fsync` 까지 한다. 회차가 죽어도 이미 보낸 요청의 예약은 남아야 한다 —
 *    캐시에만 있다가 사라지면 다음 회차가 그만큼을 또 쓴다.
 */
export function appendLedgerLine(path: string, entry: LedgerEntry): void {
  const fd = openSync(path, 'a', 0o600)
  try {
    writeSync(fd, `${JSON.stringify(entry)}\n`)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

// ─────────────────────────────────────────────────────────
// 🔴 **정산 기록 실패 보류** (2026-09-17 보정)
//
//   앞판은 정산을 못 적으면 메모리 카운터만 올리고 **다음 요청을 그대로 허용**했다.
//   두 가지가 틀렸다 —
//     ① 같은 원인(디스크 가득 · 권한 · 파일 손상)이면 다음 정산도 못 적는다.
//        그러면 얼마를 썼는지 모르는 요청이 계속 쌓인다.
//     ② 메모리 플래그는 **다시 뜨면 사라진다.** 재시작이 곧 우회가 된다.
//   그래서 파일로 남긴다. 사람이 제공사 사용량과 대조하고 **직접 지워야** 풀린다.
// ─────────────────────────────────────────────────────────

export const SETTLE_HOLD_FILE = '.settle-hold.json'

export function settleHoldPathOf(dir: string): string {
  return join(dir, SETTLE_HOLD_FILE)
}

/** 🔴 보류 표식. 원문·프롬프트·응답은 담지 않는다 */
export type SettleHold = {
  runId: string
  attemptId: string
  /** 예약이 적힌 장부 날짜 — 사람이 그 파일을 열어 대조한다 */
  date: string
  reservedUsd: number | null
  at: string
  reason: string
}

/**
 * 보류를 읽는다 — 🔴 **읽을 수 없으면 보류로 본다.**
 *
 *    파일이 깨져 있다는 것은 "보류가 아니다" 라는 뜻이 아니다. 모르는 것이다.
 *    모르면 멈춘다는 규칙을 여기에도 적용한다.
 */
export function readSettleHold(dir: string): string | null {
  const path = settleHoldPathOf(dir)
  if (!existsSync(path)) return null
  let hold: SettleHold
  try {
    hold = JSON.parse(readFileSync(path, 'utf-8')) as SettleHold
  } catch {
    return `정산 보류 표식을 읽지 못했다 — ${path} 을 사람이 확인한다`
  }
  return [
    `정산을 장부에 적지 못한 요청이 있다 (회차 ${String(hold.runId)} · ${String(hold.date)})`,
    `사유 ${String(hold.reason)}`,
    `🔴 유료 요청을 보류한다. 제공사 사용량과 대조한 뒤 ${path} 을 지우면 풀린다`,
  ].join(' · ')
}

/**
 * 보류를 건다 — 🔴 **이미 있으면 덮지 않는다.** 첫 실패가 원인에 가깝다.
 *
 * 🔴 이 쓰기마저 실패하면 던진다. 호출부는 그때도 요청을 보내지 않는다 —
 *    다만 그 경우 **다음 프로세스는 이 보류를 못 본다.** 같은 원인이 이어지면
 *    다음 회차의 첫 장부 쓰기가 실패해 `LEDGER_ERROR` 로 막히지만,
 *    원인이 그 사이 사라지면 막히지 않는다. 이 빈틈은 파일 하나에 기댄 대가다.
 */
export function writeSettleHold(dir: string, hold: SettleHold): void {
  const path = settleHoldPathOf(dir)
  if (existsSync(path)) return
  const fd = openSync(path, 'wx', 0o600)
  try {
    writeSync(fd, `${JSON.stringify(hold, null, 2)}\n`)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/**
 * 한 **회차**가 쓴 줄을 읽는다 — 🔴 **어제 파일도 같이 본다.**
 *
 *    장부 파일은 하루 단위인데 공급 회차는 자정을 넘을 수 있다. 오늘 것만 세면
 *    자정에 회차 요청 상한이 조용히 초기화된다.
 *
 * 🔴 두 파일 중 하나라도 못 읽으면 실패다. 반쪽만 세면 상한이 헐거워진다.
 */
export function readLedgerRun(dir: string, date: string, runId: string): LedgerRead {
  const out: LedgerEntry[] = []
  for (const d of [previousLedgerDate(date), date]) {
    const r = readLedgerDay(ledgerPathOf(dir, d))
    if (!r.ok) return r
    for (const e of r.entries) if (e.runId === runId) out.push(e)
  }
  return { ok: true, entries: out }
}

// ─────────────────────────────────────────────────────────
// 🔴 **열린 예약 목록** (2026-09-17 2차 보정)
//
//   `SETTLE_ERROR` 는 **사후** 표식에 기댄다. 그 표식 쓰기까지 실패하면
//   다음 프로세스는 아무것도 못 보고 그대로 다시 보냈다 — 실측으로 재현했다.
//
//   그래서 **요청보다 먼저** 남는 것을 근거로 쓴다. 이 파일은 잠금 안에서
//   요청 직전에 늘고, 끝을 적을 때 준다. 끝을 못 적으면 남는다.
//
//   🔴 왜 장부 JSONL 을 뒤지지 않는가 — 요청마다 1년치 파일을 읽을 수 없다.
//      이 파일은 **지금 열린 것**만 담아 작고, 읽는 값이 일정하다.
//   🔴 이 파일을 지워 복구하지 않는다. 사람이 마감 줄을 적어야 풀린다.
// ─────────────────────────────────────────────────────────

export const OPEN_RESERVATIONS_FILE = '.open-reservations.json'

export function openReservationsPathOf(dir: string): string {
  return join(dir, OPEN_RESERVATIONS_FILE)
}

export type OpenRead =
  | { ok: true; list: OpenReservation[] }
  /** 🔴 읽지 못했다 — 게이트는 이때 유료 요청을 보류한다 */
  | { ok: false; reason: string }

function asReservation(v: unknown): OpenReservation | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (typeof o.attemptId !== 'string' || o.attemptId === '') return null
  if (typeof o.runId !== 'string' || typeof o.sessionId !== 'string') return null
  if (!LEDGER_STAGES.includes(o.stage as LedgerStage)) return null
  if (typeof o.startedAt !== 'string' || typeof o.date !== 'string') return null
  if (typeof o.timeoutMs !== 'number' || typeof o.pid !== 'number') return null
  if (o.reservedUsd !== null && typeof o.reservedUsd !== 'number') return null
  return o as unknown as OpenReservation
}

/** 🔴 읽지 못하거나 모양이 다르면 **실패**다. 빈 목록으로 읽지 않는다 */
export function readOpenReservations(dir: string): OpenRead {
  const path = openReservationsPathOf(dir)
  if (!existsSync(path)) return { ok: true, list: [] }
  let raw: string
  try { raw = readFileSync(path, 'utf-8') } catch {
    return { ok: false, reason: `열린 예약 목록을 읽지 못했다 — ${path}` }
  }
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch {
    return { ok: false, reason: `열린 예약 목록이 JSON 이 아니다 — ${path}` }
  }
  if (!Array.isArray(parsed)) return { ok: false, reason: `열린 예약 목록이 배열이 아니다 — ${path}` }
  const list: OpenReservation[] = []
  for (const v of parsed) {
    const r = asReservation(v)
    if (r === null) return { ok: false, reason: `열린 예약 목록에 모르는 줄이 있다 — ${path}` }
    list.push(r)
  }
  return { ok: true, list }
}

/** 🔴 임시 파일에 쓰고 rename — 반쯤 쓰인 목록을 다른 회차가 읽지 않게 */
function writeOpenReservations(dir: string, list: readonly OpenReservation[]): void {
  const path = openReservationsPathOf(dir)
  const tmp = `${path}.tmp-${process.pid}`
  const fd = openSync(tmp, 'w', 0o600)
  try {
    writeSync(fd, `${JSON.stringify(list, null, 2)}\n`)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, path)
}

/**
 * 예약을 더한다 — 🔴 **요청을 보내기 직전, 잠금 안에서.**
 *    여기서 실패하면 요청을 보내지 않는다. 적지 못할 것을 보내지 않는다.
 */
export function addOpenReservation(dir: string, r: OpenReservation): void {
  const cur = readOpenReservations(dir)
  if (!cur.ok) throw new Error(cur.reason)
  writeOpenReservations(dir, [...cur.list.filter((x) => x.attemptId !== r.attemptId), r])
}

/**
 * 예약을 지운다 — 🔴 **끝을 장부에 적은 뒤에만.**
 *    순서를 바꾸면 끝을 못 적었는데 목록에서 사라져 아무도 모르게 된다.
 */
export function clearOpenReservation(dir: string, attemptId: string): void {
  const cur = readOpenReservations(dir)
  if (!cur.ok) throw new Error(cur.reason)
  if (!cur.list.some((x) => x.attemptId === attemptId)) return
  writeOpenReservations(dir, cur.list.filter((x) => x.attemptId !== attemptId))
}

/**
 * 그 프로세스가 살아 있는가 — 🔴 **신호를 보내지 않는다.** 존재만 본다.
 *
 * 🔴 pid 는 재사용된다. 그래서 이것 하나로 판단하지 않는다 —
 *    `classifyReservations` 가 나이도 함께 본다.
 */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch { return false }
}
