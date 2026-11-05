#!/usr/bin/env tsx
/**
 * D20+ 아침 제한 복구의 순수 계약 검사.
 *
 * StageDecision을 우회하지 않고, 유일한 OPPORTUNITY_SHORT만 하루 한 번 복구하며,
 * 품질·비용·오류·시간·범위가 어긋나면 추가 공급을 열지 않는지 본다.
 */
import { closeSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ACTIVE_RECOVERY_DATE_ENV, ACTIVE_RECOVERY_DEADLINE_ENV, ACTIVE_RECOVERY_DEFICIT_ENV,
  ACTIVE_RECOVERY_NONCE_ENV, activeRecoveryDeadlineAt, activeRecoveryDecisionDisposition,
  isFinalRecoveryControllerSlot,
  planActiveRecovery, recoveryJitDemand, retryFinalStageDecisionWrite,
  type ActiveRecoveryPlan,
} from '../src/lib/stage-active-recovery'
import type { HealthSignal } from '../src/lib/stage-controller'
import type { PreflightVerdict } from '../src/lib/stage-ladder-generic'
import {
  claimStageRecoveryLaunch, claimStageRecoverySupplyStart, createStageRecoveryIntent,
  failStageRecoveryClaimBestEffort,
  hasStageRecoverySupplyReceipt, parseStageRecoveryIntent,
  readStageRecoveryIntent, stageRecoveryDir, stageRecoveryIntentCoversPlan, stageRecoveryIntentMatchesPlan,
  stageRecoveryIntentPath,
  updateStageRecoveryIntent, validateStageRecoveryClaim, validateStageRecoveryReceiptIdentityEnv,
  validateStageRecoveryRuntimeEnv,
  writeStageRecoverySupplyReceipt,
} from './lib/stage-recovery-intent.mjs'
import { runDetachedProcessGroup } from './lib/detached-process-group.mjs'
import { runCollectorTerminationCleanup } from './lib/micro-seed-navercafe.mjs'
import { stageRecoveryProviderBoundaryReason } from './lib/supply-llm-call.mjs'
import {
  readStageRecoverySourceHashes, stageRecoverySourceReceiptPath, writeStageRecoverySourceReceipt,
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
  codes?: PreflightVerdict['codes']
  verdict?: PreflightVerdict['verdict']
} = {}): PreflightVerdict => ({
  stage: 'd20', verdict: i.verdict ?? 'FAIL',
  codes: i.codes ?? ['OPPORTUNITY_SHORT'], warnings: [],
  counts: { target: i.target ?? 20, opportunities: i.opportunities ?? 17 },
})
const plan = (p: PreflightVerdict, now = atKst('07:00'), s = signals): ActiveRecoveryPlan =>
  planActiveRecovery({ target: 'd20', preflight: p, signals: s, failures: [], now })

console.log('\n① 복구 대상 — 기회 부족 하나만')
const good = plan(preflight())
check('17/20이면 부족 3건·분류 전 상세는 안전 상한 10건·유료 묶음은 별도 수율 계약으로 복구',
  good.kind === 'recover' && good.deficit === 3 && good.collectMax === 10 && good.worksetLimit > 0,
  JSON.stringify(good))
check('부족 1건도 raw 상세와 최종 기회를 1:1로 보지 않고 안전 상한 10건을 본다',
  (() => { const p = plan(preflight({ opportunities: 19 })); return p.kind === 'recover' && p.collectMax === 10 })())
check('부족 10건은 허용 상한 안', plan(preflight({ opportunities: 10 })).kind === 'recover')
check('부족 11건은 추가 공급을 열지 않는다', plan(preflight({ opportunities: 9 })).kind === 'none')
check('품질 비정상은 기회 부족이어도 열지 않는다',
  plan(preflight(), atKst('07:00'), [{ axis: 'quality', health: 'bad', reasons: ['x'] }, ...signals.slice(1)]).kind === 'none')
check('비용 모름은 기회 부족이어도 열지 않는다',
  plan(preflight(), atKst('07:00'), [signals[0]!, { axis: 'cost', health: 'unknown', reasons: ['x'] }, signals[2]!]).kind === 'none')
check('다른 결함이 섞이면 열지 않는다',
  plan(preflight({ codes: ['OPPORTUNITY_SHORT', 'THROUGHPUT_SHORT'] })).kind === 'none')
