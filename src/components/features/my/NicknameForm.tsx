'use client'

import { useState, useTransition } from 'react'
import { TOUCH_MIN } from '@/lib/spacing'
import { useRouter } from 'next/navigation'
import { updateNickname } from '@/lib/actions/profile'
import {
  NICKNAME_MAX,
  NICKNAME_PLACEHOLDER,
  NICKNAME_RULE_HINT,
  validateNicknameFormat,
} from '@/lib/nickname'

type Feedback = { tone: 'ok' | 'error'; text: string } | null

/**
 * 닉네임 변경 폼.
 *
 * 🔴 형식 검사는 저장 전에 화면에서도 한 번 한다. 같은 순수 함수를 쓰므로
 *    서버와 판정이 갈리지 않는다. 서버 검사를 대신하는 것이 아니라 왕복을 줄이는 것이다.
 */
export default function NicknameForm({ current }: { current: string }) {
  const router = useRouter()
  const [value, setValue] = useState(current)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmed = value.trim()

    const formatError = validateNicknameFormat(trimmed)
    if (formatError) {
      setFeedback({ tone: 'error', text: formatError })
      return
    }

    startTransition(async () => {
      const result = await updateNickname(trimmed)
      if (result.error) {
        setFeedback({ tone: 'error', text: result.error })
        return
      }
      setFeedback({
        tone: 'ok',
        text: result.unchanged ? '지금 쓰고 계신 이름이에요.' : '이름을 바꿨어요.',
      })
      // 🔴 실제로 바뀐 경우에만 다시 그린다. 서버 액션의 revalidate 는 캐시를 비울 뿐
      //    지금 보고 있는 화면을 새로 그리지는 않아, 위쪽 이름이 옛 값으로 남는다.
      //    무변경·오류에서는 부르지 않는다 — 바뀐 것이 없는데 화면만 깜빡인다.
      if (!result.unchanged) router.refresh()
    })
  }

  return (
    <form onSubmit={onSubmit} className="mt-3">
      <label htmlFor="nickname" className="block text-sm font-medium text-content-primary">
        닉네임
      </label>
      <div className="mt-2 flex flex-wrap items-start gap-2">
        <input
          id="nickname"
          name="nickname"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setFeedback(null)
          }}
          maxLength={NICKNAME_MAX}
          placeholder={NICKNAME_PLACEHOLDER}
          aria-describedby="nickname-hint"
          className="min-h-[52px] min-w-0 flex-1 rounded-lg border border-interactive bg-surface-card px-3 text-content-primary"
        />
        <button
          type="submit"
          disabled={pending}
          className={`inline-flex ${TOUCH_MIN} shrink-0 items-center rounded-lg border border-interactive px-4 font-bold text-brand-strong transition duration-150 hover:bg-surface-soft active:scale-[0.98] disabled:opacity-60`}
        >
          {pending ? '저장 중' : '변경'}
        </button>
      </div>
      <p id="nickname-hint" className="mt-2 text-sm text-content-muted">
        {NICKNAME_RULE_HINT}
      </p>
      {feedback ? (
        /* 색만으로 알리지 않는다 — 글자와 함께 바뀐다 */
        <p
          role="status"
          className={
            feedback.tone === 'ok'
              ? 'mt-1 text-sm font-bold text-state-success'
              : 'mt-1 text-sm font-bold text-state-danger'
          }
        >
          <span aria-hidden>{feedback.tone === 'ok' ? '✅' : '❌'}</span>{' '}
          {feedback.text}
        </p>
      ) : null}
    </form>
  )
}
