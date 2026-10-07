'use client'

import { useEffect, useRef } from 'react'
import type { SignupFunnelContentType } from '@/lib/signup-funnel'
import { sendOncePerMount } from '@/lib/signup-funnel-send'

/**
 * 회원가입 전환 ① logged_out_view — 화면이 실제로 mount 된 뒤 한 번만 알린다. 아무것도 그리지 않는다.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §8-2.
 *
 * 🔴 guard 는 ref 다. 같은 mount 의 rerender 와 React 개발 모드의 effect 재실행은 같은 ref 를 보므로
 *    다시 보내지 않는다. bfcache 복원은 mount 가 아니라 effect 가 돌지 않는다.
 * 🔴 storage · timer · 전역 listener 를 두지 않는다.
 */
export default function LoggedOutViewBeacon({ contentType }: { contentType: SignupFunnelContentType }) {
  const guard = useRef({ sent: false })

  useEffect(() => {
    sendOncePerMount(guard.current, { step: 'logged_out_view', contentType, entryPoint: 'content_end' })
  }, [contentType])

  return null
}
