#!/usr/bin/env tsx
/**
 * 자동 발행 러너 — 🔴 **기본 dry-run. 실제 실행은 되돌릴 수 없다** (§4-AL)
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AL
 *
 * 파이프라인에서 이 스크립트가 채우는 자리
 *   [발행 후보 파일] → [브리지] → 대기열(PENDING) → [사람 승인] → APPROVED
 *                                                    → **[여기] 배정 + 발행**
 *
 * 🔴 **사람이 매일 queue id 를 고르지 않아도 되게 하는 것**이 이 러너의 목적이다.
 *    그렇다고 아무거나 내지는 않는다 — 대상 조건 일곱 개를 전부 통과한
 *    **정확히 1건**일 때만 돈다(§4-AL ③).
 *
 * 🔴 **legacy 글은 절대 대상이 아니다.** 같은 대기열에 다른 레인이 만든 글이 산다.
 *    `promptVersion=publish-candidate-v1` · `model=human-curated` 로 못박는 이유다 —
 *    2026-09-06 에 그 구분이 없어 내용 모르는 글 둘이 발행 직전까지 갔다.
 *
 * 🔴 **하지 않는 것**
 *    상수 변경(DAILY_PUBLISH_CAP · POST_CAP_PER_WEEK · MIN_DAYS_BETWEEN_POSTS) ·
 *    Raw SQL · LLM · 네이버 접속 · Google Sheet · 마이그레이션 ·
 *    legacy 후보 발행 · 후보가 1건이 아닐 때의 발행.
 *
 * 사용법
 *   npx tsx scripts/original-post-auto-publish.mts                # dry-run
 *   npx tsx scripts/original-post-auto-publish.mts --apply --limit=1   🔴 실제 발행
 */
import { PrismaClient } from '@prisma/client'
import {
  selectAutoTargets, judgeApply, verifyAfterPublish, REJECT_LABEL,
  AUTO_PROMPT_VERSION, AUTO_MODEL, AUTO_SITE_PREFIX, AUTO_GATE_VERDICT,
  type AutoRow,
} from '../src/lib/original-post-auto-publish'
import { safetyFilter } from './lib/micro-seed-safety-filter.mjs'
import { planBatch, POST_CAP_PER_WEEK, MIN_DAYS_BETWEEN_POSTS } from '../src/lib/original-post-persona-match'
import { planStore } from '../src/lib/original-post-match-store'
import { DAILY_PUBLISH_CAP } from '../src/lib/original-post-publish'
import { publishOriginalPostTx } from '../src/lib/original-post-publish-tx'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const limitRaw = argv.find((a) => a.startsWith('--limit='))?.slice(8)
const LIMIT = limitRaw === undefined ? null : Number.parseInt(limitRaw, 10)
const fail: (m: string) => never = (m) => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }
const kst = (d: Date): string =>
  `${new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')} KST`
/** 🔴 전문을 남기지 않는다 — 앞부분 + 길이 */
const brief = (v: string): string => `"${[...v][0] ?? ''}…" (${[...v].length}자)`

await loadEnvLocal()
const prisma = new PrismaClient()

console.log(APPLY ? '\n══ 🔴 실제 발행 (--apply) ══\n' : '\n══ dry-run (DB write 0 · Post 0) ══\n')
console.log(`  대상 조건  gate=${AUTO_GATE_VERDICT} · ${AUTO_PROMPT_VERSION} / ${AUTO_MODEL} · ${AUTO_SITE_PREFIX}*`)
console.log(`  상수      일 ${DAILY_PUBLISH_CAP}건 · persona 주 ${POST_CAP_PER_WEEK}건 · 최소 ${MIN_DAYS_BETWEEN_POSTS}일`)
console.log('  🔴 이 러너는 상수를 바꾸지 않는다\n')

// ── ① 후보 수집 — 🔴 읽기만 한다 ──
const raw = await prisma.originalPostApprovalQueue.findMany({
  where: { status: { in: ['APPROVED', 'EDITED'] }, createdPostId: null },
  select: {
    id: true, status: true, createdPostId: true, gateVerdict: true,
    promptVersion: true, model: true, matchedPersonaId: true,
    draftTitle: true, draftBody: true, editedTitle: true, editedBody: true,
    rawContent: { select: { sourceSite: true } },
  },
  orderBy: { createdAt: 'asc' },
})
const rows: AutoRow[] = raw.map((r) => ({
  id: r.id, status: r.status, createdPostId: r.createdPostId, gateVerdict: r.gateVerdict,
  promptVersion: r.promptVersion, model: r.model, matchedPersonaId: r.matchedPersonaId,
  // 🔴 수정본이 있으면 그것이 발행될 글이다
  title: r.editedTitle ?? r.draftTitle,
  body: r.editedBody ?? r.draftBody,
  sourceSite: r.rawContent.sourceSite,
}))

