#!/usr/bin/env tsx
/**
 * 단계 회복 shadow의 순수 계약 검사.
 * DB 0 · 파일 write 0 · env 0 · provider 0. 행동 실행이 아니라 분류·수량 단위·권한 부재를 고정한다.
 */
import { readFileSync } from 'node:fs'

import { planStageRecovery } from '../src/lib/stage-recovery'
import { costAttributionOf, readyCostUnknownReasonOf } from '../src/lib/ready-fate'
import type { LedgerEntry } from '../src/lib/llm-ledger'
import { SUPPLY_JIT_CONTRACT } from '../src/lib/supply-intent'
import {
  PREFLIGHT_CODES,
  genericDailyTarget,
  judgeNextPreflight,
  type PreflightCode,
  type PreflightFacts,
  type PreflightVerdict,
  type ReadyCohortFact,
} from '../src/lib/stage-ladder-generic'
import type { StageRecoveryLane } from '../src/lib/stage-recovery'
import { RUNNER_GRID } from './lib/stage-preflight-facts.mjs'

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

const verdict = (
  kind: PreflightVerdict['verdict'],
  codes: readonly PreflightCode[],
  counts: Readonly<Record<string, number>> = { target: 20 },
): PreflightVerdict => ({ stage: 'd20', verdict: kind, codes, warnings: [], counts })

const cohort = (overrides: Partial<ReadyCohortFact> = {}): ReadyCohortFact => ({
  sources: 20,
  published: 20,
  lost: 0,
  scheduled: 0,
  unknown: 0,
  usdPerSlotValidResult: 0.001,
  ...overrides,
})

const facts = (overrides: Partial<PreflightFacts> = {}): PreflightFacts => ({
  slotValidOpportunities: genericDailyTarget('d20'),
  futureSupplyCapacity: 0,
  readyCohort: cohort(),
  latencyP50H: 20,
  latencyP90H: 60,
  contractValidPersonas: 100,
  commentUsdPerRequest: 0.001,
  commentDailyUsdCap: 1,
  auditUsdPerCall: 0.001,
  auditDailyUsdCap: 1,
  supplyDailyUsdCap: 1.2,
  runnerHealth: 'ok',
  ...overrides,
})

const SETTLED_ZERO_RESULT_ENTRY: LedgerEntry = {
  runId: '20261101-061500-j', stage: 'draftGen', attemptId: 'stage-recovery-zero-result', requestNo: 0,
  provider: 'anthropic', apiModelId: 'test-model', model: 'test-model', status: 'settled', blockCode: null,
  countedInputTokens: 100, maxOutputTokens: 1200, reservedUsd: 0.01,
  inputTokens: 100, outputTokens: 100, cacheWriteTokens: null, cacheReadTokens: null,
  usageKeys: ['input_tokens', 'output_tokens'], settledUsd: 0.01, pricingVersion: 'test',
  startedAt: '2026-10-31T21:15:00.000Z', endedAt: '2026-10-31T21:15:01.000Z', errorCode: null,
  sourceKey: 'source-1', supplyContract: SUPPLY_JIT_CONTRACT,
}

const zeroResultCost = costAttributionOf({
  entries: [SETTLED_ZERO_RESULT_ENTRY], fateByKey: new Map([['source-1', 'lost']]),
  counts: { published: 0, scheduled: 0 }, cohortRuns: new Set(['20261101-061500']),
})

const emptyLedgerCost = costAttributionOf({
  entries: [], fateByKey: new Map([['source-1', 'lost']]),
  counts: { published: 0, scheduled: 0 }, cohortRuns: new Set(['20261101-061500']),
})

const measuredCost = costAttributionOf({
  entries: [SETTLED_ZERO_RESULT_ENTRY], fateByKey: new Map([['source-1', 'published']]),
  counts: { published: 1, scheduled: 0 }, cohortRuns: new Set(['20261101-061500']),
})

