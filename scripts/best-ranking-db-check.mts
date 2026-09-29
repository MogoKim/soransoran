#!/usr/bin/env tsx
/**
 * /best 입성 기록(best-v2) — **실제 DB 트랜잭션** 검증
 *
 * 🔴 CI 에 넣지 않는다. Postgres 가 필요하다. 순수 규칙은 `npm run check:best` 가 본다.
 * 🔴 운영 DB 에 절대 붙이지 않는다. 아래 가드가 주소를 보고 아니면 즉시 멈춘다.
 *
 * 격리 Postgres 는 scripts/operator-compose-db-check.mts 머리 주석의 절차 그대로다
 * (DB 이름 soran_test · `npx prisma migrate deploy` 로 0030 까지 올린 뒤 실행).
 *
 * 쓰기 경로(actions)가 트랜잭션 안에서 부르는 함수를 **그대로** 부른다 —
 * syncBestEligibility · applyMemberBlock · backfillBestEligibility. 목록은 /best 가 쓰는 loadBestPage 다.
 * 운영 글 숨김은 흉내 내지 않고 실제 deleteOperatorPostTx 를 부른다.
 * server action 은 세션이 필요해 직접 부르지 않는다 — 대신 `npm run check:best` 가 각 action 이
 * 아래 헬퍼와 같은 모양(같은 tx 안에서 원본 변경 → syncBestEligibility)인지 호출을 세어 묶는다.
 */
import { PrismaClient, type Prisma } from '@prisma/client'

import {
  applyMemberBlock,
  backfillBestEligibility,
  countRealReactions,
  syncBestEligibility,
} from '../src/lib/best-ranking-db'
import { reactionWeight } from '../src/lib/best-ranking'
import { deleteOperatorPostTx } from '../src/lib/operator-compose-tx'
import { loadBestPage } from '../src/lib/queries/best'
import { parsePageParam } from '../src/lib/list-query'

const URL = process.env.DATABASE_URL ?? ''
if (!/127\.0\.0\.1:\d+\/soran_test/.test(URL)) {
  console.error('🔴 격리 DB 가 아니다. 멈춘다. DATABASE_URL=' + URL)
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
const H = 3600_000
const BASE = new Date('2026-09-20T00:00:00Z').getTime()
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function reset(): Promise<void> {
  await prisma.bestSelection.deleteMany({})
  await prisma.like.deleteMany({})
  await prisma.comment.deleteMany({})
  await prisma.userBlock.deleteMany({})
  await prisma.operatorWriteLog.deleteMany({}) // 운영 글 숨김(deleteOperatorPostTx)이 남긴 행
  await prisma.post.deleteMany({})
  await prisma.persona.deleteMany({})
  await prisma.operatorWriter.deleteMany({})
  await prisma.account.deleteMany({})
  await prisma.user.deleteMany({})
}

let seq = 0
async function member(name: string) {
  const u = await prisma.user.create({ data: { nickname: name }, select: { id: true } })
  seq += 1
  await prisma.account.create({
    data: { userId: u.id, type: 'oauth', provider: 'kakao', providerAccountId: `k${seq}` },
  })
  return u.id
}
async function post(authorId: string, ageH: number, extra: Partial<Prisma.PostUncheckedCreateInput> = {}) {
  const p = await prisma.post.create({
    data: { boardType: 'FREE', title: `t${ageH}`, content: 'c', authorId, createdAt: new Date(BASE - ageH * H), ...extra },
    select: { id: true },
  })
  return p.id
}
/** actions/likes.ts 와 같은 트랜잭션 모양 */
async function like(postId: string, userId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.like.create({ data: { postId, userId } })
    await tx.post.update({ where: { id: postId }, data: { likeCount: { increment: 1 } }, select: { id: true } })
    await syncBestEligibility(tx, postId)
  })
}
async function unlike(postId: string, userId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.like.delete({ where: { postId_userId: { postId, userId } } })
    await tx.post.updateMany({ where: { id: postId, likeCount: { gt: 0 } }, data: { likeCount: { decrement: 1 } } })
    await syncBestEligibility(tx, postId)
  })
}
/** actions/comments.ts · guest-comments.ts 와 같은 트랜잭션 모양 */
async function comment(postId: string, data: Partial<Prisma.CommentUncheckedCreateInput>) {
  let id = ''
  await prisma.$transaction(async (tx) => {
    id = (await tx.comment.create({ data: { postId, content: 'x', ...data }, select: { id: true } })).id
    await syncBestEligibility(tx, postId)
  })
  return id
}
/** actions/delete.ts deleteComment · guest-comments.ts deleteGuestComment · admin.ts setCommentHidden 과 같은 모양 */
async function setCommentDeleted(commentIds: string[], postId: string, isDeleted: boolean) {
  await prisma.$transaction(async (tx) => {
    for (const id of commentIds) await tx.comment.update({ where: { id }, data: { isDeleted }, select: { id: true } })
    await syncBestEligibility(tx, postId)
  })
}
/** actions/admin.ts setPostHidden · actions/delete.ts deletePost 와 같은 모양 — 상태를 바꾼 뒤 판정한다 */
async function setPostStatus(postId: string, status: 'PUBLISHED' | 'HIDDEN' | 'DELETED') {
  await prisma.$transaction(async (tx) => {
    await tx.post.update({ where: { id: postId }, data: { status }, select: { id: true } })
    await syncBestEligibility(tx, postId)
  })
}
const block = (u: string, b: boolean) => prisma.$transaction((tx) => applyMemberBlock(tx, u, b), { timeout: 60_000 })
async function weightOf(postId: string) {
  return (await prisma.post.findUniqueOrThrow({ where: { id: postId }, select: { bestReactionWeight: true } })).bestReactionWeight
}
async function weightHolds(postId: string) {
  const p = await prisma.post.findUniqueOrThrow({ where: { id: postId }, select: { id: true, authorId: true, bestReactionWeight: true } })
  return reactionWeight(await countRealReactions(prisma, p)) === p.bestReactionWeight
}
const selCount = (postId?: string) => prisma.bestSelection.count({ where: postId ? { postId } : {} })
const enteredAt = async (postId: string) =>
  (await prisma.bestSelection.findUnique({ where: { postId }, select: { firstEnteredAt: true } }))?.firstEnteredAt.toISOString() ?? null
