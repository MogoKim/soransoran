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
  isAutoSupplyConsumable, EMPTY_HUMAN_DECISIONS, EMPTY_SOURCE_KEYS, preGenerationRelease, selectWorkset,
  sourceIdentityOf, WGANG_SOURCE_SITE,
  type PriorOutcome, type WorksetRow,
} from '../src/lib/supply-workset'
import { mergeJudgeRows, PROVEN_LANES, RAW_AXIS, SEED_AXIS } from '../src/lib/micro-seed-auto-judge'
import { fakeSourceEvidence } from './lib/fake-source-evidence.mjs'
import { currentQualityContract } from '../src/lib/quality-contract'

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
const QUALITY = currentQualityContract()
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
    jit: { slots: o.slots, now, cap: o.cap, qualityContract: QUALITY },
    limit: Math.max(1, o.cap), runId: RUN, takenAt: o.takenAt ?? now,
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
console.log('\n══ JIT 공급 선택 (P0-B1) — 신규 우선 → 부류 안 최대 슬롯/정본 순위 → 결정적 동률 · raw 0 · 재시도 보충 ══\n')

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

// ── ② 무작위 300벌 — 신규 우선 · 같은 부류 정본 순위 · 결정성 (전수 탐색 대조) ──
{
  let seed = 11
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  let coverOk = 0, freshFirstOk = 0, retryFillOk = 0, detOk = 0, rawOk = 0
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
    const selectedCover = bruteCover(p.picked.map((r) => validOf(r, slots)), slots.length)
    if (p.jit?.coveredSlots === selectedCover && p.jit?.maxFillableSlots === maxCover
      && p.picked.length === Math.min(cap, seedsLinkable.length)) coverOk += 1
    else if (coverMiss === '') coverMiss = JSON.stringify({ t, cap, maxCover, selectedCover, jit: p.jit, picked: p.picked.length, linkable: seedsLinkable.length })
    if (p.picked.every((r) => r.input.axis === SEED_AXIS)) rawOk += 1
    // 🔴 직접 불변식 — 신규가 상한을 먼저 쓰고, 재시도는 남은 자리만 순서대로 보충한다
    const pickedSet = new Set(p.picked.map(KEY))
    const freshLinkable = seedsLinkable.filter((r) => !attempted.has(KEY(r)))
    const retryLinkable = seedsLinkable.filter((r) => attempted.has(KEY(r)))
    const freshPicked = freshLinkable.filter((r) => pickedSet.has(KEY(r)))
    const retryPicked = retryLinkable.filter((r) => pickedSet.has(KEY(r)))
    const unpickedFresh = freshLinkable.filter((r) => !pickedSet.has(KEY(r)))
    if (freshPicked.length === Math.min(cap, freshLinkable.length)
      && !(retryPicked.length > 0 && unpickedFresh.length > 0)) freshFirstOk += 1
    if (retryPicked.length === Math.min(Math.max(0, cap - freshPicked.length), retryLinkable.length)) retryFillOk += 1
    // 결정성 — 입력 순서를 뒤집어도 같은 묶음
    if (JSON.stringify(run({ rows: [...rows].reverse(), slots: [...slots].reverse(), cap, attempted }).workset) === JSON.stringify(p.workset)) detOk += 1
  }
  check(`② 무작위 ${N}벌 — 전체 최대 슬롯과 선택 집합 실제 덮음을 전수 탐색과 대조 · 선택 수 = min(상한, 연결 가능 seed)`, coverOk === N, `${coverOk}/${N} ${coverMiss}`)
  check(`② 무작위 ${N}벌 — 선택 신규 수 = min(상한, 연결 가능 신규) · 미선택 신규가 있으면 재시도 선택 0`, freshFirstOk === N, `${freshFirstOk}/${N}`)
  check(`② 무작위 ${N}벌 — 재시도 선택 수 = 신규 뒤 남은 자리와 연결 가능 재시도 중 작은 수`, retryFillOk === N, `${retryFillOk}/${N}`)
  check(`② 무작위 ${N}벌 — raw 0`, rawOk === N, `${rawOk}/${N}`)
  check(`② 무작위 ${N}벌 — 입력 · 슬롯 순서를 뒤집어도 같은 묶음(결정성)`, detOk === N, `${detOk}/${N}`)
}

// ── ② 같은 시각 슬롯은 한 슬롯 ──
{
  const d = at(3)
  const p = run({ rows: [ROW({ id: 'dupA', ageH: 4, cp: 0.9 }), ROW({ id: 'dupB', ageH: 4, cp: 0.8 })], slots: [d, new Date(d.getTime())], cap: 2 })
  check('② 같은 시각이 두 번 와도 한 슬롯 — 최대 슬롯 1 · 덮은 슬롯 1 · 남는 상한은 같은 슬롯에 더 산다',
    p.jit?.slots === 1 && p.jit?.maxFillableSlots === 1 && p.jit?.coveredSlots === 1 && p.picked.length === 2, JSON.stringify(p.jit))
}

