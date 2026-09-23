/**
 * 글쓴이가 **자기 입으로 밝힌 나이**와 Persona 나이대의 모순 — 🔴 순수 함수
 *
 * 🔴 **왜 필요한가** (2026-09-16 실측).
 *
 *    통합 의미 검수는 **자기 가족의 나이**도 함께 본다 —
 *    "우리 언니가 서른 하나" 같은 관계 모순이 그 물음의 전부다.
 *    그래서 **글쓴이 자신이 밝힌 나이**는 물음 밖으로 빠졌고,
 *    `60대 초반` Persona 가 본문 첫 줄에 *"40대 후반이고 …"* 라고 쓴 초안이
 *    `gate PASS` 로 큐까지 올라왔다. 같은 회차에서 `50대 후반` Persona 가
 *    *"내가 서른 대 중반쯤 될 때"* 라고 쓴 초안도 함께 올라왔다.
 *
 * 🔴 **모델에 더 묻지 않는다.** 실측(2026-09-14)에서 세 모델 모두 합격선을 넘지 못했고,
 *    프롬프트를 늘릴수록 뒤에 붙인 지시가 묻혔다. **명백한 자기 나이 표현은
 *    결정론으로 먼저 잡는다** — 모델은 남은 모호한 것만 본다.
 *
 * 🔴 **연령 정책을 여기서 만들지 않는다.** 밴드 문자열은 Pool 카드/운영 Persona 의
 *    정본 값(`PersonaForMatch['ageBand']`)을 그대로 읽는다. 새 밴드를 정의하지 않는다.
 *
 * 🔴 **모호한 것은 판정하지 않는다.** 1인칭 표지가 없고 문장 첫머리도 아니면
 *    `null`(모른다)이다. 억지로 정규식을 늘려 잡으면 정상 글이 막힌다 —
 *    이 저장소가 `6자 겹침` 에서 이미 겪은 모양이다.
 */

/** 🔴 밴드 문자열을 나이 구간으로. 정본 형태는 `40대 중반` · `50대 초반` 처럼 온다 */
export type AgeSpan = { from: number; to: number }

/**
 * 🔴 **판정 계약의 판.**
 *
 * 🔴 **이 값은 지금 어떤 캐시 key 에도 들어가지 않는다** (2026-09-23 확인).
 *    앞판 주석은 "품질 캐시 key 가 이 값을 담아 옛 판정이 재사용되지 않는다" 고
 *    적었지만, 유일한 import 처(`micro-seed-auto-draft.mts`)가 **쓰지 않았다.**
 *    거짓 설명을 지운다.
 *
 * 🔴 그래서 이번에 `44인데` 규칙을 더하면서도 **판을 올리지 않는다.**
 *    올려도 무효화되는 캐시가 없고, 초안 캐시(`v2|...`)는 `ARTIFACT_VERSION` 과
 *    생성 계약이 정한다. 캐시를 까닭 없이 전량 버리지 않는다.
 *    🔴 캐시가 맞아도 `pickV2` 는 **매 회차 다시 판정한다** — 새 규칙이 곧바로 적용된다.
 */
export const SELF_AGE_RULE_VERSION = 'self-age-v2'

const PART_SPAN: Readonly<Record<string, [number, number]>> = Object.freeze({
  초반: [0, 3], 중반: [4, 6], 후반: [7, 9],
})

/**
 * 🔴 밴드를 읽지 못하면 `null` 이다. 못 읽은 것을 0~99 로 넓혀 통과시키지 않는다 —
 *    그러면 "모른다" 가 "문제 없다" 로 바뀐다.
 */
export function parseAgeBand(band: string | null | undefined): AgeSpan | null {
  const t = (band ?? '').trim()
  const m = /^([1-9][0-9])대(?:\s*(초반|중반|후반))?$/.exec(t)
  if (m === null) return null
  const base = Number(m[1])
  const part = m[2]
  if (part === undefined) return { from: base, to: base + 9 }
  const [lo, hi] = PART_SPAN[part]!
  return { from: base + lo, to: base + hi }
}

