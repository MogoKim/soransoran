#!/usr/bin/env tsx
/**
 * 🔴 **공급 선택 관측 trace 검사** (2026-10-10 P0-B0) — 순수 fixture · DB 0 · provider 0 · 네트워크 0
 *
 *   npm run supply:selection-trace-check
 *
 * 공급 러너와 **같은 연결**(생성 가능 판정 → `assignSourceSlots` → `selectWorkset` → `buildSupplySelectionTrace`)로
 * 다음을 고정한다.
 *   ① trace 를 넘기든 안 넘기든 슬롯 배정 · 묶음 · 순서 · 축 · 재시도 · digest 가 같다(무작위 fixture 50벌 포함)
 *   ② EDF · 상한 · 예약석 · 축 자리 · 생성 가능 판정에서 멈춘 원천이 서로 다른 사유로 적힌다
 *   ③ 갱년기 · wgang 후보가 어느 단계에서 빠졌는지 세어진다
 *   ④ shadow 는 같은 품질 tuple · 같은 신선도 구간에서만 선호를 센다 · 모르면 UNKNOWN
 *   ⑤ 원문 · 제목 · 본문 · id 평문이 없다 · 손상 trace 를 정상으로 읽지 않는다 · 실패가 되풀이 호출을 만들지 않는다
 */
import { readFileSync } from 'node:fs'

import {
  assignSourceSlots, EMPTY_HUMAN_DECISIONS, EMPTY_SOURCE_KEYS, preGenerationRelease, selectWorkset, sourceIdentityOf,
  worksetEligibility, WORKSET_SELECT_STEPS,
  type PriorOutcome, type WorksetRow,
} from '../src/lib/supply-workset'
import {
  buildSupplySelectionTrace, createSelectionRecorder, readSupplySelectionTrace, recordSelectionTraceSafely,
  serializeSelectionTrace, shadowOf, TRACE_REASONS, worksetDigestOf,
  type SupplySelectionTrace, type TraceCandidate,
} from '../src/lib/supply-selection-trace'
import { articleIdHashOf } from '../src/lib/source-slot-release'
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
const WG = 'navercafe:wgang'
const S1 = new Date(NOW.getTime() + 1 * H)
const S2 = new Date(NOW.getTime() + 10 * H)
const S3 = new Date(NOW.getTime() + 30 * H)

/** 🔴 정본 정규화(`mergeJudgeRows`) · 정본 증거 모양(`fakeSourceEvidence`)을 지난 행 — 손으로 조립하지 않는다 */
const ROW = (o: {
  id: string; site?: string; ageH: number; cp: number; axis?: 'seed' | 'raw'; title?: string; body?: string; viewsNull?: boolean
  /** 🔴 원천 상대 조회 백분위(기본 0.6) — 반올림 경계 반례에만 준다 */
  vp?: number
}): WorksetRow => {
  const site = o.site ?? RT
  const [input] = mergeJudgeRows([{
    kind: 'detail',
    row: {
      sourceSite: site, sourceArticleId: o.id, title: o.title ?? '오늘 있었던 우리 집 이야기',
      bodyHead: o.body ?? '본문 머리 일부입니다. 사람들이 반응한 이야기입니다.',
      commentCount: 10, axis: o.axis === 'raw' ? RAW_AXIS : SEED_AXIS, access: 'ok', safetyVerdict: 'pass',
      lane: PROVEN_LANES[0] ?? '', assetAxes: '', safetyReasons: '', bodyLength: 300, qualityFlags: [],
    },
  }])
  let ev = fakeSourceEvidence(NOW, { site, id: o.id, ageH: o.ageH, commentsPct: o.cp })
  if (o.viewsNull === true) ev = { ...ev, sourceStats: { ...ev.sourceStats!, viewsPct: null } }
  if (o.vp !== undefined) ev = { ...ev, sourceStats: { ...ev.sourceStats!, viewsPct: o.vp } }
  return {
    sourceArticleId: o.id, sourceSite: site, commentCount: 10, sourcePostedAt: '', sourceListedAt: '',
    input: input!, evidence: ev,
  }
}
const KEY = (r: WorksetRow): string => sourceIdentityOf(r.sourceSite, r.sourceArticleId)!
const retryOf = (rows: readonly WorksetRow[], waitedH = 5, stage: 'judge' | 'draft' = 'judge'): Map<string, PriorOutcome> =>
  new Map(rows.map((r) => [KEY(r), {
    sourceKey: KEY(r), sourceArticleId: r.sourceArticleId, atMs: NOW.getTime() - waitedH * H, stage, state: 'retryable' as const,
  }]))

/**
 * 🔴 **공급 러너(`scripts/supply-process.mts`)와 같은 연결** — 부족 슬롯이 있으면 JIT(배정 → 배정 슬롯 판정),
 *    `jit:false` 면 배정 없이 고르는 옛 판(예약석 · 상한처럼 JIT 에서 구조적으로 드러나지 않는 단계를 시험한다).
 */
