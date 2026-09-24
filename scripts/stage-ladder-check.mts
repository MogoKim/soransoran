#!/usr/bin/env tsx
/**
 * 🔴 **자동 단계 사다리 — 날짜별 실행 검사** (2026-09-24)
 *
 *    사람이 `CANARY_DATE` 를 매일 바꾸고 `WINDOW` 를 주마다 갱신하지 않아도
 *    D3 → D5 → D10 이 오르고, 재고·화자가 마르면 스스로 내려오는지 본다.
 *
 * 🔴 순수 함수 검사다 — DB 0 · 네트워크 0 · 파일 write 0 · LLM 0.
 */
import {
  planStage, planStageSafe, sustains, STAGE_REQUIREMENTS, type LadderObservation,
} from '../src/lib/stage-ladder'
import {
  reconcileStageSources, sameStageSnapshot, SHARED_STAGE_KEYS, PUBLISH_ONLY_KEYS,
  type StageSnapshot,
} from '../src/lib/stage-source'
import { PROFILES, RELEASE_STAGES, SAFEST_STAGE, type ReleaseStage } from '../src/lib/scale-profile'
import { readFileSync } from 'node:fs'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

/** 🔴 관측 한 벌 — 기본은 **넉넉한 정상**이고, 검사마다 한 칸씩만 흔든다 */
const OBS = (o: Partial<LadderObservation> = {}): LadderObservation => ({
  kstDate: '2026-09-24',
  currentStage: 'd3',
  readyStock: 40,
  eligibleSpeakers: 8,
  publishedToday: 0,
  goodDays: 10,
  safety: { auditPending: 0, hardBlocks: 0 },
  costUsdToday: 0.05,
  budgetUsd: 0.3,
  ...o,
})

console.log('\n══ 자동 단계 사다리 (순수 함수 · DB 0 · 네트워크 0) ══')

console.log('\n① 🔴 한 칸씩만 오른다 — 재고가 아무리 많아도 뛰지 않는다')
{
  const d1 = planStage(OBS({ currentStage: 'd1' }))
  check('d1 에서 한 번에 d3 까지만 올라간다', d1.stage === 'd3' && d1.direction === 'up',
    `${d1.stage}/${d1.direction}`)
  const d3 = planStage(OBS({ currentStage: 'd3' }))
  check('d3 → d5', d3.stage === 'd5' && d3.direction === 'up', `${d3.stage}/${d3.direction}`)
  const d5 = planStage(OBS({ currentStage: 'd5' }))
  check('d5 → d10', d5.stage === 'd10' && d5.direction === 'up', `${d5.stage}/${d5.direction}`)
  const d10 = planStage(OBS({ currentStage: 'd10' }))
  check('🔴 d10 이 꼭대기다 — 더 올리지 않는다',
    d10.stage === 'd10' && d10.direction === 'hold', `${d10.stage}/${d10.direction}`)
}

console.log('\n② 🔴 날짜를 손대지 않아도 사다리를 타고 올라간다 (D3 → D5 → D10)')
{
  /**
   * 🔴 **날짜별로 실제로 돌린다.** 매일 관측을 넣고 단계가 어떻게 움직이는지 본다 —
   *    사람이 `CANARY_DATE` 를 바꾸는 단계가 **한 번도 없다**.
   */
  let stage: ReleaseStage = 'd3'
  let goodDays = 0
  const trail: string[] = []
  const ups: string[] = []
  let reachedOn = -1
  for (let i = 0; i < 14; i += 1) {
    const d = new Date(Date.UTC(2026, 8, 24 + i)).toISOString().slice(0, 10)
    const v = planStage(OBS({ kstDate: d, currentStage: stage, goodDays }))
    if (v.direction === 'up') ups.push(`${d.slice(5)} ${stage}→${v.stage}`)
    trail.push(`${d.slice(5)}:${v.stage}`)
    /**
     * 🔴 **올라간 날은 새 단계에서 다시 센다.** 그래야 "한 칸 올라간 뒤 그 단계를
     *    며칠 버티는지" 를 실제로 본다 — 한 번 좋았다고 연달아 두 칸 뛰지 않는다.
     */
    goodDays = v.direction === 'up' ? 0 : goodDays + 1
    stage = v.stage
    if (stage === 'd10' && reachedOn < 0) reachedOn = i + 1
  }
  check('🔴 🔴 **사람이 날짜를 한 번도 바꾸지 않았는데 d3 → d10 까지 올라간다**',
    stage === 'd10' && reachedOn > 0, `${reachedOn}일차 도달 · ${trail.join(' ')}`)
  check('🔴 한 칸씩 올라갔다 — 중간 단계를 건너뛰지 않았다',
    ups.length === 2 && ups[0]!.includes('d3→d5') && ups[1]!.includes('d5→d10'),
    ups.join(' | '))
  check('🔴 승급이 연속일 요구만큼 걸린다 — 좋은 날 하루로 두 칸 뛰지 않는다',
    reachedOn === STAGE_REQUIREMENTS.d5.goodDaysToEnter + STAGE_REQUIREMENTS.d10.goodDaysToEnter + 2,
    `${reachedOn}일차 (기대 ${STAGE_REQUIREMENTS.d5.goodDaysToEnter}`
    + `+${STAGE_REQUIREMENTS.d10.goodDaysToEnter}+2)`)
}

