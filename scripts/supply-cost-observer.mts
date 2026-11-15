#!/usr/bin/env tsx
/**
 * 공급 비용 관측 — 🔴 **진단 전용** · read-only. DB `findMany` 만 · 장부 읽기만 · write 0 · provider 0
 *   npm run supply:cost-observe -- [--evidence-date=YYYY-MM-DD] [--since=ISO] [--json]
 *
 * 🔴 정본 조립(`preflightWindowsOf` → `readReadyCohort` → 공급 장부 → `costAttributionOf`)을 부르지만,
 *    controller 가 판정 시각에 가진 다가오는 슬롯 짝짓기(`matched`·`horizon`)를 재현하지 못한다(비운다).
 *    그래서 **권위 결과당 단가는 UNKNOWN** 이고, 정본 함수의 값은 진단값으로만 낸다. controller 판정을 대신하지 않는다.
 * 🔴 coverage 기준 시각은 `--since` 또는 실제 배포 증거(manifest.sha = pin 의 deployedAt)에서만 온다.
 * 🔴 상한 $0.040 은 비교만 한다. 바꾸지 않는다.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { PrismaClient } from '@prisma/client'

import { canonicalCostFieldsOf, costCoverageOf, costDaysOf, costVersusCap, coverageSinceOf } from '../src/lib/supply-cost-observation'
import { costAttributionOf, type CostFate } from '../src/lib/ready-fate'
import { isSupplyContentCostStage, type LedgerEntry, type LedgerStage } from '../src/lib/llm-ledger'
import { runIdStartMs } from '../src/lib/ops-shadow-plan'
import { costFateOf, pooledEntries, preflightWindowsOf, readReadyCohort } from './lib/stage-preflight-facts.mjs'
import { defaultLedgerDir, ledgerPathOf, readLedgerDay } from './lib/llm-ledger-store.mjs'
import { SUPPLY_DATA_DIR } from './lib/runner-health.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { fillDbConnection } from './lib/ops-signals.mjs'

export const COST_CAP_USD = 0.04

const arg = (k: string): string | null => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null
const NOW = new Date()
const EVIDENCE = arg('evidence-date') ?? new Date(NOW.getTime() + 9 * 3600_000).toISOString().slice(0, 10)
const CANON_DIR = join(homedir(), 'Library', 'Application Support', 'soransoran')
const readJson = (p: string): Record<string, unknown> | null => { try { return JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown> } catch { return null } }
const pinNow = ((): string | null => { try { return readFileSync(join(CANON_DIR, 'runtime-pinned-sha'), 'utf-8').trim() } catch { return null } })()
const since = coverageSinceOf({ explicitSince: arg('since'), manifest: readJson(join(CANON_DIR, 'runtime-manifest.json')), pin: pinNow })

await loadEnvLocal()
if (!fillDbConnection()) { console.error('🔴 canonical DB env 없음'); process.exit(2) }
const db = new PrismaClient()
try {
  const win = preflightWindowsOf(EVIDENCE, NOW)
  const cohort = await readReadyCohort(db, { windowFrom: win.capacity.from, windowTo: win.capacity.to, dataDir: SUPPLY_DATA_DIR, matched: new Set(), horizon: [], now: NOW })
  const perDay = win.capacity.ledgerDates.map((d) => {
    const path = ledgerPathOf(defaultLedgerDir(), d)
    if (!existsSync(path)) return { date: d, entries: null }
    const r = readLedgerDay(path)
    return { date: d, entries: r.ok ? r.entries : null }
  })
  const entries = pooledEntries(perDay.map((x) => x.entries)) as LedgerEntry[] | null
  const fateByKey = new Map<string, CostFate>()
  for (const r of cohort.rows ?? []) if (r.hash !== null) fateByKey.set(r.hash, costFateOf(r))
  const attribution = cohort.rows === null || cohort.fates === null ? null
    : costAttributionOf({ entries, fateByKey, counts: cohort.fates, cohortRuns: cohort.cohortRuns })
  const canonical = canonicalCostFieldsOf(attribution as unknown as Record<string, unknown> | null)
  const days = costDaysOf(perDay, (s) => isSupplyContentCostStage(s as LedgerStage))
  const coverage = costCoverageOf({ days, cohortRuns: cohort.rows === null ? null : [...cohort.cohortRuns], runStartMs: (r) => runIdStartMs(r), sinceMs: since.sinceMs })
  const out = {
    tool: 'supply-cost-observer', readOnly: true, diagnosticOnly: true, runtimeSha: pinNow, evidenceDate: EVIDENCE,
    window: { from: win.capacity.from.toISOString(), to: win.capacity.to.toISOString() },
    authoritativeUsdPerSlotValidResult: null,
    authoritativeReason: 'controller 판정 시각의 matched·horizon 입력을 재현하지 못함 — 진단값만 낸다',
    diagnostic: { inputs: 'matched=∅ · horizon=∅', canonical },
    cap: { usd: COST_CAP_USD, diagnosticVerdict: costVersusCap(canonical.usdPerSlotValidResult, COST_CAP_USD) },
    coverage: { since: since.sinceMs === null ? null : new Date(since.sinceMs).toISOString(), sinceBasis: since.basis, ...coverage },
    days, notes: cohort.notes,
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 2))
  else {
    const u = (v: unknown): string => (v === null || v === undefined ? 'UNKNOWN' : String(v))
    console.log(`\n══ 공급 비용 관측(진단 전용) · 증거일 ${EVIDENCE} · runtime ${pinNow?.slice(0, 12) ?? '모름'} · read-only ══`)
    console.log(`  창 ${out.window.from} ~ ${out.window.to} (rolling 72h)`)
    console.log(`  권위 결과당 단가 UNKNOWN — ${out.authoritativeReason}`)
    console.log(`  진단(정본 귀속 · 비운 입력): ${Object.entries(canonical).map(([k, v]) => `${k}=${u(v)}`).join(' · ')}`)
    console.log(`  상한 $${COST_CAP_USD.toFixed(3)} 대비(진단): ${out.cap.diagnosticVerdict}`)
    console.log(`  coverage 장부 ${coverage.readableDays}/${coverage.ledgerDays}일 · cohort 회차 ${u(coverage.cohortRuns)} · 기준(${u(out.coverage.since)} · ${since.basis}) 뒤 ${u(coverage.runsAfterSince)} (${u(coverage.afterSinceRatio)}) · 시각 미상 ${u(coverage.unparsedRuns)}`)
    for (const d of days) {
      console.log(`  ${d.ledgerDate} ${d.readable ? '' : '🔴 UNKNOWN(없음/판독 실패) '}요청 ${u(d.requests)} · 정산 ${u(d.settled)}($${u(d.settledUsd)}) · 미상 ${u(d.usageUnknown)}($${u(d.unknownReservedUsd)} 예약) · 예약 ${u(d.reserved)} · 차단 ${u(d.blocked)}`)
    }
    console.log('  🔴 진단 전용 · controller 판정을 대신하지 않는다 · DB write 0 · 파일 write 0 · provider 0')
  }
} finally { await db.$disconnect() }
