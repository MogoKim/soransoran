#!/usr/bin/env tsx
/**
 * D100 **통합 준비도** — 🔴 read-only. DB write 0 · 네트워크 0 · LLM 0
 *
 * 🔴 **한 화면에서 전부 본다.** 도구마다 다른 숫자를 부르던 것을 끝낸다 —
 *    재고·정합·runner·Persona·계측이 전부 정본 하나에서 나온다.
 *
 * 🔴 **측정되지 않은 값은 `unmeasured` 다.** 0 이나 추정으로 채우지 않는다.
 *
 * 🔴 **두 기준 SHA 를 함께 적는다** (2026-09-21 창업자 지시).
 *    코드 기준(이 트리)과 운영 기준(배포된 runtime)이 다를 수 있다.
 *
 * 사용법
 *   npm run d100:readiness            사람이 읽는 표
 *   npm run d100:readiness -- --json  기계가 읽는 값
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

import {
  allD100Plans, d100Plan, describePersonaTargets, nextStage as d100NextStage,
  personaTargetReport, D100_STAGES, READY_NET_MARGIN, type D100Stage,
} from '../src/lib/d100-capacity'
import { SAFEST_STAGE, profileOf, type RuntimeStage } from '../src/lib/scale-profile'
import { DETAIL_SOURCES } from './lib/d100-detail-throughput.mjs'
import {
  CAPABILITIES, allCapabilitiesReady, capabilityBlockers, runnerFactsOf, capabilityFactsReady,
  showMeasured, summarizeLinks, linkCriticalCount, hiddenPostNote, UNMEASURED,
  type Capability, type CapabilityReadiness, type Measured, type RunnerFacts,
} from '../src/lib/d100-readiness'
import {
  RECOVERY_PLAN, CANARY_CONTRACT, ESCALATION_LADDER, NO_AUTO_RETRY_SIGNALS,
  capacities82, judgeLadder, TOP_STEP_INCIDENT_FREE_DAYS,
} from '../src/lib/collect-82cook-recovery'
import {
  readOperationalStock, readCurrentStageDecision, runReadiness,
} from './lib/d100-operational-stock.mjs'
import { SNAPSHOT_PATH } from './lib/d100-ready-snapshot.mjs'
import { describeProduction, MIN_PRODUCTION_DAYS } from '../src/lib/d100-supply-funnel'
import { NORTH_STAR_MISSING_EVENTS, northStar } from '../src/lib/north-star'
import { collectCapabilityFailing } from '../src/lib/job-health'
import { observeJob, readProcessRuns, supplyFailing } from './lib/runner-health.mjs'
import { readLoopFunnel } from './lib/d100-loop-funnel-read.mjs'
import { describeLoopFunnel } from '../src/lib/d100-loop-funnel'

const JSON_OUT = process.argv.slice(2).includes('--json')

/** 🔴 두 기준 — 코드는 이 트리, 운영은 배포된 runtime 의 pin */
const RUNTIME_DIR = '/Users/yanadoo/Documents/soransoran-runtime'
const APP_DIR = join(homedir(), 'Library', 'Application Support', 'soransoran')

const sh = (cmd: string, args: readonly string[], cwd?: string): string => {
  try { return execFileSync(cmd, args, { cwd, encoding: 'utf-8' }).trim() } catch { return '' }
}

const codeSha = sh('git', ['rev-parse', 'HEAD'])
const runtimeSha = existsSync(RUNTIME_DIR) ? sh('git', ['rev-parse', 'HEAD'], RUNTIME_DIR) : ''
const pinSha = existsSync(join(APP_DIR, 'runtime-pinned-sha'))
  ? readFileSync(join(APP_DIR, 'runtime-pinned-sha'), 'utf-8').trim() : ''

/** 🔴 launchctl 에 올라와 있는 job 이름 — 등록과 load 를 구분한다 */
const loadedJobs = new Set(
  sh('launchctl', ['list']).split('\n')
    .map((l) => l.split('\t')[2] ?? '').filter((n) => n.startsWith('com.soransoran.')),
)
const plistDir = join(homedir(), 'Library', 'LaunchAgents')
const installed = (label: string): boolean => existsSync(join(plistDir, `${label}.plist`))

/** 🔴 env 스위치 — **이름만** 읽는다. 값은 true/false 만 본다 */
const envText = existsSync(join(APP_DIR, 'env.local'))
  ? readFileSync(join(APP_DIR, 'env.local'), 'utf-8') : ''
const envFlag = (name: string): boolean =>
  new RegExp(`^${name}=true\\s*$`, 'm').test(envText)

