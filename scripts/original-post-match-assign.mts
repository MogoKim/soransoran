#!/usr/bin/env tsx
/**
 * 매칭 결과 배정 저장 — 🔴 dry-run 이 기본
 *
 * 정본: docs/operations/2026-09-02-original-post-lane-strategy.md §5
 *
 *   … → ⑤ Founder Decision → ⑥ Matching → **배정 저장(여기)** → ⑦ Persona Publish
 *
 * 🔴 **발행하지 않는다.** Post 를 만들지 않고 createdPostId 를 쓰지 않는다.
 *    matchedPersonaId 가 채워져도 글은 나가지 않는다 — 발행 경로는 별도 승인 대상이다.
 *
 * 🔴 **write 는 세 컬럼뿐이다.** matchedPersonaId · matchedAt · matchMeta.
 *    status · createdPostId · 초안 본문 어느 것도 건드리지 않는다.
 *
 * 🔴 **매칭을 여기서 다시 계산하지 않는다.** planBatch 를 부른다 —
 *    두 곳에서 계산하면 저장된 값과 화면의 값이 갈라진다.
 *
 * 🔴 **배정되지 않은 건은 저장하지 않는다.**
 *    "후보 없음" 과 "여력 소진으로 밀림" 은 둘 다 배정이 아니다. 다음 배치가 다시 계산한다.
 *
 * 🔴 dry-run 이 기본이다. 실제 write 는 `--apply` **와** `--limit=N` 이 **둘 다** 있어야 하고,
 *    `--limit` 은 저장 대상 수와 **정확히 같아야** 한다.
 *
 * 사용법
 *   npx tsx scripts/original-post-match-assign.mts                 dry-run
 *   npx tsx scripts/original-post-match-assign.mts --apply --limit=5   🔴 실제 저장
 */
import { PrismaClient, type Prisma } from '@prisma/client'
import {
  planBatch, BLOCK_LABEL,
  type PersonaForMatch, type BatchDraft, type BlockCode, type ChildAgeBand,
} from '../src/lib/original-post-persona-match'
import {
  planStore, assertMatchMeta, assertMatchWrite, RULE_VERSION,
  type QueueStatus,
} from '../src/lib/original-post-match-store'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const limitRaw = argv.find((a) => a.startsWith('--limit='))?.slice(8)
const fail: (m: string) => never = (m) => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }
const kst = (d: Date): string =>
  `${new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')} KST`

await loadEnvLocal()
const prisma = new PrismaClient()

console.log(APPLY ? '\n══ 🔴 실제 저장 (--apply) ══\n' : '\n══ dry-run (DB write 0) ══\n')
console.log(`  규칙 판  ${RULE_VERSION}`)
console.log('  🔴 발행하지 않습니다 · Post 를 만들지 않습니다 · status 를 바꾸지 않습니다\n')

// ── 페르소나 조달 — 🔴 읽기만 한다 ──
const personaRows = await prisma.persona.findMany({
  select: {
    code: true, status: true, identity: true, voiceCore: true, noGoTopics: true,
    user: { select: { providerId: true } },
  },
  orderBy: { code: 'asc' },
})
const WEEK_AGO = new Date(Date.now() - 7 * 864e5)
const personas: PersonaForMatch[] = []
for (const r of personaRows) {
  const id = (r.identity ?? {}) as Record<string, unknown>
  const vc = (r.voiceCore ?? {}) as Record<string, unknown>
  const bands = Array.isArray(id.childrenAgeBands) ? (id.childrenAgeBands as ChildAgeBand[]) : undefined
  // 🔴 주간 여력은 발행 이력(ActivityLog)이 아니라 **이번 주 배정**도 함께 봐야 한다.
  //    아직 발행 경로가 없어 ActivityLog 는 늘 0 이다 — 배정이 소비의 유일한 근거다.
  const postsThisWeek = await prisma.originalPostApprovalQueue.count({
    where: { matchedPersona: { code: r.code }, matchedAt: { gte: WEEK_AGO } },
  })
  const last = await prisma.originalPostApprovalQueue.findFirst({
    where: { matchedPersona: { code: r.code } },
    orderBy: { matchedAt: 'desc' },
    select: { matchedAt: true },
  })
  personas.push({
    code: r.code,
    status: r.status,
    providerId: r.user?.providerId ?? null,
    maritalStatus: typeof id.maritalStatus === 'string' ? id.maritalStatus : null,
    childrenCount: typeof id.childrenCount === 'number' ? id.childrenCount : null,
    ...(bands === undefined ? {} : { childrenAgeBands: bands }),
    parentCare: typeof id.parentCare === 'string' ? id.parentCare : null,
    menopauseStatus: typeof id.menopauseStatus === 'string' ? id.menopauseStatus : null,
    workStatus: null, economicStatus: null, region: null,
    noGoTopics: r.noGoTopics,
    voiceLength: typeof vc.length === 'string' ? vc.length : null,
    postsThisWeek,
    daysSinceLastPost: last?.matchedAt == null ? null : Math.floor((Date.now() - last.matchedAt.getTime()) / 864e5),
  })
}
console.log(`  페르소나 ${personas.length}명 (active ${personas.filter((p) => p.status === 'active').length})`)

