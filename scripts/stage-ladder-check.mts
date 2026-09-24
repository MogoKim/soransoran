#!/usr/bin/env tsx
/**
 * 🔴 **자동 단계 사다리 — 정본 조립 경로 검사** (2026-09-24 3차 재작성)
 *
 *    앞판은 `ready=true` verdict 를 **손으로 만들어** 넣었다. 그것은 운영 사실이 아니다.
 *    지금은 실제 queue·Persona 로 정본을 돌려 판정을 만든다:
 *    ```
 *    simulateStage(days:14) → judgeReadiness → stageVerdicts   지속 readiness
 *    simulateStage(days:1)  → judgeOneDayCanary                하루 시험
 *    judgePromotion                                            지속 승격 / 사전 준비
 *    ```
 * 🔴 DB 0 · 네트워크 0 · 파일 write 0 · LLM 0.
 */
import { readFileSync } from 'node:fs'

import {
  planStageDecision, safestDecision, STAGE_DECISION_VERSION, TRANSITION_STATES,
} from '../src/lib/stage-ladder'
import { reconcileStageSources, sameStageSnapshot, type StageSnapshot } from '../src/lib/stage-source'
import { PROFILES, RELEASE_STAGES, SAFEST_STAGE } from '../src/lib/scale-profile'
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
const CAPTURED = new Date(NOW.getTime() - 3 * 86_400_000)
const N = ['아침 산책', '무릎 이야기', '김장 준비', '동네 마실', '주말 반찬']
/** 🔴 기존 검사와 같은 모양의 후보 fixture */
const q = (n: number): QueueCandidate[] => Array.from({ length: n }, (_, i) => ({
  queueId: `q-${String(i).padStart(3, '0')}`, title: `${N[i % N.length]} (${i})`,
  body: `${N[i % N.length]}\n\n있었던 소소한 이야기를 적어 봅니다. ${i}번째 글이에요.`,
  gateVerdict: 'PASS', createdAt: i, assignedPersonaCode: null,
  voice: null, profile: 'human' as const, capturedAt: CAPTURED,
}))
const POOL = parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8'))
const PERSONAS = POOL.cards.filter((c) => c.voiceLength !== null).map(cardToPersona)

/** 🔴 **정본 조립 — 손으로 verdict 를 만들지 않는다** */
const assemble = (o: { stock: number; publishedToday: number; personas?: number }) => {
  const personas = PERSONAS.slice(0, o.personas ?? PERSONAS.length)
  const queue = q(o.stock)
  const axis = { now: NOW, publishedToday: o.publishedToday }
  const verdicts = stageVerdicts({ queue, personas, axis })
  const oneDay = (stage: (typeof RELEASE_STAGES)[number]) => {
    const p = PROFILES[stage]
    const slotsLeft = Math.max(0, p.dailyTarget - o.publishedToday)
    const sim = simulateStage({
      stage, queue, personas, axis, days: 1, anchor: 'now',
      dailyCap: slotsLeft,
    })
    return judgeOneDayCanary(sim, { publishedToday: o.publishedToday, slotsLeft })
  }
  return { verdicts, oneDay, queue, personas, axis }
}

/** 🔴 정본 `judgePromotion` 입력 — 재지 못한 값은 `null` 이다 */
const promo = (o: Partial<PromotionInput> & { current: PromotionInput['current']; next: PromotionInput['next'] }) =>
  judgePromotion({
    readyStock: null, activePersonas: null, detailPerDay: null,
    readyQualifiedPerDay: null, readyStockDeltaPerDay: null,
    currentStableStreakDays: null, publishRunnerReady: true, commentRunnerReady: true,
    publishedPerDay: null, currentLimitsActive: true, ...o,
  })

console.log('\n══ 자동 단계 사다리 — 정본 조립 (DB 0 · 네트워크 0) ══')

