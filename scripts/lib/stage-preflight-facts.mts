/**
 * 🔴 **D20 이상 시험 preflight 사실 모으기 — read-only. DB 읽기 · 장부 파일 읽기 · 정본 env 키 읽기만** (2026-09-29)
 *
 * 🔴 controller(`stage-controller.mts`)가 D20 이상 시험 대상일 때만 부른다. d3~d10 시험은 이 사실을 보지 않는다.
 * 🔴 **모르면 `null`** — 판정(`judgeNextPreflight`)이 UNKNOWN 으로 만든다. 모르는 것을 0 이나 기본값으로 메우지 않는다.
 *
 *   · 러너 격자      정본 템플릿 상수(heartbeat 10분 · 회차당 1건 · 댓글 예약표 43회 · 첫 댓글 3회 시도)
 *   · 자동 READY 재고 자동 READY 가 **실제로 열린** 상태(`auditAwareGate`)의 발행 대상 중 자동 도장 행
 *   · Persona       활성 Persona 수(정본 `loadPublishableStock` 과 같은 표)
 *   · 단가          증거일(전날) 장부의 정산 단가 — 댓글 1건 · 감사 1건 · 자동 READY 1건당 공급
 *   · 상한          정본 env 값을 정본 천장으로 누른 것 — 댓글 ≤ $0.20 · 공급 ≤ $0.50 · 감사는 env 값
 */
import type { PrismaClient } from '@prisma/client'

import type { LedgerEntry } from '../../src/lib/llm-ledger'
import type { PreflightFacts, RunnerGrid } from '../../src/lib/stage-ladder-generic'
import { PER_RUN_MAX } from '../../src/lib/publish-slot-catchup'
import {
  COMMENT_LOOP_RUN_REQUEST_CAP_DEFAULT, COMMENT_LOOP_BUDGET_ENV, commentLoopLimitsFromEnv,
} from '../../src/lib/persona-comment-auto-lane'
import { AUTO_DECIDER, AUTO_READY_ENV } from '../../src/lib/auto-ready-v2'
import { AUDIT_BUDGET_ENV } from '../../src/lib/auto-ready-semantic-audit'
import { auditAwareGate } from '../../src/lib/auto-ready-audit-store'
import { SUPPLY_DAILY_USD_APPROVED } from '../../src/lib/supply-schedule-contract'
import { HEARTBEAT_INTERVAL_MINUTES } from './original-post-runner-template'
import { COMMENT_RUNNER_SLOTS, FIRST_COMMENT_ATTEMPTS } from './persona-comment-runner-template'
import { defaultLedgerDir, ledgerPathOf, readLedgerDay } from './llm-ledger-store.mjs'
import { BUDGET_ENV, limitsFromEnv } from './supply-llm-call.mjs'
import { auditLedgerDir, auditLimitsFromEnv } from './auto-ready-semantic-provider.mjs'
import { commentLoopLedgerDir } from './persona-comment-loop.mjs'
import { loadPublishableStock } from './publishable-stock.mjs'

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
 * 🔴 **정산 단가** — 그날 장부의 정산된 유료 요청만 센다(countTokens · 차단 · 미정산 제외).
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

const readDay = (dir: string, date: string): LedgerEntry[] | null => {
  const r = readLedgerDay(ledgerPathOf(dir, date))
  return r.ok ? r.entries : null
}

const kstRange = (date: string): { gte: Date; lt: Date } => {
  const gte = new Date(`${date}T00:00:00+09:00`)
  return { gte, lt: new Date(gte.getTime() + 864e5) }
}

/**
 * 🔴 **preflight 사실을 모은다.** `evidenceDate` 는 전날(증거일) — 단가를 그날 장부에서 읽는다.
 *    어느 하나를 못 읽으면 그 칸만 `null` 이다(나머지는 계속 모은다).
 */
export async function readPreflightFacts(prisma: PrismaClient, i: {
  now: Date; evidenceDate: string; env: Readonly<Record<string, string>>
}): Promise<{ facts: PreflightFacts; notes: string[] }> {
  const notes: string[] = []
  let readyAutoStock: number | null = null
  let activePersonas: number | null = null
  try {
    // 🔴 러너와 같은 열림 판정 — 닫혀 있으면 자동 READY 는 발행 대상이 아니다(재고 0 으로 센다)
    const gate = await auditAwareGate(prisma, i.env, i.now)
    const loaded = await loadPublishableStock(prisma, i.now, { autoReadyOpen: gate.open })
    readyAutoStock = gate.open ? loaded.targets.filter((t) => (t.decidedBy ?? '').trim() === AUTO_DECIDER).length : 0
    activePersonas = loaded.personas.length
    if (!gate.open) notes.push(`자동 READY 닫힘 — ${gate.reasons.join(' · ') || '이유 없음'}`)
  } catch (e) { notes.push(`재고·Persona 를 읽지 못했다 — ${(e as Error).name}`) }

  const commentUsdPerRequest = settledUnitUsd(readDay(commentLoopLedgerDir(), i.evidenceDate))
  const auditUsdPerCall = settledUnitUsd(readDay(auditLedgerDir(), i.evidenceDate))
  let supplyUsdPerReady: number | null = null
  try {
    const spent = settledTotalUsd(readDay(defaultLedgerDir(), i.evidenceDate))
    const made = await prisma.originalPostApprovalQueue.count({
      where: { decidedBy: AUTO_DECIDER, decidedAt: kstRange(i.evidenceDate) },
    })
    supplyUsdPerReady = spent === null || made === 0 || !(spent > 0) ? null : spent / made
  } catch (e) { notes.push(`공급 건당 비용을 읽지 못했다 — ${(e as Error).name}`) }

  const facts: PreflightFacts = {
    readyAutoStock,
    activePersonas,
    commentUsdPerRequest,
    commentDailyUsdCap: commentLoopLimitsFromEnv(i.env).limits.dailyUsd,
    auditUsdPerCall,
    auditDailyUsdCap: auditLimitsFromEnv(i.env).dailyUsd,
    supplyUsdPerReady,
    supplyDailyUsdCap: cappedBy(limitsFromEnv(i.env).dailyUsd, SUPPLY_DAILY_USD_APPROVED),
  }
  return { facts, notes }
}
