#!/usr/bin/env tsx
/**
 * 🔴 **D100 Batch D1 신선도 replay — 변경 전 · 후를 같은 운영 artifact 로 다시 돌린다** (2026-10-13)
 *
 *   npm run d100:freshness-replay -- --data-dir=<운영 .microseed-data 사본> [--from=ISO] [--to=ISO] [--json=<경로>]
 *
 * 🔴 **읽기만 한다.** DB 0 · 네트워크 0 · provider 0 · env · launchd · stage 0. 파일 write 는 `--json` 을 줄 때 그 경로 하나뿐이다.
 *    원문 제목 · 본문 · URL · 닉네임을 출력하지 않는다 — 수 · 시각 · 사유 코드만.
 *
 * 무엇을 다시 돌리나 (기본 창 = 선택 trace 가 있는 회차 전부):
 *   A. **공급 선택** — 회차마다 그 회차 시각의 목록 관측 · 상세 파일로 `worksetRows` → `selectWorkset({ jit })` 를
 *      전(날짜만 아는 줄을 옛 수집기처럼 그날 00:00 으로 읽음) · 후(지금 코드) 두 번 부른다.
 *      모집단은 그 회차 trace 에서 **DB 상태로 빠진 원천(큐 · 형제 · 사람 판정 · 끝남 · 이월)을 뺀** 원천이다.
 *      🔴 재시도 예약(attempted)은 재현하지 않는다 — 두 모드 모두 비운다(차이만 본다).
 *   B. **수집 상세 선별** — 네이버 회차 목록마다 `planAutoFetch` 를 앞판 동률(점수 → 글 번호 오름차순) · 지금 동률
 *      (점수 → 게시 시각 하한 ↓ → 글 번호 ↓)로 고른다. 상한은 회차 계획(`planCafeRun`)의 게시판 상세 몫.
 *      "이미 본 글" 은 그 회차 전 thin 파일의 글로 근사한다(상세 원장은 사본에 없을 수 있다).
 *   C. **참고(운영 미적용)** — 공급 순위에서 품질 성분이 정확히 같아 나이가 순서를 정한 이웃 쌍 수.
 *      품질 경계(창업자 결정 대기)를 정하는 재료일 뿐 · 이 replay 는 어떤 경계도 운영에 넣지 않는다.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  articleIdHashOf, compareReleaseRank, kstDayOfWindow, SOURCE_STATS_METHOD, SOURCE_STATS_METHOD_DAY, type SlotReleaseVerdict,
} from '../src/lib/source-slot-release'
import {
  EMPTY_HUMAN_DECISIONS, EMPTY_SOURCE_KEYS, preGenerationRelease, selectWorkset, type WorksetRow,
} from '../src/lib/supply-workset'
import { articleKeyOf, readListObservations, postedOfListRow, type ListObservationIndex } from './lib/source-list-observations.mjs'
import { worksetRows } from './supply-process.mjs'
import { planAutoFetch, type AutoFetchInput } from './lib/micro-seed-supply.mjs'
import { selectionScore, type QualityAssessment } from './lib/micro-seed-quality.mjs'
import { currentQualityContract } from '../src/lib/quality-contract'
import { thresholdBasis, type CollectedCandidate } from './lib/micro-seed-navercafe.mjs'
import { planCafeRun } from './lib/navercafe-run-plan.mjs'

const H = 3_600_000
const arg = (k: string): string | null => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`))
  return a === undefined ? null : a.slice(k.length + 3)
}
const DATA = arg('data-dir') ?? '.microseed-data'
const FROM = arg('from')
const TO = arg('to')
const JSON_OUT = arg('json')

const names = readdirSync(DATA).sort()
const runOf = (name: string): string | null => /(\d{8}-\d{6})/.exec(name)?.[1] ?? null
/** 회차 id(UTC `YYYYMMDD-HHMMSS`) → ms */
const runMs = (run: string): number =>
  Date.parse(`${run.slice(0, 4)}-${run.slice(4, 6)}-${run.slice(6, 8)}T${run.slice(9, 11)}:${run.slice(11, 13)}:${run.slice(13, 15)}Z`)
