/**
 * 원문 프로파일 — 🔴 순수 함수. LLM · DB · 파일 IO · 네트워크 없음
 *
 * 🔴 **이 파일이 존재하는 이유** (2026-09-01, PR A 3판 실패)
 *
 *    voice 샘플 2건을 붙였는데도 생성물이 "AI 가 정리한 글" 이었다. 실측 실패:
 *      #7 턱관절  절박함·분통이 사라지고 문학 수필이 됐다. 번호·반복·약·시간·CT 삭제
 *      #8 도시락  밝은 주접글이 신파 수필이 됐다. 없던 쓸쓸함이 생기고 ㅋㅋ·이모티콘 삭제
 *
 *    원인은 프롬프트 문구가 아니다. **모델에게 "이 글이 어떤 글인지" 를 아무도 말해
 *    주지 않았다.** 재료를 던지면 모델은 자기가 잘하는 것(정돈된 산문)으로 수렴한다.
 *    밝은 글도 슬픈 글도 같은 톤으로 나오는 이유가 그것이다.
 *
 *    그래서 원문을 **생성 전에 규칙으로 읽어** 무엇을 살려야 하는지 지목한다.
 *    모델의 자기 판단에 맡기지 않는다 — 규칙이면 fixture 로 잠글 수 있고,
 *    "왜 이 글이 이렇게 나왔나" 를 나중에 되짚을 수 있다.
 *
 * 🔴 **판정이 아니다.** 프로파일은 차단하지 않는다. 프롬프트에 실릴 지시를 만들 뿐이다.
 *    Gate 는 별도이고(PR B), 여기서 막기 시작하면 두 곳이 같은 일을 하게 된다.
 *
 * 🔴 **저장되지 않는다.** 프로파일은 프롬프트로만 나가고 파일에 남지 않는다
 *    (original-post-prompt.ts 의 3키 계약).
 */

// ─────────────────────────────────────────────────────────
// 축 정의
// ─────────────────────────────────────────────────────────

export const EMOTION_TONES = [
  'panic', 'resentment', 'bright_pride', 'playful_affection',
  'worry', 'practical_question', 'complaint', 'plain',
] as const
export type EmotionTone = (typeof EMOTION_TONES)[number]

export const TITLE_TEMPERATURES = ['calm', 'worried', 'urgent', 'overheat', 'playful'] as const
export type TitleTemperature = (typeof TITLE_TEMPERATURES)[number]

export const STRUCTURE_TYPES = [
  'numbered_list', 'fragmented_stream', 'casual_short_post',
  'practical_question', 'brag_post', 'review_post',
] as const
export type StructureType = (typeof STRUCTURE_TYPES)[number]

export const INTERACTION_NEEDS = [
  'help_request', 'experience_call', 'advice_request', 'brag_share', 'info_share',
] as const
export type InteractionNeed = (typeof INTERACTION_NEEDS)[number]

/** 🔴 살릴지 말지를 낱개로 판단한다. 하나로 뭉치면 "정리해도 되는 글" 이 생긴다 */
export type PreserveStructure = {
  numberedList: boolean
  fragments: boolean
  repetition: boolean
  lineBreaks: boolean
  parentheticals: boolean
  emoticons: boolean
}

export type SourceProfile = {
  emotionTone: EmotionTone
  titleTemperature: TitleTemperature
  structureType: StructureType
  preserveStructure: PreserveStructure
  /** 원문에서 되풀이되는 말. 🔴 반복은 버릇이 아니라 **그 사람이 붙들린 지점**이다 */
  repeatedFixations: readonly string[]
  /** 살려야 하는 구체 디테일 — 갈래별로 나눠 준다 */
  concreteDetailsToKeep: readonly ConcreteDetail[]
  interactionNeed: InteractionNeed
  /** 원문에 있는 외부 커뮤니티 호칭 (있으면 반드시 바꿔야 한다) */
  externalAddressTerms: readonly string[]
  /** 🔴 원문에 있는 출처 흔적 — 서비스·게시판 이름. 최종 글에 남기면 안 된다 */
  originTraceTerms: readonly string[]
  /**
   * 🔴 원문에 URL 이 있는가 (2026-09-01). #10 원문에 1건 있었다.
   *    링크는 출처를 그대로 드러내므로 최종 글에 남으면 안 된다 —
   *    호칭보다 더 확실한 유출이다.
   */
  hasSourceUrl: boolean
}

export type ConcreteDetail = {
  kind: 'time' | 'date' | 'amount' | 'medical' | 'body' | 'family' | 'emoticon' | 'verbal_tic'
    // 🔴 2026-09-01 5판 피드백으로 추가
    | 'situation'   // 어디에 올렸나 · 어디서 봤나 (줌인아웃 · 단톡 등)
    | 'lifestyle'   // 외식 · 첨가물 · 식단 · 체중 변화 맥락
    | 'usage_pattern' // 얼마나 쓰다 끊었나 · 언제만 쓰나 (6판 #18)
  /** 🔴 짧은 조각만. 20자 유출 임계 훨씬 아래다 */
  sample: string
}

// ─────────────────────────────────────────────────────────
// 어휘 — 🔴 여기 모아 둔다. 흩어지면 "왜 이렇게 판정됐나" 를 찾을 수 없다
// ─────────────────────────────────────────────────────────

