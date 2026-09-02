#!/usr/bin/env tsx
/**
 * 오리지널 초안 검수 결정 — 승인 · 폐기 · 수정 후 승인
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §5-2-1 · §12-2
 *
 * 파이프라인에서 이 스크립트가 채우는 자리
 *   [생성] ──▶ [판정 gate] ──▶ [적재 enqueue] ──▶ **[결정]** ──▶ [발행 · 아직 없음]
 *                                                    ↑ 여기
 *
 * 🔴 **발행하지 않는다.** 도달하는 상태는 APPROVED · DECLINED · EDITED 뿐이다.
 *    PUBLISHED 는 이 파일에서 도달할 수 없고, Post 도 만들지 않는다 —
 *    승인은 "발행해도 된다" 는 뜻이지 발행 그 자체가 아니다.
 *    발행 경로는 별도 승인 대상이다.
 *
 * 🔴 **write 대상은 OriginalPostApprovalQueue 한 테이블뿐이다.**
 *    Post · Comment · MicroSeedCandidate · MicroSeedRawContent · Persona ·
 *    PersonaActivityLog 어느 것도 건드리지 않는다. 원문은 읽기만 한다.
 *
 * 🔴 dry-run 이 기본이다. 실제 write 는 `--apply` **와** `--limit=N` 이 **둘 다** 있어야 하고,
 *    `--limit` 은 `--id` 개수와 **정확히 같아야** 한다.
 *    id 를 하나 빠뜨린 채 붙여넣어도 여기서 걸린다 — enqueue 보다 한 칸 강한 지점이다.
 *
 * 🔴 **PENDING 만 결정한다.** 이미 결정된 것을 뒤집으면 decidedAt 이 덮어써져
 *    "언제 누가 정했나" 가 사라진다.
 *
 * 🔴 **수정본도 gate 를 다시 통과해야 한다.** 사람이 고친 글에 원문 20자가 들어갈 수 있다.
 *    BLOCK 이면 저장하지 않는다 — 사람의 손을 거쳤다는 이유로 저장 금지 계약을 우회하지 않는다.
 *
 * 🔴 전이 규칙을 여기서 만들지 않는다. src/lib/original-post-decision.ts 의 순수 함수다 —
 *    DB 없이 fixture 로 전수 검증하기 위해서다.
 *
 * 사용법
 *   npx tsx scripts/original-post-decide.mts --approve --decided-by founder --id <cuid> --id <cuid>
 *       → dry-run. 계획만. DB write 0
 *   npx tsx scripts/original-post-decide.mts --approve --decided-by founder --id <cuid> --apply --limit=1
 *       → 🔴 실제 반영
 *   npx tsx scripts/original-post-decide.mts --decline --reason TITLE_WEAK --decided-by founder --id <cuid>
 *   npx tsx scripts/original-post-decide.mts --edit --edited-file tmp/edit-x.json --decided-by founder --id <cuid>
 *
 *   수정본 파일   { "title": "...", "body": "...", "note": "왜 고쳤나" }
 *   🔴 본문을 CLI 인자로 받지 않는다 — 셸 이력 · 프로세스 목록 · 로그에 남는다
 *
 * 종료 코드: 실패가 하나라도 있으면 1
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync, existsSync } from 'node:fs'
import { readSourceProfile, mustKeepDetails } from './lib/source-profile'
import { analyzeDraft, assertNoStoredSource, toOriginalPostRecord } from './lib/original-post-prompt'
import { gateDraft } from './lib/original-post-gate'
import {
  planDecision, isDeclineReasonCode, isDecidedBy,
  DECLINE_REASONS, DECIDED_BY_VALUES, ORIGINAL_POST_DECISIONS,
  type OriginalPostDecision, type OriginalPostStatus, type EditedDraft,
} from '../src/lib/original-post-decision'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const argv = process.argv.slice(2)

const arg = (k: string): string | undefined => {
  const i = argv.indexOf(`--${k}`)
  if (i !== -1 && argv[i + 1] !== undefined && !argv[i + 1]!.startsWith('--')) return argv[i + 1]
  const eq = argv.find((a) => a.startsWith(`--${k}=`))
  return eq === undefined ? undefined : eq.slice(k.length + 3)
}
/** 🔴 --id 는 여러 번 온다. 목록 파일 · 범위 · --all 은 없다 — 사람이 하나씩 적는다 */
const collect = (k: string): string[] => {
  const out: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!
    if (a === `--${k}`) {
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) out.push(next)
    } else if (a.startsWith(`--${k}=`)) {
      out.push(a.slice(k.length + 3))
    }
  }
  return out
}

