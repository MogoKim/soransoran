/**
 * 🔴 **한 스냅샷에서 9/22 실적 → 9/23 → 9/24 를 순서대로 낸다** (read-only · write 0).
 *
 *   앞 보고에서 9/24 예측이 3/5 → 0/5 로 바뀐 이유를 설명 없이 넘겼다. 그 원인은
 *   **9/23 소비를 빼지 않았다가 뺐기 때문**인데, 표만 바꾸면 그 사실이 보이지 않는다.
 *   그래서 날짜를 순서대로 소비해 가며 **행마다 화자와 제외 사유**를 찍는다.
 *
 * 🔴 **후보와 READY 를 섞지 않는다.** 여기서 세는 것은 `decidedBy` 가 사람·자동인
 *    행뿐이다. 오늘 21:15 에 들어온 P11 같은 새 후보는 READY 가 아니라 후보다.
 */
import { PrismaClient } from '@prisma/client'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { MACHINE_SITE_PREFIX } from '../src/lib/micro-seed-supply-autofill'
import { selectAutoTargets, REJECT_LABEL, voiceInputOf, type AutoRow } from '../src/lib/original-post-auto-publish'
import { safetyFilter } from './lib/micro-seed-safety-filter.mjs'
import { PROFILES, RELEASE_STAGES, effectiveWeeklyCap, type ReleaseStage } from '../src/lib/scale-profile'
import { planBatch } from '../src/lib/original-post-persona-match'
import { canaryAuthorization, windowAuthorization } from '../src/lib/release-canary'
import { installFromEnv } from '../src/lib/scale-runtime'
import { HUMAN_DECIDER, AUTO_DECIDER } from '../src/lib/auto-ready'

await loadEnvLocal()
const prisma = new PrismaClient()

const SNAPSHOT = new Date()
const kst = (d: Date) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')
console.log(`\n══ 공급 예측 (스냅샷 ${kst(SNAPSHOT)} KST · read-only) ══\n`)

// ── 9/22 실적은 고정한다 ──
const dayStart = new Date('2026-09-21T15:00:00Z')
const published = await prisma.post.findMany({
  where: { createdAt: { gte: dayStart } },
  select: { id: true, title: true, createdAt: true },
  orderBy: { createdAt: 'asc' },
})
console.log(`① 9/22 실제 발행 ${published.length}건 — 고정값이다`)
for (const p of published) console.log(`   ${kst(p.createdAt)}  ${p.title.slice(0, 34)}`)

// ── READY 재고 ──
const rows = await prisma.originalPostApprovalQueue.findMany({
  where: {
    createdPostId: null,
    status: { in: ['APPROVED', 'EDITED'] },
    decidedBy: { in: [HUMAN_DECIDER, AUTO_DECIDER] },
  },
  select: {
    id: true, decidedBy: true, gateVerdict: true, gateResults: true, matchedPersonaId: true,
    draftTitle: true, draftBody: true, editedTitle: true, editedBody: true,
    promptVersion: true, model: true, status: true, createdPostId: true,
    decidedAt: true, createdAt: true,
    rawContent: { select: { sourceSite: true, sourceCapturedAt: true } },
  },
  orderBy: { createdAt: 'asc' },
})
const speakerOf = (g: unknown): string => {
  const v = (g as Record<string, Record<string, Record<string, unknown>>>)?.autoDraft?.voice?.personaCode
  return typeof v === 'string' ? v : '(사람 후보)'
}
const TTL_DAYS = 14
// 🔴 **발행 러너와 같은 선택기를 쓴다.** 각자 조건을 조립하면 답이 갈린다 —
//    오늘 표본에서 이미 한 번 갈렸다(22 vs 15). 여기서 또 갈리면 예측을 믿을 수 없다.
const autoRows: AutoRow[] = rows.map((r) => ({
  id: r.id, status: r.status, createdPostId: r.createdPostId, gateVerdict: r.gateVerdict,
  promptVersion: r.promptVersion, model: r.model, matchedPersonaId: r.matchedPersonaId,
  gateResults: r.gateResults,
  title: r.editedTitle ?? r.draftTitle, body: r.editedBody ?? r.draftBody,
  sourceSite: r.rawContent.sourceSite, draftTitle: r.draftTitle, editedTitle: r.editedTitle,
  decidedBy: r.decidedBy, decidedAt: r.decidedAt, createdAt: r.createdAt,
}))
const sel = selectAutoTargets(autoRows, (t, b) => safetyFilter({ title: t, body: b }).verdict)
const rejectOf = new Map(sel.rejected.map((x) => [x.id, x.code]))
const items = rows.map((r) => {
  const captured = r.rawContent?.sourceCapturedAt ?? null
  const ageDays = captured === null ? null : Math.floor((SNAPSHOT.getTime() - captured.getTime()) / 864e5)
  const reasons: string[] = []
  const code = rejectOf.get(r.id)
  if (code !== undefined) reasons.push(REJECT_LABEL[code as keyof typeof REJECT_LABEL] ?? code)
  // 🔴 신선도는 선택기 뒤 단계다 — 러너의 ③-d 와 같은 축이다
  if (ageDays === null) reasons.push('원천 수집 시각 미상')
  else if (ageDays > TTL_DAYS) reasons.push(`TTL 초과 ${ageDays}일`)
  return { id: r.id, speaker: speakerOf(r.gateResults), reasons, title: r.draftTitle, ageDays }
})
console.log(`\n② READY 재고 ${items.length}건 (후보가 아니라 결정이 끝난 행만)`)