/**
 * 🔴 **지금 단계는 StageDecision 하나가 정한다** (2026-09-30 · source-slot-v1). env 파일을 읽지 않는다 —
 *    앞판은 `SORAN_RELEASE_STAGE` 를 읽어 결정 테이블과 따로 놀았다(A2 C8 · `PROVENANCE_CURRENT` 의 원인).
 *    오늘 결정이 없으면 가장 안전한 d1 로 **보고**한다(단계를 정하는 것이 아니다 — 보여 줄 뿐이다).
 * 🔴 이 화면은 승격을 판정하지 않는다 — `judgePromotion` 을 지웠다. 승급은 `stage:controller` 하나다.
 */
const decisionRead = await readCurrentStageDecision(new Date())
const decision = decisionRead.ok ? decisionRead.decision : null
const currentReleaseStage: RuntimeStage = decision?.release ?? SAFEST_STAGE
/** 🔴 **다음** 단계 — 보고용 필요량 표 · Persona 3계층 목표가 이 단계를 쓴다 */
const nextStage: D100Stage = currentReleaseStage === 'd1' ? D100_STAGES[0]
  : (d100NextStage(currentReleaseStage as D100Stage) ?? currentReleaseStage as D100Stage)
/** 🔴 d1 은 D100 표에 없다 — 없는 칸을 d3 으로 올려 읽지 않는다 */
const currentPlan = (D100_STAGES as readonly string[]).includes(currentReleaseStage) ? d100Plan(currentReleaseStage as D100Stage) : null
const plan = d100Plan(nextStage)

/**
 * 🔴 **운영 DB 를 read-only 로 읽는다.** Raw SQL 0 · write 0.
 *    못 읽으면 0 이 아니라 `readFailed` 다 — 재고 없음과 못 읽음을 같은 화면으로 두지 않는다.
 */
const RECORD_SNAPSHOT = process.argv.slice(2).includes('--record-snapshot')
/**
 * 🔴 **발행 runner 가 올라가 있는가** — 예약량과 예측값을 가르는 사실이다.
 *    DB 를 읽기 **전에** 정해야 reader 가 두 값을 따로 낼 수 있다.
 */
const PUBLISH_LABEL = 'com.soransoran.original-post-runner'
const publishRunnerLoaded = installed(PUBLISH_LABEL) && loadedJobs.has(PUBLISH_LABEL)

/**
 * 🔴 **조립은 `runReadiness` 한 곳이 한다.** 여기서 인라인으로 판단하면
 *    그 판단이 정말 도는지 fixture 가 물어볼 수 없다 — 앞판이 그래서 뚫렸다.
 */
const run = await runReadiness({
  read: () => readOperationalStock(new Date(), {
    targetStage: nextStage,
    /**
     * 🔴 공급이 **예약으로** 도는가. 스위치가 꺼져 있으면 최근 산출물이 있어도
     *    그것은 손으로 돌린 회차이고, 정기 생산율의 근거가 되지 않는다.
     */
    scheduledSupplyOn: envFlag('SORAN_SUPPLY_PROCESS_ENABLED')
      && installed('com.soransoran.supply-process'),
    repoRoot: process.cwd(),
    recordSnapshot: RECORD_SNAPSHOT,
  }),
  recordSnapshot: RECORD_SNAPSHOT,
})
if (run.exitCode !== 0) {
  // 🔴 적으라고 했는데 못 적었으면 **실패로 끝낸다** — 조용히 넘어가지 않는다
  console.error(`🔴 ${run.failure ?? '알 수 없는 실패'}`)
  process.exit(run.exitCode)
}
const read = run.stock
const funnel = read.ok ? read.funnel : null
const linkSummary = read.ok ? read.links : summarizeLinks([])
const activePersonas: Measured = read.ok ? read.activePersonas : null
/** 🔴 관측값이다 — 못 읽었거나 창 안에 아무 것도 없으면 `null`(unmeasured) 이다 */
const detailPerDay: Measured = read.ok ? read.detailPerDay : null
/** 🔴 **새로 품질을 통과한 생산량.** 여유율 20% 가 붙는 값이다 */
const readyQualifiedPerDay: Measured = read.ok ? read.readyQualifiedPerDay : null
/** 🔴 **재고 증감.** 생산량과 다른 값이고, 여기에 4/day 를 요구하지 않는다 */
const readyStockDeltaPerDay: Measured = read.ok ? read.readyStockDeltaPerDay : null
const publishedPerDay: Measured = read.ok ? read.publishedPerDay : null
/** 🔴 계약 유효 Persona — Persona 레인 제공자(주입 인터페이스). 연결 전에는 모름(null) · 활성 행 수로 대체하지 않는다 */
const contractValidPersonas: Measured = read.ok ? read.contractValidPersonas : null

