#!/usr/bin/env tsx
/**
 * 🔴 **어드민 게시판 변경 — 격리 DB 검사** (soran_test 전용 · CI D100 격리 DB 사슬에 편입)
 *
 *   실제 트랜잭션(movePostBoardTx)을 가상 데이터에 돌려 다음을 잰다.
 *   · 성공 — 회원 글 · 운영 작성 글 양방향, 끝난 Persona 후보만 걸린 글
 *   · 막힘 write 0 — 가입인사 · Persona · Micro Seed · 오리지널 큐 · 열린 후보(PENDING · APPROVED · EDITED) ·
 *     매거진(지금 · 목표) · 이상한 값 · 같은 게시판 · 없는 글 · 숨김 · 삭제 · 화면이 본 게시판과 다름
 *   · 불변 — 제목 · 본문 · 작성자 · personaId · operatorWriterId · 댓글 · status · createdAt ·
 *     오리지널 큐 · Persona 후보 · 자동 READY 감사 · 단계 결정 · OperatorWriteLog
 *   · best-v2 — W 불변 · 입성 기록과 입성 시각 그대로
 *   · 동시성 — 같은 이동 두 번 · 반대 방향 동시 요청에서 성공은 한 번
 *
 * 🔴 운영 DB 에서 돌지 않는다. 이 검사가 만든 행만 지운다(같은 DB 를 쓰는 다른 검사를 건드리지 않는다).
 *
 *   실행: DATABASE_URL=postgresql://…@127.0.0.1:<port>/soran_test npx tsx scripts/board-move-db-check.mts
 */
import { PrismaClient, type BoardType, type PersonaCandidateStatus, type Prisma } from '@prisma/client'
import { movePostBoardTx, type BoardMoveResult } from '../src/lib/board-move-tx'
import { syncBestEligibility } from '../src/lib/best-ranking-db'
import {
  GREETING_POST_VISIBILITY_FLAGS, MICRO_SEED_POST_VISIBILITY_FLAGS, OPERATOR_POST_VISIBILITY_FLAGS,
} from '../src/lib/post-visibility'
import { GREETING_CATEGORY } from '../src/lib/greeting-policy'

