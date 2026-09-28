import type { Metadata } from 'next'
import Link from 'next/link'
import PageShell from '@/components/layouts/PageShell'
import AutoReadyDefectReportForm from '@/components/admin/AutoReadyDefectReportForm'
import { requireAdmin } from '@/lib/admin'
import { prisma } from '@/lib/prisma'
import { listReportablePosts, type ReportableRow } from '@/lib/auto-ready-audit-store'

/**
 * 자동 READY 결함 신고 (관리자 전용)
 *
 * 🔴 auto-ready:v1 로 **자동 발행된 글**에 운영자가 중대 결함을 신고하는 자리다.
 *    신고는 감사 표에 결함 yes 로 남고, 그 즉시 다음 자동 도장·발행이 닫힌다.
 * 🔴 신고자·시각은 서버가 로그인 세션과 서버 시계로 정한다 — 이 화면에는 그 칸이 없다.
 * 🔴 서버 컴포넌트다. 신고 폼 하나만 client 다.
 */
export const metadata: Metadata = {
  title: '자동 READY 결함 신고',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

const auditLabel = (r: ReportableRow): string =>
  r.audit === null ? '감사 대상 아님'
    : r.audit.defect === null ? (r.audit.retryable === null ? '감사 대기' : `감사 실패 — 재시도 대기 (${r.audit.retryable})`)
      : r.audit.defect === 'yes' ? `결함 있음 (${r.audit.auditor ?? '?'})` : `결함 없음 (${r.audit.auditor ?? '?'})`

export default async function AutoReadyDefectsPage() {
  const { ok } = await requireAdmin()
  if (!ok) {
    return (
      <PageShell chrome="minimal">
        <main className="mx-auto max-w-3xl px-4 py-16 text-center">
          <h1 className="text-xl font-bold text-content-primary">접근 권한이 없습니다</h1>
          <p className="mt-2 text-sm text-content-muted">운영자만 볼 수 있는 화면입니다.</p>
          <Link href="/" className="mt-6 inline-block text-link">홈으로 가기</Link>
        </main>
      </PageShell>
    )
  }
  let rows: ReportableRow[] = []
  let readError: string | null = null
  try {
    rows = await listReportablePosts(prisma)
  } catch {
    // 🔴 감사 표가 아직 없는 DB 에서도 화면은 깨지지 않는다 — 읽지 못했다고 말한다
    readError = '자동 발행 목록을 읽지 못했습니다.'
  }
  return (
    <PageShell chrome="minimal">
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-2 text-xl font-bold text-content-primary">자동 READY 결함 신고</h1>
        <p className="mb-6 text-sm text-content-muted">
          자동으로 발행된 글에서 중대 결함(없는 사실 · 생활사 모순 · 원문 왜곡 등)을 찾으면 신고합니다.
          신고하면 자동 발행이 즉시 멈춥니다.
        </p>
        {readError !== null && <p role="alert" className="text-sm font-bold text-state-danger">{readError}</p>}
        {readError === null && rows.length === 0 && <p className="text-sm text-content-muted">자동으로 발행된 글이 없습니다.</p>}
        <ul className="space-y-4">
          {rows.map((r) => (
            <li key={r.postId} className="rounded-lg border border-subtle px-4 py-3 text-sm" data-post-id={r.postId}>
              <div className="mb-1 font-bold text-content-primary">{r.title}</div>
              <div className="mb-2 flex flex-wrap gap-2 text-content-muted">
                <span>{r.publishedAt === null ? '' : r.publishedAt.toISOString().slice(0, 16).replace('T', ' ')}</span>
                <span>{auditLabel(r)}</span>
                <Link href={`/community/free/${r.postId}`} className="text-link underline">글 보기</Link>
              </div>
              {r.audit?.defect === 'yes'
                ? <p className="font-bold text-state-danger">이미 결함으로 기록된 글입니다.</p>
                : <AutoReadyDefectReportForm postId={r.postId} />}
            </li>
          ))}
        </ul>
      </main>
    </PageShell>
  )
}
