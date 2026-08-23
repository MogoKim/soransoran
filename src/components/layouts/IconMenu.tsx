'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import MenuIcon from '@/components/icons/MenuIcon'
import { MENU_BOARDS } from '@/lib/board-registry'

/** 게시판 상세(/community/menopause/{id})에서도 그 게시판이 켜져 있어야 한다. */
function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * 상단 메뉴 행 — 하단 탭바를 쓰지 않는다.
 * 노출 대상은 board-registry 의 showInMenu 가 정한다.
 */
export default function IconMenu() {
  const pathname = usePathname()

  return (
    <nav aria-label="주요 메뉴" className="border-b border-subtle bg-surface-card">
      <ul className="mx-auto flex max-w-3xl list-none justify-around gap-1 overflow-x-auto p-0 px-2">
        {MENU_BOARDS.map((board) => {
          const active = isActive(pathname, board.href)
          return (
            <li key={board.type}>
              <Link
                href={board.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-[72px] min-w-[64px] flex-col items-center justify-center gap-1 border-b-2 px-1 pt-1 no-underline ${
                  active ? 'border-cta' : 'border-transparent'
                }`}
              >
                <span
                  className={`flex h-11 w-11 items-center justify-center rounded-2xl ${
                    active ? 'ring-2 ring-cta' : ''
                  }`}
                  style={{
                    backgroundColor: `var(${board.iconBgVar})`,
                    color: `var(${board.iconStrokeVar})`,
                  }}
                >
                  <MenuIcon name={board.icon} />
                </span>
                <span
                  className={`text-xs ${
                    active ? 'font-bold text-content-primary' : 'text-content-muted'
                  }`}
                >
                  {board.label}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
