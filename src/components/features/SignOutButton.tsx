'use client'

import { signOut } from 'next-auth/react'

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
      className="inline-flex min-h-[52px] items-center rounded-lg px-3 text-sm text-content-muted"
    >
      로그아웃
    </button>
  )
}
