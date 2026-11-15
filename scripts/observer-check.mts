#!/usr/bin/env tsx
/** 댓글·비용 관측기 검사 — 🔴 순수 함수 + 읽기 전용 정적 검사. DB 0 · 파일 write 0 */
import { readFileSync } from 'node:fs'

import { countInferredReselections, kstDatesBetween, kstDateOfMs, laneCoverage, observeComments, type ObservedAttempt } from '../src/lib/comment-observation'
import { canonicalCostFieldsOf, costCoverageOf, costDaysOf, costVersusCap, coverageSinceOf } from '../src/lib/supply-cost-observation'

let pass = 0; let fail = 0
const check = (label: string, ok: boolean, d = ''): void => { if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else { fail += 1; console.log(`  ❌ ${label}${d ? ` — ${d}` : ''}`) } }
const T = (iso: string): number => Date.parse(iso)
const NOW = T('2026-11-15T03:00:00Z') // 2026-11-15 12:00 KST

console.log('\n① 날짜·기억 범위')
check('KST 날짜 경계(15:00Z = 다음 날 00:00 KST)', kstDateOfMs(T('2026-11-14T15:00:00Z')) === '2026-11-15' && kstDateOfMs(T('2026-11-14T14:59:59Z')) === '2026-11-14')
check('기간 목록 포함·포함 · 뒤집힘/모양 오류는 빈 목록', JSON.stringify(kstDatesBetween('2026-11-14', '2026-11-15')) === '["2026-11-14","2026-11-15"]' && kstDatesBetween('2026-11-16', '2026-11-14').length === 0 && kstDatesBetween('x', '2026-11-14').length === 0)
check('followup 장부는 오늘만 부분 증명 · 어제는 UNKNOWN', laneCoverage('followup', '2026-11-15', NOW) === 'PARTIAL_TODAY' && laneCoverage('followup', '2026-11-14', NOW) === 'UNKNOWN')
check('first-comment 장부(60분 기억)는 어떤 날도 UNKNOWN', laneCoverage('first-comment', '2026-11-15', NOW) === 'UNKNOWN')

console.log('\n② 추정 재선정(120초) — 정확한 같은 tick 이 아니다')
const A = (p: Partial<ObservedAttempt>): ObservedAttempt => ({ lane: 'followup', postId: 'p', personaCode: 'P01', attemptedAtMs: T('2026-11-15T00:00:00Z'), step: 'ENQUEUE_BLOCKED', blockCodes: [], ...p })
check('막힘 뒤 2분 안 다른 Persona → 1', countInferredReselections([A({}), A({ personaCode: 'P02', attemptedAtMs: T('2026-11-15T00:01:00Z'), step: 'ENQUEUED' })]) === 1)
check('성공 뒤 · 같은 Persona · 2분 초과 · 다른 lane 은 0', countInferredReselections([A({ step: 'ENQUEUED' }), A({ personaCode: 'P02', attemptedAtMs: T('2026-11-15T00:01:00Z') })]) === 0
  && countInferredReselections([A({}), A({ attemptedAtMs: T('2026-11-15T00:01:00Z') })]) === 0
  && countInferredReselections([A({}), A({ personaCode: 'P02', attemptedAtMs: T('2026-11-15T00:02:01Z') })]) === 0
  && countInferredReselections([A({}), A({ lane: 'first-comment', personaCode: 'P02', attemptedAtMs: T('2026-11-15T00:01:00Z') })]) === 0)

