import type { ReactNode } from 'react'
import type { SignupFunnelContentType } from '@/lib/signup-funnel'
import SignupFunnelTracker from '@/components/features/signup-funnel/SignupFunnelTracker'

/**
 * 회원가입 전환 tracker 경계 — active 일 때만 client tracker 로 감싼다.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §8-7 · §8-11.
 *
 * 🔴 active 는 페이지가 isSignupFunnelTracking() 로 한 번 정해 넘긴다. 감지 지점도 같은 값으로 그린다.
 * 🔴 active 가 아니면 children 을 그대로 돌려준다 — 감싸는 DOM 도 client 조각도 없다.
 */
export default function SignupFunnelBoundary({
  active,
  contentType,
  children,
}: {
  active: boolean
  contentType: SignupFunnelContentType
  children: ReactNode
}) {
  if (!active) return <>{children}</>
  return <SignupFunnelTracker contentType={contentType}>{children}</SignupFunnelTracker>
}
