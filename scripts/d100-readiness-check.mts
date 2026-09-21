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
} from '../src/lib/d100-capacity'
import {
  judgeFunnel, linkStateOf, summarizeLinks, linkCriticalCount,
  runnerStateOf, runnerCanRun, runnerIsFault, allCapabilitiesReady, capabilityBlockers,
  showMeasured, readyNetFromThin, UNMEASURED,
  type CapabilityReadiness, type StockFunnel,
} from '../src/lib/d100-readiness'
import {
  judgePersonaScale, personaBlockers, personaUsable, PERSONA_LIFE_AXES,
  VOICE_MIN_COMMENTS, type PersonaCandidate,
} from '../src/lib/d100-persona-scale'
import { northStar, NOT_NORTH_STAR, isNorthStarMetric, NORTH_STAR_MISSING_EVENTS } from '../src/lib/north-star'
import { compareWorkflowSuperset, allStageCronLines, stageGatingPresent } from '../src/lib/scale-workflow-render'
import { verifyPublishedRows } from '../src/lib/original-post-publish-verify'
import { RECOVERY_PLAN, CANARY_CONTRACT, judgeCanary, NEVER, MIN_CLEAN_RUNS_BEFORE_JOB } from '../src/lib/collect-82cook-recovery'

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
    s.visiblePublished === 17 && s.hiddenTakenDown === 1 && s.orphan === 0
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
    linkStateOf({ queueId: 'x', createdPostId: 'p', postStatus: 'DELETED' }) === 'hiddenTakenDown')
  check('🔴 🔴 **경고를 숨긴 것이 아니다 — 숨긴 글은 계속 세어진다**', s.hiddenTakenDown === 1)

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
  const ok = judgePromotion({
    stage: 'd3', readyStock: 42, activePersonas: 24,
    detailPerDay: 12, readyNetPerDay: 3, observedDays: 7,
    publishRunnerReady: true, commentRunnerReady: true,
  })
  check('🔴 전부 채우면 올려도 된다', ok.ready, JSON.stringify(ok))
  check('🔴 runner 가 못 돌면 올리지 않는다',
    !judgePromotion({
      stage: 'd3', readyStock: 42, activePersonas: 24,
      detailPerDay: 12, readyNetPerDay: 3, observedDays: 7,
      publishRunnerReady: false, commentRunnerReady: true,
    }).ready)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 🔴 🔴 Persona 24 → 180~200 — 카드만 채우면 READY 가 아니다')
// ─────────────────────────────────────────────────────────
{
  const FULL: PersonaCandidate = {
    code: 'P01', filledAxes: [...PERSONA_LIFE_AXES], ageBand: '40대 후반',
    voiceComments: VOICE_MIN_COMMENTS, activityToday: 0, consecutiveExposures: 0,
    daysSinceActive: 0, retired: false, qualificationConflict: false,
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
    return !v.ready && v.usable === 0 && v.cardsOnly === 180 && v.shortfall === 180
  })())
  check('🔴 쓸 수 있는 사람이 목표만큼 있으면 READY', (() => {
    const cards = Array.from({ length: 180 }, (_, i) => ({ ...FULL, code: `P${i}` }))
    const v = judgePersonaScale({ stage: 'd100', candidates: cards })
    return v.ready && v.usable === 180 && v.target === 180 && v.targetMax === 200
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 🔴 🔴 North Star — Persona·봇 활동이 들어가면 FAIL')
// ─────────────────────────────────────────────────────────
{
  check('🔴 🔴 **재방문을 셀 이벤트가 아직 없다**',
    NORTH_STAR_MISSING_EVENTS.length === 3
    && northStar({ returningUsers: 10, returningEngagedUsers: 5, measuredWeeks: null }).measured === false)
  check('🔴 측정되면 값을 낸다', (() => {
    const v = northStar({ returningUsers: 10, returningEngagedUsers: 5, measuredWeeks: 1 })
    return v.measured && v.weeklyReturningEngagedUsers === 5
  })())
  check('🔴 참여자가 방문자보다 많으면 숫자를 내지 않는다',
    northStar({ returningUsers: 3, returningEngagedUsers: 9, measuredWeeks: 2 }).measured === false)
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
  check('🔴 🔴 **타입에 Persona 칸이 없다**', (() => {
    const src = readFileSync('src/lib/north-star.ts', 'utf-8')
    const i = src.indexOf('export type NorthStarInput')
    const block = src.slice(i, src.indexOf('\n}', i))
    return !/persona|bot|publish/i.test(block)
  })())
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
  check('🔴 🔴 **read-only 다 — DB write 가 없다**',
    !/prisma|PrismaClient/i.test(cli))
  check('🔴 🔴 **측정되지 않은 값을 0 으로 채우지 않는다**',
    /showMeasured/.test(cli) && /const detailPerDay: Measured = null/.test(cli))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 이 검사는 DB·네트워크·provider 를 쓰지 않는다.')
if (fail > 0) process.exit(1)
