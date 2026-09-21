#!/usr/bin/env tsx
/**
 * 하루짜리 첫 시험 **행동 검사** — 🔴 DB 0 · 네트워크 0 · 파일 write 0
 *
 * 🔴 **무엇을 잠그는가.**
 *
 *    `judgeReadiness` 의 네 조건은 전부 **14일 지속성**이라, "내일 하루 3편을
 *    안전하게 낼 수 있는가" 를 묻는 자리가 없었다. 재고가 4건이면 d3 은 물론
 *    **d1 조차 미달**로 판정되고 `resolveScale` 이 실제로 단계를 낮춘다.
 *
 *    그래서 하루짜리 판정을 따로 뒀다. 이 검사가 잠그는 것은 **그것이 우회가
 *    되지 않는다**는 사실이다 —
 *      · 날짜가 지나면 저절로 꺼진다
 *      · 허가만으로는 안 켜진다. 그날치 판정이 GO 여야 한다
 *      · capacity 상한은 시험이라도 비켜 가지 않는다
 *      · 하루 상한·슬롯은 그 단계의 정본 그대로다
 *      · 🔴 `chosenReady` 는 false 로 남는다 — 준비됐다고 말하지 않는다
 */
import {
  canaryAuthorization, judgeOneDayCanary, kstDateString, slotsLeftToday,
  CANARY_STAGE_ENV, CANARY_DATE_ENV,
} from '../src/lib/release-canary'
import { resolveScale } from '../src/lib/scale-runtime'
import { simulateStage } from '../src/lib/scale-readiness'
import type { QueueCandidate } from '../src/lib/supply-candidates'
import type { PersonaForMatch } from '../src/lib/original-post-persona-match'
import { PROFILES, RELEASE_STAGES, type StageVerdict } from '../src/lib/scale-profile'
import type { SimOutcome } from '../src/lib/scale-readiness'

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

console.log('\n══ 하루짜리 첫 시험 검사 (🔴 DB 0 · 네트워크 0) ══\n')

const NOW = new Date('2026-09-22T00:30:00.000Z') // 2026-09-22 09:30 KST
const TODAY = kstDateString(NOW)

/** 🔴 하루치 시뮬레이션 결과 — 지평 1일이 계약이다 */
const simOf = (over: Partial<SimOutcome> = {}): SimOutcome => ({
  stage: 'd3', in14: 3, want14: 3, gaps: 0, recoveryBroken: 0,
  personas: 24, stock: 4,
  horizonStartAt: NOW, nextSlotAt: NOW, horizonDays: 1,
  ...over,
})

/** 🔴 **어느 단계도 준비되지 않았다** — 지금 운영 상태 그대로다(재고 4/42) */
const NOTHING_READY: StageVerdict[] = RELEASE_STAGES.map((stage) => ({
  stage, ready: false, reasons: ['재고 4/42건'],
}))

const envOf = (o: Record<string, string>) => o as NodeJS.ProcessEnv

/** 🔴 하루 시작 — 아직 아무것도 내지 않았고 슬롯 셋이 다 남았다 */
const DAY_START = { publishedToday: 0, slotsLeft: 3 }

// ─────────────────────────────────────────────────────────
console.log('① 🔴 🔴 허가는 둘 다 · 날짜 하루만')
// ─────────────────────────────────────────────────────────
{
  check('🔴 아무것도 없으면 허가가 아니다',
    canaryAuthorization(envOf({}), NOW, RELEASE_STAGES).activeToday === false)

  const half = canaryAuthorization(envOf({ [CANARY_STAGE_ENV]: 'd3' }), NOW, RELEASE_STAGES)
  check('🔴 🔴 **단계만 있고 날짜가 없으면 켜지지 않는다**',
    half.activeToday === false && (half.note ?? '').includes('반쪽'))

  const noStage = canaryAuthorization(envOf({ [CANARY_DATE_ENV]: TODAY }), NOW, RELEASE_STAGES)
  check('🔴 날짜만 있고 단계가 없으면 켜지지 않는다', noStage.activeToday === false)

  const today = canaryAuthorization(
    envOf({ [CANARY_STAGE_ENV]: 'd3', [CANARY_DATE_ENV]: TODAY }), NOW, RELEASE_STAGES)
  check('🔴 오늘 날짜면 켜진다', today.activeToday === true && today.stage === 'd3')

  const past = canaryAuthorization(
    envOf({ [CANARY_STAGE_ENV]: 'd3', [CANARY_DATE_ENV]: '2026-09-21' }), NOW, RELEASE_STAGES)
  check('🔴 🔴 **어제 날짜면 저절로 꺼진다 — 사람이 끄지 않아도 된다**',
    past.activeToday === false)

  const future = canaryAuthorization(
    envOf({ [CANARY_STAGE_ENV]: 'd3', [CANARY_DATE_ENV]: '2026-09-23' }), NOW, RELEASE_STAGES)
  check('🔴 내일 날짜면 오늘은 아니다', future.activeToday === false)

  check('🔴 모르는 단계는 받지 않는다',
    canaryAuthorization(
      envOf({ [CANARY_STAGE_ENV]: 'd99', [CANARY_DATE_ENV]: TODAY }), NOW, RELEASE_STAGES,
    ).activeToday === false)

  /** 🔴 KST 경계 — UTC 날짜와 다른 시각을 고른다 */
  check('🔴 🔴 **날짜는 KST 로 센다 (UTC 아님)**',
    kstDateString(new Date('2026-09-21T15:30:00.000Z')) === '2026-09-22'
    && kstDateString(new Date('2026-09-21T14:30:00.000Z')) === '2026-09-21')
}

