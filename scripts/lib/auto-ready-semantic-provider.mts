/**
 * 🔴 **의미 감사 제공사** (2026-09-27 · 2026-09-28 감사 전용 예산) — 인터페이스(`SemanticAuditProvider`) 뒤의 구현 둘
 *
 *   · `offSemanticProvider` — **기본값.** 부르지 않는다. 결과는 재시도 가능 실패(`PAID_OFF`)다 — 결함이 아니다.
 *   · `paidSemanticProvider` — 장부(`SupplyLlmSession`)를 **반드시** 지난다.
 *     사전 계산 → 예약 → 오늘 여력 대조 → 요청 → 정산. 판정 규칙은 공급 장부와 같다(`llm-ledger`).
 *
 * 🔴 **감사 전용 장부 · 감사 전용 예산** (2026-09-28 마스터 결정). 감사는 공급과 **다른 디렉터리**
 *    (`auditLedgerDir`)에 적는다. 장부 판정은 그 디렉터리의 하루 파일만 세므로 —
 *      · 공급 지출이 감사 여력을 줄이지 않는다
 *      · 감사 지출이 공급 여력을 줄이지 않는다
 *    예산 env 는 `AUDIT_BUDGET_ENV` 셋이다(공급의 `SORAN_LLM_*` 를 읽지 않는다). 하나라도 비면
 *    **요청을 만들지도 않는다**(사전 계산도 0) → 재시도 가능 실패 `AUDIT_BUDGET_UNSET`.
 *
 * 🔴 유료는 `SORAN_AUTO_READY_SEMANTIC_PAID=on` 일 때만. 그 값도 예산 env 도 어디에도 설정돼 있지 않다.
 * 🔴 CI 는 유료 경로를 **실제로 지난다** — `fetch` 를 가로채는 가짜 제공사(fake-provider-hook)로.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  AUDIT_BUDGET_ENV, SEMANTIC_AUDIT_MODEL, SEMANTIC_PAID_ENV, semanticPaidEnabled, type SemanticAuditProvider,
} from '../../src/lib/auto-ready-semantic-audit'
import type { BudgetLimits } from '../../src/lib/llm-ledger'
import { BUDGET_ENV, SupplyLlmSession, limitsFromEnv } from './supply-llm-call.mjs'

/** 🔴 감사 전용 장부 디렉터리 — 공급 장부(`defaultLedgerDir`)와 형제이고 섞이지 않는다 */
export function auditLedgerDir(home: string = homedir()): string {
  return join(home, 'Library', 'Application Support', 'soransoran', 'auto-ready-audit-ledger')
}

/**
 * 🔴 **감사 예산 — 공급과 같은 해석 규칙**(`limitsFromEnv`: 양수 · 요청 수는 정수 · 못 읽으면 null)을
 *    **감사 env 이름**으로 부른다. 공급 env 는 넘기지 않는다 — 공급 값이 있어도 감사 예산이 되지 않는다.
 */
export function auditLimitsFromEnv(env: NodeJS.ProcessEnv): BudgetLimits {
  return limitsFromEnv({
    [BUDGET_ENV.dailyUsd]: env[AUDIT_BUDGET_ENV.dailyUsd],
    [BUDGET_ENV.runRequestCap]: env[AUDIT_BUDGET_ENV.runRequestCap],
    [BUDGET_ENV.headroomMultiplier]: env[AUDIT_BUDGET_ENV.headroomMultiplier],
  })
}
export function missingAuditBudgetEnv(limits: BudgetLimits): string[] {
  const names: string[] = []
  if (limits.dailyUsd === null) names.push(AUDIT_BUDGET_ENV.dailyUsd)
  if (limits.runRequestCap === null) names.push(AUDIT_BUDGET_ENV.runRequestCap)
  if (limits.headroomMultiplier === null) names.push(AUDIT_BUDGET_ENV.headroomMultiplier)
  return names
}

export const offSemanticProvider: SemanticAuditProvider = {
  model: SEMANTIC_AUDIT_MODEL,
  complete: async () => ({ ok: false, code: 'PAID_OFF', reason: `${SEMANTIC_PAID_ENV} 가 꺼져 있다 — 유료 호출 0` }),
}

/** 🔴 예산 env 가 비었다 — 요청을 만들지 않는다(사전 계산 0 · 유료 0) */
export function budgetUnsetProvider(missing: readonly string[]): SemanticAuditProvider {
  return {
    model: SEMANTIC_AUDIT_MODEL,
    complete: async () => ({ ok: false, code: 'AUDIT_BUDGET_UNSET', reason: `감사 예산 env 없음 — ${missing.join(', ')}` }),
  }
}

/** 🔴 한 요청 = 장부 한 건. 막혔거나 잘렸거나 정산을 못 적었으면 성공이 아니다(각자 원인 코드) */
export function paidSemanticProvider(session: SupplyLlmSession): SemanticAuditProvider {
  return {
    model: SEMANTIC_AUDIT_MODEL,
    complete: async (req) => {
      const r = await session.call({
        stage: 'semanticAudit', model: SEMANTIC_AUDIT_MODEL,
        systemPrompt: req.systemPrompt, userPayload: req.userPayload,
        maxOutputTokens: req.maxOutputTokens, timeoutMs: req.timeoutMs,
      })
      if (!r.ok) return { ok: false, code: r.errorCode ?? 'PROVIDER_FAILED', reason: r.errorMessage ?? '제공사 실패' }
      if (!r.settlementRecorded) return { ok: false, code: 'SETTLE_NOT_RECORDED', reason: '정산을 장부에 적지 못했다' }
      if (r.maxTokensReached) return { ok: false, code: 'TRUNCATED', reason: '출력 상한에 닿았다 — 잘린 응답이다' }
      /**
       * 🔴 **정산 금액을 모르면 완주가 아니다** — 장부 규칙 그대로다(사용량 미상은 예약을 풀지 않는다).
       *    응답이 왔어도 이 감사는 재시도 가능 실패다. 금액을 모르는 요청을 "이상 없음" 의 근거로 쓰지 않는다.
       */
      if (r.settledUsd === null) return { ok: false, code: 'USAGE_UNKNOWN', reason: '제공사 사용량을 읽지 못해 정산하지 못했다' }
      return { ok: true, text: r.rawText }
    },
  }
}

export type ProviderChoice = { provider: SemanticAuditProvider; session: SupplyLlmSession | null; describe: string }

/** 🔴 **env 로 고른다 — 기본 OFF.** 켜져 있어도 감사 예산 env 가 비면 요청하지 않는 제공사다 */
export function semanticProviderFromEnv(env: NodeJS.ProcessEnv, runId: string, home: string = homedir()): ProviderChoice {
  if (!semanticPaidEnabled(env)) {
    return { provider: offSemanticProvider, session: null, describe: `의미 감사 유료 호출 OFF (${SEMANTIC_PAID_ENV}) — 재시도 가능 실패로 남고 자동 회차는 닫힌다` }
  }
  const limits = auditLimitsFromEnv(env)
  const missing = missingAuditBudgetEnv(limits)
  if (missing.length > 0) {
    return { provider: budgetUnsetProvider(missing), session: null, describe: `의미 감사 유료 ON · 🔴 감사 예산 env 없음 ${missing.join(', ')} — 요청 0` }
  }
  const session = new SupplyLlmSession({ runId, limits, dir: auditLedgerDir(home) })
  return { provider: paidSemanticProvider(session), session, describe: `의미 감사 유료 ON · ${SEMANTIC_AUDIT_MODEL} · 감사 전용 장부` }
}
