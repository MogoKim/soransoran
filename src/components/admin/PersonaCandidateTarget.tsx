'use client'

import { useState, useTransition } from 'react'
import {
  searchTargetPosts, setPersonaCandidateTarget, clearPersonaCandidateTarget,
  type TargetPostOption,
} from '@/lib/actions/persona-target'
import { canSetTarget } from '@/lib/persona-target-rules'
import type { CandidateStatus } from '@/lib/persona-candidate-rules'
import { adminButtonClass } from '@/components/admin/AdminButton'

/**
 * 발행 대상 글 선택 — 🔴 발행이 아니다
 *
 * 🔴 부적격 글도 사유와 함께 보여준다. 목록에서 조용히 빼면
 *    운영자는 "왜 이 글이 안 보이지" 를 알 수 없다. 대신 고를 수는 없게 한다.
 *
 * 🔴 글 본문을 그리지 않는다. 제목 · 게시판 · 작성일 · 댓글 수까지다.
 *
 * 🔴 confirm 을 묻지 않는다. 지정은 되돌리기 쉬운 방향이고(해제 버튼이 있다),
 *    묻는 것을 남발하면 정작 발행 버튼의 confirm 이 가벼워진다.
 */
export default function PersonaCandidateTarget({
  candidateId,
  status,
  targetPostId,
  publishedCommentId,
}: {
  candidateId: string
  status: CandidateStatus
  targetPostId: string | null
  publishedCommentId: string | null
}) {
  const [current, setCurrent] = useState<string | null>(targetPostId)
  const [query, setQuery] = useState('')
  const [posts, setPosts] = useState<TargetPostOption[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [blocks, setBlocks] = useState<Array<{ code: string; message: string }>>([])
  const [pending, startTransition] = useTransition()

  const editable = canSetTarget(status) && publishedCommentId === null

  function runSearch() {
    setError(null)
    setBlocks([])
    startTransition(async () => {
      const res = await searchTargetPosts(query)
      if (res.error !== undefined) setError(res.error)
      else setPosts(res.posts ?? [])
    })
  }

  function runSet(postId: string, expectedBoardType: string) {
    setError(null)
    setBlocks([])
    startTransition(async () => {
      const res = await setPersonaCandidateTarget(candidateId, postId, expectedBoardType)
      if (res.error !== undefined) setError(res.error)
      else if (res.blocks !== undefined) setBlocks(res.blocks)
      else {
        setCurrent(res.targetPostId ?? null)
        setPosts(null)
      }
    })
  }

  function runClear() {
    setError(null)
    setBlocks([])
    startTransition(async () => {
      const res = await clearPersonaCandidateTarget(candidateId)
      if (res.error !== undefined) setError(res.error)
      else if (res.blocks !== undefined) setBlocks(res.blocks)
      else setCurrent(null)
    })
  }

  return (
    <div className="mt-3 rounded-md border border-subtle bg-surface-card p-4 lg:p-6">
      <h3 className="text-sm font-bold text-content-secondary">발행 대상 글</h3>

      <p className="mt-1 text-xs leading-relaxed text-content-muted">
        어느 글에 댓글을 달지 정합니다. 🔴 정한다고 발행되지 않습니다.
      </p>

      <p className="mt-2 text-sm">
        현재:{' '}
        {current === null ? (
          <span className="text-content-muted">지정 안 됨 — 이 상태로는 발행이 막힙니다</span>
        ) : (
          <span className="font-mono text-xs">{current}</span>
        )}
      </p>

      {!editable ? (
        <p className="mt-2 text-sm text-content-secondary">
          {publishedCommentId !== null
            ? '이미 발행된 후보입니다 — 대상 글을 바꿀 수 없습니다.'
            : `대기(PENDING) · 승인(APPROVED) 상태만 지정할 수 있습니다. 현재 ${status}.`}
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="제목으로 찾기 (비우면 최신순)"
              disabled={pending}
              className="min-h-[52px] flex-1 rounded-md border border-interactive bg-surface-card px-3 text-sm lg:min-h-[44px]"
            />
            <button
              type="button"
              onClick={runSearch}
              disabled={pending}
              className={adminButtonClass('secondary')}
            >
              {pending ? '찾는 중…' : '글 찾기'}
            </button>
            {current !== null && (
              <button
                type="button"
                onClick={runClear}
                disabled={pending}
                className={adminButtonClass('secondary', 'px-4')}
              >
                지정 해제
              </button>
            )}
          </div>

          {posts !== null && (
            <div className="mt-3">
              {posts.length === 0 ? (
                <p className="text-sm text-content-muted">조건에 맞는 글이 없습니다.</p>
              ) : (
                /* 🔴 상자 안에 상자를 두지 않는다 — 후보 글은 구분선 행이다. 고를 수 없는 글은 옅은 면으로 가른다 */
                <ul className="m-0 list-none border-y border-subtle p-0">
                  {posts.map((p) => (
                    <li
                      key={p.id}
                      className={`border-b border-subtle px-3 py-3 last:border-b-0 ${
                        p.eligible ? '' : 'bg-surface-page'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-x-2 text-xs text-content-muted">
                        <span>{p.boardLabel}</span>
                        <span aria-hidden>·</span>
                        <span>{p.createdAt.slice(0, 10)}</span>
                        <span aria-hidden>·</span>
                        <span>
                          댓글 회원 {p.memberComments} · 페르소나 {p.personaComments}
                        </span>
                      </div>
                      {/* 🔴 제목까지다. 본문은 그리지 않는다 */}
                      <p className="mt-1 text-sm font-bold text-content-primary">{p.title}</p>

                      {p.eligible ? (
                        <button
                          type="button"
                          onClick={() => runSet(p.id, p.boardType)}
                          disabled={pending || p.id === current}
                          className={adminButtonClass('primary', 'mt-2 px-4')}
                        >
                          {p.id === current ? '지정됨' : '이 글로 지정'}
                        </button>
                      ) : (
                        <ul className="mt-2 list-none space-y-0.5 p-0">
                          {p.blocks.map((b) => (
                            <li key={b.code} className="text-xs text-content-primary">
                              <span className="font-mono">[{b.code}]</span> {b.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {blocks.length > 0 && (
        <ul className="mt-3 list-none space-y-1 rounded-md border border-state-warning bg-[color:var(--admin-warning-soft)] px-3 py-2 p-0">
          {blocks.map((b) => (
            <li key={b.code} className="text-xs text-content-primary">
              <span className="font-mono">[{b.code}]</span> {b.message}
            </li>
          ))}
        </ul>
      )}

      {error !== null && (
        <p className="mt-3 rounded-md border border-state-danger bg-[color:var(--admin-danger-soft)] px-3 py-2 text-xs text-state-danger">{error}</p>
      )}
    </div>
  )
}
