/**
 * 발행 대상 글 지정 규칙 — 🔴 순수 함수. DB · 세션 · 네트워크 없음
 *
 * 정본: docs/operations/2026-08-30-persona-architecture-design.md §8 · §10-2
 *
 * 🔴 이것은 발행이 아니다. 발행 **전에** 어디에 달지 정하는 일이다.
 *    write 는 PersonaApprovalQueue.targetPostId 한 컬럼뿐이고,
 *    상태(status)를 바꾸지 않는다. 승인도 발행도 여기서 일어나지 않는다.
 *
 * 🔴 M3 반응 지도가 붙기 전까지 대상 선정은 사람이 한다(1단계 확정).
 *    자동 선정이 들어올 자리를 남겨 두되, 지금은 운영자가 고른다.
 *
 * 🔴 규칙을 server action 안에 두지 않는다 — persona-candidate-rules.ts 와 같은 이유다.
 *    DB 없이 fixture 로 전수 검증하기 위해서다.
 *
 * 🔴 이 파일은 고객 화면에서 import 되지 않는다.
 */
import type { CandidateStatus } from './persona-candidate-rules'

/**
 * 🔴 대상 글을 지정할 수 있는 상태는 둘뿐이다.
 *
 *    PENDING    아직 결정 전이다. 미리 대상을 정해 둘 수 있다
 *    APPROVED   승인됐고 발행을 기다린다. 여기서 대상을 정한다
 *
 *    PUBLISHED  이미 나갔다. 대상을 바꾸면 "어느 글에 달렸나" 가 어긋난다
 *    DECLINED   폐기된 것이다
 *    EXPIRED    기한이 지났다
 *    EDITED     수정본 경로가 아직 열리지 않았다 — 열릴 때 함께 판단한다
 */
export const canSetTarget = (status: CandidateStatus): boolean =>
  status === 'PENDING' || status === 'APPROVED'

/**
 * 회원 댓글이 이 수 이상이면 페르소나가 끼어들지 않는다.
 *
 * 🔴 [Architecture §8] *"회원 댓글 3개 이상 — 개입하지 않는다"*.
 *    사람들끼리 대화가 붙은 자리에 봇이 들어가는 것은 도움이 아니라 방해다.
 */
export const MEMBER_COMMENT_LIMIT = 3

/**
 * 🔴 **한 글에 Persona 댓글은 최대 이만큼이다** (2026-09-11 정본 교체).
 *
 *    옛 계약은 **글당 1명**이었다. 그 규칙은 "봇끼리 상호작용 금지" 를 지키려 한 것인데,
 *    실제로 막은 것은 상호작용이 아니라 **대화처럼 보이는 것 전부**였다.
 *    댓글이 하나 달린 글은 대화가 아니라 통보다 — 사람은 그런 글에 끼어들지 않는다.
 *
 *    그래서 상한을 1 에서 5 로 올린다. 대신 **같은 Persona 가 같은 글에 두 번 달지 않는다** —
 *    막아야 할 것은 "여럿이 말하는 것" 이 아니라 **"한 사람이 여럿인 척하는 것"** 이다.
 *
 * 🔴 하한은 강제하지 않는다. 붙일 Persona 가 하나뿐이면 1건이고, 그것으로 끝이다.
 *    억지로 5건을 채우면 그것은 대화가 아니라 자동 응답기다.
 */
export const PERSONA_COMMENTS_PER_POST_MAX = 5

export type TargetBlockCode =
  | 'CANDIDATE_STATUS'
  | 'ALREADY_PUBLISHED'
  | 'POST_ID_EMPTY'
  | 'POST_NOT_FOUND'
  | 'POST_NOT_PUBLISHED'
  | 'POST_PERSONA_COMMENTS_FULL'
  | 'POST_MEMBER_COMMENTS_FULL'

export type TargetBlock = { code: TargetBlockCode; message: string }

/** 대상 글의 실측 상태. 목록과 저장이 **같은 값**을 본다 */
export type TargetPostFacts = {
  status: string
  /** 살아 있는 페르소나 댓글 수 */
  personaComments: number
  /** 살아 있는 회원 댓글 수 */
  memberComments: number
}

export type TargetPostVerdict = {
  eligible: boolean
  blocks: TargetBlock[]
}

/**
 * 이 글에 페르소나 댓글을 달아도 되는가 — 글 쪽 조건만 본다.
 *
 * 🔴 목록 화면과 저장 액션이 **이 함수 하나**를 쓴다.
 *    목록에서 고를 수 있게 보여 놓고 저장에서 다른 기준으로 막으면,
 *    운영자는 이유를 알 수 없는 실패를 만난다.
 */
