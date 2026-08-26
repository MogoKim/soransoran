import { formatRelativeTime } from '@/lib/date'
import DeleteButton from '@/components/features/DeleteButton'
import ReportButton from '@/components/features/ReportButton'

export type CommentItemData = {
  id: string
  content: string
  createdAt: Date
  author: { id: string; name: string | null }
}

type CommentItemProps = {
  comment: CommentItemData
  boardSlug: string
  postId: string
  /** 비로그인이면 undefined */
  currentUserId?: string
}

export default function CommentItem({
  comment,
  boardSlug,
  postId,
  currentUserId,
}: CommentItemProps) {
  const isOwn = currentUserId === comment.author.id

  return (
    <li className="rounded-lg bg-surface-card p-4">
      <div className="flex flex-wrap items-center gap-x-2 text-xs text-content-muted">
        <span className="font-bold text-brand-ink">{comment.author.name ?? '회원'}</span>
        <span aria-hidden>·</span>
        <span>{formatRelativeTime(comment.createdAt)}</span>
      </div>

      <p className="mt-2 whitespace-pre-wrap break-keep leading-[1.7] text-content-primary [overflow-wrap:anywhere]">
        {comment.content}
      </p>

      {currentUserId ? (
        // 오른쪽 끝으로 민다 — 본문 왼쪽 아래에 두면 읽는 줄 바로 밑이라 잘못 눌린다
        <div className="mt-2 flex justify-end">
          {isOwn ? (
            <DeleteButton boardSlug={boardSlug} postId={postId} commentId={comment.id} />
          ) : (
            <ReportButton commentId={comment.id} />
          )}
        </div>
      ) : null}
    </li>
  )
}
