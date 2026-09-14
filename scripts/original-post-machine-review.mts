#!/usr/bin/env tsx
/**
 * 기계 후보 **사람 검토** — 🔴 기본 read-only. DB write 0
 *
 * 🔴 **왜 필요한가** (2026-09-14).
 *
 *    나이·세대 모순을 3/3 잡는 검수 모델이 **없다**(실측 — haiku 1/3 · gpt-5-mini 0/3 ·
 *    gemini-3.7-flash 2/3). 그래서 기계가 만든 글은 **사람이 한 번 보고 나서야**
 *    자동 발행 대상이 된다(`selectAutoTargets` 가 `HUMAN_REVIEW_REQUIRED` 로 막는다).
 *
 *    이 명령은 그 "한 번 보는" 자리다. 사람이 읽고, 괜찮으면 `decidedBy` 를 `founder` 로 바꾼다.
 *
 * 🔴 **새 컬럼도 migration 도 만들지 않는다.** 큐에 이미 있는 `decidedBy` 하나를 쓴다.
 *
 * 🔴 **바꾸는 것은 `decidedBy`·`decidedAt` 두 칸뿐이다.**
 *    본문 · 제목 · `status` · `gateResults` · Post · Comment · Persona 는 건드리지 않는다.
 *    provider 를 부르지 않는다. 기계 생성 provenance 는 그대로 남는다.
 *
 *    🔴 `decidedAt` 이 함께 바뀌는 이유 — "누가" 만 적고 "언제" 를 기계 적재 시각으로 두면
 *    그 기록이 거짓이 된다. 그리고 `queueOrderKey` 가 `decidedAt` 으로 줄을 세우므로,
 *    함께 바꿔야 자동 발행 순서가 **실제 사람 검토 순서**가 된다.
 *
 * 🔴 **Persona·나이대 근거가 없으면 검토 완료를 거부한다.**
 *    글쓴이가 몇 살인지 모르는 채로 "사람이 봤다" 고 적으면, 그 표시는 거짓이 된다 —
 *    나이 관점을 볼 수 없었는데 봤다고 기록하는 셈이다.
 *
 * 사용법
 *   npm run publish:machine-review                     대기 목록 (read-only)
 *   npm run publish:machine-review -- --id <queueId>   한 건 전문 (read-only)
 *   npm run publish:machine-review -- --id <id> --apply --limit=1   🔴 검토 완료 표시
 *
 * 종료 코드: 검토 완료에 실패하면 1 · 그 외 0
 */
import { PrismaClient } from '@prisma/client'

import {
  MACHINE_REVIEWED_BY, machineReviewedByHuman, profileOf, voiceInputOf,
  judgeReviewSnapshot, type AutoRow, type ReviewSnapshot,
} from '../src/lib/original-post-auto-publish'
import { MACHINE_AGE_HUMAN_REVIEW_NOTE } from '../src/lib/micro-seed-auto-draft'
import { parsePoolDoc } from '../src/lib/persona-pool-card'
import { PERSONA_POOL_DOC } from './micro-seed-auto-draft.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const ONLY_ID = (argv.find((a) => a.startsWith('--id='))?.slice(5)
  ?? (argv.includes('--id') ? argv[argv.indexOf('--id') + 1] : undefined) ?? '').trim()
const limitRaw = argv.find((a) => a.startsWith('--limit='))?.slice(8)
const LIMIT = limitRaw === undefined ? null : Number.parseInt(limitRaw, 10)

// 🔴 변수에 타입을 적어야 TS 가 `never` 로 좁혀 준다 (화살표 반환형만으로는 부족하다)
const fail: (m: string) => never = (m) => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }
const kst = (d: Date | null): string =>
  d === null ? '—' : `${new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')} KST`

await loadEnvLocal()
const prisma = new PrismaClient()

const ageOf = new Map(
  parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8')).cards.map((c) => [c.code, c.ageBand]),
)

