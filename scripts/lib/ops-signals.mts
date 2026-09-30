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
import { COMMENT_LOOP_BUDGET_ENV, commentLoopLimitsFromEnv } from '../../src/lib/persona-comment-auto-lane'
import { commentLoopLedgerDir } from './persona-comment-loop.mjs'

/**
 * 🔴 정본 env 판독기는 의존성 없는 `canonical-env` 로 옮겼다(2026-10-01) — 작가 해시 helper 가 이 파일의 무거운
 *    의존성 없이 읽게 하려는 것이다. 옮겼을 뿐 두 벌이 아니다(여기서 다시 내보낸다).
 */
import { CANONICAL_ENV_FILE, readEnvKeys } from './canonical-env.mjs'

export { CANONICAL_ENV_FILE, readEnvKeys }
export const LOG_DIR = join(homedir(), 'Library', 'Logs', 'soransoran')

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

/**
 * 🔴 공급 장부에 남은 댓글 단계 — 옛 수동 댓글 경로(runner)가 쓰던 자리다.
 *    (2026-09-29) 무인 댓글 루프는 **자기 장부**(`persona-comment-ledger`)에 쓴다. 앞판은 공급 장부만 읽어
 *    9-28 댓글 지출 $0.0024 가 화면에 $0 으로 나왔고, 단계 controller 의 비용 축이 댓글을 보지 못했다.
 */
const COMMENT_STAGES: readonly LedgerStage[] = ['commentGen']

/** 🔴 댓글 전용 장부의 상한을 정하는 env 이름 — 부르는 쪽이 env 를 넘길 때도 이 키를 함께 읽는다 */
export const COMMENT_LEDGER_ENV_KEYS: readonly string[] = Object.values(COMMENT_LOOP_BUDGET_ENV)

export type LedgerDayRead = { entries: LedgerEntry[] | null; error: string | null }

export function readLedgerToday(dir: string, now: Date): LedgerDayRead {
  const r = readLedgerDay(ledgerPathOf(dir, ledgerDateOf(now)))
  return r.ok ? { entries: r.entries, error: null } : { entries: null, error: r.reason }
}

export type CostSignals = {
  /** 공급 장부 전체(공급 + 댓글) — 상한은 하나다 */
  supplyLedger: CostVerdict
  /** 공급 장부 안의 댓글 단계만 쓴 금액(옛 경로) */
  commentSpentUsd: number | null
  /** 🔴 무인 댓글 루프 전용 장부 — 상한은 `SORAN_PERSONA_COMMENT_DAILY_BUDGET_USD`(기본·최대 0.20) */
  commentLedger: CostVerdict
  /** 감사 전용 장부 — 공급과 섞이지 않는다 */
  auditLedger: CostVerdict
}

export function readCostSignals(
  now: Date, env?: Record<string, string>,
  /** 🔴 시험용 — 운영은 기본 디렉터리만 쓴다 */
  dirs: { supply?: string; audit?: string; comment?: string } = {},
): CostSignals {
  const envVals = env ?? readEnvKeys([
    BUDGET_ENV.dailyUsd, BUDGET_ENV.runRequestCap, BUDGET_ENV.headroomMultiplier,
    AUDIT_BUDGET_ENV.dailyUsd, AUDIT_BUDGET_ENV.runRequestCap, AUDIT_BUDGET_ENV.headroomMultiplier,
    ...COMMENT_LEDGER_ENV_KEYS,
  ]).values
  const supplyDir = dirs.supply ?? defaultLedgerDir()
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
  const auditDir = dirs.audit ?? auditLedgerDir()
  const a = readLedgerToday(auditDir, now)
  const auditLedger = judgeCost({
    uses: true,
    tally: a.entries === null ? null : tallyOf(a.entries),
    ledgerError: a.error,
    settleHold: readSettleHold(auditDir),
    capUsd: auditLimitsFromEnv(envVals).dailyUsd,
  })
  const commentDir = dirs.comment ?? commentLoopLedgerDir()
  const c = readLedgerToday(commentDir, now)
  const commentLedger = judgeCost({
    uses: true,
    tally: c.entries === null ? null : tallyOf(c.entries),
    ledgerError: c.error,
    settleHold: readSettleHold(commentDir),
    capUsd: commentLoopLimitsFromEnv(envVals).limits.dailyUsd,
  })
  return { supplyLedger, commentSpentUsd, auditLedger, commentLedger }
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
