import type { SignupFunnelContentType } from '@/lib/signup-funnel'

/**
 * 가입 제안 인증 왕복의 복귀 위치 — 고정 anchor · fragment · 실패 Toast 문구의 단일 위치.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §6-5.
 *
 * 🔴 복귀 위치는 콘텐츠 유형별 고정 상수뿐이다. 경로·게시물 ID·slug 를 fragment 나 저장소·이벤트에 싣지 않는다.
 *      커뮤니티  댓글 영역      매거진  본문 끝
 *    실패는 같은 위치의 anchor 뒤에 고정 접미사를 붙인다.
 * 🔴 anchor 는 수집 gate · 로그인 여부와 무관하게 상세 화면에 늘 있다. 가입을 마친 사람은 로그인 상태로 돌아온다.
 */

export const SIGNUP_RETURN_ANCHORS: Record<SignupFunnelContentType, string> = {
  community: 'signup-return-comments',
  magazine: 'signup-return-content-end',
}

const FAILED_SUFFIX = '-failed'

export const SIGNUP_AUTH_FAILED_TOAST = '카카오 로그인을 완료하지 못했어요. 읽던 글에서 다시 시도할 수 있어요.'

export type SignupReturn = { contentType: SignupFunnelContentType; outcome: 'success' | 'failed' }

/** 성공 복귀 fragment — '#' 포함 */
export function signupSuccessFragment(contentType: SignupFunnelContentType): string {
  return `#${SIGNUP_RETURN_ANCHORS[contentType]}`
}

/** 취소·실패 복귀 fragment — '#' 포함 */
export function signupFailedFragment(contentType: SignupFunnelContentType): string {
  return `#${SIGNUP_RETURN_ANCHORS[contentType]}${FAILED_SUFFIX}`
}

/** 가입 제안 CTA 의 callbackUrl — 지금 상세 경로 + 성공 fragment. 경로는 인증 목적에만 쓴다 */
export function signupCallbackPath(pathname: string, contentType: SignupFunnelContentType): string {
  return `${pathname}${signupSuccessFragment(contentType)}`
}

/** 지금 주소의 fragment 가 정확히 우리 네 값 중 하나일 때만 해석한다. 그 밖의 fragment 는 건드리지 않는다 */
export function parseSignupReturn(hash: string): SignupReturn | null {
  for (const contentType of Object.keys(SIGNUP_RETURN_ANCHORS) as SignupFunnelContentType[]) {
    if (hash === signupSuccessFragment(contentType)) return { contentType, outcome: 'success' }
    if (hash === signupFailedFragment(contentType)) return { contentType, outcome: 'failed' }
  }
  return null
}

/** 돌아온 화면에서 읽고 쓸 최소 모양 — 시험이 가짜 창을 넣을 수 있게 */
export type SignupReturnWindow = {
  hash: string
  pathname: string
  search: string
  historyState: unknown
  replaceState(state: unknown, url: string): void
  scrollToAnchor(id: string): void
  notifyFailed(message: string): void
}

/**
 * 복귀 fragment 를 한 번 소비한다. 소비했으면 true.
 *
 * 🔴 순서: 복귀 위치로 옮김 → (실패만) Toast → fragment 제거.
 * 🔴 제거는 replaceState 한 번이다. history 상태는 그대로 두고 주소에서 fragment 만 뺀다 — reload · 새 항목 0.
 * 🔴 이 화면 유형의 우리 fragment 가 아니면 아무것도 하지 않는다.
 */
export function consumeSignupReturn(win: SignupReturnWindow, contentType: SignupFunnelContentType): boolean {
  const parsed = parseSignupReturn(win.hash)
  if (!parsed || parsed.contentType !== contentType) return false
  win.scrollToAnchor(SIGNUP_RETURN_ANCHORS[contentType])
  if (parsed.outcome === 'failed') win.notifyFailed(SIGNUP_AUTH_FAILED_TOAST)
  win.replaceState(win.historyState, `${win.pathname}${win.search}`)
  return true
}