console.log(APPLY ? '\n══ 🔴 검토 완료 표시 (--apply) ══\n' : '\n══ 기계 후보 사람 검토 (read-only · DB write 0) ══\n')
console.log(`  ${MACHINE_AGE_HUMAN_REVIEW_NOTE}`)
console.log(`  🔴 바꾸는 것은 decidedBy·decidedAt 두 칸뿐이다 — 본문 · status · gateResults · Post 는 건드리지 않는다\n`)

const raw = await prisma.originalPostApprovalQueue.findMany({
  where: { status: { in: ['APPROVED', 'EDITED'] }, createdPostId: null },
  select: {
    id: true, status: true, createdPostId: true, gateVerdict: true,
    promptVersion: true, model: true, matchedPersonaId: true,
    draftTitle: true, draftBody: true, editedTitle: true, editedBody: true,
    // 🔴 낙관적 잠금의 근거 — 사람이 읽은 뒤 행이 한 번이라도 쓰였으면 값이 바뀐다
    updatedAt: true,
    gateResults: true, decidedBy: true, decidedAt: true, createdAt: true,
    rawContent: { select: { sourceSite: true } },
  },
  orderBy: [{ decidedAt: 'asc' }, { createdAt: 'asc' }],
})
const rows: AutoRow[] = raw.map((r) => ({
  id: r.id, status: r.status, createdPostId: r.createdPostId, gateVerdict: String(r.gateVerdict),
  promptVersion: r.promptVersion, model: r.model, matchedPersonaId: r.matchedPersonaId,
  title: r.editedTitle ?? r.draftTitle, body: r.editedBody ?? r.draftBody,
  sourceSite: r.rawContent.sourceSite, gateResults: r.gateResults,
  decidedBy: r.decidedBy, decidedAt: r.decidedAt, createdAt: r.createdAt,
}))

/**
 * 🔴 **사람이 읽은 그 순간의 모습**을 남긴다 — UPDATE 직전에 다시 읽어 대조한다.
 *    발행 문안(`edited ?? draft`)으로 담는다. draft 만 담으면 수정본이 바뀐 것을 놓친다.
 */
// 🔴 Prisma enum 타입을 그대로 쓰려면 원본 행을 들고 있어야 한다 (문자열로 넘기면 where 가 거부한다)
const rawById = new Map(raw.map((r) => [r.id, r]))
const snapOf = new Map<string, ReviewSnapshot>(raw.map((r) => [r.id, {
  status: r.status, createdPostId: r.createdPostId, decidedBy: r.decidedBy,
  updatedAt: r.updatedAt,
  title: r.editedTitle ?? r.draftTitle, body: r.editedBody ?? r.draftBody,
  promptVersion: r.promptVersion, model: r.model, gateResults: r.gateResults,
}]))

/** 🔴 이 후보의 글쓴이가 누구이고 몇 살인가 — 모르면 검토 완료를 거부한다 */
type Ground = { personaCode: string | null; ageBand: string | null; ok: boolean; reason: string }
function groundOf(r: AutoRow): Ground {
  const code = voiceInputOf(r).voice?.personaCode ?? null
  if (code === null) {
    return { personaCode: null, ageBand: null, ok: false, reason: '생성 Persona 기록이 없다 — 누가 쓴 글인지 모른다' }
  }
  const band = ageOf.get(code) ?? null
  if (band === null || band.trim() === '') {
    return { personaCode: code, ageBand: null, ok: false, reason: `${code} 의 정본 나이대(ageBand)를 읽지 못했다` }
  }
  return { personaCode: code, ageBand: band, ok: true, reason: '' }
}

const machine = rows.filter((r) => profileOf(r) === 'machine')
const pending = machine.filter((r) => !machineReviewedByHuman(r.decidedBy))
const reviewed = machine.filter((r) => machineReviewedByHuman(r.decidedBy))
const grounds = new Map(machine.map((r) => [r.id, groundOf(r)]))
const reviewable = pending.filter((r) => grounds.get(r.id)!.ok)
const blocked = pending.filter((r) => !grounds.get(r.id)!.ok)

