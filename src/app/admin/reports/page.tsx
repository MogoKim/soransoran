import type { Metadata } from 'next'
import Link from 'next/link'
import Header from '@/components/layouts/Header'
import { requireAdmin } from '@/lib/admin'
import { prisma } from '@/lib/prisma'
import { REPORT_REASONS } from '@/lib/report-reasons'

/**
 * 신고 확인 화면 — 읽기 전용
 *
 * 🔴 상태 변경 · 삭제 · 자동 조치를 구현하지 않는다.
 *    운영자가 "무엇이 신고됐는지" 볼 수 있게 하는 것이 목적이다.
 *    조치가 필요하면 Supabase 에서 직접 처리한다.
 */
export const metadata: Metadata = {
  title: '신고 확인',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

const REASON_LABEL = new Map<string, string>(REPORT_REASONS.map((r) => [r.value, r.label]))

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(value)
}

export default async function AdminReportsPage() {
  const { ok } = await requireAdmin()

  if (!ok) {
    return (
      <>
        <Header />
        <main className="mx-auto max-w-3xl px-4 py-16 text-center">
          <h1 className="text-xl font-bold text-content-primary">접근 권한이 없습니다</h1>
          <p className="mt-2 text-sm text-content-muted">운영자만 볼 수 있는 화면입니다.</p>
          <Link href="/" className="mt-6 inline-block text-link">
            홈으로 가기
          </Link>
        </main>
      </>
    )
  }

  const reports = await prisma.report.findMany({
    select: {
      id: true,
      postId: true,
      commentId: true,
      reason: true,
      detail: true,
      status: true,
      createdAt: true,
      reporter: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl px-4 pb-16">
        <h1 className="pt-8 text-xl font-bold text-content-primary">신고 확인</h1>
        <p className="mt-1 text-sm text-content-muted">
          읽기 전용입니다. 최근 200건 · 총 {reports.length}건
        </p>

        {reports.length === 0 ? (
          <p className="py-16 text-center text-content-muted">접수된 신고가 없습니다.</p>
        ) : (
          <ul className="mt-6 flex list-none flex-col gap-3 p-0">
            {reports.map((report) => (
              <li
                key={report.id}
                className="rounded-lg border border-subtle bg-surface-card p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-surface-soft px-2 py-1 text-xs font-bold text-brand-ink">
                    {REASON_LABEL.get(report.reason) ?? report.reason}
                  </span>
                  <span className="text-xs text-content-muted">{report.status}</span>
                  <span className="text-xs text-content-muted">
                    {formatDate(report.createdAt)}
                  </span>
                </div>

                <p className="mt-2 text-sm text-content-primary">
                  대상:{' '}
                  {report.postId ? (
                    <span>글 {report.postId}</span>
                  ) : (
                    <span>댓글 {report.commentId}</span>
                  )}
                </p>

                {report.detail ? (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-content-primary">
                    {report.detail}
                  </p>
                ) : null}

                <p className="mt-2 text-xs text-content-muted">
                  신고자: {report.reporter.name ?? '회원'} ({report.reporter.id})
                </p>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  )
}
