import { GUEST_BADGE } from '@/lib/guest-comment-policy'

/**
 * 이름 바로 오른쪽 배지 — 글쓴이 · 비회원.
 *
 * 🔴 "글쓴이" 는 게시글 작성자의 살아 있는 댓글에만 붙는다(comment-view.ts 가 판정한다).
 *    비대화식 정보라 테두리·그림자·hover 를 주지 않는다 — 버튼처럼 보이면 누르게 된다.
 * 🔴 비회원 배지는 기존 모양 그대로다.
 */
export const POST_AUTHOR_BADGE = '글쓴이'

export default function CommentBadges({ isPostAuthor, isGuest }: { isPostAuthor: boolean; isGuest: boolean }) {
  return (
    <>
      {isPostAuthor ? (
        <span className="whitespace-nowrap rounded bg-surface-soft px-1.5 py-0.5 font-bold text-brand-strong">
          {POST_AUTHOR_BADGE}
        </span>
      ) : null}
      {isGuest ? (
        <span className="whitespace-nowrap rounded bg-surface-page px-1.5 py-0.5 text-content-muted">{GUEST_BADGE}</span>
      ) : null}
    </>
  )
}