const pipeline = (o: {
  rows: readonly WorksetRow[]; slots: readonly Date[]; cap: number; limit?: number
  attempted?: ReadonlyMap<string, PriorOutcome>; concluded?: ReadonlySet<string>; traced: boolean; jit?: boolean
}) => {
  const jit = o.jit ?? true
  const releaseOf = (r: WorksetRow) => {
    const at = o.slots.find((d) => preGenerationRelease(r, d, NOW).verdict === 'eligible')
    return preGenerationRelease(r, at ?? o.slots[0] ?? S1, NOW)
  }
  const eligibilityInput = {
    rows: o.rows, humanDecided: EMPTY_HUMAN_DECISIONS, queuePending: new Set<string>(), queuedSources: EMPTY_SOURCE_KEYS,
    carriedOver: EMPTY_SOURCE_KEYS, concluded: o.concluded ?? new Set<string>(), releaseOf,
  }
  const rec = o.traced ? createSelectionRecorder() : null
  const assigned = jit
    ? assignSourceSlots({
      rows: worksetEligibility(eligibilityInput).eligible, slots: o.slots, now: NOW, cap: o.cap,
      ...(rec === null ? {} : { trace: rec.sink }),
    })
    : new Map<string, Date>()
  const intendedSlotOf = (r: WorksetRow): Date | null => {
    const k = sourceIdentityOf(r.sourceSite, r.sourceArticleId)
    return k === null ? null : assigned.get(k) ?? null
  }
  const attempted = o.attempted ?? new Map<string, PriorOutcome>()
  const plan = selectWorkset({
    ...eligibilityInput, attempted,
    releaseOf: jit ? (r) => {
      const d = intendedSlotOf(r)
      return d === null ? releaseOf(r) : preGenerationRelease(r, d, NOW)
    } : releaseOf,
    ...(jit ? { intendedSlotOf } : {}),
    limit: o.limit ?? o.cap, runId: RUN, takenAt: NOW,
    ...(rec === null ? {} : { trace: rec.sink }),
  })
  const trace = rec === null ? null : buildSupplySelectionTrace({
    runId: RUN, takenAt: NOW, limit: o.limit ?? o.cap, cap: o.cap, slots: jit ? o.slots : [], record: rec.record,
    attempted, picked: plan.picked, workset: plan.workset, slotVerdict: (r, d) => preGenerationRelease(r, d, NOW),
  })
  return { assigned, plan, trace }
}
/** 🔴 선택 결과 전부 — 배정 · 묶음 파일 · 고른 순서 · 제외 수 · 이월 · 축 */
const selectionOf = (x: ReturnType<typeof pipeline>): string => JSON.stringify({
  assigned: [...x.assigned.entries()].map(([k, d]) => [k, d.toISOString()]).sort(),
  workset: x.plan.workset, picked: x.plan.picked.map(KEY), dropped: x.plan.dropped, deferred: x.plan.deferred, axis: x.plan.axis,
})
const byId = (t: SupplySelectionTrace, site: string, id: string): TraceCandidate | undefined =>
  t.candidates.find((c) => c.sourceHash === articleIdHashOf(site, id))
const sameRun = (o: Omit<Parameters<typeof pipeline>[0], 'traced'>):{ off: ReturnType<typeof pipeline>; on: ReturnType<typeof pipeline> } =>
  ({ off: pipeline({ ...o, traced: false }), on: pipeline({ ...o, traced: true }) })

console.log('\n══ 공급 선택 관측 trace (P0-B0) — 선택 불변 · 단계 사유 · 갱년기/wgang · shadow · 개인정보 ══\n')

