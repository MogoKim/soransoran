import { getBoardByType } from '@/lib/board-registry'
import type { BoardType } from '@prisma/client'

/**
 * 게시판 배지 — 여러 보드가 섞이는 자리에서 어느 방 글인지 알려준다.
 * 색은 board-registry 의 iconBgVar/iconStrokeVar 를 그대로 쓴다. 배지가 색을 정하지 않는다.
 */
export default function BoardBadge({
  boardType,
  className = '',
}: {
  boardType: BoardType
  className?: string
}) {
  const board = getBoardByType(boardType)
  if (!board) return null

  return (
    <span
      className={['rounded-full px-2 py-0.5 font-bold', className].filter(Boolean).join(' ')}
      style={{
        backgroundColor: `var(${board.iconBgVar})`,
        color: `var(${board.iconStrokeVar})`,
      }}
    >
      {board.label}
    </span>
  )
}
