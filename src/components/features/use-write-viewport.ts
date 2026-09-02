'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 상단바를 화면 맨 위에 붙들어 둔다.
 *
 * 🔴 왜 필요한가. position:fixed 의 기준은 layout viewport 다. 모바일 브라우저는
 *    키보드를 올릴 때 layout viewport 를 그대로 두고 visual viewport 만 아래로 민다.
 *    그래서 top:0 에 붙인 것이 화면 위로 밀려 나가 보이지 않는다. 밀린 만큼 되돌려 내린다.
 *
 * 🔴 이 보정은 **화면에 고정된 것에만** 준다. 문서 흐름 안에 있는 것(툴바)에 주면
 *    제자리에서 아래로 밀려 나가 본문 위를 덮는다 — 실기기에서 그렇게 깨졌다.
 *
 * 🔴 왜 ref 콜백인가. 폼이 다시 그려져 요소가 새로 붙어도 그 자리에서 마지막 값을
 *    바로 입힌다. effect 를 기다리면 한 프레임 동안 제자리를 벗어나 튄다.
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
    // visualViewport 가 없는 브라우저는 손대지 않는다 — 원래대로 top:0 에 둔다.
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

/**
 * 키보드가 가린 높이(px). 화면 아래에 붙인 것을 그만큼 올려 놓는 데 쓴다.
 *
 * 🔴 왜 하단 CTA 가 이것을 알아야 하는가. 키보드가 열리면 화면 아래는 통째로
 *    키보드 뒤다. 그냥 bottom:0 에 두면 등록 버튼이 키보드에 가려, 쓰다가 등록하려면
 *    키보드를 내렸다가 다시 눌러야 한다. 두 손이 필요한 흐름이 된다.
 *    키보드 바로 위에 올려 두면 쓰던 손 그대로 누른다.
 *
 * 🔴 innerHeight 에서 visual viewport 를 빼서 잰다. Android Chrome 은 키보드가 올라와도
 *    innerHeight 가 그대로고 visualViewport.height 만 줄어든다. iOS 는 화면을 밀어
 *    올리므로 offsetTop 까지 빼야 실제로 가려진 높이가 나온다.
 *
 * 🔴 visualViewport 가 없으면 0 을 준다. 그 브라우저에서는 예전처럼 화면 맨 아래에
 *    그대로 붙는다 — 없는 값을 추측해 올려 두면 빈 띠가 생긴다.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      const next = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
      // 🔴 1px 흔들림은 무시한다. 스크롤마다 state 를 바꾸면 입력 중에 바가 떤다.
      setInset((prev) => (Math.abs(prev - next) <= 1 ? prev : next))
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return inset
}
