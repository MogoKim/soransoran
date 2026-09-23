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
      .split(/(?<=[.!?。…])\s+|[,·]\s*|(?<=(?:이고|며|면서|는데|지만|때|아서|어서|니까|다가|라서))\s+/)
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
  const bare = /(?:^|[^0-9])([2-9][0-9])\s*(?:인데|이고|이라|이라서|예요|이에요|입니다|이면|인지라)/.exec(s)
  if (bare !== null) {
    const v = Number(bare[1])
    const at = bare.index + bare[0].indexOf(bare[1]!)
    cand.push({ span: { from: v, to: v }, at, raw: bare[0].slice(bare[0].indexOf(bare[1]!)) })
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
export function readSelfAgeClaim(text: string): SelfAgeClaim | null {
  for (const { text: c, headOfLine } of clauses(text)) {
    const age = readAgeExpression(c)
    if (age === null) continue
    if (OTHER_MARKERS.some((w) => c.includes(w))) continue
    const after = c.slice(age.at + age.raw.length)
    if (SUBJECT_OF_OTHER.test(after)) continue
    if (MODIFIES_NOUN.test(after)) continue
    if (TIME_POINT_AFTER.test(after)) continue
    if (NOUN_AFTER.test(after) && !PREDICATE_AFTER.test(after) && !APPROX_AFTER.test(after)) continue
    if (SELF_MARKERS.some((w) => c.includes(w))) {
      return { span: age.span, evidence: c, reason: 'firstPerson' }
    }
    // 🔴 1인칭 표지가 없을 때는 **확실한 서술**만 근거다 — 근사 표현(`쯤`·`정도`)은 쓰지 않는다
    if (headOfLine && c.slice(0, age.at).trim() === '' && PREDICATE_AFTER.test(after)
      && !HEARSAY.test(c)) {
      return { span: age.span, evidence: c, reason: 'clauseHeadPredicate' }
    }
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
}): SelfAgeBasisVerdict {
  const claim = readSelfAgeClaim(input.text)
  if (claim === null) return { hold: false, reason: '정확한 자기 나이를 말하지 않았다' }
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
