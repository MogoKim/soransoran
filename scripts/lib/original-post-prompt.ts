/**
 * 오리지널 게시글 초안 프롬프트 — 🔴 순수 함수. LLM · DB · 파일 IO · 네트워크 없음
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §5-2-1 · §12-2
 *       docs/operations/2026-08-30-persona-safety-originality-gate-design.md
 *
 * 🔴 **마이크로시드와 반대 방향의 레인이다.**
 *    마이크로시드는 원문을 *그대로* 발행하고(정책 7) 그 대가로 영구 noindex 를 진다
 *    (MICRO_SEED_POST_VISIBILITY_FLAGS). 이 레인은 원문을 **재료로만** 쓰고
 *    우리 글을 새로 쓴다 — 그래야 색인 가능한 자산이 된다.
 *    그래서 여기서 가장 중요한 규칙은 하나다: **원문을 옮기지 않는다.**
 *
 * 🔴 이 파일은 부르지 않는다.
 *    프롬프트를 만들고, 응답을 파싱하고, 저장 레코드를 만드는 것까지다.
 *    호출은 original-post-generate.mts 가 하고, 실제 API 는
 *    voice-m3-provider.mts 하나만 부른다(이 저장소의 단일 유료 경로).
 *
 * 🔴 **원문 저장 금지 계약** — persona-prompt.ts 와 같은 계약이다.
 *      · OriginalPostRecord 에는 sourceRawContentId · title · body 뿐이다.
 *        rawTitle · rawBody 를 담을 자리가 **타입에 없다.**
 *      · assertNoStoredSource 가 저장 직전에 실측으로 한 번 더 막는다.
 *    원문은 MicroSeedRawContent 에 이미 원형으로 있다. 두 벌 둘 이유가 없고,
 *    두 벌이 되는 순간 삭제 요청(§11-2)에 응할 자리가 둘로 갈린다.
 *
 * 🔴 금칙어는 **기존 상수를 그대로 쓴다.** 여기서 새로 적지 않는다.
 *    Gate 와 프롬프트가 각각 목록을 가지면 한쪽만 바뀌는 날이 오고,
 *    그날부터 Gate 는 자기가 막는 것을 프롬프트가 시킨다.
 */
import { BRAND_BANNED_WORDS } from '../../src/lib/content-guard'
import {
  SOURCE_SPECIFIC_TERMS, SORANSORAN_REGISTER_TERMS,
  TARGET_DESCRIPTOR_TERMS, SOURCE_CONTEXT_TERMS,
} from './voice-style-signals.mjs'
import {
  MIN_POST_TITLE_LENGTH, MAX_POST_TITLE_LENGTH,
  MIN_POST_CONTENT_LENGTH, MAX_POST_CONTENT_LENGTH,
} from '../../src/lib/post-policy'
import {
  readSourceProfile, profileDirectives, titleDirectives,
  EXTERNAL_ADDRESS_TERMS, SORANSORAN_ADDRESS, ORIGIN_TRACE_TERMS, originTraceHitsIn,
  SOURCE_URL_RE, type SourceProfile,
} from './source-profile'

/** 🔴 계측은 전역 플래그가 필요하다. 판정용 상수를 재사용하되 g 를 붙여 새로 만든다 */
const SOURCE_URL_RE_G = new RegExp(SOURCE_URL_RE.source, 'gi')
/** 🔴 줄 **끝**에 붙은 이모티콘만 본다. 문장 중간의 것은 균등 배치와 무관하다 */
const EMOTICON_TAIL_RE = /(ㅋ{2,}|ㅎ{2,}|ㅠ{1,}|ㅜ{1,}|\^\^|\p{Extended_Pictographic})[\s.!?~]*$/u

/** 응답 상한. 제목 + 본문 + JSON 껍데기에 넉넉한 값 */
export const MAX_OUTPUT_TOKENS = 2000

/**
 * 🔴 프롬프트가 권하는 길이 (2026-09-01).
 *
 * 정책 상한(MAX_POST_CONTENT_LENGTH 5000)과 다른 값이다.
 * 정책은 "여기까지 허용" 이고 이것은 "이 정도로 써라" 다.
 *
 * 🔴 상한만 주지 않고 하한도 준다. 댓글 레인에서는 길수록 같은 리듬을
 *    반복할 자리가 늘어 짧게 눌렀지만, 게시글은 반대다 —
 *    너무 짧으면 원문 요약이 되어 버린다. 요약은 우리 글이 아니다.
 */
export const PROMPT_BODY_MIN_CHARS = 300
export const PROMPT_BODY_MAX_CHARS = 900
/** 제목 권장 상한. 정책 상한 120자는 너무 길어 목록에서 잘린다 */
export const PROMPT_TITLE_MAX_CHARS = 40

/**
 * 🔴 원문에서 무엇을 가져오는가 — **소재이지 문장이 아니다.**
 *
 * 이 목록은 프롬프트에 그대로 실린다. "무엇을 쓰지 마라" 만 주면 모델은
 * 남은 흔한 자리로 옮겨 간다(댓글 레인 #10~#12 의 교훈).
 * **무엇을 가져올지**를 함께 준다.
 */
export const MATERIAL_TAKEAWAYS: readonly string[] = [
  '어떤 상황에 놓인 사람의 이야기였는지',
  '무엇이 곤란했고 무엇이 마음에 걸렸는지',
  '읽고 나서 나에게 남은 질문 하나',
]

/**
 * 🔴 글을 여는 방법 — 댓글 레인에서 배운 것을 옮겨 온다.
 *
 * 상투적 시작을 이름 대고 막지 않으면 모델은 매번 같은 자리에서 말을 꺼낸다.
 * 게시글은 첫 문장이 목록 미리보기에도 쓰이므로 댓글보다 더 눈에 띈다.
 */
export const CLICHE_POST_OPENERS: readonly string[] = [
  '요즘 들어',
  '나이가 드니',
  '다들 그러시겠지만',
  '오늘은',
  '문득',
  '어느새',
]

/**
 * 🔴 AI 티가 나는 글 구조 — 이름을 대고 막는다.
 *
 * 커뮤니티 글은 정리된 문서가 아니다. 댓글 레인의 TOO_TIDY 태그가
 * 반복해서 가리킨 자리를 게시글 쪽으로 옮겨 적었다.
 */
export const AI_STRUCTURE_BANS: readonly string[] = [
  '번호 매긴 목록',
  '소제목',
  '“첫째, 둘째”',
  '마지막 문단의 정리·요약',
  '“～하시기 바랍니다” 같은 안내문 말투',
  '이모지 나열',
]

