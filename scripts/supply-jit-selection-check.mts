#!/usr/bin/env tsx
/**
 * 🔴 **JIT 공급 선택 검사** (2026-10-10 P0-B1) — 순수 fixture · DB 0 · provider 0 · 네트워크 0
 *
 *   npm run supply:jit-selection-check
 *
 * 공급 러너와 **같은 연결**(생성 가능 판정 → `selectWorkset({ jit })`)로 다음을 고정한다.
 *   ① 채울 수 있는 최대 슬롯 수를 줄이지 않는다 — 작은 무작위 입력 300벌을 **따로 짠 전수 탐색**과 대조
 *   ② 같은 조건에서 정본 순위상 가장 좋은 집합을 고른다 — 전수 탐색과 대조
 *   ③ raw 는 자동 유료 묶음에 들어가지 않는다 · 재시도 예약 2 는 최대 슬롯을 줄이지 않고 굶김을 막는다
 *   ④ 품질 → 신선도 → 갱년기 → wgang → 열쇠 · 시각을 지어내지 않는다
 *   ⑤ 2026-10-10 08:15 · 12:15 · 14:15 운영 모양 재생에서 자동 소비 가능한 선택 수가 줄지 않는다
 */
import { readFileSync } from 'node:fs'

import {
  compareSupplyRank, isAutoSupplyConsumable, EMPTY_HUMAN_DECISIONS, EMPTY_SOURCE_KEYS, preGenerationRelease, retryReserveFor, selectWorkset,
  sourceIdentityOf, WGANG_SOURCE_SITE,
  type PriorOutcome, type SupplyRankKey, type WorksetRow,
} from '../src/lib/supply-workset'
import { mentionsMenopause } from '../src/lib/original-post-persona-match'
import { mergeJudgeRows, PROVEN_LANES, RAW_AXIS, SEED_AXIS } from '../src/lib/micro-seed-auto-judge'
import { fakeSourceEvidence } from './lib/fake-source-evidence.mjs'

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

const H = 3_600_000
const NOW = new Date('2026-10-08T00:00:00Z')
const RUN = '20261008-000000'
const RT = 'navercafe:remonterrace'
const WG = WGANG_SOURCE_SITE
const at = (h: number): Date => new Date(NOW.getTime() + h * H)

/** 🔴 정본 정규화(`mergeJudgeRows`) · 정본 증거 모양(`fakeSourceEvidence`)을 지난 행 */
const ROW = (o: {
  id: string; site?: string; posted?: Date | null; ageH?: number; cp: number; vp?: number; axis?: 'seed' | 'raw'; title?: string
  /** 판정 기준 시각 — 운영 모양 재생은 회차 시각보다 늦춘다(증거 시각 검사만 통과시키려고 · 나이는 슬롯 기준이라 변하지 않는다) */
  evidenceAt?: Date
}): WorksetRow => {
  const site = o.site ?? RT
  const [input] = mergeJudgeRows([{
    kind: 'detail',
    row: {
      sourceSite: site, sourceArticleId: o.id, title: o.title ?? '오늘 있었던 우리 집 이야기',
      bodyHead: '본문 머리 일부입니다. 사람들이 반응한 이야기입니다.',
      commentCount: 10, axis: o.axis === 'raw' ? RAW_AXIS : SEED_AXIS, access: 'ok', safetyVerdict: 'pass',
      lane: PROVEN_LANES[0] ?? '', assetAxes: '', safetyReasons: '', bodyLength: 300, qualityFlags: [],
    },
  }])
  let ev = fakeSourceEvidence(o.evidenceAt ?? NOW, {
    site, id: o.id, commentsPct: o.cp,
    ...(o.posted === null ? { postedAt: null } : o.posted !== undefined ? { postedAt: o.posted } : { ageH: o.ageH ?? 6 }),
  })
  if (o.vp !== undefined) ev = { ...ev, sourceStats: { ...ev.sourceStats!, viewsPct: o.vp } }
  return { sourceArticleId: o.id, sourceSite: site, commentCount: 10, sourcePostedAt: '', sourceListedAt: '', input: input!, evidence: ev }
}
const KEY = (r: WorksetRow): string => sourceIdentityOf(r.sourceSite, r.sourceArticleId)!
const ids = (p: { picked: readonly WorksetRow[] }): string[] => p.picked.map((r) => r.sourceArticleId)

