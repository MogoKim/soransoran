/**
 * P15 정본 교정 1회 — `identity.workStatus` 한 칸만 정본 카드 값으로 (2026-11-15 P0)
 *
 * 왜: 9736e70f(PR #843)가 `verifySeedCard` 에 workStatus 대조를 더했다. P15 의 저장값(2026-10-01 이후 불변)이
 *     2026-08-30 최초 정본부터 바뀐 적 없는 카드 값과 달라, 11-15 00:01 runtime 배포부터 계약 유효 40 → 39 가 됐다.
 *
 * 🔴 계약
 *    · 이전 값은 **digest 로 고정**한다(identity 전체 · updatedAt). 하나라도 다르면 write 0 — 누가 그 사이 바꿨다
 *    · 교정 뒤 identity 도 digest 로 고정한다 — 정본 카드 값이 바뀌었으면 write 0
 *    · 바꾸는 것은 workStatus 하나. 다른 키 · 다른 Persona · 다른 표는 건드리지 않는다
 *    · Serializable 트랜잭션 안에서 다시 읽고 조건부 update(updatedAt 일치) · 감사 행 1
 *    · 커밋 뒤 정본 판독이 기대 용량이 아니거나 다른 Persona 지문이 바뀌었으면 **같은 조건부 방식으로 되돌린다**
 *    · 이미 교정된 상태(교정 뒤 digest)면 아무것도 하지 않는다(멱등)
 */
import { createHash } from 'node:crypto'

import type { PrismaClient, Prisma } from '@prisma/client'

export const P15_CODE = 'P15'
export const P15_FIELD = 'workStatus'

export type RemediationPins = {
  code: string
  beforeIdentityDigest: string
  beforeUpdatedAt: string
  afterIdentityDigest: string
}

/** 🔴 운영 핀 — 2026-11-15 06:50 보조 Mac 운영 DB read-only 실측(정규 digest) */
export const P15_PRODUCTION_PINS: RemediationPins = {
  code: P15_CODE,
  beforeIdentityDigest: 'cef9a699e6ef9dccde357769cab435be9ea1bb7dd88eeadb7ad09211bc335514',
  beforeUpdatedAt: '2026-10-01T15:44:37.757Z',
  afterIdentityDigest: '055c5071387dade05d2c1da121732d6fd1fd0f140bd0783198d2098ada2635bb',
}

/**
 * 🔴 **정규 digest** — 객체 키를 재귀 정렬한 JSON 의 SHA-256. jsonb 는 키 순서를 재배열하므로(길이·바이트 순)
 *    `JSON.stringify` 그대로는 같은 값이 다른 digest 가 된다(격리 DB 검사 재현). 배열 순서는 값의 일부다.
 */
const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical)
  : v !== null && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]))
    : v
export const digestOf = (v: unknown): string => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex')

export type PlanInput = {
  pins: RemediationPins
  /** 지금 DB 행 — 없으면 null */
  row: { identity: unknown; updatedAt: string; status: string } | null
  /** 정본 카드의 workStatus — 카드를 못 읽었으면 null */
  cardValue: string | null
  /** 지금 행에 대한 정본 seed 대조 결과(문제 문장) · 교정본에 대한 결과 */
  problemsBefore: readonly string[] | null
  problemsAfter: readonly string[] | null
}
export type Plan =
  | { ok: true; code: 'APPLY'; after: Record<string, unknown> }
  | { ok: true; code: 'ALREADY_APPLIED' }
  | { ok: false; code: string; reason: string }

export function planRemediation(i: PlanInput): Plan {
  const no = (code: string, reason: string): Plan => ({ ok: false, code, reason })
  if (i.row === null) return no('NOT_FOUND', `${i.pins.code} 행이 없다`)
  if (i.row.identity === null || typeof i.row.identity !== 'object' || Array.isArray(i.row.identity)) return no('IDENTITY_SHAPE', 'identity 가 객체가 아니다')
  const now = digestOf(i.row.identity)
  if (now === i.pins.afterIdentityDigest) return { ok: true, code: 'ALREADY_APPLIED' }
  if (now !== i.pins.beforeIdentityDigest) return no('BEFORE_DIGEST_MISMATCH', '이전 값이 고정 digest 와 다르다 — 그 사이 바뀌었다')
  if (i.row.updatedAt !== i.pins.beforeUpdatedAt) return no('BEFORE_UPDATED_AT_MISMATCH', '이전 updatedAt 이 고정값과 다르다')
  if (i.row.status !== 'active') return no('STATUS', `status=${i.row.status} — active 만 교정한다`)
  if (i.cardValue === null || i.cardValue.trim() === '') return no('CARD_UNREADABLE', '정본 카드 값을 읽지 못했다')
  if (i.problemsBefore === null || i.problemsAfter === null) return no('VERIFY_UNREADABLE', '정본 대조를 하지 못했다')
  if (i.problemsBefore.length !== 1 || !i.problemsBefore[0]!.startsWith(`${P15_FIELD} `)) {
    return no('PROBLEMS_NOT_EXACT', `교정 전 문제가 ${P15_FIELD} 1건이 아니다(${i.problemsBefore.length}건)`)
  }
  const identity = i.row.identity as Record<string, unknown>
  if (typeof identity[P15_FIELD] !== 'string' || identity[P15_FIELD] === '') return no('FIELD_EMPTY', `${P15_FIELD} 이 비어 있다 — 채우기가 아니라 교정만 한다`)
  const after = { ...identity, [P15_FIELD]: i.cardValue }
  if (digestOf(after) !== i.pins.afterIdentityDigest) return no('AFTER_DIGEST_MISMATCH', '교정본 digest 가 고정값과 다르다 — 정본 카드가 바뀌었다')
  if (i.problemsAfter.length !== 0) return no('AFTER_NOT_CLEAN', `교정본에도 문제가 ${i.problemsAfter.length}건 남는다`)
  return { ok: true, code: 'APPLY', after }
}

