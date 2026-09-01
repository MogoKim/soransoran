import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin'
import { formatKst } from '@/lib/admin-format'

/**
 * 게시글 목록.
 *
 * 🔴 노출 판정 where 를 쓰지 않는다. 어드민은 숨긴 글도 봐야 한다 —
 *    숨긴 글이 목록에서 사라지면 되돌릴 방법이 없다.
 * 🔴 신고 수는 대상 글의 Report 수다. 상태와 무관하게 전부 센다.
 */
export const metadata: Metadata = { title: '게시글 관리' }
export const dynamic = 'force-dynamic'

const TAKE = 100

const BOARD_LABEL: Record<string, string> = {
  MENOPAUSE: '갱년기톡',
  FREE: '자유',
  MAGAZINE: '매거진',
}

export default async function AdminContentPage() {
  const { ok } = await requireAdmin()
  if (!ok) return null

  const posts = await prisma.post.findMany({
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
  })

  return (
    <main>
      <h1 className="pt-8 text-xl font-bold text-content-primary">게시글 관리</h1>
      <p className="mt-1 text-sm text-content-muted">
        최신순 {TAKE}건까지 · 총 {posts.length}건 · 숨긴 글도 함께 보입니다
      </p>

      {posts.length === 0 ? (
        <p className="py-16 text-center text-content-muted">글이 없습니다.</p>
      ) : (
        <ul className="mt-6 flex list-none flex-col gap-3 p-0">
          {posts.map((p) => (
            <li key={p.id}>
              <Link
                href={`/admin/content/${p.id}`}
                className="flex min-h-[52px] flex-col gap-1 rounded-lg border border-subtle bg-surface-card p-4 no-underline"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-surface-soft px-2 py-1 text-xs text-content-muted">
                    {BOARD_LABEL[p.boardType] ?? p.boardType}
                  </span>
                  {p.status !== 'PUBLISHED' ? (
                    <span className="rounded-md bg-surface-soft px-2 py-1 text-xs font-bold text-state-danger">
                      {p.status === 'HIDDEN' ? '숨김' : '삭제'}
                    </span>
                  ) : null}
                  {p._count.reports > 0 ? (
                    <span className="rounded-md bg-surface-soft px-2 py-1 text-xs font-bold text-state-danger">
                      신고 {p._count.reports}
                    </span>
                  ) : null}
                </span>
                <span className="font-bold text-content-primary">{p.title}</span>
                <span className="text-sm text-content-muted">
                  {p.author.nickname ?? p.author.name ?? '회원'} · {formatKst(p.createdAt)} · 댓글{' '}
                  {p._count.comments}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