const TONE_LEXICON: ReadonlyArray<{ tone: EmotionTone; terms: readonly string[] }> = [
  { tone: 'panic', terms: ['어떡', '미치겠', '무서', '겁이', '겁나', '큰일', '응급', '눈물이', '떨려', '떨리', '패닉'] },
  { tone: 'resentment', terms: ['억울', '화가 나', '화나', '짜증', '열받', '분통', '어이없', '속상', '괘씸'] },
  { tone: 'bright_pride', terms: ['뿌듯', '자랑', '기특', '대견', '신나', '행복', '설레', '뭉클'] },
  { tone: 'playful_affection', terms: ['주접', '귀여', '사랑스', '애교', '헤헹', '히히', '깨물', '심쿵'] },
  // 🔴 2026-09-01 보강 — #12(피부) 가 `plain` 으로 떨어졌다.
  //    폼클 3회 · 크림/연고 6회 · 기간 3회 · 체중 2회가 있는데 사전에 한 낱말도 없었다.
  //    "답답해서 묻는 글" 을 담담한 글로 읽으면 담담한 글이 나온다.
  { tone: 'worry', terms: [
    '걱정', '불안', '신경 쓰', '신경쓰', '괜찮을까', '초조', '조마조마',
    '면역', '빠졌', '빠지고', '살이', '체중', '더 심해', '악화', '나아지질', '차도가',
  ] },
  { tone: 'practical_question', terms: [
    '추천', '어디서', '얼마', '어떤 걸', '어떤게', '방법', '후기', '비교', '괜찮은지',
    '써보신', '해보신', '쓰시는', '드셔보신', '바꿔보', '다시 써', '재시도',
    '물세안', '폼클', '클렌징', '크림', '연고', '제품', '제약',
  ] },
  { tone: 'complaint', terms: ['불편', '별로', '실망', '최악', '엉망', '짜증나'] },
]

/** 🔴 외부 커뮤니티 호칭 — 최종 글에 남으면 실패다 */
export const EXTERNAL_ADDRESS_TERMS: readonly string[] = [
  '82님들', '82님', '82쿡님들', '82쿡님', '맘님들', '맘님', '레테님들', '레테님',
  '우갱님들', '우갱님', '은오님들', '은오님', '회원님들', '카페님들',
]

/**
 * 🔴 **출처 흔적** — 최종 글에 남으면 어디서 왔는지가 드러난다 (2026-09-01 6판 #16).
 *
 * 호칭(82님들)과 링크(URL)는 이미 막고 있었는데, **서비스·게시판 이름**이 뚫려 있었다.
 * `줌인아웃에 올렸는데` 한 줄이면 원문을 찾아갈 수 있다 — 호칭보다 더 확실한 단서다.
 *
 * 🔴 좁게 유지한다. `카페` 같은 흔한 말을 넣으면 커피숍 이야기까지 죽는다
 *    (SOURCE_CONTEXT_TERMS 가 그 함정을 이미 겪었다).
 */
export const ORIGIN_TRACE_TERMS: readonly string[] = [
  '줌인아웃', '줌인줌아웃', '82쿡', '82cook', '레몬테라스', '맘스홀릭',
  '맘카페', '네이버 카페', '다음 카페', '자유게시판', '수다게시판', '등업게시판',
]

/** 🔴 이름이 아니라 **행동**으로 출처가 드러나는 자리 */
export const ORIGIN_TRACE_PATTERNS: readonly RegExp[] = [
  /게시판에\s?\S{0,4}\s?(올렸|올려|썼|적었)/,
  /카페에\s?\S{0,4}\s?(올렸|올려|썼|적었)/,
  /(거기|저기|다른 데)에?\s?(도\s?)?(올렸|물어봤|써봤)/,
]

export const originTraceHitsIn = (text: string): string[] => [
  ...ORIGIN_TRACE_TERMS.filter((t) => text.includes(t)),
  ...ORIGIN_TRACE_PATTERNS.map((re) => text.match(re)?.[0]?.trim() ?? '').filter((m) => m !== ''),
]

/** ✅ 우리 호칭 — 치환 결과 */
export const SORANSORAN_ADDRESS: readonly string[] = ['소란님들', '소란소란님들', '소란님']

/**
 * 🔴 원문에 없으면 지어내면 안 되는 것들 (2026-09-01 실측 실패에서 뽑았다).
 *
 * #8 이 정확히 이랬다 — 밝은 도시락 자랑글에 **쓸쓸한 귀가**와 **서먹함**이 생겼다.
 * 모델은 "글맛" 을 위해 정서를 더하는데, 커뮤니티에서 그건 거짓말이다.
 */
export const FORBIDDEN_NEW_FACTS: readonly string[] = [
  '원문에 없는 병·진단',
  '원문에 없는 가족 간 서먹함',
  '원문에 없는 쓸쓸함·외로움',
  '원문에 없는 몸의 이상(손떨림 · 그을린 얼굴 등)',
  '원문에 없는 쓸쓸한 귀가·빈 집',
  '원문에 없는 눈물·회한',
]

/**
 * 🔴 밝은 글에서 **살아야 하는** 말투 (2026-09-01 #11 피드백).
 *
 * #11 은 밝기는 살았는데 "가짜 4050 말투" 가 섞였다 — 점잖게 귀여운 척하는 쪽이다.
 * 실제 커뮤니티의 밝은 자랑글은 이런 말들로 굴러간다.
 *
 * 🔴 **끼워 넣으라는 목록이 아니다.** 억지로 박으면 그것이 더 티가 난다.
 *    "자랑하고 싶어서 못 참는" 흐름이 먼저고, 이 말들은 그 흐름에서 저절로 나온다.
 */
export const BRIGHT_REGISTER_KEEPS: readonly string[] = [
  '수발러', '나야 나', '사서 고생', '헤헹', 'ㅋㅋㅋ',
]

