'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  deactivateHomeOverride,
  moveHomePin,
  type HomeExposureState,
} from '@/lib/actions/admin-home-exposure'
import { adminButtonClass } from '@/components/admin/AdminButton'

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

  /**
   * 🔴 순서 이동과 해제는 무게가 다르다.
   *    위/아래는 몇 번을 눌러도 되돌아오는 조작이라 테두리 없는 ghost 로 둔다.
   *    해제는 예외를 없애 홈 구성이 바로 바뀌므로 그것만 눈에 걸어 둔다.
   */
  /* 🔴 Admin Console V2 — 데스크탑 30px 버튼을 44px 로 올렸다. 해제는 위험 모양(빨간 테두리)이다. */
  const base = adminButtonClass('secondary', 'px-3 text-sm')
  const danger = adminButtonClass('danger', 'px-3 text-sm')

  return (
    <div className="flex flex-col gap-1 lg:items-end">
      <div className="flex flex-wrap items-center gap-1">
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
          className={danger}
        >
          {pending ? '처리 중…' : '해제'}
        </button>
      </div>
      {error ? <p className="m-0 text-xs text-state-danger">{error}</p> : null}
    </div>
  )
}