/**
 * 🔴 **하나의 루프 깔때기 — 관측 전용** (2026-09-30 · D100 canon "Required operating measures").
 *    원문 게시/수집 → 후보 → 생성 → READY → 공개 p50·p90 · 같은 날 비율 · 슬롯 채움 · 비용 · 첫 댓글 · 감사 · Persona 공백.
 *    🔴 이 값은 어떤 결정에도 들어가지 않는다 — 화면과 JSON 에만 간다. 못 읽으면 미관측이다.
 */
const loop = await readLoopFunnel(new Date(), { contractValidPersonas })

/**
 * 🔴 **runner 는 라벨 하나가 아니라 사실의 묶음이다.**
 *    설치·load·스위치·최근 실패·용량을 각각 들고 다닌다 — 하나로 뭉치면
 *    "왜 안 도는가" 에 답할 수 없고, 도는데 모자란 경우를 `ready` 로 읽는다.
 */
/**
 * 🔴 **최근 회차 성패를 실제로 읽어 넘긴다** (2026-09-28 · readiness 오판 근본 수정).
 *
 *    앞판은 여기서 `failing: null` 을 **상수로** 넘겼다. `runnerFactsOf` 는 null 을
 *    `healthUnknown` 으로 읽으므로(그것은 옳다), load 돼 있고 최근 회차가 정상인 job 도
 *    **언제나** 돌 수 없다고 나왔다 — collect·generate·publish 가 매일 빨갰다.
 *    이제 근거를 읽는다: launchd `last exit code` + 공급 회차 기록 + 수집 회차 기록.
 *    🔴 근거가 없으면 여전히 `null`(모른다)이다 — false 로 채우지 않는다.
 */
const factsOf = (label: string, enabled: boolean, failing: boolean | null, cap?: {
  requiredPerDay: number; observedPerDay: Measured
}): RunnerFacts => runnerFactsOf({
  installed: installed(label), loaded: loadedJobs.has(label), enabled,
  failing,
  requiredPerDay: cap?.requiredPerDay,
  observedPerDay: cap?.observedPerDay ?? null,
})

/**
 * 🔴 계측 능력은 **필요한 이벤트가 하나라도 없으면 미등록**이다.
 *    목록을 `readonly string[]` 으로 넓혀 둔다 — 튜플로 두면 `length === 0` 이
 *    컴파일 시점에 `false` 로 굳어, 이벤트를 채워도 판정이 바뀌지 않는다.
 */
function measureFacts(): RunnerFacts {
  const missing: readonly string[] = NORTH_STAR_MISSING_EVENTS
  const have = missing.length === 0
  return runnerFactsOf({ installed: have, loaded: have, enabled: true, failing: null })
}

/** 🔴 공급원별 수집 job — 하나만 보여 주면 나머지가 죽어도 초록이다 */
const COLLECT_JOBS = [
  { source: 'navercafe:wgang', label: 'com.soransoran.navercafe-collect-wgang-multi', env: null },
  { source: 'navercafe:remonterrace', label: 'com.soransoran.navercafe-collect-remonterrace-multi', env: null },
  // 🔴 82cook 은 **필수 공급원**인데 지금 등록되어 있지 않다. 그 사실이 화면에 보여야 한다
  { source: '82cook', label: 'com.soransoran.raw-collect-82cook', env: 'SORAN_82COOK_COLLECT_ENABLED' },
] as const

const collectJobs = COLLECT_JOBS.map((j) => ({
  source: j.source,
  label: j.label,
  /**
   * 🔴 **최근 회차 성패를 실제로 읽는다.** 수집만은 회차 기록이 있어 알 수 있다 —
   *    기록이 없으면 `null`(모른다) 이고, 그러면 `ready` 가 아니다.
   */
  facts: runnerFactsOf({
    installed: installed(j.label), loaded: loadedJobs.has(j.label),
    enabled: j.env === null ? true : envFlag(j.env),
    failing: read.ok ? (read.collectFailing[j.source] ?? null) : null,
  }),
}))

/** 🔴 공급·발행·댓글 job 의 launchd 관측 — read-only (`launchctl print`) */
const SUPPLY_LABEL = 'com.soransoran.supply-process'
const COMMENT_LABEL = 'com.soransoran.persona-comment-runner'
const supplyObs = observeJob(SUPPLY_LABEL)
const publishObs = observeJob(PUBLISH_LABEL)
const commentObs = observeJob(COMMENT_LABEL)

