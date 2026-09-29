#!/usr/bin/env tsx
/**
 * 정기 공급 회차 몫 보호 검사 — 🔴 **네트워크 0 · 실제 provider 0 · 운영 env·장부 0 · DB 0**
 *
 * 🔴 **재현하는 사고 (2026-09-28 실측).** 손 실행 17번이 하루 예산을 먼저 썼고,
 *    정기 14:15 · 17:15 · 21:15 · 22:15 는 `DAILY_EXHAUSTED` 77건으로 초안 0건이었다.
 *
 * 🔴 **확인하는 것**
 *    ① 정기/손 실행 구별은 launchd 라벨 + 벽시계 창으로만 한다 — 인자·다른 env·다른 job 라벨로 못 바꾼다
 *    ② 손 실행은 아직 끝나지 않은 정기 슬롯 몫을 **남기고** 쓴다 · 정기 회차는 그 몫을 쓴다
 *    ③ 열린 예약(미정산)도 여력에서 빠진 채로 판정한다
 *    ④ 재시도도 같은 판정을 지난다
 *    ⑤ 마지막 슬롯 창이 끝나면 몫이 풀린다 · KST 자정에 새 날 몫이 다시 잡힌다
 *    ⑥ 공급 장부(기본 디렉터리)에서는 호출부가 보호를 끄거나 바꾸지 못한다
 *    ⑦ 장부를 못 읽으면 앞판처럼 `LEDGER_ERROR` 다 — 보호가 그것을 가리지 않는다
 *    ⑧ 손 실행이 env 로 하루 예산을 올려도 계약 천장을 넘지 못한다
 *
 * 🔴 **확인하지 못하는 것** — 실제 launchd 가 이 라벨을 넣는지는 이 검사가 띄운 프로세스로 증명하지 못한다.
 *    근거는 수집 기록(같은 `judgeTrigger` 규칙으로 `schedule` 522건)이고, 운영 적용 뒤 장부의
 *    `SCHEDULED_RESERVE`·정기 회차 유료 건수로 다시 본다.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  judgeSpend, tallyOf, type BudgetLimits, type DayTally, type LedgerEntry, type SpendProtect,
} from '../src/lib/llm-ledger'
import { reserveOf } from '../src/lib/llm-pricing'
import { LOCK_TTL_MS } from '../src/lib/supply-process'
import {
  SUPPLY_DAILY_USD_APPROVED, SUPPLY_RUNS_PER_DAY, SUPPLY_RUN_SLOTS_KST, SUPPLY_WORKSET_PER_RUN,
  estimateSupplySpend,
} from '../src/lib/supply-schedule-contract'
import {
  LAUNCHD_LABEL_ENV, SCHEDULED_RUN_WINDOW_MS, SUPPLY_PROCESS_LAUNCHD_LABEL,
  activeSlotAt, pendingSlotsAt, perRunReserveUsd, supplyRunKindOf, supplySpendProtectAt,
} from '../src/lib/supply-scheduled-reserve'
import {
  REAL_LEDGER_IO, SUPPLY_PROTECT_TEST_SEAM, SupplyLlmSession, supplyProtectFromEnv, type LedgerIo, type ProtectDecision,
} from './lib/supply-llm-call.mjs'
import { appendLedgerLine, defaultLedgerDir, ledgerPathOf } from './lib/llm-ledger-store.mjs'

let pass = 0
let fail = 0
const check = (n: string, ok: boolean, extra = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${n}`) }
  else { fail += 1; console.log(`  🔴 FAIL ${n}${extra === '' ? '' : `\n     ${extra}`}`) }
}

/** KST 시각 → Date. 🔴 시험이 읽기 쉽게 KST 로 적는다 */
const kst = (s: string): Date => new Date(`${s}+09:00`)
const LABEL = { [LAUNCHD_LABEL_ENV]: SUPPLY_PROCESS_LAUNCHD_LABEL }
const PER = perRunReserveUsd()

console.log('\n══ 정기 공급 회차 몫 보호 검사 (🔴 네트워크 0 · 실제 provider 0) ══\n')

