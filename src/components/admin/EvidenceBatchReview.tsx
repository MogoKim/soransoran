'use client'

import { useMemo, useRef, useState } from 'react'
import {
  readEvidenceBatchState, submitEvidenceBatch, type EvidenceBatchState,
} from '@/lib/actions/auto-ready-evidence'
import {
  EMPTY_ENTRY, planBatch, canSubmit, editableOf, rowIssue, isOpenApproved, toneOf, resultLabel, lockAfter,
  canReview, reviewingAfter, describeSend, phaseLabel, type Entry, type EvidenceRowState, type BatchPlan, type RowResult,
} from '@/lib/auto-ready-evidence-batch-plan'
import { DECLINE_REASONS } from '@/lib/original-post-decision'

/**
 * 자동 READY 증거 — 배치 검토 화면
 *
 * 🔴 글마다 따로 묻지 않는다. 로컬에서 만든 `bundle.json` 하나를 올리면 모든 행이 한 화면에 나온다.
 * 🔴 검토자·검토 시각을 고르는 칸이 **없다** — 서버가 로그인 세션과 서버 시계로 정한다.
 * 🔴 결정 전 그림자는 그대로(ready) · 폐기(reject)만 여기서 정한다. **이 화면은 수정(edit)을 받지 않는다.**
 *
 * 🔴 **2026-09-27 운영 P0 — 제출 뒤 성공 여부를 알 수 없어 운영자가 여러 번 눌렀다.** 그래서:
 *    · 묶음을 올리면 먼저 **서버의 지금 상태**를 읽는다. 그 값이 오기 전에는 입력 칸이 없다(fail-closed).
 *      이미 결정된 행에는 ready · reject 칸이 **다시 나오지 않는다**. 이 사람이 이미 기록한 행은 잠긴다.
 *    · 보내는 행은 **손댄 행뿐**이다(`planBatch`). 손대지 않은 행은 서버로 가지 않는다.
 *    · 결정은 골랐는데 중대 결함을 비운 행 등은 **보내기 전에 막는다** — 막힌 행이 있으면 CTA 가 닫힌다.
 *    · 브라우저 기본 확인창을 쓰지 않는다. 화면 안 **확인 단계**(무엇을 기록하는지 목록 + 두 번째 버튼)다.
 *    · 보내는 중에는 버튼이 닫히고(ref 잠금 — 같은 틱의 두 번째 클릭도 막는다), 끝나면 서버가 **다시 읽은**
 *      상태로 행을 그린다. 성공한 행은 즉시 잠긴다. 결과는 행마다 성공 · 건너뜀 · 거절로 보인다.
 * 🔴 **재검토**(2026-09-27 P0 정정) — 내 기록이 있는 행은 기본으로 잠기고 `재검토` 버튼만 있다.
 *    누르면 중대 결함 · 근거 칸만 열린다(결정 칸은 없다). 같은 판정이면 서버가 unchanged, 다르면 새 기록을
 *    덧붙인다. 미발행 승인 글을 결함 있음으로 바꾸면 철회 · 사유 · 근거 셋이 다 있어야 보낸다. 성공하면 다시 잠긴다.
 */

