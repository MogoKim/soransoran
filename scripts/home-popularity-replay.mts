#!/usr/bin/env tsx
/**
 * 홈 "지금 뜨는 이야기" replay — 옛 점수(화면 댓글 수)와 새 점수(실반응 신호)의 순서를 나란히 본다.
 *
 * 🔴 읽기 전용이다. 클라이언트 확장이 **허용 목록**(find·count·groupBy·aggregate) 밖의 연산을 모두 던진다.
 *    raw query 도 허용 목록 밖이다. 운영 데이터를 한 줄도 읽기 전에 그 차단을 먼저 증명한다(proveWriteBlocked) —
 *    증명이 어긋나면 아무것도 읽지 않고 멈춘다.
 * 🔴 제목·본문·작성자·원문 ID 를 출력하지 않는다. 글은 회차마다 새로 뽑는 salt 의 해시로만 부른다 —
 *    같은 회차 안에서만 이어 볼 수 있고, 다른 회차나 DB 의 id 와 대조할 수 없다. 나머지는 집계뿐이다.
 *    제목·본문은 select 에도 넣지 않는다.
 * 🔴 보는 사람은 비로그인이다(차단 목록 없음). 홈 노출 예외(PIN·HIDE)는 "지금" 시점에만 얹는다.
 *
 *   npm run replay:home-popularity                 # 지금 + 지난 7일 매일 21:00 KST
 *   npm run replay:home-popularity -- --days 14
 *
 * 과거 시점의 한계 — 글·댓글을 createdAt ≤ 그 시각으로 자를 뿐, 그 뒤의 숨김·삭제·복구는 되돌리지 못한다
 * (지금 상태를 쓴다). 그래서 과거 시점은 근사다. 판정 근거는 지금 시점이다.
 *
 * 새 축은 화면 경로와 **같은 함수**(withRealReactions)로 센다 — replay 용으로 다시 적지 않는다.
 * 조회 모양은 queries/posts.ts pickPopularByScore · getHomePopularPosts 와 같다
 * (게시판별 DISCOVERY 최신 60 → 점수 → 갱년기톡 최소 7 → 여유 2배 → 홈 노출 예외 → 20).
 *
 * 지금 시점은 홈 편성(composeHomePopularViews)도 같은 후보로 돌려 — mobile 이 위 20 과 id·순서가 같은지 대조하고
 * (다르면 exit 1), 데스크톱 게시판별 10|10 을 같은 해시로 보여준다.
 */
import { createHash, randomBytes } from 'node:crypto'
import { PrismaClient, type BoardType, type CommentOrigin, type Prisma } from '@prisma/client'

import { withRealReactions } from '../src/lib/popularity-db'
import { pickHomePopular } from '../src/lib/popularity'
import { applyHomeExposure } from '../src/lib/home-exposure-rules'
import {
  HOME_OVERRIDE_HEADROOM,
  HOME_POPULAR_CANDIDATES_PER_BOARD,
  HOME_POPULAR_COUNT,
  HOME_POPULAR_MIN_MENOPAUSE,
} from '../src/lib/home-exposure'
import { composeHomePopularViews } from '../src/lib/home-popular-views'
import { DISCOVERY_ELIGIBLE_WHERE } from '../src/lib/post-visibility'

const READ_OPS = new Set([
  'findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow', 'count', 'groupBy', 'aggregate',
])
const GUARD = 'replay 읽기 전용 — 거부'
const prisma = new PrismaClient().$extends({
  query: {
    $allOperations({ operation, args, query }) {
      if (!READ_OPS.has(operation)) throw new Error(`${GUARD}: ${operation}`)
      return query(args)
    },
  },
})

/**
 * 운영 데이터를 읽기 전에 쓰기 차단을 증명한다.
 * 존재할 수 없는 id 로 쓰기를 시도한다 — 차단이 깨져 있어도 바뀌는 행은 0 이다.
 * 🔴 차단 오류로 거부돼야만 통과다. 다른 오류(DB 접속 실패 등)나 성공은 실패다.
 */
