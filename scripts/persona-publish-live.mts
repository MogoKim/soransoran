#!/usr/bin/env tsx
/**
 * 페르소나 후보 발행 — 🔴 기본은 dry-run. DB write 0
 *
 * 정본: docs/operations/2026-08-30-persona-architecture-design.md §13
 *
 * 흐름
 *   ① APPROVED 후보 픽업 → ② 게이트 실측 판정 → ③ (--apply 일 때만) 트랜잭션 발행
 *
 * 🔴 write 로직을 여기서 다시 짜지 않는다.
 *    src/lib/persona-publish-tx.ts 의 publishCandidateTx 를 부른다 —
 *    어드민 버튼과 **같은 함수**다. 둘로 나뉘면 게이트도 둘이 된다.
 *
 * 🔴 dry-run 결과를 신뢰하지 않는다.
 *    dry-run 은 판정 시점의 사진이다. 실제 발행은 트랜잭션 안에서 게이트를 다시 본다.
 *
 * 🔴 발행 가능한 후보가 없는 것은 오류가 아니다.
 *    dry-run 은 그 사실을 보고하고 0 으로 끝난다. 지금은 그것이 정상 상태다 —
 *    페르소나 5명이 전부 draft 이고 대기열의 targetPostId 가 비어 있다.
 *
 * 🔴 본문 전문 · 실회원 닉네임 · 이메일을 출력하지 않는다. 길이와 마스킹만 남긴다.
 *
 * 사용법
 *   npx tsx scripts/persona-publish-live.mts                 APPROVED 전체 dry-run
 *   npx tsx scripts/persona-publish-live.mts --id <queueId>  1건 dry-run
 *   npx tsx scripts/persona-publish-live.mts --id <id> --apply   🔴 실제 발행
 *   npx tsx scripts/persona-publish-live.mts --check         발행 결과 대조
 *
 * 종료 코드: --apply 가 발행하지 못하면 1 · --check 실패면 1 · 그 외 0
 */
import { PrismaClient } from '@prisma/client'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { publishCandidateTx } from '../src/lib/persona-publish-tx'
import { planPublish, type PublishBlock } from '../src/lib/persona-publish-rules'
import { requireCapContext, kstDayStart, weekWindowStart } from '../src/lib/persona-cap'
import type { CandidateStatus } from '../src/lib/persona-candidate-rules'

const argv = process.argv.slice(2)
const arg = (k: string): string | undefined => {
  const i = argv.indexOf(k)
  return i === -1 ? undefined : argv[i + 1]
}
const APPLY = argv.includes('--apply')
const CHECK = argv.includes('--check')
const ONLY_ID = (arg('--id') ?? '').trim()

const mask = (v: string): string => `${v.slice(0, 4)}…${v.slice(-3)}`
const kst = (d: Date | null): string =>
  d === null ? '—' : new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') + ' KST'

await loadEnvLocal()
const prisma = new PrismaClient()

console.log(`\n══ ${CHECK ? '검증 (--check)' : APPLY ? '🔴 실제 발행 (--apply)' : 'dry-run'} ══`)

// ─────────────────────────────────────────────────────────
// --check — 발행 결과 대조
// ─────────────────────────────────────────────────────────
if (CHECK) {
  const published = await prisma.personaApprovalQueue.findMany({
    where: { status: 'PUBLISHED' },
    select: { id: true, publishedCommentId: true, personaId: true },
  })
  console.log(`\nPUBLISHED ${published.length}건`)

  let bad = 0
  for (const row of published) {
    if (row.publishedCommentId === null) {
      console.log(`  🔴 ${mask(row.id)} — PUBLISHED 인데 publishedCommentId 가 없다`)
      bad += 1
      continue
    }
    const c = await prisma.comment.findUnique({
      where: { id: row.publishedCommentId },
      select: { id: true, personaId: true, commentOrigin: true, source: true, isDeleted: true },
    })
    const log = await prisma.personaActivityLog.count({
      where: { personaId: row.personaId, kind: 'comment', targetId: row.publishedCommentId },
    })
    const problems: string[] = []
    if (c === null) problems.push('Comment 가 없다')
    else {
      if (c.personaId !== row.personaId) problems.push('personaId 불일치')
      if (c.commentOrigin !== 'PERSONA') problems.push(`commentOrigin=${c.commentOrigin}`)
      if (c.source !== 'SYSTEM') problems.push(`source=${c.source}`)
    }
    if (log !== 1) problems.push(`ActivityLog ${log}건 (1이어야 한다)`)

    if (problems.length > 0) { bad += 1; console.log(`  🔴 ${mask(row.id)} — ${problems.join(' · ')}`) }
    else console.log(`  ✅ ${mask(row.id)} → 댓글 ${mask(row.publishedCommentId)}${c?.isDeleted ? ' (내려감)' : ''}`)
  }

  const [personaStatus, commentTotal] = await Promise.all([
    prisma.persona.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.comment.count(),
  ])
  console.log(`\nPersona status: ${personaStatus.map((s) => `${s.status}=${s._count._all}`).join(' · ')}`)
  console.log(`Comment 전체 ${commentTotal}`)

  await prisma.$disconnect()
  console.log(bad === 0 ? '\n✅ 검증 통과\n' : `\n🔴 ${bad}건 불일치\n`)
  process.exit(bad === 0 ? 0 : 1)
}

