#!/usr/bin/env tsx
/**
 * 답 기다리는 글 — **실제 Postgres** 에서 목록이 무엇을 싣고 무엇을 빼는지 확인한다
 *
 * 🔴 CI 격리 DB 사슬(scripts/ci-d100-db-check.sh)에서 돈다. 운영 DB 에 절대 붙이지 않는다 —
 *    주소 가드 + SORAN_ISOLATED_DB=yes-throwaway 둘 다 있어야 한 줄이라도 쓴다.
 * 🔴 시작과 끝에 같은 정리를 한다 — 사슬의 앞뒤 검사가 남긴 행과 섞이지 않게.
 * 🔴 판정 순수 시험은 check:member-response 가 본다. 여기는 조회 조건 · 실제 저장 경로와의 연결 · 경계를 본다.
 *
 *   DATABASE_URL=… DIRECT_URL=… SORAN_ISOLATED_DB=yes-throwaway npm run member-response:db-check
 */
import { PrismaClient } from '@prisma/client'

import { loadMemberResponseBoard } from '../src/lib/queries/member-response'
import { createOperatorCommentTx } from '../src/lib/operator-compose-tx'
import { getComposeTargetPost, getComposeTargetPosts } from '../src/lib/queries/operator-compose'
import { GREETING_CATEGORY } from '../src/lib/greeting-policy'
import { MEMBER_RESPONSE_LIST_MAX, MEMBER_RESPONSE_WINDOW_MS } from '../src/lib/member-response'

const URL = process.env.DATABASE_URL ?? ''
if (!/^postgresql:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\/soran_test(\?|$)/.test(URL) || (process.env.SORAN_ISOLATED_DB ?? '').trim() !== 'yes-throwaway') {
  console.error('🔴 격리 DB 가 아니다(주소 · SORAN_ISOLATED_DB=yes-throwaway). 멈춘다.')
  process.exit(2)
}

let pass = 0
let fail = 0
const expect = (label: string, actual: unknown, want: unknown): void => {
  const ok = JSON.stringify(actual) === JSON.stringify(want)
  ok ? (pass += 1) : (fail += 1)
  console.log(`  ${ok ? '✅' : '🔴'} ${label}`)
  if (!ok) console.log(`       기대 ${JSON.stringify(want)} · 실제 ${JSON.stringify(actual)}`)
}

const prisma = new PrismaClient()
const NOW = new Date()
const H = 3_600_000
const ENV = { SORAN_ADMIN_EMAILS: 'founder@test.example', SIGNUP_ALLOWLIST: '9999' }

async function wipe(): Promise<void> {
  await prisma.operatorWriteLog.deleteMany({})
  await prisma.report.deleteMany({})
  await prisma.comment.deleteMany({ where: { parentId: { not: null } } })
  await prisma.comment.deleteMany({})
  await prisma.personaApprovalQueue.deleteMany({})
  await prisma.personaActivityLog.deleteMany({})
  await prisma.homeExposureOverride.deleteMany({})
  await prisma.autoReadyAudit.deleteMany({})
  await prisma.originalPostApprovalQueue.deleteMany({})
  await prisma.bestSelection.deleteMany({})
  await prisma.like.deleteMany({})
  await prisma.post.deleteMany({})
  await prisma.operatorWriter.deleteMany({})
  await prisma.persona.deleteMany({})
  await prisma.userBlock.deleteMany({})
  await prisma.account.deleteMany({})
  await prisma.user.deleteMany({})
}

