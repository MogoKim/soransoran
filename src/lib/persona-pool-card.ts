/**
 * Pool 카드 파서 — 🔴 **정본은 문서다** (`docs/operations/2026-08-30-persona-pool-design.md` §5)
 *
 * 🔴 왜 파서인가.
 *    persona 를 늘릴 때 카드를 손으로 옮겨 적으면, 옮기는 사람이 실수한 순간
 *    시뮬레이션은 **존재하지 않는 사람**을 놓고 계산한다. 그 위에서 "3명이면 된다" 는
 *    결론이 나오면 아무도 틀린 줄 모른다. 그래서 문서를 그대로 읽는다.
 *
 * 🔴 판정을 여기서 만들지 않는다. `readLengthBand` · `CHILD_AGE_BANDS` 는 매칭 정본의 것을 부른다.
 *    여기서 다시 만들면 카드가 매칭과 다른 말을 하게 된다.
 *
 * 🔴 순수 함수다. 파일도 DB 도 읽지 않는다 — 텍스트를 받는다.
 */

import { CHILD_AGE_BANDS, readLengthBand, type ChildAgeBand, type PersonaForMatch } from './original-post-persona-match'
import { isNoGoExpressionItem } from './persona-no-go'

export type PoolCard = {
  /** `P01` ~ `P20` */
  code: string
  /**
   * 🔴 **내부 생일** (`YYYY-MM-DD`). 정확한 나이를 계산하는 **유일한 정본**이다.
   *    🔴 글에 쓰지 않는다 — 나오는 것은 계산된 나이뿐이다.
   *    🔴 해시로 유도하지 않는다. 규칙이나 `ageBand` 가 바뀌어도 생일은 그대로여야 한다.
   */
  birthDate: string
  /** 카드 제목 — 사람이 어느 카드인지 알아보는 용도 */
  title: string
  ageBand: string
  region: string
  maritalStatus: string
  /** 기혼(원만) 의 괄호 안 — 없으면 null */
  spouseRelationship: string | null
  childrenCount: number
  childrenAgeBands: ChildAgeBand[]
  workStatus: string
  economicStatus: string
  housing: string
  menopauseStatus: string
  parentCare: string
  /** 성격 — 카드 `성격` 줄 그대로 */
  personality: string[]
  /**
   * 🔴 noGo **소재** — `hardFilter` 가 본문에 그대로 있는지 본다(`all.includes(topic)`).
   *    그래서 따옴표로 감싼 말버릇(`"요즘 애들" 류`)은 여기 들어가면 안 된다 — 그건 표현이다.
   *    실측 대조: P05 DB `noGoTopics = ["시어머니 험담","며느리 훈계"]` 와 같은 규칙이다.
   */
  noGoTopics: string[]
  /** 🔴 noGo **표현** — 따옴표로 감싼 말버릇. 소재 매칭에 넣으면 본문에 안 걸린다 */
  noGoExpressions: string[]
  /** 카드 `금지` 줄의 역할 이름 — `advice(의료)` 는 `advice` 다 */
  forbiddenReactionRoles: string[]
  /** voiceCore 원문 토큰 — 🔴 그대로 보존한다 */
  voiceTokens: string[]
  /** `readLengthBand` 가 읽어낸 길이 표현. 못 읽으면 null */
  voiceLength: string | null
  /** variation ①②③… 개수 */
  variationCount: number
  /**
   * 🔴 **집안 구성** (2026-09-28 quality-v2) — 카드 글자에서 읽는다. 못 읽으면 `null` 이다.
   *    초안 게이트가 "자녀가 집에 있는가" · "돌보는 부모와 한집인가" 를 판정할 때만 쓴다.
   *    🔴 생성 계약(`LIFE_CONTRACT_FIELDS`)에 넣지 않는다 — 프롬프트에 실리지 않는 값이라
   *       넣으면 옛 artifact 캐시만 이유 없이 전부 바뀐다.
   */
  household: CardHousehold
}

/**
 * 🔴 **카드가 말하는 집안 구성.** 모르는 것은 `null` 이다 — 기본값을 지어내지 않는다.
 *    · `childrenLiving`  자녀 괄호의 `동거` · `분가` — 둘 다 있거나 일부만 동거면 `일부`
 *    · `careSide`        상시 돌봄 대상 쪽 — 카드 제목의 `시어머니·시부모` 는 `시댁`, `친정·부모` 는 `친정`
 *    · `careCohabit`     그 부모와 한집인가 — `모시는` 은 한집, `곁에` · `오가며` · `혼자 살며` 는 따로
 */
