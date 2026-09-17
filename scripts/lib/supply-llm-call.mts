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
  judgeSettle, judgeSpend, ledgerDateOf, tallyOf,
  type BlockCode, type BudgetLimits, type LedgerEntry, type LedgerStage,
} from '../../src/lib/llm-ledger'
import { PRICING_VERSION, costOf, reserveOf } from '../../src/lib/llm-pricing'
import {
  appendLedgerLine, defaultLedgerDir, ledgerPathOf, readLedgerDay, withLedgerLock,
} from './llm-ledger-store.mjs'
import {
  callProvider, countInputTokens, type LlmResponse, type ProviderModel,
} from './voice-m3-provider.mjs'
import { apiModelIdFor } from './voice-m3-contract.mjs'

/** 🔴 차단된 요청이 돌려주는 오류 코드 머리 — 호출부가 provider 오류와 구분할 수 있게 한다 */
export const LEDGER_BLOCKED = 'LEDGER_BLOCKED'

/** env 이름. 🔴 값이 아니라 이름이다 */
export const BUDGET_ENV = {
  dailyUsd: 'SORAN_LLM_DAILY_BUDGET_USD',
  runRequestCap: 'SORAN_LLM_RUN_REQUEST_CAP',
  headroomMultiplier: 'SORAN_LLM_RESERVE_HEADROOM',
} as const

function numEnv(env: NodeJS.ProcessEnv, name: string): number | null {
  const raw = (env[name] ?? '').trim()
  if (raw === '') return null
  const n = Number(raw)
  // 🔴 읽을 수 없는 값을 0 으로 읽지 않는다. 모르면 null 이고, null 이면 보류다
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * 🔴 **예산은 전부 env 에서 온다. 기본값이 없다.**
 *    하나라도 비어 있으면 그 회차의 유료 요청은 보류된다 — 사람이 정하기 전까지 안 나간다.
 */
export function limitsFromEnv(env: NodeJS.ProcessEnv): BudgetLimits {
  return {
    dailyUsd: numEnv(env, BUDGET_ENV.dailyUsd),
    runRequestCap: numEnv(env, BUDGET_ENV.runRequestCap),
    headroomMultiplier: numEnv(env, BUDGET_ENV.headroomMultiplier),
  }
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

export class SupplyLlmSession {
  readonly runId: string
  readonly dir: string
  readonly limits: BudgetLimits
  private readonly now: () => Date
  private readonly t: SessionTally = {
    paid: 0, blocked: 0, countTokens: 0,
    reservedUsd: 0, settledUsd: 0, usageUnknown: 0, overruns: 0,
    blockedBy: new Map(),
  }

  constructor(cfg: SupplySessionConfig) {
    this.runId = cfg.runId
    this.dir = cfg.dir ?? defaultLedgerDir()
    this.limits = cfg.limits
    this.now = cfg.now ?? (() => new Date())
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
  async call(input: SupplyCallInput): Promise<LlmResponse> {
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
      withLedgerLock(this.dir, () => {
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
      return blockedResponse('LEDGER_ERROR',
        `사전 계산을 장부에 적지 못했다 — ${e instanceof Error ? e.message : 'unknown'}`)
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
      verdict = withLedgerLock(this.dir, () => {
        const read = readLedgerDay(path)
        const v = judgeSpend({
          limits: this.limits,
          tally: read.ok ? tallyOf(read.entries) : tallyOf([]),
          runPaidSoFar: this.t.paid,
          reserve,
          ledgerOk: read.ok,
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
        return v
      })
    } catch (e) {
      // 🔴 잠금·기록에 실패하면 **보낸다는 선택지는 없다.** 못 적는 요청은 안 보낸다
      const reason = `장부에 적지 못했다 — ${e instanceof Error ? e.message : 'unknown'}`
      this.bump('LEDGER_ERROR')
      return blockedResponse('LEDGER_ERROR', reason)
    }

    if (!verdict.ok) {
      this.bump(verdict.code)
      return blockedResponse(verdict.code, verdict.reason)
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
    if (settled.status === 'usageUnknown') this.t.usageUnknown += 1
    if (settled.settledUsd !== null) this.t.settledUsd += settled.settledUsd
    if (settled.overran) this.t.overruns += 1
    try {
      withLedgerLock(this.dir, () => {
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
      })
    } catch {
      /**
       * 🔴 **정산을 못 적었다.** 요청은 이미 나갔고 예약 줄은 남아 있다 —
       *    그 건은 미정산으로 남아 여력에서 계속 빠진다. 그게 맞는 방향이다.
       *    다음 요청은 그만큼 좁은 여력에서 판정된다.
       */
      this.t.usageUnknown += 1
    }
    return res
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
    appendLedgerLine(path, entry)
  }
}
