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
 * 🔴 비교는 **applyHomeExposure 뒤 최종 20개**로 한다. 중간 후보로 비교하면 최종 자를 때 사라지는 것을 못 본다.
 *   A  main 현재   — 화면 댓글 수 축 · 여유 2배(40)에서 갱년기톡 보장 → 예외 → 20 으로 자름
 *   B  #706 이전   — 실반응 축 · A 와 같은 배분
 *   C  이번 보정   — 실반응 축 · 예외를 얹은 뒤 남은 자리에서 배분(queries/posts.ts getHomePopularPosts 와 같은 조합)
 * PIN 글은 운영과 같이 후보와 따로 조회한다(후보 밖 PIN 도 싣는다).
 */
import { createHash, randomBytes } from 'node:crypto'
import { PrismaClient, type BoardType, type CommentOrigin, type Prisma } from '@prisma/client'

import { withRealReactions } from '../src/lib/popularity-db'
import { createHomeAutoFill, pickHomePopular, type MenopauseQuota } from '../src/lib/popularity'
import { applyHomeExposure } from '../src/lib/home-exposure-rules'
import { HOME_POPULAR_COUNT } from '../src/lib/home-exposure'
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
// 운영 상수와 같다 (queries/posts.ts)
const PER_BOARD = 60
const MIN_MENOPAUSE = 7
const LEGACY_HEADROOM = 2 // A·B 재현용 — main 의 옛 배분

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

type Override = { postId: string; action: 'PIN' | 'HIDE'; position: number | null; isActive: boolean; expiresAt: Date | null }

/** A·B — main 의 옛 배분: 여유 2배에서 보장 → 예외 → take 로 자름 */
function legacyHome(cands: Cand[], pinned: Cand[], overrides: Override[], at: Date, axis: 'shown' | 'real', take: number): Cand[] {
  const scored = cands.map((c) => ({ ...c, realReactions: axis === 'shown' ? c.shown : c.realReactions, orig: c }))
  const ranked = pickHomePopular({
    menopause: scored.filter((c) => c.boardType === 'MENOPAUSE'),
    free: scored.filter((c) => c.boardType === 'FREE'),
    take: take * LEGACY_HEADROOM,
    minMenopause: MIN_MENOPAUSE,
    now: at,
  }).map((c) => c.orig)
  return applyHomeExposure({ candidates: ranked, pinnedPosts: pinned, overrides, take, now: at })
}

/** C — 이번 보정: getHomePopularPosts 와 같은 조합 */
function finalHome(cands: Cand[], pinned: Cand[], overrides: Override[], at: Date, take: number): { posts: Cand[]; quota: MenopauseQuota } {
  const auto = createHomeAutoFill<Cand>({ minMenopause: MIN_MENOPAUSE, now: at })
  const posts = applyHomeExposure({ candidates: cands, pinnedPosts: pinned, overrides, take, now: at, fillAuto: auto.fill })
  return { posts, quota: auto.diagnosis(posts) }
}

/** 운영과 같이 PIN 글을 후보와 따로 조회한다 — 같은 discovery 조건 */
async function pinnedAt(ids: string[], at: Date): Promise<Cand[]> {
  if (ids.length === 0) return []
  const rows = await prisma.post.findMany({
    where: { id: { in: ids }, boardType: { in: ['MENOPAUSE', 'FREE'] }, ...DISCOVERY_ELIGIBLE_WHERE, createdAt: { lte: at } },
    select: { id: true, boardType: true, createdAt: true },
  })
  const counted = await withRealReactions(prisma as unknown as Prisma.TransactionClient, rows, { asOf: at })
  const shown = await prisma.comment.groupBy({ by: ['postId'], where: { postId: { in: ids }, isDeleted: false, createdAt: { lte: at } }, _count: { _all: true } })
  const shownMap = new Map(shown.map((r) => [r.postId, r._count._all]))
  return counted.map((p) => ({ ...p, shown: shownMap.get(p.id) ?? 0 }))
}

function diff(oldList: Cand[], newList: Cand[]) {
  const oldIdx = new Map(oldList.map((c, i) => [c.id, i]))
  const newIds = new Set(newList.map((c) => c.id))
  const entered = newList.filter((c) => !oldIdx.has(c.id))
  const exited = oldList.filter((c) => !newIds.has(c.id))
  const samePos = newList.filter((c, i) => oldIdx.get(c.id) === i).length
  return { entered, exited, samePos, moved: newList.length - samePos, oldIdx }
}

const boards = (l: Cand[]) => `갱년기톡 ${l.filter((c) => c.boardType === 'MENOPAUSE').length} · 자유 ${l.filter((c) => c.boardType === 'FREE').length}`
const kst = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace('T', ' ')
const ageH = (c: Cand, now: Date) => ((now.getTime() - c.createdAt.getTime()) / 3600_000).toFixed(1)
const sum = (l: Cand[], k: 'shown' | 'realReactions') => l.reduce((s, c) => s + c[k], 0)

