/**
 * 페르소나 댓글 생성 프롬프트 — 🔴 순수 함수. LLM · DB · 파일 IO · 네트워크 없음
 *
 * 정본: docs/operations/2026-08-30-persona-architecture-design.md §1~§10
 *       docs/operations/2026-08-30-persona-safety-originality-gate-design.md
 *
 * 🔴 이 파일은 **부르지 않는다.** 프롬프트 문자열을 만들고, 응답을 파싱하고,
 *    저장 레코드를 만드는 것까지다. 호출은 persona-comment-generate.mts 가 하고,
 *    실제 API 는 voice-m3-provider.mts 하나만 부른다(이 저장소의 단일 유료 경로).
 *
 * 🔴 **원문 저장 금지 계약**
 *    대상 글 본문(post.content)은 프롬프트에 실려 나가지만 **어디에도 저장되지 않는다.**
 *      · toCandidateRecord 가 만드는 레코드에는 personaCode · text 뿐이다.
 *        sourceTexts 를 담을 자리가 **타입에 없다** — 실수로 넣을 수 없다.
 *      · assertNoStoredSource 가 저장 직전에 실측으로 한 번 더 막는다.
 *    이유: Gate ① 이 20자 유출을 잡지만, 그건 후보 본문 대 원문의 대조다.
 *    레코드에 원문을 통째로 얹으면 Gate 가 볼 일도 없이 DB 에 남는다.
 *
 * 🔴 프롬프트 금칙어는 Gate ⑤ 와 **같은 상수**를 쓴다.
 *    Gate 파일이 직접 적어 뒀다 — *"갈래 1 실패 → 프롬프트에서 호칭 지침을 고친다 /
 *    갈래 2 실패 → 프롬프트에서 어휘를 막는다"*. 두 곳에 각각 적으면
 *    한쪽만 바뀌는 날이 오고, 그날부터 Gate 는 자기가 막는 것을 프롬프트가 시킨다.
 */
import { BRAND_BANNED_WORDS } from '../../src/lib/content-guard'
import { TARGET_DESCRIPTOR_TERMS } from './voice-style-signals.mjs'
import { MIN_COMMENT_LENGTH, MAX_COMMENT_LENGTH } from '../../src/lib/comment-policy'

/** 반응 유형 — voice-comment-signals 의 ReactionType 과 같은 값이다 */
export const REACTION_TYPES = [
  'empathy', 'question', 'rebuttal', 'experience', 'information', 'other',
] as const

export type ReactionType = (typeof REACTION_TYPES)[number]

export const isReactionType = (v: unknown): v is ReactionType =>
  typeof v === 'string' && (REACTION_TYPES as readonly string[]).includes(v)

/** 사람 말로 옮긴 반응 지침. 🔴 모델에게 코드값을 그대로 주지 않는다 */
const REACTION_GUIDE: Record<ReactionType, string> = {
  empathy: '공감. 나도 비슷했다는 마음만 짧게 전한다. 해결책을 주지 않는다.',
  question: '되묻기. 궁금한 것 하나만 자연스럽게 묻는다. 취조하듯 여러 개 묻지 않는다.',
  rebuttal: '조심스러운 다른 생각. 상대를 가르치지 않고 "저는 이랬어요" 로 둔다.',
  experience: '경험 공유. 내 이야기 한 토막만. 교훈으로 끝내지 않는다.',
  information: '아는 것 나누기. 확정적으로 말하지 않고 들은 범위로만 말한다.',
  other: '짧은 한마디. 억지로 유형을 맞추지 않는다.',
}

/** 응답 상한. 500자 댓글 + JSON 껍데기에 넉넉한 값 */
export const MAX_OUTPUT_TOKENS = 800

/**
 * 🔴 프롬프트가 권하는 길이 상한 (2026-09-01).
 *
 * 정책 상한(MAX_COMMENT_LENGTH 500)과 다른 값이다. 정책은 "여기까지 허용" 이고
 * 이것은 "이 정도로 써라" 다. 첫 생성물이 143자였고 ⑧ 말끝·시작어절 반복에 걸렸는데,
 * **길수록 같은 리듬을 반복할 자리가 는다.** 짧으면 그 자리가 줄어든다.
 */