async function proveWriteBlocked(): Promise<void> {
  const NEVER = '__replay_write_probe_never_exists__'
  const probes: [string, () => Promise<unknown>][] = [
    ['post.updateMany', () => prisma.post.updateMany({ where: { id: NEVER }, data: { viewCount: { increment: 0 } } })],
    ['post.update', () => prisma.post.update({ where: { id: NEVER }, data: { viewCount: { increment: 0 } } })],
    ['comment.deleteMany', () => prisma.comment.deleteMany({ where: { id: NEVER } })],
    ['homeExposureOverride.create', () => prisma.homeExposureOverride.create({ data: { postId: NEVER, surface: 'HOME_POPULAR', action: 'HIDE' } })],
    ['bestSelection.upsert', () => prisma.bestSelection.upsert({ where: { postId: NEVER }, create: { postId: NEVER, policyVersion: 'x', recordedBy: 'x', scoreAtEntry: 0, peakRank: 0 }, update: {} })],
  ]
  for (const [name, run] of probes) {
    const verdict = await run().then(
      () => 'went-through',
      (e: unknown) => (e instanceof Error && e.message.startsWith(GUARD) ? 'blocked' : `other-error: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`),
    )
    console.log(`  ${verdict === 'blocked' ? '✅' : '🔴'} ${name} → ${verdict}`)
    if (verdict !== 'blocked') {
      console.error('🔴 쓰기 차단 증명 실패 — 아무것도 읽지 않고 멈춘다')
      process.exit(3)
    }
  }
}

const argv = process.argv.slice(2)
const DAYS = Number(argv[argv.indexOf('--days') + 1]) || 7
// 운영 상수 정본(home-exposure.ts)을 그대로 쓴다 — 옮겨 적으면 한쪽만 바뀐다
const PER_BOARD = HOME_POPULAR_CANDIDATES_PER_BOARD
const MIN_MENOPAUSE = HOME_POPULAR_MIN_MENOPAUSE
const HEADROOM = HOME_OVERRIDE_HEADROOM

const SALT = randomBytes(16)
const tag = (id: string) => 'h' + createHash('sha256').update(SALT).update(id).digest('hex').slice(0, 8)

type Cand = { id: string; boardType: BoardType; createdAt: Date; shown: number; realReactions: number }

