#!/usr/bin/env tsx
/**
 * 🔴 **자동 단계 사다리 — 정본 조립 · 승인 천장 계약 검사** (2026-09-24 4차)
 *
 * 🔴 이 파일의 9/24 검사는 **구조 회귀**다 — `q(n)` fixture 로 만든 것이지
 *    실제 운영 스냅샷이 아니다. 실제 조립은 `npm run stage:probe` 가 따로 한다.
 *
 * 🔴 DB 0 · 네트워크 0 · 파일 write 0 · LLM 0.
 */
import { readFileSync } from 'node:fs'

import {
  planStageDecision, safestDecision, STAGE_DECISION_VERSION, TRANSITION_STATES,
  type DatedCanary,
} from '../src/lib/stage-ladder'
import {
  ensureStageDecision, controllerEnabled, CONTROLLER_ENV, ENSURE_STEPS,
} from '../src/lib/stage-decision-store'
import { sameStageSnapshot, reconcileStageSources, type StageSnapshot } from '../src/lib/stage-source'
import { PROFILES, RELEASE_STAGES, SAFEST_STAGE, type ReleaseStage } from '../src/lib/scale-profile'
import { simulateStage, stageVerdicts } from '../src/lib/scale-readiness'
import { judgeOneDayCanary } from '../src/lib/release-canary'
import { judgePromotion, type PromotionInput } from '../src/lib/d100-capacity'
import { planSpeakerAvailability, remainingCapacity } from '../src/lib/content-core/speaker-availability'
import { parsePoolDoc, cardToPersona } from '../src/lib/persona-pool-card'
import { PERSONA_POOL_DOC } from './lib/voice-runtime.mjs'
import type { QueueCandidate } from '../src/lib/supply-candidates'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

const NOW = new Date('2026-09-24T18:00:00+09:00')
const AT = NOW.toISOString()
const DATE = '2026-09-24'
const CAPTURED = new Date(NOW.getTime() - 3 * 86_400_000)
const N = ['아침 산책', '무릎 이야기', '김장 준비', '동네 마실', '주말 반찬']
const q = (n: number): QueueCandidate[] => Array.from({ length: n }, (_, i) => ({
  queueId: `q-${String(i).padStart(3, '0')}`, title: `${N[i % N.length]} (${i})`,
  body: `${N[i % N.length]}\n\n있었던 소소한 이야기를 적어 봅니다. ${i}번째 글이에요.`,
  gateVerdict: 'PASS', createdAt: i, assignedPersonaCode: null,
  voice: null, profile: 'human' as const, capturedAt: CAPTURED,
}))
const POOL = parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8'))
const PERSONAS = POOL.cards.filter((c) => c.voiceLength !== null).map(cardToPersona)

/** 🔴 정본 조립 — 손으로 verdict 를 만들지 않는다 */
const assemble = (o: { stock: number; publishedToday: number }) => {
  const queue = q(o.stock)
  const axis = { now: NOW, publishedToday: o.publishedToday }
  const verdicts = stageVerdicts({ queue, personas: PERSONAS, axis })
  /** 🔴 같은 `runAt` 에서 날짜와 대상 단계를 함께 붙인다 */
  const daily = (stage: ReleaseStage, kstDate = DATE): DatedCanary => {
    const slotsLeft = Math.max(0, PROFILES[stage].dailyTarget - o.publishedToday)
    const sim = simulateStage({
      stage, queue, personas: PERSONAS, axis, days: 1, anchor: 'now', dailyCap: slotsLeft,
    })
    return {
      kstDate, stage, builtAt: AT,
      verdict: judgeOneDayCanary(sim, { publishedToday: o.publishedToday, slotsLeft }),
    }
  }
  return { verdicts, daily }
}
const promo = (o: Partial<PromotionInput> & Pick<PromotionInput, 'current' | 'next'>) =>
  judgePromotion({
    readyStock: null, activePersonas: null, detailPerDay: null,
    readyQualifiedPerDay: null, readyStockDeltaPerDay: null,
    currentStableStreakDays: null, publishRunnerReady: true, commentRunnerReady: true,
    publishedPerDay: null, currentLimitsActive: true, ...o,
  })