const inWindow = (ms: number): boolean => (FROM === null || ms >= Date.parse(FROM)) && (TO === null || ms <= Date.parse(TO))
const median = (xs: readonly number[]): number | null => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
const r1 = (x: number | null): string => (x === null ? '—' : (Math.round(x * 10) / 10).toFixed(1))
const pct = (a: number, b: number): string => (b === 0 ? '—' : `${Math.round((a / b) * 1000) / 10}%`)

/**
 * 🔴 **"전" 모드 목록 관측** — 날짜만 아는 줄을 옛 수집기가 쓴 대로(그날 00:00 KST 를 정확한 시각으로) 되돌린다.
 *    지금 코드의 정확한 시각 경로는 앞판과 같다(`check:d100-freshness` ③④ 무작위 대조) — 그래서 이 되돌림이 곧 앞판이다.
 */
function legacyIndex(idx: ListObservationIndex): ListObservationIndex {
  const back = <T extends { postedAt: string | null; postedWindow?: { from: string } | null }>(o: T): T =>
    (o.postedWindow ? { ...o, postedAt: o.postedWindow.from, postedWindow: null } : o)
  const sample = idx.sample.map(back)
  const byArticle = new Map([...idx.byArticle].map(([k, xs]) => [k, xs.map(back)]))
  return { ...idx, sample, byArticle }
}

// ─────────────────────────────────────────────────────────
// A. 공급 선택
// ─────────────────────────────────────────────────────────

type TraceCand = { sourceHash: string; axis: string; reason: string; selected: boolean }
type Trace = { runId: string; takenAt: string; cap: number; slots: string[]; candidates: TraceCand[] }
/** 🔴 DB 상태로 빠진 사유 — replay 가 재현할 수 없는 상태라 모집단에서 뺀다 */
const DB_STATE_REASONS = new Set(['ALREADY_QUEUED', 'QUEUE_SIBLING', 'HUMAN_DECIDED', 'TERMINAL', 'CARRIED_OVER'])
const detailFiles = names.filter((n) => /\.(raw-)?detail\.jsonl$/.test(n) && !n.includes('.thin-detail.'))

type Mode = 'before' | 'after'
type ModeOut = {
  linkable: number; picked: number; coveredSlots: number; maxFillable: number
  pickedDayOnly: number; pickedAgeH: number[]
  /** 날짜만 아는 원천의 첫 부족 슬롯 판정 */
  dayVerdicts: Record<string, number>
  freshnessDecidedPairs: number; poolPairs: number
  pickedHashes: string[]
}

/** 🔴 회차 × 원천 판정 — 모드별(전 · 후). 열쇠 `runId|hash` */
type RowVerdict = { isDay: boolean; verdict: string; reason: string; rank: string }
const perRow: Record<Mode, Map<string, RowVerdict>> = { before: new Map(), after: new Map() }
/** 🔴 "후" 증거 감사 — 날짜 판이 아닌 날짜 원천 · 회차/날짜 어긋남 · 00:00 정확 시각 저장 */
const audit = { dayEvidence: 0, dayWrongMethod: 0, dayCrossRunOrDay: 0, exactWrongMethod: 0, dayOnePoint: 0, dayEmpty: 0,
  postedAtWithWindow: 0, midnightExactFromDayLabel: 0, midnightExactTotal: 0 }
const supplyRuns: { runId: string; universe: number; dayOnlyInUniverse: number; unmatched: number; before: ModeOut; after: ModeOut; actualSelected: number; overlapBeforeActual: number }[] = []

