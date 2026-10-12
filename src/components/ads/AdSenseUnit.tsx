'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * AdSense 광고 한 칸 — 켜진 슬롯이 실제로 그려졌을 때만 Google script 를 한 번 불러온다.
 * 정책: S-MON 정본(docs/operations/MONETIZATION-CANON.md) §5 · §6 · §7 · §13.
 *
 * 🔴 Auto Ads 를 켜는 설정을 넣지 않는다. 이 칸 하나에만 광고를 요청한다.
 * 🔴 비맞춤형 광고(NPA) 신호를 script 를 붙이기 전에, 따라서 첫 광고 요청 전에 설정한다.
 *    NPA 는 CMP·동의 의무를 대신하지 않는다(정본 §7).
 * 🔴 script 는 칸이 화면 근처에 왔을 때 붙인다. 첫 화면·hero 의 로딩과 경쟁하지 않는다.
 * 🔴 실패는 이 칸 안에서 끝난다. 미충전(`data-ad-status="unfilled"`) · script 차단·실패 · push 오류면
 *    칸을 통째로 접는다. 예외를 밖으로 던지지 않는다.
 * 🔴 공간은 고정 높이로 미리 잡는다. 칸이 페이지 맨 아래라 접혀도 밀리는 것은 footer 뿐이다.
 */

type AdsByGoogleQueue = Array<Record<string, never>> & { requestNonPersonalizedAds?: 0 | 1 }

declare global {
  interface Window {
    adsbygoogle?: AdsByGoogleQueue
  }
}

const SCRIPT_URL = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js'

/** 페이지 하나에 script 는 하나다. 실패도 다시 시도하지 않는다 — 막힌 곳에 요청을 반복하지 않는다 */
let scriptLoad: Promise<void> | null = null

function adsQueue(): AdsByGoogleQueue {
  window.adsbygoogle = window.adsbygoogle ?? ([] as unknown as AdsByGoogleQueue)
  return window.adsbygoogle
}

function loadAdSenseScript(clientId: string): Promise<void> {
  if (scriptLoad) return scriptLoad
  scriptLoad = new Promise<void>((resolve, reject) => {
    adsQueue().requestNonPersonalizedAds = 1
    const script = document.createElement('script')
    script.async = true
    script.crossOrigin = 'anonymous'
    script.src = `${SCRIPT_URL}?client=${encodeURIComponent(clientId)}`
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('adsense script failed'))
    document.head.appendChild(script)
  })
  return scriptLoad
}

export default function AdSenseUnit({ clientId, unitId }: { clientId: string; unitId: string }) {
  const boxRef = useRef<HTMLElement>(null)
  const insRef = useRef<HTMLModElement>(null)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const box = boxRef.current
    const ins = insRef.current
    if (!box || !ins) return
    let alive = true
    const collapse = () => {
      if (alive) setCollapsed(true)
    }

    const statusWatch = new MutationObserver(() => {
      if (ins.getAttribute('data-ad-status') === 'unfilled') collapse()
    })
    statusWatch.observe(ins, { attributes: true, attributeFilter: ['data-ad-status'] })

    const request = () => {
      loadAdSenseScript(clientId)
        .then(() => {
          if (!alive || ins.hasAttribute('data-adsbygoogle-status')) return
          try {
            adsQueue().push({})
          } catch {
            collapse()
          }
        })
        .catch(collapse)
    }

    const nearView = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        nearView.disconnect()
        request()
      },
      { rootMargin: '400px 0px' },
    )
    nearView.observe(box)

    return () => {
      alive = false
      nearView.disconnect()
      statusWatch.disconnect()
    }
  }, [clientId, unitId])

  if (collapsed) return null

  return (
    <aside ref={boxRef} aria-label="광고" className="mx-4 mt-6">
      <p className="m-0 mb-1 text-sm text-content-muted">광고</p>
      <ins
        ref={insRef}
        className="adsbygoogle block h-[250px] w-full overflow-hidden"
        data-ad-client={clientId}
        data-ad-slot={unitId}
      />
    </aside>
  )
}
