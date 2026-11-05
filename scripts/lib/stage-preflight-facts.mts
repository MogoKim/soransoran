/**
 * 🔴 **다음 단계 preflight 사실 모으기 — read-only. DB 읽기 · 장부 · 공급 산출 파일 · 정본 env 키 읽기만**
 *    (2026-09-29 · 2026-09-30 source-slot-v1 — D3~D100 한 판정의 입력)
 *
 * 🔴 **모르면 `null`** — 판정(`judgeNextPreflight`)이 UNKNOWN 으로 만든다. 모르는 것을 0 이나 기본값으로 메우지 않는다.
 *
 *   · 러너 격자      정본 템플릿 상수(heartbeat 10분 · 회차당 1건 · 댓글 예약표 · 첫 댓글 3회 시도)
 *   · 기회          다음 증명일 **전체 슬롯**을 정본 `judgeSlotRelease` 로 그 슬롯 시각에 판정해 짝지은 수
 *                   — 자동 READY(러너와 같은 열림 판정) + 아직 초안이 없는 원천 기회(공급 스냅샷 × 측정 수율)
 *   · 처리량        최근 3일 자동 READY cohort 행 수 ÷ 그 3일 공급 묶음 원천 수(회차 파일)
 *   · 원천 수율      🔴 결말 기준(P0-2) — (공개 + 예정 슬롯에 걸린 대기) ÷ 원천 · 모르는 대기는 구간 상한에만
 *   · READY cohort  같은 3일 창에서 자동 READY 로 도장된 행 **전부**의 결말(공개 · 손실 EXPIRED·DECLINED · 대기)
 *                   + 같은 창 묶음 원천 수 + 같은 창 공급 정산액 — 처리량 · 필요 READY · 공급 단가가 이 한 묶음에서 나온다.
 *                   🔴 대기 행을 성공으로도 손실로도 확정하지 않는다 · 고정 20% 할증으로 대신하지 않는다
 *   · 지연          최근 3일 지금 계약 도장(`source-slot-v1`)으로 나간 글의 원천 게시 → 공개 p50 · p90
 *   · Persona       🔴 **계약 유효 수는 Persona 레인이 제공한다** — 이 파일은 주입 인터페이스(`contractValidPersonas`)만 둔다.
 *                   읽기 실패면 `null`(UNKNOWN). 🔴 활성 행 수로 대체하지 않는다(정본: active rows are not capacity).
 *   · 단가          최근 3일(증거일 포함) 장부 정산 평균 — 댓글 1건 · 감사 1건 · 자동 READY 1건당 공급 (PR3 KEEP)
 *   · 상한          공급은 env 값을 승인 천장($1.20)으로 누른 것 · 댓글 · 감사는 각 레인 정본 env 판독기 값 그대로
 *                  (`commentLoopLimitsFromEnv` · `auditLimitsFromEnv` — 댓글 기본 $0.20/천장 $0.50을 여기서 다시 누르지 않는다)
 *   · 러너 건강      controller 가 이미 관측한 오류 신호(`errorSignalOf`)
 *
 * 🔴 **지운 입력** — `readyAutoStock`(지금 시각 기준 완성 글 수 · `STOCK_SHORT`) · `activePersonas`(활성 행 수) ·
 *    증거일 하루 단가(관측 없는 날 UNKNOWN) — 전부 이 파일에서 뺐다.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { PrismaClient } from '@prisma/client'

import type { LedgerEntry } from '../../src/lib/llm-ledger'
import type { PreflightFacts, ReadyCohortFact, RunnerGrid } from '../../src/lib/stage-ladder-generic'
import {
  READY_LOSS_STATUSES, cohortFatesOf, costAttributionOf, pendingFateOf, terminalYieldOf,
  type CostAttribution, type CostFate, type FateCounts, type PendingFate,
} from '../../src/lib/ready-fate'
import { PER_RUN_MAX } from '../../src/lib/publish-slot-catchup'
import { kstDateString } from '../../src/lib/release-canary'
import {
  COMMENT_LOOP_RUN_REQUEST_CAP_DEFAULT, COMMENT_LOOP_BUDGET_ENV, commentLoopLimitsFromEnv,
} from '../../src/lib/persona-comment-auto-lane'
import { AUTO_DECIDER, AUTO_READY_ENV, eligibilityOf } from '../../src/lib/auto-ready-v2'
import { AUDIT_BUDGET_ENV } from '../../src/lib/auto-ready-semantic-audit'
import {
  SUPPLY_DAILY_USD_APPROVED, SUPPLY_PROOF_RUN_SLOTS_KST, SUPPLY_RUN_WINDOW_MS,
  supplyRunSlotMinuteOf,
} from '../../src/lib/supply-schedule-contract'
import { isNaturalScheduledRunTag, parseRunTokenShadowTag } from '../../src/lib/supply-run-token'
import { isSupplyCostRecoveryTagged } from '../../src/lib/supply-cost-envelope'
import {
  judgeSlotRelease, matchOpportunitiesToSlots, publishEventAtOf, readSourceEvidence, releaseStampStatusOf,
  type SlotOpportunity,
} from '../../src/lib/source-slot-release'
import {
  OPPORTUNITY_FILE_RE, OPPORTUNITY_VERSION, OPPORTUNITY_VERSIONS_LEGACY, WORKSET_FILE_RE,
  readOpportunitySnapshot, readSupplyIntent, readWorkset,
  type OpportunitySnapshot, type SupplyIntent,
} from '../../src/lib/supply-workset'
import { claimsJitContract, intentLinkIssue, type IntentLinkIssue } from '../../src/lib/supply-intent'
import { currentQualityContract } from '../../src/lib/quality-contract'
import type { Health } from '../../src/lib/ops-status'
import { HEARTBEAT_INTERVAL_MINUTES } from './original-post-runner-template'
import { COMMENT_RUNNER_SLOTS, FIRST_COMMENT_ATTEMPTS } from './persona-comment-runner-template'
import { defaultLedgerDir, ledgerPathOf, readLedgerDay } from './llm-ledger-store.mjs'
import { BUDGET_ENV, limitsFromEnv } from './supply-llm-call.mjs'
import { auditLedgerDir, auditLimitsFromEnv } from './auto-ready-semantic-provider.mjs'
import { commentLoopLedgerDir } from './persona-comment-loop.mjs'
import { readyOpportunitiesOf, type LoadedStock } from './publishable-stock.mjs'
import { readStageRecoverySourceHashes } from './stage-recovery-source-receipt.mjs'

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
 * 🔴 **단가 · 수율 · 지연을 모으는 날 수** — 증거일 포함 최근 3일(PR3 KEEP). 파일이 없는 날은 빈 날이다.
 *    🔴 예약액으로 추정하지 않는다 — 정산된 것만 모은다.
 */
export const UNIT_COST_DAYS = 3

type RecoveryReadyRow = {
  id: string
  createdAt?: Date
  gateResults?: unknown
}

/**
 * 정확한 복구 intent가 만든 slot-valid READY만 센다.
 * 날짜 전체 READY 증분이나 같은 시각의 자연 공급을 복구 성과로 섞지 않고,
 * 같은 원천이 중복 적재돼도 원천 하나로만 센다.
 */
export function slotValidRecoveryReadyStockOf(i: {
  rows: readonly RecoveryReadyRow[]
  matchedReady: ReadonlySet<string>
  sourceHashes: ReadonlySet<string>
  supplyRunId: string
  createdAt: Date
}): number {
  const recoveryReadyHashes = new Set<string>()
  for (const row of i.rows) {
    if (row.createdAt === undefined
      || !i.matchedReady.has(row.id)
      || row.createdAt.getTime() < i.createdAt.getTime()) continue
    const ev = readSourceEvidence(row.gateResults)
    const sourceHash = ev.ok ? ev.record.provenance.articleIdHash : null
    const intent = readSupplyIntent(row.gateResults)
    if (sourceHash !== null && i.sourceHashes.has(sourceHash)
      && intent !== null && intent.runId === i.supplyRunId && intent.sourceHash === sourceHash) {
      recoveryReadyHashes.add(sourceHash)
    }
  }
  return recoveryReadyHashes.size
}

/** 🔴 증거일부터 거슬러 `n` 일(오래된 날 먼저) */
export function recentDates(evidenceDate: string, n: number = UNIT_COST_DAYS): string[] {
  const t = Date.parse(`${evidenceDate}T00:00:00Z`)
  return Array.from({ length: n }, (_, i) => new Date(t - (n - 1 - i) * 864e5).toISOString().slice(0, 10))
}

