#!/usr/bin/env tsx
/**
 * 운영자 직접 작성 — **실제 DB 트랜잭션** 검증
 *
 * 🔴 **CI 에 넣지 않는다.** Postgres 가 필요하고, CI 에는 DB 가 없다.
 *    순수 판정은 `operator:compose-check` 가 본다. 이 파일은 **되돌릴 수 없는 write 가
 *    정말 되돌아가는가** 를 실제 트랜잭션으로 확인한다 — 순수 fixture 로는 잴 수 없는 것들이다.
 *
 * 🔴 **운영 DB 에 절대 붙이지 않는다.** 아래 가드가 주소를 보고 아니면 즉시 멈춘다.
 *    Preview 도 운영 DB 를 공유하므로 그쪽에서도 돌리지 않는다.
 *
 * ── 격리 Postgres 세우는 법 (2026-09-17 실측) ─────────────────────────
 *
 *   brew install postgresql@17
 *   export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
 *   export LANG=C LC_ALL=C                    # 🔴 없으면 initdb 가 로케일 오류로 죽는다
 *   PGDIR=/tmp/soran-pg ; SOCK=/tmp/soran-sock
 *   rm -rf "$PGDIR" "$SOCK" ; mkdir -p "$PGDIR" "$SOCK"
 *   initdb -D "$PGDIR" -U soran --auth=trust -E UTF8 --locale=C
 *   # 🔴 소켓 디렉터리를 짧게 준다 — 경로가 103바이트를 넘으면 서버가 뜨지 않는다
 *   pg_ctl -D "$PGDIR" -o "-p 54329 -k $SOCK -h 127.0.0.1" -l "$PGDIR/server.log" start
 *   psql -h 127.0.0.1 -p 54329 -U soran -d postgres -c "create database soran_test;"
 *
 *   export DATABASE_URL="postgresql://soran@127.0.0.1:54329/soran_test"
 *   export DIRECT_URL="$DATABASE_URL"
 *   # 🔴 0027 은 아직 migrations-draft 에 있다. 이 검증에서만 임시로 옮겨 적용한다
 *   cp -R prisma/migrations-draft/0027_operator_composer prisma/migrations/
 *   npx prisma migrate deploy
 *   npm run operator:compose-db-check
 *   rm -rf prisma/migrations/0027_operator_composer     # 🔴 반드시 되돌린다
 *
 *   pg_ctl -D "$PGDIR" stop -m fast ; rm -rf "$PGDIR" "$SOCK"
 *
 * ── 구버전 호환성까지 보려면 ──────────────────────────────────────────
 *
 *   git show origin/main:prisma/schema.prisma > .tmp-oldclient/schema.prisma
 *   # generator 에 output = "./generated" 를 더한 뒤
 *   npx prisma generate --schema .tmp-oldclient/schema.prisma
 *   # 그 client 로 조회해 보면 `commentOrigin` 을 select 하는 경로만 깨진다
 *   # (실측 결과와 복구 절차는 prisma/migrations-draft/0027_operator_composer/APPLY.md)
 */
import { PrismaClient } from '@prisma/client'

import {
  createOperatorCommentTx, createOperatorPostTx,
  deleteOperatorCommentTx, deleteOperatorPostTx,
  updateOperatorCommentTx, updateOperatorPostTx,
} from '../src/lib/operator-compose-tx'

/** 🔴 운영 DB 차단 — 이 주소가 아니면 한 줄도 쓰지 않는다 */
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

