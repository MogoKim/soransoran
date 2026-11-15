#!/usr/bin/env tsx
/**
 * 자동 댓글 자연 회차 관측 — 🔴 read-only. DB `findMany` 만 · 파일 읽기만 · write 0 · provider 0
 *   npm run comment:observe -- [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--json]     (기본: 어제~오늘 KST)
 * 🔴 판정은 `src/lib/comment-observation.ts`. 출력은 개수·코드·SHA 만(본문·표시명·회원 정보·id 0).
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { PrismaClient } from '@prisma/client'

import { COMMENT_STAGES, kstDateOfMs, kstDatesBetween, observeComments, type ObservedAttempt, type ObservedLedger } from '../src/lib/comment-observation'
import { FIRST_COMMENT_ATTEMPT_LANE, parseAttemptJournal } from '../src/lib/persona-comment-attempt-policy'
import { FOLLOWUP_ATTEMPT_LANE } from '../src/lib/persona-comment-followup'
import { ATTEMPT_JOURNAL_FILE, FOLLOWUP_ATTEMPT_JOURNAL_FILE } from './lib/persona-comment-attempt-store.mjs'
import { commentLoopLedgerDir } from './lib/persona-comment-loop.mjs'
import { commentLoopLockDir } from './lib/persona-comment-runner-template'
import { ledgerPathOf, readLedgerDay } from './lib/llm-ledger-store.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { fillDbConnection } from './lib/ops-signals.mjs'

const arg = (k: string): string | null => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null
const FROM = arg('from') ?? kstDateOfMs(Date.now() - 864e5)
const TO = arg('to') ?? kstDateOfMs(Date.now())
const dates = kstDatesBetween(FROM, TO)
if (dates.length === 0) { console.error('🔴 --from/--to 는 KST 날짜이고 to ≥ from'); process.exit(2) }

const notes: string[] = []
const attempts: ObservedAttempt[] = []
const lanes = [
  ['first-comment', ATTEMPT_JOURNAL_FILE, FIRST_COMMENT_ATTEMPT_LANE],
  ['followup', FOLLOWUP_ATTEMPT_JOURNAL_FILE, FOLLOWUP_ATTEMPT_LANE],
] as const
for (const [lane, file, policy] of lanes) {
  let text: string
  try { text = readFileSync(join(commentLoopLockDir(), file), 'utf-8') } catch { notes.push(`${lane} 시도 장부 없음(이벤트 없음 또는 미생성)`); continue }
  const p = parseAttemptJournal(text, policy)
  if (!p.ok) { notes.push(`${lane} 시도 장부 판독 실패 ${p.code}`); continue }
  for (const e of p.journal.entries) {
    attempts.push({ lane, postId: e.postId, personaCode: e.personaCode, attemptedAtMs: e.attemptedAtMs, step: e.step, blockCodes: e.blockCodes })
  }
}
const ledger: ObservedLedger[] = []
for (const d of dates) {
  const r = readLedgerDay(ledgerPathOf(commentLoopLedgerDir(), d))
  if (!r.ok) { notes.push(`댓글 장부 ${d} 판독 실패 또는 없음`); continue }
  for (const e of r.entries) {
    if ((COMMENT_STAGES as readonly string[]).includes(e.stage)) ledger.push({ stage: e.stage, runId: e.runId, startedAt: e.startedAt, status: e.status, settledUsd: e.settledUsd })
  }
}
const runtimeSha = ((): string | null => {
  try { return readFileSync(join(homedir(), 'Library', 'Application Support', 'soransoran', 'runtime-pinned-sha'), 'utf-8').trim() } catch { return null }
})()

await loadEnvLocal()
if (!fillDbConnection()) { console.error('🔴 canonical DB env 없음'); process.exit(2) }
const db = new PrismaClient()
try {
  const from = new Date(`${FROM}T00:00:00+09:00`)
  const to = new Date(new Date(`${TO}T00:00:00+09:00`).getTime() + 864e5)
  const posts = await db.post.findMany({
    where: { boardType: { in: ['MENOPAUSE', 'FREE'] }, personaId: { not: null }, status: 'PUBLISHED', createdAt: { gte: from, lt: to } },
    select: { id: true, createdAt: true },
  })
  const comments = await db.comment.findMany({
    where: { postId: { in: posts.map((p) => p.id) }, isDeleted: false },
    select: { postId: true, parentId: true, personaId: true, createdAt: true, author: { select: { isAdmin: true } } },
  })
  const days = observeComments({
    dates, attempts, ledger,
    posts: posts.map((p) => ({ id: p.id, createdAtMs: p.createdAt.getTime() })),
    comments: comments.map((c) => ({ postId: c.postId, parentId: c.parentId, isPersona: c.personaId !== null, isAdmin: c.author?.isAdmin === true, createdAtMs: c.createdAt.getTime() })),
  })
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ tool: 'comment-observer', readOnly: true, runtimeSha, window: { from: FROM, to: TO }, days, notes }, null, 2))
  } else {
    console.log(`\n══ 자동 댓글 자연 관측 ${FROM}~${TO} KST · runtime ${runtimeSha?.slice(0, 12) ?? '모름'} · read-only ══`)
    for (const d of days) {
      console.log(`\n${d.kstDate}  관리형 글 ${d.managedPosts} · 댓글 ${d.comments.total}(첫 ${d.comments.first} · 추가 ${d.comments.followup} · 답글 ${d.comments.reply} · 실회원 ${d.comments.member})`
        + ` · 실회원 참여 글 ${d.memberParticipatedPosts} · 글당 ${d.avgCommentsPerPost ?? '—'}(결과값)`)
      for (const [lane, l] of Object.entries(d.lanes)) {
        console.log(`  ${lane.padEnd(13)} 시도 ${l.attempts} · step ${JSON.stringify(l.steps)} · blockCode ${JSON.stringify(l.blockCodes)} · 같은 tick 재선정 ${l.sameTickReselections}`)
      }
      for (const [st, s] of Object.entries(d.provider)) {
        console.log(`  ${st.padEnd(19)} 요청 ${s.requests} · 정산 ${s.settled}($${s.settledUsd.toFixed(4)}) · 미상 ${s.usageUnknown} · 예약 ${s.reserved} · 차단 ${s.blocked}`)
      }
      console.log(`  회차 용량 ${d.runCapacity.runs}회 · 회차당 최대 ${d.runCapacity.maxRequestsPerRun} · 평균 ${d.runCapacity.avgRequestsPerRun ?? '—'}`)
    }
    for (const n of notes) console.log(`  · ${n}`)
    console.log('\n🔴 DB write 0 · 파일 write 0 · provider 0')
  }
} finally { await db.$disconnect() }
