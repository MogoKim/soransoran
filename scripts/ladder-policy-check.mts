#!/usr/bin/env tsx
/**
 * 사다리 정책 검사 — 하루 판정(수 + 결의 비율 + 무결성)과 올림·유지·브레이크 전이를 **동작으로** 잰다.
 *
 *   npm run stage:ladder-policy-check
 *
 * 순수 함수만 부른다(DB 0 · 파일 0 · provider 0). 사례는 2026-09-29~11-19 운영 로그 재생에서 가져왔다:
 * 20편을 다 내고도 첫 댓글 1건 누락·장부 1건·공급 회차 1건으로 하루가 무효였던 날, 실패한 시험 다음 날
 * 공개가 아래 칸으로 되돌아간 날, 추정 비용만으로 시험이 닫힌 날.
 */
import { profileOf, type RuntimeStage } from '../src/lib/scale-profile'
import { nextStage, validateStoredDecision, type StageDecision, type ValidatedStageDecision } from '../src/lib/stage-decision-contract'
import {
  judgeStageEvidence, evidencePlainLineOf,
  type EvidencePost, type EvidenceSideSignals, type StageEvidenceFacts, type StageEvidenceVerdict,
} from '../src/lib/stage-evidence'
import { consecutivePassDays, openStageHeldBy, type LadderDay } from '../src/lib/stage-ladder'
import { decideStage, openStageOf, validateForToday, type HealthSignal } from '../src/lib/stage-controller'
import { judgeNextPreflight, preflightPlainLinesOf, type PreflightFacts, type PreflightVerdict } from '../src/lib/stage-ladder-generic'
import { LADDER, LADDER_RULE, commentDepthFloorOf, countFloorOf, ladderRowOf } from '../src/lib/ladder-table'
import { FIRST_COMMENT_DELAY_MAX_MS } from '../src/lib/persona-comment-auto-lane'
import { THREAD_DEADLINE_MS, threadMeanSizeAt } from '../src/lib/persona-thread-target'
import { RUNNER_GRID } from './lib/stage-preflight-facts.mjs'

