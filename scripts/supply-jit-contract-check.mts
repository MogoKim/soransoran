#!/usr/bin/env tsx
/**
 * 🔴 **P0-2 JIT 공급 계약 검사 — 가까운 슬롯의 실제 부족분만 산다** (2026-10-04 · canon §3 · §3.1)
 *
 *   ① 수요 = 다가오는 슬롯 − 그 슬롯에 eligible 인 READY(정본 `judgeSlotRelease` · 슬롯 시각) · 0 이면 유료 0
 *   ② 유료 원천 수 = 부족분 · 증폭은 결말 수율 근거로만(`paidSourcesFor`) · 묶음 상한은 안전장치
 *   ③ 지금 유효해도 예정 슬롯 전에 만료되면 커버리지 밖 · 손실 확정
 *   ④ 대기 READY 3분류 — 예정 슬롯 · 손실 확정 · 모름(근거 부족은 PASS 도 FAIL 도 아니다)
 *   ⑤ 원천 기회 할인은 결말 수율 — 대기 포함 raw 수율이 아니다
 *   ⑥ 같은 원천 중복 유료 생성 0 · retryable 과 terminal 구분
 *   ⑦ 장부 · 묶음 · 기회 스냅샷 손상 → 모름(조용히 빼지 않는다)
 *   ⑧ 비용 귀속 — 원천 해시로 연결된 비용만 결과당 단가 · raw 단가로 대신하지 않는다
 *   ⑨ 발행 시점 재검사 유지 · 러너 배선(소스 잠금)
 *
 * 🔴 DB 0 · 네트워크 0 · provider 0 · 파일 write 는 OS 임시 디렉터리에만(끝나면 지운다).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  judgeSlotRelease, matchOpportunitiesToSlots, buildSourceEvidence, articleIdHashOf, SOURCE_STATS_METHOD,
  type SlotOpportunity,
} from '../src/lib/source-slot-release'
import {
  pendingFateOf, cohortFatesOf, terminalYieldOf, paidSourcesFor, costAttributionOf, TIME_INVARIANT_LOSS_REASONS, pipelineRunOfLedger,
  type CostFate,
} from '../src/lib/ready-fate'
import { judgeJitDemand, fillUpToOf, ledgerRunIdOf } from '../src/lib/supply-process'
import { judgeSettle } from '../src/lib/llm-ledger'
import {
  concludedSourceKeys, attemptedOutcomes, CONCLUDED_STATES, worksetFileName, opportunitiesFileName,
  WORKSET_KIND, WORKSET_VERSION, WORKSET_VERSION_JIT, SUPPLY_JIT_CONTRACT, type PriorOutcome,
} from '../src/lib/supply-workset'
import { judgeNextPreflight, type PreflightFacts } from '../src/lib/stage-ladder-generic'
import { jitCoverageOf, type LoadedStock, type ResolvedScale } from './lib/publishable-stock.mjs'
import { AUTO_DECIDER } from '../src/lib/auto-ready-v2'
import { profileOf } from '../src/lib/scale-profile'
import { sourceKeyOf } from '../src/lib/source-identity'
import { claimsJitContract, intentLinkIssue, type SupplyIntent } from '../src/lib/supply-intent'
import type { LedgerEntry } from '../src/lib/llm-ledger'
import {
  pooledEntries, worksetSourcesIn, latestOpportunities, combineOpportunityBounds, slotValidOpportunitiesOf, costFateOf, RUNNER_GRID,
} from './lib/stage-preflight-facts.mjs'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { fail += 1; console.log(`  🔴 FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}
const strip = (p: string): string => readFileSync(p, 'utf-8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')

const H = 3_600_000
const NOW = new Date('2026-10-04T07:00:00+09:00')
/** 다가오는 슬롯 5개 — 09:00 · 11:00 · 13:00 · 15:00 · 17:00 KST */
const SLOTS = [9, 11, 13, 15, 17].map((h) => new Date(`2026-10-04T${String(h).padStart(2, '0')}:00:00+09:00`))
const iso = (ms: number): string => new Date(ms).toISOString()
/** 🔴 정본 판정이 읽는 증거 — 게시 시각만 바꾼다(반응 · 원천 상대 표본 · 참여 동력 있음) */
const gate = (postedMs: number, o: { capturedMs?: number; driver?: string } = {}): unknown => {
  const cap = o.capturedMs ?? postedMs + 30 * 60_000
  return {
    sourceEvidence: buildSourceEvidence({
      postedAt: iso(postedMs), capturedAt: iso(cap), sourceSite: 'fx', sourceArticleId: `a${postedMs}`,
      response: { comments: 3, views: 100, observedAt: iso(cap) },
      sourceStats: { basis: 'list-artifacts', method: SOURCE_STATS_METHOD, sourceKey: 'fx', bucket: '<3h', n: 5,
        commentsPct: 0.5, viewsPct: 0.5, windowFrom: iso(postedMs - 72 * H), windowTo: iso(cap) },
      participationDriver: o.driver ?? '공감',
    }),
  }
}
/** 🔴 커버리지와 같은 판정 — 슬롯 시각에 정본 판정 */
const readyOpp = (key: string, g: unknown): SlotOpportunity => ({
  key, validAt: (slotAt) => judgeSlotRelease({
    gateResults: g, slotAt, now: NOW, hardGates: { ok: true, codes: [] }, assignment: { ok: true }, tieBreak: key,
  }).verdict === 'eligible',
})
const fresh = NOW.getTime() - 2 * H

console.log('\n① 반례 — 슬롯 5 · slot-valid READY 5 → 수요 0 · 유료 0')
{
  const ready = Array.from({ length: 5 }, (_, i) => readyOpp(`r${i}`, gate(fresh - i * 60_000)))
  const filled = matchOpportunitiesToSlots(SLOTS, ready).filled
  const policy = judgeJitDemand({ slots: SLOTS.length, readyFilled: filled })
  const paid = paidSourcesFor({ deficit: policy.upTo, yieldHigh: 0.1, cap: 10 })
  check('🔴 eligible READY 5 가 슬롯 5 를 덮는다 → 모델 단계 없음 · 적재 없음 · 유료 원천 0',
    filled === 5 && !policy.llm && !policy.fill && policy.upTo === 0 && paid.sources === 0 && paid.basis === 'noDemand',
    JSON.stringify({ filled, policy, paid }))
}