/**
 * 🔴 말투 샘플 상한 (2026-09-01).
 *
 * 첫 판이 실패한 이유는 재료가 **하나**여서 그 하나가 소재와 말투를 겸했기 때문이다.
 * 그렇다고 샘플을 많이 넣으면 반대 사고가 난다 — 여러 사람 말투가 섞여
 * 누구도 아닌 목소리가 되고, 샘플 문장을 가져올 자리도 그만큼 늘어난다.
 * 2~3건이면 "이런 식으로 말한다" 는 전해지고 베낄 거리는 적다.
 */
export const MAX_VOICE_SAMPLES = 3

/**
 * 🔴 샘플에서 무엇을 볼 것인가 — **내용이 아니라 말하는 방식**이다.
 *
 * 프롬프트에 그대로 실린다. 금지("베끼지 마라")만 주면 모델은 볼 것이 없어
 * 샘플을 무시하거나, 반대로 내용을 가져온다. **무엇을 보라**를 준다.
 */
export const VOICE_TAKEAWAYS: readonly string[] = [
  '문장을 어디서 끊고 어디서 이어 붙이는지',
  '문단이 고르지 않게 나뉘는 방식',
  '말끝을 다듬지 않고 두는 자리',
  '하다 만 말, 되돌아가 덧붙이는 말',
  '감정을 크게 쓰지 않고 슬쩍 지나가는 방식',
]

/**
 * 🔴 창업자 critique — **이 표현이 나오면 실패다** (2026-09-01).
 *
 * 3판 9건을 창업자가 읽고 뽑아낸 실제 문장들이다. 추상적인 "AI 티" 가 아니라
 * **눈에 걸린 자리**다. 모델은 "자연스럽게 써라" 를 들으면 자기가 아는 가장
 * 매끄러운 문장으로 가는데, 그 매끄러움이 정확히 이 목록이다.
 *
 * 🔴 Gate 로 막지 않는다. 프롬프트에서 이름을 대고 막고, analyzeDraft 가 **센다.**
 *    차단은 사람이 본 뒤의 일이다(PR B).
 */
export const CRITIQUE_BANNED_PHRASES: readonly string[] = [
  '당신이라면',
  '경험을 하신 분 있으세요',
  '지레 겁을 먹고',
  '연거푸 들이켜도',
  '바짝바짝 타들어가네요',
  '잠이 영 안 오네요',
  '참 기분이 묘합니다',
  '이 시간이 언제까지 이렇게 가줄까',
  '몸도 예전 같지 않아서',
  // 🔴 4판(#11 · #12) 에서 새로 걸린 것들 (2026-09-01)
  '주책부렸네요',
  '이 맛에 사나 봐요',
  '느낀 점이에요',
  '피부는 참 마음대로 안 되네요',
  // 🔴 5판 #13 — 다급함을 시켰더니 **감정을 연기**했다. 원문에 없던 장면들이다
  '손이 떨리고',
  '글이 두서없어도 제발 봐주세요',
  '입을 벌린 채로 멍하니',
]

/**
 * 🔴 **경계** 표현 — 금지는 아니지만 나오면 들여다볼 자리 (2026-09-01).
 *
 * `글쎄` 같은 말은 그 자체가 틀린 것이 아니다. 문장 첫머리에서 뜸 들이는 투로 쓰일 때
 * AI 티가 나는데, 문자열만으로는 그 차이를 가릴 수 없다.
 * 하드 실패로 세면 정상 문장까지 걸리므로 **따로 센다** —
 * 하나로 합치면 실패 건수가 부풀고, 부푼 수치는 판단에 쓸 수 없다.
 */
export const CRITIQUE_WATCH_PHRASES: readonly string[] = [
  '글쎄',
]

/** 🔴 문체 자체가 실패인 것들 — 문장이 아니라 장르다 */
export const CRITIQUE_BANNED_REGISTERS: readonly string[] = [
  '브런치 수필체 (곱게 다듬은 문학적 산문)',
  '상담문 · 진단문 · 안내문 말투',
  '차분하게 정리된 총평으로 끝맺기',
  '독자에게 질문을 던지는 마무리 수사',
  // 🔴 4판 피드백 (2026-09-01)
  '드라마 대본 말투',
  '아침방송 리포터 말투',
  '점잖게 귀여운 척하는 말투',
  '바른 생활 일기장',
  'AI 가 번호 매겨 요약한 브리핑',
  '후기 요약문 · "느낀 점" 으로 끝맺기',
  // 🔴 5판 #13 피드백 — 절박함을 무대 위 표정으로 연기하는 것
  '영화 대사 같은 감정 표현',
  '연극용 절박함 (없던 몸 반응·장면을 지어내기)',
  '소설용 공포 표현',
  '정갈한 요약 후기',
]

/**
 * 🔴 표본 선정 — **길이 분위수** (2026-09-01, 10건 검수 준비).
 *
 * 이전 로직은 `긴 것 → 짧은 것 → 중앙값` 세 자리만 정의돼 있었다.
 * 4번째부터는 계속 중앙값을 집어서 **5건으로 늘리면 뒤 셋이 비슷한 길이로 뭉친다.**
 * 표본을 늘리는 목적이 "길이별로 어디서 실패하는가" 를 보는 것인데,
 * 뭉치면 늘린 만큼 아무것도 새로 알 수 없다.
 *
 * 🔴 결정적이어야 한다. 부를 때마다 표본이 바뀌면
 *    "프롬프트를 고쳐 좋아진 것" 과 "재료가 바뀌어 좋아진 것" 을 구분할 수 없다.
 *    길이 오름차순 · 같으면 id 순으로 고정한다.
 *
 * 🔴 limit 3 은 이전과 **같은 집합**이 나온다 — p0(가장 짧은 것) · p50(중앙) ·
 *    p100(가장 긴 것). 순서만 길이 오름차순으로 바뀐다.
 * 🔴 limit 1 은 **가장 긴 것**이다. 이전 동작을 유지한다 —
 *    한 건만 볼 때 긴 글이 가장 많은 것을 드러내기 때문이다.
 */