export type OutcomeInput = {
  capacityBefore: { contractValid: number | null; stageActive: number | null }
  capacityAfter: { contractValid: number | null; stageActive: number | null }
  othersBefore: string
  othersAfter: string
}
/** 🔴 기대: 정확히 +1 · 다른 Persona 지문 diff 0. 판독 실패는 되돌린다 */
export function judgeRemediationOutcome(o: OutcomeInput): { code: 'PASS' | 'ROLLBACK'; problems: string[] } {
  const p: string[] = []
  const b = o.capacityBefore; const a = o.capacityAfter
  if (b.contractValid === null || b.stageActive === null) p.push('교정 전 정본 판독 실패')
  if (a.contractValid === null || a.stageActive === null) p.push('교정 후 정본 판독 실패')
  if (p.length === 0) {
    if (a.contractValid !== b.contractValid! + 1) p.push(`contract-valid ${b.contractValid}→${a.contractValid} (기대 +1)`)
    if (a.stageActive !== b.stageActive! + 1) p.push(`stage-active ${b.stageActive}→${a.stageActive} (기대 +1)`)
  }
  if (o.othersBefore !== o.othersAfter) p.push('P15 외 Persona 지문이 바뀌었다')
  return { code: p.length === 0 ? 'PASS' : 'ROLLBACK', problems: p }
}

type Db = PrismaClient
type Tx = Prisma.TransactionClient

/** 🔴 P15 를 뺀 모든 Persona 행 지문 — code · status · updatedAt · identity digest */
export async function othersFingerprint(db: Db | Tx, code: string): Promise<string> {
  const rows = await db.persona.findMany({ where: { code: { not: code } }, select: { code: true, status: true, updatedAt: true, identity: true }, orderBy: { code: 'asc' } })
  return digestOf(rows.map((r) => [r.code, r.status, r.updatedAt.toISOString(), digestOf(r.identity)]))
}

export type ApplyResult =
  | { code: 'APPLIED'; beforeValue: string; capacityBefore: OutcomeInput['capacityBefore']; capacityAfter: OutcomeInput['capacityAfter'] }
  | { code: 'ALREADY_APPLIED' }
  | { code: 'REFUSED'; reason: string }
  | { code: 'ROLLED_BACK'; reason: string; restored: boolean }

/**
 * 🔴 실행부 — 계획·판독·트랜잭션 · 사후 판정 · 자동 되돌림. 운영 CLI 와 격리 DB 검사가 **같은 함수**를 부른다.
 *    `plan` 은 트랜잭션 안에서 다시 계산한다(호출자가 준 행을 믿지 않는다).
 */