/** 🔴 러너(`scripts/supply-process.mts`)와 같은 연결 */
const run = (o: {
  rows: readonly WorksetRow[]; slots: readonly Date[]; cap: number; attempted?: ReadonlyMap<string, PriorOutcome>
  now?: Date; takenAt?: Date
}) => {
  const now = o.now ?? NOW
  const releaseOf = (r: WorksetRow) => {
    const d = o.slots.find((x) => preGenerationRelease(r, x, now).verdict === 'eligible')
    return preGenerationRelease(r, d ?? o.slots[0] ?? at(1), now)
  }
  return selectWorkset({
    rows: o.rows, humanDecided: EMPTY_HUMAN_DECISIONS, queuePending: new Set(), queuedSources: EMPTY_SOURCE_KEYS,
    carriedOver: EMPTY_SOURCE_KEYS, concluded: new Set(), attempted: o.attempted ?? new Map(), releaseOf,
    jit: { slots: o.slots, now, cap: o.cap }, limit: Math.max(1, o.cap), runId: RUN, takenAt: o.takenAt ?? now,
  })
}
const retryOf = (rows: readonly WorksetRow[], waitedH: number, takenAt = NOW): Map<string, PriorOutcome> =>
  new Map(rows.map((r) => [KEY(r), { sourceKey: KEY(r), sourceArticleId: r.sourceArticleId, atMs: takenAt.getTime() - waitedH * H, stage: 'judge' as const, state: 'retryable' as const }]))

/** 🔴 **따로 짠 전수 탐색** — 서로 다른 슬롯 하나씩으로 덮을 수 있는 최대 수(선택 코드의 증대 경로를 쓰지 않는다) */
const bruteCover = (valid: readonly (readonly boolean[])[], nSlots: number): number => {
  const go = (j: number, used: Set<number>): number => {
    if (j >= nSlots) return 0
    let best = go(j + 1, used)
    for (let i = 0; i < valid.length; i += 1) {
      if (used.has(i) || !valid[i]![j]) continue
      used.add(i); best = Math.max(best, 1 + go(j + 1, used)); used.delete(i)
    }
    return best
  }
  return go(0, new Set())
}
const validOf = (r: WorksetRow, slots: readonly Date[], now = NOW): boolean[] =>
  [...slots].sort((a, b) => a.getTime() - b.getTime()).map((d) => preGenerationRelease(r, d, now).verdict === 'eligible')
const rankKeyOf = (r: WorksetRow, slots: readonly Date[], now = NOW): SupplyRankKey => {
  const s0 = [...slots].sort((a, b) => a.getTime() - b.getTime())[0]!
  return {
    rank: preGenerationRelease(r, s0, now).rank, key: KEY(r), wgang: r.sourceSite === WG,
    menopause: mentionsMenopause(`${r.input.title ?? ''}\n${r.input.bodyHead ?? ''}`),
  }
}

console.log('\n══ JIT 공급 선택 (P0-B1) — 최대 슬롯 보존 → 정본 순위 → 결정적 동률 · raw 0 · 재시도 예약 2 ══\n')

