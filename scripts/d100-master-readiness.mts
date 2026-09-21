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
  allD100Plans, d100Plan, judgePromotion, currentPlanOf, targetStageFor,
  READY_NET_MARGIN, type D100Stage,
} from '../src/lib/d100-capacity'
import { RELEASE_ENV, PROFILES } from '../src/lib/scale-profile'
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
import { readOperationalStock, releaseStageFromEnvText } from './lib/d100-operational-stock.mjs'
import { SNAPSHOT_PATH } from './lib/d100-ready-snapshot.mjs'
import { NORTH_STAR_MISSING_EVENTS, northStar } from '../src/lib/north-star'

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
 * 🔴 **지금 단계는 코드가 아니라 env 가 정한다** (2026-09-21 3차 보정).
 *
 *    앞판은 `stage = 'd3'` 를 박아 두고 그것을 "지금 단계" 라고 적었다.
 *    실제 `SORAN_RELEASE_STAGE` 는 **d1** 이다 — 하루 1편 내는 레인을 3편이라고
 *    적어 두고 그 위에서 승격을 물었으니, 한 칸이 통째로 건너뛰어졌다.
 *
 * 🔴 판정은 정본 `resolveStage` 가 한다. 모르는 값은 가장 안전한 단계로 떨어진다.
 */
const resolved = releaseStageFromEnvText(envText)
const currentReleaseStage = resolved.stage
/** 🔴 올라가려는 단계 — 모든 승격 판정이 이 단계의 필요량을 쓴다 */
const targetStage: D100Stage = targetStageFor(currentReleaseStage)
/** 🔴 d1 은 D100 표에 없다 — 없는 칸을 d3 으로 올려 읽지 않는다 */
const currentPlan = currentPlanOf(currentReleaseStage)
const plan = d100Plan(targetStage)

/**
 * 🔴 **운영 DB 를 read-only 로 읽는다.** Raw SQL 0 · write 0.
 *    못 읽으면 0 이 아니라 `readFailed` 다 — 재고 없음과 못 읽음을 같은 화면으로 두지 않는다.
 */
const RECORD_SNAPSHOT = process.argv.slice(2).includes('--record-snapshot')
const read = await readOperationalStock(new Date(), {
  targetStage,
  // 🔴 예측기에는 **지금 운영 중인** 단계의 상한을 넘긴다 — 목표 단계가 아니다
  dailyCap: PROFILES[currentReleaseStage].dailyTarget,
  repoRoot: process.cwd(),
  recordSnapshot: RECORD_SNAPSHOT,
})
const funnel = read.ok ? read.funnel : null
const linkSummary = read.ok ? read.links : summarizeLinks([])
const activePersonas: Measured = read.ok ? read.activePersonas : null
/** 🔴 관측값이다 — 못 읽었거나 창 안에 아무 것도 없으면 `null`(unmeasured) 이다 */
const detailPerDay: Measured = read.ok ? read.detailPerDay : null
/** 🔴 **생산량이다.** 승격 입력으로 쓰지 않는다 */
const readyProducedPerDay: Measured = read.ok ? read.readyProducedPerDay : null
/** 🔴 **순증가다.** 두 시점 재고 차이로만 나온다 */
const readyNetPerDay: Measured = read.ok ? read.readyNetPerDay : null
const publishedPerDay: Measured = read.ok ? read.publishedPerDay : null
const observedDays = read.ok ? read.observedDays : 0
const personaTiers = read.ok ? read.personaTiers : []
const personaReady = read.ok ? read.personaReady : false

/**
 * 🔴 **runner 는 라벨 하나가 아니라 사실의 묶음이다.**
 *    설치·load·스위치·최근 실패·용량을 각각 들고 다닌다 — 하나로 뭉치면
 *    "왜 안 도는가" 에 답할 수 없고, 도는데 모자란 경우를 `ready` 로 읽는다.
 */