console.log(`① 기계 후보 ${machine.length}건 — 🟢 검토 완료 ${reviewed.length} · 🟡 미검토 ${pending.length}`)
console.log(`   미검토 중  검토 가능 ${reviewable.length}건 · 🔴 근거 없어 검토 불가 ${blocked.length}건`)
if (blocked.length > 0) {
  const why = new Map<string, number>()
  for (const r of blocked) { const w = grounds.get(r.id)!.reason; why.set(w, (why.get(w) ?? 0) + 1) }
  for (const [w, n] of why) console.log(`      · ${w} — ${n}건`)
}

// ── 한 건 전문 ──
if (ONLY_ID !== '') {
  const hit = rows.find((x) => x.id === ONLY_ID)
  if (hit === undefined) { await prisma.$disconnect(); fail(`대기열에 없는 id 다 — ${ONLY_ID}`) }
  const r: AutoRow = hit
  const g = grounds.get(r.id)
  console.log(`\n② 후보 ${r.id}`)
  console.log(`   profile ${profileOf(r) ?? '(불명)'} · status ${r.status} · decidedBy ${r.decidedBy ?? '(없음)'}`)
  console.log(`   승인 ${kst(r.decidedAt)} · 생성 ${kst(r.createdAt)}`)
  console.log(`   생성 voice Persona ${g?.personaCode ?? '🔴 기록 없음'} · 나이대 ${g?.ageBand ?? '🔴 모름'}`)
  console.log(`\n   제목: ${r.title}`)
  console.log(`   본문:\n${r.body.split('\n').map((x) => `     ${x}`).join('\n')}`)
  if (g !== undefined && !g.ok) console.log(`\n   🔴 검토 완료 불가 — ${g.reason}`)
} else {
  console.log('\n② 검토 대기 (오래 기다린 순 · 상위 10건)')
  for (const [i, r] of reviewable.slice(0, 10).entries()) {
    const g = grounds.get(r.id)!
    console.log(`   ${i + 1}. ${r.id} · ${g.personaCode}(${g.ageBand}) · ${kst(r.decidedAt ?? r.createdAt)}`)
    console.log(`      "${r.title.slice(0, 46)}"`)
  }
  if (reviewable.length === 0) console.log('   (없음)')
}

// ── 여기까지가 read-only ──
if (!APPLY) {
  console.log('\n  🟡 read-only 입니다. DB write 0 —'
    + ' 검토 완료로 표시하려면 --id <id> --apply --limit=1 을 함께 붙이세요.\n')
  await prisma.$disconnect()
  process.exit(0)
}

// ── --apply — 🔴 decidedBy 한 칸만 바꾼다 ──
if (ONLY_ID === '') { await prisma.$disconnect(); fail('--apply 는 --id 와 함께만 씁니다. 한 번에 1건입니다.') }
if (LIMIT !== 1) { await prisma.$disconnect(); fail(`--limit 은 1 이어야 합니다 (받은 값 ${LIMIT ?? '없음'})`) }
const found = rows.find((x) => x.id === ONLY_ID)
if (found === undefined) { await prisma.$disconnect(); fail(`대기열에 없는 id 다 — ${ONLY_ID}`) }
const target: AutoRow = found
if (profileOf(target) !== 'machine') {
  await prisma.$disconnect(); fail('기계 후보가 아닙니다 — 사람 후보의 decidedBy 를 바꾸지 않습니다.')
}
if (machineReviewedByHuman(target.decidedBy)) {
  await prisma.$disconnect(); fail('이미 검토 완료된 후보입니다.')
}
const g = grounds.get(target.id)!
if (!g.ok) {
  await prisma.$disconnect()
  fail(`검토 완료할 수 없습니다 — ${g.reason}.`
    + ' 글쓴이 나이를 모르면 나이 관점을 본 것이 아니므로 "사람이 봤다" 고 적지 않습니다.')
}

const before = snapOf.get(target.id)
if (before === undefined) { await prisma.$disconnect(); fail('검토 스냅샷을 읽지 못했습니다.') }

