#!/usr/bin/env tsx
/**
 * 🔴 **단계 승격 운영 증거 검사 — 순수 fixture. DB 0 · 네트워크 0 · 파일 write 0** (2026-09-29 P0)
 *
 *   ① 증거 판정 — PASS 기준선과 조건마다의 반례(댓글 없음 · 60분 초과 · 감사 · 결함 · 중복 · 비용 · 수동 · 편수)
 *   ② 시험 계획 — PASS → 한 칸 위 · FAIL → 같은 단계 재시험 · 모름 → 머문다 · 날짜만으로는 오르지 않는다
 *   ③ controller 끝까지 — 09-29 반례: D3 FAIL 이면 09-30 은 TRIAL d3(재시험)이지 d5 가 아니다
 *   ④ 저장 validator — 재시험 모양은 받고, 근거 없는 d3→d5 는 거절한다 · 옛 d1 기반 행은 그대로 읽힌다
 *
 * 🔴 fixture 는 정본 판정기(`judgeStageEvidence` · `judgeOneDayCanary` · `judgeCost` · `validateStoredDecision`)만
 *    지난다 — 손으로 PASS 를 지어내지 않는다. DB 왕복은 `stage:evidence-db-check`(격리 DB)가 본다.
 */
import { readFileSync } from 'node:fs'

import {
  judgeStageEvidence, trialPlanOf, evidenceReasonOf, STAGE_EVIDENCE_CODES, personaCommentCapFor,
  type StageEvidenceFacts, type EvidencePost, type EvidenceSideSignals, type StageEvidenceVerdict,
} from '../src/lib/stage-evidence'
import { AUTO_FIRST_COMMENT_WINDOW_MS, AUTO_PERSONA_COMMENTS_PER_POST_MAX } from '../src/lib/persona-comment-auto-lane'
import { PERSONA_COMMENTS_PER_POST_MAX } from '../src/lib/persona-target-rules'
import { decideStage, consumerEnvOf, validateForToday, type HealthSignal, type ControllerInputs } from '../src/lib/stage-controller'
import {
  validateStoredDecision, STAGE_DECISION_VERSION, DECISION_WRITER, previousKstDate,
  type ValidatedStageDecision,
} from '../src/lib/stage-decision-contract'
import type { DatedCanary } from '../src/lib/stage-ladder'
import { PROFILES, type ReleaseStage } from '../src/lib/scale-profile'
import { simulateStage, stageVerdicts } from '../src/lib/scale-readiness'
import { judgeOneDayCanary, CANARY_STAGE_ENV } from '../src/lib/release-canary'
import { judgeCost } from '../src/lib/ops-status'
import { tallyOf, type DayTally } from '../src/lib/llm-ledger'
import { parsePoolDoc, cardToPersona } from '../src/lib/persona-pool-card'
import { PERSONA_POOL_DOC } from './lib/voice-runtime.mjs'
import type { QueueCandidate } from '../src/lib/supply-candidates'

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

// ── 날짜 — 운영 반례 그대로 ──
const D = '2026-09-29'
const TODAY = '2026-09-30'
const NOW = new Date('2026-09-30T07:00:00+09:00')
const AT = NOW.toISOString()
const T0 = Date.parse(`${D}T09:30:00+09:00`)
const HOUR = 3600_000
const MIN = 60_000

// ── ① 사실 fixture ──
/** 🔴 기준선 — 자동 READY 글 · 첫 글만 감사 행이 있다(정본 표본 ceil(3×0.2)=1) */
const post = (i: number, o: Partial<EvidencePost> = {}): EvidencePost => ({
  publishedAtMs: T0 + i * 4 * HOUR, unattended: true, queueRows: 1, publishLogs: 1, authorPersonaId: `author-${i}`,
  decider: 'auto', audited: i === 0,
  personaComments: [{ personaId: `commenter-${i}`, createdAtMs: T0 + i * 4 * HOUR + 12 * MIN, topLevel: true }],
  ...o,
})
const JUDGED = { judged: true, defectYes: false, retryable: false, overdue: false }
const CLEAN_AUDITS = {
  rows: [JUDGED], globalDefectYes: 0, globalOverdue: 0, globalRetryable: 0, globalMissingPosts: 0,
}
const facts = (stage: ReleaseStage = 'd3', o: Partial<StageEvidenceFacts> = {}): StageEvidenceFacts => ({
  kstDate: D, stage,
  decision: { kstDate: D, state: 'TRIAL', release: stage, decidedBy: DECISION_WRITER },
  posts: Array.from({ length: PROFILES[stage].dailyTarget }, (_, i) => post(i)),
  orphanPublishLogs: 0, unloggedPublishes: 0, commentCapPerPost: personaCommentCapFor('bootstrap-auto'), audits: CLEAN_AUDITS, ...o,
})
/** 🔴 비용은 정본 `judgeCost` 로 만든다 — health 를 손으로 적지 않는다 */
const tally = (usd: number, overruns = 0): DayTally => ({ ...tallyOf([]), settledUsd: usd, overruns })
const costOk = judgeCost({ uses: true, tally: tally(0.01), ledgerError: null, settleHold: null, capUsd: 1 })
const side = (o: Partial<EvidenceSideSignals> = {}): EvidenceSideSignals => ({
  cost: [
    { name: '공급 장부', health: costOk.health }, { name: '댓글 장부', health: costOk.health },
    { name: '감사 장부', health: costOk.health },
  ],
  errors: 'ok', ...o,
})
const judge = (f: StageEvidenceFacts | null, s: EvidenceSideSignals | null = side(), stage: ReleaseStage = 'd3') =>
  judgeStageEvidence(D, stage, f, s)
