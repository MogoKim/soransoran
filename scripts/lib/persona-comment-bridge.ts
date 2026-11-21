/**
 * `CommentInput` → 기존 생성·Gate 경로 **어댑터** — 🔴 순수 함수
 *
 * 🔴 **왜 어댑터인가.**
 *
 *    새 생성기를 하나 더 만들지 않는다. 프롬프트 정본은 `buildPrompt` 이고
 *    안전 판정 정본은 `checkCommentCandidate`(댓글 관문)다. 둘 다 이미 있고,
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
import { groundingTextOf } from '../../src/lib/persona-experience-grounding'
import { pickFormExample } from '../../src/lib/persona-comment-form'
import {
  buildPrompt, extractVoiceMarks,
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
    // 🔴 추가 댓글만 — 첫 댓글 입력에는 이 칸이 없어 위 줄들과 바이트가 같다
    ...(input.post.replyToDigest === undefined
      ? []
      : ['', `[이 댓글에 이어서 답합니다]\n- ${input.post.replyToDigest}`]),
    // 🔴 글쓴이 답글 자리만 — 본문 바로 곁에서도 한 번 더 말한다(지시는 system 쪽 `seat.ownPost` 절이 정본이다)
    ...(input.post.authorReply === true
      ? ['', '[이 글은 당신이 쓴 글입니다 — 글쓴이로서 위 댓글에 답합니다. 글에 없는 사실을 새로 더하지 않습니다]']
      : []),
  ]
  return {
    title: input.post.title,
    content: lines.join('\n'),
    boardLabel: input.post.boardLabel,
  }
}

/**
 * 자기 발화 → `RecentVoiceMarks`. 규칙은 Gate ⑧ 과 같은 `extractVoiceMarks` 하나다.
 *
 * 🔴 **자기 발화가 없으면 빈 표지다** (2026-11-21). 옛 판은 말투 카드의 말버릇을 "최근에 이렇게 시작했습니다" 로 넘겼다 —
 *    쓴 적 없는 말을 썼다고 말하는 것이다. 자기 발화가 없으면 ⑧ 반복 축도 돌지 않으니 막힐 패턴도 없다.
 */
export function toRecentMarks(recentTexts: readonly string[] = []): RecentVoiceMarks {
  if (recentTexts.length > 0) return extractVoiceMarks(recentTexts)
  return { openers: [], endings: [], openerInitials: [], dominant: { endings: [], hooks: [], grams: [] } }
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
  /**
   * 🔴 `formPool` — 꼴 본보기 풀(`bundlesForPersonas().formPool`). 자리(글 · 순번 — 첫 댓글은 1)마다 하나를 결정적으로 뽑는다.
   *    풀이 비면 본보기가 없고, 근거를 강제하는 경로에서는 `buildPrompt` 가 `FORM_MISSING` 으로 막는다.
   */
  opts: { requireReference?: boolean; formPool?: readonly string[] } = {},
): PromptPlan {
  const form = pickFormExample({
    pool: opts.formPool ?? [],
    postId: input.post.id,
    ordinal: input.post.threadSeat?.ordinal ?? 1,
    experience: input.reactionRole === 'experience',
  })
  return buildPrompt({
    persona: toPromptPersona(input),
    post: toPromptPost(input),
    reactionType: input.reactionRole,
    recentMarks: toRecentMarks(recentTexts),
    reference,
    requireReference: opts.requireReference,
    ...(form === null ? {} : { form }),
    // 🔴 생성과 검증이 **같은 grounding** 을 본다 (P0-1)
    grounding: groundingTextOf({ identity: input.persona.identity, memory: input.memory }),
    // 🔴 추가 댓글만 — 첫 댓글 입력에는 이 칸이 없어 프롬프트가 한 글자도 바뀌지 않는다
    ...(input.post.threadSeat === undefined
      ? {}
      : { seat: { ...input.post.threadSeat, reply: input.post.replyToDigest !== undefined, ownPost: input.post.authorReply === true } }),
  })
}

/**
 * 생성 결과 → 관문 입력.
 *
 * 🔴 **입력을 빠뜨리면 관문이 돌지 않는다.** 그런데 `checkCommentCandidate` 는
 *    입력과 무관하게 관문마다 1개를 돌려주므로, 빠뜨린 쪽은 `notRun` 인 채로
 *    개수가 채워지고 겉보기에는 "관문 통과" 가 된다.
 *    첫 판이 정확히 그랬다 — `knownNames` · `identity` · `noGoTopics` · `priorTexts` 를 하나도 넘기지 않았다.
 *
 * 🔴 그래서 여기서 **CommentInput 이 이미 들고 있는 것은 자동으로 잇는다** —
 *    identity · No-Go · forbiddenRoles 는 호출부가 다시 넘길 필요가 없다.
 *    호출부가 넘겨야 하는 것은 그 밖에서 오는 것들뿐이다(회원 표시명 · 이전 발화).
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
  /** ⑧ 같은 persona 의 이전 발화 — 운영은 삭제되지 않은 공개 댓글 전체(반복 축은 후보 귀속 판정이라 영구 잠금이 없다) */
  priorTexts?: readonly string[]
  /** ⑧ seed 재사용 횟수 — 전체 단위 */
  seedUseCount?: number
  /** 조언이 금지된 글 유형인가 */
  adviceForbidden?: boolean
  /** 출처가 카페 운영/공지 문맥인가 — 🔴 아니면 false 를 명시한다. 없으면 ⑨ 가 notRun 이다 */
  sourceIsCafeOperational?: boolean
}): CandidateInput {
  const p = args.input.persona
  const post = args.input.post
  /**
   * 🔴 **글쓴이가 자기 글에 답하는 자리** — 그 글은 남의 글이 아니라 이 사람이 한 말이다.
   *    · ⑦ 자기 경험 근거: 자기 글에 쓴 사실은 다시 말할 수 있다
   *    ① 유출 대조(`sourceTexts`)는 줄이지 않는다 — 자기 글이라도 문장을 통째로 옮기면 걸린다.
   */
  const ownPost = post.authorReply === true
  const baseGrounding = groundingTextOf({ identity: p.identity, memory: args.input.memory })
  return {
    personaCode: args.input.personaCode,
    text: args.text,
    sourceTexts: args.sourceTexts,
    ...(args.knownNames === undefined ? {} : { knownNames: args.knownNames }),
    // 🔴 CommentInput 이 들고 있는 것은 자동으로 잇는다 — 호출부가 잊을 자리를 없앤다
    forbiddenRoles: p.forbiddenReactionRoles,
    identity: (p.identity ?? null) as CandidateInput['identity'],
    /**
     * 🔴 **생성 계획과 후보 검증이 같은 grounding 을 본다** (2026-09-10, P0-1).
     *    호출부가 따로 넘기지 않아도 이어지게 한다 — 잊을 자리를 없앤다.
     */
    personaGrounding: ownPost ? [baseGrounding, post.title, post.bodyDigest].filter((t) => t.trim() !== '').join(' ') : baseGrounding,
    // 🔴 추가 댓글만 — 첫 댓글 입력에는 자리 칸이 없어 ⑦ 판정이 그대로다
    ...(post.threadSeat === undefined ? {} : { everydayExperience: { menopauseExperienced: post.threadSeat.menopauseExperienced, spouseStrain: post.threadSeat.spouseStrain } }),
    noGoTopics: p.noGoTopics,
    noGoExpressions: p.noGoExpressions,
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
