/**
 * D100 통합 계기판의 **운영 DB 연결** — 🔴 read-only.
 *
 * 🔴 **write 0 · Raw SQL 0.** `findMany`/`count` 만 쓴다.
 * 🔴 **하드코딩 0.** 이 파일이 빠지면 계기판은 숫자를 못 내고 `readFailed` 가 된다 —
 *    0 으로 내려가지 않는다. "재고가 없다" 와 "못 읽었다" 는 다른 사실이다.
 * 🔴 판정 규칙은 여기 없다. 전부 `readStockFunnel` 이 정본 함수로 한다.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { PrismaClient } from '@prisma/client'
import { loadEnvLocal } from './micro-seed-time.mjs'
import { safetyFilter } from './micro-seed-safety-filter.mjs'
import { readStockFunnel, type StockRepo, type QueueRowFacts } from './d100-stock-reader.mjs'
// 🔴 재고와 **같은 판정 함수**를 쓴다 — 여기서 규칙을 다시 적으면 두 숫자가 갈라진다
import { profileOf, machineReviewedByHuman } from '../../src/lib/original-post-auto-publish'
import { MACHINE_AGE_HUMAN_REVIEW_REQUIRED } from '../../src/lib/micro-seed-auto-draft'
import type { QueuePostLink, LinkSummary, Measured, StockFunnel } from '../../src/lib/d100-readiness'
import { summarizeLinks } from '../../src/lib/d100-readiness'

/** 🔴 처리량을 보는 창 — 하루치 튀는 값으로 판정하지 않는다 */
export const THROUGHPUT_WINDOW_DAYS = 14

export type OperationalStock =
  | {
      ok: true
      funnel: StockFunnel
      links: LinkSummary
      activePersonas: number
      /** 🔴 관측된 하루 평균 상세 수집량. 창 안에 아무 것도 없으면 `null` 이다 */
      detailPerDay: Measured
      /** 🔴 관측된 하루 평균 READY 순증가 */
      readyNetPerDay: Measured
      observedDays: number
    }
  | { ok: false; detail: string }

/** 🔴 진짜 Prisma 를 `StockRepo` 모양으로 감싼다 — 판정은 하지 않는다 */
export function prismaStockRepo(prisma: PrismaClient): StockRepo {
  return {
    queueRows: async (): Promise<readonly QueueRowFacts[]> => {
      const raw = await prisma.originalPostApprovalQueue.findMany({
        select: {
          id: true, status: true, createdPostId: true, gateVerdict: true,
          promptVersion: true, model: true, matchedPersonaId: true,
          draftTitle: true, draftBody: true, editedTitle: true, editedBody: true,
          gateResults: true, decidedBy: true, decidedAt: true, createdAt: true,
          rawContent: { select: { sourceSite: true, sourceCapturedAt: true, rawTitle: true, rawBody: true } },
        },
        orderBy: { createdAt: 'asc' },
      })
      return raw.map((r) => ({
        id: r.id, status: r.status, createdPostId: r.createdPostId, gateVerdict: r.gateVerdict,
        promptVersion: r.promptVersion, model: r.model, matchedPersonaId: r.matchedPersonaId,
        gateResults: r.gateResults,
        // 🔴 발행될 글은 수정본이 있으면 수정본이다 — 발행기와 같은 규칙이다
        title: r.editedTitle ?? r.draftTitle,
        body: r.editedBody ?? r.draftBody,
        draftTitle: r.draftTitle,
        editedTitle: r.editedTitle,
        sourceSite: r.rawContent.sourceSite,
        decidedBy: r.decidedBy, decidedAt: r.decidedAt, createdAt: r.createdAt,
        // 🔴 신선도는 **원문**으로 본다. 우리 초안 문안으로 보면 주제가 바뀐다
        sourceCapturedAt: r.rawContent.sourceCapturedAt,
        freshTitle: r.rawContent.rawTitle,
        freshBody: r.rawContent.rawBody,
      }))
    },

    publishedLinks: async (): Promise<readonly QueuePostLink[]> => {
      const linked = await prisma.originalPostApprovalQueue.findMany({
        where: { NOT: { createdPostId: null } },
        select: { id: true, createdPostId: true },
      })
      const ids = linked.map((l) => l.createdPostId).filter((v): v is string => v !== null && v !== '')
      // 🔴 가리키는 Post 가 **없을 수도 있다** — 없다는 사실이 이 조사의 목적이다
      const posts = ids.length === 0 ? [] : await prisma.post.findMany({
        where: { id: { in: ids } },
        select: { id: true, status: true },
      })
      const statusOf = new Map(posts.map((p) => [p.id, String(p.status)]))
      return linked.map((l) => ({
        queueId: l.id,
        createdPostId: l.createdPostId,
        postStatus: l.createdPostId === null ? null : statusOf.get(l.createdPostId) ?? null,
      }))
    },

    activePersonas: async (): Promise<number> =>
      prisma.persona.count({ where: { status: 'active' } }),
  }
}

/**
 * 🔴 **한 번만 읽는다.** 두 번 읽으면 그 사이에 행이 바뀌어 재고와 생산량이
 *    서로 다른 시점을 가리킬 수 있다 — 같은 화면의 두 숫자가 어긋나는 가장 흔한 길이다.
 */
