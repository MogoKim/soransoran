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
    '## 절대 하지 않는 것',
    `- 이 낱말을 쓰지 않습니다: ${BRAND_BANNED_WORDS.join(' · ')}`,
    `- 상대를 설명하는 말을 쓰지 않습니다: ${[...TARGET_DESCRIPTOR_TERMS].slice(0, 15).join(' · ')}`,
    '  (커뮤니티 안에서는 서로를 설명하지 않습니다. 그냥 말합니다)',
    `- 다루지 않는 주제: ${listOr(persona.noGoTopics, '(없음)')}`,
    `- 쓰지 않는 표현: ${listOr(persona.noGoExpressions, '(없음)')}`,
    '- 진단·처방·약 이름·용량을 말하지 않습니다. 병원에 가라 마라도 정하지 않습니다.',
    '- 원문의 표현을 그대로 옮기지 않습니다. 읽고 느낀 것을 내 말로 씁니다.',
    '- 정리된 목록·번호·소제목을 쓰지 않습니다. 사람이 쓴 댓글은 그렇게 생기지 않았습니다.',
    '- 존재하지 않는 가족을 근거로 말하지 않습니다.',
    '- 어느 카페·사이트에서 봤다는 말을 하지 않습니다.',
    '',
    '## 길이',
    `${MIN_COMMENT_LENGTH}자 이상 ${MAX_COMMENT_LENGTH}자 이하. 짧아도 괜찮습니다. 두세 문장이면 충분합니다.`,
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
