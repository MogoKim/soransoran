/**
 * Persona-first 댓글 **생성 입력 계약** — 🔴 순수 함수. DB · 네트워크 · 파일 IO 없음
 *
 * 🔴 **왜 필요한가.**
 *
 *    지금 생성기는 persona 의 identity·voiceCore 를 프롬프트에 넣는다. 거기까지는 맞다.
 *    그런데 **말투 근거**를 그 Persona 가 과거에 쓴 댓글에서만 뽑는다.
 *    실측하면 24명 중 댓글이 있는 Persona 는 **1명**이다 —
 *    나머지 23명은 말투 근거가 통째로 비어 있고, 그러면 남는 것은 공통 프롬프트뿐이다.
 *    displayName 만 바뀐 같은 목소리가 24개 생긴다.
 *
 *    그래서 말투 근거의 출처를 **Voice 자산(VoiceDerived · VoiceCommentSignal)** 까지 넓히고,
 *    Persona 마다 **실제로 다른 입력**이 만들어졌는지를 이 파일이 판정한다.
 *
 * 🔴 **없는 것을 지어내지 않는다.** Memory 가 없으면 "없다" 고 적는다.
 *    비어 있는 자리를 그럴듯한 문장으로 채우면, 그 문장이 곧 그 Persona 의 거짓 과거가 된다.
 *
 * 🔴 `advice` · `caution` 전면 금지와 의료·법률·투자 단정 금지는 기존 Gate 계약 그대로다.
 *    이 파일은 그 정책을 **완화하지 않는다** — 입력 단계에서 한 번 더 못박는다.
 */

/** 🔴 이번 범위에서 만들지 않는 반응 역할. 기존 정책 그대로다 */
export const FORBIDDEN_REACTION_ROLES: readonly string[] = ['advice', 'caution']

/** Voice 자산에서 뽑은 말투 근거 — 🔴 원문이 아니라 **표지**만 담는다 */
export type VoiceEvidence = {
  /** 어디서 왔는가 */
  source: 'persona-comments' | 'voice-derived' | 'voice-comment-signal' | 'none'
  /** 문장 시작 어절 표지 */
  openers: readonly string[]
  /** 말끝 표지 */
  endings: readonly string[]
  /** 문장부호 습관 요약 */
  punctuation: readonly string[]
  /** 근거가 된 발화 수 */
  sampleCount: number
}

export type MemoryState =
  | { has: false; note: string }
  | { has: true; summary: string }

export type CommentInputPersona = {
  code: string
  ageBand: string | null
  region: string | null
  lifeStage: string | null
  identity: unknown
  voiceCore: unknown
  voiceVariations: unknown
  noGoTopics: readonly string[]
  noGoExpressions: readonly string[]
  forbiddenReactionRoles: readonly string[]
}

export type CommentInputPost = {
  id: string
  title: string
  /** 🔴 요약이다. 전문을 그대로 싣지 않는다 */
  bodyDigest: string
  boardLabel: string
  /** 이미 달린 댓글의 **문맥** — 원문이 아니라 짧은 요약이다 */
  existingCommentDigests: readonly string[]
}

export type InputBlockCode =
  | 'REACTION_ROLE_FORBIDDEN_GLOBAL'
  | 'REACTION_ROLE_FORBIDDEN_PERSONA'
  | 'VOICE_EVIDENCE_MISSING'
  | 'PERSONA_IDENTITY_MISSING'
  | 'PERSONA_VOICE_MISSING'
  | 'PERSONA_LIFESTAGE_MISSING'
  | 'POST_DIGEST_EMPTY'

export type InputBlock = { code: InputBlockCode; message: string }

/** 생성기에 넘길 단일 정본 */
export type CommentInput = {
  personaCode: string
  reactionRole: string
  persona: CommentInputPersona
  post: CommentInputPost
  voice: VoiceEvidence
  memory: MemoryState
  /** 🔴 이 입력이 이 Persona 고유인지 판별하는 지문 */
  fingerprint: string
}

export type CommentInputPlan =
  | { ok: true; input: CommentInput }
  | { ok: false; blocks: InputBlock[] }

const isEmptyJson = (v: unknown): boolean =>
  v === null || v === undefined
  || (typeof v === 'object' && Object.keys(v as Record<string, unknown>).length === 0)

