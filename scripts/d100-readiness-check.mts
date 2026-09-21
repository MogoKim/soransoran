#!/usr/bin/env tsx
/**
 * D100 Phase 0 정본 검사 — 🔴 순수 fixture. DB 0 · 네트워크 0 · provider 0
 *
 * 🔴 **숫자를 여기 하드코딩하지 않는다.** 정본 함수를 돌려 나온 값을 본다 —
 *    문서와 코드가 갈라지면 여기서 걸린다.
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  D100_STAGES, allD100Plans, d100Plan, judgePromotion, nextStage,
  PLANNED_DETAIL_PER_PUBLIC_POST, STOCK_DAYS, D100_PERSONA_TARGET_MAX,
  READY_NET_MARGIN, POSTS_PER_INVOCATION, schedulerSupportOf,
  targetStageFor, currentPlanOf, dailyTargetOf, stableObservationDaysOf, PROMOTION_PHASES,
} from '../src/lib/d100-capacity'
import { resolveStage } from '../src/lib/scale-profile'
import { readyNetFromSnapshots, READY_SELECTOR_VERSION } from './lib/d100-ready-snapshot.mjs'
import { detailThroughput, DETAIL_SOURCES } from './lib/d100-detail-throughput.mjs'
import {
  forecastFromRows, releaseStageFromEnvText, stableStreakDays, latestRunFailing,
  runReadiness, SnapshotWriteFailed, readFailureOf, perDayMeasured,
} from './lib/d100-operational-stock.mjs'
import { appendSnapshot } from './lib/d100-ready-snapshot.mjs'
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
import { compareWorkflowSuperset, allStageCronLines, stageGatingPresent } from '../src/lib/scale-workflow-render'
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
    // 단계: [공개/day, 상세/day, 재고14일, Persona]
    d3: [3, 12, 42, 24], d5: [5, 20, 70, 24], d10: [10, 39, 140, 30],
    d20: [20, 77, 280, 40], d30: [30, 115, 420, 60],
    d50: [50, 191, 700, 100], d100: [100, 382, 1400, 180],
  }
  for (const p of allD100Plans()) {
    const w = want[p.stage]!
    check(`🔴 🔴 **${p.stage} — 공개 ${w[0]} · 상세 ${w[1]} · 재고 ${w[2]} · Persona ${w[3]}**`,
      p.publicPostsPerDay === w[0] && p.detailedSourcesRequiredPerDay === w[1]
      && p.readyStock14Days === w[2] && p.activePersonaTarget === w[3],
      `${p.publicPostsPerDay}/${p.detailedSourcesRequiredPerDay}/${p.readyStock14Days}/${p.activePersonaTarget}`)
  }
  const d100 = d100Plan('d100')
  check('🔴 🔴 **D100 재고 1,400 · 댓글 100~500 · Persona 180~200**',
    d100.readyStock14Days === 1400 && d100.commentMinPerDay === 100
    && d100.commentMaxPerDay === 500 && d100.activePersonaTarget === 180
    && D100_PERSONA_TARGET_MAX === 200)
  check('🔴 재고는 14일치다', STOCK_DAYS === 14
    && d100.readyStock14Days === d100.publicPostsPerDay * STOCK_DAYS)
  check('🔴 상세 필요량은 계획 전환율에서 계산된다',
    d100.detailedSourcesRequiredPerDay
      === Math.ceil(d100.publicPostsPerDay * PLANNED_DETAIL_PER_PUBLIC_POST))
  check('🔴 다음 단계가 이어진다',
    nextStage('d3') === 'd5' && nextStage('d50') === 'd100' && nextStage('d100') === null)
  check('🔴 🔴 **숫자를 문서에 복사하지 않았다**', (() => {
    const doc = readFileSync('docs/operations/2026-09-21-d100-goal-canon.md', 'utf-8')
    return !/1,?400/.test(doc) && !/382/.test(doc)
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
    // 🔴 예측하지 않았으면 0 이 아니라 null 이다
    scheduledIn7Days: null, scheduledIn14Days: null, readyStock: 3,
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
console.log('\n④ 🔴 🔴 workflow stage — superset 은 정상, gating 없는 cron 은 FAIL')
// ─────────────────────────────────────────────────────────
{
  const yml = readFileSync('.github/workflows/auto-publish.yml', 'utf-8')
  check('🔴 🔴 **실제 yml 은 모든 단계의 합집합이다 — 불일치 0**',
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
  check('🔴 🔴 **health 가 합집합 기준을 쓴다** — 활성 단계로 견주지 않는다', (() => {
    const h = readFileSync('scripts/supply-health.mts', 'utf-8')
    return /compareWorkflowSuperset\(/.test(h)
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
  const promo = judgePromotion({
    current: 'd1', next: 'd3', readyStock: 9999, activePersonas: 9999,
    detailPerDay: null, readyQualifiedPerDay: null, readyStockDeltaPerDay: null,
    publishedPerDay: null, currentStableStreakDays: null,
    publishRunnerReady: true, commentRunnerReady: true, currentLimitsActive: false,
  })
  check('🔴 🔴 **측정되지 않으면 올리지 않는다 — 통과로 세지 않는다**',
    !promo.ready && promo.unmeasured.length > 0
    && promo.unmeasured.includes('상세 수집/day')
    && promo.unmeasured.includes('READY 생산량/day'),
    JSON.stringify(promo.unmeasured))
  // 🔴 필요량을 여기 다시 적지 않는다 — 정본이 바뀌면 이 fixture 도 따라 움직여야 한다
  const D3 = d100Plan('d3')
  /**
   * 🔴 지금 운영은 d1 이고 올라가려는 칸은 d3 이다.
   *    d1 의 자기 목표는 **1/day** 다 — d3 의 3/day 를 사전 조건으로 요구하지 않는다.
   */
  const full: Parameters<typeof judgePromotion>[0] = {
    current: 'd1', next: 'd3',
    readyStock: D3.readyStock14Days, activePersonas: D3.activePersonaTarget,
    detailPerDay: D3.detailedSourcesRequiredPerDay,
    readyQualifiedPerDay: D3.readyQualifiedRequiredPerDay,
    readyStockDeltaPerDay: 1,
    publishedPerDay: dailyTargetOf('d1'),
    currentStableStreakDays: stableObservationDaysOf('d1'),
    publishRunnerReady: true, commentRunnerReady: true, currentLimitsActive: false,
  }
  const ok = judgePromotion(full)
  check('🔴 🔴 **d1→d3 preflight 는 d1 실적(1/day)만으로 통과한다**',
    ok.nextPreflight.ready, JSON.stringify(ok.nextPreflight))
  check('🔴 🔴 **d1 제한이 확정되지 않았으면 canary 부터 막힌다**',
    !ok.ready && !ok.currentCanary.ready && ok.phase === 'canary'
    && ok.currentCanary.blocking.some((b) => b.includes('제한')))
  check('🔴 🔴 **지금 단계가 자리를 잡고 다음 준비가 끝나야 올릴 수 있다**', (() => {
    const v = judgePromotion({
      ...full, currentLimitsActive: true,
      // 🔴 d1 의 자기 목표는 1/day 다 — d3 의 3/day 가 아니다
      publishedPerDay: dailyTargetOf('d1'),
      currentStableStreakDays: stableObservationDaysOf('d1'),
    })
    return v.ready && v.phase === 'preflight'
      && v.currentCanary.ready && v.currentStable.ready && v.nextPreflight.ready
  })())
  /**
   * 🔴 **공개량만큼 만들어서는 올라가지 못한다** (2026-09-21 보정).
   *    앞판은 `readyNetRequiredPerDay = publicPostsPerDay` 였고, 하루 3편 공개에
   *    하루 3편 생산이면 통과였다 — 그러면 재고는 영원히 늘지 않는다.
   */
  check('🔴 🔴 **공개량만큼만 만들면 올리지 않는다 — 재고가 늘지 않는다**',
    !judgePromotion({ ...full, readyQualifiedPerDay: D3.publicPostsPerDay }).nextPreflight.ready)
  check('🔴 runner 가 못 돌면 올리지 않는다',
    !judgePromotion({ ...full, publishRunnerReady: false }).nextPreflight.ready)
  /**
   * 🔴 **재지 못한 재고를 0 이나 -1 로 바꿔 넣지 않는다.** 그러면 "재고가 부족하다"
   *    라는 **틀린 이유**가 뜬다 — 사실은 읽지 못한 것이다.
   */
  check('🔴 🔴 **재고를 못 재면 blocking 이 아니라 unmeasured 다**', (() => {
    const v = judgePromotion({ ...full, readyStock: null, activePersonas: null })
    return !v.ready && v.unmeasured.includes('재고') && v.unmeasured.includes('활성 Persona')
      && !v.blocking.some((b) => b.includes('재고 '))
  })())
  /**
   * 🔴 **다음 단계를 스케줄러가 못 하면 올리지 않는다.** d10 은 전부 채워도
   *    d20 에 cron 이 없어 막힌다 — "재고만 쌓으면 된다" 가 아니다.
   */
  check('🔴 🔴 **목표 단계에 cron 이 없으면 올리지 않는다 (d10 → d20)**', (() => {
    const D20 = d100Plan('d20')
    const v = judgePromotion({
      current: 'd10', next: 'd20',
      readyStock: D20.readyStock14Days, activePersonas: D20.activePersonaTarget,
      detailPerDay: D20.detailedSourcesRequiredPerDay,
      readyQualifiedPerDay: D20.readyQualifiedRequiredPerDay,
      readyStockDeltaPerDay: 1,
      publishedPerDay: dailyTargetOf('d10'),
      currentStableStreakDays: stableObservationDaysOf('d10'),
      publishRunnerReady: true, commentRunnerReady: true, currentLimitsActive: false,
    })
    return !v.ready && v.blocking.some((b) => b.includes('d20'))
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 🔴 🔴 Persona 24 → 180~200 — 카드만 채우면 READY 가 아니다')
// ─────────────────────────────────────────────────────────
{
  const FULL: PersonaCandidate = {
    code: 'P01', filledAxes: [...PERSONA_LIFE_AXES], ageBand: '40대 후반',
    voiceComments: VOICE_MIN_COMMENTS, activityToday: 0, consecutiveExposures: 0,
    daysSinceActive: 0, retired: false, qualificationConflict: false,
    topicShare: 0, roleShare: 0, postsSinceLastPairing: 'never',
  }
  check('🔴 생활사 축은 생성 계약과 같은 14축이다', PERSONA_LIFE_AXES.length === 14)
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
    return !v.ready && v.poolReady === 0 && v.cardsOnly === 180 && v.shortfall === 180
      && v.cardComplete === 0 && v.cards === 180
  })())
  check('🔴 쓸 수 있는 사람이 목표만큼 있으면 READY', (() => {
    const cards = Array.from({ length: 180 }, (_, i) => ({ ...FULL, code: `P${i}` }))
    const v = judgePersonaScale({ stage: 'd100', candidates: cards })
    return v.ready && v.poolReady === 180 && v.target === 180 && v.targetMax === 200
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
    matchedPersonaId: 'per-1', gateResults: {},
    title: `제목 ${id}`, body: `본문 ${id} 입니다`,
    draftTitle: `제목 ${id}`, editedTitle: null,
    decidedBy: 'founder', decidedAt: NOW, createdAt: NOW,
    sourceCapturedAt: NOW, freshTitle: `제목 ${id}`, freshBody: `본문 ${id} 입니다`,
    ...over,
  })
  const machineRow = (id: string, over: Partial<QueueRowFacts> = {}): QueueRowFacts => humanRow(id, {
    promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
    sourceSite: `${MACHINE_SITE_PREFIX}82cook`,
    gateResults: {
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

  // ⑧ READY **생산** 목표 = ceil(공개 × 1.2)
  check('🔴 ⑧ **READY 생산 목표는 공개량의 1.2배다 — D3 은 4/day · D100 은 120/day**',
    Number(READY_NET_MARGIN) === 1.2
    && allD100Plans().every((p) => p.readyQualifiedRequiredPerDay === Math.ceil(p.publicPostsPerDay * 1.2))
    && d100Plan('d100').readyQualifiedRequiredPerDay === 120
    && d100Plan('d3').readyQualifiedRequiredPerDay === 4)

  // ⑨ 세 값은 서로 다르다
  check('🔴 ⑨ **공개량·READY 생산·재고는 서로 다른 값이다**', (() => {
    const p = d100Plan('d100')
    return p.publicPostsPerDay === 100 && p.readyQualifiedRequiredPerDay === 120
      && p.readyStock14Days === 1400
  })())

  // ⑩ D20 이상은 스케줄러가 없다
  check('🔴 ⑩ **D20 이상은 schedulerUnsupported 다 — 설정으로 올릴 수 없다**', (() => {
    const un = (['d20', 'd30', 'd50', 'd100'] as const).every((st) => {
      const sc = schedulerSupportOf(st)
      return !sc.supported && sc.reason === 'schedulerUnsupported'
        && sc.scheduledSlotsPerDay === null && sc.releaseStage === null
    })
    return un
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
      topicShare: 0, roleShare: 0, postsSinceLastPairing: 'never',
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
      topicShare: 0, roleShare: 0, postsSinceLastPairing: 'never',
    }
    return personaBlockers({ ...base, topicShare: 0.9 }).includes('topicConcentrated')
      && personaBlockers({ ...base, roleShare: 0.9 }).includes('roleConcentrated')
      && personaBlockers({ ...base, postsSinceLastPairing: 1 }).includes('pairRepeat')
      // 🔴 재지 않은 것은 **통과가 아니라 unmeasured** 다
      && personaUnmeasured({ ...base, topicShare: null }).includes('topicConcentrated')
      && !personaUsable({ ...base, topicShare: null })
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
  check('🔴 ① **지금 단계는 env 가 정한다 — 코드에 박지 않는다**', (() => {
    const code = strip(cli)
    const fromEnv = /releaseStageFromEnvText\(envText\)/.test(code)
      && /currentReleaseStage = resolved\.stage/.test(code)
      && /nextStage[^=]*= targetStageFor\(currentReleaseStage\)/.test(code)
    /**
     * 🔴 **단계 이름 문자열을 어디에도 배정하지 않는다.** `resolveStage` 를 부르면서
     *    결과만 `'d3'` 으로 덮어써도 통과하던 것이 앞판의 구멍이었다.
     */
    const noHardcode = !/(currentReleaseStage|nextStage)[^=\n]*=\s*'d\d+'/.test(code)
      && !/const\s+stage\s*:\s*D100Stage\s*=\s*'/.test(code)
    // 🔴 실제로 env 글에서 읽어 오는가 — 값이 바뀌면 답도 바뀐다
    const readsEnv = releaseStageFromEnvText('SORAN_RELEASE_STAGE=d1\n').stage === 'd1'
      && releaseStageFromEnvText('SORAN_RELEASE_STAGE=d5\n').stage === 'd5'
      && releaseStageFromEnvText('SORAN_RELEASE_STAGE=d5\n').fromEnv
      && releaseStageFromEnvText('').stage === 'd1'
      && releaseStageFromEnvText('').fromEnv === false
    // 🔴 정본 판정: 빈 env → 가장 안전한 d1
    const resolves = resolveStage(undefined).stage === 'd1'
      && resolveStage('d3').stage === 'd3' && resolveStage('허튼값').stage === 'd1'
    const maps = targetStageFor('d1') === 'd3' && targetStageFor('d3') === 'd5'
      && targetStageFor('d5') === 'd10' && targetStageFor('d10') === 'd20'
    // 🔴 d1 은 D100 용량표에 없다 — 없는 칸을 d3 으로 올려 읽지 않는다
    return fromEnv && noHardcode && readsEnv && resolves && maps && currentPlanOf('d1') === null
  })())

  // ② D3 수치로 D5 승격하면 FAIL
  check('🔴 ② **목표 단계의 필요량으로 잰다 — 현재 단계 수치로 올라가지 않는다**', (() => {
    const D3 = d100Plan('d3'); const D5 = d100Plan('d5')
    // 🔴 d3 수치를 그대로 들고 d5 로 올라가려 하면 막혀야 한다
    const regress = judgePromotion({
      current: 'd3', next: 'd5',
      readyStock: D3.readyStock14Days, activePersonas: D3.activePersonaTarget,
      detailPerDay: D3.detailedSourcesRequiredPerDay,
      readyQualifiedPerDay: D3.readyQualifiedRequiredPerDay,
      readyStockDeltaPerDay: 1,
      publishedPerDay: D3.publicPostsPerDay,
      currentStableStreakDays: stableObservationDaysOf('d3'),
      publishRunnerReady: true, commentRunnerReady: true, currentLimitsActive: true,
    })
    const blocked = !regress.ready
      && regress.nextPreflight.blocking.some((b) => b.includes(`${D5.readyStock14Days}`))
      && regress.nextPreflight.blocking.some((b) => b.includes(`${D5.readyQualifiedRequiredPerDay}/day`))
      && regress.nextPreflight.blocking.some((b) => b.includes(`${D5.detailedSourcesRequiredPerDay}/day`))
      /**
       * 🔴 **d5 발행량은 어느 칸에서도 사전 조건이 아니다.**
       *    d3 을 돌리는 동안 물을 것은 d3 의 3/day 이지 d5 의 5/day 가 아니다.
       */
      && !regress.blocking.some((b) => b.includes(`${D5.publicPostsPerDay}/day`))
    // 🔴 d5 수치를 채우면 통과한다
    /**
     * 🔴 **d3→d5 는 d3 이 실제로 3/day 를 7일 낸 뒤에만 열린다.**
     *    d3 실적이 없으면 preflight 부터 막힌다 — 재고만 쌓아서는 올라가지 않는다.
     */
    const noD3Record = judgePromotion({
      current: 'd3', next: 'd5',
      readyStock: D5.readyStock14Days, activePersonas: D5.activePersonaTarget,
      detailPerDay: D5.detailedSourcesRequiredPerDay,
      readyQualifiedPerDay: D5.readyQualifiedRequiredPerDay, readyStockDeltaPerDay: 1,
      publishedPerDay: D3.publicPostsPerDay,
      // 🔴 3/day 를 냈지만 아직 6일뿐이다
      currentStableStreakDays: stableObservationDaysOf('d3') - 1,
      publishRunnerReady: true, commentRunnerReady: true, currentLimitsActive: true,
    })
    const ok = judgePromotion({
      current: 'd3', next: 'd5',
      readyStock: D5.readyStock14Days, activePersonas: D5.activePersonaTarget,
      detailPerDay: D5.detailedSourcesRequiredPerDay,
      readyQualifiedPerDay: D5.readyQualifiedRequiredPerDay, readyStockDeltaPerDay: 1,
      publishedPerDay: D5.publicPostsPerDay,
      currentStableStreakDays: D5.minimumObservationDays,
      publishRunnerReady: true, commentRunnerReady: true, currentLimitsActive: true,
    })
    // 🔴 d1→d3 은 D3 의 42 · 4/day · 12/day · 24명을 본다 — **3편/day 는 묻지 않는다**
    const d1 = judgePromotion({
      current: 'd1', next: 'd3',
      readyStock: 41, activePersonas: 24, detailPerDay: 12,
      readyQualifiedPerDay: 4, readyStockDeltaPerDay: 1,
      publishedPerDay: dailyTargetOf('d1'),
      currentStableStreakDays: stableObservationDaysOf('d1'),
      publishRunnerReady: true, commentRunnerReady: true, currentLimitsActive: false,
    })
    return blocked && ok.ready && ok.next === 'd5'
      /**
       * 🔴 **d3 이 7일을 못 채웠으면 전환이 막힌다** — 다만 막히는 곳은
       *    `nextPreflight` 가 아니라 **지금 단계의 stable** 이다. 다음 단계 준비는
       *    그와 별개로 진행될 수 있어야 한다.
       */
      && !noD3Record.ready && !noD3Record.currentStable.ready
      && noD3Record.currentStable.blocking.some((b) => b.includes('연속 달성'))
      && noD3Record.nextPreflight.ready
      && !d1.nextPreflight.ready && d1.nextPreflight.blocking.some((b) => b.includes('42'))
  })())

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
  check('🔴 ⑤ **예약 전망은 예측기가 낸다 — 0 을 주입하지 않는다**', (() => {
    const noZero = !/(scheduledIn7Days|forecastIfLoadedIn7Days)\s*:\s*0/.test(strip(stock))
      && !/(scheduledIn14Days|forecastIfLoadedIn14Days)\s*:\s*0/.test(strip(stock))
      && /forecastPublishing/.test(strip(stock))
    // 🔴 사람이 없으면 0 건이 아니라 **계산할 수 없다**
    const noPersona = forecastFromRows({
      rows: [], publishableIds: [], personas: [], codeOfPersonaId: new Map(),
      history: [], dailyCap: 1, now: new Date('2026-09-21T00:00:00.000Z'),
    })
    // 🔴 타입이 `Measured` 라 0 과 null 을 구분한다
    const typed = /scheduledIn7Days: Measured/.test(readFileSync('src/lib/d100-readiness.ts', 'utf-8'))
    return noZero && noPersona.in7 === null && noPersona.in14 === null && typed
  })())

  // ⑥ Persona 3계층 중 하나를 계기판에서 제거하면 FAIL
  check('🔴 ⑥ **3계층이 계기판에 연결돼 있다 — 순수 함수만 있으면 없는 것이다**', (() => {
    const wired = /personaTierReadiness/.test(strip(stock)) && /personaReadinessOk/.test(strip(stock))
      && /personaTiers/.test(strip(cli)) && /personaReady/.test(strip(cli))
      // 🔴 active 수만으로 승격 입력을 채우지 않는다
      && /activePersonas: personaReady \? activePersonas : null/.test(strip(cli))
    const FULL: PersonaCandidate = {
      code: 'P', filledAxes: [...PERSONA_LIFE_AXES], ageBand: '50대 초반',
      voiceComments: VOICE_MIN_COMMENTS, activityToday: 0, consecutiveExposures: 0,
      daysSinceActive: 0, retired: false, qualificationConflict: false,
      topicShare: 0, roleShare: 0, postsSinceLastPairing: 'never',
    }
    const many = Array.from({ length: 24 }, (_, i) => ({ ...FULL, code: `P${i}` }))
    const all = personaTierReadiness({ stage: 'd3', candidates: many })
    const ready = personaReadinessOk(all) && all.length === 3
    // 🔴 한 층이라도 아니면 전체가 아니다
    const cardBroken = personaTierReadiness({
      stage: 'd3', candidates: many.map((p) => ({ ...p, ageBand: null })),
    })
    // 🔴 재지 않은 축이 있으면 그 층은 ready 가 아니다 — topic/role 은 **Pool** 층이다
    const unmeasured = personaTierReadiness({
      stage: 'd3', candidates: many.map((p) => ({ ...p, topicShare: null })),
    })
    return wired && ready
      && !personaReadinessOk(cardBroken) && cardBroken[0]!.ready === false
      && !personaReadinessOk(unmeasured)
      && unmeasured[1]!.tier === 'pool' && unmeasured[1]!.unmeasured.topicConcentrated === 24
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
  check('🔴 ① **READY 생산 4 · 발행 3 · 재고 +1 은 처리량 조건을 통과한다**', (() => {
    const v = judgePromotion({
      current: 'd3', next: 'd3',
      readyStock: D3.readyStock14Days, activePersonas: D3.activePersonaTarget,
      detailPerDay: D3.detailedSourcesRequiredPerDay,
      // 🔴 생산 4 · 재고 증감 +1
      readyQualifiedPerDay: 4, readyStockDeltaPerDay: 1,
      publishedPerDay: 3, currentStableStreakDays: stableObservationDaysOf('d3'),
      publishRunnerReady: true, commentRunnerReady: true, currentLimitsActive: true,
    })
    const throughputOk = !v.nextPreflight.blocking.some((b) => b.includes('READY 생산'))
      && !v.nextPreflight.blocking.some((b) => b.includes('고갈'))
      && v.nextPreflight.ready
    // 🔴 반대로 생산이 3 이면 막힌다 — 여유율은 생산량에 붙는다
    const tooLittle = judgePromotion({
      current: 'd3', next: 'd3',
      readyStock: D3.readyStock14Days, activePersonas: D3.activePersonaTarget,
      detailPerDay: D3.detailedSourcesRequiredPerDay,
      readyQualifiedPerDay: 3, readyStockDeltaPerDay: 1,
      publishedPerDay: 3, currentStableStreakDays: stableObservationDaysOf('d3'),
      publishRunnerReady: true, commentRunnerReady: true, currentLimitsActive: true,
    })
    // 🔴 재고를 채운 뒤 줄고 있으면 고갈 위험으로 따로 막는다
    const depleting = judgePromotion({
      current: 'd3', next: 'd3',
      readyStock: D3.readyStock14Days, activePersonas: D3.activePersonaTarget,
      detailPerDay: D3.detailedSourcesRequiredPerDay,
      readyQualifiedPerDay: 4, readyStockDeltaPerDay: -2,
      publishedPerDay: 3, currentStableStreakDays: stableObservationDaysOf('d3'),
      publishRunnerReady: true, commentRunnerReady: true, currentLimitsActive: true,
    })
    // 🔴 재고를 채우기 전이라면 음수여도 고갈로 막지 않는다 (아직 쌓는 중이다)
    const stillFilling = judgePromotion({
      current: 'd3', next: 'd3',
      readyStock: 3, activePersonas: D3.activePersonaTarget,
      detailPerDay: D3.detailedSourcesRequiredPerDay,
      readyQualifiedPerDay: 4, readyStockDeltaPerDay: -2,
      publishedPerDay: 3, currentStableStreakDays: stableObservationDaysOf('d3'),
      publishRunnerReady: true, commentRunnerReady: true, currentLimitsActive: true,
    })
    return throughputOk
      && tooLittle.nextPreflight.blocking.some((b) => b.includes('READY 생산 3/day'))
      && depleting.nextPreflight.blocking.some((b) => b.includes('고갈'))
      && !stillFilling.nextPreflight.blocking.some((b) => b.includes('고갈'))
  })())

  /**
   * ② 🔴 **D1 에서 이미 3/day 를 요구하면 통과할 수 없다.**
   *    올라가야 낼 수 있는 양을 올라가기 전에 요구하는 것이기 때문이다.
   */
  check('🔴 ② **d1→d3 preflight 는 3/day 를 요구하지 않는다**', (() => {
    const v = judgePromotion({
      current: 'd1', next: 'd3',
      readyStock: D3.readyStock14Days, activePersonas: D3.activePersonaTarget,
      detailPerDay: D3.detailedSourcesRequiredPerDay,
      readyQualifiedPerDay: D3.readyQualifiedRequiredPerDay, readyStockDeltaPerDay: 1,
      // 🔴 d1 은 하루 1편이 자기 목표다
      publishedPerDay: 1, currentStableStreakDays: stableObservationDaysOf('d1'),
      publishRunnerReady: true, commentRunnerReady: true, currentLimitsActive: false,
    })
    const phases = (PROMOTION_PHASES as readonly string[]).join(',') === 'preflight,canary,stable'
    return phases && v.nextPreflight.ready && v.phase === 'canary'
      && !v.nextPreflight.blocking.some((b) => b.includes('3/day'))
      // 🔴 그래도 제한을 켜기 전에는 끝난 것이 아니다
      && !v.ready && v.currentStable.blocking.length > 0
      && dailyTargetOf('d1') === 1 && dailyTargetOf('d3') === 3
  })())

  /**
   * ③ 🔴 **빈 이력을 넘기면 주 상한·간격이 한 번도 적용되지 않는다.**
   */
  check('🔴 ③ **forecast 에 실제 PersonaActivityLog 이력을 넘긴다**', (() => {
    const wired = /kind: 'post'/.test(strip(stock))
      && /personaActivityLog\.findMany/.test(strip(stock))
      // 🔴 빈 배열을 만들어 넘기는 배선이 없어야 한다
      && !/matchedAts: \[\]/.test(strip(stock))
      && /history: input\.history/.test(strip(stock))
    // 🔴 사람 수와 이력 수가 어긋나면 계산하지 않는다 (빈 배열 주입 방어)
    const mismatch = forecastFromRows({
      rows: [], publishableIds: [],
      personas: [{ code: 'P01' } as never], codeOfPersonaId: new Map(),
      history: [], dailyCap: 1, now: new Date('2026-09-21T00:00:00.000Z'),
    })
    // 🔴 예약량과 예측값이 서로 다른 필드다
    const split = /actualScheduledIn7Days/.test(strip(stock))
      && /forecastIfLoadedIn7Days/.test(strip(stock))
      && /publishRunnerLoaded \? fc\.in7 : 0/.test(strip(stock))
      && /actualIn7Days/.test(strip(cli)) && /forecastIfLoadedIn7Days/.test(strip(cli))
    return wired && mismatch.in7 === null && split
  })())

  /**
   * ④ 🔴 **층 배치와 미측정 처리.**
   */
  check('🔴 ④ **Persona 층이 정본대로이고 모르는 축은 통과가 아니다**', (() => {
    const tiers = (PERSONA_BLOCK_TIER as Record<string, string>)
    const canon = tiers.lifeAxisMissing === 'card' && tiers.noAgeBand === 'card'
      && tiers.voiceEvidenceThin === 'card' && tiers.retired === 'card'
      && tiers.dormant === 'card' && tiers.qualificationConflict === 'card'
      && tiers.topicConcentrated === 'pool' && tiers.roleConcentrated === 'pool'
      && tiers.activityOverCap === 'assignment' && tiers.consecutiveExposure === 'assignment'
      && tiers.pairRepeat === 'assignment'
    const FULL: PersonaCandidate = {
      code: 'P', filledAxes: [...PERSONA_LIFE_AXES], ageBand: '50대 초반',
      voiceComments: VOICE_MIN_COMMENTS, activityToday: 0, consecutiveExposures: 0,
      daysSinceActive: 0, retired: false, qualificationConflict: false,
      topicShare: 0, roleShare: 0, postsSinceLastPairing: 'never',
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
  check('🔴 ⑤-c **observedDays 상수 대신 실제 연속 달성 일수를 쓴다**', (() => {
    const noConst = !/observedDays/.test(strip(cli)) && !/observedDays/.test(strip(stock))
      && /stableStreakDays/.test(strip(stock)) && /currentStableStreakDays/.test(strip(cli))
    const NOW = new Date('2026-09-21T00:00:00.000Z')
    const day = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000)
    // 🔴 어제·그제 각 1건 → 연속 2일. 오늘은 아직 끝나지 않아 세지 않는다
    const s2 = stableStreakDays({ publishedAts: [day(1), day(2)], dailyTarget: 1, now: NOW })
    // 🔴 목표가 2 면 하루 1건으로는 끊긴다
    const s0 = stableStreakDays({ publishedAts: [day(1), day(2)], dailyTarget: 2, now: NOW })
    return noConst && s2 === 2 && s0 === 0
  })())
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
  const assemble = (envText: string, over: Partial<Parameters<typeof judgePromotion>[0]> = {}) => {
    // 🔴 CLI 와 같은 순서로 만든다: env → 지금 단계 → 다음 단계 → 판정
    const resolved = releaseStageFromEnvText(envText)
    const current = resolved.stage
    const next = targetStageFor(current)
    return judgePromotion({
      current, next,
      readyStock: d100Plan(next).readyStock14Days,
      activePersonas: d100Plan(next).activePersonaTarget,
      detailPerDay: d100Plan(next).detailedSourcesRequiredPerDay,
      readyQualifiedPerDay: d100Plan(next).readyQualifiedRequiredPerDay,
      readyStockDeltaPerDay: 1,
      publishedPerDay: dailyTargetOf(current),
      currentStableStreakDays: stableObservationDaysOf(current),
      publishRunnerReady: true, commentRunnerReady: true,
      currentLimitsActive: resolved.fromEnv,
      ...over,
    })
  }

  check('🔴 ① **d1 운영 중 — canary/stable 은 d1 의 것, preflight 는 d3 의 것**', (() => {
    const v = assemble('SORAN_RELEASE_STAGE=d1\n')
    return v.current === 'd1' && v.next === 'd3'
      // 🔴 canary 가 통과할 수 있다 — 앞판에서는 불가능했다
      && v.currentCanary.ready
      // 🔴 d1 은 1/day 로 stable 이 된다. d3 의 3/day 를 미리 요구하지 않는다
      && v.currentStable.ready
      && !v.blocking.some((b) => b.includes(`${D3.publicPostsPerDay}/day`))
      && v.nextPreflight.ready && v.ready
  })())

  check('🔴 ①-b **운영이 d3 으로 바뀌면 d3 canary·stable 을 판정하고 d5 를 따로 준비한다**', (() => {
    const v = assemble('SORAN_RELEASE_STAGE=d3\n')
    // 🔴 이제 물어야 할 실적은 d3 의 3/day 다
    const askD3 = v.current === 'd3' && v.next === 'd5' && v.currentCanary.ready
    const notYet = assemble('SORAN_RELEASE_STAGE=d3\n', {
      publishedPerDay: 1, currentStableStreakDays: 99,
    })
    // 🔴 d5 준비는 d3 실적과 **따로** 판정된다
    return askD3 && v.currentStable.ready
      && !notYet.currentStable.ready
      && notYet.currentStable.blocking.some((b) => b.includes(`${D3.publicPostsPerDay}/day`))
      && notYet.nextPreflight.ready && !notYet.ready
      && d100Plan(v.next).publicPostsPerDay === D5.publicPostsPerDay
  })())

  check('🔴 ①-c **env 가 확정되지 않으면 canary 부터 막힌다**', (() => {
    // 🔴 안전 단계로 떨어진 것은 "그 단계를 운영하기로 했다" 가 아니다
    const v = assemble('')
    return !v.currentCanary.ready && v.phase === 'canary'
      && v.currentCanary.blocking.some((b) => b.includes('확정'))
  })())

  check('🔴 ①-d **CLI 가 그 조립을 그대로 쓴다**', (() => {
    const code = strip(cli)
    return /currentLimitsActive: resolved\.fromEnv/.test(code)
      // 🔴 `현재 === 다음` 비교가 돌아오면 잡힌다
      && !/currentLimitsActive:[^\n]*===/.test(code)
      && /next: nextStage/.test(code)
      && /promo\.currentCanary/.test(code) && /promo\.currentStable/.test(code)
      && /promo\.nextPreflight/.test(code)
  })())

  /**
   * ③ 🔴 **정상 조회 0 건은 측정된 0/day 다.**
   */
  check('🔴 ③ **0/day 는 unmeasured 가 아니고, 승격을 통과시키지 않는다**', (() => {
    // 🔴 READY 생산 0 — blocking 이지 unmeasured 가 아니다
    const zeroProduce = assemble('SORAN_RELEASE_STAGE=d1\n', { readyQualifiedPerDay: 0 })
    const produceBlocked = !zeroProduce.nextPreflight.ready
      && zeroProduce.nextPreflight.blocking.some((b) => b.includes('READY 생산 0/day'))
      && !zeroProduce.nextPreflight.unmeasured.includes('READY 생산량/day')
    // 🔴 공개 발행 0 — 같은 원칙
    const zeroPublish = assemble('SORAN_RELEASE_STAGE=d1\n', { publishedPerDay: 0 })
    const publishBlocked = !zeroPublish.currentStable.ready
      && zeroPublish.currentStable.blocking.some((b) => b.includes('0/day'))
      && !zeroPublish.currentStable.unmeasured.includes('공개 발행/day')
    // 🔴 반면 `null` 은 unmeasured 로 남는다 — 둘이 구분된다
    const nullProduce = assemble('SORAN_RELEASE_STAGE=d1\n', { readyQualifiedPerDay: null })
    const nullStaysUnmeasured = nullProduce.nextPreflight.unmeasured.includes('READY 생산량/day')
      && !nullProduce.nextPreflight.blocking.some((b) => b.includes('READY 생산'))
    // 🔴 상세 수집도 같다 — 회차가 있었는데 0 건이면 0/day 다
    const NOW = new Date('2026-09-21T00:00:00.000Z')
    const rec: CollectRunRecord = {
      runId: 'r', source: 'navercafe:wgang', trigger: 'schedule', mode: 'detail',
      status: 'failed', startedAt: '2026-09-20T00:00:00.000Z', endedAt: null, code: 'NETWORK',
      listRows: 0, detailRequests: 0, bodyRows: 0, thinRows: 0,
      skippedSeen: 0, repeatedRows: 0, newUniqueThinRows: 0,
    }
    const ran = detailThroughput({
      windowDays: 10, now: NOW,
      recordsOf: (src) => src === 'navercafe:wgang' ? [rec] : [],
    })
    const detailZero = ran.bySource[0]!.perDay === 0
      && !ran.unmeasuredSources.includes('navercafe:wgang')
      // 🔴 기록이 아예 없는 공급원은 여전히 unmeasured 다
      && ran.unmeasuredSources.includes('82cook')
    /**
     * 🔴 **나눗셈 자체가 0 을 0 으로 낸다.** 위 판정들은 숫자를 직접 넣어 보므로
     *    `perDayMeasured` 를 지나지 않는다 — 실제로 값을 만드는 곳도 확인한다.
     */
    const divides = perDayMeasured(0, 14) === 0
      && perDayMeasured(3, 14) === 0.2
      // 🔴 창 길이가 없을 때만 `null` 이다
      && perDayMeasured(0, 0) === null
    return produceBlocked && publishBlocked && nullStaysUnmeasured && detailZero && divides
  })())
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 이 검사는 DB·네트워크·provider 를 쓰지 않는다.')
if (fail > 0) process.exit(1)
