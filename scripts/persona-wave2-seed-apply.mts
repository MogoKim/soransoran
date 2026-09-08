#!/usr/bin/env tsx
/**
 * Persona 2차 확장 — seed 적용 (identity · voiceCore · …). 🔴 **기본은 dry-run**
 *
 * 대상: P01 · P02 · P11 만. 🔴 인자로 code 를 받지 않는다.
 *
 * 사용법
 *   npx tsx scripts/persona-wave2-seed-apply.mts           # dry-run — DB write 0
 *   npx tsx scripts/persona-wave2-seed-apply.mts --apply   # 실제 적용
 *   npx tsx scripts/persona-wave2-seed-apply.mts --check   # 반영 상태 검증
 *
 * 🔴 seed 는 `tmp/persona-wave2-seed.json` (gitignored) 에서 읽는다.
 *    MVP 5명 파일(`tmp/persona-seed.json`)은 **건드리지 않는다.**
 *
 * 🔴 **정본과 대조한다.** Pool 카드(§5)에서 파생하지 않은 값이 들어오면 거절한다 —
 *    시뮬레이션한 사람과 만들어질 사람이 달라지면 "이 조합이면 7건" 이 검증되지 않은 값 위에 선다.
 *
 * 🔴 이 스크립트가 하지 않는 것
 *      · status 를 active 로 올리는 것 — draft 그대로 둔다
 *      · User · 닉네임 생성 — 이전 단계(persona-wave2-assign)다
 *      · Post · Comment · Queue · ActivityLog
 */
import { PrismaClient, type Prisma } from '@prisma/client'
import { readFileSync, existsSync } from 'node:fs'

import { WAVE2_CODES, WAVE2_SEED_PATH, checkWave2Keys, judgeSeed, type Wave2State } from '../src/lib/persona-wave2'
import { parsePoolDoc, type PoolCard } from '../src/lib/persona-pool-card'
import { verifySeedCard, duplicateKeys } from '../src/lib/persona-card-verify'
import { preflightAll, verifyPersonaSeed, type PersonaDbRow } from '../src/lib/persona-wave2-verify'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const APPLY = process.argv.includes('--apply')
const CHECK = process.argv.includes('--check')
const POOL_DOC = 'docs/operations/2026-08-30-persona-pool-design.md'

const fail = (m: string): never => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }
const ok = (m: string): void => console.log(`   ✅ ${m}`)

/** 🔴 매칭이 반드시 읽는 축 — 하나라도 비면 그 사람은 조용히 배제되거나 잘못 판정된다 */
const MATCH_AXES = ['maritalStatus', 'childrenCount', 'childrenAgeBands', 'parentCare', 'menopauseStatus'] as const

await loadEnvLocal()
const prisma = new PrismaClient()

console.log(`\n══ Persona 2차 seed — ${APPLY ? '🔴 실제 적용' : CHECK ? '검증' : 'dry-run (DB write 0)'} ══\n`)
console.log(`  대상  ${WAVE2_CODES.join(' · ')}`)

