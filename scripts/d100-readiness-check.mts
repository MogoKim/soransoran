#!/usr/bin/env tsx
/**
 * D100 Phase 0 정본 검사 — 🔴 순수 fixture. DB 0 · 네트워크 0 · provider 0
 *
 * 🔴 **숫자를 여기 하드코딩하지 않는다.** 정본 함수를 돌려 나온 값을 본다 —
 *    문서와 코드가 갈라지면 여기서 걸린다.
 */
import { readFileSync } from 'node:fs'

import {
  D100_STAGES, allD100Plans, d100Plan, judgePromotion, nextStage,
  PLANNED_DETAIL_PER_PUBLIC_POST, STOCK_DAYS, D100_PERSONA_TARGET_MAX,
  READY_NET_MARGIN, POSTS_PER_INVOCATION, schedulerSupportOf,
} from '../src/lib/d100-capacity'
import {
  judgeFunnel, judgeFunnelRows, LINK_STATES, linkStateOf, summarizeLinks, linkCriticalCount,
  hiddenPostNote, runnerStateOf, runnerCanRun, runnerIsFault, runnerFactsOf, capabilityFactsReady,
  allCapabilitiesReady, capabilityBlockers,
  showMeasured, readyNetFromThin, UNMEASURED,
  type CapabilityReadiness, type StockFunnel, type QueuePostLink,
} from '../src/lib/d100-readiness'
import {
  judgePersonaScale, personaBlockers, personaUnmeasured, personaUsable, PERSONA_LIFE_AXES,
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
  ladderStepFor, LADDER_MAX_DETAIL_PER_RUN, mayAutoRetry, capacities82, describeCookieAudit,
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
    scheduledIn7Days: 0, scheduledIn14Days: 0, readyStock: 3,
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
    check('🔴 🔴 **사람이 내린 글은 bad 가 아니라 takenDown 이다**',
      v.ok && v.bad.length === 0 && v.takenDown.length === 1,
      JSON.stringify({ bad: v.bad.length, taken: v.takenDown.length }))
  }
  {
    // 🔴 숨김 때문이 아닌 문제가 남으면 여전히 bad 다
    const v = verifyPublishedRows([{ ...ROW, queuePersonaId: 'other' }])
    check('🔴 🔴 **숨겼어도 persona 가 어긋나면 계속 CRITICAL**',
      !v.ok && v.bad.length === 1 && v.takenDown.length === 0
      && v.bad[0]!.problems.every((p) => !p.includes('Post status=')),
      JSON.stringify(v.bad))
  }
  {
    const v = verifyPublishedRows([{ ...ROW, post: null, createdPostId: 'gone' }])
    check('🔴 🔴 **Post 가 없으면 계속 bad 다**', !v.ok && v.bad.length === 1)
  }
  check('🔴 🔴 **health 가 둘을 갈라 넘긴다**', (() => {
    const h = readFileSync('scripts/supply-health.mts', 'utf-8')
    return /mismatched: verdict\.bad\.length/.test(h) && /takenDown: verdict\.takenDown\.length/.test(h)
  })())
  check('🔴 🔴 **숨긴 글은 CRITICAL 이 아니라 INFO 로 보고된다**', (() => {
    const lib = readFileSync('src/lib/supply-health.ts', 'utf-8')
    return /'INFO', 'PUBLISH_TAKEN_DOWN'/.test(lib)
      && /'CRITICAL', 'PUBLISH_MISMATCH'/.test(lib)
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
  check('🔴 정상은 하나뿐이다',
    runnerCanRun(runnerStateOf({ installed: true, loaded: true, enabled: true })))
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
    stage: 'd3', readyStock: 9999, activePersonas: 9999,
    detailPerDay: null, readyNetPerDay: null, observedDays: 999,
    publishRunnerReady: true, commentRunnerReady: true,
  })
  check('🔴 🔴 **측정되지 않으면 올리지 않는다 — 통과로 세지 않는다**',
    !promo.ready && promo.blocking.length === 0 && promo.unmeasured.length === 2,
    JSON.stringify(promo))
  // 🔴 필요량을 여기 다시 적지 않는다 — 정본이 바뀌면 이 fixture 도 따라 움직여야 한다
  const D3 = d100Plan('d3')
  const full: Parameters<typeof judgePromotion>[0] = {
    stage: 'd3', readyStock: D3.readyStock14Days, activePersonas: D3.activePersonaTarget,
    detailPerDay: D3.detailedSourcesRequiredPerDay,
    readyNetPerDay: D3.readyNetRequiredPerDay,
    observedDays: D3.minimumObservationDays,
    publishRunnerReady: true, commentRunnerReady: true,
  }
  const ok = judgePromotion(full)
  check('🔴 전부 채우면 올려도 된다', ok.ready, JSON.stringify(ok))
  /**
   * 🔴 **공개량만큼 만들어서는 올라가지 못한다** (2026-09-21 보정).
   *    앞판은 `readyNetRequiredPerDay = publicPostsPerDay` 였고, 하루 3편 공개에
   *    하루 3편 생산이면 통과였다 — 그러면 재고는 영원히 늘지 않는다.
   */
  check('🔴 🔴 **공개량만큼만 만들면 올리지 않는다 — 재고가 늘지 않는다**',
    !judgePromotion({ ...full, readyNetPerDay: D3.publicPostsPerDay }).ready)
  check('🔴 runner 가 못 돌면 올리지 않는다',
    !judgePromotion({ ...full, publishRunnerReady: false }).ready)
  /**
   * 🔴 **재지 못한 재고를 0 이나 -1 로 바꿔 넣지 않는다.** 그러면 "재고가 부족하다"
   *    라는 **틀린 이유**가 뜬다 — 사실은 읽지 못한 것이다.
   */
  check('🔴 🔴 **재고를 못 재면 blocking 이 아니라 unmeasured 다**', (() => {
    const v = judgePromotion({ ...full, readyStock: null, activePersonas: null })
    return !v.ready && v.unmeasured.includes('재고') && v.unmeasured.includes('활성 Persona')
      && !v.blocking.some((b) => b.includes('재고'))
  })())
  /**
   * 🔴 **다음 단계를 스케줄러가 못 하면 올리지 않는다.** d10 은 전부 채워도
   *    d20 에 cron 이 없어 막힌다 — "재고만 쌓으면 된다" 가 아니다.
   */
  check('🔴 🔴 **다음 단계에 cron 이 없으면 올리지 않는다 (d10 → d20)**', (() => {
    const D10 = d100Plan('d10')
    const v = judgePromotion({
      stage: 'd10', readyStock: D10.readyStock14Days, activePersonas: D10.activePersonaTarget,
      detailPerDay: D10.detailedSourcesRequiredPerDay,
      readyNetPerDay: D10.readyNetRequiredPerDay,
      observedDays: D10.minimumObservationDays,
      publishRunnerReady: true, commentRunnerReady: true,
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
  check('🔴 🔴 **카드만 180장이고 계약을 못 채우면 READY 가 아니다**', (() => {
    const cards = Array.from({ length: 180 }, (_, i) => ({
      ...FULL, code: `P${i}`, voiceComments: 0,
    }))
    const v = judgePersonaScale({ stage: 'd100', candidates: cards })
    return !v.ready && v.poolReady === 0 && v.cardsOnly === 180 && v.shortfall === 180
      // 🔴 카드 자체는 완성돼 있다 — 그래서 "카드만 있다" 가 보인다
      && v.cardComplete === 180
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

  // ⑧ READY 순증가 목표 = ceil(공개 × 1.2)
  check('🔴 ⑧ **READY 순증가 목표는 공개량의 1.2배다 — D100 은 120/day**',
    Number(READY_NET_MARGIN) === 1.2
    && allD100Plans().every((p) => p.readyNetRequiredPerDay === Math.ceil(p.publicPostsPerDay * 1.2))
    && d100Plan('d100').readyNetRequiredPerDay === 120
    && d100Plan('d3').readyNetRequiredPerDay === 4)

  // ⑨ 세 값은 서로 다르다
  check('🔴 ⑨ **공개량·READY 순증가·재고는 서로 다른 값이다**', (() => {
    const p = d100Plan('d100')
    return p.publicPostsPerDay === 100 && p.readyNetRequiredPerDay === 120
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
  check('🔴 ⑬ **Persona 카드·풀·배정이 각각 다른 수를 낸다**', (() => {
    const base: PersonaCandidate = {
      code: 'P', filledAxes: [...PERSONA_LIFE_AXES], ageBand: '50대 초반',
      voiceComments: VOICE_MIN_COMMENTS, activityToday: 0, consecutiveExposures: 0,
      daysSinceActive: 0, retired: false, qualificationConflict: false,
      topicShare: 0, roleShare: 0, postsSinceLastPairing: 'never',
    }
    const v = judgePersonaScale({
      stage: 'd3',
      candidates: [
        base,                                             // 전부 통과
        { ...base, voiceComments: 0 },                    // 카드만
        { ...base, activityToday: 99 },                   // 풀에는 들지만 오늘은 못 쓴다
        { ...base, ageBand: null },                       // 카드부터 미완성
      ],
    })
    return v.cards === 4 && v.cardComplete === 3 && v.poolReady === 2 && v.assignableNow === 1
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
    const ladder = ladderStepFor({ cleanRuns: 0, sawAbortSignal: false }).maxDetailPerRun === 5
      && ladderStepFor({ cleanRuns: 3, sawAbortSignal: false }).maxDetailPerRun === 10
      && ladderStepFor({ cleanRuns: 6, sawAbortSignal: false }).maxDetailPerRun === 20
      && ladderStepFor({ cleanRuns: 99, sawAbortSignal: false }).maxDetailPerRun === LADDER_MAX_DETAIL_PER_RUN
      // 🔴 중단 신호를 봤으면 되돌아간다
      && ladderStepFor({ cleanRuns: 99, sawAbortSignal: true }).maxDetailPerRun === 5
    const retry = !mayAutoRetry('http403') && !mayAutoRetry('http429')
      && !mayAutoRetry('captcha') && mayAutoRetry('repeatedNetwork')
    const four = capacities82({
      requiredDetailPerDayAllSources: 382,
      ladder: ladderStepFor({ cleanRuns: 0, sawAbortSignal: false }),
      listPagesPerRun: 1, runsPerDay: 4,
      observedDetailPerDay: null, observedDetailPerRun: null,
    })
    // 🔴 네 값이 섞이지 않는다 — 관측은 0 이 아니라 null 이다
    const split = four.observed.detailPerDay === null && four.required.detailPerDay === 382
      && four.canary.detailPerDay !== four.required.detailPerDay
    // 🔴 쿠키는 값을 내지 않는다
    const cookie = describeCookieAudit({ present: true, count: 3, ageDays: 2 })
    return budget && ladder && retry && split
      && /3개/.test(cookie) && !/=/.test(cookie)
  })())
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 이 검사는 DB·네트워크·provider 를 쓰지 않는다.')
if (fail > 0) process.exit(1)