console.log('\n③ 댓글 분류 · UNKNOWN 전파')
const base = {
  dates: ['2026-11-14', '2026-11-15'], nowMs: NOW,
  posts: [{ id: 'a', createdAtMs: T('2026-11-15T00:00:00Z') }, { id: 'b', createdAtMs: T('2026-11-15T01:00:00Z') }],
  comments: [
    { postId: 'a', parentId: null, isPersona: true, isAdmin: false, createdAtMs: T('2026-11-15T00:10:00Z') },
    { postId: 'a', parentId: null, isPersona: true, isAdmin: false, createdAtMs: T('2026-11-15T00:20:00Z') },
    { postId: 'a', parentId: 'c1', isPersona: true, isAdmin: false, createdAtMs: T('2026-11-15T00:30:00Z') },
    { postId: 'a', parentId: null, isPersona: false, isAdmin: false, createdAtMs: T('2026-11-15T00:05:00Z') },
    { postId: 'b', parentId: null, isPersona: false, isAdmin: true, createdAtMs: T('2026-11-15T01:10:00Z') },
  ],
  attempts: {
    'first-comment': { status: 'ok' as const, entries: [A({ lane: 'first-comment', step: 'ENQUEUED' })] },
    followup: { status: 'ok' as const, entries: [A({ blockCodes: ['FU_PERSONA_DAY'] }), A({ personaCode: 'P02', attemptedAtMs: T('2026-11-15T00:01:00Z'), step: 'ENQUEUED' }), A({ attemptedAtMs: T('2026-11-14T01:00:00Z') })] },
  },
  ledgerByDate: new Map([
    ['2026-11-14', null],
    ['2026-11-15', [
      { stage: 'commentGen', runId: 'r1', startedAt: '2026-11-15T00:09:00Z', status: 'settled', settledUsd: 0.002 },
      { stage: 'commentFollowupGen', runId: 'r1', startedAt: '2026-11-15T00:19:00Z', status: 'usageUnknown', settledUsd: null },
      { stage: 'commentFollowupGen', runId: 'r2', startedAt: '2026-11-15T00:39:00Z', status: 'blocked', settledUsd: null },
    ]],
  ]),
}
const [d14, d15] = observeComments(base)
check('첫 1 · 추가 1 · 답글 1 · 실회원 1 · 관리자는 실회원 아님 · 글당 2.5', d15!.comments.first === 1 && d15!.comments.followup === 1 && d15!.comments.reply === 1 && d15!.comments.member === 1 && d15!.avgCommentsPerPost === 2.5, JSON.stringify(d15!.comments))
check('오늘 followup: 시도 2 · blockCode · 추정 재선정 1 · exactSameTick null', d15!.lanes.followup.attempts === 2 && d15!.lanes.followup.blockCodes?.FU_PERSONA_DAY === 1 && d15!.lanes.followup.inferredReselectionsWithin120s === 1 && d15!.lanes.followup.exactSameTick === null)
check('🔴 어제 followup(기억 밖)은 0 이 아니라 UNKNOWN(null)', d14!.lanes.followup.coverage === 'UNKNOWN' && d14!.lanes.followup.attempts === null && d14!.lanes.followup.blockCodes === null)
check('🔴 first-comment 는 장부가 ok 여도 UNKNOWN(null)', d15!.lanes['first-comment'].attempts === null)
check('🔴 그날 장부 없음/손상 → provider 전부 null · 회차당 요청 null', d14!.provider.commentGen.requests === null && d14!.provider.commentFollowupGen.settledUsd === null && d14!.requestsPerRun === null)
check('provider 분리 · 정산 금액', d15!.provider.commentGen.settled === 1 && d15!.provider.commentFollowupGen.usageUnknown === 1 && d15!.provider.commentFollowupGen.blocked === 1 && Math.abs((d15!.provider.commentGen.settledUsd ?? -1) - 0.002) < 1e-9)
check('회차당 요청 — 차단 제외 · 슬롯 용량은 언제나 null', d15!.requestsPerRun?.runs === 1 && d15!.requestsPerRun?.max === 2 && d15!.slotCapacity === null)
{
  const missing = observeComments({ ...base, attempts: { 'first-comment': { status: 'missing', entries: [] }, followup: { status: 'corrupt', entries: [] } } })[1]!
  check('🔴 시도 장부 없음/손상 → 오늘도 UNKNOWN(null) · source 표시', missing.lanes.followup.attempts === null && missing.lanes.followup.source === 'corrupt')
  const badMoney = observeComments({ ...base, ledgerByDate: new Map([['2026-11-15', [{ stage: 'commentGen', runId: 'r', startedAt: '2026-11-15T00:00:00Z', status: 'settled', settledUsd: null }]]]) })[1]!
  check('🔴 정산 줄 금액 null → settledUsd null(0 이 아니다)', badMoney.provider.commentGen.settled === 1 && badMoney.provider.commentGen.settledUsd === null)
  check('글 0 이면 글당 평균은 null', observeComments({ ...base, dates: ['2026-11-16'] })[0]!.avgCommentsPerPost === null)
}