/** 🔴 지속 승격 조건을 전부 채운 입력 — 정본이 ready 를 내게 한다 */
const promoReady = (current: ReleaseStage, nextStage: 'd3' | 'd5' | 'd10') =>
  promo({
    current, next: nextStage, readyStock: 99999, activePersonas: 999, detailPerDay: 999,
    readyQualifiedPerDay: 999, readyStockDeltaPerDay: 5, currentStableStreakDays: 99,
  })

console.log('\n══ 자동 단계 사다리 — 승인 천장 계약 (DB 0 · 네트워크 0) ══')

console.log('\n① 🔴 새 규칙·새 숫자 없음 · 천장을 올리지 않는다')
{
  const codeOnly = (f: string): string => readFileSync(f, 'utf-8')
    .split('\n').filter((l) => !/^\s*(?:\*|\/\/|\/\*)/.test(l)).join('\n')
  const src = codeOnly('src/lib/stage-ladder.ts')
  check('🔴 새 문턱값이 없다', !/STAGE_REQUIREMENTS|goodDaysToEnter|readyStock:\s*\d/.test(src))
  check('🔴 전역 감속(hardBlocks·auditPending)이 없다', !/hardBlocks|auditPending/.test(src))
  check('🔴 🔴 **capacity 는 승인 천장 그대로다 — 어디서도 올리지 않는다**',
    /capacity: ceiling/.test(src) && !/capacity = /.test(src))
  check('🔴 정본 넷을 소비한다', (() => {
    const t = readFileSync('src/lib/stage-ladder.ts', 'utf-8')
    return /judgeOneDayCanary/.test(t) && /judgePromotion/.test(t)
      && /StageVerdict/.test(t) && /safeStageFor/.test(t)
  })())
  check('🔴 세 입력이 이름으로 분리돼 있다',
    /sustainedRelease/.test(src) && /authorizedCapacityCeiling/.test(src) && /daily:/.test(src))
  check('🔴 사다리는 진단 도구를 부르지 않는다', !/reconcileStageSources/.test(src))
}

console.log('\n② 🔴 🔴 반례 — release d3 · 승인 천장 d5 · preflight 미달 → PREPARE 유지')
{
  const a = assemble({ stock: 140, publishedToday: 0 })
  const d = planStageDecision({
    kstDate: DATE, sustainedRelease: 'd3', authorizedCapacityCeiling: 'd5',
    verdicts: a.verdicts, daily: null,
    // 🔴 preflight 미달(재고·Persona 미측정) — 그래도 천장이 높으므로 재고를 쌓는다
    promotion: promo({ current: 'd3', next: 'd5' }),
    publishedToday: 0, decidedAt: AT,
  })
  check('🔴 🔴 **PREPARE · 공개 d3 · 천장 d5 유지**',
    d.state === 'PREPARE' && d.release === 'd3' && d.capacity === 'd5',
    `${d.state} release=${d.release} capacity=${d.capacity} · ${d.reasons.join(' | ')}`)
  check('🔴 준비 진행률을 값으로 말한다 — 천장을 만들지 않는다',
    d.reasons.some((r) => r.includes('준비 중') || r.includes('준비 완료')), d.reasons.join(' | '))
}

