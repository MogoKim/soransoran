import CommentBadges from '@/components/features/CommentBadges'
import { BLOCKED_COMMENT, DELETED_COMMENT } from '@/lib/comment-policy'

/** 답글 작성칸 맨 위 — 누구에게, 무엇에 답하는지 */
export type ReplyTargetInfo = {
  name: string
  isPostAuthor: boolean
  isGuest: boolean
  /** 대상 댓글 본문. 작성칸에서 두 줄까지만 보인다 */
  content: string
}

/** 쓰는 도중 대상이 쓸 수 없게 된 사유 — 서버가 돌려준 code 에서 온다 */
export type ReplyTargetGone = 'deleted' | 'blocked' | null

export function replyTargetGoneOf(code: string | undefined): ReplyTargetGone {
  if (code === 'TARGET_GONE') return 'deleted'
  if (code === 'TARGET_BLOCKED') return 'blocked'
  return null
}

/**
 * 🔴 대상 원문 미리보기는 **작성칸에만** 둔다. 댓글마다 인용 상자를 반복하지 않는다.
 * 🔴 쓰는 도중 대상이 지워졌거나(deleted) 차단한 회원의 댓글이면(blocked) 이름·원문을 보여 주지 않는다.
 *    두 사유는 문구를 가른다 — 지운 것은 쓴 사람의 일, 차단은 보는 사람의 일이다. 쓴 글은 폼이 그대로 둔다.
 * 🔴 줄 제한은 안쪽 글자에만 건다. 바깥 여백 안으로 셋째 줄이 비치지 않게.
 */
export default function ReplyTargetHeader({ target, gone }: { target: ReplyTargetInfo; gone: ReplyTargetGone }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-content-secondary">
        {gone ? (
          <span>{gone === 'blocked' ? '차단한 회원의 댓글에 답글' : '삭제된 댓글에 답글'}</span>
        ) : (
          <>
            <span className="break-keep [overflow-wrap:anywhere]">
              <b className="text-content-primary">{target.name}</b>님에게 답글
            </span>
            <span className="flex gap-2 text-meta">
              <CommentBadges isPostAuthor={target.isPostAuthor} isGuest={target.isGuest} />
            </span>
          </>
        )}
      </p>
      <blockquote
        aria-label="답하는 댓글"
        className="m-0 rounded-r-lg border-l-[3px] border-subtle bg-surface-page px-2.5 py-1.5 text-sm leading-[1.6] text-content-secondary"
      >
        <span className="line-clamp-2 break-keep [overflow-wrap:anywhere]">
          {gone === 'blocked' ? BLOCKED_COMMENT : gone === 'deleted' ? DELETED_COMMENT : `“${target.content}”`}
        </span>
      </blockquote>
    </div>
  )
}
