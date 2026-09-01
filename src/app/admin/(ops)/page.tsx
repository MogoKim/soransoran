import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin'
import { REAL_MEMBER_WHERE } from '@/lib/admin-format'
import { isOverrideActive } from '@/lib/home-exposure-rules'
import Link from 'next/link'
import { AdminPageHeader, AdminCard, AdminBadge } from '@/components/admin/AdminUi'

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

  const summary = [
    { label: '미처리 신고', value: `${pendingReports}건`, urgent: pendingReports > 0 },
    { label: `최근 ${RECENT_DAYS}일 글`, value: `${recentPosts}건`, urgent: false },
    { label: `최근 ${RECENT_DAYS}일 가입`, value: `${recentMembers}명`, urgent: false },
    {
      label: '홈 고정 · 숨김',
      value: `${pinned} · ${homeHidden}`,
      urgent: false,
    },
  ]

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
      <AdminPageHeader title="운영 홈" description="오늘 확인할 것만 모아 둡니다." />

      {/* 🔴 지금 손대야 하는 것만 위에 둔다. 추이·총계는 두지 않는다 —
             매일 늘기만 하는 숫자는 오늘 할 일을 가린다. */}
      <section className="mt-6">
        <h2 className="m-0 text-sm font-bold text-content-primary">지금 상태</h2>
        <dl className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {summary.map((s) => (
            <div key={s.label} className="rounded-lg border border-subtle bg-surface-card p-3">
              <dt className="text-xs text-content-muted">{s.label}</dt>
              <dd
                className={
                  s.urgent
                    ? 'm-0 text-2xl font-bold text-state-danger'
                    : 'm-0 text-2xl font-bold text-content-primary'
                }
              >
                {s.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-6">
        <h2 className="m-0 text-sm font-bold text-content-primary">바로가기</h2>
        <ul className="mt-2 grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-2">
          {cards.map((card) => (
            <li key={card.href}>
              <AdminCard href={card.href}>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-content-primary">{card.title}</span>
                  <AdminBadge tone={card.urgent ? 'danger' : 'neutral'}>{card.now}</AdminBadge>
                </span>
                <span className="text-sm text-content-muted">{card.hint}</span>
              </AdminCard>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-6 text-xs text-content-muted">
        페르소나 운영은 이 콘솔과 별개입니다 —{' '}
        <Link href="/admin/personas" className="text-link">
          페르소나 화면
        </Link>
      </p>
    </main>
  )
}
