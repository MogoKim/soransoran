import Link from 'next/link'
import { TOUCH_MIN } from '@/lib/spacing'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { loginHref, onboardingHref } from '@/lib/callback-url'
import { requireOnboarded } from '@/lib/onboarding-guard'

/**
 * 마이페이지 다섯 화면이 함께 쓰는 조각.
 *
 * 🔴 게이트를 화면마다 다시 적지 않는다. 네 줄짜리라도 다섯 곳에 흩어지면
 *    한 곳을 고칠 때 나머지를 잊는다 — 로그인 화면이 그렇게 어긋난다.
 */

/** 로그인·온보딩을 통과한 회원의 id. 아니면 이 자리에서 보낸다 */
export async function requireMyUserId(returnTo: string): Promise<string> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) redirect(loginHref(returnTo))

  const blocked = await requireOnboarded(userId)
  if (blocked?.needsOnboarding) redirect(onboardingHref(returnTo))
  // 회원 정보가 없으면 세션만 남은 상태다. 다시 로그인시킨다.
  if (blocked) redirect(loginHref(returnTo))

  return userId
}

/** 하위 화면의 되돌아가는 줄. 목록·상세가 쓰는 표시를 그대로 쓴다 */
export function BackToMy() {
  return (
    <nav aria-label="이동">
      <Link href="/my" className={`inline-flex ${TOUCH_MIN} items-center text-sm text-link`}>
        ← 내 정보
      </Link>
    </nav>
  )
}

/**
 * 메뉴 한 줄 — 왼쪽 라벨, 오른쪽 화살표.
 *
 * 🔴 허브는 읽는 화면이 아니라 고르는 화면이다. 그래서 카드가 아니라 줄로 세운다.
 *    줄마다 면을 주면 열 줄이 열 개의 상자가 되어 무엇을 고를지가 흐려진다.
 */
export function MenuRow({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <Link
        href={href}
        className="flex min-h-[56px] items-center gap-3 py-1 text-content-primary no-underline transition-colors duration-150 hover:text-brand-strong active:text-brand-strong"
      >
        <span className="break-keep">{label}</span>
        <span aria-hidden className="ml-auto shrink-0 text-content-muted">
          →
        </span>
      </Link>
    </li>
  )
}

/**
 * 빈 목록 안내 — 문구 한 줄과 갈 곳 하나.
 *
 * 🔴 **면은 주되 카드로 키우지 않는다.** 면이 없으면 "빈 방" 이 아니라
 *    "덜 그려진 화면" 으로 읽힌다(`EmptyState` 주석 · /best 사례). 그렇다고
 *    `EmptyState` 를 그대로 쓰면 흰 카드가 목록 위에 앉아 my 목록 톤에서 과하다
 *    — 실측 박스 높이가 이 형태의 1.7배다.
 *
 * 🔴 **핵심은 면이 아니라 갈 곳이다.** 여기서 막히면 다음 행동까지 세 번 이동해야 한다
 *    (my/* 에는 글쓰기 FAB 도 없다). 그래서 CTA 가 본체다.
 *
 * 🔴 **CTA 는 채운 버튼이 아니라 링크다.** `EmptyState` 의 코랄 fill 버튼은 흰 글자가
 *    2.73:1 인데(§3-1-B CTA 예외), `--link` 는 바탕 위 4.95:1 이라 AA 를 넘는다.
 *    이 화면에 새로 들이는 값이라 대비가 높은 쪽을 고른다. 밑줄은 토큰 규칙상 필수다.
 */
export function EmptyNotice({ text, cta, href }: { text: string; cta: string; href: string }) {
  return (
    <div className="mt-2 flex flex-col items-start gap-2 rounded-lg border border-subtle bg-surface-page px-4 py-6">
      <p className="m-0 leading-relaxed text-content-muted">{text}</p>
      <Link
        href={href}
        className={`inline-flex ${TOUCH_MIN} items-center text-link underline underline-offset-2`}
      >
        {cta} →
      </Link>
    </div>
  )
}

/** 메뉴 묶음. 줄 사이만 가른다 */
export function MenuGroup({ children }: { children: React.ReactNode }) {
  return (
    <ul className="m-0 flex list-none flex-col p-0 [&>li+li]:border-t [&>li+li]:border-subtle">
      {children}
    </ul>
  )
}
