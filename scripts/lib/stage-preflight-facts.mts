/**
 * 🔴 **다음 단계 preflight 사실 모으기 — read-only. DB 읽기 · 장부 · 공급 산출 파일 · 정본 env 키 읽기만**
 *    (2026-09-29 · 2026-09-30 source-slot-v1 — D3~D100 한 판정의 입력)
 *
 * 🔴 **모르면 `null`** — 판정(`judgeNextPreflight`)이 UNKNOWN 으로 만든다. 모르는 것을 0 이나 기본값으로 메우지 않는다.
 *
 *   · 러너 격자      정본 템플릿 상수(heartbeat 10분 · 회차당 1건 · 댓글 예약표 · 첫 댓글 3회 시도)
 *   · 기회          다음 증명일 **전체 슬롯**을 정본 `judgeSlotRelease` 로 그 슬롯 시각에 판정해 짝지은 수
 *                   — 자동 READY(러너와 같은 열림 판정) + 아직 초안이 없는 원천 기회(공급 스냅샷 × 측정 수율)
 *   · 처리량 · 수율  최근 3일 자동 READY 수 ÷ 그 3일 공급 묶음 원천 수(회차 파일)
 *   · 지연          최근 3일 지금 계약 도장(`source-slot-v1`)으로 나간 글의 원천 게시 → 공개 p50 · p90
 *   · Persona       🔴 **계약 유효 수는 Persona 레인이 제공한다** — 이 파일은 주입 인터페이스(`contractValidPersonas`)만 둔다.
 *                   제공자가 없으면 `null`(UNKNOWN). 🔴 활성 행 수로 대체하지 않는다(정본: active rows are not capacity).
 *   · 단가          최근 3일(증거일 포함) 장부 정산 평균 — 댓글 1건 · 감사 1건 · 자동 READY 1건당 공급 (PR3 KEEP)
 *   · 상한          공급은 env 값을 승인 천장($0.50)으로 누른 것 · 댓글 · 감사는 각 레인 정본 env 판독기 값 그대로
 *                  (`commentLoopLimitsFromEnv` · `auditLimitsFromEnv` — 여기서 $0.20 · $0.30 을 따로 누르지 않는다)
 *   · 러너 건강      controller 가 이미 관측한 오류 신호(`errorSignalOf`)
 *
 * 🔴 **지운 입력** — `readyAutoStock`(지금 시각 기준 완성 글 수 · `STOCK_SHORT`) · `activePersonas`(활성 행 수) ·
 *    증거일 하루 단가(관측 없는 날 UNKNOWN) — 전부 이 파일에서 뺐다.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { PrismaClient } from '@prisma/client'

import type { LedgerEntry } from '../../src/lib/llm-ledger'
import type { PreflightFacts, RunnerGrid } from '../../src/lib/stage-ladder-generic'
import { PER_RUN_MAX } from '../../src/lib/publish-slot-catchup'
import {
  COMMENT_LOOP_RUN_REQUEST_CAP_DEFAULT, COMMENT_LOOP_BUDGET_ENV, commentLoopLimitsFromEnv,
} from '../../src/lib/persona-comment-auto-lane'
import { AUTO_DECIDER, AUTO_READY_ENV } from '../../src/lib/auto-ready-v2'
import { AUDIT_BUDGET_ENV } from '../../src/lib/auto-ready-semantic-audit'
import { SUPPLY_DAILY_USD_APPROVED } from '../../src/lib/supply-schedule-contract'
import {
  judgeSlotRelease, matchOpportunitiesToSlots, readSourceEvidence, releaseStampStatusOf,
  type SlotOpportunity,
} from '../../src/lib/source-slot-release'
import { OPPORTUNITY_FILE_RE, WORKSET_FILE_RE, readOpportunitySnapshot } from '../../src/lib/supply-workset'
import type { Health } from '../../src/lib/ops-status'
import { HEARTBEAT_INTERVAL_MINUTES } from './original-post-runner-template'
import { COMMENT_RUNNER_SLOTS, FIRST_COMMENT_ATTEMPTS } from './persona-comment-runner-template'
import { defaultLedgerDir, ledgerPathOf, readLedgerDay } from './llm-ledger-store.mjs'
import { BUDGET_ENV, limitsFromEnv } from './supply-llm-call.mjs'
import { auditLedgerDir, auditLimitsFromEnv } from './auto-ready-semantic-provider.mjs'
import { commentLoopLedgerDir } from './persona-comment-loop.mjs'
import { readyOpportunitiesOf, type LoadedStock } from './publishable-stock.mjs'

/** 🔴 정본 러너 사실 — 템플릿 상수 그대로. 여기서 숫자를 다시 적지 않는다 */
export const RUNNER_GRID: RunnerGrid = {
  gridMinutes: HEARTBEAT_INTERVAL_MINUTES,
  perRunMax: PER_RUN_MAX,
  commentSlots: COMMENT_RUNNER_SLOTS,
  attempts: FIRST_COMMENT_ATTEMPTS,
  commentRunRequestCap: COMMENT_LOOP_RUN_REQUEST_CAP_DEFAULT,
}

