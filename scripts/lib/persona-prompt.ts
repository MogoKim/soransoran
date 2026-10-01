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
import { promptNoGoExpressions } from '../../src/lib/persona-no-go'
import { TARGET_DESCRIPTOR_TERMS } from './voice-style-signals.mjs'
import { MIN_COMMENT_LENGTH, MAX_COMMENT_LENGTH } from '../../src/lib/comment-policy'
import type { VoiceReferenceBundle } from '../../src/lib/persona-voice-reference'

/** 반응 유형 — voice-comment-signals 의 ReactionType 과 같은 값이다 */
/**
 * 🔴 어휘 정본은 `src/lib/persona-reaction-roles.ts` 로 올렸다 (2026-09-09).
 *
 *    댓글 분산 planner 가 `share` 를 배정하고 생성기가 그것을 거부하는 일이 있었다 —
 *    계획과 생성이 다른 낱말을 쓰고 있었다. 어휘가 두 곳에 있으면 언젠가 갈린다.
 *    여기서는 다시 내보내기만 한다. 값을 여기 다시 적지 않는다.
 */
export { REACTION_TYPES, isReactionType, type ReactionType } from '../../src/lib/persona-reaction-roles'
import { REACTION_TYPES, isReactionType, type ReactionType } from '../../src/lib/persona-reaction-roles'

/** 사람 말로 옮긴 반응 지침. 🔴 모델에게 코드값을 그대로 주지 않는다 */
const REACTION_GUIDE: Record<ReactionType, string> = {
  /**
   * 🔴 **"나도 비슷했다" 를 지웠다** (2026-09-10, 창업자 판정 A).
   *    그 한 줄이 **자기 경험을 요구**했다. 겪은 일이 없는 Persona 는
   *    시키는 대로 하려고 없는 경험을 만들었다(7/18).
   *    공감은 상대의 일에 마음을 두는 것이지 내 일을 꺼내는 것이 아니다.
   */
  empathy: '공감. 그 마음이 어떨지에 머문다. 내 이야기를 꺼내지 않아도 된다. 해결책을 주지 않는다.',
  /** 🔴 정말 물을 것이 있을 때만 쓴다 — 없으면 질문을 지어내지 않는다 */
  question: '되묻기. **정말 궁금한 것이 있을 때만** 하나 묻는다.'
    + ' 물을 것이 없으면 묻지 말고 한마디만 남긴다. 취조하듯 여러 개 묻지 않는다.',
  rebuttal: '조심스러운 다른 생각. 상대를 가르치지 않고 "저는 이랬어요" 로 둔다.',
  experience: '경험 공유. 내 이야기 한 토막만. 교훈으로 끝내지 않는다.',
  information: '아는 것 나누기. 확정적으로 말하지 않고 들은 범위로만 말한다.',
  /**
   * 🔴 **기본 역할이다** (실측: 실제 댓글의 81.3%).
   *    억지로 공감이나 질문으로 만들지 않는다.
   */
  other: '그냥 한마디. 읽고 든 생각을 한 줄로 남긴다.'
    + ' 공감으로도 질문으로도 만들지 않는다 — 할 말이 그것뿐이면 그것으로 끝낸다.',
}

/** 응답 상한. 500자 댓글 + JSON 껍데기에 넉넉한 값 */
export const MAX_OUTPUT_TOKENS = 800

/**
 * 🔴 **고정 목표 길이를 두지 않는다** (2026-09-10, Wave E 정정).
 *
 *    옛 판에는 `PROMPT_TARGET_MAX_CHARS = 120` 과 "한두 문장" 이 있었다.
 *    근거는 "길수록 같은 리듬을 반복할 자리가 는다" 였는데,
 *    실제 사람 댓글 1,566건을 재보니 **120자를 넘는 것이 15.6%,
 *    문장이 둘을 넘는 것이 42.1%** 였다. 사람의 분포를 절반쯤 잘라내고 있었다.
 *
 *    길이는 이제 **참고 댓글의 관찰된 분포**로 전한다(`VoiceReferenceBundle.lengths`).
 *    `MAX_COMMENT_LENGTH` 는 운영 절대 상한일 뿐 목표가 아니다.
 */

