import type { Metadata } from 'next'
import Link from 'next/link'
import { requireAdmin } from '@/lib/admin'
import AdminShell from '@/components/admin/AdminShell'

/**
 * 운영 콘솔 layout — 모든 /admin 화면의 권한 확인과 셸 선택만 한다.
 *
 * 🔴 (ops) 안팎을 가리지 않고 여기 하나가 셸을 고른다 (Admin Console V2 · 2026-10-20).
 *    예전에는 (ops)/layout.tsx 만 AdminShell 을 쓰고, 자동 운영 화면(personas ·
 *    persona-candidates · original-post-candidates · auto-ready-*)은 고객 PageShell 을 따로 썼다.
 *    폴더를 옮기지 않고 셸만 한 단계 올렸다 — 주소 · 파일 위치 · 진행 중인 작업과의 충돌이 그대로다.
 *
 * 🔴 여기서 requireAdmin 을 하지만 각 페이지에서도 다시 확인한다. 지우지 않는다.
 *    layout 은 렌더 경로일 뿐 데이터 접근을 막아 주지 않는다 —
 *    서버 액션은 layout 을 거치지 않으므로 액션마다 따로 확인한다.
 *
 * 🔴 /api/admin 은 src/app/api 아래라 이 layout 을 거치지 않는다. 영향이 없다.
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
      <div className="admin-shell min-h-screen bg-[color:var(--surface-app)]">
        <div className="mx-auto max-w-lg px-4 py-24 text-left">
          <h1 className="m-0 text-xl font-bold text-content-primary">접근 권한이 없습니다</h1>
          <p className="mt-2 text-sm text-content-muted">운영자만 볼 수 있는 화면입니다.</p>
          <Link href="/" className="mt-6 inline-flex min-h-[52px] items-center text-link">
            소란소란 홈으로
          </Link>
        </div>
      </div>
    )
  }

  return <AdminShell>{children}</AdminShell>
}