console.log('\n③ 🔴 🔴 반례 — release d3 · 천장 d3 · d5 trial GO → D5 공개 금지')
{
  const a = assemble({ stock: 12, publishedToday: 0 })
  const daily = a.daily('d5')
  check('🔴 정본 하루 판정은 GO 다', daily.verdict.ok, JSON.stringify(daily.verdict.reasons))
  const d = planStageDecision({
    kstDate: DATE, sustainedRelease: 'd3', authorizedCapacityCeiling: 'd3',
    verdicts: a.verdicts, daily, promotion: promo({ current: 'd3', next: 'd5' }),
    publishedToday: 0, decidedAt: AT,
  })
  check('🔴 🔴 **천장이 d3 면 d5 시험을 열지 않는다**',
    d.release !== 'd5' && d.state !== 'TRIAL',
    `${d.state} release=${d.release} · ${d.reasons.join(' | ')}`)
  check('🔴 🔴 **구조화된 CEILING 사유가 남는다**',
    d.blocks.some((b) => b.code === 'CEILING'), JSON.stringify(d.blocks))
  check('🔴 천장은 그대로 d3 다 — 올리지 않았다', d.capacity === 'd3')
}

console.log('\n④ 🔴 🔴 반례 — release d3 · 천장 d5 · d5 trial GO → 오늘만 D5')
{
  const a = assemble({ stock: 12, publishedToday: 0 })
  const d = planStageDecision({
    kstDate: DATE, sustainedRelease: 'd3', authorizedCapacityCeiling: 'd5',
    verdicts: a.verdicts, daily: a.daily('d5'),
    promotion: promo({ current: 'd3', next: 'd5' }), publishedToday: 0, decidedAt: AT,
  })
  check('🔴 🔴 **TRIAL · 오늘만 d5**',
    d.state === 'TRIAL' && d.release === 'd5', `${d.state} release=${d.release}`)
  check('🔴 지속 미달이 하루 시험을 막지 않는다',
    d.reasons.some((r) => r.includes('오늘만')), d.reasons.join(' | '))
  check('🔴 천장은 그대로 d5 다', d.capacity === 'd5')
}

console.log('\n⑤ 🔴 🔴 반례 — D5 sustained 성공 · 천장 d5 → release d5 · D10 자동 상승 금지')
{
  const a = assemble({ stock: 140, publishedToday: 0 })
  const d = planStageDecision({
    kstDate: DATE, sustainedRelease: 'd3', authorizedCapacityCeiling: 'd5',
    verdicts: a.verdicts, daily: null,
    promotion: promoReady('d3', 'd5'), publishedToday: 0, decidedAt: AT,
  })
  check('🔴 🔴 **SUSTAIN — 공개가 d5 로 올라간다**',
    d.state === 'SUSTAIN' && d.release === 'd5', `${d.state} release=${d.release}`)
  check('🔴 🔴 **천장은 d5 그대로 — D10 으로 자동 상승하지 않는다**',
    d.capacity === 'd5', `capacity=${d.capacity}`)
  check('🔴 그 사실을 값으로 말한다',
    d.reasons.some((r) => r.includes('자동으로 올라가지 않는다')), d.reasons.join(' | '))
  /** 🔴 승격 대상이 천장을 넘으면 승격 자체를 보류한다 */
  const over = planStageDecision({
    kstDate: DATE, sustainedRelease: 'd5', authorizedCapacityCeiling: 'd5',
    verdicts: a.verdicts, daily: null,
    promotion: promoReady('d5', 'd10'), publishedToday: 0, decidedAt: AT,
  })
  check('🔴 🔴 **승격 대상 d10 이 천장 d5 를 넘으면 승격을 보류한다**',
    over.release === 'd5' && over.blocks.some((b) => b.code === 'CEILING'),
    `${over.release} · ${JSON.stringify(over.blocks)}`)
}

