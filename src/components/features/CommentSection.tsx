import CommentForm from '@/components/features/CommentForm'
import GuestCommentForm from '@/components/features/GuestCommentForm'
import CommentItem, { type CommentItemData } from '@/components/features/CommentItem'

export default function CommentSection({
  comments,
  boardSlug,
  postId,
  isLoggedIn,
  currentUserId,
}: {
  comments: CommentItemData[]
  boardSlug: string
  postId: string
  isLoggedIn: boolean
  /** 비로그인이면 undefined */
  currentUserId?: string
}) {
  return (
    <section className="mt-8">
      <h2 className="m-0 border-b-2 border-subtle pb-3 text-lg font-bold text-content-primary">
        댓글 <span className="text-brand-ink">{comments.length}</span>
      </h2>

      {comments.length === 0 ? (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-subtle bg-surface-card p-8 text-center">
          <p className="m-0 font-bold text-content-primary">아직 댓글이 없어요</p>
          <p className="m-0 text-sm leading-relaxed text-content-muted">
            짧아도 괜찮습니다. 첫 마디를 남겨보세요.
          </p>
        </div>
      ) : (
        <ul className="m-0 mt-4 flex list-none flex-col overflow-hidden rounded-2xl border border-subtle bg-surface-card p-0 [&>li+li]:border-t [&>li+li]:border-subtle">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              boardSlug={boardSlug}
              postId={postId}
              currentUserId={currentUserId}
            />
          ))}
        </ul>
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
