'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { useFormState } from 'react-dom'
import ActionButton from '@/components/ui/ActionButton'
import PostEditor from '@/components/features/PostEditor'
import WriteTopBar from '@/components/features/WriteTopBar'
import { firstImageUrl } from '@/lib/post-media'
import { updatePost, type ActionState } from '@/lib/actions/posts'
import OnboardingNotice from '@/components/features/onboarding/onboarding-notice'
import {
  MAX_POST_CONTENT_LENGTH,
  MAX_POST_TITLE_LENGTH,
  POST_CONTENT_COUNTER_FROM,
  POST_CONTENT_COUNTER_WARN_FROM,
  POST_CONTENT_PLACEHOLDER,
  POST_TITLE_PLACEHOLDER,
  postBlockMessage,
  postSubmitBlock,
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
   *    에디터가 붙는 즉시 onTextChange 로 실제 글자가 들어온다(PostEditor).
   *    그 한 박자 전에도 저장 버튼이 잠기지 않도록 넉넉한 초기값을 둔다.
   */
  const [text, setText] = useState(initialContent)
  /** 🔴 사진을 올리는 동안 저장을 막는다 — PostForm 과 같은 이유다(blob: 주소). */
  const [uploading, setUploading] = useState(false)

  // 🔴 사진만 남긴 글도 저장할 수 있다. 판정은 서버와 같은 함수로 한다 — PostForm 과 같은 이유다.
  const hasImage = firstImageUrl(content) !== null
  const block = postSubmitBlock({
    uploading,
    title,
    textLength: text.trim().length,
    hasImage,
  })
  const canSubmit = block === null

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="postId" value={postId} />
      <input type="hidden" name="boardSlug" value={boardSlug} />

      {/* 🔴 새 글 화면과 같은 상단바다. 하는 일이 다르다고 조작 구조까지 달라지면
             같은 사람이 두 화면을 다르게 배워야 한다. */}
      <WriteTopBar
        title="수정하기"
        submitLabel="수정"
        pendingLabel="수정 중…"
        canSubmit={canSubmit}
        cancelHref={cancelHref}
      />

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
          onBusyChange={setUploading}
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

      {/* 🔴 왜 아직 못 고치는지 그 자리에서 말한다 — 새 글 화면과 같은 문장을 쓴다. */}
      {block ? (
        <p role="status" className="-mt-1 text-sm font-bold text-content-secondary">
          {postBlockMessage(block)}
        </p>
      ) : null}

      {/* 🔴 그만두기는 상단바의 '취소' 하나로 옮겼다. 같은 일을 하는 길이 화면에
             둘 있으면 어느 쪽이 진짜인지 매번 고르게 된다. */}
      <ActionButton
        tone="primary"
        label="수정하기"
        pendingLabel="수정 중…"
        disabled={!canSubmit}
        className="justify-center px-6"
      />
    </form>
  )
}
