import MenuIcon from '@/components/icons/MenuIcon'
import type { BoardMeta } from '@/lib/board-registry'

/**
 * 목록 페이지 헤더 — /magazine · /community/[boardSlug] · /best 가 같이 쓴다.
 *
 * 🔴 세 곳이 각자 <h1> 을 들고 있으면 한 곳만 고쳐지고 나머지가 남는다.
 *    실제로 매거진 헤더에만 아이콘을 붙이려다, 그러면 커뮤니티·베스트와
 *    갈라진다는 것을 알고 되돌렸다. 한 곳에서 정한다.
 *
 * 🔴 이름도 색도 아이콘도 board-registry 가 정한다.
 *    이 파일은 읽기만 한다 — 보드가 늘어도 여기에 조건문이 붙지 않아야 한다.
 *    (BoardBadge 와 같은 규칙이다)
 *
 * 아이콘 배지는 홈 "지금 뜨는 이야기" 와 같은 모양이다.
 * 목록에 들어왔을 때 어느 방인지가 색으로 먼저 보인다.
 */
export default function ListHeader({ board }: { board: BoardMeta }) {
  return (
    <h1 className="flex items-center gap-2 py-6 text-xl font-bold text-content-primary">
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]"
        style={{
          backgroundColor: `var(${board.iconBgVar})`,
          color: `var(${board.iconStrokeVar})`,
        }}
      >
        <MenuIcon name={board.icon} size={18} />
      </span>
      {board.label}
    </h1>
  )
}
