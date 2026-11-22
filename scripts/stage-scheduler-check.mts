#!/usr/bin/env tsx
/**
 * 🔴 **D1→D100 단계 스케줄러 검사 — 운영 상태 기계 하나로 본다** (2026-09-29 generic scheduler 배선)
 *
 *   DB 0 · 네트워크 0 · 유료 호출 0 · 운영 env 0. 파일 write 는 OS 임시 디렉터리의 가짜 env 하나(롤백 확인)뿐이다.
 *
 *   ① 단계 목록 · 목표 — 러너 단계 d1~d50 · d100 은 표현만 · 목표는 창업자 계획(`d100Plan`)과 같다
 *   ② (2026-09-30) 승인 천장 env 는 없다 — 러너 단계 해석만 남는다(d100 은 러너 밖)
 *   ③ 슬롯 · 러너 — 하루 전체 창 · heartbeat 격자 · 60분 안 댓글 3회(72회 · 자정 포함 간격 ≤20분) · 바퀴 비중 자리 · 하루 시뮬레이션
 *   ④ preflight(D3~D100 한 함수) — slot-valid 기회 · 처리량 · 지연 · 계약 유효 Persona canary 하한 · 비용 상한 · 러너
 *   ⑤ 상태 기계 — **운영 `decideStage` 를 여러 날 돌린다**(저장 계약 · 증거 판정 · consumer 까지 한 줄로)
 *   ⑥ 러너 연결 — consumer env(결정 그대로 · canary 없음) → `resolveScale` · catch-up · 증명일 · 발행 천장
 *   ⑦ 롤백 — `stage:switch --off` → consumer 는 d1 을 명시해서 넣는다(옛 env/canary 단계로 돌아가지 않는다)
 *   ⑧ 증거 본체 — d1~d10 두 입구 동일 · 사람 물량 0건 · REPROVE 증명일
 *
 * 🔴 러너 사실(격자 · 댓글 예약표 · 회차 상한)은 **정본 템플릿에서 읽는다**(`RUNNER_GRID`).
 *    단가 셋만 fixture 다: 댓글 $0.00222(= `persona-comment-loop-check` 가 운영 장부와 대조하는 실측 1건) ·
 *    감사 $0.005 · 공급 READY 1건당 $0.008(가정 — 장부 실측 전). 🔴 운영 단가는 controller 가 전날 장부에서 읽는다.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  GENERIC_STAGES, genericNextStage, genericDailyTarget, HIGHEST_RUNTIME_STAGE,
  validPublishMinutes, publishCapacityOf, genericProfileOf, verifyGenericProfile, commentCoverageOf,
  judgeNextPreflight, readyCapacityOf, preflightBlocks,
  type PreflightFacts, type ReadyCohortFact, type GenericStage, type PreflightVerdict,
} from '../src/lib/stage-ladder-generic'
import {
  PROFILES, RELEASE_STAGES, RUNTIME_STAGES, RUNTIME_PROFILES, resolveRuntimeStage, minuteOfDay, profileOf,
  stageRank, isRuntimeStage, CAPACITY_ENV, RELEASE_ENV, cycleSlotsOf,
  type RuntimeStage,
} from '../src/lib/scale-profile'
import { CYCLES, cycleLabel, cyclePublishWindow, cycleQuotas } from '../src/lib/cycle-schedule'
import { PUBLISH_WINDOW_START_MINUTE, PUBLISH_WINDOW_END_MINUTE, judgeCatchUp, simulateDay } from '../src/lib/publish-slot-catchup'
import { allStageCronLines } from '../src/lib/scale-workflow-render'
import {
  COMMENT_LOOP_DAILY_USD_DEFAULT, COMMENT_LOOP_DAILY_USD_MAX,
  firstCommentDelayMs,
} from '../src/lib/persona-comment-auto-lane'
import {
  d100Plan, PERSONA_CANARY_FLOOR, PERSONA_SUSTAINED_TARGET, schedulerSupportOf,
} from '../src/lib/d100-capacity'
import {
  SUPPLY_RUNS_PER_DAY, SUPPLY_RUN_SLOTS_KST, SUPPLY_RUN_WINDOW_MS, SUPPLY_WORKSET_PER_RUN,
  supplyRunSlotMinuteOf,
} from '../src/lib/supply-schedule-contract'
import { supplyApprovedDailyUsdOf, supplyCostProofBudgetUsd } from '../src/lib/supply-cost-envelope'
import {
  judgeStageEvidence, judgeEvidenceForTarget,
  type EvidencePost, type EvidenceSideSignals, type StageEvidenceFacts, type StageEvidenceVerdict,
} from '../src/lib/stage-evidence'
import { auditTarget } from '../src/lib/auto-ready-v2'
import {
  validateStoredDecision, nextStage, STAGE_DECISION_VERSION, DECISION_WRITER,
  type ValidatedStageDecision, type StageDecision,
} from '../src/lib/stage-decision-contract'
import {
  decideStage, consumerEnvOf, validateForToday, openStageOf, leaseSafeHoldOf, type HealthSignal, type ControllerResult,
  resolvePreviousAuthority, bridgeHoldOf, inputFailureHoldOf, signalBlindReleaseOf, heldReleaseOf, type DecisionRead,
} from '../src/lib/stage-controller'
import { preparedStageOf } from '../src/lib/stage-ladder'
import { resolveScale, boundedReleaseStage } from '../src/lib/scale-runtime'
import { CONTROLLER_ENV, controllerEnabled } from '../src/lib/stage-decision-store'
import {
  RUNNER_GRID, futureAdditionalOf, measuredFutureSourceOpportunities, slotValidOpportunitiesOf,
} from './lib/stage-preflight-facts.mjs'
import { settledTotalUsd, cappedBy } from './lib/stage-preflight-facts.mjs'
import { fakeSourceEvidence } from './lib/fake-source-evidence.mjs'
import { articleIdHashOf } from '../src/lib/source-slot-release'
import {
  stageRecoverySourceReceiptPath, writeStageRecoverySourceReceipt,
} from './lib/stage-recovery-source-receipt.mjs'
import { OPPORTUNITY_INVENTORY_AXIS, OPPORTUNITY_INVENTORY_BASIS, OPPORTUNITY_KIND, OPPORTUNITY_VERSION } from '../src/lib/supply-workset'
import { COMMENT_RUNNER_SLOTS, COMMENT_RUNNER_MAX_GAP_MINUTES } from './lib/persona-comment-runner-template'
import { readEnvKeys } from './lib/ops-signals.mjs'
import { markedStageEnv } from './lib/stage-decision-fixture'

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}
const section = (s: string): void => console.log(`\n── ${s} ──`)

const GRID = RUNNER_GRID
/** 🔴 fixture 단가 — 머리말 참고 */
const SUPPLY_USD_PER_READY = 0.008

// 공급 비용 계약(envelope) 시행 뒤의 날짜 — 그 전 날짜의 하루 판정은 비용을 모른다
const D0 = '2026-11-20'
const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
const at0700 = (d: string): string => new Date(`${d}T07:00:00+09:00`).toISOString()
const SIDE_OK: EvidenceSideSignals = {
  cost: [
    { lane: 'comment', name: '댓글', health: 'ok' },
    { lane: 'audit', name: '감사', health: 'ok' },
  ],
  supplyCostEvidence: {

    wholeDayCriticalHealth: 'ok',
    envelope: { settledRequests: 20, usageUnknownRequests: 0, overrunRequests: 0, ineligibleRequests: 0, riskUsd: 0.08, budgetUsd: 1 },
  },
}

// ─────────────────────────────────────────────────────────
section('① 단계 목록 · 목표')
check('러너 단계 = RELEASE_STAGES(d1·d3·d5·d10) + d20·d30·d50 · 표현 단계는 그 위 d100',
  RELEASE_STAGES.every((s, i) => RUNTIME_STAGES[i] === s) && RUNTIME_STAGES.join(',') === 'd1,d3,d5,d10,d20,d30,d50'
  && GENERIC_STAGES.join(',') === 'd1,d3,d5,d10,d20,d30,d50,d100')
check('🔴 RELEASE_STAGES · PROFILES 는 d1~d10 그대로다(GitHub 예약 합집합 불변 · D100 용량표 슬롯은 RUNTIME_PROFILES 를 읽는다)',
  RELEASE_STAGES.join(',') === 'd1,d3,d5,d10' && Object.keys(PROFILES).join(',') === 'd1,d3,d5,d10')
check('🔴 d1~d10 러너 프로필은 PROFILES 와 같은 객체다(값 불변)', RELEASE_STAGES.every((s) => RUNTIME_PROFILES[s] === PROFILES[s]))
for (const s of ['d20', 'd30', 'd50', 'd100'] as const) {
  check(`${s} 목표 ${genericDailyTarget(s)} = 창업자 계획 publicPostsPerDay ${d100Plan(s).publicPostsPerDay}`,
    genericDailyTarget(s) === d100Plan(s).publicPostsPerDay)
}
check('d100 은 러너 단계가 아니다(표현만)', !isRuntimeStage('d100') && HIGHEST_RUNTIME_STAGE === 'd50')
check('다음 칸(저장 계약 정본) d10 → d20 · d30 → d50 · d50 → 없음',
  nextStage('d10') === 'd20' && nextStage('d30') === 'd50' && nextStage('d50') === null)
check('표현 사다리 d50 → d100 · d100 → 없음', genericNextStage('d50') === 'd100' && genericNextStage('d100') === null)

// ─────────────────────────────────────────────────────────
section('② 🔴 승인 천장 env 없음 — 러너 단계 해석만')
check('러너 env 해석 — d20 은 d20 · d100 은 러너 밖이라 d1', resolveRuntimeStage('d20').stage === 'd20' && resolveRuntimeStage('d100').stage === 'd1')
check('🔴 🔴 **천장 해석(resolveCeiling) · D20 전용 관문(needsExtendedGate) 이 없다 — D3~D100 한 관문**', (() => {
  const src = readFileSync('src/lib/stage-ladder-generic.ts', 'utf-8')
  return !/export function resolveCeiling|export function needsExtendedGate|export function extendedTrialBlocks/.test(src)
    && /export function preflightBlocks/.test(src)
})())
check('capacity 칸 = 다음 증명 단계 — d10 → d20 · d50 → d50(맨 위)', preparedStageOf('d10') === 'd20' && preparedStageOf('d50') === 'd50')

// ─────────────────────────────────────────────────────────
section('③ 슬롯 · 러너 — 하루 전체 창 · 격자 · 첫 댓글 · 바퀴 비중 자리')
const valid = validPublishMinutes(GRID)
const cap = publishCapacityOf(GRID)
console.log(`   유효 발행 분 ${valid.length}개 (격자 ${GRID.gridMinutes}분 · 회차당 ${GRID.perRunMax}건 · 댓글 회차 ${GRID.commentSlots.length}개 · 시도 ${GRID.attempts}회) → 하루 용량 ${cap}건`)
{
  const mins = COMMENT_RUNNER_SLOTS.map(minuteOfDay)
  // 🔴 자정을 넘는 마지막→첫 회차 간격까지 센다 — 하루 어느 20분 구간에도 회차가 있다
  const gaps = [...mins.slice(1).map((m, i) => m - mins[i]!), mins[0]! + 24 * 60 - mins[mins.length - 1]!]
  check(`댓글 러너 ${COMMENT_RUNNER_SLOTS.length}회/day · 자정 포함 최대 간격 ${Math.max(...gaps)}분 ≤ ${COMMENT_RUNNER_MAX_GAP_MINUTES}분`,
    COMMENT_RUNNER_SLOTS.length === 72 && Math.max(...gaps) <= 20 && COMMENT_RUNNER_MAX_GAP_MINUTES === 20)
  // 🔴 24시간 격자 — 옛 낮 창의 첫 회차(08:07)와 :07 위상을 하루 전체로 잇는다. 시간마다 정확히 3회
  const perHour = Array.from({ length: 24 }, (_, h) => COMMENT_RUNNER_SLOTS.filter((x) => x.hour === h).length)
  check('🔴 댓글 러너는 하루 24시간 :07 · :27 · :47 에 돈다 — 시간마다 3회 · 08:07 포함',
    COMMENT_RUNNER_SLOTS.every((x) => x.minute % 20 === 7) && perHour.every((n) => n === 3)
    && mins.includes(8 * 60 + 7), perHour.join(','))
}
// 🔴 (2026-11-23) 발행 창은 하루 전체 — 00:00 부터 마지막 10분 틱(23:50)까지. 자정을 넘는 댓글 회차까지 세면 모든 틱이 유효하다
check(`🔴 운영 창 = 하루 전체(${cycleLabel(PUBLISH_WINDOW_START_MINUTE)}~${cycleLabel(PUBLISH_WINDOW_END_MINUTE)}) · 유효 발행 분 = 그 창의 10분 틱 전부 ${valid.length}개`,
  PUBLISH_WINDOW_START_MINUTE === 0 && PUBLISH_WINDOW_END_MINUTE === 24 * 60 - GRID.gridMinutes
  && valid.length === 24 * 60 / GRID.gridMinutes && valid[0] === 0 && valid.at(-1) === PUBLISH_WINDOW_END_MINUTE
  && cap === valid.length * GRID.perRunMax)
check('유효 발행 분은 전부 창 안 · 격자 위 · 60분 안 댓글 3회',
  valid.every((m) => m >= PUBLISH_WINDOW_START_MINUTE && m <= PUBLISH_WINDOW_END_MINUTE && m % GRID.gridMinutes === 0
    && commentCoverageOf(m, GRID).runs >= GRID.attempts))
