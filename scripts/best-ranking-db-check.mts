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
 * syncBestRanking · applyMemberBlock · backfillBestRanking. 목록은 /best 가 쓰는 loadBestPage 다.
 * 운영 글 숨김은 흉내 내지 않고 실제 deleteOperatorPostTx 를 부른다.
 * server action 은 세션이 필요해 직접 부르지 않는다 — 대신 `npm run check:best` 가 각 action 이
 * 아래 헬퍼와 같은 모양(같은 tx 안에서 원본 변경 → syncBestRanking)인지 호출을 세어 묶는다.
 *
 * 🔴 PR-B: 쓰기 경로가 사건마다 순위 키를 갱신하고 전역 12개를 보고 기록한다.
 *    recomputePostRanking · recordBestEntries 를 직접 부르는 곳은 "그 함수 자체의 성질" 을 보는 검사뿐이다.
 */
import { PrismaClient, type Prisma } from '@prisma/client'

import {
  countRealReactions,
  recomputePostRanking,
  applyMemberBlock,
  backfillBestRanking,
  recordBestEntries,
  syncBestRanking,
} from '../src/lib/best-ranking-db'
import { deleteOperatorPostTx } from '../src/lib/operator-compose-tx'
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
    await syncBestRanking(tx, postId)
  })
}
async function unlike(postId: string, userId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.like.delete({ where: { postId_userId: { postId, userId } } })
    await tx.post.updateMany({ where: { id: postId, likeCount: { gt: 0 } }, data: { likeCount: { decrement: 1 } } })
    await syncBestRanking(tx, postId)
  })
}
/** actions/comments.ts · guest-comments.ts 와 같은 트랜잭션 모양 */
async function comment(postId: string, data: Partial<Prisma.CommentUncheckedCreateInput>) {
  let id = ''
  await prisma.$transaction(async (tx) => {
    id = (await tx.comment.create({ data: { postId, content: 'x', ...data }, select: { id: true } })).id
    await syncBestRanking(tx, postId)
  })
  return id
}
/** actions/delete.ts deleteComment · guest-comments.ts deleteGuestComment · admin.ts setCommentHidden 과 같은 모양 */
async function setCommentDeleted(commentIds: string[], postId: string, isDeleted: boolean) {
  await prisma.$transaction(async (tx) => {
    for (const id of commentIds) await tx.comment.update({ where: { id }, data: { isDeleted }, select: { id: true } })
    await syncBestRanking(tx, postId)
  })
}
/** actions/admin.ts setPostHidden · actions/delete.ts deletePost 와 같은 모양 — 상태를 바꾼 뒤 판정한다 */
async function setPostStatus(postId: string, status: 'PUBLISHED' | 'HIDDEN' | 'DELETED') {
  await prisma.$transaction(async (tx) => {
    await tx.post.update({ where: { id: postId }, data: { status }, select: { id: true } })
    await syncBestRanking(tx, postId)
  })
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
  expect('Persona·운영·MicroSeed·작성자 본인·차단 회원·계정 없는 반응만 받은 글: 12개 안(1위)이어도 기록 0', await selCount(P), 0)
  await like(P, m1)
  expect('실회원 공감 1 → 가중치 1', await weightOf(P), 1)
  expect('실회원 공감 1 → 그 사건에서 기록 1', await selCount(P), 1)
  const c1 = await comment(P, { authorId: m2 })
  await comment(P, { authorId: m2 })
  await comment(P, { authorId: m2 })
  expect('같은 회원이 댓글 3개 → 한 명(+2)', await weightOf(P), 3)
  const guests: string[] = []
  for (let i = 0; i < 5; i += 1) guests.push(await comment(P, { commentOrigin: 'GUEST', guestNickname: `손님${i}` }))
  expect('비회원 댓글 5개 → 3건에서 멈춤(+6)', await weightOf(P), 9)
  expect('저장된 키 = 식으로 다시 계산한 키', await invariantHolds(P), true)
  expect('반응이 여러 번 더 와도 기록은 글당 1행', [await selCount(P), await selCount()], [1, 1])

  console.log('\n■ 2. 취소·삭제·복구가 현재 점수에 반영된다')
  await setCommentDeleted(guests, P, true)
  expect('비회원 댓글 전부 삭제 → 가중치 3', await weightOf(P), 3)
  const m2Comments = (await prisma.comment.findMany({ where: { postId: P, authorId: m2 }, select: { id: true } })).map((c) => c.id)
  await setCommentDeleted(m2Comments, P, true)
  expect('회원 댓글 삭제 → 가중치 1', await weightOf(P), 1)
  await setCommentDeleted([c1], P, false)
  expect('어드민 댓글 복구 → 가중치 3', await weightOf(P), 3)
  const beforePersona = await prisma.post.findUniqueOrThrow({ where: { id: P }, select: { bestRankScore: true } })
  await comment(P, { authorId: personaUser.id, source: 'SYSTEM', commentOrigin: 'PERSONA', personaId: persona.id })
  expect('Persona 댓글을 더 달아도 키가 그대로', (await prisma.post.findUniqueOrThrow({ where: { id: P }, select: { bestRankScore: true } })).bestRankScore, beforePersona.bestRankScore)
  await unlike(P, m1)
  await setCommentDeleted((await prisma.comment.findMany({ where: { postId: P }, select: { id: true } })).map((c) => c.id), P, true)
  expect('공감 취소·댓글 전부 삭제 → 가중치 0', await weightOf(P), 0)
  expect('이미 남은 과거 기록은 지우지 않는다', await selCount(P), 1)

  console.log('\n■ 3. 부분 실패 — 원본 · 상태 · 순위 · 기록이 함께 되돌아간다')
  // 기록이 **생길** 사건으로 실패를 흉내 낸다 — 기록이 없던 새 글 Q 가 실회원 반응으로 12개 안에 든다.
  const Q = await post(author, 0.5)
  const qState = () => prisma.post.findUniqueOrThrow({ where: { id: Q }, select: { bestRankScore: true, bestReactionWeight: true, likeCount: true, updatedAt: true, status: true } })
  const before = await qState()
  const commentsBefore = await prisma.comment.count()
  let threw = false
  try {
    await prisma.$transaction(async (tx) => {
      await tx.comment.create({ data: { postId: Q, authorId: m3, content: 'x' }, select: { id: true } })
      const r = await syncBestRanking(tx, Q)
      if (r.recorded.created !== 1) throw new Error('트랜잭션 안에서는 기록이 생겼어야 한다')
      throw new Error('기록 뒤 실패 흉내')
    })
  } catch (e) {
    threw = (e as Error).message === '기록 뒤 실패 흉내'
  }
  expect('댓글 트랜잭션이 기록까지 간 뒤 실패 → 댓글 · 순위 · 기록 모두 남지 않는다',
    [threw, await prisma.comment.count(), await qState(), await selCount(Q)],
    [true, commentsBefore, before, 0])
  // 공감 경로도 같다 — actions/likes.ts 와 같은 모양(공감 행 · likeCount · 순위 · 기록)에서 실패
  const likesBefore = await prisma.like.count({ where: { postId: Q } })
  let likeThrew = false
  try {
    await prisma.$transaction(async (tx) => {
      await tx.like.create({ data: { postId: Q, userId: m3 } })
      await tx.post.update({ where: { id: Q }, data: { likeCount: { increment: 1 } }, select: { id: true } })
      await syncBestRanking(tx, Q)
      throw new Error('기록 뒤 실패 흉내')
    })
  } catch {
    likeThrew = true
  }
  expect('공감 트랜잭션이 실패하면 공감 행 · likeCount · 순위 · updatedAt · 기록 모두 그대로',
    [likeThrew, await prisma.like.count({ where: { postId: Q } }), await qState(), await selCount(Q)],
    [true, likesBefore, before, 0])
  // 글 숨김 — 위 글 P 를 숨기면 판정이 돈다. 판정 뒤 실패하면 상태도 그대로다.
  let hideThrew = false
  try {
    await prisma.$transaction(async (tx) => {
      await tx.post.update({ where: { id: P }, data: { status: 'HIDDEN' }, select: { id: true } })
      await syncBestRanking(tx, P)
      throw new Error('판정 뒤 실패 흉내')
    })
  } catch {
    hideThrew = true
  }
  expect('글 숨김 트랜잭션이 판정 뒤 실패 → 글은 여전히 공개 · 기록 수 그대로',
    [hideThrew, (await prisma.post.findUniqueOrThrow({ where: { id: P }, select: { status: true } })).status, await selCount()],
    [true, 'PUBLISHED', 1])

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
  expect('13위 글이 실회원 공감으로 12개 안에 들어오면 그 사건에서 1회 기록', [inTop, await selCount(thirteenth)], [true, 1])
  const firstAt = (await prisma.bestSelection.findUniqueOrThrow({ where: { postId: thirteenth } })).firstEnteredAt.toISOString()
  const more = [await member('u2'), await member('u3')]
  for (const u of more) await like(thirteenth, u)
  await comment(thirteenth, { authorId: more[0] })
  expect('반응이 더 와도 행 1 · 최초 진입 시각 그대로',
    [await selCount(thirteenth), (await prisma.bestSelection.findUniqueOrThrow({ where: { postId: thirteenth } })).firstEnteredAt.toISOString()],
    [1, firstAt])
  expect('반응 0 인 나머지 12개 안 글은 사건이 여러 번 돌아도 기록 0', await selCount(), 1)

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
  await prisma.$transaction((tx) => syncBestRanking(tx, viewsOnly))
  await like(list[3], v2) // 다른 글의 사건으로 12개를 다시 본다
  expect('조회수 10만 → 순위 키 그대로 · 가중치 0 · 기록 0',
    [(await prisma.post.findUniqueOrThrow({ where: { id: viewsOnly } })).bestRankScore, await weightOf(viewsOnly), await selCount(viewsOnly)],
    [voBefore, 0, 0])
  const edge = list[12]
  await prisma.post.update({ where: { id: edge }, data: { createdAt: new Date(BASE - 40 * H) }, select: { id: true } })
  await prisma.$transaction((tx) => syncBestRanking(tx, edge))
  await like(edge, v1) // 40h 전 + 8h = 32h 전 수준 → 13위
  const edgeTop = (await top()).posts.map((p) => p.id)
  expect('공감이 있어도 13위면 기록 0', [edgeTop.includes(edge), await selCount(edge)], [false, 0])
  // 12개 중 한 글을 숨긴다 — actions/admin.ts setPostHidden 과 같은 모양(상태 변경 뒤 같은 tx 에서 판정)
  await setPostStatus(list[0], 'HIDDEN')
  expect('어드민 글 숨김: 13위가 12위로 끌려 올라오면 그 사건에서 기록된다',
    [(await top()).posts.some((p) => p.id === edge), await selCount(edge)], [true, 1])
  const again = await prisma.$transaction((tx) => recordBestEntries(tx))
  expect('다시 불러도 새 행 0 (멱등)', again.created, 0)
  expect('다른 글의 기록 판정이 여러 번 돌아도 반응 0 글은 끝까지 기록 0',
    [(await top()).posts.some((p) => p.id === viewsOnly), await selCount(viewsOnly)], [true, 0])

  // 회원 글 삭제 · 운영 글 숨김 · 공감 취소 — 각각 13위를 끌어올린다
  const pull = async (ageH: number, fan: string) => {
    const id = await post(b, ageH)
    await like(id, fan)
    return id
  }
  const next1 = await pull(41, await member('n1')) // 41h + 8h 수준 → 13위 후보
  expect('끌어올릴 후보는 지금 13위 밖 · 기록 0', [(await top()).posts.some((p) => p.id === next1), await selCount(next1)], [false, 0])
  await setPostStatus(list[1], 'DELETED') // actions/delete.ts deletePost 와 같은 모양
  expect('회원 글 삭제: 끌려 올라온 글이 그 사건에서 기록된다', [(await top()).posts.some((p) => p.id === next1), await selCount(next1)], [true, 1])

  // 운영 글을 먼저 올린다 — 새 글은 경계 글(next1)을 13위로 밀어낸다(이미 기록된 글이라 무관).
  // 그 뒤에 만든 next2(40.5h + 8h → edge 와 next1 사이)가 새 13위가 된다.
  const opUser2 = await prisma.user.create({ data: { nickname: '운영자2' }, select: { id: true } })
  const opWriter2 = await prisma.operatorWriter.create({ data: { code: 'OP8', userId: opUser2.id }, select: { id: true } })
  const opPost = await post(opUser2.id, 0.1, { operatorWriterId: opWriter2.id })
  const next2 = await pull(40.5, await member('n2'))
  const beforeOp = (await top()).posts.map((p) => p.id)
  expect('운영 글은 12개 안 · 끌어올릴 후보(next2)는 밖 · 기록 0',
    [beforeOp.includes(opPost), beforeOp.includes(next2), await selCount(next2)], [true, false, 0])
  const opResult = await deleteOperatorPostTx(prisma, { postId: opPost, actorUserId: opUser2.id })
  expect('운영 글 숨김(실제 deleteOperatorPostTx): 끌려 올라온 글이 기록된다 · 운영 글은 HIDDEN',
    [opResult.kind, (await prisma.post.findUniqueOrThrow({ where: { id: opPost }, select: { status: true } })).status,
      (await top()).posts.some((p) => p.id === next2), await selCount(next2)],
    ['deleted', 'HIDDEN', true, 1])

  // 공감 취소 — 경계의 글 D 가 공감을 잃고 내려가면 13위 E 가 올라온다
  await reset()
  const cancelAuthor = await member('취소작가')
  const [fanD, fanE] = [await member('취소독자D'), await member('취소독자E')]
  for (let i = 0; i < 11; i += 1) await post(cancelAuthor, i) // 0…10h 전 · 반응 0
  const D = await post(cancelAuthor, 15) // 공감 → 15h − 8h = 7h 수준 · 12개 안
  const E = await post(cancelAuthor, 20) // 공감 → 12h 수준 · 13위
  await like(D, fanD)
  await like(E, fanE)
  const beforeUnlike = (await top()).posts.map((p) => p.id)
  expect('공감 취소 전: D 는 12개 안(기록 1) · E 는 13위(기록 0)',
    [beforeUnlike.includes(D), await selCount(D), beforeUnlike.includes(E), await selCount(E)], [true, 1, false, 0])
  await unlike(D, fanD)
  const afterUnlike = (await top()).posts.map((p) => p.id)
  expect('공감 취소: D 가 밀려나고 E 가 그 사건에서 기록된다 · D 의 기록은 남는다',
    [afterUnlike.includes(D), afterUnlike.includes(E), await selCount(E), await selCount(D)], [false, true, 1, 1])

  console.log('\n■ 5. 동시성 — 행 1건 · 원본 유실 0 · 오류 0')
  await reset()
  const w = await member('작성3')
  const fans: string[] = []
  for (let i = 0; i < 8; i += 1) fans.push(await member(`fan${i}`))
  const hot = await post(w, 1)
  const results = await Promise.allSettled(fans.map((f) => like(hot, f)))
  expect('8명이 동시에 공감 → 전부 성공', results.filter((r) => r.status === 'rejected').length, 0)
  expect('공감 원본 8건 · 가중치 8', [await prisma.like.count({ where: { postId: hot } }), await weightOf(hot)], [8, 8])
  expect('동시 공감 8건 → 쓰기 경로의 기록 판정이 겹쳐도 행 정확히 1', await selCount(hot), 1)
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
  // 기록 0건 — 운영 도입 직후(backfill 결과 BestSelection 0행)와 같은 상태
  const emptyWriter = await member('빈기록작가')
  for (let i = 0; i < 15; i += 1) await post(emptyWriter, 200 + i)
  const empty1 = await loadBestPage(prisma, { page: 1, blockedIds: [] })
  expect('기록 0건: 1쪽은 현재 12개 · 마지막 쪽 1',
    [!empty1.outOfRange && empty1.posts.length, !empty1.outOfRange && empty1.lastPage], [12, 1])
  expect('기록 0건: 2쪽은 빈 200 이 아니라 범위 밖(404)', (await loadBestPage(prisma, { page: 2, blockedIds: [] })).outOfRange, true)
  await reset()
  const writer = await member('작가')
  const blocked = await member('차단될사람')
  const fan = await member('팬')
  const ids: string[] = []
  // 30개 글: 모두 실반응 1(공감). 오래된 글부터 만든다 — 공감 사건마다 쓰기 경로가 기록을 판정해
  // 운영과 같은 방식으로 과거 기록이 쌓인다(판정을 따로 부르지 않는다).
  for (let i = 29; i >= 0; i -= 1) {
    const id = await post(i % 5 === 0 ? blocked : writer, i * 3)
    await like(id, fan)
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
  await setPostStatus(archived, 'HIDDEN')
  const h2 = await loadBestPage(prisma, { page: 2, blockedIds: [] })
  const hiddenCount = await prisma.bestSelection.count({ where: { post: { status: 'PUBLISHED' }, postId: { notIn: g1.posts.map((p) => p.id) } } })
  expect('숨긴 글은 기록 목록과 개수에서 빠진다(행은 남는다)',
    [!h2.outOfRange && h2.posts.some((p) => p.id === archived), hiddenCount, await selCount(archived)], [false, total - 13, 1])
  await setPostStatus(archived, 'PUBLISHED')
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
  await setCommentDeleted([uc1], U, true)
  await prisma.$transaction((tx) => syncBestRanking(tx, U))
  expect('회원 댓글·비회원 댓글·댓글 삭제·재계산·기록 → updatedAt 그대로 (가중치는 바뀜 · 기록 1)',
    [await at(), await weightOf(U), await selCount(U)], [u0, 2, 1])
  // 공감: likeCount 갱신(기존 동작)이 updatedAt 을 움직인다. 순위·기록 코드는 거기에 더하지 않는다.
  const likeTrace = await prisma.$transaction(async (tx) => {
    await tx.like.create({ data: { postId: U, userId: uc } })
    const afterCount = await tx.post.update({ where: { id: U }, data: { likeCount: { increment: 1 } }, select: { updatedAt: true } })
    await syncBestRanking(tx, U)
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
    await syncBestRanking(tx, U)
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

  console.log('\n■ 9. 활성화 직전 backfill — PR-A 시기의 순위 키를 맞추고 그 순간의 12개를 초기 기록으로 만든다')
  await reset()
  const bw = await member('백필작가')
  const bf = [await member('백필독자1'), await member('백필독자2'), await member('백필독자3')]
  const bposts: string[] = []
  for (let i = 0; i < 16; i += 1) bposts.push(await post(bw, i * 5)) // 0,5,…,75 시간 전
  // PR-B 를 켜기 전 운영처럼: 그 시기의 쓰기 경로(PR-A)는 순위 키만 바꾸고 기록하지 않았다.
  // 🔴 이 헬퍼는 그 시기의 모양을 재현하려고만 둔다 — 지금 쓰기 경로는 syncBestRanking 이다.
  const prAReaction = (postId: string, write: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
    prisma.$transaction(async (tx) => {
      await write(tx)
      await recomputePostRanking(tx, postId)
    })
  await prAReaction(bposts[14], (tx) => tx.like.create({ data: { postId: bposts[14], userId: bf[0] } })) // 70h 전 + 8h
  await prAReaction(bposts[15], (tx) => tx.comment.create({ data: { postId: bposts[15], authorId: bf[1], content: 'x' } })) // 75h 전 + 12.7h
  await prAReaction(bposts[2], (tx) => tx.like.create({ data: { postId: bposts[2], userId: bf[2] } })) // 10h 전 + 8h
  expect('PR-A 시기: 반응이 생겨도 BestSelection 0', await selCount(), 0)
  // 운영 초기 상태를 흉내 — 0030 이 기존 글을 작성 시각·가중치 0 으로 채운 뒤 아직 backfill 전인 글
  const stale = bposts[5]
  await prisma.comment.create({ data: { postId: stale, authorId: bf[0], content: 'x' } })
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
  // 활성화 뒤: 이벤트가 이어서 기록한다 — 12위 밖이던 75h 전 글에 공감이 더 붙어 12개 안으로 들어온다
  const late = bposts[15]
  const lateIn = async () => (await prisma.post.findMany({ where: { status: 'PUBLISHED' }, orderBy: [{ bestRankScore: 'desc' }, { id: 'desc' }], take: 12, select: { id: true } })).some((p) => p.id === late)
  const lateWasIn = await lateIn()
  for (const u of [await member('활성후1'), await member('활성후2'), await member('활성후3')]) await like(late, u)
  const lateRow = await prisma.bestSelection.findUnique({ where: { postId: late }, select: { recordedBy: true } })
  expect('활성화 뒤 이벤트 진입은 recordedBy=event 로 이어서 쌓인다 (backfill 행은 그대로)',
    [lateWasIn, await lateIn(), lateRow?.recordedBy, (await prisma.bestSelection.count({ where: { recordedBy: 'backfill' } }))],
    [false, true, 'event', gotRec.length])

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
  const x3Rec = await selCount(X3) // 공감·댓글 사건에서 이미 기록됐다(6개뿐이라 모두 12개 안)
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

  console.log('\n■ 11. 차단·해제의 기록 판정은 모든 재계산이 끝난 뒤 한 번이다')
  // 글마다 판정하면: 해제 중간(A 만 복구, B 는 아직)에 A 가 12위로 잠깐 든다 → 기록된다.
  // 끝나면 B 가 A 위로 올라가 A 는 13위 — 커밋된 어느 순간에도 12개 안에 없던 A 가 기록으로 남는다.
  await reset()
  const base = await member('판정작가')
  const M = await member('차단후공감')
  for (let i = 0; i <= 10; i += 1) await post(base, i) // 11개 · 0…10h 전 · 반응 0
  const [pa, pb] = [await post(base, 60), await post(base, 60)]
  // 영향 글은 postId 순으로 재계산한다 — id 가 작은 쪽(먼저 계산)이 A, 큰 쪽이 B 가 되게 시각을 정한다
  const [A, B] = pa < pb ? [pa, pb] : [pb, pa]
  const setAge = (id: string, ageH: number) => prisma.post.update({
    where: { id }, data: { createdAt: new Date(BASE - ageH * H), bestRankScore: (BASE - ageH * H) / 1000 }, select: { id: true },
  })
  await setAge(A, 19) // 공감 → 11h 수준 : 11개(0…−10h) 다음 12위 후보
  await setAge(B, 17.5) // 공감 → 9.5h 수준 : A 보다 위, 10h 전 글보다 위
  await block(M, true) // 차단된 채로 공감 — 가중치 0, 기록 0
  await like(A, M)
  await like(B, M)
  expect('차단 중: A·B 공감은 세지 않는다 · 기록 0', [await weightOf(A), await weightOf(B), await selCount()], [0, 0, 0])
  const unblocked = await block(M, false)
  const finalTop = (await prisma.post.findMany({ where: { status: 'PUBLISHED' }, orderBy: [{ bestRankScore: 'desc' }, { id: 'desc' }], take: 12, select: { id: true } })).map((p) => p.id)
  expect('해제 뒤 12개: B 는 안 · A 는 13위',
    [finalTop.includes(B), finalTop.includes(A), await weightOf(A), await weightOf(B)], [true, false, 1, 1])
  expect('기록 = 최종 12개의 실반응 글(B) 하나 · 중간 상태에만 있던 A 는 기록 0 · 판정 결과 1건',
    [await selCount(B), await selCount(A), unblocked.recorded.created], [1, 0, 1])
  const reblocked = await block(M, true)
  expect('다시 차단: B 가 빠져도 과거 기록은 남고, 끌려 올라온 반응 0 글은 기록되지 않는다',
    [await selCount(B), await selCount(), reblocked.recorded.created], [1, 1, 0])

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
