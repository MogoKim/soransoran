'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SignupFunnelContentType } from '@/lib/signup-funnel'
import { createReachMachine, hasDomConflict, type ReachMachine } from '@/lib/signup-funnel-reach'
import { sendOncePerMount } from '@/lib/signup-funnel-send'
import { claimPromptExposure, writeAuthMarker, type PromptStorage } from '@/lib/signup-prompt-storage'

/**
 * 회원가입 전환 tracker — 상세 화면 mount 하나의 ① logged_out_view · ② prompt_reach · 가입 제안(③ · ④).
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §5 · §6-3 · §8-1 · §8-2 · §8-11.
 *
 * 🔴 서버가 수집 gate 가 열리고 로그인되지 않은 방문일 때만 이 컴포넌트를 그린다. 그 밖에는 화면·계측 0.
 *    다만 이 파일은 상세 page 의 초기 번들에 늘 실린다(정적 import 라 렌더 여부와 무관). 그래서 무거운 dialog
 *    (카카오 버튼 · 인증 client 포함)는 정적으로 들이지 않고 ② 도달 뒤에만 비동기로 받는다.
 * 🔴 ①·② 는 같은 mount 메모리(ref guard)를 쓴다. rerender · React 개발 모드의 effect 재실행 · bfcache 복원은
 *    다시 보내지 않고, 새로고침·새 탭은 새 mount 다. storage · cookie 를 쓰지 않는다.
 * 🔴 도달 감지는 IntersectionObserver 하나다. scroll listener · interval 을 두지 않는다.
 *    DOM 변화(MutationObserver)와 초점 변화(focusin)는 1초 대기 중에만 지켜보고 대기가 끝나면 바로 뗀다.
 * 🔴 IntersectionObserver 가 없으면 ② 를 세지 않는다. 읽기는 그대로다.
 * 🔴 ② 는 24시간 제한과 무관하게, dialog 모듈 로드 성공 여부와도 무관하게 보낸다. 그다음 dialog 모듈을 받고,
 *    24시간 제한을 통과하고 노출 기록을 쓰고 다시 읽어 확인했을 때만 dialog 를 연다(정본 §7).
 *    한 mount 에서 로드 시도와 dialog 는 최대 한 번이다.
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

/** localStorage 를 쓸 수 없는 브라우저(접근 자체가 막힌 경우 포함)는 null — 노출하지 않는다 */
function browserStorage(): PromptStorage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

type PromptDialog = (typeof import('@/components/features/signup-funnel/SignupPromptDialog'))['default']

/**
 * 가입 제안 모듈을 받은 뒤에만 노출을 확정한다.
 *
 * 🔴 순서: 모듈 로드 → mount 확인 → 24시간 claim → 표시. 로드가 실패하면 claim 을 하지 않는다 —
 *    받지 못한 dialog 가 24시간 노출로 기록되면 보지 않은 제안을 본 것으로 센다.
 * 🔴 실패·예외는 여기서 끝난다. 돌려주는 Promise 는 거절되지 않는다(unhandled rejection 0).
 */
export function openPromptAfterLoad<T>(deps: {
  load: () => Promise<T>
  isMounted: () => boolean
  claim: () => boolean
  show: (dialog: T) => void
}): Promise<void> {
  return deps
    .load()
    .then((dialog) => {
      if (!deps.isMounted()) return
      if (deps.claim()) deps.show(dialog)
    })
    .catch(() => {})
}

export default function SignupFunnelTracker({
  contentType,
  children,
}: {
  contentType: SignupFunnelContentType
  children: ReactNode
}) {
  const viewGuard = useRef({ sent: false })
  const reachGuard = useRef({ sent: false })
  const impressionGuard = useRef({ sent: false })
  const authGuard = useRef({ sent: false })
  const promptTried = useRef(false)
  const mounted = useRef(false)
  // 함수 컴포넌트를 state 에 둔다 — set 할 때 updater 로 오인되지 않게 늘 () => dialog 로 넣는다
  const [ShownDialog, setShownDialog] = useState<PromptDialog | null>(null)
  const markers = useRef<Partial<Record<SignupFunnelMarkerKind, Element>>>({})
  const observerRef = useRef<IntersectionObserver | null>(null)
  const machineRef = useRef<ReachMachine | null>(null)
  const composeOpen = useRef(false)

  // 비동기 로드가 끝났을 때 이미 떠난 화면이면 state 를 건드리지 않는다
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

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
      onReach: () => {
        sendOncePerMount(reachGuard.current, { step: 'prompt_reach', contentType, entryPoint: 'content_end' })
        if (promptTried.current) return
        promptTried.current = true
        // 기다리지 않는다 — 읽기·스크롤은 로드와 무관하게 이어진다
        void openPromptAfterLoad({
          load: () => import('@/components/features/signup-funnel/SignupPromptDialog').then((mod) => mod.default),
          isMounted: () => mounted.current,
          claim: () => claimPromptExposure(browserStorage(), Date.now()),
          show: (dialog) => setShownDialog(() => dialog),
        })
      },
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

  return (
    <TrackerContext.Provider value={api}>
      {children}
      {ShownDialog ? (
        <ShownDialog
          contentType={contentType}
          onImpression={() =>
            sendOncePerMount(impressionGuard.current, { step: 'prompt_impression', contentType, entryPoint: 'content_end' })
          }
          onAuthStart={() => {
            writeAuthMarker(browserStorage(), contentType, Date.now())
            sendOncePerMount(authGuard.current, { step: 'auth_start', contentType, entryPoint: 'content_end' })
          }}
          onClosed={() => setShownDialog(null)}
        />
      ) : null}
    </TrackerContext.Provider>
  )
}
