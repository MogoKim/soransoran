/**
 * Persona 계약 복구 **어댑터** — 계획 · 예측 · 적용 (2026-10-01 · Phase 2A)
 *
 * 🔴 판정을 새로 만들지 않는다. 계획은 `src/lib/persona-contract-remediation`, 계약 판정은
 *    `persona-reserve`(어댑터 `readReserveFacts`) 하나다. 예측은 같은 판정을 **고친 행**에 다시 돌린 것이다.
 *
 * 🔴 적용(`applyRemediation`)은 전원 아니면 0 이다.
 *    · 하나의 Serializable 트랜잭션 · 트랜잭션 **안에서** 행을 다시 읽어 precondition(행 지문)을 대조한다
 *    · 다시 세운 계획의 digest 가 승인된 digest 와 같아야 한다
 *    · 적용 뒤 같은 트랜잭션 안에서 계약을 다시 재고 — 예측과 다르거나 · 계약 유효가 줄거나 · 전에 유효하던
 *      사람이 빠지거나 · 어느 축이든 막힘/모름이 늘면 throw → 롤백
 *    · Post · Comment · Queue · 활동 · 원문 · 계정 행 수가 그대로인지 본다 — 활동을 만들지 않는다
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Prisma, PrismaClient } from '@prisma/client'

import { verifySeedCard } from '../../src/lib/persona-card-verify'
import {
  patchedRow, planRemediation, type RemediationPlan, type RemediationRow,
} from '../../src/lib/persona-contract-remediation'
import { parsePoolDoc, type PoolCard } from '../../src/lib/persona-pool-card'
import type { ContractAxis, PersonaReserveResult } from '../../src/lib/persona-reserve'
import { readPersonaReserve, type PersonaReserveFacts } from './d100-persona-tiers.mjs'
import { readReserveFacts, seedCompleteOf, seedOfRow } from './persona-reserve-facts.mjs'
import { PERSONA_POOL_DOC } from './voice-runtime.mjs'

type Reader = PrismaClient | Prisma.TransactionClient

const SEED_SELECT = {
  code: true, status: true, updatedAt: true, identity: true, ageBand: true, region: true, lifeStage: true,
  voiceCore: true, voiceVariations: true, activityRhythm: true,
  noGoTopics: true, noGoExpressions: true, forbiddenReactionRoles: true,
  dailyCap: true, weeklyCap: true, silenceRate: true,
} as const

type FullRow = Awaited<ReturnType<typeof readFullRows>>[number]

async function readFullRows(db: Reader) {
  return db.persona.findMany({ select: SEED_SELECT, orderBy: { code: 'asc' } })
}

export const remediationRowOf = (r: FullRow): RemediationRow => ({
  code: r.code, status: String(r.status), updatedAt: r.updatedAt.toISOString(),
  ageBand: r.ageBand, region: r.region, lifeStage: r.lifeStage,
  identity: (r.identity ?? null) as Record<string, unknown> | null,
  voiceCore: (r.voiceCore ?? null) as Record<string, unknown> | null,
  noGoTopics: r.noGoTopics, noGoExpressions: r.noGoExpressions, forbiddenReactionRoles: r.forbiddenReactionRoles,
})

export function readCards(repoRoot: string): PoolCard[] | null {
  try {
    const doc = parsePoolDoc(readFileSync(join(repoRoot, PERSONA_POOL_DOC), 'utf-8'))
    return doc.problems.length === 0 ? doc.cards : null
  } catch {
    return null
  }
}

export type RemediationRead = {
  plan: RemediationPlan
  before: PersonaReserveResult
  /** 🔴 같은 판정을 고친 행에 돌린 결과 */
  predicted: PersonaReserveResult
}

