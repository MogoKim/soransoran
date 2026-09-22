/**
 * 🔴 **자동이 정한 글을 되짚은 결과를 남긴다** (기본 read-only).
 *
 *   `auditPicks` 가 뽑은 20% 는 발행 러너가 각 행의 `editDiff.audit` 에 표시해 둔다.
 *   이 명령은 그 목록을 보여 주고, 사람이 본 결과를 **값으로** 적는다.
 *
 * 🔴 **보지 않은 것은 결함 0 이 아니다.** 대기가 하나라도 남아 있으면
 *    `judgeAuditGate` 가 자동을 닫는다 — 뽑아만 놓고 아무도 보지 않는 상태로
 *    자동이 계속 도는 일을 막는다.
 *
 *   보기      npm run auto-ready-audit
 *   기록      npm run auto-ready-audit -- --id=<큐id> --defect=yes|no --note="..." --apply
 */
import { PrismaClient } from '@prisma/client'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import {
  auditStateOf, judgeAuditGate, readAuditRecord, readAutoReadyStamp,
  AUDIT_RECORD_KEY, AUTO_DECIDER,
} from '../src/lib/auto-ready'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const ID = (argv.find((a) => a.startsWith('--id='))?.slice(5) ?? '').trim()
const DEFECT_RAW = (argv.find((a) => a.startsWith('--defect='))?.slice(9) ?? '').trim()
const NOTE = (argv.find((a) => a.startsWith('--note='))?.slice(7) ?? '').trim()

const fail: (m: string) => never = (m) => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }

/** 🔴 `yes`/`no` 만 받는다 — 빈 값이나 오타를 "결함 없음" 으로 읽지 않는다 */
const DEFECT: boolean | undefined =
  DEFECT_RAW === 'yes' ? true : DEFECT_RAW === 'no' ? false : undefined
if (DEFECT_RAW !== '' && DEFECT === undefined) fail(`--defect 는 yes 또는 no 입니다 — 받은 값: ${DEFECT_RAW}`)
if (APPLY && (ID === '' || DEFECT === undefined)) fail('--apply 에는 --id 와 --defect=yes|no 가 둘 다 필요합니다.')

await loadEnvLocal()
const prisma = new PrismaClient()

const rows = await prisma.originalPostApprovalQueue.findMany({
  where: { decidedBy: AUTO_DECIDER },
  select: {
    id: true, editDiff: true, createdPostId: true, draftTitle: true, draftBody: true,
    editedTitle: true, editedBody: true, decidedAt: true,
  },
  orderBy: { decidedAt: 'asc' },
})

console.log(APPLY ? '\n══ 🔴 감사 결과 기록 (--apply) ══\n' : '\n══ 자동 READY 사후 감사 (read-only · DB write 0) ══\n')

const state = auditStateOf(rows)
const gate = judgeAuditGate(state)
console.log(`  자동 판정 ${state.autoDecided}건 · 감사 대상 ${state.picked}건`
  + ` · 확인 ${state.reviewed}건 · 결함 ${state.defects}건 · 🔴 대기 ${state.pending}건`)
console.log(`  자동 READY 에 대한 감사 판정: ${gate.open ? '통과' : '🔴 닫힘'} — ${gate.reason}\n`)

const picked = rows.filter((r) => readAuditRecord(r.editDiff) !== null)
if (picked.length > 0) {
  console.log('  ── 감사 대상 ──')
  for (const r of picked) {
    const rec = readAuditRecord(r.editDiff)!
    const mark = rec.defect === undefined ? '⏳ 미확인' : rec.defect ? '🔴 결함' : '✅ 이상 없음'
    console.log(`   ${mark}  ${r.id} · ${rec.pickedOn} · ${r.createdPostId === null ? '미발행' : `Post ${r.createdPostId}`}`)
    console.log(`            ${(r.editedTitle ?? r.draftTitle).slice(0, 44)}`)
    if (rec.note !== undefined) console.log(`            메모: ${rec.note}`)
  }
  console.log()
}

if (!APPLY) {
  if (ID !== '') {
    const t = rows.find((r) => r.id === ID)
    if (t === undefined) { await prisma.$disconnect(); fail(`그 행은 자동 판정 목록에 없습니다 — ${ID}`) }
    const stamp = readAutoReadyStamp(t.editDiff)
    console.log(`  ── ${ID} 전문 ──`)
    console.log(`  도장 본문 판 ${stamp?.bodyVersion ?? '(없음)'} · 열린 사유 ${stamp?.openReason ?? '—'}`)
    console.log(`\n  제목: ${t.editedTitle ?? t.draftTitle}\n`)
    console.log((t.editedBody ?? t.draftBody).split('\n').map((l) => `  ${l}`).join('\n'))
    console.log()
  }
  console.log('  🟡 read-only 입니다. 기록하려면 --id 와 --defect=yes|no 와 --apply 를 붙이세요.\n')
  await prisma.$disconnect()
  process.exit(0)
}

const target = rows.find((r) => r.id === ID)
if (target === undefined) { await prisma.$disconnect(); fail(`그 행은 자동 판정 목록에 없습니다 — ${ID}`) }
const rec = readAuditRecord(target.editDiff)
if (rec === null) { await prisma.$disconnect(); fail('그 행은 감사 대상으로 뽑히지 않았습니다.') }

const base = (target.editDiff !== null && typeof target.editDiff === 'object')
  ? target.editDiff as Record<string, unknown> : {}
// 🔴 조건부 UPDATE — 그 사이 행이 바뀌었으면 0건이 되어 아무것도 쓰지 않는다
const u = await prisma.originalPostApprovalQueue.updateMany({
  where: { id: ID, decidedBy: AUTO_DECIDER },
  data: {
    editDiff: {
      ...base,
      [AUDIT_RECORD_KEY]: { ...rec, defect: DEFECT, ...(NOTE === '' ? {} : { note: NOTE }) },
    } as never,
  },
})
if (u.count !== 1) { await prisma.$disconnect(); fail('그 사이 행이 바뀌었습니다. 아무것도 쓰지 않았습니다.') }
console.log(`  ✅ ${ID} · 결함 ${DEFECT ? 'yes' : 'no'}${NOTE === '' ? '' : ` · ${NOTE}`}`)

const after = auditStateOf(await prisma.originalPostApprovalQueue.findMany({
  where: { decidedBy: AUTO_DECIDER }, select: { id: true, editDiff: true },
}))
const g2 = judgeAuditGate(after)
console.log(`  기록 뒤 감사 판정: ${g2.open ? '통과' : '🔴 닫힘'} — ${g2.reason}`)
console.log('  🔴 결함이 나오면 비율을 줄이지 않고 자동을 닫는다 — 다음 회차부터 도장 0건이다\n')

await prisma.$disconnect()