/** 한글 수사 — 🔴 목록을 늘리지 않는다. 나이를 말할 때 실제로 쓰는 말까지다 */
const KO_TENS: Readonly<Record<string, number>> = Object.freeze({
  스물: 20, 서른: 30, 마흔: 40, 쉰: 50, 예순: 60, 일흔: 70,
})
const KO_ONES: Readonly<Record<string, number>> = Object.freeze({
  하나: 1, 한: 1, 둘: 2, 두: 2, 셋: 3, 세: 3, 넷: 4, 네: 4, 다섯: 5,
  여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9,
})

/**
 * 🔴 **다른 사람을 가리키는 말.** 이 말이 **같은 절**에 있으면 그 절의 나이는 자기 것이 아니다.
 *    🔴 문장이 아니라 **절**이다 — *"내가 서른 대 중반쯤 될 때 엄마는 예순이 넘었어요"* 처럼
 *       한 문장에 자기 나이와 가족 나이가 함께 오는 글을 통째로 버리면 결함을 놓친다(2026-09-16 실측).
 */
export const OTHER_MARKERS: readonly string[] = [
  '언니', '오빠', '형', '누나', '동생', '엄마', '아빠', '어머니', '아버지',
  '시어머니', '시아버지', '시부모', '친정', '남편', '아내', '딸', '아들', '며느리', '사위',
  '조카', '손주', '손녀', '손자', '후배', '선배', '친구', '이웃', '아는', '주변', '옆',
  '그분', '이분', '저분', '분이', '분은', '분한테', '사람이', '사람은', '애가', '애는',
  '동료', '상사', '기사', '선생', '고객', '손님', '아이가', '아이는',
]

/**
 * 🔴 **1인칭 표지.** 화자 자신을 가리키는 **명확한 근거**만 둔다.
 *
 * 🔴 `올해` 는 표지가 아니다 (2026-09-16 정정). 넣었더니
 *    *"올해 40대 지원자가 많이 늘었어요"* 를 자기 나이로 읽었다 — 시간부사는 근거가 아니다.
 */
const SELF_MARKERS: readonly string[] = [
  '저는', '저도', '전 ', '나는', '나도', '난 ', '제가', '내가', '제 나이', '내 나이', '본인은',
]

/**
 * 🔴 나이 표현 **바로 뒤**가 서술이면 자기를 말하는 것이고, 명사를 꾸미면 남/일반을 말하는 것이다.
 *    *"40대 후반**이고**"* 는 서술 · *"40대 **지원자가**"* 는 수식이다.
 */
const PREDICATE_AFTER =
  /^\s*(?:이고|이라|이래|인데|이야|이에요|예요|입니다|이었|이던|이니|이지|이신|이면|이지만|이다|였)/

/**
 * 🔴 **근사 표현은 서술이 아니다** (2026-09-16 정정).
 *
 *    `쯤` · `무렵` · `께` · `정도` 를 서술과 같이 취급했더니
 *    *"**40대 정도를** 대상으로 한 강의예요"* 를 화자의 나이로 읽어 막았다.
 *    이 말들은 1인칭 표지가 있을 때만 근거가 된다 — 첫머리 규칙(④)에는 쓰지 않는다.
 */
const APPROX_AFTER = /^\s*(?:쯤|무렵|께|정도)/
/** 🔴 나이 뒤에 **다른 명사**가 붙으면 그 나이는 그 명사의 것이다 */
const NOUN_AFTER = /^\s*[가-힣]{1,8}(?:이|가|은|는|을|를|와|과|도|만|에게|한테|들|의)(?:\s|$|[,.!?])/

