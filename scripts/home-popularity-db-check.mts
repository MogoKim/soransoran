#!/usr/bin/env tsx
/**
 * 홈 인기 점수의 실반응 댓글 — **실제 Postgres** 에서 무엇을 세는지 확인한다.
 *
 * 🔴 CI 에 넣지 않는다. Postgres 가 필요하다. 순수 규칙은 `npm run check:home-popularity` 가 본다.
 * 🔴 운영 DB 에 절대 붙이지 않는다. 아래 가드가 주소를 보고 아니면 즉시 멈춘다.
 *
 * 격리 Postgres 는 scripts/operator-compose-db-check.mts 머리 주석의 절차 그대로다
 * (DB 이름 soran_test · `npx prisma migrate deploy` 로 올린 뒤 실행).
 *
 * 홈이 부르는 것과 같은 함수를 부른다 — withRealCommentCounts · pickHomePopular ·
 * POST_LIST_ITEM_SELECT · DISCOVERY_ELIGIBLE_WHERE. getHomePopularPosts 자체는 auth() 를 불러
 * 세션 없이 돌릴 수 없어, 그 안의 조회 모양(게시판별 최신 후보 → 실반응 수 → 점수)을 그대로 따른다.
 */
import { PrismaClient, type BoardType, type Prisma } from '@prisma/client'

import { withRealCommentCounts } from '../src/lib/popularity-db'
import { pickHomePopular } from '../src/lib/popularity'
import { DISCOVERY_ELIGIBLE_WHERE } from '../src/lib/post-visibility'
import { POST_LIST_ITEM_SELECT } from '../src/lib/queries/post-list-item-select'

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
const NOW = new Date('2026-10-13T03:00:00Z')

async function reset(): Promise<void> {
  await prisma.bestSelection.deleteMany({})
  await prisma.like.deleteMany({})
  await prisma.comment.deleteMany({})
  await prisma.homeExposureOverride.deleteMany({})
  await prisma.post.deleteMany({})
  await prisma.persona.deleteMany({})
  await prisma.operatorWriter.deleteMany({})
  await prisma.account.deleteMany({})
  await prisma.user.deleteMany({})
}

let seq = 0
async function member(name: string, { kakao = true, isBlocked = false } = {}) {
  const u = await prisma.user.create({ data: { nickname: name, isBlocked }, select: { id: true } })
  seq += 1
  if (kakao) {
    await prisma.account.create({ data: { userId: u.id, type: 'oauth', provider: 'kakao', providerAccountId: `k${seq}` } })
  }
  return u.id
}
async function post(authorId: string, ageH: number, boardType: BoardType = 'FREE') {
  const p = await prisma.post.create({
    data: { boardType, title: `t${seq++}`, content: 'c', authorId, createdAt: new Date(NOW.getTime() - ageH * H) },
    select: { id: true },
  })
  return p.id
}
const comment = (postId: string, data: Partial<Prisma.CommentUncheckedCreateInput> = {}) =>
  prisma.comment.create({ data: { postId, content: 'x', ...data }, select: { id: true } })

/** queries/posts.ts pickPopularByScore 의 후보 조회와 같은 모양 */
const candidatesFor = (boardType: BoardType) =>
  prisma.post.findMany({
    where: { boardType, ...DISCOVERY_ELIGIBLE_WHERE },
    select: POST_LIST_ITEM_SELECT,
    orderBy: { createdAt: 'desc' },
    take: 60,
  })

