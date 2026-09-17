#!/usr/bin/env tsx
/**
 * 공급 AI 비용 장부 검사 — 🔴 **네트워크 0 · 실제 provider 0 · 운영 env 0 · DB 0**
 *
 * 🔴 **이 검사가 확인하는 것**
 *    ① 모든 유료 요청이 장부를 지난다 — 우회하는 자리가 없다
 *    ② 모르면 보낸다가 아니라 **모르면 멈춘다** (예산·단가·사전 계산·장부)
 *    ③ 미정산 예약이 여력을 되돌려 주지 않는다
 *    ④ 실제 사용량이 예약을 넘으면 그 뒤 유료 요청이 멈춘다
 *    ⑤ 사전 계산(무료)과 유료 생성을 **따로** 센다
 *
 * 🔴 **이 검사가 확인하지 못하는 것 — 실제 과금.**
 *    가짜 provider 가 신고한 사용량으로 계산한다. 제공사 청구서가 정본이다.
 *    그리고 `count_tokens` 는 공식 문서가 **estimate** 라고 적은 값이다 —
 *    "일일 과금이 한도를 넘지 않는다" 를 이 검사로 주장하지 않는다.
 *
 * 🔴 **실제 운영 자산·env·장부를 건드리지 않는다.** 전부 임시 디렉터리와 임시 HOME 이다.
 */
import { spawnSync } from 'node:child_process'
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  symlinkSync, utimesSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  LEDGER_SCOPE, LEDGER_STAGES, LEDGER_TZ_LABEL, PAID_STAGES,
  judgeSettle, judgeSpend, ledgerDateOf, previousLedgerDate, runPaidCountOf, tallyOf,
  type BudgetLimits, type LedgerEntry, type LedgerStage,
} from '../src/lib/llm-ledger'
import {
  BILLABLE_NOW, MODEL_PRICES, PRICING_CHECKED_AT, PRICING_SOURCE, PRICING_VERSION,
  costOf, priceOf, reserveOf,
} from '../src/lib/llm-pricing'
import {
  LOCK_STALE_REPORT_MS, LOCK_WAIT_MS, LedgerLockError,
  appendLedgerLine, ledgerPathOf, lockPathOf, readLedgerDay, readLedgerRun,
  readSettleHold, settleHoldPathOf, withLedgerLock, writeSettleHold,
} from './lib/llm-ledger-store.mjs'
import {
  BUDGET_ENV, LEDGER_BLOCKED, REAL_LEDGER_IO, SupplyLlmSession, limitsFromEnv,
  type LedgerIo,
} from './lib/supply-llm-call.mjs'
import { DATA_DIR_NAME } from '../src/lib/micro-seed-82cook-thin-adapt'
import { MACHINE_SITE_PREFIX } from '../src/lib/micro-seed-supply-autofill'
import { buildQueueSnapshot, queueSnapshotFileName } from '../src/lib/supply-queue-snapshot'
/** 🔴 계획 정본 — 문자열이 아니라 **실제 인자**를 본다 */
import { judgeBuffer, planCommonPhase, planPending } from '../src/lib/supply-process'
import { writeFakePersonaAsset } from './lib/fake-persona-asset.mjs'

/** 🔴 주석을 지운다 — 검사가 주석의 낱말이 아니라 **코드**를 보게 한다 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

let pass = 0
let fail = 0
const check = (n: string, ok: boolean): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${n}`) } else { fail += 1; console.log(`  🔴 FAIL ${n}`) }
}

console.log('\n══ 공급 AI 비용 장부 검사 (🔴 네트워크 0 · 실제 provider 0) ══\n')

/** 장부 한 줄을 만든다 — 시험용 */
const ENTRY = (o: Partial<LedgerEntry>): LedgerEntry => ({
  runId: 'R', stage: 'draftGen', attemptId: 'a1', requestNo: 0,
  provider: 'anthropic', apiModelId: 'claude-haiku-4-5-20251001', model: 'claude-haiku-4.5',
  status: 'settled', blockCode: null,
  countedInputTokens: 100, maxOutputTokens: 1200, reservedUsd: 0.01,
  inputTokens: 100, outputTokens: 200, cacheWriteTokens: 0, cacheReadTokens: 0,
  usageKeys: ['input_tokens', 'output_tokens'],
  settledUsd: 0.001, pricingVersion: PRICING_VERSION,
  startedAt: '2026-09-17T00:00:00.000Z', endedAt: '2026-09-17T00:00:01.000Z', errorCode: null,
  ...o,
})

const LIMITS = (o: Partial<BudgetLimits> = {}): BudgetLimits => ({
  dailyUsd: 1, runRequestCap: 1000, headroomMultiplier: 1.5, ...o,
})
const KNOWN = { known: true as const, usd: 0.01, pricingVersion: PRICING_VERSION }

// ─────────────────────────────────────────────────────────
console.log('① 단가 — 🔴 공식 문서에서 확인한 값만 쓴다')
// ─────────────────────────────────────────────────────────
{
  check('🔴 출처와 조회일을 코드에 남긴다',
    PRICING_SOURCE.startsWith('https://') && /^\d{4}-\d{2}-\d{2}$/.test(PRICING_CHECKED_AT))
  const haiku = priceOf('claude-haiku-4.5')
  check('🔴 Haiku 4.5 입력 $1/MTok · 출력 $5/MTok (2026-09-17 공식 문서)',
    haiku !== null && haiku.inputPerMTok === 1 && haiku.outputPerMTok === 5)
  check('🔴 캐시 쓰기 1.25x(5분) · 2x(1시간) · 읽기 0.1x',
    haiku !== null && haiku.cacheWrite5mPerMTok === 1.25
    && haiku.cacheWrite1hPerMTok === 2 && haiku.cacheReadPerMTok === 0.1)
  check('🔴 모르는 모델은 null 이다 — 추정 단가로 계산하지 않는다', priceOf('gpt-5-nano') === null)
  check('🔴 단가표를 실행 중에 바꿀 수 없다', Object.isFrozen(MODEL_PRICES))
  check('🔴 지금 과금되는 요소는 입력·출력 둘뿐이라고 적어 뒀다',
    BILLABLE_NOW.length === 2 && BILLABLE_NOW.includes('inputTokens') && BILLABLE_NOW.includes('outputTokens'))

  // 실제 계산 — 100만 입력 + 100만 출력 = $6
  const c = costOf({
    model: 'claude-haiku-4.5',
    usage: { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheWriteTokens: 0, cacheReadTokens: 0 },
  })
  check('🔴 100만 입력 + 100만 출력 = $6.00', c.known && Math.abs(c.usd - 6) < 1e-9)

  // 🔴 모르면 0원이 아니라 **미상**이다
  for (const [label, usage] of [
    ['입력 미상', { inputTokens: null, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 }],
    ['출력 미상', { inputTokens: 1, outputTokens: null, cacheWriteTokens: 0, cacheReadTokens: 0 }],
    ['캐시 미상', { inputTokens: 1, outputTokens: 1, cacheWriteTokens: null, cacheReadTokens: 0 }],
  ] as const) {
    const v = costOf({ model: 'claude-haiku-4.5', usage })
    check(`🔴 ${label} → 계산하지 않는다 (0원으로 적지 않는다)`, !v.known && v.code === 'NO_USAGE')
  }
  check('🔴 단가를 모르면 계산하지 않는다',
    !costOf({
      model: 'gemini-3.7-flash',
      usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
    }).known)

  // 🔴 캐시 쓰기는 **비싼 쪽**으로 센다 — 적게 세면 장부가 실제보다 작아진다
  const cw = costOf({
    model: 'claude-haiku-4.5',
    usage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1_000_000, cacheReadTokens: 0 },
  })
  check('🔴 5분·1시간을 구분할 수 없으면 비싼 쪽(2x)으로 센다', cw.known && Math.abs(cw.usd - 2) < 1e-9)
}

