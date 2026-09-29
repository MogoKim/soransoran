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
 *    ⑨ (2차) 슬롯 몫은 장부의 **최근 정기 회차 실측**에서 온다 · 표본이 모자라면 보수 기본값(fail-closed)
 *    ⑩ (2차) 남은 몫 < 남은 슬롯 몫 합이면 **비례 축소** · 앞 슬롯이 덜 쓴 몫은 **뒤로 이월**
 *    ⑪ (2차) 정기 회차도 **뒤 슬롯 몫**을 남긴다 — 09-29 실측 비용으로 하루를 돌려 22:15 가 굶지 않는다
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
  LAUNCHD_LABEL_ENV, SCHEDULED_COST_LOOKBACK_DAYS, SCHEDULED_COST_MIN_SAMPLES, SCHEDULED_RUN_WINDOW_MS,
  SUPPLY_PROCESS_LAUNCHD_LABEL,
  activeSlotAt, allocateScheduledReserve, conservativeShareUsd, endedSlotsAt, measuredShareFloorUsd, pendingSlotsAt,
  scheduledRunSamples, scheduledShareFrom, supplyRunKindOf, supplySpendProtectAt,
} from '../src/lib/supply-scheduled-reserve'
import {
  REAL_LEDGER_IO, SUPPLY_PROTECT_TEST_SEAM, SupplyLlmSession, supplyProtectFromEnv,
  type LedgerIo, type ProtectContext, type ProtectDecision,
} from './lib/supply-llm-call.mjs'
import { appendLedgerLine, defaultLedgerDir, ledgerPathOf, readLedgerDay } from './lib/llm-ledger-store.mjs'

