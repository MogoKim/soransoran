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
import { readRunRecords } from './collect-run-store.mjs'
import type { CollectRunRecord } from '../../src/lib/collect-run-record'
import { detailThroughput, DETAIL_SOURCES, type DetailThroughput } from './d100-detail-throughput.mjs'
import {
  readSnapshots, readyNetFromSnapshots, appendSnapshot, SNAPSHOT_PATH, type NetChange,
} from './d100-ready-snapshot.mjs'
import {
  readPersonaCandidates, missingAxisHistogram, type PersonaRow, type PersonaTierRepo,
} from './d100-persona-tiers.mjs'
import { forecastPublishing } from '../../src/lib/supply-capacity-forecast'
import { voiceInputOf, type AutoRow } from '../../src/lib/original-post-auto-publish'
import { personaTierReadiness, personaReadinessOk, type TierReadiness } from '../../src/lib/d100-persona-scale'
import type { QueueCandidate } from '../../src/lib/supply-candidates'
import type { PersonaForMatch } from '../../src/lib/original-post-persona-match'
import type { D100Stage } from '../../src/lib/d100-capacity'
import { resolveStage, RELEASE_ENV } from '../../src/lib/scale-profile'
import { ANCHOR_MIN_COMMENTS, bundlesForPersonas } from './persona-reference-store.mjs'
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
      /**
       * 🔴 **성공한 상세 수집 회차가 새로 만든 행 ÷ 창.**
       *    DB 행 수가 아니다 — 합성 후보가 섞이지 않는다.
       */
      detail: DetailThroughput
      detailPerDay: Measured
      /**
       * 🔴 **생산량.** 창 안에 만들어진 READY 후보 수다 —
       *    발행·만료로 빠진 몫을 빼지 않았으므로 **순증가가 아니다.**
       */
      /** 🔴 **새로 품질을 통과한 READY 생산량.** 여유율 20% 가 붙는 값이다 */
      readyQualifiedPerDay: Measured
      /** 🔴 **두 스냅샷 사이의 실제 재고 증감.** 생산량과 다른 값이다 */
      readyStockDelta: NetChange
      readyStockDeltaPerDay: Measured
      /** 🔴 관측된 하루 공개 발행 편수 */
      publishedPerDay: Measured
      /** 🔴 처리량을 본 **창**의 길이다 — "이 단계를 며칠 관측했다" 가 아니다 */
      throughputWindowDays: number
      /** 🔴 Persona 3계층 — 계기판이 이 값을 그대로 찍는다 */
      personaTiers: TierReadiness[]
      /** 🔴 어느 생활사 축이 몇 명에게서 비었는가 */
      personaMissingAxes: Record<string, number>
      personaReady: boolean
      /**
       * 🔴 **지금 실제로 예약된 양.** 발행 runner 가 내려가 있으면 0 이다 —
       *    예측값을 여기 적으면 "곧 3건 나간다" 로 읽히는데 아무것도 나가지 않는다.
       */
      actualScheduledIn7Days: Measured
      actualScheduledIn14Days: Measured
      /** 🔴 **runner 를 올렸다면** 나갈 수 있는 양 — 예측기가 낸 값 */
      forecastIfLoadedIn7Days: Measured
      forecastIfLoadedIn14Days: Measured
      /** 지금 발행 runner 가 돌 수 있는가 — 위 두 값을 가르는 사실 */
      publishRunnerLoaded: boolean
      /** 🔴 지금 단계에서 목표 발행량을 연속 달성한 날 수 */
      stableStreakDays: number
      /** 공급원별 최근 회차 성패 — `null` 이면 모른다 */
      collectFailing: Record<string, boolean | null>
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

/** 🔴 발행 시각 — 공개 발행 편수를 세는 유일한 근거 */
export async function publishedAtsOf(prisma: PrismaClient): Promise<Date[]> {
  const linked = await prisma.originalPostApprovalQueue.findMany({
    where: { NOT: { createdPostId: null } },
    select: { createdPostId: true },
  })
  const ids = linked.map((l) => l.createdPostId).filter((v): v is string => v !== null && v !== '')
  if (ids.length === 0) return []
  const posts = await prisma.post.findMany({
    where: { id: { in: ids } }, select: { createdAt: true },
  })
  return posts.map((p) => p.createdAt)
}