export type CardHousehold = {
  childrenLiving: '동거' | '분가' | '일부' | null
  careSide: '시댁' | '친정' | null
  careCohabit: boolean | null
}

/** 🔴 카드의 자녀 표기 → 매칭이 아는 밴드. 여기가 유일한 대응표다 */
const CHILD_BAND_ALIAS: ReadonlyArray<{ keys: readonly string[]; band: ChildAgeBand }> = [
  { keys: ['영유아', '미취학'], band: '영유아' },
  { keys: ['초등'], band: '초등' },
  { keys: ['중고생', '중고등', '중학', '고등'], band: '중고등' },
  { keys: ['대학생', '대학', '취준'], band: '대학·취준' },
  { keys: ['성인'], band: '성인' },
]

/** 🔴 혼인 상태 — 카드 표기 그대로 쓴다. `기혼` 만 현재형 배우자 글을 맡을 수 있다(hardFilter) */
const MARITAL = ['기혼', '이혼', '사별', '비혼', '별거'] as const

const MENOPAUSE = ['전', '진행중', '후'] as const

/** 🔴 카드 `금지` 줄에 나올 수 있는 역할 — 모르는 이름이 나오면 **버리지 않고 문제로 남긴다** */
export const REACTION_ROLES = [
  'advice', 'information', 'caution', 'levity', 'rebuttal', 'experience', 'empathy', 'question',
] as const
const PARENT_CARE = ['없음', '간헐', '상시'] as const

/**
 * `·` 로 나누고 앞뒤 공백·🔴 표식을 턴다.
 *
 * 🔴 **괄호 안의 `·` 는 구분자가 아니다.** `advice(의료·재무)` 를 그냥 쪼개면
 *    `advice(의료` 와 `재무)` 두 조각이 되어, 역할 이름도 자녀 나이대도 잘못 읽힌다.
 */
function parts(line: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of line) {
    if (ch === '(' || ch === '（') depth += 1
    else if (ch === ')' || ch === '）') depth = Math.max(0, depth - 1)
    if (ch === '·' && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.replace(/🔴/g, '').trim()).filter((s) => s !== '')
}

/**
 * 자녀 표기 하나를 읽는다 — `자녀 2(중고생·초등, 동거)` · `자녀 3(성인 2 분가 · 고등 1 동거)` · `자녀 없음`
 *
 * 🔴 나이대는 **나오는 순서대로 중복 없이** 모은다. 개수와 밴드는 따로다 —
 *    `자녀 3(성인 2 · 고등 1)` 은 3명이지만 밴드는 2종이다.
 */
export function readChildren(text: string): { count: number; bands: ChildAgeBand[] } {
  if (/자녀\s*없음/.test(text)) return { count: 0, bands: [] }
  const m = /자녀\s*(\d+)\s*(?:\(([^)]*)\))?/.exec(text)
  if (m === null) return { count: 0, bands: [] }
  const count = Number(m[1])
  const inner = m[2] ?? ''
  const bands: ChildAgeBand[] = []
  // 🔴 긴 별칭이 먼저 잡히도록 등장 위치로 정렬한다 — `중고생` 이 `고등` 보다 앞에 있어야
  //    "중고생" 을 "고등" 으로 두 번 세지 않는다
  const hits: { at: number; band: ChildAgeBand }[] = []
  for (const a of CHILD_BAND_ALIAS) {
    for (const k of a.keys) {
      const at = inner.indexOf(k)
      if (at >= 0 && !hits.some((h) => h.at <= at && at < h.at + k.length && h.band !== a.band)) {
        hits.push({ at, band: a.band })
      }
    }
  }
  for (const h of hits.sort((x, y) => x.at - y.at)) if (!bands.includes(h.band)) bands.push(h.band)
  return { count, bands }
}

/**
 * 🔴 집안 구성을 카드 글자에서 읽는다 (2026-09-28). 판정은 하지 않는다 — 읽기만 한다.
 *    `자녀 2(대학생·중고생, 동거)` → 동거 · `자녀 3(성인 2 분가 · 고등 1 동거)` → 일부 ·
 *    `자녀 2(성인, 1 동거)` → 일부(수가 모자란다) · 괄호에 둘 다 없으면 `null`.
 */
