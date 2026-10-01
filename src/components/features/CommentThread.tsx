import CommentItem from '@/components/features/CommentItem'
import ThreadReplies from '@/components/features/ThreadReplies'
import { formatRelativeTime } from '@/lib/date'
import { THREAD_COLLAPSE_MIN_REPLIES, THREAD_PREVIEW_REPLIES } from '@/lib/comment-policy'
import type { ThreadView } from '@/lib/comment-view'

/**
 * 대화 스레드 하나 — 원댓글은 기존 자리, 후속 답변은 그 아래 대화선 하나(ThreadReplies).
 *
 * 🔴 답글의 답글도 같은 선 안 같은 들여쓰기다. 깊이는 "↳ 누구님에게 답글" 이 말한다.
 * 🔴 면과 구분선은 목록이 진다 — 이 줄은 여백만 갖는다(카드 안에 카드를 만들지 않는다).
 */
export default function CommentThread({
  thread,
  boardSlug,
  postId,
  currentUserId,
  isLoggedIn,
  likedCommentIds,
}: {
  thread: ThreadView
  boardSlug: string
  postId: string
  currentUserId?: string
  isLoggedIn: boolean
  likedCommentIds: Set<string>
}) {
  const item = (c: ThreadView['root']) => (
    <CommentItem
      comment={c}
      boardSlug={boardSlug}
      postId={postId}
      currentUserId={currentUserId}
      isLoggedIn={isLoggedIn}
      isLiked={likedCommentIds.has(c.id)}
    />
  )
  const root = thread.root
  const rootLabel = root.state === 'live' ? `${root.name}님 댓글` : '삭제되거나 차단된 댓글'

  return (
    <li className="px-4 py-4">
      {item(root)}
      {thread.replies.length > 0 ? (
        <ThreadReplies
          threadId={root.id}
          rootId={root.id}
          label={`${rootLabel}에 달린 답글 ${thread.replies.length}개`}
          items={thread.replies.map((r) => ({ id: r.id, node: item(r) }))}
          collapsible={thread.replies.length >= THREAD_COLLAPSE_MIN_REPLIES}
          preview={THREAD_PREVIEW_REPLIES}
          lastReply={
            thread.lastReply ? `${formatRelativeTime(thread.lastReply.createdAt)} · ${thread.lastReply.name}` : null
          }
        />
      ) : null}
    </li>
  )
}