/** 🔴 DB 값을 그대로 읽는다 — 입력 파일이 아니라 **저장된 것**을 본다 */
async function readDbRows(client: PrismaClient | Prisma.TransactionClient): Promise<PersonaDbRow[]> {
  const rows = await client.persona.findMany({
    where: { code: { in: [...WAVE2_CODES] } },
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

/** 순서 게이트용 요약 — 🔴 `seeded` 는 **전체 seed 정합**으로 판정한다 */
function toStates(rows: readonly PersonaDbRow[], poolOf: Map<string, PoolCard>): Wave2State[] {
  return WAVE2_CODES.map((code) => {
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

// 🔴 정본 Pool 을 먼저 읽는다 — 모든 판정이 이것을 기준으로 한다
const poolDoc = parsePoolDoc(readFileSync(POOL_DOC, 'utf-8'))
if (poolDoc.problems.length > 0) {
  await prisma.$disconnect()
  fail(`정본 Pool 문서 파싱 문제 ${poolDoc.problems.length}건: ${poolDoc.problems.join(' / ')}`)
}
const poolOf = new Map(poolDoc.cards.map((c) => [c.code, c]))

const dbRows = await readDbRows(prisma)
const states = toStates(dbRows, poolOf)

// ── --check — 🔴 **입력 파일이 아니라 DB 전체 값**을 정본과 대조한다 ──
if (CHECK) {
  let failed = 0
  for (const code of WAVE2_CODES) {
    const r = dbRows.find((x) => x.code === code)
    if (r === undefined) { console.log(`  🔴 ${code}  없다`); failed += 1; continue }
    const seed = verifyPersonaSeed(r, poolOf.get(code) ?? null)
    const draft = r.status === 'draft'
    const good = seed.complete && draft
    console.log(`  ${good ? '✅' : '🔴'} ${code}  status=${r.status}${draft ? '' : ' 🔴 draft 여야 한다'}`
      + ` · seed ${seed.complete ? '정본 일치' : `🔴 ${seed.problems.join(' / ')}`}`)
    if (!good) failed += 1
  }
  await prisma.$disconnect()
  console.log(failed === 0 ? '\n✅ DB 전체 값이 정본과 일치 · status=draft 유지\n' : `\n🔴 ${failed}명 이상\n`)
  process.exit(failed === 0 ? 0 : 1)
}

// ── 🔴 순서 게이트 — 생성이 먼저다 ──
const order = judgeSeed(states)
if (!order.ok) {
  await prisma.$disconnect()
  fail(`seed 를 적용할 수 없습니다:\n     ${order.problems.join('\n     ')}\n`
    + `     🔴 순서는 생성 → seed → 검증 → 활성화 다.\n`
    + `     먼저: npx tsx scripts/persona-wave2-assign.mts --apply`)
}
ok(`대상 ${WAVE2_CODES.length}명 전부 draft 로 존재`)

// ── seed 파일 ──
if (!existsSync(WAVE2_SEED_PATH)) {
  await prisma.$disconnect()
  fail(`${WAVE2_SEED_PATH} 이 없습니다.\n     🔴 MVP 5명 파일(tmp/persona-seed.json)을 덮어쓰지 마세요.`)
}
const raw = readFileSync(WAVE2_SEED_PATH, 'utf-8')
let seeds: Record<string, Record<string, unknown>>
try { seeds = JSON.parse(raw) as Record<string, Record<string, unknown>> }
catch (e) { await prisma.$disconnect(); fail(`${WAVE2_SEED_PATH} 을 읽을 수 없습니다: ${(e as Error).message}`) }

const keyProblems = checkWave2Keys(Object.keys(seeds!))
if (keyProblems.length > 0) { await prisma.$disconnect(); fail(keyProblems.join(' / ')) }
const dupes = duplicateKeys(raw)
if (dupes.length > 0) { await prisma.$disconnect(); fail(`seed 파일에 중복 코드: ${dupes.join(', ')}`) }
ok(`seed 파일 ${WAVE2_CODES.length}명`)

// ── 🔴 정본 대조 — 금지값 · 필수 축 · Pool 카드 일치 ──
let bad = 0
for (const code of WAVE2_CODES) {
  const problems = verifySeedCard(code, seeds![code]!, poolOf.get(code) ?? null)
  if (problems.length === 0) console.log(`   ✅ ${code}  필수 축 · 제어값 · 정합 · 정본 일치 · 금지값 0`)
  else { bad += 1; console.log(`   🔴 ${code}  ${problems.join(' / ')}`) }
}
if (bad > 0) { await prisma.$disconnect(); fail(`seed ${bad}명이 정본과 어긋납니다 — 🔴 일부만 적용하지 않습니다`) }

const before = {
  posts: await prisma.post.count(), comments: await prisma.comment.count(),
  queue: await prisma.originalPostApprovalQueue.count(), activity: await prisma.personaActivityLog.count(),
  personas: await prisma.persona.count(), users: await prisma.user.count(),
}
console.log('\n══ 적용 예정 ══')
console.log(`   Persona ${WAVE2_CODES.length}행의 identity · voiceCore · voiceVariations · activityRhythm · noGo* · cap 을 채운다`)
console.log(`   🔴 status 는 draft 그대로 · 새 행 0 (Persona ${before.personas} · User ${before.users} 불변)`)
console.log(`   🔴 건드리지 않는 것: Post ${before.posts} · Comment ${before.comments} · Queue ${before.queue} · ActivityLog ${before.activity}`)

if (!APPLY) {
  console.log('\n🟡 dry-run 입니다. DB write 0.')
  console.log('   실제 적용: npx tsx scripts/persona-wave2-seed-apply.mts --apply\n')
  await prisma.$disconnect()
  process.exit(0)
}

// ── 적용 — 🔴 세 명이 하나의 트랜잭션 ──
try {
  await prisma.$transaction(async (tx) => {
    // 🔴 **트랜잭션 안에서 다시 본다.** 읽은 뒤 쓰기까지 사이에 누가 status 를 바꾸거나
    //    계정을 붙였을 수 있다. 하나라도 어긋나면 throw 해서 3명 전부 write 0 으로 롤백한다
    const fresh = await readDbRows(tx)
    const pre = preflightAll(
      WAVE2_CODES.map((c) => ({ row: fresh.find((x) => x.code === c)!, poolCard: poolOf.get(c) ?? null })),
      'draft',
    )
    // 🔴 seed 적용 **전**이므로 seed 미완은 정상이다 — 그것만 제외하고 본다
    const blocking = pre.problems.filter((x) => !x.includes('seed 미완'))
    if (blocking.length > 0) throw new Error(`트랜잭션 안 재확인 실패 — ${blocking.join(' / ')}`)

    for (const code of WAVE2_CODES) {
      const c = seeds![code]!
      // 🔴 **조건부 write** — `status=draft` 인 행만 고친다.
      //    읽고 나서 쓰기까지 사이에 누가 켜거나 멈췄으면 `count` 가 0 이 되어 throw 한다.
      //    `update` 는 code 만 보므로 그 변경을 덮어써 버린다 — 그것이 결함이었다
      const u = await tx.persona.updateMany({
        where: { code, status: 'draft' },
        data: {
          ageBand: c.ageBand as string, region: c.region as string, lifeStage: c.lifeStage as string,
          identity: c.identity as never, voiceCore: c.voiceCore as never,
          voiceVariations: c.voiceVariations as never, activityRhythm: c.activityRhythm as never,
          noGoTopics: c.noGoTopics as string[], noGoExpressions: c.noGoExpressions as string[],
          forbiddenReactionRoles: c.forbiddenReactionRoles as string[],
          dailyCap: c.dailyCap as number, weeklyCap: c.weeklyCap as number,
          silenceRate: c.silenceRate as never,
          // 🔴 status 를 건드리지 않는다 — 켜는 것은 별도 승인이 필요한 다른 단계다
        },
      })
      if (u.count !== 1) {
        throw new Error(`${code}: 조건부 update 가 ${u.count}건 — 읽은 뒤 status 가 바뀌었다 (전부 롤백)`)
      }
      const p = await tx.persona.findUniqueOrThrow({ where: { code }, select: { id: true } })
      await tx.personaAuditLog.create({
        // 🔴 enum 에 있는 값만 쓴다 — schema 를 바꾸지 않는다 (migration 금지)
        data: { personaId: p.id, action: 'updated', reason: 'seed 적용 — Pool 카드(§5) 정본 대조 통과' },
      })
    }
  },
  // 🔴 **Serializable** — Account 가 트랜잭션 중간에 붙는 경합까지 막는다.
  //    조건부 update 는 `status` 만 지킨다. Account 는 다른 테이블이라 그것만으로는 부족하다
  { isolationLevel: 'Serializable' })
} catch (e) {
  await prisma.$disconnect()
  fail(`적용 실패 — 3명 전부 롤백했습니다 (write 0): ${(e as Error).message}`)
}
ok('적용 완료 (Serializable 트랜잭션 커밋)')

const after = {
  posts: await prisma.post.count(), comments: await prisma.comment.count(),
  queue: await prisma.originalPostApprovalQueue.count(), activity: await prisma.personaActivityLog.count(),
  personas: await prisma.persona.count(), users: await prisma.user.count(),
}
const drift = Object.entries(after).filter(([k, v]) => v !== before[k as keyof typeof before])
if (drift.length > 0) {
  await prisma.$disconnect()
  fail(`🔴 건드리지 않기로 한 것이 변했습니다: ${drift.map(([k, v]) => `${k} ${before[k as keyof typeof before]}→${v}`).join(' · ')}`)
}
ok('Post · Comment · Queue · ActivityLog · 행 수 불변')

for (const s of toStates(await readDbRows(prisma), poolOf)) {
  if (s.status !== 'draft') { await prisma.$disconnect(); fail(`🔴 ${s.code} status 가 ${s.status} 다 — draft 여야 한다`) }
}
ok('status=draft 유지')
console.log('\n   다음: npx tsx scripts/persona-wave2-seed-apply.mts --check')
console.log('   그다음(승인 후): npx tsx scripts/persona-wave2-activate.mts\n')

await prisma.$disconnect()