async function candidatesAt(at: Date): Promise<{ cands: Cand[]; origins: Partial<Record<CommentOrigin, number>> }> {
  const boards: BoardType[] = ['MENOPAUSE', 'FREE']
  const posts = (
    await Promise.all(
      boards.map((boardType) =>
        prisma.post.findMany({
          where: { boardType, ...DISCOVERY_ELIGIBLE_WHERE, createdAt: { lte: at } },
          select: { id: true, boardType: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: PER_BOARD,
        }),
      ),
    )
  ).flat()
  const ids = posts.map((p) => p.id)
  const [byOrigin, withSignal] = await Promise.all([
    prisma.comment.groupBy({
      by: ['postId', 'commentOrigin'],
      where: { postId: { in: ids }, isDeleted: false, createdAt: { lte: at } },
      _count: { _all: true },
    }),
    // 🔴 확장 클라이언트를 그대로 넘긴다 — 쓰기 차단은 런타임 확장이 하고, 타입만 TransactionClient 로 맞춘다.
    //    (query 확장은 모델 모양을 바꾸지 않는다. 새 사본을 만들면 차단이 빠지므로 다른 클라이언트를 만들지 않는다)
    withRealReactions(prisma as unknown as Prisma.TransactionClient, posts, { asOf: at }),
  ])
  const shown = new Map<string, number>()
  const origins: Partial<Record<CommentOrigin, number>> = {}
  for (const r of byOrigin) {
    shown.set(r.postId, (shown.get(r.postId) ?? 0) + r._count._all)
    origins[r.commentOrigin] = (origins[r.commentOrigin] ?? 0) + r._count._all
  }
  return { cands: withSignal.map((p) => ({ ...p, shown: shown.get(p.id) ?? 0 })), origins }
}

function rank(cands: Cand[], at: Date, axis: 'old' | 'new', take: number): Cand[] {
  const scored = cands.map((c) => ({ ...c, realReactions: axis === 'old' ? c.shown : c.realReactions, orig: c }))
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
  const newIds = new Set(newList.map((c) => c.id))
  const entered = newList.filter((c) => !oldIdx.has(c.id))
  const exited = oldList.filter((c) => !newIds.has(c.id))
  const samePos = newList.filter((c, i) => oldIdx.get(c.id) === i).length
  return { entered, exited, samePos, moved: newList.length - samePos, oldIdx }
}

const kst = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace('T', ' ')
const ageH = (c: Cand, now: Date) => ((now.getTime() - c.createdAt.getTime()) / 3600_000).toFixed(1)

async function main(): Promise<void> {
  const host = (process.env.DATABASE_URL ?? '').replace(/^.*@/, '').replace(/[/?].*$/, '')
  console.log(`■ 홈 인기 replay — 읽기 전용 · host ${host}`)
  console.log('\n[0] 쓰기 차단 증명 (운영 데이터를 읽기 전)')
  await proveWriteBlocked()

  // ── 지금 시점: 홈 노출 예외까지 얹은 실제 20개 ──
  const now = new Date()
  const { cands, origins } = await candidatesAt(now)
  const overrides = await prisma.homeExposureOverride.findMany({
    where: { surface: 'HOME_POPULAR', isActive: true },
    select: { postId: true, action: true, position: true, isActive: true, expiresAt: true },
  })
  const pinIds = new Set(overrides.filter((o) => o.action === 'PIN').map((o) => o.postId))
  const pinned = cands.filter((c) => pinIds.has(c.id))
  const take = HOME_POPULAR_COUNT
  const oldHome = applyHomeExposure({ candidates: rank(cands, now, 'old', take * HEADROOM), pinnedPosts: pinned, overrides, take, now })
  const newHome = applyHomeExposure({ candidates: rank(cands, now, 'new', take * HEADROOM), pinnedPosts: pinned, overrides, take, now })

  const sum = (l: Cand[], k: 'shown' | 'realReactions') => l.reduce((s, c) => s + c[k], 0)
  console.log(`\n[1] 지금 ${kst(now)} KST — 후보 ${cands.length}글 · 화면 댓글 ${sum(cands, 'shown')} · 실반응 신호 합 ${sum(cands, 'realReactions')}`)
  console.log(`  출처별 댓글(삭제 제외): ${JSON.stringify(origins)}`)
  console.log(`  실반응 신호 ≥ 1 인 후보: ${cands.filter((c) => c.realReactions > 0).length}`)
  console.log(`  활성 예외: PIN ${pinIds.size}(후보 밖 ${[...pinIds].filter((id) => !cands.some((c) => c.id === id)).length}) · HIDE ${overrides.filter((o) => o.action === 'HIDE').length}`)

  const d = diff(oldHome, newHome)
  console.log(`\n  홈 ${newHome.length} — 자리 그대로 ${d.samePos} · 자리 바뀜 ${d.moved} · 새로 듦 ${d.entered.length} · 빠짐 ${d.exited.length}`)
  console.log('\n  | 새 | 옛 | 글(해시) | 게시판 | 경과h | 화면 댓글 | 실반응 |')
  newHome.forEach((c, i) => {
    const o = d.oldIdx.get(c.id)
    console.log(`  | ${i + 1} | ${o === undefined ? '밖' : o + 1} | ${tag(c.id)} | ${c.boardType} | ${ageH(c, now)} | ${c.shown} | ${c.realReactions} |`)
  })
  if (d.exited.length) {
    console.log('\n  빠진 글(옛 → 새 밖)')
    for (const c of d.exited) console.log(`  | 옛 ${d.oldIdx.get(c.id)! + 1} | ${tag(c.id)} | ${c.boardType} | 경과 ${ageH(c, now)}h | 화면 ${c.shown} · 실반응 ${c.realReactions} |`)
  }
  const top5 = (l: Cand[]) => l.slice(0, 5).map((c) => c.id)
  console.log(`\n  실반응 ≥ 1 인 글: 옛 홈 ${oldHome.filter((c) => c.realReactions > 0).length} → 새 홈 ${newHome.filter((c) => c.realReactions > 0).length}`)
  console.log(`  상위 5 겹침: ${top5(newHome).filter((id) => top5(oldHome).includes(id)).length}/${Math.min(5, newHome.length)}`)
  console.log(`  화면 댓글 합(홈에 실린 글): 옛 ${sum(oldHome, 'shown')} → 새 ${sum(newHome, 'shown')}  ※ 표시 숫자는 바꾸지 않는다 — 어떤 글이 실리느냐만 바뀐다`)

  // ── 홈 편성: mobile 대조 · 데스크톱 10|10 ──
  const views = composeHomePopularViews({
    menopause: cands.filter((c) => c.boardType === 'MENOPAUSE'),
    free: cands.filter((c) => c.boardType === 'FREE'),
    pinnedPosts: pinned,
    overrides,
  }, now)
  const sameMobile = JSON.stringify(views.mobile.map((c) => c.id)) === JSON.stringify(newHome.map((c) => c.id))
  console.log(`\n  편성 mobile ${views.mobile.length} = 위 홈 ${newHome.length} id·순서 동일: ${sameMobile ? '✅' : '🔴'}`)
  if (!sameMobile) process.exitCode = 1
  const cross = views.desktop.MENOPAUSE.filter((c) => views.desktop.FREE.some((f) => f.id === c.id)).length
  console.log(`  데스크톱 갱년기톡 ${views.desktop.MENOPAUSE.length} · 자유게시판 ${views.desktop.FREE.length} · 교집합 ${cross} · mobile 갱년기톡 ${views.mobile.filter((c) => c.boardType === 'MENOPAUSE').length}`)
  console.log('  | # | 갱년기톡(해시) | 경과h | 실반응 | 자유게시판(해시) | 경과h | 실반응 |')
  for (let i = 0; i < Math.max(views.desktop.MENOPAUSE.length, views.desktop.FREE.length); i += 1) {
    const m = views.desktop.MENOPAUSE[i]
    const f = views.desktop.FREE[i]
    const cell = (c: Cand | undefined) => (c ? `${tag(c.id)} | ${ageH(c, now)} | ${c.realReactions}` : '- | - | -')
    console.log(`  | ${i + 1} | ${cell(m)} | ${cell(f)} |`)
  }

  // ── 지난 시점: 예외 없이 점수 순서 20 (근사) ──
  console.log(`\n[2] 지난 ${DAYS}일 · 매일 21:00 KST · 예외 미적용 · 근사`)
  console.log('  | 시점 | 후보 | 화면 댓글 | 실반응 신호 | 자리 그대로 | 새로 듦 | 실반응 글 옛→새 |')
  for (let i = 1; i <= DAYS; i += 1) {
    const day = new Date(now.getTime() - i * 86_400_000)
    const at = new Date(`${kst(day).slice(0, 10)}T12:00:00Z`) // 21:00 KST
    const { cands: cs } = await candidatesAt(at)
    const o = rank(cs, at, 'old', take)
    const n = rank(cs, at, 'new', take)
    const dd = diff(o, n)
    console.log(`  | ${kst(at)} | ${cs.length} | ${sum(cs, 'shown')} | ${sum(cs, 'realReactions')} | ${dd.samePos}/${n.length} | ${dd.entered.length} | ${o.filter((c) => c.realReactions > 0).length}→${n.filter((c) => c.realReactions > 0).length} |`)
  }
  console.log('\n  쓰기 0 — 허용 목록 밖 연산은 확장이 거부한다 · 제목·본문·원문 ID 출력 0')
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message.split('\n')[0] : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
