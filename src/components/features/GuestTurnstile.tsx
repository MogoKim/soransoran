'use client'

import { useEffect, useRef } from 'react'

/**
 * Cloudflare Turnstile 위젯.
 *
 * 🔴 토큰을 DOM 에 직접 쓰지 않는다. 부모의 state 로 올려 controlled hidden input 으로 낸다.
 *
 *    처음에는 `<input defaultValue="" ref>` 에 `ref.current.value = token` 으로 넣었는데,
 *    이름·비밀번호를 한 글자 칠 때마다 토큰이 사라졌다.
 *    React 는 리렌더마다 uncontrolled input 에 defaultValue 를 다시 적용하고,
 *    사용자가 직접 타이핑하지 않은 input 은 dirty 플래그가 서지 않아
 *    defaultValue 를 쓰는 순간 value 까지 ""  로 되돌아간다.
 *    그래서 화면에는 "성공!" 이 떠 있는데 서버는 빈 토큰을 받았다.
 *
 * 🔴 토큰은 1회용이다. 서버 응답을 받으면(성공이든 실패든) 위젯을 reset 한다.
 *    같은 토큰을 다시 보내면 Cloudflare 가 중복으로 거절한다 —
 *    실패 후 다시 누르면 영원히 안 되는 상태에 빠진다.
 *
 * 🔴 npm 패키지를 새로 넣지 않는다. 스크립트 한 줄이면 되는 일이다.
 */
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, options: Record<string, unknown>) => string
      remove: (id: string) => void
      reset: (id: string) => void
    }
  }
}

const SCRIPT_ID = 'cf-turnstile'
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'

/** 사이트 키가 없으면 위젯이 없다 — 로컬에서는 서버가 검증을 건너뛴다. */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY ?? ''

export default function GuestTurnstile({
  onToken,
  resetSignal,
}: {
  /** 챌린지를 통과하면 토큰, 만료·리셋되면 빈 문자열이 온다 */
  onToken: (token: string) => void
  /** 값이 바뀌면 위젯을 다시 푼다. 부모가 서버 응답을 받은 뒤 올린다. */
  resetSignal: number
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const widgetRef = useRef<string | null>(null)
  // 콜백이 최신 함수를 보게 한다 — 위젯은 한 번만 render 되므로 클로저가 고정된다
  const onTokenRef = useRef(onToken)
  onTokenRef.current = onToken

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return
    let cancelled = false

    function render() {
      if (cancelled || !boxRef.current || !window.turnstile || widgetRef.current) return
      widgetRef.current = window.turnstile.render(boxRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token: string) => onTokenRef.current(token),
        'expired-callback': () => onTokenRef.current(''),
        'error-callback': () => onTokenRef.current(''),
      })
    }

    if (window.turnstile) {
      render()
    } else {
      let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
      if (!script) {
        script = document.createElement('script')
        script.id = SCRIPT_ID
        script.src = SCRIPT_SRC
        script.async = true
        script.defer = true
        document.head.appendChild(script)
      }
      script.addEventListener('load', render)
    }

    return () => {
      cancelled = true
      if (widgetRef.current && window.turnstile) {
        window.turnstile.remove(widgetRef.current)
        widgetRef.current = null
      }
    }
  }, [])

  // 서버 응답 뒤 새 토큰을 받기 위해 위젯을 푼다. 첫 렌더(0)에서는 아무것도 하지 않는다.
  useEffect(() => {
    if (resetSignal === 0) return
    if (widgetRef.current && window.turnstile) {
      window.turnstile.reset(widgetRef.current)
      onTokenRef.current('')
    }
  }, [resetSignal])

  if (!TURNSTILE_SITE_KEY) return null
  return <div ref={boxRef} className="mt-2" />
}