// 🔴 R1 — 댓글 덮개는 자정을 넘는 회차(다음 날 :07 · :27)도 센다. 23:30 · 23:50 자리가 시도 3회를 채운다
for (const m of [23 * 60 + 30, 23 * 60 + 50]) {
  const c = commentCoverageOf(m, GRID)
  check(`🔴 ${cycleLabel(m)} 자리 — 60분 안 댓글 시도 ${c.runs}회 = ${GRID.attempts}회 (자정 넘는 회차 포함 · 첫 대기 ${c.firstWait}분)`,
    c.runs === GRID.attempts && c.firstWait !== null && c.firstWait <= COMMENT_RUNNER_MAX_GAP_MINUTES)
}
for (const s of RUNTIME_STAGES) {
  const p = profileOf(s)
  const probs = verifyGenericProfile(p, GRID)
  const mins = p.slots.map(minuteOfDay)
  const waits = mins.map((m) => commentCoverageOf(m, GRID).firstWait ?? 999)
  check(`${s} (${p.dailyTarget}/day) — 창 · 격자 · 시도 3회 · 한 분 한 건 · 첫 댓글 대기 최대 ${Math.max(...waits)}분 ≤ 20`,
    probs.length === 0 && Math.max(...waits) <= 20 && p.slots.every((x) => x.count === 1), probs.join(' / '))
  // 🔴 하루 시뮬레이션 — 10분 heartbeat 가 운영 창 내내 오면 목표를 정확히 채우고 넘지 않는다
  const arrivals: Date[] = []
  for (let m = PUBLISH_WINDOW_START_MINUTE; m <= PUBLISH_WINDOW_END_MINUTE; m += GRID.gridMinutes) {
    arrivals.push(new Date(Date.parse(`${D0}T00:00:00+09:00`) + m * 60_000))
  }
  const sim = simulateDay({ stage: s, arrivals })
  check(`${s} — heartbeat 하루 시뮬레이션 ${sim.published}/${sim.target}건 (넘지 않는다)`, sim.published === sim.target && sim.meetsTarget)
}
for (const s of ['d20', 'd30', 'd50'] as const) {
  const d = cycleSlotsOf(genericDailyTarget(s))
  check(`🔴 ${s} 러너 프로필 슬롯 = 바퀴 비중 자리(cycleSlotsOf) 그대로 — 숫자는 바퀴 표 한 곳`,
    d.ok && JSON.stringify(d.slots) === JSON.stringify(profileOf(s).slots))
  // 🔴 바퀴마다 몫(cycleQuotas)만큼 · 그 바퀴의 공개 창 안 — 22:20 바퀴의 자정 넘는 자리는 다음 날 앞자리로 감긴다
  const mins = profileOf(s).slots.map(minuteOfDay)
  const quotas = cycleQuotas(genericDailyTarget(s))
  const perCycle = CYCLES.map((_, i) => {
    const w = cyclePublishWindow(i)!
    return mins.filter((m) => (m >= w.start && m < w.end) || (m + 24 * 60 >= w.start && m + 24 * 60 < w.end)).length
  })
  check(`🔴 ${s} 바퀴별 자리 = 바퀴 몫 [${perCycle.join(',')}] · 각 자리가 그 바퀴 공개 창 안`,
    JSON.stringify(perCycle) === JSON.stringify(quotas) && perCycle.reduce((a, b) => a + b, 0) === mins.length)
  check(`${s} Persona 간격은 d10 운영값 그대로`, profileOf(s).postsPerWeek === PROFILES.d10.postsPerWeek
    && profileOf(s).minDaysBetween === PROFILES.d10.minDaysBetween)
}
check('🔴 GitHub 예약 합집합은 d1~d10 그대로 10회 — D20 이상은 로컬 heartbeat 격자로 돈다(yml 불변)', allStageCronLines().length === 10)
const g100 = genericProfileOf('d100', GRID)
// 🔴 d100 을 막는 것은 용량(144 ≥ 100)이 아니라 바퀴 몫 — 짧은 바퀴의 공개 창 틱 수보다 몫이 크다(D100 일)
check(`🔴 [blocker 실측] d100 은 지금 러너로 담을 수 없다 — 바퀴 몫 > 그 바퀴 틱 (용량 ${cap} ≥ 100 이라 용량 부족은 아니다)`,
  !g100.ok && g100.problems.some((p) => p.includes('바퀴 몫')) && cap >= 100,
  g100.ok ? '' : g100.problems.join(' / '))
// 🔴 댓글 회차가 끊긴 격자(옛 08:07~22:00 창)에서는 22시에 가까운 슬롯이 시도 3회가 안 된다 — 자정을 감아 세도 그대로 막는다
check('반례 — 댓글 회차가 22시에 끝나는 격자에서 21:40 슬롯은 시도 3회가 안 돼 계약 위반', verifyGenericProfile({
  dailyTarget: 1, postsPerWeek: 1, minDaysBetween: 5, slots: [{ hour: 21, minute: 40, count: 1 }],
}, { ...GRID, commentSlots: GRID.commentSlots.filter((c) => minuteOfDay(c) >= 8 * 60 && minuteOfDay(c) <= 22 * 60) })
  .some((p) => p.includes('댓글 시도')))
check('반례 — 격자 밖 분(09:35)은 계약 위반', verifyGenericProfile({
  dailyTarget: 1, postsPerWeek: 1, minDaysBetween: 5, slots: [{ hour: 9, minute: 35, count: 1 }],
}, GRID).some((p) => p.includes('격자')))
check('반례 — 목표 0 · 101 · 소수는 만들지 않는다', !cycleSlotsOf(0).ok && !cycleSlotsOf(101).ok && !cycleSlotsOf(2.5).ok)

// ─────────────────────────────────────────────────────────
section('④ preflight — slot-valid 기회 · 처리량 · 지연 · 계약 유효 Persona · 비용 상한 · 러너')
/**
 * 🔴 경계값 fixture — 각 칸이 그 단계를 **딱** 채운다(기회 = 목표 · cohort 공개 = 목표 · 손실 0 · 대기 0 ·
 *    용량 = 필요량(= 목표)을 겨우 채움 · Persona = canary 하한). 넉넉한 값으로 PASS 를 만들면 경계 반례가 헛돈다.
 */
const RUNS = SUPPLY_WORKSET_PER_RUN * SUPPLY_RUNS_PER_DAY
/** 🔴 미래 순유입 합집합 반례의 실제 산출 — 아래 D20 preflight 판정에 그대로 넣는다 */
const FUTURE_UNION: {
  overlap: number | null; distinct: number | null
  /** H1 반례 — 현재 원천 300(이른 슬롯) · y=0.1 · 순유입 17(늦은 슬롯) */
  pooledCurrent: number | null; pooled: number | null; oldPooled: number | null
} = { overlap: null, distinct: null, pooledCurrent: null, pooled: null, oldPooled: null }
/**
 * 🔴 회차 시각은 손으로 적지 않는다 — 정본 시각표(`SUPPLY_RUN_SLOTS_KST`)에서 계산한다.
 *    아래 fixture 는 07:00 판정을 재현한다: 기준선 = 07:00 전에 창이 끝난 마지막 정기 회차,
 *    남은 회차 = 07:00 뒤에 뜨는 정기 회차 전부(바퀴 표가 바뀌어도 이 검사는 그대로다).
 */
const SUPPLY_MINUTES = SUPPLY_RUN_SLOTS_KST.map((slot) => slot.hour * 60 + slot.minute).sort((a, b) => a - b)
const SUPPLY_WINDOW_MINUTES = SUPPLY_RUN_WINDOW_MS / 60_000
const JUDGE_MINUTE = 7 * 60
/** 07:00 판정의 기준선 회차 — 회차 시각 + 창이 판정 시각 이전인 마지막 회차 */
const BASE_RUN = SUPPLY_MINUTES.filter((m) => m + SUPPLY_WINDOW_MINUTES <= JUDGE_MINUTE).at(-1)!
/** 07:00 뒤 그날 남은 정기 회차 — 첫 회차가 순유입을 처음 본다 */
const FUTURE_RUNS = SUPPLY_MINUTES.filter((m) => m > JUDGE_MINUTE)
const FIRST_RUN = FUTURE_RUNS[0]!
const hhmm = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
check(`fixture — 07:00 판정에 기준선 회차(${hhmm(BASE_RUN)})와 남은 회차가 셋 이상 있다(첫 회차 ${hhmm(FIRST_RUN)})`,
  Number.isInteger(BASE_RUN) && FUTURE_RUNS.length >= 3)
check(`launchd 가 1분 늦게 시작한 회차는 그 정기 회차(${hhmm(FIRST_RUN)})에 귀속된다`,
  supplyRunSlotMinuteOf(FIRST_RUN + 1) === FIRST_RUN)
