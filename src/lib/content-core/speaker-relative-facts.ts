import { ageMentionsIn } from '../persona-self-age'

/**
 * 🔴 **원문 작성자를 복제하지 않는다** (2026-09-23 정본).
 *
 *   소란소란은 인기 있는 원문의 **소재·상황**을 고르고, 그것을 우리 Persona 의
 *   생활사와 말투로 **다시 쓴다.** 원문 작성자의 개인 사실을 옮겨 적는 것이 아니다.
 *
 * 🔴 **실패 사슬** (후보 `cmudal78h…` · P02 · 2026-09-23 실측)
 *   ```
 *   ① source evidence   "낼44인데 아직도 어리단소리들어요 ㅋ"
 *   ② plan.selfBasis    noLifeFactNeeded
 *   ③ protectedFacts    [{kind:'number', text:'80퍼'}, {kind:'number', text:'44'}]   ← 🔴 여기
 *   ④ plan.warrants     []
 *   ⑤ draft.body        "제가 곧 44인데 아직 어리다는 소리도 듣고 그래요."
 *   ⑥ lifeContradictions []                                                          ← 못 잡았다
 *   ```
 *   🔴 **원인**: `protectedFacts` 검증(`readSpeakerPlan`)은 "증거에 있는가 · 개인정보인가 ·
 *      kind 가 맞는가" 만 본다. **"이것이 원문 화자 자신의 사실인가" 를 묻는 단계가 없다.**
 *      그래서 44 가 `source-invariant`(지켜야 할 숫자)로 잘못 분류돼 초안까지 그대로 갔다.
 *
 * 🔴 **축마다 패치하지 않는다.** 나이·혼인·자녀·직업·지역·부모돌봄·갱년기는 전부 같은 종류다.
 *    한 계약으로 다룬다.
 */

/** 🔴 화자가 누구냐에 따라 달라지는 사실 — **원문 값을 지키지 않는다** */
export const SPEAKER_RELATIVE_AXES = [
  'age', 'maritalStatus', 'children', 'work', 'region', 'parentCare', 'menopause',
] as const
export type SpeakerRelativeAxis = (typeof SPEAKER_RELATIVE_AXES)[number]

export const AXIS_LABEL: Readonly<Record<SpeakerRelativeAxis, string>> = {
  age: '화자 자신의 나이',
  maritalStatus: '혼인 상태',
  children: '자녀',
  work: '직업',
  region: '지역',
  parentCare: '부모 돌봄',
  menopause: '갱년기 상태',
}

/**
 * 🔴 **의미를 성립시키는 것은 지킨다.** 나이가 결론을 바꾸는 소재
 *    (의료 판단·임신·법률·보험·지원 자격·연령 제한)에서는 숫자만 바꾸지 않는다.
 *    🔴 광범위 금지 낱말 목록을 새로 만들지 않는다 — **결론을 바꾸는가**만 묻는다.
 */
export type FactRole =
  /** 부수 정보 — 바꿔도 글의 뜻이 그대로다 (피부·패션·일상·감정) */
  | 'incidental'
  /** 핵심 조건 — 바꾸면 글이 성립하지 않는다 (지원 자격·연령 제한 …) */
  | 'loadBearing'

export type SpeakerRelativeFact = {
  axis: SpeakerRelativeAxis
  /** 원문에 있던 표현 그대로 */
  sourceText: string
  role: FactRole
}

export type PersonaFacts = {
  /** 🔴 정확한 나이. 없으면 `null` 이고 그때는 연령대까지만 쓴다 */
  exactAge: number | null
  ageBand: string | null
  maritalStatus: string | null
  childrenCount: number | null
  parentCare: string | null
  menopauseStatus: string | null
  work: string | null
  region: string | null
}

export type AxisMapping = {
  axis: SpeakerRelativeAxis
  sourceText: string
  /** 우리 Persona 로 바꾼 표현. `null` 이면 바꿀 값이 없다 */
  personaText: string | null
  /** 생성기에 주는 한 줄 지시 */
  outputRule: string
}

/** 🔴 실패 이유 — **문자열을 파싱하지 않는다.** 부르는 쪽이 이 코드로 분기한다 */
/**
 * 🔴 `LOAD_BEARING` 은 **이 함수가 더 이상 내지 않는다** (2026-09-23). 판정 자리가
 *    `resolveLoadBearing` 으로 옮겨졌다. 옛 artifact 를 읽는 쪽이 있으므로 이름은 남긴다.
 */