export const PROMPT_TARGET_MAX_CHARS = 120

/**
 * 🔴 상투적 위로 — 프롬프트에서 이름을 대고 막는다 (2026-09-01).
 *
 * 이 목록은 Gate 가 잡는 것이 아니라 **AI 티 태그(OVER_EMPATHY·TONE_REPEAT)가
 * 반복해서 가리킨 자리**다. 규칙으로 막을 수 없는 것을 프롬프트로 막는다 —
 * 낱말을 금지하는 것이 아니라 "이렇게 시작하지 마라" 를 알려 준다.
 */
export const CLICHE_COMFORT_PHRASES: readonly string[] = [
  '힘내세요',
  '고생 많으셨어요',
  '고생하셨어요',
  '토닥토닥',
  '응원할게요',
  '다 지나갑니다',
  '건강 챙기세요',
  '푹 쉬세요',
]

/**
 * 🔴 상투적 첫 어절 — ⑧ HOOK 축이 보는 자리다 (2026-09-01).
 *
 * #9 가 시작어절 60% 로 걸렸다(임계 35%). 모델은 자기가 예전에 뭘 썼는지 모르므로
 * "다르게 써라" 만으로는 부족하다. **가장 자주 나오는 시작을 이름으로 막는다.**
 */
export const CLICHE_OPENERS: readonly string[] = [
  '저도',
  '맞아요',
  '그러게요',
  '어머',
  '아이고',
  '와',
]

/**
 * 🔴 첫 **글자** 회피 목록 (2026-09-01).
 *
 * 어절 단위로 막았더니 소용이 없었다 — #9·#10·#11 이 전부 같은 글자로 시작했다
 * (⑧ 시작어절 60% → 50% → 43%, 임계 35%). 어절을 바꿔도 첫 글자가 같으면
 * 같은 자리에서 말을 꺼낸 것이고, 사람 눈에는 그게 먼저 보인다.
 *
 * 🔴 실제로 쓴 표지는 recentMarks 에서 파생한다. 이 상수는 그것이 없을 때의 바닥이다.
 */
export const CLICHE_OPENER_INITIALS: readonly string[] = ['저', '맞', '그', '어', '아', '와']

/**
 * 🔴 몇 번부터 "반복" 이라 부르고 이름을 대는가 (2026-09-01).
 *
 * #12 를 부를 때 회피 목록에는 반복 글자가 **이미 들어 있었다.** 그런데도 모델은
 * 그 글자로 시작했다. 목록이 8자를 나열만 했고, 그중 무엇이 실제로 반복된 것인지
 * 표시가 없었기 때문이다 — 한 번 나온 글자와 네 번 나온 글자가 같은 무게였다.
 *
 * Gate ⑧ 은 나열을 보지 않는다. **최빈값 하나**를 본다.
 * 그래서 프롬프트도 최빈값을 지목해야 한다.
 */
export const REPEAT_CALLOUT_MIN = 2

/**
 * 🔴 첫 문장을 여는 방법 — 금지만으로는 부족하다 (2026-09-01).
 *
 * "이렇게 시작하지 마라" 만 주면 모델은 **남은 흔한 자리**로 옮겨 간다.
 * 실제로 상투적 어절을 막았더니 전부 같은 명사로 시작했다.
 * 그래서 **무엇으로 열지**를 함께 준다 — 지금 내 자리의 상황이나 감각이다.
 *
 * 🔴 예시는 '방식'을 보여줄 뿐 베껴 쓰라는 목록이 아니다.
 */
export const OPENER_STYLE_EXAMPLES: readonly string[] = [
  '설거지하다 말고',
  '창밖 보다가',
  '손이 시려워서',
  '커피 식는 줄도 모르고',
]

