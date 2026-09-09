#!/usr/bin/env tsx
/**
 * Persona cohort 실행 도구 — 🔴 **기본은 dry-run. 회차마다 스크립트를 새로 만들지 않는다**
 *
 * 사용법
 *   npx tsx scripts/persona-cohort-run.mts --cohort=wave3-scale --step=check
 *   npx tsx scripts/persona-cohort-run.mts --cohort=wave3-scale --step=create            # dry-run
 *   npx tsx scripts/persona-cohort-run.mts --cohort=wave3-scale --step=create  --apply --limit=11
 *   npx tsx scripts/persona-cohort-run.mts --cohort=wave3-scale --step=seed    --apply --limit=11
 *   ACTOR_USER_ID=<id> npx tsx scripts/persona-cohort-run.mts \
 *     --cohort=wave3-scale --step=activate --apply --limit=11 --reason "..."
 *
 * 🔴 **`--code` 를 받지 않는다.** 대상은 `src/lib/persona-cohort.ts` 의 manifest 가 정하고,
 *    `--cohort` 는 `RUNNABLE_COHORTS` allowlist 안에서만 받는다. 끝난 회차는 열리지 않는다.
 *
 * 🔴 **네 개를 모두 요구한다** — `--apply` · `--limit=<회차 인원>` · (활성화·중지는) `ACTOR_USER_ID` · `--reason`.
 *    `ACTOR_USER_ID` 를 환경변수로 받는 이유는 셸 히스토리에 남기지 않기 위해서다.
 *
 * 🔴 이 도구가 하지 않는 것
 *      · 발행 · Post · Comment · Queue · ActivityLog · RawContent
 *      · kill switch · cap 조작 · 기존 User 재사용
 *      · 일부만 처리하는 것 — 하나라도 어긋나면 **전원 롤백**한다
 */
import { PrismaClient, type Prisma, type PersonaStatus } from '@prisma/client'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'

import {
  COHORTS, cohortOf, verifyAllCohorts, stageOf,
  judgeCreate, judgeSeed, judgeActivate, judgePause, judgePrerequisites, judgeArgs,
  judgeCohortArg, judgeStepArg, requiresActor, checkCohortKeys,
  displayNamePathOf, seedPathOf,
  type CohortId, type CohortManifest, type CohortMemberState, type CohortStep,
} from '../src/lib/persona-cohort'
import { judgeRealMember } from '../src/lib/real-member-gate'
import { parsePoolDoc, type PoolCard } from '../src/lib/persona-pool-card'
import { verifySeedCard, duplicateKeys } from '../src/lib/persona-card-verify'
import { preflightAll, preflightPersona, verifyPersonaSeed, type PersonaDbRow } from '../src/lib/persona-wave2-verify'
import { assignCandidates, verifyNamePolicy } from '../src/lib/persona-nickname-candidates'
import { checkNameCollision } from './lib/persona-gate-name-collision.mjs'
import { loadNameCollisionSets, describeSets } from './lib/persona-name-collision-sets.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

/**
 * 🔴 크롤 author 해시 salt — `persona-wave2-assign` 과 **같은 계약**이다.
 *    `hashOf` 를 넘기지 않으면 `matchAuthorHashes` 가 `return []` 로 빠져
 *    **authorHash 대조가 통째로 건너뛰어진다** (실측 17,992건 무시).
 *
 * 🔴 **값을 읽는 것은 `loadEnvLocal()` 뒤다.** 여기서는 이름만 둔다 —
 *    salt 는 `.env.local` 에만 있어서, 모듈 최상단에서 읽으면 언제나 기본값으로 굳는다.
 *    그러면 해시가 적재 때와 달라져 `authorHashes.has(...)` 가 전부 빗나가고,
 *    **Gate ⑥-B 의 B2 갈래가 조용히 전원 pass 로 통과한다.**
 *    (`persona-wave2-assign` 은 `loadEnvLocal()` 뒤에서 만든다 — 그쪽이 정본 순서다)
 */
const AUTHOR_SALT_ENV = 'VOICE_AUTHOR_HASH_SALT'
const DEFAULT_SALT = 'soransoran-voice-v1'
const POOL_DOC = 'docs/operations/2026-08-30-persona-pool-design.md'
const DRAFT: PersonaStatus = 'draft'

