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
 *   · 공용 Post 잠금(결정적 순서 · barrier) — 후보 writer 가 먼저 / 게시판 이동이 먼저 / 수동 대상 지정 ↔ 이동.
 *     어느 순서든 "옮겨진 글에 열린 후보" 상태 0 · 잠금은 updatedAt · 값을 바꾸지 않는다
 *
 * 🔴 운영 DB 에서 돌지 않는다. 이 검사가 만든 행만 지운다(같은 DB 를 쓰는 다른 검사를 건드리지 않는다).
 *
 *   실행: DATABASE_URL=postgresql://…@127.0.0.1:<port>/soran_test npx tsx scripts/board-move-db-check.mts
 */
import { PrismaClient, type BoardType, type PersonaCandidateStatus, type Prisma } from '@prisma/client'
import { movePostBoardTx, type BoardMoveResult } from '../src/lib/board-move-tx'
import { lockPostRow } from '../src/lib/post-row-lock'
import { createPendingCandidateLocked, type CandidateWriteResult } from '../src/lib/persona-candidate-write'
import { setCandidateTargetTx, type SetTargetTxResult } from '../src/lib/persona-target-tx'
import { OPEN_PERSONA_CANDIDATE_STATUSES } from '../src/lib/board-move'
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

/** 결정적 순서 — 한쪽이 잠금을 잡은 뒤 멈추게 하고, 다른 쪽을 시작한 다음 놓아준다(sleep 0) */
function barrier() {
  let open!: () => void
  const p = new Promise<void>((r) => { open = r })
  return { wait: () => p, open }
}
/** 잠금 쪽이 멈춘 자리 — 잠근 직후 · 판정 전 */
function holdAfterLock() {
  const locked = barrier()
  const release = barrier()
  return { hook: async () => { locked.open(); await release.wait() }, locked: locked.wait, release: release.open }
}
const openCandidates = (postId: string) =>
  prisma.personaApprovalQueue.count({ where: { targetPostId: postId, status: { in: [...OPEN_PERSONA_CANDIDATE_STATUSES] } } })
