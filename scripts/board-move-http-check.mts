#!/usr/bin/env tsx
/**
 * 🔴 **어드민 게시판 변경 — 고객 주소 · 권한 HTTP 검사** (격리 DB + 로컬 `next start` 전용)
 *
 *   · 옮긴 공개 글의 옛 주소 → 307(임시) · Location = 지금 정식 주소 · 지금 주소 200(redirect 0) · 고리 0
 *     FREE → MENOPAUSE 로 옮기고 MENOPAUSE → FREE 로 되돌린 두 시점 모두 · redirect 는 최대 한 번
 *   · 숨김 · 삭제 글 → 옛 주소 · 새 주소 모두 404 (redirect 로 존재가 새지 않는다)
 *   · 보는 회원이 차단한 작성자의 글(UserBlock) → 그 회원에게는 옛 주소 · 새 주소 모두 404
 *   · 모르는 게시판 slug · 매거진 slug → 404 (기존 계약 그대로)
 *   · 로그인 없이 서버 action 을 직접 불러도 → 거부 · write 0
 *
 * 🔴 운영 DB · 외부 네트워크 0 — localhost 서버와 격리 Postgres(soran_test)만. 이 검사가 만든 행만 지운다.
 *
 *   실행: BASE_URL=http://localhost:3998 DATABASE_URL=…/soran_test AUTH_SECRET=… npx tsx scripts/board-move-http-check.mts
 */
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { encode } from '@auth/core/jwt'
import { PrismaClient } from '@prisma/client'
import { movePostBoardTx } from '../src/lib/board-move-tx'

const slugOf = { FREE: 'free', MENOPAUSE: 'menopause' } as const

const DB = process.env.DATABASE_URL ?? ''
if (!/^postgresql:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\/soran_test$/.test(DB)) {
  console.error('🔴 격리 DB 가 아니다. 멈춘다.'); process.exit(2)
}
const BASE = process.env.BASE_URL ?? 'http://localhost:3998'
if (!/^http:\/\/localhost:\d+$/.test(BASE)) { console.error('🔴 localhost 가 아니다.'); process.exit(2) }
const SECRET = process.env.AUTH_SECRET ?? ''
if (SECRET === '') { console.error('🔴 AUTH_SECRET 이 필요하다(로컬 서버와 같은 값).'); process.exit(2) }

let pass = 0
let fail = 0
const expect = (label: string, actual: unknown, want: unknown): void => {
  const ok = JSON.stringify(actual) === JSON.stringify(want)
  ok ? (pass += 1) : (fail += 1)
  console.log(`  ${ok ? '✅' : '🔴'} ${label}`)
  if (!ok) console.log(`       기대 ${JSON.stringify(want)} · 실제 ${JSON.stringify(actual)}`)
}

const prisma = new PrismaClient()
const tag = `bmh${Date.now().toString(36)}`
const users: string[] = []
const posts: string[] = []
let seq = 0

async function member(): Promise<string> {
  seq += 1
  const u = await prisma.user.create({ data: { nickname: `${tag}-${seq}` }, select: { id: true } })
  await prisma.account.create({ data: { userId: u.id, type: 'oauth', provider: 'kakao', providerAccountId: `${tag}-${seq}` } })
  users.push(u.id)
  return u.id
}
/** FREE 에 공개 글을 만들고 MENOPAUSE 로 옮긴다(실제 트랜잭션) */
async function moved(authorId: string): Promise<string> {
  const p = await prisma.post.create({ data: { boardType: 'FREE', title: `${tag} 옮긴 글`, content: '본문', authorId }, select: { id: true } })
  posts.push(p.id)
  const r = await movePostBoardTx(prisma, { postId: p.id, from: 'FREE', to: 'MENOPAUSE' })
  if (!r.ok) throw new Error(`준비 실패 — ${r.code}`)
  return p.id
}
const get = async (path: string, cookie?: string) => {
  const r = await fetch(`${BASE}${path}`, { redirect: 'manual', headers: cookie ? { cookie } : {} })
  await r.arrayBuffer()
  return { status: r.status, location: r.headers.get('location') }
}