// ── ① EDF: 오래되고 마감 임박한 원천이 최신 원천보다 먼저 ──
{
  const OLD = ROW({ id: 'edf-old', ageH: 60, cp: 0.4 })
  const FRESH = ROW({ id: 'edf-fresh', ageH: 3, cp: 0.95 })
  const { off, on } = sameRun({ rows: [OLD, FRESH], slots: [S1, S3], cap: 1 })
  const t = on.trace!
  const o = byId(t, RT, 'edf-old')!
  const f = byId(t, RT, 'edf-fresh')!
  check('① EDF — 마감이 이른 오래된 원천(60h)이 배정되고 최신 원천은 상한에 잘린다(실제 경로)',
    on.plan.picked.map(KEY).join() === KEY(OLD) && o.edf === 'ASSIGNED' && o.reason === 'SELECTED_FRESH' && f.edf === 'CAP_CUT',
    `${o.edf}/${o.reason} · ${f.edf}/${f.reason}`)
  check('① 마감 근거 — 오래된 원천의 마지막 유효 슬롯 0 · 최신 원천 1(EDF 입력이 남는다)',
    o.lastValidSlot === 0 && f.lastValidSlot === 1 && o.slotAgesH?.[1] === null && f.slotAgesH?.[0] !== null)
  check('① 집계 — 같은 슬롯에 더 어린 원천을 두고 오래된 원천이 배정된 수 1',
    t.summary.edfOlderOverFresher === 1, String(t.summary.edfOlderOverFresher))
  check('⑥ trace on/off — 배정 · 묶음 · 순서 · digest 동일(EDF 사례)',
    selectionOf(off) === selectionOf(on) && worksetDigestOf(off.plan.workset) === t.worksetDigest)
  // ── ② 순위가 높은데 슬롯 배정이 안 돼 묶음에 못 든다 ──
  check('② 순위가 높은 원천(cp 0.95)이 슬롯 상한에 잘려 묶음 밖 — 사유 EDF_CAP_CUT · 선택 단계 SLOT_UNASSIGNED',
    f.reason === 'EDF_CAP_CUT' && f.selectStep === 'SLOT_UNASSIGNED' && !f.selected && (f.rank?.commentsPct ?? 0) > (o.rank?.commentsPct ?? 1))
}
{
  const A = ROW({ id: 'nm-a', ageH: 60, cp: 0.5 })
  const B = ROW({ id: 'nm-b', ageH: 61, cp: 0.6 })
  const C = ROW({ id: 'nm-c', ageH: 3, cp: 0.9 })
  const D = ROW({ id: 'nm-d', ageH: 80, cp: 0.9 })
  const { on } = sameRun({ rows: [A, B, C, D], slots: [S1, S3], cap: 2 })
  const t = on.trace!
  const reasons = ['nm-a', 'nm-b', 'nm-c', 'nm-d'].map((id) => byId(t, RT, id)!.reason)
  check('② 짝에 못 든 원천(EDF_NOT_MATCHED)과 어느 슬롯에도 못 붙는 원천(SLOT_INELIGIBLE)이 다른 사유다',
    reasons.filter((r) => r === 'EDF_NOT_MATCHED').length === 1 && reasons.includes('SLOT_INELIGIBLE')
    && reasons.filter((r) => r.startsWith('SELECTED_')).length === 2, reasons.join(','))
}

// ── ③ 재시도 예약석이 신규를 민다 (배정 없이 고르는 판 — JIT 에서는 cap = 상한이라 구조적으로 0) ──
{
  const F1 = ROW({ id: 'rs-f1', ageH: 4, cp: 0.9 })
  const F2 = ROW({ id: 'rs-f2', ageH: 4, cp: 0.8 })
  const R1 = ROW({ id: 'rs-r1', ageH: 20, cp: 0.3 })
  const o = { rows: [F1, F2, R1], slots: [S1], cap: 2, attempted: retryOf([R1]), jit: false }
  const { off, on } = sameRun(o)
  const t = on.trace!
  check('③ 예약석 — 재시도 1건이 예약석을 잡고 두 번째 신규(cp 0.8)가 FRESH_DISPLACED_BY_RETRY_RESERVE',
    byId(t, RT, 'rs-r1')!.reason === 'SELECTED_RETRY_RESERVED' && byId(t, RT, 'rs-f1')!.reason === 'SELECTED_FRESH'
    && byId(t, RT, 'rs-f2')!.reason === 'FRESH_DISPLACED_BY_RETRY_RESERVE' && t.summary.freshDisplacedByRetryReserve === 1)
  check('③ 재시도 표시 — 재시도 차례 · 기다린 시간(5h)이 남고 신규는 null',
    byId(t, RT, 'rs-r1')!.retry && byId(t, RT, 'rs-r1')!.retryTier === 2 && byId(t, RT, 'rs-r1')!.retryWaitedH === 5
    && byId(t, RT, 'rs-f1')!.retryTier === null && t.summary.retry.candidates === 1 && t.summary.fresh.candidates === 2)
  check('⑥ trace on/off — 예약석 사례 동일', selectionOf(off) === selectionOf(on))
  const R = [1, 2, 3].map((i) => ROW({ id: `rl-${i}`, ageH: 10 + i, cp: 0.5 }))
  const r2 = pipeline({ rows: R, slots: [S1], cap: 2, attempted: retryOf(R), jit: false, traced: true }).trace!
  const F = [1, 2].map((i) => ROW({ id: `fr-${i}`, ageH: 4, cp: 1 - i / 10 }))
  const f2 = pipeline({ rows: F, slots: [S1], cap: 1, jit: false, traced: true }).trace!
  check('③ 재시도 남은 칸(RETRY_FILLED) · 재시도 상한 밖(RETRY_LIMIT_CUT) · 신규 상한 밖(FRESH_RANK_CUT)이 서로 다르다',
    r2.summary.byReason.SELECTED_RETRY_RESERVED === 1 && r2.summary.byReason.SELECTED_RETRY_FILLED === 1
    && r2.summary.byReason.RETRY_LIMIT_CUT === 1 && f2.summary.byReason.FRESH_RANK_CUT === 1)
}