export function selectByLengthQuantile<T>(input: {
  items: readonly T[]
  lengthOf: (item: T) => number
  keyOf: (item: T) => string
  limit: number
}): T[] {
  const { items, lengthOf, keyOf } = input
  const limit = Math.max(0, Math.floor(input.limit))
  if (limit === 0 || items.length === 0) return []

  // 🔴 정렬을 먼저 고정한다. 길이가 같은 항목이 있으면 id 로 가른다
  const sorted = [...items].sort(
    (a, b) => lengthOf(a) - lengthOf(b) || keyOf(a).localeCompare(keyOf(b)),
  )
  // 🔴 가진 것보다 많이 달라고 해도 있는 만큼만 돌려준다. 여기서 던지지 않는다 —
  //    "몇 건이 필요한가" 는 호출부의 판단이고, 이 함수는 고르기만 한다
  const n = Math.min(limit, sorted.length)
  if (n === 1) {
    const longest = sorted[sorted.length - 1]
    return longest === undefined ? [] : [longest]
  }

  const used = new Set<number>()
  const picked: T[] = []
  for (let i = 0; i < n; i += 1) {
    // p0 · p25 · p50 · p75 · p100 (n=5 기준). 양 끝을 반드시 포함한다
    const target = Math.round((i * (sorted.length - 1)) / (n - 1))
    // 🔴 같은 자리가 두 번 나오면(짧은 목록) 가장 가까운 빈자리로 옮긴다.
    //    같은 원문을 두 번 넣으면 표본 수만 늘고 아는 것은 늘지 않는다
    let idx = target
    if (used.has(idx)) {
      let step = 1
      while (step <= sorted.length) {
        if (target - step >= 0 && !used.has(target - step)) { idx = target - step; break }
        if (target + step < sorted.length && !used.has(target + step)) { idx = target + step; break }
        step += 1
      }
    }
    if (used.has(idx)) continue
    used.add(idx)
    const item = sorted[idx]
    if (item !== undefined) picked.push(item)
  }
  return picked
}

/** MicroSeedRawContent 에서 프롬프트에 필요한 것만. 🔴 저장되지 않는다 */
export type PromptRawContent = {
  /** 🔴 우리 DB MicroSeedRawContent.id. 원문이 아니라 참조다 */
  id: string
  rawTitle: string
  rawBody: string
  /** '82cook' · 'navercafe:remonterrace' 등. 🔴 프롬프트에 실리지 않는다 — 치환 대상 판정에만 쓴다 */
  sourceSite: string
}

/** 이 초안을 어느 게시판에 둘 생각인가. 말투가 달라진다 */
export const POST_BOARD_HINTS = ['MENOPAUSE', 'FREE'] as const
export type PostBoardHint = (typeof POST_BOARD_HINTS)[number]

export const isPostBoardHint = (v: unknown): v is PostBoardHint =>
  typeof v === 'string' && (POST_BOARD_HINTS as readonly string[]).includes(v)

const BOARD_GUIDE: Record<PostBoardHint, string> = {
  MENOPAUSE: '몸과 마음이 달라지는 시기의 이야기. 증상을 나열하지 말고 하루의 한 장면으로 씁니다.',
  FREE: '무엇이든 쓰는 자리. 소재가 가볍더라도 내 이야기로 씁니다.',
}

export type PromptBlockCode =
  | 'RAW_ID_EMPTY'
  | 'RAW_TITLE_EMPTY'
  | 'RAW_BODY_EMPTY'
  | 'RAW_BODY_TOO_SHORT'
  | 'BOARD_HINT_INVALID'

export type PromptBlock = { code: PromptBlockCode; message: string }

export type BuiltPrompt = {
  systemPrompt: string
  userPayload: string
  maxOutputTokens: number
}

export type PromptPlan =
  | { ok: true; prompt: BuiltPrompt; blocks: [] }
  | { ok: false; blocks: PromptBlock[] }

/**
 * 🔴 재료로 삼기에 너무 짧은 원문은 막는다.
 *
 * 짧은 원문으로 긴 글을 쓰라고 하면 모델은 없는 이야기를 지어낸다.
 * 그건 우리 글이 아니라 창작이고, 커뮤니티에서 가장 위험한 종류의 거짓이다.
 */
export const RAW_BODY_MIN_CHARS = 120

/** 🔴 출처 호칭은 그대로 두지 않는다 — 치환 결과를 함께 알려 준다 */
const sourceTermsFor = (sourceSite: string): readonly string[] =>
  SOURCE_SPECIFIC_TERMS.filter((t) => t.site === sourceSite).map((t) => t.term)