const has = (v: StageEvidenceVerdict, code: string): boolean => (v.codes as readonly string[]).includes(code)
const failWith = (name: string, v: StageEvidenceVerdict, code: string): void =>
  check(name, v.verdict === 'FAIL' && has(v, code), `${v.verdict} ${v.codes.join(',')}`)

console.log('\n══ 단계 승격 운영 증거 (DB 0 · 네트워크 0) ══')
console.log('\n① 증거 판정 — 기준선과 조건별 반례')
{
  const base = judge(facts())
  check('🟢 기준선 — 여섯 조건을 다 채운 D3 는 PASS', base.verdict === 'PASS' && base.codes.length === 0, base.codes.join(','))
  check('🟢 기준선 — D5 도 dailyTarget(5) 을 채우면 PASS', judge(facts('d5'), side(), 'd5').verdict === 'PASS')
  check('비용 fixture 는 정본 judgeCost 의 ok 다', costOk.health === 'ok')

  // ① 결정
  failWith('🔴 결정 없음 → FAIL', judge(facts('d3', { decision: null })), 'DECISION_MISSING')
  failWith('🔴 사람이 쓴 결정(decidedBy≠controller) → FAIL', judge(facts('d3', {
    decision: { kstDate: D, state: 'TRIAL', release: 'd3', decidedBy: 'human' } })), 'DECISION_NOT_CONTROLLER')
  failWith('🔴 HOLD 날(override · env canary 로 낸 날)은 세지 않는다', judge(facts('d3', {
    decision: { kstDate: D, state: 'HOLD', release: 'd3', decidedBy: DECISION_WRITER } })), 'DECISION_NOT_TRANSITION')
  failWith('🔴 결정 공개 단계 ≠ 판정 단계 → FAIL', judge(facts('d3', {
    decision: { kstDate: D, state: 'TRIAL', release: 'd1', decidedBy: DECISION_WRITER } })), 'DECISION_STAGE_MISMATCH')

  // ② 발행
  failWith('🔴 dailyTarget 보다 적게 냈다(2/3) → FAIL', judge(facts('d3', { posts: [post(0), post(1)] })), 'PUBLISH_SHORT')
  failWith('🔴 dailyTarget 보다 많이 냈다(4/3) → FAIL', judge(facts('d3', { posts: [post(0), post(1), post(2), post(3)] })), 'PUBLISH_OVER')
  const manual = judge(facts('d3', { posts: [post(0), post(1, { unattended: false }), post(2)] }))
  failWith('🔴 무인 표식 없는 발행(수동 · 표식 이전)이 섞였다 → FAIL', manual, 'PUBLISH_NOT_UNATTENDED')
  check('🔴 그 발행은 편수에 세지 않는다 → PUBLISH_SHORT 도 함께', has(manual, 'PUBLISH_SHORT'))

  // ③ 첫 댓글
  failWith('🔴 09:30 글 Persona 댓글 없음 → FAIL (09-29 반례)', judge(facts('d3', {
    posts: [post(0, { personaComments: [] }), post(1), post(2)] })), 'COMMENT_MISSING')
  const late = judge(facts('d3', { posts: [post(0, {
    personaComments: [{ personaId: 'c0', createdAtMs: T0 + AUTO_FIRST_COMMENT_WINDOW_MS + MIN, topLevel: true }] }), post(1), post(2)] }))
  failWith('🔴 60분 넘어 붙은 댓글(61분) → FAIL (LATE)', late, 'COMMENT_LATE')
  check('경계 — 정확히 60분은 시한 안이다', judge(facts('d3', { posts: [post(0, {
    personaComments: [{ personaId: 'c0', createdAtMs: T0 + AUTO_FIRST_COMMENT_WINDOW_MS, topLevel: true }] }), post(1), post(2)] })).verdict === 'PASS')
  // (b) 추가 댓글 계약 — 상한은 댓글 단계의 정본 상수다
  check('상한 — bootstrap-auto 1 · review/organic 5 · shadow 0 (정본 상수 그대로)',
    personaCommentCapFor('bootstrap-auto') === AUTO_PERSONA_COMMENTS_PER_POST_MAX && AUTO_PERSONA_COMMENTS_PER_POST_MAX === 1
    && personaCommentCapFor('organic') === PERSONA_COMMENTS_PER_POST_MAX && PERSONA_COMMENTS_PER_POST_MAX === 5
    && personaCommentCapFor('bootstrap-review') === 5 && personaCommentCapFor('shadow') === 0)
  const withComments = (n: number, o: { same?: boolean; self?: boolean } = {}): EvidencePost => post(0, {
    personaComments: Array.from({ length: n }, (_, k) => ({
      personaId: o.self === true && k === n - 1 ? 'author-0' : o.same === true ? 'c-same' : `c${k}`,
      createdAtMs: T0 + (5 + k) * MIN, topLevel: true,
    })),
  })
  const capFacts = (p0: EvidencePost, cap: number | null) => facts('d3', { posts: [p0, post(1), post(2)], commentCapPerPost: cap })
  failWith('🔴 bootstrap-auto(상한 1) — 60분 안 두 Persona → 상한 초과 FAIL', judge(capFacts(withComments(2), 1)), 'COMMENT_OVER_CAP')
  check('🔴 그때 첫 댓글 보장 자체는 충족으로 센다 — 실패 이유는 상한뿐', (() => {
    const v = judge(capFacts(withComments(2), 1))
    return v.codes.length === 1 && v.counts.firstCommentOk === 3
  })())
  for (const n of [2, 3, 4, 5]) {
    const v = judge(capFacts(withComments(n), 5))
    check(`🟢 장기 1~5(상한 5) — 60분 안 서로 다른 Persona ${n}건 → PASS`, v.verdict === 'PASS', `${v.verdict} ${v.codes.join(',')}`)
  }
  failWith('🔴 상한 5 — 6건 → 상한 초과 FAIL', judge(capFacts(withComments(6), 5)), 'COMMENT_OVER_CAP')
  failWith('🔴 상한 5 — 같은 Persona 2건 → FAIL', judge(capFacts(withComments(2, { same: true }), 5)), 'DUP_COMMENT')
  failWith('🔴 상한 5 — 자기 글 댓글 → FAIL', judge(capFacts(withComments(3, { self: true }), 5)), 'COMMENT_SELF')
  const capUnknown = judge(capFacts(withComments(1), null))
  check('⬚ 댓글 단계(상한)를 모른다 → UNKNOWN', capUnknown.verdict === 'UNKNOWN' && has(capUnknown, 'COMMENT_CAP_UNKNOWN'), capUnknown.codes.join(','))
  failWith('🔴 글쓴 Persona 가 자기 글에 단 댓글은 세지 않고 FAIL', judge(facts('d3', { posts: [post(0, {
    personaComments: [{ personaId: 'author-0', createdAtMs: T0 + 5 * MIN, topLevel: true }] }), post(1), post(2)] })), 'COMMENT_SELF')
  failWith('🔴 대댓글만 있다 → 최상위 첫 댓글이 없다', judge(facts('d3', { posts: [post(0, {
    personaComments: [{ personaId: 'c0', createdAtMs: T0 + 5 * MIN, topLevel: false }] }), post(1), post(2)] })), 'COMMENT_MISSING')
  failWith('🔴 발행 전 시각의 댓글은 시한 안이 아니다', judge(facts('d3', { posts: [post(0, {
    personaComments: [{ personaId: 'c0', createdAtMs: T0 - MIN, topLevel: true }] }), post(1), post(2)] })), 'COMMENT_LATE')

  // ④ 감사
  // ④ 감사 — 대상 가르기 · 표본 수 · 행마다
  const allAuto = (audited: boolean[]) => [0, 1, 2].map((i) => post(i, { audited: audited[i] ?? false }))
  const zero = judge(facts('d3', { posts: allAuto([false, false, false]), audits: { ...CLEAN_AUDITS, rows: [] } }))
  failWith('🔴 🔴 **자동 READY 글 3건 · 감사 행 0 → COVERAGE_ZERO FAIL (selected 0 을 PASS 로 삼키지 않는다)**', zero, 'AUDIT_COVERAGE_ZERO')
  check('그때 counts — 대상 3 · 기대 1 · 덮음 0', zero.counts.auditTargets === 3 && zero.counts.auditExpected === 1 && zero.counts.auditCovered === 0, JSON.stringify(zero.counts))
  failWith('🔴 감사 행은 있는데 그날 대상 글이 아니다(다른 글) → COVERAGE_ZERO', judge(facts('d3', { posts: allAuto([false, false, false]) })), 'AUDIT_COVERAGE_ZERO')
  const d10Posts = Array.from({ length: 10 }, (_, i) => post(i, { audited: i === 0, publishedAtMs: T0 + i * HOUR,
    personaComments: [{ personaId: `c${i}`, createdAtMs: T0 + i * HOUR + 5 * MIN, topLevel: true }] }))
  const short = judgeStageEvidence(D, 'd10', { ...facts('d10'), posts: d10Posts }, side())
  check('⬚ D10 자동 10건 · 기대 ceil(10×0.2)=2 · 덮음 1 → COVERAGE_SHORT (PASS 아님)',
    short.verdict === 'UNKNOWN' && has(short, 'AUDIT_COVERAGE_SHORT') && short.counts.auditExpected === 2, `${short.verdict} ${short.codes.join(',')}`)
  const human = judge(facts('d3', { posts: [0, 1, 2].map((i) => post(i, { decider: 'human', audited: false })), audits: { ...CLEAN_AUDITS, rows: [] } }))
  check('🟢 자동 READY 0 · 전부 사람이 발행 전 검토 → 감사 대상 없음(이유 있는 0) · PASS',
    human.verdict === 'PASS' && human.counts.auditTargets === 0 && human.counts.humanReviewed === 3, `${human.verdict} ${human.codes.join(',')}`)
  failWith('🔴 결정자를 모르는 글(빈 값 · 확인 안 된 machine:*) → AUDIT_TARGET_UNKNOWN',
    judge(facts('d3', { posts: [post(0), post(1, { decider: 'unknown' }), post(2)] })), 'AUDIT_TARGET_UNKNOWN')
  failWith('🔴 행 — 판정 전 → FAIL', judge(facts('d3', { audits: { ...CLEAN_AUDITS, rows: [{ ...JUDGED, judged: false }] } })), 'AUDIT_UNJUDGED')
  failWith('🔴 행 — 시한 초과 → FAIL', judge(facts('d3', { audits: { ...CLEAN_AUDITS, rows: [{ ...JUDGED, judged: false, overdue: true }] } })), 'AUDIT_OVERDUE')
  failWith('🔴 행 — 재시도 가능 실패 → FAIL', judge(facts('d3', { audits: { ...CLEAN_AUDITS, rows: [{ ...JUDGED, judged: false, retryable: true }] } })), 'AUDIT_RETRYABLE')
  failWith('🔴 표 전체 판정 시한 초과 감사 → FAIL', judge(facts('d3', { audits: { ...CLEAN_AUDITS, globalOverdue: 1 } })), 'AUDIT_OVERDUE')
  failWith('🔴 행 — 결함 yes → FAIL', judge(facts('d3', { audits: { ...CLEAN_AUDITS, rows: [{ ...JUDGED, defectYes: true }] } })), 'AUDIT_DEFECT')
  failWith('🔴 표 전체에 결함 yes(끈적) → FAIL', judge(facts('d3', { audits: { ...CLEAN_AUDITS, globalDefectYes: 1 } })), 'AUDIT_DEFECT')
  failWith('🔴 재시도 가능 감사 실패 → FAIL', judge(facts('d3', { audits: { ...CLEAN_AUDITS, globalRetryable: 1 } })), 'AUDIT_RETRYABLE')
  failWith('🔴 글이 사라진 자동 발행 → FAIL', judge(facts('d3', { audits: { ...CLEAN_AUDITS, globalMissingPosts: 1 } })), 'AUDIT_MISSING_POST')

  // ⑤ 중복
  failWith('🔴 한 글을 가리키는 Queue 행이 1 이 아니다 → FAIL', judge(facts('d3', { posts: [post(0, { queueRows: 0 }), post(1), post(2)] })), 'DUP_QUEUE')
  failWith('🔴 한 글의 발행 기록이 둘 → FAIL', judge(facts('d3', { posts: [post(0, { publishLogs: 2 }), post(1), post(2)] })), 'DUP_PUBLISH_LOG')
  failWith('🔴 발행 기록 없는 Queue 발행 → FAIL', judge(facts('d3', { unloggedPublishes: 1 })), 'UNLOGGED_PUBLISH')
  failWith('🔴 글·Queue 없는 발행 기록 → FAIL', judge(facts('d3', { orphanPublishLogs: 1 })), 'PUBLISH_LOG_ORPHAN')
  failWith('🔴 같은 Persona 가 한 글에 두 번 → FAIL', judge(facts('d3', { posts: [post(0, {
    personaComments: [
      { personaId: 'c0', createdAtMs: T0 + 5 * MIN, topLevel: true },
      { personaId: 'c0', createdAtMs: T0 + 3 * HOUR, topLevel: true }] }), post(1), post(2)] })), 'DUP_COMMENT')

  // ⑥ 비용 · 러너
  const over = judgeCost({ uses: true, tally: tally(0.05, 1), ledgerError: null, settleHold: null, capUsd: 1 })
  const ledgerErr = judgeCost({ uses: true, tally: null, ledgerError: '장부 3번째 줄이 JSON 이 아니다', settleHold: null, capUsd: 1 })
  const exhausted = judgeCost({ uses: true, tally: tally(1.2), ledgerError: null, settleHold: null, capUsd: 1 })
  const noCap = judgeCost({ uses: true, tally: tally(0.01), ledgerError: null, settleHold: null, capUsd: null })
  failWith('🔴 장부 초과(UNSETTLED_OVERRUN) → FAIL', judge(facts(), side({ cost: [{ name: '댓글 장부', health: over.health }] })), 'COST_BAD')
  failWith('🔴 장부 읽기 오류(LEDGER_ERROR) → FAIL', judge(facts(), side({ cost: [{ name: '감사 장부', health: ledgerErr.health }] })), 'COST_BAD')
  failWith('🔴 하루 상한 소진 → FAIL', judge(facts(), side({ cost: [{ name: '공급 장부', health: exhausted.health }] })), 'COST_BAD')
  const unk = judge(facts(), side({ cost: [{ name: '공급 장부', health: noCap.health }] }))
  check('⬚ 상한 없음(NO_BUDGET) → UNKNOWN (PASS 아님)', unk.verdict === 'UNKNOWN' && has(unk, 'COST_UNKNOWN'), unk.verdict)
  failWith('🔴 러너 최근 회차 실패 → FAIL', judge(facts(), side({ errors: 'bad' })), 'RUNNER_BAD')
  check('⬚ 러너 모름 → UNKNOWN', judge(facts(), side({ errors: 'unknown' })).verdict === 'UNKNOWN')
  check('⬚ 비용 칸이 비었다 → UNKNOWN', judge(facts(), side({ cost: [] })).verdict === 'UNKNOWN')

  // 못 읽음
  const unread = judge(null)
  check('⬚ DB 를 못 읽었다 → UNKNOWN (READ_ERROR)', unread.verdict === 'UNKNOWN' && has(unread, 'READ_ERROR'))
  check('⬚ 장부·러너를 못 읽었다 → UNKNOWN', judge(facts(), null).verdict === 'UNKNOWN')
  check('🔴 FAIL 이 모름을 이긴다 (둘 다 있으면 FAIL)', judge(facts('d3', { posts: [] }), null).verdict === 'FAIL')
  check('🔴 다른 날의 사실로 판정하지 않는다', judge({ ...facts(), kstDate: '2026-09-28' }).verdict !== 'PASS')
  check('🔴 다른 단계의 사실로 판정하지 않는다', judgeStageEvidence(D, 'd5', facts('d3'), side()).verdict !== 'PASS')

  const r = evidenceReasonOf(manual)
  check('reasons 에는 코드와 개수만 — id·원문 없음', r.startsWith(`EVIDENCE ${D} d3 FAIL [`) && !/author-|commenter-/.test(r), r)
  check('코드는 정본 목록 안에서만 나온다', manual.codes.every((c) => (STAGE_EVIDENCE_CODES as readonly string[]).includes(c)))
}