export function judgeTargetPost(post: TargetPostFacts | null): TargetPostVerdict {
  const blocks: TargetBlock[] = []

  if (post === null) {
    return { eligible: false, blocks: [{ code: 'POST_NOT_FOUND', message: '글을 찾을 수 없습니다' }] }
  }

  if (post.status !== 'PUBLISHED') {
    blocks.push({
      code: 'POST_NOT_PUBLISHED',
      message: `공개 상태가 아닙니다 (${post.status})`,
    })
  }

  // 🔴 한 글에 페르소나 댓글은 최대 5건이다. 자리가 남아 있으면 더 달 수 있다
  if (post.personaComments >= PERSONA_COMMENTS_PER_POST_MAX) {
    blocks.push({
      code: 'POST_PERSONA_COMMENTS_FULL',
      message: `이미 페르소나 댓글이 ${post.personaComments}건 있습니다`
        + ` — 한 글에 ${PERSONA_COMMENTS_PER_POST_MAX}건까지입니다`,
    })
  }

  // 🔴 사람들끼리 대화가 붙은 자리에는 끼어들지 않는다 (§8)
  if (post.memberComments >= MEMBER_COMMENT_LIMIT) {
    blocks.push({
      code: 'POST_MEMBER_COMMENTS_FULL',
      message: `회원 댓글이 ${post.memberComments}건입니다 — ${MEMBER_COMMENT_LIMIT}건 이상이면 개입하지 않습니다`,
    })
  }

  return { eligible: blocks.length === 0, blocks }
}

export type SetTargetInput = {
  candidate: { status: CandidateStatus; publishedCommentId: string | null }
  postId: string
  post: TargetPostFacts | null
}

export type SetTargetPlan =
  | { ok: true; postId: string; blocks: [] }
  | { ok: false; blocks: TargetBlock[] }

/**
 * 대상 글을 지정해도 되는가 — 후보 쪽 조건과 글 쪽 조건을 함께 본다.
 *
 * 🔴 사유를 하나만 내고 멈추지 않는다. 전부 모아 돌려준다.
 */
export function planSetTarget(input: SetTargetInput): SetTargetPlan {
  const blocks: TargetBlock[] = []

  if (!canSetTarget(input.candidate.status)) {
    blocks.push({
      code: 'CANDIDATE_STATUS',
      message: `대기(PENDING) · 승인(APPROVED) 상태만 대상 글을 지정할 수 있습니다. 현재 ${input.candidate.status}`,
    })
  }
  // 🔴 발행된 뒤에 대상을 바꾸면 "어느 글에 달렸나" 가 어긋난다
  if (input.candidate.publishedCommentId !== null) {
    blocks.push({ code: 'ALREADY_PUBLISHED', message: '이미 발행된 후보입니다' })
  }

  const postId = (input.postId ?? '').trim()
  if (postId === '') {
    blocks.push({ code: 'POST_ID_EMPTY', message: '대상 글을 고르지 않았습니다' })
  } else {
    blocks.push(...judgeTargetPost(input.post).blocks)
  }

  if (blocks.length > 0) return { ok: false, blocks }
  return { ok: true, postId, blocks: [] }
}

export type ClearTargetPlan =
  | { ok: true; blocks: [] }
  | { ok: false; blocks: TargetBlock[] }

/**
 * 지정을 해제해도 되는가.
 *
 * 🔴 해제는 되돌리기가 쉬운 방향이다(다시 고르면 된다). 그래도 발행된 뒤에는 막는다 —
 *    발행된 댓글이 가리키는 글을 지우면 역조회가 끊긴다.
 */
export function planClearTarget(candidate: {
  status: CandidateStatus
  publishedCommentId: string | null
}): ClearTargetPlan {
  const blocks: TargetBlock[] = []

  if (!canSetTarget(candidate.status)) {
    blocks.push({
      code: 'CANDIDATE_STATUS',
      message: `대기(PENDING) · 승인(APPROVED) 상태만 해제할 수 있습니다. 현재 ${candidate.status}`,
    })
  }
  if (candidate.publishedCommentId !== null) {
    blocks.push({ code: 'ALREADY_PUBLISHED', message: '이미 발행된 후보입니다' })
  }

  if (blocks.length > 0) return { ok: false, blocks }
  return { ok: true, blocks: [] }
}
