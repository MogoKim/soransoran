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
 *
 * 🔴 **이미 `usageUnknown` 으로 끝난 요청** (2026-10-13 · D10 SUPPLY_COST_UNKNOWN) — 별도 경로 `--closed-unknown`.
 *    timeout 처럼 응답이 없던 요청은 공급 세션이 스스로 `usageUnknown` 끝 줄을 적고 열린 예약에서 지운다.
 *    그 건은 위 경로로는 찾을 수 없어 cohort 비용이 영영 "모름" 이었다. 이 경로는 **제공사에서 확인한 정확한 실제 금액**이
 *    있을 때만 그 시도에 `settled` 줄 하나를 덧붙인다. 앞 줄은 그대로 남고, 접을 때 새 줄이 이긴다.
 *    · 금액은 사람이 적는다 — 예약액 · 추정 토큰 · 평균 단가로 만들지 않는다. `--actual-unknown` 은 받지 않는다
 *      (모름을 다시 적는 것은 아무것도 풀지 않는다)
 *    · 기본은 **조회 · dry-run** 이다. 장부에 쓰려면 `--apply` 를 붙인다
 *    · 원래 줄의 provider · apiModelId · model · supplyContract · sourceKey · runKind · runSlot · startedAt 을 그대로 옮긴다
 *
 *   npm run supply:ledger-resolve -- --closed-unknown                    — 끝난 사용량 미상 시도를 보여 준다
 *   npm run supply:ledger-resolve -- --closed-unknown --attempt=<id> \
 *     --confirmed-with-provider --actual-usd=0.0031                      — 무엇을 적을지 보여 준다(dry-run)
 *   … 위 명령 + --apply                                                  — 장부에 settled 줄 1개를 덧붙인다
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  PRICING_VERSION,
} from '../src/lib/llm-pricing'
import {
  classifyReservations, ledgerDateOf, type LedgerEntry,
} from '../src/lib/llm-ledger'
import {
  appendLedgerLine, clearOpenReservation, defaultLedgerDir, ledgerPathOf,
  openReservationsPathOf, pidAlive, readLedgerDay, readOpenReservations, settleHoldPathOf, withLedgerLock,
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
const CLOSED_UNKNOWN = argv.includes('--closed-unknown')
const APPLY = argv.includes('--apply')

// ─────────────────────────────────────────────────────────
// 🔴 끝난 사용량 미상 시도 — 순수 함수(검사가 같은 함수를 부른다)
// ─────────────────────────────────────────────────────────

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/

/** 🔴 모델 이름이 정하는 제공사 — 공급 세션(`SupplyLlmSession.base`)과 같은 규칙이다 */
export function providerOfModel(model: string): string | null {
  if (model.startsWith('gemini-')) return 'google'
  if (model.startsWith('claude-')) return 'anthropic'
  if (model.startsWith('gpt-')) return 'openai'
  return null
}

export type ClosedUnknown = { date: string; path: string; entry: LedgerEntry }

/**
 * 🔴 **장부 날짜 파일 전부에서 접은 최종 상태가 `usageUnknown` 인 유료 시도.** 읽지 못한 날짜가 있으면 `null`(모름) —
 *    못 읽은 파일을 조용히 빼면 그 안의 시도를 "없다" 고 말하게 된다.
 */
export function listClosedUnknown(dir: string): ClosedUnknown[] | null {
  if (!existsSync(dir)) return []
  const out: ClosedUnknown[] = []
  for (const f of readdirSync(dir).sort()) {
    const m = DAY_FILE.exec(f)
    if (m === null) continue
    const read = readLedgerDay(join(dir, f))
    if (!read.ok) return null
    for (const e of read.entries) {
      if (e.stage !== 'countTokens' && e.status === 'usageUnknown') out.push({ date: m[1]!, path: join(dir, f), entry: e })
    }
  }
  return out
}

/**
 * 🔴 **그 시도의 최종 상태를 날짜 파일 전부에서 찾는다.** 두 파일에 같은 시도가 있으면 어느 쪽이 최종인지 모르므로 실패다.
 */
export function findAttempt(dir: string, attemptId: string):
  | { ok: true; date: string; path: string; entry: LedgerEntry }
  | { ok: false; reason: string } {
  if (!existsSync(dir)) return { ok: false, reason: `장부 디렉터리가 없다 — ${dir}` }
  const hits: { date: string; path: string; entry: LedgerEntry }[] = []
  for (const f of readdirSync(dir).sort()) {
    const m = DAY_FILE.exec(f)
    if (m === null) continue
    const read = readLedgerDay(join(dir, f))
    if (!read.ok) return { ok: false, reason: `${f} 를 읽지 못했다 — ${read.reason}` }
    const e = read.entries.find((x) => x.attemptId === attemptId)
    if (e !== undefined) hits.push({ date: m[1]!, path: join(dir, f), entry: e })
  }
  if (hits.length === 0) return { ok: false, reason: `장부에 ${attemptId} 가 없다` }
  if (hits.length > 1) return { ok: false, reason: `${attemptId} 가 여러 날짜 파일에 있다 (${hits.map((h) => h.date).join(' · ')}) — 최종 상태를 모른다` }
  return { ok: true, ...hits[0]! }
}

/** 🔴 사람이 적은 금액 — 십진수 글자만. 지수 · 음수 · NaN · 빈 값 · 이름(`reserved` 등)은 금액이 아니다 */
export function parseActualUsd(raw: string | null): { ok: true; usd: number } | { ok: false; reason: string } {
  if (raw === null) return { ok: false, reason: '--actual-usd=<제공사에서 확인한 실제 금액> 이 없다' }
  if (!/^\d+(\.\d{1,12})?$/.test(raw.trim())) return { ok: false, reason: `--actual-usd 는 0 이상의 십진수다 — "${raw}"` }
  const usd = Number(raw.trim())
  if (!Number.isFinite(usd) || usd < 0) return { ok: false, reason: `--actual-usd 가 유한한 0 이상 숫자가 아니다 — "${raw}"` }
  return { ok: true, usd }
}

/** 🔴 원래 줄에서 그대로 옮겨야 하는 칸 — 하나라도 다르면 다른 요청의 비용이 된다 */
export const PRESERVED_FIELDS = [
  'provider', 'apiModelId', 'model', 'supplyContract', 'sourceKey', 'runKind', 'runSlot', 'startedAt',
  'runId', 'stage', 'attemptId',
] as const

/**
 * 🔴 **settled 줄을 만든다.** 원래 줄을 통째로 옮기고 결과 칸만 바꾼다 — 메타데이터를 다시 조립하지 않는다.
 *    토큰은 모르므로 `null` 이다(금액만 사람이 확인했다). 예약액은 원래 값 그대로 남긴다(정산액이 아니다).
 */
export function buildClosedSettlement(original: LedgerEntry, usd: number, note: string, now: Date): LedgerEntry {
  return {
    ...original,
    status: 'settled',
    blockCode: null,
    inputTokens: null, outputTokens: null, cacheWriteTokens: null, cacheReadTokens: null,
    usageKeys: [], usageNumbers: null,
    settledUsd: usd,
    endedAt: now.toISOString(),
    errorCode: `HUMAN_RESOLVED:${original.errorCode ?? 'USAGE_UNKNOWN'}${note === '' ? '' : `:${note.slice(0, 80)}`}`,
    // 🔴 코드가 스스로 쓰지 않는 값이다. 사람이 제공사와 대조해 마감했다는 표시다
    resolvedBy: 'human',
  }
}

/**
 * 🔴 **적기 전 마지막 대조** — 원래 줄과 새 줄이 같은 요청을 가리키고, 제공사가 모델과 맞는가.
 *    Gemini 요청을 anthropic 으로 적는 것 같은 어긋남은 여기서 막힌다(빈 배열이면 통과).
 */
export function closedSettlementProblems(original: LedgerEntry, entry: LedgerEntry): string[] {
  const bad: string[] = []
  if (original.status !== 'usageUnknown') bad.push(`최종 상태가 usageUnknown 이 아니다 — ${original.status}`)
  if (original.stage === 'countTokens') bad.push('사전 계산 줄은 유료 요청이 아니다')
  for (const k of PRESERVED_FIELDS) {
    const a = (original as Record<string, unknown>)[k] ?? null
    const b = (entry as Record<string, unknown>)[k] ?? null
    if (a !== b) bad.push(`${k} 가 원래 줄과 다르다 — ${String(a)} → ${String(b)}`)
  }
  const want = providerOfModel(entry.model)
  if (want === null) bad.push(`모델 ${entry.model || '(빈 값)'} 의 제공사를 모른다`)
  else if (entry.provider !== want) bad.push(`제공사 ${entry.provider} 는 모델 ${entry.model} 과 맞지 않는다 (${want} 여야 한다)`)
  if (entry.apiModelId.trim() === '') bad.push('apiModelId 가 비었다 — 청구서와 대조할 수 없다')
  if (entry.status !== 'settled' || entry.settledUsd === null || !Number.isFinite(entry.settledUsd) || entry.settledUsd < 0) {
    bad.push('새 줄이 정산 금액을 가진 settled 가 아니다')
  }
  if (entry.resolvedBy !== 'human') bad.push('사람 마감 표시가 없다')
  return bad
}

function mainClosedUnknown(): void {
  console.log('\n══ 끝난 사용량 미상 시도 마감 (🔴 네트워크 0 · provider 0 · DB 0) ══\n')
  console.log(`  장부   ${DIR}`)
  if (ACTUAL_UNKNOWN) fail('--actual-unknown 은 이 경로에서 받지 않는다 — 이미 사용량 미상이다. 모름을 다시 적는 것은 아무것도 풀지 않는다')

  if (ATTEMPT === null) {
    const list = listClosedUnknown(DIR)
    if (list === null) fail('장부 날짜 파일 중 읽지 못한 것이 있다 — 사람이 파일을 열어 확인한다')
    console.log(`  끝난 사용량 미상 시도 ${list.length}건\n`)
    for (const c of list) {
      const e = c.entry
      console.log(`  🔴 ${e.attemptId}  ${c.date} · 회차 ${e.runId} · ${e.stage} · ${e.provider}/${e.model}`
        + ` · 시작 ${e.startedAt} · ${e.errorCode ?? '-'} · 예약 $${e.reservedUsd ?? '?'}(실제 비용 아님)`)
    }
    console.log('\n  🟡 아무것도 쓰지 않았습니다. 마감하려면 제공사 콘솔에서 그 요청의 실제 금액을 확인한 뒤:')
    console.log('     npm run supply:ledger-resolve -- --closed-unknown --attempt=<id> --confirmed-with-provider --actual-usd=<실제 금액>')
    console.log('     (먼저 dry-run 으로 확인하고, 장부에 쓰려면 --apply 를 붙입니다)\n')
    return
  }

  if (!CONFIRMED) fail('--confirmed-with-provider 가 없습니다 — 제공사에서 실제 금액을 확인했다고 사람이 밝혀야 합니다')
  const usd = parseActualUsd(ACTUAL_USD)
  if (!usd.ok) fail(usd.reason)

  const open = readOpenReservations(DIR)
  if (!open.ok) fail(`${open.reason} — 열린 예약 파일을 사람이 확인합니다`)
  if (open.list.some((r) => r.attemptId === ATTEMPT)) {
    fail(`${ATTEMPT} 는 아직 열린 예약이다 — 이 경로가 아니라 기본 경로(--closed-unknown 없이)로 마감합니다`)
  }
  const found = findAttempt(DIR, ATTEMPT)
  if (!found.ok) fail(found.reason)
  if (found.entry.status !== 'usageUnknown') {
    fail(`${ATTEMPT} 의 최종 상태는 ${found.entry.status} 다 — usageUnknown 만 이 경로로 마감한다`
      + (found.entry.status === 'settled' ? ' (이미 정산됐다 — 중복 마감 거부)' : ''))
  }
  // 🔴 예약액을 그대로 옮겨 적은 금액은 확인한 실제 금액이 아니다
  if (found.entry.reservedUsd !== null && usd.usd === found.entry.reservedUsd) {
    fail(`--actual-usd 가 예약액 $${found.entry.reservedUsd} 와 같다 — 예약액은 추정이지 실제 비용이 아니다. 제공사 금액을 적는다`)
  }
  const entry = buildClosedSettlement(found.entry, usd.usd, NOTE, new Date())
  const bad = closedSettlementProblems(found.entry, entry)
  if (bad.length > 0) fail(`대조 실패 — ${bad.join(' · ')}`)

  console.log(`\n  대상   ${ATTEMPT} · ${found.date} · 회차 ${entry.runId} · ${entry.stage} · ${entry.provider}/${entry.model}`)
  console.log(`  적을 줄 settled $${usd.usd} · 예약 $${entry.reservedUsd ?? '?'} 그대로 · ${found.path}`)
  if (!APPLY) {
    console.log('\n  🟡 dry-run — 장부에 쓰지 않았습니다. 쓰려면 같은 명령에 --apply 를 붙입니다.\n')
    return
  }
  withLedgerLock(DIR, () => {
    // 🔴 잠금 안에서 다시 확인한다 — 그 사이 누가 먼저 마감했으면 두 번 적지 않는다
    const again = findAttempt(DIR, ATTEMPT)
    if (!again.ok || again.entry.status !== 'usageUnknown' || again.path !== found.path) {
      throw new Error(`잠금 안에서 다시 보니 대상이 바뀌었다 — ${again.ok ? again.entry.status : again.reason}`)
    }
    appendLedgerLine(found.path, entry)
  })
  console.log(`\n  ✅ ${ATTEMPT} 를 $${usd.usd} 로 마감했습니다 — 앞 줄은 그대로 남아 있습니다 (append-only)\n`)
}

function main(): void {
  if (CLOSED_UNKNOWN) { mainClosedUnknown(); return }
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
    const path = ledgerPathOf(DIR, ledgerDateOf(new Date(target.startedAt)))
    /**
     * 🔴 **원래 예약 줄의 실행 종류 · 슬롯을 옮겨 적는다** (2026-09-29 3차).
     *    이 줄이 접을 때 예약 줄을 **이긴다** — 표식을 빼고 적으면 그 요청이 어느 정기 슬롯의 것이었는지
     *    장부에서 사라진다. 그러면 ① "사람이 마감한 슬롯은 정기 실측에서 뺀다" 가 걸리지 않고
     *    ② 그 금액이 슬롯 지출에서 빠진다. 원래 줄을 못 읽으면 표식 없이 적는다 — 실측 쪽이
     *    `startedAt` 으로 그 슬롯을 따로 뺀다(`scheduledRunSamples`).
     */
    const day = readLedgerDay(path)
    const original = day.ok ? day.entries.find((e) => e.attemptId === target.attemptId) : undefined
    const tags = original?.runKind === undefined && original?.runSlot === undefined
      ? {}
      : { runKind: original?.runKind ?? null, runSlot: original?.runSlot ?? null }
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
      ...tags,
    }
    appendLedgerLine(path, entry)
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
