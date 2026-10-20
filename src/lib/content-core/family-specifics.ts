/**
 * 🔴 **구체적인 가족 사실 판독 — 수 · 성별 · 나이대** (2026-10-13 · quality-v8 보정 · 14:40 감사 결함)
 *
 *   원문이 1인칭으로 말한 자녀의 **수**(`아들 둘` · `두 아이`) · **성별**(`아들` · `딸`) · **나이대**(`중학생` · `유치원`)는
 *   그 사람의 사실이다. 그것을 우리 Persona 의 1인칭으로 옮기려면 **정본 카드가 그 값을 정확히 가져야 한다**.
 *   앞판은 `children=있음` 만 대조해, 자녀 1명(초등) 카드가 `아들 둘 데리고` 를 자기 일로 말했다.
 *
 *   🔴 정본 카드에는 자녀 **성별 칸이 없다** — 그러므로 성별은 1인칭 사실의 근거가 될 수 없다.
 *   🔴 이 파일은 **읽기만** 한다(누구의 자녀인지 · 판정 수준은 부르는 쪽이 정한다):
 *      · 화자 계획(`speaker.ts`) — 원문 근거 줄의 가족 사실이 카드와 맞지 않으면 1인칭을 허가하지 않는다
 *      · 초안 게이트(`draft-life-gates.ts`) — 1인칭 절의 가족 사실이 카드와 맞지 않으면 확정 차단
 *   🔴 아무것도 import 하지 않는다(나이대 값은 정본 `CHILD_AGE_BANDS` 의 글자 그대로다).
 *
 * 🔴 **(v2 · quality-v13 · 2026-10-20) 자녀 숫자 나이 · 소유 표지 — 가족 주장의 뜻은 이 파일 하나다.**
 *   운영 D5 결함 — 성인 자녀(`childrenAgeBands=[성인]`)만 둔 P16 이 `2살 아이 보험… 아이 거니까…` 를 자기 일로 썼고
 *   v12 게이트 · 의미 검수가 모두 지나갔다. 앞판은 나이대 **낱말**(`유치원`)만 읽어 `2살` 을 나이대로 못 읽었고,
 *   `아이 거니까`(아이 것이라)를 자기 자녀의 말로 세지 못했으며, 물음으로 끝나면 1인칭 판정이 통째로 꺼졌다.
 *   · 숫자 나이(0~18살 · `N개월`)는 **보수적으로** 기존 나이대에 옮긴다 — 경계 나이는 이웃 나이대 둘을 다 허용한다(`anyOf`).
 *     🔴 `성인` 은 숫자 나이에서 절대 나오지 않는다(19살 이상 · 모호한 말은 읽지 않는다)
 *   · 소유 표지(`우리 아이` · `제 딸` · `아이 거니까`)는 자기 가족 증거다 — 물음표가 지우지 못한다(부르는 쪽이 쓴다)
 */
export const FAMILY_SPECIFICS_VERSION = 'family-specifics-v2'

const KID_NOUN = '(?:아들|딸|아이|애|자식|자녀)'
const COUNT_WORD: Readonly<Record<string, number>> = { 하나: 1, 한: 1, 둘: 2, 두: 2, 셋: 3, 세: 3, 넷: 4, 네: 4 }
/** 수 뒤에 올 수 있는 것 — `둘째` · `두 번` 같은 다른 말을 거른다 */
const COUNT_TAIL = '(?=$|[\\s,.!?~…)]|이|인|을|를|도|만|과|와|랑|이랑|은|에|씩)'
const COUNT_AFTER_RE = new RegExp(`(?<![가-힣])${KID_NOUN}\\s*(?:만\\s*)?(하나|둘|셋|넷|[1-4]\\s*명|한\\s*명|두\\s*명|세\\s*명|네\\s*명)${COUNT_TAIL}`)
const COUNT_BEFORE_RE = new RegExp(`(?<![가-힣])(두|세|네)\\s*(?:명의\\s*)?${KID_NOUN}(?![가-힣]*째)(?=[^가-힣]|이|가|을|를|과|와|랑|이랑|하고|도|만|은|는|$)`)

/**
 * 🔴 자녀 성별 — 카드에 없는 값이다. **자기 자녀를 가리키는 꼴**일 때만 센다(일반 화제 `딸 얘기` · `딸이 있어야` 는 세지 않는다):
 *    · 소유 — `우리 딸` · `제 아들` · `저희 큰딸`
 *    · 수와 함께 — `아들 둘` · `두 딸` (수 판독과 같은 꼴)
 *    · 자기 자녀에게 하는 일 — `아들 데리고` · `딸 키우는` · `아들 낳았` · `딸을 보내`
 */
