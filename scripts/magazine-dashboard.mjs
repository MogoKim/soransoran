#!/usr/bin/env node
/**
 * 소란소란 성장 계기판
 *
 * 매거진 자동화가 "글 수 증가"가 아니라 **커뮤니티 성장**으로 이어지는지 본다.
 * 01:00 producer 가 시작할 때 읽고, 끝날 때 이 5줄을 보고한다.
 *
 * North Star = 4050/5060 여성이 소란소란에서 자기 이야기를 남긴 횟수
 *            = USER 원본 글 + USER 댓글
 *   방문자 수도 아니고 매거진 글 수도 아니다.
 *   매거진 글이 늘어도 이 값이 안 오르면 자동화는 "글 수만 늘리는 장치"다.
 *
 * ⚠️ 읽기 전용이다. DB write · migration · 파일 쓰기 · 네트워크 호출이 없다.
 *    개인정보(email · name · authorId)는 계산에만 쓰고 출력하지 않는다.
 *
 * 사용법
 *   node scripts/magazine-dashboard.mjs
 *   node scripts/magazine-dashboard.mjs --json
 *
 * 종료 코드: 항상 0 (상태 보고이지 판정이 아니다)
 */
import { calculateInventory } from './magazine-inventory.mjs'

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const RECENT_DAYS = 14

/** Search 제출 게이트 — SEO 색인 정책 §5 */
const GATE_A_TARGET = 20 // sitemap 글 상세 URL
const GATE_B_TARGET = 10 // 회원 원본 글
const GATE_C_TARGET = 3 // 최근 14일 회원 글

const INVENTORY_WARN_DAYS = 3

function toKstDate(ms) {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10)
}

// ── DB 조회 (읽기 전용) ────────────────────────────────────

/**
 * 회원 참여 지표를 읽는다.
 *
 * DATABASE_URL 이 없거나 연결이 안 되면 null 을 돌려준다 —
 * 그 경우에도 매거진 지표는 나와야 하므로 전체를 죽이지 않는다.
 * authorId 는 Set 크기 계산에만 쓰고 밖으로 내보내지 않는다.
 */
async function readCommunityMetrics(now) {
  let prisma
  try {
    const { PrismaClient } = await import('@prisma/client')
    // log 를 끈다 — 연결 실패는 아래 catch 가 다루고, 여기서 stderr 를 어지럽히지 않는다
    prisma = new PrismaClient({ log: [] })

    const since = new Date(now - RECENT_DAYS * DAY_MS)
    const userPost = { source: 'USER', status: 'PUBLISHED' }
    const userComment = { source: 'USER', isDeleted: false }

    const [
      totalUserPosts,
      totalUserComments,
      recentUserPosts14d,
      recentUserComments14d,
      sitemapPosts,
      postAuthors,
      commentAuthors,
      recentPostAuthors,
      recentCommentAuthors,
    ] = await Promise.all([
      prisma.post.count({ where: userPost }),
      prisma.comment.count({ where: userComment }),
      prisma.post.count({ where: { ...userPost, createdAt: { gte: since } } }),
      prisma.comment.count({ where: { ...userComment, createdAt: { gte: since } } }),
      // sitemap 은 source 를 가리지 않고 PUBLISHED 를 전부 넣는다 (sitemap.ts 와 같은 조건)
      prisma.post.count({ where: { status: 'PUBLISHED' } }),
      prisma.post.findMany({ where: userPost, select: { authorId: true } }),
      prisma.comment.findMany({ where: userComment, select: { authorId: true } }),
      prisma.post.findMany({
        where: { ...userPost, createdAt: { gte: since } },
        select: { authorId: true },
      }),
      prisma.comment.findMany({
        where: { ...userComment, createdAt: { gte: since } },
        select: { authorId: true },
      }),
    ])

    // authorId 는 여기서 개수로만 환원되고 사라진다
    const uniquePostAuthors = new Set(postAuthors.map((p) => p.authorId)).size
    const uniqueCommentAuthors = new Set(commentAuthors.map((c) => c.authorId)).size
    const uniqueStoryAuthors = new Set([
      ...postAuthors.map((p) => p.authorId),
      ...commentAuthors.map((c) => c.authorId),
    ]).size
    const recentUniqueStoryAuthors14d = new Set([
      ...recentPostAuthors.map((p) => p.authorId),
      ...recentCommentAuthors.map((c) => c.authorId),
    ]).size

    return {
      totalUserPosts,
      totalUserComments,
      recentUserPosts14d,
      recentUserComments14d,
      sitemapPosts,
      uniquePostAuthors,
      uniqueCommentAuthors,
      uniqueStoryAuthors,
      recentUniqueStoryAuthors14d,
    }
  } catch {
    return null
  } finally {
    if (prisma) await prisma.$disconnect().catch(() => {})
  }
}

// ── 계기판 ─────────────────────────────────────────────────

