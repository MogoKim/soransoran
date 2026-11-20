#!/usr/bin/env tsx
/**
 * 정기 공급 회차 몫 보호 검사 — 🔴 **네트워크 0 · 실제 provider 0 · 운영 env·장부 0 · DB 0**
 *
 * 🔴 **재현하는 사고 (2026-09-28 실측).** 손 실행 17번이 하루 예산을 먼저 썼고,
 *    그 뒤 정기 회차는 `DAILY_EXHAUSTED` 77건으로 초안 0건이었다.
 *
 * 🔴 **확인하는 것**
 *    ① 정본 상수(천장 · 회차 창 · 라벨)와 라벨이 launchd 에서 자식 프로세스까지 가는 길
 *    ② 정기/손 실행 구별은 launchd 라벨 + 벽시계 창으로만 한다 — 인자·다른 env·다른 job 라벨로 못 바꾼다
 *    ③ 남은 회차 — 지금 도는 회차 포함 · 끝난 회차 제외 · 마지막 창 뒤 0 · KST 자정에 새 날 회차가 다시 잡힌다
 *    ④ 판정 — 손 실행은 남은 회차 몫을 남기고 쓴다 · 열린 예약(미정산)도 여력에서 뺀다 · 장부를 못 읽으면
 *       `LEDGER_ERROR` · 손 실행이 env 로 하루 예산을 올려도 계약 천장을 넘지 못한다
 *    ⑤ 배분의 사고 재현 — 하루를 요청 단위로 돌린다(실제 판정 `supplySpendProtectAt` → `judgeSpend`):
 *       손 실행이 먼저 와도 마지막 회차까지 돈다 · 몫을 넘는 요청은 `SCHEDULED_RESERVE` · 열린 예약 ·
 *       덜 쓴 몫이 뒤 회차로 · 손 실행 지출이 몫을 줄이되 음수가 되지 않는다
 *    ⑥ 세션 — 실제 장부 파일과 가짜 fetch 로 유료 요청 수를 센다: 사고 재현 · 재시도 · 열린 예약 ·
 *       공급 장부에서는 호출부가 보호를 끄지 못한다 · 사람이 마감한 줄(실제 `supply:ledger-resolve`)의 회차 표식 ·
 *       잠에서 깬 · 창 전에 뜬 회차는 손 실행이다(회차 시작 시각도 같은 창)
 *    ⑦ 별도 장부로 새 예산을 여는 길 — 창 밖에서 뜬 launchd 회차의 호출 전 차단 · `$HOME` 바꾸기 ·
 *       오늘 파일 없음 · 적용 한도·env 출처 기록 · env 덮어쓰기도 승인 천장 안에 머무는지
 *
 * 🔴 **시각은 손으로 적지 않는다.** 회차 시각은 전부 `SUPPLY_RUN_SLOTS_KST` 에서 계산한다(`slotAt` · `gapAfter`).
 *    바퀴 표가 바뀌어 이 검사의 전제(회차 사이 빈 틈 등)가 깨지면 ① 의 "fixture 전제" 가 먼저 FAIL 한다.
 *    배분 식 자체(천장 ÷ 회차 수 · 회차 수가 달라도 같은 식)는 `supply-cycle-check` ④ 가 잰다.
 *
 * 🔴 **확인하지 못하는 것** — 실제 launchd 가 이 라벨을 넣는지는 이 검사가 띄운 프로세스로 증명하지 못한다.
 *    근거는 수집 기록(같은 `judgeTrigger` 규칙으로 `schedule` 522건)이고, 운영 적용 뒤 장부의
 *    `SCHEDULED_RESERVE`·정기 회차 유료 건수로 다시 본다.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  judgeSpend, tallyOf, type BudgetLimits, type DayTally, type LedgerEntry, type SpendProtect,
} from '../src/lib/llm-ledger'
import { reserveOf } from '../src/lib/llm-pricing'
import { SUPPLY_RUN_WINDOW_MS } from '../src/lib/supply-process'
import { SUPPLY_RUN_SLOTS_KST } from '../src/lib/supply-schedule-contract'
import { supplyApprovedDailyUsdOf } from '../src/lib/supply-cost-envelope'
import {
  LAUNCHD_LABEL_ENV, SCHEDULED_COST_LOOKBACK_DAYS, SCHEDULED_RUN_WINDOW_MS, SUPPLY_PROCESS_LAUNCHD_LABEL,
  activeSlotAt, allocateScheduledReserve, missingTodayLedgerVerdict, pendingSlotsAt,
  supplyRunKindOf, supplySpendProtectAt,
} from '../src/lib/supply-scheduled-reserve'
import {
  BUDGET_ENV, REAL_LEDGER_IO, SUPPLY_LEDGER_ISOLATION_MARK, SUPPLY_PROTECT_TEST_SEAM, SupplyLlmSession,
  budgetEnvProvenance, ledgerIsolationActive, runStartedAtOf, supplyProtectFromEnv,
  type LedgerIo, type ProtectContext, type ProtectDecision,
} from './lib/supply-llm-call.mjs'
import {
  appendLedgerLine, canonicalLedgerDir, defaultLedgerDir, ledgerDirForHome, ledgerPathOf, readLedgerDay,
  readOpenReservations, realDirOf, sameRealDir, supplyLedgerDirError,
} from './lib/llm-ledger-store.mjs'

let pass = 0
let fail = 0
const check = (n: string, ok: boolean, extra = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${n}`) }
  else { fail += 1; console.log(`  🔴 FAIL ${n}${extra === '' ? '' : `\n     ${extra}`}`) }
}
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9

/** KST 시각 → Date. 회차와 무관한 벽시계 사실(자정 · UTC 자정)에만 쓴다 */
const kst = (s: string): Date => new Date(`${s}+09:00`)
const LABEL = { [LAUNCHD_LABEL_ENV]: SUPPLY_PROCESS_LAUNCHD_LABEL }

// ── 회차 시각 — 🔴 전부 정본 시각표에서 계산한다 ──
const SLOT_MIN = SUPPLY_RUN_SLOTS_KST.map((s) => s.hour * 60 + s.minute)
const N = SLOT_MIN.length
const WINDOW_MIN = SUPPLY_RUN_WINDOW_MS / 60_000
const LAST = N - 1
/** 하루 가운데 회차와 그 앞·뒤 회차 — "앞 회차는 끝났고 뒤 회차는 남은" 장면에 쓴다 */
const MID = Math.floor(N / 2)
const PREV = MID - 1
const NEXT = MID + 1
/** KST 날짜 `date` 의 자정에서 `minute` 분 `second` 초 뒤 */
const atMin = (date: string, minute: number, second = 0): Date =>
  new Date(Date.parse(`${date}T00:00:00.000+09:00`) + minute * 60_000 + second * 1000)
/** `i` 번째 회차 시각에서 `offsetMin` 분 뒤(음수면 앞) */
const slotAt = (date: string, i: number, offsetMin = 0, second = 0): Date => atMin(date, SLOT_MIN[i]! + offsetMin, second)
const two = (x: number): string => String(x).padStart(2, '0')
/** 장부 `runSlot` 에 적히는 회차 이름 */
const slotLabel = (date: string, i: number): string => `${date} ${two(Math.floor(SLOT_MIN[i]! / 60))}:${two(SLOT_MIN[i]! % 60)}`
/** `i` 번째 회차 창이 끝나는 순간(창 밖의 첫 순간) */
const windowEnd = (date: string, i: number): Date => slotAt(date, i, WINDOW_MIN)
/** `i` 번째 회차 창이 끝난 1분 뒤 — 다음 회차 전의 빈 틈(전제는 ① 이 확인한다) */
const gapAfter = (date: string, i: number): Date => slotAt(date, i, WINDOW_MIN + 1)
/** 그날 마지막 회차 창이 끝난 순간 — 남은 회차 0 */
const afterLast = (date: string): Date => windowEnd(date, LAST)
const hasGapAfter = (i: number): boolean => SLOT_MIN[i]! + WINDOW_MIN + 1 < (i === LAST ? 24 * 60 : SLOT_MIN[i + 1]!)
/** 사고가 난 날 */
const D = '2026-09-28'
const D_NEXT = '2026-09-29'
/** 합성 장부 줄 번호 — `line()` 이 쓴다 */
let lineSeq = 0
/** 장부 한 줄 — 🔴 실행 종류·회차 표식을 싣는다. 금액 외에는 아무것도 담지 않는다 */
function line(o: {
  usd: number; kind?: 'scheduled' | 'manual' | null; slot?: string | null
  status?: LedgerEntry['status']; at?: Date
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
    startedAt: (o.at ?? atMin(D, 12 * 60)).toISOString(), endedAt: null, errorCode: null,
    ...(o.kind === undefined ? {} : { runKind: o.kind }),
    ...(o.slot === undefined ? {} : { runSlot: o.slot }),
  }
}

console.log('\n══ 정기 공급 회차 몫 보호 검사 (🔴 네트워크 0 · 실제 provider 0) ══\n')

