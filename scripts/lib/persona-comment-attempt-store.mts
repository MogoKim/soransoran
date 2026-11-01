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
  closeSync, fchmodSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync,
} from 'node:fs'
import { join } from 'node:path'

import {
  activeAttempts, parseAttemptJournal, serializeAttemptJournal, withAttemptOutcomes, withAttemptStarted,
  type AttemptEntry, type AttemptOutcomeUpdate,
} from '../../src/lib/persona-comment-attempt-policy'
import type { LeaseProof } from './runner-lease.mjs'

/** 🔴 잠금 디렉터리 안의 파일 — 비용 장부(`persona-comment-ledger`)와 다른 자리다 */
export const ATTEMPT_JOURNAL_FILE = 'first-comment-attempts.v1.json'

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
}
const REAL_OPS: AttemptFsOps = {
  readFileSync: (p, enc) => readFileSync(p, enc), mkdirSync: (p, o) => mkdirSync(p, o),
  openSync: (p, f, m) => openSync(p, f, m), writeSync: (fd, d, off, len) => writeSync(fd, d, off, len),
  fchmodSync: (fd, m) => fchmodSync(fd, m), fsyncSync: (fd) => fsyncSync(fd), closeSync: (fd) => closeSync(fd),
  renameSync: (a, b) => renameSync(a, b), unlinkSync: (p) => unlinkSync(p),
}

export type AttemptRead =
  | { ok: true; entries: AttemptEntry[]; missing: boolean }
  | { ok: false; code: 'READ_FAILED' | 'JSON_INVALID' | 'SCHEMA_MISMATCH'; reason: string }

export type AttemptWrite =
  | { ok: true }
  | { ok: false; kind: 'IO' | 'ALREADY_ATTEMPTED'; reason: string }

export type AttemptStore = {
  /** 파일 경로 — 진단용 */
  readonly path: string
  /** 🔴 만료되지 않은 기억만 돌려준다. 파일이 없으면 정상 빈 기억이다 */
  read: (nowMs: number) => AttemptRead
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

  const readAll = (): AttemptRead => {
    let text: string
    try { text = ops.readFileSync(path, 'utf-8') } catch (e) {
      // 🔴 없는 파일만 정상이다. 권한 · 디렉터리 · I/O 오류는 "기억이 없다" 가 아니다
      if (codeOf(e) === 'ENOENT') return { ok: true, entries: [], missing: true }
      return { ok: false, code: 'READ_FAILED', reason: `읽기 실패 ${codeOf(e)}` }
    }
    const parsed = parseAttemptJournal(text)
    if (!parsed.ok) return { ok: false, code: parsed.code, reason: parsed.reason }
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
    read: (nowMs) => {
      const r = readAll()
      if (!r.ok) return r
      return { ...r, entries: activeAttempts(r.entries, nowMs) }
    },
    recordStart: (entry, nowMs) => {
      const cur = readAll()
      if (!cur.ok) return { ok: false, kind: 'IO', reason: `시작 기록 전 읽기 실패 ${cur.code}` }
      const next = withAttemptStarted(cur.entries, entry, nowMs)
      if (!next.ok) return { ok: false, kind: 'ALREADY_ATTEMPTED', reason: next.reason }
      const err = writeAtomic(serializeAttemptJournal(next.entries))
      return err === null ? { ok: true } : { ok: false, kind: 'IO', reason: `시작 기록 쓰기 실패 ${err}` }
    },
    recordOutcomes: (updates, nowMs) => {
      if (updates.length === 0) return { ok: true }
      const cur = readAll()
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