const facts: Readonly<Record<Capability, RunnerFacts>> = {
  /**
   * 🔴 수집은 job 이 올라와 있는 것으로 끝나지 않는다 —
   *    **이 단계가 요구하는 상세 건수를 실제로 채우는가**까지 본다.
   */
  /**
   * 🔴 **수집은 job 하나가 아니다** (2026-09-21 3차 보정).
   *    앞판은 wgang 하나만 보고 `collect: ready` 라 적었다 — remonterrace 도 82cook 도
   *    같은 능력에 들어가는데 화면에 없었다. 아래 `collectJobs` 가 전부를 따로 보여 주고,
   *    능력 판정은 **목표 단계의 실측 상세/day** 로 한다.
   */
  collect: factsOf('com.soransoran.navercafe-collect-wgang-multi', true,
    // 🔴 켜져 있는 공급원 **전부**의 최근 회차 — 이미 위에서 읽은 값을 능력 판정에도 넘긴다
    collectCapabilityFailing(collectJobs.map((j) => ({ enabled: j.facts.enabled, failing: j.facts.failing }))), {
    requiredPerDay: plan.detailedSourcesRequiredPerDay, observedPerDay: detailPerDay,
  }),
  generate: factsOf(SUPPLY_LABEL, envFlag('SORAN_SUPPLY_PROCESS_ENABLED'),
    supplyFailing(supplyObs, readProcessRuns().runs), {
    // 🔴 생성 능력이 답할 질문은 "얼마나 **만드는가**" 다 — 재고가 얼마나 늘었나가 아니다
    requiredPerDay: plan.readyQualifiedRequiredPerDay, observedPerDay: readyQualifiedPerDay,
  }),
  publish: factsOf(PUBLISH_LABEL, true, publishObs.launchdFailing),
  comment: factsOf(COMMENT_LABEL, true, commentObs.launchdFailing),
  /**
   * 🔴 계측은 job 이 아니다 — **재방문 이벤트가 없으면 잴 수 없다.**
   *    지금은 `session_start`·`engaged_session`·`return_visit` 가 없어 미등록이다.
   */
  measure: measureFacts(),
}

const readiness: CapabilityReadiness = {
  collect: facts.collect.state, generate: facts.generate.state,
  publish: facts.publish.state, comment: facts.comment.state, measure: facts.measure.state,
}


/**
 * 🔴 **재지 않았다.** actor 별 0 을 넣는 것이 아니라 **빈 집계 + `measuredWeeks: null`** 이다 —
 *    `northStar` 는 필요한 이벤트가 없다는 사실만으로 이미 `measured:false` 를 낸다.
 */
/**
 * 🔴 82cook 용량 — 아직 아무것도 재지 않았다. 관측값은 `null` 이다.
 *    무사 회차도 0 이라 사다리는 첫 칸이다.
 */
/**
 * 🔴 아직 아무 회차도 돌지 않았다 — 1칸이고, 관측도 승인도 없다.
 *    `operatingApprovedBy: null` 이 자동 승격을 막는 자물쇠다.
 */
const ladder = judgeLadder({
  currentStep: 1, cleanRunsInCurrentStep: 0,
  incidentFreeDaysInCurrentStep: 0, sawAbortSignal: false,
})
const cap82 = capacities82({
  requiredDetailPerDayAllSources: d100Plan('d100').detailedSourcesRequiredPerDay,
  ladder, listPagesPerRun: 1, canaryRunsPerDay: 4,
  observedDetailPerDay: null, observedDetailPerRun: null,
  operatingApprovedBy: null,
})

const ns = northStar({ returningByActor: {}, returningEngagedByActor: {}, measuredWeeks: null })

