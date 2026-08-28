import { prisma } from '@/lib/prisma'
import { FIRST_GREETING_WINDOW_MS } from '@/lib/greeting-policy'

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
