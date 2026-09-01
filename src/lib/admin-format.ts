import { getBoardByType, type BoardType } from '@/lib/board-registry'

/**
 * 어드민 화면 공통 표기.
 * 🔴 화면마다 Intl 설정을 다시 쓰지 않는다 — 한 곳이 틀리면 날짜가 서로 달라 보인다.
 */
const KST_DATE_TIME = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Asia/Seoul',
})

export function formatKst(value: Date | null | undefined): string {
  if (!value) return '-'
  return KST_DATE_TIME.format(value)
}

/** 값이 없으면 '-' 로 둔다. 빈칸은 "못 받았다" 와 "안 받았다" 를 구분하지 못한다. */
export function orDash(value: string | null | undefined): string {
  const v = value?.trim()
  return v ? v : '-'
}

/**
 * 실회원 판정 — 어드민 회원 화면의 단일 기준.
 *
 * 🔴 providerId 로 판정하지 않는다. 그 컬럼은 아무도 채우지 않는다.
 *    schema 주석은 "실회원 판별 기준" 이라 말하지만 write 하는 코드가 없고,
 *    auth.ts 도 "User.providerId 는 adapter 가 채우지 않는다" 라고 적어 두었다.
 *    실측 결과 카카오로 들어온 회원까지 전원 null 이었고, 그래서 회원 목록이
 *    0 건 · 회원 상세가 전원 notFound 였다. 기준을 실제로 채워지는 값으로 옮긴다.
 *
 * 🔴 카카오 Account 유무로 본다. NextAuth adapter 가 로그인 시 반드시 만든다 —
 *    "카카오로 들어온 사람" 이라는 원래 뜻을 그대로 지키면서 실제로 존재하는 값이다.
 *    providerId 컬럼과 auth 흐름은 건드리지 않는다(인증 변경 체크리스트 대상).
 *
 * 🔴 페르소나가 연결된 User 는 뺀다.
 *    페르소나도 User 행을 갖지만 운영자가 차단하거나 상세를 볼 대상이 아니다.
 *    persona 파일을 건드리지 않고 관계 유무만 본다.
 *
 * 🔴 화면마다 where 를 다시 쓰지 않는다. 목록에서 빠진 사람이 상세로는 열리는
 *    상태가 가장 위험하다 — 목록·상세·집계가 같은 조각을 쓴다.
 */
export const REAL_MEMBER_WHERE = {
  accounts: { some: { provider: 'kakao' } },
  persona: { is: null },
} as const

/**
 * 글 상세의 고객 경로. 만들 수 없으면 null 이다.
 *
 * 🔴 매거진은 제외한다.
 *    MAGAZINE 의 href 는 /magazine 인데 그 하위는 Post.id 가 아니라 파일 slug 를 받는다.
 *    붙이면 404 로 가는 링크가 만들어진다. 커뮤니티 게시판만 {href}/{postId} 가 성립한다.
 *
 * 🔴 경로를 문자열로 적지 않는다. board-registry 가 유일한 출처다.
 *
 * 🔴 여기 둔 이유 — actions/admin.ts 는 'use server' 라 동기 함수를 export 할 수 없다.
 */
export function communityPostHref(postId: string, boardType: BoardType): string | null {
  const board = getBoardByType(boardType)
  if (!board || !board.href.startsWith('/community/')) return null
  return `${board.href}/${postId}`
}
