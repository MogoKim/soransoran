#!/usr/bin/env tsx
/**
 * 홈 "지금 뜨는 이야기" replay — 갱년기톡 최종 최소 7 · 끼워 넣는 글 14일 상한을 운영 데이터로 관측한다.
 *
 * 🔴 읽기 전용이다. 클라이언트 확장이 **허용 목록**(find·count·groupBy·aggregate) 밖의 연산을 모두 던진다.
 *    raw query 도 허용 목록 밖이다. 운영 데이터를 한 줄도 읽기 전에 그 차단을 먼저 증명한다(proveWriteBlocked) —
 *    증명이 어긋나면 아무것도 읽지 않고 멈춘다.
 * 🔴 제목·본문·작성자·원문 ID 를 출력하지 않는다. 글은 회차마다 새로 뽑는 salt 의 해시로만 부른다 —
 *    같은 회차 안에서만 이어 볼 수 있고, 다른 회차나 DB 의 id 와 대조할 수 없다. 나머지는 집계뿐이다.
 *    제목·본문은 select 에도 넣지 않는다.
 * 🔴 보는 사람은 비로그인이다(차단 목록 없음 — 어드민 홈 노출 미리보기와 같은 관점). 홈 노출 예외(PIN·HIDE)는 "지금" 시점에만 얹는다.
 * 🔴 편성은 화면과 **같은 함수**(composeHomePopularViews · withRealReactions)로 한다 — replay 용으로 다시 적지 않는다.
 *    후보 조회 조건도 화면 로더와 같다(DISCOVERY · 가입인사 제외 · 최신 60 · id 2차 키).
 *
 *   npm run replay:home-popularity                 # 지금 + 지난 7일 매일 21:00 KST
 *   npm run replay:home-popularity -- --days 14
 *
 * 과거 시점의 한계 — 글·댓글을 createdAt ≤ 그 시각으로 자를 뿐, 그 뒤의 숨김·삭제·복구는 되돌리지 못한다
 * (지금 상태를 쓴다). 그래서 과거 시점은 근사다. 판정 근거는 지금 시점이다.
 * 배분 결함(mobileQuota.allocationDefect)이 지금 시점에 나오면 exit 1 이다.
 */
import { createHash, randomBytes } from 'node:crypto'
import { PrismaClient, type BoardType, type CommentOrigin, type Prisma } from '@prisma/client'

import { withRealReactions } from '../src/lib/popularity-db'
import { isWithinFreshWindow } from '../src/lib/popularity'
import { HOME_POPULAR_CANDIDATES_PER_BOARD, HOME_POPULAR_MENOPAUSE_FRESH_HOURS } from '../src/lib/home-exposure'
import { composeHomePopularViews } from '../src/lib/home-popular-views'
import { DISCOVERY_ELIGIBLE_WHERE } from '../src/lib/post-visibility'
import { EXCLUDE_GREETING, GREETING_CATEGORY } from '../src/lib/greeting-policy'

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

const SALT = randomBytes(16)
const tag = (id: string) => 'h' + createHash('sha256').update(SALT).update(id).digest('hex').slice(0, 8)

type Cand = { id: string; boardType: BoardType; createdAt: Date; shown: number; realReactions: number }

