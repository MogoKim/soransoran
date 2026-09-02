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
  'worry', 'practical_question', 'complaint',
  // 🔴 2026-09-02 8판 #26 — 분통(resentment)과 다른 온도다.
  //    화가 나서 터지는 게 아니라 **가슴이 차갑게 식는** 쪽이다.
  //    이 둘을 한 칸에 두면 서운한 글이 화난 글로 나온다
  'letdown',
  'plain',
] as const
export type EmotionTone = (typeof EMOTION_TONES)[number]

export const TITLE_TEMPERATURES = ['calm', 'worried', 'urgent', 'overheat', 'playful'] as const
export type TitleTemperature = (typeof TITLE_TEMPERATURES)[number]

/**
 * 🔴 **제목의 모양** (2026-09-02 11판 #38 · #39).
 *
 * 온도(어떤 감정인가)와 목적(무엇을 원하는가)만으로는 제목이 서지 않았다.
 * #38 과 #39 는 둘 다 `info_share` 였고, 그 갈래의 지시는 한 줄뿐이라
 * **둘 다 단정한 요약 제목**으로 나왔다. 재료가 전혀 다른데 제목 모양이 같았다.
 *
 * 온도·목적 위에 **소재**를 하나 더 본다. 같은 letdown 이라도
 * 자식 성적 이야기는 "사건 + 들킨 경로 + 엄마 감정" 으로 서고,
 * 아기 영상 이야기는 주접으로 선다. 제목 모양은 소재가 정한다.
 */
export const TITLE_SHAPES = ['incident_reveal_emotion', 'fond_gush', 'plain_subject'] as const
export type TitleShape = (typeof TITLE_SHAPES)[number]

export const STRUCTURE_TYPES = [
  'numbered_list', 'fragmented_stream', 'casual_short_post',
  'practical_question', 'brag_post', 'review_post',
] as const
export type StructureType = (typeof STRUCTURE_TYPES)[number]

export const INTERACTION_NEEDS = [
  'help_request', 'experience_call', 'advice_request', 'brag_share', 'info_share',
] as const
export type InteractionNeed = (typeof INTERACTION_NEEDS)[number]

/**
 * 🔴 **글을 어떻게 닫는가** (2026-09-02, 9판 피드백).
 *
 * 9판에서 우리 호칭이 5/5 가 됐는데 그게 성공이 아니었다 —
 * *"소란님들 그래서 말인데요, 다들 어떻게 버티세요?"* 같은 **공식 CTA** 가
 * 원문에 없는데 끝에 붙었다. 호칭을 기계 지표로 삼은 대가다.
 *
 * 🔴 호칭은 **성공 지표가 아니라 조건부 치환 규칙**이다.
 *    원문이 실제로 묻거나 부를 때만 우리 호칭으로 바꾼다.
 *    원문이 혼잣말로 끝나면 우리 글도 혼잣말로 끝난다.
 *
 * 🔴 interactionNeed 와 **다른 축**이다. "무엇을 원하는 글인가"(need)와
 *    "실제로 부르며 끝나는가"(closing)는 다르다 — 도움을 구하는 글도
 *    마지막은 한숨으로 끝날 수 있다.
 */
export const CLOSING_INTENTS = [
  'explicit_question',   // 실제로 물음표로 묻는다
  'advice_request',      // 조언·추천을 청한다
  'experience_call',     // 겪어본 사람을 찾는다
  'vent_to_audience',    // 묻지는 않지만 들어달라고 편다
  'no_call',             // 🔴 아무도 부르지 않는다. 여기에 CTA 를 붙이면 실패다
] as const
export type ClosingIntent = (typeof CLOSING_INTENTS)[number]

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
  /** 🔴 원문이 어떻게 닫히는가. 여기가 `no_call` 이면 끝에 아무것도 붙이지 않는다 */
  closingIntent: ClosingIntent
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
  /** 🔴 원문 안의 **출처 링크**. 한 건이라도 최종 글에 나가면 실패다 */
  originTraceUrls: readonly string[]
  /**
   * ✅ 원문 안의 **소재 링크 정본** (유튜브만 · 추적 파라미터 제거됨).
   *    null 이면 링크는 어떤 것도 못 나간다.
   */
  contentReferenceUrl: string | null
  /** 🔴 제목을 어떤 모양으로 세울 것인가 */
  titleShape: TitleShape
}

