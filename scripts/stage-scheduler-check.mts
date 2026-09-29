#!/usr/bin/env tsx
/**
 * 🔴 **D1→D100 단계 스케줄러 검사 — 운영 상태 기계 하나로 본다** (2026-09-29 generic scheduler 배선)
 *
 *   DB 0 · 네트워크 0 · 유료 호출 0 · 운영 env 0. 파일 write 는 OS 임시 디렉터리의 가짜 env 하나(롤백 확인)뿐이다.
 *
 *   ① 단계 목록 · 목표 — 러너 단계 d1~d50 · d100 은 표현만 · 목표는 창업자 계획(`d100Plan`)과 같다
 *   ② 승인 천장 — d20·d30·d50 을 읽고 d100 은 러너 천장 d50 으로 묶는다 · 지금 운영값 d10 은 그대로
 *   ③ 슬롯 · 러너 — 08:00~22:00 · heartbeat 격자 · 60분 안 댓글 3회(43회 · 간격 ≤20분) · 하루 시뮬레이션
 *   ④ preflight — 재고 · Persona canary 하한(지속 목표로 막지 않는다) · 비용 상한(공급 $0.50 · 댓글 $0.20 · 감사 $0.30)
 *   ⑤ 상태 기계 — **운영 `decideStage` 를 여러 날 돌린다**(저장 계약 · 증거 판정 · consumer 까지 한 줄로)
 *   ⑥ 러너 연결 — consumer env → `resolveScale` · catch-up · 증명일 · 발행 천장
 *   ⑦ 롤백 — `stage:switch --off` → consumer legacy(아무것도 넣지 않는다)
 *   ⑧ 증거 본체 — d1~d10 두 입구 동일 · 사람 물량 0건 · REPROVE 증명일
 *
 * 🔴 러너 사실(격자 · 댓글 예약표 · 회차 상한)은 **정본 템플릿에서 읽는다**(`RUNNER_GRID`).
 *    단가 셋만 fixture 다: 댓글 $0.00222(= `persona-comment-loop-check` 가 운영 장부와 대조하는 실측 1건) ·
 *    감사 $0.005 · 공급 READY 1건당 $0.008(가정 — 장부 실측 전). 🔴 운영 단가는 controller 가 전날 장부에서 읽는다.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  GENERIC_STAGES, genericNextStage, genericDailyTarget, resolveCeiling, HIGHEST_RUNTIME_STAGE,
  validPublishMinutes, publishCapacityOf, deriveSlots, genericProfileOf, verifyGenericProfile, commentCoverageOf,
  judgeNextPreflight, needsExtendedGate, extendedTrialBlocks, firstSlotOn,
  type PreflightFacts, type GenericStage, type PreflightVerdict, type PreflightCode,
} from '../src/lib/stage-ladder-generic'
import {
  PROFILES, RELEASE_STAGES, RUNTIME_STAGES, RUNTIME_PROFILES, resolveStage, resolveRuntimeStage, minuteOfDay, profileOf,
  stageRank, isRuntimeStage, CAPACITY_ENV, RELEASE_ENV,
  type RuntimeStage, type StageVerdict,
} from '../src/lib/scale-profile'
import { PUBLISH_WINDOW_START_MINUTE, PUBLISH_WINDOW_END_MINUTE, judgeCatchUp, simulateDay } from '../src/lib/publish-slot-catchup'
import { allStageCronLines } from '../src/lib/scale-workflow-render'
import { AUTO_FIRST_COMMENT_WINDOW_MINUTES, COMMENT_LOOP_DAILY_USD_MAX } from '../src/lib/persona-comment-auto-lane'
import { d100Plan, PERSONA_CANARY_FLOOR, PERSONA_SUSTAINED_TARGET } from '../src/lib/d100-capacity'
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
import type { DatedCanary } from '../src/lib/stage-ladder'
import type { CanaryVerdict } from '../src/lib/release-canary'
import { CANARY_STAGE_ENV, CANARY_DATE_ENV } from '../src/lib/release-canary'
import { resolveScale, boundedReleaseStage } from '../src/lib/scale-runtime'
import { proofDayOf, PROOF_STAGE_ENV } from '../src/lib/stage-proof-day'
import { CONTROLLER_ENV, controllerEnabled } from '../src/lib/stage-decision-store'
import { RUNNER_GRID } from './lib/stage-preflight-facts.mjs'
import { settledUnitUsd, settledTotalUsd, cappedBy } from './lib/stage-preflight-facts.mjs'
import { COMMENT_RUNNER_SLOTS, COMMENT_RUNNER_MAX_GAP_MINUTES } from './lib/persona-comment-runner-template'
import { readEnvKeys } from './lib/ops-signals.mjs'

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
check('🔴 RELEASE_STAGES · PROFILES 는 d1~d10 그대로다(GitHub 예약 합집합 · D100 용량표 정본 불변)',
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
section('② 승인 천장 — fail-closed · 지금 운영값 불변')
const c10 = resolveCeiling('d10')
check('🔴 지금 운영값 d10 → 승인 d10 · 열 수 있는 천장 d10', c10.authorized === 'd10' && c10.operable === 'd10' && c10.fallbackReason === null)
for (const s of ['d20', 'd30', 'd50'] as const) {
  const r = resolveCeiling(s)
  check(`천장 ${s} → 승인 ${s} · 열 수 있는 ${s}`, r.authorized === s && r.operable === s)
}
const c100 = resolveCeiling('d100')
check('🔴 천장 d100 → 승인 d100 · 열 수 있는 천장은 러너 상한 d50 (d1 로 떨어지지 않는다)', c100.authorized === 'd100' && c100.operable === 'd50')
for (const raw of ['', 'd200', 'D20', ' d7 ', 'd100x', 'd40']) {
  const r = resolveCeiling(raw)
  check(`모르는 천장 "${raw}" → d1 (fail-closed)`, r.authorized === 'd1' && r.operable === 'd1' && r.fallbackReason !== null)
}
check('러너 env 해석 — d20 은 d20 · d100 은 러너 밖이라 d1', resolveRuntimeStage('d20').stage === 'd20' && resolveRuntimeStage('d100').stage === 'd1')
check('🔴 보고용 resolveStage(d1~d10)는 그대로다 — d20 을 모르는 값으로 본다(D100 용량표 불변)', resolveStage('d20').stage === 'd1')

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
section('④ preflight — 재고 · Persona canary 하한 · 비용 상한')
const factsFor = (s: GenericStage, o: Partial<PreflightFacts> = {}): PreflightFacts => ({
  readyAutoStock: genericDailyTarget(s), activePersonas: s === 'd1' ? 1 : PERSONA_CANARY_FLOOR[s],
  commentUsdPerRequest: COMMENT_USD, commentDailyUsdCap: COMMENT_LOOP_DAILY_USD_MAX,
  auditUsdPerCall: AUDIT_USD, auditDailyUsdCap: AUDIT_CAP,
  supplyUsdPerReady: SUPPLY_USD_PER_READY, supplyDailyUsdCap: SUPPLY_DAILY_USD_APPROVED, ...o,
})
check('비용 상한 정본 — 공급 $0.50 · 댓글 $0.20', SUPPLY_DAILY_USD_APPROVED === 0.5 && COMMENT_LOOP_DAILY_USD_MAX === 0.2)
for (const s of ['d20', 'd30', 'd50'] as const) {
  const v = judgeNextPreflight(s, factsFor(s), GRID)
  check(`${s} preflight PASS — 댓글 ${v.counts.firstComments}건 · 감사 ${v.counts.auditExpected}건 · READY ${v.counts.readyNeeded}건 비용 상한 안`,
    v.verdict === 'PASS', `${v.verdict} [${v.codes.join(',')}]`)
}
{
  const s20 = judgeNextPreflight('d20', factsFor('d20'), GRID)
  check('🔴 canary 하한(d20 40명)이면 연다 — 지속 목표(60명)로 막지 않는다',
    PERSONA_CANARY_FLOOR.d20 === 40 && PERSONA_SUSTAINED_TARGET.d20 === 60 && s20.verdict === 'PASS' && s20.counts.personaFloor === 40)
  check('Persona canary 하한 미달(39) → FAIL PERSONA_SHORT',
    judgeNextPreflight('d20', factsFor('d20', { activePersonas: 39 }), GRID).codes.includes('PERSONA_SHORT'))
}
const pf100 = judgeNextPreflight('d100', factsFor('d100'), GRID)
console.log(`   d100: ${pf100.verdict} [${pf100.codes.join(',')}] · 댓글 감당 ${pf100.counts.commentAffordable}건/day`)
check('🔴 [blocker 실측] d100 — 댓글 $0.20 로 첫 댓글 100건 불가 · 발행 용량 부족 · 공급 $0.50 로 READY 120건 불가',
  pf100.verdict === 'FAIL' && pf100.codes.includes('COMMENT_COST_SHORT') && pf100.codes.includes('PUBLISH_CAPACITY_SHORT')
  && pf100.codes.includes('SLOTS_INFEASIBLE') && pf100.codes.includes('SUPPLY_COST_SHORT'))
const pfCases: { name: string; s: GenericStage; o: Partial<PreflightFacts>; want: 'FAIL' | 'UNKNOWN'; code: PreflightCode }[] = [
  { name: '재고 19 < 20', s: 'd20', o: { readyAutoStock: 19 }, want: 'FAIL', code: 'STOCK_SHORT' },
  { name: '재고 모름', s: 'd20', o: { readyAutoStock: null }, want: 'UNKNOWN', code: 'STOCK_UNKNOWN' },
  { name: 'Persona 모름', s: 'd20', o: { activePersonas: null }, want: 'UNKNOWN', code: 'PERSONA_UNKNOWN' },
  { name: '댓글 단가 모름', s: 'd20', o: { commentUsdPerRequest: null }, want: 'UNKNOWN', code: 'COMMENT_COST_UNKNOWN' },
  { name: '댓글 단가 0 은 모름', s: 'd20', o: { commentUsdPerRequest: 0 }, want: 'UNKNOWN', code: 'COMMENT_COST_UNKNOWN' },
  { name: '댓글 상한 모름', s: 'd20', o: { commentDailyUsdCap: null }, want: 'UNKNOWN', code: 'COMMENT_COST_UNKNOWN' },
  { name: '댓글 단가 $0.011 × 20 > $0.20', s: 'd20', o: { commentUsdPerRequest: 0.011 }, want: 'FAIL', code: 'COMMENT_COST_SHORT' },
  { name: '감사 단가 $0.05 × 10 > $0.30', s: 'd50', o: { auditUsdPerCall: 0.05 }, want: 'FAIL', code: 'AUDIT_COST_SHORT' },
  { name: '감사 상한 모름', s: 'd20', o: { auditDailyUsdCap: null }, want: 'UNKNOWN', code: 'AUDIT_COST_UNKNOWN' },
  { name: '공급 READY 단가 $0.01 × 60 > $0.50', s: 'd50', o: { supplyUsdPerReady: 0.01 }, want: 'FAIL', code: 'SUPPLY_COST_SHORT' },
  { name: '공급 단가 모름', s: 'd20', o: { supplyUsdPerReady: null }, want: 'UNKNOWN', code: 'SUPPLY_COST_UNKNOWN' },
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
const ALL_READY: StageVerdict[] = RUNTIME_STAGES.map((stage) => ({ stage, ready: true, reasons: [] }))

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
      decider: human ? 'human' : 'auto',
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
    audits: { rows, globalDefectYes: 0, globalOverdue: 0, globalRetryable: 0, globalMissingPosts: 0 },
  }
}
const evidenceOfDay = (d: StageDecision, mode: DayMode): StageEvidenceVerdict =>
  judgeStageEvidence(d.kstDate, d.release, factsOfDay(d, mode),
    mode === 'costUnknown' ? { cost: [{ name: '댓글', health: 'unknown' }], errors: 'ok' } : SIDE_OK)

const canary = (stage: RuntimeStage, ok: boolean): CanaryVerdict => {
  const want = profileOf(stage).dailyTarget
  return { stage, want, published: 0, slotsLeft: want, need: want, can: ok ? want : 0, ok, reasons: ok ? [] : ['하루 시뮬레이션 미달'] }
}

type DayOpts = {
  ceiling?: string
  facts?: (s: GenericStage) => PreflightFacts
  runAt?: (kstDate: string) => string
  canaryOk?: boolean
  signals?: HealthSignal[]
}
type Day = { decision: StageDecision; valid: ValidatedStageDecision | null; result: ControllerResult; evidence: StageEvidenceVerdict | null; reason: string }

/** 🔴 07:00 controller 한 번 — controller 스크립트와 같은 순서: 전날 증거 → 계획 → 하루 판정 → D20+ preflight → 결정 → 저장 검증 */
function runDay(kstDate: string, prev: ValidatedStageDecision | null, prevMode: DayMode | null, o: DayOpts = {}): Day {
  const ceiling = resolveCeiling(o.ceiling ?? 'd50').operable
  const runAt = (o.runAt ?? at0700)(kstDate)
  const evidence = prev === null || prevMode === null ? null : evidenceOfDay(prev, prevMode)
  const plan = prev === null ? null : trialPlanOf(prev, evidence)
  const daily: DatedCanary | null = plan === null ? null
    : { kstDate, stage: plan.target, builtAt: runAt, trialBase: plan.base, verdict: canary(plan.target, o.canaryOk ?? true) }
  const nextPreflight: PreflightVerdict | null = plan !== null && needsExtendedGate(plan.target)
    ? judgeNextPreflight(plan.target, (o.facts ?? ((s) => factsFor(s)))(plan.target), GRID) : null
  const result = decideStage({
    kstDate, decidedAt: runAt, envRelease: 'd1', authorizedCeiling: ceiling, previousDecision: prev, previousEvidence: evidence,
    verdicts: ALL_READY, daily, nextPreflight, promotion: null, publishedToday: 0, signals: o.signals ?? OK_SIGNALS,
  })
  const v = validateForToday(result.decision)
  return { decision: result.decision, valid: v.ok ? v.decision : null, result, evidence, reason: v.ok ? '' : v.reason }
}

