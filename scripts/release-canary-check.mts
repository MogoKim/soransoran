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
  canaryAuthorization, judgeOneDayCanary, kstDateString,
  CANARY_STAGE_ENV, CANARY_DATE_ENV,
} from '../src/lib/release-canary'
import { resolveScale } from '../src/lib/scale-runtime'
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
  check('🔴 그날 슬롯을 채우면 GO', judgeOneDayCanary(simOf()).ok === true)

  const short = judgeOneDayCanary(simOf({ in14: 2 }))
  check('🔴 🔴 **한 건이라도 모자라면 NO-GO**',
    short.ok === false && short.can === 2 && short.want === 3)

  check('🔴 기배정 복구가 깨져 있으면 NO-GO',
    judgeOneDayCanary(simOf({ recoveryBroken: 1 })).ok === false)

  /**
   * 🔴 **14일 조건은 묻지 않는다.** 재고 4건은 d3 의 14일 목표 42 에 한참 못 미치는데,
   *    그날 3편을 낼 수 있으면 하루 시험은 GO 다 — 그것이 이 판정의 전부다.
   */
  check('🔴 🔴 **14일치 재고가 없어도 하루 판정은 GO 다**',
    judgeOneDayCanary(simOf({ stock: 4 })).ok === true
    && PROFILES.d3.dailyTarget * 14 === 42)

  /** 🔴 14일치 시뮬레이션을 하루 판정으로 쓰지 못한다 */
  const wrongWindow = judgeOneDayCanary(simOf({ horizonDays: 14, in14: 42 }))
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
    { readiness: NOTHING_READY, canary: { now: NOW, verdict: judgeOneDayCanary(simOf()) } })
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
    { readiness: NOTHING_READY, canary: { now: NOW, verdict: judgeOneDayCanary(simOf({ in14: 2 })) } })
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
    { readiness: NOTHING_READY, canary: { now: NOW, verdict: judgeOneDayCanary(simOf()) } })
  check('🔴 🔴 **날짜가 지나면 아무도 끄지 않아도 d1 로 돌아온다**',
    expired.releaseStage === 'd1' && expired.canaryStage === false,
    `stage=${expired.releaseStage}`)

  /** 🔴 capacity 상한은 시험이라도 비켜 가지 않는다 */
  const overCap = resolveScale(
    envOf({ SORAN_CAPACITY_STAGE: 'd1', [CANARY_STAGE_ENV]: 'd3', [CANARY_DATE_ENV]: TODAY }),
    { readiness: NOTHING_READY, canary: { now: NOW, verdict: judgeOneDayCanary(simOf()) } })
  check('🔴 🔴 **capacity 를 넘는 시험은 열리지 않는다**',
    overCap.releaseStage === 'd1' && overCap.canaryStage === false
    && overCap.notes.some((n) => n.includes('시험이라도 열지 않는다')),
    `stage=${overCap.releaseStage}`)

  /** 🔴 시험이 단계를 **내리는** 데 쓰이지 않는다 */
  const lower = resolveScale(
    envOf({ SORAN_CAPACITY_STAGE: 'd5', SORAN_RELEASE_STAGE: 'd5',
      [CANARY_STAGE_ENV]: 'd1', [CANARY_DATE_ENV]: TODAY }),
    { readiness: RELEASE_STAGES.map((stage) => ({ stage, ready: true, reasons: [] })),
      canary: { now: NOW, verdict: judgeOneDayCanary(simOf({ stage: 'd1', in14: 1, want14: 1 })) } })
  check('🔴 준비된 단계를 시험이 끌어내리지 않는다',
    lower.releaseStage === 'd5' && lower.canaryStage === false)
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 DB 0 · 네트워크 0 · 파일 write 0 · 실제 발행 0\n')
if (fail > 0) process.exit(1)