export async function applyRemediation(db: Db, deps: {
  pins: RemediationPins
  readPlanInput: (tx: Db | Tx) => Promise<PlanInput>
  readCapacity: () => Promise<OutcomeInput['capacityBefore']>
  reason: string
  /** 🔴 시험 전용 — 커밋 뒤 사후 판정 전에 끼어들 자리(부분 실패 반례) */
  afterCommitHook?: () => Promise<void>
}): Promise<ApplyResult> {
  const firstInput = await deps.readPlanInput(db)
  const first = planRemediation(firstInput)
  if (!first.ok) return { code: 'REFUSED', reason: `${first.code}: ${first.reason}` }
  if (first.code === 'ALREADY_APPLIED') return { code: 'ALREADY_APPLIED' }
  // 🔴 이전 값 — 되돌림이 쓴다. before digest 로 검증된 행에서만 잡는다(planRemediation 통과)
  const beforeValue = String((firstInput.row!.identity as Record<string, unknown>)[P15_FIELD])
  const capacityBefore = await deps.readCapacity()
  const othersBefore = await othersFingerprint(db, deps.pins.code)
  let newUpdatedAt: Date
  try {
    newUpdatedAt = await db.$transaction(async (tx) => {
      const plan = planRemediation(await deps.readPlanInput(tx))
      if (!plan.ok || plan.code !== 'APPLY') throw new Error(`트랜잭션 안 재계획 실패 — ${plan.ok ? plan.code : `${plan.code}: ${plan.reason}`}`)
      const u = await tx.persona.updateMany({
        where: { code: deps.pins.code, status: 'active', updatedAt: new Date(deps.pins.beforeUpdatedAt) },
        data: { identity: plan.after as Prisma.InputJsonValue },
      })
      if (u.count !== 1) throw new Error(`조건부 update ${u.count}건 — 그 사이 바뀌었다`)
      const p = await tx.persona.findUniqueOrThrow({ where: { code: deps.pins.code }, select: { id: true, updatedAt: true } })
      await tx.personaAuditLog.create({ data: {
        personaId: p.id, action: 'updated',
        reason: `${deps.reason} · ${P15_FIELD} 정본 교정 · before ${deps.pins.beforeIdentityDigest.slice(0, 16)} → after ${deps.pins.afterIdentityDigest.slice(0, 16)}`,
      } })
      return p.updatedAt
    }, { isolationLevel: 'Serializable', timeout: 30_000, maxWait: 20_000 })
  } catch (e) {
    return { code: 'REFUSED', reason: `트랜잭션 롤백(write 0) — ${(e as Error).message}` }
  }
  if (deps.afterCommitHook !== undefined) await deps.afterCommitHook()
  const capacityAfter = await deps.readCapacity().catch(() => ({ contractValid: null, stageActive: null }))
  const othersAfter = await othersFingerprint(db, deps.pins.code)
  const outcome = judgeRemediationOutcome({ capacityBefore, capacityAfter, othersBefore, othersAfter })
  if (outcome.code === 'PASS') return { code: 'APPLIED', beforeValue, capacityBefore, capacityAfter }
  const restored = await restoreRemediation(db, { pins: deps.pins, beforeValue, expectUpdatedAt: newUpdatedAt, reason: `${deps.reason} · 자동 되돌림(${outcome.problems.join(' / ')})` })
  return { code: 'ROLLED_BACK', reason: outcome.problems.join(' / '), restored: restored.ok }
}

/**
 * 🔴 되돌림 — 교정본(after digest)일 때만 이전 identity 로. 이전 identity 는 지금 행에서 한 칸만 되돌려 만든다
 *    (`beforeValue` 를 따로 저장하지 않고, before digest 로 검증한다).
 */
export async function restoreRemediation(db: Db, i: { pins: RemediationPins; beforeValue?: string; expectUpdatedAt?: Date; reason: string }): Promise<{ ok: boolean; reason: string }> {
  try {
    return await db.$transaction(async (tx) => {
      const row = await tx.persona.findUnique({ where: { code: i.pins.code }, select: { id: true, identity: true, updatedAt: true } })
      if (row === null) return { ok: false, reason: '행이 없다' }
      if (digestOf(row.identity) !== i.pins.afterIdentityDigest) return { ok: false, reason: '교정본 digest 가 아니다 — 되돌리지 않는다' }
      if (i.expectUpdatedAt !== undefined && row.updatedAt.getTime() !== i.expectUpdatedAt.getTime()) return { ok: false, reason: '교정 뒤 다시 바뀌었다 — 되돌리지 않는다' }
      if (i.beforeValue === undefined) return { ok: false, reason: '이전 값이 없다' }
      const before = { ...(row.identity as Record<string, unknown>), [P15_FIELD]: i.beforeValue }
      if (digestOf(before) !== i.pins.beforeIdentityDigest) return { ok: false, reason: '이전 값으로 만든 identity 가 before digest 와 다르다' }
      const u = await tx.persona.updateMany({ where: { code: i.pins.code, updatedAt: row.updatedAt }, data: { identity: before as Prisma.InputJsonValue } })
      if (u.count !== 1) throw new Error(`되돌림 조건부 update ${u.count}건`)
      await tx.personaAuditLog.create({ data: { personaId: row.id, action: 'updated', reason: `${i.reason} · ${P15_FIELD} 되돌림 → before ${i.pins.beforeIdentityDigest.slice(0, 16)}` } })
      return { ok: true, reason: '되돌림' }
    }, { isolationLevel: 'Serializable', timeout: 30_000, maxWait: 20_000 })
  } catch (e) { return { ok: false, reason: (e as Error).message } }
}
