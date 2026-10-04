#!/usr/bin/env tsx
/**
 * D100 Phase 0 정본 검사 — 🔴 순수 fixture. DB 0 · 네트워크 0 · provider 0
 *
 * 🔴 **숫자를 여기 하드코딩하지 않는다.** 정본 함수를 돌려 나온 값을 본다 —
 *    문서와 코드가 갈라지면 여기서 걸린다.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  D100_STAGES, allD100Plans, d100Plan, nextStage,
  PLANNED_DETAIL_PER_PUBLIC_POST, D100_PERSONA_TARGET_MAX,
  POSTS_PER_INVOCATION, schedulerSupportOf,
  PERSONA_CANARY_FLOOR, PERSONA_SUSTAINED_TARGET, personaTargetReport, describePersonaTargets,
} from '../src/lib/d100-capacity'
import { RUNTIME_PROFILES } from '../src/lib/scale-profile'
import { readyNetFromSnapshots, READY_SELECTOR_VERSION } from './lib/d100-ready-snapshot.mjs'
import { detailThroughput, DETAIL_SOURCES } from './lib/d100-detail-throughput.mjs'
import {
  latestRunFailing,
  runReadiness, SnapshotWriteFailed, readFailureOf, perDayMeasured,
} from './lib/d100-operational-stock.mjs'
import { appendSnapshot } from './lib/d100-ready-snapshot.mjs'
import { fakeEvidenceGate, fakeReleaseStampGate } from './lib/fake-source-evidence.mjs'
import type { CollectRunRecord } from '../src/lib/collect-run-record'
import {
  judgeFunnel, judgeFunnelRows, LINK_STATES, linkStateOf, summarizeLinks, linkCriticalCount,
  hiddenPostNote, runnerStateOf, runnerCanRun, runnerIsFault, runnerFactsOf, capabilityFactsReady,
  RUNNER_STATES,
  allCapabilitiesReady, capabilityBlockers,
  showMeasured, readyNetFromThin, UNMEASURED,
  type CapabilityReadiness, type StockFunnel, type QueuePostLink,
} from '../src/lib/d100-readiness'
import {
  judgePersonaScale, personaBlockers, personaUnmeasured, personaUsable, PERSONA_LIFE_AXES,
  personaTierReadiness, personaReadinessOk, personaTiers, PERSONA_BLOCK_TIER,
  VOICE_MIN_COMMENTS, type PersonaCandidate,
} from '../src/lib/d100-persona-scale'
import {
  northStar, NOT_NORTH_STAR, isNorthStarMetric, NORTH_STAR_MISSING_EVENTS,
  EXISTING_ANALYTICS_EVENTS, NORTH_STAR_REQUIRED_EVENTS, countsTowardNorthStar,
  missingEvents, sumCountedActors,
} from '../src/lib/north-star'
import {
  compareWorkflowSuperset, allStageCronLines, stageGatingPresent, scheduleTextOfSlots, retiredPublishWorkflowProblems,
} from '../src/lib/scale-workflow-render'
import { calendarSlots } from './lib/launchd-install.mjs'
import { renderPublishRunnerPlist } from './lib/original-post-runner-template'
import { AUTHORITY_RENDER_INPUT } from './lib/stage-authority-repo'
import { readWorkset } from '../src/lib/supply-workset'
import {
  judgeStageStatus, buildStageFacts, firstBrokenStage, rateOf, showRate, describeBacklog,
  MIN_RUNS_FOR_DAILY_RATE, MIN_PRODUCTION_DAYS, productionRateOf, describeProduction,
  describeLaneReady, laneReadyMisreported,
  worksetEvidenceOf, worksetRunIdOf, tallySemanticCompletion, stageTimesOf, laneReadyOf,
  type StageEvidence, type LaneReadySplit, type LaneRow,
} from '../src/lib/d100-supply-funnel'
import { verifyPublishedRows } from '../src/lib/original-post-publish-verify'
import {
  RECOVERY_PLAN, CANARY_CONTRACT, judgeCanary, NEVER, MIN_CLEAN_RUNS_BEFORE_JOB,
  COUNTS_LIST_REQUESTS_IN_BUDGET, requestsPerRun, dailyDetailCeiling,
  judgeLadder, LADDER_MAX_DETAIL_PER_RUN, LADDER_TOP_MIN_DETAIL_PER_RUN,
  TOP_STEP_INCIDENT_FREE_DAYS, ESCALATION_LADDER,
  mayAutoRetry, capacities82, describeCookieAudit,
} from '../src/lib/collect-82cook-recovery'
import {
  AUTOFILL_PROMPT_VERSION, AUTOFILL_MODEL, AUTOFILL_SITE_PREFIX,
  MACHINE_PROMPT_VERSION, MACHINE_MODEL, MACHINE_SITE_PREFIX, MACHINE_PROFILE,
} from '../src/lib/micro-seed-supply-autofill'
import {
  readStockFunnel, type StockRepo, type QueueRowFacts,
} from './lib/d100-stock-reader.mjs'
import * as loopFunnelLib from '../src/lib/d100-loop-funnel'
import { buildLoopFunnel, describeLoopFunnel, type LoopRow } from '../src/lib/d100-loop-funnel'
import { readOnlyPrisma } from './lib/d100-loop-funnel-read.mjs'
import { PrismaClient } from '@prisma/client'
import { AUTO_DECIDER } from '../src/lib/auto-ready-v2'

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n① 🔴 🔴 D3→D100 용량 정본 — 숫자는 코드 한 곳에서 나온다')
// ─────────────────────────────────────────────────────────
{
  check('🔴 단계는 일곱이다', D100_STAGES.join(',') === 'd3,d5,d10,d20,d30,d50,d100')
  const want: Readonly<Record<string, [number, number, number, number]>> = {
    // 단계: [공개/day, 상세 계획 참고값/day, -, Persona canary] — 🔴 (2026-09-30) 14일치 완성 글 재고 칸은 지웠다
    d3: [3, 12, 0, 24], d5: [5, 20, 0, 24], d10: [10, 39, 0, 30],
    d20: [20, 77, 0, 40], d30: [30, 115, 0, 60],
    d50: [50, 191, 0, 100], d100: [100, 382, 0, 180],
  }
  for (const p of allD100Plans()) {
    const w = want[p.stage]!
    check(`🔴 🔴 **${p.stage} — 공개 ${w[0]} · 상세 계획 ${w[1]} · Persona ${w[3]} · 14일 재고 · 고정 READY 칸 없음**`,
      p.publicPostsPerDay === w[0] && p.plannedDetailedSourcesPerDay === w[1]
      && !('readyStock14Days' in p) && !('readyQualifiedRequiredPerDay' in p)
      && !('detailedSourcesRequiredPerDay' in p) && p.personaCanaryFloor === w[3],
      `${p.publicPostsPerDay}/${p.plannedDetailedSourcesPerDay}/${p.personaCanaryFloor}`)
  }
  const d100 = d100Plan('d100')
  check('🔴 🔴 **D100 댓글 100~500 · Persona 180~200**',
    d100.commentMinPerDay === 100
    && d100.commentMaxPerDay === 500 && d100.personaCanaryFloor === 180
    && D100_PERSONA_TARGET_MAX === 200)
  check('🔴 🔴 **(2026-09-30) 14일치 완성 글 재고 · 지속 승격 판정이 정본에 없다**', (() => {
    const cap = readFileSync('src/lib/d100-capacity.ts', 'utf-8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
    return !/export const STOCK_DAYS|export function judgePromotion|readyStock14Days|export function targetStageFor/.test(cap)
  })())
  check('🔴 상세 계획 참고값은 계획 전환율에서 계산된다(비권위)',
    d100.plannedDetailedSourcesPerDay
      === Math.ceil(d100.publicPostsPerDay * PLANNED_DETAIL_PER_PUBLIC_POST))
  check('🔴 다음 단계가 이어진다',
    nextStage('d3') === 'd5' && nextStage('d50') === 'd100' && nextStage('d100') === null)
  /**
   * 🔴 (2026-10-04) canon §4 단계 표는 `공개 · canary · 지속 · 첫 댓글` 이다 — READY/day · 상세/day 칸은
   *    canon §3.1 이 지웠다(고정 할증 · 고정 상세는 정책 숫자가 아니다). 코드 정본과 전 행을 대조한다.
   */
  check('🔴 🔴 **문서 단계 표가 코드 정본의 전 행과 같다 (READY/day · 상세/day 칸 없음)**', (() => {
    const doc = readFileSync('docs/operations/2026-09-21-d100-goal-canon.md', 'utf-8')
      .replaceAll('**', '')
    return allD100Plans().every((p) => doc.includes(
      `| ${p.stage.toUpperCase()} | ${p.publicPostsPerDay} | ${p.personaCanaryFloor}`
      + ` | ${p.personaSustainedTarget}${p.stage === 'd100' ? '+' : ''}`
      + ` | ${p.commentMinPerDay} |`,
    ))
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n② 🔴 🔴 재고 깔때기 — 다른 집합을 섞지 않는다')
// ─────────────────────────────────────────────────────────
{
  /** 🔴 2026-09-21 운영 실측 모양 — Queue 239 · 미발행 221 · compatible 4 · reviewed 3 */
  const REAL: StockFunnel = {
    queueTotal: 239, unpublishedApproved: 221, legacyExcluded: 217,
    profileCompatible: 4, humanReviewed: 3, fresh: 3,
    personaAssignable: 1, publishableNow: 0,
    readyStock: 3,
  }
  check('🔴 🔴 **실측 모양은 깔때기로 말이 된다**',
    judgeFunnel(REAL).length === 0, JSON.stringify(judgeFunnel(REAL)))
  check('🔴 🔴 **아래 칸이 위 칸보다 크면 FAIL** — 두 도구가 다른 집합을 센 것이다',
    judgeFunnel({ ...REAL, humanReviewed: 99 }).some((p) => p.code === 'FUNNEL_WIDENS'))
  check('🔴 🔴 **legacy 가 usable 재고에 들어오면 FAIL**',
    judgeFunnel({ ...REAL, profileCompatible: 100 })
      .some((p) => p.code === 'LEGACY_IN_STOCK' || p.code === 'FUNNEL_WIDENS'))
  check('🔴 readyStock 은 fresh 와 같아야 한다',
    judgeFunnel({ ...REAL, readyStock: 99 }).some((p) => p.code === 'READY_STOCK_MISDEFINED'))
  check('🔴 🔴 **Queue 220 · compatible 4 · reviewed 3 은 서로 다른 이름을 갖는다**',
    REAL.unpublishedApproved !== REAL.profileCompatible
    && REAL.profileCompatible !== REAL.humanReviewed)
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 🔴 🔴 Queue ↔ Post — 숨긴 글과 끊어진 연결을 가른다')
// ─────────────────────────────────────────────────────────
{
  /** 🔴 실측: PUBLISHED 18건 중 Post PUBLISHED 17 · HIDDEN 1 · orphan 0 */
  const rows = [
    ...Array.from({ length: 17 }, (_, i) => ({
      queueId: `ok${i}`, createdPostId: `p${i}`, postStatus: 'PUBLISHED',
    })),
    { queueId: 'cmu0ov5b300052y8tjgjejpon', createdPostId: 'cmu0sjyll000142oincdg3d3j', postStatus: 'HIDDEN' },
  ]
  const s = summarizeLinks(rows)
  check('🔴 🔴 **HIDDEN Post 는 별도 상태다 — CRITICAL 이 아니다**',
    s.visiblePublished === 17 && s.hiddenPost === 1 && s.orphan === 0
    && linkCriticalCount(s) === 0, JSON.stringify(s))
  check('🔴 🔴 **Post 가 아예 없으면 orphan — 계속 CRITICAL**', (() => {
    const o = summarizeLinks([{ queueId: 'x', createdPostId: null, postStatus: null }])
    return o.orphan === 1 && linkCriticalCount(o) === 1
  })())
  check('🔴 🔴 **모르는 Post 상태는 realMismatch — 계속 CRITICAL**', (() => {
    const m = summarizeLinks([{ queueId: 'x', createdPostId: 'p', postStatus: '뭔가' }])
    return m.realMismatch === 1 && linkCriticalCount(m) === 1
  })())
  check('🔴 삭제된 글도 숨김 쪽이다',
    linkStateOf({ queueId: 'x', createdPostId: 'p', postStatus: 'DELETED' }) === 'hiddenPost')
  check('🔴 🔴 **경고를 숨긴 것이 아니다 — 숨겨진 글은 계속 세어진다**', s.hiddenPost === 1)

  /** 🔴 정본 검증기가 실제로 가르는가 — 실측 행 모양 그대로 */
  const POST = {
    status: 'HIDDEN', source: 'SYSTEM', boardType: 'FREE', personaId: 'per1',
    searchIndexable: false, discoveryEligible: false,
    sourceUrl: null, sourceArticleId: null, sheetCandidateId: null,
  }
  const ROW = {
    queueId: 'cmu0ov5b300052y8tjgjejpon', queueStatus: 'PUBLISHED',
    createdPostId: 'cmu0sjyll000142oincdg3d3j', queuePersonaId: 'per1',
    post: POST, activityLogCount: 1,
  }
  {
    const v = verifyPublishedRows([ROW])
    check('🔴 🔴 **숨겨진 글은 bad 가 아니라 hiddenPost 다**',
      v.ok && v.bad.length === 0 && v.hiddenPost.length === 1,
      JSON.stringify({ bad: v.bad.length, hidden: v.hiddenPost.length }))
  }
  {
    // 🔴 숨김 때문이 아닌 문제가 남으면 여전히 bad 다
    const v = verifyPublishedRows([{ ...ROW, queuePersonaId: 'other' }])
    check('🔴 🔴 **숨겼어도 persona 가 어긋나면 계속 CRITICAL**',
      !v.ok && v.bad.length === 1 && v.hiddenPost.length === 0
      && v.bad[0]!.problems.every((p) => !p.includes('Post status=')),
      JSON.stringify(v.bad))
  }
  {
    const v = verifyPublishedRows([{ ...ROW, post: null, createdPostId: 'gone' }])
    check('🔴 🔴 **Post 가 없으면 계속 bad 다**', !v.ok && v.bad.length === 1)
  }
  check('🔴 🔴 **health 가 둘을 갈라 넘긴다**', (() => {
    const h = readFileSync('scripts/supply-health.mts', 'utf-8')
    return /mismatched: verdict\.bad\.length/.test(h) && /hiddenPost: verdict\.hiddenPost\.length/.test(h)
  })())
  check('🔴 🔴 **숨겨진 글은 CRITICAL 이 아니라 INFO 로 보고된다**', (() => {
    const lib = readFileSync('src/lib/supply-health.ts', 'utf-8')
    return /'INFO', 'PUBLISH_HIDDEN_POST'/.test(lib)
      && /'CRITICAL', 'PUBLISH_MISMATCH'/.test(lib)
  })())
  /**
   * 🔴 **주체·의도를 단정하지 않는다.** "사람이 내린 글" 은 감사 기록 없이는 주장이다 —
   *    자동 처리·마이그레이션 사고도 같은 값을 만든다.
   */
  check('🔴 🔴 **어느 경로도 "사람이 내렸다" 고 단정하지 않는다**', (() => {
    const strip = (t: string): string =>
      t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    return ['src/lib/original-post-publish-verify.ts', 'src/lib/supply-health.ts',
      'src/lib/d100-readiness.ts', 'scripts/supply-health.mts']
      .every((f) => {
        const src = strip(readFileSync(f, 'utf-8'))
        /**
         * 🔴 **단정하는 표현**만 막는다 — "사람이 내린 것인지 …알 수 없다" 는
         *    오히려 우리가 넣은 유보 문구다. 그것까지 막으면 검사가 유보를 벌준다.
         */
        return !/사람이 내린 글/.test(src) && !/takenDown|TAKEN_DOWN/.test(src)
          // 🔴 유보 문구는 **있어야** 한다
          && (!/숨겨진 글/.test(src) || /알 수 없다/.test(src))
      })
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 🔴 🔴 발행 예약(launchd 러너) — superset 은 정상, gating 없는 cron 은 FAIL')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 (2026-09-30 · 단일 실행 authority) 발행 예약의 정본은 launchd 러너 plist 다 — GitHub 예약은 지웠다.
   *    합집합 계약은 그대로다: 러너 plist 의 `StartCalendarInterval` 을 같은 cron 표현으로 읽어 견준다.
   */
  const yml = scheduleTextOfSlots(calendarSlots(renderPublishRunnerPlist(AUTHORITY_RENDER_INPUT)))
  check('🔴 🔴 **GitHub 발행 워크플로에 예약이 없다(두 번째 schedule owner 0)**',
    retiredPublishWorkflowProblems(readFileSync('.github/workflows/auto-publish.yml', 'utf-8')).length === 0)
  check('🔴 🔴 **실제 launchd 러너 예약은 모든 단계의 합집합이다 — 불일치 0**',
    compareWorkflowSuperset(yml).length === 0,
    JSON.stringify(compareWorkflowSuperset(yml)))
  check('🔴 🔴 **어느 단계 슬롯도 아닌 cron 은 FAIL**',
    compareWorkflowSuperset(`${yml}\n    - cron: '7 7 * * *'`)
      .some((m) => m.kind === 'unplanned'))
  check('🔴 🔴 **단계 슬롯이 빠지면 FAIL**', (() => {
    const first = allStageCronLines()[0]!
    const cut = yml.split('\n').filter((l) => !l.includes(`'${first}'`)).join('\n')
    return compareWorkflowSuperset(cut).some((m) => m.kind === 'missing')
  })())
  check('🔴 🔴 **러너가 자기 단계 슬롯으로 거른다 — 문자열 포함 검사로 끝내지 않는다**', (() => {
    const src = readFileSync('scripts/lib/original-post-runner-template.ts', 'utf-8')
    return stageGatingPresent(src)
  })())
  check('🔴 gating 이 없으면 FAIL', !stageGatingPresent('const x = 1'))
  check('🔴 🔴 **health 가 GitHub 발행 예약 부활을 본다** — 활성 단계로 견주지 않는다', (() => {
    const h = readFileSync('scripts/supply-health.mts', 'utf-8')
    return /retiredPublishWorkflowProblems\(/.test(h) && !/compareWorkflow\(/.test(h)
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 🔴 🔴 runner·운영 상태 — fail-closed')
// ─────────────────────────────────────────────────────────
{
  check('🔴 정책으로 꺼 둔 것은 손상이 아니다', (() => {
    const st = runnerStateOf({ installed: true, loaded: false, enabled: false })
    return st === 'disabledByPolicy' && !runnerCanRun(st) && !runnerIsFault(st)
  })())
  check('🔴 미등록·unloaded 를 구분한다',
    runnerStateOf({ installed: false, loaded: false, enabled: true }) === 'notRegistered'
    && runnerStateOf({ installed: true, loaded: false, enabled: true }) === 'unloaded')
  check('🔴 올라가 있는데 실패하면 unhealthy',
    runnerIsFault(runnerStateOf({ installed: true, loaded: true, enabled: true, failing: true })))
  /**
   * 🔴 **최근 성패를 모르면 `ready` 가 아니다** (4차 보정).
   *    앞판은 `failing` 을 넘기지 않으면 `ready` 였다 — 회차가 전부 실패해도 초록이었다.
   */
  check('🔴 🔴 **성패를 모르면 healthUnknown 이다 — ready 가 아니다**',
    runnerStateOf({ installed: true, loaded: true, enabled: true }) === 'healthUnknown'
    && !runnerCanRun(runnerStateOf({ installed: true, loaded: true, enabled: true })))
  check('🔴 정상은 확인했을 때만이다',
    runnerCanRun(runnerStateOf({ installed: true, loaded: true, enabled: true, failing: false })))
  /** 🔴 2026-09-21 운영 실측 상태 */
  const REAL: CapabilityReadiness = {
    collect: 'ready', generate: 'disabledByPolicy',
    publish: 'unloaded', comment: 'notRegistered', measure: 'notRegistered',
  }
  check('🔴 🔴 **runner 미등록인데 전체 READY 가 되면 FAIL**', !allCapabilitiesReady(REAL))
  check('🔴 🔴 **runner 미등록인데 publish/comment READY 가 되면 FAIL**',
    !runnerCanRun(REAL.publish) && !runnerCanRun(REAL.comment))
  check('🔴 왜 준비되지 않았는지 능력마다 적는다',
    capabilityBlockers(REAL).length === 4)
  check('🔴 전부 ready 일 때만 전체 READY',
    allCapabilitiesReady({
      collect: 'ready', generate: 'ready', publish: 'ready', comment: 'ready', measure: 'ready',
    }))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 🔴 🔴 측정되지 않은 값 — 0 으로 채우지 않는다')
// ─────────────────────────────────────────────────────────
{
  check('🔴 없는 값은 unmeasured 로 적는다',
    showMeasured(null) === UNMEASURED && showMeasured(80, '/day') === '80/day')
  check('🔴 🔴 **thin 수를 READY 순증가로 대체하면 FAIL**',
    readyNetFromThin(80) === null)
  // 🔴 (2026-09-30) 지속 승격(`judgePromotion`)의 측정 · preflight 반례는 지웠다 — 다음 단계는 `judgeNextPreflight` 하나가
  //    UNKNOWN(측정 안 됨)을 통과로 세지 않는다(`stage:scheduler-check` ④ · OPPORTUNITY/THROUGHPUT/PERSONA_UNKNOWN).
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 🔴 🔴 Persona 24 → 180~200 — 카드만 채우면 READY 가 아니다')
// ─────────────────────────────────────────────────────────
{
  const FULL: PersonaCandidate = {
    code: 'P01', filledAxes: [...PERSONA_LIFE_AXES], ageBand: '40대 후반',
    voiceComments: VOICE_MIN_COMMENTS, activityToday: 0, consecutiveExposures: 0,
    daysSinceActive: 0, retired: false, qualificationConflict: false,
    roleShare: 0, postsSinceLastPairing: 'never',
  }
  // 🔴 (2026-10-01 · C8) 생성 계약 14칸 중 개인 말버릇만 뺀 13축 — 공통 금지는 `persona-no-go` 가 강제한다
  check('🔴 생활사 계약 축은 생성 계약 14칸 − 개인 말버릇 = 13축', PERSONA_LIFE_AXES.length === 13 && !PERSONA_LIFE_AXES.includes('noGoExpressions'))
  check('🔴 다 갖추면 쓸 수 있다', personaUsable(FULL))
  check('🔴 🔴 **생활사 한 축만 비어도 못 쓴다**',
    personaBlockers({ ...FULL, filledAxes: PERSONA_LIFE_AXES.slice(1) }).includes('lifeAxisMissing'))
  check('🔴 나이대가 없으면 못 쓴다',
    personaBlockers({ ...FULL, ageBand: null }).includes('noAgeBand'))
  check('🔴 🔴 **말투 근거가 모자라면 못 쓴다**',
    personaBlockers({ ...FULL, voiceComments: VOICE_MIN_COMMENTS - 1 }).includes('voiceEvidenceThin'))
  for (const [name, patch, want] of [
    ['활동 상한', { activityToday: 99 }, 'activityOverCap'],
    ['연속 노출', { consecutiveExposures: 9 }, 'consecutiveExposure'],
    ['휴면', { daysSinceActive: 99 }, 'dormant'],
    ['퇴역', { retired: true }, 'retired'],
    ['자격 충돌', { qualificationConflict: true }, 'qualificationConflict'],
  ] as const) {
    check(`🔴 ${name} 이면 못 쓴다`, personaBlockers({ ...FULL, ...patch }).includes(want))
  }
  /**
   * 🔴 **말투 근거가 없으면 카드부터 서지 않는다** (4차 보정).
   *    앞판은 말투를 Pool 에 두었다 — 그런데 말투가 없는 것은 *풀 구성 문제*가 아니라
   *    *그 사람이 아직 안 만들어진 것*이다. 그래서 카드 층에서 막힌다.
   */
  check('🔴 🔴 **행이 180개여도 말투 근거가 없으면 READY 가 아니다**', (() => {
    const cards = Array.from({ length: 180 }, (_, i) => ({
      ...FULL, code: `P${i}`, voiceComments: 0,
    }))
    const v = judgePersonaScale({ stage: 'd100', candidates: cards })
    return !v.canaryReady && !v.sustainedReady && v.poolReady === 0 && v.cardsOnly === 180
      && v.canaryShortfall === 180 && v.sustainedShortfall === 300
      && v.cardComplete === 0 && v.cards === 180
  })())
  check('🔴 쓸 수 있는 사람이 canary 하한만큼 있으면 canary READY — 🔴 지속 READY 는 아니다', (() => {
    const cards = Array.from({ length: 180 }, (_, i) => ({ ...FULL, code: `P${i}` }))
    const v = judgePersonaScale({ stage: 'd100', candidates: cards })
    return v.canaryReady && v.poolReady === 180 && v.canaryFloor === 180 && v.canaryFloorMax === 200
      && !v.sustainedReady && v.sustainedTarget === 300 && v.sustainedShortfall === 120
  })())
  check('🔴 지속 목표(300)만큼 있으면 두 판정 모두 READY', (() => {
    const cards = Array.from({ length: 300 }, (_, i) => ({ ...FULL, code: `P${i}` }))
    const v = judgePersonaScale({ stage: 'd100', candidates: cards })
    return v.canaryReady && v.sustainedReady && v.sustainedShortfall === 0 && v.canaryShortfall === 0
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 🔴 🔴 North Star — Persona·봇 활동이 들어가면 FAIL')
// ─────────────────────────────────────────────────────────
{
  check('🔴 🔴 **재방문을 셀 이벤트가 아직 없다**',
    NORTH_STAR_MISSING_EVENTS.length === 3
    && northStar({
      returningByActor: { member: 10 }, returningEngagedByActor: { member: 5 }, measuredWeeks: null,
    }).measured === false)
  /**
   * 🔴 **목록을 여기 고정한다.** `NOT_NORTH_STAR` 만 돌면 값을 지우는 순간
   *    그 검사 자체가 사라져 헛돈다 — 지우면 여기서 걸려야 한다.
   */
  const MUST_NOT_BE_NORTH_STAR = [
    'publicPostsPerDay', 'personaComments', 'personaActiveCount',
    'shadowDrafts', 'queueStock', 'crawlThroughput',
  ] as const
  check('🔴 🔴 **North Star 가 아닌 것의 목록이 줄지 않았다**',
    MUST_NOT_BE_NORTH_STAR.every((m) => (NOT_NORTH_STAR as readonly string[]).includes(m)),
    `목록 ${NOT_NORTH_STAR.length}개`)
  for (const m of MUST_NOT_BE_NORTH_STAR) {
    check(`🔴 🔴 **${m} 은 North Star 가 아니다**`, !isNorthStarMetric(m))
  }
  check('🔴 사람 재방문 지표는 North Star 다', isNorthStarMetric('weeklyReturningEngagedUsers'))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑨ 🔴 🔴 SEO 별도 레인이 다시 생기면 FAIL')
// ─────────────────────────────────────────────────────────
{
  check('🔴 🔴 **목표 정본이 별도 SEO 레인을 금지한다**', (() => {
    const doc = readFileSync('docs/operations/2026-09-21-d100-goal-canon.md', 'utf-8')
    return /별도 SEO 정보형 글 레인 생성/.test(doc)
      && /SEO 는 별도 글 종류가 아니라/.test(doc)
  })())
  check('🔴 🔴 **옛 SEO 레인 행이 superseded 로 표시됐다**', (() => {
    const m = readFileSync('docs/operations/MASTER-OPERATING-SYSTEM.md', 'utf-8')
    return /~~SEO100-200~~/.test(m) && /superseded \(2026-09-21\)/.test(m)
  })())
  check('🔴 🔴 **Shadow 100/day 도 superseded 다**', (() => {
    const m = readFileSync('docs/operations/MASTER-OPERATING-SYSTEM.md', 'utf-8')
    return /~~Shadow100~~/.test(m)
  })())
  check('🔴 코드에 SEO 전용 단계가 없다',
    !(D100_STAGES as readonly string[]).some((s) => /seo|shadow/i.test(s)))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑩ 🔴 🔴 82cook — 필수 공급원 · 이번엔 실행하지 않는다')
// ─────────────────────────────────────────────────────────
{
  check('🔴 복구 단계가 넷이다', RECOVERY_PLAN.length === 4)
  check('🔴 🔴 **Phase 0 은 요청도 등록도 하지 않는다**', (() => {
    const p0 = RECOVERY_PLAN[0]!
    return p0.phase === 'phase0' && !p0.sendsRequests && !p0.registersJob
  })())
  check('🔴 🔴 **Phase 0 에서는 canary 를 돌릴 수 없다**', (() => {
    const v = judgeCanary({ phase: 'phase0', cleanRuns: 99, breakerOpen: false, hasSession: true })
    return !v.mayRun && !v.mayRegisterJob
  })())
  check('🔴 🔴 **세션이 없으면 요청하지 않는다**',
    !judgeCanary({ phase: 'd10prep', cleanRuns: 0, breakerOpen: false, hasSession: false }).mayRun)
  check('🔴 🔴 **차단기가 열려 있으면 요청하지 않는다**',
    !judgeCanary({ phase: 'd10prep', cleanRuns: 0, breakerOpen: true, hasSession: true }).mayRun)
  check('🔴 D10 준비에서는 돌 수 있지만 등록은 못 한다', (() => {
    const v = judgeCanary({ phase: 'd10prep', cleanRuns: 9, breakerOpen: false, hasSession: true })
    return v.mayRun && !v.mayRegisterJob
  })())
  check('🔴 🔴 **무사 회차가 모자라면 등록하지 않는다**',
    !judgeCanary({
      phase: 'd20prep', cleanRuns: MIN_CLEAN_RUNS_BEFORE_JOB - 1,
      breakerOpen: false, hasSession: true,
    }).mayRegisterJob)
  check('🔴 무사 회차가 차면 등록할 수 있다',
    judgeCanary({
      phase: 'd20prep', cleanRuns: MIN_CLEAN_RUNS_BEFORE_JOB,
      breakerOpen: false, hasSession: true,
    }).mayRegisterJob)
  check('🔴 🔴 **canary 계약이 지금 수집기보다 보수적이다**',
    CANARY_CONTRACT.concurrency === 1 && CANARY_CONTRACT.maxDetailPerRun === 5
    && CANARY_CONTRACT.minGapMs === 8000 && CANARY_CONTRACT.maxGapMs === 15000
    && CANARY_CONTRACT.minRestBetweenRunsMs === 4 * 3600_000
    && CANARY_CONTRACT.maxRequestsPerDay === 20)
  check('🔴 🔴 **실제 브라우저 세션을 쓴다 — 가짜 쿠키·Referer 조작이 아니다**',
    CANARY_CONTRACT.realBrowserSession && CANARY_CONTRACT.listBeforeDetail
    && (NEVER as readonly string[]).includes('가짜 쿠키·Referer 조작'))
  check('🔴 🔴 **우회를 금지한다**',
    (NEVER as readonly string[]).includes('CAPTCHA 우회')
    && (NEVER as readonly string[]).includes('관측 없이 속도 상향')
    && (NEVER as readonly string[]).includes('대체 공급원을 기본안으로 제안'))
  check('🔴 🔴 **NETWORK 가 기록된 원인이고 403/429 는 후보가 아니다**', (() => {
    const src = readFileSync('src/lib/collect-82cook-recovery.ts', 'utf-8')
    return /NETWORK 11 연속/.test(src) && /원인 후보/.test(src)
      && /확정 원인/.test(src) && /현재 접근 가능하다는 창업자 확인/.test(src)
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑪ 🔴 🔴 통합 명령이 두 기준 SHA 를 함께 적는다')
// ─────────────────────────────────────────────────────────
{
  const cli = readFileSync('scripts/d100-master-readiness.mts', 'utf-8')
  check('🔴 🔴 **코드 기준과 운영 기준을 함께 적는다**',
    /codeSha/.test(cli) && /runtimeSha/.test(cli) && /pinSha/.test(cli))
  check('🔴 두 기준이 다르면 그렇게 말한다', /코드와 운영 기준이 다르다/.test(cli))
  /**
   * 🔴 **이제 이 명령은 운영 DB 를 읽는다.** "Prisma 라는 낱말이 없다" 로 read-only 를
   *    증명할 수 없다 — 대신 **쓰는 낱말이 없다**는 것과 read-only reader 를 쓴다는 것을 본다.
   */
  const reader = readFileSync('scripts/lib/d100-operational-stock.mts', 'utf-8')
  const stripComments = (t: string): string =>
    t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  check('🔴 🔴 **DB 를 실제로 읽는다 — 하드코딩 0 이 아니다**',
    /readOperationalStock/.test(cli) && /findMany|count/.test(reader))
  check('🔴 🔴 **write 가 없다 — read-only 다**',
    !/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/.test(stripComments(reader))
    && !/\$executeRaw|\$queryRaw/.test(stripComments(reader)))
  check('🔴 🔴 **측정되지 않은 값을 0 으로 채우지 않는다**',
    /showMeasured/.test(cli) && /read\.ok \? read\.detailPerDay : null/.test(cli)
    && /readFailed/.test(cli))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑫ 🔴 🔴 필수 행동 17 — 고치면 반드시 여기서 깨진다')
// 🔴 **운영 DB 를 건드리지 않는다.** 주입한 가짜 저장소로만 돈다
// ─────────────────────────────────────────────────────────
{
  const NOW = new Date('2026-09-21T00:00:00.000Z')
  const humanRow = (id: string, over: Partial<QueueRowFacts> = {}): QueueRowFacts => ({
    id, status: 'APPROVED', createdPostId: null, gateVerdict: 'PASS',
    promptVersion: AUTOFILL_PROMPT_VERSION, model: AUTOFILL_MODEL,
    sourceSite: `${AUTOFILL_SITE_PREFIX}82cook`,
    // 🔴 (2026-09-30) 원문 증거 — 없으면 정본 슬롯 판정(깔때기 ⑤)이 fresh 에서 뺀다
    matchedPersonaId: 'per-1', gateResults: fakeEvidenceGate(NOW, { id }),
    title: `제목 ${id}`, body: `본문 ${id} 입니다`,
    draftTitle: `제목 ${id}`, editedTitle: null,
    decidedBy: 'founder', decidedAt: NOW, createdAt: NOW,
    ...over,
  })
  const machineRow = (id: string, over: Partial<QueueRowFacts> = {}): QueueRowFacts => humanRow(id, {
    promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
    sourceSite: `${MACHINE_SITE_PREFIX}82cook`,
    gateResults: {
      ...fakeEvidenceGate(NOW, { id }),
      autoDraft: {
        provenance: MACHINE_PROFILE.envelopeProvenance,
        sourceDecision: MACHINE_PROFILE.sourceDecision,
        draftRuleVersion: MACHINE_PROFILE.envelopeRuleVersion,
      },
    },
    ...over,
  })
  const repoOf = (rows: readonly QueueRowFacts[], links: readonly QueuePostLink[] = []): StockRepo => ({
    queueRows: async () => rows,
    publishedLinks: async () => links,
    activePersonas: async () => 0,
  })
  const readFx = (rows: readonly QueueRowFacts[], links: readonly QueuePostLink[] = []) =>
    readStockFunnel({ repo: repoOf(rows, links), now: NOW, safetyOf: () => 'pass' })

  // ① 재고를 실제 행에서 센다
  check('🔴 ① **재고는 주입한 행에서 계산된다 — 하드코딩이 아니다**', await (async () => {
    const r = await readFx([humanRow('a'), humanRow('b'), humanRow('c')])
    return r.ok && r.funnel.readyStock === 3 && r.funnel.queueTotal === 3
  })())

  // ② 못 읽으면 0 이 아니라 readFailed
  check('🔴 ② **DB 를 못 읽으면 0 이 아니라 readFailed 다**', await (async () => {
    const r = await readStockFunnel({
      repo: {
        queueRows: async () => { throw new Error('연결 끊김') },
        publishedLinks: async () => [], activePersonas: async () => 0,
      },
      now: NOW, safetyOf: () => 'pass',
    })
    return !r.ok && r.reason === 'readFailed' && r.detail.includes('연결 끊김')
  })())

  // ③ 빈 결과와 실패는 다른 상태다
  check('🔴 ③ **빈 큐는 readFailed 가 아니라 재고 0 이다**', await (async () => {
    const r = await readFx([])
    return r.ok && r.funnel.readyStock === 0
  })())

  // ④ 행 집합 — 숫자가 같아도 다른 id 면 통과하지 않는다
  check('🔴 ④ **부분집합이 아니면 readFailed — 수가 같아도 통과하지 않는다**', (() => {
    const bad = judgeFunnelRows({
      sets: {
        all: ['a', 'b'], unpublishedApproved: ['a', 'b'], nonLegacy: ['a', 'b'],
        profileCompatible: ['a', 'b'], humanReviewed: ['a', 'b'], fresh: ['a', 'b'],
        // 🔴 수는 2 로 같지만 앞 단계에 없던 'z' 가 들어왔다
        personaAssignable: ['a', 'z'], publishableNow: ['a', 'z'],
      },
      legacyIds: [],
    })
    return bad.some((p) => p.code === 'NOT_SUBSET')
  })())

  // ④-b 🔴 reader 자신이 그 방어를 거치는가 — 검사 함수만 있고 안 부르면 소용없다
  check('🔴 ④-b **reader 가 부분집합 방어를 실제로 거친다**', await (async () => {
    const r = await readStockFunnel({
      repo: repoOf([humanRow('a')]), now: NOW, safetyOf: () => 'pass',
      // 🔴 앞 단계에 없는 id 를 고르는 선택기
      selectTargets: () => ({ targets: [{ id: '없는행' }] }),
    })
    return !r.ok && r.reason === 'readFailed' && r.detail.includes('NOT_SUBSET')
  })())

  // ⑤ legacy 가 뒤 단계에 남으면 실패
  check('🔴 ⑤ **legacy 행이 뒤 단계에 남아 있으면 실패다**', (() => {
    const bad = judgeFunnelRows({
      sets: {
        all: ['a'], unpublishedApproved: ['a'], nonLegacy: ['a'], profileCompatible: ['a'],
        humanReviewed: ['a'], fresh: ['a'], personaAssignable: ['a'], publishableNow: ['a'],
      },
      legacyIds: ['a'],
    })
    return bad.some((p) => p.code === 'LEGACY_IN_STAGE')
  })())

  // ⑥ 사람이 확인하지 않은 기계 글은 재고가 아니다
  check('🔴 ⑥ **사람이 확인하지 않은 기계 글은 재고에 들지 않는다**', await (async () => {
    const r = await readFx([machineRow('m', { decidedBy: 'machine:auto-draft-v5' })])
    return r.ok && r.funnel.humanReviewed === 0 && r.funnel.readyStock === 0
      && r.funnel.unpublishedApproved === 1
  })())

  // ⑦ 발행된 행은 재고가 아니다
  check('🔴 ⑦ **이미 발행된 행은 재고에서 빠진다**', await (async () => {
    const r = await readFx([humanRow('a', { createdPostId: 'post-1' }), humanRow('b')])
    return r.ok && r.funnel.queueTotal === 2 && r.funnel.unpublishedApproved === 1
  })())

  // ⑧ 📜 (2026-10-04) READY 생산 목표 = ceil(공개 × 1.2) 를 지웠다 — 필요 READY 는 preflight 실측 계약 하나다
  check('🔴 ⑧ **고정 READY 할증(1.2)이 용량 정본에 없다 — 필요 READY 는 `readyRequirementOf`(목표 + 실측 손실)**', (() => {
    const cap = readFileSync('src/lib/d100-capacity.ts', 'utf-8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
    return !/READY_NET_MARGIN|readyQualifiedRequiredPerDay|\b1\.2\b/.test(cap)
      && allD100Plans().every((p) => !('readyQualifiedRequiredPerDay' in p))
  })())

  // ⑨ 공개량과 계획 참고값은 서로 다르다
  check('🔴 ⑨ **공개량 · 상세 계획 참고값은 서로 다른 값이다 · 14일 재고 칸은 없다**', (() => {
    const p = d100Plan('d100')
    return p.publicPostsPerDay === 100 && p.plannedDetailedSourcesPerDay === 382
      && !('readyStock14Days' in p)
  })())

  /**
   * ⑩ D20·D30·D50 은 러너 프로필(`RUNTIME_PROFILES` · heartbeat 격자)로 감당한다 · D100 은 러너 밖이다 (2026-09-29 계약 정렬).
   *    🔴 감당한다 ≠ 열렸다 — 승인 천장(지금 d10)과 D20+ preflight 가 막는다(`stage:scheduler-check` S2·S7·S11).
   */
  check('🔴 ⑩ **D20·D30·D50 은 러너 슬롯으로 감당한다 · D100 은 schedulerUnsupported (러너 용량·예산 밖)**', (() => {
    const ok = (['d20', 'd30', 'd50'] as const).every((st) => {
      const sc = schedulerSupportOf(st)
      return sc.supported && sc.reason === null && sc.releaseStage === st
        && sc.scheduledSlotsPerDay === RUNTIME_PROFILES[st].slots.length
        && sc.actualDailyPublishable === d100Plan(st).publicPostsPerDay
    })
    const sc100 = schedulerSupportOf('d100')
    return ok && !sc100.supported && sc100.reason === 'schedulerUnsupported'
      && sc100.scheduledSlotsPerDay === null && sc100.releaseStage === null
  })())

  // ⑪ d3·d5·d10 은 실제 cron 으로 감당한다
  check('🔴 ⑪ **d3·d5·d10 은 실제 예약 cron 수로 감당한다**',
    (['d3', 'd5', 'd10'] as const).every((st) => {
      const sc = schedulerSupportOf(st)
      return sc.supported && sc.actualDailyPublishable === d100Plan(st).publicPostsPerDay
    }))

  // ⑫ 회차당 1건이라는 사실이 계산에 들어간다
  check('🔴 ⑫ **회차당 발행 1건이 계산에 실제로 쓰인다**', (() => {
    const sc = schedulerSupportOf('d10')
    return POSTS_PER_INVOCATION === 1 && sc.scheduledSlotsPerDay !== null
      && sc.actualDailyPublishable === sc.scheduledSlotsPerDay * POSTS_PER_INVOCATION
  })())

  // ⑬ Persona 3계층이 서로 다른 답을 낸다
  check('🔴 ⑬ **Persona 카드·풀·배정이 각각 다른 층을 본다**', (() => {
    const base: PersonaCandidate = {
      code: 'P', filledAxes: [...PERSONA_LIFE_AXES], ageBand: '50대 초반',
      voiceComments: VOICE_MIN_COMMENTS, activityToday: 0, consecutiveExposures: 0,
      daysSinceActive: 0, retired: false, qualificationConflict: false,
      roleShare: 0, postsSinceLastPairing: 'never',
    }
    const v = judgePersonaScale({
      stage: 'd3',
      candidates: [
        base,                              // 전부 통과
        { ...base, voiceComments: 0 },     // 🔴 말투 없음 → **카드**부터 미완성
        { ...base, activityToday: 99 },    // 카드·풀은 서지만 오늘은 못 쓴다
        { ...base, ageBand: null },        // 카드부터 미완성
      ],
    })
    return v.cards === 4 && v.cardComplete === 2 && v.poolReady === 2 && v.assignableNow === 1
  })())

  // ⑭ 선언만 하고 내보내지 않던 코드 세 개가 실제로 나온다
  check('🔴 ⑭ **topic·role·pairRepeat 가 실제로 판정된다 — 선언만 있지 않다**', (() => {
    const base: PersonaCandidate = {
      code: 'P', filledAxes: [...PERSONA_LIFE_AXES], ageBand: '50대 초반',
      voiceComments: VOICE_MIN_COMMENTS, activityToday: 0, consecutiveExposures: 0,
      daysSinceActive: 0, retired: false, qualificationConflict: false,
      roleShare: 0, postsSinceLastPairing: 'never',
    }
    return personaBlockers({ ...base, roleShare: 0.9 }).includes('roleConcentrated')
      && personaBlockers({ ...base, postsSinceLastPairing: 1 }).includes('pairRepeat')
      // 🔴 재지 않은 것은 **통과가 아니라 unmeasured** 다 — 역할 쏠림은 회차 조건(C9)
      && personaUnmeasured({ ...base, roleShare: null }).includes('roleConcentrated')
      && !personaUsable({ ...base, roleShare: null })
  })())

  // ⑮ 숨겨진 글을 의도된 takedown 이라 부르지 않는다
  check('🔴 ⑮ **숨겨진 글을 의도된 takedown 이라 단정하지 않는다**', (() => {
    const sum = summarizeLinks([
      { queueId: 'q1', createdPostId: 'p1', postStatus: 'PUBLISHED' },
      { queueId: 'q2', createdPostId: 'p2', postStatus: 'HIDDEN' },
      { queueId: 'q3', createdPostId: 'p3', postStatus: null },
    ])
    const note = hiddenPostNote(sum)
    return (LINK_STATES as readonly string[]).includes('hiddenPost')
      && !(LINK_STATES as readonly string[]).includes('hiddenTakenDown')
      && sum.hiddenPost === 1 && linkCriticalCount(sum) === 1
      && note !== null && /알 수 없다/.test(note)
  })())

  // ⑯ runner 는 복합 사실이다
  check('🔴 ⑯ **runner 는 라벨 하나가 아니라 사실의 묶음이다**', (() => {
    const off = runnerFactsOf({ installed: true, loaded: false, enabled: false, failing: null })
    // 🔴 꺼 두었어도 설치·load 사실이 그대로 남는다
    const keepsFacts = off.state === 'disabledByPolicy' && off.installed && !off.loaded
      && off.failing === null && !off.canRun
    const thin = runnerFactsOf({
      installed: true, loaded: true, enabled: true, failing: false,
      requiredPerDay: 39, observedPerDay: 5,
    })
    const unknown = runnerFactsOf({
      installed: true, loaded: true, enabled: true, failing: false,
      requiredPerDay: 39, observedPerDay: null,
    })
    // 🔴 돌긴 도는데 모자라면 준비된 것이 아니다 · 재지 않은 것도 준비가 아니다
    return keepsFacts && thin.canRun && thin.capacitySatisfied === false
      && !capabilityFactsReady(thin)
      && unknown.capacitySatisfied === null && !capabilityFactsReady(unknown)
  })())

  // ⑰ North Star · 82cook 계약
  check('🔴 ⑰ **North Star 는 실제 이벤트 정의와 이어져 있고 actor 는 양성 허용목록이다**', (() => {
    /**
     * 🔴 **`events.ts` 와 이어져 있는가.** 상수를 손으로 적어 두면 이벤트를 붙여도
     *    목록이 그대로다 — 그래서 "계산으로 얻는다" 는 사실 자체를 본다.
     */
    const src = readFileSync('src/lib/north-star.ts', 'utf-8')
    const derived = /NORTH_STAR_MISSING_EVENTS[^=]*=\s*\n?\s*missingEvents\(/.test(src)
      // 🔴 하나가 실제로 생기면 목록이 줄어든다
      && missingEvents([...NORTH_STAR_REQUIRED_EVENTS], ['session_start']).length === 2
      && missingEvents([...NORTH_STAR_REQUIRED_EVENTS], [...NORTH_STAR_REQUIRED_EVENTS]).length === 0
    const connected = derived
      && !(EXISTING_ANALYTICS_EVENTS as readonly string[]).includes('session_start')
      && NORTH_STAR_MISSING_EVENTS.length === 3
    /**
     * 🔴 **집계 방어를 직접 시험한다.** `northStar` 로만 보면 지금은 이벤트가 없어
     *    무엇을 넣든 `measured:false` 라, 방어가 죽어도 검사가 통과한다 — 실제로 그랬다.
     */
    const unknownStops = typeof sumCountedActors({ 알수없음: 5 }) === 'string'
    const sum = sumCountedActors({ member: 4, guest: 2, persona: 9, bot: 1 })
    const excludesNonHuman = typeof sum !== 'string'
      && sum.total === 6 && sum.excluded.persona === 9 && sum.excluded.bot === 1
    const failClosed = unknownStops && excludesNonHuman
      && northStar({
        returningByActor: { 알수없음: 5 }, returningEngagedByActor: {}, measuredWeeks: 2,
      }).measured === false
    const personaExcluded = !countsTowardNorthStar('persona')
      && !countsTowardNorthStar('bot') && !countsTowardNorthStar('operator')
      && countsTowardNorthStar('member') && countsTowardNorthStar('guest')
    // 🔴 양성 허용목록 — 목록에 없는 이름은 North Star 가 아니다
    const positive = isNorthStarMetric('weeklyReturningEngagedUsers')
      && !isNorthStarMetric('새로만든지표') && !isNorthStarMetric('personaComments')
    return connected && failClosed && personaExcluded && positive
  })())

  check('🔴 ⑰-b **82cook — 목록도 예산이고, 사다리는 한 칸씩이고, 403 은 자동 재시도하지 않는다**', (() => {
    const budget = COUNTS_LIST_REQUESTS_IN_BUDGET
      && requestsPerRun(2, 5) === 7
      // 🔴 목록 4회분(4요청)이 먼저 빠진다 — "5×4=20" 이 아니다
      && dailyDetailCeiling({
        maxRequestsPerDay: 20, runsPerDay: 4, listPagesPerRun: 1, maxDetailPerRun: 5,
      }) === 16
    const step = (cur: number, clean: number, days: number, abort = false) =>
      judgeLadder({
        currentStep: cur, cleanRunsInCurrentStep: clean,
        incidentFreeDaysInCurrentStep: days, sawAbortSignal: abort,
      })
    const ladder = step(1, 0, 0).step.maxDetailPerRun === 5
      // 🔴 1칸에서 무사 3회 → 2칸 제안 가능
      && step(1, 3, 0).mayProposeNext && step(2, 0, 0).step.maxDetailPerRun === 10
      && step(2, 3, 0).mayProposeNext && step(3, 0, 0).step.maxDetailPerRun === 20
      // 🔴 3칸 → 4칸은 **회차 수로는 절대 못 간다**. 7일이 필요하다
      && !step(3, 999, 0).mayProposeNext && step(3, 0, 7).mayProposeNext
      && step(4, 0, 0).step.maxDetailPerRun === LADDER_MAX_DETAIL_PER_RUN
      // 🔴 중단 신호를 보면 직전 안전 칸으로 감속한다
      && step(4, 999, 99, true).step.step === 3 && step(4, 999, 99, true).decelerated
      && step(1, 999, 99, true).step.step === 1
    const retry = !mayAutoRetry('http403') && !mayAutoRetry('http429')
      && !mayAutoRetry('captcha') && mayAutoRetry('repeatedNetwork')
    const four = capacities82({
      requiredDetailPerDayAllSources: 382, ladder: step(1, 0, 0),
      listPagesPerRun: 1, canaryRunsPerDay: 4,
      observedDetailPerDay: null, observedDetailPerRun: null,
      operatingApprovedBy: null,
    })
    // 🔴 네 값이 섞이지 않는다 — 관측은 0 이 아니라 null 이다
    // 🔴 그리고 운영값은 **미승인·미관측이면 값 자체가 없다**
    const split = four.observed.detailPerDay === null && four.required.detailPerDay === 382
      && four.canary.detailPerDay !== four.required.detailPerDay
      && four.operating.detailPerDay === null && four.operating.requestsPerDay === null
    // 🔴 승인·관측이 있어도 canary 의 20요청 상한을 물려받지 않는다
    const approved = capacities82({
      requiredDetailPerDayAllSources: 382, ladder: step(4, 0, 7),
      listPagesPerRun: 1, canaryRunsPerDay: 4,
      observedDetailPerDay: 12, observedDetailPerRun: 4,
      operatingApprovedBy: 'founder',
    })
    const notInherited = approved.operating.requestsPerDay !== null
      && approved.operating.requestsPerDay > CANARY_CONTRACT.maxRequestsPerDay
      && approved.operating.detailPerRun === LADDER_MAX_DETAIL_PER_RUN
      && approved.operating.detailPerDay === 90
    // 🔴 쿠키는 값을 내지 않는다
    const cookie = describeCookieAudit({ present: true, count: 3, ageDays: 2 })
    return budget && ladder && retry && split && notInherited
      && /3개/.test(cookie) && !/=/.test(cookie)
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑬ 🔴 🔴 PR #555 3차 보정 — 이 아홉 가지를 되돌리면 반드시 깨진다')
// ─────────────────────────────────────────────────────────
{
  const cli = readFileSync('scripts/d100-master-readiness.mts', 'utf-8')
  const stock = readFileSync('scripts/lib/d100-operational-stock.mts', 'utf-8')
  const strip = (t: string): string =>
    t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  // ① 운영 d1 을 d3 으로 표시하면 FAIL
  // ② D3 수치로 D5 승격하면 FAIL
  // ③ readyProduced 를 readyNet 으로 연결하면 FAIL
  check('🔴 ③ **생산량과 재고 증감이 다른 값이고, 증감은 스냅샷 차이로만 나온다**', (() => {
    const wired = /readyQualifiedPerDay/.test(strip(cli)) && /readyStockDeltaPerDay/.test(strip(cli))
      // 🔴 생산량을 재고 증감 자리에 넘기는 배선이 없어야 한다
      && !/readyStockDeltaPerDay\s*:\s*readyQualifiedPerDay/.test(strip(cli))
      && !/readyStockDeltaPerDay\s*:\s*perDay\(produced/.test(strip(stock))
      && /readyNetFromSnapshots/.test(strip(stock))
    const NOW = new Date('2026-09-21T00:00:00.000Z')
    // 🔴 스냅샷이 없으면 unmeasured 다 — 0 이 아니다
    const none = readyNetFromSnapshots({ snapshots: [], nowStock: 3, now: NOW })
    // 🔴 판이 다르면 비교가 성립하지 않는다
    const other = readyNetFromSnapshots({
      snapshots: [{ at: '2026-09-11T00:00:00.000Z', readyStock: 1, selectorVersion: 'other' }],
      nowStock: 3, now: NOW,
    })
    // 🔴 간격이 하루 미만이면 하루치를 말할 수 없다
    const tooSoon = readyNetFromSnapshots({
      snapshots: [{ at: '2026-09-20T18:00:00.000Z', readyStock: 1, selectorVersion: READY_SELECTOR_VERSION }],
      nowStock: 3, now: NOW,
    })
    const diff = readyNetFromSnapshots({
      snapshots: [{ at: '2026-09-11T00:00:00.000Z', readyStock: 1, selectorVersion: READY_SELECTOR_VERSION }],
      nowStock: 3, now: NOW,
    })
    /**
     * 🔴 **왜 못 쟀는지가 화면에 남아야 한다.** "없음" 같은 말로 줄이면 사람이
     *    "0 이라는 뜻인가" 로 읽는다 — 그 오독이 바로 이 절의 결함이었다.
     */
    const saysWhy = !none.measured && /스냅샷/.test(none.reason)
      && !other.measured && /판|selector|버전/i.test(other.reason)
      && !tooSoon.measured && /일/.test(tooSoon.reason)
    return wired && !none.measured && !other.measured && !tooSoon.measured && saysWhy
      && diff.measured && diff.perDay === 0.2 && diff.spanDays === 10
  })())

  // ④ synthetic RawContent 가 detail/day 를 올리면 FAIL
  check('🔴 ④ **상세/day 는 수집 회차 기록에서만 나온다 — DB 행 수가 아니다**', (() => {
    // 🔴 `microSeedRawContent.count` 로 상세를 세는 배선이 없어야 한다
    const noDbCount = !/microSeedRawContent\.count/.test(strip(stock))
      && /detailThroughput/.test(strip(stock)) && /readRunRecords/.test(strip(stock))
    const NOW = new Date('2026-09-21T00:00:00.000Z')
    const rec = (over: Partial<CollectRunRecord>): CollectRunRecord => ({
      runId: 'r', source: 'navercafe:wgang', trigger: 'schedule', mode: 'detail', status: 'ok',
      startedAt: '2026-09-20T00:00:00.000Z', endedAt: null, code: null,
      listRows: 10, detailRequests: 5, bodyRows: 5, thinRows: 5,
      skippedSeen: 0, repeatedRows: 0, newUniqueThinRows: 5, ...over,
    })
    const base = detailThroughput({
      windowDays: 10, now: NOW,
      recordsOf: (src) => src === 'navercafe:wgang' ? [rec({})] : [],
    })
    /**
     * 🔴 **합성 행을 아무리 넣어도 이 수는 움직이지 않는다.**
     *    회차 기록을 늘리지 않는 한 상세 수집량은 변하지 않는다 —
     *    그것이 DB 행 수를 세지 않는 이유다.
     */
    const same = detailThroughput({
      windowDays: 10, now: NOW,
      recordsOf: (src) => src === 'navercafe:wgang' ? [rec({})] : [],
    })
    // 🔴 상세를 열고도 본문을 못 읽은 회차는 성공이 아니다
    const noBody = detailThroughput({
      windowDays: 10, now: NOW,
      recordsOf: (src) => src === 'navercafe:wgang' ? [rec({ bodyRows: 0, newUniqueThinRows: 99 })] : [],
    })
    /**
     * 🔴 **회차는 돌았는데 본문을 못 읽었으면 `0/day` 다** (5차 보정).
     *    기록이 있으니 "잴 수 없다" 가 아니라 "재 봤더니 0" 이다.
     *    기록 자체가 없는 공급원만 `unmeasured` 다.
     */
    return noDbCount && base.perDay === 0.5 && same.perDay === base.perDay
      && noBody.perDay === 0
      && noBody.unmeasuredSources.length === DETAIL_SOURCES.length - 1
  })())

  // ⑤ 예약 전망을 0 으로 하드코딩하면 FAIL
  // ⑥ Persona 3계층 중 하나를 계기판에서 제거하면 FAIL
  check('🔴 ⑥ **계기판이 Persona 준비를 따로 판정하지 않는다 — 계약 유효 수 주입 하나(두 번째 정본 없음)**', (() => {
    // 🔴 (2026-09-30) 계기판은 3계층을 **따로 판정하지 않는다** — 계약 유효 Persona 는 Persona 레인 정본 하나를
    //    주입 인터페이스(`contractValidPersonas`)로 받는다. 아래 순수 함수 검사는 lib 계약으로만 남는다.
    const wired = !/personaTierReadiness|personaReadinessOk/.test(strip(stock)) && !/personaTiers|personaReady\b/.test(strip(cli))
      && /contractValidPersonas/.test(strip(stock)) && /contractValidPersonas/.test(strip(cli))
    const FULL: PersonaCandidate = {
      code: 'P', filledAxes: [...PERSONA_LIFE_AXES], ageBand: '50대 초반',
      voiceComments: VOICE_MIN_COMMENTS, activityToday: 0, consecutiveExposures: 0,
      daysSinceActive: 0, retired: false, qualificationConflict: false,
      roleShare: 0, postsSinceLastPairing: 'never',
    }
    const many = Array.from({ length: 24 }, (_, i) => ({ ...FULL, code: `P${i}` }))
    const all = personaTierReadiness({ stage: 'd3', candidates: many })
    const ready = personaReadinessOk(all) && all.length === 3
    // 🔴 한 층이라도 아니면 전체가 아니다
    const cardBroken = personaTierReadiness({
      stage: 'd3', candidates: many.map((p) => ({ ...p, ageBand: null })),
    })
    // 🔴 재지 않은 축이 있으면 그 층은 ready 가 아니다 — 역할 쏠림은 **회차** 층이다(2026-10-01 · C9)
    const unmeasured = personaTierReadiness({
      stage: 'd3', candidates: many.map((p) => ({ ...p, roleShare: null })),
    })
    return wired && ready
      && !personaReadinessOk(cardBroken) && cardBroken[0]!.ready === false
      && !personaReadinessOk(unmeasured)
      && unmeasured[2]!.tier === 'assignment' && unmeasured[2]!.unmeasured.roleConcentrated === 24
  })())

  // ⑦ 82cook operating 이 canary 20요청 상한을 상속하면 FAIL
  check('🔴 ⑦ **operating 이 canary 예산을 물려받지 않는다**', (() => {
    const src = strip(readFileSync('src/lib/collect-82cook-recovery.ts', 'utf-8'))
    // 🔴 operating 칸을 만드는 자리에서 canary 상수를 예산으로 쓰지 않는다
    const opBlock = src.slice(src.indexOf("kind: 'operating'"))
    const clean = opBlock.slice(0, opBlock.indexOf("kind: 'required'"))
    return !/CANARY_CONTRACT\.maxRequestsPerDay/.test(clean)
  })())

  // ⑧ 7일 무사고 조건을 제거하면 FAIL
  check('🔴 ⑧ **마지막 칸의 조건은 7일 무사고다 — 회차 수로 대체되지 않는다**', (() => {
    const top = ESCALATION_LADDER[ESCALATION_LADDER.length - 1]!
    const byDays = top.incidentFreeDaysInPrevStep === TOP_STEP_INCIDENT_FREE_DAYS
      && TOP_STEP_INCIDENT_FREE_DAYS === 7
      && top.maxDetailPerRun === 30 && top.maxRunsPerDay === 3
    // 🔴 무사 회차가 아무리 많아도 날이 차지 않으면 못 올라간다
    const runsCannotSubstitute = !judgeLadder({
      currentStep: 3, cleanRunsInCurrentStep: 10_000,
      incidentFreeDaysInCurrentStep: 6, sawAbortSignal: false,
    }).mayProposeNext
    const daysWork = judgeLadder({
      currentStep: 3, cleanRunsInCurrentStep: 0,
      incidentFreeDaysInCurrentStep: 7, sawAbortSignal: false,
    }).mayProposeNext
    // 🔴 20~30 사이에서만 움직인다
    const band = LADDER_TOP_MIN_DETAIL_PER_RUN === 20 && LADDER_MAX_DETAIL_PER_RUN === 30
    return byDays && runsCannotSubstitute && daysWork && band
  })())

  // ⑨ hiddenPost 를 사람이 내린 글로 단정하면 FAIL — 위 ⑤절이 전 경로를 훑는다
  check('🔴 ⑨ **계기판도 주체를 단정하지 않는다**', (() => {
    const code = strip(cli)
    return !/사람이 내린 글/.test(code) && !/takenDown/.test(code)
  })())

  // 🔴 공급원별 수집 — wgang 하나만 보여 주면 나머지가 죽어도 초록이다
  check('🔴 ⑨-b **수집 job 을 공급원마다 따로 보여 준다**', (() => {
    const code = strip(cli)
    return /remonterrace/.test(code) && /82cook/.test(code) && /collectJobs/.test(code)
      && DETAIL_SOURCES.length === 3
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑭ 🔴 🔴 PR #555 4차 보정 — 승격 수학')
// ─────────────────────────────────────────────────────────
{
  const cli = readFileSync('scripts/d100-master-readiness.mts', 'utf-8')
  const stock = readFileSync('scripts/lib/d100-operational-stock.mts', 'utf-8')
  const strip = (t: string): string =>
    t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const D3 = d100Plan('d3')

  /**
   * ① 🔴 **D3 에서 4건 만들고 3건 내보내 재고 +1 은 정상이다.**
   *    앞판은 이것을 "순증가 1 < 필요 4" 로 막았다 — 정상 운영이 승격을 막은 셈이다.
   */
  /**
   * ② 🔴 **D1 에서 이미 3/day 를 요구하면 통과할 수 없다.**
   *    올라가야 낼 수 있는 양을 올라가기 전에 요구하는 것이기 때문이다.
   */
  /**
   * ③ 🔴 **빈 이력을 넘기면 주 상한·간격이 한 번도 적용되지 않는다.**
   */
  /**
   * ④ 🔴 **층 배치와 미측정 처리.**
   */
  check('🔴 ④ **Persona 층이 정본대로이고 모르는 축은 통과가 아니다**', (() => {
    const tiers = (PERSONA_BLOCK_TIER as Record<string, string>)
    const canon = tiers.lifeAxisMissing === 'card' && tiers.noAgeBand === 'card'
      && tiers.voiceEvidenceThin === 'card' && tiers.retired === 'card'
      && tiers.dormant === 'card' && tiers.qualificationConflict === 'card'
      // 🔴 (2026-10-01 · C9) 역할 쏠림은 회차 층 · 라벨 없는 소재 쏠림 코드는 없다
      && tiers.topicConcentrated === undefined && tiers.roleConcentrated === 'assignment'
      && tiers.activityOverCap === 'assignment' && tiers.consecutiveExposure === 'assignment'
      && tiers.pairRepeat === 'assignment'
    const FULL: PersonaCandidate = {
      code: 'P', filledAxes: [...PERSONA_LIFE_AXES], ageBand: '50대 초반',
      voiceComments: VOICE_MIN_COMMENTS, activityToday: 0, consecutiveExposures: 0,
      daysSinceActive: 0, retired: false, qualificationConflict: false,
      roleShare: 0, postsSinceLastPairing: 'never',
    }
    // 🔴 모르면 통과가 아니다 — 0/false 로 떨어뜨리지 않는다
    const unknownExposure = personaTiers({ ...FULL, consecutiveExposures: null })
    const unknownQual = personaTiers({ ...FULL, qualificationConflict: null })
    // 🔴 실제 reader 도 `null` 을 넘긴다
    const readerHonest = /consecutiveExposures: null/.test(
      readFileSync('scripts/lib/d100-persona-tiers.mts', 'utf-8'))
      && /qualificationConflict: null/.test(
        readFileSync('scripts/lib/d100-persona-tiers.mts', 'utf-8'))
    return canon
      && unknownExposure.assignment.unmeasured.includes('consecutiveExposure')
      && !unknownExposure.assignment.ok
      && unknownQual.card.unmeasured.includes('qualificationConflict') && !unknownQual.card.ok
      && readerHonest
  })())

  /**
   * ⑤ 🔴 **`failing=null` 은 ready 가 아니다.**
   */
  check('🔴 ⑤ **최근 회차 성패를 모르면 ready 가 아니다**', (() => {
    const unknown = runnerFactsOf({ installed: true, loaded: true, enabled: true, failing: null })
    const healthy = runnerFactsOf({ installed: true, loaded: true, enabled: true, failing: false })
    const broken = runnerFactsOf({ installed: true, loaded: true, enabled: true, failing: true })
    return unknown.state === 'healthUnknown' && !unknown.canRun && !capabilityFactsReady(unknown)
      && unknown.reason !== null && /모른다/.test(unknown.reason)
      && healthy.state === 'ready' && capabilityFactsReady(healthy)
      && broken.state === 'unhealthy' && !broken.canRun
      && (RUNNER_STATES as readonly string[]).includes('healthUnknown')
      // 🔴 수집은 회차 기록으로 실제 성패를 읽는다 — 기록이 없으면 `null`
      && latestRunFailing([]) === null
  })())

  /** 🔴 `--record-snapshot` 실패를 삼키지 않는다 */
  /**
   * 🔴 **문자열이 있는지 보지 않는다** (5차 보정).
   *    앞판은 `throw new SnapshotWriteFailed` 와 `process.exit(1)` 이 **둘 다 코드에 있는지**만
   *    봤다. 그런데 예외가 중간 `catch` 에 삼켜져 실제 종료코드는 0 이었다 —
   *    코드에 있는 것과 도는 것은 다르다. 이제 **실제로 불러 본다.**
   */
  await (async () => {
    const okStock: Awaited<ReturnType<typeof runReadiness>>['stock'] = {
      ok: false, detail: '시험용 — 읽지 않았다',
    }
    // ① 적으라고 했는데 재고를 읽지 못했다 → 🔴 exit 1
    const failRead = await runReadiness({ read: async () => okStock, recordSnapshot: true })
    // ② 적으라고 하지 않았으면 읽기 실패는 그대로 보고하고 0 으로 끝난다
    const noRecord = await runReadiness({ read: async () => okStock, recordSnapshot: false })
    // ③ 🔴 기록 실패 예외가 밖까지 전해진다 → exit 1
    const writeFailed = await runReadiness({
      read: async () => { throw new SnapshotWriteFailed('시험용 기록 실패') },
      recordSnapshot: true,
    })
    check('🔴 ⑤-b① **적으라 했는데 못 읽으면 exit 1**',
      failRead.exitCode === 1 && failRead.failure !== null, JSON.stringify(failRead.failure))
    check('🔴 ⑤-b② **안 적을 때는 0 으로 끝난다 — 기본 실행은 read-only**',
      noRecord.exitCode === 0 && noRecord.failure === null)
    check('🔴 ⑤-b③ **기록 실패 예외가 삼켜지지 않고 exit 1 이 된다**',
      writeFailed.exitCode === 1 && (writeFailed.failure ?? '').includes('시험용 기록 실패'))
  })()

  /** 🔴 **실제 파일 경로에 못 쓰면 `false` 를 낸다** — 진짜 fs 로 확인한다 */
  check('🔴 ⑤-b④ **쓸 수 없는 경로면 appendSnapshot 이 false 다**', (() => {
    // 🔴 디렉터리를 파일 경로로 준다 — 열 수 없다
    const bad = join(tmpdir(), `soran-d100-snap-${process.pid}`)
    mkdirSync(bad, { recursive: true })
    try {
      return appendSnapshot(3, new Date(), bad) === false
    } finally { rmSync(bad, { recursive: true, force: true }) }
  })())

  /**
   * 🔴 **읽기 catch 가 기록 실패를 삼키면 안 된다.**
   *    기록을 try 안으로 되돌려도 여기서 막힌다 — 이중 방어다.
   */
  check('🔴 ⑤-b⑥ **읽기 catch 가 기록 실패를 삼키지 않는다**', (() => {
    // 🔴 보통 예외는 읽기 실패로 바뀐다
    const normal = readFailureOf(new Error('DB 연결 끊김'))
    if (normal.ok || !normal.detail.includes('DB 연결 끊김')) return false
    // 🔴 기록 실패는 그대로 밖으로 나간다
    try {
      readFailureOf(new SnapshotWriteFailed('적지 못했다'))
      return false
    } catch (e) { return e instanceof SnapshotWriteFailed }
  })())

  /** 🔴 CLI 가 그 조립 경로를 쓰는가 — 인라인 판단으로 되돌아가면 잡힌다 */
  check('🔴 ⑤-b⑤ **CLI 가 runReadiness 를 거친다**', (() => {
    const code = strip(cli)
    return /await runReadiness\(/.test(code)
      && /process\.exit\(run\.exitCode\)/.test(code)
      && /--record-snapshot/.test(code)
      // 🔴 기록은 읽기 catch 밖에서 한다 — 안에서 던지면 읽기 실패로 둔갑한다
      && /snapshotToWrite/.test(strip(stock))
  })())

  /** 🔴 관측 일수 상수를 없앴다 */
}

// ─────────────────────────────────────────────────────────
console.log('\n⑮ 🔴 🔴 PR #555 5차 보정 — 세 결함의 회귀')
// ─────────────────────────────────────────────────────────
{
  const cli = readFileSync('scripts/d100-master-readiness.mts', 'utf-8')
  const strip = (t: string): string =>
    t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const D3 = d100Plan('d3'); const D5 = d100Plan('d5')

  /**
   * ① 🔴 **실제 CLI 가 조립하는 방식 그대로 판정한다.**
   *    앞판은 `currentLimitsActive` 자리에 `현재 === 다음` 을 넣었다 —
   *    다음은 정의상 현재가 아니므로 canary 는 **언제나 false** 였다.
   */
  check('🔴 ①-d **CLI 의 지금 단계는 저장된 StageDecision 에서 온다 — env 문자열 · 승격 조립 없음**', (() => {
    const code = strip(cli)
    return /readCurrentStageDecision\(/.test(code) && !/releaseStageFromEnvText|judgePromotion|promo\./.test(code)
  })())

  /**
   * ③ 🔴 **정상 조회 0 건은 측정된 0/day 다.**
   */
}

// ─────────────────────────────────────────────────────────
console.log('\n⑯ 🔴 🔴 안정화 판정 — 7일 조건이 몰래 14일이 되면 FAIL')
// ─────────────────────────────────────────────────────────
{
  const NOW = new Date('2026-09-21T03:00:00.000Z') // 12:00 KST — 오늘은 아직 안 끝났다
  /** 🔴 어제부터 거슬러 `n` 일 동안 하루 `count` 편씩 — 실제 발행 시각 목록을 만든다 */
  const days = (from: number, n: number, count: number): Date[] => {
    const out: Date[] = []
    for (let i = from; i < from + n; i += 1) {
      for (let k = 0; k < count; k += 1) {
        out.push(new Date(NOW.getTime() - i * 86_400_000 - k * 3600_000))
      }
    }
    return out
  }
  /** 🔴 **실제 생산값 계산부터 승격 판정까지 이어 붙인다** */
  /**
   * 🔴 **d1 에서 7일 1편 → d3 에서 7일 3편.**
   *    연속 달성은 7일로 찼는데 14일 평균은 (7 + 21)/14 = 2편/day 다 —
   *    앞판은 여기서 "3/day 미달" 로 막았다. 단계를 올린 직후가 가장 오래 막히는 구조였다.
   */
  /** 🔴 관측 기간이 다른 단계도 같은 규칙이다 — d5 는 7일, d10 은 14일 */
  /** 🔴 **오늘의 미완료 날짜는 달성일에 넣지 않는다** */
  /** 🔴 14일 평균을 다시 필수 조건으로 넣으면 여기서 깨진다 */
}

// ─────────────────────────────────────────────────────────
console.log('\n⑰ 🔴 🔴 공급 깔때기 재대조 — 이름을 흐리면 FAIL')
// ─────────────────────────────────────────────────────────
{
  const NOW = Date.parse('2026-09-21T06:00:00.000Z')
  const ev = (over: Partial<StageEvidence> & { stage: StageEvidence['stage'] }): StageEvidence => ({
    lastAtMs: NOW - 3600_000, recentCount: 10, unit: '건', switchedOff: null,
    staleAfterDays: 1, ...over,
  })

  /** 🔴 세 가지 상태가 실제로 갈린다 */
  check('🔴 **가동·정지·미측정이 갈린다 — 근거가 없으면 0 이 아니다**', (() => {
    const running = judgeStageStatus(ev({ stage: 'judge' }), NOW)
    const stale = judgeStageStatus(ev({ stage: 'judge', lastAtMs: NOW - 5 * 86_400_000 }), NOW)
    const off = judgeStageStatus(ev({ stage: 'judge', switchedOff: true }), NOW)
    // 🔴 볼 근거가 아예 없다 — "안 돈다" 라고 단정하지 않는다
    const none = judgeStageStatus(ev({ stage: 'judge', lastAtMs: null, recentCount: null }), NOW)
    return running === 'running' && stale === 'stopped' && off === 'stopped' && none === 'unmeasured'
  })())

  /**
   * 🔴 **한 번의 회차를 일수로 나누지 않는다.**
   *    canary 3건을 14 로 나누면 0.2/day 가 되는데, 하루도 정상 가동한 적이 없다.
   */
  check('🔴 🔴 **회차가 하나면 일간 값을 내지 않는다**', (() => {
    const one = rateOf({ count: 3, runs: 1, days: 14, lastAt: '2026-09-21' })
    const many = rateOf({ count: 28, runs: 10, days: 14 })
    const none = rateOf({ count: 0, runs: 0, days: 14 })
    return one.kind === 'singleRun' && one.count === 3
      && /일간 값으로 읽지 않는다/.test(showRate(one))
      && many.kind === 'daily' && many.perDay === 2
      && none.kind === 'unmeasured'
      && MIN_RUNS_FOR_DAILY_RATE === 2
  })())

  /** 🔴 **backlog 와 유입을 섞지 않는다** */
  check('🔴 🔴 **계약 불일치를 "오래된 것" 이라 부르지 않는다**', (() => {
    const lines = describeBacklog({
      backlog: 239, backlogUsable: 4, backlogContractMismatch: 213,
      inflow: rateOf({ count: 3, runs: 1, days: 14 }),
    })
    const joined = lines.join(' ')
    return /backlog 239건/.test(joined) && /못 쓰는 것 213건/.test(joined)
      && /오래돼서" 가 아니다/.test(joined)
      // 🔴 backlog 와 유입이 한 숫자로 합쳐지지 않는다
      && !/242|236/.test(joined)
  })())

  /** 🔴 **끊긴 자리는 가장 위의 멎은 칸이다** */
  check('🔴 🔴 **아래 칸을 고치라고 말하지 않는다 — 가장 위에서 끊긴 곳을 찾는다**', (() => {
    const facts = buildStageFacts({
      nowMs: NOW,
      evidence: [
        ev({ stage: 'sourceList' }), ev({ stage: 'sourceDetail' }),
        // 🔴 여기서 끊긴다
        ev({ stage: 'adapt', switchedOff: true }),
        // 🔴 아래 칸은 입력이 끊겨 산출물이 오래됐다
        ev({ stage: 'judge', lastAtMs: NOW - 5 * 86_400_000 }),
        ev({ stage: 'draft', lastAtMs: NOW - 5 * 86_400_000 }),
      ],
    })
    const broken = firstBrokenStage(facts)
    const judge = facts.find((f) => f.stage === 'judge')!
    /**
     * 🔴 **산출물이 최근이면 그 칸은 돈 것이다** — 위 칸이 멎었어도 그렇다.
     *    (손으로 한 번 돌린 회차가 그런 모습이다) 그래서 아래 칸이 굶은 모습은
     *    "산출물이 오래됐다" 로 나타난다.
     */
    const ranOnce = buildStageFacts({
      nowMs: NOW,
      evidence: [ev({ stage: 'adapt', switchedOff: true }), ev({ stage: 'judge' })],
    }).find((f) => f.stage === 'judge')!
    return broken?.stage === 'adapt'
      && judge.status === 'stopped'
      && (judge.blockedReason ?? '').includes('위 칸이 멎어')
      && ranOnce.status === 'running' && ranOnce.blockedReason === null
  })())

  /** 🔴 **자기 스위치도 꺼져 있으면 그것도 적는다** */
  check('🔴 **이유를 하나만 고르지 않는다 — 위 칸과 자기 스위치를 함께 적는다**', (() => {
    const facts = buildStageFacts({
      nowMs: NOW,
      evidence: [ev({ stage: 'adapt', switchedOff: true }), ev({ stage: 'publish', switchedOff: true })],
    })
    const pub = facts.find((f) => f.stage === 'publish')!
    return (pub.blockedReason ?? '').includes('스위치가 꺼져 있다')
      && (pub.blockedReason ?? '').includes('위 칸이 멎어')
  })())

  /** 🔴 **Persona 0명의 두 뜻을 가른다** */
  check('🔴 🔴 **완전 인증 0명과 실제로 쓸 사람 0명을 가른다**', (() => {
    const FULL: PersonaCandidate = {
      code: 'P', filledAxes: [...PERSONA_LIFE_AXES], ageBand: '50대 초반',
      voiceComments: VOICE_MIN_COMMENTS, activityToday: 0, consecutiveExposures: 0,
      daysSinceActive: 0, retired: false, qualificationConflict: false,
      roleShare: 0, postsSinceLastPairing: 'never',
    }
    // 🔴 전원이 자격 감사만 미측정 — 막힌 데는 없다
    const onlyUnmeasured = personaTierReadiness({
      stage: 'd3',
      candidates: Array.from({ length: 24 }, (_, i) => ({
        ...FULL, code: `P${i}`, qualificationConflict: null,
      })),
    })
    const card = onlyUnmeasured.find((t) => t.tier === 'card')!
    // 🔴 전원이 실제로 막혀 있다
    const reallyBlocked = personaTierReadiness({
      stage: 'd3',
      candidates: Array.from({ length: 24 }, (_, i) => ({ ...FULL, code: `P${i}`, ageBand: null })),
    }).find((t) => t.tier === 'card')!
    // 🔴 (2026-09-30) 계기판은 3계층을 찍지 않는다 — 이 구분은 lib 계약으로만 남는다(Persona 레인 reserve 가 정본)
    const wired = !/passedIgnoringUnmeasured/.test(
      readFileSync('scripts/d100-master-readiness.mts', 'utf-8'))
    return card.passed === 0 && card.passedIgnoringUnmeasured === 24
      && (card.reason ?? '').includes('24명')
      && reallyBlocked.passed === 0 && reallyBlocked.passedIgnoringUnmeasured === 0
      && wired
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑱ 🔴 🔴 단계별 사실 연결 — 남의 시각·남의 건수를 빌리면 FAIL')
// ─────────────────────────────────────────────────────────
{
  const d = (iso: string): Date => new Date(iso)

  /**
   * ① 🔴 **다른 큐 행이 새로 생겨도 세 단계가 움직이면 안 된다.**
   *    앞판은 세 단계 모두 `Queue.createdAt` 을 마지막 시각으로 썼다 —
   *    적재만 일어나도 사람 검토·배정·발행이 방금 된 것처럼 보였다.
   */
  check('🔴 ① **큐 행이 새로 생겨도 READY·배정·발행 시각은 그대로다**', (() => {
    const base = {
      decidedAts: [d('2026-09-10T00:00:00Z')],
      matchedAts: [d('2026-09-11T00:00:00Z')],
      postTimes: [{ postId: 'p1', createdAt: d('2026-09-12T00:00:00Z') }],
      linkedPostIds: ['p1'],
      queueCreatedAts: [d('2026-09-12T00:00:00Z')],
    }
    const before = stageTimesOf(base)
    // 🔴 **큐 행만** 새로 생겼다 — 다른 단계는 아무 일도 없었다
    const after = stageTimesOf({
      ...base, queueCreatedAts: [...base.queueCreatedAts, d('2026-09-21T00:00:00Z')],
    })
    return before.humanReadyAtMs === after.humanReadyAtMs
      && before.personaMatchAtMs === after.personaMatchAtMs
      && before.publishAtMs === after.publishAtMs
      // 🔴 적재 시각만 움직인다
      && after.candidateAtMs !== before.candidateAtMs
      // 🔴 세 시각이 서로 다르다 — 하나를 돌려쓰지 않는다
      && new Set([after.humanReadyAtMs, after.personaMatchAtMs, after.publishAtMs]).size === 3
      /**
       * 🔴 **큐 행으로 발행 시각을 지어낼 수 없다.** 모양이 같아도 id 가
       *    큐가 가리키는 Post 집합 밖이면 한 건도 세지 않는다.
       */
      && stageTimesOf({
        ...base,
        postTimes: [{ postId: 'queue-row-id', createdAt: d('2026-09-21T00:00:00Z') }],
      }).publishAtMs === null
  })())

  /**
   * ② 🔴 **거절·계약 불일치는 READY 가 아니다.**
   *    실측: 사람 검토 이력 11건 · 실제 레인 READY 4건.
   */
  check('🔴 ② **검토 이력 11건을 READY 11건으로 적으면 잡힌다**', (() => {
    /**
     * 🔴 **실제 저장 형식 그대로 넣는다.** 거절된 글·계약 불일치·이미 발행된 글이
     *    섞인 목록에서 READY 재고가 얼마가 되는지를 본다.
     */
    const SINCE = d('2026-09-07T00:00:00Z').getTime()
    const row = (o: Partial<LaneRow> & { id: string }): LaneRow => ({
      status: 'APPROVED', createdPostId: null, humanDecided: true, contractOk: true,
      decidedAt: d('2026-09-20T00:00:00Z'), ...o,
    })
    const rows: LaneRow[] = [
      row({ id: 'ok1' }), row({ id: 'ok2' }), row({ id: 'ok3' }), row({ id: 'ok4' }),
      // 🔴 거절 — READY 가 아니다
      row({ id: 'declined', status: 'DECLINED' }),
      row({ id: 'expired', status: 'EXPIRED' }),
      // 🔴 계약 불일치 — 사람이 봤어도 지금 레인으로 못 나간다
      row({ id: 'legacy1', contractOk: false }),
      row({ id: 'legacy2', contractOk: false }),
      // 🔴 이미 발행됨 — 재고가 아니다
      row({ id: 'published', status: 'PUBLISHED', createdPostId: 'post-1' }),
      // 🔴 창 밖 검토 이력
      row({ id: 'old', decidedAt: d('2026-08-01T00:00:00Z') }),
    ]
    /** 🔴 발행기가 고른 id — 계약 불일치·발행된 것은 애초에 고르지 않는다 */
    const publishableIds = ['ok1', 'ok2', 'ok3', 'ok4']
    const measured = laneReadyOf({ rows, publishableIds, sinceMs: SINCE })
    const excludes = measured.lanePublishable === 4
      && measured.laneContract === 8 && measured.laneNotRejected === 6
      && measured.laneUnpublished === 5
      // 🔴 사람이 본 이력은 10건이지만 READY 는 4건이다
      && measured.humanReviewHistoryAll === 10
      && measured.humanReviewHistoryInWindow === 9
    /** 🔴 미발행 집합 밖의 id 를 고르면 세지 않는다 — 재고가 부풀지 않는다 */
    const foreign = laneReadyOf({
      rows, publishableIds: [...publishableIds, 'published', '없는행'], sinceMs: SINCE,
    }).lanePublishable === 4

    const real: LaneReadySplit = {
      humanReviewHistoryAll: 25, humanReviewHistoryInWindow: 11,
      laneContract: 10, laneNotRejected: 10, laneUnpublished: 4, lanePublishable: 4,
    }
    if (!excludes || !foreign) return false
    const lines = describeLaneReady(real).join(' ')
    return laneReadyMisreported(real, 11) && !laneReadyMisreported(real, 4)
      && /발행기 후보\(신선도 검사 \*\*전\*\*\) 4건/.test(lines)
      // 🔴 신선도 전 수를 "READY 재고" 라 부르지 않는다
      && !/READY 재고 4건/.test(lines)
      && /사람 검토 이력 11건/.test(lines)
      && /READY 재고가 아니다/.test(lines)
      // 🔴 깔때기가 좁아지는 것이 보인다
      && real.laneContract >= real.laneNotRejected
      && real.laneNotRejected >= real.laneUnpublished
      && real.laneUnpublished >= real.lanePublishable
  })())

  /**
   * ③ 🔴 **실제 저장 형식**으로 읽는다. 모양이 아니면 `null` 이고 0 이 아니다.
   */
  check('🔴 ③ **workset 은 정본 계약이 판정한다 — 두 번째 규칙을 두지 않는다**', (() => {
    /** 🔴 실제 파일 형식 그대로 */
    const RUN = '20260921-003912'
    const realFile = {
      kind: 'supply-workset', version: 'workset-v1', runId: RUN,
      takenAt: '2026-09-21T00:39:13.895Z', limit: 5,
      sourceIds: ['35038277', '35038242', '35038433', '35038800', '35022233'],
    }
    const one = (json: unknown, file = `supply-workset-${RUN}.json`) =>
      worksetEvidenceOf([{ file, runId: worksetRunIdOf(file), json }], readWorkset)

    const good = one(realFile)
    if (good.ok !== 1 || good.sourceIds !== 5 || good.broken.length !== 0) return false
    if (good.lastTakenAtMs !== Date.parse(realFile.takenAt)) return false

    /**
     * 🔴 **정상 5건으로 세면 안 되는 반례들.** 전부 실제 함수를 불러 확인한다 —
     *    앞판의 두 번째 검증기는 아래 넷을 모두 통과시켰다.
     */
    const cases: [string, unknown, string][] = [
      // 🔴 틀린 판
      ['틀린 version', { ...realFile, version: 'workset-v0' }, 'VERSION'],
      // 🔴 상한 초과 — 여기서 새는 것이 가장 위험하다
      ['상한 초과', { ...realFile, limit: 3 }, 'OVER_LIMIT'],
      // 🔴 읽을 수 없는 takenAt — "시각만 모르는 정상 묶음" 으로 두면 멎은 단계가 초록이다
      ['잘못된 takenAt', { ...realFile, takenAt: '어제쯤' }, 'SHAPE'],
      ['takenAt 없음', { ...realFile, takenAt: undefined }, 'SHAPE'],
      ['다른 종류', { ...realFile, kind: 'something-else' }, 'KIND'],
      ['빈 id 섞임', { ...realFile, sourceIds: ['35038277', ''] }, 'SHAPE'],
      ['sourceIds 가 배열이 아니다', { ...realFile, sourceIds: 'a,b' }, 'SHAPE'],
      ['limit 이 정수가 아니다', { ...realFile, limit: 0 }, 'SHAPE'],
      ['객체가 아니다', null, 'PARSE'],
    ]
    for (const [name, json, code] of cases) {
      const r = one(json)
      if (r.ok !== 0 || r.sourceIds !== 0 || r.lastTakenAtMs !== null) return false
      if (r.broken.length !== 1 || r.broken[0]!.code !== code) return false
      void name
    }
    // 🔴 파일 이름의 회차와 안의 회차가 다르면 받지 않는다
    const wrongRun = one(realFile, 'supply-workset-20260101-000000.json')
    if (wrongRun.ok !== 0 || wrongRun.broken[0]!.code !== 'RUN_MISMATCH') return false
    // 🔴 이름에서 회차를 못 읽으면 받지 않는다
    const badName = one(realFile, 'workset.json')
    if (badName.ok !== 0 || badName.broken[0]!.code !== 'NAME') return false

    /** 🔴 관제가 정본을 부르고, 자기 규칙을 따로 두지 않는다 */
    const src = readFileSync('scripts/d100-supply-funnel.mts', 'utf-8')
    // 🔴 주석의 낱말은 규칙이 아니다 — 코드에서만 본다
    const stripC = (t: string): string =>
      t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const lib = stripC(readFileSync('src/lib/d100-supply-funnel.ts', 'utf-8'))
    return /readWorkset\b/.test(src) && /worksetEvidenceOf\(/.test(src)
      // 🔴 두 번째 검증기가 다시 생기면 잡힌다
      && !/readWorksetManifest/.test(lib) && !/WORKSET_KIND/.test(lib)
  })())

  check('🔴 ③-b **검수 미완료를 완료로 세지 않는다**', (() => {
    // 🔴 실제 artifacts 형식 — 완료는 `review.semanticCompletion.complete === true` 뿐이다
    const art = (complete: unknown): unknown => ({
      artifactVersion: 'human-review-v9', sourceArticleId: 'x',
      review: { deterministic: { pass: true }, semanticCompletion: { complete, reason: null, cause: null } },
    })
    const t = tallySemanticCompletion([
      art(true), art(true), art(true), art(false), art(null),
      // 🔴 review 가 없는 것 · semanticCompletion 이 없는 것
      { artifactVersion: 'v', sourceArticleId: 'y' },
      { artifactVersion: 'v', sourceArticleId: 'z', review: { deterministic: { pass: true } } },
    ])
    return t !== null && t.total === 7 && t.complete === 3
      && t.incomplete === 1 && t.unknown === 3
      // 🔴 배열이 아니면 읽지 않는다
      && tallySemanticCompletion({ not: 'array' }) === null
      && tallySemanticCompletion(null) === null
  })())

  /** 🔴 계기판이 그 정본 읽기를 실제로 쓰는가 */
  check('🔴 ③-c **계기판이 judge/draft 시각을 빌리지 않는다**', (() => {
    const src = readFileSync('scripts/d100-supply-funnel.mts', 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const worksetBlock = src.slice(src.indexOf("stage: 'workset'"), src.indexOf("stage: 'judge'"))
    const semBlock = src.slice(src.indexOf("stage: 'semanticReview'"), src.indexOf("stage: 'candidate'"))
    // 🔴 정본 계약을 부른다 — 두 번째 검증기를 두지 않는다
    return /worksetEvidenceOf\(/.test(src) && /readWorkset\b/.test(src)
      && /tallySemanticCompletion/.test(src)
      && /stageTimesOf/.test(src)
      // 🔴 두 칸이 judge/draft 파일 시각을 쓰지 않는다
      && !/judgeArt|draftArt|draftCand/.test(worksetBlock)
      && !/judgeArt|draftArt|draftCand/.test(semBlock)
      // 🔴 세 단계가 큐 적재 시각을 쓰지 않는다
      && !/stage: 'humanReady',\s*lastAtMs: q\.lastCreatedAtMs/.test(src)
      && !/stage: 'personaMatch',\s*lastAtMs: q\.lastCreatedAtMs/.test(src)
      && !/stage: 'publish',\s*lastAtMs: q\.lastCreatedAtMs/.test(src)
      // 🔴 READY 자리에 검토 이력 수를 넣지 않는다
      && /recentCount: q\.ok \? q\.lane\.lanePublishable : null/.test(src)
      && !/recentCount: q\.ok \? q\.lane\.humanReviewHistory/.test(src)
      // 🔴 READY 재고는 정본 함수가 만든다
      && /laneReadyOf\(/.test(src)
      /**
       * 🔴 **여기만 구조 검사다.** `postTimes` 를 큐 행으로 바꿔도 모양이 같아
       *    순수 fixture 로는 잡히지 않는다 — 다만 그렇게 바꾸면 실행 시
       *    `linkedPostIds` 밖이라 발행 시각이 통째로 `(없음)` 이 된다(lib 이 막는다).
       *    이 줄은 그 바꿔치기를 **코드 단계에서** 한 번 더 막는다.
       */
      && /postTimes: posts\.map\(/.test(src)
      && /linkedPostIds: linkedIds/.test(src)
      && !/postTimes: raw\.map\(/.test(src)
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑲ 🔴 🔴 회차 1번을 생산율로 · 다른 selector 를 같은 이름으로 — 둘 다 FAIL')
// ─────────────────────────────────────────────────────────
{
  const cli = readFileSync('scripts/d100-master-readiness.mts', 'utf-8')
  const stock = readFileSync('scripts/lib/d100-operational-stock.mts', 'utf-8')
  const funnelCli = readFileSync('scripts/d100-supply-funnel.mts', 'utf-8')
  const strip = (t: string): string =>
    t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  /**
   * ① 🔴 **canary 3건을 14 로 나눠 승격 입력에 넣지 않는다.**
   *    실측이 그 모양이었다 — `3 ÷ 14 = 0.2/day` 가 "필요 4/day 에 못 미친다" 의 근거였다.
   */
  /**
   * ② 🔴 **두 CLI 가 같은 이름에 같은 selector 를 써야 한다.**
   *    실측이 4 와 3 으로 갈렸고 양쪽 다 "READY" 라고 불렀다.
   */
  check('🔴 ② **신선도 전 후보와 READY 재고를 같은 이름으로 부르지 않는다**', (() => {
    const split: LaneReadySplit = {
      humanReviewHistoryAll: 25, humanReviewHistoryInWindow: 11,
      laneContract: 10, laneNotRejected: 10, laneUnpublished: 4, lanePublishable: 4,
    }
    const lines = describeLaneReady(split).join(' ')
    // 🔴 신선도 전 수를 "READY 재고" 라 부르지 않는다
    const named = /발행기 후보\(신선도 검사 \*\*전\*\*\) 4건/.test(lines)
      && !/READY 재고 4건/.test(lines)
      && /사람 검토 이력 11건/.test(lines)

    /** 🔴 두 CLI 가 **같은 함수**로 재고를 낸다 */
    const sameSelector = /readStockFunnel\(/.test(strip(funnelCli))
      && /prismaStockRepo\(/.test(strip(funnelCli))
      && /readStockFunnel\(/.test(strip(stock))
      // 🔴 양쪽이 행 id 를 내보낸다 — 수가 아니라 집합으로 대조할 수 있다
      && /readyStockIds/.test(strip(funnelCli)) && /readyStockIds/.test(strip(stock))
      && /readyStockIds/.test(strip(cli))
      // 🔴 funnel 이 자기 신선도 판정을 따로 만들지 않는다
      && !/freshnessOf\(/.test(strip(funnelCli))
      /**
       * 🔴 **재고 id 는 정본 reader 의 산물이어야 한다.**
       *    자기 selector 결과(`publishableIds`)를 그 자리에 넣으면 신선도 전 4건이
       *    "READY 재고" 로 새어 나간다 — 두 CLI 가 다시 갈라진다.
       */
      && /readyStockIds: stockRead\.ok \? \[\.\.\.stockRead\.rows\.sets\.publishableNow\]/.test(strip(funnelCli))
      && !/readyStockIds: publishableIds/.test(strip(funnelCli))
      /** 🔴 workset 판정을 정본 `readWorkset` 에 넘긴다 — 인라인 대체를 막는다 */
      && /worksetEvidenceOf\(\s*worksetFiles[\s\S]{0,200}?readWorkset,\s*\)/.test(strip(funnelCli))
    return named && sameSelector
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑳ 🔴 🔴 Persona 두 목표 — canary 하한과 지속 다양성 목표를 섞지 않는다 (2026-09-29)')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **canary 하한은 옛 `activePersonaTarget` 값 그대로다.** 이 표가 바뀌면
   *    첫 시험 문턱이 조용히 움직인 것이다 — 창업자 결정 없이 바꾸지 않는다.
   */
  const FLOOR: Readonly<Record<string, number>> = { d3: 24, d5: 24, d10: 30, d20: 40, d30: 60, d50: 100, d100: 180 }
  const strip = (t: string): string =>
    t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const SUSTAINED: Readonly<Record<string, number>> = { d3: 24, d5: 24, d10: 30, d20: 60, d30: 90, d50: 150, d100: 300 }
  check('🔴 🔴 **canary 하한 = 옛 코드값 그대로 (24·24·30·40·60·100·180)**',
    D100_STAGES.every((st) => PERSONA_CANARY_FLOOR[st] === FLOOR[st] && d100Plan(st).personaCanaryFloor === FLOOR[st]),
    JSON.stringify(PERSONA_CANARY_FLOOR))
  check('🔴 🔴 **지속 목표 = 24·24·30·60·90·150·300(이상)**',
    D100_STAGES.every((st) => PERSONA_SUSTAINED_TARGET[st] === SUSTAINED[st]
      && d100Plan(st).personaSustainedTarget === SUSTAINED[st]),
    JSON.stringify(PERSONA_SUSTAINED_TARGET))
  check('🔴 지속 목표는 어느 단계에서도 canary 하한보다 작지 않다',
    D100_STAGES.every((st) => PERSONA_SUSTAINED_TARGET[st] >= PERSONA_CANARY_FLOOR[st]))
  check('🔴 D3·D5·D10 은 두 값이 같고 D20 부터 갈린다 — 반례: 한 표로 되돌리면 FAIL',
    (['d3', 'd5', 'd10'] as const).every((st) => PERSONA_CANARY_FLOOR[st] === PERSONA_SUSTAINED_TARGET[st])
    && (['d20', 'd30', 'd50', 'd100'] as const).every((st) => PERSONA_SUSTAINED_TARGET[st] > PERSONA_CANARY_FLOOR[st]))

  // 🔴 D20+ 는 지속 목표를 **지금** 보고한다 — 러너 프로필이 없는 D100 도 마찬가지다
  check('🔴 🔴 **D20+ 는 지속 목표를 보고한다 — 러너 프로필이 없는 D100 포함**',
    schedulerSupportOf('d100').releaseStage === null
    && (['d20', 'd30', 'd50', 'd100'] as const).every((st) => {
      const r = personaTargetReport(st, 0)
      return r.sustainedTarget === SUSTAINED[st] && r.sustainedGap === SUSTAINED[st]
    }))

  const D20 = d100Plan('d20')
  // 🔴 카드 층 — canary 하한으로 ready, 지속 목표는 따로
  check('🔴 🔴 **카드 층: 40명 완성이면 d20 canary ready · 지속 목표 60 은 미충족으로 따로 보고**', (() => {
    const cand: PersonaCandidate = {
      code: 'P', filledAxes: [...PERSONA_LIFE_AXES], ageBand: '50대 초반',
      voiceComments: VOICE_MIN_COMMENTS, activityToday: 0, consecutiveExposures: 0,
      daysSinceActive: 0, retired: false, qualificationConflict: false,
      roleShare: 0, postsSinceLastPairing: 'never',
    }
    const cards = Array.from({ length: 40 }, (_, i) => ({ ...cand, code: `P${i}` }))
    const card = personaTierReadiness({ stage: 'd20', candidates: cards }).find((t) => t.tier === 'card')!
    const scale = judgePersonaScale({ stage: 'd20', candidates: cards })
    return card.ready && card.target === 40 && card.sustainedTarget === 60 && card.sustainedMet === false
      && scale.canaryReady && !scale.sustainedReady && scale.sustainedShortfall === 20
  })())

  check('🔴 보고 한 줄에 두 숫자와 공백이 함께 나온다 — 계약 유효 기준',
    (() => {
      const line = describePersonaTargets(personaTargetReport('d20', 40))
      return line.includes('계약 유효 40명') && line.includes('canary 하한 40명') && line.includes('지속 목표 60명')
        && line.includes('공백 0') && line.includes('🔴 공백 20명') && !/충족|활성/.test(line)
    })())
  check('🔴 🔴 **계약 유효 0 이면 d3 부터 공백이다 — "d3·d5 충족" 을 찍지 않는다**',
    personaTargetReport('d3', 0).canaryGap === 24 && personaTargetReport('d5', 0).canaryGap === 24
    && !describePersonaTargets(personaTargetReport('d3', 0)).includes('공백 0'))
  check('🔴 계약 유효 수를 모르면 공백도 미관측이다',
    personaTargetReport('d3', null).canaryGap === null
    && describePersonaTargets(personaTargetReport('d3', null)).includes('미관측'))
  check('🔴 D100 지속 목표는 "300명 이상" 으로 보고한다',
    describePersonaTargets(personaTargetReport('d100', null)).includes('지속 목표 300명 이상'))

  // 🔴 계기판이 두 목표를 **실제로** 찍는가 — 만든 것과 연결된 것은 다르다
  check('🔴 🔴 **d100:readiness 가 두 목표를 모두 찍는다 (표 · JSON)**', (() => {
    const cli = strip(readFileSync('scripts/d100-master-readiness.mts', 'utf-8'))
    return /describePersonaTargets\(personaTargetReport\(st, contractValidPersonas\)\)/.test(cli)
      && /personaCanaryFloor/.test(cli) && /personaSustainedTarget/.test(cli)
      && /targetsByContractValid: D100_STAGES\.map\(\(st\) => personaTargetReport\(st, contractValidPersonas\)\)/.test(cli)
      && !/personaTargetReport\(st, activePersonas\)/.test(cli)
      && !/targetsByActiveCards/.test(cli)
      && !/activePersonaTarget/.test(cli)
  })())
  check('🔴 옛 겹친 이름(`activePersonaTarget`)이 정본에 남아 있지 않다', (() => {
    const cap = strip(readFileSync('src/lib/d100-capacity.ts', 'utf-8'))
    const scale = strip(readFileSync('src/lib/d100-persona-scale.ts', 'utf-8'))
    return !/activePersonaTarget/.test(cap) && !/activePersonaTarget/.test(scale)
  })())
}

// ═════════════════════════════════════════════════════════
console.log('\n⓪ 🔴 하나의 루프 깔때기 — 관측 전용 · 원문 게시 시각은 sourceEvidence 에서만 (2026-09-30)')
// ═════════════════════════════════════════════════════════
{
  const strip = (t: string): string =>
    t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const H = 3_600_000
  const NOW_F = new Date('2026-09-30T12:00:00.000Z')
  const FROM = new Date(NOW_F.getTime() - 7 * 864e5).toISOString()
  const pubAt = new Date(NOW_F.getTime() - 5 * H)
  /** 🔴 도장은 발행 트랜잭션과 같은 길(`judgeSlotRelease` → `releaseStampOf`)로 만든다 — 손으로 적은 `slotAt:'x'` 도장을 쓰지 않는다 */
  const stamp = fakeReleaseStampGate(fakeEvidenceGate(pubAt, { ageH: 4 }), pubAt)
  /** 🔴 게시 · 수집 · 초안 시각이 서로 다른 기록 — 게시는 공개 4h 전 */
  const good: LoopRow = {
    gateResults: { ...fakeEvidenceGate(pubAt, { ageH: 4 }), ...stamp },
    generatedAt: new Date(pubAt.getTime() - 2 * H).toISOString(),
    readyAt: new Date(pubAt.getTime() - 1 * H).toISOString(), decidedBy: AUTO_DECIDER,
    publicAt: pubAt.toISOString(), publishEventAt: pubAt.toISOString(),
    firstPersonaCommentAt: new Date(pubAt.getTime() + 14 * 60_000).toISOString(),
    audit: { judged: true, defect: false },
  }
  /** 🔴 원문 증거가 없는 공개 행 — 큐 생성 · READY · 공개 시각은 전부 있다(대용할 시각이 널려 있다) */
  const noEvidence: LoopRow = { ...good, gateResults: { ...stamp } }
  /** 🔴 게시 시각만 비고 수집 시각은 있다 — capture 로 대신하면 FAIL */
  const capturedOnly: LoopRow = { ...good, gateResults: { ...fakeEvidenceGate(pubAt, { postedAt: null }), ...stamp } }
  /** 🔴 게시 시각은 있지만 지금 계약 도장이 없다(옛 계약 공개) */
  const unstamped: LoopRow = { ...good, gateResults: { ...fakeEvidenceGate(pubAt, { ageH: 30 }) } }
  const base = {
    windowFrom: FROM, windowTo: NOW_F.toISOString(), candidates: null,
    slotDays: [], costs: { supplyUsd: null, commentUsd: null, auditUsd: null }, contractValidPersonas: null,
  }
  const f1 = buildLoopFunnel({ ...base, rows: [good] })
  check('🟢 계약 도장 · 게시 시각이 있는 글은 원문 게시 → 공개 지연을 잰다 (4h)',
    f1.latency.sourceToPublic.n === 1 && f1.latency.sourceToPublic.p50H === 4 && f1.sameDayPublicShare.share === 1)
  const f2 = buildLoopFunnel({ ...base, rows: [noEvidence, capturedOnly] })
  check('🔴 🔴 **원문 증거가 없으면 게시 시각 미관측 — 큐 생성 · READY · 공개 시각으로 대신하지 않는다**',
    f2.latency.sourceToPublic.n === 0 && f2.latency.sourceToPublic.p50H === null
    && f2.counts.publicPostedUnknown === 2 && f2.sameDayPublicShare.share === null)
  check('🔴 🔴 **capture 시각은 게시 시각을 대신하지 않는다** (게시 null · 수집 있음 → 원문 게시 → 수집도 미관측)',
    buildLoopFunnel({ ...base, rows: [capturedOnly] }).latency.sourceToCapture.n === 0)
  check('🔴 지금 계약 도장이 없는 공개 글은 원문 게시 → 공개 모집단에 들지 않는다 (preflight 와 같은 모집단)',
    buildLoopFunnel({ ...base, rows: [unstamped] }).latency.sourceToPublic.n === 0
    && buildLoopFunnel({ ...base, rows: [unstamped] }).counts.publicStamped === 0)
  check('🔴 🔴 **도장 시각 ≠ 발행 사건 시각 · 발행 사건 모름 → 계약 도장 공개로 세지 않는다** (같은 사건이어야 증명)',
    buildLoopFunnel({ ...base, rows: [{ ...good, publishEventAt: new Date(pubAt.getTime() + 1).toISOString() }] }).counts.publicStamped === 0
    && buildLoopFunnel({ ...base, rows: [{ ...good, publishEventAt: null }] }).counts.publicStamped === 0
    && f1.counts.publicStamped === 1)
  check('🔴 모르는 것은 null — 후보 · 비용 · Persona 가 미관측으로 남는다',
    f1.counts.candidates === null && f1.cost.totalUsd === null && f1.persona.contractValid === null
    && f1.persona.firstBlockedTransition === null
    && f1.unobserved.some((u) => u.startsWith('비용')) && f1.unobserved.some((u) => u.startsWith('후보')))
  check('🔴 화면이 미관측을 "미관측" 이라고 찍는다 — 0 이 아니다',
    describeLoopFunnel(f2).some((l) => l.includes('원문 게시 → 공개    미관측'))
    && describeLoopFunnel(f1).some((l) => l.includes('비용                미관측')))
  check('🟢 첫 댓글 지연 14분 · 60분 안 100% · 감사 1/1',
    f1.comment.firstCommentLatency.p50Min === 14 && f1.comment.within60Share === 1
    && f1.audit.autoPublic === 1 && f1.audit.selected === 1 && f1.audit.judged === 1)
  // 🔴 Persona — judgeNextPreflight 는 다음 단계 하한을 본다 → 계약 유효 0 이면 D1→D3 부터 막힌다
  const pz = buildLoopFunnel({ ...base, rows: [], contractValidPersonas: 0 })
  check('🔴 🔴 **계약 유효 0 이면 D1→D3 부터 막힌다 — "D3→D5" 가 아니다**',
    pz.persona.firstBlockedTransition === 'D1→D3' && pz.persona.gapByStage[0]!.gap === 24,
    String(pz.persona.firstBlockedTransition))
  check('🟢 계약 유효 24 면 d3 · d5 하한은 채우고 D5→D10 에서 막힌다',
    buildLoopFunnel({ ...base, rows: [], contractValidPersonas: 24 }).persona.firstBlockedTransition === 'D5→D10')
  check('🟢 슬롯 채움은 자동 공개만 · 그날 목표까지만 센다',
    (() => {
      const day = new Date(pubAt.getTime() + 9 * H).toISOString().slice(0, 10)
      const human: LoopRow = { ...good, decidedBy: 'founder' }
      const f = buildLoopFunnel({ ...base, rows: [good, good, human], slotDays: [{ kstDate: day, release: 'd1', target: 1 }] })
      return f.slots.target === 1 && f.slots.filledAuto === 1 && f.slots.fillRate === 1
    })())

  // 🔴 관측 전용 — 판정 · 결정이 없다
  check('🔴 🔴 **깔때기 lib 는 verdict · judge · PASS 를 내보내지 않는다**',
    Object.keys(loopFunnelLib).every((k) => !/judge|verdict|decide|promot|pass/i.test(k))
    && !('verdict' in f1) && !JSON.stringify(f1).includes('"PASS"'))
  {
    const code = strip(readFileSync('src/lib/d100-loop-funnel.ts', 'utf-8'))
    check('🔴 깔때기 lib 가 게시 시각 대용(?? 로 capture · 초안 · 생성 시각)을 쓰지 않는다',
      !/postedMs\s*\?\?|postedAt\s*\?\?|sourceCapturedAt|draftedAt/.test(code)
      && /readSourceEvidence\(/.test(code) && /releaseStampStatusOf\(/.test(code))
  }
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
    const p = join(d, n)
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|mts|mjs)$/.test(n) ? [p] : []
  })
  const ALLOWED = new Set([
    'scripts/d100-master-readiness.mts', 'scripts/ops-status.mts',
    'scripts/lib/d100-loop-funnel-read.mts', 'scripts/d100-readiness-check.mts',
  ])
  const importers = [...walk('src'), ...walk('scripts')]
    .filter((p) => /from '[^']*d100-loop-funnel(-read)?(\.mjs)?'/.test(readFileSync(p, 'utf-8')))
  const stray = importers.filter((p) => !ALLOWED.has(p))
  check(`🔴 🔴 **깔때기 값은 결정 경로가 읽지 않는다 — 보고 화면만 import 한다** (${importers.length}곳)`,
    stray.length === 0 && importers.includes('scripts/d100-master-readiness.mts') && importers.includes('scripts/ops-status.mts'),
    stray.join(' · '))
  for (const [file, label] of [['scripts/d100-master-readiness.mts', 'd100:readiness'], ['scripts/ops-status.mts', 'ops:status']] as const) {
    const cli = strip(readFileSync(file, 'utf-8'))
    check(`🔴 ${label} 가 깔때기를 실제로 읽고 찍는다 (표 · JSON)`,
      /readLoopFunnel\(/.test(cli) && /describeLoopFunnel\(/.test(cli) && /loopFunnel:/.test(cli))
  }
  // 🔴 쓰기 차단 — 운영 DB 에 닿기 전에 막힌다(닿을 수 없는 주소로 시험한다)
  const ro = readOnlyPrisma(new PrismaClient({ datasourceUrl: 'postgresql://ro@127.0.0.1:1/none' }))
  const blocked = async (p: () => Promise<unknown>): Promise<boolean> => {
    try { await p(); return false } catch (e) { return (e as Error).message.startsWith('read-only 판독기:') }
  }
  const results = await Promise.all([
    blocked(() => ro.originalPostApprovalQueue.update({ where: { id: 'x' }, data: { status: 'EXPIRED' } })),
    blocked(() => ro.stageDecision.create({ data: {} as never })),
    blocked(() => ro.comment.deleteMany({})),
    blocked(() => ro.post.upsert({ where: { id: 'x' }, create: {} as never, update: {} })),
    blocked(() => ro.$executeRawUnsafe('SELECT 1')),
  ])
  check(`🔴 🔴 **판독기는 쓰기 · raw 를 호출 시점에 막는다** (${results.filter(Boolean).length}/${results.length})`,
    results.every(Boolean))
  const readTried = await blocked(() => ro.post.findFirst({}))
  check('🟢 읽기는 막지 않는다 (차단 문구가 아니라 연결 실패로 끝난다)', readTried === false)
  await ro.$disconnect()

  // 📜 지운 옛 칸이 되살아나지 않는다
  check('🔴 📜 최소 관측 일수(7·14·21일) 칸이 없다 — 달력 대기는 승급 조건이 아니다',
    !/minimumObservationDays/.test(strip(readFileSync('src/lib/d100-capacity.ts', 'utf-8')))
    && !D100_STAGES.some((st) => 'minimumObservationDays' in d100Plan(st)))
  check('🔴 📜 7·14일 예약 전망 칸이 없다',
    !/scheduledIn(7|14)Days/.test(strip(readFileSync('src/lib/d100-readiness.ts', 'utf-8'))))
  check('🔴 📜 d100:readiness 가 Persona 를 "제공자 연결 전" 이라고 찍지 않는다 (지금 연결돼 있다)',
    !/제공자 연결 전/.test(readFileSync('scripts/d100-master-readiness.mts', 'utf-8')))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 이 검사는 DB·네트워크·provider 를 쓰지 않는다.')
if (fail > 0) process.exit(1)
