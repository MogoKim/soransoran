/**
 * 문체 · 입력 흔적 신호 6종 (VE-M2)
 *
 * 정본: docs/operations/2026-08-26-voice-derived-m2-design.md §1 · §3
 *
 * 🔴 비용 0원이다
 *    네트워크 · LLM · 외부 API · 난수가 **하나도 없다**. 전부 세기와 정규식이다.
 *    같은 입력이면 항상 같은 출력이 나온다 — fixture 로 잠글 수 있는 이유가 이것이다.
 *
 * 🔴 원문을 반환값에 담지 않는다
 *    여기 들어오는 것은 본문 문자열이지만, 나가는 것은 **개수 · 비율 · 어휘 목록**뿐이다.
 *    문장이 그대로 새어 나가면 VoiceDerived 가 본문 저장소가 된다.
 *    (실제로 legacyLabels 경유로 그런 일이 있었다 — VE-R3.1 · PR #93)
 *
 * 🔴 source 중립이다
 *    우나어 · 82cook · 소란소란 어디서 온 글이든 같은 함수를 쓴다.
 *    출처별 분기는 `communityRegister` 사전 안에서만 일어난다.
 */

/** 이 규칙 묶음의 버전. 🔴 규칙이 바뀌면 값의 의미가 바뀐다 */
export const STYLE_RULE_VERSION = 'voice-m2-rule-v1'

// ── communityRegister 사전 ────────────────────────────────
//    🔴 다섯 갈래로 나누는 이유는 m2-design §3-5 에 있다.
//       단순 사전이면 "무엇을 쓰지 말아야 하는가" 를 표현할 수 없다.

/**
 * 원출처 커뮤니티 호칭 — 🔴 **치환 대상**이다.
 * 그대로 쓰면 소란소란 글이 다른 커뮤니티에서 옮겨온 티를 낸다.
 */
export const SOURCE_SPECIFIC_TERMS = [
  { term: '82님들', site: '82cook' },
  { term: '82님', site: '82cook' },
  { term: '우갱님들', site: 'navercafe:wgang' },
  { term: '우갱님', site: 'navercafe:wgang' },
  { term: '레테님들', site: 'navercafe:remonterrace' },
  { term: '레테님', site: 'navercafe:remonterrace' },
  { term: '은오님들', site: 'navercafe:dlxogns01' },
  { term: '은오님', site: 'navercafe:dlxogns01' },
] as const

/** 소란소란 내부 호칭 — ✅ **치환 결과**로 쓴다 */
export const SORANSORAN_REGISTER_TERMS = [
  '소란소란님들', '소란소란님', '소란님들', '소란님',
] as const

/**
 * 🔴 타겟 설명어 — **생성 금지**다.
 *
 * 다른 갈래는 원문에서 관찰한 것을 담지만 이 갈래만 방향이 반대다:
 * **우리가 만들어내면 안 되는 것**의 목록이다.
 *
 * 문서 설명으로는 그럴듯해 보여도 실제 커뮤니티 글 안에서는
 * **AI 가 타겟을 해석해서 만든 말처럼 읽힌다.**
 * 커뮤니티 안에서 사람들은 서로를 설명하지 않는다 — 그냥 부른다.
 */
export const TARGET_DESCRIPTOR_TERMS = [
  '우리 또래분들', '우리 또래 분들', '우리또래분들', '우리 또래',
  '40대 여성분들', '50대 여성분들', '60대 여성분들',
  '40대 여성', '50대 여성', '60대 여성',
  '중년 여성분들', '중년 여성', '같은 세대 분들', '같은 세대분들', '같은 세대',
] as const

/** 일반 커뮤니티 표현 — 🟢 학습하고 살린다. 출처를 드러내지 않는다 */
export const GENERIC_COMMUNITY_TERMS = [
  '여기 계신 분들', '여기계신 분들', '혹시 저만', '저만 그런가요', '다들 어떠세요',
  '다들', '혹시', '조언 부탁', '경험 있으신', '어떻게 하세요', '있으세요',
] as const

/**
 * 출처 맥락 표현 — 🔴 **site 키가 없다.** 어느 출처에서 왔든 걸린다.
 *
 * `SOURCE_SPECIFIC_TERMS` 가 "누구를 불렀나"(82님들)를 본다면
 * 이쪽은 **"어디서 썼나"**(우리 카페)를 본다. 출처명을 몰라도 출처가 드러난다.
 *
 * 🔴 tier 를 나누는 이유 — **'카페' 는 커피숍이기도 하다.**
 *    "이 카페 커피가 맛있더라고요" 는 완전히 정상적인 우리 글이다.
 *    40~60대 여성 커뮤니티에서 커피숍 이야기는 흔하고,
 *    이걸 무조건 regenerate 로 두면 정상 생성물이 계속 폐기된다.
 *    재생성해도 소재가 같으면 또 걸려 3회 후 폐기된다.
 */