let pass = 0
let fail = 0
const check = (n: string, ok: boolean, extra = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${n}`) }
  else { fail += 1; console.log(`  🔴 FAIL ${n}${extra === '' ? '' : `\n     ${extra}`}`) }
}

/** KST 시각 → Date. 🔴 시험이 읽기 쉽게 KST 로 적는다 */
const kst = (s: string): Date => new Date(`${s}+09:00`)
const LABEL = { [LAUNCHD_LABEL_ENV]: SUPPLY_PROCESS_LAUNCHD_LABEL }
/** 보수 기본값(표본 부족) — 회차 상한 */
const CAPRUN = conservativeShareUsd()
/** 실측 몫의 바닥 — 앞판의 고정 몫($0.0464)과 같은 값이다 */
const FLOOR = measuredShareFloorUsd()
/** 합성 장부 줄 번호 — `line()` 이 쓴다(함수는 끌어올려지지만 이 값은 아니다) */
let lineSeq = 0

console.log('\n══ 정기 공급 회차 몫 보호 검사 (🔴 네트워크 0 · 실제 provider 0) ══\n')

// ─────────────────────────────────────────────────────────
console.log('① 몫의 크기 — 🔴 정본 상수에서 온다')
// ─────────────────────────────────────────────────────────
check('보수 기본값 = 회차 상한(estimateSupplySpend(묶음).capPerRun) · 바닥 = 추정 평균(expectedPerRun)',
  CAPRUN === estimateSupplySpend(SUPPLY_WORKSET_PER_RUN).capPerRun
  && FLOOR === estimateSupplySpend(SUPPLY_WORKSET_PER_RUN).expectedPerRun && FLOOR > 0 && CAPRUN > FLOOR,
  `cap=${CAPRUN} floor=${FLOOR}`)
check('🔴 보수 기본값 6회분은 계약 천장보다 크다 — 표본이 없으면 비례 축소로 하루 여력 전부를 정기 슬롯이 나눠 갖는다',
  SUPPLY_DAILY_USD_APPROVED !== null && SUPPLY_RUNS_PER_DAY * CAPRUN > SUPPLY_DAILY_USD_APPROVED,
  `${SUPPLY_RUNS_PER_DAY}×${CAPRUN.toFixed(4)} vs ${SUPPLY_DAILY_USD_APPROVED}`)
check('실측 기간·최소 표본이 이름 붙은 상수다', SCHEDULED_COST_LOOKBACK_DAYS === 7 && SCHEDULED_COST_MIN_SAMPLES === 3)
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
check('공급 job 라벨 + 슬롯 창 안 → 정기 · 슬롯 이름을 돌려준다',
  supplyRunKindOf(LABEL, kst('2026-09-28T08:20:00')).kind === 'scheduled'
  && supplyRunKindOf(LABEL, kst('2026-09-28T08:20:00')).slot === '2026-09-28 08:15')
check('🔴 늦게 뜬 launchd 회차(12:15 를 놓치고 13:30 에 깸)는 손 실행이다 — 슬롯 없음',
  supplyRunKindOf(LABEL, kst('2026-09-28T13:30:00')).kind === 'manual'
  && supplyRunKindOf(LABEL, kst('2026-09-28T13:30:00')).slot === null)
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
  check('보호 없음(null)이면 앞판 판정 그대로 — env 예산만 본다',
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
  const S5 = 0.05
  const mm = supplySpendProtectAt({ env: {}, now: kst('2026-09-28T11:13:00'), shareUsd: S5, dailyUsd: 0.5 })
  check('손 실행 11:13 — 남은 5개 슬롯 몫 전부(안 돈 08:15 몫도 이월돼 남는다 = 6몫) · 천장 = 계약 천장',
    Math.abs(mm.protect.reservedForOthersUsd - 6 * S5) < 1e-12 && mm.protect.ceilingUsd === SUPPLY_DAILY_USD_APPROVED,
    `${mm.protect.reservedForOthersUsd}`)
  const sc = supplySpendProtectAt({ env: LABEL, now: kst('2026-09-28T12:20:00'), shareUsd: S5, dailyUsd: 0.5 })
  check('🔴 정기 회차 12:20 — 보호 없음이 아니라 **뒤 4개 슬롯** 몫을 남긴다(자기 슬롯은 뺀다 · 이월 포함 6몫/5)',
    sc.kind === 'scheduled' && sc.slot === '2026-09-28 12:15' && Math.abs(sc.protect.reservedForOthersUsd - 4 * (6 * S5 / 5)) < 1e-12)
  const noCarry = supplySpendProtectAt({
    env: {}, now: kst('2026-09-28T11:13:00'), shareUsd: S5, dailyUsd: 0.5,
    todayEntries: [line({ usd: S5, kind: 'scheduled', slot: '2026-09-28 08:15', at: '2026-09-28T08:20:00' })],
  })
  check('08:15 가 자기 몫을 다 썼으면 이월 없음 — 손 실행 11:13 은 남은 5몫만 남긴다',
    Math.abs(noCarry.protect.reservedForOthersUsd - 5 * S5) < 1e-12, `${noCarry.protect.reservedForOthersUsd}`)
  const last = supplySpendProtectAt({ env: {}, now: kst('2026-09-28T23:10:00'), shareUsd: S5, dailyUsd: 0.5 })
  check('🔴 손 실행 23:10 — 몫 0 (마지막 회차 뒤 풀림)', last.protect.reservedForOthersUsd === 0)
  check('🔴 천장 미승인(null)은 손 실행에게 0 이다',
    supplySpendProtectAt({ env: {}, now: kst('2026-09-28T23:10:00'), ceilingUsd: null }).protect.ceilingUsd === 0)
  check('천장 미승인(null)이면 정기 회차는 env 예산만 본다(앞판 그대로)',
    supplySpendProtectAt({ env: LABEL, now: kst('2026-09-28T22:20:00'), ceilingUsd: null, dailyUsd: 0.3 }).protect.ceilingUsd === null)
  const s22 = supplySpendProtectAt({ env: LABEL, now: kst('2026-09-28T22:20:00'), shareUsd: S5, dailyUsd: 0.5 })
  check('마지막 슬롯(22:20) 정기 회차 — 뒤 슬롯이 없어 떼어 둘 몫 0', s22.protect.reservedForOthersUsd === 0)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 슬롯 몫 — 🔴 장부의 정기 회차 표식(runKind·runSlot)만 믿는다 · 표본 부족이면 보수 기본값')
// ─────────────────────────────────────────────────────────
/** 장부 한 줄 — 🔴 실행 종류·슬롯 표식을 싣는다. 금액 외에는 아무것도 담지 않는다 */
function line(o: {
  usd: number; kind?: 'scheduled' | 'manual' | null; slot?: string | null
  status?: LedgerEntry['status']; at?: string; resolvedBy?: 'human'
}): LedgerEntry {
  lineSeq += 1
  const status = o.status ?? 'settled'
  return {
    runId: 'SIM', stage: 'draftGen', attemptId: `sim-${lineSeq}`, requestNo: lineSeq,
    provider: 'anthropic', apiModelId: 'x', model: 'claude-haiku-4.5', status,
    blockCode: status === 'blocked' ? 'DAILY_EXHAUSTED' : null,
    countedInputTokens: 100, maxOutputTokens: 1200,
    reservedUsd: status === 'blocked' ? null : o.usd,
    inputTokens: null, outputTokens: null, cacheWriteTokens: null, cacheReadTokens: null, usageKeys: [],
    settledUsd: status === 'settled' ? o.usd : null, pricingVersion: 'test',
    startedAt: kst(o.at ?? '2026-09-29T08:20:00').toISOString(), endedAt: null, errorCode: null,
    ...(o.kind === undefined ? {} : { runKind: o.kind }),
    ...(o.slot === undefined ? {} : { runSlot: o.slot }),
    ...(o.resolvedBy === undefined ? {} : { resolvedBy: o.resolvedBy }),
  }
}
/**
 * 🔴 **2026-09-29 실측 정기 회차 비용** (운영 장부 `llm-ledger/2026-09-29.jsonl` 을 읽기만 해서 모은 값 —
 *    판정 `-j` + 초안 `-d` 합). 08:15 $0.0655 · 12:15 $0.0992 · 17:15 $0.0923 (14:15 는 그날 돌지 않았다).
 *    앞판 고정 몫 $0.0464 보다 모두 크다 — 그 차이가 22:15 를 굶기는 근거다.
 */
const MEASURED_0929 = [
  { slot: '2026-09-29 08:15', usd: 0.0655 },
  { slot: '2026-09-29 12:15', usd: 0.0992 },
  { slot: '2026-09-29 17:15', usd: 0.0923 },
] as const
const MEAN_0929 = MEASURED_0929.reduce((s, x) => s + x.usd, 0) / MEASURED_0929.length
const HIST_0929: LedgerEntry[] = MEASURED_0929.map((m) => line({ usd: m.usd, kind: 'scheduled', slot: m.slot }))
const NEXT_MORNING = kst('2026-09-30T07:00:00')
{
  const sm = scheduledRunSamples({ entries: HIST_0929, now: NEXT_MORNING })
  const sh = scheduledShareFrom(sm)
  check('09-29 정기 3회 → 표본 3 · 몫 = 실측 평균($0.0857)',
    sm.length === 3 && sh.source === 'measured' && Math.abs(sh.usd - MEAN_0929) < 1e-12, `${sh.usd} ${sh.why}`)
  check('🔴 실측 몫이 앞판 고정 몫($0.0464)보다 크다 — 묶음 10 실제 비용을 따라간다', sh.usd > FLOOR * 1.5)
  const none = scheduledShareFrom(scheduledRunSamples({ entries: [], now: NEXT_MORNING }))
  check('🔴 표본 0 → 보수 기본값(회차 상한) · fail-closed', none.source === 'fallback' && none.usd === CAPRUN, none.why)
  const two = scheduledShareFrom(scheduledRunSamples({ entries: HIST_0929.slice(0, 2), now: NEXT_MORNING }))
  check('🔴 표본 2 (< 3) → 보수 기본값', two.source === 'fallback' && two.usd === CAPRUN)
  check('🔴 이력을 읽지 못함(null) → 보수 기본값', scheduledShareFrom(null).source === 'fallback' && scheduledShareFrom(null).usd === CAPRUN)
  const legacy = MEASURED_0929.map((m) => line({ usd: m.usd, at: `${m.slot.replace(' ', 'T')}:05` }))
  check('🔴 표식 없는 옛 줄(회차 id 시각만 있는 것)은 표본이 아니다 — 시각으로 추측하지 않는다',
    scheduledRunSamples({ entries: legacy, now: NEXT_MORNING }).length === 0)
  const manualTagged = MEASURED_0929.map((m) => line({ usd: m.usd, kind: 'manual', slot: null }))
  check('🔴 손 실행 표식 줄은 표본이 아니다', scheduledRunSamples({ entries: manualTagged, now: NEXT_MORNING }).length === 0)
  const withOpen = [...HIST_0929, line({ usd: 0.01, kind: 'scheduled', slot: '2026-09-29 12:15', status: 'reserved' })]
  check('🔴 미정산(열린 예약)이 남은 슬롯은 표본에서 뺀다 — 금액을 모른다',
    scheduledRunSamples({ entries: withOpen, now: NEXT_MORNING }).map((x) => x.slot).join(',') === '2026-09-29 08:15,2026-09-29 17:15')
  const withUnknown = [...HIST_0929, line({ usd: 0.01, kind: 'scheduled', slot: '2026-09-29 08:15', status: 'usageUnknown' })]
  check('🔴 사용량 미상이 남은 슬롯도 뺀다', scheduledRunSamples({ entries: withUnknown, now: NEXT_MORNING }).length === 2)
  const withBlocked = [...HIST_0929, line({ usd: 0, kind: 'scheduled', slot: '2026-09-29 17:15', status: 'blocked' })]
  check('🔴 막힌 요청이 있는 슬롯은 뺀다 — 잘린 회차는 실제보다 싸 보인다',
    scheduledRunSamples({ entries: withBlocked, now: NEXT_MORNING }).length === 2)
  const withHuman = [...HIST_0929, line({ usd: 0.02, kind: 'scheduled', slot: '2026-09-29 17:15', resolvedBy: 'human' })]
  check('🔴 사람이 마감한 줄이 있는 슬롯은 뺀다(사고 회차)', scheduledRunSamples({ entries: withHuman, now: NEXT_MORNING }).length === 2)
  check('🔴 오늘 슬롯(끝났어도)은 표본이 아니다 — 하루 안에서 몫이 흔들리지 않는다',
    scheduledRunSamples({ entries: HIST_0929, now: kst('2026-09-29T23:30:00') }).length === 0)
  check('🔴 자정이 지나면 어제 슬롯이 표본이 된다',
    scheduledRunSamples({ entries: HIST_0929, now: kst('2026-09-30T00:00:00') }).length === 3)
  const old = [...HIST_0929, line({ usd: 0.5, kind: 'scheduled', slot: '2026-09-22 08:15' })]
  check('🔴 기간(어제까지 7일) 밖 슬롯은 표본이 아니다',
    scheduledRunSamples({ entries: old, now: NEXT_MORNING }).every((x) => x.slot !== '2026-09-22 08:15')
    && scheduledRunSamples({ entries: old, now: kst('2026-09-29T07:00:00') }).some((x) => x.slot === '2026-09-22 08:15'))
  const twoLines = [...HIST_0929, line({ usd: 0.01, kind: 'scheduled', slot: '2026-09-29 08:15' })]
  check('한 슬롯의 판정·초안 줄을 합친다(08:15 = 0.0655 + 0.01)',
    Math.abs((scheduledRunSamples({ entries: twoLines, now: NEXT_MORNING })[0]?.usd ?? 0) - 0.0755) < 1e-12)
  const cheap = ['08:15', '12:15', '14:15'].map((h) => line({ usd: 0.001, kind: 'scheduled', slot: `2026-09-29 ${h}` }))
  check('실측 평균이 바닥보다 낮으면 바닥(추정 평균)', scheduledShareFrom(scheduledRunSamples({ entries: cheap, now: NEXT_MORNING })).usd === FLOOR)
  const dear = ['08:15', '12:15', '14:15'].map((h) => line({ usd: 1, kind: 'scheduled', slot: `2026-09-29 ${h}` }))
  check('실측 평균이 회차 상한보다 높으면 상한', scheduledShareFrom(scheduledRunSamples({ entries: dear, now: NEXT_MORNING })).usd === CAPRUN)
  const viaProtect = supplySpendProtectAt({ env: {}, now: NEXT_MORNING, historyEntries: HIST_0929, dailyUsd: 0.5 })
  check('보호 판정이 이력에서 몫을 읽는다(운영 경로의 계산)', Math.abs(viaProtect.share.usd - MEAN_0929) < 1e-12)
  check('🔴 보호 판정에 이력이 없으면(null) 보수 기본값', supplySpendProtectAt({ env: {}, now: NEXT_MORNING, historyEntries: null }).share.usd === CAPRUN)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 배분 — 🔴 비례 축소 · 이월 · 손 실행/늦은 회차는 남은 몫 전부를 남긴다')
// ─────────────────────────────────────────────────────────
const LIM_SIM = (daily: number): BudgetLimits => ({ dailyUsd: daily, runRequestCap: 1_000_000, headroomMultiplier: 1.2 })
/** 이 요청이 쓸 수 있는 폭 — `judgeSpend` 가 보는 값 그대로(천장·쓴 것·열린 예약·떼어 둔 몫) */
function allowanceOf(env: Record<string, string>, at: string, today: LedgerEntry[], daily: number, history: LedgerEntry[] | null): number {
  const d = supplySpendProtectAt({ env, now: kst(at), todayEntries: today, historyEntries: history, dailyUsd: daily })
  const t = tallyOf(today)
  const cap = d.protect.ceilingUsd === null ? daily : Math.min(daily, d.protect.ceilingUsd)
  return cap - t.settledUsd - t.openReservedUsd - d.protect.reservedForOthersUsd
}
type Ev = { name: string; at: string; env: Record<string, string>; demand: number }
/** 한 요청의 크기 — 공급 초안 1건 정도 */
const STEP = 0.004
/**
 * 🔴 **하루를 돌린다 — 요청마다 실제 판정(`supplySpendProtectAt` → `judgeSpend`)을 지난다.**
 *    통과하면 정산 줄을 남기고(표식 포함), 막히면 그 실행은 멈춘다.
 */
function simulate(
  o: { daily: number; history: LedgerEntry[] | null; events: readonly Ev[]; prefill?: LedgerEntry[] },
  /** 실행이 시작될 때 판정이 본 슬롯 몫 — 오늘 끝난 정기 회차도 표본이 되므로 하루 중에 바뀐다 */
  shareAtStart: Record<string, number> = {},
): Record<string, number> {
  const today: LedgerEntry[] = [...(o.prefill ?? [])]
  const got: Record<string, number> = {}
  for (const ev of o.events) {
    let spent = 0
    shareAtStart[ev.name] = supplySpendProtectAt({
      env: ev.env, now: kst(ev.at), todayEntries: today,
      historyEntries: o.history === null ? null : [...o.history, ...today], dailyUsd: o.daily,
    }).share.usd
    for (;;) {
      const want = Math.min(STEP, ev.demand - spent)
      if (want <= 1e-12) break
      const d = supplySpendProtectAt({
        env: ev.env, now: kst(ev.at), todayEntries: today,
        historyEntries: o.history === null ? null : [...o.history, ...today], dailyUsd: o.daily,
      })
      const v = judgeSpend({
        limits: LIM_SIM(o.daily), tally: tallyOf(today), runPaid: 0, reserve: R(want),
        ledgerOk: true, settleHold: null, unresolved: [], protect: d.protect,
      })
      if (!v.ok) break
      today.push(line({ usd: want, kind: d.kind, slot: d.slot, at: ev.at }))
      spent += want
    }
    got[ev.name] = (got[ev.name] ?? 0) + spent
  }
  return got
}
const M = (name: string, at: string, demand = 10): Ev => ({ name, at, env: {}, demand })
const S = (name: string, at: string, demand: number): Ev => ({ name, at, env: LABEL, demand })
/** 09-30 하루 — 정기 6회는 09-29 실측 수준으로 쓰고 싶어 하고, 손 실행은 틈마다 전부 가져가려 한다 */
const DEMAND = { s0815: 0.0655, s1215: 0.0992, s1415: 0.0923, s1715: 0.0923, s2115: 0.0992, s2215: 0.0923 }
const DAY_0930: Ev[] = [
  M('m0700', '2026-09-30T07:00:00'),
  S('s0815', '2026-09-30T08:20:00', DEMAND.s0815),
  M('m1113', '2026-09-30T11:13:00'),
  S('s1215', '2026-09-30T12:20:00', DEMAND.s1215),
  { name: 'late1330', at: '2026-09-30T13:30:00', env: LABEL, demand: 10 },
  S('s1415', '2026-09-30T14:20:00', DEMAND.s1415),
  M('m1600', '2026-09-30T16:00:00'),
  S('s1715', '2026-09-30T17:20:00', DEMAND.s1715),
  M('m1900', '2026-09-30T19:00:00'),
  S('s2115', '2026-09-30T21:20:00', DEMAND.s2115),
  S('s2215', '2026-09-30T22:20:00', DEMAND.s2215),
  M('m2310', '2026-09-30T23:10:00'),
]
const fmt = (g: Record<string, number>): string => Object.entries(g).map(([k, v]) => `${k}=${v.toFixed(4)}`).join(' ')
{
  // ⓐ 🔴 고정 몫이면 굶는 날 — 실측 몫으로 22:15 가 산다
  const g = simulate({ daily: 0.5, history: HIST_0929, events: DAY_0930 })
  const fair = Math.min(MEAN_0929, 0.5 / SUPPLY_RUNS_PER_DAY)
  console.log(`     09-30 모의($0.50 · 실측 몫 $${MEAN_0929.toFixed(4)}): ${fmt(g)}`)
  check('🔴 22:15 정기 회차가 굶지 않는다 — 공정 몫(min(실측 평균, 천장/6))의 90% 이상',
    (g.s2215 ?? 0) >= 0.9 * fair, `s2215=${(g.s2215 ?? 0).toFixed(4)} fair=${fair.toFixed(4)} · ${fmt(g)}`)
  check('🔴 21:15 정기 회차도 공정 몫의 90% 이상', (g.s2115 ?? 0) >= 0.9 * fair)
  check('정기 6회 모두 공정 몫의 90% 이상 또는 자기 수요만큼',
    Object.entries(DEMAND).every(([k, dem]) => (g[k] ?? 0) >= Math.min(dem, 0.9 * fair) - 1e-9), fmt(g))
  const total = Object.values(g).reduce((s, x) => s + x, 0)
  check('하루 총액은 천장 이하', total <= 0.5 + 1e-9, `total=${total}`)
  check('🔴 손 실행(07:00 · 11:13 · 16:00 · 19:00)은 남은 슬롯 몫을 넘어서 못 가져간다 — 합이 하루 여력 − 정기 몫 이하',
    (g.m0700 ?? 0) + (g.m1113 ?? 0) + (g.m1600 ?? 0) + (g.m1900 ?? 0) + (g.late1330 ?? 0)
      <= 0.5 - Object.keys(DEMAND).reduce((s, k) => s + (g[k] ?? 0), 0) + 1e-9)
  check('마지막 슬롯 뒤(23:10) 손 실행은 남은 것을 쓴다', (g.m2310 ?? 0) >= 0 && total >= 0.5 - STEP - 1e-9, `total=${total}`)
}
{
  // ⓑ 🔴 비례 축소 — 여력 0.30 · 표본 없음(보수 기본값). 6슬롯이 1/6 씩, 앞 슬롯이 더 가져가지 못한다
  const greedy: Ev[] = [
    M('m0700', '2026-09-30T07:00:00'),
    S('s0815', '2026-09-30T08:20:00', 10), S('s1215', '2026-09-30T12:20:00', 10), S('s1415', '2026-09-30T14:20:00', 10),
    S('s1715', '2026-09-30T17:20:00', 10), S('s2115', '2026-09-30T21:20:00', 10), S('s2215', '2026-09-30T22:20:00', 10),
  ]
  const g = simulate({ daily: 0.3, history: null, events: greedy })
  console.log(`     비례 축소($0.30 · 보수 기본값): ${fmt(g)}`)
  const each = 0.3 / 6
  check('🔴 여력 < 6슬롯 몫 → 08:15 는 여력/6 을 넘지 못한다 — 뒤 슬롯 몫을 먹지 못한다',
    (g.s0815 ?? 0) <= each + 1e-9 && (g.s0815 ?? 0) >= each - STEP - 1e-9, fmt(g))
  check('🔴 6슬롯 모두 여력/6 − 요청 1건 이상 — 22:15 까지 살아 있다 (요청 단위로 남은 자투리는 뒤로 이월)',
    ['s0815', 's1215', 's1415', 's1715', 's2115', 's2215'].every((k) => (g[k] ?? 0) >= each - STEP - 1e-9)
    && Object.values(g).reduce((s, x) => s + x, 0) <= 0.3 + 1e-9, fmt(g))
  check('🔴 표본 없음 → 손 실행은 0 (fail-closed · 여력 전부가 정기 몫)', (g.m0700 ?? 0) === 0)
  // 🔴 소액 연속 요청으로 비례 몫을 잠식하지 못한다 — 1건이 아주 작아도 같은 선에서 멈춘다
  const tiny = allowanceOf(LABEL, '2026-09-30T08:20:00',
    [line({ usd: each - 1e-6, kind: 'scheduled', slot: '2026-09-30 08:15', at: '2026-09-30T08:20:00' })], 0.3, null)
  check('🔴 08:15 가 자기 몫(여력/6)을 거의 다 쓴 뒤 남은 폭은 그 차이뿐이다 — 연속 소액 잠식 없음',
    tiny <= 1e-6 + 1e-12 && tiny >= 0, `tiny=${tiny}`)
}
{
  // ⓒ 🔴 이월 — 08:15 가 안 돌았다(노트북 잠김). 그 몫은 뒤 슬롯으로 간다
  const g = simulate({ daily: 0.5, history: HIST_0929, events: [S('s1215', '2026-09-30T12:20:00', 0.15)] })
  const pool = Math.min(0.5, SUPPLY_RUNS_PER_DAY * MEAN_0929)
  check('🔴 08:15 를 건너뛴 날 12:15 는 기본 몫보다 더 받는다(이월) — 오늘 정기 몫 전체/남은 5슬롯',
    (g.s1215 ?? 0) > MEAN_0929 && (g.s1215 ?? 0) >= pool / 5 - STEP - 1e-9 && (g.s1215 ?? 0) <= pool / 5 + 1e-9,
    `${fmt(g)} pool/5=${(pool / 5).toFixed(4)}`)
  const g3 = simulate({ daily: 0.3, history: null, events: [S('s1215', '2026-09-30T12:20:00', 10)] })
  check('🔴 축소 중 이월 — 08:15 를 건너뛰면 12:15 의 몫이 여력/6 → 여력/5 로 오른다',
    (g3.s1215 ?? 0) > 0.3 / 6 + STEP && (g3.s1215 ?? 0) <= 0.3 / 5 + 1e-9, fmt(g3))
  const under = simulate({ daily: 0.5, history: HIST_0929, events: [
    S('s0815', '2026-09-30T08:20:00', 0.02), S('s1215', '2026-09-30T12:20:00', 0.2), M('m1300', '2026-09-30T13:00:00'),
  ] })
  check('🔴 08:15 가 덜 쓴 몫이 뒤 5슬롯으로 똑같이 이월된다 — 12:15 = (전체 − 0.02)/5',
    (under.s1215 ?? 0) >= (pool - 0.02) / 5 - STEP - 1e-9, `${fmt(under)} want=${((pool - 0.02) / 5).toFixed(4)}`)
  check('🔴 이월된 몫은 손 실행으로 가지 않는다 — 13:00 손 실행은 천장 − 전체 정기 몫 이상을 못 쓴다',
    (under.m1300 ?? 0) <= Math.max(0, 0.5 - pool) + 1e-9, fmt(under))
  // 🔴 앞 정기 회차가 몫을 넘겨 쓴 것(손 실행 몫에서 먼저 온 것)은 뒤 슬롯 몫을 줄이지 않는다
  const lowShare = 0.05
  const pre = [line({ usd: 0.2, kind: 'scheduled', slot: '2026-09-30 08:15', at: '2026-09-30T08:20:00' })]
  const after = supplySpendProtectAt({ env: {}, now: kst('2026-09-30T11:00:00'), todayEntries: pre, shareUsd: lowShare, dailyUsd: 0.5 })
  check('🔴 08:15 가 자기 몫(0.05)을 넘어 0.2 를 썼어도 뒤 5슬롯은 각 0.05 를 그대로 받는다',
    after.allocation.slots.length === 5 && after.allocation.slots.every((x) => Math.abs(x.claimUsd - lowShare) < 1e-12),
    after.allocation.slots.map((x) => x.claimUsd.toFixed(4)).join(','))
}
{
  // ⓓ 🔴 손 실행이 도는 슬롯의 몫을 먹지 못한다 — 12:15 창 안(12:20)의 손 실행
  const sh: Record<string, number> = {}
  const g = simulate({ daily: 0.5, history: HIST_0929, events: [
    S('s0815', '2026-09-30T08:20:00', DEMAND.s0815), M('m1220', '2026-09-30T12:20:00'), S('s1215', '2026-09-30T12:25:00', 10),
  ] }, sh)
  check('🔴 12:20 손 실행 뒤에도 12:15 정기 회차는 자기 몫 전부를 쓴다',
    (g.s1215 ?? 0) >= (sh.s1215 ?? 1) - STEP - 1e-9, `${fmt(g)} share=${sh.s1215}`)
  // ⓔ 🔴 늦게 뜬 launchd 회차(13:30)는 손 실행 — 14:15 몫을 먹지 못한다
  const sh2: Record<string, number> = {}
  const late = simulate({ daily: 0.5, history: HIST_0929, events: [
    S('s0815', '2026-09-30T08:20:00', DEMAND.s0815),
    { name: 'late1330', at: '2026-09-30T13:30:00', env: LABEL, demand: 10 },
    S('s1415', '2026-09-30T14:20:00', 10),
  ] }, sh2)
  check('🔴 늦은 launchd 회차 뒤에도 14:15 는 자기 몫 전부', (late.s1415 ?? 0) >= (sh2.s1415 ?? 1) - STEP - 1e-9,
    `${fmt(late)} share=${sh2.s1415}`)
  const d = supplySpendProtectAt({
    env: LABEL, now: kst('2026-09-30T13:30:00'), historyEntries: HIST_0929, dailyUsd: 0.5,
    todayEntries: [line({ usd: DEMAND.s0815, kind: 'scheduled', slot: '2026-09-30 08:15', at: '2026-09-30T08:20:00' })],
  })
  const poolD = Math.min(0.5, SUPPLY_RUNS_PER_DAY * MEAN_0929)
  check('🔴 늦은 launchd 회차의 떼어 둘 몫 = 오늘 정기 몫 전체 − 08:15 가 쓴 것 (안 돈 12:15 몫까지 남은 4슬롯으로 이월)',
    d.kind === 'manual' && Math.abs(d.protect.reservedForOthersUsd - (poolD - DEMAND.s0815)) < 1e-12,
    `${d.protect.reservedForOthersUsd} vs ${poolD - DEMAND.s0815}`)
}
{
  // ⓕ 🔴 열린 예약(미정산) — 다른 실행이 보낸 요청의 예약도 배분 기준에서 뺀다
  const openManual = [line({ usd: 0.03, kind: 'manual', slot: null, status: 'reserved', at: '2026-09-30T08:10:00' })]
  const a = allowanceOf(LABEL, '2026-09-30T08:20:00', openManual, 0.3, null)
  check('🔴 손 실행의 열린 예약 0.03 이 있으면 08:15 폭 = (0.30 − 0.03)/6 — 남은 슬롯이 똑같이 나눠 진다',
    Math.abs(a - 0.27 / 6) < 1e-9, `a=${a}`)
  const openOwn = [line({ usd: 0.02, kind: 'scheduled', slot: '2026-09-30 08:15', status: 'reserved', at: '2026-09-30T08:20:00' })]
  const own = allowanceOf(LABEL, '2026-09-30T08:21:00', openOwn, 0.3, null)
  check('🔴 08:15 자기 열린 예약 0.02 는 자기 몫에서 빠진다 — 남은 폭 0.05 − 0.02',
    Math.abs(own - 0.03) < 1e-9, `own=${own}`)
  const man = allowanceOf({}, '2026-09-30T08:30:00', openOwn, 0.3, null)
  check('🔴 같은 때 손 실행은 0 — 08:15 의 남은 몫까지 떼어 둔다', man <= 1e-12, `man=${man}`)
  const al = allocateScheduledReserve({
    pending: pendingSlotsAt(kst('2026-09-30T08:21:00')), ended: [], shareUsd: CAPRUN, capUsd: 0.3, todayEntries: openOwn, ownSlot: null,
  })
  check('배분 기준액 = 천장 − 남은 슬롯 밖 지출 (08:15 의 열린 예약은 빼지 않는다)', Math.abs(al.basisUsd - 0.3) < 1e-12)
}
{
  // ⓖ 🔴 KST 자정 — 어제 정기 회차의 표식은 오늘 슬롯 지출로 세지 않는다
  const yday = [line({ usd: 0.04, kind: 'scheduled', slot: '2026-09-29 22:15', at: '2026-09-29T22:20:00' })]
  const al = allocateScheduledReserve({
    pending: pendingSlotsAt(kst('2026-09-30T00:05:00')), ended: endedSlotsAt(kst('2026-09-30T00:05:00')),
    shareUsd: 0.05, capUsd: 0.5, todayEntries: yday, ownSlot: null,
  })
  check('🔴 00:05 — 새 날 6슬롯 · 어제 슬롯 지출은 오늘 슬롯 몫을 줄이지 않는다',
    al.slots.length === 6 && al.slots.every((s) => Math.abs(s.claimUsd - 0.05) < 1e-12 && s.label.startsWith('2026-09-30')),
    al.slots.map((s) => `${s.label}=${s.claimUsd}`).join(','))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 세션 — 🔴 실제 장부 파일 · 가짜 fetch 로 요청 수를 센다')
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
/**
 * 🔴 세션 시험의 슬롯 몫 — 요청 4건분으로 고정한다(비례 축소가 걸리지 않는 폭).
 *    실측·기본값 경로는 ⑥·⑦ 과 ⓓ(운영 경로 그대로)가 본다.
 */
const SH = 4 * perReq.usd
const protectOf = (env: Record<string, string | undefined>, shareUsd: number | undefined = SH) =>
  (t: Date, ctx: ProtectContext): ProtectDecision => supplySpendProtectAt({
    env, now: t, todayEntries: ctx.todayEntries, historyEntries: ctx.historyEntries, dailyUsd: ctx.dailyUsd, shareUsd,
  })
const blockedCodes = (dir: string, date: string): string[] => {
  try {
    return readFileSync(ledgerPathOf(dir, date), 'utf-8').split('\n').filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as LedgerEntry).filter((e) => e.status === 'blocked' && e.stage !== 'countTokens')
      .map((e) => e.blockCode ?? '')
  } catch { return [] }
}
/** 🔴 아무 정기 회차도 안 돈 날 — 끝난 슬롯 몫이 남은 슬롯으로 이월되므로 남은 몫 = 오늘 슬롯 전부 */
const reserveAt = (s: string): number => pendingSlotsAt(kst(s)).length > 0 ? SUPPLY_RUNS_PER_DAY * SH : 0

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
  {
    // 🔴 접은 장부(정산 줄이 이긴다)에서도 표식이 남아야 다음 날 실측이 된다
    const folded = readLedgerDay(ledgerPathOf(dir, '2026-09-28'))
    const paidOf = (runId: string): LedgerEntry[] => folded.ok
      ? folded.entries.filter((e) => e.runId === runId && e.stage !== 'countTokens') : []
    check('🔴 정기 회차의 예약·정산 줄에 runKind=scheduled · runSlot=슬롯 이 남는다(접은 뒤에도)',
      paidOf('S').length === 3 && paidOf('S').every((e) => e.status === 'settled' && e.runKind === 'scheduled' && e.runSlot === '2026-09-28 12:15'))
    check('🔴 손 실행 줄은 runKind=manual · runSlot=null (막힌 줄 포함)',
      paidOf('M').length > 0 && paidOf('M').every((e) => e.runKind === 'manual' && e.runSlot === null))
  }
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
  const lim: BudgetLimits = { dailyUsd: 3 * SH, runRequestCap: 1000, headroomMultiplier: HEAD }
  const before = await runCalls(new SupplyLlmSession({ runId: 'L0', dir, limits: lim, now: at('2026-09-28T22:59:00'), protectAt: protectOf({}) }), 1)
  const after = await runCalls(new SupplyLlmSession({ runId: 'L1', dir, limits: lim, now: at('2026-09-28T23:00:00'), protectAt: protectOf({}) }), 1)
  check('🔴 22:59 손 실행 — 하루 종일 아무 정기 회차도 안 돌았으면 그 몫(여력 3몫 전부)이 22:15 로 이월돼 막힌다', before === 0)
  const tight: BudgetLimits = { dailyUsd: SH + 0.5 * perReq.usd, runRequestCap: 1000, headroomMultiplier: HEAD }
  const d2 = mkdtempSync(join(tmpdir(), 'reserve-c2-'))
  const b = await runCalls(new SupplyLlmSession({ runId: 'L2', dir: d2, limits: tight, now: at('2026-09-28T22:59:59'), protectAt: protectOf({}) }), 1)
  const a = await runCalls(new SupplyLlmSession({ runId: 'L3', dir: d2, limits: tight, now: at('2026-09-28T23:00:00'), protectAt: protectOf({}) }), 1)
  check('🔴 22:59:59 손 실행 — 몫 1개에 막힌다', b === 0)
  check('🔴 23:00 손 실행 — 마지막 창이 끝나 몫이 풀려 통과한다', a === 1)
  check('09-28 장부의 막힌 줄은 22:59:59 한 건뿐이다', blockedCodes(d2, '2026-09-28').length === 1)
  const mid = await runCalls(new SupplyLlmSession({ runId: 'L4', dir: d2, limits: tight, now: at('2026-09-29T00:00:00'), protectAt: protectOf({}) }), 1)
  check('🔴 00:00 손 실행 — 새 날 장부는 비었지만 새 날 몫 6개가 다시 잡혀 막힌다',
    mid === 0 && blockedCodes(d2, '2026-09-29').includes('SCHEDULED_RESERVE'))
  /**
   * 🔴 (2차) 다음 날 08:20 정기 회차는 **하루 여력의 1/6** 만 쓴다 — 여력(몫 1개 + 반 건)이 6슬롯 몫보다 작아
   *    비례 축소가 걸린다. 요청 1건이 그 폭보다 크면 `SCHEDULED_RESERVE` 로 막힌다(뒤 5슬롯 몫을 지킨다).
   *    같은 여력이라도 마지막 슬롯(22:20)이면 뒤 슬롯이 없어 돈다.
   */
  const d3 = mkdtempSync(join(tmpdir(), 'reserve-c3-'))
  check('🔴 다음 날 08:20 정기 회차 — 여력/6 < 요청 1건이면 뒤 슬롯 몫을 지키려 막힌다',
    await runCalls(new SupplyLlmSession({ runId: 'L5', dir: d3, limits: tight, now: at('2026-09-29T08:20:00'), protectAt: protectOf(LABEL) }), 1) === 0
    && blockedCodes(d3, '2026-09-29').includes('SCHEDULED_RESERVE'))
  check('같은 여력으로 마지막 슬롯(22:20) 정기 회차는 돈다',
    await runCalls(new SupplyLlmSession({ runId: 'L6', dir: d3, limits: tight, now: at('2026-09-29T22:20:00'), protectAt: protectOf(LABEL) }), 1) === 1)
  rmSync(d3, { recursive: true, force: true })
  check('after(23:00) 통과 — 마지막 창이 끝나 이월 몫도 풀린다', after === 1)
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
    /**
     * 🔴 (2차) 운영 경로 그대로 — 임시 HOME 장부에는 정기 실측이 없으므로 몫은 보수 기본값(회차 상한)이다.
     *    여력 = 요청 6건분. 12:20 정기 회차는 남은 5슬롯이 나눠 1.2건분 → 1건은 나간다.
     */
    const lim: BudgetLimits = { dailyUsd: 6 * perReq.usd, runRequestCap: 1000, headroomMultiplier: HEAD }
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
    const viaEnv = supplyProtectFromEnv({ ...LABEL, SORAN_RUN_AT: '2026-09-27T23:20:00.000Z' })(kst('2026-09-28T11:13:00'),
      { todayEntries: [], historyEntries: null, dailyUsd: 0.5 })
    check('🔴 운영 보호 판정(supplyProtectFromEnv)은 SORAN_RUN_AT=08:20 을 적어도 11:13 을 본다 — 손 실행',
      viaEnv.kind === 'manual' && viaEnv.protect !== null)
    SUPPLY_PROTECT_TEST_SEAM.clock = () => kst('2026-09-28T12:20:00')
    process.env[LAUNCHD_LABEL_ENV] = SUPPLY_PROCESS_LAUNCHD_LABEL
    const s5 = new SupplyLlmSession({ runId: 'F5', limits: lim, now: () => kst('2026-09-28T12:20:00') })
    await runCalls(s5, 1)
    check('🔴 운영 경로 — 표본 없음 → 보수 기본값 · 판정 사유에 그 사실이 적힌다',
      /보수 기본값/.test(s5.describe()), s5.describe())
    delete process.env[LAUNCHD_LABEL_ENV]
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
  const protectAt = src.indexOf('this.protectAt(startedAt, {')
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
