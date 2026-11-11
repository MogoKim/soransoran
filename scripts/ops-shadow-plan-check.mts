#!/usr/bin/env tsx
/**
 * 🔴 **ops shadow S1/S2 검사** (2026-11-11) — DB · 네트워크 · provider 0.
 *
 *   ① replay — 11-07~11-11 자연 공급 30회차: shadow 부족분 · 유료 원천 수가 운영 결정과 같다(같은 권위 함수)
 *   ② 결정성 — 같은 입력이면 같은 계획 · 같은 해시 · 입력 순서 무관
 *   ③ 성질 — 가상 묶음 ≤ 묶음·신선·화자·요청 상한 · 가상 지출 ≤ 속도 천장 ≤ 하루 예산 · 지출 권위 보류 사유면 0
 *   ④ 봉투 상한 — 발행 > 봉투 상한은 계획·controller 의도와 무관하게 언제나 감지한다 · 글당 댓글 > 10 감지
 *   ⑤ 부작용 0 — fetch · 자식 프로세스 · DB 쓰기 · raw · 트랜잭션이 던진다 · 감사 장부만 쓴다 · 저장소 안 거부 · 재실행 멱등
 *   ⑥ ratchet — 단계 이름 분기 0 · 실행 모듈 import 0 · 가드가 먼저
 *
 *   `--fast` — 실제 20초 잠금 대기 · 동시 프로세스 검사를 건너뛴다(변이 하네스 전용). 원본 실행은 언제나 전부 돈다.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  canonicalJson, costPerPaidSourceOf, cycleIdOf, dailyOperatingPlanOf, dailyOutcomeOf, freshCapacityFromTrace,
  inputHashOf, operatingEnvelopeOf, paceCeilingUsdOf, planDeficit, runIdStartMs, sanitizeObservation, writerDueOf,
  SHADOW_BATCH_MAX_SOURCES, SHADOW_TRACE_MAX_AGE_MS,
  type DeficitObservation, type LedgerRunEvidence, type OperatingEnvelope, type ShadowRecord, type SupplyRunView,
} from '../src/lib/ops-shadow-plan'
import {
  OBSERVER_CAUSAL_LAG_MS, OBSERVER_INTERVAL_SEC, OBSERVER_LOOKBACK_MS, OBSERVER_MAX_PER_TICK, selectObserverWork,
} from '../src/lib/ops-shadow-observer'
import { SUPPLY_RUN_WINDOW_MS } from '../src/lib/supply-schedule-contract'
import { PERSONA_COMMENTS_PER_POST_MAX } from '../src/lib/persona-target-rules'
import { judgeStageBudget, WORKSET_TOTAL_PER_SOURCE } from '../src/lib/supply-workset'
import { readSupplySelectionTrace, SELECTION_TRACE_KIND, SELECTION_TRACE_VERSION, summarizeTrace, type TraceCandidate } from '../src/lib/supply-selection-trace'
import { observationBucketOf } from '../src/lib/source-slot-release'
import { naturalScheduledRunEvidenceAt } from '../src/lib/supply-run-token'
import { tallyOf, type DayTally, type BudgetLimits } from '../src/lib/llm-ledger'
import { acquireObserverLock, appendShadowRecord, cleanupStaleObserverLock, injectedClockProblems, assertShadowDir, installShadowCallGuard, readOnlyDb, readShadowCycleIds, readSupplyRuns, REPO_ROOT } from './lib/ops-shadow-io.mjs'

const FAST = process.argv.includes('--fast')
let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { fail += 1; console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`) }
}
const throws = (f: () => unknown, re: RegExp): boolean => {
  try { f() } catch (e) { return re.test(e instanceof Error ? e.message : String(e)) }
  return false
}

const LIMITS: BudgetLimits = { dailyUsd: 1.2, runRequestCap: 20, headroomMultiplier: 1.2 }
const T0: DayTally = tallyOf([])
const ENV: OperatingEnvelope = operatingEnvelopeOf({ publishHardCapPerDay: 20, publishSlotsPerDay: 20, supplyDailyUsd: 1.2 })
const obsOf = (o: Partial<DeficitObservation> = {}): DeficitObservation => ({
  at: '2026-11-11T03:00:00.000Z', kstDate: '2026-11-11',
  jit: { slots: 10, readyFilled: 2 }, inFlightExpectedReady: 0, sourceYieldHigh: 0.2,
  attemptableSpeakers: 10, freshSourceCandidates: 30,
  ledger: { ok: true, limits: LIMITS, tally: T0, settleHold: null, unresolved: [] },
  costPerPaidSourceUsd: 0.02, slotsDueSoFar: 4, supplyRunInProgress: false,
  ...o,
})

// ─────────────────────────────────────────────────────────
console.log('\n① replay — 11-07~11-11 자연 공급 회차')
// ─────────────────────────────────────────────────────────
type FixtureRaw = Omit<SupplyRunView, 'naturalAt'> & {
  runTokenShadow: unknown
  jit: { slots: number; readyFilled: number; upTo: number; paidSources: number; paidBasis: string; sourceYieldHigh: number | null }
  settledUsd: { j: number; d: number }
}
type FixtureRun = SupplyRunView & Omit<FixtureRaw, 'runTokenShadow'>
const fxRaw = JSON.parse(readFileSync(join(REPO_ROOT, 'scripts/__fixtures__/ops-shadow/supply-runs-20261107-11.json'), 'utf-8')) as { runs: FixtureRaw[] }
// 🔴 자연 회차 판단은 정본 하나 — fixture 의 완전한 tag 를 운영과 같은 판독기에 통과시킨다(trigger 문자열 복제 0)
const fx = { runs: fxRaw.runs.map(({ runTokenShadow, ...rest }): FixtureRun => ({ ...rest, naturalAt: naturalScheduledRunEvidenceAt(runTokenShadow, rest.startedAt) })) }
check('fixture 30회차 · 식별자 0 · 완전한 tag 30개가 정본 판독기로 자연 회차', fx.runs.length === 30
  && !/(navercafe|82cook|sourceArticleId|nickname|postId|[0-9a-f]{8}-[0-9a-f]{4}-)/.test(JSON.stringify(fxRaw))
  && fx.runs.every((r) => r.naturalAt === r.startedAt))
let same = 0
const diffs: string[] = []
for (const r of fx.runs) {
  // 🔴 운영은 진행 중 작업을 빼지 않았다 — 같은 입력(진행 0)이면 같은 수요 · 같은 유료 원천 수여야 한다
  const p = planDeficit(ENV, obsOf({ jit: { slots: r.jit.slots, readyFilled: r.jit.readyFilled }, sourceYieldHigh: r.jit.sourceYieldHigh }))
  const ok = p.demand.upTo === r.jit.upTo
    && (r.jit.paidBasis === 'noDemand' ? p.paid.sources === 0 : p.paid.sources === r.jit.paidSources && p.paid.basis === r.jit.paidBasis)
  if (ok) same += 1
  else diffs.push(`${r.runId}: upTo ${p.demand.upTo}/${r.jit.upTo} paid ${p.paid.sources}/${r.jit.paidSources} ${p.paid.basis}/${r.jit.paidBasis}`)
}
check(`🔴 shadow 수요 · 유료 원천 수가 운영 결정과 30/30 같다(judgeJitDemand · paidSourcesFor 재사용)`, same === fx.runs.length, diffs.slice(0, 3).join(' | '))
const days = [...new Set(fx.runs.map((r) => new Date(Date.parse(r.startedAt) + 9 * 3_600_000).toISOString().slice(0, 10)))].sort()
const REPLAY_NOW = new Date('2026-11-10T23:52:00.000Z')
const dueByDay = days.map((d) => writerDueOf(d, REPLAY_NOW, fx.runs).due)
check('🔴 writer — 마지막 자연 회차(22:15)가 끝난 날만 due · 11-11 은 아직 아니다',
  days.length === 5 && dueByDay.slice(0, 4).every(Boolean) && dueByDay[4] === false, `${days.join(',')} ${dueByDay.join(',')}`)
const ledgerDateOfRun = (r: { startedAt: string }): string => new Date(Date.parse(r.startedAt) + 9 * 3_600_000).toISOString().slice(0, 10)
const ev = (usd: number): LedgerRunEvidence => ({ settledUsd: usd, settled: usd > 0 ? 1 : 0, unsettled: 0, blocked: 0 })
const fxEvidence = new Map<string, LedgerRunEvidence>()
for (const r of fx.runs) { fxEvidence.set(`${r.runId}-j`, ev(r.settledUsd.j)); fxEvidence.set(`${r.runId}-d`, ev(r.settledUsd.d)) }
const fxRuns = fx.runs.map((r) => ({ runId: r.runId, paidSources: r.jit.paidSources, ledgerDate: ledgerDateOfRun(r) }))
const fxDays = new Map(days.map((d) => [d, true]))
// 🔴 실측 30회차에는 judge 장부 기록이 0건인 유료 회차가 있다 — 회차 기록이 단계별 요청 수를 남기지 않아 정당한 0건을
//    증명할 수 없으므로 전체 창의 단가는 모른다(null · 가상 지출 0). 두 단계 증거가 모두 있는 회차만 모으면 값이 나온다
const fxJudgeZero = fx.runs.filter((r) => r.jit.paidSources > 0 && r.settledUsd.j === 0).length
check('🔴 실측 창 — judge 증거 없는 유료 회차가 있으면 단가는 null(fail-closed)', fxJudgeZero > 0 && costPerPaidSourceOf(fxRuns, fxDays, fxEvidence) === null, String(fxJudgeZero))
const complete = fx.runs.filter((r) => !(r.jit.paidSources > 0) || (r.settledUsd.j > 0 && r.settledUsd.d > 0))
const cps = costPerPaidSourceOf(complete.map((r) => ({ runId: r.runId, paidSources: r.jit.paidSources, ledgerDate: ledgerDateOfRun(r) })), fxDays, fxEvidence)
check('두 단계 증거가 모두 있는 실측 회차만이면 단가가 나온다(0 보다 크고 0.1 보다 작다)', cps !== null && cps > 0 && cps < 0.1, String(cps))
const completeRuns = complete.map((r) => ({ runId: r.runId, paidSources: r.jit.paidSources, ledgerDate: ledgerDateOfRun(r) }))
const one = completeRuns.find((r) => (r.paidSources ?? 0) > 0)!
check('🔴 비용 표본 — 표본 회차의 장부 날이 깨졌으면 null', costPerPaidSourceOf(completeRuns, new Map([...fxDays, [one.ledgerDate, false]]), fxEvidence) === null)
const noEvidence = new Map(fxEvidence); noEvidence.delete(`${one.runId}-j`); noEvidence.delete(`${one.runId}-d`)
check('🔴 비용 표본 — 유료 회차의 장부 기록이 없으면(파일 없음 · 누락) null', costPerPaidSourceOf(completeRuns, fxDays, noEvidence) === null)
const noJudge = new Map(fxEvidence); noJudge.delete(`${one.runId}-j`)
check('🔴 반례 — judge 증거만 없으면(draft 만 정산) null · 낮은 단가를 내지 않는다', costPerPaidSourceOf(completeRuns, fxDays, noJudge) === null)
const noDraft = new Map(fxEvidence); noDraft.delete(`${one.runId}-d`)
check('🔴 반례 — draft 증거만 없으면(judge 만 정산) null', costPerPaidSourceOf(completeRuns, fxDays, noDraft) === null)
const unsettled = new Map(fxEvidence); unsettled.set(`${one.runId}-d`, { ...ev(0.01), unsettled: 1 })
check('🔴 비용 표본 — 미정산 요청이 있으면 null', costPerPaidSourceOf(completeRuns, fxDays, unsettled) === null)
const allBlocked = new Map(fxEvidence)
allBlocked.set(`${one.runId}-j`, { settledUsd: 0, settled: 0, unsettled: 0, blocked: 3 }); allBlocked.set(`${one.runId}-d`, { settledUsd: 0, settled: 0, unsettled: 0, blocked: 2 })
check('두 단계 모두 차단만 된 회차는 지출 0 이 사실이라 표본에서만 빠진다', costPerPaidSourceOf(completeRuns, fxDays, allBlocked) !== null)

// ─────────────────────────────────────────────────────────
console.log('\n② 결정성')
// ─────────────────────────────────────────────────────────
const a = planDeficit(ENV, obsOf())
const b = planDeficit(ENV, obsOf())
check('같은 관측 → 같은 계획(정규 JSON 동일)', canonicalJson(a) === canonicalJson(b))
check('키 순서가 달라도 같은 입력 해시', inputHashOf({ x: 1, y: [1, { b: 2, a: 1 }] }) === inputHashOf({ y: [1, { a: 1, b: 2 }], x: 1 }))
const shuffled = [...fx.runs].reverse()
check('writer 판정이 입력 순서와 무관하다', days.every((d) => canonicalJson(writerDueOf(d, REPLAY_NOW, fx.runs)) === canonicalJson(writerDueOf(d, REPLAY_NOW, shuffled))))
check('사이클 열쇠는 날짜 · 종류 · 해시로만 정해진다', cycleIdOf('cycle', '2026-11-11', 'ab'.repeat(32)) === `2026-11-11:cycle:${'ab'.repeat(8)}`)

// ─────────────────────────────────────────────────────────
console.log('\n③ 성질 — 가상 묶음 · 지출 · 요청')
// ─────────────────────────────────────────────────────────
let seed = 20261111
const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
const ri = (n: number): number => Math.floor(rnd() * n)
let violations = 0
let acted = 0
const why: string[] = []
for (let i = 0; i < 4000; i += 1) {
  const daily = [null, 0.3, 1.2, 1.5, 7.5][ri(5)]!
  const env = operatingEnvelopeOf({ publishHardCapPerDay: 1 + ri(200), publishSlotsPerDay: 1 + ri(200), supplyDailyUsd: daily })
  const settledUsd = rnd() * 2
  const open = rnd() * 0.3
  const o = obsOf({
    jit: rnd() < 0.05 ? null : { slots: ri(40), readyFilled: ri(40) },
    inFlightExpectedReady: rnd() < 0.1 ? null : ri(10),
    sourceYieldHigh: rnd() < 0.2 ? null : rnd(),
    attemptableSpeakers: rnd() < 0.1 ? null : ri(30),
    freshSourceCandidates: rnd() < 0.1 ? null : ri(40),
    ledger: {
      ok: rnd() > 0.05, limits: { dailyUsd: daily, runRequestCap: 20, headroomMultiplier: 1.2 },
      tally: { ...T0, settledUsd, openReservedUsd: open, overruns: rnd() < 0.03 ? 1 : 0 },
      settleHold: rnd() < 0.05 ? 'hold' : null,
      unresolved: rnd() < 0.05 ? [{ code: 'STALE', reason: 'x', reservation: { attemptId: 'a' } } as never] : [],
    },
    costPerPaidSourceUsd: rnd() < 0.1 ? null : 0.005 + rnd() * 0.05,
    slotsDueSoFar: ri(220), supplyRunInProgress: rnd() < 0.05 ? null : rnd() < 0.1,
  })
  const p = planDeficit(env, o)
  const n = p.wouldRunSources
  const bad = (m: string): void => { violations += 1; if (why.length < 3) why.push(`${i}:${m}`) }
  if (p.executed !== false) bad('executed')
  if (n > 0) {
    acted += 1
    const ceiling = paceCeilingUsdOf(env, o.slotsDueSoFar)!
    const remaining = daily! - settledUsd - open
    if (n > SHADOW_BATCH_MAX_SOURCES || n > env.worksetCapPerRun) bad('batch')
    if (n > p.paid.sources) bad('paid')
    if (o.freshSourceCandidates === null || n > o.freshSourceCandidates) bad('fresh')
    if (o.attemptableSpeakers === null || n > o.attemptableSpeakers) bad('speakers')
    if (p.wouldSpendUsd > ceiling + 1e-9 || ceiling > daily! + 1e-9) bad('pace')
    if (p.wouldSpendUsd > remaining + 1e-9) bad('remaining')
    if (!o.ledger.ok || o.ledger.settleHold !== null || o.ledger.unresolved.length > 0 || o.ledger.tally.overruns > 0) bad('ledgerHold')
    if (o.supplyRunInProgress !== false) bad('runState')
    const budget = judgeStageBudget(n)
    if (!budget.ok || p.requests === null || p.requests.judge !== budget.perStage.judge || p.requests.draft !== budget.perStage.draft
      || p.requests.total !== n * WORKSET_TOTAL_PER_SOURCE || p.requests.total > budget.total) bad('requests')
  } else if (p.wouldSpendUsd !== 0 || p.action !== 'none') bad('noneShape')
}
check(`🔴 4000 관측 — 묶음 ≤ 상한·유료·신선·화자 · 지출 ≤ 속도 천장 ≤ 예산 · 남은 여력 · 장부 보류면 0 · 요청 = 단계 예산(행동 ${acted}건)`,
  violations === 0 && acted > 200, why.join(' | '))
check('🔴 속도 상한 — 하루 첫 슬롯 전에는 하루 예산을 다 쓰지 못한다',
  (paceCeilingUsdOf(ENV, 0) ?? 9) < ENV.supplyDailyUsd! && planDeficit(ENV, obsOf({ slotsDueSoFar: 0, costPerPaidSourceUsd: 0.2 })).wouldSpendUsd <= paceCeilingUsdOf(ENV, 0)!)
check('🔴 지출 권위 — 정산 보류 · 미해결 예약 · 장부 오류면 가상 묶음 0',
  planDeficit(ENV, obsOf({ ledger: { ...obsOf().ledger, settleHold: '보류' } })).wouldRunSources === 0
  && planDeficit(ENV, obsOf({ ledger: { ...obsOf().ledger, unresolved: [{ code: 'STALE', reason: 'x', reservation: { attemptId: 'a' } } as never] } })).wouldRunSources === 0
  && planDeficit(ENV, obsOf({ ledger: { ...obsOf().ledger, ok: false } })).wouldRunSources === 0)
check('🔴 화자 — 모르면 0 · 적으면 그 수로 자른다',
  planDeficit(ENV, obsOf({ attemptableSpeakers: null })).wouldRunSources === 0
  && planDeficit(ENV, obsOf({ attemptableSpeakers: 2 })).wouldRunSources === 2)
check('🔴 회차 진행 중 · 상태 모름이면 0(동시 회차 없음)',
  planDeficit(ENV, obsOf({ supplyRunInProgress: true })).wouldRunSources === 0
  && planDeficit(ENV, obsOf({ supplyRunInProgress: null })).wouldRunSources === 0)
check('진행 중 작업은 부족분에서 뺀다',
  planDeficit(ENV, obsOf({ jit: { slots: 10, readyFilled: 2 }, inFlightExpectedReady: 8 })).deficitAfterInFlight === 0)

// ─────────────────────────────────────────────────────────
console.log('\n③-b 신선 원천 — 선택 권위의 슬롯별 판정만 · 지난 슬롯은 세지 않는다')
// ─────────────────────────────────────────────────────────
const NOW = new Date('2026-11-11T03:00:00.000Z')
const SLOTS = ['2026-11-11T01:00:00.000Z', '2026-11-11T02:30:00.000Z', '2026-11-11T05:00:00.000Z', '2026-11-11T08:00:00.000Z']
const hex = (i: number): string => i.toString(16).padStart(64, '0')
/** 정본 판독기(`readSupplySelectionTrace`)를 통과하는 합성 v2 트레이스 — summary · facts 는 정본 `summarizeTrace` 로 맞춘다 */
const mkTrace = (agesList: (number | null)[][], takenAt = '2026-11-11T02:00:00.000Z'): Record<string, unknown> => {
  const candidates: TraceCandidate[] = agesList.map((ages, i) => {
    const last = ages.reduce<number>((m, x, k) => (x !== null ? k : m), -1)
    return {
      sourceHash: hex(i + 1), source: 'fixture:src', axis: 'seed', retry: false, retryTier: null, retryWaitedH: null,
      retryReserved: false, slotAgesH: ages, lastValidSlot: last < 0 ? null : last, assignedSlot: null,
      stage: 'CAP_REACHED', rank: null, sourceAgeH: 5, freshnessBand: observationBucketOf(5), selected: false,
      position: null, reason: 'CAP_REACHED', menopauseCore: false, wgangSource: false,
    } as TraceCandidate
  })
  const summary = summarizeTrace(candidates, 0, { takenAt, slots: SLOTS, cap: 20 })
  return {
    kind: SELECTION_TRACE_KIND, version: SELECTION_TRACE_VERSION, runId: '20261111-020000', takenAt, limit: 20, cap: 20,
    slots: SLOTS, worksetDigest: 'a'.repeat(64),
    facts: { slots: SLOTS.length, cap: 20, linkable: candidates.length, rawExcluded: summary.rawExcluded, unlinkable: 0,
      maxFillableSlots: summary.maxFillableSlots, coverTarget: summary.coverTarget, coveredSlots: summary.coveredSlots,
      retryReserve: 0, retryReserved: summary.retryReserved },
    candidates, summary,
  }
}
// 슬롯 0·1 은 관측(03:00) 전에 지났다 · 슬롯 2·3 은 앞으로다
const T = mkTrace([[5, 6, null, null], [null, 7, 9, null], [null, null, null, 12], [4, null, null, null]])
check('합성 트레이스가 정본 판독기를 통과한다', readSupplySelectionTrace(T).ok === true, JSON.stringify(readSupplySelectionTrace(T)).slice(0, 160))
check('🔴 반례 — 지난 슬롯에서만 유효했던 후보 2개는 세지 않는다(남은 슬롯 유효 2개만)', freshCapacityFromTrace(T, NOW) === 2)
check('🔴 관측 시각이 앞이면 지난 슬롯이 줄어 더 센다(02:05 → 3 · 00:40 → 4)', freshCapacityFromTrace(T, new Date('2026-11-11T02:05:00.000Z')) === 3
  && freshCapacityFromTrace(mkTrace([[5, 6, null, null], [null, 7, 9, null], [null, null, null, 12], [4, null, null, null]], '2026-11-11T00:30:00.000Z'), new Date('2026-11-11T00:40:00.000Z')) === 4)
