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
import type { PreflightFacts, ReadyCohortFact, RunnerGrid } from '../../src/lib/stage-ladder-generic'
import {
  READY_LOSS_STATUSES, cohortFatesOf, costAttributionOf, pendingFateOf, terminalYieldOf,
  type CostAttribution, type CostFate, type FateCounts, type PendingFate,
} from '../../src/lib/ready-fate'
import { PER_RUN_MAX } from '../../src/lib/publish-slot-catchup'
import {
  COMMENT_LOOP_RUN_REQUEST_CAP_DEFAULT, COMMENT_LOOP_BUDGET_ENV, commentLoopLimitsFromEnv,
} from '../../src/lib/persona-comment-auto-lane'
import { AUTO_DECIDER, AUTO_READY_ENV } from '../../src/lib/auto-ready-v2'
import { AUDIT_BUDGET_ENV } from '../../src/lib/auto-ready-semantic-audit'
import { SUPPLY_DAILY_USD_APPROVED } from '../../src/lib/supply-schedule-contract'
import {
  judgeSlotRelease, matchOpportunitiesToSlots, publishEventAtOf, readSourceEvidence, releaseStampStatusOf,
  type SlotOpportunity,
} from '../../src/lib/source-slot-release'
import {
  OPPORTUNITY_FILE_RE, WORKSET_FILE_RE, readOpportunitySnapshot, readSupplyIntent, readWorkset,
  type SupplyIntent,
} from '../../src/lib/supply-workset'
import { claimsJitContract, intentLinkIssue, type IntentLinkIssue } from '../../src/lib/supply-intent'
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
 * 🔴 **단가 · 수율 · 지연을 모으는 날 수** — 증거일 포함 최근 3일(PR3 KEEP). 파일이 없는 날은 빈 날이다.
 *    🔴 예약액으로 추정하지 않는다 — 정산된 것만 모은다.
 */
export const UNIT_COST_DAYS = 3

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
 * 🔴 **창 안 JIT 계약 묶음(`workset-v3`)의 원천 수 — 하나라도 못 읽으면 `null`(모름)** (2026-10-04 P0-2 · 보정).
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
  for (const f of readdirSync(dataDir)) {
    const m = WORKSET_FILE_RE.exec(f)
    if (m === null) continue
    const at = runMsOf(m[1]!)
    if (at === null || at < fromMs || at >= toMs) continue
    try {
      // 🔴 정본 판독기(`readWorkset`)가 센다 — 두 번째 파서를 두지 않는다
      const r = readWorkset(JSON.parse(readFileSync(join(dataDir, f), 'utf-8')), m[1]!)
      if (!r.ok) return null
      if (r.intents === null) continue
      n += r.count; files += 1
      byRun.set(m[1]!, byHash(r.intents))
    } catch { return null }
  }
  return files === 0 ? null : { sources: n, byRun }
}


/**
 * 🔴 **가장 최근 공급 기회 스냅샷** — 초안이 아직 없는 slot-valid 원천(생성 전 판정 eligible)의 증거 기록.
 *    없으면 빈 목록(기회 0 — 모름이 아니다: 공급이 아직 안 돌았으면 READY 로만 센다). 손상이면 `evidence: null`(모름).
 */
