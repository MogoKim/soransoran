'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { TOUCH_MIN } from '@/lib/spacing'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Youtube from '@tiptap/extension-youtube'
import Placeholder from '@tiptap/extension-placeholder'
import EditorIcon from '@/components/icons/EditorIcon'
import { cn } from '@/lib/utils'
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_COUNT,
  ALLOWED_IMAGE_TYPES,
  HEIC_EXTENSION,
  IMAGE_TOO_LARGE,
  IMAGE_TYPE_NOT_ALLOWED,
  IMAGE_TOO_MANY,
  IMAGE_UPLOAD_FAILED,
  IMAGE_NEEDS_LOGIN,
  YOUTUBE_URL,
  YOUTUBE_INVALID,
} from '@/lib/post-media-policy'

/**
 * 글 본문 에디터 — 사진 · 유튜브 · 굵게.
 *
 * 🔴 우나어 TipTapEditor 를 그대로 옮기지 않았다.
 *    그쪽 842 줄에는 동영상 파일 업로드 · 글자 크기 · 인용 · 디버그 overlay 가
 *    같이 들어 있다. 1차 범위에 없는 것을 함께 들여오면 쓰지 않는 코드가
 *    먼저 낡고, 그 위에 다음 사람이 또 얹는다.
 *    가져온 것은 세 가지다 — 붙여넣기 자동 임베드 · 키보드 위 툴바 ·
 *    올리는 동안 미리 보여주는 방식.
 *
 * 🔴 링크는 붙여넣기로만 만든다. 툴바에 버튼을 두지 않았다.
 *    https 주소를 붙여넣거나 글자를 고른 뒤 주소를 붙여넣으면 링크가 된다.
 *    허용 기준(https 절대 주소)은 서버 sanitize 와 같다.
 *
 * 🔴 값(HTML)은 부모가 들고 있는다. 여기서 form 을 만들지 않는다 —
 *    PostForm 은 임시저장을, PostEditForm 은 취소를 각각 다르게 다룬다.
 *
 * 🔴 글자 수는 HTML 이 아니라 글자로 센다.
 *    사진 주소 한 줄이 100 자를 넘어서, HTML 길이로 재면 사진 몇 장에
 *    5000 자 상한이 차 버린다. 서버도 같은 기준으로 본다(post-html.ts).
 */

/** 올리는 동안 화면에 먼저 보여줄 자리를 만들되, 저장되지 않게 blob: 을 쓴다. */
type Upload = { blobUrl: string; name: string }

function countImages(editor: Editor): number {
  let count = 0
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'image') count += 1
  })
  return count
}

/** 올리기가 끝나면 미리보기 주소를 진짜 주소로 바꾼다. 되돌리기 이력에는 남기지 않는다. */
function swapImageSrc(editor: Editor, from: string, to: string): void {
  const { state } = editor.view
  const tr = state.tr.setMeta('addToHistory', false)
  let done = false
  state.doc.descendants((node, pos) => {
    if (!done && node.type.name === 'image' && node.attrs.src === from) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: to })
      done = true
    }
  })
  if (done) editor.view.dispatch(tr)
}

/** 실패하면 미리보기 자리를 치운다. 빈 액자가 남으면 저장 뒤에야 알아차린다. */
function dropImage(editor: Editor, src: string): void {
  const { state } = editor.view
  const tr = state.tr.setMeta('addToHistory', false)
  let done = false
  state.doc.descendants((node, pos) => {
    if (!done && node.type.name === 'image' && node.attrs.src === src) {
      tr.delete(pos, pos + node.nodeSize)
      done = true
    }
  })
  if (done) editor.view.dispatch(tr)
}