/** 🔴 preflight 가 읽는 정본 env 키 — 이 목록 밖은 메모리에 올리지 않는다 */
export const PREFLIGHT_ENV_KEYS: readonly string[] = [
  AUTO_READY_ENV,
  BUDGET_ENV.dailyUsd, BUDGET_ENV.runRequestCap, BUDGET_ENV.headroomMultiplier,
  AUDIT_BUDGET_ENV.dailyUsd, AUDIT_BUDGET_ENV.runRequestCap, AUDIT_BUDGET_ENV.headroomMultiplier,
  ...Object.values(COMMENT_LOOP_BUDGET_ENV),
]

/**
 * 🔴 **정산 단가** — 장부의 정산된 유료 요청만 센다(countTokens · 차단 · 미정산 제외).
 *    정산 건이 없으면 `null`(모름). 🔴 예약액으로 추정하지 않는다.
 */
export function settledUnitUsd(entries: readonly LedgerEntry[] | null): number | null {
  if (entries === null) return null
  const settled = entries.filter((e) => e.stage !== 'countTokens' && e.status === 'settled' && e.settledUsd !== null)
  if (settled.length === 0) return null
  const usd = settled.reduce((n, e) => n + (e.settledUsd ?? 0), 0)
  return usd > 0 ? usd / settled.length : null
}

/** 🔴 정산 합계 — 공급 건당 비용의 분자. 못 읽었으면 `null` */
export function settledTotalUsd(entries: readonly LedgerEntry[] | null): number | null {
  if (entries === null) return null
  return entries.filter((e) => e.stage !== 'countTokens' && e.status === 'settled' && e.settledUsd !== null)
    .reduce((n, e) => n + (e.settledUsd ?? 0), 0)
}

/** 🔴 두 상한 중 낮은 쪽 — 하나라도 모르면 모른다 */
export const cappedBy = (env: number | null, canon: number | null): number | null =>
  env === null || canon === null ? null : Math.min(env, canon)

/**
 * 🔴 **단가 · 수율 · 지연을 모으는 날 수** — 증거일 포함 최근 3일(PR3 KEEP). 한 날이 비어도 나머지로 안다.
 *    🔴 예약액으로 추정하지 않는다 — 정산된 것만 모은다.
 */
export const UNIT_COST_DAYS = 3

/** 🔴 증거일부터 거슬러 `n` 일(오래된 날 먼저) */
export function recentDates(evidenceDate: string, n: number = UNIT_COST_DAYS): string[] {
  const t = Date.parse(`${evidenceDate}T00:00:00Z`)
  return Array.from({ length: n }, (_, i) => new Date(t - (n - 1 - i) * 864e5).toISOString().slice(0, 10))
}

/** 🔴 여러 날 장부를 한 줄로 — 못 읽은 날은 빼고, 전부 못 읽었으면 `null`(모름) */
export function pooledEntries(days: readonly (readonly LedgerEntry[] | null)[]): LedgerEntry[] | null {
  const read = days.filter((d): d is readonly LedgerEntry[] => d !== null)
  return read.length === 0 ? null : read.flat()
}