// ── 전날 결정 fixture — 정본 validator 를 지나야만 만들어진다 ──
const PREV = previousKstDate(TODAY)!
const PREV2 = previousKstDate(PREV)!
const row = (o: Record<string, unknown>, kstDate = PREV): Record<string, unknown> => ({
  kstDate, capacity: 'd10', release: 'd1', state: 'HOLD', reasons: [], blocks: [], dayPinned: false, supply: null,
  decidedAt: `${previousKstDate(kstDate)}T22:10:00.000Z`, contractVersion: STAGE_DECISION_VERSION,
  decidedBy: DECISION_WRITER, transition: null, ...o,
})
const validated = (o: Record<string, unknown>): ValidatedStageDecision => {
  const v = validateStoredDecision({ row: row(o), expectKstDate: PREV })
  if (!v.ok) throw new Error(`fixture 전날 결정이 깨졌다 — ${v.reason}`)
  return v.decision
}
/** 🔴 09-29 운영 행 그대로의 모양 — TRIAL d3 · 기반 d1 · 근거 칸 없음(표식 이전 행) */
const PREV_TRIAL_D3 = validated({ release: 'd3', state: 'TRIAL', transition: { kind: 'TRIAL', trialBase: 'd1', previousKstDate: PREV2, target: 'd3' } })
const PREV_TRIAL_D5 = validated({ release: 'd5', state: 'TRIAL', transition: { kind: 'TRIAL', trialBase: 'd3', previousKstDate: PREV2, target: 'd5', basis: 'PASS' } })
const PREV_HOLD_D3 = validated({ release: 'd3', state: 'HOLD' })
const PREV_HOLD_D1 = validated({ release: 'd1', state: 'HOLD' })
const PASS3 = judge(facts('d3'))
const PASS5 = judgeStageEvidence(D, 'd5', facts('d5'), side())
const FAIL3 = judge(facts('d3', { posts: [post(0, { personaComments: [] }), post(1), post(2)] }))

