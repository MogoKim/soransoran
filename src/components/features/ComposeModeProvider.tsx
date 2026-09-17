'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

/**
 * 댓글 영역에서 "지금 다른 작성 모드가 열려 있는가" 를 한 곳에서 안다.
 *
 * 🔴 이전 이름은 ReplyOpenProvider 였다. 답글 하나만 알면 됐기 때문인데,
 *    하단 작성 바가 "답글 · 댓글 수정이 열리면 비킨다" 는 계약을 지게 되면서
 *    아는 범위가 넓어졌다. 이름을 그대로 두면 수정 폼을 세는 자리가
 *    "답글" 이라는 이름 뒤에 숨는다.
 *
 * 🔴 답글은 여전히 한 번에 하나만 연다(openParentId). 수정 폼은 댓글마다 따로 열리므로
 *    같은 방식으로 셀 수 없어 **개수**로 센다 — 둘을 한 값으로 합치지 않는 이유다.
 */
type ComposeModeState = {
  /** 열려 있는 답글의 부모 댓글 id. 없으면 null */
  openParentId: string | null
  setOpenParentId: (id: string | null) => void
  /** 답글이든 수정이든 본문 폼 말고 다른 작성 자리가 열려 있는가 */
  otherComposerOpen: boolean
  /**
   * 수정 폼이 열려 있는 동안 자리를 잡아 둔다.
   * 🔴 정리 함수를 반드시 돌려준다 — 닫힐 때 빼지 않으면 숫자가 줄지 않아
   *    하단 바가 영영 돌아오지 않는다.
   */
  registerComposer: () => () => void
}

const ComposeModeContext = createContext<ComposeModeState | null>(null)

export default function ComposeModeProvider({ children }: { children: ReactNode }) {
  const [openParentId, setOpenParentId] = useState<string | null>(null)
  const [composerCount, setComposerCount] = useState(0)

  /**
   * 🔴 등록/해제를 쌍으로 세므로 StrictMode 의 이중 실행에도 값이 맞는다.
   *    boolean 플래그로 두면 두 댓글이 동시에 열렸다 하나만 닫힐 때 거짓이 된다.
   */
  const registerComposer = useCallback(() => {
    setComposerCount((n) => n + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      setComposerCount((n) => Math.max(0, n - 1))
    }
  }, [])

  const value = useMemo<ComposeModeState>(
    () => ({
      openParentId,
      setOpenParentId,
      otherComposerOpen: openParentId !== null || composerCount > 0,
      registerComposer,
    }),
    [openParentId, composerCount, registerComposer],
  )

  return <ComposeModeContext.Provider value={value}>{children}</ComposeModeContext.Provider>
}

export function useComposeMode(): ComposeModeState {
  const ctx = useContext(ComposeModeContext)
  if (!ctx) throw new Error('ComposeModeProvider 안에서만 쓸 수 있다')
  return ctx
}

/**
 * 열려 있는 동안 "다른 작성 모드" 로 세어 달라고 알린다.
 *
 * 🔴 호출부가 등록·해제를 직접 짝지으면 언젠가 한쪽을 빠뜨린다.
 *    열림 여부만 넘기면 짝은 이 훅이 맞춘다.
 */
export function useComposeLock(active: boolean): void {
  const { registerComposer } = useComposeMode()
  useEffect(() => {
    if (!active) return
    return registerComposer()
  }, [active, registerComposer])
}
