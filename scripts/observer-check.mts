#!/usr/bin/env tsx
/** 댓글·비용 관측기 검사 — 🔴 순수 함수 + 읽기 전용 정적 검사. DB 0 · 파일 write 0 */
import { readFileSync } from 'node:fs'

import { authorKindOf, countInferredReselections, kstDatesBetween, kstDateOfMs, laneCoverage, observeComments, type ObservedAttempt, type ObservedComment } from '../src/lib/comment-observation'
import { CANONICAL_COST_FIELDS, canonicalCostFieldsOf, costCoverageOf, costDaysOf, costVersusCap, coverageSinceOf } from '../src/lib/supply-cost-observation'
import { costAttributionOf } from '../src/lib/ready-fate'

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

console.log('\n③ 댓글 — 공개 가시 댓글 전체 · 두 분할 · 부분집합 · UNKNOWN')
const C = (p: Partial<ObservedComment>): ObservedComment => ({ postId: 'a', parentId: null, createdAtMs: T('2026-11-15T00:10:00Z'), isPersona: false, isOperator: false, isAdmin: false, isGuest: false, ...p })
check('작성자 우선순위 — Persona > 운영 > 관리자 > 비회원 > 회원', authorKindOf(C({ isPersona: true, isAdmin: true })) === 'persona' && authorKindOf(C({ isOperator: true, isAdmin: true })) === 'operator'
  && authorKindOf(C({ isAdmin: true })) === 'admin' && authorKindOf(C({ isGuest: true })) === 'guest' && authorKindOf(C({})) === 'member')