async function candidatesAt(at: Date): Promise<{ cands: Cand[]; origins: Partial<Record<CommentOrigin, number>> }> {
  const boards: BoardType[] = ['MENOPAUSE', 'FREE']
  const posts = (
    await Promise.all(
      boards.map((boardType) =>
        prisma.post.findMany({
          // 🔴 화면 로더(home-popular-views.ts loadHomePopularInputs)와 같은 조건 + 과거 시점 자르기
          where: { boardType, ...DISCOVERY_ELIGIBLE_WHERE, AND: [EXCLUDE_GREETING], createdAt: { lte: at } },
          select: { id: true, boardType: true, createdAt: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: HOME_POPULAR_CANDIDATES_PER_BOARD,
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

const kst = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace('T', ' ')
const ageH = (c: Cand, now: Date) => ((now.getTime() - c.createdAt.getTime()) / 3600_000).toFixed(1)
const split = (cands: Cand[]) => ({
  menopause: cands.filter((c) => c.boardType === 'MENOPAUSE'),
  free: cands.filter((c) => c.boardType === 'FREE'),
})

async function main(): Promise<void> {
  const host = (process.env.DATABASE_URL ?? '').replace(/^.*@/, '').replace(/[/?].*$/, '')
  console.log(`■ 홈 인기 replay — 읽기 전용 · host ${host}`)
  console.log('\n[0] 쓰기 차단 증명 (운영 데이터를 읽기 전)')
  await proveWriteBlocked()

  // ── 지금 시점: 홈 노출 예외까지 얹은 실제 편성 ──
  const now = new Date()
  const { cands, origins } = await candidatesAt(now)
  const overrides = await prisma.homeExposureOverride.findMany({
    where: { surface: 'HOME_POPULAR', isActive: true },
    select: { id: true, createdAt: true, postId: true, action: true, position: true, isActive: true, expiresAt: true },
  })
  const pinIds = new Set(overrides.filter((o) => o.action === 'PIN').map((o) => o.postId))
  const pinned = cands.filter((c) => pinIds.has(c.id))
  const views = composeHomePopularViews({ ...split(cands), pinnedPosts: pinned, overrides }, now)
  const q = views.mobileQuota

  console.log(`\n[1] 지금 ${kst(now)} KST — 후보 ${cands.length}글 · 실반응 신호 ≥ 1 인 후보 ${cands.filter((c) => c.realReactions > 0).length}`)
  console.log(`  출처별 댓글(삭제 제외): ${JSON.stringify(origins)}`)
  console.log(`  활성 예외: PIN ${pinIds.size}(후보 밖 ${[...pinIds].filter((id) => !cands.some((c) => c.id === id)).length}) · HIDE ${overrides.filter((o) => o.action === 'HIDE').length}`)
  console.log(`  갱년기톡 진단: ${JSON.stringify(q)}`)
  if (q.allocationDefect) {
    console.error('  🔴 배분 결함 — 갱년기톡 최소 규칙이 지켜지지 않았다')
    process.exitCode = 1
  }
  console.log(`\n  | 순위 | 글(해시) | 게시판 | 경과h | 최근 ${HOME_POPULAR_MENOPAUSE_FRESH_HOURS / 24}일 안 | 실반응 |`)
  views.mobile.forEach((c, i) => {
    const fresh = isWithinFreshWindow(c, HOME_POPULAR_MENOPAUSE_FRESH_HOURS, now) ? '예' : '아니오'
    console.log(`  | ${i + 1} | ${tag(c.id)} | ${c.boardType} | ${ageH(c, now)} | ${fresh} | ${c.realReactions} |`)
  })

  // 집계 — 허용 연산 count · findMany 만
  const greetingLeaks = await prisma.post.count({ where: { category: GREETING_CATEGORY, indexPromotionBlocked: false } })
  const positions = overrides
    .filter((o) => o.action === 'PIN' && o.isActive && (o.expiresAt === null || o.expiresAt > now) && o.position !== null)
    .map((o) => o.position as number)
  const samePositionGroups = [...new Set(positions)].filter((p) => positions.filter((x) => x === p).length > 1).length
  console.log(`\n  가입인사인데 indexPromotionBlocked=false 인 글: ${greetingLeaks}${greetingLeaks ? ' 🔴 (홈은 글 종류로도 빼지만 별도 결함으로 보고)' : ''}`)
  console.log(`  같은 position 을 가진 활성 PIN 묶음: ${samePositionGroups} (순서는 orderPinOverrides 로 결정적)`)

  const cross = views.desktop.MENOPAUSE.filter((c) => views.desktop.FREE.some((f) => f.id === c.id)).length
  console.log(`\n  데스크톱 갱년기톡 ${views.desktop.MENOPAUSE.length} · 자유게시판 ${views.desktop.FREE.length} · 교집합 ${cross}`)
  console.log('  | # | 갱년기톡(해시) | 경과h | 실반응 | 자유게시판(해시) | 경과h | 실반응 |')
  for (let i = 0; i < Math.max(views.desktop.MENOPAUSE.length, views.desktop.FREE.length); i += 1) {
    const m = views.desktop.MENOPAUSE[i]
    const f = views.desktop.FREE[i]
    const cell = (c: Cand | undefined) => (c ? `${tag(c.id)} | ${ageH(c, now)} | ${c.realReactions}` : '- | - | -')
    console.log(`  | ${i + 1} | ${cell(m)} | ${cell(f)} |`)
  }

  // ── 지난 시점: 예외 없이 편성 (근사) ──
  console.log(`\n[2] 지난 ${DAYS}일 · 매일 21:00 KST · 예외 미적용 · 근사`)
  console.log('  | 시점 | 후보 | mobile | 갱년기톡 | 최근 14일 후보 | 원인 | 결함 |')
  for (let i = 1; i <= DAYS; i += 1) {
    const day = new Date(now.getTime() - i * 86_400_000)
    const at = new Date(`${kst(day).slice(0, 10)}T12:00:00Z`) // 21:00 KST
    const { cands: cs } = await candidatesAt(at)
    const v = composeHomePopularViews({ ...split(cs), pinnedPosts: [], overrides: [] }, at)
    const qq = v.mobileQuota
    console.log(`  | ${kst(at)} | ${cs.length} | ${v.mobile.length} | ${qq.shown} | ${qq.freshEligible} | ${qq.reasons.join('·') || '-'} | ${qq.allocationDefect ? '🔴' : '-'} |`)
  }
  console.log('\n  쓰기 0 — 허용 목록 밖 연산은 확장이 거부한다 · 제목·본문·원문 ID 출력 0')
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message.split('\n')[0] : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