console.log('\n③ 🔴 재고·화자가 마르면 스스로 내려온다')
{
  const lowStock = planStage(OBS({ currentStage: 'd5', readyStock: 2 }))
  check('재고 부족 → 한 칸 감속',
    lowStock.direction === 'down' && lowStock.stage === 'd3', `${lowStock.stage}/${lowStock.direction}`)
  check('그 이유가 값으로 남는다',
    lowStock.reasons.some((r) => r.includes('재고 2/')), lowStock.reasons.join(' | '))

  const noSpeaker = planStage(OBS({ currentStage: 'd5', eligibleSpeakers: 1 }))
  check('🔴 🔴 **화자 여력 부족 → 감속 (2026-09-24 실측한 그 병목)**',
    noSpeaker.direction === 'down' && noSpeaker.stage === 'd3',
    `${noSpeaker.stage}/${noSpeaker.direction} · ${noSpeaker.reasons.join(' | ')}`)

  /** 🔴 d1 에서 더 내려갈 곳이 없다 — 음수로 떨어지지 않는다 */
  const floor = planStage(OBS({ currentStage: 'd1', readyStock: 0, eligibleSpeakers: 0 }))
  check('🔴 가장 낮은 단계에서는 더 내려가지 않는다',
    floor.stage === 'd1' && floor.direction === 'hold', `${floor.stage}/${floor.direction}`)
}

console.log('\n④ 🔴 안전·비용은 올릴 이유를 이긴다')
{
  const hard = planStage(OBS({ currentStage: 'd5', safety: { auditPending: 0, hardBlocks: 2 } }))
  check('하드 차단이 있으면 감속한다', hard.direction === 'down', JSON.stringify(hard.reasons))
  const audit = planStage(OBS({
    currentStage: 'd5', safety: { auditPending: PROFILES.d5.dailyTarget * 2 + 1, hardBlocks: 0 },
  }))
  check('🔴 사람 검토 적체가 그날 목표의 2배를 넘으면 감속한다',
    audit.direction === 'down', JSON.stringify(audit.reasons))
  check('🔴 적체 허용치는 단계에 비례한다 — d1 은 더 빨리 걸린다', (() => {
    const d1 = planStage(OBS({ currentStage: 'd1', safety: { auditPending: 3, hardBlocks: 0 } }))
    const d10 = planStage(OBS({ currentStage: 'd10', safety: { auditPending: 3, hardBlocks: 0 } }))
    return d1.reasons.some((r) => r.includes('검토 대기')) && d10.direction !== 'down'
  })())
  const cost = planStage(OBS({ currentStage: 'd5', costUsdToday: 0.4, budgetUsd: 0.3 }))
  check('🔴 당일 비용이 상한을 넘으면 감속한다', cost.direction === 'down', JSON.stringify(cost.reasons))
}

console.log('\n⑤ 🔴 그날 이미 낸 편수는 단계를 고정한다 — 낸 글이 상한 초과가 되지 않게')
{
  const pinned = planStage(OBS({ currentStage: 'd5', readyStock: 2, publishedToday: 4 }))
  check('🔴 🔴 **이미 4건 냈으면 d3 로 내리지 않는다**',
    pinned.stage === 'd5' && pinned.direction === 'hold' && pinned.dayPinned,
    `${pinned.stage}/${pinned.direction} pinned=${pinned.dayPinned}`)
  const notPinned = planStage(OBS({ currentStage: 'd5', readyStock: 2, publishedToday: 1 }))
  check('아직 d3 상한 안이면 정상적으로 내린다',
    notPinned.stage === 'd3' && notPinned.direction === 'down' && !notPinned.dayPinned,
    `${notPinned.stage}/${notPinned.direction}`)
}