const factsOf = (label: string, enabled: boolean, cap?: {
  requiredPerDay: number; observedPerDay: Measured
}): RunnerFacts => runnerFactsOf({
  installed: installed(label), loaded: loadedJobs.has(label), enabled,
  // 🔴 최근 회차 성패는 이 명령이 읽지 않는다 — false 로 채우지 않고 모른다고 둔다
  failing: null,
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
  collect: factsOf('com.soransoran.navercafe-collect-wgang-multi', true, {
    requiredPerDay: plan.detailedSourcesRequiredPerDay, observedPerDay: detailPerDay,
  }),
  generate: factsOf('com.soransoran.supply-process', envFlag('SORAN_SUPPLY_PROCESS_ENABLED'), {
    requiredPerDay: plan.readyNetRequiredPerDay, observedPerDay: readyNetPerDay,
  }),
  publish: factsOf('com.soransoran.original-post-runner', true),
  comment: factsOf('com.soransoran.persona-comment-runner', true),
  /**
   * 🔴 계측은 job 이 아니다 — **재방문 이벤트가 없으면 잴 수 없다.**
   *    지금은 `session_start`·`engaged_session`·`return_visit` 가 없어 미등록이다.
   */
  measure: measureFacts(),
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
  facts: factsOf(j.label, j.env === null ? true : envFlag(j.env)),
}))

const readiness: CapabilityReadiness = {
  collect: facts.collect.state, generate: facts.generate.state,
  publish: facts.publish.state, comment: facts.comment.state, measure: facts.measure.state,
}

