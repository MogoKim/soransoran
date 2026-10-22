import Link from 'next/link'

/**
 * 「회원」 영역의 공통 하위 탭 — 회원 관리 · 고객 구성 · 가입 전환.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §10.
 *
 * 🔴 세 화면이 이 컴포넌트 하나를 쓴다. 화면마다 따로 링크·되돌아가기를 두지 않는다.
 * 🔴 상위 운영 메뉴는 늘리지 않는다. 세 경로 모두 /admin/members 아래라 「회원」 메뉴가 켜진다.
 * 🔴 회원 상세에는 두지 않는다. 상세는 목록으로 돌아가는 화면이다.
 * 🔴 지금 화면은 부르는 쪽이 알려 준다 — 서버 컴포넌트로 두고 client 조각을 만들지 않는다.
 */
/** 🔴 사이드바의 「회원」 하위 메뉴(AdminNav)도 이 목록을 그대로 쓴다 — 두 곳에 적지 않는다 */
export const TABS = [
  { key: 'members', href: '/admin/members', label: '회원 관리' },
  { key: 'composition', href: '/admin/members/composition', label: '고객 구성' },
  { key: 'conversion', href: '/admin/members/conversion', label: '가입 전환' },
] as const

export type MemberAdminTab = (typeof TABS)[number]['key']

export default function MemberAdminTabs({ current }: { current: MemberAdminTab }) {
  return (
    <nav aria-label="회원 하위 메뉴" className="mb-6 overflow-x-auto">
      <ul className="m-0 flex list-none gap-6 border-b border-subtle p-0">
        {TABS.map((tab) => {
          const active = tab.key === current
          return (
            <li key={tab.key}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                /* 🔴 선택 표시: 코랄 밑줄 2px + 먹색 굵은 글자 + aria-current (Admin Golden Master · 활성 탭).
                      --cta 가 아니라 --brand 를 쓴다 — 누르는 면이 아니라 "지금 여기" 표시다.
                      터치 높이 — 모바일 52 · 데스크탑 44 */
                className={`-mb-px inline-flex min-h-[52px] items-center whitespace-nowrap border-b-2 text-sm no-underline transition-colors lg:min-h-[44px] ${
                  active
                    ? 'border-brand font-bold text-content-primary'
                    : 'border-transparent text-content-secondary hover:text-content-primary'
                }`}
              >
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
