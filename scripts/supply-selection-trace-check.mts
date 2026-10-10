#!/usr/bin/env tsx
/**
 * 🔴 **공급 선택 관측 trace 검사 — v2** (2026-10-10 P0-B1 · v1 은 P0-B0) — 순수 fixture · DB 0 · provider 0 · 네트워크 0
 *
 *   npm run supply:selection-trace-check
 *
 * 공급 러너와 **같은 연결**(생성 가능 판정 → `selectWorkset({ jit })` → `buildSupplySelectionTrace`)로 다음을 고정한다.
 *   ① trace 를 넘기든 안 넘기든 슬롯 배정 · 묶음 · 순서 · digest 가 같다(무작위 50벌)
 *   ② 원천이 멈춘 단계가 서로 다른 사유로 적힌다 · 재시도 예약 표시 · 순위 역전 0 · 동률 선호 횟수
 *   ③ 판정은 원래 나이로(반올림 없음) · 원문 · 제목 · id 평문 없음 · 손상 기록을 정상으로 읽지 않는다
 *   ④ v1 기록(P0-B0)을 계속 읽는다 · 실패가 되풀이 호출 · 중복 write 를 만들지 않는다
 */
import { readFileSync } from 'node:fs'

import {
  EMPTY_HUMAN_DECISIONS, EMPTY_SOURCE_KEYS, preGenerationRelease, selectWorkset, sourceIdentityOf, WGANG_SOURCE_SITE,
  type PriorOutcome, type WorksetRow,
} from '../src/lib/supply-workset'
import {
  buildSupplySelectionTrace, createSelectionRecorder, readSupplySelectionTrace, recordSelectionTraceSafely,
  serializeSelectionTrace, TRACE_REASONS, worksetDigestOf,
  type SupplySelectionTrace, type TraceCandidate,
} from '../src/lib/supply-selection-trace'
import { articleIdHashOf } from '../src/lib/source-slot-release'
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
const S1 = new Date(NOW.getTime() + 1 * H)
const S2 = new Date(NOW.getTime() + 10 * H)
const S3 = new Date(NOW.getTime() + 30 * H)