console.log('\n① 🔴 새 규칙·새 숫자를 만들지 않았다 — 정본 넷만 소비한다')
{
  const codeOnly = (f: string): string => readFileSync(f, 'utf-8')
    .split('\n').filter((l) => !/^\s*(?:\*|\/\/|\/\*)/.test(l)).join('\n')
  const src = codeOnly('src/lib/stage-ladder.ts')
  check('🔴 🔴 **새 문턱값이 없다 (STAGE_REQUIREMENTS · 재고/화자/연속일 상수)**',
    !/STAGE_REQUIREMENTS|goodDaysToEnter|readyStock:\s*\d|eligibleSpeakers\s*[<>]/.test(src))
  check('🔴 🔴 **전역 감속(hardBlocks · auditPending)이 없다**', !/hardBlocks|auditPending/.test(src))
  check('🔴 정본 넷을 전부 소비한다', (() => {
    const t = readFileSync('src/lib/stage-ladder.ts', 'utf-8')
    return /judgeOneDayCanary/.test(t) && /judgePromotion/.test(t)
      && /StageVerdict/.test(t) && /safeStageFor/.test(t)
  })())
  check('🔴 DB·네트워크·파일을 모른다', !/from 'node:fs'|prisma|fetch\(/.test(src))
  check('🔴 전환 상태가 넷이다', TRANSITION_STATES.join(',') === 'SUSTAIN,TRIAL,PREPARE,HOLD')
}

console.log('\n② 🔴 🔴 반례 A — D3 공개 중 capacity D5 로 재고를 준비한다 (PREPARE)')
{
  const a = assemble({ stock: 140, publishedToday: 0 })
  const d = planStageDecision({
    kstDate: '2026-09-24', currentRelease: 'd3', currentCapacity: 'd3',
    verdicts: a.verdicts, today: null,
    // 🔴 지속 승격은 아직(stable 미달) · 다음 단계 사전 준비는 끝났다
    promotion: promo({
      current: 'd3', next: 'd5',
      readyStock: 9999, activePersonas: 999, detailPerDay: 999,
      readyQualifiedPerDay: 999, readyStockDeltaPerDay: 5,
      currentStableStreakDays: 0,
    }),
    publishedToday: 0, decidedAt: AT,
  })
  check('🔴 🔴 **공개는 d3 유지 · 생산 눈금만 d5 로 올라간다**',
    d.release === 'd3' && d.capacity === 'd5' && d.state === 'PREPARE',
    `release=${d.release} capacity=${d.capacity} state=${d.state} · ${d.reasons.join(' | ')}`)
  check('🔴 두 값이 다르다 — 늘 같은 stage 를 돌려주지 않는다', d.release !== d.capacity)
}

console.log('\n③ 🔴 🔴 반례 B — 지속 미달 + 하루 canary GO → 그날만 D5 (TRIAL)')
{
  const a = assemble({ stock: 12, publishedToday: 0 })
  const today = a.oneDay('d5')
  const sustain = a.verdicts.find((v) => v.stage === 'd5')?.ready === true
  check('🔴 정본 지속 readiness 는 d5 미달이다 (손으로 만든 값이 아니다)',
    !sustain, `d5 ready=${sustain}`)
  check('🔴 정본 하루 판정은 GO 다', today.ok, JSON.stringify(today.reasons))
  const d = planStageDecision({
    kstDate: '2026-09-24', currentRelease: 'd3', currentCapacity: 'd5',
    verdicts: a.verdicts, today,
    promotion: promo({ current: 'd3', next: 'd5', currentStableStreakDays: 0 }),
    publishedToday: 0, decidedAt: AT,
  })
  check('🔴 🔴 **그날만 d5 로 낸다 — 지속 미달이 하루 시험을 막지 않는다**',
    d.release === 'd5' && d.state === 'TRIAL',
    `release=${d.release} state=${d.state} · ${d.reasons.join(' | ')}`)
  check('🔴 "오늘만" 이라고 값으로 말한다',
    d.reasons.some((r) => r.includes('오늘만')), d.reasons.join(' | '))
}

console.log('\n④ 🔴 🔴 반례 C — 다음 날 canary 없음 + 지속 승격 미달 → D3 복귀')
{
  const a = assemble({ stock: 12, publishedToday: 0 })
  const d = planStageDecision({
    kstDate: '2026-09-25', currentRelease: 'd5', currentCapacity: 'd5',
    verdicts: a.verdicts, today: null,
    promotion: promo({ current: 'd5', next: 'd10', currentStableStreakDays: 0 }),
    publishedToday: 0, decidedAt: AT,
  })
  check('🔴 🔴 **하루 허가가 없으면 지속 판정으로 돌아간다 — d5 를 이어 가지 않는다**',
    d.release !== 'd5' && d.state === 'HOLD',
    `release=${d.release} state=${d.state} · ${d.reasons.join(' | ')}`)
  /**
   * 🔴 정본이 낸 문구를 그대로 싣는다. 재고가 얕으면 `safeStageFor` 는
   *    "감속" 이 아니라 **"어느 단계도 준비되지 않았다"** 를 낸다 — 둘 다 정본 문구다.
   */
  check('🔴 감속 근거는 정본 `safeStageFor` 가 낸 문구다',
    d.reasons.some((r) => r.includes('감속') || r.includes('어느 단계도 준비되지 않았다')),
    d.reasons.join(' | '))
}

console.log('\n⑤ 🔴 🔴 반례 D — 실제 9/24: 4건 발행 + P02 1건 → D5 유지 · 5번째 가능')
{
  const a = assemble({ stock: 12, publishedToday: 4 })
  const today = a.oneDay('d5')
  check('🔴 정본 하루 판정이 GO 다 (실제 상태로 조립)', today.ok,
    `need=${today.need} can=${today.can} ${today.reasons.join(' / ')}`)
  const d = planStageDecision({
    kstDate: '2026-09-24', currentRelease: 'd5', currentCapacity: 'd5',
    verdicts: a.verdicts, today,
    promotion: promo({ current: 'd5', next: 'd10', currentStableStreakDays: 0 }),
    publishedToday: 4, decidedAt: AT,
    supply: {
      eligibleSpeakers: 1,
      excluded: [
        { reason: 'noOpenDay', codes: ['P03', 'P04', 'P05', 'P08', 'P10', 'P11', 'P15', 'P16', 'P17', 'P18', 'P19', 'P20', 'P21', 'P22', 'P23', 'P24', 'P25'] },
        { reason: 'holdingStock', codes: ['P01', 'P02', 'P06', 'P07', 'P12', 'P13'] },
      ],
    },
  })
  check('🔴 🔴 **D5 유지**', d.release === 'd5',
    `release=${d.release} state=${d.state} · ${d.reasons.join(' | ')}`)
  check('🔴 🔴 **다섯 번째 발행이 가능하다 (상한 5 > 이미 4건)**',
    PROFILES[d.release].dailyTarget > 4)
  check('🔴 🔴 **공급 화자 1명이 결정 근거에 들어가지 않는다**',
    d.supply?.eligibleSpeakers === 1 && !d.reasons.some((r) => r.includes('화자')),
    d.reasons.join(' | '))
}

console.log('\n⑥ 🔴 🔴 반례 E — 새 KST 날짜에 판정 없음 → d1')
{
  const d = planStageDecision({
    kstDate: '2026-09-25', currentRelease: 'd5', currentCapacity: 'd5',
    verdicts: [], today: null, promotion: null, publishedToday: 0, decidedAt: AT,
  })
  check('🔴 🔴 **빈 verdict 를 근거로 D5 를 이어 가지 않는다 — d1 fail-closed**',
    d.release === SAFEST_STAGE && d.capacity === SAFEST_STAGE,
    `${d.release}/${d.capacity} · ${d.reasons.join(' | ')}`)
  check('🔴 아무것도 못 읽으면 가장 안전한 단계다',
    safestDecision('2026-09-25', AT).release === SAFEST_STAGE)
  /** 🔴 같은 날 이미 낸 수가 하위 상한을 넘으면 그날만 고정 */
  const a = assemble({ stock: 0, publishedToday: 4 })
  const pinned = planStageDecision({
    kstDate: '2026-09-24', currentRelease: 'd5', currentCapacity: 'd5',
    verdicts: a.verdicts, today: null,
    promotion: promo({ current: 'd5', next: 'd10' }),
    publishedToday: 4, decidedAt: AT,
  })
  check('🔴 🔴 **이미 4건 냈으면 그날은 d5 를 고정한다**',
    pinned.release === 'd5' && pinned.dayPinned,
    `${pinned.release} pinned=${pinned.dayPinned} · ${pinned.reasons.join(' | ')}`)
}

console.log('\n⑦ 🔴 🔴 반례 F — 공급 생성 화자 1명이 발행 배정과 섞이지 않는다')
{
  const caps = [
    { code: 'P14', openDays: 1, readyCount: 0 },
    { code: 'P10', openDays: 0, readyCount: 0 },
    { code: 'P02', openDays: 1, readyCount: 1 },
  ]
  check('🔴 P10 은 공급 여력 0 (열린날 0) — 그래도 9/24 15:49 에 발행됐다',
    remainingCapacity(caps[1]!) === 0)
  check('🔴 P02 도 공급 여력 0 (재고 보유) — 그래도 발행 가능했다',
    remainingCapacity(caps[2]!) === 0)
  check('공급 계획은 여력 있는 한 명만 남긴다',
    planSpeakerAvailability({ sourceKeys: ['s1'], capacities: caps }).eligible.join(',') === 'P14')
  const noOpen = caps.filter((c) => c.openDays === 0).map((c) => c.code)
  const holding = caps.filter((c) => c.openDays > 0 && c.readyCount >= c.openDays).map((c) => c.code)
  check('🔴 🔴 **제외 사유가 둘로 갈린다 — 열린날 0 vs 재고 보유**',
    noOpen.join(',') === 'P10' && holding.join(',') === 'P02')
  const ladder = readFileSync('src/lib/stage-ladder.ts', 'utf-8')
  check('🔴 🔴 **결정기는 `eligibleSpeakers` 를 조건으로 쓰지 않는다**',
    !/eligibleSpeakers\s*[<>=]/.test(ladder))
}

console.log('\n⑧ 🔴 release 는 capacity 를 넘지 못한다')
{
  const a = assemble({ stock: 140, publishedToday: 0 })
  const d = planStageDecision({
    kstDate: '2026-09-24', currentRelease: 'd5', currentCapacity: 'd1',
    verdicts: a.verdicts, today: a.oneDay('d5'),
    promotion: promo({ current: 'd5', next: 'd10' }), publishedToday: 0, decidedAt: AT,
  })
  check('🔴 🔴 **공개가 생산 눈금을 넘으면 생산 눈금을 맞춘다**',
    d.capacity === d.release, `release=${d.release} capacity=${d.capacity}`)
  check('그 사실을 값으로 남긴다',
    d.reasons.some((r) => r.includes('생산 눈금')), d.reasons.join(' | '))
}

console.log('\n⑨ 🔴 진단 도구는 사다리에 연결되지 않는다')
{
  const r = reconcileStageSources({
    canonical: { SORAN_CAPACITY_STAGE: 'd3', SORAN_RELEASE_STAGE: 'd1' },
    github: { SORAN_CAPACITY_STAGE: 'd5', SORAN_RELEASE_STAGE: 'd1' },
  })
  check('🔴 2026-09-24 실측 불일치를 값으로 잡는다', r.conflicts.length === 1)
  check('🔴 🔴 **사다리는 `reconcileStageSources` 를 부르지 않는다 — 진단 도구다**',
    !/reconcileStageSources/.test(readFileSync('src/lib/stage-ladder.ts', 'utf-8')))
  const S = (o: Partial<StageSnapshot>): StageSnapshot => ({
    kstDate: '2026-09-24', capacity: 'd5', release: 'd1', decidedBy: 'supply', decidedAt: AT, ...o,
  })
  check('공급·발행이 같은 값을 보면 통과', sameStageSnapshot(S({}), S({ decidedBy: 'publish' })).ok)
  check('🔴 다르면 막는다', !sameStageSnapshot(S({}), S({ decidedBy: 'publish', capacity: 'd3' })).ok)
}

console.log('\n⑩ 🔴 결정 하나에 날짜·두 눈금·상태·근거·시각·계약 판이 남는다')
{
  const a = assemble({ stock: 140, publishedToday: 0 })
  const d = planStageDecision({
    kstDate: '2026-09-24', currentRelease: 'd3', currentCapacity: 'd3',
    verdicts: a.verdicts, today: a.oneDay('d3'),
    promotion: promo({ current: 'd3', next: 'd5' }), publishedToday: 0, decidedAt: AT,
  })
  check('여섯 칸이 모두 있다',
    d.kstDate === '2026-09-24' && d.capacity !== undefined && d.release !== undefined
    && TRANSITION_STATES.includes(d.state) && d.reasons.length > 0
    && d.decidedAt === AT && d.contractVersion === STAGE_DECISION_VERSION)
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 순수 함수 검사다 — 러너가 이 결정을 쓰는 **배선은 아직 없다**.')
console.log('🔴 authoritative 저장은 구현하지 않았다 — 제안만 보고했다(migration 0 · DB write 0).\n')
if (fail > 0) process.exit(1)