type Page = Extract<Awaited<ReturnType<typeof loadBestPage>>, { outOfRange: false }>
async function listPage(page = 1, blockedIds: string[] = []): Promise<Page> {
  const r = await loadBestPage(prisma, { page, blockedIds })
  if (r.outOfRange) throw new Error(`${page}쪽 범위 밖`)
  return r
}
const ids = (p: Page) => p.posts.map((x) => x.id)

async function main(): Promise<void> {
  await reset()
  const author = await member('글쓴이')
  const m1 = await member('회원1')
  const m2 = await member('회원2')
  const m3 = await member('회원3')

  console.log('\n■ 1. 무엇을 실반응으로 세는가 — 기준을 못 넘으면 입성하지 않는다')
  const P = await post(author, 1)
  const personaUser = await prisma.user.create({ data: { nickname: '페르소나' }, select: { id: true } })
  const persona = await prisma.persona.create({ data: { code: 'P99', userId: personaUser.id }, select: { id: true } })
  for (let i = 0; i < 10; i += 1) await comment(P, { authorId: personaUser.id, source: 'SYSTEM', commentOrigin: 'PERSONA', personaId: persona.id })
  const opUser = await prisma.user.create({ data: { nickname: '운영' }, select: { id: true } })
  const op = await prisma.operatorWriter.create({ data: { code: 'OP9', userId: opUser.id }, select: { id: true } })
  await comment(P, { authorId: opUser.id, commentOrigin: 'OPERATOR', operatorWriterId: op.id })
  await comment(P, { commentOrigin: 'MICRO_SEED_VERBATIM' })
  await comment(P, { authorId: m3, source: 'SYSTEM', commentOrigin: 'PERSONA' }) // 모순 행 — 레인 칸만으로 거른다
  await like(P, author)
  await comment(P, { authorId: author })
  await like(P, personaUser.id)
  await like(P, opUser.id)
  const noKakao = (await prisma.user.create({ data: { nickname: '계정없음' }, select: { id: true } })).id
  await like(P, noKakao)
  await comment(P, { authorId: noKakao })
  await comment(P, { authorId: personaUser.id })
  await comment(P, { authorId: opUser.id })
  const banned = await member('차단된회원')
  await prisma.user.update({ where: { id: banned }, data: { isBlocked: true }, select: { id: true } })
  await like(P, banned)
  await comment(P, { authorId: banned })
  expect('Persona·운영·MicroSeed·작성자 본인·차단 회원·계정 없는 반응만 → W 0 · 입성 0', [await weightOf(P), await selCount(P)], [0, 0])
  expect('반응 0 최신 글은 베스트 목록에 없다', ids(await listPage()).includes(P), false)
  await like(P, m1)
  expect('실회원 공감 1 → W 1 · 미진입', [await weightOf(P), await selCount(P)], [1, 0])
  await like(P, m2)
  expect('실회원 공감 2 → W 2 가 되는 그 사건에서 정확히 1회 입성 · recordedBy=event · best-v2',
    [await weightOf(P), await selCount(P), (await prisma.bestSelection.findUnique({ where: { postId: P } }))?.recordedBy,
      (await prisma.bestSelection.findUnique({ where: { postId: P } }))?.policyVersion],
    [2, 1, 'event', 'best-v2'])
  const pAt = await enteredAt(P)
  const c1 = await comment(P, { authorId: m3 })
  await comment(P, { authorId: m3 })
  const guests: string[] = []
  for (let i = 0; i < 5; i += 1) guests.push(await comment(P, { commentOrigin: 'GUEST', guestNickname: `손님${i}` }))
  expect('같은 회원 댓글 여러 개 = 한 명(+2) · 비회원 5건은 3건에서 멈춤(+6) → W 10 · 저장 W = 원본 행',
    [await weightOf(P), await weightHolds(P)], [10, true])
  expect('입성 뒤 반응이 급증해도 행 1 · firstEnteredAt 그대로', [await selCount(P), await enteredAt(P)], [1, pAt])

  console.log('\n■ 2. 반응이 줄어도 기록은 남는다')
  await setCommentDeleted(guests, P, true)
  await setCommentDeleted((await prisma.comment.findMany({ where: { postId: P, authorId: m3 }, select: { id: true } })).map((c) => c.id), P, true)
  await unlike(P, m1)
  await unlike(P, m2)
  expect('비회원 댓글·회원 댓글 삭제 · 공감 취소 → W 0 · 기록 유지 · 입성 시각 그대로 · 목록에 남음',
    [await weightOf(P), await selCount(P), await enteredAt(P), ids(await listPage()).includes(P)], [0, 1, pAt, true])
  await setCommentDeleted([c1], P, false)
  expect('어드민 댓글 복구로 W 가 다시 2 가 돼도 재등록 0 · 입성 시각 그대로', [await weightOf(P), await selCount(), await enteredAt(P)], [2, 1, pAt])

  console.log('\n■ 3. 부분 실패 — 원본 반응 · 상태 · W · 신규 기록이 함께 되돌아간다')
  const Q = await post(author, 0.5)
  const qState = () => prisma.post.findUniqueOrThrow({ where: { id: Q }, select: { bestReactionWeight: true, likeCount: true, updatedAt: true, status: true } })
  const qBefore = await qState()
  const commentsBefore = await prisma.comment.count()
  let threw = ''
  try {
    await prisma.$transaction(async (tx) => {
      await tx.comment.create({ data: { postId: Q, authorId: m1, content: 'x' }, select: { id: true } })
      const r = await syncBestEligibility(tx, Q)
      if (!r?.entered) throw new Error('트랜잭션 안에서는 입성했어야 한다')
      throw new Error('입성 뒤 실패 흉내')
    })
  } catch (e) {
    threw = (e as Error).message
  }
  expect('댓글 트랜잭션이 입성까지 간 뒤 실패 → 댓글 · W · 기록 모두 남지 않는다',
    [threw, await prisma.comment.count(), await qState(), await selCount(Q)], ['입성 뒤 실패 흉내', commentsBefore, qBefore, 0])
  let likeThrew = false
  try {
    await prisma.$transaction(async (tx) => {
      await tx.like.create({ data: { postId: Q, userId: m1 } })
      await tx.like.create({ data: { postId: Q, userId: m2 } })
      await tx.post.update({ where: { id: Q }, data: { likeCount: { increment: 2 } }, select: { id: true } })
      await syncBestEligibility(tx, Q)
      throw new Error('입성 뒤 실패 흉내')
    })
  } catch {
    likeThrew = true
  }
  expect('공감 트랜잭션이 실패하면 공감 행 · likeCount · W · updatedAt · 기록 모두 그대로',
    [likeThrew, await prisma.like.count({ where: { postId: Q } }), await qState(), await selCount(Q)], [true, 0, qBefore, 0])

  console.log('\n■ 4. 동시성 — 기준을 함께 넘어도 행 1 · 원본 유실 0 · 오류 0')
  await reset()
  const w = await member('작성3')
  const fans: string[] = []
  for (let i = 0; i < 8; i += 1) fans.push(await member(`fan${i}`))
  const hot = await post(w, 1)
  const two = await Promise.allSettled([like(hot, fans[0]), like(hot, fans[1])])
  expect('W 0 에서 두 명이 동시에 공감(합쳐야 W 2) → 오류 0 · W 2 · 입성 1 (서로의 공감을 못 본 채 둘 다 놓치지 않는다)',
    [two.filter((r) => r.status === 'rejected').length, await weightOf(hot), await selCount(hot)], [0, 2, 1])
  const results = await Promise.allSettled(fans.slice(2).map((f) => like(hot, f)))
  const mixed = await Promise.allSettled([
    ...[await member('c1'), await member('c2'), await member('c3')].map((c) => comment(hot, { authorId: c })),
    ...[0, 1, 2].map((i) => comment(hot, { commentOrigin: 'GUEST', guestNickname: `동시손님${i}` })),
  ])
  expect('공감 6 · 회원 댓글 3명 · 비회원 3건 동시 → 오류 0 · W = 8 + 6 + 6 = 20 · 행 1',
    [[...results, ...mixed].filter((r) => r.status === 'rejected').length, await weightOf(hot), await weightHolds(hot), await selCount()], [0, 20, true, 1])
  const race = await post(w, 2)
  const burst = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => comment(race, { commentOrigin: 'GUEST', guestNickname: `경합${i}` })))
  expect('비회원 댓글 6건 동시(각각 혼자서도 기준 통과) → 오류 0 · 행 1', [burst.filter((r) => r.status === 'rejected').length, await selCount(race)], [0, 1])

  console.log('\n■ 5. C-4 — 승격 차단 글은 입성하지 않는다')
  const seed = await post(w, 0, { isMicroSeed: true, permanentNoindex: true, indexPromotionBlocked: true })
  await like(seed, fans[0])
  await like(seed, fans[1])
  await comment(seed, { authorId: fans[2] })
  expect('Micro Seed 에 실회원 공감 2·댓글 → W 계산 안 함(0) · 입성 0', [await weightOf(seed), await selCount(seed)], [0, 0])

  console.log('\n■ 6. 입성 순서 — 최초 입성 최신순 · 오래된 글도 오늘 넘으면 맨 앞 · 이미 입성한 글은 제자리')
  await reset()
  const wr = await member('순서작가')
  const [f1, f2, f3] = [await member('순서1'), await member('순서2'), await member('순서3')]
  const A = await post(wr, 5)
  const B = await post(wr, 3)
  const C = await post(wr, 1)
  const old = await post(wr, 24 * 60) // 60일 전 글
  // 반응 0 인 최신 글 12개 — old 는 최신순으로도 옛 순위 키로도 12위 밖이다(옛 top-12 방식이면 못 들어온다)
  const fresh: string[] = []
  for (let i = 0; i < 12; i += 1) fresh.push(await post(wr, 0.1 + i * 0.01))
  await comment(A, { authorId: f1 })
  await pause(20)
  await comment(B, { authorId: f1 })
  await pause(20)
  await comment(C, { authorId: f1 })
  expect('입성 순서 A → B → C 이면 목록은 C · B · A', ids(await listPage()), [C, B, A])
  await pause(20)
  await like(old, f1)
  expect('60일 전 글 · W 1 → 미진입', ids(await listPage()).includes(old), false)
  await like(old, f2)
  expect('60일 전 미진입 글이 오늘 W 2 → 1쪽 맨 앞 (최신 글 12개가 반응 0 이어도)', ids(await listPage())[0], old)
  expect('반응 0 최신 글 12개는 목록에 하나도 없다', ids(await listPage()).filter((id) => fresh.includes(id)).length, 0)
  const aAt = await enteredAt(A)
  for (const u of [f2, f3]) await like(A, u)
  await comment(A, { authorId: f2 })
  expect('이미 입성한 A 에 반응 급증 → 순서 그대로 · 입성 시각 그대로', [ids(await listPage()), await enteredAt(A)], [[old, C, B, A], aAt])

  console.log('\n■ 7. 숨김·삭제·복구 — 목록과 개수에서 빠졌다가 원래 자리로')
  const before = await listPage()
  await setPostStatus(B, 'HIDDEN')
  const hidden = await listPage()
  expect('숨긴 B 는 목록 · 개수에서 빠진다 · 기록 행은 남는다', [ids(hidden), hidden.total, await selCount(B)], [[old, C, A], 3, 1])
  await setPostStatus(B, 'PUBLISHED')
  const restored = await listPage()
  expect('되살리면 원래 입성 자리로 돌아온다', [ids(restored), restored.total], [ids(before), before.total])
  const opUser2 = await prisma.user.create({ data: { nickname: '운영자2' }, select: { id: true } })
  const opWriter2 = await prisma.operatorWriter.create({ data: { code: 'OP8', userId: opUser2.id }, select: { id: true } })
  const opPost = await post(opUser2.id, 0.2, { operatorWriterId: opWriter2.id })
  await comment(opPost, { authorId: f3 })
  expect('운영 글도 실회원 반응으로 입성한다', ids(await listPage())[0], opPost)
  const opResult = await deleteOperatorPostTx(prisma, { postId: opPost, actorUserId: opUser2.id })
  expect('운영 글 숨김(실제 deleteOperatorPostTx) → HIDDEN · 목록에서 빠짐 · 기록 행은 남음',
    [opResult.kind, (await prisma.post.findUniqueOrThrow({ where: { id: opPost } })).status, ids(await listPage()).includes(opPost), await selCount(opPost)],
    ['deleted', 'HIDDEN', false, 1])
  await setPostStatus(C, 'DELETED')
  expect('회원 글 삭제 → 목록 · 개수에서 빠짐 · 기록 행은 남음', [ids(await listPage()).includes(C), (await listPage()).total, await selCount(C)], [false, 3, 1])
  const never = await post(wr, 2)
  await setPostStatus(never, 'HIDDEN')
  await comment(never, { authorId: f2 })
  expect('숨김 중에 W 2 가 된 글은 입성하지 않는다(공개 자격 없음)', [await weightOf(never), await selCount(never)], [2, 0])
  await setPostStatus(never, 'PUBLISHED')
  expect('그 글을 되살리면 되살린 순간 입성 → 맨 앞', [await selCount(never), ids(await listPage())[0]], [1, never])

  console.log('\n■ 8. 회원 차단·해제 — W 는 내려가도 기록은 남고, 해제로 넘으면 그때 입성')
  await reset()
  const owner = await member('차단작가')
  const X = await member('차단대상')
  const Y = await member('다른회원')
  const P1 = await post(owner, 1)
  const P2 = await post(owner, 2)
  const P3 = await post(owner, 3)
  await comment(P1, { authorId: X }) // P1 W 2 → 입성
  await like(P2, X) // P2 W 1
  await like(P3, X)
  await like(P3, Y) // P3 W 2 → 입성
  expect('차단 전: P1 입성 · P2 미진입 · P3 입성', [await selCount(P1), await selCount(P2), await selCount(P3)], [1, 0, 1])
  const b1 = await block(X, true)
  expect('X 차단 → 영향 글 3 · W [0, 0, 1] · 기록 P1·P3 유지 · 새 입성 0',
    [b1.affectedPosts, await weightOf(P1), await weightOf(P2), await weightOf(P3), await selCount(P1), await selCount(P3), b1.entered],
    [3, 0, 0, 1, 1, 1, 0])
  await like(P2, Y) // 차단 중: P2 는 Y 공감만 → W 1
  const b2 = await block(X, false)
  expect('해제 → W 복구 [2, 2, 2] · P2 가 해제 순간 입성(1건) · 기존 기록 그대로',
    [await weightOf(P1), await weightOf(P2), await weightOf(P3), b2.entered, await selCount()], [2, 2, 2, 1, 3])
  const blockedBefore = (await prisma.user.findUniqueOrThrow({ where: { id: X } })).isBlocked
  let blockThrew = false
  try {
    await prisma.$transaction(async (tx) => {
      await applyMemberBlock(tx, X, true)
      throw new Error('재계산 뒤 실패 흉내')
    }, { timeout: 60_000 })
  } catch {
    blockThrew = true
  }
  expect('차단 트랜잭션이 실패하면 isBlocked · W 그대로', [blockThrew, (await prisma.user.findUniqueOrThrow({ where: { id: X } })).isBlocked, await weightOf(P1)], [true, blockedBefore, 2])

  console.log('\n■ 9. 쪽 — 12개씩 · 13번째 2쪽 · 25번째 3쪽 · 차단 필터가 목록과 개수에 같이')
  await reset()
  const pw = await member('쪽작가')
  const pb = await member('차단될작가')
  const pf = await member('쪽팬')
  const order: string[] = [] // 입성 순서
  for (let i = 0; i < 30; i += 1) {
    const id = await post(i % 5 === 0 ? pb : pw, 100 - i)
    await comment(id, { authorId: pf })
    order.push(id)
    await pause(5)
  }
  const newest = [...order].reverse()
  const p1 = await listPage(1)
  const p2 = await listPage(2)
  const p3 = await listPage(3)
  expect('1쪽 = 1~12번째 · 2쪽 = 13~24번째 · 3쪽 = 25~30번째 · total 30 · 마지막 쪽 3',
    [ids(p1), ids(p2), ids(p3), p1.total, p1.lastPage], [newest.slice(0, 12), newest.slice(12, 24), newest.slice(24), 30, 3])
  expect('4쪽 · 거대한 page 는 범위 밖(404)',
    [(await loadBestPage(prisma, { page: 4, blockedIds: [] })).outOfRange, (await loadBestPage(prisma, { page: parsePageParam('999999999999999999999999'), blockedIds: [] })).outOfRange],
    [true, true])
  const visible = newest.filter((id) => !order.filter((_, i) => i % 5 === 0).includes(id))
  const bp: string[] = []
  const b1p = await listPage(1, [pb])
  for (let pg = 1; pg <= b1p.lastPage; pg += 1) bp.push(...ids(await listPage(pg, [pb])))
  expect('작성자를 차단한 사람: 목록 · 개수 · 마지막 쪽이 같은 필터 (24개 · 2쪽)', [bp, b1p.total, b1p.lastPage], [visible, 24, 2])
  expect('보는 사람이 차단해도 전역 기록은 그대로', await selCount(), 30)

  console.log('\n■ 10. 1,000개 — total · 쪽 계산 · 중복 0 · 누락 0')
  await reset()
  const big = await member('대량작가')
  const t0 = new Date('2026-01-01T00:00:00Z').getTime()
  const bigPosts = Array.from({ length: 1_000 }, (_, i) => ({ id: `big${String(i).padStart(4, '0')}`, boardType: 'FREE' as const, title: `b${i}`, content: 'c', authorId: big, createdAt: new Date(t0) }))
  await prisma.post.createMany({ data: bigPosts })
  // 읽기 검사용 표본 — 입성 시각을 1초씩 벌려 둔다(쓰기 경로 검사는 위 절들이 한다)
  await prisma.bestSelection.createMany({
    data: bigPosts.map((p, i) => ({ postId: p.id, firstEnteredAt: new Date(t0 + i * 1000), policyVersion: 'best-v2', recordedBy: 'event', scoreAtEntry: 0, peakRank: 0 })),
  })
  const g1 = await listPage(1)
  const collected: string[] = []
  for (let pg = 1; pg <= g1.lastPage; pg += 1) collected.push(...ids(await listPage(pg)))
  const want = bigPosts.map((p) => p.id).reverse()
  expect('1,000개: total 1000 · 마지막 쪽 84 · 84쪽 4개 · 85쪽 범위 밖',
    [g1.total, g1.lastPage, (await listPage(84)).posts.length, (await loadBestPage(prisma, { page: 85, blockedIds: [] })).outOfRange], [1000, 84, 4, true])
  expect('1~84쪽을 모으면 정확히 입성 최신순 1,000개 · 중복 0 · 누락 0', [collected.length, new Set(collected).size, collected.join() === want.join()], [1000, 1000, true])
  const tie = new Date('2026-06-01T00:00:00Z')
  await prisma.bestSelection.updateMany({ where: { postId: { in: ['big0001', 'big0002', 'big0003'] } }, data: { firstEnteredAt: tie } })
  const tieIds = ids(await listPage(1)).filter((id) => ['big0001', 'big0002', 'big0003'].includes(id))
  expect('입성 시각이 같으면 postId 큰 쪽이 먼저(안정 키)', tieIds, ['big0003', 'big0002', 'big0001'])

  console.log('\n■ 11. Post.updatedAt — 자격 동기화는 글 수정 시각이 아니다')
  await reset()
  const ua = await member('수정시각작가')
  const ub = await member('수정시각독자1')
  const uc = await member('수정시각독자2')
  const U = await post(ua, 1)
  const at = async () => (await prisma.post.findUniqueOrThrow({ where: { id: U }, select: { updatedAt: true } })).updatedAt.toISOString()
  const u0 = await at()
  const uc1 = await comment(U, { authorId: ub })
  await comment(U, { commentOrigin: 'GUEST', guestNickname: '시각손님' })
  await setCommentDeleted([uc1], U, true)
  expect('회원 댓글(입성)·비회원 댓글·댓글 삭제 → updatedAt 그대로 (W 는 바뀜 · 기록 1)', [await at(), await weightOf(U), await selCount(U)], [u0, 2, 1])
  const likeTrace = await prisma.$transaction(async (tx) => {
    await tx.like.create({ data: { postId: U, userId: uc } })
    const afterCount = await tx.post.update({ where: { id: U }, data: { likeCount: { increment: 1 } }, select: { updatedAt: true } })
    await syncBestEligibility(tx, U)
    const afterSync = await tx.post.findUniqueOrThrow({ where: { id: U }, select: { updatedAt: true } })
    return [afterCount.updatedAt.toISOString(), afterSync.updatedAt.toISOString()]
  })
  expect('공감: 동기화 뒤 updatedAt = likeCount 갱신 직후 값 (동기화 코드가 더 움직이지 않는다)', likeTrace[1], likeTrace[0])
  // 경합 1 — 동기화 쪽이 updatedAt 을 읽은 뒤, 잠그기 전에 실제 글 수정이 커밋된다.
  const beforeRace1 = await at()
  let editedAt1 = ''
  const edit1 = prisma.$transaction(async (tx) => {
    editedAt1 = (await tx.post.update({ where: { id: U }, data: { title: '수정1' }, select: { updatedAt: true } })).updatedAt.toISOString()
    await pause(400)
  }, { timeout: 10_000 })
  await pause(100)
  const rank1 = comment(U, { authorId: ub })
  await Promise.all([edit1, rank1])
  const race1 = await prisma.post.findUniqueOrThrow({ where: { id: U }, select: { updatedAt: true, title: true } })
  expect('경합 1: 수정이 먼저 커밋 → updatedAt = 수정 시각 · 제목 유지 · W 반영',
    [race1.updatedAt.toISOString() === editedAt1, editedAt1 > beforeRace1, race1.title, await weightHolds(U)], [true, true, '수정1', true])
  // 경합 2 — 동기화 쪽이 먼저 잠그고, 실제 글 수정이 기다렸다가 들어온다.
  let editedAt2 = ''
  const rank2 = prisma.$transaction(async (tx) => {
    await tx.comment.create({ data: { postId: U, content: 'x', commentOrigin: 'GUEST', guestNickname: '경합손님' }, select: { id: true } })
    await syncBestEligibility(tx, U)
    await pause(400)
  }, { timeout: 10_000 })
  await pause(100)
  const edit2 = prisma.post.update({ where: { id: U }, data: { title: '수정2' }, select: { updatedAt: true } })
    .then((r) => { editedAt2 = r.updatedAt.toISOString() })
  await Promise.all([rank2, edit2])
  const race2 = await prisma.post.findUniqueOrThrow({ where: { id: U }, select: { updatedAt: true, title: true } })
  expect('경합 2: 동기화가 먼저 잠금 → 수정이 뒤에 들어와 updatedAt = 수정 시각 · 제목 유지 · W 반영',
    [race2.updatedAt.toISOString() === editedAt2, editedAt2 > editedAt1, race2.title, await weightHolds(U)], [true, true, '수정2', true])

  console.log('\n■ 12. backfill — 신규 입성 · best-v1 전환만 쓴다 · 멱등 · 행 삭제 0')
  await reset()
  const kw = await member('백필작가')
  const [k1, k2] = [await member('백필독자1'), await member('백필독자2')]
  // 활성화 전 운영처럼: 반응은 원본 행만 있고 저장 W 는 0 이다
  const raw = async (ageH: number, extra: Partial<Prisma.PostUncheckedCreateInput> = {}) => post(kw, ageH, extra)
  const memberComment = (postId: string, userId: string) => prisma.comment.create({ data: { postId, authorId: userId, content: 'x' } })
  const v1 = (postId: string, minutesAgo: number) => prisma.bestSelection.create({
    data: { postId, policyVersion: 'best-v1', recordedBy: 'event', scoreAtEntry: 123, peakRank: 3, firstEnteredAt: new Date(Date.now() - minutesAgo * 60_000) },
  })
  const e1 = await raw(1); await memberComment(e1, k1) // W 2 · 기록 없음 → enter
  const e2 = await raw(2); await prisma.like.createMany({ data: [{ postId: e2, userId: k1 }, { postId: e2, userId: k2 }] }) // W 2 → enter
  const low = await raw(3); await prisma.like.create({ data: { postId: low, userId: k1 } }) // W 1 → below
  const gone = await raw(4, { status: 'DELETED' }); await memberComment(gone, k2) // W 2 · 삭제 → not-public
  const cseed = await raw(5, { isMicroSeed: true, permanentNoindex: true, indexPromotionBlocked: true }); await memberComment(cseed, k1) // → c4
  const cLegacy = await raw(6, { isMicroSeed: true, permanentNoindex: true, indexPromotionBlocked: true }); await memberComment(cLegacy, k1); await v1(cLegacy, 60)
  const up = await raw(7); await memberComment(up, k2); await v1(up, 120) // best-v1 · W 2 · 공개 → legacy-upgrade
  const v1low = await raw(8); await prisma.like.create({ data: { postId: v1low, userId: k2 } }); await v1(v1low, 90) // best-v1 · W 1 → legacy-ineligible
  const v1hidden = await raw(9, { status: 'HIDDEN' }); await memberComment(v1hidden, k1); await v1(v1hidden, 80) // best-v1 · W 2 · 숨김 → legacy-ineligible
  const v2rec = await raw(10); await memberComment(v2rec, k1)
  await prisma.bestSelection.create({ data: { postId: v2rec, policyVersion: 'best-v2', recordedBy: 'event', scoreAtEntry: 0, peakRank: 0, firstEnteredAt: new Date(Date.now() - 30 * 60_000) } })
  const snapshot = async () => (await prisma.bestSelection.findMany({ orderBy: { postId: 'asc' } })).map((r) => JSON.stringify(r))
  const beforeRows = await snapshot()
  const list0 = await listPage()
  expect('backfill 전 목록·개수 = best-v2 행만(v2rec 1) — best-v1 행 4개는 숨김', [ids(list0), list0.total], [[v2rec], 1])
  const dry = await backfillBestEligibility(prisma, { apply: false })
  expect('dry-run 판정: enter 2 · legacy-upgrade 1 · best-v2-recorded 1 · legacy-ineligible 3 · below 1 · not-public 1 · c4 1 · W 불일치 8',
    [dry.verdicts, dry.weightChanged],
    [{ enter: 2, 'legacy-upgrade': 1, 'best-v2-recorded': 1, 'legacy-ineligible': 3, below: 1, 'not-public': 1, c4: 1 }, 8])
  expect('dry-run: legacy-ineligible 사유 = C-4 · W<2 · 비공개',
    dry.rows.filter((r) => r.verdict === 'legacy-ineligible').map((r) => r.reason).sort(), ['C-4 승격 차단 글', 'W < 2', '비공개(숨김·삭제·게시판 밖)'].sort())
  expect('dry-run 쓰기 0 — 기록 행 · 저장 W 그대로', [await snapshot(), await weightOf(e1), await weightOf(up)], [beforeRows, 0, 0])
  const upBefore = await prisma.bestSelection.findUniqueOrThrow({ where: { postId: up } })
  const run1 = await backfillBestEligibility(prisma, { apply: true })
  expect('첫 apply = 예측: W 저장 8 · 신규 2 · 전환 1', [run1.weightWritten, run1.created, run1.upgraded], [dry.weightChanged, dry.verdicts.enter, dry.verdicts['legacy-upgrade']])
  const upAfter = await prisma.bestSelection.findUniqueOrThrow({ where: { postId: up } })
  expect('전환된 행: best-v2 · recordedBy=backfill · 입성 시각 = 전환 시각(이전보다 뒤) · deprecated 칼럼 0',
    [upAfter.policyVersion, upAfter.recordedBy, upAfter.firstEnteredAt > upBefore.firstEnteredAt, Date.now() - upAfter.firstEnteredAt.getTime() < 60_000, upAfter.scoreAtEntry, upAfter.peakRank],
    ['best-v2', 'backfill', true, true, 0, 0])
  const kept = await prisma.bestSelection.findMany({ where: { postId: { in: [cLegacy, v1low, v1hidden] } }, orderBy: { postId: 'asc' } })
  expect('자격 없는 best-v1 행 3개는 한 글자도 안 바뀐다 · 행 삭제 0',
    [kept.map((r) => JSON.stringify(r)), await selCount()],
    [beforeRows.filter((r) => [cLegacy, v1low, v1hidden].some((id) => r.includes(`"postId":"${id}"`))), 7])
  const list1 = await listPage()
  expect('apply 뒤 목록·개수: 신규 e1·e2 · 전환 up · 기존 v2rec (best-v1 행 3개는 계속 숨김)',
    [[...ids(list1)].sort(), list1.total, ids(list1).at(-1)], [[e1, e2, up, v2rec].sort(), 4, v2rec])
  const run2 = await backfillBestEligibility(prisma, { apply: true })
  expect('두 번째 apply: 쓰기 0', [run2.weightWritten, run2.created, run2.upgraded], [0, 0, 0])

  console.log('\n■ 13. 이벤트 경로의 best-v1 전환 — 숨김 · 한 번 전환 · 동시 · 롤백')
  await reset()
  const lw = await member('전환작가')
  const [la, lb, lc, ld, le] = [await member('전환1'), await member('전환2'), await member('전환3'), await member('전환4'), await member('전환5')]
  const oldV1 = (postId: string) => prisma.bestSelection.create({
    data: { postId, policyVersion: 'best-v1', recordedBy: 'event', scoreAtEntry: 99, peakRank: 5, firstEnteredAt: new Date(Date.now() - 3 * H) },
  })
  const L = await post(lw, 1)
  await like(L, la) // W 1
  await oldV1(L) // #613 운영 중 W 1 로 기록된 best-v1 행
  const lBefore = await prisma.bestSelection.findUniqueOrThrow({ where: { postId: L } })
  const l0 = await listPage()
  expect('best-v1 · W 1 행은 새 목록·개수에 나오지 않는다', [ids(l0).includes(L), l0.total], [false, 0])
  await like(L, lb) // W 2 → 전환
  const lAfter = await prisma.bestSelection.findUniqueOrThrow({ where: { postId: L } })
  expect('같은 글이 W 2 가 되는 사건에서 best-v2 로 전환: 행 1 · recordedBy=event · 입성 시각 = 전환 시각 · deprecated 0',
    [await selCount(L), lAfter.policyVersion, lAfter.recordedBy, lAfter.firstEnteredAt > lBefore.firstEnteredAt, Date.now() - lAfter.firstEnteredAt.getTime() < 60_000, lAfter.scoreAtEntry, lAfter.peakRank],
    [1, 'best-v2', 'event', true, true, 0, 0])
  expect('전환 뒤 목록 맨 앞 · 개수 1', [ids(await listPage())[0], (await listPage()).total], [L, 1])
  await like(L, lc)
  await comment(L, { authorId: ld })
  expect('전환 뒤 반응이 더 와도 한 번뿐 — 입성 시각 그대로', (await prisma.bestSelection.findUniqueOrThrow({ where: { postId: L } })).firstEnteredAt.toISOString(), lAfter.firstEnteredAt.toISOString())

  const Hd = await post(lw, 2, { status: 'HIDDEN' })
  await oldV1(Hd)
  const Cs = await post(lw, 3, { isMicroSeed: true, permanentNoindex: true, indexPromotionBlocked: true })
  await oldV1(Cs)
  const hdBefore = JSON.stringify(await prisma.bestSelection.findUniqueOrThrow({ where: { postId: Hd } }))
  const csBefore = JSON.stringify(await prisma.bestSelection.findUniqueOrThrow({ where: { postId: Cs } }))
  await comment(Hd, { authorId: la })
  await like(Hd, lb)
  await comment(Cs, { authorId: la })
  await like(Cs, lb)
  expect('best-v1 비공개·C-4 행: 반응이 W 2 를 넘겨도 그대로 남고 화면에는 없다',
    [JSON.stringify(await prisma.bestSelection.findUniqueOrThrow({ where: { postId: Hd } })), JSON.stringify(await prisma.bestSelection.findUniqueOrThrow({ where: { postId: Cs } })),
      ids(await listPage()).filter((id) => id === Hd || id === Cs).length],
    [hdBefore, csBefore, 0])

  const Z = await post(lw, 4)
  await oldV1(Z)
  const changes: string[] = []
  const likeWith = (u: string) => prisma.$transaction(async (tx) => {
    await tx.like.create({ data: { postId: Z, userId: u } })
    await tx.post.update({ where: { id: Z }, data: { likeCount: { increment: 1 } }, select: { id: true } })
    changes.push((await syncBestEligibility(tx, Z))?.change ?? 'null')
  })
  const guestWith = (i: number) => prisma.$transaction(async (tx) => {
    await tx.comment.create({ data: { postId: Z, content: 'x', commentOrigin: 'GUEST', guestNickname: `동시전환${i}` }, select: { id: true } })
    changes.push((await syncBestEligibility(tx, Z))?.change ?? 'null')
  })
  const conc = await Promise.allSettled([likeWith(la), likeWith(lb), likeWith(lc), guestWith(1), guestWith(2), backfillBestEligibility(prisma, { apply: true })])
  const bfUpgraded = conc[5].status === 'fulfilled' ? conc[5].value.upgraded : -1
  const upgradedTotal = changes.filter((c) => c === 'upgraded').length + bfUpgraded
  expect('best-v1 행에 공감 3 · 비회원 댓글 2 · backfill 이 동시에 → 오류 0 · 전환 정확히 1 · 행 1 · best-v2',
    [conc.filter((r) => r.status === 'rejected').length, upgradedTotal, await selCount(Z), (await prisma.bestSelection.findUniqueOrThrow({ where: { postId: Z } })).policyVersion, await weightHolds(Z)],
    [0, 1, 1, 'best-v2', true])

  const Rb = await post(lw, 5)
  await like(Rb, la)
  await oldV1(Rb)
  const rbBefore = JSON.stringify(await prisma.bestSelection.findUniqueOrThrow({ where: { postId: Rb } }))
  let rbThrew = ''
  try {
    await prisma.$transaction(async (tx) => {
      await tx.like.create({ data: { postId: Rb, userId: le } })
      const r = await syncBestEligibility(tx, Rb)
      if (r?.change !== 'upgraded') throw new Error('트랜잭션 안에서는 전환됐어야 한다')
      throw new Error('전환 뒤 실패 흉내')
    })
  } catch (e) {
    rbThrew = (e as Error).message
  }
  expect('공감 트랜잭션이 전환까지 간 뒤 실패 → 공감 · W · best-v1 행 모두 그대로',
    [rbThrew, await prisma.like.count({ where: { postId: Rb } }), await weightOf(Rb), JSON.stringify(await prisma.bestSelection.findUniqueOrThrow({ where: { postId: Rb } }))],
    ['전환 뒤 실패 흉내', 1, 1, rbBefore])

  console.log(`\n${fail === 0 ? '✅' : '🔴'} best-ranking-db-check: ${pass} 통과 · ${fail} 실패`)
}

main()
  .catch((err) => {
    console.error(err)
    fail += 1
  })
  .finally(async () => {
    await prisma.$disconnect()
    process.exit(fail === 0 ? 0 : 1)
  })
