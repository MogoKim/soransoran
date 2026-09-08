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
  selectAutoTargets, judgeApply, verifyAfterPublish, pickPublishTarget, REJECT_LABEL,
  AUTO_PROMPT_VERSION, AUTO_MODEL, AUTO_SITE_PREFIX, AUTO_GATE_VERDICT,
  type AutoRow,
} from '../src/lib/original-post-auto-publish'
import { safetyFilter } from './lib/micro-seed-safety-filter.mjs'
import { planBatch, POST_CAP_PER_WEEK, MIN_DAYS_BETWEEN_POSTS } from '../src/lib/original-post-persona-match'
import { planStore } from '../src/lib/original-post-match-store'
import { DAILY_PUBLISH_CAP, kstDayStart } from '../src/lib/original-post-publish'
import { installFromEnv, activeScale, describeScale } from '../src/lib/scale-runtime'
import { stageVerdicts } from '../src/lib/scale-readiness'
import { effectiveWeeklyCap } from '../src/lib/scale-profile'
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
console.log(`  안전 기본값 일 ${DAILY_PUBLISH_CAP}건 · persona 주 ${POST_CAP_PER_WEEK}건 · 최소 ${MIN_DAYS_BETWEEN_POSTS}일`)
console.log('  🔴 실제 상한은 아래 ③-c 에서 설치한다 — 설치 전에는 이 안전값이다\n')

// ── ① 후보 수집 — 🔴 읽기만 한다 ──
const raw = await prisma.originalPostApprovalQueue.findMany({
  where: { status: { in: ['APPROVED', 'EDITED'] }, createdPostId: null },
  select: {
    id: true, status: true, createdPostId: true, gateVerdict: true,
    promptVersion: true, model: true, matchedPersonaId: true,
    draftTitle: true, draftBody: true, editedTitle: true, editedBody: true,
    // 🔴 기계 profile 은 게이트 기록까지 본다 — 큐 컬럼 셋만으로는 손으로 넣을 수 있다
    gateResults: true,
    decidedAt: true, createdAt: true,
    rawContent: { select: { sourceSite: true } },
  },
  orderBy: { createdAt: 'asc' },
})
const rows: AutoRow[] = raw.map((r) => ({
  id: r.id, status: r.status, createdPostId: r.createdPostId, gateVerdict: r.gateVerdict,
  promptVersion: r.promptVersion, model: r.model, matchedPersonaId: r.matchedPersonaId,
  // 🔴 수정본이 있으면 그것이 발행될 글이다
  gateResults: r.gateResults,
  title: r.editedTitle ?? r.draftTitle,
  body: r.editedBody ?? r.draftBody,
  sourceSite: r.rawContent.sourceSite,
  decidedAt: r.decidedAt, createdAt: r.createdAt,
}))

// ── ② 안전 재판정 — 🔴 저장된 값을 믿지 않는다 ──
const { targets, rejected } = selectAutoTargets(rows, (t, b) => safetyFilter({ title: t, body: b }).verdict)

// 🔴 발행 대상은 **배정을 끝낸 뒤** 고른다 (③ 아래). 맨 앞 한 건을 미리 집으면,
//    그 글이 배정되지 않았을 때 뒤에 배정된 글이 있어도 하루를 통째로 버린다.
console.log(`① 대기열 ${rows.length}건 → 자동 발행 후보 ${targets.length}건`)
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
            user: { select: { providerId: true, _count: { select: { accounts: true } } } } },
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
    // 🔴 실회원 판별 정본. 넘기지 않으면 hardFilter 가 fail-closed 로 막는다
    accountCount: r.user?._count.accounts ?? null,
    ageBand: typeof id.ageBand === 'string' ? id.ageBand : null,
    maritalStatus: typeof id.maritalStatus === 'string' ? id.maritalStatus : null,
    // 🔴 **이것이 빠지면 모든 persona 가 무자녀로 판정된다.**
    //    hardFilter 는 `p.childrenCount ?? 0` 로 읽으므로, 넘기지 않으면 0 이 되어
    //    자녀 글이 전부 NO_CHILDREN 으로 막힌다 — match-assign 은 넘기는데 여기만 빠져 있었다.
    //    2026-09-07 실측: "아이랑 같이 갈 숙소" 글에서 P10·P17 이 부당하게 차단됐다.
    childrenCount: typeof id.childrenCount === 'number' ? id.childrenCount : null,
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
// 🔴 이미 배정된 행은 기존 배정이 정본이다 — id → code 로 바꿔 넘긴다.
//    넘기지 않으면 planBatch 가 그 행을 새로 매칭해 **다른 사람에게** 줄 수 있다
const codeOfPersonaId = new Map(personaRows.map((r) => [r.id, r.code]))

