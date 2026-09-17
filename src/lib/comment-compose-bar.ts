/**
 * 하단 댓글 작성 바의 노출 판정과 이동 방식 — 순수 규칙.
 * 컴포넌트 밖에 두어 브라우저 없이 조건표를 전수로 확인할 수 있게 한다.
 *
 * 🔴 "얼마나 읽었는가" 를 길이·비율로 어림하지 않는다.
 *    한때는 댓글 섹션에 들어왔는지, 섹션이 한 화면보다 긴지로 판정했다.
 *    둘 다 **읽기를 마쳤는가**를 대신 재려던 것이고, 둘 다 틀렸다 —
 *    실측(2026-09-17 soransoran.com · 390x844)에서 긴 글은 전체 스크롤의 1.2% 구간에서만
 *    떴고, 댓글 8개짜리 보통 글은 한 번도 뜨지 않았다.
 *    지금은 대신 **본문 끝의 공감·공유 줄이 화면에 들어왔는가**를 직접 본다.
 *    그 줄은 "다 읽고 무엇을 할지 고르는 자리" 라서, 읽기의 끝을 어림하지 않고 가리킨다.
 *
 * 🔴 스크롤 방향을 보지 않는다. 방향으로 여닫으면 같은 자리에서 손끝이 조금만 움직여도
 *    상태가 뒤집혀 화면이 떨린다.
 */

/**
 * 공감·공유 줄을 가리키는 표시.
 * 🔴 문자열을 양쪽에 따로 적지 않는다 — 한쪽만 고치면 판정이 조용히 멈춘다.
 */
export const ACTION_BAR_MARK = 'data-post-action-bar'

/** 글 맨 위를 가리키는 표시. 여기서 얼마나 내려왔는지를 잰다 */
export const SCROLL_START_MARK = 'data-post-scroll-start'

/**
 * 공감·공유 줄이 화면 아래에서 **이만큼 안쪽까지** 들어와야 표시한다(px).
 * 🔴 0 으로 두면 줄의 첫 픽셀이 걸치는 순간 뜬다. 그 순간은 아직 "보인다" 가 아니다.
 */
export const ACTION_BAR_SHOW_INSET_PX = 24

/**
 * 화면 아래로 **이만큼 더 내려가야** 숨긴다(px).
 *
 * 🔴 표시 선과 숨김 선을 일부러 어긋나게 둔다(여유 구간 24 + 64 = 88px).
 *    한 선으로 두면 그 선 위에서 손끝이 1px 떨릴 때마다 바가 켜졌다 꺼진다.
 *    한 번 뜬 뒤에는 뜰 때보다 **더 많이 되돌아가야** 사라진다.
 */
export const ACTION_BAR_HIDE_OUTSET_PX = 64

/**
 * 글 시작 표시가 화면 위로 이만큼 밀려나야 바를 둔다(px).
 *
 * 🔴 짧은 글을 위한 조건이다. 공감·공유 줄이 첫 화면에 이미 보이는 글에서
 *    바가 처음부터 화면 아래를 차지하면, 아직 아무것도 읽지 않은 사람에게
 *    작성 요구부터 들이미는 꼴이 된다.
 * 🔴 이 값만으로는 절대 바가 뜨지 않는다. 공감·공유 조건과 **함께** 만족해야 한다 —
 *    그래서 긴 글에서 조금 내려왔다는 이유로 뜨는 일이 생기지 않는다.
 *
 * 🔴 **문서 스크롤 양이 아니다.** 기준은 표시(SCROLL_START_MARK)가 화면 위 48px 선을
 *    지나는 순간인데, 그 표시는 고정 헤더(Header 64 + IconMenu 90) 아래 본문 맨 위에 있다.
 *    그래서 실제로 필요한 스크롤은 그만큼 더 크다 —
 *    실측(2026-09-17 · 390x844 · 기본 글자): 60px 에서는 아직, 120px 에서 뜬다.
 *    화면의 약 1/8 이고 손가락 한 번 쓸어내린 정도라 그대로 둔다.
 *    고정 헤더 높이가 바뀌면 이 체감도 함께 바뀐다.
 */