console.log('\n② 시험 계획 — 날짜가 아니라 증거로')
{
  const p = (prev: ValidatedStageDecision, ev: StageEvidenceVerdict | null) => {
    const x = trialPlanOf(prev, ev)
    return x === null ? 'none' : `${x.base}→${x.target}:${x.basis}`
  }
  check('🟢 D3 PASS → 다음 날 d5 시험 (기반 d3)', p(PREV_TRIAL_D3, PASS3) === 'd3→d5:PASS', p(PREV_TRIAL_D3, PASS3))
  check('🔴 D3 FAIL → 다음 날 d3 재시험 (기반 d1)', p(PREV_TRIAL_D3, FAIL3) === 'd1→d3:RETEST', p(PREV_TRIAL_D3, FAIL3))
  check('🔴 🔴 **증거 없음(날짜만) → d5 로 오르지 않는다 · d3 재시험**', p(PREV_TRIAL_D3, null) === 'd1→d3:RETEST', p(PREV_TRIAL_D3, null))
  check('⬚ 모름 → 머문다(d3 재시험)', p(PREV_TRIAL_D3, judge(null)) === 'd1→d3:RETEST')
  check('🟢 D5 PASS → d10 시험 (기반 d5)', p(PREV_TRIAL_D5, PASS5) === 'd5→d10:PASS', p(PREV_TRIAL_D5, PASS5))
  check('🔴 D5 FAIL → d5 재시험 (기반 d3)', p(PREV_TRIAL_D5, null) === 'd3→d5:RETEST')
  check('🔴 다른 날짜의 PASS 로 오르지 않는다', p(PREV_TRIAL_D3, { ...PASS3, kstDate: '2026-09-27' }) === 'd1→d3:RETEST')
  check('🔴 다른 단계의 PASS(D5 PASS 를 D3 날에) 로 오르지 않는다', p(PREV_TRIAL_D3, { ...PASS5 }) === 'd1→d3:RETEST')
  check('🔴 증거 없는 d3 유지 날(HOLD) → 시험 없음(지금 단계를 지킨다)', p(PREV_HOLD_D3, null) === 'none')
  check('바닥(d1) 유지 날 → d3 시험(FLOOR — 증명할 아래 칸이 없다)', p(PREV_HOLD_D1, null) === 'd1→d3:FLOOR')
}