// ── ④ 축 자리가 원천을 뺀다 ──
{
  const rows = [
    ROW({ id: 'ax-s1', ageH: 5, cp: 0.9 }), ROW({ id: 'ax-s2', ageH: 5, cp: 0.8 }),
    ROW({ id: 'ax-r1', ageH: 5, cp: 0.95, axis: 'raw' }), ROW({ id: 'ax-r2', ageH: 5, cp: 0.7, axis: 'raw' }),
    ROW({ id: 'ax-r3', ageH: 5, cp: 0.6, axis: 'raw' }),
  ]
  const { off, on } = sameRun({ rows, slots: [S1, S2, S3], cap: 5 })
  const t = on.trace!
  check('④ 축 자리(JIT 실제 경로) — raw 3건 배정 · raw 자리 1 → 2건 AXIS_QUOTA_FULL',
    t.summary.byReason.AXIS_QUOTA_FULL === 2 && t.summary.axisQuotaDropped === 2
    && on.plan.axis.quota.raw === 1 && byId(t, RT, 'ax-r2')!.edf === 'ASSIGNED', JSON.stringify(on.plan.axis))
  check('⑥ trace on/off — 축 자리 사례 동일', selectionOf(off) === selectionOf(on))
  const z = pipeline({
    rows: [ROW({ id: 'az-s1', ageH: 5, cp: 0.9 }), ROW({ id: 'az-s2', ageH: 5, cp: 0.8 }), ROW({ id: 'az-r', ageH: 5, cp: 0.99, axis: 'raw' })],
    slots: [S1], cap: 2, jit: false, traced: true,
  }).trace!
  check('④ 축 자리 0(AXIS_QUOTA_ZERO)은 자리가 찬 것(AXIS_QUOTA_FULL)과 다른 사유다',
    byId(z, RT, 'az-r')!.reason === 'AXIS_QUOTA_ZERO', byId(z, RT, 'az-r')!.reason)
}

// ── ⑤ 최대 채울 수 있는 슬롯 수 · ⑥ on/off 무작위 50벌 ──
{
  let seed = 7
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  const allSlots = [1, 4, 8, 12, 20, 30].map((h) => new Date(NOW.getTime() + h * H))
  let same = 0
  let fillable = 0
  let consistent = 0
  let jitDisplaced = 0
  const seen = new Set<string>()
  const N = 50
  for (let n = 0; n < N; n += 1) {
    const rows = Array.from({ length: 30 }, (_, i) => ROW({
      id: `rnd-${n}-${i}`, site: rnd() < 0.45 ? WG : RT, ageH: 3 + Math.floor(rnd() * 75), cp: Math.round(rnd() * 100) / 100,
      axis: rnd() < 0.25 ? 'raw' : 'seed', title: rnd() < 0.15 ? '갱년기 열감 때문에 잠을 못 자요' : '오늘 있었던 우리 집 이야기',
    }))
    const attempted = retryOf(rows.filter(() => rnd() < 0.3), 2 + Math.floor(rnd() * 20))
    const slots = allSlots.filter(() => rnd() < 0.7)
    const cap = 1 + Math.floor(rnd() * 10)
    const { off, on } = sameRun({ rows, slots, cap, attempted })
    if (selectionOf(off) === selectionOf(on) && worksetDigestOf(off.plan.workset) === on.trace!.worksetDigest) same += 1
    if (off.assigned.size === on.assigned.size && new Set(off.assigned.values()).size === new Set(on.assigned.values()).size) fillable += 1
    const t = on.trace!
    const back = readSupplySelectionTrace(JSON.parse(serializeSelectionTrace(t)))
    const pickedHashes = on.plan.picked.map((r) => articleIdHashOf(r.sourceSite, r.sourceArticleId))
    if (back.ok && t.summary.mismatches === 0 && t.summary.selected === on.plan.picked.length
      && t.candidates.filter((c) => c.selected).every((c) => pickedHashes[c.position!] === c.sourceHash)) consistent += 1
    jitDisplaced += t.summary.freshDisplacedByRetryReserve
    for (const c of t.candidates) seen.add(c.reason)
  }
  const wanted = ['SELECTED_FRESH', 'SELECTED_RETRY_RESERVED', 'EDF_NOT_MATCHED', 'EDF_CAP_CUT', 'SLOT_INELIGIBLE', 'AXIS_QUOTA_FULL']
  check(`⑥ 무작위 ${N}벌이 여러 단계를 실제로 지난다(빈 대조가 아니다) — ${[...seen].sort().join(' · ')}`,
    wanted.every((w) => seen.has(w)), wanted.filter((w) => !seen.has(w)).join(','))
  check(`⑤ 최대 채운 슬롯 수 · 배정 수가 trace 전후 같다(무작위 ${N}벌)`, fillable === N, `${fillable}/${N}`)
  check(`⑥ trace on/off — 슬롯 · 묶음 · 순서 · 제외 · 축 · digest 동일(무작위 ${N}벌)`, same === N, `${same}/${N}`)
  check(`⑥ 무작위 ${N}벌 trace 가 실제 선택과 어긋나지 않는다(불일치 0 · 선택 위치 일치 · 다시 읽기 통과)`, consistent === N, `${consistent}/${N}`)
  check('구조 관측 — JIT(cap = 상한)에서는 예약석이 신규를 미는 일이 0 이다(무작위 50벌)', jitDisplaced === 0, String(jitDisplaced))
}