check('정기 회차의 45분 창이 끝난 시각은 가까운 회차로 추정하지 않는다',
  supplyRunSlotMinuteOf(FIRST_RUN + SUPPLY_WINDOW_MINUTES - 1) === FIRST_RUN
  && FUTURE_RUNS[1]! > FIRST_RUN + SUPPLY_WINDOW_MINUTES && supplyRunSlotMinuteOf(FIRST_RUN + SUPPLY_WINDOW_MINUTES) === null)
{
  const target = '2026-11-03'
  const now = new Date(`${target}T07:00:00+09:00`)
  /** 그 KST 날짜의 자정에서 `minute` 분 뒤 */
  const kstAt = (date: string, minute: number): Date => new Date(Date.parse(`${date}T00:00:00+09:00`) + minute * 60_000)
  const runIdAt = (date: string, minute: number): string =>
    kstAt(date, minute).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  const snapshotAt = (
    targetDir: string, date: string, ids: readonly string[], minute: number, evidenceAt?: Date,
    origin: 'natural' | 'scheduled-followup' | 'event' | 'manual' | 'legacy' = 'natural',
  ): void => {
    const written = ids.length
    const runId = runIdAt(date, minute)
    const runAt = kstAt(date, minute)
    const takenAt = new Date(runAt.getTime() + 10 * 60_000).toISOString()
    const budgetSlot = supplyRunSlotMinuteOf(minute)
    const budgetWindow = budgetSlot === null ? `${date} 00:00` : `${date} ${hhmm(budgetSlot)}`
    const evidence = ids.map((id) => fakeSourceEvidence(evidenceAt ?? new Date(takenAt), {
      site: 'navercafe:fixture', id, ageH: 3,
    }))
    const snapshot = {
      kind: OPPORTUNITY_KIND, version: OPPORTUNITY_VERSION, runId, takenAt,
      inventory: {
        basis: OPPORTUNITY_INVENTORY_BASIS, axis: OPPORTUNITY_INVENTORY_AXIS,
        counts: { inputRows: written, lifecyclePassed: written, autoSeed: written, evidenceMissing: 0, written },
      },
      evidence,
    }
    writeFileSync(join(targetDir, `supply-opportunities-${runId}.json`), JSON.stringify(snapshot))
    writeFileSync(join(targetDir, `supply-process-${runId}.run.json`), JSON.stringify({
      runId, startedAt: runAt.toISOString(), status: 'done', completedAt: takenAt, runtimeSha: 'fixture-runtime-sha',
      runTokenShadow: origin === 'natural'
        ? {
            ok: true, code: null, tokenId: `token-${runId}`, trigger: 'scheduled', launchTrigger: 'scheduled',
            absorbedTrigger: null, absorbedAt: null, pass: 0, budgetWindow,
          }
        : origin === 'scheduled-followup'
          ? {
              ok: true, code: null, tokenId: `token-${runId}`, trigger: 'scheduled', launchTrigger: 'scheduled',
              absorbedTrigger: 'scheduled', absorbedAt: kstAt(date, budgetSlot ?? minute).toISOString(),
              pass: 1, budgetWindow,
            }
        : origin === 'event'
          ? {
              ok: true, code: null, tokenId: `token-${runId}`, trigger: 'scheduled', launchTrigger: 'scheduled',
              absorbedTrigger: 'event', absorbedAt: runAt.toISOString(), pass: 0, budgetWindow,
            }
          : origin === 'manual' ? {
              ok: true, code: null, tokenId: `token-${runId}`, trigger: 'manual', launchTrigger: 'manual',
              absorbedTrigger: null, absorbedAt: null, pass: 0, budgetWindow,
            } : {
              ok: true, code: null, tokenId: `token-${runId}`, trigger: 'scheduled', budgetWindow,
            },
      opportunityInventory: { status: 'written', runId, observedAt: takenAt, written, reason: null },
    }))
  }
  const SAMPLE_DATES = ['2026-10-31', '2026-11-01', '2026-11-02']
  const ids = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, k) => `${prefix}-${k}`)
  type DayPlan = {
    /** `skip` — 빠진 남은 회차의 순번(`FUTURE_RUNS` 의 index · 0 = 순유입을 처음 보는 회차) */
    baseline?: readonly string[] | null; inflowFirst: readonly string[]; skip?: readonly number[]
    origin?: 'natural' | 'event'; evidenceAt?: (date: string) => Date
    /** 기준선 원천이 소진돼 뒤 회차 inventory 에서 빠진다(재고 수준은 그대로 · 원천은 교체) */
    dropBaseline?: boolean
  }
  /** 🔴 하루 = 기준선 회차 + 07:00 뒤 남은 정기 회차 전부. 첫 회차가 순유입을 처음 보고, 뒤 회차는 같은 원천을 다시 본다 */
  const writeDay = (targetDir: string, date: string, p: DayPlan): void => {
    const base = p.baseline === undefined ? ids(`${date}-base`, 5) : p.baseline
    if (base !== null) snapshotAt(targetDir, date, base, BASE_RUN, p.evidenceAt?.(date))
    const seen = [...(base === null || p.dropBaseline === true ? [] : base), ...p.inflowFirst]
    FUTURE_RUNS.forEach((minute, i) => {
      if (p.skip?.includes(i)) return
      snapshotAt(targetDir, date, seen, minute, p.evidenceAt?.(date), p.origin ?? 'natural')
    })
  }
  /** 첫 남은 회차가 본 원천이 쓸 수 있게 되는 발행 분 — 회차 시작 + 회차 창 */
  const LATE = FIRST_RUN + SUPPLY_WINDOW_MINUTES
  // 발행 증명 슬롯 20 — 이른 3개(LATE 60·40·20분 전)는 아무도 못 채운다 · 늦은 17개는 LATE 부터 5분 간격(80분)
  const PROOF20 = [
    ...[60, 40, 20].map((before) => kstAt(target, LATE - before)),
    ...Array.from({ length: 17 }, (_, k) => kstAt(target, LATE + k * 5)),
  ]
  check('fixture — 둘째 남은 회차가 본 원천은 늦은 발행 슬롯이 다 지난 뒤에야 쓸 수 있다(첫 회차 누락 반례의 전제)',
    FUTURE_RUNS[1]! + SUPPLY_WINDOW_MINUTES > LATE + 16 * 5)
  const kstMinute = (d: Date): number => { const w = new Date(d.getTime() + 9 * 3600_000); return w.getUTCHours() * 60 + w.getUTCMinutes() }
  const opp = (key: string, ok: (minute: number) => boolean) => ({ key, validAt: (slot: Date) => ok(kstMinute(slot)) })
  const lateOnly = (prefix: string, n: number) => ids(prefix, n).map((k) => opp(k, (m) => m >= LATE))
  const earlyOnly = (prefix: string, n: number) => ids(prefix, n).map((k) => opp(k, (m) => m < LATE))
  const futureOf = (dataDir: string, o: {
    ready?: ReturnType<typeof opp>[]; current?: ReturnType<typeof opp>[]; y?: number | null; kstDate?: string
    recoveryHome?: string
  } = {}): number | null => measuredFutureSourceOpportunities({
    dataDir, kstDate: o.kstDate ?? target, now, proofSlots: PROOF20,
    ready: o.ready ?? [], current: o.current ?? [], readyPerSourceLow: o.y === undefined ? 1 : o.y,
    recoveryHome: o.recoveryHome,
  })
  const scenario = (name: string, plans: (date: string) => DayPlan): string => {
    const d = mkdtempSync(join(tmpdir(), `future-inflow-${name}-`))
    for (const date of SAMPLE_DATES) writeDay(d, date, plans(date))
    return d
  }
  const dirs: string[] = []
  const keep = (d: string): string => { dirs.push(d); return d }

  // ① 재현 — READY 10 · 미래 원천 17 이 모두 늦은 17슬롯에서만 유효 · 이른 3슬롯은 못 채운다
  const overlap = keep(scenario('overlap', (date) => ({ inflowFirst: ids(`${date}-new`, 17) })))
  const ready10 = lateOnly('ready', 10)
  FUTURE_UNION.overlap = futureOf(overlap, { ready: ready10 })
  check('🔴🔴 합집합 — READY 10 이 늦은 17슬롯을 먼저 쓰면 순유입 17 은 남은 늦은 7슬롯만 채운다 → 추가 7',
    FUTURE_UNION.overlap === 7, String(FUTURE_UNION.overlap))
  check('🔴 같은 겹침 — 현재 원천 10 이 늦은 슬롯만 유효해도 같은 슬롯을 다툰다(추가 7)',
    futureOf(overlap, { current: lateOnly('cur', 10) }) === 7)

  // ② 서로 다른 슬롯의 순유입 — READY 3 은 이른 슬롯, 순유입 17 은 늦은 슬롯 → 20/20
  FUTURE_UNION.distinct = futureOf(overlap, { ready: earlyOnly('ready', 3) })
  check('🟢 서로 다른 슬롯 — READY 3(이른) + 순유입 17(늦은) → 추가 17(85~90 선행 재고 없음)',
    FUTURE_UNION.distinct === 17, String(FUTURE_UNION.distinct))
  const turnover = keep(scenario('turnover', (date) => ({
    baseline: ids(`${date}-old`, 17), inflowFirst: ids(`${date}-new`, 17), dropBaseline: true,
  })))
  check('🟢 재고 수준은 17→17 그대로여도 원천이 통째로 바뀌었으면 새 원천 17 을 순유입으로 센다(재고 차이 0 이 아니다)',
    futureOf(turnover, { ready: earlyOnly('ready', 3) }) === 17)
  const noInflow = keep(scenario('flat', (date) => ({ baseline: ids(`${date}-old`, 17), inflowFirst: [] })))
  check('🔴 재고가 많아도(기준선 17 을 다시 봄) 새로 들어온 원천이 없으면 추가 0 — 재고 수준은 유입이 아니다',
    futureOf(noInflow, { ready: earlyOnly('ready', 3) }) === 0)
  const recoveredThenNatural = keep(scenario('recovered-then-natural', (date) => ({
    inflowFirst: ids(`${date}-recovered`, 17),
  })))
  const recoveryHome = mkdtempSync(join(tmpdir(), 'future-inflow-recovery-home-'))
  dirs.push(recoveryHome)
  for (const date of SAMPLE_DATES) {
    writeStageRecoverySourceReceipt({
      kstDate: date, nonce: `nonce-${date}`, runId: `recovery-${date}`,
      sourceHashes: ids(`${date}-recovered`, 17).map((id) => articleIdHashOf('navercafe:fixture', id)).slice(0, 10),
      now: new Date(`${date}T07:10:00+09:00`), home: recoveryHome,
    })
  }
  check('🔴🔴 복구에서 먼저 본 원천은 뒤 자연 snapshot에 나타나도 자연 순유입으로 다시 세지 않는다',
    futureOf(recoveredThenNatural, { recoveryHome }) === 7)
  writeFileSync(stageRecoverySourceReceiptPath(SAMPLE_DATES[1]!, `nonce-${SAMPLE_DATES[1]}`, recoveryHome), '{')
  check('🔴 복구 원천 영수증이 손상되면 순유입을 부풀리지 않고 UNKNOWN',
    futureOf(recoveredThenNatural, { recoveryHome }) === null)
  const weakDay = keep(scenario('weak', (date) => ({ inflowFirst: ids(`${date}-new`, date === '2026-11-01' ? 12 : 17) })))
  check('🔴 3일 중 가장 약한 날의 추가분을 쓴다(17·12·17 → 12)', futureOf(weakDay, { ready: earlyOnly('ready', 3) }) === 12)
  check('🔴 하한 수율로 할인한다 — 순유입 17 × 0.5 → 8(현재 0)', futureOf(overlap, { y: 0.5 }) === 8)
  const stale = keep(scenario('stale', (date) => ({
    inflowFirst: ids(`${date}-new`, 17), evidenceAt: (d) => new Date(`${addDays(d, -4)}T00:00:00+09:00`),
  })))
  check('🔴 순유입이어도 그날 같은 슬롯에서 신선도·품질 관문을 못 넘으면 추가 0', futureOf(stale, { ready: earlyOnly('ready', 3) }) === 0)

  // ③ H1 — 수율은 묶음마다 따로 곱한다. 현재 원천 300(이른 3슬롯만) · y=0.1 · 순유입 17(늦은 17슬롯만)
  const early300 = earlyOnly('cur', 300)
  const pooled = futureOf(overlap, { current: early300, y: 0.1 })
  const pooledCurrent = slotValidOpportunitiesOf({ slots: PROOF20, ready: [], sources: early300, readyPerSource: 0.1 }).total
  FUTURE_UNION.pooledCurrent = pooledCurrent
  FUTURE_UNION.pooled = pooled
  FUTURE_UNION.oldPooled = slotValidOpportunitiesOf({
    slots: PROOF20, ready: [], sources: [...early300, ...lateOnly('in', 17)], readyPerSource: 0.1,
  }).total - pooledCurrent
  check('🔴🔴 H1 — 현재 300(이른) 의 남는 수율을 순유입(늦은 17)에 빌려주지 않는다: 현재 3 + 추가 floor(17×0.1)=1 = 4',
    pooledCurrent === 3 && pooled === 1, `current=${pooledCurrent} future=${String(pooled)}`)
  check('🔴 H1 순수 산식 — 합집합 겹침 상한(17)과 순유입 자기 수율 상한(1) 중 작은 값',
    futureAdditionalOf({ slots: PROOF20, ready: [], current: early300, inflow: lateOnly('in', 17), readyPerSource: 0.1 }) === 1
    && futureAdditionalOf({ slots: PROOF20, ready: lateOnly('ready', 10), current: [], inflow: lateOnly('in', 17), readyPerSource: 1 }) === 7)

  // ④ 증명된 누락은 0 · 기준선 없음과 손상은 모름(null)
  const skipped = keep(scenario('skip', (date) => ({ inflowFirst: ids(`${date}-new`, 17), skip: date === '2026-11-01' ? [2] : [] })))
  check('🟢 M2 — 표본일 하나에 뒤 자연 회차 하나만 빠져도 첫 회차가 이미 본 순유입 17 은 센다(UNKNOWN 아님)',
    futureOf(skipped, { ready: earlyOnly('ready', 3) }) === 17)
  const skippedInflow = keep(scenario('skip-inflow', (date) => ({ inflowFirst: ids(`${date}-new`, 17), skip: date === '2026-11-01' ? [0] : [] })))
  check('🔴 M2 — 순유입을 처음 볼 회차가 빠지면 그 원천은 다음 회차에야 보인다 → 그날 늦은 가용(증명 슬롯 뒤) · 추가 0',
    futureOf(skippedInflow, { ready: earlyOnly('ready', 3) }) === 0)
  const noNatural = keep(scenario('no-natural', (date) => ({ inflowFirst: ids(`${date}-new`, 17), skip: date === '2026-11-01' ? FUTURE_RUNS.map((_, i) => i) : [] })))
  check('🔴 M2 — 기준선은 있고 자연 공급 회차가 하루 통째로 없으면 그날 추가 0 → 3일 최솟값 0',
    futureOf(noNatural, { ready: earlyOnly('ready', 3) }) === 0)
  const noBase = keep(scenario('nobase', (date) => ({ inflowFirst: ids(`${date}-new`, 17), baseline: date === SAMPLE_DATES[0] ? null : undefined })))
  check('🔴 첫 표본일 07:00 기준선 inventory 가 없으면 순유입을 셀 수 없다 → UNKNOWN', futureOf(noBase) === null)
  const eventOnly = keep(scenario('event', (date) => ({ inflowFirst: ids(`${date}-new`, 17), origin: 'event' })))
  check('🔴 슬롯 창 안 event kickstart 회차는 자연 표본이 아니다 → 추가 0(부풀리지 않는다)', futureOf(eventOnly, { ready: earlyOnly('ready', 3) }) === 0)
  const corrupt = keep(scenario('corrupt', (date) => ({ inflowFirst: ids(`${date}-new`, 17) })))
  writeFileSync(join(corrupt, `supply-opportunities-${runIdAt('2026-11-01', FUTURE_RUNS[1]!)}.json`), '{')
  check('🔴 M2 — 남은 슬롯 표본 하나라도 손상이면 여전히 UNKNOWN(누락이 아니다)', futureOf(corrupt) === null)
  const orphan = keep(scenario('orphan', (date) => ({ inflowFirst: ids(`${date}-new`, 17) })))
  rmSync(join(orphan, `supply-opportunities-${runIdAt('2026-11-01', FUTURE_RUNS[2]!)}.json`))
  check('🔴 M2 — 자연 회차가 snapshot written 을 주장하는데 파일이 없으면 손상 → UNKNOWN', futureOf(orphan) === null)
  const twoDays = keep(mkdtempSync(join(tmpdir(), 'future-inflow-two-')))
  for (const date of SAMPLE_DATES.slice(1)) writeDay(twoDays, date, { inflowFirst: ids(`${date}-new`, 17) })
  check('🔴 표본 3일 중 하루가 통째로 없으면(기준선 없음) UNKNOWN', futureOf(twoDays) === null)
  check('🔴 하한 수율을 모르거나 kstDate·now 날짜가 어긋나면 UNKNOWN',
    futureOf(overlap, { y: null }) === null && futureOf(overlap, { kstDate: '2026-11-05' }) === null)

  // ⑤ M2 — 끝난 failed 회차도 snapshot·marker 가 온전하면 표본이다 · running · marker 손상은 모름
  const runPath = (dir: string, date: string, minute: number): string =>
    join(dir, `supply-process-${runIdAt(date, minute)}.run.json`)
  const patchRun = (dir: string, date: string, minute: number, patch: Record<string, unknown>): void => {
    const path = runPath(dir, date, minute)
    writeFileSync(path, JSON.stringify({ ...(JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>), ...patch }))
  }
  const markerOf = (dir: string, date: string, minute: number): Record<string, unknown> =>
    (JSON.parse(readFileSync(runPath(dir, date, minute), 'utf-8')) as { opportunityInventory: Record<string, unknown> }).opportunityInventory
  const inflowPlan = (date: string): DayPlan => ({ inflowFirst: ids(`${date}-new`, 17) })
  const failedOk = keep(scenario('failed-written', inflowPlan))
  patchRun(failedOk, '2026-11-01', FIRST_RUN, { status: 'failed' })
  patchRun(failedOk, '2026-11-02', BASE_RUN, { status: 'failed' })
  check('🟢 M2 — 다른 단계가 실패한(failed) 자연 회차도 snapshot·marker·runId·시각·SHA 가 온전하면 표본·기준선이다(대조와 같은 17)',
    futureOf(failedOk, { ready: earlyOnly('ready', 3) }) === 17 && futureOf(overlap, { ready: earlyOnly('ready', 3) }) === 17)
  const failedBadMarker = keep(scenario('failed-bad-marker', inflowPlan))
  patchRun(failedBadMarker, '2026-11-01', FIRST_RUN, {
    status: 'failed',
    opportunityInventory: { ...markerOf(failedBadMarker, '2026-11-01', FIRST_RUN), status: 'failed', written: null, reason: 'write EIO' },
  })
  const failedDriftMarker = keep(scenario('failed-drift-marker', inflowPlan))
  patchRun(failedDriftMarker, '2026-11-01', FIRST_RUN, {
    status: 'failed',
    opportunityInventory: { ...markerOf(failedDriftMarker, '2026-11-01', FIRST_RUN), observedAt: '2026-11-01T00:00:00.000Z' },
  })
  check('🔴 M2 — failed 회차의 marker 가 written 이 아니거나 snapshot 과 어긋나면 UNKNOWN',
    futureOf(failedBadMarker) === null && futureOf(failedDriftMarker) === null)
  const runningWritten = keep(scenario('running-written', inflowPlan))
  patchRun(runningWritten, '2026-11-01', FIRST_RUN, { status: 'running', completedAt: null })
  const runningBaseline = keep(scenario('running-baseline', inflowPlan))
  patchRun(runningBaseline, '2026-11-01', BASE_RUN, { status: 'running', completedAt: null })
  const unknownStatus = keep(scenario('unknown-status', inflowPlan))
  patchRun(unknownStatus, '2026-11-01', FIRST_RUN, { status: 'partial' })
  check('🔴 M2 — running(완료 시각 없음)·모르는 상태는 snapshot·marker 가 written 이어도 UNKNOWN(표본·기준선 모두)',
    futureOf(runningWritten) === null && futureOf(runningBaseline) === null && futureOf(unknownStatus) === null)
  /** 2026-11-01 의 셋째 남은 자연 회차의 기회 파일을 지우고 marker 를 비운다 — snapshot 을 주장하지 않는 회차 기록만 남는다 */
  const noSnapshot = (name: string, patch: Record<string, unknown>): string => {
    const dir = keep(scenario(name, inflowPlan))
    rmSync(join(dir, `supply-opportunities-${runIdAt('2026-11-01', FUTURE_RUNS[2]!)}.json`))
    patchRun(dir, '2026-11-01', FUTURE_RUNS[2]!, { opportunityInventory: null, ...patch })
    return dir
  }
  check('🟢 M2 대조 — 끝난(done) 자연 회차가 snapshot 없이 written 도 주장하지 않으면 증명된 누락 → 그 회차 0 · 첫 회차 순유입 17',
    futureOf(noSnapshot('nosnap-done', {}), { ready: earlyOnly('ready', 3) }) === 17)
  check('🔴 M2 — running 자연 회차가 snapshot 없이 marker 도 없으면 누락이 아니라 UNKNOWN',
    futureOf(noSnapshot('nosnap-running', { status: 'running', completedAt: null }), { ready: earlyOnly('ready', 3) }) === null)
  check('🔴 M2 — 모르는 상태(partial) 자연 회차가 snapshot 없이 marker 도 없으면 UNKNOWN',
    futureOf(noSnapshot('nosnap-unknown', { status: 'partial' }), { ready: earlyOnly('ready', 3) }) === null)
  check('🔴 M2 — done 이어도 completedAt 이 깨졌거나 판정 시각 뒤면 snapshot 없는 회차는 UNKNOWN',
    futureOf(noSnapshot('nosnap-bad-completed', { completedAt: 'not-a-date' }), { ready: earlyOnly('ready', 3) }) === null
    && futureOf(noSnapshot('nosnap-future-completed', { completedAt: '2026-11-05T00:00:00.000Z' }), { ready: earlyOnly('ready', 3) }) === null)

  // ⑥ 기준선 provenance — 07:00 판정의 기준선은 그날 07:00 전에 창이 끝난 마지막 자연 정기 회차 하나다
  /** 표본일 전날 마지막 회차 · 같은 날 더 이른 회차의 자연 snapshot — 기준선 회차가 없을 때 내려가 읽으면 안 되는 자리 */
  const EARLIER_RUNS = SUPPLY_MINUTES.filter((m) => m < BASE_RUN)
  const priorNight = (dir: string): void => {
    for (const date of SAMPLE_DATES) {
      snapshotAt(dir, addDays(date, -1), ids(`${date}-base`, 5), SUPPLY_MINUTES.at(-1)!)
      for (const minute of EARLIER_RUNS) snapshotAt(dir, date, ids(`${date}-base`, 5), minute)
    }
  }
  const missingAll = keep(scenario('base-missing-all', (date) => ({ ...inflowPlan(date), baseline: null })))
  priorNight(missingAll)
  check('🔴🔴 기준선 — 세 표본일 모두 기준선 회차가 없고 전날 밤 · 더 이른 회차의 자연 snapshot 이 온전해도 UNKNOWN(내려가지 않는다)',
    futureOf(missingAll) === null)
  const priorControl = keep(scenario('base-prior-control', inflowPlan))
  priorNight(priorControl)
  check('🟢 기준선 대조 — 기준선 회차가 있으면 같은 전날 밤 · 더 이른 회차가 있어도 기준선 회차로 센다(17)',
    futureOf(priorControl, { ready: earlyOnly('ready', 3) }) === 17)
  const nonNaturalBase = (origin: 'event' | 'manual'): string => {
    const dir = keep(scenario(`base-${origin}`, (date) => ({ ...inflowPlan(date), baseline: null })))
    for (const date of SAMPLE_DATES) snapshotAt(dir, date, ids(`${date}-base`, 5), BASE_RUN, undefined, origin)
    priorNight(dir)
    return dir
  }
  check('🔴 기준선 — 세 표본일의 기준선 회차가 event·manual 실행뿐이면 UNKNOWN(비자연 회차를 기준선으로 쓰지 않는다)',
    futureOf(nonNaturalBase('event')) === null && futureOf(nonNaturalBase('manual')) === null)
  const corruptBase = keep(scenario('base-corrupt', inflowPlan))
  writeFileSync(join(corruptBase, `supply-opportunities-${runIdAt('2026-11-01', BASE_RUN)}.json`), '{')
  const noShaBase = keep(scenario('base-no-sha', inflowPlan))
  patchRun(noShaBase, '2026-11-01', BASE_RUN, { runtimeSha: '' })
  check('🔴 기준선 — 기준선 회차 snapshot 손상 · runtimeSha 없음이면 UNKNOWN',
    futureOf(corruptBase) === null && futureOf(noShaBase) === null)
  check('🔴 기준선 — 창이 끝난 정기 회차가 아직 없는 시각(첫 회차 창이 끝나기 10분 전)의 판정은 UNKNOWN(전날 밤으로 내려가지 않는다)',
    SUPPLY_MINUTES[0]! + SUPPLY_WINDOW_MINUTES - 10 >= 0
    && measuredFutureSourceOpportunities({
      dataDir: priorControl, kstDate: target, now: kstAt(target, SUPPLY_MINUTES[0]! + SUPPLY_WINDOW_MINUTES - 10), proofSlots: PROOF20,
      ready: [], current: [], readyPerSourceLow: 1,
    }) === null)
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
}
const cohortFor = (s: GenericStage, o: Partial<ReadyCohortFact> = {}): ReadyCohortFact => {
  const usd = o.usdPerSlotValidResult === undefined ? SUPPLY_USD_PER_READY : o.usdPerSlotValidResult
  return {
    sources: RUNS, published: genericDailyTarget(s), lost: 0, scheduled: 0, unknown: 0,
    usdPerSlotValidResult: usd, ...o,
    trialCost: o.trialCost === undefined ? (usd === null ? null : {
      settledRequests: 20, usageUnknownRequests: 0, overrunRequests: 0, ineligibleRequests: 0,
      riskUsdPerSlotValidResult: usd,
    }) : o.trialCost,
  }
}
const factsFor = (s: GenericStage, o: Partial<PreflightFacts> = {}): PreflightFacts => ({
  proofKstDate: '2026-11-05',
  slotValidOpportunities: genericDailyTarget(s), readyCohort: cohortFor(s), latencyP50H: 20, latencyP90H: 60,
  contractValidPersonas: s === 'd1' ? 1 : PERSONA_CANARY_FLOOR[s],
  // 🔴 2026-11-13 — D30 이상은 stage-active 도 하한을 넘어야 연다(canon §4). 기준선은 하한과 같은 수가 active 다
  stageActivePersonas: s === 'd1' ? 1 : PERSONA_CANARY_FLOOR[s],
  supplyDailyUsdCap: supplyApprovedDailyUsdOf('2026-11-05'),...o,
})
const D20_TRANSITION = judgeNextPreflight('d20', factsFor('d20', {
    readyCohort: cohortFor('d20', { sources: 95, published: 19, lost: 0, scheduled: 1, unknown: 1, usdPerSlotValidResult: 0.0502934 }),
  }), GRID)
