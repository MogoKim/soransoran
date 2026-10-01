#!/usr/bin/env tsx
/**
 * Persona 2차 확장 — User + Persona(draft) 생성. 🔴 **기본은 dry-run**
 *
 * 대상: P01 · P02 · P11 (`src/lib/persona-wave2.ts` 에 못박혀 있다)
 *
 * 사용법
 *   npx tsx scripts/persona-wave2-assign.mts           # dry-run — DB write 0
 *   npx tsx scripts/persona-wave2-assign.mts --apply   # 실제 생성 (draft)
 *   npx tsx scripts/persona-wave2-assign.mts --check   # 생성 결과 검증
 *
 * 🔴 **인자로 code 를 받지 않는다.** 대상이 바뀌면 스크립트를 새로 만든다.
 *
 * 🔴 닉네임을 이 파일에 하드코딩하지 않는다 (헌법 §9-6 · Pool §3-2 이유 ②).
 *    `tmp/persona-wave2-displayname.json` (gitignored) 에서 읽는다.
 *    🔴 MVP 5명 파일(`tmp/persona-displayname-selected.json`)은 **건드리지 않는다.**
 *
 * 🔴 이 스크립트가 하지 않는 것
 *      · seed (identity · voiceCore · memory) — 별도 단계다
 *      · status 를 active 로 올리는 것 — draft 로만 만든다
 *      · Post · Comment · Queue · ActivityLog · personaId 값
 *      · 기존 User 재사용 — 항상 새로 만든다
 */
import { PrismaClient, type PersonaStatus } from '@prisma/client'
import { readFileSync, existsSync } from 'node:fs'

import {
  WAVE2_CODES, WAVE2_DISPLAYNAME_PATH, checkWave2Keys, judgeCreate, type Wave2State,
} from '../src/lib/persona-wave2'
import { judgeRealMember } from '../src/lib/real-member-gate'
import { checkNameCollision } from './lib/persona-gate-name-collision.mjs'
import { loadNameCollisionSets, describeSets } from './lib/persona-name-collision-sets.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import type { NameCollisionSets } from './lib/persona-gate-name-collision.mjs'

const APPLY = process.argv.includes('--apply')
const CHECK = process.argv.includes('--check')
const DRAFT: PersonaStatus = 'draft'
const AUDIT_REASON = 'Persona 2차 확장 (P01·P02·P11) — planner 364조합 전수 근거'

const fail = (m: string): never => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }
const ok = (m: string): void => console.log(`   ✅ ${m}`)

await loadEnvLocal()
const prisma = new PrismaClient()

console.log(`\n══ Persona 2차 확장 — ${APPLY ? '🔴 실제 생성' : CHECK ? '검증' : 'dry-run (DB write 0)'} ══\n`)
console.log(`  대상  ${WAVE2_CODES.join(' · ')}  🔴 코드에 못박혀 있다 — 인자로 바꿀 수 없다`)

// ── 현재 상태 ──
async function readStates(): Promise<Wave2State[]> {
  const rows = await prisma.persona.findMany({
    where: { code: { in: [...WAVE2_CODES] } },
    select: {
      code: true, status: true, identity: true,
      user: { select: { nickname: true, providerId: true, _count: { select: { accounts: true } } } },
    },
  })
  return WAVE2_CODES.map((code) => {
    const r = rows.find((x) => x.code === code)
    if (r === undefined) {
      return { code, exists: false, status: null, hasNickname: false, seeded: false, accountCount: null, providerId: null }
    }
    const id = (r.identity ?? {}) as Record<string, unknown>
    return {
      code, exists: true, status: r.status,
      hasNickname: (r.user?.nickname ?? '').trim() !== '',
      seeded: typeof id.childrenCount === 'number' && typeof id.maritalStatus === 'string',
      accountCount: r.user?._count.accounts ?? null,
      providerId: r.user?.providerId ?? null,
    }
  })
}

const states = await readStates()