/**
 * 🔴 나이 뒤에 **주격 조사 + 다른 서술**이 오면 그 나이는 **서술의 주어**이지 화자가 아니다
 *    (2026-09-16 정정). *"내가 결혼할 때만 해도 **20대 후반이 일반적이었는데**"* 를
 *    화자의 현재 나이로 읽어 50대 초반 Persona 를 헛되이 막았다 — 실측 과잉 차단.
 */
const SUBJECT_OF_OTHER = /^\s*(?:이|가)\s/

/**
 * 🔴 나이 뒤가 `인 <명사>` 꼴이면 그 나이는 **그 명사**의 것이다 —
 *    *"만 48세**인 지원자가**"* (2026-09-16). 단 뒤따르는 말이 화자 자신이면
 *    (*"쉰 둘**인 저는**"*) 수식이 아니라 자기 소개다.
 */
/**
 * 🔴 나이 뒤가 **시점 조사**면 그 나이는 "지금 몇 살" 이 아니라 **언제부터/언제** 다 —
 *    *"**22살부터** 내가 챙기던 보험료"* 를 40대 후반 Persona 의 현재 나이로 읽어 막았다
 *    (2026-09-16 실측 과잉 차단). 과거 시점 나이는 밴드와 모순이 아니다.
 */
const TIME_POINT_AFTER = /^\s*(?:부터|까지|까진|이후|이전|무렵|때|에(?!요))/

/**
 * 🔴 **나이 뒤에 붙는 범위 표현** (2026-09-23 마스터 P0-1).
 *    *"만 65세 **이상이면** 신청할 수 있어요"* · *"51세**부터** 지원 대상입니다"* 는
 *    화자의 신상이 아니라 **자격·보험 조건**이다. 원문에서 지켜야 할 값이지
 *    우리 Persona 값으로 바꿀 값이 아니다.
 *    🔴 낱말 금지 목록이 아니다 — 나이 표현 **바로 뒤의 조사**만 본다.
 *    🔴 `부터`·`까지` 는 `TIME_POINT_AFTER` 가 이미 잡는다(둘 다 `eventCondition`) —
 *       여기 겹쳐 두면 어느 쪽이 판정했는지 알 수 없다.
 */
const RANGE_AFTER = /^\s*(?:이상|이하|미만|초과)/

const MODIFIES_NOUN =
  /^\s*(?:인|짜리)\s*(?!저는|저도|나는|난\s|내가|제가|본인)[가-힣]{1,10}(?:이|가|은|는|을|를|도|만|들|의|에게|한테)/

/**
 * 🔴 **전언·추측 표지** (2026-09-16 정정). 이 말이 있으면 남을 두고 하는 짐작이다 —
 *    *"친구 부부가 놀러 와요. **60대 초반 정도인 것 같은데** …"* 를 화자 나이로 읽어
 *    막았다. 1인칭 표지가 없는 첫머리 규칙(④)에만 적용한다.
 */
const HEARSAY = /것\s?같|인\s?듯|라더라|다더라|하더라|대요|래요|한대|다던/

export type SelfAgeClaim = {
  /** 글에서 읽은 나이 구간 */
  span: AgeSpan
  /** 🔴 글에 **그대로 있는** 문장. 지어낸 근거로 막지 않는다(기존 계약과 같다) */
  evidence: string
  /** 어떤 근거로 자기 나이라고 보았나 — 사람이 읽는 한 줄 */
  reason: 'firstPerson' | 'clauseHeadPredicate'
}

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim()

/**
 * 🔴 **절 단위로 자른다** (2026-09-16 정정).
 *
 *    옛 판은 문장 단위였고, 같은 문장에 타인 표지가 하나라도 있으면 **문장 전체를 버렸다**.
 *    그래서 *"내가 서른 대 중반쯤 될 때 엄마는 예순이 넘었어요"* 가 `엄마` 때문에 통째로 빠졌다 —
 *    앞 절은 명백한 자기 나이였다. 연결어미와 쉼표에서 끊어 **절마다** 본다.
 */