// ─────────────────────────────────────────────────────────
console.log('\n② 예약액 — 🔴 확정 상한이 아니다')
// ─────────────────────────────────────────────────────────
{
  const r = reserveOf({
    model: 'claude-haiku-4.5', countedInputTokens: 1_000_000,
    maxOutputTokens: 1_000_000, headroomMultiplier: 1,
  })
  check('🔴 예약 = 계산 입력 × 여유 × 입력단가 + 출력한도 × 출력단가', r.known && Math.abs(r.usd - 6) < 1e-9)
  const r2 = reserveOf({
    model: 'claude-haiku-4.5', countedInputTokens: 1_000_000,
    maxOutputTokens: 0, headroomMultiplier: 2,
  })
  check('🔴 여유 배수가 예약을 키운다', r2.known && Math.abs(r2.usd - 2) < 1e-9)
  check('🔴 여유 배수가 1 미만이면 예약하지 않는다 — 추정 오차를 덮지 못한다',
    !reserveOf({
      model: 'claude-haiku-4.5', countedInputTokens: 10, maxOutputTokens: 10, headroomMultiplier: 0.5,
    }).known)
  check('🔴 사전 계산값이 없으면 예약하지 않는다',
    !reserveOf({
      model: 'claude-haiku-4.5', countedInputTokens: Number.NaN, maxOutputTokens: 10, headroomMultiplier: 1,
    }).known)
  // 🔴 여유 계수를 라이브러리가 **정하지 않는다** — 호출부가 준다
  const src = readFileSync('src/lib/llm-pricing.ts', 'utf-8')
  check('🔴 여유 배수에 기본값을 심지 않았다 — 운영 값을 코드가 고르지 않는다',
    !/headroomMultiplier\s*[?:]?\s*=\s*[\d.]/.test(src))
  check('🔴 문서가 count_tokens 를 추정이라고 적은 것을 코드에 남겼다',
    /estimate/.test(src) && /상한이 아니라/.test(src))
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 날짜 경계 — 🔴 KST 자정 기준')
// ─────────────────────────────────────────────────────────
{
  check('🔴 KST 임을 라벨로 밝힌다', LEDGER_TZ_LABEL.includes('UTC+9'))
  check('🔴 UTC 14:59 는 아직 그날(KST 23:59)', ledgerDateOf(new Date('2026-09-17T14:59:00.000Z')) === '2026-09-17')
  check('🔴 UTC 15:00 은 다음 날(KST 00:00)', ledgerDateOf(new Date('2026-09-17T15:00:00.000Z')) === '2026-09-18')
  check('🔴 UTC 00:00 은 같은 날(KST 09:00)', ledgerDateOf(new Date('2026-09-17T00:00:00.000Z')) === '2026-09-17')
  check('🔴 장부가 무엇을 덮는지 코드에 적었다 — 공급 회차뿐', LEDGER_SCOPE === 'local-supply')
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 집계 — 🔴 미정산 예약을 자동으로 풀지 않는다')
// ─────────────────────────────────────────────────────────
{
  check('🔴 사전 계산은 유료 단계가 아니다',
    !PAID_STAGES.includes('countTokens') && LEDGER_STAGES.includes('countTokens'))
  check('🔴 재시도와 나이 검수도 저마다 단계를 갖는다',
    (['judgeRetry', 'jsonRetry', 'schemaRetry', 'ageCheck'] as LedgerStage[])
      .every((s) => PAID_STAGES.includes(s)))

  const t = tallyOf([
    ENTRY({ attemptId: 'a', status: 'settled', settledUsd: 0.5, reservedUsd: 0.6 }),
    ENTRY({ attemptId: 'b', status: 'reserved', reservedUsd: 0.3, settledUsd: null }),
    ENTRY({ attemptId: 'c', status: 'usageUnknown', reservedUsd: 0.2, settledUsd: null }),
    ENTRY({ attemptId: 'd', status: 'blocked', reservedUsd: null, settledUsd: null }),
    ENTRY({ attemptId: 'e', stage: 'countTokens', status: 'settled', reservedUsd: 0, settledUsd: 0 }),
  ])
  check('🔴 정산액만 정산으로 센다', Math.abs(t.settledUsd - 0.5) < 1e-9)
  check('🔴 예약과 미상을 **둘 다** 열린 예약으로 센다', Math.abs(t.openReservedUsd - 0.5) < 1e-9)
  check('🔴 사용량 미상을 따로 보여 준다', Math.abs(t.usageUnknownUsd - 0.2) < 1e-9)
  check('🔴 사전 계산은 유료 건수에 넣지 않는다', t.paidRequests === 3 && t.countTokensRequests === 1)
  check('🔴 보류는 유료 건수가 아니다', t.blocked === 1)

  const over = tallyOf([ENTRY({ status: 'settled', settledUsd: 0.9, reservedUsd: 0.1 })])
  check('🔴 실제가 예약을 넘으면 불일치로 센다', over.overruns === 1)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 요청 전 차단 — 🔴 모르면 멈춘다')
// ─────────────────────────────────────────────────────────
{
  const base = {
    tally: tallyOf([]), runPaid: 0, reserve: KNOWN, ledgerOk: true, settleHold: null,
  }
  check('🔴 장부를 못 읽으면 보류한다',
    (() => { const v = judgeSpend({ ...base, limits: LIMITS(), ledgerOk: false }); return !v.ok && v.code === 'LEDGER_ERROR' })())
  check('🔴 예산 금액이 없으면 보류한다 — 기본값을 만들지 않는다',
    (() => { const v = judgeSpend({ ...base, limits: LIMITS({ dailyUsd: null }) }); return !v.ok && v.code === 'NO_BUDGET' })())
  check('🔴 여유 배수가 없으면 보류한다',
    (() => { const v = judgeSpend({ ...base, limits: LIMITS({ headroomMultiplier: null }) }); return !v.ok && v.code === 'NO_BUDGET' })())
  check('🔴 사전 계산이 없으면 보류한다',
    (() => {
      const v = judgeSpend({ ...base, limits: LIMITS(), reserve: { known: false, code: 'NO_USAGE', reason: 'x' } })
      return !v.ok && v.code === 'NO_COUNT'
    })())
  check('🔴 단가를 모르면 보류한다',
    (() => {
      const v = judgeSpend({ ...base, limits: LIMITS(), reserve: { known: false, code: 'NO_PRICE', reason: 'x' } })
      return !v.ok && v.code === 'NO_PRICE'
    })())
  check('🔴 회차 요청 상한에 닿으면 보류한다',
    (() => {
      const v = judgeSpend({ ...base, limits: LIMITS({ runRequestCap: 3 }), runPaid: 3 })
      return !v.ok && v.code === 'RUN_CAP'
    })())
  check('🟢 여력이 있으면 통과하고 그만큼 예약한다',
    (() => { const v = judgeSpend({ ...base, limits: LIMITS() }); return v.ok && v.reservedUsd === 0.01 })())

  // 🔴 미정산 예약이 여력을 되돌려 주지 않는다
  const unsettled = tallyOf([ENTRY({ status: 'usageUnknown', reservedUsd: 0.995, settledUsd: null })])
  check('🔴 미정산 예약을 빼고 남은 여력을 본다 — 모르는 건이 다시 예산을 열어 주지 않는다',
    (() => {
      const v = judgeSpend({ ...base, tally: unsettled, limits: LIMITS() })
      return !v.ok && v.code === 'DAILY_EXHAUSTED'
    })())
  check('🔴 정산이 끝난 만큼만 여력이 줄어든다',
    (() => {
      const v = judgeSpend({
        ...base, limits: LIMITS(),
        tally: tallyOf([ENTRY({ status: 'settled', settledUsd: 0.5, reservedUsd: 0.6 })]),
      })
      return v.ok && Math.abs(v.remainingUsd - 0.49) < 1e-9
    })())

  // 🔴 불일치 뒤에는 멈춘다
  check('🔴 실제가 예약을 넘은 건이 있으면 그 뒤 유료 요청을 보류한다',
    (() => {
      const v = judgeSpend({
        ...base, limits: LIMITS(),
        tally: tallyOf([ENTRY({ status: 'settled', settledUsd: 0.001, reservedUsd: 0.0001 })]),
      })
      return !v.ok && v.code === 'UNSETTLED_OVERRUN'
    })())

  // 정산 판정
  check('🔴 사용량을 모르면 미정산으로 끝낸다 — 예약을 풀지 않는다',
    (() => {
      const r = judgeSettle({ reservedUsd: 0.1, cost: { known: false, code: 'NO_USAGE', reason: 'x' } })
      return r.status === 'usageUnknown' && r.settledUsd === null
    })())
  check('🔴 실제가 예약보다 크면 실제 금액을 적고 불일치로 표시한다',
    (() => {
      const r = judgeSettle({ reservedUsd: 0.1, cost: { known: true, usd: 0.9, pricingVersion: 'v' } })
      return r.status === 'settled' && r.settledUsd === 0.9 && r.overran
    })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 저장소 — 🔴 덧붙이기 · 잠금 · 깨진 줄은 실패')
// ─────────────────────────────────────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'ledger-store-'))
  const path = ledgerPathOf(dir, '2026-09-17')
  check('🔴 없는 파일은 빈 장부다 — 실패가 아니다',
    (() => { const r = readLedgerDay(path); return r.ok && r.entries.length === 0 })())

  appendLedgerLine(path, ENTRY({ attemptId: 'x', status: 'reserved', settledUsd: null }))
  appendLedgerLine(path, ENTRY({ attemptId: 'y', status: 'reserved', settledUsd: null }))
  appendLedgerLine(path, ENTRY({ attemptId: 'x', status: 'settled', settledUsd: 0.02 }))
  const read = readLedgerDay(path)
  check('🔴 같은 요청의 마지막 줄이 이긴다 — 예약을 정산이 덮는다',
    read.ok && read.entries.length === 2
    && read.entries.find((e) => e.attemptId === 'x')?.status === 'settled')
  check('🔴 앞줄을 지우지 않는다 — 파일에 세 줄이 그대로 있다',
    readFileSync(path, 'utf-8').trim().split('\n').length === 3)

  writeFileSync(path, `${readFileSync(path, 'utf-8')}{ 깨진 줄\n`, 'utf-8')
  check('🔴 깨진 줄이 있으면 **읽기 실패**다 — 건너뛰면 이미 보낸 요청이 사라진다',
    !readLedgerDay(path).ok)

  const bad = ledgerPathOf(dir, '2026-09-18')
  writeFileSync(bad, `${JSON.stringify({ runId: 'R', attemptId: 'z', stage: '모르는단계', status: 'settled' })}\n`, 'utf-8')
  check('🔴 모르는 단계 이름을 통과시키지 않는다', !readLedgerDay(bad).ok)
  writeFileSync(bad, `${JSON.stringify({ ...ENTRY({}), status: '아무거나' })}\n`, 'utf-8')
  check('🔴 모르는 상태를 통과시키지 않는다', !readLedgerDay(bad).ok)
  writeFileSync(bad, `${JSON.stringify({ ...ENTRY({}), reservedUsd: '비싸다' })}\n`, 'utf-8')
  check('🔴 금액 자리에 숫자가 아닌 것이 오면 실패한다', !readLedgerDay(bad).ok)

  // 잠금
  let inner = 'not-run'
  withLedgerLock(dir, () => {
    inner = existsSync(lockPathOf(dir)) ? 'locked' : 'unlocked'
  })
  check('🔴 잠금 구간 안에서는 잠금 파일이 있다', inner === 'locked')
  check('🔴 나오면 잠금을 푼다', !existsSync(lockPathOf(dir)))
  check('🔴 예외가 나도 잠금을 푼다',
    (() => {
      try { withLedgerLock(dir, () => { throw new Error('x') }) } catch { /* 기대한 예외 */ }
      return !existsSync(lockPathOf(dir))
    })())
  // 🔴 **잠금을 빼앗지 않는다** (2026-09-17 보정)
  {
    const storeSrc = readFileSync('scripts/lib/llm-ledger-store.mts', 'utf-8')
    check('🔴 mtime 을 보고 잠금을 지우는 코드가 없다',
      !/rmSync\(lock[\s\S]{0,80}(stale|STALE|age)/.test(storeSrc)
      && !/if \(age > LOCK_STALE/.test(storeSrc))
    check('🔴 오래된 잠금은 "지운다" 가 아니라 **사람에게 알린다**',
      /LOCK_STALE_REPORT_MS/.test(storeSrc) && /사람이 확인하고 지운다/.test(storeSrc))
    check('🔴 잠금에 주인 표식을 쓴다', /JSON\.stringify\(owner\)/.test(storeSrc))
    check('🔴 풀 때 **내 것인지** 확인한다',
      /cur\.owner === owner\.owner/.test(storeSrc))

    // ① 살아 있는 소유자 — 잠금을 쥔 채로 다른 요청이 들어오면 빼앗지 못하고 보류된다
    const lock = lockPathOf(dir)
    writeFileSync(lock, JSON.stringify({ owner: '남의-것', pid: 1, at: new Date().toISOString() }), 'utf-8')
    let threw: unknown = null
    const t0 = Date.now()
    try { withLedgerLock(dir, () => 0) } catch (e) { threw = e }
    check('🔴 남이 쥔 잠금은 빼앗지 않고 보류한다', threw instanceof LedgerLockError)
    check('🔴 기다렸다가 보류한다 — 곧바로 뚫고 들어가지 않는다', Date.now() - t0 >= LOCK_WAIT_MS - 50)
    check('🔴 보류해도 남의 잠금을 지우지 않았다', existsSync(lock))

    // ② 오래된 잠금 — 지우지 않고 사유에 적는다
    const old = new Date(Date.now() - LOCK_STALE_REPORT_MS - 60_000)
    utimesSync(lock, old, old)
    let msg = ''
    try { withLedgerLock(dir, () => 0) } catch (e) { msg = e instanceof Error ? e.message : '' }
    check('🔴 오래된 잠금도 지우지 않는다', existsSync(lock))
    check('🔴 오래됐다는 사실을 사유에 적어 사람에게 넘긴다',
      /초째 남아 있다/.test(msg) && /자동으로 지우지 않는다/.test(msg))
    rmSync(lock, { force: true })

    // ③ 소유권이 바뀌면 남의 잠금을 풀지 않는다
    withLedgerLock(dir, () => {
      // 잠금 구간 안에서 주인이 바뀐 상황을 만든다
      writeFileSync(lock, JSON.stringify({ owner: '나중-사람', pid: 2, at: new Date().toISOString() }), 'utf-8')
    })
    check('🔴 나오는 길에 **남의 잠금**을 지우지 않는다 — 두 회차가 같이 들어가지 않는다',
      existsSync(lock) && readFileSync(lock, 'utf-8').includes('나중-사람'))
    rmSync(lock, { force: true })
  }

  // 🔴 장부에 본문이 들어갈 자리가 없다
  const ledgerSrc = readFileSync('src/lib/llm-ledger.ts', 'utf-8')
  // 🔴 **주석이 아니라 칸 이름만 본다.** 주석의 낱말을 위반으로 읽으면 검사가 무의미해진다
  const typeBlock = stripComments(
    ledgerSrc.slice(ledgerSrc.indexOf('export type LedgerEntry'), ledgerSrc.indexOf('/** 하루치 집계')))
  check('🔴 장부 줄에 본문·프롬프트·응답·키가 들어갈 칸이 없다',
    !/(prompt|rawText|body|content|apiKey|systemPrompt|payload|title|text)/i.test(typeBlock))
  check('🔴 사용량은 **키 이름만** 남긴다', /usageKeys: string\[\]/.test(typeBlock))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥-b 회차 상한 — 🔴 장부에서 세고, 자정에 초기화되지 않는다')
// ─────────────────────────────────────────────────────────
{
  const rows = [
    ENTRY({ runId: 'R1', attemptId: 'a', status: 'settled' }),
    ENTRY({ runId: 'R1', attemptId: 'b', status: 'usageUnknown', settledUsd: null }),
    ENTRY({ runId: 'R1', attemptId: 'c', status: 'blocked', settledUsd: null }),
    ENTRY({ runId: 'R1', attemptId: 'd', stage: 'countTokens', status: 'settled' }),
    ENTRY({ runId: 'R2', attemptId: 'e', status: 'settled' }),
  ]
  check('🔴 보낸 것만 센다 — 보류·무료 사전 계산은 상한에 넣지 않는다',
    runPaidCountOf(rows, 'R1') === 2)
  check('🔴 다른 회차의 사용량을 자기 상한에 넣지 않는다', runPaidCountOf(rows, 'R2') === 1)
  check('🔴 어제 날짜를 계산한다 — 회차가 자정을 넘을 때 쓴다',
    previousLedgerDate('2026-09-18') === '2026-09-17'
    && previousLedgerDate('2026-01-01') === '2025-12-31'
    && previousLedgerDate('2026-03-01') === '2026-02-28')

  // 🔴 자정을 넘어도 같은 회차 상한이 초기화되지 않는다
  const dir = mkdtempSync(join(tmpdir(), 'ledger-run-'))
  appendLedgerLine(ledgerPathOf(dir, '2026-09-17'), ENTRY({ runId: 'R1', attemptId: 'y1' }))
  appendLedgerLine(ledgerPathOf(dir, '2026-09-17'), ENTRY({ runId: 'R1', attemptId: 'y2' }))
  appendLedgerLine(ledgerPathOf(dir, '2026-09-18'), ENTRY({ runId: 'R1', attemptId: 't1' }))
  const crossed = readLedgerRun(dir, '2026-09-18', 'R1')
  check('🔴 자정을 넘은 회차는 어제 파일도 함께 읽는다 — 상한이 초기화되지 않는다',
    crossed.ok && runPaidCountOf(crossed.entries, 'R1') === 3)
  check('🔴 오늘 파일만 봤다면 1건으로 보였을 것이다',
    (() => {
      const today = readLedgerDay(ledgerPathOf(dir, '2026-09-18'))
      return today.ok && runPaidCountOf(today.entries, 'R1') === 1
    })())
  writeFileSync(ledgerPathOf(dir, '2026-09-17'), '{ 깨진 줄\n', 'utf-8')
  check('🔴 어제 파일을 못 읽으면 **실패**다 — 반쪽만 세지 않는다',
    !readLedgerRun(dir, '2026-09-18', 'R1').ok)

  // 🔴 상한 미설정·잘못된 값은 보류
  const base = { tally: tallyOf([]), runPaid: 0, reserve: KNOWN, ledgerOk: true, settleHold: null }
  check('🔴 회차 상한이 없으면 보류한다 — 미설정을 "무제한" 으로 읽지 않는다',
    (() => {
      const v = judgeSpend({ ...base, limits: LIMITS({ runRequestCap: null }) })
      return !v.ok && v.code === 'NO_BUDGET'
    })())
  check('🔴 요청 수 상한에 소수는 받지 않는다',
    limitsFromEnv({ [BUDGET_ENV.runRequestCap]: '2.5' }).runRequestCap === null)
  check('🔴 요청 수 상한에 음수·0·글자는 받지 않는다',
    limitsFromEnv({ [BUDGET_ENV.runRequestCap]: '0' }).runRequestCap === null
    && limitsFromEnv({ [BUDGET_ENV.runRequestCap]: '-3' }).runRequestCap === null
    && limitsFromEnv({ [BUDGET_ENV.runRequestCap]: '세 번' }).runRequestCap === null)
  check('🟢 정수는 그대로 읽는다', limitsFromEnv({ [BUDGET_ENV.runRequestCap]: '6' }).runRequestCap === 6)

  // 🔴 러너가 회차 id 를 지어내지 않는다
  for (const [label, file] of [
    ['판정', 'scripts/micro-seed-auto-judge.mts'],
    ['생성', 'scripts/micro-seed-auto-draft.mts'],
  ] as const) {
    const src = readFileSync(file, 'utf-8')
    check(`🔴 ${label} 러너가 --run-id 없이 유료 경로로 가지 않는다`,
      /RUN_ID === null \|\| RUN_ID\.trim\(\) === ''[\s\S]{0,200}fail\(/.test(src))
    check(`🔴 ${label} 러너가 회차 id 를 지어내지 않는다`,
      !/runId: `(judge|draft)-\$\{/.test(src))
    check(`🔴 ${label} 러너가 공급이 준 회차 id 를 그대로 쓴다`,
      /new SupplyLlmSession\(\{ runId: RUN_ID/.test(src))
  }
  /**
   * 🔴 **문자열이 아니라 계획을 본다.** 정본 함수를 불러 실제 인자를 확인한다 —
   *    정규식은 표현이 바뀌면 조용히 눈이 멀고, 그때 상한이 단계마다 갈라진다.
   */
  {
    const pend = planPending([
      '82cook-adapt-20260911-010000.detail.jsonl',
      '82cook-adapt-20260911-010000.raw-detail.jsonl',
    ])
    const stages = planCommonPhase(pend, judgeBuffer(120), {
      kind: 'ready', snapshotPath: '/tmp/s.json', runId: 'RUN-XYZ',
    })
    const judge = stages.find((x) => x.stage === 'judge')
    const draft = stages.find((x) => x.stage === 'draft')
    check('🔴 공급이 판정에 회차 id 를 넘긴다',
      judge !== undefined && judge.args.includes('--run-id=RUN-XYZ'))
    check('🔴 판정과 생성이 **같은** 회차 id 를 받는다 — 상한이 단계마다 갈라지지 않는다',
      judge !== undefined && draft !== undefined
      && judge.args.filter((a) => a.startsWith('--run-id=')).join()
        === draft.args.filter((a) => a.startsWith('--run-id=')).join())
    const held = planCommonPhase(pend, judgeBuffer(120), {
      kind: 'hold', reason: '큐를 못 읽었다', runId: 'RUN-XYZ',
    })
    check('🔴 생성을 보류해도 판정은 회차 id 를 받는다 — 보류가 상한을 풀지 않는다',
      held.find((x) => x.stage === 'judge')?.args.includes('--run-id=RUN-XYZ') === true
      && held.every((x) => x.stage !== 'draft'))
  }
  check('🔴 세션이 메모리 카운터로 상한을 판정하지 않는다',
    (() => {
      const w = readFileSync('scripts/lib/supply-llm-call.mts', 'utf-8')
      return /runPaid: runRead\.ok \? runPaidCountOf\(/.test(w) && !/runPaid: this\.t\.paid/.test(w)
    })())
  check('🔴 회차 사용량도 **잠금 안에서** 읽는다',
    (() => {
      const w = readFileSync('scripts/lib/supply-llm-call.mts', 'utf-8')
      const lockAt = w.indexOf('verdict = this.io.withLock')
      const judgeAt = w.indexOf('judgeSpend({', lockAt)
      const runAt = w.indexOf('this.io.readRun(', lockAt)
      return lockAt !== -1 && runAt > lockAt && runAt < judgeAt
    })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥-c 정산 기록 실패 — 🔴 예약을 보존하고 그 뒤를 멈춘다')
// ─────────────────────────────────────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'ledger-hold-'))
  check('🔴 표식이 없으면 보류가 아니다', readSettleHold(dir) === null)
  writeSettleHold(dir, {
    runId: 'R1', attemptId: 'a1', date: '2026-09-17',
    reservedUsd: 0.01, at: new Date().toISOString(), reason: '시험',
  })
  check('🔴 표식이 있으면 사유를 돌려준다', (readSettleHold(dir) ?? '').includes('정산을 장부에 적지 못한'))
  check('🔴 사유가 **푸는 방법**을 알려 준다 — 사람이 지워야 풀린다',
    (readSettleHold(dir) ?? '').includes(settleHoldPathOf(dir)))
  writeSettleHold(dir, {
    runId: 'R2', attemptId: 'b', date: '2026-09-18',
    reservedUsd: 1, at: new Date().toISOString(), reason: '나중 것',
  })
  check('🔴 이미 있는 표식을 덮지 않는다 — 첫 실패가 원인에 가깝다',
    (readSettleHold(dir) ?? '').includes('R1'))
  writeFileSync(settleHoldPathOf(dir), '{ 깨진', 'utf-8')
  check('🔴 표식을 읽지 못해도 **보류로 본다** — 모르면 멈춘다',
    (readSettleHold(dir) ?? '').includes('사람이 확인한다'))
  rmSync(settleHoldPathOf(dir), { force: true })
  check('🔴 사람이 지우면 풀린다', readSettleHold(dir) === null)

  const base = { tally: tallyOf([]), runPaid: 0, reserve: KNOWN, ledgerOk: true }
  check('🔴 보류가 걸려 있으면 유료 요청을 보내지 않는다',
    (() => {
      const v = judgeSpend({ ...base, limits: LIMITS(), settleHold: '정산 실패' })
      return !v.ok && v.code === 'SETTLE_ERROR'
    })())
  check('🔴 보류는 예산·상한보다 **먼저** 본다 — 여력이 남아도 멈춘다',
    (() => {
      const v = judgeSpend({
        ...base, limits: LIMITS({ dailyUsd: 999999 }), settleHold: '정산 실패',
      })
      return !v.ok && v.code === 'SETTLE_ERROR'
    })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 예산 env — 🔴 기본값이 없다')
// ─────────────────────────────────────────────────────────
{
  check('🔴 비어 있으면 전부 null 이다 — 그러면 유료 요청이 보류된다',
    (() => {
      const l = limitsFromEnv({})
      return l.dailyUsd === null && l.runRequestCap === null && l.headroomMultiplier === null
    })())
  check('🔴 읽을 수 없는 값을 0 으로 읽지 않는다',
    limitsFromEnv({ [BUDGET_ENV.dailyUsd]: '아무거나' }).dailyUsd === null)
  check('🔴 0 이하를 예산으로 받지 않는다',
    limitsFromEnv({ [BUDGET_ENV.dailyUsd]: '0' }).dailyUsd === null
    && limitsFromEnv({ [BUDGET_ENV.dailyUsd]: '-1' }).dailyUsd === null)
  check('🟢 숫자는 그대로 읽는다', limitsFromEnv({ [BUDGET_ENV.dailyUsd]: '2.5' }).dailyUsd === 2.5)
  // 🔴 이 저장소 어디에도 운영 예산 금액이 적혀 있지 않다
  const wrapper = readFileSync('scripts/lib/supply-llm-call.mts', 'utf-8')
  check('🔴 코드에 예산 금액을 심지 않았다 — env 이름만 있다',
    !new RegExp(`${BUDGET_ENV.dailyUsd}[^\\n]*\\?\\?`).test(wrapper)
    && /기본값이 없다/.test(wrapper))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 우회 금지 — 🔴 유료 요청이 지나는 문은 하나다')
// ─────────────────────────────────────────────────────────
{
  const provider = readFileSync('scripts/lib/voice-m3-provider.mts', 'utf-8')
  for (const [label, file] of [
    ['판정', 'scripts/micro-seed-auto-judge.mts'],
    ['생성', 'scripts/micro-seed-auto-draft.mts'],
  ] as const) {
    const src = readFileSync(file, 'utf-8')
    check(`🔴 ${label} 러너가 callProvider 를 직접 부르지 않는다`,
      !/(await|return|=)\s+callProvider\s*\(/.test(src))
    check(`🔴 ${label} 러너가 장부 세션을 쓴다`, /new SupplyLlmSession\(/.test(src))
    check(`🔴 ${label} 러너가 직접 fetch 하지 않는다`, !/\bfetch\(/.test(src))
    check(`🔴 ${label} 러너는 장부가 없으면 보내지 않는다`,
      /LEDGER === null/.test(src) && /NO_LEDGER/.test(src))
    // 🔴 장부를 부르는 자리는 **정확히 하나**여야 한다 — 두 곳이면 하나가 조용히 달라진다
    check(`${label} 러너가 장부를 부르는 자리는 한 곳뿐이다`,
      (src.match(/LEDGER\.call\(/g) ?? []).length === 1)
    check(`${label} 러너의 provider 요청이 전부 ask() 를 지난다`,
      (src.match(/await ask\(/g) ?? []).length >= 2)
  }
  const draft = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
  check('🔴 나이 검수도 회차 상한을 지난다 — 여기가 새던 자리다',
    /ageCalls \+= 1[\s\S]{0,700}BUDGET\.take\(\)[\s\S]{0,400}await ask\(\s*'ageCheck'/.test(draft))
  check('🔴 나이 검수를 종류별 집계에도 넣는다 — 관제가 못 보던 자리다',
    /countCall\('ageCheck'\)/.test(draft))

  // 🔴 사전 계산이 실제 요청과 **같은 것**을 센다 — 말이 아니라 조립부를 본다
  const countAt = provider.indexOf('export async function countInputTokens')
  const countBlock = stripComments(provider.slice(countAt))
  // 🔴 실제로 보내는 객체만 본다 — 주석의 낱말을 근거로 삼지 않는다
  const countBody = countBlock.slice(
    countBlock.indexOf('body: JSON.stringify({'), countBlock.indexOf('signal: controller.signal'))
  const bodyAt = provider.indexOf('const body = isAnthropic')
  const paidBlock = provider.slice(bodyAt, provider.indexOf('const res = await fetch', bodyAt))
  for (const [label, needle] of [
    ['모델', 'apiModelIdFor(req.model)'],
    ['system', 'system: req.systemPrompt'],
    ['user 메시지', "{ role: 'user', content: req.userPayload }"],
    ['prefill', "{ role: 'assistant', content: ANTHROPIC_JSON_PREFILL }"],
  ] as const) {
    check(`🔴 사전 계산이 유료 요청과 같은 ${label} 을 쓴다`,
      countBody.includes(needle) && (paidBlock.includes(needle) || provider.includes(`const apiModelId = ${needle}`)))
  }
  check('🔴 사전 계산에는 max_tokens 를 보내지 않는다', !/max_tokens/.test(countBody))
  check('🔴 사전 계산 경로가 Anthropic 밖이면 모른다고 끝낸다 — 추측하지 않는다',
    /COUNT_UNSUPPORTED/.test(countBlock))
  check('🔴 사전 계산 응답 모양이 다르면 추측하지 않는다', /COUNT_SHAPE/.test(countBlock))
  check('🔴 사전 계산이 무료임을 코드에 적었다 — 유료 요청 수와 섞지 않는다',
    /free to use/.test(provider) && /따로 센다/.test(provider))

  // 🔴 provider 가 "진짜 0" 과 "모름" 을 가른다
  check('🔴 실패 응답은 사용량을 **모름**으로 표시한다',
    /usageKnown: false, cacheWriteTokens: null, cacheReadTokens: null, usageKeys: \[\]/.test(provider))
  check('🔴 사용량을 읽었는지 키 존재로 판정한다 — num() 의 0 에 기대지 않는다',
    /const usageKnown =/.test(provider) && /isNum\(usage\.input_tokens\)/.test(provider))
  check('🔴 응답의 usage 키 이름을 남긴다 — 안 읽는 과금 항목이 생기면 드러난다',
    /const usageKeys = Object\.keys\(usageObj\)/.test(provider))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑨ 행동 — 🔴 가짜 provider 로 실제 요청 수를 센다 (네트워크 0)')
//
//   🔴 **말이 아니라 나간 요청을 센다.** `fetch` 를 가로채(`--import`)
//      사전 계산(`/count_tokens`)과 유료 생성(`/messages`)을 갈라 기록한다.
//   🔴 **임시 HOME · 임시 예산.** 운영 자산·운영 env·운영 장부를 건드리지 않는다.
// ─────────────────────────────────────────────────────────
{
  const root = mkdtempSync(join(tmpdir(), 'ledger-fp-'))
  const dd = join(root, DATA_DIR_NAME)
  mkdirSync(dd, { recursive: true })
  symlinkSync(join(process.cwd(), 'docs'), join(root, 'docs'))
  const fakeHome = join(root, 'home')
  mkdirSync(fakeHome, { recursive: true })
  writeFakePersonaAsset({ home: fakeHome })
  const ledgerDir = join(fakeHome, 'Library', 'Application Support', 'soransoran', 'llm-ledger')

  const OUR = `${MACHINE_SITE_PREFIX}navercafe:remonterrace`
  const seed = (id: string): string => JSON.stringify({
    sourceArticleId: id, decision: 'AUTO_SEED', semanticRisks: [],
    ruleVersion: 'auto-judge-v3', promptVersion: 'p', model: 'm', inputHash: 'h',
    provenance: 'machine-shadow',
  })
  const meta = (id: string, t: string): string => JSON.stringify({
    sourceArticleId: id, sourceSite: 'navercafe:remonterrace', title: t,
    bodyHead: '원문 머리 300자 안쪽', axis: 'sourceCandidate', lane: 'originalRaw',
  })
  writeFileSync(join(dd, 'x.shadow.jsonl'), `${seed('B1')}\n${seed('B9')}\n`, 'utf-8')
  writeFileSync(join(dd, 'x.detail.jsonl'), `${meta('B1', '제목 하나')}\n${meta('B9', '제목 아홉')}\n`, 'utf-8')
  const snapPath = join(dd, 'supply-queue-snapshot-R1.json')
  writeFileSync(snapPath, JSON.stringify(buildQueueSnapshot({ runId: 'R1', takenAt: new Date(), rows: [] })), 'utf-8')
  const logPath = join(root, 'calls.log')

  type Run = {
    code: number | null; out: string
    /** 🔴 유료 생성 요청 수 */ paid: number
    /** 🔴 무료 사전 계산 요청 수 — 유료와 섞지 않는다 */ counted: number
    entries: LedgerEntry[]
  }
  /** 🔴 장부를 지운다 — 회차마다 새 하루로 본다 */
  const wipeLedger = (): void => {
    if (!existsSync(ledgerDir)) return
    for (const f of readdirSync(ledgerDir)) writeFileSync(join(ledgerDir, f), '', 'utf-8')
  }
  const ledgerEntries = (): LedgerEntry[] => {
    if (!existsSync(ledgerDir)) return []
    const out: LedgerEntry[] = []
    for (const f of readdirSync(ledgerDir).filter((x) => x.endsWith('.jsonl'))) {
      const r = readLedgerDay(join(ledgerDir, f))
      if (r.ok) out.push(...r.entries)
    }
    return out
  }
  const run = (budget: Record<string, string>, opts: { wipe?: boolean } = {}): Run => {
    writeFileSync(logPath, '', 'utf-8')
    writeFileSync(join(dd, 'auto-draft-cache.json'), '{}', 'utf-8')
    if (opts.wipe !== false) wipeLedger()
    const r = spawnSync(
      join(process.cwd(), 'node_modules/.bin/tsx'),
      [
        join(process.cwd(), 'scripts/micro-seed-auto-draft.mts'),
        '--call', '--apply', `--queue-snapshot=${snapPath}`, '--run-id=R1', '--require-queue-snapshot',
      ],
      {
        cwd: root, encoding: 'utf-8',
        env: {
          ...process.env,
          // 🔴 임시 HOME — 합성 말투 자산과 **임시 장부**가 여기 있다
          HOME: fakeHome,
          ANTHROPIC_API_KEY: 'fixture-fake-key',
          FAKE_PROVIDER_LOG: logPath,
          NODE_OPTIONS: `--import=${join(process.cwd(), 'scripts/lib/fake-provider-hook.mjs')}`,
          // 🔴 **시험 값이다. 운영 예산이 아니다** — 임시 환경에만 들어간다
          ...budget,
        },
      },
    )
    const log = readFileSync(logPath, 'utf-8').split('\n').filter((l) => l.trim() !== '')
    return {
      code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`,
      paid: log.filter((l) => l.startsWith('paid\t')).length,
      counted: log.filter((l) => l.startsWith('count\t')).length,
      entries: ledgerEntries(),
    }
  }
  // 🔴 시험용 임시 값이다. 운영 예산이 아니다
  const CAP = { [BUDGET_ENV.runRequestCap]: '10000' }
  const OPEN = { [BUDGET_ENV.dailyUsd]: '1000', [BUDGET_ENV.headroomMultiplier]: '1.5', ...CAP }

  // ⓐ 🔴 **충분한 여력 — 계산 → 예약 → 생성 → 정산이 끝까지 돈다**
  const ok = run(OPEN)
  check('🔴 [L] 여력이 있으면 유료 요청이 실제로 나간다', ok.paid > 0 && ok.code === 0)
  check('🔴 [L] 유료 요청마다 **사전 계산이 먼저** 나간다', ok.counted >= ok.paid)
  check('🔴 [L] 장부에 유료 요청이 정산까지 기록된다',
    ok.entries.filter((e) => e.stage !== 'countTokens' && e.status === 'settled').length === ok.paid)
  check('🔴 [L] 정산액이 0 보다 크다 — 모름을 0원으로 적지 않았다',
    ok.entries.filter((e) => e.stage !== 'countTokens').every((e) => (e.settledUsd ?? 0) > 0))
  check('🔴 [L] 사전 계산은 **따로** 기록된다 (무료)',
    ok.entries.filter((e) => e.stage === 'countTokens').length === ok.counted)
  check('🔴 [L] 예약과 정산이 **같은 요청 id** 로 묶인다',
    ok.entries.filter((e) => e.stage !== 'countTokens')
      .every((e) => e.reservedUsd !== null && e.countedInputTokens !== null))
  check('🔴 [L] 장부가 제공사 모델 id 를 남긴다 — 청구서와 대조할 수 있다',
    ok.entries.every((e) => e.apiModelId.startsWith('claude-haiku-4-5')))
  check('🔴 [L] 장부에 원문·프롬프트·응답이 없다',
    !/(sourceBodyHead|가짜 초안|fixture 가 만든 본문|fixture-fake-key)/
      .test(readdirSync(ledgerDir).map((f) => readFileSync(join(ledgerDir, f), 'utf-8')).join('')))
  check('🔴 [L] 재시도·나이 검수도 장부에 자기 단계로 남는다',
    ok.entries.some((e) => e.stage === 'ageCheck') && ok.entries.some((e) => e.stage === 'draftGen'))
  check('🔴 [L] 화면에 장부를 찍는다 — 안 보이면 늘어도 모른다', /장부 .*· 유료 \d+건/.test(ok.out))
  check('🔴 [L] 하루치가 한 파일에 모인다 — 정산이 다른 날로 새지 않는다',
    readdirSync(ledgerDir).filter((f) => f.endsWith('.jsonl')).length === 1)

  // ⓑ 🔴 **예산 미설정 — 유료 요청 0.** 사전 계산(무료)은 나갈 수 있다
  const noBudget = run({ [BUDGET_ENV.headroomMultiplier]: '1.5', ...CAP })
  check('🔴 [L] 예산 금액이 없으면 **유료 요청 0회**', noBudget.paid === 0)
  check('🔴 [L] 그때도 사유가 장부에 남는다 — 조용히 넘어가지 않는다',
    noBudget.entries.some((e) => e.status === 'blocked' && e.blockCode === 'NO_BUDGET'))
  check('🔴 [L] 화면이 예산 미설정을 말한다', /예산 🔴 미설정/.test(noBudget.out))

  // ⓒ 여유 배수 미설정
  const noHead = run({ [BUDGET_ENV.dailyUsd]: '1000', ...CAP })
  check('🔴 [L] 여유 배수가 없으면 **유료 요청 0회**', noHead.paid === 0)

  // ⓓ 🔴 **여력 부족 — 생성 fetch 가 0 이다**
  const tiny = run({ [BUDGET_ENV.dailyUsd]: '0.0000001', [BUDGET_ENV.headroomMultiplier]: '1.5', ...CAP })
  check('🔴 [L] 여력이 모자라면 **유료 요청 0회** — 생성 fetch 가 나가지 않는다', tiny.paid === 0)
  check('🔴 [L] 여력 부족 사유를 장부에 남긴다',
    tiny.entries.some((e) => e.blockCode === 'DAILY_EXHAUSTED'))
  check('🔴 [L] 보류해도 회차는 끝난다 — 멈춰 서지 않는다', tiny.code === 0)

  // ⓔ-0 🔴 상한 미설정 — 보류한다
  const noCap = run({ [BUDGET_ENV.dailyUsd]: '1000', [BUDGET_ENV.headroomMultiplier]: '1.5' })
  check('🔴 [L] 회차 요청 상한이 없으면 **유료 요청 0회** — 미설정이 무제한이 아니다',
    noCap.paid === 0 && noCap.entries.some((e) => e.blockCode === 'NO_BUDGET'))

  // ⓔ 회차 요청 상한
  const capped = run({ ...OPEN, [BUDGET_ENV.runRequestCap]: '2' })
  check('🔴 [L] 회차 요청 상한을 넘지 않는다', capped.paid <= 2 && capped.paid > 0)
  check('🔴 [L] 상한에 닿은 뒤의 요청은 보류로 남는다',
    capped.entries.some((e) => e.blockCode === 'RUN_CAP'))

  // ⓕ 🔴 사전 계산을 못 받으면 유료 요청을 보내지 않는다
  const countFail = run(OPEN)
  const countFailRun = ((): Run => {
    process.env.FAKE_PROVIDER_MODE = 'count-fail'
    const r = run(OPEN)
    delete process.env.FAKE_PROVIDER_MODE
    return r
  })()
  check('🔴 [L] 사전 계산이 실패하면 **유료 요청 0회** — 모르는 채로 보내지 않는다',
    countFailRun.paid === 0 && countFail.paid > 0)
  check('🔴 [L] 사전 계산 실패도 장부에 남는다',
    countFailRun.entries.some((e) => e.blockCode === 'NO_COUNT'))

  // ⓖ 🔴 타임아웃 — 요청은 나갔다. 예약을 풀지 않는다
  const timeoutRun = ((): Run => {
    process.env.FAKE_PROVIDER_MODE = 'timeout'
    const r = run(OPEN)
    delete process.env.FAKE_PROVIDER_MODE
    return r
  })()
  check('🔴 [L] 타임아웃이어도 요청은 나갔다 — 장부에 남는다', timeoutRun.paid > 0)
  check('🔴 [L] 타임아웃 건은 **미정산**이다 — 예약이 그대로 여력을 먹는다',
    timeoutRun.entries.filter((e) => e.stage !== 'countTokens')
      .every((e) => e.status === 'usageUnknown' || e.status === 'blocked'))
  check('🔴 [L] 미정산 건의 정산액은 null 이다 — 0원으로 적지 않는다',
    timeoutRun.entries.filter((e) => e.status === 'usageUnknown').every((e) => e.settledUsd === null))

  // ⓗ 🔴 사용량 누락 — 응답은 왔는데 usage 가 없다
  const noUsage = ((): Run => {
    process.env.FAKE_PROVIDER_MODE = 'no-usage'
    const r = run(OPEN)
    delete process.env.FAKE_PROVIDER_MODE
    return r
  })()
  check('🔴 [L] 사용량이 없으면 **미정산**이다 — 0원으로 정산하지 않는다',
    noUsage.paid > 0
    && noUsage.entries.some((e) => e.status === 'usageUnknown' && e.settledUsd === null))
  check('🔴 [L] 미정산이 쌓이면 여력이 줄어 결국 보류된다 — 모름이 예산을 다시 열지 않는다',
    (() => {
      process.env.FAKE_PROVIDER_MODE = 'no-usage'
      const r = run({ [BUDGET_ENV.dailyUsd]: '0.007', [BUDGET_ENV.headroomMultiplier]: '1.5', ...CAP })
      delete process.env.FAKE_PROVIDER_MODE
      return r.entries.some((e) => e.blockCode === 'DAILY_EXHAUSTED')
    })())

  // ⓘ 🔴 실제가 예약을 넘으면 실제 금액을 적고, 그 뒤 유료 요청을 멈춘다
  const over = ((): Run => {
    process.env.FAKE_PROVIDER_MODE = 'over-reserve'
    const r = run(OPEN)
    delete process.env.FAKE_PROVIDER_MODE
    return r
  })()
  const overEntries = over.entries.filter((e) => e.status === 'settled' && e.stage !== 'countTokens')
  check('🔴 [L] 실제 사용량이 예약보다 크면 **실제 금액**을 적는다',
    overEntries.some((e) => (e.settledUsd ?? 0) > (e.reservedUsd ?? 0)))
  check('🔴 [L] 불일치 뒤의 요청은 보류된다 — 사람이 확인할 때까지 멈춘다',
    over.entries.some((e) => e.blockCode === 'UNSETTLED_OVERRUN'))
  check('🔴 [L] 그래서 불일치가 난 회차는 유료 요청이 더 적다', over.paid < ok.paid)

  // ⓙ 🔴 재시작 — 이전 회차의 장부를 이어 읽는다
  wipeLedger()
  /**
   * 🔴 **하루 예산을 몇 건 만에 소진하도록 좁혀 둔다.**
   *    넉넉한 예산에서는 두 회차가 똑같이 돌아 "이어졌는가" 를 가릴 수 없다 —
   *    첫 회차가 실제로 소진해야 둘째 회차가 그 사실을 보고 멈춘다.
   */
  const RESTART = { [BUDGET_ENV.dailyUsd]: '0.0065', [BUDGET_ENV.headroomMultiplier]: '1.5', ...CAP }
  const first = run(RESTART, { wipe: false })
  const spentAfterFirst = first.entries.filter((e) => e.stage !== 'countTokens')
    .reduce((n, e) => n + (e.settledUsd ?? 0), 0)
  const second = run(RESTART, { wipe: false })
  const spentAfterSecond = second.entries.filter((e) => e.stage !== 'countTokens')
    .reduce((n, e) => n + (e.settledUsd ?? 0), 0)
  check('🔴 [L] 재시작해도 앞 회차의 장부가 남아 있다',
    first.paid > 0 && second.entries.length > first.entries.length)
  check('🔴 [L] 하루 누적 정산액이 회차를 넘어 이어진다',
    spentAfterSecond >= spentAfterFirst && spentAfterFirst > 0)
  check('🔴 [L] 앞 회차가 소진한 만큼 뒤 회차가 막힌다 — 재시작이 예산을 되돌리지 않는다',
    second.paid < first.paid && second.entries.some((e) => e.blockCode === 'DAILY_EXHAUSTED'))

  // ⓚ 🔴 동시성 — 두 회차가 같은 장부를 동시에 본다
  {
    wipeLedger()
    // 🔴 별도 시험용 스크립트를 만들지 않는다. **운영이 쓰는 러너 둘**을 그대로 동시에 띄운다 —
    //    사본을 시험하면 사본만 올바른 상태가 된다
    const args = [
      join(process.cwd(), 'scripts/micro-seed-auto-draft.mts'),
      '--call', '--apply', `--queue-snapshot=${snapPath}`, '--run-id=R1', '--require-queue-snapshot',
    ]
    const env = {
      ...process.env, HOME: fakeHome, ANTHROPIC_API_KEY: 'fixture-fake-key',
      FAKE_PROVIDER_LOG: '',
      NODE_OPTIONS: `--import=${join(process.cwd(), 'scripts/lib/fake-provider-hook.mjs')}`,
      [BUDGET_ENV.dailyUsd]: '0.02', [BUDGET_ENV.headroomMultiplier]: '1.5', ...CAP,
    }
    writeFileSync(join(dd, 'auto-draft-cache.json'), '{}', 'utf-8')
    const both = [0, 1].map(() => spawnSync(join(process.cwd(), 'node_modules/.bin/tsx'), args, {
      cwd: root, encoding: 'utf-8', env,
    }))
    const after = ledgerEntries()
    const spent = after.filter((e) => e.stage !== 'countTokens')
      .reduce((n, e) => n + (e.settledUsd ?? e.reservedUsd ?? 0), 0)
    check('🔴 [L] 두 회차를 함께 돌려도 장부가 깨지지 않는다',
      both.every((r) => r.status === 0) && after.length > 0)
    check('🔴 [L] 두 회차의 예약·정산 합이 하루 예산을 넘지 않는다', spent <= 0.02 + 1e-9)
    check('🔴 [L] 잠금이 남지 않는다', !existsSync(lockPathOf(ledgerDir)))
  }

  // ⓛ 🔴 정산을 못 적어도 예약은 남는다 — 그 방향이 안전하다
  {
    const src = readFileSync('scripts/lib/supply-llm-call.mts', 'utf-8')
    check('🔴 [L] 정산 기록에 실패하면 예약을 풀지 않고 미정산으로 센다',
      /catch \(e\) \{[\s\S]{0,1400}this\.t\.usageUnknown \+= 1[\s\S]{0,400}this\.settleFailed =/.test(src))
    check('🔴 [L] 정산 실패는 **파일 표식**으로 남는다 — 재시작이 우회가 되지 않는다',
      /this\.io\.writeHold\(this\.dir/.test(src))
    check('🔴 [L] 표식조차 못 쓴 경우를 숨기지 않고 센다', /holdWriteFailed \+= 1/.test(src))
    check('🔴 [L] 장부에 못 적으면 요청을 보내지 않는다',
      /catch \(e\)[\s\S]{0,400}return blockedResponse\('LEDGER_ERROR'/.test(src))
    check('🔴 [L] 날짜를 요청 시작 시각으로 한 번만 정한다 — 정산이 다른 날로 가지 않는다',
      (src.match(/ledgerDateOf\(/g) ?? []).length === 1 && /const date = ledgerDateOf\(startedAt\)/.test(src))
    check('🔴 [L] 읽기·판정·예약 기록을 한 잠금 안에서 한다',
      /this\.io\.withLock\(this\.dir, \(\) => \{[\s\S]{0,900}this\.io\.readDay\(path\)[\s\S]{0,1200}judgeSpend\(\{[\s\S]{0,900}this\.write\(path/.test(src))
    check('🔴 [L] 기본 장부 입출력이 **진짜 저장소**다 — 주입은 시험 전용이다',
      REAL_LEDGER_IO.append === appendLedgerLine
      && REAL_LEDGER_IO.withLock === withLedgerLock
      && REAL_LEDGER_IO.readHold === readSettleHold
      && /this\.io = cfg\.io \?\? REAL_LEDGER_IO/.test(src))
    check('🔴 [L] 보류 응답이 provider 실패와 구분된다',
      LEDGER_BLOCKED === 'LEDGER_BLOCKED' && /\$\{LEDGER_BLOCKED\}:\$\{(code|v\.code)\}/.test(src))
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n⑩ 정산 실패 뒤 — 🔴 실제로 fetch 가 0 인지 센다')
//
//   🔴 디스크를 골라서 망가뜨릴 방법이 없어 **장부 입출력을 주입**한다.
//      provider 쪽은 그대로다 — `fetch` 를 가짜로 바꿔 실제 요청 수를 센다.
// ─────────────────────────────────────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'ledger-settlefail-'))
  const realFetch = globalThis.fetch
  let fetched = { count: 0, paid: 0 }
  // 🔴 이 fixture 안에서만 바꾼다. 네트워크에 나가지 않는다
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = String(url)
    if (u.includes('/count_tokens')) {
      fetched.count += 1
      return new Response(JSON.stringify({ input_tokens: 100 }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }
    fetched.paid += 1
    return new Response(JSON.stringify({
      content: [{ text: '"ok":true}' }],
      usage: { input_tokens: 11, output_tokens: 22 },
      stop_reason: 'end_turn',
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof globalThis.fetch
  const prevKey = process.env.ANTHROPIC_API_KEY
  process.env.ANTHROPIC_API_KEY = 'fixture-fake-key'

  /** 🔴 **정산 줄만** 못 쓰게 한다 — 사전 계산·예약은 정상으로 적힌다 */
  const failSettleIo = (opts: { holdFails?: boolean } = {}): LedgerIo => ({
    ...REAL_LEDGER_IO,
    append: (path, entry) => {
      if (entry.status === 'settled' && entry.stage !== 'countTokens') {
        throw new Error('fixture: 정산 줄을 쓰지 못했다')
      }
      if (entry.status === 'usageUnknown') throw new Error('fixture: 정산 줄을 쓰지 못했다')
      REAL_LEDGER_IO.append(path, entry)
    },
    writeHold: (d, h) => {
      if (opts.holdFails === true) throw new Error('fixture: 표식도 쓰지 못했다')
      REAL_LEDGER_IO.writeHold(d, h)
    },
  })

  const ASK = {
    stage: 'draftGen' as const, model: 'claude-haiku-4.5' as const,
    systemPrompt: 'sys', userPayload: '{}', maxOutputTokens: 1200, timeoutMs: 5_000,
  }
  const LIM = { dailyUsd: 1000, runRequestCap: 10_000, headroomMultiplier: 1.5 }

  const s1 = new SupplyLlmSession({ runId: 'RF', dir, limits: LIM, io: failSettleIo() })
  const r1 = await s1.call(ASK)
  const afterFirst = { ...fetched }
  check('🔴 [SF] 첫 요청은 실제로 나갔다', afterFirst.paid === 1 && r1.ok)
  check('🔴 [SF] 정산을 못 적어 보류를 걸었다', s1.tally.settleHeld === 1)
  check('🔴 [SF] 예약 줄은 남아 있다 — 미정산이 여력을 계속 먹는다',
    (() => {
      const r = readLedgerDay(ledgerPathOf(dir, ledgerDateOf(new Date())))
      return r.ok && r.entries.some((e) => e.stage === 'draftGen' && e.status === 'reserved')
    })())

  const r2 = await s1.call(ASK)
  check('🔴 [SF] 그 뒤 요청은 **생성 fetch 0** — 사전 계산도 하지 않는다',
    fetched.paid === afterFirst.paid && fetched.count === afterFirst.count)
  check('🔴 [SF] 보류 사유를 돌려준다', r2.errorCode === `${LEDGER_BLOCKED}:SETTLE_ERROR`)

  // 🔴 재시작으로 우회되지 않는다 — 새 세션이 표식을 읽는다
  const before = { ...fetched }
  const s2 = new SupplyLlmSession({ runId: 'RF2', dir, limits: LIM })
  const r3 = await s2.call(ASK)
  check('🔴 [SF] 🔴 재시작해도 막힌다 — 새 회차도 **생성 fetch 0**',
    fetched.paid === before.paid && r3.errorCode === `${LEDGER_BLOCKED}:SETTLE_ERROR`)
  check('🔴 [SF] 표식이 남아 있다', existsSync(settleHoldPathOf(dir)))

  // 🔴 사람이 지우면 풀린다 — 이것이 복구 조건이다
  rmSync(settleHoldPathOf(dir), { force: true })
  const s3 = new SupplyLlmSession({ runId: 'RF3', dir, limits: LIM })
  const r4 = await s3.call(ASK)
  check('🔴 [SF] 사람이 표식을 지우면 다시 돈다 — 복구 조건이 사람 손이다',
    r4.ok && fetched.paid === before.paid + 1)

  // 🔴 표식조차 못 쓴 경우 — 그 프로세스 안에서는 여전히 막는다
  {
    const d2 = mkdtempSync(join(tmpdir(), 'ledger-holdfail-'))
    const s4 = new SupplyLlmSession({ runId: 'RH', dir: d2, limits: LIM, io: failSettleIo({ holdFails: true }) })
    await s4.call(ASK)
    const mark = { ...fetched }
    const r5 = await s4.call(ASK)
    check('🔴 [SF] 표식을 못 써도 이 회차 안에서는 막는다 — 생성 fetch 0',
      fetched.paid === mark.paid && r5.errorCode === `${LEDGER_BLOCKED}:SETTLE_ERROR`)
    check('🔴 [SF] 표식을 못 썼다는 사실을 숨기지 않는다',
      s4.tally.holdWriteFailed === 1 && /표식조차 못 쓴 것/.test(s4.describe()))
    check('🔴 [SF] 🔴 그때는 다음 프로세스를 막지 못한다 — 이 한계를 적어 둔다',
      readSettleHold(d2) === null
      && /다음 프로세스는 이 보류를 못 본다/.test(readFileSync('scripts/lib/llm-ledger-store.mts', 'utf-8')))
  }

  globalThis.fetch = realFetch
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = prevKey
}

// ─────────────────────────────────────────────────────────
console.log('\n⑪ 회차 상한 공유 — 🔴 판정과 생성이 같은 상한을 나눠 쓴다')
//
//   🔴 **두 스크립트를 실제로 돌린다.** 상한이 단계마다 따로 걸리면
//      회차 전체로는 두 배가 나간다 — 그것을 요청 수로 확인한다.
// ─────────────────────────────────────────────────────────
{
  const root = mkdtempSync(join(tmpdir(), 'ledger-cap-'))
  const dd = join(root, DATA_DIR_NAME)
  mkdirSync(dd, { recursive: true })
  symlinkSync(join(process.cwd(), 'docs'), join(root, 'docs'))
  const fakeHome = join(root, 'home')
  mkdirSync(fakeHome, { recursive: true })
  writeFakePersonaAsset({ home: fakeHome })
  const ledgerDir = join(fakeHome, 'Library', 'Application Support', 'soransoran', 'llm-ledger')

  // 🔴 판정의 결정론 게이트를 통과하는 행 — 그래야 실제로 모델을 부른다
  const detail = [1, 2, 3].map((i) => JSON.stringify({
    sourceArticleId: `C${i}`, sourceSite: 'navercafe:remonterrace', title: `제목 ${i}`,
    bodyHead: '원문 머리 300자 안쪽', axis: 'seedOriginality', lane: 'originalRaw',
    access: 'ok', safetyVerdict: 'pass', safetyReasons: '', qualityFlags: [],
    commentCount: 3, bodyLength: 200,
  }))
  const shadow = [1, 2, 3].map((i) => JSON.stringify({
    sourceArticleId: `C${i}`, decision: 'AUTO_SEED', semanticRisks: [],
    ruleVersion: 'auto-judge-v3', promptVersion: 'p', model: 'm', inputHash: 'h',
    provenance: 'machine-shadow',
  }))
  writeFileSync(join(dd, 'x.detail.jsonl'), `${detail.join('\n')}\n`, 'utf-8')
  writeFileSync(join(dd, 'x.shadow.jsonl'), `${shadow.join('\n')}\n`, 'utf-8')
  // 🔴 큐 스냅샷은 회차에 묶인다 — 회차마다 새로 뜬다(정본 동작). 시험도 그대로 따른다
  const snapOf = (runId: string): string => {
    const p = join(dd, queueSnapshotFileName(runId))
    writeFileSync(p, JSON.stringify(buildQueueSnapshot({ runId, takenAt: new Date(), rows: [] })), 'utf-8')
    return p
  }
  const logPath = join(root, 'cap.log')
  writeFileSync(logPath, '', 'utf-8')

  const paidSoFar = (): number =>
    readFileSync(logPath, 'utf-8').split('\n').filter((l) => l.startsWith('paid\t')).length

  const stage = (script: string, argsOf: (runId: string) => readonly string[], cap: string, runId: string): number => {
    const args = argsOf(runId)
    // 🔴 판정 캐시를 비운다 — 캐시 hit 이 호출 수를 가려서는 안 된다
    for (const f of ['auto-judge-cache.json', 'auto-draft-cache.json']) {
      writeFileSync(join(dd, f), '{}', 'utf-8')
    }
    spawnSync(
      join(process.cwd(), 'node_modules/.bin/tsx'),
      [join(process.cwd(), script), ...args, `--run-id=${runId}`],
      {
        cwd: root, encoding: 'utf-8',
        env: {
          ...process.env, HOME: fakeHome, ANTHROPIC_API_KEY: 'fixture-fake-key',
          FAKE_PROVIDER_LOG: logPath,
          NODE_OPTIONS: `--import=${join(process.cwd(), 'scripts/lib/fake-provider-hook.mjs')}`,
          // 🔴 시험용 임시 값이다
          [BUDGET_ENV.dailyUsd]: '1000', [BUDGET_ENV.headroomMultiplier]: '1.5',
          [BUDGET_ENV.runRequestCap]: cap,
        },
      },
    )
    return paidSoFar()
  }
  const JUDGE = ['scripts/micro-seed-auto-judge.mts', () => ['--call', '--apply']] as const
  const DRAFT = [
    'scripts/micro-seed-auto-draft.mts',
    (runId: string) => ['--call', '--apply', `--queue-snapshot=${snapOf(runId)}`, '--require-queue-snapshot'],
  ] as const

  // ⓐ 🔴 판정 → 생성 합산이 상한을 넘지 않는다
  const afterJudge = stage(JUDGE[0], JUDGE[1], '3', 'RC')
  const afterDraft = stage(DRAFT[0], DRAFT[1], '3', 'RC')
  check('🔴 [RC] 판정이 실제로 요청을 보냈다', afterJudge > 0)
  check('🔴 [RC] 🔴 판정 + 생성 합계가 회차 상한을 넘지 않는다', afterDraft <= 3)
  check('🔴 [RC] 생성이 판정이 쓴 만큼을 빼고 본다 — 단계마다 따로 걸리지 않는다',
    afterDraft - afterJudge <= 3 - afterJudge)

  // ⓑ 🔴 같은 회차로 다시 띄워도 상한이 초기화되지 않는다
  const afterRestart = stage(DRAFT[0], DRAFT[1], '3', 'RC')
  check('🔴 [RC] 같은 회차를 다시 띄워도 상한이 되살아나지 않는다', afterRestart === afterDraft)
  check('🔴 [RC] 그때 사유가 장부에 남는다',
    (() => {
      const r = readLedgerRun(ledgerDir, ledgerDateOf(new Date()), 'RC')
      return r.ok && r.entries.some((e) => e.blockCode === 'RUN_CAP')
    })())

  // ⓒ 🔴 다른 회차 id 는 자기 상한을 새로 갖는다 — 회차 단위가 맞다
  const afterNewRun = stage(DRAFT[0], DRAFT[1], '3', 'RD')
  check('🔴 [RC] 새 회차는 자기 상한을 갖는다 — 회차 단위로 센다', afterNewRun > afterRestart)

  // ⓓ 🔴 회차 id 없이 부르면 유료 경로로 가지 않는다
  {
    writeFileSync(logPath, '', 'utf-8')
    const r = spawnSync(
      join(process.cwd(), 'node_modules/.bin/tsx'),
      [join(process.cwd(), DRAFT[0]), ...DRAFT[1]('RZ')],
      {
        cwd: root, encoding: 'utf-8',
        env: {
          ...process.env, HOME: fakeHome, ANTHROPIC_API_KEY: 'fixture-fake-key',
          FAKE_PROVIDER_LOG: logPath,
          NODE_OPTIONS: `--import=${join(process.cwd(), 'scripts/lib/fake-provider-hook.mjs')}`,
          [BUDGET_ENV.dailyUsd]: '1000', [BUDGET_ENV.headroomMultiplier]: '1.5',
          [BUDGET_ENV.runRequestCap]: '3',
        },
      },
    )
    check('🔴 [RC] 회차 id 없이 부르면 **유료 요청 0회** 로 멈춘다',
      paidSoFar() === 0 && r.status !== 0)
  }

  // ⓔ 🔴 정산 보류 표식이 있으면 **실제 러너**도 멈춘다 (재시작을 넘는다)
  {
    writeFileSync(logPath, '', 'utf-8')
    writeSettleHold(ledgerDir, {
      runId: 'RC', attemptId: 'x', date: ledgerDateOf(new Date()),
      reservedUsd: 0.01, at: new Date().toISOString(), reason: 'fixture 주입',
    })
    stage(DRAFT[0], DRAFT[1], '10000', 'RE')
    check('🔴 [RC] 🔴 정산 보류 표식이 있으면 새 회차도 **유료 요청 0회**', paidSoFar() === 0)
    rmSync(settleHoldPathOf(ledgerDir), { force: true })
    check('🔴 [RC] 사람이 표식을 지우면 다시 돈다', stage(DRAFT[0], DRAFT[1], '10000', 'RE2') > 0)
  }
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
if (fail > 0) process.exit(1)