/**
 * 🔴 **여러 날 장부를 한 줄로 — 하루라도 손상(못 읽음)이면 `null`(모름)** (2026-10-04 P0-2).
 *    앞판은 손상된 날을 조용히 빼고 남은 날로 평균을 냈다 — 손상된 날의 지출이 사라진 단가는 실제보다 싸다.
 *    파일이 없는 날은 손상이 아니다(`readLedgerDay` 가 빈 장부로 준다).
 */
export function pooledEntries(days: readonly (readonly LedgerEntry[] | null)[]): LedgerEntry[] | null {
  if (days.length === 0 || days.some((d) => d === null)) return null
  return (days as readonly (readonly LedgerEntry[])[]).flat()
}

const readDay = (dir: string, date: string): LedgerEntry[] | null => {
  const r = readLedgerDay(ledgerPathOf(dir, date))
  return r.ok ? r.entries : null
}

const kstRange = (date: string): { gte: Date; lt: Date } => {
  const gte = new Date(`${date}T00:00:00+09:00`)
  return { gte, lt: new Date(gte.getTime() + 864e5) }
}

/** 🔴 용량(cohort) 창 길이 — 롤링 72시간(= `UNIT_COST_DAYS` 일) */
export const CAPACITY_WINDOW_MS = UNIT_COST_DAYS * 864e5

/**
 * 🔴 **preflight 시계 둘 — 증명 창과 용량 창을 섞지 않는다** (2026-10-20 D10 preflight 시계 결함).
 *    앞판은 둘 다 `evidenceDate`(전날)에서 만들었다 — 용량 창 끝이 오늘 00:00 KST 에 멈춰 **오늘 아침 자연 공급
 *    (06:15 회차 · READY)이 07:00 판정에서 통째로 빠졌다**(readyRaw=0 · worksetSources=2 → 가짜 FAIL).
 *    · 증명(proof)    전날 KST 달력일 기준 최근 3일 — 지연 · 댓글/감사 단가. `[전날 00:00 − 2일, 오늘 00:00)` 고정.
 *                     🔴 오늘 데이터를 섞지 않는다 — 전날 증명은 전날이 끝난 뒤에 닫힌 값이다.
 *    · 용량(capacity) 판정 시각(`now`)에서 거슬러 정확히 72시간 `[now − 72h, now)` — READY cohort · 묶음 원천 · 공급 장부.
 *                     🔴 `now` 이후 사건은 들어오지 않는다(상한 배타). 장부 날짜는 창이 걸친 KST 날 전부 + 다음 날 파일.
 */
export function preflightWindowsOf(evidenceDate: string, now: Date): {
  proof: { dates: string[]; from: Date; to: Date }
  capacity: { dates: string[]; from: Date; to: Date; ledgerDates: string[] }
} {
  const proofDates = recentDates(evidenceDate)
  const proofFrom = kstRange(proofDates[0] ?? evidenceDate).gte
  const proofTo = kstRange(evidenceDate).lt
  const to = now
  const from = new Date(now.getTime() - CAPACITY_WINDOW_MS)
  // 창 `[from, to)` 의 마지막 순간은 `to − 1ms` — 정확히 KST 자정인 `now` 는 그날 파일을 포함하지 않는다
  const first = kstDateString(from)
  const last = kstDateString(new Date(to.getTime() - 1))
  const days: string[] = []
  for (let t = Date.parse(`${first}T00:00:00Z`); t <= Date.parse(`${last}T00:00:00Z`); t += 864e5) {
    days.push(new Date(t).toISOString().slice(0, 10))
  }
  const spill = new Date(Date.parse(`${last}T00:00:00Z`) + 864e5).toISOString().slice(0, 10)
  return {
    proof: { dates: proofDates, from: proofFrom, to: proofTo },
    capacity: { dates: days, from, to, ledgerDates: [...days, spill] },
  }
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

const KST_OFFSET_MS = 9 * 3_600_000
const kstWallClock = (ms: number): { date: string; minute: number } | null => {
  if (!Number.isFinite(ms)) return null
  const iso = new Date(ms + KST_OFFSET_MS).toISOString()
  return { date: iso.slice(0, 10), minute: Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16)) }
}

/** 공급 회차 id 의 KST 날짜와 proof 슬롯 — 창 밖 시작이면 슬롯 `null` */
const proofSlotOfRunId = (runId: string): { date: string; minute: number | null } | null => {
  const ms = runMsOf(runId)
  const wall = ms === null ? null : kstWallClock(ms)
  return wall === null ? null
    : { date: wall.date, minute: supplyRunSlotMinuteOf(wall.minute, SUPPLY_PROOF_RUN_SLOTS_KST, SUPPLY_RUN_WINDOW_MS) }
}

type NaturalRunSnapshot = {
  date: string; slot: number; startedAtMs: number; startMinute: number; evidence: readonly unknown[]; takenAt: string
}

/**
 * 🔴 **자연 예약 공급 회차 하나의 기회 snapshot — 기준선과 미래 표본이 같은 무결성 규칙을 쓴다** (2026-11-02 M2).
 *    · provenance 가 온전한 수동·사건·복구 회차 → `'not-natural'`(표본이 아니다 · 손상도 아니다)
 *    · 회차가 **끝났어야** 한다 — `done` 또는 `failed`. 🔴 `failed` 는 회차의 다른 단계가 실패했다는 뜻이다.
 *      snapshot · marker(`written` · runId · 관측 시각 · 건수 · reason 없음)가 온전하면 그 시각 inventory 로 쓴다.
 *      `running`·모르는 상태는 모름이다
 *    · runId(파일 이름) · `startedAt` · `completedAt`(시작 뒤 · `atMs` 이전) · `runtimeSha` · proof 슬롯 창이 맞아야 한다
 *    · snapshot 관측은 회차 시작 ~ `atMs` 사이
 *    하나라도 어긋나면 `null`(모름).
 */
function naturalRunSnapshotOf(dataDir: string, runId: string, atMs: number): NaturalRunSnapshot | 'not-natural' | null {
  try {
    const run = JSON.parse(readFileSync(join(dataDir, `supply-process-${runId}.run.json`), 'utf-8')) as Record<string, unknown>
    const shadow = parseRunTokenShadowTag(run.runTokenShadow)
    if (shadow === null) return null
    if (!isNaturalScheduledRunTag(shadow)) return 'not-natural'
    const file = proofSlotOfRunId(runId)
    const startedAtMs = typeof run.startedAt === 'string' ? Date.parse(run.startedAt) : Number.NaN
    const completedAtMs = typeof run.completedAt === 'string' ? Date.parse(run.completedAt) : Number.NaN
    const runWall = Number.isFinite(startedAtMs) ? kstWallClock(startedAtMs) : null
    const runSlot = runWall === null ? null
      : supplyRunSlotMinuteOf(runWall.minute, SUPPLY_PROOF_RUN_SLOTS_KST, SUPPLY_RUN_WINDOW_MS)
    if (run.runId !== runId || (run.status !== 'done' && run.status !== 'failed')
      || !Number.isFinite(completedAtMs) || completedAtMs < startedAtMs || completedAtMs > atMs
      || typeof run.runtimeSha !== 'string' || run.runtimeSha.trim() === ''
      || file === null || file.minute === null || runWall === null || runWall.date !== file.date || runSlot !== file.minute) return null
    const snapshot = readOpportunitySnapshot(JSON.parse(readFileSync(join(dataDir, `supply-opportunities-${runId}.json`), 'utf-8')))
    if (snapshot === null || snapshot.runId !== runId) return null
    const takenAtMs = Date.parse(snapshot.takenAt)
    if (!Number.isFinite(takenAtMs) || takenAtMs < startedAtMs || takenAtMs > atMs) return null
    const marker = run.opportunityInventory
    if (marker === null || typeof marker !== 'object' || Array.isArray(marker)) return null
    const m = marker as Record<string, unknown>
    if (m.status !== 'written' || m.runId !== runId || m.observedAt !== snapshot.takenAt
      || m.written !== snapshot.inventory.counts.written || m.reason !== null) return null
    return {
      date: file.date, slot: file.minute, startedAtMs, startMinute: runWall.minute,
      evidence: snapshot.evidence, takenAt: snapshot.takenAt,
    }
  } catch { return null }
}

/**
 * 🔴 **표본일 `date` 의 기준선 inventory — 판정 벽시계 `nowMinute` 직전에 창이 끝난 자연 proof 슬롯 하나** (2026-11-02).
 *    07:00 판정이면 06:15 슬롯(06:15 + 45분 = 07:00)이다. 그 슬롯의 자연 예약 회차가 남긴 snapshot 만 쓴다
 *    (`naturalRunSnapshotOf` — 미래 표본과 같은 무결성 규칙). 겹친 자연 회차가 여럿이면 마지막 회차다.
 *    🔴 그 슬롯에 자연 회차가 없거나(사건·수동·복구뿐 포함) 하나라도 손상·미완료면 `null`(모름) —
 *       전날 밤 회차 · 더 이른 슬롯 · 비자연 회차로 내려가지 않는다. 창이 끝난 슬롯이 없는 시각도 `null` 이다.
 */