/**
 * 🔴 톤을 옮기지 마라 — 갈래별 금지 (창업자 critique, 2026-09-01).
 *
 * 실패 셋이 전부 "톤 이동" 이었다. 문장 품질 문제가 아니다.
 */
export const BANNED_TONE_SHIFTS: readonly string[] = [
  '불안한 글을 차분한 상담문으로 낮추기',
  '밝은 글을 신파·회한으로 바꾸기',
  '커뮤니티 글을 브런치 수필로 만들기',
  '분통·억울함을 점잖은 아쉬움으로 눌러 쓰기',
  '제목 온도를 원문보다 낮추기',
]

// ─────────────────────────────────────────────────────────
// 규칙
// ─────────────────────────────────────────────────────────

const EMOTICON_RE = /ㅋ{2,}|ㅎ{2,}|ㅠ|ㅜ|\^\^|:\)|헤헹|히히|ㅇㅇ|\p{Extended_Pictographic}/u
const NUMBERED_RE = /^\s*\d+[.)]\s?\S/m
const PARENTHETICAL_RE = /\([^)]{1,30}\)/
/** 🔴 링크는 출처를 그대로 드러낸다. 호칭보다 확실한 유출이다 */
export const SOURCE_URL_RE = /https?:\/\/|www\.[a-z0-9-]+\.[a-z]{2,}|[a-z0-9-]+\.(com|net|co\.kr|kr)\/[^\s]/i

const DETAIL_RULES: ReadonlyArray<{ kind: ConcreteDetail['kind']; re: RegExp }> = [
  { kind: 'time', re: /(새벽|아침|점심|저녁|밤|오전|오후)\s?\d{0,2}시?\s?\d{0,2}분?|\d{1,2}시\s?\d{0,2}분?|\d{1,2}:\d{2}/g },
  // 🔴 `8/24` 같은 월/일 표기를 놓치고 있었다 (5판 #13 피드백)
  { kind: 'date', re: /\d{1,2}\/\d{1,2}|\d{1,2}월\s?\d{0,2}일?|어제|오늘|내일|그저께|지난주|이번 주|한 달째|\d+일째/g },
  // 🔴 `48~49kg` 같은 범위를 먼저 잡는다. 단일 패턴만 두면 앞의 48 만 잡힌다
  { kind: 'amount', re: /\d+\s?[~-]\s?\d+\s?(kg|cm|개월|주|일|만\s?원|원|%)|\d+\s?(년|개월|주일|주|일|번|회|알|정|mg|ml|kg|cm|만\s?원|원|프로|%)/g },
  // 🔴 2026-09-01 보강 — #10 에서 약 이름 · 검사 · 진단어 · 시술이 통째로 사라졌다.
  //    이런 것들이 빠지면 남는 것은 느낌뿐이고, 느낌만 남은 글이 AI 티가 나는 글이다.
  { kind: 'medical', re: /CT|MRI|엑스레이|X-?ray|초음파|내시경|검사|처방|진통제|소염제|근이완제|신경안정제|항생제|스테로이드|약|치과|한의원|정형외과|이비인후과|피부과|물리치료|전기자극|주사|연고|크림|폼클렌징|물세안|제약/g },
  { kind: 'body', re: /턱|어깨|허리|무릎|목덜미|두통|저리|욱신|뻐근|당기|따갑|화끈|간지럽|메스껍|개구장애|기도|하관|입술|트러블|뒤집|올라와|각질|가렵|건조/g },
  { kind: 'family', re: /딸|아들|남편|엄마|아빠|시어머니|시댁|친정|손주|며느리/g },
  { kind: 'emoticon', re: /ㅋ{2,}|ㅎ{2,}|ㅠ{1,}|ㅜ{1,}|\^\^|헤헹|히히|\p{Extended_Pictographic}/gu },
  { kind: 'verbal_tic', re: /진짜|완전|너무너무|아니 근데|암튼|아무튼|하여튼|어휴|에휴|아이참/g },
  // 🔴 5판 #13 — "줌인아웃에 올렸다" 같은 상황감이 현실감의 핵심인데 통째로 빠졌다
  // 🔴 2026-09-01 6판 #16 — `줌인아웃` 이 여기 있어서 "살려라" 로 나갔고 그대로 남았다.
  //    그건 상황감이 아니라 **출처**다. 아래 ORIGIN_TRACE_TERMS 로 옮겨 지우는 쪽에 뒀다.
  //    맘카페 같은 커뮤니티 이름도 같은 이유로 뺀다.
  { kind: 'situation', re: /단톡|카톡|당근|알바|출근|퇴근|병원 예약|진료 예약|사진(을|도)?\s?찍/g },
  // 🔴 5판 #15 — 체중 · 외식 · 첨가물 같은 생활 맥락이 "추가정보" 로 밀려 빠졌다
  { kind: 'lifestyle', re: /외식|첨가물|식단|간식|배달|인스턴트|살이 안|살이 빠|체중|면역력|영양제|물만|끊었/g },
  // 🔴 6판 #18 — "연고를 일주일 바르고 끊었다가 안 좋을 때만" 은 단순 언급이 아니라
  //    **어떻게 쓰고 있는지의 흐름**이다. 이게 빠지면 상황이 아니라 목록이 된다
  { kind: 'usage_pattern', re: /일주일\s?\S{0,3}\s?(바르|쓰|먹)|중단했|끊었다가|가끔\s?(만\s?)?(바르|쓰|먹)|안 좋을 때(만)?|\d+\s?(일|주|개월)\s?(정도\s?)?(바르|쓰|먹|하다)/g },
]

