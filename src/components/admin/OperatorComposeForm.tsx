'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useFormState } from 'react-dom'

import ActionButton from '@/components/ui/ActionButton'
import { createOperatorContent, type ComposeActionState } from '@/lib/actions/operator-compose'
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from '@/lib/comment-policy'
import {
  MAX_POST_CONTENT_LENGTH,
  MAX_POST_TITLE_LENGTH,
  MIN_POST_CONTENT_LENGTH,
  MIN_POST_TITLE_LENGTH,
} from '@/lib/post-policy'
import { getBoardByType } from '@/lib/board-registry'
import { OPERATOR_BOARDS } from '@/lib/operator-writer'
import type { ComposeTargetPost, WriterOption } from '@/lib/queries/operator-compose'

/**
 * 창업자 직접 작성 폼 — 글 또는 댓글 한 편.
 *
 * 🔴 **등록 직전에 작성자와 대상이 눈에 보여야 한다.** 이 화면의 사고는 딱 하나다 —
 *    *다른 사람 이름으로 올렸다*. 그래서 미리보기 칸에 "누구 이름으로 · 어디에" 를
 *    문장으로 적는다. 목록 상자만 있으면 고른 값이 무엇인지 스크롤 뒤에 묻힌다.
 *
 * 🔴 **입력을 잃지 않는다.** 서버가 막으면 `state.kept` 로 쓰던 값이 돌아오고,
 *    그것을 다시 화면에 세운다. 길게 쓴 글이 오류 한 번에 사라지는 일을 막는다.
 *
 * 🔴 **중복 등록은 `requestKey` 가 막는다.** 폼이 열릴 때 한 번 만들고, 등록에
 *    성공하면 새 키로 바꾼다. 연속 클릭·새로고침 재전송은 같은 키로 와서
 *    DB unique 제약에 걸린다 — 버튼을 잠그는 것만으로는 재전송을 막지 못한다.
 *
 * 🔴 **AI 를 부르지 않는다.** 생성·검수 버튼을 두지 않는다. 창업자가 직접 쓴다.
 */

type Mode = 'post' | 'comment'

