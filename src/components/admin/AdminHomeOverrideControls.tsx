'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  deactivateHomeOverride,
  moveHomePin,
  type HomeExposureState,
} from '@/lib/actions/admin-home-exposure'

/**
 * 걸려 있는 예외 하나를 다루는 버튼들 — 해제 · 위로 · 아래로.
 *
 * 🔴 해제에는 확인을 묻지 않는다. 되돌리기 쉬운 조작이고,
 *    매번 물으면 사람이 읽지 않고 누르게 된다.
 */
export default function AdminHomeOverrideControls({
  overrideId,
  canMove,
}: {
  overrideId: string
  canMove: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function run(fn: () => Promise<HomeExposureState>) {
    setError(null)
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
    'inline-flex min-h-[52px] items-center justify-center rounded-lg border border-interactive px-4 font-bold text-brand-ink transition duration-150 hover:bg-surface-soft active:scale-[0.98] disabled:opacity-50'

  return (
    <div className="mt-2 flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        {canMove ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => moveHomePin(overrideId, 'up'))}
              className={base}
            >
              위로
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => moveHomePin(overrideId, 'down'))}
              className={base}
            >
              아래로
            </button>
          </>
        ) : null}
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => deactivateHomeOverride(overrideId))}
          className={base}
        >
          {pending ? '처리 중…' : '해제'}
        </button>
      </div>
      {error ? <p className="text-sm text-state-danger">{error}</p> : null}
    </div>
  )
}
