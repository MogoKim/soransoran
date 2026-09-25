'use client'

import { useState, useTransition } from 'react'
import { submitEvidenceBatch, type EvidenceBatchState } from '@/lib/actions/auto-ready-evidence'
import { DECLINE_REASONS } from '@/lib/original-post-decision'

/**
 * 자동 READY 증거 — 배치 검토 화면
 *
 * 🔴 글마다 따로 묻지 않는다. 로컬에서 만든 `bundle.json` 하나를 올리면 모든 행이 한 화면에 나오고,
 *    한 번에 제출한다.
 * 🔴 검토자·검토 시각을 고르는 칸이 **없다** — 서버가 로그인 세션과 서버 시계로 정한다.
 * 🔴 결정 전 그림자는 그대로(ready) · 폐기(reject)만 여기서 정한다. **이 화면은 수정(edit)을 받지 않는다.**
 *    고쳐야 하는 글은 게이트가 있는 기존 명령으로 먼저 저장해야 하고, 그 전까지는 표본이 아니다.
 * 🔴 중대 결함을 비운 행은 **건너뛴다(기록 0)**. 사람 기록은 있음·없음을 고른 행만 남는다.
 * 🔴 같은 사람이 다시 판정하면 새 기록이 쌓인다(이전 기록은 이력으로 남는다).
 */

type Item = {
  group: 'decided' | 'undecidedShadow'
  queueId: string
  decision: { status: string; outcome: string | null }
  source: { title: string; body: string } | null
  artifactSource?: { rawTitle: string; rawBody: string } | null
  draft: { title: string; body: string }
  edit: { after: { title: string | null; body: string | null } } | null
  persona: { code: string; identity: unknown } | null
  semantic: { stored: unknown; restoredFromArtifact: unknown }
  holds: unknown[]
  blocks: unknown[]
  restore: { klass: string }
}

type Entry = { decision: '' | 'ready' | 'reject'; declineReason: string; hardDefect: '' | 'no' | 'yes'; reasons: string }

const EMPTY: Entry = { decision: '', declineReason: '', hardDefect: '', reasons: '' }