async function main(): Promise<void> {
  const host = (process.env.DATABASE_URL ?? '').replace(/^.*@/, '').replace(/[/?].*$/, '')
  console.log(`■ 홈 인기 replay — 읽기 전용 · host ${host}`)
  console.log('\n[0] 쓰기 차단 증명 (운영 데이터를 읽기 전)')
  await proveWriteBlocked()

  const take = HOME_POPULAR_COUNT
  const now = new Date()
  const { cands, origins } = await candidatesAt(now)
  const overrides: Override[] = (
    await prisma.homeExposureOverride.findMany({
      where: { surface: 'HOME_POPULAR', isActive: true },
      select: { postId: true, action: true, position: true, isActive: true, expiresAt: true },
    })
  ).filter((o) => o.isActive && (o.expiresAt === null || o.expiresAt.getTime() > now.getTime()))
  const pinIds = overrides.filter((o) => o.action === 'PIN').map((o) => o.postId)
  const hideIds = new Set(overrides.filter((o) => o.action === 'HIDE').map((o) => o.postId))
  const pinned = await pinnedAt(pinIds, now)

  const A = legacyHome(cands, pinned, overrides, now, 'shown', take)
  const B = legacyHome(cands, pinned, overrides, now, 'real', take)
  const C = finalHome(cands, pinned, overrides, now, take)
  const noOverride = finalHome(cands, [], [], now, take)

  console.log(`\n[1] 지금 ${kst(now)} KST — 최종 홈 ${take} 기준(applyHomeExposure 뒤)`)
  console.log(`  후보 ${cands.length}글 (${boards(cands)}) · 화면 댓글 ${sum(cands, 'shown')} · 실반응 신호 합 ${sum(cands, 'realReactions')}`)
  console.log(`  출처별 댓글(삭제 제외): ${JSON.stringify(origins)}`)
  console.log(`\n  게시판별 최종 개수`)
  console.log(`  | A main 현재 | ${boards(A)} |`)
  console.log(`  | B #706 이전 head | ${boards(B)} |`)
  console.log(`  | C 이번 보정 | ${boards(C.posts)} |`)
  const q = C.quota
  console.log(`  C 갱년기톡 진단: 최소 ${q.minimum} · 목표 ${q.target} · 노출 ${q.shown} · PIN ${q.pinned} · 부족 ${q.deficit}${q.reasons.length ? ' · 원인 ' + q.reasons.join(',') : ''}`)

  for (const [label, base] of [['A → C', A], ['B → C', B]] as const) {
    const d = diff(base, C.posts)
    console.log(`\n  ${label}: 자리 그대로 ${d.samePos} · 자리 바뀜 ${d.moved} · 새로 듦 ${d.entered.length}(${boards(d.entered)}) · 빠짐 ${d.exited.length}(${boards(d.exited)})`)
  }

  console.log(`\n  PIN/HIDE 영향`)
  console.log(`  활성 PIN ${pinIds.length} (discovery 통과 ${pinned.length} · 후보 밖 ${pinIds.filter((id) => !cands.some((c) => c.id === id)).length}) · 최종 홈에 실린 PIN ${C.posts.filter((c) => pinIds.includes(c.id)).length} · 그중 갱년기톡 ${q.pinned}`)
  const hiddenWouldShow = noOverride.posts.filter((c) => hideIds.has(c.id)).length
  console.log(`  활성 HIDE ${hideIds.size} · 예외가 없었다면 홈에 실렸을 HIDE 글 ${hiddenWouldShow} · 최종 홈의 HIDE 글 ${C.posts.filter((c) => hideIds.has(c.id)).length}`)
  const dOv = diff(noOverride.posts, C.posts)
  console.log(`  예외 없음 → 예외 적용(C): 새로 듦 ${dOv.entered.length} · 빠짐 ${dOv.exited.length}`)

  const dA = diff(A, C.posts)
  console.log('\n  C 최종 목록 | 순위 | A 순위 | 글(해시) | 게시판 | 경과h | 화면 댓글 | 실반응 | 예외 |')
  C.posts.forEach((c, i) => {
    const o = dA.oldIdx.get(c.id)
    console.log(`  | ${i + 1} | ${o === undefined ? '밖' : o + 1} | ${tag(c.id)} | ${c.boardType} | ${ageH(c, now)} | ${c.shown} | ${c.realReactions} | ${pinIds.includes(c.id) ? 'PIN' : ''} |`)
  })
  if (dA.exited.length) {
    console.log('\n  A 에서 빠진 글')
    for (const c of dA.exited) console.log(`  | A ${dA.oldIdx.get(c.id)! + 1} | ${tag(c.id)} | ${c.boardType} | 경과 ${ageH(c, now)}h | 화면 ${c.shown} · 실반응 ${c.realReactions} |`)
  }
  console.log(`\n  화면 댓글 합(홈에 실린 글): A ${sum(A, 'shown')} → C ${sum(C.posts, 'shown')}  ※ 표시 숫자는 바꾸지 않는다 — 어떤 글이 실리느냐만 바뀐다`)

  // ── 지난 시점: 예외 미적용 · 최종 20 (근사) ──
  console.log(`\n[2] 지난 ${DAYS}일 · 매일 21:00 KST · 예외 미적용 · 최종 ${take} · 근사`)
  console.log('  | 시점 | 후보 | A 게시판 | C 게시판 | C 부족 | A→C 새로 듦 | 실반응 글 A→C |')
  for (let i = 1; i <= DAYS; i += 1) {
    const day = new Date(now.getTime() - i * 86_400_000)
    const at = new Date(`${kst(day).slice(0, 10)}T12:00:00Z`) // 21:00 KST
    const { cands: cs } = await candidatesAt(at)
    const a = legacyHome(cs, [], [], at, 'shown', take)
    const c = finalHome(cs, [], [], at, take)
    console.log(`  | ${kst(at)} | ${cs.length} | ${boards(a)} | ${boards(c.posts)} | ${c.quota.deficit}${c.quota.reasons.length ? ' ' + c.quota.reasons.join(',') : ''} | ${diff(a, c.posts).entered.length} | ${a.filter((x) => x.realReactions > 0).length}→${c.posts.filter((x) => x.realReactions > 0).length} |`)
  }
  console.log('\n  쓰기 0 — 허용 목록 밖 연산은 확장이 거부한다 · 제목·본문·원문 ID 출력 0')
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message.split('\n')[0] : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
