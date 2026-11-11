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
import { PERSONA_COMMENTS_PER_POST_MAX } from '../src/lib/persona-target-rules'
import { judgeStageBudget, WORKSET_TOTAL_PER_SOURCE } from '../src/lib/supply-workset'
import { readSupplySelectionTrace, SELECTION_TRACE_KIND, SELECTION_TRACE_VERSION, summarizeTrace, type TraceCandidate } from '../src/lib/supply-selection-trace'
import { observationBucketOf } from '../src/lib/source-slot-release'
import { tallyOf, type DayTally, type BudgetLimits } from '../src/lib/llm-ledger'
import { appendShadowRecord, assertShadowDir, installShadowCallGuard, readOnlyDb, readSupplyRuns, REPO_ROOT } from './lib/ops-shadow-io.mjs'

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
type FixtureRun = SupplyRunView & {
  jit: { slots: number; readyFilled: number; upTo: number; paidSources: number; paidBasis: string; sourceYieldHigh: number | null }
  settledUsd: { j: number; d: number }
}
const fx = JSON.parse(readFileSync(join(REPO_ROOT, 'scripts/__fixtures__/ops-shadow/supply-runs-20261107-11.json'), 'utf-8')) as { runs: FixtureRun[] }
check('fixture 30회차 · 식별자 0', fx.runs.length === 30
  && !/(navercafe|82cook|sourceArticleId|nickname|postId)/.test(JSON.stringify(fx)))
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
const r = (id: string, start: string, status: string, done: string | null, trigger: string | null): SupplyRunView =>
  ({ runId: id, startedAt: start, status, completedAt: done, trigger })
const W_NOW = new Date('2026-11-11T14:00:00.000Z')
const lastRuns = [
  r('20261111-131500', '2026-11-11T13:15:00.000Z', 'done', '2026-11-11T13:40:00.000Z', 'scheduled'),
  r('20261111-131600', '2026-11-11T13:16:00.000Z', 'running', null, 'scheduled'),
]
check('🔴 마지막 슬롯 자연 회차가 둘이고 하나가 진행 중이면 due 아님(먼저 끝난 하나로 닫지 않는다)', !writerDueOf('2026-11-11', W_NOW, lastRuns).due)
const bothDone = [lastRuns[0]!, { ...lastRuns[1]!, status: 'done', completedAt: '2026-11-11T13:35:00.000Z' }]
const w2 = writerDueOf('2026-11-11', W_NOW, bothDone)
check('🔴 둘 다 끝나면 가장 늦게 끝난 회차로 결정적', w2.due && w2.runId === '20261111-131500'
  && canonicalJson(w2) === canonicalJson(writerDueOf('2026-11-11', W_NOW, [...bothDone].reverse())))
check('손 실행만 있으면 due 아님', !writerDueOf('2026-11-11', W_NOW, [r('20261111-131500', '2026-11-11T13:15:00.000Z', 'done', '2026-11-11T13:40:00.000Z', 'manual')]).due)
const ok1 = r('20261111-131500', '2026-11-11T13:15:00.000Z', 'done', '2026-11-11T13:40:00.000Z', 'scheduled')
check('기준 — 관측 시각 전에 끝난 자연 회차면 due', writerDueOf('2026-11-11', W_NOW, [ok1]).due)
check('🔴 반례 — 관측 시각(아침)보다 미래에 시작한 22:15 회차는 due 아님', !writerDueOf('2026-11-11', new Date('2026-11-11T00:00:00.000Z'), [ok1]).due)
check('🔴 반례 — 완료 시각이 관측 시각보다 미래면 due 아님', !writerDueOf('2026-11-11', new Date('2026-11-11T13:30:00.000Z'), [ok1]).due)
check('🔴 반례 — 완료가 시작보다 이르면 due 아님', !writerDueOf('2026-11-11', W_NOW, [{ ...ok1, completedAt: '2026-11-11T13:00:00.000Z' }]).due)
check('🔴 반례 — 시각이 엄격 ISO 가 아니면 due 아님', !writerDueOf('2026-11-11', W_NOW, [{ ...ok1, completedAt: '2026-11-11 13:40' }]).due)
check('🔴 반례 — 시작 시각이 엄격 ISO 가 아니면(읽히긴 해도) due 아님', !writerDueOf('2026-11-11', W_NOW, [{ ...ok1, startedAt: '2026-11-11T13:15:00Z' }]).due)
check('🔴 반례 — done 이 아닌 상태(실패)면 완료 시각이 있어도 due 아님', !writerDueOf('2026-11-11', W_NOW, [{ ...ok1, status: 'failed' }]).due)
check('🔴 회차 id 달력 검사 — 13월 · 32일 · 2월 30일 · 24시 · 60분은 null · 정상 id 는 round-trip',
  ['20261332-221500', '20261132-221500', '20260230-221500', '20261111-241500', '20261111-226000', '2026111-221500'].every((x) => runIdStartMs(x) === null)
  && runIdStartMs('20261111-131500') === Date.UTC(2026, 10, 11, 13, 15, 0) && runIdStartMs('20280229-000000') !== null)
