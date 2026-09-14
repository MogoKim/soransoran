'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  moveHeroBanner,
  archiveHeroBanner,
  restoreHeroBanner,
  type HeroBannerActionState,
} from '@/lib/actions/admin-hero-banner'
import { IconArrowUp, IconArrowDown, IconArchive, IconRestore } from './HeroBannerIcons'

/**
 * 목록 한 줄의 조작 — 위·아래·보관·복원.
 *
 * 🔴 켜기·끄기는 여기 없다. 그것은 편집 화면에서만 한다 —
 *    목록에서 바로 켜면 "왜 안 켜지는지"(이미지 없음·5장 초과) 를 설명할 자리가 없다.
 *
 * 🔴 보관에는 확인을 묻고 복원에는 묻지 않는다.
 *    보관은 켜져 있던 배너를 내리는 조작이고, 복원은 꺼진 채로 꺼내는 조작이라
 *    무게가 다르다. 매번 물으면 사람이 읽지 않고 누르게 된다.
 *
 * 🔴 터치 타겟은 모바일 52px · 데스크탑 48px 이다. 아이콘만 있는 버튼이라
 *    작게 만들면 손가락이 옆 버튼을 누른다 — 순서가 엉뚱하게 바뀐다.
 */
export default function HeroBannerRowControls({
  bannerId,
  archived,
  canMoveUp,
  canMoveDown,
}: {
  bannerId: string
  archived: boolean
  canMoveUp: boolean
  canMoveDown: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function run(fn: () => Promise<HeroBannerActionState>, confirmText?: string) {
    setError(null)
    if (confirmText && !window.confirm(confirmText)) return
    startTransition(async () => {
      const res = await fn()
      if (res.error) {
        setError(res.error)
        return
      }
      router.refresh()
    })
  }

  const base =
    'inline-flex min-h-[52px] min-w-[52px] items-center justify-center rounded-lg px-2 text-sm transition duration-150 active:scale-[0.98] disabled:opacity-40 lg:min-h-[48px] lg:min-w-[48px]'
  const ghost = `${base} text-content-muted hover:bg-surface-soft hover:text-content-primary`
  const outline = `${base} border border-interactive text-content-primary hover:bg-surface-soft`

  return (
    <div className="flex flex-col gap-1 lg:items-end">
      <div className="flex flex-wrap items-center gap-1">
        {archived ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => restoreHeroBanner(bannerId))}
            className={outline}
            title="보관 풀기 — 꺼진 상태로 돌아옵니다"
            aria-label="보관 풀기"
          >
            <IconRestore />
            <span className="ml-1">복원</span>
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={pending || !canMoveUp}
              onClick={() => run(() => moveHeroBanner(bannerId, 'up'))}
              className={ghost}
              title="한 칸 위로 — 앞에서 보입니다"
              aria-label="한 칸 위로"
            >
              <IconArrowUp />
            </button>
            <button
              type="button"
              disabled={pending || !canMoveDown}
              onClick={() => run(() => moveHeroBanner(bannerId, 'down'))}
              className={ghost}
              title="한 칸 아래로 — 뒤에서 보입니다"
              aria-label="한 칸 아래로"
            >
              <IconArrowDown />
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(
                  () => archiveHeroBanner(bannerId),
                  '이 배너를 보관할까요? 꺼진 뒤 보관함으로 옮겨집니다. 언제든 되돌릴 수 있습니다.',
                )
              }
              className={outline}
              title="보관 — 끄고 보관함으로 옮깁니다. 삭제가 아닙니다"
              aria-label="보관"
            >
              <IconArchive />
              <span className="ml-1">보관</span>
            </button>
          </>
        )}
      </div>
      {error ? <p className="m-0 text-xs text-state-danger">{error}</p> : null}
    </div>
  )
}
