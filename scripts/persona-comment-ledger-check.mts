#!/usr/bin/env tsx
/**
 * 댓글 후보 생성 **비용 통제 검사** — 🔴 네트워크 0 · 실제 provider 0 · DB 0 · 운영 env 0
 *
 * 🔴 **왜 필요한가** (2026-09-21).
 *
 *    댓글 경로는 `callProvider` 를 직접 불러 **장부를 타지 않았다.**
 *    금액 상한을 걸 자리가 없어 "회차 1건" 이라는 **건수**만으로 비용을 말해야 했다 —
 *    한 번의 호출이 얼마짜리인지는 아무도 모르는 상태였다.
 *
 * 🔴 **건수 상한은 금액 상한이 아니다.** 이 검사가 그 구분을 잠근다.
 *
 * 🔴 **소스 문자열만 보지 않는다.** 실제 `SupplyLlmSession` 을 만들어 임시 장부에
 *    예약·정산 줄이 실제로 적히는지 본다. provider 만 가짜다.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  LEDGER_BLOCKED, SupplyLlmSession, limitsFromEnv, missingBudgetEnvNames, BUDGET_ENV,
} from './lib/supply-llm-call.mjs'
import { LEDGER_STAGES, PAID_STAGES, tallyOf } from '../src/lib/llm-ledger'
import { readLedgerDay, ledgerPathOf } from './lib/llm-ledger-store.mjs'
import { M3_MODEL_CANDIDATES, M3_OUTPUT_TOKEN_POLICY } from './lib/voice-m3-contract.mjs'
import { MAX_OUTPUT_TOKENS } from './lib/persona-prompt'
import {
  judgeCommentCall, SETTLE_AMOUNT_UNKNOWN, MAX_TOKENS_REACHED, SETTLE_NOT_RECORDED,
  type CommentCallOutcome,
} from './lib/persona-comment-call.mjs'
import { REAL_LEDGER_IO, type SupplyCallResult } from './lib/supply-llm-call.mjs'
import type { LedgerEntry } from '../src/lib/llm-ledger'
import { runEnqueuePipeline, type PipelineTarget } from './lib/persona-comment-pipeline'
import { checkCommentCandidate } from './lib/persona-comment-candidate.mjs'
import { GATE_CODES } from '../src/lib/persona-comment-gate-report'
import { ENQUEUE_STATUS } from '../src/lib/persona-comment-queue'
import type { PostAuthorFacts } from '../src/lib/persona-comment-release'
import type { ModelCanon } from '../src/lib/persona-comment-provenance'
import type { GateLine } from '../src/lib/persona-comment-gate-report'

/** 🔴 `runEnqueuePipeline` 의 `gate` 가 돌려줘야 하는 모양 그대로다 */
type PipelineGateResult = {
  gates: GateLine[]
  gateStatus: string
  isBootstrap: boolean
}

/** Persona 가 쓴 글 — 자동 레인의 정상 대상 */
const AUTHOR_PERSONA: PostAuthorFacts = {
  authorPersonaCode: 'P15', authorOperatorWriterId: null, source: 'SYSTEM',
  authorRealMember: { accountCount: 0, providerId: 'persona' }, authorIsAdmin: false,
  visibility: {
    status: 'PUBLISHED', isMicroSeed: false,
    permanentNoindex: false, indexPromotionBlocked: false,
  },
}
/** 🔴 실회원이 쓴 글 — 원문이 외부 모델로 나가면 안 된다 */
const AUTHOR_MEMBER: PostAuthorFacts = {
  ...AUTHOR_PERSONA,
  authorPersonaCode: null, source: 'USER',
  authorRealMember: { accountCount: 1, providerId: 'kakao' },
}
const targetOf = (over: {
  postId?: string
  author?: PostAuthorFacts | null
  personaAlreadyOnPost?: boolean | null
  personaCommentsOnPost?: number | null
  hasOpenQueue?: boolean | null
} = {}): PipelineTarget => {
  const postId = over.postId ?? 'post-1'
  /**
   * 🔴 `??` 를 쓰지 않는다. `null` 은 **"읽지 못했다"** 라는 시험 대상 값인데
   *    `?? false` 로 받으면 조용히 `false` 가 되어 fail-closed 를 못 본다.
   */
  const pick = <K extends keyof typeof over>(k: K, fallback: NonNullable<typeof over[K]>) =>
    (k in over ? over[k] : fallback) as typeof over[K]
  return {
    input: {
      personaCode: 'P15', reactionRole: '공감',
      persona: {
        code: 'P15', ageBand: '50대 초반', region: '경기', lifeStage: '갱년기 중',
        identity: { menopauseStatus: '중' }, voiceCore: { tone: '담담' }, voiceVariations: {},
        noGoTopics: [], noGoExpressions: [], forbiddenReactionRoles: [],
      },
      post: {
        id: postId, title: '요즘 잠이 안 와요', bodyDigest: '새벽에 자꾸 깬다는 이야기',
        boardLabel: '자유게시판', existingCommentDigests: [],
      },
      voice: {
        source: 'persona-comments', openers: ['저도'], endings: ['-어요'],
        punctuation: ['...'], sampleCount: 12,
      },
      memory: { has: true, summary: '작년 여름에 같은 일을 겪었다' },
      fingerprint: 'fp-P15',
    },
    author: over.author === undefined ? AUTHOR_PERSONA : over.author,
    facts: {
      postId, personaCode: 'P15', reactionRole: '공감',
      hasOpenQueue: pick('hasOpenQueue', false) as boolean | null,
      personaCommentsOnPost: pick('personaCommentsOnPost', 0) as number | null,
      personaAlreadyOnPost: pick('personaAlreadyOnPost', false) as boolean | null,
      postStatus: 'PUBLISHED', personaActive: true, personaRealMember: false,
    },
  }
}

