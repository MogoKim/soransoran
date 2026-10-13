#!/usr/bin/env tsx
/**
 * 🔴 **D100 Batch D1 — 날짜 정밀도 · 품질 동률 신선도 반례 검사** (2026-10-13) — fixture · DB 0 · 네트워크 0 · write 는 임시 디렉터리만
 *
 *   npm run check:d100-freshness
 *
 * 정본: `docs/operations/2026-09-21-d100-goal-canon.md` §2.1(날짜 정밀도) · §2.3(원천 순위 하나).
 *   ① 날짜만 보이는 라벨을 00:00 으로 만들지 않는다 — 수집 행 · 목록 관측 · 증거 기록 모두
 *   ② 판정은 하루 구간 **전체**로 한다(fail-closed) — 늙은 끝 통과만 eligible · 사이는 unknown · 어린 끝도 늙으면 만료
 *   ③ 원천 상대 반응은 구간이 걸친 관측 나이 구간 중 **가장 낮은 자리** — 불확실성으로 과대평가하지 않는다
 *   ④ 정확한 게시 시각의 판정 · 스냅샷은 앞판과 **같다**(무작위 대조)
 *   ⑤ 수집 상세 선별: **같은 점수 안에서만** 최신이 먼저 — 점수(품질)를 이기지 않는다(무작위 대조)
 *   ⑥ 레몬테라스 1p 제외 · 2~16p · 회차 상세 jjong 10 + humor 1 · 요청량 · 회차 · 페이지 수 불변
 *   ⑦ 갱년기 · wgang 은 순위 동률 해소 선호뿐 — quota · 가중치가 새로 생기지 않았다
 *   ⑧ 배선 — 수집 행 → 얇은 행 → adapt → 공급 러너(`worksetRows`) → 생성 전 판정 · 적재기(`sourceEvidenceOf`)가 같은 구간을 싣는다
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildSourceEvidence, compareReleaseRank, judgeSlotRelease, observationBucketOf, observationBucketsOf, parseEvidence,
  postedLowerBoundOf, postedWindowOfKstDay, relativePosition, sourceStatsSnapshot, EXPIRING_REASONS, SOURCE_STATS_METHOD,
  type ListObservation, type SlotReleaseVerdict, type SourceEvidenceRecord, type SourceStatsSnapshot,
} from '../src/lib/source-slot-release'
import { compareSupplyRank, preGenerationRelease, type SupplyRankKey } from '../src/lib/supply-workset'
import { thinRowFromCollected } from '../src/lib/micro-seed-navercafe-thin'
import { toDetailRecord, toRawDetailRecord } from '../src/lib/micro-seed-82cook-thin-adapt'
import { sourceEvidenceOf, type Candidate } from '../src/lib/micro-seed-supply-autofill'
import { MAX_REQUESTS_PER_DAY, RUNS_PER_DAY } from '../src/lib/collect-schedule'
import { buildCollected, parsePostedLabel, postedDayOfLabel, BOARD_TARGETS, pagesOf } from './lib/micro-seed-navercafe.mjs'
import { compareFreshFirst, planAutoFetch, SLOT_QUOTA, type AutoFetchInput } from './lib/micro-seed-supply.mjs'
import { planCafeRun } from './lib/navercafe-run-plan.mjs'
import { evidenceMaterialFor, postedOfListRow, readListObservations, type ListObservationIndex } from './lib/source-list-observations.mjs'
import { worksetRows } from './supply-process.mjs'

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

const H = 3_600_000
/** 🔴 결정적 난수 — 같은 입력이면 같은 결과다 */
const rng = (seed: number): (() => number) => {
  let x = seed >>> 0
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 32 }
}

/** 하루 구간이 있는 기록 — 게시 날짜 `day`(KST) · 수집 `captured` · 목록 `listed` */
const dayEvidence = (day: string, listed: Date, captured: Date, stats: Partial<SourceStatsSnapshot> = {}): SourceEvidenceRecord =>
  buildSourceEvidence({
    postedAt: null, postedWindow: postedWindowOfKstDay(day),
    listedAt: listed.toISOString(), capturedAt: captured.toISOString(),
    sourceSite: 'navercafe:fixture', sourceArticleId: 'd1', dedupKey: 'navercafe:fixture|d1',
    response: { views: 100, comments: 5, listRank: 3, listPage: 2, observedAt: listed.toISOString() },
    observations: [],
    sourceStats: {
      basis: 'list-artifacts', method: SOURCE_STATS_METHOD, sourceKey: 'navercafe:fixture', bucket: '24-72h', n: 9,
      commentsPct: 0.6, viewsPct: 0.5,
      windowFrom: new Date(captured.getTime() - 72 * H).toISOString(), windowTo: captured.toISOString(), ...stats,
    },
    participationDriver: '검사용',
  })
const judge = (ev: unknown, slotAt: Date, now: Date): SlotReleaseVerdict => judgeSlotRelease({
  evidence: ev, slotAt, now, hardGates: { ok: true, codes: [] }, assignment: 'pending', driver: 'pending', tieBreak: 't',
})