export function latestOpportunities(dataDir: string, nowMs: number): { evidence: unknown[] | null; takenAt: string | null } {
  if (!existsSync(dataDir)) return { evidence: [], takenAt: null }
  const files = readdirSync(dataDir).filter((f) => OPPORTUNITY_FILE_RE.test(f)).sort()
  for (const f of files.reverse()) {
    let snap: ReturnType<typeof readOpportunitySnapshot>
    try { snap = readOpportunitySnapshot(JSON.parse(readFileSync(join(dataDir, f), 'utf-8'))) } catch { snap = null }
    // 🔴 가장 최근 스냅샷이 손상이면 모른다 — 더 오래된 스냅샷으로 조용히 내려가지 않는다(2026-10-04 P0-2)
    if (snap === null) return { evidence: null, takenAt: null }
    if (Date.parse(snap.takenAt) > nowMs) continue
    return { evidence: snap.evidence, takenAt: snap.takenAt }
  }
  return { evidence: [], takenAt: null }
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
  worksetSources: number | null; yieldBounds: { low: number; high: number } | null; notes: string[]
  /** 🔴 현재 계약을 주장했지만 묶음 · 증거와 맞지 않은 행의 이유 코드 — 하나라도 있으면 cohort 전체가 모름 */
  intentMismatches: IntentLinkIssue[]
  /**
   * 🔴 **이 cohort 의 회차 집합** — 같은 창 `workset-v3` 색인의 회차 id. 🔴 불변식: 큐 결과(분자) · `worksetSources`(분모) ·
   *    현재 계약 비용(`costAttributionOf` 의 `cohortRuns`)이 **이 집합 하나**에서 나온다. 창 밖 회차는 셋 다에서 빠진다.
   */
  cohortRuns: ReadonlySet<string>
}> {
  const notes: string[] = []
  let rows: CohortRow[] | null = null
  let legacyExcluded: number | null = null
  const intentMismatches: IntentLinkIssue[] = []
  const ws = jitWorksetsIn(i.dataDir, i.windowFrom.getTime(), i.windowTo.getTime())
  const worksetSources = ws?.sources ?? null
  try {
    /**
     * 🔴 **cohort 시계는 공급 회차 하나다** (2026-10-09 P0). 분모(묶음 원천) · 분자(READY) · 비용(장부)이 **같은 회차 집합**
     *    (`cohortRuns` = 창 안 `workset-v3` 회차)을 쓴다. 앞판은 분자만 자동 도장 시각(`decidedAt`) 창으로 잘랐다 —
     *    발행 러너는 22:00 뒤 08:00 까지 돌지 않아 **22:15 회차 결과가 매일 분모에만 들고 분자에서 빠졌다**
     *    (2026-10-09 07:00 실측: 원천 101 · READY 16 → 공급 능력 9. 회차 기준이면 READY 20 → 11).
     *    🔴 행은 적재 시각이 창 시작 이후인 것만 후보로 읽는다 — 회차 시작 ≥ 창 시작이고 적재는 회차 뒤다(이월 적재 포함).
     *    소속은 시각이 아니라 `supplyIntent.runId ∈ cohortRuns` 가 정한다. 창 밖 회차 행은 **제외**다(불일치가 아니다).
     */
    const found = await prisma.originalPostApprovalQueue.findMany({
      where: { createdAt: { gte: i.windowFrom } },
      select: { id: true, status: true, gateResults: true, decidedBy: true, createdPostId: true },
    })
    /**
     * 🔴 **자동 READY 경로 행만** — 자동 도장(`AUTO_DECIDER`) 행, 그리고 **자동 도장 전 기계 적재 행**
     *    (`machine:` · APPROVED · 미발행). 도장 전 행은 성공으로 확정하지 않는다 — 결말 모름(unknown)이다.
     *    사람이 결정한 행은 자동 READY 가 아니다(세지 않는다).
     */
    const autoPath = found.filter((r) => r.decidedBy === AUTO_DECIDER
      || ((r.decidedBy ?? '').startsWith('machine:') && r.status === 'APPROVED' && r.createdPostId === null))
    /**
     * 🔴 **현재 JIT 계약 행만** (2026-10-04 P0-2 보정 · 최종) — 계약을 주장한 행은 모양만 보고 인정하지 않는다:
     *    그 회차 `workset-v3`(정본 판독기) 의 같은 원천 의도 · 원문 증거 해시와 **정확히** 같아야 한다.
     *    하나라도 다르면 legacy 로 빼지 않고 cohort 전체를 모름으로 닫는다. 주장하지 않는 옛 READY 는 수만 보고한다.
     */
    const claimed = autoPath.filter((r) => claimsJitContract(r.gateResults))
    legacyExcluded = autoPath.length - claimed.length
    // 🔴 창 밖 회차 행은 이 cohort 가 아니다 — 의도를 읽을 수 없는 행은 소속을 모르므로 불일치로 닫는다
    const current = claimed.filter((r) => {
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
      })
      if (issue !== null) intentMismatches.push(issue)
    }
    if (intentMismatches.length > 0) throw new IntentMismatch()
    rows = current.map((r) => {
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
  if (worksetSources === null) notes.push('JIT 묶음 원천 수를 모른다 — 창 안 workset-v3 이 없거나 묶음 하나라도 손상')
  if (legacyExcluded !== null && legacyExcluded > 0) notes.push(`계약 표식 없는 옛 자동 READY ${legacyExcluded}건 — 근거로 세지 않는다(구제 없음)`)
  if (fates !== null && fates.unknown > 0) notes.push(`결말을 모르는 자동 READY ${fates.unknown}건 — 손실률 · 수율은 구간으로만 판정한다`)
  return {
    rows, fates, readyCount, legacyExcluded, worksetSources,
    yieldBounds: fates === null ? null : terminalYieldOf(fates, worksetSources), notes, intentMismatches,
    cohortRuns: new Set(ws?.byRun.keys() ?? []),
  }
}

/**
 * 🔴 **preflight 사실을 모은다.** `evidenceDate` 는 전날(증거일) — 단가 · 수율 · 지연은 그날까지 최근 3일.
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

  // 기회(READY) — 자동 · 열림. 증명일 슬롯 짝짓기는 커버리지와 대기 결말 분류가 **같은 호출**을 쓴다
  const readyOpps = i.autoOpen.open
    ? readyOpportunitiesOf(i.loaded, { caps: i.caps, now: i.now, autoOnly: true }) : []
  if (!i.autoOpen.open) notes.push(`자동 READY 닫힘 — ${i.autoOpen.reasons.join(' · ') || '이유 없음'} (READY 기회 0 · 대기는 예정 슬롯에 걸리지 않는다)`)
  const matchedReady = new Set(matchOpportunitiesToSlots(i.proofSlots, readyOpps).bySlot.filter((k): k is string => k !== null))

  // READY cohort — 공급 러너와 같은 판독(`readReadyCohort`)
  const cohort = await readReadyCohort(prisma, {
    windowFrom, windowTo, dataDir: i.dataDir, matched: matchedReady, horizon: i.proofSlots, now: i.now,
  })
  notes.push(...cohort.notes)
  const { rows, fates, readyCount, worksetSources, yieldBounds } = cohort

  // 기회 — READY + 원천 스냅샷(결말 수율로 할인 · 구간이면 두 끝을 합친다)
  const snap = latestOpportunities(i.dataDir, i.now.getTime())
  if (snap.evidence === null) notes.push('가장 최근 원천 기회 스냅샷이 손상됐다 — 증명일 기회를 모른다')
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

  // 지연 — 지금 계약 도장으로 나간 글 · 원천 게시 → 공개
  let latencyP50H: number | null = null
  let latencyP90H: number | null = null
  try {
    const lat = await publishLatencyHours(prisma, windowFrom, windowTo)
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
  const lastDay = dates[dates.length - 1] ?? i.evidenceDate
  const spillDay = new Date(Date.parse(`${lastDay}T00:00:00Z`) + 864e5).toISOString().slice(0, 10)
  const supplyEntries = pooledEntries([...dates, spillDay].map((d) => readDay(defaultLedgerDir(), d)))
  if (supplyEntries === null) notes.push('공급 장부가 손상됐다 — 공급 비용을 모른다')
  const fateByKey = new Map<string, CostFate>()
  for (const r of rows ?? []) if (r.hash !== null) fateByKey.set(r.hash, costFateOf(r))
  const costAttribution: CostAttribution | null = rows === null || fates === null ? null
    : costAttributionOf({ entries: supplyEntries, fateByKey, counts: fates, cohortRuns: cohort.cohortRuns })
  if (costAttribution !== null && costAttribution.usdPerSlotValidResult === null) {
    notes.push(`slot-valid 결과당 비용을 모른다 — legacy 정산 $${costAttribution.legacyUsd.toFixed(4)}`
      + ` · 원천 미연결 $${costAttribution.unlinkedUsd.toFixed(4)} · 미정산 ${costAttribution.openRequests}건`
      + ` (상한 없음 ${costAttribution.openUnbounded}건) · 현재 정산 $${costAttribution.totalUsd.toFixed(4)}`)
  } else if (costAttribution !== null && costAttribution.openRequests > 0) {
    notes.push(`🔴 공급 비용은 상한이다 — 미정산 ${costAttribution.openRequests}건을 예약 상한 $${costAttribution.openReservedUsd.toFixed(4)} 로 넣었다`
      + ' (장부 상태는 그대로 · 사람 마감은 별도)')
  }
  const readyCohort: ReadyCohortFact | null = fates === null || worksetSources === null ? null
    : { sources: worksetSources, ...fates, usdPerSlotValidResult: costAttribution?.usdPerSlotValidResult ?? null }

  const facts: PreflightFacts = {
    slotValidOpportunities,
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
      readyFilled: opp.readyFilled, sourceFilled: opp.sourceFilled, sourceOpportunities: sourceOpps.length,
      sourceValid: opp.sourceValid, sourceExpected: opp.sourceExpected, sourceExpectedHigh: oppHigh.sourceExpected,
      opportunitySnapshotAt: snap.takenAt, readyCount, legacyExcluded: cohort.legacyExcluded, worksetSources, yieldBounds, fates,
      intentMismatches: cohort.intentMismatches,
      costAttribution,
    },
  }
}