function clauses(text: string): { text: string; headOfLine: boolean }[] {
  const out: { text: string; headOfLine: boolean }[] = []
  for (const line of text.split(/\n+/)) {
    const parts = line
      /**
       * 🔴 `인데` 를 더한다 (2026-09-23). *"아는 분이 44인데 저는 47이거든요"* 가
       *    한 절로 남아 앞의 `분이` 때문에 **뒤의 자기 나이 47 까지** 남의 것이 됐다.
       */
      .split(/(?<=[.!?。…])\s+|[,·]\s*|(?<=(?:이고|며|면서|는데|인데|지만|때|아서|어서|니까|다가|라서))\s+/)
      .map(clean)
      .filter((x) => x !== '')
    for (const [i, t] of parts.entries()) out.push({ text: t, headOfLine: i === 0 })
  }
  return out
}

/** `40대 후반` · `쉰 둘` · `서른 대 중반` 을 구간으로 */
function readAgeExpression(s: string): { span: AgeSpan; at: number; raw: string } | null {
  const tens = Object.keys(KO_TENS).join('|')
  const ones = Object.keys(KO_ONES).join('|')
  const cand: { span: AgeSpan; at: number; raw: string }[] = []
  const add = (from: number, to: number, m: RegExpExecArray): void => {
    cand.push({ span: { from, to }, at: m.index, raw: m[0] })
  }
  const part = (base: number, p: string | undefined): [number, number] => {
    if (p === undefined) return [base, base + 9]
    const [lo, hi] = PART_SPAN[p]!
    return [base + lo, base + hi]
  }

  // ① `40대 후반` · `40대` — 숫자 밴드
  const num = /([1-9][0-9])\s*대\s*(초반|중반|후반)?/.exec(s)
  if (num !== null) add(...part(Number(num[1]), num[2]), num)

  // ② `서른 대 중반` — 한글 밴드
  const koBand = new RegExp(`(${tens})\\s*대\\s*(초반|중반|후반)?`).exec(s)
  if (koBand !== null) add(...part(KO_TENS[koBand[1]!]!, koBand[2]), koBand)

  // ③ `쉰 둘` — 한글 수사. 🔴 나이일 때만 쓴다. `쉰 김치` 와 갈리지 않으면 읽지 않는다
  const koAge = new RegExp(`(${tens})\\s*(${ones})?(?:\\s*살)?`).exec(s)
  if (koAge !== null && (koAge[2] !== undefined || /살/.test(koAge[0]))) {
    const v = KO_TENS[koAge[1]!]! + (koAge[2] === undefined ? 0 : KO_ONES[koAge[2]]!)
    add(v, v, koAge)
  }

  /**
   * ④ `48살` · `48세` · `만 48세` — 🔴 숫자로 **정확히** 밝힌 나이 (2026-09-16 추가).
   *    `세대` 는 나이가 아니므로 뒤에 `대` 가 붙으면 읽지 않는다.
   */
  const exact = /(?:만\s*)?([1-9][0-9])\s*(?:살|세)(?!대)/.exec(s)
  if (exact !== null) { const v = Number(exact[1]); add(v, v, exact) }

  /**
   * ⑤ `44인데` · `44이고` · `44예요` — 🔴 **단위 없이 서술로 붙은 나이** (2026-09-23 추가).
   *
   *    P02 실측: 초안이 "제가 곧 44인데" 라고 썼는데 ④ 가 `살`·`세` 를 요구해 읽지 못했다.
   *    그래서 정본 `40대 후반` 과 어긋난 채로 채택까지 갔다.
   *
   *    🔴 **서술 어미가 바로 붙을 때만** 읽는다. 그래야 `80퍼` · `3일` · `몇 년` 같은
   *       수량 표현과 갈린다. 뒤에 단위 명사가 오면 나이가 아니다.
   *    🔴 20~99 만 본다 — `10인데` 같은 것은 나이로 읽지 않는다.
   */
  const bare = /(?:^|[^0-9])([2-9][0-9])\s*(?:인데|이고|이라|이라서|예요|이에요|입니다|이면|인지라|이거든요)/.exec(s)
  if (bare !== null) {
    const v = Number(bare[1])
    const at = bare.index + bare[0].indexOf(bare[1]!)
    /**
     * 🔴 **어미를 `raw` 에 삼키지 않는다** (2026-09-23). 삼키면 뒤따르는 글이
     *    `인데 …` 가 아니라 `아직도 …` 로 보여 *"낼44인데 아직도"* 가
     *    **남의 나이(명사 수식)** 로 잘못 분류됐다(실측).
     */
    cand.push({ span: { from: v, to: v }, at, raw: bare[1]! })
  }

  if (cand.length === 0) return null
  /**
   * 🔴 **정규식 종류의 우선순위로 고르지 않는다** (2026-09-16 정정).
   *    글에서 **먼저 나온 표현**을 쓴다 — 그래야 그 표현이 무엇을 꾸미는지로 판정할 수 있다.
   *    같은 자리에서 시작하면 더 길게 읽은 쪽이 온전한 표현이다(`만 48세` > `48세`).
   */
  cand.sort((a, b) => (a.at - b.at) || (b.raw.length - a.raw.length))
  return cand[0]!
}

