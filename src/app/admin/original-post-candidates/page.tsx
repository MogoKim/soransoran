import type { Metadata } from 'next'
import Link from 'next/link'
import { requireAdmin } from '@/lib/admin'
import { prisma } from '@/lib/prisma'
import { formatKst } from '@/lib/persona-admin'
import {
  OP_STATUS_LABEL, OP_VERDICT_LABEL, OP_REASON_LABEL,
  toGateFindings, maskDraft,
} from '@/lib/original-post-admin'
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
  type BadgeTone,
} from '@/components/admin/AdminUi'

/**
 * 오리지널 초안 검수 대기열 — 🔴 읽기 전용
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §5-2-1 · §12-2
 *
 * 🔴 이 화면이 존재하는 이유
 *    초안이 48건이 됐는데 **사람이 무엇을 결정했는지 남길 자리가 없었다.**
 *    판정은 gate 가 하고, 결정은 사람이 한다 — 이 화면은 그 사이를 잇는다.
 *
 * 🔴 이번 판에서 하지 않는 것
 *      · 승인 · 폐기 write — 결정은 스크립트로 남긴다 (버튼을 두지 않는다)
 *      · 발행 — 승인해도 발행되지 않는다. 발행 경로는 별도 승인 대상이다
 *      · 본문 전문 노출 — 목록은 첫 글자 + 길이만
 *      · 고객 화면 변경 — 이 파일은 고객 경로에서 import 되지 않는다
 *
 * 🔴 BLOCK 은 여기 없다. 적재 자체를 하지 않는다 —
 *    원문 조각이 든 초안을 DB 에 남기지 않기 위해서다.
 */
