/**
 * 페르소나 후보 발행 규칙 — 🔴 순수 함수. DB · 세션 · 네트워크 없음
 *
 * 정본: docs/operations/2026-08-30-persona-architecture-design.md §13 · §8
 *       docs/operations/2026-08-31-persona-db-model-design.md §5 · §7-2
 *
 * 🔴 규칙을 server action 안에 두지 않는다.
 *    persona-candidate-rules.ts 와 같은 이유다 — 거기 두면 DB 없이 검증할 수 없고,
 *    검증할 수 없는 규칙은 조용히 깨진다. 여기 있으면 fixture 가 전수로 확인한다.
 *
 * 🔴 발행은 승인과 다른 축이다.
 *    승인(APPROVED)은 사람이 누른 결과이고, 발행(PUBLISHED)은 **DB 발행 성공을
 *    확인한 경로만** 설정할 수 있다. 이 파일은 "발행해도 되는가" 만 답하고
 *    상태를 바꾸지 않는다.
 *
 * 🔴 막는 사유를 하나 찾고 멈추지 않는다. 전부 모아 돌려준다 —
 *    dry-run 이 "고칠 것 3개" 를 한 번에 보여줘야 왕복이 줄어든다.
 *
 * 🔴 이 파일은 고객 화면에서 import 되지 않는다.
 */
import { MIN_COMMENT_LENGTH, MAX_COMMENT_LENGTH } from './comment-policy'
import { planCap, type CapContext } from './persona-cap'
import type { CandidateStatus } from './persona-candidate-rules'

/**
 * 🔴 발행 가능한 상태는 APPROVED 하나뿐이다 (창업자 결정).
 *
 *    PENDING    아직 사람이 읽지 않았다
 *    DECLINED   폐기된 것이다
 *    EDITED     수정본 발행은 editedText · editDiff 경로가 열린 뒤의 일이다
 *    PUBLISHED  이미 나갔다
 *    EXPIRED    기한이 지났다 — 방치가 승인이 되지 않는다
 */
export const canPublish = (status: CandidateStatus): boolean => status === 'APPROVED'

export type PublishBlockCode =
  | 'STATUS_NOT_APPROVED'
  | 'ALREADY_PUBLISHED'
  | 'TARGET_POST_MISSING'
  | 'TARGET_POST_NOT_FOUND'
  | 'TARGET_POST_NOT_PUBLISHED'
  | 'PERSONA_NOT_ACTIVE'
  | 'KILL_SWITCH_ON'
  | 'BODY_EMPTY'
  | 'BODY_TOO_SHORT'
  | 'BODY_TOO_LONG'
  | 'PERSONA_ALREADY_ON_POST'
  | 'DAILY_CAP_UNSET'
  | 'WEEKLY_CAP_UNSET'
  | 'DAILY_CAP_EXCEEDED'
  | 'WEEKLY_CAP_EXCEEDED'
  /**
   * 🔴 댓글 레인 재검사가 막았다 (2026-09-09).
   *    ratio 30% · 실회원 · 생활사·No-Go · 저장된 Gate · bootstrap 은
   *    이 파일이 보는 축이 아니다 — `recheckBeforePublish` 가 트랜잭션 안에서 본다.
   *    코드를 캐스팅으로 밀어 넣지 않고 여기 정식으로 둔다.
   */
  | 'COMMENT_RECHECK'

export type PublishBlock = { code: PublishBlockCode; message: string }

/** 발행 대상 글의 실측 상태. 없으면 null */
export type TargetPostState = { status: string } | null

export type PublishInput = {
  candidate: {
    status: CandidateStatus
    targetPostId: string | null
    publishedCommentId: string | null
    candidateText: string
    editedText: string | null
  }
  persona: {
    status: string
    dailyCap: number | null
    weeklyCap: number | null
  }
  /** 🔴 true = 중지 켜짐. 이름이 반대로 읽히기 쉽다 (persona-switch.ts 참조) */
  killSwitchEnabled: boolean
  /** PersonaActivityLog 실측 사용량 */
  cap: CapContext
  /** targetPostId 로 실제 조회한 결과 */
  targetPost: TargetPostState
  /** 그 글에 이미 달려 있는 (삭제되지 않은) 페르소나 댓글 수 */
  personaCommentsOnPost: number
}

export type PublishPlan =
  | { ok: true; content: string; blocks: [] }
  | { ok: false; blocks: PublishBlock[] }

/**
 * 발행할 본문을 고른다.
 *
 * 수정본이 있으면 그것이 승인된 문장이다. APPROVED 행에는 editedText 가 없으므로
 * 실질적으로는 candidateText 지만, 나중에 EDITED 경로가 열릴 때 여기만 이미 맞아 있다.
 */
export function resolveContent(candidate: {
  candidateText: string
  editedText: string | null
}): string {
  const edited = (candidate.editedText ?? '').trim()
  return edited !== '' ? edited : (candidate.candidateText ?? '').trim()
}

/**
 * 발행해도 되는가.
 *
 * 🔴 검사 순서가 곧 안전장치는 아니다 — 여기서는 전부 검사하고 전부 모은다.
 *    "순서가 안전장치" 인 것은 트랜잭션 안의 write 순서 쪽이다.
 */
