import { formatRelativeTime } from '@/lib/date'
import { displayName } from '@/lib/display-name'
import CommentEditor from '@/components/features/CommentEditor'
import GuestCommentControls from '@/components/features/GuestCommentControls'
import ReportButton from '@/components/features/ReportButton'
import CommentLikeButton from '@/components/features/CommentLikeButton'
import ReplyForm from '@/components/features/ReplyForm'
import { GUEST_BADGE } from '@/lib/guest-comment-policy'
import { DELETED_COMMENT } from '@/lib/comment-policy'

export type CommentItemData = {
  id: string
  content: string
  createdAt: Date
  /** 🔴 비회원 댓글은 null 이다. 이 자리를 non-null 로 두면 화면이 터진다. */
  author: { id: string; name: string | null; nickname: string | null } | null
  /** author 가 null 일 때 화면에 부를 이름 */
  guestNickname?: string | null
  likeCount: number
  /** 지워진 부모는 자리만 남는다 — 아래 답글을 보여주기 위해서다 */
  isDeleted?: boolean
}

export type CommentWithReplies = CommentItemData & { replies: CommentItemData[] }

type CommentItemProps = {
  comment: CommentItemData
  boardSlug: string
  postId: string
  /** 비로그인이면 undefined */
  currentUserId?: string
  isLoggedIn: boolean
  /** 이 사람이 이 댓글에 이미 공감했는가 */
  isLiked: boolean
  /** 부모 아래에 붙는 줄. 답글에는 답글을 달 수 없다 */
  isReply?: boolean
  /** 이 댓글에 달린 답글. 답글에는 없다 */
  replies?: CommentItemData[]
  /** 답글의 공감 여부를 부모가 함께 넘긴다 */
  likedCommentIds?: Set<string>
}

export default function CommentItem({
  comment,
  boardSlug,
  postId,
  currentUserId,
  isLoggedIn,
  isLiked,
  isReply = false,
  replies = [],
  likedCommentIds,
}: CommentItemProps) {
  /**
   * 🔴 본인 판정은 회원 댓글에만 쓴다.
   *    author 가 null 인 비회원 댓글에서 currentUserId 와 비교하면
   *    둘 다 undefined 인 비로그인 방문자에게 남의 댓글이 "내 댓글" 로 열린다.
   */
  const isOwn = Boolean(comment.author && currentUserId === comment.author.id)
  const isGuest = comment.author === null

  /* 왼쪽 선이 "위 이야기에 딸린 말" 이라고 알려 준다. */
  const replyList =
    replies.length > 0 ? (
      <ul className="m-0 mt-3 flex list-none flex-col gap-3 border-l-2 border-subtle p-0 pl-3">
        {replies.map((reply) => (
          <CommentItem
            key={reply.id}
            comment={reply}
            boardSlug={boardSlug}
            postId={postId}
            currentUserId={currentUserId}
            isLoggedIn={isLoggedIn}
            isLiked={Boolean(likedCommentIds?.has(reply.id))}
            isReply
          />
        ))}
      </ul>
    ) : null

  /* 🔴 지워진 부모는 자리만 남는다 — 이름도 본문도 손잡이도 내보내지 않는다. */
  if (comment.isDeleted) {
    return (
      <li className="px-4 py-4">
        <p className="m-0 text-sm italic text-content-muted">{DELETED_COMMENT}</p>
        {replyList}
      </li>
    )
  }

  // 🔴 본문은 여기서 한 번만 그린다.
  //    본인 댓글은 이것을 CommentEditor 에 넘겨 읽기 모드로 쓰게 한다 —
  //    고치기 화면을 붙이려고 같은 문단을 client 쪽에 또 적지 않는다.
  //    공감도 여기 둔다 — 고치는 중에는 함께 사라지는 것이 맞다.
  const body = (
    <>
      <p className="mt-1.5 whitespace-pre-wrap break-keep leading-[1.7] text-content-primary [overflow-wrap:anywhere]">
        {comment.content}
      </p>
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
        <CommentLikeButton
          commentId={comment.id}
          likeCount={comment.likeCount}
          isLiked={isLiked}
          isLoggedIn={isLoggedIn}
        />
        {/* 🔴 답글에는 답글 버튼이 없다 — 1단계까지만. 서버도 같은 규칙을 다시 본다. */}
        {isReply ? null : (
          <ReplyForm
            postId={postId}
            boardSlug={boardSlug}
            parentId={comment.id}
            isLoggedIn={isLoggedIn}
          />
        )}
      </div>
    </>
  )

  return (
    /* 면과 구분선은 목록이 진다 — 이 줄은 여백만 갖는다. */
    <li className={isReply ? 'py-1' : 'px-4 py-4'}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-content-muted">
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

      {replyList}
    </li>
  )
}
