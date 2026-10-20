import type { Metadata } from 'next'
import Link from 'next/link'
import { requireAdmin } from '@/lib/admin'
import { prisma } from '@/lib/prisma'
import {
  maskCandidateText, CANDIDATE_STATUS_LABEL, GATE_STATUS_LABEL, formatKst,
} from '@/lib/persona-admin'
import AdminListFilter from '@/components/admin/AdminListFilter'
import {
  AdminPageHeader,
  AdminNotice,
  AdminEmptyState,
  AdminRangeNote,
  AdminTable,
  AdminTableRow,
  AdminCell,
  adminBadgeClass,
} from '@/components/admin/AdminUi'

/**
 * 페르소나 댓글 후보 승인 대기열 — 🔴 읽기 전용
 *
 * 정본: docs/operations/2026-08-30-persona-architecture-design.md §13
 *
 * 🔴 이 화면이 존재하는 이유
 *    **승인 대기열은 종착지가 아니라 계측 장치다**(Architecture §15).
 *    무엇이 걸리고 무엇이 통과하는지 재서 자동화 조건을 찾는 곳이다.
 *    승인 버튼을 누르는 곳이 아니라, 자동화를 열어도 되는지 판단하는 근거를 모으는 곳이다.
 *
 * 🔴 이번 판에서 하지 않는 것
 *      · 승인 · 반려 write — 액션은 read-only 표시만 (다음 단계로 분리)
 *      · 발행 — 승인해도 발행되지 않는다. 발행 경로는 별도 승인 대상이다
 *      · 본문 전문 노출 — 목록은 첫 글자 + 길이만 (§상세에서 개별 확인)
 *      · 고객 화면 변경 — 이 파일은 고객 경로에서 import 되지 않는다
 */
