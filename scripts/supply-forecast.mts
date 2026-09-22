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
import { selectAutoTargets, REJECT_LABEL, type AutoRow } from '../src/lib/original-post-auto-publish'
import { safetyFilter } from './lib/micro-seed-safety-filter.mjs'
import { PROFILES } from '../src/lib/scale-profile'
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

const plan = [
  { day: '9/23', stage: 'd3' as const },
  { day: '9/24', stage: 'd5' as const },
]
for (const p of plan) {
  const need = PROFILES[p.stage].dailyTarget
  // 🔴 한 회차에 같은 화자를 두 번 쓰지 않는다
  const take: typeof pool = []
  const used = new Set<string>()
  for (const c of pool) {
    if (take.length >= need) break
    if (used.has(c.speaker)) continue
    used.add(c.speaker); take.push(c)
  }
  console.log(`\n③ ${p.day} ${p.stage.toUpperCase()} — 필요 ${need}건`)
  if (take.length === 0) console.log('   (없음)')
  for (const t of take) console.log(`   ✅ ${t.id} · ${t.speaker} · ${t.title.slice(0, 28)}`)
  const shortGlobal = need - take.length
  const sameSpeaker = pool.filter((c) => !take.includes(c) && used.has(c.speaker))
  for (const c of sameSpeaker) console.log(`   ⏭️ ${c.id} · ${c.speaker} · 같은 회차에 화자 중복`)
  console.log(`   → 확보 ${take.length}/${need} · 부족 글 ${Math.max(0, shortGlobal)}건 · 부족 화자 ${Math.max(0, need - used.size)}명`)
  pool = pool.filter((c) => !take.includes(c))
  console.log(`   (소비 뒤 남은 발행 가능 재고 ${pool.length}건)`)
}
console.log('🔴 이 예측이 **보지 않은 축** — 그래서 위 수는 상한이다')
console.log('   · persona 배정 가능성 (생활사 조건 · 주간 cap · 최소 간격)')
console.log('   · 그날의 canary/window 허가와 capacity 상한')
console.log('   실제 배정은 발행 러너의 ③ 구간이 그날 판정한다. 오늘 스냅샷에서는')
console.log('   같은 재고로 배정이 3건만 붙었다 — 나머지는 "여력 소진" 또는 "조건에 맞는 persona 없음".')
console.log('🔴 후보 ≠ READY. 여기 센 것은 decidedBy 가 사람·자동인 행뿐이다.\n')
await prisma.$disconnect()