export function buildPrompt(input: {
  raw: PromptRawContent
  boardHint: string
  /**
   * 🔴 우리 회원들이 실제로 쓴 글 본문 (voice engine 이 고른 것).
   *    프롬프트에만 실리고 **저장되지 않는다.** 없으면 이 섹션 자체가 빠진다 —
   *    빈 목록을 보여주면 모델이 "샘플이 없다" 를 지시로 읽는다.
   */
  voiceSamples?: readonly string[]
  /** 🔴 미리 읽어 둔 프로파일. 없으면 여기서 읽는다(호출부가 같은 값을 보고할 수 있게 받아 둔다) */
  profile?: SourceProfile
}): PromptPlan {
  const blocks: PromptBlock[] = []
  const { raw } = input

  if (raw.id.trim() === '') {
    blocks.push({ code: 'RAW_ID_EMPTY', message: 'sourceRawContentId 가 비어 있습니다' })
  }
  if (raw.rawTitle.trim() === '') {
    blocks.push({ code: 'RAW_TITLE_EMPTY', message: '원문 제목이 비어 있습니다' })
  }
  if (raw.rawBody.trim() === '') {
    blocks.push({ code: 'RAW_BODY_EMPTY', message: '원문 본문이 비어 있습니다' })
  } else if ([...raw.rawBody.trim()].length < RAW_BODY_MIN_CHARS) {
    // 🔴 여기서 막지 않으면 모델이 없는 이야기를 채운다
    blocks.push({
      code: 'RAW_BODY_TOO_SHORT',
      message: `원문이 ${[...raw.rawBody.trim()].length}자 — 재료로 쓰려면 ${RAW_BODY_MIN_CHARS}자 이상이어야 합니다`,
    })
  }
  if (!isPostBoardHint(input.boardHint)) {
    blocks.push({
      code: 'BOARD_HINT_INVALID',
      message: `알 수 없는 게시판: ${input.boardHint} (${POST_BOARD_HINTS.join(' · ')})`,
    })
  }

  if (blocks.length > 0) return { ok: false, blocks }

  const board = input.boardHint as PostBoardHint
  // 🔴 원문을 **생성 전에 규칙으로 읽는다.** 모델의 자기 판단에 맡기지 않는 이유는
  //    3판 실패가 전부 "이 글이 어떤 글인지 아무도 말해주지 않아서" 생겼기 때문이다.
  //    규칙이면 fixture 로 잠글 수 있고 나중에 되짚을 수 있다.
  const profile: SourceProfile = input.profile ?? readSourceProfile({
    rawTitle: raw.rawTitle, rawBody: raw.rawBody,
  })
  // 🔴 상한을 넘겨도 여기서 자른다 — 호출부 실수로 말투가 섞이지 않게
  const voiceSamples = (input.voiceSamples ?? [])
    .map((s) => (s ?? '').trim())
    .filter((s) => s !== '')
    .slice(0, MAX_VOICE_SAMPLES)
  const sourceTerms = sourceTermsFor(raw.sourceSite)
  const strongContext = SOURCE_CONTEXT_TERMS.filter((t) => t.tier === 'strong').map((t) => t.term)

  const systemPrompt = [
    '당신은 한국의 40~60대 여성들이 모인 커뮤니티 "소란소란" 의 회원입니다.',
    '아래에 다른 곳에서 읽은 글 하나가 주어집니다. 그 글을 읽고,',
    '**당신이 우리 게시판에 직접 쓰는 글 하나**를 씁니다.',
    '',
    // 🔴 축을 먼저 못박는다. 아래에 글이 두 종류(말투 샘플 · 재료) 실리므로
    //    무엇을 어디서 가져오는지 헷갈리면 그것이 곧 실패다
    ...(voiceSamples.length > 0
      ? ['## 🔴 재료가 두 가지입니다 — 섞지 마세요',
         '- **[재료]** (맨 아래 글): 무엇에 대해 쓸지. **소재와 문제의식만** 가져옵니다.',
         '- **[우리 회원 글]**: 어떻게 쓸지. **말하는 방식만** 가져옵니다. 내용은 가져오지 않습니다.',
         '둘 다 문장을 옮겨 오지 않습니다.',
         '']
      : []),
    // 🔴 프로파일이 **가장 먼저** 온다. 뒤에 오는 어떤 지시보다 앞이다 —
    //    "말투 샘플" 과 충돌하면 이쪽이 이긴다(아래 우선순위 문장이 그것을 못박는다).
    ...profileDirectives(profile),
    '',
    '## 🔴 가장 중요한 것 — 옮겨 적는 것이 아닙니다',
    '아래 [재료] 는 **소재**입니다. 번역도 요약도 재구성도 아닙니다.',
    '원문의 문장을 **한 조각도 그대로 쓰지 않습니다.** 말을 살짝 바꿔 옮기는 것도 안 됩니다.',
    // 🔴 2026-09-01 정책 변경. 이전 판은 "숫자·날짜·약·검사를 가져오지 마라" 였는데,
    //    그 지시가 글에서 **구체성을 전부 걷어냈다.** 남은 것은 느낌뿐이었고
    //    그것이 곧 AI 티였다(#7 실패 — 약·시간·CT·번호가 통째로 사라졌다).
    //    막을 것은 **누구인지 특정되는 조합**이지 감각과 경과가 아니다.
    '🔴 **특정 개인이 드러나는 것만** 가져오지 않습니다 — 실명 · 상호 · 병원 이름 · 정확한 주소 ·',
    '   그 사람만의 독특한 표현. 이것들은 지웁니다.',
    '🔴 그러나 **시간 · 날짜 · 먹은 약 · 검사 · 수치 · 몸의 느낌 · 이모티콘 · 말버릇은 지우지 않습니다.**',
    '   그대로 베끼라는 뜻이 아닙니다. **내 경우의 같은 종류**를 그만큼 구체적으로 씁니다.',
    '   이런 것이 빠지면 느낌만 남고, 느낌만 남은 글이 기계가 쓴 글입니다.',
    '원문의 문단 순서를 따라가지 않습니다. 그건 구조를 베낀 것입니다.',
    '',
    '[재료] 에서 가져올 것은 이것뿐입니다:',
    ...MATERIAL_TAKEAWAYS.map((t) => `- ${t}`),
    '그 위에 **당신의 이야기**를 씁니다. 원문에 없던 당신의 하루가 들어가야 합니다.',
    '',
    '## 🔴 출처가 드러나면 안 됩니다',
    '이 글이 어디서 왔는지 읽는 사람이 알 수 없어야 합니다.',
    ...(sourceTerms.length > 0
      ? [`- 이 호칭을 쓰지 않습니다: ${sourceTerms.join(' · ')}`,
         `  우리는 서로를 이렇게 부릅니다: ${SORANSORAN_REGISTER_TERMS.join(' · ')}`]
      : [`- 다른 커뮤니티의 호칭을 쓰지 않습니다. 우리는 서로를 이렇게 부릅니다: ${SORANSORAN_REGISTER_TERMS.join(' · ')}`]),
    `- 출처 맥락을 드러내는 말을 쓰지 않습니다: ${strongContext.join(' · ')}`,
    '- "어느 카페에서 봤는데", "다른 데서 읽었는데" 같은 말을 쓰지 않습니다.',
    '  이 글은 옮긴 글이 아니라 **당신이 쓰는 글**입니다.',
    '',
    '## 🔴 우리를 설명하지 않습니다',
    `- 이 낱말을 쓰지 않습니다: ${BRAND_BANNED_WORDS.join(' · ')}`,
    `- 우리를 설명하는 말을 쓰지 않습니다: ${[...TARGET_DESCRIPTOR_TERMS].slice(0, 10).join(' · ')}`,
    '  커뮤니티 안에서는 서로를 설명하지 않습니다. 그냥 말합니다.',
    '',
    '## 이 게시판',
    `${board} — ${BOARD_GUIDE[board]}`,
    '',
    // ── 🔴 말투 축 (2026-09-01) ──
    //    첫 판이 실패한 이유는 재료가 하나뿐이라 그 하나가 소재와 말투를 겸했기 때문이다.
    //    소재는 아래 user 쪽 글에서, 말투는 여기 샘플에서 온다. 축을 나눠야
    //    "다른 글을 다시 쓴 글" 이 아니라 "우리 회원이 쓴 글" 이 된다.
    ...(voiceSamples.length > 0
      ? [
          '## 🔴 말투 참고 — 우리 회원들이 실제로 쓴 글',
          '아래는 **우리 커뮤니티 사람들이 직접 쓴 글**입니다. 아래 글에서 볼 것은 이것뿐입니다:',
          ...VOICE_TAKEAWAYS.map((t) => `- ${t}`),
          '',
          '🔴 **내용을 가져오지 않습니다.** 여기 나온 사건·소재·상황은 이번 글과 아무 상관이 없습니다.',
          '   문장을 옮겨 쓰지 않습니다. 표현을 빌려오지 않습니다.',
          '   **말하는 방식만** 보고, 쓸 내용은 아래 [재료] 에서 가져옵니다.',
          '🔴 이 사람들을 흉내 내는 것이 아닙니다. 이렇게 **편하게 쓰면 된다**는 기준입니다.',
          '   문장이 매끄럽지 않아도 됩니다. 오히려 너무 매끄러우면 우리 글이 아닙니다.',
          // 🔴 충돌 규칙을 명시한다. 샘플이 차분한데 이 글이 다급하면 **이 글이 이긴다**
          '🔴 **샘플과 위의 「이 글이 어떤 글인지」 가 어긋나면 위쪽이 우선입니다.**',
          '   샘플은 말투의 바닥일 뿐이고, 이 글의 온도는 [재료] 가 정합니다.',
          '   밝은 글이면 밝은 주접과 이모티콘으로, 다급한 글이면 두서없이 되풀이하며,',
          '   묻는 글이면 기간·수치·써 본 것을 구체적으로 적어 물어봅니다.',
          '',
          ...voiceSamples.flatMap((s, i) => [`--- 우리 회원 글 ${i + 1} ---`, s.trim(), '']),
        ]
      : []),
    '## 🔴 사람이 쓴 글처럼',
    `- 이렇게 시작하지 않습니다: ${CLICHE_POST_OPENERS.join(' · ')}`,
    '  (다들 이렇게 시작합니다. 지금 당신 자리의 짧은 상황이나 감각에서 꺼내세요)',
    `- 이런 모양으로 쓰지 않습니다: ${AI_STRUCTURE_BANS.join(' · ')}`,
    '  커뮤니티 글은 정리된 문서가 아닙니다. 하다 만 말이 섞여도 괜찮습니다.',
    '- 답을 주지 않습니다. 진단·처방·약 이름·용량을 쓰지 않습니다.',
    '  무엇이 좋다 나쁘다 정하지 않습니다. 여기는 가르치는 자리가 아닙니다.',
    '- 끝에 교훈을 붙이지 않습니다. 하고 싶은 말이 끝나면 그냥 끝냅니다.',
    '- 마지막에 되묻고 싶으면 **하나만** 묻습니다. 여러 개 묻지 않습니다.',
    '',
    // 🔴 6판까지 제목이 계속 약했다. 길이 상한만 있고 **무엇을 쓰라**가 없었다
    ...titleDirectives(profile),
    '',
    '## 길이',
    `제목: ${PROMPT_TITLE_MAX_CHARS}자 이내 (많아야 ${MAX_POST_TITLE_LENGTH}자).`,
    '  물음표를 남발하지 않습니다.',
    `본문: ${PROMPT_BODY_MIN_CHARS}~${PROMPT_BODY_MAX_CHARS}자.`,
    `  ${PROMPT_BODY_MIN_CHARS}자보다 짧으면 원문 요약이 됩니다. 요약은 우리 글이 아닙니다.`,
    '',
    '## 🔴 우리를 부르는 말',
    `우리는 서로를 이렇게 부릅니다: ${SORANSORAN_ADDRESS.join(' · ')}`,
    `🔴 다른 커뮤니티 호칭(${EXTERNAL_ADDRESS_TERMS.slice(0, 6).join(' · ')} 등)은 글에 남기지 않습니다.`,
    '🔴 **링크(URL)를 글에 남기지 않습니다.** 주소는 출처를 그대로 드러냅니다.',
    `🔴 **서비스·게시판 이름도 남기지 않습니다** (${ORIGIN_TRACE_TERMS.slice(0, 5).join(' · ')} 등).`,
    '   "어디에 올렸는데" · "어디 게시판에서" 같은 말도 마찬가지입니다 —',
    '   상황감은 **행동으로 바꿔** 살립니다: "사진도 찍어봤어요" 처럼.',
    '🔴 낱말만 바꾸지 않습니다. **부르는 문장 전체를 이 글의 목적에 맞게 다시 씁니다** —',
    '   도움을 구하는 글이면 부르는 말이 다급해야 하고, 자랑글이면 가벼워야 합니다.',
    '',
    // 🔴 3판 9건을 창업자가 읽고 뽑은 실패 자리다. 추상적 "AI 티" 가 아니라 실물이다
    '## 🔴 이런 글은 실패입니다 (실제로 걸렸던 것들)',
    '아래 표현을 쓰지 않습니다. 하나라도 나오면 그 글은 버립니다:',
    ...CRITIQUE_BANNED_PHRASES.map((x) => `   · "${x}"`),
    '아래 표현은 쓰기 전에 한 번 더 생각합니다(뜸 들이는 투가 되면 실패):',
    ...CRITIQUE_WATCH_PHRASES.map((x) => `   · "${x}"`),
    '아래 문체로 쓰지 않습니다:',
    ...CRITIQUE_BANNED_REGISTERS.map((x) => `   · ${x}`),
    '🔴 깔끔한 문장 · 좋은 구조 · 자연스러운 수필은 **여기서는 실패**입니다.',
    '   이 글은 작품이 아니라 게시판에 올라오는 글입니다.',
    '',
    // 🔴 호출을 늘리지 않고 한 번 안에서 스스로 고친다.
    //    1차 초안은 거의 언제나 매끄러운 쪽으로 나온다 — 그것을 스스로 잡게 한다
    '## 🔴 쓰기 전에, 그리고 쓴 뒤에',
    '머릿속에서 이 순서로 합니다. **과정은 출력하지 않습니다.**',
    '1. 이 글이 어떤 글인지 위 지시를 다시 확인합니다 (온도 · 모양 · 부르는 목적).',
    '2. 초안을 씁니다.',
    '3. 🔴 초안을 스스로 깎아 봅니다 — 다음을 자문합니다:',
    '   · 원문의 온도가 낮아지지 않았나? (다급한 글이 차분해졌나, 밝은 글이 슬퍼졌나)',
    '   · 구체적인 것(시간·약·검사·수치·이모티콘·되풀이)이 사라지지 않았나?',
    '   · 원문에 없던 사실·감정을 지어내지 않았나?',
    '   · 위 실패 표현·문체가 섞이지 않았나?',
    '   · 부르는 말이 이 글의 목적에 맞나? 다른 커뮤니티 호칭이 남지 않았나?',
    '   · 문장이 너무 매끄럽지 않나? (매끄러우면 그것이 실패 신호입니다)',
    '   · 링크·서비스 이름·게시판 이름·다른 커뮤니티 호칭이 남지 않았나?',
    '   · 제목이 조용한 요약이 되지 않았나? 원문 온도보다 낮지 않나?',
    '   · 번호를 썼다면 보고서처럼 정돈되지 않았나? (정돈됐으면 실패입니다)',
    '   · 밝은 글인데 점잖게 귀여운 척하고 있지 않나?',
    '   · 🔴 **빠지면 실패**라고 한 것들이 다 남아 있나? 하나라도 없으면 다시 씁니다.',
    '   · 원문에 없던 몸 반응·장면을 지어내 감정을 연기하고 있지 않나?',
    '   · ㅋㅋㅋ·이모티콘이 줄 끝마다 고르게 하나씩 박혀 있지 않나?',
    '4. 걸린 곳을 고쳐 다시 씁니다. **고친 것만 최종 출력합니다.**',
    '',
    '## 출력 형식',
    '🔴 설명·과정·자기평가를 출력하지 않습니다. JSON 하나만 출력합니다.',
    '코드블록으로 감싸지 않습니다.',
    '{"title": "제목", "body": "본문"}',
  ].join('\n')

  // 🔴 원문은 여기에만 실린다. 저장되는 레코드에는 들어가지 않는다
  const userPayload = [
    '[재료 — 다른 곳에서 읽은 글. 소재와 문제의식만 가져오고, 옮겨 적지 마세요]',
    `제목: ${raw.rawTitle.trim()}`,
    '본문:',
    raw.rawBody.trim(),
  ].join('\n')

  return {
    ok: true,
    prompt: { systemPrompt, userPayload, maxOutputTokens: MAX_OUTPUT_TOKENS },
    blocks: [],
  }
}

