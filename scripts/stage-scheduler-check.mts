#!/usr/bin/env tsx
/**
 * 🔴 **D1→D100 일반 단계 스케줄러 골격 검사 — 순수 fixture. DB 0 · 네트워크 0 · env 0 · 파일 write 0** (2026-09-29)
 *
 *   ① 단계 목록 · 목표 — 앞 넷은 운영 `RELEASE_STAGES` 그대로 · D20+ 목표는 창업자 계획(`d100Plan`)과 같다
 *   ② 승인 천장 — d20 을 표현하되 열 수 있는 천장은 러너 배선 상한 · 지금 운영값 d10 은 그대로
 *   ③ 슬롯 — 운영 창 안 · heartbeat 격자 위 · 60분 안 첫 댓글 시도 3회 · 운영 d1~d10 도 같은 계약을 지킨다
 *   ④ preflight — 재고 · Persona · 댓글 비용/러너 · 감사 비용 · 발행 용량
 *   ⑤ 상태 기계 — PASS 뒤에만 한 칸 · FAIL/UNKNOWN 재시험 · 날짜만으로 안 오름 · 천장 위 금지 · 정체 없음
 *   ⑥ 증거 본체 — `judgeStageEvidence` 와 `judgeEvidenceForTarget` 이 d1~d10 에서 같다 · 사람 물량 0건
 *
 * 🔴 러너 사실(격자 · 댓글 예약표 · 회차 상한)은 **정본 템플릿에서 읽는다** — 여기서 숫자를 다시 적지 않는다.
 *    단가 둘만 fixture 다: 댓글 $0.00222(= `persona-comment-loop-check` 가 운영 장부와 대조하는 실측 1건),
 *    감사 $0.005(가정 — 감사 장부 실측 전). 🔴 이 검사는 배선을 증명하지 않는다 — 골격만 본다.
 */
import {
  GENERIC_STAGES, genericNextStage, genericDailyTarget, isRuntimeStage, resolveCeiling, HIGHEST_RUNTIME_STAGE,
  validPublishMinutes, publishCapacityOf, deriveSlots, genericProfileOf, verifyGenericProfile, commentCoverageOf,
  judgeNextPreflight, planGenericStage, firstSlotOn,
  type RunnerGrid, type PreflightFacts, type GenericStage, type GenericPrevious, type GenericEvidence,
  type GenericPlanInput, type PreflightVerdict,
} from '../src/lib/stage-ladder-generic'
import { PROFILES, RELEASE_STAGES, resolveStage, minuteOfDay, type ReleaseStage } from '../src/lib/scale-profile'
import { PER_RUN_MAX, PUBLISH_WINDOW_START_MINUTE, PUBLISH_WINDOW_END_MINUTE } from '../src/lib/publish-slot-catchup'
import {
  COMMENT_LOOP_DAILY_USD_MAX, COMMENT_LOOP_RUN_REQUEST_CAP_DEFAULT, AUTO_FIRST_COMMENT_WINDOW_MINUTES,
} from '../src/lib/persona-comment-auto-lane'
import { d100Plan, PERSONA_CANARY_FLOOR } from '../src/lib/d100-capacity'
import {
  judgeStageEvidence, judgeEvidenceForTarget, trialPlanOf,
  type EvidencePost, type EvidenceSideSignals, type StageEvidenceFacts,
} from '../src/lib/stage-evidence'
import { auditTarget } from '../src/lib/auto-ready-v2'
import {
  validateStoredDecision, STAGE_DECISION_VERSION, DECISION_WRITER,
  type ValidatedStageDecision, type StageDecision,
} from '../src/lib/stage-decision-contract'
import { HEARTBEAT_INTERVAL_MINUTES } from './lib/original-post-runner-template'
import { COMMENT_RUNNER_SLOTS, FIRST_COMMENT_ATTEMPTS } from './lib/persona-comment-runner-template'

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}
const section = (s: string): void => console.log(`\n── ${s} ──`)

/** 🔴 정본 러너 사실 — 템플릿 상수 그대로 */
const GRID: RunnerGrid = {
  gridMinutes: HEARTBEAT_INTERVAL_MINUTES,
  perRunMax: PER_RUN_MAX,
  commentSlots: COMMENT_RUNNER_SLOTS,
  attempts: FIRST_COMMENT_ATTEMPTS,
  commentRunRequestCap: COMMENT_LOOP_RUN_REQUEST_CAP_DEFAULT,
}
/** 🔴 fixture 단가 — 머리말 참고 */
const COMMENT_USD = 0.00222
const AUDIT_USD = 0.005
const AUDIT_CAP = 0.30

const D = '2026-09-29'
const TODAY = '2026-09-30'
const RUN_AT = new Date(`${TODAY}T07:00:00+09:00`)
const SIDE_OK: EvidenceSideSignals = {
  cost: [{ name: '공급', health: 'ok' }, { name: '댓글', health: 'ok' }, { name: '감사', health: 'ok' }], errors: 'ok',
}