// ── 날짜별로 순서대로 소비한다 ──
let pool = items.filter((i) => i.reasons.length === 0)
const excluded = items.filter((i) => i.reasons.length > 0)
console.log(`   └ 발행 가능 ${pool.length}건 · 제외 ${excluded.length}건`)
for (const e of excluded) console.log(`      ⏸️ ${e.id} · ${e.speaker} · ${e.reasons.join(' · ')}`)

// ── persona 여력을 러너와 같은 방식으로 만든다 ──
const WEEK_AGO = new Date(SNAPSHOT.getTime() - 7 * 864e5)
const personaRows = await prisma.persona.findMany({
  where: { status: 'active' },
  select: {
    id: true, code: true, status: true, identity: true, voiceCore: true, noGoTopics: true,
    user: { select: { providerId: true, _count: { select: { accounts: true } } } },
  },
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
    providerId: r.user?.providerId ?? null,
    accountCount: r.user?._count.accounts ?? null,
    ageBand: typeof id.ageBand === 'string' ? id.ageBand : null,
    maritalStatus: typeof id.maritalStatus === 'string' ? id.maritalStatus : null,
    childrenCount: typeof id.childrenCount === 'number' ? id.childrenCount : null,
    ...(Array.isArray(id.childrenAgeBands) ? { childrenAgeBands: id.childrenAgeBands as never } : {}),
    parentCare: typeof id.parentCare === 'string' ? id.parentCare : null,
    menopauseStatus: typeof id.menopauseStatus === 'string' ? id.menopauseStatus : null,
    workStatus: null, economicStatus: null, region: null,
    noGoTopics: [...r.noGoTopics],
    voiceLength: typeof vc.length === 'string' ? vc.length : null,
    postsThisWeek,
    daysSinceLastPost: last?.matchedAt == null ? null : Math.floor((SNAPSHOT.getTime() - last.matchedAt.getTime()) / 864e5),
  })
}
const capturedAtOf = new Map(rows.map((r) => [r.id, r.rawContent?.sourceCapturedAt ?? null]))
const bodyOf = new Map(rows.map((r) => [r.id, r.editedBody ?? r.draftBody]))
const titleOf = new Map(rows.map((r) => [r.id, r.editedTitle ?? r.draftTitle]))

// ── 그날의 허가 — capacity 상한 · canary · window ──
const stageOfDay = (dayIso: string): { stage: ReleaseStage; why: readonly string[] } => {
  const at = new Date(`${dayIso}T03:00:00Z`)   // 그날 12:00 KST
  const canary = canaryAuthorization(process.env, at, RELEASE_STAGES)
  const win = windowAuthorization(process.env, at, RELEASE_STAGES)
  const sc = installFromEnv(process.env, {
    now: at,
    ...(canary.activeToday && canary.stage !== null ? { canaryStage: canary.stage } : {}),
    ...(win.activeToday && win.stage !== null ? { windowStage: win.stage } : {}),
  } as never)
  return { stage: sc.releaseStage, why: [...(sc.notes ?? [])] }
}

/**
 * 🔴 **그날의 단계는 GitHub Actions `vars` 에 있다** — 이 프로세스의 env 에는 없다.
 *    그래서 env 만 보면 언제나 가장 안전한 d1 로 떨어진다. 실제 운영값을 재려면
 *    `--stage=9/23:d3,9/24:d5` 로 넘긴다. 넘기지 않으면 env 판정을 그대로 쓴다.
 */