// ─────────────────────────────────────────────────────────
console.log('\n① 날짜만 보이는 라벨을 00:00 으로 만들지 않는다')
// ─────────────────────────────────────────────────────────
{
  const listed = '2026-10-12T22:30:00.000Z' // KST 10-13 07:30
  const now = new Date(listed)
  check('🔴 시각 해석은 null', parsePostedLabel('2026.10.12.', now) === null && parsePostedLabel('10.12.', now) === null)
  check('날짜는 그대로 남는다', postedDayOfLabel('2026.10.12.', now) === '2026-10-12' && postedDayOfLabel('10.12.', now) === '2026-10-12')
  const row = buildCollected('remonterrace', {
    sourceArticleId: '35080001', sourceUrl: 'https://cafe.naver.com/remonterrace/35080001',
    originalTitle: '어제 밤 이야기', sourceCommentCount: 3, sourcePostedLabel: '2026.10.12.',
  }, '', listed, listed)
  check('🔴 수집 행: sourcePostedAt null · sourcePostedDay 날짜', row.sourcePostedAt === null && row.sourcePostedDay === '2026-10-12',
    `${String(row.sourcePostedAt)} · ${String(row.sourcePostedDay)}`)
  const w = postedWindowOfKstDay('2026-10-12')
  check('하루 구간 = KST 00:00 ~ 다음 날 00:00', w !== null && w.from === '2026-10-11T15:00:00.000Z' && w.to === '2026-10-12T15:00:00.000Z')
  check('🔴 달력에 없는 날 · 모양이 다른 값은 구간이 없다',
    postedWindowOfKstDay('2026-02-30') === null && postedWindowOfKstDay('2026.10.12.') === null && postedWindowOfKstDay(null) === null)

  // 목록 관측 — 옛 수집기 줄(라벨 날짜 + 00:00 sourcePostedAt)도 라벨이 정한다
  const legacy = postedOfListRow({
    sourcePostedLabel: '2026.10.12.', sourcePostedAt: '2026-10-11T15:00:00.000Z',
  }, 'navercafe-run', listed)
  check('🔴 옛 줄의 00:00 sourcePostedAt 을 믿지 않는다 — 라벨이 날짜만 말한다',
    legacy.postedAt === null && legacy.postedWindow?.from === '2026-10-11T15:00:00.000Z', JSON.stringify(legacy))
  const fresh = postedOfListRow({ sourcePostedDay: '2026-10-12', sourcePostedAt: null, sourcePostedLabel: '2026.10.12.' }, 'navercafe-run', listed)
  check('지금 줄의 sourcePostedDay → 구간', fresh.postedAt === null && fresh.postedWindow?.to === '2026-10-12T15:00:00.000Z')
  const exact = postedOfListRow({ sourcePostedLabel: '07:12', sourcePostedAt: '2026-10-12T22:12:00.000Z' }, 'navercafe-run', listed)
  check('시각 라벨은 정확한 시각 그대로', exact.postedAt === '2026-10-12T22:12:00.000Z' && exact.postedWindow === null)
  const cook = postedOfListRow({ sourcePostedLabel: '2026.10.12.', sourcePostedAt: '2026-10-11T15:00:00.000Z' }, '82cook-append', listed)
  check('🔴 네이버 회차 모양이 아니면 라벨 규칙을 추측해 쓰지 않는다', cook.postedAt === '2026-10-11T15:00:00.000Z' && cook.postedWindow === null)
}

