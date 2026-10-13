#!/usr/bin/env tsx
/**
 * 홈 인기 점수의 실반응 신호 — **실제 Postgres** 에서 무엇을 세는지 확인한다.
 *
 * 🔴 CI 에 넣지 않는다. Postgres 가 필요하다. 순수 규칙은 `npm run check:home-popularity` 가 본다.
 * 🔴 운영 DB 에 절대 붙이지 않는다. 아래 가드가 주소를 보고 아니면 즉시 멈춘다.
 *
 * 격리 Postgres 는 scripts/operator-compose-db-check.mts 머리 주석의 절차 그대로다
 * (DB 이름 soran_test · `npx prisma migrate deploy` 로 올린 뒤 실행).
 *
 * 홈이 부르는 것과 같은 함수를 부른다 — withRealReactions · pickHomePopular ·
 * POST_LIST_ITEM_SELECT · DISCOVERY_ELIGIBLE_WHERE. getHomePopularPosts 자체는 auth() 를 불러
 * 세션 없이 돌릴 수 없어, 그 안의 조회 모양(게시판별 최신 후보 → 실반응 수 → 점수)을 그대로 따른다.
 */
import { PrismaClient, type BoardType, type Prisma } from '@prisma/client'

import { withRealReactions } from '../src/lib/popularity-db'
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

  const m2 = await member('회원2')
  const shownOf = async (id: string) =>
    (await prisma.post.findUniqueOrThrow({ where: { id }, select: POST_LIST_ITEM_SELECT }))._count.comments
  const signalOf = async (id: string) => {
    const [r] = await withRealReactions(prisma, [{ id }])
    return r.realReactions
  }
  const persona10 = (postId: string) =>
    Array.from({ length: 10 }, () => comment(postId, { authorId: personaUser.id, source: 'SYSTEM', commentOrigin: 'PERSONA', personaId: persona.id }))

  console.log('\n① 필수 반례 — 사람을 센다 · 화면 숫자는 그대로')
  const cases: { label: string; want: number; shown: number; make: (postId: string) => Promise<unknown>[] }[] = [
    { label: '같은 회원 댓글 10건 = 실회원 1명', want: 1, shown: 10, make: (id) => Array.from({ length: 10 }, () => comment(id, { authorId: m1 })) },
    { label: '글쓴이 답글 10건 = 0', want: 0, shown: 10, make: (id) => Array.from({ length: 10 }, () => comment(id, { authorId: author })) },
    { label: '서로 다른 실회원 2명 = 2', want: 2, shown: 2, make: (id) => [comment(id, { authorId: m1 }), comment(id, { authorId: m2 })] },
    { label: '비회원 댓글 100건 = 상한 3', want: 3, shown: 100, make: (id) => Array.from({ length: 100 }, (_, i) => comment(id, { commentOrigin: 'GUEST', guestNickname: `손님${i}` })) },
    { label: 'Persona 댓글 10건 = 0', want: 0, shown: 10, make: persona10 },
  ]
  for (const c of cases) {
    const id = await post(author, 1)
    await Promise.all(c.make(id))
    expect(c.label, await signalOf(id), c.want)
    expect(`  └ 화면 댓글 수는 실제 개수 ${c.shown} 그대로`, await shownOf(id), c.shown)
  }

  console.log('\n② 제외 축 — 한 글에 섞어 둔다')
  const P = await post(author, 1)
  await comment(P, { authorId: m1 }) //                                     ✔ 실회원 m1
  await comment(P, { authorId: m1 }) //                                     ✔ m1 두 번째 — 같은 사람
  await comment(P, { authorId: author }) //                                 ✘ 글쓴이 답글
  await comment(P, { commentOrigin: 'GUEST', guestNickname: '손님' }) //    ✔ 비회원 1
  await Promise.all(persona10(P).slice(0, 2))
  await comment(P, { authorId: personaUser.id }) //                         ✘ MEMBER 표기지만 작성자가 Persona
  await comment(P, { authorId: m2, personaId: persona.id }) //              ✘ MEMBER 표기 · personaId 가 붙은 모순 행
  await comment(P, { authorId: m2, source: 'SYSTEM', commentOrigin: 'PERSONA' }) // ✘ PERSONA 표기 · personaId 없는 모순 행
  await comment(P, { authorId: opUser.id, commentOrigin: 'OPERATOR', operatorWriterId: op.id })
  await comment(P, { authorId: m2, operatorWriterId: op.id }) //            ✘ MEMBER 표기 · 운영 작성 축
  await comment(P, { commentOrigin: 'GUEST', guestNickname: '운영', operatorWriterId: op.id }) // ✘ GUEST 표기 · 운영 작성 축
  await comment(P, { commentOrigin: 'MICRO_SEED_VERBATIM' })
  await comment(P, { authorId: m2, isDeleted: true }) //                    ✘ 삭제
  await comment(P, { commentOrigin: 'GUEST', guestNickname: '지움', isDeleted: true })
  await comment(P, { authorId: noKakao }) //                                ✘ 카카오 계정 없음
  await comment(P, { authorId: blocked }) //                                ✘ 운영 차단 회원
  expect('신호 = 실회원 m1 1명 + 비회원 1 = 2 (m2 는 모순·삭제 행뿐이라 0)', await signalOf(P), 2)
  expect('화면 댓글 수 = 17행 중 삭제 2건만 뺀 15 (Persona 포함, 그대로)', await shownOf(P), 15)
  expect('댓글 없는 글은 0', await signalOf(await post(author, 1)), 0)
  expect('빈 입력은 쿼리 없이 빈 배열', await withRealReactions(prisma, []), [])
  // replay 전용 asOf — 그 시각 뒤에 달린 댓글은 세지 않는다
  const T = await post(author, 1)
  await comment(T, { authorId: m1, createdAt: new Date(NOW.getTime() - 0.5 * H) })
  await comment(T, { authorId: m2, createdAt: new Date(NOW.getTime() + 1 * H) })
  const [asOfNow] = await withRealReactions(prisma, [{ id: T }], { asOf: NOW })
  expect('asOf = 그 시각까지의 실회원만(m1 1명 · 뒤에 단 m2 제외)', asOfNow.realReactions, 1)
  expect('asOf 없음 = 전부(m1 · m2 2명)', await signalOf(T), 2)
  expect('입력 객체의 다른 필드를 보존한다', (await withRealReactions(prisma, [{ id: P, tag: 'keep' }]))[0].tag, 'keep')

  console.log('\n③ 홈 순서 — Persona 댓글이 자리를 사지 못한다')
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
    menopause: await withRealReactions(prisma, menoRows),
    free: await withRealReactions(prisma, freeRows),
    take: 4,
    minMenopause: 0,
    now: NOW,
  })
  // meno 2/5^0.8=0.552 · realOnly 2/5.5^0.8=0.509 · quiet 1/4.5^0.8=0.300 · personaOnly 1/5^0.8=0.276
  expect('순서 = 실반응 순 · Persona 10 글은 꼴찌', picked.map((p) => p.id), [meno, realOnly, quiet, personaOnly])
  expect('화면 댓글 수는 그대로 실린다', picked.map((p) => p._count.comments), [6, 1, 0, 10])
  // 대조 — 옛 축(화면 숫자)이면 personaOnly 가 1위였다. 이 검사가 두 축을 가른다.
  const legacy = pickHomePopular({
    menopause: menoRows.map((p) => ({ ...p, realReactions: p._count.comments })),
    free: freeRows.map((p) => ({ ...p, realReactions: p._count.comments })),
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
