/**
 * Persona 확장 **운영 원자료** — 🔴 read-only. DB write 0 · Raw SQL 0 · 네트워크(DB 외) 0 (2026-10-13)
 *
 * 🔴 판정하지 않는다. 운영 정본 판정의 **결과**와 셀 수 있는 사실만 모은다.
 *
 *      계약 유효      `readPersonaReserve`(운영 4상태 · 단계 preflight 가 받는 값과 같은 함수)
 *      활동          Post.personaId(공개 글) · Comment.personaId(삭제 제외) — 7일 · 30일 창
 *      게시판         Persona 공개 글의 boardType — 30일 창
 *      이름 대조 집합  `loadNameCollisionSets`(회원 이름 · 기존 Persona 이름 전부)
 *      cadence       운영 active 행의 최빈값 재료 — autogen 과 같은 거름
 *
 * 🔴 출력에는 코드 · 개수만 나간다. 회원 이름 원문은 대조 집합 안에만 있고 화면에 찍지 않는다.
 */
import type { Prisma, PrismaClient } from '@prisma/client'

import type { Cadence } from '../../src/lib/persona-autogen'
import type { PersonaActivityRow } from '../../src/lib/persona-expansion'
import type { PersonaReserveResult } from '../../src/lib/persona-reserve'
import { readPersonaReserve } from './d100-persona-tiers.mjs'
import type { NameCollisionSets } from './persona-gate-name-collision.mjs'
import { loadNameCollisionSets } from './persona-name-collision-sets.mjs'
import { prismaReserveRepo } from './persona-reserve-facts.mjs'

type Reader = PrismaClient | Prisma.TransactionClient

export type ExpansionFacts = {
  reserve: PersonaReserveResult
  /** DB 의 Persona 코드 전부(status 무관) — high-water · CODE_TAKEN 용 */
  dbCodes: string[]
  statusOf: Record<string, string>
  activity7: PersonaActivityRow[]
  activity30: PersonaActivityRow[]
  /** 30일 Persona 공개 글의 게시판별 수 */
  boards30: Record<string, number>
  nameSets: NameCollisionSets
  cadences: Cadence[]
}

const DAY_MS = 86_400_000

export async function readExpansionFacts(prisma: Reader, opts: { now: Date; repoRoot: string }): Promise<ExpansionFacts> {
  const reserve = await readPersonaReserve(prismaReserveRepo(prisma, opts))
  const personas = await prisma.persona.findMany({
    select: { id: true, code: true, status: true, dailyCap: true, weeklyCap: true, silenceRate: true, activityRhythm: true },
    orderBy: { code: 'asc' },
  })
  const codeOf = new Map(personas.map((p) => [p.id, p.code]))

  const windowRows = async (days: number): Promise<PersonaActivityRow[]> => {
    const since = new Date(opts.now.getTime() - days * DAY_MS)
    const posts = await prisma.post.groupBy({
      by: ['personaId'],
      where: { status: 'PUBLISHED', personaId: { not: null }, createdAt: { gte: since } },
      _count: { _all: true },
    })
    const comments = await prisma.comment.groupBy({
      by: ['personaId'],
      where: { isDeleted: false, personaId: { not: null }, createdAt: { gte: since } },
      _count: { _all: true },
    })
    const rows = new Map<string, PersonaActivityRow>()
    // 🔴 운영 active 만 분모다 — 멈춘 사람을 0 으로 세면 "쓰이지 않는다" 가 부풀려진다
    for (const p of personas) if (p.status === 'active') rows.set(p.code, { code: p.code, posts: 0, comments: 0 })
    for (const g of posts) {
      const code = g.personaId === null ? undefined : codeOf.get(g.personaId)
      const r = code === undefined ? undefined : rows.get(code)
      if (r !== undefined) r.posts = g._count._all
    }
    for (const g of comments) {
      const code = g.personaId === null ? undefined : codeOf.get(g.personaId)
      const r = code === undefined ? undefined : rows.get(code)
      if (r !== undefined) r.comments = g._count._all
    }
    return [...rows.values()]
  }

  const since30 = new Date(opts.now.getTime() - 30 * DAY_MS)
  const boards = await prisma.post.groupBy({
    by: ['boardType'],
    where: { status: 'PUBLISHED', personaId: { not: null }, createdAt: { gte: since30 } },
    _count: { _all: true },
  })

  const cadences: Cadence[] = personas
    .filter((r) => r.status === 'active' && r.dailyCap !== null && r.weeklyCap !== null && r.silenceRate !== null
      && r.activityRhythm !== null && typeof r.activityRhythm === 'object')
    .map((r) => ({
      dailyCap: r.dailyCap!, weeklyCap: r.weeklyCap!, silenceRate: Number(r.silenceRate),
      activityRhythm: r.activityRhythm as Cadence['activityRhythm'],
    }))

  return {
    reserve,
    dbCodes: personas.map((p) => p.code),
    statusOf: Object.fromEntries(personas.map((p) => [p.code, String(p.status)])),
    activity7: await windowRows(7),
    activity30: await windowRows(30),
    boards30: Object.fromEntries(boards.map((b) => [String(b.boardType), b._count._all])),
    nameSets: await loadNameCollisionSets(prisma),
    cadences,
  }
}
