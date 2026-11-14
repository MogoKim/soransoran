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
 * POST_LIST_ITEM_SELECT · DISCOVERY_ELIGIBLE_WHERE. getHomePopularViews 자체는 auth() 를 불러
 * 세션 없이 돌릴 수 없어, 그 안의 두 단계(loadHomePopularInputs → composeHomePopularViews)를
 * 차단 목록과 now 를 넘겨 그대로 부른다(④).
 */
import { PrismaClient, type BoardType, type Prisma } from '@prisma/client'

import { withRealReactions } from '../src/lib/popularity-db'
import { pickHomePopular } from '../src/lib/popularity'
import { DISCOVERY_ELIGIBLE_WHERE } from '../src/lib/post-visibility'
import { POST_LIST_ITEM_SELECT } from '../src/lib/queries/post-list-item-select'
import { composeHomePopularViews, loadHomePopularInputs } from '../src/lib/home-popular-views'
import { applyHomeExposure, isOverrideActive } from '../src/lib/home-exposure-rules'
import { COMMUNITY_BOARDS } from '../src/lib/board-registry'

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

  console.log('\n④ 홈 편성 — 실제 Postgres 에서 mobile 은 옛 20 그대로 · desktop 10|10 · 조회 수 그대로')
  await reset()
  const writer = await member('글쓴이3')
  const blockedWriter = await member('차단된글쓴이') // 보는 사람이 차단한 작성자 — blockedIds 로 넘긴다
  const fans = await Promise.all(['팬1', '팬2', '팬3', '팬4'].map((n) => member(n)))
  const pu4 = await prisma.user.create({ data: { nickname: '페르소나4' }, select: { id: true } })
  const pz4 = await prisma.persona.create({ data: { code: 'P97', userId: pu4.id }, select: { id: true } })
  const make = (ageH: number, boardType: BoardType, data: Partial<Prisma.PostUncheckedCreateInput> = {}) =>
    prisma.post
      .create({ data: { boardType, title: `t${seq++}`, content: 'c', authorId: writer, createdAt: new Date(NOW.getTime() - ageH * H), ...data }, select: { id: true } })
      .then((p) => p.id)
  const realComments = async (postId: string, n: number) => {
    for (let i = 0; i < n; i += 1) await comment(postId, { authorId: fans[i % fans.length] })
  }
  // 갱년기톡 14 · 자유게시판 62(최신 60 만 후보) — 실반응을 섞어 점수가 나이순과 다르게 한다
  const menoIds: string[] = []
  for (let i = 0; i < 14; i += 1) menoIds.push(await make(1 + i * 3, 'MENOPAUSE'))
  const freeIds: string[] = []
  for (let i = 0; i < 61; i += 1) freeIds.push(await make(0.5 + i * 2, 'FREE'))
  const oldestFree = await make(900, 'FREE') //  후보 60 밖 — PIN 으로만 뜬다
  for (const [id, n] of [[menoIds[5], 4], [menoIds[9], 3], [freeIds[7], 4], [freeIds[20], 2], [freeIds[33], 3]] as const) await realComments(id, n)
  // Persona 댓글 30 — 점수를 움직이지 않는다
  for (let i = 0; i < 30; i += 1) await comment(freeIds[50], { authorId: pu4.id, source: 'SYSTEM', commentOrigin: 'PERSONA', personaId: pz4.id })
  // 비적격 — 실반응이 가장 많아 새면 1위로 뜬다
  const micro = await make(0.2, 'MENOPAUSE', { isMicroSeed: true })
  const hiddenPost = await make(0.2, 'FREE', { status: 'HIDDEN' })
  const promoBlocked = await make(0.2, 'FREE', { indexPromotionBlocked: true })
  const byBlocked = await make(0.2, 'MENOPAUSE', { authorId: blockedWriter })
  for (const id of [micro, hiddenPost, promoBlocked, byBlocked]) await realComments(id, 4)

  const ov = (postId: string, action: 'PIN' | 'HIDE', position: number | null = null, expiresAt: Date | null = null) =>
    prisma.homeExposureOverride.create({ data: { surface: 'HOME_POPULAR', postId, action, position, expiresAt } })
  await ov(oldestFree, 'PIN', 0) //                         후보 밖 자유게시판 고정
  await ov(menoIds[10], 'PIN', 1) //                           갱년기톡 고정
  await ov(freeIds[30], 'PIN', 2) //                           자유게시판 고정
  await ov(menoIds[0], 'HIDE') //                              갱년기톡 숨김
  await ov(freeIds[0], 'HIDE') //                              자유게시판 숨김
  await ov(freeIds[2], 'PIN', 3)
  await ov(freeIds[2], 'HIDE') //                              PIN + HIDE → 빠진다
  await ov(freeIds[40], 'PIN', 0, new Date(NOW.getTime() - H)) // 만료된 PIN → 효과 0
  await ov(freeIds[1], 'HIDE', null, new Date(NOW.getTime() - H)) // 만료된 HIDE → 다시 보인다
  for (const id of [micro, hiddenPost, promoBlocked, byBlocked]) await ov(id, 'PIN', 0) // 비적격 PIN
  const blockedIds = [blockedWriter]

  const counted = () => {
    const log: string[] = []
    const db = prisma.$extends({
      query: { $allOperations({ model, operation, args, query }) { log.push(`${model}.${operation}`); return query(args) } },
    }) as unknown as Prisma.TransactionClient
    return { db, log }
  }
  const histogram = (log: string[]) => Object.fromEntries([...new Set(log)].sort().map((k) => [k, log.filter((x) => x === k).length]))

  const before = counted()
  const legacyMobile = await legacyGetHomePopularPosts(before.db, blockedIds, NOW)
  const next = counted()
  const views = composeHomePopularViews(await loadHomePopularInputs(next.db, blockedIds, NOW), NOW)

  const idsOf = (l: { id: string }[]) => l.map((p) => p.id)
  expect(`mobile ${views.mobile.length} = 옛 getHomePopularPosts(20) id·순서 완전 동일`, idsOf(views.mobile), idsOf(legacyMobile))
  expect('  └ 옛 결과도 20 (표본이 비어서 통과한 것이 아니다)', legacyMobile.length, 20)
  expect(`DB 조회 수 — 옛 ${before.log.length} · 새 ${next.log.length} (모델·연산별 동일)`, histogram(next.log), histogram(before.log))
  expect('  └ 후보 조회 모양 = post.findMany 6(후보 2 · 실반응 글쓴이 2 · PIN 1 · PIN 글쓴이 1) · comment.groupBy 6 · override 1', histogram(next.log),
    { 'Comment.groupBy': 6, 'HomeExposureOverride.findMany': 1, 'Post.findMany': 6 })

  const M = views.desktop.MENOPAUSE
  const F = views.desktop.FREE
  const boardOf = new Map((await prisma.post.findMany({ select: { id: true, boardType: true } })).map((p) => [p.id, p.boardType]))
  expect(`desktop 갱년기톡 ${M.length} · 자유게시판 ${F.length} (각 ≤ 10)`, [M.length, F.length], [10, 10])
  expect('갱년기톡 열은 갱년기톡 글만 · 자유게시판 열은 자유게시판 글만', [M.every((p) => boardOf.get(p.id) === 'MENOPAUSE'), F.every((p) => boardOf.get(p.id) === 'FREE')], [true, true])
  expect('두 열 교집합 0', M.filter((p) => F.some((q) => q.id === p.id)).length, 0)
  expect('PIN — 자기 열 맨 위 · position 순(자유게시판: 후보 밖 0 → 2)', [idsOf(F).slice(0, 2), idsOf(M)[0]], [[oldestFree, freeIds[30]], menoIds[10]])
  expect('PIN — mobile 은 전 게시판 position 순(0 · 1 · 2)', idsOf(views.mobile).slice(0, 3), [oldestFree, menoIds[10], freeIds[30]])
  const all3 = [...idsOf(views.mobile), ...idsOf(M), ...idsOf(F)]
  expect('HIDE(menoIds[0] · freeIds[0]) · PIN+HIDE(freeIds[2]) — 세 결과 어디에도 없다', all3.filter((id) => [menoIds[0], freeIds[0], freeIds[2]].includes(id)), [])
  expect('만료된 HIDE(freeIds[1]) 는 풀린다 · 만료된 PIN(freeIds[40]) 은 맨 위에 서지 않는다', [all3.includes(freeIds[1]), idsOf(F).indexOf(freeIds[40]) === 0], [true, false])
  expect('비적격 PIN(Micro Seed · 비공개 · indexPromotionBlocked · 차단 작성자) 통과 0', all3.filter((id) => [micro, hiddenPost, promoBlocked, byBlocked].includes(id)), [])
  expect('Persona 댓글 30 글(freeIds[50])은 점수로 열 상위에 오르지 않는다', idsOf(F).includes(freeIds[50]), false)
  // 🔴 갱년기톡 최소 7 은 desktop 에 없다 — 갱년기톡 열이 mobile 의 갱년기톡 수에 묶이지 않는다
  expect(`mobile 갱년기톡 ${views.mobile.filter((p) => boardOf.get(p.id) === 'MENOPAUSE').length} · desktop 갱년기톡 열은 자기 상위 10`, M.length, 10)

  // 부족분 — 갱년기톡 적격 글을 3 으로 줄이면 열은 3, 채움 0
  await prisma.post.updateMany({ where: { id: { in: menoIds.slice(3) } }, data: { status: 'HIDDEN' } })
  await prisma.homeExposureOverride.deleteMany({ where: { postId: { in: menoIds } } })
  const few = composeHomePopularViews(await loadHomePopularInputs(prisma, blockedIds, NOW), NOW)
  expect('갱년기톡 적격 3 → 열 3 · 최신·비적격·다른 게시판 채움 0', idsOf(few.desktop.MENOPAUSE).sort(), menoIds.slice(0, 3).sort())

  await reset()
  console.log(`\n결과: PASS ${pass} · FAIL ${fail}`)
}

