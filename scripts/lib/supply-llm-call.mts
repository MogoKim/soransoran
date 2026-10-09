/**
 * 🔴 **공급의 모든 provider 요청이 지나가는 한 자리** (2026-09-17).
 *
 * 🔴 **무엇을 하는가**
 *    ① 보내기 전에 공식 `count_tokens` 로 입력 토큰을 **계산**한다 (무료)
 *    ② 그 값과 `max_tokens` 로 **예약액**을 내고, 오늘 남은 여력과 대조한다
 *    ③ 모자라거나 모르면 **요청을 보내지 않는다** — fetch 가 나가지 않는다
 *    ④ 보냈으면 응답의 `usage` 로 **정산**한다. 사용량을 모르면 예약을 풀지 않는다
 *
 * 🔴 **무엇을 하지 않는가 — "오늘 과금이 한도를 넘지 않는다" 는 보장.**
 *    ① `count_tokens` 는 공식 문서가 **estimate** 라고 적은 값이다
 *    ② 이미 보낸 요청의 과금은 취소할 수 없다
 *    ③ 이 장부는 **로컬 공급 회차**만 센다 — 다른 경로의 호출은 보이지 않는다
 *    그래서 이것을 `요청 전 차단`이라고 부른다. `예산 초과 방지`라고 쓰지 않는다.
 *
 * 🔴 **예산 금액을 코드가 정하지 않는다.** env 가 없으면 `null` 이고, 그러면 보류다.
 *    "일단 이 정도" 를 기본값으로 넣으면 아무도 정하지 않은 숫자가 운영값이 된다.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  classifyReservations, judgeSettle, judgeSpend, ledgerDateOf, previousLedgerDate, runPaidCountOf, tallyOf,
  type BlockCode, type BudgetEnvSource, type BudgetLimits, type LedgerEntry, type LedgerStage,
  type OpenReservation, type SpendProtect,
} from '../../src/lib/llm-ledger'
import {
  SCHEDULED_COST_LOOKBACK_DAYS, missingTodayLedgerVerdict, supplySpendProtectAt, type SupplyRunKind,
} from '../../src/lib/supply-scheduled-reserve'
import { PRICING_VERSION, costOf, reserveOf } from '../../src/lib/llm-pricing'
import {
  addOpenReservation, appendLedgerLine, canonicalLedgerDir, clearOpenReservation, defaultLedgerDir, ledgerPathOf,
  openReservationsPathOf, pidAlive, readLedgerDay, readLedgerRun, readOpenReservations,
  readSettleHold, sameRealDir, settleHoldPathOf, supplyLedgerDirError, withLedgerLock,
  type LedgerRead, type OpenRead, type SettleHold,
} from './llm-ledger-store.mjs'
import {
  callProvider, countInputTokens, type LlmResponse, type ProviderModel,
} from './voice-m3-provider.mjs'
import { writeSettleHold } from './llm-ledger-store.mjs'
import { buildMessage, send } from './slack-notify.mjs'
import { apiModelIdFor } from './voice-m3-contract.mjs'
import { runClockFrom } from './run-clock.mjs'

/** 🔴 차단된 요청이 돌려주는 오류 코드 머리 — 호출부가 provider 오류와 구분할 수 있게 한다 */
export const LEDGER_BLOCKED = 'LEDGER_BLOCKED'

/** env 이름. 🔴 값이 아니라 이름이다 */
export const BUDGET_ENV = {
  dailyUsd: 'SORAN_LLM_DAILY_BUDGET_USD',
  runRequestCap: 'SORAN_LLM_RUN_REQUEST_CAP',
  headroomMultiplier: 'SORAN_LLM_RESERVE_HEADROOM',
} as const

function numEnv(env: NodeJS.ProcessEnv, name: string, opts: { integer?: boolean } = {}): number | null {
  const raw = (env[name] ?? '').trim()
  if (raw === '') return null
  const n = Number(raw)
  // 🔴 읽을 수 없는 값을 0 으로 읽지 않는다. 모르면 null 이고, null 이면 보류다
  if (!Number.isFinite(n) || n <= 0) return null
  // 🔴 요청 **수** 상한에 2.5 같은 값이 오면 잘못 쓴 것이다 — 반올림해 넘기지 않는다
  if (opts.integer === true && !Number.isInteger(n)) return null
  return n
}

/**
 * 🔴 **예산은 전부 env 에서 온다. 기본값이 없다.**
 *    하나라도 비어 있으면 그 회차의 유료 요청은 보류된다 — 사람이 정하기 전까지 안 나간다.
 */
export function limitsFromEnv(env: NodeJS.ProcessEnv): BudgetLimits {
  return {
    dailyUsd: numEnv(env, BUDGET_ENV.dailyUsd),
    runRequestCap: numEnv(env, BUDGET_ENV.runRequestCap, { integer: true }),
    headroomMultiplier: numEnv(env, BUDGET_ENV.headroomMultiplier),
  }
}

/**
 * 🔴 **비어 있는 예산 env 의 이름**을 돌려준다 (2026-09-21).
 *
 *    하나라도 비면 그 회차는 **부르기 전에** 멈춰야 한다 — 호출부가
 *    이 목록이 비었는지만 보고 판단한다. 🔴 **값이 아니라 이름만** 돌려준다.
 *
 *    호출부에 흩어져 있던 `=== null` 세 줄을 여기 하나로 모은 이유는,
 *    그 자리에서는 지우거나 뒤집어도 아무 시험이 걸리지 않았기 때문이다.
 */
export function missingBudgetEnvNames(limits: BudgetLimits): string[] {
  const names: string[] = []
  if (limits.dailyUsd === null) names.push(BUDGET_ENV.dailyUsd)
  if (limits.runRequestCap === null) names.push(BUDGET_ENV.runRequestCap)
  if (limits.headroomMultiplier === null) names.push(BUDGET_ENV.headroomMultiplier)
  return names
}

/**
 * 🔴 **예산 env 값의 출처** (2026-09-30) — 순수 함수. `.env.local` 본문을 **받는다**.
 *
 *    `loadEnvLocal` 은 이미 있는 `process.env` 를 덮지 않는다. 그래서 셸에서
 *    `SORAN_LLM_DAILY_BUDGET_USD=5 npx tsx …` 로 띄우면 `.env.local` 의 0.50 이 아니라 5 가 쓰인다 —
 *    2026-09-28 손 실행 9회가 그 길로 예산을 넘겼다(A4 진단 §3). 공급 장부의 판정은 이제
 *    min(env, 계약 천장)이라 덮어써도 천장을 못 넘지만, **덮어썼다는 사실**은 사람이 봐야 한다.
 *    이 함수는 키마다 출처를 가르고, `.env.local` 과 다른 값이면 `overrides` 에 담는다(값은 예산 숫자뿐이다).
 *
 *    `envLocalText === null` — `.env.local` 이 없다(→ 있는 값은 `process`). `undefined` — 읽지 못했다(→ `unknown`).
 */