console.log('\n①-b 🔴 사람 승인 READY 는 자동 공급을 닫지 않는다 (JIT 커버리지 = 자동 READY 만)')
{
  // 🔴 23:00 KST — 오늘 슬롯은 지났고 다가오는 슬롯은 내일 d5 증명일 5개다
  const late = new Date('2026-10-04T23:00:00+09:00')
  const g = gate(late.getTime() - 2 * H)
  const row = (id: string, decidedBy: string): Record<string, unknown> => ({ id, decidedBy, gateResults: g, matchedPersonaId: null })
  const view = (rows: Record<string, unknown>[]): { loaded: LoadedStock; resolved: ResolvedScale } => ({
    loaded: { targets: rows, history: [], publishedToday: 0, codeOfPersonaId: new Map() } as unknown as LoadedStock,
    resolved: { scale: { releaseProfile: profileOf('d5'), capacityProfile: profileOf('d5') } } as unknown as ResolvedScale,
  })
  const human = jitCoverageOf(view(Array.from({ length: 5 }, (_, i) => row(`h${i}`, 'founder'))), late)
  const auto = jitCoverageOf(view(Array.from({ length: 5 }, (_, i) => row(`a${i}`, AUTO_DECIDER))), late)
  const dh = judgeJitDemand(human)
  const da = judgeJitDemand(auto)
  check('🔴 🔴 **사람 READY 5 · 자동 0 → 부족 5 (사람 글이 자동 증명 공급을 줄이지 않는다)**',
    human.slots === 5 && human.readyFilled === 0 && dh.upTo === 5 && human.unfilled.length === 5, JSON.stringify({ human: { ...human, horizon: undefined }, dh }))
  check('🔴 🔴 **자동 READY 5 → 부족 0 · 유료 0**',
    auto.readyFilled === 5 && da.upTo === 0 && !da.llm && auto.unfilled.length === 0, JSON.stringify(da))
}

console.log('\n② 반례 — 슬롯 5 · 유효 READY 3 → 부족 2 만')
{
  const ready = Array.from({ length: 3 }, (_, i) => readyOpp(`r${i}`, gate(fresh - i * 60_000)))
  const policy = judgeJitDemand({ slots: SLOTS.length, readyFilled: matchOpportunitiesToSlots(SLOTS, ready).filled })
  check('🔴 수요 = 5 − 3 = 2 · 적재 상한 2', policy.llm && policy.upTo === 2 && fillUpToOf(policy.upTo, 10) === 2, JSON.stringify(policy))
  check('🔴 수율을 모르면 증폭하지 않는다 — 유료 원천 2(부족분만)',
    JSON.stringify(paidSourcesFor({ deficit: 2, yieldHigh: null, cap: 10 })) === JSON.stringify({ sources: 2, basis: 'deficitOnly' }))
  check('🔴 결말 수율 상한 0.5 → ceil(2 ÷ 0.5) = 4 (실측 근거로만 증폭)',
    paidSourcesFor({ deficit: 2, yieldHigh: 0.5, cap: 10 }).sources === 4)
  check('🔴 수율 0 이면 돈을 더 써도 결과가 늘지 않는다 — 부족분만(2)',
    paidSourcesFor({ deficit: 2, yieldHigh: 0, cap: 10 }).sources === 2)
  check('🔴 묶음 상한은 안전장치 — ceil(2 ÷ 0.05) = 40 이어도 10',
    paidSourcesFor({ deficit: 2, yieldHigh: 0.05, cap: 10 }).sources === 10)
  check('🔴 수요를 모르면(null) 모델 · 적재 0', !judgeJitDemand(null).llm && judgeJitDemand(null).upTo === 0)
}

console.log('\n③ 반례 — 지금은 유효하지만 예정 슬롯 전에 만료')
{
  const g = gate(SLOTS[0]!.getTime() - 72 * H - 60_000)
  const nowV = judgeSlotRelease({ gateResults: g, slotAt: NOW, now: NOW, hardGates: { ok: true, codes: [] }, assignment: { ok: true }, tieBreak: 'x' })
  const filled = matchOpportunitiesToSlots(SLOTS, [readyOpp('soon', g)]).filled
  check('🔴 지금(07:00)은 eligible · 첫 슬롯(09:00)에서는 72h 초과 → 커버리지 0 · 수요 5',
    nowV.verdict === 'eligible' && filled === 0 && judgeJitDemand({ slots: 5, readyFilled: filled }).upTo === 5)
  const f = pendingFateOf({ gateResults: g, matched: false, horizon: SLOTS, now: NOW, tieBreak: 'soon' })
  check('🔴 그 대기 READY 는 손실 확정(SOURCE_TOO_OLD_AT_SLOT) — 구제하지 않는다',
    f.fate === 'lost' && f.reason === 'SOURCE_TOO_OLD_AT_SLOT', JSON.stringify(f))
}