/**
 * 🔴 **Persona 원자료.** 여기서 판정하지 않는다 —
 *    무엇이 비었는지만 옮기고 3계층 판정은 정본 순수 함수가 한다.
 */
export function prismaPersonaRepo(prisma: PrismaClient, now: Date, repoRoot: string): PersonaTierRepo {
  return {
    personaRows: async (): Promise<readonly PersonaRow[]> => {
      const rows = await prisma.persona.findMany({
        select: {
          code: true, status: true, identity: true, ageBand: true, region: true,
          noGoTopics: true, noGoExpressions: true,
        },
        orderBy: { code: 'asc' },
      })
      // 🔴 오늘(KST) 경계 — 활동 상한은 하루 단위다
      const kstNow = new Date(now.getTime() + 9 * 3600_000)
      const dayStart = new Date(Date.UTC(
        kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate(),
      ) - 9 * 3600_000)

      const logs = await prisma.personaActivityLog.findMany({
        where: { createdAt: { gte: new Date(now.getTime() - 400 * 86_400_000) } },
        select: { createdAt: true, persona: { select: { code: true } } },
      })
      const todayBy = new Map<string, number>()
      const lastBy = new Map<string, Date>()
      for (const l of logs) {
        const code = l.persona.code
        if (l.createdAt >= dayStart) todayBy.set(code, (todayBy.get(code) ?? 0) + 1)
        const had = lastBy.get(code)
        if (had === undefined || l.createdAt > had) lastBy.set(code, l.createdAt)
      }

      /**
       * 🔴 **말투 근거는 정본 묶음이 정한다.** 여기서 다시 세지 않는다 —
       *    실제 생성이 쓰는 것과 다른 수를 세면 준비도가 생성과 어긋난다.
       */
      const voiceBy = new Map<string, number>()
      try {
        const b = bundlesForPersonas({ repoRoot, personaCodes: rows.map((r) => r.code) })
        for (const t of b.table) voiceBy.set(t.personaCode, t.anchorComments)
      } catch {
        // 🔴 자산을 못 열면 0 이다 — 말투 근거가 **없는** 것이 맞다(fail-closed)
      }

      return rows.map((r) => {
        const last = lastBy.get(r.code) ?? null
        return {
          code: r.code, status: String(r.status),
          identity: (r.identity ?? {}) as Record<string, unknown>,
          ageBand: r.ageBand, region: r.region,
          noGoTopics: r.noGoTopics, noGoExpressions: r.noGoExpressions,
          activityToday: todayBy.get(r.code) ?? 0,
          daysSinceActive: last === null ? null
            : Math.floor((now.getTime() - last.getTime()) / 86_400_000),
          voiceComments: voiceBy.get(r.code) ?? 0,
        }
      })
    },
  }
}

/**
 * 🔴 **예측기가 쓰는 사람 목록.** 관제(`supply-health`)와 **같은 필드**를 넘긴다 —
 *    하나라도 빠지면 배정이 통째로 막히거나(fail-closed) 반대로 전원 통과가 된다.
 */
