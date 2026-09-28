#!/usr/bin/env tsx
/**
 * /best 순위 키·기록 — **실제 DB 트랜잭션** 검증
 *
 * 🔴 CI 에 넣지 않는다. Postgres 가 필요하다. 식의 성질은 `npm run check:best` 가 본다.
 * 🔴 운영 DB 에 절대 붙이지 않는다. 아래 가드가 주소를 보고 아니면 즉시 멈춘다.
 *
 * 격리 Postgres 는 scripts/operator-compose-db-check.mts 머리 주석의 절차 그대로다
 * (DB 이름 soran_test · `npx prisma migrate deploy` 로 0030 까지 올린 뒤 실행).
 *
 * 쓰기 경로(actions)가 트랜잭션 안에서 부르는 함수를 **그대로** 부른다 —
 * recomputePostRanking · applyMemberBlock · backfillBestRanking. 목록은 새 /best 가 쓸 loadBestPage 다.
 *
 * 🔴 지금 판(PR-A)의 쓰기 경로는 순위 키만 갱신하고 기록하지 않는다. 기록 판정(recordBestEntries)은
 *    backfill 과 새 화면 활성화(PR-B)가 켠다 — 여기서 기록 판정은 그 함수를 **직접** 불러 검사한다.
 */
import { PrismaClient, type Prisma } from '@prisma/client'

import {
  countRealReactions,
  recomputePostRanking,
  applyMemberBlock,
  backfillBestRanking,
  recordBestEntries,
} from '../src/lib/best-ranking-db'
import { bestRankScore, reactionWeight, sameRankScore } from '../src/lib/best-ranking'
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

async function reset(): Promise<void> {
  await prisma.bestSelection.deleteMany({})
  await prisma.like.deleteMany({})
  await prisma.comment.deleteMany({})
  await prisma.userBlock.deleteMany({})
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
  const createdAt = new Date(BASE - ageH * H)
  const p = await prisma.post.create({
    data: { boardType: 'FREE', title: `t${ageH}`, content: 'c', authorId, createdAt, ...extra },
    select: { id: true },
  })
  // 기존 글과 같게 — 작성 시각에서 출발한다(migration 의 UPDATE 와 같은 값)
  await prisma.post.update({ where: { id: p.id }, data: { bestRankScore: createdAt.getTime() / 1000 }, select: { id: true } })
  return p.id
}
/** actions/likes.ts 와 같은 트랜잭션 모양 */
async function like(postId: string, userId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.like.create({ data: { postId, userId } })
    await tx.post.update({ where: { id: postId }, data: { likeCount: { increment: 1 } }, select: { id: true } })
    await recomputePostRanking(tx, postId)
  })
}
async function unlike(postId: string, userId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.like.delete({ where: { postId_userId: { postId, userId } } })
    await tx.post.updateMany({ where: { id: postId, likeCount: { gt: 0 } }, data: { likeCount: { decrement: 1 } } })
    await recomputePostRanking(tx, postId)
  })
}
/** actions/comments.ts · guest-comments.ts 와 같은 트랜잭션 모양 */
async function comment(postId: string, data: Partial<Prisma.CommentUncheckedCreateInput>) {
  let id = ''
  await prisma.$transaction(async (tx) => {
    id = (await tx.comment.create({ data: { postId, content: 'x', ...data }, select: { id: true } })).id
    await recomputePostRanking(tx, postId)
  })
  return id
}
async function weightOf(postId: string) {
  return (await prisma.post.findUniqueOrThrow({ where: { id: postId }, select: { bestReactionWeight: true } }))
    .bestReactionWeight
}
async function invariantHolds(postId: string) {
  const p = await prisma.post.findUniqueOrThrow({
    where: { id: postId },
    select: { createdAt: true, bestRankScore: true, bestReactionWeight: true, authorId: true, id: true },
  })
  const w = reactionWeight(await countRealReactions(prisma, p))
  return w === p.bestReactionWeight && sameRankScore(p.bestRankScore, bestRankScore({ createdAt: p.createdAt, weight: w }))
}
const selCount = (postId?: string) => prisma.bestSelection.count({ where: postId ? { postId } : {} })

