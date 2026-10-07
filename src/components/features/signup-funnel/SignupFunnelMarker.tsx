'use client'

import { useCallback } from 'react'
import {
  useSignupFunnelTracker,
  type SignupFunnelMarkerKind,
} from '@/components/features/signup-funnel/SignupFunnelTracker'

/**
 * 회원가입 전환 감지 지점 — 높이 0 · aria-hidden. 화면에 아무것도 더하지 않는다.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §5-2 · §5-3.
 *
 * 🔴 tracker 밖이면 아무것도 그리지 않는다.
 * 🔴 높이·여백·클래스를 두지 않는다. 앞뒤 블록의 여백은 이 빈 블록을 지나 그대로 맞닿는다.
 */
export default function SignupFunnelMarker({ kind }: { kind: SignupFunnelMarkerKind }) {
  const tracker = useSignupFunnelTracker()
  const register = tracker?.register
  const ref = useCallback((el: HTMLDivElement | null) => register?.(kind, el), [register, kind])

  if (!tracker) return null
  return <div ref={ref} aria-hidden />
}
