import Link from 'next/link'
import { BOARD_REGISTRY } from '@/lib/board-registry'

/**
 * 상단 메뉴 행 — 하단 탭바를 쓰지 않는다.
 * IA 정본 4면: 갱년기톡 / 자유게시판 / 매거진 / 베스트
 */
export default function IconMenu() {
  return (
    <nav aria-label="주요 메뉴" className="border-b border-subtle bg-surface-card">
      <ul className="mx-auto flex max-w-3xl list-none justify-around p-0">
        {BOARD_REGISTRY.map((board) => (
          <li key={board.type}>
            <Link
              href={board.href}
              className="flex min-h-[52px] items-center px-3 text-sm font-bold text-content-muted no-underline hover:text-brand-ink"
            >
              {board.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