// ── ③ 신규 우선 · 재시도 보충 ──
{
  const slots = Array.from({ length: 12 }, (_, i) => at(1 + i))
  const fresh = Array.from({ length: 12 }, (_, i) => ROW({ id: `f${i}`, ageH: 4, cp: 0.9 - i * 0.01 }))
  const old = [ROW({ id: 'rt0', ageH: 20, cp: 0.1 }), ROW({ id: 'rt1', ageH: 21, cp: 0.11 }), ROW({ id: 'rt2', ageH: 22, cp: 0.12 })]
  const attempted = new Map([...retryOf([old[0]!], 9), ...retryOf([old[1]!], 7), ...retryOf([old[2]!], 3)])
  const p = run({ rows: [...fresh, ...old], slots, cap: 10, attempted })
  check('③ 신규 12건 ≥ 상한 10 · 재시도 3건이 있어도 전부 신규 · retryReserved 0',
    !ids(p).some((x) => x.startsWith('rt')) && p.jit?.retryReserved === 0 && p.picked.length === 10, ids(p).join(','))
  check('③ 이 사례는 신규만으로 10슬롯을 모두 덮는다', p.jit?.coveredSlots === 10 && p.jit?.maxFillableSlots === 12)
  const one = run({ rows: [...fresh.slice(0, 2), old[0]!], slots: [at(1)], cap: 1, attempted: retryOf([old[0]!], 7) })
  const oneShort = run({ rows: [...fresh.slice(0, 2), old[0]!], slots: [at(1)], cap: 1, attempted: retryOf([old[0]!], 5) })
  check('③ 상한 1 · 신규가 있으면 기다린 시간과 무관하게 신규가 선택된다',
    ids(one).join() === 'f0' && ids(oneShort).join() === 'f0', `${ids(one)} · ${ids(oneShort)}`)
}

// ── 🔴 신규 우선 반례 · 변이 탐지 ──
{
  // cap10 · 신규 8건 < cap → 재시도 2건 보충(오래 기다린 rt0·rt1)
  const slots10 = Array.from({ length: 10 }, (_, i) => at(1 + i))
  const fresh8 = Array.from({ length: 8 }, (_, i) => ROW({ id: `n${i}`, ageH: 4, cp: 0.9 - i * 0.01 }))
  const ret3 = [ROW({ id: 'rv0', ageH: 20, cp: 0.1 }), ROW({ id: 'rv1', ageH: 21, cp: 0.11 }), ROW({ id: 'rv2', ageH: 22, cp: 0.12 })]
  const att3 = new Map([...retryOf([ret3[0]!], 9), ...retryOf([ret3[1]!], 7), ...retryOf([ret3[2]!], 3)])
  const p8 = run({ rows: [...fresh8, ...ret3], slots: slots10, cap: 10, attempted: att3 })
  check('🔴 신규 8건 < 상한 10 — 신규 8건 전부 + 재시도 오래 기다린 2건(rv0·rv1) 보충 · retryReserved 2',
    fresh8.every((r) => ids(p8).includes(r.sourceArticleId))
    && ids(p8).includes('rv0') && ids(p8).includes('rv1') && !ids(p8).includes('rv2')
    && p8.jit?.retryReserved === 2 && p8.picked.length === 10, ids(p8).join(','))
  // 동일 슬롯에 연결 가능한 신규·재시도 — cp 높은 재시도보다 낮은 신규가 선택된다
  const sfresh = ROW({ id: 'sf1', ageH: 5, cp: 0.4 })
  const sretry = ROW({ id: 'sr1', ageH: 5, cp: 0.99 })   // 같은 나이지만 재시도 신분
  const sAtt = retryOf([sretry], 9)
  const ps = run({ rows: [sfresh, sretry], slots: [at(1)], cap: 1, attempted: sAtt })
  check('🔴 동일 슬롯 · 신규(cp 낮음)와 재시도(cp 높음) — 재시도 신분만으로 우선권 없음, 신규가 선택',
    ids(ps).join() === 'sf1', `selected: ${ids(ps).join()}`)
  // 변이 탐지 — 신규 = cap 일 때 재시도 reserve-first 가 복원되면 실패한다
  const slotsMut = Array.from({ length: 10 }, (_, i) => at(1 + i))
  const freshMut = Array.from({ length: 10 }, (_, i) => ROW({ id: `mf${i}`, ageH: 4, cp: 0.9 - i * 0.01 }))
  const retMut = [ROW({ id: 'mr0', ageH: 20, cp: 0.1 }), ROW({ id: 'mr1', ageH: 21, cp: 0.11 })]
  const attMut = new Map([...retryOf([retMut[0]!], 9), ...retryOf([retMut[1]!], 7)])
  const pMut = run({ rows: [...freshMut, ...retMut], slots: slotsMut, cap: 10, attempted: attMut })
  check('🔴 변이 탐지 — 신규 10건 = 상한 10 · 재시도 2건이 예약석으로 밀고 들어오지 않는다',
    !ids(pMut).some((x) => x.startsWith('mr')) && pMut.jit?.retryReserved === 0,
    `selected: ${ids(pMut).join(',')} retryReserved: ${pMut.jit?.retryReserved}`)
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
