#!/usr/bin/env tsx
/**
 * 🔴 **D20 추가 댓글 profile 산출 반례 검사** (2026-10-15) — 순수 fixture · DB 0 · 파일 0 · provider 0
 *
 *   npm run d20:readiness-check
 *
 * `deriveFollowupProfile` 이 D10 실측 없이 숫자를 만들지 않는가 · 승인 없이 설치되지 않는가 · 첫 댓글 예산을 먼저 지키는가.
 */
import { readFileSync } from 'node:fs'

import { COMMENT_SCALE_HEADROOM, deriveCommentScale, deriveFollowupProfile, type FollowupMeasure } from '../src/lib/followup-profile-derive'
import { THREAD_TARGETS, threadMeanSizeAt } from '../src/lib/persona-thread-target'
import {
  FOLLOWUP_PROFILE_VERSION, validateFollowupProfile,
} from '../src/lib/persona-comment-followup'
import {
  COMMENT_LOOP_BUDGET_ENV, commentDailyCapOf, commentLoopLimitsFromEnv,
} from '../src/lib/persona-comment-auto-lane'
import { profileOf } from '../src/lib/scale-profile'
import { RUNNER_GRID } from './lib/stage-preflight-facts.mjs'

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

/** 🔴 운영 D10 profile 과 같은 모양(승인 포함) — 숫자는 fixture 이지 운영 실측이 아니다 */
const D10_PROFILE = {
  v: FOLLOWUP_PROFILE_VERSION, stage: 'd10', dailyCount: 40, dailyUsd: 0.08, runMax: 3, perPersonaDailyMax: 3,
  approvedBy: 'founder', approvedAt: '2026-10-14T21:37:00+09:00',
}
const measure = (patch: Partial<FollowupMeasure> = {}): FollowupMeasure => ({
  stage: 'd10', kstDate: '2026-10-16', evidenceVerdict: 'PASS', installedProfile: D10_PROFILE,
  followup: { settled: 12, settledUsd: 0.03, open: 0 }, first: { settled: 10, settledUsd: 0.02, open: 0 },
  acceptedFollowups: 10, acceptedFirstComments: 10, ...patch,
})
const D20_POSTS = profileOf('d20').dailyTarget
const RUNS = RUNNER_GRID.commentSlots.length
/** 🔴 D20 후보 산출 당시(2026-10-16) 댓글 장부 하루 상한 — 역사 값이다. 지금 코드 천장(`commentDailyCapOf`)이 아니다 */
const D20_FIXTURE_COMMENT_CAP_USD = 0.5
const derive = (m: FollowupMeasure | null, o: Partial<{ personas: number | null; cap: number | null }> = {}) => deriveFollowupProfile({
  measure: m, targetStage: 'd20', targetDailyPosts: D20_POSTS, commentRunsPerDay: RUNS,
  contractValidPersonas: o.personas === undefined ? 40 : o.personas,
  commentDailyUsdCap: o.cap === undefined ? D20_FIXTURE_COMMENT_CAP_USD : o.cap,
})

