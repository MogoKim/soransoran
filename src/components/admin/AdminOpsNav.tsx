'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * 운영 메뉴 — 데스크탑 사이드바와 모바일 상단 줄이 같은 목록을 쓴다.
 *
 * 🔴 지금 어디인지 분명히 표시한다. 조치를 하면 router.refresh() 로 화면이 다시
 *    그려지는데, 표시가 약하면 운영자가 "눌렀는데 아무 일도 없었나" 하고
 *    같은 버튼을 또 누른다. 왼쪽 선 + 배경 + 굵기 셋을 함께 쓴다.
 *
 * 🔴 메뉴는 6개다. 늘리지 않는다 — 회원·게시글·신고·홈 노출·배너를 손으로 처리하는 것이
 *    이 콘솔의 전부다. 페르소나 화면은 별도 운영 축이라 여기 넣지 않는다.
 *
 *    🔴 5개에서 6개로 늘렸다 (2026-09-14 · 창업자 승인).
 *    배너는 홈 노출과 다른 일이다 — 홈 노출은 **이미 있는 글**을 올리고 내리는 것이고,
 *    배너는 운영자가 만든 이미지를 새로 올리는 것이다. /admin/home 에 섞으면
 *    "글을 고정했다" 와 "배너를 켰다" 가 한 화면에서 구분되지 않는다.
 *
 * 아이콘 라이브러리를 새로 넣지 않는다(현재 저장소에 없다). 글자만으로 세운다.
 */
const NAV = [
  { href: '/admin', label: '운영 홈', hint: '오늘 볼 것' },
  { href: '/admin/reports', label: '신고', hint: '판단하고 조치' },
  { href: '/admin/content', label: '게시글', hint: '고치고 가리기' },
  { href: '/admin/members', label: '회원', hint: '차단 관리' },
  { href: '/admin/home', label: '홈 노출', hint: '고정·숨김' },
  { href: '/admin/banners', label: '배너 관리', hint: '히어로 배너' },
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
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {NAV.map((item) => {
            const current = isCurrent(pathname, item.href)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={current ? 'page' : undefined}
                  className={`flex min-h-[44px] flex-col justify-center rounded-r-lg border-l-[3px] px-3 py-1.5 no-underline transition-colors ${
                    current
                      ? 'border-cta bg-surface-card'
                      : 'border-transparent hover:bg-surface-card'
                  }`}
                >
                  <span
                    className={
                      current
                        ? 'text-base font-bold text-content-primary'
                        : 'text-base text-content-muted'
                    }
                  >
                    {item.label}
                  </span>
                  <span className="text-xs text-content-muted">{item.hint}</span>
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