function baselineEvidenceOf(dataDir: string, date: string, nowMinute: number): readonly unknown[] | null {
  const windowMinutes = SUPPLY_RUN_WINDOW_MS / 60_000
  const slot = SUPPLY_PROOF_RUN_SLOTS_KST.map((s) => s.hour * 60 + s.minute)
    .filter((minute) => minute + windowMinutes <= nowMinute).sort((a, b) => a - b).at(-1)
  if (slot === undefined) return null
  const atMs = Date.parse(`${date}T00:00:00+09:00`) + nowMinute * 60_000
  const natural: NaturalRunSnapshot[] = []
  for (const name of readdirSync(dataDir)) {
    const runId = /^supply-process-(\d{8}-\d{6})\.run\.json$/.exec(name)?.[1]
    const at = runId === undefined ? null : proofSlotOfRunId(runId)
    if (runId === undefined || at === null || at.date !== date || at.minute !== slot) continue
    const read = naturalRunSnapshotOf(dataDir, runId, atMs)
    if (read === null) return null
    if (read !== 'not-natural') natural.push(read)
  }
  return natural.sort((a, b) => a.startedAtMs - b.startedAtMs).at(-1)?.evidence ?? null
}

/**
 * 🔴 **당일 남은 정기 공급의 추가 기회 — 재고 수준이 아니라 새로 들어온 원천으로 센다.**
 *    설정상 `회차×20`·선행 재고 할당을 쓰지 않는다. 직전 3개 완결 KST 일자마다:
 *    ① 기준선 = 그날 `now` 벽시계 직전에 창이 끝난 자연 proof 슬롯(07:00 이면 06:15)의 inventory(`baselineEvidenceOf`)
 *       — 전날 밤·사건·수동·복구 회차로 대신하지 않는다
 *    ② 오늘 남은 proof 공급 슬롯과 **동일한 슬롯 창**의 자연 예약 회차가 기준선 뒤에 처음 관측한 고유 원천
 *       (`articleIdHash`)만 순유입이다. 같은 원천을 두 회차가 보면 먼저 본 회차 하나로 센다. 해시가 없으면 세지 않는다
 *    ③ 순유입 원천은 그 회차 시작 + 45분 뒤 발행 슬롯에서만, 그날 같은 벽시계 슬롯에서 `judgeSlotRelease` 가
 *       eligible 일 때만 쓸 수 있다(원천↔슬롯 유효성 · 도착 시각 보존)
 *    ④ 하루 추가분 = `futureAdditionalOf` — 합집합 겹침 상한과 순유입 자기 수율 상한 중 작은 값
 *    날짜별 추가 기회의 최솟값을 쓴다. 다른 날 원천을 오늘 원천과 대조하지 않는다.
 *    지연된 첫 예약 pass는 정본 45분 창으로 같은 슬롯에 붙인다. provenance가 완전한 예약 follow-up도 자연 표본이다.
 *    사건·복구·수동·기원 불명 follow-up은 표본이 아니다 — 세지 않을 뿐 용량을 만들지 않는다.
 *    🔴 자연 표본이 **없음이 증명된** 슬롯(창 안에 기회 파일이 없고, 회차 기록도 없거나 snapshot 을 주장하지 않는다)은
 *       그 슬롯 순유입 0 이다. 순유입은 더하기만 하므로 0 은 보수적이다 — 다음 회차가 같은 원천을 더 늦게 볼 뿐이다.
 *    🔴 파일·run marker·provenance 하나라도 어긋나거나, 어느 표본일이든 기준선이 없으면 모름(`null`)이다.
 *    🔴 기준선·표본은 `naturalRunSnapshotOf` 한 규칙이다 — `failed` 회차도 snapshot·marker 가 온전하면 쓰고,
 *       `running`·모르는 상태·marker/snapshot 손상은 모름이다.
 */
export function measuredFutureSourceOpportunities(input: {
  dataDir: string
  kstDate: string
  now: Date
  proofSlots: readonly Date[]
  /** 오늘 READY 기회 — 먼저 짝짓는다 */
  ready: readonly SlotOpportunity[]
  /** 오늘 현재 원천 기회 — 순유입과 같은 남은 슬롯을 다툰다 */
  current: readonly SlotOpportunity[]
  readyPerSourceLow: number | null
  sampleDays?: number
  /** 격리 시험용. 운영에서는 현재 계정의 stage recovery 디렉터리를 읽는다. */
  recoveryHome?: string
}): number | null {
  const y = input.readyPerSourceLow
  const sampleDays = input.sampleDays ?? UNIT_COST_DAYS
  if (!Number.isFinite(input.now.getTime()) || y === null || !Number.isFinite(y) || y < 0 || y > 1
    || !Number.isInteger(sampleDays) || sampleDays <= 0 || !existsSync(input.dataDir)) return null
  const calendarStart = Date.parse(`${input.kstDate}T00:00:00Z`)
  if (!Number.isFinite(calendarStart)) return null
  const nowWall = kstWallClock(input.now.getTime())
  if (nowWall === null || nowWall.date !== input.kstDate) return null
  const nowMinute = nowWall.minute
  const futureSupplyMinutes = SUPPLY_PROOF_RUN_SLOTS_KST
    .map((slot) => slot.hour * 60 + slot.minute)
    .filter((minute) => minute > nowMinute)
  if (futureSupplyMinutes.length === 0) return 0
  const publishMinutes = input.proofSlots.map((slot) => kstWallClock(slot.getTime()))
    .filter((wall): wall is { date: string; minute: number } => wall !== null && wall.date === input.kstDate)
    .map((wall) => wall.minute)
  if (publishMinutes.length !== input.proofSlots.length) return null
  const sampleDates = Array.from({ length: sampleDays }, (_, index) =>
    new Date(calendarStart - (sampleDays - index) * 86_400_000).toISOString().slice(0, 10))
  const sampleDateSet = new Set(sampleDates)

  /** 표본일의 남은 공급 슬롯 창 안 회차면 그 날짜·슬롯, 아니면 null */
  const sampleSlotOf = (runId: string): { date: string; minute: number } | null => {
    const runMs = runMsOf(runId)
    const wall = runMs === null ? null : kstWallClock(runMs)
    const minute = wall === null ? null
      : supplyRunSlotMinuteOf(wall.minute, SUPPLY_PROOF_RUN_SLOTS_KST, SUPPLY_RUN_WINDOW_MS)
    return wall === null || minute === null || !sampleDateSet.has(wall.date) || !futureSupplyMinutes.includes(minute)
      ? null : { date: wall.date, minute }
  }
  type Sample = { date: string; minute: number; startedAtMs: number; availableAt: number; evidence: readonly unknown[]; takenAt: Date }
  const samples: Sample[] = []
  const files = readdirSync(input.dataDir)
  const snapshotRuns = new Set<string>()
  for (const name of files) {
    const match = OPPORTUNITY_FILE_RE.exec(name)
    if (match === null) continue
    const runId = match[1]!
    snapshotRuns.add(runId)
    if (sampleSlotOf(runId) === null) continue
    // 🔴 기준선과 같은 무결성 규칙 — 끝난(done·failed) 자연 회차의 온전한 snapshot 만. 손상·미완료는 모름
    const read = naturalRunSnapshotOf(input.dataDir, runId, input.now.getTime())
    if (read === null) return null
    // 수동·사건·복구 회차는 기회량을 부풀리지 않는다. 그 슬롯에 자연 표본이 따로 없으면 그 슬롯 순유입은 0이다.
    if (read === 'not-natural') continue
    samples.push({
      date: read.date, minute: read.slot, startedAtMs: read.startedAtMs,
      availableAt: read.startMinute + SUPPLY_RUN_WINDOW_MS / 60_000,
      evidence: read.evidence, takenAt: new Date(read.takenAt),
    })
  }
  // 🔴 누락 증명 — 기회 파일 없는 창 안 회차 기록은 읽혀야 하고, 자연 회차라면 끝났어야(done·failed · 완료 시각이
  //    시작 뒤 · 판정 이전) 하며 snapshot 을 썼다고 주장하지 않아야 한다. 못 읽거나 기원 불명이거나 `running`·모르는
  //    상태·완료 시각 손상이거나 `written` 을 주장하는데 파일이 없으면 누락이 아니라 모름이다.
  for (const name of files) {
    const match = /^supply-process-(\d{8}-\d{6})\.run\.json$/.exec(name)
    if (match === null || snapshotRuns.has(match[1]!) || sampleSlotOf(match[1]!) === null) continue
    try {
      const run = JSON.parse(readFileSync(join(input.dataDir, name), 'utf-8')) as Record<string, unknown>
      const shadow = parseRunTokenShadowTag(run.runTokenShadow)
      if (run.runId !== match[1] || shadow === null) return null
      if (!isNaturalScheduledRunTag(shadow)) continue
      const startedAtMs = typeof run.startedAt === 'string' ? Date.parse(run.startedAt) : Number.NaN
      const completedAtMs = typeof run.completedAt === 'string' ? Date.parse(run.completedAt) : Number.NaN
      if ((run.status !== 'done' && run.status !== 'failed') || !Number.isFinite(startedAtMs)
        || !Number.isFinite(completedAtMs) || completedAtMs < startedAtMs || completedAtMs > input.now.getTime()) return null
      const marker = run.opportunityInventory
      if (marker !== null && typeof marker === 'object' && (marker as Record<string, unknown>).status === 'written') return null
    } catch { return null }
  }

  const minuteOf = (slot: Date): number => kstWallClock(slot.getTime())?.minute ?? -1
  const slotOn = (date: string, minute: number): Date => new Date(
    `${date}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00+09:00`)
  let additional: number | null = null
  for (const date of sampleDates) {
    const daySamples = samples.filter((sample) => sample.date === date).sort((a, b) => a.startedAtMs - b.startedAtMs)
    const baseline = baselineEvidenceOf(input.dataDir, date, nowMinute)
    if (baseline === null) return null
    const recoverySourceHashes = readStageRecoverySourceHashes(date, input.recoveryHome)
    if (recoverySourceHashes === null) return null
    const seen = new Set<string>()
    for (const ev of baseline) {
      const read = readSourceEvidence({ sourceEvidence: ev })
      if (read.ok && read.record.provenance.articleIdHash !== null) seen.add(read.record.provenance.articleIdHash)
    }
    // 복구 회차에서 처음 본 원천은 이후 자연 회차에 다시 보여도 자연 순유입이 아니다.
    for (const hash of recoverySourceHashes) seen.add(hash)
    const inflow: SlotOpportunity[] = []
    for (const sample of daySamples) {
      for (const ev of sample.evidence) {
        const read = readSourceEvidence({ sourceEvidence: ev })
        const hash = read.ok ? read.record.provenance.articleIdHash : null
        if (hash === null || seen.has(hash)) continue
        seen.add(hash)
        const historical = sourceOpportunitiesOf([ev], new Set<string>(), sample.takenAt)[0]
        if (historical === undefined) continue
        inflow.push({
          key: `future:${date}:${hash}`,
          validAt: (slotAt) => {
            const minute = minuteOf(slotAt)
            return minute >= sample.availableAt && historical.validAt(slotOn(date, minute))
          },
        })
      }
    }
    additional = Math.min(additional ?? Number.POSITIVE_INFINITY, futureAdditionalOf({
      slots: input.proofSlots, ready: input.ready, current: input.current, inflow, readyPerSource: y,
    }))
  }
  return additional
}