// ─────────────────────────────────────────────────────────
console.log('① 정본 상수 · 라벨이 자식까지 가는 길')
// ─────────────────────────────────────────────────────────
check('fixture 전제 — 회차 5개 이상 · 가운데 두 회차 뒤에 빈 틈 · 그 회차 5분 전이 앞 창 밖 · 첫 회차가 자정 뒤 · 마지막 창이 자정 전에 끝난다',
  N >= 5 && [PREV, MID].every((i) => hasGapAfter(i)
    && activeSlotAt(slotAt(D, i, -5)) === null && activeSlotAt(windowEnd(D, i)) === null && activeSlotAt(gapAfter(D, i)) === null)
  && SLOT_MIN[0]! >= 1 && SLOT_MIN[LAST]! + WINDOW_MIN < 24 * 60 && SLOT_MIN.every((m, i) => i === 0 || m > SLOT_MIN[i - 1]!),
  SLOT_MIN.map((m) => `${two(Math.floor(m / 60))}:${two(m % 60)}`).join(' '))
{
  // 🔴 공급 러너 천장은 요청 시각 **KST 날짜**의 계약이다. 결정기만 새 천장이고 공급이 옛 천장이면 그날 돈이 모자란다
  const eve = supplySpendProtectAt({ env: {}, now: kst('2026-11-16T23:59:30'), dailyUsd: 1.8 })
  const midnight = supplySpendProtectAt({ env: {}, now: kst('2026-11-17T00:00:30'), dailyUsd: 1.8 })
  // KST 08:59 는 UTC 로 아직 전날이다
  const utcEve = supplySpendProtectAt({ env: {}, now: kst('2026-11-17T08:59:30'), dailyUsd: 1.8 })
  check('🔴 공급 천장 — 11-16 23:59 $1.20 · 11-17 KST 자정 직후 $1.80 · 11-17 08:59(UTC 로는 전날) $1.80',
    eve.protect.ceilingUsd === 1.2 && midnight.protect.ceilingUsd === 1.8 && utcEve.protect.ceilingUsd === 1.8,
    `${eve.protect.ceilingUsd} · ${midnight.protect.ceilingUsd} · ${utcEve.protect.ceilingUsd}`)
  check('🔴 정본 함수 — 시행일 전(09-28) $1.20 · 11-05 $1.20 · 11-16 $1.20 · 11-17 $1.80 · 모양 오류 null',
    supplyApprovedDailyUsdOf('2026-09-28') === 1.2 && supplyApprovedDailyUsdOf('2026-11-05') === 1.2
    && supplyApprovedDailyUsdOf('2026-11-16') === 1.2 && supplyApprovedDailyUsdOf('2026-11-17') === 1.8
    && supplyApprovedDailyUsdOf('2026-11-17T00:00') === null && supplyApprovedDailyUsdOf('x') === null)
}
check('오늘 장부가 없을 때 돌아보는 기간이 이름 붙은 상수다(7일)', SCHEDULED_COST_LOOKBACK_DAYS === 7)
check('회차 창 = 공급 회차 정상 수명(SUPPLY_RUN_WINDOW_MS · 45분) — 잠금 시효가 아니다(잠금은 커널 lease)',
  SCHEDULED_RUN_WINDOW_MS === SUPPLY_RUN_WINDOW_MS && SUPPLY_RUN_WINDOW_MS === 45 * 60_000)
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
    // 자식은 `npx` 가 아니라 같은 Node · loader 로 직접 띄운다(`stageSpawnOf`) — env 는 그대로 물려준다
    /const how = stageSpawnOf\(script, args, STAGE_LEASE\)\s*\n\s*const p = spawn\(how\.command, how\.args, \{[\s\S]{0,200}env:\s*\{\s*\.\.\.process\.env/.test(proc))
  const tpl = readFileSync('docs/operations/launchd/com.soransoran.supply-process.plist.template', 'utf-8')
  check('🔴 템플릿이 라벨 env 를 손으로 넣지 않는다 — launchd 가 넣는 값만 믿는다',
    !tpl.includes(LAUNCHD_LABEL_ENV))
}

// ─────────────────────────────────────────────────────────
console.log('\n② 정기/손 실행 구별 — 🔴 라벨 + 벽시계 창')
// ─────────────────────────────────────────────────────────
{
  const inWindow = slotAt(D, MID, 5)
  const outside = gapAfter(D, MID)
  check('🔴 표식이 없으면 손 실행이다(fail-closed)', supplyRunKindOf({}, inWindow).kind === 'manual')
  check('🔴 다른 soransoran job 라벨은 정기 공급이 아니다',
    supplyRunKindOf({ [LAUNCHD_LABEL_ENV]: 'com.soransoran.persona-comment-runner' }, inWindow).kind === 'manual')
  check('🔴 라벨 접두만 같은 값은 정기가 아니다',
    supplyRunKindOf({ [LAUNCHD_LABEL_ENV]: `${SUPPLY_PROCESS_LAUNCHD_LABEL}-manual` }, inWindow).kind === 'manual')
  check('🔴 터미널 라벨(application.*)은 손 실행이다',
    supplyRunKindOf({ [LAUNCHD_LABEL_ENV]: 'application.com.apple.Terminal.1' }, inWindow).kind === 'manual')
  check('🔴 호출자가 적을 수 있는 칸(SORAN_* · --trigger 모양)으로 정기가 되지 않는다',
    supplyRunKindOf({ SORAN_SUPPLY_RUN_KIND: 'scheduled', SORAN_TRIGGER: 'schedule', SORAN_RUN_AT: inWindow.toISOString() },
      inWindow).kind === 'manual')
  check('공급 job 라벨 + 회차 창 안 → 정기 · 회차 이름을 돌려준다',
    supplyRunKindOf(LABEL, inWindow).kind === 'scheduled' && supplyRunKindOf(LABEL, inWindow).slot === slotLabel(D, MID))
  check('🔴 늦게 뜬 launchd 회차(회차를 놓치고 창이 끝난 뒤에 깸)는 손 실행이다 — 회차 이름 없음',
    supplyRunKindOf(LABEL, outside).kind === 'manual' && supplyRunKindOf(LABEL, outside).slot === null)
  check('공급 job 라벨 + 회차 시각 정각 → 정기', supplyRunKindOf(LABEL, slotAt(D, NEXT)).kind === 'scheduled')
  check('🔴 하루 첫 회차와 마지막 회차도 같은 자격의 정기 회차다 — 회차 사이에 등급이 없다',
    supplyRunKindOf(LABEL, slotAt(D, 0, 5)).slot === slotLabel(D, 0)
    && supplyRunKindOf(LABEL, slotAt(D, LAST, 5)).slot === slotLabel(D, LAST))
  check('🔴 공급 job 라벨이어도 회차 시각 전(창 밖 kickstart)은 손 실행이다',
    supplyRunKindOf(LABEL, slotAt(D, MID, -5)).kind === 'manual')
  check('🔴 창 끝(회차 시각 + 창 길이) 정각은 창 밖이다 · 1초 전은 창 안이다',
    supplyRunKindOf(LABEL, windowEnd(D, MID)).kind === 'manual'
    && supplyRunKindOf(LABEL, slotAt(D, MID, WINDOW_MIN - 1, 59)).kind === 'scheduled')
  check('🔴 보호 판정은 SORAN_RUN_AT 을 시각으로 쓰지 않는다 — 손 실행이 창 안 시각을 적어 넣어도 벽시계(창 밖)를 본다',
    supplySpendProtectAt({ env: { ...LABEL, SORAN_RUN_AT: inWindow.toISOString() }, now: outside }).kind === 'manual')
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 남은 회차 — 🔴 지금 도는 회차 포함 · 끝난 회차 제외 · KST 자정 경계')
// ─────────────────────────────────────────────────────────
const n = (t: Date): number => pendingSlotsAt(t).length
check(`자정 직후 — 그날 회차 전부(${N}개)`, n(kst(`${D}T00:00:01`)) === N)
check('🔴 회차가 도는 중이면 그 회차도 남은 회차다 — 도는 회차의 몫도 지킨다 (회차마다)',
  SLOT_MIN.every((_, i) => n(slotAt(D, i, 5)) === N - i), SLOT_MIN.map((_, i) => n(slotAt(D, i, 5))).join(','))
check('회차 창이 끝나면 그 회차는 빠진다 (회차마다)',
  SLOT_MIN.every((_, i) => n(windowEnd(D, i)) === N - i - 1), SLOT_MIN.map((_, i) => n(windowEnd(D, i))).join(','))
check('🔴 마지막 회차 창의 마지막 1초 — 1개', n(slotAt(D, LAST, WINDOW_MIN - 1, 59)) === 1)
check('🔴 마지막 회차 창이 끝나면 0개 — 몫이 풀린다', n(afterLast(D)) === 0)
check('23:59:59 — 0개', n(kst(`${D}T23:59:59`)) === 0)
check(`🔴 00:00(다음 날) — ${N}개. 새 날의 몫이 다시 잡힌다`,
  n(kst(`${D_NEXT}T00:00:00`)) === N && pendingSlotsAt(kst(`${D_NEXT}T00:00:00`)).every((w) => w.label.startsWith(D_NEXT)))
check('🔴 UTC 자정(09:00 KST)에 날이 바뀌지 않는다 — 08:59 와 09:01 이 같은 날 회차를 본다',
  pendingSlotsAt(kst(`${D}T08:59:00`)).slice(-1)[0]?.label === slotLabel(D, LAST)
  && pendingSlotsAt(kst(`${D}T09:01:00`)).slice(-1)[0]?.label === slotLabel(D, LAST))
{
  // 🔴 자정을 넘는 회차(가상의 23:50) — 그 창은 다음 날 장부에 들어간다
  const late = [{ hour: 23, minute: 50 }] as const
  const at0010 = kst(`${D_NEXT}T00:10:00`)
  const p = pendingSlotsAt(at0010, late)
  check('🔴 자정을 넘는 창은 다음 날에도 몫으로 남는다(어제 23:50 회차 + 오늘 23:50 회차)',
    p.length === 2 && p[0]?.label === `${D} 23:50`, p.map((x) => x.label).join(','))
  check('🔴 자정을 넘는 창 안의 정기 회차는 정기다', activeSlotAt(at0010, late)?.label === `${D} 23:50`)
}

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
  check('보호 없음 — 같은 요청이 통과한다', judge({ t: tally(0.2), usd: 0.06 }).ok)
  const c = judge({ t: tally(0.2, 0.03), usd: 0.04, p: P(0.25) })
  check('🔴 열린 예약(미정산)도 여력에서 뺀다 — 0.2 정산 + 0.03 열림이면 0.04 가 막힌다',
    !c.ok && c.code === 'SCHEDULED_RESERVE')
  const d = judge({ t: tally(0.48), usd: 0.04, p: P(0.25) })
  check('🔴 하루 총액이 모자라면 DAILY_EXHAUSTED 가 먼저다 — 양보와 소진을 가른다', !d.ok && d.code === 'DAILY_EXHAUSTED')
  const e = judge({ t: tally(0.45), usd: 0.06, p: P(0, 0.5), lim: { ...LIM, dailyUsd: 5 } })
  check('🔴 손 실행이 env 로 하루 예산을 5달러로 올려도 주어진 계약 천장 0.5 를 넘지 못한다',
    !e.ok && e.code === 'SCHEDULED_RESERVE')
  check('보호 없음(null)이면 env 예산만 본다',
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
/** 이 절과 ⑤ 의 하루 예산 — 그날 계약 천장($1.20)보다 작아 env 예산이 적용 한도다 */
const CAP = 0.5
{
  const prot = (env: Record<string, string>, now: Date, today: LedgerEntry[] = []) =>
    supplySpendProtectAt({ env, now, todayEntries: today, dailyUsd: CAP })
  /** 가운데 회차 창이 끝난 뒤 남은 회차 수 */
  const left = N - NEXT
  const mm = prot({}, gapAfter(D, MID))
  check(`손 실행(회차 사이 틈) — 남은 회차 ${left}개가 남은 예산을 똑같이 나누고, 손 실행은 그 전부를 남긴다 · 천장 = 계약 천장`,
    mm.kind === 'manual' && mm.allocation.slots.length === left && near(mm.allocation.shareUsd, CAP / left)
    && near(mm.protect.reservedForOthersUsd, CAP) && mm.protect.ceilingUsd === supplyApprovedDailyUsdOf(D),
    `${mm.protect.reservedForOthersUsd}`)
  const sc = prot(LABEL, slotAt(D, MID, 5))
  check('🔴 정기 회차 — 자기 회차 몫만 쓰고 뒤 회차들의 몫(남은 예산 − 자기 몫)을 남긴다',
    sc.kind === 'scheduled' && sc.slot === slotLabel(D, MID) && near(sc.protect.reservedForOthersUsd, CAP - CAP / (N - MID)),
    `${sc.protect.reservedForOthersUsd}`)
  const spentPrev = [line({ usd: 0.05, kind: 'scheduled', slot: slotLabel(D, PREV) })]
  const carry = prot({}, gapAfter(D, MID), spentPrev)
  check('끝난 회차가 쓴 금액만큼만 남은 회차가 나눌 예산이 준다 — 손 실행이 남기는 몫 = 하루 예산 − 그 금액',
    near(carry.protect.reservedForOthersUsd, CAP - 0.05) && near(carry.allocation.shareUsd, (CAP - 0.05) / left),
    `${carry.protect.reservedForOthersUsd}`)
  const released = prot({}, afterLast(D))
  check('🔴 손 실행 — 마지막 회차 창이 끝나면 남길 몫 0 (풀림)',
    released.protect.reservedForOthersUsd === 0 && released.allocation.slots.length === 0)
  check('🔴 천장 미승인(null)은 손 실행에게 0 이다',
    supplySpendProtectAt({ env: {}, now: afterLast(D), ceilingUsd: null }).protect.ceilingUsd === 0)
  check('천장 미승인(null)이면 정기 회차는 env 예산만 본다',
    supplySpendProtectAt({ env: LABEL, now: slotAt(D, LAST, 5), ceilingUsd: null, dailyUsd: 0.3 }).protect.ceilingUsd === null)
  check('마지막 회차의 정기 요청 — 뒤 회차가 없어 남길 몫 0', prot(LABEL, slotAt(D, LAST, 5)).protect.reservedForOthersUsd === 0)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 배분의 사고 재현 — 🔴 하루를 요청 단위로 돌린다(실제 판정을 지난다)')
// ─────────────────────────────────────────────────────────
const LIM_SIM = (daily: number): BudgetLimits => ({ dailyUsd: daily, runRequestCap: 1_000_000, headroomMultiplier: 1.2 })
/** 이 요청이 쓸 수 있는 폭 — `judgeSpend` 가 보는 값 그대로(적용 한도 − 쓴 것 − 열린 예약 − 남겨 둔 몫) */
function roomOf(env: Record<string, string>, now: Date, today: LedgerEntry[], daily = CAP): number {
  const d = supplySpendProtectAt({ env, now, todayEntries: today, dailyUsd: daily })
  const t = tallyOf(today)
  const cap = d.protect.ceilingUsd === null ? daily : Math.min(daily, d.protect.ceilingUsd)
  return cap - t.settledUsd - t.openReservedUsd - d.protect.reservedForOthersUsd
}
type Ev = { name: string; at: Date; env: Record<string, string>; demand: number }
/** 한 요청의 크기 — 공급 초안 1건 정도 */
const STEP = 0.004
/**
 * 🔴 **하루를 돌린다 — 요청마다 실제 판정(`supplySpendProtectAt` → `judgeSpend`)을 지난다.**
 *    통과하면 정산 줄을 남기고(표식 포함), 막히면 그 실행은 멈춘다(`stopped` 에 막힌 코드).
 *    `unprotected` 는 사고 당시처럼 몫 보호 없이 하루 예산만 보는 판정이다.
 */
function simulate(o: { daily: number; events: readonly Ev[]; prefill?: LedgerEntry[]; unprotected?: boolean }): {
  got: Record<string, number>; stopped: Record<string, string>; shareAtStart: Record<string, number>
} {
  const today: LedgerEntry[] = [...(o.prefill ?? [])]
  const got: Record<string, number> = {}
  const stopped: Record<string, string> = {}
  const shareAtStart: Record<string, number> = {}
  for (const ev of o.events) {
    let spent = 0
    for (;;) {
      const want = Math.min(STEP, ev.demand - spent)
      if (want <= 1e-12) break
      const d = supplySpendProtectAt({ env: ev.env, now: ev.at, todayEntries: today, dailyUsd: o.daily })
      if (shareAtStart[ev.name] === undefined) shareAtStart[ev.name] = d.allocation.shareUsd
      const v = judgeSpend({
        limits: LIM_SIM(o.daily), tally: tallyOf(today), runPaid: 0, reserve: R(want),
        ledgerOk: true, settleHold: null, unresolved: [], protect: o.unprotected === true ? null : d.protect,
      })
      if (!v.ok) { stopped[ev.name] = v.code; break }
      today.push(line({ usd: want, kind: d.kind, slot: d.slot, at: ev.at }))
      spent += want
    }
    got[ev.name] = spent
  }
  return { got, stopped, shareAtStart }
}
/** 요청을 끝없이 보내려는 실행 */
const GREEDY = 10
const sName = (i: number): string => `정기${two(i)}`
/**
 * 사고가 난 날의 모양 — 회차 사이 틈마다 손 실행이 전부 가져가려 하고, 정기 회차는 회차마다 `demand` 만큼 쓰려 한다.
 * 가운데 회차는 그 창 **안**에서 손 실행이 먼저 오고, 그 창이 끝난 뒤에는 늦게 뜬 launchd 회차(라벨은 공급 job)가 온다.
 */
const dayOf = (date: string, demand: number): Ev[] => {
  const day: Ev[] = [{ name: '손:첫 회차 전', at: kst(`${date}T00:00:30`), env: {}, demand: GREEDY }]
  SLOT_MIN.forEach((_, i) => {
    if (i === MID) day.push({ name: '손:도는 회차 창 안', at: slotAt(date, i, 5), env: {}, demand: GREEDY })
    day.push({ name: sName(i), at: slotAt(date, i, 10), env: LABEL, demand })
    if (i === MID) day.push({ name: '늦은 launchd', at: gapAfter(date, i), env: LABEL, demand: GREEDY })
    else if (i < LAST && hasGapAfter(i)) day.push({ name: `손:틈${two(i)}`, at: gapAfter(date, i), env: {}, demand: GREEDY })
  })
  day.push({ name: '끝:마지막 창 뒤 손 실행', at: afterLast(date), env: {}, demand: GREEDY })
  return day
}
const fmt = (g: Record<string, number>): string => Object.entries(g).map(([k, v]) => `${k}=${v.toFixed(4)}`).join(' ')
const sumOf = (g: Record<string, number>, prefix: string): number =>
  Object.entries(g).filter(([k]) => k.startsWith(prefix)).reduce((s, [, v]) => s + v, 0)
const SCHED = SLOT_MIN.map((_, i) => sName(i))
{
  // ⓐ 🔴 2026-09-28 재현 — 손 실행이 하루 예산을 먼저 쓰려 해도 마지막 회차까지 유료 요청이 나간다
  const bare = simulate({ daily: CAP, events: dayOf(D, GREEDY), unprotected: true })
  check('[사고 그대로] 몫 보호가 없으면 첫 손 실행이 하루 예산을 다 쓰고 정기 회차는 전부 DAILY_EXHAUSTED 로 0건이다',
    sumOf(bare.got, '정기') === 0 && (bare.got['손:첫 회차 전'] ?? 0) >= CAP - STEP - 1e-9
    && SCHED.every((k) => bare.stopped[k] === 'DAILY_EXHAUSTED'), fmt(bare.got))

  const r = simulate({ daily: CAP, events: dayOf(D, GREEDY) })
  console.log(`     09-28 모의($${CAP.toFixed(2)} · 회차 ${N}개 · 모두 끝없이 요청): ${fmt(r.got)}`)
  check('🔴 정기 회차마다 하루 예산 ÷ 회차 수에서 요청 1건 이상 잃지 않는다 — 마지막 회차까지 유료 요청이 나간다',
    SCHED.every((k) => (r.got[k] ?? 0) >= CAP / N - STEP - 1e-9) && (r.got[sName(LAST)] ?? 0) >= STEP, fmt(r.got))
  check('🔴 손 실행(첫 회차 전 · 틈마다 · 도는 회차 창 안)은 마지막 창이 끝나기 전에 한 건도 못 나간다 — SCHEDULED_RESERVE',
    sumOf(r.got, '손:') === 0
    && Object.keys(r.got).filter((k) => k.startsWith('손:')).every((k) => r.stopped[k] === 'SCHEDULED_RESERVE'),
    Object.entries(r.stopped).filter(([k]) => k.startsWith('손:')).map(([k, v]) => `${k}=${v}`).join(' '))
  check('🔴 늦게 뜬 launchd 회차(창 밖)는 손 실행이다 — 뒤 회차 몫을 먹지 못하고, 그 뒤 회차는 자기 몫을 다 쓴다',
    r.got['늦은 launchd'] === 0 && r.stopped['늦은 launchd'] === 'SCHEDULED_RESERVE'
    && (r.got[sName(NEXT)] ?? 0) >= (r.shareAtStart[sName(NEXT)] ?? 1) - STEP - 1e-9,
    `${fmt(r.got)} share=${r.shareAtStart[sName(NEXT)]}`)
  check('🔴 도는 회차 창 안에 손 실행이 먼저 와도 그 회차는 자기 몫에서 요청 1건 이상 잃지 않는다',
    (r.got[sName(MID)] ?? 0) >= (r.shareAtStart[sName(MID)] ?? 1) - STEP - 1e-9, `${r.got[sName(MID)]} share=${r.shareAtStart[sName(MID)]}`)
  const total = Object.values(r.got).reduce((s, x) => s + x, 0)
  check('하루 총액은 하루 예산 이하이고, 하루가 끝나면 요청 1건 미만만 남는다',
    total <= CAP + 1e-9 && total >= CAP - STEP - 1e-9, `total=${total}`)

  // ⓑ 🔴 앞 회차가 몫보다 많이 쓰려 하면 막힌다 — 뒤 회차 몫을 지킨다
  check('🔴 끝없이 요청하는 정기 회차는 그때의 회차 몫에서 멈춘다 — 몫을 넘지 않고, 막는 코드는 SCHEDULED_RESERVE 다',
    SCHED.slice(0, LAST).every((k) => (r.got[k] ?? 0) <= (r.shareAtStart[k] ?? 0) + 1e-9 && r.stopped[k] === 'SCHEDULED_RESERVE'),
    SCHED.map((k) => `${k}:${(r.got[k] ?? 0).toFixed(4)}/${(r.shareAtStart[k] ?? 0).toFixed(4)}/${r.stopped[k]}`).join(' '))
  const share0 = CAP / N
  const nearlyDone = [line({ usd: share0 - 1e-6, kind: 'scheduled', slot: slotLabel(D, 0) })]
  const tiny = roomOf(LABEL, slotAt(D, 0, 20), nearlyDone)
  const over = judgeSpend({
    limits: LIM_SIM(CAP), tally: tallyOf(nearlyDone), runPaid: 0, reserve: R(STEP), ledgerOk: true, settleHold: null, unresolved: [],
    protect: supplySpendProtectAt({ env: LABEL, now: slotAt(D, 0, 20), todayEntries: nearlyDone, dailyUsd: CAP }).protect,
  })
  check('🔴 첫 회차가 자기 몫을 거의 다 쓴 뒤 남은 폭은 그 차이뿐이다 — 소액 연속 요청으로 뒤 회차 몫을 잠식하지 못한다',
    near(tiny, 1e-6) && !over.ok && over.code === 'SCHEDULED_RESERVE', `tiny=${tiny}`)
}
{
  // ⓒ 🔴 열린 예약(미정산)도 쓴 것으로 센다 — 가운데 앞 회차가 도는 중이다
  const now = slotAt(D, PREV, 5)
  const k = N - PREV
  const own = slotLabel(D, PREV)
  const openManual = [line({ usd: 0.03, kind: 'manual', slot: null, status: 'reserved' })]
  check('🔴 손 실행의 열린 예약 0.03 — 남은 회차가 똑같이 나눠 진다: 회차 폭 = (하루 예산 − 0.03) ÷ 남은 회차',
    near(roomOf(LABEL, now, openManual), (CAP - 0.03) / k), `${roomOf(LABEL, now, openManual)}`)
  const openOwn = [line({ usd: 0.02, kind: 'scheduled', slot: own, status: 'reserved' })]
  check('🔴 자기 회차의 열린 예약 0.02 는 자기 몫에서만 빠진다 — 남은 폭 = 회차 몫 − 0.02',
    near(roomOf(LABEL, now, openOwn), CAP / k - 0.02), `${roomOf(LABEL, now, openOwn)}`)
  check('🔴 같은 때 손 실행의 폭은 0 — 도는 회차의 남은 몫까지 남긴다', near(roomOf({}, now, openOwn), 0), `${roomOf({}, now, openOwn)}`)
  const unknownEnded = [line({ usd: 0.04, kind: 'scheduled', slot: slotLabel(D, 0), status: 'usageUnknown' })]
  check('🔴 끝난 회차의 사용량 미상 0.04 도 쓴 것이다 — 회차 폭 = (하루 예산 − 0.04) ÷ 남은 회차',
    near(roomOf(LABEL, now, unknownEnded), (CAP - 0.04) / k), `${roomOf(LABEL, now, unknownEnded)}`)
  const blockedOnly = [line({ usd: 9, kind: 'manual', slot: null, status: 'blocked' })]
  check('막힌 요청 줄은 쓴 것이 아니다 — 회차 폭이 그대로다', near(roomOf(LABEL, now, blockedOnly), CAP / k))
}
{
  // ⓓ 🔴 끝난 회차가 덜 쓴 몫은 뒤 회차로 넘어간다 — 손 실행으로 가지 않는다
  const under = simulate({ daily: CAP, events: [
    { name: sName(0), at: slotAt(D, 0, 10), env: LABEL, demand: STEP },
    { name: '손:틈', at: gapAfter(D, PREV), env: {}, demand: GREEDY },
    { name: sName(MID), at: slotAt(D, MID, 10), env: LABEL, demand: GREEDY },
  ] })
  const want = (CAP - STEP) / (N - MID)
  check('🔴 첫 회차가 요청 1건만 쓰고 그 사이 회차들이 안 돈 날 — 가운데 회차 몫 = (하루 예산 − 그 1건) ÷ 남은 회차',
    near(under.shareAtStart[sName(MID)] ?? 0, want) && (under.got[sName(MID)] ?? 0) >= want - STEP - 1e-9
    && (under.got[sName(MID)] ?? 0) <= want + 1e-9 && want > CAP / N + STEP,
    `${fmt(under.got)} want=${want.toFixed(4)}`)
  check('🔴 넘어간 몫은 손 실행으로 가지 않는다 — 회차 사이 손 실행은 0', under.got['손:틈'] === 0, fmt(under.got))
  // 정기 회차가 필요한 만큼만 쓰는 보통 날 — 덜 쓴 것은 마지막 창이 끝난 뒤에야 손 실행에게 간다
  const modest = STEP * 6
  const calm = simulate({ daily: CAP, events: dayOf(D, modest) })
  check('정기 회차가 몫보다 적게 쓰는 날 — 회차마다 원하는 만큼 전부 쓰고, 손 실행은 마지막 창 뒤에만 남은 것을 쓴다',
    modest < CAP / N && SCHED.every((k) => near(calm.got[k] ?? 0, modest)) && sumOf(calm.got, '손:') === 0
    && (calm.got['끝:마지막 창 뒤 손 실행'] ?? 0) >= CAP - N * modest - STEP - 1e-9, fmt(calm.got))
}
{
  // ⓔ 🔴 손 실행이 이미 쓴 금액은 남은 회차 몫을 줄인다 — 음수가 되지는 않는다
  const now = slotAt(D, PREV, 5)
  const k = N - PREV
  const manualSpent = [line({ usd: 0.2, kind: 'manual', slot: null })]
  const a = supplySpendProtectAt({ env: LABEL, now, todayEntries: manualSpent, dailyUsd: CAP })
  check('🔴 손 실행 지출 0.2 — 남은 회차가 나눌 예산이 그만큼 준다: 회차 몫 = (하루 예산 − 0.2) ÷ 남은 회차',
    near(a.allocation.basisUsd, CAP - 0.2) && near(a.allocation.shareUsd, (CAP - 0.2) / k)
    && near(roomOf(LABEL, now, manualSpent), (CAP - 0.2) / k), `${a.allocation.shareUsd}`)
  const overspent = [line({ usd: CAP + 0.2, kind: 'manual', slot: null })]
  const b = supplySpendProtectAt({ env: LABEL, now, todayEntries: overspent, dailyUsd: CAP })
  const v = judgeSpend({
    limits: LIM_SIM(CAP), tally: tallyOf(overspent), runPaid: 0, reserve: R(STEP), ledgerOk: true, settleHold: null, unresolved: [],
    protect: b.protect,
  })
  check('🔴 손 실행 지출이 하루 예산을 넘은 장부 — 회차 몫 · 남길 몫이 0 에서 멈춘다(음수 아님) · 판정은 DAILY_EXHAUSTED',
    b.allocation.basisUsd === 0 && b.allocation.shareUsd === 0 && b.protect.reservedForOthersUsd === 0
    && b.allocation.slots.length === k && b.allocation.slots.every((s) => s.claimUsd === 0)
    && !v.ok && v.code === 'DAILY_EXHAUSTED', JSON.stringify(b.allocation.slots[0]))
  const badCap = allocateScheduledReserve({ pending: pendingSlotsAt(now), capUsd: Number.NaN, todayEntries: [], ownSlot: null })
  check('🔴 하루 예산을 읽지 못한 값(NaN)은 0 으로 본다 — 남길 몫이 NaN 이 되지 않는다',
    badCap.basisUsd === 0 && badCap.reservedForOthersUsd === 0)
}
{
  // ⓕ 🔴 회차 이름은 날짜까지 같아야 그 회차다 — 어제 같은 시각 회차의 줄은 오늘 그 회차가 쓴 것이 아니다
  const yday = [line({ usd: 0.04, kind: 'scheduled', slot: slotLabel(D, LAST) })]
  const al = allocateScheduledReserve({ pending: pendingSlotsAt(kst(`${D_NEXT}T00:05:00`)), capUsd: CAP, todayEntries: yday, ownSlot: null })
  check(`🔴 00:05 — 새 날 회차 ${N}개 · 어제 회차 이름의 지출은 오늘 어느 회차의 지출로도 세지 않는다(남은 회차 밖 지출로 나눌 예산에서만 빠진다)`,
    al.slots.length === N && al.slots.every((s) => s.spentUsd === 0 && near(s.claimUsd, (CAP - 0.04) / N) && s.label.startsWith(D_NEXT)),
    al.slots.map((s) => `${s.label}=${s.claimUsd}`).join(','))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 세션 — 🔴 실제 장부 파일 · 가짜 fetch 로 요청 수를 센다')
// ─────────────────────────────────────────────────────────
const realFetch = globalThis.fetch
let paidFetches = 0
let countFetches = 0
/** 경계 반례가 countTokens 응답 시각을 앞으로 옮길 때만 쓰는 시험 이음매. */
let afterCountFetch: (() => void) | null = null
const OUT_TOKENS = 1000
globalThis.fetch = (async (url: string | URL | Request) => {
  const u = String(url)
  if (u.includes('/count_tokens')) {
    countFetches += 1
    afterCountFetch?.()
    return new Response(JSON.stringify({ input_tokens: 100 }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  paidFetches += 1
  return new Response(JSON.stringify({
    content: [{ text: '"ok":true}' }], usage: { input_tokens: 100, output_tokens: OUT_TOKENS }, stop_reason: 'end_turn',
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}) as typeof globalThis.fetch
const prevKey = process.env.ANTHROPIC_API_KEY
process.env.ANTHROPIC_API_KEY = 'fixture-fake-key'
/**
 * 🔴 **시험 격리 표식** — 이 프로세스의 `fetch` 는 위에서 가짜로 바꿨다. 그래서 임시 HOME 장부를 공급 장부로
 *    써도 된다(운영 장부 0). 표식이 없으면 공급 세션은 정본(계정 홈)이 아닌 자리를 `LEDGER_ERROR` 로 막는다 — ⑦ 이 본다.
 */
const setIsolation = (on: boolean): void => {
  (globalThis as unknown as Record<symbol, unknown>)[SUPPLY_LEDGER_ISOLATION_MARK] = on
}
setIsolation(true)

const ASK = {
  stage: 'judge' as const, model: 'claude-haiku-4.5' as const,
  systemPrompt: 'sys', userPayload: '{}', maxOutputTokens: 1200, timeoutMs: 5_000,
}
const HEAD = 1.2
const perReq = reserveOf({ model: ASK.model, countedInputTokens: 100, maxOutputTokens: ASK.maxOutputTokens, headroomMultiplier: HEAD })
if (!perReq.known) throw new Error('예약액을 계산하지 못했다')
const at = (t: Date) => () => t
const limOf = (dailyUsd: number): BudgetLimits => ({ dailyUsd, runRequestCap: 1000, headroomMultiplier: HEAD })
const protectOf = (env: Record<string, string | undefined>) =>
  (t: Date, ctx: ProtectContext): ProtectDecision => supplySpendProtectAt({
    env, now: t, todayEntries: ctx.todayEntries, dailyUsd: ctx.dailyUsd,
  })
const blockedCodes = (dir: string, date: string): string[] => {
  try {
    return readFileSync(ledgerPathOf(dir, date), 'utf-8').split('\n').filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as LedgerEntry).filter((e) => e.status === 'blocked' && e.stage !== 'countTokens')
      .map((e) => e.blockCode ?? '')
  } catch { return [] }
}

async function runCalls(s: SupplyLlmSession, k: number, stage: typeof ASK.stage | 'judgeRetry' = 'judge'): Promise<number> {
  let ok = 0
  for (let i = 0; i < k; i += 1) {
    const r = await s.call({ ...ASK, stage })
    if (r.ok) ok += 1
  }
  return ok
}
/** 🔴 요청 1건의 정산액 — 가짜 응답(출력 1000 토큰)을 실제 세션에 한 번 지나게 해서 잰다. 예약액보다 작다 */
const settledPer = await (async (): Promise<number> => {
  const dir = mkdtempSync(join(tmpdir(), 'reserve-cal-'))
  const s = new SupplyLlmSession({ runId: 'CAL', dir, limits: limOf(1), now: at(slotAt(D, MID, 5)) })
  await s.call(ASK)
  rmSync(dir, { recursive: true, force: true })
  return s.tally.settledUsd
})()
if (!(settledPer > 0 && settledPer < perReq.usd)) throw new Error(`정산액을 재지 못했다 — ${settledPer}`)
/** 폭 `room` 안에서 차례로 나갈 수 있는 요청 수 — 요청마다 예약액이 폭에 들어가야 하고, 나간 뒤에는 정산액만큼 준다 */
const fits = (room: number): number => {
  let k = 0
  while (room - k * settledPer >= perReq.usd - 1e-12) k += 1
  return k
}
/** 🔴 세션 시험의 회차 몫 — 요청 3건은 나가고 4번째는 몫을 넘는 폭 */
const SH = 3.2 * perReq.usd
check('fixture 전제 — 회차 몫(예약 3.2건분) 안에서 요청이 1건 이상 · 5건 미만 나간다', fits(SH) >= 1 && fits(SH) < 5, `fits=${fits(SH)}`)
/** 가운데 회차 창이 끝난 뒤 남은 회차 수 — 그 틈의 손 실행과 다음 회차가 보는 값 */
const K_LEFT = N - NEXT

{
  // ⓐ 09-28 재현 — 손 실행이 먼저 와도 정기 회차가 마지막 회차까지 돈다
  const dir = mkdtempSync(join(tmpdir(), 'reserve-a-'))
  const lim = limOf(K_LEFT * SH)
  const before = paidFetches
  const manual = new SupplyLlmSession({ runId: 'M', dir, limits: lim, now: at(gapAfter(D, MID)), protectAt: protectOf({}) })
  const mOk = await runCalls(manual, 6)
  check('🔴 손 실행(회차 사이 틈 · 빈 장부) — 하루 예산이 전부 남은 회차 몫이라 한 건도 나가지 않는다 · fetch 0',
    mOk === 0 && paidFetches - before === 0, `ok=${mOk} paid=${paidFetches - before}`)
  const retry = await runCalls(manual, 2, 'judgeRetry')
  check('🔴 재시도(judgeRetry)도 같은 판정을 지난다 — 우회가 아니다', retry === 0 && paidFetches - before === 0)
  check('🔴 손 실행의 요청 8건이 모두 SCHEDULED_RESERVE 로 장부에 남는다(DAILY_EXHAUSTED 가 아니다)',
    blockedCodes(dir, D).length === 8 && blockedCodes(dir, D).every((c) => c === 'SCHEDULED_RESERVE'), blockedCodes(dir, D).join(','))
  const b2 = paidFetches
  const sched = new SupplyLlmSession({ runId: 'S', dir, limits: lim, now: at(slotAt(D, NEXT, 5)), protectAt: protectOf(LABEL) })
  const sOk = await runCalls(sched, 5)
  check('🔴 다음 정기 회차 — 손 실행 뒤에도 자기 몫만큼 돈다(몫 안의 요청 수 그대로)',
    sOk === fits(SH) && paidFetches - b2 === sOk, `ok=${sOk} fits=${fits(SH)}`)
  check('🔴 그 회차가 몫을 넘겨 보낸 요청은 SCHEDULED_RESERVE 로 막힌다 — 뒤 회차 몫을 지킨다',
    blockedCodes(dir, D).filter((c) => c === 'SCHEDULED_RESERVE').length === 8 + (5 - sOk) && blockedCodes(dir, D).length === 8 + (5 - sOk))
  check('세션이 실행 종류를 사람이 읽는 줄에 적는다', manual.describe().includes('손 실행') && sched.describe().includes('정기'))
  {
    // 🔴 접은 장부(정산 줄이 이긴다)에서도 표식이 남아야 그 회차가 쓴 것으로 센다
    const folded = readLedgerDay(ledgerPathOf(dir, D))
    const paidOf = (runId: string): LedgerEntry[] => folded.ok
      ? folded.entries.filter((e) => e.runId === runId && e.stage !== 'countTokens') : []
    check('🔴 정기 회차의 줄에 runKind=scheduled · runSlot=회차 이름이 남는다(접은 뒤에도 · 막힌 줄 포함)',
      paidOf('S').filter((e) => e.status === 'settled').length === sOk
      && paidOf('S').every((e) => e.runKind === 'scheduled' && e.runSlot === slotLabel(D, NEXT)))
    check('🔴 손 실행 줄은 runKind=manual · runSlot=null (막힌 줄 포함)',
      paidOf('M').length > 0 && paidOf('M').every((e) => e.runKind === 'manual' && e.runSlot === null))
  }
  const later: number[] = []
  for (let i = NEXT + 1; i <= LAST; i += 1) {
    later.push(await runCalls(new SupplyLlmSession({
      runId: `S${i}`, dir, limits: lim, now: at(slotAt(D, i, 5)), protectAt: protectOf(LABEL),
    }), 5))
  }
  check('🔴 그 뒤 회차도 전부 — 마지막 회차까지 — 자기 몫만큼 유료 요청이 나간다(앞 회차가 덜 쓴 만큼 몫은 줄지 않는다)',
    later.length === K_LEFT - 1 && later.every((ok) => ok >= fits(SH)), later.join(','))
  const day = readLedgerDay(ledgerPathOf(dir, D))
  const used = day.ok ? tallyOf(day.entries) : null
  check('하루 합계(정산 + 열린 예약)는 하루 예산 이하다',
    used !== null && used.settledUsd + used.openReservedUsd <= K_LEFT * SH + 1e-12, `${used?.settledUsd}`)
  rmSync(dir, { recursive: true, force: true })
}
{
  // ⓑ 🔴 열린 예약 — 같은 회차의 다른 프로세스가 보낸 요청이 아직 정산 전이어도 그 금액을 자기 몫에서 뺀다
  const dir = mkdtempSync(join(tmpdir(), 'reserve-b-'))
  const T = slotAt(D, NEXT, 5)
  const open = (o: { attemptId: string; usd: number; kind: 'scheduled' | 'manual'; slot: string | null }): LedgerEntry => ({
    runId: `${o.kind}-inflight`, stage: 'draftGen', attemptId: o.attemptId, requestNo: 0,
    provider: 'anthropic', apiModelId: 'x', model: 'claude-haiku-4.5', status: 'reserved', blockCode: null,
    countedInputTokens: 100, maxOutputTokens: 1200, reservedUsd: o.usd,
    inputTokens: null, outputTokens: null, cacheWriteTokens: null, cacheReadTokens: null, usageKeys: [],
    settledUsd: null, pricingVersion: null, startedAt: T.toISOString(), endedAt: null, errorCode: null,
    runKind: o.kind, runSlot: o.slot,
  })
  appendLedgerLine(ledgerPathOf(dir, D), open({ attemptId: 'open-own', usd: 2 * perReq.usd, kind: 'scheduled', slot: slotLabel(D, NEXT) }))
  const s = new SupplyLlmSession({ runId: 'S-OWN', dir, limits: limOf(K_LEFT * SH), now: at(T), protectAt: protectOf(LABEL) })
  const ok = await runCalls(s, 5)
  check('🔴 자기 회차의 열린 예약 2건분 — 남은 폭이 그만큼 준다(몫 − 2건분 안의 요청 수 그대로)',
    ok === fits(SH - 2 * perReq.usd) && ok < fits(SH), `ok=${ok} want=${fits(SH - 2 * perReq.usd)}`)
  rmSync(dir, { recursive: true, force: true })

  // ⓑ' 🔴 **세션이 보호 판정에 오늘 장부를 넘긴다** — 손 실행의 열린 예약은 남은 회차가 똑같이 나눠 진다.
  //    넘기지 않으면(빈 목록) 나눌 예산이 부풀어 뒤 회차 몫이 커지고, 이 회차는 한 건도 못 보낸다.
  const dir2 = mkdtempSync(join(tmpdir(), 'reserve-b2-'))
  const manualOpen = K_LEFT * 1.5 * perReq.usd
  appendLedgerLine(ledgerPathOf(dir2, D), open({ attemptId: 'open-m', usd: manualOpen, kind: 'manual', slot: null }))
  const s2 = new SupplyLlmSession({ runId: 'S-M', dir: dir2, limits: limOf(K_LEFT * SH), now: at(T), protectAt: protectOf(LABEL) })
  const ok2 = await runCalls(s2, 5)
  const want2 = fits((K_LEFT * SH - manualOpen) / K_LEFT)
  check('🔴 손 실행의 열린 예약이 있어도 정기 회차는 (하루 예산 − 그 예약) ÷ 남은 회차 안에서 돈다 — 1건 이상',
    ok2 === want2 && ok2 >= 1, `ok=${ok2} want=${want2}`)
  check('🔴 그리고 그 폭을 넘지 않는다 — 열린 예약이 없을 때보다 적게 나간다', ok2 < fits(SH), `ok=${ok2}`)
  rmSync(dir2, { recursive: true, force: true })
}
{
  // ⓒ 🔴 마지막 회차 뒤 풀림 · KST 자정 경계 — 하루 예산이 요청 1건 반
  const tight = limOf(1.5 * perReq.usd)
  const dir = mkdtempSync(join(tmpdir(), 'reserve-c-'))
  const manualAt = (runId: string, t: Date): Promise<number> =>
    runCalls(new SupplyLlmSession({ runId, dir, limits: tight, now: at(t), protectAt: protectOf({}) }), 1)
  check('🔴 마지막 회차 창의 마지막 1초 손 실행 — 남은 회차 1개 몫에 막힌다', await manualAt('L2', slotAt(D, LAST, WINDOW_MIN - 1, 59)) === 0)
  check('🔴 마지막 회차 창이 끝난 순간의 손 실행 — 몫이 풀려 통과한다', await manualAt('L3', afterLast(D)) === 1)
  check('그날 장부의 막힌 줄은 창 안의 한 건뿐이다', blockedCodes(dir, D).length === 1)
  check(`🔴 00:00 손 실행 — 새 날 장부는 비었지만 새 날 회차 ${N}개 몫이 다시 잡혀 막힌다`,
    await manualAt('L4', kst(`${D_NEXT}T00:00:00`)) === 0 && blockedCodes(dir, D_NEXT).includes('SCHEDULED_RESERVE'))
  /**
   * 🔴 정기 회차도 뒤 회차 몫을 남긴다 — 하루 예산(요청 1건 반)을 남은 회차가 나누면 회차 몫이 요청 1건보다 작다.
   *    같은 예산이라도 마지막 회차면 뒤 회차가 없어 돈다.
   */
  const d3 = mkdtempSync(join(tmpdir(), 'reserve-c3-'))
  check('🔴 다음 날 가운데 정기 회차 — 회차 몫 < 요청 1건이면 뒤 회차 몫을 지키려 막힌다',
    await runCalls(new SupplyLlmSession({ runId: 'L5', dir: d3, limits: tight, now: at(slotAt(D_NEXT, MID, 5)), protectAt: protectOf(LABEL) }), 1) === 0
    && blockedCodes(d3, D_NEXT).includes('SCHEDULED_RESERVE'))
  check('같은 예산으로 마지막 정기 회차는 돈다',
    await runCalls(new SupplyLlmSession({ runId: 'L6', dir: d3, limits: tight, now: at(slotAt(D_NEXT, LAST, 5)), protectAt: protectOf(LABEL) }), 1) === 1)
  rmSync(d3, { recursive: true, force: true })
  rmSync(dir, { recursive: true, force: true })
}
{
  // ⓓ 🔴 공급 장부(기본 디렉터리)에서는 호출부가 보호를 끄지 못한다
  const home = mkdtempSync(join(tmpdir(), 'reserve-home-'))
  const prevHome = process.env.HOME
  const prevLabel = process.env[LAUNCHD_LABEL_ENV]
  process.env.HOME = home
  delete process.env[LAUNCHD_LABEL_ENV]
  const T_GAP = gapAfter(D, MID)
  const T_IN = slotAt(D, NEXT, 5)
  SUPPLY_PROTECT_TEST_SEAM.clock = () => T_GAP
  try {
    // 운영 경로 그대로 — 임시 HOME 의 빈 장부. 하루 예산 = 남은 회차마다 요청 1건 반 → 정기 회차는 1건이 나간다
    const lim = limOf(K_LEFT * 1.5 * perReq.usd)
    check('시험 HOME 의 기본 장부 경로를 쓴다', defaultLedgerDir().startsWith(home))
    const forged = new SupplyLlmSession({
      runId: 'F', limits: lim, now: at(T_GAP),
      // 🔴 호출부가 "정기다 · 보호 없음" 을 주장한다
      protectAt: () => ({ kind: 'scheduled', why: 'forged', protect: null }),
    })
    const ok = await runCalls(forged, 1)
    check('🔴 공급 장부에서는 호출부가 넘긴 보호 설정을 무시한다 — 손 실행은 막힌다',
      ok === 0 && blockedCodes(defaultLedgerDir(), D).includes('SCHEDULED_RESERVE'))
    process.env[LAUNCHD_LABEL_ENV] = SUPPLY_PROCESS_LAUNCHD_LABEL
    const s2 = new SupplyLlmSession({ runId: 'F2', limits: lim, now: at(T_GAP) })
    check('🔴 공급 job 라벨이어도 창 밖이면 막힌다 — kickstart 는 정기가 아니다', await runCalls(s2, 1) === 0)
    SUPPLY_PROTECT_TEST_SEAM.clock = () => T_IN
    const s3 = new SupplyLlmSession({ runId: 'F3', limits: lim, now: at(T_IN) })
    check('공급 job 라벨 + 회차 창 안 → 정기 → 통과', await runCalls(s3, 1) === 1)
    check('🔴 운영 경로의 판정 사유에 남은 예산 · 남은 회차 수 · 회차 몫이 적힌다',
      new RegExp(`남은 예산 \\$[\\d.]+ ÷ 남은 회차 ${K_LEFT}개 = 회차 몫 \\$[\\d.]+`).test(s3.describe()) && s3.describe().includes('정기'),
      s3.describe())
    delete process.env[LAUNCHD_LABEL_ENV]
    const s4 = new SupplyLlmSession({ runId: 'F4', limits: lim, now: at(T_IN) })
    check('🔴 같은 시각 라벨 없는 실행은 손 실행 → 막힌다', await runCalls(s4, 1) === 0)
    /**
     * 🔴 **운영 경로의 보호 판정이 `SORAN_RUN_AT` 을 시각으로 쓰지 않는다.**
     *    그 값은 부모가 자식에게 넘기는 회차 시각이라 손 실행이 적어 넣을 수 있다 —
     *    창 밖 kickstart 가 창 안 시각을 적으면 정기 창 안으로 보이게 된다.
     */
    SUPPLY_PROTECT_TEST_SEAM.clock = null
    const viaEnv = supplyProtectFromEnv({ ...LABEL, SORAN_RUN_AT: slotAt(D, MID, 5).toISOString() })(T_GAP,
      { todayEntries: [], dailyUsd: 0.5, sessionStartedAt: T_GAP })
    check('🔴 운영 보호 판정(supplyProtectFromEnv)은 SORAN_RUN_AT 에 창 안 시각을 적어도 벽시계(창 밖)를 본다 — 손 실행',
      viaEnv.kind === 'manual' && viaEnv.protect !== null)
  } finally {
    SUPPLY_PROTECT_TEST_SEAM.clock = null
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome
    if (prevLabel === undefined) delete process.env[LAUNCHD_LABEL_ENV]; else process.env[LAUNCHD_LABEL_ENV] = prevLabel
    rmSync(home, { recursive: true, force: true })
  }
}
{
  // ⓔ 🔴 장부 읽기 실패 — LEDGER_ERROR (보호가 가리지 않는다)
  const dir = mkdtempSync(join(tmpdir(), 'reserve-e-'))
  const io: LedgerIo = { ...REAL_LEDGER_IO, readDay: () => ({ ok: false, reason: 'fixture' }) }
  const s = new SupplyLlmSession({ runId: 'E', dir, limits: limOf(100), io, now: at(afterLast(D)), protectAt: protectOf({}) })
  const before = paidFetches
  const ok = await runCalls(s, 1)
  check('🔴 장부를 못 읽으면 막힌다(LEDGER_ERROR) · fetch 0',
    ok === 0 && paidFetches === before && blockedCodes(dir, D).includes('LEDGER_ERROR'))
  rmSync(dir, { recursive: true, force: true })
}
{
  // ⓕ 🔴 판정은 잠금 안에서 — 집계·보호·예약 기록이 한 잠금이다(두 실행이 같은 여력을 두 번 보지 않는다)
  const src = readFileSync('scripts/lib/supply-llm-call.mts', 'utf-8')
  const lockAt = src.indexOf('verdict = this.io.withLock(this.dir, () => {')
  const protectAt = src.indexOf('this.protectAt(startedAt, {', lockAt)
  const judgeAt = src.indexOf('const v = judgeSpend({', lockAt)
  const addAt = src.indexOf('this.io.addOpen(', lockAt)
  check('🔴 보호 판정이 집계와 같은 잠금 안에서, 예약 기록보다 앞에서 일어난다',
    lockAt > 0 && lockAt < protectAt && protectAt < judgeAt && judgeAt < addAt)
  check('🔴 공급 장부면 호출부 보호 설정을 보지 않는다(코드)',
    /this\.protectAt = this\.supply\s*\?\s*supplyProtectFromEnv\(process\.env\)/.test(src))
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  check('🔴 문자열 비교(this.dir === defaultLedgerDir())가 없다 — 공급 장부 판정은 실경로 비교 하나다',
    !/this\.dir\s*===\s*defaultLedgerDir\(\)/.test(code) && /sameRealDir\(this\.dir, defaultLedgerDir\(\)\)/.test(code)
    && (code.match(/this\.supply = /g) ?? []).length === 1)
}

{
  // ⓖ 🔴 **실제 resolve 경로** — 정기 회차의 정산을 못 적게 하고, `supply:ledger-resolve` 를 임시 장부에 돌린다
  const DG = '2026-10-05'
  const dir = mkdtempSync(join(tmpdir(), 'reserve-g-'))
  for (const i of [PREV, MID, NEXT]) {
    let settledWrites = 0
    const io: LedgerIo = i !== NEXT ? REAL_LEDGER_IO : {
      ...REAL_LEDGER_IO,
      append: (p, e) => {
        if (e.stage !== 'countTokens' && e.status === 'settled') {
          settledWrites += 1
          if (settledWrites === 2) throw new Error('fixture: 정산 줄을 쓰지 못했다')
        }
        REAL_LEDGER_IO.append(p, e)
      },
    }
    const s = new SupplyLlmSession({
      runId: `G${i}`, dir, limits: limOf(1000), io, now: at(slotAt(DG, i, 5)), protectAt: supplyProtectFromEnv(LABEL),
    })
    await runCalls(s, 2)
  }
  const open = readOpenReservations(dir)
  const openId = open.ok ? (open.list[0]?.attemptId ?? '') : ''
  const r = spawnSync(join(process.cwd(), 'node_modules/.bin/tsx'), [
    join(process.cwd(), 'scripts/supply-llm-ledger-resolve.mts'), `--dir=${dir}`, `--attempt=${openId}`,
    '--confirmed-with-provider', '--actual-usd=0.5',
  ], { encoding: 'utf-8' })
  const day = readLedgerDay(ledgerPathOf(dir, DG))
  const human = day.ok ? day.entries.find((e) => e.resolvedBy === 'human') : undefined
  const own = slotLabel(DG, NEXT)
  check('[resolve] 정기 회차에 열린 예약 1건이 남았고 사람이 마감했다', openId !== '' && r.status === 0 && human !== undefined,
    `open=${openId} exit=${r.status}`)
  check('🔴 [resolve] 마감 줄이 원래 예약 줄의 runKind·runSlot 을 옮겨 적는다 — 접은 뒤에도 그 회차의 것이다',
    human?.runKind === 'scheduled' && human.runSlot === own && human.settledUsd === 0.5,
    JSON.stringify({ runKind: human?.runKind, runSlot: human?.runSlot }))
  // 그 회차가 아직 도는 중인 시각의 배분 — 마감 금액이 누구의 지출로 세어지는가
  const ceiling = supplyApprovedDailyUsdOf(DG) ?? 0
  const al = allocateScheduledReserve({
    pending: pendingSlotsAt(slotAt(DG, NEXT, 30)), capUsd: ceiling, todayEntries: day.ok ? day.entries : [], ownSlot: own,
  })
  const ownRow = al.slots.find((x) => x.label === own)
  const spentAll = day.ok ? tallyOf(day.entries).settledUsd + tallyOf(day.entries).openReservedUsd : 0
  check('🔴 [resolve] 사람이 마감한 금액은 그 회차가 쓴 것으로 센다 — 자기 몫에서 빠지고, 뒤 회차가 나눌 예산은 앞 회차 지출만큼만 준다',
    ownRow !== undefined && ownRow.spentUsd >= 0.5 && ownRow.claimUsd === 0 && near(al.basisUsd, ceiling - (spentAll - ownRow.spentUsd)),
    JSON.stringify({ own: ownRow, basis: al.basisUsd, spentAll }))
  rmSync(dir, { recursive: true, force: true })
}
{
  /**
   * ⓗ 🔴 **지난 날 장부 — 배분은 오늘 장부만 읽는다.**
   *    회차 몫은 오늘 장부(남은 예산)와 시각(남은 회차)에서만 나온다. 며칠 전 장부가 깨져도 정기 회차는 돈다.
   *    어제 장부는 회차 집계(자정을 넘긴 회차의 요청 수)가 읽으므로, 깨졌으면 `LEDGER_ERROR` 다.
   */
  const D6 = '2026-10-06'
  const once = async (brokenDate: string): Promise<{ ok: boolean; code: string }> => {
    const dir = mkdtempSync(join(tmpdir(), 'reserve-h-'))
    writeFileSync(ledgerPathOf(dir, brokenDate), '{깨진 줄\n')
    const s = new SupplyLlmSession({ runId: 'H', dir, limits: limOf(0.5), now: at(slotAt(D6, MID, 5)), protectAt: supplyProtectFromEnv(LABEL) })
    const r = await s.call(ASK)
    rmSync(dir, { recursive: true, force: true })
    return { ok: r.ok, code: r.errorCode ?? '' }
  }
  const old = await once('2026-10-03')
  check('[지난 장부] 사흘 전 장부가 깨져도 정기 회차는 돈다 — 배분은 지난 날 장부를 읽지 않는다', old.ok, old.code)
  const yesterday = await once('2026-10-05')
  check('🔴 [지난 장부] 어제 장부가 깨졌으면 회차 집계부터 못 읽어 LEDGER_ERROR — 정기 회차도 멈춘다',
    !yesterday.ok && yesterday.code.endsWith('LEDGER_ERROR'), yesterday.code)
}
{
  /**
   * ⓘ 🔴 **잠 · 늦은 복귀 · runner-recover kickstart.**
   *    규칙: 정기 = 라벨 + 요청 시각 + **회차 시작 시각**(min(SORAN_RUN_AT, 세션 생성))이 같은 회차 창.
   *    아니면 손 실행 — 남은 회차 전부의 몫을 남긴 나머지만 쓰고, 제 회차가 못 쓴 몫은 뒤 회차로 넘어간다.
   *    아래에서 "앞 회차" = 가운데 바로 앞 회차, "뒤 회차" = 가운데 회차다.
   */
  const D6 = '2026-10-06'
  const A = PREV
  const B = MID
  const kindOf = (now: Date, started: Date | null) => supplyRunKindOf(LABEL, now, SUPPLY_RUN_SLOTS_KST, SCHEDULED_RUN_WINDOW_MS, started)
  const startA = slotAt(D6, A, 0, 2)
  check('🔴 앞 회차 창에서 시작해 잠들고 뒤 회차 창에서 깬 회차 → 손 실행(뒤 회차 몫을 받지 않는다)',
    kindOf(slotAt(D6, B, 2), slotAt(D6, A, 1)).kind === 'manual')
  check('🔴 회차 시각 전에 kickstart 로 떠서 창 안에서 요청 → 손 실행(그 회차 몫을 받지 않는다)',
    kindOf(slotAt(D6, A, 1), slotAt(D6, A, -5)).kind === 'manual')
  check('정시 회차(회차 시각 2초 뒤 시작 · 25분 뒤 요청) → 그 정기 회차', kindOf(slotAt(D6, A, 25), startA).slot === slotLabel(D6, A))
  check('🔴 시작 시각을 모름(null) → 손 실행', kindOf(slotAt(D6, A, 25), null).kind === 'manual')
  // 운영 판정(supplyProtectFromEnv)이 시작 시각을 실제로 넣는다
  const ctx = (sessionStartedAt: Date): ProtectContext => ({ todayEntries: [], dailyUsd: 0.3, sessionStartedAt })
  check('🔴 부모 SORAN_RUN_AT=앞 회차 · 깨어난 뒤 띄운 자식(세션은 뒤 회차 창) → 손 실행 (이른 쪽 시작 시각)',
    supplyProtectFromEnv({ ...LABEL, SORAN_RUN_AT: startA.toISOString() })(slotAt(D6, B, 4), ctx(slotAt(D6, B, 3))).kind === 'manual')
  check('SORAN_RUN_AT 없음 · 세션과 요청이 같은 회차 창 → 그 정기 회차',
    supplyProtectFromEnv(LABEL)(slotAt(D6, B, 4), ctx(slotAt(D6, B, 1))).slot === slotLabel(D6, B))
  check('🔴 SORAN_RUN_AT 모양이 틀리면 시작 시각을 모른다 → 손 실행',
    supplyProtectFromEnv({ ...LABEL, SORAN_RUN_AT: '08:15' })(slotAt(D6, B, 4), ctx(slotAt(D6, B, 1))).kind === 'manual')
  check('🔴 SORAN_RUN_AT 이 세션보다 늦어도(미래) 판정을 느슨하게 만들지 못한다 — 세션이 회차 시각 전이면 손 실행',
    supplyProtectFromEnv({ ...LABEL, SORAN_RUN_AT: slotAt(D6, A, 5).toISOString() })(slotAt(D6, A, 6), ctx(slotAt(D6, A, -5))).kind === 'manual')
  check('runStartedAtOf — 둘 중 이른 것 · 모양이 틀리면 null',
    runStartedAtOf({ SORAN_RUN_AT: startA.toISOString() }, slotAt(D6, B, 3))?.getTime() === startA.getTime()
    && runStartedAtOf({}, slotAt(D6, B, 3))?.getTime() === slotAt(D6, B, 3).getTime()
    && runStartedAtOf({ SORAN_RUN_AT: 'x' }, slotAt(D6, B, 3)) === null)

  // runner-recover kickstart — 앞 회차가 exit 1 로 끝난 뒤 같은 창에서 다시 뜬 회차
  const spent = [line({ usd: 0.03, kind: 'scheduled', slot: slotLabel(D6, A), at: slotAt(D6, A, 1) })]
  const within = supplySpendProtectAt({ env: LABEL, now: slotAt(D6, A, 26), runStartedAt: slotAt(D6, A, 25), todayEntries: spent, dailyUsd: 0.3 })
  const ownWithin = within.allocation.slots.find((x) => x.label === slotLabel(D6, A))
  check('🔴 [recover] 창 안 kickstart → 같은 정기 회차 · 남은 몫은 회차 몫에서 앞 실행이 쓴 것을 뺀 만큼뿐이다',
    within.kind === 'scheduled' && near(ownWithin?.claimUsd ?? -1, 0.3 / (N - A) - 0.03), JSON.stringify(ownWithin))
  const after = supplySpendProtectAt({ env: LABEL, now: gapAfter(D6, A), runStartedAt: windowEnd(D6, A), todayEntries: spent, dailyUsd: 0.3 })
  check('🔴 [recover] 창 뒤 kickstart → 손 실행 · 그 회차가 못 쓴 몫은 뒤 회차로 넘어가 전부 남긴다(하루 예산 − 쓴 것)',
    after.kind === 'manual' && near(after.protect.reservedForOthersUsd, 0.3 - 0.03), `${after.protect.reservedForOthersUsd}`)

  // 세션 — 같은 세션이 잠들었다 깬다
  const dir = mkdtempSync(join(tmpdir(), 'reserve-i-'))
  const lim = limOf(0.3)
  let clock = slotAt(D6, A, 1)
  const sleeper = new SupplyLlmSession({ runId: 'Z-A', dir, limits: lim, now: () => clock,
    protectAt: supplyProtectFromEnv({ ...LABEL, SORAN_RUN_AT: startA.toISOString() }) })
  const b0 = paidFetches
  const first = await sleeper.call(ASK)
  clock = slotAt(D6, B, 2)
  const resumed = await sleeper.call(ASK)
  check('🔴 [세션·잠] 앞 회차 창의 요청은 정기로 나가고, 뒤 회차 창에서 깨어난 요청은 손 실행 → SCHEDULED_RESERVE · fetch 1건',
    first.ok && !resumed.ok && (resumed.errorCode ?? '').endsWith('SCHEDULED_RESERVE') && paidFetches - b0 === 1, resumed.errorCode ?? '')
  const tags = ((): string => {
    const d = readLedgerDay(ledgerPathOf(dir, D6))
    return d.ok ? d.entries.filter((e) => e.runId === 'Z-A' && e.stage !== 'countTokens').map((e) => `${e.runKind}:${e.runSlot}`).join(',') : ''
  })()
  check('🔴 [세션·잠] 깨어난 요청은 장부에 manual 로 남는다 — 뒤 회차의 지출로 세지 않는다',
    tags === `scheduled:${slotLabel(D6, A)},manual:null`, tags)
  const sB = new SupplyLlmSession({ runId: 'Z-B', dir, limits: lim, now: at(slotAt(D6, B, 5)),
    protectAt: supplyProtectFromEnv({ ...LABEL, SORAN_RUN_AT: slotAt(D6, B, 0, 1).toISOString() }) })
  check('🔴 [세션·잠] 그 뒤 회차의 정기 실행은 자기 몫으로 돈다', (await sB.call(ASK)).ok)
  // 회차 시각 전 kickstart — 세션이 회차 5분 전에 생기고 요청은 창 안
  const dir2 = mkdtempSync(join(tmpdir(), 'reserve-i2-'))
  let early = slotAt(D6, A, -5)
  const kick = new SupplyLlmSession({ runId: 'Z-K', dir: dir2, limits: lim, now: () => early, protectAt: supplyProtectFromEnv(LABEL) })
  early = slotAt(D6, A, 1)
  const kr = await kick.call(ASK)
  check('🔴 [세션·kickstart] 회차 시각 전에 뜬 회차의 창 안 요청은 그 회차 몫을 받지 못한다 → SCHEDULED_RESERVE',
    !kr.ok && (kr.errorCode ?? '').endsWith('SCHEDULED_RESERVE'), kr.errorCode ?? '')
  rmSync(dir, { recursive: true, force: true })
  rmSync(dir2, { recursive: true, force: true })
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 새 예산을 여는 별도 장부 — 🔴 창 밖 launchd 차단 · $HOME 바꾸기 · 오늘 파일 없음 · 적용 한도 기록')
// ─────────────────────────────────────────────────────────
/**
 * 🔴 **임시 HOME 에서 공급 세션을 돌린다** — 운영 장부 0. `mark` 는 시험 격리 표식(가짜 fetch 프로세스),
 *    `label` 은 launchd 라벨, `clock` 은 보호 판정의 벽시계(세션 시각과 같게 준다).
 */
async function inHome<T>(o: { mark: boolean; label: boolean; clock: Date }, fn: (home: string) => Promise<T>): Promise<T> {
  const home = mkdtempSync(join(tmpdir(), 'reserve-j-home-'))
  const prevHome = process.env.HOME
  const prevLabel = process.env[LAUNCHD_LABEL_ENV]
  process.env.HOME = home
  if (o.label) process.env[LAUNCHD_LABEL_ENV] = SUPPLY_PROCESS_LAUNCHD_LABEL; else delete process.env[LAUNCHD_LABEL_ENV]
  SUPPLY_PROTECT_TEST_SEAM.clock = () => o.clock
  setIsolation(o.mark)
  try {
    return await fn(home)
  } finally {
    setIsolation(true)
    SUPPLY_PROTECT_TEST_SEAM.clock = null
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome
    if (prevLabel === undefined) delete process.env[LAUNCHD_LABEL_ENV]; else process.env[LAUNCHD_LABEL_ENV] = prevLabel
    rmSync(home, { recursive: true, force: true })
  }
}
const LIM50 = limOf(0.5)
/** 회차 창이 끝나면 새 유료 요청을 시작하지 않는 규칙의 시행일(2026-11-05)과 그 전날 */
const D_LEGACY = '2026-11-04'
const D_GUARD = '2026-11-05'
/** 이 절의 "그 회차" — 가운데 바로 앞 회차. 창이 끝난 뒤 다음 회차까지 빈 틈이 있다(① 의 전제) */
const W = PREV
const D5 = '2026-10-05'
const D6 = '2026-10-06'
{
  const legacyTail = await inHome({ mark: true, label: true, clock: slotAt(D_LEGACY, W, 1) }, async () => {
    const prevRunAt = process.env.SORAN_RUN_AT
    process.env.SORAN_RUN_AT = slotAt(D_LEGACY, W, 0, 2).toISOString()
    let clock = slotAt(D_LEGACY, W, 1)
    SUPPLY_PROTECT_TEST_SEAM.clock = () => clock
    try {
      const s = new SupplyLlmSession({ runId: 'LEGACY-NATURAL-TAIL', limits: LIM50, now: () => clock })
      const count0 = countFetches
      const first = await s.call(ASK)
      clock = slotAt(D_LEGACY, W, WINDOW_MIN, 1)
      const resumed = await s.call(ASK)
      return { first, resumed, counted: countFetches - count0 }
    } finally {
      if (prevRunAt === undefined) delete process.env.SORAN_RUN_AT; else process.env.SORAN_RUN_AT = prevRunAt
    }
  })
  check('🟢 [시행일 전 자연 꼬리] 시행일 전날 회차는 창이 끝난 뒤에도 새 producer 차단을 적용하지 않는다',
    legacyTail.first.ok
      && !(legacyTail.resumed.errorCode ?? '').endsWith('SCHEDULED_WINDOW_CLOSED')
      && legacyTail.counted === 2,
    `${legacyTail.resumed.errorCode} count=${legacyTail.counted}`)
}
{
  const prevLabel = process.env[LAUNCHD_LABEL_ENV]
  const prevRunAt = process.env.SORAN_RUN_AT
  process.env[LAUNCHD_LABEL_ENV] = SUPPLY_PROCESS_LAUNCHD_LABEL
  delete process.env.SORAN_RUN_AT
  setIsolation(false)
  const legacyLateLaunchd = await (async () => {
    try {
      const count0 = countFetches
      const noDiskIo: LedgerIo = {
        withLock: (_dir, fn) => fn(),
        readDay: () => ({ ok: true, entries: [] }),
        readRun: () => ({ ok: true, entries: [] }),
        append: () => { throw new Error('fixture: 운영 장부 write 금지') },
        readHold: () => null,
        writeHold: () => { throw new Error('fixture: 운영 hold write 금지') },
        readOpen: () => ({ ok: true, list: [] }),
        addOpen: () => { throw new Error('fixture: 운영 open write 금지') },
        clearOpen: () => { throw new Error('fixture: 운영 open clear 금지') },
        pidAlive: () => false,
        exists: () => true,
      }
      const s = new SupplyLlmSession({
        runId: 'LEGACY-LATE-LAUNCHD', limits: LIM50, now: at(gapAfter(D_LEGACY, W)), io: noDiskIo,
      })
      const r = await s.call(ASK)
      return { r, counted: countFetches - count0 }
    } finally {
      setIsolation(true)
      if (prevLabel === undefined) delete process.env[LAUNCHD_LABEL_ENV]; else process.env[LAUNCHD_LABEL_ENV] = prevLabel
      if (prevRunAt === undefined) delete process.env.SORAN_RUN_AT; else process.env.SORAN_RUN_AT = prevRunAt
    }
  })()
  check('🟢 [시행일 전 늦은 launchd] 시행일 전날 창 밖 첫 실행은 새 producer 차단을 적용하지 않는다',
    !(legacyLateLaunchd.r.errorCode ?? '').endsWith('SCHEDULED_WINDOW_CLOSED')
      && legacyLateLaunchd.counted === 1,
    `${legacyLateLaunchd.r.errorCode} count=${legacyLateLaunchd.counted}`)
}
{
  const prevLabel = process.env[LAUNCHD_LABEL_ENV]
  const prevRunAt = process.env.SORAN_RUN_AT
  process.env[LAUNCHD_LABEL_ENV] = SUPPLY_PROCESS_LAUNCHD_LABEL
  delete process.env.SORAN_RUN_AT
  setIsolation(false)
  const lateLaunchd = await (async () => {
    try {
      const paid0 = paidFetches
      const count0 = countFetches
      const noDiskIo: LedgerIo = {
        withLock: (_dir, fn) => fn(),
        readDay: () => ({ ok: true, entries: [] }),
        readRun: () => ({ ok: true, entries: [] }),
        append: () => { throw new Error('fixture: 운영 장부 write 금지') },
        readHold: () => null,
        writeHold: () => { throw new Error('fixture: 운영 hold write 금지') },
        readOpen: () => ({ ok: true, list: [] }),
        addOpen: () => { throw new Error('fixture: 운영 open write 금지') },
        clearOpen: () => { throw new Error('fixture: 운영 open clear 금지') },
        pidAlive: () => false,
        exists: () => true,
      }
      const s = new SupplyLlmSession({
        runId: 'NATURAL-LATE-LAUNCHD', limits: LIM50, now: at(gapAfter(D_GUARD, W)), io: noDiskIo,
      })
      const r = await s.call(ASK)
      return {
        r, paid: paidFetches - paid0, counted: countFetches - count0,
        blocked: s.tally.blockedBy.get('SCHEDULED_WINDOW_CLOSED') ?? 0,
      }
    } finally {
      setIsolation(true)
      if (prevLabel === undefined) delete process.env[LAUNCHD_LABEL_ENV]; else process.env[LAUNCHD_LABEL_ENV] = prevLabel
      if (prevRunAt === undefined) delete process.env.SORAN_RUN_AT; else process.env.SORAN_RUN_AT = prevRunAt
    }
  })()
  check('🔴 [늦게 시작한 launchd] 공급 job이 회차 창 밖에서 처음 뜨면 manual로 강등하지 않고 호출 전 차단한다',
    !lateLaunchd.r.ok && (lateLaunchd.r.errorCode ?? '').endsWith('SCHEDULED_WINDOW_CLOSED')
      && lateLaunchd.paid === 0 && lateLaunchd.counted === 0 && lateLaunchd.blocked === 1,
    `${lateLaunchd.r.errorCode} paid=${lateLaunchd.paid} count=${lateLaunchd.counted}`)
}
{
  const lateChild = await inHome({ mark: true, label: true, clock: slotAt(D_GUARD, MID, 3) }, async () => {
    const prevRunAt = process.env.SORAN_RUN_AT
    process.env.SORAN_RUN_AT = slotAt(D_GUARD, W, 0, 2).toISOString()
    try {
      const paid0 = paidFetches
      const count0 = countFetches
      const s = new SupplyLlmSession({ runId: 'NATURAL-LATE-CHILD', limits: LIM50, now: at(slotAt(D_GUARD, MID, 3)) })
      const r = await s.call(ASK)
      return {
        r, paid: paidFetches - paid0, counted: countFetches - count0,
        blocked: s.tally.blockedBy.get('SCHEDULED_WINDOW_CLOSED') ?? 0,
      }
    } finally {
      if (prevRunAt === undefined) delete process.env.SORAN_RUN_AT; else process.env.SORAN_RUN_AT = prevRunAt
    }
  })
  check('🔴 [늦게 생성된 자연 자식] 앞 회차에서 출발한 부모가 다음 회차 창에서 띄운 자식은 manual로 강등하지 않고 호출 전 차단한다',
    !lateChild.r.ok && (lateChild.r.errorCode ?? '').endsWith('SCHEDULED_WINDOW_CLOSED')
      && lateChild.paid === 0 && lateChild.counted === 0 && lateChild.blocked === 1,
    `${lateChild.r.errorCode} paid=${lateChild.paid} count=${lateChild.counted}`)
}
{
  const malformedParent = await inHome({ mark: true, label: true, clock: slotAt(D_GUARD, W, 1) }, async () => {
    const prevRunAt = process.env.SORAN_RUN_AT
    process.env.SORAN_RUN_AT = 'not-a-time'
    try {
      const paid0 = paidFetches
      const count0 = countFetches
      const s = new SupplyLlmSession({ runId: 'NATURAL-MALFORMED-PARENT', limits: LIM50, now: at(slotAt(D_GUARD, W, 1)) })
      const r = await s.call(ASK)
      return { r, paid: paidFetches - paid0, counted: countFetches - count0 }
    } finally {
      if (prevRunAt === undefined) delete process.env.SORAN_RUN_AT; else process.env.SORAN_RUN_AT = prevRunAt
    }
  })
  check('🔴 [깨진 부모 시각] SORAN_RUN_AT 모양이 틀리면 manual로 우회하지 않고 countTokens·provider 전에 막는다',
    !malformedParent.r.ok && (malformedParent.r.errorCode ?? '').endsWith('SCHEDULED_WINDOW_CLOSED')
      && malformedParent.paid === 0 && malformedParent.counted === 0,
    `${malformedParent.r.errorCode} paid=${malformedParent.paid} count=${malformedParent.counted}`)
}
{
  const tail = await inHome({ mark: true, label: true, clock: slotAt(D_GUARD, W, 1) }, async () => {
    let clock = slotAt(D_GUARD, W, 1)
    SUPPLY_PROTECT_TEST_SEAM.clock = () => clock
    const s = new SupplyLlmSession({ runId: 'NATURAL-TAIL', limits: LIM50, now: () => clock })
    const paid0 = paidFetches
    const count0 = countFetches
    const first = await s.call(ASK)
    clock = slotAt(D_GUARD, W, WINDOW_MIN, 1)
    const resumed = await s.call(ASK)
    return {
      first,
      resumed,
      paid: paidFetches - paid0,
      counted: countFetches - count0,
      blocked: s.tally.blockedBy.get('SCHEDULED_WINDOW_CLOSED') ?? 0,
    }
  })
  check('🔴 [자연 회차 꼬리] 정기 회차는 자기 창 밖에서 새 유료 요청·countTokens를 시작하지 않는다',
    tail.first.ok && !tail.resumed.ok
      && (tail.resumed.errorCode ?? '').endsWith('SCHEDULED_WINDOW_CLOSED')
      && tail.paid === 1 && tail.counted === 1 && tail.blocked === 1,
    `${tail.resumed.errorCode} paid=${tail.paid} count=${tail.counted} blocked=${tail.blocked}`)
}
{
  const afterCount = await inHome({ mark: true, label: true, clock: slotAt(D_GUARD, W, WINDOW_MIN - 1, 58) }, async () => {
    let clock = slotAt(D_GUARD, W, WINDOW_MIN - 1, 58)
    SUPPLY_PROTECT_TEST_SEAM.clock = () => clock
    const s = new SupplyLlmSession({ runId: 'NATURAL-COUNT-BOUNDARY', limits: LIM50, now: () => clock })
    const paid0 = paidFetches
    const count0 = countFetches
    afterCountFetch = () => { clock = windowEnd(D_GUARD, W) }
    try {
      const r = await s.call(ASK)
      return { r, paid: paidFetches - paid0, counted: countFetches - count0 }
    } finally { afterCountFetch = null }
  })
  check('🔴 [countTokens 경계] 창 끝 2초 전에 시작해 무료 계산 중 창이 끝나면 예약·provider 0',
    !afterCount.r.ok && (afterCount.r.errorCode ?? '').endsWith('SCHEDULED_WINDOW_CLOSED')
      && afterCount.paid === 0 && afterCount.counted === 1,
    `${afterCount.r.errorCode} paid=${afterCount.paid} count=${afterCount.counted}`)
}
{
  const beforeProvider = await inHome({ mark: true, label: true, clock: slotAt(D_GUARD, W, WINDOW_MIN - 1, 58) }, async () => {
    let clock = slotAt(D_GUARD, W, WINDOW_MIN - 1, 58)
    SUPPLY_PROTECT_TEST_SEAM.clock = () => clock
    let locks = 0
    const io: LedgerIo = {
      ...REAL_LEDGER_IO,
      withLock: (dir, fn) => {
        const result = REAL_LEDGER_IO.withLock(dir, fn)
        locks += 1
        if (locks === 2) clock = windowEnd(D_GUARD, W)
        return result
      },
    }
    const s = new SupplyLlmSession({ runId: 'NATURAL-PROVIDER-BOUNDARY', limits: LIM50, now: () => clock, io })
    const paid0 = paidFetches
    const count0 = countFetches
    const r = await s.call(ASK)
    const open = readOpenReservations(defaultLedgerDir())
    return { r, paid: paidFetches - paid0, counted: countFetches - count0, open: open.ok ? open.list.length : -1 }
  })
  check('🔴 [provider 직전 경계] 예약 잠금 중 창이 끝나면 예약을 종결하고 provider 0·열린 예약 0',
    !beforeProvider.r.ok && (beforeProvider.r.errorCode ?? '').endsWith('SCHEDULED_WINDOW_CLOSED')
      && beforeProvider.paid === 0 && beforeProvider.counted === 1 && beforeProvider.open === 0,
    `${beforeProvider.r.errorCode} paid=${beforeProvider.paid} count=${beforeProvider.counted} open=${beforeProvider.open}`)
}
{
  const terminalWriteFails = await inHome({ mark: true, label: true, clock: slotAt(D_GUARD, W, WINDOW_MIN - 1, 58) }, async () => {
    let clock = slotAt(D_GUARD, W, WINDOW_MIN - 1, 58)
    SUPPLY_PROTECT_TEST_SEAM.clock = () => clock
    let locks = 0
    let clearCalls = 0
    const io: LedgerIo = {
      ...REAL_LEDGER_IO,
      withLock: (dir, fn) => {
        const result = REAL_LEDGER_IO.withLock(dir, fn)
        locks += 1
        if (locks === 2) clock = windowEnd(D_GUARD, W)
        return result
      },
      append: (path, entry) => {
        if (entry.blockCode === 'SCHEDULED_WINDOW_CLOSED') throw new Error('terminal write failed')
        REAL_LEDGER_IO.append(path, entry)
      },
      clearOpen: (dir, attemptId) => {
        clearCalls += 1
        REAL_LEDGER_IO.clearOpen(dir, attemptId)
      },
    }
    const s = new SupplyLlmSession({ runId: 'NATURAL-TERMINAL-WRITE-FAIL', limits: LIM50, now: () => clock, io })
    const paid0 = paidFetches
    const r = await s.call(ASK)
    const open = readOpenReservations(defaultLedgerDir())
    return { r, paid: paidFetches - paid0, open: open.ok ? open.list.length : -1, clearCalls }
  })
  check('🔴 [종결 기록 실패] provider 0·예약 보존·clear 0 — 기록 실패를 조용히 지우지 않는다',
    !terminalWriteFails.r.ok && (terminalWriteFails.r.errorCode ?? '').endsWith('LEDGER_ERROR')
      && terminalWriteFails.paid === 0 && terminalWriteFails.open === 1 && terminalWriteFails.clearCalls === 0,
    `${terminalWriteFails.r.errorCode} paid=${terminalWriteFails.paid} open=${terminalWriteFails.open} clear=${terminalWriteFails.clearCalls}`)
}
/** 지난 날 장부 한 줄 — "최근 장부가 있다" 는 사실만 만든다 */
const pastDay = (date: string): LedgerEntry[] =>
  [line({ usd: 0.001, kind: 'scheduled', slot: slotLabel(date, MID), at: slotAt(date, MID, 5) })]
const putRows = (dir: string, date: string, rows: LedgerEntry[]): void => {
  mkdirSync(dir, { recursive: true })
  for (const e of rows) appendLedgerLine(ledgerPathOf(dir, date), e)
}
{
  // ⓐ 🔴 $HOME 바꾸기 — 정본(계정 홈)과 실경로가 다른 공급 장부는 쓰지 않는다
  const t = mkdtempSync(join(tmpdir(), 'reserve-j1-'))
  const canon = join(t, 'canon', 'llm-ledger')
  mkdirSync(canon, { recursive: true })
  symlinkSync(join(t, 'canon'), join(t, 'alias'))
  check('[정본] 같은 자리 · 끝 `/` · 심볼릭 경로 · `..` 표기는 모두 정본이다',
    supplyLedgerDirError(canon, canon) === null && supplyLedgerDirError(`${canon}/`, canon) === null
    && supplyLedgerDirError(join(t, 'alias', 'llm-ledger'), canon) === null
    && supplyLedgerDirError(`${t}/canon/../canon/llm-ledger`, canon) === null)
  check('[정본] 아직 없는 장부 디렉터리(첫 실행)도 실경로로 비교한다',
    sameRealDir(join(t, 'alias', 'new-ledger'), join(t, 'canon', 'new-ledger')) && realDirOf(join(t, 'x', 'y')).endsWith(join('x', 'y')))
  check('🔴 [정본] 다른 HOME 의 장부 자리는 정본이 아니다 → 사유',
    (supplyLedgerDirError(ledgerDirForHome(join(t, 'other-home')), canon) ?? '').includes('정본과 다르다'))
  check('🔴 [정본] 계정 홈을 못 읽으면(null) 정본을 모른다 → 보류 사유', supplyLedgerDirError(canon, null) !== null)
  const passwd = canonicalLedgerDir()
  check('[정본] 정본은 $HOME 이 아니라 계정 홈(passwd)에서 온다 — 임시 HOME 을 줘도 바뀌지 않는다',
    await inHome({ mark: true, label: false, clock: afterLast(D) }, async (home) =>
      passwd !== null && canonicalLedgerDir() === passwd && !passwd.startsWith(home) && defaultLedgerDir().startsWith(home)))
  rmSync(t, { recursive: true, force: true })

  const bypass = await inHome({ mark: false, label: false, clock: afterLast(D) }, async () => {
    const d = defaultLedgerDir()
    const b0 = paidFetches
    const c0 = countFetches
    const s = new SupplyLlmSession({ runId: 'HOME-BYPASS', limits: LIM50, now: at(afterLast(D)) })
    const r = await s.call(ASK)
    return { r, paid: paidFetches - b0, count: countFetches - c0, touched: existsSync(d), supply: s.supply }
  })
  check('🔴 [HOME] HOME 을 바꿔 띄운 손 실행(마지막 창 뒤 · 빈 장부) → LEDGER_ERROR · 사전 계산 0 · 유료 0',
    !bypass.r.ok && (bypass.r.errorCode ?? '').endsWith('LEDGER_ERROR') && bypass.paid === 0 && bypass.count === 0 && bypass.supply,
    `${bypass.r.errorCode} paid=${bypass.paid} count=${bypass.count}`)
  check('🔴 [HOME] 그 자리에 장부를 만들지도 않는다 — 빈 장부가 다음 실행의 "새 예산" 이 되지 않게',
    !bypass.touched && /정본과 다르다/.test(bypass.r.errorMessage ?? ''), bypass.r.errorMessage ?? '')
  const control = await inHome({ mark: true, label: false, clock: afterLast(D) }, async () => {
    const s = new SupplyLlmSession({ runId: 'HOME-ISOLATED', limits: LIM50, now: at(afterLast(D)) })
    return s.call(ASK)
  })
  check('[HOME] 대조군 — 같은 임시 HOME 이라도 시험 격리 표식(가짜 fetch 프로세스)이면 돈다', control.ok, control.errorCode ?? '')
  {
    setIsolation(false)
    process.env.SORAN_LEDGER_ISOLATION = '1'
    const a = ledgerIsolationActive()
    delete process.env.SORAN_LEDGER_ISOLATION
    setIsolation(true)
    check('🔴 [HOME] 격리 표식은 코드(Symbol)로만 걸린다 — env 로 켤 수 없다', !a)
  }

  // 🔴 dir 에 공급 장부 자리를 다른 표기로 넘겨도 공급 장부다 — 호출부 보호 설정(위조)을 보지 않는다
  const forgedDir = await inHome({ mark: true, label: false, clock: gapAfter(D, MID) }, async (home) => {
    const d = defaultLedgerDir()
    mkdirSync(d, { recursive: true })
    symlinkSync(join(home, 'Library'), join(home, 'LibAlias'))
    const forged = (): ProtectDecision => ({ kind: 'scheduled', why: 'forged', protect: null })
    const lim = limOf(6 * perReq.usd)
    const a = new SupplyLlmSession({ runId: 'FS', dir: `${d}/`, limits: lim, now: at(gapAfter(D, MID)), protectAt: forged })
    const b = new SupplyLlmSession({
      runId: 'FL', dir: join(home, 'LibAlias', 'Application Support', 'soransoran', 'llm-ledger'),
      limits: lim, now: at(gapAfter(D, MID)), protectAt: forged,
    })
    return { a: a.supply, b: b.supply, ra: await a.call(ASK), rb: await b.call(ASK) }
  })
  check('🔴 [dir] 끝 `/` · 심볼릭 표기로 넘긴 공급 장부도 공급 장부다 — 위조한 "정기·보호 없음" 을 무시하고 막는다',
    forgedDir.a && forgedDir.b && !forgedDir.ra.ok && !forgedDir.rb.ok
    && (forgedDir.ra.errorCode ?? '').endsWith('SCHEDULED_RESERVE') && (forgedDir.rb.errorCode ?? '').endsWith('SCHEDULED_RESERVE'),
    `${forgedDir.ra.errorCode} ${forgedDir.rb.errorCode}`)
}
{
  // ⓑ 🔴 오늘 파일 없음 — 판정(순수)의 경계
  const v = (now: Date, o: { today?: boolean; recent?: boolean; kind?: 'scheduled' | 'manual' } = {}) => missingTodayLedgerVerdict({
    now, todayExists: o.today ?? false, recentDaysExist: o.recent ?? true, kind: o.kind ?? 'manual',
  })
  check('[오늘 없음] 오늘 파일이 있으면 통과', v(gapAfter(D6, MID), { today: true }).ok)
  check('[오늘 없음] 🟢 자정 직후(00:00:01) 첫 호출은 허용 — 오늘 파일이 아직 없는 게 정상이다', v(kst(`${D6}T00:00:01`)).ok)
  check('[오늘 없음] 🟢 첫 정기 회차 1초 전까지 손 실행도 허용', v(slotAt(D6, 0, -1, 59)).ok)
  check('🔴 [오늘 없음] 첫 정기 회차 시각부터 손 실행은 보류', !v(slotAt(D6, 0)).ok)
  check('🔴 [오늘 없음] 마지막 회차 창 뒤의 손 실행도 보류 — 하루 종일 정기 회차가 못 돈 날의 손실(문서화된 대가)', !v(afterLast(D6)).ok)
  check('[오늘 없음] 🟢 정기 회차는 오늘 첫 줄을 연다 — 앞 회차들 동안 꺼져 있었던 날', v(slotAt(D6, MID, 5), { kind: 'scheduled' }).ok)
  check('[오늘 없음] 🟢 최근 7일 장부가 하나도 없으면(새 장부) 허용', v(gapAfter(D6, MID), { recent: false }).ok)
}
{
  // ⓒ 🔴 오늘 파일 없음 — 세션 경로(기본 장부 · 임시 HOME · 격리 표식)
  const seed = (d: string): void => putRows(d, D5, pastDay(D5))
  const gone = await inHome({ mark: true, label: false, clock: gapAfter(D6, MID) }, async () => {
    const d = defaultLedgerDir()
    seed(d)
    const b0 = paidFetches
    const s = new SupplyLlmSession({ runId: 'GONE', limits: LIM50, now: at(gapAfter(D6, MID)) })
    const r1 = await s.call(ASK)
    const r2 = await s.call(ASK)
    return { r1, r2, paid: paidFetches - b0, created: existsSync(ledgerPathOf(d, D6)) }
  })
  check('🔴 [오늘 없음·세션] 어제 장부가 있고 첫 회차 시각이 지났는데 오늘 파일이 없다 → 손 실행 LEDGER_ERROR · 유료 0',
    !gone.r1.ok && (gone.r1.errorCode ?? '').endsWith('LEDGER_ERROR') && /오늘 공급 장부 파일이 없다/.test(gone.r1.errorMessage ?? '') && gone.paid === 0,
    `${gone.r1.errorCode} ${gone.r1.errorMessage}`)
  check('🔴 [오늘 없음·세션] 막힌 요청이 오늘 파일을 만들지 않는다 — 두 번째 요청도 같은 이유로 막힌다',
    !gone.created && !gone.r2.ok && /오늘 공급 장부 파일이 없다/.test(gone.r2.errorMessage ?? ''))
  const midnight = await inHome({ mark: true, label: false, clock: kst(`${D6}T00:00:30`) }, async () => {
    const d = defaultLedgerDir()
    seed(d)
    const s = new SupplyLlmSession({ runId: 'MID', limits: LIM50, now: at(kst(`${D6}T00:00:30`)) })
    const r = await s.call(ASK)
    return { r, created: existsSync(ledgerPathOf(d, D6)) }
  })
  check('[오늘 없음·세션] 자정 직후 손 실행 — 오늘 파일 없음으로는 막지 않고, 그날 정기 회차 몫에 막혀 차단 기록만 남는다',
    !midnight.r.ok && (midnight.r.errorCode ?? '').endsWith('SCHEDULED_RESERVE') && midnight.created,
    midnight.r.errorCode ?? '')
  const sched = await inHome({ mark: true, label: true, clock: slotAt(D6, MID, 5) }, async () => {
    const d = defaultLedgerDir()
    seed(d)
    const s = new SupplyLlmSession({ runId: 'OPEN-MID', limits: LIM50, now: at(slotAt(D6, MID, 5)) })
    const r = await s.call(ASK)
    delete process.env[LAUNCHD_LABEL_ENV]
    SUPPLY_PROTECT_TEST_SEAM.clock = () => slotAt(D6, MID, 10)
    const m = await new SupplyLlmSession({ runId: 'AFTER', limits: LIM50, now: at(slotAt(D6, MID, 10)) }).call(ASK)
    return { r, m }
  })
  check('[오늘 없음·세션] 🟢 앞 회차들 동안 꺼져 있던 날 — 가운데 정기 회차가 오늘 첫 줄을 연다(통과)', sched.r.ok, sched.r.errorCode ?? '')
  check('[오늘 없음·세션] 정기 회차가 오늘 파일을 연 뒤에도 손 실행은 남은 정기 몫을 침범하지 못한다',
    !sched.m.ok && (sched.m.errorCode ?? '').endsWith('SCHEDULED_RESERVE'), sched.m.errorCode ?? '')
  const fresh = await inHome({ mark: true, label: false, clock: afterLast(D6) }, async () => {
    const s = new SupplyLlmSession({ runId: 'FRESH', limits: LIM50, now: at(afterLast(D6)) })
    return s.call(ASK)
  })
  check('[오늘 없음·세션] 🟢 최근 장부가 없는 새 장부(마지막 창 뒤)는 막지 않는다', fresh.ok, fresh.errorCode ?? '')
  const vanish = await inHome({ mark: true, label: false, clock: afterLast(D6) }, async () => {
    const d = defaultLedgerDir()
    let locks = 0
    const io: LedgerIo = {
      ...REAL_LEDGER_IO,
      withLock: <T,>(dir: string, fn: () => T): T => {
        locks += 1
        // 🔴 사전 계산 줄을 적은 잠금과 판정 잠금 **사이**에 오늘 파일을 옮긴다
        if (locks === 2) unlinkSync(ledgerPathOf(d, D6))
        return REAL_LEDGER_IO.withLock(dir, fn)
      },
    }
    const b0 = paidFetches
    const r = await new SupplyLlmSession({ runId: 'VANISH', limits: LIM50, io, now: at(afterLast(D6)) }).call(ASK)
    return { r, paid: paidFetches - b0 }
  })
  check('🔴 [오늘 없음·세션] 사전 계산 뒤 판정 전에 오늘 파일이 사라지면 빈 장부로 읽지 않는다 → LEDGER_ERROR · 유료 0',
    !vanish.r.ok && (vanish.r.errorCode ?? '').endsWith('LEDGER_ERROR') && vanish.paid === 0, vanish.r.errorCode ?? '')
  // 🔴 다른 장부(댓글 루프 · 사후 감사처럼 자기 dir 를 주는 세션)는 이 규칙을 타지 않는다 — 별도 예산이다
  const other = mkdtempSync(join(tmpdir(), 'reserve-j3-other-'))
  putRows(other, D5, pastDay(D5))
  const o = await new SupplyLlmSession({ runId: 'OTHER', dir: other, limits: LIM50, now: at(gapAfter(D6, MID)) }).call(ASK)
  check('[오늘 없음] 🟢 다른 장부(자기 dir · 댓글·감사 같은 별도 예산)는 영향 없음 — 오늘 파일이 없어도 돈다',
    o.ok, o.errorCode ?? '')
  rmSync(other, { recursive: true, force: true })
}
{
  // ⓓ 🔴 적용 한도·env 출처 기록 — 승인 천장 직전까지 사용 · 손 실행이 env 를 $5 로 덮음
  const pv = budgetEnvProvenance({ [BUDGET_ENV.dailyUsd]: '5', [BUDGET_ENV.runRequestCap]: '20', [BUDGET_ENV.headroomMultiplier]: '1.2' },
    `${BUDGET_ENV.dailyUsd}=0.50\n${BUDGET_ENV.runRequestCap}="20"\n${BUDGET_ENV.headroomMultiplier}=1.2\n`)
  check('🔴 [출처] .env.local 0.50 · 프로세스 5 → process-override · 다른 두 키는 env.local',
    pv.sources.dailyUsd === 'process-override' && pv.sources.runRequestCap === 'env.local' && pv.sources.headroomMultiplier === 'env.local'
    && pv.overrides.length === 1 && pv.overrides[0]?.envLocal === '0.50' && pv.overrides[0]?.process === '5', JSON.stringify(pv))
  check('[출처] 0.5 와 0.50 은 같은 값(숫자 비교) · 파일에 키가 없으면 process · 값이 없으면 missing · 못 읽으면 unknown',
    budgetEnvProvenance({ [BUDGET_ENV.dailyUsd]: '0.5' }, `${BUDGET_ENV.dailyUsd}=0.50`).sources.dailyUsd === 'env.local'
    && budgetEnvProvenance({ [BUDGET_ENV.dailyUsd]: '0.5' }, '').sources.dailyUsd === 'process'
    && budgetEnvProvenance({ [BUDGET_ENV.dailyUsd]: '0.5' }, null).sources.dailyUsd === 'process'
    && budgetEnvProvenance({}, `${BUDGET_ENV.dailyUsd}=0.50`).sources.dailyUsd === 'missing'
    && budgetEnvProvenance({ [BUDGET_ENV.dailyUsd]: '0.5' }, undefined).sources.dailyUsd === 'unknown')

  const envDir = mkdtempSync(join(tmpdir(), 'reserve-j4-env-'))
  const envFile = join(envDir, '.env.local')
  writeFileSync(envFile, `${BUDGET_ENV.dailyUsd}=0.50\n${BUDGET_ENV.runRequestCap}=1000\n${BUDGET_ENV.headroomMultiplier}=${HEAD}\n`)
  const prevDaily = process.env[BUDGET_ENV.dailyUsd]
  process.env[BUDGET_ENV.dailyUsd] = '5'
  const warned: string[] = []
  const realWarn = console.warn
  console.warn = (...a: unknown[]) => { warned.push(a.map(String).join(' ')) }
  const LIM5 = limOf(5)
  try {
    const res = await inHome({ mark: true, label: false, clock: afterLast(D) }, async () => {
      const d = defaultLedgerDir()
      // 승인 천장 직전 모양 — 이미 $1.1978 을 썼다
      putRows(d, D, [line({ usd: 1.1978, kind: 'scheduled', slot: slotLabel(D, MID), at: slotAt(D, MID, 5) })])
      const s = new SupplyLlmSession({ runId: 'OVR', limits: LIM5, now: at(afterLast(D)), envLocalPath: envFile })
      const b0 = paidFetches
      const r = await s.call(ASK)
      const day = readLedgerDay(ledgerPathOf(d, D))
      const row = day.ok ? day.entries.find((e) => e.runId === 'OVR' && e.stage !== 'countTokens') : undefined
      return { r, paid: paidFetches - b0, row, text: s.describe() }
    })
    check('🔴 [상한 재현] 오늘 $1.1978 사용 · 손 실행이 env 를 $5 로 덮어도 막힌다 — min(env, 천장 $1.20) · 유료 0',
      !res.r.ok && (res.r.errorCode ?? '').endsWith('SCHEDULED_RESERVE') && res.paid === 0, res.r.errorCode ?? '')
    check('🔴 [기록] 막힌 예약 줄에 적용 한도가 남는다 — env $5 · 천장 $1.20 · 적용 $1.20 · 출처 process-override',
      res.row !== undefined && res.row.budgetDailyUsd === 5 && res.row.budgetCeilingUsd === supplyApprovedDailyUsdOf(D)
      && res.row.budgetCapUsd === supplyApprovedDailyUsdOf(D) && res.row.budgetSource === 'process-override', JSON.stringify(res.row))
    check('🔴 [경고] 프로세스가 .env.local 예산을 덮으면 세션이 한 번 경고한다(키 이름 · 두 값)',
      warned.length === 1 && warned[0]!.includes(BUDGET_ENV.dailyUsd) && warned[0]!.includes('0.50') && warned[0]!.includes('프로세스 5'), warned.join('|'))
    check('[기록] 사람이 읽는 줄에도 적용 한도·출처가 적힌다', /적용 한도/.test(res.text) && /process-override/.test(res.text), res.text)
    const okRun = await inHome({ mark: true, label: false, clock: afterLast(D) }, async () => {
      const d = defaultLedgerDir()
      const s = new SupplyLlmSession({ runId: 'OVR2', limits: LIM5, now: at(afterLast(D)), envLocalPath: envFile })
      let n = 0
      for (let i = 0; i < 400 && (await s.call(ASK)).ok; i += 1) n += 1
      const day = readLedgerDay(ledgerPathOf(d, D))
      const t = day.ok ? tallyOf(day.entries) : null
      const settledRow = day.ok ? day.entries.find((e) => e.runId === 'OVR2' && e.status === 'settled' && e.stage !== 'countTokens') : undefined
      return { n, t, settledRow }
    })
    check('🔴 [상한 재현] 빈 장부에서 env $5 로 덮고 계속 불러도 합계(정산+열린 예약) ≤ $1.20',
      okRun.n > 0 && okRun.t !== null && okRun.t.settledUsd + okRun.t.openReservedUsd <= (supplyApprovedDailyUsdOf(D) ?? 0) + 1e-12,
      `n=${okRun.n} settled=${okRun.t?.settledUsd} open=${okRun.t?.openReservedUsd}`)
    check('[기록] 정산 줄(접은 뒤 이기는 줄)에도 같은 한도가 남는다',
      okRun.settledRow?.budgetCapUsd === supplyApprovedDailyUsdOf(D) && okRun.settledRow?.budgetSource === 'process-override')
  } finally {
    console.warn = realWarn
    if (prevDaily === undefined) delete process.env[BUDGET_ENV.dailyUsd]; else process.env[BUDGET_ENV.dailyUsd] = prevDaily
    rmSync(envDir, { recursive: true, force: true })
  }
  // 🔴 하위호환 — 한도 칸이 없는 옛 줄과 있는 새 줄이 한 파일에 섞여도 읽힌다 · 다른 장부 줄에는 칸이 없다
  const mix = mkdtempSync(join(tmpdir(), 'reserve-j4-mix-'))
  appendLedgerLine(ledgerPathOf(mix, D), line({ usd: 0.01 }))
  appendLedgerLine(ledgerPathOf(mix, D), {
    ...line({ usd: 0.02 }), budgetDailyUsd: 0.5, budgetCeilingUsd: 0.5, budgetCapUsd: 0.5, budgetSource: 'env.local',
  })
  const mixed = readLedgerDay(ledgerPathOf(mix, D))
  check('[하위호환] 옛 줄(한도 칸 없음)과 새 줄이 섞인 장부를 읽고 합계가 같다',
    mixed.ok && mixed.entries.length === 2 && Math.abs(tallyOf(mixed.entries).settledUsd - 0.03) < 1e-12)
  await new SupplyLlmSession({ runId: 'PLAIN', dir: mix, limits: LIM50, now: at(afterLast(D)) }).call(ASK)
  const plain = readLedgerDay(ledgerPathOf(mix, D))
  check('[하위호환] 다른 장부(자기 dir) 줄의 모양은 그대로다 — 한도 칸을 싣지 않는다',
    plain.ok && plain.entries.some((e) => e.runId === 'PLAIN')
    && plain.entries.filter((e) => e.runId === 'PLAIN').every((e) => !('budgetCapUsd' in e) && !('budgetSource' in e)))
  rmSync(mix, { recursive: true, force: true })
}

globalThis.fetch = realFetch
if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail\n`)
process.exit(fail === 0 ? 0 : 1)