console.log('\n④ 대기 READY 3분류 — 예정 · 손실 확정 · 모름')
{
  check('🔴 정본 짝짓기로 예정 슬롯에 걸린 대기 → scheduled',
    pendingFateOf({ gateResults: gate(fresh), matched: true, horizon: SLOTS, now: NOW, tieBreak: 'a' }).fate === 'scheduled')
  const surplus = pendingFateOf({ gateResults: gate(fresh), matched: false, horizon: SLOTS, now: NOW, tieBreak: 'b' })
  check('🔴 eligible 이지만 예정 슬롯 짝이 없다(잉여 · Persona) → unknown (성공으로 세지 않는다)',
    surplus.fate === 'unknown' && surplus.reason === null, JSON.stringify(surplus))
  const noSlot = pendingFateOf({ gateResults: gate(fresh), matched: false, horizon: [], now: NOW, tieBreak: 'c' })
  check('🔴 🔴 예정 슬롯 근거가 없는 대기 → unknown', noSlot.fate === 'unknown', JSON.stringify(noSlot))
  const legacy = pendingFateOf({ gateResults: {}, matched: false, horizon: SLOTS, now: NOW, tieBreak: 'd' })
  check('🔴 증거가 없는 legacy READY → 손실 확정(EVIDENCE_MISSING) — 구제 · backfill 없음',
    legacy.fate === 'lost' && legacy.reason === 'EVIDENCE_MISSING', JSON.stringify(legacy))
  const old = pendingFateOf({ gateResults: gate(NOW.getTime() - 80 * H), matched: false, horizon: SLOTS, now: NOW, tieBreak: 'e' })
  check('🔴 원문 80h → 손실 확정', old.fate === 'lost' && old.reason === 'SOURCE_TOO_OLD_AT_SLOT')
  const future = pendingFateOf({
    gateResults: gate(fresh, { capturedMs: NOW.getTime() + H }), matched: false, horizon: SLOTS, now: NOW, tieBreak: 'f',
  })
  check('🔴 시계에 기대는 실패(CAPTURED_IN_FUTURE)는 손실 확정이 아니다 → unknown',
    future.fate === 'unknown' && future.reason === 'CAPTURED_IN_FUTURE' && !TIME_INVARIANT_LOSS_REASONS.includes('CAPTURED_IN_FUTURE'),
    JSON.stringify(future))
  const c = cohortFatesOf([
    { status: 'PUBLISHED', fate: null }, { status: 'EXPIRED', fate: null },
    { status: 'APPROVED', fate: 'scheduled' }, { status: 'APPROVED', fate: 'lost' }, { status: 'EDITED', fate: 'unknown' },
  ])
  check('🔴 cohort 합계 — 공개 1 · 손실 2(만료 + 손실 확정 대기) · 예정 1 · 모름 1',
    c.published === 1 && c.lost === 2 && c.scheduled === 1 && c.unknown === 1, JSON.stringify(c))
}

console.log('\n⑤ 원천 기회 할인은 결말 수율 — 대기 포함 raw 수율이 아니다')
{
  // 운영 10월 4일 모양 5/0/9 와 같은 비율: 공개 5 · 손실 0 · 대기 9 · 원천 160
  const allUnknown = terminalYieldOf({ published: 5, lost: 0, scheduled: 0, unknown: 9 }, 160)
  check('🔴 결말 수율 구간 = 5/160 ~ 14/160 (raw 14/160 을 하한으로 쓰지 않는다)',
    allUnknown !== null && allUnknown.low === 5 / 160 && allUnknown.high === 14 / 160, JSON.stringify(allUnknown))
  const lost = terminalYieldOf({ published: 0, lost: 3, scheduled: 0, unknown: 0 }, 30)
  check('🔴 READY 3 이 전부 손실이면 결말 수율 0 (raw 수율이면 0.1)', lost !== null && lost.low === 0 && lost.high === 0)
  check('🔴 원천 수를 모르면 수율도 모른다', terminalYieldOf({ published: 3, lost: 0, scheduled: 0, unknown: 0 }, null) === null)
  const sources = Array.from({ length: 40 }, (_, i): SlotOpportunity => ({ key: `s${i}`, validAt: () => true }))
  const at = (y: number | null): number => slotValidOpportunitiesOf({ slots: SLOTS, ready: [], sources, readyPerSource: y }).total
  check('🔴 원천 40 · 수율 0 → 기회 0 · 수율 0.1 → 4 · 모르면 0(과대평가 금지)', at(0) === 0 && at(0.1) === 4 && at(null) === 0)
  check('🔴 구간 합치기 — 같으면 그 값 · 하한이 다 덮으면 하한 · 상한도 못 덮으면 하한 · 그 사이는 모름(null)',
    combineOpportunityBounds(3, 3, 5) === 3 && combineOpportunityBounds(5, 5, 5) === 5
    && combineOpportunityBounds(2, 4, 5) === 2 && combineOpportunityBounds(3, 5, 5) === null)
}