check('🔴 D20 전환일 실측 수율 — READY 21/원천 95 × 묶음 20 × 하루 정기 회차 수 = 용량 · 최대 필요 21을 채운다',
  D20_TRANSITION.counts.readyCapacity === Math.floor((21 * SUPPLY_WORKSET_PER_RUN * SUPPLY_RUNS_PER_DAY) / 95)
  && D20_TRANSITION.counts.readyNeededMax === 21 && (D20_TRANSITION.counts.readyCapacity ?? 0) >= 21
  && !D20_TRANSITION.forecastWarnings.includes('THROUGHPUT_SHORT') && !D20_TRANSITION.codes.includes('THROUGHPUT_SHORT'))
check('🔴 용량 산식 — 회차 수 인자를 넘기면 그 수로 센다(묶음 18 · 5회면 용량 19라 최대 필요 21 미달) · 안 넘기면 하루 정기 회차 수',
  readyCapacityOf(21, 95, 18, 5) === 19
  && (readyCapacityOf(21, 95, 18, 5) ?? 0) < (D20_TRANSITION.counts.readyNeededMax ?? 0)
  && readyCapacityOf(21, 95, 18) === readyCapacityOf(21, 95, 18, SUPPLY_RUNS_PER_DAY)
  && readyCapacityOf(21, 95, 18) === Math.floor((21 * 18 * SUPPLY_RUNS_PER_DAY) / 95))
check('🔴 비용 변동 경계 — 결과당 실측 비용이 30% 상승하면 D20은 $1.20 증명 예산을 넘어 자동으로 열리지 않는다',
  judgeNextPreflight('d20', factsFor('d20', {
    readyCohort: cohortFor('d20', {
      sources: 95, published: 19, lost: 0, scheduled: 1, unknown: 1,
      usdPerSlotValidResult: 0.0502934 * 1.3,
    }),
  }), GRID).warnings.includes('SUPPLY_COST_SHORT'))
const COST_EDGE_PASS = judgeNextPreflight('d20', factsFor('d20', {
  readyCohort: cohortFor('d20', { usdPerSlotValidResult: 0.058 }),
}), GRID)
const COST_EDGE_FAIL = judgeNextPreflight('d20', factsFor('d20', {
  readyCohort: cohortFor('d20', { usdPerSlotValidResult: 0.060001 }),
}), GRID)
check('🔴 공급 비용·처리량 경계는 같은 목표 20을 센다 — $0.058은 용량 20·$1.16으로 PASS, $0.060001은 $1.20 초과 FAIL',
  COST_EDGE_PASS.counts.readyCapacity === 20
  && Math.abs((COST_EDGE_PASS.counts.supplyDailyUsdNeeded ?? 0) - 1.16) < 1e-9
  && !COST_EDGE_PASS.forecastWarnings.includes('THROUGHPUT_SHORT')
  && !COST_EDGE_PASS.warnings.includes('SUPPLY_COST_SHORT')
  && COST_EDGE_FAIL.warnings.includes('SUPPLY_COST_SHORT'))
{
  // 🔴 2026-11-16 창업자 결정 — 11-17 부터 공급 승인 천장 $1.80. env 를 $1.80 으로 올려도 천장이 날짜 계약이므로
  //    11-16 증명일에는 $1.20 으로 눌린다(소급 0). 11-17 D30(30편)은 실측 $0.052/result → $1.56 으로 PASS 해야 한다.
  const capOf = (date: string): number => Math.min(1.80, supplyApprovedDailyUsdOf(date) ?? 0)
  const d30 = (date: string, usd: number) => judgeNextPreflight('d30', factsFor('d30', {
    proofKstDate: date, supplyDailyUsdCap: capOf(date), readyCohort: cohortFor('d30', { usdPerSlotValidResult: usd }),
  }), GRID)
  const open1117 = d30('2026-11-17', 0.052)
  const shut1116 = d30('2026-11-16', 0.052)
  const edgePass = d30('2026-11-17', 0.06)
  const edgeFail = d30('2026-11-17', 0.060001)
  check('🔴 11-17 D30 — env $1.80 · 날짜 천장 $1.80 · 결과당 $0.052 × 30 = $1.56 → SUPPLY_COST_SHORT 없음 · 증명 예산 $1.80',
    !open1117.warnings.includes('SUPPLY_COST_SHORT') && open1117.counts.supplyProofBudgetUsd === 1.8
    && Math.abs((open1117.counts.supplyDailyUsdNeeded ?? 0) - 1.56) < 1e-9, JSON.stringify(open1117.codes))
  check('🔴 11-16 은 env 가 $1.80 이어도 날짜 천장 $1.20 으로 눌려 SUPPLY_COST_SHORT (소급 0)',
    shut1116.warnings.includes('SUPPLY_COST_SHORT') && shut1116.counts.supplyProofBudgetUsd === 1.2, JSON.stringify(shut1116.counts))
  check('🔴 11-17 경계 — $0.060 × 30 = $1.80 PASS · $0.060001 FAIL',
    !edgePass.warnings.includes('SUPPLY_COST_SHORT') && edgeFail.warnings.includes('SUPPLY_COST_SHORT'))
}
check('비용 상한 정본 — 공급 승인 천장 11-16 까지 $1.20 · 11-17 부터 $1.80 · 댓글 기본 $0.20 / 승인 천장 $0.50',
  supplyApprovedDailyUsdOf('2026-11-16') === 1.2 && supplyApprovedDailyUsdOf('2026-11-17') === 1.8
  && COMMENT_LOOP_DAILY_USD_DEFAULT === 0.2 && COMMENT_LOOP_DAILY_USD_MAX === 0.5)
check('🔴 저예산 천장은 날짜 계약의 분수 칸(5/7)만 비용 용량으로 센다 — 실측 D20은 막고 저비용 D10은 연다',
  supplyCostProofBudgetUsd('2026-11-05', 1.19) === 1.19 * 5 / 7
  && judgeNextPreflight('d20', factsFor('d20', {
    supplyDailyUsdCap: 1.19,
    readyCohort: cohortFor('d20', { sources: 95, published: 19, lost: 0, scheduled: 1, unknown: 1, usdPerSlotValidResult: 0.0502934 }),
  }), GRID).warnings.includes('SUPPLY_COST_SHORT')
  && !judgeNextPreflight('d10', factsFor('d10', { supplyDailyUsdCap: 0.5 }), GRID).warnings.includes('SUPPLY_COST_SHORT'))