export function readHousehold(title: string, idLine: string): CardHousehold {
  const kids = /자녀\s*(\d+)\s*\(([^)]*)\)/.exec(idLine)
  let childrenLiving: CardHousehold['childrenLiving'] = null
  if (kids !== null) {
    const count = Number(kids[1])
    const inner = kids[2] ?? ''
    const together = /동거/.test(inner)
    const apart = /분가/.test(inner)
    const partial = /(\d+)\s*동거/.exec(inner)
    if (together && apart) childrenLiving = '일부'
    else if (together) childrenLiving = partial !== null && Number(partial[1]) < count ? '일부' : '동거'
    else if (apart) childrenLiving = '분가'
  }
  const careSide: CardHousehold['careSide'] = /시어머니|시아버지|시부모|시댁/.test(title) ? '시댁'
    : /친정|부모/.test(title) ? '친정' : null
  const careCohabit = /모시는|모시고|한집/.test(title) ? true
    : /곁에|오가며|혼자\s*살며|혼자\s*사는/.test(title) ? false : null
  return { childrenLiving, careSide, careCohabit }
}

/** `기혼(원만)` → `{ status: '기혼', relationship: '원만' }` */
export function readMarital(text: string): { status: string | null; relationship: string | null } {
  for (const s of MARITAL) {
    if (!text.startsWith(s)) continue
    const m = /\(([^)]*)\)/.exec(text)
    return { status: s, relationship: m === null ? null : m[1]!.trim() }
  }
  return { status: null, relationship: null }
}

/** `갱년기 진행중` → `진행중` */
function readTagged(text: string, prefix: string, allowed: readonly string[]): string | null {
  if (!text.startsWith(prefix)) return null
  const v = text.slice(prefix.length).trim()
  return allowed.includes(v) ? v : null
}

/**
 * 카드 한 장 — 🔴 **하나라도 못 읽으면 `problems` 에 남기고 그 필드는 비운다.**
 *    조용히 기본값을 넣으면 매칭이 잘못된 사람을 만들어 낸다 (#468 이 그랬다).
 */