// ── controller 끝까지 — 정본 조립(재고 · 하루 시험) ──
const N = ['아침 산책', '무릎 이야기', '김장 준비', '동네 마실', '주말 반찬']
const CAPTURED = new Date(NOW.getTime() - 3 * 86_400_000)
const queue: QueueCandidate[] = Array.from({ length: 140 }, (_, i) => ({
  queueId: `q-${String(i).padStart(3, '0')}`, title: `${N[i % N.length]} (${i})`,
  body: `${N[i % N.length]}\n\n있었던 소소한 이야기를 적어 봅니다. ${i}번째 글이에요.`,
  gateVerdict: 'PASS', createdAt: i, assignedPersonaCode: null,
  voice: null, profile: 'human' as const, capturedAt: CAPTURED,
}))
const PERSONAS = parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8')).cards.filter((c) => c.voiceLength !== null).map(cardToPersona)
const axis = { now: NOW, publishedToday: 0 }
const VERDICTS = stageVerdicts({ queue, personas: PERSONAS, axis })
/** 🔴 controller 스크립트와 같은 조립 — 시험 대상·기반은 `trialPlanOf` 가 정한다 */
const dailyOf = (target: ReleaseStage, base: ReleaseStage): DatedCanary => {
  const sim = simulateStage({ stage: target, queue, personas: PERSONAS, axis, days: 1, anchor: 'now', dailyCap: PROFILES[target].dailyTarget })
  return {
    kstDate: TODAY, stage: target, builtAt: AT, trialBase: base,
    verdict: judgeOneDayCanary(sim, { publishedToday: 0, slotsLeft: PROFILES[target].dailyTarget }),
  }
}
const OK_SIGNALS: HealthSignal[] = [
  { axis: 'quality', health: 'ok', reasons: [] }, { axis: 'cost', health: 'ok', reasons: [] }, { axis: 'errors', health: 'ok', reasons: [] },
]
const run = (prev: ValidatedStageDecision, ev: StageEvidenceVerdict | null, o: Partial<ControllerInputs> = {}) => {
  const plan = trialPlanOf(prev, ev)
  return decideStage({
    kstDate: TODAY, decidedAt: AT, envRelease: 'd1', authorizedCeiling: 'd10', previousDecision: prev,
    previousEvidence: ev, verdicts: VERDICTS, daily: plan === null ? null : dailyOf(plan.target, plan.base),
    promotion: null, publishedToday: 0, signals: OK_SIGNALS, ...o,
  })
}

