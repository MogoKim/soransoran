'use client'

import { useEffect, useRef, useState } from 'react'
import { TOUCH_MIN } from '@/lib/spacing'
import { useFormState } from 'react-dom'
import PostEditor from '@/components/features/PostEditor'
import WriteFooter, { WriteFooterSpacer } from '@/components/features/WriteFooter'
import WriteTopBar from '@/components/features/WriteTopBar'
import { createPost, type ActionState } from '@/lib/actions/posts'
import { COMMUNITY_BOARDS } from '@/lib/board-registry'
import { firstImageUrl } from '@/lib/post-media'
import {
  MAX_POST_TITLE_LENGTH,
  POST_CONTENT_PLACEHOLDER,
  POST_TITLE_PLACEHOLDER,
  postSubmitBlock,
} from '@/lib/post-policy'
import {
  findLatestDraft,
  readDraft,
  removeDraft,
  saveDraft,
  type PostDraft,
} from '@/lib/write-draft'
import { toEditorHtml } from '@/lib/post-content-format'
import OnboardingNotice from '@/components/features/onboarding/onboarding-notice'
import WriteLoginPrompt from '@/components/features/WriteLoginPrompt'

const DRAFT_SAVE_DELAY_MS = 1000

/**
 * 임시저장이 막힌 브라우저(사파리 시크릿 등)에서 로그인하러 나가기 전에 하는 말.
 *
 * 🔴 조용히 넘기지 않는다. 여기서 아무 말도 하지 않으면 사용자는 "글은 그대로 있어요"
 *    를 믿고 나갔다가 빈 화면으로 돌아온다. 우리가 지킬 수 없는 약속을 한 셈이 된다.
 */
const DRAFT_SAVE_FAILED =
  '이 브라우저에서는 임시저장이 안 돼요. 글을 복사해 두신 뒤 로그인해 주세요'

function resolveBoardSlug(slug: string | undefined): string {
  const found = COMMUNITY_BOARDS.find((b) => b.slug === slug)
  return found ? found.slug : COMMUNITY_BOARDS[0].slug
}

