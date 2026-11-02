#!/usr/bin/env tsx
/**
 * D100 reliability replay — 지금 코드의 baseline gap 을 실제 함수 호출로 재현하는 characterization 검사
 *
 *   npm run check:d100-reliability-replay
 *
 *   ① preflight — 07:00 의 READY + 원천 기회로 하루 전체 N 슬롯을 요구한다           PREFLIGHT_FULL_DAY_OPPORTUNITY
 *   ② controller — bad 신호 하나가 인증 단계의 다음 날 release 를 낮춘 채 남긴다     BRAKE_DEMOTION_PERSISTS
 *   ③ 증거 — 전날 판정에 오늘 관측한 러너 오류가 들어간다                         EVIDENCE_USES_CURRENT_RUNNER_HEALTH
 *   ④ 깨움 — 공급 깨움 없음 · 댓글 깨움만 follow-up 표식으로 합쳐진다               SUPPLY_WAKE_NOT_IMPLEMENTED
 *   ⑤ 첫 댓글 시도 기억 — 없음 · 손상 · STARTED 결과 갱신 실패                     ATTEMPT_JOURNAL_CORRUPTION_PERMANENT
 *   ⑥ runtime manifest — SHA 만 결속한다                                         RUNTIME_MANIFEST_LACKS_PERSONA_ASSET_IDENTITY
 *   ⑦ 경계 표현 — KST 23:59/00:00 · N-1/N/N+1 · 깨움 중복 · 시도 기억 손상 변형
 *
 * 🔴 판정 규칙은 `scripts/lib/d100-reliability-replay.mts` 의 장부(`BASELINE_GAPS`)가 정한다.
 *    지금 main 에서 PASS 하려면 각 gap 이 **관측돼야** 한다 — 결함이 사라지면 GAP_CLOSED 로 FAIL 하고 장부를 뒤집는다.
 *
 * 🔴 ③ 의 경계: `scripts/stage-controller.mts` 는 top-level 에서 DB 를 열고 끝나서 import 할 수 없다.
 *    그래서 순수 판정(`judgeStageEvidence` · `sustainedReleaseOf`)은 실제로 부르고, controller 가 전날 증거에
 *    어떤 오류 신호를 넣는지(wiring)는 그 파일의 주석을 뺀 원문으로 확인한다. 둘을 따로 보고한다.
 *
 * 🔴 DB 0 · 네트워크 0 · provider 0 · 운영 HOME 0 · 운영 launchctl 0 · 운영 env 0.
 *    반드시 `d100-reliability-replay-run.mts`가 먼저 세운 임시 HOME 안에서만 돈다.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative } from 'node:path'

import type { PrismaClient } from '@prisma/client'

import {
  BASELINE_GAPS, addKstDays, createReplaySandbox, judgeGap, kstAt,
  type Observation, type ReplaySandbox,
} from './lib/d100-reliability-replay.mjs'
import {
  commentCoverageOf, judgeNextPreflight, slotTimesOn,
  type PreflightFacts, type ReadyCohortFact,
} from '../src/lib/stage-ladder-generic'
import { minuteOfDay, profileOf, stageRank, type RuntimeStage } from '../src/lib/scale-profile'
import { RUNNER_GRID, preflightWindowsOf, slotValidOpportunitiesOf } from './lib/stage-preflight-facts.mjs'
import { PERSONA_CANARY_FLOOR } from '../src/lib/d100-capacity'
import { AUTO_FIRST_COMMENT_WINDOW_MS, COMMENT_LOOP_DAILY_USD_MAX } from '../src/lib/persona-comment-auto-lane'
import {
  SUPPLY_DAILY_USD_APPROVED, SUPPLY_PROOF_RUNS_PER_DAY, SUPPLY_WORKSET_PER_RUN,
} from '../src/lib/supply-schedule-contract'
import {
  judgeEvidenceForTarget, judgeStageEvidence, trialPlanOf, trialPlanThrough,
  type EvidencePost, type EvidenceSideSignals, type StageEvidenceFacts,
} from '../src/lib/stage-evidence'
import { auditTarget } from '../src/lib/auto-ready-v2'
import {
  DECISION_WRITER, STAGE_DECISION_VERSION, nextStage, previousKstDate, validateStoredDecision,
  type TransitionState, type ValidatedStageDecision,
} from '../src/lib/stage-decision-contract'
import {
  decideStage, errorSignalOf, qualitySignalOf, sustainedReleaseOf, validateForToday, type HealthSignal,
} from '../src/lib/stage-controller'
import { preparedStageOf } from '../src/lib/stage-ladder'
import { kstDateString } from '../src/lib/release-canary'
import { EVENT_WAKE_ENV, FAKE_LAUNCHCTL_MARK, WAKE_TARGETS, launchctlPath, wakeAllowed, wakeRunner } from './lib/runner-wake.mjs'
import { FOLLOW_UP_FILE, followUpTriggerOf } from './lib/runner-lease.mjs'
import { ATTEMPT_JOURNAL_FILE, createAttemptStore } from './lib/persona-comment-attempt-store.mjs'
import {
  attemptKeyOf, attemptedComboKeys, isAttemptActive, serializeAttemptJournal, type AttemptEntry,
} from '../src/lib/persona-comment-attempt-policy'
import { runDeploy, type DeployEffects } from '../src/lib/runtime-deploy'
import { runCommentLoop } from './lib/persona-comment-loop.mjs'
import type { SourcePersona, SourcePost, TargetSource } from './lib/persona-comment-targets'

const argv = process.argv.slice(2)
if (argv.length > 0) throw new Error(`모르는 인자 — ${argv.join(' ')}`)
const replayHome = process.env.SORAN_D100_RELIABILITY_REPLAY_HOME
if (replayHome === undefined || process.env.HOME !== replayHome) {
  throw new Error('임시 HOME wrapper 없이 reliability replay를 실행할 수 없다')
}
const replayRoot = realpathSync(replayHome)
const tempRoot = realpathSync(tmpdir())
const replayRelative = relative(tempRoot, replayRoot)
if (replayRelative === '' || replayRelative.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
  || replayRelative === '..' || isAbsolute(replayRelative)
  || !basename(replayRoot).startsWith('soran-d100-reliability-home-')) {
  throw new Error('reliability replay HOME은 OS 임시 디렉터리의 전용 경로여야 한다')
}

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}
const section = (s: string): void => console.log(`\n── ${s} ──`)
const observations = new Map<string, Observation>()

// ─────────────────────────────────────────────────────────
// 공통 fixture — 단계 사실은 `stage-scheduler-check` 의 경계값 fixture 와 같은 모양이다
// ─────────────────────────────────────────────────────────

const GRID = RUNNER_GRID
const D = '2026-11-02'
const COMMENT_USD = 0.00222
const AUDIT_USD = 0.005
const AUDIT_CAP = 0.30
const SUPPLY_USD_PER_RESULT = 0.008
const RUNS = SUPPLY_WORKSET_PER_RUN * SUPPLY_PROOF_RUNS_PER_DAY
const OK_SIGNALS: HealthSignal[] = [
  { axis: 'quality', health: 'ok', reasons: [] }, { axis: 'cost', health: 'ok', reasons: [] }, { axis: 'errors', health: 'ok', reasons: [] },
]
const SIDE_OK: EvidenceSideSignals = {
  cost: [{ name: '공급 장부', health: 'ok' }, { name: '댓글 장부', health: 'ok' }, { name: '감사 장부', health: 'ok' }],
  errors: 'ok', supplyUsageUnknown: 0,
}

/** 각 칸이 그 단계를 딱 채우는 preflight 사실 — 바꾼 칸만 판정을 가른다 */
const preflightFacts = (s: RuntimeStage, o: Partial<PreflightFacts> = {}): PreflightFacts => {
  const n = profileOf(s).dailyTarget
  const cohort: ReadyCohortFact = { sources: RUNS, published: n, lost: 0, scheduled: 0, unknown: 0, usdPerSlotValidResult: SUPPLY_USD_PER_RESULT }
  return {
    slotValidOpportunities: n, readyCohort: cohort, latencyP50H: 20, latencyP90H: 60,
    contractValidPersonas: s === 'd1' ? 1 : PERSONA_CANARY_FLOOR[s],
    commentUsdPerRequest: COMMENT_USD, commentDailyUsdCap: COMMENT_LOOP_DAILY_USD_MAX,
    auditUsdPerCall: AUDIT_USD, auditDailyUsdCap: AUDIT_CAP,
    supplyDailyUsdCap: SUPPLY_DAILY_USD_APPROVED, runnerHealth: 'ok', ...o,
  }
}