/**
 * ── ③-c 🔴 **규모 설정 설치** — `loadEnvLocal()` 뒤, 쓰기 판정 **앞**이다 ──
 *
 *    ① 지금 큐·지금 사람으로 각 단계가 14일을 버티는지 시뮬레이션하고
 *    ② 그 판정을 넘겨 `release` 단계를 **실제로** 낮춘다.
 *    화면 문구가 아니라 아래 `dailyCap`·`caps` 가 바뀐다 — 그것이 이 설치의 목적이다.
 */
const historyRows = await prisma.personaActivityLog.findMany({
  where: { kind: 'post' }, select: { createdAt: true, persona: { select: { code: true } } },
})
const readiness = stageVerdicts({
  queue: targets.map((t) => ({
    queueId: t.id, title: t.title, body: t.body, gateVerdict: t.gateVerdict, createdAt: 0,
    assignedPersonaCode: null,
  })),
  personas: personas as never,
  history: personas.map((p) => ({
    code: p.code,
    matchedAts: historyRows.filter((l) => l.persona?.code === p.code).map((l) => l.createdAt),
  })),
  startAt: new Date(),
})
const scale = installFromEnv(process.env, { readiness })
// 🔴 여기서부터 쓰기 판정에 쓰이는 값은 전부 `scale` 에서 나온다
const RELEASE_DAILY_CAP = scale.releaseProfile.dailyTarget
const RELEASE_CAPS = {
  postsPerWeek: effectiveWeeklyCap(scale.releaseProfile.postsPerWeek, scale.releaseProfile.minDaysBetween),
  minDaysBetween: scale.releaseProfile.minDaysBetween,
}
console.log(`\n③-c 규모 설정  ${describeScale(scale)}`)
for (const n of scale.notes) console.log(`     · ${n}`)
console.log(`     적용된 발행 상한  일 ${RELEASE_DAILY_CAP}건 · persona 주 ${RELEASE_CAPS.postsPerWeek}건`
  + ` · 최소 ${RELEASE_CAPS.minDaysBetween}일`)
if (scale.throttledByReadiness) console.log('     🔴 준비도 미달로 감속됐다 — 이 값이 실제로 적용된다')

// 🔴 후보만 넣어 계산한다 — legacy 글이 여력을 가져가면 안 된다
const batch = planBatch(
  targets.map((t) => ({
    queueId: t.id, title: t.title, body: t.body, gateVerdict: t.gateVerdict, createdAt: 0,
    // 🔴 배정된 persona 를 못 찾으면 빈 문자열이 아니라 **모르는 코드**를 넘긴다 —
    //    planBatch 가 fail-closed 로 잡아 멈춘다. 조용히 재배정되면 안 된다
    assignedPersonaCode: t.matchedPersonaId === null
      ? null
      : (codeOfPersonaId.get(t.matchedPersonaId) ?? `__unknown:${t.matchedPersonaId}`),
  })),
  personas,
  // 🔴 설치된 release 프로필을 **명시적으로** 넘긴다. 모듈 상수에 기대지 않는다
  RELEASE_CAPS,
)
const assignOf = new Map(batch.assignments.map((a) => [a.queueId, a]))

