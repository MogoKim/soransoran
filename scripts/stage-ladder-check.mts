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
  previousKstDate, nextStage, DECISION_WRITER, type StageDecision,
  planStageDecision, safestDecision, STAGE_DECISION_VERSION, TRANSITION_STATES,
  type DatedCanary,
} from '../src/lib/stage-ladder'
import {
  ensureStageDecision, consumeStageDecision, validateStoredDecision,
  controllerEnabled, CONTROLLER_ENV, ENSURE_STEPS, DECISION_CONSUMERS,
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
import { loadPublishableStock, stageStock } from './lib/publishable-stock.mjs'
import { planPublishBatch, resolvePublishScale } from './lib/publishable-stock.mjs'
import { activeScale } from '../src/lib/scale-runtime'

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

/**
 * 🔴 **전날의 저장된 결정 — 시험 기반의 정본** (2026-09-24 6차).
 *    `trialBase` 는 이제 env 문자열도 caller 주장도 아니다. 바로 전 KST 날짜의
 *    검증된 `StageDecision.release` 하나뿐이다.
 */
const PREV_DATE = previousKstDate(DATE)!
const prevDecision = (
  release: ReleaseStage, o: Partial<StageDecision> = {},
): StageDecision => ({
  kstDate: PREV_DATE, capacity: 'd10', release, state: 'HOLD',
  reasons: [], blocks: [], dayPinned: false, supply: null,
  decidedAt: `${PREV_DATE}T01:00:00.000Z`,
  contractVersion: STAGE_DECISION_VERSION,
  decidedBy: DECISION_WRITER, transition: null, ...o,
})

/** 🔴 정본 조립 — 손으로 verdict 를 만들지 않는다 */
const assemble = (o: { stock: number; publishedToday: number }) => {
  const queue = q(o.stock)
  const axis = { now: NOW, publishedToday: o.publishedToday }
  const verdicts = stageVerdicts({ queue, personas: PERSONAS, axis })
  /** 🔴 같은 `runAt` 에서 날짜와 대상 단계를 함께 붙인다 */
  const daily = (stage: ReleaseStage, kstDate = DATE, base: ReleaseStage = 'd3'): DatedCanary => {
    const slotsLeft = Math.max(0, PROFILES[stage].dailyTarget - o.publishedToday)
    const sim = simulateStage({
      stage, queue, personas: PERSONAS, axis, days: 1, anchor: 'now', dailyCap: slotsLeft,
    })
    return {
      kstDate, stage, builtAt: AT, trialBase: base,
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
    // 🔴 시험 기반의 정본 — 전날 실제로 공개한 단계다
    previousDecision: prevDecision('d3'),
  check('🔴 사다리는 진단 도구를 부르지 않는다', !/reconcileStageSources/.test(src))
}

console.log('\n② 🔴 🔴 반례 — release d3 · 승인 천장 d5 · preflight 미달 → PREPARE 유지')
{
  const a = assemble({ stock: 140, publishedToday: 0 })
  const d = planStageDecision({
    kstDate: DATE, sustainedRelease: 'd3', authorizedCapacityCeiling: 'd5',
    verdicts: a.verdicts, daily: null,
    // 🔴 하루 판정이 없으면 시험도 없다 — 기반이 필요하지 않다
    previousDecision: null,
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
    // 🔴 시험 기반의 정본 — 전날 실제로 공개한 단계다
    previousDecision: prevDecision('d3'),
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
    // 🔴 시험 기반의 정본 — 전날 실제로 공개한 단계다
    previousDecision: prevDecision('d3'),
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
    // 🔴 하루 판정이 없으면 시험도 없다 — 기반이 필요하지 않다
    previousDecision: null,
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
    // 🔴 하루 판정이 없으면 시험도 없다 — 기반이 필요하지 않다
    previousDecision: null,
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
    // 🔴 하루 판정이 없으면 시험도 없다 — 기반이 필요하지 않다
    previousDecision: null,
    promotion: promoReady('d5', 'd10'), publishedToday: 0, decidedAt: AT,
  })
  check('🔴 🔴 **promotion.current 가 다르면 그 판정을 쓰지 않는다**',
    wrong.blocks.some((b) => b.code === 'PROVENANCE_CURRENT') && wrong.state !== 'SUSTAIN',
    `${wrong.state} · ${JSON.stringify(wrong.blocks)}`)
  const wrongNext = planStageDecision({
    kstDate: DATE, sustainedRelease: 'd3', authorizedCapacityCeiling: 'd10',
    verdicts: a.verdicts, daily: null,
    // 🔴 하루 판정이 없으면 시험도 없다 — 기반이 필요하지 않다
    previousDecision: null,
    promotion: promoReady('d3', 'd10'), publishedToday: 0, decidedAt: AT,
  })
  check('🔴 🔴 **promotion.next 가 바로 다음 단계가 아니면 쓰지 않는다**',
    wrongNext.blocks.some((b) => b.code === 'PROVENANCE_NEXT') && wrongNext.state !== 'SUSTAIN',
    JSON.stringify(wrongNext.blocks))
  /** 🔴 전날 canary 결과를 오늘 결정에 끼워 넣는다 */
  const stale = planStageDecision({
    kstDate: DATE, sustainedRelease: 'd3', authorizedCapacityCeiling: 'd5',
    verdicts: a.verdicts, daily: a.daily('d5', '2026-09-23'),
    // 🔴 시험 기반의 정본 — 전날 실제로 공개한 단계다
    previousDecision: prevDecision('d3'),
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
    // 🔴 시험 기반의 정본 — 전날 실제로 공개한 단계다
    previousDecision: prevDecision('d3'),
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
    // 🔴 시험 기반의 정본 — 전날 실제로 공개한 단계다
    previousDecision: prevDecision('d3'),
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
    // 🔴 하루 판정이 없으면 시험도 없다 — 기반이 필요하지 않다
    previousDecision: null,
  })
  check('🔴 🔴 **새 날짜에 판정 없음 → d1 fail-closed**',
    d.release === SAFEST_STAGE && d.capacity === SAFEST_STAGE, `${d.release}/${d.capacity}`)
  check('🔴 아무것도 못 읽으면 가장 안전한 단계다',
    safestDecision('2026-09-25', AT).release === SAFEST_STAGE)
  const a = assemble({ stock: 0, publishedToday: 4 })
  const pinned = planStageDecision({
    kstDate: DATE, sustainedRelease: 'd5', authorizedCapacityCeiling: 'd5',
    verdicts: a.verdicts, daily: null, promotion: promo({ current: 'd5', next: 'd10' }),
    // 🔴 하루 판정이 없으면 시험도 없다 — 기반이 필요하지 않다
    previousDecision: null,
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

console.log('\n⑩ 🔴 writer · 동시성 · rollback · 🔴 세 지점 전부 검증')
{
  /** 🔴 검사도 **운영과 같은 validator** 를 쓴다 — 여기서 느슨하게 만들면 뜻이 없다 */
  const validate = (row: unknown) => validateStoredDecision({
    row, expectKstDate: DATE, expectContractVersion: STAGE_DECISION_VERSION,
  })
  /** 🔴 `safestDecision` 은 HOLD·d1/d1 이다 — 그대로는 PREPARE 불변식에 걸리지 않는다 */
  const D = (o: Partial<StageDecision> = {}): StageDecision =>
    ({ ...safestDecision(DATE, AT), capacity: 'd10', ...o })

  /** ① 행이 없으면 controller 가 만든다 */
  let inserted = 0
  const first = await ensureStageDecision({
    read: async () => null, compute: () => D({ release: 'd5' }),
    insert: async () => { inserted += 1; return 'inserted' }, validate, by: DECISION_WRITER,
  })
  check('🔴 🔴 **결정은 controller 하나가 만든다 (first-writer 폐기)**',
    first.ok && first.created && first.by === DECISION_WRITER && inserted === 1, JSON.stringify(first))

  /** ② 이미 있으면 읽기만 한다 — 다시 계산하지 않는다 */
  let computed = 0
  const second = await ensureStageDecision({
    read: async () => D({ release: 'd3' }),
    compute: () => { computed += 1; return D({ release: 'd5' }) },
    insert: async () => 'inserted', validate, by: DECISION_WRITER,
  })
  check('🔴 🔴 **이미 있으면 그 행을 쓴다 — 계산도 덮어쓰기도 하지 않는다**',
    second.ok && !second.created && second.decision.release === 'd3' && computed === 0,
    `computed=${computed}`)

  /** ③ 동시 시작 — INSERT 충돌이면 이긴 행을 읽는다 */
  let reads = 0
  const raced = await ensureStageDecision({
    read: async () => { reads += 1; return reads === 1 ? null : D({ release: 'd3' }) },
    compute: () => D({ release: 'd5' }),
    insert: async () => 'conflict', validate, by: DECISION_WRITER,
  })
  check('🔴 유일키 충돌이면 자기 계산을 버리고 그 행을 읽는다',
    raced.ok && !raced.created && raced.decision.release === 'd3')

  /** ④ 만들지도 읽지도 못하면 UNAVAILABLE */
  const gone = await ensureStageDecision({
    read: async () => null, compute: () => D(), insert: async () => 'conflict',
    validate, by: DECISION_WRITER,
  })
  check('🔴 🔴 **행을 끝내 못 읽으면 `UNAVAILABLE` — "모른다" 를 어제 값으로 채우지 않는다**',
    !gone.ok && gone.code === 'UNAVAILABLE', JSON.stringify(gone))

  /**
   * ── 🔴 **세 지점 전부 검증한다** (2026-09-24 6차 · 마스터 지적) ──
   *    앞판은 읽은 행을 **검증 없이** `ok:true` 로 돌려줬다. 같은 행을 consumer 는
   *    `BROKEN` 으로 거절했으니, 두 경로가 서로 다른 답을 내고 있었다.
   */
  const brokenRow = { ...D({ release: 'd5' }), decidedBy: 'publish' }
  const b1 = await ensureStageDecision({
    read: async () => brokenRow, compute: () => D(), insert: async () => 'inserted',
    validate, by: DECISION_WRITER,
  })
  check('🔴 🔴 **① 기존 행이 깨졌으면 `ok:true` 가 아니라 `BROKEN`**',
    !b1.ok && b1.code === 'BROKEN', JSON.stringify(b1))

  /** 🔴 깨진 값이 저장까지 흘러갔는지 — 0 이어야 한다 */
  let leaked = 0
  const b2 = await ensureStageDecision({
    read: async () => null,
    // 🔴 계산한 값이 계약을 어기면 **넣기 전에** 막는다 — immutable 이라 되돌릴 수 없다
    compute: () => ({ ...D(), release: 'd10', capacity: 'd3' }),
    // 🔴 던지지 않고 **세어 둔다** — 던지면 검사가 죽어 빨간 줄이 아니라 스택이 나온다
    insert: async () => { leaked += 1; return 'inserted' },
    validate, by: DECISION_WRITER,
  })
  check('🔴 🔴 **② 계산한 행도 insert 전에 검증한다 (release > capacity 차단)**',
    !b2.ok && b2.code === 'BROKEN' && leaked === 0,
    `leaked=${leaked} ${JSON.stringify(b2)}`)

  let r3 = 0
  const b3 = await ensureStageDecision({
    read: async () => { r3 += 1; return r3 === 1 ? null : brokenRow },
    compute: () => D({ release: 'd5' }), insert: async () => 'conflict',
    validate, by: DECISION_WRITER,
  })
  check('🔴 🔴 **③ 충돌 뒤 읽은 승자 행도 검증한다**',
    !b3.ok && b3.code === 'BROKEN', JSON.stringify(b3))

  /** 🔴 controller 와 consumer 가 **같은 validator** 를 쓴다 — 같은 행에 같은 답이다 */
  const cSame = await consumeStageDecision({
    read: async () => brokenRow, validate, controllerOn: true, by: 'publish',
  })
  check('🔴 🔴 **같은 깨진 행에 controller 와 consumer 가 같은 답을 낸다**',
    !b1.ok && !cSame.ok && cSame.code === 'BROKEN',
    `controller=${b1.ok ? 'ok' : b1.code} consumer=${cSame.ok ? 'ok' : cSame.code}`)

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
    // 🔴 시험 기반의 정본 — 전날 실제로 공개한 단계다
    previousDecision: prevDecision('d3'),
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

console.log('\n⑫ 🔴 🔴 단계 점프를 하루 시험으로 우회하지 못한다')
{
  const a = assemble({ stock: 12, publishedToday: 0 })
  /** 🔴 d1 기반인데 d5 를 시험하려 한다 */
  const jump = planStageDecision({
    kstDate: DATE, sustainedRelease: 'd1', authorizedCapacityCeiling: 'd10',
    verdicts: a.verdicts, daily: a.daily('d5', DATE, 'd1'),
    // 🔴 시험 기반의 정본 — 전날 실제로 공개한 단계다
    previousDecision: prevDecision('d1'),
    promotion: null, publishedToday: 0, decidedAt: AT,
  })
  check('🔴 🔴 **d1 기반에서 d5 시험은 막힌다 (바로 다음 칸이 아니다)**',
    jump.state !== 'TRIAL' && jump.blocks.some((b) => b.code === 'PROVENANCE_STAGE'),
    `${jump.state} · ${JSON.stringify(jump.blocks)}`)
  const jump2 = planStageDecision({
    kstDate: DATE, sustainedRelease: 'd3', authorizedCapacityCeiling: 'd10',
    verdicts: a.verdicts, daily: a.daily('d10', DATE, 'd3'),
    // 🔴 시험 기반의 정본 — 전날 실제로 공개한 단계다
    previousDecision: prevDecision('d3'),
    promotion: null, publishedToday: 0, decidedAt: AT,
  })
  check('🔴 🔴 **d3 기반에서 d10 시험도 막힌다**',
    jump2.state !== 'TRIAL' && jump2.blocks.some((b) => b.code === 'PROVENANCE_STAGE'))
  const good = planStageDecision({
    kstDate: DATE, sustainedRelease: 'd3', authorizedCapacityCeiling: 'd5',
    verdicts: a.verdicts, daily: a.daily('d5', DATE, 'd3'),
    // 🔴 시험 기반의 정본 — 전날 실제로 공개한 단계다
    previousDecision: prevDecision('d3'),
    promotion: null, publishedToday: 0, decidedAt: AT,
  })
  check('🔴 유효한 d3 기반 뒤 d5 시험은 열린다 (현재 운영 모양)',
    good.state === 'TRIAL' && good.release === 'd5', `${good.state}/${good.release}`)
  /**
   * 🔴 **정본이 바뀌었다** (2026-09-24 6차). 앞판은 기반을 `sustainedRelease` 와
   *    대조했다 — 그것은 env 문자열이지 "어제 실제로 낸 단계" 가 아니다.
   *    지금 기반의 정본은 **전날 결정의 `release`** 뿐이다.
   */
  const wrongBase = planStageDecision({
    kstDate: DATE, sustainedRelease: 'd3', authorizedCapacityCeiling: 'd5',
    // 🔴 기반 주장은 d1 인데 전날 실제 결정은 d3 다 — 주장이 정본과 다르다
    verdicts: a.verdicts, daily: a.daily('d5', DATE, 'd1'),
    previousDecision: prevDecision('d3'),
    promotion: null, publishedToday: 0, decidedAt: AT,
  })
  check('🔴 🔴 **시험 기반 주장이 전날 실제 결정과 다르면 막는다**',
    wrongBase.state !== 'TRIAL'
    && wrongBase.blocks.some((b) => b.code === 'PROVENANCE_PREVIOUS'),
    `${wrongBase.state} · ${JSON.stringify(wrongBase.blocks.map((b) => b.code))}`)
  /**
   * 🔴 **기반 검증만이 잡는 경우.** `대상 d3` 은 전날 d1 기준으로 "바로 다음 칸" 이다 —
   *    `PROVENANCE_STAGE` 는 통과한다. 주장(d3)이 정본(d1)과 다르다는 것만이 이것을 막는다.
   *    (겹치는 두 검사 중 어느 쪽이 실제로 일하는지 가른다)
   */
  const baseOnly = planStageDecision({
    kstDate: DATE, sustainedRelease: 'd3', authorizedCapacityCeiling: 'd5',
    verdicts: a.verdicts, daily: a.daily('d3', DATE, 'd3'),
    previousDecision: prevDecision('d1'),
    promotion: null, publishedToday: 0, decidedAt: AT,
  })
  check('🔴 🔴 **대상 d3 은 "다음 칸" 이지만 기반 주장이 달라서 막힌다**',
    baseOnly.state !== 'TRIAL'
    && baseOnly.blocks.some((b) => b.code === 'PROVENANCE_PREVIOUS')
    && !baseOnly.blocks.some((b) => b.code === 'PROVENANCE_STAGE'),
    `${baseOnly.state} · ${JSON.stringify(baseOnly.blocks.map((b) => b.code))}`)
  /** 🔴 `builtAt` 의 KST 날짜가 다르면 라벨만 맞춰도 막힌다 */
  const relabeled = planStageDecision({
    kstDate: DATE, sustainedRelease: 'd3', authorizedCapacityCeiling: 'd5',
    verdicts: a.verdicts,
    daily: { ...a.daily('d5', DATE, 'd3'), builtAt: '2026-09-23T10:00:00.000Z' },
    // 🔴 시험 기반의 정본 — 전날 실제로 공개한 단계다
    previousDecision: prevDecision('d3'),
    promotion: null, publishedToday: 0, decidedAt: AT,
  })
  check('🔴 🔴 **kstDate 라벨만 오늘로 바꾼 어제 판정은 막힌다 (builtAt 검증)**',
    relabeled.state !== 'TRIAL' && relabeled.blocks.some((b) => b.code === 'STALE_DAILY'),
    JSON.stringify(relabeled.blocks))
}

console.log('\n⑬ 🔴 🔴 consumer 는 읽기만 한다 — 없으면 사후 생성하지 않는다')
{
  const D = (o: Partial<StageDecision> = {}): StageDecision =>
    ({ ...safestDecision(DATE, AT), capacity: 'd10', ...o })
  const pass = (row: unknown) => ({ ok: true as const, decision: row as StageDecision })
  const off = await consumeStageDecision({
    read: async () => D(), validate: pass, controllerOn: false, by: 'supply',
  })
  check('🔴 🔴 **kill switch 가 꺼져 있으면 기존 경로로 간다**',
    !off.ok && off.fallback === 'legacy', JSON.stringify(off))
  const none = await consumeStageDecision({
    read: async () => null, validate: pass, controllerOn: true, by: 'publish',
  })
  check('🔴 🔴 **결정이 없으면 높은 단계를 사후 생성하지 않고 안전 단계로 간다**',
    !none.ok && none.code === 'NO_DECISION' && none.fallback === 'safest', JSON.stringify(none))
  const broken = await consumeStageDecision({
    read: async () => D(), validate: () => ({ ok: false as const, reason: '계약 판이 다르다' }),
    controllerOn: true, by: 'publish',
  })
  check('🔴 🔴 **깨진 행은 쓰지 않는다 (BROKEN → 안전 단계)**',
    !broken.ok && broken.code === 'BROKEN' && broken.fallback === 'safest')
  const good = await consumeStageDecision({
    read: async () => D({ release: 'd5' }), validate: pass,
    controllerOn: true, by: 'supply',
  })
  check('정상 행은 그대로 쓴다', good.ok && good.decision.release === 'd5')
  check('🔴 consumer 는 둘이다 — writer 는 하나다',
    DECISION_CONSUMERS.join(',') === 'supply,publish' && DECISION_WRITER === 'controller')

  /** 🔴 저장된 행 검증 — 계약 판·날짜·enum·시각 */
  const V = (o: Record<string, unknown>) => validateStoredDecision({
    row: { ...D(), ...o }, expectKstDate: DATE, expectContractVersion: STAGE_DECISION_VERSION,
    allowedStages: RELEASE_STAGES, allowedStates: TRANSITION_STATES,
  })
  check('🔴 계약 판이 다르면 거절', !V({ contractVersion: 'old' }).ok)
  check('🔴 날짜가 다르면 거절', !V({ kstDate: '2026-09-23' }).ok)
  check('🔴 모르는 단계면 거절', !V({ release: 'd7' }).ok)
  check('🔴 모르는 상태면 거절', !V({ state: 'WAT' }).ok)
  check('🔴 결정 시각을 못 읽으면 거절', !V({ decidedAt: 'nope' }).ok)
  check('정상 행은 통과', V({}).ok)

  /**
   * ── 🔴 **깨진 입력에 던지지 않는다** (2026-09-24 6차 · 마스터 지적) ──
   *    앞판 시그니처는 `row: StageDecision` 이었다. 그 타입은 저장소의 약속이 아니라
   *    **희망**이다 — JSON 이 깨진 행을 읽으면 `r.decidedAt.trim()` 에서 그대로
   *    throw 했고 consumer 가 죽었다. 🔴 지금은 어떤 입력에도 `ok:false` 다.
   */
  const ROT: unknown[] = [
    null, undefined, 42, 'row', [], { }, { kstDate: DATE },
    { ...D(), reasons: 'nope' }, { ...D(), blocks: [{ code: 1 }] },
    { ...D(), dayPinned: 'yes' }, { ...D(), supply: { eligibleSpeakers: 'many' } },
  ]
  let threw: string | null = null
  const verdicts2 = ROT.map((row) => {
    try {
      return validateStoredDecision({
        row, expectKstDate: DATE, expectContractVersion: STAGE_DECISION_VERSION,
      })
    } catch (e) { threw = `${String(row)} → ${String(e)}`; return { ok: true as const } }
  })
  check('🔴 🔴 **어떤 깨진 입력에도 던지지 않는다**', threw === null, threw ?? '')
  check('🔴 🔴 **그리고 전부 거절한다 — 모르는 것을 통과시키지 않는다**',
    verdicts2.every((v) => !v.ok), `통과해 버린 것 ${verdicts2.filter((v) => v.ok).length}건`)

  /** ── 🔴 저장 행 불변식 ── */
  check('🔴 🔴 **공개가 승인 천장을 넘으면 거절**',
    !V({ release: 'd10', capacity: 'd3' }).ok, JSON.stringify(V({ release: 'd10', capacity: 'd3' })))
  check('🔴 🔴 **decidedAt 의 KST 날짜가 kstDate 와 다르면 거절**',
    !V({ decidedAt: `${PREV_DATE}T01:00:00.000Z` }).ok)
  check('🔴 🔴 **controller 가 쓴 행이 아니면 거절**', !V({ decidedBy: 'publish' }).ok)
  check('🔴 🔴 **TRIAL 인데 구조화된 시험 근거가 없으면 거절**',
    !V({ state: 'TRIAL', release: 'd3', transition: null }).ok)
  check('🔴 🔴 **TRIAL 공개가 기반의 바로 다음 칸이 아니면 거절**',
    !V({
      state: 'TRIAL', release: 'd10',
      transition: { kind: 'TRIAL', trialBase: 'd1', previousKstDate: PREV_DATE, target: 'd10' },
    }).ok)
  check('🔴 정상 TRIAL 행은 통과 — d1 기반의 다음 칸은 d3 다',
    V({
      state: 'TRIAL', release: 'd3',
      transition: { kind: 'TRIAL', trialBase: 'd1', previousKstDate: PREV_DATE, target: 'd3' },
    }).ok)
  check('🔴 🔴 **SUSTAIN 인데 승격 근거가 없거나 어긋나면 거절**',
    !V({ state: 'SUSTAIN', release: 'd3', transition: null }).ok
    && !V({
      state: 'SUSTAIN', release: 'd3',
      transition: { kind: 'SUSTAIN', from: 'd1', to: 'd5' },
    }).ok)
  check('🔴 🔴 **PREPARE 인데 천장이 공개보다 높지 않으면 거절**',
    !V({ state: 'PREPARE', release: 'd10', capacity: 'd10' }).ok
    && V({ state: 'PREPARE', release: 'd3', capacity: 'd10' }).ok)
  check('🔴 HOLD 인데 전이 근거가 붙어 있으면 거절',
    !V({ state: 'HOLD', transition: { kind: 'SUSTAIN', from: 'd1', to: 'd3' } }).ok)
  check('🔴 🔴 **문구를 파싱해 상태를 검증하지 않는다**',
    !/reasons[\s\S]{0,80}(includes|match|test)\(/.test(
      readFileSync('src/lib/stage-decision-store.ts', 'utf-8')))
}

console.log('\n⑮ 🔴 🔴 trialBase 는 전날 실제 결정에서만 온다')
{
  const a = assemble({ stock: 12, publishedToday: 0 })
  const plan = (o: {
    sustained: ReleaseStage; ceiling: ReleaseStage; stage: ReleaseStage
    base: ReleaseStage; prev: StageDecision | null
  }) => planStageDecision({
    kstDate: DATE, sustainedRelease: o.sustained, authorizedCapacityCeiling: o.ceiling,
    verdicts: a.verdicts, daily: a.daily(o.stage, DATE, o.base),
    previousDecision: o.prev, promotion: null, publishedToday: 0, decidedAt: AT,
  })
  const hasPrev = (d: ReturnType<typeof plan>) => d.blocks.some((b) => b.code === 'PROVENANCE_PREVIOUS')

  /**
   * 🔴 **마스터 반례.** sustained 는 d1 인데 어제 실제로 D3 로 냈다.
   *    앞판은 기반을 `sustainedRelease` 에서 가져와 이 D3→D5 시험을 **막았다.**
   */
  const valid = plan({
    sustained: 'd1', ceiling: 'd5', stage: 'd5', base: 'd3', prev: prevDecision('d3'),
  })
  check('🔴 🔴 **sustained=d1 · 전날 결정 d3 · 오늘 d5 → 유효한 D3→D5 시험**',
    valid.state === 'TRIAL' && valid.release === 'd5' && valid.blocks.length === 0,
    `${valid.state} release=${valid.release} · ${JSON.stringify(valid.blocks)}`)
  check('🔴 🔴 **그 결정에 구조화된 시험 근거가 남는다**',
    valid.transition?.kind === 'TRIAL'
    && valid.transition.trialBase === 'd3' && valid.transition.target === 'd5'
    && valid.transition.previousKstDate === PREV_DATE,
    JSON.stringify(valid.transition))
  check('🔴 sustainedRelease 는 지속 승격용으로 남아 있다 — 두 축을 합치지 않았다',
    /sustainedRelease/.test(readFileSync('src/lib/stage-ladder.ts', 'utf-8'))
    && valid.release !== 'd1')

  /** ── 🔴 차단 반례 ── */
  const jump = plan({
    sustained: 'd1', ceiling: 'd10', stage: 'd5', base: 'd1', prev: prevDecision('d1'),
  })
  check('🔴 🔴 **전날 d1 인데 오늘 d5 → 단계 점프로 차단**',
    jump.state !== 'TRIAL' && jump.blocks.some((b) => b.code === 'PROVENANCE_STAGE'),
    `${jump.state} · ${JSON.stringify(jump.blocks.map((b) => b.code))}`)

  const none = plan({
    sustained: 'd1', ceiling: 'd10', stage: 'd3', base: 'd1', prev: null,
  })
  check('🔴 🔴 **전날 결정이 없으면 시험 없음 (첫 controller 실행일 · fail-closed)**',
    none.state !== 'TRIAL' && hasPrev(none), `${none.state} · ${JSON.stringify(none.blocks)}`)

  const twoDays = plan({
    sustained: 'd1', ceiling: 'd10', stage: 'd3', base: 'd1',
    prev: prevDecision('d1', { kstDate: previousKstDate(PREV_DATE)! }),
  })
  check('🔴 🔴 **이틀 전 결정이면 차단**', twoDays.state !== 'TRIAL' && hasPrev(twoDays))

  const oldVer = plan({
    sustained: 'd1', ceiling: 'd10', stage: 'd3', base: 'd1',
    prev: prevDecision('d1', { contractVersion: 'stage-decision-v3' as never }),
  })
  check('🔴 🔴 **contractVersion 불일치면 차단**', oldVer.state !== 'TRIAL' && hasPrev(oldVer))

  const notController = plan({
    sustained: 'd1', ceiling: 'd10', stage: 'd3', base: 'd1',
    prev: prevDecision('d1', { decidedBy: 'publish' }),
  })
  check('🔴 🔴 **writer 가 controller 가 아니면 차단**',
    notController.state !== 'TRIAL' && hasPrev(notController))

  const bigJump = plan({
    sustained: 'd3', ceiling: 'd10', stage: 'd10', base: 'd3', prev: prevDecision('d3'),
  })
  check('🔴 🔴 **전날 d3 인데 오늘 d10 → 차단 (다음 칸은 d5 다)**',
    bigJump.state !== 'TRIAL' && bigJump.blocks.some((b) => b.code === 'PROVENANCE_STAGE'),
    `${bigJump.state} · ${JSON.stringify(bigJump.blocks.map((b) => b.code))}`)

  /**
   * 🔴 **caller 문자열로 우회하지 못한다.** 전날 결정은 d1 인데 `trialBase: 'd3'` 이라
   *    적어 d5 를 열려는 시도다 — 기반 주장과 정본이 다르면 막는다.
   */
  const bypass = plan({
    sustained: 'd3', ceiling: 'd10', stage: 'd5', base: 'd3', prev: prevDecision('d1'),
  })
  check('🔴 🔴 **잘못된 전날 결정을 caller trialBase 문자열로 우회 → 차단**',
    bypass.state !== 'TRIAL' && hasPrev(bypass),
    `${bypass.state} · ${JSON.stringify(bypass.blocks.map((b) => b.code))}`)
  check('🔴 정본은 전날 결정이다 — env 문자열에서 기반을 만들지 않는다',
    !/trialBase[^\n]*SORAN_RELEASE_STAGE/.test(readFileSync('src/lib/stage-ladder.ts', 'utf-8')))
  check('🔴 다음 칸 계산은 정본 하나다', nextStage('d3') === 'd5' && nextStage('d10') === null)
}

console.log('\n⑭ 🔴 🔴 publisher 와 probe 실행 동등성 — 같은 fake store · 같은 runAt')
{
  /**
   * 🔴 **문자열 검사를 지웠다.** 두 파일에 같은 글자가 있는지가 아니라,
   *    **같은 입력에 같은 결과를 내는지**를 본다.
   *
   * 🔴 발행 러너는 `loadPublishableStock` 을 **실제로 부른다**(2026-09-24 리팩터링).
   *    그래서 여기서 그 함수를 한 번 돌리면, 러너와 probe 가 소비하는 값이 곧 이 값이다.
   */
  const runner = readFileSync('scripts/original-post-auto-publish.mts', 'utf-8')
  const probe = readFileSync('scripts/stage-decision-probe.mts', 'utf-8')
  /** 🔴 주석 처리·이름만 남기기를 막는다 — **import 와 호출과 소비**가 모두 있어야 한다 */
  const runnerCode = runner.split('\n')
    .filter((l) => !/^\s*(?:\*|\/\/|\/\*)/.test(l)).join('\n')
  check('🔴 🔴 **발행 러너가 공용 조립 함수를 실제로 호출하고 그 결과를 쓴다**',
    /import \{[^}]*loadPublishableStock[^}]*\} from '\.\/lib\/publishable-stock\.mjs'/.test(runnerCode)
    && /^const RUN_AT = new Date\(\)\s*$/m.test(runnerCode)
    && /const stock = await loadPublishableStock\(prisma, RUN_AT\)\s*$/m.test(runnerCode)
    // 🔴 러너의 시계는 하나다 — 단계마다 다른 `now` 를 쓰면 경계에서 답이 갈린다
    && runnerCode.split('\n').filter((l) => /new Date\(\)/.test(l)).length === 1
    && /const targets = stock\.targets/.test(runnerCode)
    && /const rejected = stock\.rejected/.test(runnerCode)
    && /stock\.queueCandidates/.test(runnerCode) && /stock\.publishedToday/.test(runnerCode)
    // 🔴 조립 결과가 판정 함수 둘로 **그대로** 흘러간다 — 러너가 중간에 다시 읽지 않는다
    && /resolvePublishScale\(\{ env: process\.env, loaded: stock, now: axisNow \}\)/.test(runnerCode)
    && /planPublishBatch\(\{ loaded: stock, caps: RELEASE_CAPS, at: axisNow \}\)/.test(runnerCode),
    runnerCode.split('\n').filter((l) => l.includes('stock.')).slice(0, 6).join(' | '))
  check('🔴 🔴 **러너 안에 별도 조립이 남아 있지 않다**',
    !/selectAutoTargets\(rows,/.test(runner)
    && !/const rows: AutoRow\[\] = raw\.map/.test(runner)
    && !/personaActivityLog\.findMany/.test(runner),
    [/selectAutoTargets\(rows,/, /const rows: AutoRow\[\] = raw\.map/, /personaActivityLog\.findMany/]
      .filter((re) => re.test(runner)).map(String).join(' | ') || '(남은 것 없음)')
  check('🔴 probe 도 같은 함수만 쓴다',
    /loadPublishableStock\(/.test(probe) && !/selectAutoTargets\(/.test(probe))
  /**
   * 🔴 **상한은 resolved scale 에서만 나온다** (2026-09-24 5차).
   *    `installFromEnv(process.env)` 를 직접 부르는 소비자가 있으면 bare env 로
   *    돌아간다 — 허가가 켜진 날 러너와 다른 상한을 쓰게 된다.
   */
  check('🔴 🔴 **러너와 probe 가 같은 resolvePublishScale 로 상한을 만든다**',
    /const resolved = resolvePublishScale\(\{ env: process\.env, loaded: stock, now: axisNow \}\)/.test(runner)
    && /const RELEASE_CAPS = resolved\.caps/.test(runner)
    && /resolvePublishScale\(\{ env: process\.env, loaded: s, now: NOW \}\)/.test(probe)
    && /const RELEASE_CAPS = resolved\.caps/.test(probe))
  /** 🔴 주석에 적힌 과거 사례는 세지 않는다 — **코드 줄**만 본다 */
  const codeLinesOf = (src: string): string => src.split('\n')
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
  check('🔴 🔴 **어느 쪽도 bare env 로 되돌아가지 않는다**',
    !/installFromEnv\(process\.env\)/.test(codeLinesOf(runner))
    && !/installFromEnv\(process\.env\)/.test(codeLinesOf(probe)),
    [runner, probe].filter((f) => /installFromEnv\(process\.env\)/.test(codeLinesOf(f))).length + '곳')
  /**
   * 🔴 **배정 계획도 러너가 공용 함수를 부른다.** 이 호출을 떼면 아래 fixture 검사가
   *    아니라 **이 줄**이 먼저 빨개진다 — 사본 비교가 아니라 실제 소비 경로다.
   */
  check('🔴 🔴 **러너가 planPublishBatch 를 부르고 그 결과만 쓴다**',
    /const plan = planPublishBatch\(\{ loaded: stock, caps: RELEASE_CAPS, at: axisNow \}\)/.test(runner)
    && /const assignOf = plan\.assignOf/.test(runner)
    && /const freshOrdered = plan\.freshOrdered/.test(runner)
    && /const brokenRecovery = plan\.brokenRecovery/.test(runner)
    && /\{ picked, recovered, skipped, waiting \} = plan/.test(runner)
    // 🔴 러너 안에 같은 계산이 다시 있으면 안 된다
    && !/prepareCandidates\(\{/.test(runner) && !/pickPublishTarget\(\{/.test(runner))

  /**
   * 🔴 **같은 함수를 두 번 부르는 것은 동등성 검사가 아니다** (2026-09-24 마스터 지적).
   *    핵심 분기를 실제로 갈리게 하는 fixture 를 만들고, **publisher 가 쓰는 계약**
   *    (`freshOrdered` · `brokenRecovery` 전체 중단 · `pickPublishTarget`)이
   *    `stageStock` 결과와 같은 답을 내는지 본다.
   */
  const RUN_AT = new Date('2026-09-24T09:00:00+09:00')
  const fresh = new Date(RUN_AT.getTime() - 2 * 864e5)
  const stale = new Date(RUN_AT.getTime() - 40 * 864e5)
  const qrow = (o: {
    id: string; persona?: string | null; captured: Date | null; gate?: string
    // 🔴 `null` 을 **명시적으로** 넘길 수 있어야 한다 — `?? 'founder'` 로 뭉개면
    //    "값이 없는 행" 을 사람 검토로 세는 결함을 fixture 가 표현하지 못한다
    decidedBy?: string | null; site?: string
  }) => ({
    id: o.id, status: 'APPROVED', createdPostId: null, gateVerdict: o.gate ?? 'PASS',
    promptVersion: 'publish-candidate-v1', model: 'human-curated',
    matchedPersonaId: o.persona ?? null,
    draftTitle: '오늘 있었던 작은 이야기',
    draftBody: '아침에 창을 열어 두었더니 바람이 선선했어요.\n다들 어떻게 지내시는지 궁금합니다.',
    editedTitle: null, editedBody: null, gateResults: {}, decidedBy: o.decidedBy === undefined ? 'founder' : o.decidedBy,
    decidedAt: RUN_AT, createdAt: fresh,
    rawContent: { sourceSite: o.site ?? 'publish-candidate:test', sourceCapturedAt: o.captured },
  })
  const prow = (code: string, id: string, o: Record<string, unknown> = {}) => ({
    id, code, status: 'active',
    identity: {
      ageBand: '50대 초반', maritalStatus: '기혼', childrenCount: 1,
      childrenAgeBands: ['성인'], parentCare: '없음', menopauseStatus: '진행중',
      region: '수도권', lifeStage: '양육기', ...o,
    },
    voiceCore: { length: '중간' }, noGoTopics: [],
    user: { providerId: null, _count: { accounts: 0 } },
  })
  const fakeOf = (qrows: unknown[], prows: unknown[]) => ({
    originalPostApprovalQueue: {
      findMany: async () => qrows, count: async () => 0, findFirst: async () => null,
    },
    persona: { findMany: async () => prows },
    personaActivityLog: { findMany: async () => [], count: async () => 0 },
  } as never)
  const CAPS = { postsPerWeek: 3, minDaysBetween: 1 }

  /**
   * 🔴 **검사는 러너 계산을 베끼지 않는다** (2026-09-24 5차 · 마스터 지적).
   *    앞판은 `prepareCandidates → freshOrdered → brokenRecovery → pickPublishTarget`
   *    을 검사 안에 **복사**해 두고 결과를 비교했다. 사본은 러너가 바뀌어도 함께
   *    바뀌지 않는다 — 갈라진 순간부터 조용히 거짓 초록이 된다.
   *    🔴 지금은 **러너가 부르는 그 함수**(`planPublishBatch`)를 직접 부른다.
   */
  const core = (loaded: Awaited<ReturnType<typeof loadPublishableStock>>, caps = CAPS) =>
    planPublishBatch({ loaded, caps, at: RUN_AT })

  /** ── ⓐ fresh 하지만 배정 불가 · TTL hold · 임의 decidedBy 가 섞인 경우 ── */
  {
    const qrows = [
      qrow({ id: 'a-ok', persona: 'p1', captured: fresh }),
      // 🔴 `isRecovery` 는 배정 유무로 갈린다(supply-candidates.ts) — 배정 없는 상한 행만 TTL_EXPIRED 다
      qrow({ id: 'b-ttl', persona: null, captured: stale }),
      qrow({ id: 'c-unknown-age', persona: null, captured: null }),
      qrow({ id: 'h-recovery-stale', persona: 'p1', captured: stale }),
      qrow({ id: 'd-gate', persona: 'p1', captured: fresh, gate: 'HOLD' }),
      qrow({ id: 'e-legacy', persona: 'p1', captured: fresh, site: 'legacy:x' }),
      qrow({ id: 'f-odd', persona: 'p1', captured: fresh, decidedBy: 'someone-else' }),
      qrow({ id: 'g-machine', persona: 'p1', captured: fresh, decidedBy: 'machine:auto-draft-v5' }),
    ]
    const loaded = await loadPublishableStock(fakeOf(qrows, [prow('P01', 'p1')]), RUN_AT)
    const st = stageStock({ loaded, caps: CAPS, at: RUN_AT })
    const c = core(loaded)

    check('🔴 🔴 **nextPickedId 가 publisher 계산과 같다**',
      st.nextPickedId === c.nextPickedId, `stage=${st.nextPickedId} core=${c.nextPickedId}`)
    check('🔴 🔴 **freshnessPassed 가 publisher 의 freshOrdered 와 같다**',
      st.freshnessPassed.ids.join(',') === c.freshOrdered.map((t) => t.id).join(','),
      `${st.freshnessPassed.ids.join(',')} vs ${c.freshOrdered.map((t) => t.id).join(',')}`)
    const reasons = st.holdsByReason.map((h) => h.reason).sort().join(',')
    check('🔴 🔴 **세 hold 가 닫힌 enum 값으로 각각 구분돼 나온다**',
      reasons === 'AGE_UNKNOWN,RECOVERY_STALE,TTL_EXPIRED'
      && st.holdsByReason.every((h) => h.count === h.ids.length && h.count > 0),
      JSON.stringify(st.holdsByReason.map((h) => `${h.reason}:${h.ids.join('/')}`)))
    check('🔴 🔴 **hold 된 행은 freshnessPassed 에 들어가지 않는다**',
      st.holdsByReason.flatMap((h) => h.ids).every((id) => !st.freshnessPassed.ids.includes(id)),
      `hold=${st.holdsByReason.flatMap((h) => h.ids).join(',')} fresh=${st.freshnessPassed.ids.join(',')}`)
    check('🔴 🔴 **여섯 수가 서로 다르다 — 단계가 실제로 갈린다**',
      st.selectorTargets.count < st.queueTotal
      && st.freshnessPassed.count < st.selectorTargets.count,
      `queue=${st.queueTotal} selector=${st.selectorTargets.count}`
      + ` fresh=${st.freshnessPassed.count} assigned=${st.successfullyAssigned.count}`
      + ` runnable=${st.assignmentReady.count} picked=${st.nextPickedId}`)
    check('🔴 🔴 **임의 decidedBy 는 사람 검토로 세지 않는다**',
      loaded.humanReviewed === qrows.filter((r) => r.decidedBy === 'founder').length
      && loaded.humanReviewed
        < qrows.filter((r) => !String(r.decidedBy).startsWith('machine:')).length,
      `humanReviewed=${loaded.humanReviewed}`)
    check('🔴 Persona 생활사 값이 조립에 실린다',
      (loaded.personas[0] as Record<string, unknown>)?.voiceLength === '중간'
      && (loaded.personas[0] as Record<string, unknown>)?.menopauseStatus === '진행중')
  }

  /** ── ⓑ fresh 한데 Persona 가 없어 배정이 불가능한 경우 ── */
  {
    const qrows = [qrow({ id: 'x-fresh', persona: null, captured: fresh })]
    const loaded = await loadPublishableStock(fakeOf(qrows, []), RUN_AT)
    const st = stageStock({ loaded, caps: CAPS, at: RUN_AT })
    const c = core(loaded)
    check('🔴 🔴 **fresh 하지만 배정 불가면 successfullyAssigned 에 들어가지 않는다**',
      st.freshnessPassed.count >= 0 && st.successfullyAssigned.count === 0,
      `fresh=${st.freshnessPassed.count} assigned=${st.successfullyAssigned.count}`)
    check('🔴 🔴 **그때 runnableNow 도 0 이고 nextPickedId 는 null 이다**',
      st.assignmentReady.count === 0 && st.nextPickedId === null && c.nextPickedId === null,
      `runnable=${st.assignmentReady.count} picked=${st.nextPickedId} core=${c.nextPickedId}`)
    check('🔴 🔴 **assigned=null 인 assignment 를 배정 성공으로 세지 않는다**',
      !st.successfullyAssigned.ids.includes('x-fresh'), st.successfullyAssigned.ids.join(','))
  }

  /** ── ⓖ 🔴 **resolver 는 전역을 건드리지 않는다** ── */
  {
    /**
     * 🔴 앞판 `resolvePublishScale` 은 "순수 함수다" 라고 적어 두고 `installFromEnv`
     *    를 불렀다 — 그 함수는 `applyScale` 로 **module-global `installed`** 를 바꾼다.
     *    그래서 probe 나 이 검사를 돌리기만 해도 프로세스의 `activeScale()` 이 바뀌었다.
     */
    const qrows = [qrow({ id: 'g-1', persona: null, captured: fresh })]
    const loaded = await loadPublishableStock(fakeOf(qrows, [prow('P01', 'p1')]), RUN_AT)
    const before = activeScale()
    const r = resolvePublishScale({
      env: { SORAN_CAPACITY_STAGE: 'd10', SORAN_RELEASE_STAGE: 'd10' }, loaded, now: RUN_AT,
    })
    const after = activeScale()
    check('🔴 🔴 **resolver 호출이 activeScale 을 바꾸지 않는다**',
      after === before && after.releaseStage === before.releaseStage,
      `before=${before.releaseStage} after=${after.releaseStage} resolved=${r.scale.releaseStage}`)
    check('🔴 🔴 **계산 결과는 전역과 다를 수 있다 — 그래서 설치가 따로다**',
      r.scale.capacityStage === 'd10' && before.releaseStage !== 'd10',
      `resolved=${r.scale.capacityStage} global=${before.releaseStage}`)
    check('🔴 🔴 **공용 조립 파일은 installFromEnv 를 쓰지 않는다**', (() => {
      const stockSrc = readFileSync('scripts/lib/publishable-stock.mts', 'utf-8')
        .split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
      return !/installFromEnv\(/.test(stockSrc) && /resolveScale\(/.test(stockSrc)
    })())
    /** 🔴 설치는 **실제로 발행하는 러너**만, 정확히 한 번 */
    const runnerSrc = readFileSync('scripts/original-post-auto-publish.mts', 'utf-8')
      .split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
    check('🔴 🔴 **publisher 만 applyScale 로 정확히 한 번 설치한다**',
      (runnerSrc.match(/applyScale\(/g) ?? []).length === 1
      && /applyScale\(resolved\.scale\)/.test(runnerSrc),
      `${(runnerSrc.match(/applyScale\(/g) ?? []).length}회`)
    check('🔴 🔴 **probe 는 설치하지 않는다 — 관제가 전역을 바꾸면 안 된다**',
      !/applyScale\(/.test(readFileSync('scripts/stage-decision-probe.mts', 'utf-8')))
  }

  /** ── ⓔ 🔴 **허가로 단계가 열리는 날 — bare env 를 쓰면 갈린다** ── */
  {
    /**
     * 🔴 앞판 probe 는 `installFromEnv(process.env)` 만 불렀다(= bare env).
     *    러너는 readiness·canary·window 를 넣어 설치한다. 아래가 그 차이가
     *    **실제로 다른 상한·다른 배정**을 만드는 반례다.
     */
    const qrows = Array.from({ length: 40 }, (_, i) =>
      qrow({ id: `q${String(i).padStart(2, '0')}`, persona: null, captured: fresh }))
    const prows = Array.from({ length: 30 }, (_, i) => prow(`P${String(i).padStart(2, '0')}`, `p${i}`))
    const loaded = await loadPublishableStock(fakeOf(qrows, prows), RUN_AT)
    const BASE = { SORAN_CAPACITY_STAGE: 'd5', SORAN_RELEASE_STAGE: 'd1' }
    const at = (env: Record<string, string>) => {
      const r = resolvePublishScale({ env, loaded, now: RUN_AT })
      return { r, plan: core(loaded, r.caps) }
    }
    const bare = at(BASE)
    const canary = at({ ...BASE, SORAN_RELEASE_CANARY_STAGE: 'd3', SORAN_RELEASE_CANARY_DATE: '2026-09-24' })

    check('🔴 🔴 **허가가 없으면 d1 이다 — 여기까지는 bare env 와 같다**',
      bare.r.scale.releaseStage === 'd1' && bare.r.caps.postsPerWeek === 1
      && bare.r.caps.minDaysBetween === 5,
      `${bare.r.scale.releaseStage} 주${bare.r.caps.postsPerWeek} 최소${bare.r.caps.minDaysBetween}`)
    check('🔴 🔴 **하루 허가가 켜지면 같은 DB·같은 시각인데 d3 가 설치된다**',
      canary.r.scale.releaseStage === 'd3' && canary.r.dailyCap === 3,
      `${canary.r.scale.releaseStage} 일${canary.r.dailyCap}`)
    check('🔴 🔴 **그때 상한이 달라진다 — bare env 로는 이 값을 낼 수 없다**',
      canary.r.caps.postsPerWeek === 3 && canary.r.caps.minDaysBetween === 2
      && canary.r.caps.postsPerWeek !== bare.r.caps.postsPerWeek,
      `bare 주${bare.r.caps.postsPerWeek}/최소${bare.r.caps.minDaysBetween}`
      + ` vs canary 주${canary.r.caps.postsPerWeek}/최소${canary.r.caps.minDaysBetween}`)
    check('🔴 🔴 **상한이 다르면 배정 수도 다르다 — 재고가 갈린다**',
      canary.plan.assignmentReady.length > bare.plan.assignmentReady.length
      && bare.plan.assignmentReady.length === 30 && canary.plan.assignmentReady.length === 40,
      `bare ${bare.plan.assignmentReady.length}건 vs canary ${canary.plan.assignmentReady.length}건`)
    check('🔴 🔴 **같은 resolved scale 을 주면 probe 와 publisher 가 같은 picked 를 낸다**',
      stageStock({ loaded, caps: canary.r.caps, at: RUN_AT }).nextPickedId === canary.plan.nextPickedId
      && stageStock({ loaded, caps: canary.r.caps, at: RUN_AT }).assignmentReady.count
        === canary.plan.freshOrdered.filter((t) =>
          (canary.plan.assignOf.get(t.id)?.assigned ?? null) !== null).length,
      `${canary.plan.nextPickedId}`)
    // 🔴 기간 허가는 최대 7일이다(WINDOW_MAX_DAYS) — 그보다 길면 열리지 않는다
    const wLong = at({ ...BASE, SORAN_RELEASE_WINDOW_STAGE: 'd3',
      SORAN_RELEASE_WINDOW_FROM: '2026-09-20', SORAN_RELEASE_WINDOW_UNTIL: '2026-09-30' })
    check('🔴 7일을 넘는 기간 허가는 열리지 않는다 — 잊고 두는 것을 막는다',
      wLong.r.scale.releaseStage === 'd1' && wLong.r.windowAuth.activeToday === false,
      `${wLong.r.scale.releaseStage} · ${wLong.r.windowAuth.note ?? ''}`)
  }

  /** ── ⓕ 🔴 **기계 지표 두 축을 섞지 않는다** ── */
  {
    const qrows = [
      // 🔴 기계가 만든 행 — decidedBy 가 machine:
      qrow({ id: 'm-made', persona: null, captured: fresh, decidedBy: 'machine:auto-draft-v5' }),
      // 🔴 사람이 넣었지만 machine profile 계약에는 맞는 행
      qrow({ id: 'h-made', persona: null, captured: fresh, decidedBy: 'founder' }),
      // 🔴 어느 축에도 들어가지 않는 행 — 기계도 아니고 사람 검토도 아니다
      qrow({ id: 'x-odd', persona: null, captured: fresh, decidedBy: 'someone-else' }),
      qrow({ id: 'y-null', persona: null, captured: fresh, decidedBy: null }),
    ]
    const loaded = await loadPublishableStock(fakeOf(qrows, [prow('P01', 'p1')]), RUN_AT)
    check('🔴 🔴 **`decidedBy=machine:` 인 행만 "기계가 만든 행" 으로 센다**',
      loaded.machineDecided === 1, `machineDecided=${loaded.machineDecided}`)
    check('🔴 🔴 **profile 유효 수는 그것과 다른 축이다 — 같은 이름으로 부르지 않는다**',
      loaded.machineProfiled !== loaded.machineDecided
      || loaded.machineProfiled === 0,
      `machineProfiled=${loaded.machineProfiled} machineDecided=${loaded.machineDecided}`)
    check('🔴 🔴 **사람 검토는 `founder` 1건뿐 — 임의 문자열도 null 도 세지 않는다**',
      loaded.humanReviewed === 1 && loaded.queueTotal === 4,
      `humanReviewed=${loaded.humanReviewed} queueTotal=${loaded.queueTotal}`)
    check('🔴 🔴 **세 축을 합쳐도 전체가 되지 않는다 — 서로 다른 질문이다**',
      loaded.machineDecided + loaded.humanReviewed < loaded.queueTotal,
      `machine=${loaded.machineDecided} human=${loaded.humanReviewed} total=${loaded.queueTotal}`)
  }

  /** ── ⓓ 질의 순서와 발행 순서가 실제로 갈리는 경우 ── */
  {
    // 🔴 DB 질의 순서는 비복구 먼저지만, 발행은 **복구 행이 먼저**다(priorityTierOf).
    //    정렬을 지우면 이 fixture 에서 답이 바뀐다 — 그래서 여기서만 변이가 잡힌다.
    const qrows = [
      qrow({ id: 'n-plain', persona: null, captured: fresh }),
      qrow({ id: 'r-recovery', persona: 'p2', captured: fresh }),
    ]
    const loaded = await loadPublishableStock(
      fakeOf(qrows, [prow('P01', 'p1'), prow('P02', 'p2')]), RUN_AT)
    const st = stageStock({ loaded, caps: CAPS, at: RUN_AT })
    const c = core(loaded)
    check('🔴 🔴 **질의 순서와 발행 순서가 다르다 — 복구 행이 앞선다**',
      st.selectorTargets.ids.join(',') === 'n-plain,r-recovery'
      && st.freshnessPassed.ids.join(',') === 'r-recovery,n-plain',
      `selector=${st.selectorTargets.ids.join(',')} fresh=${st.freshnessPassed.ids.join(',')}`)
    check('🔴 🔴 **그 순서로 publisher 와 같은 한 건을 고른다**',
      st.nextPickedId === 'r-recovery' && c.nextPickedId === 'r-recovery'
      && st.assignmentReady.ids.join(',') === 'r-recovery,n-plain',
      `stage=${st.nextPickedId} core=${c.nextPickedId} runnable=${st.assignmentReady.ids.join(',')}`)
  }

  /** ── ⓒ broken recovery 하나 때문에 전체가 중단되는 경우 ── */
  {
    // 🔴 배정된 persona 가 목록에 없다 → recoveryProblem 이 생긴다
    const qrows = [
      qrow({ id: 'r-broken', persona: 'ghost', captured: fresh }),
      qrow({ id: 'r-ok', persona: 'p1', captured: fresh }),
    ]
    const loaded = await loadPublishableStock(fakeOf(qrows, [prow('P01', 'p1')]), RUN_AT)
    const st = stageStock({ loaded, caps: CAPS, at: RUN_AT })
    const c = core(loaded)
    check('🔴 🔴 **배정이 깨진 행을 값으로 낸다**',
      st.brokenRecovery.length === c.brokenRecovery.length && st.brokenRecovery.length > 0,
      `${JSON.stringify(st.brokenRecovery)} vs ${JSON.stringify(c.brokenRecovery)}`)
    check('🔴 🔴 **하나만 깨져도 runnableNow 는 0 이다 — publisher 는 전체 중단한다**',
      st.assignmentReady.count === 0 && st.nextPickedId === null,
      `runnable=${st.assignmentReady.count} picked=${st.nextPickedId}`)
    check('🔴 그때도 publisher core 와 같은 답이다',
      st.nextPickedId === c.nextPickedId)
  }
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 순수 함수 검사다 — 러너가 이 결정을 쓰는 **배선은 아직 없다**.')
console.log('🔴 migration 0 · DB write 0. 실제 운영 조립은 `stage:probe` 가 따로 한다.\n')
if (fail > 0) process.exit(1)