/** 🔴 불가능 상태 — 게시판 이동이 성공했는데 그 글에 열린 후보가 있거나, 이동이 막혔는데 게시판이 바뀌었다 */
async function impossible(postId: string, moved: BoardMoveResult, before: BoardType): Promise<boolean> {
  const now = (await board(postId))?.boardType
  return moved.ok ? (await openCandidates(postId)) > 0 || now !== moved.to : now !== before
}
async function personaRow(): Promise<string> { return persona() }
const candidateData = async (key: string) => ({
  persona: { connect: { id: await personaRow() } }, candidateText: '저도 그래요', reactionType: 'experience',
  gateStatus: 'pass', gateResults: [], dedupKey: `${tag}:w:${key}`,
})
const cshort = (r: CandidateWriteResult) => (r.created ? 'created' : r.code)
const tshort = (r: SetTargetTxResult) => (r.ok ? 'ok' : r.code)

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

  console.log('\n5. 동시성 — 성공은 한 번 (barrier 로 순서를 고정한다 · sleep 0)')
  {
    const p = await post(author)
    const h = holdAfterLock()
    const first = movePostBoardTx(prisma, { postId: p, from: 'FREE', to: 'MENOPAUSE' }, h.hook)
    await h.locked()
    const second = move(p, 'FREE', 'MENOPAUSE')
    h.release()
    const [a, b] = await Promise.all([first, second])
    expect('같은 이동 두 번(앞이 잠근 사이 뒤가 도착) — 앞 ok · 뒤 STALE · 최종 MENOPAUSE',
      [short(a), short(b), (await board(p))?.boardType], ['ok', 'STALE', 'MENOPAUSE'])
  }
  {
    const p = await post(author)
    const h = holdAfterLock()
    const first = movePostBoardTx(prisma, { postId: p, from: 'FREE', to: 'MENOPAUSE' }, h.hook)
    await h.locked()
    // 뒤 요청은 MENOPAUSE 를 본 낡은 화면에서 왔다 — 앞 요청이 끝나면 우연히 같아지지만 통과하면 안 된다
    const second = move(p, 'MENOPAUSE', 'FREE')
    h.release()
    const [a, b] = await Promise.all([first, second])
    expect('반대 방향 동시(앞이 잠근 사이 뒤가 도착) — 앞 ok · 뒤 STALE · 최종 MENOPAUSE · 성공 1',
      [short(a), short(b), (await board(p))?.boardType], ['ok', 'STALE', 'MENOPAUSE'])
  }
  const twice = await post(author)
  expect('같은 요청 연달아 두 번 — 첫 번째 ok · 두 번째 STALE(write 0)',
    [short(await move(twice, 'FREE', 'MENOPAUSE')), short(await move(twice, 'FREE', 'MENOPAUSE')), (await board(twice))?.boardType],
    ['ok', 'STALE', 'MENOPAUSE'])

  console.log('\n6. 공용 Post 잠금 — 값 · updatedAt 그대로')
  {
    const p = await post(author)
    await thread(p)
    const before = await prisma.post.findUniqueOrThrow({ where: { id: p }, select: { updatedAt: true, bestReactionWeight: true, boardType: true, title: true, status: true } })
    const seen = await prisma.$transaction((tx) => lockPostRow(tx, p))
    const after = await prisma.post.findUniqueOrThrow({ where: { id: p }, select: { updatedAt: true, bestReactionWeight: true, boardType: true, title: true, status: true } })
    expect('잠금 뒤 updatedAt · W · 게시판 · 제목 · 상태 전부 그대로 · 돌려준 값 = 현재 값',
      [after, seen?.updatedAt.toISOString(), seen?.boardType], [before, before.updatedAt.toISOString(), before.boardType])
    expect('없는 글 → null', await prisma.$transaction((tx) => lockPostRow(tx, 'cl-not-a-post-id')), null)
  }

  console.log('\n7. A — 자동 후보 writer 가 먼저 잠근다 → 후보 1 · 이동 OPEN_PERSONA_CANDIDATE')
  for (const lane of ['첫 댓글', '추가 댓글']) {
    const p = await post(author)
    const h = holdAfterLock()
    const writing = createPendingCandidateLocked(prisma, { postId: p, expectedBoardType: 'FREE', data: await candidateData(`a-${lane}`) }, h.hook)
    await h.locked()
    const moving = movePostBoardTx(prisma, { postId: p, from: 'FREE', to: 'MENOPAUSE' })
    h.release()
    const [w, m] = await Promise.all([writing, moving])
    made.candidates.push(...(await prisma.personaApprovalQueue.findMany({ where: { targetPostId: p }, select: { id: true } })).map((r) => r.id))
    expect(`${lane} — 후보 created · 이동 OPEN_PERSONA_CANDIDATE · 게시판 FREE 그대로 · 열린 후보 1 · 불가능 상태 0`,
      [cshort(w), short(m), (await board(p))?.boardType, await openCandidates(p), await impossible(p, m, 'FREE')],
      ['created', 'OPEN_PERSONA_CANDIDATE', 'FREE', 1, false])
  }

  console.log('\n8. B — 게시판 이동이 먼저 잠근다 → 이동 성공 · 옛 게시판을 본 후보 write 0')
  for (const lane of ['첫 댓글', '추가 댓글']) {
    const p = await post(author)
    const h = holdAfterLock()
    const moving = movePostBoardTx(prisma, { postId: p, from: 'FREE', to: 'MENOPAUSE' }, h.hook)
    await h.locked()
    const writing = createPendingCandidateLocked(prisma, { postId: p, expectedBoardType: 'FREE', data: await candidateData(`b-${lane}`) })
    h.release()
    const [m, w] = await Promise.all([moving, writing])
    expect(`${lane} — 이동 ok · 후보 BOARD_CHANGED · 게시판 MENOPAUSE · 열린 후보 0 · 불가능 상태 0`,
      [short(m), cshort(w), (await board(p))?.boardType, await openCandidates(p), await impossible(p, m, 'FREE')],
      ['ok', 'BOARD_CHANGED', 'MENOPAUSE', 0, false])
  }
  {
    const p = await post(author)
    expect('새 게시판을 본 후보는 옮긴 뒤에도 적재된다(정상 경로)',
      [short(await move(p, 'FREE', 'MENOPAUSE')), cshort(await createPendingCandidateLocked(prisma, { postId: p, expectedBoardType: 'MENOPAUSE', data: await candidateData('b-new') }))],
      ['ok', 'created'])
    made.candidates.push(...(await prisma.personaApprovalQueue.findMany({ where: { targetPostId: p }, select: { id: true } })).map((r) => r.id))
    expect('게시판을 알 수 없는 생성 입력 → BOARD_UNKNOWN · write 0',
      [cshort(await createPendingCandidateLocked(prisma, { postId: p, expectedBoardType: '수다방', data: await candidateData('b-unknown') })), await openCandidates(p)], ['BOARD_UNKNOWN', 1])
    const h = await post(author, { status: 'HIDDEN' })
    expect('숨김 글 → NOT_PUBLISHED · write 0',
      [cshort(await createPendingCandidateLocked(prisma, { postId: h, expectedBoardType: 'FREE', data: await candidateData('b-hidden') })), await openCandidates(h)], ['NOT_PUBLISHED', 0])
  }

  console.log('\n9. C — 수동 대상 지정 ↔ 게시판 이동')
  {
    // 대상이 비어 있는 승인 후보 — 다른 글을 보고 만들어진 뒤 운영자가 대상을 고르는 자리
    const mk = async () => {
      seq += 1
      const c = await prisma.personaApprovalQueue.create({
        data: { personaId: await persona(), status: 'APPROVED', candidateText: '저도 그래요', reactionType: 'experience', gateStatus: 'pass', gateResults: [], dedupKey: `${tag}:t:${seq}` },
        select: { id: true },
      })
      made.candidates.push(c.id)
      return c.id
    }
    {
      const p = await post(author)
      const c = await mk()
      const h = holdAfterLock()
      const setting = setCandidateTargetTx(prisma, { candidateId: c, postId: p, expectedBoardType: 'FREE' }, h.hook)
      await h.locked()
      const moving = movePostBoardTx(prisma, { postId: p, from: 'FREE', to: 'MENOPAUSE' })
      h.release()
      const [t, m] = await Promise.all([setting, moving])
      expect('대상 지정이 먼저 — 지정 ok · 이동 OPEN_PERSONA_CANDIDATE · 게시판 FREE · 불가능 상태 0',
        [tshort(t), short(m), (await board(p))?.boardType, await openCandidates(p), await impossible(p, m, 'FREE')],
        ['ok', 'OPEN_PERSONA_CANDIDATE', 'FREE', 1, false])
    }
    {
      const p = await post(author)
      const c = await mk()
      const h = holdAfterLock()
      const moving = movePostBoardTx(prisma, { postId: p, from: 'FREE', to: 'MENOPAUSE' }, h.hook)
      await h.locked()
      const setting = setCandidateTargetTx(prisma, { candidateId: c, postId: p, expectedBoardType: 'FREE' })
      h.release()
      const [m, t] = await Promise.all([moving, setting])
      const row = await prisma.personaApprovalQueue.findUniqueOrThrow({ where: { id: c }, select: { targetPostId: true, status: true } })
      expect('이동이 먼저 — 이동 ok · 지정 STALE · 후보 대상 null · 상태 APPROVED 그대로 · 불가능 상태 0',
        [short(m), tshort(t), row, (await board(p))?.boardType, await openCandidates(p), await impossible(p, m, 'FREE')],
        ['ok', 'STALE', { targetPostId: null, status: 'APPROVED' }, 'MENOPAUSE', 0, false])
      expect('새 게시판을 보고 다시 고르면 지정된다(정상 경로)', tshort(await setCandidateTargetTx(prisma, { candidateId: c, postId: p, expectedBoardType: 'MENOPAUSE' })), 'ok')
    }
  }
}

async function cleanup(): Promise<void> {
  const posts = made.posts
  await prisma.bestSelection.deleteMany({ where: { postId: { in: posts } } })
  await prisma.comment.deleteMany({ where: { postId: { in: posts } } })
  await prisma.personaApprovalQueue.deleteMany({ where: { OR: [{ id: { in: made.candidates } }, { personaId: { in: made.personas } }, { targetPostId: { in: posts } }] } })
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