export default function PostForm({
  defaultBoardSlug,
  isLoggedIn,
}: {
  defaultBoardSlug?: string
  /**
   * 🔴 서버가 판정해 내려 준다. 클라이언트 세션 훅을 쓰지 않는 지금 구조(HeaderAuth·WriteCta)와 같다.
   *    이 값은 화면을 가르는 데만 쓰고, 저장을 막는 것은 서버(createPost)가 한다 —
   *    prop 하나로 DB 를 지킬 수는 없다.
   */
  isLoggedIn: boolean
}) {
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
  /**
   * 🔴 사진을 올리는 동안 등록을 막는다.
   *    올리는 중에는 본문에 든 것이 아직 blob: 주소다. 그대로 보내면
   *    sanitize 가 걸러 내 "분명히 넣었는데 올리고 나니 없는" 글이 된다.
   */
  const [uploading, setUploading] = useState(false)
  const [restored, setRestored] = useState(false)
  /** 비회원이 등록을 눌렀을 때만 뜬다. 띄우기 전에 저장은 이미 끝나 있다. */
  const [loginPrompt, setLoginPrompt] = useState<{ warning?: string } | null>(null)
  /**
   * 다른 게시판에 쓰다 만 글.
   *
   * 🔴 로그인·온보딩을 지나며 `?board=` 가 떨어지면 폼이 엉뚱한 게시판으로 열린다.
   *    그때 이 게시판의 임시저장만 보면 방금 쓴 글을 못 찾아 빈 화면이 된다.
   * 🔴 찾아만 두고 적용하지 않는다 — 게시판을 말없이 바꾸면 엉뚱한 곳에 글이 올라간다.
   */
  const [otherDraft, setOtherDraft] = useState<PostDraft | null>(null)

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
    /**
     * 🔴 임시저장된 것이 평문일 수 있다 — 에디터가 들어오기 전에 쓰다 만 글이다.
     *    평문을 그대로 Tiptap 에 넣으면 줄바꿈이 접힌다. HTML 로 바꿔 넣는다.
     */
    setContent(toEditorHtml(draft.content))
    setEditorKey((n) => n + 1)
    setRestored(true)
  }

  useEffect(() => {
    const slug = resolveBoardSlug(defaultBoardSlug)
    const draft = readDraft(slug)
    if (draft) {
      applyDraft(draft)
    } else {
      // 이 게시판에 쓰던 것이 없을 때만 다른 게시판을 본다 — 있으면 그것이 답이다.
      setOtherDraft(findLatestDraft(COMMUNITY_BOARDS.map((b) => b.slug).filter((s) => s !== slug)))
    }
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

  /**
   * 🔴 사진 판정을 서버와 같은 함수로 한다(post-media).
   *    `<img` 만 세면 아직 올리는 중인 blob: 미리보기까지 사진으로 쳐서,
   *    버튼은 열렸는데 서버가 막는 상태가 생긴다.
   */
  const hasImage = firstImageUrl(content) !== null
  const block = postSubmitBlock({
    uploading,
    title,
    textLength: text.trim().length,
    hasImage,
  })
  const canSubmit = block === null
  const board = COMMUNITY_BOARDS.find((b) => b.slug === boardSlug)

  return (
    <form
      action={(formData) => {
        /**
         * 🔴 버튼이 잠겨 있다는 것만 믿지 않는다.
         *    제목칸에서 Enter 를 치면 브라우저가 폼을 대신 보내는 길(implicit submission)이
         *    있고, form.requestSubmit() 처럼 버튼을 거치지 않는 길도 있다.
         *    그 길로 들어오면 아직 올릴 수 없는 글에도 로그인 안내가 떠서,
         *    로그인하고 돌아온 사람이 "왜 안 올라가지" 를 그때 처음 알게 된다.
         *    글을 쓰게 하려고 부른 로그인이 헛걸음이 되는 셈이다.
         *
         * 🔴 화면과 같은 postSubmitBlock 결과를 그대로 쓴다. 여기서 조건을 다시 적으면
         *    버튼과 이 자리가 서로 다른 답을 내는 날이 온다 — 규칙은 한 곳에만 둔다.
         *
         * 🔴 막힌 이유는 이미 WriteFooter 가 그 자리에서 글로 말하고 있다.
         *    여기서는 조용히 멈추기만 한다. 같은 말을 두 번 하면 둘 다 안 읽힌다.
         *
         * 🔴 회원도 함께 멈춘다. 어차피 서버가 같은 이유로 거절하는데, 다녀오는 동안
         *    "등록 중…" 을 보여 주고 그 사이 임시저장을 지웠다 되살리기까지 한다.
         */
        if (block) return

        /**
         * 🔴 비회원은 여기서 멈춘다. createPost 를 부르지 않는다.
         *    서버도 세션 없이는 거부하지만, 불러 봐야 돌아오는 것은 실패뿐이고
         *    그 사이 화면은 "등록 중…" 을 보여 준다 — 될 것처럼 굴다가 안 되는 것이
         *    가장 나쁘다. 될 수 없다는 것을 아는 쪽에서 미리 멈춘다.
         *
         * 🔴 저장이 먼저다. 안내를 띄운 뒤에 저장하면 그 사이 사용자가 카카오를 눌러
         *    화면을 떠날 수 있고, 그러면 글이 저장되지 않은 채로 나간다.
         *
         * 🔴 removeDraft 를 부르지 않는다. 아래 로그인 흐름이 지우는 것은
         *    "서버에 넘긴 글" 이다. 여기서는 아무것도 넘기지 않았으므로
         *    지우면 사용자가 쓴 글만 사라진다.
         *
         * 🔴 로그인하고 돌아와도 자동으로 등록하지 않는다. 저장은 사람이 마지막으로
         *    한 번 더 확인하고 누르는 일이다 — 로그인 왕복 사이에 글이 복원되고
         *    곧바로 발행되면, 무엇이 올라갔는지 보지 못한 채 글이 공개된다.
         */
        if (!isLoggedIn) {
          const saved = saveDraft(draftRef.current, Date.now())
          setLoginPrompt({ warning: saved ? undefined : DRAFT_SAVE_FAILED })
          return
        }

        removeDraft(boardSlug)
        formAction(formData)
      }}
      className="flex flex-col gap-4"
    >
      {/* 🔴 등록은 여기서 항상 누를 수 있다. 키보드가 화면 아래를 덮어도 남는다. */}
      <WriteTopBar
        title={board ? `${board.label} 글쓰기` : '글쓰기'}
        submitLabel="등록"
        pendingLabel="등록 중…"
        canSubmit={canSubmit}
        cancelHref={board?.href ?? '/'}
      />

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
            className={`inline-flex ${TOUCH_MIN} items-center px-2 text-sm text-content-muted underline`}
          >
            새로 쓰기
          </button>
        </div>
      ) : null}

      {/* 🔴 누르기 전에는 아무것도 바꾸지 않는다. 게시판이 말없이 바뀌면
             갱년기 이야기가 자유게시판에 올라간다 — 되돌릴 수 없는 실수다.
             이미 뭔가 쓰고 있는 사람은 방해하지 않는다. */}
      {otherDraft && !title && !content ? (
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-surface-soft px-3">
          <p role="status" className="flex-1 text-sm text-content-muted">
            다른 게시판에 쓰다 만 글이 있어요.
          </p>
          <button
            type="button"
            onClick={() => {
              setBoardSlug(otherDraft.boardSlug)
              applyDraft(otherDraft)
              setOtherDraft(null)
            }}
            className={`inline-flex ${TOUCH_MIN} shrink-0 items-center px-2 text-sm font-bold text-content-primary underline`}
          >
            이어서 쓰기
          </button>
          <button
            type="button"
            aria-label="안내 닫기"
            onClick={() => setOtherDraft(null)}
            className={`inline-flex ${TOUCH_MIN} min-w-[52px] shrink-0 items-center justify-center text-sm text-content-muted`}
          >
            ✕
          </button>
        </div>
      ) : null}

      {/* 🔴 라벨을 떼고 고른 값·쓴 글이 그대로 보이게 한다. 글쓰기 화면에는
             입력칸이 셋뿐이라 "게시판·제목·내용" 을 적어 두면 글보다 안내가 먼저 읽힌다. */}
      <select
        name="boardSlug"
        aria-label="게시판"
        value={boardSlug}
        onChange={(e) => handleBoardChange(e.target.value)}
        className="min-h-[52px] border-b border-subtle bg-transparent text-content-primary"
      >
        {COMMUNITY_BOARDS.map((b) => (
          <option key={b.slug} value={b.slug}>
            {b.label}
          </option>
        ))}
      </select>

      <input
        name="title"
        type="text"
        aria-label="제목"
        maxLength={MAX_POST_TITLE_LENGTH}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="min-h-[52px] border-b border-subtle bg-transparent text-lg font-bold text-content-primary placeholder:font-normal placeholder:text-content-muted"
        placeholder={POST_TITLE_PLACEHOLDER}
      />

      <div className="flex flex-col gap-1">
        {/* 🔴 form 에는 hidden input 으로 낸다. Tiptap 은 name 을 가진 입력이 아니다. */}
        <input type="hidden" name="content" value={content} readOnly />
        <PostEditor
          key={editorKey}
          value={content}
          onChange={setContent}
          onTextChange={setText}
          onBusyChange={setUploading}
          placeholder={POST_CONTENT_PLACEHOLDER}
          /* 굵게·유튜브는 브라우저 안에서 끝나 임시저장에 그대로 남는다.
             사진만 서버를 거치므로 비회원에게는 열지 않는다(post-media-policy). */
          canUploadImage={isLoggedIn}
        />
      </div>

      {/* 🔴 고정된 하단 바가 본문 마지막 줄을 덮지 않게 자리를 비운다. */}
      <WriteFooterSpacer />
      <WriteFooter block={block} textLength={text.length} label="등록하기" pendingLabel="등록 중…" />

      {/* 🔴 돌아올 곳에 board 를 싣는다. 임시저장이 게시판별 키라, 이 값이 빠지면
             로그인을 마치고 돌아와도 방금 쓴 글을 찾지 못한다.
             내부 경로 판정은 KakaoSignInButton 의 onboardingHref 하나가 한다 —
             여기서 또 거르면 규칙이 두 곳이 되고, 언젠가 서로 다른 답을 낸다. */}
      {loginPrompt ? (
        <WriteLoginPrompt
          callbackUrl={`/write?board=${encodeURIComponent(boardSlug)}`}
          warning={loginPrompt.warning}
          onClose={() => setLoginPrompt(null)}
        />
      ) : null}
    </form>
  )
}
