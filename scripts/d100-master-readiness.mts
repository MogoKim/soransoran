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
  allD100Plans, d100Plan, judgePromotion, nextStage, READY_NET_MARGIN, type D100Stage,
} from '../src/lib/d100-capacity'
import {
  CAPABILITIES, allCapabilitiesReady, capabilityBlockers, runnerFactsOf, capabilityFactsReady,
  showMeasured, summarizeLinks, linkCriticalCount, hiddenPostNote, UNMEASURED,
  type Capability, type CapabilityReadiness, type Measured, type RunnerFacts,
} from '../src/lib/d100-readiness'
import {
  RECOVERY_PLAN, CANARY_CONTRACT, ESCALATION_LADDER, NO_AUTO_RETRY_SIGNALS,
  capacities82, ladderStepFor,
} from '../src/lib/collect-82cook-recovery'
import { readOperationalStock } from './lib/d100-operational-stock.mjs'
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

const stage: D100Stage = 'd3'
const plan = d100Plan(stage)

/**
 * 🔴 **운영 DB 를 read-only 로 읽는다.** Raw SQL 0 · write 0.
 *    못 읽으면 0 이 아니라 `readFailed` 다 — 재고 없음과 못 읽음을 같은 화면으로 두지 않는다.
 */
const read = await readOperationalStock()
const funnel = read.ok ? read.funnel : null
const linkSummary = read.ok ? read.links : summarizeLinks([])
const activePersonas: Measured = read.ok ? read.activePersonas : null
/** 🔴 관측값이다 — 못 읽었거나 창 안에 아무 것도 없으면 `null`(unmeasured) 이다 */
const detailPerDay: Measured = read.ok ? read.detailPerDay : null
const readyNetPerDay: Measured = read.ok ? read.readyNetPerDay : null
const observedDays = read.ok ? read.observedDays : 0

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

const readiness: CapabilityReadiness = {
  collect: facts.collect.state, generate: facts.generate.state,
  publish: facts.publish.state, comment: facts.comment.state, measure: facts.measure.state,
}

const promo = judgePromotion({
  stage,
  // 🔴 못 읽었으면 승격 판정도 하지 않는다 — 0 으로도 -1 로도 내려가지 않는다
  readyStock: funnel?.readyStock ?? null,
  activePersonas,
  detailPerDay, readyNetPerDay, observedDays,
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
const ladder = ladderStepFor({ cleanRuns: 0, sawAbortSignal: false })
const cap82 = capacities82({
  requiredDetailPerDayAllSources: d100Plan('d100').detailedSourcesRequiredPerDay,
  ladder, listPagesPerRun: 1, runsPerDay: 4,
  observedDetailPerDay: null, observedDetailPerRun: null,
})

const ns = northStar({ returningByActor: {}, returningEngagedByActor: {}, measuredWeeks: null })

if (JSON_OUT) {
  console.log(JSON.stringify({
    basis: { codeSha, runtimeSha, pinSha, mixed: codeSha !== runtimeSha },
    stage, plan, promotion: promo,
    stock: read.ok ? funnel : { readFailed: read.detail },
    activePersonas: activePersonas === null ? UNMEASURED : activePersonas,
    capabilities: readiness,
    capabilityFacts: facts,
    capabilitiesReady: allCapabilitiesReady(readiness),
    blockers: capabilityBlockers(readiness),
    scheduler: Object.fromEntries(allD100Plans().map((p) => [p.stage, p.scheduler])),
    throughput: { detailPerDay, readyNetPerDay, observedDays },
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
  console.log(`    상세 수집/day     ${showMeasured(detailPerDay)}`)
  console.log(`    READY 순증가/day  ${showMeasured(readyNetPerDay)}`)
  console.log(`    이 단계 관측 일수  ${observedDays}일`)

  console.log(`\n③ 단계별 필요량 (지금 ${stage} · 다음 ${nextStage(stage) ?? '(없음)'})`)
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
  console.log(`    확대 사다리  ${ESCALATION_LADDER.map((l) => `${l.step}) ${l.maxDetailPerRun}건/회차 (무사 ${l.minCleanRunsToEnter}회)`).join(' → ')}`)
  console.log(`    지금 칸      ${ladder.step}칸 · ${ladder.note}`)
  console.log(`    자동 재시도 금지 신호  ${NO_AUTO_RETRY_SIGNALS.join(' · ')}`
    + ' — 🔴 상대의 답이다. 사람이 본다')

  console.log('\n🔴 이 명령은 아무것도 바꾸지 않았다 — DB write 0 · 네트워크 0 · LLM 0\n')
}