export type ConcreteDetail = {
  kind: 'time' | 'date' | 'amount' | 'medical' | 'body' | 'family' | 'emoticon' | 'verbal_tic'
    // 🔴 2026-09-01 5판 피드백으로 추가
    | 'situation'   // 어디에 올렸나 · 어디서 봤나 (줌인아웃 · 단톡 등)
    | 'lifestyle'   // 외식 · 첨가물 · 식단 · 체중 변화 맥락
    | 'usage_pattern' // 얼마나 쓰다 끊었나 · 언제만 쓰나 (6판 #18)
    | 'grievance'     // 서운함·치사함·차별·손절 (8판 #24 · #26)
    | 'tradeoff'      // 현실 계산 — 차라리 · 가성비 · 때려치 (8판 #26)
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
  // 🔴 8판 #26 — `plain` 으로 떨어졌다. 현타 · 가성비 · 치사함 신호가 있었는데
  //    사전에 한 낱말도 없었다. 담담한 글로 읽으면 담담한 글이 나온다
  { tone: 'letdown', terms: [
    '서운', '섭섭', '치사', '얍삽', '째째', '쪼잔', '비겁', '허탈', '씁쓸', '찬물',
    '현타', '허무', '자괴', '차별', '유독 나만', '나만 빼고', '알고 보니', '알게 됐',
  ] },
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

// ── 🔴 링크 두 갈래 (2026-09-02 11판 #39) ────────────────────────────
//
// 지금까지 URL 은 전면 금지였다. 그 규칙이 옳았던 이유는 링크가 **출처**였기 때문이다 —
// 82cook 게시글 주소 한 줄이면 원문을 찾아갈 수 있다.
//
// 그런데 #39 는 달랐다. 원문 안의 유튜브 링크가 **글의 소재 그 자체**였다.
// "이 영상 보세요" 가 글의 전부인데 링크를 지우면 무슨 영상인지 알 수 없는 글이 된다.
// 출처를 감추려다 소재를 지운 것이다.
//
// 🔴 그래서 **출처 링크**와 **소재 링크**를 가른다. 전면 금지를 푸는 게 아니라
//    금지의 대상을 정확히 하는 것이다. 출처 링크는 여전히 한 건도 못 나간다.

/** 🔴 출처가 드러나는 호스트. 여기 걸리면 소재든 뭐든 못 나간다 */
export const ORIGIN_URL_HOST_RE =
  /(^|\.)(82cook\.com|cafe\.naver\.com|cafe\.daum\.net|blog\.naver\.com|m\.blog\.naver\.com|instagram\.com|tistory\.com|brunch\.co\.kr|band\.us|dcinside\.com|fmkorea\.com|theqoo\.net|ppomppu\.co\.kr)$/i

/** 🔴 게시판 읽기 경로 — 호스트가 안 걸려도 이 경로면 원문 글이다 */
export const ORIGIN_URL_PATH_RE = /\/(read|view|article|bbs|board)\b|read\.php|\/entiz\//i

/** ✅ 소재로 허용할 수 있는 호스트 — 🔴 유튜브뿐이다. 늘리지 않는다 */
export const CONTENT_URL_HOSTS: readonly string[] = [
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be',
]

/**
 * 🔴 추적·식별 파라미터. 하나라도 있으면 **그대로는** 못 쓴다.
 *    `si` 는 유튜브 공유 버튼이 붙이는 값이라 누가 공유했는지가 따라간다.
 */
export const TRACKING_PARAM_RE = /^(si|utm_|fbclid|gclid|igshid|ref|ref_src|feature|pp|ab_channel)/i

/** 유튜브 영상 id — 11자 고정 */
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/

/**
 * 텍스트에서 URL 을 있는 그대로 뽑는다.
 *
 * 🔴 `https://` 가 붙은 것만 찾으면 안 된다. 사람은 `cafe.naver.com/abc` 처럼
 *    스킴 없이 쓴다 — 기존 SOURCE_URL_RE 가 그걸 잡고 있었고, 여기서 놓치면
 *    **가드가 좁아진 것**이다. 알려진 TLD 로 끝나는 도메인도 URL 로 본다.
 */
const URL_TLD = '(?:com|net|org|co\\.kr|kr|be|tv|io|me|gg)'
const URL_TAIL = '[^\\s<>"\')\\]]*'
export const findUrls = (text: string): string[] =>
  [...(text ?? '').matchAll(new RegExp(
    `https?://${URL_TAIL}|[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.${URL_TLD}\\b${URL_TAIL}`, 'gi'))]
    .map((m) => m[0].replace(/[.,)\]}>]+$/, ''))

const parseUrl = (raw: string): URL | null => {
  try { return new URL(raw.startsWith('http') ? raw : `https://${raw}`) } catch { return null }
}