/**
 * 🔴 최근 발화에서 뽑은 말투 표지 (2026-09-01, A안).
 *
 * ⑧ 은 이 페르소나의 **이전 발화와 비교**해 말끝·시작어절 반복을 잡는다.
 * 그런데 모델은 자기가 예전에 뭘 썼는지 모른다 — "다르게 써라" 만으로는
 * 하필 같은 말끝을 고르면 그대로 걸린다(#10 시작어절 50%, 임계 35%).
 *
 * 🔴 **본문을 넣지 않는다.** 첫 어절과 말끝 3글자만 넣는다.
 *    본문을 넣으면 그것이 곧 이전 생성물의 재유입이고, 모델이 그걸 참고해
 *    비슷하게 쓰기 시작한다 — 막으려던 것을 부추기게 된다.
 */
export type RecentVoiceMarks = {
  /** 첫 어절 */
  openers: readonly string[]
  /** 말끝 3글자 */
  endings: readonly string[]
  /**
   * 🔴 첫 **글자**별 등장 횟수, 많은 순 (2026-09-01).
   *
   * openers 는 중복을 지우고 최근 것만 잘라 낸다 — 그 과정에서 "몇 번 썼는가" 가
   * 사라진다. 네 번 반복한 글자와 한 번 쓴 글자가 목록에서 나란히 서면
   * 모델에게는 둘이 같아 보인다. Gate ⑧ 이 세는 것은 최빈값이므로,
   * **빈도는 지우기 전에 따로 남긴다.**
   */
  openerInitials: readonly OpenerInitialCount[]
}

export type OpenerInitialCount = { initial: string; count: number }

/**
 * 🔴 추출 규칙은 Gate ⑧ 과 **같아야 한다.**
 *    persona-gate-78.mts 의 `endingOf` · `hookOf` 와 같은 규칙이다.
 *    그쪽이 export 하지 않아 여기서 같은 규칙을 쓰고, fixture 가 동등성을 잠근다 —
 *    두 규칙이 갈리면 "피하라고 준 말"과 "잡히는 말"이 달라져 아무 효과가 없다.
 */
const endingOf = (t: string): string => t.replace(/[\s.!?~ㅋㅎ,]+$/u, '').slice(-3)
const hookOf = (t: string): string => t.trim().split(/\s+/)[0] ?? ''

/** 프롬프트에 실을 최대 개수 — 너무 많으면 지시가 아니라 목록이 된다 */
export const MAX_RECENT_MARKS = 6

export function extractVoiceMarks(texts: readonly string[]): RecentVoiceMarks {
  const openers: string[] = []
  const endings: string[] = []
  /** 🔴 중복을 지우기 **전에** 센다. 지운 뒤에 세면 전부 1 이 된다 */
  const initialCount = new Map<string, number>()
  for (const raw of texts) {
    const t = (raw ?? '').trim()
    if (t === '') continue
    const h = hookOf(t)
    const e = endingOf(t)
    if (h !== '') {
      if (!openers.includes(h)) openers.push(h)
      const first = [...h][0]
      if (first !== undefined) initialCount.set(first, (initialCount.get(first) ?? 0) + 1)
    }
    if (e !== '' && !endings.includes(e)) endings.push(e)
  }
  // 🔴 최근 것이 뒤에 오므로 뒤에서 잘라 낸다 — 오래된 말투보다 최근 말투가 중요하다
  return {
    openers: openers.slice(-MAX_RECENT_MARKS),
    endings: endings.slice(-MAX_RECENT_MARKS),
    // 🔴 빈도는 자르지 않는다. 잘라 내면 최빈값이 목록 밖으로 밀려날 수 있고,
    //    그러면 Gate ⑧ 이 잡는 바로 그 글자를 프롬프트가 말하지 못한다.
    //    많은 순 · 같으면 글자순 — 순서를 고정해야 fixture 가 잠글 수 있다
    openerInitials: [...initialCount.entries()]
      .map(([initial, count]) => ({ initial, count }))
      .sort((a, b) => b.count - a.count || a.initial.localeCompare(b.initial)),
  }
}