const GENDER_OWN_RE = /(?<![가-힣])(?:우리|제|저희|울|내)\s*(?:큰|작은|막내|외동)?\s*(?:아들|딸)|(?<![가-힣])(?:큰|작은|막내|외동)?(?:아들|딸)(?:을|를|이랑|하고|과|와|도)?\s*(?:데리고|데려|키우|키워|낳았|낳고|보내|맡기)/
const GENDER_IN_COUNT_RE = /아들|딸/


/** 🔴 자녀 나이대 낱말 → 정본 나이대. 학년만(`3학년`)은 어느 학교인지 몰라 세지 않는다 */
const BAND_WORDS: readonly (readonly [RegExp, string])[] = [
  [/어린이집|유치원|신생아|갓난/, '영유아'],
  [/초등학생|초등학교|초딩|(?<![가-힣])초[1-6](?![0-9])/, '초등'],
  [/중학생|중학교|중딩|고등학생|고등학교|고딩|수험생|(?<![가-힣])(?:중|고)[1-3](?![0-9])/, '중고등'],
  [/대학생|대학교|대딩|취준생|취업\s*준비|재수생|휴학생/, '대학·취준'],
]

/** 자녀 낱말 뒤에 올 수 있는 복수·조사 — `아이돌` · `애정` 처럼 다른 낱말이 이어지는 것을 거른다 */
const KID_TAIL = '(?:들)?(?:이|가|는|은|도|를|을|의|만|랑|이랑|하고|한테|에게)?'
const AGE_KID = '(?:아이|애|아기|아들|딸|자녀|자식|막내|첫째|둘째|큰애|작은애|외동)'

/**
 * 🔴 **숫자 나이 → 정본 나이대** (0~18). 한국식 · 만 나이와 학년 경계가 겹쳐서 **경계 나이는 이웃 나이대를 둘 다** 돌려준다 —
 *    둘 중 하나라도 카드에 있으면 어긋나지 않는다(과차단 방지). 범위 밖(19살 이상 · 음수 · 소수)은 읽지 않는다 —
 *    🔴 `성인` 을 추측하지 않는다.
 *      0~5 영유아 · 6~7 영유아|초등 · 8~11 초등 · 12~13 초등|중고등 · 14~17 중고등 · 18 중고등|대학·취준
 */
export function bandsOfAge(age: number): readonly string[] | null {
  if (!Number.isInteger(age) || age < 0 || age > 18) return null
  if (age <= 5) return ['영유아']
  if (age <= 7) return ['영유아', '초등']
  if (age <= 11) return ['초등']
  if (age <= 13) return ['초등', '중고등']
  if (age <= 17) return ['중고등']
  return ['중고등', '대학·취준']
}

/** 🔴 `N개월` 은 72개월(6살)까지만 영유아로 읽는다 — 그 위는 나이로 읽지 않는다 */
const MAX_MONTHS = 72
const NATIVE_AGE: Readonly<Record<string, number>> = (() => {
  const ones: Record<string, number> = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9 }
  const out: Record<string, number> = { ...ones, 열: 10 }
  for (const [w, n] of Object.entries(ones)) out[`열${w}`] = 10 + n
  return out
})()
const NATIVE_AGE_WORDS = Object.keys(NATIVE_AGE).sort((a, b) => b.length - a.length).join('|')
/** 나이 한 덩이 — `2살` · `두 살` · `7세` · `18개월`. `세` 는 뒤가 `세계` · `세금` 이 아닐 때만(`2세의` · `2세 아이`) */
const AGE_TOKEN =
  `(?<![0-9가-힣])(?:\\d{1,2}|${NATIVE_AGE_WORDS})\\s*(?:살(?=$|[^가-힣]|짜리|이|인|된|의|쯤|밖에|도|만|으로|에|은|는|예요|때)`
  + '|세(?=$|[^가-힣]|의|인|이|짜리|된|쯤|도|만|는|은)|개월)'
/** 🔴 나이 **차이**(`2살 차이` · `두 살 터울`)는 아이의 나이가 아니다 */
const AGE_GAP_TAIL = /^(?:짜리|된|인|의)?\s*(?:차이|터울|차|위|아래|어린|어려|많|연상|연하|연장)/
/** 🔴 지난 때를 돌아보는 말(`2살 때` · `2살이었을 때`)은 지금 나이의 주장이 아니다 — 성인 자녀의 회상은 막지 않는다 */
const AGE_RECALL_TAIL = /^(?:이|인|짜리|된|의)?\s*(?:때|무렵|적(?:에|엔)?|이었|였|이던|던|시절)/
const AGE_ADVERB = '(?:이제|벌써|올해|지금|현재|막|곧|아직|갓|겨우|이번에)'
const AGE_POSSESSIVE = '(?:우리|저희|제|내|울)'
/** 자녀 낱말이 먼저 — `아이가 2살인데` · `우리 아들 7살` (서술형) */
const AGE_AFTER_KID_RE = new RegExp(`(?<![가-힣])(?:${AGE_POSSESSIVE}\\s*)?${AGE_KID}${KID_TAIL}\\s*(?:${AGE_ADVERB}\\s*)?(${AGE_TOKEN})`, 'g')
/** 나이가 먼저 — `2살 아이` · `두 살 된 딸` (수식형) */
const AGE_BEFORE_KID_RE = new RegExp(`(${AGE_TOKEN})\\s*(?:짜리|된|인|의)?\\s*(?:${AGE_POSSESSIVE}\\s*)?${AGE_KID}${KID_TAIL}(?![가-힣])`, 'g')