/** 🔴 출처 링크인가 — 호스트든 경로든 하나만 걸려도 출처다 */
export function isOriginUrl(raw: string): boolean {
  const u = parseUrl(raw)
  if (u === null) return true // 🔴 못 읽으면 출처로 본다. 모르는 것은 막는 쪽이다
  return ORIGIN_URL_HOST_RE.test(u.host) || ORIGIN_URL_PATH_RE.test(u.pathname)
}

/**
 * 🔴 소재 링크를 **정본 형태로 되돌린다.** 쓸 수 없으면 null.
 *
 * 창업자 규칙은 "단축 URL · 추적 파라미터 · 개인 식별 링크 금지" 다.
 * #39 의 실제 링크는 `youtu.be/…?si=…` 로 **둘 다 걸린다.**
 * 그렇다고 통째로 막으면 소재가 사라진다 — 그래서 **버리지 않고 씻는다**:
 *   youtu.be 단축 → youtube.com/watch 정본 · `si` 등 추적 파라미터 제거.
 * 남는 것은 영상 id 하나뿐이라 누가 공유했는지는 따라오지 않는다.
 *
 * 🔴 씻어서 안 되는 것은 null 로 돌려보낸다. 억지로 살리지 않는다.
 */
export function canonicalContentUrl(raw: string): string | null {
  const u = parseUrl(raw)
  if (u === null) return null
  const host = u.host.toLowerCase()
  if (!CONTENT_URL_HOSTS.includes(host)) return null
  if (isOriginUrl(raw)) return null

  const id = host === 'youtu.be'
    ? u.pathname.replace(/^\//, '').split('/')[0] ?? ''
    : u.pathname.startsWith('/shorts/')
      ? u.pathname.slice('/shorts/'.length).split('/')[0] ?? ''
      : u.searchParams.get('v') ?? ''
  if (!YOUTUBE_ID_RE.test(id)) return null

  // 🔴 남은 파라미터에 추적 값이 있어도 **버리고** 정본만 만든다. 옮겨 담지 않는다
  return `https://www.youtube.com/watch?v=${id}`
}

/**
 * 원문 안의 **못 옮기는 링크** (있으면 최종 글에 한 건도 못 나간다).
 *
 * 🔴 "알려진 출처 호스트" 만 세지 않는다. 모르는 도메인도 여기 들어온다 —
 *    소재로 쓸 수 있는 것은 정본화에 성공한 유튜브 하나뿐이고, **나머지는 전부 막는다.**
 *    계측(originUrlHits)과 같은 원칙이다. 눈금이 갈라지면 한쪽만 새어 나간다.
 */
export const originUrlsIn = (text: string): string[] =>
  findUrls(text).filter((u) => isOriginUrl(u) || canonicalContentUrl(u) === null)

/**
 * 원문 안의 **소재 링크 정본**. 🔴 하나만 고른다 —
 * 여러 개면 무엇이 소재인지 규칙으로 정할 수 없다. 그때는 아무것도 허용하지 않는다.
 */
export function contentUrlIn(text: string): string | null {
  const ok = [...new Set(findUrls(text).map((u) => canonicalContentUrl(u)).filter((u): u is string => u !== null))]
  return ok.length === 1 ? ok[0]! : null
}

const DETAIL_RULES: ReadonlyArray<{ kind: ConcreteDetail['kind']; re: RegExp }> = [
  { kind: 'time', re: /(새벽|아침|점심|저녁|밤|오전|오후)\s?\d{0,2}시?\s?\d{0,2}분?|\d{1,2}시\s?\d{0,2}분?|\d{1,2}:\d{2}/g },
  // 🔴 `8/24` 같은 월/일 표기를 놓치고 있었다 (5판 #13 피드백)
  { kind: 'date', re: /\d{1,2}\/\d{1,2}|\d{1,2}월\s?\d{0,2}일?|어제|오늘|내일|그저께|지난주|이번 주|한 달째|\d+일째/g },
  // 🔴 `48~49kg` 같은 범위를 먼저 잡는다. 단일 패턴만 두면 앞의 48 만 잡힌다
  // 🔴 2026-09-02 8판 — `억` · `천만` 이 빠져 있어 **양육비 1억**(#24) 과
  //    #26 의 억 단위가 필수 목록에서 통째로 누락됐다. 큰 금액일수록 글의 중심인데
  //    작은 단위(만 원)만 잡고 있었다. 큰 것을 먼저 본다
  { kind: 'amount', re: /\d+\s?억\s?\d*\s?(천만)?|\d+\s?천만|\d+\s?[~-]\s?\d+\s?(kg|cm|개월|주|일|만\s?원|원|%)|\d+\s?(년|개월|주일|주|일|번|회|알|정|mg|ml|kg|cm|만\s?원|원|프로|%)/g },
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
  // 🔴 8판 #24·#26 — 서운함과 치사함이 글의 중심인데 어디에도 잡히지 않았다.
  //    감정 형용사가 아니라 **무엇이 서운했는지의 사실**이라 지우면 글이 밋밋해진다
  { kind: 'grievance', re: /서운|섭섭|치사|얍삽|째째|쪼잔|비겁|차별|손절|연락 끊|의절|양육비|위자료|밀린|미지급|실망|상처|배신/g },
  // 🔴 8판 #26 — "차라리 배달이 낫겠다" 는 푸념이자 **현실 계산**이다.
  //    이게 빠지면 고민이 아니라 감상문이 된다
  { kind: 'tradeoff', re: /가성비|시간 대비|차라리|때려치|그만두|버는 게|나을 것|나을까|현타|허무|자괴|투잡|부업/g },
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

/**
 * 🔴 **끝부분만 본다.** 글 전체에 물음표가 하나 있다고 묻는 글로 끝나는 것은 아니다.
 *    중간에 "왜 그럴까요" 하고 지나간 뒤 한숨으로 닫는 글이 훨씬 많다.
 */
export const CLOSING_TAIL_LINES = 3

export function readClosingIntent(input: {
  title: string
  body: string
  tone: EmotionTone
}): ClosingIntent {
  const lines = input.body.split('\n').map((l) => l.trim()).filter((l) => l !== '')
  const tail = lines.slice(-CLOSING_TAIL_LINES).join('\n')
  if (tail === '') return 'no_call'

  // 🔴 순서가 곧 우선순위다. 구체적인 것부터 본다
  if (hasAny(tail, ['계신가요', '계실까', '있으신가요', '겪어보신', '써보신', '해보신',
                    '저만 그런', '저 같은', '아시는 분', '경험 있으신'])) return 'experience_call'
  if (hasAny(tail, ['추천', '조언', '알려주세요', '어떻게 해야', '어떤 걸', '어떤게',
                    '뭐가 나은', '도와주세요'])) return 'advice_request'
  // 물음표는 **끝부분에 있을 때만** 센다.
  // 🔴 어미는 낱말 목록이 아니라 규칙으로 본다 — `건가요`·`런가요`처럼 앞말이 붙으면
  //    목록 방식은 놓친다(9판 실측). 한글 뒤에 오는 의문 어미를 통째로 잡는다
  if (/[?？]/.test(tail) || /[가-힣](가요|나요|까요|런지요|는지요|ㄹ까)/.test(tail)) {
    return 'explicit_question'
  }
  // 🔴 묻지는 않지만 듣는 사람을 향해 펴는 글 — 하소연·서운함 계열에서만
  if ((input.tone === 'complaint' || input.tone === 'resentment' || input.tone === 'letdown'
       || input.tone === 'panic')
      && hasAny(tail, ['하소연', '넋두리', '답답', '속상', '털어놓', '그냥 써', '적어봤',
                       '읽어주', '들어주'])) return 'vent_to_audience'
  // 🔴 나머지는 부르지 않는다. 여기에 호칭이나 질문을 붙이면 그것이 AI 티다
  return 'no_call'
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
    closingIntent: readClosingIntent({ title, body, tone }),
    externalAddressTerms: EXTERNAL_ADDRESS_TERMS.filter((t) => all.includes(t)),
    originTraceTerms: originTraceHitsIn(all),
    hasSourceUrl: SOURCE_URL_RE.test(all),
    originTraceUrls: originUrlsIn(all),
    contentReferenceUrl: contentUrlIn(all),
    titleShape: readTitleShape(title, body, tone),
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
  // 🔴 8판 #24 피드백 — 양육비·손절 글이 점잖은 설명문이 됐다
  complaint: [
    '불편하고 못마땅한 글입니다. 균형 잡힌 총평으로 바꾸지 마세요.',
    '   🔴 **점잖게 설명하지 마세요.** 속에서 올라오는 하소연입니다 —',
    '   어이없고 화가 나고 억울한 것이 문장에 그대로 묻어나야 합니다.',
    '   🔴 밀린 것 · 받지 못한 것의 **액수와 기간을 흐리지 않습니다.** 그게 이 글의 뼈대입니다.',
  ].join('\n'),
  // 🔴 8판 #26 피드백 — 화가 난 것과 **가슴이 식는 것**은 다르다
  letdown: [
    '서운하고 김이 새는 글입니다. **화내는 글로 쓰지 마세요** — 터지는 게 아니라 식는 쪽입니다.',
    '   🔴 무엇이 서운했는지를 **사실로** 씁니다 — 누가 무엇을 어떻게 했고 나만 어떻게 됐는지.',
    '   🔴 "내가 여기서 이러고 있을 일인가" 같은 **현타**가 있으면 그대로 둡니다.',
    '   🔴 원문에 **현실 계산**(차라리 이게 낫겠다 · 시간 대비 · 그만둘까)이 있으면 살립니다.',
    '   푸념과 자책이 섞여도 됩니다. 정리된 결론으로 끝내지 마세요.',
  ].join('\n'),
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
  // 🔴 "반드시" 를 뺐다 (2026-09-02 9판). 무엇을 원하는 글인가와
  //    실제로 부르며 끝나는가는 다른 축이다 — 부를지는 CLOSING_DIRECTIVE 가 정한다
  help_request: '도움을 구하는 글입니다. 다급함이 문장에 남아야 합니다.',
  experience_call: '겪어 본 사람을 찾는 글입니다. 무엇을 겪었는지 구체적으로 적습니다.',
  advice_request: '조언을 구하는 글입니다. 무엇이 궁금한지 구체적으로 적고 물어봅니다.',
  brag_share: '자랑을 나누는 글입니다. "소란님들 주말 잘 보내세요" 처럼 가볍게 건넵니다.',
  // 🔴 2026-09-02 9판 — 여기 있던 "부르는 말이 한 번은 나옵니다" 를 **제거했다.**
  //    그 한 줄이 *"소란님들 그래서 말인데요, 다들 어떻게 버티세요?"* 라는
  //    공식 CTA 를 만들었다. 원문에 없는 질문을 끝에 붙이는 것이 곧 AI 티다.
  //    부르는지 말지는 아래 CLOSING_DIRECTIVE 가 원문을 보고 정한다.
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

/** 자식·학교·성적 계열 — 🔴 좁게 유지한다. `애` 한 글자로는 잡지 않는다 */
const CHILD_SCHOOL_TERMS: readonly string[] = [
  '고3', '고등', '중3', '중학', '수능', '모의고사', '성적표', '성적', '내신', '등급',
  '담임', '수시', '정시', '원서', '학원', '과외', '입시', '재수', '학교',
]
/** 들킨 경로 — 이게 있으면 사건이 "어떻게 알려졌는가" 가 이야기의 축이다 */
const REVEAL_PATH_TERMS: readonly string[] = [
  '전화', '문자', '연락', '알았', '들켰', '들통', '밝혀', '확인해 보니', '알게 됐',
  '속였', '속여', '거짓말', '숨겼', '숨겨',
]
/** 아기·영상·귀여움 계열 — 랜선으로 흐뭇하게 보는 글 */
const FOND_WATCH_TERMS: readonly string[] = [
  '아기', '애기', '아가', 'baby', '영상', '유튜브', '채널', '브이로그', '릴스',
  '귀여', '깜찍', '사랑스', '앙증', '조카', '손주', '손녀', '손자',
]

/**
 * 🔴 제목 모양을 읽는다. 온도·목적과 **따로** 본다.
 *
 * 순서가 규칙이다 — 사건형을 먼저 본다. 자식 성적 이야기에 "귀엽다" 가 한 번
 * 나온다고 주접 제목이 되면 안 된다. 무거운 쪽이 이긴다.
 */
export function readTitleShape(title: string, body: string, tone: EmotionTone): TitleShape {
  const all = `${title}\n${body}`
  const LETDOWN_TONES: readonly EmotionTone[] =
    ['letdown', 'resentment', 'complaint', 'panic', 'worry']

  const childHits = CHILD_SCHOOL_TERMS.filter((t) => all.includes(t)).length
  const revealHits = REVEAL_PATH_TERMS.filter((t) => all.includes(t)).length
  if (LETDOWN_TONES.includes(tone) && childHits > 0 && revealHits > 0) {
    return 'incident_reveal_emotion'
  }

  const fondHits = FOND_WATCH_TERMS.filter((t) => all.includes(t)).length
  // 🔴 **소재 링크가 곧 신호다.** 실제 #39 는 본문에 `아기` 한 번뿐이고
  //    유튜브는 낱말이 아니라 **링크**로 들어 있었다. 낱말만 세면 놓친다 —
  //    영상 링크를 걸어 두고 무언가를 이야기하는 글은 '보는 글' 이다.
  const hasContentLink = contentUrlIn(all) !== null
  // 🔴 그래도 좁게 유지한다. 링크가 없으면 두 종류 이상 걸려야 한다 —
  //    `영상` 한 번으로 주접 제목을 만들지 않는다
  if (fondHits >= 2 || (fondHits >= 1 && hasContentLink)) return 'fond_gush'

  return 'plain_subject'
}

/**
 * 🔴 사건형 제목에 달 수 있는 **감정 표시** (2026-09-02 12판 #40).
 *
 * 제목 구조는 잡혔는데 감정 자리가 비어 있었다. 목록을 주지 않으면
 * 모델은 그 자리를 그냥 건너뛴다 — 말줄임표 하나로 끝냈다.
 * 🔴 **하나만** 고르게 한다. 겹쳐 붙이면 신파가 된다.
 */
export const INCIDENT_EMOTION_MARKERS: readonly string[] = [
  '미치겠네요', '어쩌죠', '허탈합니다', '하..', 'ㅠㅠ', '막막합니다', '기가 막혀서',
]

/** 🔴 모양별 제목 지시 — 목적별 지시보다 **구체적**이라 뒤에 붙여 덮는다 */
const TITLE_BY_SHAPE: Record<TitleShape, string[]> = {
  incident_reveal_emotion: [
    '   🔴 이 글의 제목은 **「사건 + 들킨 경로 + 엄마 감정」** 순서로 세웁니다.',
    '      · 사건: 무슨 일이 있었나 (성적을 속였다 · 원서를 잘못 썼다)',
    '      · 들킨 경로: 어떻게 알게 됐나 (담임 전화 · 문자 · 성적표)',
    `      · 엄마 감정: 알고 난 뒤의 마음 (${INCIDENT_EMOTION_MARKERS.slice(0, 5).join(' · ')})`,
    '   🔴 구체 낱말을 제목에 살립니다 — 고3 · 모의고사 · 성적 · 담임 · 수시 · 속였 류.',
    '      "아이 문제로 속상합니다" 처럼 뭉뚱그리면 실패입니다. 무엇이 있었는지가 보여야 합니다.',
    // 🔴 2026-09-02 12판 #40 — 사건과 경로는 담겼는데 **감정이 절반**이었다.
    //    "막막" 하나에 말줄임표뿐이었다. 세 번째 자리를 비워 두면 모델이 그냥 안 쓴다.
    '   🔴 **감정 자리를 비우지 않습니다.** 위 목록에서 **하나만** 골라 제목에 답니다.',
    '      하나면 충분합니다 — 두 개 이상 겹쳐 붙이면 신파가 됩니다.',
    '   🔴 이건 **제목에만** 해당합니다. 본문까지 과장하거나 감정을 연기하지 않습니다 —',
    '      원문에 없는 눈물·한숨·무너짐을 지어내면 실패입니다.',
    '   🔴 단정한 요약형 금지. 제목이 문장으로 끝나도 됩니다 — ㅠㅠ · .. · 하.. 가 붙어도 됩니다.',
  ],
  fond_gush: [
    '   🔴 이 글의 제목은 **커뮤식 주접 제목**입니다. 짧게 요약하지 않습니다.',
    '      랜선 이모가 흐뭇하게 자랑하는 말투 — "너무 귀여워서 미쳐요" · "ㅋㅋㅋ".',
    '   🔴 무엇을 보고 있는지가 제목에 나옵니다 (누구 영상인지 · 무슨 채널인지).',
    '   🔴 감상문 제목 금지 — "요즘 보는 영상" · "귀여운 아기" 같은 것.',
    // 🔴 2026-09-02 12판 — 이모지를 성공 지표로 삼지 않는다.
    //    원문에 이모지가 없는데 제목에만 달면 그건 우리가 만든 톤이지 이 글의 톤이 아니다.
    '   🔴 이모지(❤️ 등)는 **원문이나 말투에 원래 있을 때만** 씁니다.',
    '      넣지 않아도 됩니다 — 없다고 실패가 아닙니다. 억지로 달지 마세요.',
  ],
  plain_subject: [],
}

/**
 * 🔴 온도 줄. 사건형에서는 **온도가 감정 자리를 죽이지 않게** 한 줄 덧붙인다
 *    (2026-09-02 12판 #40 — 원문이 담담해서 `calm` 이 잡혔고,
 *     "과장하지 않습니다" 가 「엄마 감정」 지시와 서로 당겨 감정이 빠졌다).
 *
 * 🔴 온도 지시를 지우지는 않는다. 본문은 여전히 담담해야 한다 —
 *    **제목 한 자리에만** 예외를 연다.
 */
const CALM_TEMPS: readonly TitleTemperature[] = ['calm', 'worried']
function temperatureLine(p: SourceProfile): string[] {
  const base = `- ${TEMP_DIRECTIVE[p.titleTemperature]}`
  if (p.titleShape !== 'incident_reveal_emotion' || !CALM_TEMPS.includes(p.titleTemperature)) {
    return [base]
  }
  return [
    base,
    '  🔴 다만 **제목 끝의 감정 표시 하나는 과장이 아닙니다.** 이건 사건을 알게 된 사람의 말입니다.',
    '     원문이 담담하다고 제목까지 무표정할 필요는 없습니다 — 본문은 담담하게 갑니다.',
  ]
}

export function titleDirectives(p: SourceProfile): string[] {
  return [
    '## 🔴 제목',
    ...temperatureLine(p),
    ...TITLE_BY_NEED[p.interactionNeed],
    // 🔴 소재가 정하는 모양은 목적별 지시보다 구체적이라 뒤에 온다
    ...TITLE_BY_SHAPE[p.titleShape],
    '🔴 **조용한 요약 제목은 실패입니다.** "~에 대하여" · "~후기" · "~생각" 같은 것.',
    '🔴 커뮤니티 목록에서 **눌러 보고 싶은 제목**이어야 합니다.',
    '   다만 낚시·거짓 과장은 금지입니다 — 글에 없는 일을 제목에 넣지 않습니다.',
    '🔴 원문 제목을 그대로 쓰지 않습니다. 온도만 가져옵니다.',
  ]
}

/**
 * 🔴 **어떻게 닫는가** (2026-09-02 9판).
 *
 * 호칭은 성공 지표가 아니다. 원문이 부를 때만 부른다.
 * `no_call` 에 CTA 를 붙이는 것이 9판에서 나온 AI 티의 정체였다.
 */
/**
 * 🔴 글 하나에 허용하는 물음표 수 (2026-09-02 12판 #41).
 *
 * 11판에서 질문이 0개로 죽어서 살렸더니, 12판에서 4개가 됐다.
 * 규칙이 한쪽으로만 세면 반대쪽으로 넘어간다 — 양쪽에 벽을 세운다.
 *   0개  → 🔴 실패 (explicit_question 인데 묻지 않았다)
 *   1~2  → ✅ 정상. 주접 자문 한 번은 말버릇이다
 *   3+   → 🔴 실패. 그건 말버릇이 아니라 공식이다
 */
export const MAX_QUESTION_MARKS = 2

const CLOSING_DIRECTIVE: Record<ClosingIntent, string[]> = {
  explicit_question: [
    '- 원문은 **실제로 묻고 끝납니다.** 그 질문을 살립니다.',
    // 🔴 2026-09-02 11판 #39 — 여기가 약해서 질문이 통째로 죽었다.
    //    no_call 을 세게 막았더니 "묻지 마라" 가 묻는 글에까지 번졌다.
    //    억지 CTA 금지와 **원문이 묻는 질문을 살리는 것**은 반대말이 아니다.
    '  🔴 **질문이 사라지면 실패입니다.** 제목이나 본문 끝 중 한 곳에는 묻는 말이 남아야 합니다.',
    `  부를 때는 우리 호칭을 씁니다: ${SORANSORAN_ADDRESS.slice(0, 2).join(' · ')}`,
    `  예: "혹시 보시는 ${SORANSORAN_ADDRESS[0]} 계세요?" 처럼 제목에 물어도 됩니다.`,
    // 🔴 2026-09-02 12판 #41 — 질문을 살렸더니 이번엔 **남발**했다.
    //    제목 1 + 본문 3 = 물음표 4개. 살리는 것과 반복하는 것은 다르다.
    '  🔴 **묻는 곳은 한 곳입니다.** 제목에 물었으면 본문 끝에서 또 묻지 않습니다.',
    `  🔴 글 전체에서 물음표는 **${MAX_QUESTION_MARKS}개까지**입니다. ${MAX_QUESTION_MARKS + 1}개부터는 실패입니다.`,
    '     "어쩜 이렇게 귀엽죠?" 같은 혼잣말 물음은 **한 번**까지 봐줍니다. 서너 번 반복하면 말버릇이 아니라 공식입니다.',
    '  🔴 다만 원문에 없던 질문을 **더** 만들지 않습니다. 묻는 것은 하나면 됩니다.',
    '  🔴 "그래서 말인데요" · "댓글 부탁드려요" 같은 **공식 CTA 는 여전히 금지**입니다.',
    '     원문이 묻던 그 질문을 그대로 살리는 것이지, 댓글을 구걸하는 게 아닙니다.',
  ],
  advice_request: [
    '- 원문은 **조언을 청하며 끝납니다.** 무엇이 궁금한지 구체적으로 적고 청합니다.',
    `  부를 때는 우리 호칭을 씁니다: ${SORANSORAN_ADDRESS.slice(0, 2).join(' · ')}`,
  ],
  experience_call: [
    '- 원문은 **겪어본 사람을 찾으며 끝납니다.** 그 호출을 살립니다.',
    `  예: "겪어보신 ${SORANSORAN_ADDRESS[0]} 계실까요" · "혹시 저만 그런가요"`,
  ],
  vent_to_audience: [
    '- 원문은 **묻지는 않지만 듣는 사람을 향해** 펴고 끝납니다.',
    '  하소연으로 닫습니다. 🔴 **질문으로 바꾸지 마세요** — 답을 구하는 글이 아닙니다.',
    `  호칭을 쓴다면 부르는 말이 아니라 곁의 말입니다: "${SORANSORAN_ADDRESS[0]}…" 정도.`,
  ],
  no_call: [
    '- 🔴 **원문은 아무도 부르지 않고 끝납니다.** 우리 글도 그렇게 끝냅니다.',
    '  🔴 마지막에 질문을 붙이지 않습니다. 댓글을 청하지 않습니다.',
    `  🔴 ${SORANSORAN_ADDRESS[0]} 같은 호칭을 **억지로 넣지 않습니다.**`,
    '  "그래서 말인데요" · "다들 어떻게 하세요?" · "댓글 부탁드려요" 같은 마무리는 **실패**입니다.',
    '  하던 말이 끝나면 그냥 끝냅니다. 그게 사람이 쓴 글입니다.',
  ],
}

const KIND_LABEL: Record<ConcreteDetail['kind'], string> = {
  time: '시간', date: '날짜', amount: '수치·기간', medical: '약·검사·진료',
  body: '몸의 느낌', family: '가족', emoticon: '이모티콘·자모', verbal_tic: '말버릇',
  situation: '상황(어디서·무엇을 하다가)', lifestyle: '생활 맥락(식단·체중 등)',
  usage_pattern: '어떻게 쓰고 있나(기간·중단·가끔)',
  grievance: '무엇이 서운했나(차별·손절·밀린 것)', tradeoff: '현실 계산(차라리·가성비)',
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
  'grievance', 'tradeoff',
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
    '🔴 **글을 어떻게 닫는가** (원문이 정합니다):',
    ...CLOSING_DIRECTIVE[p.closingIntent],
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
    // 🔴 2026-09-02 11판 — 링크를 두 갈래로 나눈다.
    //    출처 링크는 그대로 금지, 소재 링크(유튜브)는 정본 형태로만 허용.
    ...(p.originTraceUrls.length > 0
      ? ['',
         `🔴 원문에 **출처 링크**가 ${p.originTraceUrls.length}건 있습니다.`,
         '   **최종 글에 그 주소를 옮기지 않습니다.** 게시판·카페·블로그 주소는 출처를 그대로 드러냅니다.',
         '   필요하면 "어디서 봤는데" 없이 내용만 내 말로 씁니다.']
      : []),
    ...(p.contentReferenceUrl !== null
      ? ['',
         '✅ 원문 안의 링크가 **이 글의 소재 자체**입니다. 지우면 무슨 이야기인지 알 수 없는 글이 됩니다.',
         `   쓰려면 **이 주소를 글자 그대로** 씁니다: ${p.contentReferenceUrl}`,
         '   🔴 다른 주소를 만들지 않습니다. 단축 주소(youtu.be)·추적 파라미터(?si=…)를 붙이지 않습니다.',
         '   🔴 링크는 **한 번만** 씁니다. 나열하지 않습니다.',
         '   링크를 쓰지 않고 내용만 내 말로 풀어도 됩니다 — 둘 다 괜찮습니다.']
      : ['',
         '🔴 **어떤 주소(URL)도 쓰지 않습니다.** 이 글에는 옮겨도 되는 링크가 없습니다.']),
    ...(p.externalAddressTerms.length > 0
      ? ['',
         `🔴 원문에 다른 커뮤니티 호칭이 있습니다: ${p.externalAddressTerms.join(' · ')}`,
         `   이 말을 그대로 쓰면 안 됩니다. 우리는 ${SORANSORAN_ADDRESS.join(' · ')} 라고 부릅니다.`,
         '   🔴 낱말만 바꾸지 말고 **부르는 문장 전체를 이 글의 목적에 맞게 다시 씁니다.**']
      : []),
  ]
}