export const SOURCE_CONTEXT_TERMS = [
  // 🔴 strong — 커뮤니티 문맥에서만 성립한다. 단독으로 차단
  { term: '카페 회원님들', tier: 'strong' },
  { term: '우리 카페에서는', tier: 'strong' },
  { term: '카페 공지', tier: 'strong' },
  { term: '등업', tier: 'strong' },
  // 🟡 ambiguous — 커피숍 의미와 겹친다. 단서를 함께 봐야 한다
  { term: '카페 회원', tier: 'ambiguous' },
  { term: '우리 카페', tier: 'ambiguous' },
  { term: '여기 카페', tier: 'ambiguous' },
  { term: '이 카페', tier: 'ambiguous' },
] as const

/** ambiguous 를 **커뮤니티** 의미로 확정시키는 단서 */
export const CAFE_COMMUNITY_CUES = [
  '게시판', '눈팅', '가입', '등업', '공지', '댓글', '회원님', '카페글', '카페에 올린',
] as const

/** ambiguous 를 **커피숍** 의미로 되돌리는 단서 — 🟢 있으면 살린다 */
export const CAFE_SHOP_CUES = [
  '커피', '원두', '아메리카노', '라떼', '디저트', '케이크', '사장님', '알바', '테이블', '자리',
] as const

/** '카페' 가 어느 의미로 쓰였는지 */
export type CafeSense =
  | 'community'   // 커뮤니티 — 출처 흔적이다
  | 'shop'        // 커피숍 — 🟢 정상 소재다
  | 'unknown'     // 단서가 없거나 양쪽 다 있다 — 사람이 본다
  | 'none'        // ambiguous 항목 자체가 없다

/** 공동체에 말을 거는 구조 */
export type AddressPattern =
  | 'collective_question'   // 여럿에게 묻는다
  | 'advice_request'        // 조언을 청한다
  | 'personal_confession'   // 혼자 털어놓는다
  | 'none'

// ── 신호 타입 ─────────────────────────────────────────────
//    🔴 전부 수치 · 어휘 목록이다. 문장이 없다.

export type TypingArtifacts = {
  /** 단독 자모 (ㅋㅋ · ㅠㅠ 등) 등장 횟수 */
  standaloneJamo: number
  /** 같은 글자 3회 이상 반복 (ㅋㅋㅋ · 아아아) */
  repeatedChars: number
  /** 자모가 섞인 어절 수 */
  jamoWords: number
}

export type PunctuationHabit = {
  ellipsis: number      // `..` `...`
  tilde: number         // `~` `~~`
  question: number
  exclamation: number
  emoticon: number      // `^^` `ㅠㅠ` `ㅜㅜ`
  /** 문장부호 전체 밀도 (100자당) */
  densityPer100: number
}

export type SpacingVariance = {
  wordCount: number
  avgWordLength: number
  /** 어절 길이의 표준편차 — 클수록 리듬이 불규칙하다 */
  stdWordLength: number
  /** 8자 이상 붙여 쓴 어절 수 (구어체 붙여쓰기 후보) */
  longRunWords: number
}

export type MobileInputTrace = {
  lineCount: number
  paragraphCount: number
  avgLineLength: number
  /** 20자 미만 줄의 비율 — 모바일 입력에서 높아진다 */
  shortLineRatio: number
  /** 빈 줄 비율 */
  blankLineRatio: number
}

export type CommunityRegister = {
  /** 🔴 치환 대상 */
  sourceSpecific: Array<{ term: string; site: string; count: number }>
  /** ✅ 치환 결과 후보 — 원문에 이미 있으면 그대로 둔다 */
  soransoranRegister: string[]
  /** 🔴 생성 금지 신호. **좋은 치환어가 아니다** */
  targetDescriptorRisk: string[]
  /** 🟢 학습하고 살린다 */
  genericCommunityPhrase: string[]
  /** 질문 · 공동체 호출 구조를 살릴지 여부 */
  preserveStructure: AddressPattern
  /**
   * 🔴 출처 맥락 — site 키가 없어 위 갈래에 담을 수 없다.
   *    위 5개 필드는 VE-M2 계약이라 건드리지 않고 **추가만** 한다.
   */
  sourceContextRisk: Array<{ term: string; tier: 'strong' | 'ambiguous'; count: number }>
  /** ambiguous 항목이 커뮤니티인지 커피숍인지 — 판정 근거. 운영자가 review 를 볼 때 필요하다 */
  cafeSense: CafeSense
}