for (const name of names.filter((n) => /^supply-selection-trace-\d{8}-\d{6}\.json$/.test(n))) {
  const t = JSON.parse(readFileSync(join(DATA, name), 'utf8')) as Trace
  const at = new Date(t.takenAt)
  if (!inWindow(at.getTime())) continue
  const slots = t.slots.map((s) => new Date(s))
  const universe = new Set(t.candidates.filter((c) => !DB_STATE_REASONS.has(c.reason)).map((c) => c.sourceHash))
  const actual = new Set(t.candidates.filter((c) => c.selected).map((c) => c.sourceHash))
  const files = detailFiles.filter((n) => { const r = runOf(n); return r !== null && runMs(r) <= at.getTime() }).map((n) => join(DATA, n))
  const idxAfter = readListObservations(DATA, at)
  const idxBefore = legacyIndex(idxAfter)
  const byMode: Partial<Record<Mode, ModeOut>> = {}
  let dayOnlyInUniverse = 0
  let unmatched = universe.size
  for (const mode of ['before', 'after'] as const) {
    const all = worksetRows(files, mode === 'after' ? idxAfter : idxBefore, at) ?? []
    const rows = all.filter((r) => universe.has(articleIdHashOf(r.sourceSite, r.sourceArticleId)))
    const dayKey = new Set(
      (mode === 'after' ? rows : (worksetRows(files, idxAfter, at) ?? []).filter((r) => universe.has(articleIdHashOf(r.sourceSite, r.sourceArticleId))))
        .filter((r) => r.evidence?.postedWindow).map((r) => articleIdHashOf(r.sourceSite, r.sourceArticleId)),
    )
    if (mode === 'after') {
      dayOnlyInUniverse = dayKey.size
      unmatched = universe.size - new Set(rows.map((r) => articleIdHashOf(r.sourceSite, r.sourceArticleId))).size
    }
    const releaseOf = (r: WorksetRow): SlotReleaseVerdict => {
      const d = slots.find((s) => preGenerationRelease(r, s, at).verdict === 'eligible')
      return preGenerationRelease(r, d ?? slots[0] ?? at, at)
    }
    const plan = selectWorkset({
      rows, humanDecided: EMPTY_HUMAN_DECISIONS, queuePending: new Set(), queuedSources: EMPTY_SOURCE_KEYS,
      carriedOver: EMPTY_SOURCE_KEYS, concluded: new Set(), attempted: new Map(), releaseOf,
      limit: t.cap, runId: t.runId, takenAt: at,
      jit: { slots, now: at, cap: t.cap, qualityContract: currentQualityContract() },
    })
    const picked = plan.workset.sources
    const pickedHashes = picked.map((s) => articleIdHashOf(s.sourceSite, s.sourceArticleId))
    const dayVerdicts: Record<string, number> = {}
    for (const r of rows) {
      if (slots.length === 0) continue
      const h = articleIdHashOf(r.sourceSite, r.sourceArticleId)
      const isDay = dayKey.has(h)
      const v = releaseOf(r)
      const k = v.verdict === 'eligible' ? 'eligible' : `${v.verdict}:${v.reasons[0] ?? ''}`
      perRow[mode].set(`${t.runId}|${h}`, { isDay, verdict: v.verdict, reason: v.reasons[0] ?? '', rank: JSON.stringify({ ...v.rank, tieBreak: '' }) })
      if (isDay) dayVerdicts[k] = (dayVerdicts[k] ?? 0) + 1
      if (mode !== 'after' || r.evidence === null) continue
      const ev = r.evidence
      const st = ev.sourceStats
      if (ev.postedAt !== null && ev.postedWindow) audit.postedAtWithWindow += 1
      if (ev.postedAt !== null && new Date(Date.parse(ev.postedAt) + 9 * H).toISOString().slice(11, 23) === '00:00:00.000') {
        audit.midnightExactTotal += 1
        // 🔴 수집이 본 목록 줄이 날짜만 말하는데 정확 시각 00:00 이 실렸다 — 0 이어야 한다
        const hit = (idxAfter.byArticle.get(articleKeyOf(r.sourceSite, r.sourceArticleId)) ?? []).find((o) => o.observedAt === ev.listedAt)
        if (hit?.postedWindow) audit.midnightExactFromDayLabel += 1
      }
      if (isDay) {
        audit.dayEvidence += 1
        if (st !== null) {
          if (st.method !== SOURCE_STATS_METHOD_DAY) audit.dayWrongMethod += 1
          else if (st.postedDay !== kstDayOfWindow(ev.postedWindow) || st.observedAt !== ev.response?.observedAt) audit.dayCrossRunOrDay += 1
          else if (st.n === 0) audit.dayEmpty += 1
          else if (st.commentsPct === null && st.viewsPct === null) audit.dayOnePoint += 1
        }
      } else if (st !== null && st.method !== SOURCE_STATS_METHOD) audit.exactWrongMethod += 1
    }
    // C. 참고 — 같은 기준 슬롯(첫 부족 슬롯)에서 eligible 인 seed 원천을 정본 순위로 세우고, 품질 성분이 정확히 같은 이웃 쌍
    const ranked = slots.length === 0 ? [] : rows
      .map((r) => preGenerationRelease(r, slots[0]!, at))
      .filter((v) => v.verdict === 'eligible')
      .map((v) => v.rank)
      .sort((a, b) => compareReleaseRank({ ...a, tieBreak: '' }, { ...b, tieBreak: '' }))
    let tied = 0
    for (let i = 1; i < ranked.length; i += 1) {
      const a = ranked[i - 1]!
      const b = ranked[i]!
      if (a.commentsPct === b.commentsPct && a.viewsPct === b.viewsPct && a.ageAtSlotH !== b.ageAtSlotH) tied += 1
    }
    byMode[mode] = {
      linkable: plan.jit?.linkable ?? 0, picked: picked.length, coveredSlots: plan.jit?.coveredSlots ?? 0,
      maxFillable: plan.jit?.maxFillableSlots ?? 0,
      pickedDayOnly: pickedHashes.filter((h) => dayKey.has(h)).length,
      pickedAgeH: picked.map((s) => s.ageAtSlotH ?? 0),
      dayVerdicts, freshnessDecidedPairs: tied, poolPairs: Math.max(0, ranked.length - 1), pickedHashes,
    }
  }
  const before = byMode.before!
  supplyRuns.push({
    runId: t.runId, universe: universe.size, dayOnlyInUniverse, unmatched,
    before, after: byMode.after!,
    actualSelected: actual.size, overlapBeforeActual: before.pickedHashes.filter((h) => actual.has(h)).length,
  })
}

