#!/usr/bin/env tsx
/**
 * 🔴 **D1→D100 단계 스케줄러 검사 — 운영 상태 기계 하나로 본다** (2026-09-29 generic scheduler 배선)
 *
 *   DB 0 · 네트워크 0 · 유료 호출 0 · 운영 env 0. 파일 write 는 OS 임시 디렉터리의 가짜 env 하나(롤백 확인)뿐이다.
 *
 *   ① 단계 목록 · 목표 — 러너 단계 d1~d50 · d100 은 표현만 · 목표는 창업자 계획(`d100Plan`)과 같다
 *   ② (2026-09-30) 승인 천장 env 는 없다 — 러너 단계 해석만 남는다(d100 은 러너 밖)
 *   ③ 슬롯 · 러너 — 08:00~22:00 · heartbeat 격자 · 60분 안 댓글 3회(43회 · 간격 ≤20분) · 하루 시뮬레이션
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
  validPublishMinutes, publishCapacityOf, deriveSlots, genericProfileOf, verifyGenericProfile, commentCoverageOf,
  judgeNextPreflight, trialBlocks, firstSlotOn,
  type PreflightFacts, type ReadyCohortFact, type GenericStage, type PreflightVerdict, type PreflightCode,
} from '../src/lib/stage-ladder-generic'
import {
  PROFILES, RELEASE_STAGES, RUNTIME_STAGES, RUNTIME_PROFILES, resolveRuntimeStage, minuteOfDay, profileOf,
  stageRank, isRuntimeStage, CAPACITY_ENV, RELEASE_ENV,
  type RuntimeStage,
} from '../src/lib/scale-profile'
import { PUBLISH_WINDOW_START_MINUTE, PUBLISH_WINDOW_END_MINUTE, judgeCatchUp, simulateDay } from '../src/lib/publish-slot-catchup'
import { allStageCronLines } from '../src/lib/scale-workflow-render'
import { AUTO_FIRST_COMMENT_WINDOW_MINUTES, COMMENT_LOOP_DAILY_USD_MAX } from '../src/lib/persona-comment-auto-lane'
import {
  d100Plan, PERSONA_CANARY_FLOOR, PERSONA_SUSTAINED_TARGET, schedulerSupportOf,
} from '../src/lib/d100-capacity'
import { SUPPLY_RUNS_PER_DAY, SUPPLY_WORKSET_PER_RUN } from '../src/lib/supply-schedule-contract'
import { SUPPLY_DAILY_USD_APPROVED } from '../src/lib/supply-schedule-contract'
import {
  judgeStageEvidence, judgeEvidenceForTarget, trialPlanOf, PROOF_STATES,
  type EvidencePost, type EvidenceSideSignals, type StageEvidenceFacts, type StageEvidenceVerdict,
} from '../src/lib/stage-evidence'
import { auditTarget } from '../src/lib/auto-ready-v2'
import {
  validateStoredDecision, nextStage, STAGE_DECISION_VERSION, DECISION_WRITER, TRANSITION_STATES,
  type ValidatedStageDecision, type StageDecision,
} from '../src/lib/stage-decision-contract'
import {
  decideStage, consumerEnvOf, validateForToday, type HealthSignal, type ControllerResult,
} from '../src/lib/stage-controller'
import { preparedStageOf } from '../src/lib/stage-ladder'
import { resolveScale, boundedReleaseStage } from '../src/lib/scale-runtime'
import { proofDayOf, PROOF_STAGE_ENV } from '../src/lib/stage-proof-day'
import { CONTROLLER_ENV, controllerEnabled } from '../src/lib/stage-decision-store'
import { RUNNER_GRID } from './lib/stage-preflight-facts.mjs'
import { settledUnitUsd, settledTotalUsd, cappedBy } from './lib/stage-preflight-facts.mjs'
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
const COMMENT_USD = 0.00222
const AUDIT_USD = 0.005
const AUDIT_CAP = 0.30
const SUPPLY_USD_PER_READY = 0.008

const D0 = '2026-09-29'
const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
const at0700 = (d: string): string => new Date(`${d}T07:00:00+09:00`).toISOString()
const SIDE_OK: EvidenceSideSignals = {
  cost: [{ name: '공급', health: 'ok' }, { name: '댓글', health: 'ok' }, { name: '감사', health: 'ok' }], errors: 'ok',
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
    && /export function trialBlocks/.test(src)
})())
check('capacity 칸 = 다음 증명 단계 — d10 → d20 · d50 → d50(맨 위)', preparedStageOf('d10') === 'd20' && preparedStageOf('d50') === 'd50')

// ─────────────────────────────────────────────────────────
section('③ 슬롯 · 러너 — 08:00~22:00 · 격자 · 첫 댓글')
const valid = validPublishMinutes(GRID)
const cap = publishCapacityOf(GRID)
console.log(`   유효 발행 분 ${valid.length}개 (격자 ${GRID.gridMinutes}분 · 회차당 ${GRID.perRunMax}건 · 댓글 회차 ${GRID.commentSlots.length}개 · 시도 ${GRID.attempts}회) → 하루 용량 ${cap}건`)
{
  const mins = COMMENT_RUNNER_SLOTS.map(minuteOfDay)
  const gaps = mins.slice(1).map((m, i) => m - mins[i]!)
  check(`댓글 러너 ${COMMENT_RUNNER_SLOTS.length}회/day · 최대 간격 ${Math.max(...gaps)}분 ≤ ${COMMENT_RUNNER_MAX_GAP_MINUTES}분`,
    COMMENT_RUNNER_SLOTS.length === 43 && Math.max(...gaps) <= 20 && COMMENT_RUNNER_MAX_GAP_MINUTES === 20)
}
check('유효 발행 분은 전부 창(08:00~22:00) 안 · 격자 위 · 60분 안 댓글 3회',
  valid.every((m) => m >= PUBLISH_WINDOW_START_MINUTE && m <= PUBLISH_WINDOW_END_MINUTE && m % GRID.gridMinutes === 0
    && commentCoverageOf(m, GRID).runs >= GRID.attempts))
for (const s of RUNTIME_STAGES) {
  const p = profileOf(s)
  const probs = verifyGenericProfile(p, GRID)
  const mins = p.slots.map(minuteOfDay)
  const waits = mins.map((m) => commentCoverageOf(m, GRID).firstWait ?? 999)
  check(`${s} (${p.dailyTarget}/day) — 창 · 격자 · 시도 3회 · 한 분 한 건 · 첫 댓글 대기 최대 ${Math.max(...waits)}분 ≤ 20`,
    probs.length === 0 && Math.max(...waits) <= 20 && p.slots.every((x) => x.count === 1), probs.join(' / '))
  // 🔴 하루 시뮬레이션 — 10분 heartbeat 가 08:00~22:00 에 오면 목표를 정확히 채우고 넘지 않는다
  const arrivals: Date[] = []
  for (let m = PUBLISH_WINDOW_START_MINUTE; m <= PUBLISH_WINDOW_END_MINUTE; m += GRID.gridMinutes) {
    arrivals.push(new Date(Date.parse(`${D0}T00:00:00+09:00`) + m * 60_000))
  }
  const sim = simulateDay({ stage: s, arrivals })
  check(`${s} — heartbeat 하루 시뮬레이션 ${sim.published}/${sim.target}건 (넘지 않는다)`, sim.published === sim.target && sim.meetsTarget)
}
for (const s of ['d20', 'd30', 'd50'] as const) {
  const d = deriveSlots(genericDailyTarget(s), GRID)
  check(`🔴 ${s} 러너 프로필 슬롯 = deriveSlots 결과 그대로(손으로 고치지 않았다)`,
    d.ok && JSON.stringify(d.slots) === JSON.stringify(profileOf(s).slots))
  check(`${s} Persona 간격은 d10 운영값 그대로`, profileOf(s).postsPerWeek === PROFILES.d10.postsPerWeek
    && profileOf(s).minDaysBetween === PROFILES.d10.minDaysBetween)
}
check('🔴 GitHub 예약 합집합은 d1~d10 그대로 10회 — D20 이상은 로컬 heartbeat 격자로 돈다(yml 불변)', allStageCronLines().length === 10)
const g100 = genericProfileOf('d100', GRID)
check(`🔴 [blocker 실측] d100 은 지금 러너로 담을 수 없다 — 용량 ${cap} < 100`, !g100.ok && cap < 100)
check('반례 — 22시에 가까운 슬롯은 시도 3회가 안 돼 계약 위반', verifyGenericProfile({
  dailyTarget: 1, postsPerWeek: 1, minDaysBetween: 5, slots: [{ hour: 21, minute: 40, count: 1 }],
}, GRID).some((p) => p.includes('댓글 시도')))
check('반례 — 격자 밖 분(09:35)은 계약 위반', verifyGenericProfile({
  dailyTarget: 1, postsPerWeek: 1, minDaysBetween: 5, slots: [{ hour: 9, minute: 35, count: 1 }],
}, GRID).some((p) => p.includes('격자')))
check('반례 — 목표 0 · 101 · 소수는 만들지 않는다', !deriveSlots(0, GRID).ok && !deriveSlots(101, GRID).ok && !deriveSlots(2.5, GRID).ok)

// ─────────────────────────────────────────────────────────
section('④ preflight — slot-valid 기회 · 처리량 · 지연 · 계약 유효 Persona · 비용 상한 · 러너')
/**
 * 🔴 경계값 fixture — 각 칸이 그 단계를 **딱** 채운다(기회 = 목표 · cohort 공개 = 목표 · 손실 0 · 대기 0 ·
 *    용량 = 필요량(= 목표)을 겨우 채움 · Persona = canary 하한). 넉넉한 값으로 PASS 를 만들면 경계 반례가 헛돈다.
 */
