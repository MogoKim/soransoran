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
import { readCostSignals } from './lib/ops-signals.mjs'

import {
  parseLaunchdRunInfo, failingFromLaunchd, failingFromProcessRuns, combineFailing, collectCapabilityFailing,
} from '../src/lib/job-health'
import { runnerFactsOf, capabilityFactsReady } from '../src/lib/d100-readiness'
import { judgeCost, lastFailureLine, redactSecrets, laneHealth } from '../src/lib/ops-status'
import {
  decideStage, holdAtCurrent, previousStage, sustainedReleaseOf, consumerEnvOf, validateForToday,
  qualitySignalOf, costSignalOf, errorSignalOf, type HealthSignal, type ControllerInputs,
} from '../src/lib/stage-controller'
import { STAGE_DECISION_VERSION, validateStoredDecision, type ValidatedStageDecision } from '../src/lib/stage-decision-contract'
import { type RuntimeStage } from '../src/lib/scale-profile'
import { resolveScale } from '../src/lib/scale-runtime'
import { PROOF_STAGE_ENV } from '../src/lib/stage-proof-day'
import { judgeRecovery } from '../src/lib/runner-recovery'
import { publishFailing, supplyFailing, type JobObservation } from './lib/runner-health.mjs'
import { PUBLISH_RUN_MAX_AGE_MS, readPublishRunRecord, recordPublishRun } from './lib/publish-run-record.mjs'
import { parsePublishRunRecord, type PublishRunRead } from '../src/lib/job-health'
import {
  renderKeepAwakePlist, renderStageControllerPlist, renderRunnerRecoverPlist, stageControllerSlots,
  RECOVERABLE_LABELS, CAFFEINATE_ARGS, KEEP_AWAKE_LABEL, STAGE_CONTROLLER_LABEL, RUNNER_RECOVER_LABEL,
} from './lib/ops-loop-templates'
import { applyInstall, desiredPlists, runningBlockers } from './lib/ops-loop-install-core.mjs'
import { ALWAYS_RUNNING_LABELS } from './lib/host-migrate.mjs'
import { PUBLISH_WINDOW_START_MINUTE } from '../src/lib/publish-slot-catchup'
import { RUNTIME_JOBS } from '../src/lib/runtime-isolation'
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
  const done = [{ runId: 'a', startedAt: '2026-09-28T08:00:00Z', status: 'done', completedAt: null, runtimeSha: null, failedStages: [] }]
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
    const c = readCostSignals(now, env, dirs)
    check('🔴 댓글 장부 초과 지출을 댓글 축이 본다 (공급 장부가 아니라 전용 장부)',
      c.commentLedger.health === 'bad' && c.commentLedger.codes.includes('DAILY_EXHAUSTED') && c.commentLedger.spentUsd === 0.25)
    check('🔴 댓글 상한은 댓글 계약값 $0.20 이다 (env 미설정 → 기본값)', c.commentLedger.capUsd === 0.2)
    check('댓글 지출이 공급 축을 오염시키지 않는다', c.supplyLedger.spentUsd === 0 && c.supplyLedger.health !== 'bad')
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
    check(`🔴 ${axis} 나쁨 → 시험 없이 한 칸 감속 d5 → d3`,
      r.brake === 'slowdown' && r.decision.release === 'd3' && r.decision.state !== 'TRIAL' && r.decision.transition === null
      && validateForToday(r.decision).ok, `${r.decision.state} ${r.decision.release}`)
  }
  const floor = decideStage(inputs({ signals: withSignal('cost', 'bad') }))
  check('감속은 d1 아래로 가지 않는다', floor.decision.release === 'd1' && validateForToday(floor.decision).ok)

  const unk = decideStage(inputs({ previousDecision: prevOf('d3', 'HOLD'), signals: withSignal('errors', 'unknown') }))
  check('🔴 신호를 모르면 증명일(REPROVE)도 되돌리고 지금 단계 d3 를 지킨다(내리지도 않는다)',
    unk.brake === 'holdUnknown' && unk.decision.release === 'd3' && unk.decision.state !== 'REPROVE' && validateForToday(unk.decision).ok,
    `${unk.decision.state} ${unk.decision.release}`)

  const legacy = decideStage(inputs({ previousDecision: prevOf('d5', 'SUSTAIN', { legacy: true }) }))
  check('🔴 🔴 **계약 경계 — 옛 v4 전날 결정(SUSTAIN d5)은 근거가 아니다 → 지속 d1**',
    legacy.sustained === 'd1' && legacy.decision.release !== 'd5', `${legacy.sustained} ${legacy.decision.state} ${legacy.decision.release}`)

  const hold = holdAtCurrent({ kstDate: KST, decidedAt: AT, current: 'd5', reason: 'x' })
  check('controller 실패 → 지금 공개 단계 d5 를 지킨다 · 저장 가능', hold.release === 'd5' && hold.state === 'HOLD' && validateForToday(hold).ok)

  check('지속 공개 단계의 원천 — 없음=d1 · TRIAL(PASS 없음)=기반 · 그 밖=전날 공개 · 옛 판=d1',
    sustainedReleaseOf(null) === 'd1'
    && sustainedReleaseOf(prevOf('d5', 'TRIAL')) === 'd3'
    && sustainedReleaseOf(prevOf('d3', 'HOLD')) === 'd3'
    && sustainedReleaseOf(prevOf('d10', 'REPROVE')) === 'd10'
    && sustainedReleaseOf(prevOf('d5', 'SUSTAIN', { legacy: true })) === 'd1')

  const pinned = decideStage(inputs({ previousDecision: prevOf('d5', 'HOLD'), publishedToday: 4, signals: withSignal('cost', 'bad') }))
  check('오늘 이미 낸 편수가 낮춘 단계 목표를 넘으면 그날은 고정(사다리 정본 규칙)',
    pinned.decision.dayPinned && pinned.decision.release === 'd5' && validateForToday(pinned.decision).ok)

  check('신호 — 품질: 결함·유실·재시도 실패·시한 초과 중 하나라도 있으면 bad · 못 읽으면 unknown',
    qualitySignalOf({ confirmedDefects: 0, missingPosts: 0, retryableFailures: 0, overdueAudits: 0 }).health === 'ok'
    && qualitySignalOf({ confirmedDefects: 1, missingPosts: 0, retryableFailures: 0, overdueAudits: 0 }).health === 'bad'
    && qualitySignalOf({ confirmedDefects: 0, missingPosts: 0, retryableFailures: 0, overdueAudits: 2 }).health === 'bad'
    && qualitySignalOf(null).health === 'unknown')
  check('신호 — 비용: bad 가 이긴다 · 그다음 unknown',
    costSignalOf([{ name: 'a', health: 'ok', reasons: [] }, { name: 'b', health: 'bad', reasons: ['x'] }]).health === 'bad'
    && costSignalOf([{ name: 'a', health: 'unknown', reasons: [] }, { name: 'b', health: 'ok', reasons: [] }]).health === 'unknown')
  check('신호 — 오류: 실패 bad · load 안 됨/모름 unknown · 전부 정상 ok',
    errorSignalOf([{ label: 'p', loaded: true, failing: true }]).health === 'bad'
    && errorSignalOf([{ label: 'p', loaded: false, failing: null }]).health === 'unknown'
    && errorSignalOf([{ label: 'p', loaded: true, failing: false }]).health === 'ok')

  const cli = readFileSync('scripts/stage-controller.mts', 'utf-8')
  check('🔴 저장은 --apply 이면서 flag on 일 때만', /if \(!APPLY\)[\s\S]{0,200}return 0/.test(cli) && /if \(!flagOn\)[\s\S]{0,200}return 0/.test(cli))
  check('🔴 쓰는 길은 ensureStageDecision 하나 — create/update/upsert/delete 직접 호출 0',
    /ensureStageDecision\(/.test(cli) && !/stageDecision\.(create|update|upsert|delete)/.test(cli))
  check('🔴 입력 실패는 holdAtCurrent 로 간다', /failures\.length > 0[\s\S]{0,200}holdAtCurrent/.test(cli))
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
  check('🔴 결정 없음·깨짐 → d1 · 증명일 빈 값 · canary/window 키는 아예 없다',
    safest.SORAN_RELEASE_STAGE === 'd1' && safest.SORAN_CAPACITY_STAGE === 'd1' && safest[PROOF_STAGE_ENV] === ''
    && !Object.keys(safest).some((k) => /CANARY|WINDOW/.test(k)))
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
  check('🔴 🔴 **TRIAL 결정 → 공개 = 시험 단계 d3 그대로 · 증명일 d3 · canary 키 없음**',
    tv.ok && te.SORAN_RELEASE_STAGE === 'd3' && te[PROOF_STAGE_ENV] === 'd3' && !Object.keys(te).some((k) => /CANARY|WINDOW/.test(k)),
    JSON.stringify(te))
  check('🔴 🔴 **러너가 그 env 를 d3 · 하루 3건으로 읽는다(09-29 반례 해소)**',
    resolveScale(te).releaseStage === 'd3' && resolveScale(te).releaseProfile.dailyTarget === 3)
  const prepRow = { ...trialRow, state: 'PREPARE', release: 'd1', transition: null, reasons: ['🟢 PREPARE'] }
  const pv = validateStoredDecision({ row: prepRow, expectKstDate: '2026-09-29' })
  const pe = pv.ok ? consumerEnvOf({ ok: true, decision: pv.decision }) : { [PROOF_STAGE_ENV]: 'x' }
  check('🔴 TRIAL 이 아닌 날(PREPARE)은 증명일 빈 값', pv.ok && pe[PROOF_STAGE_ENV] === '')
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
  check('🔴 controller 는 발행 창(08:00) 전에 돈다 · 오름차순 · 세 번(재시도)',
    slots.length === 3 && slots.every((m) => m < PUBLISH_WINDOW_START_MINUTE) && slots.every((m, i) => i === 0 || m > slots[i - 1]!))
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
    && /runningBlockers\(desired\.keys\(\), running\)/.test(installer))
  check('🔴 runtime deploy가 제거한 plist 끝 개행만으로 consumer를 거절하지 않는다',
    /installed\.trimEnd\(\) === expected\.trimEnd\(\)/.test(installer))
  const installCore = readFileSync('scripts/lib/ops-loop-install-core.mts', 'utf-8')
  check('🔴 공식 설치기는 설치 전 snapshot을 남기고 검증 실패면 자동 rollback한다(실행 시험은 ⑧)',
    /manifest\.json/.test(installer) && /설치 검증 실패/.test(installCore)
    && /applyInstall\(desired, runtimeRoot, \{/.test(installer) && /restore: \(\) => restore\(backupDir\),/.test(installer)
    && /process\.exit\(outcome\.restored \? 1 : 2\)/.test(installer))
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
  // 07:00 판정 — 전날 22:00 회차가 22:01 에 끝났고 22:29 에 배포(재등록)됐다
  const NOW7 = new Date('2026-09-30T07:00:00+09:00')
  const rec = (exitCode: number, finishedAt = '2026-09-29T22:01:00+09:00', label = L): PublishRunRead => ({
    kind: 'ok', record: { v: 1, label, startedAt: '2026-09-29T22:00:05+09:00', finishedAt, exitCode },
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
    pf(PRINT_NEVER, rec(0, '2026-09-28T22:01:00+09:00')) === null
    && pf(PRINT_NEVER, rec(0), new Date(Date.parse('2026-09-29T22:01:00+09:00') + PUBLISH_RUN_MAX_AGE_MS + 60_000)) === null)
  check('밤 공백은 최대 나이 안이다 — 22:01 끝난 회차를 07:40 판정이 읽는다',
    pf(PRINT_NEVER, rec(0), new Date('2026-09-30T07:40:00+09:00')) === false)
  check('🔴 재등록 + 다른 label 기록(수동 실행 등) → 모름(null)', pf(PRINT_NEVER, rec(0, undefined, 'application.com.x.1')) === null)
  check('🔴 재등록 + 미래에 끝난 기록 → 모름(null)', pf(PRINT_NEVER, rec(0, '2026-09-30T08:00:00+09:00')) === null)
  check('🔴 재등록 + 끝난 시각이 시작보다 이르다 → 모름(null)', pf(PRINT_NEVER, rec(0, '2026-09-29T21:00:00+09:00')) === null)
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
  const BLOCKING = [PUBLISH_RUNNER_LABEL, STAGE_CONTROLLER_LABEL, RUNNER_RECOVER_LABEL] as const
  const input = { runtimeRoot: '/r', npxPath: '/n/npx', logDir: '/l', nodeBinDir: '/n' }
  const desired = desiredPlists('fixed', input)
  check('교체 대상은 발행·controller·복구·keep-awake 넷이다 — keep-awake 도 같은 적용 경로를 탄다',
    JSON.stringify([...desired.keys()]) === JSON.stringify([...BLOCKING, KA]))
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
        desiredPlists('fixed', { runtimeRoot: rt, npxPath: npxBesideNode, logDir, nodeBinDir }).get(PUBLISH_RUNNER_LABEL)!)
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
      const plan = (runningSet: readonly string[]): { status: number | null; out: string } => {
        const r = spawnSync(process.execPath, [tsxCli, installerPath], {
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
      check('(b) 설치기 plan: 넷 다 running → 막힘 3건(keep-awake 제외)',
        all.status === 1 && all.out.includes('🔴 막힘 3건') && !all.out.includes(`${KA}이 실행 중이다`), all.out.slice(-600))
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
  } = {}): { outcome: ReturnType<typeof applyInstall>; sim: Sim } => {
    const old = desiredPlists('heartbeat', input)
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
      restore: () => { sim.restores += 1; return opt.restoreOk ?? true },
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
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 이 검사는 DB·네트워크·launchctl·provider 를 쓰지 않는다.')
if (fail > 0) process.exit(1)