export const MAPPING_FAIL_CODES = ['LOAD_BEARING', 'NO_PERSONA_VALUE', 'UNKNOWN_AXIS'] as const
export type MappingFailCode = (typeof MAPPING_FAIL_CODES)[number]

export type MappingPlan =
  | { ok: true; mappings: AxisMapping[]; note: string }
  | { ok: false; code: MappingFailCode; axis: SpeakerRelativeAxis; reason: string }

const bandText = (band: string | null): string | null =>
  band === null || band.trim() === '' ? null : band.trim()

/**
 * 🔴 **원문 화자의 사실 → 우리 Persona 의 사실.** 사람 손을 거치지 않는다.
 *
 *    · 정확한 나이가 있으면 그 숫자로 쓴다
 *    · 없으면 **연령대까지만** 쓴다 — 없는 숫자를 지어내지 않는다
 *    · 원문에 그 축이 없으면 **더하지 않는다**
 *    · `loadBearing` 이면 바꾸지 않고 멈춘다
 */
export function planAxisMapping(input: {
  facts: readonly SpeakerRelativeFact[]
  persona: PersonaFacts
}): MappingPlan {
  const mappings: AxisMapping[] = []
  for (const f of input.facts) {
    /**
     * 🔴 **load-bearing 은 여기서 판정하지 않는다** (2026-09-23 마스터 지적).
     *
     *    앞판은 여기서 곧바로 실패를 냈다 — **Persona 사실을 비교하기도 전에**.
     *    그래서 "사람을 바꿔 다시 계획" 이 성공 가능성 0 인 반복이 됐다.
     *    지금은 `resolveLoadBearing` 이 부르는 쪽에서 **한 번에** 판정하고,
     *    여기까지 온 load-bearing 사실은 이미 "고른 사람이 그 조건을 만족한다" 는 뜻이다.
     *    🔴 그러면 **원문 값이 곧 우리 값**이므로 바꿀 것이 없다.
     */
    if (f.role === 'loadBearing') continue
    if (!(SPEAKER_RELATIVE_AXES as readonly string[]).includes(f.axis)) {
      return { ok: false, code: 'UNKNOWN_AXIS', axis: f.axis, reason: `모르는 축이다 — ${String(f.axis)}` }
    }
    const to = personaTextFor(f.axis, input.persona)
    /**
     * 🔴 **우리 쪽 값이 없으면 빈 지시로 넘기지 않는다** (2026-09-23 fail-closed).
     *    앞판은 "그 축을 언급하지 않는다" 로 넘겼는데, 그러면 `protectedFacts` 에서
     *    이미 빠진 사실이 **아무 대체도 없이 사라진다.** 부르는 쪽이 판단하게 올린다.
     */
    if (to === null) {
      return {
        ok: false, code: 'NO_PERSONA_VALUE', axis: f.axis,
        reason: `🔴 ${AXIS_LABEL[f.axis]} 를 바꿔야 하는데 우리 쪽 값이 없다`,
      }
    }
    mappings.push({
      axis: f.axis, sourceText: f.sourceText, personaText: to,
      outputRule: `🔴 ${AXIS_LABEL[f.axis]}: 원문의 "${f.sourceText}" 를 복제하지 않고 **${to}** 로 서술한다`,
    })
  }
  return {
    ok: true, mappings,
    note: mappings.length === 0
      ? '원문에 화자 상대 사실이 없다 — 아무것도 더하지 않는다'
      : `${mappings.length}개 축을 우리 Persona 값으로 바꾼다`,
  }
}

/** 축별로 Persona 정본이 주는 표현. 없으면 `null` */
export function personaTextFor(axis: SpeakerRelativeAxis, p: PersonaFacts): string | null {
  switch (axis) {
    case 'age':
      // 🔴 정확한 나이가 있으면 그것, 없으면 연령대까지만. 지어내지 않는다
      return p.exactAge !== null ? `${p.exactAge}살` : bandText(p.ageBand)
    case 'maritalStatus': return p.maritalStatus
    case 'children':
      if (p.childrenCount === null) return null
      return p.childrenCount === 0 ? '자녀 없음' : `자녀 ${p.childrenCount}`
    case 'work': return p.work
    case 'region': return p.region
    case 'parentCare': return p.parentCare
    case 'menopause': return p.menopauseStatus
  }
}

