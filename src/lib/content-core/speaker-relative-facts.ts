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

export type MappingPlan =
  | { ok: true; mappings: AxisMapping[]; note: string }
  /** 🔴 숫자만 바꿔서는 안 되는 경우 — 다시 계획하거나 HOLD */
  | { ok: false; code: 'LOAD_BEARING'; axis: SpeakerRelativeAxis; reason: string }

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
    if (f.role === 'loadBearing') {
      return {
        ok: false, code: 'LOAD_BEARING', axis: f.axis,
        reason: `🔴 ${AXIS_LABEL[f.axis]} 가 글의 결론을 바꾼다 — 숫자만 바꾸지 않는다`,
      }
    }
    const to = personaTextFor(f.axis, input.persona)
    mappings.push({
      axis: f.axis, sourceText: f.sourceText, personaText: to,
      outputRule: to === null
        ? `🔴 ${AXIS_LABEL[f.axis]}: 원문의 "${f.sourceText}" 를 쓰지 않는다. 우리 쪽 값이 없으니 그 축을 언급하지 않는다`
        : `🔴 ${AXIS_LABEL[f.axis]}: 원문의 "${f.sourceText}" 를 복제하지 않고 **${to}** 로 서술한다`,
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