check('🔴 반례 — 달력에 없는 회차 id 의 깨진 기록은 시각을 모르니 막는다', !writerDueOf('2026-11-11', W_NOW, [ok1], ['20261132-131500']).due)
check('🔴 반례 — 마지막 슬롯 창의 회차 기록이 깨졌으면 due 아님 · 창 밖 깨짐은 영향 없음 · id 를 못 읽으면 막는다',
  !writerDueOf('2026-11-11', W_NOW, [ok1], ['20261111-132000']).due
  && writerDueOf('2026-11-11', W_NOW, [ok1], ['20261111-031500']).due
  && !writerDueOf('2026-11-11', W_NOW, [ok1], ['garbage']).due)

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 부작용 0')
// ─────────────────────────────────────────────────────────
const restore = installShadowCallGuard()
check('🔴 가드 — fetch 가 던진다', throws(() => fetch('https://example.invalid'), /OPS_SHADOW_NO_NETWORK/))
check('🔴 가드 — 자식 프로세스(ESM 이름 import 바인딩까지)가 던진다', throws(() => spawnSync('true'), /OPS_SHADOW_NO_CHILD_PROCESS/))
restore()
check('가드 해제 — 검사 프로세스는 원래대로', spawnSync('true').status === 0)
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
  clock: 'injected', authority: 'none', envelope: env20, plan: planP, observation: sanitizeObservation(obsOf()), deficit: a, outcome: null, writer: null,
})
const w1 = appendShadowRecord(dir, rec('c1'))
const w1b = appendShadowRecord(dir, rec('c1'))
appendShadowRecord(dir, rec('c2'))
const lines = readFileSync(w1.path, 'utf-8').split('\n').filter((l) => l !== '')
check('🔴 감사 장부 — 같은 사이클은 한 줄(멱등) · 덧붙이기만', w1.written && !w1b.written && lines.length === 2)
check('🔴 감사 장부 — 그 디렉터리의 날짜 파일 하나만 생긴다', readdirSync(tmp).join(',') === 'ops-shadow' && readdirSync(dir).join(',') === '2026-11-11.jsonl')
check('🔴 저장소 안 · 이름이 다른 디렉터리는 거부', throws(() => assertShadowDir(join(REPO_ROOT, 'ops-shadow')), /OPS_SHADOW_IN_REPO/)
  && throws(() => assertShadowDir(join(tmp, 'elsewhere')), /OPS_SHADOW_BAD_DIR/))
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
const SRC = ['src/lib/ops-shadow-plan.ts', 'scripts/lib/ops-shadow-io.mts', 'scripts/ops-shadow-plan.mts']
  .map((f) => [f, readFileSync(join(REPO_ROOT, f), 'utf-8')] as const)
const code = (t: string): string => t.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
check('🔴 단계 이름 분기 0 — 코드에 d1~d100 리터럴이 없다', SRC.every(([, t]) => !/['"`]d(1|3|5|10|20|30|50|100)['"`]/.test(code(t))),
  SRC.filter(([, t]) => /['"`]d(1|3|5|10|20|30|50|100)['"`]/.test(code(t))).map(([f]) => f).join(','))
const pure = SRC[0]![1]
const pureImports = [...pure.matchAll(/from '([^']+)'/g)].map((m) => m[1]!)
check('🔴 순수 모듈 import 는 판정 권위와 node:crypto 뿐', pureImports.every((m) => ['node:crypto', './llm-ledger', './persona-target-rules', './ready-fate',
  './stage-evidence', './supply-process', './supply-selection-trace', './supply-workset', './supply-schedule-contract'].includes(m)), pureImports.join(','))
const cli = SRC[2]![1]
check('🔴 CLI — 가드 설치가 첫 판정 모듈 import 보다 앞선다', cli.indexOf('installShadowCallGuard()') > 0
  && cli.indexOf('installShadowCallGuard()') < cli.indexOf("await import('../src/lib/ops-shadow-plan')"))
check('🔴 CLI — 기록 · 해시는 정제된 관측만 쓴다', /const recorded = sanitizeObservation\(observation\)/.test(cli)
  && /inputHashOf\(\{ envelope, plan, observation: recorded \}\)/.test(cli) && /observation: recorded, deficit/.test(cli) && !/observation, deficit/.test(cli))
check('🔴 CLI — 기록은 ShadowRecord 타입으로만 만든다(as never · as unknown 우회 0)', /const cycle: ShadowRecord = /.test(cli)
  && /const records: ShadowRecord\[\] = \[cycle\]/.test(cli) && /const dayClose: ShadowRecord = /.test(cli) && !/as never|as unknown as ShadowRecord/.test(code(cli)))
check('🔴 CLI — 주입 시각은 과거만 · 기록에 clock 칸', /now\.getTime\(\) > realNow\.getTime\(\)/.test(cli) && /clock, authority/.test(cli))
check('🔴 CLI — 실행 명령(--apply · --call · --live)을 거부한다 · 실행 함수를 부르지 않는다',
  /--apply/.test(cli) && !/\b(spawn|execFile|fork)\(/.test(code(cli)) && !/\.(create|update|upsert|delete)(Many)?\(/.test(code(cli)))
check('🔴 저장 · 발행 · 댓글 · 공급 실행 경로 import 0',
  !/(original-post-auto-publish|persona-comment-loop|micro-seed-auto-draft|micro-seed-auto-judge|stage-controller\.mts|stage-consume-exec|createStageDecision)/.test(SRC.map(([, t]) => t).join('\n')))

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)