let pass = 0
let fail = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) pass += 1
  else fail += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${!ok && detail !== '' ? ` — ${detail}` : ''}`)
}

const MIN = 60_000
const HOUR = 60 * MIN
const dayStart = (kstDate: string): number => Date.parse(`${kstDate}T00:00:00+09:00`)
const nextDate = (d: string): string => new Date(Date.parse(`${d}T00:00:00Z`) + 864e5).toISOString().slice(0, 10)

type PostShape = {
  /** 첫 댓글이 공개 뒤 몇 ms 에 달렸나 — null 이면 없다 */
  firstAfterMs?: number | null
  /** 첫 댓글 뒤에 붙는 추가 댓글의 화자(글쓴이 아닌 Persona 번호) */
  followupVoices?: readonly number[]
  /** 글쓴이가 자기 글에 단 답글 수(추가 댓글 출처) */
  authorReplies?: number
  capturedBeforeMs?: number | null
  provenance?: 'auto' | 'broken'
  followupBroken?: boolean
  manual?: boolean
}

/** 그날 08시부터 10분 간격으로 나간 자동 글. 기본 모양은 모든 결을 넉넉히 통과한다 */
function postsOf(kstDate: string, shapes: readonly PostShape[]): EvidencePost[] {
  return shapes.map((s, i) => {
    const publishedAtMs = dayStart(kstDate) + 8 * HOUR + i * 10 * MIN
    const first = s.firstAfterMs === undefined ? 5 * MIN : s.firstAfterMs
    const voices = s.followupVoices ?? [2, 3, 4, 5, 6]
    const comments: EvidencePost['personaComments'][number][] = []
    if (first !== null) {
      comments.push({ personaId: `c${i}-1`, createdAtMs: publishedAtMs + first, topLevel: true, provenance: s.provenance ?? 'auto' })
    }
    voices.forEach((v, k) => comments.push({
      personaId: `c${i}-${v}`, createdAtMs: publishedAtMs + (20 + k * 15) * MIN, topLevel: false,
      provenance: s.followupBroken === true && k === 0 ? 'followup-broken' : 'followup',
    }))
    for (let k = 0; k < (s.authorReplies ?? 0); k += 1) {
      comments.push({ personaId: `a${i}`, createdAtMs: publishedAtMs + (25 + k * 15) * MIN, topLevel: false, provenance: 'followup' })
    }
    if (s.manual === true) comments.push({ personaId: `c${i}-m`, createdAtMs: publishedAtMs + 30 * MIN, topLevel: true, provenance: 'none' })
    return {
      postId: `${kstDate}-p${i}`, queueId: `${kstDate}-q${i}`, publishedAtMs,
      capturedAtMs: s.capturedBeforeMs === null ? null : publishedAtMs - (s.capturedBeforeMs ?? 90 * MIN),
      unattended: true, queueRows: 1, publishLogs: 1, authorPersonaId: `a${i}`, decider: 'auto',
      personaComments: comments, release: 'STAMPED_ELIGIBLE',
    }
  })
}

const SIDE: EvidenceSideSignals = {
  cost: [{ lane: 'comment', name: '댓글 장부', health: 'ok' }, { lane: 'audit', name: '감사 장부', health: 'ok' }],
  supplyCostEvidence: {
    wholeDayCriticalHealth: 'ok',
    envelope: { settledRequests: 40, usageUnknownRequests: 0, overrunRequests: 0, ineligibleRequests: 0, riskUsd: 1.0, budgetUsd: 1.8 },
  },
}

function factsOf(kstDate: string, stage: RuntimeStage, posts: EvidencePost[], o: Partial<StageEvidenceFacts> = {}): StageEvidenceFacts {
  const sample = Math.ceil(posts.length * 0.2)
  return {
    kstDate, stage, decision: { kstDate, release: stage, decidedBy: 'controller' },
    // 다음 날 07:00 — 그날 글의 첫 댓글 창과 대화 마감이 전부 닫혀 있다
    readAtMs: dayStart(kstDate) + 31 * HOUR,
    posts, orphanPublishLogs: 0, unloggedPublishes: 0,
    audits: { rows: posts.slice(0, sample).map((p) => ({ postId: p.postId, queueId: p.queueId ?? '', judged: true })) },
    ...o,
  }
}
const judgeDay = (kstDate: string, stage: RuntimeStage, shapes: readonly PostShape[], o: Partial<StageEvidenceFacts> = {}): StageEvidenceVerdict =>
  judgeStageEvidence(kstDate, stage, factsOf(kstDate, stage, postsOf(kstDate, shapes), o), SIDE)
const many = (n: number, shape: PostShape = {}): PostShape[] => Array.from({ length: n }, () => shape)
const has = (v: StageEvidenceVerdict, code: string): boolean => (v.codes as readonly string[]).includes(code)

const D = '2026-11-21'
const N30 = profileOf('d30').dailyTarget
const WINDOW = LADDER_RULE.firstCommentWindowMs

console.log('\n① 숫자의 원천 — 표 한 곳과 이미 있는 상수')
check('수의 통과선은 목표 × countRatio 를 올림한 값이다 (부동소수 30 × 0.9 가 28 이 되지 않는다)',
  countFloorOf(30) === 27 && countFloorOf(50) === 45 && countFloorOf(20) === 18 && countFloorOf(1) === 1)
check('첫 댓글 판정 창 = 댓글 러너 대기 상한 + 처리 여유 — 대기 상한보다 길다',
  WINDOW > FIRST_COMMENT_DELAY_MAX_MS && WINDOW - FIRST_COMMENT_DELAY_MAX_MS === MIN)
check('글당 댓글 통과선 = 그날 글의 목표 평균 × countRatio', commentDepthFloorOf(threadMeanSizeAt(dayStart(D))) === threadMeanSizeAt(dayStart(D)) * LADDER_RULE.countRatio)
check('표는 러너 단계 전부와 d100 을 한 줄씩 가진다 — 단계를 더하는 일은 한 줄이다',
  ['d1', 'd3', 'd5', 'd10', 'd20', 'd30', 'd50', 'd100'].every((s) => ladderRowOf(s) !== null) && LADDER.length === 8)

console.log('\n② 수 — 목표의 90%')
const full = judgeDay(D, 'd30', many(N30))
check('30/30 · 결 전부 충족 → PASS', full.verdict === 'PASS', JSON.stringify(full.codes))
check('27/30 → PASS (옛 판정은 N−1 도 FAIL 이었다)', judgeDay(D, 'd30', many(27)).verdict === 'PASS')
const short = judgeDay(D, 'd30', many(26))
check('26/30 → FAIL PUBLISH_SHORT', short.verdict === 'FAIL' && has(short, 'PUBLISH_SHORT'), JSON.stringify(short.codes))
check('11-18 의 모양: d20 18/20 → PASS', judgeDay(D, 'd20', many(18)).verdict === 'PASS')
check('11-17 의 모양: d30 24/30 → FAIL', judgeDay(D, 'd30', many(24)).verdict === 'FAIL')

console.log('\n③ 결 ① 첫 댓글 — 비율로 잰다')
const oneMiss = judgeDay(D, 'd30', [...many(29), { firstAfterMs: null }])
check('30편 중 1건 누락 → PASS (한 건 누락이 하루를 무효로 만들지 않는다)', oneMiss.verdict === 'PASS', JSON.stringify(oneMiss.codes))
const twoMiss = judgeDay(D, 'd30', [...many(28), { firstAfterMs: null }, { firstAfterMs: null }])
check('30편 중 2건 누락 → FAIL FIRST_COMMENT_SHORT', twoMiss.verdict === 'FAIL' && has(twoMiss, 'FIRST_COMMENT_SHORT'), JSON.stringify(twoMiss.codes))
check('11-01·11-07 의 모양: d20 20편 중 1건 누락(95%) → PASS',
  judgeDay(D, 'd20', [...many(19), { firstAfterMs: null }]).verdict === 'PASS')
const atEdge = judgeDay(D, 'd30', [...many(28), { firstAfterMs: WINDOW }, { firstAfterMs: WINDOW }])
check('창 끝에 정확히 달린 댓글은 창 안이다', atEdge.verdict === 'PASS' && atEdge.counts.firstCommentOk === 30, JSON.stringify(atEdge.counts))
const late = judgeDay(D, 'd30', [...many(28), { firstAfterMs: WINDOW + 1 }, { firstAfterMs: WINDOW + 1 }])
check('창을 1ms 넘긴 댓글 2건 → 누락과 같다(FIRST_COMMENT_SHORT)', has(late, 'FIRST_COMMENT_SHORT') && late.counts.firstCommentOk === 28)
check('대기 상한을 다 채우고 30초 뒤 달린 댓글은 창 안이다 — 대기 상한과 같은 창이면 매일 넘는다',
  judgeDay(D, 'd30', many(N30, { firstAfterMs: FIRST_COMMENT_DELAY_MAX_MS + 30_000 })).verdict === 'PASS')

console.log('\n④ 결 ②③ 글당 댓글 · 타인 3명')
const floor = commentDepthFloorOf(threadMeanSizeAt(dayStart(D)))
// 글당 6건(첫 댓글 1 + 추가 5) 과 5건을 섞어 평균을 통과선 바로 위·아래로 만든다
const depthOf = (six: number, five: number): StageEvidenceVerdict =>
  judgeDay(D, 'd30', [...many(six), ...many(five, { followupVoices: [2, 3, 4, 5] })])
const justOver = depthOf(13, 17)
const justUnder = depthOf(11, 19)
check('글당 평균이 통과선 이상 → PASS', justOver.counts.commentDepthAvg! >= floor && justOver.verdict === 'PASS', JSON.stringify(justOver.counts))
check('글당 평균이 통과선 미만 → FAIL COMMENT_DEPTH_SHORT',
  justUnder.counts.commentDepthAvg! < floor && justUnder.verdict === 'FAIL' && has(justUnder, 'COMMENT_DEPTH_SHORT'), JSON.stringify(justUnder.counts))
const ratio = ladderRowOf('d30')!.threeVoicesRatio
const quiet: PostShape = { followupVoices: [2, 2, 2, 2, 2] } // 댓글 6건이지만 글쓴이 아닌 화자는 둘뿐
const voicesOk = judgeDay(D, 'd30', [...many(Math.ceil(N30 * ratio)), ...many(N30 - Math.ceil(N30 * ratio), quiet)])
const voicesShort = judgeDay(D, 'd30', [...many(Math.ceil(N30 * ratio) - 1), ...many(N30 - Math.ceil(N30 * ratio) + 1, quiet)])
check('타인 3명 이상인 글이 표의 비율 이상 → PASS', voicesOk.verdict === 'PASS', JSON.stringify(voicesOk.codes))
check('한 편 모자라면 FAIL THREE_VOICES_SHORT (댓글 수는 같다 — 평균이 아니라 화자를 센다)',
  voicesShort.verdict === 'FAIL' && has(voicesShort, 'THREE_VOICES_SHORT') && !has(voicesShort, 'COMMENT_DEPTH_SHORT'), JSON.stringify(voicesShort.codes))
// 글쓴이 자신은 "타인"이 아니다 — 다른 화자 둘 + 글쓴이 답글로는 세 명이 되지 않는다
const authorTalk: PostShape = { followupVoices: [2, 2, 2, 2], authorReplies: 1 }
const voicesAuthor = judgeDay(D, 'd30', [...many(Math.ceil(N30 * ratio) - 1), ...many(N30 - Math.ceil(N30 * ratio) + 1, authorTalk)])
check('글쓴이 답글은 타인으로 세지 않는다 — 다른 화자 둘 + 글쓴이면 THREE_VOICES_SHORT',
  voicesAuthor.verdict === 'FAIL' && has(voicesAuthor, 'THREE_VOICES_SHORT') && !has(voicesAuthor, 'COMMENT_DEPTH_SHORT'), JSON.stringify(voicesAuthor.codes))
check('d50 은 표의 더 높은 비율을 쓴다', ladderRowOf('d50')!.threeVoicesRatio > ratio)

console.log('\n⑤ 결 ④ 수집→공개 — 재고 찍되, gate 가 꺼져 있는 동안 막지 않는다')
const slow = judgeDay(D, 'd30', many(N30, { capturedBeforeMs: 5 * HOUR }))
check('중앙값 5시간 · gate=false → PASS 이고 값은 counts 에 찍힌다',
  LADDER_RULE.collectToPublish.gate === false && slow.verdict === 'PASS' && slow.counts.collectToPublishMedianH === 5, JSON.stringify(slow.counts))
check('사람이 읽는 줄에 "수집→공개 5시간(재기만)" 이 찍힌다', (evidencePlainLineOf(slow) ?? '').includes('수집→공개 5시간(재기만)'))
const noCapture = judgeDay(D, 'd30', many(N30, { capturedBeforeMs: null }))
check('수집 시각을 못 읽은 날 — 값을 지어내지 않는다(모름으로 찍힌다)',
  noCapture.counts.collectToPublishMedianH === undefined && (evidencePlainLineOf(noCapture) ?? '').includes('수집→공개 모름'))

console.log('\n⑥ 창이 닫히지 않은 글은 분모에서 빠진다')
const justPublished = factsOf(D, 'd30', postsOf(D, [...many(29), { firstAfterMs: null, followupVoices: [] }]))
// 마지막 글(12:50 공개)의 첫 댓글 창이 아직 열려 있는 시각에 읽는다
const lastAt = justPublished.posts[29]!.publishedAtMs
const openWindow = judgeStageEvidence(D, 'd30', { ...justPublished, readAtMs: lastAt + WINDOW - 1 }, SIDE)
check('방금 나간 글의 "아직 댓글 없음"은 첫 댓글 미달로 세지 않는다', openWindow.counts.firstCommentClosed === 29 && !has(openWindow, 'FIRST_COMMENT_SHORT'), JSON.stringify(openWindow.counts))
check('대화 마감이 지난 글이 절반 미만이면 글당 댓글은 모름(TEXTURE_UNKNOWN) — 통과로 삼키지 않는다',
  openWindow.verdict === 'UNKNOWN' && has(openWindow, 'TEXTURE_UNKNOWN'), JSON.stringify(openWindow.codes))
const allClosed = judgeStageEvidence(D, 'd30', { ...justPublished, readAtMs: lastAt + THREAD_DEADLINE_MS }, SIDE)
check('전부 닫히면 같은 날이 판정된다(1건 누락 → PASS)', allClosed.verdict === 'PASS', JSON.stringify(allClosed.codes))

console.log('\n⑦ 무결성 — 한 건이어도 그대로 막는다')
const broken = judgeDay(D, 'd30', [...many(29), { provenance: 'broken' }])
check('출처가 깨진 첫 댓글 1건 → FAIL COMMENT_PROVENANCE_BROKEN', broken.verdict === 'FAIL' && has(broken, 'COMMENT_PROVENANCE_BROKEN'))
const fuBroken = judgeDay(D, 'd30', [...many(29), { followupBroken: true }])
check('출처가 깨진 추가 댓글 1건 → FAIL (글당 댓글·타인 3명의 근거가 깨졌다)', fuBroken.verdict === 'FAIL' && has(fuBroken, 'COMMENT_PROVENANCE_BROKEN'))
const manual = judgeDay(D, 'd30', [...many(29), { manual: true }])
check('자동 글에 사람이 단 Persona 댓글 1건 → FAIL COMMENT_MANUAL_PERSONA', manual.verdict === 'FAIL' && has(manual, 'COMMENT_MANUAL_PERSONA'))
check('사람이 단 댓글은 글당 댓글의 분자에 들지 않는다', manual.counts.personaComments === full.counts.personaComments)
const dup = factsOf(D, 'd30', postsOf(D, many(N30)))
check('큐·발행 기록 1:1 이 깨진 글 1건 → FAIL',
  judgeStageEvidence(D, 'd30', { ...dup, posts: dup.posts.map((p, i) => (i === 0 ? { ...p, publishLogs: 2 } : p)) }, SIDE).verdict === 'FAIL')
const noAudit = judgeDay(D, 'd30', many(N30), { audits: { rows: [] } })
check('판정이 끝난 감사 표본이 없다 → UNKNOWN AUDIT_COVERAGE_SHORT (품질을 보지 못한 날)', noAudit.verdict === 'UNKNOWN' && has(noAudit, 'AUDIT_COVERAGE_SHORT'))
const overCap = judgeDay(D, 'd30', many(N30 + 1))
check('상한 초과 발행 → FAIL PUBLISH_OVER', overCap.verdict === 'FAIL' && has(overCap, 'PUBLISH_OVER'))
const ledgerBad = judgeStageEvidence(D, 'd30', factsOf(D, 'd30', postsOf(D, many(N30))), {
  ...SIDE, supplyCostEvidence: { ...SIDE.supplyCostEvidence!, envelope: { ...SIDE.supplyCostEvidence!.envelope, overrunRequests: 1 } },
})
check('예약액을 넘은 정산 1건 → FAIL COST_BAD', ledgerBad.verdict === 'FAIL' && has(ledgerBad, 'COST_BAD'))
check('장부를 못 받았다 → UNKNOWN COST_UNKNOWN',
  judgeStageEvidence(D, 'd30', factsOf(D, 'd30', postsOf(D, many(N30))), null).verdict === 'UNKNOWN')
check('무결성 FAIL 은 사람이 읽는 줄에 이름으로 찍힌다', (evidencePlainLineOf(broken) ?? '').includes('무결성 COMMENT_PROVENANCE_BROKEN'))

console.log('\n⑧ 사람이 읽는 하루 한 줄')
const line = evidencePlainLineOf(oneMiss) ?? ''
check('수 · 첫 댓글 · 글당 댓글(통과선) · 타인 3명(통과선) · 수집→공개 · 판정이 한 줄에 있다',
  line.startsWith('11-21 공개 30/30편(100%) · 첫 댓글 29/30 · 글당 댓글 5.97(통과선 5.4) · 타인 3명 100%(통과선 60%) · 수집→공개 1.5시간(재기만) → PASS'), line)

// ─────────────────────────────────────────────────────────
// 전이 — 올림 · 유지 · 브레이크
// ─────────────────────────────────────────────────────────

function rowOf(d: Omit<StageDecision, 'contractVersion' | 'decidedBy' | 'decidedAt' | 'supply' | 'dayPinned' | 'reasons' | 'blocks'> & { blocks?: StageDecision['blocks'] }): ValidatedStageDecision {
  const v = validateStoredDecision({
    row: {
      ...d, blocks: d.blocks ?? [], reasons: ['검사 행'], dayPinned: false, supply: null,
      decidedAt: `${d.kstDate}T07:00:00+09:00`, contractVersion: 'stage-decision-v6', decidedBy: 'controller',
    },
    expectKstDate: d.kstDate,
  })
  if (!v.ok) throw new Error(`fixture 행이 계약을 지키지 않는다 — ${v.reason}`)
  return v.decision
}
const hold = (kstDate: string, release: RuntimeStage): ValidatedStageDecision =>
  rowOf({ kstDate, release, capacity: nextStage(release) ?? release, state: nextStage(release) === null ? 'HOLD' : 'PREPARE', transition: null })
const dayOf = (decision: ValidatedStageDecision, verdict: 'PASS' | 'FAIL'): LadderDay => ({
  decision,
  evidence: verdict === 'PASS'
    ? judgeDay(decision.kstDate, decision.release, many(profileOf(decision.release).dailyTarget))
    : judgeDay(decision.kstDate, decision.release, many(Math.floor(profileOf(decision.release).dailyTarget / 2))),
})
const OK_SIGNALS: HealthSignal[] = [
  { axis: 'quality', health: 'ok', reasons: [] }, { axis: 'cost', health: 'ok', reasons: [] }, { axis: 'errors', health: 'ok', reasons: [] },
]
const GOOD_PREFLIGHT = (stage: RuntimeStage, o: Partial<PreflightFacts> = {}): PreflightVerdict => {
  const n = profileOf(stage).dailyTarget
  return judgeNextPreflight(stage, {
    proofKstDate: '2026-11-23', slotValidOpportunities: n * 2, slotValidReadyStock: n,
    readyCohort: {
      sources: n, published: n, lost: 0, scheduled: 0, unknown: 0, usdPerSlotValidResult: 0.02,
      trialCost: { settledRequests: 40, usageUnknownRequests: 0, overrunRequests: 0, ineligibleRequests: 0, riskUsdPerSlotValidResult: 0.02 },
    },
    latencyP50H: 3, latencyP90H: 10, contractValidPersonas: 500, stageActivePersonas: 500, supplyDailyUsdCap: 1.8, ...o,
  }, RUNNER_GRID)
}
const T0 = '2026-11-21'
const T1 = nextDate(T0)
const T2 = nextDate(T1)
const T3 = nextDate(T2)
const decide = (kstDate: string, prev: LadderDay, before: LadderDay | null, o: { preflight?: PreflightVerdict | null; signals?: HealthSignal[] } = {}) =>
  decideStage({
    kstDate, decidedAt: `${kstDate}T07:00:00+09:00`, previousDecision: prev.decision, previousEvidence: prev.evidence,
    dayBefore: before, nextPreflight: o.preflight === undefined ? GOOD_PREFLIGHT('d50') : o.preflight,
    publishedToday: 0, signals: o.signals ?? OK_SIGNALS,
  })

console.log('\n⑨ 올림 — 같은 단계에서 이틀 연속 통과')
const p0 = dayOf(hold(T0, 'd30'), 'PASS')
const p1 = dayOf(hold(T1, 'd30'), 'PASS')
const f1 = dayOf(hold(T1, 'd30'), 'FAIL')
const up = decide(T2, p1, p0)
check('d30 이틀 연속 통과 + d50 관문 PASS → 오늘 공개 d50', up.decision.release === 'd50' && up.decision.state === 'TRIAL' && up.passDays === 2
  && validateForToday(up.decision).ok, JSON.stringify(up.decision))
const one = decide(T2, p1, dayOf(hold(T0, 'd30'), 'FAIL'))
check('하루만 통과 → 유지(d30) · 연속 1일', one.decision.release === 'd30' && one.passDays === 1 && one.decision.blocks.length === 0)
check('전날이 미달이면 그 앞의 통과는 세지 않는다 — 실패 뒤 이틀을 새로 센다',
  decide(T2, f1, p0).passDays === 0 && consecutivePassDays(T2, 'd30', [f1, p0]) === 0)
check('이틀 전 행이 없으면 올리지 않는다', decide(T2, p1, null).decision.release === 'd30')
const gated = decide(T2, p1, p0, { preflight: GOOD_PREFLIGHT('d50', { contractValidPersonas: 60, stageActivePersonas: 60 }) })
check('이틀 통과했어도 Persona 하한이 막으면 유지 + PREFLIGHT_FAIL', gated.decision.release === 'd30'
  && gated.decision.blocks.some((b) => b.code === 'PREFLIGHT_FAIL') && validateForToday(gated.decision).ok)
check('관문 판정이 없으면 올리지 않는다(PREFLIGHT_UNKNOWN)', decide(T2, p1, p0, { preflight: null }).decision.blocks.some((b) => b.code === 'PREFLIGHT_UNKNOWN'))
check('다른 단계의 관문 PASS 로 올리지 않는다', decide(T2, p1, p0, { preflight: GOOD_PREFLIGHT('d30') }).decision.release === 'd30')
const upDay = dayOf(rowOf({ kstDate: T2, release: 'd50', capacity: 'd50', state: 'TRIAL', transition: { kind: 'TRIAL', trialBase: 'd30', previousKstDate: T1, target: 'd50', basis: 'PASS' } }), 'PASS')
check('올린 날 하루 통과로는 다시 세지 않는다 — 새 단계에서 이틀', consecutivePassDays(T3, 'd50', [upDay, p1]) === 1)

console.log('\n⑩ 유지 — 미달이어도 아래 칸으로 되돌리지 않는다')
const failedUp = dayOf(rowOf({ kstDate: T2, release: 'd50', capacity: 'd50', state: 'TRIAL', transition: { kind: 'TRIAL', trialBase: 'd30', previousKstDate: T1, target: 'd50', basis: 'PASS' } }), 'FAIL')
const afterFail = decideStage({
  kstDate: T3, decidedAt: `${T3}T07:00:00+09:00`, previousDecision: failedUp.decision, previousEvidence: failedUp.evidence,
  dayBefore: p1, nextPreflight: null, publishedToday: 0, signals: OK_SIGNALS,
})
check('올린 첫날이 미달이어도 다음 날 공개는 그 단계 그대로다(옛 사다리는 d30 으로 되돌렸다)',
  afterFail.decision.release === 'd50' && afterFail.sustained === 'd50' && afterFail.brake === 'none' && validateForToday(afterFail.decision).ok, JSON.stringify(afterFail.decision))
const cheapFail = decide(T2, f1, p0, { preflight: GOOD_PREFLIGHT('d50', { contractValidPersonas: 0 }) })
check('미달 + 관문 막힘이어도 공개는 그대로다(11-18 의 모양 — 옛 사다리는 여기서 내렸다)', cheapFail.decision.release === 'd30')

console.log('\n⑪ 추정 비용은 막지 않는다 — 경고로 찍힌다')
const overBudget = GOOD_PREFLIGHT('d50', {
  readyCohort: {
    sources: 50, published: 50, lost: 0, scheduled: 0, unknown: 0, usdPerSlotValidResult: 0.11,
    trialCost: { settledRequests: 40, usageUnknownRequests: 0, overrunRequests: 0, ineligibleRequests: 0, riskUsdPerSlotValidResult: 0.11 },
  },
})
check('편수 × 추정 단가가 예산을 넘어도 관문은 PASS 다', overBudget.verdict === 'PASS' && overBudget.codes.length === 0 && overBudget.warnings.includes('SUPPLY_COST_SHORT'), JSON.stringify(overBudget))
check('그 경고는 사람이 읽는 줄에 숫자와 함께 찍힌다', preflightPlainLinesOf(overBudget).some((l) => l.includes('비용 경고(막지 않음)') && l.includes('$5.50')), preflightPlainLinesOf(overBudget).join(' / '))
const noSample = GOOD_PREFLIGHT('d50', { readyCohort: null })
check('비용 표본이 없어도 관문은 PASS 다(경고 SUPPLY_COST_UNKNOWN + 한 줄)', noSample.verdict === 'PASS' && noSample.warnings.includes('SUPPLY_COST_UNKNOWN') && preflightPlainLinesOf(noSample).length > 0)
check('추정 비용이 예산을 넘는 날에도 이틀 통과면 올린다(11-11·11-18 은 이것만으로 닫혔다)', decide(T2, p1, p0, { preflight: overBudget }).decision.release === 'd50')

console.log('\n⑫ 브레이크 — 내려가는 유일한 길 · 그날 하루만')
const BAD: HealthSignal[] = [{ axis: 'quality', health: 'bad', reasons: ['미해소 확정 결함 1건'] }, OK_SIGNALS[1]!, OK_SIGNALS[2]!]
const braked = decide(T2, p1, p0, { signals: BAD })
check('품질 신호가 나쁘면 오늘 공개만 한 칸 아래 · 올림 없음 · 열린 단계는 행에 남는다',
  braked.decision.release === 'd20' && braked.brake === 'slowdown' && braked.sustained === 'd30'
  && braked.decision.transition?.kind === 'CERTIFIED' && braked.decision.transition.certified === 'd30' && validateForToday(braked.decision).ok, JSON.stringify(braked.decision))
const brakedRow = validateForToday(braked.decision)
if (!brakedRow.ok) throw new Error('브레이크 행 검증 실패')
const brakedDay: LadderDay = { decision: brakedRow.decision, evidence: judgeDay(T2, 'd20', many(20)) }
const afterBrake = decideStage({
  kstDate: T3, decidedAt: `${T3}T07:00:00+09:00`, previousDecision: brakedDay.decision, previousEvidence: brakedDay.evidence,
  dayBefore: p1, nextPreflight: GOOD_PREFLIGHT('d50'), publishedToday: 0, signals: OK_SIGNALS,
})
check('신호가 돌아온 다음 날 공개는 열린 단계로 돌아온다', afterBrake.decision.release === 'd30' && afterBrake.sustained === 'd30')
check('감속한 날은 연속 통과에서 끊긴다(그날 공개가 열린 단계가 아니다)', afterBrake.passDays === 0)
const UNKNOWN: HealthSignal[] = [OK_SIGNALS[0]!, OK_SIGNALS[1]!, { axis: 'errors', health: 'unknown', reasons: ['load 되어 있지 않다'] }]
const blind = decide(T2, p1, p0, { signals: UNKNOWN })
check('신호를 모르는 날은 올림만 보류한다 — 내리지 않는다', blind.decision.release === 'd30' && blind.brake === 'holdUnknown' && blind.decision.transition === null)

console.log('\n⑬ 배포 첫날 — 되돌림을 쓰던 옛 사다리의 행에서 열린 단계를 되찾는다')
// 11-17 TRIAL d30(미달) → 11-18 옛 사다리가 PREPARE d20 으로 되돌린 모양
const oldTrial = rowOf({ kstDate: T0, release: 'd30', capacity: 'd50', state: 'TRIAL', transition: { kind: 'TRIAL', trialBase: 'd20', previousKstDate: '2026-11-20', target: 'd30', basis: 'PASS' } })
const oldRevert = rowOf({ kstDate: T1, release: 'd20', capacity: 'd30', state: 'PREPARE', transition: null, blocks: [{ code: 'PREFLIGHT_FAIL', reason: 'd30 preflight FAIL [SUPPLY_COST_SHORT]' }] })
check('전날이 옛 되돌림 행(PREPARE d20) · 이틀 전이 TRIAL d30 → 열린 단계 d30', openStageOf(oldRevert, oldTrial) === 'd30')
const firstMorning = decideStage({
  kstDate: T2, decidedAt: `${T2}T07:00:00+09:00`, previousDecision: oldRevert, previousEvidence: judgeDay(T1, 'd20', many(20)),
  dayBefore: { decision: oldTrial, evidence: judgeDay(T0, 'd30', many(24)) }, nextPreflight: GOOD_PREFLIGHT('d50'), publishedToday: 0, signals: OK_SIGNALS,
})
check('그 첫날 아침 공개는 d30 이고 올리지 않는다(d20 에서의 통과는 d30 의 연속이 아니다)',
  firstMorning.decision.release === 'd30' && firstMorning.passDays === 0 && validateForToday(firstMorning.decision).ok, JSON.stringify(firstMorning.decision))
check('전날 행만 보면 d20 이다 — 되찾기는 이틀 전 행 인자가 한다', openStageOf(oldRevert) === 'd20')
check('인접하지 않은 행에서는 되찾지 않는다', openStageOf(oldRevert, rowOf({ ...oldTrial, kstDate: '2026-11-19', transition: { kind: 'TRIAL', trialBase: 'd20', previousKstDate: '2026-11-18', target: 'd30', basis: 'PASS' } })) === 'd20')
// 이 경로를 지워도 되는 조건: 새 사다리가 쓴 행에서는 이틀 전 행이 결과를 바꾸지 않는다
const afterFailRow = validateForToday(afterFail.decision)
if (!afterFailRow.ok) throw new Error('미달 뒤 유지 행 검증 실패')
const newRows: [ValidatedStageDecision, ValidatedStageDecision][] = [
  [p1.decision, p0.decision], [upDay.decision, p1.decision], [brakedDay.decision, p1.decision], [afterFailRow.decision, failedUp.decision],
]
check('새 사다리가 쓴 행(유지 · 올림 · 감속 · 미달 뒤 유지)에서는 이틀 전 행이 열린 단계를 바꾸지 않는다 — 이 인자를 지워도 되는 조건',
  newRows.every(([prev, before]) => openStageOf(prev, before) === openStageOf(prev) && openStageOf(prev) === openStageHeldBy(prev)))

console.log(`\n${fail === 0 ? '✅' : '❌'} 사다리 정책 검사 — PASS ${pass} · FAIL ${fail}`)
process.exit(fail === 0 ? 0 : 1)