/**
 * 🔴 **`protectedFacts` 에서 화자 상대 사실을 걷어낸다.**
 *    자기 나이라는 이유만으로 원문 숫자를 지키지 않는다 — 그것이 P02 실패의 원인이다.
 *
 *    🔴 **제3자의 사실은 걷어내지 않는다.** "아는 분이 44인데" 의 44 는 그 사람 것이고
 *       우리 화자와 무관하다. 원문에 있는 그대로 두어야 이야기가 성립한다.
 */
export function stripSpeakerRelative<T extends { kind: string; text: string }>(input: {
  facts: readonly T[]
  /** 각 fact 가 **원문 화자 자신의** 사실인지 판정하는 함수 */
  isSelfFact: (f: T) => SpeakerRelativeAxis | null
}): { kept: T[]; stripped: Array<{ fact: T; axis: SpeakerRelativeAxis }> } {
  const kept: T[] = []
  const stripped: Array<{ fact: T; axis: SpeakerRelativeAxis }> = []
  for (const f of input.facts) {
    const axis = input.isSelfFact(f)
    if (axis === null) kept.push(f)
    else stripped.push({ fact: f, axis })
  }
  return { kept, stripped }
}

/**
 * 🔴 **생성 결과에 원문 화자의 나이가 남았으면 우리 나이로 고친다** (2026-09-23).
 *
 *   모델에게 "바꿔 쓰라" 고 일러도 그대로 베끼는 일이 있다. 그때 곧바로 HOLD 로
 *   태우지 않는다 — **결정적으로 고쳐 보고**, 고친 뒤 다시 검사한다.
 *
 * 🔴 유료 호출을 더 쓰지 않는다. 문자열 치환이다.
 * 🔴 제3자 나이는 고치지 않는다 — 원문 이야기의 일부다.
 * 🔴 원문에 나이가 없으면 나이를 **새로 더하지 않는다** (바꿀 대상이 없으면 아무것도 안 한다).
 */
export type AgeFixResult = {
  text: string
  /** 바꾼 자리 수 */
  fixed: number
  /** 아직 남은 원문 나이 표현 */
  remaining: string[]
}

export function fixSourceSpeakerAge(input: {
  text: string
  /** 원문 화자가 말한 나이 표현들 (계획이 걷어낸 값) */
  sourceAges: readonly string[]
  /** 우리 Persona 의 표현 — `49살` 또는 `40대 후반` */
  personaText: string
  /** 제3자를 가리키는 말. 같은 절에 있으면 고치지 않는다 */
  otherMarkers: readonly string[]
}): AgeFixResult {
  if (input.sourceAges.length === 0) return { text: input.text, fixed: 0, remaining: [] }
  let out = input.text
  let fixed = 0
  const remaining: string[] = []
  for (const age of input.sourceAges) {
    const n = age.trim()
    if (n === '') continue
    /**
     * 🔴 **구간 표현은 통째로 바꾼다** (2026-09-23 마스터 P0).
     *    `40대 초반` 은 숫자 어미가 없어 아래 규칙에 걸리지 않는다 —
     *    그대로 두면 원문 화자의 연령대가 글에 남는다.
     */
    if (!/^\d{1,3}$/.test(n)) {
      if (!out.includes(n)) continue
      const before = out
      out = out.split(n).join(input.personaText)
      if (out !== before) fixed += 1
      continue
    }
    // 🔴 그 숫자가 **나이로 쓰인 자리**만 본다 — `80퍼` · `3일` 과 갈린다
    const re = new RegExp(`(^|[^0-9])(${n})\\s*(살|세|인데|이고|이라|예요|이에요|입니다|이면)`, 'g')
    out = out.replace(re, (whole, pre: string, _num: string, tail: string, at: number) => {
      // 🔴 같은 절에 제3자 표지가 있으면 그 사람 나이다 — 손대지 않는다
      const from = out.lastIndexOf('\n', at) + 1
      const clause = out.slice(from, at + whole.length + 12)
      if (input.otherMarkers.some((w) => clause.includes(w))) { remaining.push(n); return whole }
      fixed += 1
      // 🔴 `49살` 이면 어미를 흡수하고, `40대 후반` 이면 어미를 살린다
      return /^\d{1,3}살$/.test(input.personaText)
        ? `${pre}${input.personaText.replace('살', '')}${tail === '살' ? '살' : tail}`
        : `${pre}${input.personaText}${tail === '살' || tail === '세' ? '' : tail}`
    })
    if (new RegExp(`(^|[^0-9])${n}\\s*(살|세|인데|이고|이라|예요|이에요|입니다|이면)`).test(out)
      && !remaining.includes(n)) remaining.push(n)
  }
  return { text: out, fixed, remaining: [...new Set(remaining)] }
}