// ── ⑦ 갱년기 · ⑧ wgang 탈락 단계 ──
{
  const MENO_DONE = ROW({ id: 'mn-done', ageH: 5, cp: 0.9, title: '갱년기 열감 이야기' })
  const MENO_OLD = ROW({ id: 'mn-old', ageH: 90, cp: 0.9, title: '폐경 뒤 달라진 것' })
  const WG_CUT = ROW({ id: 'wg-cut', site: WG, ageH: 3, cp: 0.95 })
  const WG_MENO = ROW({ id: 'wg-meno', site: WG, ageH: 60, cp: 0.3, title: '호르몬 치료 고민' })
  const { on } = sameRun({
    rows: [MENO_DONE, MENO_OLD, WG_CUT, WG_MENO], slots: [S1, S3], cap: 1, concluded: new Set([KEY(MENO_DONE)]),
  })
  const s = on.trace!.summary
  check('⑦ 갱년기 후보 탈락 단계 — 끝난 원천 TERMINAL 1 · 72h 초과 SLOT_INELIGIBLE 1 · 선택 1',
    s.menopauseCore.candidates === 3 && s.menopauseCore.selected === 1
    && s.menopauseByReason.TERMINAL === 1 && s.menopauseByReason.SLOT_INELIGIBLE === 1, JSON.stringify(s.menopauseCore))
  check('⑧ wgang 후보 탈락 단계 — 최신 wgang 이 EDF 상한에 잘린 것(EDF_CAP_CUT)이 wgang 집계에 남는다',
    s.wgang.candidates === 2 && s.wgang.selected === 1 && s.wgangByReason.EDF_CAP_CUT === 1
    && s.menopauseWgang.candidates === 1 && s.menopauseWgang.selected === 1, JSON.stringify(s.wgangByReason.EDF_CAP_CUT))
  check('⑦ 갱년기 판정은 정본 `MENOPAUSE_RE` 하나 — 같은 글을 두 번 물어도 같은 답(전역 정규식 상태 없음)',
    mentionsMenopause('갱년기') && mentionsMenopause('갱년기') && !mentionsMenopause('남편 이야기'))
}

// ── ⑨ ⑩ ⑪ shadow ──
{
  // 같은 cp · 같은 viewsPct(0.6) · 같은 구간(슬롯 S1 기준 4h·5h → 3-6h) — 지금 순서는 어린 일반 원천이 먼저
  const GEN = ROW({ id: 'tie-gen', ageH: 3, cp: 0.8 })
  const MEN = ROW({ id: 'tie-men', ageH: 4, cp: 0.8, title: '갱년기 열감' })
  const t = pipeline({ rows: [GEN, MEN], slots: [S1], cap: 2, traced: true }).trace!
  check('⑨ 엄격 동률(같은 품질 tuple · 같은 신선도 구간)에서만 갱년기 선호가 순서를 바꿀 수 있다고 센다',
    t.shadow.strictTieGroups === 1 && t.shadow.menopauseCouldReorder === 1 && t.shadow.menopause === 'COMPUTED',
    JSON.stringify(t.shadow))
  const WGT = ROW({ id: 'tie-wg', site: WG, ageH: 4, cp: 0.8 })
  const t2 = pipeline({ rows: [GEN, WGT], slots: [S1], cap: 2, traced: true }).trace!
  check('⑨ 같은 갱년기 값 안에서만 wgang 선호를 센다', t2.shadow.wgangCouldReorder === 1 && t2.shadow.menopauseCouldReorder === 0)

  const HIGH = ROW({ id: 'nt-high', ageH: 3, cp: 0.9 })
  const LOWM = ROW({ id: 'nt-lowm', ageH: 3, cp: 0.5, title: '갱년기 이야기', site: WG })
  const t3 = pipeline({ rows: [HIGH, LOWM], slots: [S1], cap: 2, traced: true }).trace!
  const NEWG = ROW({ id: 'nt-new', ageH: 3, cp: 0.8 })
  const OLDM = ROW({ id: 'nt-oldm', ageH: 30, cp: 0.8, title: '갱년기 이야기', site: WG })
  const t4 = pipeline({ rows: [NEWG, OLDM], slots: [S1], cap: 2, traced: true }).trace!
  check('⑩ 엄격 동률이 아니면 갱년기 · wgang 이 높은 품질(0.9 > 0.5)이나 최신(3-6h vs 24-72h)을 이기지 않는다',
    t3.shadow.menopauseCouldReorder === 0 && t3.shadow.wgangCouldReorder === 0 && t3.shadow.menopause === 'NO_STRICT_TIE'
    && t4.shadow.menopauseCouldReorder === 0 && t4.shadow.strictTieGroups === 0, `${JSON.stringify(t3.shadow)} ${JSON.stringify(t4.shadow)}`)

  const U1 = ROW({ id: 'uk-1', ageH: 4, cp: 0.8, viewsNull: true, title: '갱년기' })
  const U2 = ROW({ id: 'uk-2', ageH: 4, cp: 0.8, viewsNull: true })
  const t5 = pipeline({ rows: [U1, U2], slots: [S1], cap: 2, traced: true }).trace!
  check('⑪ 품질 동등을 판단할 수 없으면(viewsPct 없음) shadow 는 UNKNOWN — 0 이나 효과 없음으로 바꾸지 않는다',
    t5.shadow.menopause === 'UNKNOWN' && t5.shadow.qualityUnknown === 2 && t5.shadow.noStrictTie === 0
    && t5.shadow.population === 2, JSON.stringify(t5.shadow))
  check('⑪ shadow 는 실제 선택에 적용되지 않는다 — 선택은 trace 없는 실행과 같다',
    selectionOf(pipeline({ rows: [GEN, MEN], slots: [S1], cap: 1, traced: false }))
    === selectionOf(pipeline({ rows: [GEN, MEN], slots: [S1], cap: 1, traced: true })))
}

