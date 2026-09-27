/**
 * 🔴 **의미 감사 제공사** (2026-09-27) — 인터페이스(`SemanticAuditProvider`) 뒤의 구현 둘
 *
 *   · `offSemanticProvider` — **기본값.** 부르지 않는다. 결과는 "측정 불가" → 감사 결함 yes 다.
 *   · `paidSemanticProvider` — 공급 장부(`SupplyLlmSession`)를 **반드시** 지난다.
 *     사전 계산 → 예약 → 오늘 여력 대조 → 요청 → 정산. 예산 env 가 없으면 요청 전에 막힌다.
 *
 * 🔴 **유료는 `SORAN_AUTO_READY_SEMANTIC_PAID=on` 일 때만** 고른다. 그 값은 어디에도 설정돼 있지 않다.
 * 🔴 CI 는 이 파일의 유료 경로를 **실제로 지난다** — `fetch` 를 가로채는 가짜 제공사(fake-provider-hook)로.
 *    그래서 장부·예산 차단·정산 실패가 가짜보다 약하게 시험되지 않는다.
 */
import {
  SEMANTIC_AUDIT_MODEL, SEMANTIC_PAID_ENV, semanticPaidEnabled, type SemanticAuditProvider,
} from '../../src/lib/auto-ready-semantic-audit'
import { SupplyLlmSession, limitsFromEnv, missingBudgetEnvNames } from './supply-llm-call.mjs'

export const offSemanticProvider: SemanticAuditProvider = {
  model: SEMANTIC_AUDIT_MODEL,
  complete: async () => ({ ok: false, code: 'PAID_OFF', reason: `${SEMANTIC_PAID_ENV} 가 꺼져 있다 — 유료 호출 0` }),
}

/** 🔴 한 요청 = 장부 한 건. 잘렸거나 정산을 못 적었으면 성공이 아니다 */
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
       * 🔴 **정산 금액을 모르면 완주가 아니다** — 공급 장부의 규칙 그대로다(사용량 미상은 예약을 풀지 않는다).
       *    응답이 왔어도 이 감사는 측정 불가(→ yes)다. 금액을 모르는 요청을 "이상 없음" 의 근거로 쓰지 않는다.
       */
      if (r.settledUsd === null) return { ok: false, code: 'USAGE_UNKNOWN', reason: '제공사 사용량을 읽지 못해 정산하지 못했다' }
      return { ok: true, text: r.rawText }
    },
  }
}

export type ProviderChoice = { provider: SemanticAuditProvider; session: SupplyLlmSession | null; describe: string }

/**
 * 🔴 **env 로 고른다 — 기본 OFF.** 켜져 있어도 예산 env 이름이 비면 그 사실을 적는다
 *    (요청은 장부가 막는다 — 여기서 따로 막지 않는다. 막는 자리는 하나다).
 */
export function semanticProviderFromEnv(env: NodeJS.ProcessEnv, runId: string): ProviderChoice {
  if (!semanticPaidEnabled(env)) {
    return { provider: offSemanticProvider, session: null, describe: `의미 감사 유료 호출 OFF (${SEMANTIC_PAID_ENV}) — 측정 불가는 결함 yes 로 기록된다` }
  }
  const limits = limitsFromEnv(env)
  const missing = missingBudgetEnvNames(limits)
  const session = new SupplyLlmSession({ runId, limits })
  return {
    provider: paidSemanticProvider(session), session,
    describe: `의미 감사 유료 호출 ON · ${SEMANTIC_AUDIT_MODEL}${missing.length > 0 ? ` · 🔴 예산 env 없음 ${missing.join(', ')} — 장부가 요청 전에 막는다` : ''}`,
  }
}
