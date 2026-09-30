/**
 * 🔴 **작가 해시 v1 → v2 전환 — 계획 · 적용 · 되돌리기의 정본** (2026-10-01 author-hash v2)
 *
 *    대상: `VoiceSource` · `VoiceCommentSignal` 의 `authorHash` · `authorHashNorm` (작가 해시가 저장된 곳은 이 넷뿐이다 —
 *    말투 자산 corpus 는 불투명 `speakerId` 를 쓰고, export · 학습 선별은 `authorHash` 를 금지 칸으로 막는다).
 *    계산은 정본 `wrapV1`(voice-author-hash) 하나다 — 원문 없이 v1 을 감싼다. 같은 사람은 전환 전후에도 같은 값으로 잡힌다.
 *
 *    계약
 *    · 계획(`planMigration`)은 읽기만 한다. 세대 집계 · 상태 · v1 사슬 증명 probe · 행 수만 낸다(해시 · 이름 · key 출력 0).
 *    · 적용(`applyMigration`)은
 *        ① key 필수 · ② 파일 lock(같은 호스트 동시 실행 차단) · ③ 상태가 `needs-migration` 일 때만 — `v2-ready` 면 아무것도 안 한다(재실행 idempotent ·
 *        이중 HMAC 없음), 섞임 · 손상 · 다른 key · 빈 집합이면 거절 · ④ v1 사슬 미증명이면 창업자 확인(`attestLegacyDomain`) 없이는 거절 ·
 *        ⑤ **되돌리기 백업 먼저**(0600 JSONL + sha256) · ⑥ 단일 트랜잭션 — 행마다 "지금 값 = 읽은 v1" 조건부 갱신(다른 호스트의 동시 실행 ·
 *        그 사이 변경을 잡는다) · ⑦ 트랜잭션 안에서 사후 검증(전부 지금 key 의 v2 · 행 수 불변 · 알려진 이름의 B2 충돌 수 불변) — 하나라도
 *        어긋나면 throw → 전체 롤백(DB 변경 0).
 *    · 되돌리기(`rollbackMigration`)는 백업 checksum 을 확인하고, 행마다 "지금 값 = 백업 v1 을 지금 key 로 감싼 값" 일 때만 v1 로 되돌린다
 *      (그 사이 바뀐 행이 있으면 전체 롤백). 단일 트랜잭션.
 *
 *    🔴 이 파일은 운영에서 스스로 돌지 않는다. CLI(`scripts/voice-author-hash-migrate.mts`)는 기본 계획만 하고, 적용은 창업자 승인 뒤
 *       명시 `--apply` 로만 한다.
 */
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { Prisma, PrismaClient } from '@prisma/client'

import {
  authorHashV2Of, censusOf, legacyDomainProbe, setStateOf, wrapV1,
  type AuthorHashCensus, type AuthorHashKeyRead, type AuthorHashSetState,
} from './voice-author-hash.mjs'
import { normalizeN2 } from './persona-gate-name-collision.mjs'

type Reader = PrismaClient | Prisma.TransactionClient
export const MIGRATION_TABLES = ['voiceSource', 'voiceCommentSignal'] as const
type Table = (typeof MIGRATION_TABLES)[number]
type Row = { id: string; authorHash: string | null; authorHashNorm: string | null }

async function rowsOf(db: Reader, table: Table): Promise<Row[]> {
  const select = { id: true, authorHash: true, authorHashNorm: true } as const
  return table === 'voiceSource'
    ? db.voiceSource.findMany({ select, orderBy: { id: 'asc' } })
    : db.voiceCommentSignal.findMany({ select, orderBy: { id: 'asc' } })
}

const valuesOf = (rows: readonly Row[]): string[] =>
  rows.flatMap((r) => [r.authorHash, r.authorHashNorm].filter((v): v is string => v !== null))

/** 🔴 알려진 이름 — 회원 · Persona 표시명(Gate ⑥-B 가 실제로 대조하는 쪽). 값은 밖으로 내지 않는다 */
async function knownNamesOf(db: Reader): Promise<string[]> {
  const users = await db.user.findMany({ select: { nickname: true, name: true } })
  const out = new Set<string>()
  for (const u of users) for (const n of [u.nickname, u.name]) if (n !== null && n.trim() !== '') out.add(n.trim())
  return [...out]
}