console.log('\n① 실측이 없으면 숫자를 만들지 않는다')
{
  const none = derive(null)
  check('🔴 D10 실측 없음 → UNKNOWN · 후보 0', none.verdict === 'UNKNOWN' && none.candidate === null && none.codes.includes('MEASURE_MISSING'))
  const notPass = derive(measure({ evidenceVerdict: 'FAIL' }))
  check('🔴 D10 증명일 운영 증거가 PASS 아님 → BLOCK', notPass.verdict === 'BLOCK' && notPass.candidate === null && notPass.codes.includes('MEASURE_NOT_PASS'))
  const unsettled = derive(measure({ followup: { settled: 12, settledUsd: 0.03, open: 1 } }))
  check('🔴 미정산 예약이 하나라도 있으면 후보 0(추정으로 정산하지 않는다)', unsettled.candidate === null && unsettled.codes.includes('COST_UNSETTLED'))
  const zero = derive(measure({ acceptedFollowups: 0 }))
  check('🔴 D10 추가 댓글 0건 → 단가를 모른다 · 후보 0', zero.candidate === null && zero.codes.includes('FOLLOWUP_UNMEASURED'))
  const noFirst = derive(measure({ first: { settled: 0, settledUsd: 0, open: 0 } }))
  check('🔴 첫 댓글 단가를 모르면 예산 판정을 못 한다 · 후보 0', noFirst.candidate === null && noFirst.codes.includes('FIRST_UNMEASURED'))
  for (const accepted of [0, null]) {
    const x = derive(measure({ acceptedFirstComments: accepted }))
    check(`🔴 실제 공개 첫 댓글 ${String(accepted)} → 후보 0 · FIRST_UNMEASURED(장부 요청 수로 대신하지 않는다)`,
      x.candidate === null && x.codes.includes('FIRST_UNMEASURED'))
  }
  const badProfile = derive(measure({ installedProfile: { ...D10_PROFILE, approvedBy: null } }))
  check('🔴 D10 에 설치된 profile 이 승인 없는 후보였으면 BLOCK', badProfile.verdict === 'BLOCK' && badProfile.codes.includes('MEASURE_PROFILE_INVALID'))
  const noPersona = derive(measure(), { personas: null })
  check('🔴 계약 유효 Persona 를 모르면 후보 0', noPersona.candidate === null && noPersona.codes.includes('PERSONA_UNKNOWN'))
  const noCap = derive(measure(), { cap: null })
  check('🔴 댓글 하루 상한을 모르면 후보 0', noCap.candidate === null && noCap.codes.includes('COMMENT_CAP_UNKNOWN'))
}

console.log('\n② 식 — 실측에서만 나온다')
{
  const d = derive(measure())
  check('정상 실측 → CANDIDATE', d.verdict === 'CANDIDATE' && d.candidate !== null, `${d.verdict} ${d.codes.join(',')}`)
  const c = d.candidate!
  const scale = deriveCommentScale({ dailyPosts: D20_POSTS, personas: { normal: 40, quiet: 0 }, runsPerDay: RUNS })
  check('🔴 하루 건수 · 회차 · Persona 하루 = 정본 계산식(deriveCommentScale) 그대로', c.dailyCount === scale.followup.dailyCount
    && c.runMax === scale.followup.runMax && c.perPersonaDailyMax === scale.followup.perPersonaDailyMax, JSON.stringify(scale.followup))
  check('🔴 하루 USD = 하루 건수 × (정산 USD / 실제 발행 추가 댓글) — 버린 요청 비용 포함', Math.abs(c.dailyUsd - Math.ceil(c.dailyCount * 0.003 * 10_000) / 10_000) < 1e-12, String(c.dailyUsd))
  check('🔴 단가가 바뀌면 하루 USD 도 그만큼 — 상수가 아니다',
    Math.abs((derive(measure({ followup: { settled: 12, settledUsd: 0.06, open: 0 } }), { cap: 9 }).candidate?.dailyUsd ?? 0) - 2 * c.dailyUsd) < 1e-9)
  check('Persona 가 적으면 한 사람 상한이 오른다', (derive(measure(), { personas: 20 }).candidate?.perPersonaDailyMax ?? 0) > c.perPersonaDailyMax)
  check('🔴 단계는 d20 · 판은 같다', c.stage === 'd20' && c.v === FOLLOWUP_PROFILE_VERSION)
}