export function parseCard(code: string, title: string, body: string): { card: PoolCard | null; problems: string[] } {
  const problems: string[] = []
  const lines = body.split('\n').map((l) => l.trim()).filter((l) => l !== '')

  const idLine = lines.find((l) => l.startsWith('ageBand'))
  const lifeLine = lines.find((l) => /갱년기/.test(l) && !l.startsWith('ageBand'))
  const voiceLine = lines.find((l) => l.startsWith('voiceCore'))
  const personaLine = lines.find((l) => l.startsWith('성격'))
  const noGoLine = lines.find((l) => l.startsWith('noGo'))
  const banLine = lines.find((l) => l.startsWith('금지'))
  const varLines = lines.filter((l) => l.startsWith('variation') || /^[①②③④⑤⑥⑦⑧]/.test(l))

  if (idLine === undefined) problems.push('ageBand 줄이 없다')
  if (lifeLine === undefined) problems.push('갱년기·간병 줄이 없다')
  if (voiceLine === undefined) problems.push('voiceCore 줄이 없다')
  if (problems.length > 0) return { card: null, problems }

  const idParts = parts(idLine!.replace(/^ageBand\s*/, ''))
  const ageBand = idParts[0] ?? ''
  /**
   * 🔴 **생일은 카드에 적힌 값을 그대로 읽는다.** 없으면 문제로 올린다 —
   *    조용히 만들어 내면 정본이 두 벌이 된다.
   */
  const birthLine = lines.find((l) => l.startsWith('birthDate'))
  const birthDate = birthLine === undefined ? ''
    : (/(\d{4}-\d{2}-\d{2})/.exec(birthLine)?.[1] ?? '')
  if (birthDate === '') problems.push('birthDate 줄이 없거나 날짜를 읽을 수 없다')
  const region = idParts[1] ?? ''
  const mar = readMarital(idParts[2] ?? '')
  if (mar.status === null) problems.push(`혼인 상태를 읽지 못했다: ${idParts[2] ?? '—'}`)
  const kids = readChildren(idLine!)

  const lifeParts = parts(lifeLine!)
  const workStatus = lifeParts[0] ?? ''
  const economicStatus = lifeParts[1] ?? ''
  const housing = lifeParts[2] ?? ''
  const menopause = lifeParts.map((p) => readTagged(p, '갱년기', MENOPAUSE)).find((v) => v !== null) ?? null
  const care = lifeParts.map((p) => readTagged(p, '간병', PARENT_CARE)).find((v) => v !== null) ?? null
  if (menopause === null) problems.push('갱년기 상태를 읽지 못했다')
  if (care === null) problems.push('간병 상태를 읽지 못했다')

  const voiceTokens = parts(voiceLine!.replace(/^voiceCore\s*/, ''))
  // 🔴 길이 토큰이 첫 번째라는 보장이 없다 — P11 은 `구어체 · 길게` 다.
  //    정본 `readLengthBand` 가 읽어 주는 첫 토큰을 쓴다
  // 🔴 못 읽어도 카드를 버리지 않는다 — `null` 은 "모른다" 이고, `scoreMatch` 는 그것을 **중립**으로 다룬다.
  //    카드를 통째로 버리면 쓸 수 있는 사람이 사라지고, 기본값을 몰래 넣으면 없는 말투가 생긴다.
  //    대신 부르는 쪽이 "길이 미상" 으로 **보고**한다 (`readLengthBand` 별칭에 없는 표현이라는 뜻이다).
  const voiceLength = voiceTokens.find((t) => readLengthBand(t) !== null) ?? null

  const variationCount = varLines.join(' ').match(/[①②③④⑤⑥⑦⑧]/g)?.length ?? 0
  // 🔴 성격도 문서에 있다. 손으로 옮기면 옮긴 사람의 카드가 된다
  const personality = personaLine === undefined ? [] : parts(personaLine.replace(/^성격\s*/, ''))
  if (personality.length === 0) problems.push('성격 줄을 읽지 못했다')

  // ── 🔴 noGo — 매칭이 실제로 쓰는 입력이다. 빈 배열로 버리면 그 사람은 아무것도 안 피한다 ──
  const noGoTopics: string[] = []
  const noGoExpressions: string[] = []
  if (noGoLine === undefined) problems.push('noGo 줄이 없다')
  else {
    for (const item of parts(noGoLine.replace(/^noGo\s*/, ''))) {
      // 🔴 따옴표가 있으면 말버릇이다 — 본문 substring 매칭에 넣어도 걸리지 않는다
      if (isNoGoExpressionItem(item)) noGoExpressions.push(item)
      else noGoTopics.push(item)
    }
    if (noGoTopics.length === 0 && noGoExpressions.length === 0) problems.push('noGo 줄이 비었다')
  }

  // ── 🔴 금지 역할 — 모르는 이름을 조용히 버리지 않는다 ──
  const forbiddenReactionRoles: string[] = []
  if (banLine === undefined) problems.push('금지 줄이 없다')
  else {
    for (const item of parts(banLine.replace(/^금지\s*/, ''))) {
      // 역할 이름 뒤에 한정어가 붙는다 — 괄호(`advice(의료)`) 또는 공백(`information 단정`).
      // 🔴 첫 토큰이 **정확히 아는 역할**일 때만 받는다. 오타는 그대로 걸린다
      const name = item.split('(')[0]!.trim().split(/\s+/)[0]!.trim()
      if ((REACTION_ROLES as readonly string[]).includes(name)) forbiddenReactionRoles.push(name)
      else problems.push(`금지 줄에서 모르는 역할: ${name}`)
    }
    if (forbiddenReactionRoles.length === 0) problems.push('금지 역할을 하나도 읽지 못했다')
  }

  // 🔴 자녀 수와 밴드가 어긋나면 매칭이 CHILD_AGE_UNKNOWN 으로 막는다 — 여기서 잡는다
  if (kids.count > 0 && kids.bands.length === 0) problems.push('자녀가 있는데 나이대를 읽지 못했다')
  if (kids.count === 0 && kids.bands.length > 0) problems.push('자녀가 없는데 나이대가 읽혔다')

  if (problems.length > 0) return { card: null, problems }

  return {
    card: {
      code, title, ageBand, birthDate, region,
      maritalStatus: mar.status!, spouseRelationship: mar.relationship,
      childrenCount: kids.count, childrenAgeBands: kids.bands,
      workStatus, economicStatus, housing,
      menopauseStatus: menopause!, parentCare: care!,
      personality, noGoTopics, noGoExpressions, forbiddenReactionRoles,
      voiceTokens, voiceLength, variationCount,
      household: readHousehold(title, idLine!),
    },
    problems: [],
  }
}