check('PASS를 다시 실행하지 않는다', plan(preflight({ verdict: 'PASS', codes: [] })).kind === 'none')
check('D10 이하는 새 복구 경로를 열지 않는다',
  planActiveRecovery({ target: 'd10', preflight: preflight(), signals, failures: [], now: atKst('07:00') }).kind === 'none')

console.log('\n①-1 controller 분기 — 중간 결정 연기와 중대 결함 취소')
check('복구 가능 plan은 recovery 시작 분기',
  activeRecoveryDecisionDisposition({ plan: good, intentState: null, preflight: preflight() }) === 'recover')
check('복구 가능 plan이어도 종료된 intent는 같은 슬롯에서 현재 정본으로 결정',
  activeRecoveryDecisionDisposition({ plan: good, intentState: 'done', preflight: preflight() }) === 'decide'
  && activeRecoveryDecisionDisposition({ plan: good, intentState: 'failed', preflight: preflight() }) === 'decide')
const outsideWindow = plan(preflight(), atKst('07:40'))
check('유료 창이 닫혔고 active intent가 없으면 그 슬롯에서 같은 정본 결정을 쓴다',
  activeRecoveryDecisionDisposition({
    plan: outsideWindow, intentState: null, preflight: preflight(),
  }) === 'decide')
check('완료·실패 intent 뒤에는 같은 정본 결정을 즉시 쓴다',
  activeRecoveryDecisionDisposition({ plan: outsideWindow, intentState: 'failed', preflight: preflight() }) === 'decide'
  && activeRecoveryDecisionDisposition({
    plan: { kind: 'none', reason: 'already pass', hardBlock: false },
    intentState: 'done', preflight: preflight({ verdict: 'PASS', codes: [] }),
  }) === 'decide')
check('intent가 없고 새 복구 창도 닫혔으면 다음 최종 시각까지 숨기지 않고 즉시 정본 결정',
  activeRecoveryDecisionDisposition({ plan: outsideWindow, intentState: null, preflight: preflight() }) === 'decide')
const qualityBlock = plan(preflight(), atKst('07:20'), [
  { axis: 'quality', health: 'bad', reasons: ['x'] }, ...signals.slice(1),
])
check('복구 중 새 중대 결함은 intent를 닫고 기존 authority 판정으로 복귀',
  activeRecoveryDecisionDisposition({
    plan: qualityBlock, intentState: 'running', preflight: preflight(),
  }) === 'cancel-and-decide'
  && activeRecoveryDecisionDisposition({
    plan: qualityBlock, intentState: 'running',
    preflight: preflight({ codes: ['OPPORTUNITY_SHORT', 'RUNNER_BAD'] }),
  }) === 'cancel-and-decide'
  && activeRecoveryDecisionDisposition({
    plan: qualityBlock, intentState: 'done', preflight: preflight(),
  }) === 'decide')
check('active intent가 없고 복구 대상도 아니면 기존 결정 경로',
  activeRecoveryDecisionDisposition({
    plan: qualityBlock, intentState: null,
    preflight: preflight({ codes: ['OPPORTUNITY_SHORT', 'RUNNER_BAD'] }),
  }) === 'decide')

console.log('\n② 시간 — 07:30 이후 유료 시작 0 · 07:55 최종 판정 · 07:58 저장 fallback')
check('06:59에는 열지 않는다', plan(preflight(), atKst('06:59')).kind === 'none')
check('07:29에는 열 수 있다', plan(preflight(), atKst('07:29')).kind === 'recover')
check('07:30에는 새 유료 실행을 열지 않고 non-hard-block plan으로 기존 결정 경로에 맡긴다', (() => {
  const p = plan(preflight(), atKst('07:30'))
  return p.kind === 'none' && !p.hardBlock
})())
check('07:54는 중간 슬롯', !isFinalRecoveryControllerSlot(atKst('07:54')))
check('07:55는 최종 슬롯', isFinalRecoveryControllerSlot(atKst('07:55')))
check('07:58은 같은 최종 판정 경로의 저장 fallback 슬롯', isFinalRecoveryControllerSlot(atKst('07:58')))
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
check('07:55·07:58 최종 저장은 같은 계산으로 최대 3회 안에서 일시 장애를 흡수',
  finalWrite === 'stored' && finalWriteCalls === 3)