const ROW = (o: {
  id: string; site?: string; ageH?: number; posted?: Date | null; cp: number; vp?: number; axis?: 'seed' | 'raw'; title?: string; body?: string
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
  let ev = fakeSourceEvidence(NOW, {
    site, id: o.id, commentsPct: o.cp,
    ...(o.posted === null ? { postedAt: null } : o.posted !== undefined ? { postedAt: o.posted } : { ageH: o.ageH ?? 6 }),
  })
  if (o.vp !== undefined) ev = { ...ev, sourceStats: { ...ev.sourceStats!, viewsPct: o.vp } }
  return { sourceArticleId: o.id, sourceSite: site, commentCount: 10, sourcePostedAt: '', sourceListedAt: '', input: input!, evidence: ev }
}
const KEY = (r: WorksetRow): string => sourceIdentityOf(r.sourceSite, r.sourceArticleId)!
const retryOf = (rows: readonly WorksetRow[], waitedH = 5): Map<string, PriorOutcome> =>
  new Map(rows.map((r) => [KEY(r), {
    sourceKey: KEY(r), sourceArticleId: r.sourceArticleId, atMs: NOW.getTime() - waitedH * H, stage: 'judge' as const, state: 'retryable' as const,
  }]))

/** 🔴 공급 러너(`scripts/supply-process.mts`)와 같은 연결 */
const pipeline = (o: {
  rows: readonly WorksetRow[]; slots: readonly Date[]; cap: number
  attempted?: ReadonlyMap<string, PriorOutcome>; concluded?: ReadonlySet<string>; traced: boolean
}) => {
  const releaseOf = (r: WorksetRow) => {
    const d = o.slots.find((x) => preGenerationRelease(r, x, NOW).verdict === 'eligible')
    return preGenerationRelease(r, d ?? o.slots[0] ?? S1, NOW)
  }
  const rec = o.traced ? createSelectionRecorder() : null
  const attempted = o.attempted ?? new Map<string, PriorOutcome>()
  const plan = selectWorkset({
    rows: o.rows, humanDecided: EMPTY_HUMAN_DECISIONS, queuePending: new Set<string>(), queuedSources: EMPTY_SOURCE_KEYS,
    carriedOver: EMPTY_SOURCE_KEYS, concluded: o.concluded ?? new Set<string>(), attempted, releaseOf,
    jit: { slots: o.slots, now: NOW, cap: o.cap }, limit: Math.max(1, o.cap), runId: RUN, takenAt: NOW,
    ...(rec === null ? {} : { trace: rec.sink }),
  })
  const trace = rec === null ? null : buildSupplySelectionTrace({
    runId: RUN, takenAt: NOW, limit: Math.max(1, o.cap), cap: o.cap, slots: o.slots, record: rec.record,
    attempted, picked: plan.picked, workset: plan.workset, facts: plan.jit!, slotVerdict: (r, d) => preGenerationRelease(r, d, NOW),
  })
  return { plan, trace }
}
const selectionOf = (x: ReturnType<typeof pipeline>): string => JSON.stringify({
  workset: x.plan.workset, picked: x.plan.picked.map(KEY), dropped: x.plan.dropped, deferred: x.plan.deferred, jit: x.plan.jit,
})
const byId = (t: SupplySelectionTrace, site: string, id: string): TraceCandidate | undefined =>
  t.candidates.find((c) => c.sourceHash === articleIdHashOf(site, id))
const sameRun = (o: Omit<Parameters<typeof pipeline>[0], 'traced'>) => ({ off: pipeline({ ...o, traced: false }), on: pipeline({ ...o, traced: true }) })

console.log('\n══ 공급 선택 관측 trace v2 — 선택 불변 · 단계 사유 · 갱년기/wgang · 원래 값 · 개인정보 · v1 호환 ══\n')

// ── ① 선택 불변 · 무작위 50벌 ──
{
  let seed = 7
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  const allSlots = [1, 4, 8, 12, 20, 30].map((h) => new Date(NOW.getTime() + h * H))
  let same = 0, consistent = 0, inversions = 0
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
    const t = on.trace!
    const back = readSupplySelectionTrace(JSON.parse(serializeSelectionTrace(t)))
    const pickedHashes = on.plan.picked.map((r) => articleIdHashOf(r.sourceSite, r.sourceArticleId))
    if (back.ok && back.version === 'v2' && t.summary.mismatches === 0 && t.summary.selected === on.plan.picked.length
      && t.summary.maxFillableSlots === on.plan.jit!.maxFillableSlots && t.summary.coveredSlots === on.plan.jit!.coveredSlots
      && t.candidates.filter((c) => c.selected).every((c) => pickedHashes[c.position!] === c.sourceHash)) consistent += 1
    inversions += t.summary.rankInversions
    for (const c of t.candidates) seen.add(c.reason)
  }
  check(`① trace on/off — 슬롯 · 묶음 · 순서 · 제외 · JIT 사실 · digest 동일(무작위 ${N}벌)`, same === N, `${same}/${N}`)
  check(`① 무작위 ${N}벌 trace 가 실제 선택과 어긋나지 않는다(불일치 0 · 선택 위치 · 최대 슬롯 · 덮은 슬롯 일치 · 다시 읽기 v2)`, consistent === N, `${consistent}/${N}`)
  check(`② 무작위 ${N}벌 — 순위 역전 0(더 좋은 미선택 원천과 바꿔도 덮는 슬롯이 유지되는 쌍 없음)`, inversions === 0, String(inversions))
  const wanted = ['SELECTED_COVER', 'CAP_REACHED', 'RAW_NOT_AUTO_CONSUMED', 'SLOT_INELIGIBLE']
  check(`① 무작위 ${N}벌이 여러 단계를 실제로 지난다 — ${[...seen].sort().join(' · ')}`, wanted.every((w) => seen.has(w)), wanted.filter((w) => !seen.has(w)).join(','))
}