export const metadata: Metadata = {
  title: '글 초안 대기열',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

const STATUS_ORDER = ['PENDING', 'APPROVED', 'EDITED', 'DECLINED', 'PUBLISHED', 'EXPIRED'] as const

/**
 * 판정 배지 색 — lib 의 OP_VERDICT_TONE(Tailwind 기본 팔레트)과 같은 뜻을 관리자 토큰으로 옮긴 것.
 * 🔴 PASS 를 초록으로 칠하지 않는다 — 승인 신호로 읽힌다(lib 주석 그대로). HOLD 주의 · BLOCK 위험.
 */
const VERDICT_TONE: Record<string, BadgeTone> = { PASS: 'neutral', HOLD: 'warning', BLOCK: 'danger' }

/** 데스크탑 열 폭 — 머리줄과 각 줄이 같은 값을 쓴다 */
const COLS = 'lg:grid-cols-[8rem_minmax(0,1.6fr)_minmax(0,1fr)_8.5rem]'

export default async function OriginalPostCandidatesPage() {
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
    prisma.originalPostApprovalQueue.findMany({
      select: {
        id: true, status: true, draftTitle: true, draftBody: true,
        gateVerdict: true, gateResults: true, promptVersion: true, model: true,
        regenCount: true, createdAt: true,
        // 🔴 code 만 읽는다. 페르소나 닉네임은 어드민에도 내지 않는다
        matchedPersona: { select: { code: true } },
        rawContent: { select: { sourceArticleId: true, rawBody: true } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      // 🔴 상한을 둔다. 대기열이 커져도 한 화면이 DB 를 통째로 끌어오지 않는다
      take: 200,
    }),
    prisma.originalPostApprovalQueue.groupBy({ by: ['status'], _count: true }),
  ])

  const countOf = (s: string): number => counts.find((c) => c.status === s)?._count ?? 0
  const total = counts.reduce((sum, c) => sum + c._count, 0)
  const holdCount = rows.filter((r) => r.gateVerdict === 'HOLD').length

  return (
    <>
      <div>
        <AdminPageHeader group="자동 운영" title="글 초안 대기열" />
        <p className="m-0 mt-1">
          <Link href="/admin/persona-candidates" className="inline-flex min-h-[52px] items-center text-sm font-semibold text-link lg:min-h-[44px]">
            페르소나 후보 대기열 →
          </Link>
        </p>

        {/* 이 숫자는 DB 전체 분포다(groupBy). 아래 칩의 숫자는 불러온 행 안의 수다. */}
        <div className="mt-3 flex flex-wrap gap-2">
          {STATUS_ORDER.map((s) => (
            <span key={s} className={adminBadgeClass('neutral')}>
              {OP_STATUS_LABEL[s] ?? s} <b className="ml-1 tabular-nums">{countOf(s)}</b>
            </span>
          ))}
          <span className={adminBadgeClass('warning')}>
            먼저 볼 것 <b className="ml-1 tabular-nums">{holdCount}</b>
          </span>
          <span className={adminBadgeClass('neutral')}>
            합계 <b className="ml-1 tabular-nums">{total}</b>
          </span>
        </div>

        <div className="mt-4">
          <AdminNotice tone="info">
            <p className="m-0">
              읽기 전용입니다. 승인·폐기는 이 화면에서 저장되지 않으며, 승인해도 발행되지 않습니다.
              <br />
              <b>&ldquo;검수 대기&rdquo;는 통과가 아니라 사람이 볼 차례라는 뜻입니다.</b>
              {' '}차단된 초안은 적재되지 않아 여기 나타나지 않습니다.
            </p>
          </AdminNotice>
        </div>

        {rows.length === 0 ? (
          <div className="mt-6">
            <AdminEmptyState>
              대기열이 비어 있습니다.
              <br />
              <span className="text-xs">
                초안은 <code>original-post-enqueue --apply --limit=N</code> 으로 적재됩니다.
              </span>
            </AdminEmptyState>
          </div>
        ) : (
          /* 🔴 거르기는 불러온 행(최대 200건 · 상태순 → 최신순) 안에서만 한다. 조회 변경 0.
                모바일 상태 칩은 한 줄 가로 스크롤이다(창업자 확정). 페이지 자체는 넘치지 않는다. */
          <AdminListFilter
            mobileScroll
            searchLabel="배정 페르소나 코드 찾기"
            searchPlaceholder="예: P07"
            chips={[
              { key: 'all', label: '전체', count: rows.length },
              { key: 'HOLD', label: '먼저 볼 것', count: holdCount },
              ...STATUS_ORDER.map((s) => ({
                key: s,
                label: OP_STATUS_LABEL[s] ?? s,
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
                  {/* 🔴 네 칸이다 — 1024~1279px 본문 폭(약 670px)에서 여섯 칸이면 줄이 계속 접혔다 */}
                  <span><span>판정</span> · <span>상태</span></span>
                  <span>제목</span>
                  <span>사유</span>
                  <span><span>배정</span> · <span>생성</span></span>
                </>
              }
            >
              {rows.map((r) => {
                const findings = toGateFindings(r.gateResults)
                const why = [...findings.blocks, ...findings.holds]
                const srcLen = [...r.rawContent.rawBody].length
                const drfLen = [...r.draftBody].length
                return (
                  <AdminTableRow
                    key={r.id}
                    href={`/admin/original-post-candidates/${r.id}`}
                    columns={COLS}
                    accent={r.gateVerdict === 'HOLD' ? 'warning' : undefined}
                    filterKey={`${r.status} ${r.gateVerdict}`}
                    searchText={r.matchedPersona?.code ?? ''}
                  >
                    <span className="flex flex-wrap items-center gap-2 lg:flex-col lg:items-start lg:gap-1">
                      <span>
                        <span className={adminBadgeClass(VERDICT_TONE[r.gateVerdict] ?? 'neutral')}>
                          {OP_VERDICT_LABEL[r.gateVerdict] ?? r.gateVerdict}
                        </span>
                      </span>
                      <span className="text-sm text-content-secondary">{OP_STATUS_LABEL[r.status] ?? r.status}</span>
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      {/* 🔴 첫 글자 + 길이만 */}
                      <span className="text-sm font-bold text-link">{maskDraft(r.draftTitle)}</span>
                      {/* 예전 표의 세 열(원문 → 초안 · 판 · 모델 · 재생성)을 제목 아래 한 줄로 모았다 — 라벨은 그대로 */}
                      <span className="flex flex-wrap gap-x-3 text-xs tabular-nums text-content-muted">
                        <span>
                          <span>원문 → 초안</span>{' '}
                          {srcLen}자 → {drfLen}자
                          <span className="ml-1">
                            ({srcLen === 0 ? '—' : `${(drfLen / srcLen).toFixed(2)}배`})
                          </span>
                        </span>
                        <span>
                          <span>판 · 모델</span> {r.promptVersion}
                          <span className="ml-1">{r.model}</span>
                        </span>
                        <span>
                          <span>재생성</span> {r.regenCount}
                        </span>
                      </span>
                    </span>
                    <AdminCell label="사유">
                      {why.length === 0 ? '—' : why.map((f) => OP_REASON_LABEL[f.code] ?? f.code).join(' · ')}
                    </AdminCell>
                    {/* 🔴 배정은 발행이 아니다. 값이 있어도 글은 나가지 않았다 */}
                    <span className="flex flex-wrap gap-x-3 gap-y-0.5 lg:flex-col">
                      <AdminCell label="배정" className="tabular-nums">{r.matchedPersona?.code ?? '—'}</AdminCell>
                      <AdminCell label="생성" tone="meta" className="tabular-nums">{formatKst(r.createdAt)}</AdminCell>
                    </span>
                  </AdminTableRow>
                )
              })}
            </AdminTable>
          </AdminListFilter>
        )}
      </div>
    </>
  )
}
