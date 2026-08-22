'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { createPost, type ActionState } from '@/lib/actions/posts'
import { COMMUNITY_BOARDS } from '@/lib/board-registry'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-[52px] items-center justify-center rounded-lg bg-cta px-6 font-bold text-cta-text disabled:opacity-60"
    >
      {pending ? '올리는 중…' : '올리기'}
    </button>
  )
}

export default function PostForm({ defaultBoardSlug }: { defaultBoardSlug?: string }) {
  const [state, formAction] = useFormState<ActionState, FormData>(createPost, {})

  return (
    <form action={formAction} className="flex flex-col gap-4">
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
          maxLength={120}
          className="min-h-[52px] rounded-lg border border-subtle bg-surface-card px-3"
          placeholder="어떤 이야기인가요?"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-bold text-content-primary">내용</span>
        <textarea
          name="content"
          rows={10}
          className="rounded-lg border border-subtle bg-surface-card p-3"
          placeholder="짧게 써도 괜찮습니다."
        />
      </label>

      {state.error ? (
        <p role="alert" className="text-sm text-state-danger">
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  )
}