/**
 * 🔴 상투적 위로 — 프롬프트에서 이름을 대고 막는다 (2026-09-01).
 *
 * 이 목록은 Gate 가 잡는 것이 아니라 **AI 티 태그(OVER_EMPATHY·TONE_REPEAT)가
 * 반복해서 가리킨 자리**다.
 *
 * 🔴 **이것만 남긴 이유** (2026-09-10 재검증). 다른 금지는 실제 댓글과 어긋나 지웠지만,
 *    이 여덟은 실측 사용률이 0~0.70% 다 — 사람도 거의 쓰지 않는다.
 *    막아도 사람의 분포를 깎지 않는다. **근거가 있는 금지만 남긴다.**
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
 * 🔴 **첫 어절·첫 글자 회피 규칙을 없앴다** (2026-09-10, Wave E 정정).
 *
 *    옛 판은 `저도 · 맞아요 · 그러게요 · 어머 · 아이고 · 와` 로 시작하지 못하게 했고,
 *    나중에는 **첫 글자**(`저 맞 그 어 아 와`)까지 막았다.
 *    실측: 실제 사람 댓글의 **19.2%가 그 글자로 시작한다**(`저도` 만 3.51%).
 *    사람이 가장 많이 쓰는 자리를 막으니 모델은 **남은 자리**로 밀려났고,
 *    그 자리가 하필 아래의 "생활 장면" 이었다.
 *
 *    🔴 **금지를 다른 금지로 바꾸지 않는다.** 자리를 비우고 참고 댓글로 채운다.
 *
 * 🔴 `OPENER_STYLE_EXAMPLES`(`설거지하다 말고` · `창밖 보다가` · `커피 식는 줄도 모르고`)도
 *    함께 지웠다. 실측: 그런 식으로 여는 실제 댓글은 1,566건 중 **0건**이다.
 *    존재하지 않는 패턴을 예시로 주고 있었다 —
 *    창업자 채점 메모의 *"빨래 개다 말고 문득 생각나서 ← 이딴 거 왜 있는 거야"* 가 그 결과다.
 */

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
  | 'REFERENCE_MISSING'

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
  /**
   * 🔴 **말투 근거 — 규칙보다 이것이 먼저다** (2026-09-10, Wave E).
   *    없으면 옛 방식(설정만 보고 창작)으로 돌아간다. 그래서 없으면 막는다.
   */
  reference?: VoiceReferenceBundle
  /** 🔴 기본은 강제다. 끄는 쪽이 명시해야 한다 */
  requireReference?: boolean
  /**
   * 🔴 **Persona 가 실제로 들고 있는 사실** (memory · identity) — P0-1.
   *    비어 있으면 프롬프트가 "자기 이야기를 지어내지 마라" 로 바뀐다.
   *    🔴 참고 댓글은 여기 들어가지 않는다.
   */
  grounding?: string
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
  /**
   * 🔴 **말투 근거 없이 만들지 않는다** (2026-09-10).
   *    근거를 빼면 모델은 추상적인 설정만 보고 그럴듯한 문장을 창작한다 —
   *    그것이 `20260909-181515` 회차에서 20건이 서로 비슷했던 이유다.
   *    `requireReference: false` 는 근거 자산이 없는 곳(단위 시험)에서만 쓴다.
   */
  if (input.requireReference !== false
    && (input.reference === undefined || input.reference.comments.length === 0)) {
    blocks.push({
      code: 'REFERENCE_MISSING',
      message: `${persona.code}: 말투 근거(reference)가 없습니다 — 설정만 보고 창작하지 않습니다`,
    })
  }

  if (blocks.length > 0) return { ok: false, blocks }

  const reaction = input.reactionType as ReactionType
  const recentOpeners = input.recentMarks?.openers ?? []
  const recentEndings = input.recentMarks?.endings ?? []
  const ref = input.reference
  /**
   * 🔴 **길이는 관찰값으로 전한다.** 목표를 숫자 하나로 주면 전부 그 길이가 된다 —
   *    옛 판의 120자가 그랬다. 분포를 주고 "맞출 필요 없다" 고 말한다.
   */
  const lengthLine = ref !== undefined && ref.lengths.count > 0
    ? `참고 댓글은 짧게는 ${ref.lengths.p25}자, 보통 ${ref.lengths.median}자쯤,`
      + ` 긴 것은 ${ref.lengths.p90}자 넘게도 씁니다.`
    : '할 말의 크기에 맞춥니다.'

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
    // 🔴 **말투 근거를 규칙보다 먼저 둔다** (2026-09-10).
    //    아래 규칙 목록이 위에 있으면 모델은 규칙을 맞추는 쪽으로 쓴다.
    //    사람의 말은 규칙에서 나오지 않고 다른 사람의 말에서 온다.
    ...(ref !== undefined && ref.comments.length > 0
      ? [
        '## 🔴 말투는 아래 실제 댓글에서 가져옵니다 (가장 중요)',
        '같은 또래가 실제로 쓴 댓글입니다. 규칙 목록보다 **이 댓글들이 먼저**입니다.',
        '어휘 · 생략 · 문장 길이 · 호흡 · 질문하는 방식 · 공감의 세기를 여기서 가져오세요.',
        '짧은 표현이나 말버릇은 가깝게 가져와도 됩니다.',
        // 🔴 **"통째로 옮기지 마라" 를 지웠다** (2026-09-10, P0-2 창업자 결정).
        //    맥락과 사실이 맞으면 표현·문장 구조를 가깝게 써도 된다.
        //    막을 것은 길이가 아니라 **남의 경험을 내 것으로 옮기는 것**이다(아래 절).
        '표현이나 문장 구조가 가까워도 괜찮습니다. 자연스러우면 그대로 쓰세요.',
        '',
        ...ref.comments.map((c) => `- ${c.text}`),
        '',
      ]
      : []),
    '## 말투 설정 (버릇이지 틀이 아닙니다)',
    `기본: ${jsonBrief(persona.voiceCore)}`,
    `상황별 변주: ${jsonBrief(persona.voiceVariations)}`,
    '🔴 이 설정과 위 실제 댓글이 어긋나 보이면 **실제 댓글 쪽**을 따릅니다.',
    '',
    '## 이번에 쓸 반응',
    REACTION_GUIDE[reaction],
    '',
    // 🔴 길이 — 고정 목표를 주지 않는다. 분포를 주고 맞추지 말라고 말한다
    '## 길이',
    lengthLine,
    '맞출 필요는 없습니다. 할 말이 짧으면 한 줄이면 되고,',
    '맥락이 필요하면 두세 문장으로 써도 됩니다. 매번 같은 길이로 쓰지 않습니다.',
    `(운영 상한 ${MAX_COMMENT_LENGTH}자 · 최소 ${MIN_COMMENT_LENGTH}자 — 목표가 아니라 한계입니다)`,
    '',
    '## 🔴 원문을 옮기지 않습니다',
    '윗글에 나온 표현을 **한 조각도 그대로 쓰지 않습니다.** 말을 살짝 바꿔 옮기는 것도 안 됩니다.',
    '특히 그 사람만의 독특한 말("새벽 세시쯤", "아침이 무겁다" 같은 구체적인 묘사)은',
    '따라 쓰지 말고, 읽고 **내 안에 남은 느낌만** 내 말로 적습니다.',
    '증상·시간·상황을 되풀이해 요약하지 않습니다. 그건 읽었다는 표시일 뿐 반응이 아닙니다.',
    '',
    // 🔴 **지어내지 않기** — 옛 판이 "지금 뭘 하다 이 글을 봤는지" 를 요구했다.
    //    그것이 없는 장면을 만들게 했다. 요구를 없애고 금지만 남긴다.
    // 🔴 **생성 계획과 후보 검증이 같은 계약을 쓴다** (2026-09-10, P0-1).
    //    `judgeExperienceGrounding` 이 검증에서 잡는 것을 여기서 미리 말한다.
    //    두 곳에 각각 적으면 언젠가 갈리고, 그날부터 프롬프트가 막는 것을 Gate 가 통과시킨다.
    '## 내 이야기를 할 수 있는 범위',
    ...(input.grounding !== undefined && input.grounding.trim() !== ''
      ? [
        '아래는 **당신이 실제로 겪은 일**입니다. 이 안에서라면 자기 이야기를 해도 됩니다.',
        input.grounding.trim(),
        '🔴 여기 없는 일은 겪지 않았습니다.',
      ]
      : [
        '🔴 **당신에게는 아직 들려줄 자기 이야기가 없습니다.**',
        '   겪은 일, 가족 이야기, 아팠던 일, 가 본 곳, 오래 남은 감정을',
        '   **새로 지어내서 말하지 않습니다.**',
        '   "저도 그랬어요" 처럼 짧게 맞장구치는 것은 괜찮습니다 —',
        '   맞장구는 새 사실을 보태지 않기 때문입니다.',
        '   그 대신 **윗글에 직접 반응**하거나 궁금한 것을 물으면 됩니다.',
      ]),
    '',
    // 🔴 근거가 있든 없든 **항상** 말한다 — 두 갈래 중 한쪽만 두면 계약이 갈린다
    '🔴 쓸 상황이 없으면 만들지 말고, **윗글에 직접 반응하면 됩니다.**',
    '   짧은 맞장구도, 궁금한 것 하나를 묻는 것도 모두 괜찮습니다.',
    '',
    '## 참고 댓글은 말투 근거입니다',
    '🔴 위 참고 댓글에 담긴 **그 사람들의 경험은 당신의 경험이 아닙니다.**',
    '   말하는 방식·호흡·표현만 가져오고, 그들이 겪은 일을 자기 일처럼 옮기지 않습니다.',
    '',
    '## 절대 하지 않는 것',
    `- 이 낱말을 쓰지 않습니다: ${BRAND_BANNED_WORDS.join(' · ')}`,
    `- 상대를 설명하는 말을 쓰지 않습니다: ${[...TARGET_DESCRIPTOR_TERMS].slice(0, 15).join(' · ')}`,
    '  (커뮤니티 안에서는 서로를 설명하지 않습니다. 그냥 말합니다)',
    `- 다루지 않는 주제: ${listOr(persona.noGoTopics, '(없음)')}`,
    // 🔴 개인 말버릇(열쇠) + 전원 공통 금지(§7-2) — `persona-no-go` 하나
    `- 쓰지 않는 표현: ${promptNoGoExpressions(persona.noGoExpressions).join(' · ')}`,
    '- 진단·처방·약 이름·용량을 말하지 않습니다. 병원에 가라 마라도 정하지 않습니다.',
    '- 방법을 알려주지 않습니다. 무엇이 좋다 나쁘다 판단하지 않습니다.',
    '  묻지 않은 정보를 얹지 않습니다 — 여기는 답하는 자리가 아니라 곁에 있는 자리입니다.',
    '- 정리된 목록·번호·소제목을 쓰지 않습니다. 사람이 쓴 댓글은 그렇게 생기지 않았습니다.',
    '- 존재하지 않는 가족을 근거로 말하지 않습니다.',
    '- 어느 카페·사이트에서 봤다는 말을 하지 않습니다.',
    // 🔴 실측 사용률 0~0.70% — 사람도 거의 쓰지 않는다. 막아도 분포를 깎지 않는다
    '- 아래 말은 쓰지 않습니다. 너무 많이 쓰여 아무 말도 아니게 된 표현입니다.',
    `  ${CLICHE_COMFORT_PHRASES.join(' · ')}`,
    '',
    // 🔴 자기 반복만 남긴다. 첫 글자 회피·어미 미세 통제는 지웠다(실측 근거는 파일 머리 주석)
    ...(recentOpeners.length > 0 || recentEndings.length > 0
      ? [
        '## 직전에 쓴 말과 겹치지 않게',
        ...(recentOpeners.length > 0 ? [`- 최근에 이렇게 시작했습니다: ${recentOpeners.join(' · ')}`] : []),
        ...(recentEndings.length > 0 ? [`- 최근에 이렇게 끝냈습니다: ${recentEndings.join(' · ')}`] : []),
        '  같은 말로 또 열거나 닫지만 않으면 됩니다. 그 밖에는 자유롭게 씁니다.',
        '',
      ]
      : []),
    '## 사람이 한 말처럼',
    '말끝을 다듬지 말고 평소 말하듯 씁니다. 완성된 문장이 아니어도 괜찮습니다.',
    '문장을 반듯하게 마무리하려 애쓰지 않습니다 — 너무 잘 쓰면 사람이 쓴 것으로 읽히지 않습니다.',
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