// ── ① B형 반례 · 순위 탐욕이 슬롯을 잃는 모양 ──
{
  // 슬롯 s1·s2 · A(1위) 두 슬롯 다 유효 · B(2위) s1 만 유효
  const s1 = at(1), s2 = at(30)
  const A = ROW({ id: 'gA', ageH: 5, cp: 0.9 })
  const B = ROW({ id: 'gB', ageH: 60, cp: 0.5 })
  // 🔴 순위 탐욕 + 가장 이른 빈 슬롯 배정(금지된 구현) — A 가 s1 을 먹고 B 는 갈 곳이 없다
  const naive = (() => { const used = new Set<number>(); let n = 0
    for (const r of [A, B]) { const v = validOf(r, [s1, s2]); const j = v.findIndex((x, k) => x && !used.has(k)); if (j >= 0) { used.add(j); n += 1 } }
    return n })()
  const p = run({ rows: [A, B], slots: [s1, s2], cap: 2 })
  check('① 순위 탐욕은 슬롯 1개만 덮는 모양에서 새 선택은 2개를 덮는다(B→s1 · A→s2)',
    naive === 1 && p.jit?.coveredSlots === 2 && p.jit?.maxFillableSlots === 2
    && p.workset.sources.find((x) => x.sourceArticleId === 'gB')?.slotAt === s1.toISOString(), `naive ${naive} · ${JSON.stringify(p.jit)}`)
  // B형(축을 배정 뒤에 두면 선택이 준다) — raw 가 순위 상위를 차지해도 자동 seed 슬롯 수는 줄지 않는다
  const raws = [0.99, 0.98, 0.97, 0.96].map((cp, i) => ROW({ id: `bR${i}`, ageH: 4, cp, axis: 'raw' }))
  const seeds = [0.6, 0.5, 0.4].map((cp, i) => ROW({ id: `bS${i}`, ageH: 4, cp }))
  const pb = run({ rows: [...raws, ...seeds], slots: [at(1), at(5), at(9)], cap: 3 })
  check('① B형 — 순위 상위 raw 4건이 있어도 seed 3건이 3슬롯을 다 덮는다(축 처리로 슬롯이 줄지 않는다)',
    pb.picked.length === 3 && pb.picked.every((r) => r.input.axis === SEED_AXIS) && pb.jit?.coveredSlots === 3, JSON.stringify(pb.jit))
}

