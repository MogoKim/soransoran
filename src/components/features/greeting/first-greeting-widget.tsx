'use client'

import { useState } from 'react'
import { TOUCH_MIN } from '@/lib/spacing'
import { useFormState, useFormStatus } from 'react-dom'
import { submitGreeting, type GreetingActionState } from '@/lib/actions/greeting'
import {
  FIRST_GREETING_MAX_LENGTH,
  FIRST_GREETING_MIN_LENGTH,
} from '@/lib/greeting-policy'
import { cn } from '@/lib/utils'

const PLACEHOLDER = '예) 안녕하세요, 잘 부탁드려요!'

/**
 * 🔴 ActionButton 을 쓰지 않는다.
 *    그쪽은 disabled 를 prop 으로 받는데, 여기서는 입력 길이에 따라 매 글자
 *    바뀌어야 한다. 폼 안에서 pending 과 길이를 함께 보는 버튼이 따로 필요하다.
 */
function SubmitButton({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus()
  const disabled = pending || !enabled

  return (
    <button
      type="submit"
      disabled={disabled}
      className={cn(
        `mt-3 ${TOUCH_MIN} w-full rounded-xl bg-cta px-5 text-lg font-bold text-cta-content transition duration-150`,
        /* 🔴 회색으로 죽인다 — opacity 로만 흐리면 "누를 수 있는데 흐린 것" 으로 읽힌다 */
        'disabled:bg-surface-page disabled:text-content-muted disabled:opacity-100',
        'enabled:hover:brightness-95 enabled:active:scale-95',
      )}
    >
      {pending ? '남기는 중…' : '첫 인사 남기기'}
    </button>
  )
}

/**
 * 홈 첫 인사 위젯 — 막 온 사람에게 한 줄 인사를 권한다.
 *
 * 🔴 보여줄지 말지는 여기서 정하지 않는다.
 *    홈이 서버에서 판정해 통과했을 때만 이 컴포넌트를 그린다
 *    (queries/greeting.ts). 클라이언트가 다시 판정하면 두 규칙이 생긴다.
 *
 * 🔴 다 쓰고 나면 다른 화면으로 보내지 않는다.
 *    인사 하나 남겼다고 홈 밖으로 끌어내면, 방금 "여기 있어도 된다" 고
 *    말해 놓고 내보내는 셈이다. 자리에서 인사만 바뀐다.
 *
 * 🔴 localStorage 를 쓰지 않는다.
 *    성공 뒤 이 화면에서 감추는 것은 지금 보이는 것을 정리하는 일이고,
 *    다음 방문에 다시 뜨지 않게 하는 것은 DB(firstGreetingAt)가 맡는다.
 */
export default function FirstGreetingWidget() {
  const [state, formAction] = useFormState<GreetingActionState, FormData>(submitGreeting, {})
  const [content, setContent] = useState('')

  // 저장이 끝나면 인사만 남긴다. 같은 자리에서 폼을 걷어낸다.
  if (state.postId) {
    return (
      <section
        className="mx-4 my-4 rounded-2xl bg-surface-soft px-5 py-6 text-center"
        aria-label="첫 인사 완료"
      >
        <p role="status" className="m-0 font-bold text-content-primary">
          인사를 남기셨어요. 반갑습니다!
        </p>
        <p className="m-0 mt-1 break-keep leading-relaxed text-content-secondary">
          이웃들이 곧 인사를 건넬 거예요.
        </p>
      </section>
    )
  }

  const enabled = content.trim().length >= FIRST_GREETING_MIN_LENGTH

  return (
    <section className="mx-4 my-4 rounded-2xl bg-surface-soft px-5 py-6" aria-label="첫 인사 남기기">
      <h2 className="m-0 break-keep font-bold leading-snug text-content-primary">
        <span className="mr-1.5" aria-hidden>
          👋
        </span>
        처음 오셨군요! 첫 인사를 남겨보세요
      </h2>
      <p className="m-0 mt-1 break-keep leading-relaxed text-content-secondary">
        이웃들이 따뜻하게 맞아드릴 거예요. 한 줄이면 충분해요.
      </p>

      <form action={formAction}>
        <textarea
          name="content"
          rows={2}
          maxLength={FIRST_GREETING_MAX_LENGTH}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={PLACEHOLDER}
          aria-label="인사말"
          className="mt-3 w-full resize-none rounded-xl border border-subtle bg-surface-card p-3 leading-relaxed text-content-primary placeholder:text-content-muted"
        />

        {state.error ? (
          <p role="alert" className="mt-2 break-keep leading-snug text-state-danger">
            {state.error}
          </p>
        ) : null}

        <SubmitButton enabled={enabled} />
      </form>
    </section>
  )
}
