import type { Metadata } from 'next'
import Link from 'next/link'
import PageShell from '@/components/layouts/PageShell'
import { requireAdmin } from '@/lib/admin'
import AdminOpsNav from '@/components/admin/AdminOpsNav'

/**
 * 운영 콘솔 셸 — 권한 확인과 메뉴를 한 곳에서 맡는다.
 *
 * 🔴 데스크탑이 기준이다. 창업자가 매일 앉아서 쓰는 화면이라
 *    max-w-3xl(768px) 로 묶어 두면 1440px 모니터의 절반을 버리게 되고,
 *    목록이 세로로만 길어져 스캔이 안 된다. 본문은 넓게 쓰되
 *    1440px 에서 멈춘다 — 더 퍼지면 한 줄이 눈으로 따라가기 어려워진다.
 *
 * 🔴 데스크탑은 좌측 사이드바, 모바일은 상단 가로 스크롤 줄이다.
 *    사이드바를 좁은 화면에 그대로 두면 본문을 밀어낸다.
 *    같은 목록을 AdminOpsNav 하나가 두 모양으로 그린다.
 *
 * 🔴 페르소나 화면은 이 layout 에 들어오지 않는다.
 *    (ops) route group 밖에 있어 경로상 격리돼 있다 — 그 격리를 깨지 않는다.
 *
 * 🔴 여기서 requireAdmin 을 하지만 각 페이지에서도 다시 확인한다.
 *    layout 은 렌더 경로일 뿐 데이터 접근을 막아 주지 않는다 —
 *    서버 액션은 layout 을 거치지 않으므로 액션마다 따로 확인한다.
 */
export const metadata: Metadata = {
  title: { default: '운영', template: '%s · 운영' },
  robots: { index: false, follow: false },
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { ok } = await requireAdmin()

  if (!ok) {
    return (
      <PageShell chrome="minimal">
        <main className="mx-auto max-w-3xl px-4 py-16 text-center">
          <h1 className="text-xl font-bold text-content-primary">접근 권한이 없습니다</h1>
          <p className="mt-2 text-sm text-content-muted">운영자만 볼 수 있는 화면입니다.</p>
          <Link href="/" className="mt-6 inline-block text-link">
            홈으로 가기
          </Link>
        </main>
      </PageShell>
    )
  }

  return (
    <PageShell chrome="minimal">
      <div className="mx-auto w-full max-w-[1440px] px-4 pb-16 lg:px-6">
        <div className="lg:flex lg:gap-8">
          {/* 데스크탑: 왼쪽에 붙어 따라오는 메뉴 */}
          <aside className="hidden lg:block lg:w-48 lg:shrink-0 lg:pt-8">
            <div className="sticky top-6">
              <p className="m-0 px-3 pb-3 text-xs font-bold text-content-muted">운영 콘솔</p>
              <AdminOpsNav layout="sidebar" />
            </div>
          </aside>

          {/* 모바일: 상단 가로 스크롤 줄 */}
          <div className="lg:hidden">
            <AdminOpsNav layout="topbar" />
          </div>

          {/* 🔴 min-w-0 이 필요하다. flex 자식은 기본이 min-width:auto 라
              긴 제목이나 표가 들어오면 사이드바를 밀어내고 가로 스크롤을 만든다. */}
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </PageShell>
  )
}