if (JSON_OUT) {
  console.log(JSON.stringify({
    basis: { codeSha, runtimeSha, pinSha, mixed: codeSha !== runtimeSha },
    currentReleaseStage,
    /** 🔴 지금 단계의 출처 — 오늘 StageDecision(없으면 null · 보고는 d1) */
    stageDecision: decision,
    stageDecisionReadError: decisionRead.ok ? null : decisionRead.detail,
    currentPlan,
    nextStage,
    plan,
    stock: read.ok ? funnel : { readFailed: read.detail },
    // 🔴 `d100:funnel` 과 **같은 selector** 의 산물 — 집합으로 대조한다
    readyStockIds: read.ok ? read.readyStockIds : null,
    activePersonas: activePersonas === null ? UNMEASURED : activePersonas,
    capabilities: readiness,
    capabilityFacts: facts,
    collectJobs: collectJobs.map((j) => ({ source: j.source, label: j.label, ...j.facts })),
    capabilitiesReady: allCapabilitiesReady(readiness),
    blockers: capabilityBlockers(readiness),
    scheduler: Object.fromEntries(allD100Plans().map((p) => [p.stage, p.scheduler])),
    throughput: {
      detailPerDay,
      detailBySource: read.ok ? read.detail.bySource : null,
      detailUnmeasuredSources: read.ok ? read.detail.unmeasuredSources : DETAIL_SOURCES,
      // 🔴 생산량과 재고 증감은 **다른 값**이다. 한 칸에 합치지 않는다
      readyQualifiedPerDay,
      readyProduction: read.ok ? read.readyProduction : null,
      readyRunFact: read.ok ? read.readyRunFact : null,
      readyStockDelta: read.ok ? read.readyStockDelta
        : { measured: false, reason: '재고를 읽지 못했다' },
      readyStockDeltaPerDay,
      publishedPerDay,
      currentDailyTarget: profileOf(currentReleaseStage).dailyTarget,
      throughputWindowDays: read.ok ? read.throughputWindowDays : null,
      snapshotPath: SNAPSHOT_PATH,
    },
    persona: {
      /** 🔴 다음 단계 preflight 가 읽는 값 — Persona 4상태 정본의 `contractValid` (모르면 null) */
      contractValid: contractValidPersonas,
      /** 🔴 active 행 수 — **용량이 아니다**(보고용 참고값). 어떤 목표와도 견주지 않는다 */
      activeRowsNotCapacity: activePersonas,
      /**
       * 🔴 **단계마다 두 목표 대비 공백 — 계약 유효 수 기준** (2026-09-30 정정). 앞판은 active 카드 수를
       *    견줘 "d3·d5 충족" 을 찍었다 — 같은 화면의 preflight(계약 유효 수)와 두 답이었다.
       */
      targetsByContractValid: D100_STAGES.map((st) => personaTargetReport(st, contractValidPersonas)),
    },
    // 🔴 14일 예약 예측을 지웠다(2026-09-30) — 다가오는 슬롯 수요는 `supply:health` 의 JIT 한 곳이 보여 준다
    scheduled: { publishRunnerLoaded },
    /** 🔴 관측 전용 — 결정에 쓰이지 않는다. 못 읽었으면 `{ unobserved }` */
    loopFunnel: loop.ok ? loop.funnel : { unobserved: loop.detail },
    links: linkSummary, linkCritical: linkCriticalCount(linkSummary),
    northStar: ns,
    stages: allD100Plans(),
    recovery82cook: {
      plan: RECOVERY_PLAN, canary: CANARY_CONTRACT,
      capacities: cap82, ladder, ladderAll: ESCALATION_LADDER,
      noAutoRetry: NO_AUTO_RETRY_SIGNALS,
    },
  }, null, 2))
} else {
  console.log('\n══ D100 통합 준비도 (read-only · DB write 0 · 네트워크 0) ══\n')
  console.log('  기준 SHA')
  console.log(`    코드  ${codeSha || '(모름)'}`)
  console.log(`    운영  ${runtimeSha || '(모름)'}${codeSha !== runtimeSha ? '  🔴 코드와 운영 기준이 다르다' : ''}`)
  console.log(`    pin   ${pinSha || '(모름)'}`)

  console.log('\n  단계 — 🔴 지금 돌고 있는 것과 올라가려는 것은 다른 값이다')
  console.log(`    지금 운영(StageDecision)  ${currentReleaseStage}`
    + `  · 하루 ${profileOf(currentReleaseStage).dailyTarget}편`
    + `${decision === null ? '  🔴 오늘 결정이 없다(보고는 d1)' : ` · ${decision.state} · ${decision.contractVersion}`}`)
  if (!decisionRead.ok) console.log(`      · 🔴 결정을 읽지 못했다 — ${decisionRead.detail}`)
  console.log(`    다음 단계              ${nextStage}  · 하루 ${plan.publicPostsPerDay}편`)
  if (currentPlan === null) {
    console.log(`    🔴 ${currentReleaseStage} 은 D100 용량표에 없는 칸이다 (표는 d3 부터다)`)
  }

  console.log('\n⓪ 하나의 루프 깔때기 — 🔴 관측 전용 · 최근 7일 · 원문 게시 시각은 gateResults.sourceEvidence 에서만')
  if (!loop.ok) console.log(`    미관측 — ${loop.detail}`)
  else for (const l of describeLoopFunnel(loop.funnel)) console.log(`    ${l}`)

  console.log('\n① 능력별 준비도 — 🔴 하나로 뭉쳐 GREEN 이라 하지 않는다')
  console.log('    능력       상태              설치 load 스위치 최근실패 용량')
  for (const c of CAPABILITIES) {
    const f = facts[c]
    const mark = capabilityFactsReady(f) ? '🟢' : f.state === 'disabledByPolicy' ? '🟡' : '🔴'
    // 🔴 `?` 는 **모른다**는 표시다 — 아니다(✕)와 다르다
    const tri = (v: boolean | null): string => v === null ? ' ?' : v ? ' ○' : ' ✕'
    console.log(`    ${mark} ${c.padEnd(8)} ${f.state.padEnd(16)}`
      + `${tri(f.installed)}  ${tri(f.loaded)}   ${tri(f.enabled)}    ${tri(f.failing)}   ${tri(f.capacitySatisfied)}`)
    if (f.reason !== null) console.log(`        · ${f.reason}`)
  }
  console.log('    수집 job — 🔴 공급원마다 따로 본다')
  for (const j of collectJobs) {
    const f = j.facts
    const tri = (v: boolean | null): string => v === null ? ' ?' : v ? ' ○' : ' ✕'
    console.log(`      ${j.source.padEnd(22)} ${f.state.padEnd(16)}`
      + `${tri(f.installed)}  ${tri(f.loaded)}   ${tri(f.enabled)}    ${tri(f.failing)}`)
  }
  console.log(`    전체 ${allCapabilitiesReady(readiness) ? '🟢 준비됨' : '🔴 준비되지 않음'}`)
  for (const b of capabilityBlockers(readiness)) console.log(`      · ${b}`)

  console.log('\n①-b 재고 깔때기 — 🔴 운영 DB 를 read-only 로 읽었다')
  if (funnel === null) {
    console.log(`    🔴 읽지 못했다 — ${read.ok ? '' : read.detail}`)
    console.log('    🔴 0 으로 채우지 않는다. 재고 없음과 못 읽음은 다른 상태다')
  } else {
    const F = funnel
    for (const [label, v] of [
      ['큐 전체', F.queueTotal], ['미발행 APPROVED·EDITED', F.unpublishedApproved],
      ['legacy 제외', F.legacyExcluded], ['profile 맞음', F.profileCompatible],
      ['사람 검토 완료', F.humanReviewed], ['TTL 신선', F.fresh],
      ['Persona 배정 가능', F.personaAssignable], ['지금 발행 가능', F.publishableNow],
      ['재고(readyStock)', F.readyStock],
    ] as const) console.log(`    ${label.padEnd(22)} ${String(v).padStart(5)}`)
    console.log(`    활성 Persona           ${showMeasured(activePersonas)}`)
    console.log(`    Queue↔Post  정상 ${linkSummary.visiblePublished}`
      + ` · 숨겨짐 ${linkSummary.hiddenPost}`
      + ` · 🔴 연결 끊김 ${linkSummary.orphan}`
      + ` · 🔴 모르는 상태 ${linkSummary.realMismatch}`
      + `  (CRITICAL ${linkCriticalCount(linkSummary)})`)
    const note = hiddenPostNote(linkSummary)
    if (note !== null) console.log(`    ${note}`)
  }

  console.log('\n② 처리량 — 🔴 측정되지 않은 값은 unmeasured 다')
  console.log('    🔴 상세는 **수집 회차 기록**이 근거다 — DB 행 수를 세지 않는다')
  if (read.ok) {
    for (const b of read.detail.bySource) {
      console.log(`      ${b.source.padEnd(22)} ${showMeasured(b.perDay).padStart(10)}/day`
        + `  (성공 ${b.successRuns}회 · 실패 ${b.failedRuns}회 · 신규 ${b.newDetailRows}건)`)
    }
    if (read.detail.unmeasuredSources.length > 0) {
      console.log(`      🔴 잴 수 없는 공급원: ${read.detail.unmeasuredSources.join(' · ')}`)
    }
  }
  console.log(`    상세 수집/day 합계  ${showMeasured(detailPerDay)}`)
  console.log('    🔴 **생산량**과 **재고 증감**은 다른 값이다 — 여유율 20% 는 생산량에 붙는다')
  console.log(`    READY 생산량/day    ${showMeasured(readyQualifiedPerDay)}`
    + `   (목표 ${plan.readyQualifiedRequiredPerDay}/day)`)
  if (read.ok) {
    for (const l of describeProduction(read.readyProduction, read.readyRunFact)) {
      console.log(`      · ${l}`)
    }
    console.log(`      · 정기 생산율을 재려면 공급이 예약으로 돌고 산출이 있던 날이`
      + ` ${MIN_PRODUCTION_DAYS}일 이상이어야 한다`)
  }
  console.log(`    재고 증감/day       ${showMeasured(readyStockDeltaPerDay)}`
    + '   🔴 여기에 목표를 요구하지 않는다. 재고를 채운 뒤 음수면 고갈 위험이다')
  if (read.ok && !read.readyStockDelta.measured) console.log(`      · ${read.readyStockDelta.reason}`)
  if (read.ok && read.readyStockDelta.measured) {
    console.log(`      · ${read.readyStockDelta.fromStock} → ${read.readyStockDelta.toStock}`
      + ` (${read.readyStockDelta.spanDays}일 · ${read.readyStockDelta.fromAt})`)
  }
  console.log(`    공개 발행/day       ${showMeasured(publishedPerDay)}`
    + `   (${currentReleaseStage} 자기 목표 ${profileOf(currentReleaseStage).dailyTarget}/day)`)
  console.log(`    발행 runner ${publishRunnerLoaded ? '올라와 있다' : '🔴 내려가 있다'}`
    + ' — 🔴 연속 달성 일수 · 14일 예약 예측은 지웠다(달력 대기 · 재고 전망은 승급 근거가 아니다)')
  console.log(`    🔴 순증가 시계열: ${SNAPSHOT_PATH}`)
  console.log('       (시작하려면 --record-snapshot · 🔴 과거 값은 만들 수 없다)')

  console.log('\n②-b Persona — 🔴 계약 유효 수는 Persona 레인 정본 하나다(여기서 다시 판정하지 않는다)')
  console.log(`    계약 유효 Persona      ${contractValidPersonas === null ? '⬚ 미관측 — 4상태 정본을 읽지 못했다 (preflight PERSONA_UNKNOWN)' : `${contractValidPersonas}명`}`)
  console.log(`    active 행(참고)        ${activePersonas ?? '?'}명 — 🔴 용량이 아니다. 어떤 하한과도 견주지 않는다`)
  /**
   * 🔴 `judgeNextPreflight` 는 **다음 단계**의 canary 하한을 본다. 그래서 계약 유효 수가 d3 하한보다 작으면
   *    D3→D5 가 아니라 **D1→D3 부터** 막힌다(옛 보고 "Persona 0명이라 D3→D5 승급이 막힌다" 는 틀렸다).
   */
  const firstShort = contractValidPersonas === null ? null
    : D100_STAGES.find((st) => (personaTargetReport(st, contractValidPersonas).canaryGap ?? 0) > 0) ?? null
  if (firstShort !== null) {
    const prev = D100_STAGES.indexOf(firstShort) === 0 ? 'D1' : D100_STAGES[D100_STAGES.indexOf(firstShort) - 1]!.toUpperCase()
    console.log(`    🔴 ${prev}→${firstShort.toUpperCase()} 부터 preflight PERSONA_SHORT`
      + ` — 다음 단계 canary 하한 ${personaTargetReport(firstShort, contractValidPersonas).canaryFloor}명`)
  }
  for (const st of D100_STAGES) {
    console.log(`      · ${describePersonaTargets(personaTargetReport(st, contractValidPersonas))}`)
  }

  console.log(`\n③ 단계별 필요량 (지금 운영 ${currentReleaseStage} · 다음 ${nextStage})`)
  console.log('    🔴 공개량 · READY 생산량은 서로 다른 값이다 — 14일치 재고 목표는 지웠다(2026-09-30)')
  console.log('    단계   공개/day  READY생산/day  상세/day  P.canary  P.지속  댓글/day')
  for (const p of allD100Plans()) {
    console.log(`    ${p.stage.padEnd(6)} ${String(p.publicPostsPerDay).padStart(7)}`
      + `  ${String(p.readyQualifiedRequiredPerDay).padStart(12)}`
      + `  ${String(p.detailedSourcesRequiredPerDay).padStart(8)}`
      + `  ${String(p.personaCanaryFloor).padStart(8)}`
      + `  ${`${p.personaSustainedTarget}${p.stage === 'd100' ? '+' : ''}`.padStart(6)}`
      + `  ${`${p.commentMinPerDay}~${p.commentMaxPerDay}`.padStart(8)}`)
  }
  console.log('    📜 최소 관측 일수(7·14·21일) 칸은 지웠다 — 달력 대기는 승급 조건이 아니다(canon §6)')
  console.log('    🔴 Persona 는 두 값이다 — P.canary = 하루 시험 하한(승격 preflight 가 보는 값)'
    + ' · P.지속 = 계속 운영할 다양성 목표(보고만 · canary 를 막지 않는다)')
  console.log(`    🔴 READY **생산** 목표 = 공개량 × ${READY_NET_MARGIN} (올림) —`
    + ' 같게 두면 재고가 영원히 늘지 않는다')
  console.log('    🔴 이 목표는 **재고 증감**에 요구하지 않는다 —'
    + ' 4건 만들어 3건 내보내 +1 인 것은 정상이다')

  console.log('\n③-b 스케줄러가 실제로 감당하는가 — 🔴 계획 슬롯이 아니라 예약된 cron 이다')
  console.log('    단계   release  예약회차/day  회차당  실제발행/day  필요/day  판정')
  for (const p of allD100Plans()) {
    const sc = p.scheduler
    console.log(`    ${p.stage.padEnd(6)} ${(sc.releaseStage ?? '(없음)').padEnd(7)}`
      + `  ${String(sc.scheduledSlotsPerDay ?? '-').padStart(11)}`
      + `  ${String(sc.actualPostsPerInvocation).padStart(6)}`
      + `  ${String(sc.actualDailyPublishable ?? '-').padStart(11)}`
      + `  ${String(p.publicPostsPerDay).padStart(8)}`
      + `  ${sc.supported ? '🟢 감당' : `🔴 ${sc.reason}`}`)
    if (sc.detail !== null) console.log(`        · ${sc.detail}`)
  }

  console.log(`\n④ 단계 — ${currentReleaseStage} 운영 중 · 다음 증명 ${nextStage}`)
  console.log('    🔴 승급 판정은 이 화면에 없다 — `npm run stage:controller`(dry-run) 가 운영 증거 PASS +'
    + ' `judgeNextPreflight`(증명일 slot-valid 기회 · 처리량 · 계약 유효 Persona · 비용 · 러너) 로 정한다')
  console.log('    🔴 지운 판정: 현 단계 연속 달력 일수 stable · 다음 단계 14일치 재고 preflight · 사람 env 승격 문구')

  console.log('\n⑤ North Star — 주간 재방문 참여 실사용자')
  console.log(`    ${ns.measured ? `${ns.weeklyReturningEngagedUsers}명` : `unmeasured — ${ns.reason}`}`)
  console.log(`    더 필요한 이벤트: ${NORTH_STAR_MISSING_EVENTS.join(' · ')}`)
  console.log('    🔴 발행량·Persona 활동은 North Star 가 아니다 — 수단이다')

  console.log('\n⑥ 82cook 복구 일정 — 🔴 필수 공급원. 대체 대상이 아니다')
  for (const s of RECOVERY_PLAN) {
    console.log(`    ${s.phase.padEnd(9)} ${s.window.padEnd(22)} 요청 ${s.sendsRequests ? '있음' : '0'} · 등록 ${s.registersJob ? '가능' : '0'}`)
    console.log(`      ${s.action}`)
  }
  console.log(`    canary 계약  동시성 ${CANARY_CONTRACT.concurrency} · 회차 ${CANARY_CONTRACT.maxDetailPerRun}건`
    + ` · 간격 ${CANARY_CONTRACT.minGapMs / 1000}~${CANARY_CONTRACT.maxGapMs / 1000}초`
    + ` · 회차 간 ${CANARY_CONTRACT.minRestBetweenRunsMs / 3600_000}시간 · 하루 ${CANARY_CONTRACT.maxRequestsPerDay}요청`)
  console.log('    🔴 목록 요청도 이 예산에 든다 — 상세만 세지 않는다')

  console.log('\n⑥-b 82cook 용량 네 값 — 🔴 canary 값을 운영 목표로 읽지 않는다')
  console.log('    종류        회차당  하루상세  하루요청  설명')
  for (const c of Object.values(cap82)) {
    console.log(`    ${c.kind.padEnd(10)} ${String(c.detailPerRun ?? '-').padStart(6)}`
      + `  ${String(c.detailPerDay ?? '-').padStart(8)}`
      + `  ${String(c.requestsPerDay ?? '-').padStart(8)}  ${c.note}`)
  }
  console.log('    확대 사다리')
  for (const l of ESCALATION_LADDER) {
    const cond = l.incidentFreeDaysInPrevStep > 0
      ? `직전 칸에서 🔴 ${l.incidentFreeDaysInPrevStep}일 무사고`
      : l.cleanRunsInPrevStep > 0 ? `직전 칸에서 무사 ${l.cleanRunsInPrevStep}회` : '시작'
    console.log(`      ${l.step}) ${String(l.maxDetailPerRun).padStart(2)}건/회차`
      + ` · ${l.maxRunsPerDay}회/day  ← ${cond}`)
  }
  console.log(`    지금 칸      ${ladder.step.step}칸 · ${ladder.step.note}`)
  console.log(`    다음 칸 제안 ${ladder.mayProposeNext ? '가능' : '🔴 불가'}`
    + `${ladder.decelerated ? ' · 🔴 사고로 감속했다' : ''}`)
  for (const b of ladder.blocking) console.log(`      · ${b}`)
  console.log(`    🔴 마지막 칸은 **${TOP_STEP_INCIDENT_FREE_DAYS}일 무사고**가 조건이다`
    + ' — 회차 수로 대체하지 않는다')
  console.log('    🔴 자동 승격은 없다 — 사람 승인 전에는 operating 이 값을 갖지 않는다')
  console.log(`    자동 재시도 금지 신호  ${NO_AUTO_RETRY_SIGNALS.join(' · ')}`
    + ' — 🔴 상대의 답이다. 사람이 본다')

  console.log('\n🔴 이 명령은 아무것도 바꾸지 않았다 — DB write 0 · 네트워크 0 · LLM 0\n')
}
