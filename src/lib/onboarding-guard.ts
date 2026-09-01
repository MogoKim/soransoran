import { prisma } from '@/lib/prisma'

/**
 * 온보딩을 마치기 전에는 쓰지 못하게 막는다.
 *
 * 🔴 저장을 막는 것이 이 파일의 일이다. 안내하는 것은 화면의 일이다.
 *    버튼을 감추거나 화면에서 돌려보내는 것은 친절이지 방어가 아니다 —
 *    서버 액션은 주소만 알면 누구나 부를 수 있다. 그래서 여기서 막는다.
 *
 * 🔴 isOnboarded 를 세션에 싣지 않는다.
 *    JWT 는 최대 30일을 산다. 방금 가입을 마친 사람이 그동안 계속
 *    "아직 안 끝났다" 로 읽히면, 고친 뒤에도 증상이 남는다.
 *    온보딩 완료는 평생 한 번뿐이라 캐싱으로 얻을 것이 가장 작고,
 *    틀렸을 때 잃는 것이 가장 크다. 매번 DB 에서 읽는다.
 *    (그리고 세션에 실으려면 auth.config.ts 를 건드려야 하는데,
 *     그 파일은 손대는 순간 로그인 전체가 흔들린 전력이 있다)
 *
 * 🔴 차단(isBlocked)도 여기서 함께 본다.
 *    write 경로 11곳이 이미 이 함수를 지난다 — 글·댓글 작성/수정/삭제 · 공감 ·
 *    스크랩 · 신고 · 첫 인사 · 프로필. 차단 검사를 각 액션에 흩으면 반드시 한 곳이 빠진다.
 *    (탈퇴는 이 guard 를 쓰지 않는다. 차단된 사람도 떠날 수는 있어야 한다)
 *
 * 🔴 id 로만 찾는다. 닉네임이 있는지, 동의가 몇 행인지로 다시 판정하지 않는다.
 *    isOnboarded 가 온보딩 완료의 유일한 진실이다 (actions/onboarding.ts 와 같은 규칙).
 *    판정이 두 곳이 되면 언젠가 서로 다른 답을 낸다.
 */

/** 회원은 맞는데 아직 가입을 안 끝낸 경우 */
export const ONBOARDING_REQUIRED = '가입을 마치면 글과 댓글을 남기실 수 있어요.'

/** 세션의 id 로 User 를 못 찾은 경우. 기존 액션들이 쓰던 문구를 그대로 쓴다 */
export const MEMBER_NOT_FOUND = '회원 정보를 찾을 수 없습니다. 다시 로그인해 주세요.'

/**
 * 운영이 차단한 회원.
 *
 * 🔴 이유를 적지 않는다. 화면에 나가는 문구라 사유를 쓰면 해명·항의의 시작점이 되고,
 *    그 대화를 받을 창구가 아직 없다. 짧게 상태만 알린다.
 * 🔴 "차단" 이라는 말을 쓰지 않는다 — 상대를 규정하는 말이라 읽는 사람이 다친다.
 */
export const MEMBER_BLOCKED = '지금은 글과 댓글을 남길 수 없어요.'

/**
 * 막아야 하면 사유를, 통과면 null 을 준다.
 *
 * 🔴 needsOnboarding 은 통과 실패 중에서도 "가입만 마치면 되는" 경우에만 켠다.
 *    회원을 못 찾은 것은 다시 로그인할 일이라 온보딩으로 보내면 안 된다.
 *    화면(O3-B)이 이 값으로 온보딩 안내를 띄울지 정한다.
 */
export type OnboardingBlock = {
  error: string
  needsOnboarding?: true
}

export async function requireOnboarded(userId: string): Promise<OnboardingBlock | null> {
  const member = await prisma.user.findUnique({
    where: { id: userId },
    select: { isOnboarded: true, isBlocked: true },
  })

  if (!member) return { error: MEMBER_NOT_FOUND }
  // 🔴 온보딩보다 먼저 본다. 차단된 사람에게 "가입을 마치라" 고 안내하면
  //    시키는 대로 해도 계속 막혀 무엇이 문제인지 알 수 없다.
  // 🔴 needsOnboarding 을 켜지 않는다 — 온보딩으로 보낼 일이 아니다.
  if (member.isBlocked) return { error: MEMBER_BLOCKED }
  if (!member.isOnboarded) return { error: ONBOARDING_REQUIRED, needsOnboarding: true }

  return null
}