console.log('\n⑥ 🔴 🔴 반례 — 잘못된 판정 출처는 fail-closed')
{
  const a = assemble({ stock: 140, publishedToday: 0 })
  /** 🔴 d3 용 결정에 d5→d10 promotion 을 끼워 넣는다 */
  const wrong = planStageDecision({
    kstDate: DATE, sustainedRelease: 'd3', authorizedCapacityCeiling: 'd10',
    verdicts: a.verdicts, daily: null,
    promotion: promoReady('d5', 'd10'), publishedToday: 0, decidedAt: AT,
  })
  check('🔴 🔴 **promotion.current 가 다르면 그 판정을 쓰지 않는다**',
    wrong.blocks.some((b) => b.code === 'PROVENANCE_CURRENT') && wrong.state !== 'SUSTAIN',
    `${wrong.state} · ${JSON.stringify(wrong.blocks)}`)
  const wrongNext = planStageDecision({
    kstDate: DATE, sustainedRelease: 'd3', authorizedCapacityCeiling: 'd10',
    verdicts: a.verdicts, daily: null,
    promotion: promoReady('d3', 'd10'), publishedToday: 0, decidedAt: AT,
  })
  check('🔴 🔴 **promotion.next 가 바로 다음 단계가 아니면 쓰지 않는다**',
    wrongNext.blocks.some((b) => b.code === 'PROVENANCE_NEXT') && wrongNext.state !== 'SUSTAIN',
    JSON.stringify(wrongNext.blocks))
  /** 🔴 전날 canary 결과를 오늘 결정에 끼워 넣는다 */
  const stale = planStageDecision({
    kstDate: DATE, sustainedRelease: 'd3', authorizedCapacityCeiling: 'd5',
    verdicts: a.verdicts, daily: a.daily('d5', '2026-09-23'),
    promotion: promo({ current: 'd3', next: 'd5' }), publishedToday: 0, decidedAt: AT,
  })
  check('🔴 🔴 **전날 canary 결과는 쓰지 않는다 (STALE_DAILY)**',
    stale.blocks.some((b) => b.code === 'STALE_DAILY') && stale.state !== 'TRIAL',
    `${stale.state} · ${JSON.stringify(stale.blocks)}`)
  /** 🔴 대상 단계와 verdict.stage 가 어긋난 조합 */
  const mixed = a.daily('d5')
  const mismatched = planStageDecision({
    kstDate: DATE, sustainedRelease: 'd3', authorizedCapacityCeiling: 'd5',
    verdicts: a.verdicts, daily: { ...mixed, stage: 'd10' },
    promotion: promo({ current: 'd3', next: 'd5' }), publishedToday: 0, decidedAt: AT,
  })
  check('🔴 🔴 **대상 단계와 verdict.stage 가 다르면 쓰지 않는다**',
    mismatched.blocks.some((b) => b.code === 'PROVENANCE_STAGE') && mismatched.state !== 'TRIAL',
    JSON.stringify(mismatched.blocks))
}

console.log('\n⑦ 🔴 9/24 **구조 회귀** — q(12) fixture 다 (실제 운영 스냅샷이 아니다)')
{
  const a = assemble({ stock: 12, publishedToday: 4 })
  const d = planStageDecision({
    kstDate: DATE, sustainedRelease: 'd5', authorizedCapacityCeiling: 'd5',
    verdicts: a.verdicts, daily: a.daily('d5'),
    promotion: promo({ current: 'd5', next: 'd10' }), publishedToday: 4, decidedAt: AT,
    supply: {
      eligibleSpeakers: 1,
      excluded: [
        { reason: 'noOpenDay', codes: ['P03', 'P04', 'P05', 'P08', 'P10', 'P11', 'P15', 'P16', 'P17', 'P18', 'P19', 'P20', 'P21', 'P22', 'P23', 'P24', 'P25'] },
        { reason: 'holdingStock', codes: ['P01', 'P02', 'P06', 'P07', 'P12', 'P13'] },
      ],
    },
  })
  check('🔴 🔴 **구조 회귀: 4건 발행 + 하루 GO → d5 유지 · 5번째 가능**',
    d.release === 'd5' && PROFILES[d.release].dailyTarget > 4,
    `${d.state} release=${d.release} · ${d.reasons.join(' | ')}`)
  check('🔴 공급 화자 1명이 결정 근거에 들어가지 않는다',
    d.supply?.eligibleSpeakers === 1 && !d.reasons.some((r) => r.includes('화자')))
  check('🔴 🔴 **이 검사가 실제 운영 스냅샷이 아님을 스스로 말한다**',
    /구조 회귀/.test(readFileSync('scripts/stage-ladder-check.mts', 'utf-8')))
}