// ─────────────────────────────────────────────────────────
// 🔴 **변환이 실제로 이뤄졌는가** (2026-09-23)
//
//   자동 보정만으로는 부족하다. 초안이 나이 문장을 **통째로 빼 버리면**
//   `fixed=0 · remaining=[]` 이 되어 "고칠 것이 없었다" 와 구분되지 않고 채택된다.
//   그래서 생성·보정이 끝난 뒤 **이행 여부를 따로 묻는다.**
// ─────────────────────────────────────────────────────────

export type MappingPostVerdict =
  | { ok: true; note: string }
  | { ok: false; code: 'SOURCE_AGE_REMAINS' | 'PERSONA_AGE_ABSENT' | 'CONFLICTING_SELF_AGE'; reason: string }

/**
 * 🔴 **정본 parser 의 얇은 소비자다** (2026-09-23 마스터 P0-1).
 *
 *    앞판은 여기에 **별도 숫자 정규식**이 있었다. 그래서 `readSelfAgeClaim` 이
 *    남의 것·조건으로 본 표현을 여기서는 자기 나이로 읽어 **서로 다른 답**을 냈다.
 *    이제 숫자도 역할도 `ageMentionsIn` 하나가 정한다.
 *
 * 🔴 타인 표지 목록은 받지 않는다 — 공용 parser 가 이미 그것으로 가른다.
 *    무시하는 인자를 남기면 부르는 쪽이 "내가 준 목록이 쓰인다" 고 잘못 읽는다.
 */
export function selfAgeNumbersIn(text: string): number[] {
  return [...new Set(
    ageMentionsIn(text)
      .filter((m) => m.role === 'self' && m.kind === 'exact')
      .map((m) => m.span.from),
  )]
}

/**
 * 🔴 **원문에서 화자 자신의 나이를 코드가 먼저 찾는다** (2026-09-23 마스터 P0-1)
 *
 *   앞판은 planner 가 `protectedFacts` 에 적어 준 것만 훑었다. 모델이 원문의
 *   "낼 44" 를 `protectedFacts` 와 `speakerRelative` **양쪽에서 빠뜨리면**
 *   누락 자체가 발견되지 않았다 — 그러면 원문 화자의 나이가 그대로 남은 글이
 *   아무 경고 없이 발행 후보가 된다.
 *
 * 🔴 **정규식을 새로 만들지 않는다.** 정본 `selfAgeNumbersIn` 하나를 그대로 쓴다 —
 *    제3자 절 제외 · 퍼센트(80퍼) · 기간(3일) · 연도(2026년) 오탐 제외가 거기 들어 있다.
 * 🔴 **나이 축만이다.** 혼인·자녀·직업·지역·갱년기는 이 판에서 활성화하지 않는다.
 */
export type ExpectedSelfFact = {
  axis: SpeakerRelativeAxis
  /** 🔴 planner 가 적어야 하는 그 값 — 숫자 문자열이다 */
  sourceText: string
  /** 그 값이 나온 자리 */
  evidenceRef: string
}

