'use client'

import { useEffect, useId, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { BoardType } from '@prisma/client'
import { movePostBoard, type BoardMoveActionState } from '@/lib/actions/admin'
import { MOVABLE_BOARDS, type MovableBoard } from '@/lib/board-move'
import { adminButtonClass } from '@/components/admin/AdminButton'
import { AdminNotice, adminBadgeClass } from '@/components/admin/AdminUi'
import { useToast } from '@/components/ui/toast'

/**
 * 관리자 글 상세 — 게시판 변경 패널. 본문 수정 폼과 따로 있다.
 *
 * 🔴 옮길 수 없는 글에서도 패널을 숨기지 않는다. 닫힌 채로 이유를 보인다 —
 *    숨기면 "왜 이 글은 메뉴가 없지?" 를 운영자가 추측해야 한다.
 * 🔴 브라우저 확인창(window.confirm)을 쓰지 않는다. 화면 안 확인 단계에서
 *    "어디서 어디로 · 무엇이 그대로인지" 를 읽고 두 번째 버튼을 누른다.
 * 🔴 화면 판정은 안내일 뿐이다. 서버(board-move-tx.ts)가 같은 판정을 트랜잭션 안에서 다시 한다.
 */

const KEEPS = '제목·본문·작성자·댓글·공개 상태·작성 시각은 그대로 유지됩니다.'

export default function AdminBoardMovePanel({
  postId,
  current,
  boardLabels,
  blockedReason,
}: {
  postId: string
  current: BoardType
  /** 게시판 이름 — board-registry 가 정본이라 서버에서 받는다 */
  boardLabels: Record<MovableBoard, string>
  /** 글 자체가 옮길 수 없는 이유(자동 운영 · 가입인사 · 열린 후보 · 숨김). null 이면 옮길 수 있다 */
  blockedReason: string | null
}) {
  const router = useRouter()
  const toast = useToast()
  const selectId = useId()
  const others = MOVABLE_BOARDS.filter((b) => b !== current)
  const [target, setTarget] = useState<MovableBoard | ''>(others[0] ?? '')
  const [step, setStep] = useState<'edit' | 'confirm'>('edit')
  const [result, setResult] = useState<BoardMoveActionState | null>(null)
  const [pending, startTransition] = useTransition()

  // 옮긴 뒤 router.refresh() 로 current 가 바뀐다 — 고른 값을 새 "다른 게시판" 으로 맞춘다(결과 안내는 남긴다)
  useEffect(() => {
    setTarget(MOVABLE_BOARDS.find((b) => b !== current) ?? '')
  }, [current])

  const currentLabel = (MOVABLE_BOARDS as readonly string[]).includes(current)
    ? boardLabels[current as MovableBoard]
    : current
  const locked = blockedReason !== null
  const canReview = !locked && target !== '' && target !== current && !pending

  function submit(): void {
    if (target === '' || !canReview) return
    startTransition(async () => {
      const res = await movePostBoard(postId, current, target)
      setResult(res)
      setStep('edit')
      if (res.ok) {
        toast.success(`${boardLabels[res.from]}에서 ${boardLabels[res.to]}으로 옮겼어요.`, { key: 'admin:board-move' })
        router.refresh()
      }
    })
  }

  return (
    <section aria-labelledby={`${selectId}-title`} className="mt-8 rounded-[10px] border border-subtle bg-surface-card p-4 lg:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`${selectId}-title`} className="m-0 text-lg font-bold text-content-primary">게시판 변경</h2>
        <span className={adminBadgeClass('neutral')}>지금 {currentLabel}</span>
      </div>
      <p className="mb-3 mt-1 text-sm text-content-muted">{KEEPS}</p>

      {result !== null && (
        <div role={result.ok ? 'status' : 'alert'} className="mb-3">
          {result.ok ? (
            <AdminNotice tone="info" title={`완료 — ${boardLabels[result.from]}에서 ${boardLabels[result.to]}으로 옮겼습니다.`}>
              {result.href ? (
                <>
                  <Link href={result.href} className="inline-flex min-h-[52px] items-center text-link lg:min-h-[44px]">
                    새 고객 주소 열기
                  </Link>
                  {/* 긴 주소가 좁은 화면에서 상자 밖으로 나가지 않게 아무 데서나 줄을 바꾼다 */}
                  <span className="break-all text-xs text-content-muted">{result.href}</span>
                </>
              ) : null}
            </AdminNotice>
          ) : (
            <AdminNotice tone="danger" title="옮기지 못했습니다">{result.error}</AdminNotice>
          )}
        </div>
      )}

      {locked ? (
        <div role="note" className="mb-3">
          <AdminNotice tone="warning" title="이 글은 게시판을 변경할 수 없습니다">{blockedReason}</AdminNotice>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label htmlFor={selectId} className="flex flex-col gap-1 sm:w-[240px]">
          <span className="text-sm font-bold text-content-primary">옮길 게시판</span>
          <select
            id={selectId}
            value={target}
            disabled={locked || pending || step === 'confirm'}
            onChange={(e) => { setTarget(e.target.value as MovableBoard | ''); setResult(null) }}
            className="min-h-[52px] rounded-lg border border-interactive bg-surface-card px-3 text-base disabled:bg-surface-page disabled:text-content-muted lg:min-h-[44px]"
          >
            {MOVABLE_BOARDS.map((b) => (
              <option key={b} value={b} disabled={b === current}>
                {boardLabels[b]}{b === current ? ' (지금 게시판)' : ''}
              </option>
            ))}
          </select>
        </label>
        {step === 'edit' && (
          <button type="button" onClick={() => setStep('confirm')} disabled={!canReview}
            className={adminButtonClass('primary', 'sm:w-auto')}>
            게시판 변경
          </button>
        )}
      </div>
      {!locked && target === current ? (
        <p className="mt-2 text-sm text-content-muted">지금 게시판과 다른 게시판을 골라 주세요.</p>
      ) : null}

      {step === 'confirm' && target !== '' && (
        <div className="mt-4 rounded-lg border-2 border-content-primary p-3 lg:p-4" data-board-move-confirm="">
          <p className="m-0 text-base font-bold text-content-primary">
            {currentLabel}에서 {boardLabels[target]}으로 변경합니다.
          </p>
          <p className="mb-3 mt-1 text-sm text-content-secondary">
            {KEEPS} 예전 고객 주소는 새 주소로 연결됩니다.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={submit} disabled={pending} className={adminButtonClass('primary')}>
              {pending ? '옮기는 중…' : '변경 확정'}
            </button>
            <button type="button" onClick={() => setStep('edit')} disabled={pending} className={adminButtonClass('secondary')}>
              취소
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