/**
 * 🔴 **하루 순유입의 추가 기회** — 순수. 두 상한 중 작은 값이다.
 *    ① 겹침 상한: READY → (현재 원천 ∪ 순유입) 합집합 짝짓기 − 현재만의 짝짓기. 셋이 같은 늦은 슬롯을 다투면 겹친 몫은 0이다
 *    ② 자기 수율 상한: READY 뒤 열린 슬롯에서 유효한 **순유입만**의 기대 기회(`floor(유효 순유입 × y)` · 짝짓기 최대 이하)
 *    🔴 수율은 원천 묶음마다 따로 곱한다. 합집합에 한 번 곱하면 현재 원천(이른 슬롯 300건)의 남는 수율이
 *       순유입이 덮는 늦은 슬롯으로 옮겨 가 순유입이 사실상 수율 1 로 세진다 — 반례 3+17 슬롯 · y=0.1 에서 20/20 거짓 PASS.
 */
export function futureAdditionalOf(input: {
  slots: readonly Date[]
  ready: readonly SlotOpportunity[]
  current: readonly SlotOpportunity[]
  inflow: readonly SlotOpportunity[]
  readyPerSource: number
}): number {
  const at = (sources: readonly SlotOpportunity[]) => slotValidOpportunitiesOf({
    slots: input.slots, ready: input.ready, sources, readyPerSource: input.readyPerSource,
  })
  const overlapCap = Math.max(0, at([...input.current, ...input.inflow]).total - at(input.current).total)
  return Math.min(overlapCap, at(input.inflow).sourceExpected)
}


/**
 * 🔴 **창 안 current-quality JIT 계약 묶음(`workset-v4`)의 원천 수 — 하나라도 못 읽으면 `null`(모름)**.
 *    앞판은 못 읽는 파일을 표본에서 뺐다 — 분모가 줄어 수율 · 용량이 실제보다 커 보인다.
 *    🔴 옛 판(v1 · v2) 묶음은 손상이 아니다 — 읽되 **세지 않는다**(legacy). 창 안 JIT 묶음이 없으면 `null`.
 */
export function worksetSourcesIn(dataDir: string, fromMs: number, toMs: number): number | null {
  return jitWorksetsIn(dataDir, fromMs, toMs)?.sources ?? null
}

/** 🔴 회차 묶음 의도 — 원천 해시 → 의도(정본 판독기 `readWorkset` 결과에서만 만든다) */
export type RunIntentIndex = ReadonlyMap<string, ReadonlyMap<string, SupplyIntent>>

const byHash = (m: ReadonlyMap<string, SupplyIntent>): Map<string, SupplyIntent> =>
  new Map([...m.values()].map((x) => [x.sourceHash, x] as const))

/**
 * 🔴 **창 안 JIT 묶음 — 원천 수와 회차별 의도 색인** (2026-10-04 P0-2 최종). 하나라도 못 읽으면 `null`.
 *    옛 판(v1 · v2)은 손상이 아니라 legacy — 읽되 세지 않는다. 창 안 JIT 묶음이 없으면 `null`.
 */
export function jitWorksetsIn(dataDir: string, fromMs: number, toMs: number): { sources: number; byRun: RunIntentIndex } | null {
  if (!existsSync(dataDir)) return null
  let n = 0
  let files = 0
  const byRun = new Map<string, ReadonlyMap<string, SupplyIntent>>()
  const quality = currentQualityContract()
  for (const f of readdirSync(dataDir)) {
    const m = WORKSET_FILE_RE.exec(f)
    if (m === null) continue
    const at = runMsOf(m[1]!)
    if (at === null || at < fromMs || at >= toMs) continue
    try {
      // 제한 복구는 당일 부족을 메우는 실행이지 다음 시험의 자연 수율 표본이 아니다.
      // 회차 기록이 있는 현재 실행은 recovery 표식을 먼저 보고 분자·분모에서 함께 뺀다.
      // 옛 fixture처럼 회차 기록이 없는 묶음은 기존 호환을 위해 그대로 판독한다.
      const runPath = join(dataDir, `supply-process-${m[1]!}.run.json`)
      if (existsSync(runPath)) {
        const run = JSON.parse(readFileSync(runPath, 'utf-8')) as Record<string, unknown>
        if (run.runId !== m[1]!) return null
        if (isSupplyCostRecoveryTagged(run.runTokenShadow)) continue
      }
      // 🔴 정본 판독기(`readWorkset`)가 센다 — 두 번째 파서를 두지 않는다
      const r = readWorkset(JSON.parse(readFileSync(join(dataDir, f), 'utf-8')), m[1]!)
      if (!r.ok) return null
      if (r.intents === null) continue
      if (r.qualityContract?.version !== quality.version || r.qualityContract.digest !== quality.digest) continue
      n += r.count; files += 1
      byRun.set(m[1]!, byHash(r.intents))
    } catch { return null }
  }
  return files === 0 ? null : { sources: n, byRun }
}


/**
 * 🔴 **가장 최근 공급 기회 inventory** — 회차 종료 후에도 소비되지 않은 stage-neutral 원천의 증거 기록.
 *    없으면 빈 목록(기회 0 — 모름이 아니다: 공급이 아직 안 돌았으면 READY 로만 센다). 손상이면 `evidence: null`(모름).
 */
