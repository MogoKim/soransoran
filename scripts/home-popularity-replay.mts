#!/usr/bin/env tsx
/**
 * 홈 "지금 뜨는 이야기" replay — 옛 점수(화면 댓글 수)와 새 점수(실반응 댓글 수)의 순서를 나란히 본다.
 *
 * 🔴 읽기 전용이다. 클라이언트 확장이 쓰기 연산을 만나면 즉시 던진다 — 어떤 행도 만들거나 고치지 않는다.
 * 🔴 보는 사람은 비로그인이다(차단 목록 없음). 홈 노출 예외(PIN·HIDE)는 "지금" 시점에만 얹는다.
 *
 *   npm run replay:home-popularity                 # 지금 + 지난 7일 매일 21:00 KST
 *   npm run replay:home-popularity -- --days 14
 *
 * 과거 시점의 한계 — 글·댓글을 createdAt ≤ 그 시각으로 자를 뿐, 그 뒤의 숨김·삭제·복구는 되돌리지 못한다
 * (지금 상태를 쓴다). 그래서 과거 시점은 "그때도 이만큼 갈렸다" 의 근사다. 판정 근거는 지금 시점이다.
 *
 * 조회 모양은 queries/posts.ts pickPopularByScore · getHomePopularPosts 와 같다
 * (게시판별 DISCOVERY 최신 60 → 점수 → 갱년기톡 최소 7 → 여유 2배 → 홈 노출 예외 → 20).
 */
import { PrismaClient, type BoardType, type CommentOrigin } from '@prisma/client'

import { HOME_POPULAR_COMMENT_WHERE } from '../src/lib/popularity-db'
import { pickHomePopular } from '../src/lib/popularity'
import { applyHomeExposure } from '../src/lib/home-exposure-rules'
import { HOME_POPULAR_COUNT } from '../src/lib/home-exposure'
import { DISCOVERY_ELIGIBLE_WHERE } from '../src/lib/post-visibility'

const WRITE_OPS = new Set([
  'create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'updateManyAndReturn',
  'upsert', 'delete', 'deleteMany', 'executeRaw', 'executeRawUnsafe', 'queryRaw', 'queryRawUnsafe',
])
const prisma = new PrismaClient().$extends({
  query: {
    $allOperations({ operation, args, query }) {
      if (WRITE_OPS.has(operation)) throw new Error(`🔴 replay 는 읽기 전용이다 — ${operation} 거부`)
      return query(args)
    },
  },
})

const argv = process.argv.slice(2)
const DAYS = Number(argv[argv.indexOf('--days') + 1]) || 7
// 운영 상수와 같다 (queries/posts.ts)
const PER_BOARD = 60
const MIN_MENOPAUSE = 7
const HEADROOM = 2

type Cand = { id: string; title: string; boardType: BoardType; createdAt: Date; shown: number; realComments: number; origins: Partial<Record<CommentOrigin, number>> }