// ─────────────────────────────────────────────────────────
// 응답 파싱
// ─────────────────────────────────────────────────────────

export type ParseErrorCode =
  | 'EMPTY' | 'JSON_PARSE' | 'FIELD_MISSING'
  | 'TITLE_TOO_SHORT' | 'TITLE_TOO_LONG'
  | 'BODY_TOO_SHORT' | 'BODY_TOO_LONG'

export type ParsedDraft =
  | { ok: true; title: string; body: string }
  | { ok: false; errorCode: ParseErrorCode; message: string }

/**
 * 모델 응답에서 제목·본문을 꺼낸다.
 *
 * 🔴 코드블록 울타리를 벗긴다. M3 에서 Haiku 5건이 ```json 때문에 전멸했다.
 * 🔴 Anthropic prefill('{') 로 앞의 중괄호가 빠진 응답도 받아들인다.
 * 🔴 길이는 여기서도 본다 — 저장한 뒤에 아는 것보다 앞이 낫다.
 */
export function parseDraft(rawText: string): ParsedDraft {
  const raw = (rawText ?? '').trim()
  if (raw === '') return { ok: false, errorCode: 'EMPTY', message: '응답이 비어 있습니다' }

  let payload = raw
  const fence = payload.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  if (fence?.[1] !== undefined) payload = fence[1].trim()

  const attempts = payload.startsWith('{') ? [payload] : [`{${payload}`, payload]

  let parsed: unknown = null
  let parsedOk = false
  for (const attempt of attempts) {
    try {
      parsed = JSON.parse(attempt)
      parsedOk = true
      break
    } catch {
      // 다음 후보로
    }
  }
  if (!parsedOk) return { ok: false, errorCode: 'JSON_PARSE', message: 'JSON 으로 읽지 못했습니다' }

  const obj = parsed as { title?: unknown; body?: unknown } | null
  if (typeof obj?.title !== 'string' || typeof obj?.body !== 'string') {
    return { ok: false, errorCode: 'FIELD_MISSING', message: 'title 또는 body 가 없습니다' }
  }

  const title = obj.title.trim()
  const body = obj.body.trim()
  const tLen = [...title].length
  const bLen = [...body].length

  if (tLen < MIN_POST_TITLE_LENGTH) {
    return { ok: false, errorCode: 'TITLE_TOO_SHORT', message: `제목 ${tLen}자 — ${MIN_POST_TITLE_LENGTH}자 이상이어야 합니다` }
  }
  if (tLen > MAX_POST_TITLE_LENGTH) {
    return { ok: false, errorCode: 'TITLE_TOO_LONG', message: `제목 ${tLen}자 — ${MAX_POST_TITLE_LENGTH}자를 넘을 수 없습니다` }
  }
  if (bLen < MIN_POST_CONTENT_LENGTH) {
    return { ok: false, errorCode: 'BODY_TOO_SHORT', message: `본문 ${bLen}자 — ${MIN_POST_CONTENT_LENGTH}자 이상이어야 합니다` }
  }
  if (bLen > MAX_POST_CONTENT_LENGTH) {
    return { ok: false, errorCode: 'BODY_TOO_LONG', message: `본문 ${bLen}자 — ${MAX_POST_CONTENT_LENGTH}자를 넘을 수 없습니다` }
  }
  return { ok: true, title, body }
}

