#!/usr/bin/env tsx
/**
 * 우나어 고품질 코퍼스 → VoiceSource 배치 적재 (VE-R3)
 *
 * 정본: docs/operations/2026-08-27-voice-engine-schema-strategy.md §1 · §6-2
 *
 * 🔴 전체 33,031건이 아니라 **고품질 9,674건**이 대상이다
 *    isUsable · ageSignal 50s/60s · 150자+ · aiAnalyzed · 댓글 有
 *    전체를 넣으면 ageSignal 70s+ 와 광고성 글이 섞이고
 *    VoiceDerived 계산 대상이 3.4배로 늘어난다.
 *
 * 🔴 원문을 옮기지 않는다 (VE-R2 와 같다)
 *    content · topComments[].content · author 닉네임을 저장하지 않는다.
 *    본문은 해시를 계산하는 순간에만 메모리에 있고 배치마다 버려진다.
 *
 * 🔴 중단해도 이어받는다
 *    id 오름차순 커서로 읽고, UNIQUE(origin, sourceRef) 로 중복을 SKIP 한다.
 *    같은 명령을 다시 실행하면 남은 것부터 계속한다 — 상태 파일이 필요 없다.
 *
 * 🔴 --apply 는 --limit 을 요구한다
 *    "전부 넣기" 를 한 번에 할 수 없게 한다. 9,674건은 되돌리기 어렵다.
 *
 * 사용법
 *   npm run voice:unao-batch                          판정만 (DB write 0)
 *   npm run voice:unao-batch -- --limit=10             판정만
 *   npm run voice:unao-batch -- --limit=10 --apply     10건 적재
 *   npm run voice:unao-batch -- --limit=100 --batch=50 --apply
 */
import pg from 'pg'
import { PrismaClient, type Prisma } from '@prisma/client'
import {
  UNAO_READONLY_URL_ENV, READ_QUERIES, USED_AT_DECISION,
  COUNT_HIGH_QUALITY, COUNT_HIGH_QUALITY_REFERENCED, DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE,
  buildBatchQuery, loadUnaoReadonlyUrl, maskConnectionString, toSourceRow,
} from './lib/voice-unao-readonly.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const APPLY = process.argv.includes('--apply')
const arg = (n: string): string | undefined => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}
const LIMIT_RAW = arg('limit')
const LIMIT = LIMIT_RAW === undefined ? null : Number(LIMIT_RAW)
const BATCH_RAW = arg('batch')
const BATCH_SIZE = BATCH_RAW === undefined ? DEFAULT_BATCH_SIZE : Number(BATCH_RAW)

const AUTHOR_SALT_ENV = 'VOICE_AUTHOR_HASH_SALT'
const DEFAULT_SALT = 'soransoran-voice-v1'

