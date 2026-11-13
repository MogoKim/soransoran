/**
 * 🔴 **예측 경고 · 결정일 결속 검사 — PR1b** (2026-11-06 · canon §3.1 · §3.2 · §11.1)
 *
 *    ① 막는 코드와 막지 않는 코드의 분리 — 실제 `judgeNextPreflight`
 *       · 원천 기회·처리량·READY 필요량 예측 5코드 → `forecastWarnings` (판정 PASS 유지)
 *       · `LATENCY_UNKNOWN` → 막지 않는 `warnings` (관측일 뿐 판정 엔진이 아니다 — canon §9)
 *       · `SUPPLY_COST_TRIAL_RISK` → `warnings` 그대로
 *    ② v6 `supply` 투영은 `forecastSupplyOf` 하나 — 닫힌 5코드만, `warnings` 는 절대 넣지 않는다
 *    ③ 비용 회귀(실측 모양, 값은 fixture) — 정산 다수 + 미상 소수 → bounded 경고 · 신원 불명 → UNKNOWN · 예산 초과 → SHORT
 *    ④ 막는 코드는 전부 canon §3.2 hard gate 범주다 (독립 oracle 목록)
 *    ⑤ 제한 복구는 예측 경고만 있는 날 열리지 않는다 — 5코드 모든 조합 · 07:00 즉시 저장 지시
 *    ⑥ recovery 신원 판정 날짜 = preflight 결정일(증명 슬롯의 단일 KST 날짜) — `now` 가 아니다
 *    ⑦ 배선 — 결정일을 한 번 계산해 신원 판정과 `facts.proofKstDate` 에 같이 쓴다
 *    ⑧ readiness 출력용 비용 요약은 기존 귀속 값에서 고른 칸뿐이다
 *
 *    🔴 DB · 네트워크 · provider · 파일 write 0.
 */
import { readFileSync } from 'node:fs'
import {
  judgeNextPreflight, forecastSupplyOf, preflightLogLine, PREFLIGHT_CODES, PREFLIGHT_WARNING_CODES,
  type PreflightFacts, type PreflightVerdict,
} from '../src/lib/stage-ladder-generic'
import {
  validateStoredDecision, FORECAST_WARNING_CODES, STAGE_DECISION_V6, DECISION_WRITER, type ForecastWarningCode,
} from '../src/lib/stage-decision-contract'
import { planActiveRecovery, activeRecoveryDirective } from '../src/lib/stage-active-recovery'
import { planStageDecision } from '../src/lib/stage-ladder'
import { profileOf } from '../src/lib/scale-profile'
import {
  RUNNER_GRID, recoveryIdentityOf, recoveryIdentityDateOf, preflightCostSummaryOf, NO_RECOVERY_CLAIM,
} from './lib/stage-preflight-facts.mjs'
import { slotTimesOn } from '../src/lib/stage-ladder-generic'

