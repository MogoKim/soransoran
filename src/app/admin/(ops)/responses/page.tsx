import type { Metadata } from 'next'
import Link from 'next/link'
import { requireAdmin } from '@/lib/admin'
import { prisma } from '@/lib/prisma'
import { formatKst } from '@/lib/admin-format'
import { loadMemberResponseBoard } from '@/lib/queries/member-response'
import { MEMBER_RESPONSE_LIST_MAX, MEMBER_RESPONSE_TARGET_MS } from '@/lib/member-response'
import { adminButtonClass } from '@/components/admin/AdminButton'
import { AdminBadge, AdminEmptyState, AdminNotice, AdminPageHeader, AdminSection } from '@/components/admin/AdminUi'

/**
 * 답 기다리는 글 — 최근 7일 실회원 글 중 아직 사람의 답이 없는 글.
 *
 * 🔴 정책 정본은 src/lib/member-response.ts 머리 주석이다. 이 화면은 그 판정을 그대로 그린다.
 *    "답함" 으로 셀 것 · 기한 · 새벽 꼬리표를 여기서 다시 정하지 않는다.
 * 🔴 답은 기존 직접 작성(/admin/compose) 댓글로 쓴다 — 이 화면에 쓰기 경로를 두지 않는다.
 *    「답 쓰기」는 그 글이 고른 채로 열리는 링크일 뿐이고, 자격은 저장 트랜잭션이 다시 판정한다.
 * 🔴 수동 "처리함" 버튼이 없다. 답이 달리면 저절로 빠지고, 그 답이 지워지면 다시 돌아온다.
 * 🔴 오래 기다린 글이 맨 위다. 최신 N건 정렬이면 오래 방치된 글이 먼저 밀려 사라진다(신고 화면과 같은 이유).
 * 🔴 처리 대기 신고가 걸린 글도 빼지 않는다 — 신고 한 건으로 회원 글이 방치되지 않게 배지로만 알린다.
 */
export const metadata: Metadata = { title: '답 기다리는 글', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

const TARGET_HOURS = MEMBER_RESPONSE_TARGET_MS / 3_600_000

function waitedLabel(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}시간 ${m}분째` : `${m}분째`
}

export default async function AdminResponsesPage() {
  const { ok } = await requireAdmin()
  if (!ok) return null

  const now = new Date()
  const { rows, summary, truncated } = await loadMemberResponseBoard(prisma, now)

  return (
    <>
      <AdminPageHeader
        group="콘텐츠 운영"
        title="답 기다리는 글"
        description={`최근 7일 실회원 글 중 아직 사람의 답(회원 · 손님 · 운영자 이름)이 없는 글입니다. ${TARGET_HOURS}시간이 지나면 기한 넘김입니다.`}
      />

      <p className="m-0 text-sm text-content-secondary">
        최근 7일 실회원 글 {summary.total} · 답 받음 {summary.answered}(
        {TARGET_HOURS}시간 안 {summary.answeredWithinTarget} · 회원 {summary.byResponder.member} · 손님{' '}
        {summary.byResponder.guest} · 운영 {summary.byResponder.operator}) · 기다림 {summary.waiting} · 기한 넘김{' '}
        {summary.overdue} · 판정 불가 {summary.unknown}
      </p>

      {truncated ? (
        <div className="mt-3">
          <AdminNotice tone="warning" title={`최근 7일 실회원 글이 ${MEMBER_RESPONSE_LIST_MAX}편을 넘었습니다`}>
            오래된 글부터 {MEMBER_RESPONSE_LIST_MAX}편만 판정했습니다. 그보다 최근 글은 이 화면에 없습니다.
          </AdminNotice>
        </div>
      ) : null}

      <AdminSection
        title={`답 기다리는 글 ${rows.length}편`}
        description="판정 불가가 맨 위, 그다음은 오래 기다린 순입니다."
        className="mt-6"
      >
        {rows.length === 0 ? (
          <div className="mt-2">
            <AdminEmptyState>지금 답을 기다리는 실회원 글이 없습니다.</AdminEmptyState>
          </div>
        ) : (
          <ul className="m-0 mt-3 flex list-none flex-col border-y border-[color:var(--admin-border)] p-0">
            {rows.map((row) => (
              <li key={row.id} className="border-b border-[color:var(--admin-divider)] px-1 py-4 last:border-b-0">
                <div className="flex flex-wrap items-center gap-2">
                  {row.verdict.state === 'unknown' ? <AdminBadge tone="warning">판정 불가</AdminBadge> : null}
                  {row.verdict.state === 'overdue' ? <AdminBadge tone="danger">기한 넘김</AdminBadge> : null}
                  {row.pendingReport ? <AdminBadge tone="warning">신고 대기</AdminBadge> : null}
                  {row.verdict.personaPresent ? <AdminBadge tone="warning">자동 Persona 댓글 · 점검</AdminBadge> : null}
                  {row.isDawn ? <AdminBadge>새벽 글</AdminBadge> : null}
                  {row.isGreeting ? <AdminBadge tone="info">가입인사</AdminBadge> : null}
                  <AdminBadge>{row.boardLabel}</AdminBadge>
                  <span className="ml-auto text-sm font-semibold text-content-primary">
                    {waitedLabel(row.verdict.waitedMs)}
                  </span>
                </div>

                <p className="m-0 mt-2 truncate text-sm font-semibold text-content-primary">{row.title}</p>
                <p className="m-0 mt-1 line-clamp-2 break-words text-sm text-content-muted">{row.preview}</p>
                <p className="m-0 mt-1 text-xs text-content-muted">
                  {row.authorName} · {formatKst(row.createdAt)}
                </p>

                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <Link href={`/admin/compose?postId=${encodeURIComponent(row.id)}&from=responses`} className={adminButtonClass('primary')}>
                    답 쓰기
                  </Link>
                  {row.href ? (
                    <a href={row.href} className="inline-flex min-h-[52px] items-center text-sm font-semibold text-link lg:min-h-[44px]">
                      고객 화면에서 보기
                    </a>
                  ) : null}
                  {row.pendingReport ? (
                    <Link href="/admin/reports" className="inline-flex min-h-[52px] items-center text-sm font-semibold text-link lg:min-h-[44px]">
                      신고 먼저 보기
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>
    </>
  )
}
