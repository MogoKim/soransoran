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
type ListHeaderProps = {
  board: BoardMeta
  /**
   * 제목을 눈에서만 감춘다 (기본 false).
   *
   * 🔴 감추는 것이지 지우는 것이 아니다.
   *    <h1> 과 그 텍스트는 그대로 남아 문서 구조와 스크린리더 낭독이 유지된다.
   *
   * 🔴 왜 필요한가 — 게시판 목록에서만 제목이 중복이다.
   *    상단 아이콘 메뉴가 이미 어느 방인지 색·라벨·활성 표시로 말하고 있는데,
   *    바로 아래에 같은 이름을 다시 크게 쓰면 첫 글이 그만큼 아래로 밀린다.
   *    매거진·베스트는 메뉴에서 들어오지 않는 경로도 있어 제목을 그대로 둔다.
   *
   * 🔴 전역으로 감추지 않는 이유가 이것이다.
   *    이 컴포넌트를 세 화면이 같이 쓰므로, 감출지는 부르는 쪽이 정한다.
   */
  visuallyHidden?: boolean
}

export default function ListHeader({ board, visuallyHidden = false }: ListHeaderProps) {
  // 아이콘 배지는 장식이라 감출 때는 아예 그리지 않는다 — 보이지 않는 곳에 색을 두지 않는다.
  if (visuallyHidden) {
    return <h1 className="sr-only">{board.label}</h1>
  }

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