console.log('\n③ intent — 하루 한 번·엄격한 모양·종료 상태 불변')
const home = mkdtempSync(join(tmpdir(), 'soran-stage-recovery-'))
try {
  if (good.kind !== 'recover') throw new Error('test fixture')
  const first = createStageRecoveryIntent({ kstDate: '2026-11-05', plan: good, now: atKst('07:00'), home })
  const second = createStageRecoveryIntent({ kstDate: '2026-11-05', plan: good, now: atKst('07:01'), home })
  check('같은 날짜 intent는 정확히 하나', first.created && !second.created && first.intent.nonce === second.intent.nonce)
  check('현재 plan과 intent가 같은지 네 축을 모두 대조', stageRecoveryIntentMatchesPlan(first.intent, good))
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
  claimStageRecoverySupplyStart({ claim, now: atKst('07:03'), home })
  let duplicateSupply = false
  try { claimStageRecoverySupplyStart({ claim, now: atKst('07:04'), home }) } catch { duplicateSupply = true }
  check('같은 nonce 공급 본체는 한 번만 시작', duplicateSupply)
  let reversed = false
  try { updateStageRecoveryIntent({ intent: running, state: 'requested', now: atKst('07:03'), home }) } catch { reversed = true }
  check('running에서 requested로 되돌릴 수 없다', reversed)
  check('공급 전에는 완주 영수증이 없다', !hasStageRecoverySupplyReceipt(claim, home))
  writeStageRecoverySupplyReceipt({ claim, now: atKst('07:10'), home })
  writeStageRecoverySupplyReceipt({ claim, now: atKst('07:11'), home })
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
    && readStageRecoveryIntent('2026-11-06', home)?.state === 'failed')
  check('위조 claim은 다른 intent 상태를 바꾸지 않는다',
    !failStageRecoveryClaimBestEffort({
      claim: { ...earlyClaim, nonce: 'forged' }, now: new Date('2026-11-06T07:03:00+09:00'),
      message: 'forged', home,
    })
    && readStageRecoveryIntent('2026-11-06', home)?.message === 'log open failed')

  const raw = JSON.parse(readFileSync(stageRecoveryIntentPath('2026-11-05', home), 'utf-8')) as Record<string, unknown>
  raw.deficit = 999
  check('손상·과대 intent는 엄격 파서가 거절', parseStageRecoveryIntent(JSON.stringify(raw)) === null)
  raw.deficit = done.deficit
  raw.target = 'd100'
  check('runtime에 배선되지 않은 d100 intent는 파서에서 거절', parseStageRecoveryIntent(JSON.stringify(raw)) === null)
  raw.target = 'd10'
  check('복구 대상이 아닌 d10 intent도 파서에서 거절', parseStageRecoveryIntent(JSON.stringify(raw)) === null)
  raw.target = done.target
  check('저장된 정상 intent는 읽힌다', readStageRecoveryIntent('2026-11-05', home)?.state === 'done')

  const sourceHash = 'a'.repeat(64)
  writeStageRecoverySourceReceipt({
    kstDate: '2026-11-05', nonce: done.nonce, runId: 'collector-test',
    sourceHashes: [sourceHash, sourceHash], now: atKst('07:10'), home,
  })
  check('복구 원천 영수증은 raw ID 없이 정렬·중복 제거된 hash만 읽는다',
    readStageRecoverySourceHashes('2026-11-05', home)?.size === 1
    && !readFileSync(stageRecoverySourceReceiptPath('2026-11-05', done.nonce, home), 'utf-8').includes('sourceArticleId'))
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
  check('07:55 intent close 실패는 로그를 남기되 최종 StageDecision 경로를 return으로 막지 않는다', (() => {
    const finalBranch = controller.slice(controller.indexOf('existingDecision === null && finalRecoverySlot'),
      controller.indexOf('let out:', controller.indexOf('existingDecision === null && finalRecoverySlot')))
    return /catch \(e\)/.test(finalBranch) && /07:50 provider 마감은 이미 닫혔다/.test(finalBranch)
      && !/return 1/.test(finalBranch)
  })())
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

console.log(`\nstage active recovery: ${pass} PASS · ${fail} FAIL`)
if (fail > 0) process.exit(1)
