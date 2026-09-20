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

import {
  classifyReservations, judgeSettle, judgeSpend, ledgerDateOf, runPaidCountOf, tallyOf,
  type BlockCode, type BudgetLimits, type LedgerEntry, type LedgerStage,
  type OpenReservation,
} from '../../src/lib/llm-ledger'
import { PRICING_VERSION, costOf, reserveOf } from '../../src/lib/llm-pricing'
import {
  addOpenReservation, appendLedgerLine, clearOpenReservation, defaultLedgerDir, ledgerPathOf,
  openReservationsPathOf, pidAlive, readLedgerDay, readLedgerRun, readOpenReservations,
  readSettleHold, settleHoldPathOf, withLedgerLock,
  type LedgerRead, type OpenRead, type SettleHold,
} from './llm-ledger-store.mjs'
import {
  callProvider, countInputTokens, type LlmResponse, type ProviderModel,
} from './voice-m3-provider.mjs'
import { writeSettleHold } from './llm-ledger-store.mjs'
import { apiModelIdFor } from './voice-m3-contract.mjs'

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
}

export type SupplyCallInput = {
  stage: LedgerStage
  model: ProviderModel
  systemPrompt: string
  userPayload: string
  maxOutputTokens: number
  timeoutMs: number
}

export type SupplySessionConfig = {
  runId: string
  /** 장부 디렉터리. 🔴 시험은 임시 경로를 준다 */
  dir?: string
  limits: BudgetLimits
  now?: () => Date
  /** 🔴 시험 전용 주입. 운영은 비워 두고 기본 저장소를 쓴다 */
  io?: LedgerIo
}

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
    this.io = cfg.io ?? REAL_LEDGER_IO
  }

  get tally(): Readonly<SessionTally> { return this.t }

  /** 사람이 읽는 한 줄 — 🔴 사전 계산과 유료 요청을 섞지 않는다 */
  describe(): string {
    const by = [...this.t.blockedBy.entries()].map(([c, n]) => `${c} ${n}`).join(' · ')
    return [
      `장부 ${this.runId} · 유료 ${this.t.paid}건 · 보류 ${this.t.blocked}건${by === '' ? '' : ` (${by})`}`,
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
    try {
      verdict = this.io.withLock(this.dir, () => {
        const read = this.io.readDay(path)
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
        const v = judgeSpend({
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
          status: settled.status,
          blockCode: null,
          countedInputTokens: counted.inputTokens,
          reservedUsd: verdict.reservedUsd,
          inputTokens: res.usageKnown ? res.inputTokens : null,
          outputTokens: res.usageKnown ? res.outputTokens : null,
          cacheWriteTokens: res.cacheWriteTokens,
          cacheReadTokens: res.cacheReadTokens,
          usageKeys: res.usageKeys,
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
    /**
     * 🔴 **정산 줄을 적지 못했으면 금액을 주지 않고 완주로도 세지 않는다.**
     *    요청은 이미 나갔으니 사용량은 그대로 싣되, 이 단계는 **실패**다.
     */
    return settlementRecorded
      ? { ...res, settledUsd: settled.settledUsd, settlementRecorded: true }
      : { ...res, ok: false, errorCode: res.errorCode ?? SETTLE_NOT_RECORDED,
        settledUsd: null, settlementRecorded: false }
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
      errorCode: null,
    }
  }

  private write(path: string, entry: LedgerEntry): void {
    this.io.append(path, entry)
  }
}