function memoRepo(inner: StockRepo): StockRepo {
  let rows: Promise<readonly QueueRowFacts[]> | null = null
  let links: Promise<readonly QueuePostLink[]> | null = null
  return {
    queueRows: () => (rows ??= inner.queueRows()),
    publishedLinks: () => (links ??= inner.publishedLinks()),
    activePersonas: inner.activePersonas,
  }
}

/** 🔴 창 안에서 관측된 하루 평균 — 0건이면 0 이 아니라 `null`(unmeasured) 이다 */
function perDay(count: number, days: number): Measured {
  if (days <= 0) return null
  if (count === 0) return null
  return Math.round((count / days) * 10) / 10
}

/**
 * 🔴 **운영 DB 를 한 번 읽어 계기판 입력을 만든다.**
 *    어느 단계에서 실패하든 `{ ok:false }` 다 — 부분 성공을 숫자로 내지 않는다.
 */
/**
 * 🔴 **접속 주소만 채운다.** 이 명령은 어느 worktree 에서도 돌 수 있어야 하는데,
 *    `.env.local` 은 배포된 runtime 에만 있다. 운영 env 는 이미 이 명령이 스위치를
 *    읽으려고 여는 바로 그 파일이다 — 같은 파일에서 접속 주소 두 개만 더 읽는다.
 *
 * 🔴 **값을 찍지 않는다.** 이 파일에는 API key 가 함께 산다 —
 *    읽는 키를 두 개로 못 박고, 어디에도 출력하지 않는다.
 * 🔴 **덮어쓰지 않는다.** 이미 설정돼 있으면 그대로 둔다.
 */
const CONNECTION_KEYS = ['DATABASE_URL', 'DIRECT_URL'] as const

function fillConnectionFromAppSupport(): void {
  if (CONNECTION_KEYS.every((k) => (process.env[k] ?? '') !== '')) return
  const f = join(homedir(), 'Library', 'Application Support', 'soransoran', 'env.local')
  if (!existsSync(f)) return
  for (const line of readFileSync(f, 'utf-8').split('\n')) {
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (!(CONNECTION_KEYS as readonly string[]).includes(key)) continue
    if ((process.env[key] ?? '') !== '') continue
    process.env[key] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  }
}

export async function readOperationalStock(now: Date = new Date()): Promise<OperationalStock> {
  await loadEnvLocal()
  fillConnectionFromAppSupport()
  if ((process.env.DATABASE_URL ?? '') === '') {
    // 🔴 주소가 없으면 0 이 아니라 못 읽은 것이다
    return { ok: false, detail: 'DATABASE_URL 이 없다 — 운영 env 를 찾지 못했다' }
  }
  const prisma = new PrismaClient()
  try {
    // 🔴 같은 질의를 두 번 던지지 않는다 — 재고와 생산량이 **같은 행 집합**을 봐야 한다
    const repo = memoRepo(prismaStockRepo(prisma))
    const read = await readStockFunnel({
      repo, now,
      safetyOf: (t, b) => safetyFilter({ title: t, body: b }).verdict,
    })
    if (!read.ok) return { ok: false, detail: read.detail }

    const links = summarizeLinks(await repo.publishedLinks())
    const activePersonas = await repo.activePersonas()

    const since = new Date(now.getTime() - THROUGHPUT_WINDOW_DAYS * 86_400_000)
    const detailCount = await prisma.microSeedRawContent.count({
      where: { createdAt: { gte: since } },
    })
    /**
     * 🔴 **READY 순증가는 "승인 건수" 가 아니다** (2026-09-21 실측 보정).
     *
     *    처음에는 `status IN (APPROVED,EDITED) AND decidedAt >= since` 를 셌다.
     *    실측 결과 14일 216건(15.4/day)이 나왔는데, **같은 순간 재고는 3건**이었다.
     *    그 216건은 거의 전부 profile 이 맞지 않는 legacy 행이다 — 발행 경로에
     *    **한 건도 들어갈 수 없는 것**을 "하루 15건씩 쌓인다" 로 읽고 있었다.
     *
     *    그래서 재고를 셀 때와 **같은 정본 selector** 로 다시 센다: legacy 를 빼고,
     *    기계 글이면 사람 확인까지 본다. 발행된 것도 포함한다 — 만들어졌다가 나간 것은
     *    **만들어진 것**이다(그래서 "순증가" 가 아니라 "생산량" 에 가깝다는 사실도 적어 둔다).
     */
    const produced = (await repo.queueRows()).filter((r) => {
      const at = r.decidedAt ?? r.createdAt
      if (at < since) return false
      if (r.status !== 'APPROVED' && r.status !== 'EDITED' && r.status !== 'PUBLISHED') return false
      if (profileOf(r) === null) return false
      return !(MACHINE_AGE_HUMAN_REVIEW_REQUIRED && profileOf(r) === 'machine')
        || machineReviewedByHuman(r.decidedBy)
    })
    const readyCount = produced.length

    return {
      ok: true,
      funnel: read.funnel,
      links,
      activePersonas,
      detailPerDay: perDay(detailCount, THROUGHPUT_WINDOW_DAYS),
      readyNetPerDay: perDay(readyCount, THROUGHPUT_WINDOW_DAYS),
      observedDays: THROUGHPUT_WINDOW_DAYS,
    }
  } catch (e) {
    // 🔴 fail-closed — 읽지 못했으면 0 이 아니다
    return { ok: false, detail: e instanceof Error ? e.message : '알 수 없음' }
  } finally {
    await prisma.$disconnect()
  }
}
