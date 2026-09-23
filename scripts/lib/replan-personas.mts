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

/** 🔴 화자 하나 — 코드만 본다. 카드 전체를 알 필요가 없다 */
export type PersonaCoded = { code: string }

/**
 * 🔴 **같은 원천의 지난 시도만 모은다.** 생성 단계(`draft`)만이다 —
 *    판정 단계에는 화자가 없다.
 *
 * 🔴 오래된 순으로 낸다. `planReplan` 이 시도 수를 세기 때문이다.
 */
export function attemptsForSource(
  outcomes: readonly PriorOutcome[], sourceArticleId: string,
): { failedPersonaCode?: string | null; failedCause?: string | null }[] {
  return outcomes
    .filter((o) => o.sourceArticleId === sourceArticleId && o.stage === 'draft')
    .sort((a, b) => a.atMs - b.atMs)
    .map((o) => ({ failedPersonaCode: o.failedPersonaCode, failedCause: o.failedCause }))
}

export type PersonaPick<T extends PersonaCoded = PersonaCoded> =
  | { ok: true; personas: T[]; excluded: string[]; attempt: number }
  | { ok: false; code: 'EXHAUSTED' | 'ATTEMPT_CAP'; reason: string; excluded: string[] }

/**
 * 🔴 **이번 시도에 보낼 화자 묶음.**
 *    · 지난 시도에서 **화자 탓으로** 실패한 사람은 뺀다
 *    · 남은 사람이 없거나 시도 상한을 넘으면 `ok: false` — 만들지 않는다
 *    · 뺐는데도 남은 사람이 있으면 **실제로 다른 사람**이 나간다
 */
export function personasForAttempt<T extends PersonaCoded>(input: {
  outcomes: readonly PriorOutcome[]
  sourceArticleId: string
  /** 이 원천에 배정된 화자 코드 (여력 계획이 좁힌 묶음) */
  slotCodes: readonly string[]
  /** 🔴 전체 후보 — 여기서 골라 보낸다. **카드를 그대로 낸다**(형을 깎지 않는다) */
  candidates: readonly T[]
  attemptMax?: number
}): PersonaPick<T> {
  const attempts = attemptsForSource(input.outcomes, input.sourceArticleId)
  const plan: ReplanPlan = planReplan({
    attempts, eligible: input.slotCodes, attemptMax: input.attemptMax,
  })
  if (!plan.ok) return plan
  const personas = input.candidates.filter(
    (c) => input.slotCodes.includes(c.code) && !plan.excluded.includes(c.code),
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
  return { ok: true, personas, excluded: plan.excluded, attempt: plan.attempt }
}