/**
 * 🔴 **글쓴이가 자기 입으로 밝힌 나이**를 읽는다. 없으면 `null`(모른다).
 *
 * 🔴 **절마다** 본다. 한 절에 나이 표현이 있을 때:
 *    ① 그 절에 타인 표지가 있으면 그 나이는 남의 것이다 — 세지 않는다
 *    ② 나이 뒤에 **다른 명사**가 붙으면 그 명사의 나이다 (*"40대 지원자가"*) — 세지 않는다
 *    ③ 1인칭 표지가 있으면 자기 나이다
 *    ④ 1인칭 표지가 없어도 **줄 첫 절의 첫머리 + 바로 뒤가 서술**이고
 *       전언·추측 표지가 없으면 자기 나이다 (*"40대 후반이고 …"* — 실측 결함이 이 모양이었다)
 *    그 밖은 `null` 이다. 🔴 첫머리라는 **사실만으로** 단정하지 않는다.
 */
// ─────────────────────────────────────────────────────────
// 🔴 **나이 표현을 읽는 곳은 여기 하나다** (2026-09-23 마스터 P0-1)
//
//   앞판은 숫자를 읽는 코드가 **세 벌**이었다 — `readAgeExpression`(여기),
//   `selfAgeNumbersIn`(speaker-relative-facts), `sourceAgeNumber`(load-bearing).
//   그래서 `readSelfAgeClaim` 은 *"51세부터 지원 대상입니다"* 를 자기 나이로 보지 않는데
//   `expectedSelfFactsIn` 은 자기 나이 51 로 **오인**했다(마스터 실측).
//   자격·보험·제3자·사건 조건은 원문에서 **지켜야 할 값**이지 바꿀 값이 아니다.
//
// 🔴 숫자를 읽는 규칙도, 누구 것인지 가르는 규칙도 **이 함수 하나**다.
//    다른 곳은 전부 이 결과를 소비하는 얇은 껍데기다.
// ─────────────────────────────────────────────────────────

export const AGE_MENTION_ROLES = ['self', 'thirdParty', 'eventCondition', 'unknown'] as const
export type AgeMentionRole = (typeof AGE_MENTION_ROLES)[number]

