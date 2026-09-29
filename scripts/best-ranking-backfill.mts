#!/usr/bin/env tsx
/**
 * /best 입성 backfill (best-v2) — 기존 글 중 입성 기준(W ≥ 2)을 이미 넘었는데 기록이 없는 공개 글을 기록한다.
 *
 *   npm run best:backfill                     # 기본 dry-run. 아무것도 쓰지 않는다
 *   npm run best:backfill -- --apply         # 로컬(127.0.0.1)만 쓴다
 *   npm run best:backfill -- --apply --remote-ok   # 원격 DB. 🔴 운영은 승인된 절차의 한 단계로만
 *
 * 본체는 src/lib/best-ranking-db.ts backfillBestEligibility 다(격리 DB 검사가 같은 함수를 부른다).
 *   · 모든 글의 W 를 원본 행으로 다시 센다(저장값이 다르면 맞춘다)
 *   · 기준 통과 · 공개 · 기록 없음 → 새 기록(recordedBy='backfill', 입성 시각 = 실행 시각)
 *   🔴 과거 입성 시각을 추정하지 않는다. 기존 기록을 지우거나 고치지 않는다 — 어긋난 기록은 분류해 보고만 한다.
 *   🔴 멱등이다 — 두 번째 apply 는 "쓰기 합계 = 0" 이어야 한다.
 *   🔴 C-4 — 승격이 막힌 글(Micro Seed · 첫 인사)은 계산하지 않는다.
 */
import { PrismaClient } from '@prisma/client'

import { backfillBestEligibility, type BestBackfillVerdict } from '../src/lib/best-ranking-db'
import { BEST_ENTRY_WEIGHT } from '../src/lib/best-ranking'

const args = new Set(process.argv.slice(2))
const APPLY = args.has('--apply')
const URL = process.env.DATABASE_URL ?? ''
const LOCAL = /@127\.0\.0\.1:\d+\//.test(URL) || /@localhost:\d+\//.test(URL)
if (APPLY && !LOCAL && !args.has('--remote-ok')) {
  console.error('🔴 원격 DB 에 쓰려면 --remote-ok 가 필요하다. 운영은 승인된 절차로만 돌린다.')
  process.exit(2)
}

const LABEL: Record<BestBackfillVerdict, string> = {
  enter: '입성 대상',
  recorded: '이미 기록 있음',
  below: `W < ${BEST_ENTRY_WEIGHT} 미진입`,
  'not-public': '비공개 제외(숨김·삭제·게시판 밖)',
  c4: 'C-4 제외',
}

const prisma = new PrismaClient()

async function main(): Promise<void> {
  const host = URL.replace(/\/\/[^@]*@/, '//***@').replace(/\?.*$/, '')
  console.log(`■ best backfill (best-v2) — ${APPLY ? '🟠 APPLY' : 'dry-run'} · ${host}`)

  const s = await backfillBestEligibility(prisma, { apply: APPLY })

  console.log(`\n  전체 ${s.scanned} · 저장된 W 가 원본과 다른 글 ${s.weightChanged}`)
  console.log('  판정: ' + (Object.keys(LABEL) as BestBackfillVerdict[]).map((k) => `${LABEL[k]} ${s.verdicts[k]}`).join(' · '))
  console.log('\n  | 판정 | 게시판 | 상태 | W | 제목 |')
  for (const r of s.rows.sort((a, b) => b.weight - a.weight || (a.id < b.id ? -1 : 1))) {
    console.log(`  | ${LABEL[r.verdict]} | ${r.boardType} | ${r.status} | ${r.weight} | ${r.title.slice(0, 24)} |`)
  }
  console.log(`\n  기존 기록 이상 분류(지우지 않는다): ${s.anomalies.length === 0 ? '0' : ''}`)
  for (const a of s.anomalies) console.log(`   - ${a.postId} · ${a.reason}`)

  if (APPLY) {
    console.log(`\n  W 저장 ${s.weightWritten} · 새 입성 기록 ${s.created}`)
    console.log(`  쓰기 합계 = ${s.weightWritten + s.created}`)
  } else {
    console.log(`\n  W 저장 예정 ${s.weightChanged} · 새 입성 기록 예정 ${s.verdicts.enter}`)
    console.log(`  예정 쓰기 합계 = ${s.weightChanged + s.verdicts.enter}`)
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
