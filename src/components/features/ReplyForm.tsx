'use client'

import CommentForm from '@/components/features/CommentForm'
import { TOUCH_MIN } from '@/lib/spacing'
import GuestCommentForm from '@/components/features/GuestCommentForm'
import { useReplyOpen } from '@/components/features/ReplyOpenProvider'

export default function ReplyForm({
  postId,
  boardSlug,
  parentId,
  isLoggedIn,
}: {
  postId: string
  boardSlug: string
  parentId: string
  isLoggedIn: boolean
}) {
  const { openParentId, setOpenParentId } = useReplyOpen()
  const open = openParentId === parentId

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpenParentId(parentId)}
        className={`inline-flex ${TOUCH_MIN} items-center rounded-lg px-2 text-sm text-content-muted transition duration-150 hover:text-brand-ink active:scale-[0.98]`}
      >
        답글
      </button>
    )
  }

  return (
    <div className="mt-2 w-full">
      {/* 입력은 만들지 않고 댓글 폼을 그대로 부른다 — 확인 절차·비밀번호·글자수는 그쪽 규칙이다. */}
      {isLoggedIn ? (
        <CommentForm postId={postId} boardSlug={boardSlug} parentId={parentId} />
      ) : (
        <GuestCommentForm postId={postId} boardSlug={boardSlug} parentId={parentId} />
      )}
      <button
        type="button"
        onClick={() => setOpenParentId(null)}
        className={`mt-1 inline-flex ${TOUCH_MIN} items-center px-2 text-sm text-content-muted`}
      >
        그만두기
      </button>
    </div>
  )
}
