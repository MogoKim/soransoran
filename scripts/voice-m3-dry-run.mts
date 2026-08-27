#!/usr/bin/env tsx
/**
 * VE-M3 dry-run — payload 와 cap 을 계산한다. LLM 을 부르지 않는다 (VE-M3-2)
 *
 * 정본: docs/operations/2026-08-27-voice-m3-llm-experiment-contract.md
 *
 * 🔴 이 스크립트는 비용이 0원이다
 *    LLM SDK import 0 · 네트워크 호출 0 · provider key 요구 0.
 *    읽는 곳은 우나어 Postgres(read-only)와 소란소란 DB(SELECT)뿐이다.
 *
 * 🔴 DB 에 아무것도 쓰지 않는다
 *    VoiceM3Run · VoiceM3Cache · VoiceM3CostEvent 에 write 가 없다.
 *    그 테이블들은 VE-M3-3 에서 처음 채워진다.
 *
 * 🔴 --apply 가 없다
 *    이 단계에는 "반영" 할 것이 없다. 옵션을 만들어 두면 언젠가 눌린다 —
 *    아예 없애고, 넘어오면 거부한다.
 *
 * 🔴 원문 전문을 로그로 찍지 않는다
 *    payload 에는 본문이 들어가지만 보고는 요약(길이 · 해시 · 개수)만 쓴다.
 *
 * 사용법
 *   npm run voice:m3-dry-run -- --limit=10
 */
import pg from 'pg'
import { PrismaClient } from '@prisma/client'
import { loadUnaoReadonlyUrl, maskConnectionString, topCommentsToText } from './lib/voice-unao-readonly.mjs'
import { toCommentSignals, summarizeCommentSignals } from './lib/voice-comment-signals.mjs'
import { buildPromptPayload, formatSummaryLine } from './lib/voice-m3-prompt.mjs'
import {
  M3_TASK_VERSION, M3_PROMPT_VERSION, M3_OUTPUT_SCHEMA_VERSION, M3_MODEL_UNDETERMINED,
  M3_CAPS, M3_SIGNAL_KEYS, M3_MODEL_CANDIDATES, M3_EXPERIMENT_PER_MODEL,
  buildCacheKey, estimateCost, checkCaps, pricingFor,
} from './lib/voice-m3-contract.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

// 🔴 --apply 는 존재하지 않는다. 넘어오면 즉시 거부한다
if (process.argv.includes('--apply')) {
  console.error(
    '\n❌ --apply 는 VE-M3-2 에 없다.\n' +
      '   이 단계는 payload 와 cap 을 계산할 뿐이고 반영할 것이 없다.\n' +
      '   실제 LLM 호출은 VE-M3-3 이며 모델 · 공식 단가가 정해진 뒤다(계약 §E · §F).\n',
  )
  process.exit(1)
}

const arg = (n: string): string | undefined => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}
const LIMIT_RAW = arg('limit')
const LIMIT = LIMIT_RAW === undefined ? M3_CAPS.itemLimit : Number(LIMIT_RAW)
/**
 * 🔴 모델을 고르는 옵션이 아니다. **단가를 붙여 금액을 보기 위한 것**이다.
 *    주지 않으면 model=undetermined 로 남고 금액은 산출되지 않는다.
 *    실제 모델 선택은 20건 실험 뒤 사람이 한다(model-selection-criteria).
 */
const MODEL_RAW = arg('model')

const AUTHOR_SALT_ENV = 'VOICE_AUTHOR_HASH_SALT'
const DEFAULT_SALT = 'soransoran-voice-v1'

/** 🔴 SELECT 다. 원문은 여기서만 나오고 보고에는 실리지 않는다 */
const READ_SOURCE = 'SELECT id, content, "topComments" FROM "CafePost" WHERE id = ANY($1)'