console.log('\n③ 승인 없이 설치되지 않는다 · 첫 댓글 예산이 먼저다')
{
  // 🔴 fixture 는 실제보다 강할 수 없다 — 런타임이 천장으로 깎는 상한이면 이 fixture 의 CANDIDATE 는 운영에서 나올 수 없는 결과다
  check('D20 후보 fixture 상한 $0.50(역사 값)은 지금 런타임이 깎지 않고 그대로 읽는 값이다 — d20-readiness 가 쓰는 단계(미확인 → base 칸) 천장 아래다',
    commentLoopLimitsFromEnv({ [COMMENT_LOOP_BUDGET_ENV.dailyUsd]: String(D20_FIXTURE_COMMENT_CAP_USD) }, null).limits.dailyUsd
      === D20_FIXTURE_COMMENT_CAP_USD
    && D20_FIXTURE_COMMENT_CAP_USD < commentDailyCapOf(null))
  const readinessSource = readFileSync('scripts/d20-readiness.mts', 'utf-8')
  check('🔴 연결: d20-readiness 는 오늘 결정을 읽지 않는다 — 댓글 천장을 단계 미확인(null → base)으로 재고 화면·JSON 에 적는다',
    /const commentStage = null\n/.test(readinessSource)
    && /commentLoopLimitsFromEnv\(pe\.values, commentStage\)/.test(readinessSource)
    && /commentCapStage: '단계 미확인/.test(readinessSource) && /console\.log\(`   🟡 \$\{fu\.commentCapStage\}`\)/.test(readinessSource))
  const c = derive(measure()).candidate!
  check('🔴 승인칸이 비어 있다', c.approvedBy === null && c.approvedAt === null)
  check('🔴 후보 그대로는 validateFollowupProfile 이 거부한다(설치해도 0건)', !validateFollowupProfile(c, 'd20').ok)
  check('창업자 승인을 채우면 D20 에서만 통과', validateFollowupProfile({ ...c, approvedBy: 'founder', approvedAt: '2026-10-16T22:00:00+09:00' }, 'd20').ok
    && !validateFollowupProfile({ ...c, approvedBy: 'founder', approvedAt: '2026-10-16T22:00:00+09:00' }, 'd10').ok)
  check('🔴 기계 승인 표식은 승인이 아니다', !validateFollowupProfile({ ...c, approvedBy: 'machine:d20-readiness', approvedAt: '2026-10-16T22:00:00+09:00' }, 'd20').ok)
  const short = derive(measure(), { cap: 0.25 })
  check('🔴 첫 댓글(20 × $0.002) + 추가 $0.24 > 하루 상한 $0.25 → BLOCK(창업자 비용 결정) · 후보 0',
    short.verdict === 'BLOCK' && short.candidate === null && short.codes.includes('COMMENT_BUDGET_SHORT'), JSON.stringify(short.counts))
}

console.log('\n③-2 첫 댓글 단가 분모 — 장부 요청 수가 아니라 실제 공개 첫 댓글 수')
{
  // 🔴 정산 요청 12건(재시도 · 실패 포함) $0.036 · 실제 공개 첫 댓글 10건 → 단가 $0.0036(= 총비용/10). 요청 수로 나누면 $0.003 으로 낮게 잡힌다
  const retry = measure({ first: { settled: 12, settledUsd: 0.036, open: 0 }, acceptedFirstComments: 10 })
  const d = derive(retry, { cap: 1 })
  check('🔴 첫 댓글 예산 = 목표 20 × (총비용 $0.036 / 실제 10건) = $0.072', Math.abs((d.counts.firstCommentUsd ?? 0) - 0.072) < 1e-12,
    String(d.counts.firstCommentUsd))
  check('🔴 요청 수(12)로 나눈 값($0.06)이 아니다', Math.abs((d.counts.firstCommentUsd ?? 0) - 0.06) > 1e-9)
  // 필요액 = 첫 댓글 $0.072 + 추가 $0.24 = $0.312 — 상한 $0.31 이면 막힌다. 요청 수로 나눴다면 $0.30 으로 통과했을 경계다
  const edge = derive(retry, { cap: 0.31 })
  check('🔴 같은 실측 · 상한 $0.31 → COMMENT_BUDGET_SHORT(과소계상이면 $0.30 으로 통과했을 경계) · 후보 0',
    edge.verdict === 'BLOCK' && edge.candidate === null && edge.codes.includes('COMMENT_BUDGET_SHORT'), JSON.stringify(edge.counts))
  check('D10 PASS 요구는 그대로', derive(measure({ evidenceVerdict: 'FAIL', first: { settled: 12, settledUsd: 0.036, open: 0 } }), { cap: 1 }).verdict === 'BLOCK')
}

console.log('\n④ 도구가 쓰지 않는다')
{
  const cli = readFileSync('scripts/d20-readiness.mts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  check('🔴 CLI 에 DB 쓰기 호출이 없다', !/\.(create|update|upsert|delete)[A-Za-z]*\(|\$executeRaw/.test(cli))
  check('🔴 --apply · --write 를 거부한다', /'--apply' \|\| a === '--write'/.test(cli))
  check('🔴 다음날 리허설은 --next-day 전용 경로다', /NEXT_DAY = argv\.includes\('--next-day'\)/.test(cli)
    && /NEXT_DAY \? nextCalendarDate\(TODAY\) : TODAY/.test(cli))
  check('🔴 --next-day 와 --date 동시 입력은 실패한다', /NEXT_DAY && EXPLICIT_DATE !== null\) fail/.test(cli))
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts?: Record<string, string> }
  check('🔴 사람이 날짜를 생략하지 않도록 next-day 명령이 고정돼 있다',
    pkg.scripts?.['d20:readiness:next-day'] === 'tsx scripts/d20-readiness.mts --next-day')
  check('🔴 후보 파일은 새 경로에만(덮어쓰기 0 · 0600)', /flag: 'wx'/.test(cli) && /mode: 0o600/.test(cli))
  check('🔴 preflight 는 controller 와 같은 판정 함수', /judgeNextPreflight\(TARGET, r\.facts, RUNNER_GRID\)/.test(cli) && /readPreflightFacts\(prisma/.test(cli))
  check('🔴 첫 댓글 분모는 정본 증거 firstCommentOk 에서만 온다', /acceptedFirstComments: typeof evidence\.counts\?\.firstCommentOk === 'number'/.test(cli))
}

console.log('\n⑤ 댓글 규모 계산식 — 편수 · 글당 목표 평균 · Persona 수에서 상한 전부')
{
  const C = threadMeanSizeAt(null)
  const s30 = deriveCommentScale({ dailyPosts: 30, personas: { normal: 56, quiet: 4 }, runsPerDay: RUNS, usdPerCall: 0.0016, acceptRate: 0.72 })
  check('글당 목표 평균은 대화 계획의 마지막 줄', s30.meanSize === C && C === THREAD_TARGETS[THREAD_TARGETS.length - 1]!.meanSize)
  check('🔴 하루 댓글 = 편수 × 평균 · 추가 = 편수 × (평균 − 1)', s30.dailyComments === 30 * C && s30.followupComments === 30 * (C - 1))
  check('🔴 한 사람 하루·주 상한으로 하루 댓글을 여유 있게 감당한다(조용한 Persona 는 절반)',
    56 * s30.persona.dailyCap + 4 * s30.persona.quietDailyCap >= s30.dailyComments * COMMENT_SCALE_HEADROOM
    && 56 * s30.persona.weeklyCap + 4 * s30.persona.quietWeeklyCap >= s30.dailyComments * 7 * COMMENT_SCALE_HEADROOM
    && s30.persona.quietDailyCap < s30.persona.dailyCap, JSON.stringify(s30.persona))
  check('🔴 추가 댓글 Persona 하루 상한이 Persona 하루 상한과 같다(두 겹이 따로 막지 않는다)', s30.followup.perPersonaDailyMax === s30.persona.dailyCap)
  check('🔴 회차 상한 × 하루 회차 ≥ 추가 댓글 기대치의 두 배', s30.followup.runMax * RUNS >= s30.followupComments * 2, `${s30.followup.runMax} × ${RUNS}`)
  check('🔴 하루 USD 는 실측(단가 · 적재율)이 있을 때만', s30.followup.dailyUsd !== null && s30.commentLedgerUsdExpected !== null
    && deriveCommentScale({ dailyPosts: 30, personas: { normal: 56, quiet: 4 }, runsPerDay: RUNS }).followup.dailyUsd === null)
  const up = deriveCommentScale({ dailyPosts: 30, personas: { normal: 56, quiet: 4 }, runsPerDay: RUNS, meanSize: C + 1 })
  check('🔴 평균을 올리면 상한이 같이 오른다 — 숫자 한 칸', up.followup.dailyCount > s30.followup.dailyCount && up.persona.weeklyCap > s30.persona.weeklyCap)
  console.log(`   D30 · 56+4명 · 평균 ${C}: ${JSON.stringify({ persona: s30.persona, followup: s30.followup, ledger: s30.commentLedgerUsdExpected })}`)
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} 통과 · ${fail} 실패 — DB 0 · 파일 0`)
if (fail > 0) process.exit(1)