// ── ② 안전 재판정 — 🔴 저장된 값을 믿지 않는다 ──
const { targets, rejected } = selectAutoTargets(rows, (t, b) => safetyFilter({ title: t, body: b }).verdict)

console.log(`① 대기열 ${rows.length}건 → 자동 발행 후보 ${targets.length}건`)
for (const t of targets) {
  console.log(`  🎯 ${t.id}`)
  console.log(`     제목 ${brief(t.title)} · 본문 ${[...t.body].length}자 · ${t.sourceSite}`)
}
if (rejected.length > 0) {
  const by = new Map<string, number>()
  for (const r of rejected) by.set(r.code, (by.get(r.code) ?? 0) + 1)
  console.log(`\n② 제외 ${rejected.length}건 — 🔴 legacy 글이 섞이지 않는다`)
  for (const [code, n] of [...by].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(2)}건  ${REJECT_LABEL[code as keyof typeof REJECT_LABEL]}`)
  }
}

// ── ③ persona 배정 가능성 ──
const WEEK_AGO = new Date(Date.now() - 7 * 864e5)
const personaRows = await prisma.persona.findMany({
  where: { status: 'active' },
  select: { id: true, code: true, status: true, identity: true, voiceCore: true, noGoTopics: true,
            user: { select: { providerId: true } } },
})
const personas = []
for (const r of personaRows) {
  const id = (r.identity ?? {}) as Record<string, unknown>
  const vc = (r.voiceCore ?? {}) as Record<string, unknown>
  const postsThisWeek = await prisma.originalPostApprovalQueue.count({
    where: { matchedPersona: { code: r.code }, matchedAt: { gte: WEEK_AGO } },
  })
  const last = await prisma.originalPostApprovalQueue.findFirst({
    where: { matchedPersona: { code: r.code } }, orderBy: { matchedAt: 'desc' }, select: { matchedAt: true },
  })
  personas.push({
    code: r.code, status: r.status,
    // 🔴 실계정이 붙은 페르소나는 쓰지 않는다 (REAL_MEMBER 차단의 입력)
    providerId: r.user?.providerId ?? null,
    ageBand: typeof id.ageBand === 'string' ? id.ageBand : null,
    maritalStatus: typeof id.maritalStatus === 'string' ? id.maritalStatus : null,
    ...(Array.isArray(id.childrenAgeBands) ? { childrenAgeBands: id.childrenAgeBands as never } : {}),
    parentCare: typeof id.parentCare === 'string' ? id.parentCare : null,
    menopauseStatus: typeof id.menopauseStatus === 'string' ? id.menopauseStatus : null,
    workStatus: null, economicStatus: null, region: null,
    noGoTopics: r.noGoTopics,
    voiceLength: typeof vc.length === 'string' ? vc.length : null,
    postsThisWeek,
    daysSinceLastPost: last?.matchedAt == null ? null : Math.floor((Date.now() - last.matchedAt.getTime()) / 864e5),
  })
}
// 🔴 후보만 넣어 계산한다 — legacy 글이 여력을 가져가면 안 된다
const batch = planBatch(
  targets.map((t) => ({ queueId: t.id, title: t.title, body: t.body, gateVerdict: t.gateVerdict, createdAt: 0 })),
  personas,
)
const assignOf = new Map(batch.assignments.map((a) => [a.queueId, a]))

console.log(`\n③ persona 배정 가능성 (active ${personas.length}명)`)
for (const t of targets) {
  if (t.matchedPersonaId !== null) { console.log(`   ${t.id} — 이미 배정돼 있다`); continue }
  const a = assignOf.get(t.id)
  const plan = planStore({
    status: t.status as never, createdPostId: t.createdPostId,
    // 🔴 seed 는 queue id 다 — match-assign 과 같아야 같은 결과가 나온다
    seed: t.id,
    assigned: a?.assigned ?? null, eligible: a?.eligible ?? [], top: a?.top ?? [], blockedCount: a?.blocked.length ?? 0,
  })
  console.log(plan.ok
    ? `   ${t.id} → ${plan.personaCode} (${plan.meta.total}점)`
    : `   ${t.id} — 🔴 ${plan.reason}`)
}

// ── ④ 오늘 상황 ──
const dayStart = new Date(); dayStart.setUTCHours(-9, 0, 0, 0)
const publishedToday = await prisma.personaActivityLog.count({ where: { kind: 'post', createdAt: { gte: dayStart } } })
const sw = await prisma.personaGlobalSwitch.findUnique({ where: { id: 'global' }, select: { enabled: true } })
const killed = sw?.enabled === true
console.log(`\n④ 오늘(${kst(new Date())}) 발행 ${publishedToday} / ${DAILY_PUBLISH_CAP}건 · 전체 중지 ${killed ? '🔴 켜짐' : '꺼짐'}`)

// ── ⑤ 실행 판정 ──
const gate = judgeApply({ targets, apply: APPLY, limit: LIMIT, publishedToday, dailyCap: DAILY_PUBLISH_CAP, killSwitchEnabled: killed })
if (!gate.ok) {
  console.log(`\n⑤ 발행하지 않는다 — ${gate.reason}`)
  if (!APPLY) console.log('   🟡 dry-run 입니다. DB write 0 · Post 0 · 실행하려면 --apply 와 --limit=1 을 둘 다 붙이세요.')
  console.log()
  await prisma.$disconnect()
  process.exit(0)
}

const target = gate.target
console.log(`\n⑤ 🔴 실행 — ${target.id}`)

// ── ⑥ 배정 (없을 때만) ──
if (target.matchedPersonaId === null) {
  const a = assignOf.get(target.id)
  const plan = planStore({
    status: target.status as never, createdPostId: target.createdPostId,
    seed: target.id,
    assigned: a?.assigned ?? null, eligible: a?.eligible ?? [], top: a?.top ?? [], blockedCount: a?.blocked.length ?? 0,
  })
  if (!plan.ok) { await prisma.$disconnect(); fail(`배정할 수 없습니다 — ${plan.reason}`) }
  const persona = await prisma.persona.findUniqueOrThrow({ where: { code: plan.personaCode }, select: { id: true } })
  // 🔴 조건부 UPDATE — 읽은 뒤 쓰는 사이에 누가 배정했으면 0건이 되어 멈춘다
  const u = await prisma.originalPostApprovalQueue.updateMany({
    where: { id: target.id, status: { in: ['APPROVED', 'EDITED'] }, createdPostId: null, matchedPersonaId: null },
    data: { matchedPersonaId: persona.id, matchedAt: new Date(), matchMeta: plan.meta as never },
  })
  if (u.count !== 1) { await prisma.$disconnect(); fail('배정 중 상태가 바뀌었습니다. 아무것도 발행하지 않았습니다.') }
  console.log(`   ✅ 배정 ${plan.personaCode} (${plan.meta.total}점)`)
}

// ── ⑦ 발행 — 🔴 되돌릴 수 없다 ──
const res = await publishOriginalPostTx(prisma, { queueId: target.id, publishedToday })
if (res.kind !== 'published') {
  await prisma.$disconnect()
  fail(res.kind === 'blocked' ? `발행이 막혔습니다 — ${res.code} · ${res.detail}` : `발행 오류 — ${res.message}`)
}
console.log(`   ✅ Post ${res.postId} · ${res.personaCode} · ${res.boardType}`)
console.log(`   https://soransoran.com/community/free/${res.postId}`)
console.log('   🔴 이 글은 검색에 노출됩니다 — sitemap 에 실립니다')

// ── ⑧ 정합 확인 ──
const after = await prisma.originalPostApprovalQueue.findUniqueOrThrow({
  where: { id: target.id }, select: { status: true, createdPostId: true, matchedPersona: { select: { id: true } } },
})
const postExists = after.createdPostId !== null
  && (await prisma.post.count({ where: { id: after.createdPostId } })) === 1
const logCount = await prisma.personaActivityLog.count({
  where: { personaId: after.matchedPersona?.id, kind: 'post', createdAt: { gte: dayStart } },
})
const v = verifyAfterPublish({
  queueStatus: after.status, createdPostId: after.createdPostId, postExists, activityLogCount: logCount,
})
console.log(`\n⑥ 정합 ${v.ok ? '✅ 통과' : '🔴 이상'}`)
for (const p of v.problems) console.log(`   🔴 ${p}`)
console.log(`   Queue ${after.status} · createdPostId ${after.createdPostId} · ActivityLog ${logCount}건`)
console.log('\n   🔴 되돌리려면 내리는 것(status=HIDDEN)이지 없던 일이 되지 않습니다.\n')

await prisma.$disconnect()
process.exit(v.ok ? 0 : 1)