export type ArtifactFrequency = {
  /** 아래 값은 전부 **100자당 빈도**다. 길이가 다른 글을 비교할 수 있어야 한다 */
  typingPer100: number
  punctuationPer100: number
  emoticonPer100: number
  shortLinePer100: number
  /** 🔴 신호가 얼마나 관찰됐는가. 짧은 글은 표본이 부족하다 */
  sampleChars: number
  /** 표본이 이 값 미만이면 빈도를 신뢰하지 않는다 */
  lowSample: boolean
}

export type StyleSignals = {
  typingArtifacts: TypingArtifacts
  punctuationHabit: PunctuationHabit
  spacingVariance: SpacingVariance
  mobileInputTrace: MobileInputTrace
  communityRegister: CommunityRegister
  artifactFrequency: ArtifactFrequency
}

/** 이 길이 미만이면 문체 표본이 부족하다 — 본문의 45.7% 가 300자 미만이다 */
export const LOW_SAMPLE_CHARS = 200

// ── 계산 ──────────────────────────────────────────────────

const JAMO = /[ㄱ-ㅎㅏ-ㅣ]/g
const REPEAT3 = /(.)\1{2,}/g
const round2 = (n: number): number => Math.round(n * 100) / 100

export function computeTypingArtifacts(text: string): TypingArtifacts {
  const words = text.split(/\s+/).filter(Boolean)
  return {
    standaloneJamo: (text.match(JAMO) ?? []).length,
    repeatedChars: (text.match(REPEAT3) ?? []).length,
    jamoWords: words.filter((w) => JAMO.test(w) && ((JAMO.lastIndex = 0), true)).length,
  }
}

export function computePunctuationHabit(text: string): PunctuationHabit {
  const ellipsis = (text.match(/\.{2,}|…/g) ?? []).length
  const tilde = (text.match(/~+/g) ?? []).length
  const question = (text.match(/\?/g) ?? []).length
  const exclamation = (text.match(/!/g) ?? []).length
  const emoticon = (text.match(/\^\^|ㅠ+|ㅜ+|ㅎㅎ+|ㅋㅋ+/g) ?? []).length
  const total = ellipsis + tilde + question + exclamation + emoticon
  return {
    ellipsis, tilde, question, exclamation, emoticon,
    densityPer100: text.length ? round2((total / text.length) * 100) : 0,
  }
}

export function computeSpacingVariance(text: string): SpacingVariance {
  const words = text.split(/\s+/).filter(Boolean)
  const lens = words.map((w) => w.length)
  const avg = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0
  const variance = lens.length
    ? lens.reduce((a, b) => a + (b - avg) ** 2, 0) / lens.length
    : 0
  return {
    wordCount: words.length,
    avgWordLength: round2(avg),
    stdWordLength: round2(Math.sqrt(variance)),
    longRunWords: lens.filter((l) => l >= 8).length,
  }
}

export function computeMobileInputTrace(text: string): MobileInputTrace {
  const lines = text.split('\n')
  const nonBlank = lines.filter((l) => l.trim().length > 0)
  const avg = nonBlank.length
    ? nonBlank.reduce((a, l) => a + l.trim().length, 0) / nonBlank.length
    : 0
  return {
    lineCount: lines.length,
    // 빈 줄로 갈린 덩어리 수
    paragraphCount: text.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length,
    avgLineLength: round2(avg),
    shortLineRatio: nonBlank.length
      ? round2(nonBlank.filter((l) => l.trim().length < 20).length / nonBlank.length)
      : 0,
    blankLineRatio: lines.length
      ? round2((lines.length - nonBlank.length) / lines.length)
      : 0,
  }
}

/** 등장 횟수를 센다. 🔴 문장이 아니라 **어휘와 개수**만 남긴다 */
function countTerm(text: string, term: string): number {
  if (!term) return 0
  let n = 0
  let i = text.indexOf(term)
  while (i !== -1) { n += 1; i = text.indexOf(term, i + term.length) }
  return n
}

function detectAddressPattern(text: string, hasAddress: boolean): AddressPattern {
  const asksAdvice = /조언|어떻게 해야|어떡하죠|어떡해요|방법 있을까|추천/.test(text)
  const asksGroup = /어떠세요|있으세요|하세요\?|어떻게 하세요|다들|혹시 저만|저만 그런/.test(text)
  if (asksAdvice) return 'advice_request'
  if (asksGroup || (hasAddress && text.includes('?'))) return 'collective_question'
  if (hasAddress) return 'collective_question'
  return 'personal_confession'
}