/** 나이 낱말 → 정본 나이대. 읽을 수 없으면 null */
function bandsOfAgeToken(token: string): readonly string[] | null {
  const m = /^(\d{1,2}|[가-힣]+)\s*(살|세|개월)$/.exec(token.trim())
  if (m === null) return null
  if (m[2] === '개월') return Number(m[1]) <= MAX_MONTHS && /^\d+$/.test(m[1]!) ? ['영유아'] : null
  const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : NATIVE_AGE[m[1]!]
  return n === undefined ? null : bandsOfAge(n)
}

/** 🔴 숫자 나이 읽기 — 아이의 나이가 아닌 말(차이 · 회상)은 건너뛴다 */
function readAgeMentions(text: string): BandMention[] {
  const out: BandMention[] = []
  const seen = new Set<number>()
  for (const [re, afterKid] of [[AGE_AFTER_KID_RE, true], [AGE_BEFORE_KID_RE, false]] as const) {
    for (const m of text.matchAll(re)) {
      const ageToken = m[1]!
      const ageAt = m.index! + m[0].lastIndexOf(ageToken)
      const tail = text.slice(ageAt + ageToken.length)
      if (AGE_GAP_TAIL.test(tail) || (afterKid && AGE_RECALL_TAIL.test(tail))) continue
      const anyOf = bandsOfAgeToken(ageToken)
      if (anyOf === null || seen.has(m.index!)) continue
      seen.add(m.index!)
      // 🔴 명시적 1인칭 소유(`우리 아이 …`)가 붙었거나 `아기` 가 아닌 자녀 낱말이 먼저 서면 한 아이를 서술한 말이다.
      //    `아기` 는 손주일 수 있어 수식 · 서술 모두 자기 가족 증거가 있을 때만 센다
      const explicit = new RegExp(`(?<![가-힣])${AGE_POSSESSIVE}\\s*(?:큰|작은|막내|외동)?\\s*${AGE_KID}`).test(m[0])
      const babyOnly = /아기/.test(m[0]) && !explicit
      const shape: AgeShape = explicit || (afterKid && !babyOnly) ? 'predicative' : 'attributive'
      out.push({ band: anyOf[0]!, anyOf, token: m[0].trim(), at: m.index!, shape })
    }
  }
  return out
}

/**
 * 🔴 나이를 말한 **꼴** — 누구의 아이인지는 꼴만으로 다 알 수 없다(`1살 아기` 는 손주일 수 있다):
 *    · `word`        나이대 낱말(`유치원` · `중학생`) — 앞판 그대로. 임자 규칙이 생략된 1인칭으로 읽는다
 *    · `predicative` 한 아이를 서술(`아이가 2살인데` · `우리 아들 7살`) — 특정한 한 아이를 말한 주장이다. 묻는 문장이어도 자기 일이다
 *    · `attributive` 수식(`2살 아이` · `6개월 아기`) — 누구의 아이든 쓸 수 있는 말이라 **자기 가족 증거가 글에 있을 때만** 자기 일이다
 */
export type AgeShape = 'word' | 'predicative' | 'attributive'
/** 🔴 한 밴드 읽음 — `anyOf` 는 이 말이 가리킬 수 있는 정본 나이대 전부다(낱말은 하나 · 경계 나이는 둘) */
export type BandMention = {
  band: string
  anyOf: readonly string[]
  token: string
  at: number
  shape: AgeShape
}
export type KidCount = { at: number; n: number; token: string }
export type FamilySpecifics = {
  /** 처음 걸린 수 — 없으면 null */
  count: KidCount | null
  /** 자녀 성별 낱말 (`아들` · `딸`) — 처음 걸린 자리 */
  gender: { at: number; token: string } | null
  /** 나이대 낱말 · 숫자 나이가 가리키는 정본 나이대 · 그 말 */
  bands: BandMention[]
}