export default function PostEditor({
  value,
  onChange,
  onTextChange,
  onBusyChange,
  placeholder,
  canUploadImage = true,
  focusSignal,
  ariaInvalid,
  ariaDescribedBy,
}: {
  /** 본문 HTML. 처음 한 번만 에디터에 넣는다. */
  value: string
  onChange: (html: string) => void
  /** 글자만 뽑은 길이 — 부모가 글자 수·제출 가능 여부를 판단한다. */
  onTextChange: (text: string) => void
  /**
   * 사진을 올리는 중인가.
   *
   * 🔴 부모가 이걸 알아야 등록 버튼을 잠글 수 있다.
   *    올리는 동안 화면에는 사진이 보이지만 본문에 들어 있는 것은
   *    아직 blob: 주소다. 그대로 저장하면 sanitize 가 걸러 내
   *    "분명히 넣었는데 올리고 나니 없는" 글이 된다.
   */
  onBusyChange?: (busy: boolean) => void
  placeholder: string
  /**
   * 사진을 올릴 수 있는 사람인가.
   *
   * 🔴 기본값은 true 다. 글 고치기(PostEditForm)는 이미 로그인한 사람만 들어오므로
   *    넘기지 않아도 지금까지와 똑같이 동작한다 — 회귀를 만들지 않으려고 optional 로 둔다.
   *
   * 🔴 버튼을 감추지 않고 눌렀을 때 말해 준다. 감추면 "이 서비스는 사진을 못 넣는구나"
   *    로 읽히고, 로그인하면 되는 일이라는 것을 알 길이 없다.
   */
  canUploadImage?: boolean
  /**
   * 값이 바뀌면 본문에 초점을 준다.
   *
   * 🔴 에디터 인스턴스를 밖에 내주지 않는다. 밖에서 문서를 직접 만질 수 있게 되면
   *    저장될 HTML 을 건드리는 길이 함께 열린다 — 이 파일이 지키는 경계가 그것이다.
   *    "초점을 달라" 는 신호 하나만 받는다.
   * 🔴 optional 이라 넘기지 않는 화면은 지금과 똑같이 동작한다.
   */
  focusSignal?: number
  /** 본문이 막혔을 때 스크린리더에 알린다 */
  ariaInvalid?: boolean
  /** 안내 문구와 잇는다 */
  ariaDescribedBy?: string
}) {
  const [uploading, setUploading] = useState<Upload | null>(null)
  const [error, setError] = useState('')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [youtubeError, setYoutubeError] = useState('')
  const [mediaSelected, setMediaSelected] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<Editor | null>(null)
  // 화면을 떠난 뒤 setState 가 도는 것을 막는다 — 올리는 도중 뒤로 가면 생긴다.
  const aliveRef = useRef(true)
  useEffect(() => () => { aliveRef.current = false }, [])

  /**
   * 🔴 콜백을 ref 로 들고 uploading 만 의존성에 둔다.
   *    부모가 인라인 함수를 넘기면 매 렌더마다 새 함수가 되어,
   *    onBusyChange 를 의존성에 넣는 순간 렌더마다 부모 state 를 건드려
   *    무한 루프가 된다.
   *
   * 🔴 화면을 떠날 때 false 로 되돌린다. 올리다 만 채로 나가면
   *    부모의 버튼이 영영 잠긴 채로 남는다.
   */
  const onBusyChangeRef = useRef(onBusyChange)
  onBusyChangeRef.current = onBusyChange
  useEffect(() => {
    onBusyChangeRef.current?.(uploading !== null)
    return () => onBusyChangeRef.current?.(false)
  }, [uploading])

  const editor = useEditor({
    // Next.js 서버 렌더와 맞물리면 hydration 이 어긋난다. 브라우저에서만 그린다.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        // 1차 툴바는 굵게 하나다. 손잡이 없는 서식을 문서 구조로만 열어 두면
        // 붙여넣기로만 들어와 렌더·sanitize 규칙과 어긋난다.
        heading: false,
        codeBlock: false,
        code: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        horizontalRule: false,
        strike: false,
        /**
         * 🔴 링크 버튼을 만들지 않는다. 주소를 붙여넣으면 그냥 링크가 된다.
         *    툴바에 손잡이를 하나 더 두는 것보다, 이미 하는 행동(붙여넣기)이
         *    바로 되는 편이 배울 것이 적다.
         *
         * 🔴 https 만 받는다. 서버 sanitize(post-html.ts)와 같은 기준이다 —
         *    화면에서 만들어진 것이 저장 단계에서 조용히 사라지면
         *    "분명히 링크였는데" 가 된다.
         *
         * 🔴 openOnClick 을 끈다. 글을 고치다 링크를 누르면 편집하던 화면을
         *    떠나게 된다. 쓰던 글을 잃는 자리다.
         *
         * 🔴 target·rel 을 여기서도 준다. 최종 판정은 서버가 다시 하지만,
         *    에디터가 만든 것과 저장된 것이 같아야 미리보기가 거짓말을 하지 않는다.
         */
        link: {
          autolink: true,
          linkOnPaste: true,
          openOnClick: false,
          protocols: ['https'],
          defaultProtocol: 'https',
          HTMLAttributes: {
            target: '_blank',
            rel: 'nofollow noopener noreferrer',
          },
          isAllowedUri: (url: string) => {
            try {
              return new URL(url).protocol === 'https:'
            } catch {
              return false
            }
          },
        },
      }),
      Image.configure({ HTMLAttributes: { class: 'rounded-lg' } }),
      Youtube.configure({
        // 🔴 nocookie 로 넣는다. 읽기만 해도 추적 쿠키가 붙는 것을 줄인다.
        //    sanitize 허용 목록에 www.youtube-nocookie.com 이 들어 있는 것과 짝이다.
        nocookie: true,
        controls: true,
        HTMLAttributes: { class: 'rounded-lg overflow-hidden' },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: value,
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML())
      onTextChange(ed.getText())
    },
    onSelectionUpdate: ({ editor: ed }) => {
      const selection = ed.state.selection as { node?: { type: { name: string } } }
      const name = selection.node?.type?.name
      setMediaSelected(name === 'image' || name === 'youtube')
    },
    editorProps: {
      attributes: {
        class:
          // 🔴 본문이 이 화면의 주인공이다. 모바일에서는 화면 높이를 기준으로 잡아
          //    작은 상자에 글을 밀어 넣는 느낌이 들지 않게 한다.
          //    svh 를 쓴다 — vh 는 주소창이 접힐 때 값이 바뀌어 입력 중에 상자가 튄다.
          'min-h-[max(240px,42svh)] px-4 py-3 leading-[1.85] text-content-primary outline-none [word-break:keep-all] [overflow-wrap:anywhere]',
      },
      handlePaste: (_view, event) => {
        const text = event.clipboardData?.getData('text/plain')?.trim() ?? ''
        // 유튜브 주소만 붙여넣었을 때는 링크가 아니라 화면으로 넣는다.
        // 주소 뒤에 글이 이어지면 사람이 쓴 문장이므로 건드리지 않는다.
        if (!YOUTUBE_URL.test(text) || /\s/.test(text)) return false
        editorRef.current?.chain().focus().setYoutubeVideo({ src: text }).createParagraphNear().run()
        return true
      },
      handleClickOn: (_view, _pos, node, nodePos, _event, direct) => {
        // 사진·영상을 눌러 고를 수 있게 한다 — 지우려면 먼저 고를 수 있어야 한다.
        if (!direct) return false
        if (node.type.name !== 'image' && node.type.name !== 'youtube') return false
        editorRef.current?.chain().setNodeSelection(nodePos).run()
        return true
      },
    },
  })

  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  /**
   * 본문이 막혔다는 사실을 스크린리더에도 알린다.
   *
   * 🔴 useEditor 의 editorProps.attributes 에 넣지 않는다. 그건 만들 때 한 번 굳는 값이라
   *    오류가 났다 풀렸다 하는 것을 따라오지 않는다. 실제 DOM 에 붙였다 뗀다.
   */
  useEffect(() => {
    const dom = editor?.view.dom
    if (!dom) return
    if (ariaInvalid) dom.setAttribute('aria-invalid', 'true')
    else dom.removeAttribute('aria-invalid')
    if (ariaInvalid && ariaDescribedBy) dom.setAttribute('aria-describedby', ariaDescribedBy)
    else dom.removeAttribute('aria-describedby')
  }, [editor, ariaInvalid, ariaDescribedBy])

  /**
   * 부모가 "본문으로 데려가 달라" 고 하면 초점을 준다.
   *
   * 🔴 첫 렌더에서는 움직이지 않는다. 화면에 들어오자마자 본문으로 초점이 튀면
   *    제목부터 쓰려던 사람의 손이 엉뚱한 곳으로 간다.
   * 🔴 문서를 고르거나 바꾸지 않는다. 초점만 준다 — 저장될 HTML 은 그대로다.
   */
  const focusSignalRef = useRef(focusSignal)
  useEffect(() => {
    if (focusSignal === undefined) return
    if (focusSignalRef.current === focusSignal) return
    focusSignalRef.current = focusSignal
    editor?.commands.focus()
  }, [focusSignal, editor])

  /**
   * 🔴 에디터가 붙자마자 글자 수를 한 번 올린다.
   *    Tiptap 의 onUpdate 는 사람이 친 뒤에만 돈다. 그 전까지 부모는
   *    처음 넘긴 문자열(HTML)의 길이를 글자 수로 알고 있다 —
   *    옛 글을 고치러 들어와 아무것도 치지 않고 저장할 때 이 값으로 판정된다.
   */
  const onTextChangeRef = useRef(onTextChange)
  onTextChangeRef.current = onTextChange
  useEffect(() => {
    if (editor) onTextChangeRef.current(editor.getText())
  }, [editor])

  const handleFiles = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? [])
      event.target.value = ''
      if (files.length === 0 || !editor) return

      // 버튼에서 이미 막지만 여기서도 본다 — 올리는 길은 하나여야 하고,
      // 그 하나가 어떤 경로로 불려도 같은 답을 내야 한다.
      if (!canUploadImage) {
        setError(IMAGE_NEEDS_LOGIN)
        return
      }

      setError('')

      if (countImages(editor) + files.length > MAX_IMAGE_COUNT) {
        setError(IMAGE_TOO_MANY)
        return
      }
      if (files.some((f) => f.size > MAX_IMAGE_BYTES)) {
        setError(IMAGE_TOO_LARGE)
        return
      }
      const typeOk = (f: File) =>
        ALLOWED_IMAGE_TYPES.includes(f.type as (typeof ALLOWED_IMAGE_TYPES)[number]) ||
        (f.type === '' && HEIC_EXTENSION.test(f.name))
      if (!files.every(typeOk)) {
        setError(IMAGE_TYPE_NOT_ALLOWED)
        return
      }

      // 한 장씩 올린다. 한꺼번에 보내면 어느 것이 실패했는지 말해 줄 수 없다.
      for (const file of files) {
        const blobUrl = URL.createObjectURL(file)
        editor.chain().focus().setImage({ src: blobUrl }).createParagraphNear().run()
        setUploading({ blobUrl, name: file.name })

        try {
          const body = new FormData()
          body.append('file', file)
          const res = await fetch('/api/uploads', { method: 'POST', body })

          if (!res.ok) {
            const payload = (await res.json().catch(() => ({}))) as { error?: string }
            if (aliveRef.current) setError(payload.error ?? IMAGE_UPLOAD_FAILED)
            dropImage(editor, blobUrl)
            URL.revokeObjectURL(blobUrl)
            break
          }

          const { url } = (await res.json()) as { url: string }
          swapImageSrc(editor, blobUrl, url)
          // onUpdate 는 사람이 친 것만 따라온다 — 주소를 바꾼 것은 직접 알린다.
          onChange(editor.getHTML())
        } catch {
          if (aliveRef.current) setError(IMAGE_UPLOAD_FAILED)
          dropImage(editor, blobUrl)
          break
        } finally {
          URL.revokeObjectURL(blobUrl)
          if (aliveRef.current) setUploading(null)
        }
      }
    },
    [editor, onChange, canUploadImage],
  )

  const insertYoutube = useCallback(() => {
    if (!editor) return
    const url = youtubeUrl.trim()
    if (!YOUTUBE_URL.test(url)) {
      setYoutubeError(YOUTUBE_INVALID)
      return
    }
    editor.chain().focus().setYoutubeVideo({ src: url }).createParagraphNear().run()
    setYoutubeUrl('')
    setYoutubeError('')
    setSheetOpen(false)
  }, [editor, youtubeUrl])

  if (!editor) {
    // 에디터가 붙기 전에도 자리가 있어야 화면이 튀지 않는다.
    return <div className="min-h-[max(240px,42svh)] rounded-lg border border-subtle bg-surface-card" />
  }

  const busy = uploading !== null

  return (
    <div className="relative">
      {error ? (
        <p role="alert" className="mb-2 text-sm text-state-danger">
          {error}
        </p>
      ) : null}

      {/* 🔴 툴바는 문서 흐름 안에만 둔다. sticky·fixed 로 띄우거나 viewport 보정을 주면
             제자리를 벗어나 본문 카드 테두리와 첫 줄 위를 덮는다 — 실기기에서 그렇게 깨졌다.
             화면에 붙여 두어야 하는 것은 등록 버튼이지 도구가 아니다. */}
      <div className="mb-3">
        {mediaSelected ? (
          <div className="mb-1 flex items-center justify-between rounded-lg bg-surface-soft px-3">
            <span className="text-sm text-content-secondary">사진·영상을 골랐어요</span>
            <button
              type="button"
              // 버튼을 누르는 순간 에디터가 초점을 잃으면 무엇이 선택됐는지 사라진다.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                editor.chain().focus().deleteSelection().run()
                setMediaSelected(false)
              }}
              className={`inline-flex ${TOUCH_MIN} items-center gap-1.5 px-2 text-sm font-bold text-state-danger`}
            >
              <EditorIcon name="trash" size={18} />
              빼기
            </button>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              // 🔴 고르는 창을 열기 전에 막는다. 열어 두고 서버 401 로 되돌리면
              //    본문에 미리보기가 들어갔다 사라지는 것을 한 번 보게 된다(handleFiles).
              if (!canUploadImage) {
                setError(IMAGE_NEEDS_LOGIN)
                return
              }
              setError('')
              fileRef.current?.click()
            }}
            disabled={busy}
            className={`inline-flex ${TOUCH_MIN} items-center gap-1.5 rounded-xl bg-surface-page px-3 text-sm text-content-primary disabled:opacity-40`}
          >
            <EditorIcon name={busy ? 'spinner' : 'photo'} />
            {busy ? '올리는 중…' : '사진'}
          </button>

          <button
            type="button"
            onClick={() => { setError(''); setSheetOpen(true) }}
            className={`inline-flex ${TOUCH_MIN} items-center gap-1.5 rounded-xl bg-surface-page px-3 text-sm text-content-primary`}
          >
            <EditorIcon name="youtube" />
            유튜브
          </button>

          <button
            type="button"
            aria-pressed={editor.isActive('bold')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={cn(
              `inline-flex ${TOUCH_MIN} items-center gap-1.5 rounded-xl px-3 text-sm`,
              editor.isActive('bold')
                ? 'bg-brand-soft font-bold text-brand-strong'
                : 'bg-surface-page text-content-primary',
            )}
          >
            <EditorIcon name="bold" />
            굵게
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-subtle bg-surface-card focus-within:border-interactive">
        <EditorContent editor={editor} />
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFiles}
      />

      {sheetOpen ? (
        <div
          className="fixed inset-0 z-40"
          role="dialog"
          aria-modal="true"
          aria-label="유튜브 주소 넣기"
        >
          <button
            type="button"
            aria-label="닫기"
            onClick={() => setSheetOpen(false)}
            className="absolute inset-0 w-full cursor-default bg-content-primary/40"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-surface-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
            <p className="m-0 font-bold text-content-primary">유튜브 주소를 붙여넣어 주세요</p>
            <p className="mt-1 text-sm text-content-muted">
              본문에 주소만 붙여넣어도 영상으로 바뀝니다.
            </p>
            <input
              type="url"
              inputMode="url"
              autoFocus
              value={youtubeUrl}
              onChange={(e) => { setYoutubeUrl(e.target.value); setYoutubeError('') }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); insertYoutube() }
              }}
              placeholder="https://www.youtube.com/watch?v=..."
              className="mt-3 min-h-[52px] w-full rounded-lg border border-subtle bg-surface-page px-3"
            />
            {youtubeError ? (
              <p role="alert" className="mt-1 text-sm text-state-danger">
                {youtubeError}
              </p>
            ) : null}
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={insertYoutube}
                className={`${TOUCH_MIN} flex-1 rounded-lg bg-cta px-5 text-lg font-bold text-cta-content`}
              >
                넣기
              </button>
              <button
                type="button"
                onClick={() => { setSheetOpen(false); setYoutubeUrl(''); setYoutubeError('') }}
                className={`${TOUCH_MIN} px-4 text-content-muted`}
              >
                그만두기
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
