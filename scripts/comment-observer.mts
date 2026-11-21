#!/usr/bin/env tsx
/**
 * 자동 댓글 자연 회차 관측 — 🔴 read-only. DB `findMany` 만 · 파일 읽기만 · write 0 · provider 0
 *   npm run comment:observe -- [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--json]     (기본: 어제~오늘 KST)
 * 🔴 판정은 `src/lib/comment-observation.ts`. 출력은 개수·코드·SHA 만(본문·표시명·회원 정보·id 0).
 * 🔴 없음·손상·기억 기간 밖은 0 이 아니라 UNKNOWN 이다. 정본 장부 reader 는 없는 파일을 빈 목록으로 돌려주므로 먼저 존재를 본다.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { PrismaClient } from '@prisma/client'

import {
  COMMENT_STAGES, kstDateOfMs, kstDatesBetween, observeComments,
  type Lane, type ObservedAttempt, type ObservedLedger, type SourceStatus,
} from '../src/lib/comment-observation'
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
const attempts: Record<Lane, { status: SourceStatus; entries: ObservedAttempt[] }> = {
  'first-comment': { status: 'missing', entries: [] }, followup: { status: 'missing', entries: [] },
}
const lanes = [
  ['first-comment', ATTEMPT_JOURNAL_FILE, FIRST_COMMENT_ATTEMPT_LANE],
  ['followup', FOLLOWUP_ATTEMPT_JOURNAL_FILE, FOLLOWUP_ATTEMPT_LANE],
] as const
for (const [lane, file, policy] of lanes) {
  const path = join(commentLoopLockDir(), file)
  if (!existsSync(path)) { notes.push(`${lane} 시도 장부 없음 → UNKNOWN`); continue }
  let text: string
  try { text = readFileSync(path, 'utf-8') } catch { attempts[lane].status = 'corrupt'; notes.push(`${lane} 시도 장부 읽기 실패 → UNKNOWN`); continue }
  const p = parseAttemptJournal(text, policy)
  if (!p.ok) { attempts[lane].status = 'corrupt'; notes.push(`${lane} 시도 장부 판독 실패 ${p.code} → UNKNOWN`); continue }
  attempts[lane].status = 'ok'
  for (const e of p.journal.entries) {
    attempts[lane].entries.push({ lane, postId: e.postId, personaCode: e.personaCode, attemptedAtMs: e.attemptedAtMs, step: e.step, blockCodes: e.blockCodes })
  }
}
const ledgerByDate = new Map<string, ObservedLedger[] | null>()
for (const d of dates) {
  const path = ledgerPathOf(commentLoopLedgerDir(), d)
  if (!existsSync(path)) { ledgerByDate.set(d, null); notes.push(`댓글 장부 ${d} 없음 → UNKNOWN`); continue }
  const r = readLedgerDay(path)
  if (!r.ok) { ledgerByDate.set(d, null); notes.push(`댓글 장부 ${d} 판독 실패 → UNKNOWN`); continue }
  ledgerByDate.set(d, r.entries.filter((e) => (COMMENT_STAGES as readonly string[]).includes(e.stage))
    .map((e) => ({ stage: e.stage, runId: e.runId, startedAt: e.startedAt, status: e.status, settledUsd: e.settledUsd })))
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
    select: { postId: true, parentId: true, personaId: true, operatorWriterId: true, authorId: true, createdAt: true, author: { select: { isAdmin: true } } },
  })
  const days = observeComments({
    dates, nowMs: Date.now(), attempts, ledgerByDate,
    posts: posts.map((p) => ({ id: p.id, createdAtMs: p.createdAt.getTime() })),
    comments: comments.map((c) => ({
      postId: c.postId, parentId: c.parentId, createdAtMs: c.createdAt.getTime(),
      isPersona: c.personaId !== null, isOperator: c.operatorWriterId !== null, isAdmin: c.author?.isAdmin === true, isGuest: c.authorId === null,
    })),
  })
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ tool: 'comment-observer', readOnly: true, runtimeSha, window: { from: FROM, to: TO }, days, notes }, null, 2))
  } else {
    const u = (v: unknown): string => (v === null || v === undefined ? 'UNKNOWN' : typeof v === 'object' ? JSON.stringify(v) : String(v))
    console.log(`\n══ 자동 댓글 자연 관측 ${FROM}~${TO} KST · runtime ${runtimeSha?.slice(0, 12) ?? '모름'} · read-only ══`)
    for (const d of days) {
      const a = d.comments.byAuthor; const s = d.comments.byStructure; const p = d.comments.personaTopLevel
      console.log(`\n${d.kstDate}  관리형 공개 글 ${d.managedPosts} · 공개 가시 댓글 ${d.comments.total} · 글당 ${u(d.avgCommentsPerPost)}(결과값 = 공개 가시 댓글 ÷ 관리형 공개 글)`)
      console.log(`  작성자 분할(합=${d.comments.total}) Persona ${a.persona} · 운영 ${a.operator} · 관리자 ${a.admin} · 비회원 ${a.guest} · 회원 ${a.member}`)
      console.log(`  구조 분할(합=${d.comments.total}) 최상위 ${s.topLevel} · 답글 ${s.reply}   🔴 두 분할은 서로 겹친다 — 더하지 않는다`)
      console.log(`  Persona 최상위의 부분집합 — 첫 ${p.first} · 추가 ${p.followup} · 회원 참여 글 ${d.memberParticipatedPosts} · 비회원 참여 글 ${d.guestParticipatedPosts}`)
      for (const [lane, l] of Object.entries(d.lanes)) {
        console.log(`  ${lane.padEnd(13)} coverage ${l.coverage} · 장부 ${l.source} · 시도 ${u(l.attempts)} · step ${u(l.steps)} · blockCode ${u(l.blockCodes)}`
          + ` · 추정 재선정(120초) ${u(l.inferredReselectionsWithin120s)} · 정확한 같은 tick ${u(l.exactSameTick)}`)
      }
      for (const [st, x] of Object.entries(d.provider)) {
        console.log(`  ${st.padEnd(19)} 요청 ${u(x.requests)} · 정산 ${u(x.settled)}($${u(x.settledUsd)}) · 미상 ${u(x.usageUnknown)} · 예약 ${u(x.reserved)} · 차단 ${u(x.blocked)}`)
      }
      console.log(`  회차당 요청 ${u(d.requestsPerRun)} · 슬롯 용량 ${u(d.slotCapacity)}(권위 원천 없음)`)
    }
    for (const n of notes) console.log(`  · ${n}`)
    console.log('\n🔴 DB write 0 · 파일 write 0 · provider 0')
  }
} finally { await db.$disconnect() }
