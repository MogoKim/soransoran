'use client'

import { useState, useTransition } from 'react'
import { publishPersonaCandidate, takedownPersonaComment } from '@/lib/actions/persona-publish'
import { canPublish } from '@/lib/persona-publish-rules'
import type { CandidateStatus } from '@/lib/persona-candidate-rules'
import { adminButtonClass } from '@/components/admin/AdminButton'

/**
 * 후보 발행 · 내림 — 🔴 승인과 다른 버튼이다
 *
 * 🔴 발행은 되돌리기가 반쪽이다. 댓글은 내릴 수 있지만 "발행됐다" 는 사실은 남는다.
 *    그래서 confirm 을 묻는다 — 폐기 버튼과 같은 이유다.
 *
 * 🔴 자동 발행이 아니다. 사람이 눌러야 한다.
 *
 * 🔴 BLOCKED 사유를 코드와 함께 전부 보여준다.
 *    하나만 보여주면 고치고 다시 눌렀을 때 다음 사유가 나온다 — 왕복이 는다.
 */
export default function PersonaCandidatePublish({
  candidateId,
  status,
  publishedCommentId,
  targetPostId,
}: {
  candidateId: string
  status: CandidateStatus
  publishedCommentId: string | null
  targetPostId: string | null
}) {
  const [error, setError] = useState<string | null>(null)
  const [blocks, setBlocks] = useState<Array<{ code: string; message: string }>>([])
  const [done, setDone] = useState<string | null>(null)
  const [takenDown, setTakenDown] = useState(false)
  const [pending, startTransition] = useTransition()

  const publishable = canPublish(status)
  const liveCommentId = done ?? publishedCommentId

  function runPublish() {
    setError(null)
    setBlocks([])
    if (!window.confirm('고객 화면에 실제로 댓글이 올라갑니다. 계속할까요?')) return
    startTransition(async () => {
      const res = await publishPersonaCandidate(candidateId)
      if (res.error !== undefined) setError(res.error)
      else if (res.blocks !== undefined) setBlocks(res.blocks)
      else setDone(res.publishedCommentId ?? null)
    })
  }

  function runTakedown(commentId: string) {
    setError(null)
    setBlocks([])
    if (!window.confirm('이 댓글을 고객 화면에서 내립니다. 계속할까요?')) return
    startTransition(async () => {
      const res = await takedownPersonaComment(commentId)
      if (res.error !== undefined) setError(res.error)
      else if (res.blocks !== undefined) setBlocks(res.blocks)
      else setTakenDown(true)
    })
  }

  // 🔴 대상 글이 없으면 누를 수 없다 — 화면 판단은 targetPostId === null 하나뿐이다.
  //    canPublish(상태 판정)는 그대로이고, 서버 발행 검증이 최종 권한이다(이 막음은 헛걸음을 줄일 뿐).
  const noTarget = targetPostId === null

  return (
    <div className="rounded-[10px] border border-subtle bg-surface-card p-4 lg:p-6">
      {liveCommentId === null ? (
        <>
          {publishable ? (
            <>
              {noTarget && (
                <p id="publish-needs-target" className="m-0 mb-3 rounded-lg border border-state-warning bg-[color:var(--admin-warning-soft)] px-3 py-2 text-sm font-bold text-content-primary">
                  발행하려면 먼저 대상 글을 지정해야 합니다.
                </p>
              )}
              <button
                type="button"
                onClick={runPublish}
                disabled={pending || noTarget}
                aria-describedby={noTarget ? 'publish-needs-target' : undefined}
                className={adminButtonClass('primary')}
              >
                {pending ? '발행 중…' : '발행하기'}
              </button>
              <p className="mt-2 text-xs leading-relaxed text-content-secondary">
                🔴 누르면 고객 화면에 댓글이 올라갑니다.
                <br />
                페르소나가 활동 중(active)이 아니거나 전체 중지가 켜져 있으면 막힙니다.
              </p>
            </>
          ) : (
            <p className="m-0 text-sm text-content-secondary">
              승인(APPROVED) 상태만 발행할 수 있습니다. 현재 {status}.
            </p>
          )}
        </>
      ) : (
        <div>
          <p className="m-0 rounded-lg border border-state-success bg-[color:var(--admin-success-soft)] px-3 py-2 text-sm text-content-primary">
            발행됨 — 댓글 <span className="font-mono text-xs">{liveCommentId}</span>
            {takenDown && ' · 내려감'}
          </p>
          {!takenDown && (
            <>
              <button
                type="button"
                onClick={() => runTakedown(liveCommentId)}
                disabled={pending}
                className={adminButtonClass('danger', 'mt-3')}
              >
                {pending ? '내리는 중…' : '댓글 내리기'}
              </button>
              <p className="mt-2 text-xs leading-relaxed text-content-secondary">
                고객 화면에서 즉시 사라집니다. 대기열은 발행됨(PUBLISHED)으로 남습니다 —
                발행된 사실 자체는 기록으로 남깁니다.
              </p>
            </>
          )}
        </div>
      )}

      {blocks.length > 0 && (
        <ul className="mt-3 list-none space-y-1 rounded-lg border border-state-warning bg-[color:var(--admin-warning-soft)] px-3 py-2 p-0">
          {blocks.map((b) => (
            <li key={b.code} className="text-xs text-content-primary">
              <span className="font-mono">[{b.code}]</span> {b.message}
            </li>
          ))}
        </ul>
      )}

      {error !== null && (
        <p className="mt-3 rounded-lg border border-state-danger bg-[color:var(--admin-danger-soft)] px-3 py-2 text-xs text-state-danger">{error}</p>
      )}
    </div>
  )
}