let seq = 0
async function member(name: string, over: { email?: string; kakaoId?: string; isAdmin?: boolean; isOnboarded?: boolean; isBlocked?: boolean } = {}) {
  seq += 1
  const u = await prisma.user.create({
    data: { nickname: name, email: over.email ?? null, isAdmin: over.isAdmin ?? false, isOnboarded: over.isOnboarded ?? true, isBlocked: over.isBlocked ?? false },
    select: { id: true },
  })
  await prisma.account.create({ data: { userId: u.id, type: 'oauth', provider: 'kakao', providerAccountId: over.kakaoId ?? `k-${seq}` } })
  return u.id
}
const postBy = (authorId: string, ageMs: number, data: Record<string, unknown> = {}) =>
  prisma.post
    .create({ data: { boardType: 'FREE', title: `글${(seq += 1)}`, content: '본문', authorId, createdAt: new Date(NOW.getTime() - ageMs), ...data }, select: { id: true } })
    .then((p) => p.id)
const board = () => loadMemberResponseBoard(prisma, NOW, ENV)
const listed = async () => (await board()).rows.map((r) => r.id)

async function main(): Promise<void> {
  await wipe()

  console.log('\n① 대상 — 실회원 글만 · 최근 7일')
  const a = await member('회원가')
  const b = await member('회원나')
  const general = await postBy(a, 4 * H)
  const greeting = await postBy(a, 2 * H, { category: GREETING_CATEGORY })
  const inside = await postBy(a, MEMBER_RESPONSE_WINDOW_MS - 60_000)
  const outside = await postBy(a, MEMBER_RESPONSE_WINDOW_MS + 60_000)
  const magazine = await postBy(a, H, { boardType: 'MAGAZINE' })
  const hidden = await postBy(a, H, { status: 'HIDDEN' })
  const micro = await postBy(a, H, { isMicroSeed: true })
  const pu = await prisma.user.create({ data: { nickname: '자동이' }, select: { id: true } })
  const pz = await prisma.persona.create({ data: { code: 'P90', userId: pu.id, status: 'active' }, select: { id: true } })
  const personaPost = await postBy(pu.id, H, { personaId: pz.id, source: 'SYSTEM' })
  const wu = await prisma.user.create({ data: { nickname: '운영이름' }, select: { id: true } })
  const ow = await prisma.operatorWriter.create({ data: { code: 'OP90', userId: wu.id }, select: { id: true } })
  const operatorPost = await postBy(wu.id, H, { operatorWriterId: ow.id })
  const byFounderEmail = await postBy(await member('창업자메일', { email: 'Founder@Test.example' }), H)
  const byAllowlist = await postBy(await member('허용목록', { kakaoId: '9999' }), H)
  const byAdmin = await postBy(await member('관리자', { isAdmin: true }), H)
  const byNotOnboarded = await postBy(await member('미온보딩', { isOnboarded: false }), H)
  const byBlocked = await postBy(await member('운영차단', { isBlocked: true }), H)
  const ids = await listed()
  expect('실회원 일반 글 · 가입인사 · 7일 안 경계 글은 싣는다', [ids.includes(general), ids.includes(greeting), ids.includes(inside)], [true, true, true])
  expect('7일 넘은 글은 뺀다', ids.includes(outside), false)
  expect('매거진 · 숨김 · Micro Seed · Persona 글 · 운영자 글은 뺀다',
    [magazine, hidden, micro, personaPost, operatorPost].map((id) => ids.includes(id)), [false, false, false, false, false])
  expect('창업자 메일(대소문자 무시) · allowlist 카카오 · 관리자 · 미온보딩 · 운영 차단 회원 글은 뺀다',
    [byFounderEmail, byAllowlist, byAdmin, byNotOnboarded, byBlocked].map((id) => ids.includes(id)), [false, false, false, false, false])
  const rowsNow = (await board()).rows
  expect('가입인사 표시 · 오래 기다린 순', [rowsNow.find((r) => r.id === greeting)?.isGreeting, rowsNow[0]?.id], [true, inside])

  console.log('\n② 답 — 실제 저장 경로와 연결')
  const opDone = await createOperatorCommentTx(prisma, { operatorWriterId: ow.id, postId: general, content: '운영 답', actorUserId: wu.id, requestKey: 'mr-op-1' })
  expect('운영자 이름 댓글 등록', opDone.kind, 'created')
  const s1 = await board()
  expect('운영 답이 달린 글은 목록에서 빠진다 · 요약 운영 +1', [s1.rows.some((r) => r.id === general), s1.summary.byResponder.operator], [false, 1])
  if (opDone.kind === 'created') await prisma.comment.update({ where: { id: opDone.targetId }, data: { isDeleted: true } })
  expect('그 답을 지우면 다시 돌아온다', (await listed()).includes(general), true)
  await prisma.comment.create({ data: { postId: general, authorId: b, content: '저도요', commentOrigin: 'MEMBER', source: 'USER' } })
  expect('다른 회원이 답하면 빠진다', (await listed()).includes(general), false)
  await prisma.userBlock.create({ data: { blockerId: a, blockedUserId: b } })
  expect('글쓴이가 그 회원을 차단하면 다시 돌아온다', (await listed()).includes(general), true)
  await prisma.comment.create({ data: { postId: greeting, authorId: a, content: '제 글에 제가', commentOrigin: 'MEMBER', source: 'USER' } })
  expect('글쓴이 본인 댓글은 답이 아니다', (await listed()).includes(greeting), true)

  console.log('\n③ 신고 — 빼지 않고 표시')
  await prisma.report.create({ data: { reporterId: b, postId: greeting, reason: '시험', status: 'PENDING' } })
  await prisma.report.create({ data: { reporterId: b, postId: inside, reason: '시험', status: 'RESOLVED' } })
  const rows3 = (await board()).rows
  expect('처리 대기 신고 글은 남고 표시된다 · 처리된 신고는 표시 없음',
    [rows3.find((r) => r.id === greeting)?.pendingReport, rows3.find((r) => r.id === inside)?.pendingReport], [true, false])

  console.log('\n④ 답 쓰기 미리 선택 — 단건 대상')
  for (let i = 0; i < 31; i += 1) await postBy(b, 10 * 60_000 + i)
  const recent = await getComposeTargetPosts()
  expect('최근 30편 밖의 회원 글도 단건으로 고를 수 있다', [recent.some((t) => t.id === inside), (await getComposeTargetPost(inside))?.id], [false, inside])
  expect('숨김 · 매거진 · 없는 글은 null', [await getComposeTargetPost(hidden), await getComposeTargetPost(magazine), await getComposeTargetPost('no-such')], [null, null, null])
  const withDeleted = await postBy(a, 5 * 60_000)
  await prisma.comment.create({ data: { postId: withDeleted, authorId: b, content: '살아 있음', commentOrigin: 'MEMBER', source: 'USER' } })
  await prisma.comment.create({ data: { postId: withDeleted, authorId: b, content: '지움', commentOrigin: 'MEMBER', source: 'USER', isDeleted: true } })
  expect('대상 글의 댓글 수는 지운 댓글을 세지 않는다', (await getComposeTargetPosts()).find((t) => t.id === withDeleted)?.commentCount, 1)

  console.log('\n⑤ 상한 — 조용히 자르지 않는다')
  await wipe()
  const c = await member('많이쓴회원')
  for (let i = 0; i < MEMBER_RESPONSE_LIST_MAX; i += 1) await postBy(c, H + i)
  expect(`${MEMBER_RESPONSE_LIST_MAX}편 → 잘림 없음`, (await board()).truncated, false)
  await postBy(c, H + MEMBER_RESPONSE_LIST_MAX)
  const over = await board()
  expect(`${MEMBER_RESPONSE_LIST_MAX + 1}편 → 잘림 표시`, [over.truncated, over.summary.total], [true, MEMBER_RESPONSE_LIST_MAX])

  await wipe()
  console.log(`\n결과: PASS ${pass} · FAIL ${fail}`)
}

main()
  .catch((e) => {
    console.error(e)
    fail += 1
  })
  .finally(async () => {
    await prisma.$disconnect()
    process.exit(fail ? 1 : 0)
  })
