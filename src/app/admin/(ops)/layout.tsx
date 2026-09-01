import type { Metadata } from 'next'
import Link from 'next/link'
import PageShell from '@/components/layouts/PageShell'
import { requireAdmin } from '@/lib/admin'

/**
 * 어드민 공통 셸 — 권한 확인과 메뉴를 한 곳에서 맡는다.
 *
 * 🔴 메뉴는 5개다. 늘리지 않는다.
 *    1차 목적은 "회원·게시글·신고·홈 노출" 을 손으로 처리하는 것이고,
 *    KPI·성장 대시보드·매거진 관제는 이 화면의 일이 아니다.
 *
 * 🔴 페르소나 화면은 메뉴에 넣지 않는다.
 *    그쪽은 별도 운영 축이고 이번 범위 밖이다(경로도 건드리지 않는다).
 *
 * 🔴 여기서 requireAdmin 을 하지만 각 페이지에서도 다시 확인한다.
 *    layout 은 렌더 경로일 뿐 데이터 접근을 막아 주지 않는다 —
 *    서버 액션은 layout 을 거치지 않으므로 액션마다 따로 확인한다.
 *
 * 🔴 모바일이 기본이다. 메뉴는 가로 스크롤 한 줄로 둔다 —
 *    사이드바는 좁은 화면에서 본문을 밀어낸다.
 */
export const metadata: Metadata = {
  title: { default: '운영', template: '%s · 운영' },
  robots: { index: false, follow: false },
}

const NAV = [
  { href: '/admin', label: '운영 홈' },
  { href: '/admin/members', label: '회원' },
  { href: '/admin/content', label: '게시글' },
  { href: '/admin/reports', label: '신고' },
  { href: '/admin/home', label: '홈 노출' },
] as const

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
      <div className="mx-auto max-w-3xl px-4 pb-16">
        <nav className="-mx-4 overflow-x-auto border-b border-subtle px-4">
          <ul className="m-0 flex list-none gap-1 whitespace-nowrap p-0">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="inline-flex min-h-[52px] items-center px-3 text-sm font-bold text-content-primary no-underline"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {children}
      </div>
    </PageShell>
  )
}
