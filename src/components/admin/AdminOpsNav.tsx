'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * 운영 메뉴 — 데스크탑 사이드바와 모바일 상단 줄이 같은 목록을 쓴다.
 *
 * 🔴 지금 어디인지 표시한다. 조치를 하면 router.refresh() 로 화면이 다시 그려지는데,
 *    표시가 없으면 운영자가 "눌렀는데 아무 일도 없었나" 를 의심하며 같은 버튼을 또 누른다.
 *
 * 🔴 메뉴는 5개다. 늘리지 않는다 — 회원·게시글·신고·홈 노출을 손으로 처리하는 것이
 *    이 콘솔의 전부다. 페르소나 화면은 별도 운영 축이라 여기 넣지 않는다.
 */
const NAV = [
  { href: '/admin', label: '운영 홈' },
  { href: '/admin/reports', label: '신고' },
  { href: '/admin/content', label: '게시글' },
  { href: '/admin/members', label: '회원' },
  { href: '/admin/home', label: '홈 노출' },
] as const

function isCurrent(pathname: string, href: string): boolean {
  // '/admin' 은 정확히 일치할 때만 — 하위 화면 전부에서 켜지면 표시가 의미를 잃는다
  if (href === '/admin') return pathname === '/admin'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export default function AdminOpsNav({ layout }: { layout: 'sidebar' | 'topbar' }) {
  const pathname = usePathname()

  if (layout === 'sidebar') {
    return (
      <nav aria-label="운영 메뉴">
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {NAV.map((item) => {
            const current = isCurrent(pathname, item.href)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={current ? 'page' : undefined}
                  className={`flex min-h-[40px] items-center border-l-2 px-3 text-sm no-underline ${
                    current
                      ? 'border-cta bg-surface-card font-bold text-content-primary'
                      : 'border-transparent text-content-muted hover:bg-surface-card hover:text-content-primary'
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    )
  }

  return (
    <nav aria-label="운영 메뉴" className="-mx-4 overflow-x-auto px-4">
      <ul className="m-0 flex list-none gap-1 whitespace-nowrap p-0">
        {NAV.map((item) => {
          const current = isCurrent(pathname, item.href)
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={`inline-flex min-h-[52px] items-center border-b-2 px-3 text-sm no-underline ${
                  current
                    ? 'border-cta font-bold text-content-primary'
                    : 'border-transparent text-content-muted'
                }`}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
