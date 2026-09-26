import type { Metadata } from 'next'
import Link from 'next/link'
import PageShell from '@/components/layouts/PageShell'
import EvidenceBatchReview from '@/components/admin/EvidenceBatchReview'
import { requireAdmin } from '@/lib/admin'

/**
 * 자동 READY 증거 — 배치 검토 (관리자 전용)
 *
 * 🔴 사람 정답 표본을 기록하는 **유일한 자리**다. 검토자는 로그인 세션으로, 시각은 서버 시계로 정한다.
 *    CLI 로는 사람 기록을 만들 수 없다.
 * 🔴 로컬에서 `npm run auto-ready:review-bundle` 로 만든 묶음을 올려 한 번에 검토한다 — 글마다 묻지 않는다.
 * 🔴 이 화면은 고객 경로에서 import 되지 않는다.
 */
export const metadata: Metadata = {
  title: '자동 READY 증거 검토',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function AutoReadyEvidencePage() {
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
  return (
    <PageShell chrome="minimal">
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-2 text-xl font-bold text-content-primary">자동 READY 증거 — 배치 검토</h1>
        <p className="mb-6 text-sm text-content-muted">
          묶음 하나를 올려 모든 행을 한 번에 검토합니다. 사람 검토 기록만 자동 READY 정확도 표본이 됩니다.
        </p>
        <EvidenceBatchReview />
      </main>
    </PageShell>
  )
}
