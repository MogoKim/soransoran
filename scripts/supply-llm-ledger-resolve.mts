#!/usr/bin/env tsx
/**
 * 열린 예약을 **사람이 마감한다** — 🔴 **네트워크 0 · provider 0 · DB 0**
 *
 * 🔴 **왜 사람이 하는가**
 *    끝을 기록하지 못한 요청이 남으면 그 뒤 유료 요청이 멈춘다. 그것을 푸는 일은
 *    "얼마가 실제로 나갔는가" 를 아는 사람만 할 수 있다. 코드가 스스로 풀면
 *    통제가 아니라 지연일 뿐이다.
 *
 * 🔴 **장부를 지우지 않는다. 예약을 그냥 놓아주지도 않는다.**
 *    마감은 장부에 **줄을 하나 더 적는 것**이다(append-only). 앞 줄은 남는다.
 *    금액을 모른다고 하면 그 건은 **미정산**으로 남아 여력에서 계속 빠진다 —
 *    막힌 것만 풀리고, 쓴 돈이 사라지지는 않는다.
 *
 * 🔴 **금액을 대신 정해 주지 않는다.** `--actual-usd` 나 `--actual-unknown` 중
 *    하나를 사람이 반드시 적어야 한다. 기본값이 없다.
 *
 * 쓰는 법
 *   npm run supply:ledger-resolve                          — 열린 예약을 보여 준다
 *   npm run supply:ledger-resolve -- --attempt=<id> \
 *     --confirmed-with-provider --actual-usd=0.0012        — 실제 금액을 확인했다
 *   npm run supply:ledger-resolve -- --attempt=<id> \
 *     --confirmed-with-provider --actual-unknown           — 확인했지만 금액을 모른다
 */
import { existsSync, readFileSync } from 'node:fs'

import {
  PRICING_VERSION,
} from '../src/lib/llm-pricing'
import {
  classifyReservations, ledgerDateOf, type LedgerEntry,
} from '../src/lib/llm-ledger'
import {
  appendLedgerLine, clearOpenReservation, defaultLedgerDir, ledgerPathOf,
  openReservationsPathOf, pidAlive, readOpenReservations, settleHoldPathOf, withLedgerLock,
} from './lib/llm-ledger-store.mjs'

const argv = process.argv.slice(2)
const fail: (m: string) => never = (m) => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }
const arg = (name: string): string | null =>
  argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null

const DIR = arg('dir') ?? defaultLedgerDir()
const ATTEMPT = arg('attempt')
const CONFIRMED = argv.includes('--confirmed-with-provider')
const ACTUAL_UNKNOWN = argv.includes('--actual-unknown')
const ACTUAL_USD = arg('actual-usd')
const NOTE = arg('note') ?? ''

