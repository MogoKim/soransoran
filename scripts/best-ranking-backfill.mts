#!/usr/bin/env tsx
/**
 * /best 도입 backfill — 기존 글에 새 영구 정책을 **그대로** 적용한다.
 *
 *   npm run best:backfill                     # 기본 dry-run. 아무것도 쓰지 않는다
 *   npm run best:backfill -- --apply         # 로컬(127.0.0.1)만 쓴다
 *   npm run best:backfill -- --apply --remote-ok   # 원격 DB. 🔴 운영은 승인된 절차의 한 단계로만
 *
 * 본체는 src/lib/best-ranking-db.ts backfillBestRanking 이다(격리 DB 검사가 같은 함수를 부른다).
 *   1. 모든 글의 순위 키·실반응 가중치를 식으로 다시 계산한다(바뀐 글만 쓴다)
 *   2. 전부 끝난 뒤 **한 번** 지금 전역 12개를 보고, 실반응이 있는 글만 과거 기록을 만든다
 *      recordedBy='backfill', 최초 진입 시각 = 이 실행 시각. 과거 순간을 추정해 만들지 않는다
 *   🔴 기존 /best 20개를 특별 대우하지 않는다. legacy 이관 행을 만들지 않는다
 *   🔴 멱등이다 — 두 번째 apply 는 "쓰기 합계 = 0" 이어야 한다
 *   🔴 C-4 — 승격이 막힌 글(Micro Seed · 첫 인사)은 계산하지 않는다
 */
import { PrismaClient } from '@prisma/client'

import { backfillBestRanking } from '../src/lib/best-ranking-db'
import { hasValidReaction } from '../src/lib/best-ranking'

const args = new Set(process.argv.slice(2))
const APPLY = args.has('--apply')
const URL = process.env.DATABASE_URL ?? ''
const LOCAL = /@127\.0\.0\.1:\d+\//.test(URL) || /@localhost:\d+\//.test(URL)
if (APPLY && !LOCAL && !args.has('--remote-ok')) {
  console.error('🔴 원격 DB 에 쓰려면 --remote-ok 가 필요하다. 운영은 승인된 절차로만 돌린다.')
  process.exit(2)
}

const prisma = new PrismaClient()

async function main(): Promise<void> {
  const host = URL.replace(/\/\/[^@]*@/, '//***@').replace(/\?.*$/, '')
  console.log(`■ best backfill — ${APPLY ? '🟠 APPLY' : 'dry-run'} · ${host}`)

  const s = await backfillBestRanking(prisma, { apply: APPLY })

  console.log(`\n  전체 ${s.scanned} · C-4 제외 ${s.blocked} · 키/가중치가 바뀔 글 ${s.changed}${APPLY ? ` · 쓴 글 ${s.written}` : ''}`)
  console.log('\n  | 순위 | 게시판 | 제목 | 실반응 가중치 | 과거 기록 |')
  s.top.forEach((t, i) => {
    const will = hasValidReaction(t.weight) ? (t.recorded ? '이미 있음' : '새로 기록') : '— (실반응 0)'
    console.log(`  | ${i + 1} | ${t.boardType} | ${t.title.slice(0, 24)} | ${t.weight} | ${will} |`)
  })
  console.log(
    `\n  과거 기록 ${APPLY ? `새로 만든 행 ${s.created} · 최고 순위 갱신 ${s.peakRaised}` : `만들 예정 ${s.toCreate}`}`,
  )
  console.log(`  ${APPLY ? '쓰기 합계' : '예정 쓰기 합계'} = ${APPLY ? s.written + s.created + s.peakRaised : s.changed + s.toCreate}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
