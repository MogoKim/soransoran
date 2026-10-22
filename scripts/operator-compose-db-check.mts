#!/usr/bin/env tsx
/**
 * 운영자 직접 작성 — **실제 DB 트랜잭션** 검증
 *
 * 🔴 **CI D100 격리 DB 사슬(scripts/ci-d100-db-check.sh)에서 돈다** (2026-10-21 편입 — 작성자 대댓글).
 *    예전에는 CI 에 DB 가 없어 로컬에서만 돌렸다. 순수 판정은 `operator:compose-check` 가 본다.
 *    `reply-target.ts`(server-only)를 쓰므로 `tsx --tsconfig tsconfig.ops.json` 으로 부른다(package.json). 이 파일은 **되돌릴 수 없는 write 가
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
 *   npx prisma migrate deploy          # 0027 은 정식 이력에 있다
 *   npm run operator:compose-db-check
 *
 *   pg_ctl -D "$PGDIR" stop -m fast ; rm -rf "$PGDIR" "$SOCK"
 *
 * ── 구버전 호환성까지 보려면 ──────────────────────────────────────────
 *
 *   git show origin/main:prisma/schema.prisma > .tmp-oldclient/schema.prisma
 *   # generator 에 output = "./generated" 를 더한 뒤
 *   npx prisma generate --schema .tmp-oldclient/schema.prisma
 *   # 그 client 로 조회해 보면 `commentOrigin` 을 select 하는 경로만 깨진다
 *   # (실측 결과와 복구 절차는 prisma/migrations/0027_operator_composer/APPLY.md)
 */
import { Prisma, PrismaClient } from '@prisma/client'

import {
  createOperatorCommentTx, createOperatorPostTx,
  deleteOperatorCommentTx, deleteOperatorPostTx,
  updateOperatorCommentTx, updateOperatorPostTx,
} from '../src/lib/operator-compose-tx'
import { createOperatorReplyTx, OPERATOR_REPLY_MAX_ATTEMPTS, OPERATOR_REPLY_MESSAGE } from '../src/lib/operator-reply-tx'
import { countRealReactions, syncBestEligibility } from '../src/lib/best-ranking-db'
import { HOME_GUEST_COMMENT_WHERE, HOME_MEMBER_COMMENT_WHERE } from '../src/lib/popularity-db'
import { MEMBER_COMMENT_WHERE } from '../src/lib/queries/customer-composition'
import { TARGET_COMMENT_SELECT, targetCommentCounts } from '../src/lib/persona-target-tx'
import { authorKindOf } from '../src/lib/comment-thread'
import { loadPostThreads } from '../src/lib/queries/comment-threads'
import { MICRO_SEED_POST_VISIBILITY_FLAGS, OPERATOR_POST_VISIBILITY_FLAGS } from '../src/lib/post-visibility'

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

/**
 * 🔴 **시작과 끝에 같은 정리를 한다** (2026-10-21 · CI D100 격리 DB 사슬 편입).
 *    사슬에서는 앞 검사가 남긴 행(오리지널 큐 · 자동 READY 감사 · Persona 후보 등)이 글 · 회원을 붙잡고 있을 수 있고,
 *    뒤 검사(persona:comment-loop-db-check 등)는 user.deleteMany 를 한다 — 이 검사가 남긴 운영 작성자가 그것을 막는다.
 *    그래서 글 · 회원을 참조하는 표를 FK 순서대로 비우고 시작하고, 끝나면 다시 비운다. 격리 DB 전용이다(위 가드).
 */
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
  // 원천 행은 다른 검사의 표이기도 하다 — 이 검사가 만든 것만 지운다
  await prisma.microSeedRawContent.deleteMany({ where: { sourceSite: 'test:op' } })
  await prisma.post.deleteMany({})
  await prisma.operatorWriter.deleteMany({})
  await prisma.persona.deleteMany({})
  await prisma.account.deleteMany({})
  await prisma.user.deleteMany({})
}