// ── ② 무작위 300벌 — 최대 슬롯 보존 · 정본 순위 최적 · 결정성 (전수 탐색 대조) ──
{
  let seed = 11
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  let coverOk = 0, bestOk = 0, detOk = 0, starveOk = 0, rawOk = 0
  let coverMiss = ''
  const N = 300
  for (let t = 0; t < N; t += 1) {
    const nSlots = 1 + Math.floor(rnd() * 4)
    // 🔴 부족 슬롯은 시각이 서로 다르다(운영과 같은 모양)
    const slots = [...new Set(Array.from({ length: nSlots }, () => 1 + Math.floor(rnd() * 40)))].map((h) => at(h))
    const rows = Array.from({ length: 2 + Math.floor(rnd() * 6) }, (_, i) => ROW({
      id: `r${t}-${i}`, site: rnd() < 0.4 ? WG : RT, ageH: 3 + Math.floor(rnd() * 70), cp: Math.round(rnd() * 20) / 20,
      axis: rnd() < 0.2 ? 'raw' : 'seed', title: rnd() < 0.3 ? '갱년기 이야기' : '우리 집 이야기',
    }))
    const retries = rows.filter(() => rnd() < 0.35)
    const attempted = retryOf(retries, 1 + Math.floor(rnd() * 12))
    const cap = 1 + Math.floor(rnd() * 5)
    const p = run({ rows, slots, cap, attempted })
    const seedsLinkable = rows.filter((r) => r.input.axis === SEED_AXIS && validOf(r, slots).some(Boolean))
    const valid = seedsLinkable.map((r) => validOf(r, slots))
    const maxCover = bruteCover(valid, slots.length)
    const target = Math.min(cap, maxCover)
    if (p.jit?.coveredSlots === target && p.jit?.maxFillableSlots === maxCover
      && p.picked.length === Math.min(cap, seedsLinkable.length)) coverOk += 1
    else if (coverMiss === '') coverMiss = JSON.stringify({ t, cap, maxCover, target, jit: p.jit, picked: p.picked.length, linkable: seedsLinkable.length })
    if (p.picked.every((r) => r.input.axis === SEED_AXIS)) rawOk += 1
    // 정본 순위 최적 — 같은 크기 · 목표 슬롯을 덮는 · 예약 재시도를 담은 부분집합 중 순위 위치가 사전식으로 가장 앞선 것
    const ord = [...seedsLinkable].sort((a, b) => compareSupplyRank(rankKeyOf(a, slots), rankKeyOf(b, slots)))
    // 🔴 선택 결과의 행은 생성 가능 판정이 만든 사본이다 — 원천 열쇠로 위치를 찾는다
    const pos = (r: WorksetRow): number => ord.findIndex((x) => KEY(x) === KEY(r))
    const pickedSet = new Set(p.picked.map(KEY))
    const retryLinkable = seedsLinkable.filter((r) => attempted.has(KEY(r)))
    const reserve = Math.min(cap, retryReserveFor(cap, retryLinkable.map((r) => attempted.get(KEY(r))!.atMs), NOW))
    const reservedPicked = retryLinkable.filter((r) => pickedSet.has(KEY(r)))
    const m = p.picked.length
    let best: number[] | null = null
    const lexLess = (a: number[], b: number[]): boolean => { for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i]! < b[i]!; return false }
    const subsets = (k: number, start: number, acc: WorksetRow[]): void => {
      if (acc.length === k) {
        if (!reservedPicked.every((r) => acc.includes(r))) return
        if (bruteCover(acc.map((r) => validOf(r, slots)), slots.length) < target) return
        const v = acc.map(pos).sort((x, y) => x - y)
        if (best === null || lexLess(v, best)) best = v
        return
      }
      for (let i = start; i < seedsLinkable.length; i += 1) { acc.push(seedsLinkable[i]!); subsets(k, i + 1, acc); acc.pop() }
    }
    subsets(m, 0, [])
    const mine = p.picked.map(pos).sort((x, y) => x - y)
    if (best !== null && JSON.stringify(best) === JSON.stringify(mine)) bestOk += 1
    // 결정성 — 입력 순서를 뒤집어도 같은 묶음
    if (JSON.stringify(run({ rows: [...rows].reverse(), slots: [...slots].reverse(), cap, attempted }).workset) === JSON.stringify(p.workset)) detOk += 1
    // 굶김 — 예약 수보다 적게 고른 재시도가 남아 있으면 상한이 찼고 그 재시도는 덮기에도 못 들어간다
    const unpickedRetry = retryLinkable.filter((r) => !pickedSet.has(KEY(r)))
    if (reservedPicked.length >= Math.min(reserve, retryLinkable.length) || (p.picked.length === cap && unpickedRetry.length > 0)) starveOk += 1
  }
  check(`② 무작위 ${N}벌 — 덮은 슬롯 = min(상한, 전수 탐색 최대) · 선택 수 = min(상한, 연결 가능 seed)`, coverOk === N, `${coverOk}/${N} ${coverMiss}`)
  check(`② 무작위 ${N}벌 — 같은 조건의 모든 부분집합 중 정본 순위상 가장 좋은 집합(전수 탐색)`, bestOk === N, `${bestOk}/${N}`)
  check(`② 무작위 ${N}벌 — raw 0`, rawOk === N, `${rawOk}/${N}`)
  check(`② 무작위 ${N}벌 — 입력 · 슬롯 순서를 뒤집어도 같은 묶음(결정성)`, detOk === N, `${detOk}/${N}`)
  check(`③ 무작위 ${N}벌 — 재시도는 예약 수만큼 들어가거나, 못 들어간 경우 상한이 찼다`, starveOk === N, `${starveOk}/${N}`)
}