// ── 대상 조달 — 🔴 APPROVED · EDITED · createdPostId null ──
const rows = await prisma.originalPostApprovalQueue.findMany({
  where: { status: { in: ['APPROVED', 'EDITED'] }, createdPostId: null },
  select: {
    id: true, status: true, gateVerdict: true, createdAt: true, createdPostId: true,
    draftTitle: true, draftBody: true, editedTitle: true, editedBody: true,
    matchedPersonaId: true,
    rawContent: { select: { sourceArticleId: true } },
  },
  orderBy: { createdAt: 'asc' },
})
console.log(`  대상 ${rows.length}건 (APPROVED · EDITED · 발행 전)\n`)

// 🔴 수정본이 있으면 그것이 발행될 글이다
const drafts: BatchDraft[] = rows.map((r) => ({
  queueId: r.id,
  title: r.editedTitle ?? r.draftTitle,
  body: r.editedBody ?? r.draftBody,
  gateVerdict: r.gateVerdict,
  createdAt: r.createdAt.getTime(),
}))
const batch = planBatch(drafts, personas)
const byId = new Map(batch.assignments.map((a) => [a.queueId, a]))

const save: { id: string; personaCode: string; meta: Extract<ReturnType<typeof planStore>, { ok: true }>['meta'] }[] = []
const skipped: { id: string; reason: string }[] = []

for (const r of rows) {
  const a = byId.get(r.id)!
  const plan = planStore({
    status: r.status as QueueStatus,
    createdPostId: r.createdPostId,
    assigned: a.assigned,
    seed: r.id,
    eligible: a.eligible,
    top: a.top,
    blockedCount: a.blocked.length,
  })
  const head = `  ${r.id}  ${r.rawContent.sourceArticleId}  ${r.status} · gate=${r.gateVerdict}`
  if (plan.ok) {
    save.push({ id: r.id, personaCode: plan.personaCode, meta: plan.meta })
    const alts = a.top.filter((c) => c.code !== plan.personaCode)
    console.log(`  ✅ ${head}`)
    console.log(`       배정 ${plan.personaCode} (${plan.meta.total}점) · 후보 ${plan.meta.eligibleCount}명 · 대체 ${alts.map((c) => c.code).join(' · ') || '(없음)'}`)
    if (r.matchedPersonaId !== null) console.log('       🟡 이미 배정이 있습니다 — 덮어씁니다 (발행 전이므로 허용)')
  } else {
    skipped.push({ id: r.id, reason: plan.reason })
    console.log(`  ⏭️  ${head}\n       ${plan.reason}`)
    for (const b of a.blocked.slice(0, 3)) {
      console.log(`         ⛔ ${b.code}  ${b.reasons.map((x) => BLOCK_LABEL[x.code as BlockCode] ?? x.code).join(' · ')}`)
    }
  }
}

console.log(`\n  저장 대상 ${save.length}건 · 제외 ${skipped.length}건`)
if (save.length > 0) {
  const load = save.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.personaCode]: (acc[s.personaCode] ?? 0) + 1 }), {})
  console.log(`  분산  ${Object.entries(load).sort().map(([k, v]) => `${k} ×${v}`).join(' · ')}`)
}

if (!APPLY) {
  await prisma.$disconnect()
  console.log('\n🟡 dry-run 입니다. DB write 0 · 저장하려면 --apply 와 --limit=N 을 둘 다 붙이세요.\n')
  process.exit(0)
}

