import { prisma } from '@/lib/prisma'
import { getBoardByType } from '@/lib/board-registry'
import {
  FIRST_GREETING_BOARD_TYPE,
  FIRST_GREETING_WINDOW_MS,
  GREETING_CATEGORY,
} from '@/lib/greeting-policy'
import { displayName } from '@/lib/display-name'

/**
 * 첫 인사 위젯을 보여줄 사람인가.
 *
 * 🔴 판정은 서버에서 DB 를 보고 한다.
 *    세션에는 가입 시각도 인사 여부도 실려 있지 않고, 실으려면 인증 설정을
 *    건드려야 한다 — 그 파일은 손대는 순간 로그인 전체가 흔들린 전력이 있다.
 *    홈은 어차피 force-dynamic 이라 매 요청 조회가 캐시를 깨뜨리지도 않는다.
 *
 * 🔴 localStorage 로 기억하지 않는다.
 *    DB 가 정본이다. 브라우저에 표시를 남기면 기기를 바꾼 사람에게 위젯이
 *    다시 뜨고, 지운 사람에게는 영영 안 뜬다.
 *
 * 🔴 Post 를 조회하지 않는다.
 *    "이 사람이 인사를 남겼는가" 는 User.firstGreetingAt 하나로 답한다.
 *    글이 지워져도 답이 바뀌지 않아야 한다 — 그게 이 컬럼이 User 에 있는 이유다.
 */
export async function shouldShowFirstGreeting(userId: string | undefined): Promise<boolean> {
  if (!userId) return false

  const member = await prisma.user.findUnique({
    where: { id: userId },
    select: { isOnboarded: true, createdAt: true, firstGreetingAt: true },
  })
  if (!member) return false

  // 가입을 안 끝낸 사람에게 인사부터 권하지 않는다. 순서가 뒤집힌다.
  if (!member.isOnboarded) return false
  if (member.firstGreetingAt) return false

  /**
   * 🔴 기간이 지나면 권하지 않는다.
   *    첫 인사는 "막 온 사람" 의 자리다. 몇 달 뒤에도 계속 권하면
   *    "처음 오셨군요" 가 우리가 그를 기억하지 못한다는 말이 된다.
   */
  return Date.now() - member.createdAt.getTime() < FIRST_GREETING_WINDOW_MS
}

/** 홈에 거는 인사 수. 더 실으면 인사 목록이 홈의 주인공이 된다 */
const RECENT_GREETING_TAKE = 6

export type NewcomerGreeting = {
  id: string
  name: string
  content: string
  href: string
}

/**
 * 홈에 보여줄 최근 인사.
 *
 * 🔴 category 로 찾는다. User.firstGreetingPostId 를 되짚지 않는다.
 *    화면이 보여주는 것은 사람이 아니라 글이다 — 글이 지워지면 목록에서도
 *    사라져야 하는데, id 를 되짚는 경로는 글이 없어져도 id 가 남아
 *    빈 곳을 가리키는 줄을 만든다. status 조건 하나로 끝나는 쪽을 쓴다.
 *
 * 🔴 여기는 EXCLUDE_GREETING 을 쓰지 않는다.
 *    그 조각은 "일반 목록에서 인사를 뺀다" 는 뜻이고, 이 쿼리는 정확히
 *    그 반대 — 인사만 모은다. 같은 파일에 두어 두 방향이 한눈에 보이게 한다.
 *
 * 🔴 차단 사용자 필터가 없다.
 *    그 판정은 queries/posts.ts 안에만 있고 export 되지 않는다.
 *    지금 범위에서 그 파일을 건드리지 않기로 해 여기서는 걸지 못한다 —
 *    인사는 5~200 자 한 줄이라 위험이 작지만, 차단 UI 를 여는 날
 *    이 목록도 같이 걸러야 한다.
 */
export async function getRecentGreetings(
  take = RECENT_GREETING_TAKE,
): Promise<NewcomerGreeting[]> {
  const board = getBoardByType(FIRST_GREETING_BOARD_TYPE)
  if (!board) return []

  const rows = await prisma.post.findMany({
    where: {
      category: GREETING_CATEGORY,
      status: 'PUBLISHED',
    },
    select: {
      id: true,
      content: true,
      author: { select: { nickname: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take,
  })

  return rows.map((row) => ({
    id: row.id,
    name: displayName(row.author),
    content: row.content,
    href: `${board.href}/${row.id}`,
  }))
}
