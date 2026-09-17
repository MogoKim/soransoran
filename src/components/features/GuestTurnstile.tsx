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
 *
 * 🔴 평소에는 보이지 않는다(appearance: interaction-only).
 *    예전에는 폼을 열자마자 회색 확인 상자가 자리를 차지했다. 댓글 한 줄 남기려던
 *    사람에게 가장 먼저 보이는 것이 "당신이 사람인지 확인합니다" 였다.
 *    **검사를 끄는 것이 아니다** — 서버의 verifyTurnstile 은 그대로다.
 *    수상할 때만 상자가 나타나고, 그때는 사용자가 정상적으로 풀 수 있어야 한다.
 *
 * 🔴 size 를 compact 로 줄이지 않는다. 40대 중반~60대 중반이 쓰는 서비스라
 *    막상 풀어야 할 때 작은 상자를 주면 그 자리에서 포기한다.
 *    평소 보이지 않으니 큰 상자를 두어도 화면을 차지하지 않는다.
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
  onInteractiveChange,
  onChallengeTimeout,
}: {
  /** 챌린지를 통과하면 토큰, 만료·리셋되면 빈 문자열이 온다 */
  onToken: (token: string) => void
  /** 값이 바뀌면 위젯을 다시 푼다. 부모가 서버 응답을 받은 뒤 올린다. */
  resetSignal: number
  /**
   * 대화형 확인이 화면에 떠 있는지 알린다.
   *
   * 🔴 이 구간에는 **사람이 움직여야** 끝난다. 부모가 이것을 모르면
   *    푸는 중인 사람을 기계가 응답하지 않는 것으로 보고 위젯을 초기화한다.
   */
  onInteractiveChange?: (active: boolean) => void
  /** 대화형 확인을 주어진 시간 안에 풀지 못했다고 Cloudflare 가 알려 줄 때 */
  onChallengeTimeout?: () => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const widgetRef = useRef<string | null>(null)
  // 콜백이 최신 함수를 보게 한다 — 위젯은 한 번만 render 되므로 클로저가 고정된다
  const onTokenRef = useRef(onToken)
  onTokenRef.current = onToken
  const onInteractiveRef = useRef(onInteractiveChange)
  onInteractiveRef.current = onInteractiveChange
  const onChallengeTimeoutRef = useRef(onChallengeTimeout)
  onChallengeTimeoutRef.current = onChallengeTimeout

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return
    let cancelled = false

    function render() {
      if (cancelled || !boxRef.current || !window.turnstile || widgetRef.current) return
      widgetRef.current = window.turnstile.render(boxRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        // 챌린지가 필요할 때만 모습을 드러낸다
        appearance: 'interaction-only',
        callback: (token: string) => {
          onInteractiveRef.current?.(false)
          onTokenRef.current(token)
        },
        'expired-callback': () => onTokenRef.current(''),
        'error-callback': () => {
          onInteractiveRef.current?.(false)
          onTokenRef.current('')
        },
        /**
         * 🔴 여기부터 사람이 푼다. 부모는 이 신호를 받아 자기 시계를 멈춘다.
         *    (공식 문서: before-interactive-callback 은 챌린지가 대화형으로 들어가기 전에 불린다)
         */
        'before-interactive-callback': () => onInteractiveRef.current?.(true),
        'after-interactive-callback': () => onInteractiveRef.current?.(false),
        /**
         * 🔴 만료(expired)와 따로 둔다. 이쪽은 **띄워 놓은 확인을 제한 시간 안에 풀지 못한** 경우라
         *    토큰이 있었던 적이 없다. 끝을 재는 것은 Cloudflare 이고, 우리는 그 결과만 받는다.
         * 🔴 여기서 reset 하지 않는다 — refresh-timeout 기본값 auto 가 위젯을 알아서 새로 띄운다.
         */
        'timeout-callback': () => {
          onInteractiveRef.current?.(false)
          onTokenRef.current('')
          onChallengeTimeoutRef.current?.()
        },
        /** 지원하지 않는 브라우저 — 토큰이 올 일이 없으니 기다림을 끝내게 한다 */
        'unsupported-callback': () => {
          onInteractiveRef.current?.(false)
          onTokenRef.current('')
          onChallengeTimeoutRef.current?.()
        },
      })
    }

    /**
     * 🔴 리스너를 건 **그 script 요소**를 기억한다.
     *    cleanup 에서 다시 getElementById 로 찾아 떼면, 그 사이에 누가 요소를 갈아 끼웠을 때
     *    엉뚱한 요소에서 떼려다 아무것도 떼지 못한다. 건 것과 떼는 것이 같아야 한다.
     */
    let listeningScript: HTMLScriptElement | null = null

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
      listeningScript = script
    }

    return () => {
      cancelled = true
      /**
       * 🔴 load 리스너를 반드시 뗀다.
       *    script 요소는 <head> 에 한 번 붙으면 화면을 옮겨 다녀도 살아남는다.
       *    떼지 않으면 글을 열 때마다 같은 요소에 render 가 한 겹씩 쌓인다.
       *    cancelled 가 있어 하는 일은 없지만, 하는 일이 없는 리스너가 쌓이는 것은
       *    "동작에 문제가 없다" 와 다른 이야기다.
       */
      listeningScript?.removeEventListener('load', render)
      listeningScript = null
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
      onInteractiveRef.current?.(false)
      onTokenRef.current('')
    }
  }, [resetSignal])

  if (!TURNSTILE_SITE_KEY) return null
  /* 🔴 높이를 고정하거나 overflow 를 숨기지 않는다. 평소에는 0 높이로 접혀 있다가
        챌린지가 뜨면 그만큼 밀어내야 상자가 잘리지 않는다. */
  return <div ref={boxRef} className="empty:hidden mt-2" />
}
