'use client'

import { useState } from 'react'
import { useFormState } from 'react-dom'

import ActionButton from '@/components/ui/ActionButton'
import AdminActionButton from '@/components/admin/AdminActionButton'
import {
  deleteOperatorComment,
  deleteOperatorPost,
  updateOperatorComment,
  updateOperatorPost,
  type ComposeActionState,
} from '@/lib/actions/operator-compose'
import { MAX_COMMENT_LENGTH } from '@/lib/comment-policy'
import { MAX_POST_CONTENT_LENGTH, MAX_POST_TITLE_LENGTH } from '@/lib/post-policy'

/**
 * 작성 내역 한 줄의 조치 — 수정 · 숨기기.
 *
 * 🔴 용어는 실제 동작에서 가져온다 (2026-09-17).
 *    "고치기" 는 본문을 바꾸는 일이라 **수정** 이고,
 *    "내리기" 는 deleteOperatorPost/Comment 를 부르지만 그 안은
 *    Post.status=HIDDEN · Comment.isDeleted=true 라 지우는 것이 아니라 **숨기기** 다.
 *    함수 이름은 바꾸지 않는다 — 동작을 건드리지 않기 위해서다.
 *
 * 🔴 **기본은 접혀 있다.** 줄마다 입력칸을 펼쳐 두면 내역을 읽을 수 없고,
 *    읽으려던 사람이 실수로 고친다 — `AdminCommentEditForm` 과 같은 판단이다.
 *
 * 🔴 **숨기기는 확인을 묻는다.** 이미 공개된 글을 내리는 일이라 되돌리는 데
 *    사람의 손이 한 번 더 든다. 고치기에는 묻지 않는다 — 매번 물으면 읽지 않고 누른다.
 *
 * 🔴 **권한은 서버가 다시 판정한다.** 이 버튼이 보인다는 것이 권한의 근거가 아니다.
 *    액션이 `operatorWriterId` 로 이 도구의 것인지 다시 확인한다.
 */
export default function OperatorComposedItemControls({
  kind,
  id,
  title,
  content,
  hidden,
}: {
  kind: 'post' | 'comment'
  id: string
  /** 글일 때만 온다 */
  title?: string
  content: string
  hidden: boolean
}) {
  const [open, setOpen] = useState(false)
  const action = kind === 'post' ? updateOperatorPost : updateOperatorComment
  const [state, formAction] = useFormState<ComposeActionState, FormData>(action, {})

  const closeButton = (
    <button
      type="button"
      onClick={() => setOpen(false)}
      className="inline-flex min-h-[52px] items-center justify-center rounded-lg border border-interactive px-4 text-base font-bold text-brand-strong transition duration-150 hover:bg-surface-soft active:scale-[0.98]"
    >
      닫기
    </button>
  )

  if (!open) {
    return (
      <div className="mt-2 flex flex-wrap items-start gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-[52px] items-center justify-center rounded-lg border border-interactive px-4 text-base font-bold text-brand-strong transition duration-150 hover:bg-surface-soft active:scale-[0.98]"
        >
          수정
        </button>
        {hidden ? null : (
          <AdminActionButton
            label="숨기기"
            tone="danger"
            confirmText={
              kind === 'post'
                ? '이 글을 숨길까요? 고객 화면에서 사라지고 작성 내역에는 남습니다.'
                : '댓글 내용을 숨길까요? 작성 내역에는 남습니다.'
            }
            successText="숨겼어요."
            run={() => (kind === 'post' ? deleteOperatorPost(id) : deleteOperatorComment(id))}
          />
        )}
        {state.ok ? <p className="m-0 text-sm text-state-success">저장했습니다.</p> : null}
      </div>
    )
  }

  return (
    <form action={formAction} className="mt-2 flex flex-col gap-2">
      <input type="hidden" name={kind === 'post' ? 'postId' : 'commentId'} value={id} />

      {kind === 'post' ? (
        <label className="flex flex-col gap-1">
          <span className="text-sm text-content-muted">제목</span>
          <input
            name="title"
            defaultValue={title ?? ''}
            maxLength={MAX_POST_TITLE_LENGTH}
            className="min-h-[52px] rounded-lg border border-subtle bg-surface-card px-3 text-content-primary"
          />
        </label>
      ) : null}

      <label className="flex flex-col gap-1">
        <span className="text-sm text-content-muted">{kind === 'post' ? '본문' : '댓글 내용'}</span>
        <textarea
          name="content"
          defaultValue={content}
          rows={kind === 'post' ? 10 : 4}
          maxLength={kind === 'post' ? MAX_POST_CONTENT_LENGTH : MAX_COMMENT_LENGTH}
          className="w-full rounded-lg border border-subtle bg-surface-card p-3 text-content-primary"
        />
      </label>

      {state.error ? <p className="m-0 text-sm text-state-danger">{state.error}</p> : null}
      {state.ok ? <p className="m-0 text-sm text-state-success">저장했습니다.</p> : null}

      {/* 좁은 화면에서 두 버튼이 겹치지 않게 감싼다 */}
      <div className="flex flex-wrap gap-2">
        <ActionButton
          tone="primary"
          size="compact"
          label="저장"
          pendingLabel="저장 중…"
          className="flex-1 justify-center px-4"
        />
        {closeButton}
      </div>
    </form>
  )
}
