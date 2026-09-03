'use client'

import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { createHomeOverride, type HomeExposureState } from '@/lib/actions/admin-home-exposure'
import { EXPIRY_CHOICES } from '@/lib/home-exposure-rules'

/**
 * 글 하나에 홈 노출 예외를 건다 — 고정 또는 홈에서만 숨김.
 *
 * 🔴 submit 버튼의 name·value 로 동작을 넘기지 않는다.
 *    react-dom 18 + useFormState 조합에서는 눌린 버튼(submitter)의 name·value 가
 *    FormData 에 들어오지 않는다. 그래서 서버 액션이 action='' 로 받아
 *    "알 수 없는 동작입니다." 만 돌려주고 한 건도 저장되지 않았다(실측 0행).
 *    보내야 하는 값은 전부 hidden input 으로 넣는다.
 *
 * 🔴 PIN 과 HIDE 는 각각 독립 form 이다. 한 form 에 버튼 두 개를 두면
 *    어느 것을 눌렀는지 구분할 방법이 다시 submitter 로 돌아간다.
 *
 * 🔴 만료 select 는 화면에 하나만 둔다. 폼이 둘이라 예전에는 select 도 둘이었고,
 *    글 14 개면 select 28 개 · 큰 버튼 28 개가 목록을 덮어 정작 글이 보이지 않았다.
 *    보이는 select 는 form 밖에 두고 값을 hidden input 으로 양쪽에 미러링한다 —
 *    form 밖 컨트롤은 FormData 에 담기지 않기 때문이다.
 *
 * 🔴 기본 만료는 4시간이다. 급할 때 누르는 버튼이라, 고르지 않으면
 *    영원히 남는 쪽이 더 위험하다.
 *
 * 🔴 누르는 동안 잠근다. 이 액션은 update 가 아니라 create 다 —
 *    두 번 눌리면 앞선 예외가 꺼지고 새 행이 하나 더 남는다.
 *    ActionButton 을 쓰지 않는 이유는 색이다. 그쪽은 tone 이 색을 정하는데
 *    이 버튼은 목록 안에서 조용해야 해서 테두리형을 유지해야 한다.
 */

/** 목록 안에서 쓰는 작은 버튼. 데스크탑은 조용히, 모바일은 누를 수 있게. */
const BTN =
  'inline-flex min-h-[52px] items-center justify-center rounded-lg border border-interactive px-3 text-sm font-bold text-content-primary transition duration-150 hover:bg-surface-soft active:scale-[0.98] disabled:opacity-50 lg:min-h-[32px]'

/**
 * 🔴 useFormStatus 는 form 의 자식에서만 값을 읽는다.
 *    그래서 버튼을 작은 컴포넌트로 떼어 각 form 안에 둔다 —
 *    PIN·HIDE 가 독립 form 이라 자기 것만 잠긴다.
 */
function SubmitBtn({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className={BTN}>
      {pending ? '처리 중…' : label}
    </button>
  )
}

export default function AdminHomeOverrideForm({ postId }: { postId: string }) {
  // 🔴 폼마다 상태를 따로 둔다. 하나로 묶으면 고정 결과가 숨김 폼에도 뜬다.
  const [pinState, pinAction] = useFormState<HomeExposureState, FormData>(createHomeOverride, {})
  const [hideState, hideAction] = useFormState<HomeExposureState, FormData>(createHomeOverride, {})
  const [expiry, setExpiry] = useState<string>('FOUR_HOURS')

  const error = pinState.error ?? hideState.error ?? null
  const done = pinState.ok || hideState.ok

  return (
    <div className="flex flex-col gap-1 lg:items-end">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`expiry-${postId}`}>
          언제까지 걸어 둘지
        </label>
        <select
          id={`expiry-${postId}`}
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
          className="min-h-[52px] rounded-lg border border-subtle bg-surface-card px-2 text-sm text-content-primary lg:min-h-[32px]"
        >
          {EXPIRY_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>

        <form action={pinAction}>
          <input type="hidden" name="postId" value={postId} />
          <input type="hidden" name="action" value="PIN" />
          <input type="hidden" name="expiry" value={expiry} />
          <SubmitBtn label="고정" />
        </form>

        <form action={hideAction}>
          <input type="hidden" name="postId" value={postId} />
          <input type="hidden" name="action" value="HIDE" />
          <input type="hidden" name="expiry" value={expiry} />
          <SubmitBtn label="숨김" />
        </form>
      </div>

      {error ? <p className="m-0 text-xs text-state-danger">{error}</p> : null}
      {!error && done ? <p className="m-0 text-xs text-state-success">적용했습니다.</p> : null}
    </div>
  )
}
