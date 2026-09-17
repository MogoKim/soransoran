/**
 * 공급 AI 비용 장부 — 🔴 **순수 판정. 파일·네트워크·시각 조회 0**
 *
 * 🔴 **이것이 하는 일과 하지 않는 일을 분명히 한다.**
 *
 *    하는 것   ① 공급의 모든 provider 요청을 한 줄씩 남긴다
 *              ② 요청 **전에** 남은 여력을 보고, 모자라면 그 요청을 보내지 않는다
 *              ③ 응답이 오면 제공사 사용량으로 정산한다
 *
 *    🔴 하지 않는 것 — **"오늘 과금이 한도를 넘지 않는다" 는 보장.**
 *       이미 보낸 요청의 과금은 취소할 수 없고, 예약의 근거인 `count_tokens` 는
 *       공식 문서가 **"estimate"** 라고 적은 값이다. 그래서 이름을 `요청 전 차단`
 *       (pre-request gate)이라고 쓴다. `초과 방지` · `상한 보장` 이라고 쓰지 않는다.
 *
 * 🔴 **원문·프롬프트·응답 본문·API 키·개인정보를 담지 않는다.** 숫자와 코드뿐이다.
 */

import { type CostVerdict } from './llm-pricing'

/** 🔴 장부 날짜는 **KST 자정** 기준이다. 제공사 청구 주기와 다를 수 있음을 적어 둔다 */
export const LEDGER_TZ_OFFSET_MIN = 9 * 60
export const LEDGER_TZ_LABEL = 'KST(UTC+9)'

/** 🔴 이 장부가 덮는 범위 — 지금은 **로컬 공급 회차**뿐이다 */
export const LEDGER_SCOPE = 'local-supply' as const
export const LEDGER_SCOPE_NOTE =
  '로컬 supply-process 회차의 provider 요청만 센다 — 매거진·댓글·개발 세션·서버 실행은 포함하지 않는다'

export function ledgerDateOf(at: Date): string {
  const shifted = new Date(at.getTime() + LEDGER_TZ_OFFSET_MIN * 60_000)
  return shifted.toISOString().slice(0, 10)
}

/**
 * 하루 앞 날짜 — 🔴 **회차가 자정을 넘을 때 쓴다.**
 *
 *    장부 파일은 하루 단위인데 공급 회차는 자정을 넘을 수 있다. 오늘 파일만 보면
 *    어제 시작한 회차가 쓴 요청이 **안 보이고**, 회차 요청 상한이 자정에 초기화된다.
 *    그래서 회차 사용량을 셀 때는 어제 파일도 같이 읽는다.
 */
export function previousLedgerDate(date: string): string {
  const t = Date.parse(`${date}T00:00:00.000Z`)
  if (!Number.isFinite(t)) return date
  return new Date(t - 86_400_000).toISOString().slice(0, 10)
}

/** 공급의 어느 단계인가 — 🔴 재시도도 자기 단계로 남는다 */
export const LEDGER_STAGES = [
  'judge', 'judgeRetry',
  'draftGen', 'draftQuality', 'jsonRetry', 'schemaRetry',
  'ageCheck',
  /** 🔴 사전 계산은 **무료**지만 따로 센다 — 유료 요청 수와 섞지 않는다 */
  'countTokens',
] as const
export type LedgerStage = (typeof LEDGER_STAGES)[number]

/** 🔴 유료 단계 — `countTokens` 는 여기 없다 (공식 문서: free to use) */
export const PAID_STAGES: readonly LedgerStage[] =
  LEDGER_STAGES.filter((s) => s !== 'countTokens')

export type LedgerStatus =
  | 'reserved'      // 요청 직전. 아직 정산 안 됨
  | 'settled'       // 응답의 사용량으로 정산 완료
  | 'usageUnknown'  // 🔴 응답은 끝났는데 사용량을 모른다 — 예약을 풀지 않는다
  | 'blocked'       // 🔴 요청을 보내지 않았다 — 과금 0