const bad = mkTrace([[5, 6, null, null]])
;(bad.candidates as TraceCandidate[])[0] = { ...(bad.candidates as TraceCandidate[])[0]!, slotAgesH: [5, 6, null] }
check('🔴 슬롯 길이가 깨지면 모른다(null · 정본 판독기 거부)', freshCapacityFromTrace(bad, NOW) === null)
check('🔴 오래된 · 미래 · v1 · 깨진 트레이스는 모른다(null)',
  freshCapacityFromTrace(mkTrace([[5, 6, 7, 8]], new Date(NOW.getTime() - SHADOW_TRACE_MAX_AGE_MS - 1).toISOString()), NOW) === null
  && freshCapacityFromTrace(mkTrace([[5, 6, 7, 8]], '2026-11-11T04:00:00.000Z'), NOW) === null
  && freshCapacityFromTrace({ ...mkTrace([[5, 6, 7, 8]]), version: 'selection-trace-v1' }, NOW) === null
  && freshCapacityFromTrace({ ...mkTrace([[5, 6, 7, 8]]), takenAt: 'not-a-date' }, NOW) === null
  && freshCapacityFromTrace(null, NOW) === null)

// ─────────────────────────────────────────────────────────
console.log('\n④ 봉투 상한 · 대화 상한 · writer 모호성')
// ─────────────────────────────────────────────────────────
const env20 = operatingEnvelopeOf({ publishHardCapPerDay: 20, publishSlotsPerDay: 20, supplyDailyUsd: 1.2 })
const planBig = dailyOperatingPlanOf(env20, '2026-11-12', { kstDate: '2026-11-12', state: 'TRIAL', releaseDailyTarget: 30 })
check('🔴 controller 의도가 봉투 상한을 넘으면 상한이 이긴다(증명 N 없음 · 상한 20)',
  planBig.publishCap === 20 && planBig.exactN === null && planBig.intentExceedsCap && planBig.authority === 'none')
