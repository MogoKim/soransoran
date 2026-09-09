'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

const GA_MEASUREMENT_ID = 'G-PW9HHV2LLL'
const TRACKED_HOSTS = new Set(['soransoran.com', 'www.soransoran.com'])

type GtagFields = {
  page_path?: string
  page_location?: string
  page_title?: string
  send_page_view?: boolean
  send_to?: string
}

type GtagArgs =
  | ['js', Date]
  | ['config', string, GtagFields]
  | ['event', 'page_view', GtagFields]

declare global {
  interface Window {
    dataLayer?: GtagArgs[]
    gtag?: (...args: GtagArgs) => void
    __soranGa4Loaded?: boolean
  }
}

function shouldTrack() {
  return typeof window !== 'undefined' && TRACKED_HOSTS.has(window.location.hostname)
}

function ensureGoogleTag() {
  if (window.__soranGa4Loaded) return

  window.dataLayer = window.dataLayer ?? []

  /* 🔴 화살표 함수 + rest 파라미터로 쓰지 않는다. 이건 취향이 아니라 동작 조건이다.
     rest 파라미터는 **배열**이 되는데, gtag.js 는 dataLayer 에 쌓인 항목이
     **arguments 객체**일 때만 gtag 커맨드로 인식한다. 배열은 조용히 무시된다 —
     오류도 경고도 없다.

     실측(2026-09-09): 같은 페이지에서 커맨드만 같고 push 방식만 다르게 두면
       dataLayer.push(배열)      → /g/collect 0건
       dataLayer.push(arguments) → /g/collect 1건
     태그가 정상 로드되고 dataLayer 에 항목이 쌓이는데도 GA 실시간이 계속 0 이던
     원인이 이것이다. config 를 쓰든 event page_view 를 쓰든 여기서 갈린다.

     그래서 Google 표준 스니펫(function gtag(){dataLayer.push(arguments)})을
     그대로 따른다. arguments 는 화살표 함수에 없으므로 function 표현식이어야 한다. */
  const gtag = function () {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer?.push(arguments as unknown as GtagArgs)
  } as (...args: GtagArgs) => void
  window.gtag = gtag

  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`
  document.head.appendChild(script)

  window.gtag('js', new Date())
  window.gtag('config', GA_MEASUREMENT_ID, { send_page_view: false })
  window.__soranGa4Loaded = true
}

export default function GoogleAnalytics() {
  const pathname = usePathname()

  useEffect(() => {
    if (pathname.startsWith('/admin')) return
    if (!shouldTrack()) return

    ensureGoogleTag()
    window.gtag?.('event', 'page_view', {
      send_to: GA_MEASUREMENT_ID,
      page_path: `${pathname}${window.location.search}`,
      page_location: window.location.href,
      page_title: document.title,
    })
  }, [pathname])

  return null
}
