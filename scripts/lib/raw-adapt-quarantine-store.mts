/**
 * 🔴 **적응 레인 격리 행 — 읽기 · 기한 청소 (DB)** (2026-09-29)
 *
 *   판정은 전부 `src/lib/raw-adapt-quarantine.ts`(순수)가 한다. 여기는 읽고, `apply` 일 때만 쓴다.
 *   · 읽기 — 격리 행을 살아 있는 것 / 기한 지난 것으로 나눈다(기한 지난 행은 읽을 때 뺀다)
 *   · 청소 — 기한 지난 **검토되지 않은** 격리 행만 `EXPIRED` 로 보낸다. 🔴 `apply` 가 아니면 write 0
 *     건별 조건부 update(상태 · 발행 · 결정자 · `updatedAt` 이 읽은 그대로일 때만) — 그 사이 바뀐 행은 건드리지 않는다
 *   🔴 예약되어 있지 않다(launchd 0). 사람이 손으로 부르거나 격리 DB 검사가 부른다.
 *   🔴 Raw SQL 없음 · 네트워크 0 · LLM 0. 행을 지우지 않는다 · 본문 · 표식을 고치지 않는다.
 */
import type { PrismaClient } from '@prisma/client'

import { quarantineViewOf, planRawAdaptSweep, type QuarantineRowFacts } from '../../src/lib/raw-adapt-quarantine'

type Row = QuarantineRowFacts & { updatedAt: Date }

const SELECT = {
  id: true, status: true, createdPostId: true, decidedBy: true, gateResults: true, createdAt: true, updatedAt: true,
} as const

async function readRows(prisma: PrismaClient): Promise<Row[]> {
  return (await prisma.originalPostApprovalQueue.findMany({ select: SELECT, orderBy: { createdAt: 'asc' } }))
    .map((r) => ({ ...r, status: String(r.status) }))
}

/** 🔴 격리 행 보기 — 살아 있는 것 · 기한 지난 것 · 청소 대상. 읽기만 한다 */
export async function readRawAdaptQuarantine(prisma: PrismaClient, now: Date): Promise<{
  live: Row[]; expired: Row[]; sweep: Row[]
}> {
  const rows = await readRows(prisma)
  const v = quarantineViewOf(rows, now)
  return { live: v.live, expired: v.expired, sweep: planRawAdaptSweep(rows, now) }
}

/**
 * 🔴 **기한 청소** — `apply: false` 면 계획만 돌려준다(write 0).
 *    `apply: true` 면 청소 대상만 건별 조건부 update 로 `EXPIRED` 로 보낸다.
 */
export async function sweepRawAdaptQuarantine(prisma: PrismaClient, now: Date, opts: { apply: boolean }): Promise<{
  planned: string[]; expired: string[]; raced: string[]
}> {
  const { sweep } = await readRawAdaptQuarantine(prisma, now)
  const planned = sweep.map((r) => r.id)
  if (!opts.apply) return { planned, expired: [], raced: [] }
  const expired: string[] = []
  const raced: string[] = []
  for (const r of sweep) {
    const res = await prisma.originalPostApprovalQueue.updateMany({
      where: {
        id: r.id, status: 'APPROVED', createdPostId: null,
        decidedBy: r.decidedBy, updatedAt: r.updatedAt,
      },
      data: { status: 'EXPIRED' },
    })
    ;(res.count === 1 ? expired : raced).push(r.id)
  }
  return { planned, expired, raced }
}
