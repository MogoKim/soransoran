import Link from 'next/link'
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
      {/* 🔴 bg-surface-app 은 tailwind 에 없는 이름이라 아무 규칙도 만들지 않았다 — 변수를 직접 참조한다 */}
      <div className="admin-shell min-h-screen bg-[color:var(--surface-app)]">
        <div className="lg:hidden">
          <AdminMobileNav />
        </div>
        <div className="mx-auto w-full max-w-[1360px] lg:flex lg:gap-10 lg:px-8">
          <aside className="hidden lg:block lg:w-[248px] lg:shrink-0 lg:py-8">
            <div className="sticky top-8 flex max-h-[calc(100vh-4rem)] flex-col gap-6 overflow-y-auto pb-4">
              {/* 콘솔 타이틀 — 여기가 고객 화면이 아니라는 표시이자 운영 홈으로 돌아가는 길 */}
              <Link href="/admin" className="flex flex-col px-4 no-underline" aria-label="운영 콘솔 홈">
                <span className="text-lg font-bold leading-tight text-content-primary">소란소란 운영</span>
                <span className="text-xs text-content-muted">운영 콘솔</span>
              </Link>
              <AdminSidebarNav />
              <p className="m-0 border-t border-subtle px-4 pt-3">
                <Link href="/" className="text-xs text-link">
                  고객 화면 열기
                </Link>
              </p>
            </div>
          </aside>

          {/* 🔴 min-w-0 — flex 자식 기본값이 min-width:auto 라 긴 제목이 들어오면
              사이드바를 밀어내고 페이지 전체에 가로 스크롤을 만든다. */}
          <main className="min-w-0 flex-1 px-4 pb-16 pt-4 lg:max-w-[1040px] lg:px-0 lg:py-8">{children}</main>
        </div>
      </div>

      <ToastViewport chrome="minimal" />
    </ToastProvider>
  )
}