let pass = 0
let fail = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) pass += 1
  else fail += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${!ok && detail !== '' ? ` — ${detail}` : ''}`)
}

const N = profileOf('d20').dailyTarget
const PROOF = '2026-11-07'
/** 🔴 d20 의 모든 축이 green 인 사실 — 각 검사는 한 축만 비튼다 */
const GOOD = (): PreflightFacts => ({
  proofKstDate: PROOF,
  slotValidOpportunities: N * 2,
  slotValidReadyStock: N,
  readyCohort: {
    sources: N, published: N, lost: 0, scheduled: 0, unknown: 0,
    usdPerSlotValidResult: 0.001,
    trialCost: { settledRequests: 20, usageUnknownRequests: 0, overrunRequests: 0, ineligibleRequests: 0, riskUsdPerSlotValidResult: 0.001 },
  },
  latencyP50H: 3, latencyP90H: 10,
  contractValidPersonas: 500, commentUsdPerRequest: 0.001, commentDailyUsdCap: 0.2,
  auditUsdPerCall: 0.001, auditDailyUsdCap: 0.3, supplyDailyUsdCap: 1.2, runnerHealth: 'ok',
})
const pf = (o: Partial<PreflightFacts> = {}): PreflightVerdict => judgeNextPreflight('d20', { ...GOOD(), ...o }, RUNNER_GRID)
const cohort = (o: Partial<NonNullable<PreflightFacts['readyCohort']>>): PreflightFacts['readyCohort'] => ({ ...GOOD().readyCohort!, ...o })
const has = (xs: readonly string[], c: string): boolean => xs.includes(c)

console.log('\n① 막는 코드와 막지 않는 코드의 분리')
const green = pf()
check('green d20 → PASS · 코드 0 · 경고 0',
  green.verdict === 'PASS' && green.codes.length === 0 && green.forecastWarnings.length === 0 && green.warnings.length === 0,
  JSON.stringify({ v: green.verdict, c: green.codes, f: green.forecastWarnings, w: green.warnings }))
const forecastCases: readonly [ForecastWarningCode, Partial<PreflightFacts>][] = [
  ['OPPORTUNITY_SHORT', { slotValidOpportunities: 0, futureSupplyCapacity: 0 }],
  ['OPPORTUNITY_UNKNOWN', { slotValidOpportunities: null }],
  ['THROUGHPUT_SHORT', { readyCohort: cohort({ sources: 400, published: 1 }) }],
  ['THROUGHPUT_UNKNOWN', { readyCohort: cohort({ sources: 0 }) }],
  ['READY_REQUIREMENT_UNKNOWN', { readyCohort: cohort({ published: 0, unknown: N }) }],
]
for (const [code, patch] of forecastCases) {
  const v = pf(patch)
  check(`🔴 ${code} 는 막지 않는 예측 경고다 — 판정 PASS · forecastWarnings 에만 있다`,
    v.verdict === 'PASS' && has(v.forecastWarnings, code) && !has(v.codes, code),
    JSON.stringify({ v: v.verdict, c: v.codes, f: v.forecastWarnings }))
}
{
  const v = pf({ latencyP50H: null, latencyP90H: null })
  check('🔴 LATENCY_UNKNOWN 은 막지 않는 관측 경고다 — 판정 PASS · warnings 에만 · v6 예측 경고 아님',
    v.verdict === 'PASS' && has(v.warnings, 'LATENCY_UNKNOWN') && !has(v.codes as readonly string[], 'LATENCY_UNKNOWN')
    && !has(v.forecastWarnings, 'LATENCY_UNKNOWN') && !(FORECAST_WARNING_CODES as readonly string[]).includes('LATENCY_UNKNOWN'),
    JSON.stringify({ v: v.verdict, c: v.codes, w: v.warnings }))
}
{
  const v = pf({ contractValidPersonas: 1 })
  check('🔴 hard gate(Persona 하한)는 그대로 FAIL', v.verdict === 'FAIL' && has(v.codes, 'PERSONA_SHORT'))
  const r = pf({ runnerHealth: null })
  check('🔴 hard gate(runner 모름)는 그대로 UNKNOWN', r.verdict === 'UNKNOWN' && has(r.codes, 'RUNNER_UNKNOWN'))
}

console.log('\n② v6 supply 투영은 하나 · 닫힌 5코드만')
{
  check('preflight 를 평가하지 않았으면 null', forecastSupplyOf(null) === null)
  const all = pf({
    slotValidOpportunities: null, readyCohort: cohort({ sources: 0 }), latencyP50H: null, latencyP90H: null,
  })
  const s = forecastSupplyOf(all)
  check('🔴 투영 결과는 정확히 {forecastWarnings} 이고 판정의 예측 경고와 같다',
    s !== null && JSON.stringify(Object.keys(s)) === '["forecastWarnings"]'
    && JSON.stringify(s.forecastWarnings) === JSON.stringify(all.forecastWarnings), JSON.stringify(s))
  check('🔴 LATENCY_UNKNOWN · SUPPLY_COST_TRIAL_RISK 는 투영에 들어가지 않는다',
    s !== null && s.forecastWarnings.every((c) => (FORECAST_WARNING_CODES as readonly string[]).includes(c))
    && has(all.warnings, 'LATENCY_UNKNOWN'))
  const row = {
    kstDate: PROOF, capacity: 'd30', release: 'd20', state: 'PREPARE', reasons: [], blocks: [], dayPinned: false,
    supply: s, decidedAt: '2026-11-06T22:00:00.000Z', contractVersion: STAGE_DECISION_V6, decidedBy: DECISION_WRITER, transition: null,
  }
  const v = validateStoredDecision({ row, expectKstDate: PROOF })
  check('🔴 투영 결과는 v6 validator 를 통과한다', v.ok, v.ok ? '' : v.reason)
  check('🔴 반례: warnings 를 합친 모양은 v6 validator 가 거절한다',
    !validateStoredDecision({ row: { ...row, supply: { forecastWarnings: [...all.forecastWarnings, ...all.warnings] } }, expectKstDate: PROOF }).ok)
}

console.log('\n③ 비용 회귀 — 정산 다수·미상 소수 → bounded 경고 (값은 fixture)')
{
  const costCohort = (trial: NonNullable<NonNullable<PreflightFacts['readyCohort']>['trialCost']> | null) =>
    cohort({ usdPerSlotValidResult: null, trialCost: trial })
  const bounded = pf({ readyCohort: costCohort({
    settledRequests: 479, usageUnknownRequests: 2, recoveryUsageUnknownRequests: 0, overrunRequests: 0, ineligibleRequests: 0,
    riskUsdPerSlotValidResult: 0.0540102,
  }) })
  check('🔴 정산 479 · 미상 2 · 결과당 위험 $0.054 × 20 < 예산 → SUPPLY_COST_* 막는 코드 없음 · TRIAL_RISK 경고',
    !bounded.codes.some((c) => c.startsWith('SUPPLY_COST')) && has(bounded.warnings, 'SUPPLY_COST_TRIAL_RISK') && bounded.verdict === 'PASS',
    JSON.stringify({ v: bounded.verdict, c: bounded.codes, w: bounded.warnings }))
  check('🔴 그 경고는 v6 supply 투영에 들어가지 않는다', !has(forecastSupplyOf(bounded)!.forecastWarnings, 'SUPPLY_COST_TRIAL_RISK'))
  const orphan = pf({ readyCohort: costCohort(null) })
  check('🔴 같은 날 신원 불명 recovery(trialCost null) → SUPPLY_COST_UNKNOWN 그대로', has(orphan.codes, 'SUPPLY_COST_UNKNOWN') && orphan.verdict !== 'PASS')
  const over = pf({ readyCohort: costCohort({
    settledRequests: 479, usageUnknownRequests: 2, overrunRequests: 0, ineligibleRequests: 0, riskUsdPerSlotValidResult: 0.0600001,
  }) })
  check('🔴 결과당 위험 × 20 이 예산을 넘으면 SUPPLY_COST_SHORT', has(over.codes, 'SUPPLY_COST_SHORT') && over.verdict === 'FAIL')
}

console.log('\n④ 막는 코드는 전부 hard gate 범주다')
{
  const HARD = [
    'SLOTS_INFEASIBLE', 'PUBLISH_CAPACITY_SHORT', 'PERSONA_SHORT', 'PERSONA_UNKNOWN',
    // canon §3.2 Persona canary 하한 hard gate 의 D30 이상 실투입 칸(2026-11-13 · §4)
    'PERSONA_ACTIVE_SHORT', 'PERSONA_ACTIVE_UNKNOWN',
    'COMMENT_COST_SHORT', 'COMMENT_COST_UNKNOWN', 'COMMENT_RUNNER_SHORT', 'AUDIT_COST_SHORT', 'AUDIT_COST_UNKNOWN',
    'SUPPLY_COST_SHORT', 'SUPPLY_COST_UNKNOWN', 'RUNNER_BAD', 'RUNNER_UNKNOWN',
  ]
  const blocking = (PREFLIGHT_CODES as readonly string[]).filter((c) => !(FORECAST_WARNING_CODES as readonly string[]).includes(c))
  check('🔴 막을 수 있는 preflight 코드 = 독립 oracle 의 hard gate 목록', JSON.stringify([...blocking].sort()) === JSON.stringify([...HARD].sort()),
    blocking.join(','))
  check('🔴 막지 않는 경고 목록은 비용 시험 위험 · 지연 관측 둘',
    JSON.stringify([...PREFLIGHT_WARNING_CODES].sort()) === JSON.stringify(['LATENCY_UNKNOWN', 'SUPPLY_COST_TRIAL_RISK']))
}

console.log('\n⑤ 제한 복구는 예측 경고만 있는 날 열리지 않는다')
{
  const base = green
  let reachable = 0
  const combos = (1 << FORECAST_WARNING_CODES.length) - 1
  for (let m = 1; m <= combos; m += 1) {
    const forecastWarnings = FORECAST_WARNING_CODES.filter((_, k) => (m & (1 << k)) !== 0)
    const synthetic: PreflightVerdict = { ...base, verdict: 'PASS', codes: [], forecastWarnings }
    const plan = planActiveRecovery({ target: 'd20', preflight: synthetic, signals: [], failures: [], now: new Date('2026-11-06T22:05:00Z') })
    if (plan.kind !== 'none' || plan.hardBlock) reachable += 1
  }
  check(`🔴 예측 경고 ${combos} 가지 조합 모두에서 복구 계획 없음(hardBlock 아님)`, reachable === 0, `${reachable}`)
  for (const [code, patch] of forecastCases) {
    const real = pf(patch)
    const plan = planActiveRecovery({ target: 'd20', preflight: real, signals: [], failures: [], now: new Date('2026-11-06T22:05:00Z') })
    const d = activeRecoveryDirective({ phase: 'intermediate', artifact: { kind: 'absent' }, plan })
    check(`🔴 실제 판정(${code}) → 복구 없음 · 07:00 즉시 저장(decide-now)`, plan.kind === 'none' && d.kind === 'decide-now', JSON.stringify({ plan, d }))
  }
}

console.log('\n⑥ recovery 신원 판정 날짜 = preflight 결정일')
{
  const tagged = (startedAt: string, run: string) => ({
    stage: 'judge', status: 'settled', startedAt, runId: `${run}-j`, runTokenShadow: { trigger: 'recovery' },
  }) as never
  // 11-06 07:02 KST 에 시작한 복구 회차(claim 없음)
  const entries = [tagged('2026-11-05T22:02:30.000Z', '20261105-220220')]
  const tomorrow = recoveryIdentityDateOf(slotTimesOn('2026-11-07', profileOf('d20')))
  const today = recoveryIdentityDateOf(slotTimesOn('2026-11-06', profileOf('d20')))
  check('결정일은 증명 슬롯의 단일 KST 날짜다', tomorrow === '2026-11-07' && today === '2026-11-06', `${tomorrow} ${today}`)
  check('🔴 11-06 복구 회차는 11-07 결정의 신원을 오염시키지 않는다',
    recoveryIdentityOf(NO_RECOVERY_CLAIM, entries, tomorrow).issue === null)
  check('🔴 같은 날 claim 없는 복구 요청은 여전히 신원 불명이다(SUPPLY_COST_UNKNOWN 경로)',
    recoveryIdentityOf(NO_RECOVERY_CLAIM, entries, today).issue !== null)
  const mixed = recoveryIdentityDateOf([...slotTimesOn('2026-11-06', profileOf('d20')), ...slotTimesOn('2026-11-07', profileOf('d20'))])
  check('🔴 날짜가 섞이거나 비면 결정일은 null 이다', mixed === null && recoveryIdentityDateOf([]) === null)
  check('🔴 시각이 아닌 슬롯(NaN)이 섞이면 던지지 않고 null 이다', (() => {
    try {
      return recoveryIdentityDateOf([new Date(Number.NaN)]) === null
        && recoveryIdentityDateOf([...slotTimesOn('2026-11-07', profileOf('d20')), new Date(Number.NaN)]) === null
    } catch { return false }
  })())
  check('🔴 결정일을 모르면 신원은 불명이다 — now 로 대신하지 않는다',
    recoveryIdentityOf(NO_RECOVERY_CLAIM, [], null).issue !== null)
}

console.log('\n⑦ 배선 — 결정일 한 번 계산 · 두 자리에 같은 값')
{
  const src = readFileSync('scripts/lib/stage-preflight-facts.mts', 'utf8')
  const body = src.slice(src.indexOf('export async function readPreflightFacts'))
  const decl = /const (\w+) = recoveryIdentityDateOf\(i\.proofSlots\)/.exec(body)
  const name = decl?.[1] ?? '∅'
  check('🔴 readPreflightFacts 가 결정일을 증명 슬롯에서 한 번 계산한다', decl !== null)
  check('🔴 recovery 신원 판정이 그 값을 쓴다(now 가 아니다)',
    new RegExp(`recoveryIdentityOf\\([^)]*,\\s*${name}\\)`).test(body) && !/recoveryIdentityOf\([^)]*kstDateString\(i\.now\)\)/.test(body))
  check('🔴 facts.proofKstDate 도 같은 값이다', new RegExp(`proofKstDate:\\s*${name}\\b`).test(body))
}

console.log('\n⑧ readiness 비용 요약 — 기존 귀속 값에서 고른 칸뿐')
{
  check('귀속을 모르면 null', preflightCostSummaryOf(null) === null)
  const s = preflightCostSummaryOf({
    settledRequests: 479, usageUnknownRequests: 2, recoveryUsageUnknownRequests: 0, trialIneligibleRequests: 0,
    openRequests: 2, openReservedUsd: 0.0183219, totalUsd: 1.71, legacyUsd: 0, unlinkedUsd: 0,
  } as never)
  check('🔴 요약 칸은 정확히 여섯이다',
    s !== null && JSON.stringify(Object.keys(s).sort()) === JSON.stringify([
      'openRequests', 'openReservedUsd', 'recoveryUsageUnknownRequests', 'settledRequests', 'trialIneligibleRequests', 'usageUnknownRequests',
    ]), JSON.stringify(s))
  const readiness = readFileSync('scripts/d20-readiness.mts', 'utf8')
  check('🔴 d20-readiness 출력이 경고 · 예측 경고 · 비용 요약을 싣는다',
    /warnings:\s*pf\.warnings/.test(readiness) && /forecastWarnings:\s*pf\.forecastWarnings/.test(readiness)
    && /preflightCostSummaryOf\(/.test(readiness))
}

console.log('\n⑨ 사다리는 v6 supply 를 nextPreflight 에서만 만든다 — 주입 입력 없음')
{
  const ladder = readFileSync('src/lib/stage-ladder.ts', 'utf8')
  const inputs = ladder.slice(ladder.indexOf('export type StageInputs = {'), ladder.indexOf('}\n', ladder.indexOf('export type StageInputs = {')))
  check('🔴 StageInputs 에 supply 입력이 없다', inputs.length > 0 && !/\bsupply\??\s*:/.test(inputs), inputs.slice(0, 120))
  check('🔴 planStageDecision 이 supply 를 forecastSupplyOf(input.nextPreflight) 로만 만든다',
    /supply:\s*forecastSupplyOf\(input\.nextPreflight\)/.test(ladder) && !/input\.supply/.test(ladder))
  const withPf = planStageDecision({
    kstDate: PROOF, sustainedRelease: 'd10', previousDecision: null, publishedToday: 0, decidedAt: '2026-11-06T22:00:00.000Z',
    nextPreflight: pf({ slotValidOpportunities: null }),
  })
  const noPf = planStageDecision({
    kstDate: PROOF, sustainedRelease: 'd10', previousDecision: null, publishedToday: 0, decidedAt: '2026-11-06T22:00:00.000Z',
    nextPreflight: null,
  })
  check('🔴 preflight 가 있으면 supply = 투영 · 없으면 null · 둘 다 v6',
    JSON.stringify(withPf.supply) === '{"forecastWarnings":["OPPORTUNITY_UNKNOWN"]}' && noPf.supply === null
    && withPf.contractVersion === STAGE_DECISION_V6 && noPf.contractVersion === STAGE_DECISION_V6,
    JSON.stringify({ a: withPf.supply, b: noPf.supply, v: withPf.contractVersion }))
  for (const d of [withPf, noPf]) {
    const v = validateStoredDecision({ row: d, expectKstDate: PROOF })
    check(`🔴 사다리 결정(supply ${JSON.stringify(d.supply)})이 v6 validator 를 통과한다`, v.ok, v.ok ? '' : v.reason)
  }
}

console.log('\n⑩ controller 운영 로그 — 막는 코드 · 운영 경고 · 예측 경고를 따로 보인다')
{
  const all = pf({ slotValidOpportunities: null, latencyP50H: null, contractValidPersonas: 1 })
  const line = preflightLogLine('d20', all)
  check('🔴 세 갈래가 각자 자리에 찍힌다 — [PERSONA_SHORT] · WARN [LATENCY_UNKNOWN] · FORECAST [OPPORTUNITY_UNKNOWN]',
    / preflight FAIL \[[^\]]*PERSONA_SHORT[^\]]*\]/.test(line) && / WARN \[LATENCY_UNKNOWN\]/.test(line)
    && / FORECAST \[OPPORTUNITY_UNKNOWN\]/.test(line) && !/\[[^\]]*OPPORTUNITY_UNKNOWN[^\]]*\] WARN/.test(line), line)
  const forecastOnly = preflightLogLine('d20', pf({ slotValidOpportunities: null }))
  check('🔴 🔴 **예측만 있는 날 — PASS 여도 FORECAST 가 보인다(PASS 뒤에 숨지 않는다)**',
    / preflight PASS FORECAST \[OPPORTUNITY_UNKNOWN\] \(/.test(forecastOnly), forecastOnly)
  const clean = preflightLogLine('d20', pf())
  check('경고 없는 날 — 빈 FORECAST·WARN 꼬리를 찍지 않는다', / preflight PASS \(/.test(clean) && !/FORECAST|WARN/.test(clean), clean)
  const controller = readFileSync('scripts/stage-controller.mts', 'utf8')
  check('🔴 production controller 가 이 함수로 preflight 줄을 찍는다(손으로 조립한 옛 줄 없음)',
    /log\(preflightLogLine\(target, nextPreflight\)\)/.test(controller)
    && !/nextPreflight\.warnings\.join/.test(controller), '')
}

console.log(`\n예측 경고 · 결정일 결속 검사: ${pass} pass, ${fail} fail`)
if (fail > 0) process.exit(1)