// ── ⑫ 개인정보 ──
{
  const SECRET_ID = 'PRIVATEARTICLE998877'
  const rows = [
    ROW({ id: SECRET_ID, title: '비밀제목가나다 갱년기 https://cafe.naver.com/x', body: '비밀본문라마바 연락 me@example.com', ageH: 5, cp: 0.7 }),
    ROW({ id: 'privacy-2', site: WG, ageH: 6, cp: 0.6, title: '작성자닉네임테스트 이야기' }),
  ]
  const t = pipeline({ rows, slots: [S1], cap: 2, attempted: retryOf([rows[1]!]), traced: true }).trace!
  const body = serializeSelectionTrace(t)
  const leaks = [SECRET_ID, 'privacy-2', '비밀제목', '비밀본문', '작성자닉네임', 'http', 'naver.com', '@', 'example']
    .filter((s) => body.includes(s))
  check('⑫ trace 글자에 원문 id 평문 · 제목 · 본문 · URL · 이메일 · 닉네임 없음', leaks.length === 0, leaks.join(','))
  check('⑫ 원천은 sha256(site::id) 해시와 정본 원천 이름만',
    t.candidates.every((c) => /^[0-9a-f]{64}$/.test(c.sourceHash)) && t.candidates.some((c) => c.sourceHash === articleIdHashOf(RT, SECRET_ID)))
  const leaky = JSON.parse(body) as { candidates: Record<string, unknown>[] }
  leaky.candidates[0]!.title = '평문 제목'
  check('⑫ 정해진 칸 밖의 칸(title)이 붙은 trace 는 읽기에서 거부된다', !readSupplySelectionTrace(leaky).ok)
}

// ── ⑬ 손상 trace ──
{
  const t = pipeline({ rows: [ROW({ id: 'cr-1', ageH: 5, cp: 0.7 }), ROW({ id: 'cr-2', ageH: 40, cp: 0.5 })], slots: [S1, S3], cap: 1, traced: true }).trace!
  const fresh = (): Record<string, unknown> => JSON.parse(serializeSelectionTrace(t)) as Record<string, unknown>
  const cases: [string, (o: Record<string, unknown>) => void, string][] = [
    ['요약 수 변조', (o) => { (o.summary as Record<string, number>).selected += 1 }, 'SUMMARY_MISMATCH'],
    ['후보 칸 누락', (o) => { delete (o.candidates as Record<string, unknown>[])[0]!.reason }, 'candidates[0]:KEYS'],
    ['사유 enum 손상', (o) => { (o.candidates as Record<string, unknown>[])[0]!.reason = 'OK' }, 'candidates[0]:REASON'],
    ['선택 · 위치 모순', (o) => { (o.candidates as Record<string, unknown>[])[0]!.position = null }, ':SELECTED'],
    ['shadow 변조', (o) => { (o.shadow as Record<string, number>).menopauseCouldReorder = 9 }, 'SHADOW_MISMATCH'],
    ['판 손상', (o) => { o.version = 'selection-trace-v0' }, 'VERSION'],
    ['digest 누락', (o) => { delete o.worksetDigest }, 'TOP_KEYS'],
  ]
  const ok = readSupplySelectionTrace(fresh()).ok
  const caught = cases.filter(([, mutate, code]) => {
    const o = fresh(); mutate(o)
    const r = readSupplySelectionTrace(o)
    return !r.ok && r.problems.some((p) => p.includes(code))
  }).map(([n]) => n)
  check('⑬ 정상 trace 는 읽히고, 손상 · 누락 7종은 정상으로 읽히지 않는다(각각 다른 사유)',
    ok && caught.length === cases.length, `${caught.length}/${cases.length}`)
  check('⑬ 객체가 아니거나 잘린 글자는 정상이 아니다', !readSupplySelectionTrace(null).ok && !readSupplySelectionTrace([]).ok)
}

