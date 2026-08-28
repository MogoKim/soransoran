/**
 * 화면에 보일 작성자 이름.
 *
 * 🔴 nickname 이 먼저다.
 *    name 은 카카오가 준 프로필 닉네임이고, nickname 은 회원이 이 커뮤니티에서
 *    쓰려고 직접 지은 이름이다. 우리 화면에서 부를 이름은 뒤쪽이다.
 *
 * 🔴 name 을 fallback 으로 남긴다.
 *    매거진을 내는 시스템 계정은 nickname 이 없다. nickname 만 보면 그 글들의
 *    작성자가 통째로 사라진다. 온보딩을 아직 안 거친 회원도 같은 자리에 놓인다.
 *
 * 🔴 마지막 '회원' 을 지우지 않는다.
 *    지금은 둘 다 비어 있는 사람이 없지만, 이름 없는 자리를 빈칸으로 두면
 *    글이 누구 것인지 알 수 없는 화면이 된다. 도달하지 않더라도 남겨 둔다.
 *
 * 🔴 이 규칙은 여기 한 곳에 둔다.
 *    목록·상세·댓글이 각자 ?? 를 적으면 한 곳만 고쳐지는 날이 오고,
 *    같은 사람이 화면마다 다른 이름으로 불린다.
 */

/** 이름이 아무 데도 없을 때 부르는 말 */
export const ANONYMOUS_NAME = '회원'

export type DisplayNameSource = {
  nickname?: string | null
  name?: string | null
}

export function displayName(author: DisplayNameSource): string {
  return author.nickname ?? author.name ?? ANONYMOUS_NAME
}
