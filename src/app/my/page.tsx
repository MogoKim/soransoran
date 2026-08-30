import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getMyProfile } from '@/lib/queries/my'
import { loginHref } from '@/lib/callback-url'
import { displayName } from '@/lib/display-name'
import PageShell from '@/components/layouts/PageShell'
import SignOutButton from '@/components/features/SignOutButton'
import { requireMyUserId, MenuGroup, MenuRow } from '@/components/features/my/shell'

export const dynamic = 'force-dynamic'

/** 내 계정 화면은 검색 결과에 있을 이유가 없다 */
export const metadata: Metadata = {
  title: '내 정보',
  robots: { index: false, follow: false },
}

const MY_PATH = '/my'

/**
 * 🔴 허브는 메뉴판이다. 폼도 목록도 긴 안내문도 여기서 펼치지 않는다.
 *    한 화면에 다 펼치면 "내 계정" 이 아니라 관리 화면이 된다 —
 *    무엇을 하러 왔든 스크롤부터 해야 한다. 고를 것만 세우고 안은 각자 화면에 둔다.
 */
const MENU = [
  { href: '/my/nickname', label: '닉네임 변경' },
  { href: '/my/posts', label: '내가 쓴 글' },
  { href: '/my/comments', label: '내가 쓴 댓글' },
  { href: '/my/scraps', label: '스크랩한 글' },
] as const

const GUIDE = [
  { href: '/contact', label: '문의하기' },
  { href: '/faq', label: '자주 묻는 질문' },
  { href: '/rules', label: '커뮤니티 규칙' },
  { href: '/terms', label: '이용약관' },
  { href: '/privacy', label: '개인정보처리방침' },
  { href: '/my/withdrawal', label: '탈퇴 안내' },
] as const

function joinedOn(date: Date): string {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 가입`
}

export default async function MyPage() {
  const userId = await requireMyUserId(MY_PATH)
  const profile = await getMyProfile(userId)
  if (!profile) redirect(loginHref(MY_PATH))

  return (
    <PageShell>
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-6">
        {/* 🔴 이름이 이 화면의 주인공이다. 섹션 제목보다 크게 둔다 —
              같은 크기면 "소란맘" 과 "내가 쓴 글" 이 구별되지 않는다. */}
        <h1 className="text-xl font-bold text-content-primary">{displayName(profile)}</h1>
        <p className="mt-1 text-sm text-content-muted">
          {joinedOn(profile.createdAt)} · 카카오 로그인
        </p>

        <section className="mt-6" aria-label="내 활동">
          <MenuGroup>
            {MENU.map((item) => (
              <MenuRow key={item.href} {...item} />
            ))}
          </MenuGroup>
        </section>

        <section className="mt-8" aria-labelledby="my-guide">
          <h2 id="my-guide" className="text-sm font-medium text-content-muted">
            안내
          </h2>
          <div className="mt-1">
            <MenuGroup>
              {GUIDE.map((item) => (
                <MenuRow key={item.href} {...item} />
              ))}
            </MenuGroup>
          </div>
        </section>

        <div className="mt-8 border-t border-subtle pt-4">
          <SignOutButton />
        </div>
      </main>
    </PageShell>
  )
}
