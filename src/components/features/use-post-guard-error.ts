'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { checkPostContent, type PostGuardBlock } from '@/lib/post-guard-check'

/**
 * 콘텐츠 가드에 걸린 칸을 화면에서 다루는 한 곳.
 *
 * ── 상태 모델 ──
 *   ① 처음 쓰는 동안        길이 조건만 안내한다. 아직 아무것도 재지 않는다 —
 *                          두 글자 치자마자 "그 말은 쓸 수 없어요" 가 뜨면 훈수가 된다.
 *   ② 등록을 누른 순간      제목 → 본문 순서로 잰다(서버와 같은 함수).
 *                          걸리면 **서버 액션·임시저장 로그인 안내·GA4 전송을 전부 멈추고**
 *                          그 칸에 정확한 이유를 띄운다.
 *   ③ 한 번 걸린 뒤         입력이 바뀔 때마다 다시 잰다.
 *                          남아 있으면 오류와 잠긴 버튼을 **유지**하고,
 *                          첫 표현을 지웠는데 다른 게 남았으면 **다음 문제**를 말한다.
 *   ④ 정말 다 없어졌을 때만 오류·aria-invalid 를 거두고 버튼을 연다.
 *
 * 🔴 화면 검사가 서버를 대신하지 않는다.
 *    저장을 막는 최종 판정은 서버(actions/posts.ts)다. 여기서 재는 것은
 *    "다녀오지 않아도 아는 것을 미리 말해 주는" 편의다. 주소로 액션을 직접 부르면
 *    이 화면을 지나지 않으므로 서버가 다시 잰다.
 *
 * 🔴 두 화면(새 글·고치기)이 같은 훅을 쓴다.
 *    각자 적으면 언젠가 한쪽만 고쳐진다 — 실제로 "새 글은 제목이라고 말하는데
 *    고치기는 안 말하는" 상태가 되기 쉽다.
 *
 * 🔴 입력값을 건드리지 않는다. 지우지도, 치환하지도, 검열 문자로 덮지도 않는다.
 */

export type PostGuardErrorApi = {
  /** 지금 화면에 띄울 오류. 없으면 null */
  error: PostGuardBlock | null
  /** 콘텐츠 가드 때문에 등록을 막아야 하는가 — 상단·하단 CTA 가 **같은 값**을 본다 */
  blocked: boolean
  /**
   * 등록을 누른 자리에서 부른다. 막을 것이 있으면 그것을 돌려주고 화면에 띄운다.
   * 🔴 form action 첫머리에서도 부른다 — requestSubmit()·제목칸 Enter 우회를 같은 문으로 막는다.
   */
  runBeforeSubmit: () => PostGuardBlock | null
  titleErrorId: string
  contentErrorId: string
  titleRef: React.RefObject<HTMLInputElement>
  /** 값이 바뀔 때마다 PostEditor 가 본문에 초점을 준다 */
  editorFocusSignal: number
}

export function usePostGuardError({
  serverFieldError,
  title,
  text,
}: {
  /** 서버가 돌려준 필드 오류 (최종 권위자) */
  serverFieldError: PostGuardBlock | undefined
  title: string
  /** 본문 평문. 부모가 에디터에서 받아 들고 있는 값이다 */
  text: string
}): PostGuardErrorApi {
  /**
   * 🔴 useId 를 쓴다. 한때 모듈 전역 카운터로 id 를 만들었는데,
   *    서버와 브라우저가 세는 순서가 같다는 보장이 없어 hydration 에서 어긋날 수 있다.
   *    React 가 같은 트리 위치에 같은 id 를 주는 쪽이 안전하다.
   */
  const uid = useId()
  const titleErrorId = `post-title-error-${uid}`
  const contentErrorId = `post-content-error-${uid}`

  /** 한 번이라도 등록을 눌렀는가. 그 전에는 재지 않는다 */
  const [attempted, setAttempted] = useState(false)
  const [editorFocusSignal, setEditorFocusSignal] = useState(0)
  const titleRef = useRef<HTMLInputElement>(null)

  /**
   * 서버가 막았을 때의 답과 그때의 입력.
   *
   * 🔴 입력이 그대로면 서버 답을 그대로 띄운다. 화면 검사가 통과시키더라도 그렇다 —
   *    서버가 보는 본문 평문(postContentToText)과 에디터가 주는 글자는 완전히 같지 않다.
   *    두 답이 갈릴 때 이기는 쪽은 서버다.
   */
  const [serverSnapshot, setServerSnapshot] = useState<
    { block: PostGuardBlock; title: string; text: string } | null
  >(null)
  const handledRef = useRef<PostGuardBlock | null>(null)

  /** 걸린 칸으로 데려간다. 화면 이동은 안내가 스스로 하므로 여기서는 초점만 준다 */
  const focusField = useCallback(
    (block: PostGuardBlock, currentTitle: string) => {
      if (block.field === 'title') {
        const input = titleRef.current
        if (!input) return
        input.focus({ preventScroll: true })

        // 🔴 서버가 준 위치는 trim 한 제목 기준이다. 화면 값의 앞 공백만큼 더한다 —
        //    다시 찾지 않는다(`지\s*랄` 처럼 공백을 건너뛴 표현은 다시 못 찾는다).
        const lead = currentTitle.length - currentTitle.trimStart().length
        const start = typeof block.start === 'number' ? block.start + lead : null
        const end = typeof block.end === 'number' ? block.end + lead : null
        if (start !== null && end !== null && start < end && end <= input.value.length) {
          input.setSelectionRange(start, end)
        }
        return
      }
      setEditorFocusSignal((n) => n + 1)
    },
    [],
  )

  /** 서버가 막아 세우면 그 답을 붙잡고, 이후로는 입력이 바뀔 때마다 다시 잰다 */
  useEffect(() => {
    if (!serverFieldError) return
    if (handledRef.current === serverFieldError) return
    handledRef.current = serverFieldError

    setAttempted(true)
    setServerSnapshot({ block: serverFieldError, title, text })
    focusField(serverFieldError, title)
    // title·text 는 "그때의 값" 으로만 쓴다. 값이 바뀔 때마다 다시 돌 이유가 없다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverFieldError])

  /**
   * 지금 값 기준으로 다시 잰 결과.
   *
   * 🔴 attempted 이후에는 렌더마다 잰다. 정규식 몇 개라 비용이 작고,
   *    "고쳤는데도 버튼이 잠겨 있다" 를 만들지 않으려면 값과 판정이 같은 렌더에 있어야 한다.
   */
  const liveBlock = attempted ? checkPostContent({ title, text }) : null

  const serverFresh =
    serverSnapshot !== null && serverSnapshot.title === title && serverSnapshot.text === text

  const error = liveBlock ?? (serverFresh ? serverSnapshot.block : null)

  const runBeforeSubmit = useCallback(() => {
    setAttempted(true)
    const block = checkPostContent({ title, text })
    if (block) focusField(block, title)
    return block
  }, [title, text, focusField])

  return {
    error,
    blocked: error !== null,
    runBeforeSubmit,
    titleErrorId,
    contentErrorId,
    titleRef,
    editorFocusSignal,
  }
}
