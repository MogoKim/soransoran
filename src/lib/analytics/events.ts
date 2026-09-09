/**
 * GA4 참여 계측 — 보낼 수 있는 것의 전부를 이 파일 하나에 적는다.
 *
 * 🔴 값 타입까지 좁힌다. 주석으로 "개인정보를 보내지 말자" 고 적는 대신
 *    board_slug 는 레지스트리 상수, method·member_type 은 리터럴, 나머지는 boolean 으로 둔다.
 *    제목·본문·댓글·닉네임·이메일·userId·postId·commentId·callbackUrl 이
 *    **타입에 자리가 없어** 컴파일러가 막는다. 사람의 기억에 맡기지 않는다.
 *
 * 🔴 이벤트 이름에 값을 넣지 않는다. `like_add` 가 아니라 `reaction` + `action:'add'` 다.
 *    이름에 값을 섞으면 이벤트 종류가 값의 가짓수만큼 늘어나 GA4 상한을 향해 간다.
 *
 * 🔴 여기 없는 이벤트는 보낼 수 없다. trackEvent 가 이 map 의 키만 받는다.
 */
import type { BoardSlug } from '@/lib/board-registry'

/**
 * 1차 이벤트 6종.
 *
 * 깔때기: 진입(page_view) → 글쓰기 관문(write_login_prompt) → 인증 시작(write_auth_start)
 *        → 가입 완료(sign_up) → 글 복원(write_draft_restored) → 기여(post_publish · comment_publish)
 */
export type SoranEventMap = {
  /** 유효한 글을 쓴 비회원에게 로그인 안내가 실제로 열렸다 */
  write_login_prompt: { board_slug: BoardSlug; draft_saved: boolean }
  /** 그 안내에서 카카오로 계속하기를 실제로 눌렀다 */
  write_auth_start: { board_slug: BoardSlug; method: 'kakao' }
  /** 온보딩이 끝나 회원이 됐다. 계정 생애 1회 */
  sign_up: { method: 'kakao' }
  /** 인증 왕복을 마치고 돌아와 쓰던 글이 실제로 복원됐다 */
  write_draft_restored: { board_slug: BoardSlug; logged_in: boolean }
  /** 글이 DB 에 저장됐다 */
  post_publish: { board_slug: BoardSlug }
  /** 댓글이 DB 에 저장됐다 */
  comment_publish: { member_type: 'member' | 'guest'; is_reply: boolean }
}

export type SoranEventName = keyof SoranEventMap

/** 어떤 이벤트의 파라미터든 받는 자리에 쓴다 (trackEvent 내부 전용) */
export type SoranEventParams = SoranEventMap[SoranEventName]
