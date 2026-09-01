#!/usr/bin/env tsx
/**
 * P05 한 명만 draft → active — 🔴 기본은 dry-run. 이번 판에서는 --apply 를 돌리지 않는다
 *
 * 정본: docs/operations/2026-08-31-persona-db-model-design.md §5 · §10-1
 *
 * 왜 이 스크립트가 필요한가
 *   발행 경로(persona-publish-*)는 `status === 'active'` 만 통과시킨다. 그런데 지금
 *   페르소나 5명이 전부 draft 라 **발행 가능한 페르소나가 0명**이다. 그렇다고 발행
 *   게이트에서 draft 를 허용하면 status 층 자체가 무의미해진다(§7-2 의 3층 분리).
 *   그래서 게이트를 낮추는 대신, **한 명만 여는 손잡이**를 따로 둔다.
 *
 * 🔴 대상을 코드로 못박는다 — P05 하나뿐이다.
 *    인자로 code 를 받으면 "그때그때 다른 페르소나를 켜는 도구" 가 된다.
 *    첫 발행 검증에 필요한 것은 한 명이고, 그 한 명은 창업자가 정했다.
 *
 * 🔴 write 는 두 곳이다 — Persona 1행 + PersonaAuditLog 1행. 한 트랜잭션이다.
 *      Persona          status: draft → active · activatedAt
 *      PersonaAuditLog  action: status_changed (누가 · 언제 · 왜)
 *    감사 로그 없이 상태만 바꾸지 않는다. "왜 켰나" 가 없으면 되돌릴 근거가 사라진다.
 *
 * 🔴 이 스크립트가 하지 않는 것
 *      · 발행 — 켜기만 한다. 발행은 persona-publish-live.mts 가 별도로 한다
 *      · kill switch 조작 — 다른 층이다(§7-2)
 *      · cap 설정 — dailyCap · weeklyCap 이 NULL 이면 발행은 여전히 막힌다.
 *        🔴 켠다고 말이 나가지 않는다. 그것이 3층 분리의 요점이다
 *      · retired → active — 애초에 대상이 P05 draft 뿐이라 도달하지 않는다
 *
 * 사용법
 *   npx tsx scripts/persona-activate-p05.mts                          dry-run
 *   ACTOR_USER_ID=<id> npx tsx scripts/persona-activate-p05.mts --apply --reason "첫 발행 검증"
 *   npx tsx scripts/persona-activate-p05.mts --check                  현재 상태 대조
 *
 * 🔴 ACTOR_USER_ID 는 환경변수로 받는다. 셸 히스토리에 남기지 않기 위해서다.
 *
 * 종료 코드: 대상이 없거나 조건 미충족이면 1
 */
import { PrismaClient } from '@prisma/client'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

/** 🔴 대상은 하나다. 인자로 받지 않는다 */
const TARGET_CODE = 'P05'

const argv = process.argv.slice(2)
const arg = (k: string): string | undefined => {
  const i = argv.indexOf(k)
  return i === -1 ? undefined : argv[i + 1]
}
const APPLY = argv.includes('--apply')
const CHECK = argv.includes('--check')

const mask = (v: string): string => `${v.slice(0, 4)}…${v.slice(-3)}`
// 🔴 const 에 타입을 붙여야 호출 뒤가 never 로 좁혀진다. 반환 타입 주석만으로는 안 된다
const fail: (m: string) => never = (m) => {
  console.error(`\n🔴 중단: ${m}\n`)
  process.exit(1)
}

await loadEnvLocal()
const prisma = new PrismaClient()

console.log(`\n══ ${CHECK ? '검증 (--check)' : APPLY ? '🔴 적용 (--apply)' : 'dry-run'} · 대상 ${TARGET_CODE} ══`)

const all = await prisma.persona.groupBy({ by: ['status'], _count: { _all: true } })
console.log(`\n현재 Persona status: ${all.map((s) => `${s.status}=${s._count._all}`).join(' · ')}`)

