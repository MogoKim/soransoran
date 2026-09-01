'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { AdminActionState } from '@/lib/actions/admin'

/**
 * 어드민 조치 버튼 — 이 파일 하나가 모든 조치 버튼을 맡는다.
 *
 * 🔴 조치마다 컴포넌트를 만들지 않는다. 1차 목표는 구조가 아니라 운영 가능 상태다.
 *    호출부가 서버 액션을 감싼 함수만 넘기면 된다.
 *
 * 🔴 confirm 은 되돌리기 어려운 쪽에만 붙인다.
 *    가리기·차단에는 묻고, 되돌리기(공개·해제)에는 묻지 않는다 —
 *    매번 물으면 사람이 읽지 않고 누르게 된다.
 *
 * 🔴 성공하면 router.refresh() 로 서버 컴포넌트를 다시 그린다.
 *    revalidatePath 만으로는 지금 보고 있는 화면이 바뀌지 않는다.
 */
export default function AdminActionButton({
  label,
  run,
  confirmText,
  tone = 'default',
  disabled,
}: {
  label: string
  run: () => Promise<AdminActionState>
  /** 있으면 누르기 전에 확인을 묻는다 */
  confirmText?: string
  tone?: 'default' | 'danger'
  disabled?: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onClick() {
    setError(null)
    if (confirmText && !window.confirm(confirmText)) return
    startTransition(async () => {
      const res = await run()
      if (res.error) {
        setError(res.error)
        return
      }
      router.refresh()
    })
  }

  const base =
    'inline-flex min-h-[52px] items-center justify-center rounded-lg px-4 font-bold transition duration-150 active:scale-[0.98] disabled:opacity-50'
  const skin =
    tone === 'danger'
      ? 'border border-interactive text-brand-ink hover:bg-surface-soft'
      : 'bg-cta text-cta-text hover:brightness-95'

  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={onClick} disabled={pending || disabled} className={`${base} ${skin}`}>
        {pending ? '처리 중…' : label}
      </button>
      {error ? <p className="text-sm text-state-danger">{error}</p> : null}
    </div>
  )
}