// ── ② 단계 사유 · 예약 표시 ──
{
  const done = ROW({ id: 'st-done', ageH: 5, cp: 0.9, title: '갱년기 열감 이야기' })
  const raw = ROW({ id: 'st-raw', ageH: 5, cp: 0.99, axis: 'raw', site: WG })
  const old = ROW({ id: 'st-old', ageH: 90, cp: 0.9 })
  const a = ROW({ id: 'st-a', ageH: 4, cp: 0.8, site: WG })
  const b = ROW({ id: 'st-b', ageH: 4, cp: 0.7 })
  const c = ROW({ id: 'st-c', ageH: 4, cp: 0.6 })
  const r = ROW({ id: 'st-r', ageH: 30, cp: 0.1 })
  const { off, on } = sameRun({ rows: [done, raw, old, a, b, c, r], slots: [S1, S2], cap: 3, attempted: retryOf([r], 9), concluded: new Set([KEY(done)]) })
  const t = on.trace!
  const rs = (id: string, site = RT): string => byId(t, site, id)!.reason
  check('② 끝난 원천 TERMINAL · raw RAW_NOT_AUTO_CONSUMED · 72h 초과 SLOT_INELIGIBLE · 상한 밖 CAP_REACHED — 서로 다른 사유',
    rs('st-done') === 'TERMINAL' && rs('st-raw', WG) === 'RAW_NOT_AUTO_CONSUMED' && rs('st-old') === 'SLOT_INELIGIBLE'
    && rs('st-c') === 'CAP_REACHED', `${rs('st-done')} ${rs('st-raw', WG)} ${rs('st-old')} ${rs('st-c')}`)
  check('② 재시도 예약 — 순위 최하위 재시도가 예약 표시와 함께 들어가고, 덮기 2 · 추가 1',
    byId(t, RT, 'st-r')!.selected && byId(t, RT, 'st-r')!.retryReserved && t.summary.retryReserved === 1
    && t.summary.byReason.SELECTED_COVER === 2 && t.summary.byReason.SELECTED_EXTRA === 1, JSON.stringify(t.summary.byReason))
  check('② 갱년기 · wgang 단계별 집계 — 갱년기 끝난 원천 TERMINAL 1 · wgang raw 제외 1 · wgang 선택 1',
    t.summary.menopauseByReason.TERMINAL === 1 && t.summary.wgangByReason.RAW_NOT_AUTO_CONSUMED === 1 && t.summary.wgang.selected === 1)
  check('② trace on/off — 이 사례도 동일', selectionOf(off) === selectionOf(on))
  const p5 = new Date(NOW.getTime() - 5 * H)
  const tie = [ROW({ id: 'pf-plain', posted: p5, cp: 0.7 }), ROW({ id: 'pf-meno', posted: p5, cp: 0.7, title: '갱년기 이야기' }), ROW({ id: 'pf-wg', posted: p5, cp: 0.7, site: WG })]
  const pt = pipeline({ rows: tie, slots: [S1], cap: 1, traced: true }).trace!
  check('② 정본 rank 동률에서만 갱년기 · wgang 이 순서를 정한 횟수를 센다(갱년기 1 · wgang 1)',
    pt.summary.preferenceDecided.menopause === 1 && pt.summary.preferenceDecided.wgang === 1 && byId(pt, RT, 'pf-meno')!.selected,
    JSON.stringify(pt.summary.preferenceDecided))
  const nt = pipeline({ rows: [ROW({ id: 'nt-hi', ageH: 3, cp: 0.9 }), ROW({ id: 'nt-lo', ageH: 3, cp: 0.5, title: '갱년기 이야기', site: WG })], slots: [S1], cap: 1, traced: true }).trace!
  check('② 품질이 다르면 선호가 순서를 정한 횟수 0 — 그대로 0 으로 적는다', nt.summary.preferenceDecided.menopause === 0 && nt.summary.preferenceDecided.wgang === 0)
}

// ── ③ 원래 값 ──
{
  const S0 = new Date(NOW.getTime() + 0.5 * H)
  const t = pipeline({ rows: [ROW({ id: 'rd-y', ageH: 2.4996, cp: 0.8 }), ROW({ id: 'rd-o', ageH: 2.5004, cp: 0.8 })], slots: [S0], cap: 2, traced: true }).trace!
  const y = byId(t, RT, 'rd-y')!, o = byId(t, RT, 'rd-o')!
  check('③ 나이 2.9996h → <3h · 3.0004h → 3-6h(원래 나이) — 정본 rank 는 둘 다 3.000 으로 반올림돼 있다',
    y.freshnessBand === '<3h' && o.freshnessBand === '3-6h' && y.rank!.ageAtSlotH === 3 && Math.abs(y.sourceAgeH! - 2.9996) < 1e-9)
  const v = pipeline({ rows: [ROW({ id: 'rv-a', ageH: 4, cp: 0.8001 }), ROW({ id: 'rv-b', ageH: 4, cp: 0.8004 })], slots: [S1], cap: 2, traced: true }).trace!
  check('③ commentsPct 0.8001 · 0.8004 는 반올림 없이 그대로 남는다', byId(v, RT, 'rv-a')!.rank!.commentsPct === 0.8001 && byId(v, RT, 'rv-b')!.rank!.commentsPct === 0.8004)
}