// ── ② 같은 시각 슬롯은 한 슬롯 ──
{
  const d = at(3)
  const p = run({ rows: [ROW({ id: 'dupA', ageH: 4, cp: 0.9 }), ROW({ id: 'dupB', ageH: 4, cp: 0.8 })], slots: [d, new Date(d.getTime())], cap: 2 })
  check('② 같은 시각이 두 번 와도 한 슬롯 — 최대 슬롯 1 · 덮은 슬롯 1 · 남는 상한은 같은 슬롯에 더 산다',
    p.jit?.slots === 1 && p.jit?.maxFillableSlots === 1 && p.jit?.coveredSlots === 1 && p.picked.length === 2, JSON.stringify(p.jit))
}

// ── ③ 재시도 예약 2 ──
{
  const slots = Array.from({ length: 12 }, (_, i) => at(1 + i))
  const fresh = Array.from({ length: 12 }, (_, i) => ROW({ id: `f${i}`, ageH: 4, cp: 0.9 - i * 0.01 }))
  const old = [ROW({ id: 'rt0', ageH: 20, cp: 0.1 }), ROW({ id: 'rt1', ageH: 21, cp: 0.11 }), ROW({ id: 'rt2', ageH: 22, cp: 0.12 })]
  const attempted = new Map([...retryOf([old[0]!], 9), ...retryOf([old[1]!], 7), ...retryOf([old[2]!], 3)])
  const p = run({ rows: [...fresh, ...old], slots, cap: 10, attempted })
  const none = run({ rows: [...fresh, ...old], slots, cap: 10 })
  check('③ 상한 10 · 순위 최하위 재시도 3건 중 가장 오래 기다린 2건(rt0 · rt1)이 예약으로 들어간다',
    ids(p).includes('rt0') && ids(p).includes('rt1') && !ids(p).includes('rt2') && p.jit?.retryReserved === 2 && p.jit?.retryReserve === 2, ids(p).join(','))
  check('③ 예약이 없으면 같은 원천은 순위에 밀려 0 — 예약이 굶김을 막는다',
    !ids(none).some((x) => x.startsWith('rt')))
  check('③ 예약이 최대 슬롯을 줄이지 않는다(10슬롯 모두 덮음)', p.jit?.coveredSlots === 10 && p.jit?.maxFillableSlots === 12)
  const one = run({ rows: [...fresh.slice(0, 2), old[0]!], slots: [at(1)], cap: 1, attempted: retryOf([old[0]!], 7) })
  const oneShort = run({ rows: [...fresh.slice(0, 2), old[0]!], slots: [at(1)], cap: 1, attempted: retryOf([old[0]!], 5) })
  check('③ 상한 1 — 6시간 넘게 기다린 재시도만 그 한 자리를 가져간다(기존 굶김 규칙)',
    ids(one).join() === 'rt0' && ids(oneShort).join() === 'f0', `${ids(one)} · ${ids(oneShort)}`)
}

// ── ④ raw ──
{
  check('④ 자동 공급 가능 판정(정본 하나) — seed true · raw false',
    isAutoSupplyConsumable(ROW({ id: 'au-s', cp: 0.5 })) && !isAutoSupplyConsumable(ROW({ id: 'au-r', cp: 0.5, axis: 'raw' })))
  const raws = Array.from({ length: 6 }, (_, i) => ROW({ id: `raw${i}`, ageH: 4, cp: 0.99 - i * 0.01, axis: 'raw' }))
  const p = run({ rows: raws, slots: [at(1), at(5)], cap: 10 })
  check('④ raw 만 많아도 자동 유료 묶음 0(판정 · 생성 호출 대상 0) · 사유 rawNotAutoConsumed',
    p.picked.length === 0 && p.workset.sources.length === 0 && p.dropped.rawNotAutoConsumed === 6 && p.jit?.rawExcluded === 6, JSON.stringify(p.dropped))
}

