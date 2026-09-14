'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  activateHeroBanner,
  deactivateHeroBanner,
  type HeroBannerActionState,
} from '@/lib/actions/admin-hero-banner'

/**
 * 배너를 켜고 끈다.
 *
 * 🔴 켤 수 없는 이유를 **버튼 바로 옆에** 적는다. 버튼만 흐리게 두면
 *    운영자는 무엇을 채워야 하는지 모른 채 화면을 위아래로 뒤진다.
 *    이유는 서버와 같은 함수(canActivateHeroBanner)가 만든 문장을 그대로 받는다.
 *
 * 🔴 그래도 버튼을 **막지 않는다.** 화면이 계산한 이유가 틀릴 수 있고
 *    (예: 방금 다른 운영자가 배너를 껐다), 그때 눌러 보지도 못하면 길이 막힌다.
 *    최종 판정은 누른 뒤 서버가 한다 — 실패하면 그 문장을 그대로 보여 준다.
 *
 * 🔴 끄기에는 확인을 묻지 않는다. 되돌리기 쉬운 조작이고,
 *    지금 홈에 나가는 배너를 급히 내려야 할 때 확인창이 한 단계를 더 만든다.
 */
export default function HeroBannerActivation({
  bannerId,
  isActive,
  blockedReason,
}: {
  bannerId: string
  isActive: boolean
  /** 켤 수 없는 이유. null 이면 지금 켤 수 있다. */
  blockedReason: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function run(fn: () => Promise<HeroBannerActionState>) {
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
    'inline-flex min-h-[52px] items-center justify-center rounded-lg px-4 font-bold transition duration-150 active:scale-[0.98] disabled:opacity-50 lg:min-h-[48px]'

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {isActive ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => deactivateHeroBanner(bannerId))}
            className={`${base} border border-interactive text-content-primary hover:bg-surface-soft`}
            title="끄기 — 홈에서 내려갑니다. 배너는 그대로 남습니다"
          >
            {pending ? '처리 중…' : '끄기'}
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => activateHeroBanner(bannerId))}
            className={`${base} bg-cta text-content-primary hover:brightness-95`}
            title="켜기 — 예약 시간에 맞춰 홈에 나갑니다"
          >
            {pending ? '처리 중…' : '켜기'}
          </button>
        )}

        <span className="text-sm text-content-muted">
          {isActive
            ? '켜져 있습니다. 예약 시간 안에 있으면 홈에 나갑니다.'
            : '꺼져 있습니다. 홈에 나가지 않습니다.'}
        </span>
      </div>

      {!isActive && blockedReason ? (
        <p className="m-0 text-sm text-state-warning">{blockedReason}</p>
      ) : null}
      {error ? <p className="m-0 text-sm text-state-danger">{error}</p> : null}
    </div>
  )
}
