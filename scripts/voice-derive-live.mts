#!/usr/bin/env tsx
/**
 * VoiceSource → VoiceDerived · VoiceCommentSignal 규칙 계산 (VE-M2-2)
 *
 * 정본: docs/operations/2026-08-26-voice-derived-m2-design.md
 *
 * 🔴 비용 0원이다
 *    LLM · 외부 API · 크롤링이 **하나도 없다**.
 *    읽는 곳은 우나어 Postgres(read-only)뿐이고, 쓰는 곳은 소란소란 Voice 두 테이블뿐이다.
 *    첫 LLM 비용은 VE-M3 이며, 그때 method='llm' 행이 같은 테이블에 붙는다.
 *
 * 🔴 원문 · 댓글 본문 · 닉네임을 저장하지 않는다
 *    본문은 신호를 세는 순간에만 메모리에 있고 배치마다 버려진다.
 *    남는 것은 개수 · 비율 · 어휘 목록 · 해시뿐이다.
 *
 * 🔴 VE-M3 신호 7종을 계산하지 않는다
 *    naturalnessScore · voiceRetention · originalityDelta · overSanitizedRisk ·
 *    overMimicryRisk · expressionRisk · sequenceSimilarityRisk 는
 *    "소란소란이 쓴 글 ↔ 원문" 의 비교 축이라 생성물이 있어야 계산된다.
 *    테이블에 컬럼조차 없다 — 넣으려 해도 넣을 자리가 없다.
 *
 * 🔴 --apply 는 --limit 을 요구한다
 *    "전부 계산" 을 한 번에 할 수 없게 한다. 9,674건은 되돌리기 어렵다.
 *
 * 사용법
 *   npm run voice:derive                       판정만 (DB write 0)
 *   npm run voice:derive -- --limit=10          판정만
 *   npm run voice:derive -- --limit=10 --apply  10건 계산·저장
 */
import pg from 'pg'
import { PrismaClient, Prisma } from '@prisma/client'
import {
  loadUnaoReadonlyUrl, maskConnectionString, UNAO_READONLY_URL_ENV,
} from './lib/voice-unao-readonly.mjs'
import { computeStyleSignals, STYLE_RULE_VERSION } from './lib/voice-style-signals.mjs'
import { toCommentSignals, summarizeCommentSignals } from './lib/voice-comment-signals.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { readAuthorHashKey, writableStateOf } from './lib/voice-author-hash.mjs'
import { storedAuthorHashState } from './lib/persona-name-collision-sets.mjs'

/** 🔴 명시 상수다. 규칙이 바뀌면 이 값을 올리고, 옛 행은 그대로 둔다 */
const RULE_VERSION = STYLE_RULE_VERSION
/** 🔴 'rule' 고정. LLM 산출물과 섞지 않는다 */
const METHOD = 'rule' as const
/** 🔴 rule 단계에서는 빈 문자열이다. NULL 이면 UNIQUE 가 무력해진다 */
const MODEL = ''
const PROMPT_VERSION = ''


const APPLY = process.argv.includes('--apply')
const arg = (n: string): string | undefined => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}
const LIMIT_RAW = arg('limit')
const LIMIT = LIMIT_RAW === undefined ? null : Number(LIMIT_RAW)
const BATCH_RAW = arg('batch')
const BATCH = BATCH_RAW === undefined ? 200 : Number(BATCH_RAW)
const MAX_BATCH = 500

/** 🔴 SELECT 다. 원문은 여기서만 나오고 반환값에는 실리지 않는다 */
const READ_SOURCE = 'SELECT id, content, "topComments" FROM "CafePost" WHERE id = ANY($1)'