for (const s of ['d3', 'd5', 'd10', 'd20', 'd30', 'd50'] as const) {
  const v = judgeNextPreflight(s, factsFor(s), GRID)
  check(`${s} preflight PASS — 댓글 ${v.counts.firstComments}건 · 감사 ${v.counts.auditExpected}건 · READY ${v.counts.readyNeeded}건 비용 상한 안`,
    v.verdict === 'PASS', `${v.verdict} [${v.codes.join(',')}]`)
}
{
  const enough = judgeNextPreflight('d20', factsFor('d20', {
    slotValidOpportunities: 16, futureSupplyCapacity: 4,
  }), GRID)
  const short = judgeNextPreflight('d20', factsFor('d20', {
    slotValidOpportunities: 16, futureSupplyCapacity: 3,
  }), GRID)
  const unknown = judgeNextPreflight('d20', factsFor('d20', {
    slotValidOpportunities: 16, futureSupplyCapacity: null,
  }), GRID)
  const alreadyEnough = judgeNextPreflight('d20', factsFor('d20', {
    slotValidOpportunities: 20, futureSupplyCapacity: null,
  }), GRID)
  check('🔴 현재 16 + 보수 미래 4 = D20 기회 PASS (미래를 READY 재고로 세지 않고 opportunity 축만 보완)',
    enough.verdict === 'PASS' && enough.counts.opportunitiesCurrent === 16
    && enough.counts.opportunitiesFuture === 4 && enough.counts.opportunities === 20)
  check('🔴 현재 16 + 미래 3이면 SHORT, 미래 수율 모름이면 UNKNOWN — 둘 다 막지 않는 예측 경고(판정 PASS)',
    short.forecastWarnings.includes('OPPORTUNITY_SHORT') && unknown.forecastWarnings.includes('OPPORTUNITY_UNKNOWN')
    && short.verdict === 'PASS' && unknown.verdict === 'PASS')
  const oldArithmetic = judgeNextPreflight('d20', factsFor('d20', { slotValidOpportunities: 10, futureSupplyCapacity: 17 }), GRID)
  const unionVerdict = judgeNextPreflight('d20', factsFor('d20', { slotValidOpportunities: 10, futureSupplyCapacity: FUTURE_UNION.overlap }), GRID)
  const distinctVerdict = judgeNextPreflight('d20', factsFor('d20', { slotValidOpportunities: 3, futureSupplyCapacity: FUTURE_UNION.distinct }), GRID)
  check('🔴 반례 고정 — 고치기 전 산식(재고 17 − 현재 원천 0 = 17)은 READY 10 + 17 → D20 기회 20 PASS 였다',
    oldArithmetic.counts.opportunities === 20 && !oldArithmetic.forecastWarnings.includes('OPPORTUNITY_SHORT'))
  check('🔴🔴 합집합 산출(READY 10 + 추가 7)을 넣으면 D20 기회 17/20 → OPPORTUNITY_SHORT 예측 경고(산술 그대로 · 시험은 막지 않는다)',
    unionVerdict.counts.opportunities === 17 && unionVerdict.forecastWarnings.includes('OPPORTUNITY_SHORT')
    && !unionVerdict.codes.includes('OPPORTUNITY_SHORT'),
    `opp=${String(unionVerdict.counts.opportunities)} [${unionVerdict.forecastWarnings.join(',')}]`)
  check('🟢 서로 다른 슬롯 산출(READY 3 + 추가 17)이면 D20 기회 20 — 예측 경고 없음',
    distinctVerdict.counts.opportunities === 20 && !distinctVerdict.forecastWarnings.includes('OPPORTUNITY_SHORT'))
  const pooledVerdict = judgeNextPreflight('d20', factsFor('d20', {
    slotValidOpportunities: FUTURE_UNION.pooledCurrent, futureSupplyCapacity: FUTURE_UNION.pooled,
  }), GRID)
  check('🔴🔴 H1 — 같은 사실로 D20 은 OPPORTUNITY_SHORT(4/20) 예측 경고 · 고치기 전 합집합 단독 산식은 추가 17 → 20/20 거짓 green 이었다',
    pooledVerdict.counts.opportunities === 4 && pooledVerdict.forecastWarnings.includes('OPPORTUNITY_SHORT')
    && FUTURE_UNION.oldPooled === 17,
    `opp=${String(pooledVerdict.counts.opportunities)} old=${String(FUTURE_UNION.oldPooled)} [${pooledVerdict.forecastWarnings.join(',')}]`)
  check('🟢 현재 기회가 이미 목표면 미래를 몰라도 예측 경고가 없다',
    alreadyEnough.verdict === 'PASS' && !alreadyEnough.forecastWarnings.includes('OPPORTUNITY_UNKNOWN'))
}
{
  const s20 = judgeNextPreflight('d20', factsFor('d20'), GRID)
  check('🔴 canary 하한(d20 40명)이면 연다 — 지속 목표(60명)로 막지 않는다',
    PERSONA_CANARY_FLOOR.d20 === 40 && PERSONA_SUSTAINED_TARGET.d20 === 60 && s20.verdict === 'PASS' && s20.counts.personaFloor === 40)
  check('Persona canary 하한 미달(39) → FAIL PERSONA_SHORT',
    judgeNextPreflight('d20', factsFor('d20', { contractValidPersonas: 39 }), GRID).codes.includes('PERSONA_SHORT'))
}
const pf100 = judgeNextPreflight('d100', factsFor('d100'), GRID)
console.log(`   d100: ${pf100.verdict} [${pf100.codes.join(',')}] · 댓글 감당 ${pf100.counts.commentAffordable}건/day`)
check('🔴 [blocker 실측] d100 — 바퀴 몫이 짧은 바퀴의 틱에 담기지 않아(SLOTS_INFEASIBLE) 자동 통과하지 않는다 · 하루 용량(144)은 모자라지 않다',
  pf100.verdict === 'FAIL' && pf100.codes.includes('SLOTS_INFEASIBLE') && !pf100.codes.includes('PUBLISH_CAPACITY_SHORT'),
  `[${pf100.codes.join(',')}] 용량 ${String(pf100.counts.publishCapacity)}`)
/**
 * 🔴 **세 갈래** (PR1b · 2026-11-06 · canon §3.1·§3.2·§9):
 *    · `block`    — hard gate. 막는 `codes` 에 있고 판정을 FAIL/UNKNOWN 으로 만든다
 *    · `forecast` — 원천 기회·처리량·READY 필요량 예측. `forecastWarnings` 에만 있고 막지 않는다
 *    · `observe`  — 지연 관측 같은 막지 않는 경고. `warnings` 에만 있다
 *    `want` 는 최종 판정이다 — 예측 사례도 같은 사실이 hard gate 를 함께 모르게 하면(cohort 모름 → 비용 모름) UNKNOWN 이다.
 */
type PfLane = 'block' | 'forecast' | 'observe'
const pfCases: { name: string; s: GenericStage; o: Partial<PreflightFacts>; want: 'PASS' | 'FAIL' | 'UNKNOWN'; code: string; lane?: PfLane }[] = [
  { name: 'slot-valid 기회 19 < 20 — 예측 경고(막지 않는다)', s: 'd20', o: { slotValidOpportunities: 19 }, want: 'PASS', code: 'OPPORTUNITY_SHORT', lane: 'forecast' },
  { name: '기회 모름 — 예측 경고', s: 'd20', o: { slotValidOpportunities: null }, want: 'PASS', code: 'OPPORTUNITY_UNKNOWN', lane: 'forecast' },
  { name: 'D3 도 같은 관문 — 기회 2 < 3 · 예측 경고', s: 'd3', o: { slotValidOpportunities: 2 }, want: 'PASS', code: 'OPPORTUNITY_SHORT', lane: 'forecast' },
  { name: '수율이 필요량 아래(처리량 부족) — 예측 경고', s: 'd20', o: { readyCohort: cohortFor('d20', { sources: Math.ceil(RUNS / 0.9) }) }, want: 'PASS', code: 'THROUGHPUT_SHORT', lane: 'forecast' },
  { name: 'cohort 모름 — 처리량 예측 경고(비용도 모름 경고 · 막지 않는다)', s: 'd20', o: { readyCohort: null }, want: 'PASS', code: 'THROUGHPUT_UNKNOWN', lane: 'forecast' },
  { name: '🔴 계약 유효 Persona 모름(읽기 실패)', s: 'd3', o: { contractValidPersonas: null }, want: 'UNKNOWN', code: 'PERSONA_UNKNOWN' },
  { name: '🔴 계약 유효 Persona 0 < D3 하한 24 (2026-09-30 운영 실측) — D1→D3 부터 막힌다', s: 'd3', o: { contractValidPersonas: 0 }, want: 'FAIL', code: 'PERSONA_SHORT' },
  { name: '공급 결과당 비용 $0.025 × 목표 50 > $1.20 — 비용 경고(막지 않는다)', s: 'd50', o: { readyCohort: cohortFor('d50', { usdPerSlotValidResult: 0.025 }) }, want: 'PASS', code: 'SUPPLY_COST_SHORT', lane: 'observe' },
  { name: '🔴 결말 절반이 모름(공개 5 · 모름 5) → 필요량 상한까지는 못 채운다 → 예측 경고', s: 'd5', o: { readyCohort: cohortFor('d5', { unknown: 5, sources: RUNS * 1.5 }) }, want: 'PASS', code: 'READY_REQUIREMENT_UNKNOWN', lane: 'forecast' },
  { name: '🔴 실측 손실 1 · 같은 cohort 용량 5 → 필요 READY 6 → 처리량 부족(예측 경고 · 산술은 그대로)', s: 'd5', o: { readyCohort: cohortFor('d5', { lost: 1, sources: Math.ceil((RUNS * 6) / 5) }) }, want: 'PASS', code: 'THROUGHPUT_SHORT', lane: 'forecast' },
  { name: '결과당 공급 비용 모름(미연결 · legacy)', s: 'd20', o: { readyCohort: cohortFor('d20', { usdPerSlotValidResult: null }) }, want: 'PASS', code: 'SUPPLY_COST_UNKNOWN', lane: 'observe' },
  { name: '공급 상한 모름', s: 'd20', o: { supplyDailyUsdCap: null }, want: 'PASS', code: 'SUPPLY_COST_UNKNOWN', lane: 'observe' },
]
for (const c of pfCases) {
  const v = judgeNextPreflight(c.s, factsFor(c.s, c.o), GRID)
  const lane = c.lane ?? 'block'
  const inBlock = (v.codes as readonly string[]).includes(c.code)
  const inForecast = (v.forecastWarnings as readonly string[]).includes(c.code)
  const inObserve = (v.warnings as readonly string[]).includes(c.code)
  const placed = lane === 'block' ? inBlock && !inForecast && !inObserve
    : lane === 'forecast' ? inForecast && !inBlock && !inObserve
      : inObserve && !inBlock && !inForecast
  check(`${c.s} ${c.name} → ${c.want} · ${lane} ${c.code}`, v.verdict === c.want && placed,
    `${v.verdict} codes=[${v.codes.join(',')}] forecast=[${v.forecastWarnings.join(',')}] warn=[${v.warnings.join(',')}]`)
}
check(`감사 표본 = 정본 auditTarget 20% (d20 → ${auditTarget(20)} · d50 → ${auditTarget(50)})`, auditTarget(20) === 4 && auditTarget(50) === 10)
// 장부 → 단가 (controller 가 쓰는 순수 함수)
{
  check('못 읽은 장부의 정산 합계는 모름(null)', settledTotalUsd(null) === null)
  check('상한 — 두 값 중 낮은 쪽 · 하나라도 모르면 모름', cappedBy(0.3, 0.5) === 0.3 && cappedBy(0.9, 0.5) === 0.5 && cappedBy(null, 0.5) === null)
}

// ─────────────────────────────────────────────────────────
section('⑤ 상태 기계 — 운영 decideStage 를 날마다 돌린다')

/** 그날의 운영 모양 */
type DayMode = 'perfect' | 'short' | 'human' | 'manualRun' | 'noFirst' | 'thin' | 'brokenProv' | 'auditShort' | 'costUnknown' | 'unread'

const OK_SIGNALS: HealthSignal[] = [
  { axis: 'quality', health: 'ok', reasons: [] }, { axis: 'cost', health: 'ok', reasons: [] }, { axis: 'errors', health: 'ok', reasons: [] },
]
const BAD_COST: HealthSignal[] = [OK_SIGNALS[0]!, { axis: 'cost', health: 'bad', reasons: ['공급 장부: UNSETTLED_OVERRUN'] }, OK_SIGNALS[2]!]

/**
 * 그날 실제로 일어난 일 — 결정의 공개 단계 슬롯에 글이 나가고, 첫 댓글은 댓글 러너의 실제 대기(글 id 로 정해지는 3~9분)
 * 뒤 30초에 붙고, 추가 댓글 5건이 서로 다른 화자로 이어진다.
 */
