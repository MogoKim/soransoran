#!/usr/bin/env tsx
/**
 * 바퀴마다 공급 — 🔴 **네트워크 0 · 실제 provider 0 · 운영 env·장부 0 · DB 0** (쓰기는 mkdtemp 안에서만)
 *
 * 재는 것 (정책 하나에 절 하나):
 *   ① 공급 회차는 바퀴마다 한 번, 그 바퀴의 수집 뒤 · 다음 바퀴의 수집 전에 뜬다 — 시각은 바퀴 표에서 계산된다
 *   ② 그 시각에 뜬 회차를 러너가 정기 회차로 판정한다 · 회차 창은 겹치지 않고 자정을 넘지 않는다
 *   ③ 그날 결정(controller · 01:50)이 직전 공급 회차를 기다렸다가 판정할 예약을 갖고 있다 ·
 *      결정 전 새벽 자리의 감사가 한 번 다시 돈 뒤에 결정한다
 *   ④ 예산은 남은 예산 ÷ 남은 회차다 — 회차 수가 바뀌어도 식이 그대로다
 *   ⑤ 새 시각표로 하루를 정상 운영한 장부는 비용 증거가 모름(COST_UNKNOWN)이 아니다 ·
 *      시각표를 바꾸기 전날의 장부도 그대로 읽힌다 · 손 실행 · 다른 회차 표식은 여전히 모름으로 닫힌다
 *   ⑥ 수집기가 쓰는 중인 파일은 공급의 입력으로 잡히지 않는다
 *
 * 변이 시험은 `supply-cycle-mutation.mts` — 막는 줄을 지우면 이 검사가 FAIL 한다.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CYCLES, CYCLE_MINUTES, HEARTBEAT_INTERVAL_MINUTES, STAGE_DECISION_BASE_MINUTE, SUPPLY_AFTER_COLLECT_MINUTES, SUPPLY_CYCLE_MINUTES, cycleLabel,
} from '../src/lib/cycle-schedule'
import { profileOf } from '../src/lib/scale-profile'
import type { LedgerEntry } from '../src/lib/llm-ledger'
import { judgeStageEvidence, type EvidenceSideSignals } from '../src/lib/stage-evidence'
import { supplyCostContractOf } from '../src/lib/supply-cost-envelope'
import { planPending, hasWork } from '../src/lib/supply-process'
import { budgetWindowShadowOf, supplyRunIdOf } from '../src/lib/supply-run-token'
import { SUPPLY_RUNS_PER_DAY, SUPPLY_RUN_SLOTS_KST, SUPPLY_RUN_WINDOW_MS, type SupplyRunSlot } from '../src/lib/supply-schedule-contract'
import {
  LAUNCHD_LABEL_ENV, SUPPLY_PROCESS_LAUNCHD_LABEL, supplyRunKindOf, supplySpendProtectAt,
} from '../src/lib/supply-scheduled-reserve'
import { partialPathOf, writeJsonlAtomic } from './lib/atomic-jsonl.mjs'
import { ledgerPathOf } from './lib/llm-ledger-store.mjs'
import { STAGE_CONTROLLER_FINAL_DECISION_MINUTE_KST, stageControllerLeaseDisposition, stageControllerSlots } from './lib/ops-loop-templates'
import { auditRunnerSlots } from './lib/auto-ready-audit-template'
import { readCostSignals } from './lib/ops-signals.mjs'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else { fail += 1; console.log(`  🔴 FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`) }
}
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9

const WINDOW_MIN = SUPPLY_RUN_WINDOW_MS / 60_000
const SLOT_MIN = SUPPLY_RUN_SLOTS_KST.map((s) => s.hour * 60 + s.minute)
const LABEL = { [LAUNCHD_LABEL_ENV]: SUPPLY_PROCESS_LAUNCHD_LABEL }
/** KST 날짜 `date` 의 자정에서 `minute` 분 뒤 */
const at = (date: string, minute: number, second = 0): Date =>
  new Date(Date.parse(`${date}T00:00:00.000+09:00`) + minute * 60_000 + second * 1000)
const DAY = '2026-11-21'

console.log('\n══ 바퀴마다 공급 — 시각 · 정기 회차 · 예산 · 비용 증거 · 겹침 ══')