const base = {
  dates: ['2026-11-14', '2026-11-15'], nowMs: NOW,
  posts: [{ id: 'a', createdAtMs: T('2026-11-15T00:00:00Z') }, { id: 'b', createdAtMs: T('2026-11-15T01:00:00Z') }],
  comments: [
    C({ isPersona: true, createdAtMs: T('2026-11-15T00:10:00Z') }),
    C({ isPersona: true, createdAtMs: T('2026-11-15T00:20:00Z') }),
    C({ isPersona: true, parentId: 'c1', createdAtMs: T('2026-11-15T00:30:00Z') }),
    C({ createdAtMs: T('2026-11-15T00:05:00Z') }),
    C({ isAdmin: true, parentId: 'c2', createdAtMs: T('2026-11-15T00:40:00Z') }),
    C({ postId: 'b', isGuest: true, createdAtMs: T('2026-11-15T01:05:00Z') }),
    C({ postId: 'b', isOperator: true, createdAtMs: T('2026-11-15T01:10:00Z') }),
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
const cc = d15!.comments
const sum = (o: Record<string, number>): number => Object.values(o).reduce((x, y) => x + y, 0)
check('total = 공개 가시 댓글 전체(7)', cc.total === 7)
check('작성자 분할 — Persona 3 · 운영 1 · 관리자 1 · 비회원 1 · 회원 1 · 합 = total', cc.byAuthor.persona === 3 && cc.byAuthor.operator === 1 && cc.byAuthor.admin === 1 && cc.byAuthor.guest === 1 && cc.byAuthor.member === 1 && sum(cc.byAuthor) === cc.total, JSON.stringify(cc.byAuthor))
check('구조 분할 — 최상위 5 · 답글 2 · 합 = total', cc.byStructure.topLevel === 5 && cc.byStructure.reply === 2 && cc.byStructure.topLevel + cc.byStructure.reply === cc.total)
check('🔴 두 분할은 겹친다 — 합끼리 더하면 total 의 두 배(합계 분해가 아니다)', sum(cc.byAuthor) + cc.byStructure.topLevel + cc.byStructure.reply === 2 * cc.total)
check('Persona 최상위 부분집합 — 첫 1 · 추가 1(Persona 답글·다른 작성자는 빼고)', cc.personaTopLevel.first === 1 && cc.personaTopLevel.followup === 1 && cc.personaTopLevel.first + cc.personaTopLevel.followup <= cc.byAuthor.persona)
check('회원 참여 글 1 · 비회원 참여 글 1(관리자·운영은 참여로 세지 않는다)', d15!.memberParticipatedPosts === 1 && d15!.guestParticipatedPosts === 1)
check('평균 — 분자 공개 가시 댓글 7 ÷ 분모 관리형 공개 글 2 = 3.5', d15!.avgCommentsPerPost === 3.5 && d15!.managedPosts === 2)
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

console.log('\n④ 비용 — 정본 칸 그대로 · UNKNOWN 전파 · 기준 시각')
{
  const real = costAttributionOf({ entries: [], fateByKey: new Map(), counts: { published: 0, scheduled: 0 }, cohortRuns: new Set() }) as unknown as Record<string, unknown>
  const numericKeys = Object.keys(real).filter((k) => typeof real[k] === 'number' || real[k] === null).sort()
  const listed = [...CANONICAL_COST_FIELDS].sort()
  check('🔴 drift — 원본 결과의 수치 칸 전부가 목록과 정확히 같다', JSON.stringify(numericKeys) === JSON.stringify(listed), `원본 ${numericKeys.join(',')}`)
  const structured = Object.keys(real).filter((k) => !numericKeys.includes(k)).sort()
  check('🔴 drift — 수치 외 칸은 byFate · noReadyByStage 둘뿐', JSON.stringify(structured) === '["byFate","noReadyByStage"]', structured.join(','))
  const out = canonicalCostFieldsOf(real)
  check('원본 그대로 — 수치 칸 값이 원본과 같다(null 은 null)', CANONICAL_COST_FIELDS.every((k) => out[k] === real[k]), JSON.stringify(out))
  check('원본 그대로 — byFate 다섯 키', JSON.stringify(out.byFate) === JSON.stringify(real.byFate))
  check('원본 그대로 — noReadyByStage 원본 값 보존', JSON.stringify(out.noReadyByStage) === JSON.stringify(real.noReadyByStage))
}
{
  const cf = canonicalCostFieldsOf({ totalUsd: 1, settledRequests: 3, usageUnknownRequests: 0, trialRiskUsdPerSlotValidResult: null, usdPerSlotValidResult: Number.NaN, legacyUsd: '1', byFate: { published: 1, lost: 'x' }, noReadyByStage: null })
  check('🔴 0 은 0 · null 은 null · NaN/문자열/없음은 null(0 으로 채우지 않는다)', cf.totalUsd === 1 && cf.usageUnknownRequests === 0 && cf.trialRiskUsdPerSlotValidResult === null
    && cf.usdPerSlotValidResult === null && cf.legacyUsd === null && cf.otherCohortUsd === null && cf.legacyOpenRequests === null && cf.usdPerPublished === null && cf.noReadyUsd === null)
  check('🔴 byFate 키별 — 오염/없음은 null', cf.byFate?.published === 1 && cf.byFate?.lost === null && cf.byFate?.scheduled === null && cf.byFate?.noReady === null)
  check('🔴 noReadyByStage 원본 null(연결 불완전)은 null 로 보존', cf.noReadyByStage === null)
  const cf2 = canonicalCostFieldsOf({ noReadyByStage: { draftGen: 0.5, semanticAudit: Number.POSITIVE_INFINITY }, byFate: 'bad' })
  check('🔴 noReadyByStage 단계별 — 비유한은 null · byFate 가 객체가 아니면 null', cf2.noReadyByStage?.draftGen === 0.5 && cf2.noReadyByStage?.semanticAudit === null && cf2.byFate === null)
  const none = canonicalCostFieldsOf(null)
  check('🔴 정본 귀속 자체가 없으면 모든 칸 null', CANONICAL_COST_FIELDS.every((k) => none[k] === null) && none.byFate === null && none.noReadyByStage === null)
}
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
  check('댓글 CLI — 삭제 댓글을 빼고(isDeleted false) 공개 글만(PUBLISHED) 읽는다', /isDeleted: false/.test(ccli) && /status: 'PUBLISHED'/.test(ccli))
}

console.log(`\n결과: ${pass} 통과 · ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