// ─────────────────────────────────────────────────────────
// B. 수집 상세 선별
// ─────────────────────────────────────────────────────────

const legacyCompare = (a: AutoFetchInput, b: AutoFetchInput): number => b.score - a.score || a.sourceArticleId.localeCompare(b.sourceArticleId)
type CollectRun = {
  file: string; board: string; eligible: number; max: number
  changed: number; sameScores: boolean
  /** 고른 글의 목록 시점 원문 나이(h) — 게시 시각 하한 기준(날짜만 알면 늙은 끝) */
  ageBefore: number[]; ageAfter: number[]
  todayBefore: number; todayAfter: number
  /** 고른 글 중 게시 날짜만 아는 글 */
  dayOnlyBefore: number; dayOnlyAfter: number
  /** 충실도 — 그 회차 thin 산출(실제로 열고 남긴 글) 중 "전" 선별에 든 글 */
  actualThin: number; actualInBefore: number
}
const collectRuns: CollectRun[] = []
const listFiles = names.filter((n) => /^navercafe-[a-z0-9]+-\d{8}-\d{6}\.list\.jsonl$/.test(n))
const thinByRun = names.filter((n) => /^navercafe-thin-[a-z0-9]+-\d{8}-\d{6}\.thin-detail\.jsonl$/.test(n))
for (const name of listFiles) {
  const run = runOf(name)!
  if (!inWindow(runMs(run))) continue
  const cafe = /^navercafe-([a-z0-9]+)-/.exec(name)![1]!
  const rows = readFileSync(join(DATA, name), 'utf8').split('\n').filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as CollectedCandidate & Record<string, unknown>)
  if (rows.length === 0) continue
  const board = String(rows[0]!.sourceBoardKey ?? '')
  const plan = planCafeRun({ cafeId: cafe })
  const max = plan.boards.find((b) => b.key === board)?.detailMax ?? 0
  if (max === 0) continue
  // 🔴 "이미 본 글" 근사 — 이 회차 전 같은 카페 thin 파일의 글
  const seen = new Set<string>()
  const actualThin = new Set<string>()
  const own = `navercafe-thin-${cafe}-${run}.thin-detail.jsonl`
  if (names.includes(own)) {
    for (const l of readFileSync(join(DATA, own), 'utf8').split('\n')) {
      if (l.trim() !== '') actualThin.add(String((JSON.parse(l) as Record<string, unknown>).sourceArticleId))
    }
  }
  for (const f of thinByRun) {
    const r = runOf(f)!
    if (!f.startsWith(`navercafe-thin-${cafe}-`) || runMs(r) >= runMs(run)) continue
    for (const l of readFileSync(join(DATA, f), 'utf8').split('\n')) {
      if (l.trim() === '') continue
      seen.add(String((JSON.parse(l) as Record<string, unknown>).sourceArticleId))
    }
  }
  const eligible = thresholdBasis(rows).eligible
  const listedAt = String(rows[0]!.sourceListedAt)
  /** 🔴 정확한 게시 시각을 아는 글만 — 날짜만 아는 글은 "오늘 글" 로 세지 않는다 */
  const exactPosted = new Map<string, number>()
  const inputs: AutoFetchInput[] = eligible.map((r) => {
    const p = postedOfListRow(r, 'navercafe-run', listedAt)
    if (p.postedAt !== null) exactPosted.set(r.sourceArticleId, Date.parse(p.postedAt))
    return {
      sourceArticleId: r.sourceArticleId,
      score: selectionScore({ stage: r.qualitySignals.stage, flags: r.qualityFlags, signals: r.qualitySignals } as QualityAssessment),
      flags: r.qualityFlags,
      postedFrom: p.postedAt ?? p.postedWindow?.from ?? null,
      alreadyInVault: seen.has(r.sourceArticleId),
    }
  })
  const after = planAutoFetch(inputs, { max }).picked
  const admissible = planAutoFetch(inputs, { max: Number.MAX_SAFE_INTEGER }).picked
  const byId = new Map(inputs.map((x) => [x.sourceArticleId, x]))
  const before = [...admissible].sort((a, b) => legacyCompare(byId.get(a)!, byId.get(b)!)).slice(0, max)
  const ageOf = (id: string): number | null => {
    const p = byId.get(id)?.postedFrom
    return p === null || p === undefined ? null : (Date.parse(listedAt) - Date.parse(p)) / H
  }
  const kstDay = (ms: number): string => new Date(ms + 9 * H).toISOString().slice(0, 10)
  const isToday = (id: string): boolean => {
    const p = exactPosted.get(id)
    return p !== undefined && kstDay(p) === kstDay(Date.parse(listedAt))
  }
  const scores = (ids: readonly string[]): string => ids.map((id) => byId.get(id)!.score).sort((a, b) => a - b).join()
  collectRuns.push({
    file: name, board, eligible: eligible.length, max,
    changed: after.filter((id) => !before.includes(id)).length,
    sameScores: scores(after) === scores(before),
    ageBefore: before.map(ageOf).filter((x): x is number => x !== null),
    ageAfter: after.map(ageOf).filter((x): x is number => x !== null),
    todayBefore: before.filter(isToday).length, todayAfter: after.filter(isToday).length,
    dayOnlyBefore: before.filter((id) => !exactPosted.has(id)).length, dayOnlyAfter: after.filter((id) => !exactPosted.has(id)).length,
    // 🔴 thin 은 그 회차의 **두 게시판 프로세스**가 함께 쓴다 — 이 게시판 목록에 있는 글만 센다
    actualThin: [...actualThin].filter((id) => byId.has(id)).length,
    actualInBefore: [...actualThin].filter((id) => byId.has(id) && before.includes(id)).length,
  })
}

