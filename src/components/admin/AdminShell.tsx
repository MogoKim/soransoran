import Link from 'next/link'
import AdminOpsNav from '@/components/admin/AdminOpsNav'

/**
 * 운영 콘솔 셸.
 *
 * 🔴 PageShell 을 쓰지 않는다. chrome="minimal" 이어도 고객 Header 와 Footer 가
 *    렌더되어 로고·글자 크기 조절·약관 링크가 운영 화면에 딸려 온다.
 *    운영자가 매일 보는 화면에 고객용 크롬이 섞이면 집중이 흐트러지고
 *    화면만 길어진다. PageShell 자체는 고객 화면이 쓰므로 건드리지 않는다.
 *
 * 🔴 .admin-shell 안에서만 글자 크기와 배지 바탕색을 운영용으로 고정한다
 *    (globals.css 하단). 고객 화면 토큰은 그대로다.
 */
export default function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-shell min-h-screen bg-surface-app">
      <div className="mx-auto w-full max-w-[1400px] lg:flex lg:gap-8 lg:px-6">
        {/* 데스크탑: 왼쪽에 붙어 따라오는 메뉴 */}
        <aside className="hidden lg:block lg:w-[228px] lg:shrink-0 lg:py-6">
          <div className="sticky top-6">
            {/* 콘솔 타이틀 — 여기가 고객 화면이 아니라는 표시이자 홈으로 돌아가는 길 */}
            <Link
              href="/admin"
              className="mb-4 block px-3 no-underline"
              aria-label="운영 콘솔 홈"
            >
              <span className="block text-lg font-bold leading-tight text-content-primary">
                소란소란 운영
              </span>
              <span className="block text-xs text-content-muted">운영 콘솔</span>
            </Link>
            <AdminOpsNav layout="sidebar" />

            <p className="mt-4 border-t border-subtle px-3 pt-3 text-xs text-content-muted">
              페르소나 운영은{' '}
              <Link href="/admin/personas" className="text-link">
                별도 화면
              </Link>
            </p>
          </div>
        </aside>

        {/* 모바일: 상단 줄. 데스크탑에서는 사이드바가 대신한다. */}
        <div className="border-b border-subtle bg-surface-card px-4 lg:hidden">
          <p className="m-0 py-2 text-sm font-bold text-content-primary">소란소란 운영</p>
          <AdminOpsNav layout="topbar" />
        </div>

        {/* 🔴 min-w-0 — flex 자식 기본값이 min-width:auto 라 긴 제목이 들어오면
            사이드바를 밀어내고 페이지 전체에 가로 스크롤을 만든다. */}
        <main className="min-w-0 flex-1 px-4 pb-16 lg:px-0 lg:py-6">{children}</main>
      </div>
    </div>
  )
}