export type AgeMention = {
  /** 원문에 있던 표현 그대로 */
  raw: string
  /** 그 표현이 시작하는 자리 (텍스트 전체 기준) */
  at: number
  /** 어느 span 에서 나왔나 — 부르는 쪽이 넣는다 */
  evidenceRef: string
  /** 🔴 `44살` 처럼 한 살로 정해졌는가, `40대 후반` 처럼 구간인가 */
  kind: 'exact' | 'band'
  span: AgeSpan
  role: AgeMentionRole
  /**
   * 🔴 **왜 그렇게 보았나.** `readSelfAgeClaim` 은 보수적으로 앞의 둘만 받는다 —
   *    그 함수는 생활사 모순을 **막는** 데 쓰이므로 과잉 차단을 피해야 한다.
   */
  reason: 'firstPerson' | 'clauseHeadPredicate' | 'barePredicate'
    | 'otherMarker' | 'modifiesNoun' | 'subjectOfOther' | 'rangeCondition' | 'timePoint'
    | 'hearsay' | 'undecided'
  /** 사람이 읽는 근거 — 글에 **그대로 있는** 절이다 */
  clause: string
}

/** 🔴 `readSelfAgeClaim` 이 근거로 받는 것 — 보수적인 둘뿐이다 */
const STRICT_SELF_REASONS = ['firstPerson', 'clauseHeadPredicate'] as const

/**
 * 🔴 **글 안의 나이 표현을 전부, 역할과 함께 낸다.**
 *
 *    절마다 본다 — 한 문장에 자기 나이와 가족 나이가 함께 오는 글을 통째로 버리지 않는다.
 */
export function ageMentionsIn(text: string, evidenceRef = ''): AgeMention[] {
  const out: AgeMention[] = []
  let cursor = 0
  for (const { text: c, headOfLine } of clauses(text)) {
    // 🔴 절이 원문 어디에서 왔는지 — 못 찾으면 0 이 아니라 직전 자리다
    const found = text.indexOf(c, cursor)
    const base = found < 0 ? cursor : found
    if (found >= 0) cursor = found + c.length
    const age = readAgeExpression(c)
    if (age === null) continue
    const after = c.slice(age.at + age.raw.length)
    const kind: 'exact' | 'band' = age.span.from === age.span.to ? 'exact' : 'band'
    const push = (role: AgeMentionRole, reason: AgeMention['reason']): void => {
      out.push({
        raw: age.raw, at: base + age.at, evidenceRef, kind, span: age.span, role, reason, clause: c,
      })
    }
    // ① 같은 절에 타인 표지가 있으면 남의 나이다
    if (OTHER_MARKERS.some((w) => c.includes(w))) { push('thirdParty', 'otherMarker'); continue }
    /**
     * ② 🔴 **범위 조사가 붙으면 자격·보험 조건이다** — 화자의 신상이 아니다.
     *    `TIME_POINT_AFTER` 보다 먼저 본다: `부터` 는 둘 다에 있는데
     *    *"51세부터 지원 대상"* 은 시점이 아니라 **조건**이다.
     */
    if (RANGE_AFTER.test(after)) { push('eventCondition', 'rangeCondition'); continue }
    // ③ 나이 뒤가 다른 명사·주어면 그 명사의 나이다
    if (SUBJECT_OF_OTHER.test(after)) { push('thirdParty', 'subjectOfOther'); continue }
    if (MODIFIES_NOUN.test(after)) { push('thirdParty', 'modifiesNoun'); continue }
    if (NOUN_AFTER.test(after) && !PREDICATE_AFTER.test(after) && !APPROX_AFTER.test(after)) {
      push('thirdParty', 'modifiesNoun'); continue
    }
    // ④ 시점 조사면 "지금 몇 살" 이 아니다 — 과거·미래의 한 때다
    if (TIME_POINT_AFTER.test(after)) { push('eventCondition', 'timePoint'); continue }
    // ⑤ 1인칭 표지가 있으면 자기 나이다
    if (SELF_MARKERS.some((w) => c.includes(w))) { push('self', 'firstPerson'); continue }
    // ⑥ 전언·추측이면 남을 두고 하는 짐작이다
    if (HEARSAY.test(c)) { push('unknown', 'hearsay'); continue }
    // ⑦ 절 첫머리에서 바로 서술로 이어지면 자기 나이다
    if (headOfLine && c.slice(0, age.at).trim() === '' && PREDICATE_AFTER.test(after)) {
      push('self', 'clauseHeadPredicate'); continue
    }
    /**
     * ⑧ 🔴 **서술 어미가 바로 붙었다** — *"낼44인데"* (P02 실측 원문).
     *    한국어는 주어를 생략하므로 이것도 자기 나이다. 위 ①~④ 를 전부 지난 뒤이므로
     *    남의 나이·조건·시점은 여기 오지 않는다.
     *    🔴 `readSelfAgeClaim` 은 이 근거를 **받지 않는다** — 그 함수는 막는 쪽이라
     *       보수적이어야 한다. 넓히면 정상 글이 새로 막힌다.
     */
    if (PREDICATE_AFTER.test(after)) { push('self', 'barePredicate'); continue }
    push('unknown', 'undecided')
  }
  return out
}

