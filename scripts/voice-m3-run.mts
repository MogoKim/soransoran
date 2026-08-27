#!/usr/bin/env tsx
/**
 * VE-M3 실험 실행기 (VE-M3-3)
 *
 * 정본: docs/operations/2026-08-27-voice-m3-model-selection-criteria.md
 *       docs/operations/2026-08-27-voice-m3-llm-experiment-contract.md
 *
 * 🔴 dry-run 이 기본이다. 유료 호출은 게이트 10개를 전부 통과해야 한다.
 *    이 저장소에서 처음으로 **돈이 나갈 수 있는 명령**이다.
 *
 * 🔴 **성공한** 캐시가 있으면 부르지 않는다
 *    cacheKey 8요소가 같고 status='succeeded' 면 재호출하지 않는다. 캐시 미스 하나가 돈이다.
 *    반대로 **실패한 캐시는 다시 부른다** — 실패는 답이 아니라 시도의 기록이다(2026-08-27).
 *
 * 🔴 저장 전에 원문 유출을 대조한다
 *    LLM 출력에 원문 · 댓글이 20자 이상 연속으로 있으면 **저장하지 않고 skipped 처리**한다.
 *
 * 🔴 두 가지 모드가 있다 (`--mode`, 기본 `sample`)
 *    `sample` : 층화 표본. 모델 비교용. **매 실행 같은 N건**
 *    `full`   : 이미 성공한 건 제외 + id 오름차순 다음 N건. 전량 확대용
 *
 * 사용법
 *   npm run voice:m3-run -- --stage=stage1 --model=gpt-5-nano --limit=30
 *     → dry-run. 표본 · 토큰 · 비용 · cap 판정만. API 0 · DB write 0
 *
 *   npm run voice:m3-run -- --stage=stage1 --model=gpt-5-nano --limit=30 \
 *       --apply --confirm-paid-call
 *     → 🔴 실제 유료 호출. 창업자 승인 후에만.
 */
import pg from 'pg'
import { PrismaClient, Prisma } from '@prisma/client'
import { loadUnaoReadonlyUrl, maskConnectionString, topCommentsToText } from './lib/voice-unao-readonly.mjs'
import { toCommentSignals, summarizeCommentSignals } from './lib/voice-comment-signals.mjs'
import { buildPromptPayload, buildInstruction, formatSummaryLine } from './lib/voice-m3-prompt.mjs'
import {
  M3_TASK_VERSION, M3_PROMPT_VERSION, M3_OUTPUT_SCHEMA_VERSION,
  M3_CAPS, M3_EXPERIMENT_STAGES, M3_MODEL_CANDIDATES,
  buildCacheKey, estimateCost, checkCaps, pricingFor, assertNoSourceLeak,
  M3_FORBIDDEN_ADDRESS_TERMS,
  maxOutputTokensFor, outputTokenEstimateFor, outputTokenPolicyFor,
  classifyJsonFailure, formatDiagnostics, type JsonFailureKind,
} from './lib/voice-m3-contract.mjs'
import {
  selectStratifiedSample, validateSample, formatSampleRow, SAMPLE_AXES,
  selectFullModeBatch, describeRows,
  type SampleCandidate,
} from './lib/voice-m3-sample.mjs'
import { keyStatus, callProvider } from './lib/voice-m3-provider.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const argv = process.argv
const arg = (n: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}
const APPLY = argv.includes('--apply')
const CONFIRM_PAID = argv.includes('--confirm-paid-call')
const STAGE = arg('stage')
const MODEL = arg('model')
const LIMIT_RAW = arg('limit')
/**
 * 🔴 **기본은 `sample` 이다.** `full` 이 기본이면 실험용 명령 하나가
 *    전량 경로로 새어 나간다 — 기본값은 늘 좁은 쪽이어야 한다.
 *
 * - `sample` : 층화 표본. 모델 비교 · 실험용. 매 실행 같은 N건
 * - `full`   : 이미 성공한 건 제외 + id 오름차순 다음 N건. 전량 확대용
 */
const MODE = arg('mode') ?? 'sample'