/**
 * 🔴 약 이름은 일반 명사가 아니라 **고유한 제품명**이라 사전으로 못 잡는다.
 *    한국 약 이름이 흔히 갖는 꼬리로 잡는다 — 렉사프로 · 리보트릴 같은 것들이다.
 *    개인을 특정하지 않으므로 지워야 할 대상이 아니라 **살려야 할 증거**다.
 */
//    ⚠️ `\b` 를 쓰지 않는다. JS 의 `\w` 는 ASCII 뿐이라 한글 사이에는 단어 경계가 없다 —
//       붙여 두면 "렉사프로랑" 에서 아무것도 잡지 못한다(5판 실측).
const MEDICINE_NAME_RE = /[가-힣]{2,5}(프로|트릴|캅셀|캡슐|세린|마이신|시럽|타민)/g

/** 프로파일에 실을 상한. 🔴 너무 많으면 지시가 아니라 목록이 된다 */
export const MAX_FIXATIONS = 5
// 🔴 4 로 두었더니 body 에서 턱·기도·개구장애·입술 까지만 잡히고 **하관이 잘렸다**(5판 실측).
//    증거는 뒤쪽에 올수록 구체적인 경우가 많다 — 앞에서 끊으면 정작 중요한 것이 빠진다.
export const MAX_DETAILS_PER_KIND = 6

const hasAny = (text: string, terms: readonly string[]): boolean => terms.some((t) => text.includes(t))

/** 🔴 되풀이되는 말 — 2글자 이상, 3회 이상. 조사·흔한 말은 걸러 낸다 */
const STOPWORDS = new Set([
  '그리고', '그런데', '하지만', '그래서', '이렇게', '그렇게', '저렇게', '너무', '정말',
  '있는', '없는', '하는', '되는', '같은', '많이', '조금', '다시', '아직', '이제', '지금',
])

export function extractFixations(text: string): string[] {
  const counts = new Map<string, number>()
  for (const w of text.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)) {
    const t = w.trim()
    if (t.length < 2 || STOPWORDS.has(t)) continue
    counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_FIXATIONS)
    .map(([w]) => w)
}

export function extractDetails(text: string): ConcreteDetail[] {
  const out: ConcreteDetail[] = []
  // 🔴 약 이름을 먼저 넣는다. 뒤의 medical 규칙이 '약' 한 글자를 먼저 채우면
  //    상한(MAX_DETAILS_PER_KIND)에 밀려 정작 이름이 빠진다
  {
    const seen = new Set<string>()
    for (const m of text.matchAll(MEDICINE_NAME_RE)) {
      const sample = (m[0] ?? '').trim()
      if (sample === '' || seen.has(sample)) continue
      seen.add(sample)
      out.push({ kind: 'medical', sample })
      if (seen.size >= MAX_DETAILS_PER_KIND) break
    }
  }
  for (const rule of DETAIL_RULES) {
    const seen = new Set<string>()
    for (const m of text.matchAll(rule.re)) {
      const sample = (m[0] ?? '').trim()
      if (sample === '' || seen.has(sample)) continue
      seen.add(sample)
      out.push({ kind: rule.kind, sample })
      if (seen.size >= MAX_DETAILS_PER_KIND) break
    }
  }
  return out
}

function readTone(text: string): EmotionTone {
  // 🔴 첫 일치가 아니라 **가장 많이 걸린 갈래**를 고른다.
  //    첫 일치로 정하면 목록 순서가 곧 판정이 되어 버린다.
  let best: { tone: EmotionTone; hits: number } | null = null
  for (const entry of TONE_LEXICON) {
    const hits = entry.terms.filter((t) => text.includes(t)).length
    if (hits === 0) continue
    if (best === null || hits > best.hits) best = { tone: entry.tone, hits }
  }
  return best?.tone ?? 'plain'
}

function readTitleTemperature(title: string, tone: EmotionTone): TitleTemperature {
  const t = title
  if (/ㅠ{2,}|ㅜ{2,}|!{2,}|\?{2,}/.test(t) || hasAny(t, ['어떡', '미치겠', '큰일', '도와'])) return 'overheat'
  if (hasAny(t, ['급해', '응급', '지금', '당장']) || tone === 'panic') return 'urgent'
  if (/ㅋ{2,}|ㅎ{2,}|\^\^/.test(t) || tone === 'bright_pride' || tone === 'playful_affection') return 'playful'
  if (tone === 'worry' || hasAny(t, ['걱정', '불안', '괜찮을까'])) return 'worried'
  return 'calm'
}

function readStructure(title: string, body: string, tone: EmotionTone): StructureType {
  if (NUMBERED_RE.test(body)) return 'numbered_list'
  // 🔴 제품·시술을 바꿔 가며 겪은 경과가 있으면 후기형이다
  if (hasAny(body, ['써보니', '후기', '사용해', '한 달 써', '바꿔 써', '다시 써', '재시도', '써봤', '발라봤'])) return 'review_post'
  const asks = (title + body).includes('?') || hasAny(body, ['있으신가요', '계신가요', '어떤가요', '추천'])
  if (tone === 'practical_question' && asks) return 'practical_question'
  if ((tone === 'bright_pride' || tone === 'playful_affection') && !asks) return 'brag_post'
  const lines = body.split('\n').filter((l) => l.trim() !== '')
  const shortLines = lines.filter((l) => [...l.trim()].length <= 25).length
  // 🔴 짧은 줄이 절반을 넘으면 문단이 아니라 **파편**이다. 산문으로 묶으면 다른 글이 된다
  if (lines.length >= 4 && shortLines / lines.length > 0.5) return 'fragmented_stream'
  return 'casual_short_post'
}

