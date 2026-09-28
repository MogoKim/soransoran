/**
 * 운영 신호 읽기 — 🔴 **read-only. 파일 읽기만. write · 네트워크 · provider 0**
 *
 * 🔴 `ops:status`(화면)와 `stage:controller`(결정)가 **같은 읽기**를 쓴다.
 *    화면은 초록인데 결정은 감속하는(또는 그 반대) 날을 만들지 않는다.
 *
 * 🔴 **값을 찍지 않는다.** 정본 env 에는 API key 와 접속 주소가 함께 산다 —
 *    여기서는 **이름을 못 박은 키**만 메모리에 올린다.
 */
import { existsSync, openSync, readSync, closeSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { ledgerDateOf, tallyOf, type LedgerEntry, type LedgerStage } from '../../src/lib/llm-ledger'
import { judgeCost, type CostVerdict } from '../../src/lib/ops-status'
import { defaultLedgerDir, ledgerPathOf, readLedgerDay, readSettleHold } from './llm-ledger-store.mjs'
import { BUDGET_ENV, limitsFromEnv } from './supply-llm-call.mjs'
import { auditLedgerDir, auditLimitsFromEnv } from './auto-ready-semantic-provider.mjs'
import { AUDIT_BUDGET_ENV } from '../../src/lib/auto-ready-semantic-audit'

export const CANONICAL_ENV_FILE = join(homedir(), 'Library', 'Application Support', 'soransoran', 'env.local')
export const LOG_DIR = join(homedir(), 'Library', 'Logs', 'soransoran')

/** 🔴 정본 env 에서 **이 목록의 키만** 읽는다. 목록 밖의 값은 메모리에도 올리지 않는다 */
export function readEnvKeys(keys: readonly string[], path: string = CANONICAL_ENV_FILE): {
  ok: boolean; values: Record<string, string>; reason: string | null
} {
  if (!existsSync(path)) return { ok: false, values: {}, reason: `정본 env 가 없다 — ${path}` }
  let text: string
  try { text = readFileSync(path, 'utf-8') } catch (e) {
    return { ok: false, values: {}, reason: `정본 env 를 읽지 못했다 — ${(e as Error).name}` }
  }
  const values: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (m === null || !keys.includes(m[1]!)) continue
    let v = m[2]!.trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    values[m[1]!] = v
  }
  return { ok: true, values, reason: null }
}

/** 🔴 DB 접속 주소 두 개만 채운다 — 이미 있으면 덮지 않고, 어디에도 찍지 않는다 */
export function fillDbConnection(): boolean {
  const keys = ['DATABASE_URL', 'DIRECT_URL'] as const
  if (keys.every((k) => (process.env[k] ?? '') !== '')) return true
  const r = readEnvKeys(keys)
  for (const k of keys) {
    if ((process.env[k] ?? '') === '' && (r.values[k] ?? '') !== '') process.env[k] = r.values[k]
  }
  return (process.env.DATABASE_URL ?? '') !== ''
}

/** 🔴 공급 장부에서 댓글이 쓰는 단계 — 같은 장부 · 같은 상한이다(두 번째 장부를 만들지 않는다) */
const COMMENT_STAGES: readonly LedgerStage[] = ['commentGen']

export type LedgerDayRead = { entries: LedgerEntry[] | null; error: string | null }

export function readLedgerToday(dir: string, now: Date): LedgerDayRead {
  const r = readLedgerDay(ledgerPathOf(dir, ledgerDateOf(now)))
  return r.ok ? { entries: r.entries, error: null } : { entries: null, error: r.reason }
}

export type CostSignals = {
  /** 공급 장부 전체(공급 + 댓글) — 상한은 하나다 */
  supplyLedger: CostVerdict
  /** 그중 댓글 단계만 쓴 금액 */
  commentSpentUsd: number | null
  /** 감사 전용 장부 — 공급과 섞이지 않는다 */
  auditLedger: CostVerdict
}

export function readCostSignals(now: Date, env?: Record<string, string>): CostSignals {
  const envVals = env ?? readEnvKeys([
    BUDGET_ENV.dailyUsd, BUDGET_ENV.runRequestCap, BUDGET_ENV.headroomMultiplier,
    AUDIT_BUDGET_ENV.dailyUsd, AUDIT_BUDGET_ENV.runRequestCap, AUDIT_BUDGET_ENV.headroomMultiplier,
  ]).values
  const supplyDir = defaultLedgerDir()
  const s = readLedgerToday(supplyDir, now)
  const supplyLedger = judgeCost({
    uses: true,
    tally: s.entries === null ? null : tallyOf(s.entries),
    ledgerError: s.error,
    settleHold: readSettleHold(supplyDir),
    capUsd: limitsFromEnv(envVals).dailyUsd,
  })
  const commentSpentUsd = s.entries === null ? null : (() => {
    const t = tallyOf(s.entries.filter((e) => COMMENT_STAGES.includes(e.stage)))
    return Math.round((t.settledUsd + t.openReservedUsd) * 1e6) / 1e6
  })()
  const auditDir = auditLedgerDir()
  const a = readLedgerToday(auditDir, now)
  const auditLedger = judgeCost({
    uses: true,
    tally: a.entries === null ? null : tallyOf(a.entries),
    ledgerError: a.error,
    settleHold: readSettleHold(auditDir),
    capUsd: auditLimitsFromEnv(envVals).dailyUsd,
  })
  return { supplyLedger, commentSpentUsd, auditLedger }
}

/** 🔴 로그 끝만 읽는다 — 큰 로그를 통째로 올리지 않는다 */
export function tailFile(path: string, bytes = 64 * 1024): { text: string; mtime: string | null } {
  if (!existsSync(path)) return { text: '', mtime: null }
  try {
    const st = statSync(path)
    const size = st.size
    const start = Math.max(0, size - bytes)
    const fd = openSync(path, 'r')
    try {
      const buf = Buffer.alloc(size - start)
      readSync(fd, buf, 0, buf.length, start)
      return { text: buf.toString('utf-8'), mtime: st.mtime.toISOString() }
    } finally { closeSync(fd) }
  } catch {
    return { text: '', mtime: null }
  }
}