// ─────────────────────────────────────────────────────────
// 날짜 정밀도 실측 — 창 안 목록 · 수집 원천
// ─────────────────────────────────────────────────────────
let listRows = 0
let listDayOnly = 0
for (const name of listFiles) {
  const run = runOf(name)!
  if (!inWindow(runMs(run))) continue
  for (const l of readFileSync(join(DATA, name), 'utf8').split('\n')) {
    if (l.trim() === '') continue
    const r = JSON.parse(l) as Record<string, unknown>
    if (r.sourcePinned === true) continue
    listRows += 1
    if (postedOfListRow(r, 'navercafe-run', String(r.sourceListedAt)).postedWindow !== null) listDayOnly += 1
  }
}

// ─────────────────────────────────────────────────────────
// 출력
// ─────────────────────────────────────────────────────────
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0)
const agg = (m: Mode) => {
  const xs = supplyRuns.map((r) => r[m])
  const verdicts: Record<string, number> = {}
  for (const x of xs) for (const [k, v] of Object.entries(x.dayVerdicts)) verdicts[k] = (verdicts[k] ?? 0) + v
  return {
    linkable: sum(xs.map((x) => x.linkable)), picked: sum(xs.map((x) => x.picked)), covered: sum(xs.map((x) => x.coveredSlots)),
    maxFillable: sum(xs.map((x) => x.maxFillable)), pickedDayOnly: sum(xs.map((x) => x.pickedDayOnly)),
    ageMedian: median(xs.flatMap((x) => x.pickedAgeH)), verdicts,
    tiedPairs: sum(xs.map((x) => x.freshnessDecidedPairs)), poolPairs: sum(xs.map((x) => x.poolPairs)),
  }
}
const A = { before: agg('before'), after: agg('after') }
/** 🔴 날짜만 아는 원천 — "전" eligible 이 "후" 에 복구됐나 · 정확 시각 원천 — 전후 판정 · rank 가 같은가 */
const transitions: Record<string, number> = {}
let dayEligibleBefore = 0
let dayRecovered = 0
let exactRows = 0
let exactVerdictChanged = 0
let exactRankChanged = 0
const exactChangeKinds: Record<string, number> = {}
for (const [k, b] of perRow.before) {
  const a = perRow.after.get(k)
  if (a === undefined) continue
  if (a.isDay) {
    const key = `${b.verdict}${b.reason === '' ? '' : `:${b.reason}`} → ${a.verdict}${a.reason === '' ? '' : `:${a.reason}`}`
    transitions[key] = (transitions[key] ?? 0) + 1
    if (b.verdict === 'eligible') { dayEligibleBefore += 1; if (a.verdict === 'eligible') dayRecovered += 1 }
  } else {
    exactRows += 1
    if (a.verdict !== b.verdict || a.reason !== b.reason) {
      exactVerdictChanged += 1
      const kk = `${b.verdict}:${b.reason} → ${a.verdict}:${a.reason}`
      exactChangeKinds[kk] = (exactChangeKinds[kk] ?? 0) + 1
    } else if (a.rank !== b.rank) exactRankChanged += 1
  }
}
const cAgeB = collectRuns.flatMap((r) => r.ageBefore)
const cAgeA = collectRuns.flatMap((r) => r.ageAfter)
const picksTotal = sum(collectRuns.map((r) => r.ageAfter.length))
const out = {
  window: { from: FROM, to: TO, supplyRuns: supplyRuns.length, collectRuns: collectRuns.length },
  datePrecision: { listRows, listDayOnly },
  dayNormalization: { dayEligibleBefore, dayRecovered, transitions, audit },
  exactUnchanged: { exactRows, exactVerdictChanged, exactRankChanged, exactChangeKinds },
  supply: {
    universe: sum(supplyRuns.map((r) => r.universe)), unmatched: sum(supplyRuns.map((r) => r.unmatched)),
    dayOnlyInUniverse: sum(supplyRuns.map((r) => r.dayOnlyInUniverse)),
    before: A.before, after: A.after,
    fidelity: { actualSelected: sum(supplyRuns.map((r) => r.actualSelected)), overlapBeforeActual: sum(supplyRuns.map((r) => r.overlapBeforeActual)) },
    perRun: supplyRuns.map((r) => ({
      runId: r.runId, universe: r.universe, dayOnly: r.dayOnlyInUniverse,
      before: { picked: r.before.picked, covered: r.before.coveredSlots, dayPicked: r.before.pickedDayOnly, ageMedian: median(r.before.pickedAgeH) },
      after: { picked: r.after.picked, covered: r.after.coveredSlots, dayPicked: r.after.pickedDayOnly, ageMedian: median(r.after.pickedAgeH) },
    })),
  },
  collect: {
    runs: collectRuns.length, picks: picksTotal,
    changedPicks: sum(collectRuns.map((r) => r.changed)), runsChanged: collectRuns.filter((r) => r.changed > 0).length,
    scoreMultisetPreserved: collectRuns.every((r) => r.sameScores),
    ageMedianBefore: median(cAgeB), ageMedianAfter: median(cAgeA),
    ageMeanBefore: cAgeB.length === 0 ? null : sum(cAgeB) / cAgeB.length, ageMeanAfter: cAgeA.length === 0 ? null : sum(cAgeA) / cAgeA.length,
    todayBefore: sum(collectRuns.map((r) => r.todayBefore)), todayAfter: sum(collectRuns.map((r) => r.todayAfter)),
    dayOnlyBefore: sum(collectRuns.map((r) => r.dayOnlyBefore)), dayOnlyAfter: sum(collectRuns.map((r) => r.dayOnlyAfter)),
    fidelity: { actualThin: sum(collectRuns.map((r) => r.actualThin)), actualInBefore: sum(collectRuns.map((r) => r.actualInBefore)) },
    byBoard: Object.fromEntries([...new Set(collectRuns.map((r) => r.board))].map((b) => {
      const rs = collectRuns.filter((r) => r.board === b)
      return [b, {
        runs: rs.length, changed: sum(rs.map((r) => r.changed)), picks: sum(rs.map((r) => r.ageAfter.length)),
        ageMedianBefore: median(rs.flatMap((r) => r.ageBefore)), ageMedianAfter: median(rs.flatMap((r) => r.ageAfter)),
      }]
    })),
  },
}

