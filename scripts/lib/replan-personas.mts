/**
 * 🔴 **다음 시도에 누구를 보낼지 정하는 한 곳** (2026-09-23)
 *
 *    앞판은 화자 탓 실패를 `retryable` 로만 표시했다. 그러면 다음 회차가 **같은 사람**을
 *    또 골라 같은 실패를 되풀이한다 — 유료 호출만 쓰고 끝난다.
 *
 * 🔴 **여기 하나만 둔다.** 러너와 검사가 읽는 코드를 따로 두면 검사는 구현을 흉내 낸
 *    것이 되고, 러너만 틀려도 검사는 통과한다. `prior-outcomes` 와 같은 이유다.
 *
 * 🔴 **유료 호출보다 앞이다.** `ok: false` 면 러너는 만들지 않고 넘어간다 —
 *    같은 원천을 무한히 다시 사는 경로를 여기서 끊는다.
 */
import { planReplan, type PriorOutcome, type ReplanPlan } from '../../src/lib/supply-workset'
import type { PriorPlanFailure } from '../../src/lib/content-core/replan-input'

/** 🔴 화자 하나 — 코드만 본다. 카드 전체를 알 필요가 없다 */
export type PersonaCoded = { code: string }

/**
 * 🔴 **같은 원천의 지난 시도만 모은다.** 생성 단계(`draft`)만이다 —
 *    판정 단계에는 화자가 없다.
 *
 * 🔴 오래된 순으로 낸다. `planReplan` 이 시도 수를 세기 때문이다.
 */
export function attemptsForSource(
  outcomes: readonly PriorOutcome[], sourceKey: string,
): {
  failedPersonaCode?: string | null; failedStance?: string | null; failedCause?: string | null
  suggestedPersonaCodes?: readonly string[]
}[] {
  return outcomes
    // 🔴 원천 열쇠(사이트, id)로 대 본다 — 같은 번호 다른 사이트의 실패 화자를 빼지 않는다(P0-B)
    .filter((o) => o.sourceKey === sourceKey && o.stage === 'draft')
    .sort((a, b) => a.atMs - b.atMs)
    .map((o) => ({
      failedPersonaCode: o.failedPersonaCode,
      failedStance: o.failedStance,
      failedCause: o.failedCause,
      suggestedPersonaCodes: o.suggestedPersonaCodes ?? [],
    }))
}

export type PersonaPick<T extends PersonaCoded = PersonaCoded> =
  | {
    ok: true; personas: T[]; excluded: string[]; attempt: number
    /**
     * 🔴 **다음 계획기가 받을 지난 실패** (2026-09-23 마스터 지적).
     *    사람만 빼면 계획기는 같은 1인칭 계획을 또 세운다.
     */
    priorFailures: PriorPlanFailure[]
  }
  | {
    ok: false
    code: 'EXHAUSTED' | 'ATTEMPT_CAP' | 'CONCLUDED' | 'SUGGESTED_UNAVAILABLE'
    reason: string; excluded: string[]
  }

/**
 * 🔴 **이번 시도에 보낼 화자 묶음.**
 *    · 지난 시도에서 **화자 탓으로** 실패한 사람은 뺀다
 *    · 남은 사람이 없거나 시도 상한을 넘으면 `ok: false` — 만들지 않는다
 *    · 뺐는데도 남은 사람이 있으면 **실제로 다른 사람**이 나간다
 */
export function personasForAttempt<T extends PersonaCoded>(input: {
  outcomes: readonly PriorOutcome[]
  /** 🔴 원천 열쇠(`sourceKeyOf`) */
  sourceKey: string
  /** 이 원천에 배정된 화자 코드 (여력 계획이 좁힌 묶음) */
  slotCodes: readonly string[]
  /** 🔴 전체 후보 — 여기서 골라 보낸다. **카드를 그대로 낸다**(형을 깎지 않는다) */
  candidates: readonly T[]
  attemptMax?: number
}): PersonaPick<T> {
  /**
   * 🔴 **이미 결론난 원천은 만들지 않는다** (2026-09-23).
   *    운영에서는 공급 러너가 `concludedSourceIds` 로 먼저 거른다. 그래도 여기서
   *    한 번 더 본다 — 묶음 파일을 손으로 주는 경로가 있고, 그때 결론난 원천에
   *    **유료 호출이 또 나가면** "한 번에 결론" 이라는 계약이 거짓이 된다.
   */
  const concluded = input.outcomes.some(
    (o) => o.sourceKey === input.sourceKey && o.stage === 'draft' && o.state === 'terminal',
  )
  if (concluded) {
    return {
      ok: false, code: 'CONCLUDED', excluded: [],
      reason: '이 원천은 이미 결론이 났다 — 다시 만들지 않는다',
    }
  }
  const attempts = attemptsForSource(input.outcomes, input.sourceKey)
  const plan: ReplanPlan = planReplan({
    attempts, eligible: input.slotCodes, attemptMax: input.attemptMax,
  })
  if (!plan.ok) return plan
  /**
   * 🔴 **지난 회차가 지목한 후보가 있으면 그 안에서만 고른다** (2026-09-23 마스터 P0-3).
   *
   *    앞판은 추천이 사람이 읽는 문구에만 있었다 — 다음 회차가 정렬 순서대로
   *    **또 다른 불일치 Persona** 를 골랐다. 지목이 있으면 그것이 곧 후보 집합이다.
   *    🔴 지목한 사람이 더 이상 적격하지 않으면 **조용히 전체로 돌아가지 않는다.**
   */
  const lastSuggest = [...attempts].reverse()
    .map((a) => a.suggestedPersonaCodes ?? [])
    .find((x) => x.length > 0) ?? []
  const allowed = lastSuggest.length === 0
    ? input.slotCodes
    : input.slotCodes.filter((c) => lastSuggest.includes(c))
  if (lastSuggest.length > 0 && allowed.length === 0) {
    return {
      ok: false, code: 'SUGGESTED_UNAVAILABLE', excluded: plan.excluded,
      reason: `지목된 후보 ${lastSuggest.join(' ')} 가 이번 묶음에 없다`
        + ' — 조건을 만족하지 않는 사람으로 대체하지 않는다',
    }
  }
  const personas = input.candidates.filter(
    (c) => allowed.includes(c.code) && !plan.excluded.includes(c.code),
  )
  /**
   * 🔴 **묶음이 비면 만들지 않는다.** `planReplan` 은 코드 목록만 보고 남은 사람이
   *    있다고 했는데 후보 카드가 없을 수 있다 — 그러면 빈 묶음이 유료로 나간다.
   */
  if (personas.length === 0) {
    return {
      ok: false, code: 'EXHAUSTED',
      reason: '제외하고 남은 화자의 카드가 없다', excluded: plan.excluded,
    }
  }
  return {
    ok: true, personas, excluded: plan.excluded, attempt: plan.attempt,
    priorFailures: attempts.map((a): PriorPlanFailure => ({
      personaCode: a.failedPersonaCode ?? null,
      stance: a.failedStance ?? null,
      cause: a.failedCause ?? null,
    })),
  }
}
