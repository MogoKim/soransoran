'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useFormState, useFormStatus } from 'react-dom'
import {
  createHeroBanner,
  type HeroBannerActionState,
} from '@/lib/actions/admin-hero-banner'
import { HERO_BANNER_MAX_NAME_LENGTH } from '@/lib/hero-banner-rules'

/**
 * 새 배너 초안 만들기 — 이름 하나만 받는다.
 *
 * 🔴 여기서 이미지·링크·예약을 묻지 않는다. 만들기 전에 다 채우게 하면
 *    이미지를 올리다 실패했을 때 저장할 배너 자체가 없어 R2 에 주인 없는 파일이 남는다.
 *    먼저 빈 초안을 만들고, 그 배너에 이미지를 붙인다.
 *
 * 🔴 만든 뒤 편집 화면으로 **넘어간다.** 목록에 머물면 방금 만든 줄을 다시 찾아
 *    눌러야 하는데, 이름만 있는 줄이 여럿이면 어느 것인지 알 수 없다.
 *
 * 🔴 submitter 의 name·value 에 기대지 않는다 — react-dom 18 + useFormState 에서는
 *    FormData 에 담기지 않는다(AdminHomeOverrideForm 에서 실제로 겪은 결함).
 */
function SubmitBtn() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-[52px] items-center justify-center rounded-lg bg-cta px-4 font-bold text-content-primary transition duration-150 hover:brightness-95 active:scale-[0.98] disabled:opacity-50 lg:min-h-[48px]"
    >
      {pending ? '만드는 중…' : '초안 만들기'}
    </button>
  )
}

export default function HeroBannerCreateForm() {
  const router = useRouter()
  const [state, formAction] = useFormState<HeroBannerActionState, FormData>(createHeroBanner, {})

  // 🔴 렌더 중에 push 하지 않는다 — 만들어진 뒤에 한 번만 넘어간다.
  useEffect(() => {
    if (state.ok && state.id) router.push(`/admin/banners/${state.id}`)
  }, [state.ok, state.id, router])

  return (
    <form action={formAction} className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
      <div className="flex-1">
        <label htmlFor="new-banner-name" className="sr-only">
          운영용 배너 이름
        </label>
        <input
          id="new-banner-name"
          name="name"
          maxLength={HERO_BANNER_MAX_NAME_LENGTH}
          required
          placeholder="예: 10월 갱년기톡 안내"
          className="min-h-[52px] w-full rounded-lg border border-subtle bg-surface-card px-3 text-base text-content-primary lg:min-h-[48px]"
        />
        <p className="m-0 mt-1 text-xs text-content-muted">
          목록에서 배너를 구분하는 이름입니다. 화면에는 나가지 않습니다 ·{' '}
          {HERO_BANNER_MAX_NAME_LENGTH}자까지
        </p>
      </div>
      <SubmitBtn />
      {state.error ? (
        <p className="m-0 text-sm text-state-danger sm:basis-full">{state.error}</p>
      ) : null}
    </form>
  )
}