// ── ⑭ 실패가 되풀이 호출 · 중복 write 를 만들지 않는다 ──
{
  const t = pipeline({ rows: [ROW({ id: 'fx-1', ageH: 5, cp: 0.7 })], slots: [S1], cap: 1, traced: true }).trace!
  let builds = 0
  let writes = 0
  const r1 = recordSelectionTraceSafely({ build: () => { builds += 1; throw new Error('boom 원문') }, write: () => { writes += 1 } })
  check('⑭ 조립 실패 — 던지지 않고 build 1회 · write 0회 · 오류 문구에 원문 없음',
    !r1.ok && r1.stage === 'build' && builds === 1 && writes === 0 && !r1.error.includes('원문'))
  builds = 0; writes = 0
  const r2 = recordSelectionTraceSafely({ build: () => { builds += 1; return t }, write: () => { writes += 1; throw new Error('disk') } })
  check('⑭ 쓰기 실패 — 던지지 않고 재시도 없음(build 1 · write 1)', !r2.ok && r2.stage === 'write' && builds === 1 && writes === 1)
  builds = 0; writes = 0
  const bad = JSON.parse(serializeSelectionTrace(t)) as SupplySelectionTrace
  bad.summary.selected += 1
  const r3 = recordSelectionTraceSafely({ build: () => { builds += 1; return bad }, write: () => { writes += 1 } })
  check('⑭ 검증 실패 trace 는 쓰지 않는다(write 0)', !r3.ok && r3.stage === 'verify' && writes === 0)
  const r4 = recordSelectionTraceSafely({ build: () => t, write: null })
  check('⑭ dry-run(write=null)은 파일 0 · 정상', r4.ok && !r4.written)

  // 🔴 러너 연결 — 실제 소스에서 확인한다(관측 블록은 묶음을 쓴 뒤 · 유료 단계 앞 · DB · 자식 실행 없음)
  const src = readFileSync('scripts/supply-process.mts', 'utf-8')
  const assignAt = src.indexOf('const assigned = assignSourceSlots(')
  const selectAt = src.indexOf('const plan = selectWorkset(')
  const wsWriteAt = src.indexOf('writeAtomic(wsPath,')
  const traceAt = src.indexOf('const traced = recordSelectionTraceSafely(')
  const commonAt = src.indexOf('planBoundedCommonPhase(after1')
  const block = src.slice(traceAt, src.indexOf('\n    }\n', src.indexOf('선택 관측 trace 실패', traceAt)))
  check('⑭ 러너 — 기록기를 배정 · 묶음 선택 둘 다에 넘긴다',
    /assignSourceSlots\(\{[\s\S]{0,200}trace: recorder\.sink/.test(src.slice(assignAt, selectAt))
    && /trace: recorder\.sink/.test(src.slice(selectAt, wsWriteAt)))
  check('⑭ 러너 — trace 는 묶음 파일을 쓴 뒤 · 공통(유료) 단계 계획 전 · 한 번만',
    assignAt > 0 && selectAt > assignAt && wsWriteAt > selectAt && traceAt > wsWriteAt && commonAt > traceAt
    && src.split('recordSelectionTraceSafely(').length === 2)
  check('⑭ 러너 — trace 블록 안에 DB · 자식 실행 · provider · 묶음 재할당 없음',
    block.length > 0 && !/prisma|run\(|fetch\(|plan\s*=|assigned\s*=|workset\s*=/.test(block), block.slice(0, 80))
}

// ── ⑮ 반올림 없는 판정 (2026-10-10 마스터 보정) — 판정에는 원래 값 · 새 허용 오차 0 ──
{
  const r3 = (x: number): number => Math.round(x * 1000) / 1000
  const A = ROW({ id: 'rd-cp-a', ageH: 4, cp: 0.8004 })
  const B = ROW({ id: 'rd-cp-b', ageH: 4, cp: 0.8005 })
  const cpRun = sameRun({ rows: [A, B], slots: [S1], cap: 2 })
  check('⑮ commentsPct 0.8004 · 0.8005 는 엄격 동률이 아니다 — 값이 반올림 없이 그대로 남는다',
    cpRun.on.trace!.shadow.strictTieGroups === 0 && cpRun.on.trace!.shadow.noStrictTie === 2
    && byId(cpRun.on.trace!, RT, 'rd-cp-a')!.rank!.commentsPct === 0.8004
    && byId(cpRun.on.trace!, RT, 'rd-cp-b')!.rank!.commentsPct === 0.8005, JSON.stringify(cpRun.on.trace!.shadow))
  const C1 = ROW({ id: 'rd-cp-c', ageH: 4, cp: 0.8001 })
  const C2 = ROW({ id: 'rd-cp-d', ageH: 4, cp: 0.8004 })
  const mergeRun = sameRun({ rows: [C1, C2], slots: [S1], cap: 2 })
  check('⑮ commentsPct 0.8001 · 0.8004(0.001 반올림이면 둘 다 0.8 로 합쳐지는 쌍)도 엄격 동률이 아니다',
    r3(0.8001) === r3(0.8004) && mergeRun.on.trace!.shadow.strictTieGroups === 0, JSON.stringify(mergeRun.on.trace!.shadow))
  const V1 = ROW({ id: 'rd-vp-a', ageH: 4, cp: 0.8, vp: 0.6001 })
  const V2 = ROW({ id: 'rd-vp-b', ageH: 4, cp: 0.8, vp: 0.6004 })
  const vpRun = sameRun({ rows: [V1, V2], slots: [S1], cap: 2 })
  check('⑮ viewsPct 가 반올림 뒤에만 같아지는 두 후보(0.6001 · 0.6004)는 엄격 동률이 아니다',
    r3(0.6001) === r3(0.6004) && vpRun.on.trace!.shadow.strictTieGroups === 0 && vpRun.on.trace!.shadow.noStrictTie === 2,
    JSON.stringify(vpRun.on.trace!.shadow))

  // 슬롯 S0(NOW+0.5h) 기준 나이 2.9996h · 3.0004h
  const S0 = new Date(NOW.getTime() + 0.5 * H)
  const Y = ROW({ id: 'rd-age-y', ageH: 2.4996, cp: 0.8 })
  const O = ROW({ id: 'rd-age-o', ageH: 2.5004, cp: 0.8 })
  const ageRun = sameRun({ rows: [Y, O], slots: [S0], cap: 2 })
  const y = byId(ageRun.on.trace!, RT, 'rd-age-y')!
  const o = byId(ageRun.on.trace!, RT, 'rd-age-o')!
  check('⑮ 나이 2.9996h → <3h · 3.0004h → 3-6h (정본 구간을 원래 나이로) — 정본 rank 는 둘 다 3.000 으로 반올림돼 있다',
    y.freshnessBand === '<3h' && o.freshnessBand === '3-6h' && y.rank!.ageAtSlotH === 3 && o.rank!.ageAtSlotH === 3
    && Math.abs(y.sourceAgeH! - 2.9996) < 1e-9 && ageRun.on.trace!.shadow.strictTieGroups === 0,
    `${y.freshnessBand}/${y.sourceAgeH} · ${o.freshnessBand}/${o.sourceAgeH}`)

  // S3(NOW+30h)에서 72h 경계를 0.0006h 차이로 가른다 → S1 에서의 나이 차도 0.0006h
  const OLD = ROW({ id: 'rd-edf-old', ageH: 42.0004, cp: 0.5 })
  const FRESH = ROW({ id: 'rd-edf-fresh', ageH: 41.9998, cp: 0.9 })
  const edfRun = sameRun({ rows: [OLD, FRESH], slots: [S1, S3], cap: 1 })
  const eo = byId(edfRun.on.trace!, RT, 'rd-edf-old')!
  const ef = byId(edfRun.on.trace!, RT, 'rd-edf-fresh')!
  check('⑮ 나이 차 0.001h 미만(0.0006h)이어도 EDF 가 더 오래된 원천을 먼저 골랐으면 edfOlderOverFresher 에 잡힌다',
    eo.edf === 'ASSIGNED' && ef.edf === 'CAP_CUT' && edfRun.on.trace!.summary.edfOlderOverFresher === 1
    && r3(eo.slotAgesH![0]!) === r3(ef.slotAgesH![0]!), `${eo.slotAgesH?.join()} · ${ef.slotAgesH?.join()}`)

  const all = [cpRun, mergeRun, vpRun, ageRun, edfRun]
  check('⑮ 보정 반례 5벌 — 실제 슬롯 · 묶음 · 순서 · digest 가 trace 없는 실행과 같다',
    all.every(({ off, on }) => selectionOf(off) === selectionOf(on) && worksetDigestOf(off.plan.workset) === on.trace!.worksetDigest))
  const t = ageRun.on.trace!
  const bad = JSON.parse(serializeSelectionTrace(t)) as { candidates: Record<string, unknown>[] }
  bad.candidates.find((c) => c.sourceHash === y.sourceHash)!.freshnessBand = '3-6h'
  check('⑮ 원래 나이와 어긋나는 구간이 적힌 trace 는 손상으로 읽힌다',
    !readSupplySelectionTrace(bad).ok && readSupplySelectionTrace(JSON.parse(serializeSelectionTrace(t))).ok)
}

// ── 사유 · 단계 이름이 서로 겹치지 않는다 ──
check('사유 enum 은 중복이 없고 선택 단계 9종이 서로 다른 사유로 간다',
  new Set(TRACE_REASONS).size === TRACE_REASONS.length && WORKSET_SELECT_STEPS.length === 9)
check('shadow 는 후보 기록만으로 다시 계산된다(읽는 쪽 대조의 전제)',
  JSON.stringify(shadowOf([])) === JSON.stringify({
    population: 0, qualityUnknown: 0, noStrictTie: 0, strictTieGroups: 0, strictTieCandidates: 0,
    menopauseCouldReorder: 0, wgangCouldReorder: 0, menopause: 'NO_CANDIDATE', wgang: 'NO_CANDIDATE',
  }))

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail\n`)
process.exit(fail === 0 ? 0 : 1)