// ─────────────────────────────────────────────────────────
console.log('\n② 🔴 🔴 하루 판정은 하루만 묻는다')
// ─────────────────────────────────────────────────────────
{
  check('🔴 그날 슬롯을 채우면 GO', judgeOneDayCanary(simOf(), DAY_START).ok === true)

  const short = judgeOneDayCanary(simOf({ in14: 2 }), DAY_START)
  check('🔴 🔴 **한 건이라도 모자라면 NO-GO**',
    short.ok === false && short.can === 2 && short.want === 3)

  check('🔴 기배정 복구가 깨져 있으면 NO-GO',
    judgeOneDayCanary(simOf({ recoveryBroken: 1 }), DAY_START).ok === false)

  /**
   * 🔴 **14일 조건은 묻지 않는다.** 재고 4건은 d3 의 14일 목표 42 에 한참 못 미치는데,
   *    그날 3편을 낼 수 있으면 하루 시험은 GO 다 — 그것이 이 판정의 전부다.
   */
  check('🔴 🔴 **14일치 재고가 없어도 하루 판정은 GO 다**',
    judgeOneDayCanary(simOf({ stock: 4 }), DAY_START).ok === true
    && PROFILES.d3.dailyTarget * 14 === 42)

  /** 🔴 14일치 시뮬레이션을 하루 판정으로 쓰지 못한다 */
  const wrongWindow = judgeOneDayCanary(simOf({ horizonDays: 14, in14: 42 }), DAY_START)
  check('🔴 🔴 **지평이 하루가 아니면 판정을 거부한다**',
    wrongWindow.ok === false && wrongWindow.reasons.some((r) => r.includes('하루치')))
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 🔴 🔴 실제 `resolveScale` 로 — 우회가 되지 않는다')
// ─────────────────────────────────────────────────────────
{
  const base = { [ 'SORAN_CAPACITY_STAGE' ]: 'd3' }

  /** 🔴 시험 허가가 없으면 지금과 똑같다 — d1 로 감속된다 */
  const noCanary = resolveScale(
    envOf({ ...base, SORAN_RELEASE_STAGE: 'd3' }), { readiness: NOTHING_READY })
  check('🔴 🔴 **허가가 없으면 d3 설정은 그대로 감속된다 (지금 동작 그대로)**',
    noCanary.releaseStage === 'd1' && noCanary.throttledByReadiness
    && noCanary.canaryStage === false,
    `stage=${noCanary.releaseStage}`)

  /** 🔴 허가 + GO → 그날만 d3 */
  const go = resolveScale(
    envOf({ ...base, [CANARY_STAGE_ENV]: 'd3', [CANARY_DATE_ENV]: TODAY }),
    { readiness: NOTHING_READY, canary: { now: NOW, verdict: judgeOneDayCanary(simOf(), DAY_START) } })
  check('🔴 🔴 **허가 + 그날 GO → 하루만 d3**',
    go.releaseStage === 'd3' && go.canaryStage === true && go.canaryDate === TODAY,
    `stage=${go.releaseStage} canary=${go.canaryStage}`)

  check('🔴 🔴 **하루 상한과 슬롯은 정본 그대로다 — 3편 · 3슬롯**',
    go.releaseProfile.dailyTarget === 3 && go.releaseProfile.slots.length === 3
    && go.releaseProfile.slots.map((s) => `${s.hour}:${s.minute}`).join(' ') === '9:30 13:30 19:0')

  /**
   * 🔴 **준비됐다고 말하지 않는다.** 시험으로 단계가 올라가도 `chosenReady` 는 false 다 —
   *    화면과 보고가 "d3 준비 완료" 로 읽으면 안 된다.
   */
  check('🔴 🔴 **시험이어도 `chosenReady` 는 false — 지속 승격이 아니다**',
    go.chosenReady === false && go.readinessApplied === false
    && go.notes.some((n) => n.includes('지속 운영 승격이 아니다')))

  /** 🔴 허가는 있는데 그날치가 NO-GO → 켜지지 않는다 */
  const noGo = resolveScale(
    envOf({ ...base, [CANARY_STAGE_ENV]: 'd3', [CANARY_DATE_ENV]: TODAY }),
    { readiness: NOTHING_READY, canary: { now: NOW, verdict: judgeOneDayCanary(simOf({ in14: 2 }), DAY_START) } })
  check('🔴 🔴 **허가가 있어도 그날치가 NO-GO 면 올라가지 않는다**',
    noGo.releaseStage === 'd1' && noGo.canaryStage === false,
    `stage=${noGo.releaseStage}`)

  /** 🔴 판정을 못 받았으면 fail-closed */
  const noVerdict = resolveScale(
    envOf({ ...base, [CANARY_STAGE_ENV]: 'd3', [CANARY_DATE_ENV]: TODAY }),
    { readiness: NOTHING_READY, canary: { now: NOW, verdict: null } })
  check('🔴 🔴 **판정을 받지 못하면 켜지지 않는다(fail-closed)**',
    noVerdict.releaseStage === 'd1' && noVerdict.canaryStage === false)

  /** 🔴 날짜가 지나면 저절로 d1 */
  const expired = resolveScale(
    envOf({ ...base, [CANARY_STAGE_ENV]: 'd3', [CANARY_DATE_ENV]: '2026-09-21' }),
    { readiness: NOTHING_READY, canary: { now: NOW, verdict: judgeOneDayCanary(simOf(), DAY_START) } })
  check('🔴 🔴 **날짜가 지나면 아무도 끄지 않아도 d1 로 돌아온다**',
    expired.releaseStage === 'd1' && expired.canaryStage === false,
    `stage=${expired.releaseStage}`)

  /** 🔴 capacity 상한은 시험이라도 비켜 가지 않는다 */
  const overCap = resolveScale(
    envOf({ SORAN_CAPACITY_STAGE: 'd1', [CANARY_STAGE_ENV]: 'd3', [CANARY_DATE_ENV]: TODAY }),
    { readiness: NOTHING_READY, canary: { now: NOW, verdict: judgeOneDayCanary(simOf(), DAY_START) } })
  check('🔴 🔴 **capacity 를 넘는 시험은 열리지 않는다**',
    overCap.releaseStage === 'd1' && overCap.canaryStage === false
    && overCap.notes.some((n) => n.includes('시험이라도 열지 않는다')),
    `stage=${overCap.releaseStage}`)

  /** 🔴 시험이 단계를 **내리는** 데 쓰이지 않는다 */
  const lower = resolveScale(
    envOf({ SORAN_CAPACITY_STAGE: 'd5', SORAN_RELEASE_STAGE: 'd5',
      [CANARY_STAGE_ENV]: 'd1', [CANARY_DATE_ENV]: TODAY }),
    { readiness: RELEASE_STAGES.map((stage) => ({ stage, ready: true, reasons: [] })),
      canary: { now: NOW, verdict: judgeOneDayCanary(simOf({ stage: 'd1', in14: 1, want14: 1 }), { publishedToday: 0, slotsLeft: 1 }) } })
  check('🔴 준비된 단계를 시험이 끌어내리지 않는다',
    lower.releaseStage === 'd5' && lower.canaryStage === false)
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 🔴 🔴 연속 3회 — 실제 `simulateStage` 로 세 슬롯을 다 통과한다')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **앞판이 막던 자리를 그대로 재현한다** (2026-09-21).
   *
   *    READY 4건으로 하루를 시작한다. 09:30 에 한 건을 내면 3건이 남고,
   *    13:30 에 또 한 건을 내면 2건이 남는다. 앞판은 회차마다 `in14 >= 3` 을
   *    요구했으므로 **19:00 회차가 NO-GO 로 막혔다** — 그날 3편을 낼 수 있는데도.
   *
   * 🔴 시뮬레이션은 **실제 `simulateStage`** 다. 가짜 SimOutcome 을 만들지 않는다 —
   *    `prepareCandidates` · `forecastPublishing` · `planBatch` 가 그대로 돈다.
   */
  const DAY = '2026-09-22'
  /** 🔴 원문 관측 시각 — TTL 안이어야 자동 대상이 된다 */
  const captured = new Date('2026-09-20T00:00:00.000Z')
  const candOf = (n: number): QueueCandidate => ({
    queueId: `q${n}`,
    title: `국수 이야기 ${n}`,
    body: '어제 저녁에 국수를 삶아 먹었어요. 별것 아닌데 오래 생각났습니다.',
    gateVerdict: 'PASS', createdAt: n, assignedPersonaCode: null,
    capturedAt: captured, voice: null, profile: 'human' as const,
  })
  /** 🔴 서로 다른 persona 넷 — 한 사람이 하루에 셋을 쓰지 않는다 */
  const personas = ['A', 'B', 'C', 'D'].map((code) => ({
    code, status: 'active', providerId: null, accountCount: 0,
    maritalStatus: '기혼', childrenCount: 0, childrenAgeBands: [] as string[],
    parentCare: '상시', menopauseStatus: '진행중', workStatus: null, economicStatus: null,
    region: null, noGoTopics: [] as string[], voiceLength: '중간',
    postsThisWeek: 0, daysSinceLastPost: null,
  })) as unknown as PersonaForMatch[]

  /** 한 회차를 그대로 돌린다 — 러너가 하는 것과 같은 순서다 */
  const invoke = (at: Date, pool: readonly QueueCandidate[], publishedToday: number) => {
    const sim = simulateStage({
      stage: 'd3', queue: pool, personas,
      history: personas.map((p) => ({ code: p.code, matchedAts: [] })),
      axis: { now: at, publishedToday },
      days: 1,
    })
    const slotsLeft = slotsLeftToday('d3', at)
    const verdict = judgeOneDayCanary(sim, { publishedToday, slotsLeft })
    const scale = resolveScale(
      envOf({ SORAN_CAPACITY_STAGE: 'd3', [CANARY_STAGE_ENV]: 'd3', [CANARY_DATE_ENV]: DAY }),
      { readiness: NOTHING_READY, canary: { now: at, verdict } })
    return { sim, verdict, scale, slotsLeft }
  }

  let pool = [1, 2, 3, 4].map(candOf)
  check('🔴 하루를 READY 4건으로 시작한다', pool.length === 4)

  // ── 09:30 회차 ──
  const r1 = invoke(new Date('2026-09-22T00:30:00.000Z'), pool, 0)
  check('🔴 🔴 **09:30 — 아직 0/3건. 3건 필요 · GO**',
    r1.verdict.published === 0 && r1.verdict.need === 3 && r1.verdict.ok
    && r1.scale.releaseStage === 'd3' && r1.scale.canaryStage,
    JSON.stringify({ need: r1.verdict.need, can: r1.verdict.can,
      slots: r1.slotsLeft, stage: r1.scale.releaseStage }))

  // 🔴 한 건이 나갔다 — 남은 후보는 3건
  pool = pool.slice(1)
  check('🔴 09:30 발행 후 남은 후보 3건', pool.length === 3)

  // ── 13:30 회차 ──
  const r2 = invoke(new Date('2026-09-22T04:30:00.000Z'), pool, 1)
  check('🔴 🔴 **13:30 — 1/3건 냈다. 2건만 더 필요 · GO**',
    r2.verdict.published === 1 && r2.verdict.need === 2 && r2.verdict.ok
    && r2.scale.releaseStage === 'd3' && r2.scale.canaryStage,
    JSON.stringify({ need: r2.verdict.need, can: r2.verdict.can,
      slots: r2.slotsLeft, stage: r2.scale.releaseStage }))

  // 🔴 또 한 건이 나갔다 — 남은 후보는 2건
  pool = pool.slice(1)
  check('🔴 13:30 발행 후 남은 후보 2건', pool.length === 2)

  // ── 19:00 회차 — 🔴 앞판이 막던 자리다 ──
  const r3 = invoke(new Date('2026-09-22T10:00:00.000Z'), pool, 2)
  check('🔴 🔴 **19:00 — 2/3건 냈다. 1건만 더 필요 · GO (앞판은 여기서 막혔다)**',
    r3.verdict.published === 2 && r3.verdict.need === 1 && r3.verdict.ok
    && r3.scale.releaseStage === 'd3' && r3.scale.canaryStage,
    JSON.stringify({ need: r3.verdict.need, can: r3.verdict.can,
      slots: r3.slotsLeft, stage: r3.scale.releaseStage }))

  /**
   * 🔴 **앞판 규칙이었다면 막혔다**는 것을 값으로 남긴다 —
   *    "고쳤다" 를 말이 아니라 수로 보인다.
   */
  check('🔴 🔴 **하루치 전체(3건)를 다시 요구했다면 19:00 은 NO-GO 였다**',
    r3.sim.in14 < PROFILES.d3.dailyTarget && r3.verdict.ok,
    `그 시점에 낼 수 있는 것 ${r3.sim.in14}건 < 하루 목표 ${PROFILES.d3.dailyTarget}건`)

  // ── 세 번째까지 낸 뒤 ──
  pool = pool.slice(1)
  const r4 = invoke(new Date('2026-09-22T10:30:00.000Z'), pool, 3)
  check('🔴 🔴 **3/3건을 채우면 더 필요하지 않다 — 하루 중간에 d1 로 떨어지지 않는다**',
    r4.verdict.need === 0 && r4.verdict.ok && r4.scale.releaseStage === 'd3',
    JSON.stringify({ need: r4.verdict.need, stage: r4.scale.releaseStage }))

  // ── 🔴 다음 날 ──
  const next = invoke(new Date('2026-09-23T00:30:00.000Z'), pool, 0)
  check('🔴 🔴 **9/23 에는 허가가 만료돼 저절로 d1 로 돌아간다**',
    next.scale.releaseStage === 'd1' && next.scale.canaryStage === false,
    `stage=${next.scale.releaseStage}`)

  // ── 🔴 후보가 모자란 날은 여전히 막는다 ──
  const starved = invoke(new Date('2026-09-22T00:30:00.000Z'), [candOf(9)], 0)
  check('🔴 🔴 **하루를 1건으로 시작하면 3건 필요 — NO-GO 로 막힌다**',
    starved.verdict.need === 3 && starved.verdict.ok === false
    && starved.scale.releaseStage === 'd1' && starved.scale.canaryStage === false,
    JSON.stringify({ need: starved.verdict.need, can: starved.verdict.can,
      stage: starved.scale.releaseStage }))

  /**
   * 🔴 **남은 슬롯 = 남은 편수.** 판정은 `목표 − 이미 낸 수` 하나만 쓴다 —
   *    프로필 불변식(슬롯 합 === dailyTarget · 회차당 1건)이 그것을 떠받친다.
   *    그 불변식이 깨지면 판정이 조용히 틀리므로 **여기서 직접 잠근다.**
   */
  {
    const at = (h: number, m: number) =>
      new Date(Date.UTC(2026, 8, 22, h - 9, m, 0))
    const cases: readonly { label: string; now: Date; published: number }[] = [
      { label: '09:30 직전 · 0건', now: at(9, 29), published: 0 },
      { label: '13:30 직전 · 1건', now: at(13, 29), published: 1 },
      { label: '19:00 직전 · 2건', now: at(18, 59), published: 2 },
      { label: '19:00 직후 · 3건', now: at(19, 1), published: 3 },
    ]
    const want = PROFILES.d3.dailyTarget
    const slotSum = PROFILES.d3.slots.reduce((n, sl) => n + sl.count, 0)
    check('🔴 🔴 **슬롯 합 === 하루 목표 — 판정이 기대는 불변식이다**', slotSum === want,
      `슬롯 합 ${slotSum} · 목표 ${want}`)
    for (const c of cases) {
      const left = slotsLeftToday('d3', c.now)
      check(`🔴 남은 슬롯 = 남은 편수 (${c.label})`,
        left === want - c.published, `슬롯 ${left} · 남은 편수 ${want - c.published}`)
    }
  }

  // ── 🔴 허가 단계와 판정 단계가 다르면 거부 ──
  const mismatch = resolveScale(
    envOf({ SORAN_CAPACITY_STAGE: 'd5', [CANARY_STAGE_ENV]: 'd3', [CANARY_DATE_ENV]: DAY }),
    { readiness: NOTHING_READY,
      canary: {
        now: new Date('2026-09-22T00:30:00.000Z'),
        // 🔴 d5 를 판정해 놓고 d3 허가에 붙인다
        verdict: judgeOneDayCanary(
          simulateStage({
            stage: 'd5', queue: [1, 2, 3, 4, 5].map(candOf), personas,
            history: personas.map((p) => ({ code: p.code, matchedAts: [] })),
            axis: { now: new Date('2026-09-22T00:30:00.000Z'), publishedToday: 0 }, days: 1,
          }),
          { publishedToday: 0, slotsLeft: 5 }),
      } })
  check('🔴 🔴 **허가 단계와 판정 단계가 다르면 거부한다**',
    mismatch.releaseStage === 'd1' && mismatch.canaryStage === false
    && mismatch.notes.some((n) => n.includes('판정은')),
    `stage=${mismatch.releaseStage}`)
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 DB 0 · 네트워크 0 · 파일 write 0 · 실제 발행 0\n')
if (fail > 0) process.exit(1)
