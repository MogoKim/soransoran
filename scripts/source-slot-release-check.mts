#!/usr/bin/env tsx
/**
 * 🔴 **원천 기회 → 슬롯 판정(source-slot-v1) 반례 검사 — 순수 · DB 0 · 네트워크 0 · LLM 0**
 *
 *   정본 계약(Sep 30)의 필수 반례를 **실행한다**(문구 대조가 아니다):
 *     ① 오래된 원문을 오늘 수집 · 오늘 초안        ② 최근이지만 반응 증거 없음
 *     ③ 원천 규모 차이로 raw 조회수 왜곡            ④ 한 번 관측을 velocity 로 해석 시도
 *     ⑤ 선택 때 유효했지만 슬롯 전 가치 소멸         ⑥ 이미 비용 쓴 draft vs 더 좋은 현재 후보
 *     ⑦ 원문 시각 없음 · 손상 · 미래 · capture 이후  ⑧ deferred 가 증명일 안에 안 풀림
 *     ⑨ Persona voice/cadence 슬롯 부족               ⑩ 계약 변경 전 PASS 가 승급을 여는 시도
 *     ⑪ 개인정보 · 원문 노출                         ⑫ JIT 수요 · preflight UNKNOWN(계약 유효 Persona 없음)
 *     ⑬ (Lane B) 손상된 중첩 증거 — 예외 없이 EVIDENCE_INVALID + 경로(issue) · 무작위 손상 fuzz
 *     ⑭ (Lane B) 작은 표본 정규화 — 0 · 1 · 같은 값 · 극단치 · 조회만 · 순위만 · 댓글만 · 반복 1회 · 2회+
 *   발행 트랜잭션 경쟁 · 교체 · Queue/Post/ActivityLog 정합은 격리 DB 검사(`publish:slot-db-check`)가 본다.
 *
 *   `check:source-times` 가 이 파일을 실행한다(CI 연결).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import {
  buildSourceEvidence, compareReleaseRank, judgeSlotRelease, matchOpportunitiesToSlots, percentileOf,
  observationBucketOf, readSourceEvidence, releaseStampCheck, releaseStampStatusOf, releaseStampOf, publishEventAtOf, sourceStatsSnapshot, velocityOf,
  describeRelease, parseEvidence, relativePosition,
  EXPIRING_REASONS, RELEASE_CONTRACT, SOURCE_AGE_LIMIT_HOURS, SOURCE_EVIDENCE_KEY, SOURCE_EVIDENCE_VERSION, SOURCE_STATS_METHOD,
  type ListObservation, type SlotOpportunity, type SourceEvidenceRecord,
} from '../src/lib/source-slot-release'
import { prepareCandidates, type QueueCandidate } from '../src/lib/supply-candidates'
import { buildQueuePayload, sourceEvidenceOf, MACHINE_PROFILE } from '../src/lib/micro-seed-supply-autofill'
import { judgeJitDemand } from '../src/lib/supply-process'
import { judgeNextPreflight, slotTimesOn, type PreflightFacts } from '../src/lib/stage-ladder-generic'
import { profileOf } from '../src/lib/scale-profile'
import { judgeEvidenceForTarget, trialPlanOf, type EvidencePost, type StageEvidenceFacts } from '../src/lib/stage-evidence'
import { validateStoredDecision, STAGE_DECISION_VERSION } from '../src/lib/stage-decision-contract'
import { decideStage, sustainedReleaseOf } from '../src/lib/stage-controller'
import { planOpenDays, wipCountsBySpeaker } from '../src/lib/content-core/speaker-availability'
import { availablePersonasAt } from '../src/lib/supply-capacity-forecast'
import { FORBIDDEN_POST_KEYS } from '../src/lib/original-post-publish'
import { RUNNER_GRID, slotValidOpportunitiesOf } from './lib/stage-preflight-facts.mjs'

let pass = 0
let fail = 0
const check = (n: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${n}`) } else { fail += 1; console.log(`  🔴 FAIL ${n}${detail === '' ? '' : ` — ${detail}`}`) }
}
const H = 3_600_000
const NOW = new Date('2026-10-01T00:30:00.000Z') // 09:30 KST
const iso = (d: Date): string => d.toISOString()
const hoursAgo = (h: number, from: Date = NOW): Date => new Date(from.getTime() - h * H)

/** 🔴 합성 목록 표본 — 원천 A(큰 카페) 조회 100~1000 · 원천 B(작은 카페) 조회 10~200. 관측 나이 <3h 구간 */
const sample: ListObservation[] = []
for (let i = 0; i < 20; i += 1) {
  sample.push({ sourceKey: 'navercafe:big', articleKey: `big::${i}`, postedAt: iso(hoursAgo(2)), observedAt: iso(hoursAgo(1)), views: 100 + i * 50, comments: i })
  sample.push({ sourceKey: 'navercafe:small', articleKey: `small::${i}`, postedAt: iso(hoursAgo(2)), observedAt: iso(hoursAgo(1)), views: 10 + i * 10, comments: Math.floor(i / 2) })
}

/** 🔴 정상 증거 한 벌 — 게시 < 목록 < 수집 < 초안 이 전부 다른 값이다(fixture 가 실제보다 강하지 않게) */
function ev(over: Partial<{ posted: Date | string | null; captured: Date | string | null; listed: Date | null; drafted: Date | null
  views: number | null; comments: number | null; driver: string | null; site: string; id: string
  observations: { observedAt: string; views: number | null; comments: number | null }[] }> = {}): SourceEvidenceRecord {
  const posted = over.posted === undefined ? hoursAgo(2) : over.posted
  const site = over.site ?? 'navercafe:big'
  const id = over.id ?? 'A1'
  const observedAt = over.listed === undefined ? hoursAgo(1) : over.listed
  const views = over.views === undefined ? 600 : over.views
  const comments = over.comments === undefined ? 12 : over.comments
  const stats = posted instanceof Date && observedAt !== null ? sourceStatsSnapshot({
    sourceKey: site, articleKey: `${site}::${id}`, postedAt: iso(posted), observedAt: iso(observedAt),
    comments, views, sample, at: NOW,
  }) : null
  return buildSourceEvidence({
    postedAt: posted instanceof Date ? iso(posted) : posted,
    listedAt: observedAt === null ? null : iso(observedAt),
    capturedAt: over.captured === undefined ? iso(hoursAgo(0.9)) : over.captured instanceof Date ? iso(over.captured) : over.captured,
    sourceSite: site, sourceArticleId: id,
    response: views === null && comments === null ? null : { views, comments, listRank: 3, listPage: 1, observedAt: observedAt === null ? null : iso(observedAt) },
    observations: over.observations ?? [],
    sourceStats: stats,
    participationDriver: over.driver === undefined ? '시어머니 장보기 갈등에 공감할 사람이 많다' : over.driver,
    draftedAt: over.drafted === undefined ? iso(hoursAgo(0.5)) : over.drafted === null ? null : iso(over.drafted),
  })
}
const judge = (e: unknown, slotAt: Date = NOW, extra: Partial<Parameters<typeof judgeSlotRelease>[0]> = {}) => judgeSlotRelease({
  evidence: e, slotAt, now: NOW, hardGates: { ok: true, codes: [] }, assignment: { ok: true }, tieBreak: 'x', ...extra,
})

console.log('\n══ source-slot-v1 반례 검사 (🔴 순수 · DB 0 · 네트워크 0) ══\n')

