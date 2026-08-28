import { getBoardByType } from '@/lib/board-registry'
import type { BoardType } from '@prisma/client'

/**
 * 게시판 배지 — 여러 보드가 섞이는 자리에서 어느 방 글인지 알려준다.
 * 색은 board-registry 가 정하고 배지는 읽기만 한다.
 * 글자는 stroke 가 아니라 text 토큰이다 — stroke 를 그대로 쓰면 배경 위 대비가 모자란다.
 *
 * quiet 는 굵기만 낮춘다. 색·배경·크기는 그대로라 대비는 유지된다 —
 * 글이 줄줄이 놓이는 자리에서 배지까지 굵으면 제목과 무게가 같아진다.
 */
export default function BoardBadge({
  boardType,
  className = '',
  quiet = false,
}: {
  boardType: BoardType
  className?: string
  quiet?: boolean
}) {
  const board = getBoardByType(boardType)
  if (!board) return null

  return (
    <span
      className={['rounded-full px-2 py-0.5', quiet ? 'font-medium' : 'font-bold', className]
        .filter(Boolean)
        .join(' ')}
      style={{
        backgroundColor: `var(${board.iconBgVar})`,
        color: `var(${board.iconTextVar})`,
      }}
    >
      {board.label}
    </span>
  )
}