const STAGE_ARG = (process.argv.slice(2).find((a) => a.startsWith('--stage='))?.slice(8) ?? '').trim()
const forced = new Map(STAGE_ARG === '' ? [] : STAGE_ARG.split(',').map((kv) => {
  const [d, st] = kv.split(':')
  return [String(d).trim(), String(st).trim() as ReleaseStage] as const
}))
const plan = [
  { day: '9/23', iso: '2026-09-23' },
  { day: '9/24', iso: '2026-09-24' },
]
let live = personas.map((p) => ({ ...p }))
for (const p of plan) {
  const envAuth = stageOfDay(p.iso)
  const override = forced.get(p.day)
  const stage = override ?? envAuth.stage
  const auth = override === undefined ? envAuth
    : { stage, why: [`🔴 --stage 로 주입된 값이다 (env 판정은 ${envAuth.stage}) — 실제 값은 GHA vars 에 있다`] }
  const prof = PROFILES[stage]
  const need = prof.dailyTarget
  const weekCap = effectiveWeeklyCap(prof.postsPerWeek, prof.minDaysBetween)
  console.log(`\n③ ${p.day} — 설치되는 단계 **${stage}** (상한 ${need}건/일 · 주 ${weekCap} · 간격 ${prof.minDaysBetween}일)`)
  for (const w of auth.why) console.log(`     · ${w}`)

  // 🔴 배정은 러너와 **같은 `planBatch`** 가 한다 — 여기서 따로 조립하지 않는다
  const batch = planBatch(
    // 🔴 말투·profile 은 **정본 한 함수**(`voiceInputOf`)가 만든다 — 러너와 같은 입력이어야 한다
    pool.map((c, i) => {
      const src = autoRows.find((a) => a.id === c.id)!
      return {
        queueId: c.id, title: titleOf.get(c.id) ?? '', body: bodyOf.get(c.id) ?? '',
        gateVerdict: src.gateVerdict, createdAt: i, assignedPersonaCode: null,
        ...voiceInputOf(src),
        capturedAt: capturedAtOf.get(c.id) ?? null,
      }
    }) as never,
    live as never,
    { postsPerWeek: weekCap, minDaysBetween: prof.minDaysBetween } as never,
  )
  const assignOf = new Map(batch.assignments.map((a) => [a.queueId, a]))
  const take: typeof pool = []
  const used = new Set<string>()
  for (const c of pool) {
    if (take.length >= need) break
    const a = assignOf.get(c.id)
    const who = a?.assigned ?? null
    if (who === null) continue
    if (used.has(who)) continue
    used.add(who); take.push({ ...c, speaker: who })
  }
  if (take.length === 0) console.log('   (배정되는 후보 없음)')
  for (const t of take) console.log(`   ✅ ${t.id} · ${t.speaker} · ${t.title.slice(0, 28)}`)
  for (const c of pool) {
    if (take.some((t) => t.id === c.id)) continue
    const a = assignOf.get(c.id)
    const who = a?.assigned ?? null
    const why = who === null
      ? '🔴 배정 안 됨 (생활사 조건 불일치 또는 주 cap·간격 소진)'
      : used.has(who) ? `⏭️ ${who} — 같은 회차 화자 중복` : `⏭️ ${who} — 그날 상한 ${need}건 초과`
    console.log(`   ${why.startsWith('🔴') ? '🔴' : '⏭️'} ${c.id} · ${c.speaker} · ${why}`)
  }
  console.log(`   → **${p.day} 실제 발행 가능 ${take.length}/${need}** · 부족 글 ${Math.max(0, need - take.length)}건`
    + ` · 부족 화자 ${Math.max(0, need - used.size)}명`)

  // 🔴 소비를 반영한다 — 주 cap 이 줄고 마지막 발행일이 오늘이 된다
  for (const t of take) {
    const p2 = live.find((x) => x.code === t.speaker)
    if (p2 !== undefined) { p2.postsThisWeek += 1; p2.daysSinceLastPost = 0 }
  }
  for (const x of live) if (!used.has(x.code) && x.daysSinceLastPost !== null) x.daysSinceLastPost += 1
  pool = pool.filter((c) => !take.some((t) => t.id === c.id))
  console.log(`   (소비 뒤 남은 후보 ${pool.length}건)`)
}
console.log('\n🔴 이 예측이 보는 축: 후보 선택기 · TTL · persona 배정(생활사·주 cap·간격) · capacity/canary/window')
console.log('🔴 보지 않는 축: 그 사이 새로 READY 가 되는 후보 · kill switch · 그날의 catch-up 판정')
console.log('🔴 후보 ≠ READY. 여기 센 것은 decidedBy 가 사람·자동인 행뿐이다.\n')
await prisma.$disconnect()