/** 구현의 blocker 목록을 가져오지 않는다. 정책 정본을 독립 대조해 분류 이동을 잡는다. */
const EXPECTED_LANES = {
  SLOTS_INFEASIBLE: 'blocked',
  PUBLISH_CAPACITY_SHORT: 'blocked',
  OPPORTUNITY_SHORT: 'source',
  OPPORTUNITY_UNKNOWN: 'source',
  THROUGHPUT_SHORT: 'supply',
  THROUGHPUT_UNKNOWN: 'supply',
  READY_REQUIREMENT_UNKNOWN: 'observe',
  LATENCY_UNKNOWN: 'observe',
  PERSONA_SHORT: 'blocked',
  PERSONA_UNKNOWN: 'blocked',
  COMMENT_COST_SHORT: 'blocked',
  COMMENT_COST_UNKNOWN: 'blocked',
  COMMENT_RUNNER_SHORT: 'blocked',
  AUDIT_COST_SHORT: 'blocked',
  AUDIT_COST_UNKNOWN: 'blocked',
  SUPPLY_COST_SHORT: 'blocked',
  SUPPLY_COST_UNKNOWN: 'blocked',
  RUNNER_BAD: 'blocked',
  RUNNER_UNKNOWN: 'blocked',
} as const satisfies Record<PreflightCode, StageRecoveryLane>

const countsFor = (code: PreflightCode): Readonly<Record<string, number>> => {
  if (code === 'OPPORTUNITY_SHORT') return { target: 20, opportunities: 19 }
  if (code === 'OPPORTUNITY_UNKNOWN') return { target: 20, opportunitiesCurrent: 19 }
  if (code === 'THROUGHPUT_SHORT') return { target: 20, readyCapacity: 19 }
  return { target: 20 }
}

const callBodiesOf = (source: string, functionName: string): string[] => {
  const out: string[] = []
  let from = 0
  while (from < source.length) {
    const start = source.indexOf(`${functionName}({`, from)
    if (start < 0) break
    const brace = source.indexOf('{', start)
    let depth = 0
    let end = -1
    for (let i = brace; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1
      if (source[i] === '}') {
        depth -= 1
        if (depth === 0) { end = i + 1; break }
      }
    }
    if (end < 0) return []
    out.push(source.slice(brace, end))
    from = end
  }
  return out
}

console.log('\n══ stage recovery shadow contract ══')

{
  const p = planStageRecovery(verdict('PASS', [], { target: 20 }))
  check('PASS는 행동·부족량 없는 done이다',
    p.lane === 'done' && p.action === 'none' && p.deficitUnit === 'none'
    && p.deficitMin === null && p.deficitMax === null)
  check('shadow는 DB write와 단계 변경을 절대 허가하지 않는다',
    !p.authorizesWrites && !p.authorizesStageChange && p.mode === 'shadow')
}

{
  const p = planStageRecovery(verdict('FAIL', ['OPPORTUNITY_SHORT'], { target: 20, opportunities: 16 }))
  check('기회 16/20은 증명되지 않은 공개 슬롯이 최대 4개다',
    p.lane === 'source' && p.action === 'acquire_fresh_sources' && p.deficitUnit === 'public_slot'
    && p.deficitMin === 0 && p.deficitMax === 4 && p.deficitBasis === 'upper_bound')
}

{
  const p = planStageRecovery(verdict('UNKNOWN', ['OPPORTUNITY_UNKNOWN'], { target: 20, opportunitiesCurrent: 16 }))
  check('미래 기회 모름은 공개 슬롯 부족 범위를 0..4로 보수 기록한다',
    p.lane === 'source' && p.deficitUnit === 'public_slot'
    && p.deficitMin === 0 && p.deficitMax === 4 && p.deficitBasis === 'conservative')
  const noCount = planStageRecovery(verdict('UNKNOWN', ['OPPORTUNITY_UNKNOWN'], { target: 20 }))
  check('현재 기회 수도 모르면 부족 수를 지어내지 않는다',
    noCount.lane === 'source' && noCount.deficitMin === null && noCount.deficitMax === null
    && noCount.deficitBasis === 'unknown')
}

