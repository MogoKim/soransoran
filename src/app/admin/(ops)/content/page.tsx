import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin'
import { boardLabel, formatKst } from '@/lib/admin-format'
import {
  AdminPageHeader,
  AdminBadge,
  AdminStatusBadge,
  AdminEmptyState,
  AdminTable,
  AdminTableRow,
  AdminCell,
} from '@/components/admin/AdminUi'

/**
 * 게시글 목록.
 *
 * 🔴 노출 판정 where 를 쓰지 않는다. 어드민은 숨긴 글도 봐야 한다 —
 *    숨긴 글이 목록에서 사라지면 되돌릴 방법이 없다.
 * 🔴 신고 수는 대상 글의 Report 수다. 상태와 무관하게 전부 센다.
 *
 * 🔴 한 줄에서 판단이 끝나게 한다 — 게시판 · 상태 · 신고 수 · 제목 · 작성자 · 댓글 수.
 *    신고와 숨김은 눈에 걸려야 하므로 제목 위에 배지로 올린다.
 */
export const metadata: Metadata = { title: '게시글 관리' }
export const dynamic = 'force-dynamic'

const TAKE = 100

/** 데스크탑 열 폭. 머리줄과 각 줄이 같은 값을 써야 칸이 맞는다. */
const COLS = 'lg:grid-cols-[minmax(0,1fr)_6rem_8rem_9rem_7rem]'

export default async function AdminContentPage() {
  const { ok } = await requireAdmin()
  if (!ok) return null

  const [total, posts] = await Promise.all([
    prisma.post.count(),
    prisma.post.findMany({
      select: {
        id: true,
        title: true,
        boardType: true,
        status: true,
        createdAt: true,
        author: { select: { id: true, nickname: true, name: true } },
        _count: { select: { comments: true, reports: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: TAKE,
    }),
  ])

  return (
    <main className="pt-2 lg:pt-0">
      <AdminPageHeader
        title="게시글"
        description={
          total > posts.length
            ? `전체 ${total}건 · 최신순 ${posts.length}건 표시 · 숨긴 글도 함께 보입니다`
            : `전체 ${total}건 · 최신순 · 숨긴 글도 함께 보입니다`
        }
      />

      {posts.length === 0 ? (
        <AdminEmptyState>아직 올라온 글이 없습니다.</AdminEmptyState>
      ) : (
        <AdminTable
          columns={COLS}
          head={
            <>
              <span>제목</span>
              <span>게시판</span>
              <span>작성자</span>
              <span>작성일</span>
              <span>상태</span>
            </>
          }
        >
          {posts.map((p) => (
            <AdminTableRow key={p.id} href={`/admin/content/${p.id}`} columns={COLS}>
              <span className="min-w-0 break-words font-bold text-content-primary">{p.title}</span>

              <AdminCell label="게시판">{boardLabel(p.boardType)}</AdminCell>

              <AdminCell label="작성자">
                {p.author.nickname ?? p.author.name ?? '회원'}
              </AdminCell>

              <AdminCell label="작성">{formatKst(p.createdAt)}</AdminCell>

              {/* 🔴 가려진 글과 신고 있는 글이 눈에 걸려야 한다. 나머지는 조용히 둔다. */}
              <span className="flex flex-wrap items-center gap-1">
                {p.status !== 'PUBLISHED' ? (
                  <AdminStatusBadge kind="post" value={p.status} />
                ) : null}
                {p._count.reports > 0 ? (
                  <AdminBadge tone="danger">신고 {p._count.reports}</AdminBadge>
                ) : null}
                <AdminBadge>댓글 {p._count.comments}</AdminBadge>
              </span>
            </AdminTableRow>
          ))}
        </AdminTable>
      )}

    </main>
  )
}
