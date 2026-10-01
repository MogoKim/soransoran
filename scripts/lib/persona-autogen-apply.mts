/**
 * Persona 자동 후보 **draft 적재** — 🔴 `--apply` 뒤에서만 부른다 (2026-09-29, Track C)
 *
 * 🔴 **하는 일은 `persona-cohort-run` 의 create + seed 두 단계를 한 트랜잭션으로 합친 것뿐이다.**
 *    새 User(계정 없음) · Persona(status=draft, seed 채움) · 감사 기록 3건(created ·
 *    display_name_assigned · updated). 🔴 **켜지 않는다** — activate 는 기존 도구가
 *    정본 카드(문서)·cohort manifest·ACTOR_USER_ID·reason 을 요구하며 따로 한다.
 *
 * 🔴 전원 아니면 0 — 한 명이라도 어긋나면 throw → 롤백한다.
 *    · 배치에 `valid` 가 아닌 후보가 하나라도 있으면 시작하지 않는다
 *    · `--limit` 은 적재 인원과 정확히 같아야 한다
 *    · 트랜잭션 **안에서** 코드 부재 · Gate ⑥-B(회원 이름 · 다른 Persona · 규칙)를 다시 본다
 *    · 건드리지 않기로 한 표(Post · Comment · Queue · ActivityLog · RawContent)가 그대로인지 본다
 */
import type { Prisma, PrismaClient } from '@prisma/client'

import { verifyNamePolicy } from '../../src/lib/persona-nickname-candidates'
import { checkNameCollision } from './persona-gate-name-collision.mjs'
import { loadNameCollisionSets } from './persona-name-collision-sets.mjs'

export type AutogenDraftPlan = {
  code: string
  status: 'valid' | 'quarantined' | 'rejected'
  name: string
  seed: Record<string, unknown>
}

export type ApplyResult =
  | { ok: true; created: string[] }
  | { ok: false; reason: string; wrote: 0 }

/** 🔴 적재 전에 막는 것 — DB 를 열기 전에 판정한다 */
export function judgeApplyBatch(plans: readonly AutogenDraftPlan[], limit: number | null): string[] {
  const problems: string[] = []
  if (plans.length === 0) problems.push('적재할 valid 후보가 0명이다')
  const bad = plans.filter((p) => p.status !== 'valid')
  if (bad.length > 0) problems.push(`valid 가 아닌 후보가 섞였다: ${bad.map((p) => `${p.code}=${p.status}`).join(', ')}`)
  if (limit !== plans.length) problems.push(`--limit 은 ${plans.length} 이어야 한다 (받은 값 ${limit ?? '없음'}) — 일부만 적재하지 않는다`)
  const codes = plans.map((p) => p.code)
  if (new Set(codes).size !== codes.length) problems.push('코드가 겹친다')
  const names = plans.map((p) => p.name.trim())
  if (new Set(names).size !== names.length) problems.push('이름이 겹친다')
  for (const p of plans) {
    const v = verifyNamePolicy(p.name)
    if (!v.ok) problems.push(`${p.code}: 작명 정책 — ${v.problems.join(' / ')}`)
  }
  return problems
}

async function untouched(db: PrismaClient | Prisma.TransactionClient): Promise<Record<string, number>> {
  return {
    posts: await db.post.count(),
    comments: await db.comment.count(),
    queue: await db.originalPostApprovalQueue.count(),
    activity: await db.personaActivityLog.count(),
    raw: await db.microSeedRawContent.count(),
    accounts: await db.account.count(),
  }
}

export async function applyAutogenDrafts(prisma: PrismaClient, input: {
  plans: readonly AutogenDraftPlan[]
  limit: number | null
  reason: string
}): Promise<ApplyResult> {
  const pre = judgeApplyBatch(input.plans, input.limit)
  if (pre.length > 0) return { ok: false, reason: pre.join(' / '), wrote: 0 }
  if (input.reason.trim() === '') return { ok: false, reason: 'reason 이 비었다', wrote: 0 }

  const before = await untouched(prisma)
  try {
    await prisma.$transaction(async (tx) => {
      const codes = input.plans.map((p) => p.code)
      const exist = await tx.persona.findMany({ where: { code: { in: codes } }, select: { code: true } })
      if (exist.length > 0) throw new Error(`이미 있는 코드: ${exist.map((e) => e.code).join(', ')}`)
      // 🔴 Gate ⑥-B 최종 판정은 트랜잭션 **안**이다 — 사전 검사와 커밋 사이에 회원이 같은 이름을 만들 수 있다
      const sets = await loadNameCollisionSets(tx)
      const blocked = input.plans
        .map((p) => ({ code: p.code, v: checkNameCollision(p.name, sets) }))
        .filter((x) => x.v.status !== 'pass')
      if (blocked.length > 0) {
        throw new Error(`Gate ⑥-B: ${blocked.map((b) => `${b.code}=${b.v.status}`).join(', ')}`)
      }
      for (const p of input.plans) {
        const s = p.seed
        // 🔴 기존 User 를 재사용하지 않는다 — Account 가 붙은 계정을 주우면 그 사람 이름으로 글이 나간다
        const user = await tx.user.create({ data: { nickname: p.name.trim() }, select: { id: true } })
        const persona = await tx.persona.create({
          data: {
            code: p.code, userId: user.id, status: 'draft',
            ageBand: s.ageBand as string, region: s.region as string, lifeStage: s.lifeStage as string,
            identity: s.identity as Prisma.InputJsonValue, voiceCore: s.voiceCore as Prisma.InputJsonValue,
            voiceVariations: s.voiceVariations as Prisma.InputJsonValue,
            activityRhythm: s.activityRhythm as Prisma.InputJsonValue,
            noGoTopics: s.noGoTopics as string[], noGoExpressions: s.noGoExpressions as string[],
            forbiddenReactionRoles: s.forbiddenReactionRoles as string[],
            dailyCap: s.dailyCap as number, weeklyCap: s.weeklyCap as number,
            silenceRate: s.silenceRate as number,
          },
          select: { id: true },
        })
        await tx.personaAuditLog.create({ data: { personaId: persona.id, action: 'created', toStatus: 'draft', reason: input.reason } })
        await tx.personaAuditLog.create({ data: { personaId: persona.id, action: 'display_name_assigned', reason: 'Gate ⑥-B pass 후 배정 (트랜잭션 안 재판정)' } })
        await tx.personaAuditLog.create({ data: { personaId: persona.id, action: 'updated', reason: `seed 적용 — 자동 후보 검증 통과 · ${input.reason}` } })
      }
    }, { isolationLevel: 'Serializable', timeout: Math.max(60_000, input.plans.length * 3_000), maxWait: 20_000 })
  } catch (e) {
    return { ok: false, reason: `전원 롤백 — ${(e as Error).message}`, wrote: 0 }
  }
  const after = await untouched(prisma)
  const drift = Object.entries(after).filter(([k, v]) => v !== before[k])
  if (drift.length > 0) {
    // 🔴 커밋 뒤라 되돌릴 수 없다 — 숨기지 않고 실패로 올린다
    throw new Error(`건드리지 않기로 한 표가 변했다: ${drift.map(([k, v]) => `${k} ${before[k]}→${v}`).join(' · ')}`)
  }
  return { ok: true, created: input.plans.map((p) => p.code) }
}