async function main(): Promise<void> {
  console.log('\n══ 어드민 게시판 변경 — 고객 주소 · 권한 (localhost · 격리 DB) ══\n')
  const author = await member()

  console.log('1. 옮긴 공개 글 — 307 왕복')
  const a = await moved(author)
  /** 따라가며 상태를 모은다 — 최대 5번. 고리가 있으면 307 이 계속 쌓인다 */
  const follow = async (path: string): Promise<string[]> => {
    const seen: string[] = []
    for (let i = 0; i < 5; i++) {
      const r = await get(path)
      seen.push(`${r.status}${r.location ? ` ${r.location}` : ''}`)
      if (r.status < 300 || r.status >= 400 || !r.location) break
      path = r.location
    }
    return seen
  }
  const atBoard = async (now: 'FREE' | 'MENOPAUSE', old: 'FREE' | 'MENOPAUSE', label: string) => {
    const cur = `/community/${slugOf[now]}/${a}`
    const prev = `/community/${slugOf[old]}/${a}`
    expect(`${label} — 옛 주소 → 307 · Location = 지금 정식 주소`, await get(prev), { status: 307, location: cur })
    expect(`${label} — 지금 주소 → 200 · redirect 0`, await get(cur), { status: 200, location: null })
    expect(`${label} — 옛 주소를 따라가면 307 한 번 뒤 200 · 고리 0`, await follow(prev), [`307 ${cur}`, '200'])
  }
  await atBoard('MENOPAUSE', 'FREE', 'FREE → MENOPAUSE 뒤')
  const back = await movePostBoardTx(prisma, { postId: a, from: 'MENOPAUSE', to: 'FREE' })
  if (!back.ok) throw new Error(`되돌리기 실패 — ${back.code}`)
  await atBoard('FREE', 'MENOPAUSE', 'MENOPAUSE → FREE 되돌린 뒤')

  console.log('\n2. 숨김 · 삭제 · 차단 작성자 — redirect 로 존재가 새지 않는다')
  const hidden = await moved(author)
  await prisma.post.update({ where: { id: hidden }, data: { status: 'HIDDEN' } })
  const deleted = await moved(author)
  await prisma.post.update({ where: { id: deleted }, data: { status: 'DELETED' } })
  for (const [label, id] of [['숨김', hidden], ['삭제', deleted]] as const) {
    expect(`${label} 글 — 옛 주소 404 · 새 주소 404 · Location 없음`,
      [await get(`/community/free/${id}`), await get(`/community/menopause/${id}`)],
      [{ status: 404, location: null }, { status: 404, location: null }])
  }
  // 상세의 "차단 작성자" 는 보는 회원이 차단한 회원(UserBlock)이다(getBlockedUserIds) — 그 회원에게만 숨는다
  const blockedAuthor = await member()
  const byBlocked = await moved(blockedAuthor)
  const viewer = await member()
  await prisma.userBlock.create({ data: { blockerId: viewer, blockedUserId: blockedAuthor } })
  const cookie = `authjs.session-token=${await encode({ token: { uid: viewer, sub: viewer }, secret: SECRET, salt: 'authjs.session-token' })}`
  expect('차단한 회원에게 — 옛 주소 404 · 새 주소 404 · Location 없음',
    [await get(`/community/free/${byBlocked}`, cookie), await get(`/community/menopause/${byBlocked}`, cookie)],
    [{ status: 404, location: null }, { status: 404, location: null }])
  expect('같은 글 · 차단하지 않은 방문자에게는 기존대로 307 → 200',
    [(await get(`/community/free/${byBlocked}`)).status, (await get(`/community/menopause/${byBlocked}`)).status], [307, 200])

  console.log('\n3. 기존 계약 그대로')
  expect('모르는 게시판 slug → 404', (await get(`/community/nope/${a}`)).status, 404)
  expect('매거진 slug(커뮤니티 아님) → 404', (await get(`/community/magazine/${a}`)).status, 404)
  expect('없는 글 → 404', (await get('/community/free/not-a-post-id')).status, 404)

  console.log('\n4. 로그인 없이 서버 action 직접 호출 → 거부 · write 0')
  {
    const id = createHash('sha1').update(`${resolve('src/lib/actions/admin.ts')}:movePostBoard`).digest('hex')
    const before = await prisma.post.findUniqueOrThrow({ where: { id: a }, select: { boardType: true, updatedAt: true } })
    const r = await fetch(`${BASE}/admin/content/${a}`, {
      method: 'POST',
      headers: { 'Next-Action': id, 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify([a, 'MENOPAUSE', 'FREE']),
    })
    const text = await r.text()
    const after = await prisma.post.findUniqueOrThrow({ where: { id: a }, select: { boardType: true, updatedAt: true } })
    expect('응답에 "권한이 없습니다" · 게시판 · updatedAt 그대로',
      [text.includes('권한이 없습니다'), after.boardType, after.updatedAt.toISOString()],
      [true, before.boardType, before.updatedAt.toISOString()])
  }
}

try {
  await main()
} finally {
  await prisma.userBlock.deleteMany({ where: { blockerId: { in: users } } })
  await prisma.post.deleteMany({ where: { id: { in: posts } } })
  await prisma.account.deleteMany({ where: { userId: { in: users } } })
  await prisma.user.deleteMany({ where: { id: { in: users } } })
  await prisma.$disconnect()
}
console.log(`\n${fail === 0 ? '✅' : '🔴'} board-move-http-check: ${pass} 통과 · ${fail} 실패\n`)
if (fail > 0) process.exit(1)
