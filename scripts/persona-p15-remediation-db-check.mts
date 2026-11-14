#!/usr/bin/env tsx
/**
 * P15 정본 교정 — 🔴 격리 Postgres 실제 트랜잭션 검사 (SORAN_ISOLATED_DB=yes-throwaway · localhost · soran_test)
 *   운영 CLI 와 **같은 실행부**(`applyRemediation` · `restoreRemediation`)를 시험 핀으로 부른다.
 */
import { PrismaClient } from '@prisma/client'

import { requireIsolatedDb } from './lib/auto-ready-audit-fixtures.mjs'
import { applyRemediation, digestOf, restoreRemediation, type PlanInput, type RemediationPins } from './lib/persona-p15-remediation.mjs'

requireIsolatedDb()
const db = new PrismaClient()
let pass = 0; let fail = 0
const check = (label: string, ok: boolean, d = ''): void => { if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else { fail += 1; console.log(`  ❌ ${label}${d ? ` — ${d}` : ''}`) } }

const BEFORE = { workStatus: '옛값', housing: 'h', personality: ['p'] }
const AFTER = { ...BEFORE, workStatus: '정본값' }

async function world(): Promise<RemediationPins> {
  await db.personaAuditLog.deleteMany({ where: { persona: { code: { in: ['P15', 'P16'] } } } })
  await db.persona.deleteMany({ where: { code: { in: ['P15', 'P16'] } } })
  for (const code of ['P15', 'P16']) {
    const u = await db.user.create({ data: { nickname: `시험${code}${Date.now()}` }, select: { id: true } })
    await db.persona.create({ data: { code, userId: u.id, status: 'active', identity: code === 'P15' ? BEFORE : { workStatus: '그대로' } } })
  }
  const p = await db.persona.findUniqueOrThrow({ where: { code: 'P15' } })
  return { code: 'P15', beforeIdentityDigest: digestOf(BEFORE), beforeUpdatedAt: p.updatedAt.toISOString(), afterIdentityDigest: digestOf(AFTER) }
}
const planInput = (pins: RemediationPins) => async (tx: PrismaClient | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]): Promise<PlanInput> => {
  const r = await tx.persona.findUnique({ where: { code: 'P15' } })
  const idv = (r?.identity ?? {}) as Record<string, unknown>
  return {
    pins, row: r === null ? null : { identity: r.identity, updatedAt: r.updatedAt.toISOString(), status: String(r.status) },
    cardValue: '정본값', problemsBefore: idv.workStatus === '정본값' ? [] : ['workStatus 가 정본과 다르다'], problemsAfter: [],
  }
}
const seq = (...vals: { contractValid: number | null; stageActive: number | null }[]) => {
  let i = 0
  return async () => vals[Math.min(i++, vals.length - 1)]!
}
const p15 = () => db.persona.findUniqueOrThrow({ where: { code: 'P15' }, include: { auditLogs: true } })
const p16 = () => db.persona.findUniqueOrThrow({ where: { code: 'P16' } })

console.log('\n① 성공 · 멱등')
{
  const pins = await world()
  const other = await p16()
  const r = await applyRemediation(db, { pins, readPlanInput: planInput(pins), readCapacity: seq({ contractValid: 39, stageActive: 39 }, { contractValid: 40, stageActive: 40 }), reason: '시험' })
  const now = await p15()
  check('APPLIED · identity = after digest', r.code === 'APPLIED' && digestOf(now.identity) === pins.afterIdentityDigest, r.code)
  check('workStatus 외 키 불변', digestOf({ ...(now.identity as object), workStatus: '옛값' }) === digestOf(BEFORE))
  check('감사 행 1', now.auditLogs.filter((a) => a.action === 'updated').length === 1)
  const o2 = await p16()
  check('다른 Persona 행 불변(updatedAt·identity)', o2.updatedAt.getTime() === other.updatedAt.getTime() && digestOf(o2.identity) === digestOf(other.identity))
  const again = await applyRemediation(db, { pins, readPlanInput: planInput(pins), readCapacity: seq({ contractValid: 40, stageActive: 40 }), reason: '시험' })
  check('두 번째 실행 → ALREADY_APPLIED · 감사 행 그대로 1', again.code === 'ALREADY_APPLIED' && (await p15()).auditLogs.length === 1)
}