export async function forecastPersonasOf(prisma: PrismaClient, now: Date): Promise<{
  personas: PersonaForMatch[]
  codeOfPersonaId: Map<string, string>
  /** 🔴 러너와 **같은 표**에서 읽는다 — `PersonaActivityLog(kind='post')` */
  history: { code: string; matchedAts: Date[] }[]
  /** 이 사람이 최근에 쓴 글 수 — 연속 노출 판정의 근거가 될 원자료 */
  postLogs: { code: string; at: Date }[]
}> {
  const rows = await prisma.persona.findMany({
    where: { status: 'active' },
    select: {
      id: true, code: true, status: true, identity: true, voiceCore: true, noGoTopics: true,
      user: { select: { providerId: true, _count: { select: { accounts: true } } } },
    },
  })
  const codeOfPersonaId = new Map(rows.map((r) => [r.id, r.code]))
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000)
  /**
   * 🔴 **발행 이력의 정본은 `PersonaActivityLog(kind='post')` 다.**
   *    러너(`original-post-auto-publish.mts` ③)가 읽는 바로 그 표다 —
   *    큐의 `matchedAt` 은 "배정했다" 이지 "발행했다" 가 아니다.
   */
  const postLogRows = await prisma.personaActivityLog.findMany({
    where: { kind: 'post' },
    select: { createdAt: true, persona: { select: { code: true } } },
  })
  const postLogs = postLogRows
    .filter((l) => l.persona !== null)
    .map((l) => ({ code: l.persona!.code, at: l.createdAt }))
  const history = rows.map((r) => ({
    code: r.code,
    matchedAts: postLogs.filter((l) => l.code === r.code).map((l) => l.at),
  }))
  const personas: PersonaForMatch[] = []
  for (const r of rows) {
    const id = (r.identity ?? {}) as Record<string, unknown>
    const vc = (r.voiceCore ?? {}) as Record<string, unknown>
    const past = await prisma.originalPostApprovalQueue.findMany({
      where: { matchedPersonaId: r.id, NOT: { matchedAt: null } },
      select: { matchedAt: true },
    })
    const ats = past.map((x) => x.matchedAt as Date)
    const last = ats.length === 0 ? null : ats.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b))
    personas.push({
      code: r.code, status: String(r.status), providerId: r.user?.providerId ?? null,
      accountCount: r.user?._count.accounts ?? null,
      ageBand: typeof id.ageBand === 'string' ? id.ageBand : null,
      maritalStatus: typeof id.maritalStatus === 'string' ? id.maritalStatus : null,
      childrenCount: typeof id.childrenCount === 'number' ? id.childrenCount : null,
      ...(Array.isArray(id.childrenAgeBands) ? { childrenAgeBands: id.childrenAgeBands as never } : {}),
      parentCare: typeof id.parentCare === 'string' ? id.parentCare : null,
      menopauseStatus: typeof id.menopauseStatus === 'string' ? id.menopauseStatus : null,
      workStatus: null, economicStatus: null, region: null,
      noGoTopics: r.noGoTopics,
      voiceLength: typeof vc.length === 'string' ? vc.length : null,
      postsThisWeek: ats.filter((d) => d.getTime() >= weekAgo.getTime()).length,
      daysSinceLastPost: last === null ? null
        : Math.floor((now.getTime() - last.getTime()) / 86_400_000),
    } as PersonaForMatch)
  }
  return { personas, codeOfPersonaId, history, postLogs }
}

/**
 * 🔴 **연속으로 몇 날 목표를 냈는가.** 고정 14일 상수를 없앤 자리다 —
 *    상수는 "14일 관측했다" 는 주장인데 아무도 재지 않았다.
 *
 * 🔴 **오늘은 세지 않는다.** 아직 끝나지 않은 날을 "목표 미달" 로 세면
 *    매일 아침 연속 기록이 0 으로 떨어진다.
 */
export function stableStreakDays(input: {
  publishedAts: readonly Date[]
  dailyTarget: number
  now: Date
  maxLookbackDays?: number
}): number {
  const kstDay = (d: Date): string => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10)
  const byDay = new Map<string, number>()
  for (const d of input.publishedAts) byDay.set(kstDay(d), (byDay.get(kstDay(d)) ?? 0) + 1)
  let streak = 0
  const look = input.maxLookbackDays ?? 120
  for (let i = 1; i <= look; i += 1) {
    const day = kstDay(new Date(input.now.getTime() - i * 86_400_000))
    if ((byDay.get(day) ?? 0) < input.dailyTarget) break
    streak += 1
  }
  return streak
}

/**
 * 🔴 **최근 회차가 정상이었는가** — `null` 은 모른다는 뜻이다.
 *    기록이 하나도 없으면 "정상" 이 아니라 **모른다**.
 */
export function latestRunFailing(records: readonly CollectRunRecord[]): boolean | null {
  const done = records.filter((r) => r.status === 'ok' || r.status === 'failed')
  if (done.length === 0) return null
  const last = done.reduce((a, b) => (a.startedAt >= b.startedAt ? a : b))
  return last.status === 'failed'
}