const APPLY = argv.includes('--apply')
const LIMIT_RAW = arg('limit')
const IDS = collect('id').map((x) => x.trim()).filter((x) => x !== '')
const DECIDED_BY = (arg('decided-by') ?? '').trim()
const REASON = (arg('reason') ?? '').trim()
const EDITED_FILE = (arg('edited-file') ?? '').trim()

const fail: (m: string) => never = (m) => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }
const mask = (v: string): string => `${v.slice(0, 4)}…${v.slice(-3)}`
/** 🔴 전문을 남기지 않는다 — 첫 글자 + 길이 */
const brief = (v: string): string => {
  const c = [...v.trim()]
  return c.length === 0 ? '(비어 있음)' : `"${c[0]}…" (${c.length}자)`
}
const kst = (d: Date): string =>
  `${new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')} KST`

// ─────────────────────────────────────────────────────────
// ① 인자 검사 — 🔴 DB 를 열기 전에 끝낸다
// ─────────────────────────────────────────────────────────
const chosen = ORIGINAL_POST_DECISIONS.filter((d) => argv.includes(`--${d}`))
if (chosen.length === 0) {
  fail(`결정이 필요합니다: ${ORIGINAL_POST_DECISIONS.map((d) => `--${d}`).join(' · ')}`)
}
if (chosen.length > 1) {
  fail(`결정을 하나만 고르세요. 들어온 것: ${chosen.map((d) => `--${d}`).join(' · ')}`)
}
const DECISION: OriginalPostDecision = chosen[0]!

if (IDS.length === 0) fail('--id <cuid> 가 하나 이상 필요합니다. 어떤 초안인지 모른 채 결정하지 않습니다.')
const dupIds = IDS.filter((x, i) => IDS.indexOf(x) !== i)
if (dupIds.length > 0) fail(`--id 가 중복입니다: ${[...new Set(dupIds)].map(mask).join(' · ')}`)

// 🔴 지어내지 않는다. 스크립트에는 세션이 없으므로 사람이 준다
if (DECIDED_BY === '') fail(`--decided-by 가 필요합니다 (${DECIDED_BY_VALUES.join(' · ')})`)
if (!isDecidedBy(DECIDED_BY)) {
  fail(`--decided-by 값이 목록에 없습니다: "${DECIDED_BY}" — 허용 ${DECIDED_BY_VALUES.join(' · ')}`)
}

if (DECISION === 'decline') {
  if (REASON === '') {
    fail(`--reason <CODE> 가 필요합니다.\n     ${DECLINE_REASONS.map((r) => `${r.code} — ${r.label}`).join('\n     ')}`)
  }
  // 🔴 자유 텍스트를 허용하면 집계가 무너진다
  if (!isDeclineReasonCode(REASON)) {
    fail(`알 수 없는 폐기 사유입니다: "${REASON}"\n     허용 ${DECLINE_REASONS.map((r) => r.code).join(' · ')}`)
  }
} else if (REASON !== '') {
  fail(`--reason 은 --decline 에만 씁니다 (현재 --${DECISION}).`)
}