const post = (n: number): { decider: string; unattended: boolean; personaComments: unknown[] } => ({ decider: 'auto', unattended: true, personaComments: Array.from({ length: n }) })
const out21 = dailyOutcomeOf(env20, planBig, { posts: Array.from({ length: 21 }, () => post(1)), tally: null })
check('🔴 자동 발행 21 > 봉투 상한 20 → overCap(계획·의도와 무관)', out21.overCap === true && out21.publishHardCap === 20 && out21.authorityVerdict === null)
const planP = dailyOperatingPlanOf(env20, '2026-11-12', { kstDate: '2026-11-12', state: 'TRIAL', releaseDailyTarget: 20 })
const outP = dailyOutcomeOf(env20, planP, { posts: Array.from({ length: 20 }, () => post(PERSONA_COMMENTS_PER_POST_MAX + 1)), tally: null })
check('🔴 정확 N 측정 · 글당 Persona 댓글 11 > 상한 10 감지(상한은 정본 10 그대로)',
  planP.dayKind === 'proof' && outP.exactNMet === true && outP.conversationCapRespected === false && env20.conversationHardCapPerPost === 10)
check('결정을 못 읽으면 unknown · 상한은 그대로 봉투', dailyOperatingPlanOf(env20, '2026-11-12', null).dayKind === 'unknown'
  && dailyOperatingPlanOf(env20, '2026-11-12', null).publishCap === 20)
/** 완전한 run token tag — 정본 판독기(`parseRunTokenShadowTag`) 모양 그대로 */
const tagOf = (trigger: string, o: { launch?: string; pass?: number; absorbedTrigger?: string | null; absorbedAt?: string | null } = {}): unknown => ({
  ok: true, code: null, tokenId: 'fixture-token', trigger, launchTrigger: o.launch ?? trigger,
  absorbedTrigger: o.absorbedTrigger ?? null, absorbedAt: o.absorbedAt ?? null, pass: o.pass ?? 0, budgetWindow: '2026-11-11 22:15',
})
const r = (id: string, start: string, status: string, done: string | null, tag: unknown): SupplyRunView =>
  ({ runId: id, startedAt: start, status, completedAt: done, naturalAt: naturalScheduledRunEvidenceAt(tag, start) })
const W_NOW = new Date('2026-11-11T14:00:00.000Z')
const lastRuns = [
  r('20261111-131500', '2026-11-11T13:15:00.000Z', 'done', '2026-11-11T13:40:00.000Z', tagOf('scheduled')),
  r('20261111-131600', '2026-11-11T13:16:00.000Z', 'running', null, tagOf('scheduled')),
]
check('🔴 마지막 슬롯 자연 회차가 둘이고 하나가 진행 중이면 due 아님(먼저 끝난 하나로 닫지 않는다)', !writerDueOf('2026-11-11', W_NOW, lastRuns).due)
const bothDone = [lastRuns[0]!, { ...lastRuns[1]!, status: 'done', completedAt: '2026-11-11T13:35:00.000Z' }]
const w2 = writerDueOf('2026-11-11', W_NOW, bothDone)
check('🔴 둘 다 끝나면 가장 늦게 끝난 회차로 결정적', w2.due && w2.runId === '20261111-131500'
  && canonicalJson(w2) === canonicalJson(writerDueOf('2026-11-11', W_NOW, [...bothDone].reverse())))
check('손 실행만 있으면 due 아님', !writerDueOf('2026-11-11', W_NOW, [r('20261111-131500', '2026-11-11T13:15:00.000Z', 'done', '2026-11-11T13:40:00.000Z', tagOf('manual'))]).due)
const ok1 = r('20261111-131500', '2026-11-11T13:15:00.000Z', 'done', '2026-11-11T13:40:00.000Z', tagOf('scheduled'))
check('기준 — 관측 시각 전에 끝난 자연 회차면 due', writerDueOf('2026-11-11', W_NOW, [ok1]).due)
check('🔴 반례 — 관측 시각(아침)보다 미래에 시작한 22:15 회차는 due 아님', !writerDueOf('2026-11-11', new Date('2026-11-11T00:00:00.000Z'), [ok1]).due)
check('🔴 반례 — 완료 시각이 관측 시각보다 미래면 due 아님', !writerDueOf('2026-11-11', new Date('2026-11-11T13:30:00.000Z'), [ok1]).due)
check('🔴 반례 — 완료가 시작보다 이르면 due 아님', !writerDueOf('2026-11-11', W_NOW, [{ ...ok1, completedAt: '2026-11-11T13:00:00.000Z' }]).due)
check('🔴 반례 — 시각이 엄격 ISO 가 아니면 due 아님', !writerDueOf('2026-11-11', W_NOW, [{ ...ok1, completedAt: '2026-11-11 13:40' }]).due)
check('🔴 반례 — 시작 시각이 엄격 ISO 가 아니면(읽히긴 해도) due 아님', !writerDueOf('2026-11-11', W_NOW, [{ ...ok1, startedAt: '2026-11-11T13:15:00Z' }]).due)
check('🔴 반례 — done 이 아닌 상태(실패)면 완료 시각이 있어도 due 아님', !writerDueOf('2026-11-11', W_NOW, [{ ...ok1, status: 'failed' }]).due)
check('🔴 자연 회차 권위 — launchTrigger 가 scheduled 가 아니면(trigger 만 scheduled) · 손상 tag · recovery · event 는 due 아님',
  !writerDueOf('2026-11-11', W_NOW, [r('20261111-131500', '2026-11-11T13:15:00.000Z', 'done', '2026-11-11T13:40:00.000Z', tagOf('scheduled', { launch: 'manual' }))]).due
  && !writerDueOf('2026-11-11', W_NOW, [r('20261111-131500', '2026-11-11T13:15:00.000Z', 'done', '2026-11-11T13:40:00.000Z', { trigger: 'scheduled' })]).due
  && !writerDueOf('2026-11-11', W_NOW, [r('20261111-131500', '2026-11-11T13:15:00.000Z', 'done', '2026-11-11T13:40:00.000Z', tagOf('recovery'))]).due
  && !writerDueOf('2026-11-11', W_NOW, [r('20261111-131500', '2026-11-11T13:15:00.000Z', 'done', '2026-11-11T13:40:00.000Z', tagOf('event'))]).due)
// 🔴 follow-up pass — 원래 22:15 marker 를 흡수해 23:05 KST 에 시작한 회차는 원래 marker 시각으로 마지막 슬롯에 귀속한다
const follow = r('20261111-140500', '2026-11-11T14:05:00.000Z', 'done', '2026-11-11T14:20:00.000Z',
  tagOf('scheduled', { pass: 1, absorbedTrigger: 'scheduled', absorbedAt: '2026-11-11T13:15:00.000Z' }))
check('🔴 follow-up 자연 회차는 정본 증거 시각(원래 marker)으로 슬롯 귀속 · 시작 시각으로 귀속하지 않는다',
  follow.naturalAt === '2026-11-11T13:15:00.000Z' && writerDueOf('2026-11-11', new Date('2026-11-11T14:30:00.000Z'), [follow]).due)
check('🔴 회차 id 달력 검사 — 13월 · 32일 · 2월 30일 · 24시 · 60분은 null · 정상 id 는 round-trip',
  ['20261332-221500', '20261132-221500', '20260230-221500', '20261111-241500', '20261111-226000', '2026111-221500'].every((x) => runIdStartMs(x) === null)
  && runIdStartMs('20261111-131500') === Date.UTC(2026, 10, 11, 13, 15, 0) && runIdStartMs('20280229-000000') !== null)
