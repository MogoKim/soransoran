'use client'

import { useState, useTransition } from 'react'
import { withdrawPersonaCandidate } from '@/lib/actions/persona-candidate'
import {
  DECLINE_REASONS, canWithdraw, WITHDRAWABLE_STATUSES, type CandidateStatus,
} from '@/lib/persona-candidate-rules'

/**
 * 승인 철회 — 🔴 **승인해 두고 아직 공개하지 않은 후보를 거둬들인다**
 *
 * 🔴 **결정을 뒤집는 버튼이 아니다.** 승인·폐기는 `PersonaCandidateDecision` 이
 *    `PENDING` 에서만 한다. 그 제한이 "언제 누가 정했나" 를 지킨다.
 *    여기는 그 뒤의 자리다 — 이미 승인된 것을 공개 전에 거둬들이는 일.
 *
 * 🔴 **보이는 조건이 곧 계약이다.** `APPROVED`·`EDITED` 이고 아직 공개되지 않은
 *    행에서만 나타난다. 다른 상태에서는 아무것도 그리지 않는다 —
 *    누를 수 없는 버튼을 회색으로 두면 "왜 안 되지" 를 묻게 된다.
 *
 * 🔴 **사유는 고르는 것이지 쓰는 것이 아니다.** 폐기와 같은 코드 집합을 쓴다 —
 *    자유 텍스트면 집계가 갈라진다.
 *
 * 🔴 원래 승인자·승인 시각은 server action 이 사유 문자열에 함께 남긴다.
 *    화면에서 그 사실을 미리 알린다 — 지워지는 줄 알고 망설이지 않게.
 */
export default function PersonaCandidateWithdraw({
  candidateId,
  status,
  publishedCommentId,
  approvedBy,
  approvedAt,
}: {
  candidateId: string
  status: CandidateStatus
  publishedCommentId: string | null
  approvedBy: string | null
  approvedAt: Date | null
}) {
  const [reason, setReason] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const published = publishedCommentId !== null && publishedCommentId !== ''
  // 🔴 조건이 아니면 **아무것도 그리지 않는다**
  if (!canWithdraw(status) || published) return null

  function run(): void {
    setError(null)
    if (reason === '') {
      setError('거둬들이는 사유를 선택해 주세요.')
      return
    }
    // 🔴 확인을 묻는다 — 되돌리는 버튼이 없다
    if (!window.confirm(
      '승인을 거둬들이면 이 후보는 공개되지 않습니다. 되돌리는 버튼은 없습니다. 계속할까요?',
    )) return
    startTransition(async () => {
      const res = await withdrawPersonaCandidate(candidateId, reason)
      if (res.error !== undefined) setError(res.error)
      else setDone(res.nextStatus ?? null)
    })
  }

  if (done !== null) {
    return (
      <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700">
        승인을 거둬들였습니다 — {done}. 이 후보는 공개되지 않습니다.
      </div>
    )
  }

  const stamp = approvedBy === null && approvedAt === null
    ? null
    : `${approvedBy ?? '(모름)'} · ${approvedAt?.toISOString().slice(0, 16).replace('T', ' ') ?? '(모름)'}`

  return (
    <div className="rounded-lg border border-gray-300 bg-white px-4 py-3">
      <h3 className="mb-1 text-sm font-bold text-gray-900">승인 철회</h3>
      <p className="mb-3 text-xs leading-relaxed text-gray-600">
        승인은 했지만 아직 공개되지 않은 후보입니다 (현재 {status}).
        거둬들이면 공개 대상에서 빠집니다.
        <br />
        🔴 원래 승인 기록({stamp ?? '없음'})은 지워지지 않고 사유와 함께 남습니다.
      </p>

      <label htmlFor="withdraw-reason" className="mb-1 block text-xs font-bold text-gray-700">
        거둬들이는 사유
      </label>
      <select
        id="withdraw-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={pending}
        className="mb-3 min-h-[52px] w-full rounded-lg border border-gray-300 bg-white px-3 text-sm"
      >
        <option value="">— 선택 —</option>
        {DECLINE_REASONS.map((r) => (
          <option key={r.code} value={r.code}>
            {r.label}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="min-h-[52px] rounded-lg border border-gray-400 bg-white px-5 text-sm text-gray-700 disabled:opacity-50"
      >
        {pending ? '처리 중…' : '승인 철회'}
      </button>

      <p className="mt-2 text-xs text-gray-500">
        🔴 이미 공개된 댓글은 여기서 내릴 수 없습니다 — 그것은 삭제 경로입니다.
        <br />
        철회 가능 상태: {WITHDRAWABLE_STATUSES.join(' · ')}
      </p>

      {error !== null && (
        <p className="mt-2 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}
    </div>
  )
}