// ─────────────────────────────────────────────────────────
// 저장 레코드 — 🔴 원문 저장 금지 계약
// ─────────────────────────────────────────────────────────

/**
 * original-post-candidates.json 한 줄.
 *
 * 🔴 rawTitle · rawBody 를 담을 자리가 **없다.** 선택적 필드로도 두지 않는다 —
 *    두면 언젠가 채워진다.
 *
 * 🔴 sourceRawContentId 는 원문이 아니라 **우리 DB 의 MicroSeedRawContent.id** 다.
 *    "어느 원문을 보고 썼는가" 만 남기고, 원문이 필요하면 그때 DB 에서 읽는다.
 *    id 는 그 자체로 아무 문장도 담지 않는다.
 */
export type OriginalPostRecord = {
  /** 🔴 우리 DB MicroSeedRawContent.id. 원문이 아니라 참조다 */
  sourceRawContentId: string
  title: string
  body: string
}

/** 🔴 저장 레코드에 허용되는 키. 이 목록 밖은 assertNoStoredSource 가 막는다 */
export const ALLOWED_RECORD_KEYS: readonly string[] = ['sourceRawContentId', 'title', 'body']

export function toOriginalPostRecord(input: {
  sourceRawContentId: string
  title: string
  body: string
}): OriginalPostRecord {
  return {
    sourceRawContentId: input.sourceRawContentId.trim(),
    title: input.title.trim(),
    body: input.body.trim(),
  }
}

/** 대조 최소 길이 — Gate ① 의 20자 유출 판정과 같은 눈금을 쓴다 */
export const SOURCE_ECHO_MIN = 20