export function budgetEnvProvenance(
  env: Readonly<Record<string, string | undefined>>, envLocalText: string | null | undefined,
): { sources: Record<keyof typeof BUDGET_ENV, BudgetEnvSource>; overrides: { name: string; envLocal: string; process: string }[] } {
  const fileVals = new Map<string, string>()
  if (typeof envLocalText === 'string') {
    // 🔴 `loadEnvLocal`(micro-seed-time) 과 같은 규칙으로 읽는다 — 다른 규칙이면 "다르다" 가 거짓이 된다
    for (const line of envLocalText.split('\n')) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
      if (m === null) continue
      let v = (m[2] ?? '').trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      fileVals.set(m[1] ?? '', v)
    }
  }
  const same = (a: string, b: string): boolean => {
    const x = Number(a.trim())
    const y = Number(b.trim())
    return a.trim() === b.trim() || (a.trim() !== '' && b.trim() !== '' && Number.isFinite(x) && x === y)
  }
  const sources = {} as Record<keyof typeof BUDGET_ENV, BudgetEnvSource>
  const overrides: { name: string; envLocal: string; process: string }[] = []
  for (const key of Object.keys(BUDGET_ENV) as (keyof typeof BUDGET_ENV)[]) {
    const name = BUDGET_ENV[key]
    const pv = env[name]
    const fv = fileVals.get(name)
    if (pv === undefined || pv.trim() === '') sources[key] = 'missing'
    else if (envLocalText === undefined) sources[key] = 'unknown'
    else if (fv === undefined) sources[key] = 'process'
    else if (same(fv, pv)) sources[key] = 'env.local'
    else {
      sources[key] = 'process-override'
      overrides.push({ name, envLocal: fv, process: pv })
    }
  }
  return { sources, overrides }
}

/** `.env.local` 본문 — 없으면 `null`, 읽지 못하면 `undefined` */
function readEnvLocalText(path: string): string | null | undefined {
  if (!existsSync(path)) return null
  try { return readFileSync(path, 'utf-8') } catch { return undefined }
}

/**
 * 🔴 **시험 격리 표식** (2026-09-30) — 가짜 provider 프로세스만 건다.
 *
 *    공급 세션은 장부 자리가 정본(`canonicalLedgerDir`, 계정 홈)과 실경로로 같아야 요청을 보낸다.
 *    러너를 띄우는 시험은 임시 HOME 장부를 써야 운영 장부를 건드리지 않는다 — 그 시험만 이 표식을 건다.
 *    · 거는 곳: `scripts/lib/fake-provider-hook.mjs`(맨 위, `fetch` 를 가짜로 바꾸는 같은 파일) ·
 *      in-process 검사(`supply:reserve-check`)는 `fetch` 를 가짜로 바꾼 뒤 직접 건다.
 *    · 🔴 이 표식이 걸린 프로세스는 **실제 provider 로 나갈 수 없다**(fetch 가 가짜다). 운영 CLI·lib 는
 *      이 이름을 쓰지 않는다 — `supply:ledger-check` 가 저장소 전체를 훑어 확인한다.
 *    · env 가 아니다 — env 는 셸 한 줄로 넣을 수 있다. 이 표식은 코드(`--import`)로만 걸린다.
 */
export const SUPPLY_LEDGER_ISOLATION_MARK: unique symbol = Symbol.for('soransoran.test.fake-provider-ledger-isolation')

export function ledgerIsolationActive(): boolean {
  return (globalThis as unknown as Record<symbol, unknown>)[SUPPLY_LEDGER_ISOLATION_MARK] === true
}

/**
 * 🔴 **장부 입출력.** 운영은 기본 저장소를 쓰고, 시험이 실패를 주입한다.
 *
 *    이 저장소가 이미 쓰는 방식(`beforeStage` · `exec` 주입)과 같다.
 *    실제 디스크를 망가뜨려 "정산만 실패" 를 만들 방법이 없어서 이 자리를 둔다 —
 *    🔴 **기본값이 진짜 저장소**이고, fixture 가 그것을 확인한다.
 */
export type LedgerIo = {
  withLock: <T>(dir: string, fn: () => T) => T
  readDay: (path: string) => LedgerRead
  readRun: (dir: string, date: string, runId: string) => LedgerRead
  append: (path: string, entry: LedgerEntry) => void
  readHold: (dir: string) => string | null
  writeHold: (dir: string, hold: SettleHold) => void
  /** 🔴 요청 **전에** 남는 예약 목록 — 사후 표식이 실패해도 이것이 남는다 */
  readOpen: (dir: string) => OpenRead
  addOpen: (dir: string, r: OpenReservation) => void
  clearOpen: (dir: string, attemptId: string) => void
  pidAlive: (pid: number) => boolean
  /** 🔴 장부 파일이 있는가 — 공급 장부의 "오늘 파일 없음" 판정. 없으면 `existsSync` */
  exists?: (path: string) => boolean
}

export const REAL_LEDGER_IO: LedgerIo = {
  withLock: withLedgerLock,
  readDay: readLedgerDay,
  readRun: readLedgerRun,
  append: appendLedgerLine,
  readHold: readSettleHold,
  writeHold: writeSettleHold,
  readOpen: readOpenReservations,
  addOpen: addOpenReservation,
  clearOpen: clearOpenReservation,
  pidAlive,
  exists: existsSync,
}

export type SupplyCallInput = {
  stage: LedgerStage
  model: ProviderModel
  systemPrompt: string
  userPayload: string
  maxOutputTokens: number
  timeoutMs: number
  /** 🔴 원천 해시(`articleIdHashOf`) — 장부 줄의 `sourceKey`. 원천 밖 요청은 비운다 */
  sourceKey?: string | null
  /** 🔴 JIT 공급 계약 표식 — 그 회차 `workset-v3` 묶음 안 원천일 때만. 장부 줄의 `supplyContract` */
  supplyContract?: string | null
}

export type SupplySessionConfig = {
  runId: string
  /**
   * 장부 디렉터리. 🔴 시험·다른 장부(댓글 루프 · 사후 감사)는 자기 자리를 준다.
   *    비우거나 공급 장부 자리(실경로 비교)를 주면 **공급 장부**다 — 보호·정본 확인·오늘 파일 판정이 켜진다.
   */
  dir?: string
  limits: BudgetLimits
  now?: () => Date
  /** 🔴 시험 전용 주입. 운영은 비워 두고 기본 저장소를 쓴다 */
  io?: LedgerIo
  /**
   * 🔴 **정기 회차 몫 보호** (2026-09-29) — 요청마다 판정 시각으로 부른다.
   *
   *    🔴 **공급 장부(기본 디렉터리)에서는 이 칸을 보지 않는다.** 그 장부는 언제나
   *       `supplyProtectFromEnv` 를 쓴다 — 호출부가 끄거나 바꿀 수 있으면 그것이 우회로다.
   *    다른 디렉터리(댓글 루프 · 사후 감사 · 시험 임시 장부)는 이 칸이 없으면 보호 없음이다.
   */
  protectAt?: (now: Date, ctx: ProtectContext) => ProtectDecision
  /** 예산 출처를 가를 `.env.local` — 없으면 `cwd/.env.local`(`loadEnvLocal` 과 같은 자리). 🔴 시험 전용 */
  envLocalPath?: string
  /**
   * 🔴 **사용량 미상 알림** (2026-10-09 P0) — 없으면 공급 장부는 D100 운영 알림(`slack-notify`)으로 보내고,
   *    다른 장부(댓글 루프 · 사후 감사 · 시험)는 보내지 않는다. 🔴 시험은 여기에 가짜를 준다.
   */
  notify?: UsageUnknownNotify
}