/** 🔴 고친 행으로 계약 원자료를 다시 만든다 — 자격(seed 대조 · seed 완결)과 생활사 칸만 바뀐다 */
export function patchFacts(facts: PersonaReserveFacts, full: readonly FullRow[], plan: RemediationPlan, cards: readonly PoolCard[]): PersonaReserveFacts {
  const byCode = new Map(plan.personas.map((p) => [p.code, p]))
  return {
    designedOnly: facts.designedOnly,
    rows: facts.rows.map((row) => {
      const p = byCode.get(row.code)
      const raw = full.find((f) => f.code === row.code)
      if (p === undefined || raw === undefined || row.qualification === null) return row
      const fixed = patchedRow(remediationRowOf(raw), p.changes)
      const seed = { ...seedOfRow(raw), identity: fixed.identity ?? undefined, voiceCore: fixed.voiceCore ?? undefined,
        ageBand: fixed.ageBand, region: fixed.region,
        noGoTopics: [...fixed.noGoTopics], noGoExpressions: [...fixed.noGoExpressions], forbiddenReactionRoles: [...fixed.forbiddenReactionRoles] }
      return {
        ...row,
        identity: (fixed.identity ?? {}) as Record<string, unknown>,
        ageBand: fixed.ageBand, region: fixed.region,
        noGoTopics: fixed.noGoTopics, noGoExpressions: fixed.noGoExpressions,
        qualification: {
          ...row.qualification,
          seedProblems: verifySeedCard(row.code, seed, cards.find((c) => c.code === row.code) ?? null),
          seedComplete: seedCompleteOf({ identity: fixed.identity, voiceCore: fixed.voiceCore, lifeStage: fixed.lifeStage }),
        },
      }
    }),
  }
}

/** 🔴 read-only — 계획 · 지금 계약 · 예측 계약 */
export async function readRemediation(db: Reader, opts: { now: Date; repoRoot: string }): Promise<RemediationRead> {
  const cards = readCards(opts.repoRoot)
  const full = await readFullRows(db)
  const plan = planRemediation(full.map(remediationRowOf), cards)
  const facts = await readReserveFacts(db, opts)
  const before = await readPersonaReserve({ reserveFacts: async () => facts })
  const predicted = cards === null ? before
    : await readPersonaReserve({ reserveFacts: async () => patchFacts(facts, full, plan, cards) })
  return { plan, before, predicted }
}

const AXES = (r: PersonaReserveResult): Record<string, number> =>
  Object.fromEntries(Object.entries(r.gapsByAxis).map(([a, g]) => [a, g.blocked.length + g.unknown.length]))
const validCodes = (r: PersonaReserveResult): string[] => [...r.byState.reserve, ...r.byState['stage-active']].sort()

/** 🔴 적용 뒤가 앞보다 나빠졌는가 · 예측과 다른가 — 하나라도 있으면 롤백 사유 */
export function regressionOf(before: PersonaReserveResult, after: PersonaReserveResult, predicted: PersonaReserveResult): string[] {
  const out: string[] = []
  if (after.contractValid === null || before.contractValid === null) out.push('계약 유효 수를 재지 못했다')
  else if (after.contractValid < before.contractValid) out.push(`계약 유효 ${before.contractValid}→${after.contractValid}`)
  const lost = validCodes(before).filter((c) => !validCodes(after).includes(c))
  if (lost.length > 0) out.push(`유효하던 사람이 빠졌다: ${lost.join(',')}`)
  const a0 = AXES(before)
  const a1 = AXES(after)
  for (const a of Object.keys(a1) as ContractAxis[]) if ((a1[a] ?? 0) > (a0[a] ?? 0)) out.push(`축 ${a} 악화 ${a0[a]}→${a1[a]}`)
  if (validCodes(after).join(',') !== validCodes(predicted).join(',')) {
    out.push(`예측과 다르다 — 예측 [${validCodes(predicted).join(',')}] · 실제 [${validCodes(after).join(',')}]`)
  }
  return out
}

async function untouched(db: Reader): Promise<Record<string, number>> {
  return {
    posts: await db.post.count(), comments: await db.comment.count(),
    personaQueue: await db.personaApprovalQueue.count(), originalQueue: await db.originalPostApprovalQueue.count(),
    activity: await db.personaActivityLog.count(), raw: await db.microSeedRawContent.count(),
    accounts: await db.account.count(), users: await db.user.count(), personas: await db.persona.count(),
  }
}

export type ApplyOutcome =
  | { ok: true; updated: string[]; before: number | null; after: number | null }
  | { ok: false; reason: string; wrote: 0 }

/**
 * 🔴 **적용 — 전원 아니면 0.** 부르는 쪽이 운영 여부를 막는다(CLI 는 이번 Phase 에서 격리 DB 만 연다).
 *    `hooks.beforeUpdate` 는 부분 실패 반례용이다 — 던지면 앞서 쓴 행까지 롤백된다.
 */