console.log('\n⑥ 🔴 연속 충족 일수를 채우기 전에는 올리지 않는다')
{
  const early = planStage(OBS({ currentStage: 'd3', goodDays: 1 }))
  check(`d5 는 ${STAGE_REQUIREMENTS.d5.goodDaysToEnter}일 연속을 요구한다 — 1일로는 안 올라간다`,
    early.direction === 'hold' && early.stage === 'd3', `${early.stage}/${early.direction}`)
  check('🔴 무엇이 모자란지 값으로 낸다',
    early.needs.some((n) => n.includes('연속 충족 1/')), early.needs.join(' | '))
  const ready = planStage(OBS({ currentStage: 'd3', goodDays: STAGE_REQUIREMENTS.d5.goodDaysToEnter }))
  check('연속일을 채우면 올라간다', ready.direction === 'up' && ready.stage === 'd5')
}

console.log('\n⑦ 🔴 관측을 못 하면 올리지 않는다 (fail-closed)')
{
  const blind = planStageSafe({ currentStage: 'd5' })
  check(`관측값이 비면 가장 안전한 ${SAFEST_STAGE} 로 둔다`,
    blind.stage === SAFEST_STAGE, `${blind.stage}/${blind.direction}`)
  check('그 이유를 값으로 남긴다',
    blind.reasons.some((r) => r.includes('관측값이 없다')), blind.reasons.join(' | '))
  check('🔴 값이 다 있으면 정상 경로로 간다',
    planStageSafe(OBS({ currentStage: 'd3' })).direction === 'up')
  check('🔴 `sustains` 는 연속일을 보지 않는다 — 버티는 것과 올라가는 것은 다르다',
    sustains(OBS({ goodDays: 0 }), 'd10').ok)
}

console.log('\n⑧ 🔴 설정이 갈라지면 낮은 쪽을 쓴다 (2026-09-24 실측 재현)')
{
  const r = reconcileStageSources({
    canonical: { SORAN_CAPACITY_STAGE: 'd3', SORAN_RELEASE_STAGE: 'd1' },
    github: { SORAN_CAPACITY_STAGE: 'd5', SORAN_RELEASE_STAGE: 'd1' },
  })
  check('🔴 🔴 **canonical d3 · github d5 → 낮은 d3 를 쓴다**',
    r.capacity === 'd3' && r.release === 'd1', `${r.capacity}/${r.release}`)
  check('🔴 갈라진 키를 값으로 낸다 — 조용히 고르지 않는다',
    r.conflicts.length === 1 && r.conflicts[0]!.key === 'SORAN_CAPACITY_STAGE'
    && r.conflicts[0]!.canonical === 'd3' && r.conflicts[0]!.github === 'd5',
    JSON.stringify(r.conflicts))
  const same = reconcileStageSources({
    canonical: { SORAN_CAPACITY_STAGE: 'd5', SORAN_RELEASE_STAGE: 'd1' },
    github: { SORAN_CAPACITY_STAGE: 'd5', SORAN_RELEASE_STAGE: 'd1' },
  })
  check('같으면 충돌이 없다', same.conflicts.length === 0 && same.capacity === 'd5')
  const missing = reconcileStageSources({ canonical: {}, github: {} })
  check(`🔴 둘 다 없으면 가장 안전한 ${SAFEST_STAGE} 다`,
    missing.capacity === SAFEST_STAGE && missing.release === SAFEST_STAGE,
    `${missing.capacity}/${missing.release}`)

  /** 🔴 발행 전용 허가를 공급이 못 본다는 사실을 남긴다 */
  const only = reconcileStageSources({
    canonical: { SORAN_CAPACITY_STAGE: 'd5', SORAN_RELEASE_STAGE: 'd1' },
    github: {
      SORAN_CAPACITY_STAGE: 'd5', SORAN_RELEASE_STAGE: 'd1',
      SORAN_RELEASE_CANARY_STAGE: 'd5', SORAN_RELEASE_CANARY_DATE: '2026-09-24',
      SORAN_RELEASE_WINDOW_STAGE: 'd3',
    },
  })
  check('🔴 🔴 **canary·window 가 GitHub 에만 있으면 그 사실을 값으로 낸다**',
    only.publishOnlyPresent.length === 3
    && only.notes.some((n) => n.includes('공급 러너는 이 값을 보지 못한다')),
    JSON.stringify(only.publishOnlyPresent))

  /**
   * 🔴 **두 목록이 실제 운영 배선과 같은가.** 상수만 선언해 두고 workflow 가
   *    다른 키를 쓰면 이 화해기는 엉뚱한 것을 맞춘다.
   */
  const wf = readFileSync('.github/workflows/auto-publish.yml', 'utf-8')
  check('🔴 공유 키 두 개가 발행 workflow 에 실제로 실린다',
    SHARED_STAGE_KEYS.every((k) => wf.includes(`${k}: \${{ vars.${k} }}`)),
    SHARED_STAGE_KEYS.join(','))
  check('🔴 발행 전용 키 다섯 개도 그 workflow 에 실린다 — 목록이 낡지 않았다',
    PUBLISH_ONLY_KEYS.every((k) => wf.includes(`${k}: \${{ vars.${k} }}`)),
    PUBLISH_ONLY_KEYS.filter((k) => !wf.includes(`${k}: \${{ vars.${k} }}`)).join(',') || '(전부 있음)')
  check('🔴 🔴 **발행 전용 키는 공급 workflow 에 없다 — 그래서 공급이 못 본다**', (() => {
    const sup = readFileSync('.github/workflows/supply-collect.yml', 'utf-8')
    return PUBLISH_ONLY_KEYS.every((k) => !sup.includes(k))
  })())
}