console.log('\n② 동시성 — 계획 뒤 트랜잭션 전에 행이 바뀌면 write 0')
{
  const pins = await world()
  const touch = async () => { await db.persona.update({ where: { code: 'P15' }, data: { dailyCap: 5 } }); return { contractValid: 39, stageActive: 39 } }
  const r = await applyRemediation(db, { pins, readPlanInput: planInput(pins), readCapacity: touch, reason: '시험' })
  const now = await p15()
  check('REFUSED(트랜잭션 롤백) · identity 이전 그대로 · 감사 0', r.code === 'REFUSED' && digestOf(now.identity) === pins.beforeIdentityDigest && now.auditLogs.length === 0, r.code)
}

console.log('\n③ 부분 실패 — 커밋 뒤 정본 판독이 +1 이 아니면 자동 되돌림')
{
  const pins = await world()
  const r = await applyRemediation(db, { pins, readPlanInput: planInput(pins), readCapacity: seq({ contractValid: 39, stageActive: 39 }, { contractValid: 39, stageActive: 39 }), reason: '시험' })
  const now = await p15()
  check('ROLLED_BACK · restored · identity = before digest', r.code === 'ROLLED_BACK' && r.restored && digestOf(now.identity) === pins.beforeIdentityDigest, r.code)
  check('감사 행 2(교정·되돌림)', now.auditLogs.length === 2)
}
{
  const pins = await world()
  const r = await applyRemediation(db, { pins, readPlanInput: planInput(pins), readCapacity: async () => { throw new Error('판독 실패') }, reason: '시험' }).catch((e: Error) => ({ code: 'THREW', reason: e.message }))
  check('교정 전 판독 실패 → 쓰지 않는다(throw 또는 REFUSED) · identity 이전 그대로', r.code !== 'APPLIED' && digestOf((await p15()).identity) === pins.beforeIdentityDigest, r.code)
}
{
  const pins = await world()
  const r = await applyRemediation(db, {
    pins, readPlanInput: planInput(pins), readCapacity: seq({ contractValid: 39, stageActive: 39 }, { contractValid: 40, stageActive: 40 }), reason: '시험',
    afterCommitHook: async () => { await db.persona.update({ where: { code: 'P16' }, data: { dailyCap: 7 } }) },
  })
  check('커밋 뒤 다른 Persona 가 바뀌면 → ROLLED_BACK · P15 이전 값', r.code === 'ROLLED_BACK' && digestOf((await p15()).identity) === pins.beforeIdentityDigest, r.code)
}

console.log('\n④ 수동 되돌림 — 교정본일 때만')
{
  const pins = await world()
  const no = await restoreRemediation(db, { pins, beforeValue: '옛값', reason: '시험' })
  check('교정 전 상태에서 되돌림 → 거부', !no.ok)
  await applyRemediation(db, { pins, readPlanInput: planInput(pins), readCapacity: seq({ contractValid: 39, stageActive: 39 }, { contractValid: 40, stageActive: 40 }), reason: '시험' })
  const bad = await restoreRemediation(db, { pins, beforeValue: '틀린값', reason: '시험' })
  check('틀린 이전 값으로는 되돌리지 않는다(before digest 불일치)', !bad.ok && digestOf((await p15()).identity) === pins.afterIdentityDigest)
  const yes = await restoreRemediation(db, { pins, beforeValue: '옛값', reason: '시험' })
  check('맞는 이전 값 → 되돌림 · before digest', yes.ok && digestOf((await p15()).identity) === pins.beforeIdentityDigest)
}

await db.personaAuditLog.deleteMany({ where: { persona: { code: { in: ['P15', 'P16'] } } } })
await db.persona.deleteMany({ where: { code: { in: ['P15', 'P16'] } } })
await db.$disconnect()
console.log(`\n결과: ${pass} 통과 · ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