function readInteraction(title: string, body: string, tone: EmotionTone): InteractionNeed {
  const all = `${title}\n${body}`
  if (hasAny(all, ['어떡', '도와주', '도움 좀', '알려주세요', '급해'])) return 'help_request'
  // 🔴 "써보신 분" 류가 빠져 있어 #12 가 info_share 로 떨어졌다
  if (hasAny(all, [
    '계신가요', '계실까', '있으신가요', '저만 그런', '경험 있으신', '겪어보신', '저 같은',
    '써보신', '해보신', '쓰시는 분', '드셔보신', '아시는 분', '겪으신',
  ])) return 'experience_call'
  if (hasAny(all, ['추천', '조언', '어떤 걸', '어떤게', '뭐가 나은'])) return 'advice_request'
  if (tone === 'bright_pride' || tone === 'playful_affection') return 'brag_share'
  return 'info_share'
}

/**
 * 원문을 읽어 프로파일을 만든다.
 *
 * 🔴 제목과 본문을 **따로** 본다. 제목 온도는 제목에서 나온다 —
 *    본문까지 섞으면 밝은 제목이 무거운 본문에 눌려 온도가 내려간다.
 *    실패 #8 이 그 방향이었다.
 */
export function readSourceProfile(input: {
  rawTitle: string
  rawBody: string
}): SourceProfile {
  const title = (input.rawTitle ?? '').trim()
  const body = (input.rawBody ?? '').trim()
  const all = `${title}\n${body}`

  const tone = readTone(all)
  const lines = body.split('\n').filter((l) => l.trim() !== '')

  return {
    emotionTone: tone,
    titleTemperature: readTitleTemperature(title, tone),
    structureType: readStructure(title, body, tone),
    preserveStructure: {
      numberedList: NUMBERED_RE.test(body),
      fragments: lines.length >= 4 && lines.filter((l) => [...l.trim()].length <= 25).length / lines.length > 0.5,
      repetition: extractFixations(body).length > 0,
      lineBreaks: lines.length >= 3,
      parentheticals: PARENTHETICAL_RE.test(body),
      emoticons: EMOTICON_RE.test(all),
    },
    repeatedFixations: extractFixations(body),
    concreteDetailsToKeep: extractDetails(all),
    interactionNeed: readInteraction(title, body, tone),
    externalAddressTerms: EXTERNAL_ADDRESS_TERMS.filter((t) => all.includes(t)),
    originTraceTerms: originTraceHitsIn(all),
    hasSourceUrl: SOURCE_URL_RE.test(all),
  }
}

// ─────────────────────────────────────────────────────────
// 사람 말로 옮기기 — 🔴 모델에게 코드값을 그대로 주지 않는다
// ─────────────────────────────────────────────────────────

const TONE_DIRECTIVE: Record<EmotionTone, string> = {
  // 🔴 5판 #13 피드백 — 다급함을 시켰더니 **감정을 연기**했다.
  //    "손이 떨리고", "입을 벌린 채로 멍하니" 같은 것은 원문에 없던 장면이다.
  //    절박함은 무대 위 표정이 아니라 **현실의 행동과 말**로 드러난다.
  panic: [
    '겁먹고 다급한 글입니다. **차분하게 정리하지 마세요.** 말이 앞서고 두서없어야 맞습니다.',
    '   🔴 다만 **감정을 연기하지 마세요.** 원문에 없는 몸 반응·장면을 만들어 넣으면 실패입니다',
    '   (손이 떨린다 · 입을 벌린 채 멍하니 있었다 · 눈물이 났다 같은 것).',
    '   절박함은 **현실의 행동과 들은 말**로 드러납니다 —',
    '   진료에서 무슨 말을 들었는지, 먹은 약이 어떻게 안 들었는지, 지금 뭘 못 하는지.',
  ].join('\n'),
  resentment: [
    '억울하고 분통이 터진 글입니다. 점잖은 아쉬움으로 눌러 쓰면 다른 글이 됩니다.',
    '   🔴 분통은 형용사가 아니라 **사실**로 씁니다 — 상대가 뭐라고 했는지, 무엇이 달라지지 않았는지.',
  ].join('\n'),
  bright_pride: [
    '밝고 뿌듯한 자랑글입니다. **여기에 쓸쓸함·회한을 얹지 마세요.** 끝까지 밝게 갑니다.',
    '   🔴 **자랑하고 싶어서 못 참는** 흐름이어야 합니다. 점잖게 정리하면 실패입니다.',
    '   🔴 귀여운 척 점잖게 쓰면 실패입니다 — 드라마 대본도 아침방송 리포터도 아닙니다.',
  ].join('\n'),
  playful_affection: [
    '장난스럽고 애정 어린 주접글입니다. 진지해지면 실패입니다.',
    '   🔴 **자랑하고 싶어서 못 참는** 흐름으로 씁니다.',
    '   🔴 귀여운 척 점잖게 쓰면 실패입니다 — 드라마 대본도 아침방송 리포터도 아닙니다.',
  ].join('\n'),
  worry: '걱정이 앞서는 글입니다. 해결된 척 끝내지 마세요.',
  practical_question: [
    '실용적인 궁금증을 묻는 글입니다. 감상으로 흐르지 말고 궁금한 것을 구체적으로 묻습니다.',
    '   🔴 **단정한 질문문으로 시작하지 마세요.** "~해보신 분 계실까요" 로 여는 순간',
    '   답답함이 사라지고 설문지가 됩니다. 무엇이 어떻게 됐는지부터 쏟아냅니다.',
    '   🔴 원문에 **자책이나 억울함**이 있으면 그대로 살립니다 —',
    '   내 손으로 그르친 것 같은 마음은 이런 글의 핵심입니다. (없으면 만들지 않습니다)',
  ].join('\n'),
  complaint: '불편하고 못마땅한 글입니다. 균형 잡힌 총평으로 바꾸지 마세요.',
  plain: '특별한 감정 없이 담담한 글입니다. 억지로 감정을 넣지 마세요.',
}

