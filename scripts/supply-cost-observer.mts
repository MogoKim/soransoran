#!/usr/bin/env tsx
/**
 * 공급 비용 동일 분모 관측 — 🔴 read-only. DB `findMany` 만 · 장부 읽기만 · write 0 · provider 0
 *   npm run supply:cost-observe -- [--evidence-date=YYYY-MM-DD] [--since=ISO] [--json]
 *
 * 🔴 결과당 단가는 preflight 와 **같은 조립**이다 — `preflightWindowsOf` → `readReadyCohort` → 공급 장부 → `costAttributionOf`.
 *    단 하나 다른 점: 대기 결말 분류에 쓰는 "다가오는 슬롯 짝짓기"(`matched`)를 비운다(관측 시각엔 controller 의 슬롯이 없다).
 *    그래서 이 값은 controller 판정을 **대신하지 않는다** — 같은 분모의 참고 관측이다(출력에 적는다).
 * 🔴 상한 $0.040 은 비교만 한다. 바꾸지 않는다.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { PrismaClient } from '@prisma/client'

import { costCoverageOf, costDaysOf, costVersusCap } from '../src/lib/supply-cost-observation'
import { costAttributionOf, type CostFate } from '../src/lib/ready-fate'
import { isSupplyContentCostStage, type LedgerEntry, type LedgerStage } from '../src/lib/llm-ledger'
import { runIdStartMs } from '../src/lib/ops-shadow-plan'
import { costFateOf, pooledEntries, preflightWindowsOf, readReadyCohort } from './lib/stage-preflight-facts.mjs'
import { defaultLedgerDir, ledgerPathOf, readLedgerDay } from './lib/llm-ledger-store.mjs'
import { SUPPLY_DATA_DIR } from './lib/runner-health.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { fillDbConnection } from './lib/ops-signals.mjs'

export const COST_CAP_USD = 0.04
/** 🔴 기본 기준 시각 — #843(비용 지배 판정·count_tokens) 이 처음 runtime 에 올라간 시각(63207eca · 2026-11-15 00:01 KST) */
export const DEFAULT_SINCE = '2026-11-14T15:01:43.524Z'

const arg = (k: string): string | null => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null
const NOW = new Date()
const kstToday = new Date(NOW.getTime() + 9 * 3600_000).toISOString().slice(0, 10)
const EVIDENCE = arg('evidence-date') ?? kstToday
const SINCE = arg('since') ?? DEFAULT_SINCE
const sinceMs = Number.isNaN(Date.parse(SINCE)) ? null : Date.parse(SINCE)

await loadEnvLocal()
if (!fillDbConnection()) { console.error('🔴 canonical DB env 없음'); process.exit(2) }
const db = new PrismaClient()
try {
  const win = preflightWindowsOf(EVIDENCE, NOW)
  const cohort = await readReadyCohort(db, { windowFrom: win.capacity.from, windowTo: win.capacity.to, dataDir: SUPPLY_DATA_DIR, matched: new Set(), horizon: [], now: NOW })
  const perDay = win.capacity.ledgerDates.map((d) => {
    const r = readLedgerDay(ledgerPathOf(defaultLedgerDir(), d))
    return { date: d, entries: r.ok ? r.entries : null }
  })
  const entries = pooledEntries(perDay.map((x) => x.entries)) as LedgerEntry[] | null
  const fateByKey = new Map<string, CostFate>()
  for (const r of cohort.rows ?? []) if (r.hash !== null) fateByKey.set(r.hash, costFateOf(r))
  const attribution = cohort.rows === null || cohort.fates === null ? null
    : costAttributionOf({ entries, fateByKey, counts: cohort.fates, cohortRuns: cohort.cohortRuns })
  const days = costDaysOf(perDay, (s) => isSupplyContentCostStage(s as LedgerStage))
  const coverage = costCoverageOf({ days, cohortRuns: [...cohort.cohortRuns], runStartMs: (r) => runIdStartMs(r), sinceMs })
  const unit = attribution?.usdPerSlotValidResult ?? null
  const runtimeSha = ((): string | null => {
    try { return readFileSync(join(homedir(), 'Library', 'Application Support', 'soransoran', 'runtime-pinned-sha'), 'utf-8').trim() } catch { return null }
  })()
  const out = {
    tool: 'supply-cost-observer', readOnly: true, runtimeSha, evidenceDate: EVIDENCE, window: { from: win.capacity.from.toISOString(), to: win.capacity.to.toISOString() },
    sameDenominatorAs: 'preflight costAttributionOf (matched=∅ — controller 판정 대체 아님)',
    attribution: attribution === null ? null : {
      totalUsd: attribution.totalUsd, settledRequests: attribution.settledRequests, usageUnknownRequests: attribution.usageUnknownRequests,
      openRequests: attribution.openRequests, openReservedUsd: attribution.openReservedUsd, legacyUsd: attribution.legacyUsd, unlinkedUsd: attribution.unlinkedUsd,
      usdPerSlotValidResult: unit,
    },
    cap: { usd: COST_CAP_USD, verdict: costVersusCap(unit, COST_CAP_USD) },
    coverage: { since: SINCE, ...coverage }, days, notes: cohort.notes,
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 2))
  else {
    console.log(`\n══ 공급 비용 동일 분모 관측 · 증거일 ${EVIDENCE} · runtime ${runtimeSha?.slice(0, 12) ?? '모름'} · read-only ══`)
    console.log(`  창 ${out.window.from} ~ ${out.window.to} (rolling 72h)`)
    if (attribution === null) console.log('  🟡 결과당 단가 UNKNOWN — cohort 판독 실패')
    else console.log(`  정산 $${attribution.totalUsd.toFixed(4)} · 정산 요청 ${attribution.settledRequests} · 미상 ${attribution.usageUnknownRequests} · 미정산 ${attribution.openRequests}`
      + ` · legacy $${attribution.legacyUsd.toFixed(4)} · 미연결 $${attribution.unlinkedUsd.toFixed(4)} · 결과당 ${unit === null ? 'UNKNOWN' : `$${unit.toFixed(5)}`}`)
    console.log(`  상한 $${COST_CAP_USD.toFixed(3)} 대비: ${out.cap.verdict}`)
    console.log(`  coverage 장부 ${coverage.readableDays}/${coverage.ledgerDays}일 · cohort 회차 ${coverage.cohortRuns} · 기준(${SINCE}) 뒤 ${coverage.runsAfterSince ?? '—'} (${coverage.afterSinceRatio ?? '—'}) · 시각 미상 ${coverage.unparsedRuns}`)
    for (const d of days) console.log(`  ${d.ledgerDate} ${d.readable ? '' : '🔴 판독 실패 '}요청 ${d.requests} · 정산 ${d.settled}($${d.settledUsd.toFixed(4)}) · 미상 ${d.usageUnknown} · 예약 ${d.reserved} · 차단 ${d.blocked}`)
    console.log('  🔴 controller 판정을 대신하지 않는다 · DB write 0 · 파일 write 0 · provider 0')
  }
} finally { await db.$disconnect() }