// ─────────────────────────────────────────────────────────
console.log('⓪ 기준 — 정상 증거는 eligible')
{
  const v = judge(ev())
  check('정상(게시 2h · 반응 관측 · 원천 표본 · 동력) → eligible', v.verdict === 'eligible' && v.reasons.length === 0, JSON.stringify(v))
  check('evidenceVersion 을 남긴다', v.evidenceVersion === SOURCE_EVIDENCE_VERSION)
  check('🔴 hard gate 실패는 가장 먼저 · 만료 사유가 아니다',
    judge(ev(), NOW, { hardGates: { ok: false, codes: ['SAFETY'] } }).reasons[0] === 'HARD_GATE'
    && !judge(ev(), NOW, { hardGates: { ok: false, codes: ['SAFETY'] } }).expires)
}

// ─────────────────────────────────────────────────────────
console.log('\n① 오래된 원문을 오늘 수집 · 오늘 초안')
{
  const e = ev({ posted: hoursAgo(16 * 24), listed: hoursAgo(1), captured: hoursAgo(0.9), drafted: hoursAgo(0.2) })
  const v = judge(e)
  check('🔴 🔴 **16일 전 원문 + 오늘 수집 · 오늘 초안 → SOURCE_TOO_OLD_AT_SLOT · ineligible · 만료 사유**',
    v.verdict === 'ineligible' && v.reasons[0] === 'SOURCE_TOO_OLD_AT_SLOT' && v.expires)
  const draftAgeH = (NOW.getTime() - Date.parse(e.draftedAt!)) / H
  check('🔴 옛 판정이었다면(초안 시각 = sourceCapturedAt) 나이 < 72h 로 "hot" 이었다 — 그 오판을 재현한다', draftAgeH < SOURCE_AGE_LIMIT_HOURS)
  check('🔴 경계 — 71.9h eligible · 72h ineligible (시간 단위 · floor 없음)',
    judge(ev({ posted: hoursAgo(71.9) })).verdict !== 'ineligible' && judge(ev({ posted: hoursAgo(72) })).reasons[0] === 'SOURCE_TOO_OLD_AT_SLOT')
}

