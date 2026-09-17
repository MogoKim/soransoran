'use client'

import ToastItem from '@/components/ui/toast/toast-item'
import { useToastItems } from '@/components/ui/toast/toast-context'
import { TOAST_ASSERTIVE, TOAST_TOP, TOAST_Z, type ToastChrome } from '@/components/ui/toast/toast-tokens'

/**
 * 토스트가 뜨는 자리 — 🔴 이 파일만 위치를 안다.
 *
 * 🔴 상단이다. 하단은 이미 셋이 쓴다 —
 *    FAB(40) · WriteFooter(40) · CommentDock(30). 어느 하나는 반드시 가린다.
 *    상단은 키보드가 올라와도 자리가 흔들리지 않는다.
 *
 *    (2026-09-17 이전에는 여기에 댓글 composer 시트 z-61 과 딤 60 이 있었다.
 *     시트를 없애고 하단 바가 원래 자리의 폼으로 데려가는 방식으로 바꾸면서 사라졌다.)
 *
 * 🔴 내려오는 높이는 chrome 이 정한다. full 은 Header+IconMenu 아래,
 *    minimal 은 Header 아래다. 한 값으로 고정하면 IconMenu 가 없는 화면에서
 *    안내가 허공에 뜨고, 있는 화면에서는 게시판 네 칸을 가린다.
 *
 * 🔴 두 live region 을 늘 켜 둔다. 토스트가 생길 때 region 째 붙이면
 *    스크린리더가 새 영역으로 보고 읽지 않는다. 빈 상자를 먼저 두고 안을 채운다.
 */
export default function ToastViewport({ chrome = 'full' }: { chrome?: ToastChrome }) {
  const { items, dismiss } = useToastItems()

  const polite = items.filter((item) => !TOAST_ASSERTIVE[item.variant])
  const assertive = items.filter((item) => TOAST_ASSERTIVE[item.variant])

  return (
    <div
      /* 🔴 pointer-events-none — 비어 있을 때 아래 화면의 터치를 가로채지 않는다 */
      className="pointer-events-none fixed inset-x-4 flex flex-col gap-2 md:inset-x-auto md:right-6 md:w-[min(420px,calc(100vw-3rem))]"
      style={{ top: TOAST_TOP[chrome], zIndex: TOAST_Z }}
    >
      <div role="status" aria-live="polite" className="flex flex-col gap-2">
        {polite.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>

      <div role="alert" aria-live="assertive" className="flex flex-col gap-2">
        {assertive.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </div>
  )
}