export function latestOpportunities(dataDir: string, nowMs: number): {
  evidence: unknown[] | null
  takenAt: string | null
  runId: string | null
  inventory: OpportunitySnapshot['inventory'] | null
  issue?: 'LEGACY_CONTRACT' | 'UNKNOWN_CONTRACT' | 'CORRUPT' | 'STALE'
} {
  if (!existsSync(dataDir)) return { evidence: [], takenAt: null, runId: null, inventory: null }
  /**
   * 🔴 최신 live 공급 회차가 v3 inventory를 남겼는지 묶는다.
   *    최신 회차가 파일을 못 남겼는데 직전 회차 inventory로 내려가면 기회를 부풀릴 수 있다.
   *    회차 기록이 하나도 없는 순수 검사 fixture에서는 파일 자체 계약만 검증한다.
   */
  const runFiles = readdirSync(dataDir)
    .flatMap((name) => {
      const m = /^supply-process-(\d{8}-\d{6})\.run\.json$/.exec(name)
      const at = m === null ? null : runMsOf(m[1]!)
      return m === null || at === null || at > nowMs ? [] : [{ name, runId: m[1]! }]
    })
    .sort((a, b) => b.runId.localeCompare(a.runId))
  const latestRun = runFiles[0] ?? null
  const files = readdirSync(dataDir).filter((f) => OPPORTUNITY_FILE_RE.test(f)).sort()
  for (const f of files.reverse()) {
    let snap: ReturnType<typeof readOpportunitySnapshot>
    let issue: 'LEGACY_CONTRACT' | 'UNKNOWN_CONTRACT' | 'CORRUPT' = 'CORRUPT'
    const match = OPPORTUNITY_FILE_RE.exec(f)
    if (match === null) continue
    const fileRunId = match[1]!
    const fileAt = runMsOf(fileRunId)
    // 🔴 최신 파일의 시계가 미래이거나 해석 불가면 손상이다. 건너뛰고 옛 정상판으로 내려가지 않는다.
    if (fileAt === null || fileAt > nowMs) {
      return { evidence: null, takenAt: null, runId: fileRunId, inventory: null, issue: 'CORRUPT' }
    }
    if (latestRun !== null && latestRun.runId !== fileRunId) {
      return { evidence: null, takenAt: null, runId: latestRun.runId, inventory: null, issue: 'STALE' }
    }
    try {
      const raw = JSON.parse(readFileSync(join(dataDir, f), 'utf-8')) as { version?: unknown }
      if ((OPPORTUNITY_VERSIONS_LEGACY as readonly unknown[]).includes(raw?.version)) issue = 'LEGACY_CONTRACT'
      else if (typeof raw?.version === 'string' && raw.version !== OPPORTUNITY_VERSION) issue = 'UNKNOWN_CONTRACT'
      snap = readOpportunitySnapshot(raw)
    } catch { snap = null }
    if (snap === null) return { evidence: null, takenAt: null, runId: null, inventory: null, issue }
    if (fileRunId !== snap.runId) {
      return { evidence: null, takenAt: null, runId: null, inventory: null, issue: 'CORRUPT' }
    }
    const takenAtMs = Date.parse(snap.takenAt)
    // 관측은 회차 시작보다 이를 수 없고, 판정 시각보다 늦을 수도 없다.
    if (!Number.isFinite(takenAtMs) || takenAtMs < fileAt || takenAtMs > nowMs) {
      return { evidence: null, takenAt: snap.takenAt, runId: snap.runId, inventory: null, issue: 'CORRUPT' }
    }
    if (latestRun !== null) {
      try {
        const run = JSON.parse(readFileSync(join(dataDir, latestRun.name), 'utf-8')) as Record<string, unknown>
        const marker = run.opportunityInventory
        if (run.runId !== fileRunId || marker === null || typeof marker !== 'object' || Array.isArray(marker)) {
          return { evidence: null, takenAt: null, runId: latestRun.runId, inventory: null, issue: 'STALE' }
        }
        const m = marker as Record<string, unknown>
        if (m.status !== 'written' || m.runId !== fileRunId || m.observedAt !== snap.takenAt
          || m.written !== snap.inventory.counts.written || m.reason !== null) {
          return { evidence: null, takenAt: null, runId: latestRun.runId, inventory: null, issue: 'STALE' }
        }
      } catch {
        return { evidence: null, takenAt: null, runId: latestRun.runId, inventory: null, issue: 'STALE' }
      }
    }
    return { evidence: snap.evidence, takenAt: snap.takenAt, runId: snap.runId, inventory: snap.inventory }
  }
  if (latestRun !== null) {
    return { evidence: null, takenAt: null, runId: latestRun.runId, inventory: null, issue: 'STALE' }
  }
  return { evidence: [], takenAt: null, runId: null, inventory: null }
}

/**
 * 🔴 **기회 스냅샷 → 슬롯 기회** — 순수. 스냅샷의 증거 기록마다 정본 판정(생성 전 모드 · 참여 동력 · 배정 `pending`)을
 *    그 슬롯 시각에 부른다. 이미 큐에 있는 원천(증거 해시)은 뺀다. 읽지 못하는 기록은 기회가 아니다.
 */
export function sourceOpportunitiesOf(
  evidence: readonly unknown[], queuedHashes: ReadonlySet<string>, now: Date,
): SlotOpportunity[] {
  const out: SlotOpportunity[] = []
  for (const [k, ev] of evidence.entries()) {
    const read = readSourceEvidence({ sourceEvidence: ev })
    if (!read.ok) continue
    const h = read.record.provenance.articleIdHash
    if (h !== null && queuedHashes.has(h)) continue
    out.push({
      key: `src:${h ?? k}`,
      validAt: (slotAt) => judgeSlotRelease({
        evidence: ev, slotAt, now, hardGates: { ok: true, codes: [] },
        assignment: 'pending', driver: 'pending', tieBreak: String(k),
      }).verdict === 'eligible',
    })
  }
  return out
}

/**
 * 🔴 **증명일 기회 수** — 순수. READY 기회를 먼저 짝짓고, 남은 슬롯을 원천 기회로 채운 뒤 **측정 수율로 할인**한다.
 *    🔴 (2026-10-04 P0-2) 수율은 결말 기준 원천 수율(`terminalYieldOf`)이다 — 대기 포함 raw 수율이 아니다.
 *       구간(low · high)은 호출부가 두 번 불러 합친다(`combineOpportunityBounds`).
 *    원천 기회는 초안 전이라 참여 동력 · 배정이 아직 없다(`pending`) — 같은 정본 판정의 생성 전 모드다.
 *    수율을 모르면 원천 기회는 세지 않는다(READY 만 — 과대평가 금지).
 *
 * 🔴 **수율은 원천 1건당 값이다 — 원천 수에 곱한다, 슬롯 수에 곱하지 않는다** (2026-10-01 Lane B).
 *    앞판은 원천을 먼저 슬롯에 짝지어(최대 남은 슬롯 수) 그 수에 수율을 곱했다 — `floor(3 × 0.098) = 0`.
 *    원천이 221건 있어도 3건 있어도 같은 0 이었다: 수율 < 1/슬롯 수 이면 원천 기회는 **언제나 0** (재현).
 *    이제 기대 READY = `floor(남은 슬롯 중 하나라도 eligible 인 원천 수 × 수율)` 이고,
 *    그 값은 원천 기회로 실제 덮을 수 있는 슬롯 수(`sourceFilled` — 짝짓기 최대)를 넘지 못한다.
 *    🔴 새 문턱 · 가중치 없음 — 같은 수율 · 같은 정본 판정 · 같은 짝짓기다.
 */
export function slotValidOpportunitiesOf(input: {
  slots: readonly Date[]
  ready: readonly SlotOpportunity[]
  sources: readonly SlotOpportunity[]
  readyPerSource: number | null
}): { total: number; readyFilled: number; sourceFilled: number; sourceValid: number; sourceExpected: number } {
  const r = matchOpportunitiesToSlots(input.slots, input.ready)
  const open = input.slots.filter((_, i) => r.bySlot[i] === null)
  const s = matchOpportunitiesToSlots(open, input.sources)
  // 🔴 READY 가 이미 덮은 슬롯에만 eligible 인 원천은 증명일 기회가 아니다 — 남은 슬롯 기준으로 센다
  const sourceValid = input.sources.filter((o) => open.some((d) => o.validAt(d))).length
  const sourceExpected = input.readyPerSource === null
    ? 0 : Math.min(s.filled, Math.floor(sourceValid * input.readyPerSource))
  return {
    total: Math.min(input.slots.length, r.filled + sourceExpected),
    readyFilled: r.filled, sourceFilled: s.filled, sourceValid, sourceExpected,
  }
}

/**
 * 🔴 **수율 구간 → 증명일 기회 수** — 두 끝이 같으면 그 값. 하한이 이미 모든 슬롯을 덮으면 하한(충분).
 *    상한도 슬롯을 못 덮으면 하한(어느 쪽이든 부족 — FAIL 근거). 그 사이는 `null`(모름 — 모르는 대기의 결말이 가른다).
 */
