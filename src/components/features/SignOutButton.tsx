'use client'

import { signOut } from 'next-auth/react'
import { TOUCH_MIN } from '@/lib/spacing'

/**
 * 로그아웃 버튼
 *
 * NextAuth v5 의 client signOut 을 쓴다.
 * 세션 쿠키를 지운 뒤 홈으로 보낸다.
 */
export default function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: '/' })}
      className={`inline-flex ${TOUCH_MIN} items-center rounded-lg px-3 text-sm text-content-muted transition duration-150 hover:bg-surface-soft active:scale-[0.98]`}
    >
      로그아웃
    </button>
  )
}