// ── ⑤ ⑥ ⑦ 순위 ──
{
  const s = [at(1)]
  const G = ROW({ id: 'qG', ageH: 4, cp: 0.9 })
  const M = ROW({ id: 'qM', ageH: 4, cp: 0.5, title: '갱년기 열감', site: WG })
  check('⑤ 높은 품질 일반 글(0.9)이 낮은 품질 갱년기 · wgang 글(0.5)을 이긴다', ids(run({ rows: [M, G], slots: s, cap: 1 })).join() === 'qG')
  const Gn = ROW({ id: 'fG', ageH: 3, cp: 0.8 })
  const Mo = ROW({ id: 'fM', ageH: 30, cp: 0.8, title: '갱년기 열감', site: WG })
  check('⑥ 품질이 같으면 최신 일반 글(3h)이 오래된 갱년기 · wgang 글(30h)을 이긴다', ids(run({ rows: [Mo, Gn], slots: s, cap: 1 })).join() === 'fG')
  const t0 = new Date(NOW.getTime() - 5 * H)
  const plain = ROW({ id: 'tP', posted: t0, cp: 0.7 })
  const meno = ROW({ id: 'tM', posted: t0, cp: 0.7, title: '갱년기 이야기' })
  const wg = ROW({ id: 'tW', posted: t0, cp: 0.7, site: WG })
  const wgMeno = ROW({ id: 'tX', posted: t0, cp: 0.7, site: WG, title: '갱년기 이야기' })
  check('⑦ 품질 · 신선도가 같으면 갱년기가 이긴다', ids(run({ rows: [plain, meno], slots: s, cap: 1 })).join() === 'tM')
  check('⑦ 그것도 같으면 wgang 이 이긴다', ids(run({ rows: [plain, wg], slots: s, cap: 1 })).join() === 'tW')
  check('⑦ 갱년기가 wgang 보다 앞선다 · 둘 다면 가장 앞', ids(run({ rows: [wg, meno], slots: s, cap: 1 })).join() === 'tM'
    && ids(run({ rows: [wg, meno, plain, wgMeno], slots: s, cap: 1 })).join() === 'tX')
  const twin = [ROW({ id: 'zz', posted: t0, cp: 0.7 }), ROW({ id: 'aa', posted: t0, cp: 0.7 })]
  check('⑦ 모두 같으면 원천 열쇠로 결정적(입력 순서와 무관)',
    ids(run({ rows: twin, slots: s, cap: 1 })).join() === ids(run({ rows: [...twin].reverse(), slots: s, cap: 1 })).join())
}