// ── --check ──
if (CHECK) {
  let failed = 0
  for (const s of states) {
    const good = s.exists && s.status === DRAFT && s.hasNickname
      && !judgeRealMember({ accountCount: s.accountCount, providerId: s.providerId }).real
    console.log(`  ${good ? '✅' : '🔴'} ${s.code}  ${s.exists ? `status=${s.status}` : '없음'}`
      + ` · 닉네임 ${s.hasNickname ? '있음' : '🔴 없음'} · Account ${s.accountCount ?? '?'}`)
    if (!good) failed += 1
  }
  // 🔴 **persona 한 명씩** 센다. `action` 별 총합만 보면
  //    한 명에 두 번 남고 다른 한 명은 0건이어도 3건이라 통과한다 — 그것이 결함이었다
  const logRows = await prisma.personaAuditLog.groupBy({
    by: ['personaId', 'action'],
    where: { persona: { code: { in: [...WAVE2_CODES] } }, action: { in: ['created', 'display_name_assigned'] } },
    _count: { _all: true },
  })
  const idOf = new Map(
    (await prisma.persona.findMany({ where: { code: { in: [...WAVE2_CODES] } }, select: { id: true, code: true } }))
      .map((r) => [r.code, r.id]),
  )
  for (const code of WAVE2_CODES) {
    const pid = idOf.get(code)
    for (const a of ['created', 'display_name_assigned'] as const) {
      const n = pid === undefined ? 0 : (logRows.find((x) => x.personaId === pid && x.action === a)?._count._all ?? 0)
      const good = n === 1
      console.log(`  ${good ? '✅' : '🔴'} ${code} AuditLog ${a} ${n}건 (1이어야 한다)`)
      if (!good) failed += 1
    }
  }
  await prisma.$disconnect()
  console.log(failed === 0 ? '\n✅ 검증 통과\n' : `\n🔴 ${failed}건 이상\n`)
  process.exit(failed === 0 ? 0 : 1)
}

// ── 순서 게이트 — 🔴 이미 있으면 전부 중단 ──
const created = judgeCreate(states)
if (!created.ok) { await prisma.$disconnect(); fail(`생성할 수 없습니다:\n     ${created.problems.join('\n     ')}`) }
ok(`대상 ${WAVE2_CODES.length}명 전부 없음 — 새로 만든다`)

// ── 닉네임 선택 파일 ──
if (!existsSync(WAVE2_DISPLAYNAME_PATH)) {
  await prisma.$disconnect()
  fail(`${WAVE2_DISPLAYNAME_PATH} 이 없습니다.\n`
    + `     창업자가 고른 이름을 {"P01":"...","P02":"...","P11":"..."} 형식으로 두세요 (tmp/ 는 gitignored).\n`
    + `     🔴 MVP 5명 파일(tmp/persona-displayname-selected.json)을 덮어쓰지 마세요.`)
}
let selection: Record<string, string>
try { selection = JSON.parse(readFileSync(WAVE2_DISPLAYNAME_PATH, 'utf-8')) as Record<string, string> }
catch (e) { await prisma.$disconnect(); fail(`${WAVE2_DISPLAYNAME_PATH} 을 읽을 수 없습니다: ${(e as Error).message}`) }

const keyProblems = checkWave2Keys(Object.keys(selection!))
if (keyProblems.length > 0) { await prisma.$disconnect(); fail(keyProblems.join(' / ')) }
const names = WAVE2_CODES.map((c) => (selection![c] ?? '').trim())
if (names.some((n) => n === '')) { await prisma.$disconnect(); fail('비어 있는 이름이 있습니다') }
if (new Set(names).size !== names.length) { await prisma.$disconnect(); fail('선택된 이름 중 중복이 있습니다') }
ok(`이름 선택 ${names.length}개`)

// ── 🔴 Gate ⑥-B — **적용 직전에 다시 본다.** 작명과 배정 사이에 회원이 같은 이름을 만들 수 있다 ──
const sets = await loadNameCollisionSets(prisma)
console.log(`   대조 대상 — ${describeSets(sets)}`)
const verdicts = WAVE2_CODES.map((code, i) => ({ code, name: names[i]!, v: checkNameCollision(names[i]!, sets) }))
const blocked = verdicts.filter((x) => x.v.status !== 'pass')
if (blocked.length > 0) {
  await prisma.$disconnect()
  fail(`Gate ⑥-B 를 통과하지 못한 이름이 ${blocked.length}개 있습니다.\n`
    + `     🔴 일부만 만들지 않습니다 — 전부 중단합니다.\n`
    + blocked.map((x) => `     ${x.code}: ${x.v.status} — ${x.v.reason}`).join('\n'))
}
ok(`Gate ⑥-B 전원 pass (${verdicts.length}/${verdicts.length})`)