export function combineOpportunityBounds(low: number, high: number, slots: number): number | null {
  if (low === high || low >= slots) return low
  if (high < slots) return low
  return null
}

/** 🔴 cohort 행 한 줄 — 원천 해시 · 상태 · 대기 결말(대기만) */
export type CohortRow = { id: string; status: string; hash: string | null; fate: PendingFate | null }

/** 🔴 비용 귀속용 결말 — 상태가 결말이면 그것, 대기면 분류 결과 */
export function costFateOf(r: CohortRow): CostFate {
  if (r.status === 'PUBLISHED') return 'published'
  if (READY_LOSS_STATUSES.includes(r.status)) return 'lost'
  return r.fate ?? 'unknown'
}

/** 🔴 의도 연결 실패 — cohort 판독 안에서만 쓰는 신호 */
class IntentMismatch extends Error {}

/**
 * 🔴 **자동 READY cohort 판독 — preflight 와 공급 러너가 같은 함수를 부른다** (2026-10-04 P0-2).
 *    창 안 자동 READY 행 전부(한 번의 조회) · 대기 행은 정본 판정으로 예정 · 손실 · 모름(`pendingFateOf`) ·
 *    같은 창 묶음 원천 수 · 결말 수율 구간. 읽지 못한 칸은 `null`(모름) — 손상 파일을 조용히 빼지 않는다.
 */
export async function readReadyCohort(prisma: PrismaClient, i: {
  windowFrom: Date; windowTo: Date; dataDir: string
  /** 🔴 다가오는 슬롯에 정본 짝짓기로 걸린 READY 열쇠 — 커버리지와 같은 호출에서 얻는다 */
  matched: ReadonlySet<string>
  horizon: readonly Date[]
  now: Date
}): Promise<{
  rows: CohortRow[] | null; fates: FateCounts | null; readyCount: number | null; legacyExcluded: number | null
  /**
   * 🔴 **자동 전환 실패로 분자에서 뺀 미도장 기계 행 수** (2026-10-09 P0-a) — 정본 `eligibilityOf` 가 자동 부적격으로 본 행
   *    (gate FAIL · 의미 경고 · 금지 문구 등 → 사람 검토 경로). 그 원천은 분모(`worksetSources`)에 그대로 남는다 —
   *    자동 전환 실패가 수율에 반영된다. legacy 가 아니다. 읽지 못했으면 null.
   */
  autoIneligibleExcluded: number | null
  worksetSources: number | null; yieldBounds: { low: number; high: number } | null; notes: string[]
  /** 🔴 현재 계약을 주장했지만 묶음 · 증거와 맞지 않은 행의 이유 코드 — 하나라도 있으면 cohort 전체가 모름 */
  intentMismatches: IntentLinkIssue[]
  /**
   * 🔴 **이 cohort 의 회차 집합** — 같은 창 current-quality `workset-v4` 색인의 회차 id. 🔴 불변식: 큐 결과(분자) · `worksetSources`(분모) ·
   *    현재 계약 비용(`costAttributionOf` 의 `cohortRuns`)이 **이 집합 하나**에서 나온다. 창 밖 회차는 셋 다에서 빠진다.
   */
  cohortRuns: ReadonlySet<string>
}> {
  const notes: string[] = []
  let rows: CohortRow[] | null = null
  let legacyExcluded: number | null = null
  let autoIneligibleExcluded: number | null = null
  const intentMismatches: IntentLinkIssue[] = []
  const ws = jitWorksetsIn(i.dataDir, i.windowFrom.getTime(), i.windowTo.getTime())
  const worksetSources = ws?.sources ?? null
  try {
    /**
     * 🔴 **cohort 시계는 공급 회차 하나다** (2026-10-09 P0). 분모(묶음 원천) · 분자(READY) · 비용(장부)이 **같은 회차 집합**
     *    (`cohortRuns` = 창 안 current-quality `workset-v4` 회차)을 쓴다. 앞판은 분자만 자동 도장 시각(`decidedAt`) 창으로 잘랐다 —
     *    발행 러너는 22:00 뒤 08:00 까지 돌지 않아 **22:15 회차 결과가 매일 분모에만 들고 분자에서 빠졌다**
     *    (2026-10-09 07:00 실측: 원천 101 · READY 16 → 공급 능력 9. 회차 기준이면 READY 20 → 11).
     *    🔴 행은 적재 시각이 창 시작 이후인 것만 후보로 읽는다 — 회차 시작 ≥ 창 시작이고 적재는 회차 뒤다(이월 적재 포함).
     *    소속은 시각이 아니라 `supplyIntent.runId ∈ cohortRuns` 가 정한다. 창 밖 회차 행은 **제외**다(불일치가 아니다).
     */
    const found = await prisma.originalPostApprovalQueue.findMany({
      where: { createdAt: { gte: i.windowFrom, lt: i.windowTo } },
      select: {
        id: true, status: true, gateResults: true, decidedBy: true, createdPostId: true,
        // 🔴 미도장 기계 행의 자동 적격 판정(`eligibilityOf`) 입력 — 출력하지 않는다
        gateVerdict: true, draftTitle: true, draftBody: true, editedTitle: true, editedBody: true,
      },
    })
    /**
     * 🔴 **자동 READY 경로 행만** — 자동 도장(`AUTO_DECIDER`) 행, 그리고 **자동 도장 전 기계 적재 행**
     *    (`machine:` · APPROVED · 미발행). 도장 전 행은 아래에서 정본 `eligibilityOf` 로 나눈다 — 적격만 결말 모름(unknown)이고
     *    부적격은 분자에서 뺀다. 사람이 결정한 행은 자동 READY 가 아니다(세지 않는다).
     */
    const autoPath = found.filter((r) => r.decidedBy === AUTO_DECIDER
      || ((r.decidedBy ?? '').startsWith('machine:') && r.status === 'APPROVED' && r.createdPostId === null))
    /**
     * 🔴 **현재 JIT 계약 행만** (2026-10-04 P0-2 보정 · 최종) — 계약을 주장한 행은 모양만 보고 인정하지 않는다:
     *    그 회차 current-quality `workset-v4`(정본 판독기)의 같은 원천 의도 · 원문 증거 해시와 **정확히** 같아야 한다.
     *    하나라도 다르면 legacy 로 빼지 않고 cohort 전체를 모름으로 닫는다. 주장하지 않는 옛 READY 는 수만 보고한다.
     */
    const claimed = autoPath.filter((r) => claimsJitContract(r.gateResults))
    const quality = currentQualityContract()
    const currentClaimed = claimed.filter((r) => {
      const intent = readSupplyIntent(r.gateResults)
      return intent === null || (intent.qualityContract.version === quality.version && intent.qualityContract.digest === quality.digest)
    })
    legacyExcluded = autoPath.length - currentClaimed.length
    // 🔴 창 밖 회차 행은 이 cohort 가 아니다 — 의도를 읽을 수 없는 행은 소속을 모르므로 불일치로 닫는다
    const current = currentClaimed.filter((r) => {
      const intent = readSupplyIntent(r.gateResults)
      return intent === null || ws?.byRun.has(intent.runId) === true
    })
    for (const r of current) {
      const intent = readSupplyIntent(r.gateResults)
      const ev = readSourceEvidence(r.gateResults)
      // 🔴 같은 cohort 창의 묶음 색인에만 묻는다 — 창 밖 회차 파일을 따로 읽지 않는다(분자 · 분모 · 비용 cohort 를 하나로)
      const run = intent === null ? undefined : ws?.byRun.get(intent.runId)
      const issue = intentLinkIssue({
        intent, evidenceHash: ev.ok ? ev.record.provenance.articleIdHash : null,
        runInCohort: run !== undefined,
        workset: intent === null || run === undefined ? null : run.get(intent.sourceHash) ?? null,
        expectedQualityContract: quality,
      })
      if (issue !== null) intentMismatches.push(issue)
    }
    if (intentMismatches.length > 0) throw new IntentMismatch()
    /**
     * 🔴 **미도장 기계 행 — 정본 자동 적격 판정으로 나눈다** (2026-10-09 P0-a · #676 회귀 보정).
     *    #676 은 미도장 행을 전부 결말 모름으로 셌다. 운영 실측(10-09): 그런 행 12건이 **전부 자동 부적격**(의미 경고 →
     *    사람 검토 경로 · 나이 p50 24h)이었다 — 도장을 기다리는 행이 아니다. 분자에 넣으면 수율 0.198 → 0.287 ·
     *    공급 능력 11 → 17 로 부풀고, 영원히 결말 모름으로 남아 필요 READY 구간을 열어 둔다.
     *    · 자동 적격(`auto`) — 다음 발행 러너 회차가 도장한다 → 결말 모름(성공으로 확정하지 않는다)
     *    · 자동 부적격 — 자동 READY 가 되지 않는다 → **분자에서 뺀다.** 원천은 분모에 남긴다(자동 전환 실패 = 수율 손실)
     *    판정은 자동 도장(`auto-ready-repo`)이 쓰는 그 함수 하나다 — 여기서 기준을 새로 만들지 않는다.
     */
    const autoEligible = (r: (typeof current)[number]): boolean => eligibilityOf({
      gateVerdict: r.gateVerdict, gateResults: r.gateResults,
      title: r.editedTitle ?? r.draftTitle, body: r.editedBody ?? r.draftBody,
    }).auto
    const counted = current.filter((r) => r.decidedBy === AUTO_DECIDER || autoEligible(r))
    autoIneligibleExcluded = current.length - counted.length
    rows = counted.map((r) => {
      const intent = readSupplyIntent(r.gateResults)!
      const terminal = r.status === 'PUBLISHED' || READY_LOSS_STATUSES.includes(r.status)
      const stamped = r.decidedBy === AUTO_DECIDER
      return {
        id: r.id, status: r.status, hash: intent.sourceHash,
        // 🔴 도장 전 적재 행 — 아직 자동 READY 가 아니다. 예정 슬롯에 걸려도 성공으로 세지 않는다
        fate: terminal ? null : !stamped ? 'unknown' : pendingFateOf({
          gateResults: r.gateResults, matched: i.matched.has(r.id), horizon: i.horizon, now: i.now, tieBreak: r.id,
        }).fate,
      }
    })
  } catch (e) {
    if (e instanceof IntentMismatch) {
      rows = null
      notes.push(`현재 계약을 주장한 자동 READY ${intentMismatches.length}건이 묶음 · 증거와 맞지 않는다`
        + ` [${[...new Set(intentMismatches)].join(',')}] — cohort 전체를 모른다(legacy 로 빼지 않는다)`)
    } else notes.push(`자동 READY cohort 를 읽지 못했다 — ${(e as Error).name}`)
  }
  const fates: FateCounts | null = rows === null ? null : cohortFatesOf(rows)
  const readyCount = fates === null ? null : fates.published + fates.lost + fates.scheduled + fates.unknown
  if (worksetSources === null) notes.push('JIT 묶음 원천 수를 모른다 — 창 안 current-quality workset-v4가 없거나 묶음 하나라도 손상')
  if (legacyExcluded !== null && legacyExcluded > 0) notes.push(`옛 JIT 또는 옛 품질 계약 자동 READY ${legacyExcluded}건 — 현재 품질 근거로 세지 않는다(구제 없음)`)
  if (autoIneligibleExcluded !== null && autoIneligibleExcluded > 0) {
    notes.push(`자동 부적격 미도장 기계 행 ${autoIneligibleExcluded}건 — 자동 READY 분자에서 뺐다(사람 검토 경로) · 원천은 분모에 남는다`)
  }
  if (fates !== null && fates.unknown > 0) notes.push(`결말을 모르는 자동 READY ${fates.unknown}건 — 손실률 · 수율은 구간으로만 판정한다`)
  return {
    rows, fates, readyCount, legacyExcluded, autoIneligibleExcluded, worksetSources,
    yieldBounds: fates === null ? null : terminalYieldOf(fates, worksetSources), notes, intentMismatches,
    cohortRuns: new Set(ws?.byRun.keys() ?? []),
  }
}