/** Persona 행에서 프롬프트에 필요한 것만. 🔴 userId · nickname 을 받지 않는다 */
export type PromptPersona = {
  code: string
  ageBand: string | null
  region: string | null
  lifeStage: string | null
  /** Json — 7층 구조 §1. 있는 그대로 요약해 넣는다 */
  identity: unknown
  voiceCore: unknown
  voiceVariations: unknown
  noGoTopics: readonly string[]
  noGoExpressions: readonly string[]
  forbiddenReactionRoles: readonly string[]
}

/** 대상 글 — 🔴 저장되지 않는다. 프롬프트에만 실린다 */
export type PromptTargetPost = {
  title: string
  content: string
  boardLabel: string
}

export type PromptBlockCode =
  | 'PERSONA_VOICE_MISSING'
  | 'REACTION_TYPE_INVALID'
  | 'REACTION_ROLE_FORBIDDEN'
  | 'POST_TITLE_EMPTY'
  | 'POST_CONTENT_EMPTY'

export type PromptBlock = { code: PromptBlockCode; message: string }

export type BuiltPrompt = {
  systemPrompt: string
  userPayload: string
  maxOutputTokens: number
}

export type PromptPlan =
  | { ok: true; prompt: BuiltPrompt; blocks: [] }
  | { ok: false; blocks: PromptBlock[] }

/** Json 을 프롬프트에 넣을 수 있는 짧은 문자열로. 🔴 없으면 '(없음)' 이지 빈 문자열이 아니다 */
function jsonBrief(v: unknown): string {
  if (v === null || v === undefined) return '(없음)'
  if (typeof v === 'string') return v.trim() === '' ? '(없음)' : v
  try {
    const s = JSON.stringify(v)
    return s === '{}' || s === '[]' || s === 'null' ? '(없음)' : s
  } catch {
    return '(읽을 수 없음)'
  }
}

const listOr = (xs: readonly string[], fallback: string): string =>
  xs.length === 0 ? fallback : xs.join(' · ')

/**
 * 프롬프트를 만든다.
 *
 * 🔴 막을 것은 여기서 막는다 — 금지 역할로 생성을 요청하면 Gate ⑦ 이 뒤에서 잡지만,
 *    돈을 쓰고 나서 잡는 것과 쓰기 전에 막는 것은 다르다.
 */