{
  const p = planStageRecovery(verdict('FAIL', ['THROUGHPUT_SHORT'], {
    target: 20, readyNeededMin: 25, readyNeededMax: 50, readyCapacity: 16,
  }))
  check('READY 처리량 부족은 공개 글이 아니라 READY 결과 9..34로 기록한다',
    p.lane === 'supply' && p.action === 'restore_ready_capacity' && p.deficitUnit === 'ready_result'
    && p.deficitMin === 9 && p.deficitMax === 34 && p.deficitBasis === 'lower_bound')
  const unknown = planStageRecovery(verdict('UNKNOWN', ['THROUGHPUT_UNKNOWN'], { target: 20 }))
  check('처리량 모름은 READY 복구 lane이지만 수량은 만들지 않는다',
    unknown.lane === 'supply' && unknown.deficitUnit === 'ready_result'
    && unknown.deficitMin === null && unknown.deficitMax === null)
  const requirement = planStageRecovery(verdict('UNKNOWN', ['READY_REQUIREMENT_UNKNOWN'], { target: 20 }))
  check('필요 READY 구간만 모르면 과잉 공급하지 않고 재측정한다',
    requirement.lane === 'observe' && requirement.action === 'remeasure' && requirement.deficitUnit === 'none')
}

{
  const p = planStageRecovery(verdict('UNKNOWN', ['LATENCY_UNKNOWN']))
  check('지연 표본만 모르면 쓰기 없이 재측정한다',
    p.lane === 'observe' && p.action === 'remeasure' && p.deficitUnit === 'none')
}

{
  const mismatches = PREFLIGHT_CODES.flatMap((code) => {
    const p = planStageRecovery(verdict(code.endsWith('UNKNOWN') ? 'UNKNOWN' : 'FAIL', [code], countsFor(code)))
    return p.lane === EXPECTED_LANES[code] ? [] : [`${code}:${p.lane}!=${EXPECTED_LANES[code]}`]
  })
  check('19개 preflight code가 독립 정책표의 정확한 lane에 속한다', mismatches.length === 0, mismatches.join(','))
}

{
  const p = planStageRecovery(verdict('FAIL', ['OPPORTUNITY_SHORT', 'THROUGHPUT_SHORT'], {
    target: 20, opportunities: 16, readyNeededMin: 20, readyCapacity: 12,
  }))
  check('원천과 처리량이 함께 부족하면 원천이 우선이고 처리량 finding은 보존된다',
    p.lane === 'source' && p.deficitMin === 0 && p.deficitMax === 4
    && p.secondaryCodes.includes('THROUGHPUT_SHORT'))
}

{
  const sourceObserve = planStageRecovery(verdict('FAIL', ['OPPORTUNITY_SHORT', 'LATENCY_UNKNOWN'], {
    target: 20, opportunities: 16,
  }))
  const supplyObserve = planStageRecovery(verdict('FAIL', ['THROUGHPUT_SHORT', 'LATENCY_UNKNOWN'], {
    target: 20, readyNeededMin: 20, readyCapacity: 12,
  }))
  check('source·supply는 observe보다 우선이고 관측 finding을 버리지 않는다',
    sourceObserve.lane === 'source' && sourceObserve.secondaryCodes.includes('LATENCY_UNKNOWN')
    && supplyObserve.lane === 'supply' && supplyObserve.secondaryCodes.includes('LATENCY_UNKNOWN'))
}

{
  const p = planStageRecovery(verdict('FAIL', ['OPPORTUNITY_SHORT', 'RUNNER_BAD'], { target: 20, opportunities: 16 }))
  check('회복 가능 부족과 hard blocker가 함께면 blocker가 이기고 부족 finding은 보존된다',
    p.lane === 'blocked' && p.reasons.includes('RUNNER_BAD') && p.secondaryCodes.includes('OPPORTUNITY_SHORT'))
}

{
  const p = planStageRecovery(verdict('FAIL', ['SUPPLY_COST_UNKNOWN', 'RUNNER_BAD'], {
    target: 20, supplyCostUnobserved: 1, supplyProofBudgetUsd: 0.1,
  }))
  check('무표본 비용 finding과 다른 blocker가 함께면 blocker가 이기고 비용 finding도 보존된다',
    p.lane === 'blocked' && p.reasons.includes('RUNNER_BAD')
    && p.secondaryCodes.includes('SUPPLY_COST_UNKNOWN'))
}