console.log('\n⑨ 🔴 공급과 발행이 같은 단계 스냅샷을 본다')
{
  const S = (o: Partial<StageSnapshot>): StageSnapshot => ({
    kstDate: '2026-09-24', capacity: 'd5', release: 'd1',
    decidedBy: 'supply', decidedAt: '2026-09-24T05:15:00.000Z', ...o,
  })
  check('같은 값이면 통과',
    sameStageSnapshot(S({}), S({ decidedBy: 'publish' })).ok)
  const diff = sameStageSnapshot(S({}), S({ decidedBy: 'publish', capacity: 'd3' }))
  check('🔴 🔴 **단계가 다르면 막는다 — 2026-09-24 에 실제로 일어난 일**',
    !diff.ok && diff.code === 'STAGE_MISMATCH', JSON.stringify(diff))
  const date = sameStageSnapshot(S({}), S({ decidedBy: 'publish', kstDate: '2026-09-23' }))
  check('날짜가 다르면 막는다', !date.ok && date.code === 'DATE_MISMATCH')
  const none = sameStageSnapshot(S({}), null)
  check('🔴 한쪽이 없으면 "같다" 고 말하지 않는다', !none.ok && none.code === 'MISSING')
}

console.log('\n⑩ 🔴 기존 계약을 깨지 않는다')
{
  check('허용 단계는 정본 하나에서 온다',
    RELEASE_STAGES.join(',') === 'd1,d3,d5,d10', RELEASE_STAGES.join(','))
  check('🔴 요구치는 모든 단계에 있다',
    RELEASE_STAGES.every((s) => STAGE_REQUIREMENTS[s] !== undefined))
  check('🔴 단계가 오를수록 요구가 커진다 — 뒤집힌 칸이 없다',
    RELEASE_STAGES.every((s, i) => i === 0 || (
      STAGE_REQUIREMENTS[s]!.readyStock > STAGE_REQUIREMENTS[RELEASE_STAGES[i - 1]!]!.readyStock
      && STAGE_REQUIREMENTS[s]!.eligibleSpeakers >= STAGE_REQUIREMENTS[RELEASE_STAGES[i - 1]!]!.eligibleSpeakers
    )))
  check('🔴 화자 요구는 그 단계 슬롯 수를 넘지 않는다 — 채울 수 없는 요구를 만들지 않는다',
    RELEASE_STAGES.every((s) => STAGE_REQUIREMENTS[s]!.eligibleSpeakers <= PROFILES[s].dailyTarget))
  check('🔴 이 사다리는 슬롯·상한·중복·안전·비용 게이트를 **대신하지 않는다**', (() => {
    const src = readFileSync('src/lib/stage-ladder.ts', 'utf-8')
    // 🔴 단계만 정한다 — 발행·중복·예산 판정을 여기서 다시 하지 않는다
    return !/publishOriginal|dedupe|ActivityLog|prisma/i.test(src)
  })())
  check('🔴 DB·네트워크·파일을 모른다 (순수 함수)', (() => {
    const a = readFileSync('src/lib/stage-ladder.ts', 'utf-8')
    const b = readFileSync('src/lib/stage-source.ts', 'utf-8')
    return !/from 'node:fs'|prisma|fetch\(/.test(a) && !/from 'node:fs'|prisma|fetch\(/.test(b)
  })())
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 순수 함수 검사다 — 운영 배선(러너가 이 판정을 실제로 쓰는가)은 아직 없다.\n')
if (fail > 0) process.exit(1)
