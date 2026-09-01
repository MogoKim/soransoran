'use client'

import { useFormState } from 'react-dom'
import { createHomeOverride, type HomeExposureState } from '@/lib/actions/admin-home-exposure'
import { EXPIRY_CHOICES } from '@/lib/home-exposure-rules'

/**
 * 글 하나에 홈 노출 예외를 건다 — 고정 또는 홈에서만 숨김.
 *
 * 🔴 만료를 고르지 않고는 누를 수 없게 두지 않는다. 기본값을 "4시간" 으로 둔다 —
 *    운영자가 급할 때 누르는 버튼이라, 고르지 않으면 영원히 남는 쪽이 더 위험하다.
 *
 * 🔴 "홈에서만 숨김" 이라고 적는다. 글을 숨기는 버튼과 한 화면에 있지 않지만,
 *    운영자는 두 개를 같은 것으로 기억하기 쉽다.
 */
export default function AdminHomeOverrideForm({
  postId,
  compact = false,
}: {
  postId: string
  compact?: boolean
}) {
  const [state, formAction] = useFormState<HomeExposureState, FormData>(createHomeOverride, {})

  return (
    <form action={formAction} className="mt-2 flex flex-col gap-2">
      <input type="hidden" name="postId" value={postId} />

      <label className="flex flex-col gap-1">
        <span className="text-xs text-content-muted">언제까지</span>
        <select
          name="expiry"
          defaultValue="FOUR_HOURS"
          className="min-h-[52px] rounded-lg border border-subtle bg-surface-card px-3 text-content-primary"
        >
          {EXPIRY_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      {state.error ? <p className="text-sm text-state-danger">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-state-success">적용했습니다.</p> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          name="action"
          value="PIN"
          className="inline-flex min-h-[52px] flex-1 items-center justify-center rounded-lg bg-cta px-4 font-bold text-cta-text transition duration-150 hover:brightness-95 active:scale-[0.98]"
        >
          홈에 고정
        </button>
        <button
          type="submit"
          name="action"
          value="HIDE"
          className="inline-flex min-h-[52px] flex-1 items-center justify-center rounded-lg border border-interactive px-4 font-bold text-brand-ink transition duration-150 hover:bg-surface-soft active:scale-[0.98]"
        >
          홈에서만 숨김
        </button>
      </div>

      {compact ? null : (
        <p className="text-xs text-content-muted">
          숨김은 홈에서만 빠지는 것입니다. 글 자체는 게시판에 그대로 남습니다.
        </p>
      )}
    </form>
  )
}
