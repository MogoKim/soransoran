import Link from 'next/link'
import { auth } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin'
import SignOutButton from '@/components/features/SignOutButton'

/**
 * 헤더 우측 인증 영역 — 서버 컴포넌트
 *
 * SessionProvider 를 두지 않고 서버에서 auth() 로 세션을 읽는다.
 * 클라이언트 세션 훅을 쓰지 않는 현재 구조와 일관된다.
 *
 * 비로그인   [로그인]
 * 로그인     홍길동님  [로그아웃]
 * 관리자     신고확인  홍길동님  [로그아웃]
 */
export default async function HeaderAuth() {
  const session = await auth()

  if (!session?.user) {
    return (
      <Link
        href="/login"
        className="inline-flex min-h-[52px] items-center rounded-lg border border-interactive px-4 text-sm font-bold text-brand-ink no-underline"
      >
        로그인
      </Link>
    )
  }

  const { ok: isAdmin } = await requireAdmin()
  const displayName = session.user.name?.trim() || '회원'

  return (
    <div className="flex items-center gap-1">
      {isAdmin ? (
        <Link
          href="/admin/reports"
          className="inline-flex min-h-[52px] items-center rounded-lg px-3 text-sm font-bold text-brand-ink no-underline"
        >
          신고 확인
        </Link>
      ) : null}
      <span className="hidden px-1 text-sm text-content-muted sm:inline">{displayName}님</span>
      <SignOutButton />
    </div>
  )
}