const TEMP_DIRECTIVE: Record<TitleTemperature, string> = {
  calm: '담담한 제목. 과장하지 않습니다.',
  worried: '걱정이 묻어나는 제목. 안심시키는 제목으로 바꾸지 않습니다.',
  urgent: '급한 제목. **온도를 낮추지 마세요.**',
  overheat: '터져 나온 제목(ㅠㅠ · !! · 어떡해). 🔴 **정제하면 실패입니다.** 그 온도 그대로 씁니다.',
  playful: '장난스러운 제목(ㅋㅋ 등). 점잖게 다듬지 않습니다.',
}

const STRUCTURE_DIRECTIVE: Record<StructureType, string> = {
  // 🔴 2026-09-01 #10 피드백 — "번호를 살려라" 라고 했더니 **AI 브리핑**이 나왔다.
  //    원문의 번호는 보고서 목차가 아니라 멘붕 상태에서 붙잡은 항목들이다.
  //    형식만 살리고 온도를 버리면 살린 것이 아니다.
  numbered_list: [
    '🔴 원문이 **번호로 붙잡아 적은** 글입니다. 산문으로 묶지 마세요.',
    '   다만 **깔끔한 목록으로 정리하는 것도 실패**입니다. 이건 보고서가 아니라',
    '   정신없는 와중에 하나씩 붙잡아 적은 것입니다.',
    '   · 번호는 `1)` `1..` `1-` 처럼 덜 정돈된 모양이어도 됩니다',
    '   · 번호 뒤에 요약 명사만 달지 말고 **말하듯 이어서** 씁니다',
    '   · 번호 사이사이에 감정·사족·괄호·되풀이가 섞여야 합니다',
    '   · 항목 길이가 들쭉날쭉해도 됩니다',
    '   🔴 AI 가 번호 매겨 요약한 브리핑처럼 보이면 실패입니다.',
  ].join('\n'),
  fragmented_stream: '🔴 원문이 **짧게 끊어 쏟아낸** 글입니다. 문단으로 정리하지 말고 끊긴 채로 씁니다.',
  casual_short_post: '가볍게 쓴 짧은 글입니다. 격식을 갖추지 않습니다.',
  practical_question: '묻는 글입니다. 궁금한 것을 흐리지 말고 그대로 묻습니다.',
  brag_post: '자랑하는 글입니다. 겸양으로 덮지 않습니다.',
  review_post: '써 보고 남기는 글입니다. 기간·수치·느낌을 살립니다.',
}

const INTERACTION_DIRECTIVE: Record<InteractionNeed, string> = {
  help_request: '도움을 구하는 글입니다. 🔴 **부르는 말을 반드시 남깁니다** — "소란님들 저 진짜 어떡하죠", "저 같은 분 계세요ㅠ" 같은 호출입니다.',
  experience_call: '겪어 본 사람을 찾는 글입니다. 🔴 "혹시 저만 그런가요", "겪어보신 소란님들 계실까요" 처럼 **사람을 부릅니다.**',
  advice_request: '조언을 구하는 글입니다. 무엇이 궁금한지 구체적으로 적고 물어봅니다.',
  brag_share: '자랑을 나누는 글입니다. "소란님들 주말 잘 보내세요" 처럼 가볍게 건넵니다.',
  info_share: '알게 된 것을 나누는 글입니다. 가르치는 말투가 되지 않게 합니다.',
}

/**
 * 🔴 **제목 지시** (2026-09-01 6판 피드백).
 *
 * 6판까지 제목이 계속 약했다. 원인은 지시가 길이 상한 하나뿐이었다는 것이다 —
 * "40자 이내" 는 무엇을 쓰라는 말이 아니라 얼마나 쓰라는 말이고,
 * 모델은 그 빈자리를 **조용한 요약 제목**으로 채운다.
 *
 * 🔴 온도(titleTemperature)와 목적(interactionNeed)을 곱해서 지시한다.
 *    커뮤니티 목록에서 클릭되는 제목이어야 하되 **낚시·거짓 과장은 금지**다.
 */
const TITLE_BY_NEED: Record<InteractionNeed, string[]> = {
  help_request: [
    '   · 절박한 호출이 들어가도 됩니다 — "저 어떡하죠" · "망한 것 같아요" · "제발" 류',
    '   · 무슨 일이 났는지가 제목에서 보여야 합니다. 증상·상황을 감추지 마세요',
  ],
  experience_call: [
    '   · 기간·증상·질문이 제목에서 보여야 합니다 — "3개월 차" · "다 뒤집어짐" · "영향 있을까요?" 류',
    '   · 겪어 본 사람을 부르는 말이 들어가도 됩니다',
  ],
  advice_request: [
    '   · 무엇을 고민 중인지가 제목에서 보여야 합니다. "조언 구합니다" 같은 껍데기 말고 내용이 보이게',
  ],
  brag_share: [
    '   · 주접 제목이 됩니다 — "수발러 나야 나" · "사서 고생" · "ㅋㅋㅋ" · 이모티콘',
    '   · 자랑인 게 제목에서 드러나야 합니다. 점잖게 줄이지 마세요',
  ],
  info_share: [
    '   · 무엇에 대한 이야기인지가 보이게 씁니다. 감상 제목은 피합니다',
  ],
}

