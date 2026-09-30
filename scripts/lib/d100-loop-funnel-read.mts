/**
 * D100 루프 깔때기 **판독기** — 🔴 read-only. DB 읽기 · 장부 · 공급 회차 파일 읽기만. write 0 · 네트워크 0 · LLM 0
 *
 * 🔴 **쓰기 차단 클라이언트로만 읽는다.** `readOnlyPrisma` 가 create · update · upsert · delete 류와
 *    raw 실행을 호출 시점에 막는다 — 실수로 쓰는 코드가 들어와도 운영 DB 에 닿지 않는다.
 * 🔴 계산은 `src/lib/d100-loop-funnel.ts`(순수) 하나가 한다. 여기서는 행을 모을 뿐이다.
 * 🔴 **관측 전용** — 결과는 `d100:readiness` · `ops:status` 화면에만 간다. 결정 경로가 읽지 않는다.
 */
import { existsSync } from 'node:fs'

import { PrismaClient } from '@prisma/client'

import type { LedgerEntry } from '../../src/lib/llm-ledger'
import { buildLoopFunnel, kstDayOf, type LoopFunnel, type LoopRow, type SlotDay } from '../../src/lib/d100-loop-funnel'
import { GENERIC_STAGES, genericDailyTarget, type GenericStage } from '../../src/lib/stage-ladder-generic'
import { auditLedgerDir } from './auto-ready-semantic-provider.mjs'
import { defaultLedgerDir, ledgerPathOf, readLedgerDay } from './llm-ledger-store.mjs'
import { commentLoopLedgerDir } from './persona-comment-loop.mjs'
import { SUPPLY_DATA_DIR } from './runner-health.mjs'
import { settledTotalUsd, worksetSourcesIn } from './stage-preflight-facts.mjs'

/** 🔴 깔때기 창 — 최근 7일(KST 자정 경계가 아니라 지금부터 거슬러) */
export const LOOP_FUNNEL_WINDOW_DAYS = 7

const WRITE_OPERATIONS: ReadonlySet<string> = new Set([
  'create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'updateManyAndReturn',
  'upsert', 'delete', 'deleteMany',
  // 🔴 raw 는 읽기라도 막는다 — 이 판독기는 Raw SQL 을 쓰지 않는다(CLAUDE.md: Raw SQL 금지)
  '$executeRaw', '$executeRawUnsafe', '$queryRaw', '$queryRawUnsafe', '$runCommandRaw',
])

/** 🔴 쓰기 차단 — 모델 연산 중 쓰기는 호출 시점에 던진다 */
export function readOnlyPrisma(base: PrismaClient) {
  return base.$extends({
    name: 'loop-funnel-read-only',
    query: {
      // 🔴 최상위 `$allOperations` — 모델 연산과 raw 실행을 함께 덮는다
      async $allOperations({ model, operation, args, query }) {
        if (WRITE_OPERATIONS.has(operation)) throw new Error(`read-only 판독기: ${model ?? '$raw'}.${operation} 차단`)
        return query(args)
      },
    },
  })
}
export type ReadOnlyPrisma = ReturnType<typeof readOnlyPrisma>

const isGeneric = (s: string): s is GenericStage => (GENERIC_STAGES as readonly string[]).includes(s)

/** 🔴 창 안 날짜(`YYYY-MM-DD`)들의 장부 정산 합 — 파일이 하루도 없으면 `null`(미관측) */
export function windowLedgerUsd(dir: string, dates: readonly string[]): number | null {
  const days: LedgerEntry[][] = []
  for (const d of dates) {
    const p = ledgerPathOf(dir, d)
    if (!existsSync(p)) continue
    const r = readLedgerDay(p)
    if (r.ok) days.push(r.entries)
  }
  return days.length === 0 ? null : settledTotalUsd(days.flat())
}

