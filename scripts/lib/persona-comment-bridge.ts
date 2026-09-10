/**
 * `CommentInput` → 기존 생성·Gate 경로 **어댑터** — 🔴 순수 함수
 *
 * 🔴 **왜 어댑터인가.**
 *
 *    새 생성기를 하나 더 만들지 않는다. 프롬프트 정본은 `buildPrompt` 이고
 *    안전 판정 정본은 `checkCommentCandidate`(9관문)다. 둘 다 이미 있고,
 *    둘 다 오래 다듬어진 것들이다. 새로 쓰면 그 다듬음이 통째로 사라진다.
 *
 *    끊겨 있던 것은 생성기가 아니라 **연결**이었다. `persona-comment-input` 이
 *    만든 입력을 실제 생성기가 import 하지 않아, 새 계약이 어디에도 닿지 않았다.
 *    이 파일이 그 자리를 잇는다.
 *
 * 🔴 여기서 새 판정을 만들지 않는다. 모양만 바꾼다 —
 *    판정을 여기 두면 `buildPrompt` 와 이중이 되고, 언젠가 둘이 갈린다.
 */
import type { VoiceReferenceBundle } from '../../src/lib/persona-voice-reference'
import {
  buildPrompt, extractVoiceMarks, MAX_RECENT_MARKS,
  type PromptPersona, type PromptPlan, type PromptTargetPost, type RecentVoiceMarks,
} from './persona-prompt'

import { memoryLine, type CommentInput } from '../../src/lib/persona-comment-input'
import type { CandidateInput } from './persona-comment-candidate.mjs'
import type { judgeGateInputs } from '../../src/lib/persona-comment-gate-report'

/** `CommentInput.persona` → `buildPrompt` 가 받는 모양. 🔴 값을 만들지 않는다 */
export function toPromptPersona(input: CommentInput): PromptPersona {
  const p = input.persona
  return {
    code: p.code,
    ageBand: p.ageBand,
    region: p.region,
    lifeStage: p.lifeStage,
    identity: p.identity,
    voiceCore: p.voiceCore,
    voiceVariations: p.voiceVariations,
    noGoTopics: p.noGoTopics,
    noGoExpressions: p.noGoExpressions,
    forbiddenReactionRoles: p.forbiddenReactionRoles,
  }
}

/**
 * `CommentInput.post` → `buildPrompt` 가 받는 모양.
 *
 * 🔴 본문 자리에 **요약과 기존 댓글 문맥**을 함께 싣는다. 원문 전문은 싣지 않는다 —
 *    `CommentInputPost.bodyDigest` 가 이미 요약이고, 이 파일은 그것을 늘리지 않는다.
 * 🔴 Memory 는 **없으면 없다고** 적어 보낸다. 빈자리를 두면 모델이 과거를 지어낸다.
 */
export function toPromptPost(input: CommentInput): PromptTargetPost {
  const ctx = input.post.existingCommentDigests
  const lines = [
    input.post.bodyDigest,
    '',
    ctx.length === 0
      ? '[이 글에는 아직 댓글이 없습니다]'
      : `[이미 달린 댓글 ${ctx.length}건의 문맥]\n${ctx.map((c) => `- ${c}`).join('\n')}`,
    '',
    `[기억] ${memoryLine(input.memory)}`,
  ]
  return {
    title: input.post.title,
    content: lines.join('\n'),
    boardLabel: input.post.boardLabel,
  }
}

/**
 * `VoiceEvidence` → `RecentVoiceMarks`.
 *
 * 🔴 `openerInitials` 는 **빈도를 지니고 있어야** Gate ⑧ 이 잡는 것과 같은 것을 막는다.
 *    표지 목록만 넘기고 빈도를 버리면, 네 번 반복한 글자와 한 번 쓴 글자가 같아 보인다.
 * 🔴 자기 발화가 있으면 그쪽의 실제 규칙(`extractVoiceMarks`)을 쓴다 —
 *    같은 규칙을 여기서 다시 쓰지 않는다.
 */
export function toRecentMarks(input: CommentInput, recentTexts: readonly string[] = []): RecentVoiceMarks {
  if (recentTexts.length > 0) return extractVoiceMarks(recentTexts)
  const openers = input.voice.openers.slice(0, MAX_RECENT_MARKS)
  const endings = input.voice.endings.slice(0, MAX_RECENT_MARKS)
  const counts = new Map<string, number>()
  for (const o of openers) {
    const initial = o.trim().charAt(0)
    if (initial === '') continue
    counts.set(initial, (counts.get(initial) ?? 0) + 1)
  }
  return {
    openers,
    endings,
    openerInitials: [...counts].map(([initial, count]) => ({ initial, count }))
      .sort((a, b) => b.count - a.count || a.initial.localeCompare(b.initial)),
  }
}

/**
 * 🔴 **단일 흐름의 이음매.** planner 가 고른 것을 기존 프롬프트 정본으로 넘긴다.
 *
 *    `buildPrompt` 가 막으면 그대로 막힌 채 돌려준다 — 여기서 우회하지 않는다.
 */