{
  const badOpportunity = planStageRecovery(verdict('FAIL', ['OPPORTUNITY_SHORT'], { target: 20, opportunities: 20 }))
  const badThroughput = planStageRecovery(verdict('FAIL', ['THROUGHPUT_SHORT'], { target: 20, readyCapacity: 20 }))
  check('SHORT 코드와 숫자가 모순이면 0회 행동으로 숨기지 않고 중단한다',
    badOpportunity.lane === 'blocked' && badThroughput.lane === 'blocked')
  check('PASS+code와 non-PASS+빈 code도 계약 불일치로 중단한다',
    planStageRecovery(verdict('PASS', ['LATENCY_UNKNOWN'])).lane === 'blocked'
    && planStageRecovery(verdict('UNKNOWN', [])).lane === 'blocked')
}

console.log('\n══ real preflight → recovery replay ══')

check('실제 비용 귀속 함수가 양수 정산·완전 귀속·결과 0을 일반 장부 장애와 분리한다',
  zeroResultCost?.totalUsd === 0.01 && zeroResultCost.usdPerSlotValidResult === null
  && zeroResultCost.unknownReason === 'zero_result')
check('READY 결말은 있지만 현재 cohort 정산이 없는 빈 장부는 비용 근거 부재다',
  emptyLedgerCost?.totalUsd === 0 && emptyLedgerCost.unknownReason === 'ledger_or_attribution')
check('실제 preflight facts와 같은 단일 매핑이 무표본·장부 부재·측정 단가를 구분한다',
  readyCostUnknownReasonOf(zeroResultCost) === 'zero_result'
  && readyCostUnknownReasonOf(emptyLedgerCost) === 'ledger_or_attribution'
  && readyCostUnknownReasonOf(null) === 'ledger_or_attribution'
  && readyCostUnknownReasonOf(measuredCost) === undefined)

{
  const pf = judgeNextPreflight('d20', facts({
    readyCohort: cohort({
      published: 0, lost: 0, scheduled: 0, unknown: 0,
      usdPerSlotValidResult: null, costUnknownReason: zeroResultCost?.unknownReason ?? 'ledger_or_attribution',
    }),
  }), RUNNER_GRID)
  const p = planStageRecovery(pf)
  check('공개·READY 0인 실제 preflight는 비용 장애가 아니라 bounded 수율 측정 후보가 된다',
    pf.codes.includes('THROUGHPUT_SHORT') && pf.codes.includes('SUPPLY_COST_UNKNOWN')
    && !('readyNeededMin' in pf.counts) && p.lane === 'supply'
    && p.action === 'measure_ready_yield' && p.deficitMin === 20 && p.deficitMax === null
    && p.deficitBasis === 'lower_bound', JSON.stringify({ codes: pf.codes, counts: pf.counts, p }))
}

{
  const pf = judgeNextPreflight('d20', facts({
    readyCohort: cohort({
      published: 0, lost: 3, scheduled: 0, unknown: 0,
      usdPerSlotValidResult: null, costUnknownReason: zeroResultCost?.unknownReason ?? 'ledger_or_attribution',
    }),
  }), RUNNER_GRID)
  const p = planStageRecovery(pf)
  check('공개 0·손실 3인 실제 preflight도 일반 비용 blocker로 오판하지 않는다',
    pf.codes.includes('THROUGHPUT_SHORT') && p.lane === 'supply'
    && p.action === 'measure_ready_yield' && p.deficitMin === 5 && p.deficitMax === null,
  JSON.stringify({ codes: pf.codes, counts: pf.counts, p }))
}

