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
 * 🔴 **"홈에 나간다" 고 쓰지 않는다.** PR 2 에서 홈(/)은 이 테이블을 읽지 않아
 *    켜 두어도 고객 화면은 그대로다. 여기서 말할 수 있는 것은 "설정을 저장했다" 뿐이다 —
 *    화면이 노출을 약속하면 운영자는 홈을 열어 보고 고장이라고 판단한다.
 *
 * 🔴 켤 수 없는 이유를 **버튼 바로 옆에** 적는다. 버튼만 흐리게 두면
 *    운영자는 무엇을 채워야 하는지 모른 채 화면을 위아래로 뒤진다.
 *    이유는 서버와 같은 함수(canActivateHeroBanner)가 만든 문장을 그대로 받는다.
 *
 * 🔴 이유가 있으면 **켜기 버튼을 잠근다.** 눌러 봐야 서버가 같은 이유로 거절하는데,
 *    누를 수 있게 두면 운영자는 "눌렀는데 안 된다" 를 반복하며 원인을 화면 밖에서 찾는다.
 *    상태가 바뀌면(이미지 업로드 · 내용 저장) router.refresh() 가 이 값을 다시 계산해
 *    조건이 풀리는 순간 버튼이 열린다 — 잠금이 막다른 길이 되지 않는 이유다.
 *
 * 🔴 그래도 **서버가 최종 권위자다.** 이 잠금은 편의이지 안전장치가 아니다 —
 *    이 화면을 열어 둔 사이 다른 운영자가 배너를 켜면 5장 판정이 달라진다.
 *    activateHeroBanner 는 여전히 canActivateHeroBanner 와 capacity 를 다시 본다.
 *
 * 🔴 **끄기에는 이 잠금을 걸지 않는다.** 끄는 것은 자리를 비우는 조작이라
 *    막을 이유가 없고, 막으면 잘못 켜진 배너를 되돌릴 길이 사라진다.
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
            title="끄기 — 설정을 꺼짐으로 저장합니다. 배너와 이미지는 그대로 남습니다"
          >
            {pending ? '처리 중…' : '끄기'}
          </button>
        ) : (
          <button
            type="button"
            disabled={pending || Boolean(blockedReason)}
            onClick={() => run(() => activateHeroBanner(bannerId))}
            className={`${base} bg-cta text-content-primary hover:brightness-95`}
            title={
              blockedReason
                ? `아직 켤 수 없습니다 — ${blockedReason}`
                : '켜기 — 설정을 켬으로 저장합니다. 홈 화면 연결은 다음 단계입니다'
            }
          >
            {pending ? '처리 중…' : '켜기'}
          </button>
        )}

        <span className="text-sm text-content-muted">
          {isActive
            ? '켜 둠 — 설정이 저장된 상태입니다. 홈 화면 연결은 다음 단계입니다.'
            : '꺼 둠 — 설정이 저장된 상태입니다.'}
        </span>
      </div>

      {/* 🔴 잠근 이유는 버튼 바로 아래에 계속 둔다 — 흐린 버튼만으로는 무엇을 채울지 모른다 */}
      {!isActive && blockedReason ? (
        <p className="m-0 text-sm text-state-warning">아직 켤 수 없습니다 — {blockedReason}</p>
      ) : null}
      {error ? <p className="m-0 text-sm text-state-danger">{error}</p> : null}
    </div>
  )
}