/**
 * 🔴 유출 대조용 정규화 — **공백을 전부 지운다** (2026-09-01 7판).
 *
 * 이전에는 두 검사기가 서로 다른 눈금을 썼다:
 *   analyzeDraft          공백 제거 후 대조 (띄어쓰기 달라도 잡힘)
 *   assertNoStoredSource  공백을 한 칸으로 줄인 뒤 raw JSON 과 대조 (띄어쓰기 같아야 잡힘)
 *
 * 실측 결과 **저장 가드가 계측보다 약했다** — 띄어쓰기 한 칸만 바꾼 20자 복붙이
 * 저장 가드를 통과했다. 7판 중단은 우연히 공백까지 같아서 잡힌 것이다.
 *
 * 🔴 이 함수 하나만 쓴다. 눈금이 두 곳에 있으면 한쪽만 바뀌는 날이 오고,
 *    그날부터 "계측은 잡는데 저장은 통과" 가 다시 생긴다.
 */
export const normalizeForEcho = (s: string): string => (s ?? '').replace(/\s+/g, '')

/**
 * 대상 글에 원문(또는 말투 샘플)의 연속 20자가 몇 조각이나 들어 있는가.
 * 🔴 판정이 아니라 세는 함수다. 막는 것은 호출부의 일이다.
 */
export function sourceEchoCount(text: string, sourceTexts: readonly string[]): number {
  const draft = normalizeForEcho(text)
  if (draft.length < SOURCE_ECHO_MIN) return 0
  let hits = 0
  for (const source of sourceTexts) {
    const src = normalizeForEcho(source)
    if (src.length < SOURCE_ECHO_MIN) continue
    for (let i = 0; i + SOURCE_ECHO_MIN <= draft.length; i += 1) {
      if (src.includes(draft.slice(i, i + SOURCE_ECHO_MIN))) hits += 1
    }
  }
  return hits
}

/** 한 조각이라도 있는가. 🔴 세는 것보다 빨리 끝난다 */
export const hasSourceEcho = (text: string, sourceTexts: readonly string[]): boolean =>
  sourceEchoCount(text, sourceTexts) > 0

/** 레코드가 담고 있는 글 전체 — 허용된 세 필드를 붙인다 */
const recordText = (r: OriginalPostRecord): string =>
  `${r.sourceRawContentId}\n${r.title}\n${r.body}`

export type PartitionResult = {
  /** 저장해도 되는 것 */
  clean: OriginalPostRecord[]
  /** 🔴 원문 조각이 섞여 저장하면 안 되는 것 */
  leaking: Array<{ record: OriginalPostRecord; echoCount: number }>
}

/**
 * 🔴 **레코드별로** 가른다 (2026-09-01 7판).
 *
 * 이전에는 배치 전체를 한 덩어리로 검사해, 한 건이 걸리면 **깨끗한 나머지까지
 * 통째로 버려졌다.** 7판에서 정확히 그랬다 — 세 건 중 하나가 걸려 셋 다 사라졌고
 * 유료 호출 3회가 산출물 0건이 됐다.
 *
 * 🔴 완화가 아니다. 걸린 것은 여전히 저장하지 않는다. 버리는 범위만 좁힌 것이다.
 */
export function partitionByStoredSource(
  records: readonly OriginalPostRecord[],
  sourceTexts: readonly string[],
): PartitionResult {
  const clean: OriginalPostRecord[] = []
  const leaking: Array<{ record: OriginalPostRecord; echoCount: number }> = []
  for (const record of records) {
    const echoCount = sourceEchoCount(recordText(record), sourceTexts)
    if (echoCount > 0) leaking.push({ record, echoCount })
    else clean.push(record)
  }
  return { clean, leaking }
}

/**
 * 저장 직전 실측 방어 — 레코드 어디에도 원문 조각이 없어야 한다.
 *
 * 🔴 타입으로 이미 막았는데 왜 또 보는가.
 *    타입은 이 파일을 거쳐 갈 때만 유효하다. 호출부가 객체를 직접 만들어
 *    JSON.stringify 하면 타입은 아무것도 막지 못한다. 저장은 되돌리기 어렵다.
 *
 * @throws 원문 조각이 발견되면 Error
 */
export function assertNoStoredSource(
  records: readonly OriginalPostRecord[],
  sourceTexts: readonly string[],
): void {
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!ALLOWED_RECORD_KEYS.includes(key)) {
        throw new Error(
          `저장 레코드에 허용되지 않은 필드가 있다: ${key}\n` +
            `  original-post-candidates.json 에는 ${ALLOWED_RECORD_KEYS.join(' · ')} 만 남긴다(원문 저장 금지 계약).\n` +
            '  rawTitle · rawBody · sourceUrl · sourceSite · author 는 어느 것도 저장하지 않는다.',
        )
      }
    }
  }

  // 🔴 눈금은 normalizeForEcho 하나뿐이다. 여기서 따로 정규화하지 않는다 —
  //    그렇게 갈라져 있어서 "계측은 잡는데 저장은 통과" 가 생겼다(7판).
  for (const record of records) {
    const echo = sourceEchoCount(recordText(record), sourceTexts)
    if (echo > 0) {
      throw new Error(
        `저장 레코드에 원문 조각이 들어 있다 (연속 ${SOURCE_ECHO_MIN}자 일치 ${echo}건).\n` +
          '  원문은 저장하지 않는다 — 판정이 보기 전에 파일에 남는다.\n' +
          '  배치 저장은 partitionByStoredSource 로 걸린 레코드만 빼고 진행한다.',
      )
    }
  }
}

// ─────────────────────────────────────────────────────────
// 초안 살펴보기 — 🔴 판정이 아니다. 사람이 볼 신호만 만든다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 이것은 **Gate 가 아니다.**
 *
 * 댓글 레인의 9관문은 별도 파일(persona-comment-candidate.mts)이고,
 * 게시글용 originality gate 는 **다음 PR(B)** 의 일이다.
 * 여기서 판정까지 해 버리면 "생성기가 자기 결과를 채점" 하게 되고,
 * 그 순간 사람이 초안을 보는 단계가 사라진다.
 *
 * 그래서 상태를 돌려주지 않는다 — **세어 본 값만** 돌려준다.
 * 창업자가 "복붙처럼 보이는가 · AI 티가 나는가" 를 판단할 재료다.
 */
