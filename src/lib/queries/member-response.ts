/**
 * 답 기다리는 글 — 조회 어댑터. 판정은 src/lib/member-response.ts 하나가 한다(정책 정본도 그 파일 머리 주석).
 *
 * 🔴 실회원 글 정의를 새로 만들지 않는다 — 기존 정본 조각을 **합성만** 한다.
 *    글: 고객 구성의 일반 글(GENERAL_POST_WHERE) 또는 가입인사(GREETING_POST_WHERE) — 둘 다 공개 · 사람이 씀 ·
 *        Persona/운영 작성자 아님(같은 MEMBER_POST_BASE) · NOT_MICRO_SEED_LANE_WHERE · 운영 게시판(OPERATOR_BOARDS)
 *    글쓴이: onboardedBaseWhere(카카오 실회원 · 온보딩 · 관리자 아님 · 운영 allowlist 아님) · 운영 차단 아님
 * 🔴 쿼리 4개(글 · 댓글 · 글쓴이 차단 목록 · 처리 대기 신고) — 글마다 따로 조회하지 않는다(N+1 0). Raw SQL 0.
 * 🔴 db 를 인자로 받는다. 화면은 공용 prisma 를, 격리 DB 검사는 자기 client 를 넘긴다.
 * 🔴 고객 화면에서 import 하지 않는다 — 운영 콘솔 /admin/responses 전용이다.
 */
import type { BoardType, PrismaClient } from '@prisma/client'
import { boardLabel, communityPostHref } from '@/lib/admin-format'
import { displayName } from '@/lib/display-name'
import { GREETING_CATEGORY } from '@/lib/greeting-policy'
import {
  MEMBER_RESPONSE_LIST_MAX,
  MEMBER_RESPONSE_WINDOW_MS,
  isDawnKst,
  judgeMemberPostResponse,
  summarizeMemberResponses,
  type MemberResponseSummary,
  type MemberResponseVerdict,
} from '@/lib/member-response'
import { OPERATOR_BOARDS } from '@/lib/operator-writer'
import { toPreview } from '@/lib/post-html'
import { NOT_MICRO_SEED_LANE_WHERE } from '@/lib/post-visibility'
import { GENERAL_POST_WHERE, GREETING_POST_WHERE, onboardedBaseWhere } from '@/lib/queries/customer-composition'

type Db = Pick<PrismaClient, 'post' | 'comment' | 'userBlock' | 'report'>
type Env = Record<string, string | undefined>

export type MemberResponseRow = {
  id: string
  title: string
  preview: string
  boardType: BoardType
  boardLabel: string
  isGreeting: boolean
  createdAt: Date
  authorName: string
  /** 고객 화면 주소 — 게시판 밖 글이면 null */
  href: string | null
  verdict: MemberResponseVerdict
  isDawn: boolean
  /** 처리 대기(PENDING) 신고가 있다 — 빼지 않고 표시한다 */
  pendingReport: boolean
}

export type MemberResponseBoard = {
  /** 아직 답이 없는 글 — 판정 불가 먼저, 그다음 오래 기다린 순 */
  rows: MemberResponseRow[]
  /** 최근 7일 실회원 글 전체(답함 포함) 요약 */
  summary: MemberResponseSummary
  /** 7일 안 실회원 글이 상한(MEMBER_RESPONSE_LIST_MAX)을 넘어 오래된 것부터 잘랐다 */
  truncated: boolean
}

export async function loadMemberResponseBoard(db: Db, now: Date, env: Env = process.env): Promise<MemberResponseBoard> {
  const since = new Date(now.getTime() - MEMBER_RESPONSE_WINDOW_MS)

  // Q1 — 최근 7일 실회원 글 (오래된 순 · 상한 + 1 로 잘림 여부를 안다)
  const found = await db.post.findMany({
    where: {
      // 🔴 일반 글 ∪ 가입인사 = 실회원 글 전체. 고객 구성이 이미 내보내는 두 조각을 그대로 쓴다(정의 복제 0)
      OR: [GENERAL_POST_WHERE, GREETING_POST_WHERE],
      ...NOT_MICRO_SEED_LANE_WHERE,
      boardType: { in: [...OPERATOR_BOARDS] },
      createdAt: { gte: since },
      author: { is: { ...onboardedBaseWhere(env), isBlocked: false } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: MEMBER_RESPONSE_LIST_MAX + 1,
    select: {
      id: true,
      title: true,
      content: true,
      boardType: true,
      category: true,
      createdAt: true,
      authorId: true,
      author: { select: { nickname: true, name: true } },
    },
  })
  const truncated = found.length > MEMBER_RESPONSE_LIST_MAX
  const posts = found.slice(0, MEMBER_RESPONSE_LIST_MAX)
  if (posts.length === 0) return { rows: [], summary: summarizeMemberResponses([]), truncated }

  const postIds = posts.map((p) => p.id)
  const authorIds = [...new Set(posts.map((p) => p.authorId))]
  const [comments, blocks, reports] = await Promise.all([
    // Q2 — 살아 있는 댓글 (작성자 운영 차단 여부 포함)
    db.comment.findMany({
      where: { postId: { in: postIds }, isDeleted: false },
      select: {
        id: true,
        postId: true,
        parentId: true,
        createdAt: true,
        isDeleted: true,
        authorId: true,
        commentOrigin: true,
        personaId: true,
        operatorWriterId: true,
        author: { select: { isBlocked: true } },
      },
    }),
    // Q3 — 글쓴이가 차단한 사람
    db.userBlock.findMany({ where: { blockerId: { in: authorIds } }, select: { blockerId: true, blockedUserId: true } }),
    // Q4 — 처리 대기 신고가 걸린 글
    db.report.findMany({ where: { status: 'PENDING', postId: { in: postIds } }, select: { postId: true } }),
  ])

  const commentsOf = new Map<string, typeof comments>()
  for (const c of comments) commentsOf.set(c.postId, [...(commentsOf.get(c.postId) ?? []), c])
  const blockedOf = new Map<string, Set<string>>()
  for (const b of blocks) blockedOf.set(b.blockerId, (blockedOf.get(b.blockerId) ?? new Set()).add(b.blockedUserId))
  const reported = new Set(reports.map((r) => r.postId))

  const judged = posts.map((p) => {
    const verdict = judgeMemberPostResponse(
      { authorId: p.authorId, createdAt: p.createdAt },
      (commentsOf.get(p.id) ?? []).map((c) => ({ ...c, authorBlocked: c.author ? c.author.isBlocked : null })),
      blockedOf.get(p.authorId) ?? new Set(),
      now,
    )
    const row: MemberResponseRow = {
      id: p.id,
      title: p.title,
      preview: toPreview(p.content, 140),
      boardType: p.boardType,
      boardLabel: boardLabel(p.boardType),
      isGreeting: p.category === GREETING_CATEGORY,
      createdAt: p.createdAt,
      authorName: displayName(p.author),
      href: communityPostHref(p.id, p.boardType),
      verdict,
      isDawn: isDawnKst(p.createdAt),
      pendingReport: reported.has(p.id),
    }
    return row
  })

  const rows = judged
    .filter((r) => r.verdict.state !== 'answered')
    .sort(
      (a, b) =>
        Number(b.verdict.state === 'unknown') - Number(a.verdict.state === 'unknown') ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
  return { rows, summary: summarizeMemberResponses(judged.map((r) => r.verdict)), truncated }
}
