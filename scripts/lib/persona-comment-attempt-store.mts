/**
 * 첫 댓글 **시도 기억 저장소** — 🔴 짧은 로컬 파일 하나. 비용 장부 · Queue · DB 와 섞이지 않는다
 *
 * 🔴 **무엇을 하나.** `src/lib/persona-comment-attempt-policy.ts` 의 순수 계약을 파일에 얹는다.
 *      · provider 를 부르기 **전에** 시작 기록을 내구적으로 적는다 — 적지 못하면 호출하지 않는다
 *      · provider · Gate 결과가 나오면 같은 항목의 단계 · 실패 관문 · 사유 코드만 갱신한다
 *      · 읽기는 fail-closed — 파일이 없으면 정상 빈 기억, 깨졌으면 `ok:false`(부르는 쪽이 유료 생성을 닫는다)
 *
 * 🔴 **쓰기는 커널 lease 안에서만.** 진입점이 lease 증명(`LeaseProof`)에서 저장소를 만든다 —
 *    같은 잠금 디렉터리 · 단일 writer 다. 그래서 읽고-고치고-쓰는 사이에 다른 writer 가 끼지 않는다.
 *    쓰기는 임시 파일(0600) → fsync → rename → 디렉터리 fsync. 어느 단계든 실패하면 실패를 돌려주고, 임시 파일을 치운다.
 *
 * 🔴 **본문을 받지 않는다.** 타입이 받는 것은 조합 · 시각 · 단계 · 관문 코드뿐이다(정책 모듈이 모양을 강제한다).
 *    오류 사유도 errno 코드만 싣는다 — 경로 · 메시지 원문은 로그에 남기지 않는다.
 */
import {
  closeSync, fchmodSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync,
} from 'node:fs'
import { join } from 'node:path'

import {
  activeAttempts, parseAttemptJournal, serializeAttemptJournal, withAttemptOutcomes, withAttemptStarted,
  type AttemptEntry, type AttemptOutcomeUpdate,
} from '../../src/lib/persona-comment-attempt-policy'
import { AUTO_FIRST_COMMENT_WINDOW_MS } from '../../src/lib/persona-comment-auto-lane'
import type { LeaseProof } from './runner-lease.mjs'

/** 🔴 잠금 디렉터리 안의 파일 — 비용 장부(`persona-comment-ledger`)와 다른 자리다 */
export const ATTEMPT_JOURNAL_FILE = 'first-comment-attempts.v1.json'
export const ATTEMPT_JOURNAL_CORRUPT_FILE = `${ATTEMPT_JOURNAL_FILE}.corrupt`
export const ATTEMPT_JOURNAL_PREVIOUS_CORRUPT_FILE = `${ATTEMPT_JOURNAL_CORRUPT_FILE}.previous`

export type AttemptFsOps = {
  readFileSync: (path: string, enc: 'utf-8') => string
  mkdirSync: (path: string, o: { recursive: true; mode: number }) => unknown
  openSync: (path: string, flags: string, mode?: number) => number
  /** 🔴 `fs.writeSync(fd, buffer, offset, length)` 와 같다 — 쓴 바이트 수를 돌려준다(부분 쓰기 가능) */
  writeSync: (fd: number, data: Uint8Array, offset: number, length: number) => number
  fchmodSync: (fd: number, mode: number) => unknown
  fsyncSync: (fd: number) => unknown
  closeSync: (fd: number) => unknown
  renameSync: (from: string, to: string) => unknown
  unlinkSync: (path: string) => unknown
  statSync: (path: string) => { mtimeMs: number }
}
const REAL_OPS: AttemptFsOps = {
  readFileSync: (p, enc) => readFileSync(p, enc), mkdirSync: (p, o) => mkdirSync(p, o),
  openSync: (p, f, m) => openSync(p, f, m), writeSync: (fd, d, off, len) => writeSync(fd, d, off, len),
  fchmodSync: (fd, m) => fchmodSync(fd, m), fsyncSync: (fd) => fsyncSync(fd), closeSync: (fd) => closeSync(fd),
  renameSync: (a, b) => renameSync(a, b), unlinkSync: (p) => unlinkSync(p),
  statSync: (p) => statSync(p),
}

export type AttemptRead =
  | { ok: true; entries: AttemptEntry[]; missing: boolean; warning?: string }
  | { ok: false; code: 'READ_FAILED' | 'JSON_INVALID' | 'SCHEMA_MISMATCH'; reason: string }

export type AttemptWrite =
  | { ok: true }
  | { ok: false; kind: 'IO' | 'ALREADY_ATTEMPTED'; reason: string }

export type AttemptStore = {
  /** 파일 경로 — 진단용 */
  readonly path: string
  /** 🔴 만료되지 않은 기억만 돌려준다. 파일이 없으면 정상 빈 기억이다 */
  /** `repair:false`는 preview 전용 — 손상본 격리·초기화를 포함한 파일 write 0 */
  read: (nowMs: number, options?: { repair?: boolean }) => AttemptRead
  /** 🔴 provider 앞에서 부른다. 적지 못했으면 `ok:false` — 호출하지 않는다 */
  recordStart: (entry: AttemptEntry, nowMs: number) => AttemptWrite
  /** 결과 갱신. 기록이 없는 열쇠가 있어도 실패로 돌려준다(조용히 버리지 않는다) */
  recordOutcomes: (updates: readonly AttemptOutcomeUpdate[], nowMs: number) => AttemptWrite
}

