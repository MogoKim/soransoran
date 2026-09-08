#!/usr/bin/env tsx
/**
 * Persona 2차 확장 — draft → active. 🔴 **기본은 dry-run. 이번 PR 에서는 실행하지 않는다**
 *
 * 대상: P01 · P02 · P11 만. 🔴 인자로 code 를 받지 않는다.
 *
 * 사용법
 *   npx tsx scripts/persona-wave2-activate.mts                     # dry-run
 *   ACTOR_USER_ID=<id> npx tsx scripts/persona-wave2-activate.mts \
 *     --apply --limit=3 --reason "..."                              # 실제 활성화
 *   npx tsx scripts/persona-wave2-activate.mts --check              # 상태 대조
 *
 * 🔴 **네 개를 모두 요구한다** — `--apply` · `--limit=3` · `ACTOR_USER_ID` · `--reason`.
 *    하나로 열리는 문은 실수로도 열린다. `ACTOR_USER_ID` 는 환경변수로 받는다 —
 *    셸 히스토리에 남기지 않기 위해서다.
 *
 * 🔴 **켠다고 말이 나가지 않는다.** 3층 분리(§7-2):
 *      전체 kill switch  모든 페르소나를 한 번에
 *      status            그 페르소나만          ← 이 스크립트가 만지는 층
 *      dailyCap          그날만
 *    발행은 여전히 `auto-publish` 러너가 스케줄에 따라 한다.
 *
 * 🔴 이 스크립트가 하지 않는 것
 *      · 발행 · Post · Comment · Queue · ActivityLog · personaId
 *      · cap 설정 · kill switch 조작 · seed 수정 · User 생성
 */
import { PrismaClient, type Prisma } from '@prisma/client'

import {
  WAVE2_CODES, ACTIVATABLE_FROM, judgeActivate, judgeActivateArgs, type Wave2State,
} from '../src/lib/persona-wave2'
import { judgeRealMember } from '../src/lib/real-member-gate'
import { parsePoolDoc } from '../src/lib/persona-pool-card'
import { preflightAll, preflightPersona, verifyPersonaSeed, type PersonaDbRow } from '../src/lib/persona-wave2-verify'
import { readFileSync } from 'node:fs'

const POOL_DOC = 'docs/operations/2026-08-30-persona-pool-design.md'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const CHECK = argv.includes('--check')
const LIMIT_RAW = argv.find((a) => a.startsWith('--limit='))
const LIMIT = LIMIT_RAW === undefined ? null : Number(LIMIT_RAW.split('=')[1])
const REASON_AT = argv.indexOf('--reason')
const REASON = REASON_AT >= 0 ? (argv[REASON_AT + 1] ?? null) : null
const ACTOR = (process.env.ACTOR_USER_ID ?? '').trim() || null

const MATCH_AXES = ['maritalStatus', 'childrenCount', 'childrenAgeBands', 'parentCare', 'menopauseStatus'] as const
const fail = (m: string): never => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }
const ok = (m: string): void => console.log(`   ✅ ${m}`)

await loadEnvLocal()
const prisma = new PrismaClient()

console.log(`\n══ Persona 2차 활성화 — ${APPLY ? '🔴 실제 활성화' : CHECK ? '대조' : 'dry-run (DB write 0)'} ══\n`)
console.log(`  대상  ${WAVE2_CODES.join(' · ')}  🔴 코드에 못박혀 있다`)

/** 🔴 DB 값을 그대로 읽는다 — 저장된 것을 본다 */
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

const poolDoc = parsePoolDoc(readFileSync(POOL_DOC, 'utf-8'))
if (poolDoc.problems.length > 0) { await prisma.$disconnect(); fail(`정본 Pool 파싱 문제: ${poolDoc.problems.join(' / ')}`) }
const poolOf = new Map(poolDoc.cards.map((c) => [c.code, c]))

const dbRows = await readDbRows(prisma)
const states: Wave2State[] = WAVE2_CODES.map((code) => {
  const r = dbRows.find((x) => x.code === code)
  if (r === undefined) {
    return { code, exists: false, status: null, hasNickname: false, seeded: false, accountCount: null, providerId: null }
  }
  return {
    code, exists: true, status: r.status,
    hasNickname: (r.nickname ?? '').trim() !== '',
    // 🔴 생활사 5축이 아니라 **전체 seed 정합**으로 판정한다
    seeded: verifyPersonaSeed(r, poolOf.get(code) ?? null).complete,
    accountCount: r.accountCount, providerId: r.providerId,
  }
})

for (const s of states) {
  const real = judgeRealMember({ accountCount: s.accountCount, providerId: s.providerId })
  console.log(`  ${s.code}  ${s.exists ? `status=${s.status}` : '🔴 없음'}`
    + ` · 닉네임 ${s.hasNickname ? '있음' : '🔴 없음'} · seed ${s.seeded ? '완료' : '🔴 미완'}`
    + ` · Account ${s.accountCount ?? '?'} ${real.real ? '🔴 실회원' : '🟢'}`)
}