export type TableCounts = { rows: number; census: AuthorHashCensus }
export type MigrationPlan = {
  key: { ok: true; kid: string } | { ok: false; code: string; reason: string }
  tables: Record<Table, TableCounts>
  state: AuthorHashSetState
  action: 'migrate' | 'noop' | 'refuse'
  refuseReason: string | null
  legacyDomain: { probeNames: number; hits: number; status: 'proven' | 'unproven' | 'not-applicable' }
  rowsToWrap: number
  /** 트랜잭션 안 갱신 왕복 수(= (hash, norm) 고유 쌍 수) — 운영 왕복 시간 × 이 수가 소요 시간이다 */
  updateStatements: number
}

/** 🔴 **계획 — 읽기만 한다.** 수 · 상태 · 사유만 낸다 */
export async function planMigration(db: Reader, keyRead: AuthorHashKeyRead): Promise<MigrationPlan> {
  const key = keyRead.ok ? keyRead.key : null
  const byTable = {} as Record<Table, Row[]>
  for (const t of MIGRATION_TABLES) byTable[t] = await rowsOf(db, t)
  const tables = Object.fromEntries(MIGRATION_TABLES.map((t) => [t, {
    rows: byTable[t].length, census: censusOf(valuesOf(byTable[t]), key),
  }])) as Record<Table, TableCounts>
  const all = MIGRATION_TABLES.flatMap((t) => valuesOf(byTable[t]))
  const state = setStateOf(censusOf(all, key))
  const v1Set = new Set(all.filter((v) => v.startsWith('sha256:')))
  const probe = state === 'needs-migration' ? legacyDomainProbe(await knownNamesOf(db), v1Set, normalizeN2) : null
  const legacyDomain = probe === null
    ? { probeNames: 0, hits: 0, status: 'not-applicable' as const }
    : { ...probe, status: probe.hits > 0 ? 'proven' as const : 'unproven' as const }
  const rowsToWrap = state === 'needs-migration'
    ? MIGRATION_TABLES.reduce((a, t) => a + byTable[t].filter((r) => r.authorHash !== null || r.authorHashNorm !== null).length, 0) : 0
  const updateStatements = state === 'needs-migration'
    ? MIGRATION_TABLES.reduce((a, t) => a + pairsOf(byTable[t]).size, 0) : 0
  let action: MigrationPlan['action'] = 'refuse'
  let refuseReason: string | null = null
  if (!keyRead.ok) refuseReason = keyRead.reason
  else if (state === 'v2-ready') action = 'noop'
  else if (state === 'needs-migration') action = 'migrate'
  else refuseReason = `저장 작가 해시 상태가 ${state} 다 — 전환하지 않는다`
  return {
    key: keyRead.ok ? { ok: true, kid: keyRead.key.kid } : { ok: false, code: keyRead.code, reason: keyRead.reason },
    tables, state, action, refuseReason, legacyDomain, rowsToWrap, updateStatements,
  }
}

export type ApplyResult =
  | { ok: true; kind: 'noop'; plan: MigrationPlan }
  | { ok: true; kind: 'migrated'; plan: MigrationPlan; backupFile: string; wrappedRows: number; b2HitsBefore: number; b2HitsAfter: number }
  | { ok: false; code: 'LOCKED' | 'REFUSED' | 'LEGACY_DOMAIN_UNPROVEN' | 'TX_FAILED'; reason: string; plan: MigrationPlan | null; dbChanged: false }

/**
 * 단일 트랜잭션 시한 — 2026-10-01 운영 실측(read-only): 고유 쌍 20,433 × 왕복 p50 57ms ≈ 20분.
 *    30분은 여유가 모자라 90분으로 둔다. runbook: 왕복 × 갱신 문장이 이 값의 절반을 넘으면 적용하지 않는다.
 */
export const TX_TIMEOUT_MS = 90 * 60_000

type BackupLine = { t: Table; id: string; h: string | null; n: string | null }