export const SCROLL_START_GAP_PX = 48

/**
 * 폼이 화면에 들어오기 **전에** 미리 비키는 여유(px).
 *
 * 🔴 화면 아래쪽으로 재는 값이다. 폼의 top 이 화면 바닥보다 이만큼 아래에 있을 때까지만
 *    "아직 안 왔다" 로 본다. 화면 바닥 기준으로 재면(viewportHeight - 96) 폼이 이미
 *    화면에 들어온 뒤에도 "아직 안 왔다" 가 되어 **바가 폼 위에 얹힌다** —
 *    844 화면에서 폼 top 이 800 이면 폼은 분명히 보이는데 바도 함께 떠 있었다.
 * 🔴 바 높이(터치 52 + 위아래 여백 ≈ 69)보다 넉넉히 잡는다. 비키는 일이 폼이 보이기
 *    시작하는 순간보다 **먼저** 끝나야 하기 때문이다.
 */
export const FORM_NEAR_MARGIN_PX = 96

/**
 * 이만큼(화면 높이의 비율) 한 번에 건너뛰면 그 자리에서 곧바로 다시 잰다.
 *
 * 🔴 손으로 굴리는 스크롤은 한 프레임에 이만큼 움직이지 않는다. 그런 이동은
 *    스크롤 복원 · 해시 이동 · 우리가 부른 scrollTo 뿐이다.
 *    크게 뛰었을 때만은 멈출 때까지 기다리지 않고 바로 맞춘다.
 */
export const SCROLL_JUMP_RATIO = 0.5

/**
 * 스크롤이 이만큼 조용하면 멈춘 것으로 보고 한 번 잰다(ms).
 *
 * 🔴 이것이 정확성의 바탕이다. IntersectionObserver 는 **경계를 지날 때만** 부르는데,
 *    경계를 건드리지 않는 이동(예: 폼이 화면 안에서 위로 400px 이동)에서는
 *    아무 신호도 오지 않아 판단이 낡는다 —
 *    실측(2026-09-17 fx-empty · y=2000→2400)에서 폼이 화면에 들어왔는데도
 *    바가 남아 있었다.
 * 🔴 스크롤이 **움직이는 동안에는 아무것도 재지 않는다.** 멈춘 뒤 한 번이다.
 *    매 프레임 getBoundingClientRect 를 부르면 그게 곧 스크롤 버벅임이 된다.
 * 🔴 120ms 는 손을 뗀 뒤 관성이 잦아드는 사이 눈에 띄지 않는 길이다.
 */
export const SCROLL_SETTLE_MS = 120

/**
 * 소프트 키보드로 볼 최소 축소 폭(px).
 *
 * 🔴 얕은 문턱을 쓰지 않는다. 주소창이 접히고 펴지는 것만으로도 조금은 움직이는
 *    브라우저가 있어, 읽는 동안 바가 까닭 없이 사라진다.
 *    올라온 키보드는 어떤 기기에서도 이보다 훨씬 크다.
 */
export const KEYBOARD_MIN_SHRINK_PX = 120

/**
 * 공감·공유 줄이 화면에 들어왔는가 — **좌표 하나로 판정한다**.
 *
 * 🔴 IntersectionObserver 의 isIntersecting 을 쓰지 않는다.
 *    그 값은 "교차하지 않는다" 만 말할 뿐 위로 지나갔는지 아래에 있는지는 말해 주지 않고,
 *    큰 폭으로 건너뛴 스크롤에서는 교차 상태가 바뀌지 않아 **콜백 자체가 오지 않는다**.
 *    관찰은 "지금 다시 재 보라" 는 **신호**로만 쓰고, 판단은 언제나 이 함수가 한다 —
 *    그래야 관찰이 온 경우와 우리가 직접 잰 경우가 같은 답을 낸다.
 *
 * top  공감·공유 줄의 화면 기준 top(px)
 */