// ─────────────────────────────────────────────────────────
section('① 단계 목록 · 목표')
check('앞 네 칸이 운영 RELEASE_STAGES 와 같다 (d1·d3·d5·d10)',
  RELEASE_STAGES.every((s, i) => GENERIC_STAGES[i] === s) && GENERIC_STAGES.length === 8)
check('d1~d10 목표는 운영 PROFILES 그대로다', RELEASE_STAGES.every((s) => genericDailyTarget(s) === PROFILES[s].dailyTarget))
for (const s of ['d20', 'd30', 'd50', 'd100'] as const) {
  check(`${s} 목표 ${genericDailyTarget(s)} = 창업자 계획 publicPostsPerDay ${d100Plan(s).publicPostsPerDay}`,
    genericDailyTarget(s) === d100Plan(s).publicPostsPerDay)
  check(`${s} 는 러너 배선 단계가 아니다(isRuntimeStage=false)`, !isRuntimeStage(s))
}
check('다음 칸 d10 → d20 · d50 → d100 · d100 → 없음',
  genericNextStage('d10') === 'd20' && genericNextStage('d50') === 'd100' && genericNextStage('d100') === null)

// ─────────────────────────────────────────────────────────
section('② 승인 천장 — fail-closed · 지금 운영값 불변')
const c10 = resolveCeiling('d10')
check('🔴 지금 운영값 d10 → 승인 d10 · 열 수 있는 천장 d10 (바뀌지 않는다)',
  c10.authorized === 'd10' && c10.operable === 'd10' && c10.fallbackReason === null)
check('운영 resolveStage 도 d10 을 그대로 읽는다(기준선)', resolveStage('d10', 'capacity').stage === 'd10')
const c20 = resolveCeiling('d20')
check('d20 을 표현한다 — 승인 d20 · 열 수 있는 천장은 러너 상한 d10',
  c20.authorized === 'd20' && c20.operable === HIGHEST_RUNTIME_STAGE && HIGHEST_RUNTIME_STAGE === 'd10')
check('🔴 [blocker 실측] 운영 resolveStage 는 d20 을 모르는 값으로 보고 d1 로 떨어뜨린다',
  resolveStage('d20', 'capacity').stage === 'd1')
for (const raw of ['', 'd200', 'D20', ' d7 ', 'd100x']) {
  const r = resolveCeiling(raw)
  check(`모르는 천장 "${raw}" → d1 (fail-closed)`, r.authorized === 'd1' && r.operable === 'd1' && r.fallbackReason !== null)
}

// ─────────────────────────────────────────────────────────
section('③ 슬롯 — 창 · 격자 · 첫 댓글 시도')
const valid = validPublishMinutes(GRID)
const cap = publishCapacityOf(GRID)
console.log(`   유효 발행 분 ${valid.length}개 (격자 ${GRID.gridMinutes}분 · 회차당 ${GRID.perRunMax}건 · 댓글 회차 ${GRID.commentSlots.length}개 · 시도 ${GRID.attempts}회) → 하루 용량 ${cap}건`)
check('유효 발행 분은 전부 창(08:00~22:00) 안 · 격자 위',
  valid.every((m) => m >= PUBLISH_WINDOW_START_MINUTE && m <= PUBLISH_WINDOW_END_MINUTE && m % GRID.gridMinutes === 0))
