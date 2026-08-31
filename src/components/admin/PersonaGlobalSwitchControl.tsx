'use client'

import { useState, useTransition } from 'react'
import { setPersonaGlobalSwitch } from '@/lib/actions/persona-switch'

/**
 * 전체 중지 kill switch — 🔴 이 화면의 유일한 write 기능
 *
 * 🔴 enabled 는 "중지" 를 뜻한다. 이름 때문에 반대로 읽히기 쉽다.
 *      true  = 중지 켜짐 — 모든 페르소나 발화가 멈춘다
 *      false = 중지 꺼짐 — 멈춰 있지 않다
 *      행 없음 = false 와 같다
 *
 * 🔴 confirm 은 **해제할 때만** 묻는다.
 *    중지 켜기는 사고 대응이다 — 한 번 더 묻는 동안 사고가 커진다.
 *    중지 해제는 발화 가능 상태로 되돌리는 것이므로 확인을 받는다.
 */
export default function PersonaGlobalSwitchControl({
  initialEnabled,
  exists,
}: {
  /** 🔴 중지 상태. true = 중지 켜짐 */
  initialEnabled: boolean
  exists: boolean
}) {
  const [stopped, setStopped] = useState(initialEnabled)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  /** 다음 중지 상태 */
  const nextStopped = !stopped

  function submit() {
    setError(null)
    const trimmed = reason.trim()
    if (trimmed === '') {
      setError('사유를 적어 주세요.')
      return
    }
    // 🔴 해제할 때만 묻는다. 중지는 즉시 걸린다
    if (!nextStopped && !window.confirm('전체 중지를 해제합니다. 계속할까요?')) return

    startTransition(async () => {
      const res = await setPersonaGlobalSwitch(nextStopped, trimmed)
      if (res.error !== undefined) {
        setError(res.error)
        return
      }
      setStopped(res.enabled === true)
      setReason('')
    })
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-content-primary">전체 중지 스위치</span>
        <span
          className={`rounded-md px-2 py-1 text-xs font-bold ${
            stopped ? 'bg-surface-soft text-brand-ink' : 'bg-surface-soft text-content-muted'
          }`}
        >
          {stopped ? '중지 켜짐' : exists ? '중지 꺼짐' : '중지 꺼짐 (미생성)'}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label htmlFor="switch-reason" className="sr-only">
          변경 사유
        </label>
        <input
          id="switch-reason"
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="변경 사유 (필수)"
          maxLength={200}
          disabled={pending}
          className="min-h-[44px] flex-1 rounded-md border border-subtle bg-surface-card px-3 py-2 text-sm text-content-primary"
        />
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="min-h-[44px] rounded-md border border-subtle px-4 py-2 text-sm font-bold text-content-primary disabled:opacity-60"
        >
          {pending ? '변경 중…' : nextStopped ? '중지 켜기' : '중지 해제'}
        </button>
      </div>

      {error !== null ? <p className="mt-2 text-xs text-brand-ink">{error}</p> : null}
      <p className="mt-2 text-xs text-content-muted">
        🔴 중지를 해제해도 지금은 발화가 일어나지 않습니다 — 페르소나가 전부 준비 중(draft)이고
        생성 경로가 연결돼 있지 않습니다. 이 스위치는 그 경로가 열릴 때 멈추기 위한 것입니다.
      </p>
    </div>
  )
}