// ─────────────────────────────────────────────────────────
console.log('\n② 최근이지만 반응 증거 없음')
{
  const v = judge(ev({ views: null, comments: null }))
  check('🔴 🔴 **최근 원문인데 수집 때 반응 관측이 없다 → RESPONSE_UNOBSERVED · unknown · 만료 사유**',
    v.verdict === 'unknown' && v.reasons[0] === 'RESPONSE_UNOBSERVED' && v.expires)
  const noStats = judge(buildSourceEvidence({ ...readBack(ev()), sourceStats: null }))
  check('🔴 반응은 있는데 같은 원천 비교 표본이 없다 → RESPONSE_UNNORMALIZED(raw 수로 비교하지 않는다)',
    noStats.reasons[0] === 'RESPONSE_UNNORMALIZED' && noStats.verdict === 'unknown')
  const noDriver = judge(ev({ driver: null }))
  check('🔴 참여 동력 없음 → DRIVER_UNKNOWN · unknown', noDriver.reasons[0] === 'DRIVER_UNKNOWN' && noDriver.verdict === 'unknown')
  check('🔴 생성 전(공급 묶음)에는 동력 · 배정이 아직 없다 — pending 으로 eligible 이 된다(같은 함수)',
    judge(ev({ driver: null }), NOW, { driver: 'pending', assignment: 'pending' }).verdict === 'eligible')
}
function readBack(r: SourceEvidenceRecord): Parameters<typeof buildSourceEvidence>[0] {
  return {
    postedAt: r.postedAt, listedAt: r.listedAt, capturedAt: r.capturedAt, sourceSite: r.sourceKey, sourceArticleId: 'A1',
    response: r.response, observations: r.observations, sourceStats: r.sourceStats,
    participationDriver: r.participationDriver, draftedAt: r.draftedAt,
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 원천 규모 차이로 raw 조회수 왜곡')
{
  // 큰 카페의 중간(raw 600) vs 작은 카페의 상위(raw 190)
  const bigMid = judge(ev({ site: 'navercafe:big', id: 'b', views: 600, comments: 10 }))
  const smallTop = judge(ev({ site: 'navercafe:small', id: 's', views: 190, comments: 9 }))
  check('🔴 원천마다 따로 백분위를 낸다 — 작은 카페 상위 글의 댓글 백분위가 큰 카페 중간 글보다 높다',
    (smallTop.rank.commentsPct ?? 0) > (bigMid.rank.commentsPct ?? 1),
    `small ${smallTop.rank.commentsPct} · big ${bigMid.rank.commentsPct}`)
  check('🔴 🔴 **raw 조회수는 큰 카페가 3배인데 순서는 작은 카페 상위 글이 앞선다**',
    compareReleaseRank(smallTop.rank, bigMid.rank) < 0)
  check('관측 나이 구간 — <3h · 3-6h · 6-12h · 12-24h · 24-72h · 그 밖 null',
    observationBucketOf(1) === '<3h' && observationBucketOf(4) === '3-6h' && observationBucketOf(30) === '24-72h' && observationBucketOf(80) === null)
  check('🔴 다른 관측 나이 구간은 비교 모집단이 아니다 — 7h 관측 글은 <3h 표본으로 백분위를 내지 않는다',
    sourceStatsSnapshot({ sourceKey: 'navercafe:big', articleKey: 'x', postedAt: iso(hoursAgo(8)), observedAt: iso(hoursAgo(1)), comments: 5, views: 5, sample, at: NOW })?.n === 0)
  check('percentileOf — 표본 없으면 null · 중앙 순위', percentileOf(3, []) === null && percentileOf(2, [1, 2, 3]) === 0.5)
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 한 번 관측을 velocity 로 해석 시도')
{
  const one = [{ observedAt: iso(hoursAgo(1)), views: 300, comments: 12 }]
  check('🔴 🔴 **관측 1개 → velocity null** (한 번 본 수를 시간으로 나누지 않는다)', velocityOf(one) === null)
  check('🔴 같은 시각 관측 두 줄은 한 번이다 → null', velocityOf([...one, ...one]) === null)
  /**
   * 🔴 (Lane B) 반복 관측도 게시 뒤여야 한다 — 앞판 fixture 는 게시(2h 전)보다 3시간 이른 관측(5h 전)을 썼다.
   *    실제로는 있을 수 없는 관측이라 이제 판정이 `observations[0].observedAt:before-posted` 로 닫는다.
   */
  const two = [{ observedAt: iso(hoursAgo(1.5)), views: 100, comments: 2 }, { observedAt: iso(hoursAgo(1)), views: 300, comments: 3 }]
  check('실제 반복 관측 2개 → 시간당 댓글 증가 2', velocityOf(two) === 2)
  const withV = judge(ev({ observations: two }))
  check('판정 rank 에 실린다 · 1회 관측 행은 null(뒤로 간다)', withV.rank.velocity === 2 && judge(ev({ observations: one })).rank.velocity === null)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 선택 때 유효했지만 슬롯 전 가치 소멸')
{
  // 🔴 목록에서는 게시 1시간 뒤에 봤다(<3h 구간) — 수집은 나중이다
  const e = ev({ posted: hoursAgo(70), listed: hoursAgo(69) })
  const planned = judge(e, NOW)
  const atSlot = judge(e, new Date(NOW.getTime() + 3 * H))
  check('🔴 🔴 **지금(계획) eligible → 3시간 뒤 슬롯에서는 SOURCE_TOO_OLD_AT_SLOT · 만료 사유** (교체 대상)',
    planned.verdict === 'eligible' && atSlot.reasons[0] === 'SOURCE_TOO_OLD_AT_SLOT' && atSlot.expires)
  // prepareCandidates 는 예정 슬롯(at)으로 판정한다 — 같은 행이 다음 날 계획에서 빠진다
  const cand = (id: string, e2: SourceEvidenceRecord): QueueCandidate => ({
    queueId: id, title: 't', body: 'b', gateVerdict: 'PASS', createdAt: 0, assignedPersonaCode: null,
    gateResults: { [SOURCE_EVIDENCE_KEY]: e2 }, voice: null, profile: 'human',
  })
  const p1 = prepareCandidates({ candidates: [cand('q', e)], personas: [], at: NOW })
  const p2 = prepareCandidates({ candidates: [cand('q', e)], personas: [], at: new Date(NOW.getTime() + 3 * H) })
  check('🔴 계획 함수(prepareCandidates)도 같은 판정 — 슬롯이 밀리면 held(SOURCE_TOO_OLD_AT_SLOT · expires)',
    p1.held.length === 0 && p2.held[0]?.hold === 'SOURCE_TOO_OLD_AT_SLOT' && p2.held[0]?.expires === true)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 이미 비용 쓴 draft vs 더 좋은 현재 후보')
{
  const drafted = judge(ev({ id: 'd', views: 150, comments: 3, drafted: hoursAgo(20), posted: hoursAgo(40) }))
  const fresh = judge(ev({ id: 'f', views: 900, comments: 18, drafted: null, posted: hoursAgo(2) }))
  check('🔴 🔴 **초안이 이미 있다는 사실은 순서에 들어가지 않는다 — 더 좋은 현재 후보가 앞선다**',
    compareReleaseRank(fresh.rank, drafted.rank) < 0)
  check('🔴 rank 성분에 초안 시각 · 비용 칸이 없다', !Object.keys(drafted.rank).some((k) => /draft|cost|usd/i.test(k)))
  check('🔴 만료 사유 목록에 hard gate · Persona 가 없다(구제 레인 없음 · 사유가 정해져 있다)',
    !EXPIRING_REASONS.includes('HARD_GATE') && !EXPIRING_REASONS.includes('NO_PERSONA_AT_SLOT'))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 원문 시각 없음 · 손상 · 미래 · capture 이후')
{
  const code = (e: SourceEvidenceRecord): string => judge(e).reasons[0] ?? 'eligible'
  check('게시 시각 없음 → POSTED_MISSING (수집 · 초안 시각으로 메우지 않는다)', code(ev({ posted: null })) === 'POSTED_MISSING')
  check('게시 시각 손상(비정규) → POSTED_CORRUPT', code(ev({ posted: '2026년 9월쯤' })) === 'POSTED_CORRUPT')
  check('게시 시각 날짜만("2026-09-30") → POSTED_CORRUPT(관대 해석 금지)', code(ev({ posted: '2026-09-30' })) === 'POSTED_CORRUPT')
  check('수집 시각 없음 → CAPTURED_MISSING', code(ev({ captured: null })) === 'CAPTURED_MISSING')
  check('수집 시각 미래(오차 밖) → CAPTURED_IN_FUTURE', code(ev({ captured: new Date(NOW.getTime() + 2 * H), posted: hoursAgo(1) })) === 'CAPTURED_IN_FUTURE')
  check('게시가 수집보다 늦다(오차 밖) → POSTED_AFTER_CAPTURE', code(ev({ posted: hoursAgo(0.5), captured: hoursAgo(2) })) === 'POSTED_AFTER_CAPTURE')
  check('게시가 판정 시각보다 미래 → 수집보다 늦은 것으로 먼저 잡힌다(unknown)', judge(ev({ posted: new Date(NOW.getTime() + 2 * H), captured: hoursAgo(0.5) })).verdict === 'unknown')
  check('오차 10분 안의 "미래" 는 오차로 본다', code(ev({ posted: new Date(hoursAgo(0.9).getTime() + 5 * 60_000), captured: hoursAgo(0.9), listed: hoursAgo(0.5) })) === 'eligible')
  check('🔴 기록 칸이 없는 행(backfill 없음) → EVIDENCE_MISSING · unknown · 만료 사유',
    judgeSlotRelease({ gateResults: {}, slotAt: NOW, now: NOW, hardGates: { ok: true, codes: [] }, assignment: { ok: true }, tieBreak: 'x' }).reasons[0] === 'EVIDENCE_MISSING')
  check('판이 다른 기록 → EVIDENCE_INVALID', readSourceEvidence({ [SOURCE_EVIDENCE_KEY]: { version: 'source-times-v1' } }).ok === false)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧ deferred 가 증명일 안에 안 풀림 · ⑨ Persona voice/cadence 슬롯 부족')
{
  const slots = slotTimesOn('2026-10-01', profileOf('d3'))
  const e = ev({ posted: hoursAgo(1) })
  const readyOpp = (key: string, personaCode: string | null, freeFrom: Date | null): SlotOpportunity => ({
    key, personaCode,
    validAt: (slotAt) => judgeSlotRelease({
      evidence: e, slotAt, now: NOW, hardGates: { ok: true, codes: [] },
      assignment: freeFrom === null || slotAt.getTime() >= freeFrom.getTime() ? { ok: true } : { ok: false, route: 'defer', codes: ['TOO_SOON'] },
      tieBreak: key,
    }).verdict === 'eligible',
  })
  const never = matchOpportunitiesToSlots(slots, [readyOpp('r1', 'P01', new Date('2026-10-03T00:00:00Z'))])
  check('🔴 🔴 **배정 유예가 증명일 슬롯 안에 안 풀리면 그 슬롯의 기회가 아니다(assignmentDeferred 를 통째로 세지 않는다)**', never.filled === 0)
  const late = matchOpportunitiesToSlots(slots, [readyOpp('r1', 'P01', slots[2]!)])
  check('🔴 마지막 슬롯에 풀리면 그 한 슬롯만 채운다', late.filled === 1 && late.bySlot[2] === 'r1')
  const same = matchOpportunitiesToSlots(slots, [readyOpp('a', 'P01', null), readyOpp('b', 'P01', null), readyOpp('c', 'P01', null)])
  check('🔴 🔴 **같은 Persona 세 글 — 하루 한 슬롯만(최소 간격 ≥ 1일)**', same.filled === 1)
  const mixed = matchOpportunitiesToSlots(slots, [readyOpp('a', 'P01', null), readyOpp('b', 'P02', null), readyOpp('c', null, null)])
  check('서로 다른 Persona · 배정 미정 행은 세 슬롯을 채운다', mixed.filled === 3)
  // voice 필터 — 말투 없는 화자는 자리를 받지 않는다(PR2 KEEP)
  const days = Array.from({ length: 3 }, (_, i) => new Date(Date.UTC(2026, 9, 1 + i, 3)))
  const hist = ['P01', 'P02', 'P20'].map((code) => ({ code, matchedAts: [] as Date[] }))
  const caps = { dailyTarget: 3, postsPerWeek: 3, minDaysBetween: 1 }
  const avail = (h: readonly { code: string; matchedAts: readonly Date[] }[], at: Date, c: { postsPerWeek: number; minDaysBetween: number }) =>
    availablePersonasAt(h.map((x) => ({ code: x.code, matchedAts: [...x.matchedAts] })), at, c)
  const noFilter = planOpenDays({ days, profileOf: () => caps, history: hist, availableAt: avail, dateLabel: (d) => d.toISOString().slice(0, 10) })
  const filtered = planOpenDays({ days, profileOf: () => caps, history: hist, availableAt: avail, dateLabel: (d) => d.toISOString().slice(0, 10), canTakeSlot: (c) => c !== 'P20' })
  check('🔴 말투 없는 화자(P20)는 필터가 있으면 자리 0 · 없으면 자리를 차지한다(진단 재현)',
    (noFilter.openDays.get('P20') ?? 0) > 0 && (filtered.openDays.get('P20') ?? 0) === 0)
  const wip = wipCountsBySpeaker({ wip: [{ id: 'old', code: 'P01' }, { id: 'ok', code: 'P01' }, { id: 'h', code: null }], releasesSlot: (id) => id === 'old' })
  check('🔴 원천 가치가 사라진 WIP 는 화자 칸을 막지 않는다 · 화자 미상은 따로 센다',
    wip.byCode.get('P01') === 1 && wip.released.join() === 'old' && wip.unattributed === 1)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑩ 계약 변경 전 PASS 가 승급을 여는 시도')
{
  // 🔴 (2026-10-01 · C9) 증명일 자동 글은 서로 다른 Persona 가 쓴다(canon §6-3 · PERSONA_REPEAT) — 글마다 다른 글쓴이
  let author = 0
  const post = (release: EvidencePost['release']): EvidencePost => ({
    postId: `p-${release}-${Math.random()}`, queueId: `q-${Math.random()}`, publishedAtMs: NOW.getTime(), unattended: true,
    queueRows: 1, publishLogs: 1, authorPersonaId: `A${(author += 1)}`, decider: 'auto',
    personaComments: [{ personaId: 'B', createdAtMs: NOW.getTime() + 10 * 60_000, topLevel: true }], release,
  })
  const facts = (posts: EvidencePost[]): StageEvidenceFacts => ({
    kstDate: '2026-09-30', stage: 'd3',
    decision: { kstDate: '2026-09-30', state: 'TRIAL', release: 'd3', decidedBy: 'controller' },
    posts, orphanPublishLogs: 0, unloggedPublishes: 0, commentCapPerPost: 1,
    audits: { rows: posts.slice(0, 1).map((p) => ({ postId: p.postId, queueId: p.queueId!, judged: true, defectYes: false, retryable: false, overdue: false })), globalDefectYes: 0, globalOverdue: 0, globalRetryable: 0, globalMissingPosts: 0 },
  })
  const side = { cost: [{ name: 'x', health: 'ok' as const }], errors: 'ok' as const }
  const stamped = judgeEvidenceForTarget('2026-09-30', 'd3', 3, facts([post('STAMPED_ELIGIBLE'), post('STAMPED_ELIGIBLE'), post('STAMPED_ELIGIBLE')]), side)
  check('지금 계약 도장 3건 · 조건 충족 → PASS', stamped.verdict === 'PASS', JSON.stringify(stamped.codes))
  const legacy = judgeEvidenceForTarget('2026-09-30', 'd3', 3, facts([post('MISSING'), post('MISSING'), post('MISSING')]), side)
  check('🔴 🔴 **도장 없는 자동 target(계약 이전 발행) → FAIL RELEASE_CONTRACT_MISSING**',
    legacy.verdict === 'FAIL' && legacy.codes.includes('RELEASE_CONTRACT_MISSING'))
  const stale = judgeEvidenceForTarget('2026-09-30', 'd3', 3, facts([post('STAMPED_ELIGIBLE'), post('STALE'), post('STAMPED_ELIGIBLE')]), side)
  check('🔴 다른 판 · eligible 아닌 도장 하나라도 → FAIL STALE_RELEASE', stale.verdict === 'FAIL' && stale.codes.includes('STALE_RELEASE'))
  // 🔴 도장 = 완전한 계약 + 발행 사건과 같은 시각 (2026-09-30 야간 P0-A)
  const good = releaseStampOf(judge(ev()))
  check('도장 판정 — 발행 트랜잭션 모양 · 같은 사건 시각이면 STAMPED_ELIGIBLE',
    releaseStampStatusOf({ release: good }, NOW) === 'STAMPED_ELIGIBLE'
    && releaseStampStatusOf({}, NOW) === 'MISSING' && releaseStampStatusOf(null, NOW) === 'MISSING'
    && RELEASE_CONTRACT === 'source-slot-v1')
  const bad: [string, unknown, Date | null, string][] = [
    ['🔴 AS-IS 반례 — contract · verdict 두 칸뿐', { contract: 'source-slot-v1', verdict: 'eligible' }, NOW, 'stamp:fields'],
    ['🔴 AS-IS 반례 — slotAt:x · evaluatedAt:x · reasons · issue · evidenceVersion 전부 깨짐',
      { contract: 'source-slot-v1', verdict: 'eligible', slotAt: 'x', evaluatedAt: 'x', reasons: ['HARD_GATE'], issue: 'broken', evidenceVersion: null }, NOW, 'reasons:not-empty'],
    ['다른 계약 판', { ...good, contract: 'source-slot-v0' }, NOW, 'contract:mismatch'],
    ['eligible 아닌 판정', { ...good, verdict: 'unknown' }, NOW, 'verdict:not-eligible'],
    ['모르는 칸이 더 있다', { ...good, extra: 1 }, NOW, 'stamp:fields'],
    ['칸 하나 빠짐(issue)', (({ issue: _i, ...r }) => r)(good), NOW, 'stamp:fields'],
    ['reasons 배열 아님', { ...good, reasons: 'HARD_GATE' }, NOW, 'reasons:type'],
    ['reasons 모르는 코드', { ...good, reasons: ['NOPE'] }, NOW, 'reasons:type'],
    ['reasons 비어 있지 않음', { ...good, reasons: ['HARD_GATE'] }, NOW, 'reasons:not-empty'],
    ['issue non-null', { ...good, issue: 'observations[0]:not-object' }, NOW, 'issue:not-null'],
    ['evidenceVersion null', { ...good, evidenceVersion: null }, NOW, 'evidenceVersion:mismatch'],
    ['evidenceVersion 다른 판', { ...good, evidenceVersion: 'source-evidence-v0' }, NOW, 'evidenceVersion:mismatch'],
    ['slotAt 손상', { ...good, slotAt: 'x' }, NOW, 'slotAt:corrupt'],
    ['slotAt 비정규 ISO(시간대 없음)', { ...good, slotAt: NOW.toISOString().replace('Z', '') }, NOW, 'slotAt:corrupt'],
    ['slotAt 비정규 ISO(+09:00 표기)', { ...good, slotAt: '2026-10-01T09:30:00+09:00' }, NOW, 'slotAt:corrupt'],
    ['evaluatedAt 숫자', { ...good, evaluatedAt: NOW.getTime() }, NOW, 'evaluatedAt:corrupt'],
    ['🔴 발행 사건 시각 모름(null)', good, null, 'publishEvent:unknown'],
    ['🔴 도장 slotAt ≠ 발행 사건 (1ms)', good, new Date(NOW.getTime() + 1), 'slotAt:not-publish-event'],
    ['🔴 evaluatedAt 만 다른 사건', { ...good, evaluatedAt: new Date(NOW.getTime() - 60_000).toISOString() }, NOW, 'evaluatedAt:not-publish-event'],
    ['도장이 객체 아님', 'eligible', NOW, 'stamp:not-object'],
    ['도장이 배열', [good], NOW, 'stamp:not-object'],
  ]
  for (const [name, stamp, at, want] of bad) {
    const r = releaseStampCheck({ release: stamp }, at)
    check(`🔴 fail-closed — ${name} → STALE(${want})`, r.status === 'STALE' && r.issue === want, JSON.stringify(r))
  }
  // 🔴 발행 사건 시각 — 기록 정확히 한 줄 · publishedAt = createdAt
  check('🔴 발행 사건 helper — 한 줄 · 두 시각 같음만 시각이다 (허용 오차 없음)',
    publishEventAtOf([{ publishedAt: NOW, createdAt: NOW }])?.getTime() === NOW.getTime()
    && publishEventAtOf([]) === null
    && publishEventAtOf([{ publishedAt: null, createdAt: NOW }]) === null
    && publishEventAtOf([{ publishedAt: NOW, createdAt: new Date(NOW.getTime() + 1) }]) === null
    && publishEventAtOf([{ publishedAt: NOW, createdAt: NOW }, { publishedAt: NOW, createdAt: NOW }]) === null)
  // 옛 판(v4) 결정 위의 PASS · 지속 단계는 근거가 아니다
  const v4 = validateStoredDecision({ expectKstDate: '2026-09-30', row: {
    kstDate: '2026-09-30', capacity: 'd10', release: 'd5', state: 'SUSTAIN', reasons: [], blocks: [], dayPinned: false,
    supply: null, decidedAt: '2026-09-29T22:00:00.000Z', contractVersion: 'stage-decision-v4', decidedBy: 'controller',
    transition: { kind: 'SUSTAIN', from: 'd3', to: 'd5' },
  } })
  check('옛 판(v4) 행은 읽기만 한다 — 검증은 통과', v4.ok)
  if (v4.ok) {
    const pass = { kstDate: '2026-09-30', stage: 'd5' as const, verdict: 'PASS' as const, codes: [], counts: {} }
    check('🔴 🔴 **옛 판 결정 위의 PASS 로 한 칸 올리지 않는다 — 바닥(d1)에서 FLOOR 로 다시 증명한다**',
      trialPlanOf(v4.decision, pass)?.basis === 'FLOOR' && trialPlanOf(v4.decision, pass)?.target === 'd3')
    check('🔴 옛 판 결정의 지속 단계(d5)를 쓰지 않는다 → d1', sustainedReleaseOf(v4.decision, pass) === 'd1')
    const r = decideStage({
      kstDate: '2026-10-01', decidedAt: '2026-09-30T22:00:00.000Z', previousDecision: v4.decision, previousEvidence: pass,
      nextPreflight: null, publishedToday: 0, signals: [],
    })
    check('🔴 decideStage — 옛 판 d5 SUSTAIN 다음 날 공개는 d1 (preflight 없으면 시험도 없다)',
      r.decision.release === 'd1' && r.decision.state !== 'TRIAL' && r.decision.contractVersion === STAGE_DECISION_VERSION)
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n⑪ 개인정보 · 원문 노출')
{
  const e = sourceEvidenceOf({
    sourceSite: 'navercafe:wgang', sourceArticleId: '12345', sourcePostedAt: iso(hoursAgo(3)),
    sourceListedAt: iso(hoursAgo(1)), sourceCapturedAt: iso(hoursAgo(0.9)), reviewedAt: iso(hoursAgo(0.1)),
    sourceResponse: { views: 10, comments: 2, listRank: 1, listPage: 1, observedAt: iso(hoursAgo(1)), nickname: '누구', url: 'https://cafe.naver.com/x/1' },
    participationDriver: '공감', title: '원문 제목', body: '원문 본문',
  } as never, null)
  const flat = JSON.stringify(e)
  check('🔴 🔴 **증거 기록에 URL · 닉네임 · 제목 · 본문 · 원문 id 가 없다(id 는 해시)**',
    !/https?:|누구|원문 제목|원문 본문|12345/.test(flat), flat.slice(0, 200))
  check('기록 키 목록이 계약 그대로다', Object.keys(e).sort().join() === [
    'version', 'postedAt', 'listedAt', 'capturedAt', 'sourceKey', 'response', 'observations', 'sourceStats',
    'provenance', 'participationDriver', 'draftedAt'].sort().join())
  check('🔴 공개 글 데이터에 원문 출처 칸 금지(기존 FORBIDDEN_POST_KEYS 유지)', FORBIDDEN_POST_KEYS.includes('sourceArticleId') && FORBIDDEN_POST_KEYS.includes('sourceUrl'))
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
    const p = join(d, f)
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : []
  })
  const leaks = [...walk('src/app'), ...walk('src/components')].filter((f) => /sourceEvidence|source-slot-release|participationDriver/.test(readFileSync(f, 'utf-8')))
  check('🔴 공개 렌더링(src/app · src/components)이 증거 기록을 읽지 않는다', leaks.length === 0, leaks.join(','))
  const machine = buildQueuePayload({
    envelope: { provenance: MACHINE_PROFILE.envelopeProvenance } as never,
    candidate: { sourceSite: 'navercafe:wgang', sourceArticleId: '1' } as never, now: iso(NOW),
  })
  check('(참고) 봉투가 기계 계약이 아니면 payload 를 만들지 않는다 — 기록만 찍는 우회가 없다', machine === null)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑬ 🔴 (Lane B) 손상된 중첩 증거 — 러너를 죽이지 않고 EVIDENCE_INVALID + 손상 위치로 닫는다')
// ─────────────────────────────────────────────────────────
{
  const good = ev()
  check('기준 — 정상 기록은 모양 확인을 지난다', parseEvidence(good).ok && judge(good).verdict === 'eligible')
  /** 🔴 [이름, 손상 기록, 기대 issue] — 앞판은 앞 넷을 eligible 로 통과시키거나(3) 예외로 러너를 죽였다(1) */
  const W = (patch: Record<string, unknown>): unknown => ({ ...good, ...patch })
  const S = (patch: Record<string, unknown>): unknown => ({ ...good, sourceStats: { ...good.sourceStats!, ...patch } })
  const cases: [string, unknown, string][] = [
    ['observations: [null] (앞판 TypeError)', W({ observations: [null] }), 'observations[0]:not-object'],
    ['response: "x" (앞판 eligible)', W({ response: 'x' }), 'response:not-object'],
    ['response.comments: NaN (앞판 eligible)', W({ response: { ...good.response!, comments: Number.NaN } }), 'response.comments:not-count'],
    ['sourceStats.n: -1 (앞판 eligible)', S({ n: -1 }), 'sourceStats.n:not-count'],
    ['response.views: 소수', W({ response: { ...good.response!, views: 1.5 } }), 'response.views:not-count'],
    ['response.views: 문자열 숫자', W({ response: { ...good.response!, views: '600' } }), 'response.views:not-count'],
    ['response.views: Infinity', W({ response: { ...good.response!, views: Number.POSITIVE_INFINITY } }), 'response.views:not-count'],
    ['response.observedAt: 비정규', W({ response: { ...good.response!, observedAt: '어제' } }), 'response.observedAt:corrupt'],
    ['observations: 객체', W({ observations: { a: 1 } }), 'observations:not-array'],
    ['observations[0].observedAt: 없음', W({ observations: [{ views: 1, comments: 1 }] }), 'observations[0].observedAt:corrupt'],
    ['observations[0].comments: -3', W({ observations: [{ observedAt: iso(hoursAgo(1)), views: 1, comments: -3 }] }), 'observations[0].comments:not-count'],
    ['sourceStats: 배열', W({ sourceStats: [1] }), 'sourceStats:not-object'],
    ['sourceStats.basis: 다른 값', S({ basis: 'db' }), 'sourceStats.basis:mismatch'],
    ['🔴 sourceStats.sourceKey: 다른 원천(교차 정규화)', S({ sourceKey: 'navercafe:small' }), 'sourceStats.sourceKey:cross-source'],
    ['sourceStats.bucket: 모르는 구간', S({ bucket: '0-1h' }), 'sourceStats.bucket:unknown'],
    ['sourceStats.commentsPct: 1.5', S({ commentsPct: 1.5 }), 'sourceStats.commentsPct:out-of-range'],
    ['sourceStats.viewsPct: NaN', S({ viewsPct: Number.NaN }), 'sourceStats.viewsPct:out-of-range'],
    ['sourceStats.window: 끝 < 시작', S({ windowFrom: iso(NOW), windowTo: iso(hoursAgo(5)) }), 'sourceStats.window:end-before-start'],
    ['sourceStats.windowTo: 손상', S({ windowTo: 'x' }), 'sourceStats.window:corrupt'],
    ['provenance: null', W({ provenance: null }), 'provenance:not-object'],
    ['provenance.articleIdHash: 원문 id 그대로', W({ provenance: { ...good.provenance, articleIdHash: 'A1' } }), 'provenance.articleIdHash:not-hash'],
    ['provenance.artifactId: 숫자', W({ provenance: { ...good.provenance, artifactId: 7 } }), 'provenance.artifactId:type'],
    ['postedAt: 숫자', W({ postedAt: 1_700_000_000 }), 'postedAt:type'],
    ['listedAt: 비정규', W({ listedAt: '2026-10-01' }), 'listedAt:corrupt'],
    ['sourceKey: 빈 문자열', W({ sourceKey: '' }), 'sourceKey:type'],
    ['participationDriver: 객체', W({ participationDriver: {} }), 'participationDriver:type'],
    ['version 없음', W({ version: undefined }), 'version:mismatch'],
    ['기록이 문자열', 'x', 'record:not-object'],
    // ── 시각 순서 · 미래 (판정 안 · 게시/수집 고유 코드 다음) ──
    ['🔴 관측이 게시보다 이르다(끝 < 시작)', W({ observations: [{ observedAt: iso(hoursAgo(5)), views: 1, comments: 1 }] }), 'observations[0].observedAt:before-posted'],
    ['🔴 목록 시각이 게시보다 이르다', W({ listedAt: iso(hoursAgo(4)) }), 'listedAt:before-posted'],
    ['🔴 관측 시각이 판정 시각보다 미래', W({ observations: [{ observedAt: iso(new Date(NOW.getTime() + 2 * H)), views: 1, comments: 1 }] }), 'observations[0].observedAt:future'],
    ['🔴 표본 창 끝이 판정 시각보다 미래', S({ windowTo: iso(new Date(NOW.getTime() + 2 * H)) }), 'sourceStats.windowTo:future'],
  ]
  for (const [name, rec, want] of cases) {
    let v: ReturnType<typeof judge> | null = null
    let threw = ''
    try { v = judge(rec) } catch (e) { threw = e instanceof Error ? e.message : String(e) }
    check(`🔴 ${name} → 예외 없이 unknown · EVIDENCE_INVALID @${want} · 만료 사유`,
      threw === '' && v !== null && v.verdict === 'unknown' && v.reasons[0] === 'EVIDENCE_INVALID' && v.issue === want && v.expires,
      threw !== '' ? `THROW ${threw}` : JSON.stringify({ r: v?.reasons, i: v?.issue }))
  }
  // 🔴 감사 · 운영 진단이 손상 위치를 식별한다 — 값 · 원문 · 원문 id 는 없다
  const broken = judge(W({ observations: [null] }))
  const stamp = releaseStampOf(broken)
  check('🔴 🔴 **release 도장 · 설명 줄에 손상 위치가 남는다** (감사 · 운영 진단)',
    stamp.issue === 'observations[0]:not-object' && describeRelease(broken).includes('@observations[0]:not-object'))
  const cand = (id: string, g: unknown): QueueCandidate => ({
    queueId: id, title: 't', body: 'b', gateVerdict: 'PASS', createdAt: 0, assignedPersonaCode: null,
    gateResults: { [SOURCE_EVIDENCE_KEY]: g }, voice: null, profile: 'human',
  })
  const prep = prepareCandidates({ candidates: [cand('bad', W({ observations: [null] })), cand('ok', good)], personas: [], at: NOW })
  check('🔴 🔴 **손상 행 하나가 계획 전체를 죽이지 않는다** — 그 행만 held(EVIDENCE_INVALID · issue · 만료) · 정상 행은 계획에 남는다',
    prep.held.length === 1 && prep.held[0]!.queueId === 'bad' && prep.held[0]!.hold === 'EVIDENCE_INVALID'
    && prep.held[0]!.issue === 'observations[0]:not-object' && prep.held[0]!.expires && prep.auto.some((a) => a.queueId === 'ok'))
  check('🔴 issue 에는 값 · 원문 id 가 없다(경로 · 종류뿐)',
    cases.every(([, rec]) => {
      const i = ((): string => { try { return judge(rec).issue ?? '' } catch { return 'THROW' } })()
      return /^[a-zA-Z.[\]0-9]+:[a-z-]+$/.test(i) && !i.includes('A1')
    }))

  /**
   * 🔴 **무작위 손상 fuzz** — 정상 기록의 칸 하나를 무작위 타입 값으로 바꾸고 판정을 부른다. 예외 0 이어야 한다.
   *    결정론적 PRNG(시드 고정) — 같은 입력이면 같은 결과다.
   */
  let seed = 20260930
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31 }
  const junk: unknown[] = [null, undefined, 0, -1, 1.5, Number.NaN, Infinity, '', 'x', '2026-10-01', true, [], [null], {}, { a: 1 }, [{}]]
  const paths: string[][] = [
    ['postedAt'], ['listedAt'], ['capturedAt'], ['draftedAt'], ['sourceKey'], ['participationDriver'], ['version'],
    ['response'], ['response', 'views'], ['response', 'comments'], ['response', 'listRank'], ['response', 'observedAt'],
    ['observations'], ['observations', '0'], ['observations', '0', 'observedAt'], ['observations', '0', 'comments'],
    ['sourceStats'], ['sourceStats', 'n'], ['sourceStats', 'commentsPct'], ['sourceStats', 'windowFrom'], ['sourceStats', 'windowTo'],
    ['sourceStats', 'sourceKey'], ['sourceStats', 'method'], ['provenance'], ['provenance', 'articleIdHash'],
  ]
  const base = ev({ observations: [{ observedAt: iso(hoursAgo(1)), views: 10, comments: 1 }] })
  let throws = 0
  let eligibleCorrupt = 0
  const N = 2000
  const okNumber = (leaf: string, value: unknown): boolean => value === null
    || (typeof value === 'number' && (leaf === 'commentsPct' ? Number.isFinite(value) && value >= 0 && value <= 1 : Number.isSafeInteger(value) && value >= 0))
  for (let k = 0; k < N; k += 1) {
    const rec = JSON.parse(JSON.stringify(base)) as Record<string, unknown>
    const path = paths[Math.floor(rnd() * paths.length)]!
    const value = junk[Math.floor(rnd() * junk.length)]
    let cur: Record<string, unknown> = rec
    for (let d = 0; d < path.length - 1; d += 1) {
      const next = cur[path[d]!]
      if (next === null || typeof next !== 'object') { cur = {}; break }
      cur = next as Record<string, unknown>
    }
    const leaf = path[path.length - 1]!
    cur[leaf] = value
    try {
      const v = judgeSlotRelease({ evidence: rec, slotAt: NOW, now: NOW, hardGates: { ok: true, codes: [] }, assignment: { ok: true }, tieBreak: 'f' })
      // 🔴 숫자 칸에 수가 아닌 값이 들어갔는데 eligible 이면 손상이 통과한 것이다
      if (v.verdict === 'eligible' && ['views', 'comments', 'listRank', 'n', 'commentsPct'].includes(leaf) && !okNumber(leaf, value)) eligibleCorrupt += 1
    } catch { throws += 1 }
  }
  check(`🔴 🔴 **무작위 손상 ${N}건 — 예외 0** (러너가 죽지 않는다)`, throws === 0, `${throws}건 예외`)
  check('🔴 🔴 **숫자 칸 손상이 eligible 로 통과한 경우 0**', eligibleCorrupt === 0, `${eligibleCorrupt}건`)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑭ 🔴 (Lane B) 작은 표본 정규화 — 신뢰도가 없으면 UNKNOWN · 새 최소 수 없음')
// ─────────────────────────────────────────────────────────
{
  const at = NOW
  const posted = iso(hoursAgo(2))
  const seen = iso(hoursAgo(1))
  const me = 'navercafe:t::me'
  const obs = (i: number, c: number | null, v: number | null, key = `navercafe:t::o${i}`): ListObservation =>
    ({ sourceKey: 'navercafe:t', articleKey: key, postedAt: posted, observedAt: seen, comments: c, views: v })
  const snap = (smp: ListObservation[], c: number | null, v: number | null) => sourceStatsSnapshot({
    sourceKey: 'navercafe:t', articleKey: me, postedAt: posted, observedAt: seen, comments: c, views: v, sample: smp, at,
  })!
  type Obs = { observedAt: string; views: number | null; comments: number | null }
  const verdictOf = (st: ReturnType<typeof snap>, c: number | null, v: number | null, observations: Obs[] = []) =>
    judge(buildSourceEvidence({
      postedAt: posted, listedAt: seen, capturedAt: seen, sourceSite: 'navercafe:t', sourceArticleId: 'me',
      response: { views: v, comments: c, listRank: 1, listPage: 1, observedAt: seen }, observations, sourceStats: st,
      participationDriver: '동력', draftedAt: iso(hoursAgo(0.5)),
    }))
  const s0 = snap([], 5, 50)
  check('🔴 표본 0 → 백분위 null · RESPONSE_UNNORMALIZED(unknown)', s0.n === 0 && s0.commentsPct === null && verdictOf(s0, 5, 50).reasons[0] === 'RESPONSE_UNNORMALIZED')
  const sSelf = snap([obs(0, 5, 50, me)], 5, 50)
  check('🔴 🔴 **표본이 자기 자신 1건 → 자기 제외 n=0 · UNKNOWN** (앞판: 백분위 0.5 · eligible)',
    sSelf.n === 0 && sSelf.commentsPct === null && verdictOf(sSelf, 5, 50).verdict === 'unknown')
  const s1 = snap([obs(1, 3, 30)], 5, 50)
  check('🔴 표본 1건(남) → 분포에 모양이 없다 · null · UNKNOWN', s1.n === 1 && s1.commentsPct === null && s1.viewsPct === null && verdictOf(s1, 5, 50).verdict === 'unknown')
  const same = [1, 2, 3, 4, 5, 6].map((i) => obs(i, 0, 10))
  const sSame = snap(same, 0, 10)
  check('🔴 🔴 **표본 전원 같은 값(댓글 0 · 조회 10) → null · UNKNOWN** (앞판: 0.5)', sSame.commentsPct === null && sSame.viewsPct === null && verdictOf(sSame, 0, 10).verdict === 'unknown')
  check('🔴 같은 값 표본에서 후보만 크다 — 자리가 정의되지 않는다(크다고 1.0 을 주지 않는다)', snap(same, 9, 99).commentsPct === null)
  const spread = [0, 1, 2, 3, 4, 5, 6, 7].map((c, i) => obs(i, c, c * 10))
  const withExtreme = [...spread, obs(99, 100_000, 9_999_999)]
  check('🔴 극단치 한 건은 순위 한 칸만 움직인다 — 중간 후보 백분위가 흔들리지 않는다',
    Math.abs((snap(spread, 4, 40).commentsPct ?? 0) - (snap(withExtreme, 4, 40).commentsPct ?? 0)) < 0.07)
  check('🔴 후보가 극단치여도 백분위는 1 을 넘지 않는다', snap(spread, 1_000_000, 1).commentsPct === 1)
  const vOnly = verdictOf(snap(spread.map((o) => ({ ...o, comments: null })), null, 55), null, 55)
  check('조회만 있다 → 조회 백분위로 정규화 · eligible · 댓글 백분위 null(순서에서 뒤)', vOnly.verdict === 'eligible' && vOnly.rank.commentsPct === null && vOnly.rank.viewsPct !== null)
  const cOnly = verdictOf(snap(spread.map((o) => ({ ...o, views: null })), 5, null), 5, null)
  check('댓글만 있다 → 댓글 백분위로 정규화 · eligible', cOnly.verdict === 'eligible' && cOnly.rank.commentsPct !== null && cOnly.rank.viewsPct === null)
  check('🔴 조회 · 댓글 모두 모르고 순위만 있다 → RESPONSE_UNOBSERVED (자리는 반응이 아니다)',
    judge(buildSourceEvidence({
      postedAt: posted, listedAt: seen, capturedAt: seen, sourceSite: 'navercafe:t', sourceArticleId: 'me',
      response: { views: null, comments: null, listRank: 1, listPage: 1, observedAt: seen }, sourceStats: snap(spread, null, null), participationDriver: '동력',
    })).reasons[0] === 'RESPONSE_UNOBSERVED')
  check('🔴 댓글만 있는 후보가 조회만 있는 후보보다 먼저다(모르는 성분은 뒤)', compareReleaseRank(cOnly.rank, vOnly.rank) < 0)
  const once = verdictOf(snap(spread, 4, 40), 4, 40, [{ observedAt: seen, views: 40, comments: 4 }])
  const twice = verdictOf(snap(spread, 4, 40), 4, 40, [{ observedAt: iso(hoursAgo(1.5)), views: 20, comments: 2 }, { observedAt: seen, views: 40, comments: 4 }])
  check('반복 관측 1회 → velocity null · 판정은 그대로(eligible)', once.verdict === 'eligible' && once.rank.velocity === null)
  check('반복 관측 2회 → velocity 4/h · 같은 백분위끼리만 가른다', twice.verdict === 'eligible' && twice.rank.velocity === 4
    && compareReleaseRank(twice.rank, once.rank) < 0)
  const legacy = { ...snap(spread, 4, 40), method: undefined } as unknown as ReturnType<typeof snap>
  check('🔴 🔴 **정규화 판이 없는(옛) 스냅샷 → RESPONSE_UNNORMALIZED** — 자기 포함 0.5 를 믿지 않는다', verdictOf(legacy, 4, 40).reasons[0] === 'RESPONSE_UNNORMALIZED')
  check('스냅샷은 지금 정규화 판을 적는다', snap(spread, 4, 40).method === SOURCE_STATS_METHOD)
  check('relativePosition — 값 없음 · 한 점 분포 → null · 두 값 이상이면 백분위',
    relativePosition(null, [1, 2]) === null && relativePosition(3, [2, 2]) === null && relativePosition(2, [1, 3]) === 0.5)
  check('🔴 새 최소 표본 수를 만들지 않았다 — 서로 다른 값 둘이면 n=2 로도 정규화된다', snap([obs(1, 0, 0), obs(2, 3, 30)], 2, 20).commentsPct === 0.5)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑫ JIT 수요 · 다음 단계 preflight (D3~D100 한 함수)')
{
  check('🔴 수요 = 슬롯 − eligible READY', judgeJitDemand({ slots: 4, readyFilled: 1 }).upTo === 3 && judgeJitDemand({ slots: 4, readyFilled: 1 }).llm)
  check('🔴 덮였으면 생성 0 · 모르면 파일 단계만(모델 0)', !judgeJitDemand({ slots: 3, readyFilled: 3 }).llm && !judgeJitDemand(null).llm)
  const facts: PreflightFacts = {
    slotValidOpportunities: 3, readyPerSource: 0.5, latencyP50H: 20, latencyP90H: 40, contractValidPersonas: 30,
    commentUsdPerRequest: 0.001, commentDailyUsdCap: 0.2, auditUsdPerCall: 0.005, auditDailyUsdCap: 0.3,
    supplyUsdPerReady: 0.02, supplyDailyUsdCap: 0.5, runnerHealth: 'ok',
  }
  check('d3 모든 사실이 있으면 PASS', judgeNextPreflight('d3', facts, RUNNER_GRID).verdict === 'PASS', JSON.stringify(judgeNextPreflight('d3', facts, RUNNER_GRID).codes))
  const noPersona = judgeNextPreflight('d3', { ...facts, contractValidPersonas: null }, RUNNER_GRID)
  check('🔴 🔴 **계약 유효 Persona 제공자가 없으면(null) UNKNOWN — 활성 행 수로 대체하지 않는다 · 열지 않는다**',
    noPersona.verdict === 'UNKNOWN' && noPersona.codes.includes('PERSONA_UNKNOWN'))
  check('🔴 기회 부족 → FAIL OPPORTUNITY_SHORT (완성 글 며칠치가 아니라 증명일 슬롯 수)',
    judgeNextPreflight('d5', { ...facts, contractValidPersonas: 40 }, RUNNER_GRID).codes.includes('OPPORTUNITY_SHORT'))
  check('🔴 지연 관측 없음 → UNKNOWN', judgeNextPreflight('d3', { ...facts, latencyP50H: null, latencyP90H: null }, RUNNER_GRID).codes.includes('LATENCY_UNKNOWN'))
  check('🔴 러너 모름 → UNKNOWN · 나쁨 → FAIL',
    judgeNextPreflight('d3', { ...facts, runnerHealth: 'unknown' }, RUNNER_GRID).codes.includes('RUNNER_UNKNOWN')
    && judgeNextPreflight('d3', { ...facts, runnerHealth: 'bad' }, RUNNER_GRID).verdict === 'FAIL')
  check('🔴 3일 정산 단가 × 필요량이 상한을 넘으면 FAIL SUPPLY_COST_SHORT',
    judgeNextPreflight('d3', { ...facts, supplyUsdPerReady: 0.2 }, RUNNER_GRID).codes.includes('SUPPLY_COST_SHORT'))
  const slots = slotTimesOn('2026-10-01', profileOf('d3'))
  const always: SlotOpportunity = { key: 'r', validAt: () => true }
  const src = (k: string): SlotOpportunity => ({ key: k, validAt: () => true })
  const o = slotValidOpportunitiesOf({ slots, ready: [always], sources: [src('s1'), src('s2')], readyPerSource: 0.5 })
  check('🔴 기회 = READY 짝 + 원천 기회 × 측정 수율(내림) — 1 + floor(2×0.5) = 2', o.total === 2 && o.readyFilled === 1 && o.sourceFilled === 2)
  check('🔴 수율을 모르면 원천 기회를 세지 않는다(과대평가 금지)',
    slotValidOpportunitiesOf({ slots, ready: [always], sources: [src('s1'), src('s2')], readyPerSource: null }).total === 1)

  // 🔴 (2026-10-01 Lane B) 수율은 **원천 1건당** — 원천 수에 곱한다. 슬롯 짝 수(≤ 남은 슬롯)에 곱하면
  //    수율 < 1/슬롯 수 일 때 원천이 몇 건이든 0 이다(운영 재현: 221 원천 · 수율 30/305 → floor(3×0.098) = 0)
  const many = (n: number, validAt: (d: Date) => boolean = () => true): SlotOpportunity[] =>
    Array.from({ length: n }, (_, i) => ({ key: `m${String(i).padStart(3, '0')}`, validAt }))
  const prod = slotValidOpportunitiesOf({ slots, ready: [], sources: many(221), readyPerSource: 30 / 305 })
  check('🔴 🔴 **운영 모양 — 원천 221 · 수율 30/305 · d3 슬롯 3 → 기회 3 (앞판 0)**',
    prod.total === 3 && prod.sourceValid === 221 && prod.sourceExpected === 3, JSON.stringify(prod))
  check('🔴 원천 100 · 수율 0.1 → floor(10) 이지만 슬롯 짝(3)을 넘지 못한다 → 3',
    slotValidOpportunitiesOf({ slots, ready: [], sources: many(100), readyPerSource: 0.1 }).total === 3)
  const few = slotValidOpportunitiesOf({ slots, ready: [], sources: many(5), readyPerSource: 0.1 })
  check('🔴 과대평가 금지 — 원천 5 · 수율 0.1 → floor(0.5) = 0', few.total === 0 && few.sourceExpected === 0, JSON.stringify(few))
  const first = slots[0]!.getTime()
  const onlyFirst = slotValidOpportunitiesOf({
    slots, ready: [], sources: many(20, (d) => d.getTime() === first), readyPerSource: 0.5,
  })
  check('🔴 짝짓기 상한 — 첫 슬롯에만 eligible 인 원천 20 · 수율 0.5 → floor(10) 이어도 덮는 슬롯은 1 → 1',
    onlyFirst.total === 1 && onlyFirst.sourceFilled === 1, JSON.stringify(onlyFirst))
  const firstOnlyReady: SlotOpportunity = { key: 'r', validAt: (d) => d.getTime() === first }
  const taken = slotValidOpportunitiesOf({
    slots, ready: [firstOnlyReady], sources: many(30, (d) => d.getTime() === first), readyPerSource: 0.5,
  })
  check('🔴 READY 가 이미 덮은 슬롯에만 eligible 인 원천은 남은 슬롯 기회가 아니다 → READY 1 + 0',
    taken.total === 1 && taken.readyFilled === 1 && taken.sourceValid === 0, JSON.stringify(taken))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 DB 0 · 네트워크 0 · LLM 0 · 파일 write 0\n')
if (fail > 0) process.exit(1)