check('유효 발행 분마다 60분 안 댓글 시도 ≥ 3회', valid.every((m) => commentCoverageOf(m, GRID).runs >= GRID.attempts))
for (const s of RELEASE_STAGES) {
  const probs = verifyGenericProfile(PROFILES[s], GRID)
  check(`기준선 — 운영 ${s} 프로필이 같은 슬롯 계약을 지킨다`, probs.length === 0, probs.join(' / '))
}
for (const s of ['d20', 'd30', 'd50'] as const) {
  const g = genericProfileOf(s, GRID)
  if (!g.ok) { check(`${s} 프로필 파생`, false, g.problems.join(' / ')); continue }
  const mins = g.profile.slots.map(minuteOfDay)
  const waits = mins.map((m) => commentCoverageOf(m, GRID).firstWait ?? 999)
  console.log(`   ${s}: 슬롯 ${g.profile.slots.length}개 · 첫 ${String(Math.floor(mins[0]! / 60)).padStart(2, '0')}:${String(mins[0]! % 60).padStart(2, '0')} · 끝 ${String(Math.floor(mins.at(-1)! / 60)).padStart(2, '0')}:${String(mins.at(-1)! % 60).padStart(2, '0')} · 첫 댓글 대기 최대 ${Math.max(...waits)}분`)
  check(`${s} 슬롯 수 = 목표 ${genericDailyTarget(s)}`, g.profile.slots.length === genericDailyTarget(s)
    && g.profile.slots.every((x) => x.count === 1))
  check(`${s} 슬롯이 서로 다른 분 · 시각순`, mins.every((m, i) => i === 0 || m > mins[i - 1]!))
  check(`${s} 슬롯 계약(창 · 격자 · 시도 3회) 통과`, verifyGenericProfile(g.profile, GRID).length === 0)
  check(`${s} 첫 댓글 대기 ≤ 20분 (운영 d1~d10 과 같은 관측)`, Math.max(...waits) <= 20)
  check(`${s} Persona 간격은 d10 운영값 그대로 (주 ${PROFILES.d10.postsPerWeek} · ${PROFILES.d10.minDaysBetween}일)`,
    g.profile.postsPerWeek === PROFILES.d10.postsPerWeek && g.profile.minDaysBetween === PROFILES.d10.minDaysBetween)
}
const g100 = genericProfileOf('d100', GRID)
check(`🔴 [blocker 실측] d100 은 지금 러너로 담을 수 없다 — 용량 ${cap} < 100`, !g100.ok && cap < 100,
  g100.ok ? '파생됐다' : '')
{
  const d = deriveSlots(100, GRID)
  check('🔴 deriveSlots 자체가 용량 초과를 거절한다(겹친 슬롯으로 메우지 않는다)',
    !d.ok && d.problems.some((x) => x.includes(`${cap}건`)), d.ok ? '만들었다' : d.problems.join(' / '))
  const d80 = deriveSlots(cap, GRID)
  check(`경계 — 용량 ${cap}건은 서로 다른 분으로 담긴다`, d80.ok && new Set(d80.slots.map(minuteOfDay)).size === cap)
}
check('반례 — 격자 5분 · 같은 댓글 표라면 d100 이 담긴다(격자가 병목임을 보인다)',
  deriveSlots(100, { ...GRID, gridMinutes: 5 }).ok)
check('반례 — 목표 0 · 101 · 소수는 만들지 않는다',
  !deriveSlots(0, GRID).ok && !deriveSlots(101, GRID).ok && !deriveSlots(2.5, GRID).ok)
check('반례 — 22시에 가까운 슬롯은 시도 3회가 안 돼 계약 위반', verifyGenericProfile({
  dailyTarget: 1, postsPerWeek: 1, minDaysBetween: 5, slots: [{ hour: 21, minute: 40, count: 1 }],
}, GRID).some((p) => p.includes('댓글 시도')))
check('반례 — 격자 밖 분(09:35)은 계약 위반', verifyGenericProfile({
  dailyTarget: 1, postsPerWeek: 1, minDaysBetween: 5, slots: [{ hour: 9, minute: 35, count: 1 }],
}, GRID).some((p) => p.includes('격자')))

// ─────────────────────────────────────────────────────────
section('④ preflight')
const factsFor = (s: GenericStage, o: Partial<PreflightFacts> = {}): PreflightFacts => ({
  readyAutoStock: genericDailyTarget(s), activePersonas: s === 'd1' ? 1 : PERSONA_CANARY_FLOOR[s],
  commentUsdPerRequest: COMMENT_USD, commentDailyUsdCap: COMMENT_LOOP_DAILY_USD_MAX,
  auditUsdPerCall: AUDIT_USD, auditDailyUsdCap: AUDIT_CAP, ...o,
})
for (const s of ['d20', 'd30', 'd50'] as const) {
  const v = judgeNextPreflight(s, factsFor(s), GRID)
  check(`${s} preflight 기준선 PASS`, v.verdict === 'PASS', `${v.verdict} [${v.codes.join(',')}]`)
}
const pf100 = judgeNextPreflight('d100', factsFor('d100'), GRID)
console.log(`   d100: ${pf100.verdict} [${pf100.codes.join(',')}] · 댓글 감당 ${pf100.counts.commentAffordable}건/day`)
check('🔴 [blocker 실측] d100 — 댓글 하루 $0.20 로 첫 댓글 100건을 못 산다(COMMENT_COST_SHORT)',
  pf100.codes.includes('COMMENT_COST_SHORT'))
check('🔴 [blocker 실측] d100 — 발행 용량 부족(PUBLISH_CAPACITY_SHORT · SLOTS_INFEASIBLE)',
  pf100.codes.includes('PUBLISH_CAPACITY_SHORT') && pf100.codes.includes('SLOTS_INFEASIBLE') && pf100.verdict === 'FAIL')
