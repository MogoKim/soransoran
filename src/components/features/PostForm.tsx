'use client'

import { useEffect, useRef, useState } from 'react'
import { useFormState } from 'react-dom'
import ActionButton from '@/components/ui/ActionButton'
import PostEditor from '@/components/features/PostEditor'
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
  /**
   * 🔴 글자 수는 HTML 이 아니라 글자로 센다.
   *    사진 주소 한 줄이 100 자를 넘어, HTML 길이로 재면 사진 몇 장에
   *    5000 자 상한이 차 버린다. 서버도 같은 기준으로 본다(post-html.ts).
   */
  const [text, setText] = useState('')
  const [restored, setRestored] = useState(false)

  // 이벤트 핸들러가 재등록 없이 최신 입력을 읽게 한다.
  const draftRef = useRef<PostDraft>({ boardSlug, title, content })
  draftRef.current = { boardSlug, title, content }
  /**
   * 🔴 에디터는 처음 받은 본문만 그린다(Tiptap 은 그렇게 동작한다).
   *    임시저장을 불러오거나 새로 쓸 때는 key 를 바꿔 다시 그린다 —
   *    setContent 만으로는 화면이 따라오지 않는다.
   */
  const [editorKey, setEditorKey] = useState(0)

  function applyDraft(draft: PostDraft) {
    setTitle(draft.title.slice(0, MAX_POST_TITLE_LENGTH))
    /**
     * 🔴 본문을 자르지 않는다. 임시저장된 것이 HTML 이라 글자 수로 자르면
     *    태그 한가운데가 끊겨 사진이 사라지거나 문단이 깨진 채 복원된다.
     *    길이는 서버가 글자 기준으로 다시 본다.
     */
    setContent(draft.content)
    setEditorKey((n) => n + 1)
    setRestored(true)
  }

  useEffect(() => {
    const draft = readDraft(resolveBoardSlug(defaultBoardSlug))
    if (draft) applyDraft(draft)
    // 마운트 시 한 번만 복원한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    else {
      setContent('')
      setText('')
      setEditorKey((n) => n + 1)
      setRestored(false)
    }
  }

  function handleReset() {
    removeDraft(boardSlug)
    setTitle('')
    setContent('')
    setText('')
    setEditorKey((n) => n + 1)
    setRestored(false)
  }

  // 🔴 사진만 올린 글도 보낼 수 있게 한다. 글자가 짧아도 할 말을 한 것이다.
  //    서버도 같은 규칙이다(actions/posts.ts).
  const hasImage = content.includes('<img')
  const canSubmit =
    title.trim().length >= MIN_POST_TITLE_LENGTH &&
    (hasImage || text.trim().length >= MIN_POST_CONTENT_LENGTH)

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

      <div className="flex flex-col gap-1">
        <span className="text-sm font-bold text-content-primary">내용</span>
        {/* 🔴 form 에는 hidden input 으로 낸다. Tiptap 은 name 을 가진 입력이 아니다. */}
        <input type="hidden" name="content" value={content} readOnly />
        <PostEditor
          key={editorKey}
          value={content}
          onChange={setContent}
          onTextChange={setText}
          placeholder={POST_CONTENT_PLACEHOLDER}
        />
      </div>

      {text.length >= POST_CONTENT_COUNTER_FROM ? (
        <p
          className={`-mt-2 self-end text-xs ${
            text.length >= POST_CONTENT_COUNTER_WARN_FROM
              ? 'text-state-warning'
              : 'text-content-muted'
          }`}
        >
          {text.length}/{MAX_POST_CONTENT_LENGTH}
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
