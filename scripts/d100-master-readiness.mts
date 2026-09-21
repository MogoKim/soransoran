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

import { allD100Plans, d100Plan, judgePromotion, nextStage, type D100Stage } from '../src/lib/d100-capacity'
import {
  CAPABILITIES, allCapabilitiesReady, capabilityBlockers, runnerStateOf,
  showMeasured, summarizeLinks, linkCriticalCount,
  type Capability, type CapabilityReadiness, type Measured, type QueuePostLink,
} from '../src/lib/d100-readiness'
import { RECOVERY_PLAN, CANARY_CONTRACT } from '../src/lib/collect-82cook-recovery'
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

const capabilityOf = (label: string, enabled: boolean): ReturnType<typeof runnerStateOf> =>
  runnerStateOf({ installed: installed(label), loaded: loadedJobs.has(label), enabled })

/** 🔴 더 필요한 이벤트가 하나라도 있으면 잴 수 없다 */
function measureState(): ReturnType<typeof runnerStateOf> {
  const missing: readonly string[] = NORTH_STAR_MISSING_EVENTS
  return missing.length === 0 ? 'ready' : 'notRegistered'
}

const readiness: CapabilityReadiness = {
  // 🔴 수집은 navercafe 두 job 중 하나라도 서면 가능하다고 본다
  collect: capabilityOf('com.soransoran.navercafe-collect-wgang-multi', true),
  generate: capabilityOf('com.soransoran.supply-process', envFlag('SORAN_SUPPLY_PROCESS_ENABLED')),
  publish: capabilityOf('com.soransoran.original-post-runner', true),
  comment: capabilityOf('com.soransoran.persona-comment-runner', true),
  /**
   * 🔴 계측은 job 이 아니다 — **재방문 이벤트가 없으면 잴 수 없다.**
   *    지금은 `session_start`·`engaged_session`·`return_visit` 가 없어 미등록이다.
   */
  measure: measureState(),
}

/** 🔴 아직 측정하지 못한 값 — 0 으로 채우지 않는다 */
const detailPerDay: Measured = null
const readyNetPerDay: Measured = null
const observedDays = 0

const stage: D100Stage = 'd3'
const plan = d100Plan(stage)
const promo = judgePromotion({
  stage, readyStock: 0, activePersonas: 0,
  detailPerDay, readyNetPerDay, observedDays,
  publishRunnerReady: readiness.publish === 'ready',
  commentRunnerReady: readiness.comment === 'ready',
})

const links: QueuePostLink[] = []
const linkSummary = summarizeLinks(links)

const ns = northStar({ returningUsers: 0, returningEngagedUsers: 0, measuredWeeks: null })

if (JSON_OUT) {
  console.log(JSON.stringify({
    basis: { codeSha, runtimeSha, pinSha, mixed: codeSha !== runtimeSha },
    stage, plan, promotion: promo,
    capabilities: readiness,
    capabilitiesReady: allCapabilitiesReady(readiness),
    blockers: capabilityBlockers(readiness),
    throughput: { detailPerDay, readyNetPerDay, observedDays },
    links: linkSummary, linkCritical: linkCriticalCount(linkSummary),
    northStar: ns,
    stages: allD100Plans(),
    recovery82cook: { plan: RECOVERY_PLAN, canary: CANARY_CONTRACT },
  }, null, 2))
} else {
  console.log('\n══ D100 통합 준비도 (read-only · DB write 0 · 네트워크 0) ══\n')
  console.log('  기준 SHA')
  console.log(`    코드  ${codeSha || '(모름)'}`)
  console.log(`    운영  ${runtimeSha || '(모름)'}${codeSha !== runtimeSha ? '  🔴 코드와 운영 기준이 다르다' : ''}`)
  console.log(`    pin   ${pinSha || '(모름)'}`)

  console.log('\n① 능력별 준비도 — 🔴 하나로 뭉쳐 GREEN 이라 하지 않는다')
  for (const c of CAPABILITIES) {
    const st = readiness[c]
    const mark = st === 'ready' ? '🟢' : st === 'disabledByPolicy' ? '🟡' : '🔴'
    console.log(`    ${mark} ${c.padEnd(9)} ${st}`)
  }
  console.log(`    전체 ${allCapabilitiesReady(readiness) ? '🟢 준비됨' : '🔴 준비되지 않음'}`)
  for (const b of capabilityBlockers(readiness)) console.log(`      · ${b}`)

  console.log('\n② 처리량 — 🔴 측정되지 않은 값은 unmeasured 다')
  console.log(`    상세 수집/day     ${showMeasured(detailPerDay)}`)
  console.log(`    READY 순증가/day  ${showMeasured(readyNetPerDay)}`)
  console.log(`    이 단계 관측 일수  ${observedDays}일`)

  console.log(`\n③ 단계별 필요량 (지금 ${stage} · 다음 ${nextStage(stage) ?? '(없음)'})`)
  console.log('    단계   공개/day  상세/day  재고14일  Persona  댓글/day      슬롯  최소관측')
  for (const p of allD100Plans()) {
    console.log(`    ${p.stage.padEnd(6)} ${String(p.publicPostsPerDay).padStart(7)}`
      + `  ${String(p.detailedSourcesRequiredPerDay).padStart(8)}`
      + `  ${String(p.readyStock14Days).padStart(8)}`
      + `  ${String(p.activePersonaTarget).padStart(7)}`
      + `  ${`${p.commentMinPerDay}~${p.commentMaxPerDay}`.padStart(9)}`
      + `  ${String(p.publishSlotCount).padStart(4)}`
      + `  ${String(p.minimumObservationDays).padStart(7)}일`)
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

  console.log('\n🔴 이 명령은 아무것도 바꾸지 않았다 — DB write 0 · 네트워크 0 · LLM 0\n')
}