check('재고 모자람 → FAIL STOCK_SHORT', judgeNextPreflight('d20', factsFor('d20', { readyAutoStock: 19 }), GRID).codes.includes('STOCK_SHORT'))
check('재고 모름 → UNKNOWN (PASS 아님)', judgeNextPreflight('d20', factsFor('d20', { readyAutoStock: null }), GRID).verdict === 'UNKNOWN')
check('Persona 하한 미달 → FAIL', judgeNextPreflight('d20', factsFor('d20', { activePersonas: PERSONA_CANARY_FLOOR.d20 - 1 }), GRID).verdict === 'FAIL')
check('댓글 단가 모름 → UNKNOWN', judgeNextPreflight('d20', factsFor('d20', { commentUsdPerRequest: null }), GRID).verdict === 'UNKNOWN')
check('댓글 단가 0 은 모름으로 본다(무한 감당 아님)', judgeNextPreflight('d20', factsFor('d20', { commentUsdPerRequest: 0 }), GRID).codes.includes('COMMENT_COST_UNKNOWN'))
check('감사 비용 초과 → FAIL AUDIT_COST_SHORT', judgeNextPreflight('d50', factsFor('d50', { auditUsdPerCall: 0.05 }), GRID).codes.includes('AUDIT_COST_SHORT'))
check('댓글 러너 용량 부족 → FAIL', judgeNextPreflight('d50', factsFor('d50'), { ...GRID, commentRunRequestCap: 1, commentSlots: GRID.commentSlots.slice(0, 40) }).codes.includes('COMMENT_RUNNER_SHORT'))
check(`감사 표본 = 정본 auditTarget (d20 → ${auditTarget(20)})`, judgeNextPreflight('d20', factsFor('d20'), GRID).counts.auditExpected === auditTarget(20))

// ─────────────────────────────────────────────────────────
section('⑤ 상태 기계')
const prev = (release: GenericStage, state: GenericPrevious['state'], o: Partial<GenericPrevious> = {}): GenericPrevious =>
  ({ kstDate: D, release, state, decidedBy: DECISION_WRITER, trialBase: null, ...o })
const ev = (stage: GenericStage, verdict: GenericEvidence['verdict'], kstDate = D): GenericEvidence => ({ kstDate, stage, verdict })
const green = (s: GenericStage): PreflightVerdict => judgeNextPreflight(s, factsFor(s), GRID)
const base = (o: Partial<GenericPlanInput>): GenericPlanInput => ({
  kstDate: TODAY, runAt: RUN_AT, previous: null, evidence: null, ceiling: 'd10',
  preflight: green, grid: GRID, ...o,
})
const allWired = (): boolean => true

// 운영 구간 d1~d10 — #620 과 같은 전이
let p = planGenericStage(base({ previous: prev('d1', 'HOLD') }))
check('FLOOR — 전날 d1 → 오늘 TRIAL d3', p.state === 'TRIAL' && p.release === 'd3' && p.basis === 'FLOOR' && p.base === 'd1')
p = planGenericStage(base({ previous: prev('d3', 'TRIAL', { trialBase: 'd1' }), evidence: ev('d3', 'PASS') }))
check('PASS — 전날 TRIAL d3 PASS → TRIAL d5 (기반 d3)', p.state === 'TRIAL' && p.release === 'd5' && p.basis === 'PASS' && p.base === 'd3')
p = planGenericStage(base({ previous: prev('d3', 'TRIAL', { trialBase: 'd1' }), evidence: ev('d3', 'FAIL') }))
check('🔴 FAIL → 같은 단계 재시험 TRIAL d3 (기반 d1 · RETEST)', p.state === 'TRIAL' && p.release === 'd3' && p.basis === 'RETEST' && p.base === 'd1')
p = planGenericStage(base({ previous: prev('d3', 'TRIAL', { trialBase: 'd1' }), evidence: ev('d3', 'UNKNOWN') }))
check('🔴 UNKNOWN → 같은 단계 재시험', p.state === 'TRIAL' && p.release === 'd3' && p.basis === 'RETEST')
p = planGenericStage(base({ previous: prev('d3', 'TRIAL', { trialBase: 'd1' }), evidence: null }))
check('🔴 증거 없음 → 같은 단계 재시험', p.state === 'TRIAL' && p.release === 'd3' && p.basis === 'RETEST')
p = planGenericStage(base({ previous: prev('d3', 'TRIAL', { trialBase: 'd1' }), evidence: ev('d3', 'PASS', '2026-09-28') }))
check('🔴 다른 날의 PASS 로 올리지 않는다', p.release === 'd3' && p.basis === 'RETEST')
p = planGenericStage(base({ previous: prev('d3', 'TRIAL', { trialBase: 'd1' }), evidence: ev('d5', 'PASS') }))
check('🔴 다른 단계의 PASS 로 올리지 않는다', p.release === 'd3' && p.basis === 'RETEST')
p = planGenericStage(base({ previous: prev('d5', 'HOLD'), evidence: ev('d5', 'PASS') }))
check('🔴 HOLD 날의 PASS 주장은 받지 않는다(전이·증명일 결정만) → REPROVE d5', p.state === 'REPROVE' && p.release === 'd5')
p = planGenericStage(base({ previous: prev('d5', 'TRIAL', { trialBase: 'd3', decidedBy: 'human' }), evidence: ev('d5', 'PASS') }))
check('🔴 사람이 쓴 결정은 기반이 아니다 → HOLD PROVENANCE_PREVIOUS', p.state === 'HOLD' && p.blocks.some((b) => b.code === 'PROVENANCE_PREVIOUS'))
p = planGenericStage(base({ previous: { ...prev('d5', 'TRIAL', { trialBase: 'd3' }), kstDate: '2026-09-27' }, evidence: ev('d5', 'PASS', '2026-09-27') }))
check('🔴 이틀 전 결정은 기반이 아니다', p.state === 'HOLD' && p.target === null)
p = planGenericStage(base({ previous: null }))
check('첫날(전날 결정 없음) → HOLD d1 · 시험 없음', p.state === 'HOLD' && p.release === 'd1' && p.target === null)

