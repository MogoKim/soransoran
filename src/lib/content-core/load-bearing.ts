/**
 * 🔴 **load-bearing 은 "무조건 실패" 가 아니다** (2026-09-23 마스터 지적)
 *
 *   앞판: `planAxisMapping` 이 `role === 'loadBearing'` 을 보면 **Persona 사실을
 *   비교하기도 전에** 실패를 냈다. 그런데 재계획은 "실패한 사람을 빼고 다음 사람" 이었다.
 *   사람을 바꿔도 같은 자리에서 같은 이유로 또 실패한다 — **성공 가능성이 0 이다.**
 *   실측(2026-09-23): P01 → P02 → P03 을 차례로 태우고 4회차에 멈췄다.
 *   재계획이 아니라 **세 번의 불필요한 유료 반복**이었다.
 *
 * 🔴 **다음 시도에 무엇이 실제로 달라지는가**로 가른다.
 *
 *   ① 그 조건을 만족하는 **다른 후보가 있다**      → 그 사람으로 다시 계획 (retry)
 *   ② 만족하는 후보가 **없다** · 아직 1인칭이다     → **자리(stance)** 를 바꿔 다시 계획 (retry)
 *   ③ 1인칭을 이미 포기했는데도 안 된다 · 활성화되지 않은 축이다 → **한 번에 결론** (terminal)
 *
 * 🔴 **유료 호출을 더 쓰지 않는다.** 이 판정은 전부 결정적이다 —
 *    가진 후보 카드와 원문 값만 본다. 다음 시도의 계획 요청에 그 결론을 **입력으로** 싣는다.
 */
import type { SpeakerRelativeAxis } from './speaker-relative-facts'
import { AXIS_LABEL } from './speaker-relative-facts'

/**
 * 🔴 **이 브랜치가 완결한 축은 나이 하나다.** 혼인·자녀·직업·지역·갱년기 변환은
 *    아직 활성화하지 않는다 — 활성화하지 않은 축이 load-bearing 이면 결론이다.
 */
export const ACTIVATED_AXES = ['age'] as const satisfies readonly SpeakerRelativeAxis[]

export const LOAD_BEARING_RETRY_CODES = ['PERSONA_MISMATCH', 'SELF_IMPOSSIBLE'] as const
export const LOAD_BEARING_TERMINAL_CODES = ['AXIS_NOT_ACTIVATED', 'MEANING_UNPRESERVABLE'] as const
export type LoadBearingRetryCode = (typeof LOAD_BEARING_RETRY_CODES)[number]
export type LoadBearingTerminalCode = (typeof LOAD_BEARING_TERMINAL_CODES)[number]

export type LoadBearingFact = { axis: SpeakerRelativeAxis; sourceText: string }
/** 🔴 **그날 계산된 나이**를 받는다 — 정적 카드 값이 아니다 */
export type LoadBearingCandidate = { code: string; exactAge: number | null }

export type LoadBearingPlan =
  /** 🔴 1인칭이 아니다 — 그 값을 **우리 것으로 주장하지 않으므로** 바꿀 필요가 없다 */
  | { ok: true; kind: 'notClaimed'; note: string }
  /** 🔴 고른 사람이 그 조건을 **실제로 만족한다** — 원문 값이 곧 우리 값이다 */
  | { ok: true; kind: 'personaSatisfies'; note: string }
  | {
    ok: false; retry: true; code: LoadBearingRetryCode
    axis: SpeakerRelativeAxis; reason: string
    /** 🔴 `PERSONA_MISMATCH` 일 때 **실제로 조건을 만족하는** 후보들 */
    suggest: string[]
    /** 🔴 `SELF_IMPOSSIBLE` 일 때 다음 계획이 1인칭을 쓰지 못하게 한다 */
    forbidSelf: boolean
  }
  | {
    ok: false; retry: false; code: LoadBearingTerminalCode
    axis: SpeakerRelativeAxis; reason: string
  }

/** 🔴 원문 표현에서 나이 숫자만 꺼낸다. 못 꺼내면 `null` — 지어내지 않는다 */
export function sourceAgeNumber(sourceText: string): number | null {
  const m = /(\d{2})/.exec(sourceText)
  if (m === null) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n >= 20 && n <= 99 ? n : null
}

/**
 * 🔴 **한 번에 판정한다.** 세 명을 차례로 태우지 않는다.
 *
 * @param facts        계획이 `loadBearing` 이라고 적어 낸 화자 상대 사실들
 * @param stance       이번 계획이 고른 자리
 * @param chosen       이번 계획이 고른 사람의 그날 나이
 * @param candidates   이번 회차에 **실제로 제안된** 후보 전부 (그날 나이 포함)
 * @param selfAlreadyFailed 지난 시도에서 이미 "1인칭 불가" 로 멈췄는가
 */