function main(): void {
  console.log('\n══ 열린 예약 마감 (🔴 네트워크 0 · provider 0 · DB 0) ══\n')
  console.log(`  장부   ${DIR}`)
  const read = readOpenReservations(DIR)
  if (!read.ok) fail(`${read.reason} — 파일을 사람이 열어 확인합니다`)
  const now = new Date()
  const split = classifyReservations({
    open: read.list, now,
    // 🔴 어느 세션도 아니고 어느 프로세스도 아닌 자리에서 본다 —
    //    이 명령은 공급 회차가 아니므로 모든 예약이 "남의 것" 이다
    sessionId: '', pid: -1, pidAlive,
  })

  console.log(`  열린 예약 ${read.list.length}건`
    + ` — 도는 중 ${split.inFlight.length}건 · 확인 필요 ${split.unresolved.length}건\n`)
  for (const r of split.inFlight) {
    console.log(`  🟢 ${r.attemptId}  회차 ${r.runId} · ${r.stage} · ${r.startedAt} — 아직 도는 중으로 보입니다`)
  }
  for (const v of split.unresolved) {
    const r = v.reservation
    console.log(`  🔴 ${r.attemptId}  회차 ${r.runId} · ${r.stage} · ${r.date} · 예약 $${r.reservedUsd ?? 0}`)
    console.log(`       ${v.code} — ${v.reason}`)
    console.log(`       장부 ${ledgerPathOf(DIR, r.date)}`)
  }
  if (existsSync(settleHoldPathOf(DIR))) {
    console.log(`\n  🔴 정산 보류 표식도 있습니다 — ${settleHoldPathOf(DIR)}`)
  }

  if (ATTEMPT === null) {
    console.log('\n  🟡 마감하지 않았습니다. 마감하려면:')
    console.log('     ① 제공사 콘솔에서 그 시각의 실제 사용량을 확인합니다')
    console.log('     ② npm run supply:ledger-resolve -- --attempt=<id> --confirmed-with-provider \\')
    console.log('          --actual-usd=<실제 금액>   (또는 --actual-unknown)')
    console.log(`\n  🔴 ${openReservationsPathOf(DIR)} 를 손으로 지워 풀지 않습니다 —`)
    console.log('     그러면 쓴 돈이 장부에서 사라지고 하루 예산이 그만큼 헐거워집니다.\n')
    return
  }

  // ── 마감 ──
  if (!CONFIRMED) fail('--confirmed-with-provider 가 없습니다 — 제공사 사용량을 확인했다고 사람이 밝혀야 합니다')
  if (ACTUAL_UNKNOWN === (ACTUAL_USD !== null)) {
    fail('--actual-usd=<금액> 과 --actual-unknown 중 **하나**를 적습니다. 기본값은 없습니다')
  }
  const usd = ACTUAL_USD === null ? null : Number(ACTUAL_USD)
  if (usd !== null && (!Number.isFinite(usd) || usd < 0)) fail(`--actual-usd 가 숫자가 아닙니다 — ${ACTUAL_USD}`)

  const target = read.list.find((r) => r.attemptId === ATTEMPT)
  if (target === undefined) fail(`열린 예약에 ${ATTEMPT} 가 없습니다`)

  withLedgerLock(DIR, () => {
    /**
     * 🔴 **줄을 하나 더 적는다.** 예약 줄은 그대로 남고, 접을 때 이 줄이 이긴다.
     *    `usageUnknown` 으로 마감하면 그 건은 **여력에서 계속 빠진다** —
     *    막힌 것만 풀리고 쓴 돈이 사라지지는 않는다.
     */
    const entry: LedgerEntry = {
      runId: target.runId, stage: target.stage, attemptId: target.attemptId,
      requestNo: -1, provider: 'anthropic', apiModelId: '', model: '',
      status: usd === null ? 'usageUnknown' : 'settled',
      blockCode: null,
      countedInputTokens: null, maxOutputTokens: 0,
      reservedUsd: target.reservedUsd,
      inputTokens: null, outputTokens: null, cacheWriteTokens: null, cacheReadTokens: null,
      usageKeys: [],
      settledUsd: usd,
      pricingVersion: PRICING_VERSION,
      startedAt: target.startedAt, endedAt: new Date().toISOString(),
      errorCode: NOTE === '' ? 'HUMAN_RESOLVED' : `HUMAN_RESOLVED:${NOTE.slice(0, 80)}`,
      // 🔴 코드가 스스로 쓰지 않는 값이다. 사람이 마감했다는 표시다
      resolvedBy: 'human',
    }
    appendLedgerLine(ledgerPathOf(DIR, ledgerDateOf(new Date(target.startedAt))), entry)
    clearOpenReservation(DIR, target.attemptId)
  })

  console.log(`\n  ✅ ${ATTEMPT} 를 마감했습니다 — ${usd === null ? '금액 미상(여력에서 계속 빠집니다)' : `$${usd}`}`)
  if (existsSync(settleHoldPathOf(DIR))) {
    console.log(`  🔴 정산 보류 표식은 그대로입니다 — ${settleHoldPathOf(DIR)} 도 확인 후 지웁니다`)
  }
  console.log('  🔴 장부를 지우지 않았습니다. 앞 줄은 그대로 남아 있습니다.\n')
}

// 🔴 import 만으로는 아무 일도 일어나지 않는다
const isDirectRun = process.argv[1] !== undefined
  && readFileSync(process.argv[1], 'utf-8').includes('열린 예약을 **사람이 마감한다**')
if (isDirectRun) main()