export function buildPromptFromInput(
  input: CommentInput,
  recentTexts: readonly string[] = [],
  /**
   * 🔴 **말투 근거** (2026-09-10, Wave E). 없으면 `buildPrompt` 가 막는다 —
   *    여기서 우회하지 않는다. 설정만 보고 창작하는 옛 경로로 돌아가지 않기 위해서다.
   */
  reference?: VoiceReferenceBundle,
  opts: { requireReference?: boolean } = {},
): PromptPlan {
  return buildPrompt({
    persona: toPromptPersona(input),
    post: toPromptPost(input),
    reactionType: input.reactionRole,
    recentMarks: toRecentMarks(input, recentTexts),
    reference,
    requireReference: opts.requireReference,
  })
}

/**
 * 생성 결과 → 9관문 Gate 입력.
 *
 * 🔴 **입력을 빠뜨리면 관문이 돌지 않는다.** 그런데 `checkCommentCandidate` 는
 *    입력과 무관하게 ①~⑨ 각 1개를 돌려주므로, 빠뜨린 쪽은 `notRun` 인 채로
 *    9개가 채워지고 겉보기에는 "9관문 통과" 가 된다.
 *    첫 판이 정확히 그랬다 — `knownNames` · `frequencyLookup` · `identity` ·
 *    `noGoTopics` · `priorTexts` 를 하나도 넘기지 않았다.
 *
 * 🔴 그래서 여기서 **CommentInput 이 이미 들고 있는 것은 자동으로 잇는다** —
 *    identity · No-Go · forbiddenRoles 는 호출부가 다시 넘길 필요가 없다.
 *    호출부가 넘겨야 하는 것은 그 밖에서 오는 것들뿐이다(코퍼스 · 회원 표시명 · 이전 발화).
 *
 * 🔴 `sourceTexts` 는 **파일에 저장하지 않고 런타임에 다시 읽는다**(기존 계약).
 * 🔴 `knownNames` 는 `undefined` 와 `[]` 를 구별해 넘긴다 —
 *    빈 배열은 "조회했는데 없었다", `undefined` 는 "조회하지 않았다" 다.
 */
export function toGateInput(args: {
  input: CommentInput
  text: string
  /** 대상 글 원문·기존 댓글 — 🔴 유출 대조용. 저장하지 않는다 */
  sourceTexts: readonly string[]
  /** ⑥-A 회원 표시명. 🔴 조회하지 않았으면 넘기지 않는다(빈 배열과 다르다) */
  knownNames?: readonly string[]
  /** ② 댓글 코퍼스 빈도 조회 */
  frequencyLookup?: CandidateInput['frequencyLookup']
  corpusName?: string
  /** ⑧ 같은 persona 의 이전 발화 + 같은 배치의 앞선 후보 */
  priorTexts?: readonly string[]
  /** ⑧ seed 재사용 횟수 — 전체 단위 */
  seedUseCount?: number
  /** 조언이 금지된 글 유형인가 */
  adviceForbidden?: boolean
  /** 출처가 카페 운영/공지 문맥인가 — 🔴 아니면 false 를 명시한다. 없으면 ⑨ 가 notRun 이다 */
  sourceIsCafeOperational?: boolean
}): CandidateInput {
  const p = args.input.persona
  return {
    personaCode: args.input.personaCode,
    text: args.text,
    sourceTexts: args.sourceTexts,
    ...(args.knownNames === undefined ? {} : { knownNames: args.knownNames }),
    // 🔴 CommentInput 이 들고 있는 것은 자동으로 잇는다 — 호출부가 잊을 자리를 없앤다
    forbiddenRoles: p.forbiddenReactionRoles,
    identity: (p.identity ?? null) as CandidateInput['identity'],
    noGoTopics: p.noGoTopics,
    noGoExpressions: p.noGoExpressions,
    ...(args.frequencyLookup === undefined
      ? {}
      : { frequencyLookup: args.frequencyLookup, corpusName: args.corpusName ?? 'comment' }),
    ...(args.priorTexts === undefined ? {} : { priorTexts: args.priorTexts }),
    ...(args.seedUseCount === undefined ? {} : { seedUseCount: args.seedUseCount }),
    ...(args.adviceForbidden === undefined ? {} : { adviceForbidden: args.adviceForbidden }),
    ...(args.sourceIsCafeOperational === undefined
      ? {}
      : { sourceIsCafeOperational: args.sourceIsCafeOperational }),
  }
}

/** 🔴 `toGateInput` 이 실제로 무엇을 채웠는지 — `judgeGateInputs` 에 그대로 넘긴다 */
export function describeGateInput(gi: CandidateInput): Parameters<typeof judgeGateInputs>[0] {
  return {
    knownNames: gi.knownNames,
    hasFrequencyLookup: gi.frequencyLookup !== undefined,
    corpusName: gi.corpusName,
    identity: gi.identity,
    noGoTopics: gi.noGoTopics,
    noGoExpressions: gi.noGoExpressions,
    priorTexts: gi.priorTexts,
    sourceTexts: gi.sourceTexts,
    forbiddenRoles: gi.forbiddenRoles,
    adviceForbidden: gi.adviceForbidden,
    sourceIsCafeOperational: gi.sourceIsCafeOperational,
  }
}