export async function collectLoopRows(db: ReadOnlyPrisma, from: Date): Promise<LoopRow[]> {
  const q = await db.originalPostApprovalQueue.findMany({
    where: {
      OR: [
        { createdAt: { gte: from } },
        { decidedAt: { gte: from } },
        { createdPost: { createdAt: { gte: from } } },
      ],
    },
    select: {
      gateResults: true, createdAt: true, status: true, decidedAt: true, decidedBy: true,
      createdPost: { select: { id: true, createdAt: true } },
      autoReadyAudit: { select: { judgedAt: true, defect: true } },
    },
  })
  const postIds = q.map((r) => r.createdPost?.id).filter((x): x is string => typeof x === 'string')
  const firstComment = new Map<string, Date>()
  if (postIds.length > 0) {
    const cs = await db.comment.findMany({
      where: { postId: { in: postIds }, personaId: { not: null } },
      select: { postId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
    for (const c of cs) if (!firstComment.has(c.postId)) firstComment.set(c.postId, c.createdAt)
  }
  const READY = new Set(['APPROVED', 'EDITED', 'PUBLISHED'])
  return q.map((r) => ({
    gateResults: r.gateResults,
    generatedAt: r.createdAt.toISOString(),
    readyAt: READY.has(r.status) && r.decidedAt !== null ? r.decidedAt.toISOString() : null,
    decidedBy: r.decidedBy,
    publicAt: r.createdPost?.createdAt.toISOString() ?? null,
    firstPersonaCommentAt: r.createdPost === null ? null : firstComment.get(r.createdPost.id)?.toISOString() ?? null,
    audit: r.autoReadyAudit === null ? null
      : { judged: r.autoReadyAudit.judgedAt !== null, defect: r.autoReadyAudit.defect === 'yes' },
  }))
}

export async function collectSlotDays(db: ReadOnlyPrisma, dates: readonly string[]): Promise<SlotDay[]> {
  const rows = await db.stageDecision.findMany({
    where: { kstDate: { in: [...dates] } },
    select: { kstDate: true, release: true },
  })
  return rows.filter((r) => isGeneric(r.release))
    .map((r) => ({ kstDate: r.kstDate, release: r.release, target: genericDailyTarget(r.release as GenericStage) }))
}

/**
 * 🔴 **깔때기를 읽는다.** DB 를 못 읽으면 `{ ok:false }` — 0 이 아니다.
 *    계약 유효 Persona 수는 부르는 쪽이 이미 읽은 값(Persona 4상태 정본)을 넘긴다.
 */
export async function readLoopFunnel(now: Date, opts: {
  contractValidPersonas: number | null
  dataDir?: string
  prisma?: PrismaClient
}): Promise<{ ok: true; funnel: LoopFunnel } | { ok: false; detail: string }> {
  if (opts.prisma === undefined && (process.env.DATABASE_URL ?? '') === '') {
    return { ok: false, detail: 'DATABASE_URL 이 없다 — 깔때기를 읽지 않았다(미관측)' }
  }
  const base = opts.prisma ?? new PrismaClient()
  const db = readOnlyPrisma(base)
  const from = new Date(now.getTime() - LOOP_FUNNEL_WINDOW_DAYS * 864e5)
  const dates = Array.from({ length: LOOP_FUNNEL_WINDOW_DAYS + 1 },
    (_, i) => kstDayOf(from.getTime() + i * 864e5))
  try {
    const rows = await collectLoopRows(db, from)
    const slotDays = await collectSlotDays(db, dates)
    const funnel = buildLoopFunnel({
      rows,
      windowFrom: from.toISOString(),
      windowTo: now.toISOString(),
      candidates: worksetSourcesIn(opts.dataDir ?? SUPPLY_DATA_DIR, from.getTime(), now.getTime()),
      slotDays,
      costs: {
        supplyUsd: windowLedgerUsd(defaultLedgerDir(), dates),
        commentUsd: windowLedgerUsd(commentLoopLedgerDir(), dates),
        auditUsd: windowLedgerUsd(auditLedgerDir(), dates),
      },
      contractValidPersonas: opts.contractValidPersonas,
    })
    return { ok: true, funnel }
  } catch (e) {
    return { ok: false, detail: `깔때기를 읽지 못했다 — ${(e as Error).name}: ${(e as Error).message.slice(0, 120)}` }
  } finally {
    if (opts.prisma === undefined) await base.$disconnect()
  }
}
