#!/usr/bin/env tsx
/**
 * 우나어 CafePost → VoiceSource 샘플 적재 (VE-R2)
 *
 * 정본: docs/operations/2026-08-27-voice-engine-schema-strategy.md §1 · §6-2
 *
 * 🔴 이 스크립트는 **원문을 옮기지 않는다**
 *    우나어 `content` · `topComments[].content` · `author` 닉네임을
 *    소란소란 DB 에 저장하지 않는다. 남기는 것은 참조와 증거뿐이다:
 *      sourceRef · sourceUrl · contentHash · contentLength · commentCount · legacyLabels
 *    본문은 해시를 계산하는 순간에만 메모리에 있고, 그대로 버려진다.
 *
 * 🔴 두 DB 를 반대로 쓰지 않는다
 *    우나어 읽기 = UNAO_READONLY_DATABASE_URL (SELECT 만 가진 role)
 *    소란소란 쓰기 = Prisma (VoiceSource · VoiceJudgment 만)
 *    한쪽 커넥션으로 다른 쪽을 건드리는 경로가 없다.
 *
 * 🔴 usedAt 은 referenced 다. approved 가 아니다
 *    6,494건 중 발행으로 이어진 것은 13건(0.2%)뿐이고,
 *    우나어 스키마 주석도 "큐레이션 참조 시각" 이다.
 *    approved 로 넣으면 "사람이 승인했다" 는 거짓 정답지가 만들어진다.
 *
 * 🔴 이번 PR 은 **1건 샘플**이다
 *    33,031건 배치가 아니다. --limit=1 이 아니면 apply 를 거부한다.
 *    첫 행에서 해시 · 라벨 14종 · referenced 매핑을 눈으로 확인한 뒤
 *    배치를 별도로 논의한다.
 *
 * 사용법
 *   npm run voice:unao-import                      판정만 (DB write 0)
 *   npm run voice:unao-import -- --limit=1          판정만
 *   npm run voice:unao-import -- --limit=1 --apply  실제 적재 1건
 */
import pg from 'pg'
import { PrismaClient, type Prisma } from '@prisma/client'
import {
  UNAO_READONLY_URL_ENV, READ_QUERIES, USED_AT_DECISION,
  loadUnaoReadonlyUrl, maskConnectionString, toSourceRow, countTopComments, summarize,
} from './lib/voice-unao-readonly.mjs'
// 🔴 소란소란 DB 접속용. Prisma 가 DATABASE_URL 을 읽으려면 .env.local 이 먼저 올라와야 한다.
//    커넥터 lib 은 이것을 쓰지 않는다 — 우나어 쪽은 자기 URL 만 본다.
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const APPLY = process.argv.includes('--apply')
const arg = (n: string): string | undefined => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}
const LIMIT_RAW = arg('limit')
const LIMIT = LIMIT_RAW === undefined ? null : Number(LIMIT_RAW)

/**
 * 닉네임 해시 salt.
 * 🔴 salt 가 바뀌면 동일인 추적이 끊긴다. 값을 바꾸려면 기존 authorHash 를 어떻게 할지
 *    먼저 정해야 한다 (schema-strategy §8-3).
 */
const AUTHOR_SALT_ENV = 'VOICE_AUTHOR_HASH_SALT'
const DEFAULT_SALT = 'soransoran-voice-v1'

