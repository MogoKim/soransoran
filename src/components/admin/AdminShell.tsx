import { AdminMobileNav, AdminSidebarNav } from '@/components/admin/AdminNav'
import { ToastProvider, ToastViewport } from '@/components/ui/toast'

/**
 * 운영 콘솔 셸 — 모든 /admin 화면이 이 하나 안에서 그려진다(src/app/admin/layout.tsx).
 *
 * 🔴 PageShell 을 쓰지 않는다. chrome="minimal" 이어도 고객 Header 와 Footer 가
 *    렌더되어 로고·글자 크기 조절·약관 링크가 운영 화면에 딸려 온다.
 *    예전에는 자동 운영 화면 8개가 PageShell 을 써서 고객 글자 크기 3단계를 따라
 *    제목이 24·28·32px 로 흔들렸다(2026-10-20 실측). 이제 그 화면들도 여기 들어온다.
 *
 * 🔴 데스크탑은 왼쪽 248px 딥 사이드바가 화면 높이 전체를 차지하는 독립 색면이다
 *    (창업자 확정 B안). 본문은 웜 베이지 바탕 위 흰 카드다. 색은 --admin-* 토큰만 쓴다.
 *
 * 🔴 .admin-shell 안에서만 글자 크기·관리자 토큰이 걸린다(globals.css 하단). 고객 화면 토큰은 그대로다.
 *
 * 🔴 토스트도 여기서 조립한다. 이 셸은 layout 이 부르므로 운영 화면끼리 오가도 살아남는다 —
 *    조치 뒤 router.refresh() 로 화면이 다시 그려져도 안내가 사라지지 않는다.
 *
 * 🔴 <main> 은 여기 하나다. 화면(page)은 <main> 을 다시 그리지 않는다 — 겹치면 보조기기가
 *    본문을 두 번 읽는다.
 *
 * 🔴 1024px 미만(브라우저 150·200% 확대 포함)은 모바일 셸이다. 사이드바를 좁혀 버티지 않는다.
 */
export default function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="admin-shell min-h-screen bg-[color:var(--admin-page)]">
        <div className="lg:hidden">
          <AdminMobileNav />
        </div>

        <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-20 lg:block lg:w-[248px] lg:border-r lg:border-[color:var(--admin-nav-line)]">
          <AdminSidebarNav />
        </aside>

        <div className="lg:pl-[248px]">
          {/* 🔴 min-w-0 — flex 자식 기본값이 min-width:auto 라 긴 제목이 들어오면
              페이지 전체에 가로 스크롤을 만든다. */}
          <main className="mx-auto min-w-0 max-w-[1100px] px-4 pb-16 pt-4 lg:px-12 lg:py-8">{children}</main>
        </div>
      </div>

      <ToastViewport chrome="minimal" />
    </ToastProvider>
  )
}
