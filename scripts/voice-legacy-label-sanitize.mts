#!/usr/bin/env tsx
/**
 * 이미 적재된 VoiceSource 의 legacyLabels 정화 (VE-R3.1)
 *
 * 정본: docs/operations/2026-08-27-voice-engine-schema-strategy.md §1
 *
 * 🔴 무엇을 고치는가
 *    VoiceSource 는 `content` 를 저장하지 않는데, **라벨을 통해 원문이 새어 들어왔다.**
 *    100건 적재 검증에서 `emotionalPeak` 39자 중 30자가 본문과 연속 일치했다
 *    (111건 중 1건). 배치 경로는 `toSourceRow` 에서 막았고,
 *    이 스크립트는 **그 가드가 생기기 전에 들어온 행**을 같은 기준으로 되돌린다.
 *
 * 🔴 dry-run 이 기본이다
 *    바꾸려면 `--apply` 를 명시해야 한다. 판정만 하는 실행이 사고를 내지 않아야 한다.
 *
 * 🔴 건드리는 컬럼은 `legacyLabels` 와 `legacyLabelVersion` 뿐이다
 *    contentHash · authorHash · judgment 는 그대로 둔다.
 *    행을 지우지 않는다 — 오염된 것은 키 하나이지 그 행 전체가 아니다.
 *
 * 🔴 Micro Seed 원장을 읽지도 쓰지도 않는다
 *    Candidate · RawContent · Post · History · Sheet 는 이 스크립트의 범위 밖이다.
 *
 * 사용법
 *   npm run voice:label-sanitize            판정만 (DB write 0)
 *   npm run voice:label-sanitize -- --apply 실제 정화
 */
import pg from 'pg'
import { PrismaClient, Prisma } from '@prisma/client'
import {
  LEAK_RUN_MIN, loadUnaoReadonlyUrl, maskConnectionString,
  sanitizeLegacyLabels, topCommentsToText, LEGACY_LABEL_VERSION,
} from './lib/voice-unao-readonly.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const APPLY = process.argv.includes('--apply')

/** 🔴 우나어에서 읽는 유일한 쿼리. SELECT 다 */
const READ_SOURCE = 'SELECT content, "topComments" FROM "CafePost" WHERE id = $1'

async function main() {
  await loadEnvLocal()
  const unaoUrl = loadUnaoReadonlyUrl()

  console.log('\nVoice — 적재된 legacyLabels 정화 (원문 누출 키 제거)')
  console.log(`  우나어 읽기: ${maskConnectionString(unaoUrl)}`)
  console.log(`  기준: 라벨 값이 원문 · 댓글과 ${LEAK_RUN_MIN}자 이상 연속 일치하면 그 키만 버린다`)
  console.log(
    APPLY
      ? '  🔴 --apply : legacyLabels 를 실제로 고친다 (다른 컬럼 · 다른 테이블은 건드리지 않는다)'
      : '  🔍 dry-run — 판정만 한다. DB write 0 (반영은 --apply)',
  )
  console.log('  🔴 걸러진 값은 출력하지 않는다. 키 이름과 건수만 남긴다\n')

  const unao = new pg.Client({ connectionString: unaoUrl, ssl: { rejectUnauthorized: false } })
  await unao.connect()
  const prisma = new PrismaClient()

  let scanned = 0
  let dirty = 0
  let fixed = 0
  let missingSource = 0
  const keyCounts = new Map<string, number>()

  try {
    const rows = await prisma.voiceSource.findMany({
      where: { origin: 'unao_cafe', NOT: { legacyLabels: { equals: Prisma.DbNull } } },
      select: { id: true, sourceRef: true, legacyLabels: true },
      orderBy: { createdAt: 'asc' },
    })
    console.log(`  대상 ${rows.length}건 (legacyLabels 가 있는 unao_cafe 행)\n`)

    for (const row of rows) {
      scanned += 1
      const labels = row.legacyLabels as Record<string, unknown> | null
      if (!labels) continue

      const res = await unao.query(READ_SOURCE, [row.sourceRef])
      if (!res.rows[0]) {
        // 🔴 원본이 사라졌으면 판정하지 않는다. 근거 없이 지우지 않는다
        missingSource += 1
        continue
      }
      const content = typeof res.rows[0].content === 'string' ? res.rows[0].content : ''
      const commentsText = topCommentsToText(res.rows[0].topComments)

      const { labels: safe, dropped } = sanitizeLegacyLabels(labels, [content, commentsText])
      if (dropped.length === 0) continue

      dirty += 1
      for (const k of dropped) keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1)
      console.log(`     ${row.sourceRef}  drop=${dropped.join(',')}  남는 라벨 ${safe ? Object.keys(safe).length : 0}종`)

      if (!APPLY) continue
      await prisma.voiceSource.update({
        where: { id: row.id },
        data: {
          legacyLabels: (safe ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull,
          legacyLabelVersion: safe ? LEGACY_LABEL_VERSION : null,
        },
      })
      fixed += 1
    }

    console.log('\n  결과')
    console.log(`     검사      ${scanned}건`)
    console.log(`     누출 발견 ${dirty}건`)
    console.log(`     원본 없음 ${missingSource}건 (판정하지 않았다)`)
    if (keyCounts.size > 0) {
      const detail = [...keyCounts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(' · ')
      console.log(`     드롭 키   ${detail}`)
    }
    console.log(`     ${APPLY ? '정화 완료' : '정화 예정'} ${APPLY ? fixed : dirty}건`)

    if (!APPLY) {
      console.log('\n  🔍 판정만 했다. DB 에 아무것도 쓰지 않았다. 바꾸려면 --apply 를 붙인다.\n')
      return
    }
    console.log('\n  🔴 legacyLabels 외의 컬럼 · 다른 테이블은 건드리지 않았다.\n')
  } finally {
    await unao.end()
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