console.log('\n③ controller 끝까지 — 09-29 운영 반례')
{
  check('fixture 기준선 — 재고가 d10 까지 준비돼 있다(시험이 재고로 막히지 않는다)',
    VERDICTS.filter((v) => v.ready).length >= 3, VERDICTS.map((v) => `${v.stage}:${v.ready}`).join(','))
  const retest = run(PREV_TRIAL_D3, FAIL3)
  const d = retest.decision
  const t = d.transition
  check('🔴 🔴 **09-29 D3 FAIL → 09-30 07:00 결정은 TRIAL d3 (재시험) · d5 아님**',
    d.state === 'TRIAL' && d.release === 'd3' && t !== null && t.kind === 'TRIAL' && t.trialBase === 'd1' && t.basis === 'RETEST',
    `${d.state} ${d.release} ${JSON.stringify(t)} · ${d.reasons.join(' | ')}`)
  check('재시험 결정은 정본 validator 를 통과한다', validateForToday(d).ok)
  check('지속 단계는 d1 그대로다(하루를 비우지 않는다)', retest.sustained === 'd1')
  const env = consumerEnvOf({ ok: true, decision: (validateForToday(d) as { ok: true; decision: ValidatedStageDecision }).decision })
  check('러너 env — 공개 d1 + 오늘 하루 d3 canary', env.SORAN_RELEASE_STAGE === 'd1' && env[CANARY_STAGE_ENV] === 'd3', JSON.stringify(env))
  check('reasons 에 증거 판정(코드)이 남는다', d.reasons.some((r) => r.startsWith(`EVIDENCE ${D} d3 FAIL [`) && r.includes('COMMENT_MISSING')))

  const promote = run(PREV_TRIAL_D3, PASS3).decision
  check('🟢 09-29 가 PASS 였다면 → TRIAL d5 (기반 d3 · PASS)',
    promote.state === 'TRIAL' && promote.release === 'd5' && promote.transition?.kind === 'TRIAL'
    && promote.transition.trialBase === 'd3' && promote.transition.basis === 'PASS', `${promote.state} ${promote.release}`)
  check('그 결정도 validator 를 통과한다', validateForToday(promote).ok)

  const noEv = run(PREV_TRIAL_D3, null).decision
  check('🔴 증거 없음 → TRIAL d3 재시험', noEv.state === 'TRIAL' && noEv.release === 'd3')

  /** 🔴 옛 조립(날짜만) 그대로의 하루 판정을 넣으면 사다리가 막는다 */
  const forged = decideStage({
    kstDate: TODAY, decidedAt: AT, envRelease: 'd1', authorizedCeiling: 'd10', previousDecision: PREV_TRIAL_D3,
    previousEvidence: FAIL3, verdicts: VERDICTS, daily: dailyOf('d5', 'd3'), promotion: null, publishedToday: 0, signals: OK_SIGNALS,
  }).decision
  check('🔴 🔴 **날짜만으로 만든 d5 시험(기반 d3)을 끼워 넣어도 열리지 않는다**',
    forged.release !== 'd5' && forged.state !== 'TRIAL'
    && forged.blocks.some((b) => b.code === 'PROVENANCE_PREVIOUS') && forged.blocks.some((b) => b.code === 'PROVENANCE_STAGE'),
    `${forged.state} ${forged.release} ${forged.blocks.map((b) => b.code).join(',')}`)
  check('그 결정도 저장 가능한 모양이다(막힌 채 HOLD/PREPARE)', validateForToday(forged).ok)

  const noEvidenceForged = decideStage({
    kstDate: TODAY, decidedAt: AT, envRelease: 'd1', authorizedCeiling: 'd10', previousDecision: PREV_TRIAL_D3,
    verdicts: VERDICTS, daily: dailyOf('d5', 'd3'), promotion: null, publishedToday: 0, signals: OK_SIGNALS,
  }).decision
  check('🔴 previousEvidence 를 아예 안 넘기면(옛 호출) d5 가 열리지 않는다', noEvidenceForged.release !== 'd5')

  const d5retest = run(PREV_TRIAL_D5, judgeStageEvidence(D, 'd5', facts('d5', { posts: [] }), side())).decision
  check('🔴 D5 FAIL → TRIAL d5 재시험 (기반 d3 · RETEST)', d5retest.state === 'TRIAL' && d5retest.release === 'd5'
    && d5retest.transition?.kind === 'TRIAL' && d5retest.transition.trialBase === 'd3' && d5retest.transition.basis === 'RETEST')
  check('그 결정도 validator 를 통과한다', validateForToday(d5retest).ok)
  const d10 = run(PREV_TRIAL_D5, PASS5).decision
  check('🟢 D5 PASS → TRIAL d10', d10.state === 'TRIAL' && d10.release === 'd10' && validateForToday(d10).ok, `${d10.state} ${d10.release}`)

  const hold3 = run(PREV_HOLD_D3, null)
  check('🔴 증거 없는 d3 유지 날 → 시험 없이 d3 를 지킨다(내리지 않는다)',
    hold3.decision.release === 'd3' && hold3.decision.state !== 'TRIAL', `${hold3.decision.state} ${hold3.decision.release}`)

  const braked = run(PREV_TRIAL_D3, FAIL3, { signals: [{ axis: 'quality', health: 'bad', reasons: ['확정 결함 1건'] }, OK_SIGNALS[1]!, OK_SIGNALS[2]!] })
  check('기존 브레이크는 그대로 — 나쁜 신호면 재시험도 없다(감속)', braked.brake === 'slowdown' && braked.decision.state !== 'TRIAL')
  const unknownSig = run(PREV_TRIAL_D3, PASS3, { signals: [OK_SIGNALS[0]!, { axis: 'cost', health: 'unknown', reasons: [] }, OK_SIGNALS[2]!] })
  check('기존 브레이크는 그대로 — 모르는 신호면 PASS 여도 시험을 되돌린다', unknownSig.brake === 'holdUnknown' && unknownSig.decision.release === 'd1')
  const ceil = run(PREV_TRIAL_D3, PASS3, { authorizedCeiling: 'd3' }).decision
  check('승인 천장은 그대로 — PASS 여도 d3 천장이면 d5 를 열지 않는다', ceil.release !== 'd5' && ceil.state !== 'TRIAL')
}

