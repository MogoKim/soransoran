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
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { LEDGER_STAGES, type LedgerEntry, type LedgerStage, type LedgerStatus } from '../../src/lib/llm-ledger'

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
 * 🔴 잠금을 **버려진 것으로 보는 시각**. 회차가 죽어 잠금이 남으면 영원히 막힌다.
 *    유료 요청 하나의 타임아웃(초 단위)보다 넉넉히 길게 둔다.
 */
export const LOCK_STALE_MS = 120_000
export const LOCK_WAIT_MS = 20_000
const LOCK_POLL_MS = 25

/** 🔴 동기 대기 — 잠금 구간을 async 로 쪼개면 그 사이에 다른 요청이 끼어든다 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export class LedgerLockError extends Error {}

/**
 * 잠금을 잡고 `fn` 을 돌린다 — 🔴 **읽기·판정·기록을 쪼개지 않는다.**
 *
 * 🔴 `fn` 은 **동기**여야 한다. 안에서 await 하면 그 사이에 다른 회차가 들어온다.
 * 🔴 잠금을 못 잡으면 **던진다.** 그냥 진행하면 두 회차가 같은 여력을 두 번 쓴다.
 */
export function withLedgerLock<T>(dir: string, fn: () => T): T {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const lock = lockPathOf(dir)
  const until = Date.now() + LOCK_WAIT_MS
  let fd: number | null = null
  for (;;) {
    try {
      fd = openSync(lock, 'wx', 0o600)
      break
    } catch {
      // 🔴 죽은 회차가 남긴 잠금을 회수한다 — 시각만 보고 판단하며, 지우고 곧바로
      //    다시 시도한다(그 사이 다른 회차가 먼저 잡으면 그쪽이 이긴다)
      try {
        const age = Date.now() - statSync(lock).mtimeMs
        if (age > LOCK_STALE_MS) rmSync(lock, { force: true })
      } catch { /* 잠금이 방금 풀렸다 — 다음 회전에서 잡는다 */ }
      if (Date.now() > until) {
        throw new LedgerLockError(`장부 잠금을 ${LOCK_WAIT_MS}ms 안에 잡지 못했다`)
      }
      sleepSync(LOCK_POLL_MS)
    }
  }
  try {
    return fn()
  } finally {
    try { closeSync(fd) } catch { /* 이미 닫혔다 */ }
    try { rmSync(lock, { force: true }) } catch { /* 이미 지워졌다 */ }
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