/**
 * 그날 실제로 일어난 일 — 자동 READY 글 `count` 편이 단계 슬롯에 나가고, 댓글 예약표대로 60분 안 첫 댓글이 붙고,
 * 정본 표본 수만큼 감사가 끝났다. `count` 가 목표를 넘으면 마지막 슬롯 뒤 격자에 덧붙인다(N+1 표현).
 */
function dayFacts(kstDate: string, stage: RuntimeStage, state: TransitionState, count: number = profileOf(stage).dailyTarget): StageEvidenceFacts {
  const mins = [...profileOf(stage).slots].map(minuteOfDay).sort((a, b) => a - b)
  const midnight = kstAt(kstDate, '00:00').getTime()
  const posts: EvidencePost[] = Array.from({ length: count }, (_, i) => {
    const m = i < mins.length ? mins[i]! : mins[mins.length - 1]! + (i - mins.length + 1) * GRID.gridMinutes
    const t = midnight + m * 60_000
    const wait = commentCoverageOf(m, GRID).firstWait ?? GRID.gridMinutes
    return {
      postId: `p-${kstDate}-${i}`, queueId: `q-${kstDate}-${i}`, publishedAtMs: t, unattended: true,
      queueRows: 1, publishLogs: 1, authorPersonaId: `a-${i}`, decider: 'auto', release: 'STAMPED_ELIGIBLE',
      personaComments: [{ personaId: `c-${i}`, createdAtMs: t + wait * 60_000, topLevel: true, provenance: 'auto' }],
    }
  })
  const rows = posts.slice(0, auditTarget(posts.length))
    .map((p) => ({ postId: p.postId, queueId: p.queueId ?? '', judged: true, defectYes: false, retryable: false, overdue: false }))
  return {
    kstDate, stage, decision: { kstDate, state, release: stage, decidedBy: DECISION_WRITER },
    posts, orphanPublishLogs: 0, unloggedPublishes: 0, commentCapPerPost: 1, audits: { rows },
  }
}

/** controller 가 저장한 평상일 행 — 저장 계약 validator 를 통과한 값만 쓴다 */
function storedRow(kstDate: string, release: RuntimeStage, state: 'HOLD' | 'REPROVE'): ValidatedStageDecision {
  const r = validateStoredDecision({
    row: {
      kstDate, capacity: preparedStageOf(release), release, state, reasons: [], blocks: [], dayPinned: false, supply: null,
      decidedAt: kstAt(kstDate, '07:00').toISOString(), contractVersion: STAGE_DECISION_VERSION, decidedBy: DECISION_WRITER, transition: null,
    }, expectKstDate: kstDate,
  })
  if (!r.ok) throw new Error(r.reason)
  return r.decision
}

const validated = (d: Parameters<typeof validateForToday>[0]): ValidatedStageDecision => {
  const v = validateForToday(d)
  if (!v.ok) throw new Error(v.reason)
  return v.decision
}

/** 오늘 07:00 launchd 관측 — 발행 러너 정상 · 공급 러너 최근 회차 실패 */
const currentErrors = (): HealthSignal => errorSignalOf([
  { label: 'com.soransoran.original-post-runner', loaded: true, failing: false },
  { label: 'com.soransoran.supply-process', loaded: true, failing: true },
])

/**
 * 인증 사다리 — D-2 평상일 HOLD d3 가 exact N PASS → D-1 TRIAL d5 → D-1 증거 PASS(자기 날 러너 정상).
 * ② · ③ 이 같은 출발점에서 갈라진다.
 */
