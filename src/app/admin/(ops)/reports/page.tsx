import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin'
import { formatKst } from '@/lib/admin-format'
import { REPORT_REASONS } from '@/lib/report-reasons'
import AdminActionButton from '@/components/admin/AdminActionButton'
import { setReportStatus, setPostHidden, setCommentHidden } from '@/lib/actions/admin'

/**
 * 신고 관리 — 확인하고 처리한다.
 *
 * 🔴 "확인함/처리함" 과 "글을 가림" 을 한 버튼으로 묶지 않는다.
 *    신고가 타당한지와 글을 내릴지는 다른 판단이다. 묶으면 되돌릴 수 없다.
 *
 * 🔴 처리 사유를 남기지 않는다 — Report 에 사유 컬럼이 없다(1차 스키마 무변경).
 *    필요해지면 컬럼을 먼저 만든다.
 *
 * 🔴 삭제하지 않는다. 글은 HIDDEN, 댓글은 isDeleted 로만 가린다.
 *
 * 🔴 최신 N건을 받아 그 안에서 PENDING 을 고르지 않는다.
 *    신고가 쌓이면 오래된 미처리가 N건 밖으로 밀려 화면에서 사라진다 —
 *    가장 오래 방치된 건이 가장 먼저 안 보이게 된다.
 *    PENDING 과 처리분을 각각 따로 조회한다.
 *
 * 🔴 미처리 수는 count 로 센다. 실은 목록의 길이가 아니다.
 *
 * 미처리는 오래된 순이다 — 가장 오래 기다린 신고가 맨 위로 온다.
 */
export const metadata: Metadata = { title: '신고 관리' }
export const dynamic = 'force-dynamic'

/** 한 번에 싣는 최대 건수 — 미처리·처리분 각각에 적용한다 */
const TAKE = 100
const REASON_LABEL = new Map<string, string>(REPORT_REASONS.map((r) => [r.value, r.label]))

const STATUS_LABEL: Record<string, string> = {
  PENDING: '미처리',
  REVIEWED: '확인함',
  RESOLVED: '처리 완료',
}

export default async function AdminReportsPage() {
  const { ok } = await requireAdmin()
  if (!ok) return null

  // 미처리와 처리분이 같은 필드를 읽는다. 두 번 적으면 한쪽만 고쳐지는 날이 온다.
  const SELECT = {
    id: true,
    postId: true,
    commentId: true,
    reason: true,
    detail: true,
    status: true,
    createdAt: true,
    reviewedAt: true,
    reporter: { select: { id: true, nickname: true, name: true } },
    post: { select: { id: true, title: true, status: true } },
    comment: { select: { id: true, content: true, isDeleted: true, postId: true } },
  } as const

  const [pendingCount, pending, handled] = await Promise.all([
    prisma.report.count({ where: { status: 'PENDING' } }),
    prisma.report.findMany({
      where: { status: 'PENDING' },
      select: SELECT,
      orderBy: { createdAt: 'asc' },
      take: TAKE,
    }),
    prisma.report.findMany({
      where: { status: { not: 'PENDING' } },
      select: SELECT,
      orderBy: { createdAt: 'desc' },
      take: TAKE,
    }),
  ])

  const ordered = [...pending, ...handled]

  return (
    <main>
      <h1 className="pt-8 text-xl font-bold text-content-primary">신고 관리</h1>
      <p className="mt-1 text-sm text-content-muted">
        미처리 {pendingCount}건 (오래된 순) · 처리분 최근 {handled.length}건 · 한 번에 {TAKE}건까지
        싣습니다
      </p>

      {ordered.length === 0 ? (
        <p className="py-16 text-center text-content-muted">접수된 신고가 없습니다.</p>
      ) : (
        <ul className="mt-6 flex list-none flex-col gap-3 p-0">
          {ordered.map((report) => {
            const targetPostId = report.post?.id ?? report.comment?.postId ?? null
            const postHidden = report.post ? report.post.status !== 'PUBLISHED' : false

            return (
              <li
                key={report.id}
                className="rounded-lg border border-subtle bg-surface-card p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-surface-soft px-2 py-1 text-xs font-bold text-brand-ink">
                    {REASON_LABEL.get(report.reason) ?? report.reason}
                  </span>
                  <span
                    className={
                      report.status === 'PENDING'
                        ? 'rounded-md bg-surface-soft px-2 py-1 text-xs font-bold text-state-danger'
                        : 'rounded-md bg-surface-soft px-2 py-1 text-xs text-content-muted'
                    }
                  >
                    {STATUS_LABEL[report.status] ?? report.status}
                  </span>
                  <span className="text-xs text-content-muted">{formatKst(report.createdAt)}</span>
                  {report.reviewedAt ? (
                    <span className="text-xs text-content-muted">
                      확인 {formatKst(report.reviewedAt)}
                    </span>
                  ) : null}
                </div>

                {report.post ? (
                  <p className="mt-2 text-sm text-content-primary">
                    대상 글:{' '}
                    <Link href={`/admin/content/${report.post.id}`} className="text-link">
                      {report.post.title}
                    </Link>
                    {postHidden ? ' (숨김 상태)' : ''}
                  </p>
                ) : report.comment ? (
                  <div className="mt-2">
                    <p className="m-0 text-sm text-content-primary">
                      대상 댓글{report.comment.isDeleted ? ' (숨김 상태)' : ''}:
                    </p>
                    <p className="mt-1 whitespace-pre-wrap rounded-lg bg-surface-soft p-2 text-sm text-content-primary">
                      {report.comment.content}
                    </p>
                    {targetPostId ? (
                      <Link href={`/admin/content/${targetPostId}`} className="text-sm text-link">
                        글에서 보기
                      </Link>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-content-muted">대상이 이미 사라졌습니다.</p>
                )}

                {report.detail ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-content-muted">
                    신고 내용: {report.detail}
                  </p>
                ) : null}

                <p className="mt-2 text-xs text-content-muted">
                  신고자:{' '}
                  <Link href={`/admin/members/${report.reporter.id}`} className="text-link">
                    {report.reporter.nickname ?? report.reporter.name ?? '회원'}
                  </Link>
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  {report.status === 'PENDING' ? (
                    <AdminActionButton
                      label="확인함으로 표시"
                      run={async () => {
                        'use server'
                        return setReportStatus(report.id, 'REVIEWED')
                      }}
                    />
                  ) : null}

                  {report.status !== 'RESOLVED' ? (
                    <AdminActionButton
                      label="처리 완료"
                      run={async () => {
                        'use server'
                        return setReportStatus(report.id, 'RESOLVED')
                      }}
                    />
                  ) : (
                    <AdminActionButton
                      label="미처리로 되돌리기"
                      tone="danger"
                      run={async () => {
                        'use server'
                        return setReportStatus(report.id, 'PENDING')
                      }}
                    />
                  )}

                  {report.post && !postHidden ? (
                    <AdminActionButton
                      label="대상 글 숨기기"
                      tone="danger"
                      confirmText="이 글을 숨길까요? 고객 화면에서 바로 사라집니다."
                      run={async () => {
                        'use server'
                        return setPostHidden(report.post!.id, true)
                      }}
                    />
                  ) : null}

                  {report.comment && !report.comment.isDeleted ? (
                    <AdminActionButton
                      label="대상 댓글 숨기기"
                      tone="danger"
                      confirmText="이 댓글을 숨길까요? 내용은 남고 화면에서만 가려집니다."
                      run={async () => {
                        'use server'
                        return setCommentHidden(report.comment!.id, true)
                      }}
                    />
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
