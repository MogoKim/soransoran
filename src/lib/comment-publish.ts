/**
 * 댓글 저장 결과 → 화면 상태 · 계측 판정. 순수 함수 — 서버 action 과 폼, 검사가 같은 것을 쓴다.
 *
 * 🔴 중복으로 기존 댓글을 돌려받은 요청(연타 · 재전송)은 **새 등록이 아니다.**
 *    화면은 그 댓글로 이동하고 성공으로 보여도 되지만, comment_publish 로 다시 세지 않는다.
 *    한 번 쓴 댓글을 두 번 세면 참여 계측(North Star 재료)이 부푼다.
 */
import type { CommentWriteFailure } from '@/lib/comment-write'

export type CommentWriteOutcome =
  | { ok: true; commentId: string; duplicate: boolean }
  | { ok: false; code: CommentWriteFailure; error: string }

/** 회원·비회원 action 이 공통으로 돌려주는 저장 결과 부분 */
export type CommentPublishState = {
  ok?: true
  error?: string
  /** 저장된(또는 이미 있던) 댓글 id — 화면이 그 댓글로 포커스를 옮긴다 */
  commentId?: string
  /** 새로 만들지 않고 방금 저장된 같은 댓글을 돌려줬다 */
  duplicate?: true
  /** 실패 사유 — 답글 대상이 사라졌으면 화면이 대상 이름·원문을 숨기고 등록을 막는다 */
  code?: CommentWriteFailure
}

export function toPublishState(saved: CommentWriteOutcome): CommentPublishState {
  if (!saved.ok) return { error: saved.error, code: saved.code }
  return saved.duplicate
    ? { ok: true, commentId: saved.commentId, duplicate: true }
    : { ok: true, commentId: saved.commentId }
}

/** comment_publish 를 셀 것인가 — 새로 저장된 댓글일 때만 */
export function countsAsNewComment(state: Pick<CommentPublishState, 'ok' | 'duplicate'>): boolean {
  return state.ok === true && state.duplicate !== true
}