async function main() {
  await loadEnvLocal()

  if (LIMIT !== null && (!Number.isInteger(LIMIT) || LIMIT < 1)) {
    throw new Error(`--limit 은 1 이상 정수여야 한다: ${LIMIT_RAW}`)
  }
  if (!Number.isInteger(BATCH) || BATCH < 1 || BATCH > MAX_BATCH) {
    throw new Error(`--batch 는 1~${MAX_BATCH} 정수여야 한다: ${BATCH_RAW}`)
  }
  // 🔴 "전부 계산" 을 한 번에 할 수 없게 한다
  if (APPLY && LIMIT === null) {
    throw new Error(
      '--apply 는 --limit 을 요구한다.\n' +
        '  대상은 9,674건이다. 한 번에 전부 계산하지 않는다 —\n' +
        '  --limit=10 으로 시작해 눈으로 확인한 뒤 늘린다.',
    )
  }

  // 🔴 작가 해시 key — 정본 helper 하나(정본 env). 없으면 공개 기본값으로 내려가지 않고 멈춘다(author-hash v2)
  const keyRead = readAuthorHashKey()
  if (!keyRead.ok) {
    console.error(`\n❌ 중단: ${keyRead.reason}\n`)
    process.exit(1)
  }
  const authorKey = keyRead.key
  const unaoUrl = loadUnaoReadonlyUrl()

  console.log('\nVoice — 규칙 신호 계산 (VE-M2-2)')
  console.log(`  우나어 읽기: ${maskConnectionString(unaoUrl)} · ${UNAO_READONLY_URL_ENV}`)
  console.log(`  ruleVersion=${RULE_VERSION} · method=${METHOD} · model='${MODEL}' · promptVersion='${PROMPT_VERSION}'`)
  console.log(`  batch=${BATCH} · limit=${LIMIT ?? '(무제한 — dry-run 에서만)'}`)
  console.log(
    APPLY
      ? `  🔴 --apply : 최대 ${LIMIT}건을 실제로 저장한다`
      : '  🔍 dry-run — 계산만 한다. DB write 0 (반영은 --apply --limit=N)',
  )
  console.log('  🔴 LLM · 외부 API · 크롤링 0 — 비용이 발생하지 않는다')
  console.log('  🔴 원문 · 댓글 본문 · 닉네임을 저장하지 않는다\n')

  const unao = new pg.Client({ connectionString: unaoUrl, ssl: { rejectUnauthorized: false } })
  await unao.connect()
  const prisma = new PrismaClient()
  // 🔴 옛 세대(v1) · 섞임 · 손상 · 다른 key 위에 v2 를 섞어 쓰지 않는다 — 비었거나 지금 key 의 v2 일 때만 쓴다
  if (APPLY) {
    const w = writableStateOf((await storedAuthorHashState(prisma, authorKey)).census)
    if (!w.ok) {
      console.error(`\n❌ 중단: ${w.reason}\n`)
      await prisma.$disconnect()
      process.exit(1)
    }
  }

  let scanned = 0
  let derived = 0
  let skipped = 0
  let commentRows = 0
  let missingSource = 0
  let lowSample = 0
  const reactionTotals: Record<string, number> = {}
  const registerTotals = { sourceSpecific: 0, soransoran: 0, targetRisk: 0 }

  try {
    const total = await prisma.voiceSource.count({ where: { origin: 'unao_cafe' } })
    const already = await prisma.voiceDerived.count({
      where: { ruleVersion: RULE_VERSION, method: METHOD, model: MODEL, promptVersion: PROMPT_VERSION },
    })
    console.log(`  대상 ${total}건 · 이미 계산됨 ${already}건 → 남은 후보 약 ${total - already}건\n`)

    const cap = LIMIT ?? total
    let cursor: string | null = null

    while (derived + skipped < total) {
      // 🔴 id 커서로 나눠 읽는다. 9,674건을 한 번에 끌면 pooler 가 끊는다(P1017 실측)
      const batch: Array<{ id: string; sourceRef: string; capturedAt: Date }> =
        await prisma.voiceSource.findMany({
          where: { origin: 'unao_cafe', ...(cursor ? { id: { gt: cursor } } : {}) },
          select: { id: true, sourceRef: true, capturedAt: true },
          orderBy: { id: 'asc' },
          take: BATCH,
        })
      if (batch.length === 0) break
      cursor = batch[batch.length - 1].id

      // 🔴 이미 계산된 것을 배치 단위로 확인한다. 행마다 findUnique 는 9,674 왕복이다
      const existing = new Set(
        (
          await prisma.voiceDerived.findMany({
            where: {
              voiceSourceId: { in: batch.map((b) => b.id) },
              ruleVersion: RULE_VERSION, method: METHOD, model: MODEL, promptVersion: PROMPT_VERSION,
            },
            select: { voiceSourceId: true },
          })
        ).map((e) => e.voiceSourceId),
      )

      const todo = batch.filter((b) => !existing.has(b.id))
      skipped += batch.length - todo.length
      if (todo.length === 0) continue

      // 🔴 원문은 여기서만 메모리에 올라오고, 신호를 센 뒤 버려진다
      const res = await unao.query(READ_SOURCE, [todo.map((t) => t.sourceRef)])
      const byRef = new Map(res.rows.map((r: Record<string, unknown>) => [String(r.id), r]))

      for (const item of todo) {
        scanned += 1
        const src = byRef.get(item.sourceRef)
        if (!src) { missingSource += 1; continue }

        const content = typeof src.content === 'string' ? src.content : ''
        if (!content) { missingSource += 1; continue }

        const style = computeStyleSignals(content)
        const comments = toCommentSignals(src.topComments, {
          authorKey, capturedAt: item.capturedAt,
        })

        if (style.artifactFrequency.lowSample) lowSample += 1
        registerTotals.sourceSpecific += style.communityRegister.sourceSpecific.length
        registerTotals.soransoran += style.communityRegister.soransoranRegister.length
        registerTotals.targetRisk += style.communityRegister.targetDescriptorRisk.length
        for (const c of comments) reactionTotals[c.reactionType] = (reactionTotals[c.reactionType] ?? 0) + 1

        if (!APPLY) {
          derived += 1
          commentRows += comments.length
          if (derived >= cap) break
          continue
        }

        await prisma.$transaction(async (tx) => {
          await tx.voiceDerived.create({
            data: {
              voiceSourceId: item.id,
              ruleVersion: RULE_VERSION,
              method: METHOD,
              model: MODEL,
              promptVersion: PROMPT_VERSION,
              // 🔴 신호만 담는다. 본문 · 댓글 · 닉네임이 들어갈 자리가 없다
              typingArtifacts: style.typingArtifacts as unknown as Prisma.InputJsonValue,
              punctuationHabit: style.punctuationHabit as unknown as Prisma.InputJsonValue,
              spacingVariance: style.spacingVariance as unknown as Prisma.InputJsonValue,
              mobileInputTrace: style.mobileInputTrace as unknown as Prisma.InputJsonValue,
              communityRegister: style.communityRegister as unknown as Prisma.InputJsonValue,
              artifactFrequency: style.artifactFrequency as unknown as Prisma.InputJsonValue,
            },
            select: { id: true },
          })
          // 🔴 UNIQUE(voiceSourceId, ordinal) 로 중복이 막힌다. 재실행해도 쌓이지 않는다
          if (comments.length > 0) {
            await tx.voiceCommentSignal.createMany({
              // 🔴 anchorHint 는 null 이 아니라 Prisma.DbNull 이어야 한다 —
              //    Prisma 의 nullable Json 은 "JSON null" 과 "컬럼 NULL" 을 구분한다
              data: comments.map(({ anchorHint, ...c }) => ({
                voiceSourceId: item.id,
                ...c,
                anchorHint: anchorHint === null
                  ? Prisma.DbNull
                  : (anchorHint as Prisma.InputJsonValue),
              })),
              skipDuplicates: true,
            })
          }
        })
        derived += 1
        commentRows += comments.length
        if (derived % 25 === 0) console.log(`     … ${derived}건 계산`)
        if (derived >= cap) break
      }
      if (derived >= cap) break
    }

    // ── 보고 — 🔴 수치만. 원문 · 댓글 · 닉네임이 나오지 않는다 ──
    console.log('\n  결과')
    console.log(`     스캔          ${scanned}건`)
    console.log(`     ${APPLY ? '저장' : '계산 예정'}     ${derived}건`)
    console.log(`     이미 계산됨   ${skipped}건 (SKIP)`)
    console.log(`     원본 없음     ${missingSource}건`)
    console.log(`     댓글 신호     ${commentRows}행`)
    console.log(`     짧은 표본     ${lowSample}건 (200자 미만 — 빈도 신뢰도 낮음)`)
    console.log(`     반응 분포     ${Object.entries(reactionTotals).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' · ') || '(없음)'}`)
    console.log(`     호칭          sourceSpecific=${registerTotals.sourceSpecific} · soransoran=${registerTotals.soransoran} · 🔴targetDescriptorRisk=${registerTotals.targetRisk}`)

    if (!APPLY) {
      console.log('\n  🔍 dry-run 이었다. DB 에 아무것도 쓰지 않았다.')
      console.log('     반영하려면 --apply --limit=N 을 준다. --limit 없이는 apply 가 거부된다.\n')
      return
    }

    const [vd, vc] = await Promise.all([prisma.voiceDerived.count(), prisma.voiceCommentSignal.count()])
    console.log(`\n  원장 확인  VoiceDerived ${vd}건 · VoiceCommentSignal ${vc}건 ✅`)
    console.log('  🔴 원문 · 댓글 본문 · 닉네임은 저장하지 않았다. 신호와 해시만 남았다.')
    console.log('  🔴 LLM · API 호출 0 — 이 단계의 비용은 0원이다.\n')
  } finally {
    await unao.end()
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