console.log('\n🔎 D100 Batch D1 신선도 replay — 읽기 전용 (DB 0 · 네트워크 0)')
console.log(`   창 ${FROM ?? '처음'} ~ ${TO ?? '끝'} · 공급 회차 ${supplyRuns.length} · 수집 목록 회차 ${collectRuns.length}`)
console.log('\n① 날짜 정밀도 — 창 안 네이버 목록 줄(고정글 제외)')
console.log(`   날짜만 보이는 줄 ${listDayOnly} / ${listRows} (${pct(listDayOnly, listRows)}) — 앞판은 전부 그날 00:00 으로 지어냈다`)
console.log('\n② 공급 선택 (전 = 날짜만 아는 원천을 00:00 으로 · 후 = 하루 구간 fail-closed)')
console.log(`   모집단 ${out.supply.universe} (DB 상태 사유 제외) · 상세 파일에서 못 찾음 ${out.supply.unmatched} · 날짜만 아는 원천 ${out.supply.dayOnlyInUniverse}`)
for (const m of ['before', 'after'] as const) {
  const a = A[m]
  console.log(`   ${m === 'before' ? '전' : '후'}: 연결 가능 ${a.linkable} · 고름 ${a.picked} · 덮은 슬롯 ${a.covered}/${a.maxFillable}(최대) · 고른 날짜만 원천 ${a.pickedDayOnly}`
    + ` · 고른 원천 슬롯 나이 중앙값 ${r1(a.ageMedian)}h`)
  console.log(`      날짜만 아는 원천 판정(첫 eligible 부족 슬롯) ${JSON.stringify(a.verdicts)}`)
}
console.log('\n②-2 날짜 판 정규화 (같은 원천 · 같은 KST 날짜 · 같은 목록 회차)')
console.log(`   "전" eligible 날짜만 원천(회차 누적) ${dayEligibleBefore} 중 "후" eligible ${dayRecovered}`)
for (const [k, v] of Object.entries(transitions).sort((x, y) => y[1] - x[1])) console.log(`     ${k}  ${v}`)
console.log(`   감사(후): 날짜 원천 증거 ${audit.dayEvidence} · 날짜 판 아닌 스냅샷 ${audit.dayWrongMethod} · 회차/날짜 어긋남 ${audit.dayCrossRunOrDay}`
  + ` · 빈 표본 ${audit.dayEmpty} · 한 점 표본 ${audit.dayOnePoint} · 정확 원천의 날짜 판 ${audit.exactWrongMethod}`)