// ── 생성 예정 ──
const before = {
  users: await prisma.user.count(), personas: await prisma.persona.count(),
  logs: await prisma.personaAuditLog.count(), posts: await prisma.post.count(),
  comments: await prisma.comment.count(), queue: await prisma.originalPostApprovalQueue.count(),
  activity: await prisma.personaActivityLog.count(),
}
console.log('\n══ 생성 예정 ══')
console.log(`   User            +${WAVE2_CODES.length}   (현재 ${before.users})`)
console.log(`   Persona         +${WAVE2_CODES.length}   (현재 ${before.personas}) · status=${DRAFT}`)
console.log(`   PersonaAuditLog +${WAVE2_CODES.length * 2}  (현재 ${before.logs})`)
console.log(`\n   🔴 건드리지 않는 것: Post ${before.posts} · Comment ${before.comments} · Queue ${before.queue} · ActivityLog ${before.activity}`)
console.log('   🔴 seed 는 넣지 않는다 — 다음 단계(persona-wave2-seed-apply)다')

if (!APPLY) {
  console.log('\n🟡 dry-run 입니다. DB write 0.')
  console.log('   실제 적용: npx tsx scripts/persona-wave2-assign.mts --apply\n')
  await prisma.$disconnect()
  process.exit(0)
}

// ── 적용 — 🔴 세 명이 하나의 트랜잭션이다 ──
try {
  await prisma.$transaction(async (tx) => {
    for (const { code, name } of verdicts) {
      // 🔴 기존 User 를 재사용하지 않는다. 항상 새로 만든다 —
      //    Account 가 붙은 계정을 주우면 그 사람 이름으로 글이 나간다
      const user = await tx.user.create({ data: { nickname: name }, select: { id: true } })
      const persona = await tx.persona.create({
        data: { code, userId: user.id, status: DRAFT }, select: { id: true },
      })
      await tx.personaAuditLog.create({
        data: { personaId: persona.id, action: 'created', toStatus: DRAFT, reason: AUDIT_REASON },
      })
      await tx.personaAuditLog.create({
        data: { personaId: persona.id, action: 'display_name_assigned', reason: 'Gate ⑥-B pass 후 배정' },
      })
    }
  })
} catch (e) {
  await prisma.$disconnect()
  fail(`적용 실패 — 롤백했습니다: ${(e as Error).message}`)
}
ok('적용 완료 (트랜잭션 커밋)')

// ── 🔴 사후 대조 — 건드리지 않기로 한 것이 그대로인가 ──
const after = {
  posts: await prisma.post.count(), comments: await prisma.comment.count(),
  queue: await prisma.originalPostApprovalQueue.count(), activity: await prisma.personaActivityLog.count(),
}
const drift = Object.entries(after).filter(([k, v]) => v !== before[k as keyof typeof before])
if (drift.length > 0) {
  await prisma.$disconnect()
  fail(`🔴 건드리지 않기로 한 테이블이 변했습니다: ${drift.map(([k, v]) => `${k} ${before[k as keyof typeof before]}→${v}`).join(' · ')}`)
}
ok(`Post · Comment · Queue · ActivityLog 불변`)

const post = await readStates()
for (const s of post) console.log(`   ${s.code} status=${s.status} · 닉네임 ${s.hasNickname ? '있음' : '없음'} · seed ${s.seeded ? '있음' : '🔴 없음(다음 단계)'}`)
console.log('\n   다음: npx tsx scripts/persona-wave2-seed-apply.mts        (dry-run)')
console.log('   🔴 seed 를 넣기 전에는 켜지 않는다 — 매칭이 기본값으로 잘못 판정한다\n')

await prisma.$disconnect()