export type BlockCode =
  | 'NO_BUDGET'        // 예산 금액이 설정되지 않았다
  | 'NO_PRICE'         // 단가를 모른다
  | 'NO_COUNT'         // 공식 사전 계산을 못 받았다
  | 'LEDGER_ERROR'     // 장부를 읽거나 쓰지 못했다
  | 'DAILY_EXHAUSTED'  // 남은 일일 여력이 부족하다
  | 'RUN_CAP'          // 회차 요청 수 상한
  | 'UNSETTLED_OVERRUN' // 🔴 실제 사용량이 예약액을 넘은 뒤 — 사람이 볼 때까지 멈춘다
  /**
   * 🔴 **정산을 장부에 적지 못했다** (2026-09-17 보정).
   *
   *    요청은 이미 나갔는데 그 결과를 적지 못한 상태다. 그 회차에 얼마가 나갔는지
   *    장부로는 알 수 없다. 예약 줄은 남아 여력을 계속 먹지만 그것만으로는 모자라다 —
   *    같은 원인(디스크·권한)이 계속되면 **다음 요청의 정산도 못 적는다.**
   *    그래서 그 뒤의 유료 요청을 멈춘다. 사람이 제공사 사용량과 대조한 뒤 푼다.
   */
  | 'SETTLE_ERROR'

/**
 * 장부 한 줄 — 🔴 **이 모양이 계약이다.**
 *    본문·프롬프트·응답이 들어갈 자리가 없다. 필드를 늘릴 때 그 성질을 지킨다.
 */
export type LedgerEntry = {
  /** 회차 id */
  runId: string
  stage: LedgerStage
  /** 🔴 요청 하나를 가리키는 식별자. 예약 줄과 정산 줄이 이 값으로 묶인다 */
  attemptId: string
  /** 🔴 이 회차 안에서 몇 번째 요청인가 (0-based). 재시도도 자기 번호를 갖는다 */
  requestNo: number
  provider: string
  /** 🔴 내부 라벨이 아니라 **제공사가 아는 모델 id** */
  apiModelId: string
  /** 내부 라벨 — 단가표 key */
  model: string
  status: LedgerStatus
  blockCode: BlockCode | null
  /** 공식 count_tokens 결과. 🔴 추정이다. 못 받았으면 null */
  countedInputTokens: number | null
  /** 요청 body 의 max_tokens — 확정 한도 */
  maxOutputTokens: number
  /** 예약액 (추정 기반) */
  reservedUsd: number | null
  /** 제공사 사용량 — 모르면 null */
  inputTokens: number | null
  outputTokens: number | null
  cacheWriteTokens: number | null
  cacheReadTokens: number | null
  /** 🔴 제공사가 준 usage 의 **키 이름만**. 값은 담지 않는다 */
  usageKeys: string[]
  /** 정산액. 🔴 모르면 null — 0 과 다르다 */
  settledUsd: number | null
  pricingVersion: string | null
  /** 요청 시작·종료 (ISO) */
  startedAt: string
  endedAt: string | null
  /** 제공사 오류 코드. 본문은 담지 않는다 */
  errorCode: string | null
}

/** 하루치 집계 — 🔴 예약·정산·미정산을 섞지 않는다 */
export type DayTally = {
  /** 정산 완료된 금액의 합 */
  settledUsd: number
  /** 🔴 아직 정산 안 된 예약의 합 — 여력에서 빼야 한다 */
  openReservedUsd: number
  /** 🔴 사용량을 모르는 건의 예약 합 (openReserved 에 포함) */
  usageUnknownUsd: number
  paidRequests: number
  countTokensRequests: number
  blocked: number
  /** 🔴 실제 사용량이 예약액을 넘은 건 — 있으면 이후 요청을 멈춘다 */
  overruns: number
}

