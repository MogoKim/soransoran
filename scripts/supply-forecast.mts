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
import { prepareCandidates, queueCandidateOf, type QueueCandidate } from '../src/lib/supply-candidates'
import { canaryAuthorization, windowAuthorization } from '../src/lib/release-canary'
import { HUMAN_DECIDER, AUTO_DECIDER } from '../src/lib/auto-ready'

await loadEnvLocal()
const prisma = new PrismaClient()

const SNAPSHOT = new Date()
const kst = (d: Date) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')
console.log(`\n══ 공급 예측 (스냅샷 ${kst(SNAPSHOT)} KST · read-only) ══\n`)

/**
 * 🔴 **KST 날짜 경계로 나눠 센다** (2026-09-23 보정).
 *
 *    앞판은 `dayStart = 9/22 00:00 KST` 이후 **전부**를 "9/22 실제 발행" 으로 셌다.
 *    그래서 9/23 발행 2건이 9/22 에 얹혀 "9/22 4건" 이라는 틀린 값이 나왔다.
 *    🔴 `Post.createdAt` 은 UTC 다. **+9시간을 더한 뒤** 날짜를 잘라야 KST 하루가 된다.
 */
const kstDayKey = (d: Date): string => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10)
const FROM = new Date('2026-09-21T15:00:00Z')   // 9/22 00:00 KST
const allPublished = await prisma.post.findMany({
  where: { createdAt: { gte: FROM } },
  select: { id: true, title: true, createdAt: true },
  orderBy: { createdAt: 'asc' },
})
const byDay = new Map<string, typeof allPublished>()
for (const x of allPublished) {
  const k = kstDayKey(x.createdAt)
  byDay.set(k, [...(byDay.get(k) ?? []), x])
}
console.log('① 실제 발행 — KST 날짜별 (고정값이다)')
for (const [day, list] of [...byDay].sort()) {
  console.log(`   ${day}  ${list.length}건`)
  for (const x of list) console.log(`      ${kst(x.createdAt)}  ${x.title.slice(0, 32)}`)
}
const todayKstKey = kstDayKey(SNAPSHOT)
const publishedToday = (byDay.get(todayKstKey) ?? []).length
console.log(`   🔴 오늘(${todayKstKey}) 이미 ${publishedToday}건 나갔다 — 남은 몫만 예측한다`)

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
// 🔴 **신선도(TTL)는 여기서 재지 않는다.** 러너의 `prepareCandidates` 가 **그 날 기준**으로
//    다시 판정한다 — 실행 시각으로 한 번 재고 끝내면 "9/23 엔 살아 있고 9/24 엔 만료" 를 놓친다.
const items = rows.map((r) => {
  const code = rejectOf.get(r.id)
  const reasons = code === undefined ? [] : [REJECT_LABEL[code as keyof typeof REJECT_LABEL] ?? code]
  return { id: r.id, speaker: speakerOf(r.gateResults), reasons, title: r.draftTitle }
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
// 🔴 배정 id → 코드. 러너와 같다 — 못 찾으면 모르는 코드를 넘겨 fail-closed 로 잡히게 한다
const codeOfPersonaId = new Map(personaRows.map((r) => [r.id, r.code]))
const bodyOf = new Map(rows.map((r) => [r.id, r.editedBody ?? r.draftBody]))
const titleOf = new Map(rows.map((r) => [r.id, r.editedTitle ?? r.draftTitle]))

// ── 그날의 허가 — capacity 상한 · canary · window ──
/**
 * 🔴 **그날 허가되는 최대 단계.** capacity 천장 아래에서 window·canary 가 여는 값이다.
 *
 * 🔴 앞판은 `installFromEnv(env, { canaryStage, windowStage } as never)` 를 불렀다.
 *    그 키는 존재하지 않는데 `as never` 가 타입 검사를 지워 **조용히 무시됐고**,
 *    그래서 창이 열린 날에도 d1 이 나왔다. 없는 키를 넘기는 코드는 죽은 코드다.
 *
 * 🔴 **준비도(readiness) 감속은 여기서 재지 않는다** — 그것은 그날의 실적에 달렸고
 *    예측 시점에는 없다. 그래서 아래 값은 **그날 허가의 상한**이다.
 */
const stageOfDay = (dayIso: string): { stage: ReleaseStage; why: readonly string[] } => {
  const at = new Date(`${dayIso}T03:00:00Z`)   // 그날 12:00 KST
  const idx = (st: ReleaseStage) => RELEASE_STAGES.indexOf(st)
  const why: string[] = []
  const ceilRaw = (process.env.SORAN_CAPACITY_STAGE ?? '').trim()
  const ceiling = (RELEASE_STAGES as readonly string[]).includes(ceilRaw)
    ? ceilRaw as ReleaseStage : RELEASE_STAGES[0]
  why.push(`capacity 천장 ${ceiling}${ceilRaw === '' ? ' (설정 없음 — 가장 안전한 값)' : ''}`)

  const baseRaw = (process.env.SORAN_RELEASE_STAGE ?? '').trim()
  let stage: ReleaseStage = (RELEASE_STAGES as readonly string[]).includes(baseRaw)
    ? baseRaw as ReleaseStage : RELEASE_STAGES[0]
  why.push(`기본 release ${stage}`)

  const win = windowAuthorization(process.env, at, RELEASE_STAGES)
  if (win.activeToday && win.stage !== null) {
    if (idx(win.stage) > idx(stage)) { stage = win.stage; why.push(`window 가 ${win.stage} 로 올린다`) }
  } else why.push(`window 비활성 (${win.note ?? '오늘이 창 밖이다'})`)

  const canary = canaryAuthorization(process.env, at, RELEASE_STAGES)
  if (canary.activeToday && canary.stage !== null) {
    if (idx(canary.stage) > idx(stage)) { stage = canary.stage; why.push(`canary 가 ${canary.stage} 로 올린다`) }
  } else why.push(`canary 비활성 (${canary.note ?? '오늘이 카나리 날이 아니다'})`)

  // 🔴 천장이 마지막이다 — 창·카나리가 무엇을 열든 여기서 잘린다
  if (idx(stage) > idx(ceiling)) {
    why.push(`🔴 capacity ${ceiling} 가 ${stage} 를 막는다 — 시험이라도 열지 않는다`)
    stage = ceiling
  }
  why.push('🔴 준비도 감속은 그날 실적에 달려 있어 예측에서 재지 않는다 — 위 값은 허가 상한이다')
  return { stage, why }
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
/** 🔴 오늘은 이미 나간 몫을 뺀 **남은 슬롯**만 본다 */
const alreadyOn = (iso: string): number => (byDay.get(iso) ?? []).length
let live = personas.map((p) => ({ ...p }))
for (const p of plan) {
  const envAuth = stageOfDay(p.iso)
  const override = forced.get(p.day)
  const stage = override ?? envAuth.stage
  const auth = override === undefined ? envAuth
    : { stage, why: [`🔴 --stage 로 주입된 값이다 (env 판정은 ${envAuth.stage}) — 실제 값은 GHA vars 에 있다`] }
  const prof = PROFILES[stage]
  const need = Math.max(0, prof.dailyTarget - alreadyOn(p.iso))
  const done = alreadyOn(p.iso)
  const weekCap = effectiveWeeklyCap(prof.postsPerWeek, prof.minDaysBetween)
  console.log(`\n③ ${p.day} — 설치되는 단계 **${stage}** (상한 ${prof.dailyTarget}건/일`
    + `${done > 0 ? ` · 이미 ${done}건 발행 → 남은 ${need}건` : ''} · 주 ${weekCap} · 간격 ${prof.minDaysBetween}일)`)
  for (const w of auth.why) console.log(`     · ${w}`)

  // 🔴 배정·신선도는 러너와 **같은 `prepareCandidates`** 가 한다.
  //    `at` 을 **그 날**로 준다 — 러너는 지금, 예측은 그 날이다.
  const at = new Date(`${p.iso}T03:00:00Z`)   // 그날 12:00 KST
  const cands: QueueCandidate[] = pool.map((c, i) => {
    const src = autoRows.find((a) => a.id === c.id)!
    // 🔴 러너와 **같은 조립 함수**를 쓴다 — 기존 배정 보존·모르는 코드 처리가 같아야 한다
    return queueCandidateOf({
      row: { id: src.id, title: titleOf.get(c.id) ?? '', body: bodyOf.get(c.id) ?? '',
        gateVerdict: src.gateVerdict, matchedPersonaId: src.matchedPersonaId },
      seq: i, codeOf: codeOfPersonaId, capturedAt: capturedAtOf.get(c.id) ?? null,
      voice: voiceInputOf(src),
    })
  })
  const prepared = prepareCandidates({
    candidates: cands, personas: live as never,
    caps: { postsPerWeek: weekCap, minDaysBetween: prof.minDaysBetween }, at,
  })
  const assignOf = new Map(prepared.batch.assignments.map((a) => [a.queueId, a]))
  const heldOf = new Map(prepared.held.map((h) => [h.queueId, h]))
  const autoOrder = prepared.auto.map((a) => a.queueId)

  const take: typeof pool = []
  const used = new Set<string>()
  for (const id of autoOrder) {
    if (take.length >= need) break
    const who = assignOf.get(id)?.assigned ?? null
    if (who === null || used.has(who)) continue
    const c = pool.find((x) => x.id === id)!
    used.add(who); take.push({ ...c, speaker: who })
  }
  if (take.length === 0) console.log('   (배정되는 후보 없음)')
  for (const t of take) console.log(`   ✅ ${t.id} · ${t.speaker} · ${t.title.slice(0, 28)}`)
  for (const c of pool) {
    if (take.some((t) => t.id === c.id)) continue
    const h = heldOf.get(c.id)
    const who = assignOf.get(c.id)?.assigned ?? null
    const why = h !== undefined ? `🔴 ${h.hold} — ${h.reason}`
      : who === null ? '🔴 배정 안 됨 (생활사 조건 불일치 또는 주 cap·간격 소진)'
        : used.has(who) ? `⏭️ ${who} — 같은 회차 화자 중복`
          : `⏭️ ${who} — 그날 상한 ${need}건 초과`
    console.log(`   ${why.startsWith('🔴') ? '🔴' : '⏭️'} ${c.id} · ${c.speaker} · ${why}`)
  }
  console.log(`   → **${p.day} ${stage} ${done > 0 ? `실적 ${done} + ` : ''}예측 ${take.length}/${need}`
    + ` = 하루 ${done + take.length}/${prof.dailyTarget}** · 부족 글 ${Math.max(0, need - take.length)}건`
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
