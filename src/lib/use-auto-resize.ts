import { useEffect, type RefObject } from 'react'

/**
 * textarea 를 내용에 맞춰 늘린다. 상한을 넘으면 내부 스크롤로 넘긴다.
 *
 * height='auto' 선행 리셋이 없으면 scrollHeight 가 직전 높이에 갇혀
 * 글자를 지워도 줄어들지 않는다.
 */
export function useAutoResize(
  ref: RefObject<HTMLTextAreaElement>,
  value: string,
  maxHeight: number,
): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
  }, [ref, value, maxHeight])
}