export function tallyOf(entries: readonly LedgerEntry[]): DayTally {
  const t: DayTally = {
    settledUsd: 0, openReservedUsd: 0, usageUnknownUsd: 0,
    paidRequests: 0, countTokensRequests: 0, blocked: 0, overruns: 0,
  }
  for (const e of entries) {
    if (e.stage === 'countTokens') {
      if (e.status !== 'blocked') t.countTokensRequests += 1
      continue
    }
    if (e.status === 'blocked') { t.blocked += 1; continue }
    t.paidRequests += 1
    if (e.status === 'settled' && e.settledUsd !== null) {
      t.settledUsd += e.settledUsd
      // 🔴 실제가 예약보다 크면 표시해 둔다 — 조용히 덮지 않는다
      if (e.reservedUsd !== null && e.settledUsd > e.reservedUsd) t.overruns += 1
    } else {
      /**
       * 🔴 `reserved` 와 `usageUnknown` 은 **둘 다 열린 예약**이다.
       *    `usageUnknown` 을 자동으로 풀면, 실제로 과금됐을 수 있는 건이
       *    여력을 되돌려 주고 추가 요청을 허용한다 — 그것이 가장 위험한 누수다.
       */
      const r = e.reservedUsd ?? 0
      t.openReservedUsd += r
      if (e.status === 'usageUnknown') t.usageUnknownUsd += r
    }
  }
  return t
}

/**
 * 🔴 **한 회차가 이미 보낸 유료 요청 수** — 장부에서 센다 (2026-09-17 보정).
 *
 *    앞판은 세션의 메모리 카운터를 썼다. 그것은 세 곳에서 틀린다 —
 *      ① 판정과 생성이 **다른 프로세스**라 서로의 사용량을 모른다
 *      ② 회차가 죽고 다시 뜨면 카운터가 0 으로 돌아간다
 *      ③ 같은 회차가 동시에 둘 돌면 각자 자기 것만 센다
 *    장부를 세면 셋 다 해결된다 — 단, **잠금 안에서** 세야 ③ 이 막힌다.
 */
export function runPaidCountOf(entries: readonly LedgerEntry[], runId: string): number {
  let n = 0
  for (const e of entries) {
    if (e.runId !== runId) continue
    if (e.stage === 'countTokens') continue
    // 🔴 보내지 않은 것은 세지 않는다. 보낸 것은 정산 여부와 무관하게 센다
    if (e.status === 'blocked') continue
    n += 1
  }
  return n
}

/** 🔴 운영 값은 코드가 정하지 않는다. 호출부가 넘긴다 */
export type BudgetLimits = {
  /** 하루 예산(USD). 🔴 미설정이면 null — 그때는 유료 요청을 보류한다 */
  dailyUsd: number | null
  /**
   * 회차당 유료 요청 수 상한.
   *
   * 🔴 **미설정이면 보류다** (2026-09-17 보정). 앞판은 `null` 을 "상한 없음" 으로 읽어
   *    그냥 통과시켰다 — 아무도 정하지 않은 상태가 곧 **무제한**이었다.
   *    금액 예산과 같은 규칙을 쓴다: 정해지지 않았으면 안 보낸다.
   */
  runRequestCap: number | null
  /** 예약 여유 배수. 🔴 "허용 초과액" 이 아니라 추정 오차를 덮는 값 */
  headroomMultiplier: number | null
}

export type GateVerdict =
  | { ok: true; reservedUsd: number; remainingUsd: number }
  | { ok: false; code: BlockCode; reason: string }

/**
 * 🔴 **요청 전 차단 판정.** 통과하면 그만큼 예약하고 요청을 보낸다.
 *
 *    🔴 하나라도 모르면 보류다 — 예산 미설정 · 단가 미상 · 사전 계산 미상 · 장부 오류.
 *    🔴 미정산 예약은 여력에서 **뺀 채로** 계산한다. 자동으로 풀지 않는다.
 *    🔴 실제가 예약을 넘은 건이 있으면 이후 요청을 멈춘다 — 사람이 보라는 뜻이다.
 */