/**
 * 파일 lock — 같은 호스트의 동시 실행을 막는다. 🔴 이미 있으면(EEXIST) 남의 lock 이다 — 지우지 않는다.
 *    lock 디렉터리가 없어서 못 연 것을 "다른 전환이 돌고 있다" 로 읽지 않도록 디렉터리를 먼저 만든다.
 */
function takeLock(lockPath: string): number | string {
  try {
    mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 })
    return openSync(lockPath, 'wx', 0o600)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    return code === 'EEXIST'
      ? `다른 전환이 돌고 있다(lock 파일이 있다 — 돌고 있는 실행이 없으면 runbook 의 stale lock 절차를 따른다)`
      : `lock 을 만들지 못했다(${code ?? 'unknown'})`
  }
}

const sha256File = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex')

/** 🔴 한 쌍(authorHash, authorHashNorm) 단위로 묶는다 — 같은 작가의 행은 같은 쌍이라 갱신 수가 작가 수만큼으로 준다 */
function pairsOf(rows: readonly Row[]): Map<string, { h: string | null; n: string | null; ids: string[] }> {
  const m = new Map<string, { h: string | null; n: string | null; ids: string[] }>()
  for (const r of rows) {
    if (r.authorHash === null && r.authorHashNorm === null) continue
    const k = `${r.authorHash ?? ''}\u0000${r.authorHashNorm ?? ''}`
    const e = m.get(k) ?? { h: r.authorHash, n: r.authorHashNorm, ids: [] }
    e.ids.push(r.id)
    m.set(k, e)
  }
  return m
}

async function updatePair(tx: Prisma.TransactionClient, t: Table, where: { h: string | null; n: string | null }, data: { h: string | null; n: string | null }): Promise<number> {
  const w = { authorHash: where.h, authorHashNorm: where.n }
  const d = { authorHash: data.h, authorHashNorm: data.n }
  const r = t === 'voiceSource'
    ? await tx.voiceSource.updateMany({ where: w, data: d })
    : await tx.voiceCommentSignal.updateMany({ where: w, data: d })
  return r.count
}

/** 알려진 이름 중 B2 에 걸리는 수 — 전환 전(v1 사슬) · 후(v2) 를 같은 이름 목록으로 센다 */
function b2HitsV2(names: readonly string[], keyRead: AuthorHashKeyRead & { ok: true }, stored: ReadonlySet<string>): number {
  let hits = 0
  for (const n of names) {
    const z = normalizeN2(n)
    if (stored.has(authorHashV2Of(n, keyRead.key)) || (z !== '' && stored.has(authorHashV2Of(z, keyRead.key)))) hits += 1
  }
  return hits
}

/**
 * 🔴 **적용 — 창업자 승인 뒤 명시 `--apply` 로만.** 실패하면 DB 는 그대로다(`dbChanged: false`).
 *    `failAfterPairs` · `beforeTx` 는 **검사 전용** — 중간 실패 전체 롤백 · 읽은 뒤 바뀐 행 감지를 본다(CLI 는 넘기지 않는다).
 */
