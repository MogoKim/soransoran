#!/usr/bin/env tsx
/** 댓글·비용 관측기 검사 — 🔴 순수 함수 + 읽기 전용 정적 검사. DB 0 · 파일 write 0 */
import { readFileSync } from 'node:fs'

import { countReselections, kstDatesBetween, kstDateOfMs, observeComments, type ObservedAttempt } from '../src/lib/comment-observation'
import { costCoverageOf, costDaysOf, costVersusCap } from '../src/lib/supply-cost-observation'

let pass = 0; let fail = 0
const check = (label: string, ok: boolean, d = ''): void => { if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else { fail += 1; console.log(`  ❌ ${label}${d ? ` — ${d}` : ''}`) } }
const T = (iso: string): number => Date.parse(iso)

console.log('\n① 날짜')
check('KST 날짜 경계(15:00Z = 다음 날 00:00 KST)', kstDateOfMs(T('2026-11-14T15:00:00Z')) === '2026-11-15' && kstDateOfMs(T('2026-11-14T14:59:59Z')) === '2026-11-14')
check('기간 목록 포함·포함', JSON.stringify(kstDatesBetween('2026-11-14', '2026-11-16')) === '["2026-11-14","2026-11-15","2026-11-16"]')
check('뒤집힌 기간·모양 오류 → 빈 목록', kstDatesBetween('2026-11-16', '2026-11-14').length === 0 && kstDatesBetween('x', '2026-11-14').length === 0)

console.log('\n② 같은 tick 재선정')
const A = (p: Partial<ObservedAttempt>): ObservedAttempt => ({ lane: 'followup', postId: 'p', personaCode: 'P01', attemptedAtMs: T('2026-11-15T00:00:00Z'), step: 'ENQUEUE_BLOCKED', blockCodes: [], ...p })
check('막힘 뒤 2분 안 다른 Persona → 1', countReselections([A({}), A({ personaCode: 'P02', attemptedAtMs: T('2026-11-15T00:01:00Z'), step: 'ENQUEUED' })]) === 1)
check('성공(ENQUEUED) 뒤는 재선정이 아니다', countReselections([A({ step: 'ENQUEUED' }), A({ personaCode: 'P02', attemptedAtMs: T('2026-11-15T00:01:00Z') })]) === 0)
check('같은 Persona 재시도는 재선정이 아니다', countReselections([A({}), A({ attemptedAtMs: T('2026-11-15T00:01:00Z') })]) === 0)
check('2분 넘으면 다른 tick', countReselections([A({}), A({ personaCode: 'P02', attemptedAtMs: T('2026-11-15T00:02:01Z') })]) === 0)
check('lane 이 다르면 섞지 않는다', countReselections([A({}), A({ lane: 'first-comment', personaCode: 'P02', attemptedAtMs: T('2026-11-15T00:01:00Z') })]) === 0)

console.log('\n③ 댓글 분류·분포')
const day = observeComments({
  dates: ['2026-11-15'],
  posts: [{ id: 'a', createdAtMs: T('2026-11-15T00:00:00Z') }, { id: 'b', createdAtMs: T('2026-11-15T01:00:00Z') }, { id: 'old', createdAtMs: T('2026-11-13T00:00:00Z') }],
  comments: [
    { postId: 'a', parentId: null, isPersona: true, isAdmin: false, createdAtMs: T('2026-11-15T00:10:00Z') },
    { postId: 'a', parentId: null, isPersona: true, isAdmin: false, createdAtMs: T('2026-11-15T00:20:00Z') },
    { postId: 'a', parentId: 'c1', isPersona: true, isAdmin: false, createdAtMs: T('2026-11-15T00:30:00Z') },
    { postId: 'a', parentId: null, isPersona: false, isAdmin: false, createdAtMs: T('2026-11-15T00:05:00Z') },
    { postId: 'b', parentId: null, isPersona: false, isAdmin: true, createdAtMs: T('2026-11-15T01:10:00Z') },
    { postId: 'old', parentId: null, isPersona: true, isAdmin: false, createdAtMs: T('2026-11-15T00:00:00Z') },
  ],
  attempts: [A({ blockCodes: ['FU_PERSONA_DAY'] }), A({ personaCode: 'P02', attemptedAtMs: T('2026-11-15T00:01:00Z'), step: 'ENQUEUED' }), A({ lane: 'first-comment', step: 'ENQUEUED', attemptedAtMs: T('2026-11-14T00:00:00Z') })],
  ledger: [
    { stage: 'commentGen', runId: 'r1', startedAt: '2026-11-15T00:09:00Z', status: 'settled', settledUsd: 0.002 },
    { stage: 'commentFollowupGen', runId: 'r1', startedAt: '2026-11-15T00:19:00Z', status: 'usageUnknown', settledUsd: null },
    { stage: 'commentFollowupGen', runId: 'r2', startedAt: '2026-11-15T00:39:00Z', status: 'blocked', settledUsd: null },
    { stage: 'draftGen', runId: 'r3', startedAt: '2026-11-15T00:39:00Z', status: 'settled', settledUsd: 1 },
  ],
})[0]!
check('관리형 글은 그날 글만(2)', day.managedPosts === 2)
check('첫 1 · 추가 1 · 답글 1 · 실회원 1 · 관리자는 실회원 아님', day.comments.first === 1 && day.comments.followup === 1 && day.comments.reply === 1 && day.comments.member === 1, JSON.stringify(day.comments))
check('그날 글의 댓글만 센다(옛 글 제외) · 글당 2.5', day.comments.total === 5 && day.avgCommentsPerPost === 2.5)
check('실회원 참여 글 1', day.memberParticipatedPosts === 1)
check('followup 시도 2 · blockCode 분포 · 재선정 1 · 다른 날 시도 제외', day.lanes.followup.attempts === 2 && day.lanes.followup.blockCodes.FU_PERSONA_DAY === 1 && day.lanes.followup.sameTickReselections === 1 && day.lanes['first-comment'].attempts === 0)
check('provider — 댓글 단계만 · 정산/미상/차단 분리', day.provider.commentGen.settled === 1 && day.provider.commentFollowupGen.usageUnknown === 1 && day.provider.commentFollowupGen.blocked === 1 && Math.abs(day.provider.commentGen.settledUsd - 0.002) < 1e-9)
check('회차 용량 — 차단 요청 제외 · 회차 1 · 최대 2', day.runCapacity.runs === 1 && day.runCapacity.maxRequestsPerRun === 2)
check('글 0 이면 글당 평균은 null(0 이 아니다)', observeComments({ dates: ['2026-11-16'], posts: [], comments: [], attempts: [], ledger: [] })[0]!.avgCommentsPerPost === null)

