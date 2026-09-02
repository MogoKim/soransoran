import CommentForm from '@/components/features/CommentForm'
import GuestCommentForm from '@/components/features/GuestCommentForm'
import CommentItem, { type CommentItemData } from '@/components/features/CommentItem'
import SortableCommentList from '@/components/features/SortableCommentList'
import { displayName } from '@/lib/display-name'
import { GUEST_BADGE } from '@/lib/guest-comment-policy'
import {
  COMMENT_SORT_TABS_MIN,
  POPULAR_COMMENT_MIN_COMMENTS,
  POPULAR_COMMENT_MIN_LIKES,
  POPULAR_COMMENT_TAKE,
} from '@/lib/comment-policy'

const LIST_CLASS =
  'm-0 mt-4 flex list-none flex-col overflow-hidden rounded-2xl border border-subtle bg-surface-card p-0 [&>li+li]:border-t [&>li+li]:border-subtle'

export default function CommentSection({
  comments,
  boardSlug,
  postId,
  isLoggedIn,
  currentUserId,
  likedCommentIds,
}: {
  comments: CommentItemData[]
  boardSlug: string
  postId: string
  isLoggedIn: boolean
  /** 비로그인이면 undefined */
  currentUserId?: string
  /** 이 사람이 공감한 댓글 id. 비로그인이면 비어 있다 */
  likedCommentIds: Set<string>
}) {
  /* 이미 받아 둔 배열 안에서 고른다 — 이것 때문에 DB 를 다시 읽지 않는다.
     정렬은 안정 정렬이라 공감 수가 같으면 등록순이 그대로 남는다. */
  const popular =
    comments.length >= POPULAR_COMMENT_MIN_COMMENTS
      ? [...comments]
          .filter((c) => c.likeCount >= POPULAR_COMMENT_MIN_LIKES)
          .sort((a, b) => b.likeCount - a.likeCount)
          .slice(0, POPULAR_COMMENT_TAKE)
      : []

  return (
    <section className="mt-8">
      <h2 className="m-0 border-b-2 border-subtle pb-3 text-lg font-bold text-content-primary">
        댓글 <span className="text-brand-ink">{comments.length}</span>
      </h2>

      {/* 🔴 여기에는 공감 버튼을 두지 않는다. 같은 댓글의 버튼이 위아래로 둘이면
            한쪽만 눌린 채로 갈라져, 어느 숫자가 맞는지 알 수 없게 된다.
            이 칸은 "먼저 보여주는" 자리이고, 누르는 일은 아래 목록에서 한다. */}
      {popular.length > 0 ? (
        <div className="mt-4 rounded-2xl bg-surface-soft p-4">
          <p className="m-0 text-xs font-bold text-brand-ink">많이 공감한 댓글</p>
          <ul className="m-0 mt-2 flex list-none flex-col gap-3 p-0">
            {popular.map((comment) => (
              <li key={comment.id}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-content-muted">
                  <span className="font-bold text-brand-ink">
                    {comment.author ? displayName(comment.author) : (comment.guestNickname ?? '비회원')}
                  </span>
                  {comment.author === null ? (
                    <span className="rounded bg-surface-card px-1.5 py-0.5 text-content-muted">
                      {GUEST_BADGE}
                    </span>
                  ) : null}
                  <span aria-hidden>·</span>
                  <span>공감 {comment.likeCount}</span>
                </div>
                {/* 전문은 아래 목록에 그대로 있다 — 여기서는 두 줄까지만 보여준다 */}
                <p className="mt-1 line-clamp-2 break-keep leading-[1.7] text-content-primary [overflow-wrap:anywhere]">
                  {comment.content}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {comments.length === 0 ? (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-subtle bg-surface-card p-8 text-center">
          <p className="m-0 font-bold text-content-primary">아직 댓글이 없어요</p>
          <p className="m-0 text-sm leading-relaxed text-content-muted">
            짧아도 괜찮습니다. 첫 마디를 남겨보세요.
          </p>
        </div>
      ) : (
        <SortableCommentList
          showTabs={comments.length >= COMMENT_SORT_TABS_MIN}
          listClassName={LIST_CLASS}
          items={comments.map((comment) => ({
            id: comment.id,
            likeCount: comment.likeCount,
            node: (
              <CommentItem
                comment={comment}
                boardSlug={boardSlug}
                postId={postId}
                currentUserId={currentUserId}
                isLoggedIn={isLoggedIn}
                isLiked={likedCommentIds.has(comment.id)}
              />
            ),
          }))}
        />
      )}

      {/* 입력은 만들지 않고 있는 것을 부른다 — 확인 절차·비밀번호·글자수는 각 폼의 규칙이다. */}
      <div className="mt-4">
        {isLoggedIn ? (
          <CommentForm postId={postId} boardSlug={boardSlug} />
        ) : (
          <GuestCommentForm postId={postId} boardSlug={boardSlug} />
        )}
      </div>
    </section>
  )
}
