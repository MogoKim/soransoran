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
 * 🔴 **운영용 작성자도 뺀다** (2026-09-17).
 *    창업자가 직접 쓰는 운영용 닉네임도 User 행을 갖는다. 카카오 Account 를 붙이지
 *    않으므로 위 조건만으로도 이미 빠지지만, 관계를 **명시**해 둔다 —
 *    누군가 실수로 그 계정에 로그인 수단을 붙이는 날 이 한 줄이 마지막 방어다.
 *    (페르소나 조건이 같은 이유로 남아 있다)
 *
 * 🔴 화면마다 where 를 다시 쓰지 않는다. 목록에서 빠진 사람이 상세로는 열리는
 *    상태가 가장 위험하다 — 목록·상세·집계가 같은 조각을 쓴다.
 */
export const REAL_MEMBER_WHERE = {
  accounts: { some: { provider: 'kakao' } },
  persona: { is: null },
  operatorWriter: { is: null },
} as const

/**
 * 이미 가져온 User 가 실회원인가 — REAL_MEMBER_WHERE 와 같은 기준을 코드로 쓴 것.
 *
 * 🔴 where 로 거를 수 없는 자리에서 쓴다.
 *    신고 화면의 대상 작성자는 Report → Post/Comment → User 로 딸려 온다.
 *    거기에 실회원 조건을 걸면 신고 자체가 목록에서 사라진다 — 페르소나 글이
 *    신고당해도 운영자가 못 보게 된다. 신고는 다 보이되 조치 버튼만 가린다.
 *
 * 🔴 판정 근거를 여기 한 곳에 둔다. 화면에서 accounts.length 를 직접 세면
 *    REAL_MEMBER_WHERE 를 고칠 때 그쪽이 따라오지 않는다.
 *
 * 🔴 select 에 accounts(provider:'kakao' 필터)·persona·operatorWriter 를 반드시 포함해야 한다.
 *    빠뜨리면 타입이 막는다 — 런타임에 조용히 false 가 되지 않게 하려는 것이다.
 */
export function isRealMember(user: {
  accounts: { id: string }[]
  persona: { id: string } | null
  operatorWriter: { id: string } | null
}): boolean {
  return user.accounts.length > 0 && user.persona === null && user.operatorWriter === null
}

/**
 * 게시판 이름.
 *
 * 🔴 화면마다 BOARD_LABEL 상수를 다시 적지 않는다. 실제로 세 곳이 각자 적고 있었고
 *    한 곳은 board-registry 를 썼다 — 게시판 이름이 바뀌면 두 곳만 따라온다.
 *    board-registry 가 유일한 출처다.
 */
export function boardLabel(boardType: BoardType): string {
  return getBoardByType(boardType)?.label ?? boardType
}

/**
 * 글 상태 이름.
 *
 * 🔴 enum 값을 그대로 내보이지 않는다. 운영 화면에 PUBLISHED · HIDDEN 이 영문으로
 *    뜨면 운영자가 "삭제와 숨김이 뭐가 다른가" 를 화면에서 알 수 없다.
 */
export function postStatusLabel(status: 'PUBLISHED' | 'HIDDEN' | 'DELETED'): string {
  if (status === 'HIDDEN') return '숨김'
  if (status === 'DELETED') return '삭제'
  return '공개'
}

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