export type DraftSignals = {
  titleLength: number
  bodyLength: number
  /** 원문과 연속 20자 이상 겹치는 조각 수. 🔴 0 이 아니면 복붙 의심 */
  sourceEchoCount: number
  /** 원문과 공유하는 어절 비율 (0~1). 소재가 같으면 자연히 어느 정도는 겹친다 */
  sharedWordRatio: number
  /** 상투적 시작 어절을 썼는가 */
  clicheOpener: string | null
  /** 출처가 드러나는 말이 남았는가 */
  sourceMarkers: readonly string[]
  /** 금지 낱말·타겟 설명어가 남았는가 */
  bannedTerms: readonly string[]
  /** AI 구조 흔적 — 번호 목록 · 소제목 · 이모지 나열 */
  structureFlags: readonly string[]
  /**
   * 🔴 창업자 critique 에 걸린 표현 (2026-09-01).
   *    0 이 아니면 사람이 보기 전에 이미 실패다 — 실물로 걸렸던 문장들이다.
   */
  critiqueHits: readonly string[]
  /**
   * 🔴 외부 커뮤니티 호칭이 남았는가. 남으면 실패다.
   *    sourceMarkers 와 겹치지만 **따로 센다** — 호칭은 치환 정책의 대상이고,
   *    "출처가 드러났다" 와 "우리 호칭을 안 썼다" 는 고칠 곳이 다르다.
   */
  externalAddressHits: readonly string[]
  /** ✅ 우리 호칭을 썼는가. 부르는 글인데 0이면 호출이 사라진 것이다 */
  soransoranAddressHits: readonly string[]
  /** 🟡 경계 표현 — 실패로 세지 않고 따로 센다. 합치면 수치가 부푼다 */
  critiqueWatchHits: readonly string[]
  /** 🔴 링크가 남았는가. 남으면 출처가 그대로 드러난다 */
  urlHits: readonly string[]
  /**
   * 🔴 출처 흔적이 남았는가 — 서비스·게시판 이름 (2026-09-01 6판 #16).
   *
   * URL 과 **따로 센다.** 링크가 없어도 이름 한 줄이면 원문을 찾아갈 수 있다 —
   * 6판 #16 이 정확히 그랬다. 링크는 0이었는데 서비스 이름이 그대로 남았다.
   */
  originTraceHits: readonly string[]
  /**
   * 🟡 이모티콘이 줄 끝마다 **고르게** 박혔는가 (2026-09-01 5판 #14).
   *
   * 사람은 감정이 올라오는 자리에 몰아 쓰고 나머지엔 안 쓴다.
   * 줄마다 하나씩 균등하게 붙어 있으면 그건 사람이 아니라 규칙이다.
   * 🔴 판정이 아니라 신호다 — 짧은 글에서는 우연히 높게 나온다.
   */
  emoticonEvenness: number | null
}

const wordsOf = (t: string): string[] =>
  t.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length >= 2)

export function analyzeDraft(input: {
  title: string
  body: string
  sourceTexts: readonly string[]
  /** 🔴 원문이 번호 나열이면 살리는 것이 맞다. 그때는 흔적으로 세지 않는다 */
  allowNumberedList?: boolean
}): DraftSignals {
  const title = input.title.trim()
  const body = input.body.trim()
  const draft = `${title}\n${body}`
  const source = input.sourceTexts.join(' ').replace(/\s+/g, ' ').trim()

  // 🔴 유출 검사는 저장 가드와 **같은 함수**를 쓴다. 눈금이 갈라지면
  //    "계측은 잡는데 저장은 통과" 가 생긴다(7판에서 실제로 그랬다)
  const echoCount = sourceEchoCount(draft, input.sourceTexts)

  const srcWords = new Set(wordsOf(source))
  const draftWords = wordsOf(draft)
  const shared = draftWords.filter((w) => srcWords.has(w)).length
  const sharedWordRatio = draftWords.length === 0 ? 0 : shared / draftWords.length

  const firstWord = body.split(/\s+/)[0] ?? ''
  const clicheOpener = CLICHE_POST_OPENERS.find((o) => body.startsWith(o) || firstWord === o) ?? null

  const sourceMarkers = [
    ...SOURCE_SPECIFIC_TERMS.map((t) => t.term),
    ...SOURCE_CONTEXT_TERMS.filter((t) => t.tier === 'strong').map((t) => t.term),
  ].filter((t) => draft.includes(t))

  const bannedTerms = [
    ...BRAND_BANNED_WORDS,
    ...TARGET_DESCRIPTOR_TERMS,
  ].filter((t) => draft.includes(t))

  // 🔴 2026-09-01 — 번호 목록을 무조건 흔적으로 세지 않는다.
  //    원문이 번호로 나열한 글이면 그것을 살리는 것이 맞다(#7 실패의 반대편).
  //    호출부가 allowNumberedList 를 넘기면 세지 않는다.
  const structureFlags: string[] = []
  if (input.allowNumberedList !== true && /^\s*\d+[.)]\s/m.test(body)) structureFlags.push('번호 목록')
  if (/^\s*[-*·]\s/m.test(body)) structureFlags.push('불릿')
  if (/^\s*#{1,6}\s/m.test(body) || /\*\*/.test(body)) structureFlags.push('마크다운')
  if (/(\p{Extended_Pictographic}\s*){3,}/u.test(body)) structureFlags.push('이모지 나열')

  return {
    titleLength: [...title].length,
    bodyLength: [...body].length,
    sourceEchoCount: echoCount,
    sharedWordRatio,
    clicheOpener,
    sourceMarkers,
    bannedTerms,
    structureFlags,
    critiqueHits: CRITIQUE_BANNED_PHRASES.filter((x) => draft.includes(x)),
    externalAddressHits: EXTERNAL_ADDRESS_TERMS.filter((x) => draft.includes(x)),
    soransoranAddressHits: SORANSORAN_ADDRESS.filter((x) => draft.includes(x)),
    critiqueWatchHits: CRITIQUE_WATCH_PHRASES.filter((x) => draft.includes(x)),
    urlHits: (draft.match(SOURCE_URL_RE_G) ?? []).map((m) => m.trim()),
    originTraceHits: originTraceHitsIn(draft),
    emoticonEvenness: (() => {
      const lines = body.split('\n').map((l) => l.trim()).filter((l) => l !== '')
      // 🔴 줄이 3개 미만이면 분모가 너무 작아 의미 없는 값이 나온다. null 로 둔다 —
      //    0 으로 두면 "고르지 않다" 로 읽히고, 1 로 두면 "고르다" 로 읽힌다. 둘 다 거짓이다
      if (lines.length < 3) return null
      const ending = lines.filter((l) => EMOTICON_TAIL_RE.test(l)).length
      return ending / lines.length
    })(),
  }
}