function factsOfDay(d: StageDecision, mode: DayMode): StageEvidenceFacts | null {
  if (mode === 'unread') return null
  const p = profileOf(d.release)
  const slots = mode === 'short' ? p.slots.slice(0, Math.floor(p.slots.length / 2)) : p.slots
  const posts: EvidencePost[] = slots.map((sl, i) => {
    const postId = `p-${d.kstDate}-${i}`
    const t = Date.parse(`${d.kstDate}T00:00:00+09:00`) + minuteOfDay(sl) * 60_000
    const human = mode === 'human'
    const first = mode === 'noFirst' ? [] : [{
      personaId: `c-${i}-0`, createdAtMs: t + firstCommentDelayMs(postId) + 30_000, topLevel: true,
      provenance: mode === 'brokenProv' && i === 0 ? 'broken' as const : 'auto' as const,
    }]
    const followups = (mode === 'thin' ? [1] : [1, 2, 3, 4, 5]).map((k) => ({
      personaId: `c-${i}-${k}`, createdAtMs: t + (k + 1) * 20 * 60_000, topLevel: true, provenance: 'followup' as const,
    }))
    return {
      postId, queueId: `q-${d.kstDate}-${i}`, publishedAtMs: t, capturedAtMs: t - 90 * 60_000,
      unattended: mode !== 'manualRun', queueRows: 1, publishLogs: 1, authorPersonaId: `a-${i}`,
      decider: human ? 'human' : 'auto', release: 'STAMPED_ELIGIBLE' as const,
      personaComments: [...first, ...followups],
    }
  })
  const auto = posts.filter((x) => x.decider === 'auto' && x.unattended)
  const want = auditTarget(auto.length)
  const rows = auto.slice(0, mode === 'auditShort' ? Math.max(0, want - 1) : want).map((x) => ({ postId: x.postId, queueId: x.queueId ?? '', judged: true }))
  return {
    kstDate: d.kstDate, stage: d.release,
    decision: { kstDate: d.kstDate, release: d.release, decidedBy: d.decidedBy },
    // 다음 날 07:00 — 그날 글의 첫 댓글 창과 대화 마감이 전부 닫혀 있다
    readAtMs: Date.parse(at0700(addDays(d.kstDate, 1))),
    posts, orphanPublishLogs: 0, unloggedPublishes: 0,
    audits: { rows },
  }
}
const evidenceOfDay = (d: StageDecision, mode: DayMode): StageEvidenceVerdict =>
  judgeStageEvidence(d.kstDate, d.release, factsOfDay(d, mode),
    mode === 'costUnknown'
      ? { cost: [{ lane: 'comment', name: '댓글', health: 'unknown' }, { lane: 'audit', name: '감사', health: 'ok' }], supplyCostEvidence: SIDE_OK.supplyCostEvidence }
      : SIDE_OK)

type DayOpts = { facts?: (s: GenericStage) => PreflightFacts; signals?: HealthSignal[] }
type Day = { decision: StageDecision; valid: ValidatedStageDecision | null; result: ControllerResult; evidence: StageEvidenceVerdict | null; reason: string }
type Past = { decision: ValidatedStageDecision; mode: DayMode }

/** 07:00 controller 한 번 — controller 스크립트와 같은 순서: 전날·이틀 전 판정 → 열린 단계 → 올라갈 칸 preflight → 결정 → 저장 검증 */
function runDay(kstDate: string, prev: Past | null, before: Past | null, o: DayOpts = {}): Day {
  const evidence = prev === null ? null : evidenceOfDay(prev.decision, prev.mode)
  const dayBefore = before === null ? null : { decision: before.decision, evidence: evidenceOfDay(before.decision, before.mode) }
  const up = prev === null ? null : nextStage(openStageOf(prev.decision, dayBefore?.decision ?? null))
  const nextPreflight: PreflightVerdict | null = up === null ? null : judgeNextPreflight(up, (o.facts ?? ((s) => factsFor(s)))(up), GRID)
  const result = decideStage({
    kstDate, decidedAt: at0700(kstDate), previousDecision: prev?.decision ?? null, previousEvidence: evidence, dayBefore,
    nextPreflight, publishedToday: 0, signals: o.signals ?? OK_SIGNALS,
  })
  const v = validateForToday(result.decision)
  return { decision: result.decision, valid: v.ok ? v.decision : null, result, evidence, reason: v.ok ? '' : v.reason }
}

const validated = (row: Record<string, unknown>): ValidatedStageDecision | string => {
  const v = validateStoredDecision({ row, expectKstDate: String(row.kstDate) })
  return v.ok ? v.decision : v.reason
}
const rowOf = (kstDate: string, release: RuntimeStage, state: string, transition: unknown, contractVersion: string = STAGE_DECISION_VERSION) => ({
  kstDate, capacity: preparedStageOf(release), release, state, reasons: [], blocks: [], dayPinned: false, supply: null,
  decidedAt: at0700(kstDate), contractVersion, decidedBy: DECISION_WRITER, transition,
})
/** 시작 행 — controller 가 쓴 유지 행 */
function startRow(release: RuntimeStage, kstDate: string = D0): ValidatedStageDecision {
  const r = validated(rowOf(kstDate, release, preparedStageOf(release) === release ? 'HOLD' : 'PREPARE', null))
  if (typeof r === 'string') throw new Error(r)
  return r
}

/**
 * 여러 날 — `modes[i]` 는 i 번째 날이 어떤 하루였는가다(0 번째 = 시작 행의 날).
 * i+1 번째 날 아침 결정은 i 번째 날과 i−1 번째 날의 판정으로 연속 통과를 센다. `days[i]` 가 그 i+1 번째 날의 결정이다.
 */
function walk(start: ValidatedStageDecision, modes: readonly DayMode[], o: DayOpts | ((i: number) => DayOpts) = {}): { days: Day[]; trace: string; allValid: boolean } {
  const days: Day[] = []
  const past: Past[] = [{ decision: start, mode: modes[0]! }]
  for (let i = 0; i < modes.length; i += 1) {
    const d = runDay(addDays(start.kstDate, i + 1), past[i] ?? null, i === 0 ? null : past[i - 1] ?? null, typeof o === 'function' ? o(i) : o)
    days.push(d)
    if (d.valid === null) break
    past.push({ decision: d.valid, mode: modes[i + 1] ?? 'perfect' })
  }
  return { days, trace: days.map((d) => `${d.decision.state}:${d.decision.release}`).join(' '), allValid: days.every((d) => d.valid !== null) }
}
const tr = (d: Day): string => `${d.decision.state}:${d.decision.release}`
const blocked = (d: Day, code: string): boolean => d.decision.blocks.some((b) => b.code === code)
const releases = (w: { days: Day[] }): string => w.days.map((d) => d.decision.release).join(' ')

// S1 — 매일 통과하면 이틀마다 한 칸 · 맨 위 d50 에서 멈춘다
{
  const w = walk(startRow('d1'), Array.from({ length: 14 }, () => 'perfect' as const))
  check('fixture 기준선 — 실제 대기(3~9분 + 처리 30초)로 달린 첫 댓글은 전부 판정 창 안이다(d50 하루 50편)',
    evidenceOfDay(startRow('d50'), 'perfect').verdict === 'PASS', evidenceOfDay(startRow('d50'), 'perfect').codes.join(','))
  check('🟢 S1 매일 통과 → 이틀마다 한 칸: d1 d3 d3 d5 d5 d10 d10 d20 d20 d30 d30 d50 d50 d50',
    releases(w) === 'd1 d3 d3 d5 d5 d10 d10 d20 d20 d30 d30 d50 d50 d50', w.trace)
  check('S1 올린 날만 TRIAL 이고 기반은 전날 공개 · 근거 PASS',
    w.days.filter((d) => d.decision.state === 'TRIAL').length === 6
    && w.days.every((d) => d.decision.transition === null || (d.decision.transition.kind === 'TRIAL' && d.decision.transition.basis === 'PASS')), w.trace)
  check('S1 모든 결정이 저장 계약을 통과한다', w.allValid, w.days.map((d) => d.reason).filter((x) => x !== '').join(' / '))
  check('🔴 S1 맨 위 d50 은 계속 통과해도 HOLD d50 · capacity ≤ d50 · 러너 밖(d100)으로 가지 않는다',
    tr(w.days[13]!) === 'HOLD:d50' && w.days.every((d) => stageRank(d.decision.capacity) <= stageRank('d50')))
  check('🔴 S1 어느 날도 SUSTAIN·REPROVE 를 만들지 않는다', w.days.every((d) => d.decision.state !== 'SUSTAIN' && d.decision.state !== 'REPROVE'))
}

// S2 — 계약 유효 Persona 를 모르거나 0 이면 통과해도 올리지 않는다
{
  const unknown = walk(startRow('d1'), Array.from({ length: 5 }, () => 'perfect' as const), { facts: (s) => factsFor(s, { contractValidPersonas: null }) })
  check('🔴 🔴 S2 contractValidPersonas=null 5일 — d3 로 올리지 않는다(PREFLIGHT_UNKNOWN) · 바닥 PREPARE',
    unknown.days.every((d) => tr(d) === 'PREPARE:d1') && unknown.days.slice(1).every((d) => blocked(d, 'PREFLIGHT_UNKNOWN')) && unknown.allValid, unknown.trace)
  const zero = walk(startRow('d1'), Array.from({ length: 5 }, () => 'perfect' as const), { facts: (s) => factsFor(s, { contractValidPersonas: 0 }) })
  check('🔴 🔴 S2b contractValidPersonas=0 5일 — d3 로 올리지 않는다(PREFLIGHT_FAIL)',
    zero.days.every((d) => tr(d) === 'PREPARE:d1') && zero.days.slice(1).every((d) => blocked(d, 'PREFLIGHT_FAIL')) && zero.allValid, zero.trace)
  const healed = walk(startRow('d1'), Array.from({ length: 4 }, () => 'perfect' as const),
    (i) => (i < 3 ? { facts: (s) => factsFor(s, { contractValidPersonas: 0 }) } : {}))
  check('🟢 S2c 관문이 풀린 날 바로 올린다 — 막힌 동안의 연속 통과를 버리지 않는다', releases(healed) === 'd1 d1 d1 d3', healed.trace)
}

// S3 — 미달·모름·못 읽음은 올리지 않을 뿐 내리지 않는다 · 그 뒤 이틀을 새로 센다
{
  const modes: DayMode[] = ['perfect', 'perfect', 'short', 'costUnknown', 'unread', 'perfect', 'perfect', 'noFirst', 'perfect', 'perfect']
  const w = walk(startRow('d20'), modes)
  check('🔴 🔴 S3 d30 으로 올린 뒤 미달·모름·못 읽음이 이어져도 공개는 d30 그대로다 — 아래 칸으로 되돌리지 않는다',
    releases(w) === 'd20 d30 d30 d30 d30 d30 d50 d50 d50 d50', w.trace)
  check('S3 그 사흘의 판정은 FAIL · UNKNOWN · UNKNOWN 이다',
    w.days[2]!.evidence?.verdict === 'FAIL' && w.days[3]!.evidence?.verdict === 'UNKNOWN' && w.days[4]!.evidence?.verdict === 'UNKNOWN',
    w.days.slice(2, 5).map((d) => d.evidence?.verdict).join(' '))
  check('🔴 S3 실패 뒤 하루 통과로는 올리지 않는다 — 이틀을 새로 센다', w.days[5]!.result.passDays === 1 && w.days[6]!.result.passDays === 2 && w.days[6]!.decision.release === 'd50')
  check('🔴 S3 올린 d50 의 첫날이 미달(첫 댓글 0)이어도 d50 유지', w.days[7]!.evidence?.verdict === 'FAIL' && w.days[7]!.decision.release === 'd50')
  check('S3 모든 결정이 저장 계약을 통과한다', w.allValid)
}

// S5 — 사람·수동 물량과 무결성 결함은 통과가 아니다(올리지 않는다)
for (const [mode, code] of [['human', 'PUBLISH_SHORT'], ['manualRun', 'PUBLISH_SHORT'], ['thin', 'COMMENT_DEPTH_SHORT'],
  ['brokenProv', 'COMMENT_PROVENANCE_BROKEN'], ['auditShort', 'AUDIT_COVERAGE_SHORT']] as const) {
  const w = walk(startRow('d20'), ['perfect', mode, 'perfect'])
  check(`🔴 S5 ${mode} — 그날은 ${code} · 연속이 끊겨 올리지 않고 공개는 d20 그대로`,
    w.days[1]!.evidence?.codes.includes(code) === true && releases(w) === 'd20 d20 d20' && w.allValid,
    `${w.trace} ${w.days[1]!.evidence?.codes.join(',')}`)
}

// S7 — 올림 관문: 예측과 비용 추정은 막지 않고, Persona·구조만 막는다
{
  const two: DayMode[] = ['perfect', 'perfect']
  const green = walk(startRow('d10'), two).days[1]!
  check('S7 기준선 — d10 이틀 통과 · 관문 초록 → 올림 d20', tr(green) === 'TRIAL:d20' && green.valid !== null)
  const forecast: { name: string; warning: string; o: Partial<PreflightFacts> }[] = [
    { name: '기회 모름', warning: 'OPPORTUNITY_UNKNOWN', o: { slotValidOpportunities: null } },
    { name: '처리량 부족', warning: 'THROUGHPUT_SHORT', o: { readyCohort: { ...factsFor('d20').readyCohort!, sources: 4000 } } },
  ]
  for (const c of forecast) {
    const d = walk(startRow('d10'), two, { facts: (s) => factsFor(s, c.o) }).days[1]!
    check(`🔴 S7 ${c.name}(예측) → d20 으로 올리고 ${c.warning} 가 supply 예측 경고로 남는다`,
      tr(d) === 'TRIAL:d20' && d.decision.supply !== null && 'forecastWarnings' in d.decision.supply
      && (d.decision.supply.forecastWarnings as readonly string[]).includes(c.warning), `${tr(d)} ${JSON.stringify(d.decision.supply)}`)
  }
  const cost: { name: string; o: Partial<PreflightFacts> }[] = [
    { name: '추정 비용이 예산 초과', o: { readyCohort: { ...factsFor('d20').readyCohort!, usdPerSlotValidResult: 5 } } },
    { name: '비용 상한 모름', o: { supplyDailyUsdCap: null } },
  ]
  for (const c of cost) {
    const d = walk(startRow('d10'), two, { facts: (s) => factsFor(s, c.o) }).days[1]!
    check(`🔴 🔴 S7 ${c.name} → 올림을 막지 않는다(TRIAL d20 · block 0)`, tr(d) === 'TRIAL:d20' && d.decision.blocks.length === 0, tr(d))
  }
  const hard: { name: string; code: string; o: Partial<PreflightFacts> }[] = [
    { name: 'Persona 하한 미달', code: 'PREFLIGHT_FAIL', o: { contractValidPersonas: 1 } },
    { name: 'Persona 모름', code: 'PREFLIGHT_UNKNOWN', o: { contractValidPersonas: null } },
  ]
  for (const c of hard) {
    const d = walk(startRow('d10'), two, { facts: (s) => factsFor(s, c.o) }).days[1]!
    check(`🔴 S7 ${c.name} → d20 으로 올리지 않는다 · ${c.code} · PREPARE d10`, tr(d) === 'PREPARE:d10' && blocked(d, c.code) && d.valid !== null, tr(d))
  }
  check('🔴 S7 preflight 없이(null) → PREFLIGHT_UNKNOWN', preflightBlocks({ target: 'd20', preflight: null })[0]?.code === 'PREFLIGHT_UNKNOWN')
  check('🔴 S7 다른 단계(d30) preflight 초록으로 d20 을 열지 않는다',
    preflightBlocks({ target: 'd20', preflight: judgeNextPreflight('d30', factsFor('d30'), GRID) })[0]?.code === 'PREFLIGHT_UNKNOWN')
  check('🟢 S7 같은 단계의 초록 preflight 면 막는 것이 없다', preflightBlocks({ target: 'd20', preflight: judgeNextPreflight('d20', factsFor('d20'), GRID) }).length === 0)
}