const LIMIT = limitRaw === undefined ? null : Number.parseInt(limitRaw, 10)
if (LIMIT === null || !Number.isInteger(LIMIT) || LIMIT < 1) {
  await prisma.$disconnect(); fail('--apply 에는 --limit=N (1 이상) 이 함께 있어야 합니다')
}
// 🔴 개수가 어긋나면 목록이 의도와 다른 것이다. 잘라내지 않고 멈춘다
if (LIMIT !== save.length) {
  await prisma.$disconnect(); fail(`--limit ${LIMIT} 이 저장 대상 ${save.length} 과 다릅니다. 잘라내지 않고 멈춥니다.`)
}

// ── 페르소나 code → id ──
const idByCode = new Map(
  (await prisma.persona.findMany({ select: { id: true, code: true } })).map((p) => [p.code, p.id]),
)

console.log(`\n══ 저장 ${save.length}건 (--limit ${LIMIT}) ══`)
const now = new Date()
let done = 0
let failedCount = 0

for (const s of save) {
  const personaId = idByCode.get(s.personaCode)
  if (personaId === undefined) { failedCount += 1; console.log(`  🔴 ${s.id} — ${s.personaCode} 의 id 를 찾지 못했습니다`); continue }
  // 🔴 저장 직전 한 번 더 본다
  assertMatchMeta(s.meta)
  const data: Record<string, unknown> = { matchedPersonaId: personaId, matchedAt: now, matchMeta: s.meta }
  assertMatchWrite(data)

  // 🔴 조건부 UPDATE — 읽은 뒤 쓰는 사이에 상태가 바뀌었으면 0건이 되어 덮어쓰지 않는다
  const res = await prisma.originalPostApprovalQueue.updateMany({
    where: { id: s.id, status: { in: ['APPROVED', 'EDITED'] }, createdPostId: null },
    data: {
      matchedPersonaId: personaId,
      matchedAt: now,
      matchMeta: s.meta as unknown as Prisma.InputJsonValue,
    },
  })
  if (res.count === 0) { failedCount += 1; console.log(`  🔴 ${s.id} — 그 사이에 상태가 바뀌었습니다 (0건 갱신)`); continue }

  // 🔴 read-back — 쓴 대로 들어갔는지, 그리고 **다른 것이 안 바뀌었는지**
  const after = await prisma.originalPostApprovalQueue.findUniqueOrThrow({
    where: { id: s.id },
    select: {
      status: true, createdPostId: true, matchedAt: true,
      matchedPersona: { select: { code: true } },
      matchMeta: true,
    },
  })
  const problems: string[] = []
  if (after.matchedPersona?.code !== s.personaCode) problems.push(`배정 ${after.matchedPersona?.code ?? '없음'}`)
  if (after.matchedAt === null) problems.push('matchedAt 이 비었다')
  // 🔴 배정이 발행을 만들었다면 그건 사고다
  if (after.createdPostId !== null) problems.push(`🔴 createdPostId 가 생겼다 (${after.createdPostId})`)
  if (!['APPROVED', 'EDITED'].includes(after.status)) problems.push(`🔴 status 가 바뀌었다: ${after.status}`)
  const meta = after.matchMeta as Record<string, unknown> | null
  if (meta === null || meta.ruleVersion !== RULE_VERSION) problems.push(`ruleVersion=${String(meta?.ruleVersion)}`)

  if (problems.length > 0) { failedCount += 1; console.log(`  🔴 ${s.id} — ${problems.join(' · ')}`); continue }
  done += 1
  console.log(`  ✅ ${s.id} → ${s.personaCode} (${s.meta.total}점) · ${kst(now)} · ${RULE_VERSION} · status=${after.status}(불변)`)
}

const total = await prisma.originalPostApprovalQueue.count()
const assigned = await prisma.originalPostApprovalQueue.count({ where: { NOT: { matchedPersonaId: null } } })
const published = await prisma.originalPostApprovalQueue.count({ where: { NOT: { createdPostId: null } } })
await prisma.$disconnect()

console.log(`\n  저장 ${done}건 · 실패 ${failedCount}건`)
console.log(`  대기열 ${total}건 중 배정 ${assigned}건 · 🔴 발행 연결 ${published}건`)
console.log('  🔴 배정은 발행이 아닙니다. 발행 경로는 별도 승인 대상입니다.\n')
process.exit(failedCount === 0 ? 0 : 1)