console.log('\n⑧ 🔴 관측 결손 · 그날 고정')
{
  const d = planStageDecision({
    kstDate: '2026-09-25', sustainedRelease: 'd5', authorizedCapacityCeiling: 'd5',
    verdicts: [], daily: null, promotion: null, publishedToday: 0, decidedAt: AT,
  })
  check('🔴 🔴 **새 날짜에 판정 없음 → d1 fail-closed**',
    d.release === SAFEST_STAGE && d.capacity === SAFEST_STAGE, `${d.release}/${d.capacity}`)
  check('🔴 아무것도 못 읽으면 가장 안전한 단계다',
    safestDecision('2026-09-25', AT).release === SAFEST_STAGE)
  const a = assemble({ stock: 0, publishedToday: 4 })
  const pinned = planStageDecision({
    kstDate: DATE, sustainedRelease: 'd5', authorizedCapacityCeiling: 'd5',
    verdicts: a.verdicts, daily: null, promotion: promo({ current: 'd5', next: 'd10' }),
    publishedToday: 4, decidedAt: AT,
  })
  check('🔴 이미 4건 냈으면 그날은 d5 를 고정한다',
    pinned.release === 'd5' && pinned.dayPinned, `${pinned.release} pinned=${pinned.dayPinned}`)
}

console.log('\n⑨ 🔴 공급 생성 화자 ≠ 발행 배정 가능')
{
  const caps = [
    { code: 'P14', openDays: 1, readyCount: 0 },
    { code: 'P10', openDays: 0, readyCount: 0 },
    { code: 'P02', openDays: 1, readyCount: 1 },
  ]
  check('P10 공급 여력 0 (9/24 15:49 실제 발행)', remainingCapacity(caps[1]!) === 0)
  check('P02 공급 여력 0 (재고 보유 · 9/24 19:32 실제 발행)', remainingCapacity(caps[2]!) === 0)
  check('공급 계획은 여력 있는 한 명만 남긴다',
    planSpeakerAvailability({ sourceKeys: ['s1'], capacities: caps }).eligible.join(',') === 'P14')
  check('🔴 결정기는 `eligibleSpeakers` 를 조건으로 쓰지 않는다',
    !/eligibleSpeakers\s*[<>=]/.test(readFileSync('src/lib/stage-ladder.ts', 'utf-8')))
}