// ─────────────────────────────────────────────────────────
// 판정 — dry-run · --apply 공통
// ─────────────────────────────────────────────────────────
const now = new Date()

const rows = await prisma.personaApprovalQueue.findMany({
  where: ONLY_ID !== '' ? { id: ONLY_ID } : { status: 'APPROVED' },
  select: {
    id: true, status: true, targetPostId: true, publishedCommentId: true,
    candidateText: true, editedText: true, personaId: true, createdAt: true,
    persona: { select: { code: true, status: true, dailyCap: true, weeklyCap: true } },
  },
  orderBy: { createdAt: 'asc' },
})

if (rows.length === 0) {
  await prisma.$disconnect()
  console.log(
    ONLY_ID !== ''
      ? '\n대상을 찾지 못했습니다.\n'
      : '\nAPPROVED 후보가 없습니다. 발행할 것이 없습니다 — 정상입니다.\n',
  )
  process.exit(ONLY_ID !== '' ? 1 : 0)
}

// kill switch 는 전역 1행이다
const sw = await prisma.personaGlobalSwitch.findUnique({
  where: { id: 'global' },
  select: { enabled: true },
})
const killSwitchEnabled = sw?.enabled === true
console.log(`\n전체 중지(kill switch): ${killSwitchEnabled ? '🔴 켜짐 — 모든 발행 차단' : '꺼짐'}`)

const eligible: string[] = []
console.log(`\n대상 ${rows.length}건`)

for (const row of rows) {
  const post = row.targetPostId
    ? await prisma.post.findUnique({
        where: { id: row.targetPostId },
        select: { id: true, status: true },
      })
    : null

  const personaCommentsOnPost = row.targetPostId
    ? await prisma.comment.count({
        where: { postId: row.targetPostId, personaId: { not: null }, isDeleted: false },
      })
    : 0

  const [usedToday, usedWeek] = await Promise.all([
    prisma.personaActivityLog.count({
      where: { personaId: row.personaId, kind: 'comment', createdAt: { gte: kstDayStart(now) } },
    }),
    prisma.personaActivityLog.count({
      where: { personaId: row.personaId, kind: 'comment', createdAt: { gte: weekWindowStart(now) } },
    }),
  ])

  const plan = planPublish({
    candidate: {
      status: row.status as CandidateStatus,
      targetPostId: row.targetPostId,
      publishedCommentId: row.publishedCommentId,
      candidateText: row.candidateText,
      editedText: row.editedText,
    },
    persona: {
      status: row.persona.status,
      dailyCap: row.persona.dailyCap,
      weeklyCap: row.persona.weeklyCap,
    },
    killSwitchEnabled,
    cap: requireCapContext({ usedToday, usedWeek }),
    targetPost: post ? { status: post.status } : null,
    personaCommentsOnPost,
  })

  const head =
    `  ${plan.ok ? '🟢 발행 가능' : '⛔ BLOCKED'} ${mask(row.id)} · ${row.persona.code}(${row.persona.status})` +
    ` · ${row.status} · 대상글 ${row.targetPostId ? mask(row.targetPostId) : '없음'}` +
    ` · 본문 ${[...row.candidateText].length}자 · 생성 ${kst(row.createdAt)}`
  console.log(head)
  console.log(
    `      cap 오늘 ${usedToday}/${row.persona.dailyCap ?? '미설정'}` +
      ` · 주 ${usedWeek}/${row.persona.weeklyCap ?? '미설정'}`,
  )
  if (!plan.ok) {
    for (const b of plan.blocks as PublishBlock[]) console.log(`      · [${b.code}] ${b.message}`)
  } else {
    eligible.push(row.id)
  }
}

console.log(`\n발행 가능 ${eligible.length}건 / 전체 ${rows.length}건`)

// ─────────────────────────────────────────────────────────
// dry-run 종료
// ─────────────────────────────────────────────────────────
if (!APPLY) {
  await prisma.$disconnect()
  console.log('\n🟡 dry-run 입니다. DB write 0 · 실제로 발행하려면 --id <id> --apply\n')
  process.exit(0)
}

// ─────────────────────────────────────────────────────────
// --apply — 🔴 실제 발행. 1건씩만
// ─────────────────────────────────────────────────────────
if (ONLY_ID === '') {
  await prisma.$disconnect()
  console.error('\n🔴 --apply 는 --id 와 함께만 씁니다. 한 번에 1건입니다.\n')
  process.exit(2)
}
if (!eligible.includes(ONLY_ID)) {
  await prisma.$disconnect()
  console.error('\n🔴 발행 가능 상태가 아닙니다. 위 BLOCKED 사유를 보세요.\n')
  process.exit(1)
}

const before = await prisma.comment.count()
const res = await publishCandidateTx(prisma, { id: ONLY_ID, now })

if (res.kind !== 'published') {
  await prisma.$disconnect()
  console.error(
    `\n🔴 발행하지 못했습니다 — ${res.kind === 'error' ? res.message : res.blocks.map((b) => b.code).join(' · ')}\n`,
  )
  process.exit(1)
}

const after = await prisma.comment.count()
console.log(`\n✅ 발행 — 댓글 ${mask(res.commentId)} · 글 ${mask(res.postId)}`)
console.log(`   Comment ${before} → ${after} (+${after - before})`)
if (after - before !== 1) console.log('   🔴 증가분이 1이 아닙니다. --check 로 확인하세요.')

await prisma.$disconnect()
console.log('\n--check 로 검증하세요.\n')