{
  const pf = judgeNextPreflight('d20', facts({
    supplyDailyUsdCap: null,
    readyCohort: cohort({
      published: 0, lost: 1, scheduled: 0, unknown: 0,
      usdPerSlotValidResult: null, costUnknownReason: zeroResultCost?.unknownReason ?? 'ledger_or_attribution',
    }),
  }), RUNNER_GRID)
  const p = planStageRecovery(pf)
  check('양수 정산 무표본이어도 공급 비용 상한을 모르면 측정하지 않고 막는다',
    pf.codes.includes('SUPPLY_COST_UNKNOWN') && pf.counts.supplyCostUnobserved === 1
    && !('supplyProofBudgetUsd' in pf.counts) && p.lane === 'blocked' && p.action === 'stop',
  JSON.stringify({ codes: pf.codes, counts: pf.counts, p }))
}

{
  const pf = judgeNextPreflight('d20', facts({
    readyCohort: cohort({ sources: 31, published: 0, lost: 1, scheduled: 2, unknown: 2 }),
  }), RUNNER_GRID)
  const p = planStageRecovery(pf)
  check('실제 필요 구간 25..50·용량 16은 READY 결과 부족 9..34다',
    pf.counts.readyNeededMin === 25 && pf.counts.readyNeededMax === 50 && pf.counts.readyCapacity === 16
    && p.deficitUnit === 'ready_result' && p.deficitMin === 9 && p.deficitMax === 34)
}

{
  const pf = judgeNextPreflight('d20', facts({
    readyCohort: cohort({ sources: 20, published: 1, lost: 3, scheduled: 0, unknown: 0 }),
  }), RUNNER_GRID)
  const p = planStageRecovery(pf)
  check('READY 결과 부족은 목표 20보다 클 수 있으며 공개 슬롯으로 오해하지 않는다',
    pf.counts.readyNeededMin === 80 && pf.counts.readyCapacity === 20
    && p.deficitUnit === 'ready_result' && p.deficitMin === 60 && p.deficitMax === 60)
}

{
  const pf = judgeNextPreflight('d20', facts({
    readyCohort: cohort({
      published: 0, lost: 0, scheduled: 0, unknown: 5,
      usdPerSlotValidResult: null, costUnknownReason: zeroResultCost?.unknownReason ?? 'ledger_or_attribution',
    }),
  }), RUNNER_GRID)
  const p = planStageRecovery(pf)
  check('결말 모름과 비용 무표본이 함께면 수량을 발명하지 않는 측정 canary 후보가 된다',
    pf.codes.includes('READY_REQUIREMENT_UNKNOWN') && pf.codes.includes('SUPPLY_COST_UNKNOWN')
    && p.lane === 'supply' && p.action === 'measure_ready_yield'
    && p.deficitMin === null && p.deficitMax === null
    && p.secondaryCodes.includes('READY_REQUIREMENT_UNKNOWN'), JSON.stringify({ codes: pf.codes, counts: pf.counts, p }))
}

{
  const pf = judgeNextPreflight('d20', facts({
    readyCohort: cohort({
      published: 0, lost: 3, scheduled: 0, unknown: 0,
      usdPerSlotValidResult: null, costUnknownReason: 'ledger_or_attribution',
    }),
  }), RUNNER_GRID)
  const p = planStageRecovery(pf)
  check('같은 수율 0이어도 장부·귀속이 모르면 비용 blocker를 유지한다',
    pf.codes.includes('SUPPLY_COST_UNKNOWN') && !('supplyCostUnobserved' in pf.counts)
    && p.lane === 'blocked' && p.action === 'stop')
}

{
  const source = planStageRecovery(judgeNextPreflight('d20', facts({
    slotValidOpportunities: 16,
  }), RUNNER_GRID))
  const sourceUnknown = planStageRecovery(judgeNextPreflight('d20', facts({
    slotValidOpportunities: null,
  }), RUNNER_GRID))
  const supplyUnknown = planStageRecovery(judgeNextPreflight('d20', facts({
    readyCohort: cohort({ sources: 0, published: 0, lost: 0, scheduled: 0, unknown: 0 }),
  }), RUNNER_GRID))
  check('실제 SHORT·UNKNOWN 사실도 각각 source/source/supply lane으로 이어진다',
    source.lane === 'source' && source.deficitMin === 0 && source.deficitMax === 4
    && sourceUnknown.lane === 'source' && supplyUnknown.lane === 'supply')
}

