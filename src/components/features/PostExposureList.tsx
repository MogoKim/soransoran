'use client'

import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import {
  POST_EXPOSURE_BATCH_MAX,
  POST_EXPOSURE_WINDOW_MS,
  type PostExposureListSurface,
} from '@/lib/post-exposure-contract'

const MIN_VISIBLE_RATIO = 0.5
const MIN_VISIBLE_MS = 1_000
const FLUSH_DELAY_MS = 100
const SESSION_PREFIX = 'soransoran:list-exposure:'

const pending = new Map<PostExposureListSurface, Set<string>>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

function recentlySent(postId: string, now: number): boolean {
  try {
    const value = Number(window.sessionStorage.getItem(`${SESSION_PREFIX}${postId}`))
    return Number.isFinite(value) && now - value < POST_EXPOSURE_WINDOW_MS
  } catch {
    return false
  }
}

function markSent(postId: string, now: number): void {
  try {
    window.sessionStorage.setItem(`${SESSION_PREFIX}${postId}`, String(now))
  } catch {
    // 서버 원장 unique가 최종 중복 제거를 맡는다.
  }
}

function flush(): void {
  flushTimer = null
  for (const [surface, ids] of pending) {
    pending.delete(surface)
    const all = [...ids]
    for (let at = 0; at < all.length; at += POST_EXPOSURE_BATCH_MAX) {
      const postIds = all.slice(at, at + POST_EXPOSURE_BATCH_MAX)
      void fetch('/api/view', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ surface, postIds }),
        credentials: 'same-origin',
        keepalive: true,
      }).catch(() => {})
    }
  }
}

function enqueue(surface: PostExposureListSurface, postId: string): void {
  const ids = pending.get(surface) ?? new Set<string>()
  ids.add(postId)
  pending.set(surface, ids)
  if (flushTimer === null) flushTimer = setTimeout(flush, FLUSH_DELAY_MS)
}

export default function PostExposureList({
  as,
  surface,
  className,
  children,
}: {
  as: 'ol' | 'ul'
  surface: PostExposureListSurface
  className?: string
  children: ReactNode
}) {
  const rootRef = useRef<HTMLOListElement | HTMLUListElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return

    const timers = new Map<Element, ReturnType<typeof setTimeout>>()
    const elements = [...root.querySelectorAll('[data-post-exposure-id]')]
    const clearTimers = () => {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const existing = timers.get(entry.target)
        if (document.visibilityState !== 'visible'
          || !entry.isIntersecting
          || entry.intersectionRatio < MIN_VISIBLE_RATIO) {
          if (existing !== undefined) clearTimeout(existing)
          timers.delete(entry.target)
          continue
        }
        if (existing !== undefined) continue

        const postId = entry.target.getAttribute('data-post-exposure-id')?.trim() ?? ''
        if (!postId || recentlySent(postId, Date.now())) {
          observer.unobserve(entry.target)
          continue
        }
        timers.set(entry.target, setTimeout(() => {
          timers.delete(entry.target)
          markSent(postId, Date.now())
          enqueue(surface, postId)
          observer.unobserve(entry.target)
        }, MIN_VISIBLE_MS))
      }
    }, { threshold: [MIN_VISIBLE_RATIO] })

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        clearTimers()
        return
      }
      for (const element of elements) {
        observer.unobserve(element)
        observer.observe(element)
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    for (const element of elements) observer.observe(element)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      observer.disconnect()
      clearTimers()
    }
  }, [surface])

  return as === 'ol'
    ? <ol ref={rootRef as RefObject<HTMLOListElement>} className={className}>{children}</ol>
    : <ul ref={rootRef as RefObject<HTMLUListElement>} className={className}>{children}</ul>
}
