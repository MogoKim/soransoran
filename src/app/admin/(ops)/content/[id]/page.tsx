import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin'
import { communityPostHref, formatKst } from '@/lib/admin-format'
import { REPORT_REASONS } from '@/lib/report-reasons'
import { getBoardByType } from '@/lib/board-registry'
import AdminActionButton from '@/components/admin/AdminActionButton'
import AdminPostEditForm from '@/components/admin/AdminPostEditForm'
import { setPostHidden, setCommentHidden } from '@/lib/actions/admin'

/**
 * 게시글 상세 · 수정.
 *
 * 🔴 삭제 버튼을 두지 않는다. 가리기만 한다 —
 *    지우면 신고 근거도 함께 사라져 왜 조치했는지 설명할 수 없다.
 * 🔴 고객 화면 링크를 문자열로 적지 않는다.
 *    실제 경로는 /community/{boardSlug}/{postId} 이고 boardSlug 는 board-registry 가 정한다.
 *    단일 세그먼트 글 경로(예전 형태)는 이 서비스에 없다 — 눌러도 404 가 난다.
 *
 * 🔴 숨김은 status 만 바꾼다. 그러면 목록·상세·홈 인기글이 함께 따라온다
 *    (post-visibility.ts 3축이 유일한 판정 지점이다).
 */
export const metadata: Metadata = { title: '게시글 상세' }
export const dynamic = 'force-dynamic'

const REASON_LABEL = new Map<string, string>(REPORT_REASONS.map((r) => [r.value, r.label]))

export default async function AdminContentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { ok } = await requireAdmin()
  if (!ok) return null

  const { id } = await params

  const post = await prisma.post.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      content: true,
      boardType: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      author: { select: { id: true, nickname: true, name: true } },
      comments: {
        select: {
          id: true,
          content: true,
          isDeleted: true,
          createdAt: true,
          author: { select: { id: true, nickname: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
      reports: {
        select: { id: true, reason: true, detail: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  if (!post) notFound()

  const hidden = post.status !== 'PUBLISHED'
  const board = getBoardByType(post.boardType)
  // 매거진 글은 커뮤니티 상세 경로가 없다(하위가 Post.id 가 아니라 파일 slug 다).
  // 링크를 만들 수 없으면 걸지 않는다 — 404 로 가는 링크는 없느니만 못하다.
  const publicHref = communityPostHref(post.id, post.boardType)

  return (
    <main>
      <Link href="/admin/content" className="mt-6 inline-flex min-h-[52px] items-center text-link">
        ← 목록으로
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-surface-soft px-2 py-1 text-xs text-content-muted">
          {board?.label ?? post.boardType}
        </span>
        <span
          className={
            hidden
              ? 'rounded-md bg-surface-soft px-2 py-1 text-xs font-bold text-state-danger'
              : 'rounded-md bg-surface-soft px-2 py-1 text-xs text-content-muted'
          }
        >
          {post.status}
        </span>
      </div>

      <p className="mt-2 text-sm text-content-muted">
        <Link href={`/admin/members/${post.author.id}`} className="text-link">
          {post.author.nickname ?? post.author.name ?? '회원'}
        </Link>{' '}
        · 작성 {formatKst(post.createdAt)} · 수정 {formatKst(post.updatedAt)}
        {publicHref ? (
          <>
            {' '}
            ·{' '}
            <Link href={publicHref} className="text-link">
              고객 화면
            </Link>
          </>
        ) : null}
      </p>

      <section className="mt-4">
        <h2 className="text-sm font-bold text-content-primary">내용 수정</h2>
        <div className="mt-2">
          <AdminPostEditForm postId={post.id} title={post.title} content={post.content} />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-bold text-content-primary">
          신고 {post.reports.length}건
        </h2>
        {post.reports.length === 0 ? (
          <p className="py-4 text-sm text-content-muted">이 글에 접수된 신고가 없습니다.</p>
        ) : (
          <ul className="mt-2 flex list-none flex-col gap-2 p-0">
            {post.reports.map((r) => (
              <li key={r.id} className="rounded-lg border border-subtle bg-surface-card p-3">
                <p className="m-0 text-sm text-content-primary">
                  {REASON_LABEL.get(r.reason) ?? r.reason} · {r.status} · {formatKst(r.createdAt)}
                </p>
                {r.detail ? (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-content-muted">{r.detail}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <Link href="/admin/reports" className="mt-2 inline-flex min-h-[52px] items-center text-link">
          신고 관리로 가기
        </Link>
      </section>

      <section className="mt-4">
        <h2 className="text-sm font-bold text-content-primary">
          댓글 {post.comments.length}건
        </h2>
        {post.comments.length === 0 ? (
          <p className="py-4 text-sm text-content-muted">댓글이 없습니다.</p>
        ) : (
          <ul className="mt-2 flex list-none flex-col gap-2 p-0">
            {post.comments.map((c) => (
              <li key={c.id} className="rounded-lg border border-subtle bg-surface-card p-3">
                <p className="m-0 whitespace-pre-wrap text-sm text-content-primary">{c.content}</p>
                <p className="mt-1 text-xs text-content-muted">
                  <Link href={`/admin/members/${c.author.id}`} className="text-link">
                    {c.author.nickname ?? c.author.name ?? '회원'}
                  </Link>{' '}
                  · {formatKst(c.createdAt)}
                  {c.isDeleted ? ' · 숨김' : ''}
                </p>
                <div className="mt-2">
                  {c.isDeleted ? (
                    <AdminActionButton
                      label="댓글 다시 보이기"
                      run={async () => {
                        'use server'
                        return setCommentHidden(c.id, false)
                      }}
                    />
                  ) : (
                    <AdminActionButton
                      label="댓글 숨기기"
                      tone="danger"
                      confirmText="이 댓글을 숨길까요? 내용은 남고 화면에서만 가려집니다."
                      run={async () => {
                        'use server'
                        return setCommentHidden(c.id, true)
                      }}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 border-t border-subtle pt-4">
        <h2 className="text-sm font-bold text-content-primary">조치</h2>
        <p className="mt-1 text-sm text-content-muted">
          {post.status === 'DELETED'
            ? '삭제 상태인 글입니다. 이 화면에서는 상태를 바꾸지 않습니다.'
            : '숨기면 목록·상세·홈 인기글에서 함께 사라집니다. 글은 지워지지 않습니다.'}
        </p>
        <div className="mt-3">
          {post.status === 'DELETED' ? null : hidden ? (
            <AdminActionButton
              label="다시 공개"
              run={async () => {
                'use server'
                return setPostHidden(post.id, false)
              }}
            />
          ) : (
            <AdminActionButton
              label="글 숨기기"
              tone="danger"
              confirmText="이 글을 숨길까요? 고객 화면에서 바로 사라집니다."
              run={async () => {
                'use server'
                return setPostHidden(post.id, true)
              }}
            />
          )}
        </div>
      </section>
    </main>
  )
}