console.log('\n④ 비용 — UNKNOWN 전파 · 정본 칸 · 기준 시각')
const line = (p: Record<string, unknown>) => ({ runId: 'r', stage: 'draftGen', status: 'settled', settledUsd: 0.01, reservedUsd: 0.02, startedAt: '', provider: 'anthropic', model: 'm', inputTokens: 10, outputTokens: 5, ...p })
const days = costDaysOf([
  { date: '2026-11-15', entries: [line({}), line({ status: 'usageUnknown', settledUsd: null, reservedUsd: 0.03, inputTokens: null, outputTokens: null }), line({ stage: 'commentGen', settledUsd: 9 })] },
  { date: '2026-11-16', entries: null },
  { date: '2026-11-17', entries: [line({ settledUsd: 'x' }), line({ settledUsd: Number.NaN })] },
], (s) => s !== 'commentGen')
check('내용 비용 단계만 · 정산 1($0.01) · 미상 1(예약 $0.03)', days[0]!.requests === 2 && days[0]!.settled === 1 && days[0]!.settledUsd === 0.01 && days[0]!.usageUnknown === 1 && days[0]!.unknownReservedUsd === 0.03)
check('🔴 미상 요청이 있는 모델의 토큰 합은 null', days[0]!.byModel?.['anthropic/m']?.inputTokens === null)
check('🔴 장부 없음/손상 날은 모든 칸 null', days[1]!.readable === false && days[1]!.requests === null && days[1]!.settledUsd === null && days[1]!.byModel === null)
check('🔴 문자열·NaN 금액 → settledUsd null', days[2]!.settledUsd === null && days[2]!.settled === 2)
const cov = costCoverageOf({ days, cohortRuns: ['a', 'b', 'c'], runStartMs: (r) => (r === 'a' ? 100 : r === 'b' ? 300 : null), sinceMs: 200 })
check('coverage — 읽힌 날 2/3 · 기준 뒤 1 · 비율 0.5 · 시각 미상 1', cov.readableDays === 2 && cov.runsAfterSince === 1 && cov.afterSinceRatio === 0.5 && cov.unparsedRuns === 1, JSON.stringify(cov))
check('🔴 cohort 판독 실패 → 회차 칸 전부 null', costCoverageOf({ days, cohortRuns: null, runStartMs: () => 1, sinceMs: 1 }).cohortRuns === null)
check('🔴 기준 시각 — 인자 없고 manifest.sha≠pin 이면 none(지어내지 않는다)', coverageSinceOf({ explicitSince: null, manifest: { sha: 'a', deployedAt: '2026-11-15T00:00:00Z' }, pin: 'b' }).basis === 'none')
check('기준 시각 — manifest.sha=pin 이면 그 deployedAt', coverageSinceOf({ explicitSince: null, manifest: { sha: 'a', deployedAt: '2026-11-15T00:00:00Z' }, pin: 'a' }).sinceMs === T('2026-11-15T00:00:00Z'))
check('기준 시각 — 명시 인자 우선 · 깨진 인자는 none', coverageSinceOf({ explicitSince: '2026-11-16T00:00:00Z', manifest: null, pin: null }).basis === 'explicit' && coverageSinceOf({ explicitSince: 'nope', manifest: null, pin: null }).basis === 'none')
const cf = canonicalCostFieldsOf({ totalUsd: 1, settledRequests: 3, usageUnknownRequests: 0, trialRiskUsdPerSlotValidResult: null, usdPerSlotValidResult: Number.NaN })
check('🔴 정본 칸 — 있는 값만 · null/NaN/없음은 null', cf.totalUsd === 1 && cf.settledRequests === 3 && cf.usageUnknownRequests === 0 && cf.trialRiskUsdPerSlotValidResult === null && cf.usdPerSlotValidResult === null && cf.recoverySettledRequests === null && cf.trialOverrunRequests === null && cf.trialIneligibleRequests === null)
check('🔴 정본 귀속 자체가 없으면 모든 칸 null', Object.values(canonicalCostFieldsOf(null)).every((v) => v === null))
check('상한 대비 — null 은 UNKNOWN · 0.040 이하 · 0.0401 초과', costVersusCap(null, 0.04) === 'UNKNOWN' && costVersusCap(0.04, 0.04) === 'AT_OR_BELOW_CAP' && costVersusCap(0.0401, 0.04) === 'ABOVE_CAP')

console.log('\n⑤ 🔴 정적 검사 — 쓰기 경로 0 · 권위 단가 주장 0 · 배포 시각 상수 0')
for (const f of ['scripts/comment-observer.mts', 'scripts/supply-cost-observer.mts', 'src/lib/comment-observation.ts', 'src/lib/supply-cost-observation.ts']) {
  const code = readFileSync(f, 'utf-8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join('\n')
  const writes = code.match(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw\w*|\$queryRaw\w*)\(|writeFile|appendFile|renameSync|unlinkSync|mkdirSync|fetch\(|messages\.create/g) ?? []
  check(`${f} — DB write · raw SQL · 파일 write · provider 호출 0`, writes.length === 0, writes.join(','))
  check(`${f} — 배포 시각 ISO 상수 0`, !/'20\d\d-\d\d-\d\dT\d\d:\d\d/.test(code))
}
{
  const cli = readFileSync('scripts/supply-cost-observer.mts', 'utf-8')
  check('비용 CLI — 권위 단가는 null 로만 낸다', /authoritativeUsdPerSlotValidResult: null/.test(cli) && !/authoritativeUsdPerSlotValidResult: (?!null)/.test(cli))
  const ccli = readFileSync('scripts/comment-observer.mts', 'utf-8')
  check('두 CLI — 장부 존재를 먼저 본다(정본 reader 의 없음=빈 목록을 0 으로 쓰지 않는다)', /existsSync\(path\)/.test(ccli) && /existsSync\(path\)/.test(cli))
}

console.log(`\n결과: ${pass} 통과 · ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
