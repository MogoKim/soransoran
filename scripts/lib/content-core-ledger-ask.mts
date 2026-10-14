/**
 * Content Core 요청 → 공급 장부 — 🔴 **러너와 검사가 같은 함수를 쓴다** (2026-10-12 Batch B)
 *
 * 🔴 **왜 따로 두는가.** 이 변환이 러너(`micro-seed-auto-draft`) 안 클로저였을 때는 "재시도도 같은 회차 예산 ·
 *    같은 장부 예약을 지난다" 를 러너를 통째로 띄우지 않고는 실행으로 확인할 수 없었다. 검사가 축약본을
 *    손으로 조립하면 러너가 칸을 빠뜨려도 검사는 통과한다 — 그래서 **한 벌**만 둔다.
 *
 * 🔴 **하는 일**
 *    ① 회차 공동 예산(`take`)을 먼저 본다 — 재시도도 같은 몫에서 한 칸을 가져간다
 *    ② 장부 wrapper(`call` = `SupplyLlmSession.call`)를 지난다 — provider 를 직접 부르지 않는다
 *    ③ 첫 시도와 재시도를 **다른 장부 단계 이름**으로 적는다 — 각자 예약·정산 줄과 attemptId 를 갖는다
 *    ④ 장부가 정산한 금액을 그대로 싣는다 — 다시 계산하지 않는다. 정산 못 한 건은 `null`(0원이 아니다)
 */
import type { LedgerStage } from '../../src/lib/llm-ledger'
import { STAGE_MAX_OUTPUT_TOKENS, STAGE_THINKING_LEVEL } from '../../src/lib/content-core/pipeline'
import type { Ask, AskResult, AskStage } from './content-core-run.mjs'
import { LEDGER_BLOCKED, type SupplyCallResult } from './supply-llm-call.mjs'
import type { ProviderModel } from './voice-m3-provider.mjs'

/**
 * 🔴 v2 단계 → 장부 단계 이름. 장부 어휘는 `LEDGER_STAGES` 하나다.
 *    🔴 원천 요구 판독은 `sourceNeed` 다 (2026-10-12 Batch B · K-06) — 앞판의 `judge` 는 원천 판정과 같은 이름이라
 *       72h 손실표에서 "화자 계획 잘림" 이 판정 줄과 섞였다.
 */
export const V2_LEDGER_STAGE: Readonly<Record<AskStage, LedgerStage>> = Object.freeze({
  speakerPlan: 'sourceNeed',
  draftGen: 'draftGen',
  semanticReview: 'draftQuality',
})
/**
 * 🔴 **재시도는 다른 단계 이름으로 적는다** (2026-10-12 Batch B). 첫 시도와 재시도는 각자 예약·정산 줄을 갖는다 —
 *    이름이 같으면 장부만 보고 "한 원천이 같은 단계를 두 번 샀다" 를 읽을 수 없다.
 */
export const V2_LEDGER_RETRY_STAGE: Readonly<Record<AskStage, LedgerStage>> = Object.freeze({
  speakerPlan: 'sourceNeedRetry',
  draftGen: 'draftGenRetry',
  semanticReview: 'draftQualityRetry',
})

export type LedgerAskDeps = {
  /** 🔴 회차 공동 예산에서 한 칸 — 못 가져오면 요청을 보내지 않는다 */
  take: () => boolean
  /** 단계별 요청 수 집계(관측) — 재시도는 `단계:retry` 로 센다 */
  count: (kind: string) => void
  /** 🔴 공급 장부 wrapper — 예약 → 요청 → 정산이 전부 여기서 일어난다 */
  call: (
    stage: LedgerStage, system: string, payload: string, maxOutputTokens: number, model: ProviderModel,
    thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high',
  ) => Promise<SupplyCallResult>
}

const BLOCKED: AskResult = {
  ok: false, rawText: '', truncated: false, usageKnown: false,
  inputTokens: null, outputTokens: null, thoughtsTokens: null, usd: null, blocked: true,
}

export function ledgerAskOf(d: LedgerAskDeps): Ask {
  return async (stage, system, payload, model, attempt) => {
    // 🔴 재시도도 **같은 회차 공동 예산**에서 한 칸을 가져간다 — 따로 열린 몫이 없다
    if (!d.take()) return BLOCKED
    d.count(attempt === 2 ? `${stage}:retry` : stage)
    // 🔴 **그 단계의 상한**을 쓴다 — 장부 예약도 provider 요청도 이 값으로 나간다(재시도도 같은 상한)
    const r = await d.call(
      (attempt === 2 ? V2_LEDGER_RETRY_STAGE : V2_LEDGER_STAGE)[stage],
      system, payload, STAGE_MAX_OUTPUT_TOKENS[stage], model,
      STAGE_THINKING_LEVEL[stage] ?? undefined,
    )
    const code = String(r.errorCode ?? '')
    return {
      /**
       * 🔴 **정산 줄을 못 적었으면 완주가 아니다** (2026-09-20).
       *    provider 가 성공해도 장부에 안 적혔으면 금액을 모르는 글이다 —
       *    그런 글이 후보·캐시·AUTO_ADOPT 로 가지 않게 여기서 막는다.
       */
      ok: r.ok && r.settlementRecorded,
      rawText: r.rawText, truncated: r.maxTokensReached,
      usageKnown: r.usageKnown && r.settlementRecorded,
      inputTokens: r.inputTokens, outputTokens: r.outputTokens, thoughtsTokens: r.reasoningTokens,
      /**
       * 🔴 **영속 장부가 정산한 금액을 그대로 싣는다** (2026-09-20).
       *    여기서 두 번째로 계산하지 않는다. 정산하지 못한 건은 `null` 이다. 0원이 아니다 —
       *    예약액으로 채우지도 않는다.
       */
      usd: r.settledUsd,
      blocked: code === 'NO_LEDGER' || code.startsWith(`${LEDGER_BLOCKED}:`),
      // 🔴 timeout · 네트워크 · 429 · 5xx 만 일시 실패다 — 판정은 `generation-failure` 하나가 한다
      errorCode: code === '' ? null : code,
    }
  }
}