// ── --check — 🔴 status 만 보지 않는다. Account · 닉네임 · 전체 seed · audit 을 전부 본다 ──
if (CHECK) {
  let failed = 0
  for (const code of WAVE2_CODES) {
    const r = dbRows.find((x) => x.code === code)
    if (r === undefined) { console.log(`  🔴 ${code}  없다`); failed += 1; continue }
    // 🔴 `active` 상태를 기대하고 나머지 정합을 같은 판정으로 본다
    const pre = preflightPersona({ row: r, poolCard: poolOf.get(code) ?? null, expectStatus: 'active' })
    console.log(`  ${pre.ok ? '✅' : '🔴'} ${code}  status=${r.status} · Account ${r.accountCount ?? '?'}`
      + ` · 닉네임 ${(r.nickname ?? '').trim() !== '' ? '있음' : '🔴 없음'}`
      + ` · audit ${r.auditCreated}/${r.auditNameAssigned}`)
    if (!pre.ok) { for (const x of pre.problems) console.log(`       ${x}`); failed += 1 }
  }
  await prisma.$disconnect()
  console.log(failed === 0 ? '\n✅ 전원 active · Account 0 · 닉네임 · 전체 seed · audit 정합\n' : `\n🔴 ${failed}명 이상\n`)
  process.exit(failed === 0 ? 0 : 1)
}

// ── 🔴 순서 게이트 — 생성 · seed · 닉네임이 전부 끝났는가 ──
const order = judgeActivate(states)
if (!order.ok) {
  await prisma.$disconnect()
  fail(`활성화할 수 없습니다:\n     ${order.problems.join('\n     ')}\n`
    + `     🔴 순서는 생성 → seed → 검증 → 활성화 다. 일부만 켜지 않습니다.`)
}
// 🔴 실회원 판별은 정본 하나뿐이다
const real = states
  .map((s) => ({ code: s.code, v: judgeRealMember({ accountCount: s.accountCount, providerId: s.providerId }) }))
  .flatMap((x) => (x.v.real ? [{ code: x.code, reason: x.v.reason }] : []))
if (real.length > 0) {
  await prisma.$disconnect()
  fail(`실회원 계정에 연결된 persona 가 있습니다:\n     ${real.map((x) => `${x.code}: ${x.reason}`).join('\n     ')}`)
}
ok(`${WAVE2_CODES.length}명 전부 ${ACTIVATABLE_FROM} · 닉네임 있음 · seed 완료 · Account 0`)

// ── 🔴 실행 게이트 — 네 개를 모두 요구한다 ──
const gate = judgeActivateArgs({ apply: APPLY, limit: LIMIT, actorUserId: ACTOR, reason: REASON })
if (!gate.ok) {
  console.log(`\n🟡 활성화하지 않습니다 — ${gate.reason}`)
  console.log('   DB write 0.')
  console.log(`   실제 적용: ACTOR_USER_ID=<id> npx tsx scripts/persona-wave2-activate.mts --apply --limit=${WAVE2_CODES.length} --reason "..."\n`)
  await prisma.$disconnect()
  process.exit(0)
}

const before = {
  posts: await prisma.post.count(), comments: await prisma.comment.count(),
  queue: await prisma.originalPostApprovalQueue.count(), activity: await prisma.personaActivityLog.count(),
}

// ── 적용 — 🔴 세 명이 하나의 트랜잭션 ──
try {
  await prisma.$transaction(async (tx) => {
    // 🔴 **트랜잭션 안에서 다시 본다** — 읽은 뒤 쓰기까지 사이에 status 가 바뀌거나
    //    계정이 붙었을 수 있다. 하나라도 어긋나면 throw 해서 3명 전부 write 0 으로 롤백한다
    const fresh = await readDbRows(tx)
    const pre = preflightAll(
      WAVE2_CODES.map((c) => ({ row: fresh.find((x) => x.code === c)!, poolCard: poolOf.get(c) ?? null })),
      ACTIVATABLE_FROM,
    )
    if (!pre.ok) throw new Error(`트랜잭션 안 재확인 실패 — ${pre.problems.join(' / ')}`)

    for (const code of WAVE2_CODES) {
      // 🔴 **조건부 write** — `status=draft` 인 행만 켠다.
      //    읽은 뒤 누가 켜거나 멈췄으면 `count` 가 0 이 되어 throw → 3명 전부 롤백
      const u = await tx.persona.updateMany({
        where: { code, status: ACTIVATABLE_FROM },
        data: { status: 'active', activatedAt: new Date() },
      })
      if (u.count !== 1) {
        throw new Error(`${code}: 조건부 update 가 ${u.count}건 — 읽은 뒤 status 가 바뀌었다 (전부 롤백)`)
      }
      const p = await tx.persona.findUniqueOrThrow({ where: { code }, select: { id: true } })
      await tx.personaAuditLog.create({
        data: {
          personaId: p.id, action: 'status_changed',
          fromStatus: ACTIVATABLE_FROM, toStatus: 'active',
          actorUserId: ACTOR, reason: REASON,
        },
      })
    }
  },
  // 🔴 **Serializable** — Account 가 트랜잭션 중간에 붙는 경합까지 막는다
  { isolationLevel: 'Serializable' })
} catch (e) {
  await prisma.$disconnect()
  fail(`활성화 실패 — 3명 전부 롤백했습니다 (write 0): ${(e as Error).message}`)
}
ok('활성화 완료 (Serializable 트랜잭션 커밋)')

const after = {
  posts: await prisma.post.count(), comments: await prisma.comment.count(),
  queue: await prisma.originalPostApprovalQueue.count(), activity: await prisma.personaActivityLog.count(),
}
const drift = Object.entries(after).filter(([k, v]) => v !== before[k as keyof typeof before])
if (drift.length > 0) {
  await prisma.$disconnect()
  fail(`🔴 발행 관련 테이블이 변했습니다: ${drift.map(([k, v]) => `${k} ${before[k as keyof typeof before]}→${v}`).join(' · ')}`)
}
ok('Post · Comment · Queue · ActivityLog 불변 — 켠다고 말이 나가지 않는다')
console.log('\n   발행은 auto-publish 러너가 스케줄에 따라 한다 (하루 1건).\n')

await prisma.$disconnect()
