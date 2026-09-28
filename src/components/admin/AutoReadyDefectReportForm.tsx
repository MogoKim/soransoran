'use client'

import { useRef, useState } from 'react'
import { reportAutoReadyDefect, type DefectReportState } from '@/lib/actions/auto-ready-defect-report'

/**
 * 자동 READY 결함 신고 폼 — 글 하나
 *
 * 🔴 보내는 칸은 글 id 와 근거뿐이다. 신고자·시각 칸이 **없다** — 서버가 정한다.
 * 🔴 되돌릴 수 없는 기록이라(자동 발행이 멈춘다) 화면 안 확인 단계를 둔다 — 브라우저 확인창을 쓰지 않는다.
 *    danger 는 채운 버튼이 아니라 외곽선 + 문구 + 확인 단계다.
 * 🔴 보내는 중에는 다시 누를 수 없다(ref 잠금 — 같은 틱의 두 번째 클릭도 막는다).
 */
export default function AutoReadyDefectReportForm({ postId }: { postId: string }) {
  const [reasons, setReasons] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<DefectReportState | null>(null)
  const sending = useRef(false)
  const lines = reasons.split('\n').map((x) => x.trim()).filter((x) => x !== '')

  async function send(): Promise<void> {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    try {
      setState(await reportAutoReadyDefect({ postId, reasons: lines }))
    } catch {
      setState({ error: '보내지 못했습니다. 다시 시도해 주세요.' })
    } finally {
      sending.current = false
      setBusy(false)
      setConfirming(false)
    }
  }

  const done = state?.result?.result === 'recorded' || state?.result?.result === 'alreadyDefect'
  if (done) {
    return (
      <p role="status" className="font-bold text-state-danger">
        결함으로 기록했습니다 — 자동 발행이 멈췄습니다.
      </p>
    )
  }
  return (
    <div className="space-y-2">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold text-content-primary">결함 근거 (한 줄에 하나)</span>
        <textarea value={reasons} onChange={(e) => { setReasons(e.target.value); setConfirming(false) }}
          rows={3} className="min-h-[52px] w-full rounded border border-subtle px-2 py-1" />
      </label>
      {state?.error !== undefined && <p role="alert" className="font-bold text-state-danger">{state.error}</p>}
      {state?.result?.result === 'reject' && <p role="alert" className="font-bold text-state-danger">{state.result.why}</p>}
      {!confirming ? (
        <button type="button" disabled={lines.length === 0 || busy} onClick={() => { setConfirming(true) }}
          className="min-h-[52px] rounded-lg border border-state-danger px-4 font-bold text-state-danger disabled:opacity-50">
          결함 신고
        </button>
      ) : (
        <div className="rounded-lg border border-state-danger px-3 py-2" data-confirm="">
          <p className="mb-2 font-bold text-content-primary">
            이 글을 중대 결함으로 기록합니다. 기록하면 자동 발행이 즉시 멈추고, 되돌릴 수 없습니다.
          </p>
          <ul className="mb-2 list-disc pl-5 text-content-primary">
            {lines.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => { void send() }}
              className="min-h-[52px] rounded-lg border border-state-danger px-4 font-bold text-state-danger disabled:opacity-50">
              {busy ? '기록하는 중…' : '결함으로 기록'}
            </button>
            <button type="button" disabled={busy} onClick={() => { setConfirming(false) }}
              className="min-h-[52px] rounded-lg border border-interactive px-4 font-bold text-content-primary disabled:opacity-50">
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