/**
 * 🔴 **낙관적 잠금 조건부 UPDATE** (2026-09-14).
 *
 *    사람이 읽고 나서 여기까지 오는 사이에 본문이 바뀌거나 상태가 움직였을 수 있다.
 *    그 상태로 `founder` 를 붙이면 **읽지 않은 글에 도장을 찍는 것**이다.
 *    `updatedAt` 은 행이 한 번이라도 쓰이면 바뀌므로(`@updatedAt`), 그 값을 조건에 넣으면
 *    **무엇이 바뀌었든** 0건이 되어 멈춘다.
 *
 * 🔴 **`decidedAt` 을 함께 쓴다.** 앞선 판은 `decidedBy` 만 바꿔서
 *    "누가" 는 사람인데 "언제" 는 **기계가 적재한 시각**으로 남았다 — 거짓 기록이다.
 *    그리고 `queueOrderKey` 가 `decidedAt` 으로 줄을 세우므로,
 *    이 값을 함께 바꿔야 자동 발행 순서가 **실제 사람 검토 순서**가 된다.
 */
const reviewedAt = new Date()
const res = await prisma.originalPostApprovalQueue.updateMany({
  where: {
    id: target.id,
    // 🔴 **읽었을 때의 그 status** 다 — 그 사이 바뀌었으면 0건이 된다
    status: rawById.get(target.id)!.status,
    createdPostId: null,
    decidedBy: before.decidedBy,
    updatedAt: before.updatedAt,
  },
  data: { decidedBy: MACHINE_REVIEWED_BY, decidedAt: reviewedAt },
})
if (res.count !== 1) {
  await prisma.$disconnect()
  fail('검토한 뒤 그 사이에 후보가 바뀌었습니다(상태 · 본문 · 승인 표시 중 하나).'
    + ' 아무것도 바꾸지 않았습니다 — 다시 읽고 검토해 주세요.')
}

/**
 * 🔴 **쓴 뒤에 다시 읽어 대조한다.** 조건부 UPDATE 가 통과했다는 것과
 *    "내가 읽은 그 글이 그대로다" 는 다른 말이다 — 발행 문안까지 눈으로 확인한다.
 */
const back = await prisma.originalPostApprovalQueue.findUnique({
  where: { id: target.id },
  select: {
    status: true, createdPostId: true, decidedBy: true, decidedAt: true, updatedAt: true,
    draftTitle: true, draftBody: true, editedTitle: true, editedBody: true,
    promptVersion: true, model: true, gateResults: true,
  },
})
if (back === null) { await prisma.$disconnect(); fail('쓴 뒤 다시 읽지 못했습니다.') }
const after: ReviewSnapshot = {
  status: back.status, createdPostId: back.createdPostId, decidedBy: back.decidedBy,
  updatedAt: back.updatedAt,
  title: back.editedTitle ?? back.draftTitle, body: back.editedBody ?? back.draftBody,
  promptVersion: back.promptVersion, model: back.model, gateResults: back.gateResults,
}
// 🔴 `decidedBy`·`decidedAt` 은 바뀌라고 쓴 칸이라 이 대조에 넣지 않는다
const snap = judgeReviewSnapshot(before, after)
const stampOk = back.decidedBy === MACHINE_REVIEWED_BY
  && back.decidedAt !== null && back.decidedAt.getTime() === reviewedAt.getTime()

console.log(`\n✅ 검토 완료 — ${target.id}`)
console.log(`   decidedBy → ${back.decidedBy} · decidedAt → ${kst(back.decidedAt)}`)
console.log(`     (옛 값: ${target.decidedBy ?? '(없음)'} · ${kst(target.decidedAt)} — 🔴 기계 적재 시각이었다)`)
console.log(`   status ${back.status} (그대로) · createdPostId ${back.createdPostId ?? 'null'}`)
console.log(`   검토한 글과 동일 ${snap.ok ? '🟢 확인' : `🔴 어긋남 — ${snap.changed.join(' · ')}`}`)
console.log(`   검토 표시 기록 ${stampOk ? '🟢 확인' : '🔴 어긋남'}`)
console.log('   🔴 본문 · 제목 · status · gateResults · Post · Comment · Persona 는 바뀌지 않았습니다\n')
await prisma.$disconnect()
process.exit(snap.ok && stampOk ? 0 : 1)
