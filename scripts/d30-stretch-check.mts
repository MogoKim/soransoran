#!/usr/bin/env tsx
/**
 * D30 stretch 정책 검사 — 🔴 순수 fixture · DB 0 · 네트워크 0 · 파일 write 0 (2026-11-13 창업자 결정)
 *
 *   npm run check:d30-stretch
 *
 *   ① D30 이상 preflight — 계약 유효 + stage-active 두 칸 (reserve60·active40 / 계약59·active60 / active60 중 계약 무효 /
 *      모름 / 판독 어긋남 / D20 은 보지 않음)
 *   ② Persona 용량 두 칸은 4상태 정본 한 판정에서 나온다 — active 행 수로 대신하지 않는다
 *   ③ 증거 — 자동 target 글의 수동 Persona 댓글: 시행일(11-14)부터 COMMENT_MANUAL_PERSONA · 그 전 날짜는 그대로
 *   ④ 비용 진단 — noReady 장부 단계 분해 · #838 epoch 단가는 보고 전용(판정 입력 불변)
 *   ⑤ 댓글 vitality — 분모 0 · 부분 데이터 · 실회원 · 8~10 분포 · 불변식(중복 · 글쓴이 답글 · 구조 상한)
 *   ⑥ 배선 — controller 가 한 판독 제공자를 쓰고, 판정 사실에 진단 칸이 섞이지 않는다
 */
import { readFileSync } from 'node:fs'

import { judgeNextPreflight, requiresStageActiveFloor, type PreflightFacts, type PreflightVerdict } from '../src/lib/stage-ladder-generic'
import { profileOf } from '../src/lib/scale-profile'
import { PERSONA_CANARY_FLOOR } from '../src/lib/d100-capacity'
import { personaCapacityOf } from '../src/lib/persona-reserve'
import {
  judgeStageEvidence, personaCommentCapFor, MANUAL_PERSONA_PROOF_GATE_FROM_KST,
  type EvidencePost, type EvidenceSideSignals, type StageEvidenceFacts,
} from '../src/lib/stage-evidence'
import { DECISION_WRITER } from '../src/lib/stage-decision-contract'
import { judgeCost } from '../src/lib/ops-status'
import { tallyOf, type LedgerEntry } from '../src/lib/llm-ledger'
import { costAttributionOf, type CostFate } from '../src/lib/ready-fate'
import { SUPPLY_JIT_CONTRACT } from '../src/lib/supply-intent'
import { costEpochDiagnosticOf, noReadyBreakdownOf } from '../src/lib/supply-cost-diagnostics'
import { judgeCommentVitality, type VitalityComment, type VitalityPost } from '../src/lib/comment-vitality'
import { RUNNER_GRID, costDiagnosticsOf } from './lib/stage-preflight-facts.mjs'

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}
const has = (xs: readonly string[], c: string): boolean => xs.includes(c)

// ─────────────────────────────────────────────────────────
console.log('\n① D30 이상 preflight — 계약 유효와 stage-active')
// ─────────────────────────────────────────────────────────
const GOOD = (stage: 'd20' | 'd30' | 'd50'): PreflightFacts => {
  const n = profileOf(stage).dailyTarget
  return {
    proofKstDate: '2026-11-14',
    slotValidOpportunities: n * 2,
    slotValidReadyStock: n,
    readyCohort: {
      sources: n, published: n, lost: 0, scheduled: 0, unknown: 0, usdPerSlotValidResult: 0.001,
      trialCost: { settledRequests: 40, usageUnknownRequests: 0, overrunRequests: 0, ineligibleRequests: 0, riskUsdPerSlotValidResult: 0.001 },
    },
    latencyP50H: 3, latencyP90H: 10,
    contractValidPersonas: 500, stageActivePersonas: 500,
    commentUsdPerRequest: 0.001, commentDailyUsdCap: 0.5,
    auditUsdPerCall: 0.001, auditDailyUsdCap: 0.3, supplyDailyUsdCap: 1.2, runnerHealth: 'ok',
  }
}
const pf = (stage: 'd20' | 'd30' | 'd50', o: Partial<PreflightFacts> = {}): PreflightVerdict =>
  judgeNextPreflight(stage, { ...GOOD(stage), ...o }, RUNNER_GRID)