console.log('\n④ 비용 분해·coverage·상한')
const days = costDaysOf([
  { date: '2026-11-15', entries: [
    { runId: 'r', stage: 'draftGen', status: 'settled', settledUsd: 0.01, reservedUsd: 0.02, startedAt: '', provider: 'anthropic', model: 'm', inputTokens: 10, outputTokens: 5 },
    { runId: 'r', stage: 'draftGen', status: 'usageUnknown', settledUsd: null, reservedUsd: 0.03, startedAt: '', provider: 'anthropic', model: 'm', inputTokens: null, outputTokens: null },
    { runId: 'r', stage: 'commentGen', status: 'settled', settledUsd: 9, reservedUsd: 9, startedAt: '', provider: 'anthropic', model: 'm', inputTokens: 1, outputTokens: 1 },
  ] },
  { date: '2026-11-16', entries: null },
], (s) => s !== 'commentGen')
check('내용 비용 단계만 · 정산 1($0.01) · 미상 1(예약 $0.03)', days[0]!.requests === 2 && days[0]!.settled === 1 && days[0]!.settledUsd === 0.01 && days[0]!.usageUnknown === 1 && days[0]!.unknownReservedUsd === 0.03)
check('판독 실패한 날은 readable=false(0 이 아니다)', days[1]!.readable === false)
const cov = costCoverageOf({ days, cohortRuns: ['a', 'b', 'c'], runStartMs: (r) => (r === 'a' ? 100 : r === 'b' ? 300 : null), sinceMs: 200 })
check('coverage — 읽힌 날 1/2 · 기준 뒤 1 · 비율 0.5 · 시각 미상 1', cov.readableDays === 1 && cov.ledgerDays === 2 && cov.runsAfterSince === 1 && cov.afterSinceRatio === 0.5 && cov.unparsedRuns === 1, JSON.stringify(cov))
check('상한 대비 — null 은 UNKNOWN · 0.040 은 이하 · 0.0401 은 초과', costVersusCap(null, 0.04) === 'UNKNOWN' && costVersusCap(0.04, 0.04) === 'AT_OR_BELOW_CAP' && costVersusCap(0.0401, 0.04) === 'ABOVE_CAP')

console.log('\n⑤ 🔴 읽기 전용 정적 검사 — 관측기 원문에 쓰기 경로가 없다')
for (const f of ['scripts/comment-observer.mts', 'scripts/supply-cost-observer.mts', 'src/lib/comment-observation.ts', 'src/lib/supply-cost-observation.ts']) {
  const code = readFileSync(f, 'utf-8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join('\n')
  const writes = code.match(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw\w*|\$queryRaw\w*)\(|writeFile|appendFile|renameSync|unlinkSync|mkdirSync|fetch\(|messages\.create/g) ?? []
  check(`${f} — DB write · raw SQL · 파일 write · provider 호출 0`, writes.length === 0, writes.join(','))
}

console.log(`\n결과: ${pass} 통과 · ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