// 🔴 날짜만으로는 오르지 않는다 — 증거 없는 날을 이어 붙여도 d10 을 넘지 않고 d5 에 머문다
{
  let cur: GenericPrevious = prev('d5', 'HOLD')
  const seen: string[] = []
  let date = D
  for (let k = 0; k < 10; k += 1) {
    const next = new Date(Date.parse(`${date}T00:00:00Z`) + 864e5).toISOString().slice(0, 10)
    const plan = planGenericStage(base({
      kstDate: next, runAt: new Date(`${next}T07:00:00+09:00`), previous: cur, evidence: null, ceiling: 'd100', runtimeWired: allWired,
    }))
    seen.push(`${plan.state}:${plan.release}`)
    cur = { kstDate: next, release: plan.release, state: plan.state, decidedBy: DECISION_WRITER, trialBase: plan.base === plan.release ? null : plan.base }
    date = next
  }
  check('🔴 🔴 **날짜만으로는 오르지 않는다** — 증거 없는 10일 뒤에도 d5', seen.every((x) => x === 'REPROVE:d5'), seen.join(' '))
}

// D10 → D20 — 천장·배선·preflight 관문
p = planGenericStage(base({ previous: prev('d10', 'TRIAL', { trialBase: 'd5' }), evidence: ev('d10', 'PASS'), ceiling: 'd10' }))
check('🔴 d10 PASS · 천장 d10 → d20 을 열지 않는다(CEILING) · d10 증명일', p.state === 'REPROVE' && p.release === 'd10'
  && p.blocks.some((b) => b.code === 'CEILING') && p.proofDay)
p = planGenericStage(base({ previous: prev('d10', 'TRIAL', { trialBase: 'd5' }), evidence: ev('d10', 'PASS'), ceiling: c20.authorized }))
check('🔴 d10 PASS · 천장 d20 · 지금 배선 → RUNTIME_UNWIRED (열지 않는다)', p.state === 'REPROVE' && p.release === 'd10'
  && p.blocks.some((b) => b.code === 'RUNTIME_UNWIRED'))
p = planGenericStage(base({ previous: prev('d10', 'TRIAL', { trialBase: 'd5' }), evidence: ev('d10', 'PASS'), ceiling: 'd20', runtimeWired: allWired }))
const first20 = genericProfileOf('d20', GRID)
const want20 = first20.ok ? firstSlotOn(TODAY, first20.profile)?.toISOString() : 'x'
check('🟢 d10 PASS · 천장 d20 · (배선 가정) · preflight 초록 → TRIAL d20 · 오늘 첫 슬롯에 연다',
  p.state === 'TRIAL' && p.release === 'd20' && p.base === 'd10' && p.basis === 'PASS' && p.opensAt === want20 && p.proofDay,
  JSON.stringify(p))
check('opensAt 은 07:00 controller 뒤 · 08:00 창 안', p.opensAt !== null && Date.parse(p.opensAt) > RUN_AT.getTime()
  && Date.parse(p.opensAt) >= Date.parse(`${TODAY}T08:00:00+09:00`))
p = planGenericStage(base({ previous: prev('d10', 'TRIAL', { trialBase: 'd5' }), evidence: ev('d10', 'PASS'), ceiling: 'd20', runtimeWired: allWired,
  runAt: new Date(`${TODAY}T12:00:00+09:00`) }))
check('🔴 첫 슬롯이 지난 뒤 → LATE_START · 조각 하루로 시험하지 않는다', p.state === 'REPROVE' && p.blocks.some((b) => b.code === 'LATE_START'))
p = planGenericStage(base({ previous: prev('d10', 'TRIAL', { trialBase: 'd5' }), evidence: ev('d10', 'PASS'), ceiling: 'd20', runtimeWired: allWired,
  preflight: (s) => judgeNextPreflight(s, factsFor(s, { readyAutoStock: 5 }), GRID) }))
