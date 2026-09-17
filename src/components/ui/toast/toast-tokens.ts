/**
 * 토스트 정책 상수 — 🔴 위치·시간·개수를 바꾸는 자리는 이 파일 하나다.
 *
 * 기능 컴포넌트는 toast.success('댓글이 등록됐어요') 만 호출한다.
 * 어디에 뜨는지·얼마나 머무는지·몇 개까지 쌓이는지를 기능 쪽이 알면
 * 정책을 바꿀 때 호출부를 전부 찾아다녀야 한다.
 */

export type ToastVariant = 'success' | 'error' | 'warning' | 'info'

/** PageShell 의 chrome 과 같은 값 — 상단 고정 높이가 달라 offset 도 갈린다 */
export type ToastChrome = 'full' | 'minimal'

/**
 * 🔴 상단 고정 요소의 실측 높이다. 그 컴포넌트를 고치면 여기도 같이 고친다.
 *    Header  h-16   = 64px  (Header.tsx · sticky top-0 z-50)
 *    IconMenu       = 90px  (IconMenu.tsx · sticky top-16 z-40 · chrome="full" 에서만)
 */
const HEADER_HEIGHT = 64
const ICON_MENU_HEIGHT = 90
/** 고정 요소 아래 남기는 숨 */
const TOP_GAP = 12

/**
 * 🔴 IconMenu 를 덮지 않는다.
 *    게시판 네 칸은 이 서비스의 길잡이라, 안내가 잠깐 뜨자고 가릴 자리가 아니다.
 *    그래서 chrome 에 따라 내려오는 위치를 다르게 잡는다.
 */
export const TOAST_TOP: Record<ToastChrome, string> = {
  full: `calc(${HEADER_HEIGHT + ICON_MENU_HEIGHT + TOP_GAP}px + env(safe-area-inset-top))`,
  minimal: `calc(${HEADER_HEIGHT + TOP_GAP}px + env(safe-area-inset-top))`,
}

/**
 * 🔴 지금 화면에 있는 것 중 가장 높은 것보다 커야 한다.
 *    Header 50 · IconMenu 40 · FAB 40 · CommentDock 30.
 *    아래에 두면 안내가 고정 요소 뒤로 숨는다.
 *
 * 🔴 값을 내리지 않는다. 한때 댓글 입력 시트(61)와 딤(60)이 있어 61 을 넘겨야 했고,
 *    그 둘은 2026-09-17 에 사라졌다. 그래도 70 을 유지한다 —
 *    앞으로 생길 겹침에 여유를 두는 값이지, 특정 컴포넌트에 맞춘 값이 아니다.
 */
export const TOAST_Z = 70

/** 동시에 쌓이는 최대 개수 — 넘으면 가장 오래된 것을 버린다 */
export const TOAST_MAX = 3

/** variant 별 머무는 시간(ms). 0 이면 자동으로 닫히지 않는다 */
export const TOAST_DURATION: Record<ToastVariant, number> = {
  success: 3000,
  info: 3000,
  warning: 4000,
  error: 5000,
}

/**
 * 같은 문구가 이 시간 안에 다시 오면 무시한다.
 * useFormState 는 재제출마다 새 상태를 주므로 연타가 그대로 쌓인다.
 */
export const TOAST_DUPLICATE_WINDOW_MS = 1000

/** 자동으로 닫히지 않거나 오래 머무는 것에만 닫기 버튼을 둔다 */
export const TOAST_CLOSABLE: Record<ToastVariant, boolean> = {
  success: false,
  info: false,
  warning: true,
  error: true,
}

/**
 * 스크린리더 전달 방식.
 * 성공·안내는 하던 일을 끊지 않고(polite), 실패·경고는 즉시 알린다(assertive).
 */
export const TOAST_ASSERTIVE: Record<ToastVariant, boolean> = {
  success: false,
  info: false,
  warning: true,
  error: true,
}
