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
 *   발행 트랜잭션 경쟁 · 교체 · Queue/Post/ActivityLog 정합은 격리 DB 검사(`publish:slot-db-check`)가 본다.
 *
 *   `check:source-times` 가 이 파일을 실행한다(CI 연결).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import {
  buildSourceEvidence, compareReleaseRank, judgeSlotRelease, matchOpportunitiesToSlots, percentileOf,
  observationBucketOf, readSourceEvidence, releaseStampStatusOf, releaseStampOf, sourceStatsSnapshot, velocityOf,
  EXPIRING_REASONS, RELEASE_CONTRACT, SOURCE_AGE_LIMIT_HOURS, SOURCE_EVIDENCE_KEY, SOURCE_EVIDENCE_VERSION,
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
  const two = [{ observedAt: iso(hoursAgo(5)), views: 100, comments: 2 }, { observedAt: iso(hoursAgo(1)), views: 300, comments: 10 }]
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
  const post = (release: EvidencePost['release']): EvidencePost => ({
    postId: `p-${release}-${Math.random()}`, queueId: `q-${Math.random()}`, publishedAtMs: NOW.getTime(), unattended: true,
    queueRows: 1, publishLogs: 1, authorPersonaId: 'A', decider: 'auto',
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
  check('도장 판정 함수 — 계약 · eligible 둘 다 맞아야 STAMPED_ELIGIBLE',
    releaseStampStatusOf({ release: releaseStampOf(judge(ev())) }) === 'STAMPED_ELIGIBLE'
    && releaseStampStatusOf({ release: { contract: 'source-slot-v0', verdict: 'eligible' } }) === 'STALE'
    && releaseStampStatusOf({}) === 'MISSING' && RELEASE_CONTRACT === 'source-slot-v1')
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
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 DB 0 · 네트워크 0 · LLM 0 · 파일 write 0\n')
if (fail > 0) process.exit(1)