export function expectedSelfFactsIn(
  spans: readonly { kind: string; text: string }[],
): ExpectedSelfFact[] {
  const out: ExpectedSelfFact[] = []
  const seen = new Set<string>()
  for (const sp of spans) {
    for (const m of ageMentionsIn(sp.text, sp.kind)) {
      /**
       * 🔴 **자기 신상만이다.** 자격·보험 조건(`eventCondition`)과 제3자는 원문에서
       *    **지켜야 할 값**이지 우리 Persona 값으로 바꿀 값이 아니다 —
       *    창업자가 정한 source-invariant 다.
       *
       * 🔴 **구간도 받는다** (2026-09-23 마스터 P0). 앞판은 `exact` 만 받아서
       *    *"저는 40대 초반인데"* 를 계획이 양쪽에서 빠뜨려도 **발견하지 못했다** —
       *    그러면 원문 화자의 연령대가 그대로 남은 글이 나간다.
       */
      if (m.role !== 'self') continue
      // 🔴 원문 표현 그대로 요구한다 — 숫자로 줄이면 구간이 사라진다
      const text = m.kind === 'exact' ? String(m.span.from) : m.raw
      const key = `${sp.kind}\u0001${text}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ axis: 'age', sourceText: text, evidenceRef: sp.kind })
    }
  }
  return out
}

/**
 * 🔴 **age mapping 이 이행됐는지 확인한다.**
 *    · 원문 화자 나이가 남아 있으면 실패
 *    · 우리 나이(또는 허용된 밴드 표현)가 **없으면** 실패 — 통째로 뺀 경우다
 *    · 1인칭 나이가 **여럿**이면 실패 (fail-closed)
 */
export function checkAgeMappingApplied(input: {
  text: string
  sourceAges: readonly string[]
  exactAge: number | null
  effectiveAgeBand: string
  /**
   * 🔴 **1인칭 자리에서만 "우리 나이가 있어야 한다"** (2026-09-23).
   *    관찰·질문 자리에서는 우리 나이를 주장하지 않는다 — 그때 이 조건을 걸면
   *    정상 글이 `PERSONA_AGE_ABSENT` 로 막힌다. 원문 나이가 **1인칭으로** 남는 것은
   *    자리와 무관하게 여전히 막는다.
   */
  requireSelfAge?: boolean
}): MappingPostVerdict {
  const selfAges = selfAgeNumbersIn(input.text)
  /**
   * 🔴 **구간 원문이 남았으면 바꾸지 않은 것이다** (2026-09-23 마스터 P0).
   *    숫자 어미가 없어 `selfAgeNumbersIn` 에 잡히지 않는다 — 표현으로 본다.
   */
  const leftBand = input.sourceAges
    .filter((a) => !/^\d{1,3}$/.test(a.trim()) && a.trim() !== '')
    .filter((a) => a.trim() !== input.effectiveAgeBand && input.text.includes(a.trim()))
  if (leftBand.length > 0) {
    return {
      ok: false, code: 'SOURCE_AGE_REMAINS',
      reason: `원문 화자 연령대가 남았다 — ${leftBand.join('·')}`,
    }
  }
  const srcNums = input.sourceAges.map((a) => Number(a)).filter((n) => Number.isFinite(n))
  /**
   * 🔴 **원문 값이 우리 값과 같으면 이미 정합하다** (2026-09-23 보정).
   *    앞판은 `sourceAges` 에 있는 숫자를 먼저 leftover 로 봤다. 그래서
   *    *원문 47 · Persona 47* 처럼 **바꿀 것이 없는 정상 사례**가 실패했다.
   *    우리 기대값과 다른 원문 숫자만 남은 것이다.
   */
  const left = selfAges.filter((n) => srcNums.includes(n) && n !== input.exactAge)
  if (left.length > 0) {
    return { ok: false, code: 'SOURCE_AGE_REMAINS', reason: `원문 화자 나이가 남았다 — ${left.join('·')}` }
  }
  const distinct = [...new Set(selfAges)]
  if (distinct.length > 1) {
    return { ok: false, code: 'CONFLICTING_SELF_AGE', reason: `1인칭 나이가 여럿이다 — ${distinct.join('·')}` }
  }
  if (input.requireSelfAge === false) {
    return { ok: true, note: '1인칭 자리가 아니다 — 우리 나이를 주장하지 않는다' }
  }
  // 🔴 우리 값이 실제로 들어갔는가 — 숫자든 밴드 표현이든 하나는 있어야 한다
  const hasExact = input.exactAge !== null && distinct.includes(input.exactAge)
  const hasBand = input.text.includes(input.effectiveAgeBand)
  if (!hasExact && !hasBand) {
    return {
      ok: false, code: 'PERSONA_AGE_ABSENT',
      reason: `우리 쪽 나이(${input.exactAge ?? input.effectiveAgeBand})가 글에 없다`
        + ' — 원문 나이를 바꾸지 않고 통째로 뺐다',
    }
  }
  return { ok: true, note: hasExact ? `정확한 나이 ${input.exactAge} 로 서술됐다` : `${input.effectiveAgeBand} 로 서술됐다` }
}