console.log(`\n③ persona 배정 가능성 (active ${personas.length}명)`)
for (const t of targets) {
  const rec = assignOf.get(t.id)
  if (rec?.recovery === true) {
    console.log(rec.recoveryProblem === null
      ? `   ${t.id} → ${rec.assigned} (이미 배정돼 있다 — 재배정하지 않는다)`
      : `   ${t.id} — 🔴 ${rec.recoveryProblem}`)
    continue
  }
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

// ── ③-a 🔴 기존 배정이 깨졌으면 **여기서 멈춘다** ──
//    없는 persona · 비활성 · 실계정이 붙은 사람을 가리키는 배정은 조용히 바꾸지 않는다.
//    바꾸면 화면이 보여준 사람과 실제로 글을 쓴 사람이 달라진다
const brokenRecovery = targets
  .map((t) => ({ id: t.id, problem: assignOf.get(t.id)?.recoveryProblem ?? null }))
  .filter((x) => x.problem !== null)
if (brokenRecovery.length > 0) {
  console.log(`\n🔴 기존 배정을 쓸 수 없습니다 — ${brokenRecovery.length}건. 아무것도 발행하지 않습니다.`)
  for (const b of brokenRecovery) console.log(`   ${b.id}  ${b.problem}`)
  await prisma.$disconnect()
  fail('배정 정합이 깨졌습니다 — 사람이 확인해야 합니다')
}

// ── ③-b 🔴 이번에 나갈 한 건 — **복구가 먼저, 그다음 배정이 있는 첫 글** ──
const { picked, recovered, skipped, waiting } = pickPublishTarget({
  ordered: targets,
  assignedOf: (id) => assignOf.get(id)?.assigned ?? null,
  isRecovery: (id) => assignOf.get(id)?.recovery === true,
})
if (skipped.length > 0) {
  // 🔴 건너뛴 글을 숨기지 않는다. 지우지도 상태를 바꾸지도 않았고, 다음 회차에 다시 맨 앞이다
  console.log(`\n   ⏭️  이번에 나가지 않는 앞줄 ${skipped.length}건 (상태 그대로 · 다음 회차 재시도)`)
  for (const sk of skipped) {
    const a = assignOf.get(sk.id)
    const why = a?.assigned != null
      ? '배정은 있으나 이번 회차는 복구가 먼저다'
      : (a?.eligible.length ?? 0) > 0
        ? `후보 ${a?.eligible.length}명이 모두 이번 배치에서 소진됐다`
        : '생활사 조건에 맞는 persona 가 없다'
    console.log(`      ${sk.id}  ${why}`)
  }
}
if (picked !== null) {
  console.log(`\n   🎯 이번에 나갈 1건  ${picked.id} → ${assignOf.get(picked.id)?.assigned ?? '?'}`
    + `${recovered ? '  🔧 복구 — 이전 회차가 배정만 하고 발행하지 못한 행이다' : ''}`)
  console.log(`      제목 ${brief(picked.title)} · 본문 ${[...picked.body].length}자 · ${picked.sourceSite}`)
  console.log(`      줄 순서 기준 ${(picked.decidedAt ?? picked.createdAt).toISOString()}`)
}
if (waiting.length > 0) {
  console.log(`   ⏳ 다음 회차 대기 ${waiting.length}건 — 오래 기다린 순`)
}

// ── ④ 오늘 상황 ──
// 🔴 KST 자정은 기존 함수를 쓴다 (publish-live 와 같은 것) —
//    setUTCHours(-9) 는 UTC 15시 이후에 어제로 밀려 cap 을 잘못 센다
const dayStart = kstDayStart(new Date())
const publishedToday = await prisma.personaActivityLog.count({ where: { kind: 'post', createdAt: { gte: dayStart } } })
const sw = await prisma.personaGlobalSwitch.findUnique({ where: { id: 'global' }, select: { enabled: true } })
const killed = sw?.enabled === true
console.log(`\n④ 오늘(${kst(new Date())}) 발행 ${publishedToday} / ${RELEASE_DAILY_CAP}건 · 전체 중지 ${killed ? '🔴 켜짐' : '꺼짐'}`)

// ── ⑤ 실행 판정 ──
const gate = judgeApply({ targets, picked, apply: APPLY, limit: LIMIT, publishedToday, dailyCap: RELEASE_DAILY_CAP, killSwitchEnabled: killed })
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
// 🔴 기존 배정 행은 여기 들어오지 않는다 — matchedPersonaId · matchedAt · matchMeta 를 다시 쓰지 않는다.
//    다시 쓰면 matchedAt 이 밀려 주간 여력이 한 번 더 열리고, 이력이 두 번 세어진다
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
// 🔴 상한을 주입한다 — 트랜잭션 안 재판정도 같은 값을 쓴다
const res = await publishOriginalPostTx(prisma, { queueId: target.id, publishedToday, dailyCap: RELEASE_DAILY_CAP })
if (res.kind !== 'published') {
  await prisma.$disconnect()
  fail(res.kind === 'blocked' ? `발행이 막혔습니다 — ${res.code} · ${res.detail}` : `발행 오류 — ${res.message}`)
}
// 🔴 화면이 예고한 사람과 실제로 글을 쓴 사람이 같아야 한다.
//    다르면 사람은 어느 쪽을 믿을지 모르고, 복구 계약이 조용히 깨진 것이다
const announced = assignOf.get(target.id)?.assigned ?? null
if (announced !== null && res.personaCode !== announced) {
  await prisma.$disconnect()
  fail(`🔴 예고한 persona(${announced}) 와 발행된 persona(${res.personaCode}) 가 다릅니다`)
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
