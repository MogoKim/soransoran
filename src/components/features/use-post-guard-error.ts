'use client'

import { useEffect, useRef, useState } from 'react'
import type { PostFieldError } from '@/lib/actions/posts'

/**
 * 콘텐츠 가드에 걸린 칸을 화면에서 다루는 한 곳.
 *
 * 🔴 새 글 폼과 고치기 폼이 각자 적지 않는다.
 *    두 화면은 이미 폼을 따로 두고 있어(PostEditForm 주석) 오류 처리까지 각자 쓰면
 *    언젠가 한쪽만 고쳐진다 — 실제로 "새 글은 제목이라고 말하는데 고치기는 안 말하는"
 *    상태가 되기 쉽다. 규칙은 여기 하나만 둔다.
 *
 * 🔴 문구를 만들지 않는다. 서버가 준 message 를 그대로 띄운다.
 *    화면이 code 로 문장을 지어내면 두 화면이 다른 말을 하게 된다.
 *
 * 🔴 입력값을 건드리지 않는다. 지우지도, 치환하지도, 검열 문자로 덮지도 않는다.
 *    사람이 쓴 글은 사람이 고친다.
 */

let seq = 0

export type PostGuardErrorApi = {
  /** 지금 화면에 띄울 오류. 사용자가 그 칸을 고치면 사라진다 */
  error: PostFieldError | null
  /** aria-describedby 로 이을 id */
  titleErrorId: string
  contentErrorId: string
  titleRef: React.RefObject<HTMLInputElement>
  /** 본문 영역을 화면 안으로 들이는 데 쓴다 */
  bodyRef: React.RefObject<HTMLDivElement>
  /** 값이 바뀔 때마다 PostEditor 가 본문에 초점을 준다 */
  editorFocusSignal: number
}

export function usePostGuardError({
  fieldError,
  title,
  content,
}: {
  fieldError: PostFieldError | undefined
  title: string
  content: string
}): PostGuardErrorApi {
  const [error, setError] = useState<PostFieldError | null>(null)
  const [editorFocusSignal, setEditorFocusSignal] = useState(0)

  const titleRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  /** 오류가 났을 때의 값. 이 값에서 달라지면 사람이 고친 것이다 */
  const atErrorRef = useRef<{ title: string; content: string } | null>(null)
  /** 이미 처리한 서버 응답. 같은 객체를 두 번 처리하지 않는다 */
  const handledRef = useRef<PostFieldError | null>(null)

  const idsRef = useRef<{ title: string; content: string } | null>(null)
  if (!idsRef.current) {
    seq += 1
    idsRef.current = { title: `post-title-error-${seq}`, content: `post-content-error-${seq}` }
  }
  const ids = idsRef.current

  /**
   * 서버가 어느 칸이 왜 막혔는지 알려 오면 그 자리로 데려간다.
   *
   * 🔴 제목은 걸린 구간을 선택한다. 서버가 준 위치는 **trim 한 제목** 기준이라
   *    화면 값의 앞 공백만큼 더한다 — 다시 찾지 않는다(찾으면 `지\s*랄` 처럼
   *    공백을 건너뛴 표현을 못 찾거나 엉뚱한 자리를 잡는다).
   *
   * 🔴 본문은 선택하지 않고 초점과 스크롤까지만 한다.
   *    서버가 검사하는 평문은 postContentToText(HTML) 이고 이 변환은 되돌릴 수 없다 —
   *    태그 제거·블록 태그의 공백 치환·엔티티 복원·trim 이 길이를 모두 바꾼다.
   *    그 좌표를 에디터 문서 위치로 옮기려면 변환의 역함수를 새로 써야 하는데,
   *    그건 저장될 HTML 을 건드리지 않고서는 확신할 수 없다. 지어내지 않는다.
   */
  useEffect(() => {
    if (!fieldError) return
    if (handledRef.current === fieldError) return
    handledRef.current = fieldError

    setError(fieldError)
    atErrorRef.current = { title, content }

    if (fieldError.field === 'title') {
      const input = titleRef.current
      if (!input) return
      /**
       * 🔴 초점만 준다. 화면을 옮기는 일은 안내(FieldErrorNotice)가 스스로 한다 —
       *    입력칸을 가운데 두면 그 아래 붙는 안내가 어디에 놓이는지 보장되지 않는다.
       *    preventScroll 로 초점이 화면을 먼저 끌어당기지 않게 막는다.
       */
      input.focus({ preventScroll: true })

      const lead = title.length - title.trimStart().length
      const start = typeof fieldError.start === 'number' ? fieldError.start + lead : null
      const end = typeof fieldError.end === 'number' ? fieldError.end + lead : null
      if (start !== null && end !== null && end <= input.value.length && start < end) {
        input.setSelectionRange(start, end)
      }
      return
    }

    /**
     * 🔴 본문 wrapper 를 가운데로 옮기지 않는다.
     *    본문 상자는 min-height 가 `max(240px,42svh)` 라, 그 상자를 가운데 두면
     *    아래 끝에 붙는 안내가 하단 고정 CTA 뒤로 밀린다.
     *    실측(2026-09-10 · 격리 프로필 · 키보드 열린 390×380):
     *      wrapper 를 center → 안내 top 401 / CTA top 316 → **가려짐**
     *      안내를 center     → 안내 top 163 / CTA top 316 → 보임
     *    그래서 화면 이동은 안내가 스스로 하고, 여기서는 초점만 준다.
     */
    setEditorFocusSignal((n) => n + 1)
    // title·content 는 "오류가 난 시점의 값" 으로만 쓴다. 값이 바뀔 때마다 다시 돌 이유가 없다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldError])

  /** 사람이 그 칸을 고치면 안내와 aria-invalid 를 함께 거둔다 */
  useEffect(() => {
    if (!error) return
    const at = atErrorRef.current
    if (!at) return
    const changed = error.field === 'title' ? title !== at.title : content !== at.content
    if (changed) {
      setError(null)
      atErrorRef.current = null
    }
  }, [title, content, error])

  return {
    error,
    titleErrorId: ids.title,
    contentErrorId: ids.content,
    titleRef,
    bodyRef,
    editorFocusSignal,
  }
}