export async function buildDashboard(now = Date.now()) {
  const inventory = calculateInventory(now)
  const db = await readCommunityMetrics(now)
  const dbAvailable = db !== null

  const northStar = dbAvailable
    ? {
        total: db.totalUserPosts + db.totalUserComments,
        last14d: db.recentUserPosts14d + db.recentUserComments14d,
        posts: db.totalUserPosts,
        comments: db.totalUserComments,
        posts14d: db.recentUserPosts14d,
        comments14d: db.recentUserComments14d,
      }
    : null

  const members = dbAvailable
    ? {
        uniquePostAuthors: db.uniquePostAuthors,
        uniqueCommentAuthors: db.uniqueCommentAuthors,
        uniqueStoryAuthors: db.uniqueStoryAuthors,
        recentUniqueStoryAuthors14d: db.recentUniqueStoryAuthors14d,
      }
    : null

  // 게이트 A — sitemap 글 상세 URL = 공개 회원 글 + 공개 매거진 글 (외부 호출 없이 내부 계산)
  const sitemapDetail = dbAvailable ? db.sitemapPosts + inventory.counts.live : null

  const gate = (label, current, target) => ({
    label,
    current,
    target,
    pass: current !== null && current >= target,
  })

  const searchGate = {
    A: gate('sitemap detail URLs >= 20', sitemapDetail, GATE_A_TARGET),
    B: gate('member original posts >= 10', dbAvailable ? db.totalUserPosts : null, GATE_B_TARGET),
    C: gate(
      'recent 14d member posts >= 3',
      dbAvailable ? db.recentUserPosts14d : null,
      GATE_C_TARGET,
    ),
    D: {
      label: 'robots/canonical/sitemap/vercel.app audit',
      status: 'manual_required',
      pass: false,
    },
  }
  searchGate.status =
    searchGate.A.pass && searchGate.B.pass && searchGate.C.pass && searchGate.D.pass
      ? 'READY'
      : 'HOLD'
  searchGate.blockedBy = ['A', 'B', 'C', 'D'].filter((k) => !searchGate[k].pass)

  const warnings = [...inventory.warnings]
  if (inventory.inventoryDays <= INVENTORY_WARN_DAYS) {
    warnings.push(`재고 ${inventory.inventoryDays}일 — ${INVENTORY_WARN_DAYS}일 이하 (창업자 예외 알림)`)
  }
  if (!dbAvailable) {
    warnings.push('DB 연결 실패 — North Star·게이트 A/B/C 를 계산하지 못했다 (DATABASE_URL 확인)')
  }

  return {
    kstDate: toKstDate(now),
    dbAvailable,
    northStar,
    members,
    magazine: {
      live: inventory.counts.live,
      scheduled: inventory.counts.scheduled,
      blocked: inventory.counts.blocked,
      draft: inventory.counts.draft,
      inventoryDays: inventory.inventoryDays,
      produceCount: inventory.produceCount,
      nextPublishAt: inventory.nextPublishAt,
    },
    searchGate,
    warnings,
    /** QA 는 별도 실행이다 — node scripts/magazine-qa.mjs */
    qaNote: 'QA 는 별도 실행: node scripts/magazine-qa.mjs --published',
  }
}

// ── 출력 ───────────────────────────────────────────────────

function n(value, fallback = '?') {
  return value === null || value === undefined ? fallback : value
}

function printHuman(d) {
  const g = d.searchGate
  const ns = d.northStar

  console.log('')
  console.log(`소란소란 성장 계기판 — KST ${d.kstDate}`)
  console.log('')
  console.log(
    `  1. 재고 ${d.magazine.inventoryDays}일 · 오늘 생산 ${d.magazine.produceCount}건 · ` +
      `다음 공개 ${d.magazine.nextPublishAt ?? '없음'}`,
  )
  console.log(
    `  2. 매거진 공개 ${d.magazine.live}건 · 예약 ${d.magazine.scheduled}건 · 차단 ${d.magazine.blocked}건`,
  )
  console.log(`  3. North Star 전체 ${n(ns?.total)}회 · 최근 14일 ${n(ns?.last14d)}회`)
  console.log(
    `  4. 회원 원본 글 ${n(g.B.current)}/${g.B.target} · ` +
      `최근 14일 회원 글 ${n(g.C.current)}/${g.C.target} · ` +
      `sitemap detail ${n(g.A.current)}/${g.A.target}`,
  )
  const exceptions = d.warnings.length > 0 ? d.warnings.join(' · ') : '없음'
  console.log(`  5. 예외 ${exceptions} · 게이트 D 수동 감사 필요`)

  console.log('')
  console.log('상세')
  if (ns) {
    console.log(`  - 회원 글 ${ns.posts}건 (최근 14일 ${ns.posts14d}건)`)
    console.log(`  - 회원 댓글 ${ns.comments}건 (최근 14일 ${ns.comments14d}건)`)
    console.log(
      `  - 참여자 ${d.members.uniqueStoryAuthors}명 (최근 14일 ${d.members.recentUniqueStoryAuthors14d}명)`,
    )
  } else {
    console.log('  - 회원 지표: DB 연결 실패로 측정 불가')
  }
  console.log(`  - Search 제출: ${g.status}`)
  if (g.blockedBy.length > 0) {
    console.log(`  - 미달 조건: ${g.blockedBy.join(' · ')}`)
    for (const k of g.blockedBy) {
      const c = g[k]
      const detail = c.status === 'manual_required' ? '수동 감사 필요' : `${n(c.current)}/${c.target}`
      console.log(`      ${k}. ${c.label} — ${detail}`)
    }
  }
  console.log(`  - ${d.qaNote}`)
  console.log('')
  console.log('  ℹ️  매거진 글이 늘어도 North Star 가 안 오르면 글을 더 쓰지 않는다.')
  console.log('      CTA · 주제 · 전환을 먼저 본다.')
  console.log('')
}

async function main() {
  const asJson = process.argv.includes('--json')
  const dashboard = await buildDashboard()
  if (asJson) console.log(JSON.stringify(dashboard, null, 2))
  else printHuman(dashboard)
  process.exit(0)
}

if (process.argv[1] && process.argv[1].endsWith('magazine-dashboard.mjs')) main()