async function main() {
  await loadEnvLocal()

  if (LIMIT !== null && (!Number.isInteger(LIMIT) || LIMIT < 1)) {
    throw new Error(`--limit 은 1 이상 정수여야 한다: ${LIMIT_RAW}`)
  }
  if (!Number.isInteger(BATCH_SIZE) || BATCH_SIZE < 1 || BATCH_SIZE > MAX_BATCH_SIZE) {
    throw new Error(`--batch 는 1~${MAX_BATCH_SIZE} 정수여야 한다: ${BATCH_RAW}`)
  }
  // 🔴 "전부 넣기" 를 한 번에 할 수 없게 한다. 9,674건은 되돌리기 어렵다.
  if (APPLY && LIMIT === null) {
    throw new Error(
      '--apply 는 --limit 을 요구한다.\n' +
        '  고품질 대상은 9,674건이다. 한 번에 전부 넣지 않는다 —\n' +
        '  --limit=10 으로 시작해 눈으로 확인한 뒤 늘린다.',
    )
  }

  const salt = (process.env[AUTHOR_SALT_ENV] ?? DEFAULT_SALT).trim()
  const unaoUrl = loadUnaoReadonlyUrl()

  console.log('\nVoice — 우나어 고품질 코퍼스 → VoiceSource 배치 적재')
  console.log(`  우나어 읽기: ${maskConnectionString(unaoUrl)} · ${UNAO_READONLY_URL_ENV}`)
  console.log(`  대상 조건: isUsable · ageSignal 50s/60s · 150자+ · aiAnalyzed · 댓글 有`)
  console.log(`  batch=${BATCH_SIZE} · limit=${LIMIT ?? '(무제한 — dry-run 에서만)'}`)
  console.log(
    APPLY
      ? `  🔴 --apply : 최대 ${LIMIT}건을 실제로 적재한다`
      : '  🔍 dry-run — 판정만 한다. DB write 0 (반영은 --apply --limit=N)',
  )
  console.log('  🔴 원문 · 댓글 본문 · 닉네임을 저장하지 않는다\n')

  const unao = new pg.Client({ connectionString: unaoUrl, ssl: { rejectUnauthorized: false } })
  await unao.connect()
  const prisma = new PrismaClient()

  let scanned = 0
  let created = 0
  let skipped = 0
  let referencedPlanned = 0
  let cursor: string | null = null

  try {
    const who = (await unao.query(READ_QUERIES.whoami)).rows[0]
    console.log(`  접속 확인  role=${who.usr} · db=${who.db}`)
    const total = (await unao.query(COUNT_HIGH_QUALITY)).rows[0].n as number
    const totalRef = (await unao.query(COUNT_HIGH_QUALITY_REFERENCED)).rows[0].n as number
    const already = await prisma.voiceSource.count({ where: { origin: 'unao_cafe' } })
    console.log(`  고품질 대상 ${total}건 (그중 usedAt 있음 ${totalRef}건)`)
    console.log(`  이미 적재됨 ${already}건 → 남은 후보 약 ${total - already}건\n`)

    // ── 커서 배치 루프 ────────────────────────────────
    //    🔴 write 는 아래 APPLY 분기 안에서만 일어난다.
    const cap = LIMIT ?? total
    while (scanned < total) {
      const { text, values } = buildBatchQuery(cursor, BATCH_SIZE)
      const rows = (await unao.query(text, values)).rows as Record<string, unknown>[]
      if (rows.length === 0) break

      // 🔴 중복 조회를 **배치 단위로 묶는다**.
      //    행마다 findUnique 를 돌면 9,674번 왕복이 되어 dry-run 이 끝나지 않는다
      //    (실제로 그랬다). 한 번에 확인하고 메모리에서 판정한다.
      const refs = rows.map((r) => String(r.id ?? ''))
      const existingRefs = new Set(
        (
          await prisma.voiceSource.findMany({
            where: { origin: 'unao_cafe', sourceRef: { in: refs } },
            select: { sourceRef: true },
          })
        ).map((e) => e.sourceRef),
      )

      for (const rawRow of rows) {
        cursor = String(rawRow.id ?? '')
        scanned += 1
        const row = toSourceRow(rawRow, salt)

        // 🔴 중복은 건너뛴다 — 중단 후 재개가 이것으로 성립한다
        if (existingRefs.has(row.sourceRef)) {
          skipped += 1
          continue
        }

        if (row.referencedAt) referencedPlanned += 1

        if (!APPLY) {
          created += 1 // dry-run 에서는 "신규 예정" 을 센다
          if (created >= cap) break
          continue
        }

        await prisma.$transaction(async (tx) => {
          const src = await tx.voiceSource.create({
            data: {
              origin: row.origin,
              sourceRef: row.sourceRef,
              sourceSite: row.sourceSite,
              sourceUrl: row.sourceUrl,
              sourceBoardName: row.sourceBoardName,
              authorHash: row.authorHash,
              postedAt: row.postedAt,
              capturedAt: row.capturedAt,
              contentHash: row.contentHash,
              contentLength: row.contentLength,
              commentCount: row.commentCount,
              legacyLabels: (row.legacyLabels ?? undefined) as Prisma.InputJsonValue | undefined,
              legacyLabelVersion: row.legacyLabelVersion,
            },
            select: { id: true },
          })
          // 🔴 usedAt 이 있을 때만. approved 는 자동으로 만들지 않는다.
          if (row.referencedAt) {
            await tx.voiceJudgment.create({
              data: {
                voiceSourceId: src.id,
                decision: USED_AT_DECISION,
                reason: '우나어 큐레이션이 참조함 (CafePost.usedAt). 발행 승인이 아니다',
                decidedBy: 'unao-curation',
                decidedAt: row.referencedAt,
              },
            })
          }
        })
        created += 1
        if (created % 25 === 0) console.log(`     … ${created}건 적재`)
        if (created >= cap) break
      }
      if (created >= cap) break
    }

    // ── 보고 — 🔴 수치만. 원문 · 댓글 · 닉네임은 나오지 않는다 ──
    console.log('\n  결과')
    console.log(`     스캔        ${scanned}건`)
    console.log(`     ${APPLY ? '적재' : '신규 예정'}   ${created}건`)
    console.log(`     중복 SKIP   ${skipped}건`)
    console.log(`     referenced  ${referencedPlanned}건 (decision=${USED_AT_DECISION})`)
    console.log(`     마지막 커서 ${cursor ?? '(없음)'}`)

    if (!APPLY) {
      console.log('\n  🔍 dry-run 이었다. DB 에 아무것도 쓰지 않았다.')
      console.log('     반영하려면 --apply --limit=N 을 준다. --limit 없이는 apply 가 거부된다.\n')
      return
    }

    const [vs, vj, approved] = await Promise.all([
      prisma.voiceSource.count(),
      prisma.voiceJudgment.count(),
      prisma.voiceJudgment.count({ where: { decision: 'approved' } }),
    ])
    if (approved > 0) {
      throw new Error(`🔴 approved 판단이 ${approved}건 생겼다. usedAt 은 referenced 여야 한다`)
    }
    console.log(`\n  원장 확인  VoiceSource ${vs}건 · VoiceJudgment ${vj}건 · approved ${approved}건 ✅`)
    console.log('  🔴 원문 · 댓글 본문 · 닉네임은 저장하지 않았다. 해시와 길이만 남았다.')
    console.log(`  🔴 남은 후보가 있으면 같은 명령을 다시 실행한다 — 중복은 SKIP 된다.\n`)
  } finally {
    await unao.end()
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
