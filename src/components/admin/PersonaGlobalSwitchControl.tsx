'use client'

import { useState, useTransition } from 'react'
import { setPersonaGlobalSwitch } from '@/lib/actions/persona-switch'

/**
 * 전체 발화 kill switch — 🔴 이 화면의 유일한 write 기능
 *
 * 🔴 확인 단계를 둔다. 사고 상황에서 끄는 것은 즉시여야 하지만,
 *    켜는 것은 한 번 더 묻는다 — 잘못 켜면 페르소나가 말하기 시작한다.
 *    (지금은 status 가 전부 draft 라 실제 발화는 없지만,
 *     그 전제가 바뀌는 날 이 화면이 마지막 방어선이 된다)
 */
export default function PersonaGlobalSwitchControl({
  initialEnabled,
  exists,
}: {
  initialEnabled: boolean
  exists: boolean
}) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const next = !enabled

  function submit() {
    setError(null)
    const trimmed = reason.trim()
    if (trimmed === '') {
      setError('사유를 적어 주세요.')
      return
    }
    // 🔴 켤 때만 한 번 더 묻는다. 끄는 것은 막지 않는다
    if (next && !window.confirm('전체 발화를 켭니다. 계속할까요?')) return

    startTransition(async () => {
      const res = await setPersonaGlobalSwitch(next, trimmed)
      if (res.error !== undefined) {
        setError(res.error)
        return
      }
      setEnabled(res.enabled === true)
      setReason('')
    })
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-content-primary">전체 발화 스위치</span>
        <span
          className={`rounded-md px-2 py-1 text-xs font-bold ${
            enabled ? 'bg-surface-soft text-brand-ink' : 'bg-surface-soft text-content-muted'
          }`}
        >
          {!exists && !enabled ? '미생성 (= 꺼짐)' : enabled ? '켜짐' : '꺼짐'}
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
          {pending ? '변경 중…' : next ? '켜기' : '끄기'}
        </button>
      </div>

      {error !== null ? <p className="mt-2 text-xs text-brand-ink">{error}</p> : null}
      <p className="mt-2 text-xs text-content-muted">
        🔴 스위치를 켜도 지금은 발화가 일어나지 않습니다 — 페르소나가 전부 준비 중(draft)이고
        생성 경로가 연결돼 있지 않습니다. 이 스위치는 그 경로가 열릴 때를 위한 것입니다.
      </p>
    </div>
  )
}
