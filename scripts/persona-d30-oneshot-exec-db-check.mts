#!/usr/bin/env tsx
/**
 * D30 1회 투입 실행 순서 — 🔴 격리 Postgres 통합 검사 (SORAN_ISOLATED_DB=yes-throwaway · localhost · soran_test)
 *   운영 CLI 와 같은 `executeOneShot` 에 실제 DB 를 붙인다. P15 교정은 실제 `applyRemediation`, cohort 단계는 실제 행을 쓰는 대역.
 *   용량 규칙(대역): active 이고 P15 가 교정 전 값이 아닌 Persona 수 — 정본 판정의 이 결함 축을 그대로 흉내 낸다.
 */
import { PrismaClient } from '@prisma/client'

import { requireIsolatedDb } from './lib/auto-ready-audit-fixtures.mjs'
import { APPROVED_SUPPLEMENT_PLAN_DIGEST, COHORT_CODES, EXPECTED_RUNTIME_ASSET_IDENTITY, type MarkerState, type OneShotFacts } from './lib/persona-d30-oneshot.mjs'
import { executeOneShot, type ExecEffects, type Step } from './lib/persona-d30-oneshot-exec.mjs'
import { applyRemediation, digestOf, type PlanInput, type RemediationPins } from './lib/persona-p15-remediation.mjs'

requireIsolatedDb()
const db = new PrismaClient()
let pass = 0; let fail = 0
const check = (label: string, ok: boolean, d = ''): void => { if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else { fail += 1; console.log(`  ❌ ${label}${d ? ` — ${d}` : ''}`) } }