// ── ⑧ 시각을 지어내지 않는다 ──
{
  const missing = ROW({ id: '000001', posted: null, cp: 0.99 })
  const ok = ROW({ id: '999999', ageH: 4, cp: 0.1 })
  const p = run({ rows: [missing, ok], slots: [at(1)], cap: 2 })
  check('⑧ 게시 시각이 없으면(작은 id · 높은 반응이어도) 고르지 않는다 — id · 자정으로 시각을 만들지 않는다',
    ids(p).join() === '999999' && p.dropped.slotUnknown === 1, JSON.stringify(p.dropped))
  const src = readFileSync('src/lib/supply-workset.ts', 'utf-8')
  const body = src.slice(src.indexOf('function selectJitWorkset'), src.indexOf('function selectJitWorkset') + 6000)
  check('⑧ 선택 코드는 원문 id 를 시각 대용으로 쓰지 않는다(sourceArticleId 비교 · parseInt 없음)',
    !/sourceArticleId\s*[<>]|localeCompare\(.*sourceArticleId|parseInt|Number\(.*sourceArticleId/.test(body))
}

// ── ⑬ 임의 점수 · 보너스 · 품질 구간 없음 ──
{
  const src = readFileSync('src/lib/supply-workset.ts', 'utf-8')
  const cmp = src.slice(src.indexOf('export function compareSupplyRank'), src.indexOf('export function compareSupplyRank') + 600)
  check('⑬ 공급 순위는 정본 compareReleaseRank 그대로 + 동률 선호 둘 + 열쇠 — 가산 · 곱셈 · 상수 없음',
    /compareReleaseRank\(\{ \.\.\.a\.rank, tieBreak: '' \}, \{ \.\.\.b\.rank, tieBreak: '' \}\)/.test(cmp)
    && !/[0-9]\.[0-9]|\*\s*[0-9]|\+\s*0\.|score|weight|bonus|band/i.test(cmp.replace(/\/\*\*[\s\S]*?\*\//g, '')))
}

// ── ⑩ 운영 모양 재생 — 2026-10-10 08:15 · 12:15 · 14:15 (v1 trace 에서 해시 · id · 원문 없이 뽑은 모양) ──
{
  type Shape = { runId: string; takenAt: string; cap: number; slots: string[]; candidates: {
    axis: 'seed' | 'raw'; retryTier: number | null; retryWaitedH: number | null; commentsPct: number | null; viewsPct: number | null
    slotAgesH: (number | null)[]; menopauseCore: boolean; wgangSource: boolean; actualSelected: boolean }[] }
  const shapes = (JSON.parse(readFileSync('scripts/fixtures/supply-jit-shapes-20261010.json', 'utf-8')) as { runs: Shape[] }).runs
  for (const sh of shapes) {
    const taken = new Date(sh.takenAt)
    // 🔴 증거 시각 검사만 통과시키려고 판정 기준 시각을 늦춘다 — 나이 · 유효성은 슬롯 기준이라 그대로다
    const judgeNow = new Date(taken.getTime() + 2.5 * H)
    const slots = sh.slots.map((x) => new Date(x))
    const rows: WorksetRow[] = []
    const attempted = new Map<string, PriorOutcome>()
    sh.candidates.forEach((c, i) => {
      const j = c.slotAgesH.findIndex((a) => a !== null)
      if (j < 0 || c.commentsPct === null) return
      const posted = new Date(slots[j]!.getTime() - c.slotAgesH[j]! * H)
      const r = ROW({
        id: `shape-${sh.runId}-${i}`, site: c.wgangSource ? WG : RT, posted, cp: c.commentsPct, axis: c.axis,
        ...(c.viewsPct === null ? {} : { vp: c.viewsPct }), title: c.menopauseCore ? '갱년기 이야기' : '우리 집 이야기', evidenceAt: judgeNow,
      })
      rows.push(r)
      if (c.retryTier !== null) {
        attempted.set(KEY(r), {
          sourceKey: KEY(r), sourceArticleId: r.sourceArticleId, atMs: taken.getTime() - (c.retryWaitedH ?? 0) * H,
          stage: c.retryTier === 1 ? 'draft' : 'judge', state: c.retryTier === 0 ? 'seeded' : 'retryable',
        } as PriorOutcome)
      }
    })
    const p = run({ rows, slots, cap: sh.cap, attempted, now: judgeNow, takenAt: taken })
    const actualSeed = sh.candidates.filter((c) => c.actualSelected && c.axis === 'seed').length
    const ages = p.workset.sources.map((x) => x.ageAtSlotH ?? 0).sort((a, b) => a - b)
    const actualAges = sh.candidates.filter((c) => c.actualSelected).map((c) => Math.min(...c.slotAgesH.filter((a): a is number => a !== null))).sort((a, b) => a - b)
    const med = (xs: number[]): number => (xs.length === 0 ? NaN : xs[Math.floor((xs.length - 1) / 2)]!)
    check(`⑩ ${sh.runId} 재생 — 자동 소비 가능(seed) 선택 ${actualSeed} → ${p.picked.length} · 덮은 슬롯 ${p.jit?.coveredSlots}/${p.jit?.maxFillableSlots} · raw 0 · 재시도 예약 ${p.jit?.retryReserved}`
      + ` · 선택 나이 중앙 ${med(actualAges).toFixed(1)}h(실제 · 가장 이른 유효 슬롯 기준) → ${med(ages).toFixed(1)}h(배정 슬롯)`,
    p.picked.length >= actualSeed && p.picked.every((r) => r.input.axis === SEED_AXIS)
      && p.jit?.coveredSlots === Math.min(sh.cap, p.jit?.maxFillableSlots ?? -1))
  }
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail\n`)
process.exit(fail === 0 ? 0 : 1)