// ─────────────────────────────────────────────────────────
console.log('\n② 판정은 하루 구간 전체로 — fail-closed')
// ─────────────────────────────────────────────────────────
{
  // 게시 10-12(KST) · 목록 10-13 07:30 KST · 수집 07:31
  const listed = new Date('2026-10-12T22:30:00.000Z')
  const captured = new Date('2026-10-12T22:31:00.000Z')
  const ev = dayEvidence('2026-10-12', listed, captured)
  check('기록 모양 확인 통과', parseEvidence(ev).ok)
  check('🔴 기록에 00:00 시각이 없다', ev.postedAt === null && ev.postedWindow?.from === '2026-10-11T15:00:00.000Z')

  const early = judge(ev, new Date('2026-10-13T00:00:00.000Z'), captured)
  check('늙은 끝도 72h 안 → eligible', early.verdict === 'eligible', early.reasons.join())
  check('🔴 rank 나이는 늙은 끝(그날 00:00 기준) — 신선도를 부풀리지 않는다', early.rank.ageAtSlotH === 33,
    String(early.rank.ageAtSlotH))

  // 늙은 끝 72h = 10-14 15:00Z · 어린 끝 72h = 10-15 15:00Z(구간 끝 10-12T15:00Z 기준)
  const mid = judge(ev, new Date('2026-10-15T00:00:00.000Z'), captured)
  check('🔴 구간이 상한을 걸치면 unknown · POSTED_WITHIN_DAY_AT_SLOT', mid.verdict === 'unknown' && mid.reasons[0] === 'POSTED_WITHIN_DAY_AT_SLOT',
    `${mid.verdict} ${mid.reasons.join()}`)
  check('🔴 그 사유는 만료 사유다(시간이 지나도 known 이 되지 않는다)', mid.expires && EXPIRING_REASONS.includes('POSTED_WITHIN_DAY_AT_SLOT'))
  const late = judge(ev, new Date('2026-10-15T15:00:00.000Z'), captured)
  check('어린 끝도 72h 이상 → ineligible SOURCE_TOO_OLD_AT_SLOT', late.verdict === 'ineligible' && late.reasons[0] === 'SOURCE_TOO_OLD_AT_SLOT',
    `${late.verdict} ${late.reasons.join()}`)

  // 🔴 어린 끝은 수집 시각에서 닫는다 — 오늘 날짜 라벨을 아침에 봤으면 구간은 [00:00, 수집]
  const todayCap = new Date('2026-10-12T21:00:00.000Z') // KST 10-13 06:00
  const today = dayEvidence('2026-10-13', new Date('2026-10-12T20:59:00.000Z'), todayCap)
  const atEdge = judge(today, new Date(todayCap.getTime() + 72 * H), new Date(todayCap.getTime() + 72 * H))
  check('🔴 어린 끝 = min(다음 날 00:00, 수집 시각) — 수집 뒤 72h 면 만료', atEdge.verdict === 'ineligible' && atEdge.reasons[0] === 'SOURCE_TOO_OLD_AT_SLOT',
    `${atEdge.verdict} ${atEdge.reasons.join()}`)

  // 날짜가 수집보다 뒤 — 올라오기 전에 볼 수 없다
  const after = dayEvidence('2026-10-14', listed, captured)
  check('🔴 구간 시작이 수집보다 늦으면 POSTED_AFTER_CAPTURE', judge(after, new Date('2026-10-14T00:00:00.000Z'), new Date('2026-10-15T00:00:00.000Z')).reasons[0] === 'POSTED_AFTER_CAPTURE')

  // 🔴 구간 시작보다 이른 관측 — 순서 위반
  const before = { ...ev, listedAt: '2026-10-11T14:00:00.000Z', response: { ...ev.response!, observedAt: '2026-10-11T14:00:00.000Z' } }
  const bv = judge(before, new Date('2026-10-13T00:00:00.000Z'), captured)
  check('🔴 그날 00:00 보다 이른 관측은 EVIDENCE_INVALID(before-posted)', bv.reasons[0] === 'EVIDENCE_INVALID' && (bv.issue ?? '').endsWith(':before-posted'),
    `${bv.reasons.join()} ${String(bv.issue)}`)

  // 🔴 이 칸을 모르는 옛 판정기는 null 게시 시각을 모름으로 읽는다(fail-closed) — 칸을 지우면 POSTED_MISSING
  const stripped: Record<string, unknown> = { ...ev }
  delete stripped.postedWindow
  check('🔴 구간을 잃으면 POSTED_MISSING(unknown) — 00:00 으로 되살아나지 않는다', judge(stripped, new Date('2026-10-13T00:00:00.000Z'), captured).reasons[0] === 'POSTED_MISSING')

  // 기록 손상
  const bad = (patch: Record<string, unknown>): string | null => {
    const r = parseEvidence({ ...ev, ...patch })
    return r.ok ? null : r.issue
  }
  check('🔴 구간이 하루가 아니면 손상', bad({ postedWindow: { from: '2026-10-11T15:00:00.000Z', to: '2026-10-12T16:00:00.000Z' } }) === 'postedWindow:corrupt')
  check('🔴 KST 자정에서 시작하지 않으면 손상', bad({ postedWindow: { from: '2026-10-11T16:00:00.000Z', to: '2026-10-12T16:00:00.000Z' } }) === 'postedWindow:corrupt')
  check('🔴 정규 ISO 가 아니면 손상', bad({ postedWindow: { from: '2026-10-12T00:00:00+09:00', to: '2026-10-12T15:00:00.000Z' } }) === 'postedWindow:corrupt')
  check('🔴 정확한 시각과 함께 오면 손상(하나를 조용히 고르지 않는다)', bad({ postedAt: '2026-10-11T15:00:00.000Z' }) === 'postedWindow:with-postedAt')
  check('구간 null 은 칸 없음과 같다', parseEvidence({ ...ev, postedWindow: null, postedAt: '2026-10-12T01:00:00.000Z' }).ok)
  check('하한 helper: 정확 → 그 시각 · 구간 → 00:00 · 손상 → null',
    postedLowerBoundOf({ postedAt: '2026-10-12T01:00:00.000Z' })?.toISOString() === '2026-10-12T01:00:00.000Z'
      && postedLowerBoundOf(ev)?.toISOString() === '2026-10-11T15:00:00.000Z'
      && postedLowerBoundOf({ postedAt: 'x', postedWindow: ev.postedWindow }) === null)
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 원천 상대 반응 — 걸친 구간 중 가장 낮은 자리')
// ─────────────────────────────────────────────────────────
{
  const site = 'navercafe:fixture'
  const at = new Date('2026-10-12T23:00:00.000Z')
  const observedAt = '2026-10-12T22:30:00.000Z' // KST 10-13 07:30
  // 후보: 10-12(KST) 날짜만 — 관측 나이 [7.5h, 31.5h] → 6-12h · 12-24h · 24-72h
  const spanned = observationBucketsOf(null, postedWindowOfKstDay('2026-10-12'), observedAt)
  check('구간 셋에 걸친다', JSON.stringify(spanned) === JSON.stringify(['6-12h', '12-24h', '24-72h']), JSON.stringify(spanned))
  check('정확한 시각은 구간 하나', JSON.stringify(observationBucketsOf('2026-10-12T20:00:00.000Z', null, observedAt)) === '["<3h"]')
  const mk = (id: string, ageH: number, comments: number): ListObservation => ({
    sourceKey: site, articleKey: `${site}::${id}`, postedAt: new Date(Date.parse(observedAt) - ageH * H).toISOString(),
    observedAt, views: comments * 10, comments,
  })
  // 6-12h 표본은 댓글이 적고(후보가 높은 자리), 24-72h 표본은 많다(후보가 낮은 자리)
  const sample: ListObservation[] = [
    mk('a', 8, 1), mk('b', 9, 2), mk('c', 10, 3),
    mk('d', 14, 3), mk('e', 16, 6), mk('f', 20, 9),
    mk('g', 30, 10), mk('h', 40, 20), mk('i', 50, 30),
  ]
  const snap = sourceStatsSnapshot({
    sourceKey: site, articleKey: `${site}::cand`, postedAt: null, postedWindow: postedWindowOfKstDay('2026-10-12'),
    observedAt, comments: 5, views: 50, sample, at,
  })
  check('🔴 가장 낮은 자리 = 24-72h 구간(늙은 표본과 견준 자리)', snap?.bucket === '24-72h' && snap.commentsPct === 0, JSON.stringify(snap))
  const exactSnap = sourceStatsSnapshot({
    sourceKey: site, articleKey: `${site}::cand`, postedAt: new Date(Date.parse(observedAt) - 9.5 * H).toISOString(),
    observedAt, comments: 5, views: 50, sample, at,
  })
  check('대조: 정확히 9.5h 면 6-12h 에서 높은 자리', exactSnap?.bucket === '6-12h' && exactSnap.commentsPct === 1)
  // 걸친 구간 하나가 한 점이면 가장 나쁜 경우를 말할 수 없다 → 그 구간(판정: 모름)
  const thin = sample.filter((o) => !['d', 'e', 'f'].includes(o.articleKey.split('::')[1]!))
  const un = sourceStatsSnapshot({
    sourceKey: site, articleKey: `${site}::cand`, postedAt: null, postedWindow: postedWindowOfKstDay('2026-10-12'),
    observedAt, comments: 5, views: 50, sample: thin, at,
  })
  check('🔴 자리를 못 잰 구간이 있으면 그 구간을 낸다(n=0 → RESPONSE_UNNORMALIZED)', un?.bucket === '12-24h' && un.n === 0, JSON.stringify(un))
  // 표본 쪽 날짜만 아는 줄은 관측 나이가 한 구간에 다 들어올 때만 표본이다
  const dayRow: ListObservation = {
    sourceKey: site, articleKey: `${site}::z`, postedAt: null, postedWindow: postedWindowOfKstDay('2026-10-12'),
    observedAt, views: 9999, comments: 999,
  }
  const withDay = sourceStatsSnapshot({
    sourceKey: site, articleKey: `${site}::cand`, postedAt: new Date(Date.parse(observedAt) - 9.5 * H).toISOString(),
    observedAt, comments: 5, views: 50, sample: [...sample, dayRow], at,
  })
  check('🔴 구간이 여럿에 걸친 표본 줄은 어느 구간 표본도 아니다', withDay?.n === 3 && withDay.commentsPct === 1, JSON.stringify(withDay))

  // 🔴 정확한 시각이면 앞판 스냅샷과 같다 — 앞판 식을 그대로 옮긴 참조 구현과 무작위 대조
  const legacySnapshot = (input: { postedAt: string; observedAt: string; comments: number | null; views: number | null; sample: ListObservation[] }): SourceStatsSnapshot | null => {
    const bucket = observationBucketOf((Date.parse(input.observedAt) - Date.parse(input.postedAt)) / H)
    if (bucket === null) return null
    const toMs = at.getTime()
    const fromMs = toMs - 72 * H
    const latest = new Map<string, ListObservation>()
    for (const o of input.sample) {
      if (o.sourceKey !== site || o.postedAt === null) continue
      const om = Date.parse(o.observedAt)
      if (om < fromMs || om > toMs) continue
      if (observationBucketOf((om - Date.parse(o.postedAt)) / H) !== bucket) continue
      if (o.articleKey === `${site}::cand`) continue
      const prev = latest.get(o.articleKey)
      if (prev === undefined || prev.observedAt < o.observedAt) latest.set(o.articleKey, o)
    }
    const rows = [...latest.values()]
    return {
      basis: 'list-artifacts', method: SOURCE_STATS_METHOD, sourceKey: site, bucket, n: rows.length,
      commentsPct: relativePosition(input.comments, rows.map((r) => r.comments).filter((x): x is number => x !== null)),
      viewsPct: relativePosition(input.views, rows.map((r) => r.views).filter((x): x is number => x !== null)),
      windowFrom: new Date(fromMs).toISOString(), windowTo: at.toISOString(),
    }
  }
  const r = rng(20261013)
  let same = 0
  const N = 400
  for (let k = 0; k < N; k += 1) {
    const obs = new Date(at.getTime() - Math.floor(r() * 60) * H).toISOString()
    const smp: ListObservation[] = Array.from({ length: 4 + Math.floor(r() * 20) }, (_, j) => ({
      sourceKey: r() < 0.9 ? site : 'navercafe:other', articleKey: `${site}::${j % 7}`,
      postedAt: new Date(Date.parse(obs) - r() * 80 * H).toISOString(),
      observedAt: new Date(Date.parse(obs) - Math.floor(r() * 3) * H).toISOString(),
      views: r() < 0.1 ? null : Math.floor(r() * 50), comments: r() < 0.1 ? null : Math.floor(r() * 6),
    }))
    const posted = new Date(Date.parse(obs) - r() * 80 * H).toISOString()
    const c = Math.floor(r() * 6)
    const a = sourceStatsSnapshot({ sourceKey: site, articleKey: `${site}::cand`, postedAt: posted, observedAt: obs, comments: c, views: c * 7, sample: smp, at })
    const b = legacySnapshot({ postedAt: posted, observedAt: obs, comments: c, views: c * 7, sample: smp })
    if (JSON.stringify(a) === JSON.stringify(b)) same += 1
  }
  check(`🔴 정확한 시각의 스냅샷은 앞판과 같다 (무작위 ${N}벌)`, same === N, `${same}/${N}`)
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 정확한 게시 시각의 판정은 앞판과 같다')
// ─────────────────────────────────────────────────────────
{
  const r = rng(7)
  let ok = 0
  const N = 500
  for (let k = 0; k < N; k += 1) {
    const now = new Date(Date.UTC(2026, 9, 12, Math.floor(r() * 24)))
    // 🔴 목록 · 수집은 판정 시각보다 앞이다(fixture 가 실제보다 강하지 않게 — 미래 관측은 따로 막힌다)
    const posted = new Date(now.getTime() - (2 + r() * 88) * H)
    const listed = new Date(posted.getTime() + r() * 2 * H)
    const ev = buildSourceEvidence({
      postedAt: posted.toISOString(), listedAt: listed.toISOString(), capturedAt: new Date(listed.getTime() + 60_000).toISOString(),
      sourceSite: 's', sourceArticleId: String(k), response: { views: 3, comments: 1, observedAt: listed.toISOString() },
      sourceStats: {
        basis: 'list-artifacts', method: SOURCE_STATS_METHOD, sourceKey: 's', bucket: '<3h', n: 4, commentsPct: 0.5, viewsPct: 0.5,
        windowFrom: new Date(now.getTime() - 72 * H).toISOString(), windowTo: now.toISOString(),
      },
      participationDriver: 'x',
    })
    const slot = new Date(now.getTime() + r() * 40 * H)
    const v = judge(ev, slot, now)
    // 앞판 식: age = max(0, slot − posted) · `age < 72` 면 다음 단계, 아니면 SOURCE_TOO_OLD_AT_SLOT
    const age = Math.max(0, slot.getTime() - posted.getTime()) / H
    const expect = age < 72 ? 'eligible' : 'ineligible'
    if (v.verdict === expect && v.rank.ageAtSlotH === Math.round(age * 1000) / 1000
      && (expect === 'eligible' || v.reasons[0] === 'SOURCE_TOO_OLD_AT_SLOT')) ok += 1
  }
  check(`🔴 정확한 시각 — 판정 · 나이 · 사유가 앞판 식과 같다 (무작위 ${N}벌)`, ok === N, `${ok}/${N}`)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 목록 관측 → 증거 재료: 수집이 본 줄이 날짜만 말하면 구간이다')
// ─────────────────────────────────────────────────────────
{
  const site = 'navercafe:remonterrace'
  const observedAt = '2026-10-12T22:30:00.000Z'
  const row = (id: string, postedAt: string | null, postedWindow: ReturnType<typeof postedWindowOfKstDay>, comments: number) => ({
    sourceKey: site, articleKey: `${site}::${id}`, postedAt, postedWindow, observedAt, views: comments * 10, comments, listRank: 1, listPage: 2,
  })
  const w = postedWindowOfKstDay('2026-10-12')
  const sample = [
    row('cand', null, w, 5),
    ...Array.from({ length: 6 }, (_, i) => row(`o${i}`, new Date(Date.parse(observedAt) - (30 + i * 5) * H).toISOString(), null, i * 3)),
    ...Array.from({ length: 6 }, (_, i) => row(`m${i}`, new Date(Date.parse(observedAt) - (13 + i) * H).toISOString(), null, i)),
    ...Array.from({ length: 6 }, (_, i) => row(`y${i}`, new Date(Date.parse(observedAt) - (7 + i * 0.5) * H).toISOString(), null, i)),
  ]
  const idx: ListObservationIndex = {
    sample, byArticle: new Map(sample.map((o) => [o.articleKey, [o]])), files: 1, ignoredFiles: 0,
    byFormat: { 'navercafe-run': 1, '82cook-append': 0 }, unreadable: 0, unobservable: 0,
  }
  // 상세 행이 옛 수집기의 00:00 을 실어 와도
  const m = evidenceMaterialFor(idx, {
    sourceKey: site, articleId: 'cand', postedAt: '2026-10-11T15:00:00.000Z', listedAt: observedAt, at: new Date('2026-10-12T23:00:00.000Z'),
  })
  check('🔴 재료가 하루 구간을 낸다', m.postedWindow?.from === w?.from)
  check('🔴 스냅샷도 구간으로 잰다(00:00 단일 구간이 아니다) — 가장 낮은 자리', m.sourceStats?.bucket === '24-72h' && m.sourceStats.commentsPct !== null,
    JSON.stringify(m.sourceStats))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 수집 상세 선별 — 같은 점수 안에서만 최신이 먼저')
// ─────────────────────────────────────────────────────────
{
  const today = (hh: number): string => new Date(Date.UTC(2026, 9, 12, hh - 9 + 24)).toISOString()
  const p = planAutoFetch([
    { sourceArticleId: '35080001', score: 40, flags: [], postedFrom: today(6) },
    { sourceArticleId: '35080500', score: 40, flags: [], postedFrom: today(9) },
    { sourceArticleId: '35070000', score: 40, flags: [], postedFrom: postedWindowOfKstDay('2026-10-12')!.from },
    { sourceArticleId: '35060000', score: 55, flags: [], postedFrom: postedWindowOfKstDay('2026-10-11')!.from },
  ], { max: 3 })
  check('🔴 높은 점수가 먼저 — 오래된 글이라도 점수를 잃지 않는다', p.picked[0] === '35060000', p.picked.join())
  check('같은 점수 안에서 최신(09시) → 06시 순', p.picked[1] === '35080500' && p.picked[2] === '35080001', p.picked.join())
  check('같은 점수 · 날짜만 아는 어제 글은 오늘 글 뒤', p.skipped.some((s) => s.sourceArticleId === '35070000' && s.reason === 'OVER_MAX'))
  const sameDay = planAutoFetch([
    { sourceArticleId: '35070000', score: 40, flags: [], postedFrom: postedWindowOfKstDay('2026-10-12')!.from },
    { sourceArticleId: '35070900', score: 40, flags: [], postedFrom: postedWindowOfKstDay('2026-10-12')!.from },
  ], { max: 1 })
  check('🔴 같은 날짜만 아는 글끼리는 큰 글 번호(나중에 올라온 글)가 먼저', sameDay.picked[0] === '35070900', sameDay.picked.join())
  const noTime = planAutoFetch([
    { sourceArticleId: '100', score: 40, flags: [] },
    { sourceArticleId: '99', score: 40, flags: [] },
  ], { max: 1 })
  check('🔴 글 번호는 숫자로 견준다(문자열 "100" < "99" 함정)', noTime.picked[0] === '100', noTime.picked.join())
  check('숫자가 아닌 열쇠는 옛 결정적 순서', compareFreshFirst({ sourceArticleId: 'a1', score: 0, flags: [] }, { sourceArticleId: 'a2', score: 0, flags: [] }) < 0)

  // 🔴 무작위 대조 — 고른 집합의 점수 다중집합은 앞판(점수 → 글 번호 오름차순)과 같다(점수를 이기지 않는다)
  const r = rng(99)
  let sameScores = 0
  let sortedByScore = 0
  let changed = 0
  const N = 500
  for (let k = 0; k < N; k += 1) {
    const rows: AutoFetchInput[] = Array.from({ length: 5 + Math.floor(r() * 30) }, (_, i) => ({
      sourceArticleId: String(3_500_000_000 + Math.floor(r() * 100_000) * 100 + i),
      score: [0, 8, 20, 40, 48, 55, 63][Math.floor(r() * 7)]!,
      flags: r() < 0.08 ? ['politicalTopicLikely'] : [],
      alreadyInVault: r() < 0.1,
      postedFrom: r() < 0.2 ? null : new Date(Date.UTC(2026, 9, 10) + Math.floor(r() * 72) * H).toISOString(),
    }))
    const max = 1 + Math.floor(r() * 12)
    const now = planAutoFetch(rows, { max })
    const admissible = planAutoFetch(rows, { max: Number.MAX_SAFE_INTEGER }).picked
    const byId = new Map(rows.map((x) => [x.sourceArticleId, x]))
    const legacy = [...admissible].sort((a, b) => byId.get(b)!.score - byId.get(a)!.score || a.localeCompare(b)).slice(0, max)
    const scoresOf = (ids: readonly string[]): string => ids.map((id) => byId.get(id)!.score).sort((a, b) => a - b).join()
    if (scoresOf(now.picked) === scoresOf(legacy)) sameScores += 1
    if (now.picked.every((id, i) => i === 0 || byId.get(now.picked[i - 1]!)!.score >= byId.get(id)!.score)) sortedByScore += 1
    if (now.picked.join() !== legacy.join()) changed += 1
  }
  check(`🔴 고른 집합의 점수 다중집합이 앞판과 같다 — 점수를 이기지 않는다 (무작위 ${N}벌)`, sameScores === N, `${sameScores}/${N}`)
  check(`🔴 고른 순서는 점수 내림차순을 지킨다 (무작위 ${N}벌)`, sortedByScore === N, `${sortedByScore}/${N}`)
  check('동률 해소가 실제로 작동한다(바뀐 벌이 있다)', changed > 0, `${changed}/${N}`)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 레몬테라스 1p 제외 · 2~16p · jjong 10 + humor 1 · 요청량 · 회차 불변')
// ─────────────────────────────────────────────────────────
{
  const jjong = BOARD_TARGETS.find((b) => b.key === 'remonterrace:jjong')!
  const humor = BOARD_TARGETS.find((b) => b.key === 'remonterrace:humor')!
  const wgang = BOARD_TARGETS.find((b) => b.key === 'wgang:all')!
  check('🔴 jjong 2~16p · 1p 를 읽지 않는다', jjong.startPage === 2 && jjong.endPage === 16 && !pagesOf(jjong).includes(1) && pagesOf(jjong).length === 15)
  check('humor 1p 하나', humor.startPage === 1 && humor.endPage === 1)
  check('wgang 1~5p 그대로', wgang.startPage === 1 && wgang.endPage === 5)
  const rt = planCafeRun({ cafeId: 'remonterrace' })
  const wg = planCafeRun({ cafeId: 'wgang' })
  const d = (p: typeof rt, k: string): number | undefined => p.boards.find((b) => b.key === k)?.detailMax
  check('🔴 회차 상세 jjong 10 + humor 1', d(rt, 'remonterrace:jjong') === 10 && d(rt, 'remonterrace:humor') === 1 && rt.detailPerRun === 11,
    `${String(d(rt, 'remonterrace:jjong'))} + ${String(d(rt, 'remonterrace:humor'))}`)
  check('🔴 레몬테라스 하루 요청 145 ≤ 150 · 목록 16/회차 · 5회차', rt.requestsPerDay + rt.memberCheckPerDay === 145 && rt.listPerRun === 16 && rt.runsPerDay === 5 && rt.withinLimit)
  check('🔴 wgang 하루 요청 88 ≤ 150 · 상세 16/회차 · 4회차', wg.requestsPerDay + wg.memberCheckPerDay === 88 && wg.detailPerRun === 16 && wg.runsPerDay === 4 && wg.withinLimit)
  check('🔴 일 상한 · 회차 · 슬롯 quota 상수 불변',
    MAX_REQUESTS_PER_DAY['navercafe:remonterrace'] === 150 && MAX_REQUESTS_PER_DAY['navercafe:wgang'] === 150
      && RUNS_PER_DAY['navercafe:remonterrace']?.start === 5 && RUNS_PER_DAY['navercafe:wgang']?.start === 4
      && SLOT_QUOTA.navercafe === 10)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 갱년기 · wgang 은 동률 해소뿐 — quota · 가중치 없음 · 신선도가 품질을 이기지 않는다')
// ─────────────────────────────────────────────────────────
{
  const rank = (commentsPct: number, viewsPct: number, ageAtSlotH: number) => ({ commentsPct, viewsPct, ageAtSlotH, velocity: null, tieBreak: '' })
  const k = (r: ReturnType<typeof rank>, menopause: boolean, wgang: boolean, key: string): SupplyRankKey => ({ rank: r, menopause, wgang, key })
  check('🔴 더 낮은 품질의 갱년기 · wgang 이 높은 품질을 이기지 않는다',
    compareSupplyRank(k(rank(0.9, 0.5, 40), false, false, 'a'), k(rank(0.8, 0.9, 1), true, true, 'b')) < 0)
  check('🔴 신선도가 품질을 이기지 않는다 — 댓글 자리가 높으면 늙어도 앞', compareReleaseRank(rank(0.9, 0.1, 70), rank(0.89, 0.9, 1)) < 0)
  check('품질 동률이면 최신이 앞', compareReleaseRank(rank(0.7, 0.6, 30), rank(0.7, 0.6, 5)) > 0)
  check('품질 · 신선도 동률이면 갱년기 → wgang',
    compareSupplyRank(k(rank(0.7, 0.6, 5), false, true, 'a'), k(rank(0.7, 0.6, 5), true, false, 'b')) > 0
      && compareSupplyRank(k(rank(0.7, 0.6, 5), false, false, 'a'), k(rank(0.7, 0.6, 5), false, true, 'b')) > 0)
  // 정적: 판정 정본 · 수집 동률 비교에 주제 · 출처 · 가중치가 새로 들어오지 않았다
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const release = strip(readFileSync('src/lib/source-slot-release.ts', 'utf8'))
  check('🔴 판정 정본에 갱년기 · wgang · 가중치 · quota 가 없다', !/menopause|wgang|WEIGHT|weight|quota/i.test(release))
  const supply = strip(readFileSync('scripts/lib/micro-seed-supply.mts', 'utf8'))
  const fresh = supply.slice(supply.indexOf('export function compareFreshFirst'), supply.indexOf('export function planAutoFetch'))
  check('🔴 수집 동률 비교는 점수 · 게시 시각 · 글 번호만 본다', fresh.length > 0 && !/flags|menopause|wgang|weight|quota/i.test(fresh))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑨ 배선 — 수집 행 → 얇은 행 → adapt → 공급 러너 · 적재기가 같은 하루 구간을 싣는다')
// ─────────────────────────────────────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'd100-fresh-'))
  const listed = '2026-10-12T22:30:00.000Z' // KST 10-13 07:30 회차
  const captured = '2026-10-12T22:31:00.000Z'
  const item = (id: string, label: string, comments: number) => ({
    sourceArticleId: id, sourceUrl: `https://cafe.naver.com/remonterrace/${id}`, originalTitle: `우리 집 이야기 ${id}`,
    sourceCommentCount: comments, sourceCommentCountRead: true, sourceViewCount: comments * 40, sourcePostedLabel: label,
    sourcePage: 3, sourceRankOnPage: 1, sourceBoardName: '쫑알쫑알 게시판', sourceBoardKey: 'remonterrace:jjong',
  })
  const rows = [
    buildCollected('remonterrace', item('35080100', '2026.10.12.', 6), '', listed, listed),
    // 표본 — 정확한 시각(24-72h · 12-24h · 6-12h 에 고루) · 같은 원천
    ...[30, 34, 40, 46, 52, 60].map((h, i) => ({
      ...buildCollected('remonterrace', item(String(35070000 + i), '01:00', i * 4), '', listed, listed),
      sourcePostedAt: new Date(Date.parse(listed) - h * H).toISOString(),
    })),
    ...[13, 15, 17, 19, 21, 23].map((h, i) => ({
      ...buildCollected('remonterrace', item(String(35075000 + i), '01:00', i), '', listed, listed),
      sourcePostedAt: new Date(Date.parse(listed) - h * H).toISOString(),
    })),
    ...[7, 8, 9, 10, 11, 11.5].map((h, i) => ({
      ...buildCollected('remonterrace', item(String(35079000 + i), '01:00', i), '', listed, listed),
      sourcePostedAt: new Date(Date.parse(listed) - h * H).toISOString(),
    })),
  ]
  // 🔴 옛 수집기 모양 하나 — 날짜 라벨 + 00:00 sourcePostedAt(라벨이 이긴다)
  const legacyRow = { ...buildCollected('remonterrace', item('35080200', '2026.10.12.', 6), '', listed, listed), sourcePostedAt: '2026-10-11T15:00:00.000Z', sourcePostedDay: undefined }
  writeFileSync(join(dir, 'navercafe-remonterrace-20261012-223000.list.jsonl'), `${[...rows, legacyRow].map((r) => JSON.stringify(r)).join('\n')}\n`)
  const thinOf = (c: Record<string, unknown>) => thinRowFromCollected({
    collected: { ...c, sourceCapturedAt: captured },
    maskedBody: '합성 본문입니다. 우리 또래 이야기를 시험용으로 지었습니다. 다들 어떠세요? 충분히 길게 적어 둡니다.',
    bodyHeadChars: 300, axis: 'seedOriginality', safetyVerdict: 'pass', safetyReasons: [], reason: 'ok',
    runId: '20261012-223000', fetchedAt: captured,
  })
  const thins = [thinOf(rows[0]! as unknown as Record<string, unknown>), thinOf(legacyRow as unknown as Record<string, unknown>)]
  check('얇은 행: 지금 수집기 행은 게시 시각이 비고 · 옛 행은 00:00 을 실어 온다(목록이 바로잡는다)',
    thins[0]!.sourcePostedAt === '' && thins[1]!.sourcePostedAt === '2026-10-11T15:00:00.000Z', JSON.stringify(thins.map((t) => t.sourcePostedAt)))
  writeFileSync(join(dir, '82cook-adapt-remonterrace-20261012-223000.detail.jsonl'), `${thins.map((t) => JSON.stringify(toDetailRecord(t))).join('\n')}\n`)
  writeFileSync(join(dir, '82cook-adapt-remonterrace-20261012-223000.raw-detail.jsonl'), `${thins.map((t) => JSON.stringify(toRawDetailRecord(t))).join('\n')}\n`)
  const at = new Date('2026-10-12T23:00:00.000Z')
  const idx = readListObservations(dir, at)
  const ws = worksetRows([
    join(dir, '82cook-adapt-remonterrace-20261012-223000.detail.jsonl'), join(dir, '82cook-adapt-remonterrace-20261012-223000.raw-detail.jsonl'),
  ], idx, at) ?? []
  for (const id of ['35080100', '35080200']) {
    const w = ws.find((r) => r.sourceArticleId === id)
    const ev = w?.evidence ?? null
    check(`🔴 공급 러너 증거(${id === '35080100' ? '지금' : '옛'} 수집기 행): postedAt null · 하루 구간 · 원천 상대 자리는 가장 낮은 구간`,
      ev !== null && ev.postedAt === null && ev.postedWindow?.from === '2026-10-11T15:00:00.000Z'
        && ev.sourceStats?.bucket === '24-72h' && parseEvidence(ev).ok,
      JSON.stringify({ p: ev?.postedAt, w: ev?.postedWindow, b: ev?.sourceStats?.bucket }))
    const v = w === undefined ? null : preGenerationRelease(w, new Date('2026-10-13T01:50:00.000Z'), at)
    check(`생성 전 판정이 구간으로 나이를 잰다(늙은 끝 34.833h) · ${id}`, v?.rank.ageAtSlotH === 34.833 && v.verdict === 'eligible',
      JSON.stringify({ v: v?.verdict, r: v?.reasons, a: v?.rank.ageAtSlotH }))
  }
  // 적재기 — 후보가 00:00 을 실어 와도 재료의 구간이 이긴다
  const m = evidenceMaterialFor(idx, { sourceKey: 'navercafe:remonterrace', articleId: '35080200', postedAt: '2026-10-11T15:00:00.000Z', listedAt: listed, at })
  const rec = sourceEvidenceOf({
    sourceSite: 'navercafe:remonterrace', sourceArticleId: '35080200',
    sourcePostedAt: '2026-10-11T15:00:00.000Z', sourceListedAt: listed, sourceCapturedAt: captured,
  } as Candidate, m) as unknown as SourceEvidenceRecord
  check('🔴 적재기 증거도 postedAt null · 같은 하루 구간 · 모양 확인 통과',
    rec.postedAt === null && rec.postedWindow?.from === '2026-10-11T15:00:00.000Z' && parseEvidence(rec).ok, JSON.stringify({ p: rec.postedAt, w: rec.postedWindow }))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} 통과 · ${fail} 실패`)
if (fail > 0) process.exit(1)
