import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin'
import { REAL_MEMBER_WHERE } from '@/lib/admin-format'
import { isOverrideActive } from '@/lib/home-exposure-rules'
import Link from 'next/link'
import { AdminPageHeader, AdminSection, AdminBadge, AdminStat, AdminStatStrip } from '@/components/admin/AdminUi'

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
 * 🔴 급한 것을 앞에 둔다. 칸 순서가 곧 처리 순서다 —
 *    신고는 회원이 이미 불쾌해진 뒤의 신호라 가장 먼저 온다.
 *
 * 🔴 「오늘 확인할 것」 4칸은 카드 4장이 아니라 한 띠 안의 칸이다(Admin Golden Master · 2026-10-22).
 *    값은 아래 조회 여섯 개에서만 나온다 — 칸을 위해 조회를 늘리지 않는다.
 *    칸마다 그 관리자 화면으로 가는 길만 둔다. 상승률 · 그래프를 붙이지 않는다.
 */
export const metadata: Metadata = { title: '운영 홈' }
export const dynamic = 'force-dynamic'

const RECENT_DAYS = 7

/** 자동 운영 화면 — 메뉴(AdminNav)의 「자동 운영」 묶음과 같은 순서 · 같은 이름 */
const AUTO_LINKS = [
  { href: '/admin/personas', title: '페르소나 관제', hint: '상태 · 전체 중지 스위치' },
  { href: '/admin/persona-candidates', title: '댓글 후보 대기열', hint: '결정 · 대상 지정 · 발행' },
  { href: '/admin/original-post-candidates', title: '글 초안 대기열', hint: '읽기 전용 검수' },
  { href: '/admin/auto-ready-evidence', title: '정확도 표본 검토', hint: '자동 READY 증거 묶음 검토' },
  { href: '/admin/auto-ready-defects', title: '중대 결함 신고', hint: '자동 발행된 글의 중대 결함 기록' },
] as const

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
      go: '신고 열기',
    },
    {
      href: '/admin/content',
      title: '게시글',
      now: `최근 ${RECENT_DAYS}일 ${recentPosts}건`,
      urgent: false,
      hint:
        hiddenPosts > 0
          ? `숨긴 글 ${hiddenPosts}건 · 제목·본문을 수정하거나 숨깁니다`
          : '제목·본문을 수정하거나 숨깁니다',
      go: '게시글 열기',
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
      go: '회원 관리 열기',
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
      go: '홈 노출 열기',
    },
  ]

  return (
    <div>
      <AdminPageHeader
        group="운영 홈"
        title="운영 홈"
        description={`오늘 처리할 것부터 앞에 둡니다. 숫자는 미처리와 최근 ${RECENT_DAYS}일만 셉니다.`}
      />

      <AdminSection title="오늘 확인할 것" className="mt-0">
        <AdminStatStrip columns={4}>
          {cards.map((card) => (
            <AdminStat
              key={card.href}
              href={card.href}
              label={card.title}
              value={card.now}
              note={card.hint}
              linkLabel={card.go}
              attention={card.urgent}
              /* 🔴 색만으로 말하지 않는다 — 처리할 것이 있는 칸에만 문구 배지 */
              flag={card.urgent ? <AdminBadge tone="warning">처리 필요</AdminBadge> : undefined}
            />
          ))}
        </AdminStatStrip>
      </AdminSection>

      {/* 🔴 자동 운영 바로가기 — 건수를 붙이지 않는다.
             여기서 세려면 페르소나·후보·감사 표를 새로 조회해야 한다. 조회를 늘리지 않는다.
             숫자는 각 화면에서 본다. 상자 대신 두 열 목록 — 행 사이 선만 둔다. */}
      <AdminSection title="자동 운영" description="건수는 각 화면에서 확인합니다.">
        <ul className="m-0 mt-3 grid list-none grid-cols-1 gap-x-8 p-0 sm:grid-cols-2">
          {AUTO_LINKS.map((a) => (
            <li key={a.href} className="border-b border-[color:var(--admin-divider)]">
              <Link
                href={a.href}
                className="flex min-h-[56px] flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-2 no-underline hover:bg-[color:var(--admin-row-hover)] focus-visible:outline-offset-[-2px]"
              >
                <span className="text-sm font-semibold text-content-primary">{a.title}</span>
                <span className="text-xs text-content-muted">{a.hint}</span>
              </Link>
            </li>
          ))}
        </ul>
      </AdminSection>
    </div>
  )
}