/**
 * 🔴 **사용량 미상 알림 내용 — 회차 · 단계 · 건수 · 추정 예약액만** (2026-10-09 P0).
 *    payload · 원문 · 원천 해시 · 비밀 · 사용자 식별자 칸이 없다.
 *    앞판은 회차 로그의 개수 한 줄뿐이었다 — 2026-10-08 미상 2건이 아무 알림 없이 다음 날 D10 판정을 막았다.
 */
export type UsageUnknownAlert = {
  runId: string
  stage: LedgerStage
  /** 이 회차에서 지금까지 생긴 사용량 미상 건수 */
  count: number
  /** 이번 건의 추정 예약액(USD) — 실제 비용이 아니다 · 모르면 null */
  reservedUsd: number | null
  /** 이 회차 미상 건 추정 예약액 합(USD) — 실제 비용이 아니다 */
  reservedTotalUsd: number
}
export type UsageUnknownNotify = (a: UsageUnknownAlert) => Promise<unknown>

export function usageUnknownAlertMessage(a: UsageUnknownAlert): { severity: 'WARN'; title: string; reason: string; next: string } {
  const usd = (v: number | null): string => (v === null ? '모름' : `$${v.toFixed(4)}`)
  return {
    severity: 'WARN',
    title: '공급 장부 — 제공사 사용량 미상(미정산)',
    reason: `회차 ${a.runId} · 단계 ${a.stage} · 이 회차 미상 ${a.count}건 · 이번 추정 예약액 ${usd(a.reservedUsd)}`
      + ` · 회차 추정 예약액 합 ${usd(a.reservedTotalUsd)} (실제 비용 아님) — 이 회차가 든 cohort 의 승급 공급 비용은 UNKNOWN 이다`,
    next: '실제 금액을 확인해 `npm run supply:ledger-resolve` 로 마감하거나, 이 회차가 3일 cohort 창을 벗어나야 공급 비용 판정이 풀린다',
  }
}

/** 🔴 운영 알림 경로 — `slack-notify.send` 는 어떤 경우에도 throw 하지 않는다 */
export const SLACK_USAGE_UNKNOWN_NOTIFY: UsageUnknownNotify = (a) =>
  send(buildMessage({ ...usageUnknownAlertMessage(a), logPath: undefined }), { dryRun: false })

/**
 * 보호 판정 한 건. `protect` 가 `null` 이면 보호 없음(공급 장부 밖의 시험·다른 장부 전용).
 * 🔴 `slot` 은 정기 회차의 슬롯 이름 — 장부 줄의 `runSlot` 으로 남아 다음 날의 실측이 된다.
 */
export type ProtectDecision = { kind: SupplyRunKind; why: string; slot?: string | null; protect: SpendProtect | null }

/**
 * 🔴 **보호 판정이 받는 장부 문맥** — 전부 **잠금 안에서** 읽은 것이다.
 *    `historyEntries` 는 어제까지 `SCHEDULED_COST_LOOKBACK_DAYS` 일 줄이고, 못 읽었으면 `null` 이다.
 */
export type ProtectContext = {
  todayEntries: readonly LedgerEntry[]
  historyEntries: readonly LedgerEntry[] | null
  dailyUsd: number | null
  /** 🔴 이 세션을 만든 벽시계 시각 — 회차 시작 시각(잠·늦은 복귀 규칙)의 한쪽 근거 */
  sessionStartedAt: Date
}

/**
 * 🔴 **회차 시작 시각** (2026-09-29 3차) — min(부모 `SORAN_RUN_AT`, 세션 생성 시각).
 *
 *    부모(`supply-process`)가 자식에게 넘긴 회차 시각이 있으면 그것도 본다 — 08:15 에 시작한 부모가
 *    잠들었다 12:17 에 깨어 **새로 띄운** 초안 자식은 세션 생성이 12:18 이라, 세션 시각만 보면 12:15 창
 *    안으로 보인다. 둘 중 **이른 것**을 쓰므로 `SORAN_RUN_AT` 은 판정을 더 엄격하게만 만든다.
 *    🔴 값이 있는데 모양이 틀리면 `null`(모름) → 정기로 인정하지 않는다.
 */
export function runStartedAtOf(env: NodeJS.ProcessEnv, sessionStartedAt: Date): Date | null {
  let parent: Date | null
  try {
    const c = runClockFrom(env)
    parent = c.from === 'parent' ? c.at : null
  } catch {
    return null
  }
  if (!Number.isFinite(sessionStartedAt.getTime())) return null
  return parent !== null && parent.getTime() < sessionStartedAt.getTime() ? parent : sessionStartedAt
}

/**
 * 🔴 **공급 장부의 보호 판정 — 운영 경로는 이것 하나다.**
 *    정기 여부는 launchd 가 넣은 `XPC_SERVICE_NAME` 과 **벽시계**로만 정한다(정본 `supply-scheduled-reserve`).
 *    슬롯 몫은 장부의 최근 정기 회차 실측에서 온다(표본이 모자라면 보수 기본값).
 */
export function supplyProtectFromEnv(env: NodeJS.ProcessEnv): (now: Date, ctx: ProtectContext) => ProtectDecision {
  return (now, ctx) => {
    const seam = SUPPLY_PROTECT_TEST_SEAM.clock
    const t = seam?.() ?? now
    return supplySpendProtectAt({
      env, now: t,
      todayEntries: ctx.todayEntries, historyEntries: ctx.historyEntries, dailyUsd: ctx.dailyUsd,
      // 🔴 시험 이음매가 걸리면 시작 시각도 그 시각이다(가짜 provider 프로세스 전용 — 아래 주석)
      runStartedAt: seam === null ? runStartedAtOf(env, ctx.sessionStartedAt) : t,
    })
  }
}

/**
 * 🔴 **시험 전용 이음매 — 보호 판정의 벽시계만** 바꾼다. 운영은 `null`(진짜 시계)이다.
 *
 *    정기 슬롯 창은 벽시계로 판정한다. 러너를 띄우는 시험은 그 시각을 고르지 못하면
 *    하루 중 언제 돌리느냐에 따라 결과가 달라진다. 그래서 `fake-provider-hook` 만 이 칸을 건다
 *    (`FAKE_SUPPLY_PROTECT_NOW`). 🔴 그 훅은 provider 를 가짜로 바꾼다 — 이 칸이 걸린 프로세스는
 *    **실제 유료 요청을 보낼 수 없다.** 운영 경로는 그 훅을 import 하지 않는다.
 *    🔴 실행 종류(라벨)는 바꾸지 않는다 — 라벨은 여전히 진짜 env 에서 온다.
 *    🔴 이 칸이 걸리면 회차 시작 시각도 같은 고정 시각으로 본다 — 부모가 넘긴 진짜 `SORAN_RUN_AT` 과
 *       고정 시각이 창이 달라 모든 fixture 가 손 실행이 되는 것을 막는다. 잠·늦은 복귀 규칙은
 *       이 칸 없이 `supply:reserve-check` 가 세션으로 본다.
 */
