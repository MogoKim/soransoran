import { prisma } from '@/lib/prisma'
import { displayName } from '@/lib/display-name'
// 🔴 게시판 이름·경로는 board-registry 가 유일한 출처다. 여기서 문자열로 적지 않는다
import { boardLabel, communityPostHref, formatKst } from '@/lib/admin-format'
import { toPreview } from '@/lib/post-html'
import { OPERATOR_BOARDS, judgeOperatorReplyPost, type OperatorBoard } from '@/lib/operator-writer'
import {
  NOT_MICRO_SEED_LANE_WHERE, POST_VISIBILITY_SELECT, belongsToMicroSeedLane, pickPostVisibility,
} from '@/lib/post-visibility'

/**
 * 운영자 직접 작성 화면이 읽는 것 — 🔴 **read-only. write 0**
 *
 * 🔴 **권한 확인은 여기서 하지 않는다.** 부르는 쪽(page·action)이 `requireAdmin()` 을
 *    먼저 지난다. 조회 함수가 인증까지 맡으면 어디서 막혔는지 알 수 없어진다.
 *
 * 🔴 이 파일은 고객 화면에서 import 되지 않는다.
 */

export type WriterOption = {
  id: string
  code: string
  /** 공개 화면에 실제로 보일 이름. 🔴 `displayName` 정본을 그대로 쓴다 */
  name: string
  note: string | null
}

/**
 * 고를 수 있는 작성자.
 *
 * 🔴 **`active` 만 싣는다.** retired 는 이미 쓴 글의 작성자로 남을 뿐 새 글을 쓰지 않는다.
 * 🔴 **자동 Persona 는 애초에 이 표에 없다.** 화면에서 거르는 것이 아니라
 *    `OperatorWriter` 와 `Persona` 가 다른 표이기 때문이다 — 빠뜨릴 필터가 없다.
 */
export async function getOperatorWriters(): Promise<WriterOption[]> {
  const rows = await prisma.operatorWriter.findMany({
    where: { status: 'active' },
    orderBy: { code: 'asc' },
    select: {
      id: true,
      code: true,
      note: true,
      user: { select: { nickname: true, name: true } },
    },
  })
  return rows.map((w) => ({
    id: w.id,
    code: w.code,
    name: displayName(w.user),
    note: w.note,
  }))
}

export type ComposeTargetPost = {
  id: string
  title: string
  boardType: OperatorBoard
  boardLabel: string
  authorName: string
  commentCount: number
  createdAt: Date
  href: string | null
}

/**
 * 댓글을 달 대상 글 목록.
 *
 * 🔴 **공개된 커뮤니티 글만 싣는다.** 매거진은 게시판이 아니라 콘텐츠 영역이고,
 *    베스트는 모아보기다 — 둘 다 글쓰기 진입점이 없다(IA 정본).
 * 🔴 **최근 것부터 조금만.** 이 화면은 글 목록이 아니라 "지금 답을 달 자리" 다.
 */
export async function getComposeTargetPosts(limit = 30): Promise<ComposeTargetPost[]> {
  const rows = await prisma.post.findMany({
    where: { status: 'PUBLISHED', boardType: { in: [...OPERATOR_BOARDS] } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      title: true,
      boardType: true,
      createdAt: true,
      author: { select: { nickname: true, name: true } },
      _count: { select: { comments: true } },
    },
  })
  return rows.map((p) => ({
    id: p.id,
    title: p.title,
    boardType: p.boardType as OperatorBoard,
    boardLabel: boardLabel(p.boardType),
    authorName: displayName(p.author),
    commentCount: p._count.comments,
    createdAt: p.createdAt,
    href: communityPostHref(p.id, p.boardType),
  }))
}

/** 작성자 대댓글 — 답할 수 있는 댓글 한 줄. 🔴 본문 전체가 아니라 발췌다 */
export type ReplyTargetComment = {
  id: string
  /** 최상위 댓글이면 null */
  parentId: string | null
  authorName: string
  guest: boolean
  preview: string
  createdAtLabel: string
  /** 스레드 들여쓰기 — 고객 화면처럼 한 단계만 */
  isReply: boolean
}

