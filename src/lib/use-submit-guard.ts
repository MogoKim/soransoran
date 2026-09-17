'use client'

import { useCallback, useEffect, useRef } from 'react'
import type { FormEvent } from 'react'

/**
 * 같은 폼을 두 번 보내지 못하게 막는다.
 *
 * 🔴 state 로 막으면 뚫린다. 빠르게 두 번 누르면 두 번째 submit 이 **같은 tick** 에 들어오는데,
 *    그때 React 는 아직 다시 그리지 않았다 — onSubmit 도 버튼의 disabled 도 옛 값을 본다.
 *    격리 DB 검증(2026-09-17)에서 비회원 폼은 3연타에 댓글 3개,
 *    회원 폼도 3연타에 3개가 들어갔다. 막는 판단은 반드시 ref 로 해야 한다.
 *
 * 🔴 푸는 것은 **서버 응답**이다. 타이머로 풀면 느린 회선에서 두 번 등록된다.
 *    useFormState 는 결과마다 새 객체를 주므로, 그 객체가 바뀌는 것이 곧 "돌아왔다" 이다.
 *
 * 🔴 useFormStatus 를 대신하지 않는다. 그쪽은 버튼을 흐리게 만들어 **보여 주는** 일을 하고,
 *    이쪽은 실제로 **막는** 일을 한다. 보이는 것과 막는 것을 한 값에 맡기지 않는다.
 */
export function useSubmitGuard<S>(state: S) {
  const inFlightRef = useRef(false)

  useEffect(() => {
    inFlightRef.current = false
  }, [state])

  /** 진행 중이면 이번 제출을 막고 false 를 돌려준다 */
  const guardSubmit = useCallback((event: FormEvent<HTMLFormElement>): boolean => {
    if (inFlightRef.current) {
      event.preventDefault()
      return false
    }
    inFlightRef.current = true
    return true
  }, [])

  /**
   * 잠금을 스스로 푼다.
   * 서버까지 가지 못하고 끝났을 때(사람 인증 대기 실패 등)와,
   * 폼이 스스로 다시 제출할 때 쓴다 — 그 제출은 새 제출로 다시 막혀야 한다.
   */
  const releaseSubmit = useCallback(() => {
    inFlightRef.current = false
  }, [])

  return { guardSubmit, releaseSubmit }
}