export const SUPPLY_PROTECT_TEST_SEAM: { clock: (() => Date) | null } = { clock: null }

/** 회차 집계 — 🔴 사전 계산과 유료 요청을 **따로** 센다 */
export type SessionTally = {
  paid: number
  blocked: number
  countTokens: number
  reservedUsd: number
  settledUsd: number
  usageUnknown: number
  overruns: number
  /** 🔴 정산을 못 적어 보류를 건 횟수 */
  settleHeld: number
  /** 🔴 보류 표식조차 못 쓴 횟수 — 다음 회차가 이 보류를 못 본다 */
  holdWriteFailed: number
  blockedBy: Map<BlockCode, number>
}

/** 요청을 보내지 않았을 때 돌려주는 응답 — 🔴 provider 실패와 같은 모양이라 호출부가 안 바뀐다 */
function blockedResponse(code: BlockCode, reason: string): LlmResponse {
  return {
    ok: false, rawText: '',
    inputTokens: 0, outputTokens: 0,
    finishReason: '', reasoningTokens: null, responseChars: 0, maxTokensReached: false,
    // 🔴 보내지 않았으므로 사용량은 "모름" 이 아니라 **없음**이다. 그래도 0 을 값으로
    //    읽히게 두지 않는다 — 이 건은 장부에서 blocked 로 따로 세어진다
    usageKnown: false, cacheWriteTokens: null, cacheReadTokens: null, usageKeys: [],
    errorCode: `${LEDGER_BLOCKED}:${code}`,
    errorMessage: reason,
  }
}

/** 🔴 정산 줄을 적지 못한 건의 원인 코드 — 부르는 쪽이 이것으로 완주 실패를 읽는다 */
export const SETTLE_NOT_RECORDED = 'SETTLE_NOT_RECORDED'

/**
 * 🔴 **응답 + 정산 기록 여부.** 둘을 한 값으로 돌려준다 —
 *    "provider 는 성공했는데 장부에는 안 적혔다" 를 부르는 쪽이 못 보면 안 된다.
 */
export type SupplyCallResult = LlmResponse & {
  settledUsd: number | null
  /** 🔴 정산 줄이 장부에 실제로 적혔는가. `false` 면 그 단계는 완주가 아니다 */
  settlementRecorded: boolean
}

export class SupplyLlmSession {
  readonly runId: string
  readonly dir: string
  readonly limits: BudgetLimits
  private readonly now: () => Date
  private readonly io: LedgerIo
  private readonly notify: UsageUnknownNotify | null
  /** 🔴 이 세션의 사용량 미상 추정 예약액 합 — 알림에만 쓴다(실제 비용 아님) */
  private unknownReservedUsd = 0
  /**
   * 🔴 **공급 장부인가** — 정본 자리(계정 홈) 또는 이 프로세스 `$HOME` 의 공급 장부 자리와 **실경로로** 같으면 참.
   *    참이면 ① 호출부 보호 설정을 보지 않고 ② 자리가 정본인지 요청마다 확인하고 ③ 오늘 파일 없음을 판정하고
   *    ④ 적용 한도·출처를 줄에 남긴다. 댓글 루프·사후 감사·시험 임시 장부(다른 자리)는 거짓이다.
   */
  readonly supply: boolean
  /** 🔴 예산 env 출처 — 공급 장부만. 덮어쓴 키가 있으면 세션을 만들 때 한 번 경고한다 */
  readonly budgetEnv: ReturnType<typeof budgetEnvProvenance> | null
  /** 🔴 정기 회차 몫 보호 — 공급 장부면 언제나 켜져 있다 */
  private readonly protectAt: ((now: Date, ctx: ProtectContext) => ProtectDecision) | null
  /**
   * 🔴 **지난 날 장부 캐시** — 정기 실측을 모으려고 읽은 어제 이전 파일. 세션 동안 한 번만 읽는다.
   *    오늘 파일은 캐시하지 않는다 — 요청마다 잠금 안에서 새로 읽은 것을 쓴다.
   */
  private readonly pastDays = new Map<string, LedgerRead>()
  /** 🔴 세션을 만든 벽시계 시각 — 회차 시작 시각의 근거(잠·늦은 복귀 규칙) */
  private readonly createdAt: Date
  /** 마지막 판정의 실행 종류 — 사람이 읽는 줄에만 쓴다 */
  private lastKind: ProtectDecision | null = null
  /** 🔴 이 세션의 표식 — pid 가 재사용돼도 갈린다 */
  private readonly sessionId = randomUUID()
  /**
   * 🔴 **정산을 못 적은 순간부터 이 회차의 유료 요청을 멈춘다.**
   *    파일 표식(`settleHoldPathOf`)과 **둘 다** 둔다 — 파일은 재시작을 넘고,
   *    이 플래그는 파일 쓰기마저 실패한 경우에 이 프로세스 안에서라도 막는다.
   */
  private settleFailed: string | null = null
  private readonly t: SessionTally = {
    paid: 0, blocked: 0, countTokens: 0,
    reservedUsd: 0, settledUsd: 0, usageUnknown: 0, overruns: 0,
    settleHeld: 0, holdWriteFailed: 0,
    blockedBy: new Map(),
  }