check('🔴 preflight FAIL(재고) → REPROVE d10 · PREFLIGHT_FAIL', p.state === 'REPROVE' && p.release === 'd10' && p.blocks.some((b) => b.code === 'PREFLIGHT_FAIL'))
p = planGenericStage(base({ previous: prev('d10', 'TRIAL', { trialBase: 'd5' }), evidence: ev('d10', 'PASS'), ceiling: 'd20', runtimeWired: allWired,
  preflight: (s) => judgeNextPreflight(s, factsFor(s, { activePersonas: null }), GRID) }))
check('🔴 preflight UNKNOWN → REPROVE · PREFLIGHT_UNKNOWN', p.state === 'REPROVE' && p.blocks.some((b) => b.code === 'PREFLIGHT_UNKNOWN'))
p = planGenericStage(base({ previous: prev('d10', 'TRIAL', { trialBase: 'd5' }), evidence: ev('d10', 'PASS'), ceiling: 'd20', runtimeWired: allWired,
  preflight: () => green('d30') }))
check('🔴 다른 단계의 preflight 초록으로 열지 않는다', p.state === 'REPROVE' && p.blocks.some((b) => b.code === 'PREFLIGHT_UNKNOWN'))
p = planGenericStage(base({ previous: prev('d20', 'TRIAL', { trialBase: 'd10' }), evidence: ev('d20', 'FAIL'), ceiling: 'd20', runtimeWired: allWired }))
check('🔴 d20 FAIL → TRIAL d20 재시험 (기반 d10)', p.state === 'TRIAL' && p.release === 'd20' && p.basis === 'RETEST' && p.base === 'd10')
p = planGenericStage(base({ previous: prev('d20', 'TRIAL', { trialBase: 'd10' }), evidence: ev('d20', 'FAIL'), ceiling: 'd10', runtimeWired: allWired }))
check('🔴 천장이 d10 으로 내려가면 d20 재시험도 막는다 — 기반 d10 증명일', p.state === 'REPROVE' && p.release === 'd10'
  && p.blocks.some((b) => b.code === 'CEILING'))
p = planGenericStage(base({ previous: prev('d30', 'TRIAL', { trialBase: 'd20' }), evidence: ev('d30', 'FAIL'), ceiling: 'd10', runtimeWired: allWired }))
check('🔴 재시험 기반(d20)이 천장(d10) 위면 기반도 천장으로 — 천장 위 증명일 0', p.state === 'REPROVE' && p.release === 'd10',
  `${p.state}:${p.release}`)
p = planGenericStage(base({ previous: prev('d20', 'SUSTAIN'), evidence: null, ceiling: 'd10', runtimeWired: allWired }))
check('🔴 전날 공개가 천장 위였다면 천장으로 내린다(천장 위 공개 0)', p.release === 'd10')
p = planGenericStage(base({ previous: prev('d50', 'TRIAL', { trialBase: 'd30' }), evidence: ev('d50', 'PASS'), ceiling: 'd100', runtimeWired: allWired }))
check('🔴 d50 PASS · 천장 d100 → d100 preflight 가 막는다(현재 러너·댓글 예산)', p.state === 'REPROVE' && p.release === 'd50'
  && p.blocks.some((b) => b.code === 'PREFLIGHT_FAIL'))
p = planGenericStage(base({ previous: prev('d100', 'SUSTAIN'), evidence: ev('d100', 'PASS'), ceiling: 'd100', runtimeWired: allWired }))
check('d100 PASS → 더 올라갈 칸 없음(TOP) · d100 증명', p.state === 'REPROVE' && p.release === 'd100' && p.blocks.some((b) => b.code === 'TOP'))