// ─────────────────────────────────────────────────────────
console.log('\n① 공급 회차는 바퀴마다 한 번 — 그 바퀴의 수집 뒤 · 다음 바퀴의 수집 전')
// ─────────────────────────────────────────────────────────
check(`회차 수 = 바퀴 수(${CYCLES.length})`, SUPPLY_RUNS_PER_DAY === CYCLES.length && SLOT_MIN.length === CYCLES.length)
check('회차 시각 = 바퀴 시각 + 공급 지연(한 상수)',
  SLOT_MIN.every((m, i) => m === CYCLE_MINUTES[i]! + SUPPLY_AFTER_COLLECT_MINUTES)
  && SUPPLY_CYCLE_MINUTES.every((m, i) => m === SLOT_MIN[i]),
  SLOT_MIN.map(cycleLabel).join(' '))
check('회차마다 그 바퀴의 수집보다 뒤에 뜬다', SLOT_MIN.every((m, i) => m > CYCLE_MINUTES[i]!))
check('회차마다 다음 바퀴의 수집보다 먼저 뜬다 — 한 바퀴를 건너뛰어 두 바퀴 글을 한꺼번에 받지 않는다',
  SLOT_MIN.every((m, i) => i === SLOT_MIN.length - 1 ? m < 24 * 60 : m < CYCLE_MINUTES[i + 1]!))