  constructor(cfg: SupplySessionConfig) {
    this.runId = cfg.runId
    this.dir = cfg.dir ?? defaultLedgerDir()
    this.limits = cfg.limits
    this.now = cfg.now ?? (() => new Date())
    this.createdAt = this.now()
    this.io = cfg.io ?? REAL_LEDGER_IO
    /**
     * 🔴 **공급 장부면 호출부 설정을 보지 않는다.** 판정·초안·댓글 CLI 가 모두 이 장부를 쓴다 —
     *    어느 하나가 보호를 끄는 칸을 가지면 손 실행이 정기 몫을 먹는 길이 다시 열린다.
     *
     * 🔴 **실경로로 비교한다** (2026-09-30). 앞판은 `this.dir === defaultLedgerDir()` 문자열 비교였다 —
     *    끝 `/` 하나, 심볼릭 경로 하나로 거짓이 되어 보호가 꺼지고(`cfg.protectAt ?? null` → 천장 없음)
     *    env 예산만 남았다. 그 비교는 지웠다. 이제 정본(계정 홈) 자리와 이 프로세스 `$HOME` 자리 둘 다와
     *    **실경로**로 대조한다 — 어느 쪽과 같아도 공급 장부이고, 보호는 끌 수 없다.
     */
    const canonical = canonicalLedgerDir()
    this.supply = cfg.dir === undefined
      || sameRealDir(this.dir, defaultLedgerDir())
      || (canonical !== null && sameRealDir(this.dir, canonical))
    // 🔴 알림 — 주입이 이긴다. 없으면 공급 장부만 운영 알림으로 보낸다(시험 · 다른 장부는 보내지 않는다)
    this.notify = cfg.notify ?? (this.supply ? SLACK_USAGE_UNKNOWN_NOTIFY : null)
    this.protectAt = this.supply
      ? supplyProtectFromEnv(process.env)
      : cfg.protectAt ?? null
    this.budgetEnv = this.supply
      ? budgetEnvProvenance(process.env, readEnvLocalText(cfg.envLocalPath ?? join(process.cwd(), '.env.local')))
      : null
    if (this.budgetEnv !== null && this.budgetEnv.overrides.length > 0) {
      console.warn(`🔴 예산 env 를 프로세스가 .env.local 과 다르게 덮었다 — ${this.budgetEnv.overrides
        .map((o) => `${o.name} (.env.local ${o.envLocal} · 프로세스 ${o.process})`).join(' · ')}`
        + ' · 공급 장부 하루 상한은 min(env, 계약 천장) 그대로다 — 장부 줄에 budgetSource=process-override 로 남긴다')
    }
  }

  /**
   * 🔴 **공급 장부 자리가 정본인가** — 요청마다 본다(세션을 만든 뒤 `$HOME` 이 바뀌어도 같은 판정).
   *    시험 격리 표식(가짜 provider 프로세스)이 걸렸을 때만 정본이 아닌 자리(임시 HOME)를 허용한다.
   */
  private ledgerDirError(): string | null {
    if (!this.supply || ledgerIsolationActive()) return null
    return supplyLedgerDirError(this.dir)
  }

  /**
   * 🔴 **오늘 공급 장부 파일이 없을 때** — 잠금 안에서, 오늘 파일에 첫 줄을 적기 **전에** 부른다.
   *    보류면 사유를, 아니면 `null`. 판정 정본은 `missingTodayLedgerVerdict`.
   */
  private missingTodayError(path: string, date: string, startedAt: Date): string | null {
    if (!this.supply || this.protectAt === null) return null
    const exists = this.io.exists ?? existsSync
    if (exists(path)) return null
    let recent = false
    let d = date
    for (let i = 0; i < SCHEDULED_COST_LOOKBACK_DAYS && !recent; i += 1) {
      d = previousLedgerDate(d)
      recent = exists(ledgerPathOf(this.dir, d))
    }
    // 실행 종류만 본다 — 몫 계산은 여기서 쓰지 않는다
    const kind = this.protectAt(startedAt, {
      todayEntries: [], historyEntries: null, dailyUsd: this.limits.dailyUsd, sessionStartedAt: this.createdAt,
    }).kind
    const v = missingTodayLedgerVerdict({ now: startedAt, todayExists: false, recentDaysExist: recent, kind })
    return v.ok ? null : v.reason
  }

  /** 🔴 적용 한도 — 공급 장부 줄에만 싣는다(다른 장부의 줄 모양은 그대로) */
  private budgetTag(protect: SpendProtect | null): Pick<LedgerEntry,
    'budgetDailyUsd' | 'budgetCeilingUsd' | 'budgetCapUsd' | 'budgetSource'> | Record<string, never> {
    if (!this.supply) return {}
    const daily = this.limits.dailyUsd
    const ceiling = protect?.ceilingUsd ?? null
    return {
      budgetDailyUsd: daily,
      budgetCeilingUsd: ceiling,
      budgetCapUsd: daily === null ? null : ceiling === null ? daily : Math.min(daily, ceiling),
      budgetSource: this.budgetEnv?.sources.dailyUsd ?? null,
    }
  }

  get tally(): Readonly<SessionTally> { return this.t }

  /** 사람이 읽는 한 줄 — 🔴 사전 계산과 유료 요청을 섞지 않는다 */
  describe(): string {
    const by = [...this.t.blockedBy.entries()].map(([c, n]) => `${c} ${n}`).join(' · ')
    return [
      `장부 ${this.runId} · 유료 ${this.t.paid}건 · 보류 ${this.t.blocked}건${by === '' ? '' : ` (${by})`}`,
      ...(this.lastKind === null ? [] : [
        `  실행 종류 ${this.lastKind.kind === 'scheduled' ? '정기' : '손 실행'} — ${this.lastKind.why}`
          + (this.lastKind.protect === null ? '' : ` · 🔴 정기 회차 몫을 남긴다: ${this.lastKind.protect.reason}`),
      ]),
      ...(this.supply && this.budgetEnv !== null ? [
        `  적용 한도 — env 하루 예산 ${this.limits.dailyUsd === null ? '없음' : `$${this.limits.dailyUsd}`}`
          + ` (출처 ${this.budgetEnv.sources.dailyUsd})`
          + (this.lastKind?.protect == null ? '' : ` · 천장 ${this.lastKind.protect.ceilingUsd === null ? '없음' : `$${this.lastKind.protect.ceilingUsd}`}`)
          + (this.budgetEnv.overrides.length > 0 ? ' · 🔴 프로세스가 .env.local 예산을 덮었다' : ''),
      ] : []),
      `  사전 계산 ${this.t.countTokens}건 (무료)`,
      `  예약 $${this.t.reservedUsd.toFixed(6)} · 정산 $${this.t.settledUsd.toFixed(6)}`
        + ` · 사용량 미상 ${this.t.usageUnknown}건 · 예약 초과 ${this.t.overruns}건`,
      ...(this.t.settleHeld > 0
        ? [`  🔴 정산을 적지 못해 유료 요청을 멈췄다 ${this.t.settleHeld}건`
          + ` — ${settleHoldPathOf(this.dir)} 을 사람이 확인한다`
          + (this.t.holdWriteFailed > 0 ? ` · 🔴 표식조차 못 쓴 것 ${this.t.holdWriteFailed}건` : '')]
        : []),
      '  🔴 이 숫자는 이 회차가 센 것이다. 제공사 청구서가 정본이다',
    ].join('\n')
  }

  private bump(code: BlockCode): void {
    this.t.blocked += 1
    this.t.blockedBy.set(code, (this.t.blockedBy.get(code) ?? 0) + 1)
  }

