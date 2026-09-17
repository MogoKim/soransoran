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
 * 🔴 메뉴는 7개다. 늘리지 않는다 — 회원·게시글·신고·홈 노출·배너를 손으로 처리하고
 *    창업자가 직접 쓰는 것이 이 콘솔의 전부다.
 *    페르소나 **자동** 운영 화면은 별도 운영 축이라 여기 넣지 않는다.
 *
 *    🔴 6개에서 7개로 늘렸다 (2026-09-17).
 *    직접 작성은 신고·게시글 조치와 다른 일이다 — 저쪽은 **남이 쓴 것**을 가리고 고치는
 *    일이고, 이쪽은 **내가 쓰는** 일이다. /admin/content 에 섞으면
 *    "회원 글을 고쳤다" 와 "내가 썼다" 가 한 화면에서 구분되지 않는다.
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
  { href: '/admin/content', label: '게시글', hint: '수정하고 숨기기' },
  { href: '/admin/members', label: '회원', hint: '차단 관리' },
  { href: '/admin/home', label: '홈 노출', hint: '고정·숨김' },
  { href: '/admin/banners', label: '배너 관리', hint: '히어로 배너' },
  { href: '/admin/compose', label: '직접 작성', hint: '내가 쓰기' },
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
                  /* 🔴 hover 를 현재 표시와 다른 면으로 둔다 (2026-09-17).
                        전에는 hover 도 bg-surface-card(흰색)라 **현재 항목과 같은 바탕**이 되어
                        마우스를 올린 것과 지금 보고 있는 것이 구분되지 않았다.
                        게다가 흰색은 바탕(#FBFAF9) 위 1.04:1 이라 사실상 보이지도 않았다.
                        hover 는 옅은 블록(--surface-page · 바탕 위 1.21:1)으로 바꾼다 —
                        현재 표시(흰 면 + 왼쪽 --cta 선)와 역할이 갈린다.
                        메뉴 항목·순서·링크는 그대로다. */
                  className={`flex min-h-[44px] flex-col justify-center rounded-r-lg border-l-[3px] px-3 py-1.5 no-underline transition-colors ${
                    current
                      ? 'border-cta bg-surface-card'
                      : 'border-transparent hover:bg-surface-page'
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