async function main(): Promise<void> {
  // 🔴 시험 데이터만 지운다. 이 DB 는 시험 전용이다
  await prisma.operatorWriteLog.deleteMany({})
  await prisma.comment.deleteMany({})
  await prisma.post.deleteMany({})
  await prisma.operatorWriter.deleteMany({})
  await prisma.persona.deleteMany({})
  await prisma.account.deleteMany({})
  await prisma.user.deleteMany({})

  const admin = await prisma.user.create({ data: { name: '관리자', isAdmin: true }, select: { id: true } })
  const writerUser = await prisma.user.create({ data: { nickname: '봄날의정원' }, select: { id: true } })
  const writer = await prisma.operatorWriter.create({
    data: { code: 'OP01', userId: writerUser.id }, select: { id: true },
  })
  const memberUser = await prisma.user.create({ data: { nickname: '진짜회원' }, select: { id: true } })
  await prisma.account.create({
    data: { userId: memberUser.id, type: 'oauth', provider: 'kakao', providerAccountId: 'k-1' },
    select: { id: true },
  })
  const personaUser = await prisma.user.create({ data: { nickname: '자동이' }, select: { id: true } })
  const persona = await prisma.persona.create({
    data: { code: 'P01', userId: personaUser.id, status: 'active' }, select: { id: true },
  })
  const memberPost = await prisma.post.create({
    data: { boardType: 'FREE', title: '회원 글', content: '회원이 쓴 글', authorId: memberUser.id },
    select: { id: true },
  })
  const personaPost = await prisma.post.create({
    data: {
      boardType: 'FREE', title: '자동 글', content: '자동이 쓴 글',
      authorId: personaUser.id, personaId: persona.id, source: 'SYSTEM',
    },
    select: { id: true },
  })

  console.log('\n══════ ① 등록 — 연속 3건이 전부 들어간다')
  const posts: string[] = []
  for (let i = 1; i <= 3; i += 1) {
    const r = await createOperatorPostTx(prisma, {
      operatorWriterId: writer.id, boardType: 'MENOPAUSE',
      title: `연속 등록 ${i}`, content: `본문 ${i} 입니다. 충분히 깁니다.`,
      actorUserId: admin.id, requestKey: `key-post-${i}`,
    })
    expect(`${i}번째 글이 등록된다`, r.kind, 'created')
    if (r.kind === 'created') posts.push(r.targetId)
  }
  expect('세 건이 서로 다른 글이다', new Set(posts).size, 3)
  const saved = await prisma.post.findMany({
    where: { operatorWriterId: writer.id },
    select: { source: true, personaId: true, isMicroSeed: true },
  })
  expect('🔴 personaId 가 전부 null 이다', saved.every((p) => p.personaId === null), true)
  expect('source 는 USER 다', saved.every((p) => p.source === 'USER'), true)

  console.log('\n══════ ② 동일 키 재전송 — 중복이 생기지 않는다')
  const dup = await createOperatorPostTx(prisma, {
    operatorWriterId: writer.id, boardType: 'MENOPAUSE',
    title: '연속 등록 1', content: '본문 1 입니다. 충분히 깁니다.',
    actorUserId: admin.id, requestKey: 'key-post-1',
  })
  expect('두 번째는 duplicate 로 막힌다', dup.kind, 'duplicate')
  expect('🔴 글이 늘지 않았다', await prisma.post.count({ where: { operatorWriterId: writer.id } }), 3)

  console.log('\n══════ ③ 동일 키 **동시** 요청 — 하나만 남는다')
  const race = await Promise.all([1, 2, 3, 4, 5].map(() =>
    createOperatorPostTx(prisma, {
      operatorWriterId: writer.id, boardType: 'FREE',
      title: '동시 요청', content: '같은 키로 다섯 번 동시에 보낸다.',
      actorUserId: admin.id, requestKey: 'key-race',
    })))
  expect('성공은 정확히 1건', race.filter((r) => r.kind === 'created').length, 1)
  expect('🔴 공개 write 도 1건뿐이다', await prisma.post.count({ where: { title: '동시 요청' } }), 1)
  expect('감사 기록도 1건', await prisma.operatorWriteLog.count({ where: { requestKey: 'key-race' } }), 1)

  console.log('\n══════ ④ 감사 기록 실패 → 콘텐츠까지 롤백')
  const before = await prisma.post.count()
  // 🔴 같은 키를 미리 점유해 감사 기록 INSERT 만 실패하게 만든다
  await prisma.operatorWriteLog.create({
    data: {
      operatorWriterId: writer.id, actorUserId: admin.id, kind: 'post', action: 'create',
      targetId: 'placeholder', requestKey: 'key-audit-blocked',
    },
    select: { id: true },
  })
  const blocked = await createOperatorPostTx(prisma, {
    operatorWriterId: writer.id, boardType: 'FREE',
    title: '롤백되어야 하는 글', content: '감사 기록이 실패하면 이 글도 남으면 안 된다.',
    actorUserId: admin.id, requestKey: 'key-audit-blocked',
  })
  expect('duplicate 로 끝난다', blocked.kind, 'duplicate')
  expect('🔴 글이 하나도 생기지 않았다', await prisma.post.count(), before)

  console.log('\n══════ ⑤ 댓글 — 연속 등록 · 대상 검증')
  const cs: string[] = []
  for (let i = 1; i <= 3; i += 1) {
    const r = await createOperatorCommentTx(prisma, {
      operatorWriterId: writer.id, postId: personaPost.id,
      content: `연속 댓글 ${i}`, actorUserId: admin.id, requestKey: `key-cmt-${i}`,
    })
    expect(`${i}번째 댓글이 등록된다`, r.kind, 'created')
    if (r.kind === 'created') cs.push(r.targetId)
  }
  const savedC = await prisma.comment.findMany({
    where: { operatorWriterId: writer.id },
    select: { commentOrigin: true, personaId: true, parentId: true },
  })
  expect('🔴 commentOrigin 이 전부 OPERATOR 다', savedC.every((c) => c.commentOrigin === 'OPERATOR'), true)
  expect('🔴 personaId 가 전부 null 이다', savedC.every((c) => c.personaId === null), true)
  expect('🔴 전부 최상위 댓글이다', savedC.every((c) => c.parentId === null), true)

  const hidden = await prisma.post.create({
    data: { boardType: 'FREE', title: '내려간 글', content: '숨김', authorId: memberUser.id, status: 'HIDDEN' },
    select: { id: true },
  })
  expect('🔴 내려간 글에는 못 단다', (await createOperatorCommentTx(prisma, {
    operatorWriterId: writer.id, postId: hidden.id, content: '달리면 안 된다',
    actorUserId: admin.id, requestKey: 'key-hidden',
  })).kind, 'blocked')
  expect('🔴 없는 글에는 못 단다', (await createOperatorCommentTx(prisma, {
    operatorWriterId: writer.id, postId: 'no-such-post', content: '없는 글',
    actorUserId: admin.id, requestKey: 'key-missing',
  })).kind, 'blocked')

  console.log('\n══════ ⑥ 작성자 위조 · 자격')
  expect('🔴 없는 작성자로는 못 쓴다', (await createOperatorPostTx(prisma, {
    operatorWriterId: 'no-such-writer', boardType: 'FREE',
    title: '위조 시도', content: '없는 작성자로 쓰려 한다.',
    actorUserId: admin.id, requestKey: 'key-forge',
  })).kind, 'blocked')

  const retiredUser = await prisma.user.create({ data: { nickname: '은퇴자' }, select: { id: true } })
  const retired = await prisma.operatorWriter.create({
    data: { code: 'OP99', userId: retiredUser.id, status: 'retired' }, select: { id: true },
  })
  expect('🔴 retired 작성자로는 못 쓴다', (await createOperatorPostTx(prisma, {
    operatorWriterId: retired.id, boardType: 'FREE',
    title: '은퇴자 글', content: '은퇴한 작성자로 쓰려 한다.',
    actorUserId: admin.id, requestKey: 'key-retired',
  })).kind, 'blocked')

  // 🔴 실회원 계정에 운영 작성자를 붙여 두고 써 본다 — 가장 위험한 경로다
  const realWriter = await prisma.operatorWriter.create({
    data: { code: 'OP98', userId: memberUser.id }, select: { id: true },
  })
  expect('🔴 실회원 계정으로는 못 쓴다', (await createOperatorPostTx(prisma, {
    operatorWriterId: realWriter.id, boardType: 'FREE',
    title: '회원 이름 글', content: '실회원 이름으로 쓰려 한다.',
    actorUserId: admin.id, requestKey: 'key-real',
  })).kind, 'blocked')
  await prisma.operatorWriter.delete({ where: { id: realWriter.id } })

  const dualWriter = await prisma.operatorWriter.create({
    data: { code: 'OP97', userId: personaUser.id }, select: { id: true },
  })
  expect('🔴 자동 Persona 가 붙은 계정으로는 못 쓴다', (await createOperatorPostTx(prisma, {
    operatorWriterId: dualWriter.id, boardType: 'FREE',
    title: '겸직 글', content: '자동 페르소나가 붙은 계정으로 쓰려 한다.',
    actorUserId: admin.id, requestKey: 'key-dual',
  })).kind, 'blocked')
  await prisma.operatorWriter.delete({ where: { id: dualWriter.id } })

  console.log('\n══════ ⑦ 수정·삭제 — 회원/자동 콘텐츠는 못 건드린다')
  const mine = posts[0]!
  expect('내 글은 고쳐진다', (await updateOperatorPostTx(prisma, {
    postId: mine, title: '고친 제목', content: '고친 본문입니다.', actorUserId: admin.id,
  })).kind, 'updated')
  expect('🔴 회원 글은 못 고친다', (await updateOperatorPostTx(prisma, {
    postId: memberPost.id, title: 'x', content: 'y', actorUserId: admin.id,
  })).kind, 'blocked')
  expect('🔴 자동 Persona 글은 못 고친다', (await updateOperatorPostTx(prisma, {
    postId: personaPost.id, title: 'x', content: 'y', actorUserId: admin.id,
  })).kind, 'blocked')
  expect('🔴 회원 글 본문이 그대로다',
    (await prisma.post.findUniqueOrThrow({ where: { id: memberPost.id }, select: { content: true } })).content,
    '회원이 쓴 글')

  const memberComment = await prisma.comment.create({
    data: { postId: personaPost.id, authorId: memberUser.id, content: '회원 댓글', commentOrigin: 'MEMBER' },
    select: { id: true },
  })
  const personaComment = await prisma.comment.create({
    data: {
      postId: personaPost.id, authorId: personaUser.id, content: '자동 댓글',
      commentOrigin: 'PERSONA', personaId: persona.id, source: 'SYSTEM',
    },
    select: { id: true },
  })
  expect('내 댓글은 고쳐진다', (await updateOperatorCommentTx(prisma, {
    commentId: cs[0]!, content: '고친 댓글', actorUserId: admin.id,
  })).kind, 'updated')
  expect('🔴 회원 댓글은 못 고친다', (await updateOperatorCommentTx(prisma, {
    commentId: memberComment.id, content: 'x', actorUserId: admin.id,
  })).kind, 'blocked')
  expect('🔴 자동 댓글은 못 고친다', (await updateOperatorCommentTx(prisma, {
    commentId: personaComment.id, content: 'x', actorUserId: admin.id,
  })).kind, 'blocked')
  expect('🔴 회원 글은 못 내린다',
    (await deleteOperatorPostTx(prisma, { postId: memberPost.id, actorUserId: admin.id })).kind, 'blocked')
  expect('🔴 자동 댓글은 못 내린다',
    (await deleteOperatorCommentTx(prisma, { commentId: personaComment.id, actorUserId: admin.id })).kind, 'blocked')
  expect('내 글은 내려간다',
    (await deleteOperatorPostTx(prisma, { postId: mine, actorUserId: admin.id })).kind, 'deleted')
  expect('내린 글은 HIDDEN 이지 삭제가 아니다',
    (await prisma.post.findUniqueOrThrow({ where: { id: mine }, select: { status: true } })).status, 'HIDDEN')

  console.log('\n══════ ⑧ 감사 기록 — 공개 작성자와 실제 조작자가 함께 남는다')
  const logs = await prisma.operatorWriteLog.findMany({
    where: { operatorWriterId: writer.id }, select: { actorUserId: true, action: true },
  })
  expect('🔴 전부 실제 조작자(관리자)가 적혀 있다', logs.every((l) => l.actorUserId === admin.id), true)
  expect('수정·삭제도 기록된다',
    logs.some((l) => l.action === 'update') && logs.some((l) => l.action === 'delete'), true)

  console.log('\n══════ ⑨ 자동 집계 — 운영 댓글이 어느 쪽 분모도 되지 않는다')
  expect('🔴 "사람 댓글" 로 세어지지 않는다', await prisma.comment.count({
    where: {
      postId: personaPost.id, isDeleted: false, personaId: null,
      commentOrigin: { in: ['MEMBER', 'GUEST'] },
    },
  }), 1)
  expect('🔴 "자동 댓글" 로도 세어지지 않는다',
    await prisma.comment.count({ where: { isDeleted: false, commentOrigin: 'PERSONA' } }), 1)
  expect('🔴 글당 자동 댓글 자리를 먹지 않는다', await prisma.comment.count({
    where: { postId: personaPost.id, personaId: { not: null }, isDeleted: false },
  }), 1)

  console.log('\n══════ ⑩ 말투·경험 자산 — Persona 관계에 들어가지 않는다')
  /**
   * 🔴 **대화 맥락은 참고하되 자산은 아니다** (2026-09-17 계약).
   *    자산 경로는 `Persona.comments`(personaId 관계) 하나다. 운영 댓글은 그 값이
   *    null 이라 **구조적으로** 못 들어간다 — DB 에서 그 사실을 확인한다.
   */
  const assetComments = await prisma.persona.findUniqueOrThrow({
    where: { id: persona.id },
    select: { comments: { select: { content: true, commentOrigin: true } } },
  })
  expect('🔴 Persona 자산에 운영 댓글이 없다',
    assetComments.comments.some((c) => c.commentOrigin === 'OPERATOR'), false)
  expect('자동 댓글만 자산으로 잡힌다',
    assetComments.comments.every((c) => c.commentOrigin === 'PERSONA'), true)
  const onPost = await prisma.post.findUniqueOrThrow({
    where: { id: personaPost.id },
    select: { comments: { select: { commentOrigin: true } } },
  })
  expect('🟢 그 글의 대화에는 운영 댓글이 함께 있다 — 맥락으로 읽힌다',
    onPost.comments.some((c) => c.commentOrigin === 'OPERATOR'), true)

  console.log('\n─────────────────────────────────────────────────────────')
  console.log(`  ${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
}

main()
  .catch((e) => { console.error('🔴 실행 실패:', e); fail += 1 })
  .finally(async () => { await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0) })