export const metadata: Metadata = {
  title: '페르소나 후보 대기열',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

const STATUS_ORDER = ['PENDING', 'APPROVED', 'EDITED', 'DECLINED', 'PUBLISHED', 'EXPIRED'] as const

/** 데스크탑 열 폭 — 머리줄과 각 줄이 같은 값을 쓴다 */
const COLS = 'lg:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1.3fr)_8.5rem]'

export default async function PersonaCandidatesPage() {
  const { ok } = await requireAdmin()

  if (!ok) {
    return (
      <>
        <div className="mx-auto max-w-3xl px-4 py-16 text-center">
          <h1 className="text-xl font-bold text-content-primary">접근 권한이 없습니다</h1>
          <p className="mt-2 text-sm text-content-muted">운영자만 볼 수 있는 화면입니다.</p>
          <Link href="/" className="mt-6 inline-block text-link">
            홈으로 가기
          </Link>
        </div>
      </>
    )
  }

  const [rows, counts] = await Promise.all([
    prisma.personaApprovalQueue.findMany({
      select: {
        id: true, status: true, candidateText: true, reactionType: true,
        gateStatus: true, aiToneTags: true, regenCount: true, createdAt: true,
        persona: { select: { code: true } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    }),
    prisma.personaApprovalQueue.groupBy({ by: ['status'], _count: true }),
  ])

  const countOf = (s: string): number => counts.find((c) => c.status === s)?._count ?? 0
  const total = counts.reduce((sum, c) => sum + c._count, 0)

  return (
    <>
      <div>
        <AdminPageHeader group="자동 운영" title="페르소나 후보 대기열" />
        <p className="m-0 mt-1">
          <Link href="/admin/personas" className="inline-flex min-h-[52px] lg:min-h-[44px] items-center text-sm text-link">
            페르소나 관제실 →
          </Link>
        </p>

        {/* 🔴 승인 대기열은 계측 장치다 — 상태 분포가 이 화면의 본론이다 */}
        {/* 이 숫자는 DB 전체 분포다(groupBy). 아래 칩의 숫자는 불러온 행 안의 수다. */}
        <div className="mt-3 flex flex-wrap gap-2">
          {STATUS_ORDER.map((s) => (
            <span key={s} className={adminBadgeClass('neutral')}>
              {CANDIDATE_STATUS_LABEL[s] ?? s} <b className="ml-1 tabular-nums">{countOf(s)}</b>
            </span>
          ))}
          <span className={adminBadgeClass('neutral')}>
            합계 <b className="ml-1 tabular-nums">{total}</b>
          </span>
        </div>

        <div className="mt-4">
          <AdminNotice tone="info">
            <p className="m-0">
              읽기 전용입니다. 승인·반려는 아직 저장되지 않으며, 승인해도 발행되지 않습니다.
              <br />
              목록에는 본문 전문을 표시하지 않습니다 — 상세에서 확인하세요.
            </p>
          </AdminNotice>
        </div>

        {rows.length === 0 ? (
          <div className="mt-6">
            <AdminEmptyState>
              후보가 없습니다.
              <br />
              <span className="text-xs">
                Gate 통과분은 <code>npm run persona:comment-queue</code> 로 적재됩니다.
              </span>
            </AdminEmptyState>
          </div>
        ) : (
          /* 🔴 거르기는 불러온 행(최대 200건 · 상태순 → 최신순) 안에서만 한다. 조회 변경 0 */
          <AdminListFilter
            mobileScroll
            searchLabel="페르소나 코드 찾기"
            searchPlaceholder="예: P12"
            chips={[
              { key: 'all', label: '전체', count: rows.length },
              ...STATUS_ORDER.map((s) => ({
                key: s,
                label: CANDIDATE_STATUS_LABEL[s] ?? s,
                count: rows.filter((r) => r.status === s).length,
              })),
            ]}
          >
            <AdminRangeNote>
              {total > rows.length
                ? `전체 ${total}건 중 ${rows.length}건을 불러왔습니다(상태순 → 최신순). 거르기는 이 범위 안에서만 됩니다.`
                : `전체 ${total}건을 불러왔습니다.`}
            </AdminRangeNote>
            <AdminTable
              columns={COLS}
              head={
                <>
                  {/* 🔴 네 칸이다 — 1024~1279px 본문 폭(약 670px)에 여덟 칸이 들어가지 않아 페이지가 넘쳤다 */}
                  <span><span>상태</span> · <span>페르소나</span></span>
                  <span>본문</span>
                  <span><span>반응</span> · <span>Gate</span> · <span>AI 티</span> · <span>재생성</span></span>
                  <span>생성</span>
                </>
              }
            >
              {rows.map((r) => (
                <AdminTableRow
                  key={r.id}
                  href={`/admin/persona-candidates/${r.id}`}
                  columns={COLS}
                  filterKey={r.status}
                  searchText={r.persona.code}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span>
                      <span className={adminBadgeClass('neutral')}>
                        {CANDIDATE_STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </span>
                    <span className="text-sm font-bold tabular-nums text-content-primary">{r.persona.code}</span>
                  </span>
                  {/* 🔴 첫 글자 + 길이만 */}
                  <span className="min-w-0 text-sm font-bold text-link">{maskCandidateText(r.candidateText)}</span>
                  <span className="flex flex-wrap gap-x-4 gap-y-1">
                    <AdminCell label="반응">{r.reactionType}</AdminCell>
                    <AdminCell label="Gate">{GATE_STATUS_LABEL[r.gateStatus] ?? r.gateStatus}</AdminCell>
                    <AdminCell label="AI 티">{r.aiToneTags.length === 0 ? '—' : `${r.aiToneTags.length}종`}</AdminCell>
                    <AdminCell label="재생성" className="tabular-nums">{r.regenCount}</AdminCell>
                  </span>
                  <AdminCell label="생성" tone="meta" className="tabular-nums">{formatKst(r.createdAt)}</AdminCell>
                </AdminTableRow>
              ))}
            </AdminTable>
          </AdminListFilter>
        )}
      </div>
    </>
  )
}