  /**
   * 🔴 **요청 하나.** 계산 → 예약 → 생성 → 정산이 전부 여기서 일어난다.
   *
   * 🔴 재시도도 나이 검수도 이 함수를 지난다. 어느 하나가 우회하면
   *    장부는 있는데 막지는 못하는 상태가 된다 — fixture 가 그것을 검사한다.
   */
  /**
   * 🔴 **장부가 정산한 금액을 응답에 실어 보낸다** (2026-09-20).
   *    부르는 쪽이 비용을 **다시 계산하지 않게** 하려는 것이다 — 같은 값을 두 곳에서
   *    계산하면 반드시 어긋난다. 정산하지 못한 건은 `null` 이다(0원이 아니다).
   *
   * 🔴 **정산 줄을 못 적었으면 성공으로 돌려주지 않는다** (2026-09-20 보정).
   *    앞판은 provider 응답이 성공이면 `settledUsd` 까지 그대로 돌려줬다 —
   *    장부에는 그 건이 **미정산으로 남아 있는데** 부르는 쪽은 완주로 읽었다.
   *    그러면 금액을 모르는 글이 후보·캐시·AUTO_ADOPT 까지 갈 수 있다.
   *    🔴 `settlementRecorded` 로 **명시**한다. 부르는 쪽은 이것이 `false` 면
   *       그 단계를 완주로 세지 않는다.
   */
  async call(input: SupplyCallInput): Promise<SupplyCallResult> {
    /**
     * 🔴 **정산 실패가 한 번이라도 있으면 더 보내지 않는다.**
     *    사전 계산(무료)조차 하지 않는다 — 어차피 보류될 요청이다.
     */
    if (this.settleFailed !== null) {
      this.bump('SETTLE_ERROR')
      return { ...blockedResponse('SETTLE_ERROR', this.settleFailed), settledUsd: null, settlementRecorded: false }
    }
    /**
     * 🔴 **공급 장부 자리가 정본이 아니면 아무것도 하지 않는다** (2026-09-30) — 사전 계산도, 잠금도, 장부 쓰기도.
     *    `$HOME` 을 바꿔 띄운 손 실행이 빈 장부로 새 예산을 여는 길을 막는다. 그 자리에 줄을 적지도 않는다.
     */
    const dirError = this.ledgerDirError()
    if (dirError !== null) {
      this.bump('LEDGER_ERROR')
      return { ...blockedResponse('LEDGER_ERROR', dirError), settledUsd: null, settlementRecorded: false }
    }
    const startedAt = this.now()
    /**
     * 🔴 **날짜는 요청을 시작한 때로 고정한다.** 자정을 넘겨 응답이 와도 정산은
     *    예약과 **같은 파일**에 적힌다. 다른 날에 적으면 그날 예약이 영원히 안 풀린다.
     */
    const date = ledgerDateOf(startedAt)
    const path = ledgerPathOf(this.dir, date)
    const attemptId = randomUUID()

    // ── ① 공식 사전 계산 (무료). 🔴 유료 요청 수에 넣지 않는다 ──
    const counted = await countInputTokens({
      model: input.model,
      systemPrompt: input.systemPrompt,
      userPayload: input.userPayload,
      timeoutMs: input.timeoutMs,
    })
    this.t.countTokens += 1
    const seq = this.t.paid + this.t.blocked
    try {
      this.io.withLock(this.dir, () => {
        /**
         * 🔴 **오늘 파일에 첫 줄을 적기 전에** 본다 — 이 줄이 파일을 만들면 다음 요청부터는
         *    "있는 파일" 이 되어 규칙이 한 번만 걸린다. 보류면 던지고 아무 줄도 적지 않는다.
         */
        const missing = this.missingTodayError(path, date, startedAt)
        if (missing !== null) throw new Error(missing)
        this.write(path, {
          ...this.base(`${attemptId}-count`, 'countTokens', input, startedAt, seq),
          status: counted.ok ? 'settled' : 'blocked',
          blockCode: counted.ok ? null : 'NO_COUNT',
          countedInputTokens: counted.inputTokens,
          // 🔴 무료다. 0 이 **모름이 아니라 진짜 0** 인 유일한 자리다
          reservedUsd: 0, settledUsd: 0,
          endedAt: this.now().toISOString(),
          errorCode: counted.errorCode,
        })
      })
    } catch (e) {
      // 🔴 장부에 못 적으면 유료 요청으로 넘어가지 않는다
      this.bump('LEDGER_ERROR')
      return {
        ...blockedResponse('LEDGER_ERROR',
          `사전 계산을 장부에 적지 못했다 — ${e instanceof Error ? e.message : 'unknown'}`),
        settledUsd: null, settlementRecorded: false,
      }
    }

    // ── ② 예약액 — 🔴 여유 배수는 호출부(env)가 준다. 코드가 고르지 않는다 ──
    const reserve = counted.inputTokens === null || this.limits.headroomMultiplier === null
      ? { known: false as const, code: 'NO_USAGE' as const, reason: '공식 사전 계산값이나 여유 배수가 없다' }
      : reserveOf({
        model: input.model,
        countedInputTokens: counted.inputTokens,
        maxOutputTokens: input.maxOutputTokens,
        headroomMultiplier: this.limits.headroomMultiplier,
      })

    // ── ③ 🔴 읽기·판정·예약 기록을 **한 잠금 안에서** 한다 ──
    let verdict: ReturnType<typeof judgeSpend>
    /** 🔴 요청 전 판정이 정한 실행 종류 · 슬롯 — 예약 줄과 정산 줄에 똑같이 남긴다 */
    let tag: { runKind: SupplyRunKind; runSlot: string | null } | null = null
    /** 🔴 요청 전 판정에 적용한 한도 — 예약 줄과 정산 줄에 똑같이 남긴다(접으면 정산 줄이 이긴다) */
    let budget: ReturnType<SupplyLlmSession['budgetTag']> = {}
    try {
      verdict = this.io.withLock(this.dir, () => {
        /**
         * 🔴 **공급 장부면 오늘 파일이 있어야 한다** — 바로 앞 잠금에서 사전 계산 줄을 적었다.
         *    없으면 그 사이 누군가 옮기거나 지운 것이다. 빈 장부(= 사용액 0)로 읽지 않는다.
         */
        const vanished = this.supply && !(this.io.exists ?? existsSync)(path)
        const read: LedgerRead = vanished
          ? { ok: false, reason: '오늘 공급 장부 파일이 사전 계산 줄을 적은 뒤 사라졌다' }
          : this.io.readDay(path)
        /**
         * 🔴 **회차 사용량을 장부에서 센다 — 잠금 안에서.**
         *    메모리 카운터는 판정·생성이 다른 프로세스라 서로를 못 보고,
         *    재시작하면 0 이 되고, 같은 회차가 둘 돌면 각자 자기 것만 센다.
         *    어제 파일도 함께 읽으므로 자정을 넘어도 상한이 초기화되지 않는다.
         */
        const runRead = this.io.readRun(this.dir, date, this.runId)
        /**
         * 🔴 **끝을 기록하지 못한 예약이 있는가** (2026-09-17 2차 보정).
         *    사후 표식이 없어도 이것만으로 막힌다 — 표식 쓰기까지 실패한 경우를 덮는다.
         */
        const openRead = this.io.readOpen(this.dir)
        const split = classifyReservations({
          open: openRead.ok ? openRead.list : [],
          now: startedAt, sessionId: this.sessionId, pid: process.pid, pidAlive: this.io.pidAlive,
        })
        /**
         * 🔴 **정기 회차 몫 — 잠금 안에서, 판정 시각으로 정한다** (2026-09-29).
         *    같은 잠금 안에서 집계·판정·예약 기록이 일어나므로 손 실행과 정기 회차가 동시에 와도
         *    둘이 같은 여력을 두 번 보지 않는다.
         *    🔴 시각은 `startedAt` 이다 — 집계하는 장부 파일(`path`)과 **같은 KST 날짜**여야
         *       자정 경계에서 어제 장부를 오늘 슬롯으로 판정하는 일이 없다.
         */
        const decided = this.protectAt === null ? null : this.protectAt(startedAt, {
          todayEntries: read.ok ? read.entries : [],
          historyEntries: read.ok ? this.historyBefore(date) : null,
          dailyUsd: this.limits.dailyUsd,
          sessionStartedAt: this.createdAt,
        })
        this.lastKind = decided
        tag = decided === null ? null : { runKind: decided.kind, runSlot: decided.slot ?? null }
        budget = this.budgetTag(decided?.protect ?? null)
        const v = judgeSpend({
          protect: decided?.protect ?? null,
          limits: this.limits,
          tally: read.ok ? tallyOf(read.entries) : tallyOf([]),
          runPaid: runRead.ok ? runPaidCountOf(runRead.entries, this.runId) : 0,
          reserve,
          // 🔴 열린 예약 목록을 못 읽어도 보류다 — 모르면 멈춘다
          ledgerOk: read.ok && runRead.ok && openRead.ok,
          // 🔴 보류 표식도 **잠금 안에서** 본다. 밖에서 보면 그 사이에 걸릴 수 있다
          settleHold: this.io.readHold(this.dir),
          unresolved: split.unresolved,
        })
        this.write(path, {
          ...this.base(attemptId, input.stage, input, startedAt, seq),
          ...(tag ?? {}),
          ...budget,
          status: v.ok ? 'reserved' : 'blocked',
          blockCode: v.ok ? null : v.code,
          countedInputTokens: counted.inputTokens,
          reservedUsd: v.ok ? v.reservedUsd : null,
          endedAt: v.ok ? null : this.now().toISOString(),
          errorCode: v.ok ? null : `${LEDGER_BLOCKED}:${v.code}`,
        })
        /**
         * 🔴 **예약을 남기고 나서야 보낸다.** 이 쓰기가 실패하면 `withLock` 이 던지고
         *    요청은 나가지 않는다 — 적지 못할 것을 보내지 않는다.
         */
        if (v.ok) {
          this.io.addOpen(this.dir, {
            attemptId, runId: this.runId, stage: input.stage, date,
            startedAt: startedAt.toISOString(), timeoutMs: input.timeoutMs,
            reservedUsd: v.reservedUsd, pid: process.pid, sessionId: this.sessionId,
          })
        }
        return v
      })
    } catch (e) {
      // 🔴 잠금·기록에 실패하면 **보낸다는 선택지는 없다.** 못 적는 요청은 안 보낸다
      const reason = `장부에 적지 못했다 — ${e instanceof Error ? e.message : 'unknown'}`
      this.bump('LEDGER_ERROR')
      return { ...blockedResponse('LEDGER_ERROR', reason), settledUsd: null, settlementRecorded: false }
    }

    if (!verdict.ok) {
      this.bump(verdict.code)
      return { ...blockedResponse(verdict.code, verdict.reason), settledUsd: null, settlementRecorded: false }
    }

    // ── ④ 🔴 여기서만 유료 요청이 나간다 ──
    this.t.paid += 1
    this.t.reservedUsd += verdict.reservedUsd
    const res = await callProvider({
      model: input.model,
      systemPrompt: input.systemPrompt,
      userPayload: input.userPayload,
      maxOutputTokens: input.maxOutputTokens,
      timeoutMs: input.timeoutMs,
    })

    // ── ⑤ 정산. 🔴 사용량을 모르면 예약을 풀지 않는다 ──
    const cost = res.usageKnown
      ? costOf({
        model: input.model,
        usage: {
          inputTokens: res.inputTokens, outputTokens: res.outputTokens,
          cacheWriteTokens: res.cacheWriteTokens, cacheReadTokens: res.cacheReadTokens,
        },
      })
      : { known: false as const, code: 'NO_USAGE' as const, reason: '제공사 사용량을 읽지 못했다' }
    const settled = judgeSettle({ reservedUsd: verdict.reservedUsd, cost })
    /** 🔴 정산 **줄을 실제로 적었는가.** 적지 못하면 이 단계는 완주가 아니다 */
    let settlementRecorded = true
    /** 🔴 사용량 미상 — 장부 처리가 끝난 **뒤** 알린다(알림이 기록을 막지 않는다) */
    const unknownUsage = settled.status === 'usageUnknown'
    /**
     * 🔴 **집계는 기록이 끝난 뒤에 한다** (2026-09-20 보정).
     *
     *    앞판은 `judgeSettle` 직후에 `settledUsd`·`overruns`·`usageUnknown` 을 올렸다.
     *    그런데 그 아래 append 나 `clearOpen` 이 실패하면 **장부에는 아무것도 안 적혔는데
     *    회차 집계에는 금액이 올라간다.** 화면·보고가 실제보다 많이 쓴 것으로 보인다.
     *    🔴 그래서 **줄을 적고 열린 예약을 지운 뒤**에만 센다.
     */
    try {
      this.io.withLock(this.dir, () => {
        this.write(path, {
          ...this.base(attemptId, input.stage, input, startedAt, seq),
          // 🔴 정산 줄도 같은 표식을 싣는다 — 접을 때 이 줄이 이기므로, 빠뜨리면 실측에서 사라진다
          ...(tag ?? {}),
          ...budget,
          status: settled.status,
          blockCode: null,
          countedInputTokens: counted.inputTokens,
          reservedUsd: verdict.reservedUsd,
          inputTokens: res.usageKnown ? res.inputTokens : null,
          outputTokens: res.usageKnown ? res.outputTokens : null,
          cacheWriteTokens: res.cacheWriteTokens,
          cacheReadTokens: res.cacheReadTokens,
          usageKeys: res.usageKeys,
          usageNumbers: res.usageNumbers ?? null,
          settledUsd: settled.settledUsd,
          endedAt: this.now().toISOString(),
          errorCode: res.errorCode,
        })
        /**
         * 🔴 **순서를 지킨다** — 끝을 장부에 적은 뒤에 예약을 지운다.
         *    거꾸로 하면 끝을 못 적었는데 목록에서 사라져 아무도 모르게 된다.
         */
        this.io.clearOpen(this.dir, attemptId)
      })
      // 🔴 여기까지 왔다 = 줄이 적혔고 열린 예약도 풀렸다. 그때만 센다
      if (settled.status === 'usageUnknown') this.t.usageUnknown += 1
      if (settled.settledUsd !== null) this.t.settledUsd += settled.settledUsd
      if (settled.overran) this.t.overruns += 1
    } catch (e) {
      /**
       * 🔴 **정산을 못 적었다.** 요청은 이미 나갔고 예약 줄은 남아 있다 —
       *    그 건은 미정산으로 남아 여력에서 계속 빠진다. 예약 보존은 그대로다.
       *
       * 🔴 **그것만으로는 모자라다** (2026-09-17 보정). 같은 원인이면 다음 정산도
       *    못 적는다. 그래서 **이후 유료 요청을 멈춘다** — 메모리 플래그 하나와
       *    파일 표식 하나로. 파일은 재시작을 넘고, 사람이 제공사 사용량과 대조한 뒤
       *    직접 지워야 풀린다. 재시작이 우회가 되지 않게 하는 것이 요점이다.
       */
      /**
       * 🔴 **사용량을 알았는데 기록만 실패한 것은 `usageUnknown` 이 아니다** (2026-09-20).
       *    앞판은 무조건 올려서, 제공사가 사용량을 준 건까지 "사용량 미상" 으로 셌다 —
       *    원인이 다른 두 가지를 한 칸에 담으면 어느 쪽인지 알 수 없다.
       *    🔴 기록 실패는 `settleHeld` 가 센다.
       */
      if (settled.status === 'usageUnknown') this.t.usageUnknown += 1
      settlementRecorded = false
      const why = `정산을 장부에 적지 못했다 — ${e instanceof Error ? e.message : 'unknown'}`
      this.settleFailed = `${why}`
        + ` · 🔴 예약 ${attemptId} 가 ${openReservationsPathOf(this.dir)} 에 열린 채로 남는다`
        + ' · 제공사 사용량과 대조한 뒤 `npm run supply:ledger-resolve` 로 사람이 마감한다'
      this.t.settleHeld += 1
      try {
        this.io.writeHold(this.dir, {
          runId: this.runId, attemptId, date,
          reservedUsd: verdict.reservedUsd,
          at: this.now().toISOString(), reason: why,
        })
      } catch {
        /**
         * 🔴 **표식마저 못 썼다.** 이 프로세스는 위 플래그로 멈춘다.
         *    다음 프로세스는 이 보류를 못 본다 — 다만 같은 원인이 이어지면
         *    그쪽의 첫 장부 쓰기가 실패해 `LEDGER_ERROR` 로 막힌다.
         *    원인이 그 사이 사라진 경우는 막지 못한다. 숨기지 않고 적어 둔다.
         */
        this.t.holdWriteFailed += 1
      }
    }
    if (unknownUsage) await this.alertUsageUnknown(input.stage, verdict.reservedUsd)
    /**
     * 🔴 **정산 줄을 적지 못했으면 금액을 주지 않고 완주로도 세지 않는다.**
     *    요청은 이미 나갔으니 사용량은 그대로 싣되, 이 단계는 **실패**다.
     */
    return settlementRecorded
      ? { ...res, settledUsd: settled.settledUsd, settlementRecorded: true }
      : { ...res, ok: false, errorCode: res.errorCode ?? SETTLE_NOT_RECORDED,
        settledUsd: null, settlementRecorded: false }
  }