const URL = process.env.DATABASE_URL ?? ''
if (!/127\.0\.0\.1:\d+\/soran_test/.test(URL)) {
  console.error('🔴 격리 DB 가 아니다. 멈춘다.')
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
const made = { users: [] as string[], posts: [] as string[], personas: [] as string[], writers: [] as string[], raws: [] as string[], queues: [] as string[], candidates: [] as string[] }
let seq = 0
const tag = `bm${Date.now().toString(36)}`

async function member(name: string): Promise<string> {
  seq += 1
  const u = await prisma.user.create({ data: { nickname: `${tag}-${name}-${seq}` }, select: { id: true } })
  await prisma.account.create({ data: { userId: u.id, type: 'oauth', provider: 'kakao', providerAccountId: `${tag}-${seq}` } })
  made.users.push(u.id)
  return u.id
}
async function post(authorId: string, data: Partial<Prisma.PostUncheckedCreateInput> = {}): Promise<string> {
  const p = await prisma.post.create({
    data: { boardType: 'FREE', title: `${tag} 글 ${seq}`, content: '본문', authorId, createdAt: new Date('2026-10-01T00:00:00Z'), ...data },
    select: { id: true },
  })
  made.posts.push(p.id)
  return p.id
}
/** 다른 실회원 댓글 + 답글 — 같은 트랜잭션에서 /best 를 맞춘다(댓글 단 실회원 2명 = W 4 → 입성) */
async function thread(postId: string): Promise<void> {
  const a = await member('댓글')
  const b = await member('답글')
  await prisma.$transaction(async (tx) => {
    const root = await tx.comment.create({ data: { postId, authorId: a, content: '저도요', commentOrigin: 'MEMBER' }, select: { id: true } })
    await tx.comment.create({ data: { postId, authorId: b, content: '맞아요', commentOrigin: 'MEMBER', parentId: root.id } })
    await syncBestEligibility(tx, postId)
  })
}
async function persona(): Promise<string> {
  const u = await member('페르소나')
  seq += 1
  const p = await prisma.persona.create({ data: { code: `B${seq}${tag}`.slice(0, 20), userId: u, status: 'active' }, select: { id: true } })
  made.personas.push(p.id)
  return p.id
}
async function candidate(postId: string, status: PersonaCandidateStatus): Promise<void> {
  seq += 1
  const c = await prisma.personaApprovalQueue.create({
    data: {
      personaId: await persona(), targetPostId: postId, status, candidateText: '저도 그래요', reactionType: 'experience',
      gateStatus: 'pass', gateResults: [], dedupKey: `${tag}:cand:${seq}`,
    },
    select: { id: true },
  })
  made.candidates.push(c.id)
}
async function queueLinked(authorId: string): Promise<string> {
  seq += 1
  const id = await post(authorId)
  const raw = await prisma.microSeedRawContent.create({
    data: { origin: 'live', sourceSite: 'test:bm', sourceUrl: `https://example.invalid/${tag}/${seq}`, sourceArticleId: `${tag}-${seq}`, sourceCapturedAt: new Date(), rawTitle: 't', rawBody: 'b' },
    select: { id: true },
  })
  made.raws.push(raw.id)
  const q = await prisma.originalPostApprovalQueue.create({
    data: {
      sourceRawContentId: raw.id, status: 'APPROVED', draftTitle: 't', draftBody: 'b', gateVerdict: 'PASS', gateResults: { boardTopic: 'FREE' },
      promptVersion: 'bm', model: 'bm', dedupKey: `${tag}:q:${seq}`, createdPostId: id,
    },
    select: { id: true },
  })
  made.queues.push(q.id)
  return id
}

/** 이동 전후 비교용 — boardType · updatedAt 을 뺀 글 전부 + 연결 기록 */
async function snap(postId: string) {
  const p = await prisma.post.findUnique({
    where: { id: postId },
    select: {
      title: true, content: true, authorId: true, personaId: true, operatorWriterId: true, status: true,
      createdAt: true, category: true, source: true, bestReactionWeight: true,
      comments: { select: { id: true, parentId: true, content: true, isDeleted: true, authorId: true, commentOrigin: true }, orderBy: { id: 'asc' } },
      bestSelection: { select: { firstEnteredAt: true, recordedBy: true } },
    },
  })
  return {
    post: p,
    queues: await prisma.originalPostApprovalQueue.findMany({ where: { createdPostId: postId }, orderBy: { id: 'asc' } }),
    candidates: await prisma.personaApprovalQueue.findMany({ where: { targetPostId: postId }, orderBy: { id: 'asc' } }),
    audits: await prisma.autoReadyAudit.count(),
    stageDecisions: await prisma.stageDecision.count(),
    operatorLogs: await prisma.operatorWriteLog.count(),
  }
}
async function board(postId: string): Promise<{ boardType: BoardType; updatedAt: string } | null> {
  const r = await prisma.post.findUnique({ where: { id: postId }, select: { boardType: true, updatedAt: true } })
  return r ? { boardType: r.boardType, updatedAt: r.updatedAt.toISOString() } : null
}
const move = (postId: string, from: string, to: string): Promise<BoardMoveResult> => movePostBoardTx(prisma, { postId, from, to })
const short = (r: BoardMoveResult) => (r.ok ? 'ok' : r.code)

/** 막힘 — 결과 코드 · 글 전체 · 게시판 · updatedAt 까지 그대로여야 한다 */
async function blockedNoWrite(label: string, postId: string, from: string, to: string, code: string): Promise<void> {
  const b0 = await board(postId); const s0 = await snap(postId)
  const r = await move(postId, from, to)
  expect(`${label} → ${code} · write 0`, { r: short(r), board: await board(postId), snap: await snap(postId) }, { r: code, board: b0, snap: s0 })
}

async function main(): Promise<void> {
  console.log('\n══ 어드민 게시판 변경 — 격리 DB ══\n')
  const author = await member('작성자')

  console.log('1. 성공 — 회원 글 양방향 · 불변 · best-v2')
  const m = await post(author)
  await thread(m)
  const m0 = await snap(m)
  expect('준비 — 댓글 단 실회원 2명으로 W 4 · 입성 기록 있음', [m0.post?.bestReactionWeight, m0.post?.bestSelection !== null], [4, true])
  expect('회원 글 FREE → MENOPAUSE', short(await move(m, 'FREE', 'MENOPAUSE')), 'ok')
  expect('게시판만 MENOPAUSE · 나머지 전부 그대로(댓글 parent · W · 입성 시각 · 큐 · 후보 · 감사 · 로그)', [(await board(m))?.boardType, await snap(m)], ['MENOPAUSE', m0])
  expect('회원 글 MENOPAUSE → FREE', short(await move(m, 'MENOPAUSE', 'FREE')), 'ok')
  expect('되돌린 뒤에도 전부 그대로', [(await board(m))?.boardType, await snap(m)], ['FREE', m0])

  console.log('\n2. 성공 — 운영 작성 글 양방향 · OperatorWriteLog 0')
  const opUser = await member('운영작성자')
  seq += 1
  const writer = await prisma.operatorWriter.create({ data: { code: `O${seq}${tag}`.slice(0, 20), userId: opUser }, select: { id: true } })
  made.writers.push(writer.id)
  const op = await post(opUser, { boardType: 'MENOPAUSE', operatorWriterId: writer.id, ...OPERATOR_POST_VISIBILITY_FLAGS })
  const op0 = await snap(op)
  expect('운영 글 MENOPAUSE → FREE', short(await move(op, 'MENOPAUSE', 'FREE')), 'ok')
  expect('운영 글 FREE → MENOPAUSE', short(await move(op, 'FREE', 'MENOPAUSE')), 'ok')
  expect('운영 글 — operatorWriterId · 작성자 그대로 · OperatorWriteLog 행 수 그대로', await snap(op), op0)

  console.log('\n3. 성공 — 끝난 Persona 후보만 걸린 글')
  const closed = await post(author)
  for (const s of ['PUBLISHED', 'DECLINED', 'EXPIRED'] as const) await candidate(closed, s)
  const closed0 = await snap(closed)
  expect('PUBLISHED · DECLINED · EXPIRED 후보만 → 이동 가능', short(await move(closed, 'FREE', 'MENOPAUSE')), 'ok')
  expect('후보 3개 행 그대로(상태 · gateResults · 문구)', (await snap(closed)).candidates, closed0.candidates)

  console.log('\n4. 막힘 — write 0')
  await blockedNoWrite('가입인사', await post(author, { category: GREETING_CATEGORY, ...GREETING_POST_VISIBILITY_FLAGS }), 'FREE', 'MENOPAUSE', 'GREETING_POST')
  await blockedNoWrite('Persona 글', await post(author, { personaId: await persona() }), 'FREE', 'MENOPAUSE', 'PERSONA_POST')
  await blockedNoWrite('Micro Seed 글', await post(author, { ...MICRO_SEED_POST_VISIBILITY_FLAGS }), 'FREE', 'MENOPAUSE', 'MICRO_SEED_POST')
  await blockedNoWrite('오리지널 큐 연결 글(D100 자동 글)', await queueLinked(author), 'FREE', 'MENOPAUSE', 'ORIGINAL_QUEUE_POST')
  for (const s of ['PENDING', 'APPROVED', 'EDITED'] as const) {
    const p = await post(author)
    await candidate(p, 'PUBLISHED')
    await candidate(p, s)
    await blockedNoWrite(`열린 Persona 후보 ${s}`, p, 'FREE', 'MENOPAUSE', 'OPEN_PERSONA_CANDIDATE')
  }
  const plain = await post(author)
  await blockedNoWrite('목표 MAGAZINE', plain, 'FREE', 'MAGAZINE', 'INVALID_TARGET')
  await blockedNoWrite('목표 BEST(enum 밖)', plain, 'FREE', 'BEST', 'INVALID_TARGET')
  await blockedNoWrite('목표 이상한 문자열', plain, 'FREE', "FREE' OR 1=1", 'INVALID_TARGET')
  await blockedNoWrite('같은 게시판', plain, 'FREE', 'FREE', 'SAME_BOARD')
  await blockedNoWrite('화면이 본 게시판과 실제가 다름', plain, 'MENOPAUSE', 'FREE', 'STALE')
  await blockedNoWrite('지금 게시판 MAGAZINE', await post(author, { boardType: 'MAGAZINE' }), 'MAGAZINE', 'FREE', 'NOT_COMMUNITY_BOARD')
  await blockedNoWrite('숨김 글', await post(author, { status: 'HIDDEN' }), 'FREE', 'MENOPAUSE', 'NOT_PUBLISHED')
  await blockedNoWrite('삭제 글', await post(author, { status: 'DELETED' }), 'FREE', 'MENOPAUSE', 'NOT_PUBLISHED')
  expect('없는 글 → NOT_FOUND', short(await move('cl-not-a-post-id', 'FREE', 'MENOPAUSE')), 'NOT_FOUND')

  console.log('\n5. 동시성 — 성공은 한 번')
  for (let i = 0; i < 5; i++) {
    const p = await post(author)
    const rs = await Promise.all([move(p, 'FREE', 'MENOPAUSE'), move(p, 'FREE', 'MENOPAUSE')])
    const okN = rs.filter((r) => r.ok).length
    expect(`같은 이동 동시 두 번 #${i + 1} — 성공 1 · 나머지 STALE · 최종 MENOPAUSE`,
      [okN, rs.every((r) => r.ok || r.code === 'STALE'), (await board(p))?.boardType], [1, true, 'MENOPAUSE'])
  }
  for (let i = 0; i < 5; i++) {
    const p = await post(author)
    const rs = await Promise.all([move(p, 'FREE', 'MENOPAUSE'), move(p, 'MENOPAUSE', 'FREE')])
    const okN = rs.filter((r) => r.ok).length
    const final = (await board(p))?.boardType
    expect(`반대 방향 동시 #${i + 1} — 성공 1 · 최종은 성공한 쪽 목표`,
      [okN, final === (rs[0].ok ? 'MENOPAUSE' : 'FREE')], [1, true])
  }
  const twice = await post(author)
  expect('같은 요청 연달아 두 번 — 첫 번째 ok · 두 번째 STALE(write 0)',
    [short(await move(twice, 'FREE', 'MENOPAUSE')), short(await move(twice, 'FREE', 'MENOPAUSE')), (await board(twice))?.boardType],
    ['ok', 'STALE', 'MENOPAUSE'])
}

async function cleanup(): Promise<void> {
  const posts = made.posts
  await prisma.bestSelection.deleteMany({ where: { postId: { in: posts } } })
  await prisma.comment.deleteMany({ where: { postId: { in: posts } } })
  await prisma.personaApprovalQueue.deleteMany({ where: { id: { in: made.candidates } } })
  await prisma.originalPostApprovalQueue.deleteMany({ where: { id: { in: made.queues } } })
  await prisma.microSeedRawContent.deleteMany({ where: { id: { in: made.raws } } })
  await prisma.post.deleteMany({ where: { id: { in: posts } } })
  await prisma.persona.deleteMany({ where: { id: { in: made.personas } } })
  await prisma.operatorWriter.deleteMany({ where: { id: { in: made.writers } } })
  await prisma.account.deleteMany({ where: { userId: { in: made.users } } })
  await prisma.user.deleteMany({ where: { id: { in: made.users } } })
}

try {
  await main()
} finally {
  await cleanup()
  await prisma.$disconnect()
}
console.log(`\n${fail === 0 ? '✅' : '🔴'} board-move-db-check: ${pass} 통과 · ${fail} 실패`)
console.log('🔴 격리 DB 에서만 돌았다 — 이 검사가 만든 행만 지웠다\n')
if (fail > 0) process.exit(1)