/**
 * 옛 getHomePopularPosts(20) — origin/main 1a30cac7 queries/posts.ts 184–301 을 그대로 옮겼다.
 * 🔴 바꾼 것은 둘뿐이다: 전역 prisma → db 인자(조회 수를 센다) · new Date() → now 인자(같은 시각에 대조).
 *    새 편성의 mobile·조회 수가 이것과 같은지 대조하는 기준이라 손대지 않는다.
 */
async function legacyGetHomePopularPosts(db: Prisma.TransactionClient, blockedIds: string[], now: Date) {
  const COMMUNITY_BOARD_TYPES = COMMUNITY_BOARDS.map((b) => b.type) as BoardType[]
  const take = 20
  const pickPopularByScore = async (t: number) => {
    const candidatesFor = (boardType: BoardType) =>
      db.post.findMany({
        where: { boardType, ...DISCOVERY_ELIGIBLE_WHERE, ...(blockedIds.length ? { authorId: { notIn: blockedIds } } : {}) },
        select: POST_LIST_ITEM_SELECT,
        orderBy: { createdAt: 'desc' },
        take: 60,
      })
    const [menopauseRows, freeRows] = await Promise.all([candidatesFor('MENOPAUSE'), candidatesFor('FREE')])
    const [menopause, free] = await Promise.all([withRealReactions(db, menopauseRows), withRealReactions(db, freeRows)])
    return pickHomePopular({ menopause, free, take: t, minMenopause: 7, now })
  }
  const [candidates, overrides] = await Promise.all([
    pickPopularByScore(take * 2),
    db.homeExposureOverride.findMany({
      where: { surface: 'HOME_POPULAR', isActive: true },
      select: { postId: true, action: true, position: true, isActive: true, expiresAt: true },
    }),
  ])
  const activePinIds = overrides.filter((o) => o.action === 'PIN' && isOverrideActive(o, now)).map((o) => o.postId)
  const pinnedPosts = activePinIds.length
    ? await withRealReactions(db, await db.post.findMany({
        where: {
          id: { in: activePinIds },
          boardType: { in: COMMUNITY_BOARD_TYPES },
          ...DISCOVERY_ELIGIBLE_WHERE,
          ...(blockedIds.length ? { authorId: { notIn: blockedIds } } : {}),
        },
        select: POST_LIST_ITEM_SELECT,
      }))
    : []
  return applyHomeExposure({ candidates, pinnedPosts, overrides, take, now })
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
