'use client'

import { useState, useTransition } from 'react'
import {
  searchTargetPosts, setPersonaCandidateTarget, clearPersonaCandidateTarget,
  type TargetPostOption,
} from '@/lib/actions/persona-target'
import { canSetTarget } from '@/lib/persona-target-rules'
import type { CandidateStatus } from '@/lib/persona-candidate-rules'

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

  function runSet(postId: string) {
    setError(null)
    setBlocks([])
    startTransition(async () => {
      const res = await setPersonaCandidateTarget(candidateId, postId)
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
    <div className="mt-3 rounded-lg border border-gray-300 bg-white px-4 py-3">
      <h3 className="text-sm font-bold text-gray-700">발행 대상 글</h3>

      <p className="mt-1 text-xs leading-relaxed text-gray-500">
        어느 글에 댓글을 달지 정합니다. 🔴 정한다고 발행되지 않습니다.
      </p>

      <p className="mt-2 text-sm">
        현재:{' '}
        {current === null ? (
          <span className="text-gray-500">지정 안 됨 — 이 상태로는 발행이 막힙니다</span>
        ) : (
          <span className="font-mono text-xs">{current}</span>
        )}
      </p>

      {!editable ? (
        <p className="mt-2 text-sm text-gray-600">
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
              className="min-h-[52px] flex-1 rounded-lg border border-gray-300 px-3 text-sm"
            />
            <button
              type="button"
              onClick={runSearch}
              disabled={pending}
              className="min-h-[52px] rounded-lg border border-gray-400 bg-white px-5 text-sm font-bold text-gray-700 disabled:opacity-50"
            >
              {pending ? '찾는 중…' : '글 찾기'}
            </button>
            {current !== null && (
              <button
                type="button"
                onClick={runClear}
                disabled={pending}
                className="min-h-[52px] rounded-lg border border-gray-300 bg-white px-4 text-sm text-gray-600 disabled:opacity-50"
              >
                지정 해제
              </button>
            )}
          </div>

          {posts !== null && (
            <div className="mt-3">
              {posts.length === 0 ? (
                <p className="text-sm text-gray-500">조건에 맞는 글이 없습니다.</p>
              ) : (
                <ul className="list-none space-y-2 p-0">
                  {posts.map((p) => (
                    <li
                      key={p.id}
                      className={`rounded-lg border px-3 py-2 ${
                        p.eligible ? 'border-gray-200' : 'border-gray-200 bg-gray-50'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-x-2 text-xs text-gray-500">
                        <span>{p.boardLabel}</span>
                        <span aria-hidden>·</span>
                        <span>{p.createdAt.slice(0, 10)}</span>
                        <span aria-hidden>·</span>
                        <span>
                          댓글 회원 {p.memberComments} · 페르소나 {p.personaComments}
                        </span>
                      </div>
                      {/* 🔴 제목까지다. 본문은 그리지 않는다 */}
                      <p className="mt-1 text-sm font-bold text-gray-900">{p.title}</p>

                      {p.eligible ? (
                        <button
                          type="button"
                          onClick={() => runSet(p.id)}
                          disabled={pending || p.id === current}
                          className="mt-2 min-h-[52px] rounded-lg bg-cta px-4 text-sm font-bold text-content-primary disabled:opacity-50"
                        >
                          {p.id === current ? '지정됨' : '이 글로 지정'}
                        </button>
                      ) : (
                        <ul className="mt-2 list-none space-y-0.5 p-0">
                          {p.blocks.map((b) => (
                            <li key={b.code} className="text-xs text-amber-900">
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
        <ul className="mt-3 list-none space-y-1 rounded bg-amber-50 px-3 py-2 p-0">
          {blocks.map((b) => (
            <li key={b.code} className="text-xs text-amber-900">
              <span className="font-mono">[{b.code}]</span> {b.message}
            </li>
          ))}
        </ul>
      )}

      {error !== null && (
        <p className="mt-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}
    </div>
  )
}