console.log('\n══ purity and controller isolation ══')

{
  const planner = readFileSync('src/lib/stage-recovery.ts', 'utf8')
  const controller = readFileSync('scripts/stage-controller.mts', 'utf8')
  const plannerImports = planner.split('\n').filter((line) => line.startsWith('import '))
  check('순수 planner의 모든 import는 type-only다',
    plannerImports.length > 0 && plannerImports.every((line) => line.startsWith('import type ')), plannerImports.join(' | '))
  check('순수 planner가 DB·파일·env·process·network·동적 import를 사용하지 않는다',
    !/(?:node:|@\/lib\/prisma|@prisma|process\.|fetch\(|require\(|import\()/.test(planner))

  const readFailureCatch = controller.indexOf('failures.push(`재고·preflight 를 읽지 못했다')
  const plannerBlockStart = controller.indexOf('if (nextPreflight !== null) {')
  const plannerCall = controller.indexOf('recoveryShadow = planStageRecovery(nextPreflight)')
  const shadowFailureLog = controller.indexOf('recovery shadow 계산 실패')
  const plannerBlockEnd = controller.indexOf('// ③ 운영 신호', plannerBlockStart)
  check('shadow planner는 preflight 읽기 catch 밖의 별도 try/catch에 있다',
    readFailureCatch >= 0 && readFailureCatch < plannerCall && plannerCall < shadowFailureLog)
  check('shadow 전체 구간은 stage failures에 넣지 않는다',
    plannerBlockStart >= 0 && plannerBlockEnd > plannerBlockStart
    && !controller.slice(plannerBlockStart, plannerBlockEnd).includes('failures.push'))
  const decisionInputs = ['leaseSafeHoldOf', 'bridgeHoldOf', 'decideStage', 'inputFailureHoldOf', 'ensureStageDecision']
    .flatMap((name) => callBodiesOf(controller, name))
  check('shadow는 lease·bridge·정상·입력실패·저장의 모든 단계 authority 호출 입력에서 빠진다',
    callBodiesOf(controller, 'ensureStageDecision').length === 2
    && callBodiesOf(controller, 'leaseSafeHoldOf').length === 1
    && callBodiesOf(controller, 'bridgeHoldOf').length === 1
    && decisionInputs.length >= 6
    && decisionInputs.every((body) => !body.includes('recoveryShadow')))
  const decisionStart = controller.indexOf('// ④ 결정')
  const decisionEnd = controller.indexOf('const v = validateForToday(result.decision)', decisionStart)
  check('shadow는 최종 result.decision 구성 구간에도 들어가지 않는다',
    decisionStart >= 0 && decisionEnd > decisionStart
    && !controller.slice(decisionStart, decisionEnd).includes('recoveryShadow')
    && !/\bresult\.decision\s*=/.test(controller))
  const mutatedController = controller.replace(
    'compute: () => result.decision',
    'compute: () => ({ ...result.decision, recoveryShadow })',
  )
  check('변이 — 주 저장 경로에 shadow를 넣으면 모든 호출 검사에서 검출한다',
    callBodiesOf(mutatedController, 'ensureStageDecision').some((body) => body.includes('recoveryShadow')))
  const mutatedBridge = controller.replace(
    'result = bridgeHoldOf({ kstDate:',
    'result = bridgeHoldOf({ recoveryShadow, kstDate:',
  )
  check('변이 — bridge 단계 authority에 shadow를 넣어도 호출 검사에서 검출한다',
    callBodiesOf(mutatedBridge, 'bridgeHoldOf').some((body) => body.includes('recoveryShadow')))
  check('기계 JSON에는 shadow 결과가 있으나 기존 result를 대신하지 않는다',
    controller.includes('nextPreflight, recoveryShadow, recoveryShadowError, preflightDetail'))
}

console.log(`\n결과: ${pass} PASS · ${fail} FAIL`)
if (fail > 0) process.exit(1)