// ── ③ 개인정보 ──
{
  const SECRET = 'PRIVATEARTICLE998877'
  const rows = [
    ROW({ id: SECRET, title: '비밀제목가나다 갱년기 https://cafe.naver.com/x', body: '비밀본문라마바 연락 me@example.com', ageH: 5, cp: 0.7 }),
    ROW({ id: 'privacy-2', site: WG, ageH: 6, cp: 0.6, title: '작성자닉네임테스트 이야기' }),
  ]
  const t = pipeline({ rows, slots: [S1], cap: 2, attempted: retryOf([rows[1]!]), traced: true }).trace!
  const body = serializeSelectionTrace(t)
  const leaks = [SECRET, 'privacy-2', '비밀제목', '비밀본문', '작성자닉네임', 'http', 'naver.com', '@', 'example'].filter((s) => body.includes(s))
  check('③ trace 글자에 원문 id 평문 · 제목 · 본문 · URL · 이메일 · 닉네임 없음', leaks.length === 0, leaks.join(','))
  const leaky = JSON.parse(body) as { candidates: Record<string, unknown>[] }
  leaky.candidates[0]!.title = '평문 제목'
  check('③ 정해진 칸 밖의 칸(title)이 붙은 trace 는 읽기에서 거부된다', !readSupplySelectionTrace(leaky).ok)
}

// ── ③ 손상 trace ──
{
  const t = pipeline({ rows: [ROW({ id: 'cr-1', ageH: 5, cp: 0.7 }), ROW({ id: 'cr-2', ageH: 40, cp: 0.5 })], slots: [S1, S3], cap: 1, traced: true }).trace!
  const fresh = (): Record<string, unknown> => JSON.parse(serializeSelectionTrace(t)) as Record<string, unknown>
  const cases: [string, (o: Record<string, unknown>) => void, string][] = [
    ['요약 수 변조', (o) => { (o.summary as Record<string, number>).selected += 1 }, 'SUMMARY_MISMATCH'],
    ['선택 사실 변조', (o) => { (o.facts as Record<string, number>).maxFillableSlots += 1 }, 'FACTS_MISMATCH'],
    ['후보 칸 누락', (o) => { delete (o.candidates as Record<string, unknown>[])[0]!.reason }, 'candidates[0]:KEYS'],
    ['사유 enum 손상', (o) => { (o.candidates as Record<string, unknown>[])[0]!.reason = 'OK' }, 'candidates[0]:REASON'],
    ['선택 · 위치 모순', (o) => { (o.candidates as Record<string, unknown>[]).find((x) => x.selected)!.position = null }, ':SELECTED'],
    ['구간 · 원래 나이 모순', (o) => { (o.candidates as Record<string, unknown>[])[0]!.freshnessBand = '24-72h' }, ':BAND'],
    ['판 손상', (o) => { o.version = 'selection-trace-v9' }, 'VERSION'],
    ['digest 누락', (o) => { delete o.worksetDigest }, 'TOP_KEYS'],
  ]
  const caught = cases.filter(([, mutate, code]) => {
    const o = fresh(); mutate(o)
    const r = readSupplySelectionTrace(o)
    return !r.ok && r.problems.some((p) => p.includes(code))
  }).map(([n]) => n)
  check('③ 정상 v2 는 읽히고, 손상 · 누락 8종은 정상으로 읽히지 않는다(각각 다른 사유)',
    readSupplySelectionTrace(fresh()).ok && caught.length === cases.length, `${caught.length}/${cases.length}`)
  check('③ 객체가 아니거나 잘린 글자는 정상이 아니다', !readSupplySelectionTrace(null).ok && !readSupplySelectionTrace([]).ok)
}

