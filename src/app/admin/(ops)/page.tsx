import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin'

/**
 * 운영 홈 — 바로가기와 "지금 확인할 것" 만 둔다.
 *
 * 🔴 KPI·성장 지표를 두지 않는다.
 *    가입자 추이·DAU 같은 숫자는 판단을 바꾸지 못하면서 화면만 차지한다.
 *    여기 있는 숫자는 전부 "지금 눌러서 처리할 것이 있는가" 에만 답한다.
 *
 * 🔴 숫자를 누적 총계로 쓰지 않는다. 미처리 건수와 최근 7일만 센다 —
 *    총계는 매일 늘기만 해서 오늘 할 일을 가리지 않는다.
 */
export const metadata: Metadata = { title: '운영 홈' }
export const dynamic = 'force-dynamic'

const RECENT_DAYS = 7

export default async function AdminHomePage() {
  const { ok } = await requireAdmin()
  if (!ok) return null

  const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000)

  const [pendingReports, recentPosts, recentMembers, blockedMembers] = await Promise.all([
    prisma.report.count({ where: { status: 'PENDING' } }),
    prisma.post.count({ where: { createdAt: { gte: since } } }),
    prisma.user.count({ where: { createdAt: { gte: since } } }),
    prisma.user.count({ where: { isBlocked: true } }),
  ])

  const cards = [
    {
      href: '/admin/reports',
      title: '신고 관리',
      now: pendingReports > 0 ? `미처리 ${pendingReports}건` : '미처리 없음',
      urgent: pendingReports > 0,
      hint: '신고를 확인하고 글·댓글을 가립니다',
    },
    {
      href: '/admin/content',
      title: '게시글 관리',
      now: `최근 ${RECENT_DAYS}일 ${recentPosts}건`,
      urgent: false,
      hint: '제목·본문을 고치거나 숨깁니다',
    },
    {
      href: '/admin/members',
      title: '회원 관리',
      now: `최근 ${RECENT_DAYS}일 가입 ${recentMembers}명${blockedMembers > 0 ? ` · 차단 ${blockedMembers}명` : ''}`,
      urgent: false,
      hint: '가입 정보를 보고 차단을 관리합니다',
    },
    {
      href: '/admin/home',
      title: '홈 노출',
      now: '지금 홈에 뜬 글 확인',
      urgent: false,
      hint: '무엇이 왜 떴는지 봅니다 (읽기 전용)',
    },
  ]

  return (
    <main>
      <h1 className="pt-8 text-xl font-bold text-content-primary">운영 홈</h1>
      <p className="mt-1 text-sm text-content-muted">지금 확인할 것만 모아 둡니다.</p>

      <ul className="mt-6 flex list-none flex-col gap-3 p-0">
        {cards.map((card) => (
          <li key={card.href}>
            <Link
              href={card.href}
              className="flex min-h-[52px] flex-col gap-1 rounded-lg border border-subtle bg-surface-card p-4 no-underline"
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-content-primary">{card.title}</span>
                <span
                  className={
                    card.urgent
                      ? 'rounded-md bg-surface-soft px-2 py-1 text-xs font-bold text-state-danger'
                      : 'rounded-md bg-surface-soft px-2 py-1 text-xs text-content-muted'
                  }
                >
                  {card.now}
                </span>
              </span>
              <span className="text-sm text-content-muted">{card.hint}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