async function main(): Promise<void> {
  await reset()
  const author = await member('글쓴이')
  const m1 = await member('회원1')
  const noKakao = await member('카카오없음', { kakao: false })
  const blocked = await member('운영차단', { isBlocked: true })
  const personaUser = await prisma.user.create({ data: { nickname: '페르소나' }, select: { id: true } })
  // 🔴 Persona 계정에 카카오 계정이 붙어 있어도 실회원이 아니다 — relation 이 막아야 한다
  await prisma.account.create({ data: { userId: personaUser.id, type: 'oauth', provider: 'kakao', providerAccountId: 'kp' } })
  const persona = await prisma.persona.create({ data: { code: 'P99', userId: personaUser.id }, select: { id: true } })
  const opUser = await prisma.user.create({ data: { nickname: '운영' }, select: { id: true } })
  const op = await prisma.operatorWriter.create({ data: { code: 'OP9', userId: opUser.id }, select: { id: true } })

  console.log('\n① 한 글의 댓글 — 실반응만 센다')
  const P = await post(author, 1)
  await comment(P, { authorId: m1 }) //                                     ✔ 실회원
  await comment(P, { authorId: m1 }) //                                     ✔ 같은 회원 두 번째 — 건수로 센다
  await comment(P, { authorId: author }) //                                 ✔ 글쓴이 답글도 실회원 반응
  await comment(P, { commentOrigin: 'GUEST', guestNickname: '손님' }) //    ✔ 비회원
  await comment(P, { authorId: personaUser.id, source: 'SYSTEM', commentOrigin: 'PERSONA', personaId: persona.id })
  await comment(P, { authorId: personaUser.id, source: 'SYSTEM', commentOrigin: 'PERSONA', personaId: persona.id })
  await comment(P, { authorId: personaUser.id }) //                         ✘ MEMBER 표기지만 작성자가 Persona
  await comment(P, { authorId: m1, personaId: persona.id }) //              ✘ MEMBER 표기 · personaId 가 붙은 모순 행
  await comment(P, { authorId: m1, source: 'SYSTEM', commentOrigin: 'PERSONA' }) // ✘ PERSONA 표기 · personaId 없는 모순 행 — 레인 칸만으로 거른다
  await comment(P, { authorId: opUser.id, commentOrigin: 'OPERATOR', operatorWriterId: op.id })
  await comment(P, { authorId: m1, operatorWriterId: op.id }) //            ✘ MEMBER 표기 · 운영 작성 축
  await comment(P, { commentOrigin: 'MICRO_SEED_VERBATIM' })
  await comment(P, { authorId: m1, isDeleted: true }) //                    ✘ 삭제
  await comment(P, { commentOrigin: 'GUEST', guestNickname: '지움', isDeleted: true })
  await comment(P, { authorId: noKakao }) //                                ✘ 카카오 계정 없음
  await comment(P, { authorId: blocked }) //                                ✘ 운영 차단 회원
  const Q = await post(author, 1)

  const rows = await prisma.post.findMany({ where: { id: { in: [P, Q] } }, select: POST_LIST_ITEM_SELECT })
  const counted = await withRealCommentCounts(prisma, rows)
  const byId = new Map(counted.map((r) => [r.id, r]))
  expect('P 실반응 = 실회원 2 + 글쓴이 1 + 비회원 1 = 4', byId.get(P)?.realComments, 4)
  expect('P 화면 댓글 수 = 삭제 2건만 뺀 14 (Persona 포함, 그대로)', byId.get(P)?._count.comments, 14)
  expect('댓글 없는 글은 0', byId.get(Q)?.realComments, 0)
  expect('빈 입력은 쿼리 없이 빈 배열', await withRealCommentCounts(prisma, []), [])

  console.log('\n② 홈 순서 — Persona 댓글이 자리를 사지 못한다')
  await reset()
  const a2 = await member('글쓴이2')
  const r1 = await member('회원A')
  const pu = await prisma.user.create({ data: { nickname: '페르소나2' }, select: { id: true } })
  const pz = await prisma.persona.create({ data: { code: 'P98', userId: pu.id }, select: { id: true } })
  const personaOnly = await post(a2, 1) //                  Persona 10
  const realOnly = await post(a2, 1.5) //                   실회원 1
  const quiet = await post(a2, 0.5) //                      댓글 0
  const meno = await post(a2, 1, 'MENOPAUSE') //            Persona 5 + 비회원 1
  for (let i = 0; i < 10; i += 1) await comment(personaOnly, { authorId: pu.id, source: 'SYSTEM', commentOrigin: 'PERSONA', personaId: pz.id })
  await comment(realOnly, { authorId: r1 })
  for (let i = 0; i < 5; i += 1) await comment(meno, { authorId: pu.id, source: 'SYSTEM', commentOrigin: 'PERSONA', personaId: pz.id })
  await comment(meno, { commentOrigin: 'GUEST', guestNickname: '손님' })

  const [menoRows, freeRows] = await Promise.all([candidatesFor('MENOPAUSE'), candidatesFor('FREE')])
  const picked = pickHomePopular({
    menopause: await withRealCommentCounts(prisma, menoRows),
    free: await withRealCommentCounts(prisma, freeRows),
    take: 4,
    minMenopause: 0,
    now: NOW,
  })
  // meno 2/5^0.8=0.552 · realOnly 2/5.5^0.8=0.509 · quiet 1/4.5^0.8=0.300 · personaOnly 1/5^0.8=0.276
  expect('순서 = 실반응 순 · Persona 10 글은 꼴찌', picked.map((p) => p.id), [meno, realOnly, quiet, personaOnly])
  expect('화면 댓글 수는 그대로 실린다', picked.map((p) => p._count.comments), [6, 1, 0, 10])
  // 대조 — 옛 축(화면 숫자)이면 personaOnly 가 1위였다. 이 검사가 두 축을 가른다.
  const legacy = pickHomePopular({
    menopause: menoRows.map((p) => ({ ...p, realComments: p._count.comments })),
    free: freeRows.map((p) => ({ ...p, realComments: p._count.comments })),
    take: 4,
    minMenopause: 0,
    now: NOW,
  })
  expect('대조 — 화면 숫자로 매기면 Persona 10 글이 1위', legacy[0]?.id, personaOnly)

  await reset()
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
