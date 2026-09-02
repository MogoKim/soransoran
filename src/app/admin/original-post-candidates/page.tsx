import type { Metadata } from 'next'
import Link from 'next/link'
import PageShell from '@/components/layouts/PageShell'
import { requireAdmin } from '@/lib/admin'
import { prisma } from '@/lib/prisma'
import { formatKst } from '@/lib/persona-admin'
import {
  OP_STATUS_LABEL, OP_VERDICT_LABEL, OP_VERDICT_TONE, OP_REASON_LABEL,
  toGateFindings, maskDraft,
} from '@/lib/original-post-admin'

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
  title: '오리지널 초안 대기열',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

const STATUS_ORDER = ['PENDING', 'APPROVED', 'EDITED', 'DECLINED', 'PUBLISHED', 'EXPIRED'] as const

export default async function OriginalPostCandidatesPage() {
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
    prisma.originalPostApprovalQueue.findMany({
      select: {
        id: true, status: true, draftTitle: true, draftBody: true,
        gateVerdict: true, gateResults: true, promptVersion: true, model: true,
        regenCount: true, createdAt: true,
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
    <PageShell>
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold">오리지널 초안 대기열</h1>
          <Link href="/admin/persona-candidates" className="text-sm text-link underline">
            페르소나 후보 대기열 →
          </Link>
        </div>

        <div className="mb-5 flex flex-wrap gap-2">
          {STATUS_ORDER.map((s) => (
            <span
              key={s}
              className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-700"
            >
              {OP_STATUS_LABEL[s] ?? s} <b className="ml-1">{countOf(s)}</b>
            </span>
          ))}
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-900">
            먼저 볼 것 <b className="ml-1">{holdCount}</b>
          </span>
          <span className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-500">
            합계 <b className="ml-1">{total}</b>
          </span>
        </div>

        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          읽기 전용입니다. 승인·폐기는 이 화면에서 저장되지 않으며, 승인해도 발행되지 않습니다.
          <br />
          <b>&ldquo;검수 대기&rdquo;는 통과가 아니라 사람이 볼 차례라는 뜻입니다.</b>
          {' '}차단된 초안은 적재되지 않아 여기 나타나지 않습니다.
        </p>

        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
            대기열이 비어 있습니다.
            <br />
            <span className="text-xs">
              초안은 <code>original-post-enqueue --apply --limit=N</code> 으로 적재됩니다.
            </span>
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                  <th className="py-2 pr-3">상태</th>
                  <th className="py-2 pr-3">판정</th>
                  <th className="py-2 pr-3">제목</th>
                  <th className="py-2 pr-3">원문 → 초안</th>
                  <th className="py-2 pr-3">사유</th>
                  <th className="py-2 pr-3">판 · 모델</th>
                  <th className="py-2 pr-3">재생성</th>
                  <th className="py-2">생성</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const findings = toGateFindings(r.gateResults)
                  const why = [...findings.blocks, ...findings.holds]
                  const srcLen = [...r.rawContent.rawBody].length
                  const drfLen = [...r.draftBody].length
                  return (
                    <tr key={r.id} className="border-b border-gray-100 align-top">
                      <td className="py-2 pr-3 whitespace-nowrap">{OP_STATUS_LABEL[r.status] ?? r.status}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs ${
                            OP_VERDICT_TONE[r.gateVerdict] ?? 'border-gray-200 bg-gray-50 text-gray-700'
                          }`}
                        >
                          {OP_VERDICT_LABEL[r.gateVerdict] ?? r.gateVerdict}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        {/* 🔴 첫 글자 + 길이만 */}
                        <Link
                          href={`/admin/original-post-candidates/${r.id}`}
                          className="text-link underline"
                        >
                          {maskDraft(r.draftTitle)}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap text-xs text-gray-600">
                        {srcLen}자 → {drfLen}자
                        <span className="ml-1 text-gray-400">
                          ({srcLen === 0 ? '—' : `${(drfLen / srcLen).toFixed(2)}배`})
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-xs text-gray-600">
                        {why.length === 0 ? '—' : why.map((f) => OP_REASON_LABEL[f.code] ?? f.code).join(' · ')}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap text-xs text-gray-600">
                        {r.promptVersion}
                        <span className="ml-1 text-gray-400">{r.model}</span>
                      </td>
                      <td className="py-2 pr-3 text-xs">{r.regenCount}</td>
                      <td className="py-2 text-xs text-gray-500 whitespace-nowrap">{formatKst(r.createdAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageShell>
  )
}