export function buildPrompt(input: {
  persona: PromptPersona
  post: PromptTargetPost
  reactionType: string
  /** 🔴 최근 발화의 첫 어절·말끝만. 본문은 받지 않는다 (A안) */
  recentMarks?: RecentVoiceMarks
}): PromptPlan {
  const blocks: PromptBlock[] = []
  const { persona, post } = input

  if (!isReactionType(input.reactionType)) {
    blocks.push({
      code: 'REACTION_TYPE_INVALID',
      message: `알 수 없는 반응 유형: ${input.reactionType} (${REACTION_TYPES.join(' · ')})`,
    })
  } else if (persona.forbiddenReactionRoles.includes(input.reactionType)) {
    // 🔴 이 페르소나가 맡지 않기로 한 역할이다. 만들지 않는다
    blocks.push({
      code: 'REACTION_ROLE_FORBIDDEN',
      message: `${persona.code} 는 ${input.reactionType} 역할을 맡지 않습니다`,
    })
  }

  if (jsonBrief(persona.voiceCore) === '(없음)') {
    blocks.push({
      code: 'PERSONA_VOICE_MISSING',
      message: `${persona.code} 의 voiceCore 가 비어 있습니다 — 말투 없이 생성하지 않습니다`,
    })
  }
  if (post.title.trim() === '') {
    blocks.push({ code: 'POST_TITLE_EMPTY', message: '대상 글 제목이 비어 있습니다' })
  }
  if (post.content.trim() === '') {
    blocks.push({ code: 'POST_CONTENT_EMPTY', message: '대상 글 본문이 비어 있습니다' })
  }

  if (blocks.length > 0) return { ok: false, blocks }

  const reaction = input.reactionType as ReactionType
  const recentOpeners = input.recentMarks?.openers ?? []
  const recentEndings = input.recentMarks?.endings ?? []
  // 🔴 빈도를 지닌 실측 목록을 쓴다. openers 는 중복을 지우고 잘라 낸 뒤라
  //    최빈 글자가 빠져 있을 수 있다 — 회피 목록의 근거를 그쪽에 두면 안 된다.
  //    (?? [] 는 이 파일을 거치지 않고 객체를 직접 만든 호출부에 대한 방어다)
  const recentInitials = input.recentMarks?.openerInitials ?? []
  // 🔴 실측으로 반복된 글자. 나열이 아니라 **이름을 대고** 막을 대상이다
  const repeatedInitials = recentInitials.filter((e) => e.count >= REPEAT_CALLOUT_MIN)
  const topRepeat = repeatedInitials[0]
  // 🔴 최근에 쓴 첫 **글자** + 상투적 시작 글자를 합쳐 막는다.
  //    #9·#10·#11 이 어절은 달라도 같은 글자로 시작했다 — 어절만 막아서는 안 됐다.
  const avoidInitials = [...new Set([
    ...recentInitials.map((e) => e.initial),
    ...CLICHE_OPENER_INITIALS,
  ])]

  const systemPrompt = [
    '당신은 한국의 40~60대 여성 커뮤니티에서 활동하는 한 사람입니다.',
    '아래 설정은 당신 자신입니다. 연기하는 것이 아니라 그 사람으로서 댓글 하나를 씁니다.',
    '',
    '## 당신',
    `나이대: ${persona.ageBand ?? '(설정 없음)'}`,
    `사는 곳: ${persona.region ?? '(설정 없음)'} (🔴 시·구 이름을 쓰지 않습니다)`,
    `생애 단계: ${persona.lifeStage ?? '(설정 없음)'}`,
    `삶의 설정: ${jsonBrief(persona.identity)}`,
    '',
    '## 말투 (반드시 지킵니다)',
    `기본: ${jsonBrief(persona.voiceCore)}`,
    `상황별 변주: ${jsonBrief(persona.voiceVariations)}`,
    '',
    '## 이번에 쓸 반응',
    REACTION_GUIDE[reaction],
    '',
    '## 🔴 원문을 옮기지 않습니다 (가장 중요)',
    '윗글에 나온 표현을 **한 조각도 그대로 쓰지 않습니다.** 말을 살짝 바꿔 옮기는 것도 안 됩니다.',
    '특히 그 사람만의 독특한 말("새벽 세시쯤", "아침이 무겁다" 같은 구체적인 묘사)은',
    '따라 쓰지 말고, 읽고 **내 안에 남은 느낌만** 내 말로 적습니다.',
    '증상·시간·상황을 되풀이해 요약하지 않습니다. 그건 읽었다는 표시일 뿐 반응이 아닙니다.',
    '',
    '## 🔴 말투가 반복되지 않게 합니다',
    `- 이런 말로 시작하지 않습니다: ${CLICHE_OPENERS.join(' · ')}`,
    '  (다들 이렇게 시작합니다. 다른 자리에서 말을 꺼내세요)',
    '- 문장이 둘이면 **말끝을 서로 다르게** 씁니다. 같은 어미로 두 번 끝내지 않습니다.',
    '- 아래 말은 쓰지 않습니다. 너무 많이 쓰여 아무 말도 아니게 된 표현입니다.',
    `  ${CLICHE_COMFORT_PHRASES.join(' · ')}`,
    '- 위 말투 설정은 **버릇**이지 틀이 아닙니다. 같은 리듬을 매번 반복하면 기계로 읽힙니다.',
    // 🔴 A안 — 최근에 쓴 말투를 알려 주고 피하게 한다.
    //    본문이 아니라 첫 어절·말끝만이다.
    ...(recentOpeners.length > 0
      ? [`- 최근에 **이렇게 시작했습니다**: ${recentOpeners.join(' · ')}`,
         '  이번에는 다른 말로 시작하세요.']
      : []),
    // 🔴 글자 단위 회피 지시는 여기 두지 않는다 — 아래 "첫 문장을 여는 방법" 으로 옮겼다.
    //    #12 가 그 이유다. 여기서 막은 글자를 아래 "상황이나 감각으로 열어라" 가
    //    도로 불러왔고, 모델은 더 구체적이고 더 나중인 쪽을 따랐다.
    //    두 지시를 붙여 두면 충돌한 채로 남지 않는다.
    ...(recentEndings.length > 0
      ? [`- 최근에 **이렇게 끝냈습니다**: ${recentEndings.join(' · ')}`,
         '  이번에는 다른 말끝으로 끝내세요.']
      : []),
    '',
    '## 절대 하지 않는 것',
    `- 이 낱말을 쓰지 않습니다: ${BRAND_BANNED_WORDS.join(' · ')}`,
    `- 상대를 설명하는 말을 쓰지 않습니다: ${[...TARGET_DESCRIPTOR_TERMS].slice(0, 15).join(' · ')}`,
    '  (커뮤니티 안에서는 서로를 설명하지 않습니다. 그냥 말합니다)',
    `- 다루지 않는 주제: ${listOr(persona.noGoTopics, '(없음)')}`,
    `- 쓰지 않는 표현: ${listOr(persona.noGoExpressions, '(없음)')}`,
    '- 진단·처방·약 이름·용량을 말하지 않습니다. 병원에 가라 마라도 정하지 않습니다.',
    '- 방법을 알려주지 않습니다. 무엇이 좋다 나쁘다 판단하지 않습니다.',
    '  묻지 않은 정보를 얹지 않습니다 — 여기는 답하는 자리가 아니라 곁에 있는 자리입니다.',
    '- 정리된 목록·번호·소제목을 쓰지 않습니다. 사람이 쓴 댓글은 그렇게 생기지 않았습니다.',
    '- 존재하지 않는 가족을 근거로 말하지 않습니다.',
    '- 어느 카페·사이트에서 봤다는 말을 하지 않습니다.',
    '',
    '## 길이',
    `한두 문장. ${PROMPT_TARGET_MAX_CHARS}자를 넘기지 않습니다 (많아야 ${MAX_COMMENT_LENGTH}자).`,
    `${MIN_COMMENT_LENGTH}자짜리 한마디도 괜찮습니다. 길게 쓸수록 사람 말에서 멀어집니다.`,
    '',
    // 🔴 금지만 주면 모델은 **남은 흔한 자리**로 옮겨 간다.
    //    상투적 어절을 막았더니 셋 다 같은 명사로 시작했다(⑧ 시작어절 60→50→43%).
    //    무엇으로 열지를 함께 준다.
    '## 🔴 첫 문장을 여는 방법',
    '감탄이나 동의로 열지 않습니다. 상대 말을 받아 적는 것으로도 열지 않습니다.',
    '대신 **지금 내 자리의 짧은 상황이나 감각**으로 엽니다.',
    `예를 들면 이런 방식입니다: ${OPENER_STYLE_EXAMPLES.join(' / ')}`,
    '(예시를 그대로 쓰지 말고, 방식만 가져가세요)',
    '🔴 윗글의 상황을 요약해서 여는 것은 안 됩니다. 그건 반응이 아니라 되풀이입니다.',
    '',
    // 🔴 회피 지시를 바로 여기 붙인다 (2026-09-01).
    //    위쪽 반복 섹션에 두었을 때 이 문단이 그것을 덮었다 —
    //    "상황이나 감각으로 열어라" 의 자연스러운 착지점이 하필 막아 둔 글자였다.
    //    금지와 대안은 같은 자리에서 읽혀야 한다.
    ...(topRepeat !== undefined
      ? [
          `🔴 **직전까지 "${topRepeat.initial}…" 으로 ${topRepeat.count}번 시작했습니다.**`,
          '   이번에는 이 글자로 열면 안 됩니다. 상황이나 감각으로 열되,',
          '   **그 장면을 다른 데서 고르세요** — 같은 장면으로 돌아가면 같은 글자가 나옵니다.',
          '   떠오른 첫 문장이 이 글자로 시작하면, 그건 버리고 다시 고릅니다.',
          ...(repeatedInitials.length > 1
            ? [`   같은 이유로 이 글자들도 반복됐습니다: ${repeatedInitials
                .slice(1)
                .map((e) => `${e.initial}(${e.count}회)`)
                .join(' · ')}`]
            : []),
        ]
      : []),
    `🔴 **이 글자로 시작하지 않습니다**: ${avoidInitials.join(' · ')}`,
    '   어절을 바꿔도 첫 글자가 같으면 같은 자리에서 말을 꺼낸 것입니다.',
    '   쓰고 나서 첫 글자를 확인하고, 목록에 있으면 첫 문장을 다시 씁니다.',
    '',
    '## 사람이 한 말처럼',
    // 🔴 이전 판에서 "생활 조각이 없으면 얹지 않습니다" 라고 썼더니
    //    생활 흔적을 **빼는 쪽**으로 작동해 NO_LIFE_MARKS 가 붙었다(#10).
    //    없는 경험을 만들지 말라는 뜻이었는데 "아무것도 쓰지 말라" 로 읽힌 것이다.
    //    금지가 아니라 **무엇을 쓰라**로 바꾼다.
    '없는 경험을 지어내지 않습니다. 설정에 없는 일을 겪은 척하지 않습니다.',
    '대신 그 순간의 **감각이나 상황 한 조각**은 남깁니다 —',
    '지금 뭘 하다 이 글을 봤는지, 읽고 어떤 기분이 스쳤는지 정도면 됩니다.',
    '말끝을 다듬지 말고 평소 말하듯 씁니다. 완성된 문장이 아니어도 괜찮습니다.',
    '',
    '## 출력 형식',
    '설명 없이 JSON 하나만 출력합니다. 코드블록으로 감싸지 않습니다.',
    '{"comment": "여기에 댓글 본문"}',
  ].join('\n')

  const userPayload = [
    `게시판: ${post.boardLabel}`,
    `제목: ${post.title.trim()}`,
    '본문:',
    post.content.trim(),
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

export type ParsedCandidate =
  | { ok: true; text: string }
  | { ok: false; errorCode: 'EMPTY' | 'JSON_PARSE' | 'FIELD_MISSING' | 'TOO_SHORT' | 'TOO_LONG'; message: string }

/**
 * 모델 응답에서 댓글 본문을 꺼낸다.
 *
 * 🔴 코드블록 울타리를 벗긴다. M3 에서 Haiku 5건이 ```json 때문에 전멸했다.
 * 🔴 Anthropic prefill('{') 로 앞의 중괄호가 빠진 응답도 받아들인다.
 * 🔴 길이는 여기서도 본다 — 저장한 뒤 Gate 가 잡는 것보다 앞이 낫다.
 */
export function parseCandidate(rawText: string): ParsedCandidate {
  const raw = (rawText ?? '').trim()
  if (raw === '') return { ok: false, errorCode: 'EMPTY', message: '응답이 비어 있습니다' }

  // ``` 또는 ```json 울타리 제거
  let body = raw
  const fence = body.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  if (fence?.[1] !== undefined) body = fence[1].trim()

  // prefill 로 여는 중괄호가 빠진 경우
  const candidates = body.startsWith('{') ? [body] : [`{${body}`, body]

  let parsed: unknown = null
  let parsedOk = false
  for (const attempt of candidates) {
    try {
      parsed = JSON.parse(attempt)
      parsedOk = true
      break
    } catch {
      // 다음 후보로
    }
  }
  if (!parsedOk) {
    return { ok: false, errorCode: 'JSON_PARSE', message: 'JSON 으로 읽지 못했습니다' }
  }

  const value = (parsed as { comment?: unknown } | null)?.comment
  if (typeof value !== 'string') {
    return { ok: false, errorCode: 'FIELD_MISSING', message: 'comment 필드가 없습니다' }
  }

  const text = value.trim()
  const len = [...text].length
  if (len < MIN_COMMENT_LENGTH) {
    return { ok: false, errorCode: 'TOO_SHORT', message: `${len}자 — ${MIN_COMMENT_LENGTH}자 이상이어야 합니다` }
  }
  if (len > MAX_COMMENT_LENGTH) {
    return { ok: false, errorCode: 'TOO_LONG', message: `${len}자 — ${MAX_COMMENT_LENGTH}자를 넘을 수 없습니다` }
  }
  return { ok: true, text }
}

// ─────────────────────────────────────────────────────────
// 저장 레코드 — 🔴 원문 저장 금지 계약
// ─────────────────────────────────────────────────────────

/**
 * candidates.json 한 줄.
 *
 * 🔴 sourceTexts 를 담을 자리가 **없다.** 선택적 필드로도 두지 않는다 —
 *    두면 언젠가 채워진다. Gate 판정에 필요한 source 는 런타임에만 넘긴다.
 *
 * 🔴 sourcePostId 는 원문이 아니라 **우리 DB 의 Post id** 다 (2026-09-01).
 *    Gate ① 은 원문 대조가 필요한데 파일에 원문을 두지 않기로 했으므로,
 *    "어느 글을 보고 썼는가" 만 남기고 원문은 판정할 때 DB 에서 읽는다.
 *    id 는 그 자체로 아무 문장도 담지 않는다 —
 *    PersonaApprovalQueue.targetPostId 가 이미 같은 판단을 하고 있다.
 */
export type CandidateRecord = {
  personaCode: string
  text: string
  /** 🔴 우리 DB Post.id. 원문이 아니라 참조다 */
  sourcePostId: string
}

/** 🔴 저장 레코드에 허용되는 키. 이 목록 밖은 assertNoStoredSource 가 막는다 */
export const ALLOWED_RECORD_KEYS: readonly string[] = ['personaCode', 'text', 'sourcePostId']

export function toCandidateRecord(input: {
  personaCode: string
  text: string
  sourcePostId: string
}): CandidateRecord {
  return {
    personaCode: input.personaCode,
    text: input.text.trim(),
    sourcePostId: input.sourcePostId.trim(),
  }
}

/** 대조 최소 길이 — Gate ① 의 20자 유출 판정과 같은 눈금을 쓴다 */
export const SOURCE_ECHO_MIN = 20

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
  records: readonly CandidateRecord[],
  sourceTexts: readonly string[],
): void {
  const serialized = JSON.stringify(records)

  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!ALLOWED_RECORD_KEYS.includes(key)) {
        throw new Error(
          `저장 레코드에 허용되지 않은 필드가 있다: ${key}\n` +
            `  candidates.json 에는 ${ALLOWED_RECORD_KEYS.join(' · ')} 만 남긴다(원문 저장 금지 계약).\n` +
            '  sourceTexts · sourceUrl · sourceRef · author · rawContent 는 어느 것도 저장하지 않는다.',
        )
      }
    }
  }

  for (const source of sourceTexts) {
    const s = (source ?? '').replace(/\s+/g, ' ').trim()
    if (s.length < SOURCE_ECHO_MIN) continue
    // 🔴 원문 전체가 아니라 **연속 20자 조각**을 본다. 전체 일치만 보면
    //    앞뒤 한 글자만 달라도 통과한다.
    for (let i = 0; i + SOURCE_ECHO_MIN <= s.length; i += 1) {
      const chunk = s.slice(i, i + SOURCE_ECHO_MIN)
      if (serialized.includes(chunk)) {
        throw new Error(
          `저장 레코드에 원문 조각이 들어 있다 (연속 ${SOURCE_ECHO_MIN}자 일치).\n` +
            '  원문은 저장하지 않는다 — Gate 가 보기 전에 DB 에 남는다.',
        )
      }
    }
  }
}
