'use client'

import { useCallback, useEffect, useRef } from 'react'

/**
 * 화면 위에 붙여 둔 것을 키보드가 밀어내지 못하게 한다.
 *
 * 🔴 왜 필요한가. position:fixed 의 기준은 layout viewport 다. 모바일 브라우저는
 *    키보드를 올릴 때 layout viewport 를 그대로 두고 visual viewport 만 아래로 민다.
 *    그래서 top:0 에 붙인 것이 화면 위로 밀려 나가 보이지 않는다 — 글을 쓰는 동안
 *    등록 버튼이 사라지는 것이 이 때문이다. 밀린 만큼(offsetTop) 되돌려 내린다.
 *
 * 🔴 왜 ref 콜백인가. 폼이 다시 그려져 요소가 새로 붙어도 그 자리에서 마지막 값을
 *    바로 다시 입힌다. effect 를 기다리면 한 프레임 동안 제자리를 벗어나 튄다.
 *
 * 🔴 왜 상단바와 툴바가 같은 것을 쓰는가. 둘이 위아래로 맞붙어 있어서 한쪽만
 *    보정하면 키보드가 열릴 때 사이가 벌어지거나 겹친다.
 */
export function useWriteViewportTop(): (el: HTMLElement | null) => void {
  const elRef = useRef<HTMLElement | null>(null)
  const offsetRef = useRef(0)

  const apply = useCallback((el: HTMLElement | null) => {
    if (el) el.style.transform = `translateY(${offsetRef.current}px)`
  }, [])

  const setEl = useCallback(
    (el: HTMLElement | null) => {
      elRef.current = el
      apply(el)
    },
    [apply],
  )

  useEffect(() => {
    const vv = window.visualViewport
    // visualViewport 가 없는 브라우저는 손대지 않는다 — 원래대로 붙어 있게 둔다.
    if (!vv) return
    const update = () => {
      const next = Math.max(0, Math.round(vv.offsetTop))
      if (next === offsetRef.current) return
      offsetRef.current = next
      apply(elRef.current)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [apply])

  return setEl
}
