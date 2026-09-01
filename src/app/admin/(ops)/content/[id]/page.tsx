import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin'
import { boardLabel, communityPostHref, formatKst, postStatusLabel } from '@/lib/admin-format'
import { REPORT_REASONS } from '@/lib/report-reasons'
import AdminActionButton from '@/components/admin/AdminActionButton'
import AdminPostEditForm from '@/components/admin/AdminPostEditForm'
import AdminCommentEditForm from '@/components/admin/AdminCommentEditForm'
import {
  AdminPageHeader,
  AdminSection,
  AdminBadge,
  AdminEmptyState,
  AdminQuote,
  AdminActionGroup,
} from '@/components/admin/AdminUi'
import { setPostHidden, setCommentHidden } from '@/lib/actions/admin'

/**
 * 게시글 상세 · 수정.
 *
 * 🔴 삭제 버튼을 두지 않는다. 가리기만 한다 —
 *    지우면 신고 근거도 함께 사라져 왜 조치했는지 설명할 수 없다.
 * 🔴 고객 화면 링크를 문자열로 적지 않는다.
 *    실제 경로는 /community/{boardSlug}/{postId} 이고 boardSlug 는 board-registry 가 정한다.
 *    매거진은 하위가 Post.id 가 아니라 파일 slug 라 링크를 만들 수 없다 —
 *    만들 수 없으면 걸지 않는다. 404 로 가는 링크는 없느니만 못하다.
 *
 * 🔴 숨김은 status 만 바꾼다. 그러면 목록·상세·홈 인기글이 함께 따라온다
 *    (post-visibility.ts 3축이 유일한 판정 지점이다).
 *
 * 🔴 화면 순서는 판단 순서다 — 무슨 글인가(머리) → 왜 여기 왔나(신고) →
 *    무엇을 고칠까(본문·댓글) → 내릴까(조치). 조치가 맨 끝인 것은
 *    읽기 전에 손이 먼저 나가지 않게 하려는 것이다.
 */
export const metadata: Metadata = { title: '게시글 상세' }
export const dynamic = 'force-dynamic'

const REASON_LABEL = new Map<string, string>(REPORT_REASONS.map((r) => [r.value, r.label]))

const REPORT_STATUS_LABEL: Record<string, string> = {
  PENDING: '미처리',
  REVIEWED: '확인함',
  RESOLVED: '처리 완료',
}

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

  const deleted = post.status === 'DELETED'
  const hidden = post.status === 'HIDDEN'
  const publicHref = communityPostHref(post.id, post.boardType)
  const pendingReports = post.reports.filter((r) => r.status === 'PENDING').length
  const hiddenComments = post.comments.filter((c) => c.isDeleted).length

  return (
    <main>
      <AdminPageHeader
        backHref="/admin/content"
        title={post.title}
        badges={
          <>
            <AdminBadge>{boardLabel(post.boardType)}</AdminBadge>
            <AdminBadge tone={post.status === 'PUBLISHED' ? 'muted' : 'danger'}>
              {postStatusLabel(post.status)}
            </AdminBadge>
            {post.reports.length > 0 ? (
              <AdminBadge tone="danger">신고 {post.reports.length}건</AdminBadge>
            ) : null}
            <AdminBadge>댓글 {post.comments.length}건</AdminBadge>
          </>
        }
      />

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
              고객 화면에서 보기
            </Link>
          </>
        ) : null}
      </p>

      <AdminSection
        title={`신고 ${post.reports.length}건`}
        description={
          pendingReports > 0
            ? `미처리 ${pendingReports}건 · 처리는 신고 관리에서 합니다`
            : undefined
        }
      >
        {post.reports.length === 0 ? (
          <AdminEmptyState>이 글에 접수된 신고가 없습니다.</AdminEmptyState>
        ) : (
          <ul className="mt-2 flex list-none flex-col gap-2 p-0">
            {post.reports.map((r) => (
              <li key={r.id} className="rounded-lg border border-subtle bg-surface-card p-3">
                <p className="m-0 flex flex-wrap items-center gap-2 text-sm text-content-primary">
                  <AdminBadge tone="brand">
                    {REASON_LABEL.get(r.reason) ?? r.reason}
                  </AdminBadge>
                  <AdminBadge tone={r.status === 'PENDING' ? 'danger' : 'muted'}>
                    {REPORT_STATUS_LABEL[r.status] ?? r.status}
                  </AdminBadge>
                  <span className="text-content-muted">{formatKst(r.createdAt)}</span>
                </p>
                {r.detail ? (
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-content-muted">
                    {r.detail}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <Link href="/admin/reports" className="mt-2 inline-flex min-h-[52px] items-center text-link">
          신고 관리로 가기 →
        </Link>
      </AdminSection>

      <AdminSection
        title="글 내용 고치기"
        description="고쳐도 작성자에게 알림이 가지 않습니다. 원문은 남지 않습니다."
      >
        <div className="mt-2">
          <AdminPostEditForm postId={post.id} title={post.title} content={post.content} />
        </div>
      </AdminSection>

      <AdminSection
        title={`댓글 ${post.comments.length}건`}
        description={hiddenComments > 0 ? `숨긴 댓글 ${hiddenComments}건 포함` : undefined}
      >
        {post.comments.length === 0 ? (
          <AdminEmptyState>아직 달린 댓글이 없습니다.</AdminEmptyState>
        ) : (
          <ul className="mt-2 flex list-none flex-col gap-2 p-0">
            {post.comments.map((c) => (
              <li key={c.id} className="rounded-lg border border-subtle bg-surface-card p-3">
                <p className="m-0 whitespace-pre-wrap break-words text-sm text-content-primary">
                  {c.content}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-content-muted">
                  <Link href={`/admin/members/${c.author.id}`} className="text-link">
                    {c.author.nickname ?? c.author.name ?? '회원'}
                  </Link>
                  <span>{formatKst(c.createdAt)}</span>
                  {c.isDeleted ? <AdminBadge tone="danger">숨김</AdminBadge> : null}
                </p>
                {/* 숨김 댓글도 고칠 수 있다. 고치는 것과 되살리는 것은 다른 판단이라
                    수정 폼과 숨김 버튼을 나란히 두되 서로 건드리지 않는다. */}
                <div className="mt-2 flex flex-wrap gap-2">
                  <AdminCommentEditForm commentId={c.id} content={c.content} />

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
      </AdminSection>

      <section className="mt-8 border-t border-subtle pt-6">
        {deleted ? (
          <>
            <h2 className="m-0 text-sm font-bold text-content-primary">조치</h2>
            <AdminQuote>
              삭제 상태인 글입니다. 이 화면에서는 공개 상태를 바꾸지 않습니다.
            </AdminQuote>
          </>
        ) : (
          <AdminActionGroup
            label={hidden ? '되돌리기' : '위험한 조치'}
            hint={
              hidden
                ? '다시 공개하면 게시판·홈 인기글에 함께 돌아옵니다.'
                : '숨기면 게시판·상세·홈 인기글에서 함께 사라집니다. 글은 지워지지 않습니다.'
            }
          >
            {hidden ? (
              <AdminActionButton
                label="글 다시 공개"
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
          </AdminActionGroup>
        )}
      </section>
    </main>
  )
}