export function computeCommunityRegister(text: string): CommunityRegister {
  const sourceSpecific: Array<{ term: string; site: string; count: number }> = []
  // 🔴 긴 것부터 센다. '82님들' 을 먼저 세지 않으면 '82님' 이 두 번 잡힌다.
  const seenSpans: string[] = []
  for (const { term, site } of [...SOURCE_SPECIFIC_TERMS].sort((a, b) => b.term.length - a.term.length)) {
    if (seenSpans.some((s) => s.includes(term))) continue
    const count = countTerm(text, term)
    if (count > 0) { sourceSpecific.push({ term, site, count }); seenSpans.push(term) }
  }

  const soransoranRegister: string[] = []
  const seenSoran: string[] = []
  for (const term of [...SORANSORAN_REGISTER_TERMS].sort((a, b) => b.length - a.length)) {
    if (seenSoran.some((s) => s.includes(term))) continue
    if (countTerm(text, term) > 0) { soransoranRegister.push(term); seenSoran.push(term) }
  }

  const targetDescriptorRisk: string[] = []
  const seenTarget: string[] = []
  for (const term of [...TARGET_DESCRIPTOR_TERMS].sort((a, b) => b.length - a.length)) {
    if (seenTarget.some((s) => s.includes(term))) continue
    if (countTerm(text, term) > 0) { targetDescriptorRisk.push(term); seenTarget.push(term) }
  }

  const genericCommunityPhrase = GENERIC_COMMUNITY_TERMS
    .filter((t) => countTerm(text, t) > 0)

  // 🔴 '우리 카페' 가 '우리 카페에서는' 으로도 잡히면 두 건이 된다 — 위 갈래와 같은 규칙
  const sourceContextRisk: Array<{ term: string; tier: 'strong' | 'ambiguous'; count: number }> = []
  const seenContext: string[] = []
  for (const { term, tier } of [...SOURCE_CONTEXT_TERMS].sort((a, b) => b.term.length - a.term.length)) {
    if (seenContext.some((s) => s.includes(term))) continue
    const count = countTerm(text, term)
    if (count > 0) { sourceContextRisk.push({ term, tier, count }); seenContext.push(term) }
  }

  // 🔴 ambiguous 가 없으면 판정할 것도 없다. strong 은 단서와 무관하게 확정이다
  const hasAmbiguous = sourceContextRisk.some((r) => r.tier === 'ambiguous')
  const communityCue = CAFE_COMMUNITY_CUES.some((c) => countTerm(text, c) > 0)
  const shopCue = CAFE_SHOP_CUES.some((c) => countTerm(text, c) > 0)
  let cafeSense: CafeSense = 'none'
  if (hasAmbiguous) {
    if (communityCue && !shopCue) cafeSense = 'community'
    else if (shopCue && !communityCue) cafeSense = 'shop'
    else cafeSense = 'unknown'   // 단서가 없거나 양쪽 다 있으면 사람이 본다
  }

  const hasAddress = sourceSpecific.length > 0 || soransoranRegister.length > 0
  return {
    sourceSpecific,
    soransoranRegister,
    targetDescriptorRisk,
    genericCommunityPhrase: [...genericCommunityPhrase],
    preserveStructure: detectAddressPattern(text, hasAddress),
    sourceContextRisk,
    cafeSense,
  }
}

export function computeArtifactFrequency(
  text: string, typing: TypingArtifacts, punct: PunctuationHabit, mobile: MobileInputTrace,
): ArtifactFrequency {
  const chars = text.length
  const per100 = (n: number): number => (chars ? round2((n / chars) * 100) : 0)
  return {
    typingPer100: per100(typing.standaloneJamo + typing.repeatedChars),
    punctuationPer100: punct.densityPer100,
    emoticonPer100: per100(punct.emoticon),
    shortLinePer100: per100(Math.round(mobile.shortLineRatio * mobile.lineCount)),
    sampleChars: chars,
    // 🔴 이 플래그가 없으면 60자짜리 글의 빈도를 3,000자짜리와 나란히 놓게 된다
    lowSample: chars < LOW_SAMPLE_CHARS,
  }
}

/**
 * 본문 하나에서 신호 6종을 뽑는다.
 *
 * 🔴 반환값에 본문이 없다. 넣지도 마라 — 이 함수의 출력이 그대로 DB 로 간다.
 */
export function computeStyleSignals(text: string): StyleSignals {
  const typingArtifacts = computeTypingArtifacts(text)
  const punctuationHabit = computePunctuationHabit(text)
  const mobileInputTrace = computeMobileInputTrace(text)
  return {
    typingArtifacts,
    punctuationHabit,
    spacingVariance: computeSpacingVariance(text),
    mobileInputTrace,
    communityRegister: computeCommunityRegister(text),
    artifactFrequency: computeArtifactFrequency(text, typingArtifacts, punctuationHabit, mobileInputTrace),
  }
}