let editedInput: EditedDraft | null = null
if (DECISION === 'edit') {
  // 🔴 수정본 하나에 대상 하나다. 한 파일을 여러 초안에 덮어쓰지 않는다
  if (IDS.length !== 1) fail(`--edit 은 --id 를 하나만 받습니다 (들어온 것 ${IDS.length}개).`)
  if (EDITED_FILE === '') fail('--edited-file <path> 가 필요합니다. 🔴 본문을 CLI 인자로 받지 않습니다.')
  if (!existsSync(EDITED_FILE)) fail(`수정본 파일이 없습니다: ${EDITED_FILE}`)
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(EDITED_FILE, 'utf-8'))
  } catch {
    fail(`수정본 파일을 읽지 못했습니다 (JSON 아님): ${EDITED_FILE}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    fail('수정본 파일은 { "title", "body", "note" } 객체여야 합니다.')
  }
  const o = parsed as Record<string, unknown>
  for (const k of ['title', 'body', 'note']) {
    if (typeof o[k] !== 'string') fail(`수정본 파일에 문자열 "${k}" 가 없습니다.`)
  }
  editedInput = { title: o.title as string, body: o.body as string, note: o.note as string }
} else if (EDITED_FILE !== '') {
  fail(`--edited-file 은 --edit 에만 씁니다 (현재 --${DECISION}).`)
}

await loadEnvLocal()
const prisma = new PrismaClient()

console.log(APPLY ? '\n══ 🔴 실제 반영 (--apply) ══\n' : '\n══ dry-run (DB write 0) ══\n')
console.log(`  결정    --${DECISION}${DECISION === 'decline' ? ` · 사유 ${REASON}` : ''}`)
console.log(`  결정자  ${DECIDED_BY}`)
console.log(`  대상    ${IDS.length}건`)
if (editedInput !== null) {
  console.log(`  수정본  ${EDITED_FILE} · 제목 ${brief(editedInput.title)} · 본문 ${brief(editedInput.body)}`)
}
console.log('  🔴 발행하지 않습니다 · Post 를 만들지 않습니다\n')

// ─────────────────────────────────────────────────────────
// ② 대상 조달 — 🔴 읽기만 한다
// ─────────────────────────────────────────────────────────
const rows = await prisma.originalPostApprovalQueue.findMany({
  where: { id: { in: IDS } },
  select: {
    id: true, status: true, createdPostId: true, gateVerdict: true,
    draftTitle: true, draftBody: true, sourceRawContentId: true,
    decidedBy: true, decidedAt: true,
  },
})
const byId = new Map(rows.map((r) => [r.id, r]))
const missing = IDS.filter((id) => !byId.has(id))
if (missing.length > 0) {
  await prisma.$disconnect()
  fail(`대기열에서 찾지 못한 id 가 ${missing.length}건 있습니다: ${missing.map(mask).join(' · ')}`)
}

// ─────────────────────────────────────────────────────────
// ③ 수정본 gate 재판정 — 🔴 사람이 고쳤어도 다시 본다
// ─────────────────────────────────────────────────────────
if (editedInput !== null) {
  const row = byId.get(IDS[0]!)!
  const raw = await prisma.microSeedRawContent.findUnique({
    where: { id: row.sourceRawContentId },
    select: { rawTitle: true, rawBody: true, sourceArticleId: true },
  })
  if (raw === null) {
    await prisma.$disconnect()
    fail('원문을 찾지 못했습니다 — 수정본을 판정할 수 없습니다.')
  }
  const profile = readSourceProfile({ rawTitle: raw.rawTitle, rawBody: raw.rawBody })
  const signals = analyzeDraft({
    title: editedInput.title, body: editedInput.body,
    sourceTexts: [raw.rawTitle, raw.rawBody],
    allowedContentUrl: profile.contentReferenceUrl,
    closingIntent: profile.closingIntent,
    allowNumberedList: profile.preserveStructure.numberedList,
  })
  const must = mustKeepDetails(profile.concreteDetailsToKeep)
  const both = `${editedInput.title}\n${editedInput.body}`
  const gate = gateDraft({
    signals, closingIntent: profile.closingIntent,
    sourceBodyLength: [...raw.rawBody].length,
    mustKeepTotal: must.length,
    mustKeepFound: must.filter((x) => both.includes(x.sample)).length,
  })
  // 🔴 사유 코드만 찍는다. detail 에 원문 조각이 섞일 수 있다
  const codes = [...gate.blocks, ...gate.holds].map((f) => f.code)
  console.log(`  수정본 재판정  ${gate.verdict}${codes.length === 0 ? '' : ` — ${codes.join(' · ')}`}`)

  if (gate.verdict === 'BLOCK') {
    await prisma.$disconnect()
    fail(
      `수정본이 BLOCK 입니다 (${gate.blocks.map((b) => b.code).join(' · ')}).\n` +
        '     저장하지 않습니다 — 사람이 고쳤다는 이유로 저장 금지 계약을 우회하지 않습니다.',
    )
  }
  // 🔴 저장 직전 실측 방어. 원문 조각이 든 레코드를 DB 에 남기지 않는다
  try {
    assertNoStoredSource(
      [toOriginalPostRecord({
        sourceRawContentId: row.sourceRawContentId,
        title: editedInput.title,
        body: editedInput.body,
      })],
      [raw.rawTitle, raw.rawBody],
      profile.contentReferenceUrl === null ? [] : [profile.contentReferenceUrl],
    )
  } catch (e) {
    await prisma.$disconnect()
    fail(`수정본에 원문 조각이 있습니다: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`)
  }
  console.log('')
}

// ─────────────────────────────────────────────────────────
// ④ 계획 — 🔴 규칙은 순수 함수가 정한다
// ─────────────────────────────────────────────────────────
type Planned = { id: string; plan: ReturnType<typeof planDecision> }
const planned: Planned[] = IDS.map((id) => {
  const row = byId.get(id)!
  return {
    id,
    plan: planDecision({
      status: row.status as OriginalPostStatus,
      createdPostId: row.createdPostId,
      draftTitle: row.draftTitle,
      draftBody: row.draftBody,
      decision: DECISION,
      ...(DECISION === 'decline' ? { declineReason: REASON } : {}),
      ...(DECISION === 'edit' ? { edited: editedInput } : {}),
    }),
  }
})

for (const p of planned) {
  const row = byId.get(p.id)!
  const head = `  ${p.plan.ok ? '✅' : '⛔'} ${p.id} · ${row.status} · gate=${row.gateVerdict} · 제목 ${brief(row.draftTitle)}`
  if (p.plan.ok) {
    const extra = p.plan.editDiff === null
      ? ''
      : ` · 제목변경 ${p.plan.editDiff.titleChanged ? 'Y' : 'N'} · 본문변경 ${p.plan.editDiff.bodyChanged ? 'Y' : 'N'} · ${p.plan.editDiff.charDelta >= 0 ? '+' : ''}${p.plan.editDiff.charDelta}자`
    console.log(`${head}\n       → ${p.plan.nextStatus}${p.plan.declineReason === null ? '' : ` (${p.plan.declineReason})`}${extra}`)
  } else {
    console.log(`${head}\n       🔴 ${p.plan.error}`)
  }
}

const okPlans = planned.filter((p) => p.plan.ok)
const badPlans = planned.filter((p) => !p.plan.ok)
console.log(`\n  가능 ${okPlans.length}건 · 불가 ${badPlans.length}건`)

// 🔴 하나라도 불가면 아무것도 쓰지 않는다. 사람이 준 목록이 이미 어긋난 것이다
if (badPlans.length > 0) {
  await prisma.$disconnect()
  console.log('\n🔴 결정할 수 없는 건이 있습니다. 아무것도 쓰지 않았습니다 — 목록을 고쳐 다시 부르세요.\n')
  process.exit(1)
}

// ─────────────────────────────────────────────────────────
// ⑤ 🔴 --apply --limit 둘 다 있어야 쓴다
// ─────────────────────────────────────────────────────────
if (!APPLY) {
  await prisma.$disconnect()
  console.log('\n🟡 dry-run 입니다. DB write 0 · 반영하려면 --apply 와 --limit=N 을 둘 다 붙이세요.\n')
  process.exit(0)
}
const LIMIT = LIMIT_RAW === undefined ? null : Number.parseInt(LIMIT_RAW, 10)
if (LIMIT === null || !Number.isInteger(LIMIT) || LIMIT < 1) {
  await prisma.$disconnect()
  fail('--apply 에는 --limit=N (1 이상) 이 함께 있어야 합니다')
}
// 🔴 개수가 어긋나면 목록이 의도와 다른 것이다. 잘라내지 않고 멈춘다
if (LIMIT !== IDS.length) {
  await prisma.$disconnect()
  fail(`--limit ${LIMIT} 이 --id 개수 ${IDS.length} 와 다릅니다. 잘라내지 않고 멈춥니다.`)
}

console.log(`\n══ 반영 ${okPlans.length}건 (--limit ${LIMIT}) ══`)
const decidedAt = new Date()
let done = 0
let failedCount = 0

for (const p of okPlans) {
  if (!p.plan.ok) continue // 타입 좁히기용 — 위에서 이미 걸렀다
  const { nextStatus, declineReason, edited, editDiff } = p.plan
  // 🔴 조건부 UPDATE 다. 읽은 뒤 쓰는 사이에 다른 세션이 먼저 결정했으면
  //    여기서 0건이 되어 덮어쓰지 않는다 — PENDING · createdPostId null 을 WHERE 에 넣는 이유다
  // 🔴 수정본은 셋이 한 벌이다. 하나라도 없으면 아예 넣지 않는다
  const editPatch = edited === null || editDiff === null
    ? {}
    : { editedTitle: edited.title, editedBody: edited.body, editDiff: { ...editDiff } }
  const res = await prisma.originalPostApprovalQueue.updateMany({
    where: { id: p.id, status: 'PENDING', createdPostId: null },
    data: {
      status: nextStatus,
      declineReason,
      decidedBy: DECIDED_BY,
      decidedAt,
      ...editPatch,
    },
  })
  if (res.count === 0) {
    failedCount += 1
    console.log(`  🔴 ${p.id} — 이미 처리되었거나 발행되었습니다 (0건 갱신)`)
    continue
  }

  // 🔴 read-back. 쓴 대로 들어갔는지 다시 본다
  const after = await prisma.originalPostApprovalQueue.findUniqueOrThrow({
    where: { id: p.id },
    select: {
      status: true, decidedBy: true, decidedAt: true, declineReason: true,
      createdPostId: true, editedTitle: true, editedBody: true,
    },
  })
  const problems: string[] = []
  if (after.status !== nextStatus) problems.push(`status=${after.status} (기대 ${nextStatus})`)
  if (after.decidedBy !== DECIDED_BY) problems.push(`decidedBy=${after.decidedBy}`)
  if (after.decidedAt === null) problems.push('decidedAt 이 비어 있다')
  if (after.declineReason !== declineReason) problems.push(`declineReason=${after.declineReason}`)
  // 🔴 결정 경로가 발행을 만들었다면 그건 사고다
  if (after.createdPostId !== null) problems.push(`🔴 createdPostId 가 생겼다 (${after.createdPostId})`)
  if (edited !== null && (after.editedTitle === null || after.editedBody === null)) {
    problems.push('수정본이 저장되지 않았다')
  }
  if (edited === null && (after.editedTitle !== null || after.editedBody !== null)) {
    problems.push('🔴 수정본이 아닌데 editedTitle/Body 가 채워졌다')
  }

  if (problems.length > 0) {
    failedCount += 1
    console.log(`  🔴 ${p.id} — read-back 불일치: ${problems.join(' · ')}`)
    continue
  }
  done += 1
  console.log(`  ✅ ${p.id} → ${after.status}${after.declineReason === null ? '' : ` (${after.declineReason})`} · ${DECIDED_BY} · ${kst(decidedAt)}`)
}

// ─────────────────────────────────────────────────────────
// ⑥ 결산
// ─────────────────────────────────────────────────────────
const counts = await prisma.originalPostApprovalQueue.groupBy({ by: ['status'], _count: true })
const published = await prisma.originalPostApprovalQueue.count({ where: { NOT: { createdPostId: null } } })
await prisma.$disconnect()

console.log(`\n  반영 ${done}건 · 실패 ${failedCount}건`)
console.log(`  대기열 ${counts.map((c) => `${c.status} ${c._count}`).join(' · ')}`)
console.log(`  🔴 발행 연결(createdPostId) ${published}건 — 결정 경로는 발행하지 않습니다`)
console.log('  🔴 승인은 발행이 아닙니다. 발행 경로는 별도 승인 대상입니다.\n')

process.exit(failedCount === 0 ? 0 : 1)
