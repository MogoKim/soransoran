import type { ReactNode } from 'react'
import CommentForm from '@/components/features/CommentForm'
import GuestCommentForm from '@/components/features/GuestCommentForm'
import CommentThread from '@/components/features/CommentThread'
import ThreadNavProvider from '@/components/features/ThreadNavProvider'
import CommentComposeAnchor from '@/components/features/CommentComposeAnchor'
import ComposeModeProvider from '@/components/features/ComposeModeProvider'
import SortableCommentList from '@/components/features/SortableCommentList'
import { countLiveComments, type ThreadView } from '@/lib/comment-view'
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
  threads,
  boardSlug,
  postId,
  isLoggedIn,
  currentUserId,
  likedCommentIds,
  afterComments,
}: {
  /** 대화 스레드 — 원댓글 + 시간순 후속 답변(getPostDetail · comment-thread) */
  threads: ThreadView[]
  boardSlug: string
  postId: string
  isLoggedIn: boolean
  /** 비로그인이면 undefined */
  currentUserId?: string
  /** 이 사람이 공감한 댓글 id. 비로그인이면 비어 있다 */
  likedCommentIds: Set<string>
  /**
   * 공개 댓글·답글 목록 바로 뒤, 입력창 앞에 놓는 선택 슬롯. 감싸는 DOM 을 더하지 않는다.
   * 🔴 작성 모드 provider 안에 있다 — 넣은 쪽이 useComposeMode 를 읽을 수 있다. 없으면 아무것도 그리지 않는다.
   */
  afterComments?: ReactNode
}) {
  /* 답글도 사람이 남긴 말이라 함께 센다. 지운 댓글 · 차단한 회원의 댓글은 세지 않는다(예전과 같은 기준). */
  const totalCount = countLiveComments(threads)

  /* 정렬되는 것은 스레드(원댓글 단위)다 — 탭을 열지 말지는 살아 있는 원댓글 수로 정한다. */
  const liveRoots = threads.map((t) => t.root).filter((c) => c.state === 'live')
  const sortableCount = liveRoots.length

  /* 답글과 지운·차단 자리는 넣지 않는다 — 앞뒤 없는 대답과 본문 없는 자리는 보여줄 것이 없다. */
  const popular =
    totalCount >= POPULAR_COMMENT_MIN_COMMENTS
      ? [...liveRoots]
          .filter((c) => c.likeCount >= POPULAR_COMMENT_MIN_LIKES)
          .sort((a, b) => b.likeCount - a.likeCount)
          .slice(0, POPULAR_COMMENT_TAKE)
      : []

  return (
    <section className="mt-8">
      <h2 className="m-0 border-b-2 border-subtle pb-3 text-lg font-bold text-content-primary">
        댓글 <span className="text-brand-ink">{totalCount}</span>
      </h2>

      {/* 🔴 여기에는 공감 버튼을 두지 않는다. 같은 댓글의 버튼이 위아래로 둘이면
            한쪽만 눌린 채로 갈라져, 어느 숫자가 맞는지 알 수 없게 된다.
            이 칸은 "먼저 보여주는" 자리이고, 누르는 일은 아래 목록에서 한다. */}
      {popular.length > 0 ? (
        <div className="mt-4 rounded-2xl bg-surface-soft p-4">
          <p className="m-0 text-xs font-bold text-brand-strong">많이 공감한 댓글</p>
          <ul className="m-0 mt-2 flex list-none flex-col gap-3 p-0">
            {popular.map((comment) => (
              <li key={comment.id}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-content-muted">
                  <span className="font-bold text-brand-strong">{comment.name}</span>
                  {comment.isGuest ? (
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

      {/* 답글 · 댓글 수정 · 하단 진입 바가 같은 열림 상태를 본다 — 작성 자리가 둘이 되지 않게. */}
      <ComposeModeProvider>
        <ThreadNavProvider>
          {threads.length === 0 ? (
            <div className="mt-4 flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-subtle bg-surface-card p-8 text-center">
              <p className="m-0 font-bold text-content-primary">아직 댓글이 없어요</p>
              <p className="m-0 text-sm leading-relaxed text-content-muted">
                짧아도 괜찮습니다. 첫 마디를 남겨보세요.
              </p>
            </div>
          ) : (
            <SortableCommentList
              showTabs={sortableCount >= COMMENT_SORT_TABS_MIN}
              listClassName={LIST_CLASS}
              items={threads.map((thread) => ({
                id: thread.root.id,
                // 공감순은 원댓글 공감으로 스레드째 옮긴다 — 답글만 따로 떠오르지 않는다
                likeCount: thread.root.likeCount,
                node: (
                  <CommentThread
                    thread={thread}
                    boardSlug={boardSlug}
                    postId={postId}
                    currentUserId={currentUserId}
                    isLoggedIn={isLoggedIn}
                    likedCommentIds={likedCommentIds}
                  />
                ),
              }))}
            />
          )}

          {afterComments}

          {/* 입력은 만들지 않고 있는 것을 부른다 — 확인 절차·비밀번호·글자수는 각 폼의 규칙이다.
                🔴 key 로 글마다 새로 만든다. 같은 경로 모양(/[boardSlug]/[postId])을 오갈 때
                   React 가 같은 자리로 보고 상태를 이어 주면, 앞 글에서 뜬 바가 다음 글
                   첫 화면에 그대로 남는다. */}
          <CommentComposeAnchor key={postId}>
            {isLoggedIn ? (
              <CommentForm postId={postId} boardSlug={boardSlug} />
            ) : (
              <GuestCommentForm postId={postId} boardSlug={boardSlug} />
            )}
          </CommentComposeAnchor>
        </ThreadNavProvider>
      </ComposeModeProvider>
    </section>
  )
}
