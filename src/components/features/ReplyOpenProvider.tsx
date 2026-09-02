'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'

type ReplyOpenState = {
  openParentId: string | null
  setOpenParentId: (id: string | null) => void
}

const ReplyOpenContext = createContext<ReplyOpenState | null>(null)

/** 답글 폼은 한 번에 하나만 연다 — 열린 자리를 목록이 한 곳에서 기억한다. */
export default function ReplyOpenProvider({ children }: { children: ReactNode }) {
  const [openParentId, setOpenParentId] = useState<string | null>(null)
  return (
    <ReplyOpenContext.Provider value={{ openParentId, setOpenParentId }}>
      {children}
    </ReplyOpenContext.Provider>
  )
}

export function useReplyOpen(): ReplyOpenState {
  const ctx = useContext(ReplyOpenContext)
  if (!ctx) throw new Error('ReplyOpenProvider 안에서만 쓸 수 있다')
  return ctx
}