async function main(): Promise<void> {
  await reset()
  const author = await member('글쓴이')
  const m1 = await member('회원1')
  const m2 = await member('회원2')
  const m3 = await member('회원3')

  console.log('\n■ 1. 무엇을 실반응으로 세는가')
  const P = await post(author, 1)
  const personaUser = await prisma.user.create({ data: { nickname: '페르소나' }, select: { id: true } })
  const persona = await prisma.persona.create({ data: { code: 'P99', userId: personaUser.id }, select: { id: true } })
  for (let i = 0; i < 10; i += 1) await comment(P, { authorId: personaUser.id, source: 'SYSTEM', commentOrigin: 'PERSONA', personaId: persona.id })
  expect('Persona 댓글 10개 → 실반응 0', await weightOf(P), 0)
  const opUser = await prisma.user.create({ data: { nickname: '운영' }, select: { id: true } })
  const op = await prisma.operatorWriter.create({ data: { code: 'OP9', userId: opUser.id }, select: { id: true } })
  await comment(P, { authorId: opUser.id, commentOrigin: 'OPERATOR', operatorWriterId: op.id })
  await comment(P, { commentOrigin: 'MICRO_SEED_VERBATIM' })
  expect('OPERATOR · MICRO_SEED 댓글 → 실반응 0', await weightOf(P), 0)
  // 모순 행(PERSONA 인데 personaId 가 비었다) — 레인 칸만으로 거른다
  await comment(P, { authorId: m3, source: 'SYSTEM', commentOrigin: 'PERSONA' })
  expect('PERSONA 레인 댓글은 personaId 가 비어도 세지 않는다', await weightOf(P), 0)
  await like(P, author)
  await comment(P, { authorId: author })
  expect('작성자 자기 공감·자기 댓글 → 실반응 0', await weightOf(P), 0)
  await like(P, personaUser.id)
  await like(P, opUser.id)
  const noKakao = (await prisma.user.create({ data: { nickname: '계정없음' }, select: { id: true } })).id
  await like(P, noKakao)
  expect('Persona·운영 작성자·카카오 계정 없는 사용자의 공감 → 0', await weightOf(P), 0)
  // commentOrigin='MEMBER' 표기만으로 실회원이라 믿지 않는다 — 작성자 relation 으로 확인한다
  await comment(P, { authorId: noKakao })
  expect('Account 가 없는 사용자의 MEMBER 표기 댓글 → 0', await weightOf(P), 0)
  await comment(P, { authorId: personaUser.id })
  expect('Persona 연결 User 의 MEMBER 표기 댓글 → 0', await weightOf(P), 0)
  await comment(P, { authorId: opUser.id })
  expect('운영 작성자 연결 User 의 MEMBER 표기 댓글 → 0', await weightOf(P), 0)
  const banned = await member('차단된회원')
  await prisma.user.update({ where: { id: banned }, data: { isBlocked: true }, select: { id: true } })
  await like(P, banned)
  await comment(P, { authorId: banned })
  expect('운영 차단된 회원(카카오 계정 있음)의 공감·댓글 → 0', await weightOf(P), 0)
  expect('실반응 0 이면 순위 키 = 작성 시각 그대로', (await prisma.post.findUniqueOrThrow({ where: { id: P } })).bestRankScore, (BASE - H) / 1000)
  await like(P, m1)
  expect('실회원 공감 1 → 가중치 1', await weightOf(P), 1)
  const c1 = await comment(P, { authorId: m2 })
  await comment(P, { authorId: m2 })
  await comment(P, { authorId: m2 })
  expect('같은 회원이 댓글 3개 → 한 명(+2)', await weightOf(P), 3)
  const guests: string[] = []
  for (let i = 0; i < 5; i += 1) guests.push(await comment(P, { commentOrigin: 'GUEST', guestNickname: `손님${i}` }))
  expect('비회원 댓글 5개 → 3건에서 멈춤(+6)', await weightOf(P), 9)
  expect('저장된 키 = 식으로 다시 계산한 키', await invariantHolds(P), true)

  console.log('\n■ 2. 취소·삭제·복구가 현재 점수에 반영된다')
  await prisma.$transaction(async (tx) => {
    for (const id of guests) await tx.comment.update({ where: { id }, data: { isDeleted: true }, select: { id: true } })
    await recomputePostRanking(tx, P)
  })
  expect('비회원 댓글 전부 삭제 → 가중치 3', await weightOf(P), 3)
  await prisma.$transaction(async (tx) => {
    await tx.comment.updateMany({ where: { postId: P, authorId: m2 }, data: { isDeleted: true } })
    await recomputePostRanking(tx, P)
  })
  expect('회원 댓글 삭제 → 가중치 1', await weightOf(P), 1)
  await prisma.$transaction(async (tx) => {
    await tx.comment.update({ where: { id: c1 }, data: { isDeleted: false }, select: { id: true } })
    await recomputePostRanking(tx, P)
  })
  expect('어드민 댓글 복구 → 가중치 3', await weightOf(P), 3)
  const beforePersona = await prisma.post.findUniqueOrThrow({ where: { id: P }, select: { bestRankScore: true } })
  await comment(P, { authorId: personaUser.id, source: 'SYSTEM', commentOrigin: 'PERSONA', personaId: persona.id })
  expect('Persona 댓글을 더 달아도 키가 그대로', (await prisma.post.findUniqueOrThrow({ where: { id: P }, select: { bestRankScore: true } })).bestRankScore, beforePersona.bestRankScore)
  expect('쓰기 경로(PR-A)는 기록하지 않는다 — 12개 안 + 실반응이어도 0', await selCount(P), 0)
  await prisma.$transaction((tx) => recordBestEntries(tx))
  expect('기록 판정을 부르면 P(12개 안 + 실반응) 1건', await selCount(P), 1)
  await unlike(P, m1)
  await prisma.$transaction(async (tx) => {
    await tx.comment.updateMany({ where: { postId: P }, data: { isDeleted: true } })
    await recomputePostRanking(tx, P)
  })
  expect('공감 취소·댓글 전부 삭제 → 가중치 0', await weightOf(P), 0)
  expect('이미 남은 과거 기록은 지우지 않는다', await selCount(P), 1)

  console.log('\n■ 3. 부분 실패 — 원본과 순위가 함께 되돌아간다')
  const before = await prisma.post.findUniqueOrThrow({ where: { id: P }, select: { bestRankScore: true, bestReactionWeight: true } })
  const commentsBefore = await prisma.comment.count()
  let threw = false
  try {
    await prisma.$transaction(async (tx) => {
      await tx.comment.create({ data: { postId: P, authorId: m3, content: 'x' }, select: { id: true } })
      await recomputePostRanking(tx, P)
      throw new Error('순위 갱신 뒤 실패 흉내')
    })
  } catch {
    threw = true
  }
  expect('트랜잭션 안에서 실패하면 댓글도 순위도 남지 않는다',
    [threw, await prisma.comment.count(), await prisma.post.findUniqueOrThrow({ where: { id: P }, select: { bestRankScore: true, bestReactionWeight: true } })],
    [true, commentsBefore, before])
  // 공감 경로도 같다 — actions/likes.ts 와 같은 모양(공감 행 · likeCount · 순위)에서 순위 갱신 뒤 실패
  const likeBefore = await prisma.post.findUniqueOrThrow({ where: { id: P }, select: { likeCount: true, bestRankScore: true, bestReactionWeight: true, updatedAt: true } })
  const likesBefore = await prisma.like.count({ where: { postId: P } })
  let likeThrew = false
  try {
    await prisma.$transaction(async (tx) => {
      await tx.like.create({ data: { postId: P, userId: m3 } })
      await tx.post.update({ where: { id: P }, data: { likeCount: { increment: 1 } }, select: { id: true } })
      await recomputePostRanking(tx, P)
      throw new Error('순위 갱신 뒤 실패 흉내')
    })
  } catch {
    likeThrew = true
  }
  expect('공감 트랜잭션이 실패하면 공감 행·likeCount·순위·updatedAt 모두 그대로',
    [likeThrew, await prisma.like.count({ where: { postId: P } }), await prisma.post.findUniqueOrThrow({ where: { id: P }, select: { likeCount: true, bestRankScore: true, bestReactionWeight: true, updatedAt: true } })],
    [true, likesBefore, likeBefore])

  console.log('\n■ 4. 12위 경계 — 조회수는 입력이 아니고, 기록 판정은 끌려 올라온 글을 잡는다')
  await reset()
  const a = await member('작성')
  const u1 = await member('u1')
  const posts: string[] = []
  for (let i = 0; i < 13; i += 1) posts.push(await post(a, i)) // posts[0] 가장 새 글
  const thirteenth = posts[12]
  await like(thirteenth, u1)
  const top = async () => (await loadBestPage(prisma, { page: 1, blockedIds: [] })) as Extract<Awaited<ReturnType<typeof loadBestPage>>, { outOfRange: false }>
  const inTop = (await top()).posts.some((p) => p.id === thirteenth)
  expect('공감으로 12개 안에 들어와도 쓰기 경로는 기록하지 않는다(PR-A)', [inTop, await selCount(thirteenth)], [true, 0])

  await reset()
  const b = await member('작성2')
  const v1 = await member('v1')
  const v2 = await member('v2')
  const list: string[] = []
  for (let i = 0; i < 13; i += 1) list.push(await post(b, i * 2)) // 0,2,…,24 시간 전
  const viewsOnly = list[11] // 12위, 반응 0
  const voBefore = (await prisma.post.findUniqueOrThrow({ where: { id: viewsOnly } })).bestRankScore
  // /api/view 가 쓰는 바로 그 문장(순위와 결합하지 않는다)으로 조회수 10만
  await prisma.post.updateMany({ where: { id: viewsOnly, status: 'PUBLISHED' }, data: { viewCount: { increment: 100_000 } } })
  await prisma.$transaction((tx) => recomputePostRanking(tx, viewsOnly))
  await like(list[3], v2) // 다른 글의 사건으로 12개를 다시 본다
  expect('조회수 10만 → 순위 키 그대로 · 가중치 0 · 기록 0',
    [(await prisma.post.findUniqueOrThrow({ where: { id: viewsOnly } })).bestRankScore, await weightOf(viewsOnly), await selCount(viewsOnly)],
    [voBefore, 0, 0])
  const edge = list[12]
  await prisma.post.update({ where: { id: edge }, data: { createdAt: new Date(BASE - 40 * H) }, select: { id: true } })
  await prisma.$transaction((tx) => recomputePostRanking(tx, edge))
  await like(edge, v1) // 40h 전 + 8h = 32h 전 수준 → 13위
  const edgeTop = (await top()).posts.map((p) => p.id)
  expect('공감이 있어도 13위면 기록 0', [edgeTop.includes(edge), await selCount(edge)], [false, 0])
  // 12개 중 한 글을 숨긴다 — actions/admin.ts setPostHidden 과 같은 모양
  await prisma.$transaction(async (tx) => {
    await tx.post.update({ where: { id: list[0] }, data: { status: 'HIDDEN' }, select: { id: true } })
    await recordBestEntries(tx)
  })
  expect('기록 판정: 위 글이 숨겨져 13위가 12위로 끌려 올라오면 그 순간 기록된다', await selCount(edge), 1)
  const again = await prisma.$transaction((tx) => recordBestEntries(tx))
  expect('다시 불러도 새 행 0 (멱등)', again.created, 0)
  expect('다른 글의 기록 판정이 여러 번 돌아도 반응 0 글은 끝까지 기록 0',
    [(await top()).posts.some((p) => p.id === viewsOnly), await selCount(viewsOnly)], [true, 0])

  console.log('\n■ 5. 동시성 — 행 1건 · 원본 유실 0 · 오류 0')
  await reset()
  const w = await member('작성3')
  const fans: string[] = []
  for (let i = 0; i < 8; i += 1) fans.push(await member(`fan${i}`))
  const hot = await post(w, 1)
  const results = await Promise.allSettled(fans.map((f) => like(hot, f)))
  expect('8명이 동시에 공감 → 전부 성공', results.filter((r) => r.status === 'rejected').length, 0)
  expect('공감 원본 8건 · 가중치 8', [await prisma.like.count({ where: { postId: hot } }), await weightOf(hot)], [8, 8])
  expect('쓰기 경로만으로는 기록 0 (PR-A)', await selCount(hot), 0)
  const recs = await Promise.allSettled(Array.from({ length: 10 }, () => prisma.$transaction((tx) => recordBestEntries(tx))))
  expect('기록 함수 10번 동시 호출 → 오류 0 · 행 1 (중복 0)', [recs.filter((r) => r.status === 'rejected').length, await selCount(hot)], [0, 1])
  const commenters = [await member('c1'), await member('c2'), await member('c3'), await member('c4')]
  const mixed = await Promise.allSettled([
    ...commenters.map((c) => comment(hot, { authorId: c })),
    ...[0, 1, 2].map((i) => comment(hot, { commentOrigin: 'GUEST', guestNickname: `동시손님${i}` })),
    ...[0, 1, 2].map(() => comment(hot, { authorId: fans[0] })),
  ])
  expect('회원 댓글 4명 + 비회원 3건 + 같은 회원 3건 동시 → 오류 0', mixed.filter((r) => r.status === 'rejected').length, 0)
  expect('가중치 = 8 + 5명×2 + 3×2 = 24 · 키 = 식 (동시 쓰기가 서로를 덮지 않았다)', [await weightOf(hot), await invariantHolds(hot)], [24, true])

  console.log('\n■ 6. C-4 — 승격 차단 글은 순위 계산에 들어가지 않는다')
  const seed = await post(w, 0, { isMicroSeed: true, permanentNoindex: true, indexPromotionBlocked: true })
  const seedBefore = await prisma.post.findUniqueOrThrow({ where: { id: seed }, select: { bestRankScore: true } })
  await like(seed, fans[0])
  await comment(seed, { authorId: fans[1] })
  const seedAfter = await prisma.post.findUniqueOrThrow({ where: { id: seed }, select: { bestRankScore: true, bestReactionWeight: true } })
  expect('Micro Seed 에 실회원 공감·댓글 → 키·가중치 그대로', [seedAfter.bestRankScore, seedAfter.bestReactionWeight], [seedBefore.bestRankScore, 0])
  expect('Micro Seed 는 기록되지 않는다', await selCount(seed), 0)

  console.log('\n■ 7. 목록·개수 — 현재 12개 · 기록 · 차단 · 숨김 · 복구 · 동점')
  await reset()
  const writer = await member('작가')
  const blocked = await member('차단될사람')
  const fan = await member('팬')
  const ids: string[] = []
  // 30개 글: 모두 실반응 1(공감). 오래된 글부터 만들고, 공감마다 기록 판정을 직접 불러
  // 이벤트 기록(PR-B)이 켜진 상태의 기록을 쌓는다.
  for (let i = 29; i >= 0; i -= 1) {
    const id = await post(i % 5 === 0 ? blocked : writer, i * 3)
    await like(id, fan)
    await prisma.$transaction((tx) => recordBestEntries(tx))
    ids.push(id)
  }
  const total = await selCount()
  const g1 = await loadBestPage(prisma, { page: 1, blockedIds: [] })
  const g2 = await loadBestPage(prisma, { page: 2, blockedIds: [] })
  if (g1.outOfRange || g2.outOfRange) throw new Error('범위 밖')
  expect('1쪽은 현재 12개 · 순위 키 내림차순', [g1.kind, g1.posts.length], ['current', 12])
  expect(`기록 ${total}건 중 1쪽 12개를 뺀 수로 쪽이 정해진다`, g1.lastPage, 1 + Math.ceil((total - 12) / 12))
  expect('1쪽과 2쪽에 같은 글 0', g2.posts.filter((p) => g1.posts.some((q) => q.id === p.id)).length, 0)
  const all: string[] = []
  for (let pg = 2; pg <= g1.lastPage; pg += 1) {
    const r = await loadBestPage(prisma, { page: pg, blockedIds: [] })
    if (!r.outOfRange) all.push(...r.posts.map((p) => p.id))
  }
  expect('2쪽부터 모두 모으면 기록 − 1쪽 · 중복 0', [all.length, new Set(all).size], [total - 12, total - 12])
  expect('마지막 쪽 다음은 범위 밖(404)', (await loadBestPage(prisma, { page: g1.lastPage + 1, blockedIds: [] })).outOfRange, true)
  expect('거대한 page 도 500 없이 범위 밖', (await loadBestPage(prisma, { page: parsePageParam('999999999999999999999999'), blockedIds: [] })).outOfRange, true)

  const b1 = await loadBestPage(prisma, { page: 1, blockedIds: [blocked] })
  if (b1.outOfRange) throw new Error('범위 밖')
  const blockedPosts = await prisma.post.findMany({ where: { authorId: blocked }, select: { id: true } })
  const blockedIds = new Set(blockedPosts.map((p) => p.id))
  expect('차단한 작성자의 글은 1쪽에서 빠지고 다음 글로 12개를 채운다', [b1.posts.length, b1.posts.some((p) => blockedIds.has(p.id))], [12, false])
  const visibleArchive = await prisma.bestSelection.count({
    where: { postId: { notIn: b1.posts.map((p) => p.id) }, post: { authorId: { notIn: [blocked] } } },
  })
  expect('차단 목록은 목록과 개수에 똑같이 걸린다', b1.lastPage, 1 + Math.ceil(visibleArchive / 12))
  expect('보는 사람이 차단해도 전역 기록은 그대로', await selCount(), total)

  const archived = all[0]
  const firstBefore = (await prisma.bestSelection.findUniqueOrThrow({ where: { postId: archived } })).firstEnteredAt
  await prisma.$transaction(async (tx) => {
    await tx.post.update({ where: { id: archived }, data: { status: 'HIDDEN' }, select: { id: true } })
    await recordBestEntries(tx)
  })
  const h2 = await loadBestPage(prisma, { page: 2, blockedIds: [] })
  const hiddenCount = await prisma.bestSelection.count({ where: { post: { status: 'PUBLISHED' }, postId: { notIn: g1.posts.map((p) => p.id) } } })
  expect('숨긴 글은 기록 목록과 개수에서 빠진다(행은 남는다)',
    [!h2.outOfRange && h2.posts.some((p) => p.id === archived), hiddenCount, await selCount(archived)], [false, total - 13, 1])
  await prisma.$transaction(async (tx) => {
    await tx.post.update({ where: { id: archived }, data: { status: 'PUBLISHED' }, select: { id: true } })
    await recordBestEntries(tx)
  })
  const r2 = await loadBestPage(prisma, { page: 2, blockedIds: [] })
  const firstAfter = (await prisma.bestSelection.findUniqueOrThrow({ where: { postId: archived } })).firstEnteredAt
  expect('되살리면 원래 최초 진입 시각 그대로 원래 자리로 돌아온다',
    [!r2.outOfRange && r2.posts[0]?.id === archived, firstAfter.toISOString()], [true, firstBefore.toISOString()])

  const t1 = await post(writer, 0.5)
  const t2 = await post(writer, 0.5)
  const [hi, lo] = t1 > t2 ? [t1, t2] : [t2, t1]
  const tie = await loadBestPage(prisma, { page: 1, blockedIds: [] })
  const order = !tie.outOfRange ? tie.posts.map((p) => p.id) : []
  expect('키가 같으면 id 가 큰 글이 위', order.indexOf(hi) < order.indexOf(lo) && order.indexOf(lo) >= 0, true)

  console.log('\n■ 8. Post.updatedAt — 순위 갱신은 글 수정 시각이 아니다')
  await reset()
  const ua = await member('수정시각작가')
  const ub = await member('수정시각독자1')
  const uc = await member('수정시각독자2')
  const U = await post(ua, 1)
  const at = async () => (await prisma.post.findUniqueOrThrow({ where: { id: U }, select: { updatedAt: true } })).updatedAt.toISOString()
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const u0 = await at()
  const uc1 = await comment(U, { authorId: ub })
  await comment(U, { commentOrigin: 'GUEST', guestNickname: '시각손님' })
  await prisma.$transaction(async (tx) => {
    await tx.comment.update({ where: { id: uc1 }, data: { isDeleted: true }, select: { id: true } })
    await recomputePostRanking(tx, U)
  })
  await prisma.$transaction((tx) => recomputePostRanking(tx, U))
  await prisma.$transaction((tx) => recordBestEntries(tx))
  expect('회원 댓글·비회원 댓글·댓글 삭제·재계산·기록 → updatedAt 그대로 (가중치는 바뀜)', [await at(), await weightOf(U)], [u0, 2])
  // 공감: likeCount 갱신(기존 동작)이 updatedAt 을 움직인다. 순위 코드는 거기에 더하지 않는다.
  const likeTrace = await prisma.$transaction(async (tx) => {
    await tx.like.create({ data: { postId: U, userId: uc } })
    const afterCount = await tx.post.update({ where: { id: U }, data: { likeCount: { increment: 1 } }, select: { updatedAt: true } })
    await recomputePostRanking(tx, U)
    const afterRank = await tx.post.findUniqueOrThrow({ where: { id: U }, select: { updatedAt: true } })
    return [afterCount.updatedAt.toISOString(), afterRank.updatedAt.toISOString()]
  })
  expect('공감: 순위 갱신 뒤 updatedAt = likeCount 갱신 직후 값 (순위 코드가 더 움직이지 않는다)', likeTrace[1], likeTrace[0])

  // 경합 1 — 순위 쪽이 updatedAt 을 읽은 뒤, 잠그기 전에 실제 글 수정이 커밋된다.
  //   조건부 잠금이 0 건 → 다시 읽어 새 값으로 잠근다. 수정 시각을 과거 값으로 되돌리지 않는다.
  const beforeRace1 = await at()
  let editedAt1 = ''
  const edit1 = prisma.$transaction(async (tx) => {
    editedAt1 = (await tx.post.update({ where: { id: U }, data: { title: '수정1' }, select: { updatedAt: true } })).updatedAt.toISOString()
    await pause(400) // 이 동안 순위 쪽은 옛 updatedAt 을 읽고, 잠금에서 기다린다
  }, { timeout: 10_000 })
  await pause(100)
  const rank1 = comment(U, { authorId: ub })
  await Promise.all([edit1, rank1])
  const race1 = await prisma.post.findUniqueOrThrow({ where: { id: U }, select: { updatedAt: true, title: true } })
  expect('경합 1: 수정이 먼저 커밋 → updatedAt = 수정 시각(옛 값으로 안 되돌아감) · 제목 유지 · 순위 반영',
    [race1.updatedAt.toISOString() === editedAt1, editedAt1 > beforeRace1, race1.title, await invariantHolds(U)],
    [true, true, '수정1', true])

  // 경합 2 — 순위 쪽이 먼저 잠그고, 실제 글 수정이 기다렸다가 들어온다. 수정 시각이 이긴다.
  let editedAt2 = ''
  const rank2 = prisma.$transaction(async (tx) => {
    await tx.comment.create({ data: { postId: U, content: 'x', commentOrigin: 'GUEST', guestNickname: '경합손님' }, select: { id: true } })
    await recomputePostRanking(tx, U)
    await pause(400) // 잠금을 쥔 채 머문다
  }, { timeout: 10_000 })
  await pause(100)
  const edit2 = prisma.post.update({ where: { id: U }, data: { title: '수정2' }, select: { updatedAt: true } })
    .then((r) => { editedAt2 = r.updatedAt.toISOString() })
  await Promise.all([rank2, edit2])
  const race2 = await prisma.post.findUniqueOrThrow({ where: { id: U }, select: { updatedAt: true, title: true } })
  expect('경합 2: 순위가 먼저 잠금 → 수정이 뒤에 들어와 updatedAt = 수정 시각 · 제목 유지 · 순위 반영',
    [race2.updatedAt.toISOString() === editedAt2, editedAt2 > editedAt1, race2.title, await invariantHolds(U)],
    [true, true, '수정2', true])

  // 같은 글에 반응 여러 건이 동시에 — 가중치 유실 0 · updatedAt 그대로
  const beforeBurst = await at()
  const burstUsers = await Promise.all(['b1', 'b2', 'b3', 'b4', 'b5', 'b6'].map((n) => member(`동시${n}`)))
  const burst = await Promise.allSettled(burstUsers.map((u) => comment(U, { authorId: u })))
  expect('회원 6명 동시 댓글 → 오류 0 · 키 = 식 · updatedAt 그대로',
    [burst.filter((r) => r.status === 'rejected').length, await invariantHolds(U), await at()], [0, true, beforeBurst])

  console.log('\n■ 9. backfill 전에는 기록 0 · backfill 이 초기 순위와 초기 기록을 만든다')
  await reset()
  const bw = await member('백필작가')
  const bf = [await member('백필독자1'), await member('백필독자2'), await member('백필독자3')]
  const bposts: string[] = []
  for (let i = 0; i < 16; i += 1) bposts.push(await post(bw, i * 5)) // 0,5,…,75 시간 전
  // 운영 배포 직후처럼: 반응은 쓰기 경로(PR-A)로 생긴다 — 순위 키만 바뀌고 기록은 0
  await like(bposts[14], bf[0]) // 70h 전 + 8h
  await comment(bposts[15], { authorId: bf[1] }) // 75h 전 + 12.7h
  await like(bposts[2], bf[2]) // 10h 전 + 8h
  expect('backfill 전: 반응이 생겨도 BestSelection 0', await selCount(), 0)
  // 운영 초기 상태를 흉내 — 0030 이 기존 글을 작성 시각·가중치 0 으로 채운 뒤 아직 backfill 전인 글
  const stale = bposts[5]
  await comment(stale, { authorId: bf[0] })
  await prisma.post.update({ where: { id: stale }, data: { bestReactionWeight: 0, bestRankScore: (BASE - 25 * H) / 1000 }, select: { id: true } })
  const dry = await backfillBestRanking(prisma, { apply: false })
  expect('dry-run: 바뀔 글을 찾고 아무것도 쓰지 않는다',
    [dry.changed >= 1, dry.written, dry.created, await selCount(), await weightOf(stale)], [true, 0, 0, 0, 0])
  const run1 = await backfillBestRanking(prisma, { apply: true })
  const top12 = await prisma.post.findMany({ where: { status: 'PUBLISHED' }, orderBy: [{ bestRankScore: 'desc' }, { id: 'desc' }], take: 12, select: { id: true, bestReactionWeight: true } })
  const expectRec = top12.filter((p) => p.bestReactionWeight > 0).map((p) => p.id).sort()
  const gotRec = (await prisma.bestSelection.findMany({ select: { postId: true, recordedBy: true } }))
  expect('apply: 모든 글의 키 = 식 (초기값이던 글 포함)',
    (await Promise.all(bposts.map((id) => invariantHolds(id)))).every(Boolean), true)
  expect('apply: 기록 = 지금 12개 중 실반응 글 정확히 · recordedBy=backfill',
    [gotRec.map((r) => r.postId).sort(), gotRec.every((r) => r.recordedBy === 'backfill')], [expectRec, true])
  expect('12위 밖 실반응 글(70h·75h 전)은 기록하지 않는다',
    [await selCount(bposts[14]), await selCount(bposts[15])], [top12.some((p) => p.id === bposts[14]) ? 1 : 0, top12.some((p) => p.id === bposts[15]) ? 1 : 0])
  const run2 = await backfillBestRanking(prisma, { apply: true })
  expect('두 번째 apply: 쓰기 0 (키 0 · 기록 0 · 최고 순위 0)', [run2.written, run2.created, run2.peakRaised], [0, 0, 0])
  expect('첫 apply 가 쓴 양 = dry-run 예측', [run1.written, run1.created], [dry.changed, dry.toCreate])

  console.log('\n■ 10. 회원 차단·해제 — 그 회원이 반응한 글만 다시 계산한다')
  await reset()
  const owner = await member('차단시험작가')
  const likerOnly = await member('공감만')
  const commenterOnly = await member('댓글만')
  const both = await member('공감과댓글')
  const X1 = await post(owner, 1)
  const X2 = await post(owner, 2)
  const X3 = await post(owner, 3)
  const X4 = await post(owner, 4)
  const X5 = await post(owner, 5)
  const untouched = await post(owner, 6)
  await like(X1, likerOnly)
  await like(X1, owner) // 작성자 본인 공감 — 원래 세지 않는다
  await comment(X2, { authorId: commenterOnly })
  await comment(X2, { authorId: commenterOnly })
  await like(X3, both)
  await comment(X3, { authorId: both })
  await like(X4, both)
  await comment(X5, { authorId: both })
  const block = (u: string, b: boolean) => prisma.$transaction((tx) => applyMemberBlock(tx, u, b), { timeout: 60_000 })
  const weights = async () => Promise.all([X1, X2, X3, X4, X5, untouched].map(weightOf))
  expect('차단 전 가중치 [X1 공감1 · X2 한 명 댓글 · X3 공감+댓글 · X4 공감 · X5 댓글 · 무관]', await weights(), [1, 2, 3, 1, 2, 0])
  const untouchedUpdated = (await prisma.post.findUniqueOrThrow({ where: { id: untouched } })).updatedAt.toISOString()
  expect('공감만 한 회원 차단 → X1 만 0 (영향 글 1)', [(await block(likerOnly, true)).affectedPosts, await weights()], [1, [0, 2, 3, 1, 2, 0]])
  expect('해제 → X1 복구', [(await block(likerOnly, false)).affectedPosts, (await weights())[0]], [1, 1])
  expect('댓글만(같은 글 2개) 회원 차단 → X2 0 (영향 글 1)', [(await block(commenterOnly, true)).affectedPosts, (await weights())[1]], [1, 0])
  await block(commenterOnly, false)
  expect('해제 → X2 복구(한 명 = 2)', (await weights())[1], 2)
  await prisma.$transaction((tx) => recordBestEntries(tx))
  const x3Rec = await selCount(X3)
  expect('공감+댓글·여러 글 회원 차단 → X3·X4·X5 에서 빠진다 (같은 글 한 번 · 영향 글 3)',
    [(await block(both, true)).affectedPosts, await weights()], [3, [1, 2, 0, 0, 0, 0]])
  expect('차단해도 과거 기록은 지우지 않는다', [x3Rec, await selCount(X3)], [1, 1])
  expect('이미 차단된 회원을 다시 차단 → 오류 0 · 결과 같음', [(await block(both, true)).affectedPosts, await weights()], [3, [1, 2, 0, 0, 0, 0]])
  await block(both, false)
  expect('해제 → X3·X4·X5 복구', await weights(), [1, 2, 3, 1, 2, 0])
  expect('작성자 본인 차단 → 본인 공감은 원래 0 이라 X1 그대로', [(await block(owner, true)).affectedPosts, (await weights())[0]], [1, 1])
  await block(owner, false)
  expect('반응 없는 글은 건드리지 않는다(updatedAt 그대로)', (await prisma.post.findUniqueOrThrow({ where: { id: untouched } })).updatedAt.toISOString(), untouchedUpdated)
  const blockedBefore = (await prisma.user.findUniqueOrThrow({ where: { id: both } })).isBlocked
  let blockThrew = false
  try {
    await prisma.$transaction(async (tx) => {
      await applyMemberBlock(tx, both, true)
      throw new Error('재계산 뒤 실패 흉내')
    }, { timeout: 60_000 })
  } catch {
    blockThrew = true
  }
  expect('차단 트랜잭션이 실패하면 isBlocked 와 모든 글 점수가 그대로',
    [blockThrew, (await prisma.user.findUniqueOrThrow({ where: { id: both } })).isBlocked, await weights()], [true, blockedBefore, [1, 2, 3, 1, 2, 0]])
  expect('차단·해제 뒤 모든 글의 키 = 식', (await Promise.all([X1, X2, X3, X4, X5].map(invariantHolds))).every(Boolean), true)

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
