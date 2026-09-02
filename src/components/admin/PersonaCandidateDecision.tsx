'use client'

import { useState, useTransition } from 'react'
import { decidePersonaCandidate } from '@/lib/actions/persona-candidate'
import { DECLINE_REASONS, canDecide, type CandidateStatus } from '@/lib/persona-candidate-rules'

/**
 * 후보 결정 — 승인 · 폐기
 *
 * 🔴 승인은 발행이 아니다. APPROVED 에 머문다.
 *    화면에 그렇게 적어 둔다 — 버튼을 누르는 사람이 발행이라고 오해하면
 *    "승인했는데 왜 안 올라오나" 가 아니라 "올라갈 줄 몰랐다" 가 된다.
 *
 * 🔴 폐기 사유는 고르는 것이지 쓰는 것이 아니다.
 *    자유 텍스트면 집계가 안 되고, 집계가 안 되면 Gate 개선 근거가 되지 못한다.
 *
 * 🔴 confirm 은 폐기에만 묻는다. 폐기는 되돌리는 버튼이 없다.
 */
export default function PersonaCandidateDecision({
  candidateId,
  status,
}: {
  candidateId: string
  status: CandidateStatus
}) {
  const [reason, setReason] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const decidable = canDecide(status)

  if (!decidable) {
    return (
      <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600">
        이미 결정된 후보입니다 (현재 {status}). 대기 상태만 결정할 수 있습니다.
      </div>
    )
  }

  function run(decision: 'approve' | 'decline') {
    setError(null)
    if (decision === 'decline') {
      if (reason === '') {
        setError('폐기 사유를 선택해 주세요.')
        return
      }
      if (!window.confirm('폐기하면 되돌릴 수 없습니다. 계속할까요?')) return
    }
    startTransition(async () => {
      const res = await decidePersonaCandidate(
        candidateId,
        decision,
        decision === 'decline' ? reason : undefined,
      )
      if (res.error !== undefined) setError(res.error)
      else setDone(res.nextStatus ?? null)
    })
  }

  if (done !== null) {
    return (
      <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-900">
        처리했습니다 — {done}.
        {done === 'APPROVED' && ' 🔴 승인이지 발행이 아닙니다. 고객 화면에 올라가지 않았습니다.'}
      </div>
    )
  }

  return (
    <div className="rounded-lg bg-amber-50 px-4 py-3">
      <div className="mb-3">
        <label htmlFor="decline-reason" className="mb-1 block text-xs font-bold text-amber-900">
          폐기 사유 (폐기할 때만)
        </label>
        <select
          id="decline-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={pending}
          className="min-h-[52px] w-full rounded-lg border border-gray-300 bg-white px-3 text-sm"
        >
          <option value="">— 선택 —</option>
          {DECLINE_REASONS.map((r) => (
            <option key={r.code} value={r.code}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => run('approve')}
          disabled={pending}
          className="min-h-[52px] rounded-lg bg-cta px-5 text-sm font-bold text-cta-text disabled:opacity-50"
        >
          {pending ? '처리 중…' : '승인'}
        </button>
        <button
          type="button"
          onClick={() => run('decline')}
          disabled={pending}
          className="min-h-[52px] rounded-lg border border-gray-400 bg-white px-5 text-sm text-gray-700 disabled:opacity-50"
        >
          폐기
        </button>
        <button
          type="button"
          disabled
          title="editedText · editDiff 가 필요해 다음 단계로 미뤘습니다"
          className="min-h-[52px] cursor-not-allowed rounded-lg border border-gray-300 bg-gray-100 px-5 text-sm text-gray-400"
        >
          수정 후 승인
        </button>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-amber-900">
        🔴 승인해도 발행되지 않습니다. 고객 화면에 올라가지 않고 APPROVED 에 머뭅니다.
        <br />
        수정 후 승인은 수정본과 diff 기록이 필요해 다음 단계로 미뤘습니다.
      </p>

      {error !== null && (
        <p className="mt-2 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}
    </div>
  )
}