/** 작성자 대댓글 — 원글 한 편과 그 글의 살아 있는 댓글 */
export type ReplyTargetPost = {
  id: string
  title: string
  boardLabel: string
  /** 🔴 원글 작성자 이름 — 대댓글이 이 이름으로 올라간다(고르는 값이 아니라 보여 주는 값) */
  writerName: string
  writerCode: string
  /** 원글 자격이 깨졌으면 그 이유. null 이면 대댓글을 달 수 있다 */
  blocked: string | null
  href: string | null
  comments: ReplyTargetComment[]
}

/**
 * 작성자 대댓글을 달 원글 — 🔴 운영 직접 작성 글만.
 *
 * 🔴 자동 운영 자산(Persona · Micro Seed · 오리지널 큐)과 숨김 글 · 매거진은 처음부터 싣지 않는다.
 *    작성자 자격이 깨진 글(retired · 작성자 불일치 등)은 **싣되 이유를 함께** 싣는다 — 목록에서 조용히 빠지면
 *    운영자는 왜 안 보이는지 알 수 없다. 판정은 트랜잭션과 같은 함수(judgeOperatorReplyPost)다.
 * 🔴 지워진 댓글은 고를 수 없으므로 싣지 않는다. 댓글 순서는 고객 화면과 같다 — 뿌리 아래 답글이 시간순.
 */
export async function getReplyTargetPosts(limit = 20, commentLimit = 60): Promise<ReplyTargetPost[]> {
  const rows = await prisma.post.findMany({
    where: {
      operatorWriterId: { not: null },
      personaId: null,
      status: 'PUBLISHED',
      boardType: { in: [...OPERATOR_BOARDS] },
      originalPostQueue: { is: null },
      ...NOT_MICRO_SEED_LANE_WHERE,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true, title: true, boardType: true, personaId: true, operatorWriterId: true, authorId: true,
      ...POST_VISIBILITY_SELECT,
      originalPostQueue: { select: { id: true } },
      operatorWriter: {
        select: {
          code: true, userId: true, status: true,
          user: { select: { nickname: true, name: true, providerId: true, persona: { select: { id: true } }, _count: { select: { accounts: true } } } },
        },
      },
      comments: {
        where: { isDeleted: false },
        orderBy: { createdAt: 'asc' },
        take: commentLimit,
        select: {
          id: true, parentId: true, content: true, createdAt: true, guestNickname: true,
          author: { select: { nickname: true, name: true } },
        },
      },
    },
  })

  return rows.map((p) => {
    const w = p.operatorWriter
    const verdict = judgeOperatorReplyPost({
      status: p.status,
      boardType: p.boardType,
      personaId: p.personaId,
      microSeedLane: belongsToMicroSeedLane(pickPostVisibility(p)),
      originalQueueLinked: p.originalPostQueue !== null,
      operatorWriterId: p.operatorWriterId,
      authorId: p.authorId,
      writerUserId: w?.userId ?? null,
      writer: w === null ? null : {
        status: w.status, accountCount: w.user._count.accounts, providerId: w.user.providerId, hasPersona: w.user.persona !== null,
      },
    })
    // 스레드 순서 — 각 댓글의 뿌리(최상위 댓글)를 따라 올라가 묶는다. 부모가 목록에 없으면(지워짐 등) 스스로 뿌리다
    const byId = new Map(p.comments.map((c) => [c.id, c]))
    const rootOf = (id: string): string => {
      let cur = byId.get(id)
      for (let i = 0; cur?.parentId && byId.has(cur.parentId) && i < 50; i += 1) cur = byId.get(cur.parentId)
      return cur?.id ?? id
    }
    const roots = p.comments.filter((c) => rootOf(c.id) === c.id)
    const ordered = roots.flatMap((r) => [r, ...p.comments.filter((c) => c.id !== r.id && rootOf(c.id) === r.id)])
    return {
      id: p.id,
      title: p.title,
      boardLabel: boardLabel(p.boardType),
      writerName: w ? displayName(w.user) : '—',
      writerCode: w?.code ?? '—',
      blocked: verdict.ok ? null : verdict.reason,
      href: communityPostHref(p.id, p.boardType),
      comments: ordered.map((c) => ({
        id: c.id,
        parentId: c.parentId,
        authorName: c.author ? displayName(c.author) : (c.guestNickname ?? '비회원'),
        guest: c.author === null,
        preview: c.content.length > 80 ? `${c.content.slice(0, 80)}…` : c.content,
        createdAtLabel: formatKst(c.createdAt),
        isReply: c.parentId !== null,
      })),
    }
  })
}