// 🔴 정체(stall) — 운영 사다리 반례와 여기의 차이
{
  const row = (o: Partial<StageDecision>): ValidatedStageDecision => {
    const r = validateStoredDecision({
      row: {
        kstDate: D, capacity: 'd10', release: 'd5', state: 'HOLD', reasons: [], blocks: [], dayPinned: false, supply: null,
        decidedAt: `${D}T07:00:00+09:00`, contractVersion: STAGE_DECISION_VERSION, decidedBy: DECISION_WRITER, transition: null, ...o,
      }, expectKstDate: D,
    })
    if (!r.ok) throw new Error(r.reason)
    return r.decision
  }
  const holdD5 = row({})
  const holdFacts = facts(D, 'd5', 5, { decision: { kstDate: D, state: 'HOLD', release: 'd5', decidedBy: DECISION_WRITER } })
  const holdEv = judgeStageEvidence(D, 'd5', holdFacts as StageEvidenceFacts, SIDE_OK)
  check('🔴 [운영 반례] HOLD 날 증거는 물량·댓글·감사가 완벽해도 DECISION_NOT_TRANSITION FAIL',
    holdEv.verdict === 'FAIL' && holdEv.codes.join(',') === 'DECISION_NOT_TRANSITION', JSON.stringify(holdEv.codes))
  check('🔴 [운영 반례] 그 증거로 #620 trialPlanOf(HOLD d5) = null — 지속 승격 밖에서는 d5 에 영구 정체',
    trialPlanOf(holdD5, holdEv) === null)
  const reproveFacts = facts(D, 'd5', 5, { decision: { kstDate: D, state: 'REPROVE', release: 'd5', decidedBy: DECISION_WRITER } })
  const reproveEv = judgeEvidenceForTarget(D, 'd5', 5, reproveFacts, SIDE_OK)
  check('🔴 [blocker] 증거 본체는 REPROVE 결정을 전이로 보지 않는다 — 저장 계약에 REPROVE 가 없다',
    reproveEv.codes.includes('DECISION_NOT_TRANSITION'))
  p = planGenericStage(base({ previous: prev('d5', 'REPROVE'), evidence: ev('d5', 'PASS') }))
  check('🟢 generic — REPROVE d5 가 PASS 면 다음 날 TRIAL d10 (정체 없음)', p.state === 'TRIAL' && p.release === 'd10' && p.basis === 'PASS')
  p = planGenericStage(base({ previous: prev('d5', 'REPROVE'), evidence: ev('d5', 'FAIL') }))
  check('generic — REPROVE FAIL → 다시 REPROVE(올리지 않는다)', p.state === 'REPROVE' && p.release === 'd5')

  // 🔴 d1~d10 에서 #620 의 trialPlanOf 와 같은 대상·근거를 고른다
  const trialRow = (release: ReleaseStage, trialBase: ReleaseStage, basis?: 'PASS' | 'RETEST' | 'FLOOR'): ValidatedStageDecision => row({
    release, state: 'TRIAL', transition: { kind: 'TRIAL', trialBase, previousKstDate: '2026-09-28', target: release, ...(basis === undefined ? {} : { basis }) },
  })
  const cases: { name: string; v: ValidatedStageDecision; e: 'PASS' | 'FAIL' | 'UNKNOWN' | null }[] = [
    { name: 'TRIAL d3(기반 d1) PASS', v: trialRow('d3', 'd1'), e: 'PASS' },
    { name: 'TRIAL d3(기반 d1) FAIL', v: trialRow('d3', 'd1'), e: 'FAIL' },
    { name: 'TRIAL d5(기반 d3) UNKNOWN', v: trialRow('d5', 'd3', 'PASS'), e: 'UNKNOWN' },
    { name: 'TRIAL d10(기반 d5) PASS', v: trialRow('d10', 'd5', 'PASS'), e: 'PASS' },
    { name: 'HOLD d1 증거 없음', v: row({ release: 'd1' }), e: null },
    { name: 'SUSTAIN d5 PASS', v: row({ release: 'd5', state: 'SUSTAIN', transition: { kind: 'SUSTAIN', from: 'd3', to: 'd5' } }), e: 'PASS' },
  ]
  for (const c of cases) {
    const legacy = trialPlanOf(c.v, c.e === null ? null : { kstDate: D, stage: c.v.release, verdict: c.e, codes: [], counts: {} })
    const t = c.v.transition
    const g = planGenericStage(base({
      previous: { kstDate: D, release: c.v.release, state: c.v.state, decidedBy: c.v.decidedBy,
        trialBase: t !== null && t.kind === 'TRIAL' ? t.trialBase : null },
      evidence: c.e === null ? null : ev(c.v.release, c.e),
    }))
    const same = legacy === null
      ? g.state !== 'TRIAL'
      : g.state === 'TRIAL' && g.release === legacy.target && g.base === legacy.base && g.basis === legacy.basis
    check(`#620 과 같은 전이 — ${c.name} → ${legacy === null ? '시험 없음' : `${legacy.target}(${legacy.basis})`}`, same,
      `generic ${g.state}:${g.release}:${String(g.basis)}`)
  }
  const top = trialPlanOf(trialRow('d10', 'd5', 'PASS'), { kstDate: D, stage: 'd10', verdict: 'PASS', codes: [], counts: {} })
  check('🔴 [운영 한계] #620 사다리의 d10 PASS 뒤 계획은 null — D20 은 이 골격만 표현한다', top === null)
}