type Item = {
  group: 'cohortWindow' | 'decided' | 'undecidedShadow'
  queueId: string
  /** 🔴 지금 품질 계약 창의 자리 — 첫 차단 행부터 봐야 자동 READY 판정이 진행된다 */
  cohort?: { index: number; firstBlocking: boolean; contractVersion: string } | null
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

type Step = 'edit' | 'confirm'

const TONE_CLASS = { 성공: 'text-state-success', 건너뜀: 'text-content-muted', 거절: 'text-state-danger' } as const

export default function EvidenceBatchReview() {
  const [bundleText, setBundleText] = useState<string | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [entries, setEntries] = useState<Record<string, Entry>>({})
  const [states, setStates] = useState<ReadonlyMap<string, EvidenceRowState>>(new Map())
  const [stateLoaded, setStateLoaded] = useState(false)
  const [locked, setLocked] = useState<ReadonlySet<string>>(new Set())
  const [reviewing, setReviewing] = useState<ReadonlySet<string>>(new Set())
  const [results, setResults] = useState<ReadonlyMap<string, RowResult>>(new Map())
  const [reviewer, setReviewer] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('edit')
  const [confirmed, setConfirmed] = useState<BatchPlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'loading' | 'submitting' | null>(null)
  // 🔴 같은 틱의 두 번째 클릭 — state 는 다음 렌더에야 바뀐다. ref 로 즉시 잠근다
  const inFlight = useRef(false)

  const queueIds = useMemo(() => items.map((i) => i.queueId), [items])
  const plan = useMemo(() => planBatch(queueIds, states, entries, locked, reviewing), [queueIds, states, entries, locked, reviewing])
  const frozen = busy !== null || step === 'confirm'

  function applyState(res: EvidenceBatchState): void {
    if (res.rows !== undefined) setStates(new Map(res.rows.map((r) => [r.queueId, r])))
    if (res.reviewer !== undefined) setReviewer(res.reviewer)
  }

  async function loadState(text: string): Promise<void> {
    if (inFlight.current) return
    inFlight.current = true
    setBusy('loading')
    try {
      const res = await readEvidenceBatchState({ bundleText: text })
      if (res.error !== undefined) { setError(res.error); setStateLoaded(false); return }
      applyState(res)
      setStateLoaded(true)
    } catch {
      setError('지금 상태를 읽지 못했습니다. 다시 불러와 주세요.')
      setStateLoaded(false)
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }

  async function onFile(file: File | undefined): Promise<void> {
    setError(null); setResults(new Map()); setLocked(new Set()); setReviewing(new Set()); setStates(new Map()); setStateLoaded(false)
    setStep('edit'); setConfirmed(null)
    if (file === undefined) return
    const text = await file.text()
    let parsed: { items?: Item[] }
    try { parsed = JSON.parse(text) as { items?: Item[] } } catch { setError('bundle.json 을 읽지 못했습니다.'); return }
    if (!Array.isArray(parsed.items) || parsed.items.length === 0) { setError('묶음에 행이 없습니다.'); return }
    setBundleText(text)
    setItems(parsed.items)
    setEntries(Object.fromEntries(parsed.items.map((i) => [i.queueId, EMPTY_ENTRY])))
    await loadState(text)
  }

  const set = (id: string, patch: Partial<Entry>): void =>
    setEntries((e) => ({ ...e, [id]: { ...(e[id] ?? EMPTY_ENTRY), ...patch } }))

  /** 🔴 재검토 열기·닫기 — 열 때도 닫을 때도 입력은 비운 채로 시작한다(예전 값이 따라오지 않는다) */
  function toggleReview(id: string, open: boolean): void {
    setReviewing((prev) => { const next = new Set(prev); if (open) next.add(id); else next.delete(id); return next })
    setEntries((e) => ({ ...e, [id]: EMPTY_ENTRY }))
  }

  function openConfirm(): void {
    if (!canSubmit(plan)) return
    setConfirmed(plan)
    setStep('confirm')
  }

  async function submitConfirmed(): Promise<void> {
    // 🔴 확인 단계에서 본 목록 그대로만 보낸다 — 그 사이 입력 칸은 닫혀 있고, 이 스냅샷이 정본이다
    if (bundleText === null || confirmed === null || !canSubmit(confirmed) || inFlight.current) return
    inFlight.current = true
    setBusy('submitting')
    setError(null)
    let reload = false
    try {
      const res = await submitEvidenceBatch({ bundleText, entries: confirmed.send })
      if (res.error !== undefined) { setError(res.error); return }
      const rs = res.results ?? []
      setResults((prev) => new Map([...prev, ...rs.map((r) => [r.queueId, r] as const)]))
      setLocked((prev) => lockAfter(prev, rs))
      // 🔴 재검토가 성공한 행은 다시 잠긴다 — 최신 판정은 서버가 다시 읽은 `mine` 으로 보인다
      setReviewing((prev) => reviewingAfter(prev, rs))
      // 🔴 성공한 행의 입력은 비운다 — 다시 보낼 값이 화면에 남지 않는다
      setEntries((prev) => {
        const next = { ...prev }
        for (const r of rs) if (toneOf(r.result) === '성공') next[r.queueId] = EMPTY_ENTRY
        return next
      })
      applyState(res)
    } catch {
      setError('기록 요청이 끝나지 않았습니다. 저장됐을 수 있어 지금 상태를 다시 읽습니다.')
      reload = true
    } finally {
      setStep('edit')
      setConfirmed(null)
      inFlight.current = false
      setBusy(null)
    }
    if (reload) await loadState(bundleText)
  }

  const tally = useMemo(() => {
    const t = { 성공: 0, 건너뜀: 0, 거절: 0 }
    for (const r of results.values()) t[toneOf(r.result)] += 1
    return t
  }, [results])
  const titleOf = (id: string): string => items.find((i) => i.queueId === id)?.draft.title ?? id

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-surface-soft px-4 py-3 text-sm text-content-primary">
        <label htmlFor="bundle-file" className="mb-2 block font-bold">검토 묶음 (bundle.json)</label>
        <input id="bundle-file" type="file" accept="application/json" disabled={frozen}
          onChange={(e) => { void onFile(e.target.files?.[0]) }} className="block min-h-[52px] w-full text-sm" />
        <p className="mt-2 text-content-muted">
          검토자와 시각은 로그인한 계정과 서버 시계로 기록됩니다. 고른 행만 보냅니다 — 손대지 않은 행은 서버로 가지 않습니다.
          고쳐야 하는 글은 이 화면에서 처리하지 않습니다 — 기존 수정 명령으로 먼저 저장해 주세요.
        </p>
      </div>

      {error !== null && (
        <div role="alert" className="rounded-lg border border-subtle bg-surface-card px-4 py-3 text-sm font-bold text-state-danger">
          ⚠ {error}
        </div>
      )}

      {busy === 'loading' && <p className="text-sm text-content-muted" role="status">지금 상태를 읽는 중…</p>}

      {items.length > 0 && !stateLoaded && busy === null && bundleText !== null && (
        <button type="button" onClick={() => { void loadState(bundleText) }}
          className="min-h-[52px] w-full rounded-lg border border-interactive px-4 font-bold text-content-primary">
          지금 상태 다시 불러오기
        </button>
      )}

      {stateLoaded && items.map((i) => {
        const s = states.get(i.queueId)
        const e = entries[i.queueId] ?? EMPTY_ENTRY
        const ed = editableOf(s, locked, reviewing)
        const issue = rowIssue(s, e, locked, reviewing)
        const inReview = s !== undefined && s.phase === 'recorded' && reviewing.has(i.queueId)
        const result = results.get(i.queueId)
        const needWithdraw = ed === 'record' && s !== undefined && isOpenApproved(s) && e.hardDefect === 'yes'
        return (
          <section key={i.queueId} data-queue-id={i.queueId} data-phase={s?.phase ?? 'unknown'} data-locked={ed === null ? 'yes' : 'no'}
            className="rounded-lg border border-subtle px-4 py-3 text-sm">
            <header className="mb-2 flex flex-wrap items-center gap-2">
              <span className="font-bold">{s === undefined ? '상태 없음' : phaseLabel(s)}</span>
              <span className="text-content-muted">{i.queueId}</span>
              {s !== undefined && s.status !== null && (
                <span className="text-content-muted">
                  상태 {s.status}{s.published ? ' · 발행됨' : ''}{s.declineReason !== null ? ` · 사유 ${s.declineReason}` : ''}
                </span>
              )}
              <span className="text-content-muted">복원 {i.restore.klass}</span>
              {i.cohort != null ? (
                <span data-cohort-index={i.cohort.index} className={i.cohort.firstBlocking ? 'font-bold text-state-danger' : 'text-content-muted'}>
                  품질 계약 {i.cohort.contractVersion} · {i.cohort.index}번째{i.cohort.firstBlocking ? ' · 첫 차단 — 이 행부터 검토' : ''}
                </span>
              ) : (
                <span className="text-content-muted">옛 계약 — 열림 판정 표본 아님</span>
              )}
            </header>

            {result !== undefined && (
              <p data-result-tone={toneOf(result.result)} className={`mb-2 font-bold ${TONE_CLASS[toneOf(result.result)]}`}>
                {toneOf(result.result)} — {resultLabel(result)}
              </p>
            )}
            {s !== undefined && s.mine !== null && (
              <p className="mb-2 font-bold text-state-success">
                ✓ 내 기록 있음 — 중대 결함 {s.mine.hardDefect === 'yes' ? '있음' : s.mine.hardDefect === 'no' ? '없음' : '미측정'}
                {' · '}{new Date(s.mine.reviewedAt).toLocaleString('ko-KR')}
                {inReview ? '' : ' · 재검토를 누르지 않으면 보내지 않습니다'}
              </p>
            )}
            {canReview(s, reviewing) && (
              <button type="button" onClick={() => toggleReview(i.queueId, true)} disabled={frozen} data-cta="rereview"
                className="mb-2 min-h-[52px] rounded-lg border border-interactive px-4 font-bold text-content-primary disabled:opacity-50">
                재검토 — 중대 결함 판정 다시 하기
              </button>
            )}
            {inReview && (
              <div className="mb-2 flex flex-wrap items-center gap-2" data-review-open="">
                <span className="font-bold">재검토 중 — 결정은 바꾸지 않습니다. 중대 결함 판정만 새로 기록합니다(이전 기록은 남습니다).</span>
                <button type="button" onClick={() => toggleReview(i.queueId, false)} disabled={frozen} data-cta="rereview-cancel"
                  className="min-h-[52px] rounded-lg border border-interactive px-4 font-bold text-content-primary disabled:opacity-50">
                  재검토 취소
                </button>
              </div>
            )}
            {s !== undefined && ed === null && s.mine === null && s.why !== '' && (
              <p className="mb-2 text-content-muted">{s.why}</p>
            )}

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
              <div className="mb-2 rounded bg-surface-soft px-3 py-2">
                <div className="font-bold">수정본 — {i.edit.after.title ?? i.draft.title}</div>
                <p className="whitespace-pre-wrap break-words">{i.edit.after.body ?? i.draft.body}</p>
              </div>
            )}

            {ed !== null && (
              <div className="flex flex-wrap items-end gap-3">
                {ed === 'decide' && (
                  <>
                    <label className="flex flex-col">
                      <span className="text-xs font-bold">결정</span>
                      <select name="decision" value={e.decision} disabled={frozen} onChange={(ev) => set(i.queueId, { decision: ev.target.value as Entry['decision'] })}
                        className="min-h-[52px] rounded border px-2">
                        <option value="">정하지 않음 (보내지 않음)</option>
                        <option value="ready">그대로 내보내도 된다</option>
                        <option value="reject">폐기</option>
                      </select>
                    </label>
                    {e.decision === 'reject' && (
                      <label className="flex flex-col">
                        <span className="text-xs font-bold">폐기 사유</span>
                        <select name="declineReason" value={e.declineReason} disabled={frozen} onChange={(ev) => set(i.queueId, { declineReason: ev.target.value })}
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
                  <select name="hardDefect" value={e.hardDefect} disabled={frozen} onChange={(ev) => set(i.queueId, { hardDefect: ev.target.value as Entry['hardDefect'] })}
                    className="min-h-[52px] rounded border px-2">
                    <option value="">고르지 않음</option>
                    <option value="no">없음</option>
                    <option value="yes">있음</option>
                  </select>
                </label>
                {needWithdraw && (
                  <div className="flex flex-col rounded border border-subtle px-3 py-2">
                    <label className="flex min-h-[52px] items-center gap-2 font-bold text-state-danger">
                      <input type="checkbox" name="withdraw" checked={e.withdraw} disabled={frozen} onChange={(ev) => set(i.queueId, { withdraw: ev.target.checked })} className="h-6 w-6" />
                      ⚠ 철회 — 승인을 거둬들여 발행 대상에서 뺀다
                    </label>
                    <select name="withdrawReason" value={e.declineReason} disabled={frozen || !e.withdraw} onChange={(ev) => set(i.queueId, { declineReason: ev.target.value })}
                      className="mt-2 min-h-[52px] rounded border px-2">
                      <option value="">철회 사유 선택 (필수)</option>
                      {DECLINE_REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                    </select>
                  </div>
                )}
                <label className="flex min-w-[240px] flex-1 flex-col">
                  <span className="text-xs font-bold">근거 (있음이면 필수 · 줄마다 하나)</span>
                  <textarea name="reasons" value={e.reasons} disabled={frozen} rows={2} onChange={(ev) => set(i.queueId, { reasons: ev.target.value })}
                    className="rounded border px-2 py-1" />
                </label>
              </div>
            )}
            {issue !== null && (
              <p role="alert" data-row-issue="" className="mt-2 font-bold text-state-danger">⚠ {issue}</p>
            )}
          </section>
        )
      })}

      {stateLoaded && items.length > 0 && step === 'edit' && (
        <div className="space-y-2">
          <p className="text-sm text-content-muted" data-plan-summary="">
            보낼 행 {plan.send.length}건 · 막힌 행 {plan.blocking.length}건 · 고르지 않은 행 {plan.untouched}건(보내지 않음) · 잠긴 행 {plan.locked}건
          </p>
          <button type="button" onClick={openConfirm} disabled={!canSubmit(plan) || busy !== null} data-cta="review"
            className="min-h-[52px] w-full rounded-lg bg-cta px-4 font-bold text-cta-content disabled:opacity-50">
            {plan.blocking.length > 0
              ? `막힌 행 ${plan.blocking.length}건 — 먼저 고쳐 주세요`
              : plan.send.length === 0 ? '기록할 행을 골라 주세요' : `${plan.send.length}건 기록 내용 확인`}
          </button>
        </div>
      )}

      {step === 'confirm' && confirmed !== null && (
        <div className="space-y-3 rounded-lg border border-interactive px-4 py-3 text-sm" data-confirm-panel="">
          <div className="font-bold">아래 {confirmed.send.length}건을 기록합니다</div>
          <p className="text-content-muted">결정 전 행의 &quot;그대로&quot; · &quot;폐기&quot; 는 되돌리는 버튼이 없습니다. 목록을 확인해 주세요.</p>
          <ol className="list-decimal space-y-1 pl-5">
            {confirmed.send.map((s) => (
              <li key={s.queueId}><span className="font-bold">{titleOf(s.queueId)}</span> — {describeSend(s)}</li>
            ))}
          </ol>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={() => { setStep('edit'); setConfirmed(null) }} disabled={busy !== null} data-cta="back"
              className="min-h-[52px] flex-1 rounded-lg border border-interactive px-4 font-bold text-content-primary disabled:opacity-50">
              돌아가서 고치기
            </button>
            <button type="button" onClick={() => { void submitConfirmed() }} disabled={busy !== null} data-cta="submit"
              className="min-h-[52px] flex-1 rounded-lg bg-cta px-4 font-bold text-cta-content disabled:opacity-50">
              {busy === 'submitting' ? '기록 중… (창을 닫지 마세요)' : `${confirmed.send.length}건 기록 확정`}
            </button>
          </div>
        </div>
      )}

      {results.size > 0 && (
        <div className="rounded-lg bg-surface-soft px-4 py-3 text-sm" role="status" data-results="">
          <div className="mb-2 font-bold">
            기록 결과{reviewer !== null ? ` — 검토자 ${reviewer}` : ''} · 성공 {tally.성공} · 건너뜀 {tally.건너뜀} · 거절 {tally.거절}
          </div>
          <ul className="space-y-1">
            {[...results.values()].map((r) => (
              <li key={r.queueId} className={TONE_CLASS[toneOf(r.result)]}>
                <span className="font-bold">{toneOf(r.result)}</span> · {titleOf(r.queueId)} — {resultLabel(r)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