const RUNS = SUPPLY_WORKSET_PER_RUN * SUPPLY_RUNS_PER_DAY
const cohortFor = (s: GenericStage, o: Partial<ReadyCohortFact> = {}): ReadyCohortFact => ({
  sources: RUNS, published: genericDailyTarget(s), lost: 0, scheduled: 0, unknown: 0,
  usdPerSlotValidResult: SUPPLY_USD_PER_READY, ...o,
})
const factsFor = (s: GenericStage, o: Partial<PreflightFacts> = {}): PreflightFacts => ({
  slotValidOpportunities: genericDailyTarget(s), readyCohort: cohortFor(s), latencyP50H: 20, latencyP90H: 60,
  contractValidPersonas: s === 'd1' ? 1 : PERSONA_CANARY_FLOOR[s],
  commentUsdPerRequest: COMMENT_USD, commentDailyUsdCap: COMMENT_LOOP_DAILY_USD_MAX,
  auditUsdPerCall: AUDIT_USD, auditDailyUsdCap: AUDIT_CAP,
  supplyDailyUsdCap: SUPPLY_DAILY_USD_APPROVED, runnerHealth: 'ok', ...o,
})
check('비용 상한 정본 — 공급 $0.50 · 댓글 $0.20', SUPPLY_DAILY_USD_APPROVED === 0.5 && COMMENT_LOOP_DAILY_USD_MAX === 0.2)
for (const s of ['d3', 'd5', 'd10', 'd20', 'd30', 'd50'] as const) {
  const v = judgeNextPreflight(s, factsFor(s), GRID)
  check(`${s} preflight PASS — 댓글 ${v.counts.firstComments}건 · 감사 ${v.counts.auditExpected}건 · READY ${v.counts.readyNeeded}건 비용 상한 안`,
    v.verdict === 'PASS', `${v.verdict} [${v.codes.join(',')}]`)
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
check('🔴 [blocker 실측] d100 — 댓글 $0.20 로 첫 댓글 100건 불가 · 발행 용량 부족 · 공급 $0.50 로 READY 100건(목표 + 실측 손실 0) 불가',
  pf100.verdict === 'FAIL' && pf100.codes.includes('COMMENT_COST_SHORT') && pf100.codes.includes('PUBLISH_CAPACITY_SHORT')
  && pf100.codes.includes('SLOTS_INFEASIBLE') && pf100.codes.includes('SUPPLY_COST_SHORT'))
const pfCases: { name: string; s: GenericStage; o: Partial<PreflightFacts>; want: 'FAIL' | 'UNKNOWN'; code: PreflightCode }[] = [
  { name: 'slot-valid 기회 19 < 20', s: 'd20', o: { slotValidOpportunities: 19 }, want: 'FAIL', code: 'OPPORTUNITY_SHORT' },
  { name: '기회 모름', s: 'd20', o: { slotValidOpportunities: null }, want: 'UNKNOWN', code: 'OPPORTUNITY_UNKNOWN' },
  { name: 'D3 도 같은 관문 — 기회 2 < 3', s: 'd3', o: { slotValidOpportunities: 2 }, want: 'FAIL', code: 'OPPORTUNITY_SHORT' },
  { name: '수율이 필요량 아래(처리량 부족)', s: 'd20', o: { readyCohort: cohortFor('d20', { sources: Math.ceil(RUNS / 0.9) }) }, want: 'FAIL', code: 'THROUGHPUT_SHORT' },
  { name: 'cohort 모름', s: 'd20', o: { readyCohort: null }, want: 'UNKNOWN', code: 'THROUGHPUT_UNKNOWN' },
  { name: '지연 미관측', s: 'd5', o: { latencyP90H: null }, want: 'UNKNOWN', code: 'LATENCY_UNKNOWN' },
  { name: '🔴 계약 유효 Persona 모름(읽기 실패)', s: 'd3', o: { contractValidPersonas: null }, want: 'UNKNOWN', code: 'PERSONA_UNKNOWN' },
  { name: '🔴 계약 유효 Persona 0 < D3 하한 24 (2026-09-30 운영 실측) — D1→D3 부터 막힌다', s: 'd3', o: { contractValidPersonas: 0 }, want: 'FAIL', code: 'PERSONA_SHORT' },
  { name: '러너 최근 회차 실패', s: 'd5', o: { runnerHealth: 'bad' }, want: 'FAIL', code: 'RUNNER_BAD' },
  { name: '러너 모름', s: 'd5', o: { runnerHealth: null }, want: 'UNKNOWN', code: 'RUNNER_UNKNOWN' },
  { name: '댓글 단가 모름', s: 'd20', o: { commentUsdPerRequest: null }, want: 'UNKNOWN', code: 'COMMENT_COST_UNKNOWN' },
  { name: '댓글 단가 0 은 모름', s: 'd20', o: { commentUsdPerRequest: 0 }, want: 'UNKNOWN', code: 'COMMENT_COST_UNKNOWN' },
  { name: '댓글 상한 모름', s: 'd20', o: { commentDailyUsdCap: null }, want: 'UNKNOWN', code: 'COMMENT_COST_UNKNOWN' },
  { name: '댓글 단가 $0.011 × 20 > $0.20', s: 'd20', o: { commentUsdPerRequest: 0.011 }, want: 'FAIL', code: 'COMMENT_COST_SHORT' },
  { name: '감사 단가 $0.05 × 10 > $0.30', s: 'd50', o: { auditUsdPerCall: 0.05 }, want: 'FAIL', code: 'AUDIT_COST_SHORT' },
  { name: '감사 상한 모름', s: 'd20', o: { auditDailyUsdCap: null }, want: 'UNKNOWN', code: 'AUDIT_COST_UNKNOWN' },
  { name: '공급 결과당 비용 $0.011 × 목표 50 > $0.50', s: 'd50', o: { readyCohort: cohortFor('d50', { usdPerSlotValidResult: 0.011 }) }, want: 'FAIL', code: 'SUPPLY_COST_SHORT' },
  { name: '🔴 결말이 전부 대기(공개 0 · 대기 5) → 필요량 상한을 모른다 → UNKNOWN', s: 'd5', o: { readyCohort: cohortFor('d5', { published: 0, unknown: 5 }) }, want: 'UNKNOWN', code: 'READY_REQUIREMENT_UNKNOWN' },
  { name: '🔴 실측 손실 1 · 같은 cohort 용량 5 → 필요 READY 6 → 처리량 부족', s: 'd5', o: { readyCohort: cohortFor('d5', { lost: 1, sources: Math.ceil((RUNS * 6) / 5) }) }, want: 'FAIL', code: 'THROUGHPUT_SHORT' },
  { name: '결과당 공급 비용 모름(미연결 · legacy)', s: 'd20', o: { readyCohort: cohortFor('d20', { usdPerSlotValidResult: null }) }, want: 'UNKNOWN', code: 'SUPPLY_COST_UNKNOWN' },
  { name: '공급 상한 모름', s: 'd20', o: { supplyDailyUsdCap: null }, want: 'UNKNOWN', code: 'SUPPLY_COST_UNKNOWN' },
]
for (const c of pfCases) {
  const v = judgeNextPreflight(c.s, factsFor(c.s, c.o), GRID)
  check(`${c.s} ${c.name} → ${c.want} ${c.code}`, v.verdict === c.want && v.codes.includes(c.code), `${v.verdict} [${v.codes.join(',')}]`)
}
check('댓글 러너 용량 부족 → FAIL', judgeNextPreflight('d50', factsFor('d50'), { ...GRID, commentRunRequestCap: 1, commentSlots: GRID.commentSlots.slice(0, 40) }).codes.includes('COMMENT_RUNNER_SHORT'))
check(`감사 표본 = 정본 auditTarget 20% (d20 → ${auditTarget(20)} · d50 → ${auditTarget(50)})`,
  judgeNextPreflight('d20', factsFor('d20'), GRID).counts.auditExpected === 4 && auditTarget(50) === 10)
// 장부 → 단가 (controller 가 쓰는 순수 함수)
{
  const e = (stage: string, status: string, usd: number | null) => ({ stage, status, settledUsd: usd }) as never
  check('정산 단가 — 정산된 유료만 · countTokens·예약 제외', settledUnitUsd([e('commentGen', 'settled', 0.002), e('commentGen', 'settled', 0.004),
    e('countTokens', 'settled', 1), e('commentGen', 'reserved', null)]) === 0.003)
  check('정산 건 없음·못 읽음 → 모름(null)', settledUnitUsd([]) === null && settledUnitUsd(null) === null && settledTotalUsd(null) === null)
  check('상한 — 두 값 중 낮은 쪽 · 하나라도 모르면 모름', cappedBy(0.3, 0.5) === 0.3 && cappedBy(0.9, 0.5) === 0.5 && cappedBy(null, 0.5) === null)
}

// ─────────────────────────────────────────────────────────
section('⑤ 상태 기계 — 운영 decideStage 를 날마다 돌린다')

/** 증거일의 운영 모양 */
type DayMode = 'perfect' | 'human' | 'mixed' | 'manualRun' | 'late' | 'dup' | 'auditShort' | 'auditOutside' | 'costUnknown' | 'unread'

const OK_SIGNALS: HealthSignal[] = [
  { axis: 'quality', health: 'ok', reasons: [] }, { axis: 'cost', health: 'ok', reasons: [] }, { axis: 'errors', health: 'ok', reasons: [] },
]

/** 🔴 그날 실제로 일어난 일 — 결정의 공개 단계 슬롯에 글이 나가고 댓글 러너 예약표대로 첫 댓글이 붙는다 */
function factsOfDay(d: StageDecision, mode: DayMode): StageEvidenceFacts | null {
  if (mode === 'unread') return null
  const p = profileOf(d.release)
  const posts: EvidencePost[] = p.slots.map((sl, i) => {
    const m = minuteOfDay(sl)
    const t = Date.parse(`${d.kstDate}T00:00:00+09:00`) + m * 60_000
    const wait = commentCoverageOf(m, GRID).firstWait ?? 999
    const human = mode === 'human' || (mode === 'mixed' && i === 0)
    return {
      postId: `p-${d.kstDate}-${i}`, queueId: `q-${d.kstDate}-${i}`, publishedAtMs: t,
      unattended: mode !== 'manualRun', queueRows: 1, publishLogs: 1, authorPersonaId: `a-${i}`,
      decider: human ? 'human' : 'auto', release: 'STAMPED_ELIGIBLE' as const,
      personaComments: [
        { personaId: `c-${i}`, createdAtMs: t + (mode === 'late' && i === 0 ? (AUTO_FIRST_COMMENT_WINDOW_MINUTES + 1) : wait) * 60_000, topLevel: true },
        ...(mode === 'dup' && i === 0 ? [{ personaId: `c-${i}`, createdAtMs: t + 90 * 60_000, topLevel: false }] : []),
      ],
    }
  })
  const auto = posts.filter((x) => x.decider === 'auto' && x.unattended)
  const want = auditTarget(auto.length)
  const sample = auto.slice(0, mode === 'auditShort' ? Math.max(0, want - 1) : want)
  const rows = sample.map((x) => ({ postId: x.postId, queueId: x.queueId ?? '', judged: true, defectYes: false, retryable: false, overdue: false }))
  if (mode === 'auditOutside') rows.push({ postId: 'elsewhere', queueId: 'elsewhere', judged: true, defectYes: false, retryable: false, overdue: false })
  return {
    kstDate: d.kstDate, stage: d.release,
    decision: { kstDate: d.kstDate, state: d.state, release: d.release, decidedBy: d.decidedBy },
    posts, orphanPublishLogs: 0, unloggedPublishes: 0, commentCapPerPost: 1,
    audits: { rows, globalUnresolvedDefects: 0, globalOverdue: 0, globalRetryable: 0, globalMissingPosts: 0 },
  }
}
const evidenceOfDay = (d: StageDecision, mode: DayMode): StageEvidenceVerdict =>
  judgeStageEvidence(d.kstDate, d.release, factsOfDay(d, mode),
    mode === 'costUnknown' ? { cost: [{ name: '댓글', health: 'unknown' }], errors: 'ok' } : SIDE_OK)

type DayOpts = {
  facts?: (s: GenericStage) => PreflightFacts
  runAt?: (kstDate: string) => string
  signals?: HealthSignal[]
}
type Day = { decision: StageDecision; valid: ValidatedStageDecision | null; result: ControllerResult; evidence: StageEvidenceVerdict | null; reason: string }

/** 🔴 07:00 controller 한 번 — controller 스크립트와 같은 순서: 전날 증거 → 계획 → 그 대상 preflight(D3~D100) → 결정 → 저장 검증 */
function runDay(kstDate: string, prev: ValidatedStageDecision | null, prevMode: DayMode | null, o: DayOpts = {}): Day {
  const runAt = (o.runAt ?? at0700)(kstDate)
  const evidence = prev === null || prevMode === null ? null : evidenceOfDay(prev, prevMode)
  const plan = prev === null ? null : trialPlanOf(prev, evidence)
  const nextPreflight: PreflightVerdict | null = plan === null ? null
    : judgeNextPreflight(plan.target, (o.facts ?? ((s) => factsFor(s)))(plan.target), GRID)
  const result = decideStage({
    kstDate, decidedAt: runAt, previousDecision: prev, previousEvidence: evidence,
    nextPreflight, publishedToday: 0, signals: o.signals ?? OK_SIGNALS,
  })
  const v = validateForToday(result.decision)
  return { decision: result.decision, valid: v.ok ? v.decision : null, result, evidence, reason: v.ok ? '' : v.reason }
}

/** 🔴 시작 행 — controller 가 쓴 HOLD/REPROVE · capacity 는 다음 증명 단계 */
function startRow(release: RuntimeStage, state: 'HOLD' | 'REPROVE' = 'HOLD'): ValidatedStageDecision {
  const capacity = preparedStageOf(release)
  const r = validateStoredDecision({
    row: {
      kstDate: D0, capacity, release, state, reasons: [], blocks: [], dayPinned: false, supply: null,
      decidedAt: at0700(D0), contractVersion: STAGE_DECISION_VERSION, decidedBy: DECISION_WRITER, transition: null,
    }, expectKstDate: D0,
  })
  if (!r.ok) throw new Error(r.reason)
  return r.decision
}

/** 🔴 여러 날 — 날마다 앞날의 운영 모양(mode)을 받는다 */
function walk(start: ValidatedStageDecision, modes: readonly DayMode[], o: DayOpts | ((i: number) => DayOpts) = {}): { days: Day[]; trace: string; allValid: boolean } {
  const days: Day[] = []
  let prev: ValidatedStageDecision | null = start
  for (let i = 0; i < modes.length; i += 1) {
    const d = runDay(addDays(D0, i + 1), prev, modes[i]!, typeof o === 'function' ? o(i) : o)
    days.push(d)
    prev = d.valid
  }
  const trace = days.map((d) => `${d.decision.state}:${d.decision.release}`).join(' ')
  return { days, trace, allValid: days.every((d) => d.valid !== null) }
}
const tr = (d: Day): string => `${d.decision.state}:${d.decision.release}`
const basisOf = (d: Day): string | null => (d.decision.transition?.kind === 'TRIAL' ? d.decision.transition.basis ?? null : null)
const baseOf = (d: Day): string | null => (d.decision.transition?.kind === 'TRIAL' ? d.decision.transition.trialBase : null)
const blocked = (d: Day, code: string): boolean => d.decision.blocks.some((b) => b.code === code)

// S1 — 전부 PASS → 날마다 한 칸 · 맨 위 d50 에서 멈춘다
{
  const w = walk(startRow('d1'), ['perfect', 'perfect', 'perfect', 'perfect', 'perfect', 'perfect', 'perfect', 'perfect'])
  console.log(`   S1 전부 PASS: ${w.trace}`)
  check('🟢 S1 PASS 다음 날마다 한 칸 — d3 → d5 → d10 → d20 → d30 → d50 (날짜로 기다리지 않는다)',
    w.days.slice(0, 6).map(tr).join(' ') === 'TRIAL:d3 TRIAL:d5 TRIAL:d10 TRIAL:d20 TRIAL:d30 TRIAL:d50', w.trace)
  check('S1 근거 — FLOOR 다음은 전부 PASS · 기반은 전날 공개', basisOf(w.days[0]!) === 'FLOOR'
    && w.days.slice(1, 6).every((d) => basisOf(d) === 'PASS')
    && w.days.slice(1, 6).every((d, i) => baseOf(d) === w.days[i]!.decision.release))
  check('S1 모든 결정이 저장 계약을 통과한다', w.allValid, w.days.map((d) => d.reason).filter((x) => x !== '').join(' / '))
  check('🔴 S1 d50 PASS 뒤 — 지속 d50(증명됐다) · 위 칸 없음 → REPROVE d50 · 러너 밖(d100)으로 가지 않는다',
    tr(w.days[6]!) === 'REPROVE:d50' && w.days.every((d) => stageRank(d.decision.release) <= stageRank('d50')), w.trace)
  check('S1 d20 시험은 07:00 에 열려 08:00 첫 슬롯부터 20건 — 결정의 capacity 는 다음 증명 d30',
    w.days[3]!.decision.capacity === 'd30' && firstSlotOn(w.days[3]!.decision.kstDate, profileOf('d20'))!.toISOString()
      === new Date(`${w.days[3]!.decision.kstDate}T08:00:00+09:00`).toISOString())
  check('🔴 S1 어느 날도 SUSTAIN 을 만들지 않는다', w.days.every((d) => d.decision.state !== 'SUSTAIN'))
}

// S2 — 🔴 계약 유효 Persona 를 읽지 못함(null) → 바닥에서 올라가지 않는다
{
  const w = walk(startRow('d1'), Array.from({ length: 5 }, () => 'perfect' as const), { facts: (s) => factsFor(s, { contractValidPersonas: null }) })
  console.log(`   S2 Persona 모름: ${w.trace}`)
  check('🔴 🔴 S2 contractValidPersonas=null 5일 — d3 도 열리지 않는다(PREFLIGHT_UNKNOWN) · 바닥 PREPARE',
    w.days.every((d) => tr(d) === 'PREPARE:d1' && blocked(d, 'PREFLIGHT_UNKNOWN')), w.trace)
  check('S2 모든 결정이 저장 계약을 통과한다', w.allValid)
}

// S2b — 🔴 오늘 운영 모양(2026-09-30 실측): 계약 유효 Persona 0 → D3 하한 24 미달 → D1→D3 시험부터 열리지 않는다
{
  const w = walk(startRow('d1'), Array.from({ length: 5 }, () => 'perfect' as const), { facts: (s) => factsFor(s, { contractValidPersonas: 0 }) })
  console.log(`   S2b Persona 0: ${w.trace}`)
  check('🔴 🔴 S2b contractValidPersonas=0 5일 — d3 시험이 한 번도 열리지 않는다(PREFLIGHT_FAIL) · 바닥 PREPARE',
    w.days.every((d) => tr(d) === 'PREPARE:d1' && blocked(d, 'PREFLIGHT_FAIL')), w.trace)
  check('S2b 모든 결정이 저장 계약을 통과한다', w.allValid)
}

// S3 — FAIL · UNKNOWN · 모름 → 같은 단계 재시험
{
  const modes: DayMode[] = ['perfect', 'perfect', 'perfect', 'late', 'costUnknown', 'unread', 'perfect']
  const w = walk(startRow('d5', 'REPROVE'), modes)
  console.log(`   S3 d30 에서 FAIL·UNKNOWN·못 읽음: ${w.trace}`)
  check('S3 앞 셋 — REPROVE d5 PASS → d10 → d20 → d30', w.days.slice(0, 3).map(tr).join(' ') === 'TRIAL:d10 TRIAL:d20 TRIAL:d30', w.trace)
  check('🔴 S3 d30 첫 댓글 61분(FAIL) → 다음 날 d30 재시험(기반 d20 · RETEST)', tr(w.days[3]!) === 'TRIAL:d30'
    && basisOf(w.days[3]!) === 'RETEST' && baseOf(w.days[3]!) === 'd20' && w.days[3]!.evidence?.verdict === 'FAIL')
  check('🔴 S3 비용 모름(UNKNOWN) → 또 d30 재시험', tr(w.days[4]!) === 'TRIAL:d30' && basisOf(w.days[4]!) === 'RETEST' && w.days[4]!.evidence?.verdict === 'UNKNOWN')
  check('🔴 S3 증거를 못 읽음 → 또 d30 재시험', tr(w.days[5]!) === 'TRIAL:d30' && basisOf(w.days[5]!) === 'RETEST')
  check('S3 PASS 가 난 다음 날에야 d50', tr(w.days[6]!) === 'TRIAL:d50' && basisOf(w.days[6]!) === 'PASS')
}

// S4 — 날짜만으로는 오르지 않는다 · HOLD 날은 PASS 가 아니다
{
  const w = walk(startRow('d5', 'REPROVE'), Array.from({ length: 10 }, () => 'unread' as const))
  check('🔴 🔴 S4 증거 없는 10일 — REPROVE d5 에 머문다(시험 0 · 올라가지 않는다)', w.days.every((d) => tr(d) === 'REPROVE:d5'), w.trace)
  const h = walk(startRow('d10', 'HOLD'), ['perfect', 'perfect'])
  check('🔴 S4 HOLD d10 날은 완벽해도 PASS 가 아니다 → 다음 날 REPROVE d10 → 그 PASS 다음 날 TRIAL d20',
    h.trace === 'REPROVE:d10 TRIAL:d20' && h.days[0]!.evidence?.codes.includes('DECISION_NOT_TRANSITION') === true, h.trace)
  check('🔴 S4 REPROVE 는 증거 본체가 증명일로 받는다(HOLD 는 아니다)',
    PROOF_STATES.includes('REPROVE') && !PROOF_STATES.includes('HOLD') && TRANSITION_STATES.includes('REPROVE'))
}

// S5 — 사람 물량은 0건
for (const m of ['human', 'mixed', 'manualRun'] as const) {
  const w = walk(startRow('d10', 'REPROVE'), ['perfect', m])
  check(`🔴 S5 ${m} — TRIAL d20 날 사람/수동 물량 → FAIL PUBLISH_NOT_AUTO_READY → d20 재시험`,
    tr(w.days[0]!) === 'TRIAL:d20' && tr(w.days[1]!) === 'TRIAL:d20' && basisOf(w.days[1]!) === 'RETEST'
    && w.days[1]!.evidence?.codes.includes('PUBLISH_NOT_AUTO_READY') === true, `${w.trace} ${JSON.stringify(w.days[1]!.evidence?.codes)}`)
}

// S7 — 한 관문 (preflight · 첫 슬롯) — D3~D100 같은 구조
{
  const base = (o: DayOpts): Day => runDay(addDays(D0, 1), startRow('d10', 'REPROVE'), 'perfect', o)
  const green = base({})
  check('S7 기준선 — REPROVE d10 PASS · preflight 초록 → TRIAL d20', tr(green) === 'TRIAL:d20' && green.valid !== null)
  const cases: { name: string; o: DayOpts; code: string }[] = [
    { name: 'slot-valid 기회 모자람', o: { facts: (s) => factsFor(s, { slotValidOpportunities: 5 }) }, code: 'PREFLIGHT_FAIL' },
    { name: '처리량 모자람', o: { facts: (s) => factsFor(s, { readyCohort: cohortFor(s, { sources: 10_000 }) }) }, code: 'PREFLIGHT_FAIL' },
    { name: 'Persona canary 하한 미달', o: { facts: (s) => factsFor(s, { contractValidPersonas: 10 }) }, code: 'PREFLIGHT_FAIL' },
    { name: '댓글 비용 초과', o: { facts: (s) => factsFor(s, { commentUsdPerRequest: 0.05 }) }, code: 'PREFLIGHT_FAIL' },
    { name: '공급 비용 모름', o: { facts: (s) => factsFor(s, { readyCohort: cohortFor(s, { usdPerSlotValidResult: null }) }) }, code: 'PREFLIGHT_UNKNOWN' },
    { name: '08:30 에 늦게 돈 controller', o: { runAt: (d) => new Date(`${d}T08:30:00+09:00`).toISOString() }, code: 'LATE_START' },
  ]
  for (const c of cases) {
    const d = base(c.o)
    check(`🔴 S7 ${c.name} → d20 을 열지 않는다 · ${c.code} · d10 증명일`, tr(d) === 'REPROVE:d10' && blocked(d, c.code) && d.valid !== null,
      `${tr(d)} ${JSON.stringify(d.decision.blocks.map((b) => b.code))}`)
  }
  check('🔴 S7 preflight 없이(null) 시험 → PREFLIGHT_UNKNOWN', trialBlocks({
    target: 'd20', kstDate: D0, runAt: at0700(D0), preflight: null,
  }).some((b) => b.code === 'PREFLIGHT_UNKNOWN'))
  check('🔴 S7 다른 단계(d30) preflight 초록으로 d20 을 열지 않는다', trialBlocks({
    target: 'd20', kstDate: D0, runAt: at0700(D0), preflight: judgeNextPreflight('d30', factsFor('d30'), GRID),
  }).some((b) => b.code === 'PREFLIGHT_UNKNOWN'))
  // 🔴 (2026-09-30) d3~d10 도 같은 관문이다 — 사실을 모르면 d5 도 열리지 않는다
  const d5 = runDay(addDays(D0, 1), startRow('d3', 'REPROVE'), 'perfect', { facts: (s) => factsFor(s, {
    slotValidOpportunities: null, contractValidPersonas: null, commentUsdPerRequest: null, auditUsdPerCall: null, readyCohort: null,
  }) })
  check('🔴 🔴 S7 d3~d10 시험도 같은 관문을 지난다(사실 전부 모름 → d5 열지 않음 · REPROVE d3)',
    tr(d5) === 'REPROVE:d3' && blocked(d5, 'PREFLIGHT_UNKNOWN'), tr(d5))
}

// S8 — 운영 신호 브레이크는 증명일을 되돌린다
{
  const bad = runDay(addDays(D0, 1), startRow('d5', 'REPROVE'), 'unread', {
    signals: [{ axis: 'quality', health: 'bad', reasons: ['확정 결함 1건'] }, ...OK_SIGNALS.slice(1)],
  })
  check('🔴 S8 품질 나쁨 → 감속 · 증명일 아님(HOLD/PREPARE)', bad.result.brake === 'slowdown' && !PROOF_STATES.includes(bad.decision.state), tr(bad))
  const unk = runDay(addDays(D0, 1), startRow('d5', 'REPROVE'), 'unread', {
    signals: [OK_SIGNALS[0]!, { axis: 'cost', health: 'unknown', reasons: [] }, OK_SIGNALS[2]!],
  })
  check('🔴 S8 비용 모름 → REPROVE 를 되돌린다(자동 target 을 앞세우지 않는다)', unk.result.brake === 'holdUnknown'
    && unk.decision.release === 'd5' && !PROOF_STATES.includes(unk.decision.state), tr(unk))
}

// S9 — 러너 맨 위는 d50 · capacity 도 d50 을 넘지 않는다
{
  const w = walk(startRow('d30', 'REPROVE'), Array.from({ length: 5 }, () => 'perfect' as const))
  check('🔴 S9 d50 위는 열리지 않는다 · capacity ≤ d50', w.days.every((d) => stageRank(d.decision.release) <= stageRank('d50')
    && stageRank(d.decision.capacity) <= stageRank('d50')) && w.allValid && tr(w.days[0]!) === 'TRIAL:d50', w.trace)
}

// S10 — 중복 · 감사 표본
for (const [m, code] of [['dup', 'DUP_COMMENT'], ['auditShort', 'AUDIT_COVERAGE_SHORT'], ['auditOutside', 'AUDIT_OUTSIDE_TARGET']] as const) {
  const w = walk(startRow('d10', 'REPROVE'), ['perfect', m])
  check(`🔴 S10 ${m} → FAIL ${code} → d20 재시험`, tr(w.days[1]!) === 'TRIAL:d20' && basisOf(w.days[1]!) === 'RETEST'
    && w.days[1]!.evidence?.codes.includes(code) === true, `${w.trace} ${JSON.stringify(w.days[1]!.evidence?.codes)}`)
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
  check('계약 — REPROVE d10 (천장 d20) 통과 · REPROVE 에 전이 근거가 붙으면 거절',
    V({}) && !V({ transition: { kind: 'SUSTAIN', from: 'd5', to: 'd10' } }))
  check('계약 — TRIAL d20 (기반 d10 · PASS) 통과', V(trial({})))
  check('🔴 계약 — TRIAL d20 이 기반 d5 에서 뛰면 거절 · 근거 없으면 거절', !V(trial({ trialBase: 'd5' })) && !V(trial({ basis: undefined })))
  check('🔴 계약 — TRIAL 에 PREFLIGHT_FAIL · PREFLIGHT_UNKNOWN · LATE_START 가 붙으면 거절',
    (['PREFLIGHT_FAIL', 'PREFLIGHT_UNKNOWN', 'LATE_START'] as const).every((code) => !V({ ...trial({}), blocks: [{ code, reason: 'x' }] })))
  check('🔴 계약 — 공개가 천장 위(d30 > d20)면 거절 · d100 은 저장 단계가 아니다',
    !V({ release: 'd30' }) && !V({ capacity: 'd100' }) && !V({ release: 'd100', capacity: 'd100' }))
}

// ─────────────────────────────────────────────────────────
section('⑥ 러너 연결 — consumer env → 러너 설정 · catch-up · 증명일 · 발행 천장')
{
  const w = walk(startRow('d10', 'REPROVE'), ['perfect'])
  const t = w.days[0]!
  const env = t.valid === null ? {} : consumerEnvOf({ ok: true, decision: t.valid })
  check('🔴 consumer — TRIAL d20 → 공개 d20 그대로(canary 없음) · capacity d30 · 증명일 d20',
    env.SORAN_RELEASE_STAGE === 'd20' && env.SORAN_CAPACITY_STAGE === 'd30' && env[PROOF_STAGE_ENV] === 'd20'
    && !Object.keys(env).some((k) => /CANARY|WINDOW/.test(k)), JSON.stringify(env))
  const now = new Date(`${t.decision.kstDate}T08:00:00+09:00`)
  const sc = resolveScale(env)
  check('🟢 러너 — 결정 env 그대로 → 공개 d20 · 하루 20건', sc.releaseStage === 'd20' && sc.releaseProfile.dailyTarget === 20, JSON.stringify(sc.notes))
  const cu = judgeCatchUp({ stage: sc.releaseStage, now, trigger: 'local', cron: null, publishedToday: 0 })
  check('러너 — 08:00 heartbeat 가 d20 첫 슬롯을 낸다(1건)', cu.run && cu.allowed === 1)
  const late = judgeCatchUp({ stage: 'd20', now: new Date(`${t.decision.kstDate}T22:10:00+09:00`), trigger: 'local', cron: null, publishedToday: 19 })
  check('🔴 러너 — 22:00 넘은 backlog 는 버린다', !late.run)
  const proof = proofDayOf(env, now)
  check('러너 — 증명일 d20 · 목표 20', proof !== null && proof.stage === 'd20' && proof.target === 20)
  check('🔴 발행 트랜잭션 천장 — 같은 env 로 d20 · d10 env 면 d20 요청도 d10 으로 누른다(옛 canary 키는 무시)',
    boundedReleaseStage('d20', env, now) === 'd20'
    && boundedReleaseStage('d20', markedStageEnv({ [CAPACITY_ENV]: 'd10', [RELEASE_ENV]: 'd10', SORAN_RELEASE_CANARY_STAGE: 'd20', SORAN_RELEASE_CANARY_DATE: t.decision.kstDate }), now) === 'd10')
  const r = walk(startRow('d5', 'REPROVE'), ['unread']).days[0]!
  const renv = r.valid === null ? {} : consumerEnvOf({ ok: true, decision: r.valid })
  check('consumer — REPROVE d5 → 공개 d5 · 증명일 d5', tr(r) === 'REPROVE:d5' && renv.SORAN_RELEASE_STAGE === 'd5'
    && renv[PROOF_STAGE_ENV] === 'd5', JSON.stringify(renv))
  const henv = consumerEnvOf({ ok: true, decision: startRow('d10', 'HOLD') })
  check('consumer — HOLD d10 → 증명일 아님(빈 값) · 공정성 그대로', henv[PROOF_STAGE_ENV] === '' && henv.SORAN_RELEASE_STAGE === 'd10')
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
  check('🔴 HOLD · PREPARE 날은 완벽해도 DECISION_NOT_TRANSITION', hold.verdict === 'FAIL' && hold.codes.join(',') === 'DECISION_NOT_TRANSITION'
    && judgeStageEvidence(D0, 'd5', factsOfDay(row('d5', 'PREPARE'), 'perfect'), SIDE_OK).codes.includes('DECISION_NOT_TRANSITION'))
  check('비용·러너 모름 → UNKNOWN (PASS 아님)', judgeStageEvidence(D0, 'd20', factsOfDay(row('d20', 'TRIAL'), 'perfect'), null).verdict === 'UNKNOWN')
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 운영 decideStage · 저장 계약 · 증거 본체 · consumer · 러너 설정을 한 줄로 돌렸다. DB 0 · 운영 env 0 · 유료 호출 0.')
process.exit(fail === 0 ? 0 : 1)
