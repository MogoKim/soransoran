#!/usr/bin/env tsx
/**
 * 🔴 **자동 단계 사다리 — 정본 재사용 검사** (2026-09-24 재작성)
 *
 *    앞판(088b134)은 새 규율(`STAGE_REQUIREMENTS` · 전역 감속)을 만들고
 *    **그 규칙이 자기 자신과 맞는지**만 봤다. 지금은 정본
 *    `simulateStage → judgeReadiness → stageVerdicts` 와 `safeStageFor` 를 그대로 쓰고,
 *    단계 부족은 **실제 배정 시뮬레이션**(TTL·주 cap·최소 간격·생활사·Persona 배정)으로 본다.
 *
 * 🔴 DB 0 · 네트워크 0 · 파일 write 0 · LLM 0.
 */
import { readFileSync } from 'node:fs'

import { planStageDecision, safestDecision, STAGE_DECISION_VERSION } from '../src/lib/stage-ladder'
import {
  reconcileStageSources, sameStageSnapshot, SHARED_STAGE_KEYS, PUBLISH_ONLY_KEYS,
  type StageSnapshot,
} from '../src/lib/stage-source'
import { PROFILES, RELEASE_STAGES, SAFEST_STAGE, type ReleaseStage } from '../src/lib/scale-profile'
import { simulateStage, judgeReadiness, stageVerdicts } from '../src/lib/scale-readiness'
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

const NOW = new Date('2026-09-24T08:30:00+09:00')
const AT = NOW.toISOString()
const CAPTURED = new Date(NOW.getTime() - 3 * 86_400_000)
const N = ['아침 산책', '무릎 이야기', '김장 준비', '동네 마실', '주말 반찬']
/** 🔴 기존 검사와 **같은 모양**의 후보 fixture — 여기서 새로 만들지 않는다 */
const q = (n: number): QueueCandidate[] => Array.from({ length: n }, (_, i) => ({
  queueId: `q-${String(i).padStart(3, '0')}`, title: `${N[i % N.length]} (${i})`,
  body: `${N[i % N.length]}\n\n있었던 소소한 이야기를 적어 봅니다. ${i}번째 글이에요.`,
  gateVerdict: 'PASS', createdAt: i, assignedPersonaCode: null,
  voice: null, profile: 'human' as const, capturedAt: CAPTURED,
}))
const POOL = parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8'))
const PERSONAS = POOL.cards.filter((c) => c.voiceLength !== null).map(cardToPersona)
const AXIS = { now: NOW, publishedToday: 0 }

console.log('\n══ 자동 단계 사다리 — 정본 재사용 (DB 0 · 네트워크 0) ══')