/**
 * 🔴 **예약 전망은 실제 예측기가 낸다** (2026-09-21 3차 보정).
 *
 *    앞판은 `scheduledIn7Days: 0, scheduledIn14Days: 0` 을 **직접 주입**했다.
 *    0 은 "한 건도 안 나간다" 라는 강한 주장인데, 아무도 계산하지 않았다.
 *    러너·관제와 같은 `forecastPublishing` 을 부른다 — 입력이 없으면 `null` 이다.
 */
export function forecastFromRows(input: {
  rows: readonly QueueRowFacts[]
  publishableIds: readonly string[]
  personas: readonly PersonaForMatch[]
  /** personaId → code. 🔴 못 찾으면 **모르는 코드**를 넘겨 예측이 fail-closed 로 멈추게 한다 */
  codeOfPersonaId: ReadonlyMap<string, string>
  /** 🔴 **공식 발행 러너와 같은 이력** — `PersonaActivityLog(kind='post')` */
  history: readonly { code: string; matchedAts: Date[] }[]
  dailyCap: number
  now: Date
}): { in7: Measured; in14: Measured } {
  // 🔴 사람이 없으면 배정이 성립하지 않는다 — 0 건이 아니라 **계산할 수 없다**
  if (input.personas.length === 0) return { in7: null, in14: null }
  const want = new Set(input.publishableIds)
  const queue: QueueCandidate[] = input.rows
    .filter((r) => want.has(r.id))
    .map((r, i) => ({
      queueId: r.id, title: r.title, body: r.body, gateVerdict: r.gateVerdict, createdAt: i,
      // 🔴 이미 배정된 사람이 정본이다. 모르면 예측이 fail-closed 로 멈춰야 한다
      assignedPersonaCode: r.matchedPersonaId === null ? null
        : (input.codeOfPersonaId.get(r.matchedPersonaId) ?? `__unknown:${r.matchedPersonaId}`),
      capturedAt: r.sourceCapturedAt,
      ...voiceInputOf(r as AutoRow),
    }))
  /**
   * 🔴 **빈 이력을 넘기지 않는다** (2026-09-21 4차 보정).
   *
   *    앞판은 `matchedAts: []` 를 넘겼다. 그러면 예측기는 **아무도 최근에 안 썼다**고 믿고
   *    주 상한·최소 간격을 한 번도 적용하지 않는다 — 그래서 7일 전망이 3/3 으로 꽉 찼다.
   *    실제 러너는 `PersonaActivityLog(kind='post')` 를 넘긴다. 같은 것을 넘긴다.
   */
  if (input.history.length !== input.personas.length) return { in7: null, in14: null }
  const f = forecastPublishing({
    queue, personas: input.personas, history: input.history,
    startAt: input.now, days: 14, dailyCap: input.dailyCap,
  })
  return { in7: f.in7, in14: f.in14 }
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

/**
 * 🔴 **정상 조회의 0 건은 `0/day` 다 — `unmeasured` 가 아니다** (2026-09-21 5차 보정).
 *
 *    앞판은 `count === 0` 이면 `null` 을 냈다. 그래서 **조회는 잘 됐는데 한 건도 없다**와
 *    **조회를 못 했다**가 같은 화면이 됐다. 둘은 할 일이 정반대다 —
 *    앞은 "만들어야 한다", 뒤는 "왜 못 읽는지 고쳐야 한다".
 *
 *    게다가 `unmeasured` 는 승격 판정에서 `blocking` 과 다르게 취급된다.
 *    생산이 진짜 0 인데 `unmeasured` 로 적으면 "아직 모른다" 로 보여, **0 이라는 사실이
 *    화면에서 사라진다.** 0 은 측정된 값이고, 목표에 미달하므로 막아야 한다.
 *
 * 🔴 창 길이가 0 이하일 때만 `null` 이다 — 그때는 나눌 수가 없다.
 */
export function perDayMeasured(count: number, days: number): Measured {
  if (days <= 0) return null
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

/**
 * 🔴 **운영 env 글에서 지금 단계를 읽는다** — 판정은 정본 `resolveStage` 가 한다.
 *
 * 🔴 **따로 함수로 뺀 이유**: 계기판 안에 인라인으로 두면 "그 값이 정말 env 에서 왔는가" 를
 *    fixture 가 물어볼 방법이 없다. 실제로 앞선 돌연변이 시험에서, `resolveStage` 를
 *    부르면서 결과만 `'d3'` 으로 덮어써도 검사가 통과했다.
 */
export function releaseStageFromEnvText(envText: string): ReturnType<typeof resolveStage> {
  const raw = new RegExp(`^${RELEASE_ENV}=(.*)$`, 'm').exec(envText)?.[1]?.trim()
  return resolveStage(raw, 'release')
}

export type StockReadOptions = {
  /** 승격 판정을 할 목표 단계 — Persona 3계층 목표 인원이 여기서 나온다 */
  targetStage: D100Stage
  /** 목표 단계의 하루 발행 상한 — 예측기에 넘긴다 */
  dailyCap: number
  /** 이 저장소 루트 — 말투 묶음 자산을 찾는 데 쓴다 */
  repoRoot: string
  /**
   * 🔴 **지금 재고를 스냅샷 장부에 적을 것인가.** 기본은 **적지 않는다** —
   *    계기판은 read-only 다. 시계열을 시작하려면 사람이 명시적으로 켠다.
   *    🔴 과거 시각으로 쓰는 길은 없다(`appendSnapshot` 은 지금 값만 받는다).
   */
  recordSnapshot?: boolean
  /**
   * 🔴 스냅샷을 적는 함수 — 기본은 정본 `appendSnapshot`.
   *    바꿔 끼울 수 있게 둔 이유는 하나뿐이다: **기록 실패가 정말 밖까지 전해지는지**
   *    시험하려면 일부러 실패하는 writer 를 넣어 봐야 한다.
   */
  appendSnapshotFn?: (readyStock: number, now: Date) => boolean
  /** 지금 단계의 하루 발행 목표 — 연속 달성 일수를 세는 기준 */
  currentDailyTarget: number
  /** 🔴 발행 runner 가 실제로 돌 수 있는가 — 예약량과 예측값을 가른다 */
  publishRunnerLoaded: boolean
}

/** 🔴 `--record-snapshot` 을 켰는데 기록에 실패한 경우 */
export class SnapshotWriteFailed extends Error {}

export async function readOperationalStock(
  now: Date, opts: StockReadOptions,
): Promise<OperationalStock> {
  await loadEnvLocal()
  fillConnectionFromAppSupport()
  if ((process.env.DATABASE_URL ?? '') === '') {
    // 🔴 주소가 없으면 0 이 아니라 못 읽은 것이다
    return { ok: false, detail: 'DATABASE_URL 이 없다 — 운영 env 를 찾지 못했다' }
  }
  const prisma = new PrismaClient()
  /**
   * 🔴 **기록은 try 밖에서 한다** (2026-09-21 5차 보정).
   *
   *    앞판은 `try` 안에서 `SnapshotWriteFailed` 를 던졌는데, 바로 아래 `catch (e)` 가
   *    그것을 **읽기 실패로 삼켜** `{ ok:false }` 로 바꿨다. 그래서 CLI 는 예외를 본 적이
   *    없고 종료코드는 0 이었다 — "적으라고 했는데 못 적었다" 가 어디에도 남지 않았다.
   */
  let snapshotToWrite: number | null = null
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

    /**
     * 🔴 **상세 수집량은 DB 행 수가 아니다** (2026-09-21 3차 보정).
     *
     *    앞판은 `microSeedRawContent.count({createdAt >= since})` 로 16.1/day 를 냈다.
     *    그 표에는 외부 원문을 열지 않고 만든 **합성 후보 행**이 함께 산다 —
     *    크롤러가 멎은 날에도 숫자가 오른다. 정본은 수집 회차 기록이다.
     */
    const detail = detailThroughput({
      windowDays: THROUGHPUT_WINDOW_DAYS, now,
      recordsOf: (src) => readRunRecords(src),
    })

    /**
     * 🔴 **생산량이다 — 순증가가 아니다.** 창 안에 만들어진 READY 후보 수다.
     *    같은 기간에 발행되거나 신선도가 지나 빠진 몫을 빼지 않았으므로
     *    이 값을 승격 입력으로 쓰면 재고가 줄어도 "잘 쌓이고 있다" 가 된다.
     *
     *    🔴 재고와 **같은 정본 selector** 로 센다 — legacy 를 빼고,
     *    기계 글이면 사람 확인까지 본다.
     */
    const rows = await repo.queueRows()
    const produced = rows.filter((r) => {
      const at = r.decidedAt ?? r.createdAt
      if (at < since) return false
      if (r.status !== 'APPROVED' && r.status !== 'EDITED' && r.status !== 'PUBLISHED') return false
      if (profileOf(r) === null) return false
      return !(MACHINE_AGE_HUMAN_REVIEW_REQUIRED && profileOf(r) === 'machine')
        || machineReviewedByHuman(r.decidedBy)
    })

    /**
     * 🔴 **순증가는 두 시점의 재고 차이뿐이다.** 스냅샷이 없으면 `unmeasured` —
     *    생산량으로 갈음하지 않는다.
     */
    const readyStockDelta = readyNetFromSnapshots({
      snapshots: readSnapshots(), nowStock: read.funnel.readyStock, now,
    })
    /**
     * 🔴 **기록 실패를 삼키지 않는다** (2026-09-21 4차 보정).
     *    앞판은 `appendSnapshot` 의 반환값을 버렸다 — 사람이 시계열을 시작한 줄 알았는데
     *    파일이 하나도 안 쌓이고, 며칠 뒤에도 순증가는 여전히 unmeasured 다.
     */
    if (opts.recordSnapshot === true) snapshotToWrite = read.funnel.readyStock

    // 🔴 공개 발행 편수 — Post 생성 시각으로만 센다. 연속 달성 일수도 여기서 나온다
    const publishedAts = await publishedAtsOf(prisma)
    const publishedInWindow = publishedAts.filter((d) => d >= since).length

    // ── Persona 3계층 — 🔴 active 수 하나로 준비 완료를 말하지 않는다 ──
    const personaRead = await readPersonaCandidates(
      prismaPersonaRepo(prisma, now, opts.repoRoot),
    )
    if (!personaRead.ok) return { ok: false, detail: `Persona 를 읽지 못했다 — ${personaRead.detail}` }
    const tiers = personaTierReadiness({
      stage: opts.targetStage, candidates: personaRead.candidates,
    })

    // ── 예약 전망 — 🔴 0 을 주입하지 않는다. 러너와 같은 예측기를 부른다 ──
    const {
      personas: personasForMatch, codeOfPersonaId, history,
    } = await forecastPersonasOf(prisma, now)
    const fc = forecastFromRows({
      rows, publishableIds: read.rows.sets.publishableNow,
      personas: personasForMatch, codeOfPersonaId, history, dailyCap: opts.dailyCap, now,
    })
    /**
     * 🔴 **예약된 양과 예측값은 다르다.** 발행 runner 가 내려가 있으면 실제로는
     *    한 건도 나가지 않는다 — 예측값을 "예약" 이라 적으면 멎은 레인이 초록으로 보인다.
     */
    const actual7 = opts.publishRunnerLoaded ? fc.in7 : 0
    const actual14 = opts.publishRunnerLoaded ? fc.in14 : 0
    const streak = stableStreakDays({
      publishedAts, dailyTarget: opts.currentDailyTarget, now,
    })
    const collectFailing: Record<string, boolean | null> = {}
    for (const src of DETAIL_SOURCES) collectFailing[src] = latestRunFailing(readRunRecords(src))

    return {
      ok: true,
      // 🔴 깔때기에는 **지금 실제로 예약된 양**을 적는다. 예측값이 아니다
      funnel: { ...read.funnel, scheduledIn7Days: actual7, scheduledIn14Days: actual14 },
      links,
      activePersonas,
      detail,
      detailPerDay: detail.perDay,
      readyQualifiedPerDay: perDayMeasured(produced.length, THROUGHPUT_WINDOW_DAYS),
      readyStockDelta,
      readyStockDeltaPerDay: readyStockDelta.measured ? readyStockDelta.perDay : null,
      publishedPerDay: perDayMeasured(publishedInWindow, THROUGHPUT_WINDOW_DAYS),
      throughputWindowDays: THROUGHPUT_WINDOW_DAYS,
      personaTiers: tiers,
      personaMissingAxes: missingAxisHistogram(personaRead.candidates),
      personaReady: personaReadinessOk(tiers),
      actualScheduledIn7Days: actual7,
      actualScheduledIn14Days: actual14,
      forecastIfLoadedIn7Days: fc.in7,
      forecastIfLoadedIn14Days: fc.in14,
      publishRunnerLoaded: opts.publishRunnerLoaded,
      stableStreakDays: streak,
      collectFailing,
    }
  } catch (e) {
    // 🔴 fail-closed — 읽지 못했으면 0 이 아니다. **다만 기록 실패는 삼키지 않는다**
    return readFailureOf(e)
  } finally {
    await prisma.$disconnect()
    // 🔴 읽기 catch 밖이다 — 기록 실패는 읽기 실패로 둔갑하지 않는다
    if (snapshotToWrite !== null) {
      const write = opts.appendSnapshotFn ?? appendSnapshot
      if (!write(snapshotToWrite, now)) {
        throw new SnapshotWriteFailed(`스냅샷을 적지 못했다 — ${SNAPSHOT_PATH}`)
      }
    }
  }
}

/**
 * 🔴 **읽기 실패로 삼켜도 되는 예외인가** (2026-09-21 5차 보정).
 *
 *    `SnapshotWriteFailed` 는 "읽지 못했다" 가 아니라 "적으라 했는데 못 적었다" 다.
 *    그것을 `{ ok:false }` 로 바꾸면 종료코드가 0 이 되고, 사람은 시계열을 시작한 줄 안다.
 *    🔴 기록을 try 밖으로 옮긴 것과 **이중**으로 막는다 — 누가 다시 안으로 옮겨도 여기서 통과한다.
 */
export function readFailureOf(e: unknown): OperationalStock {
  if (e instanceof SnapshotWriteFailed) throw e
  return { ok: false, detail: e instanceof Error ? e.message : '알 수 없음' }
}

export type ReadinessRun = {
  /** 🔴 CLI 가 그대로 쓰는 종료코드 */
  exitCode: number
  stock: OperationalStock
  /** 종료코드가 0 이 아닌 이유 */
  failure: string | null
}

/**
 * 🔴 **조립 경로를 한 곳에 둔다** (2026-09-21 5차 보정).
 *
 *    "읽고 → 필요하면 적고 → 종료코드를 정한다" 를 CLI 안에 인라인으로 두면,
 *    그 판단이 정말 도는지 fixture 가 물어볼 방법이 없다. 실제로 앞판에서는
 *    `throw` 와 `process.exit(1)` 이 **둘 다 코드에 있는데도** 예외가 중간에 삼켜져
 *    종료코드는 0 이었다 — 문자열 검사는 그것을 잡지 못했다.
 *
 * 🔴 **적으라고 했는데 못 적었으면 실패다.** 읽지 못해 적을 값이 없었던 경우도 같다 —
 *    사람은 "시계열을 시작했다" 고 믿고 돌아갈 것이기 때문이다.
 */
export async function runReadiness(deps: {
  read: () => Promise<OperationalStock>
  recordSnapshot: boolean
}): Promise<ReadinessRun> {
  let stock: OperationalStock
  try {
    stock = await deps.read()
  } catch (e) {
    if (e instanceof SnapshotWriteFailed) {
      return {
        exitCode: 1,
        stock: { ok: false, detail: e.message },
        failure: e.message,
      }
    }
    throw e
  }
  if (deps.recordSnapshot && !stock.ok) {
    return {
      exitCode: 1, stock,
      failure: `스냅샷을 적으라고 했는데 재고를 읽지 못했다 — ${stock.detail}`,
    }
  }
  return { exitCode: 0, stock, failure: null }
}
