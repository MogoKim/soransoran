'use client'

import Link from 'next/link'
import { TOUCH_MIN } from '@/lib/spacing'
import { useFormStatus } from 'react-dom'
import { useWriteViewportTop } from '@/components/features/use-write-viewport'
import { cn } from '@/lib/utils'

/**
 * 글쓰기·수정 전용 상단바.
 *
 * 🔴 이 화면에서는 로고·게시판 메뉴·Footer 를 걷어 내고 이것만 남긴다.
 *    글을 쓰는 동안 갈 수 있는 곳이 여러 군데 보이면 "구경 중" 이 된다.
 *    나가는 길 하나(취소)와 끝내는 길 하나(등록)만 둔다.
 *
 * 🔴 등록 버튼을 여기 둔다. 키보드가 열려 화면 아래가 통째로 덮여도
 *    누를 곳이 남아 있어야 한다. 아래쪽 버튼 하나만 두면 키보드 뒤로 숨는다.
 *
 * 🔴 되는지 안 되는지를 색이 아니라 '채워진 알약 vs 회색 알약' 으로 가른다.
 *    모양이 고정이라 같은 자리에서 항상 보이고, 색만으로 가르면
 *    화면을 밝게 보는 분께는 두 상태가 같아 보인다.
 *
 * 🔴 바깥 button 이 터치 영역(52px)을 지고 안쪽 span 이 보이는 알약이다.
 *    알약을 그대로 키우면 글씨 옆 여백까지 커져 상단바가 두꺼워진다.
 */
export default function WriteTopBar({
  title,
  submitLabel,
  pendingLabel,
  canSubmit,
  cancelHref,
  busy = false,
}: {
  title: string
  submitLabel: string
  pendingLabel: string
  canSubmit: boolean
  cancelHref: string
  /**
   * 폼 밖에서 아직 끝나지 않은 일이 있는가.
   *
   * 🔴 useFormStatus 의 pending 은 **서버 액션이 돌아오는 순간 꺼진다.**
   *    새 글은 그 뒤에도 저장된 글로 이동하는 일이 남아 있는데, 그 사이 버튼이 다시
   *    켜지면 방금 올린 글을 한 번 더 올리게 된다. 이동이 끝날 때까지 눌린 상태를 잇는다.
   * 🔴 선택이다. 넘기지 않는 화면(글 수정)은 지금과 똑같이 동작한다.
   */
  busy?: boolean
}) {
  const { pending } = useFormStatus()

  const setBar = useWriteViewportTop()

  const working = pending || busy
  const ready = canSubmit && !working

  return (
    <div
      ref={setBar}
      className="fixed inset-x-0 top-0 z-40 flex h-[56px] items-center justify-between border-b border-subtle bg-surface-card px-2 will-change-transform"
    >
      <Link
        href={cancelHref}
        className={`inline-flex ${TOUCH_MIN} min-w-[52px] items-center px-2 text-content-muted no-underline`}
      >
        취소
      </Link>

      {/* 🔴 제목은 가운데 한 줄로 묶는다. 게시판 이름이 길어도 좌우 버튼을 밀지 않게
             넘치는 만큼 줄임표로 접는다. */}
      <span className="truncate px-2 font-bold text-content-primary">{title}</span>

      <button
        type="submit"
        disabled={!ready}
        className={`inline-flex ${TOUCH_MIN} min-w-[52px] items-center justify-end px-2`}
      >
        {/* 🔴 알약 높이는 52px 다. 40px 이던 것을 올렸다 —
               라벨이 text-lg(--text-title 20/24/28px)라 "크게" 에서 줄 높이가 49px 이고,
               40px 안에서는 글자가 위아래로 잘렸다. 바깥 바는 h-[56px] 그대로다. */}
        <span
          className={cn(
            'inline-flex h-[52px] items-center rounded-full px-4 text-lg font-bold transition-colors',
            ready ? 'bg-cta text-cta-content' : 'bg-surface-page text-content-muted',
          )}
        >
          {working ? pendingLabel : submitLabel}
        </span>
      </button>
    </div>
  )
}
