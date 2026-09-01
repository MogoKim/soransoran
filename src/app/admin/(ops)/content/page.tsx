import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin'
import { boardLabel, formatKst, postStatusLabel } from '@/lib/admin-format'
import {
  AdminPageHeader,
  AdminCard,
  AdminBadge,
  AdminEmptyState,
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
    <main>
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
        <ul className="mt-6 flex list-none flex-col gap-3 p-0">
          {posts.map((p) => (
            <li key={p.id}>
              <AdminCard href={`/admin/content/${p.id}`}>
                <span className="flex flex-wrap items-center gap-2">
                  <AdminBadge>{boardLabel(p.boardType)}</AdminBadge>
                  {p.status !== 'PUBLISHED' ? (
                    <AdminBadge tone="danger">{postStatusLabel(p.status)}</AdminBadge>
                  ) : null}
                  {p._count.reports > 0 ? (
                    <AdminBadge tone="danger">신고 {p._count.reports}건</AdminBadge>
                  ) : null}
                </span>
                <span className="break-words font-bold text-content-primary">{p.title}</span>
                <span className="text-sm text-content-muted">
                  {p.author.nickname ?? p.author.name ?? '회원'} · {formatKst(p.createdAt)} · 댓글{' '}
                  {p._count.comments}
                </span>
              </AdminCard>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