const STAGE_SIZE: Record<string, number> = {
  stage1: M3_EXPERIMENT_STAGES.stage1PerModel,
  stage2: M3_EXPERIMENT_STAGES.stage2PerModel,
  stage3: M3_EXPERIMENT_STAGES.stage3Single,
}

/** 🔴 유료 호출 게이트. 하나라도 없으면 실행하지 않는다 */
function paidCallGate(model: string | undefined, stage: string | undefined, limit: number): {
  ok: boolean
  blocked: string[]
} {
  const blocked: string[] = []
  if (!APPLY) blocked.push('--apply 가 없다')
  if (!CONFIRM_PAID) blocked.push('--confirm-paid-call 이 없다')
  if (!model) blocked.push('--model 이 없다')
  if (!stage) blocked.push('--stage 가 없다')
  if (limit > M3_CAPS.itemLimit) blocked.push(`--limit ${limit} 이 itemLimit ${M3_CAPS.itemLimit} 초과`)
  if (M3_CAPS.dollarCap > 5) blocked.push(`dollarCap $${M3_CAPS.dollarCap} 이 상한 $5 초과`)
  if (M3_CAPS.tokenCap > 500_000) blocked.push(`tokenCap ${M3_CAPS.tokenCap} 이 상한 500000 초과`)
  if (model) {
    try { pricingFor(model) } catch { blocked.push(`${model} 의 공식 단가가 없다`) }
    // 🔴 출력 상한이 등록되지 않은 모델은 부르지 않는다.
    //    1,000 사고(2026-08-27)가 이름만 바꿔 되풀이되는 것을 막는 자리다.
    try { maxOutputTokensFor(model) } catch { blocked.push(`${model} 의 출력 토큰 정책이 없다`) }
    if (!keyStatus(model).present) blocked.push(`${keyStatus(model).envName} 가 없다`)
  }
  return { ok: blocked.length === 0, blocked }
}

