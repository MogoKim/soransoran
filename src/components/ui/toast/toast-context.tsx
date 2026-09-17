'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  TOAST_DUPLICATE_WINDOW_MS,
  TOAST_DURATION,
  TOAST_MAX,
  type ToastVariant,
} from '@/components/ui/toast/toast-tokens'

/**
 * 🔴 이 파일은 스타일을 모른다. 어떤 색인지·어디에 뜨는지는 viewport 와 item 이 진다.
 *    여기가 하는 일은 "무엇을 얼마나 들고 있을지" 뿐이다.
 */

export type ToastRecord = {
  id: number
  variant: ToastVariant
  message: string
  duration: number
  /** 같은 key 로 다시 부르면 새로 쌓지 않고 그 자리를 바꾼다 */
  key?: string
  /** key 교체로 내용이 바뀌었음을 item 에 알린다 — 머무는 시간이 다시 시작된다 */
  seq: number
}

export type ToastOptions = {
  /** 같은 자리를 재사용할 이름. 연타·재제출이 여러 줄로 쌓이는 것을 막는다 */
  key?: string
  /** ms. 0 이면 자동으로 닫히지 않는다 */
  duration?: number
}

type ToastApi = {
  success: (message: string, options?: ToastOptions) => void
  error: (message: string, options?: ToastOptions) => void
  warning: (message: string, options?: ToastOptions) => void
  info: (message: string, options?: ToastOptions) => void
  /** id 를 주면 그것만, 없으면 전부 닫는다 */
  dismiss: (id?: number) => void
}

type ToastState = ToastApi & { items: ToastRecord[] }

/**
 * 🔴 기본값을 no-op 으로 둔다. ComposeModeProvider 처럼 throw 하지 않는다.
 *    안내가 없다고 기능이 멈추면 안 된다 — PageShell 밖(글쓰기·로그인)에서
 *    같은 컴포넌트가 쓰일 수 있고, 그때는 조용히 아무 일도 일어나지 않는 편이 맞다.
 */
const noop = () => {}
const ToastContext = createContext<ToastState>({
  items: [],
  success: noop,
  error: noop,
  warning: noop,
  info: noop,
  dismiss: noop,
})

export default function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastRecord[]>([])
  const nextId = useRef(1)
  /** 직전에 같은 문구를 언제 띄웠는지 — 연타를 거르는 자리 */
  const lastPush = useRef<{ signature: string; at: number } | null>(null)

  const push = useCallback((variant: ToastVariant, message: string, options?: ToastOptions) => {
    const text = message.trim()
    if (text === '') return

    /* 같은 문구가 곧바로 다시 오면 버린다. key 가 있으면 교체 규칙이 따로 있으므로 건너뛴다 */
    if (options?.key === undefined) {
      const signature = `${variant}:${text}`
      const now = Date.now()
      const last = lastPush.current
      if (last !== null && last.signature === signature && now - last.at < TOAST_DUPLICATE_WINDOW_MS) {
        return
      }
      lastPush.current = { signature, at: now }
    }

    const duration = options?.duration ?? TOAST_DURATION[variant]

    setItems((prev) => {
      if (options?.key !== undefined) {
        const index = prev.findIndex((item) => item.key === options.key)
        if (index >= 0) {
          const next = [...prev]
          /* 자리를 지키고 내용만 바꾼다 — seq 가 올라가면 머무는 시간이 다시 시작된다 */
          next[index] = { ...next[index], variant, message: text, duration, seq: next[index].seq + 1 }
          return next
        }
      }

      const added: ToastRecord = {
        id: nextId.current++,
        variant,
        message: text,
        duration,
        key: options?.key,
        seq: 0,
      }
      const merged = [...prev, added]
      /* 넘치면 오래된 것부터 버린다 — 방금 한 일이 화면에 남아야 한다 */
      return merged.length > TOAST_MAX ? merged.slice(merged.length - TOAST_MAX) : merged
    })
  }, [])

  const dismiss = useCallback((id?: number) => {
    setItems((prev) => (id === undefined ? [] : prev.filter((item) => item.id !== id)))
  }, [])

  const value = useMemo<ToastState>(
    () => ({
      items,
      dismiss,
      success: (message, options) => push('success', message, options),
      error: (message, options) => push('error', message, options),
      warning: (message, options) => push('warning', message, options),
      info: (message, options) => push('info', message, options),
    }),
    [items, push, dismiss],
  )

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
}

/** 기능 컴포넌트가 쓰는 유일한 표면 — toast.success('댓글이 등록됐어요') */
export function useToast(): ToastApi {
  const { success, error, warning, info, dismiss } = useContext(ToastContext)
  return { success, error, warning, info, dismiss }
}

/** viewport 전용 — 들고 있는 목록을 읽는다 */
export function useToastItems(): { items: ToastRecord[]; dismiss: (id?: number) => void } {
  const { items, dismiss } = useContext(ToastContext)
  return { items, dismiss }
}