export async function applyRemediation(prisma: PrismaClient, input: {
  approvedDigest: string
  reason: string
  now: Date
  repoRoot: string
  hooks?: { beforeUpdate?: (code: string, index: number) => void }
}): Promise<ApplyOutcome> {
  if (input.reason.trim() === '') return { ok: false, reason: 'reason 이 비었다', wrote: 0 }
  const cards = readCards(input.repoRoot)
  if (cards === null) return { ok: false, reason: '정본 카드 문서를 읽지 못했다', wrote: 0 }
  let result: { updated: string[]; before: number | null; after: number | null } | null = null
  try {
    await prisma.$transaction(async (tx) => {
      // ① 트랜잭션 안에서 다시 계획 — 승인된 digest 와 같아야 한다(precondition 지문이 digest 에 들어 있다)
      const r = await readRemediation(tx, { now: input.now, repoRoot: input.repoRoot })
      if (r.plan.digest !== input.approvedDigest) {
        throw new Error(`PLAN_STALE — 승인 ${input.approvedDigest} · 지금 ${r.plan.digest} (계획 뒤 DB 가 바뀌었다)`)
      }
      if (r.plan.personas.length === 0) { result = { updated: [], before: r.before.contractValid, after: r.before.contractValid }; return }
      const pre = regressionOf(r.before, r.predicted, r.predicted)
      if (pre.length > 0) throw new Error(`예측이 이미 나쁘다 — ${pre.join(' · ')}`)
      const kept = await untouched(tx)

      // ② 행마다 precondition 을 다시 대조하고 쓴다
      const full = await readFullRows(tx)
      for (const [i, p] of r.plan.personas.entries()) {
        input.hooks?.beforeUpdate?.(p.code, i)
        const raw = full.find((f) => f.code === p.code)
        if (raw === undefined) throw new Error(`${p.code} 행이 없다`)
        const fixed = patchedRow(remediationRowOf(raw), p.changes)
        const n = await tx.persona.updateMany({
          // 🔴 조건부 write — 읽은 뒤 누가 바꿨으면 0 행 → throw
          where: { code: p.code, updatedAt: raw.updatedAt },
          data: {
            ageBand: fixed.ageBand, region: fixed.region,
            identity: (fixed.identity ?? {}) as Prisma.InputJsonValue,
            ...(fixed.voiceCore === null ? {} : { voiceCore: fixed.voiceCore as Prisma.InputJsonValue }),
            noGoTopics: [...fixed.noGoTopics], noGoExpressions: [...fixed.noGoExpressions],
            forbiddenReactionRoles: [...fixed.forbiddenReactionRoles],
          },
        })
        if (n.count !== 1) throw new Error(`${p.code} 조건부 write ${n.count}행 — 계획 뒤 바뀌었다`)
        const id = (await tx.persona.findUniqueOrThrow({ where: { code: p.code }, select: { id: true } })).id
        await tx.personaAuditLog.create({ data: {
          personaId: id, action: 'updated',
          reason: `정본 카드 복구(${r.plan.digest}) — ${p.changes.map((c) => c.field).join(',')} · ${input.reason}`,
        } })
      }

      // ③ 같은 판정으로 다시 잰다 — 예측과 다르거나 나빠지면 롤백
      const after = await readPersonaReserve({ reserveFacts: () => readReserveFacts(tx, { now: input.now, repoRoot: input.repoRoot }) })
      const bad = regressionOf(r.before, after, r.predicted)
      if (bad.length > 0) throw new Error(`적용 뒤 회귀 — ${bad.join(' · ')}`)
      const now = await untouched(tx)
      const drift = Object.entries(now).filter(([k, v]) => v !== kept[k])
      if (drift.length > 0) throw new Error(`건드리지 않기로 한 표가 변했다: ${drift.map(([k, v]) => `${k} ${kept[k]}→${v}`).join(' · ')}`)
      result = { updated: r.plan.personas.map((p) => p.code), before: r.before.contractValid, after: after.contractValid }
    }, { isolationLevel: 'Serializable', timeout: 120_000, maxWait: 20_000 })
  } catch (e) {
    return { ok: false, reason: `전원 롤백 — ${(e as Error).message}`, wrote: 0 }
  }
  const done = result as { updated: string[]; before: number | null; after: number | null } | null
  if (done === null) return { ok: false, reason: '결과가 없다', wrote: 0 }
  return { ok: true, ...done }
}