console.log('\n④ 저장 validator — 재시험 모양은 받고 근거 없는 점프는 거절')
{
  const trial = (tr: Record<string, unknown>, release: ReleaseStage) => validateStoredDecision({
    row: row({ release, state: 'TRIAL', transition: { kind: 'TRIAL', previousKstDate: PREV, target: release, ...tr } }, TODAY),
    expectKstDate: TODAY,
  })
  const r1 = trial({ trialBase: 'd3' }, 'd5')
  check('🔴 🔴 **근거 칸 없는 d3→d5 TRIAL 은 거절 (날짜만으로 오른 행)**', !r1.ok, r1.ok ? '' : r1.reason)
  check('🔴 FLOOR 근거로 d3→d5 는 거절', !trial({ trialBase: 'd3', basis: 'FLOOR' }, 'd5').ok)
  check('🔴 모르는 근거 값은 거절', !trial({ trialBase: 'd3', basis: 'DATE' }, 'd5').ok)
  check('PASS 근거의 d3→d5 는 통과', trial({ trialBase: 'd3', basis: 'PASS' }, 'd5').ok)
  check('RETEST 근거의 d3→d5 는 통과', trial({ trialBase: 'd3', basis: 'RETEST' }, 'd5').ok)
  check('🟢 재시험 d1→d3 (RETEST) 는 통과', trial({ trialBase: 'd1', basis: 'RETEST' }, 'd3').ok)
  check('🟢 옛 행 모양(d1→d3 · 근거 칸 없음 · 09-29 운영 행)은 그대로 읽힌다', trial({ trialBase: 'd1' }, 'd3').ok)
  check('🔴 재시험이어도 점프(d1→d5)는 거절', !trial({ trialBase: 'd1', basis: 'RETEST' }, 'd5').ok)
  const v = trial({ trialBase: 'd1', basis: 'RETEST' }, 'd3')
  check('검증된 값에 근거 칸이 남는다', v.ok && v.decision.transition?.kind === 'TRIAL' && v.decision.transition.basis === 'RETEST')
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)
