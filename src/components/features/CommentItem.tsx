import { formatRelativeTime } from '@/lib/date'
import CommentEditor from '@/components/features/CommentEditor'
import GuestCommentControls from '@/components/features/GuestCommentControls'
import ReportButton from '@/components/features/ReportButton'
import CommentLikeButton from '@/components/features/CommentLikeButton'
import ReplyForm from '@/components/features/ReplyForm'
import ReplyTargetLink from '@/components/features/ReplyTargetLink'
import CommentBadges from '@/components/features/CommentBadges'
import CommentIcon from '@/components/icons/CommentIcon'
import { CommentStateBadge } from '@/components/features/ThreadNavProvider'
import { BLOCKED_COMMENT, DELETED_COMMENT } from '@/lib/comment-policy'
import { commentAnchorId, type CommentView } from '@/lib/comment-view'

/**
 * 댓글 한 개 — 원댓글이든 답글이든 같은 컴포넌트다.
 *
 * 🔴 답글이면 맨 위에 "↳ 누구님에게 답글" 한 줄이 있다(직접 대상). 들여쓰기는 스레드가 한 단계로 고정한다.
 * 🔴 살아 있는 댓글에는 모두 "답글" 이 있다 — 답글의 답글도 된다.
 * 🔴 지운 · 차단한 회원의 댓글은 자리만 남는다(뒤에 살아 있는 대답이 있을 때만 여기 온다).
 *    이름 · 본문 · 배지 · 조작을 하나도 내보내지 않는다 — comment-view 가 이미 비웠고, 여기서도 그리지 않는다.
 *    대상 줄은 남긴다. 그 줄은 **다른** 댓글을 가리키므로 이 댓글의 정보를 되살리지 않는다.
 * 🔴 수정 · 삭제 · 신고 · 공감 · 비회원 고치기는 기존 컴포넌트를 그대로 쓴다.
 */
const ARTICLE =
  'scroll-mt-24 rounded-lg transition-colors duration-700 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 data-[flash=true]:bg-surface-soft'

export default function CommentItem({
  comment,
  boardSlug,
  postId,
  currentUserId,
  isLoggedIn,
  isLiked,
}: {
  comment: CommentView
  boardSlug: string
  postId: string
  /** 비로그인이면 undefined */
  currentUserId?: string
  isLoggedIn: boolean
  /** 이 사람이 이 댓글에 이미 공감했는가 */
  isLiked: boolean
}) {
  const replyLine = comment.replyTo ? <ReplyTargetLink fromId={comment.id} target={comment.replyTo} /> : null

  if (comment.state !== 'live') {
    const text = comment.state === 'blocked' ? BLOCKED_COMMENT : DELETED_COMMENT
    return (
      <article id={commentAnchorId(comment.id)} tabIndex={-1} aria-label={text} className={`${ARTICLE} py-1`}>
        {replyLine}
        <p className="m-0 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm italic text-content-muted">
          <CommentIcon name={comment.state === 'blocked' ? 'blocked' : 'deleted'} />
          <span>{text}</span>
          <span className="text-meta not-italic">
            <CommentStateBadge commentId={comment.id} />
          </span>
        </p>
      </article>
    )
  }

  /**
   * 🔴 본인 판정은 회원 댓글에만 쓴다.
   *    authorId 가 null 인 비회원 댓글에서 currentUserId 와 비교하면
   *    둘 다 undefined 인 비로그인 방문자에게 남의 댓글이 "내 댓글" 로 열린다.
   */
  const isOwn = Boolean(comment.authorId && currentUserId === comment.authorId)
  const name = comment.name ?? ''

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
        <ReplyForm
          postId={postId}
          boardSlug={boardSlug}
          parentId={comment.id}
          isLoggedIn={isLoggedIn}
          target={{ name, isPostAuthor: comment.isPostAuthor, isGuest: comment.isGuest, content: comment.content }}
        />
      </div>
    </>
  )

  const label = comment.replyTo
    ? `${name}님의 답글. ${comment.replyTo.state === 'live' ? `${comment.replyTo.name}님에게` : comment.replyTo.state === 'blocked' ? '차단한 회원의 댓글에 대한 답글' : '삭제된 댓글에 대한 답글'}`
    : `${name}님 댓글`

  return (
    <article id={commentAnchorId(comment.id)} tabIndex={-1} aria-label={label} className={ARTICLE}>
      {replyLine}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-content-muted">
        {/* 🔴 작성자 이름은 자르지 않는다. 길면 이름 전체가 줄을 바꾼다 */}
        <span className="min-w-0 break-keep font-bold text-brand-strong [overflow-wrap:anywhere]">{name}</span>
        <CommentBadges isPostAuthor={comment.isPostAuthor} isGuest={comment.isGuest} />
        {/* "· 시간" 은 한 덩어리 — 줄이 바뀌어도 점이 앞줄 끝에 매달리지 않는다 */}
        <span className="inline-flex gap-2 whitespace-nowrap">
          <span aria-hidden>·</span>
          <span>{formatRelativeTime(comment.createdAt)}</span>
        </span>
        <CommentStateBadge commentId={comment.id} />
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
      ) : comment.isGuest ? (
        <>
          {body}
          {/* 비회원 댓글은 비밀번호로 고치고 지운다. 신고는 1차 범위가 아니다. */}
          <GuestCommentControls commentId={comment.id} boardSlug={boardSlug} content={comment.content} />
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
    </article>
  )
}