const DM2 = addKstDays(D, -2)
const DM1 = addKstDays(D, -1)
const D1 = addKstDays(D, 1)
const rowDm2 = storedRow(DM2, 'd3', 'HOLD')
const evDm2 = judgeStageEvidence(DM2, 'd3', dayFacts(DM2, 'd3', 'HOLD'), SIDE_OK)
const resDm1 = decideStage({
  kstDate: DM1, decidedAt: kstAt(DM1, '07:00').toISOString(), previousDecision: rowDm2, previousEvidence: evDm2,
  carriedPlan: null, nextPreflight: judgeNextPreflight('d5', preflightFacts('d5'), GRID), publishedToday: 0, signals: OK_SIGNALS,
})
const rowDm1 = validated(resDm1.decision)
const factsDm1 = dayFacts(DM1, 'd5', rowDm1.state)
const evDm1Own = judgeStageEvidence(DM1, 'd5', factsDm1, SIDE_OK)

const sandboxes: ReplaySandbox[] = []
try {
  // ─────────────────────────────────────────────────────────
  section('⓪ 출발점 — 인증 사다리')
  check(`D-2 HOLD d3 exact N → 증거 ${evDm2.verdict}`, evDm2.verdict === 'PASS', evDm2.codes.join(','))
  check(`D-1 결정 ${rowDm1.state}:${rowDm1.release} (d5 시험)`, rowDm1.state === 'TRIAL' && rowDm1.release === 'd5')
  check(`D-1 자기 날 러너 정상 → 증거 ${evDm1Own.verdict}`, evDm1Own.verdict === 'PASS', evDm1Own.codes.join(','))
  check('D-1 PASS 면 지속 단계 d5 (인증)', sustainedReleaseOf(rowDm1, evDm1Own) === 'd5')

  // ─────────────────────────────────────────────────────────
  section('① preflight — 07:00 재고로 하루 전체 N 슬롯')
  {
    const stage: RuntimeStage = 'd5'
    const n = profileOf(stage).dailyTarget
    const slots = slotTimesOn(D, profileOf(stage))
    const always = (key: string) => ({ key, validAt: () => true })
    // 07:00 현재 재고 — 자동 READY 2 · 아직 초안이 없는 원천 10 · 실측 원천 수율 0.2
    const currentSources = Array.from({ length: 10 }, (_, i) => always(`current-src:${i}`))
    const opp = slotValidOpportunitiesOf({
      slots,
      ready: [always('ready:0'), always('ready:1')],
      sources: currentSources,
      readyPerSource: 0.2,
    })
    const pf = judgeNextPreflight(stage, preflightFacts(stage, { slotValidOpportunities: opp.total }), GRID)
    const control = judgeNextPreflight(stage, preflightFacts(stage), GRID)
    // 08:15 이후 회차가 처리할 **새** 원천. 현재 10건과 key 교집합이 0이어야 두 번 세지 않는다.
    const futureSources = Array.from({ length: 10 }, (_, i) => always(`future-src:${i}`))
    const future = slotValidOpportunitiesOf({ slots, ready: [], sources: futureSources, readyPerSource: 0.2 })
    const zeroFuture = slotValidOpportunitiesOf({ slots, ready: [], sources: [], readyPerSource: 0.2 })
    const zeroFutureVerdict = judgeNextPreflight(stage, preflightFacts(stage, {
      slotValidOpportunities: opp.total + zeroFuture.sourceExpected,
    }), GRID)
    const unknownYield = slotValidOpportunitiesOf({ slots, ready: [always('ready:0'), always('ready:1')], sources: futureSources, readyPerSource: null })
    const unknownFuture = judgeNextPreflight(stage, preflightFacts(stage, { slotValidOpportunities: unknownYield.total }), GRID)
    const preflightFactsSource = readFileSync('scripts/lib/stage-preflight-facts.mts', 'utf-8')
    const preflightGateSource = readFileSync('src/lib/stage-ladder-generic.ts', 'utf-8')
    const controllerSource = readFileSync('scripts/stage-controller.mts', 'utf-8')
    const preflightFactsCurrentOnly = /const slotValidOpportunities = snap\.evidence === null \? null\s*:\s*combineOpportunityBounds\(opp\.total, oppHigh\.total, i\.proofSlots\.length\)/.test(preflightFactsSource)
    const opportunityGateCurrentOnly = /facts\.slotValidOpportunities < n\) codes\.add\('OPPORTUNITY_SHORT'\)/.test(preflightGateSource)
    const controllerPassesFactsDirectly = /nextPreflight = judgeNextPreflight\(target, r\.facts, RUNNER_GRID\)/.test(controllerSource)
    const currentKeys = new Set(currentSources.map((x) => x.key))
    const distinctFuture = futureSources.every((x) => !currentKeys.has(x.key))
    const shortfall = n - opp.total
    const distinctFutureCapacityCoversShortfall = distinctFuture && shortfall > 0 && future.sourceExpected >= shortfall
    console.log(`   d5 슬롯 ${slots.length} · 07:00 기회 ${opp.total}(READY ${opp.readyFilled} + 현재 원천 기대 ${opp.sourceExpected})`
      + ` · 당일 새 원천 기대 ${future.sourceExpected} · 부족 ${shortfall}`)
    check('대조 — 기회가 N 이면 같은 사실로 PASS', control.verdict === 'PASS', control.codes.join(','))
    check('기회 계산은 실제 짝짓기 함수 결과다(READY 2 + floor(10 × 0.2))', opp.total === 4 && opp.readyFilled === 2 && opp.sourceExpected === 2)
    check('보충 원천은 07:00 원천과 다른 key 이고 실측 수율로 부족분을 덮는다', distinctFutureCapacityCoversShortfall)
    check('새 원천 0이면 보충 기대량은 0이고 별도 preflight도 계속 막는다', zeroFuture.sourceExpected === 0 && zeroFutureVerdict.codes.includes('OPPORTUNITY_SHORT'))
    check('실측 수율을 모르면 보충 가능으로 지어내지 않는다', unknownFuture.codes.includes('OPPORTUNITY_SHORT'))
    check('실제 preflight facts는 07:00 snapshot 기회만 넣는다', preflightFactsCurrentOnly)
    check('실제 기회 gate는 snapshot 기회가 N 미만이면 곧바로 막는다', opportunityGateCurrentOnly)
    check('실제 controller는 facts를 보정하지 않고 그대로 기회 gate에 넘긴다', controllerPassesFactsDirectly)
    observations.set('PREFLIGHT_FULL_DAY_OPPORTUNITY', {
      verdict: pf.verdict,
      onlyOpportunityShort: pf.codes.length === 1 && pf.codes[0] === 'OPPORTUNITY_SHORT',
      hasOpportunityShort: pf.codes.includes('OPPORTUNITY_SHORT'),
      opportunities: opp.total, target: n, futureExpected: future.sourceExpected,
      distinctFutureCapacityCoversShortfall,
      usesFutureSupplyCapacity: pf.verdict === 'PASS' && opp.total < n,
      zeroFutureCapacityBlocked: zeroFuture.sourceExpected === 0 && zeroFutureVerdict.codes.includes('OPPORTUNITY_SHORT'),
      unknownYieldBlocked: unknownFuture.codes.includes('OPPORTUNITY_SHORT'),
      preflightFactsCurrentOnly, opportunityGateCurrentOnly, controllerPassesFactsDirectly,
    })
  }

  // ─────────────────────────────────────────────────────────
  section('② controller — bad 신호 하나의 감속이 다음 날에도 남는다')
  {
    // 현재 errors를 쓰면 과거 증거 오염(시나리오 ③)과 섞인다. 감속 자체만 보려고 quality 축을 나쁘게 둔다.
    const bad = qualitySignalOf({ unresolvedDefects: 1, missingPosts: 0, retryableFailures: 0, overdueAudits: 0 })
    const d0 = decideStage({
      kstDate: D, decidedAt: kstAt(D, '07:00').toISOString(), previousDecision: rowDm1, previousEvidence: evDm1Own,
      carriedPlan: null, nextPreflight: judgeNextPreflight('d10', preflightFacts('d10'), GRID), publishedToday: 0,
      signals: [bad, OK_SIGNALS[1]!, OK_SIGNALS[2]!],
    })
    const row0 = validated(d0.decision)
    // D 는 감속된 평상일 — 2/3 편(N-1)은 정상 운영이다
    const ev0 = judgeStageEvidence(D, row0.release, dayFacts(D, row0.release, row0.state, profileOf(row0.release).dailyTarget - 1), SIDE_OK)
    // controller 와 같은 순서로 이어진 계획을 되짚는다(전날이 HOLD·PREPARE 면 그 앞 증명일까지)
    const carried = trialPlanThrough([{ decision: rowDm1, evidence: evDm1Own }])
    const plan1 = trialPlanOf(row0, ev0, carried)
    const sustained1 = sustainedReleaseOf(row0, ev0)
    const target1 = plan1 !== null ? (plan1.base === sustained1 ? plan1.target : null) : nextStage(sustained1)
    // 실제 controller와 같다. 이어진 계획이 없으면 지속 단계의 다음 칸 preflight를 본다.
    const pfStage = target1
    const d1 = decideStage({
      kstDate: D1, decidedAt: kstAt(D1, '07:00').toISOString(), previousDecision: row0, previousEvidence: ev0,
      carriedPlan: carried, nextPreflight: pfStage === null ? null : judgeNextPreflight(pfStage, preflightFacts(pfStage), GRID),
      publishedToday: 0, signals: OK_SIGNALS,
    })
    // 대조: 감속 평상일도 exact-N이면 다음 날 d5 재시험을 연다. N-1일 때 인증이 사라지는 경계를 분리한다.
    const ev0Exact = judgeStageEvidence(D, row0.release, dayFacts(D, row0.release, row0.state), SIDE_OK)
    const plan1Exact = trialPlanOf(row0, ev0Exact, carried)
    const sustained1Exact = sustainedReleaseOf(row0, ev0Exact)
    const target1Exact = plan1Exact !== null
      ? (plan1Exact.base === sustained1Exact ? plan1Exact.target : null)
      : nextStage(sustained1Exact)
    const d1Exact = decideStage({
      kstDate: D1, decidedAt: kstAt(D1, '07:00').toISOString(), previousDecision: row0, previousEvidence: ev0Exact,
      carriedPlan: carried, nextPreflight: target1Exact === null ? null : judgeNextPreflight(target1Exact, preflightFacts(target1Exact), GRID),
      publishedToday: 0, signals: OK_SIGNALS,
    })
    console.log(`   D-1 TRIAL:d5 PASS → D ${row0.state}:${row0.release}(brake ${d0.brake}) → D+1 ${d1.decision.state}:${d1.decision.release}(지속 ${d1.sustained} · 신호 전부 정상)`)
    check('D 의 감속은 시험·증명일을 열지 않는다', row0.state === 'HOLD' || row0.state === 'PREPARE')
    check('D+1 신호는 전부 정상이고 brake 가 없다', d1.brake === 'none')
    check('대조 — 감속일 exact-N이면 D+1 d5 재시험을 연다', ev0Exact.verdict === 'PASS'
      && d1Exact.decision.state === 'TRIAL' && d1Exact.decision.release === 'd5')
    observations.set('BRAKE_DEMOTION_PERSISTS', {
      certified: 'd5', day0Brake: d0.brake, day0Operating: row0.release, day0Release: row0.release, day0Evidence: ev0.verdict,
      day1State: d1.decision.state, day1Sustained: d1.sustained, day1Release: d1.decision.release,
      day1BelowCertified: stageRank(d1.decision.release) < stageRank('d5'),
      exactNDay1Release: d1Exact.decision.release,
    })
  }

  // ─────────────────────────────────────────────────────────
  section('③ 증거 — 전날 판정에 오늘 관측한 러너 오류')
  {
    const errorsNow = currentErrors()
    const strip = (f: string): string => readFileSync(f, 'utf-8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
    const ctl = strip('scripts/stage-controller.mts')
    const evidenceBody = ctl.slice(ctl.indexOf('async function evidenceFor('), ctl.indexOf('async function carriedPlanFor('))
    // 직접 호출 네 곳을 모두 열거한다. 한 곳만 고쳐서 “해소”로 보지 않는다.
    const callBodies = [...ctl.matchAll(/evidenceFor\(prisma,\s*\{([\s\S]*?)\}\)/g)].map((m) => m[1] ?? '')
    const currentErrorCallCount = callBodies.filter((body) => {
      const compact = body.replace(/\s+/g, '')
      return /errors:(?:observeErrors\(\)|errorSignal)(?:,|$)/.test(compact)
        || /(?:^|,)errors$/.test(compact)
    }).length
    const observerHasNoDate = /function observeErrors\(\): HealthSignal \{/.test(ctl)
    const canDistinguishErrorDate = /function observeErrorsFor\([^)]*(?:kstDate|from|to)/.test(ctl)
    const controllerFeedsCurrentErrors = evidenceBody.includes('errors: i.errors.health,')
      && callBodies.length === 4 && currentErrorCallCount === callBodies.length && observerHasNoDate
    // 판정은 wiring 관측값에서 유도한다. 하네스가 AS-IS 결과를 상수로 지어내지 않는다.
    const historicalSide: EvidenceSideSignals = {
      ...SIDE_OK, errors: controllerFeedsCurrentErrors ? errorsNow.health : SIDE_OK.errors,
    }
    const past = judgeStageEvidence(DM1, 'd5', factsDm1, historicalSide)
    const sustainedAfter = sustainedReleaseOf(rowDm1, past)
    console.log(`   전날 자기 러너 ${evDm1Own.verdict} · 오늘 관측 errors=${errorsNow.health} 를 넣으면 ${past.verdict} [${past.codes.join(',')}] → 지속 ${sustainedAfter}`)
    console.log(`   wiring(원문) ${JSON.stringify({ historicalCallCount: callBodies.length, currentErrorCallCount, observerHasNoDate, canDistinguishErrorDate })}`)
    check('순수 판정 — 같은 전날 사실 · errors=ok 면 PASS(대조)', evDm1Own.verdict === 'PASS')
    check('controller 의 과거 증거 호출 4곳을 전부 계약에 넣었다', callBodies.length === 4, String(callBodies.length))
    observations.set('EVIDENCE_USES_CURRENT_RUNNER_HEALTH', {
      controllerFeedsCurrentErrors, historicalCallCount: callBodies.length, currentErrorCallCount,
      canDistinguishErrorDate,
      pastVerdict: past.verdict, pastHasRunnerBad: past.codes.includes('RUNNER_BAD'), sustainedAfter,
    })
  }

  // ─────────────────────────────────────────────────────────
  section('④ 깨움 — 공급 없음 · 댓글만 follow-up 표식으로 합쳐진다')
  const g = globalThis as unknown as Record<symbol, unknown>
  {
    const sb = createReplaySandbox('d100-reliability-wake')
    sandboxes.push(sb)
    g[FAKE_LAUNCHCTL_MARK] = sb.fakeLaunchctl
    const wakeSource = readFileSync('scripts/lib/runner-wake.mts', 'utf-8')
    const execCallCount = [...wakeSource.matchAll(/execFileSync\(/g)].length
    const resolverCallCount = [...wakeSource.matchAll(/execFileSync\(launchctlPath\(\),/g)].length
    const otherProcessCall = /\b(?:spawn|spawnSync|exec|execSync|fork)\(/.test(wakeSource)
    if (launchctlPath() !== sb.fakeLaunchctl || execCallCount === 0 || resolverCallCount !== execCallCount || otherProcessCall) {
      throw new Error(`깨움 시험의 launchctl 격리를 증명하지 못했다 — resolver ${resolverCallCount}/${execCallCount} · other=${otherProcessCall}`)
    }
    check('시험 깨움은 실제 launchctl이 아니라 sandbox 가짜 경로를 쓴다', true)
    check('runner-wake의 모든 자식 프로세스 호출은 launchctlPath resolver를 지난다', true)
    const lockDir = WAKE_TARGETS.comment.lockDir(sb.home)
    mkdirSync(lockDir, { recursive: true })
    const markerPath = join(lockDir, FOLLOW_UP_FILE)
    const nowMs = kstAt(D, '09:00').getTime()
    const wake = (target: 'comment' | 'supply', mode: string) => wakeRunner({ target, env: { [EVENT_WAKE_ENV]: mode }, nowMs, home: sb.home })

    // 공급 깨움이 생긴 뒤 baseline을 갱신하지 않은 채 이 검사를 돌려 실제 job을 깨우지 않는다.
    const supplyAppearsImplemented = wakeAllowed('all', 'supply') || !wakeSource.includes("i.target !== 'comment'")
    const supply = supplyAppearsImplemented
      ? { kind: 'IMPLEMENTED_UNVERIFIED' as const }
      : wake('supply', 'all')
    const supplyMarker = supply.kind === 'SENT' ? supply.marker : null
    const supplyKicks = sb.launchctlCalls().length
    const supplyWakeImplemented = supply.kind === 'SENT' && supply.marker === 'REQUESTED' && supply.kick === 'OK'
    // 공급 호출과 댓글 호출 수를 섞지 않는다. 공급이 구현된 뒤에도 댓글 3회 반례는 그대로다.
    sb.resetLaunchctlCalls()
    // 같은 순간 댓글 깨움 3번 — 표식 하나 · kickstart 는 launchd 가 합친다
    const comments = [wake('comment', 'comment'), wake('comment', 'all'), wake('comment', 'comment')]
    const markerKinds = comments.map((w) => (w.kind === 'SENT' ? w.marker : w.kind)).join(',')
    const marker = existsSync(markerPath) ? followUpTriggerOf(readFileSync(markerPath, 'utf-8')) : null
    console.log(`   공급 ${supply.kind} · 표식 ${String(supplyMarker)} · kickstart ${supplyKicks} | 댓글 ${markerKinds} · kickstart ${sb.launchctlCalls().length}`)
    check('🔴 깨움 중복 — 댓글 표식은 REQUESTED 한 번 뒤 COALESCED 로 합쳐진다', markerKinds === 'REQUESTED,COALESCED,COALESCED')
    check('깨움 중복 — 표식 파일은 하나 · trigger=event · 첫 깨움 시각', marker !== null && marker.trigger === 'event'
      && marker.at === new Date(nowMs).toISOString() && readdirSync(lockDir).filter((f) => f === FOLLOW_UP_FILE).length === 1)
    check('깨움 중복 — kickstart 는 깨움마다 보낸다(이미 도는 job 은 launchd 가 다시 띄우지 않는다)', sb.launchctlCalls().length === 3)
    delete g[FAKE_LAUNCHCTL_MARK]
    observations.set('SUPPLY_WAKE_NOT_IMPLEMENTED', {
      supplyOutcome: supply.kind, supplyMarker, supplyKicks, supplyWakeImplemented,
      wakeTargets: Object.keys(WAKE_TARGETS).sort().join(','),
    })
  }

  // ─────────────────────────────────────────────────────────
  section('⑤ 첫 댓글 시도 기억 — 없음 · STARTED 결과 갱신 실패 · 손상')
  {
    const sb = createReplaySandbox('d100-reliability-attempt')
    sandboxes.push(sb)
    const pub = kstAt(D, '10:00').getTime()
    const entryOf = (postId: string, publishedAtMs: number, attemptedAtMs: number): AttemptEntry => ({
      postId, personaCode: 'persona-a', reactionRole: 'empathy', postPublishedAtMs: publishedAtMs, attemptedAtMs,
      step: 'STARTED', failedGates: [], blockCodes: [],
    })

    // 없음 — 정상 빈 기억
    const dirMissing = join(sb.root, 'missing')
    const missing = createAttemptStore({ dir: dirMissing }).read(pub)
    check('없음 → ok · missing · 빈 기억(유료 생성 가능)', missing.ok && missing.missing && missing.entries.length === 0)

    // STARTED 뒤 결과 갱신 실패 — 시작 기록은 남고 같은 조합은 계속 제외된다
    const dirStarted = join(sb.root, 'started')
    const store = createAttemptStore({ dir: dirStarted })
    const e = entryOf('post-a', pub, pub + 60_000)
    const started = store.recordStart(e, pub + 60_000)
    const eio = createAttemptStore({
      dir: dirStarted, ops: { renameSync: () => { throw Object.assign(new Error('rename'), { code: 'EIO' }) } },
    })
    const update = eio.recordOutcomes([{ key: attemptKeyOf(e), step: 'PROVIDER_FAILED', failedGates: [], blockCodes: [] }], pub + 120_000)
    const afterUpdate = store.read(pub + 120_000)
    const leftovers = readdirSync(dirStarted).filter((f) => f !== ATTEMPT_JOURNAL_FILE)
    check('시작 기록 → ok', started.ok)
    check('결과 갱신 rename EIO → ok:false · IO', !update.ok && update.kind === 'IO', JSON.stringify(update))
    check('🔴 갱신 실패 뒤 파일의 단계는 STARTED 그대로 · 같은 조합은 window 안에서 계속 제외된다',
      afterUpdate.ok && afterUpdate.entries.length === 1 && afterUpdate.entries[0]!.step === 'STARTED'
      && attemptedComboKeys(afterUpdate.entries, pub + 120_000).has(attemptKeyOf(e)))
    check('갱신 실패가 임시 파일을 남기지 않는다', leftovers.length === 0, leftovers.join(','))

    // 손상 — 변형마다 fail-closed 코드
    const good = serializeAttemptJournal([e])
    const variants: { name: string; text: string; code: string }[] = [
      { name: 'JSON 아님', text: '{oops', code: 'JSON_INVALID' },
      { name: '잘린 파일', text: good.slice(0, Math.floor(good.length / 2)), code: 'JSON_INVALID' },
      { name: '모르는 판', text: good.replace('"version":1', '"version":2'), code: 'SCHEMA_MISMATCH' },
      { name: '같은 조합 두 줄', text: serializeAttemptJournal([e, e]), code: 'SCHEMA_MISMATCH' },
      { name: '본문 칸이 끼어든 항목', text: JSON.stringify({ version: 1, entries: [{ ...e, text: '본문' }] }), code: 'SCHEMA_MISMATCH' },
      { name: 'window 밖 시도 시각', text: serializeAttemptJournal([{ ...e, attemptedAtMs: pub + AUTO_FIRST_COMMENT_WINDOW_MS + 1 }]), code: 'SCHEMA_MISMATCH' },
    ]
    for (const v of variants) {
      const dir = join(sb.root, `corrupt-${variants.indexOf(v)}`)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, ATTEMPT_JOURNAL_FILE), v.text)
      const r = createAttemptStore({ dir }).read(pub + 60_000)
      check(`손상 변형 — ${v.name} → ok:false ${v.code}`, !r.ok && r.code === v.code, JSON.stringify(r))
    }

    // 손상의 지속 — window 가 한참 지난 뒤 무관한 글의 시작 기록
    const dirCorrupt = join(sb.root, 'corrupt-permanent')
    mkdirSync(dirCorrupt, { recursive: true })
    const corruptPath = join(dirCorrupt, ATTEMPT_JOURNAL_FILE)
    writeFileSync(corruptPath, '{oops')
    // 후속 복구가 mtime을 쓰더라도 검사 실행 날짜에 따라 판정이 달라지지 않게 고정한다.
    utimesSync(corruptPath, new Date(pub), new Date(pub))
    const later = pub + AUTO_FIRST_COMMENT_WINDOW_MS + 864e5
    const corruptStore = createAttemptStore({ dir: dirCorrupt })
    const readLater = corruptStore.read(later)
    const startLater = corruptStore.recordStart(entryOf('post-unrelated', later - 60_000, later), later)
    const body = '오늘 동네를 한 바퀴 걸었어요. 바람이 선선했어요.'
    const post: SourcePost = {
      id: 'cm-reliability-replay-post', source: 'SYSTEM', title: '동네 산책', content: body,
      boardType: 'FREE', publishAtMs: later - 10 * 60_000, category: null, sourceSite: null,
      authorPersonaCode: 'P02', authorOperatorWriterId: null, author: null,
      visibility: { status: 'PUBLISHED', isMicroSeed: false, permanentNoindex: false, indexPromotionBlocked: false },
      comments: [],
    }
    const persona: SourcePersona = {
      code: 'P14', status: 'active', identity: { job: '강사', maritalStatus: '기혼' },
      voiceCore: { ending: '~해요', register: '존댓말', emoji: '가끔', length: '짧은 문장' },
      voiceVariations: ['질문형'], ageBand: '50대', region: '경기', lifeStage: '자녀 대학생',
      noGoTopics: [], noGoExpressions: [], forbiddenReactionRoles: [],
      user: { providerId: null, accountCount: 0 }, recentRoles: { roleCounts: {}, unresolvedRoleEvents: 0 },
      comments: ['저도 그런 날이 있었어요', '무릎이 시큰해서 병원에 갔어요', '햇살이 좋더라고요', '같이 걸으면 더 좋아요', '오늘은 좀 쉬려고요']
        .map((content, i) => ({ content, createdAtMs: later - (i + 1) * 3_600_000 })),
    }
    const source: TargetSource = {
      posts: async () => [post], personas: async () => [persona], openDedupKeys: async () => [],
      recentRoleCounts: async () => ({}), knownNames: async () => ['홍길동'],
      frequency: async () => ({ corpus: { lookup: () => 0, size: 1_000, corpusName: 'comment' }, reason: 'replay corpus' }),
      seedUseCount: async () => 3,
    }
    const makeDb = (): { prisma: PrismaClient; bypass: string[] } => {
      const bypass: string[] = []
      const known: Record<string, unknown> = {
        personaApprovalQueue: new Proxy({ findMany: async () => [] }, {
          get: (target, key) => key in target ? (target as Record<string | symbol, unknown>)[key]
            : (bypass.push(`personaApprovalQueue.${String(key)}`), async () => { throw new Error('DB 우회') }),
        }),
        comment: { findMany: async () => [], count: async () => 0 },
        personaGlobalSwitch: { findUnique: async () => null },
        post: { findMany: async () => Array.from({ length: 6 }, () => ({
          source: 'SYSTEM', status: 'PUBLISHED', isMicroSeed: false, permanentNoindex: false, indexPromotionBlocked: false,
          persona: { code: 'P02' }, operatorWriterId: null, author: null, comments: [],
        })) },
      }
      const prisma = new Proxy(known, {
        get: (target, key) => key in target ? target[key as string]
          : (bypass.push(String(key)), async () => { throw new Error('DB 우회') }),
      }) as unknown as PrismaClient
      return { prisma, bypass }
    }
    const canon = {
      selection: { status: 'confirmed' as const, winner: 'gemini-3.7-flash' },
      canon: {
        runId: 'replay', artifactSha: { summary: 'a', samples: 'b', key: 'c' }, winner: 'gemini-3.7-flash',
        decidedBy: 'replay', decidedAt: new Date(later).toISOString(), scoredSamples: 9,
      },
      detail: 'replay',
    }
    const runConsumer = async (store: ReturnType<typeof createAttemptStore>) => {
      const db = makeDb()
      let generated = 0
      const report = await runCommentLoop({
        prisma: db.prisma, now: new Date(later), env: { SORAN_PERSONA_COMMENT_STAGE: 'bootstrap-auto' }, live: true,
        source, canon, generation: { ok: true, reason: '' }, runRequestCap: 1, attemptStore: store,
        makeGenerate: () => async () => { generated += 1; return { ok: true, text: body, errorCode: null } },
      })
      return { report, generated, bypass: db.bypass }
    }
    const corruptConsumer = await runConsumer(corruptStore)
    const cleanDir = join(sb.root, 'consumer-control')
    mkdirSync(cleanDir, { recursive: true })
    const cleanConsumer = await runConsumer(createAttemptStore({ dir: cleanDir }))
    const consumerSkipsOnCorruptMemory = corruptConsumer.report.providerCalls === 0
      && corruptConsumer.generated === 0 && corruptConsumer.report.attemptWarnings.length === 1
      && corruptConsumer.bypass.length === 0
    const consumerControlGenerates = cleanConsumer.report.providerCalls >= 1
      && cleanConsumer.generated >= 1 && cleanConsumer.bypass.length === 0
    console.log(`   손상 +1일 · 무관한 글 — 읽기 ${readLater.ok ? 'ok' : readLater.code} · 시작 기록 ${startLater.ok ? 'ok' : startLater.kind}`)
    check('실제 댓글 consumer는 시도 기억을 못 읽으면 유료 생성을 건너뛴다', consumerSkipsOnCorruptMemory)
    check('대조 — 같은 실제 consumer와 정상 기억은 provider를 부른다', consumerControlGenerates,
      `provider=${cleanConsumer.report.providerCalls} generated=${cleanConsumer.generated} bypass=${cleanConsumer.bypass.join(',')}`)
    observations.set('ATTEMPT_JOURNAL_CORRUPTION_PERMANENT', {
      readOkAfterWindow: readLater.ok, startOkAfterWindow: startLater.ok,
      blocksUnrelatedPost: !startLater.ok,
      generationRecoversAfterWindow: readLater.ok && startLater.ok,
      consumerSkipsOnCorruptMemory, consumerControlGenerates,
    })
  }

  // ─────────────────────────────────────────────────────────
  section('⑥ runtime manifest — 실제 runDeploy 가 쓰는 기록')
  {
    const TARGET = 'a'.repeat(40)
    const PREV = 'b'.repeat(40)
    const REFERENCE_DIGEST = 'c'.repeat(64)
    const SUPPLEMENT_DIGEST = 'd'.repeat(64)
    // 효과가 쓴 값을 담는 칸 — 클로저 갱신이 흐름 분석에서 지워지지 않게 객체로 둔다
    const written: { manifest: string | null; pin: string | null } = { manifest: null, pin: null }
    const fx: DeployEffects = {
      fetch: () => true, currentSha: () => PREV, originMain: () => TARGET, isAncestor: () => true, dirty: () => false,
      runningJobs: () => ({ running: [], unknown: [] }), envBlockers: () => [],
      unload: () => true, bootout: () => true, probeJob: () => 'unloaded', load: () => true,
      checkout: () => true, install: () => true, generate: () => true, offlineGate: () => true,
      runtimeQualityContract: () => `replay:${REFERENCE_DIGEST}`, stagedTransitionCheck: () => true, contractTransitionGate: () => true,
      readInstalledPlist: () => null, renderPlist: () => '<plist/>', writePlist: () => true, removePlist: () => true,
      retirePlist: () => true, unretirePlist: () => true, lintPlist: () => true,
      argsOf: () => [], workingDirOf: () => null,
      loadedConfig: () => { throw new Error('job 이 없는 배포는 loaded 설정을 읽지 않는다') },
      isolationGate: () => true,
      readManifest: () => written.manifest, readPin: () => written.pin,
      writeManifest: (json) => { written.manifest = json; return true }, removeManifest: () => { written.manifest = null; return true },
      writePin: (sha) => { written.pin = sha; return true },
      log: () => undefined,
    }
    const res = await runDeploy({
      target: TARGET, jobs: [], paths: { runtimeRoot: '/replay/runtime', devRoots: [] },
      offlineGates: ['replay-gate'], now: () => kstAt(D, '05:00').toISOString(),
    }, fx)
    const parsed = written.manifest === null ? null : JSON.parse(written.manifest) as Record<string, unknown>
    const keys = parsed === null ? [] : Object.keys(parsed).sort()
    const personaAssets = parsed?.personaAssets !== null && typeof parsed?.personaAssets === 'object'
      ? parsed.personaAssets as Record<string, unknown>
      : null
    const referenceDigest = typeof personaAssets?.referenceDigest === 'string' ? personaAssets.referenceDigest : null
    const supplementDigest = typeof personaAssets?.supplementDigest === 'string' ? personaAssets.supplementDigest : null
    console.log(`   배포 ${res.ok ? 'ok' : `실패 ${res.phase}`} · manifest 칸 ${keys.join(',')}`)
    check('배포 회차가 끝까지 간다(manifest · pin 기록)', res.ok && parsed !== null && written.pin === TARGET, res.problems.join(' / '))
    check('manifest 는 target SHA · 직전 SHA 를 결속한다', parsed?.sha === TARGET && parsed?.previousSha === PREV)
    observations.set('RUNTIME_MANIFEST_LACKS_PERSONA_ASSET_IDENTITY', {
      manifestKeys: keys.join(','),
      referenceDigest, supplementDigest,
      bindsPersonaAsset: referenceDigest === REFERENCE_DIGEST && supplementDigest === SUPPLEMENT_DIGEST,
    })
  }

  // ─────────────────────────────────────────────────────────
  section('⑦ 경계 표현 — KST 23:59/00:00 · N-1/N/N+1')
  {
    check('KST 23:59 은 그날 · 다음 00:00 은 다음 날 · 전날 계산이 맞물린다',
      kstDateString(kstAt(D, '23:59')) === D && kstDateString(kstAt(D1, '00:00')) === D1 && previousKstDate(D1) === D)
    const at2359 = preflightWindowsOf(D, kstAt(D, '23:59')).capacity.dates
    const at0000 = preflightWindowsOf(D, kstAt(D1, '00:00'))
    const at0001 = preflightWindowsOf(D, kstAt(D1, '00:01')).capacity.dates
    check('용량 창 — 23:59 · 정확히 00:00 은 그날까지 · 00:01 부터 다음 날 파일을 연다',
      at2359.at(-1) === D && at0000.capacity.dates.at(-1) === D && at0001.at(-1) === D1, `${at2359.at(-1)} ${at0000.capacity.dates.at(-1)} ${at0001.at(-1)}`)
    check('증명 창 — 전날 증명은 다음 날 00:00 에 닫힌다', at0000.proof.to.getTime() === kstAt(D1, '00:00').getTime())
    const n = profileOf('d5').dailyTarget
    const ev = (k: number) => judgeEvidenceForTarget(D, 'd5', n, dayFacts(D, 'd5', 'TRIAL', k), SIDE_OK)
    const [under, exact, over] = [ev(n - 1), ev(n), ev(n + 1)]
    check(`증명일 N-1(${n - 1}) → FAIL PUBLISH_NOT_AUTO_READY`, under.verdict === 'FAIL' && under.codes.includes('PUBLISH_NOT_AUTO_READY'), under.codes.join(','))
    check(`증명일 N(${n}) → PASS`, exact.verdict === 'PASS', exact.codes.join(','))
    check(`증명일 N+1(${n + 1}) → FAIL PUBLISH_OVER`, over.verdict === 'FAIL' && over.codes.includes('PUBLISH_OVER'), over.codes.join(','))
    const lateEntry = { postPublishedAtMs: kstAt(D, '23:30').getTime() }
    check('첫 댓글 시도 기억 TTL 은 자정을 넘어 발행 + 60분(경계 포함)이다',
      isAttemptActive(lateEntry, kstAt(D1, '00:20').getTime()) && isAttemptActive(lateEntry, kstAt(D1, '00:30').getTime())
      && !isAttemptActive(lateEntry, kstAt(D1, '00:30').getTime() + 1))
  }

  // ─────────────────────────────────────────────────────────
  section('baseline gap 판정')
  for (const gap of BASELINE_GAPS) {
    const observed = observations.get(gap.code)
    if (observed === undefined) { check(`${gap.code} — 관측이 없다`, false); continue }
    const verdict = judgeGap(gap, observed)
    const label = `[baseline] ${gap.code} (시나리오 ${gap.scenario}) → ${verdict}`
    check(label, verdict === 'MATCH', `관측 ${JSON.stringify(observed)} · current ${JSON.stringify(gap.current)} · target ${JSON.stringify(gap.target)}`)
    console.log(`      ${gap.summary}`)
    console.log(`      관측 ${JSON.stringify(observed)}`)
    console.log(`      current ${JSON.stringify(gap.current)} · target ${JSON.stringify(gap.target)}`)
  }
  check('장부의 gap code 는 겹치지 않는다', new Set(BASELINE_GAPS.map((x) => x.code)).size === BASELINE_GAPS.length)
} finally {
  delete (globalThis as unknown as Record<symbol, unknown>)[FAKE_LAUNCHCTL_MARK]
  for (const sb of sandboxes) sb.dispose()
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} D100 reliability replay ${pass} pass · ${fail} fail · baseline gap ${BASELINE_GAPS.length}/${BASELINE_GAPS.length} 검출 기대`)
console.log('🔴 DB 0 · 네트워크 0 · provider 0 · 운영 HOME 0 · 운영 launchctl 0\n')
process.exitCode = fail === 0 ? 0 : 1