/**
 * 🔴 **표현 한 조각을 구조화된 나이 사실로** (2026-09-23 마스터 P0)
 *
 *    계획이 적어 낸 `sourceText` 는 `"44"` 처럼 **서술이 없는 조각**이거나
 *    `"40대 초반"` 처럼 **구간**이다. 앞판은 여기서 숫자 하나만 꺼냈고,
 *    그래서 구간이 통째로 `null` 이 되어 load-bearing 경로가 **전부 결론**으로 갔다
 *    (마스터 실측: `sourceAgeNumber('50대 초반') → null`).
 *
 * 🔴 숫자로 평탄화하지 않는다 — `kind`·`raw`·`span` 을 그대로 낸다.
 */
export type AgeFact = {
  kind: 'exact' | 'band'
  /** 원문 표현 그대로 */
  raw: string
  span: AgeSpan
}

export function ageFactOf(sourceText: string): AgeFact | null {
  const raw = sourceText.trim()
  if (raw === '') return null
  /**
   * 🔴 맨 숫자는 서술이 없어 정본이 나이로 읽지 못한다 — `47세` 꼴로 붙여 묻는다.
   *    🔴 `51만원` · `51번` 은 붙이지 않는다. 그대로 물어 **나이가 아님**이 드러나게 한다.
   */
  const probe = /^\d{1,3}$/.test(raw) ? `제가 ${raw}세입니다` : raw
  const m = ageMentionsIn(probe)[0]
  if (m === undefined) return null
  return { kind: m.kind, raw, span: m.span }
}

/**
 * 🔴 **공용 parser 의 얇은 소비자다** (2026-09-23). 숫자도 역할도 여기서 다시 읽지 않는다.
 *    🔴 보수적인 근거 둘만 받는다 — 이 함수는 생활사 모순을 **막는** 데 쓰인다.
 */
export function readSelfAgeClaim(text: string): SelfAgeClaim | null {
  for (const m of ageMentionsIn(text)) {
    if (m.role !== 'self') continue
    if (!(STRICT_SELF_REASONS as readonly string[]).includes(m.reason)) continue
    return { span: m.span, evidence: m.clause, reason: m.reason as SelfAgeClaim['reason'] }
  }
  return null
}

export type SelfAgeVerdict = {
  /** 🔴 `null` 은 "모른다" 다 — 밴드를 못 읽었거나 자기 나이를 밝히지 않았다 */
  conflict: boolean
  evidence: string
  reason: string
}

/**
 * 🔴 **밴드와 자기 나이가 겹치지 않으면 모순이다.**
 *    겹치기만 하면 통과다 — 밴드 안쪽 어디인지까지 따지지 않는다(과잉 차단 금지).
 */