  /**
   * 🔴 **사용량 미상 알림 — 실패는 삼킨다.** 장부 줄 · 열린 예약 처리는 이미 끝났다. 알림이 던지거나 늦어도
   *    정산 결과 · 회차 진행은 바뀌지 않는다.
   */
  private async alertUsageUnknown(stage: LedgerStage, reservedUsd: number | null): Promise<void> {
    if (reservedUsd !== null && Number.isFinite(reservedUsd)) this.unknownReservedUsd += reservedUsd
    if (this.notify === null) return
    try {
      await this.notify({ runId: this.runId, stage, count: this.t.usageUnknown, reservedUsd, reservedTotalUsd: this.unknownReservedUsd })
    } catch { /* 알림 실패는 장부 · 회차 결과를 바꾸지 않는다 */ }
  }

  /** 장부 한 줄의 고정 칸 — 🔴 본문이 들어갈 자리가 없다 */
  private base(
    id: string, stage: LedgerStage, input: SupplyCallInput, startedAt: Date, seq: number,
  ): LedgerEntry {
    return {
      runId: this.runId,
      stage,
      attemptId: id,
      requestNo: seq,
      provider: input.model.startsWith('gemini-') ? 'google'
        : input.model.startsWith('claude-') ? 'anthropic' : 'openai',
      // 🔴 **제공사가 아는 이름**을 적는다. 내부 라벨과 다르다 —
      //    청구서와 대조할 때 이 칸이 없으면 어느 모델이 얼마였는지 맞출 수 없다
      apiModelId: apiModelIdFor(input.model),
      model: input.model,
      status: 'blocked',
      blockCode: null,
      countedInputTokens: null,
      maxOutputTokens: input.maxOutputTokens,
      reservedUsd: null,
      inputTokens: null, outputTokens: null,
      cacheWriteTokens: null, cacheReadTokens: null,
      usageKeys: [],
      settledUsd: null,
      pricingVersion: PRICING_VERSION,
      startedAt: startedAt.toISOString(),
      endedAt: null,
      ...(typeof input.sourceKey === 'string' && input.sourceKey !== '' ? { sourceKey: input.sourceKey } : {}),
      ...(typeof input.supplyContract === 'string' && input.supplyContract !== '' ? { supplyContract: input.supplyContract } : {}),
      errorCode: null,
    }
  }

