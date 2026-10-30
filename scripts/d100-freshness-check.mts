#!/usr/bin/env tsx
/**
 * 🔴 **D100 Batch D1 — 날짜 정밀도 · 품질 동률 신선도 반례 검사** (2026-10-13) — fixture · DB 0 · 네트워크 0 · write 는 임시 디렉터리만
 *
 *   npm run check:d100-freshness
 *
 * 정본: `docs/operations/2026-09-21-d100-goal-canon.md` §2.1(날짜 정밀도) · §2.3(원천 순위 하나).
 *   ① 날짜만 보이는 라벨을 00:00 으로 만들지 않는다 — 수집 행 · 목록 관측 · 증거 기록 모두
 *   ② 판정은 하루 구간 **전체**로 한다(fail-closed) — 늙은 끝 통과만 eligible · 사이는 unknown · 어린 끝도 늙으면 만료
 *   ③ 원천 상대 반응 — 정확 시각은 관측 나이 구간 판(기존) · 날짜만 알면 **같은 원천 · 같은 날짜 · 같은 목록 회차** 판
 *      (별도 method). 날짜 · 회차 · 원천 · 정밀도가 다르면 섞지 않는다 · 한 점 표본은 모름
 *   ④ 정확한 게시 시각의 판정 · 스냅샷은 앞판과 **같다**(무작위 대조)
 *   ⑤ 수집 상세 선별: hard exclusion 뒤 **실제 원문 시각 최신 순** — 옛 점수가 신선도를 이기지 않는다(무작위 대조)
 *   ⑥ 레몬테라스 1p 제외 · 2~16p · 회차 상세 jjong 10 + humor 1 · 요청량 · 회차 · 페이지 수 불변
 *   ⑦ 출처·주제 선호 없음 — quota · 가중치 · 예약석이 없다
 *   ⑧ 배선 — 수집 행 → 얇은 행 → adapt → 공급 러너(`worksetRows`) → 생성 전 판정 · 적재기(`sourceEvidenceOf`)가 같은 구간을 싣는다
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildSourceEvidence, compareReleaseRank, judgeSlotRelease, observationBucketOf, parseEvidence,
  postedLowerBoundOf, postedWindowOfKstDay, relativePosition, sourceStatsSnapshot, EXPIRING_REASONS, SOURCE_STATS_METHOD,
  SOURCE_STATS_METHOD_DAY, SAME_DAY_RUN_BUCKET,
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
      basis: 'list-artifacts', method: SOURCE_STATS_METHOD_DAY, sourceKey: 'navercafe:fixture', bucket: SAME_DAY_RUN_BUCKET, n: 9,
      postedDay: day, observedAt: listed.toISOString(), commentsPct: 0.6, viewsPct: 0.5,
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
console.log('\n③ 원천 상대 반응 — 정확 시각은 관측 나이 구간 판 · 날짜만 알면 같은 날짜 · 같은 회차 판')
// ─────────────────────────────────────────────────────────
{
  const site = 'navercafe:fixture'
  const at = new Date('2026-10-12T23:00:00.000Z')
  const run1 = '2026-10-12T22:30:00.000Z' // KST 10-13 07:30
  const run0 = '2026-10-12T19:30:00.000Z' // KST 10-13 04:30 — 다른 회차
  const w12 = postedWindowOfKstDay('2026-10-12')
  const w11 = postedWindowOfKstDay('2026-10-11')
  const day = (id: string, w: typeof w12, observedAt: string, comments: number, key = site): ListObservation => ({
    sourceKey: key, articleKey: `${key}::${id}`, postedAt: null, postedWindow: w, observedAt, views: comments * 10, comments,
  })
  const exactRow = (id: string, ageH: number, comments: number): ListObservation => ({
    sourceKey: site, articleKey: `${site}::${id}`, postedAt: new Date(Date.parse(run1) - ageH * H).toISOString(),
    observedAt: run1, views: comments * 10, comments,
  })
  const peers = [day('p1', w12, run1, 1), day('p2', w12, run1, 3), day('p3', w12, run1, 9)]
  // 🔴 섞이면 안 되는 줄 — 다른 날짜 · 다른 회차 · 다른 원천 · 정확 시각 · 후보 자신
  const intruders = [
    day('x1', w11, run1, 100), day('x2', w12, run0, 100), day('x3', w12, run1, 100, 'navercafe:other'),
    exactRow('x4', 8, 100), day('cand', w12, run1, 100),
  ]
  const snapOf = (sample: ListObservation[], comments = 5) => sourceStatsSnapshot({
    sourceKey: site, articleKey: `${site}::cand`, postedAt: null, postedWindow: w12, observedAt: run1, comments, views: comments * 10, sample, at,
  })
  const s1 = snapOf([...peers, ...intruders])
  check('🔴 날짜만 아는 후보는 날짜 판(별도 method) · 같은 날짜 · 같은 회차 표본 3', s1?.method === SOURCE_STATS_METHOD_DAY && s1.bucket === SAME_DAY_RUN_BUCKET
    && s1.n === 3 && s1.postedDay === '2026-10-12' && s1.observedAt === run1, JSON.stringify(s1))
  check('🔴 다른 날짜 · 회차 · 원천 · 정확 시각 · 자기 자신이 섞이지 않는다(섞이면 자리가 내려간다)', s1?.commentsPct === 0.6667, String(s1?.commentsPct))
  check('표본 없음 → n 0(모름)', snapOf(intruders)?.n === 0)
  const onePoint = snapOf([day('q1', w12, run1, 4), day('q2', w12, run1, 4)])
  check('🔴 표본이 한 점이면 자리가 없다(RESPONSE_UNNORMALIZED 로 읽힌다)', onePoint?.n === 2 && onePoint.commentsPct === null && onePoint.viewsPct === null, JSON.stringify(onePoint))
  // 🔴 늙은 끝이 관측 때 이미 상한 밖 — 견줄 대상이 아니다
  const old = sourceStatsSnapshot({
    sourceKey: site, articleKey: `${site}::cand`, postedAt: null, postedWindow: postedWindowOfKstDay('2026-10-09'), observedAt: run1, comments: 5, views: 50,
    sample: [day('o1', postedWindowOfKstDay('2026-10-09'), run1, 1), day('o2', postedWindowOfKstDay('2026-10-09'), run1, 9)], at,
  })
  check('🔴 그날 00:00 기준 관측 나이가 72h 밖이면 스냅샷 없음', old === null, JSON.stringify(old))

  // 정확 시각 후보 — 기존 판 · 날짜만 아는 줄은 표본이 아니다
  const ex = sourceStatsSnapshot({
    sourceKey: site, articleKey: `${site}::cand`, postedAt: new Date(Date.parse(run1) - 9 * H).toISOString(), observedAt: run1, comments: 5, views: 50,
    sample: [exactRow('e1', 8, 1), exactRow('e2', 10, 9), ...peers, day('z', w12, run1, 2)], at,
  })
  check('🔴 정확 시각 후보는 기존 판 · 같은 관측 나이 구간 정확 시각 줄만(날짜 줄 제외)', ex?.method === SOURCE_STATS_METHOD && ex.bucket === '6-12h' && ex.n === 2
    && ex.commentsPct === 0.5 && ex.postedDay === undefined, JSON.stringify(ex))

  // 🔴 옛 판의 함정 — 날짜만 아는 줄을 00:00 으로 읽으면 24~72h 구간 표본이 된다. 정확 시각 판은 그 줄을 쓰지 않는다
  const ex72 = sourceStatsSnapshot({
    sourceKey: site, articleKey: `${site}::cand`, postedAt: new Date(Date.parse(run1) - 30 * H).toISOString(), observedAt: run1, comments: 5, views: 50,
    sample: [exactRow('e3', 28, 1), exactRow('e4', 40, 9), ...peers], at,
  })
  check('🔴 정확 시각 판의 24~72h 표본에 날짜만 아는 줄(00:00 기준 31.5h)이 들어가지 않는다', ex72?.bucket === '24-72h' && ex72.n === 2, JSON.stringify(ex72))

  // 판정 — 판이 정밀도와 맞아야 한다
  const listed = new Date(run1)
  const captured = new Date('2026-10-12T22:31:00.000Z')
  const slot = new Date('2026-10-13T00:00:00.000Z')
  const dayEv = dayEvidence('2026-10-12', listed, captured)
  check('날짜 판 스냅샷 + 하루 구간 → eligible', judge(dayEv, slot, captured).verdict === 'eligible', judge(dayEv, slot, captured).reasons.join())
  const reasonOf = (patch: Partial<SourceStatsSnapshot>): string => {
    const ev = { ...dayEv, sourceStats: { ...dayEv.sourceStats!, ...patch } }
    const v = judge(ev, slot, captured)
    return `${v.verdict}:${v.reasons.join()}${v.issue === null ? '' : `@${v.issue}`}`
  }
  check('🔴 날짜 원천에 정확 시각 판 스냅샷 → RESPONSE_UNNORMALIZED',
    reasonOf({ method: SOURCE_STATS_METHOD, bucket: '24-72h', postedDay: undefined, observedAt: undefined }) === 'unknown:RESPONSE_UNNORMALIZED')
  check('🔴 다른 회차 표본 → RESPONSE_UNNORMALIZED', reasonOf({ observedAt: run0 }) === 'unknown:RESPONSE_UNNORMALIZED', reasonOf({ observedAt: run0 }))
  check('🔴 다른 날짜 표본 → 기록 손상(cross-day)', reasonOf({ postedDay: '2026-10-11' }) === 'unknown:EVIDENCE_INVALID@sourceStats.postedDay:cross-day')
  check('🔴 한 점 표본 → RESPONSE_UNNORMALIZED', reasonOf({ commentsPct: null, viewsPct: null }) === 'unknown:RESPONSE_UNNORMALIZED')
  const exactEv = { ...dayEv, postedAt: '2026-10-12T13:00:00.000Z', postedWindow: null }
  const ev2 = { ...exactEv, sourceStats: { ...dayEv.sourceStats! } }
  check('🔴 정확 시각 원천에 날짜 판 스냅샷 → RESPONSE_UNNORMALIZED', judge(ev2, slot, captured).reasons[0] === 'RESPONSE_UNNORMALIZED', judge(ev2, slot, captured).reasons.join())
  const bad = (st: Record<string, unknown>): string | null => { const r = parseEvidence({ ...dayEv, sourceStats: { ...dayEv.sourceStats!, ...st } }); return r.ok ? null : r.issue }
  check('🔴 날짜 판 라벨이 관측 나이 구간이면 손상', bad({ bucket: '24-72h' }) === 'sourceStats.bucket:unknown')
  check('🔴 정확 시각 판에 날짜 칸이 붙으면 손상', bad({ method: SOURCE_STATS_METHOD, bucket: '24-72h' }) === 'sourceStats.method:day-fields')
  check('🔴 날짜 판에 회차 시각이 없으면 손상', bad({ observedAt: undefined }) === 'sourceStats.observedAt:corrupt')

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
    const b2 = legacySnapshot({ postedAt: posted, observedAt: obs, comments: c, views: c * 7, sample: smp })
    if (JSON.stringify(a) === JSON.stringify(b2)) same += 1
  }
  check(`🔴 정확한 시각의 스냅샷은 앞판과 같다(표본이 정확 시각 줄뿐일 때) (무작위 ${N}벌)`, same === N, `${same}/${N}`)
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
    row('cand', null, w, 5), row('d1', null, w, 1), row('d2', null, w, 9),
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
  check('🔴 스냅샷은 날짜 판 — 같은 날짜 · 같은 회차의 날짜만 아는 줄 2개와만 견준다(정확 시각 18줄 제외)',
    m.sourceStats?.method === SOURCE_STATS_METHOD_DAY && m.sourceStats.n === 2 && m.sourceStats.commentsPct === 0.5, JSON.stringify(m.sourceStats))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 수집 상세 선별 — 신선도 1순위 (2026-10-19 창업자 결정) · 점수는 자격 gate 가 아니다')
// ─────────────────────────────────────────────────────────
{
  const today = (hh: number): string => new Date(Date.UTC(2026, 9, 12, hh - 9 + 24)).toISOString()
  const p = planAutoFetch([
    { sourceArticleId: '35080001', score: 40, flags: [], postedFrom: today(6) },        // 10-13 06 KST
    { sourceArticleId: '35080500', score: 40, flags: [], postedFrom: today(9) },        // 10-13 09 KST (가장 최신)
    { sourceArticleId: '35070000', score: 40, flags: [], postedFrom: postedWindowOfKstDay('2026-10-12')!.from }, // 날짜만 10-12
    { sourceArticleId: '35060000', score: 55, flags: [], postedFrom: postedWindowOfKstDay('2026-10-11')!.from }, // 날짜만 10-11 · 점수만 55
  ], { max: 3 })
  check('🔴 가장 최신 글이 1순위 — 점수가 높아도 늙었으면 뒤', p.picked[0] === '35080500', p.picked.join())
  check('🔴 신선도 순서로 2위·3위 — 10-13 06시 → 날짜만 10-12', p.picked[1] === '35080001' && p.picked[2] === '35070000', p.picked.join())
  check('🔴 점수만 큰 오래된 글(score 55, 10-11)은 신선 글에 밀려 OVER_MAX',
    p.skipped.some((s) => s.sourceArticleId === '35060000' && s.reason === 'OVER_MAX'))
  const sameDay = planAutoFetch([
    { sourceArticleId: '35070000', score: 40, flags: [], postedFrom: postedWindowOfKstDay('2026-10-12')!.from },
    { sourceArticleId: '35070900', score: 40, flags: [], postedFrom: postedWindowOfKstDay('2026-10-12')!.from },
  ], { max: 1 })
  check('🔴 같은 게시 시각(effective tie) — 결정적 id lex 로 간다 (숫자 article id 를 time proxy 로 쓰지 않는다 · 2026-10-19)',
    sameDay.picked[0] === '35070000', sameDay.picked.join())
  const noTime = planAutoFetch([
    { sourceArticleId: '100', score: 40, flags: [] },
    { sourceArticleId: '99', score: 40, flags: [] },
  ], { max: 1 })
  check('🔴 모두 시각이 없으면 lex 순 — 숫자 id 를 time proxy 로 쓰지 않는다 ("100" < "99")',
    noTime.picked[0] === '100', noTime.picked.join())
  check('숫자가 아닌 열쇠는 옛 결정적 순서', compareFreshFirst({ sourceArticleId: 'a1', score: 0, flags: [] }, { sourceArticleId: 'a2', score: 0, flags: [] }) < 0)

  // 🔴 무작위 대조 — 고른 순서는 **신선도 내림차순**을 지킨다. 옛 판(점수 1순위 → 글 번호)과는 **적어도 한 벌 이상** 다르다
  //    (점수가 신선도를 더 이상 이기지 않는 운영이 복원되지 않았는지 검증)
  const r = rng(99)
  let sortedByFreshness = 0
  let changedFromLegacy = 0
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
    // 🔴 신선도 내림차순 성립 — 앞 글의 게시 시각(postedFrom)이 뒤 글보다 더 최근(또는 같음). postedFrom null 은 뒤로 간다
    const ms = (id: string): number => {
      const v = byId.get(id)!.postedFrom
      const t = typeof v === 'string' ? Date.parse(v) : Number.NaN
      return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY
    }
    if (now.picked.every((id, i) => i === 0 || ms(now.picked[i - 1]!) >= ms(id))) sortedByFreshness += 1
    if (now.picked.join() !== legacy.join()) changedFromLegacy += 1
  }
  check(`🔴 고른 순서는 신선도 내림차순을 지킨다 (무작위 ${N}벌)`, sortedByFreshness === N, `${sortedByFreshness}/${N}`)
  check(`🔴 옛 점수 1순위 판정과 **다른 결과를 내는 벌이 있다** — 점수가 신선도를 이기지 않는다`, changedFromLegacy > 0, `${changedFromLegacy}/${N}`)
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
  check('🔴 wgang 하루 요청 110 ≤ 150 · 상세 16/회차 · 5회차', wg.requestsPerDay + wg.memberCheckPerDay === 110 && wg.detailPerRun === 16 && wg.runsPerDay === 5 && wg.withinLimit)
  check('🔴 일 상한 · 회차 · 슬롯 quota 상수 불변',
    MAX_REQUESTS_PER_DAY['navercafe:remonterrace'] === 150 && MAX_REQUESTS_PER_DAY['navercafe:wgang'] === 150
      && RUNS_PER_DAY['navercafe:remonterrace']?.start === 5 && RUNS_PER_DAY['navercafe:wgang']?.start === 5
      && SLOT_QUOTA.navercafe === 10)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 신선도 1순위 (2026-10-19 창업자) — 자격 gate 뒤에는 오래된 고반응 글이 최신 글을 앞서지 않는다 · 출처·주제 보너스 없음')
// ─────────────────────────────────────────────────────────
{
  const rank = (commentsPct: number, viewsPct: number, ageAtSlotH: number) => ({ commentsPct, viewsPct, ageAtSlotH, velocity: null, tieBreak: '' })
  const k = (r: ReturnType<typeof rank>, key: string): SupplyRankKey => ({ rank: r, key })
  check('🔴 더 낮은 신선도의 고반응 글은 더 신선한 글을 이기지 않는다',
    compareSupplyRank(k(rank(0.9, 0.5, 40), 'a'), k(rank(0.8, 0.9, 1), 'b')) > 0)
  check('🔴 신선도가 반응을 이긴다 — 댓글 자리가 더 높아도 늙었으면 뒤',
    compareReleaseRank(rank(0.9, 0.1, 70), rank(0.89, 0.9, 1)) > 0)
  check('신선도 동률이면 반응이 앞', compareReleaseRank(rank(0.9, 0.6, 5), rank(0.7, 0.6, 5)) < 0)
  check('반응 동률이면 더 신선한 글이 앞', compareReleaseRank(rank(0.7, 0.6, 30), rank(0.7, 0.6, 5)) > 0)
  check('🔴 신선도·반응 모두 동률이면 결정적 열쇠로 — 출처·주제 보너스 없음',
    compareSupplyRank(k(rank(0.7, 0.6, 5), 'a'), k(rank(0.7, 0.6, 5), 'b')) < 0
      && compareSupplyRank(k(rank(0.7, 0.6, 5), 'b'), k(rank(0.7, 0.6, 5), 'a')) > 0)
  // 정적: 판정 정본 · 공급 순위 · 수집 동률 비교에 주제 · 출처 · 가중치가 들어 있지 않다
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const release = strip(readFileSync('src/lib/source-slot-release.ts', 'utf8'))
  check('🔴 판정 정본에 갱년기 · wgang · 가중치 · quota 가 없다', !/menopause|wgang|WEIGHT|weight|quota/i.test(release))
  const workset = strip(readFileSync('src/lib/supply-workset.ts', 'utf8'))
  const sr = workset.slice(workset.indexOf('export function compareSupplyRank'), workset.indexOf('export function compareSupplyRank') + 400)
  check('🔴 공급 순위도 compareReleaseRank + 열쇠 — 주제 · 출처 · 가중치 없음',
    sr.length > 0 && !/menopause|wgang|WEIGHT|weight|quota|bonus/i.test(sr))
  const supply = strip(readFileSync('scripts/lib/micro-seed-supply.mts', 'utf8'))
  const fresh = supply.slice(supply.indexOf('export function compareFreshFirst'), supply.indexOf('export function planAutoFetch'))
  check('🔴 수집 동률 비교는 게시 시각 · 글 번호만 본다 — 주제·출처·가중치 없음',
    fresh.length > 0 && !/flags|menopause|wgang|weight|quota/i.test(fresh))
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
    // 같은 날짜 · 같은 회차의 날짜만 아는 동료 — 날짜 판 표본
    buildCollected('remonterrace', item('35080300', '2026.10.12.', 1), '', listed, listed),
    buildCollected('remonterrace', item('35080400', '2026.10.12.', 12), '', listed, listed),
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
    check(`🔴 공급 러너 증거(${id === '35080100' ? '지금' : '옛'} 수집기 행): postedAt null · 하루 구간 · 날짜 판(같은 날짜 · 같은 회차 3줄)`,
      ev !== null && ev.postedAt === null && ev.postedWindow?.from === '2026-10-11T15:00:00.000Z'
        && ev.sourceStats?.method === SOURCE_STATS_METHOD_DAY && ev.sourceStats.n === 3 && ev.sourceStats.commentsPct === 0.5 && parseEvidence(ev).ok,
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
