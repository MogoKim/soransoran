#!/usr/bin/env tsx
/**
 * D20+ 아침 제한 복구의 순수 계약 검사.
 *
 * StageDecision을 우회하지 않고, 기회·처리량 부족만 하루 한 번 제한 복구하며,
 * 복구 supply run에 귀속된 slot-valid READY가 없거나 품질·비용·오류·시간·범위가 어긋나면 열지 않는지 본다.
 */
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ACTIVE_RECOVERY_DATE_ENV, ACTIVE_RECOVERY_DEADLINE_ENV, ACTIVE_RECOVERY_DEFICIT_ENV,
  ACTIVE_RECOVERY_NONCE_ENV, activeRecoveryDeadlineAt, activeRecoveryDirective, activeRecoveryPhaseOf,
  isFinalRecoveryControllerSlot,
  planActiveRecovery, recoveryJitDemand, retryFinalStageDecisionWrite,
  type ActiveRecoveryArtifact, type ActiveRecoveryDirective, type ActiveRecoveryPlan,
} from '../src/lib/stage-active-recovery'
import { costSignalOf, decideStage, errorSignalOf, type ControllerResult, type HealthSignal } from '../src/lib/stage-controller'
import type { PreflightVerdict } from '../src/lib/stage-ladder-generic'
import { buildSourceEvidence } from '../src/lib/source-slot-release'
import { SUPPLY_JIT_CONTRACT } from '../src/lib/supply-intent'
import {
  DECISION_WRITER, STAGE_DECISION_VERSION, preparedStageOf, previousKstDate, type ValidatedStageDecision,
} from '../src/lib/stage-ladder'
import { validateStoredDecision } from '../src/lib/stage-decision-store'
import { failingFromProcessRuns, recoveryRunClassOf } from '../src/lib/job-health'
import { judgeCost } from '../src/lib/ops-status'
import { tallyOf, type LedgerEntry } from '../src/lib/llm-ledger'
import {
  claimStageRecoveryLaunch, claimStageRecoverySupplyStart, createStageRecoveryIntent,
  failStageRecoveryClaimBestEffort,
  hasStageRecoverySupplyReceipt, parseStageRecoveryIntent,
  readStageRecoveryArtifact, readStageRecoverySupplyStartClaim,
  stageRecoveryDir, stageRecoveryIntentCoversPlan, stageRecoveryIntentMatchesPlan,
  stageRecoveryIntentPath, stageRecoveryLaunchClaimPath, stageRecoverySupplyStartClaimPath,
  updateStageRecoveryIntent, validateStageRecoveryClaim, validateStageRecoveryReceiptIdentityEnv,
  validateStageRecoveryRuntimeEnv,
  writeStageRecoverySupplyReceipt,
} from './lib/stage-recovery-intent.mjs'
import {
  recoveryPreflightInputOf, runStageRecoveryStep, type StageRecoveryFactsMode, type StageRecoveryStepDeps,
} from './lib/stage-controller-recovery-step.mjs'
import { runDetachedProcessGroup } from './lib/detached-process-group.mjs'
import { runCollectorTerminationCleanup } from './lib/micro-seed-navercafe.mjs'
import { stageRecoveryProviderBoundaryReason } from './lib/supply-llm-call.mjs'
import { readProcessRuns, supplyFailing, type JobObservation } from './lib/runner-health.mjs'
import { parseLaunchdRunInfo, failingFromLaunchd } from '../src/lib/job-health'
import { recoveryIdentityOf, slotValidRecoveryReadyStockOf } from './lib/stage-preflight-facts.mjs'
import {
  readStageRecoverySourceHashes, readStageRecoverySourceReceipt,
  stageRecoverySourceReceiptPath, writeStageRecoverySourceReceipt,
} from './lib/stage-recovery-source-receipt.mjs'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  PASS ${label}`) }
  else { fail += 1; console.error(`  FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`) }
}
const atKst = (time: string): Date => new Date(`2026-11-05T${time}:00+09:00`)
const signals: HealthSignal[] = [
  { axis: 'quality', health: 'ok', reasons: [] },
  { axis: 'cost', health: 'ok', reasons: [] },
  { axis: 'errors', health: 'ok', reasons: [] },
]
const preflight = (i: {
  opportunities?: number
  target?: number
  readyStock?: number
  readyCapacityNatural?: number
  readyNeededMax?: number
  codes?: PreflightVerdict['codes']
  verdict?: PreflightVerdict['verdict']
} = {}): PreflightVerdict => ({
  stage: 'd20', verdict: i.verdict ?? 'FAIL',
  codes: i.codes ?? ['OPPORTUNITY_SHORT'], warnings: [],
  counts: {
    target: i.target ?? 20,
    opportunities: i.opportunities ?? 17,
    opportunitiesCurrent: i.opportunities ?? 17,
    readyStock: i.readyStock ?? 5,
    readyCapacityNatural: i.readyCapacityNatural ?? 20,
    readyNeededMax: i.readyNeededMax ?? 20,
  },
})
const plan = (p: PreflightVerdict, now = atKst('07:00'), s = signals): ActiveRecoveryPlan =>
  planActiveRecovery({ target: 'd20', preflight: p, signals: s, failures: [], now })

console.log('\n① 복구 대상 — 기회·처리량 부족만')
const good = plan(preflight())
check('17/20이면 부족 3건·분류 전 상세는 안전 상한 10건·유료 묶음은 별도 수율 계약으로 복구',
  good.kind === 'recover' && good.deficit === 3 && good.baselineReadyStock === 5
  && good.collectMax === 10 && good.worksetLimit > 0,
  JSON.stringify(good))
check('부족 1건도 raw 상세와 최종 기회를 1:1로 보지 않고 안전 상한 10건을 본다',
  (() => { const p = plan(preflight({ opportunities: 19 })); return p.kind === 'recover' && p.collectMax === 10 })())
check('부족 10건은 허용 상한 안', plan(preflight({ opportunities: 10 })).kind === 'recover')
check('부족 11건은 추가 공급을 열지 않는다', plan(preflight({ opportunities: 9 })).kind === 'none')
check('품질 비정상은 기회 부족이어도 열지 않는다',
  plan(preflight(), atKst('07:00'), [{ axis: 'quality', health: 'bad', reasons: ['x'] }, ...signals.slice(1)]).kind === 'none')
check('비용 모름은 기회 부족이어도 열지 않는다',
  plan(preflight(), atKst('07:00'), [signals[0]!, { axis: 'cost', health: 'unknown', reasons: ['x'] }, signals[2]!]).kind === 'none')
check('기회 불확실 17/20 + 처리량 19/20은 실제 부족 최대치 3건으로 한 번 복구', (() => {
  const p = plan(preflight({
    codes: ['OPPORTUNITY_UNKNOWN', 'THROUGHPUT_SHORT'], verdict: 'UNKNOWN',
    opportunities: 17, readyCapacityNatural: 19, readyNeededMax: 20,
  }))
  return p.kind === 'recover' && p.deficit === 3 && p.baselineReadyStock === 5
})())
check('기회 부족과 처리량 부족이 함께 있어도 더 큰 실제 부족량만 복구', (() => {
  const p = plan(preflight({
    codes: ['OPPORTUNITY_SHORT', 'THROUGHPUT_SHORT'], opportunities: 18,
    readyCapacityNatural: 19, readyNeededMax: 20,
  }))
  return p.kind === 'recover' && p.deficit === 2
})())
check('처리량만 1건 부족하면 1건만 복구', (() => {
  const p = plan(preflight({
    codes: ['THROUGHPUT_SHORT'], opportunities: 20,
    readyCapacityNatural: 19, readyNeededMax: 20,
  }))
  return p.kind === 'recover' && p.deficit === 1
})())
check('READY 기준 재고가 없으면 intent 신원·감사 기준선을 만들 수 없어 열지 않는다', (() => {
  const p = preflight()
  const { readyStock: _readyStock, ...counts } = p.counts
  return plan({ ...p, counts }).kind === 'none'
})())
check('러너·품질 같은 다른 결함이 섞이면 열지 않는다',
  plan(preflight({ codes: ['OPPORTUNITY_SHORT', 'RUNNER_BAD'] })).kind === 'none')
check('PASS를 다시 실행하지 않는다', plan(preflight({ verdict: 'PASS', codes: [] })).kind === 'none')
check('D10 이하는 새 복구 경로를 열지 않는다',
  planActiveRecovery({ target: 'd10', preflight: preflight(), signals, failures: [], now: atKst('07:00') }).kind === 'none')

console.log('\n①-1 recovery 지시 — phase 2 × 산출물 6 × 중대 결함 2 전수')
{
  const outsideWindow = plan(preflight(), atKst('07:40'))
  const hardBlock = plan(preflight(), atKst('07:20'), [
    { axis: 'quality', health: 'bad', reasons: ['x'] }, ...signals.slice(1),
  ])
  check('fixture: 07:40 창 밖은 중대 결함 아님 · 품질 bad는 중대 결함',
    outsideWindow.kind === 'none' && !outsideWindow.hardBlock && hardBlock.kind === 'none' && hardBlock.hardBlock)
  const artifacts: Record<string, ActiveRecoveryArtifact> = {
    absent: { kind: 'absent' },
    corrupt: { kind: 'corrupt', reason: 'fixture' },
    requested: { kind: 'valid', state: 'requested' },
    running: { kind: 'valid', state: 'running' },
    done: { kind: 'valid', state: 'done' },
    failed: { kind: 'valid', state: 'failed' },
  }
  const show = (d: ActiveRecoveryDirective): string =>
    d.kind === 'finalize' ? `finalize:${d.closeActive ? 'close' : 'keep'}:${d.recoveryFacts}` : d.kind
  // 기대값은 동결 계약의 상태전이표 그대로다. 행 = 산출물, 칸 = [중대 결함 없음, 중대 결함]
  const intermediateExpect: Record<string, [string, string]> = {
    absent: ['decide-now', 'decide-now'],
    corrupt: ['wait-final', 'wait-final'],
    requested: ['wait-final', 'cancel-and-wait-final'],
    running: ['wait-final', 'cancel-and-wait-final'],
    done: ['wait-final', 'wait-final'],
    failed: ['wait-final', 'wait-final'],
  }
  const finalExpect: Record<string, string> = {
    absent: 'finalize:keep:none',
    corrupt: 'finalize:keep:unknown',
    requested: 'finalize:close:evaluate',
    running: 'finalize:close:evaluate',
    done: 'finalize:keep:evaluate',
    failed: 'finalize:keep:evaluate',
  }
  for (const [name, artifact] of Object.entries(artifacts)) {
    const [noBlock, withBlock] = intermediateExpect[name]!
    const a = show(activeRecoveryDirective({ phase: 'intermediate', artifact, plan: outsideWindow }))
    const b = show(activeRecoveryDirective({ phase: 'intermediate', artifact, plan: hardBlock }))
    check(`중간 · ${name} · 결함 없음 → ${noBlock}`, a === noBlock, a)
    check(`중간 · ${name} · 중대 결함 → ${withBlock}`, b === withBlock, b)
    for (const p of [outsideWindow, hardBlock]) {
      const f = show(activeRecoveryDirective({ phase: 'final', artifact }))
      check(`final · ${name} · ${p === hardBlock ? '중대 결함' : '결함 없음'} → ${finalExpect[name]}`, f === finalExpect[name], f)
    }
  }
  check('중간 · 산출물 없음 · 복구 대상이면 시작한다',
    activeRecoveryDirective({ phase: 'intermediate', artifact: { kind: 'absent' }, plan: good }).kind === 'start-recovery')
  check('중간 · requested · 복구 대상이면 실행권을 잡는다(write 0)',
    activeRecoveryDirective({ phase: 'intermediate', artifact: artifacts.requested!, plan: good }).kind === 'start-recovery')
  check('🔴 중간 · done/failed는 복구 대상이 다시 보여도 즉시 결정하지 않고 final을 기다린다',
    (['done', 'failed', 'running'] as const).every((s) =>
      activeRecoveryDirective({ phase: 'intermediate', artifact: { kind: 'valid', state: s }, plan: good }).kind === 'wait-final'))
  check('🔴 중간 · 손상 산출물은 복구 대상이어도 새 intent를 만들지 않는다',
    activeRecoveryDirective({ phase: 'intermediate', artifact: artifacts.corrupt!, plan: good }).kind === 'wait-final')
  check('phase는 07:55 경계로만 나뉜다',
    activeRecoveryPhaseOf(atKst('07:40')) === 'intermediate' && activeRecoveryPhaseOf(atKst('07:55')) === 'final'
    && activeRecoveryPhaseOf(atKst('07:58')) === 'final')
}

console.log('\n② 시간 — 07:30 이후 유료 시작 0 · 07:55 최종 판정 · 07:58 저장 fallback')
check('06:59에는 열지 않는다', plan(preflight(), atKst('06:59')).kind === 'none')
check('07:29에는 열 수 있다', plan(preflight(), atKst('07:29')).kind === 'recover')
check('07:30에는 새 유료 실행을 열지 않고 non-hard-block plan으로 기존 결정 경로에 맡긴다', (() => {
  const p = plan(preflight(), atKst('07:30'))
  return p.kind === 'none' && !p.hardBlock
})())
check('07:54는 중간 슬롯', !isFinalRecoveryControllerSlot(atKst('07:54')))
check('07:55는 최종 슬롯', isFinalRecoveryControllerSlot(atKst('07:55')))
check('07:58은 결정 부재만 다시 읽는 최종 fallback 슬롯', isFinalRecoveryControllerSlot(atKst('07:58')))
check('절대 마감은 생성+50분과 07:50 중 이른 시각',
  activeRecoveryDeadlineAt('2026-11-05', atKst('07:00').toISOString())?.getTime() === atKst('07:50').getTime()
  && activeRecoveryDeadlineAt('2026-11-05', atKst('07:25').toISOString())?.getTime() === atKst('07:50').getTime())
check('재고를 읽었을 때만 증명 부족분 정확히만 연다', (() => {
  const demand = recoveryJitDemand({ upTo: 8 }, 3, true)
  const covered = { llm: false, fill: false, upTo: 0 }
  const coveredBefore = JSON.stringify(covered)
  const recoveredFromCovered = recoveryJitDemand(covered, 3, true)
  let failedClosed = false
  try { recoveryJitDemand({ upTo: 2 }, 3, false) } catch { failedClosed = true }
  return demand.upTo === 3 && demand.llm && demand.fill
    && recoveredFromCovered.upTo === 3 && recoveredFromCovered.llm && recoveredFromCovered.fill
    && JSON.stringify(covered) === coveredBefore
    && failedClosed
})())
let finalWriteCalls = 0
const finalWrite = await retryFinalStageDecisionWrite(async () => {
  finalWriteCalls += 1
  if (finalWriteCalls < 3) throw new Error('transient')
  return 'stored'
}, async () => {})
check('한 controller의 최종 저장은 같은 계산으로 최대 3회 안에서 일시 장애를 흡수',
  finalWrite === 'stored' && finalWriteCalls === 3)

console.log('\n③ intent — 하루 한 번·엄격한 모양·종료 상태 불변')
const home = mkdtempSync(join(tmpdir(), 'soran-stage-recovery-'))
try {
  if (good.kind !== 'recover') throw new Error('test fixture')
  const first = createStageRecoveryIntent({ kstDate: '2026-11-05', plan: good, now: atKst('07:00'), home })
  const second = createStageRecoveryIntent({ kstDate: '2026-11-05', plan: good, now: atKst('07:01'), home })
  check('같은 날짜 intent는 정확히 하나', first.created && !second.created && first.intent.nonce === second.intent.nonce)
  check('현재 plan과 intent가 기준 READY를 포함한 다섯 축에서 일치',
    stageRecoveryIntentMatchesPlan(first.intent, good) && first.intent.baselineReadyStock === 5)
  check('복구 중 부족분 감소는 같은 intent의 정상 진전으로 읽는다',
    (() => { const p = plan(preflight({ opportunities: 18 })); return p.kind === 'recover' && stageRecoveryIntentCoversPlan(first.intent, p) })())
  check('복구 중 부족분이 최초보다 늘면 같은 intent로 덮지 않는다',
    (() => { const p = plan(preflight({ opportunities: 16 })); return p.kind === 'recover' && !stageRecoveryIntentCoversPlan(first.intent, p) })())
  const launch = claimStageRecoveryLaunch({ intent: first.intent, now: atKst('07:02'), message: 'test', home })
  const duplicateLaunch = claimStageRecoveryLaunch({ intent: first.intent, now: atKst('07:02'), message: 'test', home })
  check('겹친 controller 중 하나만 worker 실행권을 얻는다', launch.claimed && !duplicateLaunch.claimed)
  const running = launch.intent
  const claim = { kstDate: running.kstDate, nonce: running.nonce, deficit: running.deficit }
  check('running intent와 일치하는 claim만 소비', validateStageRecoveryClaim(claim, home).nonce === running.nonce)
  const runtimeEnv = {
    [ACTIVE_RECOVERY_DATE_ENV]: running.kstDate,
    [ACTIVE_RECOVERY_NONCE_ENV]: running.nonce,
    [ACTIVE_RECOVERY_DEFICIT_ENV]: String(running.deficit),
    [ACTIVE_RECOVERY_DEADLINE_ENV]: atKst('07:50').toISOString(),
  }
  check('provider 경계는 running nonce와 절대 마감을 매 요청 대조',
    validateStageRecoveryRuntimeEnv(runtimeEnv, atKst('07:10'), home)?.nonce === running.nonce)
  const validToken = {
    ok: true as const, tokenId: 'recovery-test', trigger: 'recovery' as const,
    launchTrigger: 'recovery' as const, absorbedTrigger: null, absorbedAt: null,
    pass: 0, budgetWindowShadow: '2026-11-05 06:15', runId: 'test',
    issuedAt: atKst('07:00').toISOString(), expiresAt: atKst('07:45').toISOString(),
    lock: { dev: 1, ino: 1 },
  }
  check('provider 직전 경계는 정상 recovery 첫 회차만 허용',
    stageRecoveryProviderBoundaryReason({ env: runtimeEnv, at: atKst('07:10'), token: validToken, home }) === null)
  check('provider 직전 경계는 follow-up·흡수 회차와 07:30 이후를 차단',
    stageRecoveryProviderBoundaryReason({
      env: runtimeEnv, at: atKst('07:10'), token: { ...validToken, pass: 1 }, home,
    }) !== null
    && stageRecoveryProviderBoundaryReason({
      env: runtimeEnv, at: atKst('07:10'),
      token: { ...validToken, absorbedTrigger: 'scheduled' as const, absorbedAt: atKst('07:05').toISOString() }, home,
    }) !== null
    && stageRecoveryProviderBoundaryReason({ env: runtimeEnv, at: atKst('07:30'), token: validToken, home }) !== null)
  let lateRuntime = false
  try { validateStageRecoveryRuntimeEnv(runtimeEnv, atKst('07:50'), home) } catch { lateRuntime = true }
  check('절대 마감부터 provider 요청은 fail-closed', lateRuntime)
  check('공급 시작 전에는 시작 claim이 없다', readStageRecoverySupplyStartClaim(running, home).kind === 'absent')
  let badRunId = false
  try { claimStageRecoverySupplyStart({ claim, supplyRunId: 'recovery-run', now: atKst('07:03'), home }) } catch { badRunId = true }
  check('시작 claim은 공급 회차 id 모양이 아니면 쓰지 않는다', badRunId
    && readStageRecoverySupplyStartClaim(running, home).kind === 'absent')
  claimStageRecoverySupplyStart({ claim, supplyRunId: '20261104-220300', now: atKst('07:03'), home })
  let duplicateSupply = false
  try { claimStageRecoverySupplyStart({ claim, supplyRunId: '20261104-220400', now: atKst('07:04'), home }) } catch { duplicateSupply = true }
  check('같은 nonce 공급 본체는 한 번만 시작', duplicateSupply)
  check('🔴 시작 claim은 provider 전에 회차 id를 남기고, 두 번째 시작이 그 id를 바꾸지 않는다', (() => {
    const read = readStageRecoverySupplyStartClaim(running, home)
    return read.kind === 'valid' && read.claim.supplyRunId === '20261104-220300'
  })())
  check('다른 nonce의 시작 claim은 오늘 intent의 비용 신원이 아니다',
    readStageRecoverySupplyStartClaim({ ...running, nonce: 'other' }, home).kind === 'corrupt')
  {
    const path = stageRecoverySupplyStartClaimPath(running.kstDate, home)
    const original = readFileSync(path, 'utf-8')
    const legacy = JSON.parse(original) as Record<string, unknown>
    delete legacy.supplyRunId
    writeFileSync(path, JSON.stringify(legacy))
    check('🔴 회차 id 없는 옛 형식 시작 claim은 손상이다(비용 신원 모름)',
      readStageRecoverySupplyStartClaim(running, home).kind === 'corrupt')
    writeFileSync(path, '{not json')
    check('JSON이 깨진 시작 claim도 손상이다', readStageRecoverySupplyStartClaim(running, home).kind === 'corrupt')
    writeFileSync(path, original)
  }
  let reversed = false
  try { updateStageRecoveryIntent({ intent: running, state: 'requested', now: atKst('07:03'), home }) } catch { reversed = true }
  check('running에서 requested로 되돌릴 수 없다', reversed)
  check('공급 전에는 완주 영수증이 없다', !hasStageRecoverySupplyReceipt(claim, home))
  writeStageRecoverySupplyReceipt({ claim, supplyRunId: 'recovery-run', now: atKst('07:10'), home })
  writeStageRecoverySupplyReceipt({ claim, supplyRunId: 'recovery-run', now: atKst('07:11'), home })
  check('같은 claim 영수증은 멱등이고 다른 성공을 지어내지 않는다', hasStageRecoverySupplyReceipt(claim, home))
  const done = updateStageRecoveryIntent({ intent: running, state: 'done', now: atKst('07:12'), home })
  check('상세 조회 뒤 intent가 종료돼도 receipt 신원은 검증해 원천 hash를 먼저 남길 수 있다',
    validateStageRecoveryReceiptIdentityEnv(runtimeEnv, home)?.nonce === running.nonce)
  let canceledRuntime = false
  try { validateStageRecoveryRuntimeEnv(runtimeEnv, atKst('07:13'), home) } catch { canceledRuntime = true }
  check('controller가 done·failed로 닫은 intent는 다음 provider 요청을 막는다', canceledRuntime)
  let reopened = false
  try { updateStageRecoveryIntent({ intent: done, state: 'running', now: atKst('07:13'), home }) } catch { reopened = true }
  check('done intent는 다시 running으로 열리지 않는다', reopened)

  const updateLockPath = join(stageRecoveryDir(home), '2026-11-05.update.lock')
  const updateLockFd = openSync(updateLockPath, 'wx', 0o600)
  let concurrentUpdateBlocked = false
  try {
    updateStageRecoveryIntent({ intent: done, state: 'done', now: atKst('07:14'), home })
  } catch { concurrentUpdateBlocked = true }
  closeSync(updateLockFd)
  unlinkSync(updateLockPath)
  check('intent read-transition-rename은 날짜별 update lock 경합에서 fail-closed', concurrentUpdateBlocked)
  check('lock 해제 뒤 같은 상태 멱등 갱신은 정상',
    updateStageRecoveryIntent({ intent: done, state: 'done', now: atKst('07:15'), home }).state === 'done')

  const earlyPlan = plan(preflight(), atKst('07:00'))
  if (earlyPlan.kind !== 'recover') throw new Error('early failure fixture')
  const early = createStageRecoveryIntent({
    kstDate: '2026-11-06', plan: earlyPlan, now: new Date('2026-11-06T07:00:00+09:00'), home,
  }).intent
  const earlyRunning = claimStageRecoveryLaunch({
    intent: early, now: new Date('2026-11-06T07:01:00+09:00'), message: 'early test', home,
  }).intent
  const earlyClaim = {
    kstDate: earlyRunning.kstDate, nonce: earlyRunning.nonce, deficit: earlyRunning.deficit,
  }
  check('worker 본 실행 전 실패도 claim 소유권이 같은 running intent를 failed로 닫는다',
    failStageRecoveryClaimBestEffort({
      claim: earlyClaim, now: new Date('2026-11-06T07:02:00+09:00'), message: 'log open failed', home,
    })
    && (() => { const r = readStageRecoveryArtifact('2026-11-06', home); return r.kind === 'valid' && r.intent.state === 'failed' })())
  check('위조 claim은 다른 intent 상태를 바꾸지 않는다',
    !failStageRecoveryClaimBestEffort({
      claim: { ...earlyClaim, nonce: 'forged' }, now: new Date('2026-11-06T07:03:00+09:00'),
      message: 'forged', home,
    })
    && (() => { const r = readStageRecoveryArtifact('2026-11-06', home); return r.kind === 'valid' && r.intent.message === 'log open failed' })())

  const raw = JSON.parse(readFileSync(stageRecoveryIntentPath('2026-11-05', home), 'utf-8')) as Record<string, unknown>
  raw.deficit = 999
  check('손상·과대 intent는 엄격 파서가 거절', parseStageRecoveryIntent(JSON.stringify(raw)) === null)
  raw.deficit = done.deficit
  raw.baselineReadyStock = -1
  check('음수 READY 기준 재고는 엄격 파서가 거절', parseStageRecoveryIntent(JSON.stringify(raw)) === null)
  raw.baselineReadyStock = done.baselineReadyStock
  raw.target = 'd100'
  check('runtime에 배선되지 않은 d100 intent는 파서에서 거절', parseStageRecoveryIntent(JSON.stringify(raw)) === null)
  raw.target = 'd10'
  check('복구 대상이 아닌 d10 intent도 파서에서 거절', parseStageRecoveryIntent(JSON.stringify(raw)) === null)
  raw.target = done.target
  check('저장된 정상 intent는 읽힌다',
    (() => { const r = readStageRecoveryArtifact('2026-11-05', home); return r.kind === 'valid' && r.intent.state === 'done' })())
  {
    const intentPath = stageRecoveryIntentPath('2026-11-05', home)
    const original = readFileSync(intentPath, 'utf-8')
    writeFileSync(intentPath, '{broken')
    const broken = readStageRecoveryArtifact('2026-11-05', home)
    check('🔴 파싱이 깨진 intent는 없음이 아니라 손상이다', broken.kind === 'corrupt')
    let createRefused = false
    try { createStageRecoveryIntent({ kstDate: '2026-11-05', plan: good, now: atKst('07:20'), home }) } catch { createRefused = true }
    check('🔴 손상 intent 위에 새 intent를 만들지 않는다(wx · 손상 판독)', createRefused)
    let launchRefused = false
    try { claimStageRecoveryLaunch({ intent: done, now: atKst('07:20'), message: 'x', home }) } catch { launchRefused = true }
    check('🔴 실행권이 있는데 intent를 확인하지 못하면 메모리의 옛 intent로 대신하지 않는다', launchRefused)
    writeFileSync(intentPath, original)
  }
  {
    const orphanHome = mkdtempSync(join(tmpdir(), 'soran-stage-recovery-orphan-artifact-'))
    try {
      check('산출물이 하나도 없으면 없음', readStageRecoveryArtifact('2026-11-05', orphanHome).kind === 'absent')
      mkdirSync(stageRecoveryDir(orphanHome), { recursive: true })
      writeFileSync(stageRecoveryLaunchClaimPath('2026-11-05', orphanHome), '{}')
      const orphan = readStageRecoveryArtifact('2026-11-05', orphanHome)
      check('🔴 intent 없이 실행권 claim만 남으면 손상', orphan.kind === 'corrupt', JSON.stringify(orphan))
      check('다른 날짜의 claim은 오늘 판독을 손상시키지 않는다', readStageRecoveryArtifact('2026-11-04', orphanHome).kind === 'absent')
      unlinkSync(stageRecoveryLaunchClaimPath('2026-11-05', orphanHome))
      writeFileSync(join(stageRecoveryDir(orphanHome), `2026-11-05.${'0'.repeat(16)}.sources.json`), '{}')
      check('🔴 intent 없이 원천 영수증만 남아도 손상', readStageRecoveryArtifact('2026-11-05', orphanHome).kind === 'corrupt')
    } finally {
      rmSync(orphanHome, { recursive: true, force: true })
    }
  }

  const sourceHash = 'a'.repeat(64)
  writeStageRecoverySourceReceipt({
    kstDate: '2026-11-05', nonce: done.nonce, runId: 'collector-test',
    sourceHashes: [sourceHash, sourceHash], now: atKst('07:10'), home,
  })
  check('복구 원천 영수증은 raw ID 없이 정렬·중복 제거된 hash만 읽는다',
    readStageRecoverySourceHashes('2026-11-05', home)?.size === 1
    && !readFileSync(stageRecoverySourceReceiptPath('2026-11-05', done.nonce, home), 'utf-8').includes('sourceArticleId'))
  check('최종 판정은 날짜 전체가 아니라 현재 nonce의 원천 영수증만 읽는다',
    readStageRecoverySourceReceipt('2026-11-05', done.nonce, home)?.sourceHashes[0] === sourceHash
    && readStageRecoverySourceReceipt('2026-11-05', 'other-nonce', home) === null)
  check('복구 원천 영수증은 완성된 임시 파일을 원자적으로 공개하고 임시 파일을 남기지 않는다',
    !readdirSync(stageRecoveryDir(home)).some((name) => name.endsWith('.tmp')))
  const receiptPath = stageRecoverySourceReceiptPath('2026-11-05', done.nonce, home)
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf-8')) as Record<string, unknown>
  receipt.digest = '0'.repeat(64)
  writeFileSync(receiptPath, JSON.stringify(receipt))
  check('복구 원천 영수증 손상은 빈 집합으로 삼지 않고 UNKNOWN',
    readStageRecoverySourceHashes('2026-11-05', home) === null)
} finally {
  rmSync(home, { recursive: true, force: true })
}

console.log('\n③-1 READY lineage — 자연 공급과 복구 공급을 섞지 않는다')
{
  const intentAt = atKst('07:00')
  const recoveryHash = 'a'.repeat(64)
  const naturalHash = 'b'.repeat(64)
  const evidence = (hash: string, runId = 'recovery-run'): Record<string, unknown> => ({
    sourceEvidence: {
      ...buildSourceEvidence({ sourceSite: 'navercafe:fixture', sourceArticleId: 'fixture' }),
      provenance: {
        ...buildSourceEvidence({ sourceSite: 'navercafe:fixture', sourceArticleId: 'fixture' }).provenance,
        articleIdHash: hash,
      },
    },
    supplyIntent: {
      contract: SUPPLY_JIT_CONTRACT,
      runId,
      sourceHash: hash,
      intendedSlotAt: atKst('08:00').toISOString(),
      ageAtSlotH: 1,
      qualityContract: { version: 'fixture-v1', digest: 'c'.repeat(64) },
    },
  })
  const rows = [
    { id: 'recovery', createdAt: atKst('07:10'), gateResults: evidence(recoveryHash) },
    { id: 'recovery-duplicate', createdAt: atKst('07:11'), gateResults: evidence(recoveryHash) },
    { id: 'natural', createdAt: atKst('07:12'), gateResults: evidence(naturalHash) },
    { id: 'wrong-run', createdAt: atKst('07:12'), gateResults: evidence(recoveryHash, 'natural-run') },
    { id: 'before-intent', createdAt: atKst('06:59'), gateResults: evidence(recoveryHash) },
    { id: 'not-slot-matched', createdAt: atKst('07:13'), gateResults: evidence(recoveryHash) },
  ]
  const matchedReady = new Set(['recovery', 'recovery-duplicate', 'natural', 'wrong-run', 'before-intent'])
  const count = slotValidRecoveryReadyStockOf({
    rows, matchedReady, sourceHashes: new Set([recoveryHash]), supplyRunId: 'recovery-run', createdAt: intentAt,
  })
  check('exact source·supply run·intent 이후·slot matching을 모두 만족한 고유 원천만 1건으로 센다', count === 1, String(count))
  check('같은 시간 자연 READY나 다른 supply run이 늘어도 복구 성과로 가산하지 않는다',
    slotValidRecoveryReadyStockOf({
      rows: [rows[2]!, rows[3]!], matchedReady: new Set(['natural', 'wrong-run']),
      sourceHashes: new Set([recoveryHash]), supplyRunId: 'recovery-run', createdAt: intentAt,
    }) === 0)
}

console.log('\n④ collector 종료 — 외부 종료도 전역 lock을 먼저 놓는다')
{
  const events: string[] = []
  runCollectorTerminationCleanup({
    signal: 'SIGTERM',
    finish: () => { events.push('finish') },
    release: () => { events.push('release') },
    exit: (code) => { events.push(`exit:${code}`) },
  })
  check('SIGTERM은 종료 증거 → lock 해제 → 143 순서로 닫는다',
    events.join(',') === 'finish,release,exit:143', events.join(','))

  const failedEvents: string[] = []
  let finishThrew = false
  try {
    runCollectorTerminationCleanup({
      signal: 'SIGINT',
      finish: () => { failedEvents.push('finish'); throw new Error('record write failed') },
      release: () => { failedEvents.push('release') },
      exit: (code) => { failedEvents.push(`exit:${code}`) },
    })
  } catch { finishThrew = true }
  check('종료 증거 write가 실패해도 lock 해제와 SIGINT 130을 건너뛰지 않는다',
    finishThrew && failedEvents.join(',') === 'finish,release,exit:130', failedEvents.join(','))
}

console.log('\n⑤ 소스 배선 — 실행 경계와 자연 증거 분리')
{
  const worker = readFileSync(join(process.cwd(), 'scripts/stage-active-recovery.mts'), 'utf-8')
  const collector = readFileSync(join(process.cwd(), 'scripts/micro-seed-collect-navercafe.mts'), 'utf-8')
  const controller = readFileSync(join(process.cwd(), 'scripts/stage-controller.mts'), 'utf-8')
  const facts = readFileSync(join(process.cwd(), 'scripts/lib/stage-preflight-facts.mts'), 'utf-8')
  check('collector 내부 timeout 후 3분에만 외부 process-group 종료를 시작한다',
    /RUN_TIMEOUT_MS \+ 3 \* 60_000/.test(worker))
  check('recovery 자식은 launchd 자연 회차 라벨을 상속하지 않는다',
    /delete env\.XPC_SERVICE_NAME/.test(worker))
  check('collector는 SIGTERM과 SIGINT 둘 다 소유 lock 해제 경로에 연결한다',
    /process\.once\('SIGTERM'/.test(collector) && /process\.once\('SIGINT'/.test(collector)
      && /runCollectorTerminationCleanup/.test(collector))
  check('collector는 이미 본 복구 원천 hash 영수증을 thin 저장보다 먼저 남긴다', (() => {
    const receiptAt = collector.indexOf('const recoveryIntent = validateStageRecoveryReceiptIdentityEnv')
    const thinWriteAt = collector.indexOf('writeJsonl(thinPath, thinRows)', receiptAt)
    return receiptAt >= 0 && thinWriteAt > receiptAt
      && !collector.includes('validateStageRecoveryRuntimeEnv(process.env')
  })())
  const step = readFileSync(join(process.cwd(), 'scripts/lib/stage-controller-recovery-step.mts'), 'utf-8')
  const activeRecovery = readFileSync(join(process.cwd(), 'src/lib/stage-active-recovery.ts'), 'utf-8')
  // 아래는 배선·옛 심볼 제거만 본다. 쓰기 0·lineage·비용·건강 판정은 ⑦~⑨ 행동 시험이 증명한다.
  check('옛 판정(종료 intent 즉시 결정)·옛 판독 심볼이 코드에 남지 않는다',
    !/activeRecoveryDecisionDisposition|ActiveRecoveryDecisionDisposition/.test(activeRecovery + controller + step)
    && !/readStageRecoveryIntent\b/.test(controller + step)
    && !/recoveryLineage/.test(controller + facts))
  check('🔴 운영 controller에 시각을 바꾸는 플래그가 없다(다른 날짜 결정을 쓰는 수동 통로 금지)',
    !/--now|NOW_OVERRIDE|process\.env\.[A-Z_]*NOW/.test(controller) && /const NOW = new Date\(\)/.test(controller))
  check('controller는 recovery 단계를 주입 실행부 하나로만 돌린다',
    (controller.match(/runStageRecoveryStep\(/g) ?? []).length === 1
    && !/ensureStageDecision\(\{/.test(controller.slice(controller.indexOf('async function main(')))
    && /compute: \(mode\) => computeToday\(prisma, mode, flagOn\)/.test(controller))
  check('recovery-tagged workset은 다음 시험의 자연 수율 분자·분모에서 뺀다',
    /isSupplyCostRecoveryTagged\(run\.runTokenShadow\)/.test(facts))
}

console.log('\n⑥ process group — timeout 후 SIGTERM을 무시한 후손도 남기지 않는다')
const processHome = mkdtempSync(join(tmpdir(), 'soran-stage-recovery-process-'))
const processLog = join(processHome, 'child.log')
const logFd = openSync(processLog, 'a')
let groupPid: number | null = null
const childCode = [
  "const { spawn } = require('node:child_process')",
  "const gc = spawn(process.execPath, ['-e', \"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\"], { stdio: 'ignore' })",
  "process.stdout.write(String(gc.pid) + '\\n')",
  "process.on('SIGTERM', () => process.exit(0))",
  "setInterval(()=>{},1000)",
].join(';')
try {
  const started = Date.now()
  const code = await runDetachedProcessGroup({
    command: process.execPath, args: ['-e', childCode], cwd: process.cwd(), env: process.env,
    logFd, timeoutMs: 100, killGraceMs: 150, onSpawn: (pid) => { groupPid = pid },
  })
  const elapsed = Date.now() - started
  let groupAlive = false
  if (groupPid !== null) {
    try { process.kill(-groupPid, 0); groupAlive = true } catch { groupAlive = false }
  }
  check('timeout은 실패 1로 닫고 강제 종료 유예 뒤 process group이 남지 않는다',
    code === 1 && elapsed >= 200 && elapsed < 3_000 && groupPid !== null && !groupAlive,
    JSON.stringify({ code, elapsed, groupPid, log: readFileSync(processLog, 'utf-8').trim() }))
} finally {
  closeSync(logFd)
  rmSync(processHome, { recursive: true, force: true })
}

console.log('\n⑥-1 process group — 외부 종료와 leader 선종료도 후손을 남기지 않는다')
{
  const home = mkdtempSync(join(tmpdir(), 'soran-stage-recovery-abort-'))
  const fd = openSync(join(home, 'abort.log'), 'a')
  const controller = new AbortController()
  let pid: number | null = null
  try {
    const running = runDetachedProcessGroup({
      command: process.execPath,
      args: ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
      cwd: process.cwd(), env: process.env, logFd: fd, timeoutMs: 10_000, killGraceMs: 100,
      signal: controller.signal, onSpawn: (spawned) => { pid = spawned },
    })
    const spawnedBy = Date.now() + 2_000
    while (pid === null && Date.now() < spawnedBy) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    controller.abort()
    const code = await running
    let alive = false
    if (pid !== null) { try { process.kill(-pid, 0); alive = true } catch { alive = false } }
    check('worker SIGTERM/SIGINT abort는 실행 중 process group 전체를 실패 1로 닫는다',
      code === 1 && pid !== null && !alive)
  } finally {
    closeSync(fd)
    rmSync(home, { recursive: true, force: true })
  }
}

{
  const home = mkdtempSync(join(tmpdir(), 'soran-stage-recovery-orphan-'))
  const fd = openSync(join(home, 'orphan.log'), 'a')
  let pid: number | null = null
  const leaderExitsFirst = [
    "const { spawn } = require('node:child_process')",
    "spawn(process.execPath, ['-e', \"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\"], { stdio: 'ignore' })",
    'setTimeout(() => process.exit(0), 20)',
  ].join(';')
  try {
    const code = await runDetachedProcessGroup({
      command: process.execPath, args: ['-e', leaderExitsFirst], cwd: process.cwd(), env: process.env,
      logFd: fd, timeoutMs: 10_000, killGraceMs: 100, onSpawn: (spawned) => { pid = spawned },
    })
    let alive = false
    if (pid !== null) { try { process.kill(-pid, 0); alive = true } catch { alive = false } }
    check('leader가 정상 0으로 먼저 끝나도 같은 group 후손을 정리한 뒤 0을 반환한다',
      code === 0 && pid !== null && !alive)
  } finally {
    closeSync(fd)
    rmSync(home, { recursive: true, force: true })
  }
}

// ─────────────────────────────────────────────────────────
// ⑦~⑨ 행동 시험 — 실제 실행부·검증기·사다리를 고정 시계·임시 home·결정 IO spy로 돌린다
// ─────────────────────────────────────────────────────────
const DAY = '2026-11-05'
const PREV_DAY = previousKstDate(DAY)!
const prevD10 = ((): ValidatedStageDecision => {
  const v = validateStoredDecision({
    row: {
      kstDate: PREV_DAY, capacity: preparedStageOf('d10'), release: 'd10', state: 'HOLD',
      reasons: [], blocks: [], dayPinned: false, supply: null,
      decidedAt: `${PREV_DAY}T01:00:00.000Z`, contractVersion: STAGE_DECISION_VERSION,
      decidedBy: DECISION_WRITER, transition: null,
    },
    expectKstDate: PREV_DAY,
  })
  if (!v.ok) throw new Error(`fixture 전날 결정이 계약을 지키지 않는다: ${v.reason}`)
  return v.decision
})()
const decisionWith = (s: readonly HealthSignal[], at = '07:55'): ControllerResult => decideStage({
  kstDate: DAY, decidedAt: atKst(at).toISOString(), previousDecision: prevD10, previousEvidence: null,
  carriedPlan: null, nextPreflight: null, publishedToday: 0, signals: s,
})
const okResult = decisionWith(signals)
const memoryIo = (): { io: StageRecoveryStepDeps['io']; inserts: () => number } => {
  let row: unknown = null
  let inserts = 0
  return {
    io: {
      read: async () => row,
      insert: async (d) => {
        if (row !== null) return 'conflict'
        row = d
        inserts += 1
        return 'inserted'
      },
      validate: (r) => validateStoredDecision({ row: r, expectKstDate: DAY }),
    },
    inserts: () => inserts,
  }
}
type Slot = { time: string; plan: ActiveRecoveryPlan; writeMode?: StageRecoveryStepDeps['writeMode'] }
const timeline = (home: string, io?: StageRecoveryStepDeps['io']) => {
  const memory = io === undefined ? memoryIo() : { io, inserts: () => Number.NaN }
  const modes: StageRecoveryFactsMode[] = []
  const launches: string[] = []
  const run = (s: Slot) => runStageRecoveryStep({
    phase: activeRecoveryPhaseOf(atKst(s.time)), kstDate: DAY, clock: () => atKst(s.time), home,
    writeMode: s.writeMode ?? 'apply', io: memory.io,
    compute: async (mode) => {
      modes.push(mode)
      return { kind: 'computed', result: okResult, plan: s.plan, valid: { ok: true } }
    },
    launch: async (intent) => { launches.push(intent.nonce); return true },
    log: () => {}, error: () => {}, wait: async () => {},
  })
  return { run, memory, modes, launches }
}
const intentOn = (home: string): ReturnType<typeof readStageRecoveryArtifact> => readStageRecoveryArtifact(DAY, home)
/** worker가 공급 본체를 시작해 끝낸 것처럼 실제 claim·전이 함수로만 상태를 옮긴다 */
const workerFinishes = (home: string, at: string, runId = '20261104-220500'): void => {
  const read = intentOn(home)
  if (read.kind !== 'valid') throw new Error('fixture: intent 없음')
  const claim = { kstDate: read.intent.kstDate, nonce: read.intent.nonce, deficit: read.intent.deficit }
  claimStageRecoverySupplyStart({ claim, supplyRunId: runId, now: atKst(at), home })
  updateStageRecoveryIntent({ intent: read.intent, state: 'done', now: atKst(at), home })
}
const recoverAt = (t: string): ActiveRecoveryPlan => plan(preflight(), atKst(t))
const withHome = async (name: string, body: (home: string) => Promise<void>): Promise<void> => {
  const home = mkdtempSync(join(tmpdir(), `soran-stage-recovery-${name}-`))
  try { await body(home) } finally { rmSync(home, { recursive: true, force: true }) }
}

console.log('\n⑦ 시간순 행동 — 07:00→07:20→07:40→07:55(→07:58) StageDecision write 정확히 1회')
await withHome('done-early', async (home) => {
  const t = timeline(home)
  const o0700 = await t.run({ time: '07:00', plan: recoverAt('07:00') })
  check('07:00 복구 시작 · worker 1회 · write 0',
    o0700.action === 'start-recovery' && t.launches.length === 1 && t.memory.inserts() === 0, JSON.stringify(o0700))
  workerFinishes(home, '07:15')
  const o0720 = await t.run({ time: '07:20', plan: recoverAt('07:20') })
  const o0740 = await t.run({ time: '07:40', plan: recoverAt('07:40') })
  check('🔴 worker가 07:20 전에 done이어도 07:20·07:40은 write 0 (F1)',
    o0720.action === 'wait-final' && o0740.action === 'wait-final' && t.memory.inserts() === 0,
    JSON.stringify([o0720, o0740]))
  check('중간 슬롯은 lineage·비용 없이(final=false) 계산한다',
    t.modes.slice(0, 3).every((m) => m.kind === 'none' || (m.kind === 'evaluate' && !m.final)))
  const o0755 = await t.run({ time: '07:55', plan: recoverAt('07:55') })
  const finalMode = t.modes.at(-1)
  check('🔴 07:55가 done intent를 exact 평가(final=true)로 한 번 저장',
    o0755.action === 'decided' && o0755.created && t.memory.inserts() === 1
    && finalMode?.kind === 'evaluate' && finalMode.final && finalMode.intent.state === 'done', JSON.stringify(o0755))
  const modesBefore = t.modes.length
  const o0758 = await t.run({ time: '07:58', plan: recoverAt('07:58') })
  check('07:58은 기존 결정을 읽기만 한다(계산 0 · write 0)',
    o0758.action === 'read-existing' && t.memory.inserts() === 1 && t.modes.length === modesBefore)
  check('worker는 하루 1회만 시작됐다', t.launches.length === 1)
})
await withHome('done-late', async (home) => {
  const t = timeline(home)
  await t.run({ time: '07:00', plan: recoverAt('07:00') })
  const o0720 = await t.run({ time: '07:20', plan: recoverAt('07:20') })
  const o0740 = await t.run({ time: '07:40', plan: recoverAt('07:40') })
  workerFinishes(home, '07:45')
  const o0755 = await t.run({ time: '07:55', plan: recoverAt('07:55') })
  const finalMode = t.modes.at(-1)
  check('done 07:45 — running 동안 write 0, 07:55에 done 평가로 1회 저장',
    o0720.action === 'wait-final' && o0740.action === 'wait-final' && o0755.created
    && t.memory.inserts() === 1 && finalMode?.kind === 'evaluate' && finalMode.intent.state === 'done',
    JSON.stringify([o0720, o0740, o0755]))
})
await withHome('running-at-final', async (home) => {
  const t = timeline(home)
  await t.run({ time: '07:00', plan: recoverAt('07:00') })
  const o0755 = await t.run({ time: '07:55', plan: recoverAt('07:55') })
  const after = intentOn(home)
  const finalMode = t.modes.at(-1)
  check('07:55에 running이면 failed로 닫고 그 상태로 평가해 저장(가산 0 경로)',
    o0755.created && after.kind === 'valid' && after.intent.state === 'failed'
    && finalMode?.kind === 'evaluate' && finalMode.intent.state === 'failed')
})
await withHome('hard-block', async (home) => {
  const t = timeline(home)
  await t.run({ time: '07:00', plan: recoverAt('07:00') })
  const block = plan(preflight(), atKst('07:20'), [{ axis: 'quality', health: 'bad', reasons: ['x'] }, ...signals.slice(1)])
  const o0720 = await t.run({ time: '07:20', plan: block })
  const after = intentOn(home)
  check('🔴 복구 중 중대 결함 — intent failed로 닫고 write 0 (final까지 기다린다)',
    o0720.action === 'cancel-and-wait-final' && t.memory.inserts() === 0
    && after.kind === 'valid' && after.intent.state === 'failed')
  const o0740 = await t.run({ time: '07:40', plan: block })
  const o0755 = await t.run({ time: '07:55', plan: block })
  check('중대 결함 뒤 07:40 write 0 · 07:55 한 번 저장',
    o0740.action === 'wait-final' && o0755.created && t.memory.inserts() === 1)
})
await withHome('corrupt', async (home) => {
  const t = timeline(home)
  mkdirSync(stageRecoveryDir(home), { recursive: true })
  writeFileSync(stageRecoveryIntentPath(DAY, home), '{broken')
  const o0700 = await t.run({ time: '07:00', plan: recoverAt('07:00') })
  const o0740 = await t.run({ time: '07:40', plan: recoverAt('07:40') })
  check('🔴 손상 intent — 중간 write 0 · 새 intent·worker 0',
    o0700.action === 'wait-final' && o0740.action === 'wait-final'
    && t.memory.inserts() === 0 && t.launches.length === 0
    && readFileSync(stageRecoveryIntentPath(DAY, home), 'utf-8') === '{broken')
  const o0755 = await t.run({ time: '07:55', plan: recoverAt('07:55') })
  check('🔴 손상 intent — final은 비용 신원 모름(unknown)으로 한 번 결정',
    o0755.created && t.memory.inserts() === 1 && t.modes.at(-1)?.kind === 'unknown')
})
await withHome('no-recovery', async (home) => {
  const t = timeline(home)
  const pass0700 = plan(preflight({ verdict: 'PASS', codes: [] }), atKst('07:00'))
  const o0700 = await t.run({ time: '07:00', plan: pass0700 })
  check('산출물 없음 · 복구 대상 아님 — 07:00 즉시 결정(07:55까지 미루지 않는다)',
    o0700.action === 'decided' && o0700.directive === 'decide-now' && t.memory.inserts() === 1
    && intentOn(home).kind === 'absent')
  const o0720 = await t.run({ time: '07:20', plan: pass0700 })
  check('그 뒤 슬롯은 읽기만', o0720.action === 'read-existing' && t.memory.inserts() === 1)
})
await withHome('dry-run', async (home) => {
  const t = timeline(home)
  const o = await t.run({ time: '07:00', plan: recoverAt('07:00'), writeMode: 'dry-run' })
  check('dry-run은 복구 지시를 보여 주기만 한다 — intent·worker·write 0',
    o.action === 'dry-run' && o.directive === 'start-recovery' && intentOn(home).kind === 'absent'
    && t.launches.length === 0 && t.memory.inserts() === 0)
  const off = await t.run({ time: '07:55', plan: recoverAt('07:55'), writeMode: 'flag-off' })
  check('controller flag off는 final에서도 write 0 · recovery 변경 0',
    off.action === 'flag-off' && t.memory.inserts() === 0 && intentOn(home).kind === 'absent')
})
await withHome('race', async (home) => {
  const t = timeline(home)
  await t.run({ time: '07:00', plan: recoverAt('07:00') })
  workerFinishes(home, '07:10')
  const [a, b] = await Promise.all([
    t.run({ time: '07:55', plan: recoverAt('07:55') }),
    t.run({ time: '07:58', plan: recoverAt('07:58') }),
  ])
  check('🔴 07:55·07:58이 겹쳐도 create-only — 행 1개 · 둘 다 정상 종료',
    t.memory.inserts() === 1 && a.exitCode === 0 && b.exitCode === 0
    && [a, b].filter((o) => o.created).length === 1, JSON.stringify([a, b]))
})

console.log('\n⑧ 건강 분리 — 자연 공급 실패는 감속, 정상 recovery 실패는 공개 단계 유지')
{
  const tag = (o: Record<string, unknown>): Record<string, unknown> => ({
    ok: true, code: null, tokenId: 't', trigger: 'scheduled', launchTrigger: 'scheduled',
    absorbedTrigger: null, absorbedAt: null, pass: 0, budgetWindow: '2026-11-05 06:15', ...o,
  })
  const validRecovery = tag({ trigger: 'recovery', launchTrigger: 'recovery' })
  const natural = tag({})
  const okFalse = {
    ok: false, code: 'TOKEN_MISSING', tokenId: null, trigger: null, launchTrigger: null,
    absorbedTrigger: null, absorbedAt: null, pass: null, budgetWindow: null,
  }
  const malformedRecovery = { ok: true, trigger: 'recovery' }
  check('tag 분류 — 정상 recovery · 손상 recovery 유사 · ok:false · 자연',
    recoveryRunClassOf(validRecovery) === 'valid-recovery'
    && recoveryRunClassOf(malformedRecovery) === 'recovery-like-malformed'
    && recoveryRunClassOf(okFalse) === 'other' && recoveryRunClassOf(natural) === 'other'
    && recoveryRunClassOf(null) === 'other')
  const dataDir = mkdtempSync(join(tmpdir(), 'soran-stage-recovery-health-'))
  try {
    const write = (runId: string, startedAt: string, status: string, shadow: unknown): void => {
      writeFileSync(join(dataDir, `supply-process-${runId}.run.json`), JSON.stringify({
        runId, startedAt, status, completedAt: startedAt, runtimeSha: 'abc', stages: [], runTokenShadow: shadow,
      }))
    }
    write('20261104-211500', '2026-11-04T21:15:00.000Z', 'done', natural)
    write('20261104-220500', '2026-11-04T22:05:00.000Z', 'failed', validRecovery)
    const never: JobObservation = (() => {
      const run = parseLaunchdRunInfo('gui/501/x = {\n\tstate = not running\n\truns = 0\n\tlast exit code = (never exited)\n}')
      return { label: 'com.soransoran.supply-process', installed: true, state: 'loaded', stateReason: '', run, launchdFailing: failingFromLaunchd(run) }
    })()
    const runs = readProcessRuns(dataDir).runs
    check('readProcessRuns는 모든 회차에 원본 기준 recovery 분류를 채운다',
      runs.length === 2 && runs.every((r) => r.recoveryClass !== undefined)
      && runs.find((r) => r.runId === '20261104-220500')?.recoveryClass === 'valid-recovery')
    const recoveryFailedSignal = errorSignalOf([{ label: never.label, loaded: true, failing: supplyFailing(never, runs) }])
    const kept = decisionWith([signals[0]!, signals[1]!, recoveryFailedSignal])
    check('🔴 정상 recovery 회차 실패 — 자연 공급 건강 ok · 공개 d10 유지 (F2)',
      recoveryFailedSignal.health === 'ok' && kept.decision.release === 'd10' && kept.brake === 'none',
      JSON.stringify({ signal: recoveryFailedSignal, release: kept.decision.release, brake: kept.brake }))

    write('20261104-223000', '2026-11-04T22:30:00.000Z', 'failed', natural)
    const naturalFailed = errorSignalOf([{ label: never.label, loaded: true, failing: supplyFailing(never, readProcessRuns(dataDir).runs) }])
    const slowed = decisionWith([signals[0]!, signals[1]!, naturalFailed])
    check('🔴 자연 회차 실패는 그대로 bad · 감속', naturalFailed.health === 'bad' && slowed.brake === 'slowdown'
      && slowed.decision.release !== 'd10', JSON.stringify({ release: slowed.decision.release, brake: slowed.brake }))

    write('20261104-224000', '2026-11-04T22:40:00.000Z', 'failed', malformedRecovery)
    const malformed = errorSignalOf([{ label: never.label, loaded: true, failing: supplyFailing(never, readProcessRuns(dataDir).runs) }])
    const held = decisionWith([signals[0]!, signals[1]!, malformed])
    check('🔴 recovery 유사 손상 tag가 마지막이면 모름 — 빼지도 감속하지도 않는다',
      malformed.health === 'unknown' && held.decision.release === 'd10' && held.brake !== 'slowdown',
      JSON.stringify({ signal: malformed.health, release: held.decision.release, brake: held.brake }))

    write('20261104-225000', '2026-11-04T22:50:00.000Z', 'failed', okFalse)
    check('ok:false tag 실패는 recovery 신원을 증명하지 못해 자연 실패로 남는다',
      supplyFailing(never, readProcessRuns(dataDir).runs) === true)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
  check('recoveryClass가 없는 옛 기록은 자연 실패 판정에 남는다(fail-closed)',
    failingFromProcessRuns([{ startedAt: '1', status: 'done' }, { startedAt: '2', status: 'failed' }]) === true
    && failingFromProcessRuns([
      { startedAt: '1', status: 'done', recoveryClass: 'other' },
      { startedAt: '2', status: 'failed', recoveryClass: 'valid-recovery' },
    ]) === false
    && failingFromProcessRuns([{ startedAt: '2', status: 'failed', recoveryClass: 'valid-recovery' }]) === null)
}

console.log('\n⑨ 비용 신원 — 장부 recovery 회차 ⊆ {시작 claim 회차} · final만 cohort · 하루 전체 브레이크 유지')
{
  const recoveryTag = {
    ok: true, code: null, tokenId: 't', trigger: 'recovery', launchTrigger: 'recovery',
    absorbedTrigger: null, absorbedAt: null, pass: 0, budgetWindow: '2026-11-05 06:15',
  }
  const entry = (runId: string, o: Record<string, unknown> = {}): LedgerEntry => ({
    runId: `${runId}-j`, stage: 'judge', status: 'settled', settledUsd: 0.01, reservedUsd: 0.02,
    startedAt: atKst('07:06').toISOString(), runTokenShadow: recoveryTag, ...o,
  }) as unknown as LedgerEntry
  const claimRun = '20261104-220500'
  const known = (claimRunId: string | null, includeCost: boolean) =>
    ({ kind: 'known', claimRunId, includeCost }) as const
  const subset = recoveryIdentityOf(known(claimRun, true), [entry(claimRun)], DAY)
  check('🔴 실패한 recovery도 final은 시작 claim 회차를 비용 cohort에 넣는다',
    subset.issue === null && subset.costRunId === claimRun, JSON.stringify(subset))
  const empty = recoveryIdentityOf(known(claimRun, true), [], DAY)
  check('claim이 있고 장부가 비어 있는 것은 정상(provider 전 종료) — UNKNOWN 아님',
    empty.issue === null && empty.costRunId === claimRun)
  const outside = recoveryIdentityOf(known(claimRun, true), [entry(claimRun), entry('20261104-221000')], DAY)
  check('🔴 claim 밖 회차의 recovery 요청은 신원 불명', outside.issue !== null && outside.costRunId === null)
  const noClaim = recoveryIdentityOf(known(null, true), [entry(claimRun)], DAY)
  check('🔴 claim 없이 recovery 요청이 있으면 신원 불명', noClaim.issue !== null)
  const brokenTag = recoveryIdentityOf(known(claimRun, true), [entry('x', { runId: 'not-a-run' })], DAY)
  check('회차를 읽지 못하는 recovery 요청도 신원 불명', brokenTag.issue !== null)
  const otherDay = recoveryIdentityOf(known(null, true), [entry('20261103-220500', { startedAt: '2026-11-03T22:05:00.000Z' })], DAY)
  check('다른 날짜의 recovery 요청은 오늘 claim 정합에 섞지 않는다', otherDay.issue === null)
  const middle = recoveryIdentityOf(known(claimRun, false), [entry(claimRun, { status: 'reserved', settledUsd: null })], DAY)
  check('🔴 중간 슬롯은 정합만 보고 비용 cohort에 넣지 않는다(진행 중 미정산으로 자기 취소 금지)',
    middle.issue === null && middle.costRunId === null)
  const unknownInput = recoveryIdentityOf({ kind: 'unknown', reason: 'corrupt' }, [], DAY)
  check('손상 입력은 신원 불명 · 성과 0', unknownInput.issue === 'corrupt' && unknownInput.lineage === null)
  const lineage = recoveryIdentityOf(
    { kind: 'known', claimRunId: claimRun, includeCost: true, lineage: { sourceHashes: new Set(['a']), createdAt: atKst('07:00') } },
    [entry(claimRun)], DAY,
  )
  check('lineage의 공급 회차는 시작 claim 회차 하나다', lineage.lineage?.supplyRunId === claimRun)
  const lineageNoClaim = recoveryIdentityOf(
    { kind: 'known', claimRunId: null, includeCost: true, lineage: { sourceHashes: new Set(['a']), createdAt: atKst('07:00') } },
    [], DAY,
  )
  check('🔴 claim 없는 lineage는 성과로 받지 않는다', lineageNoClaim.issue !== null && lineageNoClaim.lineage === null)

  await withHome('preflight-input', async (home) => {
    const t = timeline(home)
    await t.run({ time: '07:00', plan: recoverAt('07:00') })
    const running = intentOn(home)
    if (running.kind !== 'valid') throw new Error('fixture')
    const at = atKst('07:55')
    const noClaim = recoveryPreflightInputOf({ kind: 'evaluate', intent: running.intent, final: true }, 'd20', at, home)
    check('시작 claim 전 final — 비용 회차 없음 · lineage 없음',
      noClaim.kind === 'known' && noClaim.claimRunId === null && noClaim.lineage === undefined)
    const claim = { kstDate: running.intent.kstDate, nonce: running.intent.nonce, deficit: running.intent.deficit }
    claimStageRecoverySupplyStart({ claim, supplyRunId: claimRun, now: atKst('07:05'), home })
    const middle = recoveryPreflightInputOf({ kind: 'evaluate', intent: running.intent, final: false }, 'd20', at, home)
    check('🔴 중간 슬롯 입력 — claim 회차로 정합만 · 비용 cohort 0 · lineage 0',
      middle.kind === 'known' && middle.claimRunId === claimRun && !middle.includeCost && middle.lineage === undefined)
    const failedFinal = recoveryPreflightInputOf(
      { kind: 'evaluate', intent: { ...running.intent, state: 'failed' }, final: true }, 'd20', at, home,
    )
    check('🔴 실패 recovery final 입력 — claim 회차 비용 포함 · 성과 0',
      failedFinal.kind === 'known' && failedFinal.includeCost && failedFinal.claimRunId === claimRun
      && failedFinal.lineage === undefined)
    writeStageRecoverySourceReceipt({
      kstDate: DAY, nonce: running.intent.nonce, runId: 'collector', sourceHashes: ['a'.repeat(64)], now: atKst('07:04'), home,
    })
    writeStageRecoverySupplyReceipt({ claim, supplyRunId: claimRun, now: atKst('07:30'), home })
    const done = updateStageRecoveryIntent({ intent: running.intent, state: 'done', now: atKst('07:31'), home })
    const ok = recoveryPreflightInputOf({ kind: 'evaluate', intent: done, final: true }, 'd20', at, home)
    check('done final 입력 — 영수증·claim 회차가 맞으면 lineage',
      ok.kind === 'known' && ok.includeCost && ok.lineage !== undefined && ok.lineage.sourceHashes.size === 1)
    check('대상 단계가 다르면 lineage 없음(비용은 포함)', (() => {
      const r = recoveryPreflightInputOf({ kind: 'evaluate', intent: done, final: true }, 'd30', at, home)
      return r.kind === 'known' && r.includeCost && r.lineage === undefined
    })())
    check('final 시각보다 뒤에 쓴 영수증은 lineage로 받지 않는다', (() => {
      const r = recoveryPreflightInputOf({ kind: 'evaluate', intent: done, final: true }, 'd20', atKst('07:20'), home)
      return r.kind === 'known' && r.lineage === undefined
    })())
    const startPath = stageRecoverySupplyStartClaimPath(DAY, home)
    const original = readFileSync(startPath, 'utf-8')
    writeFileSync(startPath, original.replace(claimRun, '20261104-229900'))
    const mismatch = recoveryPreflightInputOf({ kind: 'evaluate', intent: done, final: true }, 'd20', at, home)
    check('🔴 완주 영수증 회차 ≠ 시작 claim 회차면 신원 불명', mismatch.kind === 'unknown', JSON.stringify(mismatch))
    writeFileSync(startPath, '{broken')
    check('🔴 손상 시작 claim은 중간·final 모두 신원 불명',
      recoveryPreflightInputOf({ kind: 'evaluate', intent: done, final: false }, 'd20', at, home).kind === 'unknown'
      && recoveryPreflightInputOf({ kind: 'evaluate', intent: done, final: true }, 'd20', at, home).kind === 'unknown')
    check('산출물 없음·손상 입력은 그대로 전달',
      recoveryPreflightInputOf({ kind: 'none' }, 'd20', at, home).kind === 'known'
      && recoveryPreflightInputOf({ kind: 'unknown', reason: 'x' }, 'd20', at, home).kind === 'unknown')
  })

  const overrun = entry(claimRun, { settledUsd: 0.05, reservedUsd: 0.02 })
  const cost = judgeCost({ uses: true, tally: tallyOf([overrun]), ledgerError: null, settleHold: null, capUsd: 1.2 })
  const braked = decisionWith([signals[0]!, costSignalOf([{ name: '공급 장부', health: cost.health, reasons: cost.reasons }]), signals[2]!])
  check('🔴 recovery 요청 overrun도 하루 전체 비용에서 빠지지 않고 기존 감속을 건다',
    cost.health === 'bad' && braked.brake === 'slowdown', JSON.stringify({ cost: cost.health, brake: braked.brake }))
}

console.log('\n⑩ 격리 DB — 실제 StageDecision 표에서 중간 write 0 · 07:55/07:58 동시 create-only 1행')
if ((process.env.SORAN_ISOLATED_DB ?? '').trim() !== 'yes-throwaway') {
  console.log('  SKIP 격리 DB 미설정 — SORAN_ISOLATED_DB=yes-throwaway + localhost soran_test 에서만 돈다(운영 DB 0)')
} else {
  const { requireIsolatedDb } = await import('./lib/auto-ready-audit-fixtures.mjs')
  requireIsolatedDb()
  const { PrismaClient } = await import('@prisma/client')
  const { stageDecisionIo } = await import('../src/lib/stage-decision-repo')
  const prisma = new PrismaClient()
  const prisma755 = new PrismaClient()
  const prisma758 = new PrismaClient()
  const rows = (): Promise<number> => prisma.stageDecision.count({ where: { kstDate: DAY } })
  try {
    await prisma.stageDecision.deleteMany({ where: { kstDate: DAY } })
    await withHome('db', async (home) => {
      const t = timeline(home, stageDecisionIo(prisma, DAY))
      const o0700 = await t.run({ time: '07:00', plan: recoverAt('07:00') })
      workerFinishes(home, '07:15')
      const o0720 = await t.run({ time: '07:20', plan: recoverAt('07:20') })
      const o0740 = await t.run({ time: '07:40', plan: recoverAt('07:40') })
      check('🔴 격리 DB — recovery 날 07:00·07:20·07:40 StageDecision 행 0',
        o0700.action === 'start-recovery' && o0720.action === 'wait-final' && o0740.action === 'wait-final'
        && await rows() === 0)
      const at755 = timeline(home, stageDecisionIo(prisma755, DAY))
      const at758 = timeline(home, stageDecisionIo(prisma758, DAY))
      const [a, b] = await Promise.all([
        at755.run({ time: '07:55', plan: recoverAt('07:55') }),
        at758.run({ time: '07:58', plan: recoverAt('07:58') }),
      ])
      const stored = await prisma.stageDecision.findUnique({ where: { kstDate: DAY } })
      check('🔴 격리 DB — 07:55·07:58 동시 실행도 create-only 1행 · 둘 다 정상 종료 · 하나만 생성',
        await rows() === 1 && a.exitCode === 0 && b.exitCode === 0 && [a, b].filter((o) => o.created).length === 1
        && stored?.release === okResult.decision.release, JSON.stringify({ a, b, release: stored?.release }))
      const again = await t.run({ time: '07:58', plan: recoverAt('07:58') })
      check('격리 DB — 저장 뒤 슬롯은 읽기만 · 행 1 그대로', again.action === 'read-existing' && await rows() === 1)
    })
  } finally {
    await prisma.stageDecision.deleteMany({ where: { kstDate: DAY } })
    await Promise.all([prisma.$disconnect(), prisma755.$disconnect(), prisma758.$disconnect()])
  }
}

console.log(`\nstage active recovery: ${pass} PASS · ${fail} FAIL`)
if (fail > 0) process.exit(1)