/** 문서 전체(§5) 에서 `### P01 — 제목` 블록을 뽑아 전부 읽는다 */
export function parsePoolDoc(markdown: string): { cards: PoolCard[]; problems: string[] } {
  const cards: PoolCard[] = []
  const problems: string[] = []
  // 🔴 카드 본문은 헤딩 **바로 다음 코드펜스** 안이다. 헤딩 사이를 통째로 자르면
  //    마지막 카드가 뒤 절(§5-1) 까지 먹어 variation 을 잘못 센다 — 실측으로 잡았다.
  const re = /^### (P\d{2})\s*—\s*(.+)$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    const code = m[1]!
    const title = m[2]!.trim()
    const open = markdown.indexOf('```', m.index + m[0].length)
    const close = open < 0 ? -1 : markdown.indexOf('```', open + 3)
    if (open < 0 || close < 0) { problems.push(`${code}: 카드 본문(코드펜스)을 찾지 못했다`); continue }
    const { card, problems: p } = parseCard(code, title, markdown.slice(open + 3, close))
    if (card !== null) cards.push(card)
    for (const x of p) problems.push(`${code}: ${x}`)
  }
  return { cards, problems }
}

/**
 * 카드 → 매칭 입력 — 🔴 **여유는 항상 만땅으로 준다.**
 *    아직 없는 사람이므로 이력이 없다. 이력은 `forecastPublishing` 이 날짜를 밀며 채운다.
 */
export function cardToPersona(card: PoolCard): PersonaForMatch {
  return {
    code: card.code,
    status: 'active',
    // 🔴 아직 계정이 붙지 않았다. 실회원 차단(REAL_MEMBER)에 걸리지 않아야 시뮬이 성립한다.
    //    카드는 **아직 DB 에 없는 사람**이므로 Account 도 0 이다 — 만들 때 로그인 수단을 붙이지 않는다
    providerId: null,
    accountCount: 0,
    /**
     * 🔴 **나이대를 빠뜨리면 글쓴이가 몇 살인지 모르는 채로 글이 만들어진다** (2026-09-14).
     *
     *    이 함수는 `as PersonaForMatch` 캐스트로 끝난다 — 필드를 빠뜨려도 **typecheck 가 잡지 않는다.**
     *    실제로 `ageBand` 가 빠져 있었고, 그래서 생성·검수 프롬프트가 나이를 보지 못했다.
     *    실측: 40대 후반 P03 이 `우리 언니가 요즘 그 나이대(30~32)에 결혼 준비 중` 을 쓰고
     *    `lifeConflict=false` 로 통과했다.
     *
     *    🔴 fixture 는 캐스트를 믿지 않고 **값으로** 확인한다.
     */
    ageBand: card.ageBand,
    maritalStatus: card.maritalStatus,
    childrenCount: card.childrenCount,
    childrenAgeBands: card.childrenAgeBands,
    parentCare: card.parentCare,
    menopauseStatus: card.menopauseStatus,
    workStatus: card.workStatus,
    economicStatus: card.economicStatus,
    region: card.region,
    // 🔴 **카드의 noGo 소재를 그대로 넘긴다.** 빈 배열로 버리면 시뮬레이션 속 그 사람은
    //    아무것도 피하지 않는 사람이 되고, 실제로 켰을 때보다 발행량이 **부풀려진다**.
    noGoTopics: card.noGoTopics,
    noGoExpressions: card.noGoExpressions,
    voiceLength: card.voiceLength,
    postsThisWeek: 0,
    daysSinceLastPost: null,
  }
  /**
   * 🔴 **`as PersonaForMatch` 캐스트를 없앴다** (2026-09-14).
   *    캐스트가 있으면 필드를 빠뜨려도 typecheck 가 잡지 않는다 —
   *    실제로 `ageBand` 가 빠져 있었고, 생성·검수가 글쓴이 나이를 못 본 채로 돌았다.
   *    이제 반환 타입 검사로 누락이 **컴파일에서** 잡힌다.
   */
}

/** 🔴 매칭이 아는 밴드인지 — 카드 파싱 결과를 믿지 않고 다시 본다 */
export function isKnownChildBand(v: string): v is ChildAgeBand {
  return (CHILD_AGE_BANDS as readonly string[]).includes(v)
}