const target = await prisma.persona.findUnique({
  where: { code: TARGET_CODE },
  select: { id: true, code: true, status: true, dailyCap: true, weeklyCap: true, activatedAt: true },
})
if (target === null) { await prisma.$disconnect(); fail(`${TARGET_CODE} 를 찾지 못했습니다.`) }

console.log(
  `\n${target.code} · id ${mask(target.id)} · status ${target.status}` +
    ` · dailyCap ${target.dailyCap ?? '미설정'} · weeklyCap ${target.weeklyCap ?? '미설정'}`,
)

// 🔴 cap 이 없으면 켜도 발행되지 않는다. 켜기 전에 알린다
if (target.dailyCap === null || target.weeklyCap === null) {
  console.log(
    '\n🟡 dailyCap · weeklyCap 이 비어 있습니다.\n' +
      '   active 로 바꿔도 발행은 cap 미설정으로 막힙니다 — 켜는 것과 말하는 것은 다른 층입니다.',
  )
}

if (CHECK) {
  const good = target.status === 'active'
  await prisma.$disconnect()
  console.log(good ? '\n✅ active 입니다\n' : `\n🔴 아직 ${target.status} 입니다\n`)
  process.exit(good ? 0 : 1)
}

if (target.status === 'active') {
  await prisma.$disconnect()
  console.log('\n✅ 이미 active 입니다 — 변경할 것이 없습니다 (no-op) · DB write 0\n')
  process.exit(0)
}
// 🔴 draft 에서만 켠다. paused · retired 는 다른 판단이 필요하다
if (target.status !== 'draft') {
  await prisma.$disconnect()
  fail(`status=${target.status} 입니다. draft 에서만 켭니다 — paused · retired 는 별도 판단 대상입니다.`)
}

console.log(`\n반영 예정  ${target.code} status draft → active (Persona 1행 + PersonaAuditLog 1행)`)

if (!APPLY) {
  await prisma.$disconnect()
  console.log('\n🟡 dry-run 입니다. DB write 0 · 적용하려면 --apply\n')
  process.exit(0)
}

// ── 적용 ──
const actorUserId = (process.env.ACTOR_USER_ID ?? '').trim()
if (actorUserId === '') {
  await prisma.$disconnect()
  fail('ACTOR_USER_ID 환경변수가 필요합니다 — 누가 켰는지가 감사 로그에 남아야 합니다.')
}
const reason = (arg('--reason') ?? '').trim()
if (reason === '') {
  await prisma.$disconnect()
  fail('--reason 이 필요합니다 — 왜 켰는지가 없으면 되돌릴 근거가 사라집니다.')
}

const now = new Date()
const result = await prisma.$transaction(async (tx) => {
  // 🔴 조건부 UPDATE — 읽은 뒤 쓰는 사이에 누가 바꿨으면 0건이 되어 아무 일도 없다
  const updated = await tx.persona.updateMany({
    where: { id: target.id, status: 'draft' },
    data: { status: 'active', activatedAt: now },
  })
  if (updated.count === 0) throw new Error('RACE')

  await tx.personaAuditLog.create({
    data: {
      personaId: target.id,
      action: 'status_changed',
      fromStatus: 'draft',
      toStatus: 'active',
      actorUserId,
      reason,
      changedFields: ['status', 'activatedAt'],
    },
  })
  return updated.count
}).catch((err: unknown) => {
  if (err instanceof Error && err.message === 'RACE') return 0
  throw err
})

if (result === 0) { await prisma.$disconnect(); fail('그 사이에 상태가 바뀌었습니다. 다시 확인하세요.') }

const after = await prisma.persona.groupBy({ by: ['status'], _count: { _all: true } })
console.log(`\n적용 후 Persona status: ${after.map((s) => `${s.status}=${s._count._all}`).join(' · ')}`)

await prisma.$disconnect()
console.log('\n✅ 적용했습니다. --check 로 검증하세요.\n')