const promo = judgePromotion({
  current: currentReleaseStage,
  // 🔴 **목표 단계의 필요량**으로 잰다 — 지금 단계 수치만 채우고 올라가지 않는다
  target: targetStage,
  // 🔴 못 읽었으면 승격 판정도 하지 않는다 — 0 으로도 -1 로도 내려가지 않는다
  readyStock: funnel?.readyStock ?? null,
  /**
   * 🔴 **Persona 3계층이 전부 ready 일 때만 인원을 셌다고 말한다.**
   *    active 수만 넘기면 카드만 있는 사람이 "쓸 수 있는 사람" 으로 들어간다.
   */
  activePersonas: personaReady ? activePersonas : null,
  detailPerDay,
  // 🔴 생산량이 아니라 순증가를 넘긴다
  readyNetPerDay,
  publishedPerDay,
  observedDays,
  publishRunnerReady: capabilityFactsReady(facts.publish),
  commentRunnerReady: capabilityFactsReady(facts.comment),
})

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
    currentReleaseFromEnv: resolved.fromEnv,
    currentReleaseFallbackReason: resolved.fallbackReason,
    currentPlan,
    targetStage,
    plan, promotion: promo,
    stock: read.ok ? funnel : { readFailed: read.detail },
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
      // 🔴 생산량과 순증가는 **다른 값**이다. 한 칸에 합치지 않는다
      readyProducedPerDay,
      readyNet: read.ok ? read.readyNet : { measured: false, reason: '재고를 읽지 못했다' },
      readyNetPerDay,
      publishedPerDay,
      observedDays,
      snapshotPath: SNAPSHOT_PATH,
    },
    persona: {
      tiers: personaTiers, ready: personaReady, activeCount: activePersonas,
      missingAxes: read.ok ? read.personaMissingAxes : null,
    },
    scheduled: {
      in7Days: read.ok ? read.scheduledIn7Days : null,
      in14Days: read.ok ? read.scheduledIn14Days : null,
    },
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
  console.log(`    지금 운영(${RELEASE_ENV})  ${currentReleaseStage}`
    + `  · 하루 ${PROFILES[currentReleaseStage].dailyTarget}편`
    + `${resolved.fromEnv ? '' : '  🔴 env 값이 아니다'}`)
  if (resolved.fallbackReason !== null) console.log(`      · ${resolved.fallbackReason}`)
  console.log(`    올라가려는 단계        ${targetStage}  · 하루 ${plan.publicPostsPerDay}편`)
  if (currentPlan === null) {
    console.log(`    🔴 ${currentReleaseStage} 은 D100 용량표에 없는 칸이다 (표는 d3 부터다)`)
  }

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
  console.log(`    READY 생산량/day    ${showMeasured(readyProducedPerDay)}`
    + '   🔴 생산량이다 — 승격 입력이 아니다')
  console.log(`    READY 순증가/day    ${showMeasured(readyNetPerDay)}`)
  if (read.ok && !read.readyNet.measured) console.log(`      · ${read.readyNet.reason}`)
  if (read.ok && read.readyNet.measured) {
    console.log(`      · ${read.readyNet.fromStock} → ${read.readyNet.toStock}`
      + ` (${read.readyNet.spanDays}일 · ${read.readyNet.fromAt})`)
  }
  console.log(`    공개 발행/day       ${showMeasured(publishedPerDay)}`)
  console.log(`    예약 전망 7일/14일   ${showMeasured(read.ok ? read.scheduledIn7Days : null)}`
    + ` / ${showMeasured(read.ok ? read.scheduledIn14Days : null)}`)
  console.log(`    이 단계 관측 일수    ${observedDays}일`)
  console.log(`    🔴 순증가 시계열: ${SNAPSHOT_PATH}`)
  console.log('       (시작하려면 --record-snapshot · 🔴 과거 값은 만들 수 없다)')

  console.log('\n②-b Persona 3계층 — 🔴 active 수 하나로 준비 완료라 하지 않는다')
  if (personaTiers.length === 0) {
    console.log('    🔴 읽지 못했다')
  } else {
    for (const t of personaTiers) {
      const mark = t.ready ? '🟢' : '🔴'
      const tgt = t.target === null ? '회차마다 다름' : `목표 ${t.target}`
      console.log(`    ${mark} ${t.tier.padEnd(11)} ${t.passed}/${t.total}  (${tgt})`)
      if (t.reason !== null) console.log(`        · ${t.reason}`)
      for (const [code, n] of Object.entries(t.blocking)) {
        console.log(`        🔴 ${code} ${n}명`)
        // 🔴 "축이 비었다" 만으로는 무엇을 채울지 모른다 — 축 이름까지 적는다
        if (code === 'lifeAxisMissing' && read.ok) {
          for (const [axis, m] of Object.entries(read.personaMissingAxes)) {
            console.log(`            · ${axis} ${m}명`)
          }
        }
      }
      for (const [code, n] of Object.entries(t.unmeasured)) console.log(`        ⬚ ${code} ${n}명 (재지 않았다)`)
    }
    console.log(`    전체 ${personaReady ? '🟢 준비됨' : '🔴 준비되지 않음'}`
      + `  · active 카드 ${activePersonas ?? '?'}명`)
  }

  console.log(`\n③ 단계별 필요량 (지금 운영 ${currentReleaseStage} · 목표 ${targetStage})`)
  console.log('    🔴 공개량 · READY 순증가 · 재고는 서로 다른 값이다 — 한 칸으로 합치지 않는다')
  console.log('    단계   공개/day  READY순증/day  재고14일  상세/day  Persona  댓글/day  최소관측')
  for (const p of allD100Plans()) {
    console.log(`    ${p.stage.padEnd(6)} ${String(p.publicPostsPerDay).padStart(7)}`
      + `  ${String(p.readyNetRequiredPerDay).padStart(12)}`
      + `  ${String(p.readyStock14Days).padStart(8)}`
      + `  ${String(p.detailedSourcesRequiredPerDay).padStart(8)}`
      + `  ${String(p.activePersonaTarget).padStart(7)}`
      + `  ${`${p.commentMinPerDay}~${p.commentMaxPerDay}`.padStart(8)}`
      + `  ${String(p.minimumObservationDays).padStart(6)}일`)
  }
  console.log(`    🔴 READY 순증가 목표 = 공개량 × ${READY_NET_MARGIN} (올림) —`
    + ' 같게 두면 재고가 영원히 늘지 않는다')

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

  console.log('\n④ 다음 단계로 올려도 되는가')
  console.log(`    ${promo.ready ? '🟢 올려도 된다' : '🔴 아직이다'}`)
  for (const b of promo.blocking) console.log(`      🔴 ${b}`)
  for (const u of promo.unmeasured) console.log(`      ⬚ 측정되지 않음: ${u}`)

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
