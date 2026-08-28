'use client'

import { useEffect, useRef, useState } from 'react'
import { useFormState } from 'react-dom'
import ActionButton from '@/components/ui/ActionButton'
import { useAutoResize } from '@/lib/use-auto-resize'
import { createPost, type ActionState } from '@/lib/actions/posts'
import { COMMUNITY_BOARDS } from '@/lib/board-registry'
import {
  MAX_POST_CONTENT_LENGTH,
  MAX_POST_TITLE_LENGTH,
  MIN_POST_CONTENT_LENGTH,
  MIN_POST_TITLE_LENGTH,
  POST_CONTENT_COUNTER_FROM,
  POST_CONTENT_COUNTER_WARN_FROM,
  POST_CONTENT_PLACEHOLDER,
  POST_TEXTAREA_MAX_HEIGHT,
  POST_TITLE_PLACEHOLDER,
} from '@/lib/post-policy'
import { readDraft, removeDraft, saveDraft, type PostDraft } from '@/lib/write-draft'
import OnboardingNotice from '@/components/features/onboarding/onboarding-notice'

const DRAFT_SAVE_DELAY_MS = 1000

function resolveBoardSlug(slug: string | undefined): string {
  const found = COMMUNITY_BOARDS.find((b) => b.slug === slug)
  return found ? found.slug : COMMUNITY_BOARDS[0].slug
}

export default function PostForm({ defaultBoardSlug }: { defaultBoardSlug?: string }) {
  const [state, formAction] = useFormState<ActionState, FormData>(createPost, {})
  const [boardSlug, setBoardSlug] = useState(() => resolveBoardSlug(defaultBoardSlug))
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [restored, setRestored] = useState(false)

  // 이벤트 핸들러가 재등록 없이 최신 입력을 읽게 한다.
  const draftRef = useRef<PostDraft>({ boardSlug, title, content })
  draftRef.current = { boardSlug, title, content }
  const contentRef = useRef<HTMLTextAreaElement>(null)

  function applyDraft(draft: PostDraft) {
    setTitle(draft.title.slice(0, MAX_POST_TITLE_LENGTH))
    setContent(draft.content.slice(0, MAX_POST_CONTENT_LENGTH))
    setRestored(true)
  }

  useEffect(() => {
    const draft = readDraft(resolveBoardSlug(defaultBoardSlug))
    if (draft) applyDraft(draft)
    // 마운트 시 한 번만 복원한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useAutoResize(contentRef, content, POST_TEXTAREA_MAX_HEIGHT)

  useEffect(() => {
    const timer = setTimeout(() => {
      saveDraft(draftRef.current, Date.now())
    }, DRAFT_SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [boardSlug, title, content])

  useEffect(() => {
    const save = () => {
      saveDraft(draftRef.current, Date.now())
    }
    const onHidden = () => {
      if (document.visibilityState === 'hidden') save()
    }
    window.addEventListener('beforeunload', save)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('beforeunload', save)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [])

  // 제출 직전에 지우므로, 서버가 막아 세우면 바로 되살린다.
  useEffect(() => {
    if (state.error) saveDraft(draftRef.current, Date.now())
  }, [state])

  function handleBoardChange(nextSlug: string) {
    saveDraft(draftRef.current, Date.now())
    setBoardSlug(nextSlug)
    const draft = readDraft(nextSlug)
    if (draft) applyDraft(draft)
    else setRestored(false)
  }

  function handleReset() {
    removeDraft(boardSlug)
    setTitle('')
    setContent('')
    setRestored(false)
  }

  const canSubmit =
    title.trim().length >= MIN_POST_TITLE_LENGTH &&
    content.trim().length >= MIN_POST_CONTENT_LENGTH

  return (
    <form
      action={(formData) => {
        removeDraft(boardSlug)
        formAction(formData)
      }}
      className="flex flex-col gap-4"
    >
      {state.error ? (
        state.needsOnboarding ? (
          <OnboardingNotice message={state.error} callbackUrl={`/write?board=${boardSlug}`} />
        ) : (
          <p role="alert" className="text-sm text-state-danger">
            {state.error}
          </p>
        )
      ) : null}

      {restored ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" className="text-sm text-content-muted">
            쓰다 만 글을 불러왔어요.
          </p>
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex min-h-[52px] items-center px-2 text-sm text-content-muted underline"
          >
            새로 쓰기
          </button>
        </div>
      ) : null}

      <label className="flex flex-col gap-1">
        <span className="text-sm font-bold text-content-primary">게시판</span>
        <select
          name="boardSlug"
          value={boardSlug}
          onChange={(e) => handleBoardChange(e.target.value)}
          className="min-h-[52px] rounded-lg border border-subtle bg-surface-card px-3"
        >
          {COMMUNITY_BOARDS.map((b) => (
            <option key={b.slug} value={b.slug}>
              {b.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-bold text-content-primary">제목</span>
        <input
          name="title"
          type="text"
          maxLength={MAX_POST_TITLE_LENGTH}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="min-h-[52px] rounded-lg border border-subtle bg-surface-card px-3"
          placeholder={POST_TITLE_PLACEHOLDER}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-bold text-content-primary">내용</span>
        <textarea
          ref={contentRef}
          name="content"
          rows={5}
          maxLength={MAX_POST_CONTENT_LENGTH}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="min-h-[140px] resize-none overflow-y-auto rounded-lg border border-subtle bg-surface-card p-3"
          placeholder={POST_CONTENT_PLACEHOLDER}
        />
      </label>

      {content.length >= POST_CONTENT_COUNTER_FROM ? (
        <p
          className={`-mt-2 self-end text-xs ${
            content.length >= POST_CONTENT_COUNTER_WARN_FROM
              ? 'text-state-warning'
              : 'text-content-muted'
          }`}
        >
          {content.length}/{MAX_POST_CONTENT_LENGTH}
        </p>
      ) : null}

      <ActionButton
        tone="primary"
        label="올리기"
        pendingLabel="올리는 중…"
        disabled={!canSubmit}
        className="justify-center px-6"
      />
    </form>
  )
}