export function planPublish(input: PublishInput): PublishPlan {
  const blocks: PublishBlock[] = []
  const block = (code: PublishBlockCode, message: string) => blocks.push({ code, message })

  const { candidate, persona, targetPost } = input

  // ① 상태 — APPROVED 만
  if (!canPublish(candidate.status)) {
    block('STATUS_NOT_APPROVED', `승인(APPROVED) 상태만 발행할 수 있습니다. 현재 ${candidate.status}`)
  }

  // ② 🔴 이미 발행된 것을 다시 발행하지 않는다.
  //    DB 에도 publishedCommentId @unique 가 걸려 있어 두 겹으로 막힌다.
  if (candidate.publishedCommentId !== null) {
    block('ALREADY_PUBLISHED', '이미 발행된 후보입니다 (publishedCommentId 존재)')
  }

  // ③ 대상 글 — 🔴 없으면 발행하지 않는다. 어디에 달지 모르는 댓글은 만들 수 없다
  if (candidate.targetPostId === null || candidate.targetPostId.trim() === '') {
    block('TARGET_POST_MISSING', '대상 글(targetPostId)이 없습니다 — 발행 대상이 아닙니다')
  } else if (targetPost === null) {
    block('TARGET_POST_NOT_FOUND', '대상 글을 찾을 수 없습니다')
  } else if (targetPost.status !== 'PUBLISHED') {
    block('TARGET_POST_NOT_PUBLISHED', `대상 글이 공개 상태가 아닙니다 (${targetPost.status})`)
  }

  // ④ 페르소나 상태 — 🔴 active 만. draft·paused·retired 는 발화하지 않는다 (§5)
  if (persona.status !== 'active') {
    block('PERSONA_NOT_ACTIVE', `페르소나가 활동 중이 아닙니다 (${persona.status}) — active 만 발행합니다`)
  }

  // ⑤ kill switch — 🔴 true 가 "중지 켜짐" 이다
  if (input.killSwitchEnabled) {
    block('KILL_SWITCH_ON', '전체 중지가 켜져 있습니다 — 모든 페르소나 발화가 멈춥니다')
  }

  // ⑥ 본문 — 고객 화면에 그대로 나가므로 회원 댓글과 같은 정책을 쓴다
  const content = resolveContent(candidate)
  const len = [...content].length
  if (len === 0) {
    block('BODY_EMPTY', '본문이 비어 있습니다')
  } else if (len < MIN_COMMENT_LENGTH) {
    block('BODY_TOO_SHORT', `본문이 ${len}자입니다 — ${MIN_COMMENT_LENGTH}자 이상이어야 합니다`)
  } else if (len > MAX_COMMENT_LENGTH) {
    block('BODY_TOO_LONG', `본문이 ${len}자입니다 — ${MAX_COMMENT_LENGTH}자를 넘을 수 없습니다`)
  }

  // ⑦ 🔴 같은 글에 페르소나는 1명이다 (Architecture §8 전체 상한).
  //    1단계는 봇끼리 상호작용 **전면 금지**라, 이미 페르소나 댓글이 있는 글에
  //    또 다는 것은 그 금지에 정면으로 걸린다.
  if (input.personaCommentsOnPost > 0) {
    block(
      'PERSONA_ALREADY_ON_POST',
      `대상 글에 이미 페르소나 댓글이 ${input.personaCommentsOnPost}건 있습니다 — 같은 글에 1명입니다`,
    )
  }

  // ⑧ cap — 🔴 미설정(NULL)은 무제한이 아니라 발행 금지다
  const capPlan = planCap(
    { dailyCap: persona.dailyCap, weeklyCap: persona.weeklyCap },
    input.cap,
  )
  for (const b of capPlan.blocks) {
    block(b.code, b.message)
  }

  if (blocks.length > 0) return { ok: false, blocks }
  return { ok: true, content, blocks: [] }
}

// ─────────────────────────────────────────────────────────
// 내림 (takedown)
// ─────────────────────────────────────────────────────────

export type TakedownBlockCode =
  | 'COMMENT_NOT_FOUND'
  | 'NOT_PERSONA_COMMENT'
  | 'ALREADY_DELETED'

export type TakedownBlock = { code: TakedownBlockCode; message: string }

export type TakedownInput = {
  comment: { personaId: string | null; isDeleted: boolean } | null
}

export type TakedownPlan =
  | { ok: true; blocks: [] }
  | { ok: false; blocks: TakedownBlock[] }

/**
 * 내려도 되는가.
 *
 * 🔴 페르소나가 발행한 댓글만 대상이다. 실회원 댓글을 이 경로로 지우지 않는다 —
 *    운영자가 회원 글을 지우는 것은 신고 처리 경로의 일이고, 판단 기준도 다르다.
 *
 * 🔴 대기열은 되돌리지 않는다. PUBLISHED 로 남는다.
 *    "발행됐다" 는 사실이고, 내린 것은 그 뒤에 일어난 다른 사건이다.
 *    되돌리면 "발행된 적 없는 것" 이 되어 계측이 무너진다.
 */
export function planTakedown(input: TakedownInput): TakedownPlan {
  const blocks: TakedownBlock[] = []

  if (input.comment === null) {
    return { ok: false, blocks: [{ code: 'COMMENT_NOT_FOUND', message: '댓글을 찾을 수 없습니다' }] }
  }
  if (input.comment.personaId === null) {
    blocks.push({
      code: 'NOT_PERSONA_COMMENT',
      message: '페르소나가 발행한 댓글이 아닙니다 — 이 경로로 내릴 수 없습니다',
    })
  }
  if (input.comment.isDeleted) {
    blocks.push({ code: 'ALREADY_DELETED', message: '이미 내려간 댓글입니다' })
  }

  if (blocks.length > 0) return { ok: false, blocks }
  return { ok: true, blocks: [] }
}
