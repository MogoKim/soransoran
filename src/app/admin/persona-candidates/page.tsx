import type { Metadata } from 'next'
import Link from 'next/link'
import PageShell from '@/components/layouts/PageShell'
import { requireAdmin } from '@/lib/admin'
import { prisma } from '@/lib/prisma'
import {
  maskCandidateText, CANDIDATE_STATUS_LABEL, GATE_STATUS_LABEL, formatKst,
} from '@/lib/persona-admin'

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

export default async function PersonaCandidatesPage() {
  const { ok } = await requireAdmin()

  if (!ok) {
    return (
      <PageShell chrome="minimal">
        <main className="mx-auto max-w-3xl px-4 py-16 text-center">
          <h1 className="text-xl font-bold text-content-primary">접근 권한이 없습니다</h1>
          <p className="mt-2 text-sm text-content-muted">운영자만 볼 수 있는 화면입니다.</p>
          <Link href="/" className="mt-6 inline-block text-link">
            홈으로 가기
          </Link>
        </main>
      </PageShell>
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
    <PageShell>
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold">페르소나 후보 대기열</h1>
          <Link href="/admin/personas" className="text-sm text-link underline">
            페르소나 관제실 →
          </Link>
        </div>

        {/* 🔴 승인 대기열은 계측 장치다 — 상태 분포가 이 화면의 본론이다 */}
        <div className="mb-5 flex flex-wrap gap-2">
          {STATUS_ORDER.map((s) => (
            <span
              key={s}
              className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-700"
            >
              {CANDIDATE_STATUS_LABEL[s] ?? s} <b className="ml-1">{countOf(s)}</b>
            </span>
          ))}
          <span className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-500">
            합계 <b className="ml-1">{total}</b>
          </span>
        </div>

        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          읽기 전용입니다. 승인·반려는 아직 저장되지 않으며, 승인해도 발행되지 않습니다.
          <br />
          목록에는 본문 전문을 표시하지 않습니다 — 상세에서 확인하세요.
        </p>

        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
            후보가 없습니다.
            <br />
            <span className="text-xs">
              Gate 통과분은 <code>npm run persona:comment-queue</code> 로 적재됩니다.
            </span>
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                  <th className="py-2 pr-3">상태</th>
                  <th className="py-2 pr-3">페르소나</th>
                  <th className="py-2 pr-3">본문</th>
                  <th className="py-2 pr-3">반응</th>
                  <th className="py-2 pr-3">Gate</th>
                  <th className="py-2 pr-3">AI 티</th>
                  <th className="py-2 pr-3">재생성</th>
                  <th className="py-2">생성</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100 align-top">
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {CANDIDATE_STATUS_LABEL[r.status] ?? r.status}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap font-mono text-xs">{r.persona.code}</td>
                    <td className="py-2 pr-3">
                      {/* 🔴 첫 글자 + 길이만 */}
                      <Link href={`/admin/persona-candidates/${r.id}`} className="text-link underline">
                        {maskCandidateText(r.candidateText)}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-xs">{r.reactionType}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-xs">
                      {GATE_STATUS_LABEL[r.gateStatus] ?? r.gateStatus}
                    </td>
                    <td className="py-2 pr-3 text-xs text-gray-600">
                      {r.aiToneTags.length === 0 ? '—' : `${r.aiToneTags.length}종`}
                    </td>
                    <td className="py-2 pr-3 text-xs">{r.regenCount}</td>
                    <td className="py-2 text-xs text-gray-500 whitespace-nowrap">{formatKst(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageShell>
  )
}
