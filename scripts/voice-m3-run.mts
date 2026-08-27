#!/usr/bin/env tsx
/**
 * VE-M3 실험 실행기 (VE-M3-3)
 *
 * 정본: docs/operations/2026-08-27-voice-m3-model-selection-criteria.md
 *       docs/operations/2026-08-27-voice-m3-llm-experiment-contract.md
 *
 * 🔴 dry-run 이 기본이다. 유료 호출은 게이트 9개를 전부 통과해야 한다.
 *    이 저장소에서 처음으로 **돈이 나갈 수 있는 명령**이다.
 *
 * 🔴 캐시가 있으면 부르지 않는다
 *    cacheKey 8요소가 같으면 재호출하지 않는다. 캐시 미스 하나가 돈이다.
 *
 * 🔴 저장 전에 원문 유출을 대조한다
 *    LLM 출력에 원문 · 댓글이 20자 이상 연속으로 있으면 **저장하지 않고 skipped 처리**한다.
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
} from './lib/voice-m3-contract.mjs'
import {
  selectStratifiedSample, validateSample, formatSampleRow, SAMPLE_AXES,
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
    if (!keyStatus(model).present) blocked.push(`${keyStatus(model).envName} 가 없다`)
  }
  return { ok: blocked.length === 0, blocked }
}

async function main(): Promise<void> {
  await loadEnvLocal()

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
  const modelForKey = MODEL ?? 'undetermined'
  const unaoUrl = loadUnaoReadonlyUrl()

  console.log('\nVoice — VE-M3 실험 실행기')
  console.log(`  우나어 읽기: ${maskConnectionString(unaoUrl)}`)
  console.log(`  stage=${STAGE ?? '(미지정)'} · model=${modelForKey} · limit=${LIMIT}`)
  if (pricing) {
    console.log(`  단가 $${pricing.inputPerMTok}/$${pricing.outputPerMTok} per MTok · 출처 ${pricing.source} (${pricing.checkedAt})`)
  }
  if (MODEL) {
    const k = keyStatus(MODEL)
    // 🔴 key 값이 아니라 존재 여부와 앞 4자만
    console.log(`  ${k.envName}: ${k.present ? `존재 ${k.hint}` : '🔴 없음'}`)
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

    const sample = selectStratifiedSample(candidates, LIMIT)
    const check = validateSample(sample, LIMIT)

    console.log(`  표본 ${sample.rows.length}건 (후보 ${candidates.length}건에서 층화 선정 · 난수 없음)`)
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
    const cost = estimateCost(totalChars, prepared.length, pricing)
    const caps = checkCaps(cost, prepared.length)

    console.log('\n  cacheKey · 비용')
    console.log(`     cacheKey 고유    ${uniqueKeys.size}/${prepared.length} ${uniqueKeys.size === prepared.length ? '(1건 1키)' : '🔴 중복'}`)
    console.log(`     입력 토큰(추정)   ${cost.estimatedInputTokens.toLocaleString()} / tokenCap ${M3_CAPS.tokenCap.toLocaleString()}`)
    console.log(`     출력 토큰(추정)   ${cost.estimatedOutputTokens.toLocaleString()}`)
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
    let attempted = 0, succeeded = 0, failed = 0, skipped = 0, cacheHit = 0, cacheMiss = 0
    let inTok = 0, outTok = 0, spent = 0, consecutiveFail = 0

    for (const item of prepared) {
      // 🔴 캐시가 있으면 부르지 않는다
      const cached = await prisma.voiceM3Cache.findUnique({
        where: { cacheKey: item.cacheKey }, select: { id: true },
      })
      if (cached) {
        cacheHit += 1
        await prisma.voiceM3CostEvent.create({
          data: { runId: run.id, cacheId: cached.id, eventType: 'cache_hit', model: modelForKey },
        })
        continue
      }
      cacheMiss += 1

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
        maxOutputTokens: 1000,
        timeoutMs: M3_CAPS.timeoutSec * 1000,
      })
      attempted += 1
      let retry = 0
      // 🔴 재시도도 비용이다. CostEvent 에 남기고 cap 에 계상한다
      while (!response.ok && retry < M3_CAPS.maxRetry && ['HTTP_429', 'HTTP_503', 'TIMEOUT', 'NETWORK'].includes(response.errorCode ?? '')) {
        retry += 1
        await prisma.voiceM3CostEvent.create({
          data: {
            runId: run.id, eventType: 'retry', model: modelForKey, retryAttempt: retry,
            reason: response.errorCode ?? 'unknown',
          },
        })
        response = await callProvider({
          model: MODEL as 'gpt-5-nano' | 'claude-haiku-4.5',
          systemPrompt: instruction, userPayload: item.payloadText,
          maxOutputTokens: 1000, timeoutMs: M3_CAPS.timeoutSec * 1000,
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
      let errorMessage = response.errorMessage
      let output: Prisma.InputJsonValue | undefined

      if (response.ok) {
        const leak = assertNoSourceLeak(response.rawText, item.sourceTexts)
        const forbidden = M3_FORBIDDEN_ADDRESS_TERMS.filter((t) => response.rawText.includes(t))
        if (leak.leaked) {
          status = 'skipped'
          errorCode = 'SOURCE_LEAK'
          errorMessage = '출력에 원문 20자 이상 연속 일치가 있어 저장하지 않았다'
        } else if (forbidden.length > 0) {
          status = 'skipped'
          errorCode = 'FORBIDDEN_ADDRESS'
          errorMessage = `출력에 생성 금지 호칭 ${forbidden.length}종이 있어 저장하지 않았다`
        } else {
          try {
            output = JSON.parse(response.rawText) as Prisma.InputJsonValue
          } catch {
            status = 'failed'
            errorCode = 'JSON_PARSE'
            errorMessage = 'JSON 파싱 실패'
          }
        }
      }

      const cache = await prisma.voiceM3Cache.create({
        data: {
          cacheKey: item.cacheKey, voiceSourceId: item.row.id,
          origin: 'unao_cafe', sourceRef: item.row.sourceRef,
          ruleVersion: ruleVersionById.get(item.row.id) ?? 'none',
          taskVersion: M3_TASK_VERSION, model: modelForKey,
          promptVersion: M3_PROMPT_VERSION, outputSchemaVersion: M3_OUTPUT_SCHEMA_VERSION,
          status,
          output: status === 'succeeded' ? output : undefined,
          inputTokens: response.inputTokens, outputTokens: response.outputTokens,
          totalTokens: response.inputTokens + response.outputTokens,
          estimatedCostUsd: new Prisma.Decimal(callCost.toFixed(4)),
          errorCode, errorMessage,
        },
        select: { id: true },
      })
      await prisma.voiceM3CostEvent.create({
        data: {
          runId: run.id, cacheId: cache.id, eventType: 'call', model: modelForKey,
          inputTokens: response.inputTokens, outputTokens: response.outputTokens,
          totalTokens: response.inputTokens + response.outputTokens,
          estimatedCostUsd: new Prisma.Decimal(callCost.toFixed(4)),
          retryAttempt: retry, reason: errorCode,
        },
      })

      if (status === 'succeeded') { succeeded += 1; consecutiveFail = 0 }
      else if (status === 'skipped') { skipped += 1; consecutiveFail = 0 }
      else { failed += 1; consecutiveFail += 1 }
      // 🔴 원문이 아니라 상태와 수치만 찍는다
      console.log(`     ${item.row.sourceRef} → ${status}${errorCode ? ` (${errorCode})` : ''} · ${response.inputTokens}+${response.outputTokens} tok · $${callCost.toFixed(5)}`)
    }

    await prisma.voiceM3Run.update({
      where: { id: run.id },
      data: {
        status: consecutiveFail >= M3_CAPS.consecutiveFailureStop ? 'failed' : 'completed',
        completedAt: new Date(),
        attempted, succeeded, failed, skipped, cacheHit, cacheMiss,
        inputTokens: inTok, outputTokens: outTok, totalTokens: inTok + outTok,
        estimatedCostUsd: new Prisma.Decimal(spent.toFixed(4)),
      },
    })

    console.log('\n  결과')
    console.log(`     시도 ${attempted} · 성공 ${succeeded} · 실패 ${failed} · skip ${skipped}`)
    console.log(`     cache hit ${cacheHit} · miss ${cacheMiss}`)
    console.log(`     토큰 ${inTok.toLocaleString()}+${outTok.toLocaleString()} · 실제 비용 $${spent.toFixed(4)} / cap $${M3_CAPS.dollarCap}`)
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
