#!/usr/bin/env tsx
/**
 * 댓글 생동감(vitality) 읽기 전용 측정 — `npm run comment:vitality -- [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--json]`
 *
 * 🔴 DB **읽기만**(`findMany`) · write 0 · 댓글 생성·예약 0 · 원문·닉네임·id 출력 0(개수만).
 * 🔴 판정 의미는 `src/lib/comment-vitality.ts` 머리말이 정본이다 — 분포·비율은 결과값이고 quota 가 아니다.
 *    PASS 는 "불변식(중복 Persona · 글쓴이 답글 상한 · 구조 상한 10) 위반 0 · 모두 읽음" 일 뿐 대화가 충분하다는 뜻이 아니다.
 *
 * 범위: 커뮤니티 게시판(갱년기톡 · 자유게시판)의 공개 글. 매거진은 게시판이 아니라 넣지 않는다.
 * 기본 창: 어제 KST 하루. `--from`·`--to` 는 KST 날짜(포함 · 포함).
 */
import { PrismaClient } from '@prisma/client'

import { judgeCommentVitality, type VitalityOrigin, type VitalityPost } from '../src/lib/comment-vitality'
import { fillDbConnection } from './lib/ops-signals.mjs'

const KST_MS = 9 * 3_600_000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const ORIGINS: readonly VitalityOrigin[] = ['MEMBER', 'PERSONA', 'MICRO_SEED_VERBATIM', 'GUEST', 'OPERATOR']

const arg = (name: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit === undefined ? null : hit.slice(name.length + 3)
}
const kstDateOf = (ms: number): string => new Date(ms + KST_MS).toISOString().slice(0, 10)
const kstStartMs = (date: string): number => Date.parse(`${date}T00:00:00+09:00`)

const now = Date.now()
const yesterday = kstDateOf(now - 86_400_000)
const from = arg('from') ?? yesterday
const to = arg('to') ?? from
if (!DATE_RE.test(from) || !DATE_RE.test(to) || to < from) {
  console.error('🔴 --from/--to 는 KST 날짜(YYYY-MM-DD)이고 to ≥ from 이어야 한다')
  process.exit(2)
}
if (!fillDbConnection()) { console.error('🔴 DATABASE_URL 이 없다 — 측정하지 않는다(UNKNOWN)'); process.exit(2) }

const prisma = new PrismaClient()
try {
  const rows = await prisma.post.findMany({
    where: {
      status: 'PUBLISHED',
      boardType: { in: ['MENOPAUSE', 'FREE'] },
      createdAt: { gte: new Date(kstStartMs(from)), lt: new Date(kstStartMs(to) + 86_400_000) },
    },
    select: {
      createdAt: true,
      personaId: true,
      comments: { select: { commentOrigin: true, personaId: true, createdAt: true, isDeleted: true } },
    },
  })
  const posts: VitalityPost[] = rows.map((p) => ({
    publishedAtMs: p.createdAt.getTime(),
    authorPersonaKey: p.personaId,
    comments: p.comments.map((c) => ({
      origin: (ORIGINS as readonly string[]).includes(c.commentOrigin) ? (c.commentOrigin as VitalityOrigin) : null,
      personaKey: c.personaId,
      createdAtMs: c.createdAt.getTime(),
      isDeleted: c.isDeleted,
    })),
  }))
  const r = judgeCommentVitality(posts, now)
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ window: { from, to }, ...r }, null, 2))
  } else {
    const pct = (v: number | null): string => (v === null ? '모름' : `${(v * 100).toFixed(1)}%`)
    console.log(`댓글 vitality ${from}~${to} (KST) — ${r.verdict}${r.codes.length > 0 ? ` [${r.codes.join(',')}]` : ''}`)
    console.log(`  글 ${r.posts} · 읽음 ${r.readablePosts} · 24시간 지난 글 ${r.maturePosts}`)
    console.log(`  24시간 고립률 ${pct(r.isolationRate)} (${r.isolatedPosts}/${r.maturePosts})`)
    console.log(`  실회원 참여 글 ${pct(r.memberParticipationRate)} (${r.memberParticipationPosts}) · 손님 참여 글 ${r.guestParticipationPosts}`)
    console.log('  열린 질문 응답률 모름 — hook 권위 통합(PR-2) 전에는 재지 않는다')
    console.log(`  분포 ${Object.entries(r.distribution).map(([b, n]) => `${b}:${n}`).join(' · ')} · 8~10 비중 ${pct(r.share8to10)}`)
    console.log(`  평균(결과값 · 목표 아님) ${r.averageLiveComments === null ? '모름' : r.averageLiveComments.toFixed(2)}`)
    console.log(`  불변식 — 중복 Persona 글 ${r.duplicatePersonaPosts} · 글쓴이 답글 초과 ${r.authorReplyOverCapPosts} · 구조 상한 초과 ${r.personaOverCapPosts}`)
  }
} finally {
  await prisma.$disconnect()
}