check('🔴 반례 — 달력에 없는 회차 id 의 깨진 기록은 시각을 모르니 막는다', !writerDueOf('2026-11-11', W_NOW, [ok1], ['20261132-131500']).due)
check('🔴 반례 — 마지막 슬롯 창의 회차 기록이 깨졌으면 due 아님 · 창 밖 깨짐은 영향 없음 · id 를 못 읽으면 막는다',
  !writerDueOf('2026-11-11', W_NOW, [ok1], ['20261111-132000']).due
  && writerDueOf('2026-11-11', W_NOW, [ok1], ['20261111-031500']).due
  && !writerDueOf('2026-11-11', W_NOW, [ok1], ['garbage']).due)

// ─────────────────────────────────────────────────────────
console.log('\n④-b observer 선택 — 자연 회차 · 회차 열쇠 · causal/backfill · stale · 순서')
// ─────────────────────────────────────────────────────────
{
  const DONE = '2026-11-11T13:40:00.000Z'
  const nat = r('20261111-131500', '2026-11-11T13:15:00.000Z', 'done', DONE, tagOf('scheduled'))
  const at = (ms: number): Date => new Date(Date.parse(DONE) + ms)
  const sel = (now: Date, runs: SupplyRunView[], seen: ReadonlySet<string> = new Set(), max?: number) =>
    selectObserverWork({ now, runs, seenCycleIds: seen, ...(max === undefined ? {} : { maxPerTick: max }) })
  const clsOf = (now: Date, run: SupplyRunView): string => sel(now, [run]).classes[0]!.cls
  // recent → causal
  const recent = sel(at(60_000), [nat])
  check('🔴 recent — 완료 1분 뒤 tick → pending · causal · KST 날짜는 자연 증거 시각의 날짜',
    recent.work.length === 1 && recent.work[0]!.mode === 'causal' && recent.work[0]!.kstDate === '2026-11-11' && recent.work[0]!.naturalAt === nat.naturalAt)
  check('🔴 causal 경계 — 지연 = OBSERVER_CAUSAL_LAG_MS 까지 causal · 1ms 넘으면 backfill',
    sel(at(OBSERVER_CAUSAL_LAG_MS), [nat]).work[0]!.mode === 'causal' && sel(at(OBSERVER_CAUSAL_LAG_MS + 1), [nat]).work[0]!.mode === 'backfill')
  check('🔴 backfill — 하루 뒤 tick 은 backfill · 열쇠 · cycle id 는 causal 과 같다(관측 시각이 열쇠에 들어가지 않는다)', (() => {
    const b = sel(at(86_400_000), [nat]).work[0]
    return b !== undefined && b.mode === 'backfill' && b.key === recent.work[0]!.key && b.cycleId === recent.work[0]!.cycleId
  })())
  check('🔴 manual · recovery · event · 손상(trigger-only) tag · launchTrigger manual → notNatural · 일 0',
    [tagOf('manual'), tagOf('recovery'), tagOf('event'), { trigger: 'scheduled' }, tagOf('scheduled', { launch: 'manual' }), null]
      .every((t) => clsOf(at(60_000), r('20261111-131500', '2026-11-11T13:15:00.000Z', 'done', DONE, t)) === 'notNatural'))
  check('🔴 future — 완료 시각이 tick 보다 미래 → future · 일 0', clsOf(at(-1), nat) === 'future')
  check('🔴 badTimes — 완료 < 시작 · 엄격 ISO 아님 · done 인데 완료 없음', clsOf(at(60_000), { ...nat, completedAt: '2026-11-11T13:00:00.000Z' }) === 'badTimes'
    && clsOf(at(60_000), { ...nat, completedAt: '2026-11-11 13:40' }) === 'badTimes' && clsOf(at(60_000), { ...nat, completedAt: null }) === 'badTimes')
  check('🔴 tooOld — lookback 밖은 보지 않는다', clsOf(at(OBSERVER_LOOKBACK_MS + 1), nat) === 'tooOld' && clsOf(at(OBSERVER_LOOKBACK_MS), nat) === 'pending')
  const running = r('20261111-131600', '2026-11-11T13:16:00.000Z', 'running', null, tagOf('scheduled'))
  const startMs = Date.parse('2026-11-11T13:16:00.000Z')
  check('🔴 running → 창 안은 running · SUPPLY_RUN_WINDOW_MS 넘으면 stale',
    clsOf(new Date(startMs + SUPPLY_RUN_WINDOW_MS - 1), running) === 'running' && clsOf(new Date(startMs + SUPPLY_RUN_WINDOW_MS), running) === 'stale')
  check('🔴 running-stale 회차가 다른 회차 관측을 막지 않는다', (() => {
    const s2 = sel(new Date(startMs + SUPPLY_RUN_WINDOW_MS + 60_000), [running, { ...nat, completedAt: new Date(startMs + SUPPLY_RUN_WINDOW_MS).toISOString() }])
    return s2.work.length === 1 && s2.work[0]!.runId === nat.runId && s2.classes.some((c) => c.cls === 'stale')
  })())
  check('🔴 seen — 장부에 같은 cycle id 가 있으면 일 0', sel(at(60_000), [nat], new Set([recent.work[0]!.cycleId])).work.length === 0
    && sel(at(60_000), [nat], new Set([recent.work[0]!.cycleId])).classes[0]!.cls === 'seen')
  // 1,440 tick — 하루 내내 60초마다 깨워도 같은 회차는 한 번만 일이 된다(장부 sink 를 흉내 낸 seen 집합)
  {
    const seen = new Set<string>()
    let works = 0
    const keys = new Set<string>()
    for (let i = 0; i < 1_440; i += 1) {
      const s3 = sel(at(i * OBSERVER_INTERVAL_SEC * 1_000), [nat, running], seen)
      for (const w of s3.work) { works += 1; keys.add(w.cycleId); seen.add(w.cycleId) }
    }
    const raw = new Set<string>()
    for (let i = 0; i < 1_440; i += 1) for (const w of sel(at(i * OBSERVER_INTERVAL_SEC * 1_000), [nat]).work) raw.add(w.cycleId)
    check('🔴 1,440 tick — 같은 회차 일 1번 · seen 없이 1,440번 골라도 cycle id 는 1개', works === 1 && keys.size === 1 && raw.size === 1)
  }
  // 재부팅 — 잠든 사이 끝난 회차 5개를 상한 3 · 결정적 순서(완료 → runId)로 잇는다
  {
    // lookback 안(같은 날 다섯 회차) — 잠든 사이 끝났고 깨어난 시각은 모두 causal 지연을 넘었다
    const missed = [0, 1, 2, 3, 4].map((k) => r(`20261111-0${k}1500`, `2026-11-11T0${k}:15:00.000Z`, 'done', `2026-11-11T0${k}:40:00.000Z`, tagOf('scheduled')))
    const wake = new Date('2026-11-11T23:00:00.000Z')
    const a1 = sel(wake, [...missed].reverse())
    const a2 = sel(wake, missed)
    check('🔴 재부팅 회복 — 입력 순서와 무관하게 같은 일 · 완료 시각 순 · 상한 OBSERVER_MAX_PER_TICK · 나머지는 미룸',
      canonicalJson(a1) === canonicalJson(a2) && a1.work.length === OBSERVER_MAX_PER_TICK && a1.deferred === 5 - OBSERVER_MAX_PER_TICK
      && a1.work.map((w) => w.runId).join(',') === missed.slice(0, OBSERVER_MAX_PER_TICK).map((m) => m.runId).join(',')
      && a1.work.every((w) => w.mode === 'backfill'))
    const seen = new Set(a1.work.map((w) => w.cycleId))
    const next = sel(wake, missed, seen)
    check('🔴 다음 tick 이 남은 회차를 잇는다 — 겹침 0 · 빠짐 0', next.work.length === 5 - OBSERVER_MAX_PER_TICK && next.deferred === 0
      && next.work.every((w) => !seen.has(w.cycleId)))
    const sameMs = [r('20261111-131501', '2026-11-11T13:15:01.000Z', 'done', DONE, tagOf('scheduled')), nat]
    check('🔴 완료 시각이 같으면 runId 순(결정적)', sel(at(60_000), sameMs).work.map((w) => w.runId).join(',') === '20261111-131500,20261111-131501'
      && sel(at(60_000), [...sameMs].reverse()).work.map((w) => w.runId).join(',') === '20261111-131500,20261111-131501')
  }
  check('🔴 follow-up 자연 회차 — KST 날짜는 원래 marker 시각의 날짜(자정 넘어 시작해도)', (() => {
    const late = r('20261111-151000', '2026-11-11T15:10:00.000Z', 'done', '2026-11-11T15:20:00.000Z',
      tagOf('scheduled', { pass: 1, absorbedTrigger: 'scheduled', absorbedAt: '2026-11-11T13:15:00.000Z' }))
    const w = sel(new Date('2026-11-11T15:21:00.000Z'), [late]).work[0]
    return w !== undefined && w.kstDate === '2026-11-11'
  })())
  check('완료 시각이 다르면 열쇠가 다르다(같은 runId 재기록 — 잘못된 합침 0)',
    sel(at(60_000), [nat]).work[0]!.key !== sel(at(120_000), [{ ...nat, completedAt: '2026-11-11T13:41:00.000Z' }]).work[0]!.key)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 부작용 0')
// ─────────────────────────────────────────────────────────
const restore = installShadowCallGuard()
check('🔴 가드 — fetch 가 던진다', throws(() => fetch('https://example.invalid'), /OPS_SHADOW_NO_NETWORK/))
check('🔴 가드 — 자식 프로세스(ESM 이름 import 바인딩까지)가 던진다', throws(() => spawnSync('true'), /OPS_SHADOW_NO_CHILD_PROCESS/))
check('🔴 가드 중첩 — 두 번째 설치는 던지고 첫 가드는 그대로 걸려 있다',
  throws(() => installShadowCallGuard(), /OPS_SHADOW_GUARD_NESTED/) && throws(() => fetch('https://example.invalid'), /OPS_SHADOW_NO_NETWORK/))
restore()
check('가드 해제 — 검사 프로세스는 원래대로', spawnSync('true').status === 0)
check('🔴 되돌리기 오용 — 두 번 되돌리면 던진다', throws(() => restore(), /OPS_SHADOW_GUARD_RESTORE_MISUSE/))
{
  const second = installShadowCallGuard()
  check('🔴 되돌리기 순서 오용 — 앞 설치의 되돌리기로 지금 가드를 풀지 못한다(던지고 가드는 그대로)',
    throws(() => restore(), /OPS_SHADOW_GUARD_RESTORE_MISUSE/) && throws(() => spawnSync('true'), /OPS_SHADOW_NO_CHILD_PROCESS/))
  second()
  check('자기 되돌리기는 풀린다', spawnSync('true').status === 0)
}
const calls: string[] = []
const fakeDb = {
  post: { findMany: () => { calls.push('find'); return [] }, create: () => { calls.push('create') }, update: () => { calls.push('update') }, deleteMany: () => { calls.push('deleteMany') }, upsert: () => { calls.push('upsert') } },
  $executeRaw: () => { calls.push('exec') }, $transaction: () => { calls.push('tx') }, $queryRawUnsafe: () => { calls.push('raw') },
}
const ro = readOnlyDb(fakeDb)
check('🔴 읽기 전용 DB — 쓰기 · raw · 트랜잭션이 던지고 실제 호출 0 · 읽기는 통과',
  throws(() => ro.post.create(), /DB_WRITE_BLOCKED/) && throws(() => ro.post.update(), /DB_WRITE_BLOCKED/)
  && throws(() => ro.post.deleteMany(), /DB_WRITE_BLOCKED/) && throws(() => ro.post.upsert(), /DB_WRITE_BLOCKED/)
  && throws(() => ro.$executeRaw(), /DB_BLOCKED/) && throws(() => ro.$transaction(), /DB_BLOCKED/)
  && throws(() => ro.$queryRawUnsafe(), /DB_BLOCKED/) && Array.isArray(ro.post.findMany()) && calls.join(',') === 'find', calls.join(','))
const tmp = mkdtempSync(join(tmpdir(), 'ops-shadow-check-'))
const dir = join(tmp, 'ops-shadow')
const rec = (id: string): ShadowRecord => ({
  v: 'ops-shadow-v1', cycleId: id, kind: 'cycle', kstDate: '2026-11-11', at: NOW.toISOString(), inputHash: 'h', runtimeSha: null,
  clock: 'injected', source: { kind: 'manual' }, authority: 'none', envelope: env20, plan: planP, observation: sanitizeObservation(obsOf()), deficit: a, outcome: null, writer: null,
})
const w1 = appendShadowRecord(dir, rec('c1'))
const w1b = appendShadowRecord(dir, rec('c1'))
appendShadowRecord(dir, rec('c2'))
const lines = readFileSync(w1.path, 'utf-8').split('\n').filter((l) => l !== '')
check('🔴 감사 장부 — 같은 사이클은 한 줄(멱등) · 덧붙이기만', w1.written && !w1b.written && lines.length === 2)
check('🔴 감사 장부 — 그 디렉터리의 날짜 파일 하나만 생긴다', readdirSync(tmp).join(',') === 'ops-shadow' && readdirSync(dir).join(',') === '2026-11-11.jsonl')
check('🔴 저장소 안 · 이름이 다른 디렉터리는 거부', throws(() => assertShadowDir(join(REPO_ROOT, 'ops-shadow')), /OPS_SHADOW_IN_REPO/)
  && throws(() => assertShadowDir(join(tmp, 'elsewhere')), /OPS_SHADOW_BAD_DIR/))
// 🔴 observer 의 seen 판독 — 장부의 cycle id 집합 · 파일 없음은 빈 집합 · 깨진 줄은 던진다(건너뛰면 같은 회차를 또 쓴다)
check('🔴 readShadowCycleIds — 있는 날은 id 집합 · 없는 날은 빈 집합 · 날짜 모양이 아니면 던진다',
  [...readShadowCycleIds(dir, ['2026-11-11', '2026-11-10'])].sort().join(',') === 'c1,c2'
  && throws(() => readShadowCycleIds(dir, ['../x']), /OPS_SHADOW_BAD_DATE/))
writeFileSync(join(dir, '2026-11-09.jsonl'), `${JSON.stringify(rec('ok'))}\n{ broken\n`)
check('🔴 readShadowCycleIds — 깨진 줄이 있으면 던진다(observer 는 그 tick 을 실패로 끝낸다)',
  throws(() => readShadowCycleIds(dir, ['2026-11-09']), /OPS_SHADOW_CORRUPT/))
rmSync(join(dir, '2026-11-09.jsonl'))
// 🔴 회차 기록 판독 — 달력에 없는 id 파일은 깨짐으로 돌려준다(조용히 건너뛰지 않는다)
const runsDir = join(tmp, 'runs')
mkdirSync(runsDir)
const runDoc = (id: string): string => JSON.stringify({ runId: id, startedAt: new Date(runIdStartMs(id) ?? 0).toISOString(), status: 'done', completedAt: null })
writeFileSync(join(runsDir, 'supply-process-20261111-131500.run.json'), runDoc('20261111-131500'))
writeFileSync(join(runsDir, 'supply-process-20261132-131500.run.json'), JSON.stringify({ runId: '20261132-131500', startedAt: '2026-12-02T13:15:00.000Z', status: 'done', completedAt: null }))
writeFileSync(join(runsDir, 'supply-process-20261111-131600.run.json'), '{ broken')
const rr = readSupplyRuns(runsDir)
check('🔴 readSupplyRuns — 정상 1 · 달력 밖 id · 깨진 JSON 은 malformed 로', rr.readable && rr.runs.length === 1
  && rr.malformed.join(',') === '20261111-131600,20261132-131500', JSON.stringify(rr.malformed))

// 🔴 IO 의 자연 회차 판정 — 정본(`naturalScheduledRunEvidenceAt`) 그대로 · trigger 문자열만 보고 자연으로 치지 않는다
{
  const nd = join(tmp, 'runs-natural')
  mkdirSync(nd)
  const put = (id: string, tag: unknown): void => writeFileSync(join(nd, `supply-process-${id}.run.json`), JSON.stringify({
    runId: id, startedAt: new Date(runIdStartMs(id)!).toISOString(), status: 'done', completedAt: new Date(runIdStartMs(id)! + 600_000).toISOString(), runTokenShadow: tag,
  }))
  put('20261111-131500', tagOf('scheduled'))
  put('20261111-121500', { trigger: 'scheduled' })
  put('20261111-081500', tagOf('scheduled', { launch: 'manual' }))
  put('20261111-051500', tagOf('recovery'))
  const byId = new Map(readSupplyRuns(nd).runs.map((x) => [x.runId, x.naturalAt]))
  check('🔴 readSupplyRuns — 완전한 예약 tag 만 naturalAt · trigger-only · launch manual · recovery 는 null',
    byId.get('20261111-131500') === '2026-11-11T13:15:00.000Z' && byId.get('20261111-121500') === null
    && byId.get('20261111-081500') === null && byId.get('20261111-051500') === null && byId.size === 4, JSON.stringify([...byId]))
}

// 🔴 backfill marker — DB · 결정 · 장부 없이 marker 한 줄만(연결하면 아래 가짜 주소로 실패한다)
{
  const { runShadowCycle } = await import('./lib/ops-shadow-cycle.mjs')
  const { naturalRunKeyOf } = await import('../src/lib/ops-shadow-plan')
  const saved = { db: process.env.DATABASE_URL, direct: process.env.DIRECT_URL }
  process.env.DATABASE_URL = 'postgresql://nobody@127.0.0.1:1/none'
  process.env.DIRECT_URL = 'postgresql://nobody@127.0.0.1:1/none'
  const bDir = join(tmp, 'backfill', 'ops-shadow')
  const COMPLETED = '2026-11-11T13:40:00.000Z'
  const OBSERVED = new Date('2026-11-12T01:00:00.000Z')
  const key = naturalRunKeyOf('20261111-131500', COMPLETED)
  const g = installShadowCallGuard()
  let res: Awaited<ReturnType<typeof runShadowCycle>> | null = null
  let err = ''
  try {
    res = await runShadowCycle({
      now: OBSERVED, clock: 'real', kstDate: '2026-11-11',
      source: { kind: 'naturalRun', runId: '20261111-131500', completedAt: COMPLETED, key, mode: 'backfill', integrity: 'unknown' },
      dataDir: join(tmp, 'no-such-data'), outDir: bDir, dry: false, json: false, log: () => {},
    })
  } catch (e) { err = String(e) } finally {
    g()
    if (saved.db === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved.db
    if (saved.direct === undefined) delete process.env.DIRECT_URL; else process.env.DIRECT_URL = saved.direct
  }
  const bLines = existsSync(bDir) ? readdirSync(bDir).flatMap((f) => readFileSync(join(bDir, f), 'utf-8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>)) : []
  const m = bLines[0]
  check('🔴 backfill — DB · 결정 · 장부 없이 marker 한 줄 · dayClose 0', err === '' && res !== null && res.ok && res.written === 1 && bLines.length === 1
    && m !== undefined && m.kind === 'cycle', err.slice(0, 200))
  check('🔴 backfill marker — 봉투 · 계획 · 관측 · 부족분 · 결과 · writer 가 전부 null',
    m !== undefined && ['envelope', 'plan', 'observation', 'deficit', 'outcome', 'writer'].every((k) => k in m && m[k] === null))
  check('🔴 backfill marker — 관측 시각은 실제로 본 시각 · 완료 시각은 출처로만 · 시계 real',
    m !== undefined && m.at === OBSERVED.toISOString() && m.at !== COMPLETED && m.clock === 'real'
    && (m.source as { completedAt?: unknown; mode?: unknown }).completedAt === COMPLETED && (m.source as { mode?: unknown }).mode === 'backfill')
  check('🔴 backfill marker id = 회차 열쇠 cycle id(causal 과 같은 자리)', m !== undefined && m.cycleId === cycleIdOf('cycle', '2026-11-11', key))
}

// 🔴 observer 단일 실행 잠금 — causal/backfill 경계 경합(진행 중인 causal 을 뒤 tick 의 marker 가 앞지르지 못한다)
{
  const lDir = join(tmp, 'lock', 'ops-shadow')
  const lockPath = join(lDir, '.observer.lock')
  const claimPath = join(lDir, '.observer-cleanup.lock')
  const DEAD = 2_147_483_000
  const rawOf = (pid: number): string => JSON.stringify({ pid, at: NOW.toISOString(), nonce: `n-${pid}-${Math.random()}` })
  const pidIn = (p: string): number | null => { try { return (JSON.parse(readFileSync(p, 'utf-8')) as { pid: number }).pid } catch { return null } }
  const reset = (): void => { rmSync(lDir, { recursive: true, force: true }); mkdirSync(lDir, { recursive: true }) }
  reset()
  const l1 = acquireObserverLock(lDir)
  const held = pidIn(lockPath)
  if (l1.acquired) l1.release()
  check('🔴 잠금 — 비어 있으면 잡고(내 pid) · 풀면 파일이 사라진다', l1.acquired && held === process.pid && !existsSync(lockPath))
  reset()
  const liveRaw = rawOf(process.ppid)
  writeFileSync(lockPath, liveRaw)
  const l2 = acquireObserverLock(lDir)
  check('🔴 잠금 — 살아 있는 남의 잠금 → busy · 기다리지 않는다 · 남의 원문 그대로',
    !l2.acquired && l2.reason === 'busy' && l2.holderPid === process.ppid && readFileSync(lockPath, 'utf-8') === liveRaw)
  for (const [name, raw] of [['죽은 pid', rawOf(DEAD)], ['깨진 잠금', '{ broken']] as const) {
    reset()
    writeFileSync(lockPath, raw)
    const c = acquireObserverLock(lDir)
    check(`🔴 잠금 — ${name} → 정리만(cleaned) · 이번 tick 은 잡지 않는다 · 잠금 · claim 둘 다 없다`,
      !c.acquired && c.reason === 'cleaned' && !existsSync(lockPath) && !existsSync(claimPath))
    const next = acquireObserverLock(lDir)
    check(`잠금 — ${name} 정리 뒤 다음 tick 은 잡는다`, next.acquired)
    if (next.acquired) next.release()
  }
  reset()
  writeFileSync(claimPath, rawOf(process.ppid))
  const l5 = acquireObserverLock(lDir)
  check('🔴 잠금 — 정리 claim 이 살아 있으면 잡으려는 쪽은 물러난다(잠금이 비어 있어도 0)',
    !l5.acquired && l5.reason === 'cleanupInProgress' && !existsSync(lockPath))
  reset()
  const deadLock = rawOf(DEAD)
  writeFileSync(lockPath, deadLock)
  const deadClaim = rawOf(DEAD)
  writeFileSync(claimPath, deadClaim)
  const l6 = acquireObserverLock(lDir)
  check('🔴 잠금 — 주인이 죽은 정리 claim → cleanupStranded · claim · 잠금 둘 다 지우지 않는다(사람이 확인)',
    !l6.acquired && l6.reason === 'cleanupStranded' && readFileSync(claimPath, 'utf-8') === deadClaim && readFileSync(lockPath, 'utf-8') === deadLock)
  // 재검증 — 죽은 원문을 본 뒤 그사이 새 잠금이 걸렸으면 정리자는 지우지 않는다
  reset()
  const fresh = rawOf(process.ppid)
  writeFileSync(lockPath, fresh)
  const l7 = cleanupStaleObserverLock(lDir, rawOf(DEAD))
  check('🔴 정리 재검증 — 본 원문과 지금 원문이 다르면 지우지 않는다(raced) · 새 잠금 그대로 · claim 풀림',
    !l7.acquired && l7.reason === 'raced' && readFileSync(lockPath, 'utf-8') === fresh && !existsSync(claimPath))
  reset()
  // 둘 다 죽었어도 본 원문과 다르면 지우지 않는다(본 주인만 지운다) · 잠금이 이미 사라졌으면 아무것도 지우지 않는다
  const otherDead = rawOf(DEAD)
  writeFileSync(lockPath, otherDead)
  const l7b = cleanupStaleObserverLock(lDir, rawOf(DEAD))
  check('🔴 정리 재검증 — 지금 잠금도 죽었지만 본 원문이 아니면 지우지 않는다(raced)',
    !l7b.acquired && l7b.reason === 'raced' && existsSync(lockPath) && readFileSync(lockPath, 'utf-8') === otherDead && !existsSync(claimPath))
  rmSync(lockPath)
  let l7cErr = ''
  let l7c: ReturnType<typeof cleanupStaleObserverLock> | null = null
  try { l7c = cleanupStaleObserverLock(lDir, rawOf(DEAD)) } catch (e) { l7cErr = String(e) }
  check('🔴 정리 재검증 — 잠금이 이미 사라졌으면 raced · 던지지 않는다 · claim 풀림',
    l7cErr === '' && l7c !== null && !l7c.acquired && l7c.reason === 'raced' && !existsSync(claimPath), l7cErr.slice(0, 120))
  reset()
  const sameDead = rawOf(DEAD)
  writeFileSync(lockPath, sameDead)
  writeFileSync(claimPath, rawOf(process.ppid))
  const l8 = cleanupStaleObserverLock(lDir, sameDead)
  check('🔴 정리 claim 은 하나 — 남이 쥐고 있으면 두 번째 정리자는 아무것도 지우지 않는다',
    !l8.acquired && l8.reason === 'cleanupInProgress' && readFileSync(lockPath, 'utf-8') === sameDead)
  reset()
  const l9 = acquireObserverLock(lDir)
  const other = rawOf(process.ppid)
  if (l9.acquired) { writeFileSync(lockPath, other); l9.release() }
  check('🔴 잠금 — 원문이 바뀐 뒤 내 release 는 남의 잠금을 지우지 않는다', l9.acquired && existsSync(lockPath) && readFileSync(lockPath, 'utf-8') === other)
  reset()

  // 🔴 실제 동시 프로세스 — 같은 순간 8개가 잡거나 정리한다(원본 검사에서 1회 · 변이 하네스는 위 단일 프로세스 반례가 지킨다)
  if (!FAST) {
    const lw = join(tmp, 'lock-worker.mts')
    writeFileSync(lw, `import { acquireObserverLock } from ${JSON.stringify(join(REPO_ROOT, 'scripts/lib/ops-shadow-io.mts'))}\n`
      + "import { readFileSync } from 'node:fs'\n"
      + 'const [dir, goAt] = process.argv.slice(2) as [string, string]\n'
      + 'while (Date.now() < Number(goAt)) { /* 같은 순간에 출발 */ }\n'
      + 'const r = acquireObserverLock(dir)\n'
      + 'let stillMine = null\n'
      + 'if (r.acquired) {\n'
      + "  const mine = readFileSync(dir + '/.observer.lock', 'utf-8')\n"
      + '  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400)\n'
      + "  stillMine = readFileSync(dir + '/.observer.lock', 'utf-8') === mine\n"
      + '  r.release()\n'
      + '}\n'
      + 'console.log(JSON.stringify({ acquired: r.acquired, reason: r.acquired ? null : r.reason, stillMine }))\n')
    type W = { acquired: boolean; reason: string | null; stillMine: boolean | null }
    const race = (n: number): Promise<W[]> => {
      const goAt = Date.now() + 2_500
      return Promise.all(Array.from({ length: n }, () => new Promise<W>((res) => {
        let out = ''
        const c = spawn(join(REPO_ROOT, 'node_modules/.bin/tsx'), [lw, lDir, String(goAt)], { stdio: ['ignore', 'pipe', 'ignore'] })
        c.stdout.on('data', (b: Buffer) => { out += b.toString() })
        c.on('close', () => { try { res(JSON.parse(out.trim()) as W) } catch { res({ acquired: false, reason: 'crash', stillMine: null }) } })
      })))
    }
    const tally = (ws: W[]): string => ws.map((w) => (w.acquired ? 'A' : w.reason)).sort().join(',')
    const empty = await race(8)
    check('🔴 동시 8 · 빈 잠금 — 정확히 하나만 잡고 그 잠금은 끝까지 그 주인 것 · 나머지는 busy/raced · 정리 0',
      empty.filter((w) => w.acquired).length === 1 && empty.every((w) => !w.acquired ? ['busy', 'raced'].includes(w.reason!) : w.stillMine === true)
      && !existsSync(lockPath) && !existsSync(claimPath), tally(empty))
    writeFileSync(lockPath, rawOf(process.pid))
    const live = await race(8)
    check('🔴 동시 8 · 살아 있는 잠금 — 잡음 0 · 정리 0 · 원문 그대로', live.every((w) => !w.acquired && w.reason === 'busy')
      && pidIn(lockPath) === process.pid, tally(live))
    reset()
    for (const [name, mk] of [['죽은 pid', (): string => rawOf(DEAD)], ['깨진 잠금', (): string => '{ broken']] as const) {
      let bad = ''
      for (let round = 0; round < 3; round += 1) {
        writeFileSync(lockPath, mk())
        const ws = await race(8)
        const cleaned = ws.filter((w) => w.reason === 'cleaned').length
        const acq = ws.filter((w) => w.acquired)
        // 🔴 정리는 정확히 한 번 · 잡은 쪽은 많아야 하나 · 잡은 잠금은 아무도 지우지 못했다 · 끝나면 잠금 · claim 0
        if (cleaned !== 1 || acq.length > 1 || acq.some((w) => w.stillMine !== true) || ws.some((w) => w.reason === 'crash' || w.reason === 'cleanupStranded')
          || existsSync(lockPath) || existsSync(claimPath)) bad += `[${round}:${tally(ws)}]`
        reset()
      }
      check(`🔴 동시 8 × 3 라운드 · ${name} — 정리 정확히 1 · 잡음 ≤1 · 새로 잡은 잠금이 지워진 적 0 · 잔여 0`, bad === '', bad)
    }
    writeFileSync(claimPath, rawOf(process.pid))
    const cl = await race(8)
    check('🔴 동시 8 · 정리 claim 진행 중 — 전원 물러남 · 잠금 0', cl.every((w) => !w.acquired && w.reason === 'cleanupInProgress') && !existsSync(lockPath), tally(cl))
    reset()
  }

  // CLI 경계 반례 — 완료 +4:59 에 causal 을 고른 observer 가 잠금을 쥔 채 도는 동안 +5:01 tick 이 온다
  const bdData = join(tmp, 'boundary-data')
  mkdirSync(bdData)
  const DONE_AT = '2026-11-10T13:40:00.000Z'
  writeFileSync(join(bdData, 'supply-process-20261110-131500.run.json'), JSON.stringify({
    runId: '20261110-131500', startedAt: '2026-11-10T13:15:00.000Z', status: 'done', completedAt: DONE_AT, runTokenShadow: tagOf('scheduled'),
  }))
  const tick = (ms: number): string => new Date(Date.parse(DONE_AT) + ms).toISOString()
  const sel1 = (nowIso: string): string | undefined => selectObserverWork({ now: new Date(nowIso), runs: readSupplyRuns(bdData).runs, seenCycleIds: new Set() }).work[0]?.mode
  check('경계 전제 — +4:59 는 causal · +5:01 은 backfill', sel1(tick(299_000)) === 'causal' && sel1(tick(301_000)) === 'backfill')
  // 격리 시험 계약 — 격리 표식 · 닿지 않는 soran_test 주소 · 임시 HOME(연결하면 실패한다)
  const isoHome = join(tmp, 'iso-home')
  mkdirSync(isoHome, { recursive: true })
  const NO_DB = 'postgresql://nobody@127.0.0.1:1/soran_test'
  const isoEnv = { ...process.env, NODE_OPTIONS: '', HOME: isoHome, SORAN_ISOLATED_DB: 'yes-throwaway', DATABASE_URL: NO_DB, DIRECT_URL: NO_DB }
  const bdOut = join(tmp, 'boundary', 'ops-shadow')
  mkdirSync(bdOut, { recursive: true })
  writeFileSync(join(bdOut, '.observer.lock'), JSON.stringify({ pid: process.ppid, at: tick(299_000) }))
  const cli = (nowIso: string): ReturnType<typeof spawnSync> => spawnSync(join(REPO_ROOT, 'node_modules/.bin/tsx'),
    [join(REPO_ROOT, 'scripts/ops-shadow-observer.mts'), `--data-dir=${bdData}`, `--out-dir=${bdOut}`, `--now=${nowIso}`], {
      cwd: REPO_ROOT, encoding: 'utf-8', env: isoEnv,
    })
  const jsonl = (): string[] => readdirSync(bdOut).filter((f) => f.endsWith('.jsonl'))
  const busy = cli(tick(301_000))
  check('🔴 경계 — causal observer 가 쥔 동안 +5:01 tick 은 아무것도 고르지 않는다(marker 0 · exit 0 · 남의 잠금 그대로)',
    busy.status === 0 && jsonl().length === 0 && /잠금 busy/.test(String(busy.stdout))
    && (JSON.parse(readFileSync(join(bdOut, '.observer.lock'), 'utf-8')) as { pid: number }).pid === process.ppid,
    `${String(busy.status)} ${String(busy.stderr).slice(0, 300)}`)
  rmSync(join(bdOut, '.observer.lock'))
  const free = cli(tick(301_000))
  check('기준 — 잠금이 없으면 같은 +5:01 tick 은 DB 없이 backfill marker 한 줄 · 잠금은 풀린다', free.status === 0 && jsonl().length === 1
    && !existsSync(join(bdOut, '.observer.lock')), `${String(free.status)} ${String(free.stderr).slice(0, 300)}`)
}

// 🔴 주입 시각 계약 — 격리 시험 밖에서는 손 실행 · observer 모두 --now 를 거부한다(지금 DB · 장부로 지난 관측 0)
{
  const gHome = join(tmp, 'gate-home')
  mkdirSync(gHome, { recursive: true })
  const gOut = join(tmp, 'gate', 'ops-shadow')
  const UNREACH = 'postgresql://nobody@127.0.0.1:1/none'
  const PAST = '2026-11-10T13:00:00.000Z'
  const run = (script: string, env: NodeJS.ProcessEnv): ReturnType<typeof spawnSync> => spawnSync(join(REPO_ROOT, 'node_modules/.bin/tsx'),
    [join(REPO_ROOT, script), `--data-dir=${join(tmp, 'gate-data')}`, `--out-dir=${gOut}`, `--now=${PAST}`], { cwd: REPO_ROOT, encoding: 'utf-8', env })
  const plainEnv = { ...process.env, NODE_OPTIONS: '', HOME: gHome, SORAN_ISOLATED_DB: '', DATABASE_URL: UNREACH, DIRECT_URL: UNREACH }
  const realHomeEnv = { ...process.env, NODE_OPTIONS: '', SORAN_ISOLATED_DB: 'yes-throwaway',
    DATABASE_URL: 'postgresql://nobody@127.0.0.1:1/soran_test', DIRECT_URL: 'postgresql://nobody@127.0.0.1:1/soran_test' }
  for (const script of ['scripts/ops-shadow-plan.mts', 'scripts/ops-shadow-observer.mts']) {
    const a1 = run(script, plainEnv)
    const a2 = run(script, realHomeEnv)
    check(`🔴 ${script} --now — 격리 표식 · soran_test 주소가 없으면 exit 2 · 기록 0`, a1.status === 2 && /격리 시험 계약/.test(String(a1.stderr)) && !existsSync(gOut),
      `${String(a1.status)} ${String(a1.stderr).slice(0, 200)}`)
    check(`🔴 ${script} --now — 격리 DB 여도 실제 계정 홈이면 exit 2 · 기록 0`, a2.status === 2 && /실제 계정 홈/.test(String(a2.stderr)) && !existsSync(gOut),
      `${String(a2.status)} ${String(a2.stderr).slice(0, 200)}`)
  }
  check('🔴 판정 함수 — 셋 다 맞아야 빈 목록 · 하나라도 빠지면 그 이유', injectedClockProblems({ SORAN_ISOLATED_DB: 'yes-throwaway',
    DATABASE_URL: 'postgresql://u@localhost:5432/soran_test', DIRECT_URL: 'postgresql://u@localhost:5432/soran_test' }, '/tmp/x', '/Users/me').length === 0
    && injectedClockProblems({ SORAN_ISOLATED_DB: 'yes-throwaway', DATABASE_URL: 'postgresql://u@localhost:5432/soran_test' }, '/tmp/x', '/Users/me').length === 1
    && injectedClockProblems({ SORAN_ISOLATED_DB: 'yes-throwaway', DATABASE_URL: 'postgresql://u@db.example.com:5432/soran_test',
      DIRECT_URL: 'postgresql://u@localhost:5432/soran_test' }, '/tmp/x', '/Users/me').length === 1)

  // 🔴 배포 잠금이 있으면 observer tick 은 아무것도 하지 않는다(감사 장부 디렉터리 · 잠금조차 만들지 않는다)
  const dHome = join(tmp, 'deploy-home')
  const dCanon = join(dHome, 'Library', 'Application Support', 'soransoran')
  mkdirSync(dCanon, { recursive: true })
  writeFileSync(join(dCanon, 'runtime-deploy.lock'), 'token\n')
  const dOut = join(tmp, 'deploy', 'ops-shadow')
  const dr = spawnSync(join(REPO_ROOT, 'node_modules/.bin/tsx'), [join(REPO_ROOT, 'scripts/ops-shadow-observer.mts'),
    `--data-dir=${join(tmp, 'gate-data')}`, `--out-dir=${dOut}`], {
    cwd: REPO_ROOT, encoding: 'utf-8', env: { ...process.env, NODE_OPTIONS: '', HOME: dHome, DATABASE_URL: UNREACH, DIRECT_URL: UNREACH },
  })
  check('🔴 배포 겹침 — runtime-deploy.lock 이 있으면 observer 는 exit 0 · 장부 디렉터리 · 잠금 · 기록 0',
    dr.status === 0 && /배포 중/.test(String(dr.stdout)) && !existsSync(dOut) && !existsSync(join(tmp, 'deploy')), `${String(dr.status)} ${String(dr.stderr).slice(0, 200)}`)
}

// 🔴 잠금 — 구조: 확인 · 덧붙이기가 장부와 같은 잠금 한 구간 안에 있다(빠른 검사 · 변이 하네스가 반복)
const ioSrc = readFileSync(join(REPO_ROOT, 'scripts/lib/ops-shadow-io.mts'), 'utf-8')
check('🔴 잠금 구조 — appendShadowRecord 가 withLedgerLock 안에서만 appendLocked 를 부른다',
  /return withLedgerLock\(d, \(\) => appendLocked\(path, record\)\)/.test(ioSrc) && (ioSrc.match(/appendLocked\(/g) ?? []).length === 2)
if (!FAST) {
// 🔴 잠금 — 남이 쥔 잠금이 있으면 기다리다 실패한다(두 줄을 쓰지 않는다) · 실제 20초 대기 1회
writeFileSync(join(dir, '.lock'), JSON.stringify({ owner: 'other', pid: 1, at: NOW.toISOString() }))
const t0 = Date.now()
check('🔴 잠금 — 남이 쥔 동안에는 덧붙이지 않고 던진다(장부와 같은 withLedgerLock)',
  throws(() => appendShadowRecord(dir, rec('c3')), /잠금/) && !readFileSync(w1.path, 'utf-8').includes('"c3"'), `${Date.now() - t0}ms`)
rmSync(join(dir, '.lock'), { force: true })
// 🔴 실제 동시 프로세스 — 같은 사이클 8개 · 다른 사이클 8개
const worker = join(tmp, 'append-worker.mts')
writeFileSync(worker, `import { appendShadowRecord } from ${JSON.stringify(join(REPO_ROOT, 'scripts/lib/ops-shadow-io.mts'))}\n`
  + 'const [dir, id, json] = process.argv.slice(2) as [string, string, string]\n'
  + 'appendShadowRecord(dir, { ...JSON.parse(json), cycleId: id })\n')
const recJson = JSON.stringify({ ...rec('x'), kstDate: '2026-11-12' })
const runWorkers = (ids: string[]): Promise<number[]> => Promise.all(ids.map((id) => new Promise<number>((res) => {
  const c = spawn(join(REPO_ROOT, 'node_modules/.bin/tsx'), [worker, dir, id, recJson], { stdio: 'ignore' })
  c.on('close', (code) => res(code ?? -1))
})))
const codesSame = await runWorkers(Array.from({ length: 8 }, () => 'same'))
const codesDiff = await runWorkers(Array.from({ length: 8 }, (_, i) => `d${i}`))
const day2 = readFileSync(join(dir, '2026-11-12.jsonl'), 'utf-8').split('\n').filter((l) => l !== '').map((l) => (JSON.parse(l) as { cycleId: string }).cycleId)
check('🔴 동시 프로세스 8개 · 같은 사이클 → 한 줄 · 다른 사이클 8개 → 8줄(유실 0)',
  codesSame.every((c) => c === 0) && codesDiff.every((c) => c === 0)
  && day2.filter((x) => x === 'same').length === 1 && new Set(day2.filter((x) => x !== 'same')).size === 8 && day2.length === 9,
  `${codesSame.join('')}/${codesDiff.join('')} ${day2.length}`)
}

// 🔴 정제 — 기록 · 해시에 예약 id · 세션 · pid · 경로 · 사유 문장이 없다
const SECRET = { attemptId: 'SECRET-ATTEMPT-9', sessionId: 'SECRET-SESSION', pid: 424242, stage: 'draftGen', runId: 'SECRET-RUN' }
const dirty = obsOf({ ledger: { ...obsOf().ledger, settleHold: '/Users/someone/Library/hold — 사람이 확인', unresolved: [{ code: 'OWNER_GONE', reason: 'SECRET-REASON /Users/x', reservation: SECRET } as never] } })
const clean = sanitizeObservation(dirty)
const dirtyPlan = planDeficit(ENV, dirty)
const blob = JSON.stringify({ clean, dirtyPlan, rec: { ...rec('s'), observation: clean, deficit: dirtyPlan } })
check('🔴 정제 ratchet — SECRET · /Users · pid · 사유 문장 0 · 개수와 코드만 남는다',
  !/SECRET|\/Users|424242|사람이 확인/.test(blob) && clean.ledger.settleHold === true
  && clean.ledger.unresolved.count === 1 && clean.ledger.unresolved.codes.join() === 'OWNER_GONE'
  && dirtyPlan.wouldRunSources === 0 && dirtyPlan.spendVerdict?.ok === false && dirtyPlan.spendVerdict.code === 'SETTLE_ERROR', blob.slice(0, 200))
check('🔴 정제는 판정을 바꾸지 않는다 — 보류 · 미해결은 메모리에서 지출 판정에 그대로 쓰인다',
  planDeficit(ENV, obsOf({ ledger: { ...obsOf().ledger, unresolved: [{ code: 'OWNER_GONE', reason: 'r', reservation: SECRET } as never] } })).limitedBy.includes('UNRESOLVED_RESERVATION'))

rmSync(tmp, { recursive: true, force: true })
check('검사 임시 디렉터리 정리', !existsSync(tmp))

// ─────────────────────────────────────────────────────────
console.log('\n⑥ ratchet')
// ─────────────────────────────────────────────────────────
const SRC = ['src/lib/ops-shadow-plan.ts', 'scripts/lib/ops-shadow-io.mts', 'scripts/ops-shadow-plan.mts',
  'scripts/lib/ops-shadow-cycle.mts', 'scripts/ops-shadow-observer.mts', 'src/lib/ops-shadow-observer.ts']
  .map((f) => [f, readFileSync(join(REPO_ROOT, f), 'utf-8')] as const)
const src = (f: string): string => SRC.find(([n]) => n === f)![1]
const code = (t: string): string => t.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
check('🔴 단계 이름 분기 0 — 코드에 d1~d100 리터럴이 없다', SRC.every(([, t]) => !/['"`]d(1|3|5|10|20|30|50|100)['"`]/.test(code(t))),
  SRC.filter(([, t]) => /['"`]d(1|3|5|10|20|30|50|100)['"`]/.test(code(t))).map(([f]) => f).join(','))
const pureImports = [...src('src/lib/ops-shadow-plan.ts').matchAll(/from '([^']+)'/g)].map((m) => m[1]!)
check('🔴 순수 모듈 import 는 판정 권위와 node:crypto 뿐', pureImports.every((m) => ['node:crypto', './llm-ledger', './persona-target-rules', './ready-fate',
  './stage-evidence', './supply-process', './supply-selection-trace', './supply-workset', './supply-schedule-contract'].includes(m)), pureImports.join(','))
const obsImports = [...src('src/lib/ops-shadow-observer.ts').matchAll(/from '([^']+)'/g)].map((m) => m[1]!)
check('🔴 observer 선택기 import 는 Phase 1 계약과 공급 회차 창뿐', obsImports.every((m) => ['./ops-shadow-plan', './supply-schedule-contract'].includes(m)), obsImports.join(','))
// 🔴 진입점 둘 — 가드를 건 뒤에만 공용 사이클을 import 한다
for (const f of ['scripts/ops-shadow-plan.mts', 'scripts/ops-shadow-observer.mts']) {
  const t = src(f)
  const g = t.indexOf('installShadowCallGuard()')
  check(`🔴 ${f} — 가드 설치가 공용 사이클 · 판정 모듈 import 보다 앞선다`, g > 0
    && g < t.indexOf("await import('./lib/ops-shadow-cycle.mjs')") && [...t.matchAll(/await import\(/g)].every((m) => (m.index ?? 0) > g))
  check(`🔴 ${f} — 주입 시각은 과거만 · 실행 명령(--apply · --call · --live) 거부 · 실행 함수 호출 0`,
    /now\.getTime\(\) > realNow\.getTime\(\)/.test(t) && /--apply/.test(t)
    && !/\b(spawn|execFile|fork)\(/.test(code(t)) && !/\.(create|update|upsert|delete)(Many)?\(/.test(code(t)))
}
const cyc = src('scripts/lib/ops-shadow-cycle.mts')
check('🔴 공용 사이클 — 가드가 없으면 던진다 · 기록 · 해시는 정제된 관측만',
  /if \(!isShadowGuardInstalled\(\)\) throw/.test(cyc) && /recorded = sanitizeObservation\(observation\)/.test(cyc)
  && /inputHashOf\(\{ envelope, plan, observation: recorded, source \}\)/.test(cyc) && /observation: recorded, deficit/.test(cyc) && !/observation, deficit/.test(cyc))
check('🔴 공용 사이클 — 기록은 ShadowRecord 변형 타입으로만 만든다(관측 기록 · backfill marker · as never · as unknown 우회 0)', /const cycle: ShadowObservedRecord = /.test(cyc)
  && /const records: ShadowRecord\[\] = \[cycle\]/.test(cyc) && /const dayClose: ShadowObservedRecord = /.test(cyc) && /const marker: ShadowBackfillMarker = /.test(cyc) && !/as never|as unknown as ShadowRecord/.test(code(cyc)))
check('🔴 공용 사이클 — 자연 회차 cycle id 는 회차 열쇠 · dayClose 는 마지막 자연 회차 열쇠(heartbeat 시각 0)',
  /source\.kind === 'naturalRun' \? source\.key : cycleHash/.test(cyc)
  && /cycleIdOf\('dayClose', kstDate, naturalRunKeyOf\(writer\.runId, writer\.completedAt\)\)/.test(cyc))
check('🔴 공용 사이클 — backfill 은 결정 · 장부 · DB · snapshot 앞에서 marker 로 끝난다',
  /if \(source\.kind === 'naturalRun' && source\.mode === 'backfill'\) return writeBackfillMarker\(o, source\)/.test(cyc)
  && cyc.indexOf('return writeBackfillMarker(o, source)') < cyc.indexOf("await import('../../src/lib/stage-decision-repo')")
  && ((): boolean => {
    const body = cyc.slice(cyc.indexOf('async function writeBackfillMarker'), cyc.indexOf('export async function runShadowCycle'))
    return body.length > 0 && !/PrismaClient|readStageDecision|readLedgerDay|snapshot\(|readSupplyRuns|fillDbConnection/.test(body)
  })())
check('🔴 observer — 관측 시각은 tick 시각 · 시계는 real/injected(완료 시각을 관측 시각으로 쓰지 않는다)',
  /now, clock: nowFlag === null \? 'real' : 'injected'/.test(src('scripts/ops-shadow-observer.mts'))
  && !/new Date\(w\.completedAt\)|runCompleted/.test(code(src('scripts/ops-shadow-observer.mts'))))
check('🔴 실행 함수 · DB 쓰기 · 저장 · 발행 · 댓글 · 공급 실행 경로 0(진입점 · 공용 사이클 · 선택기)',
  SRC.every(([f, t]) => f.endsWith('ops-shadow-io.mts') || (!/(^|[^.\w])(spawn|spawnSync|execFile|execFileSync|fork|exec|execSync)\(/m.test(code(t))
    && !/\b(db|raw|prisma)\.\w+\.(create|update|upsert|delete)(Many)?\(/.test(code(t)) && !/\$(executeRaw|queryRaw|transaction)/.test(code(t))))
  && !/(original-post-auto-publish|persona-comment-loop|micro-seed-auto-draft|micro-seed-auto-judge|stage-controller\.mts|stage-consume-exec|createStageDecision|supply-llm-call\.mjs'\)\.call|runtime-deploy(\.mjs)?')/.test(SRC.map(([, t]) => t).join('\n')))

check('🔴 provider 호출 경로 0 — 진입점 · 공용 사이클 · 선택기에 fetch · SDK 생성 · LLM 호출이 없다',
  SRC.every(([f, t]) => f.endsWith('ops-shadow-io.mts') || (!/(^|[^.\w])fetch\(/m.test(code(t)) && !/new (Anthropic|OpenAI)\(|messages\.create\(/.test(code(t)))))
// 🔴 구조 — 공급 · 공급 plist 는 observer 를 모른다. observer 를 부르는 자리는 ops-loop 소유 경로와 검사뿐이다
{
  const supply = readFileSync(join(REPO_ROOT, 'scripts/supply-process.mts'), 'utf-8')
  const supplyTpl = readFileSync(join(REPO_ROOT, 'docs/operations/launchd/com.soransoran.supply-process.plist.template'), 'utf-8')
  check('🔴 공급 프로세스 · 공급 plist 는 ops shadow 를 참조하지 않는다(supply hook · command chain 0 · 공급 exit 불변)',
    !/ops-shadow|OpsShadow|OPS_SHADOW/.test(supply) && !/ops-shadow|&&|;/.test(supplyTpl.replace(/<!--[\s\S]*?-->/g, '')))
  const walkSrc = (dir: string): string[] => readdirSync(join(REPO_ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) return e.name === 'node_modules' || e.name.startsWith('.') ? [] : walkSrc(rel)
    return /\.(m?ts|tsx|template|json)$/.test(e.name) ? [rel] : []
  })
  const ALLOWED = new Set([
    'scripts/lib/ops-loop-install-core.mts', 'scripts/lib/ops-loop-templates.ts', 'scripts/lib/ops-shadow-cycle.mts',
    'scripts/lib/ops-shadow-io.mts', 'scripts/lib/runtime-quiesce-jobs.ts', 'scripts/ops-loop-check.mts', 'scripts/ops-loop-render.mts',
    'scripts/ops-shadow-observer.mts', 'scripts/ops-shadow-plan-check.mts', 'scripts/ops-shadow-plan-db-check.mts',
    'scripts/ops-shadow-plan-mutation.mts', 'scripts/ops-shadow-plan.mts', 'scripts/runtime-isolation-check.mts',
    'src/lib/ops-shadow-observer.ts', 'src/lib/runtime-isolation.ts',
    // lifecycle 소유 — 설치기(명시 --observer=on/off) · 호스트 이전 레인(설치본이 있을 때만) · 그 검사
    'scripts/ops-loop-install.mts', 'scripts/lib/host-migrate.mts', 'scripts/host-migrate-check.mts', 'scripts/production-activation-check.mts',
  ])
  const refs = [...walkSrc('scripts'), ...walkSrc('src'), ...walkSrc('docs/operations/launchd')]
    .filter((f) => /ops-shadow-observer|OPS_SHADOW_OBSERVER|selectObserverWork|runShadowCycle/.test(readFileSync(join(REPO_ROOT, f), 'utf-8')))
  const stray = refs.filter((f) => !ALLOWED.has(f))
  check('🔴 observer 를 참조하는 코드는 ops-loop 소유 경로 · 설치기 · 호스트 이전 레인 · 격리 판정 · shadow 자신 · 검사뿐(공급 · 발행 · 댓글 · controller 0)', stray.length === 0 && refs.length > 0, stray.join(','))
  check('🔴 정적 launchd 템플릿에 observer 가 없다(7번째 정적 템플릿 0 · 동적 render 하나)',
    !readdirSync(join(REPO_ROOT, 'docs/operations/launchd')).some((f) => /ops-shadow/.test(f)))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)