const argv = process.argv.slice(2)
const arg = (k: string): string | null => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`))
  return hit === undefined ? null : (hit.split('=').slice(1).join('=') || null)
}
const APPLY = argv.includes('--apply')
const LIMIT_RAW = arg('limit')
const LIMIT = LIMIT_RAW === null ? null : Number(LIMIT_RAW)
const REASON_AT = argv.indexOf('--reason')
const REASON = REASON_AT >= 0 ? (argv[REASON_AT + 1] ?? null) : null
const ACTOR = (process.env.ACTOR_USER_ID ?? '').trim() || null

const fail = (m: string): never => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }
const ok = (m: string): void => console.log(`   ✅ ${m}`)

// ── 인자 게이트 — 🔴 DB 를 열기 전에 막는다 ──
const manifestProblems = verifyAllCohorts()
if (manifestProblems.length > 0) fail(`cohort manifest 가 성립하지 않습니다:\n     ${manifestProblems.join('\n     ')}`)

const cg = judgeCohortArg(arg('cohort'))
if (!cg.ok) fail(cg.reason)
const COHORT: CohortId = cg.id!
const M: CohortManifest = cohortOf(COHORT)!

const sg = judgeStepArg(arg('step'))
if (!sg.ok) fail(sg.reason)
const STEP: CohortStep = sg.step!

await loadEnvLocal()

/**
 * 🔴 **salt 는 `loadEnvLocal()` 뒤에 만든다.** 순서가 계약이다 —
 *    앞에서 만들면 `.env.local` 의 값이 아직 `process.env` 에 없어 기본값으로 굳는다.
 *    그 상태로는 후보 해시가 적재 해시와 달라 B2(크롤 author) 대조가 한 건도 걸리지 않고,
 *    Gate ⑥-B 는 "전원 pass" 라고 말한다 — 검사한 적이 없는데도.
 */
const salt = (process.env[AUTHOR_SALT_ENV] ?? DEFAULT_SALT).trim()
const hashOf = (v: string): string => `sha256:${createHash('sha256').update(`${salt}::${v}`, 'utf8').digest('hex')}`

const prisma = new PrismaClient()

const mode = STEP === 'check' ? '검증 (read-only)' : APPLY ? '🔴 실제 적용' : 'dry-run (DB write 0)'
console.log(`\n══ Persona cohort ${COHORT} · ${STEP} — ${mode} ══\n`)
console.log(`  ${M.purpose}`)
console.log(`  대상 ${M.codes.length}명  ${M.codes.join(' · ')}   🔴 manifest 가 정한다 — --code 로 바꿀 수 없다`)

// ── 정본 Pool ──
const poolDoc = parsePoolDoc(readFileSync(POOL_DOC, 'utf-8'))
if (poolDoc.problems.length > 0) {
  await prisma.$disconnect()
  fail(`정본 Pool 문서 파싱 문제 ${poolDoc.problems.length}건: ${poolDoc.problems.join(' / ')}`)
}
const poolOf = new Map<string, PoolCard>(poolDoc.cards.map((c) => [c.code, c]))
const missingCards = M.codes.filter((c) => !poolOf.has(c))
if (missingCards.length > 0) {
  await prisma.$disconnect()
  fail(`정본 Pool 에 카드가 없는 대상: ${missingCards.join(', ')} — 카드 없이 만들지 않는다`)
}

/** 🔴 DB 값을 그대로 읽는다 — 입력 파일이 아니라 **저장된 것**을 본다 */
async function readDbRows(client: PrismaClient | Prisma.TransactionClient, codes: readonly string[]): Promise<PersonaDbRow[]> {
  const rows = await client.persona.findMany({
    where: { code: { in: [...codes] } },
    select: {
      code: true, status: true, ageBand: true, region: true, lifeStage: true,
      identity: true, voiceCore: true, voiceVariations: true, activityRhythm: true,
      noGoTopics: true, noGoExpressions: true, forbiddenReactionRoles: true,
      dailyCap: true, weeklyCap: true, silenceRate: true,
      user: { select: { nickname: true, providerId: true, _count: { select: { accounts: true } } } },
      auditLogs: { select: { action: true, fromStatus: true, toStatus: true, actorUserId: true, reason: true } },
    },
  })
  return rows.map((r) => ({
    code: r.code, status: r.status,
    nickname: r.user?.nickname ?? null,
    accountCount: r.user?._count.accounts ?? null,
    providerId: r.user?.providerId ?? null,
    ageBand: r.ageBand, region: r.region, lifeStage: r.lifeStage,
    identity: r.identity, voiceCore: r.voiceCore,
    voiceVariations: r.voiceVariations, activityRhythm: r.activityRhythm,
    noGoTopics: r.noGoTopics, noGoExpressions: r.noGoExpressions,
    forbiddenReactionRoles: r.forbiddenReactionRoles,
    dailyCap: r.dailyCap, weeklyCap: r.weeklyCap, silenceRate: r.silenceRate,
    auditCreated: r.auditLogs.filter((a) => a.action === 'created').length,
    auditNameAssigned: r.auditLogs.filter((a) => a.action === 'display_name_assigned').length,
    auditStatusChanged: r.auditLogs
      .filter((a) => a.action === 'status_changed')
      .map((a) => ({ fromStatus: a.fromStatus, toStatus: a.toStatus, actorUserId: a.actorUserId, reason: a.reason })),
  }))
}

/** 🔴 `seeded` 는 **전체 seed 정합**으로 판정한다 — 축 몇 개만 보면 반쯤 채운 사람이 통과한다 */
function toStates(rows: readonly PersonaDbRow[]): CohortMemberState[] {
  return M.codes.map((code) => {
    const r = rows.find((x) => x.code === code)
    if (r === undefined) {
      return { code, exists: false, status: null, hasNickname: false, seeded: false, accountCount: null, providerId: null }
    }
    return {
      code, exists: true, status: r.status,
      hasNickname: (r.nickname ?? '').trim() !== '',
      seeded: verifyPersonaSeed(r, poolOf.get(code) ?? null).complete,
      accountCount: r.accountCount, providerId: r.providerId,
    }
  })
}

/** 🔴 선행 회차가 전부 켜져 있는가 — DB 실측이다 */
async function readPrereqActive(): Promise<Map<CohortId, string[]>> {
  const out = new Map<CohortId, string[]>()
  for (const req of M.requires) {
    const rows = await prisma.persona.findMany({
      where: { code: { in: [...COHORTS[req].codes] }, status: 'active' },
      select: { code: true },
    })
    out.set(req, rows.map((r) => r.code))
  }
  return out
}

const dbRows = await readDbRows(prisma, M.codes)
const states = toStates(dbRows)

for (const s of states) {
  // 🔴 아직 없는 사람에게 "실회원" 이라고 적지 않는다 — fail-closed 판정은 게이트에서만 쓴다
  const mark = !s.exists ? '—'
    : judgeRealMember({ accountCount: s.accountCount, providerId: s.providerId }).real ? '🔴 실회원' : '🟢'
  console.log(`  ${s.code}  ${stageOf(s).padEnd(14)} ${s.exists ? `status=${s.status}` : '없음'}`
    + ` · 닉네임 ${s.hasNickname ? '있음' : '없음'} · seed ${s.seeded ? '완료' : '미완'}`
    + ` · Account ${s.accountCount ?? '—'} ${mark}`)
}

// ── 🔴 --step=check — **언제나 read-only.** 단계를 주장하지 않고 사실만 적는다 ──
if (STEP === 'check') {
  let bad = 0
  const prereq = judgePrerequisites(M, await readPrereqActive())
  console.log(`\n  선행 회차 ${M.requires.join(' · ') || '없음'} — ${prereq.ok ? '✅ 전원 active' : '🔴 미완'}`)
  for (const p of prereq.problems) console.log(`     ${p}`)
  if (!prereq.ok) bad += 1

  console.log('\n  ── 불변 조건 (단계와 무관하게 항상 참이어야 한다)')
  for (const code of M.codes) {
    const r = dbRows.find((x) => x.code === code)
    if (r === undefined) { console.log(`  ⚪ ${code}  아직 없다 — 위반 아님`); continue }
    const problems: string[] = []
    const real = judgeRealMember({ accountCount: r.accountCount, providerId: r.providerId })
    if (real.real) problems.push(real.reason)
    if (r.auditCreated !== 1) problems.push(`AuditLog created ${r.auditCreated}건 (1이어야 한다)`)
    if (r.auditNameAssigned !== 1) problems.push(`AuditLog display_name_assigned ${r.auditNameAssigned}건 (1이어야 한다)`)
    if (r.status === 'active') {
      const pre = preflightPersona({ row: r, poolCard: poolOf.get(code) ?? null, expectStatus: 'active' })
      problems.push(...pre.problems)
    }
    if (problems.length === 0) console.log(`  ✅ ${code}  status=${r.status} · 위반 0`)
    else { bad += 1; for (const p of problems) console.log(`  🔴 ${code}  ${p}`) }
  }
  await prisma.$disconnect()
  console.log(bad === 0 ? '\n✅ 위반 0 — DB write 0\n' : `\n🔴 ${bad}건 이상 — DB write 0\n`)
  process.exit(bad === 0 ? 0 : 1)
}

// ── 순서 게이트 ──
const prereq = judgePrerequisites(M, await readPrereqActive())
if (STEP !== 'pause' && !prereq.ok) {
  await prisma.$disconnect()
  fail(`선행 회차가 끝나지 않았습니다:\n     ${prereq.problems.join('\n     ')}`)
}
if (STEP !== 'pause') ok(`선행 회차 ${M.requires.join(' · ') || '없음'} 전원 active`)

const order = STEP === 'create' ? judgeCreate(states, M)
  : STEP === 'seed' ? judgeSeed(states, M)
  : STEP === 'activate' ? judgeActivate(states, M)
  : judgePause(states)
if (!order.ok) {
  await prisma.$disconnect()
  // 🔴 단계에 맞는 안내만 한다 — `pause` 에 "생성이 먼저다" 라고 적으면 사람이 헷갈린다
  fail(`${STEP} 를 진행할 수 없습니다:\n     ${order.problems.join('\n     ')}\n`
    + (STEP === 'pause'
      ? `     🔴 pause 는 active 인 사람만 멈춥니다. 일부만 처리하지 않습니다.`
      : `     🔴 순서는 생성 → seed → 검증 → 활성화 다. 일부만 처리하지 않습니다.`))
}
ok(`${STEP} 순서 게이트 통과 (${M.codes.length}명 전원)`)

// ── 단계별 준비 ──
type CreatePlan = { code: string; name: string }
let creates: CreatePlan[] = []
let seeds: Record<string, Record<string, unknown>> = {}

if (STEP === 'create') {
  /**
   * 🔴 **닉네임은 자동으로 고른다** (2026-09-08).
   *
   *    16명(Wave3 11 + Wave4 5)을 하나씩 고르게 하면 열여섯 번 멈춘다.
   *    그리고 사람이 고른 이름은 Gate ⑥-B 를 통과할지 모른 채 고른 것이다.
   *    후보 공간은 `persona-nickname-candidates` 에 있고, **누구에게 갈지는
   *    적용 시점의 Gate ⑥-B 가 정한다** — 코드에 배정표를 두지 않는다(Pool §3-2 이유 ②).
   *
   *    🔴 파일(`tmp/persona-<cohort>-displayname.json`)이 있으면 **그것이 이긴다.**
   *       창업자가 직접 고르고 싶을 때의 문은 닫지 않는다.
   */
  const path = displayNamePathOf(COHORT)
  if (existsSync(path)) {
    let selection: Record<string, string>
    try { selection = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, string> }
    catch (e) { await prisma.$disconnect(); fail(`${path} 을 읽을 수 없습니다: ${(e as Error).message}`) }
    const keyProblems = checkCohortKeys(M, Object.keys(selection!))
    if (keyProblems.length > 0) { await prisma.$disconnect(); fail(keyProblems.join(' / ')) }
    creates = M.codes.map((code) => ({ code, name: (selection![code] ?? '').trim() }))
    if (creates.some((c) => c.name === '')) { await prisma.$disconnect(); fail('비어 있는 이름이 있습니다') }
    ok(`이름 선택 파일 사용 (${path}) — ${creates.length}개`)
  } else {
    // 🔴 후보를 만들고 Gate ⑥-B 로 걸러 **자동으로** 고른다
    const sets0 = await loadNameCollisionSets(prisma)
    const auto = assignCandidates(M.codes, (n) => checkNameCollision(n, sets0, { hashOf }).status !== 'pass')
    if (!auto.ok) {
      await prisma.$disconnect()
      fail(`닉네임 후보를 자동으로 고르지 못했습니다:\n     ${auto.problems.join('\n     ')}`)
    }
    creates = M.codes.map((code) => ({ code, name: auto.picked.get(code)! }))
    ok(`닉네임 자동 선정 ${creates.length}개 — 정책 검사 + Gate ⑥-B 통과분에서 골랐다`)
    console.log(`      🔴 파일(${path})을 두면 그것이 우선한다`)
  }
  // 🔴 어느 경로로 왔든 정책은 다시 본다 — 파일로 들어온 이름도 예외가 아니다
  const policyBad = creates
    .map((c) => ({ ...c, v: verifyNamePolicy(c.name) }))
    .filter((x) => !x.v.ok)
  if (policyBad.length > 0) {
    await prisma.$disconnect()
    fail(`작명 정책을 어긴 이름이 ${policyBad.length}개 있습니다:\n`
      + policyBad.map((x) => `     ${x.code}: ${x.v.problems.join(' / ')}`).join('\n'))
  }
  const names = creates.map((c) => c.name)
  if (new Set(names).size !== names.length) { await prisma.$disconnect(); fail('선택된 이름 중 중복이 있습니다') }

  /**
   * 🔴 Gate ⑥-B **사전 검사는 안내다. 최종 판정이 아니다** (2026-09-08, Codex P1-2).
   *
   *    트랜잭션 밖에서만 보면, 검사와 커밋 사이에 회원이 같은 이름을 만들어도 그대로 통과한다.
   *    최종 판정은 아래 Serializable 트랜잭션 **안에서 다시** 한다.
   *    여기서 먼저 보는 이유는 dry-run 이 미리 알려 주기 위해서다.
   */
  const preSets = await loadNameCollisionSets(prisma)
  console.log(`   대조 대상 — ${describeSets(preSets)}`)
  const preVerdicts = creates.map((c) => ({ ...c, v: checkNameCollision(c.name, preSets, { hashOf }) }))

  /**
   * 🔴 **P 코드 → 예정 닉네임과 그 자리의 Gate ⑥-B 결과를 함께 보여 준다** (2026-09-08).
   *
   *    dry-run 이 "전원 pass" 한 줄만 내면, 창업자는 **무슨 이름이 붙을지 모른 채**
   *    `--apply` 를 눌러야 한다. 이름은 회원에게 그대로 보이는 것이라
   *    적용 전에 눈으로 볼 수 있어야 한다.
   *
   *    🔴 여기 적히는 것은 **우리가 만들 persona 의 이름**이다. 대조 대상(회원 닉네임 ·
   *    크롤 author)은 한 글자도 나오지 않는다 — 판정부가 원문을 돌려주지 않기 때문이다.
   */
  console.log('\n   ── 예정 닉네임 (P 코드 → 이름 · Gate ⑥-B)')
  for (const x of preVerdicts) {
    const mark = x.v.status === 'pass' ? '✅ pass' : `🔴 ${x.v.status}`
    console.log(`      ${x.code}  ${x.name.padEnd(6)}  ${mark}  ${x.v.reason}`)
  }
  console.log(`      🔴 적용 시점에 트랜잭션 안에서 다시 판정한다 — 위 결과는 지금 시점의 안내다`)

  const preBlocked = preVerdicts.filter((x) => x.v.status !== 'pass')
  if (preBlocked.length > 0) {
    await prisma.$disconnect()
    fail(`Gate ⑥-B 를 통과하지 못한 이름이 ${preBlocked.length}개 있습니다.\n`
      + `     🔴 일부만 만들지 않습니다 — 전부 중단합니다.\n`
      + preBlocked.map((x) => `     ${x.code}: ${x.v.status} — ${x.v.reason}`).join('\n'))
  }
  ok(`Gate ⑥-B 사전 검사 전원 pass (${creates.length}/${creates.length}) · authorHash 대조 포함`)
  console.log('      🔴 최종 판정은 트랜잭션 안에서 다시 한다 — 지금 통과가 보장은 아니다')
}

if (STEP === 'seed') {
  const path = seedPathOf(COHORT)
  if (!existsSync(path)) {
    await prisma.$disconnect()
    fail(`${path} 이 없습니다. 🔴 다른 회차 파일을 덮어쓰지 마세요.`)
  }
  const raw = readFileSync(path, 'utf-8')
  try { seeds = JSON.parse(raw) as Record<string, Record<string, unknown>> }
  catch (e) { await prisma.$disconnect(); fail(`${path} 을 읽을 수 없습니다: ${(e as Error).message}`) }
  const keyProblems = checkCohortKeys(M, Object.keys(seeds))
  if (keyProblems.length > 0) { await prisma.$disconnect(); fail(keyProblems.join(' / ')) }
  const dupes = duplicateKeys(raw)
  if (dupes.length > 0) { await prisma.$disconnect(); fail(`seed 파일에 중복 코드: ${dupes.join(', ')}`) }

  // 🔴 정본 대조 — 금지값 · 필수 축 · Pool 카드 일치
  let bad = 0
  for (const code of M.codes) {
    const problems = verifySeedCard(code, seeds[code]!, poolOf.get(code) ?? null)
    if (problems.length === 0) console.log(`   ✅ ${code}  필수 축 · 제어값 · 정합 · 정본 일치 · 금지값 0`)
    else { bad += 1; console.log(`   🔴 ${code}  ${problems.join(' / ')}`) }
  }
  if (bad > 0) { await prisma.$disconnect(); fail(`seed ${bad}명이 정본과 어긋납니다 — 🔴 일부만 적용하지 않습니다`) }
}

if (STEP === 'activate') {
  // 🔴 실회원 판별은 정본 하나뿐이다
  const real = states
    .map((s) => ({ code: s.code, v: judgeRealMember({ accountCount: s.accountCount, providerId: s.providerId }) }))
    .flatMap((x) => (x.v.real ? [`${x.code}: ${x.v.reason}`] : []))
  if (real.length > 0) { await prisma.$disconnect(); fail(`실회원 계정에 연결된 persona 가 있습니다:\n     ${real.join('\n     ')}`) }
  ok(`${M.codes.length}명 전부 draft · 닉네임 · seed 완료 · Account 0`)
}

// ── 🔴 건드리지 않기로 한 것 ──
const snapshot = async (): Promise<Record<string, number>> => ({
  posts: await prisma.post.count(),
  comments: await prisma.comment.count(),
  queue: await prisma.originalPostApprovalQueue.count(),
  activity: await prisma.personaActivityLog.count(),
  raw: await prisma.microSeedRawContent.count(),
  ...(STEP === 'create' ? {} : { users: await prisma.user.count(), personas: await prisma.persona.count() }),
})
const before = await snapshot()

console.log('\n══ 적용 예정 ══')
if (STEP === 'create') {
  console.log(`   User            +${M.codes.length}`)
  console.log(`   Persona         +${M.codes.length}   status=${DRAFT}`)
  console.log(`   PersonaAuditLog +${M.codes.length * 2}  (created · display_name_assigned)`)
  console.log('   🔴 seed 는 넣지 않는다 — 다음 단계(--step=seed)다')
} else if (STEP === 'seed') {
  console.log(`   Persona ${M.codes.length}행의 identity · voiceCore · voiceVariations · activityRhythm · noGo* · cap 을 채운다`)
  console.log('   🔴 status 는 draft 그대로 · 새 행 0')
} else if (STEP === 'activate') {
  console.log(`   Persona ${M.codes.length}행 status draft → active · PersonaAuditLog +${M.codes.length} (status_changed)`)
  console.log('   🔴 켠다고 말이 나가지 않는다 — 발행은 auto-publish 러너가 스케줄에 따라 한다')
} else {
  console.log(`   Persona ${M.codes.length}행 status active → paused · PersonaAuditLog +${M.codes.length} (status_changed)`)
}
console.log(`   🔴 건드리지 않는 것: ${Object.entries(before).map(([k, v]) => `${k} ${v}`).join(' · ')}`)

// ── 🔴 실행 게이트 ──
const gate = judgeArgs({
  apply: APPLY, limit: LIMIT, actorUserId: ACTOR, reason: REASON,
  cohortSize: M.codes.length, requireActor: requiresActor(STEP),
})
if (!gate.ok) {
  console.log(`\n🟡 적용하지 않습니다 — ${gate.reason}`)
  console.log('   DB write 0.')
  console.log(`   실제 적용: ${requiresActor(STEP) ? 'ACTOR_USER_ID=<id> ' : ''}npx tsx scripts/persona-cohort-run.mts`
    + ` --cohort=${COHORT} --step=${STEP} --apply --limit=${M.codes.length}${requiresActor(STEP) ? ' --reason "..."' : ''}\n`)
  await prisma.$disconnect()
  process.exit(0)
}

// ── 적용 — 🔴 회차 전원이 하나의 Serializable 트랜잭션이다 ──
const AUDIT_REASON = `cohort ${COHORT} — ${M.purpose}`
try {
  await prisma.$transaction(async (tx) => {
    // 🔴 **트랜잭션 안에서 다시 본다** (TOCTOU). 읽은 뒤 쓰기까지 사이에 누가
    //    status 를 바꾸거나 계정을 붙였을 수 있다. 하나라도 어긋나면 throw → 전원 롤백
    const fresh = await readDbRows(tx, M.codes)
    if (STEP === 'create') {
      if (fresh.length > 0) throw new Error(`트랜잭션 안 재확인 실패 — 이미 존재: ${fresh.map((r) => r.code).join(', ')}`)
      /**
       * 🔴 **Gate ⑥-B 최종 판정 — 트랜잭션 안이다.**
       *    사전 검사와 커밋 사이에 회원이 같은 이름을 만들었을 수 있다.
       *    하나라도 걸리면 throw → 전원 롤백. 일부만 만들지 않는다.
       */
      const txSets = await loadNameCollisionSets(tx)
      const txBlocked = creates
        .map((c) => ({ ...c, v: checkNameCollision(c.name, txSets, { hashOf }) }))
        .filter((x) => x.v.status !== 'pass')
      if (txBlocked.length > 0) {
        throw new Error('트랜잭션 안 Gate ⑥-B 재판정 실패 — '
          + txBlocked.map((x) => `${x.code}: ${x.v.status}(${x.v.reason})`).join(' / '))
      }
      for (const { code, name } of creates) {
        // 🔴 기존 User 를 재사용하지 않는다 — Account 가 붙은 계정을 주우면 그 사람 이름으로 글이 나간다
        const user = await tx.user.create({ data: { nickname: name }, select: { id: true } })
        const persona = await tx.persona.create({ data: { code, userId: user.id, status: DRAFT }, select: { id: true } })
        await tx.personaAuditLog.create({ data: { personaId: persona.id, action: 'created', toStatus: DRAFT, reason: AUDIT_REASON } })
        await tx.personaAuditLog.create({ data: { personaId: persona.id, action: 'display_name_assigned', reason: 'Gate ⑥-B pass 후 배정' } })
      }
      return
    }

    const expect = STEP === 'pause' ? 'active' : DRAFT
    if (STEP === 'pause') {
      /**
       * 🔴 **pause 는 비상 조치다** (2026-09-08, Codex P1-1).
       *    Account 가 붙었거나 seed 가 불완전하다는 이유로 막히면,
       *    **정확히 그 위험한 사람을 멈출 수 없게 된다.**
       *    그래서 여기서는 "있는가 · active 인가" 만 본다. 나머지 계약은 아래 조건부 write 와 audit 이 지킨다.
       */
      const missing = M.codes.filter((c) => !fresh.some((r) => r.code === c))
      if (missing.length > 0) throw new Error(`트랜잭션 안 재확인 실패 — 대상이 없다: ${missing.join(', ')}`)
      const notActive = fresh.filter((r) => r.status !== 'active').map((r) => `${r.code}=${r.status}`)
      if (notActive.length > 0) throw new Error(`트랜잭션 안 재확인 실패 — active 가 아니다: ${notActive.join(', ')}`)
    } else {
      const pre = preflightAll(M.codes.map((c) => ({ row: fresh.find((x) => x.code === c)!, poolCard: poolOf.get(c) ?? null })), expect)
      // 🔴 seed 적용 **전**이므로 seed 미완은 정상이다 — 그것만 제외하고 본다
      const blocking = STEP === 'seed' ? pre.problems.filter((x) => !x.includes('seed 미완')) : pre.problems
      if (blocking.length > 0) throw new Error(`트랜잭션 안 재확인 실패 — ${blocking.join(' / ')}`)
    }

    for (const code of M.codes) {
      // 🔴 **조건부 write** — 기대 status 인 행만 고친다. 읽은 뒤 바뀌었으면 count 가 0 이 되어 throw
      const data = STEP === 'seed'
        ? (() => {
          const c = seeds[code]!
          return {
            ageBand: c.ageBand as string, region: c.region as string, lifeStage: c.lifeStage as string,
            identity: c.identity as never, voiceCore: c.voiceCore as never,
            voiceVariations: c.voiceVariations as never, activityRhythm: c.activityRhythm as never,
            noGoTopics: c.noGoTopics as string[], noGoExpressions: c.noGoExpressions as string[],
            forbiddenReactionRoles: c.forbiddenReactionRoles as string[],
            dailyCap: c.dailyCap as number, weeklyCap: c.weeklyCap as number,
            silenceRate: c.silenceRate as never,
            // 🔴 status 를 건드리지 않는다 — 켜는 것은 별도 승인이 필요한 다른 단계다
          }
        })()
        : STEP === 'activate'
          ? { status: 'active' as PersonaStatus, activatedAt: new Date() }
          : { status: 'paused' as PersonaStatus }

      const u = await tx.persona.updateMany({ where: { code, status: expect }, data })
      if (u.count !== 1) throw new Error(`${code}: 조건부 update 가 ${u.count}건 — 읽은 뒤 status 가 바뀌었다 (전원 롤백)`)

      const p = await tx.persona.findUniqueOrThrow({ where: { code }, select: { id: true } })
      await tx.personaAuditLog.create({
        data: STEP === 'seed'
          // 🔴 enum 에 있는 값만 쓴다 — schema 를 바꾸지 않는다 (migration 금지)
          ? { personaId: p.id, action: 'updated', reason: `seed 적용 — Pool 카드(§5) 정본 대조 통과 · ${AUDIT_REASON}` }
          : {
            personaId: p.id, action: 'status_changed',
            fromStatus: expect as PersonaStatus, toStatus: (STEP === 'activate' ? 'active' : 'paused') as PersonaStatus,
            actorUserId: ACTOR, reason: REASON,
          },
      })
    }
  },
  // 🔴 **Serializable** — Account 가 트랜잭션 중간에 붙는 경합까지 막는다.
  //    조건부 update 는 `status` 만 지킨다. Account 는 다른 테이블이라 그것만으로는 부족하다
  { isolationLevel: 'Serializable' })
} catch (e) {
  await prisma.$disconnect()
  fail(`${STEP} 실패 — ${M.codes.length}명 전원 롤백했습니다 (write 0): ${(e as Error).message}`)
}
ok(`${STEP} 완료 (Serializable 트랜잭션 커밋)`)

// ── 🔴 사후 대조 — 건드리지 않기로 한 것이 그대로인가 ──
const after = await snapshot()
const drift = Object.entries(after).filter(([k, v]) => v !== before[k])
if (drift.length > 0) {
  await prisma.$disconnect()
  fail(`🔴 건드리지 않기로 한 것이 변했습니다: ${drift.map(([k, v]) => `${k} ${before[k]}→${v}`).join(' · ')}`)
}
ok('Post · Comment · Queue · ActivityLog · MicroSeedRawContent 불변')

for (const s of toStates(await readDbRows(prisma, M.codes))) {
  console.log(`   ${s.code} ${stageOf(s)} status=${s.status}`)
}
console.log(`\n   다음: npx tsx scripts/persona-cohort-run.mts --cohort=${COHORT} --step=check\n`)

await prisma.$disconnect()