console.log('\n① 🔴 승인되지 않은 새 규율을 폐기했다')
{
  /** 🔴 주석은 뺀다 — "앞판에는 이런 규율이 있었다" 는 설명까지 걸리면 거짓 실패다 */
  const codeOnly = (f: string): string => readFileSync(f, 'utf-8')
    .split('\n').filter((l) => !/^\s*(?:\*|\/\/|\/\*)/.test(l)).join('\n')
  const src = codeOnly('src/lib/stage-ladder.ts')
  check('🔴 🔴 **`STAGE_REQUIREMENTS`(재고 1/6/15/40 · 화자 1/3/5/8 · 연속 0/2/3/5) 가 사라졌다**',
    !/STAGE_REQUIREMENTS|goodDaysToEnter|readyStock/.test(src))
  check('🔴 🔴 **전역 감속(hardBlocks · auditPending)이 사라졌다 — 후보 결함을 생산 중단으로 키우지 않는다**',
    !/hardBlocks|auditPending/.test(src))
  check('🔴 감속은 정본 `safeStageFor` 에 맡긴다',
    /safeStageFor\(requested, input\.verdicts\)/.test(src))
  check('🔴 재고·화자를 여기서 직접 세지 않는다 — 정본 판정을 받는다',
    !/\bstock\b|readyCount|openDays/.test(src) && /verdicts: readonly StageVerdict\[\]/.test(src))
  check('🔴 DB·네트워크·파일을 모른다', !/from 'node:fs'|prisma|fetch\(/.test(src))
}

console.log('\n② 🔴 정본 판정이 ready 라고 한 만큼만 움직인다')
{
  const V = (ready: readonly ReleaseStage[]) => RELEASE_STAGES.map((s) => ({
    stage: s, ready: ready.includes(s), reasons: ready.includes(s) ? [] : [`${s} 미달`],
  }))
  const base = { kstDate: '2026-09-24', publishedToday: 0, decidedAt: AT }
  const up = planStageDecision({ ...base, currentStage: 'd3', verdicts: V(['d1', 'd3', 'd5', 'd10']) })
  check('한 칸 위가 ready 면 올라간다 (d3 → d5)',
    up.capacity === 'd5' && up.direction === 'up', `${up.capacity}/${up.direction}`)
  check('🔴 🔴 **두 칸 위가 ready 여도 한 칸만 올라간다**', up.capacity !== 'd10', up.capacity)
  const hold = planStageDecision({ ...base, currentStage: 'd3', verdicts: V(['d1', 'd3']) })
  check('한 칸 위가 미달이면 유지한다', hold.direction === 'hold' && hold.capacity === 'd3')
  const down = planStageDecision({ ...base, currentStage: 'd5', verdicts: V(['d1', 'd3']) })
  check('🔴 현 단계가 미달이면 정본 감속이 내린다 (d5 → d3)',
    down.capacity === 'd3' && down.direction === 'down', `${down.capacity}/${down.direction}`)
  check('🔴 그 근거 문구는 정본이 낸 것이다',
    down.reasons.some((r) => r.includes('감속')), down.reasons.join(' | '))
  const blind = planStageDecision({ ...base, currentStage: 'd5', verdicts: [] })
  check('🔴 판정을 못 받으면 올리지도 내리지도 않는다',
    blind.capacity === 'd5' && blind.direction === 'hold')
  check('🔴 🔴 **그 처리는 정본 `safeStageFor` 가 한다 — 여기서 다시 적지 않는다**',
    blind.reasons.some((r) => r.includes('신뢰하지 않는다')), blind.reasons.join(' | '))
  check('🔴 아무것도 못 읽으면 가장 안전한 단계다',
    safestDecision('2026-09-24', AT).capacity === SAFEST_STAGE)
}

console.log('\n③ 🔴 🔴 오늘 실제 반례 — 9/24 D5 · 이미 4건 · P02 1건 가능 · 공급 화자 1명')
{
  /**
   * 🔴 **2026-09-24 실측 상태 그대로.** 공급 신규 생성 가능 화자는 P14 한 명뿐이었는데
   *    발행은 P10·P06·P02 가 가능했고 P10 은 15:49 에 실제로 나갔다.
   *    🔴 공급 화자 1명 때문에 D3 로 내려가면 **다섯 번째 발행이 막힌다** — 실패다.
   */
  const today = planStageDecision({
    kstDate: '2026-09-24', currentStage: 'd5',
    // 🔴 발행 쪽 정본 판정 — d5 까지 ready
    verdicts: RELEASE_STAGES.map((s) => ({
      stage: s, ready: s !== 'd10', reasons: s === 'd10' ? ['d10 미달'] : [],
    })),
    publishedToday: 4, decidedAt: AT,
    supply: {
      eligibleSpeakers: 1,
      excluded: [
        { reason: 'noOpenDay', codes: ['P03', 'P04', 'P05', 'P08', 'P10', 'P11', 'P15', 'P16', 'P17', 'P18', 'P19', 'P20', 'P21', 'P22', 'P23', 'P24', 'P25'] },
        { reason: 'holdingStock', codes: ['P01', 'P02', 'P06', 'P07', 'P12', 'P13'] },
      ],
    },
  })
  check('🔴 🔴 **D5 를 유지한다 — 공급 화자 1명이 발행을 막지 않는다**',
    today.capacity === 'd5' && today.direction === 'hold',
    `${today.capacity}/${today.direction} · ${today.reasons.join(' | ')}`)
  check('🔴 🔴 **다섯 번째 발행이 가능하다 (d5 상한 5 > 이미 4건)**',
    PROFILES[today.release].dailyTarget > 4,
    `${today.release} 상한 ${PROFILES[today.release].dailyTarget} · 이미 4건`)
  check('🔴 공급 신호는 실렸지만 결정 근거에 쓰이지 않았다',
    today.supply?.eligibleSpeakers === 1 && !today.reasons.some((r) => r.includes('화자')),
    `supply=${today.supply?.eligibleSpeakers} reasons=${today.reasons.join(' | ')}`)
  check('🔴 제외 사유가 값으로 나뉘어 실린다',
    today.supply?.excluded.find((x) => x.reason === 'noOpenDay')?.codes.length === 17
    && today.supply?.excluded.find((x) => x.reason === 'holdingStock')?.codes.length === 6,
    JSON.stringify(today.supply?.excluded.map((x) => `${x.reason}:${x.codes.length}`)))

  const weak = planStageDecision({
    kstDate: '2026-09-24', currentStage: 'd5', publishedToday: 4, decidedAt: AT,
    verdicts: RELEASE_STAGES.map((s) => ({ stage: s, ready: s === 'd1' || s === 'd3', reasons: [] })),
  })
  check('🔴 🔴 **판정이 내려가도 이미 낸 4건이 그날 단계를 고정한다**',
    weak.capacity === 'd5' && weak.dayPinned, `${weak.capacity} pinned=${weak.dayPinned}`)
  check('🔴 그 이유가 값으로 남는다',
    weak.reasons.some((r) => r.includes('상한 초과')), weak.reasons.join(' | '))
}

console.log('\n④ 🔴 🔴 공급 가용성과 발행 배정 가능성은 다른 값이다')
{
  /**
   * 🔴 공급 여력 = `max(0, openDays − readyCount)` — *앞으로 더 만들 수 있는가*
   *    발행 가능 = 지금 재고에서 낼 수 있는가 (정본 `forecastPublishing`)
   *    🔴 2026-09-24: P10 은 공급 여력 0 인데 **15:49 에 실제로 발행**됐다.
   */
  const caps = [
    { code: 'P14', openDays: 1, readyCount: 0 },
    { code: 'P10', openDays: 0, readyCount: 0 },
    { code: 'P02', openDays: 1, readyCount: 1 },
  ]
  check('🔴 🔴 **P10 은 공급 여력 0 (열린날 0) — 그래도 그날 발행됐다**',
    remainingCapacity(caps[1]!) === 0)
  check('🔴 🔴 **P02 도 공급 여력 0 (재고를 이미 들고 있다) — 그래도 발행 가능했다**',
    remainingCapacity(caps[2]!) === 0)
  const plan = planSpeakerAvailability({ sourceKeys: ['s1'], capacities: caps })
  check('공급 계획은 여력 있는 한 명만 남긴다', plan.eligible.join(',') === 'P14', plan.eligible.join(','))
  const noOpen = caps.filter((c) => c.openDays === 0).map((c) => c.code)
  const holding = caps.filter((c) => c.openDays > 0 && c.readyCount >= c.openDays).map((c) => c.code)
  check('🔴 🔴 **제외 사유가 둘로 갈린다 — 열린날 0 vs 재고 보유**',
    noOpen.join(',') === 'P10' && holding.join(',') === 'P02',
    `noOpenDay=${noOpen.join(',')} · holdingStock=${holding.join(',')}`)
  const ladder = readFileSync('src/lib/stage-ladder.ts', 'utf-8')
  check('🔴 🔴 **결정기는 두 값을 하나로 합치지 않는다 — `eligibleSpeakers` 는 신호일 뿐이다**',
    /결정에 쓰지 않는다|결정에 쓰이지/.test(ladder) && !/eligibleSpeakers\s*<|eligibleSpeakers\s*>=/.test(ladder))
}

console.log('\n⑤ 🔴 단계 부족은 실제 배정 시뮬레이션으로 증명한다 (후보 수만 세지 않는다)')
{
  const rich = stageVerdicts({ queue: q(140), personas: PERSONAS, axis: AXIS })
  check('정본 판정이 단계마다 값을 낸다', rich.length === RELEASE_STAGES.length,
    rich.map((v) => `${v.stage}:${v.ready}`).join(' '))
  const empty = stageVerdicts({ queue: [], personas: PERSONAS, axis: AXIS })
  check('🔴 🔴 **재고가 없으면 어느 단계도 ready 가 아니다 — 배정 시뮬레이션 결과다**',
    empty.every((v) => !v.ready), empty.map((v) => `${v.stage}:${v.ready}`).join(' '))
  const decided = planStageDecision({
    kstDate: '2026-09-24', currentStage: 'd5', verdicts: empty, publishedToday: 0, decidedAt: AT,
  })
  check('🔴 🔴 **그때는 기존 계약대로 안전한 단계가 나온다**',
    decided.capacity === SAFEST_STAGE && decided.direction === 'down',
    `${decided.capacity}/${decided.direction}`)
  const sim = simulateStage({ stage: 'd5', queue: [], personas: PERSONAS, axis: AXIS })
  const jr = judgeReadiness(sim)
  check('🔴 판정 근거가 시뮬레이션에서 나온다 (재고·14일·공백)',
    !jr.ready && jr.reasons.length > 0, jr.reasons.join(' | '))
  check('🔴 🔴 **TTL·주 cap·최소 간격·생활사·배정을 거친 값이다 — 후보 수가 아니다**', (() => {
    // 🔴 후보를 넉넉히 줘도 인원이 적으면 높은 단계는 못 간다 — 수만 세면 못 잡는 차이다
    const few = stageVerdicts({ queue: q(140), personas: PERSONAS.slice(0, 1), axis: AXIS })
    return few.find((v) => v.stage === 'd10')?.ready === false
  })())
}

console.log('\n⑥ 🔴 설정 원천이 갈라지는 지점 (조사 결과 · 임시 방어)')
{
  const r = reconcileStageSources({
    canonical: { SORAN_CAPACITY_STAGE: 'd3', SORAN_RELEASE_STAGE: 'd1' },
    github: { SORAN_CAPACITY_STAGE: 'd5', SORAN_RELEASE_STAGE: 'd1' },
  })
  check('🔴 🔴 **2026-09-24 실측 불일치를 값으로 잡는다**',
    r.conflicts.length === 1 && r.conflicts[0]!.canonical === 'd3' && r.conflicts[0]!.github === 'd5',
    JSON.stringify(r.conflicts))
  const only = reconcileStageSources({
    canonical: { SORAN_CAPACITY_STAGE: 'd5', SORAN_RELEASE_STAGE: 'd1' },
    github: {
      SORAN_CAPACITY_STAGE: 'd5', SORAN_RELEASE_STAGE: 'd1',
      SORAN_RELEASE_CANARY_STAGE: 'd5', SORAN_RELEASE_CANARY_DATE: '2026-09-24',
      SORAN_RELEASE_WINDOW_STAGE: 'd3',
    },
  })
  check('🔴 canary·window 가 GitHub 에만 있다는 사실을 남긴다',
    only.publishOnlyPresent.length === 3, JSON.stringify(only.publishOnlyPresent))
  const wf = readFileSync('.github/workflows/auto-publish.yml', 'utf-8')
  check('🔴 공유 키가 발행 workflow 에 실제로 실린다',
    SHARED_STAGE_KEYS.every((k) => wf.includes(`${k}: \${{ vars.${k} }}`)))
  check('🔴 🔴 **발행 전용 키는 공급 workflow 에 없다 — 그래서 공급이 못 본다**', (() => {
    const sup = readFileSync('.github/workflows/supply-collect.yml', 'utf-8')
    return PUBLISH_ONLY_KEYS.every((k) => !sup.includes(k))
  })())
  check('🔴 🔴 **"낮은 쪽 선택" 이 최종 설계가 아님을 코드가 말한다**',
    /임시|최종 설계가 아니다/.test(readFileSync('src/lib/stage-source.ts', 'utf-8')))
}

console.log('\n⑦ 🔴 결정 하나에 날짜·단계·근거·시각·계약 판이 남는다')
{
  const d = planStageDecision({
    kstDate: '2026-09-24', currentStage: 'd5', publishedToday: 4, decidedAt: AT,
    verdicts: RELEASE_STAGES.map((s) => ({ stage: s, ready: s !== 'd10', reasons: [] })),
  })
  check('KST 날짜 · capacity · release · 근거 · 시각 · 계약 판이 모두 있다',
    d.kstDate === '2026-09-24' && d.capacity === 'd5' && d.release === 'd5'
    && d.reasons.length > 0 && d.decidedAt === AT
    && d.contractVersion === STAGE_DECISION_VERSION)
  check('🔴 release 는 capacity 를 넘지 않는다', d.release === d.capacity)
  const S = (o: Partial<StageSnapshot>): StageSnapshot => ({
    kstDate: '2026-09-24', capacity: 'd5', release: 'd1', decidedBy: 'supply', decidedAt: AT, ...o,
  })
  check('공급·발행이 같은 값을 보면 통과', sameStageSnapshot(S({}), S({ decidedBy: 'publish' })).ok)
  const diff = sameStageSnapshot(S({}), S({ decidedBy: 'publish', capacity: 'd3' }))
  check('🔴 🔴 **다르면 막는다 — 2026-09-24 에 실제로 일어난 일**',
    !diff.ok && diff.code === 'STAGE_MISMATCH', JSON.stringify(diff))
  check('🔴 한쪽이 없으면 "같다" 고 말하지 않는다', !sameStageSnapshot(S({}), null).ok)
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 순수 함수 검사다 — 러너가 이 결정을 실제로 쓰는 **배선은 아직 없다**.')
console.log('🔴 authoritative 저장 경로도 아직 없다 — 조사 결과만 보고했다(새 DB migration 0).\n')
if (fail > 0) process.exit(1)