export function titleDirectives(p: SourceProfile): string[] {
  return [
    '## 🔴 제목',
    `- ${TEMP_DIRECTIVE[p.titleTemperature]}`,
    ...TITLE_BY_NEED[p.interactionNeed],
    '🔴 **조용한 요약 제목은 실패입니다.** "~에 대하여" · "~후기" · "~생각" 같은 것.',
    '🔴 커뮤니티 목록에서 **눌러 보고 싶은 제목**이어야 합니다.',
    '   다만 낚시·거짓 과장은 금지입니다 — 글에 없는 일을 제목에 넣지 않습니다.',
    '🔴 원문 제목을 그대로 쓰지 않습니다. 온도만 가져옵니다.',
  ]
}

const KIND_LABEL: Record<ConcreteDetail['kind'], string> = {
  time: '시간', date: '날짜', amount: '수치·기간', medical: '약·검사·진료',
  body: '몸의 느낌', family: '가족', emoticon: '이모티콘·자모', verbal_tic: '말버릇',
  situation: '상황(어디서·무엇을 하다가)', lifestyle: '생활 맥락(식단·체중 등)',
  usage_pattern: '어떻게 쓰고 있나(기간·중단·가끔)',
}

/**
 * 🔴 **빠지면 실패인 디테일** (2026-09-01 5판 피드백).
 *
 * 4·5판이 "살리라" 는 지시를 받고도 약 이름 · 날짜 · 검사 결과 · 체중을 흘렸다.
 * "지우지 마세요" 는 약한 말이다 — 모델은 글이 길어지면 알아서 정리한다.
 * **빠지면 실패**로 등급을 올린다.
 *
 * 🔴 감정·말버릇 계열(emoticon · verbal_tic · family)은 여기 넣지 않는다.
 *    그쪽은 있으면 좋은 것이고, 이쪽은 **없으면 글이 거짓이 되는 것**이다.
 *    둘을 같은 등급으로 두면 "실패" 라는 말이 닳는다.
 */
export const MUST_KEEP_KINDS: ReadonlyArray<ConcreteDetail['kind']> = [
  'medical', 'amount', 'date', 'time', 'situation', 'lifestyle', 'body', 'usage_pattern',
]

/**
 * 프롬프트에 실을 필수 디테일 상한. 너무 많으면 지시가 아니라 목록이 된다.
 *
 * 🔴 18 → 26 (2026-09-01 6판). 필수 종류가 8개가 되면서 라운드로빈이 3바퀴도 못 돌아
 *    각 종류의 **뒤쪽 항목이 통째로 잘렸다** — 실측에서 `제약사 크림`·`연고`·
 *    `안 좋을 때만` 이 그렇게 빠졌다. 종류가 늘면 상한도 같이 올라가야 한다.
 */
export const MAX_MUST_KEEP = 26

/**
 * 🔴 **종류별로 돌아가며 담는다.**
 *
 * 앞에서부터 자르면 앞 종류가 상한을 다 먹고 **뒤 종류가 통째로 사라진다** —
 * 5판 실측에서 amount·medical·body 만으로 12칸이 차서 lifestyle(면역력 · 외식)이
 * 하나도 실리지 않았다. 종류가 빠지면 그 종류의 증거는 글에서 전부 사라진다.
 */
export function mustKeepDetails(details: readonly ConcreteDetail[]): ConcreteDetail[] {
  const byKind = new Map<ConcreteDetail['kind'], ConcreteDetail[]>()
  for (const d of details) {
    if (!MUST_KEEP_KINDS.includes(d.kind)) continue
    byKind.set(d.kind, [...(byKind.get(d.kind) ?? []), d])
  }
  const out: ConcreteDetail[] = []
  // 🔴 MUST_KEEP_KINDS 순서를 고정 축으로 쓴다 — 결정적이어야 재현된다
  for (let round = 0; out.length < MAX_MUST_KEEP; round += 1) {
    let added = false
    for (const kind of MUST_KEEP_KINDS) {
      const item = byKind.get(kind)?.[round]
      if (item === undefined) continue
      out.push(item)
      added = true
      if (out.length >= MAX_MUST_KEEP) break
    }
    if (!added) break
  }
  return out
}

/**
 * 프로파일을 프롬프트에 실을 문장으로 바꾼다.
 *
 * 🔴 코드값(`panic` 같은 것)을 그대로 내보내지 않는다. 모델이 그것을 라벨로 읽고
 *    "패닉한 글쓰기" 라는 장르를 연기하기 시작한다 — 우리가 원하는 건 연기가 아니라
 *    **그 글이 원래 갖고 있던 온도를 지우지 않는 것**이다.
 */