async function main(): Promise<void> {
  // 🔴 시험 데이터만 지운다. 이 DB 는 시험 전용이다
  await wipe()

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

  console.log('\n══════ ⑪ 작성자 대댓글 — 원글 작성자로 고정 · 원자성 · 중복 · 집계 불변')
  {
    const replyWriterUser = await prisma.user.create({ data: { nickname: '갱년기화끈이' }, select: { id: true } })
    const replyWriter = await prisma.operatorWriter.create({ data: { code: 'OP02', userId: replyWriterUser.id }, select: { id: true } })
    const otherWriterUser = await prisma.user.create({ data: { nickname: '다른운영자' }, select: { id: true } })
    const otherWriter = await prisma.operatorWriter.create({ data: { code: 'OP03', userId: otherWriterUser.id }, select: { id: true } })
    const opPost = async (data: Partial<Prisma.PostUncheckedCreateInput> = {}) => (await prisma.post.create({
      data: { boardType: 'FREE', title: '운영 글', content: '운영자가 쓴 글입니다.', authorId: replyWriterUser.id, operatorWriterId: replyWriter.id, ...OPERATOR_POST_VISIBILITY_FLAGS, ...data },
      select: { id: true },
    })).id
    const commenter = async (n: string) => {
      const u = await prisma.user.create({ data: { nickname: n }, select: { id: true } })
      await prisma.account.create({ data: { userId: u.id, type: 'oauth', provider: 'kakao', providerAccountId: `k-${n}` } })
      return u.id
    }
    const m1 = await commenter('댓글회원'); const m2 = await commenter('답글회원')
    const target = await opPost()
    const c1 = (await prisma.comment.create({ data: { postId: target, authorId: m1, content: '저도 그래요', commentOrigin: 'MEMBER' }, select: { id: true } })).id
    const c2 = (await prisma.comment.create({ data: { postId: target, authorId: m2, content: '맞아요 정말', commentOrigin: 'MEMBER', parentId: c1 }, select: { id: true } })).id
    await prisma.comment.create({ data: { postId: target, content: '지나가다 남겨요', commentOrigin: 'GUEST', guestNickname: '손님' } })
    await prisma.$transaction((tx) => syncBestEligibility(tx, target))
    const counts = async () => [await prisma.comment.count(), await prisma.operatorWriteLog.count()]
    let key = 0
    const reply = (postId: string, parentId: string, extra: Record<string, unknown> = {}, faults?: Parameters<typeof createOperatorReplyTx>[2]) => {
      key += 1
      return createOperatorReplyTx(prisma, { postId, parentId, content: `작성자 대댓글 ${key}`, actorUserId: admin.id, requestKey: `reply-${key}`, ...extra } as never, faults)
    }

    // F — 대댓글 전 집계
    const aggregate = async (postId: string) => {
      const p = await prisma.post.findUniqueOrThrow({ where: { id: postId }, select: { id: true, authorId: true, bestReactionWeight: true, bestSelection: { select: { firstEnteredAt: true } }, comments: { where: { isDeleted: false }, select: TARGET_COMMENT_SELECT } } })
      return {
        realReactions: await countRealReactions(prisma, p),
        W: p.bestReactionWeight,
        best: p.bestSelection?.firstEnteredAt.toISOString() ?? null,
        homeMember: await prisma.comment.count({ where: { postId, ...HOME_MEMBER_COMMENT_WHERE } }),
        homeGuest: await prisma.comment.count({ where: { postId, ...HOME_GUEST_COMMENT_WHERE } }),
        composition: await prisma.comment.count({ where: { postId, ...MEMBER_COMMENT_WHERE } }),
        personaTarget: targetCommentCounts(p.comments),
        personaComments: await prisma.comment.count({ where: { postId, OR: [{ commentOrigin: 'PERSONA' }, { personaId: { not: null } }] } }),
      }
    }
    const before = await aggregate(target)

    // A — 성공
    const a1 = await reply(target, c1)
    const a2 = await reply(target, c2)
    expect('A 최상위 회원 댓글에 대댓글 → created', a1.kind, 'created')
    expect('A 기존 대댓글에 대댓글 → created', a2.kind, 'created')
    const saved = await prisma.comment.findMany({
      where: { id: { in: [a1.kind === 'created' ? a1.targetId : '', a2.kind === 'created' ? a2.targetId : ''] } },
      orderBy: { createdAt: 'asc' },
      select: { parentId: true, source: true, commentOrigin: true, personaId: true, operatorWriterId: true, authorId: true },
    })
    expect('🔴 A 저장값 — parentId 정확 · USER · OPERATOR · personaId null · 작성자 = 원글 작성자',
      saved, [c1, c2].map((parentId) => ({ parentId, source: 'USER', commentOrigin: 'OPERATOR', personaId: null, operatorWriterId: replyWriter.id, authorId: replyWriterUser.id })))
    const logs = await prisma.operatorWriteLog.findMany({ where: { requestKey: { in: ['reply-1', 'reply-2'] } }, orderBy: { createdAt: 'asc' }, select: { operatorWriterId: true, actorUserId: true, kind: true, action: true, postId: true, targetId: true } })
    expect('A 감사 기록 — 요청마다 1건 · 원글 작성자 · 실제 조작자 · comment/create · targetId = 대댓글',
      logs.map((l) => [l.operatorWriterId, l.actorUserId, l.kind, l.action, l.postId]), [[replyWriter.id, admin.id, 'comment', 'create', target], [replyWriter.id, admin.id, 'comment', 'create', target]])
    expect('A 감사 기록 targetId 가 만든 대댓글을 가리킨다', logs.map((l) => l.targetId), [a1, a2].map((r) => (r.kind === 'created' ? r.targetId : '')))

    // B — 작성자 위조
    const forged = await reply(target, c1, { operatorWriterId: otherWriter.id, authorId: m1, writerId: otherWriter.id, personaId: 'x', commentOrigin: 'MEMBER', source: 'SYSTEM' })
    const forgedRow = forged.kind === 'created'
      ? await prisma.comment.findUniqueOrThrow({ where: { id: forged.targetId }, select: { operatorWriterId: true, authorId: true, personaId: true, commentOrigin: true, source: true } })
      : null
    expect('🔴 B 임의 작성자 값을 끼워 보내도 무시 — 원글 작성자 · OPERATOR · USER 로 저장',
      forgedRow, { operatorWriterId: replyWriter.id, authorId: replyWriterUser.id, personaId: null, commentOrigin: 'OPERATOR', source: 'USER' })

    // C — 막힘 write 0
    const memberPost = (await prisma.post.create({ data: { boardType: 'FREE', title: '회원 글', content: '회원', authorId: m1 }, select: { id: true } })).id
    const mc = (await prisma.comment.create({ data: { postId: memberPost, authorId: m2, content: '회원 글 댓글', commentOrigin: 'MEMBER' }, select: { id: true } })).id
    const pUser = await prisma.user.create({ data: { nickname: '자동이2' }, select: { id: true } })
    const persona2 = await prisma.persona.create({ data: { code: 'P02', userId: pUser.id, status: 'active' }, select: { id: true } })
    const withComment = async (postId: string) => (await prisma.comment.create({ data: { postId, authorId: m1, content: '댓글이에요', commentOrigin: 'MEMBER' }, select: { id: true } })).id
    const raw = await prisma.microSeedRawContent.create({ data: { origin: 'live', sourceSite: 'test:op', sourceUrl: `https://example.invalid/op/${Date.now()}`, sourceArticleId: `op-${Date.now()}`, sourceCapturedAt: new Date(), rawTitle: 't', rawBody: 'b' }, select: { id: true } })
    const queuePost = await opPost()
    await prisma.originalPostApprovalQueue.create({ data: { sourceRawContentId: raw.id, status: 'APPROVED', draftTitle: 't', draftBody: 'b', gateVerdict: 'PASS', gateResults: {}, promptVersion: 'op', model: 'op', dedupKey: `op-q-${Date.now()}`, createdPostId: queuePost } })
    const retiredUser = await prisma.user.create({ data: { nickname: '은퇴운영자' }, select: { id: true } })
    const retired = await prisma.operatorWriter.create({ data: { code: 'OP04', userId: retiredUser.id, status: 'retired' }, select: { id: true } })
    const cases: [string, string, string][] = []
    const add = async (label: string, postId: string, parentId?: string) => { cases.push([label, postId, parentId ?? await withComment(postId)]) }
    await add('회원 글', memberPost, mc)
    await add('Persona 글', (await prisma.post.create({ data: { boardType: 'FREE', title: 'p', content: 'p', authorId: pUser.id, personaId: persona2.id }, select: { id: true } })).id)
    await add('Micro Seed 글', await opPost({ ...MICRO_SEED_POST_VISIBILITY_FLAGS }))
    await add('오리지널 큐 연결 글(D100 자동 글)', queuePost)
    await add('숨김 글', await opPost({ status: 'HIDDEN' }))
    await add('삭제 글', await opPost({ status: 'DELETED' }))
    await add('매거진 글', await opPost({ boardType: 'MAGAZINE' }))
    await add('retired 작성자 글', (await prisma.post.create({ data: { boardType: 'FREE', title: 'r', content: 'r', authorId: retiredUser.id, operatorWriterId: retired.id }, select: { id: true } })).id)
    await add('원글 authorId ≠ writer.userId', (await prisma.post.create({ data: { boardType: 'FREE', title: 'x', content: 'x', authorId: m1, operatorWriterId: replyWriter.id }, select: { id: true } })).id)
    const deletedC = (await prisma.comment.create({ data: { postId: target, authorId: m1, content: '지운 댓글', commentOrigin: 'MEMBER', isDeleted: true }, select: { id: true } })).id
    cases.push(['다른 글의 댓글', target, mc], ['삭제 댓글', target, deletedC], ['없는 댓글', target, 'cl-not-a-comment'], ['없는 글', 'cl-not-a-post', c1], ['답할 댓글 비움', target, ''])
    for (const [label, postId, parentId] of cases) {
      const c0 = await counts()
      const r = await reply(postId, parentId)
      expect(`C ${label} → blocked · 댓글 · 로그 write 0`, [r.kind, await counts()], ['blocked', c0])
    }
    const gone = await reply(target, deletedC)
    expect('C 삭제 댓글 문구', gone.kind === 'blocked' ? gone.message : gone.kind, OPERATOR_REPLY_MESSAGE.parentGone)
    void retired

    // D — 원자성 · 중복 · 동시성 · 재시도 상한
    {
      const c0 = await counts()
      const r = await reply(target, c1, {}, { afterComment: async () => { throw new Error('시험: 로그 직전 실패') } })
      expect('D 댓글을 쓴 뒤 로그 전에 실패 → 댓글 0 · 로그 0', [r.kind, await counts()], ['error', c0])
      const r2 = await reply(target, c1, {}, { beforeComment: async () => { throw new Error('시험: 댓글 전 실패') } })
      expect('D 댓글 저장 실패 → 로그 0', [r2.kind, await counts()], ['error', c0])
      const r3 = await reply(target, c1, { requestKey: 'reply-1' })
      expect('D 로그 저장 실패(이미 쓴 요청 키) → duplicate · 댓글 0', [r3.kind, await counts()], ['duplicate', c0])
      const dupMsg = r3.kind === 'duplicate' ? r3.message : ''
      expect('D 중복 문구', dupMsg, OPERATOR_REPLY_MESSAGE.duplicate)
    }
    {
      const c0 = await counts()
      const first = await reply(target, c1, { requestKey: 'same-seq' })
      const second = await reply(target, c1, { requestKey: 'same-seq' })
      const [cc, lc] = await counts()
      expect('D 같은 requestKey 순차 2회 → created · duplicate · 댓글 +1 · 로그 +1', [first.kind, second.kind, cc - c0[0], lc - c0[1]], ['created', 'duplicate', 1, 1])
    }
    {
      const c0 = await counts()
      const rs = await Promise.all([1, 2, 3].map(() => reply(target, c2, { requestKey: 'same-concurrent' })))
      const [cc, lc] = await counts()
      expect('D 같은 requestKey 동시 3회 → 성공 1 · 댓글 +1 · 로그 +1',
        [rs.filter((r) => r.kind === 'created').length, cc - c0[0], lc - c0[1]], [1, 1, 1])
    }
    {
      const c0 = await counts()
      let calls = 0
      const busy = await reply(target, c1, {}, { beforeComment: async () => {
        calls += 1
        throw new Prisma.PrismaClientKnownRequestError('시험: 직렬화 충돌', { code: 'P2034', clientVersion: Prisma.prismaVersion.client })
      } })
      expect(`D P2034 재시도 상한 — ${OPERATOR_REPLY_MAX_ATTEMPTS}번 시도 뒤 멈춤 · write 0`, [calls, busy.kind, await counts()], [OPERATOR_REPLY_MAX_ATTEMPTS, 'error', c0])
    }
    {
      const c0 = await counts()
      const rs = await Promise.all([reply(target, c1), reply(target, c2)])
      const [cc, lc] = await counts()
      expect('D 다른 requestKey 동시 2회 → 둘 다 created · 댓글 +2 · 로그 +2', [rs.map((r) => r.kind), cc - c0[0], lc - c0[1]], [['created', 'created'], 2, 2])
    }

    // E — 기존 기능 · 스레드 렌더
    const top = await createOperatorCommentTx(prisma, { operatorWriterId: otherWriter.id, postId: target, content: '최상위 운영 댓글', actorUserId: admin.id, requestKey: 'top-after-reply' })
    const topRow = top.kind === 'created' ? await prisma.comment.findUniqueOrThrow({ where: { id: top.targetId }, select: { parentId: true, operatorWriterId: true } }) : null
    expect('E 기존 최상위 운영 댓글 — 고른 작성자 · parentId null 그대로', topRow, { parentId: null, operatorWriterId: otherWriter.id })
    const rows = await prisma.comment.findMany({ where: { postId: target, commentOrigin: 'OPERATOR', parentId: { not: null } }, select: { id: true, postId: true, parentId: true, createdAt: true, isDeleted: true, personaId: true, operatorWriterId: true, commentOrigin: true, authorId: true } })
    expect('E 스레드 — OPERATOR 대댓글의 작성자 유형이 전부 operator(모순 0)', rows.length > 0 && rows.every((r) => { const k = authorKindOf(r); return k.ok && k.kind === 'operator' }), true)
    const view = await loadPostThreads(prisma, { postId: target, postAuthorId: replyWriterUser.id, blockedAuthorIds: [] })
    const replies = view.threads.flatMap((t) => t.replies)
    expect('E 고객 스레드 — 관계 이상 0 · 대댓글이 뿌리 아래 · 원글 작성자 대댓글에 「글쓴이」',
      [view.anomalies.length, replies.some((r) => r.isPostAuthor && r.name === '갱년기화끈이')], [0, true])

    // F — 집계 불변
    await prisma.$transaction((tx) => syncBestEligibility(tx, target))
    expect('🔴 F 대댓글 전후 — 실반응 · W · 베스트 입성 · 홈 인기 · 고객 구성 · Persona 대상 회원 수 · Persona 댓글 수 전부 그대로',
      await aggregate(target), before)
    const asset = await prisma.persona.findMany({ select: { comments: { select: { commentOrigin: true } } } })
    expect('F Persona 기억 · 말투 자산(Persona.comments)에 운영 댓글 0', asset.some((p) => p.comments.some((c) => c.commentOrigin === 'OPERATOR')), false)
  }

  console.log('\n─────────────────────────────────────────────────────────')
  console.log(`  ${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
}

main()
  .catch((e) => { console.error('🔴 실행 실패:', e); fail += 1 })
  .finally(async () => {
    // 🔴 뒤 검사가 이 검사의 행에 막히지 않게 다시 비운다(사슬 편입 계약)
    try { await wipe() } catch (e) { console.error('🔴 정리 실패:', e); fail += 1 }
    await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0)
  })
