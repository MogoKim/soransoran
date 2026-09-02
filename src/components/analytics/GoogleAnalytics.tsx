'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

const GA_MEASUREMENT_ID = 'G-PW9HHV2LLL'
const TRACKED_HOSTS = new Set(['soransoran.com', 'www.soransoran.com'])

type GtagFields = {
  page_path?: string
  send_page_view?: boolean
}

type GtagArgs = ['js', Date] | ['config', string, GtagFields]

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
  window.gtag = (...args: GtagArgs) => {
    window.dataLayer?.push(args)
  }

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
    window.gtag?.('config', GA_MEASUREMENT_ID, {
      page_path: `${pathname}${window.location.search}`,
    })
  }, [pathname])

  return null
}