// ── ④ v1 호환 ──
{
  const v1 = JSON.parse(readFileSync('scripts/fixtures/supply-selection-trace-v1.sample.json', 'utf-8')) as Record<string, unknown>
  const r = readSupplySelectionTrace(v1)
  check('④ P0-B0 이 만든 v1 기록(09ddfda 생성기 그대로 · 합성 원천)을 계속 읽는다 — 판 v1 로 돌려준다',
    r.ok && r.version === 'v1' && r.trace.candidates.length === 3, r.ok ? r.version : r.problems.join(','))
  const bad = JSON.parse(JSON.stringify(v1)) as { summary: Record<string, number> }
  bad.summary.selected += 1
  check('④ 손상된 v1 은 v1 판독기가 거부한다(조용히 정상 처리하지 않는다)', !readSupplySelectionTrace(bad).ok)
}

// ── ④ 실패가 되풀이 호출 · 중복 write 를 만들지 않는다 ──
{
  const t = pipeline({ rows: [ROW({ id: 'fx-1', ageH: 5, cp: 0.7 })], slots: [S1], cap: 1, traced: true }).trace!
  let builds = 0, writes = 0
  const r1 = recordSelectionTraceSafely({ build: () => { builds += 1; throw new Error('boom 원문') }, write: () => { writes += 1 } })
  check('④ 조립 실패 — 던지지 않고 build 1 · write 0 · 오류 문구에 원문 없음', !r1.ok && r1.stage === 'build' && builds === 1 && writes === 0 && !r1.error.includes('원문'))
  builds = 0; writes = 0
  const r2 = recordSelectionTraceSafely({ build: () => { builds += 1; return t }, write: () => { writes += 1; throw new Error('disk') } })
  check('④ 쓰기 실패 — 던지지 않고 재시도 없음(build 1 · write 1)', !r2.ok && r2.stage === 'write' && builds === 1 && writes === 1)
  writes = 0
  const bad = JSON.parse(serializeSelectionTrace(t)) as SupplySelectionTrace
  bad.summary.selected += 1
  const r3 = recordSelectionTraceSafely({ build: () => bad, write: () => { writes += 1 } })
  check('④ 검증 실패 trace 는 쓰지 않는다(write 0)', !r3.ok && r3.stage === 'verify' && writes === 0)
  const r4 = recordSelectionTraceSafely({ build: () => t, write: null })
  check('④ dry-run(write=null)은 파일 0 · 정상', r4.ok && !r4.written)

  const src = readFileSync('scripts/supply-process.mts', 'utf-8')
  const selectAt = src.indexOf('const plan = selectWorkset(')
  const wsWriteAt = src.indexOf('writeAtomic(wsPath,')
  const traceAt = src.indexOf('const traced = recordSelectionTraceSafely(')
  const commonAt = src.indexOf('planBoundedCommonPhase(after1')
  const block = src.slice(traceAt, src.indexOf('\n    }\n', src.indexOf('선택 관측 trace 실패', traceAt)))
  check('④ 러너 — 기록기를 JIT 선택에 넘기고 옛 짝짓기 경로가 없다',
    /jit: \{ slots: unfilledSlots[\s\S]{0,200}trace: recorder\.sink/.test(src.slice(selectAt, wsWriteAt)) && !/assignSourceSlots|intendedSlotOf/.test(src))
  check('④ 러너 — trace 는 묶음 파일을 쓴 뒤 · 공통(유료) 단계 계획 전 · 한 번만',
    selectAt > 0 && wsWriteAt > selectAt && traceAt > wsWriteAt && commonAt > traceAt && src.split('recordSelectionTraceSafely(').length === 2)
  check('④ 러너 — trace 블록 안에 DB · 자식 실행 · provider · 묶음 재할당 없음',
    block.length > 0 && !/prisma|run\(|fetch\(|plan\s*=|workset\s*=/.test(block), block.slice(0, 80))
}

check('사유 enum 은 중복이 없다', new Set(TRACE_REASONS).size === TRACE_REASONS.length)

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail\n`)
process.exit(fail === 0 ? 0 : 1)