console.log(`   🔴 00:00 을 정확 시각으로 실은 날짜 라벨 원천 ${audit.midnightExactFromDayLabel} · 정확 시각+구간 동시 ${audit.postedAtWithWindow}`
  + ` (참고: KST 00:00:00.000 정확 시각 전체 ${audit.midnightExactTotal} — 실제 "00:00" 라벨 포함)`)
console.log(`   정확 시각 원천(회차 누적) ${exactRows}: 판정 · 사유 바뀜 ${exactVerdictChanged} · 판정 같고 rank 바뀜 ${exactRankChanged}`)
for (const [k, v] of Object.entries(exactChangeKinds)) console.log(`     ${k}  ${v}`)
console.log(`   충실도: 실제 회차 선택 ${out.supply.fidelity.actualSelected} 중 "전" replay 와 같은 원천 ${out.supply.fidelity.overlapBeforeActual}`
  + ' (재시도 예약 · DB 상태 · 옛 선택기 판은 재현하지 않는다)')
console.log('\n③ 수집 상세 선별 (전 = 같은 점수 → 글 번호 오름차순 · 후 = 같은 점수 → 최신)')
console.log(`   회차 ${out.collect.runs} · 고른 글 ${out.collect.picks} · 바뀐 글 ${out.collect.changedPicks} (${out.collect.runsChanged}회차)`)
console.log(`   🔴 고른 집합의 점수 다중집합 보존 — ${out.collect.scoreMultisetPreserved ? '전 회차 같다 ✅' : '다른 회차가 있다 🔴'}`)
console.log(`   목록 시점 원문 나이(게시 하한) 중앙값 ${r1(out.collect.ageMedianBefore)}h → ${r1(out.collect.ageMedianAfter)}h`
  + ` · 평균 ${r1(out.collect.ageMeanBefore)}h → ${r1(out.collect.ageMeanAfter)}h`)