/**
 * 🔴 **Persona 마다 실제로 다른 입력이 되는지**를 값으로 만든다.
 *
 *    displayName 만 바뀐 공통 프롬프트를 막으려면 "달라야 한다" 는 말로는 부족하다.
 *    Persona 고유 값들만 모아 지문을 만들고, fixture 가 24명의 지문이
 *    서로 다른지 **행동으로** 확인한다.
 *
 * 🔴 code 는 지문에 넣지 않는다. code 를 넣으면 나머지가 전부 같아도 지문이 달라져
 *    "다 다르다" 는 거짓 통과가 나온다 — 그것이 정확히 막으려는 상태다.
 */
export function inputFingerprint(p: CommentInputPersona, v: VoiceEvidence): string {
  const parts = [
    p.ageBand ?? '', p.region ?? '', p.lifeStage ?? '',
    JSON.stringify(p.identity ?? null),
    JSON.stringify(p.voiceCore ?? null),
    JSON.stringify(p.voiceVariations ?? null),
    [...p.noGoTopics].sort().join(','),
    [...p.noGoExpressions].sort().join(','),
    v.source, [...v.openers].sort().join(','), [...v.endings].sort().join(','),
    [...v.punctuation].sort().join(','),
  ]
  let h = 2166136261
  const s = parts.join('')
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * 🔴 입력을 만들 수 **없으면 만들지 않는다.**
 *
 *    말투 근거가 없는 Persona 로 생성하면 공통 프롬프트가 그대로 나온다.
 *    그 결과물은 그 사람의 말이 아니라 모델의 말이다.
 */
export function buildCommentInput(args: {
  persona: CommentInputPersona
  post: CommentInputPost
  reactionRole: string
  voice: VoiceEvidence
  memory: MemoryState
}): CommentInputPlan {
  const blocks: InputBlock[] = []
  const { persona, post, voice } = args

  if (FORBIDDEN_REACTION_ROLES.includes(args.reactionRole)) {
    blocks.push({
      code: 'REACTION_ROLE_FORBIDDEN_GLOBAL',
      message: `${args.reactionRole} 는 전면 금지된 역할이다 — 이번 범위에서 풀지 않는다`,
    })
  }
  if (persona.forbiddenReactionRoles.includes(args.reactionRole)) {
    blocks.push({
      code: 'REACTION_ROLE_FORBIDDEN_PERSONA',
      message: `${persona.code} 는 ${args.reactionRole} 역할을 맡지 않는다`,
    })
  }
  if (isEmptyJson(persona.identity)) {
    blocks.push({ code: 'PERSONA_IDENTITY_MISSING', message: `${persona.code} 의 identity 가 비어 있다` })
  }
  if (isEmptyJson(persona.voiceCore)) {
    blocks.push({ code: 'PERSONA_VOICE_MISSING', message: `${persona.code} 의 voiceCore 가 비어 있다` })
  }
  if (persona.lifeStage === null || persona.lifeStage.trim() === '') {
    blocks.push({
      code: 'PERSONA_LIFESTAGE_MISSING',
      message: `${persona.code} 의 lifeStage 가 없다 — 생활사 없이 말하게 하지 않는다`,
    })
  }
  // 🔴 표지가 하나도 없으면 말투 근거가 없는 것이다
  if (voice.source === 'none'
    || (voice.openers.length === 0 && voice.endings.length === 0 && voice.punctuation.length === 0)) {
    blocks.push({
      code: 'VOICE_EVIDENCE_MISSING',
      message: `${persona.code} 의 말투 근거가 없다 — 공통 프롬프트로 생성하지 않는다`,
    })
  }
  if (post.title.trim() === '' || post.bodyDigest.trim() === '') {
    blocks.push({ code: 'POST_DIGEST_EMPTY', message: '대상 글의 제목 또는 요약이 비어 있다' })
  }

  if (blocks.length > 0) return { ok: false, blocks }

  return {
    ok: true,
    input: {
      personaCode: persona.code,
      reactionRole: args.reactionRole,
      persona,
      post,
      voice,
      memory: args.memory,
      fingerprint: inputFingerprint(persona, voice),
    },
  }
}

/**
 * 🔴 **Voice 자산 → 생성 입력.** 여기가 끊겨 있던 자리다.
 *
 *    옛 생성기는 말투 근거를 그 Persona 가 **과거에 쓴 댓글**에서만 뽑았다.
 *    실측하면 24명 중 댓글이 있는 Persona 는 1명이다 — 나머지 23명은 근거가 0 이고,
 *    남는 것은 24번 반복되는 공통 프롬프트뿐이다.
 *
 *    그런데 근거는 이미 있다. `Persona.voiceCore` 가 그 사람의 말투 자산이고
 *    (`ending` · `register` · `emoji` · `length`), `voiceVariations` 가 상황별 변주다.
 *    둘 다 24명 전원에게 있다. 자기 댓글은 **있으면 더 좋은 것**이지 전제가 아니다.
 *
 * 🔴 corpus(VoiceDerived · VoiceCommentSignal)는 **공통 배경**이지 개인 근거가 아니다.
 *    9,674건은 커뮤니티 전체의 말투이지 이 사람의 말투가 아니다 —
 *    그것을 개인 근거로 쓰면 24명이 다시 한 목소리가 된다. 그래서 지문에 넣지 않는다.
 */
export function voiceEvidenceFromAssets(input: {
  /** `{ ending, register, emoji, length }` */
  voiceCore: unknown
  /** 상황별 변주 목록 */
  voiceVariations: unknown
  /** 이 Persona 가 실제로 쓴 발화 — 있으면 근거가 더 단단해진다 */
  recentTexts?: readonly string[]
}): VoiceEvidence {
  const core = (input.voiceCore ?? {}) as Record<string, unknown>
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const variations = Array.isArray(input.voiceVariations)
    ? (input.voiceVariations as unknown[]).filter((v): v is string => typeof v === 'string')
    : []

  const endings: string[] = []
  if (str(core.ending) !== '') endings.push(str(core.ending))
  const punctuation: string[] = []
  // 🔴 이모지 빈도는 문장부호 습관과 같은 축이다 — 값이 있으면 표지로 쓴다
  if (str(core.emoji) !== '') punctuation.push(`이모지 ${str(core.emoji)}`)
  if (str(core.register) !== '') punctuation.push(str(core.register))
  if (str(core.length) !== '') punctuation.push(str(core.length))

  // 🔴 변주는 "어떻게 시작하는가" 를 말해 준다 — opener 표지로 쓴다
  const openers = variations.slice(0, MAX_VOICE_MARKS)

  const texts = input.recentTexts ?? []
  for (const t of texts) {
    const first = t.trim().split(/\s+/)[0]
    if (first !== undefined && first !== '' && !openers.includes(first)) openers.push(first)
  }

  const hasAny = endings.length > 0 || openers.length > 0 || punctuation.length > 0
  return {
    // 🔴 자기 발화가 있으면 그쪽이 더 강한 근거다. 없으면 자산에서 왔다고 정직하게 적는다
    source: !hasAny ? 'none' : texts.length > 0 ? 'persona-comments' : 'voice-derived',
    openers,
    endings,
    punctuation,
    sampleCount: texts.length,
  }
}

/** 🔴 표지를 무한정 싣지 않는다 — 프롬프트가 길어지면 말투가 아니라 지시가 된다 */
export const MAX_VOICE_MARKS = 8

/**
 * 🔴 Memory 가 없을 때 프롬프트에 들어갈 문장.
 *    "기억이 없다" 를 명시해야 모델이 없는 과거를 만들어 내지 않는다.
 */
export const NO_MEMORY_NOTE = '이 사람에 대해 저장된 기억이 없습니다. 과거의 일을 지어내지 마세요.'

export function memoryLine(m: MemoryState): string {
  return m.has ? m.summary : NO_MEMORY_NOTE
}

/** 입력들이 실제로 서로 다른가 — 🔴 fixture 가 24명에 대해 부르는 판정 */
export function judgeInputDiversity(inputs: readonly CommentInput[]): {
  ok: boolean
  unique: number
  total: number
  reason: string
} {
  const seen = new Set(inputs.map((i) => i.fingerprint))
  const ok = inputs.length > 0 && seen.size === inputs.length
  return {
    ok,
    unique: seen.size,
    total: inputs.length,
    reason: ok
      ? `${inputs.length}명의 입력이 모두 다르다`
      : `${inputs.length}명 중 서로 다른 입력은 ${seen.size}개뿐이다 — 공통 프롬프트가 섞여 있다`,
  }
}
