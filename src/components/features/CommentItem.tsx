import { formatRelativeTime } from '@/lib/date'
import { displayName } from '@/lib/display-name'
import CommentEditor from '@/components/features/CommentEditor'
import GuestCommentControls from '@/components/features/GuestCommentControls'
import ReportButton from '@/components/features/ReportButton'
import { GUEST_BADGE } from '@/lib/guest-comment-policy'

export type CommentItemData = {
  id: string
  content: string
  createdAt: Date
  /** 🔴 비회원 댓글은 null 이다. 이 자리를 non-null 로 두면 화면이 터진다. */
  author: { id: string; name: string | null; nickname: string | null } | null
  /** author 가 null 일 때 화면에 부를 이름 */
  guestNickname?: string | null
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
  /**
   * 🔴 본인 판정은 회원 댓글에만 쓴다.
   *    author 가 null 인 비회원 댓글에서 currentUserId 와 비교하면
   *    둘 다 undefined 인 비로그인 방문자에게 남의 댓글이 "내 댓글" 로 열린다.
   */
  const isOwn = Boolean(comment.author && currentUserId === comment.author.id)
  const isGuest = comment.author === null

  // 🔴 본문은 여기서 한 번만 그린다.
  //    본인 댓글은 이것을 CommentEditor 에 넘겨 읽기 모드로 쓰게 한다 —
  //    고치기 화면을 붙이려고 같은 문단을 client 쪽에 또 적지 않는다.
  const body = (
    <p className="mt-2 whitespace-pre-wrap break-keep leading-[1.7] text-content-primary [overflow-wrap:anywhere]">
      {comment.content}
    </p>
  )

  return (
    /* 🔴 댓글은 바탕 위에 직접 놓인다 — 흰 면과 바탕이 1.05:1 이라 면만으로는 카드가 서지 않는다.
          그래서 선으로 세운다. 매거진의 쉬는 칩과 같은 이유다. */
    <li className="rounded-lg border border-subtle bg-surface-card p-4">
      <div className="flex flex-wrap items-center gap-x-2 text-xs text-content-muted">
        <span className="font-bold text-brand-ink">
          {comment.author ? displayName(comment.author) : (comment.guestNickname ?? '비회원')}
        </span>
        {isGuest ? (
          <span className="rounded bg-surface-page px-1.5 py-0.5 text-content-muted">
            {GUEST_BADGE}
          </span>
        ) : null}
        <span aria-hidden>·</span>
        <span>{formatRelativeTime(comment.createdAt)}</span>
      </div>

      {isOwn ? (
        <CommentEditor
          commentId={comment.id}
          postId={postId}
          boardSlug={boardSlug}
          initialContent={comment.content}
        >
          {body}
        </CommentEditor>
      ) : isGuest ? (
        <>
          {body}
          {/* 비회원 댓글은 비밀번호로 고치고 지운다. 신고는 1차 범위가 아니다. */}
          <GuestCommentControls
            commentId={comment.id}
            boardSlug={boardSlug}
            content={comment.content}
          />
        </>
      ) : (
        <>
          {body}
          {currentUserId ? (
            // 오른쪽 끝으로 민다 — 본문 왼쪽 아래에 두면 읽는 줄 바로 밑이라 잘못 눌린다
            <div className="mt-2 flex justify-end">
              <ReportButton commentId={comment.id} />
            </div>
          ) : null}
        </>
      )}
    </li>
  )
}