console.log(`   목록을 본 날(KST) 올라온 글 ${out.collect.todayBefore} → ${out.collect.todayAfter}`
  + ` · 게시 날짜만 아는 글 ${out.collect.dayOnlyBefore} → ${out.collect.dayOnlyAfter}`)
console.log(`   충실도: 실제 thin 산출 ${out.collect.fidelity.actualThin} 중 "전" 선별에 든 글 ${out.collect.fidelity.actualInBefore}`
  + ' (이미 본 글은 thin 근사 · 상세 원장 재시도는 재현하지 않는다)')
for (const [b, x] of Object.entries(out.collect.byBoard)) {
  console.log(`     ${b}: 회차 ${x.runs} · 바뀐 글 ${x.changed}/${x.picks} · 나이 중앙값 ${r1(x.ageMedianBefore)}h → ${r1(x.ageMedianAfter)}h`)
}
console.log('\n④ 참고 · 운영 미적용 — 품질 경계 결정 재료')
console.log(`   공급 순위 이웃 쌍 ${A.after.poolPairs} 중 품질 성분(댓글 · 조회 백분위)이 정확히 같아 나이가 순서를 정한 쌍 ${A.after.tiedPairs}`)
console.log('   🔴 이 replay 는 어떤 품질 경계 · 가중치도 운영에 넣지 않는다 — 경계는 창업자 승인 사항이다(CURRENT §6)')
if (JSON_OUT !== null) {
  writeFileSync(JSON_OUT, `${JSON.stringify(out, null, 2)}\n`)
  console.log(`\n   → ${JSON_OUT}`)
}