export default function EvidenceBatchReview() {
  const [bundleText, setBundleText] = useState<string | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [entries, setEntries] = useState<Record<string, Entry>>({})
  const [state, setState] = useState<EvidenceBatchState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function onFile(file: File | undefined) {
    setError(null); setState(null)
    if (file === undefined) return
    const text = await file.text()
    try {
      const j = JSON.parse(text) as { items?: Item[] }
      if (!Array.isArray(j.items) || j.items.length === 0) { setError('묶음에 행이 없습니다.'); return }
      setBundleText(text)
      setItems(j.items)
      setEntries(Object.fromEntries(j.items.map((i) => [i.queueId, EMPTY])))
    } catch { setError('bundle.json 을 읽지 못했습니다.') }
  }

  const set = (id: string, patch: Partial<Entry>) => setEntries((e) => ({ ...e, [id]: { ...(e[id] ?? EMPTY), ...patch } }))

  function submit() {
    if (bundleText === null) return
    const list = items.map((i) => {
      const e = entries[i.queueId] ?? EMPTY
      return {
        queueId: i.queueId,
        decision: e.decision === '' ? null : e.decision,
        declineReason: e.declineReason === '' ? null : e.declineReason,
        hardDefect: e.hardDefect === '' ? null : e.hardDefect,
        reasons: e.reasons.split('\n').map((s) => s.trim()).filter(Boolean),
      }
    })
    if (!window.confirm(`${list.length}건을 한 번에 기록합니다. 결정 전 행의 ready · 폐기는 되돌리는 버튼이 없습니다. 계속할까요?`)) return
    startTransition(async () => {
      const res = await submitEvidenceBatch({ bundleText, entries: list })
      if (res.error !== undefined) setError(res.error)
      else setState(res)
    })
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-content-primary">
        <label htmlFor="bundle-file" className="mb-2 block font-bold">검토 묶음 (bundle.json)</label>
        <input id="bundle-file" type="file" accept="application/json" disabled={pending}
          onChange={(e) => { void onFile(e.target.files?.[0]) }} className="block w-full text-sm" />
        <p className="mt-2 text-content-muted">
          검토자와 시각은 로그인한 계정과 서버 시계로 기록됩니다. 중대 결함을 고르지 않은 행은 건너뜁니다(기록하지 않음).
          고쳐야 하는 글은 이 화면에서 처리하지 않습니다 — 기존 수정 명령으로 먼저 저장해 주세요.
        </p>
      </div>

      {error !== null && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>}

      {items.map((i) => {
        const e = entries[i.queueId] ?? EMPTY
        const shadow = i.group === 'undecidedShadow'
        return (
          <section key={i.queueId} className="rounded-lg border border-gray-200 px-4 py-3 text-sm">
            <header className="mb-2 flex flex-wrap items-center gap-2">
              <span className="font-bold">{shadow ? '결정 전' : '결정됨'}</span>
              <span className="text-content-muted">{i.queueId}</span>
              <span className="text-content-muted">상태 {i.decision.status}{i.decision.outcome !== null ? ` · 결과 ${i.decision.outcome}` : ''}</span>
              <span className="text-content-muted">복원 {i.restore.klass}</span>
            </header>
            <details className="mb-2">
              <summary className="cursor-pointer">원문 근거 · Persona · 의미 검수</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words text-xs">{JSON.stringify({
                source: i.artifactSource ?? i.source, persona: i.persona, semantic: i.semantic, holds: i.holds, blocks: i.blocks,
              }, null, 2)}</pre>
            </details>
            <div className="mb-2">
              <div className="font-bold">초안 — {i.draft.title}</div>
              <p className="whitespace-pre-wrap break-words">{i.draft.body}</p>
            </div>
            {i.edit !== null && (
              <div className="mb-2 rounded bg-amber-50 px-3 py-2">
                <div className="font-bold">수정본 — {i.edit.after.title ?? i.draft.title}</div>
                <p className="whitespace-pre-wrap break-words">{i.edit.after.body ?? i.draft.body}</p>
              </div>
            )}
            <div className="flex flex-wrap items-end gap-3">
              {shadow && (
                <>
                  <label className="flex flex-col">
                    <span className="text-xs font-bold">결정</span>
                    <select value={e.decision} disabled={pending} onChange={(ev) => set(i.queueId, { decision: ev.target.value as Entry['decision'] })}
                      className="min-h-[52px] rounded border px-2">
                      <option value="">정하지 않음 (고쳐야 하면 여기서 처리 안 함)</option>
                      <option value="ready">그대로 내보내도 된다</option>
                      <option value="reject">폐기</option>
                    </select>
                  </label>
                  {e.decision === 'reject' && (
                    <label className="flex flex-col">
                      <span className="text-xs font-bold">폐기 사유</span>
                      <select value={e.declineReason} disabled={pending} onChange={(ev) => set(i.queueId, { declineReason: ev.target.value })}
                        className="min-h-[52px] rounded border px-2">
                        <option value="">선택</option>
                        {DECLINE_REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                      </select>
                    </label>
                  )}
                </>
              )}
              <label className="flex flex-col">
                <span className="text-xs font-bold">중대 결함</span>
                <select value={e.hardDefect} disabled={pending} onChange={(ev) => set(i.queueId, { hardDefect: ev.target.value as Entry['hardDefect'] })}
                  className="min-h-[52px] rounded border px-2">
                  <option value="">건너뜀 (기록하지 않음)</option>
                  <option value="no">없음</option>
                  <option value="yes">있음</option>
                </select>
              </label>
              <label className="flex min-w-[240px] flex-1 flex-col">
                <span className="text-xs font-bold">근거 (있음이면 필수 · 줄마다 하나)</span>
                <textarea value={e.reasons} disabled={pending} rows={2} onChange={(ev) => set(i.queueId, { reasons: ev.target.value })}
                  className="rounded border px-2 py-1" />
              </label>
            </div>
          </section>
        )
      })}

      {items.length > 0 && (
        <button type="button" onClick={submit} disabled={pending}
          className="min-h-[52px] w-full rounded-lg bg-cta px-4 font-bold text-white disabled:opacity-50">
          {pending ? '기록 중…' : `${items.length}건 한 번에 기록`}
        </button>
      )}

      {state?.results !== undefined && (
        <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm">
          <div className="mb-2 font-bold">기록 결과 — 검토자 {state.reviewer}</div>
          <ul className="space-y-1">
            {state.results.map((r) => <li key={r.queueId}>{r.queueId} · {r.result}{r.why !== '' ? ` — ${r.why}` : ''}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}