export function resolveActionBarPassed({
  previous,
  top,
  viewportHeight,
}: {
  previous: boolean
  top: number
  viewportHeight: number
}): boolean {
  // 아직 화면 아래 — 읽지 않은 본문이 남아 있다
  if (top > viewportHeight + ACTION_BAR_HIDE_OUTSET_PX) return false
  // 충분히 들어왔거나 이미 위로 지나갔다 — 둘 다 "본문을 다 지나왔다" 이다
  if (top <= viewportHeight - ACTION_BAR_SHOW_INSET_PX) return true
  // 두 선 사이 — 손끝의 작은 움직임으로 뒤집히지 않게 이전 판단을 지킨다
  return previous
}

/**
 * 작성 폼이 화면의 어디에 있는가.
 *
 * 🔴 세 자리를 구분한다. "교차하지 않는다" 하나로 뭉치면
 *    폼을 지나 추천 글·Footer 를 보는 구간에서 바가 **되살아난다** —
 *    실측(2026-09-17 fx-empty)에서 ON@1800 → off@2000 → **ON@3280** 으로 실제로 그랬다.
 *    그 자리에서는 이미 폼을 지나쳤으므로 바를 다시 내밀 이유가 없다.
 */
export type FormPosition =
  /** 아직 화면 아래 — 바를 둘 수 있다 */
  | 'below'
  /** 화면에 있다(여유 구간 포함) — 바가 비킨다 */
  | 'visible'
  /** 위로 지나갔다 — 바가 비킨다 */
  | 'above'

export function resolveFormPosition({
  top,
  bottom,
  viewportHeight,
}: {
  top: number
  bottom: number
  viewportHeight: number
}): FormPosition {
  // 🔴 여유는 화면 **아래쪽**으로 잰다. 폼이 화면 바닥에 닿기 전에 이미 비켜 있어야 한다 —
  //    바닥 기준으로 빼면(viewportHeight - 96) 폼이 들어온 뒤에도 '아래'가 되어 바가 폼을 덮는다.
  if (top >= viewportHeight + FORM_NEAR_MARGIN_PX) return 'below'
  if (bottom <= 0) return 'above'
  return 'visible'
}

/** 글 시작 표시가 화면 위 기준선을 지났는가 */
export function resolveMovedFromTop({ top }: { top: number }): boolean {
  return top < SCROLL_START_GAP_PX
}

export type ComposeBarInput = {
  /** 본문 끝 공감·공유 줄을 지나왔는가 */
  actionBarPassed: boolean
  /** 글 맨 위에서 충분히 내려왔는가 */
  movedFromTop: boolean
  /** 작성 폼이 화면의 어디에 있는가 — 'below' 일 때만 바를 둔다 */
  formPosition: FormPosition
  /** 작성 영역 안에 포커스가 있는가 */
  composing: boolean
  /** 소프트 키보드가 올라와 있는가 — focus 를 놓치는 브라우저를 위한 보조 신호 */
  keyboardOpen: boolean
  /** 답글 · 댓글 수정 등 다른 작성 모드가 열려 있는가 */
  otherComposerOpen: boolean
}

export function resolveComposeBarVisible({
  actionBarPassed,
  movedFromTop,
  formPosition,
  composing,
  keyboardOpen,
  otherComposerOpen,
}: ComposeBarInput): boolean {
  if (!actionBarPassed) return false
  if (!movedFromTop) return false
  // 🔴 'visible' 은 물론 'above' 도 숨긴다 — 폼을 지나친 뒤 다시 내밀지 않는다
  if (formPosition !== 'below') return false
  if (composing) return false
  if (keyboardOpen) return false
  if (otherComposerOpen) return false
  return true
}

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
