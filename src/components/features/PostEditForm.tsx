'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { useFormState } from 'react-dom'
import PostEditor from '@/components/features/PostEditor'
import WriteFooter, { WriteFooterSpacer } from '@/components/features/WriteFooter'
import WriteTopBar from '@/components/features/WriteTopBar'
import { firstImageUrl } from '@/lib/post-media'
import { updatePost, type ActionState } from '@/lib/actions/posts'
import OnboardingNotice from '@/components/features/onboarding/onboarding-notice'
import FieldErrorNotice from '@/components/features/FieldErrorNotice'
import { usePostGuardError } from '@/components/features/use-post-guard-error'
import {
  MAX_POST_TITLE_LENGTH,
  POST_CONTENT_PLACEHOLDER,
  POST_TITLE_PLACEHOLDER,
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

  /**
   * 🔴 새 글 폼과 같은 훅을 쓴다. 고치는 화면만 다르게 말하면 같은 사람이 두 번 배운다.
   * 🔴 금칙어 판정을 화면에서 다시 하지 않는다. 서버가 검사하는 평문은
   *    postContentToText(HTML) 이고 에디터가 아는 글자는 editor.getText() 라 서로 다르다 —
   *    화면이 미리 막으면 "버튼은 잠겼는데 서버는 통과" 또는 그 반대가 생긴다.
   *    판정은 서버 하나가 하고, 화면은 그 답을 제자리에 붙인다(정본 §5-3·§5-11).
   */
  const guard = usePostGuardError({ fieldError: state.fieldError, title, content })
  const titleBlocked = guard.error?.field === 'title'
  const contentBlocked = guard.error?.field === 'content'

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

      {/* 🔴 칸에 붙는 안내가 있으면 위쪽 요약은 띄우지 않는다.
             같은 문장이 두 번 읽히면 무엇이 문제인지 오히려 흐려진다. */}
      {state.error && !guard.error ? (
        state.needsOnboarding ? (
          <OnboardingNotice message={state.error} callbackUrl={pathname} />
        ) : (
          <p role="alert" className="text-sm text-state-danger">
            {state.error}
          </p>
        )
      ) : null}

      {/* 🔴 새 글 화면과 같은 배치다 — 라벨 없이 쓴 글이 그대로 보인다. */}
      <div className="flex flex-col gap-1">
        <input
          ref={guard.titleRef}
          name="title"
          type="text"
          aria-label="제목"
          aria-invalid={titleBlocked || undefined}
          aria-describedby={titleBlocked ? guard.titleErrorId : undefined}
          maxLength={MAX_POST_TITLE_LENGTH}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="min-h-[52px] border-b border-subtle bg-transparent text-lg font-bold text-content-primary placeholder:font-normal placeholder:text-content-muted aria-[invalid]:border-state-danger"
          placeholder={POST_TITLE_PLACEHOLDER}
        />
        {titleBlocked && guard.error ? (
          <FieldErrorNotice id={guard.titleErrorId} message={guard.error.message} />
        ) : null}
      </div>

      <div ref={guard.bodyRef} className="flex flex-col gap-1">
        <input type="hidden" name="content" value={content} readOnly />
        <PostEditor
          value={content}
          onChange={setContent}
          onTextChange={setText}
          onBusyChange={setUploading}
          placeholder={POST_CONTENT_PLACEHOLDER}
          focusSignal={guard.editorFocusSignal}
          ariaInvalid={contentBlocked}
          ariaDescribedBy={guard.contentErrorId}
        />
        {contentBlocked && guard.error ? (
          <FieldErrorNotice id={guard.contentErrorId} message={guard.error.message} />
        ) : null}
      </div>

      {/* 🔴 고정된 하단 바가 본문 마지막 줄을 덮지 않게 자리를 비운다. */}
      <WriteFooterSpacer />
      <WriteFooter block={block} textLength={text.length} label="수정하기" pendingLabel="수정 중…" />
    </form>
  )
}