export function judgeSelfAgeConflict(input: {
  ageBand: string | null | undefined
  text: string
}): SelfAgeVerdict | null {
  const band = parseAgeBand(input.ageBand)
  if (band === null) return null
  const claim = readSelfAgeClaim(input.text)
  if (claim === null) return null
  const overlaps = claim.span.from <= band.to && claim.span.to >= band.from
  if (overlaps) {
    return { conflict: false, evidence: '', reason: `자기 나이 표현이 ${input.ageBand} 와 겹친다` }
  }
  return {
    conflict: true,
    evidence: claim.evidence,
    reason: `글쓴이는 ${input.ageBand} 인데 글에서 자기 나이를`
      + ` ${claim.span.from}~${claim.span.to}세로 말한다`,
  }
}

/**
 * 🔴 **정확한 자기 나이는 생활사 사실이다** (2026-09-23 P02 실측).
 *
 *    후보 `cmudal78h…` 의 계획이 44 를 `protectedFacts` 로 지키면서 `selfBasis` 를
 *    `noLifeFactNeeded` 로 보냈고, 초안에 "제가 곧 44인데" 가 들어갔다.
 *    **P02 정본은 40대 후반(47~49)** 이다.
 *
 * 🔴 판정 계약을 새로 만들지 않는다 — `readSelfAgeClaim`·`parseAgeBand` 정본을 그대로 쓴다.
 *    여기서 더하는 것은 **`selfBasis` 와의 대조** 하나뿐이다.
 */
export type SelfAgeBasisVerdict =
  | { hold: false; reason: string }
  | { hold: true; code: 'AGE_WITHOUT_LIFE_FACT' | 'AGE_BAND_UNKNOWN' | 'AGE_BAND_CONFLICT'; reason: string }

export function judgeSelfAgeBasis(input: {
  text: string
  ageBand: string | null | undefined
  /** 계획이 정한 자격 근거. `lifeFacts` 가 아니면 생활사 사실을 쓸 수 없다 */
  selfBasis: string | null | undefined
  /**
   * 🔴 **우리 정본이 정한 그날의 나이** (2026-09-23).
   *    글에 적힌 나이가 이 값이면 **우리가 넣은 값**이다 — 원문에서 베낀 것이 아니라
   *    Persona 카드가 근거다. 그때는 `selfBasis` 를 묻지 않는다.
   *    묻으면 "원문 화자 자격" 판정이 **우리 자신의 사실**을 막는다(실측 모순).
   */
  personaExactAge?: number | null
}): SelfAgeBasisVerdict {
  const claim = readSelfAgeClaim(input.text)
  if (claim === null) return { hold: false, reason: '정확한 자기 나이를 말하지 않았다' }
  const ours = input.personaExactAge ?? null
  if (ours !== null && claim.span.from === ours && claim.span.to === ours) {
    return { hold: false, reason: `우리 정본 나이(${ours})다 — 원문에서 베낀 값이 아니다` }
  }
  // 🔴 나이를 밝혔으면 그것은 생활사 사실이다 — "필요 없다" 로 보낼 수 없다
  if ((input.selfBasis ?? '') !== 'lifeFacts') {
    return {
      hold: true, code: 'AGE_WITHOUT_LIFE_FACT',
      reason: `🔴 자기 나이 ${claim.span.from}~${claim.span.to}세를 말하면서`
        + ` 자격 근거가 ${input.selfBasis ?? '(없음)'} 다`,
    }
  }
  if (parseAgeBand(input.ageBand) === null) {
    return { hold: true, code: 'AGE_BAND_UNKNOWN', reason: `🔴 정본 나이대를 읽을 수 없다 — ${input.ageBand ?? '(없음)'}` }
  }
  const v = judgeSelfAgeConflict({ ageBand: input.ageBand, text: input.text })
  if (v !== null && v.conflict) return { hold: true, code: 'AGE_BAND_CONFLICT', reason: v.reason }
  return { hold: false, reason: `자기 나이가 ${input.ageBand} 와 겹친다` }
}
