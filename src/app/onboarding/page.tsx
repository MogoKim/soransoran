import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import OnboardingForm from '@/components/features/onboarding/onboarding-form'
import { auth } from '@/lib/auth'
import { loginHref, toInternalPath } from '@/lib/callback-url'
import { prisma } from '@/lib/prisma'

export const metadata: Metadata = {
  title: '가입 마무리',
}

const ONBOARDING_PATH = '/onboarding'

/**
 * 🔴 open redirect 방어를 여기서 다시 짜지 않는다.
 *    toInternalPath 가 그 일을 한다 ('//evil.com' · '/\evil.com' · 제어문자 · 길이).
 *    같은 규칙을 두 곳에 두면 한쪽만 고쳐지는 날이 오고,
 *    그날 어느 쪽이 실제로 쓰이는지 알 수 없게 된다.
 */

/** 쿼리를 떼고 이 화면 자신인지 본다 */
function isSelf(path: string): boolean {
  const pathname = path.split('?')[0]
  return pathname === ONBOARDING_PATH || pathname === `${ONBOARDING_PATH}/`
}

/**
 * 가입을 마친 뒤 돌아갈 곳.
 *
 * 🔴 이 화면으로 되돌려 보내지 않는다.
 *    막 끝낸 사람을 같은 자리에 다시 세우는 일이다.
 */
function resolveDestination(callbackUrl?: string): string {
  const safe = toInternalPath(callbackUrl)
  if (!safe || isSelf(safe)) return '/'
  return safe
}

/**
 * 로그인하고 돌아올 곳 — 지금 이 주소 그대로.
 *
 * 🔴 callbackUrl 을 들고 돌아온다.
 *    '/onboarding?callbackUrl=/write' 로 들어온 사람을 그냥 '/onboarding' 으로
 *    되돌리면, 가입을 마친 뒤 원래 가려던 /write 를 잃는다.
 *    로그인 한 번 했다고 가려던 곳이 사라지면 안 된다.
 *
 * 🔴 거를 수 없는 값은 떼고 돌아온다. 남기면 로그인 뒤에 다시 만난다.
 */
function returnHere(callbackUrl?: string): string {
  const safe = toInternalPath(callbackUrl)
  if (!safe || isSelf(safe)) return ONBOARDING_PATH
  return `${ONBOARDING_PATH}?callbackUrl=${encodeURIComponent(safe)}`
}

/**
 * 🔴 PageShell 을 쓰지 않는다.
 *    가입을 마치는 동안 헤더의 다른 길이 함께 보이면 여기를 끝내지 않고 빠져나간다.
 *    로그인 화면이 같은 이유로 헤더·푸터 없이 산다.
 *
 * 🔴 여기서 막는 것은 "들어오면 안 될 사람" 뿐이다.
 *    "들어와야 할 사람을 끌어오는 일"(온보딩 미완료자 강제 진입) 은 다음 단계다.
 *    둘을 한 번에 하면 로그인 전체가 흔들렸을 때 어느 쪽이 원인인지 가려진다.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: { callbackUrl?: string }
}) {
  const session = await auth()
  const userId = session?.user?.id

  // 🔴 로그인하지 않은 사람에게 폼을 보여주지 않는다.
  //    닉네임 확인도 저장도 서버에서 막히니, 다 채우고 나서야 막히는 화면이 된다.
  if (!userId) redirect(loginHref(returnHere(searchParams.callbackUrl)))

  const destination = resolveDestination(searchParams.callbackUrl)

  /**
   * 🔴 이미 마친 사람은 폼을 보지 않는다.
   *    저장은 completeOnboarding 이 막지만, 그건 다 적고 누른 뒤의 일이다.
   *    들어온 순간 돌려보내는 편이 정직하다.
   *
   * 🔴 isOnboarded 하나만 본다. 닉네임 모양 같은 것으로 다시 판정하지 않는다 —
   *    판정이 두 곳이 되면 언젠가 서로 다른 답을 낸다.
   */
  const member = await prisma.user.findUnique({
    where: { id: userId },
    select: { isOnboarded: true },
  })
  if (member?.isOnboarded) redirect(destination)

  return (
    <div className="bg-surface-card sm:flex sm:min-h-dvh sm:items-center sm:justify-center sm:bg-surface-page sm:px-4 sm:py-12">
      <OnboardingForm destination={destination} />
    </div>
  )
}
