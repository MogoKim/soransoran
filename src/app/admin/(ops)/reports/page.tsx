import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin'
import ReportCard from '@/components/admin/ReportCard'
import { AdminPageHeader, AdminSection, AdminEmptyState } from '@/components/admin/AdminUi'

/**
 * 신고 관리 — 이 화면에서 판단하고 조치까지 끝낸다.
 *
 * 여기는 조회만 한다. 카드 화면은 ReportCard 가 맡는다.
 *
 * 🔴 최신 N건을 받아 그 안에서 PENDING 을 고르지 않는다.
 *    신고가 쌓이면 오래된 미처리가 N건 밖으로 밀려 화면에서 사라진다 —
 *    가장 오래 방치된 건이 가장 먼저 안 보이게 된다.
 *    PENDING 과 처리분을 각각 따로 조회한다.
 *
 * 🔴 미처리 수는 count 로 센다. 실은 목록의 길이가 아니다.
 *
 * 🔴 대상 작성자(post.author · comment.author)를 함께 가져온다.
 *    Report 에는 피신고자 컬럼이 없다 — 관계를 타고 가면 스키마를 바꾸지 않아도 된다.
 *    accounts·persona 는 실회원 판정 재료다(isRealMember). 빠뜨리면 타입이 막는다.
 *
 * 🔴 신고 자체는 숨기지 않는다. 페르소나 글이 신고당해도 목록에는 남는다 —
 *    조치 버튼만 가린다(ReportCard).
 *
 * 미처리는 오래된 순, 처리분은 최신순으로 아래에 접어 둔다. 섞으면 미처리가 묻힌다.
 */
export const metadata: Metadata = { title: '신고 관리' }
export const dynamic = 'force-dynamic'

/** 한 번에 싣는 최대 건수 — 미처리·처리분 각각에 적용한다 */
const TAKE = 100

const AUTHOR_SELECT = {
  select: {
    id: true,
    nickname: true,
    name: true,
    isAdmin: true,
    isBlocked: true,
    accounts: { where: { provider: 'kakao' }, select: { id: true }, take: 1 },
    persona: { select: { id: true } },
  },
} as const

/** 미처리와 처리분이 같은 필드를 읽는다. 두 번 적으면 한쪽만 고쳐지는 날이 온다. */
const SELECT = {
  id: true,
  reason: true,
  detail: true,
  status: true,
  createdAt: true,
  reviewedAt: true,
  reporter: { select: { id: true, nickname: true, name: true } },
  post: {
    select: {
      id: true,
      title: true,
      content: true,
      status: true,
      boardType: true,
      author: AUTHOR_SELECT,
    },
  },
  comment: {
    select: {
      id: true,
      content: true,
      isDeleted: true,
      postId: true,
      author: AUTHOR_SELECT,
      guestNickname: true,
    },
  },
} as const

export default async function AdminReportsPage() {
  const { ok } = await requireAdmin()
  if (!ok) return null

  const [pendingCount, pending, handled] = await Promise.all([
    prisma.report.count({ where: { status: 'PENDING' } }),
    prisma.report.findMany({
      where: { status: 'PENDING' },
      select: SELECT,
      orderBy: { createdAt: 'asc' },
      take: TAKE,
    }),
    prisma.report.findMany({
      where: { status: { not: 'PENDING' } },
      select: SELECT,
      orderBy: { createdAt: 'desc' },
      take: TAKE,
    }),
  ])

  return (
    <main className="pt-2 lg:pt-0">
      <AdminPageHeader title="신고" />

      {/* 상단 요약 — /admin/home 과 같은 리듬. 미처리가 0이어도 상태를 한 줄로 말한다 */}
      <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="text-content-primary">
          미처리 <strong>{pendingCount}</strong> · 처리 완료 <strong>{handled.length}</strong>
        </span>
        <span className="text-content-muted">
          {pendingCount > 0
            ? '오래 기다린 신고가 맨 위입니다'
            : '새 신고가 들어오면 여기 맨 위에 쌓입니다'}
        </span>
      </p>

      {pending.length > 0 ? (
        <AdminSection title={`처리할 신고 ${pendingCount}건`} description="오래된 순" className="mt-5">
          <ul className="mt-2 flex list-none flex-col gap-3 p-0">
            {pending.map((report) => (
              <ReportCard key={report.id} report={report} />
            ))}
          </ul>
        </AdminSection>
      ) : (
        <div className="mt-5">
          <AdminEmptyState>지금 처리할 신고가 없습니다.</AdminEmptyState>
        </div>
      )}

      {/* 🔴 처리분은 접어 둔다. 펼친 채 두면 미처리가 처리분 100건 위의 한 줄이 된다. */}
      {handled.length > 0 ? (
        <section className="mt-6 border-t border-subtle pt-4">
          <details>
            <summary className="min-h-[44px] cursor-pointer list-none py-2 text-sm font-bold text-content-primary">
              처리한 신고 {handled.length}건 보기{' '}
              <span className="font-normal text-content-muted">(최신순)</span>
            </summary>
            <ul className="mt-2 flex list-none flex-col gap-3 p-0">
              {handled.map((report) => (
                <ReportCard key={report.id} report={report} />
              ))}
            </ul>
          </details>
        </section>
      ) : null}
    </main>
  )
}
