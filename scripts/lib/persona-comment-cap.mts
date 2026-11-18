/**
 * Persona 댓글 상한(`dailyCap` · `weeklyCap`) 일괄 변경 — 판정과 실행부
 *
 * 이 상한은 **댓글만** 센다(`persona-publish-tx` 가 `PersonaActivityLog kind=comment` 로 센다).
 * 운영 CLI(`persona-comment-cap-apply.mts`)와 격리 DB 검사가 같은 함수를 쓴다.
 *
 * 🔴 정확한 사전 조건이 맞을 때만 쓴다 — active 행은 "옛 값인 대상" 과 "그대로 둘 값" 두 무리뿐이어야 한다.
 *    모르는 조합이 하나라도 있으면 아무것도 쓰지 않는다.
 */
import type { PrismaClient } from '@prisma/client'

export type Cap = { daily: number; weekly: number }
export type CapRow = { code: string; status: string; dailyCap: number | null; weeklyCap: number | null }

export type CapPlanInput = {
  rows: readonly CapRow[]
  /** 바꿀 행의 지금 값 */
  from: Cap
  /** 바꾼 뒤 값 */
  to: Cap
  /** 건드리지 않는 무리의 값(조용한 Persona) */
  keep: Cap
  /** 바뀌어야 하는 행 수 — 다르면 거절한다 */
  expect: number
}

export type CapPlan =
  | { ok: true; code: 'APPLY'; targets: string[]; kept: string[] }
  | { ok: true; code: 'ALREADY_APPLIED'; targets: []; kept: string[] }
  | { ok: false; code: 'ARGS' | 'UNKNOWN_ROWS' | 'EXPECT_MISMATCH'; reason: string }

const validCap = (c: Cap): boolean =>
  Number.isInteger(c.daily) && Number.isInteger(c.weekly)
  && c.daily >= 1 && c.daily <= 10 && c.weekly >= c.daily && c.weekly <= 70

const same = (r: CapRow, c: Cap): boolean => r.dailyCap === c.daily && r.weeklyCap === c.weekly

export function planCapChange(i: CapPlanInput): CapPlan {
  if (!validCap(i.from) || !validCap(i.to) || !validCap(i.keep)) {
    return { ok: false, code: 'ARGS', reason: '상한 값 범위 밖 (하루 1~10 · 주 ≥ 하루 · 주 ≤ 70)' }
  }
  if (!Number.isInteger(i.expect) || i.expect <= 0) return { ok: false, code: 'ARGS', reason: '--expect 는 양의 정수' }
  if (same({ code: '', status: '', dailyCap: i.from.daily, weeklyCap: i.from.weekly }, i.to)) {
    return { ok: false, code: 'ARGS', reason: '바꾸기 전과 뒤 값이 같다' }
  }
  const active = i.rows.filter((r) => r.status === 'active')
  const targets = active.filter((r) => same(r, i.from)).map((r) => r.code).sort()
  const done = active.filter((r) => same(r, i.to)).map((r) => r.code).sort()
  const kept = active.filter((r) => same(r, i.keep)).map((r) => r.code).sort()
  const unknown = active.filter((r) => !same(r, i.from) && !same(r, i.to) && !same(r, i.keep))
  if (unknown.length > 0) {
    return {
      ok: false, code: 'UNKNOWN_ROWS',
      reason: `모르는 상한 조합 ${unknown.length}행 — ${unknown.map((r) => `${r.code}(${String(r.dailyCap)}/${String(r.weeklyCap)})`).join(' · ')}`,
    }
  }
  if (targets.length === 0 && done.length === i.expect) return { ok: true, code: 'ALREADY_APPLIED', targets: [], kept }
  // 🔴 일부만 바뀐 상태(대상과 완료가 섞임)도 기대 수와 다르므로 여기서 거절된다
  if (targets.length !== i.expect || done.length !== 0) {
    return {
      ok: false, code: 'EXPECT_MISMATCH',
      reason: `대상 ${targets.length}행 · 이미 바뀐 ${done.length}행 — 기대는 대상 ${i.expect}행 · 이미 바뀐 0행`,
    }
  }
  return { ok: true, code: 'APPLY', targets, kept }
}

export const readCapRows = async (db: Pick<PrismaClient, 'persona'>): Promise<CapRow[]> =>
  (await db.persona.findMany({ select: { code: true, status: true, dailyCap: true, weeklyCap: true }, orderBy: { code: 'asc' } }))
    .map((r) => ({ code: r.code, status: String(r.status), dailyCap: r.dailyCap, weeklyCap: r.weeklyCap }))

export type CapApplyResult =
  | { code: 'APPLIED'; changed: number; targets: string[] }
  | { code: 'ALREADY_APPLIED'; changed: 0 }
  | { code: 'REFUSED'; changed: 0; reason: string }

/**
 * 🔴 계획과 쓰기를 **한 트랜잭션**에서 한다 — 행을 다시 읽어 계획을 세우고, 옛 값 조건을 where 에 넣어 바꾼다.
 *    갱신된 수가 계획과 다르면 던져서 전부 되돌린다.
 */
export async function applyCapChange(
  db: PrismaClient,
  i: Omit<CapPlanInput, 'rows'> & { reason: string },
): Promise<CapApplyResult> {
  if (i.reason.trim() === '') return { code: 'REFUSED', changed: 0, reason: '--reason 이 비었다' }
  try {
    return await db.$transaction(async (tx) => {
      const plan = planCapChange({ ...i, rows: await readCapRows(tx) })
      if (!plan.ok) return { code: 'REFUSED', changed: 0, reason: `${plan.code} — ${plan.reason}` } as const
      if (plan.code === 'ALREADY_APPLIED') return { code: 'ALREADY_APPLIED', changed: 0 } as const
      const hit = await tx.persona.updateMany({
        where: { code: { in: plan.targets }, status: 'active', dailyCap: i.from.daily, weeklyCap: i.from.weekly },
        data: { dailyCap: i.to.daily, weeklyCap: i.to.weekly },
      })
      if (hit.count !== plan.targets.length) throw new Error(`갱신 ${hit.count}행 ≠ 계획 ${plan.targets.length}행`)
      const ids = await tx.persona.findMany({ where: { code: { in: plan.targets } }, select: { id: true } })
      await tx.personaAuditLog.createMany({
        data: ids.map((p) => ({
          personaId: p.id, action: 'updated' as const, changedFields: ['dailyCap', 'weeklyCap'],
          reason: `댓글 상한 ${i.from.daily}/${i.from.weekly} → ${i.to.daily}/${i.to.weekly} · ${i.reason.trim().slice(0, 200)}`,
        })),
      })
      return { code: 'APPLIED', changed: hit.count, targets: plan.targets } as const
    })
  } catch (e) {
    return { code: 'REFUSED', changed: 0, reason: `트랜잭션 되돌림 — ${e instanceof Error ? e.message : String(e)}` }
  }
}
