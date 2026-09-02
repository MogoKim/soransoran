/**
 * 하단 댓글 진입점을 언제 보일지 정하는 순수 판정.
 * 컴포넌트 밖에 두어 브라우저 없이 임계값을 읽고 고칠 수 있게 한다.
 */

/** 화면 절반은 내려야 뜬다 — 짧은 글에서 첫 화면부터 하단을 점유하지 않게. */
export const MIN_SCROLL_RATIO = 0.5

/** 입력폼이 화면 1.5개분보다 아래에 있을 때만 "멀다"고 본다. */
export const FAR_INPUT_RATIO = 1.5

export type DockVisibilityInput = {
  /** 댓글 입력 영역의 뷰포트 기준 위치 */
  inputTop: number
  inputBottom: number
  /** 댓글 섹션 시작("댓글 N")의 뷰포트 기준 top */
  sectionTop: number
  viewportHeight: number
  scrollY: number
}

export function resolveDockVisible({
  inputTop,
  inputBottom,
  sectionTop,
  viewportHeight,
  scrollY,
}: DockVisibilityInput): boolean {
  // 입력폼을 지나쳤다 — 아래는 다음 읽을 글과 글쓰기 CTA 자리다
  if (inputBottom <= 0) return false
  // 입력폼이 보이거나 곧 보인다 — 진입점을 하나 더 둘 이유가 없다
  if (inputTop < viewportHeight * FAR_INPUT_RATIO) return false
  if (scrollY < viewportHeight * MIN_SCROLL_RATIO) return false
  // 섹션이 위로 지나갔어도(음수) 참이다 — 목록을 읽는 내내 손 닿는 곳에 남는다
  return sectionTop <= viewportHeight
}
