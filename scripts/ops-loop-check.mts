#!/usr/bin/env tsx
/**
 * 무인 운영 루프 검사 — 🔴 순수 fixture. DB 0 · 네트워크 0 · launchctl 0 · provider 0
 *
 *   ① readiness 오판 반례 — load 돼 있고 최근 회차가 정상인 job 이 healthUnknown 으로 떨어지지 않는다
 *   ② 운영 한 화면 — 비용 판정 · 실패 이유 줄 · 비밀값 가리기
 *   ③ 단계 controller — 승격은 승인 천장(d1~d10) 안 · 나쁜 신호면 감속 · 모르면 유지 · 실패면 지금 단계 유지
 *   ④ consumer — flag OFF 면 아무것도 넣지 않는다 · 결정이 없으면 d1
 *   ⑤ keep-awake · controller · 복구 템플릿 — sudo/pmset 0 · 발행 창 전 · 수집 job 제외
 *   ⑥ 복구 판정 — 모르면 건드리지 않는다 · 같은 창에서 한 번만
 *   ⑦ 발행 재등록 — 배포 뒤 never exited 는 마지막 실제 회차 기록으로만 판정 · 없음/손상/오래됨/실패는 정상이 아니다
 *   ⑧ 설치기 — 실행 중 예외는 keep-awake 하나 · 적용은 keep-awake 도 내렸다 다시 띄우고, 실패면 전체 rollback
 *      (설치기 plan 은 임시 HOME 에서 **가짜 launchctl 만 PATH 에 둔 채** 실제로 실행한다 — 진짜 launchctl 0)
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ledgerDateOf } from '../src/lib/llm-ledger'
import { PRICING_VERSION } from '../src/lib/llm-pricing'
import { SUPPLY_JIT_CONTRACT } from '../src/lib/supply-intent'
import { readCostSignals } from './lib/ops-signals.mjs'
import { settleHoldPathOf, writeSettleHold } from './lib/llm-ledger-store.mjs'
import { COMMENT_DAILY_USD_CAP, COMMENT_LOOP_BUDGET_ENV } from '../src/lib/persona-comment-auto-lane'

import {
  parseLaunchdRunInfo, failingFromLaunchd, failingFromProcessRuns, combineFailing, collectCapabilityFailing,
} from '../src/lib/job-health'
import { runnerFactsOf, capabilityFactsReady } from '../src/lib/d100-readiness'
import { judgeCost, lastFailureLine, redactSecrets, laneHealth } from '../src/lib/ops-status'
import {
  decideStage, holdAtCurrent, previousStage, openStageOf, consumerEnvOf, validateForToday,
  qualitySignalOf, costSignalOf, errorSignalOf, type HealthSignal, type ControllerInputs,
} from '../src/lib/stage-controller'
import { STAGE_DECISION_VERSION, validateStoredDecision, type ValidatedStageDecision } from '../src/lib/stage-decision-contract'
import { type RuntimeStage } from '../src/lib/scale-profile'
import { resolveScale } from '../src/lib/scale-runtime'
import { judgeRecovery, latestSlotAtOrBefore, RECOVERY_SLOT_GRACE_MS } from '../src/lib/runner-recovery'
import { staleAfterFromSlots } from '../src/lib/supply-health'
import { COMMENT_RUNNER_LABEL, COMMENT_RUNNER_SLOTS, FIRST_COMMENT_MAX_MINUTES, renderCommentRunnerPlist } from './lib/persona-comment-runner-template'
import { AUDIT_RUNNER_LABEL, renderAuditRunnerPlist } from './lib/auto-ready-audit-template'
import {
  publishFailing, supplyFailing,
  type JobObservation,
} from './lib/runner-health.mjs'
import { supplyRunIdOf } from '../src/lib/supply-run-token'
import { SUPPLY_RUN_SLOTS_KST, SUPPLY_RUN_WINDOW_MS } from '../src/lib/supply-schedule-contract'
import { PUBLISH_RUN_MAX_AGE_MS, readPublishRunRecord, recordPublishRun } from './lib/publish-run-record.mjs'
import { parsePublishRunRecord, type PublishRunRead } from '../src/lib/job-health'
import {
  renderKeepAwakePlist, renderStageControllerPlist, renderRunnerRecoverPlist, stageControllerSlots,
  stageControllerLeaseDisposition, STAGE_CONTROLLER_FINAL_DECISION_MINUTE_KST,
  OPS_LOOP_INSTALL_STEPS, RECOVERABLE_LABELS, RECOVERY_POLICY_OF, CAFFEINATE_ARGS,
  KEEP_AWAKE_LABEL, STAGE_CONTROLLER_LABEL, RUNNER_RECOVER_LABEL, OPS_SHADOW_OBSERVER_LABEL,
} from './lib/ops-loop-templates'
import { DEPLOY_QUIESCE_JOBS } from './lib/runtime-quiesce-jobs'
import { applyInstall, desiredPlists, observerIntentOf, observerWanted, runningBlockers } from './lib/ops-loop-install-core.mjs'
import { ALWAYS_RUNNING_LABELS } from './lib/host-migrate.mjs'
import { CYCLES, STAGE_DECISION_BASE_MINUTE, cycleLabel, cyclePublishWindow } from '../src/lib/cycle-schedule'
import { OPS_LOOP_TEMPLATE_DEFER_LABELS, RUNTIME_JOBS } from '../src/lib/runtime-isolation'
import { programArguments, render, valueOf } from './lib/launchd-install.mjs'
import {
  renderPublishHeartbeatPlist, renderPublishRunnerPlist, STAGE_CONSUMER_SCRIPT, PUBLISH_RUNNER_LABEL,
  LAUNCHD_RUN_MARK_KEY, LAUNCHD_RUN_MARK_VALUE, LAUNCHD_LABEL_KEY,
  judgeLaunchdRunMarker, launchctlEnvironmentOf, plistEnvironmentOf,
} from './lib/original-post-runner-template'

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

// 실측 모양(2026-09-28 · macOS 15.6) 그대로의 `launchctl print` 발췌
const PRINT_OK = 'gui/501/x = {\n\tstate = not running\n\truns = 4\n\tlast exit code = 0\n}'
const PRINT_FAIL = 'gui/501/x = {\n\tstate = not running\n\truns = 2\n\tlast exit code = 1\n}'
const PRINT_NEVER = 'gui/501/x = {\n\tstate = not running\n\truns = 0\n\tlast exit code = (never exited)\n}'
const PRINT_RUNNING = 'gui/501/x = {\n\tstate = running\n\truns = 3\n\tlast exit code = 0\n}'

// ─────────────────────────────────────────────────────────
console.log('\n① readiness 오판 — 근본 원인 반례')
// ─────────────────────────────────────────────────────────
{
  check('launchd exit 0 → 실패 아님(false)', failingFromLaunchd(parseLaunchdRunInfo(PRINT_OK)) === false)
  check('launchd exit 1 → 실패(true)', failingFromLaunchd(parseLaunchdRunInfo(PRINT_FAIL)) === true)
  check('🔴 (never exited) → 모른다(null) — 0 으로 읽지 않는다', failingFromLaunchd(parseLaunchdRunInfo(PRINT_NEVER)) === null)
  check('못 읽음 → 모른다(null)', failingFromLaunchd(parseLaunchdRunInfo(null)) === null
    && failingFromLaunchd(parseLaunchdRunInfo('')) === null)
  check('state = running 을 읽는다', parseLaunchdRunInfo(PRINT_RUNNING).running && !parseLaunchdRunInfo(PRINT_OK).running)
  check('회차 기록: 마지막 끝난 회차가 done → false · failed → true · running 만 → null',
    failingFromProcessRuns([{ startedAt: '1', status: 'failed' }, { startedAt: '2', status: 'done' }]) === false
    && failingFromProcessRuns([{ startedAt: '2', status: 'failed' }, { startedAt: '1', status: 'done' }]) === true
    && failingFromProcessRuns([{ startedAt: '3', status: 'running' }]) === null
    && failingFromProcessRuns([]) === null)
  check('🔴 합치기: 실패가 이긴다 · 정상은 전원 일치 · null 섞이면 모른다',
    combineFailing([false, true]) === true && combineFailing([false, false]) === false
    && combineFailing([false, null]) === null && combineFailing([]) === null)
  check('수집 능력: 켜진 공급원만 본다 — 정책으로 꺼 둔 82cook 은 빼고 판정',
    collectCapabilityFailing([
      { enabled: true, failing: false }, { enabled: true, failing: false }, { enabled: false, failing: null },
    ]) === false
    && collectCapabilityFailing([{ enabled: true, failing: false }, { enabled: true, failing: true }]) === true
    && collectCapabilityFailing([{ enabled: true, failing: null }, { enabled: true, failing: false }]) === null)

  const obs = (print: string | null): JobObservation => {
    const run = parseLaunchdRunInfo(print)
    return { label: 'x', installed: true, state: 'loaded', stateReason: '', run, launchdFailing: failingFromLaunchd(run) }
  }
  const done = [{ runId: 'a', startedAt: '2026-09-28T08:00:00Z', status: 'done', completedAt: null, runtimeSha: null, runTokenShadow: null, failedStages: [] }]
  const failed = [{ ...done[0]!, status: 'failed' }]
  check('🔴 공급: 다시 load 뒤 아직 안 돈 job(never exited) 은 **마지막 실제 회차 기록**으로 판정한다',
    supplyFailing(obs(PRINT_NEVER), done) === false && supplyFailing(obs(PRINT_NEVER), failed) === true)
  check('공급: launchd exit 1 이면 기록이 done 이어도 실패', supplyFailing(obs(PRINT_FAIL), done) === true)
  check('공급: launchctl 을 못 읽었으면 기록이 있어도 모른다', supplyFailing(obs(null), done) === null)

  // 🔴 앞판의 실제 결함: 관측값이 있어도 `failing: null` 상수가 넘어가 healthUnknown → canRun false
  const before = runnerFactsOf({ installed: true, loaded: true, enabled: true, failing: null })
  const after = runnerFactsOf({ installed: true, loaded: true, enabled: true, failing: failingFromLaunchd(parseLaunchdRunInfo(PRINT_OK)) })
  check('🔴 반례 재현 — 상수 null 이면 load·정상 job 도 healthUnknown(앞판)', before.state === 'healthUnknown' && !before.canRun)
  check('🔴 수정 — 관측값(exit 0)을 넘기면 ready · canRun', after.state === 'ready' && after.canRun && capabilityFactsReady(after))
  check('🔴 관측이 없으면 여전히 healthUnknown — fail-open 으로 바꾸지 않았다',
    runnerFactsOf({ installed: true, loaded: true, enabled: true, failing: failingFromLaunchd(parseLaunchdRunInfo(PRINT_NEVER)) }).state === 'healthUnknown')

  const cli = readFileSync('scripts/d100-master-readiness.mts', 'utf-8')
  const factsFn = /const factsOf = [\s\S]*?\n\}\)\n/.exec(cli)?.[0] ?? ''
  check('🔴 d100:readiness 의 factsOf 가 failing 을 **인자로** 받는다(상수 null 0)',
    factsFn !== '' && /failing: boolean \| null/.test(factsFn) && !/failing: null,/.test(factsFn))
  check('🔴 collect 능력이 공급원별 회차 기록을 받는다', /collectCapabilityFailing\(collectJobs\.map/.test(cli))
  check('🔴 generate 가 launchd + 공급 회차 기록을 받는다', /supplyFailing\(supplyObs, readProcessRuns\(\)\.runs\)/.test(cli))
  check('🔴 publish·comment 가 launchd 종료 값을 받는다',
    /publish: factsOf\(PUBLISH_LABEL, true, publishObs\.launchdFailing\)/.test(cli)
    && /comment: factsOf\(COMMENT_LABEL, true, commentObs\.launchdFailing\)/.test(cli))
}

// ─────────────────────────────────────────────────────────
console.log('\n② 운영 한 화면 — 비용 · 실패 이유 · 비밀값')
// ─────────────────────────────────────────────────────────
{
  const t = (settled: number, open = 0, overruns = 0) => ({
    settledUsd: settled, openReservedUsd: open, usageUnknownUsd: 0, paidRequests: 1,
    countTokensRequests: 0, blocked: 0, overruns,
  })
  check('상한 안 → ok', judgeCost({ uses: true, tally: t(0.1), ledgerError: null, settleHold: null, capUsd: 0.5 }).health === 'ok')
  const ex = judgeCost({ uses: true, tally: t(0.4, 0.1), ledgerError: null, settleHold: null, capUsd: 0.5 })
  check('🔴 정산 + 열린 예약 ≥ 상한 → DAILY_EXHAUSTED (정본 judgeSpend 와 같은 합)', ex.health === 'bad' && ex.codes.includes('DAILY_EXHAUSTED') && ex.spentUsd === 0.5)
  check('실제 > 예약 → UNSETTLED_OVERRUN', judgeCost({ uses: true, tally: t(0.1, 0, 1), ledgerError: null, settleHold: null, capUsd: 0.5 }).codes.includes('UNSETTLED_OVERRUN'))
  check('정산 보류 → SETTLE_ERROR', judgeCost({ uses: true, tally: t(0), ledgerError: null, settleHold: 'x', capUsd: 0.5 }).codes.includes('SETTLE_ERROR'))
  check('🔴 장부 못 읽음 → LEDGER_ERROR · bad (0 으로 채우지 않는다)', (() => {
    const v = judgeCost({ uses: true, tally: null, ledgerError: '깨진 줄', settleHold: null, capUsd: 0.5 })
    return v.health === 'bad' && v.spentUsd === null && v.codes.includes('LEDGER_ERROR')
  })())
  check('상한 미설정 → NO_BUDGET · unknown', judgeCost({ uses: true, tally: t(0), ledgerError: null, settleHold: null, capUsd: null }).health === 'unknown')
  check('유료 호출 없는 레인(발행) → ok', judgeCost({ uses: false, tally: null, ledgerError: null, settleHold: null, capUsd: null }).health === 'ok')

  /**
   * 🔴 (2026-09-29) 무인 댓글 루프는 **자기 장부**에 쓴다 — 앞판은 공급 장부만 읽어 댓글 지출이 $0 으로 보였다.
   *    반례: 댓글 장부에만 상한($0.20) 초과 지출 → 댓글 축은 bad, 공급 축은 그대로 ok.
   */
  {
    const root = mkdtempSync(join(tmpdir(), 'ops-cost-'))
    const dirs = { supply: join(root, 's'), audit: join(root, 'a'), comment: join(root, 'c') }
    for (const d of Object.values(dirs)) mkdirSync(d)
    const now = new Date('2026-09-29T02:00:00Z')
    const line = (usd: number) => JSON.stringify({
      runId: 'comment-loop-x', stage: 'commentGen', attemptId: 'a1', requestNo: 0, provider: 'google',
      apiModelId: 'gemini-3.7-flash', model: 'gemini-3.7-flash', status: 'settled', blockCode: null,
      countedInputTokens: 1, maxOutputTokens: 800, reservedUsd: usd, inputTokens: 1, outputTokens: 1,
      cacheWriteTokens: 0, cacheReadTokens: 0, usageKeys: [], settledUsd: usd, pricingVersion: 'supply-2026-09-19',
      startedAt: now.toISOString(), endedAt: now.toISOString(), errorCode: null,
    })
    writeFileSync(join(dirs.comment, `${ledgerDateOf(now)}.jsonl`), `${line(0.25)}\n`)
    const env = { SORAN_LLM_DAILY_BUDGET_USD: '0.50', SORAN_AUDIT_LLM_DAILY_BUDGET_USD: '0.30' }
    const c = readCostSignals(now, null, env, dirs)
    check('🔴 댓글 장부 초과 지출을 댓글 축이 본다 (공급 장부가 아니라 전용 장부)',
      c.commentLedger.health === 'bad' && c.commentLedger.codes.includes('DAILY_EXHAUSTED') && c.commentLedger.spentUsd === 0.25)
    check('🔴 댓글 상한은 댓글 계약값 $0.20 이다 (env 미설정 → 기본값)', c.commentLedger.capUsd === 0.2)
    check('댓글 지출이 공급 축을 오염시키지 않는다', c.supplyLedger.spentUsd === 0 && c.supplyLedger.health !== 'bad')
    rmSync(root, { recursive: true, force: true })
  }

  /**
   * 🔴 (2026-11-25 밤 4) **댓글 천장은 그날 단계로 잰다** — 단계는 부르는 쪽이 넘긴다(env 에서 읽지 않는다).
   *    반례: D50 날 $1.10 을 쓴 장부를 이튿날(D30) 컨트롤러가 다시 판정해도, 그 날의 단계(d50)로 재면 ok 다.
   *    같은 장부를 오늘 단계(d30)로 재면 DAILY_EXHAUSTED — 소급 COST_BAD 가 연속 통과를 끊는다(그래서 그렇게 부르지 않는다).
   *    컨트롤러가 정본 env 에서 읽는 것은 예산 키뿐이다(결정 표식 없음) — 그래도 댓글 칸이 ok 여야 한다.
   */
  {
    const root = mkdtempSync(join(tmpdir(), 'ops-comment-cap-'))
    const dirs = { supply: join(root, 's'), audit: join(root, 'a'), comment: join(root, 'c') }
    for (const d of Object.values(dirs)) mkdirSync(d)
    const d50Day = new Date('2026-11-26T12:00:00+09:00')
    const spent = 1.1
    writeFileSync(join(dirs.comment, `${ledgerDateOf(d50Day)}.jsonl`), `${JSON.stringify({
      runId: 'comment-loop-d50', stage: 'commentGen', attemptId: 'd50-a1', requestNo: 0, provider: 'google',
      apiModelId: 'gemini-3.7-flash', model: 'gemini-3.7-flash', status: 'settled', blockCode: null,
      countedInputTokens: 1, maxOutputTokens: 800, reservedUsd: spent, inputTokens: 1, outputTokens: 1,
      cacheWriteTokens: 0, cacheReadTokens: 0, usageKeys: [], settledUsd: spent, pricingVersion: 'supply-2026-09-19',
      startedAt: d50Day.toISOString(), endedAt: d50Day.toISOString(), errorCode: null,
    })}\n`)
    // 컨트롤러가 읽는 env 의 모양 — 예산 키만(결정 표식 · 단계 칸 없음). 운영 댓글 env 는 D50 칸 값이다
    const controllerEnv = {
      SORAN_LLM_DAILY_BUDGET_USD: '1.80', SORAN_AUDIT_LLM_DAILY_BUDGET_USD: '0.30',
      [COMMENT_LOOP_BUDGET_ENV.dailyUsd]: String(COMMENT_DAILY_USD_CAP.d50),
    }
    const thatDay = readCostSignals(d50Day, 'd50', controllerEnv, dirs).commentLedger
    const asD30 = readCostSignals(d50Day, 'd30', controllerEnv, dirs).commentLedger
    const unknown = readCostSignals(d50Day, null, controllerEnv, dirs).commentLedger
    check('🔴 🔴 **D50 날 $1.10 을 쓴 장부 — 이튿날 재판정도 그 날의 단계(d50)로 재면 ok · 천장은 d50 칸**',
      thatDay.health === 'ok' && thatDay.capUsd === COMMENT_DAILY_USD_CAP.d50 && thatDay.spentUsd === spent, JSON.stringify(thatDay))
    check('🔴 같은 장부를 D30 단계로 재면 DAILY_EXHAUSTED — 지난 날을 오늘 단계로 재면 소급 FAIL 이 난다',
      asD30.health === 'bad' && asD30.codes.includes('DAILY_EXHAUSTED') && asD30.capUsd === COMMENT_DAILY_USD_CAP.base, JSON.stringify(asD30))
    check('🔴 단계 모름(null)은 상한이 비지 않는다 — base 칸 · NO_BUDGET(unknown) 이 아니다',
      unknown.capUsd === COMMENT_DAILY_USD_CAP.base && !unknown.codes.includes('NO_BUDGET'), JSON.stringify(unknown))
    const quiet = readCostSignals(d50Day, 'd50', { SORAN_LLM_DAILY_BUDGET_USD: '1.80', SORAN_AUDIT_LLM_DAILY_BUDGET_USD: '0.30' }, { ...dirs, comment: join(root, 'empty') })
    check('🔴 컨트롤러가 표식 없는 env(예산 키만)로 불러도 댓글 비용 칸은 ok — 빈 장부 · env 기본값',
      quiet.commentLedger.health === 'ok' && quiet.commentLedger.capUsd !== null, JSON.stringify(quiet.commentLedger))
    check('🔴 댓글 단계는 기본값 없는 필수 인자다(now · 단계 · env — dirs 만 기본값)', readCostSignals.length === 3, String(readCostSignals.length))
    rmSync(root, { recursive: true, force: true })

    // 🔴 연결 — 부르는 곳마다 넘기는 단계(판정서 §2.2 표). 함수만 맞고 배선이 오늘 단계를 넘기면 위 반례가 운영에서 다시 난다
    const ctlSrc = readFileSync('scripts/stage-controller.mts', 'utf-8')
    check('🔴 연결: 컨트롤러 하루 증거는 판정하는 그날 결정의 단계(i.stage) · 브레이크 신호는 결정 전 회차의 단계(전날 결정)로 잰다',
      /readCostSignals\(new Date\(`\$\{i\.kstDate\}T12:00:00\+09:00`\), i\.stage\)/.test(ctlSrc)
      && /readCostSignals\(NOW, previous\?\.release \?\? null\)/.test(ctlSrc)
      && (ctlSrc.match(/readCostSignals\(/g) ?? []).length === 2)
    const statusSrc = readFileSync('scripts/ops-status.mts', 'utf-8')
    check('🔴 연결: ops-status 는 읽은 오늘 결정의 단계로 재고 · 못 읽으면 null 과 "단계 미확인"',
      /todayRelease = sd\.found && sd\.result\.ok \? sd\.result\.decision\.release : null/.test(statusSrc)
      && /readCostSignals\(NOW, todayRelease, env\.values\)/.test(statusSrc)
      && /단계 미확인/.test(statusSrc) && (statusSrc.match(/readCostSignals\(/g) ?? []).length === 1)
  }

  /**
   * 공급 비용 증거의 파일 왕복: 그날 정기 회차 전부가 표본이다 — 낮 회차 정산 20건과 밤 회차 미상 1건이
   * 같은 표본·같은 위험액에 들고, 예산은 당시 장부에 기록된 상한으로 판정한다.
   * 회차 시각은 바퀴 표(`SUPPLY_RUN_SLOTS_KST`)에서 계산한다.
   */
  {
    const root = mkdtempSync(join(tmpdir(), 'ops-supply-cost-'))
    const dirs = { supply: join(root, 's'), audit: join(root, 'a'), comment: join(root, 'c') }
    for (const d of Object.values(dirs)) mkdirSync(d)
    const date = '2026-11-05'
    const slotMinutes = SUPPLY_RUN_SLOTS_KST.map((slot) => slot.hour * 60 + slot.minute).sort((a, b) => a - b)
    const daySlot = slotMinutes[Math.floor(slotMinutes.length / 2)]!
    const nightSlot = slotMinutes.at(-1)!
    const windowMinutes = SUPPLY_RUN_WINDOW_MS / 60_000
    /** KST 그날 자정에서 `minute` 분 `second` 초 뒤 */
    const kstAt = (d: string, minute: number, second = 0): Date =>
      new Date(Date.parse(`${d}T00:00:00+09:00`) + minute * 60_000 + second * 1000)
    const labelOf = (d: string, minute: number): string =>
      `${d} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
    // 그날 마지막 회차 창이 끝난 뒤에 읽는다
    const nowOf = (d: string): Date => kstAt(d, Math.min(24 * 60 - 1, nightSlot + windowMinutes + 5))
    const now = nowOf(date)
    /** 낮 회차의 정산 행 · `night` 면 밤(그날 마지막) 회차의 사용량 미상 행 */
    const entry = (i: number, night = false, d = date) => {
      const slotMinute = night ? nightSlot : daySlot
      const slot = labelOf(d, slotMinute)
      return {
        runId: `${supplyRunIdOf(kstAt(d, slotMinute, 2))}-d`, stage: 'draftGen',
        attemptId: night ? 'night-u' : `settled-${i}`, requestNo: i, provider: 'google',
        apiModelId: 'gemini-3.7-flash', model: 'gemini-3.7-flash',
        status: night ? 'usageUnknown' : 'settled', blockCode: null,
        countedInputTokens: 100, maxOutputTokens: 1024, reservedUsd: 0.006,
        inputTokens: night ? null : 100, outputTokens: night ? null : 200,
        cacheWriteTokens: night ? null : 0, cacheReadTokens: night ? null : 0, usageKeys: [],
        settledUsd: night ? null : 0.004, pricingVersion: PRICING_VERSION,
        startedAt: kstAt(d, slotMinute, 30).toISOString(),
        endedAt: kstAt(d, slotMinute + 1).toISOString(),
        errorCode: night ? 'TIMEOUT' : null, runKind: 'scheduled',
        runSlot: slot, budgetDailyUsd: 1.2, budgetCeilingUsd: 1.2, budgetCapUsd: 1.2,
        budgetSource: 'process-override',
        sourceKey: night ? 'src-night' : `src-${i}`, supplyContract: SUPPLY_JIT_CONTRACT,
        runTokenShadow: {
          ok: true, code: null, tokenId: `token-${i}-${night}`, trigger: 'scheduled', launchTrigger: 'scheduled',
          absorbedTrigger: null, absorbedAt: null, pass: 0, budgetWindow: slot,
        },
      }
    }
    const rowsOn = (d: string) => [...Array.from({ length: 20 }, (_, i) => entry(i, false, d)), entry(20, true, d)]
    const rows = rowsOn(date)
    writeFileSync(join(dirs.supply, `${date}.jsonl`), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`)
    // 현재 env를 일부러 당시 장부값과 다르게 둬도 과거 비용 증거의 예산은 장부의 1.20이어야 한다.
    const env = { SORAN_LLM_DAILY_BUDGET_USD: '0.50', SORAN_AUDIT_LLM_DAILY_BUDGET_USD: '0.30' }
    const c = readCostSignals(now, null, env, dirs)
    check('🟢 비용 증거 파일 왕복 — 낮 회차 정산 20건 · 밤 회차 미상 1건도 표본 · 당시 예산 $1.20',
      c.supplyCostEvidence?.envelope.settledRequests === 20
      && c.supplyCostEvidence.envelope.usageUnknownRequests === 1
      && c.supplyCostEvidence.envelope.ineligibleRequests === 0
      && c.supplyCostEvidence.envelope.budgetUsd === 1.2
      && c.supplyCostEvidence.wholeDayCriticalHealth === 'ok',
      JSON.stringify(c.supplyCostEvidence))
    check('🟢 밤 회차 미상의 예약액은 비용 증거 위험액과 whole-day 열린 예약에 같은 금액으로 든다 ($0.080 + $0.006)',
      c.supplyLedger.spentUsd !== null && Math.abs(c.supplyLedger.spentUsd - 0.086) < 1e-9
      && typeof c.supplyCostEvidence?.envelope.riskUsd === 'number'
      && Math.abs(c.supplyCostEvidence.envelope.riskUsd - 0.086) < 1e-9,
      `${JSON.stringify(c.supplyLedger)} ${JSON.stringify(c.supplyCostEvidence)}`)
    check('🟢 whole-day와 비용 증거의 예산은 현재 env $0.50으로 소급 변경되지 않는다',
      c.supplyLedger.capUsd === 1.2 && c.supplyCostEvidence?.envelope.budgetUsd === 1.2)
    writeFileSync(join(dirs.supply, `${date}.jsonl`), '{깨진 공급 장부\n')
    const corrupt = readCostSignals(now, null, env, dirs)
    check('🔴 시행일 이후 공급 장부를 못 읽으면 비용 UNKNOWN으로 약화하지 않고 whole-day hard bad를 보존한다',
      corrupt.supplyLedger.health === 'bad'
      && corrupt.supplyLedger.codes.includes('LEDGER_ERROR')
      && corrupt.supplyCostEvidence?.wholeDayCriticalHealth === 'bad'
      && corrupt.supplyCostEvidence.envelope.riskUsd === null,
      `${JSON.stringify(corrupt.supplyLedger)} ${JSON.stringify(corrupt.supplyCostEvidence)}`)
    writeFileSync(join(dirs.supply, `${date}.jsonl`), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`)
    const mixedCapRows = rows.map((row, i) => i === 0
      ? { ...row, budgetDailyUsd: 0.5, budgetCapUsd: 0.5 }
      : row)
    writeFileSync(join(dirs.supply, `${date}.jsonl`), `${mixedCapRows.map((row) => JSON.stringify(row)).join('\n')}\n`)
    const mixedCap = readCostSignals(now, null, env, dirs)
    check('🟢 하루 중 승인 cap이 달라도 유효한 기록의 가장 큰 cap $1.20으로 whole-day와 비용 증거를 판정한다',
      mixedCap.supplyLedger.health === 'ok' && mixedCap.supplyLedger.capUsd === 1.2
      && mixedCap.supplyCostEvidence?.envelope.budgetUsd === 1.2
      && mixedCap.supplyCostEvidence.envelope.ineligibleRequests === 0,
      `${JSON.stringify(mixedCap.supplyLedger)} ${JSON.stringify(mixedCap.supplyCostEvidence)}`)
    writeFileSync(join(dirs.supply, `${date}.jsonl`), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`)
    const contractlessNightRows = rows.map((row) => row.attemptId === 'night-u'
      ? { ...row, supplyContract: undefined }
      : row)
    writeFileSync(join(dirs.supply, `${date}.jsonl`), `${contractlessNightRows.map((row) => JSON.stringify(row)).join('\n')}\n`)
    const contractlessNight = readCostSignals(now, null, env, dirs)
    check('⬚ 밤 회차 행의 계약 표식이 빠지면 하루 예산(기록 상한)은 유효하지만 비용 표본에서는 조용히 빠지지 않고 귀속 불명 1건이다',
      contractlessNight.supplyLedger.health === 'ok' && contractlessNight.supplyLedger.capUsd === 1.2
      && contractlessNight.supplyCostEvidence?.wholeDayCriticalHealth === 'ok'
      && contractlessNight.supplyCostEvidence.envelope.settledRequests === 20
      && contractlessNight.supplyCostEvidence.envelope.usageUnknownRequests === 0
      && contractlessNight.supplyCostEvidence.envelope.ineligibleRequests === 1,
      `${JSON.stringify(contractlessNight.supplyLedger)} ${JSON.stringify(contractlessNight.supplyCostEvidence)}`)
    const unbudgetedNightRows = rows.map((row) => row.attemptId === 'night-u'
      ? { ...row, budgetSource: undefined }
      : row)
    writeFileSync(join(dirs.supply, `${date}.jsonl`), `${unbudgetedNightRows.map((row) => JSON.stringify(row)).join('\n')}\n`)
    const unbudgetedNight = readCostSignals(now, null, env, dirs)
    check('🔴 밤 회차 행 하나라도 whole-day 예산 provenance가 깨지면 그날 비용 증거를 UNKNOWN으로 닫는다 — 그 행은 표본에서도 귀속 불명',
      unbudgetedNight.supplyLedger.health === 'unknown'
      && unbudgetedNight.supplyLedger.capUsd === null
      && unbudgetedNight.supplyCostEvidence?.wholeDayCriticalHealth === 'unknown'
      && unbudgetedNight.supplyCostEvidence.envelope.settledRequests === 20
      && unbudgetedNight.supplyCostEvidence.envelope.usageUnknownRequests === 0
      && unbudgetedNight.supplyCostEvidence.envelope.ineligibleRequests === 1,
      `${JSON.stringify(unbudgetedNight.supplyLedger)} ${JSON.stringify(unbudgetedNight.supplyCostEvidence)}`)
    const overBudgetNightRows = rows.map((row) => row.attemptId === 'night-u'
      ? { ...row, reservedUsd: 1.15 }
      : row)
    writeFileSync(join(dirs.supply, `${date}.jsonl`), `${overBudgetNightRows.map((row) => JSON.stringify(row)).join('\n')}\n`)
    const overBudgetNight = readCostSignals(now, null, env, dirs)
    const overBudgetEnvelope = overBudgetNight.supplyCostEvidence?.envelope ?? null
    check('🔴 밤 회차 미상으로 총위험($0.08 + $1.15)이 기록 예산 $1.20 을 넘으면 그날 비용 증거를 hard FAIL로 닫는다 — 표본 위험액도 예산을 넘는다',
      overBudgetNight.supplyLedger.health === 'bad'
      && overBudgetNight.supplyCostEvidence?.wholeDayCriticalHealth === 'bad'
      && overBudgetEnvelope !== null
      && overBudgetEnvelope.settledRequests === 20
      && overBudgetEnvelope.usageUnknownRequests === 1
      && overBudgetEnvelope.ineligibleRequests === 0
      && overBudgetEnvelope.riskUsd !== null && overBudgetEnvelope.budgetUsd === 1.2
      && overBudgetEnvelope.riskUsd > overBudgetEnvelope.budgetUsd
      && Math.abs(overBudgetEnvelope.riskUsd - 1.23) < 1e-9,
      `${JSON.stringify(overBudgetNight.supplyLedger)} ${JSON.stringify(overBudgetNight.supplyCostEvidence)}`)
    /** 손 실행 행 — 회차 귀속이 없다. `minute` 는 요청을 보낸 KST 분 */
    const manualRowAt = (minute: number) => ({
      ...entry(30), runId: 'manual-cost-row', attemptId: `manual-cost-row-${minute}`, requestNo: 30,
      runKind: 'manual', runSlot: null, supplyContract: undefined, settledUsd: 0.004,
      startedAt: kstAt(date, minute, 30).toISOString(), endedAt: kstAt(date, minute + 1).toISOString(),
    })
    const manualSeen = [daySlot + 5, nightSlot + 5, nightSlot + windowMinutes + 2].map((minute) => {
      writeFileSync(join(dirs.supply, `${date}.jsonl`), `${[...rows, manualRowAt(minute)].map((row) => JSON.stringify(row)).join('\n')}\n`)
      return readCostSignals(now, null, env, dirs)
    })
    check('⬚ 손 실행 행은 낮 회차 창 · 밤 회차 창 · 마지막 회차 창 뒤 어디서 보냈든 하루 실지출에 남고 비용 표본은 ineligible로 닫는다',
      manualSeen.every((seen) => seen.supplyLedger.health === 'ok'
        && seen.supplyLedger.spentUsd !== null && Math.abs(seen.supplyLedger.spentUsd - 0.090) < 1e-9
        && seen.supplyCostEvidence?.envelope.settledRequests === 20
        && seen.supplyCostEvidence.envelope.usageUnknownRequests === 1
        && seen.supplyCostEvidence.envelope.ineligibleRequests === 1),
      manualSeen.map((seen) => `${JSON.stringify(seen.supplyLedger)} ${JSON.stringify(seen.supplyCostEvidence)}`).join(' | '))
    const missingSourceRows = rows.map((row, i) => i === 0 ? { ...row, budgetSource: undefined } : row)
    writeFileSync(join(dirs.supply, `${date}.jsonl`), `${missingSourceRows.map((row) => JSON.stringify(row)).join('\n')}\n`)
    const missingSource = readCostSignals(now, null, env, dirs)
    check('⬚ current 요청의 기록 예산 출처가 빠지면 현재 env로 대체하지 않고 UNKNOWN',
      missingSource.supplyLedger.health === 'unknown' && missingSource.supplyLedger.capUsd === null
      && missingSource.supplyCostEvidence?.envelope.ineligibleRequests === 1,
      `${JSON.stringify(missingSource.supplyLedger)} ${JSON.stringify(missingSource.supplyCostEvidence)}`)
    const legacyDate = '2026-11-03'
    const legacyRows = rowsOn(legacyDate)
    const legacyNow = nowOf(legacyDate)
    writeFileSync(join(dirs.supply, `${legacyDate}.jsonl`), `${legacyRows.map((row) => JSON.stringify(row)).join('\n')}\n`)
    const legacy = readCostSignals(legacyNow, null, env, dirs)
    check('🟢 시행일 전 whole-day 비용은 옛 env 계약을 유지해 과거 판정을 바꾸지 않는다',
      legacy.supplyLedger.capUsd === 0.5)
    writeSettleHold(dirs.supply, {
      runId: 'future-hold', attemptId: 'future-hold', date,
      reservedUsd: 0.01, at: now.toISOString(), reason: '뒤 날짜 hold',
    })
    const legacyWithFutureHold = readCostSignals(legacyNow, null, env, dirs)
    const currentWithHold = readCostSignals(now, null, env, dirs)
    check('🔴 뒤 날짜 settle hold가 과거 비용 증거를 소급 오염시키지 않지만 hold 당일은 hard bad다',
      legacyWithFutureHold.supplyLedger.health !== 'bad'
      && legacyWithFutureHold.supplyCostEvidence?.wholeDayCriticalHealth !== 'bad'
      && currentWithHold.supplyLedger.health === 'bad'
      && currentWithHold.supplyCostEvidence?.wholeDayCriticalHealth === 'bad',
      `${JSON.stringify(legacyWithFutureHold)} ${JSON.stringify(currentWithHold)}`)
    rmSync(settleHoldPathOf(dirs.supply), { force: true })
    writeSettleHold(dirs.supply, {
      runId: 'old-hold', attemptId: 'old-hold', date: legacyDate,
      reservedUsd: 0.01, at: kstAt(legacyDate, daySlot).toISOString(), reason: '앞 날짜 hold',
    })
    const currentWithOldHold = readCostSignals(now, null, env, dirs)
    check('🔴 대상 날짜 이전부터 풀리지 않은 settle hold는 현재 비용 증거를 hard bad로 닫는다',
      currentWithOldHold.supplyLedger.health === 'bad'
      && currentWithOldHold.supplyCostEvidence?.wholeDayCriticalHealth === 'bad',
      JSON.stringify(currentWithOldHold))
    writeFileSync(settleHoldPathOf(dirs.supply), 'null\n', 'utf-8')
    const legacyWithBrokenHold = readCostSignals(legacyNow, null, env, dirs)
    check('🔴 깨진 settle hold는 날짜를 비교하지 못하므로 과거 비용 증거도 hard bad로 닫는다',
      legacyWithBrokenHold.supplyLedger.health === 'bad'
      && legacyWithBrokenHold.supplyCostEvidence?.wholeDayCriticalHealth === 'bad',
      JSON.stringify(legacyWithBrokenHold))
    rmSync(root, { recursive: true, force: true })
  }

  const prismaLog = [
    'PrismaClientInitializationError: ',
    'Invalid `prisma.originalPostApprovalQueue.findMany()` invocation in',
    '  127   /** 🔴 자동 READY 가 열려 있는가 — 부르는 쪽이 판정해 넘긴다. **기본 닫힘** */',
    '→ 130   const raw = await prisma.originalPostApprovalQueue.findMany(',
    "Can't reach database server at `aws-0-ap-x.pooler.supabase.com:6543`",
    'Please make sure your database server is running at `aws-0-ap-x.pooler.supabase.com:6543`.',
    '    at ei.handleRequestError (/x/RequestHandler.ts:242:13)',
    "  clientVersion: '6.19.3',",
    'Node.js v24.14.0',
  ].join('\n')
  const line = lastFailureLine(prismaLog)
  check('🔴 실패 이유는 원인 문장이다 — 코드 발췌 안의 주석(🔴 …)을 고르지 않는다',
    line !== null && line.startsWith("Can't reach database server") && !line.includes('자동 READY'), String(line))
  check('🔴 실패 이유 줄에서 접속 host 를 지운다', line !== null && !line.includes('supabase.com'), String(line))
  check('이유다운 줄이 없으면 null — 지어내지 않는다', lastFailureLine('회차 done ✅\n정상 종료') === null)
  check('🔴 비밀값 가리기 — 접속 주소 · 키', (() => {
    const r = redactSecrets('postgresql://u:p@h:5432/db sk-abcdefghijk password=hunter2')
    return !r.includes('u:p@h') && !r.includes('abcdefghijk') && !r.includes('hunter2')
  })())
  const base = {
    lane: 'publish' as const, label: 'x', job: 'loaded' as const, lastExitCode: 0, runs: 1,
    lastSuccessAt: '2026-09-28T08:00:00Z', lastSuccessBasis: '', lastFailureAt: null, lastFailureReason: null,
    runtimeSha: null, cost: judgeCost({ uses: false, tally: null, ledgerError: null, settleHold: null, capUsd: null }), notes: [],
  }
  check('레인: 성공이 실패보다 늦으면 ok · 실패가 늦으면 bad · 설치 안 됨 bad · 못 봄 unknown',
    laneHealth(base) === 'ok'
    && laneHealth({ ...base, lastFailureAt: '2026-09-28T09:00:00Z' }) === 'bad'
    && laneHealth({ ...base, job: 'notInstalled' }) === 'bad'
    && laneHealth({ ...base, job: 'unknown' }) === 'unknown'
    && laneHealth({ ...base, lastExitCode: 1 }) === 'bad')
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 단계 controller — 결정 하나가 입력원 · 나쁘면 감속 · 모르면 유지 · 실패면 지금 단계')
// ─────────────────────────────────────────────────────────
const KST = '2026-09-28'
const AT = '2026-09-27T22:10:00.000Z' // 2026-09-28 07:10 KST
/** 🔴 전날 결정 — 정본 validator 를 지난다(v5 · 옛 v4 는 `legacy` 로) */
const prevOf = (release: RuntimeStage, state: 'HOLD' | 'TRIAL' | 'REPROVE' | 'SUSTAIN', o: { legacy?: boolean } = {}): ValidatedStageDecision => {
  const from = previousStage(release)
  const row = {
    kstDate: '2026-09-27', capacity: 'd50', release, state,
    reasons: [], blocks: [], dayPinned: false, supply: null,
    decidedAt: '2026-09-26T22:10:00.000Z', contractVersion: o.legacy === true ? 'stage-decision-v4' : STAGE_DECISION_VERSION,
    decidedBy: 'controller',
    transition: state === 'SUSTAIN' ? { kind: 'SUSTAIN', from, to: release }
      : state === 'TRIAL' ? { kind: 'TRIAL', trialBase: from, previousKstDate: '2026-09-26', target: release, basis: from === 'd1' ? 'FLOOR' : 'PASS' } : null,
  }
  const v = validateStoredDecision({ row, expectKstDate: '2026-09-27' })
  if (!v.ok) throw new Error(`fixture 전날 결정이 깨졌다 — ${v.reason}`)
  return v.decision
}
const OK: HealthSignal[] = [
  { axis: 'quality', health: 'ok', reasons: [] }, { axis: 'cost', health: 'ok', reasons: [] },
  { axis: 'errors', health: 'ok', reasons: [] },
]
const withSignal = (axis: HealthSignal['axis'], health: HealthSignal['health']): HealthSignal[] =>
  OK.map((s) => (s.axis === axis ? { axis, health, reasons: [`${axis} ${health}`] } : s))
function inputs(o: Partial<ControllerInputs>): ControllerInputs {
  const base: ControllerInputs = {
    kstDate: KST, decidedAt: AT, previousDecision: null, previousEvidence: null, nextPreflight: null,
    publishedToday: 0, signals: OK,
  }
  return { ...base, ...o }
}
{
  const first = decideStage(inputs({}))
  check('🔴 첫 실행(전날 결정 없음) — 바닥 d1 · 시험 없음 · PREPARE(다음 증명 d3)',
    first.decision.release === 'd1' && first.decision.state === 'PREPARE' && first.decision.capacity === 'd3' && validateForToday(first.decision).ok,
    `${first.decision.state} ${first.decision.release}`)
  check('🔴 🔴 **controller 입력에 env 단계 · 천장 · 준비도 · 승격 칸이 없다**', (() => {
    const src = readFileSync('src/lib/stage-controller.ts', 'utf-8')
    const t = src.slice(src.indexOf('export type ControllerInputs'), src.indexOf('export type ControllerResult'))
    return !/envRelease|authorizedCeiling|verdicts|daily|promotion/.test(t)
  })())

  for (const axis of ['quality', 'cost', 'errors'] as const) {
    const r = decideStage(inputs({ previousDecision: prevOf('d5', 'HOLD'), signals: withSignal(axis, 'bad') }))
    check(`🔴 ${axis} 나쁨 → 올림 없이 오늘만 한 칸 감속 d5 → d3 · 열린 단계 d5 는 행의 CERTIFIED 칸에 남는다`,
      r.brake === 'slowdown' && r.decision.release === 'd3' && r.decision.state !== 'TRIAL' && r.sustained === 'd5'
      && r.decision.transition?.kind === 'CERTIFIED' && r.decision.transition.certified === 'd5'
      && validateForToday(r.decision).ok, `${r.decision.state} ${r.decision.release}`)
    const validatedBrake = validateStoredDecision({ row: r.decision, expectKstDate: KST })
    if (!validatedBrake.ok) throw new Error(`감속 fixture가 저장 계약을 어긴다 — ${validatedBrake.reason}`)
    const recovered = decideStage({
      ...inputs({}), kstDate: '2026-09-29', decidedAt: '2026-09-28T22:10:00.000Z',
      previousDecision: validatedBrake.decision,
    })
    check(`🔴 ${axis} 일시 감속 다음 날 정상 → 열린 단계 d5를 잃지 않고 d5 운영으로 복귀`,
      recovered.sustained === 'd5' && recovered.decision.release === 'd5',
      `${recovered.sustained} ${recovered.decision.state} ${recovered.decision.release}`)
  }
  const floor = decideStage(inputs({ signals: withSignal('cost', 'bad') }))
  check('감속은 d1 아래로 가지 않는다', floor.decision.release === 'd1' && validateForToday(floor.decision).ok)

  const greenD5 = { stage: 'd5' as const, verdict: 'PASS' as const, codes: [], forecastWarnings: [], warnings: [], counts: {}, costCohort: 'current' }
  const noStreak = decideStage(inputs({ previousDecision: prevOf('d3', 'HOLD'), nextPreflight: greenD5 }))
  check('기준선 — 관문이 초록이어도 연속 통과가 없으면 d3 유지(올리지 않는다)', noStreak.decision.state === 'PREPARE' && noStreak.decision.release === 'd3',
    `${noStreak.decision.state} ${noStreak.decision.release}`)
  const unk = decideStage(inputs({ previousDecision: prevOf('d3', 'HOLD'), nextPreflight: greenD5, signals: withSignal('errors', 'unknown') }))
  check('🔴 신호를 모르는 날도 지금 단계 d3 를 지킨다(내리지 않는다)',
    unk.decision.release === 'd3' && unk.decision.state !== 'TRIAL' && validateForToday(unk.decision).ok,
    `${unk.decision.state} ${unk.decision.release}`)

  const legacy = decideStage(inputs({ previousDecision: prevOf('d5', 'SUSTAIN', { legacy: true }) }))
  check('🔴 🔴 **계약 경계 — 옛 v4 전날 결정(SUSTAIN d5)은 근거가 아니다 → 지속 d1**',
    legacy.sustained === 'd1' && legacy.decision.release !== 'd5', `${legacy.sustained} ${legacy.decision.state} ${legacy.decision.release}`)

  const hold = holdAtCurrent({ kstDate: KST, decidedAt: AT, current: 'd5', reason: 'x' })
  check('controller 실패 → 지금 공개 단계 d5 를 지킨다 · 저장 가능', hold.release === 'd5' && hold.state === 'HOLD' && validateForToday(hold).ok)

  check('열린 단계의 원천 — 없음=d1 · 올린 날(TRIAL)=그 공개 단계(되돌리지 않는다) · 그 밖=전날 공개 · 옛 판=d1',
    openStageOf(null) === 'd1'
    && openStageOf(prevOf('d5', 'TRIAL')) === 'd5'
    && openStageOf(prevOf('d3', 'HOLD')) === 'd3'
    && openStageOf(prevOf('d10', 'REPROVE')) === 'd10'
    && openStageOf(prevOf('d5', 'SUSTAIN', { legacy: true })) === 'd1')

  const pinned = decideStage(inputs({ previousDecision: prevOf('d5', 'HOLD'), publishedToday: 4, signals: withSignal('cost', 'bad') }))
  check('오늘 이미 낸 편수가 낮춘 단계 목표를 넘으면 그날은 고정(사다리 정본 규칙)',
    pinned.decision.dayPinned && pinned.decision.release === 'd5' && validateForToday(pinned.decision).ok)

  check('신호 — 품질: 결함·유실·재시도 실패·시한 초과 중 하나라도 있으면 bad · 못 읽으면 unknown',
    qualitySignalOf({ unresolvedDefects: 0, missingPosts: 0, retryableFailures: 0, overdueAudits: 0 }).health === 'ok'
    && qualitySignalOf({ unresolvedDefects: 1, missingPosts: 0, retryableFailures: 0, overdueAudits: 0 }).health === 'bad'
    && qualitySignalOf({ unresolvedDefects: 0, missingPosts: 0, retryableFailures: 0, overdueAudits: 2 }).health === 'bad'
    && qualitySignalOf(null).health === 'unknown')
  check('신호 — 비용: bad 가 이긴다 · 그다음 unknown',
    costSignalOf([{ name: 'a', health: 'ok', reasons: [] }, { name: 'b', health: 'bad', reasons: ['x'] }]).health === 'bad'
    && costSignalOf([{ name: 'a', health: 'unknown', reasons: [] }, { name: 'b', health: 'ok', reasons: [] }]).health === 'unknown')
  check('신호 — 오류: 실패 bad · load 안 됨/모름 unknown · 전부 정상 ok',
    errorSignalOf([{ label: 'p', loaded: true, failing: true }]).health === 'bad'
    && errorSignalOf([{ label: 'p', loaded: false, failing: null }]).health === 'unknown'
    && errorSignalOf([{ label: 'p', loaded: true, failing: false }]).health === 'ok')

  const cli = readFileSync('scripts/stage-controller.mts', 'utf-8')
  // 배선만 본다 — dry-run 과 flag off 는 저장 호출보다 먼저 return 한다
  check('🔴 저장은 --apply 이면서 flag on 일 때만', (() => {
    const main = cli.slice(cli.indexOf('async function main()'), cli.indexOf('async function computeToday('))
    const dry = main.indexOf('if (!APPLY) {')
    const off = main.indexOf('if (!flagOn) {')
    const save = main.indexOf('return await saveDecision(prisma, computed.decision)')
    return dry >= 0 && off > dry && save > off && (main.match(/saveDecision\(/g) ?? []).length === 1
      && /if \(!APPLY\) \{[\s\S]{0,120}?return 0 \}/.test(main) && /if \(!flagOn\) \{[\s\S]{0,80}?return 0 \}/.test(main)
  })())
  check('🔴 쓰는 길은 ensureStageDecision 하나 — create/update/upsert/delete 직접 호출 0',
    /ensureStageDecision\(/.test(cli) && !/stageDecision\.(create|update|upsert|delete)/.test(cli))
  const mainSrc = cli.slice(cli.indexOf('async function main()'))
  const leaseGate = mainSrc.indexOf('const supplyLease = probeSupplyLease()')
  const dbFill = mainSrc.indexOf('if (!fillDbConnection())')
  const prismaOpen = mainSrc.indexOf('const prisma = new PrismaClient()')
  check('🔴 apply controller는 앞 예약의 busy/unknown에서 DB를 열기 전에 물러나고 마지막 예약은 안전 HOLD를 쓴다',
    leaseGate >= 0 && leaseGate < dbFill && dbFill < prismaOpen
      && /stageControllerLeaseDisposition\(supplyLease, NOW\)/.test(mainSrc)
      && /disposition === 'safe-hold'[\s\S]{0,150}holdForSupplyLease/.test(mainSrc)
      && /supplyLease === 'busy' \? 0 : 1/.test(mainSrc))
  {
    // 🔴 예약 시각은 정본(stageControllerSlots)에서 읽는다 — 01:50 첫 예약 · 02:45 최종
    const kstAt = (minute: number): Date => new Date(Date.parse('2026-10-30T00:00:00+09:00') + minute * 60_000)
    const [first, second] = stageControllerSlots().map((s) => s.hour * 60 + s.minute)
    const FINAL = STAGE_CONTROLLER_FINAL_DECISION_MINUTE_KST
    check('controller lease 순수 판정 — free는 진행 · 마지막 예약 전 busy/unknown은 연기 · 그 뒤에는 늦게 깨어나도 안전 HOLD',
      stageControllerLeaseDisposition('free', kstAt(first!)) === 'proceed'
      && stageControllerLeaseDisposition('busy', kstAt(FINAL - 1)) === 'defer'
      && stageControllerLeaseDisposition('unknown', kstAt(second!)) === 'defer'
      && stageControllerLeaseDisposition('busy', kstAt(FINAL)) === 'safe-hold'
      && stageControllerLeaseDisposition('unknown', kstAt(FINAL + 6)) === 'safe-hold'
      && stageControllerLeaseDisposition('busy', kstAt(FINAL + 21)) === 'safe-hold'
      && FINAL === 2 * 60 + 45)
  }
  const holdStart = cli.indexOf('async function holdForSupplyLease(')
  const holdEnd = cli.indexOf('async function evidenceOnly(', holdStart)
  const holdSrc = holdStart >= 0 && holdEnd > holdStart ? cli.slice(holdStart, holdEnd) : ''
  const safeHoldContract = (src: string): boolean =>
    /validRowOf\(prisma, previousKstDate\(row\.kstDate\)\)/.test(src)
    && /leaseSafeHoldOf\(\{/.test(src)
    && /saveDecision\(prisma, decision\)/.test(src)
    && !/(loadPublishableStock|readPreflightFacts|decideStage|trialPlanOf|nextStage|genericNextStage|auditAwareGate)/.test(src)
    && !/readStageDecision\(prisma, TODAY\)/.test(src)
  // 🔴 공개·인증 값의 정본 증거는 stage-scheduler-check S-CERT(`leaseSafeHoldOf` 동작 반례)다. 여기는 배선만 본다
  const leaseCall = 'const { decision, certified } = leaseSafeHoldOf({'
  check('🔴 lease 안전 HOLD는 전날·이틀 전 결정 행만 `leaseSafeHoldOf` 에 넘기고 오늘 Queue·preflight·올림 계산을 읽지 않는다',
    holdSrc.includes(leaseCall) && safeHoldContract(holdSrc))
  check('🔴 변이 검출 — lease 안전 HOLD가 오늘 Queue를 읽으면 계약 위반',
    !safeHoldContract(holdSrc.replace(leaseCall, `const partial = await loadPublishableStock(prisma)\n    ${leaseCall}`)))
  check('🔴 변이 검출 — lease 안전 HOLD가 오늘 결정을 승격 입력으로 다시 읽으면 계약 위반',
    !safeHoldContract(holdSrc.replace(leaseCall, `const today = await readStageDecision(prisma, TODAY)\n    ${leaseCall}`)))
  // 배선만 본다 — 동작 증거는 stage-scheduler-check S-BLIND(`inputFailureHoldOf` · `leaseSafeHoldOf` 직접 호출)
  check('🔴 입력 실패는 인접 행 여부를 가르는 `inputFailureHoldOf` 로 가고 heldReleaseOf 를 직접 쓰지 않는다',
    /failures\.length > 0[\s\S]{0,300}inputFailureHoldOf\(/.test(cli) && !/heldReleaseOf/.test(cli.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')))
  check('🔴 lease 안전 HOLD는 `authority` 를 넘긴다(전날 행 여부를 호출자가 밝힌다)',
    /leaseSafeHoldOf\(\{[\s\S]{0,200}authority,/.test(holdSrc) && !/previousDecision:/.test(holdSrc))
}

// ─────────────────────────────────────────────────────────
console.log('\n④ consumer — 결정을 러너 env 로 옮긴다')
// ─────────────────────────────────────────────────────────
{
  // 🔴 legacy(flag OFF → 아무것도 넣지 않아 env 파일 단계가 이기던 경로)는 지웠다 — flag OFF 도 d1 이다(Lane A)
  const off = consumerEnvOf({ ok: false, code: 'NO_DECISION', fallback: 'safest', reason: 'flag off' })
  check('🔴 flag OFF → d1 을 명시해서 넣는다 · 표식 없음(env 파일 단계가 이기지 못한다)',
    off.SORAN_RELEASE_STAGE === 'd1' && off.SORAN_CAPACITY_STAGE === 'd1' && off.SORAN_STAGE_DECISION_DATE === '')
  const safest = consumerEnvOf({ ok: false, code: 'BROKEN', fallback: 'safest', reason: '' })
  check('🔴 결정 없음·깨짐 → d1 · canary/window/증명일 키는 아예 없다',
    safest.SORAN_RELEASE_STAGE === 'd1' && safest.SORAN_CAPACITY_STAGE === 'd1'
    && !Object.keys(safest).some((k) => /CANARY|WINDOW|PROOF/.test(k)))
  const d = decideStage(inputs({})).decision
  const v = validateForToday(d)
  const ok = v.ok ? consumerEnvOf({ ok: true, decision: v.decision }) : {}
  check('결정 OK(PREPARE d1) → 공개 d1 · capacity(다음 증명) d3 · 표식 = 결정 날짜 · 결정이 유일한 권한',
    ok.SORAN_RELEASE_STAGE === 'd1' && ok.SORAN_CAPACITY_STAGE === 'd3' && ok.SORAN_STAGE_DECISION_DATE === d.kstDate
    && !Object.keys(ok).some((k) => /CANARY|WINDOW/.test(k)))
  /**
   * 🔴 (2026-09-29 운영 반례) TRIAL d3 결정이 러너에서 준비도 감속으로 d1 이 됐다.
   *    (2026-09-30) 이제 TRIAL 날 공개는 결정의 단계 그대로다 — canary 허가 · 준비도 감속 경로가 없다.
   */
  const trialRow = {
    kstDate: '2026-09-29', contractVersion: STAGE_DECISION_VERSION, capacity: 'd10', release: 'd3', state: 'TRIAL',
    reasons: ['🟢 d3 증명일 — preflight PASS(FLOOR)'], blocks: [], dayPinned: false, supply: null,
    transition: { kind: 'TRIAL', target: 'd3', trialBase: 'd1', previousKstDate: '2026-09-28' },
    decidedBy: 'controller', decidedAt: '2026-09-28T22:00:05.993Z',
  }
  const tv = validateStoredDecision({ row: trialRow, expectKstDate: '2026-09-29' })
  const te = tv.ok ? consumerEnvOf({ ok: true, decision: tv.decision }) : {}
  check('🔴 🔴 **TRIAL 결정 → 공개 = 그 단계 d3 그대로 · canary/증명일 키 없음**',
    tv.ok && te.SORAN_RELEASE_STAGE === 'd3' && !Object.keys(te).some((k) => /CANARY|WINDOW|PROOF/.test(k)),
    JSON.stringify(te))
  check('🔴 🔴 **러너가 그 env 를 d3 · 하루 3건으로 읽는다(09-29 반례 해소)**',
    resolveScale(te).releaseStage === 'd3' && resolveScale(te).releaseProfile.dailyTarget === 3)
  const prepRow = { ...trialRow, state: 'PREPARE', release: 'd1', transition: null, reasons: ['🟢 PREPARE'] }
  const pv = validateStoredDecision({ row: prepRow, expectKstDate: '2026-09-29' })
  const pe = pv.ok ? consumerEnvOf({ ok: true, decision: pv.decision }) : {}
  check('🔴 올린 날과 유지하는 날의 러너 env 는 같은 세 칸이다(단계 둘 + 표식)',
    pv.ok && JSON.stringify(Object.keys(pe).sort()) === JSON.stringify(Object.keys(te).sort()) && Object.keys(pe).length === 3)
  const exec = readFileSync('scripts/stage-consume-exec.mts', 'utf-8')
  check('🔴 consumer 는 DB 를 쓰지 않는다', !/\.(create|update|upsert|delete)\w*\(/.test(exec))
  const loadEnv = readFileSync('scripts/lib/micro-seed-time.mjs', 'utf-8')
  check('🔴 전제: 러너의 loadEnvLocal 은 이미 있는 env 를 덮지 않는다(그래서 감싸기가 이긴다)',
    /if \(process\.env\[m\[1\]\] === undefined\) process\.env\[m\[1\]\] = v/.test(loadEnv))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 템플릿 — keep-awake · controller · 복구')
// ─────────────────────────────────────────────────────────
{
  const ka = renderKeepAwakePlist({ logDir: '/tmp/logs' })
  check('keep-awake 는 /usr/bin/caffeinate -i -s 하나다', ka.includes('<string>/usr/bin/caffeinate</string>')
    && CAFFEINATE_ARGS.join(' ') === '-i -s' && ka.includes(`<string>${KEEP_AWAKE_LABEL}</string>`))
  check('🔴 keep-awake 는 sudo · pmset 쓰기를 하지 않는다', !/sudo|pmset|disablesleep/.test(ka))
  check('keep-awake 는 죽으면 다시 뜨고 로그인 때 잡는다', /<key>KeepAlive<\/key><true\/>/.test(ka) && /<key>RunAtLoad<\/key><true\/>/.test(ka))
  const input = { runtimeRoot: '/r', npxPath: '/n/npx', logDir: '/l', nodeBinDir: '/n' }
  const sc = renderStageControllerPlist(input)
  const slots = stageControllerSlots().map((s) => s.hour * 60 + s.minute)
  // 🔴 (2026-11-23) 결정은 전날이 닫힌 뒤 — 기준(STAGE_DECISION_BASE_MINUTE) 01:50 + [0,20,40,55,58]
  check('🔴 controller 는 01:50 · 02:10 · 02:30 · 02:45(최종) · 02:48(fallback) — 기준 시각에서 · 오름차순 · 다섯 번',
    slots.map(cycleLabel).join(' ') === '01:50 02:10 02:30 02:45 02:48'
    && slots[0] === STAGE_DECISION_BASE_MINUTE && slots.at(-2) === STAGE_CONTROLLER_FINAL_DECISION_MINUTE_KST
    && slots.every((m, i) => i === 0 || m > slots[i - 1]!), slots.map(cycleLabel).join(' '))
  check('🔴 결정 기준은 전날 마지막 바퀴(22:20)의 공개 창이 닫힌 뒤다 — 자정을 넘는 전날 몫이 다 나간 다음',
    STAGE_DECISION_BASE_MINUTE >= cyclePublishWindow(CYCLES.length - 1)!.end - 24 * 60)
  {
    const cal = [...sc.matchAll(/<dict><key>Hour<\/key><integer>(\d+)<\/integer><key>Minute<\/key><integer>(\d+)<\/integer><\/dict>/g)]
      .map((m) => Number(m[1]) * 60 + Number(m[2]))
    check('🔴 controller plist 의 StartCalendarInterval 이 다섯 예약 그대로다(음수 · 24시 넘는 분 없음)',
      JSON.stringify(cal) === JSON.stringify(slots) && cal.every((m) => m >= 0 && m < 24 * 60))
  }
  check('🔴 rollout은 runtime deploy만으로 끝내지 않는다 — ops-loop 설치 계획·적용과 controller 다섯 슬롯 대조가 필수다',
    OPS_LOOP_INSTALL_STEPS.some((s) => s.includes('controller plist 는 아직 갱신되지 않는다'))
    && OPS_LOOP_INSTALL_STEPS.some((s) => s.includes(`${slots.map(cycleLabel).join('·')} 다섯 슬롯 대조`))
    && OPS_LOOP_INSTALL_STEPS.some((s) => s.includes('runtime deploy 만 하고 끝내지 않는다')))
  check('controller 는 runtime 의 스크립트를 --apply 로 부른다', sc.includes('<string>/r/scripts/stage-controller.mts</string>') && sc.includes('<string>--apply</string>')
    && sc.includes('<key>WorkingDirectory</key><string>/r</string>'))
  const rr = renderRunnerRecoverPlist(input)
  check('복구 job 은 StartInterval 로 돈다', /<key>StartInterval<\/key><integer>\d+<\/integer>/.test(rr))
  check('🔴 복구 대상에 수집 job 이 없다(외부 요청 간격은 영구 안전장치)',
    RECOVERABLE_LABELS.every((l) => !/collect/.test(l)) && RUNTIME_JOBS.filter((l) => /collect/.test(l)).every((l) => !RECOVERABLE_LABELS.includes(l)))

  const publishArgs = programArguments(renderPublishHeartbeatPlist(input))
  check('🔴 발행 job 이 stage consumer를 거쳐 기존 heartbeat 인자를 보존한다',
    publishArgs.join(' ') === [
      '/n/npx', 'tsx', `/r/${STAGE_CONSUMER_SCRIPT}`, '--by=publish', '--',
      '/n/npx', 'tsx', '/r/scripts/original-post-auto-publish.mts',
      '--apply', '--limit=1', '--trigger=local', '--heartbeat',
    ].join(' '))
  const markOk = (xml: string): boolean => {
    const env = plistEnvironmentOf(xml)
    return env !== null && env[LAUNCHD_RUN_MARK_KEY] === LAUNCHD_RUN_MARK_VALUE && env[LAUNCHD_LABEL_KEY] === PUBLISH_RUNNER_LABEL
      && judgeLaunchdRunMarker(env).ok
  }
  check('🔴 발행 plist(heartbeat·정시판) 은 EnvironmentVariables 에 실행 표식과 정확한 label 을 명시한다',
    markOk(renderPublishHeartbeatPlist(input)) && markOk(renderPublishRunnerPlist(input)))
  check('🔴 표식 판정: 블록 없음 · 표식 없음 · label 다름 · 값 다름 → 거절',
    !judgeLaunchdRunMarker(null).ok
    && !judgeLaunchdRunMarker({ PATH: '/x' }).ok
    && !judgeLaunchdRunMarker({ [LAUNCHD_RUN_MARK_KEY]: LAUNCHD_RUN_MARK_VALUE, [LAUNCHD_LABEL_KEY]: 'com.soransoran.x' }).ok
    && !judgeLaunchdRunMarker({ [LAUNCHD_RUN_MARK_KEY]: 'manual', [LAUNCHD_LABEL_KEY]: PUBLISH_RUNNER_LABEL }).ok)
  const PRINT_ENV = (inner: string): string => 'gui/501/x = {\n\tinherited environment = {\n'
    + `\t\t${LAUNCHD_RUN_MARK_KEY} => ${LAUNCHD_RUN_MARK_VALUE}\n\t\t${LAUNCHD_LABEL_KEY} => ${PUBLISH_RUNNER_LABEL}\n\t}\n`
    + `\tenvironment = {\n\t\tPATH => /n:/usr/bin\n${inner}\t}\n}`
  check('🔴 loaded 판정은 launchctl 의 environment 블록만 본다 — inherited 에 있는 값은 인정하지 않는다',
    !judgeLaunchdRunMarker(launchctlEnvironmentOf(PRINT_ENV(''))).ok
    && judgeLaunchdRunMarker(launchctlEnvironmentOf(PRINT_ENV(
      `\t\t${LAUNCHD_RUN_MARK_KEY} => ${LAUNCHD_RUN_MARK_VALUE}\n\t\t${LAUNCHD_LABEL_KEY} => ${PUBLISH_RUNNER_LABEL}\n`))).ok
    && launchctlEnvironmentOf(null) === null)
  const supplyTemplate = readFileSync('docs/operations/launchd/com.soransoran.supply-process.plist.template', 'utf-8')
  const supplyArgs = programArguments(supplyTemplate)
  check('🔴 공급 job 이 stage consumer를 거쳐 기존 --live 인자를 보존한다',
    supplyArgs.join(' ') === [
      '__NPX__', 'tsx', '__REPO__/scripts/stage-consume-exec.mts', '--by=supply', '--',
      '__NPX__', 'tsx', '__REPO__/scripts/supply-process.mts', '--live',
    ].join(' '))

  const installer = readFileSync('scripts/ops-loop-install.mts', 'utf-8')
  check('🔴 공식 설치기는 runtime/pin·공급 consumer·실행 중 job을 모두 확인한다',
    /runtime HEAD와 pin/.test(installer) && /samePlist\(installedSupply, expectedSupply\)/.test(installer)
    && /runningBlockers\(touched, running\)/.test(installer)
    && /const touched: string\[\] = \[\.\.\.desired\.keys\(\), \.\.\.\(observerIntent === 'remove' \? \[OPS_SHADOW_OBSERVER_LABEL\] : \[\]\)\]/.test(installer)
    && /for \(const label of touched\) \{/.test(installer))
  // 🔴 observer 는 apply 경로에서도 같은 의도 판정 하나로만 바뀐다 — desired 는 한 번만 만들고 applyInstall 이 그것을 쓴다 ·
  //    제거는 의도가 remove 일 때만 · snapshot 뒤 · 교체 전
  check('🔴 공식 설치기 apply — observer 설치 · 제거는 명시 의도(observerIntentOf)에서만 · desired 한 번 · 제거는 snapshot 뒤',
    (installer.match(/desiredPlists\(/g) ?? []).length === 1
    && /const desired = desiredPlists\(publishMode, input, \{ observer: observerWanted\(observerIntent\), comment: commentInstalled, audit: auditInstalled \}\)/.test(installer)
    && /const commentInstalled = readInstalled\(agentDir, COMMENT_RUNNER_LABEL\) !== null/.test(installer)
    && /const auditInstalled = readInstalled\(agentDir, AUDIT_RUNNER_LABEL\) !== null/.test(installer)
    && /const outcome = applyInstall\(desired, runtimeRoot,/.test(installer)
    && (installer.match(/removeInstalled\(agentDir, OPS_SHADOW_OBSERVER_LABEL\)/g) ?? []).length === 1
    && /if \(observerIntent === 'remove'\) \{\n  bootout\(OPS_SHADOW_OBSERVER_LABEL\)/.test(installer)
    && installer.indexOf("writeFileSync(join(backupDir, 'manifest.json')") < installer.indexOf('removeInstalled(agentDir, OPS_SHADOW_OBSERVER_LABEL)'))
  check('🔴 runtime deploy가 제거한 plist 끝 개행만으로 consumer를 거절하지 않는다',
    /installed\.trimEnd\(\) === expected\.trimEnd\(\)/.test(installer))
  const installCore = readFileSync('scripts/lib/ops-loop-install-core.mts', 'utf-8')
  check('🔴 공식 설치기는 설치 전 snapshot을 남기고 검증 실패면 자동 rollback한다(실행 시험은 ⑧)',
    /manifest\.json/.test(installer) && /설치 검증 실패/.test(installCore)
    && /applyInstall\(desired, runtimeRoot, \{/.test(installer) && /restore: \(\) => restore\(backupDir\),/.test(installer)
    && /process\.exit\(outcome\.restored \? 1 : 2\)/.test(installer))
  {
    // 🔴 D20 rollout 순서 배선 — 설치기는 strict 격리 검사를 **유예 플래그 없이** 붙이고, 실패면 restore 경로로 간다
    const isoWire = /isolation: \(\) => \{\n\s+const iso = run\(npxPath, \['tsx', 'scripts\/runtime-isolation-check\.mts', '--require-runtime'\]\)\n\s+if \(!iso\.ok\) console\.log\(iso\.out\)\n\s+return iso\.ok\n\s+\},/
    check('🔴 공식 설치기는 loaded 검증 뒤 strict runtime:isolation-check --require-runtime 을 붙인다(유예 플래그 0)',
      isoWire.test(installer) && !installer.includes("'--defer-ops-loop-templates'"))
    check('🔴 설치 판정부는 loaded 검증 통과 뒤 io.isolation() 이 false 면 io.restore() 로 되돌린다',
      /const isolated = io\.isolation\(\)/.test(installCore)
      && /if \(isolated\) return \{ ok: true \}\n\s+io\.log\('🔴 strict 격리 검사 실패 — 설치 전 상태로 되돌린다'\)\n\s+return \{ ok: false, restored: io\.restore\(\) \}/.test(installCore)
      && installCore.indexOf('const isolated = io.isolation()') > installCore.indexOf('verifyLoaded(label, xml, io.print(label), runtimeRoot)'))
  }
  check('🔴 공식 설치기는 발행 러너의 렌더 표식과 **loaded** 표식·label 을 둘 다 확인하고, 틀리면 rollback 한다',
    /judgeLaunchdRunMarker\(plistEnvironmentOf\(desired\.get\(PUBLISH_RUNNER_LABEL\)!\)\)/.test(installer)
    && /judgeLaunchdRunMarker\(launchctlEnvironmentOf\(printOut\)\)/.test(installCore)
    && /ok = marker\.ok && ok/.test(installCore)
    && /print: \(label\) => \{\n\s+const p = run\('launchctl', \['print', `\$\{domain\}\/\$\{label\}`\], home\)\n\s+return p\.ok \? p\.out : null/.test(installer))
  const stageSwitch = readFileSync('scripts/stage-controller-switch.mts', 'utf-8')
  check('🔴 단계 스위치는 다른 env 키가 바뀌면 원본으로 되돌린다',
    /othersSame/.test(stageSwitch) && /copyFileSync\(backup, envPath\)/.test(stageSwitch))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 복구 판정')
// ─────────────────────────────────────────────────────────
{
  const now = new Date('2026-09-28T10:00:00Z')
  const base = {
    label: 'x', recoverable: true, state: 'loaded' as const, running: false, lastExitCode: 0,
    lastRunAt: '2026-09-28T09:00:00Z', slots: [[8, 0], [14, 0], [20, 0]] as const, lastRecoveryAt: null, now,
  }
  check('정상 → 건드리지 않는다', judgeRecovery(base).action === 'skip')
  check('마지막 회차 실패 → 한 번 깨운다', judgeRecovery({ ...base, lastExitCode: 1 }).action === 'kickstart')
  check('슬롯 기준 누락 → 깨운다(관제 정본 staleAfterFromSlots)', judgeRecovery({ ...base, lastRunAt: '2026-09-27T08:00:00Z' }).action === 'kickstart')
  check('🔴 같은 창 안에서 이미 깨웠으면 반복하지 않는다', judgeRecovery({ ...base, lastExitCode: 1, lastRecoveryAt: '2026-09-28T09:30:00Z' }).action === 'skip')
  check('🔴 복구 표식을 못 읽으면 깨우지 않는다', judgeRecovery({ ...base, lastExitCode: 1, lastRecoveryAt: 'unreadable' }).action === 'skip')
  check('🔴 모르면 건드리지 않는다 — unknown · unloaded · running · 근거 시각 없음',
    judgeRecovery({ ...base, lastExitCode: 1, state: 'unknown' }).action === 'skip'
    && judgeRecovery({ ...base, lastExitCode: 1, state: 'unloaded' }).action === 'skip'
    && judgeRecovery({ ...base, lastExitCode: 1, running: true }).action === 'skip'
    && judgeRecovery({ ...base, lastRunAt: null }).action === 'skip')
  check('🔴 unknown 은 "load 안 됨" 과 다른 이유로 남긴다 — 못 본 것을 내려간 것으로 적지 않는다',
    /모른다/.test(judgeRecovery({ ...base, lastExitCode: 1, state: 'unknown' }).reason)
    && /load 되어 있지 않다/.test(judgeRecovery({ ...base, lastExitCode: 1, state: 'unloaded' }).reason))
  check('🔴 복구 대상이 아니면(수집) 실패여도 깨우지 않는다', judgeRecovery({ ...base, recoverable: false, lastExitCode: 1 }).action === 'skip')

  // ── 🔴 댓글 러너 — 슬롯 정책 (2026-10-11 Batch A4 · 반례⑬) ──
  const cslots = COMMENT_RUNNER_SLOTS.map((x) => [x.hour, x.minute] as const)
  const kst = (iso: string): Date => new Date(`${iso}+09:00`)
  const at = kst('2026-10-12T10:45:00')
  const due = latestSlotAtOrBefore(cslots, new Date(at.getTime() - RECOVERY_SLOT_GRACE_MS))!
  const cbase = {
    label: COMMENT_RUNNER_LABEL, recoverable: true, state: 'loaded' as const, running: false, lastExitCode: 0,
    lastRunAt: new Date(due.getTime() + 30_000).toISOString(), slots: cslots, lastRecoveryAt: null, now: at, policy: 'slot' as const,
  }
  check('🔴 댓글 러너가 복구 대상이다 · 정책 slot · 기존 넷은 stale 그대로',
    RECOVERABLE_LABELS.includes(COMMENT_RUNNER_LABEL) && RECOVERY_POLICY_OF[COMMENT_RUNNER_LABEL] === 'slot'
    && RECOVERABLE_LABELS.filter((l) => l !== COMMENT_RUNNER_LABEL).every((l) => RECOVERY_POLICY_OF[l] === undefined))
  // 🔴 (2026-11-22) 24시간 격자에서 stale 은 최대 간격 20분 × 2 가 아니라 바닥 3시간이다 — 그래도 60분 계약보다 늦다
  check('🔴 왜 slot 인가 — stale 판정은 댓글 러너에 바닥 3시간이라 60분 첫 댓글 계약에 늦다',
    staleAfterFromSlots(cslots) === 3 * 3_600_000 && staleAfterFromSlots(cslots) > FIRST_COMMENT_MAX_MINUTES * 60_000,
    `${staleAfterFromSlots(cslots)}`)
  check('정상 — 지난 슬롯 뒤 회차가 있었다 → 건드리지 않는다', judgeRecovery(cbase).action === 'skip', judgeRecovery(cbase).reason)
  const missed = { ...cbase, lastRunAt: new Date(due.getTime() - 20 * 60_000).toISOString() }
  check('🔴 실제 누락 — 지난 예약 슬롯 뒤 회차가 없다 → 한 번 깨운다', judgeRecovery(missed).action === 'kickstart', judgeRecovery(missed).reason)
  const again = { ...missed, now: new Date(at.getTime() + 5 * 60_000), lastRecoveryAt: at.toISOString() }
  check('🔴 🔴 반례⑬ 같은 슬롯 창 안에서 다시 감지 → 깨우지 않는다(창마다 최대 1회)', judgeRecovery(again).action === 'skip', judgeRecovery(again).reason)
  const thrice = [0, 1, 2].map((k) => judgeRecovery({ ...missed, now: new Date(at.getTime() + k * 4 * 60_000),
    lastRecoveryAt: k === 0 ? null : at.toISOString() }).action)
  check('🔴 🔴 반례⑬ 한 창에서 감지 3번 → kickstart 정확히 1번', thrice.filter((x) => x === 'kickstart').length === 1, thrice.join(','))
  const nextDue = latestSlotAtOrBefore(cslots, new Date(at.getTime() + 60 * 60_000 - RECOVERY_SLOT_GRACE_MS))!
  check('다음 슬롯 창 — 그 뒤에도 회차가 없으면 그 창에서 다시 한 번 깨울 수 있다',
    nextDue.getTime() > due.getTime()
    && judgeRecovery({ ...missed, now: new Date(at.getTime() + 60 * 60_000), lastRecoveryAt: at.toISOString() }).action === 'kickstart')
  check('🔴 실패 관측(exit 2) → 한 번 · 표식 뒤 같은 창은 skip',
    judgeRecovery({ ...cbase, lastExitCode: 2 }).action === 'kickstart'
    && judgeRecovery({ ...cbase, lastExitCode: 2, lastRecoveryAt: new Date(at.getTime() - 60_000).toISOString() }).action === 'skip')
  check('🔴 슬롯 정책도 모르면 건드리지 않는다 — unknown · unloaded · running · 근거 시각 없음 · 표식 못 읽음',
    judgeRecovery({ ...missed, state: 'unknown' }).action === 'skip' && judgeRecovery({ ...missed, state: 'unloaded' }).action === 'skip'
    && judgeRecovery({ ...missed, running: true }).action === 'skip' && judgeRecovery({ ...cbase, lastRunAt: null }).action === 'skip'
    && judgeRecovery({ ...missed, lastRecoveryAt: 'unreadable' }).action === 'skip')
  // 🔴 (2026-11-22) 24시간 격자 — 밤 공백이 없다. 자정을 넘는 슬롯도 같은 규칙으로 본다
  const afterMidnight = kst('2026-10-12T00:05:00')
  const lastNight = latestSlotAtOrBefore(cslots, afterMidnight)!
  check('🔴 자정 직후는 누락이 아니다 — 00:05 · 어제 23:47 슬롯 뒤 회차 있음 → skip',
    judgeRecovery({ ...cbase, now: afterMidnight, lastRunAt: new Date(lastNight.getTime() + 5_000).toISOString() }).action === 'skip'
    && lastNight.getTime() === kst('2026-10-11T23:47:00').getTime())
  const rr0 = readFileSync('scripts/runner-recover.mts', 'utf-8')
  check('🔴 복구 실행기가 label 의 정책을 판정에 넘긴다', /policy: RECOVERY_POLICY_OF\[label\] \?\? 'stale'/.test(rr0))
  check('🔴 일반 runner-recover 공급 복구는 닫혀 있고 recovery 표식으로 예약 회차를 흉내 내지 않는다',
    /supplyRecoveryClosed = label === SUPPLY_PROCESS_LAUNCHD_LABEL && v\.action === 'kickstart'/.test(rr0)
    && /if \(supplyRecoveryClosed \|\| v\.action !== 'kickstart' \|\| !APPLY\) continue/.test(rr0)
    && !/requestFollowUp\([^)]*'recovery'/.test(rr0) && !/withdrawFollowUp\(/.test(rr0))
  const activeRecovery = readFileSync('src/lib/stage-active-recovery.ts', 'utf-8')
  const controller = readFileSync('scripts/stage-controller.mts', 'utf-8')
  const recoveryWorker = readFileSync('scripts/stage-active-recovery.mts', 'utf-8')
  check('🔴 단계 제한 복구는 공급으로 해소 가능한 기회·처리량 복합 부족만, runtime D20~D50·07:30 전에 연다',
    /'OPPORTUNITY_SHORT', 'OPPORTUNITY_UNKNOWN', 'THROUGHPUT_SHORT'/.test(activeRecovery)
    && /preflight\.codes\.every\(\(code\) => ACTIVE_RECOVERY_SHORTAGE_CODES\.has\(code\)\)/.test(activeRecovery)
    && /badSignals\.length > 0/.test(activeRecovery)
    && /\['d20', 'd30', 'd50'\]/.test(activeRecovery)
    && /ACTIVE_RECOVERY_PAID_CUTOFF_MINUTE_KST/.test(activeRecovery))
  // 배선만 본다. "recovery 산출물이 있는 날 07:55 전 write 0"은 stage:active-recovery-check ⑦이
  // 실제 실행부(runStageRecoveryStep)를 07:00→07:20→07:40→07:55 순서로 돌려 증명한다.
  const recoveryStep = readFileSync('scripts/lib/stage-controller-recovery-step.mts', 'utf-8')
  check('🔴 운영 controller 는 제한 복구를 부르지 않는다(실행부·worker 는 다음 변경에서 지운다)',
    !/runStageRecoveryStep|activeRecoveryPhaseOf|claimStageRecoveryLaunch|createStageRecoveryIntent|stage-active-recovery/.test(controller)
    && /claimStageRecoveryLaunch\(/.test(recoveryStep))
  check('🔴 제한 worker는 기존 수집·공급만 부르고 07:50 종료·07:30 유료 시작 마감을 지킨다',
    /ACTIVE_RECOVERY_MAX_RUNTIME_MS = 50 \* 60_000/.test(activeRecovery)
    && /activeRecoveryDeadlineAt/.test(recoveryWorker)
    && /ACTIVE_RECOVERY_PAID_CUTOFF_MINUTE_KST/.test(recoveryWorker)
    && /micro-seed-collect-navercafe\.mts/.test(recoveryWorker)
    && /supply-process\.mts/.test(recoveryWorker))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 발행 재등록 — 배포 뒤 never exited 는 마지막 실제 회차 기록으로만')
// ─────────────────────────────────────────────────────────
{
  const L = PUBLISH_RUNNER_LABEL
  const pubObs = (print: string | null): JobObservation => {
    const run = parseLaunchdRunInfo(print)
    return { label: L, installed: true, state: print === null ? 'unknown' : 'loaded', stateReason: '', run, launchdFailing: failingFromLaunchd(run) }
  }
  // 판정 — 직전 heartbeat 회차가 판정 9분 전에 끝났고, 그 뒤 배포(재등록)로 launchd 가 종료 값을 잊었다
  const NOW7 = new Date('2026-09-30T01:50:00+09:00')
  const MIN = 60_000
  const ago = (ms: number): Date => new Date(NOW7.getTime() - ms)
  const rec = (exitCode: number, finishedAt: Date = ago(9 * MIN), label = L, startedAt: Date = new Date(finishedAt.getTime() - 55_000)): PublishRunRead => ({
    kind: 'ok', record: { v: 1, label, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), exitCode },
  })
  const pf = (print: string | null, read: PublishRunRead, now = NOW7): boolean | null => publishFailing(pubObs(print), read, now, PUBLISH_RUN_MAX_AGE_MS)
  const supOk = { label: 'com.soransoran.supply-process', loaded: true, failing: false }

  // AS-IS 재현 — 앞판은 launchd 값만 넘겼다. 정상 회차가 있어도 모른다
  const asIs = errorSignalOf([{ label: L, loaded: true, failing: pubObs(PRINT_NEVER).launchdFailing }, supOk])
  check('AS-IS 재현: 재등록 직후(never exited) 발행 job 은 앞판에서 errors=unknown → RUNNER_UNKNOWN', asIs.health === 'unknown', JSON.stringify(asIs))
  const toBe = errorSignalOf([{ label: L, loaded: true, failing: pf(PRINT_NEVER, rec(0)) }, supOk])
  check('🔴 재등록 + 최근 실제 회차 성공 기록 → ok', toBe.health === 'ok', JSON.stringify(toBe))

  check('🔴 재등록 + 기록 없음 → 모름(null)', pf(PRINT_NEVER, { kind: 'missing' }) === null)
  check('🔴 재등록 + 기록 손상 → 모름(null)', pf(PRINT_NEVER, { kind: 'corrupt', reason: 'x' }) === null)
  check('🔴 재등록 + 마지막 회차 실패(exit 1) → 실패(true)', pf(PRINT_NEVER, rec(1)) === true)
  check('🔴 재등록 + 마지막 회차 실행 불가(127) → 실패(true)', pf(PRINT_NEVER, rec(127)) === true)
  check('🔴 재등록 + 오래된 기록(최대 나이 초과) → 모름(null)',
    pf(PRINT_NEVER, rec(0, ago(PUBLISH_RUN_MAX_AGE_MS + MIN))) === null
    && pf(PRINT_NEVER, rec(0), new Date(ago(9 * MIN).getTime() + PUBLISH_RUN_MAX_AGE_MS + MIN)) === null)
  // 🔴 (2026-11-23) 발행 창이 하루 전체라 창 밖 공백은 마지막 틱(23:50) 뒤 10분뿐 — 최대 나이 = 그 공백 + 두 틱 = 30분
  {
    const lastTick = rec(0, new Date('2026-09-29T23:51:00+09:00'))
    check('창 밖 공백 + 두 틱 = 최대 나이 30분 — 23:51 에 끝난 회차를 다음 날 00:20 판정은 읽고 00:22 판정은 모른다',
      PUBLISH_RUN_MAX_AGE_MS === 30 * MIN
      && pf(PRINT_NEVER, lastTick, new Date('2026-09-30T00:20:00+09:00')) === false
      && pf(PRINT_NEVER, lastTick, new Date('2026-09-30T00:22:00+09:00')) === null)
  }
  check('🔴 재등록 + 다른 label 기록(수동 실행 등) → 모름(null)', pf(PRINT_NEVER, rec(0, undefined, 'application.com.x.1')) === null)
  check('🔴 재등록 + 미래에 끝난 기록 → 모름(null)', pf(PRINT_NEVER, rec(0, new Date(NOW7.getTime() + 10 * MIN))) === null)
  check('🔴 재등록 + 끝난 시각이 시작보다 이르다 → 모름(null)', pf(PRINT_NEVER, rec(0, ago(9 * MIN), L, ago(5 * MIN))) === null)
  check('🔴 launchd 가 종료 값을 갖고 있으면 그것이 이긴다 — exit 1 은 성공 기록이 있어도 실패',
    pf(PRINT_FAIL, rec(0)) === true && pf(PRINT_OK, rec(1)) === false)
  check('🔴 launchctl 을 못 읽었으면 성공 기록이 있어도 모름', pf(null, rec(0)) === null)
  check('🔴 재등록 뒤 첫 회차가 돌고 있는 중(runs 1 · never exited)이면 기록으로 채우지 않는다',
    pf('gui/501/x = {\n\tstate = running\n\truns = 1\n\tlast exit code = (never exited)\n}', rec(0)) === null)
  check('🔴 공급 ProcessRun 은 발행 근거가 아니다 — 공급 done 이어도 발행 기록 없음이면 unknown',
    errorSignalOf([{ label: L, loaded: true, failing: pf(PRINT_NEVER, { kind: 'missing' }) }, supOk]).health === 'unknown')

  check('파싱: 깨진 JSON · v 다름 · exitCode 비정수 → corrupt',
    parsePublishRunRecord('{').kind === 'corrupt'
    && parsePublishRunRecord(JSON.stringify({ v: 2, label: L, startedAt: 'a', finishedAt: 'b', exitCode: 0 })).kind === 'corrupt'
    && parsePublishRunRecord(JSON.stringify({ v: 1, label: L, startedAt: 'a', finishedAt: 'b', exitCode: '0' })).kind === 'corrupt'
    && parsePublishRunRecord(null).kind === 'missing')

  // 파일 — 쓰기·읽기 (임시 디렉터리)
  const dir = mkdtempSync(join(tmpdir(), 'pubrun-'))
  try {
    check('파일 없음 → missing', readPublishRunRecord(dir).kind === 'missing')
    const MARK = { [LAUNCHD_RUN_MARK_KEY]: LAUNCHD_RUN_MARK_VALUE, [LAUNCHD_LABEL_KEY]: L }
    const refused = [
      recordPublishRun({ env: {}, startedAt: new Date(), finishedAt: new Date(), exitCode: 0 }, dir),
      recordPublishRun({ env: { XPC_SERVICE_NAME: L }, startedAt: new Date(), finishedAt: new Date(), exitCode: 0 }, dir),
      recordPublishRun({ env: { ...MARK, [LAUNCHD_LABEL_KEY]: 'com.soransoran.supply-process' }, startedAt: new Date(), finishedAt: new Date(), exitCode: 0 }, dir),
      recordPublishRun({ env: { ...MARK, [LAUNCHD_RUN_MARK_KEY]: 'manual' }, startedAt: new Date(), finishedAt: new Date(), exitCode: 0 }, dir),
    ]
    check('🔴 표식 없음 · XPC_SERVICE_NAME 만 · label 다름 · 표식 값 다름 → 남기지 않는다',
      refused.every((r) => !r.written) && readPublishRunRecord(dir).kind === 'missing')
    const t0 = new Date('2026-09-29T13:00:00Z')
    const w = recordPublishRun({ env: MARK, startedAt: t0, finishedAt: new Date(t0.getTime() + 60_000), exitCode: 2 }, dir)
    const back = readPublishRunRecord(dir)
    check('launchd 회차는 남고 그대로 읽힌다', w.written && back.kind === 'ok' && back.record.exitCode === 2 && back.record.label === L, JSON.stringify(back))
    recordPublishRun({ env: {}, startedAt: t0, finishedAt: t0, exitCode: 0 }, dir)
    const kept = readPublishRunRecord(dir)
    check('🔴 수동 성공이 launchd 회차의 실패를 덮지 않는다', kept.kind === 'ok' && kept.record.exitCode === 2)
    writeFileSync(join(dir, 'last.json'), 'garbage')
    check('🔴 손상된 파일 → corrupt', readPublishRunRecord(dir).kind === 'corrupt')
    const dir2 = mkdtempSync(join(tmpdir(), 'pubrun-'))
    mkdirSync(join(dir2, 'last.json'))
    check('🔴 읽을 수 없는 자리(디렉터리) → corrupt(missing 아님)', readPublishRunRecord(dir2).kind === 'corrupt')
    rmSync(dir2, { recursive: true, force: true })
  } finally { rmSync(dir, { recursive: true, force: true }) }

  // 🔴 연결 — wrapper 를 실제로 돌린다. HOME 을 임시로 → 정본 env 없음 → legacy · 기록도 임시 HOME 아래
  const home = mkdtempSync(join(tmpdir(), 'pubrun-home-'))
  const recDir = join(home, 'Library', 'Application Support', 'soransoran', 'publish-runs')
  const MARKED = { [LAUNCHD_RUN_MARK_KEY]: LAUNCHD_RUN_MARK_VALUE, [LAUNCHD_LABEL_KEY]: L }
  const runWrap = (by: string, code: string, extra: Record<string, string>): number | null => {
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home }
    delete env[LAUNCHD_RUN_MARK_KEY]; delete env[LAUNCHD_LABEL_KEY]; delete env.XPC_SERVICE_NAME
    Object.assign(env, extra)
    return spawnSync('npx', ['tsx', 'scripts/stage-consume-exec.mts', `--by=${by}`, '--', process.execPath, '-e', code],
      { env, stdio: ['ignore', 'ignore', 'ignore'] }).status
  }
  try {
    const s1 = runWrap('publish', 'process.exit(3)', MARKED)
    const r1 = readPublishRunRecord(recDir)
    check('🔴 연결: 표식이 정확한 발행 회차 exit 3 → 종료 값 그대로 · 기록 exit 3', s1 === 3 && r1.kind === 'ok' && r1.record.exitCode === 3, `${s1} ${JSON.stringify(r1)}`)
    const s2 = runWrap('publish', 'process.exit(0)', MARKED)
    const r2 = readPublishRunRecord(recDir)
    check('🔴 연결: 다음 회차 exit 0 → 기록 exit 0', s2 === 0 && r2.kind === 'ok' && r2.record.exitCode === 0)
    const unchanged = (): boolean => { const r = readPublishRunRecord(recDir); return r.kind === 'ok' && r.record.exitCode === 0 }
    const s3 = runWrap('publish', 'process.exit(5)', {})
    check('🔴 연결: 일반 수동 실행(표식 없음)은 기록을 바꾸지 않는다 · 종료 값은 그대로', s3 === 5 && unchanged())
    runWrap('publish', 'process.exit(5)', { XPC_SERVICE_NAME: L })
    check('🔴 연결: XPC_SERVICE_NAME 만 있으면 기록하지 않는다 — 암묵 주입에 기대지 않는다', unchanged())
    runWrap('publish', 'process.exit(5)', { ...MARKED, [LAUNCHD_LABEL_KEY]: 'com.soransoran.supply-process' })
    check('🔴 연결: label 이 다르면 기록하지 않는다', unchanged())
    runWrap('publish', 'process.exit(5)', { ...MARKED, [LAUNCHD_RUN_MARK_KEY]: 'manual' })
    check('🔴 연결: 표식 값이 다르면 기록하지 않는다', unchanged())
    rmSync(recDir, { recursive: true, force: true })
    runWrap('supply', 'process.exit(0)', MARKED)
    check('🔴 연결: supply consumer 는 발행 기록을 쓰지 않는다', !existsSync(join(recDir, 'last.json')))
  } finally { rmSync(home, { recursive: true, force: true }) }

  const ctl = readFileSync('scripts/stage-controller.mts', 'utf-8')
  check('🔴 연결: 판정 controller 가 발행 job 을 publishFailing + 회차 기록으로 본다',
    /failing: publishFailing\(pub, readPublishRunRecord\(\), NOW, PUBLISH_RUN_MAX_AGE_MS\)/.test(ctl)
    && !/failing: pub\.launchdFailing/.test(ctl))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 설치기 — keep-awake 만 실행 중 예외 · 적용은 keep-awake 도 내렸다 다시 띄우고, 실패면 전체 rollback')
// ─────────────────────────────────────────────────────────
{
  const KA = KEEP_AWAKE_LABEL
  const OBS = OPS_SHADOW_OBSERVER_LABEL
  const BLOCKING = [PUBLISH_RUNNER_LABEL, STAGE_CONTROLLER_LABEL, RUNNER_RECOVER_LABEL, OBS] as const
  const input = { runtimeRoot: '/r', npxPath: '/n/npx', logDir: '/l', nodeBinDir: '/n' }
  const desired = desiredPlists('fixed', input, { observer: true, comment: false, audit: false })
  check('교체 대상은 발행·controller·복구·keep-awake(+ 설치 의도가 있으면 ops shadow observer) — 모두 같은 적용 · snapshot · rollback 경로를 탄다',
    JSON.stringify([...desired.keys()]) === JSON.stringify([PUBLISH_RUNNER_LABEL, STAGE_CONTROLLER_LABEL, RUNNER_RECOVER_LABEL, KA, OBS])
    && JSON.stringify([...desiredPlists('fixed', input, { observer: false, comment: false, audit: false }).keys()]) === JSON.stringify([PUBLISH_RUNNER_LABEL, STAGE_CONTROLLER_LABEL, RUNNER_RECOVER_LABEL, KA]))
  // 🔴 (2026-11-22) 댓글 러너 — 설치돼 있을 때만 교체 대상(새 원문 = 정본 renderCommentRunnerPlist) · 미설치면 넣지 않는다
  {
    const withComment = desiredPlists('fixed', input, { observer: false, comment: true, audit: false })
    check('🔴 댓글 러너가 설치돼 있으면 교체 대상에 들고 원문은 정본 템플릿 그대로다 · 미설치면 들지 않는다',
      JSON.stringify([...withComment.keys()]) === JSON.stringify([PUBLISH_RUNNER_LABEL, STAGE_CONTROLLER_LABEL, RUNNER_RECOVER_LABEL, KA, COMMENT_RUNNER_LABEL])
      && withComment.get(COMMENT_RUNNER_LABEL) === renderCommentRunnerPlist(input)
      && !desiredPlists('fixed', input, { observer: true, comment: false, audit: false }).has(COMMENT_RUNNER_LABEL))
    check('🔴 댓글 러너 — 배포 quiesce · ops-loop 원문 유예 소유 · 늘 떠 있는 job 아님(회차 중이면 설치기가 막는다)',
      DEPLOY_QUIESCE_JOBS.includes(COMMENT_RUNNER_LABEL) && OPS_LOOP_TEMPLATE_DEFER_LABELS.includes(COMMENT_RUNNER_LABEL)
      && !ALWAYS_RUNNING_LABELS.includes(COMMENT_RUNNER_LABEL) && !RUNTIME_JOBS.includes(COMMENT_RUNNER_LABEL)
      && runningBlockers(withComment.keys(), (l) => l === COMMENT_RUNNER_LABEL).length === 1)
  }
  // 🔴 (2026-11-23) 감사 러너 — 댓글 러너와 같은 꼴: 설치돼 있을 때만 교체 대상(새 원문 = 정본 renderAuditRunnerPlist · 24시간 48회)
  {
    const withAudit = desiredPlists('fixed', input, { observer: false, comment: false, audit: true })
    check('🔴 감사 러너가 설치돼 있으면 교체 대상에 들고 원문은 정본 템플릿(하루 48회) 그대로다 · 미설치면 들지 않는다',
      JSON.stringify([...withAudit.keys()]) === JSON.stringify([PUBLISH_RUNNER_LABEL, STAGE_CONTROLLER_LABEL, RUNNER_RECOVER_LABEL, KA, AUDIT_RUNNER_LABEL])
      && withAudit.get(AUDIT_RUNNER_LABEL) === renderAuditRunnerPlist(input)
      && (withAudit.get(AUDIT_RUNNER_LABEL)!.match(/<key>Hour<\/key>/g) ?? []).length === 48
      && !desiredPlists('fixed', input, { observer: true, comment: true, audit: false }).has(AUDIT_RUNNER_LABEL))
    check('🔴 감사 러너 — 배포 quiesce · ops-loop 원문 유예 소유 · 늘 떠 있는 job 아님(회차 중이면 설치기가 막는다)',
      DEPLOY_QUIESCE_JOBS.includes(AUDIT_RUNNER_LABEL) && OPS_LOOP_TEMPLATE_DEFER_LABELS.includes(AUDIT_RUNNER_LABEL)
      && !ALWAYS_RUNNING_LABELS.includes(AUDIT_RUNNER_LABEL) && !RUNTIME_JOBS.includes(AUDIT_RUNNER_LABEL)
      && runningBlockers(withAudit.keys(), (l) => l === AUDIT_RUNNER_LABEL).length === 1)
  }
  // 🔴 observer 설치 의도 — merge · 배포만으로는 설치되지 않는다(플래그 없으면 지금 상태 유지)
  check('🔴 observer 의도 — 플래그 없음: 설치본 있으면 keep · 없으면 absent · on: install/keep · off: remove/absent · 그 밖은 null',
    observerIntentOf(null, false) === 'absent' && observerIntentOf(null, true) === 'keep'
    && observerIntentOf('on', false) === 'install' && observerIntentOf('on', true) === 'keep'
    && observerIntentOf('off', true) === 'remove' && observerIntentOf('off', false) === 'absent' && observerIntentOf('yes', false) === null
    && !observerWanted('absent') && !observerWanted('remove') && observerWanted('install') && observerWanted('keep'))
  // 🔴 observer 템플릿 계약(2026-11-11 Phase 2) — 60초 StartInterval · 감시(WatchPaths) 0 · 실행 인자 0 · runtime 트리 · 공급 job 아님
  {
    const xml = desired.get(OBS)!
    check('🔴 observer plist — StartInterval 60 · WatchPaths/KeepAlive/RunAtLoad true 0 · 인자는 observer 스크립트뿐 · WD=runtime',
      /<key>StartInterval<\/key><integer>60<\/integer>/.test(xml) && !/WatchPaths|QueueDirectories|KeepAlive|StartCalendarInterval/.test(xml)
      && /<key>RunAtLoad<\/key><false\/>/.test(xml)
      && JSON.stringify(programArguments(xml)) === JSON.stringify(['/n/npx', 'tsx', '/r/scripts/ops-shadow-observer.mts'])
      && /<key>WorkingDirectory<\/key><string>\/r<\/string>/.test(xml))
    check('🔴 observer 는 공급 job(RUNTIME_JOBS) · 복구 대상이 아니고 배포 quiesce · ops-loop 원문 유예 소유에만 든다',
      !RUNTIME_JOBS.includes(OBS) && !RECOVERABLE_LABELS.includes(OBS) && DEPLOY_QUIESCE_JOBS.includes(OBS)
      && OPS_LOOP_TEMPLATE_DEFER_LABELS.includes(OBS) && !ALWAYS_RUNNING_LABELS.includes(OBS))
  }
  check('🔴 예외 정본(호스트 이전 ALWAYS_RUNNING_LABELS)은 keep-awake 하나뿐이다 — 넓히면 여기서 막힌다',
    JSON.stringify(ALWAYS_RUNNING_LABELS) === JSON.stringify([KA]))

  // ── (a)(b) preflight 순수 판정
  const blockersWith = (runningSet: readonly string[]): string[] => runningBlockers(desired.keys(), (l) => runningSet.includes(l))
  check('(a) keep-awake 만 running → 막힘 0', blockersWith([KA]).length === 0)
  for (const label of BLOCKING) {
    const b = blockersWith([label])
    check(`(b) 🔴 ${label} 만 running → 막힘 1(그 job)`, b.length === 1 && b[0]!.startsWith(label), JSON.stringify(b))
  }
  const mixed = blockersWith([KA, PUBLISH_RUNNER_LABEL])
  check('(b) keep-awake + 발행 running → 발행 하나만 막는다(keep-awake 는 이유로 적지 않는다)',
    mixed.length === 1 && mixed[0]!.startsWith(PUBLISH_RUNNER_LABEL) && !mixed.some((m) => m.includes(KA)))

  // ── (a)(b) 실제 설치기(plan) 실행 — 임시 HOME · PATH 에는 가짜 launchctl(print 만 답한다)과 git·cat 만
  const which = (cmd: string): string | null => {
    const r = spawnSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' })
    return r.status === 0 && r.stdout.trim() !== '' ? r.stdout.trim() : null
  }
  const gitBin = which('git')
  const catBin = which('cat')
  const npxBesideNode = join(dirname(process.execPath), 'npx')
  if (gitBin === null || catBin === null || !existsSync(npxBesideNode)) {
    check('설치기 plan 실행 준비(git·cat·node 옆 npx)', false, `git=${gitBin} cat=${catBin} npx=${existsSync(npxBesideNode)}`)
  } else {
    const home = mkdtempSync(join(tmpdir(), 'ops-loop-install-'))
    try {
      const rt = join(home, 'Documents', 'soransoran-runtime')
      const tplRel = 'docs/operations/launchd/com.soransoran.supply-process.plist.template'
      mkdirSync(join(rt, 'docs', 'operations', 'launchd'), { recursive: true })
      writeFileSync(join(rt, tplRel), readFileSync(tplRel, 'utf-8'))
      const git = (args: string[]): string => {
        const r = spawnSync(gitBin, ['-c', 'user.name=check', '-c', 'user.email=check@example.invalid', '-c', 'commit.gpgsign=false', ...args],
          { cwd: rt, encoding: 'utf8', env: { ...process.env, HOME: home } })
        return r.stdout.trim()
      }
      git(['init', '-q'])
      git(['add', tplRel])
      git(['commit', '-q', '-m', 'fixture'])
      const canon = join(home, 'Library', 'Application Support', 'soransoran')
      mkdirSync(canon, { recursive: true })
      writeFileSync(join(canon, 'runtime-pinned-sha'), `${git(['rev-parse', 'HEAD'])}\n`)
      const logDir = join(home, 'Library', 'Logs', 'soransoran')
      const nodeBinDir = dirname(process.execPath)
      const agentDir = join(home, 'Library', 'LaunchAgents')
      mkdirSync(agentDir, { recursive: true })
      writeFileSync(join(agentDir, `${PUBLISH_RUNNER_LABEL}.plist`),
        desiredPlists('fixed', { runtimeRoot: rt, npxPath: npxBesideNode, logDir, nodeBinDir }, { observer: false, comment: false, audit: false }).get(PUBLISH_RUNNER_LABEL)!)
      writeFileSync(join(agentDir, 'com.soransoran.supply-process.plist'), render(readFileSync(tplRel, 'utf-8'), {
        npx: npxBesideNode, node: process.execPath, repo: rt, nodebin: nodeBinDir, logdir: logDir,
      }))
      const bin = join(home, 'fake-bin')
      mkdirSync(bin)
      symlinkSync(gitBin, join(bin, 'git'))
      symlinkSync(catBin, join(bin, 'cat'))
      // 🔴 print 만 답한다 — bootout·bootstrap 등 다른 하위 명령은 기록만 하고 실패한다(plan 은 부르지 않아야 한다)
      writeFileSync(join(bin, 'launchctl'), [
        '#!/bin/sh',
        'echo "$*" >> "$FAKE_LAUNCHCTL_LOG"',
        'if [ "$1" = print ]; then',
        '  label="${2##*/}"',
        '  case " $FAKE_RUNNING " in *" $label "*) printf \'%s = {\\n\\tstate = running\\n}\\n\' "$2"; exit 0;; esac',
        '  printf \'%s = {\\n\\tstate = not running\\n}\\n\' "$2"; exit 0',
        'fi',
        'exit 1',
        '',
      ].join('\n'), { mode: 0o755 })
      const callLog = join(home, 'launchctl.log')
      const tsxCli = createRequire(import.meta.url).resolve('tsx/cli')
      const installerPath = join(process.cwd(), 'scripts', 'ops-loop-install.mts')
      // 기존 시험은 observer 설치 의도(--observer=on)를 명시한 판으로 돈다 — 기본 경로는 아래에서 따로 잰다
      const plan = (runningSet: readonly string[], args: readonly string[] = ['--observer=on']): { status: number | null; out: string } => {
        const r = spawnSync(process.execPath, [tsxCli, installerPath, ...args], {
          cwd: rt, encoding: 'utf8',
          env: { HOME: home, PATH: bin, FAKE_RUNNING: runningSet.join(' '), FAKE_LAUNCHCTL_LOG: callLog },
        })
        return { status: r.status, out: `${r.stdout}${r.stderr}` }
      }
      const idle = plan([])
      check('설치기 plan: 아무것도 안 돌면 적용 가능(fixture 가 막힘 0 인 정상 호스트다)',
        idle.status === 0 && idle.out.includes('🟢 적용 가능'), idle.out.slice(-600))
      const ka = plan([KA])
      check('(a) 🔴 설치기 plan: keep-awake 만 running → 🟢 적용 가능 · exit 0',
        ka.status === 0 && ka.out.includes('🟢 적용 가능') && !ka.out.includes('실행 중이다'), ka.out.slice(-600))
      for (const label of BLOCKING) {
        const r = plan([label])
        check(`(b) 🔴 설치기 plan: ${label} 만 running → 막힘 1건 · exit 1`,
          r.status === 1 && r.out.includes(`${label}이 실행 중이다`) && r.out.includes('🔴 막힘 1건'), r.out.slice(-600))
      }
      const all = plan([KA, ...BLOCKING])
      check(`(b) 설치기 plan: 다섯 다 running → 막힘 ${BLOCKING.length}건(keep-awake 제외 · observer 포함)`,
        all.status === 1 && all.out.includes(`🔴 막힘 ${BLOCKING.length}건`) && all.out.includes(`${OBS}이 실행 중이다`) && !all.out.includes(`${KA}이 실행 중이다`), all.out.slice(-600))
      // 🔴 기본 경로(플래그 없음) — code-only merge 뒤 배포의 필수 ops-loop-install 이 observer 를 설치하지 않는다
      const obsLine = (out: string): string => out.split('\n').find((l) => l.includes(OBS)) ?? ''
      const dflt = plan([], [])
      check('🔴 설치기 plan · 플래그 없음 · observer 미설치 → 미설치 유지(교체 대상 아님) · 적용 가능',
        dflt.status === 0 && obsLine(dflt.out).includes('미설치 유지') && !/신규|교체|최신/.test(obsLine(dflt.out)), dflt.out.slice(-600))
      check('🔴 설치기 plan · 플래그 없음 · observer 미설치면 observer 가 돌고 있어도 막지 않는다(교체 대상 아님)',
        plan([OBS], []).status === 0)
      const on = plan([], ['--observer=on'])
      check('설치기 plan · --observer=on · 미설치 → 신규', on.status === 0 && obsLine(on.out).includes('신규'), on.out.slice(-400))
      check('설치기 plan · --observer 에 on/off 밖의 값 → exit 2', plan([], ['--observer=yes']).status === 2)
      const obsInstalled = join(agentDir, `${OBS}.plist`)
      writeFileSync(obsInstalled, desiredPlists('fixed', { runtimeRoot: rt, npxPath: npxBesideNode, logDir, nodeBinDir }, { observer: true, comment: false, audit: false }).get(OBS)!)
      const keep = plan([], [])
      check('🔴 설치기 plan · 플래그 없음 · observer 설치돼 있으면 keep(새 원문 대조 · 최신)', keep.status === 0 && obsLine(keep.out).includes('최신'), keep.out.slice(-400))
      const off = plan([], ['--observer=off'])
      check('🔴 설치기 plan · --observer=off · 설치돼 있으면 제거 계획(교체 대상 아님) · 계획은 아무것도 바꾸지 않는다',
        off.status === 0 && obsLine(off.out).includes('제거') && existsSync(obsInstalled), off.out.slice(-400))
      check('🔴 설치기 plan · --observer=off 여도 observer 가 돌고 있으면 막는다', plan([OBS], ['--observer=off']).status === 1)
      rmSync(obsInstalled)
      // 🔴 (2026-11-23) 감사 러너 — 미설치면 교체하지 않고 계획 줄에 "미설치" 를 남긴다(조용히 건너뛰지 않는다) ·
      //    옛 원문으로 설치돼 있으면 교체 대상 · 회차가 돌고 있으면 막는다
      const auditLine = (out: string): string => out.split('\n').find((l) => l.includes(AUDIT_RUNNER_LABEL)) ?? ''
      check('🔴 설치기 plan · 감사 러너 미설치 → "미설치" 줄 · 교체 대상 아님 · 적용 가능',
        dflt.status === 0 && auditLine(dflt.out).includes('미설치') && !/신규|교체|최신/.test(auditLine(dflt.out)), dflt.out.slice(-600))
      const auditInstalledPath = join(agentDir, `${AUDIT_RUNNER_LABEL}.plist`)
      writeFileSync(auditInstalledPath, renderAuditRunnerPlist({ runtimeRoot: rt, npxPath: npxBesideNode, logDir, nodeBinDir })
        .replace('<key>RunAtLoad</key>', '<!-- 옛 예약표 -->\n    <key>RunAtLoad</key>'))
      const auditPlan = plan([], [])
      check('🔴 설치기 plan · 감사 러너가 옛 원문으로 설치돼 있으면 교체 대상 · 적용 가능',
        auditPlan.status === 0 && auditLine(auditPlan.out).includes('교체'), auditPlan.out.slice(-600))
      check('🔴 설치기 plan · 감사 러너 회차가 돌고 있으면 막는다(교체 대상이라서)', plan([AUDIT_RUNNER_LABEL], []).status === 1)
      rmSync(auditInstalledPath)
      const calls = existsSync(callLog) ? readFileSync(callLog, 'utf-8').trim().split('\n') : []
      check('🔴 plan 은 가짜 launchctl 을 실제로 불렀고(print) 그 밖의 하위 명령은 0이다',
        calls.length > 0 && calls.every((c) => c.startsWith('print ')), calls.slice(0, 5).join(' | '))
    } finally { rmSync(home, { recursive: true, force: true }) }
  }

  // ── (c)(d) 적용 경로 — launchd 를 흉내 내는 io. 🔴 실제처럼: bootout 하면 내려가고, 이미 loaded 인 것을
  //    bootstrap 하면 실패하고(launchctl: service already loaded), print 는 loaded 인 plist 그대로를 보여 준다.
  const printOf = (label: string, xml: string): string => {
    const args = programArguments(xml)
    const wd = valueOf(xml, 'WorkingDirectory')
    const env = plistEnvironmentOf(xml) ?? {}
    return `gui/501/${label} = {\n\tactive count = 1\n\tstate = running\n\tprogram = ${args[0] ?? ''}\n`
      + `\targuments = {\n${args.map((a) => `\t\t${a}\n`).join('')}\t}\n\n`
      + (wd === null ? '' : `\tworking directory = ${wd}\n\n`)
      + `\tenvironment = {\n${Object.entries(env).map(([k, v]) => `\t\t${k} => ${v}\n`).join('')}\t}\n}`
  }
  type Sim = { calls: string[]; restores: number; loaded: Map<string, string> }
  const simulate = (opt: {
    failBootstrap?: string; printOverride?: (label: string, out: string | null) => string | null; restoreOk?: boolean
    isolationOk?: boolean
  } = {}): { outcome: ReturnType<typeof applyInstall>; sim: Sim } => {
    const old = desiredPlists('heartbeat', input, { observer: true, comment: false, audit: false })
    const sim: Sim = { calls: [], restores: 0, loaded: new Map(old) }
    const written = new Map(old)
    const outcome = applyInstall(desired, '/r', {
      bootout: (l) => { sim.calls.push(`bootout ${l}`); sim.loaded.delete(l) },
      write: (l, x) => { sim.calls.push(`write ${l}`); written.set(l, x); return true },
      lint: () => true,
      bootstrap: (l) => {
        sim.calls.push(`bootstrap ${l}`)
        if (sim.loaded.has(l) || opt.failBootstrap === l) return false
        sim.loaded.set(l, written.get(l)!)
        return true
      },
      print: (l) => {
        const x = sim.loaded.get(l)
        const out = x === undefined ? null : printOf(l, x)
        return opt.printOverride === undefined ? out : opt.printOverride(l, out)
      },
      isolation: () => { sim.calls.push('isolation'); return opt.isolationOk ?? true },
      restore: () => { sim.calls.push('restore'); sim.restores += 1; return opt.restoreOk ?? true },
      log: () => {},
    })
    return { outcome, sim }
  }
  const good = simulate()
  const idx = (c: string): number => good.sim.calls.indexOf(c)
  check('(c) 🔴 적용 성공: keep-awake 를 내렸다가 다시 띄우고(loaded · caffeinate 인자) rollback 은 부르지 않는다',
    good.outcome.ok && good.sim.restores === 0
    && idx(`bootout ${KA}`) >= 0 && idx(`bootstrap ${KA}`) > idx(`bootout ${KA}`)
    && JSON.stringify(programArguments(good.sim.loaded.get(KA) ?? '')) === JSON.stringify(programArguments(desired.get(KA)!)),
    good.sim.calls.join(' | '))
  const lastOf = (kind: string): number => Math.max(...[...desired.keys()].map((l) => idx(`${kind} ${l}`)))
  const firstOf = (kind: string): number => Math.min(...[...desired.keys()].map((l) => idx(`${kind} ${l}`)))
  check('(c) 순서: 넷 다 bootout → 넷 다 교체 → 넷 다 bootstrap',
    firstOf('bootout') >= 0 && lastOf('bootout') < firstOf('write') && lastOf('write') < firstOf('bootstrap'))
  check('(c) 발행 러너도 heartbeat → fixed 로 실제 교체돼 loaded 인자가 새 plist 다',
    JSON.stringify(programArguments(good.sim.loaded.get(PUBLISH_RUNNER_LABEL) ?? '')) === JSON.stringify(programArguments(desired.get(PUBLISH_RUNNER_LABEL)!)))

  const rolledBack = (r: ReturnType<typeof simulate>): boolean => !r.outcome.ok && r.outcome.restored && r.sim.restores === 1
  check('(d) 🔴 keep-awake 재기동(bootstrap) 실패 → 전체 rollback', rolledBack(simulate({ failBootstrap: KA })))
  check('(d) 🔴 keep-awake 가 bootstrap 뒤 loaded 로 안 보임 → 전체 rollback',
    rolledBack(simulate({ printOverride: (l, out) => (l === KA ? null : out) })))
  check('(d) 🔴 keep-awake loaded 인자가 caffeinate 가 아님 → 전체 rollback',
    rolledBack(simulate({ printOverride: (l, out) => (l === KA && out !== null ? out.replace('\t\t-s\n', '') : out) })))
  check('(d) 🔴 발행 러너 bootstrap 실패 → 전체 rollback', rolledBack(simulate({ failBootstrap: PUBLISH_RUNNER_LABEL })))
  check('(d) 🔴 발행 러너 loaded 실행 표식 없음 → 전체 rollback',
    rolledBack(simulate({ printOverride: (l, out) => (l === PUBLISH_RUNNER_LABEL && out !== null ? out.replace(`\t\t${LAUNCHD_RUN_MARK_KEY} => ${LAUNCHD_RUN_MARK_VALUE}\n`, '') : out) })))
  check('(d) 🔴 controller 작업 경로가 runtime 이 아님 → 전체 rollback',
    rolledBack(simulate({ printOverride: (l, out) => (l === STAGE_CONTROLLER_LABEL && out !== null ? out.replace('working directory = /r', 'working directory = /elsewhere') : out) })))
  const restoreFail = simulate({ failBootstrap: KA, restoreOk: false })
  check('(d) rollback 자체가 실패하면 restored=false 로 알린다(설치기는 exit 2)',
    !restoreFail.outcome.ok && !restoreFail.outcome.restored && restoreFail.sim.restores === 1)

  // ── (e) 🔴 D20 rollout 순서 — loaded 검증 뒤 strict 격리 검사 · 실패면 snapshot 복원 ──
  check('(e) 🔴 strict 격리 true → 설치 성공 · rollback 0 · 격리 검사는 정확히 한 번',
    good.outcome.ok && good.sim.restores === 0 && good.sim.calls.filter((c) => c === 'isolation').length === 1)
  check('(e) 🔴 strict 격리는 **모든 bootstrap 뒤**에 돈다(loaded 검증 다음)',
    idx('isolation') > lastOf('bootstrap'))
  {
    const isoFail = simulate({ isolationOk: false })
    check('(e) 🔴 strict 격리 false → 전체 rollback(snapshot 복원) · 설치 실패',
      rolledBack(isoFail) && isoFail.sim.calls.indexOf('restore') > isoFail.sim.calls.indexOf('isolation'))
    const isoFailRestoreFail = simulate({ isolationOk: false, restoreOk: false })
    check('(e) 🔴 strict 격리 false + rollback 실패 → restored=false(설치기는 exit 2)',
      !isoFailRestoreFail.outcome.ok && !isoFailRestoreFail.outcome.restored && isoFailRestoreFail.sim.restores === 1)
    const loadedFail = simulate({ failBootstrap: KA })
    check('(e) loaded 검증이 이미 실패하면 격리 검사 없이 바로 rollback 한다(잴 것이 없다)',
      rolledBack(loadedFail) && !loadedFail.sim.calls.includes('isolation'))
  }
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 이 검사는 DB·네트워크·launchctl·provider 를 쓰지 않는다.')
if (fail > 0) process.exit(1)
