/**
 * 댓글 스레드를 화면에 넘길 모양으로 바꾼다 — 순수 함수.
 *
 * 🔴 **지운 댓글 · 차단한 회원의 댓글은 여기서 이름·본문·작성자를 비운다.**
 *    화면 컴포넌트가 조심하는 것으로는 부족하다 — 넘어간 값은 client 로 직렬화될 수 있다.
 *    그래서 넘기기 전에 없앤다. 남는 것은 id · 상태 · 시각 · 대상 관계뿐이다.
 * 🔴 "글쓴이" 는 게시글 작성자의 **살아 있는** 댓글에만 붙는다.
 */
import { displayName } from '@/lib/display-name'
import type { CommentThread, EntryState, ThreadEntry, ThreadRow } from '@/lib/comment-thread'

/** 댓글 한 개의 문서 안 주소 — 대상 이동 · 등록 직후 포커스 · 댓글 링크(#comment-<id>)가 같은 이름을 쓴다 */
export const commentAnchorId = (id: string) => `comment-${id}`

export type CommentSourceRow = ThreadRow & {
  content: string
  guestNickname: string | null
  likeCount: number
  author: { id: string; name: string | null; nickname: string | null; image: string | null } | null
}

/** 답글 대상 — 살아 있는 대상만 이름을 가진다 */
export type ReplyToView =
  | { id: string; state: 'live'; name: string; isPostAuthor: boolean; isGuest: boolean }
  | { id: string; state: 'deleted' | 'blocked' }

export type CommentView = {
  id: string
  state: EntryState
  createdAt: Date
  /** 지운·차단 댓글은 빈 문자열 */
  content: string
  /** 화면에 부를 이름. 지운·차단 댓글은 null */
  name: string | null
  /** 회원 댓글이면 작성자 id(본인 판정용). 비회원·지운·차단은 null */
  authorId: string | null
  isGuest: boolean
  isPostAuthor: boolean
  likeCount: number
  replyTo: ReplyToView | null
}

export type ThreadView = {
  root: CommentView
  replies: CommentView[]
  /** 접힌 스레드에 보일 "마지막 답글" — 살아 있는 답글이 없으면 null */
  lastReply: { name: string; createdAt: Date } | null
}

function nameOf(row: CommentSourceRow): string {
  return row.author ? displayName(row.author) : (row.guestNickname ?? '비회원')
}

function toView(e: ThreadEntry<CommentSourceRow>, postAuthorId: string): CommentView {
  const live = e.state === 'live'
  const row = e.row
  let replyTo: ReplyToView | null = null
  if (e.replyTo) {
    // comment-thread 는 살아 있는 대상에만 row 를 준다 — row 가 없으면 이름을 만들 재료도 없다
    const t = e.replyTo.row
    replyTo = t
      ? { id: t.id, state: 'live', name: nameOf(t), isPostAuthor: t.authorId === postAuthorId, isGuest: t.author === null }
      : { id: e.replyTo.id, state: e.replyTo.state === 'blocked' ? 'blocked' : 'deleted' }
  }
  return {
    id: row.id,
    state: e.state,
    createdAt: row.createdAt,
    content: live ? row.content : '',
    name: live ? nameOf(row) : null,
    authorId: live ? row.authorId : null,
    isGuest: live && row.author === null,
    isPostAuthor: live && row.authorId !== null && row.authorId === postAuthorId,
    likeCount: live ? row.likeCount : 0,
    replyTo,
  }
}

export function toThreadViews(threads: CommentThread<CommentSourceRow>[], postAuthorId: string): ThreadView[] {
  return threads.map((t) => ({
    root: toView(t.root, postAuthorId),
    replies: t.replies.map((e) => toView(e, postAuthorId)),
    lastReply: t.lastReply ? { name: nameOf(t.lastReply.row), createdAt: t.lastReply.row.createdAt } : null,
  }))
}

/** 화면에 보이는 살아 있는 댓글 수 — 댓글 머리의 숫자 */
export function countLiveComments(threads: ThreadView[]): number {
  return threads.reduce((n, t) => n + [t.root, ...t.replies].filter((c) => c.state === 'live').length, 0)
}