const codeOf = (e: unknown): string => {
  const c = (e as { code?: unknown } | null)?.code
  return typeof c === 'string' ? c : 'UNKNOWN'
}

export function createAttemptStore(o: { dir: string; ops?: Partial<AttemptFsOps> }): AttemptStore {
  const ops: AttemptFsOps = { ...REAL_OPS, ...o.ops }
  const path = join(o.dir, ATTEMPT_JOURNAL_FILE)
  const corruptPath = join(o.dir, ATTEMPT_JOURNAL_CORRUPT_FILE)
  const previousCorruptPath = join(o.dir, ATTEMPT_JOURNAL_PREVIOUS_CORRUPT_FILE)

  const exists = (p: string): boolean => {
    try { ops.statSync(p); return true } catch (e) {
      if (codeOf(e) === 'ENOENT') return false
      throw e
    }
  }

  /**
   * 🔴 손상 직후에는 이미 시작한 60분 window 를 알 수 없으므로 fail-closed 다.
   *    파일 mtime 뒤 60분이 지난 뒤에만 손상본을 보존하고 새 장부를 시작한다.
   *    격리본은 현재·직전 두 개로 제한한다. 어느 파일 작업이든 실패하면 원장 복구를 시도하지 않고 닫는다.
   */
  const quarantineExpiredCorruption = (nowMs: number): { ok: true; warning: string } | { ok: false; reason: string } => {
    let mtimeMs: number
    try { mtimeMs = ops.statSync(path).mtimeMs } catch (e) {
      return { ok: false, reason: `손상 시각 확인 실패 ${codeOf(e)}` }
    }
    if (!Number.isFinite(mtimeMs) || nowMs - mtimeMs <= AUTO_FIRST_COMMENT_WINDOW_MS) {
      return { ok: false, reason: '손상 파일이 첫 댓글 60분 window 안이다 — 자동 복구하지 않는다' }
    }
    try {
      if (exists(corruptPath)) {
        try { ops.unlinkSync(previousCorruptPath) } catch (e) { if (codeOf(e) !== 'ENOENT') throw e }
        ops.renameSync(corruptPath, previousCorruptPath)
      }
      ops.renameSync(path, corruptPath)
      return { ok: true, warning: '🟡 만료된 첫 댓글 시도 기억 손상본을 격리하고 빈 장부로 복구했다' }
    } catch (e) {
      return { ok: false, reason: `손상본 격리 실패 ${codeOf(e)}` }
    }
  }

  /**
   * 🔴 격리본은 있는데 정본 장부가 없다 — 격리 뒤 빈 장부 쓰기가 실패했거나 그 사이 프로세스가 죽었다.
   *    rename 은 mtime 을 보존하므로 격리본 mtime 이 손상 장부의 마지막 쓰기다. 그 뒤 60분이 지났으면 그 안의
   *    시도는 전부 만료됐으니 live 회차가 빈 장부를 다시 만든다. 쓰기 실패는 그 회차만 닫고 다음 live 회차가 다시 시도한다.
   *    preview(`repair:false`)는 write 0 — 닫힌 채로 둔다.
   */
  const resumeAfterQuarantine = (nowMs: number, quarantinedAtMs: number, repair: boolean): AttemptRead => {
    if (!repair) {
      return { ok: false, code: 'READ_FAILED', reason: '격리된 손상본은 있으나 새 장부가 없다 · read-only preview는 새 장부를 만들지 않는다' }
    }
    if (!Number.isFinite(quarantinedAtMs) || nowMs - quarantinedAtMs <= AUTO_FIRST_COMMENT_WINDOW_MS) {
      return { ok: false, code: 'READ_FAILED', reason: '격리된 손상본이 첫 댓글 60분 window 안이다 — 새 장부를 만들지 않는다' }
    }
    const err = writeAtomic(serializeAttemptJournal([]))
    if (err !== null) {
      return { ok: false, code: 'READ_FAILED', reason: `격리된 손상본 뒤 새 장부 재생성 실패 ${err} — 다음 회차가 다시 시도한다` }
    }
    return { ok: true, entries: [], missing: false, warning: '🟡 격리된 손상본 뒤 빈 장부가 없어 새 장부를 다시 만들었다' }
  }

  const readAll = (nowMs: number, options: { repair?: boolean } = {}): AttemptRead => {
    let text: string
    try { text = ops.readFileSync(path, 'utf-8') } catch (e) {
      // 🔴 없는 파일만 정상이다. 권한 · 디렉터리 · I/O 오류는 "기억이 없다" 가 아니다
      if (codeOf(e) === 'ENOENT') {
        let quarantinedAtMs: number | null = null
        try { quarantinedAtMs = ops.statSync(corruptPath).mtimeMs } catch (statError) {
          if (codeOf(statError) !== 'ENOENT') {
            return { ok: false, code: 'READ_FAILED', reason: `격리 상태 확인 실패 ${codeOf(statError)}` }
          }
        }
        if (quarantinedAtMs !== null) return resumeAfterQuarantine(nowMs, quarantinedAtMs, options.repair !== false)
        return { ok: true, entries: [], missing: true }
      }
      return { ok: false, code: 'READ_FAILED', reason: `읽기 실패 ${codeOf(e)}` }
    }
    const parsed = parseAttemptJournal(text)
    if (!parsed.ok) {
      if (options.repair === false) {
        return { ok: false, code: parsed.code, reason: `${parsed.reason} · read-only preview는 손상 장부를 수정하지 않는다` }
      }
      const recovered = quarantineExpiredCorruption(nowMs)
      if (!recovered.ok) return { ok: false, code: parsed.code, reason: `${parsed.reason} · ${recovered.reason}` }
      const resetError = writeAtomic(serializeAttemptJournal([]))
      if (resetError !== null) {
        return { ok: false, code: 'READ_FAILED', reason: `${parsed.reason} · 손상본은 격리했지만 새 장부 쓰기 실패 ${resetError}` }
      }
      return { ok: true, entries: [], missing: false, warning: recovered.warning }
    }
    return { ok: true, entries: [...parsed.journal.entries], missing: false }
  }

  /** 🔴 임시 파일(0600) → fsync → rename → 디렉터리 fsync. 실패하면 이유 코드를 돌려준다 */
  const writeAtomic = (text: string): string | null => {
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
    let fd: number | null = null
    let renamed = false
    try {
      ops.mkdirSync(o.dir, { recursive: true, mode: 0o700 })
      fd = ops.openSync(tmp, 'wx', 0o600)
      ops.fchmodSync(fd, 0o600)
      // 🔴 writeSync 는 일부만 쓰고 돌아올 수 있다 — 전부 쓸 때까지 offset 을 전진시키고, 진전이 없으면 실패다
      const buf = Buffer.from(text, 'utf-8')
      for (let off = 0; off < buf.length;) {
        const n = ops.writeSync(fd, buf, off, buf.length - off)
        if (!Number.isSafeInteger(n) || n <= 0 || n > buf.length - off) throw Object.assign(new Error('short write'), { code: 'SHORT_WRITE' })
        off += n
      }
      ops.fsyncSync(fd)
      ops.closeSync(fd)
      fd = null
      ops.renameSync(tmp, path)
      renamed = true
      const dfd = ops.openSync(o.dir, 'r')
      try { ops.fsyncSync(dfd) } finally { ops.closeSync(dfd) }
      return null
    } catch (e) {
      return codeOf(e)
    } finally {
      if (fd !== null) { try { ops.closeSync(fd) } catch { /* 이미 실패 경로 */ } }
      if (!renamed) { try { ops.unlinkSync(tmp) } catch { /* 임시 파일이 없을 수 있다 */ } }
    }
  }

  return {
    path,
    read: (nowMs, options) => {
      const r = readAll(nowMs, options)
      if (!r.ok) return r
      return { ...r, entries: activeAttempts(r.entries, nowMs) }
    },
    recordStart: (entry, nowMs) => {
      const cur = readAll(nowMs)
      if (!cur.ok) return { ok: false, kind: 'IO', reason: `시작 기록 전 읽기 실패 ${cur.code}` }
      const next = withAttemptStarted(cur.entries, entry, nowMs)
      if (!next.ok) return { ok: false, kind: 'ALREADY_ATTEMPTED', reason: next.reason }
      const err = writeAtomic(serializeAttemptJournal(next.entries))
      return err === null ? { ok: true } : { ok: false, kind: 'IO', reason: `시작 기록 쓰기 실패 ${err}` }
    },
    recordOutcomes: (updates, nowMs) => {
      if (updates.length === 0) return { ok: true }
      const cur = readAll(nowMs)
      if (!cur.ok) return { ok: false, kind: 'IO', reason: `결과 갱신 전 읽기 실패 ${cur.code}` }
      const next = withAttemptOutcomes(cur.entries, updates, nowMs)
      const err = writeAtomic(serializeAttemptJournal(next.entries))
      if (err !== null) return { ok: false, kind: 'IO', reason: `결과 갱신 쓰기 실패 ${err}` }
      return next.missing.length === 0
        ? { ok: true }
        : { ok: false, kind: 'IO', reason: `결과를 갱신할 시작 기록이 없다 ${next.missing.length}건` }
    },
  }
}

/** 🔴 커널 lease 증명에서 만든다 — lease 를 쥔 회차만 이 저장소를 얻는다(잠금 디렉터리와 같은 자리) */
export function attemptStoreInLease(proof: LeaseProof, ops?: Partial<AttemptFsOps>): AttemptStore {
  return createAttemptStore({ dir: proof.followUpDir, ...(ops === undefined ? {} : { ops }) })
}
