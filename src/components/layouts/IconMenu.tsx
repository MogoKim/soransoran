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
 *
 * 색은 board-registry 가 정하고 이 파일은 읽기만 한다.
 * 보드가 늘어도 여기에 조건문이 붙지 않아야 한다.
 */
export default function IconMenu() {
  const pathname = usePathname()

  return (
    <nav aria-label="주요 메뉴" className="border-b border-subtle bg-surface-card">
      {/* 🔴 스크롤바를 숨긴다.
          "크게" 단계에서는 아이콘 64px + 라벨 20px 라 네 항목 합이 360px 이 되어
          320px 화면(iPhone SE)에서 실제로 가로 스크롤이 생긴다.
          그때 스크롤바가 라벨 위에 겹쳐 글자를 가린다. 스크롤은 남기고 막대만 숨긴다. */}
      <ul className="mx-auto flex max-w-3xl list-none justify-around gap-1.5 overflow-x-auto p-0 px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {MENU_BOARDS.map((board) => {
          const active = isActive(pathname, board.href)
          return (
            <li key={board.type}>
              <Link
                href={board.href}
                aria-current={active ? 'page' : undefined}
                className="relative flex min-h-[72px] min-w-[64px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl px-1 pb-1.5 pt-1 no-underline transition duration-150 hover:bg-surface-page active:scale-95"
              >
                <span
                  className="flex items-center justify-center rounded-2xl"
                  style={{
                    width: 'var(--icon-box)',
                    height: 'var(--icon-box)',
                    backgroundColor: `var(${board.iconBgVar})`,
                    color: `var(${board.iconStrokeVar})`,
                    ...(active
                      ? { outline: `2px solid var(${board.iconStrokeVar})`, outlineOffset: '1px' }
                      : {}),
                  }}
                >
                  <MenuIcon name={board.icon} />
                </span>
                <span
                  className={`break-keep text-center text-xs leading-tight ${active ? 'font-bold' : 'text-content-muted'}`}
                  style={active ? { color: `var(${board.iconTextVar})` } : undefined}
                >
                  {board.label}
                </span>
                {/* 활성 표시는 그 보드의 색으로 한다 — 전 메뉴가 같은 브랜드색이면 어디 있는지가 흐려진다 */}
                {active ? (
                  <span
                    aria-hidden
                    className="absolute bottom-0 h-0.5 w-6 rounded-full"
                    style={{ backgroundColor: `var(${board.iconStrokeVar})` }}
                  />
                ) : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
