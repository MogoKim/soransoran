'use client'

import { useFormState } from 'react-dom'
import { createHomeOverride, type HomeExposureState } from '@/lib/actions/admin-home-exposure'
import { EXPIRY_CHOICES } from '@/lib/home-exposure-rules'

/**
 * 글 하나에 홈 노출 예외를 건다 — 고정 또는 홈에서만 숨김.
 *
 * 🔴 submit 버튼의 name·value 로 동작을 넘기지 않는다.
 *    react-dom 18 + useFormState 조합에서는 눌린 버튼(submitter)의 name·value 가
 *    FormData 에 들어오지 않는다. 그래서 서버 액션이 action='' 로 받아
 *    "알 수 없는 동작입니다." 만 돌려주고 한 건도 저장되지 않았다(실측 0행).
 *    저장소의 다른 폼들(CommentForm · ReportButton · DeleteButton · PostEditForm)이
 *    전부 hidden input 을 쓰는 이유가 이것이다. 규약을 따른다.
 *
 * 🔴 그래서 PIN 과 HIDE 를 **각각 독립 form** 으로 나눈다.
 *    한 form 안에 버튼 두 개를 두면 어느 것을 눌렀는지 구분할 방법이 다시
 *    submitter 로 돌아간다. 만료 select 가 두 번 그려지지만,
 *    화면이 조금 반복되는 쪽이 조용히 저장 안 되는 쪽보다 낫다.
 *
 * 🔴 기본 만료는 4시간이다. 급할 때 누르는 버튼이라, 고르지 않으면
 *    영원히 남는 쪽이 더 위험하다.
 */

function ExpirySelect() {
  return (
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
  )
}

function Message({ state }: { state: HomeExposureState }) {
  if (state.error) return <p className="text-sm text-state-danger">{state.error}</p>
  if (state.ok) return <p className="text-sm text-state-success">적용했습니다.</p>
  return null
}

export default function AdminHomeOverrideForm({
  postId,
  compact = false,
}: {
  postId: string
  compact?: boolean
}) {
  // 🔴 폼마다 상태를 따로 둔다. 하나로 묶으면 고정 결과가 숨김 폼에도 뜬다.
  const [pinState, pinAction] = useFormState<HomeExposureState, FormData>(createHomeOverride, {})
  const [hideState, hideAction] = useFormState<HomeExposureState, FormData>(createHomeOverride, {})

  return (
    <div className="mt-2 flex flex-col gap-3">
      <form action={pinAction} className="flex flex-col gap-2">
        <input type="hidden" name="postId" value={postId} />
        <input type="hidden" name="action" value="PIN" />
        <ExpirySelect />
        <Message state={pinState} />
        <button
          type="submit"
          className="inline-flex min-h-[52px] items-center justify-center rounded-lg bg-cta px-4 font-bold text-cta-text transition duration-150 hover:brightness-95 active:scale-[0.98]"
        >
          홈에 고정
        </button>
      </form>

      <form action={hideAction} className="flex flex-col gap-2">
        <input type="hidden" name="postId" value={postId} />
        <input type="hidden" name="action" value="HIDE" />
        <ExpirySelect />
        <Message state={hideState} />
        <button
          type="submit"
          className="inline-flex min-h-[52px] items-center justify-center rounded-lg border border-interactive px-4 font-bold text-brand-ink transition duration-150 hover:bg-surface-soft active:scale-[0.98]"
        >
          홈에서만 숨김
        </button>
      </form>

      {compact ? null : (
        <p className="text-xs text-content-muted">
          숨김은 홈에서만 빠지는 것입니다. 글 자체는 게시판에 그대로 남습니다.
        </p>
      )}
    </div>
  )
}