// ─────────────────────────────────────────────────────────
console.log('① 몫의 크기 — 🔴 정본 상수에서 온다')
// ─────────────────────────────────────────────────────────
check('회차 몫 = 실측 평균 지출(estimateSupplySpend(묶음).expectedPerRun)',
  PER === estimateSupplySpend(SUPPLY_WORKSET_PER_RUN).expectedPerRun && PER > 0, `PER=${PER}`)
check('🔴 하루 전체 몫(6회분)이 계약 천장보다 작다 — 크면 손 실행은 아침에 한 건도 못 돈다',
  SUPPLY_DAILY_USD_APPROVED !== null && SUPPLY_RUNS_PER_DAY * PER < SUPPLY_DAILY_USD_APPROVED,
  `${SUPPLY_RUNS_PER_DAY}×${PER.toFixed(4)} vs ${SUPPLY_DAILY_USD_APPROVED}`)
check('슬롯 창 = 공급 러너 잠금 시효(LOCK_TTL_MS) — 정상 회차가 살아 있을 수 있는 가장 긴 시간',
  SCHEDULED_RUN_WINDOW_MS === LOCK_TTL_MS)
check('🔴 라벨이 공급 job 템플릿의 Label 과 같다',
  readFileSync('docs/operations/launchd/com.soransoran.supply-process.plist.template', 'utf-8')
    .includes(`<string>${SUPPLY_PROCESS_LAUNCHD_LABEL}</string>`))
{
  /**
   * 🔴 **라벨이 자식까지 가는 길** — launchd → stage-consume-exec → supply-process → 판정·초안.
   *    어느 한 곳이 env 를 새로 만들면(`env: { … }` 만) 자식은 라벨을 잃고 **손 실행**이 된다 —
   *    정기 회차가 자기 몫을 못 쓴다. 그 길을 코드로 본다.
   */
  const consume = readFileSync('scripts/stage-consume-exec.mts', 'utf-8')
  const proc = readFileSync('scripts/supply-process.mts', 'utf-8')
  check('🔴 stage-consume-exec 가 부모 env 를 그대로 물려준다', /env:\s*\{\s*\.\.\.process\.env/.test(consume))
  check('🔴 supply-process 가 판정·초안 자식에 부모 env 를 그대로 물려준다',
    /spawn\('npx', \['tsx', script, \.\.\.args\][\s\S]{0,200}env:\s*\{\s*\.\.\.process\.env/.test(proc))
  const tpl = readFileSync('docs/operations/launchd/com.soransoran.supply-process.plist.template', 'utf-8')
  check('🔴 템플릿이 라벨 env 를 손으로 넣지 않는다 — launchd 가 넣는 값만 믿는다',
    !tpl.includes(LAUNCHD_LABEL_ENV))
}

// ─────────────────────────────────────────────────────────
console.log('\n② 정기/손 실행 구별 — 🔴 라벨 + 벽시계 창')
// ─────────────────────────────────────────────────────────
check('🔴 표식이 없으면 손 실행이다(fail-closed)', supplyRunKindOf({}, kst('2026-09-28T08:20:00')).kind === 'manual')
check('🔴 다른 soransoran job 라벨은 정기 공급이 아니다',
  supplyRunKindOf({ [LAUNCHD_LABEL_ENV]: 'com.soransoran.persona-comment-runner' }, kst('2026-09-28T08:20:00')).kind === 'manual')
check('🔴 라벨 접두만 같은 값은 정기가 아니다',
  supplyRunKindOf({ [LAUNCHD_LABEL_ENV]: `${SUPPLY_PROCESS_LAUNCHD_LABEL}-manual` }, kst('2026-09-28T08:20:00')).kind === 'manual')
check('🔴 터미널 라벨(application.*)은 손 실행이다',
  supplyRunKindOf({ [LAUNCHD_LABEL_ENV]: 'application.com.apple.Terminal.1' }, kst('2026-09-28T08:20:00')).kind === 'manual')
check('🔴 호출자가 적을 수 있는 칸(SORAN_* · --trigger 모양)으로 정기가 되지 않는다',
  supplyRunKindOf({ SORAN_SUPPLY_RUN_KIND: 'scheduled', SORAN_TRIGGER: 'schedule', SORAN_RUN_AT: '2026-09-27T23:20:00.000Z' },
    kst('2026-09-28T08:20:00')).kind === 'manual')
check('공급 job 라벨 + 슬롯 창 안 → 정기', supplyRunKindOf(LABEL, kst('2026-09-28T08:20:00')).kind === 'scheduled')
check('공급 job 라벨 + 슬롯 시각 정각 → 정기', supplyRunKindOf(LABEL, kst('2026-09-28T14:15:00')).kind === 'scheduled')
check('🔴 공급 job 라벨이어도 창 밖(11:13 kickstart)은 손 실행이다',
  supplyRunKindOf(LABEL, kst('2026-09-28T11:13:00')).kind === 'manual')
check('🔴 창 끝(슬롯+45분) 정각은 창 밖이다',
  supplyRunKindOf(LABEL, kst('2026-09-28T09:00:00')).kind === 'manual'
  && supplyRunKindOf(LABEL, kst('2026-09-28T08:59:59')).kind === 'scheduled')
check('🔴 보호 판정은 SORAN_RUN_AT 을 시각으로 쓰지 않는다 — 손 실행이 08:20 을 적어 넣어도 11:13 이다',
  supplySpendProtectAt({ env: { ...LABEL, SORAN_RUN_AT: '2026-09-27T23:20:00.000Z' }, now: kst('2026-09-28T11:13:00') })
    .kind === 'manual')

// ─────────────────────────────────────────────────────────
console.log('\n③ 남은 슬롯 — 🔴 지금 도는 슬롯 포함 · 끝난 슬롯 제외 · KST 자정 경계')
// ─────────────────────────────────────────────────────────
const n = (s: string): number => pendingSlotsAt(kst(s)).length
check('07:00 — 6개', n('2026-09-28T07:00:00') === 6)
check('🔴 08:20(08:15 회차가 도는 중) — 6개. 도는 회차의 몫도 지킨다', n('2026-09-28T08:20:00') === 6)
check('11:13 — 5개 (08:15 창 끝남)', n('2026-09-28T11:13:00') === 5)
check('14:57 — 4개 (14:15 창 안)', n('2026-09-28T14:57:00') === 4)
check('17:33 — 3개', n('2026-09-28T17:33:00') === 3)
check('🔴 22:59:59 — 1개 (마지막 회차 창 안)', n('2026-09-28T22:59:59') === 1)
check('🔴 23:00 — 0개. 마지막 슬롯 창이 끝나면 몫이 풀린다', n('2026-09-28T23:00:00') === 0)
check('23:59:59 — 0개', n('2026-09-28T23:59:59') === 0)
check('🔴 00:00(다음 날) — 6개. 새 날의 몫이 다시 잡힌다',
  n('2026-09-29T00:00:00') === 6 && pendingSlotsAt(kst('2026-09-29T00:00:00')).every((w) => w.label.startsWith('2026-09-29')))
check('🔴 UTC 자정(09:00 KST)에 날이 바뀌지 않는다 — 08:59 와 09:01 이 같은 날 슬롯이다',
  pendingSlotsAt(kst('2026-09-28T08:59:00')).slice(-1)[0]?.label === '2026-09-28 22:15'
  && pendingSlotsAt(kst('2026-09-28T09:01:00')).slice(-1)[0]?.label === '2026-09-28 22:15')
{
  // 🔴 자정을 넘는 슬롯(가상의 23:50) — 그 창은 다음 날 장부에 들어간다
  const late = [{ hour: 23, minute: 50 }] as const
  const at = kst('2026-09-29T00:10:00')
  const p = pendingSlotsAt(at, late)
  check('🔴 자정을 넘는 창은 다음 날에도 몫으로 남는다(어제 23:50 슬롯 + 오늘 23:50 슬롯)',
    p.length === 2 && p[0]?.label === '2026-09-28 23:50', p.map((x) => x.label).join(','))
  check('🔴 자정을 넘는 창 안의 정기 회차는 정기다', activeSlotAt(at, late)?.label === '2026-09-28 23:50')
}
check('슬롯 정본이 6개다', SUPPLY_RUN_SLOTS_KST.length === 6)

// ─────────────────────────────────────────────────────────
console.log('\n④ 판정 — 🔴 손 실행은 몫을 남기고, 정기 회차는 몫을 쓴다')
// ─────────────────────────────────────────────────────────
const LIM: BudgetLimits = { dailyUsd: 0.5, runRequestCap: 1000, headroomMultiplier: 1.2 }
const T0: DayTally = tallyOf([])
const tally = (settled: number, open = 0): DayTally => ({ ...T0, settledUsd: settled, openReservedUsd: open })
const R = (usd: number) => ({ known: true as const, usd, pricingVersion: 'test' })
const judge = (o: { t?: DayTally; usd: number; p?: SpendProtect | null; lim?: BudgetLimits; ok?: boolean }) => judgeSpend({
  limits: o.lim ?? LIM, tally: o.t ?? T0, runPaid: 0, reserve: R(o.usd), ledgerOk: o.ok ?? true,
  settleHold: null, unresolved: [], protect: o.p ?? null,
})
function P(reserved: number, ceiling: number | null = 0.5): SpendProtect {
  return { reservedForOthersUsd: reserved, ceilingUsd: ceiling, reason: 't' }
}
{
  const a = judge({ t: tally(0.2), usd: 0.04, p: P(0.25) })
  const b = judge({ t: tally(0.2), usd: 0.06, p: P(0.25) })
  check('손 실행 — 몫을 뺀 여력(0.05) 안의 요청은 통과한다', a.ok)
  check('🔴 손 실행 — 몫을 파고드는 요청은 SCHEDULED_RESERVE 로 막힌다', !b.ok && b.code === 'SCHEDULED_RESERVE')
  check('정기 회차(보호 없음) — 같은 요청이 통과한다', judge({ t: tally(0.2), usd: 0.06 }).ok)
  const c = judge({ t: tally(0.2, 0.03), usd: 0.04, p: P(0.25) })
  check('🔴 열린 예약(미정산)도 여력에서 뺀다 — 0.2 정산 + 0.03 열림이면 0.04 가 막힌다',
    !c.ok && c.code === 'SCHEDULED_RESERVE')
  const d = judge({ t: tally(0.48), usd: 0.04, p: P(0.25) })
  check('🔴 하루 총액이 모자라면 DAILY_EXHAUSTED 가 먼저다 — 양보와 소진을 가른다', !d.ok && d.code === 'DAILY_EXHAUSTED')
  const e = judge({ t: tally(0.45), usd: 0.06, p: P(0, 0.5), lim: { ...LIM, dailyUsd: 5 } })
  check('🔴 손 실행이 env 로 하루 예산을 5달러로 올려도 계약 천장 0.5 를 넘지 못한다',
    !e.ok && e.code === 'SCHEDULED_RESERVE')
  check('정기 회차는 천장 판정을 받지 않는다(기존 env 판정 그대로)',
    judge({ t: tally(0.45), usd: 0.06, lim: { ...LIM, dailyUsd: 5 } }).ok)
  const f = judge({ t: tally(0.2), usd: 0.04, p: P(0.25), ok: false })
  check('🔴 장부를 못 읽으면 LEDGER_ERROR 다 — 보호가 그것을 가리지 않는다', !f.ok && f.code === 'LEDGER_ERROR')
  const g = judge({ usd: 0.01, p: { reservedForOthersUsd: Number.NaN, ceilingUsd: 0.5, reason: 'x' } })
  check('🔴 몫을 계산하지 못했으면 막는다(NaN)', !g.ok && g.code === 'SCHEDULED_RESERVE')
  const h = judge({ usd: 0.01, p: { reservedForOthersUsd: -1, ceilingUsd: 0.5, reason: 'x' } })
  check('🔴 음수 몫으로 여력을 늘리지 못한다', !h.ok && h.code === 'SCHEDULED_RESERVE')
  const i = judge({ usd: 0.01, p: P(0.1, 0) })
  check('🔴 천장이 0(미승인)이면 손 실행은 아무것도 못 쓴다', !i.ok && i.code === 'SCHEDULED_RESERVE')
  const j = judge({ t: tally(0.2), usd: 0.04, p: P(0.25) })
  check('통과하면 남은 여력은 몫을 뺀 값이다', j.ok && Math.abs(j.remainingUsd - 0.01) < 1e-9)
}
{
  const mm = supplySpendProtectAt({ env: {}, now: kst('2026-09-28T11:13:00') })
  check('손 실행 11:13 — 5개 몫 · 천장 = 계약 천장',
    mm.protect !== null && Math.abs(mm.protect.reservedForOthersUsd - 5 * PER) < 1e-12
    && mm.protect.ceilingUsd === SUPPLY_DAILY_USD_APPROVED)
  check('정기 회차 12:20 — 보호 없음', supplySpendProtectAt({ env: LABEL, now: kst('2026-09-28T12:20:00') }).protect === null)
  const last = supplySpendProtectAt({ env: {}, now: kst('2026-09-28T23:10:00') })
  check('🔴 손 실행 23:10 — 몫 0 (마지막 회차 뒤 풀림)', last.protect !== null && last.protect.reservedForOthersUsd === 0)
  check('🔴 천장 미승인(null)은 0 으로 읽는다',
    supplySpendProtectAt({ env: {}, now: kst('2026-09-28T23:10:00'), ceilingUsd: null }).protect?.ceilingUsd === 0)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 세션 — 🔴 실제 장부 파일 · 가짜 fetch 로 요청 수를 센다')
// ─────────────────────────────────────────────────────────
const realFetch = globalThis.fetch
let paidFetches = 0
const OUT_TOKENS = 1000
globalThis.fetch = (async (url: string | URL | Request) => {
  const u = String(url)
  if (u.includes('/count_tokens')) {
    return new Response(JSON.stringify({ input_tokens: 100 }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  paidFetches += 1
  return new Response(JSON.stringify({
    content: [{ text: '"ok":true}' }], usage: { input_tokens: 100, output_tokens: OUT_TOKENS }, stop_reason: 'end_turn',
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}) as typeof globalThis.fetch
const prevKey = process.env.ANTHROPIC_API_KEY
process.env.ANTHROPIC_API_KEY = 'fixture-fake-key'

const ASK = {
  stage: 'judge' as const, model: 'claude-haiku-4.5' as const,
  systemPrompt: 'sys', userPayload: '{}', maxOutputTokens: 1200, timeoutMs: 5_000,
}
const HEAD = 1.2
const perReq = reserveOf({ model: ASK.model, countedInputTokens: 100, maxOutputTokens: ASK.maxOutputTokens, headroomMultiplier: HEAD })
if (!perReq.known) throw new Error('예약액을 계산하지 못했다')
/** 🔴 손 실행이 쓸 수 있는 폭을 요청 몇 건으로 잡는다 — 정산액(출력 1000)이 예약액보다 작아야 한다 */
const at = (s: string) => () => kst(s)
const protectOf = (env: Record<string, string | undefined>) => (t: Date): ProtectDecision => supplySpendProtectAt({ env, now: t })
const blockedCodes = (dir: string, date: string): string[] => {
  try {
    return readFileSync(ledgerPathOf(dir, date), 'utf-8').split('\n').filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as LedgerEntry).filter((e) => e.status === 'blocked' && e.stage !== 'countTokens')
      .map((e) => e.blockCode ?? '')
  } catch { return [] }
}
const reserveAt = (s: string): number => pendingSlotsAt(kst(s)).length * PER

async function runCalls(s: SupplyLlmSession, k: number, stage: typeof ASK.stage | 'judgeRetry' = 'judge'): Promise<number> {
  let ok = 0
  for (let i = 0; i < k; i += 1) {
    const r = await s.call({ ...ASK, stage })
    if (r.ok) ok += 1
  }
  return ok
}

{
  // ⓐ 09-28 재현 — 손 실행이 먼저 와도 정기 회차가 돈다
  const dir = mkdtempSync(join(tmpdir(), 'reserve-a-'))
  const T = '2026-09-28T11:13:00'
  const daily = reserveAt(T) + 2.5 * perReq.usd
  const lim: BudgetLimits = { dailyUsd: daily, runRequestCap: 1000, headroomMultiplier: HEAD }
  const before = paidFetches
  const manual = new SupplyLlmSession({ runId: 'M', dir, limits: lim, now: at(T), protectAt: protectOf({}) })
  const mOk = await runCalls(manual, 6)
  const mPaid = paidFetches - before
  check('손 실행 — 몫을 뺀 폭 안에서만 나간다 (2건)', mOk === 2 && mPaid === 2, `ok=${mOk} paid=${mPaid}`)
  check('🔴 손 실행 — 나머지는 SCHEDULED_RESERVE 로 막히고 fetch 가 나가지 않는다',
    blockedCodes(dir, '2026-09-28').filter((c) => c === 'SCHEDULED_RESERVE').length === 4)
  const retry = await runCalls(manual, 2, 'judgeRetry')
  check('🔴 재시도(judgeRetry)도 같은 판정을 지난다 — 우회가 아니다', retry === 0 && paidFetches - before === 2)
  const b2 = paidFetches
  const sched = new SupplyLlmSession({ runId: 'S', dir, limits: lim, now: at('2026-09-28T12:20:00'), protectAt: protectOf(LABEL) })
  const sOk = await runCalls(sched, 3)
  check('🔴 정기 회차(12:20) — 손 실행 뒤에도 자기 몫으로 돈다', sOk === 3 && paidFetches - b2 === 3, `ok=${sOk}`)
  check('세션이 실행 종류를 사람이 읽는 줄에 적는다', manual.describe().includes('손 실행') && sched.describe().includes('정기'))
  rmSync(dir, { recursive: true, force: true })
}
{
  // ⓑ 🔴 열린 예약 — 정기 회차가 보낸 요청이 아직 정산 전이어도 그 금액을 뺀다
  const dir = mkdtempSync(join(tmpdir(), 'reserve-b-'))
  const T = '2026-09-28T11:13:00'
  const lim: BudgetLimits = { dailyUsd: reserveAt(T) + 2.5 * perReq.usd, runRequestCap: 1000, headroomMultiplier: HEAD }
  appendLedgerLine(ledgerPathOf(dir, '2026-09-28'), {
    runId: 'SCHED-inflight', stage: 'draftGen', attemptId: 'open-1', requestNo: 0,
    provider: 'anthropic', apiModelId: 'x', model: 'claude-haiku-4.5', status: 'reserved', blockCode: null,
    countedInputTokens: 100, maxOutputTokens: 1200, reservedUsd: 2 * perReq.usd,
    inputTokens: null, outputTokens: null, cacheWriteTokens: null, cacheReadTokens: null, usageKeys: [],
    settledUsd: null, pricingVersion: null, startedAt: kst(T).toISOString(), endedAt: null, errorCode: null,
  })
  const manual = new SupplyLlmSession({ runId: 'M2', dir, limits: lim, now: at(T), protectAt: protectOf({}) })
  const ok = await runCalls(manual, 3)
  check('🔴 열린 예약 2건분이 있으면 손 실행 폭이 그만큼 준다 (2건 → 0건)', ok === 0, `ok=${ok}`)
  rmSync(dir, { recursive: true, force: true })
}
{
  // ⓒ 🔴 마지막 슬롯 뒤 풀림 · KST 자정 경계
  const dir = mkdtempSync(join(tmpdir(), 'reserve-c-'))
  const lim: BudgetLimits = { dailyUsd: 3 * PER, runRequestCap: 1000, headroomMultiplier: HEAD }
  const before = await runCalls(new SupplyLlmSession({ runId: 'L0', dir, limits: lim, now: at('2026-09-28T22:59:00'), protectAt: protectOf({}) }), 1)
  const after = await runCalls(new SupplyLlmSession({ runId: 'L1', dir, limits: lim, now: at('2026-09-28T23:00:00'), protectAt: protectOf({}) }), 1)
  check('🔴 22:59 손 실행 — 22:15 회차 몫(1개)을 남긴다 (여력 3몫 − 1몫 = 2몫, 요청은 통과)', before === 1)
  const tight: BudgetLimits = { dailyUsd: PER + 0.5 * perReq.usd, runRequestCap: 1000, headroomMultiplier: HEAD }
  const d2 = mkdtempSync(join(tmpdir(), 'reserve-c2-'))
  const b = await runCalls(new SupplyLlmSession({ runId: 'L2', dir: d2, limits: tight, now: at('2026-09-28T22:59:59'), protectAt: protectOf({}) }), 1)
  const a = await runCalls(new SupplyLlmSession({ runId: 'L3', dir: d2, limits: tight, now: at('2026-09-28T23:00:00'), protectAt: protectOf({}) }), 1)
  check('🔴 22:59:59 손 실행 — 몫 1개에 막힌다', b === 0)
  check('🔴 23:00 손 실행 — 마지막 창이 끝나 몫이 풀려 통과한다', a === 1)
  check('09-28 장부의 막힌 줄은 22:59:59 한 건뿐이다', blockedCodes(d2, '2026-09-28').length === 1)
  const mid = await runCalls(new SupplyLlmSession({ runId: 'L4', dir: d2, limits: tight, now: at('2026-09-29T00:00:00'), protectAt: protectOf({}) }), 1)
  check('🔴 00:00 손 실행 — 새 날 장부는 비었지만 새 날 몫 6개가 다시 잡혀 막힌다',
    mid === 0 && blockedCodes(d2, '2026-09-29').includes('SCHEDULED_RESERVE'))
  check('다음 날 첫 정기 회차(08:20)는 돈다',
    await runCalls(new SupplyLlmSession({ runId: 'L5', dir: d2, limits: tight, now: at('2026-09-29T08:20:00'), protectAt: protectOf(LABEL) }), 1) === 1)
  check('after(23:00) 통과', after === 1)
  rmSync(dir, { recursive: true, force: true })
  rmSync(d2, { recursive: true, force: true })
}
{
  // ⓓ 🔴 공급 장부(기본 디렉터리)에서는 호출부가 보호를 끄지 못한다
  const home = mkdtempSync(join(tmpdir(), 'reserve-home-'))
  const prevHome = process.env.HOME
  const prevLabel = process.env[LAUNCHD_LABEL_ENV]
  process.env.HOME = home
  delete process.env[LAUNCHD_LABEL_ENV]
  SUPPLY_PROTECT_TEST_SEAM.clock = () => kst('2026-09-28T11:13:00')
  try {
    const lim: BudgetLimits = { dailyUsd: PER, runRequestCap: 1000, headroomMultiplier: HEAD }
    check('시험 HOME 의 기본 장부 경로를 쓴다', defaultLedgerDir().startsWith(home))
    const forged = new SupplyLlmSession({
      runId: 'F', limits: lim, now: () => kst('2026-09-28T11:13:00'),
      // 🔴 호출부가 "정기다 · 보호 없음" 을 주장한다
      protectAt: () => ({ kind: 'scheduled', why: 'forged', protect: null }),
    })
    const ok = await runCalls(forged, 1)
    check('🔴 공급 장부에서는 호출부가 넘긴 보호 설정을 무시한다 — 손 실행은 막힌다',
      ok === 0 && blockedCodes(defaultLedgerDir(), '2026-09-28').includes('SCHEDULED_RESERVE'))
    process.env[LAUNCHD_LABEL_ENV] = SUPPLY_PROCESS_LAUNCHD_LABEL
    const s2 = new SupplyLlmSession({ runId: 'F2', limits: lim, now: () => kst('2026-09-28T11:13:00') })
    check('🔴 공급 job 라벨이어도 창 밖(11:13)이면 막힌다 — kickstart 는 정기가 아니다', await runCalls(s2, 1) === 0)
    SUPPLY_PROTECT_TEST_SEAM.clock = () => kst('2026-09-28T12:20:00')
    const s3 = new SupplyLlmSession({ runId: 'F3', limits: lim, now: () => kst('2026-09-28T12:20:00') })
    check('공급 job 라벨 + 창 안(12:20) → 정기 → 통과', await runCalls(s3, 1) === 1)
    delete process.env[LAUNCHD_LABEL_ENV]
    const s4 = new SupplyLlmSession({ runId: 'F4', limits: lim, now: () => kst('2026-09-28T12:20:00') })
    check('🔴 같은 시각 라벨 없는 실행은 손 실행 → 막힌다', await runCalls(s4, 1) === 0)
    /**
     * 🔴 **운영 경로의 보호 판정이 `SORAN_RUN_AT` 을 시각으로 쓰지 않는다.**
     *    그 값은 부모가 자식에게 넘기는 회차 시각이라 손 실행이 적어 넣을 수 있다 —
     *    kickstart(11:13) 가 08:20 을 적으면 정기 창 안으로 보이게 된다.
     */
    SUPPLY_PROTECT_TEST_SEAM.clock = null
    const viaEnv = supplyProtectFromEnv({ ...LABEL, SORAN_RUN_AT: '2026-09-27T23:20:00.000Z' })(kst('2026-09-28T11:13:00'))
    check('🔴 운영 보호 판정(supplyProtectFromEnv)은 SORAN_RUN_AT=08:20 을 적어도 11:13 을 본다 — 손 실행',
      viaEnv.kind === 'manual' && viaEnv.protect !== null)
  } finally {
    SUPPLY_PROTECT_TEST_SEAM.clock = null
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome
    if (prevLabel === undefined) delete process.env[LAUNCHD_LABEL_ENV]; else process.env[LAUNCHD_LABEL_ENV] = prevLabel
    rmSync(home, { recursive: true, force: true })
  }
}
{
  // ⓔ 🔴 장부 읽기 실패 — 앞판처럼 LEDGER_ERROR (보호가 가리지 않는다)
  const dir = mkdtempSync(join(tmpdir(), 'reserve-e-'))
  const io: LedgerIo = { ...REAL_LEDGER_IO, readDay: () => ({ ok: false, reason: 'fixture' }) }
  const lim: BudgetLimits = { dailyUsd: 100, runRequestCap: 1000, headroomMultiplier: HEAD }
  const s = new SupplyLlmSession({ runId: 'E', dir, limits: lim, io, now: at('2026-09-28T23:10:00'), protectAt: protectOf({}) })
  const before = paidFetches
  const ok = await runCalls(s, 1)
  check('🔴 장부를 못 읽으면 막힌다(LEDGER_ERROR) · fetch 0',
    ok === 0 && paidFetches === before && blockedCodes(dir, '2026-09-28').includes('LEDGER_ERROR'))
  rmSync(dir, { recursive: true, force: true })
}
{
  // ⓕ 🔴 판정은 잠금 안에서 — 집계·보호·예약 기록이 한 잠금이다(두 실행이 같은 여력을 두 번 보지 않는다)
  const src = readFileSync('scripts/lib/supply-llm-call.mts', 'utf-8')
  const lockAt = src.indexOf('verdict = this.io.withLock(this.dir, () => {')
  const protectAt = src.indexOf('this.protectAt(startedAt)')
  const judgeAt = src.indexOf('const v = judgeSpend({', lockAt)
  const addAt = src.indexOf('this.io.addOpen(', lockAt)
  check('🔴 보호 판정이 집계와 같은 잠금 안에서, 예약 기록보다 앞에서 일어난다',
    lockAt > 0 && lockAt < protectAt && protectAt < judgeAt && judgeAt < addAt)
  check('🔴 공급 장부면 호출부 보호 설정을 보지 않는다(코드)',
    /this\.dir === defaultLedgerDir\(\)\s*\?\s*supplyProtectFromEnv\(process\.env\)/.test(src))
}

globalThis.fetch = realFetch
if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail\n`)
process.exit(fail === 0 ? 0 : 1)