/** 🔴 9관문 전부 pass — 차단이 **다른 축에서** 오는지 보기 위한 바닥 */
const allPass: PipelineGateResult = {
  gates: GATE_CODES.map((g) => ({ gate: g, outcome: 'pass' as const, detail: '시험' })),
  gateStatus: 'pass', isBootstrap: false,
}

const CANON: ModelCanon = {
  runId: 'check', artifactSha: { summary: 'a', samples: 'b', key: 'c' },
  winner: 'gemini-3.7-flash', decidedBy: 'check', decidedAt: '2026-09-21T00:00:00.000Z',
  scoredSamples: 20,
}

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}
const stripComments = (t: string): string =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

console.log('\n══ 댓글 비용 통제 검사 (🔴 네트워크 0 · 실제 provider 0 · DB 0) ══\n')

const CLI = readFileSync('scripts/persona-comment-queue.mts', 'utf-8')
const cli = stripComments(CLI)

// ─────────────────────────────────────────────────────────
console.log('① 🔴 🔴 장부를 지난다 — 두 번째 장부를 만들지 않는다')
// ─────────────────────────────────────────────────────────
{
  check('🔴 🔴 **`commentGen` 이 정본 단계 목록에 있다**',
    (LEDGER_STAGES as readonly string[]).includes('commentGen')
    // 🔴 유료 단계다 — 사전 계산과 섞이지 않는다
    && (PAID_STAGES as readonly string[]).includes('commentGen'))

  check('🔴 🔴 **댓글 러너가 장부 세션을 쓴다**',
    /new SupplyLlmSession\(/.test(cli) && /session\.call\(/.test(cli)
    // 🔴 provider 를 직접 부르지 않는다 — 그것이 앞판의 결함이었다
    && !/callProvider\(/.test(cli))

  check('🔴 **같은 장부다 — 두 번째 장부를 만들지 않았다**',
    !/new LedgerStore|defaultLedgerDir\(\)/.test(cli)
    && /from '\.\/lib\/supply-llm-call\.mjs'/.test(cli))

  /**
   * 🔴 **가드를 실제로 부른다.** 이 자리가 문자열 검사였을 때는
   *    러너의 `if (missing.length > 0)` 를 `if (false)` 로 바꿔도 통과했다 —
   *    env 이름 세 개가 소스 어딘가에 남아 있었기 때문이다.
   */
  {
    const full = {
      SORAN_LLM_DAILY_BUDGET_USD: '1', SORAN_LLM_RUN_REQUEST_CAP: '1',
      SORAN_LLM_RESERVE_HEADROOM: '1.5',
    }
    const missingWhenEmpty = missingBudgetEnvNames(limitsFromEnv({}))
    const missingWhenFull = missingBudgetEnvNames(limitsFromEnv(full))
    const oneMissing = missingBudgetEnvNames(
      limitsFromEnv({ ...full, SORAN_LLM_DAILY_BUDGET_USD: '' }))
    check('🔴 🔴 **예산이 비면 유료 요청 앞에서 멈춘다 — 가드가 이름을 돌려준다**',
      missingWhenEmpty.length === 3
      && missingWhenFull.length === 0
      // 🔴 하나만 비어도 멈춘다 — 셋 다 비어야 멈추는 것이 아니다
      && oneMissing.length === 1
      && oneMissing[0] === BUDGET_ENV.dailyUsd,
      `빈값=${missingWhenEmpty.length} 전부=${missingWhenFull.length} 하나=${oneMissing.join(',')}`)

    // 🔴 러너가 그 가드를 실제로 쓰고, 걸리면 부르기 전에 죽는다
    check('🔴 **러너가 그 가드로 회차를 중단한다**',
      /missingBudgetEnvNames\(LEDGER_LIMITS\)/.test(cli)
      && /if \(missing\.length > 0\)[\s\S]{0,400}?process\.exit\(1\)/.test(cli)
      && /건수 상한만으로는 금액을 보장하지 못한다/.test(CLI))
  }

  /**
   * 🔴 러너가 **판정을 정본에 맡긴다.** 스크립트 최상위 `if` 로 적으면
   *    불러서 확인할 수 없고, 실제로 그 상태에서 두 구멍이 났다(⑤).
   */
  check('🔴 🔴 **후보 채택 판정을 `judgeCommentCall` 한 곳에 맡긴다**',
    /return judgeCommentCall\(res\)/.test(cli)
    // 🔴 러너가 따로 파싱하지 않는다 — 두 곳에 적으면 언젠가 갈린다
    && !/parseCandidate\(/.test(cli))
}

// ─────────────────────────────────────────────────────────
console.log('\n② 🔴 🔴 최악 비용 상한 — 건수로 금액을 말하지 않는다')
// ─────────────────────────────────────────────────────────
{
  const MODEL = 'gemini-3.7-flash'
  const price = M3_MODEL_CANDIDATES[MODEL]
  const policy = M3_OUTPUT_TOKEN_POLICY[MODEL]
  /**
   * 🔴 **한 번 부를 때의 최악 비용**은 아래 셋이 다 있어야 계산된다:
   *    단가 · 요청에 실어 보내는 출력 상한 · 실제로 센 입력 토큰.
   *    앞의 둘은 정본에 있고, 마지막은 사전 계산(무료)이 준다.
   */
  const outUsd = (MAX_OUTPUT_TOKENS / 1_000_000) * price.outputPerMTok
  check('🔴 🔴 **출력 상한과 단가가 정본에 있다 — 최악 출력 비용을 계산할 수 있다**',
    MAX_OUTPUT_TOKENS === 800 && price.outputPerMTok === 3.75
    && outUsd < 0.02,
    `출력 상한 ${MAX_OUTPUT_TOKENS}tok × $${price.outputPerMTok}/Mtok = $${outUsd.toFixed(6)}`)

  /** 🔴 요청에 실리는 상한이 계약 상한을 넘지 않는다 */
  check('🔴 댓글 프롬프트 상한이 모델 계약 상한 안에 있다',
    MAX_OUTPUT_TOKENS <= policy.maxOutputTokens,
    `${MAX_OUTPUT_TOKENS} ≤ ${policy.maxOutputTokens}`)

  /** 🔴 $0.02 안에서 허용되는 입력 토큰 — 사람이 읽을 수 있게 남긴다 */
  const inputRoom = ((0.02 - outUsd) / price.inputPerMTok) * 1_000_000
  check('🔴 $0.02 상한이 현실적인 여유를 준다',
    inputRoom > 10_000,
    `출력 최악 $${outUsd.toFixed(6)} · 남은 입력 여유 ${Math.round(inputRoom).toLocaleString()}tok`)
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 🔴 🔴 **실제 세션을 부른다** — fetch 만 가짜다')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **소스 문자열이 아니라 실제 호출로 본다.** `SupplyLlmSession.call` 의
   *    사전 계산 → 예약 → 요청 → 정산을 **그대로** 태우고, 임시 장부에 적힌 줄을 읽는다.
   *    바깥 세계로 나가는 것은 `fetch` 하나뿐이라 그것만 가짜로 둔다.
   */
  const realFetch = globalThis.fetch
  let countCalls = 0
  let genCalls = 0
  let lastBody: unknown = null
  const fakeFetch = (outTokens: number, inTokens: number, omitThoughts = false): typeof globalThis.fetch =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      const isCount = u.includes(':countTokens') || u.includes('/count_tokens')
      if (isCount) {
        countCalls += 1
        return new Response(JSON.stringify({ totalTokens: inTokens }), {
          status: 200, headers: { 'content-type': 'application/json' },
        })
      }
      genCalls += 1
      lastBody = JSON.parse(String(init?.body ?? '{}'))
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"text":"시험 댓글"}' }] }, finishReason: 'STOP' }],
        /**
         * 🔴 **`thoughtsTokenCount` 를 반드시 넣는다.** 빼면 정본이
         *    `usageUnknown` 으로 본다 — thinking 비용을 모르는 채 정산할 수 없어서다.
         *    (이 검사를 쓰다 실제로 그 길로 빠졌고, 정본이 옳게 막았다)
         */
        usageMetadata: {
          promptTokenCount: inTokens, candidatesTokenCount: outTokens,
          ...(omitThoughts ? {} : { thoughtsTokenCount: 7 }),
          totalTokenCount: inTokens + outTokens + (omitThoughts ? 0 : 7),
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof globalThis.fetch

  const env = { [BUDGET_ENV.dailyUsd]: '0.02', [BUDGET_ENV.runRequestCap]: '1',
    [BUDGET_ENV.headroomMultiplier]: '1.5' } as NodeJS.ProcessEnv
  const limits = limitsFromEnv(env)
  check('🔴 예산 셋이 모두 읽힌다',
    limits.dailyUsd === 0.02 && limits.runRequestCap === 1 && limits.headroomMultiplier === 1.5)
  const missing = limitsFromEnv({ [BUDGET_ENV.runRequestCap]: '1' } as NodeJS.ProcessEnv)
  check('🔴 🔴 **예산이 비면 `null` 이다 — 미설정을 무제한으로 읽지 않는다**',
    missing.dailyUsd === null && missing.headroomMultiplier === null)

  const callOnce = async (opts: {
    dailyUsd: string; runCap?: string; outTokens: number; inTokens: number
    omitThoughts?: boolean
  }) => {
    countCalls = 0; genCalls = 0; lastBody = null
    const dir = mkdtempSync(join(tmpdir(), 'soran-comment-ledger-'))
    const day = new Date('2026-09-21T03:00:00.000Z')
    const session = new SupplyLlmSession({
      runId: 'comment-test',
      dir,
      limits: limitsFromEnv({
        [BUDGET_ENV.dailyUsd]: opts.dailyUsd,
        [BUDGET_ENV.runRequestCap]: opts.runCap ?? '1',
        [BUDGET_ENV.headroomMultiplier]: '1.5',
      } as NodeJS.ProcessEnv),
      now: () => day,
    })
    process.env.GEMINI_API_KEY = 'test-key-not-real'
    globalThis.fetch = fakeFetch(opts.outTokens, opts.inTokens, opts.omitThoughts === true)
    try {
      const res = await session.call({
        stage: 'commentGen', model: 'gemini-3.7-flash',
        systemPrompt: '시험 지시', userPayload: '시험 입력',
        maxOutputTokens: MAX_OUTPUT_TOKENS, timeoutMs: 5_000,
      })
      const read = readLedgerDay(ledgerPathOf(dir, '2026-09-21'))
      return { res, entries: read.ok ? read.entries : [], tally: session.tally, genCalls, countCalls, lastBody }
    } finally { globalThis.fetch = realFetch }
  }

  // ── 정상 1건 — 예약과 정산이 짝을 이룬다 ──
  {
    const r = await callOnce({ dailyUsd: '0.02', outTokens: 300, inTokens: 900 })
    const paid = r.entries.filter((e) => e.stage === 'commentGen')
    const settled = paid.filter((e) => e.status === 'settled')
    check('🔴 🔴 **정상 1건 — 예약과 정산이 짝을 이룬다**',
      r.res.ok && r.genCalls === 1 && r.countCalls === 1
      && paid.length === 1 && settled.length === 1
      && settled[0]!.reservedUsd !== null && settled[0]!.settledUsd !== null
      // 🔴 실제 사용량으로 정산됐다 — 예약액을 그대로 옮기지 않았다
      && settled[0]!.settledUsd! < settled[0]!.reservedUsd!
      && r.res.settlementRecorded && r.tally.paid === 1 && r.tally.blocked === 0,
      JSON.stringify({ ok: r.res.ok, gen: r.genCalls, count: r.countCalls,
        recorded: r.res.settlementRecorded,
        entries: r.entries.map((e) => ({ stage: e.stage, status: e.status,
          reserved: e.reservedUsd, settled: e.settledUsd })) }))

    /**
     * 🔴 **thinking 토큰이 없으면 정산하지 않는다.** Gemini 는 thinking 도 출력으로
     *    과금하므로, 그 수를 모르면 얼마 썼는지 알 수 없다.
     */
    const noThoughts = await callOnce({
      dailyUsd: '0.02', outTokens: 300, inTokens: 900, omitThoughts: true,
    })
    const nt = noThoughts.entries.filter((e) => e.stage === 'commentGen')
    check('🔴 🔴 **thinking 토큰이 없으면 정산하지 않는다 — 예약이 열린 채 남는다**',
      nt.length === 1 && nt[0]!.status === 'usageUnknown' && nt[0]!.settledUsd === null,
      JSON.stringify(nt))

    // 🔴 요청 인자가 운영 경로 그대로인가 — 출력 상한이 실려 나갔다
    const cfg = (r.lastBody as { generationConfig?: { maxOutputTokens?: number } })?.generationConfig
    check('🔴 **요청에 댓글 출력 상한이 실려 나간다**',
      cfg?.maxOutputTokens === MAX_OUTPUT_TOKENS,
      JSON.stringify(cfg))
  }

  // ── $0.02 를 넘길 수 있는 요청은 provider 호출 0 ──
  {
    // 🔴 입력이 커서 예약액이 남은 여력을 넘는 경우
    const r = await callOnce({ dailyUsd: '0.02', outTokens: 300, inTokens: 40_000_000 })
    const gen = r.entries.filter((e) => e.stage === 'commentGen')
    check('🔴 🔴 **$0.02 를 넘길 수 있으면 provider 호출 0**',
      !r.res.ok && r.genCalls === 0
      && String(r.res.errorCode).startsWith(LEDGER_BLOCKED)
      && r.tally.blocked === 1 && r.tally.paid === 0
      // 🔴 막힌 사실이 장부에 남는다
      && gen.length === 1 && gen[0]!.status === 'blocked',
      JSON.stringify({ err: r.res.errorCode, gen: r.genCalls, tally: r.tally.blocked }))
  }

  // ── 회차 상한 1 — 두 번째는 부르지 않는다 ──
  {
    const dir = mkdtempSync(join(tmpdir(), 'soran-comment-ledger-'))
    const session = new SupplyLlmSession({
      runId: 'comment-test-2', dir,
      limits: limitsFromEnv({ [BUDGET_ENV.dailyUsd]: '5', [BUDGET_ENV.runRequestCap]: '1',
        [BUDGET_ENV.headroomMultiplier]: '1.5' } as NodeJS.ProcessEnv),
      now: () => new Date('2026-09-21T03:00:00.000Z'),
    })
    process.env.GEMINI_API_KEY = 'test-key-not-real'
    countCalls = 0; genCalls = 0
    globalThis.fetch = fakeFetch(300, 900)
    try {
      const a = await session.call({ stage: 'commentGen', model: 'gemini-3.7-flash',
        systemPrompt: 's', userPayload: 'u', maxOutputTokens: MAX_OUTPUT_TOKENS, timeoutMs: 5_000 })
      const before = genCalls
      const b = await session.call({ stage: 'commentGen', model: 'gemini-3.7-flash',
        systemPrompt: 's', userPayload: 'u', maxOutputTokens: MAX_OUTPUT_TOKENS, timeoutMs: 5_000 })
      check('🔴 🔴 **회차 상한 1 — 두 번째는 provider 를 부르지 않는다**',
        a.ok && !b.ok && before === 1 && genCalls === 1
        && String(b.errorCode).includes('RUN_CAP'),
        JSON.stringify({ a: a.ok, b: b.errorCode, gen: genCalls }))
    } finally { globalThis.fetch = realFetch }
  }

  // ── 사용량 미상 — 성공으로 보이지 않는다 ──
  {
    const dir = mkdtempSync(join(tmpdir(), 'soran-comment-ledger-'))
    const session = new SupplyLlmSession({
      runId: 'comment-test-3', dir,
      limits: limitsFromEnv({ [BUDGET_ENV.dailyUsd]: '5', [BUDGET_ENV.runRequestCap]: '3',
        [BUDGET_ENV.headroomMultiplier]: '1.5' } as NodeJS.ProcessEnv),
      now: () => new Date('2026-09-21T03:00:00.000Z'),
    })
    process.env.GEMINI_API_KEY = 'test-key-not-real'
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url)
      if (u.includes(':countTokens')) {
        return new Response(JSON.stringify({ totalTokens: 900 }), { status: 200 })
      }
      // 🔴 응답은 왔는데 **사용량이 없다** — 과금됐을 수 있다
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"text":"x"}' }] }, finishReason: 'STOP' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof globalThis.fetch
    try {
      await session.call({ stage: 'commentGen', model: 'gemini-3.7-flash',
        systemPrompt: 's', userPayload: 'u', maxOutputTokens: MAX_OUTPUT_TOKENS, timeoutMs: 5_000 })
      const read = readLedgerDay(ledgerPathOf(dir, '2026-09-21'))
      const gen = (read.ok ? read.entries : []).filter((e) => e.stage === 'commentGen')
      const t = tallyOf(read.ok ? read.entries : [])
      check('🔴 🔴 **사용량 미상은 정산으로 세지 않는다 — 예약이 열린 채 남는다**',
        gen.length === 1 && gen[0]!.status === 'usageUnknown'
        && t.settledUsd === 0 && t.openReservedUsd > 0 && t.usageUnknownUsd > 0,
        JSON.stringify({ status: gen[0]?.status, settled: t.settledUsd, open: t.openReservedUsd }))
    } finally { globalThis.fetch = realFetch }
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 🔴 🔴 차단 관문을 실제 runner 경로로 돌린다')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **소스 문자열이 아니라 운영 함수를 부른다** (2026-09-21).
   *
   *    앞판 ④ 는 `cli` 에 `PENDING` 이라는 글자가 있는지만 봤다 —
   *    러너가 `status: 'APPROVED'` 로 바뀌어도 그 글자는 주석에 남아 통과한다.
   *    여기서는 **적재 경로 정본**(`runEnqueuePipeline` · `planEnqueue` ·
   *    `checkCommentCandidate`)을 그대로 실행하고 반환값을 본다.
   *    가짜인 것은 provider 와 DB writer 뿐이다.
   */
  /** provider 를 몇 번 불렀는지 세는 가짜 — 🔴 네트워크 0 */
  const runPipeline = async (
    targets: readonly PipelineTarget[],
    opts: { write?: boolean; gate?: () => PipelineGateResult } = {},
  ) => {
    let calls = 0
    const written: { targetPostId: string; status: string }[] = []
    const res = await runEnqueuePipeline({
      selection: { status: 'confirmed', winner: 'gemini-3.7-flash' },
      canon: CANON,
      targets,
      provider: async () => { calls += 1; return { ok: true, text: '저도 그 무렵엔 그랬어요', errorCode: null } },
      gate: opts.gate ?? (() => allPass),
      ...(opts.write === true
        ? {
          writer: async ({ input }) => {
            // 🔴 운영 writer 가 쓰는 두 값을 그대로 기록한다
            written.push({ targetPostId: input.post.id, status: 'PENDING' })
            return { created: true, reason: 'PENDING 적재' }
          },
        }
        : {}),
      limit: 5, providerCallLimit: 5, preflightOk: true,
    })
    return { res, calls, written }
  }

  // ── 회원(USER) 글 ──
  {
    const { res, calls } = await runPipeline([targetOf({ author: AUTHOR_MEMBER })])
    check('🔴 🔴 **회원이 쓴 글은 provider 앞에서 막힌다 — 호출 0**',
      calls === 0
      && res.providerCalls === 0
      && res.outcomes.length === 1
      && res.outcomes[0]!.step === 'AUTHOR_BLOCKED',
      `calls=${calls} step=${res.outcomes[0]?.step ?? '없음'}`)
  }

  // ── 대상 글 id 가 없다 ──
  {
    const { res, written } = await runPipeline([targetOf({ postId: '' })], { write: true })
    const o = res.outcomes[0]
    check('🔴 🔴 **대상 글 id 가 비면 적재하지 않는다 — `targetPostId` 는 nullable 이다**',
      res.created === 0
      && written.length === 0
      && o?.step === 'ENQUEUE_BLOCKED'
      && (o.plan?.blocks ?? []).some((b) => b.code === 'POST_ID_MISSING'),
      `step=${o?.step ?? '없음'} created=${res.created}`)
  }

  // ── 같은 글에 같은 Persona 가 또 ──
  {
    const { res, written } = await runPipeline(
      [targetOf({ personaAlreadyOnPost: true })], { write: true })
    const o = res.outcomes[0]
    check('🔴 🔴 **같은 글에 같은 Persona 는 두 번 달지 않는다**',
      res.created === 0
      && written.length === 0
      && o?.step === 'ENQUEUE_BLOCKED'
      && (o.plan?.blocks ?? []).some((b) => b.code === 'PERSONA_ALREADY_ON_POST'),
      `step=${o?.step ?? '없음'}`)
  }
  {
    // 🔴 모르면 막는다 — `null` 을 `false` 로 보정하지 않는다
    const { res } = await runPipeline(
      [targetOf({ personaAlreadyOnPost: null })], { write: true })
    check('🔴 **이미 달았는지 읽지 못하면 막는다(fail-closed)**',
      res.created === 0
      && (res.outcomes[0]?.plan?.blocks ?? []).some((b) => b.code === 'PERSONA_ALREADY_ON_POST'))
  }

  // ── 생활사와 충돌하는 1인칭 경험 ──
  {
    /**
     * 🔴 실측 사례를 그대로 쓴다 — P05 는 `menopauseStatus='전'` 인데
     *    후보가 "작년에 그거 겪었어요" 라고 말했다. ⑦ 이 잡아야 한다.
     */
    const verdict = checkCommentCandidate({
      personaCode: 'P05',
      text: '저도 작년에 그거 다 겪었어요. 지나가더라고요.',
      sourceTexts: ['새벽에 자꾸 깨서 잠을 설쳐요. 다들 어떠신가요'],
      identity: { menopauseStatus: '전' },
      personaGrounding: '아직 그 시기를 겪지 않았다',
    })
    const seven = verdict.gates.find((g) => g.gate === '⑦')
    check('🔴 🔴 **생활사와 충돌하는 1인칭 경험은 ⑦ 이 잡는다**',
      seven !== undefined
      && seven.outcome !== 'pass'
      && seven.outcome !== 'notRun'
      && verdict.status !== 'pass',
      `⑦=${seven?.outcome ?? '없음'} status=${verdict.status}`)

    // 🔴 그 판정을 적재 경로에 넣으면 실제로 막힌다 — 관문 결과가 버려지지 않는다
    const { res, written } = await runPipeline([targetOf()], {
      write: true,
      gate: () => ({
        gates: [...verdict.gates], gateStatus: verdict.status, isBootstrap: false,
      }),
    })
    check('🔴 🔴 **⑦ 이 걸린 후보는 Queue 에 들어가지 않는다**',
      res.created === 0 && written.length === 0
      && res.outcomes[0]?.step === 'ENQUEUE_BLOCKED',
      `step=${res.outcomes[0]?.step ?? '없음'}`)
  }

  // ── 실패·사용량 미상은 아무것도 만들지 않는다 ──
  {
    let calls = 0
    const written: string[] = []
    const res = await runEnqueuePipeline({
      selection: { status: 'confirmed', winner: 'gemini-3.7-flash' },
      canon: CANON,
      targets: [targetOf()],
      provider: async () => { calls += 1; return { ok: false, text: null, errorCode: 'SETTLE_NOT_RECORDED' } },
      gate: () => allPass,
      writer: async () => { written.push('x'); return { created: true, reason: '' } },
      limit: 5, providerCallLimit: 5, preflightOk: true,
    })
    check('🔴 🔴 **정산이 기록되지 않으면 후보도 만들어지지 않는다**',
      calls === 1 && res.created === 0 && written.length === 0
      && res.outcomes[0]?.step === 'PROVIDER_FAILED'
      && res.outcomes[0]?.reason === 'SETTLE_NOT_RECORDED',
      `step=${res.outcomes[0]?.step ?? '없음'}`)
  }

  // ── 통과한 후보가 실제로 어떤 상태로 적재되는가 ──
  {
    const { res, written } = await runPipeline([targetOf()], { write: true })
    const plan = res.outcomes[0]?.plan
    check('🔴 🔴 **9관문을 통과해도 상태는 `PENDING` 하나뿐 — 자동 승인·공개 0**',
      res.created === 1
      && plan?.ok === true
      && plan.status === 'PENDING'
      && (ENQUEUE_STATUS as string) === 'PENDING'
      && written.length === 1
      && written[0]!.status === 'PENDING'
      && written[0]!.targetPostId === 'post-1',
      `status=${plan?.status ?? '없음'} created=${res.created}`)

    // 🔴 이 경로 어디에도 Comment 를 만드는 자리가 없다 — 공개는 다른 층이 한다
    check('🔴 **적재 경로는 댓글을 공개하지 않는다**',
      !/prisma\.comment\.create/.test(cli))
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 🔴 🔴 실제 세션 → 실제 어댑터 → 파이프라인 연결')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **세 층을 끊지 않고 잇는다** (2026-09-21).
   *
   *    ③ 은 세션까지, ④ 는 파이프라인까지만 봤다. 그 사이에 있는
   *    **러너의 provider 어댑터**는 어느 쪽도 보지 않았고, 거기 구멍이 둘 있었다.
   *
   *    · 사용량을 못 읽은 건: 세션은 `usageUnknown` · `settledUsd: null` 을 주는데
   *      **줄은 적혔으므로** `settlementRecorded` 가 `true` 다.
   *      러너는 그 둘만 봐서 **얼마인지 모르는 건을 정산된 것으로** 취급했다.
   *    · 상한에 닿아 잘린 건: provider 가 `ok: true` 를 준다.
   *      잘린 JSON 이 우연히 파싱되면 **문장이 끊긴 댓글**이 후보가 됐다.
   *
   * 🔴 여기서는 진짜 `SupplyLlmSession` 을 만들고, 러너가 쓰는 **그 판정 함수**
   *    (`judgeCommentCall`)를 그대로 `runEnqueuePipeline` 의 provider 로 꽂는다.
   *    가짜인 것은 `fetch` 와 DB writer 뿐이다.
   */
  const realFetch = globalThis.fetch

  type Shape = {
    /** 🔴 사용량 자체를 주지 않는다 — `usageUnknown` 이 된다 */
    omitUsage?: boolean
    finishReason?: string
    outputTokens?: number
    /** 모델이 돌려주는 본문. 🔴 기본은 **파싱되는** 정상 JSON 이다 */
    body?: string
    /** 🔴 정산 줄 쓰기를 실패시킨다 — 예약은 적히고 정산만 못 적는다 */
    failSettleWrite?: boolean
  }

  const connect = async (shape: Shape) => {
    const inTokens = 900
    const outTokens = shape.outputTokens ?? 300
    const body = shape.body ?? '{"comment":"저도 그 무렵엔 새벽마다 깼어요"}'
    const dir = mkdtempSync(join(tmpdir(), 'soran-comment-wire-'))
    const day = new Date('2026-09-21T03:00:00.000Z')
    const session = new SupplyLlmSession({
      runId: 'comment-wire', dir,
      limits: limitsFromEnv({
        [BUDGET_ENV.dailyUsd]: '0.02', [BUDGET_ENV.runRequestCap]: '1',
        [BUDGET_ENV.headroomMultiplier]: '1.5',
      } as NodeJS.ProcessEnv),
      now: () => day,
      ...(shape.failSettleWrite === true
        ? {
          io: {
            ...REAL_LEDGER_IO,
            append: (path: string, entry: LedgerEntry) => {
              /**
               * 🔴 **유료 요청의 정산 줄만** 실패시킨다.
               *    무료 사전 계산(`countTokens`)까지 막으면 요청이 나가기도 전에
               *    `LEDGER_ERROR` 로 멈춘다 — 그것은 다른 사고다.
               */
              const isSettleLine = entry.stage === 'commentGen'
                && (entry.status === 'settled' || entry.status === 'usageUnknown')
              if (isSettleLine) throw new Error('시험: 정산 줄 쓰기 실패')
              REAL_LEDGER_IO.append(path, entry)
            },
          },
        }
        : {}),
    })
    process.env.GEMINI_API_KEY = 'test-key-not-real'
    let genCalls = 0
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url)
      if (u.includes(':countTokens') || u.includes('/count_tokens')) {
        return new Response(JSON.stringify({ totalTokens: inTokens }), {
          status: 200, headers: { 'content-type': 'application/json' },
        })
      }
      genCalls += 1
      return new Response(JSON.stringify({
        candidates: [{
          content: { parts: [{ text: body }] },
          finishReason: shape.finishReason ?? 'STOP',
        }],
        ...(shape.omitUsage === true ? {} : {
          usageMetadata: {
            promptTokenCount: inTokens, candidatesTokenCount: outTokens,
            thoughtsTokenCount: 7, totalTokenCount: inTokens + outTokens + 7,
          },
        }),
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof globalThis.fetch

    const written: { targetPostId: string; status: string }[] = []
    let adapter: CommentCallOutcome | null = null
    /** 🔴 어댑터가 받은 **세션 결과 원본** — 계약을 직접 확인하려고 남긴다 */
    let lastCall: SupplyCallResult | null = null
    try {
      const res = await runEnqueuePipeline({
        selection: { status: 'confirmed', winner: 'gemini-3.7-flash' },
        canon: CANON,
        targets: [targetOf()],
        /**
         * 🔴 **러너의 어댑터 꼬리를 그대로 쓴다.** 세션 결과를 후보로 삼아도 되는지는
         *    `judgeCommentCall` 한 곳이 정한다 — 검사용으로 다시 적지 않는다.
         */
        provider: async () => {
          const call = lastCall = await session.call({
            stage: 'commentGen', model: 'gemini-3.7-flash',
            systemPrompt: '시험 지시', userPayload: '시험 입력',
            maxOutputTokens: MAX_OUTPUT_TOKENS, timeoutMs: 5_000,
          })
          adapter = judgeCommentCall(call)
          return adapter
        },
        gate: () => allPass,
        writer: async ({ input }) => {
          written.push({ targetPostId: input.post.id, status: 'PENDING' })
          return { created: true, reason: 'PENDING 적재' }
        },
        limit: 5, providerCallLimit: 5, preflightOk: true,
      })
      const read = readLedgerDay(ledgerPathOf(dir, '2026-09-21'))
      return {
        res, written, genCalls,
        adapter: adapter as CommentCallOutcome | null,
        call: lastCall as SupplyCallResult | null,
        entries: read.ok ? read.entries : [],
        tally: session.tally,
      }
    } finally { globalThis.fetch = realFetch }
  }

  // ── 정상 정산 1건 → PENDING 1건 ──
  {
    const r = await connect({})
    const settled = r.entries.filter((e) => e.stage === 'commentGen' && e.status === 'settled')
    check('🔴 🔴 **정상 정산 1건 → `PENDING` 후보 1건**',
      r.genCalls === 1
      && r.adapter?.ok === true
      && settled.length === 1 && settled[0]!.settledUsd !== null
      && r.res.created === 1
      && r.written.length === 1 && r.written[0]!.status === 'PENDING'
      && r.res.outcomes[0]!.step === 'ENQUEUED',
      JSON.stringify({ gen: r.genCalls, adapter: r.adapter,
        created: r.res.created, step: r.res.outcomes[0]?.step }))
  }

  // ── 사용량 미상 → 후보 0 ──
  {
    const r = await connect({ omitUsage: true })
    const unknown = r.entries.filter((e) => e.status === 'usageUnknown')
    check('🔴 🔴 **사용량 미상 → writer 0 · `PENDING` 0**',
      // 🔴 요청은 실제로 나갔고 파싱도 되는 응답이다 — 그래도 후보가 되지 않는다
      r.genCalls === 1
      && unknown.length === 1
      && r.adapter?.ok === false
      && r.adapter.errorCode === SETTLE_AMOUNT_UNKNOWN
      /**
       * 🔴 **여기가 앞판의 구멍이다.** 세션은 `ok: true` 를 주고
       *    `settlementRecorded` 도 `true` 다 — 줄은 적혔기 때문이다.
       *    그 둘만 보던 러너는 이 건을 후보로 만들었다.
       */
      && r.call?.ok === true && r.call.settlementRecorded === true
      && r.call.settledUsd === null
      && r.written.length === 0 && r.res.created === 0
      && r.res.outcomes[0]!.step === 'PROVIDER_FAILED'
      && r.tally.usageUnknown === 1,
      JSON.stringify({ gen: r.genCalls, adapter: r.adapter,
        written: r.written.length, step: r.res.outcomes[0]?.step }))

    // 🔴 "줄은 적혔다" 를 "정산됐다" 로 읽지 않는다 — 이것이 정확히 앞판의 구멍이었다
    check('🔴 🔴 **줄은 적혔지만 금액은 `null` 이다 — 둘을 구분한다**',
      r.entries.some((e) => e.status === 'usageUnknown' && e.settledUsd === null))
  }

  // ── 정산 기록 실패 → 후보 0 ──
  {
    const r = await connect({ failSettleWrite: true })
    check('🔴 🔴 **정산 기록 실패 → writer 0 · `PENDING` 0**',
      r.genCalls === 1
      && r.adapter?.ok === false
      // 🔴 요청은 나갔다. 막는 근거는 "장부에 못 적었다" 하나다
      && r.adapter.errorCode === SETTLE_NOT_RECORDED
      && r.written.length === 0 && r.res.created === 0
      && r.res.outcomes[0]!.step === 'PROVIDER_FAILED'
      && r.tally.settleHeld === 1,
      JSON.stringify({ adapter: r.adapter, written: r.written.length,
        held: r.tally.settleHeld }))

    /**
     * 🔴 **세션 계약을 직접 못박는다** (2026-09-21).
     *
     *    `judgeCommentCall` 의 `settlementRecorded` 줄은 **오늘 도달하지 않는다** —
     *    세션이 정산 줄을 못 적으면 스스로 `ok: false` 로 뒤집기 때문이다.
     *    그 줄을 지워도 검사가 걸리지 않는 것을 돌연변이로 확인했다.
     *    지우지 않고 남기는 대신, 기대고 있는 **그 계약**을 여기서 확인한다 —
     *    계약이 바뀌면 이 줄이 먼저 깨진다.
     */
    check('🔴 🔴 **세션은 정산을 못 적으면 `ok` 를 내주지 않는다**',
      r.call !== null && r.call.ok === false
      && r.call.settlementRecorded === false && r.call.settledUsd === null,
      JSON.stringify({ ok: r.call?.ok, recorded: r.call?.settlementRecorded }))
  }

  // ── 잘림 → 후보 0 ──
  {
    /**
     * 🔴 **파싱되는 잘린 응답**을 준다. 종료 사유가 `MAX_TOKENS` 이고 사용량도 정상이라
     *    세션은 정상 정산한다 — 막는 근거는 오직 "잘렸다" 하나여야 한다.
     */
    const r = await connect({
      finishReason: 'MAX_TOKENS',
      body: '{"comment":"저도 그 무렵엔 새벽마다 깨서"}',
    })
    const settled = r.entries.filter((e) => e.stage === 'commentGen' && e.status === 'settled')
    check('🔴 🔴 **잘린 응답 → writer 0 · `PENDING` 0 (파싱돼도 후보가 아니다)**',
      r.genCalls === 1
      // 🔴 정산은 정상이다 — 돈은 나갔고 장부에 적혔다
      && settled.length === 1 && settled[0]!.settledUsd !== null
      && r.adapter?.ok === false
      && r.adapter.errorCode === MAX_TOKENS_REACHED
      && r.written.length === 0 && r.res.created === 0
      && r.res.outcomes[0]!.step === 'PROVIDER_FAILED',
      JSON.stringify({ adapter: r.adapter, written: r.written.length,
        settled: settled.length }))
  }
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 네트워크 0 · 실제 provider 0 · DB 0 · 운영 env 0\n')
if (fail > 0) process.exit(1)
