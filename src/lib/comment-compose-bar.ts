/**
 * 하단 댓글 작성 바를 언제 보일지 정하는 순수 판정.
 * 컴포넌트 밖에 두어 브라우저 없이 조건표를 전수로 확인할 수 있게 한다.
 *
 * 🔴 스크롤 수식으로 판정하지 않는다.
 *    이전 구현은 `scrollY >= 0.5*vh` · `sectionTop <= vh` · `inputTop >= 1.5*vh` 세 조건을
 *    동시에 요구했다. 세 구간의 교집합은 글이 아주 길 때만 생기고, 그마저 좁다 —
 *    실측(2026-09-17 soransoran.com · 390x844)에서
 *    긴 글은 전체 스크롤 3541px 중 42px 구간에서만 떴고(1.2%),
 *    댓글 8개짜리 보통 글은 전 구간에서 한 번도 뜨지 않았다.
 *    "보이는가" 를 좌표로 계산하는 대신 브라우저에게 묻는다(IntersectionObserver).
 *
 * 🔴 스크롤 방향을 보지 않는다. 방향으로 여닫으면 같은 자리에서 위아래로 조금만
 *    움직여도 상태가 뒤집혀, 화면이 손끝을 따라 떨린다.
 */

export type ComposeBarInput = {
  /**
   * 바를 둘 만한 화면인가.
   *
   * 🔴 댓글이 없거나 댓글 영역이 한 화면보다 짧으면 거짓이다.
   *    그런 글에서는 폼이 늘 코앞이라, 바를 띄워도 스크롤 몇 px 만에 사라진다 —
   *    "떴다 사라지는 띠" 는 없는 것보다 나쁘다.
   */
  enabled: boolean
  /**
   * 댓글 섹션 시작점을 지났는가.
   * 화면 안이거나 위로 지나갔으면 참, 아직 아래에 있으면 거짓이다 —
   * 그래서 "섹션보다 위로 돌아가면 숨긴다" 가 별도 조건 없이 따라온다.
   */
  sectionPassed: boolean
  /**
   * 본문 댓글 작성 폼이 보이거나 곧 보이는가.
   * 🔴 관찰 범위를 바 높이만큼 아래로 넓혀서 본다. 폼이 화면 맨 아래에 걸치는 순간은
   *    바가 그 위에 얹혀 있어 이미 가린 상태다 — 가리기 전에 비켜야 한다.
   */
  formNear: boolean
  /** 작성 영역 안에 포커스가 있는가 */
  composing: boolean
  /** 소프트 키보드가 올라와 있는가 — focus 를 놓치는 브라우저를 위한 보조 신호 */
  keyboardOpen: boolean
  /** 답글 · 댓글 수정 등 다른 작성 모드가 열려 있는가 */
  otherComposerOpen: boolean
}

/**
 * 🔴 전부 "숨길 이유" 다. 하나라도 있으면 숨긴다.
 *    보일 이유를 여러 개 쌓지 않는 것이 이전 구현과 갈리는 지점이다 —
 *    보일 이유가 여럿이면 그 교집합이 비는 순간을 아무도 눈치채지 못한다.
 */
export function resolveComposeBarVisible({
  enabled,
  sectionPassed,
  formNear,
  composing,
  keyboardOpen,
  otherComposerOpen,
}: ComposeBarInput): boolean {
  if (!enabled) return false
  if (!sectionPassed) return false
  if (formNear) return false
  if (composing) return false
  if (keyboardOpen) return false
  if (otherComposerOpen) return false
  return true
}

/**
 * 폼 관찰 범위를 아래로 넓히는 폭(px).
 * 바 높이(52px 터치 + 위아래 여백)보다 넉넉히 잡는다.
 */
export const FORM_NEAR_MARGIN_PX = 96

/**
 * 소프트 키보드로 볼 최소 축소 폭(px).
 *
 * 🔴 30px 같은 얕은 문턱을 쓰지 않는다. 주소창이 접히고 펴지는 것만으로도 그 정도는
 *    움직이는 브라우저가 있어, 읽는 동안 바가 까닭 없이 사라진다.
 *    올라온 키보드는 어떤 기기에서도 120px 보다 훨씬 크다.
 */
export const KEYBOARD_MIN_SHRINK_PX = 120

/**
 * 부드럽게 미끄러질지, 그냥 건너뛸지.
 *
 * 🔴 먼 거리는 건너뛴다. 댓글이 많은 글에서 폼까지는 수천 px 이다.
 *    그만큼을 애니메이션으로 지나가면 (1) 오래 걸리고
 *    (2) 댓글 수백 개가 눈앞으로 흘러가 어지럽고
 *    (3) 그동안 키보드가 올라오면서 브라우저가 자기 스크롤을 걸어 서로 싸운다.
 *    가까운 거리에서만 "화면이 입력칸까지 내려왔다" 가 도움이 된다.
 *
 * 🔴 움직임을 줄이도록 설정했으면 언제나 건너뛴다.
 */
export const SMOOTH_SCROLL_MAX_VIEWPORTS = 1.5

export function resolveScrollBehavior({
  distance,
  viewportHeight,
  reduceMotion,
}: {
  /** 지금 자리에서 목적지까지의 거리(px · 부호 없음) */
  distance: number
  viewportHeight: number
  reduceMotion: boolean
}): ScrollBehavior {
  if (reduceMotion) return 'auto'
  if (distance > viewportHeight * SMOOTH_SCROLL_MAX_VIEWPORTS) return 'auto'
  return 'smooth'
}
