#!/usr/bin/env tsx
/**
 * 무인 댓글 루프 **순수 검사** — 🔴 DB 0 · 네트워크 0(fetch 는 가짜) · 운영 장부·env 0
 *
 *   ① 무인 레인 규칙(`judgeAutoLane`) — 60분 · 글당 1건 · 자기 글 · 실사용자 3건 · 단계·주체·상태
 *   ② 생성 전 대상 필터 · 글당 첫 대상만
 *   ③ 예산 env — 기본값 · 상한 $0.20 으로 내림 · 잘못 쓴 값은 보류
 *   ④ 🔴 실제 장부 세션(댓글 전용 디렉터리)이 하루 상한에서 **요청 전에** 막는다 — 생성 fetch 0
 *   ⑤ 댓글 1건의 실제 비용 계산(가격표 정본 · 운영 장부 실측 토큰)
 *   ⑥ 오케스트레이터 — 단계·모델이 아니면 provider 0 · write 0 · 9관문 정본 그대로
 *   ⑦ schedule 템플릿 · 배포 quiesce 목록
 *
 *   npm run persona:comment-loop-check
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PrismaClient } from '@prisma/client'

import {
  AUTO_FIRST_COMMENT_WINDOW_MINUTES, AUTO_PERSONA_COMMENTS_PER_POST_MAX, COMMENT_LOOP_BUDGET_ENV,
  COMMENT_LOOP_DAILY_USD_MAX, commentLoopLimitsFromEnv, firstPerPost, isAutoLaneCandidatePost,
  judgeAutoLane, type AutoLaneFacts,
} from '../src/lib/persona-comment-auto-lane'
import { costOf, reserveOf } from '../src/lib/llm-pricing'
import { ledgerDateOf, type LedgerEntry } from '../src/lib/llm-ledger'
import { appendLedgerLine, defaultLedgerDir, ledgerPathOf } from './lib/llm-ledger-store.mjs'
import { SupplyLlmSession, LEDGER_BLOCKED } from './lib/supply-llm-call.mjs'
import { MAX_OUTPUT_TOKENS } from './lib/persona-prompt'
import {
  commentLoopLedgerDir, makeCanonGate, runCommentLoop, generationGateOf, type CommentGenerate,
} from './lib/persona-comment-loop.mjs'
import {
  acquireRunnerLease, releaseRunnerLease, requestFollowUp, takeFollowUp, shouldRunFollowUp, MAX_FOLLOW_UPS, FOLLOW_UP_FILE,
} from './lib/runner-lease.mjs'
import { currentLockToken } from './lib/collect-lock.mjs'
import type { TargetSource, GateContext } from './lib/persona-comment-targets'
import type { CommentInput } from '../src/lib/persona-comment-input'
import {
  COMMENT_RUNNER_LABEL, COMMENT_RUNNER_SCRIPT, COMMENT_RUNNER_SLOTS, FIRST_COMMENT_MAX_MINUTES,
  FIRST_COMMENT_ATTEMPTS, COMMENT_RUNNER_MAX_GAP_MINUTES,
  renderCommentRunnerPlist,
} from './lib/persona-comment-runner-template'
import { DEPLOY_QUIESCE_JOBS } from './lib/runtime-quiesce-jobs'
import { auditLedgerDir } from './lib/auto-ready-semantic-provider.mjs'

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

console.log('\n══ 무인 댓글 루프 순수 검사 (🔴 DB 0 · 네트워크 0 · 운영 장부 0) ══\n')

// ─────────────────────────────────────────────────────────
console.log('① 무인 레인 규칙 — 트랜잭션 안에서 부르는 그 함수')
// ─────────────────────────────────────────────────────────
const NOW = Date.parse('2026-09-28T03:00:00.000Z')
const base: AutoLaneFacts = {
  stage: 'bootstrap-auto', actor: 'automation', queueStatus: 'PENDING', nowMs: NOW,
  postPublishedAtMs: NOW - 10 * 60_000, personaCommentsOnPost: 0,
  postAuthorPersonaId: 'persona-author', candidatePersonaId: 'persona-commenter', memberCommentsOnPost: 0,
}
const lane = (o: Partial<AutoLaneFacts>) => judgeAutoLane({ ...base, ...o })
{
  check('🟢 새 글(10분) · 댓글 0 · 다른 Persona → 통과', lane({}).ok)
  check('🟢 경계 — 정확히 60분이면 통과', lane({ postPublishedAtMs: NOW - 60 * 60_000 }).ok)
  check('🔴 60분 1초 → 막힌다', !lane({ postPublishedAtMs: NOW - 60 * 60_000 - 1_000 }).ok)
  check('🔴 61분 → 막힌다 (늦은 첫 댓글은 내지 않는다)', !lane({ postPublishedAtMs: NOW - 61 * 60_000 }).ok)
  check('🔴 공개 시각이 미래 → 막힌다', !lane({ postPublishedAtMs: NOW + 60_000 }).ok)
  check('🔴 공개 시각 모름 → 막힌다(fail-closed)', !lane({ postPublishedAtMs: null }).ok)
  check('🔴 글당 1건 — 이미 Persona 댓글 1건 → 막힌다', !lane({ personaCommentsOnPost: 1 }).ok)
  check('🔴 Persona 댓글 수 모름 → 막힌다', !lane({ personaCommentsOnPost: null }).ok)
  check('🔴 자기 글 → 막힌다', !lane({ postAuthorPersonaId: 'persona-commenter' }).ok)
  check('🟢 사람이 쓴 글(작성 Persona 없음) → 통과', lane({ postAuthorPersonaId: null }).ok)
  check('🔴 작성 Persona 를 못 읽음 → 막힌다', !lane({ postAuthorPersonaId: undefined }).ok)
  check('🟢 실사용자 댓글 2건 → 통과', lane({ memberCommentsOnPost: 2 }).ok)
  check('🔴 실사용자 댓글 3건 → 끼어들지 않는다', !lane({ memberCommentsOnPost: 3 }).ok)
  check('🔴 실사용자 댓글 수 모름 → 막힌다', !lane({ memberCommentsOnPost: null }).ok)
  check('🔴 bootstrap-review 단계 → 무인 발행 없음', !lane({ stage: 'bootstrap-review' }).ok)
  check('🔴 organic 단계 → 이 레인이 아니다', !lane({ stage: 'organic' }).ok)
  check('🔴 shadow 단계 → 막힌다', !lane({ stage: 'shadow' }).ok)
  check('🔴 사람이 누른 발행(manual-admin)은 무인 레인이 아니다', !lane({ actor: 'manual-admin' }).ok)
  check('🔴 APPROVED 행은 무인 레인으로 내지 않는다(PENDING 만)', !lane({ queueStatus: 'APPROVED' }).ok)
  check('🔴 EXPIRED 행 → 막힌다', !lane({ queueStatus: 'EXPIRED' }).ok)
  check('🔴 막힐 때 사유를 전부 모은다', lane({ personaCommentsOnPost: 1, postAuthorPersonaId: 'persona-commenter' }).blockers.length === 2)
  check('🔴 정본 수 — 60분 · 글당 1건', AUTO_FIRST_COMMENT_WINDOW_MINUTES === 60 && AUTO_PERSONA_COMMENTS_PER_POST_MAX === 1)
  check('🔴 schedule 템플릿의 시한이 레인 정본과 같은 값이다', FIRST_COMMENT_MAX_MINUTES === AUTO_FIRST_COMMENT_WINDOW_MINUTES)
}

// ─────────────────────────────────────────────────────────
console.log('\n② 생성 전 대상 필터 · 글당 첫 대상만')
// ─────────────────────────────────────────────────────────
{
  const p = (o: Partial<Parameters<typeof isAutoLaneCandidatePost>[0]>) =>
    isAutoLaneCandidatePost({ id: 'x', publishedAtMs: NOW - 5 * 60_000, personaComments: 0, hasOpenQueue: false, ...o }, NOW)
  check('🟢 5분 된 새 글 → 대상', p({}))
  check('🔴 61분 → 대상 아님(돈을 쓰지 않는다)', !p({ publishedAtMs: NOW - 61 * 60_000 }))
  check('🔴 Persona 댓글이 이미 있으면 대상 아님', !p({ personaComments: 1 }))
  check('🔴 열린 후보가 있으면 대상 아님(sweep 이 먼저 낸다)', !p({ hasOpenQueue: true }))
  check('🔴 공개 시각 모름 → 대상 아님', !p({ publishedAtMs: null }))
  const picked = firstPerPost([{ p: 'a', n: 1 }, { p: 'a', n: 2 }, { p: 'b', n: 3 }], (x) => x.p)
  check('🔴 글당 첫 대상 하나만 남긴다', picked.length === 2 && picked[0]!.n === 1 && picked[1]!.n === 3)
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 예산 env — 기본값 · 상한 · 잘못 쓴 값')
// ─────────────────────────────────────────────────────────
{
  const d = commentLoopLimitsFromEnv({})
  check('🟢 env 가 없으면 기본값 — 하루 $0.20 · 회차 6 · 여유 1.5',
    d.limits.dailyUsd === 0.2 && d.limits.runRequestCap === 6 && d.limits.headroomMultiplier === 1.5)
  check('🔴 하루 상한 정본은 $0.20 이하다', COMMENT_LOOP_DAILY_USD_MAX <= 0.2)
  const hi = commentLoopLimitsFromEnv({ [COMMENT_LOOP_BUDGET_ENV.dailyUsd]: '5' })
  check('🔴 🔴 **env 가 $5 여도 $0.20 으로 내린다 — 올릴 수 없다**', hi.limits.dailyUsd === 0.2)
  const lo = commentLoopLimitsFromEnv({ [COMMENT_LOOP_BUDGET_ENV.dailyUsd]: '0.05' })
  check('🟢 낮추는 것은 된다 — $0.05', lo.limits.dailyUsd === 0.05)
  const bad = commentLoopLimitsFromEnv({ [COMMENT_LOOP_BUDGET_ENV.dailyUsd]: '0.2O' })
  check('🔴 오타는 기본값이 아니라 보류다(null)', bad.limits.dailyUsd === null)
  check('🔴 회차 상한 2.5 → 보류', commentLoopLimitsFromEnv({ [COMMENT_LOOP_BUDGET_ENV.runRequestCap]: '2.5' }).limits.runRequestCap === null)
  check('🔴 여유 배수 0.5 → 보류(1 미만은 예약이 추정 오차를 못 덮는다)',
    commentLoopLimitsFromEnv({ [COMMENT_LOOP_BUDGET_ENV.headroomMultiplier]: '0.5' }).limits.headroomMultiplier === null)
  check('🔴 env 이름이 공급·감사와 다르다',
    Object.values(COMMENT_LOOP_BUDGET_ENV).every((n) => n.startsWith('SORAN_PERSONA_COMMENT_')))
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 🔴 실제 장부 세션 — 하루 상한에서 요청 전에 막는다 (fetch 만 가짜)')
// ─────────────────────────────────────────────────────────
const realFetch = globalThis.fetch
let countCalls = 0
let genCalls = 0
const fakeFetch = (inTokens: number, outTokens: number): typeof globalThis.fetch =>
  (async (url: string | URL | Request) => {
    const u = String(url)
    if (u.includes(':countTokens') || u.includes('/count_tokens')) {
      countCalls += 1
      return new Response(JSON.stringify({ totalTokens: inTokens }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    genCalls += 1
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"text":"시험 댓글"}' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: inTokens, candidatesTokenCount: outTokens, thoughtsTokenCount: 0, totalTokenCount: inTokens + outTokens },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof globalThis.fetch
{
  check('🔴 댓글 전용 장부 디렉터리 — 공급·감사 장부와 다르다',
    commentLoopLedgerDir('/h') !== defaultLedgerDir() && commentLoopLedgerDir('/h') !== auditLedgerDir('/h')
    && commentLoopLedgerDir('/h').endsWith('persona-comment-ledger'))
  const day = new Date('2026-09-28T03:00:00.000Z')
  const seedSpent = (dir: string, usd: number): void => {
    const e: LedgerEntry = {
      runId: 'earlier', stage: 'commentGen', attemptId: `seed-${usd}`, requestNo: 0, provider: 'google',
      apiModelId: 'gemini-3.7-flash', model: 'gemini-3.7-flash', status: 'settled', blockCode: null,
      countedInputTokens: 1805, maxOutputTokens: 800, reservedUsd: usd, inputTokens: 1805, outputTokens: 231,
      cacheWriteTokens: 0, cacheReadTokens: 0, usageKeys: [], settledUsd: usd, pricingVersion: 'x',
      startedAt: day.toISOString(), endedAt: day.toISOString(), errorCode: null,
    }
    appendLedgerLine(ledgerPathOf(dir, ledgerDateOf(day)), e)
  }
  const callOnce = async (spent: number) => {
    countCalls = 0; genCalls = 0
    const dir = mkdtempSync(join(tmpdir(), 'soran-comment-loop-ledger-'))
    if (spent > 0) seedSpent(dir, spent)
    const session = new SupplyLlmSession({ runId: 'loop-check', dir, limits: commentLoopLimitsFromEnv({}).limits, now: () => day })
    process.env.GEMINI_API_KEY = 'test-key-not-real'
    globalThis.fetch = fakeFetch(1805, 231)
    try {
      return await session.call({
        stage: 'commentGen', model: 'gemini-3.7-flash', systemPrompt: '시험', userPayload: '시험',
        maxOutputTokens: MAX_OUTPUT_TOKENS, timeoutMs: 5_000,
      })
    } finally { globalThis.fetch = realFetch }
  }
  const fresh = await callOnce(0)
  check('🟢 오늘 0원 → 요청이 나가고 정산된다', fresh.ok && genCalls === 1 && fresh.settledUsd !== null, `${fresh.errorCode ?? ''}`)
  const nearCap = await callOnce(0.198)
  check('🔴 🔴 **오늘 $0.198 썼으면 다음 요청은 보내지 않는다(예약 > 남은 $0.002)**',
    !nearCap.ok && (nearCap.errorCode ?? '').startsWith(`${LEDGER_BLOCKED}:DAILY_EXHAUSTED`) && genCalls === 0,
    `${nearCap.errorCode ?? ''} · gen ${genCalls}`)
  const midCap = await callOnce(0.19)
  check('🟢 $0.19 썼으면 아직 한 건은 된다(예약 ≈ $0.005)', midCap.ok && genCalls === 1, `${midCap.errorCode ?? ''}`)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 댓글 1건의 실제 비용 — 가격표 정본 · 운영 장부 실측 토큰(입력 1805 · 출력 231)')
// ─────────────────────────────────────────────────────────
{
  const settled = costOf({ model: 'gemini-3.7-flash', usage: { inputTokens: 1805, outputTokens: 231, cacheWriteTokens: 0, cacheReadTokens: 0 } })
  const reserve = reserveOf({ model: 'gemini-3.7-flash', countedInputTokens: 1805, maxOutputTokens: MAX_OUTPUT_TOKENS, headroomMultiplier: 1.5 })
  const s = settled.known ? settled.usd : Number.NaN
  const r = reserve.known ? reserve.usd : Number.NaN
  console.log(`     정산 $${s.toFixed(6)} / 건 · 예약 $${r.toFixed(6)} / 건 · 하루 $0.20 → 예약 기준 ${Math.floor(0.2 / r)}건 · 정산 기준 ${Math.floor(0.2 / s)}건`)
  check('🔴 실측 1건 정산 ≈ $0.0022 (운영 장부 2026-09-22 줄과 같다)', Math.abs(s - 0.00222) < 0.00001)
  check('🔴 1건 예약(최악 출력 800tok) ≈ $0.0050', Math.abs(r - 0.00503) < 0.00002)
  check('🔴 하루 $0.20 은 예약 기준으로도 d10(글 10편·10건)을 넉넉히 덮는다', Math.floor(0.2 / r) >= 30)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 오케스트레이터 — 단계·모델 관문 · 9관문 정본')
// ─────────────────────────────────────────────────────────
{
  let generated = 0
  const gen: CommentGenerate = async () => { generated += 1; return { ok: true, text: 'x', errorCode: null } }
  const noDb = new Proxy({}, { get: () => { throw new Error('DB 에 닿았다') } }) as PrismaClient
  const noSource = new Proxy({}, { get: () => { throw new Error('대상 source 에 닿았다') } }) as TargetSource
  const canonOk = {
    selection: { status: 'confirmed' as const, winner: 'gemini-3.7-flash' },
    canon: { runId: 'r', artifactSha: { summary: 'a', samples: 'b', key: 'c' }, winner: 'gemini-3.7-flash', decidedBy: 'x', decidedAt: 'y', scoredSamples: 9 },
    detail: 'ok',
  }
  const deps = (stage: string | undefined, over: Partial<Parameters<typeof runCommentLoop>[0]> = {}) => ({
    prisma: noDb, now: new Date(NOW), env: { SORAN_PERSONA_COMMENT_STAGE: stage }, live: true,
    source: noSource, canon: canonOk, makeGenerate: () => gen, generation: { ok: true, reason: '' }, runRequestCap: 6, ...over,
  })
  for (const stage of [undefined, 'shadow', 'bootstrap-review', 'organic', 'release', 'bootstrap-autoo']) {
    const r = await runCommentLoop(deps(stage))
    check(`🔴 단계 ${stage ?? '(없음)'} → NOT_AUTO_STAGE · DB 0 · provider 0`, r.outcome === 'NOT_AUTO_STAGE' && generated === 0)
  }
  const noCanon = await runCommentLoop(deps('bootstrap-auto', { canon: { selection: { status: 'provisional', winner: null }, canon: null, detail: 'x' } }))
  check('🔴 모델 미확정 → MODEL_NOT_CONFIRMED · DB 0 · provider 0', noCanon.outcome === 'MODEL_NOT_CONFIRMED' && generated === 0)
  const wrongModel = await runCommentLoop(deps('bootstrap-auto', { canon: { ...canonOk, selection: { status: 'confirmed', winner: 'gpt-4o' } } }))
  check('🔴 등록되지 않은 모델 → 막힌다', wrongModel.outcome === 'MODEL_NOT_CONFIRMED')

  // 🔴 9관문은 정본 그대로 — 원문 20자 복제는 ① 에서 막힌다
  const input = {
    personaCode: 'P01', reactionRole: 'empathy',
    persona: { code: 'P01', ageBand: '50대', region: null, lifeStage: '갱년기', identity: { menopauseStatus: '중' }, voiceCore: { ending: '요' }, voiceVariations: {}, noGoTopics: [], noGoExpressions: [], forbiddenReactionRoles: [] },
    post: { id: 'post-1', title: '요즘 잠이 안 와요', bodyDigest: '새벽 세 시만 되면 눈이 떠져서 다시 잠들기가 너무 어려워요 정말로', boardLabel: 'FREE', existingCommentDigests: [] },
    voice: { source: 'voice-derived', openers: [], endings: ['요'], punctuation: [], sampleCount: 1 },
    memory: { has: false, note: '' }, fingerprint: 'f',
  } as unknown as CommentInput
  const ctx: GateContext = {
    sourceTexts: [input.post.title, input.post.bodyDigest], knownNames: [], frequency: { lookup: () => 7, size: 100, corpusName: 'comment' },
    priorTexts: [], seedUseCount: 1, adviceForbidden: true, sourceIsCafeOperational: false, sourceContextReason: 'x',
  }
  const gate = makeCanonGate(() => ctx)
  const copied = gate({ input, text: '새벽 세 시만 되면 눈이 떠져서 다시 잠들기가 너무 어려워요 저도요' })
  check('🔴 원문 20자 복제 → ① regenerate (정본 판정 그대로)',
    copied.gates.length === 9 && copied.gates.find((g) => g.gate === '①')?.outcome === 'regenerate')
  const advice = gate({ input, text: '그럴 땐 꼭 병원 가서 검사받으셔야 합니다. 약 드셔야 해요.' })
  check('🔴 단정형 의료 조언 → ⑤ regenerate (완화 없음)', advice.gates.find((g) => g.gate === '⑤')?.outcome === 'regenerate')
  const none = makeCanonGate(() => undefined)({ input, text: '괜찮아요' })
  check('🔴 Gate 입력을 못 찾으면 빈 gates — 적재 계약이 거절한다', none.gates.length === 0)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦ schedule 템플릿 · 배포 quiesce')
// ─────────────────────────────────────────────────────────
{
  const xml = renderCommentRunnerPlist({
    runtimeRoot: '/Users/x/Documents/soransoran-runtime', npxPath: '/nvm/bin/npx',
    nodeBinDir: '/nvm/bin', logDir: '/Users/x/Library/Logs/soransoran',
  })
  check('🔴 예약 대상 스크립트가 무인 루프다', COMMENT_RUNNER_SCRIPT === 'scripts/persona-comment-loop.mts' && existsSync(COMMENT_RUNNER_SCRIPT))
  check('🔴 --live 로 부른다', xml.includes('<string>/Users/x/Documents/soransoran-runtime/scripts/persona-comment-loop.mts</string>\n        <string>--live</string>'))
  check('🔴 PATH 앞에 node 디렉터리', xml.includes('<key>PATH</key><string>/nvm/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>'))
  check('🔴 로그가 Documents 밖이다', !/<string>[^<]*\/Documents\/[^<]*\.log<\/string>/.test(xml))
  check('🔴 RunAtLoad false', xml.includes('<key>RunAtLoad</key><false/>'))
  const mins = COMMENT_RUNNER_SLOTS.map((s) => s.hour * 60 + s.minute)
  const maxGap = mins.slice(1).reduce((m, x, i) => Math.max(m, x - mins[i]!), 0)
  check(`🔴 회차 간격 최대 ${maxGap}분 ≤ 첫 댓글 시한 ${FIRST_COMMENT_MAX_MINUTES}분`, maxGap <= FIRST_COMMENT_MAX_MINUTES)
  // 🔴 (2026-09-28) 60분 안에 한 번뿐이면 9관문 한 번 막힘이 그 글의 첫 댓글을 통째로 잃는다
  check(`🔴 한 글이 시한 안에 ${FIRST_COMMENT_ATTEMPTS}번 시도를 받는다 — 간격 ${maxGap}분 ≤ ${COMMENT_RUNNER_MAX_GAP_MINUTES}분`,
    maxGap <= COMMENT_RUNNER_MAX_GAP_MINUTES)
  check('🔴 배포 동안 멈출 job 에 댓글 루프가 있다', DEPLOY_QUIESCE_JOBS.includes(COMMENT_RUNNER_LABEL))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 🔴 공통 lease · 겹친 깨움 합치기 · 예산 선검사 (2026-10-11 Batch A4)')
// ─────────────────────────────────────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'comment-lease-check-'))
  try {
    const NOWMS = Date.parse('2026-10-12T09:00:00+09:00')
    const TTL = 30 * 60_000
    const a = acquireRunnerLease(dir, 'loop.lock', NOWMS, TTL)
    const b = acquireRunnerLease(dir, 'loop.lock', NOWMS + 1_000, TTL)
    check('🔴 반례⑫ 겹친 두 깨움 — 동시에 도는 회차는 하나(두 번째는 HELD)', a.ok && !b.ok && b.kind === 'HELD')
    const r1 = requestFollowUp(dir, NOWMS + 1_000, 'event')
    const r2 = requestFollowUp(dir, NOWMS + 2_000, 'recovery')
    const r3 = requestFollowUp(dir, NOWMS + 3_000, 'scheduled')
    check('🔴 🔴 반례⑫ 진 깨움 셋 → follow-up 표식 하나(REQUESTED · COALESCED · COALESCED)',
      r1 === 'REQUESTED' && r2 === 'COALESCED' && r3 === 'COALESCED' && readdirSync(dir).filter((f) => f === FOLLOW_UP_FILE).length === 1)
    if (a.ok) {
      const forged = { path: a.handle.path, token: 'not-mine' }
      check('🔴 lease 주인이 아니면 표식을 지우지 못한다(fencing · NOT_HOLDER) · 표식 그대로',
        takeFollowUp(forged, dir) === 'NOT_HOLDER' && existsSync(join(dir, FOLLOW_UP_FILE)))
      // 주인의 순서 — 첫 회차 뒤 거둔다 → 한 번 더 · 그 뒤 생긴 표식은 거두지 않고 남긴다
      const t0 = takeFollowUp(a.handle, dir)
      check('🔴 반례⑫ 주인이 첫 회차 뒤 거둔다 → follow-up 1회', t0 === 'TAKEN' && shouldRunFollowUp(0, t0))
      requestFollowUp(dir, NOWMS + 60_000, 'event')
      check('🔴 🔴 반례⑫ follow-up 회차 뒤에는 더 돌지 않는다(상한 1) — 표식은 다음 회차 몫으로 남는다',
        MAX_FOLLOW_UPS === 1 && !shouldRunFollowUp(1, 'TAKEN') && existsSync(join(dir, FOLLOW_UP_FILE)))
      check('표식이 없으면 더 돌지 않는다', !shouldRunFollowUp(0, 'NONE') && !shouldRunFollowUp(0, 'NOT_HOLDER'))
      releaseRunnerLease(a.handle)
    }
    // 반례⑭ 살아 있는 lease · 시효 지난 lease — 둘 다 뺏지 않는다
    writeFileSync(join(dir, 'active.lock'), JSON.stringify({ token: 'held-token', pid: 1, at: new Date(NOWMS - 5 * 60_000).toISOString() }), { mode: 0o600 })
    const act = acquireRunnerLease(dir, 'active.lock', NOWMS, TTL)
    writeFileSync(join(dir, 'stale.lock'), JSON.stringify({ token: 'old-token', pid: 1, at: new Date(NOWMS - 6 * 3_600_000).toISOString() }), { mode: 0o600 })
    const old = acquireRunnerLease(dir, 'stale.lock', NOWMS, TTL)
    check('🔴 🔴 반례⑭ 살아 있는 lease 는 뺏지 않는다(HELD · token 그대로)',
      !act.ok && act.kind === 'HELD' && currentLockToken(join(dir, 'active.lock')) === 'held-token')
    check('🔴 🔴 반례⑭ 나이가 TTL 을 넘어도 뺏지 않는다(STALE_HELD · token 그대로 · 사람이 치운다)',
      !old.ok && old.kind === 'STALE_HELD' && currentLockToken(join(dir, 'stale.lock')) === 'old-token')
  } finally { rmSync(dir, { recursive: true, force: true }) }

  const lease = readFileSync('scripts/lib/runner-lease.mts', 'utf-8')
  const leaseCode = lease.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
  check('🔴 lease 모듈에 rename · 시효 회수 · pid 판정이 없다 — unlink 는 token 대조 뒤 표식 하나뿐',
    !/rename|kill\(|process\.kill|STALE_TAKEOVER/.test(leaseCode)
    && (leaseCode.match(/unlinkSync\(/g) ?? []).length === 1
    && leaseCode.indexOf('currentLockToken(handle.path) !== handle.token') < leaseCode.indexOf('unlinkSync('))
  const entry = readFileSync('scripts/persona-comment-loop.mts', 'utf-8')
  check('🔴 🔴 진입점 — lease 를 잡은 뒤에야 DB 클라이언트를 만든다(provider · DB write 전에 lease)',
    entry.indexOf('acquireRunnerLease(') > 0 && entry.indexOf('acquireRunnerLease(') < entry.indexOf('new PrismaClient()'))
  check('🔴 진입점 — 진 깨움은 follow-up 을 남기고 물러난다 · 상한에 닿으면 표식을 거두지 않는다',
    /requestFollowUp\(lockDir/.test(entry) && /if \(pass >= MAX_FOLLOW_UPS\) break\n\s*const take = takeFollowUp/.test(entry))
  check('🔴 🔴 진입점 — 유료 생성 문은 장부 판정(generationGateOf) 하나 · 정기/복구/사건 몫이 없다',
    /const gate = generationGateOf\(\{ missingEnv: missing, ledger \}\)/.test(entry) && /generation: gate,/.test(entry)
    && !/XPC_SERVICE_NAME[^\n]*(budget|limits|dailyUsd)/.test(entry))
  // 반례⑮ 예산 — 생성 문
  const bad = { health: 'bad' as const, codes: ['DAILY_EXHAUSTED'], reasons: ['x'] }
  check('🔴 반례⑮ 하루 상한 소진 → 생성 문 닫힘', !generationGateOf({ missingEnv: [], ledger: bad }).ok)
  check('🔴 장부 못 읽음 · 상태 모름 · env 없음 → 닫힘(fail-closed)',
    !generationGateOf({ missingEnv: [], ledger: null }).ok
    && !generationGateOf({ missingEnv: [], ledger: { health: 'unknown', codes: ['NO_BUDGET'], reasons: [] } }).ok
    && !generationGateOf({ missingEnv: ['X'], ledger: { health: 'ok', codes: [], reasons: [] } }).ok)
  check('기준선 — 장부 ok · env 있음 → 열림', generationGateOf({ missingEnv: [], ledger: { health: 'ok', codes: [], reasons: [] } }).ok)
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 DB 0 · 실제 provider 0 · 운영 장부·env 0\n')
process.exit(fail === 0 ? 0 : 1)
