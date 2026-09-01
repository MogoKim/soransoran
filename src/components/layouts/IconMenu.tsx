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
    /* 🔴 헤더와 함께 고정된다.
          이전에는 헤더만 sticky 라 스크롤을 조금만 내려도 게시판 네 칸이 화면 밖으로
          사라졌다. 목록을 읽다가 다른 방으로 건너가려면 맨 위까지 되올라가야 했다 —
          이 서비스에서 방 사이 이동은 부가 기능이 아니라 주 동선이다.

          top-16 = 헤더 h-16(64px). 헤더 높이를 바꾸면 이 값도 같이 바꾼다.

          🔴 z 는 헤더(z-50)보다 낮아야 한다.
             헤더 안의 글자크기 팝오버가 헤더 아래로 펼쳐지는데,
             메뉴가 헤더와 같거나 높으면 그 팝오버를 덮는다. */
    <nav
      aria-label="주요 메뉴"
      className="sticky top-16 z-40 border-b border-subtle bg-surface-card"
    >
      {/* 🔴 스크롤바를 숨긴다.
          "크게" 단계에서는 아이콘 64px + 라벨 22px 이라 네 항목이 좁은 화면을 넘긴다.
          그때 스크롤바가 라벨 위에 겹쳐 글자를 가린다. 스크롤은 남기고 막대만 숨긴다. */}
      <ul className="mx-auto flex max-w-3xl list-none justify-around gap-1.5 overflow-x-auto p-0 px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {MENU_BOARDS.map((board) => {
          const active = isActive(pathname, board.href)
          return (
            <li key={board.type}>
              <Link
                href={board.href}
                aria-current={active ? 'page' : undefined}
                className="relative flex min-h-[72px] min-w-[76px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl px-1.5 pb-2 pt-1.5 no-underline transition duration-150 hover:bg-surface-page active:scale-95"
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
                  className={`break-keep text-center text-sm leading-tight ${active ? 'font-bold' : 'text-content-muted'}`}
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