async function candidatesAt(at: Date): Promise<Cand[]> {
  const boards: BoardType[] = ['MENOPAUSE', 'FREE']
  const posts = (
    await Promise.all(
      boards.map((boardType) =>
        prisma.post.findMany({
          where: { boardType, ...DISCOVERY_ELIGIBLE_WHERE, createdAt: { lte: at } },
          select: { id: true, title: true, boardType: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: PER_BOARD,
        }),
      ),
    )
  ).flat()
  const ids = posts.map((p) => p.id)
  const [byOrigin, real] = await Promise.all([
    prisma.comment.groupBy({
      by: ['postId', 'commentOrigin'],
      where: { postId: { in: ids }, isDeleted: false, createdAt: { lte: at } },
      _count: { _all: true },
    }),
    prisma.comment.groupBy({
      by: ['postId'],
      where: { postId: { in: ids }, createdAt: { lte: at }, ...HOME_POPULAR_COMMENT_WHERE },
      _count: { _all: true },
    }),
  ])
  const realMap = new Map(real.map((r) => [r.postId, r._count._all]))
  return posts.map((p) => {
    const origins: Cand['origins'] = {}
    let shown = 0
    for (const r of byOrigin) {
      if (r.postId !== p.id) continue
      origins[r.commentOrigin] = r._count._all
      shown += r._count._all
    }
    return { ...p, shown, realComments: realMap.get(p.id) ?? 0, origins }
  })
}

function rank(cands: Cand[], at: Date, axis: 'old' | 'new', take: number): Cand[] {
  const scored = cands.map((c) => ({ ...c, realComments: axis === 'old' ? c.shown : c.realComments, orig: c }))
  return pickHomePopular({
    menopause: scored.filter((c) => c.boardType === 'MENOPAUSE'),
    free: scored.filter((c) => c.boardType === 'FREE'),
    take,
    minMenopause: MIN_MENOPAUSE,
    now: at,
  }).map((c) => c.orig)
}

function diff(oldList: Cand[], newList: Cand[]) {
  const oldIdx = new Map(oldList.map((c, i) => [c.id, i]))
  const newIdx = new Map(newList.map((c, i) => [c.id, i]))
  const entered = newList.filter((c) => !oldIdx.has(c.id))
  const exited = oldList.filter((c) => !newIdx.has(c.id))
  const samePos = newList.filter((c, i) => oldIdx.get(c.id) === i).length
  const moved = newList.length - samePos
  return { entered, exited, samePos, moved, oldIdx }
}

const kst = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace('T', ' ')
const short = (id: string) => id.slice(-6)
const originLabel = (o: Cand['origins']) =>
  (Object.entries(o) as [CommentOrigin, number][]).map(([k, v]) => `${k[0]}${k === 'MICRO_SEED_VERBATIM' ? 'S' : ''}${v}`).join(' ') || '-'

async function main(): Promise<void> {
  const host = (process.env.DATABASE_URL ?? '').replace(/\/\/[^@]*@/, '//***@').replace(/\?.*$/, '')
  console.log(`■ 홈 인기 replay — 읽기 전용 · ${host}`)

  // ── 지금 시점: 홈 노출 예외까지 얹은 실제 20개 ──
  const now = new Date()
  const cands = await candidatesAt(now)
  const overrides = await prisma.homeExposureOverride.findMany({
    where: { surface: 'HOME_POPULAR', isActive: true },
    select: { postId: true, action: true, position: true, isActive: true, expiresAt: true },
  })
  const pinIds = overrides.filter((o) => o.action === 'PIN').map((o) => o.postId)
  const pinned = cands.filter((c) => pinIds.includes(c.id)) // 후보 밖 PIN 은 아래에 따로 표시
  const take = HOME_POPULAR_COUNT
  const oldHome = applyHomeExposure({ candidates: rank(cands, now, 'old', take * HEADROOM), pinnedPosts: pinned, overrides, take, now })
  const newHome = applyHomeExposure({ candidates: rank(cands, now, 'new', take * HEADROOM), pinnedPosts: pinned, overrides, take, now })

  const totals: Partial<Record<CommentOrigin, number>> = {}
  for (const c of cands) for (const [k, v] of Object.entries(c.origins) as [CommentOrigin, number][]) totals[k] = (totals[k] ?? 0) + v
  const shownSum = cands.reduce((s, c) => s + c.shown, 0)
  const realSum = cands.reduce((s, c) => s + c.realComments, 0)
  console.log(`\n[지금 ${kst(now)} KST] 후보 ${cands.length}글 · 화면 댓글 ${shownSum} · 실반응 ${realSum}`)
  console.log(`  출처별(삭제 제외): ${JSON.stringify(totals)}`)
  console.log(`  MEMBER·GUEST 표기 중 실반응에서 탈락(실회원 아님·작성 축 모순): ${(totals.MEMBER ?? 0) + (totals.GUEST ?? 0) - realSum}`)
  console.log(`  활성 예외: PIN ${pinIds.length}(후보 밖 ${pinIds.filter((id) => !cands.some((c) => c.id === id)).length}) · HIDE ${overrides.filter((o) => o.action === 'HIDE').length}`)

  const d = diff(oldHome, newHome)
  console.log(`\n  홈 20 — 자리 그대로 ${d.samePos} · 자리 바뀜 ${d.moved} · 새로 듦 ${d.entered.length} · 빠짐 ${d.exited.length}`)
  console.log('\n  | 새 순위 | 옛 순위 | 글 | 게시판 | 작성 | 화면 댓글 | 실반응 | 출처 |')
  newHome.forEach((c, i) => {
    const o = d.oldIdx.get(c.id)
    console.log(`  | ${i + 1} | ${o === undefined ? '밖' : o + 1} | …${short(c.id)} | ${c.boardType} | ${kst(c.createdAt)} | ${c.shown} | ${c.realComments} | ${originLabel(c.origins)} |`)
  })
  if (d.exited.length) {
    console.log('\n  빠진 글(옛 20 → 새 20 밖)')
    for (const c of d.exited) console.log(`  | 옛 ${d.oldIdx.get(c.id)! + 1} | …${short(c.id)} | ${c.boardType} | 화면 ${c.shown} · 실반응 ${c.realComments} | ${originLabel(c.origins)} |`)
  }
  const realInOld = oldHome.filter((c) => c.realComments > 0).length
  const realInNew = newHome.filter((c) => c.realComments > 0).length
  console.log(`\n  실반응이 1 이상인 글: 옛 20 중 ${realInOld} → 새 20 중 ${realInNew} (후보 전체 ${cands.filter((c) => c.realComments > 0).length})`)
  const top5 = (l: Cand[]) => l.slice(0, 5).map((c) => c.id)
  console.log(`  상위 5 겹침: ${top5(newHome).filter((id) => top5(oldHome).includes(id)).length}/${Math.min(5, newHome.length)}`)

  // ── 지난 시점: 예외 없이 점수 순서 20 (근사) ──
  console.log(`\n[지난 ${DAYS}일 · 매일 21:00 KST · 예외 미적용 · 근사]`)
  console.log('  | 시점 | 후보 | 화면 댓글 | 실반응 | 자리 그대로 | 새로 듦 | 실반응 글 옛→새 |')
  for (let i = 1; i <= DAYS; i += 1) {
    const day = new Date(now.getTime() - i * 86_400_000)
    const at = new Date(`${kst(day).slice(0, 10)}T12:00:00Z`) // 21:00 KST
    const cs = await candidatesAt(at)
    const o = rank(cs, at, 'old', take)
    const n = rank(cs, at, 'new', take)
    const dd = diff(o, n)
    console.log(`  | ${kst(at)} | ${cs.length} | ${cs.reduce((s, c) => s + c.shown, 0)} | ${cs.reduce((s, c) => s + c.realComments, 0)} | ${dd.samePos}/${n.length} | ${dd.entered.length} | ${o.filter((c) => c.realComments > 0).length}→${n.filter((c) => c.realComments > 0).length} |`)
  }
  console.log('\n  쓰기 0 — 확장이 쓰기 연산을 거부한다')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
