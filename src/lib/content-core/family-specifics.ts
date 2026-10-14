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
 */
export const FAMILY_SPECIFICS_VERSION = 'family-specifics-v1'

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

export type KidCount = { at: number; n: number; token: string }
export type FamilySpecifics = {
  /** 처음 걸린 수 — 없으면 null */
  count: KidCount | null
  /** 자녀 성별 낱말 (`아들` · `딸`) — 처음 걸린 자리 */
  gender: { at: number; token: string } | null
  /** 나이대 낱말이 가리키는 정본 나이대 · 그 낱말 */
  bands: { band: string; token: string; at: number }[]
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
  const bands: FamilySpecifics['bands'] = []
  for (const [re, band] of BAND_WORDS) {
    const m = re.exec(text)
    if (m !== null) bands.push({ band, token: m[0], at: m.index })
  }
  return { count, gender, bands }
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
    if (!card.childrenAgeBands.includes(b.band)) out.push(`자녀 나이대 "${b.token}"(${b.band}) ∉ 카드 ${card.childrenAgeBands.join('·') || '미상'}`)
  }
  return out
}