export function resolveLoadBearing(input: {
  facts: readonly LoadBearingFact[]
  stance: string | null
  chosen: LoadBearingCandidate
  candidates: readonly LoadBearingCandidate[]
  selfAlreadyFailed: boolean
}): LoadBearingPlan {
  for (const f of input.facts) {
    /**
     * 🔴 **활성화하지 않은 축은 결론이다.** 이 브랜치는 나이만 완결한다 —
     *    혼인·직업을 여기서 바꾸기 시작하면 검증하지 않은 변환이 발행으로 나간다.
     */
    if (!(ACTIVATED_AXES as readonly string[]).includes(f.axis)) {
      return {
        ok: false, retry: false, code: 'AXIS_NOT_ACTIVATED', axis: f.axis,
        reason: `🔴 ${AXIS_LABEL[f.axis]} 는 이 판에서 변환하지 않는다 — 결론이다`,
      }
    }
    /**
     * 🔴 **1인칭이 아니면 바꿀 것이 없다.** 관찰·질문 자리에서는 그 나이를
     *    우리 것으로 주장하지 않는다 — 원문 이야기의 값으로 남는다.
     */
    if (input.stance !== 'SELF_EXPERIENCE') continue

    const want = sourceAgeNumber(f.sourceText)
    if (want === null) {
      return {
        ok: false, retry: false, code: 'MEANING_UNPRESERVABLE', axis: f.axis,
        reason: `🔴 원문 값을 숫자로 읽지 못했다 — "${f.sourceText}". 보존 여부를 확인할 수 없다`,
      }
    }
    if (input.chosen.exactAge === want) continue

    // 🔴 **조건을 실제로 만족하는 후보가 있는가** — 있으면 그 사람으로 다시 계획한다
    const fit = input.candidates
      .filter((c) => c.exactAge === want && c.code !== input.chosen.code)
      .map((c) => c.code)
    if (fit.length > 0) {
      return {
        ok: false, retry: true, code: 'PERSONA_MISMATCH', axis: f.axis, suggest: fit,
        forbidSelf: false,
        reason: `🔴 ${AXIS_LABEL[f.axis]} ${want} 가 글의 결론을 바꾸는데 `
          + `${input.chosen.code}(${input.chosen.exactAge ?? '?'}) 는 그 조건이 아니다 `
          + `— 만족하는 후보 ${fit.join(' ')}`,
      }
    }
    /**
     * 🔴 **만족하는 사람이 없다.** 그래도 소재는 남는다 — 1인칭을 버리고
     *    관찰·질문 자리로 쓰면 뜻이 보존된다. 다음 계획에 그것을 **입력으로** 준다.
     *    🔴 이미 한 번 그렇게 돌려보냈는데 또 1인칭으로 왔으면 결론이다.
     */
    if (input.selfAlreadyFailed) {
      return {
        ok: false, retry: false, code: 'MEANING_UNPRESERVABLE', axis: f.axis,
        reason: `🔴 1인칭을 금지한 뒤에도 1인칭 계획이 왔다 — `
          + `${AXIS_LABEL[f.axis]} ${want} 를 보존할 길이 없다`,
      }
    }
    return {
      ok: false, retry: true, code: 'SELF_IMPOSSIBLE', axis: f.axis, suggest: [],
      forbidSelf: true,
      reason: `🔴 ${AXIS_LABEL[f.axis]} ${want} 를 만족하는 후보가 없다 `
        + `— 1인칭을 버리고 다른 자리로 계획한다`,
    }
  }
  return input.stance === 'SELF_EXPERIENCE'
    ? { ok: true, kind: 'personaSatisfies', note: '고른 사람이 그 조건을 만족한다 — 원문 값이 곧 우리 값이다' }
    : { ok: true, kind: 'notClaimed', note: '1인칭이 아니다 — 그 값을 우리 것으로 주장하지 않는다' }
}


// ─────────────────────────────────────────────────────────
// 🔴 **보존 계약** (2026-09-23 마스터 P0-2)
//
//   `resolveLoadBearing` 이 통과시켜도 그것만으로는 부족하다. 원문 자기 나이는
//   `protectedFacts` 에서 이미 걷어내졌고 `planAxisMapping` 은 load-bearing 을
//   건너뛴다 — 그래서 **최종 글에서 그 조건이 통째로 사라질 수 있다.**
//   의미 검수가 "깨끗하다" 고 답해도 그 사실은 드러나지 않는다.
//
// 🔴 그래서 요구사항을 **값으로 만들어** 초안 지시문과 결정적 후조건이 **함께** 쓴다.
// 🔴 incidental 변환 경로와 섞지 않는다 — 저쪽은 "바꿔라", 이쪽은 "지켜라" 다.
// ─────────────────────────────────────────────────────────