console.log('\n⑥ 같은 원천 중복 유료 생성 0 · retryable 과 terminal 구분')
{
  const k1 = sourceKeyOf('fx', 'term')
  const k2 = sourceKeyOf('fx', 'retry')
  const rows: PriorOutcome[] = [
    { sourceKey: k1, sourceArticleId: 'term', atMs: 1, stage: 'judge', state: 'terminal' },
    { sourceKey: k2, sourceArticleId: 'retry', atMs: 1, stage: 'draft', state: 'retryable' },
  ]
  const concluded = concludedSourceKeys(rows)
  check('🔴 terminal 은 결론(다시 고르지 않는다) · retryable 은 결론이 아니다(재시도 자리에서만)',
    concluded.has(k1) && !concluded.has(k2) && attemptedOutcomes(rows).has(k2)
    && (CONCLUDED_STATES as readonly string[]).includes('terminal') && !(CONCLUDED_STATES as readonly string[]).includes('retryable'))
  const judge = strip('scripts/micro-seed-auto-judge.mts')
  check('🔴 판정 성공 캐시 — 같은 원천 · 같은 입력은 캐시 hit(유료 0) · 실패는 캐시하지 않는다(retryable 만 다시)',
    /if \(c !== undefined\) \{\s*hit \+= 1/.test(judge) && /if \(outcome\.status === 'ok'\) \{\s*cache\.set/.test(judge)
    && /if \(!isRetryable\(lastStatus\)\) break/.test(judge))
  const ws = strip('src/lib/supply-workset.ts')
  check('🔴 묶음 선택이 큐 · 글 · 이월 · 결론 원천을 뺀다 — 같은 원문으로 두 번째 유료 생성 없음',
    /hasSource\(input\.queuedSources, r\.sourceSite, r\.sourceArticleId\)\) \{ dropped\.alreadyQueued/.test(ws)
    && /hasSource\(input\.carriedOver, r\.sourceSite, r\.sourceArticleId\)\) \{ dropped\.carriedOver/.test(ws)
    && /input\.concluded\.has\(K\(r\)\)\) \{ dropped\.terminal/.test(ws))
}

console.log('\n⑦ 장부 · 묶음 · 기회 스냅샷 손상 → 모름')
{
  check('🔴 장부 하루라도 손상(null) → 합계 모름 · 파일 없는 날(빈 장부)은 0',
    pooledEntries([[], null]) === null && pooledEntries([[], []])?.length === 0 && pooledEntries([]) === null)
  const dir = mkdtempSync(join(tmpdir(), 'jit-'))
  try {
    const from0 = Date.parse('2026-10-02T15:00:00Z')
    const to0 = Date.parse('2026-10-03T15:00:00Z')
    // 🔴 옛 판(v2)만 있으면 손상은 아니지만 JIT 근거가 없다 → null (옵션 칸으로 옛 묶음을 새 증거로 세지 않는다)
    writeFileSync(join(dir, worksetFileName('20261003-011500')), JSON.stringify({
      kind: WORKSET_KIND, version: WORKSET_VERSION, runId: '20261003-011500', takenAt: '2026-10-03T01:15:00.000Z', limit: 10,
      sources: Array.from({ length: 10 }, (_, i) => ({ sourceSite: 'fx', sourceArticleId: `old-${i}`, slotAt: '2026-10-03T03:00:00.000Z', ageAtSlotH: 3 })),
    }))
    check('🔴 🔴 legacy(v2) 묶음만 있으면 JIT 원천 수 모름(null) — optional 칸이 있어도 v2 는 근거가 아니다',
      worksetSourcesIn(dir, from0, to0) === null)
    const w = (runId: string, n: number): void => writeFileSync(join(dir, worksetFileName(runId)), JSON.stringify({
      kind: WORKSET_KIND, version: WORKSET_VERSION_JIT, contract: SUPPLY_JIT_CONTRACT, runId, takenAt: '2026-10-03T03:15:00.000Z', limit: 10,
      sources: Array.from({ length: n }, (_, i) => ({
        sourceSite: 'fx', sourceArticleId: `${runId}-${i}`, slotAt: '2026-10-03T05:00:00.000Z', ageAtSlotH: 4,
      })),
    }))
    w('20261003-031500', 10)
    w('20261003-091500', 10)
    const from = Date.parse('2026-10-02T15:00:00Z')
    const to = Date.parse('2026-10-03T15:00:00Z')
    check('🔴 JIT 묶음 2개 + legacy 1개 → JIT 원천 20 만', worksetSourcesIn(dir, from, to) === 20)
    writeFileSync(join(dir, worksetFileName('20261003-121500')), '{ 손상')
    check('🔴 🔴 창 안 묶음 하나 손상 → 원천 수 모름(null) — 손상 파일을 빼고 20 으로 세지 않는다',
      worksetSourcesIn(dir, from, to) === null)
    const snap = (runId: string, body: string): void => writeFileSync(join(dir, opportunitiesFileName(runId)), body)
    snap('20261003-031500', JSON.stringify({ kind: 'supply-opportunities', version: 'opportunities-v1', runId: '20261003-031500',
      takenAt: '2026-10-03T03:15:00.000Z', slotAt: '2026-10-03T03:00:00.000Z', evidence: [] }))
    check('🔴 기회 스냅샷 정상 → 읽힌다', latestOpportunities(dir, NOW.getTime()).evidence?.length === 0)
    snap('20261003-131500', '{ 손상')
    check('🔴 🔴 가장 최근 기회 스냅샷 손상 → 모름(null) — 더 오래된 스냅샷으로 내려가지 않는다',
      latestOpportunities(dir, NOW.getTime()).evidence === null)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

console.log('\n⑧ 비용 귀속 — 원천 해시로 연결된 비용만 결과당 단가')
{
  const e = (key: string | null, usd: number | null, status: LedgerEntry['status'] = 'settled'): LedgerEntry => ({
    runId: '20261004-031500-j', stage: 'judge', attemptId: `${key}-${usd}-${status}-${Math.random()}`, requestNo: 0, provider: 'google',
    apiModelId: 'm', model: 'm', status, blockCode: null, countedInputTokens: null, maxOutputTokens: 1, reservedUsd: 0.01,
    inputTokens: null, outputTokens: null, cacheWriteTokens: null, cacheReadTokens: null, usageKeys: [], settledUsd: usd,
    pricingVersion: null, startedAt: '', endedAt: null, errorCode: null, ...(key === null ? {} : { sourceKey: key }),
    supplyContract: SUPPLY_JIT_CONTRACT,
  })
  /** 🔴 계약 표식 없는 옛 장부 줄 */
  const legacyLine = (usd: number): LedgerEntry => ({ ...e(null, usd), supplyContract: undefined })
  /** 🔴 이 cohort 의 회차 — 장부 줄 `20261004-031500-j` 의 파이프라인 회차 */
  const COHORT: ReadonlySet<string> = new Set(['20261004-031500'])
  const hp = articleIdHashOf('fx', 'pub')
  const hs = articleIdHashOf('fx', 'sch')
  const hl = articleIdHashOf('fx', 'lost')
  const fateByKey = new Map<string, CostFate>([[hp, 'published'], [hs, 'scheduled'], [hl, 'lost']])
  const linked = costAttributionOf({
    entries: [e(hp, 0.02), e(hs, 0.02), e(hl, 0.02), e(articleIdHashOf('fx', 'hold'), 0.04)],
    fateByKey, counts: { published: 1, scheduled: 1 }, cohortRuns: COHORT,
  })
  check('🔴 연결 완전 — slot-valid 결과 2 · 전 비용 $0.10 → $0.05/결과 · 낭비 $0.02 · READY 못 된 원천 $0.04',
    linked !== null && Math.abs((linked.usdPerSlotValidResult ?? 0) - 0.05) < 1e-12
    && Math.abs((linked.wasteUsd ?? 0) - 0.02) < 1e-12 && Math.abs((linked.noReadyUsd ?? 0) - 0.04) < 1e-12
    && linked.usdPerPublished === null, JSON.stringify(linked))
  const unlinked = costAttributionOf({ entries: [e(hp, 0.02), e(null, 0.03)], fateByKey, counts: { published: 1, scheduled: 0 }, cohortRuns: COHORT })
  check('🔴 🔴 원천 해시 없는 정산이 있으면 결과당 · 공개당 단가 · 낭비 모름(null) — raw 단가로 대신하지 않는다',
    unlinked !== null && unlinked.usdPerSlotValidResult === null && unlinked.usdPerPublished === null
    && unlinked.wasteUsd === null && unlinked.unlinkedUsd === 0.03, JSON.stringify(unlinked))
  const open = costAttributionOf({ entries: [e(hp, 0.02), e(hp, null, 'reserved')], fateByKey, counts: { published: 1, scheduled: 0 }, cohortRuns: COHORT })
  check('🔴 정산 안 된 유료 요청이 있으면 공개당 단가(정확값)는 모른다 · 미정산 1건으로 센다', open !== null && open.openRequests === 1 && open.usdPerPublished === null)
  // 🔴 2026-10-04 운영 모양 — 창 안 공급 장부가 계약 표식 없는 옛 줄 $0.939 뿐
  const legacyOnly = costAttributionOf({ entries: [legacyLine(0.5), legacyLine(0.439)], fateByKey, counts: { published: 5, scheduled: 0 }, cohortRuns: COHORT })
  check('🔴 🔴 옛 장부 $0.939 만 → legacy $0.939 · 결과당 비용 모름(null)',
    legacyOnly !== null && Math.abs(legacyOnly.legacyUsd - 0.939) < 1e-12 && legacyOnly.usdPerSlotValidResult === null, JSON.stringify(legacyOnly))
  const legacyFacts: PreflightFacts = {
    slotValidOpportunities: 5,
    readyCohort: { sources: 160, published: 5, lost: 0, scheduled: 0, unknown: 9, usdPerSlotValidResult: legacyOnly?.usdPerSlotValidResult ?? null },
    latencyP50H: 20, latencyP90H: 40, contractValidPersonas: 24,
    commentUsdPerRequest: 0.001, commentDailyUsdCap: 0.2, auditUsdPerCall: 0.005, auditDailyUsdCap: 0.3,
    supplyDailyUsdCap: 0.5, runnerHealth: 'ok',
  }
  const lv = judgeNextPreflight('d5', legacyFacts, RUNNER_GRID)
  check('🔴 🔴 **옛 장부 $0.939 만 있는 상태 → SUPPLY_COST_UNKNOWN (SUPPLY_COST_SHORT 아님 · raw 단가 authority 없음)**',
    lv.codes.includes('SUPPLY_COST_UNKNOWN') && !lv.codes.includes('SUPPLY_COST_SHORT') && !('rawReadyUsd' in lv.counts),
    JSON.stringify(lv.codes))
  // 🔴 B — legacy + 완전 연결 현재 계약 → 현재 계약 표본만으로 단가(legacy 는 보고만 · 분자에 없음)
  const mixed = costAttributionOf({
    entries: [e(hp, 0.02), e(hs, 0.02), e(hl, 0.02), legacyLine(0.939), { ...legacyLine(0.5), status: 'reserved', settledUsd: null }],
    fateByKey, counts: { published: 1, scheduled: 1 }, cohortRuns: COHORT,
  })
  check('🔴 🔴 **B legacy $0.939 + 완전 연결 현재 계약 $0.06 → 결과 2 → $0.03/결과 (legacy 는 분자 · 차단 모두 아님)**',
    mixed !== null && Math.abs((mixed.usdPerSlotValidResult ?? 0) - 0.03) < 1e-12 && Math.abs(mixed.totalUsd - 0.06) < 1e-12
    && Math.abs(mixed.legacyUsd - 0.939) < 1e-12 && mixed.legacyOpenRequests === 1 && mixed.openRequests === 0, JSON.stringify(mixed))
  // 🔴 C — 미연결 · 미정산은 모름. 결말 모름 비용은 확인된 결과만 분모에 둔 보수적 상한에 포함한다.
  const cUnlinked = costAttributionOf({ entries: [e(hp, 0.02), e(null, 0.01)], fateByKey, counts: { published: 1, scheduled: 0 }, cohortRuns: COHORT })
  const cOpen = costAttributionOf({ entries: [e(hp, 0.02), e(hp, null, 'reserved')], fateByKey, counts: { published: 1, scheduled: 0 }, cohortRuns: COHORT })
  const hu = articleIdHashOf('fx', 'unk')
  const cUnknown = costAttributionOf({
    entries: [e(hp, 0.02), e(hu, 0.01)], fateByKey: new Map([...fateByKey, [hu, 'unknown']]), counts: { published: 1, scheduled: 0 }, cohortRuns: COHORT,
  })
  check('🔴 🔴 **C 현재 계약 미연결 · 미정산 → 결과당 비용 모름**',
    cUnlinked?.usdPerSlotValidResult === null && cOpen?.usdPerSlotValidResult === null)
  // ── 🔴 (2026-10-09) 추정 예약액은 실제 비용도 그 한계도 아니다 — 미정산이 하나라도 있으면 단가를 확정하지 않는다 ──
  check('🔴 🔴 **예약 있는 미정산(reserved) → 단가 null · 미정산 1건 · 추정 예약액 $0.01 은 보고만(분자 $0.02 그대로)**',
    cOpen !== null && cOpen.usdPerSlotValidResult === null && cOpen.openRequests === 1
    && Math.abs(cOpen.openReservedUsd - 0.01) < 1e-12 && Math.abs(cOpen.totalUsd - 0.02) < 1e-12, JSON.stringify(cOpen))
  const uu = { ...e(hl, null, 'usageUnknown'), reservedUsd: 0.0086 }
  const cUu = costAttributionOf({ entries: [e(hp, 0.02), uu], fateByKey, counts: { published: 1, scheduled: 0 }, cohortRuns: COHORT })
  check('🔴 🔴 **예약 있는 usageUnknown(2026-10-08 모양) → 단가 null · 낭비 모름 · 장부 줄 상태는 usageUnknown 그대로**',
    cUu !== null && cUu.usdPerSlotValidResult === null && cUu.wasteUsd === null && Math.abs(cUu.openReservedUsd - 0.0086) < 1e-12
    && uu.status === 'usageUnknown' && uu.settledUsd === null, JSON.stringify(cUu))
  const noRes = costAttributionOf({ entries: [e(hp, 0.02), { ...e(hl, null, 'usageUnknown'), reservedUsd: null }], fateByKey, counts: { published: 1, scheduled: 0 }, cohortRuns: COHORT })
  check('🔴 🔴 **예약 없는 usageUnknown → 단가 null · 추정 예약액 0**', noRes !== null && noRes.usdPerSlotValidResult === null
    && noRes.openRequests === 1 && noRes.openReservedUsd === 0, JSON.stringify(noRes))
  const badRun = costAttributionOf({ entries: [e(hp, 0.02), { ...e(hp, null, 'usageUnknown'), runId: 'manual-x' }], fateByKey, counts: { published: 1, scheduled: 0 }, cohortRuns: COHORT })
  check('🔴 회차 id 를 읽을 수 없는 현재 계약 미정산 → 이 cohort 를 막는다 → null', badRun !== null && badRun.usdPerSlotValidResult === null && badRun.openRequests === 1)
  const otherRun = costAttributionOf({ entries: [e(hp, 0.02), { ...e(hp, null, 'usageUnknown'), runId: '20261001-031500-d' }], fateByKey, counts: { published: 1, scheduled: 0 }, cohortRuns: COHORT })
  check('🔴 다른 cohort 회차의 미정산은 이 cohort 를 막지 않는다', otherRun !== null && otherRun.openRequests === 0
    && Math.abs((otherRun.usdPerSlotValidResult ?? 0) - 0.02) < 1e-12)
  // 🔴 실제 정산이 예약을 넘을 수 있다(overran) — 분자는 실제 정산액이다. 예약을 한계로 쓰면 과소평가한다
  const over = judgeSettle({ reservedUsd: 0.01, cost: { known: true, usd: 0.03 } as never })
  const cOver = costAttributionOf({ entries: [{ ...e(hp, over.settledUsd), reservedUsd: 0.01 }], fateByKey, counts: { published: 1, scheduled: 0 }, cohortRuns: COHORT })
  check('🔴 🔴 **실제 정산 $0.03 > 추정 예약 $0.01 (overran) — 정산 계약 그대로 · 분자는 실제 $0.03**',
    over.status === 'settled' && over.overran && over.settledUsd === 0.03 && cOver !== null && Math.abs((cOver.usdPerSlotValidResult ?? 0) - 0.03) < 1e-12)
  const unkV = judgeNextPreflight('d5', {
    slotValidOpportunities: 5, readyCohort: { sources: 10, published: 5, lost: 0, scheduled: 0, unknown: 0, usdPerSlotValidResult: cUu?.usdPerSlotValidResult ?? null },
    latencyP50H: 20, latencyP90H: 40, contractValidPersonas: 24,
    commentUsdPerRequest: 0.001, commentDailyUsdCap: 0.2, auditUsdPerCall: 0.005, auditDailyUsdCap: 0.3, supplyDailyUsdCap: 0.5, runnerHealth: 'ok',
  }, RUNNER_GRID)
  check('🔴 🔴 **예약 있는 usageUnknown 이 cohort 에 있으면 preflight 는 SUPPLY_COST_UNKNOWN (SHORT · PASS 아님)**',
    unkV.codes.includes('SUPPLY_COST_UNKNOWN') && !unkV.codes.includes('SUPPLY_COST_SHORT'), JSON.stringify(unkV.codes))
  check('🟢 결말 모름 $0.01도 분자에 포함 — 전체 $0.03 ÷ 확인 결과 1 = 보수적 상한 $0.03',
    cUnknown !== null && Math.abs((cUnknown.usdPerSlotValidResult ?? 0) - 0.03) < 1e-12
    && Math.abs(cUnknown.byFate.unknown - 0.01) < 1e-12, JSON.stringify(cUnknown))
  const currentShapeCost = costAttributionOf({
    entries: [e(hp, 0.0147585), e(hs, 0.030907), e(hl, 0.010834), e(hu, 0.0500965), e(articleIdHashOf('fx', 'no-ready'), 0.113595)],
    fateByKey: new Map([...fateByKey, [hu, 'unknown']]), counts: { published: 1, scheduled: 3 }, cohortRuns: COHORT,
  })
  const currentShape = judgeNextPreflight('d5', {
    slotValidOpportunities: 5,
    readyCohort: {
      sources: 42, published: 1, lost: 1, scheduled: 3, unknown: 4,
      usdPerSlotValidResult: currentShapeCost?.usdPerSlotValidResult ?? null,
    },
    latencyP50H: 57.14, latencyP90H: 70.59, contractValidPersonas: 24,
    commentUsdPerRequest: 0.001, commentDailyUsdCap: 0.2, auditUsdPerCall: 0.005, auditDailyUsdCap: 0.3,
    supplyDailyUsdCap: 0.5, runnerHealth: 'ok',
  }, RUNNER_GRID)
  check('🟢 운영 모양 — 전체 $0.220191 ÷ 확인 결과 4 × D5 = $0.27523875, 비용 UNKNOWN·SHORT 아님',
    currentShapeCost !== null && Math.abs((currentShapeCost.usdPerSlotValidResult ?? 0) - 0.05504775) < 1e-12
    && !currentShape.codes.includes('SUPPLY_COST_UNKNOWN') && !currentShape.codes.includes('SUPPLY_COST_SHORT'),
    JSON.stringify({ cost: currentShapeCost, verdict: currentShape }))
  check('🔴 현재 계약 정산 0 · slot-valid 결과 0 → 모름',
    costAttributionOf({ entries: [e(hp, 0)], fateByKey, counts: { published: 1, scheduled: 0 }, cohortRuns: COHORT })?.usdPerSlotValidResult === null
    && costAttributionOf({ entries: [e(hl, 0.02)], fateByKey, counts: { published: 0, scheduled: 0 }, cohortRuns: COHORT })?.usdPerSlotValidResult === null)
  // 🔴 cohort 불변식 — 현재 계약이어도 다른 cohort 회차(창 밖 묶음)의 정산은 이 cohort 분자가 아니다
  const other = costAttributionOf({
    entries: [e(hp, 0.02), e(hs, 0.02), { ...e(hp, 0.5), runId: '20261001-031500-d' }],
    fateByKey, counts: { published: 1, scheduled: 1 }, cohortRuns: COHORT,
  })
  check('🔴 🔴 **다른 cohort 회차(창 밖 묶음) 현재 계약 정산 $0.50 은 분자에서 빠진다 — $0.04 / 결과 2 = $0.02 · otherCohortUsd 보고**',
    other !== null && Math.abs((other.usdPerSlotValidResult ?? 0) - 0.02) < 1e-12 && Math.abs(other.otherCohortUsd - 0.5) < 1e-12
    && Math.abs(other.totalUsd - 0.04) < 1e-12, JSON.stringify(other))
  check('🔴 회차 id 를 읽을 수 없는 현재 계약 줄 → 미연결 → 결과당 비용 모름',
    costAttributionOf({ entries: [e(hp, 0.02), { ...e(hp, 0.01), runId: 'manual' }], fateByKey, counts: { published: 1, scheduled: 0 }, cohortRuns: COHORT })
      ?.usdPerSlotValidResult === null)
  check('🔴 장부 회차 → 파이프라인 회차는 ledgerRunIdOf 의 역',
    pipelineRunOfLedger(ledgerRunIdOf('20261004-031500', 'judge')) === '20261004-031500'
    && pipelineRunOfLedger(ledgerRunIdOf('20261004-031500', 'draft')) === '20261004-031500' && pipelineRunOfLedger('r') === null)
  check('🔴 장부를 못 읽으면 귀속 자체가 null', costAttributionOf({ entries: null, fateByKey, counts: { published: 1, scheduled: 0 }, cohortRuns: COHORT }) === null)
  check('🔴 결말 → 비용 결말: 공개 · 만료 · 대기 결말 그대로',
    costFateOf({ id: 'a', status: 'PUBLISHED', hash: null, fate: null }) === 'published'
    && costFateOf({ id: 'b', status: 'DECLINED', hash: null, fate: null }) === 'lost'
    && costFateOf({ id: 'c', status: 'APPROVED', hash: null, fate: 'scheduled' }) === 'scheduled'
    && costFateOf({ id: 'd', status: 'APPROVED', hash: null, fate: null }) === 'unknown')
  check('🔴 장부 원천 열쇠 = 증거 기록 provenance.articleIdHash 와 같은 식 — 원문 · id 평문 아님',
    articleIdHashOf('fx', 'pub') === (buildSourceEvidence({ sourceSite: 'fx', sourceArticleId: 'pub' }).provenance.articleIdHash)
    && /^[0-9a-f]{64}$/.test(hp))
}

console.log('\n⑧-b 🔴 공급 의도 연결 — 큐 의도 = 그 회차 workset-v3 의도 = 원문 증거 해시')
{
  const hash = articleIdHashOf('fx', 'k1')
  const ok: SupplyIntent = { contract: SUPPLY_JIT_CONTRACT, runId: '20261004-031500', sourceHash: hash, intendedSlotAt: '2026-10-04T02:00:00.000Z', ageAtSlotH: 7.5 }
  check('🔴 F 완전 일치 → 이유 없음', intentLinkIssue({ intent: ok, evidenceHash: hash, runInCohort: true, workset: ok }) === null)
  const cases: [string, Parameters<typeof intentLinkIssue>[0], string][] = [
    ['run', { intent: ok, evidenceHash: hash, runInCohort: true, workset: { ...ok, runId: '20261004-091500' } }, 'RUN_MISMATCH'],
    ['hash', { intent: ok, evidenceHash: hash, runInCohort: true, workset: { ...ok, sourceHash: articleIdHashOf('fx', 'k2') } }, 'SOURCE_HASH_MISMATCH'],
    ['slot', { intent: ok, evidenceHash: hash, runInCohort: true, workset: { ...ok, intendedSlotAt: '2026-10-04T04:00:00.000Z' } }, 'SLOT_MISMATCH'],
    ['age', { intent: ok, evidenceHash: hash, runInCohort: true, workset: { ...ok, ageAtSlotH: 7.6 } }, 'AGE_MISMATCH'],
    ['증거 해시', { intent: ok, evidenceHash: articleIdHashOf('fx', 'other'), runInCohort: true, workset: ok }, 'EVIDENCE_HASH_MISMATCH'],
    ['같은 cohort 회차 묶음에 그 원천 없음', { intent: ok, evidenceHash: hash, runInCohort: true, workset: null }, 'WORKSET_NOT_FOUND'],
    ['창 밖 회차(파일이 정상이어도)', { intent: ok, evidenceHash: hash, runInCohort: false, workset: ok }, 'WORKSET_OUTSIDE_COHORT'],
    ['모양 틀림', { intent: null, evidenceHash: hash, runInCohort: true, workset: ok }, 'INTENT_MALFORMED'],
  ]
  for (const [name, input, want] of cases) {
    check(`🔴 E ${name} 불일치 → ${want}`, intentLinkIssue(input) === want, String(intentLinkIssue(input)))
  }
  check('🔴 계약을 주장한 칸은 모양이 틀려도 주장이다(legacy 로 빠지지 않는다) · 칸 없음 · 다른 계약은 주장 아님',
    claimsJitContract({ supplyIntent: { contract: SUPPLY_JIT_CONTRACT, runId: 1 } }) && !claimsJitContract({})
    && !claimsJitContract({ supplyIntent: { contract: 'other' } }) && !claimsJitContract(null))
  const facts = strip('scripts/lib/stage-preflight-facts.mts')
  check('🔴 cohort 판독이 계약 주장 행을 그 회차 묶음(readWorkset) · 증거 해시로 대조하고, 하나라도 틀리면 cohort 전체를 모름',
    /const claimed = autoPath\.filter\(\(r\) => claimsJitContract\(r\.gateResults\)\)/.test(facts)
    && /intentLinkIssue\(\{/.test(facts) && /if \(intentMismatches\.length > 0\) throw new IntentMismatch\(\)/.test(facts)
    && /const run = intent === null \? undefined : ws\?\.byRun\.get\(intent\.runId\)/.test(facts)
    && /runInCohort: run !== undefined,/.test(facts)
    && (facts.match(/readWorkset\(/g) ?? []).length === 1 && !/function parseWorkset|runIntentsOf/.test(facts))
  check('🔴 🔴 cohort 불변식 — 큐 결과 · worksetSources · 현재 계약 비용이 같은 창 묶음 회차 집합 하나에서 나온다',
    /cohortRuns: new Set\(ws\?\.byRun\.keys\(\) \?\? \[\]\)/.test(facts)
    && /const worksetSources = ws\?\.sources \?\? null/.test(facts)
    && /costAttributionOf\(\{ entries: supplyEntries, fateByKey, counts: fates, cohortRuns: cohort\.cohortRuns \}\)/.test(facts))
}

console.log('\n⑨ 배선 · 발행 시점 재검사 (소스 잠금)')
{
  const runner = strip('scripts/supply-process.mts')
  check('🔴 러너 유료 묶음 = paidSourcesFor(부족분 · 결말 수율 상한) — 고정 WORKSET_LIMIT 로 판정 · 생성하지 않는다',
    /const paid = paidSourcesFor\(\{ deficit: policy\.upTo, yieldHigh: before\?\.sourceYield\?\.high \?\? null, cap: WORKSET_LIMIT \}\)/.test(runner)
    && /judgeStageBudget\(PAID_LIMIT\)/.test(runner) && /intendedSlotOf,\s*limit: PAID_LIMIT, runId, takenAt: runAt,/.test(runner)
    && !/judgeStageBudget\(WORKSET_LIMIT\)/.test(runner) && !/limit: WORKSET_LIMIT, runId/.test(runner))
  check('🔴 묶음은 수요가 있을 때만 만든다(policy.llm) — 수요 0 이면 판정 · 생성 0',
    /if \(policy\.llm\) \{\s*const assigned = assignSourceSlots\(\{\s*rows: worksetEligibility\(eligibilityInput\)\.eligible, slots: unfilledSlots, now: RUN_AT, cap: PAID_LIMIT,/.test(runner)
    && /const plan = selectWorkset\(/.test(runner))
  check('🔴 🔴 원천은 부족 슬롯 각각의 시각에 판정 — 배정 슬롯에서 다시 판정 · nextSlotAt 하나로 모두 판정하지 않는다',
    /: \(before\?\.jit\?\.unfilled \?\? \[\]\)/.test(runner)
    && /return d === null \? releaseOf\(r\) : preGenerationRelease\(r, d, RUN_AT\)/.test(runner)
    && !/preGenerationRelease\(r, nextSlotAt, RUN_AT\)/.test(runner))
  check('🔴 러너 수율은 preflight 와 같은 판독(readReadyCohort) · 같은 짝짓기 열쇠(jit.matched)',
    /readReadyCohort\(prisma, \{/.test(runner) && /matched: new Set\(jit\.matched\), horizon: jit\.horizon/.test(runner))
  const facts = strip('scripts/lib/stage-preflight-facts.mts')
  check('🔴 🔴 cohort 는 현재 JIT 계약 행만(gateResults.supplyIntent) — legacy READY 는 수율 · 손실 근거가 아니다',
    /const claimed = autoPath\.filter\(\(r\) => claimsJitContract\(r\.gateResults\)\)/.test(facts)
    && /rows = counted\.map\(/.test(facts) && /if \(r\.intents === null\) continue/.test(facts))
  check('🔴 🔴 cohort 시계는 회차 하나 — 분자를 decidedAt 창으로 자르지 않고 의도 runId ∈ 창 안 묶음 회차로 고른다 (2026-10-09 P0)',
    /where: \{ createdAt: \{ gte: i\.windowFrom \} \}/.test(facts) && !/decidedAt: \{ gte: i\.windowFrom/.test(facts)
    && /return intent === null \|\| ws\?\.byRun\.has\(intent\.runId\) === true/.test(facts)
    && /fate: terminal \? null : !stamped \? 'unknown' : pendingFateOf\(\{/.test(facts))
  check('🔴 🔴 미도장 기계 행은 정본 eligibilityOf 로만 나눈다 — 자동 부적격은 분자 제외 · 제외 수를 사실로 보고 · 분모는 묶음 원천 그대로 (2026-10-09 P0-a)',
    /const counted = current\.filter\(\(r\) => r\.decidedBy === AUTO_DECIDER \|\| autoEligible\(r\)\)/.test(facts)
    && /eligibilityOf\(\{\s*gateVerdict: r\.gateVerdict, gateResults: r\.gateResults,/.test(facts)
    && /autoIneligibleExcluded = current\.length - counted\.length/.test(facts)
    && /const worksetSources = ws\?\.sources \?\? null/.test(facts))
  check('🔴 preflight 도 같은 판독 · 원천 기회 할인은 결말 수율 구간(raw yieldOf 없음)',
    /const cohort = await readReadyCohort\(prisma, \{/.test(facts) && /oppAt\(yieldBounds\?\.low \?\? null\)/.test(facts)
    && !/export function yieldOf/.test(facts))
  const judge = strip('scripts/micro-seed-auto-judge.mts')
  const draft = strip('scripts/micro-seed-auto-draft.mts')
  check('🔴 판정 · 생성 장부 줄이 원천 해시를 싣는다(articleIdHashOf)',
    /maxOutputTokens: JUDGE_MAX_TOKENS, timeoutMs: JUDGE_TIMEOUT_MS, \.\.\.cost,/.test(judge) && /articleIdHashOf\(t\.sourceSite!/.test(judge)
    && /supplyContract: ik === null \? null : INTENTS\?\.get\(ik\)\?\.contract \?\? null/.test(judge)
    && /timeoutMs: DRAFT_TIMEOUT_MS, sourceKey: COST_KEY, supplyContract: COST_CONTRACT,/.test(draft) && /COST_KEY = S\(j\.sourceSite\)/.test(draft)
    && /COST_CONTRACT = ik === null \? null : RUN_INTENTS\?\.get\(ik\)\?\.contract \?\? null/.test(draft))
  const tx = strip('src/lib/original-post-publish-tx.ts')
  check('🔴 발행 시점 재검사 유지 — 발행 트랜잭션이 그 시각에 정본 판정 · eligible 아니면 EXPIRED',
    /judgeSlotRelease\(\{\s*gateResults: row\.gateResults, slotAt: txNow, now: txNow,/.test(tx)
    && /if \(release\.verdict !== 'eligible'\) \{/.test(tx) && /status: 'EXPIRED', declineReason: `RELEASE_EXPIRED:/.test(tx))
  const fate = strip('src/lib/ready-fate.ts')
  check('🔴 대기 결말 분류는 정본 judgeSlotRelease 하나 — 새 점수 · 가중치 없음',
    (fate.match(/judgeSlotRelease\(/g) ?? []).length === 1 && !/score|weight/i.test(fate))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 DB 0 · 네트워크 0 · provider 0 · 임시 파일만(정리함).')
if (fail > 0) process.exit(1)
