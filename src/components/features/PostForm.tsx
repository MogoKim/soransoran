'use client'

import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { createPost, type ActionState } from '@/lib/actions/posts'
import { COMMUNITY_BOARDS } from '@/lib/board-registry'
import {
  MAX_POST_CONTENT_LENGTH,
  MAX_POST_TITLE_LENGTH,
  MIN_POST_CONTENT_LENGTH,
  MIN_POST_TITLE_LENGTH,
  POST_CONTENT_PLACEHOLDER,
  POST_TITLE_PLACEHOLDER,
} from '@/lib/post-policy'

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="inline-flex min-h-[52px] items-center justify-center rounded-lg bg-cta px-6 font-bold text-cta-text disabled:opacity-60"
    >
      {pending ? '올리는 중…' : '올리기'}
    </button>
  )
}

export default function PostForm({ defaultBoardSlug }: { defaultBoardSlug?: string }) {
  const [state, formAction] = useFormState<ActionState, FormData>(createPost, {})
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')

  const canSubmit =
    title.trim().length >= MIN_POST_TITLE_LENGTH &&
    content.trim().length >= MIN_POST_CONTENT_LENGTH

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error ? (
        <p role="alert" className="text-sm text-state-danger">
          {state.error}
        </p>
      ) : null}

      <label className="flex flex-col gap-1">
        <span className="text-sm font-bold text-content-primary">게시판</span>
        <select
          name="boardSlug"
          defaultValue={defaultBoardSlug ?? COMMUNITY_BOARDS[0].slug}
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
          name="content"
          rows={10}
          maxLength={MAX_POST_CONTENT_LENGTH}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="rounded-lg border border-subtle bg-surface-card p-3"
          placeholder={POST_CONTENT_PLACEHOLDER}
        />
      </label>

      <SubmitButton disabled={!canSubmit} />
    </form>
  )
}