// S8 — 브레이크: 그날 하루만 한 칸 낮추고 열린 단계는 행이 들고 간다
{
  const day = (prev: ValidatedStageDecision, before: ValidatedStageDecision | null, signals: HealthSignal[], mode: DayMode = 'perfect'): Day =>
    runDay(addDays(prev.kstDate, 1), { decision: prev, mode }, before === null ? null : { decision: before, mode: 'perfect' }, { signals })
  const d0 = startRow('d10', addDays(D0, 40))
  const d1 = startRow('d10', addDays(D0, 41))
  const brake1 = day(d1, d0, BAD_COST)
  check('🔴🔴 S8 비용 bad → 이틀 통과여도 올리지 않고 오늘만 d5 · 행에 CERTIFIED d10',
    brake1.result.brake === 'slowdown' && tr(brake1) === 'PREPARE:d5' && brake1.result.sustained === 'd10'
    && brake1.decision.transition?.kind === 'CERTIFIED' && brake1.decision.transition.certified === 'd10' && brake1.valid !== null, tr(brake1))
  const brake2 = day(brake1.valid!, d1, BAD_COST)
  check('🔴🔴 S8 이틀 연속 bad 여도 d5 에서 더 내려가지 않는다(열린 단계 d10 의 아래 칸) · CERTIFIED d10 유지',
    tr(brake2) === 'PREPARE:d5' && brake2.result.sustained === 'd10' && brake2.decision.transition?.kind === 'CERTIFIED'
    && brake2.decision.transition.certified === 'd10', tr(brake2))
  const back = day(brake2.valid!, brake1.valid!, OK_SIGNALS)
  check('🟢 S8 신호가 돌아온 날 공개 d10 복원 · 새 행에는 CERTIFIED 가 없다 · 연속은 0 에서 다시',
    tr(back) === 'PREPARE:d10' && back.decision.transition === null && back.result.passDays === 0 && back.valid !== null, tr(back))
  const after = day(back.valid!, brake2.valid!, OK_SIGNALS)
  const after2 = day(after.valid!, back.valid!, OK_SIGNALS)
  check('🟢 S8 복원 뒤 d10 이틀 통과 → d20', after.decision.release === 'd10' && tr(after2) === 'TRIAL:d20', `${tr(after)} ${tr(after2)}`)
  const UNKNOWN: HealthSignal[] = [OK_SIGNALS[0]!, { axis: 'cost', health: 'unknown', reasons: [] }, OK_SIGNALS[2]!]
  const unk = day(d1, d0, UNKNOWN)
  check('🔴 S8 비용 모름 → 올림만 보류(PREPARE d10 · holdUnknown · CERTIFIED 없음)',
    unk.result.brake === 'holdUnknown' && tr(unk) === 'PREPARE:d10' && unk.decision.transition === null)
  const floor = day(startRow('d1', addDays(D0, 41)), null, BAD_COST)
  check('S8 감속은 d1 아래로 가지 않는다', floor.decision.release === 'd1' && floor.decision.transition === null && floor.valid !== null)
}

// S-BLIND · D — 신호를 보지 못한 HOLD(입력 실패 · 공급 lease)는 올리지 않고, 열린 단계는 행에 남긴다
{
  const today = addDays(D0, 1)
  const decidedAt = new Date(`${today}T07:55:00+09:00`).toISOString()
  const brakeRow = validated(rowOf(D0, 'd5', 'PREPARE', { kind: 'CERTIFIED', certified: 'd10' }))
  const plainPrev = validated(rowOf(D0, 'd5', 'PREPARE', null))
  const raised = validated(rowOf(D0, 'd10', 'TRIAL', { kind: 'TRIAL', trialBase: 'd5', previousKstDate: addDays(D0, -1), target: 'd10', basis: 'PASS' }))
  if (typeof brakeRow === 'string' || typeof plainPrev === 'string' || typeof raised === 'string') throw new Error('S-BLIND 행 검증 실패')
  const bridgeAuth = { kind: 'bridge', bridge: brakeRow } as const
  const exactAuth = { kind: 'exact', previous: brakeRow } as const
  const firstAuth = { kind: 'first-run' } as const
  type Auth = typeof bridgeAuth | typeof exactAuth | typeof firstAuth
  const failOf = (authority: Auth, certified: RuntimeStage) =>
    inputFailureHoldOf({ kstDate: today, decidedAt, authority, certified, reason: 'fixture 재고 읽기 실패' })
  const leaseBy = (authority: Auth | { kind: 'exact'; previous: ValidatedStageDecision }) =>
    leaseSafeHoldOf({ kstDate: today, decidedAt, lease: 'busy', authority })
  const ef = failOf(exactAuth, 'd10')
  const el = leaseBy(exactAuth)
  check('🔴🔴 S-BLIND 어제 감속 d5(열린 단계 d10) + 입력 실패·lease → 공개 d5 그대로(올리지 않는다) · CERTIFIED d10 을 다시 남긴다',
    ef.release === 'd5' && el.decision.release === 'd5' && el.certified === 'd10'
    && ef.transition?.kind === 'CERTIFIED' && el.decision.transition?.kind === 'CERTIFIED' && el.decision.transition.certified === 'd10'
    && validateForToday(ef).ok && validateForToday(el.decision).ok)
  const bf = failOf(bridgeAuth, 'd10')
  const bl = leaseBy(bridgeAuth)
  check('🔴🔴 S-BLIND 다리(전날 행 없음) → 보이는 공개 d1 HOLD(이틀 전 d5 를 되살리지 않는다) · 열린 단계 d10 은 CERTIFIED 로 남는다',
    bf.state === 'HOLD' && bf.release === 'd1' && bf.transition?.kind === 'CERTIFIED' && bf.transition.certified === 'd10'
    && bl.decision.release === 'd1' && bl.certified === 'd10' && validateForToday(bf).ok && validateForToday(bl.decision).ok,
    `${bf.state}:${bf.release}`)
  check('🔴 S-BLIND 보이는 공개의 단일 자리 — 인접 행은 보이던 공개, 다리는 d1',
    heldReleaseOf(brakeRow, 'd10') === 'd5' && signalBlindReleaseOf(bridgeAuth, 'd10') === 'd1' && signalBlindReleaseOf(exactAuth, 'd10') === 'd5')
  const ff = failOf(firstAuth, 'd1')
  const fl = leaseBy(firstAuth)
  check('🔴 S-BLIND 첫 시작은 입력 실패·lease 모두 d1 · 낮춘 것이 없어 CERTIFIED 없음',
    ff.release === 'd1' && fl.decision.release === 'd1' && fl.certified === 'd1' && ff.transition === null && fl.decision.transition === null)
  check('D lease HOLD — 평상 d5 는 d5 그대로 · 어제 올린 d10 은 d10 그대로(판정과 무관 — 되돌리지 않는다)',
    leaseBy({ kind: 'exact', previous: plainPrev }).decision.release === 'd5' && leaseBy({ kind: 'exact', previous: plainPrev }).decision.transition === null
    && leaseBy({ kind: 'exact', previous: raised }).decision.release === 'd10')
  const nextOk = runDay(addDays(today, 1), { decision: (validateForToday(el.decision) as { ok: true; decision: ValidatedStageDecision }).decision, mode: 'unread' },
    { decision: brakeRow, mode: 'unread' })
  check('🟢 S-BLIND lease HOLD 다음 날 신호가 ok 면 열린 단계 d10 으로 돌아온다', nextOk.decision.release === 'd10' && nextOk.result.sustained === 'd10', tr(nextOk))
  const bridgeOk = bridgeHoldOf({ kstDate: today, decidedAt, bridge: brakeRow, publishedToday: 0, signals: OK_SIGNALS })
  const bridgeBad = bridgeHoldOf({ kstDate: today, decidedAt, bridge: brakeRow, publishedToday: 0, signals: BAD_COST })
  check('🔴 S-BLIND bridgeHoldOf 는 신호를 본다 — ok 는 holdUnknown d5 · bad 는 slowdown d5(열린 단계 d10 의 아래 칸) · 둘 다 CERTIFIED d10',
    bridgeOk.decision.release === 'd5' && bridgeOk.brake === 'holdUnknown' && bridgeBad.decision.release === 'd5' && bridgeBad.brake === 'slowdown'
    && bridgeOk.decision.transition?.kind === 'CERTIFIED' && bridgeBad.decision.transition?.kind === 'CERTIFIED',
    `${bridgeOk.decision.release} ${bridgeBad.decision.release}`)
  check('🔴 계약 — CERTIFIED 는 공개보다 높아야 하고 HOLD·PREPARE·현재 판에만 붙는다',
    typeof validated(rowOf(D0, 'd5', 'PREPARE', { kind: 'CERTIFIED', certified: 'd5' })) === 'string'
    && typeof validated(rowOf(D0, 'd5', 'PREPARE', { kind: 'CERTIFIED', certified: 'd3' })) === 'string'
    && typeof validated(rowOf(D0, 'd5', 'PREPARE', { kind: 'CERTIFIED', certified: 'd99' })) === 'string'
    && typeof validated(rowOf(D0, 'd5', 'REPROVE', { kind: 'CERTIFIED', certified: 'd10' })) === 'string'
    && typeof validated(rowOf(D0, 'd5', 'PREPARE', { kind: 'CERTIFIED', certified: 'd10' }, 'stage-decision-v4')) === 'string'
    && typeof validated(rowOf(D0, 'd5', 'PREPARE', { kind: 'CERTIFIED', certified: 'd10' })) !== 'string'
    && typeof validated(rowOf(D0, 'd5', 'PREPARE', null)) !== 'string')
}

// S-GAP — 전날 행 읽기 실패·깨짐은 계산·저장 0 · 하루 누락은 이틀 전 행 하나로 권한만 잇는다
{
  type Slot = ValidatedStageDecision | 'broken' | 'throw'
  const rows = new Map<string, Slot>()
  const reads: string[] = []
  let computes = 0
  let writes = 0
  const read = async (date: string): Promise<DecisionRead> => {
    reads.push(date)
    const r = rows.get(date)
    if (r === 'throw') throw new Error('PrismaClientKnownRequestError')
    if (r === 'broken') return { kind: 'broken', reason: 'fixture broken row' }
    return r === undefined ? { kind: 'absent' } : { kind: 'valid', decision: r }
  }
  /** controller main 과 같은 조립 — 권한 판정 → (멈춤 | 다리 HOLD | decideStage) → 저장 검증 */
  const assemble = async (kstDate: string, signals: HealthSignal[]) => {
    reads.length = 0
    const a = await resolvePreviousAuthority(kstDate, read)
    if (a.kind === 'stop') return { stop: a.code, reads: [...reads] } as const
    computes += 1
    let result: ControllerResult
    if (a.kind === 'bridge') {
      result = bridgeHoldOf({ kstDate, decidedAt: at0700(kstDate), bridge: a.bridge, publishedToday: 0, signals })
    } else {
      const prev = a.kind === 'exact' ? a.previous : null
      const up = nextStage(openStageOf(prev))
      result = decideStage({
        kstDate, decidedAt: at0700(kstDate), previousDecision: prev, previousEvidence: prev === null ? null : evidenceOfDay(prev, 'perfect'),
        // 🔴 preflight 는 열려 있다 — 다리 날이 그래도 올리지 않는지 본다
        nextPreflight: up === null ? null : judgeNextPreflight(up, factsFor(up), GRID), publishedToday: 0, signals,
      })
    }
    const v = validateForToday(result.decision)
    if (v.ok) { rows.set(kstDate, v.decision); writes += 1 }
    return { decision: result.decision, valid: v.ok, reads: [...reads], authority: a.kind } as const
  }
  const X = addDays(D0, 20)
  const brakeRow = validated(rowOf(X, 'd5', 'PREPARE', { kind: 'CERTIFIED', certified: 'd10' }))
  if (typeof brakeRow === 'string') throw new Error(brakeRow)

  rows.set(X, 'throw')
  const thrown = await assemble(addDays(X, 1), OK_SIGNALS)
  check('🔴🔴 S-GAP 전날 행 읽기 예외 → PREVIOUS_READ_ERROR · 결정 계산 0 · 저장 0 (d1 대체 행을 쓰지 않는다)',
    'stop' in thrown && thrown.stop === 'PREVIOUS_READ_ERROR' && computes === 0 && writes === 0 && !rows.has(addDays(X, 1)))
  rows.set(X, 'broken')
  rows.set(addDays(X, -1), brakeRow)
  const broken = await assemble(addDays(X, 1), OK_SIGNALS)
  check('🔴🔴 S-GAP 전날 행 깨짐 → PREVIOUS_BROKEN · 계산·저장 0 · 이틀 전 유효 행으로 건너뛰지 않는다(읽은 날 = 전날 하나)',
    'stop' in broken && broken.stop === 'PREVIOUS_BROKEN' && computes === 0 && writes === 0
    && broken.reads.length === 1 && broken.reads[0] === X)

  rows.clear()
  rows.set(X, brakeRow)
  const gap = await assemble(addDays(X, 2), OK_SIGNALS)
  check('🔴🔴 S-GAP 하루 누락 + 이틀 전 유효(공개 d5 · 열린 단계 d10) → 올림 없음 · 공개 d5 · CERTIFIED d10 을 이어 쓴다',
    !('stop' in gap) && gap.authority === 'bridge' && gap.valid
    && (gap.decision.state === 'HOLD' || gap.decision.state === 'PREPARE') && gap.decision.release === 'd5'
    && gap.decision.transition?.kind === 'CERTIFIED' && gap.decision.transition.certified === 'd10'
    && gap.reads.join(',') === `${addDays(X, 1)},${X}`,
    'stop' in gap ? gap.stop : `${gap.decision.state}:${gap.decision.release} reads=${gap.reads.join(',')}`)
  const gapNext = await assemble(addDays(X, 3), OK_SIGNALS)
  check('🟢 S-GAP 다음 날 — 다리 행이 전날 행이 되어 정상 연속(읽은 날 하나) · 열린 단계 d10 복원',
    !('stop' in gapNext) && gapNext.authority === 'exact' && gapNext.valid && gapNext.decision.release === 'd10' && gapNext.reads.length === 1,
    'stop' in gapNext ? gapNext.stop : `${gapNext.decision.state}:${gapNext.decision.release}`)
  const plainRow = validated(rowOf(X, 'd5', 'PREPARE', null))
  if (typeof plainRow === 'string') throw new Error(plainRow)
  rows.clear()
  rows.set(X, plainRow)
  const gapPlain = await assemble(addDays(X, 2), OK_SIGNALS)
  check('🔴 S-GAP 다리 날은 preflight PASS 여도 올리지 않는다', !('stop' in gapPlain) && gapPlain.decision.state !== 'TRIAL' && gapPlain.decision.release === 'd5',
    'stop' in gapPlain ? gapPlain.stop : gapPlain.decision.state)
  rows.clear()
  rows.set(X, brakeRow)
  const gapBrake = await assemble(addDays(X, 2), BAD_COST)
  check('🔴 S-GAP 다리 날 비용 bad → 공개 d5(열린 단계 d10 의 아래 칸)',
    !('stop' in gapBrake) && gapBrake.decision.release === 'd5' && gapBrake.decision.transition?.kind === 'CERTIFIED')
  rows.clear()
  const first = await assemble(addDays(X, 2), OK_SIGNALS)
  check('🟢 S-GAP 전날·이틀 전 모두 진짜 없음 → 첫 시작 d1 · 읽은 날은 둘뿐(그 앞을 훑지 않는다)',
    !('stop' in first) && first.authority === 'first-run' && first.valid && first.decision.release === 'd1' && first.reads.length === 2)
  rows.clear()
  rows.set(X, 'broken')
  const deepBroken = await assemble(addDays(X, 2), OK_SIGNALS)
  check('🔴 S-GAP 전날 없음 + 이틀 전 깨짐 → 진짜 첫 시작이 아니다 → PREVIOUS_BROKEN · 저장 0',
    'stop' in deepBroken && deepBroken.stop === 'PREVIOUS_BROKEN' && !rows.has(addDays(X, 2)))
}