// ─────────────────────────────────────────────────────────
section('⑥ 증거 본체 — 사람 물량 0건 · d1~d10 동일')
function post(i: number, kst: string, o: Partial<EvidencePost> = {}): EvidencePost {
  const t0 = Date.parse(`${kst}T08:10:00+09:00`) + i * 20 * 60_000
  return {
    postId: `p-${i}`, queueId: `q-${i}`, publishedAtMs: t0, unattended: true, queueRows: 1, publishLogs: 1,
    authorPersonaId: `a-${i}`, decider: 'auto',
    personaComments: [{ personaId: `c-${i}`, createdAtMs: t0 + 15 * 60_000, topLevel: true }], ...o,
  }
}
function facts(kst: string, stage: string, n: number, o: { decision?: { kstDate: string; state: string; release: string; decidedBy: string } | null; posts?: EvidencePost[] } = {}) {
  const posts = o.posts ?? Array.from({ length: n }, (_, i) => post(i, kst))
  const auto = posts.filter((x) => x.decider === 'auto' && x.unattended)
  const rows = auto.slice(0, auditTarget(auto.length)).map((x) => ({
    postId: x.postId, queueId: x.queueId ?? '', judged: true, defectYes: false, retryable: false, overdue: false,
  }))
  return {
    kstDate: kst, stage,
    decision: o.decision === undefined ? { kstDate: kst, state: 'TRIAL', release: stage, decidedBy: DECISION_WRITER } : o.decision,
    posts, orphanPublishLogs: 0, unloggedPublishes: 0, commentCapPerPost: 1,
    audits: { rows, globalDefectYes: 0, globalOverdue: 0, globalRetryable: 0, globalMissingPosts: 0 },
  }
}
for (const s of RELEASE_STAGES) {
  const f = facts(D, s, PROFILES[s].dailyTarget) as StageEvidenceFacts
  const a = judgeStageEvidence(D, s, f, SIDE_OK)
  const b = judgeEvidenceForTarget(D, s, PROFILES[s].dailyTarget, f, SIDE_OK)
  check(`${s} — 두 입구가 같은 판정 (${a.verdict})`, JSON.stringify(a) === JSON.stringify(b) && a.verdict === 'PASS', JSON.stringify(a.codes))
  const short = { ...f, posts: f.posts.slice(0, Math.max(0, f.posts.length - 1)) }
  const a2 = judgeStageEvidence(D, s, short, SIDE_OK)
  const b2 = judgeEvidenceForTarget(D, s, PROFILES[s].dailyTarget, short, SIDE_OK)
  check(`${s} — 한 편 모자람도 같은 판정 (${a2.verdict})`, JSON.stringify(a2) === JSON.stringify(b2) && a2.verdict === 'FAIL')
}
{
  const ok20 = judgeEvidenceForTarget(D, 'd20', 20, facts(D, 'd20', 20), SIDE_OK)
  check('d20 — 자동 20편 · 첫 댓글 · 감사 표본 4 → PASS', ok20.verdict === 'PASS' && ok20.counts.auditExpected === 4, JSON.stringify(ok20))
  const human = Array.from({ length: 20 }, (_, i) => post(i, D, { decider: 'human' }))
  const h = judgeEvidenceForTarget(D, 'd20', 20, facts(D, 'd20', 20, { posts: human }), SIDE_OK)
  check('🔴 🔴 **사람 승인 20편은 자동 물량 0건 → FAIL PUBLISH_NOT_AUTO_READY**', h.verdict === 'FAIL'
    && h.codes.includes('PUBLISH_NOT_AUTO_READY') && h.counts.autoTargets === 0)
  const mixed = [...Array.from({ length: 19 }, (_, i) => post(i, D)), post(19, D, { decider: 'human' })]
  const m = judgeEvidenceForTarget(D, 'd20', 20, facts(D, 'd20', 20, { posts: mixed }), SIDE_OK)
  check('🔴 자동 19 + 사람 1 → FAIL (혼합 물량은 자동만 센다)', m.verdict === 'FAIL' && m.counts.autoTargets === 19)
  const manualRun = Array.from({ length: 20 }, (_, i) => post(i, D, { unattended: false }))
  const mr = judgeEvidenceForTarget(D, 'd20', 20, facts(D, 'd20', 20, { posts: manualRun }), SIDE_OK)
  check('🔴 자동 READY 여도 손으로 돌린 회차(무인 표식 없음)는 0건', mr.verdict === 'FAIL' && mr.counts.autoTargets === 0)
  const late = Array.from({ length: 20 }, (_, i) => post(i, D, i === 3
    ? { personaComments: [{ personaId: 'c', createdAtMs: Date.parse(`${D}T08:10:00+09:00`) + 3 * 20 * 60_000 + (AUTO_FIRST_COMMENT_WINDOW_MINUTES + 1) * 60_000, topLevel: true }] }
    : {}))
  const l = judgeEvidenceForTarget(D, 'd20', 20, facts(D, 'd20', 20, { posts: late }), SIDE_OK)
  check('🔴 한 편이라도 첫 댓글 61분 → FAIL COMMENT_LATE', l.verdict === 'FAIL' && l.codes.includes('COMMENT_LATE'))
  const u = judgeEvidenceForTarget(D, 'd20', 20, facts(D, 'd20', 20), null)
  check('비용·러너 모름 → UNKNOWN (PASS 아님)', u.verdict === 'UNKNOWN')
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 골격 검사다 — 운영 controller·러너·저장 계약에 배선하지 않았다. DB 0 · env 0 · 유료 호출 0.')
process.exit(fail === 0 ? 0 : 1)