/** 🔴 시작 행 — controller 가 쓴 HOLD */
function startRow(release: RuntimeStage, capacity: RuntimeStage, state: 'HOLD' | 'REPROVE' = 'HOLD'): ValidatedStageDecision {
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

// S1 — 전부 PASS · 천장 d50 → 날마다 한 칸(가장 이른 canary)
{
  const w = walk(startRow('d1', 'd50'), ['perfect', 'perfect', 'perfect', 'perfect', 'perfect', 'perfect', 'perfect', 'perfect'])
  console.log(`   S1 천장 d50 · 전부 PASS: ${w.trace}`)
  check('🟢 S1 PASS 다음 날마다 한 칸 — d3 → d5 → d10 → d20 → d30 → d50 (날짜로 기다리지 않는다)',
    w.days.slice(0, 6).map(tr).join(' ') === 'TRIAL:d3 TRIAL:d5 TRIAL:d10 TRIAL:d20 TRIAL:d30 TRIAL:d50', w.trace)
  check('S1 근거 — FLOOR 다음은 전부 PASS · 기반은 전날 공개', basisOf(w.days[0]!) === 'FLOOR'
    && w.days.slice(1, 6).every((d) => basisOf(d) === 'PASS')
    && w.days.slice(1, 6).every((d, i) => baseOf(d) === w.days[i]!.decision.release))
  check('S1 모든 결정이 저장 계약을 통과한다', w.allValid, w.days.map((d) => d.reason).filter((x) => x !== '').join(' / '))
  check('🔴 S1 d50 PASS 뒤 — 러너 단계 끝(d100 은 러너 밖) · 시험 기반 d30 증명일 REPROVE',
    tr(w.days[6]!) === 'REPROVE:d30' && w.days.every((d) => stageRank(d.decision.release) <= stageRank('d50')))
  check('S1 d20 시험은 07:00 에 열려 08:00 첫 슬롯부터 20건 — 결정의 천장은 d50 그대로',
    w.days[3]!.decision.capacity === 'd50' && firstSlotOn(w.days[3]!.decision.kstDate, profileOf('d20'))!.toISOString()
      === new Date(`${w.days[3]!.decision.kstDate}T08:00:00+09:00`).toISOString())
}

// S2 — 지금 운영 천장 d10 → D20 은 열리지 않는다
{
  const w = walk(startRow('d1', 'd10'), Array.from({ length: 10 }, () => 'perfect' as const), { ceiling: 'd10' })
  console.log(`   S2 천장 d10 · 전부 PASS: ${w.trace}`)
  check('🔴 🔴 S2 d10 PASS · 천장 d10 → D20 을 열지 않는다(10일 동안 d10 위 0)', w.days.every((d) => stageRank(d.decision.release) <= stageRank('d10'))
    && !w.days.some((d) => d.decision.release === 'd20' || d.decision.capacity !== 'd10'), w.trace)
  check('S2 d10 PASS 다음 날 CEILING 이 남는다', blocked(w.days[3]!, 'CEILING'), JSON.stringify(w.days[3]!.decision.blocks))
  check('S2 천장에 막힌 다음 날은 기반 d5 증명일(REPROVE) → 다시 d10 시험', tr(w.days[3]!) === 'REPROVE:d5' && tr(w.days[4]!) === 'TRIAL:d10')
  check('S2 모든 결정이 저장 계약을 통과한다', w.allValid)
}

// S3 — FAIL · UNKNOWN · 모름 → 같은 단계 재시험
{
  const modes: DayMode[] = ['perfect', 'perfect', 'perfect', 'late', 'costUnknown', 'unread', 'perfect']
  const w = walk(startRow('d5', 'd50', 'REPROVE'), modes)
  console.log(`   S3 d20 에서 FAIL·UNKNOWN·못 읽음: ${w.trace}`)
  check('S3 앞 셋 — REPROVE d5 PASS → d10 → d20 → d30', w.days.slice(0, 3).map(tr).join(' ') === 'TRIAL:d10 TRIAL:d20 TRIAL:d30', w.trace)
  check('🔴 S3 d30 첫 댓글 61분(FAIL) → 다음 날 d30 재시험(기반 d20 · RETEST)', tr(w.days[3]!) === 'TRIAL:d30'
    && basisOf(w.days[3]!) === 'RETEST' && baseOf(w.days[3]!) === 'd20' && w.days[3]!.evidence?.verdict === 'FAIL')
  check('🔴 S3 비용 모름(UNKNOWN) → 또 d30 재시험', tr(w.days[4]!) === 'TRIAL:d30' && basisOf(w.days[4]!) === 'RETEST' && w.days[4]!.evidence?.verdict === 'UNKNOWN')
  check('🔴 S3 증거를 못 읽음 → 또 d30 재시험', tr(w.days[5]!) === 'TRIAL:d30' && basisOf(w.days[5]!) === 'RETEST')
  check('S3 PASS 가 난 다음 날에야 d50', tr(w.days[6]!) === 'TRIAL:d50' && basisOf(w.days[6]!) === 'PASS')
}

// S4 — 날짜만으로는 오르지 않는다
{
  const w = walk(startRow('d5', 'd50', 'REPROVE'), Array.from({ length: 10 }, () => 'unread' as const))
  check('🔴 🔴 S4 증거 없는 10일 — REPROVE d5 에 머문다(시험 0 · 올라가지 않는다)', w.days.every((d) => tr(d) === 'REPROVE:d5'), w.trace)
  const h = walk(startRow('d10', 'd10'), Array.from({ length: 5 }, () => 'perfect' as const), { ceiling: 'd10' })
  check('🔴 S4 천장에 닿은 HOLD d10 — 증명일도 시험도 없다(공정성 불변 · HOLD 날은 PASS 가 아니다)',
    h.days.every((d) => tr(d) === 'HOLD:d10'), h.trace)
}

// S5 — 사람 물량은 0건
for (const m of ['human', 'mixed', 'manualRun'] as const) {
  const w = walk(startRow('d10', 'd50', 'REPROVE'), ['perfect', m])
  check(`🔴 S5 ${m} — TRIAL d20 날 사람/수동 물량 → FAIL PUBLISH_NOT_AUTO_READY → d20 재시험`,
    tr(w.days[0]!) === 'TRIAL:d20' && tr(w.days[1]!) === 'TRIAL:d20' && basisOf(w.days[1]!) === 'RETEST'
    && w.days[1]!.evidence?.codes.includes('PUBLISH_NOT_AUTO_READY') === true, `${w.trace} ${JSON.stringify(w.days[1]!.evidence?.codes)}`)
}

// S6 — 정체 없음: 천장을 올린 다음 날 증명일 → 그 PASS 다음 날 D20
{
  const w = walk(startRow('d10', 'd10'), ['perfect', 'perfect', 'perfect'], (i) => ({ ceiling: i === 0 ? 'd10' : 'd20' }))
  console.log(`   S6 HOLD d10 · 둘째 날부터 천장 d20: ${w.trace}`)
  check('🟢 S6 천장 d10 동안 HOLD d10 → 천장 d20 첫날 REPROVE d10 → 그 PASS 다음 날 TRIAL d20',
    w.trace === 'HOLD:d10 REPROVE:d10 TRIAL:d20' && basisOf(w.days[2]!) === 'PASS' && baseOf(w.days[2]!) === 'd10', w.trace)
  check('🔴 S6 REPROVE 는 증거 본체가 증명일로 받는다(HOLD 는 아니다)',
    PROOF_STATES.includes('REPROVE') && !PROOF_STATES.includes('HOLD') && TRANSITION_STATES.includes('REPROVE'))
}

// S7 — D20 이상 관문 (preflight · 첫 슬롯 · 하루 시뮬레이션)
{
  const base = (o: DayOpts): Day => runDay(addDays(D0, 1), startRow('d10', 'd20', 'REPROVE'), 'perfect', { ceiling: 'd20', ...o })
  const green = base({})
  check('S7 기준선 — REPROVE d10 PASS · 천장 d20 · preflight 초록 → TRIAL d20', tr(green) === 'TRIAL:d20' && green.valid !== null)
  const cases: { name: string; o: DayOpts; code: string }[] = [
    { name: '재고 모자람', o: { facts: (s) => factsFor(s, { readyAutoStock: 5 }) }, code: 'PREFLIGHT_FAIL' },
    { name: 'Persona canary 하한 미달', o: { facts: (s) => factsFor(s, { activePersonas: 10 }) }, code: 'PREFLIGHT_FAIL' },
    { name: '댓글 비용 초과', o: { facts: (s) => factsFor(s, { commentUsdPerRequest: 0.05 }) }, code: 'PREFLIGHT_FAIL' },
    { name: '공급 비용 모름', o: { facts: (s) => factsFor(s, { supplyUsdPerReady: null }) }, code: 'PREFLIGHT_UNKNOWN' },
    { name: '08:30 에 늦게 돈 controller', o: { runAt: (d) => new Date(`${d}T08:30:00+09:00`).toISOString() }, code: 'LATE_START' },
  ]
  for (const c of cases) {
    const d = base(c.o)
    check(`🔴 S7 ${c.name} → d20 을 열지 않는다 · ${c.code} · 기반 d10 증명일`, tr(d) === 'REPROVE:d10' && blocked(d, c.code) && d.valid !== null,
      `${tr(d)} ${JSON.stringify(d.decision.blocks.map((b) => b.code))}`)
  }
  const sim = base({ canaryOk: false })
  check('🔴 S7 하루 시뮬레이션(READY 재고 1일) 미달 → d20 을 열지 않는다(#620 관문 그대로)', tr(sim) === 'REPROVE:d10', tr(sim))
  check('🔴 S7 preflight 없이(null) D20 시험 → PREFLIGHT_UNKNOWN', extendedTrialBlocks({
    target: 'd20', kstDate: D0, runAt: at0700(D0), preflight: null,
  }).some((b) => b.code === 'PREFLIGHT_UNKNOWN'))
  check('🔴 S7 다른 단계(d30) preflight 초록으로 d20 을 열지 않는다', extendedTrialBlocks({
    target: 'd20', kstDate: D0, runAt: at0700(D0), preflight: judgeNextPreflight('d30', factsFor('d30'), GRID),
  }).some((b) => b.code === 'PREFLIGHT_UNKNOWN'))
  // 🔴 d3~d10 시험은 이 관문을 지나지 않는다 — #620 그대로
  const d5 = runDay(addDays(D0, 1), startRow('d3', 'd10', 'REPROVE'), 'perfect', { ceiling: 'd10', facts: (s) => factsFor(s, {
    readyAutoStock: null, activePersonas: null, commentUsdPerRequest: null, auditUsdPerCall: null, supplyUsdPerReady: null,
  }), runAt: (d) => new Date(`${d}T09:00:00+09:00`).toISOString() })
  check('🔴 S7 d3~d10 시험은 D20 관문을 보지 않는다(사실 전부 모름 · 09:00 실행이어도 TRIAL d5)', tr(d5) === 'TRIAL:d5'
    && !needsExtendedGate('d10') && needsExtendedGate('d20'), tr(d5))
}

// S8 — 운영 신호 브레이크는 증명일을 되돌린다
{
  const bad = runDay(addDays(D0, 1), startRow('d5', 'd20', 'REPROVE'), 'unread', {
    ceiling: 'd20', signals: [{ axis: 'quality', health: 'bad', reasons: ['확정 결함 1건'] }, ...OK_SIGNALS.slice(1)],
  })
  check('🔴 S8 품질 나쁨 → 감속 · 증명일 아님(HOLD/PREPARE)', bad.result.brake === 'slowdown' && !PROOF_STATES.includes(bad.decision.state), tr(bad))
  const unk = runDay(addDays(D0, 1), startRow('d5', 'd20', 'REPROVE'), 'unread', {
    ceiling: 'd20', signals: [OK_SIGNALS[0]!, { axis: 'cost', health: 'unknown', reasons: [] }, OK_SIGNALS[2]!],
  })
  check('🔴 S8 비용 모름 → REPROVE 를 되돌린다(자동 target 을 앞세우지 않는다)', unk.result.brake === 'holdUnknown'
    && unk.decision.release === 'd5' && !PROOF_STATES.includes(unk.decision.state), tr(unk))
}

// S9 — 승인 천장 d100 · 러너는 d50 까지
{
  const w = walk(startRow('d10', 'd50', 'REPROVE'), Array.from({ length: 8 }, () => 'perfect' as const), { ceiling: 'd100' })
  check('🔴 S9 승인 d100 이어도 d50 위는 열리지 않는다 · 결정 천장은 d50', w.days.every((d) => stageRank(d.decision.release) <= stageRank('d50')
    && d.decision.capacity === 'd50') && w.allValid, w.trace)
}

// S10 — 중복 · 감사 표본
for (const [m, code] of [['dup', 'DUP_COMMENT'], ['auditShort', 'AUDIT_COVERAGE_SHORT'], ['auditOutside', 'AUDIT_OUTSIDE_TARGET']] as const) {
  const w = walk(startRow('d10', 'd50', 'REPROVE'), ['perfect', m])
  check(`🔴 S10 ${m} → FAIL ${code} → d20 재시험`, tr(w.days[1]!) === 'TRIAL:d20' && basisOf(w.days[1]!) === 'RETEST'
    && w.days[1]!.evidence?.codes.includes(code) === true, `${w.trace} ${JSON.stringify(w.days[1]!.evidence?.codes)}`)
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
  const w = walk(startRow('d10', 'd20', 'REPROVE'), ['perfect'], { ceiling: 'd20' })
  const t = w.days[0]!
  const env = t.valid === null ? {} : consumerEnvOf({ ok: true, decision: t.valid })
  check('consumer — TRIAL d20 → 공개 d10(시험 기반) · canary d20 그날 · 천장 d20 · 증명일 d20',
    env.SORAN_RELEASE_STAGE === 'd10' && env[CANARY_STAGE_ENV] === 'd20' && env[CANARY_DATE_ENV] === t.decision.kstDate
    && env.SORAN_CAPACITY_STAGE === 'd20' && env[PROOF_STAGE_ENV] === 'd20', JSON.stringify(env))
  const now = new Date(`${t.decision.kstDate}T08:00:00+09:00`)
  const sc = resolveScale(env, { canary: { now, verdict: canary('d20', true) }, readiness: ALL_READY.filter((v) => stageRank(v.stage) <= stageRank('d10')) })
  check('🟢 러너 — canary 허가 + 그날 판정 ok → 공개 d20 · 하루 20건', sc.releaseStage === 'd20' && sc.releaseProfile.dailyTarget === 20 && sc.canaryStage, JSON.stringify(sc.notes))
  const cu = judgeCatchUp({ stage: sc.releaseStage, now, trigger: 'local', cron: null, publishedToday: 0 })
  check('러너 — 08:00 heartbeat 가 d20 첫 슬롯을 낸다(1건)', cu.run && cu.allowed === 1)
  const late = judgeCatchUp({ stage: 'd20', now: new Date(`${t.decision.kstDate}T22:10:00+09:00`), trigger: 'local', cron: null, publishedToday: 19 })
  check('🔴 러너 — 22:00 넘은 backlog 는 버린다', !late.run)
  const proof = proofDayOf(env, now)
  check('러너 — 증명일 d20 · 목표 20', proof !== null && proof.stage === 'd20' && proof.target === 20)
  check('🔴 발행 트랜잭션 천장 — 같은 env 로 d20 · 천장 d10 env 면 d20 요청도 d10 으로 누른다',
    boundedReleaseStage('d20', env, now) === 'd20'
    && boundedReleaseStage('d20', { [CAPACITY_ENV]: 'd10', [RELEASE_ENV]: 'd10', [CANARY_STAGE_ENV]: 'd20', [CANARY_DATE_ENV]: t.decision.kstDate }, now) === 'd10')
  const noVerdict = resolveScale(env, { canary: { now, verdict: null } })
  check('🔴 러너 — 그날 판정이 없으면 canary 를 켜지 않는다(d10)', noVerdict.releaseStage === 'd10')
  const r = walk(startRow('d5', 'd20', 'REPROVE'), ['unread'], { ceiling: 'd20' }).days[0]!
  const renv = r.valid === null ? {} : consumerEnvOf({ ok: true, decision: r.valid })
  check('consumer — REPROVE d5 → 공개 d5 · canary 없음 · 증명일 d5', tr(r) === 'REPROVE:d5' && renv.SORAN_RELEASE_STAGE === 'd5'
    && renv[CANARY_STAGE_ENV] === '' && renv[PROOF_STAGE_ENV] === 'd5', JSON.stringify(renv))
  const h = walk(startRow('d10', 'd10'), ['perfect'], { ceiling: 'd10' }).days[0]!
  const henv = h.valid === null ? {} : consumerEnvOf({ ok: true, decision: h.valid })
  check('consumer — HOLD d10 → 증명일 아님(빈 값) · 공정성 그대로', tr(h) === 'HOLD:d10' && henv[PROOF_STAGE_ENV] === '')
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
    check('🔴 off 면 consumer 는 아무것도 넣지 않는다(legacy)',
      Object.keys(consumerEnvOf({ ok: false, code: 'NO_DECISION', fallback: 'legacy', reason: '' })).length === 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

// ─────────────────────────────────────────────────────────
section('⑧ 증거 본체 — d1~d10 두 입구 동일 · REPROVE 증명일')
{
  const row = (release: RuntimeStage, state: StageDecision['state']): StageDecision => ({
    kstDate: D0, capacity: 'd50', release, state, reasons: [], blocks: [], dayPinned: false, supply: null,
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
