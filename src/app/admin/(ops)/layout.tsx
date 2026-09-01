import type { Metadata } from 'next'
import Link from 'next/link'
import { requireAdmin } from '@/lib/admin'
import AdminShell from '@/components/admin/AdminShell'

/**
 * 운영 콘솔 layout — 권한 확인과 셸 선택만 한다.
 *
 * 🔴 여기서 requireAdmin 을 하지만 각 페이지에서도 다시 확인한다.
 *    layout 은 렌더 경로일 뿐 데이터 접근을 막아 주지 않는다 —
 *    서버 액션은 layout 을 거치지 않으므로 액션마다 따로 확인한다.
 *
 * 🔴 페르소나 화면은 (ops) 밖이라 이 셸에 들어오지 않는다. 그 격리를 유지한다.
 */
export const metadata: Metadata = {
  title: { default: '운영', template: '%s · 운영' },
  robots: { index: false, follow: false },
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { ok } = await requireAdmin()

  // 권한 없는 사람에게는 운영 메뉴를 보여 주지 않는다 — 어떤 화면이 있는지도 알리지 않는다.
  if (!ok) {
    return (
      <div className="admin-shell min-h-screen bg-surface-app">
        <main className="mx-auto max-w-lg px-4 py-24 text-center">
          <h1 className="m-0 text-xl font-bold text-content-primary">접근 권한이 없습니다</h1>
          <p className="mt-2 text-sm text-content-muted">운영자만 볼 수 있는 화면입니다.</p>
          <Link href="/" className="mt-6 inline-block text-link">
            소란소란 홈으로
          </Link>
        </main>
      </div>
    )
  }

  return <AdminShell>{children}</AdminShell>
}