/** 🔴 수로 말한 자녀 — `아들 둘` · `딸 셋` · `아이 2명` (뒤에 수) · `두 아이` · `세 딸` (앞에 수) */
export function readKidCount(text: string): KidCount | null {
  const a = COUNT_AFTER_RE.exec(text)
  if (a !== null) {
    const w = a[1]!.replace(/\s+/g, '')
    const n = /^[1-4]명$/.test(w) ? Number(w[0]) : COUNT_WORD[w.replace(/명$/, '')] ?? null
    if (n !== null) return { at: a.index, n, token: a[0].trim() }
  }
  const b = COUNT_BEFORE_RE.exec(text)
  if (b !== null) return { at: b.index, n: COUNT_WORD[b[1]!]!, token: b[0].trim() }
  return null
}

export function readFamilySpecifics(text: string): FamilySpecifics {
  const count = readKidCount(text)
  const g = GENDER_OWN_RE.exec(text)
  // 🔴 수로 말한 자녀에 성별이 들었으면(`아들 둘` · `두 딸`) 그것도 자기 자녀의 성별이다
  const gender = g !== null ? { at: g.index, token: g[0].trim() }
    : count !== null && GENDER_IN_COUNT_RE.test(count.token) ? { at: count.at, token: count.token } : null
  const bands: BandMention[] = []
  for (const [re, band] of BAND_WORDS) {
    const m = re.exec(text)
    if (m !== null) bands.push({ band, anyOf: [band], token: m[0], at: m.index, shape: 'word' })
  }
  bands.push(...readAgeMentions(text))
  return { count, gender, bands }
}

/**
 * 🔴 **자기 가족 소유 표지** — 글쓴이가 자기 자녀의 것으로 말한 증거다. 물음표로 끝나도 그대로 증거다.
 *    · 명시적 1인칭 소유 — `우리 아이` · `제 딸` · `저희 큰아들`
 *    · 자녀의 것 — `아이 거니까` · `애 꺼라서` · `딸 것이라` (임자는 생략된 1인칭 — 앞에 남이 서면 부르는 쪽이 거른다)
 *    누구의 아이인지 **판정하지는 않는다**(그건 부르는 쪽의 임자 규칙) — 읽기만 한다.
 */
export type FamilyOwnership = { at: number; token: string }
const OWN_KID = '(?:아이|애|아기|아들|딸|자녀|자식)'
const OWN_EXPLICIT_RE = new RegExp(`(?<![가-힣])(?:우리|저희|울|제|내)\\s*(?:큰|작은|막내|외동)?\\s*${OWN_KID}${KID_TAIL}(?![가-힣])`)
const OWN_THING_RE = new RegExp(`(?<![가-힣])${OWN_KID}${KID_TAIL}\\s*(?:거|꺼|것)(?=니|라|이|인|예|에|야|를|도|만|은|는|가|$|[^가-힣])`)
export function readFamilyOwnership(text: string): FamilyOwnership | null {
  const hits = [OWN_EXPLICIT_RE.exec(text), OWN_THING_RE.exec(text)].filter((m): m is RegExpExecArray => m !== null)
  if (hits.length === 0) return null
  const first = hits.reduce((a, b) => (b.index < a.index ? b : a))
  return { at: first.index, token: first[0].trim() }
}

/** 🔴 이 밴드 읽음이 카드의 나이대와 맞는가 — 가리킬 수 있는 나이대 중 하나라도 카드에 있으면 맞다 */
export function bandFits(b: Pick<BandMention, 'anyOf'>, cardBands: readonly string[]): boolean {
  return b.anyOf.some((x) => cardBands.includes(x))
}

/** 🔴 정본 카드의 자녀 칸 — 성별 칸이 없다는 것까지가 계약이다 */
export type FamilyCard = { childrenCount: number; childrenAgeBands: readonly string[] }

/**
 * 🔴 **이 가족 사실을 이 카드의 1인칭으로 말해도 되는가.** 어긋난 것을 사람이 읽을 문장으로 돌려준다(없으면 빈 배열).
 *    · 수 — 카드 자녀 수와 **정확히** 같아야 한다
 *    · 성별 — 카드에 없다. 언제나 어긋난다
 *    · 나이대 — 카드의 나이대 중 하나여야 한다
 */
export function familyMismatches(s: FamilySpecifics, card: FamilyCard): string[] {
  const out: string[] = []
  if (s.count !== null && s.count.n !== card.childrenCount) out.push(`자녀 수 "${s.count.token}"(${s.count.n}) ≠ 카드 ${card.childrenCount}명`)
  if (s.gender !== null) out.push(`자녀 성별 "${s.gender.token}" — 카드에 자녀 성별이 없다`)
  for (const b of s.bands) {
    if (!bandFits(b, card.childrenAgeBands)) out.push(`자녀 나이대 "${b.token}"(${b.anyOf.join('|')}) ∉ 카드 ${card.childrenAgeBands.join('·') || '미상'}`)
  }
  return out
}