// S11 — D100 용량표는 러너 프로필과 같다 · 승격은 TRIAL → 증거 PASS 하나뿐
{
  check('🔴 S11 D100 용량표 = 러너 프로필 — d20·d30·d50 감당(슬롯 = RUNTIME_PROFILES) · d100 은 schedulerUnsupported',
    (['d20', 'd30', 'd50'] as const).every((s) => {
      const sc = schedulerSupportOf(s)
      return sc.supported && sc.releaseStage === s && sc.scheduledSlotsPerDay === RUNTIME_PROFILES[s].slots.length
        && sc.actualDailyPublishable === d100Plan(s).publicPostsPerDay
    }) && !schedulerSupportOf('d100').supported && schedulerSupportOf('d100').reason === 'schedulerUnsupported')
  check('🔴 🔴 S11 지속 승격(judgePromotion → SUSTAIN) 경로가 없다 — v5 는 SUSTAIN 을 저장하지 않는다', (() => {
    const cap = readFileSync('src/lib/d100-capacity.ts', 'utf-8')
    const v = validateStoredDecision({ row: {
      kstDate: D0, capacity: 'd5', release: 'd5', state: 'SUSTAIN', reasons: [], blocks: [], dayPinned: false, supply: null,
      decidedAt: at0700(D0), contractVersion: STAGE_DECISION_VERSION, decidedBy: DECISION_WRITER, transition: { kind: 'SUSTAIN', from: 'd3', to: 'd5' },
    }, expectKstDate: D0 })
    return !/export function judgePromotion/.test(cap) && !v.ok
  })())
}

// 저장 계약
{
  const V = (o: Partial<Record<keyof StageDecision, unknown>>): boolean => validateStoredDecision({
    row: {
      kstDate: D0, capacity: 'd20', release: 'd10', state: 'REPROVE', reasons: [], blocks: [], dayPinned: false, supply: null,
      decidedAt: at0700(D0), contractVersion: STAGE_DECISION_VERSION, decidedBy: DECISION_WRITER, transition: null, ...o,
    }, expectKstDate: D0,
  }).ok
  const trial = (o: Record<string, unknown>): Partial<Record<keyof StageDecision, unknown>> => ({
    state: 'TRIAL', release: 'd20',
    transition: { kind: 'TRIAL', trialBase: 'd10', previousKstDate: addDays(D0, -1), target: 'd20', basis: 'PASS', ...o },
  })
  check('계약 — 옛 사다리가 쓴 REPROVE d10 행은 그대로 읽힌다 · REPROVE 에 전이 근거가 붙으면 거절',
    V({}) && !V({ transition: { kind: 'SUSTAIN', from: 'd5', to: 'd10' } }))
  check('계약 — TRIAL d20 (기반 d10 · PASS) 통과', V(trial({})))
  check('🔴 계약 — TRIAL d20 이 기반 d5 에서 뛰면 거절 · 근거 없으면 거절', !V(trial({ trialBase: 'd5' })) && !V(trial({ basis: undefined })))
  check('🔴 계약 — TRIAL 에 PREFLIGHT_FAIL · PREFLIGHT_UNKNOWN · LATE_START 가 붙으면 거절',
    (['PREFLIGHT_FAIL', 'PREFLIGHT_UNKNOWN', 'LATE_START'] as const).every((code) => !V({ ...trial({}), blocks: [{ code, reason: 'x' }] })))
  check('🔴 계약 — 공개가 천장 위(d30 > d20)면 거절 · d100 은 저장 단계가 아니다',
    !V({ release: 'd30' }) && !V({ capacity: 'd100' }) && !V({ release: 'd100', capacity: 'd100' }))
}

// ─────────────────────────────────────────────────────────
section('⑥ 러너 연결 — consumer env → 러너 설정 · catch-up · 발행 천장')
{
  const w = walk(startRow('d10'), ['perfect', 'perfect'])
  const t = w.days[1]!
  const env = t.valid === null ? {} : consumerEnvOf({ ok: true, decision: t.valid })
  check('🔴 consumer — 올린 날(TRIAL d20) → 공개 d20 그대로(canary 없음) · capacity d30 · 단계 칸 둘과 표식뿐',
    tr(t) === 'TRIAL:d20' && env.SORAN_RELEASE_STAGE === 'd20' && env.SORAN_CAPACITY_STAGE === 'd30' && Object.keys(env).length === 3
    && !Object.keys(env).some((k) => /CANARY|WINDOW|PROOF/.test(k)), JSON.stringify(env))
  const sc = resolveScale(env)
  check('🟢 러너 — 결정 env 그대로 → 공개 d20 · 하루 20건', sc.releaseStage === 'd20' && sc.releaseProfile.dailyTarget === 20, JSON.stringify(sc.notes))
  const first = profileOf(sc.releaseStage).slots[0]!
  const now = new Date(`${t.decision.kstDate}T${String(first.hour).padStart(2, '0')}:${String(first.minute).padStart(2, '0')}:00+09:00`)
  const cu = judgeCatchUp({ stage: sc.releaseStage, now, trigger: 'local', cron: null, publishedToday: 0 })
  check(`러너 — ${cycleLabel(minuteOfDay(first))} heartbeat 가 d20 첫 슬롯을 낸다(1건 · 새벽 자리)`, cu.run && cu.allowed === 1 && minuteOfDay(first) < 8 * 60)
  // 🔴 창은 하루 전체 — 22:10 의 밀린 몫은 메우고, 마지막 틱(23:50) 뒤의 backlog 는 버린다(다음 날로 끌고 가지 않는다)
  const lateIn = judgeCatchUp({ stage: 'd20', now: new Date(`${t.decision.kstDate}T22:10:00+09:00`), trigger: 'local', cron: null, publishedToday: 19 })
  const late = judgeCatchUp({ stage: 'd20', now: new Date(`${t.decision.kstDate}T23:51:00+09:00`), trigger: 'local', cron: null, publishedToday: 19 })
  check('🔴 러너 — 22:10 밀린 몫은 창 안이라 낸다 · 마지막 틱(23:50) 넘은 backlog 는 버린다', lateIn.run && lateIn.allowed === 1 && !late.run, late.reason)
  check('🔴 발행 트랜잭션 천장 — 같은 env 로 d20 · d10 env 면 d20 요청도 d10 으로 누른다(옛 canary 키는 무시)',
    boundedReleaseStage('d20', env, now) === 'd20'
    && boundedReleaseStage('d20', markedStageEnv({ [CAPACITY_ENV]: 'd10', [RELEASE_ENV]: 'd10', SORAN_RELEASE_CANARY_STAGE: 'd20', SORAN_RELEASE_CANARY_DATE: t.decision.kstDate }), now) === 'd10')
  const henv = consumerEnvOf({ ok: true, decision: startRow('d10') })
  check('consumer — 유지하는 날(PREPARE d10)도 같은 세 칸이다 — 올린 날과 러너 동작이 같다',
    henv.SORAN_RELEASE_STAGE === 'd10' && JSON.stringify(Object.keys(henv).sort()) === JSON.stringify(Object.keys(env).sort()))
}

// ─────────────────────────────────────────────────────────
section('⑦ 롤백 — stage:switch --off')
{
  const dir = mkdtempSync(join(tmpdir(), 'stage-scheduler-check-'))
  const envFile = join(dir, 'env.local')
  try {
    writeFileSync(envFile, `SORAN_CAPACITY_STAGE=d20\n${CONTROLLER_ENV}=on\nOTHER=1\n`, { mode: 0o600 })
    check('롤백 전 — controller on', controllerEnabled(readEnvKeys([CONTROLLER_ENV], envFile).values))
    const r = spawnSync(process.execPath, [...process.execArgv, 'scripts/stage-controller-switch.mts', '--off', '--apply', `--env=${envFile}`], { encoding: 'utf-8' })
    const after = readEnvKeys([CONTROLLER_ENV, 'SORAN_CAPACITY_STAGE', 'OTHER'], envFile).values
    check('🔴 stage:switch --off → controller off · 다른 키 그대로', r.status === 0 && !controllerEnabled(after)
      && after.SORAN_CAPACITY_STAGE === 'd20' && after.OTHER === '1', `${r.status} ${r.stderr.slice(-200)}`)
    check('🔴 off 면 consumer 는 d1 을 명시해서 넣는다(env 파일 단계가 이기는 legacy 경로 없음)', (() => {
      const e = consumerEnvOf({ ok: false, code: 'NO_DECISION', fallback: 'safest', reason: 'off' })
      return e.SORAN_RELEASE_STAGE === 'd1' && e.SORAN_CAPACITY_STAGE === 'd1' && e.SORAN_STAGE_DECISION_DATE === ''
    })())
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

// ─────────────────────────────────────────────────────────
section('⑧ 증거 본체 — d1~d10 두 입구 동일 · REPROVE 증명일')
{
  const row = (release: RuntimeStage, state: StageDecision['state']): StageDecision => ({
    kstDate: D0, capacity: preparedStageOf(release), release, state, reasons: [], blocks: [], dayPinned: false, supply: null,
    decidedAt: at0700(D0), contractVersion: STAGE_DECISION_VERSION, decidedBy: DECISION_WRITER, transition: null,
  })
  for (const s of RELEASE_STAGES) {
    const f = factsOfDay(row(s, 'TRIAL'), 'perfect')!
    const a = judgeStageEvidence(D0, s, f, SIDE_OK)
    const b = judgeEvidenceForTarget(D0, s, PROFILES[s].dailyTarget, f, SIDE_OK)
    check(`${s} — 두 입구가 같은 판정 (${a.verdict})`, JSON.stringify(a) === JSON.stringify(b) && a.verdict === 'PASS', JSON.stringify(a.codes))
  }
  for (const s of ['d20', 'd30', 'd50'] as const) {
    const v = judgeStageEvidence(D0, s, factsOfDay(row(s, 'TRIAL'), 'perfect'), SIDE_OK)
    check(`${s} — 러너 슬롯대로 자동 ${profileOf(s).dailyTarget}편 · 첫 댓글(예약표) · 감사 ${auditTarget(profileOf(s).dailyTarget)} → PASS`,
      v.verdict === 'PASS' && v.counts.autoTargets === profileOf(s).dailyTarget, JSON.stringify(v.codes))
  }
  check('🟢 REPROVE 날 완전한 운영 → PASS', judgeStageEvidence(D0, 'd10', factsOfDay(row('d10', 'REPROVE'), 'perfect'), SIDE_OK).verdict === 'PASS')
  const hold = judgeStageEvidence(D0, 'd10', factsOfDay(row('d10', 'HOLD'), 'perfect'), SIDE_OK)
  check('🟢 HOLD · PREPARE 날도 자연 exact-N과 모든 실질 증거를 채우면 운영 PASS', hold.verdict === 'PASS'
    && judgeStageEvidence(D0, 'd5', factsOfDay(row('d5', 'PREPARE'), 'perfect'), SIDE_OK).verdict === 'PASS')
  check('비용·러너 모름 → UNKNOWN (PASS 아님)', judgeStageEvidence(D0, 'd20', factsOfDay(row('d20', 'TRIAL'), 'perfect'), null).verdict === 'UNKNOWN')
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 운영 decideStage · 저장 계약 · 증거 본체 · consumer · 러너 설정을 한 줄로 돌렸다. DB 0 · 운영 env 0 · 유료 호출 0.')
process.exit(fail === 0 ? 0 : 1)