export function judgeSpend(input: {
  limits: BudgetLimits
  /** 오늘 장부 집계 */
  tally: DayTally
  /**
   * 🔴 이 **회차**가 이미 보낸 유료 요청 수 — `runPaidCountOf` 가 장부에서 센 값이다.
   *    메모리 카운터를 넣지 않는다. 판정·생성이 다른 프로세스라 서로를 못 본다.
   */
  runPaid: number
  /** 이번 요청의 예약액 판정 */
  reserve: CostVerdict
  /** 장부를 정상으로 읽었는가 */
  ledgerOk: boolean
  /**
   * 🔴 정산을 적지 못해 걸어 둔 보류. 사유가 있으면 유료 요청을 보내지 않는다.
   *    이것은 **파일로 남아 재시작을 넘긴다** — 메모리 플래그였다면 다시 뜨는 것만으로 풀린다.
   */
  settleHold: string | null
}): GateVerdict {
  if (!input.ledgerOk) {
    return { ok: false, code: 'LEDGER_ERROR', reason: '장부를 읽지 못했다 — 유료 요청을 보류한다' }
  }
  if (input.settleHold !== null) {
    return { ok: false, code: 'SETTLE_ERROR', reason: input.settleHold }
  }
  if (input.tally.overruns > 0) {
    return {
      ok: false, code: 'UNSETTLED_OVERRUN',
      reason: `실제 사용량이 예약액을 넘은 건이 ${input.tally.overruns}건 있다 — 사람이 확인할 때까지 멈춘다`,
    }
  }
  if (input.limits.dailyUsd === null) {
    return { ok: false, code: 'NO_BUDGET', reason: '하루 예산이 설정되지 않았다 — 유료 요청을 보류한다' }
  }
  if (input.limits.headroomMultiplier === null) {
    return { ok: false, code: 'NO_BUDGET', reason: '예약 여유 배수가 설정되지 않았다 — 유료 요청을 보류한다' }
  }
  if (!input.reserve.known) {
    const code: BlockCode = input.reserve.code === 'NO_PRICE' ? 'NO_PRICE' : 'NO_COUNT'
    return { ok: false, code, reason: input.reserve.reason }
  }
  // 🔴 상한이 정해지지 않았으면 보류한다 — 미설정을 "무제한" 으로 읽지 않는다
  if (input.limits.runRequestCap === null) {
    return { ok: false, code: 'NO_BUDGET', reason: '회차 요청 상한이 설정되지 않았다 — 유료 요청을 보류한다' }
  }
  if (input.runPaid >= input.limits.runRequestCap) {
    return {
      ok: false, code: 'RUN_CAP',
      reason: `회차 요청 상한에 닿았다 — ${input.runPaid}/${input.limits.runRequestCap}`,
    }
  }
  // 🔴 이미 쓴 것 + 열린 예약을 **둘 다** 뺀다
  const used = input.tally.settledUsd + input.tally.openReservedUsd
  const remaining = input.limits.dailyUsd - used
  if (input.reserve.usd > remaining) {
    return {
      ok: false, code: 'DAILY_EXHAUSTED',
      reason: `남은 여력 $${remaining.toFixed(6)} < 예약 $${input.reserve.usd.toFixed(6)}`,
    }
  }
  return { ok: true, reservedUsd: input.reserve.usd, remainingUsd: remaining - input.reserve.usd }
}

/**
 * 🔴 **정산 판정.** 사용량을 모르면 `usageUnknown` 으로 끝낸다 — 예약을 풀지 않는다.
 */
export function judgeSettle(input: {
  reservedUsd: number | null
  cost: CostVerdict
}): { status: LedgerStatus; settledUsd: number | null; overran: boolean } {
  if (!input.cost.known) {
    return { status: 'usageUnknown', settledUsd: null, overran: false }
  }
  const over = input.reservedUsd !== null && input.cost.usd > input.reservedUsd
  return { status: 'settled', settledUsd: input.cost.usd, overran: over }
}
