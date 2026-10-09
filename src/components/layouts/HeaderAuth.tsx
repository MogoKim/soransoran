import Link from 'next/link'
import { TOUCH_MIN } from '@/lib/spacing'
import { checkAdminForUser } from '@/lib/admin'
import { getRequestSession } from '@/lib/request-session'

/**
 * 헤더 우측 인증 영역 — 서버 컴포넌트
 *
 * SessionProvider 를 두지 않고 서버에서 세션을 읽는다.
 * 클라이언트 세션 훅을 쓰지 않는 현재 구조와 일관된다.
 *
 * 🔴 세션은 getRequestSession 으로 읽는다. 같은 요청의 콘텐츠 상세와 판정 한 번을 나눠 쓴다.
 *    관리자 판정도 이미 읽은 세션의 id 로 한다 — auth() 를 다시 부르지 않는다.
 *
 * 비로그인   [로그인]
 * 로그인     (사람아이콘)
 * 관리자     신고확인  (사람아이콘)
 *
 * 🔴 로그인 상태는 아이콘 하나로 끝낸다.
 *    이름은 좁은 화면에서 숨었고, 로그아웃은 헤더에 상주할 만큼 자주 쓰는 일이 아니다.
 *    둘을 걷어내면 계정으로 가는 길이 하나로 남아 어디를 눌러야 할지 헷갈리지 않는다.
 *    이름·로그아웃은 /my 안에 있다.
 *
 * 🔴 이름을 헤더에 싣지 않는 이유가 하나 더 있다 —
 *    세션의 이름은 로그인 시점 값이라, 닉네임을 바꿔도 다음 로그인까지 옛 이름이 남는다.
 */
export default async function HeaderAuth() {
  const session = await getRequestSession()

  if (!session?.user) {
    return (
      <Link
        href="/login"
        className={`inline-flex ${TOUCH_MIN} items-center rounded-lg border border-interactive px-4 text-sm font-bold text-brand-strong no-underline transition duration-150 hover:bg-surface-soft active:scale-[0.98]`}
      >
        로그인
      </Link>
    )
  }

  const { ok: isAdmin } = session.user.id ? await checkAdminForUser(session.user.id) : { ok: false }

  return (
    <div className="flex items-center gap-1">
      {isAdmin ? (
        <Link
          href="/admin/reports"
          className={`inline-flex ${TOUCH_MIN} items-center rounded-lg px-3 text-sm font-bold text-brand-strong no-underline transition duration-150 hover:bg-surface-soft active:scale-[0.98]`}
        >
          신고 확인
        </Link>
      ) : null}
      <Link
        href="/my"
        aria-label="내 정보"
        className={`inline-flex ${TOUCH_MIN} min-w-[52px] items-center justify-center rounded-lg text-content-primary no-underline transition duration-150 hover:bg-surface-soft active:scale-[0.98]`}
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="8" r="3.6" />
          <path d="M4.8 20c0-3.4 3.2-5.6 7.2-5.6s7.2 2.2 7.2 5.6" />
        </svg>
      </Link>
    </div>
  )
}