export type ComposedPost = {
  kind: 'post'
  id: string
  writerName: string
  writerCode: string
  title: string
  /**
   * 🔴 **원문 그대로다.** 수정 폼이 이 값을 defaultValue 로 받는다 —
   *    발췌(`preview`)를 넘기면 고치기를 눌렀다 저장하는 것만으로 본문이 잘린다.
   */
  content: string
  preview: string
  boardLabel: string
  hidden: boolean
  createdAt: Date
  href: string | null
}

export type ComposedComment = {
  kind: 'comment'
  id: string
  writerName: string
  writerCode: string
  /** 🔴 원문 그대로. 수정 폼이 이 값을 받는다 (ComposedPost.content 와 같은 이유) */
  content: string
  preview: string
  postTitle: string
  hidden: boolean
  createdAt: Date
  href: string | null
}

export type ComposedItem = ComposedPost | ComposedComment

/**
 * 이 도구로 쓴 것만 모아 보여 준다.
 *
 * 🔴 **`operatorWriterId` 로 거른다.** 작성자 User 로 거르지 않는다 —
 *    같은 사람이 다른 경로로 쓴 것이 섞이면 "여기서 고쳐도 되는 것" 의 경계가 흐려진다.
 * 🔴 가려진 것(HIDDEN·isDeleted)도 싣는다. 무엇을 내렸는지 운영자가 알아야 한다.
 */
export async function getComposedItems(limit = 40): Promise<ComposedItem[]> {
  const [posts, comments] = await Promise.all([
    prisma.post.findMany({
      where: { operatorWriterId: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true, title: true, content: true, boardType: true, status: true, createdAt: true,
        operatorWriter: { select: { code: true, user: { select: { nickname: true, name: true } } } },
      },
    }),
    prisma.comment.findMany({
      where: { operatorWriterId: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true, content: true, isDeleted: true, createdAt: true, postId: true,
        post: { select: { title: true, boardType: true } },
        operatorWriter: { select: { code: true, user: { select: { nickname: true, name: true } } } },
      },
    }),
  ])

  const items: ComposedItem[] = [
    ...posts.map((p): ComposedPost => ({
      kind: 'post',
      id: p.id,
      writerCode: p.operatorWriter?.code ?? '—',
      writerName: p.operatorWriter ? displayName(p.operatorWriter.user) : '—',
      title: p.title,
      content: p.content,
      preview: toPreview(p.content, 80),
      boardLabel: boardLabel(p.boardType),
      hidden: p.status !== 'PUBLISHED',
      createdAt: p.createdAt,
      href: communityPostHref(p.id, p.boardType),
    })),
    ...comments.map((c): ComposedComment => ({
      kind: 'comment',
      id: c.id,
      writerCode: c.operatorWriter?.code ?? '—',
      writerName: c.operatorWriter ? displayName(c.operatorWriter.user) : '—',
      content: c.content,
      preview: toPreview(c.content, 80),
      postTitle: c.post.title,
      hidden: c.isDeleted,
      createdAt: c.createdAt,
      href: communityPostHref(c.postId, c.post.boardType),
    })),
  ]

  // 🔴 두 표를 합쳐 시간순으로 다시 세운다. 화면에서 정렬하지 않는다
  items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  return items.slice(0, limit)
}

/** 수정 화면이 읽는 한 건. 🔴 이 도구의 것이 아니면 null — 권한 판정은 액션이 다시 한다 */
export async function getComposedPost(id: string) {
  return prisma.post.findFirst({
    where: { id, operatorWriterId: { not: null } },
    select: {
      id: true, title: true, content: true, boardType: true, status: true,
      operatorWriter: { select: { code: true, user: { select: { nickname: true, name: true } } } },
    },
  })
}

export async function getComposedComment(id: string) {
  return prisma.comment.findFirst({
    where: { id, operatorWriterId: { not: null } },
    select: {
      id: true, content: true, isDeleted: true, postId: true,
      post: { select: { title: true, boardType: true } },
      operatorWriter: { select: { code: true, user: { select: { nickname: true, name: true } } } },
    },
  })
}