const F30 = PERSONA_CANARY_FLOOR.d30
{
  const g = pf('d30')
  check('🟢 D30 기준선 — 모든 축 green → PASS', g.verdict === 'PASS' && g.codes.length === 0, JSON.stringify(g.codes))
  const r60a40 = pf('d30', { contractValidPersonas: 60, stageActivePersonas: 40 })
  check('🔴 reserve 20 + active 40 = 계약 유효 60 → PERSONA_SHORT 는 없고 PERSONA_ACTIVE_SHORT 로 FAIL (숫자만 통과하는 죽은 게이트 차단)',
    r60a40.verdict === 'FAIL' && has(r60a40.codes, 'PERSONA_ACTIVE_SHORT') && !has(r60a40.codes, 'PERSONA_SHORT')
    && r60a40.counts.personasActive === 40, JSON.stringify({ c: r60a40.codes, k: r60a40.counts }))
  const c59 = pf('d30', { contractValidPersonas: 59, stageActivePersonas: 59 })
  check('🔴 계약 유효 59 · stage-active 59 → PERSONA_SHORT + PERSONA_ACTIVE_SHORT',
    c59.verdict === 'FAIL' && has(c59.codes, 'PERSONA_SHORT') && has(c59.codes, 'PERSONA_ACTIVE_SHORT'), JSON.stringify(c59.codes))
  const mismatch = pf('d30', { contractValidPersonas: 59, stageActivePersonas: 60 })
  check('🔴 계약 유효 59 인데 stage-active 60(부분집합 위반 · 판독 어긋남) → PERSONA_SHORT FAIL + PERSONA_ACTIVE_UNKNOWN',
    mismatch.verdict === 'FAIL' && has(mismatch.codes, 'PERSONA_SHORT') && has(mismatch.codes, 'PERSONA_ACTIVE_UNKNOWN')
    && mismatch.counts.personasActive === undefined, JSON.stringify(mismatch.codes))
  const exact = pf('d30', { contractValidPersonas: F30, stageActivePersonas: F30 })
  check(`🟢 경계 — 계약 유효 ${F30} · stage-active ${F30} → PASS`, exact.verdict === 'PASS', JSON.stringify(exact.codes))
  const oneShort = pf('d30', { contractValidPersonas: 90, stageActivePersonas: F30 - 1 })
  check(`🔴 경계 — stage-active ${F30 - 1} → PERSONA_ACTIVE_SHORT`, has(oneShort.codes, 'PERSONA_ACTIVE_SHORT'), JSON.stringify(oneShort.codes))
  const omitted = (() => { const f = GOOD('d30'); delete f.stageActivePersonas; return judgeNextPreflight('d30', f, RUNNER_GRID) })()
  check('🔴 stage-active 칸을 주지 않은 옛 호출부 → PERSONA_ACTIVE_UNKNOWN (fail-closed · 초록 아님)',
    omitted.verdict === 'UNKNOWN' && has(omitted.codes, 'PERSONA_ACTIVE_UNKNOWN'), JSON.stringify(omitted))
  const nul = pf('d30', { stageActivePersonas: null })
  check('🔴 stage-active 읽기 실패(null) → UNKNOWN', nul.verdict === 'UNKNOWN' && has(nul.codes, 'PERSONA_ACTIVE_UNKNOWN'))
  const frac = pf('d30', { stageActivePersonas: 60.5 })
  check('🔴 정수가 아닌 stage-active → UNKNOWN', has(frac.codes, 'PERSONA_ACTIVE_UNKNOWN'))
  const d50 = pf('d50', { contractValidPersonas: 100, stageActivePersonas: 60 })
  check('🔴 D50 도 같은 원칙 — 계약 유효 100 · active 60 → PERSONA_ACTIVE_SHORT', has(d50.codes, 'PERSONA_ACTIVE_SHORT'), JSON.stringify(d50.codes))
  const d20 = (() => { const f = GOOD('d20'); delete f.stageActivePersonas; return judgeNextPreflight('d20', { ...f, contractValidPersonas: 40 }, RUNNER_GRID) })()
  check('🟢 D20 역사 입력(stage-active 칸 없음 · 계약 유효 40) → 판정 그대로 PASS · 새 코드 없음',
    d20.verdict === 'PASS' && !d20.codes.some((c) => c.startsWith('PERSONA_ACTIVE')) && d20.counts.personasActive === undefined,
    JSON.stringify({ v: d20.verdict, c: d20.codes }))
  const d20lowActive = pf('d20', { contractValidPersonas: 40, stageActivePersonas: 0 })
  check('🟢 D20 은 stage-active 를 보지 않는다(이미 인증된 단계 · 소급 변경 0)', d20lowActive.verdict === 'PASS', JSON.stringify(d20lowActive.codes))
  check('대상 단계 목록 — D30 · D50 · D100 만', requiresStageActiveFloor('d30') && requiresStageActiveFloor('d50')
    && requiresStageActiveFloor('d100') && !requiresStageActiveFloor('d20') && !requiresStageActiveFloor('d10'))
}