/** 로그에 URL 전체를 남기지 않는다 — 역추적은 DB 값으로 한다 */
function maskUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.hostname}${u.pathname.slice(0, 12)}…`
  } catch {
    return '(URL 파싱 불가)'
  }
}

async function main() {
  await loadEnvLocal()
  const salt = (process.env[AUTHOR_SALT_ENV] ?? DEFAULT_SALT).trim()
  const unaoUrl = loadUnaoReadonlyUrl()

  console.log('\nVoice — 우나어 CafePost → VoiceSource 샘플 적재')
  console.log(`  우나어 읽기: ${maskConnectionString(unaoUrl)}`)
  console.log(`  ${UNAO_READONLY_URL_ENV} · SELECT 전용 role`)
  console.log(
    APPLY && LIMIT === 1
      ? '  🔴 --apply --limit=1 : VoiceSource 1건을 실제로 적재한다'
      : '  🔍 dry-run — 판정만 한다. DB write 0 (반영은 --apply --limit=1 둘 다 필요)',
  )
  console.log('  🔴 원문 · 댓글 본문 · 닉네임을 저장하지 않는다. 해시와 길이만 남긴다\n')

  // ── ① 우나어에서 1건 읽기 (read-only) ────────────────
  const unao = new pg.Client({ connectionString: unaoUrl, ssl: { rejectUnauthorized: false } })
  await unao.connect()
  let raw: Record<string, unknown> | undefined
  let topCommentsCount = 0
  try {
    const who = (await unao.query(READ_QUERIES.whoami)).rows[0]
    console.log(`  접속 확인  role=${who.usr} · db=${who.db}`)
    const res = await unao.query(READ_QUERIES.sampleOne)
    raw = res.rows[0]
    if (!raw) {
      console.log('\n  대상이 없다. 조건에 맞는 CafePost 가 0건이다.\n')
      return
    }
    topCommentsCount = countTopComments(raw.topComments)
  } finally {
    await unao.end()
  }

  // ── ② VoiceSource 후보로 변환 — 🔴 본문은 여기서 버려진다 ──
  const row = toSourceRow(raw, salt)
  const summary = summarize(row, topCommentsCount)

  console.log('\n  읽은 원문 (요약만 — 본문 · 댓글 · 닉네임 미출력)')
  console.log(`     sourceRef        ${summary.sourceRef}`)
  console.log(`     contentLength    ${summary.contentLength}자`)
  console.log(`     commentCount     ${summary.commentCount}`)
  console.log(`     topCommentsCount ${summary.topCommentsCount}`)
  console.log(`     hasLegacyLabels  ${summary.hasLegacyLabels}`)
  console.log(`     referenced       ${summary.referenced}${summary.referenced ? ' (usedAt 있음)' : ''}`)

  console.log('\n  VoiceSource 에 저장할 값')
  console.log(`     origin           ${row.origin}`)
  console.log(`     sourceSite       ${row.sourceSite}`)
  console.log(`     sourceUrl        ${maskUrl(row.sourceUrl)}`)
  console.log(`     sourceBoardName  ${row.sourceBoardName ?? '(없음)'}`)
  console.log(`     authorHash       ${row.authorHash ? `${row.authorHash.slice(0, 20)}…` : '(없음)'}`)
  console.log(`     contentHash      ${row.contentHash ? `${row.contentHash.slice(0, 20)}…` : '(없음)'}`)
  console.log(`     contentLength    ${row.contentLength}`)
  console.log(`     postedAt         ${row.postedAt?.toISOString() ?? 'null'}`)
  console.log(`     capturedAt       ${row.capturedAt.toISOString()}`)
  console.log(`     legacyLabels     ${row.legacyLabels ? `${Object.keys(row.legacyLabels).length}종` : 'null'}`)
  console.log(`     legacyLabelVer   ${row.legacyLabelVersion ?? 'null'}`)
  console.log('     🔴 content · rawBody · topComments · author 원문 → 저장하지 않는다')

  // ── ③ 소란소란 원장 — 중복 확인 ──────────────────────
  const prisma = new PrismaClient()
  try {
    const existing = await prisma.voiceSource.findUnique({
      where: { origin_sourceRef: { origin: row.origin, sourceRef: row.sourceRef } },
      select: { id: true, createdAt: true },
    })
    if (existing) {
      console.log(`\n  ⏭️  SKIP — 이미 있다 (id=${existing.id})`)
      console.log('     🔴 같은 원천을 두 번 등록하지 않는다 (UNIQUE origin+sourceRef)\n')
      return
    }

    // 🔴 usedAt 이 있으면 referenced 판단이 따라온다. approved 가 아니다.
    const willJudge = row.referencedAt !== null
    if (willJudge) {
      console.log(`\n  VoiceJudgment 도 함께 남긴다`)
      console.log(`     decision   ${USED_AT_DECISION}   🔴 approved 아님 (usedAt = 큐레이션 참조 시각)`)
      console.log(`     decidedBy  unao-curation`)
      console.log(`     decidedAt  ${row.referencedAt?.toISOString()}`)
    }

    if (!APPLY || LIMIT !== 1) {
      console.log('\n  🔍 dry-run 이었다. DB 에 아무것도 쓰지 않았다.')
      if (APPLY && LIMIT !== 1) {
        console.log('     🔴 --apply 를 줬지만 --limit=1 이 아니라 거부했다.')
        console.log('        이번 단계는 샘플 1건이다. 배치는 별도 논의한다.')
      } else if (!APPLY) {
        console.log('     반영하려면 --apply --limit=1 을 둘 다 준다.')
      }
      console.log('')
      return
    }

    // ── ④ 적재 — VoiceSource (+ referenced 면 VoiceJudgment) ──
    const created = await prisma.$transaction(async (tx) => {
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
      return src.id
    })
    console.log(`\n  ✅ VoiceSource 적재 (id=${created})`)

    // ── ⑤ read-back — 저장된 것이 기대와 같은가 ──────────
    const back = await prisma.voiceSource.findUniqueOrThrow({
      where: { id: created },
      select: {
        origin: true, sourceRef: true, contentHash: true, contentLength: true,
        commentCount: true, authorHash: true, legacyLabels: true, legacyLabelVersion: true,
      },
    })
    if (back.contentHash !== row.contentHash) {
      // 🔴 해시도 앞부분만 남긴다. 원문 복원은 불가하지만 로그 기록을 최소로 둔다
      throw new Error(
        `read-back 불일치: contentHash ${back.contentHash?.slice(0, 20)}… ≠ ${row.contentHash?.slice(0, 20)}…`,
      )
    }
    if (back.contentLength !== row.contentLength) {
      throw new Error(`read-back 불일치: contentLength ${back.contentLength} ≠ ${row.contentLength}`)
    }
    const labelCount = back.legacyLabels ? Object.keys(back.legacyLabels as object).length : 0
    console.log(`     read-back ✅ contentHash 일치 · ${back.contentLength}자 · 라벨 ${labelCount}종`)

    const judgments = await prisma.voiceJudgment.findMany({
      where: { voiceSourceId: created },
      select: { decision: true, decidedBy: true },
    })
    for (const j of judgments) {
      if (j.decision === 'approved') {
        throw new Error('🔴 approved 판단이 생겼다. usedAt 은 referenced 여야 한다')
      }
      console.log(`     VoiceJudgment ✅ decision=${j.decision} · by=${j.decidedBy}`)
    }
    console.log('\n  🔴 원문 · 댓글 본문 · 닉네임은 저장하지 않았다. 해시와 길이만 남았다.')
    console.log('  🔴 배치 적재는 하지 않았다 — 33,031건은 별도 논의다.\n')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
