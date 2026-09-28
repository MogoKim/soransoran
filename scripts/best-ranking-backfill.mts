#!/usr/bin/env tsx
/**
 * /best 도입 backfill — 기존 글에 새 영구 정책을 **그대로** 적용한다.
 *
 *   npm run best:backfill                     # 기본 dry-run. 아무것도 쓰지 않는다
 *   npm run best:backfill -- --apply         # 로컬(127.0.0.1)만 쓴다
 *   npm run best:backfill -- --apply --remote-ok   # 원격 DB. 🔴 운영 적용은 APPLY.md 절차의 한 단계로만
 *
 * 하는 일
 *   1. 모든 글의 순위 키·실반응 가중치를 식으로 다시 계산한다(바뀐 글만 쓴다).
 *      쓰기는 쓰기 경로와 같은 recomputePostRanking — 글 행을 잠그고 그 순간의 원본으로 계산한다.
 *   2. 전부 끝난 뒤 **한 번** 지금 전역 12개를 보고, 실반응이 있는 글만 과거 기록을 만든다.
 *      recordedBy='backfill', 최초 진입 시각 = 이 실행 시각. 과거 어느 순간에 12위에 들었는지는
 *      재현할 수 없으므로(취소된 공감은 행이 없다) 추정해 만들지 않는다.
 *   🔴 기존 /best 20개를 특별 대우하지 않는다. legacy 이관 행을 만들지 않는다.
 *   🔴 멱등이다. 두 번째 실행은 쓰기 0 이어야 한다(출력 마지막 줄이 그것을 보여준다).
 *   🔴 C-4 — 승격이 막힌 글(Micro Seed · 첫 인사)은 계산하지 않는다.
 */
import { PrismaClient, type BoardType } from '@prisma/client'

import {
  BEST_GLOBAL_WHERE,
  countRealReactions,
  recomputePostRanking,
  recordBestEntries,
} from '../src/lib/best-ranking-db'
import {
  BEST_CURRENT_SIZE,
  BEST_RECORDED_BY,
  bestRankScore,
  hasValidReaction,
  reactionWeight,
  sameRankScore,
} from '../src/lib/best-ranking'
import {
  POST_VISIBILITY_SELECT,
  isDiscoveryEligible,
  isPromotionWriteBlocked,
  pickPostVisibility,
} from '../src/lib/post-visibility'

const args = new Set(process.argv.slice(2))
const APPLY = args.has('--apply')
const URL = process.env.DATABASE_URL ?? ''
const LOCAL = /@127\.0\.0\.1:\d+\//.test(URL) || /@localhost:\d+\//.test(URL)
if (APPLY && !LOCAL && !args.has('--remote-ok')) {
  console.error('🔴 원격 DB 에 쓰려면 --remote-ok 가 필요하다. 운영은 APPLY.md 절차로만 돌린다.')
  process.exit(2)
}

const prisma = new PrismaClient()
const BATCH = 200
const COMMUNITY_BOARDS = (BEST_GLOBAL_WHERE.boardType.in as readonly BoardType[])

type Planned = { id: string; title: string; boardType: BoardType; score: number; weight: number }

async function main(): Promise<void> {
  const host = URL.replace(/\/\/[^@]*@/, '//***@').replace(/\?.*$/, '')
  console.log(`■ best backfill — ${APPLY ? '🟠 APPLY' : 'dry-run'} · ${host}`)

  let scanned = 0
  let blocked = 0
  let changed = 0
  let written = 0
  const top: Planned[] = []
  const keep = (p: Planned) => {
    top.push(p)
    top.sort((a, b) => b.score - a.score || (a.id < b.id ? 1 : -1))
    if (top.length > BEST_CURRENT_SIZE) top.pop()
  }

  let cursor: string | undefined
  for (;;) {
    const rows = await prisma.post.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true, title: true, boardType: true, authorId: true, createdAt: true,
        bestRankScore: true, bestReactionWeight: true, ...POST_VISIBILITY_SELECT,
      },
    })
    if (rows.length === 0) break
    cursor = rows[rows.length - 1].id

    for (const row of rows) {
      scanned += 1
      const vis = pickPostVisibility(row)
      if (isPromotionWriteBlocked(vis)) {
        blocked += 1
        continue
      }
      const weight = reactionWeight(await countRealReactions(prisma, row))
      const score = bestRankScore({ createdAt: row.createdAt, weight })
      const differs = weight !== row.bestReactionWeight || !sameRankScore(score, row.bestRankScore)
      if (differs) {
        changed += 1
        if (APPLY) {
          await prisma.$transaction((tx) => recomputePostRanking(tx, row.id))
          written += 1
        }
      }
      if (isDiscoveryEligible(vis) && COMMUNITY_BOARDS.includes(row.boardType)) {
        keep({ id: row.id, title: row.title, boardType: row.boardType, score, weight })
      }
    }
  }

  const recordedIds = new Set(
    (await prisma.bestSelection.findMany({ where: { postId: { in: top.map((t) => t.id) } }, select: { postId: true } }))
      .map((r) => r.postId),
  )
  console.log(`\n  전체 ${scanned} · C-4 제외 ${blocked} · 키/가중치가 바뀔 글 ${changed}${APPLY ? ` · 쓴 글 ${written}` : ''}`)
  console.log('\n  | 순위 | 게시판 | 제목 | 실반응 가중치 | 과거 기록 |')
  top.forEach((t, i) => {
    const will = hasValidReaction(t.weight) ? (recordedIds.has(t.id) ? '이미 있음' : '새로 기록') : '— (실반응 0)'
    console.log(`  | ${i + 1} | ${t.boardType} | ${t.title.slice(0, 24)} | ${t.weight} | ${will} |`)
  })
  const toCreate = top.filter((t) => hasValidReaction(t.weight) && !recordedIds.has(t.id)).length

  let created = 0
  let peakRaised = 0
  if (APPLY) {
    const r = await prisma.$transaction((tx) => recordBestEntries(tx, BEST_RECORDED_BY.backfill))
    created = r.created
    peakRaised = r.peakRaised
  }
  console.log(
    `\n  과거 기록 ${APPLY ? `새로 만든 행 ${created} · 최고 순위 갱신 ${peakRaised}` : `만들 예정 ${toCreate}`}`,
  )
  console.log(`  ${APPLY ? '쓰기 합계' : '예정 쓰기 합계'} = ${APPLY ? written + created + peakRaised : changed + toCreate}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
