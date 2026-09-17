import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin'
import { REAL_MEMBER_WHERE } from '@/lib/admin-format'
import { isOverrideActive } from '@/lib/home-exposure-rules'
import Link from 'next/link'
import { AdminPageHeader, AdminSection, AdminBadge } from '@/components/admin/AdminUi'

/**
 * 운영 홈 — 오늘 볼 것과 바로가기만 둔다.
 *
 * 🔴 KPI·성장 지표를 두지 않는다.
 *    가입자 추이·DAU 같은 숫자는 판단을 바꾸지 못하면서 화면만 차지한다.
 *    여기 있는 숫자는 전부 "지금 눌러서 처리할 것이 있는가" 에만 답한다.
 *
 * 🔴 숫자를 누적 총계로 쓰지 않는다. 미처리 건수와 최근 7일만 센다 —
 *    총계는 매일 늘기만 해서 오늘 할 일을 가리지 않는다.
 *
 * 🔴 급한 것을 위에 둔다. 카드 순서가 곧 처리 순서다 —
 *    신고는 회원이 이미 불쾌해진 뒤의 신호라 가장 먼저 온다.
 */
export const metadata: Metadata = { title: '운영 홈' }
export const dynamic = 'force-dynamic'

const RECENT_DAYS = 7

export default async function AdminHomePage() {
  const { ok } = await requireAdmin()
  if (!ok) return null

  const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000)
  const now = new Date()

  const [pendingReports, recentPosts, hiddenPosts, recentMembers, blockedMembers, overrides] =
    await Promise.all([
      prisma.report.count({ where: { status: 'PENDING' } }),
      prisma.post.count({ where: { createdAt: { gte: since } } }),
      prisma.post.count({ where: { status: 'HIDDEN' } }),
      // 🔴 회원 수는 실회원 기준이다 — 목록·상세와 같은 조각을 쓴다.
      //    페르소나 User 가 섞이면 "가입이 늘었다" 가 거짓이 된다.
      prisma.user.count({ where: { ...REAL_MEMBER_WHERE, createdAt: { gte: since } } }),
      prisma.user.count({ where: { ...REAL_MEMBER_WHERE, isBlocked: true } }),
      // 🔴 만료 판정은 규칙 함수가 한다. isActive 만 좁혀 가져온다 —
      //    SQL 로 만료를 재면 홈 노출 화면과 답이 갈라진다.
      prisma.homeExposureOverride.findMany({
        where: { surface: 'HOME_POPULAR', isActive: true },
        select: { action: true, isActive: true, expiresAt: true },
      }),
    ])

  const live = overrides.filter((o) => isOverrideActive(o, now))
  const pinned = live.filter((o) => o.action === 'PIN').length
  const homeHidden = live.filter((o) => o.action === 'HIDE').length

  const cards = [
    {
      href: '/admin/reports',
      title: '신고',
      now: pendingReports > 0 ? `미처리 ${pendingReports}건` : '미처리 없음',
      urgent: pendingReports > 0,
      hint:
        pendingReports > 0
          ? '오래 기다린 신고가 맨 위에 있습니다'
          : '새 신고가 들어오면 여기 숫자가 붙습니다',
    },
    {
      href: '/admin/content',
      title: '게시글',
      now: `최근 ${RECENT_DAYS}일 ${recentPosts}건`,
      urgent: false,
      hint:
        hiddenPosts > 0
          ? `숨긴 글 ${hiddenPosts}건 · 제목·본문을 고치거나 가립니다`
          : '제목·본문을 고치거나 가립니다',
    },
    {
      href: '/admin/members',
      title: '회원',
      now: `최근 ${RECENT_DAYS}일 가입 ${recentMembers}명`,
      urgent: false,
      hint:
        blockedMembers > 0
          ? `차단 ${blockedMembers}명 · 가입 정보를 보고 차단을 관리합니다`
          : '가입 정보를 보고 차단을 관리합니다',
    },
    {
      href: '/admin/home',
      title: '홈 노출',
      now: pinned + homeHidden > 0 ? `고정 ${pinned}건 · 숨김 ${homeHidden}건` : '걸린 예외 없음',
      urgent: false,
      hint:
        pinned + homeHidden > 0
          ? '시간이 지나면 저절로 풀립니다. 무엇이 걸렸는지 봅니다'
          : '자동 인기 점수만으로 홈이 채워지고 있습니다',
    },
  ]

  return (
    <main className="pt-2 lg:pt-0">
      <AdminPageHeader title="운영 홈" />

      {/* /admin/home 과 같은 리듬 — 큰 박스 대신 한 줄로 상태를 말한다.
          🔴 이 줄이 화면에서 가장 먼저 읽혀야 하는데 13px 이라 가장 작았다.
             제일 중요한 "미처리 신고" 를 본문 크기로 올리고 나머지는 보조로 내린다.
             문구·숫자·순서는 그대로다. */}
      <p className="m-0 mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-base text-content-primary">
          미처리 신고 <strong>{pendingReports}</strong>
        </span>
        <span className="text-sm text-content-muted">
          최근 {RECENT_DAYS}일 글 {recentPosts} · 가입 {recentMembers}
        </span>
        {pinned + homeHidden > 0 ? (
          <span className="text-sm text-content-muted">
            홈 고정 {pinned} · 숨김 {homeHidden}
          </span>
        ) : null}
      </p>

      {/* 🔴 넓은 화면에서 폭을 묶는다. 1400px 을 네 줄짜리 목록이 다 쓰면
             왼쪽 이름과 오른쪽 배지 사이가 손바닥만큼 벌어져 눈이 중간에서 끊긴다.
             줄 수·문구·순서는 그대로다 — 가로로만 모은다. */}
      <AdminSection title="오늘 확인할 것" className="mt-6 lg:max-w-3xl">
        {/* 🔴 목록을 카드 면에 올린다 (2026-09-17).
               globals.css §표면: "hover 가 있는 행을 바탕 위에 직접 놓지 않는다. 카드 안에 넣는다.
               바탕 위에 놓으면 hover 색이 바탕색과 가까워져 아무 일도 일어나지 않는다."
               이 목록이 정확히 그 경우였다 — 실측으로 hover(#F2F3F5)가
               바탕(#FBFAF9) 위에서 1.065:1 이라 눌러도 아무 반응이 없어 보였다.
               흰 카드 위에서는 1.110:1 로 의도한 면 분리가 산다.
               줄 수·문구·순서·링크는 그대로다 — 바탕만 카드로 바꾼다. */}
        <ul className="m-0 mt-3 flex list-none flex-col overflow-hidden rounded-lg border border-subtle bg-surface-card p-0">
          {cards.map((card) => (
            <li key={card.href} className="border-b border-subtle last:border-b-0">
              <Link
                href={card.href}
                className="flex min-h-[52px] flex-col gap-1 px-3 py-3 no-underline hover:bg-surface-soft lg:min-h-[60px] lg:flex-row lg:items-center lg:gap-4 lg:px-4"
              >
                <span className="shrink-0 text-base font-bold text-content-primary lg:w-24">
                  {card.title}
                </span>
                <span className="flex-1 text-sm text-content-secondary">{card.hint}</span>
                <span className="shrink-0">
                  <AdminBadge tone={card.urgent ? 'warning' : 'neutral'}>{card.now}</AdminBadge>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </AdminSection>
    </main>
  )
}
