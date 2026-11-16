#!/usr/bin/env tsx
/**
 * P15 정본 교정 1회 — 🔴 기본 dry-run(write 0). 판정·실행은 `scripts/lib/persona-p15-remediation.mts` 하나다.
 *
 *   npx tsx scripts/persona-p15-remediation.mts                                     # dry-run — 계획 · digest · 정본 용량 · 예측
 *   npx tsx scripts/persona-p15-remediation.mts --apply --expect-before=<64hex> --reason="…"   # 🔴 운영 적용(runtime 트리 · HEAD=pin)
 *   npx tsx scripts/persona-p15-remediation.mts --rollback --reason="…"            # 🔴 교정본일 때만 이전 값으로
 *
 * 🔴 출력은 코드 · digest 앞자리 · 개수 · 판정 코드. Persona 값·표시명·회원 정보 0. 이전 값은 0600 기록 파일에만 남는다.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { PrismaClient, type Prisma } from '@prisma/client'

import {
  P15_FIELD, P15_PRODUCTION_PINS, applyRemediation, digestOf, planRemediation, restoreRemediation, type PlanInput,
} from './lib/persona-p15-remediation.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { fillDbConnection } from './lib/ops-signals.mjs'
import { readPersonaCapacity } from './lib/persona-reserve-facts.mjs'
import { parsePoolDoc } from '../src/lib/persona-pool-card'
import { verifySeedCard } from '../src/lib/persona-card-verify'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const ROLLBACK = argv.includes('--rollback')
const val = (k: string): string => (argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3).trim()
const EXPECT = val('expect-before')
const REASON = val('reason')
const PINS = P15_PRODUCTION_PINS
const CANON_DIR = join(homedir(), 'Library', 'Application Support', 'soransoran')
const RUNTIME_ROOT = join(homedir(), 'Documents', 'soransoran-runtime')
const DIR = join(CANON_DIR, 'persona-p15-remediation')
const RECORD = join(DIR, 'before.json')
const LOCK = join(DIR, 'run.lock')
const POOL_DOC = 'docs/operations/2026-08-30-persona-pool-design.md'
const log = (event: string, data: Record<string, unknown> = {}): void => {
  console.log(JSON.stringify({ at: new Date().toISOString(), tool: 'persona-p15-remediation', mode: APPLY ? 'apply' : ROLLBACK ? 'rollback' : 'dry-run', event, ...data }))
}

async function main(): Promise<number> {
  if (APPLY && ROLLBACK) { log('refuse', { code: 'ARGS' }); return 2 }
  if (APPLY || ROLLBACK) {
    const real = (p: string): string => { try { return realpathSync(p) } catch { return p } }
    if (real(process.cwd()) !== real(RUNTIME_ROOT)) { log('refuse', { code: 'NOT_RUNTIME_TREE' }); return 2 }
    const head = ((): string | null => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim() } catch { return null } })()
    const pin = ((): string | null => { try { return readFileSync(join(CANON_DIR, 'runtime-pinned-sha'), 'utf-8').trim() } catch { return null } })()
    if (head === null || head !== pin) { log('refuse', { code: 'RUNTIME_PIN' }); return 2 }
    if (REASON === '') { log('refuse', { code: 'REASON' }); return 2 }
  }
  if (APPLY && EXPECT !== PINS.beforeIdentityDigest) { log('refuse', { code: 'EXPECT_BEFORE', reason: '--expect-before 가 고정 digest 와 다르다' }); return 2 }
  await loadEnvLocal()
  if (!fillDbConnection()) { log('refuse', { code: 'CREDENTIAL' }); return 2 }
  const db = new PrismaClient()
  try {
    const cards = parsePoolDoc(readFileSync(POOL_DOC, 'utf-8'))
    const card = cards.problems.length > 0 ? null : (cards.cards.find((c) => c.code === PINS.code) ?? null)
    const readPlanInput = async (tx: PrismaClient | Prisma.TransactionClient): Promise<PlanInput> => {
      const r = await tx.persona.findUnique({ where: { code: PINS.code } })
      if (r === null) return { pins: PINS, row: null, cardValue: card?.workStatus ?? null, problemsBefore: null, problemsAfter: null }
      const seed = {
        ageBand: r.ageBand, region: r.region, lifeStage: r.lifeStage, identity: r.identity, voiceCore: r.voiceCore,
        voiceVariations: r.voiceVariations, activityRhythm: r.activityRhythm, noGoTopics: r.noGoTopics, noGoExpressions: r.noGoExpressions,
        forbiddenReactionRoles: r.forbiddenReactionRoles, dailyCap: r.dailyCap, weeklyCap: r.weeklyCap,
        silenceRate: r.silenceRate === null ? null : Number(r.silenceRate),
      } as unknown as Parameters<typeof verifySeedCard>[1]
      const identity = r.identity as Record<string, unknown> | null
      const fixed = { ...seed, identity: { ...(identity ?? {}), [P15_FIELD]: card?.workStatus ?? null } } as unknown as Parameters<typeof verifySeedCard>[1]
      return {
        pins: PINS, row: { identity: r.identity, updatedAt: r.updatedAt.toISOString(), status: String(r.status) },
        cardValue: card?.workStatus ?? null,
        problemsBefore: card === null ? null : verifySeedCard(PINS.code, seed, card),
        problemsAfter: card === null ? null : verifySeedCard(PINS.code, fixed, card),
      }
    }
    const readCapacity = (): ReturnType<typeof readPersonaCapacity> => readPersonaCapacity(db, { now: new Date(), repoRoot: process.cwd() })

    if (ROLLBACK) {
      if (!existsSync(RECORD)) { log('refuse', { code: 'NO_RECORD' }); return 2 }
      const rec = JSON.parse(readFileSync(RECORD, 'utf-8')) as { beforeValue?: string; beforeIdentityDigest?: string }
      if (rec.beforeIdentityDigest !== PINS.beforeIdentityDigest || typeof rec.beforeValue !== 'string') { log('refuse', { code: 'RECORD_MISMATCH' }); return 2 }
      const r = await restoreRemediation(db, { pins: PINS, beforeValue: rec.beforeValue, reason: REASON })
      log('done', { result: r.ok ? 'RESTORED' : 'NOT_RESTORED', reason: r.reason, capacity: await readCapacity() })
      return r.ok ? 0 : 4
    }

    const input = await readPlanInput(db)
    const plan = planRemediation(input)
    const capacity = await readCapacity()
    log('plan', {
      code: plan.code, reason: plan.ok ? null : plan.reason,
      nowDigest: input.row === null ? null : digestOf(input.row.identity).slice(0, 16),
      beforePin: PINS.beforeIdentityDigest.slice(0, 16), afterPin: PINS.afterIdentityDigest.slice(0, 16),
      problemsBefore: input.problemsBefore?.length ?? null, problemsAfter: input.problemsAfter?.length ?? null,
      capacity, predicted: plan.ok && plan.code === 'APPLY' && capacity.contractValid !== null && capacity.stageActive !== null
        ? { contractValid: capacity.contractValid + 1, stageActive: capacity.stageActive + 1 } : capacity,
    })
    if (!APPLY) { log('done', { result: plan.ok ? `DRY_RUN_${plan.code}` : 'DRY_RUN_REFUSED', write: 0 }); return plan.ok ? 0 : 3 }
    if (!plan.ok) { log('done', { result: 'REFUSED', write: 0 }); return 3 }
    if (plan.code === 'ALREADY_APPLIED') { log('done', { result: 'ALREADY_APPLIED', write: 0 }); return 0 }

    mkdirSync(DIR, { recursive: true, mode: 0o700 })
    let fd: number
    try { fd = openSync(LOCK, 'wx', 0o600) } catch { log('refuse', { code: 'LOCK' }); return 3 }
    closeSync(fd)
    try {
      // 🔴 되돌림 기록을 **먼저** 쓴다 — 커밋 뒤에 죽어도 되돌릴 수 있다
      const beforeValue = String(((input.row!.identity as Record<string, unknown>)[P15_FIELD]))
      const tmp = `${RECORD}.tmp-${process.pid}`
      writeFileSync(tmp, JSON.stringify({ code: PINS.code, field: P15_FIELD, beforeValue, beforeIdentityDigest: PINS.beforeIdentityDigest, afterIdentityDigest: PINS.afterIdentityDigest, at: new Date().toISOString() }), { mode: 0o600 })
      renameSync(tmp, RECORD)
      const r = await applyRemediation(db, { pins: PINS, readPlanInput, readCapacity, reason: REASON })
      log('done', { result: r.code, ...(r.code === 'APPLIED' ? { capacityBefore: r.capacityBefore, capacityAfter: r.capacityAfter } : r.code === 'ALREADY_APPLIED' ? {} : r.code === 'ROLLBACK_FAILED' ? { reason: r.reason, restoreReason: r.restoreReason, action: '사람이 --rollback 으로 처리' } : { reason: r.reason }) })
      return r.code === 'APPLIED' || r.code === 'ALREADY_APPLIED' ? 0 : 4
    } finally { try { unlinkSync(LOCK) } catch { /* 없음 */ } }
  } finally { await db.$disconnect() }
}

process.exit(await main().catch((e: unknown) => { log('crash', { error: (e as Error).name }); return 1 }))