const readDay = (dir: string, date: string): LedgerEntry[] | null => {
  const r = readLedgerDay(ledgerPathOf(dir, date))
  return r.ok ? r.entries : null
}

const kstRange = (date: string): { gte: Date; lt: Date } => {
  const gte = new Date(`${date}T00:00:00+09:00`)
  return { gte, lt: new Date(gte.getTime() + 864e5) }
}

/** 🔴 백분위(최근접 순위) — 표본이 없으면 null. 보고용 수치이지 가중치가 아니다 */
export function quantileOf(xs: readonly number[], q: number): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))
  return Math.round(s[i]! * 100) / 100
}

/** 🔴 공급 회차 파일 이름의 회차 시각(UTC) — `YYYYMMDD-HHMMSS` */
const runMsOf = (runId: string): number | null => {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(runId)
  if (m === null) return null
  const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`)
  return Number.isFinite(ms) ? ms : null
}

/**
 * 🔴 **수율 — 원천 1건당 자동 READY** = 창 안 자동 READY 도장 수 ÷ 창 안 공급 묶음 원천 수.
 *    묶음 파일이 하나도 없으면 모른다(null). 0 원천이면 모른다.
 */
export function yieldOf(input: { readyCount: number; worksetSources: number | null }): number | null {
  if (input.worksetSources === null || input.worksetSources <= 0) return null
  return Math.round((input.readyCount / input.worksetSources) * 1000) / 1000
}

/** 🔴 창 안 공급 묶음의 원천 수 — 파일을 못 읽으면 그 파일만 건너뛴다 · 하나도 없으면 null */
export function worksetSourcesIn(dataDir: string, fromMs: number, toMs: number): number | null {
  if (!existsSync(dataDir)) return null
  let n = 0
  let files = 0
  for (const f of readdirSync(dataDir)) {
    const m = WORKSET_FILE_RE.exec(f)
    if (m === null) continue
    const at = runMsOf(m[1]!)
    if (at === null || at < fromMs || at >= toMs) continue
    try {
      const j = JSON.parse(readFileSync(join(dataDir, f), 'utf-8')) as { sourceIds?: unknown }
      if (Array.isArray(j.sourceIds)) { n += j.sourceIds.length; files += 1 }
    } catch { /* 못 읽는 파일은 표본에서 뺀다 */ }
  }
  return files === 0 ? null : n
}

/**
 * 🔴 **가장 최근 공급 기회 스냅샷** — 초안이 아직 없는 slot-valid 원천(생성 전 판정 eligible)의 증거 기록.
 *    없으면 빈 목록(기회 0 — 모름이 아니다: 공급이 아직 안 돌았으면 READY 로만 센다).
 */
export function latestOpportunities(dataDir: string, nowMs: number): { evidence: unknown[]; takenAt: string | null } {
  if (!existsSync(dataDir)) return { evidence: [], takenAt: null }
  const files = readdirSync(dataDir).filter((f) => OPPORTUNITY_FILE_RE.test(f)).sort()
  for (const f of files.reverse()) {
    try {
      const snap = readOpportunitySnapshot(JSON.parse(readFileSync(join(dataDir, f), 'utf-8')))
      if (snap === null || Date.parse(snap.takenAt) > nowMs) continue
      return { evidence: snap.evidence, takenAt: snap.takenAt }
    } catch { /* 다음 파일 */ }
  }
  return { evidence: [], takenAt: null }
}

/**
 * 🔴 **증명일 기회 수** — 순수. READY 기회를 먼저 짝짓고, 남은 슬롯을 원천 기회로 채운 뒤 **측정 수율로 할인**한다.
 *    원천 기회는 초안 전이라 참여 동력 · 배정이 아직 없다(`pending`) — 같은 정본 판정의 생성 전 모드다.
 *    수율을 모르면 원천 기회는 세지 않는다(READY 만 — 과대평가 금지).
 */
export function slotValidOpportunitiesOf(input: {
  slots: readonly Date[]
  ready: readonly SlotOpportunity[]
  sources: readonly SlotOpportunity[]
  readyPerSource: number | null
}): { total: number; readyFilled: number; sourceFilled: number } {
  const r = matchOpportunitiesToSlots(input.slots, input.ready)
  const open = input.slots.filter((_, i) => r.bySlot[i] === null)
  const s = matchOpportunitiesToSlots(open, input.sources)
  const expected = input.readyPerSource === null ? 0 : Math.floor(s.filled * input.readyPerSource)
  return { total: Math.min(input.slots.length, r.filled + expected), readyFilled: r.filled, sourceFilled: s.filled }
}

/**
 * 🔴 **preflight 사실을 모은다.** `evidenceDate` 는 전날(증거일) — 단가 · 수율 · 지연은 그날까지 최근 3일.
 *    어느 하나를 못 읽으면 그 칸만 `null` 이다(나머지는 계속 모은다).
 */
export async function readPreflightFacts(prisma: PrismaClient, i: {
  /** controller 가 이미 읽은 재고 — 🔴 러너와 같은 열림 판정(`autoOpen`)으로 읽은 것이어야 한다 */
  loaded: LoadedStock
  autoOpen: { open: boolean; reasons: readonly string[] }
  /** 🔴 다음 증명일 전체 슬롯(UTC) — 그 단계 프로필의 그날 슬롯 */
  proofSlots: readonly Date[]
  /** 🔴 그 단계의 Persona 상한(`releaseCapsOf(profileOf(stage))`) */
  caps: { postsPerWeek: number; minDaysBetween: number }
  evidenceDate: string
  env: Readonly<Record<string, string>>
  dataDir: string
  now: Date
  runnerHealth: Health | null
  /**
   * 🔴 **Persona 레인 주입 자리** — 계약 유효 Persona 수. 주지 않으면 `null`(모름 → UNKNOWN).
   *    🔴 활성 행 수를 넣지 않는다.
   */
  contractValidPersonas?: () => Promise<number | null>
}): Promise<{ facts: PreflightFacts; notes: string[]; detail: Record<string, unknown> }> {
  const notes: string[] = []
  const dates = recentDates(i.evidenceDate)
  const windowFrom = kstRange(dates[0] ?? i.evidenceDate).gte
  const windowTo = kstRange(i.evidenceDate).lt
  const pooled = (dir: string): LedgerEntry[] | null => pooledEntries(dates.map((d) => readDay(dir, d)))

  // 수율
  let readyCount: number | null = null
  try {
    readyCount = await prisma.originalPostApprovalQueue.count({
      where: { decidedBy: AUTO_DECIDER, decidedAt: { gte: windowFrom, lt: windowTo } },
    })
  } catch (e) { notes.push(`자동 READY 수를 읽지 못했다 — ${(e as Error).name}`) }
  const worksetSources = worksetSourcesIn(i.dataDir, windowFrom.getTime(), windowTo.getTime())
  const readyPerSource = readyCount === null ? null : yieldOf({ readyCount, worksetSources })
  if (readyPerSource === null) notes.push('수율을 모른다 — 창 안 공급 묶음 또는 READY 기록 없음')

  // 기회 — READY(자동 · 열림) + 원천 스냅샷
  const readyOpps = i.autoOpen.open
    ? readyOpportunitiesOf(i.loaded, { caps: i.caps, now: i.now, autoOnly: true }) : []
  if (!i.autoOpen.open) notes.push(`자동 READY 닫힘 — ${i.autoOpen.reasons.join(' · ') || '이유 없음'} (READY 기회 0)`)
  const snap = latestOpportunities(i.dataDir, i.now.getTime())
  const queuedHashes = new Set(i.loaded.allRows.map((r) => {
    const ev = readSourceEvidence(r.gateResults)
    return ev.ok ? ev.record.provenance.articleIdHash : null
  }).filter((h): h is string => h !== null))
  const sourceOpps: SlotOpportunity[] = []
  for (const [k, ev] of snap.evidence.entries()) {
    const read = readSourceEvidence({ sourceEvidence: ev })
    if (!read.ok) continue
    const h = read.record.provenance.articleIdHash
    if (h !== null && queuedHashes.has(h)) continue
    sourceOpps.push({
      key: `src:${h ?? k}`,
      validAt: (slotAt) => judgeSlotRelease({
        evidence: ev, slotAt, now: i.now, hardGates: { ok: true, codes: [] },
        assignment: 'pending', driver: 'pending', tieBreak: String(k),
      }).verdict === 'eligible',
    })
  }
  const opp = slotValidOpportunitiesOf({ slots: i.proofSlots, ready: readyOpps, sources: sourceOpps, readyPerSource })

  // 지연 — 지금 계약 도장으로 나간 글 · 원천 게시 → 공개
  let latencyP50H: number | null = null
  let latencyP90H: number | null = null
  try {
    const published = await prisma.originalPostApprovalQueue.findMany({
      where: { status: 'PUBLISHED', createdPost: { createdAt: { gte: windowFrom, lt: windowTo } } },
      select: { gateResults: true, createdPost: { select: { createdAt: true } } },
    })
    const lat: number[] = []
    for (const q of published) {
      if (releaseStampStatusOf(q.gateResults) !== 'STAMPED_ELIGIBLE' || q.createdPost === null) continue
      const ev = readSourceEvidence(q.gateResults)
      const posted = ev.ok && ev.record.postedAt !== null ? Date.parse(ev.record.postedAt) : Number.NaN
      if (!Number.isFinite(posted)) continue
      lat.push((q.createdPost.createdAt.getTime() - posted) / 3_600_000)
    }
    latencyP50H = quantileOf(lat, 0.5)
    latencyP90H = quantileOf(lat, 0.9)
    if (lat.length === 0) notes.push('지연 관측 없음 — 지금 계약 도장으로 나간 글이 창 안에 없다')
  } catch (e) { notes.push(`지연을 읽지 못했다 — ${(e as Error).name}`) }

  // Persona — 주입 자리(제공자 없으면 모름)
  let contractValidPersonas: number | null = null
  if (i.contractValidPersonas === undefined) notes.push('계약 유효 Persona 수 제공자가 없다(Persona 레인) — 모름')
  else {
    try { contractValidPersonas = await i.contractValidPersonas() } catch (e) {
      notes.push(`계약 유효 Persona 수를 읽지 못했다 — ${(e as Error).name}`)
    }
  }

  // 단가
  const commentUsdPerRequest = settledUnitUsd(pooled(commentLoopLedgerDir()))
  const auditUsdPerCall = settledUnitUsd(pooled(auditLedgerDir()))
  let supplyUsdPerReady: number | null = null
  const spent = settledTotalUsd(pooled(defaultLedgerDir()))
  if (readyCount !== null) supplyUsdPerReady = spent === null || readyCount === 0 || !(spent > 0) ? null : spent / readyCount

  const facts: PreflightFacts = {
    slotValidOpportunities: opp.total,
    readyPerSource,
    latencyP50H, latencyP90H,
    contractValidPersonas,
    commentUsdPerRequest,
    commentDailyUsdCap: commentLoopLimitsFromEnv(i.env).limits.dailyUsd,
    auditUsdPerCall,
    auditDailyUsdCap: auditLimitsFromEnv(i.env).dailyUsd,
    supplyUsdPerReady,
    supplyDailyUsdCap: cappedBy(limitsFromEnv(i.env).dailyUsd, SUPPLY_DAILY_USD_APPROVED),
    runnerHealth: i.runnerHealth,
  }
  return {
    facts, notes,
    detail: {
      readyFilled: opp.readyFilled, sourceFilled: opp.sourceFilled, sourceOpportunities: sourceOpps.length,
      opportunitySnapshotAt: snap.takenAt, readyCount, worksetSources,
    },
  }
}
