'use client'

import { useEffect } from 'react'
import { useToast } from '@/components/ui/toast'
import type { SignupFunnelContentType } from '@/lib/signup-funnel'
import { consumeSignupReturn } from '@/lib/signup-return'

/**
 * 가입 제안 인증 왕복에서 돌아온 순간의 처리 — 고정 fragment 를 한 번 소비한다. 아무것도 그리지 않는다.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §6-5.
 *
 * 🔴 수집 gate · 로그인 여부와 무관하게 상세 화면에 늘 있다. 가입을 마친 사람은 로그인 상태로 돌아온다.
 * 🔴 성공: 복귀 위치로 옮기고 fragment 를 지운다. 새 문구는 없다.
 *    실패: 같은 위치로 옮기고 확정 문구 Toast 를 한 번 보인 뒤 fragment 를 지운다.
 * 🔴 fragment 는 replaceState 로 지운다 — reload 도, history 한 칸 추가도 없다. 지운 뒤라 같은 fragment 를
 *    두 번 소비하지 않는다(effect 재실행 · pageshow 복원 포함).
 * 🔴 우리 네 값이 아닌 fragment 는 건드리지 않는다.
 */
export default function SignupReturnHandler({ contentType }: { contentType: SignupFunnelContentType }) {
  const toast = useToast()

  useEffect(() => {
    const consume = () =>
      consumeSignupReturn(
        {
          hash: window.location.hash,
          pathname: window.location.pathname,
          search: window.location.search,
          historyState: window.history.state,
          replaceState: (state, url) => window.history.replaceState(state, '', url),
          scrollToAnchor: (id) => document.getElementById(id)?.scrollIntoView({ block: 'start' }),
          notifyFailed: (message) => toast.info(message, { key: 'signup-auth-failed' }),
        },
        contentType,
      )
    consume()
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) consume()
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [contentType, toast])

  return null
}