console.log('\n⑩ 🔴 writer · 동시성 · rollback')
{
  const D = (o: Partial<ReturnType<typeof safestDecision>> = {}) =>
    ({ ...safestDecision(DATE, AT), ...o })
  /** ① 행이 없으면 먼저 온 쪽이 만든다 */
  let inserted = 0
  const first = await ensureStageDecision({
    read: async () => null, compute: () => D({ release: 'd5' }),
    insert: async () => { inserted += 1; return 'inserted' }, by: 'supply',
  })
  check('🔴 🔴 **행이 없으면 먼저 온 러너가 만든다**',
    first.ok && first.created && first.by === 'supply' && inserted === 1, JSON.stringify(first))

  /** ② 이미 있으면 읽기만 한다 — 다시 계산하지 않는다 */
  let computed = 0
  const second = await ensureStageDecision({
    read: async () => D({ release: 'd3' }),
    compute: () => { computed += 1; return D({ release: 'd5' }) },
    insert: async () => 'inserted', by: 'publish',
  })
  check('🔴 🔴 **이미 있으면 그 행을 쓴다 — 계산도 덮어쓰기도 하지 않는다**',
    second.ok && !second.created && second.decision.release === 'd3' && computed === 0,
    `computed=${computed} ${JSON.stringify(second.ok && second.decision.release)}`)

  /** ③ 동시 시작 — INSERT 충돌이면 이긴 행을 읽는다 */
  let reads = 0
  const raced = await ensureStageDecision({
    read: async () => { reads += 1; return reads === 1 ? null : D({ release: 'd3' }) },
    compute: () => D({ release: 'd5' }),
    insert: async () => 'conflict', by: 'publish',
  })
  check('🔴 🔴 **동시 시작에서 진 쪽은 자기 계산을 버리고 이긴 행을 읽는다**',
    raced.ok && !raced.created && raced.decision.release === 'd3',
    JSON.stringify(raced.ok && raced.decision.release))

  /** ④ 만들지도 읽지도 못하면 UNAVAILABLE — 부르는 쪽이 안전 단계로 간다 */
  const gone = await ensureStageDecision({
    read: async () => null, compute: () => D(), insert: async () => 'conflict', by: 'supply',
  })
  check('🔴 🔴 **행을 끝내 못 읽으면 `UNAVAILABLE` — "모른다" 를 어제 값으로 채우지 않는다**',
    !gone.ok && gone.code === 'UNAVAILABLE', JSON.stringify(gone))

  check('🔴 순서가 계약으로 고정돼 있다', ENSURE_STEPS.join(',') === 'read,compute,insert,reread')
  check('🔴 🔴 **rollback 은 kill switch 다 — contractVersion 되돌리기가 아니다**',
    controllerEnabled({ [CONTROLLER_ENV]: 'on' })
    && !controllerEnabled({ [CONTROLLER_ENV]: 'off' })
    && !controllerEnabled({}))
  const store = readFileSync('src/lib/stage-decision-store.ts', 'utf-8')
  check('🔴 하루 결정은 immutable — 갱신 칼럼을 두지 않는다',
    /immutable/.test(store) && !/revision\s*Int/.test(store))
  check('🔴 🔴 **근거 없는 90일 삭제 규칙이 없다**',
    !/90일|retention|보존 기간 규칙을 둔다/.test(store))
  check('🔴 migration 도 DB write 도 아직 없다',
    !/prisma\.|\$transaction|migration\.sql/.test(store))
}

console.log('\n⑪ 🔴 결정 하나에 여섯 칸이 남는다')
{
  const a = assemble({ stock: 140, publishedToday: 0 })
  const d = planStageDecision({
    kstDate: DATE, sustainedRelease: 'd3', authorizedCapacityCeiling: 'd5',
    verdicts: a.verdicts, daily: a.daily('d3'),
    promotion: promo({ current: 'd3', next: 'd5' }), publishedToday: 0, decidedAt: AT,
  })
  check('날짜·천장·공개·상태·근거·시각·계약 판',
    d.kstDate === DATE && d.capacity === 'd5' && d.release !== undefined
    && TRANSITION_STATES.includes(d.state) && d.reasons.length > 0
    && d.decidedAt === AT && d.contractVersion === STAGE_DECISION_VERSION)
  const S = (o: Partial<StageSnapshot>): StageSnapshot => ({
    kstDate: DATE, capacity: 'd5', release: 'd1', decidedBy: 'supply', decidedAt: AT, ...o,
  })
  check('공급·발행이 같은 값을 보면 통과', sameStageSnapshot(S({}), S({ decidedBy: 'publish' })).ok)
  check('🔴 다르면 막는다', !sameStageSnapshot(S({}), S({ decidedBy: 'publish', capacity: 'd3' })).ok)
  check('🔴 진단 도구는 따로 있다',
    reconcileStageSources({ canonical: {}, github: {} }).capacity === SAFEST_STAGE)
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 순수 함수 검사다 — 러너가 이 결정을 쓰는 **배선은 아직 없다**.')
console.log('🔴 migration 0 · DB write 0. 실제 운영 조립은 `stage:probe` 가 따로 한다.\n')
if (fail > 0) process.exit(1)
