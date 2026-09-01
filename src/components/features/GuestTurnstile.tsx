'use client'

import { useEffect, useRef } from 'react'

/**
 * Cloudflare Turnstile 위젯.
 *
 * 🔴 npm 패키지를 새로 넣지 않는다. 스크립트 한 줄이면 되는 일에 의존성을 늘리지 않는다.
 *
 * 🔴 토큰은 hidden input 으로 넘긴다.
 *    react-dom 18 + useFormState 에서는 폼 밖 값이나 submitter 의 name·value 가
 *    FormData 에 담기지 않는다(홈 노출 폼에서 실제로 겪었다).
 *
 * 🔴 사이트 키가 없으면 위젯을 그리지 않는다. 로컬에서는 서버가 통과시키므로
 *    빈 토큰이어도 등록이 된다. production 은 서버가 막는다.
 */
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, options: Record<string, unknown>) => string
      remove: (id: string) => void
    }
  }
}

const SCRIPT_ID = 'cf-turnstile'
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'

export default function GuestTurnstile({ name = 'turnstileToken' }: { name?: string }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const widgetRef = useRef<string | null>(null)
  const siteKey = process.env.NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY

  useEffect(() => {
    if (!siteKey) return

    let cancelled = false

    function render() {
      if (cancelled || !boxRef.current || !window.turnstile || widgetRef.current) return
      widgetRef.current = window.turnstile.render(boxRef.current, {
        sitekey: siteKey,
        callback: (token: string) => {
          if (inputRef.current) inputRef.current.value = token
        },
        'expired-callback': () => {
          if (inputRef.current) inputRef.current.value = ''
        },
      })
    }

    if (window.turnstile) {
      render()
    } else if (!document.getElementById(SCRIPT_ID)) {
      const script = document.createElement('script')
      script.id = SCRIPT_ID
      script.src = SCRIPT_SRC
      script.async = true
      script.defer = true
      script.onload = render
      document.head.appendChild(script)
    } else {
      document.getElementById(SCRIPT_ID)?.addEventListener('load', render)
    }

    return () => {
      cancelled = true
      if (widgetRef.current && window.turnstile) {
        window.turnstile.remove(widgetRef.current)
        widgetRef.current = null
      }
    }
  }, [siteKey])

  return (
    <>
      <input ref={inputRef} type="hidden" name={name} defaultValue="" />
      {siteKey ? <div ref={boxRef} className="mt-2" /> : null}
    </>
  )
}