async function main(): Promise<void> {
  await loadEnvLocal()

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

  // 🔴 등록되지 않은 모델이면 여기서 던진다 — 금액을 지어내지 않는다
  const pricing = MODEL_RAW ? pricingFor(MODEL_RAW) : undefined
  const modelForKey = MODEL_RAW ?? M3_MODEL_UNDETERMINED

  const salt = (process.env[AUTHOR_SALT_ENV] ?? DEFAULT_SALT).trim()
  const unaoUrl = loadUnaoReadonlyUrl()

  console.log('\nVoice — VE-M3 dry-run (payload · cap 계산)')
  console.log(`  우나어 읽기: ${maskConnectionString(unaoUrl)}`)
  console.log(`  taskVersion=${M3_TASK_VERSION} · promptVersion=${M3_PROMPT_VERSION} · outputSchemaVersion=${M3_OUTPUT_SCHEMA_VERSION}`)
  if (pricing) {
    console.log(`  model=${modelForKey} · 단가 $${pricing.inputPerMTok}/$${pricing.outputPerMTok} per MTok`)
    console.log(`         출처 ${pricing.source} (확인 ${pricing.checkedAt})`)
    console.log('         🔴 단가를 붙여 금액을 보는 것뿐이다. 모델 선택은 20건 실험 뒤 사람이 한다')
  } else {
    console.log(`  model=${M3_MODEL_UNDETERMINED}  🔴 미확정 — --model=<이름> 을 주면 금액이 나온다`)
    console.log(`         후보: ${Object.keys(M3_MODEL_CANDIDATES).join(' · ')} (1차 실험은 모델당 ${M3_EXPERIMENT_PER_MODEL}건)`)
  }
  console.log(`  limit=${LIMIT} / itemLimit ${M3_CAPS.itemLimit}`)
  console.log('  🔴 LLM 호출 0 · 네트워크 0 · DB write 0 — 이 단계의 비용은 0원이다')
  console.log('  🔴 원문 전문을 로그로 찍지 않는다. 길이 · 해시 · 개수만 보고한다\n')

  const unao = new pg.Client({ connectionString: unaoUrl, ssl: { rejectUnauthorized: false } })
  await unao.connect()
  const prisma = new PrismaClient()

  try {
    // 🔴 SELECT 만. VoiceM3* 를 읽지도 쓰지도 않는다
    const sources = await prisma.voiceSource.findMany({
      where: { origin: 'unao_cafe' },
      select: { id: true, origin: true, sourceRef: true, contentHash: true, legacyLabels: true },
      orderBy: { id: 'asc' },
      take: LIMIT,
    })
    if (sources.length === 0) {
      console.log('  대상이 없다.\n')
      return
    }

    const ids = sources.map((s) => s.id)
    const [derivedRows, signalRows] = await Promise.all([
      prisma.voiceDerived.findMany({ where: { voiceSourceId: { in: ids } } }),
      prisma.voiceCommentSignal.findMany({ where: { voiceSourceId: { in: ids } } }),
    ])
    const derivedBySource = new Map(derivedRows.map((d) => [d.voiceSourceId, d]))
    const signalCountBySource = new Map<string, number>()
    for (const s of signalRows) {
      signalCountBySource.set(s.voiceSourceId, (signalCountBySource.get(s.voiceSourceId) ?? 0) + 1)
    }

    const res = await unao.query(READ_SOURCE, [sources.map((s) => s.sourceRef)])
    const byRef = new Map(res.rows.map((r: Record<string, unknown>) => [String(r.id), r]))

    let totalPayloadChars = 0
    let missing = 0
    const cacheKeys = new Set<string>()

    console.log('  payload 요약 (원문 없음)')
    for (const src of sources) {
      const raw = byRef.get(src.sourceRef)
      if (!raw) { missing += 1; continue }
      const body = typeof raw.content === 'string' ? raw.content : ''
      if (!body) { missing += 1; continue }

      // 🔴 댓글 본문은 payload 에만 들어가고 보고에는 개수 · 길이만 나간다
      const commentsText = topCommentsToText(raw.topComments)
      const comments = commentsText ? commentsText.split('\n').filter(Boolean) : []

      const derived = derivedBySource.get(src.id)
      const derivedSignals: Record<string, unknown> = derived
        ? {
            typingArtifacts: derived.typingArtifacts,
            punctuationHabit: derived.punctuationHabit,
            spacingVariance: derived.spacingVariance,
            mobileInputTrace: derived.mobileInputTrace,
            communityRegister: derived.communityRegister,
            artifactFrequency: derived.artifactFrequency,
          }
        : {}

      const commentSignals = toCommentSignals(raw.topComments, {
        authorSalt: salt, capturedAt: new Date(0),
      })
      const reaction = summarizeCommentSignals(commentSignals)

      const { summary } = buildPromptPayload({
        sourceRef: src.sourceRef,
        body,
        comments,
        derivedSignals,
        legacyLabels: (src.legacyLabels ?? {}) as Record<string, unknown>,
        commentSignalSummary: reaction.byReaction,
      })
      totalPayloadChars += summary.payloadChars

      // 🔴 cacheKey 는 계산만 한다. 저장하지 않는다
      cacheKeys.add(
        buildCacheKey({
          origin: src.origin,
          sourceRef: src.sourceRef,
          contentHash: src.contentHash,
          ruleVersion: derived?.ruleVersion ?? 'none',
          taskVersion: M3_TASK_VERSION,
          model: modelForKey,
          promptVersion: M3_PROMPT_VERSION,
          outputSchemaVersion: M3_OUTPUT_SCHEMA_VERSION,
        }),
      )

      console.log(`     ${formatSummaryLine(summary)} · 저장된 댓글신호 ${signalCountBySource.get(src.id) ?? 0}행`)
    }

    const itemCount = sources.length - missing
    // 🔴 단가가 없으면 estimatedCostUsd 가 null 로 온다. 0 이 아니다
    const cost = estimateCost(totalPayloadChars, itemCount, pricing)
    const caps = checkCaps(cost, itemCount)

    console.log('\n  cap · 비용 추정')
    console.log(`     대상            ${itemCount}건 (원본 없음 ${missing}건)`)
    console.log(`     cacheKey 고유   ${cacheKeys.size}개 ${cacheKeys.size === itemCount ? '(1건 1키)' : '🔴 중복'}`)
    console.log(`     입력 토큰(추정)  ${cost.estimatedInputTokens.toLocaleString()} / tokenCap ${M3_CAPS.tokenCap.toLocaleString()}`)
    console.log(`     출력 토큰(추정)  ${cost.estimatedOutputTokens.toLocaleString()}`)
    console.log(`     합계 토큰(추정)  ${cost.estimatedTotalTokens.toLocaleString()}`)
    console.log(`     예상 비용        ${cost.estimatedCostUsd === null ? '🔴 산출 불가 (공식 단가 미확정)' : `$${cost.estimatedCostUsd}`}`)
    console.log(`     costStatus      ${cost.costStatus}`)
    if (cost.priceSource) console.log(`     단가 출처        ${cost.priceSource}`)
    console.log(`     dollarCap       $${M3_CAPS.dollarCap} · itemLimit ${M3_CAPS.itemLimit} · maxRetry ${M3_CAPS.maxRetry}(cap 포함)`)

    console.log('\n  cap 판정')
    if (caps.ok) {
      console.log('     ✅ 통과')
    } else {
      for (const v of caps.violations) console.log(`     🔴 ${v}`)
    }

    console.log('\n  출력 스키마 (LLM 이 반환해야 할 모양)')
    console.log(`     ${M3_SIGNAL_KEYS.join(' · ')} + notes`)
    console.log('     🔴 이번 단계에서 계산하지 않는다. 7종은 자동 발행 조건으로 쓰지 않는다(계약 §B · §I)')

    console.log('\n  🔍 dry-run 이었다.')
    console.log('     LLM 호출 0 · 네트워크 0 · DB write 0 · 비용 0원')
    console.log('     실제 호출은 VE-M3-3 이며 모델 · 공식 단가 확정이 선행 조건이다.\n')
  } finally {
    await unao.end()
    await prisma.$disconnect()
  }
}

main().catch((e: unknown) => {
  console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