export function profileDirectives(p: SourceProfile): string[] {
  const details = new Map<ConcreteDetail['kind'], string[]>()
  for (const d of p.concreteDetailsToKeep) {
    details.set(d.kind, [...(details.get(d.kind) ?? []), d.sample])
  }

  const must = mustKeepDetails(p.concreteDetailsToKeep)
  const mustByKind = new Map<ConcreteDetail['kind'], string[]>()
  for (const d of must) mustByKind.set(d.kind, [...(mustByKind.get(d.kind) ?? []), d.sample])

  const keep: string[] = []
  if (p.preserveStructure.numberedList) keep.push('번호 나열')
  if (p.preserveStructure.fragments) keep.push('짧게 끊긴 줄')
  if (p.preserveStructure.repetition) keep.push('같은 말 되풀이')
  if (p.preserveStructure.lineBreaks) keep.push('줄바꿈')
  if (p.preserveStructure.parentheticals) keep.push('괄호 사족(`사정상(?)` 같은 얼버무림)')
  if (p.preserveStructure.emoticons) keep.push('이모티콘·ㅋㅋ·ㅠㅠ')

  return [
    '## 🔴 이 글이 어떤 글인지 (가장 먼저 지킬 것)',
    `- ${TONE_DIRECTIVE[p.emotionTone]}`,
    `- 제목: ${TEMP_DIRECTIVE[p.titleTemperature]}`,
    `- ${STRUCTURE_DIRECTIVE[p.structureType]}`,
    `- ${INTERACTION_DIRECTIVE[p.interactionNeed]}`,
    '',
    ...(keep.length > 0
      ? ['🔴 **이 모양을 살립니다**: ' + keep.join(' · '),
         '   깔끔하게 정리하는 순간 커뮤니티 글이 아니라 기사문이 됩니다.']
      : []),
    ...(p.repeatedFixations.length > 0
      ? [`🔴 원문이 되풀이한 말: ${p.repeatedFixations.join(' · ')}`,
         '   되풀이는 버릇이 아니라 **그 사람이 붙들린 지점**입니다. 한 번으로 줄이지 마세요.']
      : []),
    ...(details.size > 0
      ? ['🔴 **이런 종류의 구체적인 것을 지우지 않습니다** (그대로 베끼라는 뜻이 아니라, 내 경우의 같은 종류를 씁니다):',
         ...[...details.entries()].map(([k, v]) => `   · ${KIND_LABEL[k]} — ${v.slice(0, 3).join(' · ')}`),
         '   이런 것들이 빠지면 남는 것은 느낌뿐이고, 느낌만 남은 글이 AI 티가 나는 글입니다.']
      : []),
    // 🔴 등급을 올린다. "지우지 마세요" 로는 모델이 글을 다듬으며 흘려 버린다
    ...(must.length > 0
      ? ['',
         '🔴 **아래 종류는 빠지면 실패입니다.** 하나라도 없으면 그 글은 버립니다:',
         ...[...mustByKind.entries()].map(([k, v]) => `   · ${KIND_LABEL[k]} — ${v.slice(0, 4).join(' · ')}`),
         '   글을 다 쓴 뒤 이것들이 남아 있는지 확인하고, 빠졌으면 넣어서 다시 씁니다.',
         '   🔴 숫자를 그대로 베끼라는 뜻이 아닙니다 — **내 경우의 같은 종류를 그만큼 구체적으로** 씁니다.']
      : []),
    '',
    ...(p.emotionTone === 'bright_pride' || p.emotionTone === 'playful_affection'
      ? ['🔴 밝은 글에서는 이런 말이 저절로 나옵니다: ' + BRIGHT_REGISTER_KEEPS.join(' · '),
         '   🔴 다만 **끼워 넣지 마세요.** 억지로 박으면 그게 더 티가 납니다 —',
         '   자랑하고 싶어서 못 참는 흐름이 먼저고, 이 말들은 거기서 저절로 나옵니다.',
         // 🔴 5판 #14 — ㅋㅋㅋ 가 문장 끝마다 하나씩 균등하게 박혔다. 그건 사람이 아니라 규칙이다
         '   🔴 `ㅋㅋㅋ` 와 이모티콘을 **문장 끝마다 고르게 하나씩** 달지 마세요.',
         '   몰릴 때는 몰리고 없을 때는 아예 없습니다 — 감정이 올라오는 자리에 몰립니다.',
         '   `❤️` 같은 것은 마무리 장식이 아니라 **가장 기쁜 대목**에 붙습니다.',
         // 🔴 6판 #17 — 마무리가 정돈된 인사문이면 힘이 빠진다
         '   🔴 마무리를 **정돈된 인사문**으로 맺지 마세요. 감정이 올라온 뒤',
         '   그 김에 인사로 흘러가는 것이지, 인사를 하려고 감정을 정리하는 게 아닙니다.',
         '']
      : []),
    '🔴 **원문에 없는 것을 지어내지 않습니다**:',
    ...FORBIDDEN_NEW_FACTS.map((f) => `   · ${f}`),
    '',
    '🔴 **톤을 옮기지 않습니다**:',
    ...BANNED_TONE_SHIFTS.map((b) => `   · ${b}`),
    ...(p.originTraceTerms.length > 0
      ? ['',
         `🔴 원문에 출처가 드러나는 말이 있습니다: ${p.originTraceTerms.join(' · ')}`,
         '   **서비스 이름 · 게시판 이름 · "어디에 올렸다" 는 최종 글에 남기지 않습니다.**',
         '   그 한 줄이면 원문을 찾아갈 수 있습니다.',
         '   🔴 다만 그 **상황감까지 버리지는 마세요.** 출처가 아니라 행동으로 바꿔 씁니다 —',
         '   예: "사진도 찍어봤어요" · "비교해 보려고 얼굴 상태도 따로 남겨뒀어요"']
      : []),
    ...(p.hasSourceUrl
      ? ['',
         '🔴 원문에 링크(URL)가 있습니다. **최종 글에 주소를 옮기지 않습니다.**',
         '   링크는 출처를 그대로 드러냅니다. 필요하면 "어디서 봤는데" 없이 내용만 내 말로 씁니다.']
      : []),
    ...(p.externalAddressTerms.length > 0
      ? ['',
         `🔴 원문에 다른 커뮤니티 호칭이 있습니다: ${p.externalAddressTerms.join(' · ')}`,
         `   이 말을 그대로 쓰면 안 됩니다. 우리는 ${SORANSORAN_ADDRESS.join(' · ')} 라고 부릅니다.`,
         '   🔴 낱말만 바꾸지 말고 **부르는 문장 전체를 이 글의 목적에 맞게 다시 씁니다.**']
      : []),
  ]
}
