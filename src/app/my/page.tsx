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
      {/* 🔴 여기만 `pt-6` 이고 형제 5화면은 `pt-3` 인 것은 의도다. 대칭으로 맞추지 않는다.

          🔴 `/my` 에는 `<BackToMy />` 가 없다 — 자기 자신이라 돌아갈 곳이 없다.
             형제 5화면(posts·scraps·comments·nickname·withdrawal)은
             `pt-3` + `BackToMy` 52px + `h1 mt-2` 구조라 h1 이 226px 에 선다.
             `pt-6` 은 그 52px 빈자리를 부분적으로 메우는 값이다.

          🔴 그래서 `pt-3` 으로 줄이면 축이 맞는 게 아니라 더 벌어진다 —
             (390px 실측: 형제와의 h1 위치 차이가 48px → 60px)

          🔴 "크게" 에서 첫 화면 링크는 8/10 → 8/10 으로 이득이 없다.
             기본·1280px 에서만 링크가 하나 늘고, 그 대가로 이름 h1 이 상단 메뉴에 12px 더 붙는다.
             이 화면은 이름이 주인공이다(바로 아래 h1 주석).

          🔴 중간안 `pt-4`·`pt-5` 는 링크 이득이 같으면서 설명 없는 값만 늘린다. 채택하지 않는다.
             결론: `pt-6` 현재 유지. 상세는 정본 §13-3 참조. */}
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-6">
        {/* 🔴 이름이 이 화면의 주인공이다. 섹션 제목보다 크게 둔다 —
              같은 크기면 "소란맘" 과 "내가 쓴 글" 이 구별되지 않는다. */}
        <h1 className="text-xl font-bold text-content-primary">{displayName(profile)}</h1>
        <p className="mt-1 text-sm text-content-muted">
          {joinedOn(profile.createdAt)} · 카카오 로그인
        </p>

        {/* 🔴 두 섹션의 라벨 방식이 다른 것은 의도다 — 대칭으로 맞추지 않는다.
              위는 `aria-label` 로만, 아래는 보이는 h2 로 이름을 준다.

            🔴 접근성 결함이 아니다. 둘 다 접근 가능한 이름이 있어 landmark 로 노출된다.
               (실측: region "내 활동" · region "안내" — heading 축에서만 비대칭이다)

            🔴 보이는 h2 를 두 섹션 모두에 두면 "크게" 에서 첫 화면 링크가 8개 → 7개로 준다.
               (390px 실측: 제목을 섹션 축 24px 로 올리면 첫 항목이 45px 밀리고 문서가 56px 길어진다.
                지금 크기 그대로 h2 만 하나 더 얹어도 33px 밀리고 링크는 똑같이 하나 잃는다)

            🔴 마이는 메뉴를 빠르게 고르는 허브다. 읽는 화면이 아니라 **링크 밀도가 값이다.**
               제목을 세우는 대신 링크가 한 화면에 더 들어오는 쪽을 고른다.

            🔴 그래서 "안내" h2 는 큰 섹션 제목이 아니라 **보조 그룹 라벨**이다.
               `text-sm`(18px) 인 것이 실수가 아니라 그 역할이라서다 — 위 묶음은 h1(이름) 바로
               아래라 무엇인지 자명하고, 아래 묶음만 성격이 달라 가르는 표시가 필요했다.
               상세·보류 사유는 정본 §12-13 참조. */}
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