  /**
   * 🔴 **정기 실측용 장부 이력** — 어제부터 뒤로 `SCHEDULED_COST_LOOKBACK_DAYS` 일(오늘은 넣지 않는다).
   *    지난 날 하나라도 못 읽으면 `null` 이다 → 보수 기본값(크게 떼어 둔다). 반쪽 이력으로 평균을 내지 않는다.
   *
   * 🔴 **어제 장부가 없거나 비었어도 `null` 이다 (2026-09-29 3차).** 정기 회차는 매일 돈다 — 어제 줄이 하나도
   *    없다는 것은 노트북이 하루 꺼져 있었거나 파일이 사라졌다는 뜻이고, 둘 다 **가장 최근 단가를 모른다**는
   *    뜻이다. 그때 더 오래된 날의 표본(묶음·모델이 바뀌기 전의 싼 값일 수 있다)으로 몫을 낮추지 않는다.
   *    그 전 날(2~7일 전)이 없는 것은 빈 날로 본다 — 표본 3개 미만이면 어차피 보수 기본값이다.
   *    (어제 파일이 **깨진** 경우는 이보다 앞에서 `readRun` 이 실패해 모든 유료 요청이 `LEDGER_ERROR` 다.)
   */
  private historyBefore(date: string): LedgerEntry[] | null {
    const out: LedgerEntry[] = []
    let d = date
    for (let i = 0; i < SCHEDULED_COST_LOOKBACK_DAYS; i += 1) {
      d = previousLedgerDate(d)
      let r = this.pastDays.get(d)
      if (r === undefined) {
        r = this.io.readDay(ledgerPathOf(this.dir, d))
        this.pastDays.set(d, r)
      }
      if (!r.ok) return null
      if (i === 0 && r.entries.length === 0) return null
      out.push(...r.entries)
    }
    return out
  }

  private write(path: string, entry: LedgerEntry): void {
    this.io.append(path, entry)
  }
}