export type LoadBearingMode =
  /** 🔴 1인칭 조건 — 그 나이가 **우리 화자의 나이로** 남아야 한다 */
  | 'selfCondition'
  /** 🔴 사건 조건 — 그 나이가 **글 안에 남되 우리 나이로 주장하지 않는다** */
  | 'eventCondition'

export type LoadBearingRequirement = {
  axis: SpeakerRelativeAxis
  /** 원문에 있던 그 값 */
  sourceText: string
  age: number
  mode: LoadBearingMode
  /** 🔴 초안 지시문에 그대로 들어가는 한 줄 */
  outputRule: string
}

/**
 * 🔴 **통과한 load-bearing 사실을 보존 요구로 바꾼다.**
 *    `resolveLoadBearing` 이 `ok` 를 낸 뒤에만 부른다.
 */
export function loadBearingRequirements(input: {
  facts: readonly LoadBearingFact[]
  stance: string | null
}): LoadBearingRequirement[] {
  const out: LoadBearingRequirement[] = []
  for (const f of input.facts) {
    const age = sourceAgeNumber(f.sourceText)
    if (age === null) continue
    const mode: LoadBearingMode = input.stance === 'SELF_EXPERIENCE'
      ? 'selfCondition' : 'eventCondition'
    out.push({
      axis: f.axis, sourceText: f.sourceText, age, mode,
      outputRule: mode === 'selfCondition'
        ? `🔴 ${AXIS_LABEL[f.axis]} **${age}** 은 글의 결론을 만드는 조건이다. `
          + `바꾸지 말고 **"${age}"** 를 1인칭으로 그대로 쓴다(우리 화자도 그 나이다).`
        : `🔴 ${AXIS_LABEL[f.axis]} **${age}** 은 글의 결론을 만드는 조건이다. `
          + `**"${age}"** 를 글에 남기되, **자기 나이라고 쓰지 않는다**(들은 이야기·조건으로 적는다).`,
    })
  }
  return out
}

export type LoadBearingPostVerdict =
  | { ok: true; note: string }
  | { ok: false; code: 'CONDITION_LOST' | 'CONDITION_NOT_SELF' | 'CONDITION_CLAIMED_AS_SELF'; reason: string }

/**
 * 🔴 **최종 글에 조건이 남았는가 — 결정적으로 본다.**
 *
 *    의미 검수가 `clean` 이라고 답해도 여기서 막는다. 모델의 답은 근거가 아니다.
 *
 * @param selfClaim 글쓴이가 **자기 입으로 밝힌 나이 구간** — 정본 `readSelfAgeClaim` 결과.
 *   🔴 새 정규식을 만들지 않는다. 그 정본은 전언(`…라던데`)·명사 수식(`51세 지원자가`)·
 *      타인 표지를 이미 가른다 — 여기서 다시 세면 *"51세부터 대상이라던데"* 가
 *      우리 나이 주장으로 잘못 잡힌다(실측).
 */
export function checkLoadBearingPreserved(input: {
  text: string
  requirements: readonly LoadBearingRequirement[]
  selfClaim: { from: number; to: number } | null
}): LoadBearingPostVerdict {
  const claims = (n: number): boolean =>
    input.selfClaim !== null && input.selfClaim.from <= n && n <= input.selfClaim.to
  for (const r of input.requirements) {
    // 🔴 글자 자체가 사라졌는가 — 통째로 뺀 경우다
    if (!new RegExp(`(^|[^0-9])${r.age}([^0-9]|$)`).test(input.text)) {
      return {
        ok: false, code: 'CONDITION_LOST',
        reason: `조건이 된 ${AXIS_LABEL[r.axis]} ${r.age} 가 글에서 사라졌다`,
      }
    }
    if (r.mode === 'selfCondition' && !claims(r.age)) {
      return {
        ok: false, code: 'CONDITION_NOT_SELF',
        reason: `${r.age} 가 1인칭 조건으로 쓰이지 않았다 — 밝힌 나이 ${
          input.selfClaim === null ? '없음' : `${input.selfClaim.from}~${input.selfClaim.to}`}`,
      }
    }
    if (r.mode === 'eventCondition' && claims(r.age)) {
      return {
        ok: false, code: 'CONDITION_CLAIMED_AS_SELF',
        reason: `${r.age} 를 우리 화자의 나이로 주장했다 — 1인칭 자리가 아니다`,
      }
    }
  }
  return {
    ok: true,
    note: input.requirements.length === 0
      ? '보존할 조건이 없다' : `${input.requirements.length}개 조건이 글에 남았다`,
  }
}