/** 🔴 요청 1회를 가리키는 값. 내용이 아니라 **요청**을 식별한다 */
function newRequestKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function OperatorComposeForm({
  writers,
  targets,
}: {
  writers: WriterOption[]
  targets: ComposeTargetPost[]
}) {
  const [mode, setMode] = useState<Mode>('post')
  const [writerId, setWriterId] = useState(writers[0]?.id ?? '')
  const [boardType, setBoardType] = useState('MENOPAUSE')
  const [title, setTitle] = useState('')
  /**
   * 🔴 **초안을 모드마다 따로 둔다** (2026-09-17).
   *
   *    한 칸을 같이 쓰면 글을 쓰다 댓글 모드를 잠깐 열어 본 것만으로 본문이
   *    댓글 칸으로 옮겨 간다. 500자 상한에 걸려 버튼이 잠기고, 사람은
   *    "내 글이 어디 갔나" 를 먼저 묻게 된다.
   *    따로 두면 오가도 **양쪽 다 그대로 남는다.**
   */
  const [postBody, setPostBody] = useState('')
  const [commentBody, setCommentBody] = useState('')
  const [postId, setPostId] = useState(targets[0]?.id ?? '')
  const [requestKey, setRequestKey] = useState(newRequestKey)

  const content = mode === 'post' ? postBody : commentBody
  const setContent = mode === 'post' ? setPostBody : setCommentBody

  /**
   * 🔴 **액션을 바꿔 끼우지 않는다.** 진입점은 하나이고, 무엇을 쓰는지는 `mode` 값으로 보낸다.
   *
   *    옛 판은 모드에 따라 다른 액션을 `useFormState` 에 넣었다. dispatch 는 폼에 심긴
   *    server action 참조와 한 몸이라, 글 → 댓글 → **다시 글** 로 돌아가면 서버에서
   *    여전히 댓글 액션이 돌았다. 글 모드에는 `postId` 가 없으니 막히는데 그 응답은
   *    `kind='comment'` 라 화면에서 걸러져 **아무것도 보이지 않았다** —
   *    버튼을 눌러도 조용히 아무 일도 안 일어나는 상태였다(실측).
   */
  const [rawState, formAction] = useFormState<ComposeActionState, FormData>(createOperatorContent, {})

  /**
   * 🔴 **지금 모드의 결과만 보여 준다.**
   *
   *    `useFormState` 의 상태는 모드를 바꿔도 살아 있다. 그래서 글을 올린 뒤
   *    댓글 모드로 옮기면 **방금 올린 글의 "등록했습니다" 와 그 글 링크가 그대로**
   *    남아 있었다 — 댓글이 등록된 것으로 읽히는 자리다.
   *
   * 🔴 화면이 짐작하지 않는다. 서버가 `kind` 로 어느 쪽 요청이었는지 말해 준다 —
   *    짐작하면 보내고 나서 모드를 바꾼 경우에 틀린다.
   */
  const state: ComposeActionState = rawState.kind === undefined || rawState.kind === mode
    ? rawState
    : {}

  const writer = useMemo(() => writers.find((w) => w.id === writerId) ?? null, [writers, writerId])
  const target = useMemo(() => targets.find((t) => t.id === postId) ?? null, [targets, postId])

  /**
   * 🔴 **실패해도 입력이 그대로 남는다.** 제목·내용은 이 컴포넌트의 state 이고,
   *    `useFormState` 는 같은 컴포넌트를 다시 그릴 뿐이라 값이 살아 있다 —
   *    `defaultValue` 로 두었다면 서버가 막은 순간 길게 쓴 글이 사라졌을 것이다.
   *
   * 🔴 **성공한 "요청" 마다 돈다.** 의존 배열이 `state.doneKey` 인 것이 핵심이다.
   *
   *    옛 판은 `[state.ok]` 였다. 두 번째 등록에서 `true` → `true` 라 **바뀐 것이 없고**,
   *    effect 가 돌지 않아 요청 키가 그대로 남았다. 그 키로 보낸 두 번째 글은
   *    중복 차단(unique)에 걸려 *"이미 등록된 글입니다"* 로 막혔다 —
   *    **한 번 열면 한 편밖에 못 쓰는 화면**이었다. 중복 차단이 틀린 것이 아니라
   *    새 요청에 새 키를 주지 못한 것이 틀렸다.
   *
   *    `doneKey` 는 그 요청의 `requestKey` 라 등록마다 다르다. 그래서 매번 돈다.
   *
   * 🔴 **비우는 것은 제목·내용뿐이다.** 작성자와 게시판은 남긴다 —
   *    같은 이름으로 연달아 쓰는 것이 이 화면의 보통 쓰임이고,
   *    매번 다시 고르게 하면 엉뚱한 이름으로 올릴 위험이 오히려 는다.
   */
  useEffect(() => {
    if (rawState.doneKey === undefined) return
    // 🔴 끝난 쪽의 초안만 비운다 — 다른 모드에 써 두고 온 글을 지우지 않는다
    if (rawState.kind === 'comment') setCommentBody('')
    else { setTitle(''); setPostBody('') }
    setRequestKey(newRequestKey())
  }, [rawState.doneKey, rawState.kind])

  if (writers.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-subtle p-4">
        <p className="m-0 text-sm text-content-primary">아직 운영용 작성자가 없습니다.</p>
        <p className="mt-1 text-sm text-content-muted">
          쓸 닉네임을 정하고 <code>OperatorWriter</code> 에 등록한 뒤에 이 화면을 씁니다.
          🔴 자동 페르소나(P01~)는 여기에 오지 않습니다.
        </p>
      </div>
    )
  }

  const contentTooLong =
    mode === 'post' ? content.length > MAX_POST_CONTENT_LENGTH : content.length > MAX_COMMENT_LENGTH
  /**
   * 🔴 화면의 잠금 조건은 **서버와 같은 상수**를 본다. 여기 숫자를 적으면
   *    "버튼은 열렸는데 서버가 막는" 상태가 생긴다 — `postSubmitBlock` 과 같은 계약이다.
   */
  const canSubmit =
    writerId !== '' &&
    content.trim().length >= (mode === 'post' ? MIN_POST_CONTENT_LENGTH : MIN_COMMENT_LENGTH) &&
    !contentTooLong &&
    (mode === 'post' ? title.trim().length >= MIN_POST_TITLE_LENGTH : postId !== '')

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-4">
      {/* 🔴 무엇을 쓰는지는 값으로 보낸다 — 액션을 바꿔 끼우지 않는다 */}
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="requestKey" value={requestKey} />
      <input type="hidden" name="writerId" value={writerId} />
      {mode === 'post' ? <input type="hidden" name="boardType" value={boardType} /> : null}
      {mode === 'comment' ? <input type="hidden" name="postId" value={postId} /> : null}

      {/* ── 무엇을 쓰는가 ── */}
      <div
        role="radiogroup"
        aria-label="무엇을 쓸까요"
        className="flex flex-wrap gap-2"
      >
        {(['post', 'comment'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={`inline-flex min-h-[52px] items-center rounded-lg border px-4 font-bold transition ${
              mode === m
                ? 'border-cta bg-surface-soft text-content-primary'
                : 'border-subtle text-content-muted'
            }`}
          >
            {m === 'post' ? '글 쓰기' : '댓글 달기'}
          </button>
        ))}
      </div>

      {/* ── 누구 이름으로 ── */}
      <label className="flex flex-col gap-1">
        <span className="text-sm font-bold text-content-primary">누구 이름으로 쓸까요</span>
        <select
          value={writerId}
          onChange={(e) => setWriterId(e.target.value)}
          className="min-h-[52px] rounded-lg border border-subtle bg-surface-card px-3 text-content-primary"
        >
          {writers.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.code})
            </option>
          ))}
        </select>
        {writer?.note ? <span className="text-xs text-content-muted">{writer.note}</span> : null}
      </label>

      {mode === 'post' ? (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-bold text-content-primary">어느 게시판에</span>
            <select
              value={boardType}
              onChange={(e) => setBoardType(e.target.value)}
              className="min-h-[52px] rounded-lg border border-subtle bg-surface-card px-3 text-content-primary"
            >
              {OPERATOR_BOARDS.map((b) => (
                <option key={b} value={b}>
                  {getBoardByType(b)?.label ?? b}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-bold text-content-primary">제목</span>
            <input
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={MAX_POST_TITLE_LENGTH}
              className="min-h-[52px] rounded-lg border border-subtle bg-surface-card px-3 text-content-primary"
            />
          </label>
        </>
      ) : (
        <label className="flex flex-col gap-1">
          <span className="text-sm font-bold text-content-primary">어느 글에 달까요</span>
          <select
            value={postId}
            onChange={(e) => setPostId(e.target.value)}
            className="min-h-[52px] rounded-lg border border-subtle bg-surface-card px-3 text-content-primary"
          >
            {targets.length === 0 ? <option value="">댓글을 달 글이 없습니다</option> : null}
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                [{t.boardLabel}] {t.title} · 댓글 {t.commentCount}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-sm font-bold text-content-primary">
          {mode === 'post' ? '내용' : '댓글'}
        </span>
        <textarea
          name="content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={mode === 'post' ? 12 : 4}
          maxLength={mode === 'post' ? MAX_POST_CONTENT_LENGTH : MAX_COMMENT_LENGTH}
          className="w-full rounded-lg border border-subtle bg-surface-card p-3 text-content-primary"
        />
        <span className="text-xs text-content-muted">
          {content.length} / {mode === 'post' ? MAX_POST_CONTENT_LENGTH : MAX_COMMENT_LENGTH}자
        </span>
      </label>

      {/* ── 🔴 등록 직전 확인 — 이 화면의 안전장치 ── */}
      <div className="rounded-lg border border-subtle bg-surface-soft p-3">
        <p className="m-0 text-xs font-bold uppercase tracking-wide text-content-muted">
          이대로 올라갑니다
        </p>
        <p className="mt-1 break-words text-sm text-content-primary">
          <strong>{writer?.name ?? '—'}</strong> 이름으로{' '}
          {mode === 'post' ? (
            <>
              {/* 🔴 게시판 이름은 registry 가 정한다 — 화면에 문자열로 적지 않는다 */}
              <strong>{getBoardByType(boardType as 'MENOPAUSE' | 'FREE')?.label ?? boardType}</strong>에 글을 올립니다.
            </>
          ) : (
            <>
              <strong>{target ? target.title : '—'}</strong> 글에 댓글을 답니다.
            </>
          )}
        </p>
        {mode === 'post' && title.trim() !== '' ? (
          <p className="mt-1 break-words text-sm text-content-muted">제목: {title}</p>
        ) : null}
        <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-surface-card p-2 text-sm text-content-primary">
          {content.trim() === '' ? '(내용이 비어 있습니다)' : content}
        </p>
      </div>

      {state.error ? <p className="m-0 text-sm text-state-danger">{state.error}</p> : null}
      {state.ok ? (
        <p className="m-0 text-sm text-state-success">
          등록했습니다.{' '}
          {state.href ? (
            <Link href={state.href} className="text-link">
              올라간 자리 보기
            </Link>
          ) : null}
        </p>
      ) : null}

      <ActionButton
        tone="primary"
        size="compact"
        label={mode === 'post' ? '글 등록' : '댓글 등록'}
        pendingLabel="등록 중…"
        disabled={!canSubmit}
        className="justify-center px-4"
      />
    </form>
  )
}