/**
 * 🔴 **preflight 사실을 모은다.** `evidenceDate` 는 전날(증거일) — 지연 · 댓글/감사 단가는 그날까지 최근 3일(증명 창).
 *    READY cohort · 수율 · 공급 단가(용량 창)는 `now` 에서 거슬러 72시간이다(`preflightWindowsOf`).
 *    어느 하나를 못 읽으면 그 칸만 `null` 이다(나머지는 계속 모은다).
 */
/**
 * 🔴 **원문 게시 → 공개 지연(시간) — 창 · 공개 시각 모두 발행 사건(발행 기록)이 정한다** (2026-09-30 야간 P0-A).
 *    창 안에 **발행 기록**(`PersonaActivityLog` kind=post · `createdAt` — 상한 정본과 같은 칸)이 있는 글만 후보다.
 *    앞판은 `Post.createdAt`(DB 기본값) 창으로 먼저 자르고 발행 기록 시각을 썼다 — 두 시계가 창 경계에서 갈렸다.
 *    그 글의 발행 사건 시각(`publishEventAtOf` — 기록 정확히 한 줄)과 release 도장이 같은 사건일 때만 센다.
 */
export async function publishLatencyHours(prisma: PrismaClient, from: Date, to: Date): Promise<number[]> {
  const inWindow = await prisma.personaActivityLog.findMany({
    where: { kind: 'post', createdAt: { gte: from, lt: to }, targetId: { not: null } },
    select: { targetId: true },
  })
  const postIds = [...new Set(inWindow.map((l) => l.targetId).filter((x): x is string => x !== null && x !== ''))]
  if (postIds.length === 0) return []
  // 🔴 사건 판정은 그 글의 **모든** 발행 기록으로 한다 — 창 밖 중복 기록이 있으면 같은 사건을 증명하지 못한다
  const logs = await prisma.personaActivityLog.findMany({
    where: { kind: 'post', targetId: { in: postIds } },
    select: { targetId: true, publishedAt: true, createdAt: true },
  })
  const published = await prisma.originalPostApprovalQueue.findMany({
    where: { status: 'PUBLISHED', createdPostId: { in: postIds } },
    select: { gateResults: true, createdPostId: true },
  })
  const lat: number[] = []
  for (const q of published) {
    const eventAt = publishEventAtOf(logs.filter((l) => l.targetId === q.createdPostId))
    if (eventAt === null || releaseStampStatusOf(q.gateResults, eventAt) !== 'STAMPED_ELIGIBLE') continue
    const ev = readSourceEvidence(q.gateResults)
    const posted = ev.ok && ev.record.postedAt !== null ? Date.parse(ev.record.postedAt) : Number.NaN
    if (!Number.isFinite(posted)) continue
    lat.push((eventAt.getTime() - posted) / 3_600_000)
  }
  return lat
}

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
   * 최종 복구 판정에서만 주는 정확한 lineage. 날짜 전체 READY 증분을 복구 성과로 오인하지 않도록
   * exact nonce 원천과 intent 이후 생성된 행만 슬롯 매칭 결과에서 센다.
   */
  recoveryLineage?: { sourceHashes: ReadonlySet<string>; supplyRunId: string; createdAt: Date }
  /**
   * 🔴 **Persona 레인 주입 자리** — 계약 유효 Persona 수. 주지 않으면 `null`(모름 → UNKNOWN).
   *    🔴 활성 행 수를 넣지 않는다.
   */
  contractValidPersonas?: () => Promise<number | null>
}): Promise<{ facts: PreflightFacts; notes: string[]; detail: Record<string, unknown> }> {
  const notes: string[] = []
  const win = preflightWindowsOf(i.evidenceDate, i.now)
  const dates = win.proof.dates
  const pooled = (dir: string): LedgerEntry[] | null => pooledEntries(dates.map((d) => readDay(dir, d)))

  // 기회(READY) — 자동 · 열림. 증명일 슬롯 짝짓기는 커버리지와 대기 결말 분류가 **같은 호출**을 쓴다
  const readyOpps = i.autoOpen.open
    ? readyOpportunitiesOf(i.loaded, { caps: i.caps, now: i.now, autoOnly: true }) : []
  if (!i.autoOpen.open) notes.push(`자동 READY 닫힘 — ${i.autoOpen.reasons.join(' · ') || '이유 없음'} (READY 기회 0 · 대기는 예정 슬롯에 걸리지 않는다)`)
  const matchedReady = new Set(matchOpportunitiesToSlots(i.proofSlots, readyOpps).bySlot.filter((k): k is string => k !== null))
  let slotValidRecoveryReadyStock: number | null = null
  if (i.recoveryLineage !== undefined) {
    slotValidRecoveryReadyStock = slotValidRecoveryReadyStockOf({
      rows: i.loaded.allRows,
      matchedReady,
      sourceHashes: i.recoveryLineage.sourceHashes,
      supplyRunId: i.recoveryLineage.supplyRunId,
      createdAt: i.recoveryLineage.createdAt,
    })
  }

  // READY cohort — 공급 러너와 같은 판독(`readReadyCohort`)
  const cohort = await readReadyCohort(prisma, {
    windowFrom: win.capacity.from, windowTo: win.capacity.to, dataDir: i.dataDir, matched: matchedReady, horizon: i.proofSlots, now: i.now,
  })
  notes.push(...cohort.notes)
  const { rows, fates, readyCount, worksetSources, yieldBounds } = cohort

  // 기회 — READY + 원천 스냅샷(결말 수율로 할인 · 구간이면 두 끝을 합친다)
  const snap = latestOpportunities(i.dataDir, i.now.getTime())
  if (snap.evidence === null) {
    if (snap.issue === 'LEGACY_CONTRACT') {
      notes.push('가장 최근 원천 기회가 옛 판(v1/v2)이다 — stage-neutral inventory(v3)가 아니라 증명일 기회를 모른다')
    } else if (snap.issue === 'UNKNOWN_CONTRACT') {
      notes.push('가장 최근 원천 기회가 알지 못하는 판이다 — 증명일 기회를 모른다')
    } else if (snap.issue === 'STALE') {
      notes.push('가장 최근 공급 회차와 원천 기회 inventory가 묶이지 않는다 — 직전 회차 기회로 내려가지 않고 모른다')
    } else {
      notes.push('가장 최근 원천 기회 inventory가 손상됐다 — 증명일 기회를 모른다')
    }
  }
  const queuedHashes = new Set(i.loaded.allRows.map((r) => {
    const ev = readSourceEvidence(r.gateResults)
    return ev.ok ? ev.record.provenance.articleIdHash : null
  }).filter((h): h is string => h !== null))
  const sourceOpps = sourceOpportunitiesOf(snap.evidence ?? [], queuedHashes, i.now)
  const oppAt = (y: number | null): ReturnType<typeof slotValidOpportunitiesOf> =>
    slotValidOpportunitiesOf({ slots: i.proofSlots, ready: readyOpps, sources: sourceOpps, readyPerSource: y })
  const opp = oppAt(yieldBounds?.low ?? null)
  const oppHigh = oppAt(yieldBounds?.high ?? null)
  const slotValidOpportunities = snap.evidence === null ? null
    : combineOpportunityBounds(opp.total, oppHigh.total, i.proofSlots.length)
  // 🔴 현재 원천 판독이 깨졌으면 순유입을 얹을 기준이 없다 — 모름
  const futureSupplyCapacity = snap.evidence === null ? null : measuredFutureSourceOpportunities({
    dataDir: i.dataDir, kstDate: kstDateString(i.now), now: i.now, proofSlots: i.proofSlots,
    ready: readyOpps, current: sourceOpps, readyPerSourceLow: yieldBounds?.low ?? null,
  })
  if (futureSupplyCapacity === null) {
    notes.push('남은 당일 공급 기회를 모른다 — 하한 수율 · 3일 기준선 · 남은 공급 슬롯 자연 표본 중 하나가 없거나 깨졌다. 현재 기회가 목표 미만이면 시험을 열지 않는다')
  }

  // 지연 — 지금 계약 도장으로 나간 글 · 원천 게시 → 공개
  let latencyP50H: number | null = null
  let latencyP90H: number | null = null
  try {
    const lat = await publishLatencyHours(prisma, win.proof.from, win.proof.to)
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
  /**
   * 🔴 **비용 귀속** — 같은 창 공급 장부(하루라도 손상이면 모름) → 현재 계약 요청(`supplyContract` · `sourceKey`)을
   *    cohort 행 결말에 붙인다. legacy · 미연결 · 미정산 · 결말 모름 비용이 하나라도 있으면 결과당 단가는 `null`.
   *    판정은 그 단가 하나로 공급 비용을 본다(`목표 × 결과당 비용`) — raw READY 단가는 쓰지 않는다.
   */
  /**
   * 🔴 공급 장부 — cohort 창의 KST 날들 + 그 다음 날 파일. 장부 날짜는 요청 시작 시각이라 창 마지막 날 늦은 회차의 요청이
   *    다음 날 파일에 적힐 수 있다. 줄은 **cohort 회차 것만** 분자에 들어간다(`cohortRuns`) — 다음 날의 다른 회차 줄은 보고만.
   */
  const supplyEntries = pooledEntries(win.capacity.ledgerDates.map((d) => readDay(defaultLedgerDir(), d)))
  if (supplyEntries === null) notes.push('공급 장부가 손상됐다 — 공급 비용을 모른다')
  const fateByKey = new Map<string, CostFate>()
  for (const r of rows ?? []) if (r.hash !== null) fateByKey.set(r.hash, costFateOf(r))
  // 최종 복구 판정은 검증된 exact supply run의 비용도 같은 trial envelope에 넣는다.
  // READY 수율의 자연 cohort는 바꾸지 않고, 복구의 미정산·예약 초과 비용만 숨지 못하게 한다.
  const costCohortRuns = new Set(cohort.cohortRuns)
  if (i.recoveryLineage !== undefined) costCohortRuns.add(i.recoveryLineage.supplyRunId)
  const costAttribution: CostAttribution | null = rows === null || fates === null ? null
    : costAttributionOf({ entries: supplyEntries, fateByKey, counts: fates, cohortRuns: costCohortRuns })
  if (costAttribution !== null && costAttribution.usdPerSlotValidResult === null) {
    notes.push(`slot-valid 결과당 비용을 모른다 — legacy 정산 $${costAttribution.legacyUsd.toFixed(4)}`
      + ` · 원천 미연결 $${costAttribution.unlinkedUsd.toFixed(4)} · 미정산 ${costAttribution.openRequests}건`
      + ` (추정 예약액 $${costAttribution.openReservedUsd.toFixed(4)} — 실제 비용 아님) · 현재 정산 $${costAttribution.totalUsd.toFixed(4)}`)
  }
  const readyCohort: ReadyCohortFact | null = fates === null || worksetSources === null ? null
    : {
        sources: worksetSources, ...fates,
        usdPerSlotValidResult: costAttribution?.usdPerSlotValidResult ?? null,
        trialCost: costAttribution === null ? null : {
          settledRequests: costAttribution.settledRequests,
          usageUnknownRequests: costAttribution.usageUnknownRequests,
          recoverySettledRequests: costAttribution.recoverySettledRequests,
          recoveryUsageUnknownRequests: costAttribution.recoveryUsageUnknownRequests,
          overrunRequests: costAttribution.trialOverrunRequests,
          ineligibleRequests: costAttribution.trialIneligibleRequests,
          riskUsdPerSlotValidResult: costAttribution.trialRiskUsdPerSlotValidResult,
        },
      }

  const facts: PreflightFacts = {
    proofKstDate: (() => {
      const proofDates = new Set(i.proofSlots.map((slot) => kstDateString(slot)))
      return proofDates.size === 1 ? [...proofDates][0]! : null
    })(),
    slotValidOpportunities,
    slotValidReadyStock: opp.readyFilled,
    slotValidRecoveryReadyStock,
    futureSupplyCapacity,
    readyCohort,
    latencyP50H, latencyP90H,
    contractValidPersonas,
    commentUsdPerRequest,
    commentDailyUsdCap: commentLoopLimitsFromEnv(i.env).limits.dailyUsd,
    auditUsdPerCall,
    auditDailyUsdCap: auditLimitsFromEnv(i.env).dailyUsd,
    supplyDailyUsdCap: cappedBy(limitsFromEnv(i.env).dailyUsd, SUPPLY_DAILY_USD_APPROVED),
    runnerHealth: i.runnerHealth,
  }
  return {
    facts, notes,
    detail: {
      readyFilled: opp.readyFilled, slotValidRecoveryReadyStock,
      sourceFilled: opp.sourceFilled, sourceOpportunities: sourceOpps.length,
      sourceValid: opp.sourceValid, sourceExpected: opp.sourceExpected, sourceExpectedHigh: oppHigh.sourceExpected,
      futureSupplyCapacity,
      opportunitySnapshotAt: snap.takenAt, opportunitySnapshotRunId: snap.runId,
      opportunityInventory: snap.inventory, readyCount, legacyExcluded: cohort.legacyExcluded,
      autoIneligibleExcluded: cohort.autoIneligibleExcluded, worksetSources, yieldBounds, fates,
      intentMismatches: cohort.intentMismatches,
      costAttribution,
      // 🔴 두 시계를 그대로 보고한다 — 증명(전날 KST 달력일 3일) · 용량(`now` 에서 거슬러 72h)
      proofWindow: { from: win.proof.from.toISOString(), to: win.proof.to.toISOString() },
      // 🔴 댓글 · 감사 단가를 모은 날 — 증명 달력일이다(오늘이 끼면 전날 증명이 오염된 것)
      unitCostDates: dates,
      capacityWindow: { from: win.capacity.from.toISOString(), to: win.capacity.to.toISOString() },
    },
  }
}