async function main(): Promise<void> {
  await loadEnvLocal()

  if (!['sample', 'full'].includes(MODE)) {
    throw new Error(`--mode 는 sample · full 중 하나여야 한다: ${MODE}`)
  }
  if (STAGE && !STAGE_SIZE[STAGE]) {
    throw new Error(`--stage 는 ${Object.keys(STAGE_SIZE).join(' · ')} 중 하나여야 한다: ${STAGE}`)
  }
  const defaultSize = STAGE ? STAGE_SIZE[STAGE] : M3_EXPERIMENT_STAGES.stage1PerModel
  const LIMIT = LIMIT_RAW === undefined ? Math.min(defaultSize, M3_CAPS.itemLimit) : Number(LIMIT_RAW)
  if (!Number.isInteger(LIMIT) || LIMIT < 1) {
    throw new Error(`--limit 은 1 이상 정수여야 한다: ${LIMIT_RAW}`)
  }
  if (LIMIT > M3_CAPS.itemLimit) {
    throw new Error(
      `--limit 이 itemLimit 을 넘는다: ${LIMIT} > ${M3_CAPS.itemLimit}\n` +
        '  itemLimit 은 tokenCap 이 정한다 — 1건당 약 5,468 tok 이라 한 실행 상한이 91건이다.\n' +
        '  2차 100건 · 3차 300건은 실행을 쪼개서 돈다(50×2 · 50×6).',
    )
  }

  const gate = paidCallGate(MODEL, STAGE, LIMIT)
  const willCallProvider = APPLY && CONFIRM_PAID

  // 🔴 유료 의사가 있는데 게이트를 통과하지 못하면 **아무것도 하지 않고 멈춘다**
  if (willCallProvider && !gate.ok) {
    console.error('\n❌ 유료 호출 게이트를 통과하지 못했다. 아무것도 실행하지 않았다.\n')
    for (const b of gate.blocked) console.error(`   · ${b}`)
    console.error('')
    process.exit(1)
  }

  const pricing = MODEL ? pricingFor(MODEL) : undefined
  // 🔴 상한은 모델이 정한다. 하드코딩 1,000 이 1차 실행을 통째로 태웠다(2026-08-27)
  const tokenPolicy = MODEL ? outputTokenPolicyFor(MODEL) : undefined
  const modelForKey = MODEL ?? 'undetermined'
  const unaoUrl = loadUnaoReadonlyUrl()

  console.log('\nVoice — VE-M3 실험 실행기')
  console.log(`  우나어 읽기: ${maskConnectionString(unaoUrl)}`)
  console.log(`  stage=${STAGE ?? '(미지정)'} · model=${modelForKey} · limit=${LIMIT}`)
  if (pricing) {
    console.log(`  단가 $${pricing.inputPerMTok}/$${pricing.outputPerMTok} per MTok · 출처 ${pricing.source} (${pricing.checkedAt})`)
  }
  if (tokenPolicy) {
    console.log(
      `  출력 상한 ${tokenPolicy.maxOutputTokens} tok` +
        ` · reasoning ${tokenPolicy.reasoning ? '포함' : '없음'}` +
        ` · 추정 ${tokenPolicy.estimatedOutputTokens} tok/건`,
    )
    console.log(`     근거: ${tokenPolicy.rationale}`)
  }
  if (MODEL) {
    const k = keyStatus(MODEL)
    // 🔴 존재 여부만. 값 · prefix · 길이 어느 것도 찍지 않는다
    console.log(`  ${k.envName}: ${k.present ? 'OK' : '없음'}`)
  }
  console.log(
    willCallProvider
      ? '  🔴🔴 --apply --confirm-paid-call : 실제 유료 호출을 한다'
      : '  🔍 dry-run — 표본 · 토큰 · 비용 · cap 만. API 0 · DB write 0',
  )
  if (!willCallProvider) {
    console.log(`  유료 호출 게이트: ${gate.ok ? '통과 가능' : `${gate.blocked.length}건 미충족`}`)
    for (const b of gate.blocked) console.log(`     · ${b}`)
  }
  console.log('  🔴 원문 전문을 출력하지 않는다\n')

  const unao = new pg.Client({ connectionString: unaoUrl, ssl: { rejectUnauthorized: false } })
  await unao.connect()
  const prisma = new PrismaClient()

  try {
    // ── 표본 선정 (읽기만) ─────────────────────────────
    const refIds = new Set(
      (await prisma.voiceJudgment.findMany({ select: { voiceSourceId: true } })).map((j) => j.voiceSourceId),
    )
    const candidates: SampleCandidate[] = []
    for (let skip = 0; ; skip += 1500) {
      const batch = await prisma.voiceSource.findMany({
        skip, take: 1500, orderBy: { id: 'asc' },
        select: {
          id: true, sourceRef: true, sourceSite: true,
          contentLength: true, commentCount: true, legacyLabels: true,
        },
      })
      if (batch.length === 0) break
      const ids = batch.map((b) => b.id)
      const [derived, signals] = await Promise.all([
        prisma.voiceDerived.findMany({
          where: { voiceSourceId: { in: ids } },
          select: { voiceSourceId: true, communityRegister: true, ruleVersion: true },
        }),
        prisma.voiceCommentSignal.findMany({
          where: { voiceSourceId: { in: ids } },
          select: { voiceSourceId: true, reactionType: true, truncated: true },
        }),
      ])
      type CR = { sourceSpecific?: unknown[]; targetDescriptorRisk?: string[] }
      const crBy = new Map(derived.map((d) => [d.voiceSourceId, d.communityRegister as unknown as CR | null]))
      const agg = new Map<string, { total: number; other: number; trunc: number }>()
      for (const s of signals) {
        const a = agg.get(s.voiceSourceId) ?? { total: 0, other: 0, trunc: 0 }
        a.total += 1
        if (s.reactionType === 'other') a.other += 1
        if (s.truncated) a.trunc += 1
        agg.set(s.voiceSourceId, a)
      }
      for (const b of batch) {
        const a = agg.get(b.id) ?? { total: 0, other: 0, trunc: 0 }
        const cr = crBy.get(b.id) ?? null
        candidates.push({
          id: b.id, sourceRef: b.sourceRef, sourceSite: b.sourceSite,
          contentLength: b.contentLength, commentCount: b.commentCount,
          legacyLabels: b.legacyLabels as Record<string, unknown> | null,
          sourceSpecificCount: cr?.sourceSpecific?.length ?? 0,
          targetDescriptorCount: cr?.targetDescriptorRisk?.length ?? 0,
          referenced: refIds.has(b.id),
          commentSignalTotal: a.total, otherReactionCount: a.other, truncatedCount: a.trunc,
        })
      }
    }

    // 🔴 전량(`full`)과 실험(`sample`)은 **다른 질문에 답한다.**
    //    sample: "축을 고르게 덮는 N건은 무엇인가" — 매 실행 같은 답
    //    full  : "아직 답을 못 얻은 것 중 다음 N건은 무엇인가" — 실행마다 다른 답
    let sample: { rows: ReturnType<typeof selectStratifiedSample>['rows'] } & Omit<ReturnType<typeof selectStratifiedSample>, 'rows'>
    let fullInfo: { remaining: number; excluded: number } | null = null
    if (MODE === 'full') {
      // 🔴 **성공한 것만** 제외한다. failed · skipped 는 남아서 재시도된다
      const doneRefs = new Set(
        (await prisma.voiceM3Cache.findMany({
          where: { model: modelForKey, status: 'succeeded' }, select: { sourceRef: true },
        })).map((c) => c.sourceRef),
      )
      const picked = selectFullModeBatch(candidates, doneRefs, LIMIT)
      sample = { rows: picked.rows, ...describeRows(picked.rows) }
      fullInfo = { remaining: picked.remaining, excluded: picked.excluded }
    } else {
      sample = selectStratifiedSample(candidates, LIMIT)
    }
    // 🔴 축 커버리지 검사는 **층화 표본에만** 적용한다.
    //    전량 batch 는 축을 채우려 고르지 않으므로 빈 축이 정상이다
    const check = MODE === 'full' ? { ok: true, problems: [] } : validateSample(sample, LIMIT)

    if (fullInfo) {
      console.log(`  🔁 전량 모드 (mode=full · ${modelForKey})`)
      console.log(`     전체 후보          ${candidates.length.toLocaleString()}건`)
      console.log(`     수집 상한 잘림 제외  ${fullInfo.excluded.toLocaleString()}건 (3,000자에서 끊긴 글 — 흐름 판정이 오염된다)`)
      console.log(`     ✅ 이미 성공(제외)   ${(candidates.length - fullInfo.excluded - fullInfo.remaining).toLocaleString()}건`)
      console.log(`     🔁 남은 대상        ${fullInfo.remaining.toLocaleString()}건`)
      console.log(`     이번 batch         ${sample.rows.length}건 · 남은 batch 약 ${Math.ceil(fullInfo.remaining / LIMIT)}회\n`)
    }
    console.log(`  표본 ${sample.rows.length}건 (${MODE === 'full' ? `남은 ${fullInfo?.remaining.toLocaleString()}건 중 id 오름차순 앞에서` : `후보 ${candidates.length}건에서 층화 선정`} · 난수 없음)`)
    for (const [i, r] of sample.rows.entries()) console.log(formatSampleRow(r, i))

    console.log('\n  축 커버리지')
    const missing = SAMPLE_AXES.filter((a) => sample.coverage[a] === 0)
    console.log(`     ${SAMPLE_AXES.map((a) => `${a}=${sample.coverage[a]}`).join(' · ')}`)
    console.log(`     비어 있는 축 ${missing.length}개 ${missing.length === 0 ? '✅' : `🔴 ${missing.join(',')}`}`)
    console.log(`     사이트 분산 ${Object.entries(sample.siteSpread).map(([k, v]) => `${k.replace('navercafe:', '')}=${v}`).join(' · ')}`)
    if (!check.ok) {
      console.log('\n  🔴 표본이 조건을 만족하지 못한다')
      for (const p of check.problems) console.log(`     · ${p}`)
    }

    // ── payload · cacheKey · 비용 (읽기만) ─────────────
    const refs = sample.rows.map((r) => r.sourceRef)
    const res = await unao.query(
      'SELECT id, content, "topComments" FROM "CafePost" WHERE id = ANY($1)', [refs],
    )
    const byRef = new Map(res.rows.map((r: Record<string, unknown>) => [String(r.id), r]))
    const ruleVersionById = new Map(
      (await prisma.voiceDerived.findMany({
        where: { voiceSourceId: { in: sample.rows.map((r) => r.id) } },
        select: { voiceSourceId: true, ruleVersion: true },
      })).map((d) => [d.voiceSourceId, d.ruleVersion]),
    )

    type Prepared = {
      row: (typeof sample.rows)[number]
      cacheKey: string
      payloadText: string
      payloadChars: number
      sourceTexts: string[]
    }
    const prepared: Prepared[] = []
    let totalChars = 0

    for (const row of sample.rows) {
      const raw = byRef.get(row.sourceRef)
      if (!raw) continue
      const body = typeof raw.content === 'string' ? raw.content : ''
      if (!body) continue
      const commentsText = topCommentsToText(raw.topComments)
      const comments = commentsText ? commentsText.split('\n').filter(Boolean) : []
      const derived = await prisma.voiceDerived.findFirst({
        where: { voiceSourceId: row.id }, select: {
          typingArtifacts: true, punctuationHabit: true, spacingVariance: true,
          mobileInputTrace: true, communityRegister: true, artifactFrequency: true,
        },
      })
      const reaction = summarizeCommentSignals(
        toCommentSignals(raw.topComments, { authorSalt: 'soransoran-voice-v1', capturedAt: new Date(0) }),
      )
      const { payload, summary } = buildPromptPayload({
        sourceRef: row.sourceRef, body, comments,
        derivedSignals: (derived ?? {}) as Record<string, unknown>,
        legacyLabels: row.legacyLabels ?? {},
        commentSignalSummary: reaction.byReaction,
      })
      totalChars += summary.payloadChars
      prepared.push({
        row, payloadText: JSON.stringify(payload), payloadChars: summary.payloadChars,
        sourceTexts: [body, commentsText],
        cacheKey: buildCacheKey({
          origin: 'unao_cafe', sourceRef: row.sourceRef,
          contentHash: null,
          ruleVersion: ruleVersionById.get(row.id) ?? 'none',
          taskVersion: M3_TASK_VERSION, model: modelForKey,
          promptVersion: M3_PROMPT_VERSION, outputSchemaVersion: M3_OUTPUT_SCHEMA_VERSION,
        }),
      })
    }

    const uniqueKeys = new Set(prepared.map((p) => p.cacheKey))
    // 🔴 출력 추정을 모델에서 가져온다. reasoning 토큰도 출력으로 과금되므로
    //    reasoning 모델은 상한 그대로를 최악값으로 잡는다(계약 §E 보정 2026-08-27)
    const outPerItem = MODEL ? outputTokenEstimateFor(MODEL) : undefined
    const cost = estimateCost(totalChars, prepared.length, pricing, outPerItem)
    const caps = checkCaps(cost, prepared.length)

    // 🔴 이미 성공한 캐시는 부르지 않는다. **실패한 캐시는 다시 부른다**
    const existing = await prisma.voiceM3Cache.findMany({
      where: { cacheKey: { in: prepared.map((p) => p.cacheKey) } },
      select: { cacheKey: true, status: true },
    })
    const reusable = existing.filter((c) => c.status === 'succeeded').length
    const retryable = existing.length - reusable

    console.log('\n  cacheKey · 비용')
    console.log(`     cacheKey 고유    ${uniqueKeys.size}/${prepared.length} ${uniqueKeys.size === prepared.length ? '(1건 1키)' : '🔴 중복'}`)
    console.log(`     기존 캐시        재사용 ${reusable}건(succeeded) · 재시도 ${retryable}건(failed·skipped) · 신규 ${prepared.length - existing.length}건`)
    console.log(`     입력 토큰(추정)   ${cost.estimatedInputTokens.toLocaleString()} / tokenCap ${M3_CAPS.tokenCap.toLocaleString()}`)
    console.log(`     출력 토큰(추정)   ${cost.estimatedOutputTokens.toLocaleString()}${outPerItem ? ` (${outPerItem}/건)` : ''}`)
    console.log(`     합계 토큰(추정)   ${cost.estimatedTotalTokens.toLocaleString()}`)
    console.log(`     예상 비용         ${cost.estimatedCostUsd === null ? '🔴 산출 불가 (공식 단가 미확정)' : `$${cost.estimatedCostUsd}`} / dollarCap $${M3_CAPS.dollarCap}`)
    console.log(`     cap 판정          ${caps.ok ? '✅ 통과' : '🔴 ' + caps.violations.join(' / ')}`)

    if (!willCallProvider) {
      console.log('\n  🔍 dry-run 이었다.')
      console.log('     API 호출 0 · DB write 0 · 비용 0원')
      console.log('     유료 실행: --apply --confirm-paid-call 을 함께 준다 (창업자 승인 후)\n')
      return
    }

    // ══════════════════════════════════════════════════
    // 🔴 여기부터 돈이 나간다. 게이트는 위에서 이미 통과했다.
    // ══════════════════════════════════════════════════
    if (!caps.ok) {
      console.error('\n❌ cap 판정을 통과하지 못했다. 호출하지 않았다.\n')
      process.exit(1)
    }

    const run = await prisma.voiceM3Run.create({
      data: {
        status: 'running',
        taskVersion: M3_TASK_VERSION, model: modelForKey,
        promptVersion: M3_PROMPT_VERSION, outputSchemaVersion: M3_OUTPUT_SCHEMA_VERSION,
        itemLimit: LIMIT, tokenCap: M3_CAPS.tokenCap,
        dollarCap: new Prisma.Decimal(M3_CAPS.dollarCap),
        startedAt: new Date(),
      },
      select: { id: true },
    })
    console.log(`\n  VoiceM3Run ${run.id} 시작\n`)

    const instruction = buildInstruction()
    // 🔴 하드코딩 1,000 이 1차 실행 5건을 전부 잘랐다. 이제 모델이 정한다
    const maxOut = maxOutputTokensFor(MODEL as string)
    let attempted = 0, succeeded = 0, failed = 0, skipped = 0, cacheHit = 0, cacheMiss = 0
    let inTok = 0, outTok = 0, spent = 0, consecutiveFail = 0
    /** 실패 사유 분포. 🔴 Run.errorSummary 에 남긴다 — 사유를 버리지 않는다 */
    const failureKinds = new Map<string, number>()

    for (const item of prepared) {
      // 🔴 **성공한 캐시만** 재사용한다.
      //    초판은 행이 존재하기만 하면 cache hit 으로 셌다. 그래서 2026-08-27
      //    1차 실행에서 남은 실패 5건이 재실행을 영구히 막는 상태가 됐다 —
      //    고쳐도 같은 cacheKey 라 다시 부를 수 없고, 실패가 성공처럼 재사용된다.
      //    실패는 "이 조합을 시도했다" 는 기록이지 "답을 얻었다" 가 아니다.
      const cached = await prisma.voiceM3Cache.findUnique({
        where: { cacheKey: item.cacheKey }, select: { id: true, status: true },
      })
      if (cached && cached.status === 'succeeded') {
        cacheHit += 1
        await prisma.voiceM3CostEvent.create({
          data: { runId: run.id, cacheId: cached.id, eventType: 'cache_hit', model: modelForKey },
        })
        continue
      }
      cacheMiss += 1
      // 🔴 이전에 실패한 호출이 몇 번 있었는가. 이번 호출의 retryAttempt 는 그 뒤를 잇는다 —
      //    0 부터 다시 세면 "몇 번이나 태웠는가" 를 비용 원장에서 알 수 없다.
      const priorCalls = cached
        ? await prisma.voiceM3CostEvent.count({ where: { cacheId: cached.id, eventType: 'call' } })
        : 0
      if (cached) {
        console.log(`     ${item.row.sourceRef} · 이전 ${cached.status} 캐시 재시도 (지금까지 호출 ${priorCalls}회)`)
      }

      // 🔴 cap 을 매 건 다시 본다. retry 비용까지 여기 반영된다
      if (spent >= M3_CAPS.dollarCap) {
        console.log('  🔴 dollarCap 도달 — 중단한다')
        break
      }
      if (inTok + outTok >= M3_CAPS.tokenCap) {
        console.log('  🔴 tokenCap 도달 — 중단한다')
        break
      }
      if (consecutiveFail >= M3_CAPS.consecutiveFailureStop) {
        console.log(`  🔴 연속 실패 ${consecutiveFail}회 — 배치를 중단한다`)
        break
      }

      let response = await callProvider({
        model: MODEL as 'gpt-5-nano' | 'claude-haiku-4.5',
        systemPrompt: instruction,
        userPayload: item.payloadText,
        maxOutputTokens: maxOut,
        timeoutMs: M3_CAPS.timeoutSec * 1000,
      })
      attempted += 1
      let retry = 0
      // 🔴 재시도도 비용이다. CostEvent 에 남기고 cap 에 계상한다
      while (!response.ok && retry < M3_CAPS.maxRetry && ['HTTP_429', 'HTTP_503', 'TIMEOUT', 'NETWORK'].includes(response.errorCode ?? '')) {
        retry += 1
        await prisma.voiceM3CostEvent.create({
          data: {
            runId: run.id, eventType: 'retry', model: modelForKey,
            retryAttempt: priorCalls + retry,
            reason: response.errorCode ?? 'unknown',
          },
        })
        response = await callProvider({
          model: MODEL as 'gpt-5-nano' | 'claude-haiku-4.5',
          systemPrompt: instruction, userPayload: item.payloadText,
          maxOutputTokens: maxOut, timeoutMs: M3_CAPS.timeoutSec * 1000,
        })
      }

      const p = pricing!
      const callCost =
        (response.inputTokens / 1_000_000) * p.inputPerMTok +
        (response.outputTokens / 1_000_000) * p.outputPerMTok
      inTok += response.inputTokens
      outTok += response.outputTokens
      spent += callCost

      // 🔴 저장 전 원문 유출 대조. 걸리면 저장하지 않고 skipped
      let status: 'succeeded' | 'failed' | 'skipped' = response.ok ? 'succeeded' : 'failed'
      let errorCode = response.errorCode
      let baseMessage = response.errorMessage
      let output: Prisma.InputJsonValue | undefined
      let jsonFailure: JsonFailureKind | null = null

      if (response.ok) {
        const leak = assertNoSourceLeak(response.rawText, item.sourceTexts)
        const forbidden = M3_FORBIDDEN_ADDRESS_TERMS.filter((t) => response.rawText.includes(t))
        if (leak.leaked) {
          status = 'skipped'
          errorCode = 'SOURCE_LEAK'
          baseMessage = '출력에 원문 20자 이상 연속 일치가 있어 저장하지 않았다'
        } else if (forbidden.length > 0) {
          status = 'skipped'
          errorCode = 'FORBIDDEN_ADDRESS'
          baseMessage = `출력에 생성 금지 호칭 ${forbidden.length}종이 있어 저장하지 않았다`
        } else {
          try {
            output = JSON.parse(response.rawText) as Prisma.InputJsonValue
          } catch {
            status = 'failed'
            errorCode = 'JSON_PARSE'
            // 🔴 "JSON 파싱 실패" 한 줄만 남긴 것이 1차 실행의 진단 공백이었다.
            //    **모양**을 분류해 남긴다 — 내용이 아니라 모양이다
            jsonFailure = classifyJsonFailure(response.rawText)
            baseMessage = null
          }
        }
      }

      // 🔴 진단은 수치와 분류값뿐이다. 입력 타입에 응답 본문이 들어갈 자리가 없다
      const diagnostics = formatDiagnostics({
        finishReason: response.finishReason,
        outputTokens: response.outputTokens,
        maxOutputTokens: maxOut,
        reasoningTokens: response.reasoningTokens,
        responseChars: response.responseChars,
        jsonFailure,
        maxTokensReached: response.maxTokensReached,
      })
      const errorMessage = status === 'succeeded'
        ? null
        : [baseMessage, diagnostics].filter(Boolean).join(' · ')
      if (status !== 'succeeded') {
        const kind = jsonFailure ? `${errorCode}:${jsonFailure}` : (errorCode ?? 'unknown')
        failureKinds.set(kind, (failureKinds.get(kind) ?? 0) + 1)
      }

      const cacheFields = {
        voiceSourceId: item.row.id,
        origin: 'unao_cafe', sourceRef: item.row.sourceRef,
        ruleVersion: ruleVersionById.get(item.row.id) ?? 'none',
        taskVersion: M3_TASK_VERSION, model: modelForKey,
        promptVersion: M3_PROMPT_VERSION, outputSchemaVersion: M3_OUTPUT_SCHEMA_VERSION,
        status,
        // 🔴 성공했을 때만 산출물을 넣는다. 실패면 명시적으로 비운다 —
        //    undefined 로 두면 update 경로에서 이전 값이 남는다
        output: status === 'succeeded' && output !== undefined ? output : Prisma.DbNull,
        inputTokens: response.inputTokens, outputTokens: response.outputTokens,
        totalTokens: response.inputTokens + response.outputTokens,
        estimatedCostUsd: new Prisma.Decimal(callCost.toFixed(4)),
        errorCode, errorMessage,
      }
      // 🔴 create 가 아니라 upsert 다. cacheKey 는 UNIQUE 이므로
      //    실패 캐시를 다시 부른 뒤 create 하면 P2002 로 터진다 —
      //    "실패는 재시도 가능해야 한다" 는 요구가 여기까지 이어진다
      const cache = await prisma.voiceM3Cache.upsert({
        where: { cacheKey: item.cacheKey },
        create: { cacheKey: item.cacheKey, ...cacheFields },
        update: { ...cacheFields, generatedAt: new Date() },
        select: { id: true },
      })
      await prisma.voiceM3CostEvent.create({
        data: {
          runId: run.id, cacheId: cache.id, eventType: 'call', model: modelForKey,
          inputTokens: response.inputTokens, outputTokens: response.outputTokens,
          totalTokens: response.inputTokens + response.outputTokens,
          estimatedCostUsd: new Prisma.Decimal(callCost.toFixed(4)),
          // 🔴 이전 실행의 호출 횟수를 이어받는다. 0 부터 다시 세면
          //    한 건에 몇 번 돈을 썼는지 비용 원장에서 알 수 없다
          retryAttempt: priorCalls + retry,
          reason: errorCode,
        },
      })

      if (status === 'succeeded') { succeeded += 1; consecutiveFail = 0 }
      else if (status === 'skipped') { skipped += 1; consecutiveFail = 0 }
      else { failed += 1; consecutiveFail += 1 }
      // 🔴 원문이 아니라 상태와 수치만 찍는다
      console.log(
        `     ${item.row.sourceRef} → ${status}${errorCode ? ` (${errorCode})` : ''}` +
          ` · ${response.inputTokens}+${response.outputTokens} tok · $${callCost.toFixed(5)}` +
          `\n        ${diagnostics}`,
      )
    }

    await prisma.voiceM3Run.update({
      where: { id: run.id },
      data: {
        status: consecutiveFail >= M3_CAPS.consecutiveFailureStop ? 'failed' : 'completed',
        completedAt: new Date(),
        attempted, succeeded, failed, skipped, cacheHit, cacheMiss,
        inputTokens: inTok, outputTokens: outTok, totalTokens: inTok + outTok,
        estimatedCostUsd: new Prisma.Decimal(spent.toFixed(4)),
        // 🔴 실패 사유를 버리지 않는다. 다음 실행의 입력이다
        errorSummary: failureKinds.size === 0
          ? null
          : [...failureKinds.entries()].map(([k, v]) => `${k}=${v}`).join(' · '),
      },
    })

    console.log('\n  결과')
    console.log(`     시도 ${attempted} · 성공 ${succeeded} · 실패 ${failed} · skip ${skipped}`)
    console.log(`     cache hit ${cacheHit} · miss ${cacheMiss}`)
    console.log(`     토큰 ${inTok.toLocaleString()}+${outTok.toLocaleString()} · 실제 비용 $${spent.toFixed(4)} / cap $${M3_CAPS.dollarCap}`)
    if (failureKinds.size > 0) {
      console.log(`     실패 사유       ${[...failureKinds.entries()].map(([k, v]) => `${k}=${v}`).join(' · ')}`)
    }
    console.log('\n  🔴 다음은 사람이 읽는다. 점수로 발행을 자동화하지 않는다.\n')
  } finally {
    await unao.end()
    await prisma.$disconnect()
  }
}

main().catch((e: unknown) => {
  console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
