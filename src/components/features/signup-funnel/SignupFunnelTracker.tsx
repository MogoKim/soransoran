'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { SignupFunnelContentType } from '@/lib/signup-funnel'
import { createReachMachine, hasDomConflict, type ReachMachine } from '@/lib/signup-funnel-reach'
import { sendOncePerMount } from '@/lib/signup-funnel-send'

/**
 * 회원가입 전환 tracker — 상세 화면 mount 하나의 ① logged_out_view 와 ② prompt_reach.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §5 · §6-3 · §8-1 · §8-2 · §8-11.
 *
 * 🔴 서버가 수집 gate 가 열리고 로그인되지 않은 방문일 때만 이 컴포넌트를 그린다. 그 밖에는 client 조각 0.
 * 🔴 ①·② 는 같은 mount 메모리(ref guard)를 쓴다. rerender · React 개발 모드의 effect 재실행 · bfcache 복원은
 *    다시 보내지 않고, 새로고침·새 탭은 새 mount 다. storage · cookie 를 쓰지 않는다.
 * 🔴 도달 감지는 IntersectionObserver 하나다. scroll listener · interval 을 두지 않는다.
 *    DOM 변화(MutationObserver)와 초점 변화(focusin)는 1초 대기 중에만 지켜보고 대기가 끝나면 바로 뗀다.
 * 🔴 IntersectionObserver 가 없으면 ② 를 세지 않는다. 읽기는 그대로다.
 */

export type SignupFunnelMarkerKind = 'body-end' | 'content-end'

type TrackerApi = {
  register: (kind: SignupFunnelMarkerKind, el: Element | null) => void
  composeConflict: (open: boolean) => void
}

const TrackerContext = createContext<TrackerApi | null>(null)

/** 감지 지점이 쓰는 손잡이. tracker 밖이면 null — 감지 지점은 아무것도 그리지 않는다 */
export function useSignupFunnelTracker(): TrackerApi | null {
  return useContext(TrackerContext)
}

/** 대기 중 충돌이 생길 수 있는 DOM 변화 — 열림·닫힘을 나타내는 공개 속성만 본다 */
const WATCHED_ATTRIBUTES = ['aria-expanded', 'aria-modal', 'role', 'open']

export default function SignupFunnelTracker({
  contentType,
  children,
}: {
  contentType: SignupFunnelContentType
  children: ReactNode
}) {
  const viewGuard = useRef({ sent: false })
  const reachGuard = useRef({ sent: false })
  const markers = useRef<Partial<Record<SignupFunnelMarkerKind, Element>>>({})
  const observerRef = useRef<IntersectionObserver | null>(null)
  const machineRef = useRef<ReachMachine | null>(null)
  const composeOpen = useRef(false)

  // ① — mount 하나에 한 번
  useEffect(() => {
    sendOncePerMount(viewGuard.current, { step: 'logged_out_view', contentType, entryPoint: 'content_end' })
  }, [contentType])

  // ② — 감지 지점 관측과 1초 판정
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return

    let watcher: MutationObserver | null = null
    const onFocusChange = () => machine.domChanged()
    const machine = createReachMachine({
      requireBodyEnd: contentType === 'community',
      domConflict: () => hasDomConflict(document),
      onReach: () =>
        sendOncePerMount(reachGuard.current, { step: 'prompt_reach', contentType, entryPoint: 'content_end' }),
      onPendingChange: (pending) => {
        if (pending) {
          watcher = new MutationObserver(() => machine.domChanged())
          watcher.observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: WATCHED_ATTRIBUTES,
          })
          document.addEventListener('focusin', onFocusChange, true)
        } else {
          watcher?.disconnect()
          watcher = null
          document.removeEventListener('focusin', onFocusChange, true)
        }
      },
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (handle) => window.clearTimeout(handle as number),
    })
    machine.composeConflict(composeOpen.current)

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === markers.current['body-end']) {
          if (entry.isIntersecting) machine.bodyEndSeen()
        } else if (entry.target === markers.current['content-end']) {
          machine.contentEnd(entry.isIntersecting)
        }
      }
    })
    for (const el of Object.values(markers.current)) if (el) observer.observe(el)

    machineRef.current = machine
    observerRef.current = observer
    return () => {
      observer.disconnect()
      machine.dispose()
      machineRef.current = null
      observerRef.current = null
    }
  }, [contentType])

  const register = useCallback((kind: SignupFunnelMarkerKind, el: Element | null) => {
    const previous = markers.current[kind]
    if (previous && previous !== el) observerRef.current?.unobserve(previous)
    if (el) {
      markers.current[kind] = el
      observerRef.current?.observe(el)
    } else {
      delete markers.current[kind]
    }
  }, [])

  const composeConflict = useCallback((open: boolean) => {
    composeOpen.current = open
    machineRef.current?.composeConflict(open)
  }, [])

  const api = useMemo(() => ({ register, composeConflict }), [register, composeConflict])

  return <TrackerContext.Provider value={api}>{children}</TrackerContext.Provider>
}