// ─────────────────────────────────────────────────────────
console.log('\n② Persona 용량 두 칸 — 4상태 정본 한 판정')
// ─────────────────────────────────────────────────────────
{
  const st = (reserve: number, active: number) => ({
    contractValid: reserve + active,
    byState: {
      designed: [], 'qualification-pending': [],
      reserve: Array.from({ length: reserve }, (_, i) => `r${i}`),
      'stage-active': Array.from({ length: active }, (_, i) => `a${i}`),
    },
  })
  const c = personaCapacityOf(st(20, 40))
  check('🔴 reserve 20 · stage-active 40 → 계약 유효 60 · stage-active 40', c.contractValid === 60 && c.stageActive === 40, JSON.stringify(c))
  const unread = personaCapacityOf({ contractValid: null, byState: st(0, 0).byState })
  check('🔴 판정 실패 → 두 칸 모두 모름(null) — 0 이 아니다', unread.contractValid === null && unread.stageActive === null)
  /** active 60 중 20명이 계약 무효 → 정본은 그 20명을 qualification-pending 으로 둔다(stage-active 아님) */
  const invalidActive = personaCapacityOf({
    contractValid: 40,
    byState: { designed: [], 'qualification-pending': Array.from({ length: 20 }, (_, i) => `x${i}`), reserve: [],
      'stage-active': Array.from({ length: 40 }, (_, i) => `a${i}`) },
  })
  const v = pf('d30', { contractValidPersonas: invalidActive.contractValid, stageActivePersonas: invalidActive.stageActive })
  check('🔴 DB active 60 중 20명 계약 무효 → stage-active 40 · 계약 유효 40 → D30 FAIL(두 코드)',
    invalidActive.stageActive === 40 && has(v.codes, 'PERSONA_SHORT') && has(v.codes, 'PERSONA_ACTIVE_SHORT'), JSON.stringify(v.codes))
  const src = readFileSync('src/lib/persona-reserve.ts', 'utf8')
  const fn = src.slice(src.indexOf('export function personaCapacityOf'), src.indexOf('export function reserveFloorGap'))
  check('🔴 용량 helper 는 active 행 수(activeRows)를 쓰지 않는다', fn.length > 0 && !/activeRows/.test(fn.replace(/\/\*\*[\s\S]*?\*\//g, '')))
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 증거 — 자동 target 글의 수동 Persona 댓글')
// ─────────────────────────────────────────────────────────
{
  const MIN = 60_000
  const HOUR = 3_600_000
  const factsOn = (kstDate: string, manualOn: 'target' | 'human' | 'none'): StageEvidenceFacts => {
    const T0 = Date.parse(`${kstDate}T09:30:00+09:00`)
    const post = (i: number, o: Partial<EvidencePost> = {}): EvidencePost => ({
      postId: `p-${i}`, queueId: `q-${i}`, publishedAtMs: T0 + i * 4 * HOUR, unattended: true, queueRows: 1, publishLogs: 1,
      authorPersonaId: `author-${i}`, decider: 'auto', release: 'STAMPED_ELIGIBLE',
      personaComments: [{ personaId: `c-${i}`, createdAtMs: T0 + i * 4 * HOUR + 12 * MIN, topLevel: true, provenance: 'auto' }],
      ...o,
    })
    const posts = [post(0), post(1), post(2)]
    const manual = { personaId: 'm-1', createdAtMs: T0 + 30 * MIN, topLevel: true, provenance: 'none' as const }
    if (manualOn === 'target') posts[0] = { ...posts[0]!, personaComments: [...posts[0]!.personaComments, manual] }
    if (manualOn === 'human') posts.push(post(3, { decider: 'human', unattended: false, personaComments: [manual] }))
    return {
      kstDate, stage: 'd3',
      decision: { kstDate, state: 'TRIAL', release: 'd3', decidedBy: DECISION_WRITER },
      posts, orphanPublishLogs: 0, unloggedPublishes: 0, commentCapPerPost: personaCommentCapFor('bootstrap-auto'),
      audits: { rows: [{ postId: 'p-0', queueId: 'q-0', judged: true, defectYes: false, retryable: false, overdue: false }] },
    }
  }
  const costOk = judgeCost({ uses: true, tally: { ...tallyOf([]), settledUsd: 0.01, overruns: 0 }, ledgerError: null, settleHold: null, capUsd: 1 })
  const side: EvidenceSideSignals = {
    cost: [
      { lane: 'supply', name: '공급 장부', health: costOk.health },
      { lane: 'comment', name: '댓글 장부', health: costOk.health },
      { lane: 'audit', name: '감사 장부', health: costOk.health },
    ],
    errors: 'ok',
    supplyCostEvidence: {
      legacyUsageUnknownRequests: 0, wholeDayCriticalHealth: 'ok',
      envelope: { settledRequests: 20, usageUnknownRequests: 0, overrunRequests: 0, ineligibleRequests: 0, riskUsd: 0.08, budgetUsd: 1 },
    },
  }
  const j = (d: string, m: 'target' | 'human' | 'none') => judgeStageEvidence(d, 'd3', factsOn(d, m), side)
  const G = MANUAL_PERSONA_PROOF_GATE_FROM_KST
  const cleanOn = j(G, 'none')
  check(`🟢 시행일(${G}) · 수동 0 → 새 코드 없음 · manualPersonaOnTargets 0`,
    !has(cleanOn.codes, 'COMMENT_MANUAL_PERSONA') && cleanOn.counts.manualPersonaOnTargets === 0, JSON.stringify(cleanOn.codes))
  const onTarget = j(G, 'target')
  check(`🔴 시행일 · 자동 target 글(첫 댓글은 자동으로 이미 있음)에 수동 Persona 댓글 1 → COMMENT_MANUAL_PERSONA FAIL`,
    onTarget.verdict === 'FAIL' && has(onTarget.codes, 'COMMENT_MANUAL_PERSONA') && onTarget.counts.manualPersonaOnTargets === 1
    && onTarget.counts.firstCommentOk === 3, JSON.stringify({ v: onTarget.verdict, c: onTarget.codes, k: onTarget.counts }))
  check('🔴 수동 댓글은 지우지 않고 자동 증거에서만 뺀다 — 첫 댓글 3/3 은 자동 댓글로만 셈 · 수동 1 은 manualPersonaComments 로 남음',
    onTarget.counts.manualPersonaComments === 1 && onTarget.counts.firstCommentOk === 3)
  const onHuman = j(G, 'human')
  check('🟢 사람 승인 글(증명 target 밖)의 수동 Persona 댓글은 증명 FAIL 코드를 내지 않는다',
    !has(onHuman.codes, 'COMMENT_MANUAL_PERSONA') && onHuman.counts.manualPersonaOnTargets === 0, JSON.stringify(onHuman.codes))
  const before = j('2026-11-13', 'target')
  check('🟢 시행일 전날(11-13) 같은 입력 → 새 코드 · 새 칸 없음(역사 판정 소급 변경 0)',
    !has(before.codes, 'COMMENT_MANUAL_PERSONA') && before.counts.manualPersonaOnTargets === undefined, JSON.stringify(before.codes))
  const d20hist = j('2026-11-12', 'target')
  check('🟢 D20 증명일(11-12) 재판정 — 새 코드 없음', !has(d20hist.codes, 'COMMENT_MANUAL_PERSONA'))
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 비용 진단 — noReady 단계 분해 · epoch 단가(보고 전용)')
// ─────────────────────────────────────────────────────────
{
  const entry = (run: string, suffix: 'j' | 'd', stage: LedgerEntry['stage'], key: string, usd: number): LedgerEntry => ({
    runId: `${run}-${suffix}`, stage, attemptId: `${run}-${stage}-${key}`, requestNo: 0, provider: 'p', apiModelId: 'm', model: 'm',
    status: 'settled', blockCode: null, countedInputTokens: 1, maxOutputTokens: 1, reservedUsd: usd, inputTokens: 1, outputTokens: 1,
    cacheWriteTokens: 0, cacheReadTokens: 0, usageKeys: [], startedAt: '2026-11-01T01:00:00.000Z', settledUsd: usd,
    sourceKey: key, supplyContract: SUPPLY_JIT_CONTRACT,
  } as unknown as LedgerEntry)
  const OLD = '20261101-000000'
  const NEW = '20261101-060000'
  const entries: LedgerEntry[] = [
    entry(OLD, 'j', 'judge', 'k-old-hold', 0.01),
    entry(OLD, 'd', 'draftGen', 'k-old-hold', 0.05),
    entry(OLD, 'd', 'draftGenRetry', 'k-old-hold', 0.05),
    entry(OLD, 'j', 'judge', 'k-old-pub', 0.01),
    entry(OLD, 'd', 'draftGen', 'k-old-pub', 0.03),
    entry(NEW, 'j', 'judge', 'k-new-pub', 0.01),
    entry(NEW, 'd', 'draftGen', 'k-new-pub', 0.03),
    entry(NEW, 'j', 'judge', 'k-new-hold', 0.01),
  ]
  const fates = new Map<string, CostFate>([['k-old-pub', 'published'], ['k-new-pub', 'published']])
  const runs = new Set([OLD, NEW])
  const auth = costAttributionOf({ entries, fateByKey: fates, counts: { published: 2, scheduled: 0 }, cohortRuns: runs })
  check('권위 단가 — 전체 정산 ÷ 결과 2', auth !== null && auth.usdPerSlotValidResult !== null
    && Math.abs(auth.usdPerSlotValidResult - 0.2 / 2) < 1e-9, JSON.stringify(auth?.usdPerSlotValidResult))
  const nr = auth?.noReadyByStage ?? {}
  const sum = Object.values(nr).reduce((s, x) => s + (x ?? 0), 0)
  check('🔴 noReady 장부 단계 분해 — judge 0.02 · draftGen 0.05 · draftGenRetry 0.05 · 합 = noReadyUsd',
    Math.abs((nr.judge ?? 0) - 0.02) < 1e-9 && Math.abs((nr.draftGen ?? 0) - 0.05) < 1e-9
    && Math.abs((nr.draftGenRetry ?? 0) - 0.05) < 1e-9 && Math.abs(sum - (auth?.noReadyUsd ?? -1)) < 1e-9, JSON.stringify(nr))
  const br = noReadyBreakdownOf(auth)
  check('🔴 재시도 몫은 장부 이름이 …Retry 인 단계뿐 · 원천·gate 는 unknown', br.retryUsd !== null && Math.abs(br.retryUsd - 0.05) < 1e-9
    && br.firstPassUsd !== null && Math.abs(br.firstPassUsd - 0.07) < 1e-9 && br.bySource === 'unknown' && br.byGate === 'unknown', JSON.stringify(br))
  const before = JSON.stringify(auth)
  const ep = costEpochDiagnosticOf({ entries, fateByKey: fates, cohortRuns: runs, epochFromIso: '2026-11-01T03:00:00Z' })
  check('epoch 진단 — 경계 뒤 회차 1 · 앞 회차 1 · 결과 1 · 단가 0.05', ep.epochRuns === 1 && ep.excludedRuns === 1
    && ep.results.published === 1 && ep.usdPerSlotValidResult !== null && Math.abs(ep.usdPerSlotValidResult - 0.05) < 1e-9, JSON.stringify(ep))
  check('🔴 epoch 진단은 진단 전용 표식 · 병합 시각 하한 표식을 단다', ep.kind === 'diagnostic-only' && ep.basis === 'mergedAtLowerBound')
  const again = costAttributionOf({ entries, fateByKey: fates, counts: { published: 2, scheduled: 0 }, cohortRuns: runs })
  check('🔴 진단 호출 뒤에도 권위 귀속 결과는 바이트 그대로(입력 변형 0)', JSON.stringify(again) === before)
  const badRun = costEpochDiagnosticOf({ entries, fateByKey: fates, cohortRuns: new Set(['bad-run', NEW]), epochFromIso: '2026-11-01T03:00:00Z' })
  check('🔴 시각으로 못 읽는 회차는 조용히 넣지 않는다(unparsedRuns)', badRun.unparsedRuns === 1 && badRun.epochRuns === 1)
  const unk = costEpochDiagnosticOf({ entries: null, fateByKey: fates, cohortRuns: runs })
  check('🔴 장부를 못 읽으면 진단 단가도 모름', unk.usdPerSlotValidResult === null && unk.attribution === null)
  const diag = costDiagnosticsOf(entries, fates, runs, auth)
  check('preflight 진단 묶음은 diagnostic-only 표식', diag.kind === 'diagnostic-only')
  /** 판정 입력에는 epoch 칸이 없다 — 같은 사실이면 진단이 무엇이든 판정이 같다 */
  const v1 = pf('d30', { contractValidPersonas: 60, stageActivePersonas: 60 })
  const v2 = pf('d30', { contractValidPersonas: 60, stageActivePersonas: 60, ...({ costDiagnostics: diag } as object) })
  check('🔴 진단 칸을 사실에 섞어도 판정이 같다(판정은 진단을 읽지 않는다)', JSON.stringify(v1) === JSON.stringify(v2))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 댓글 vitality — 결과값 · 불변식')
// ─────────────────────────────────────────────────────────
{
  const NOW = Date.parse('2026-11-13T12:00:00+09:00')
  const DAY = 86_400_000
  const c = (origin: VitalityComment['origin'], afterMs: number, personaKey: string | null = null, isDeleted = false, base = NOW - 2 * DAY): VitalityComment =>
    ({ origin, personaKey, createdAtMs: base + afterMs, isDeleted })
  const post = (comments: VitalityComment[], o: Partial<VitalityPost> = {}): VitalityPost =>
    ({ publishedAtMs: NOW - 2 * DAY, authorPersonaKey: 'author', comments, ...o })
  const empty = judgeCommentVitality([], NOW)
  check('🔴 분모 0 → UNKNOWN · 비율 모두 null', empty.verdict === 'UNKNOWN' && empty.codes.includes('NO_POSTS')
    && empty.isolationRate === null && empty.averageLiveComments === null)
  const isolatedOnly = judgeCommentVitality([post([c('PERSONA', 600_000, 'p1')])], NOW)
  check('24시간 지난 글에 첫 댓글 하나 → 고립 1/1 · PASS(불변식 위반 0 — 대화 충분이라는 뜻 아님)',
    isolatedOnly.isolationRate === 1 && isolatedOnly.verdict === 'PASS', JSON.stringify(isolatedOnly))
  const young = judgeCommentVitality([post([c('PERSONA', 600_000, 'p1', false, NOW - 3_600_000)], { publishedAtMs: NOW - 3_600_000 })], NOW)
  check('🔴 24시간이 안 된 글은 고립률 분모에 넣지 않는다', young.maturePosts === 0 && young.isolationRate === null)
  const member = judgeCommentVitality([
    post([c('PERSONA', 600_000, 'p1'), c('MEMBER', 3_600_000)]),
    post([c('PERSONA', 600_000, 'p2'), c('GUEST', 3_600_000)]),
  ], NOW)
  check('🔴 실회원 참여 글은 MEMBER 만 센다 — 손님은 따로', member.memberParticipationPosts === 1 && member.guestParticipationPosts === 1
    && member.memberParticipationRate === 0.5, JSON.stringify(member))
  const late = judgeCommentVitality([post([c('PERSONA', 600_000, 'p1'), c('MEMBER', DAY + 60_000)])], NOW)
  check('🔴 24시간 뒤의 댓글은 고립 판정 창 밖이다(고립 1)', late.isolatedPosts === 1)
  const deleted = judgeCommentVitality([post([c('PERSONA', 600_000, 'p1'), c('MEMBER', 3_600_000, null, true)])], NOW)
  check('🔴 지운 댓글은 살아 있는 댓글로 세지 않는다', deleted.isolatedPosts === 1 && deleted.distribution['1'] === 1)
  const partial = judgeCommentVitality([post([c('PERSONA', 600_000, 'p1')]), post([{ origin: null, personaKey: null, createdAtMs: NOW, isDeleted: false }])], NOW)
  check('🔴 부분 데이터(출처를 못 읽은 댓글) → UNKNOWN · 비율 null · 읽은 글만 분포', partial.verdict === 'UNKNOWN'
    && partial.codes.includes('PARTIAL_DATA') && partial.isolationRate === null && partial.readablePosts === 1)
  const personaNoKey = judgeCommentVitality([post([{ origin: 'PERSONA', personaKey: null, createdAtMs: NOW - DAY, isDeleted: false }])], NOW)
  check('🔴 Persona 댓글인데 Persona 열쇠가 없으면 부분 데이터(중복 판정 불가)', personaNoKey.codes.includes('PARTIAL_DATA'))
  const tenPost = post(Array.from({ length: 9 }, (_, i) => c('PERSONA', 600_000 * (i + 1), `p${i}`)).concat([c('MEMBER', 9_000_000)]))
  const dist = judgeCommentVitality([tenPost, post([c('PERSONA', 600_000, 'p1')]), post([c('PERSONA', 600_000, 'p1'), c('MEMBER', 700_000), c('PERSONA', 800_000, 'p2')])], NOW)
  check('🔴 분포 — 10개 글은 8~10 칸 · 비중 1/3 · 평균은 결과값', dist.distribution['8-10'] === 1 && dist.distribution['1'] === 1
    && dist.distribution['2-4'] === 1 && dist.share8to10 !== null && Math.abs(dist.share8to10 - 1 / 3) < 1e-9
    && dist.averageLiveComments !== null && Math.abs(dist.averageLiveComments - 14 / 3) < 1e-9, JSON.stringify(dist.distribution))
  const dup = judgeCommentVitality([post([c('PERSONA', 600_000, 'p1'), c('PERSONA', 1_200_000, 'p1')])], NOW)
  check('🔴 같은 글에 글쓴이 아닌 같은 Persona 두 번 → FAIL DUP_PERSONA_ON_POST', dup.verdict === 'FAIL' && dup.codes.includes('DUP_PERSONA_ON_POST'))
  const authorThree = judgeCommentVitality([post([c('PERSONA', 600_000, 'p1'), ...[1, 2, 3].map((i) => c('PERSONA', 600_000 * (i + 1), 'author'))])], NOW)
  check('🟢 글쓴이 답글 3회는 허용(일반 중복 아님)', authorThree.verdict === 'PASS', JSON.stringify(authorThree.codes))
  const authorFour = judgeCommentVitality([post([c('PERSONA', 600_000, 'p1'), ...[1, 2, 3, 4].map((i) => c('PERSONA', 600_000 * (i + 1), 'author'))])], NOW)
  check('🔴 글쓴이 답글 4회 → FAIL AUTHOR_REPLY_OVER_CAP', authorFour.codes.includes('AUTHOR_REPLY_OVER_CAP'))
  const eleven = judgeCommentVitality([post(Array.from({ length: 11 }, (_, i) => c('PERSONA', 600_000 * (i + 1), `q${i}`)))], NOW)
  check('🔴 Persona 11건 → FAIL PERSONA_OVER_CAP · 분포 11+ (최대 20 아님)', eleven.codes.includes('PERSONA_OVER_CAP') && eleven.distribution['11+'] === 1)
  check('🔴 열린 질문 응답률은 재지 않는다(null) — 두 번째 hook 권위를 만들지 않는다', dist.openQuestionResponseRate === null)
  const lib = readFileSync('src/lib/comment-vitality.ts', 'utf8').replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  check('🔴 vitality 판정은 평균·비율 문턱으로 FAIL 하지 않는다(quota 아님)', !/averageLiveComments\s*[<>]/.test(lib) && !/Rate\s*[<>]/.test(lib))
  const cli = readFileSync('scripts/comment-vitality.mts', 'utf8')
  check('🔴 CLI 는 읽기만 한다 — create/update/delete/upsert/$executeRaw 0 · 매거진 제외',
    !/\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(|\$executeRaw|\$queryRaw/.test(cli)
    && /boardType: \{ in: \['MENOPAUSE', 'FREE'\] \}/.test(cli))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 배선')
// ─────────────────────────────────────────────────────────
{
  const ctl = readFileSync('scripts/stage-controller.mts', 'utf8')
  check('🔴 controller 는 Persona 용량을 한 판독 제공자로 넘긴다', /personaCapacity: \(\) => readPersonaCapacity\(prisma/.test(ctl))
  const facts = readFileSync('scripts/lib/stage-preflight-facts.mts', 'utf8')
  const factsBlock = facts.slice(facts.indexOf('const facts: PreflightFacts = {'), facts.indexOf('return {\n    facts, notes,'))
  check('🔴 preflight 사실에 stage-active 칸이 실린다', /stageActivePersonas,/.test(factsBlock))
  check('🔴 판정 사실에는 진단·epoch 칸이 없다', factsBlock.length > 0 && !/epoch|costDiagnostics|noReadyBy/.test(factsBlock))
  check('🔴 권위 단가는 rolling 72h cohort 귀속 그대로 판정에 간다',
    facts.includes('usdPerSlotValidResult: costAttribution?.usdPerSlotValidResult ?? null'))
  const gen = readFileSync('src/lib/stage-ladder-generic.ts', 'utf8')
  check('🔴 판정 모듈은 진단 모듈을 import 하지 않는다', !gen.includes('supply-cost-diagnostics'))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} D30 stretch 검사 — ${pass} pass · ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)