// ─────────────────────────────────────────────────────────
console.log('\n② 그 시각에 뜬 회차가 정기 회차다 · 창은 겹치지 않는다')
// ─────────────────────────────────────────────────────────
{
  const kindAt = (minute: number, startMinute = minute) => supplyRunKindOf(LABEL, at(DAY, minute), undefined, undefined, at(DAY, startMinute))
  const labels = SLOT_MIN.map((m) => kindAt(m).slot)
  check('회차 시각에 시작한 launchd 회차 → 정기', SLOT_MIN.every((m) => kindAt(m).kind === 'scheduled'))
  check('회차마다 서로 다른 정기 회차 이름을 받는다', new Set(labels).size === SLOT_MIN.length && labels.every((l) => l !== null))
  check('창 마지막 분의 요청도 같은 회차다', SLOT_MIN.every((m, i) => kindAt(m + WINDOW_MIN - 1, m).slot === labels[i]))
  check('창이 끝난 뒤의 요청은 정기가 아니다(다음 회차가 이어받는다)', SLOT_MIN.every((m) => {
    const k = kindAt(m + WINDOW_MIN, m)
    return k.kind === 'manual'
  }))
  check('수집이 뜨는 분(바퀴 시각)에 시작한 회차는 정기가 아니다 — 공급 job 이 옛 시각에 남으면 유료 요청이 나가지 않는다',
    CYCLE_MINUTES.every((m) => kindAt(m).kind === 'manual'))
  check('창이 다음 회차 시각 전에 끝난다(겹치지 않는다)', SLOT_MIN.every((m, i) => i === SLOT_MIN.length - 1 || m + WINDOW_MIN <= SLOT_MIN[i + 1]!))
  check('마지막 회차의 창이 자정을 넘지 않는다 — 한 회차의 지출이 두 날 장부에 갈리지 않는다', SLOT_MIN[SLOT_MIN.length - 1]! + WINDOW_MIN <= 24 * 60)
  check('라벨 없는 실행은 회차 시각이어도 손 실행이다', supplyRunKindOf({}, at(DAY, SLOT_MIN[0]!)).kind === 'manual')
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 그날 결정은 직전 공급 회차를 기다렸다가 판정할 예약이 있다')
// ─────────────────────────────────────────────────────────
{
  const controller = stageControllerSlots().map((s) => s.hour * 60 + s.minute)
  const before = SLOT_MIN.filter((m) => m < STAGE_CONTROLLER_FINAL_DECISION_MINUTE_KST)
  const lastEnd = Math.max(...before) + WINDOW_MIN
  check('결정 전 공급 회차가 있다(자정 뒤 첫 바퀴)', before.length > 0, before.map(cycleLabel).join(' '))
  check('결정 전 마지막 공급 회차의 유료 창이 최종 결정 시각 전에 끝난다',
    lastEnd <= STAGE_CONTROLLER_FINAL_DECISION_MINUTE_KST, `${cycleLabel(lastEnd)} ≤ ${cycleLabel(STAGE_CONTROLLER_FINAL_DECISION_MINUTE_KST)}`)
  const retry = controller.filter((m) => m >= lastEnd && stageControllerLeaseDisposition('busy', at(DAY, m)) === 'defer')
  check('그 창이 끝난 뒤에도 "미루기"가 가능한 결정 예약이 남아 있다 — 공급이 도는 중이어도 안전 HOLD 로 바로 떨어지지 않는다',
    retry.length > 0, `창 끝 ${cycleLabel(lastEnd)} · 예약 ${controller.map(cycleLabel).join(' ')}`)
  check('공급이 도는 동안의 결정 예약은 미룬다(HOLD 아님)',
    controller.filter((m) => m < lastEnd).every((m) => stageControllerLeaseDisposition('busy', at(DAY, m)) === 'defer'))
  /**
   * 🔴 결정 기준(01:50)은 결정 전에 나간 새벽 자리의 감사가 **한 번 다시 돈 뒤**다 — 재시도 회차 + 한 틱 ≤ 기준.
   *    재시도 가능 감사 실패 한 건은 그날 품질 신호를 나쁨으로 만든다(`qualitySignalOf`). 첫 감사가 제공사 일시 오류로
   *    한 번 실패해도 재시도가 결정 전에 끝나야 그 한 번이 그날 단계를 굳히지 않는다. 자리는 정본(profileOf) · 감사는 정본 예약표.
   */
  {
    const audits = auditRunnerSlots().map((s) => s.hour * 60 + s.minute)
    const seen: string[] = []
    const late: string[] = []
    for (const st of ['d20', 'd30', 'd50'] as const) {
      for (const m of profileOf(st).slots.map((s) => s.hour * 60 + s.minute).filter((x) => x < STAGE_DECISION_BASE_MINUTE)) {
        const retry = audits.filter((a) => a > m)[1]
        seen.push(`${st} ${cycleLabel(m)}`)
        if (retry === undefined || retry + HEARTBEAT_INTERVAL_MINUTES > STAGE_DECISION_BASE_MINUTE) {
          late.push(`${st} ${cycleLabel(m)} → 재시도 ${retry === undefined ? '없음' : cycleLabel(retry)}`)
        }
      }
    }
    check('결정 첫 예약 = 결정 기준(STAGE_DECISION_BASE_MINUTE) · 결정 전에 나가는 새벽 자리가 실제로 있다(관계가 헛돌지 않는다)',
      controller[0] === STAGE_DECISION_BASE_MINUTE && seen.length > 0, seen.join(' · '))
    check('🔴 결정 기준은 결정 전 새벽 자리(d20·d30·d50)의 감사 재시도 + 한 틱 뒤다 — 감사 한 번의 일시 실패가 그날 단계를 굳히지 않는다',
      late.length === 0, late.join(' · '))
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 예산 — 남은 예산 ÷ 남은 회차')
// ─────────────────────────────────────────────────────────
function entry(o: Partial<LedgerEntry>): LedgerEntry {
  return {
  runId: 'x', stage: 'draftGen', attemptId: 'a', requestNo: 0,
  provider: 'google', apiModelId: 'm', model: 'm', status: 'settled', blockCode: null,
  countedInputTokens: 100, maxOutputTokens: 1024, reservedUsd: 0.006, inputTokens: 100, outputTokens: 200,
  cacheWriteTokens: null, cacheReadTokens: null, usageKeys: [], settledUsd: 0.004, pricingVersion: null,
  startedAt: '', endedAt: null, errorCode: null, ...o,
  }
}
{
  const CAP = 1.8
  const N = SLOT_MIN.length
  const spent = (slotLabel: string | null, usd: number, i: number): LedgerEntry => entry({
    attemptId: `s-${i}`, settledUsd: usd, reservedUsd: usd,
    ...(slotLabel === null ? { runKind: 'manual', runSlot: null } : { runKind: 'scheduled', runSlot: slotLabel }),
  })
  const protectAt = (minute: number, env: Record<string, string>, today: LedgerEntry[], slots?: readonly SupplyRunSlot[]) =>
    supplySpendProtectAt({ env, now: at(DAY, minute), todayEntries: today, dailyUsd: CAP, ceilingUsd: CAP, ...(slots === undefined ? {} : { slots }) })
  /** 이 요청이 쓸 수 있는 금액 = 천장 − 오늘 쓴 것 − 남겨 둔 몫 */
  const roomOf = (p: ReturnType<typeof protectAt>, today: LedgerEntry[]): number =>
    CAP - today.reduce((s, e) => s + (e.settledUsd ?? 0), 0) - p.protect.reservedForOthersUsd

  const first = protectAt(SLOT_MIN[0]! + 1, LABEL, [])
  check('하루 첫 회차의 몫 = 천장 ÷ 회차 수', first.kind === 'scheduled' && near(roomOf(first, []), CAP / N), `$${roomOf(first, []).toFixed(4)}`)

  const third = protectAt(SLOT_MIN[2]! + 1, LABEL, [])
  check('앞 회차가 덜 쓴 몫은 남은 회차에 똑같이 넘어간다', near(roomOf(third, []), CAP / (N - 2)), `$${roomOf(third, []).toFixed(4)}`)

  const label0 = first.slot!
  const busy = [spent(label0, 0.5, 0)]
  const afterBusy = protectAt(SLOT_MIN[1]! + 1, LABEL, busy)
  check('끝난 회차가 쓴 금액은 남은 예산에서 빠진다', near(roomOf(afterBusy, busy), (CAP - 0.5) / (N - 1)), `$${roomOf(afterBusy, busy).toFixed(4)}`)

  const own = [spent(afterBusy.slot!, 0.05, 1)]
  const mid = protectAt(SLOT_MIN[1]! + 2, LABEL, own)
  check('회차는 자기가 이미 쓴 것만큼만 자기 몫이 준다(다른 회차 몫은 그대로)', near(roomOf(mid, own), CAP / (N - 1) - 0.05), `$${roomOf(mid, own).toFixed(4)}`)

  const manualDuring = protectAt(SLOT_MIN[1]! + 3, {}, own)
  check('도는 회차가 이미 쓴 금액은 손 실행에게 남기는 몫에서 한 번만 빠진다(쓸 수 있는 금액은 0 — 음수가 아니다)',
    near(manualDuring.protect.reservedForOthersUsd, CAP - 0.05) && near(roomOf(manualDuring, own), 0), `$${manualDuring.protect.reservedForOthersUsd.toFixed(4)}`)

  const manual = protectAt(SLOT_MIN[4]! + 1, {}, [])
  check('손 실행은 남은 회차 전부의 몫을 남긴다 — 쓸 수 있는 금액 0', manual.kind === 'manual' && near(roomOf(manual, []), 0))

  const lastMinute = SLOT_MIN[N - 1]!
  const afterLast = protectAt(lastMinute + WINDOW_MIN, {}, [])
  check('마지막 회차의 창이 끝나면 남은 예산이 풀린다', near(afterLast.protect.reservedForOthersUsd, 0) && near(roomOf(afterLast, []), CAP))

  // 하루를 끝까지 — 회차마다 자기 몫을 전부 쓴다
  {
    const today: LedgerEntry[] = []
    let ok = true
    SLOT_MIN.forEach((m, i) => {
      const p = protectAt(m + 1, LABEL, today)
      const room = roomOf(p, today)
      if (room < -1e-9 || p.slot === null) ok = false
      today.push(spent(p.slot, Math.max(0, room), 100 + i))
    })
    const total = today.reduce((s, e) => s + (e.settledUsd ?? 0), 0)
    check('회차마다 몫을 전부 써도 하루 합은 천장을 넘지 않고, 마지막 회차까지 몫이 남아 있다',
      ok && total <= CAP + 1e-9 && today.every((e) => (e.settledUsd ?? 0) > 0), `$${total.toFixed(4)}`)
  }

  // 회차 수가 바뀌어도 식은 그대로다 — 다른 시각표(5회)를 넣어 본다
  {
    const five: SupplyRunSlot[] = [2, 7, 12, 17, 21].map((hour) => ({ hour, minute: 0 }))
    const p = protectAt(2 * 60 + 1, LABEL, [], five)
    check('회차가 5회인 시각표에서는 첫 몫이 천장 ÷ 5 다(회차 수를 코드에 적지 않았다)', p.kind === 'scheduled' && near(roomOf(p, []), CAP / 5))
  }
  check('사람이 읽는 한 줄에 남은 예산 · 남은 회차 · 회차 몫이 있다', /남은 예산 \$[\d.]+ ÷ 남은 회차 \d+개 = 회차 몫 \$[\d.]+/.test(first.protect.reason), first.protect.reason)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 비용 증거 — 새 시각표의 정상 운영일은 모름이 아니다')
// ─────────────────────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'supply-cycle-check-'))
try {
  const BUDGET = 1.8
  /**
   * 그날 그 분에 뜬 정기 회차가 남기는 유료 요청 한 줄.
   * 🔴 회차 이름 · 예산 창은 **요청 순간의 실제 판정**(`supplyRunKindOf` · `budgetWindowShadowOf`)이 준 값이다 — 손으로 적지 않는다.
   */
  const scheduledLine = (date: string, slotMinute: number, i: number, slots: readonly SupplyRunSlot[] = SUPPLY_RUN_SLOTS_KST, o: Partial<LedgerEntry> = {}): LedgerEntry => {
    const runAt = at(date, slotMinute, 4)
    const startedAt = at(date, slotMinute + 1 + (i % 20), i % 50)
    const kind = supplyRunKindOf(LABEL, startedAt, slots, undefined, runAt)
    const contract = supplyCostContractOf(date)!
    return entry({
      runId: `${supplyRunIdOf(runAt)}-${i % 2 === 0 ? 'j' : 'd'}`, stage: i % 2 === 0 ? 'judge' as LedgerEntry['stage'] : 'draftGen',
      attemptId: `${date}-${slotMinute}-${i}`, requestNo: i,
      startedAt: startedAt.toISOString(), endedAt: new Date(startedAt.getTime() + 20_000).toISOString(),
      runKind: kind.kind, runSlot: kind.slot,
      runTokenShadow: {
        ok: true, code: null, tokenId: `t-${date}-${slotMinute}`, trigger: 'scheduled', launchTrigger: 'scheduled',
        absorbedTrigger: null, absorbedAt: null, pass: 0, budgetWindow: budgetWindowShadowOf(startedAt, slots),
      },
      supplyContract: contract.supplyContract, pricingVersion: contract.pricingVersion, sourceKey: `src-${i}`,
      budgetDailyUsd: BUDGET, budgetCeilingUsd: BUDGET, budgetCapUsd: BUDGET, budgetSource: 'env.local',
      ...o,
    })
  }
  let dirSeq = 0
  /** controller 가 전날을 판정할 때와 같은 길 — 장부 파일 → `readCostSignals` → `judgeStageEvidence` */
  const evidenceOf = (date: string, lines: LedgerEntry[]) => {
    const dir = join(tmp, `ledger-${dirSeq += 1}`)
    const empty = join(tmp, `empty-${dirSeq}`)
    for (const d of [dir, empty]) mkdirSync(d, { recursive: true })
    writeFileSync(ledgerPathOf(dir, date), lines.map((l) => `${JSON.stringify(l)}\n`).join(''), 'utf-8')
    const c = readCostSignals(new Date(`${date}T12:00:00+09:00`), 'd30', { SORAN_LLM_DAILY_BUDGET_USD: String(BUDGET) }, { supply: dir, audit: empty, comment: empty })
    const side: EvidenceSideSignals = {
      cost: [{ lane: 'comment', name: '댓글 장부', health: 'ok' }, { lane: 'audit', name: '감사 장부', health: 'ok' }],
      supplyCostEvidence: c.supplyCostEvidence,
    }
    const verdict = judgeStageEvidence(date, 'd30', null, side)
    return { evidence: c.supplyCostEvidence, codes: verdict.codes as readonly string[] }
  }
  const costCodes = (codes: readonly string[]): string => codes.filter((c) => c.startsWith('COST_')).join(',') || '없음'

  // (가) 새 시각표로 하루 — 13회차 전부 2건씩
  {
    const lines = SLOT_MIN.flatMap((m, s) => [0, 1].map((k) => scheduledLine(DAY, m, s * 2 + k)))
    const r = evidenceOf(DAY, lines)
    check('회차마다 요청이 실제로 정기 회차로 기록됐다(fixture 가 실제 판정을 지났다)', lines.every((l) => l.runKind === 'scheduled' && typeof l.runSlot === 'string'))
    check(`정상 운영일(회차 ${SLOT_MIN.length}개 전부) → 비용 코드 없음`, !r.codes.includes('COST_UNKNOWN') && !r.codes.includes('COST_BAD'), costCodes(r.codes))
    check('회차 전부가 비용 표본에 든다 — 새벽 · 밤 회차도 뺀 것이 없다',
      r.evidence?.envelope.settledRequests === lines.length && r.evidence.envelope.ineligibleRequests === 0,
      `정산 ${r.evidence?.envelope.settledRequests} · 귀속 불명 ${r.evidence?.envelope.ineligibleRequests}`)
    check('비용 증거의 예산은 그날 기록된 하루 상한이다', r.evidence?.envelope.budgetUsd === BUDGET && r.evidence.wholeDayCriticalHealth === 'ok')
  }
  // (나) 새벽 회차만 돈 날(아침에 판정하는 날의 앞부분) · 밤 회차만 돈 날
  {
    const dawn = evidenceOf(DAY, [scheduledLine(DAY, SLOT_MIN[0]!, 0), scheduledLine(DAY, SLOT_MIN[1]!, 1)])
    check('새벽 회차 요청만 있는 장부 → 비용 코드 없음', costCodes(dawn.codes) === '없음', costCodes(dawn.codes))
    const night = evidenceOf(DAY, [scheduledLine(DAY, SLOT_MIN[SLOT_MIN.length - 1]!, 0)])
    check('마지막(밤) 회차 요청만 있는 장부 → 비용 코드 없음', costCodes(night.codes) === '없음', costCodes(night.codes))
  }
  // (다) 시각표를 바꾸기 전날 — 그날의 시각표(다른 시각)로 쌓인 장부를 지금 코드가 읽는다
  {
    const OLD_DAY = '2026-11-20'
    const old: SupplyRunSlot[] = [[6, 15], [8, 15], [12, 15], [14, 15], [17, 15], [21, 15], [22, 15]].map(([hour, minute]) => ({ hour: hour!, minute: minute! }))
    const lines = old.flatMap((s, n) => [0, 1].map((k) => scheduledLine(OLD_DAY, s.hour * 60 + s.minute, n * 2 + k, old)))
    const r = evidenceOf(OLD_DAY, lines)
    check('옛 시각표의 회차 시각은 지금 시각표에 없다(전환일 조건)', old.some((s) => !SLOT_MIN.includes(s.hour * 60 + s.minute)))
    check('시각표를 바꾸기 전날의 장부 → 비용 코드 없음 — 증거는 지금 시각표를 읽지 않는다',
      costCodes(r.codes) === '없음' && r.evidence?.envelope.settledRequests === lines.length, `${costCodes(r.codes)} · 귀속 불명 ${r.evidence?.envelope.ineligibleRequests}`)
  }
  // (라) 반례 — 느슨해지지 않았다
  {
    const good = SLOT_MIN.slice(0, 3).map((m, i) => scheduledLine(DAY, m, i))
    const manualAt = at(DAY, SLOT_MIN[3]! + WINDOW_MIN + 5)
    const manual = scheduledLine(DAY, SLOT_MIN[3]!, 90, SUPPLY_RUN_SLOTS_KST, {
      runId: `${supplyRunIdOf(manualAt)}-d`, startedAt: manualAt.toISOString(), runKind: 'manual', runSlot: null,
      runTokenShadow: { ok: true, code: null, tokenId: 'm', trigger: 'manual', launchTrigger: 'manual', absorbedTrigger: null, absorbedAt: null, pass: 0, budgetWindow: budgetWindowShadowOf(manualAt) },
    })
    const rManual = evidenceOf(DAY, [...good, manual])
    check('손 실행 유료 요청이 섞인 날 → COST_UNKNOWN', rManual.codes.includes('COST_UNKNOWN') && rManual.evidence?.envelope.ineligibleRequests === 1, costCodes(rManual.codes))

    const otherSlot = scheduledLine(DAY, SLOT_MIN[3]!, 91)
    const wrongLabel = { ...otherSlot, runSlot: good[0]!.runSlot }
    const rLabel = evidenceOf(DAY, [...good, wrongLabel])
    check('회차 id 와 회차 표식이 서로 다른 회차를 말하는 요청 → COST_UNKNOWN', rLabel.codes.includes('COST_UNKNOWN'), costCodes(rLabel.codes))

    // 표식 · 요청 시각 · 예산 창은 전부 넷째 회차인데 회차 id 만 첫 회차 시각이다
    const rRunId = evidenceOf(DAY, [...good, { ...otherSlot, runId: good[0]!.runId }])
    check('회차 id 의 시각이 표식한 회차의 창 밖인 요청 → COST_UNKNOWN',
      rRunId.codes.includes('COST_UNKNOWN') && rRunId.evidence?.envelope.ineligibleRequests === 1, costCodes(rRunId.codes))

    const lateStart = at(DAY, SLOT_MIN[3]! + WINDOW_MIN + 1)
    const late = scheduledLine(DAY, SLOT_MIN[3]!, 92, SUPPLY_RUN_SLOTS_KST, { startedAt: lateStart.toISOString() })
    const rLate = evidenceOf(DAY, [...good, { ...late, runKind: 'scheduled', runSlot: otherSlot.runSlot }])
    check('회차 창이 끝난 뒤 시작한 요청을 그 회차로 적은 줄 → COST_UNKNOWN', rLate.codes.includes('COST_UNKNOWN'), costCodes(rLate.codes))

    const over = scheduledLine(DAY, SLOT_MIN[3]!, 93, SUPPLY_RUN_SLOTS_KST, { settledUsd: 0.02, reservedUsd: 0.006 })
    const rOver = evidenceOf(DAY, [...good, over])
    check('정산액이 예약액을 넘은 요청 → COST_BAD · 비용 표본에도 초과 1건으로 남는다',
      rOver.codes.includes('COST_BAD') && rOver.evidence?.envelope.overrunRequests === 1, costCodes(rOver.codes))
  }

  // ─────────────────────────────────────────────────────────
  console.log('\n⑥ 수집기가 쓰는 중인 파일은 공급의 입력이 아니다')
  // ─────────────────────────────────────────────────────────
  {
    const dir = mkdtempSync(join(tmp, 'data-'))
    const thin = join(dir, 'navercafe-thin-wgang-20261121-082000.thin-detail.jsonl')
    const partial = partialPathOf(thin)
    // 쓰는 중 — 임시 파일만 있다
    writeFileSync(partial, '{"id":"1"}\n{"id":"2', 'utf-8')
    check('쓰는 중(임시 파일만 있는 상태)에는 공급이 그 바퀴 파일을 계획하지 않는다', !hasWork(planPending(readdirSync(dir))), readdirSync(dir).join(' '))
    rmSync(partial)
    writeJsonlAtomic(thin, [{ id: '1' }, { id: '2' }, { id: '3' }])
    check('다 쓴 뒤에는 전부가 한 번에 보인다 — 행 수가 맞고 임시 파일이 남지 않는다',
      readFileSync(thin, 'utf-8').trim().split('\n').length === 3 && readdirSync(dir).length === 1, readdirSync(dir).join(' '))
    check('다 쓴 파일은 공급의 미처리 입력으로 계획된다', hasWork(planPending(readdirSync(dir))))
    let threw = false
    try { writeJsonlAtomic(join(dir, 'no-such-dir', 'navercafe-thin-wgang-x.thin-detail.jsonl'), [{ id: '1' }]) } catch { threw = true }
    check('쓰기에 실패하면 던지고 최종 파일을 만들지 않는다(다음 바퀴가 그 글을 다시 연다)', threw && readdirSync(dir).length === 1)
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail\n`)
process.exit(fail === 0 ? 0 : 1)