export async function applyMigration(prisma: PrismaClient, opts: {
  keyRead: AuthorHashKeyRead
  backupDir: string
  lockPath: string
  attestLegacyDomain: boolean
  now: Date
  failAfterPairs?: number
  /** 🔴 검사 전용 — 읽은 뒤 트랜잭션 전에 값이 바뀌는 경우를 재현한다(CLI 는 넘기지 않는다) */
  beforeTx?: () => Promise<void>
  txTimeoutMs?: number
}): Promise<ApplyResult> {
  const lockFd = takeLock(opts.lockPath)
  if (typeof lockFd === 'string') return { ok: false, code: 'LOCKED', reason: lockFd, plan: null, dbChanged: false }
  try {
    const plan = await planMigration(prisma, opts.keyRead)
    if (plan.action === 'noop') return { ok: true, kind: 'noop', plan }
    if (plan.action === 'refuse' || !opts.keyRead.ok) {
      return { ok: false, code: 'REFUSED', reason: plan.refuseReason ?? 'key 없음', plan, dbChanged: false }
    }
    if (plan.legacyDomain.status !== 'proven' && !opts.attestLegacyDomain) {
      return {
        ok: false, code: 'LEGACY_DOMAIN_UNPROVEN', plan, dbChanged: false,
        reason: `저장 v1 이 공개 사슬로 만들어졌다는 증명이 없다(알려진 이름 ${plan.legacyDomain.probeNames}개 · 일치 0) — 창업자 확인 없이는 감싸지 않는다`,
      }
    }
    const keyRead = opts.keyRead
    const byTable = {} as Record<Table, Row[]>
    for (const t of MIGRATION_TABLES) byTable[t] = await rowsOf(prisma, t)

    // ── ⑤ 되돌리기 백업 — 트랜잭션보다 먼저 · 0600 · checksum ──
    mkdirSync(opts.backupDir, { recursive: true, mode: 0o700 })
    const runId = `${opts.now.toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
    const backupFile = join(opts.backupDir, `author-hash-v1-backup-${runId}.jsonl`)
    const lines: BackupLine[] = MIGRATION_TABLES.flatMap((t) => byTable[t]
      .filter((r) => r.authorHash !== null || r.authorHashNorm !== null)
      .map((r) => ({ t, id: r.id, h: r.authorHash, n: r.authorHashNorm })))
    writeFileSync(backupFile, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', { mode: 0o600 })
    writeFileSync(`${backupFile}.sha256`, `${sha256File(backupFile)}\n`, { mode: 0o600 })
    if (readFileSync(backupFile, 'utf-8').split('\n').filter((l) => l !== '').length !== lines.length) {
      return { ok: false, code: 'REFUSED', reason: '되돌리기 백업의 줄 수가 맞지 않는다 — 적용하지 않는다', plan, dbChanged: false }
    }

    const names = await knownNamesOf(prisma)
    const before = new Set(MIGRATION_TABLES.flatMap((t) => valuesOf(byTable[t])))
    const b2HitsBefore = legacyDomainProbe(names, before, normalizeN2).hits
    let wrappedRows = 0
    try {
      if (opts.beforeTx !== undefined) await opts.beforeTx()
      await prisma.$transaction(async (tx) => {
        let pairsDone = 0
        for (const t of MIGRATION_TABLES) {
          for (const p of pairsOf(byTable[t]).values()) {
            const h = p.h === null ? null : wrapV1(p.h, keyRead.key)
            const n = p.n === null ? null : wrapV1(p.n, keyRead.key)
            if ((p.h !== null && h === null) || (p.n !== null && n === null)) throw new Error('WRAP_REFUSED')
            const c = await updatePair(tx, t, { h: p.h, n: p.n }, { h, n })
            // 🔴 읽은 뒤 다른 실행이 바꿨으면 수가 다르다 — 전체 롤백
            if (c !== p.ids.length) throw new Error('CONCURRENT_CHANGE')
            wrappedRows += c
            pairsDone += 1
            if (opts.failAfterPairs !== undefined && pairsDone >= opts.failAfterPairs) throw new Error('INJECTED_FAILURE')
          }
        }
        // ── ⑦ 사후 검증 — 트랜잭션 안 ──
        const after = {} as Record<Table, Row[]>
        for (const t of MIGRATION_TABLES) after[t] = await rowsOf(tx, t)
        for (const t of MIGRATION_TABLES) {
          if (after[t].length !== byTable[t].length) throw new Error('ROW_COUNT_CHANGED')
          const c = censusOf(valuesOf(after[t]), keyRead.key)
          if (c.v2Current !== c.total) throw new Error('NOT_ALL_V2')
        }
        const afterSet = new Set(MIGRATION_TABLES.flatMap((t) => valuesOf(after[t])))
        if (b2HitsV2(names, keyRead, afterSet) !== b2HitsBefore) throw new Error('B2_PARITY_BROKEN')
      }, { timeout: opts.txTimeoutMs ?? TX_TIMEOUT_MS, maxWait: 60_000, isolationLevel: 'Serializable' })
    } catch (e) {
      return { ok: false, code: 'TX_FAILED', reason: `전환 트랜잭션 롤백 — ${e instanceof Error ? e.message : 'unknown'}`, plan, dbChanged: false }
    }
    return { ok: true, kind: 'migrated', plan, backupFile, wrappedRows, b2HitsBefore, b2HitsAfter: b2HitsBefore }
  } finally {
    closeSync(lockFd)
    if (existsSync(opts.lockPath)) unlinkSync(opts.lockPath)
  }
}

export type RollbackResult =
  | { ok: true; restoredRows: number }
  | { ok: false; code: 'BACKUP_INVALID' | 'KEY' | 'LOCKED' | 'TX_FAILED'; reason: string; dbChanged: false }

/**
 * 🔴 **되돌리기** — 백업 checksum 확인 → 행마다 "지금 값 = 백업 v1 을 지금 key 로 감싼 값" 일 때만 v1 로. 단일 트랜잭션.
 *    key 가 적용 때와 다르면 감싼 값이 맞지 않아 전체 롤백된다(다른 key 로 되돌리지 않는다).
 */
export async function rollbackMigration(prisma: PrismaClient, opts: {
  keyRead: AuthorHashKeyRead; backupFile: string; lockPath: string; txTimeoutMs?: number
}): Promise<RollbackResult> {
  if (!opts.keyRead.ok) return { ok: false, code: 'KEY', reason: opts.keyRead.reason, dbChanged: false }
  const keyRead = opts.keyRead
  const sumPath = `${opts.backupFile}.sha256`
  if (!existsSync(opts.backupFile) || !existsSync(sumPath) || readFileSync(sumPath, 'utf-8').trim() !== sha256File(opts.backupFile)) {
    return { ok: false, code: 'BACKUP_INVALID', reason: '백업 파일이 없거나 checksum 이 맞지 않는다', dbChanged: false }
  }
  const lockFd = takeLock(opts.lockPath)
  if (typeof lockFd === 'string') return { ok: false, code: 'LOCKED', reason: lockFd, dbChanged: false }
  try {
    const lines = readFileSync(opts.backupFile, 'utf-8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as BackupLine)
    let restored = 0
    try {
      await prisma.$transaction(async (tx) => {
        for (const t of MIGRATION_TABLES) {
          const rows = lines.filter((l) => l.t === t).map((l) => ({ id: l.id, authorHash: l.h, authorHashNorm: l.n }))
          for (const p of pairsOf(rows).values()) {
            const cur = { h: p.h === null ? null : wrapV1(p.h, keyRead.key), n: p.n === null ? null : wrapV1(p.n, keyRead.key) }
            const c = await updatePair(tx, t, cur, { h: p.h, n: p.n })
            if (c !== p.ids.length) throw new Error('ROLLBACK_MISMATCH')
            restored += c
          }
        }
      }, { timeout: opts.txTimeoutMs ?? TX_TIMEOUT_MS, maxWait: 60_000, isolationLevel: 'Serializable' })
    } catch (e) {
      return { ok: false, code: 'TX_FAILED', reason: `되돌리기 트랜잭션 롤백 — ${e instanceof Error ? e.message : 'unknown'}`, dbChanged: false }
    }
    return { ok: true, restoredRows: restored }
  } finally {
    closeSync(lockFd)
    if (existsSync(opts.lockPath)) unlinkSync(opts.lockPath)
  }
}

/** 🔴 화면 한 줄 — 수와 상태만(해시 · 이름 · key 없음) */
export function describePlan(p: MigrationPlan): string[] {
  const c = (x: AuthorHashCensus): string => `v1 ${x.v1} · v2(지금 key) ${x.v2Current} · v2(다른 key) ${x.v2OtherKey} · 손상 ${x.corrupt}`
  return [
    `key            ${p.key.ok ? `있음 (kid 지문만 · ${p.key.kid.length}자)` : `없음 — ${p.key.reason}`}`,
    ...MIGRATION_TABLES.map((t) => `${t.padEnd(18)} 행 ${p.tables[t].rows} · 값 ${c(p.tables[t].census)}`),
    `상태           ${p.state}`,
    `v1 사슬 증명   ${p.legacyDomain.status} (알려진 이름 ${p.legacyDomain.probeNames}개 · 일치 ${p.legacyDomain.hits})`,
    `할 일          ${p.action}${p.refuseReason === null ? '' : ` — ${p.refuseReason}`} · 감쌀 행 ${p.rowsToWrap} · 갱신 문장 ${p.updateStatements}`,
  ]
}