const OLD = Array.from({ length: 40 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`)
const BEFORE = { workStatus: '옛값', housing: 'h' }
const AFTER = { ...BEFORE, workStatus: '정본값' }
const SHA = 'a'.repeat(40)

async function world(opt: { p15Fixed?: boolean; p16Paused?: boolean } = {}): Promise<RemediationPins> {
  const codes = [...OLD, ...COHORT_CODES]
  await db.personaAuditLog.deleteMany({ where: { persona: { code: { in: codes } } } })
  await db.persona.deleteMany({ where: { code: { in: codes } } })
  for (const code of OLD) {
    const u = await db.user.create({ data: { nickname: `통합${code}${Date.now()}` }, select: { id: true } })
    const identity = code === 'P15' ? (opt.p15Fixed ? AFTER : BEFORE) : { workStatus: 'x' }
    await db.persona.create({ data: { code, userId: u.id, status: code === 'P16' && opt.p16Paused ? 'paused' : 'active', identity } })
  }
  const p = await db.persona.findUniqueOrThrow({ where: { code: 'P15' } })
  return { code: 'P15', beforeIdentityDigest: digestOf(BEFORE), beforeUpdatedAt: p.updatedAt.toISOString(), afterIdentityDigest: digestOf(AFTER) }
}
const capacityRule = async (): Promise<{ contractValid: number; stageActive: number }> => {
  const rows = await db.persona.findMany({ where: { status: 'active' }, select: { code: true, identity: true } })
  const valid = rows.filter((r) => !(r.code === 'P15' && (r.identity as Record<string, unknown>).workStatus === '옛값')).length
  return { contractValid: valid, stageActive: valid }
}
const old40Fp = async (): Promise<string> => digestOf((await db.persona.findMany({ where: { code: { in: OLD, not: 'P15' } }, select: { code: true, status: true, updatedAt: true }, orderBy: { code: 'asc' } })).map((r) => [r.code, r.status, r.updatedAt.toISOString()]))

type Run = { order: string[]; markers: string[]; fx: ExecEffects }
function effects(pins: RemediationPins, failAt: Partial<Record<Step | 'remediate' | 'capacityAfter', true>> = {}): Run {
  const order: string[] = []; const markers: string[] = []
  let activated = false
  const planInput = async (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0] | PrismaClient): Promise<PlanInput> => {
    const r = await tx.persona.findUnique({ where: { code: 'P15' } })
    const w = (r?.identity as Record<string, unknown> | undefined)?.workStatus
    return { pins, row: r === null ? null : { identity: r.identity, updatedAt: r.updatedAt.toISOString(), status: String(r.status) }, cardValue: '정본값', problemsBefore: w === '정본값' ? [] : ['workStatus 가 정본과 다르다'], problemsAfter: [] }
  }
  const fx: ExecEffects = {
    gather: async (): Promise<OneShotFacts> => {
      const active = (await db.persona.findMany({ where: { status: 'active' }, select: { code: true } })).map((r) => r.code)
      const cohortExisting = (await db.persona.findMany({ where: { code: { in: [...COHORT_CODES] } }, select: { code: true } })).map((r) => r.code)
      return {
        targetDate: '2026-11-16', kstDate: '2026-11-16', kstMinute: 425,
        stage: { kstDate: '2026-11-16', state: 'PREPARE', release: 'd20', capacity: 'd30', decidedBy: 'controller' },
        originMain: SHA, head: SHA, pin: SHA, manifestSha: SHA, manifestIdentity: { ...EXPECTED_RUNTIME_ASSET_IDENTITY },
        deployLock: false, runningJobs: [], unknownJobs: [], approvalDigest: APPROVED_SUPPLEMENT_PLAN_DIGEST,
        runtimeIdentity: { ...EXPECTED_RUNTIME_ASSET_IDENTITY }, old40VoiceSame: true,
        old40ActiveCodes: active.filter((c) => !COHORT_CODES.includes(c)), expectedOld40: OLD, cohortExisting, adminCount: 1,
        marker: null, capacity: await capacityRule(),
      }
    },
    writeMarker: (s) => { markers.push(s) },
    remediate: async () => {
      order.push('remediate')
      if (failAt.remediate) return false
      const r = await applyRemediation(db, { pins, readPlanInput: planInput, readCapacity: capacityRule, reason: '통합 시험' })
      return r.code === 'APPLIED' || r.code === 'ALREADY_APPLIED'
    },
    step: async (s) => {
      order.push(s)
      if (failAt[s]) return false
      if (s === 'create') {
        for (const code of COHORT_CODES) {
          const u = await db.user.create({ data: { nickname: `새${code}${Date.now()}` }, select: { id: true } })
          await db.persona.create({ data: { code, userId: u.id, status: 'draft', identity: { workStatus: 'y' } } })
        }
      }
      if (s === 'activate') { await db.persona.updateMany({ where: { code: { in: [...COHORT_CODES] }, status: 'draft' }, data: { status: 'active' } }); activated = true }
      return true
    },
    pause: async () => { order.push('pause'); const u = await db.persona.updateMany({ where: { code: { in: [...COHORT_CODES] }, status: 'active' }, data: { status: 'paused' } }); return u.count === COHORT_CODES.length },
    cohortStatuses: async () => new Map((await db.persona.findMany({ where: { code: { in: [...COHORT_CODES] } }, select: { code: true, status: true } })).map((r) => [r.code, String(r.status)])),
    adminIds: async () => ['admin-1'],
    old40Fingerprint: old40Fp,
    counts: async () => ({ totalActive: await db.persona.count({ where: { status: 'active' } }), cohortActive: await db.persona.count({ where: { code: { in: [...COHORT_CODES] }, status: 'active' } }) }),
    capacity: async () => { if (failAt.capacityAfter && activated) throw new Error('판독 실패 주입'); return capacityRule() },
    log: () => undefined,
  }
  return { order, markers, fx }
}
const p15Digest = async (): Promise<string> => digestOf((await db.persona.findUniqueOrThrow({ where: { code: 'P15' } })).identity)
const cohortStates = async (): Promise<string[]> => (await db.persona.findMany({ where: { code: { in: [...COHORT_CODES] } }, select: { status: true } })).map((r) => String(r.status))

console.log('\n① 39/39 → P15 교정 → 40/40 → 투입 → PASS')
{
  const pins = await world(); const fp = await old40Fp(); const run = effects(pins)
  const r = await executeOneShot(run.fx)
  check('PASS · exit 0', r.result === 'PASS' && r.exit === 0, r.result)
  check('교정이 create 보다 먼저 · create 전에 다른 쓰기 0', run.order.indexOf('remediate') === 0 && run.order.indexOf('create') > run.order.indexOf('remediate'))
  check('P15 = 정본 digest · 새 20 active · active 60', (await p15Digest()) === pins.afterIdentityDigest && (await cohortStates()).every((s) => s === 'active') && (await db.persona.count({ where: { status: 'active' } })) === 60)
  check('P15 외 기존 39 지문 diff 0', (await old40Fp()) === fp)
  check('표식 started(p15)→started(cohort)→done', JSON.stringify(run.markers) === JSON.stringify(['started', 'started', 'done']), run.markers.join(','))
}
console.log('\n② 40/40(이미 정본) → 교정 없이 투입')
{
  const pins = await world({ p15Fixed: true }); const run = effects(pins)
  const r = await executeOneShot(run.fx)
  check('PASS · 교정 호출 0', r.result === 'PASS' && !run.order.includes('remediate'), run.order.join(','))
}
console.log('\n③ 38/38 → 교정도 투입도 하지 않는다')
{
  const pins = await world({ p16Paused: true }); const run = effects(pins)
  const r = await executeOneShot(run.fx)
  check('NO_GO · 교정 0 · create 0 · 표식 0 · cohort 행 0', r.exit === 3 && run.order.length === 0 && run.markers.length === 0 && (await cohortStates()).length === 0, `${r.result} ${run.order.join(',')}`)
  check('P15 교정 전 그대로', (await p15Digest()) === pins.beforeIdentityDigest)
}
console.log('\n④ 교정 실패 → cohort write 0 · held')
{
  const pins = await world(); const run = effects({ ...(await world()), beforeIdentityDigest: 'f'.repeat(64) })
  void pins
  const r = await executeOneShot(run.fx)
  check('NO_GO_AFTER_REMEDIATION · create 0 · 표식 started→held', r.result === 'NO_GO_AFTER_REMEDIATION' && !run.order.includes('create') && JSON.stringify(run.markers) === JSON.stringify(['started', 'held']), `${r.result} ${run.markers.join(',')}`)
  check('cohort 행 0 · P15 교정 전 그대로', (await cohortStates()).length === 0 && (await p15Digest()) === digestOf(BEFORE))
}
console.log('\n⑤ 교정 성공 뒤 create 실패 → held · P15 정본 유지 · 기존 39 불변')
{
  const pins = await world(); const fp = await old40Fp(); const run = effects(pins, { create: true })
  const r = await executeOneShot(run.fx)
  check('HELD · pause 0', r.result === 'HELD' && !run.order.includes('pause'), r.result)
  check('P15 정본 유지 · cohort 행 0 · 기존 39 지문 diff 0', (await p15Digest()) === pins.afterIdentityDigest && (await cohortStates()).length === 0 && (await old40Fp()) === fp)
  check('표식 …→held', run.markers.at(-1) === 'held')
}
console.log('\n⑥ 교정 성공 뒤 seed 실패 → draft 20(운영 노출 0) · held')
{
  const pins = await world(); const run = effects(pins, { seed: true })
  const r = await executeOneShot(run.fx)
  const st = await cohortStates()
  check('HELD · 새 20 전원 draft · activate 0 · active 40', r.result === 'HELD' && st.length === 20 && st.every((s) => s === 'draft') && !run.order.includes('activate') && (await db.persona.count({ where: { status: 'active' } })) === 40, r.result)
}
console.log('\n⑦ 켠 뒤 결과 판독 실패 → 새 cohort 만 pause · 기존 40 active')
{
  const pins = await world(); const fp = await old40Fp(); const run = effects(pins, { capacityAfter: true })
  const r = await executeOneShot(run.fx)
  const st = await cohortStates()
  check('PAUSED_NEW_COHORT · 표식 paused', r.result === 'PAUSED_NEW_COHORT' && run.markers.at(-1) === 'paused', r.result)
  check('새 20 paused · 기존 40 active(P15 정본 포함) · 기존 39 지문 diff 0', st.every((s) => s === 'paused') && (await db.persona.count({ where: { code: { in: OLD }, status: 'active' } })) === 40 && (await p15Digest()) === pins.afterIdentityDigest && (await old40Fp()) === fp)
}

const all = [...OLD, ...COHORT_CODES]
await db.personaAuditLog.deleteMany({ where: { persona: { code: { in: all } } } })
await db.persona.deleteMany({ where: { code: { in: all } } })
await db.$disconnect()
console.log(`\n결과: ${pass} 통과 · ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
