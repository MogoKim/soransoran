'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useFormState } from 'react-dom'
import ActionButton from '@/components/ui/ActionButton'
import PostEditor from '@/components/features/PostEditor'
import { updatePost, type ActionState } from '@/lib/actions/posts'
import OnboardingNotice from '@/components/features/onboarding/onboarding-notice'
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

/**
 * 글 수정 폼
 *
 * 🔴 PostForm 을 재사용하지 않는다.
 *    그쪽은 게시판 고르기와 임시저장(localStorage)이 몸통이다.
 *    고치는 화면에 임시저장이 붙으면 쓰다 만 새 글과 고치던 본문이 한 서랍에서 섞인다.
 *    같은 입력 정책(post-policy)을 보되 폼은 따로 둔다.
 *
 * 🔴 게시판 선택을 두지 않는다. 서버도 게시판 변경을 받지 않는다.
 */
export default function PostEditForm({
  boardSlug,
  postId,
  initialTitle,
  initialContent,
  cancelHref,
}: {
  boardSlug: string
  postId: string
  initialTitle: string
  initialContent: string
  cancelHref: string
}) {
  const pathname = usePathname()
  const [state, formAction] = useFormState<ActionState, FormData>(updatePost, {})
  const [title, setTitle] = useState(initialTitle)
  const [content, setContent] = useState(initialContent)
  /**
   * 🔴 글자 수는 HTML 이 아니라 글자로 센다 — PostForm 과 같은 규칙이다.
   *    처음 값은 에디터가 그려진 뒤 onTextChange 로 채워진다. 그 전에는
   *    "글자가 모자란다" 로 잘못 막지 않도록 저장된 본문 길이를 그대로 둔다.
   */
  const [text, setText] = useState(initialContent)

  // 🔴 사진만 남긴 글도 저장할 수 있다. 서버도 같은 규칙이다.
  const hasImage = content.includes('<img')
  const canSubmit =
    title.trim().length >= MIN_POST_TITLE_LENGTH &&
    (hasImage || text.trim().length >= MIN_POST_CONTENT_LENGTH)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="postId" value={postId} />
      <input type="hidden" name="boardSlug" value={boardSlug} />

      {state.error ? (
        state.needsOnboarding ? (
          <OnboardingNotice message={state.error} callbackUrl={pathname} />
        ) : (
          <p role="alert" className="text-sm text-state-danger">
            {state.error}
          </p>
        )
      ) : null}

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
        <input type="hidden" name="content" value={content} readOnly />
        <PostEditor
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

      {/* 저장만 주 버튼이다. 되돌아가기는 링크로 둔다 —
          같은 자리에 fill 버튼이 둘이면 어느 쪽이 원래 하려던 일인지 흐려진다. */}
      <div className="flex items-center gap-2">
        <ActionButton
          tone="primary"
          label="저장"
          pendingLabel="저장 중…"
          disabled={!canSubmit}
          className="justify-center px-6"
        />
        <Link
          href={cancelHref}
          className="inline-flex min-h-[52px] items-center px-4 text-content-muted no-underline"
        >
          그만두기
        </Link>
      </div>
    </form>
  )
}
