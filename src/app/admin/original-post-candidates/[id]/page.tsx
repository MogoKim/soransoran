import type { Metadata } from 'next'
import Link from 'next/link'
import PageShell from '@/components/layouts/PageShell'
import { requireAdmin } from '@/lib/admin'
import { prisma } from '@/lib/prisma'
import { formatKst, filledMark } from '@/lib/persona-admin'
import {
  OP_STATUS_LABEL, OP_VERDICT_LABEL, OP_VERDICT_TONE, OP_REASON_LABEL,
  toGateFindings,
} from '@/lib/original-post-admin'

/**
 * 오리지널 초안 상세 — 🔴 읽기 전용
 *
 * 🔴 **원문과 초안을 나란히 놓는다.** 검수의 본론은 "이게 원문에서 나온 글이 맞나" 다.
 *    한쪽만 보면 잘 쓴 글로 보이고, 나란히 놓아야 지어낸 것이 보인다.
 *
 * 🔴 원문 전문이 화면에 나온다 — 남의 커뮤니티 글이다.
 *    이 경로는 운영자만 볼 수 있고(requireAdmin), robots 로 색인을 막는다.
 *
 * 🔴 결정 버튼을 두지 않는다. 승인·폐기는 스크립트로 남긴다.
 */
export const metadata: Metadata = {
  title: '오리지널 초안 상세',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function OriginalPostCandidateDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { ok } = await requireAdmin()
  const { id } = await params

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

  const row = await prisma.originalPostApprovalQueue.findUnique({
    where: { id },
    select: {
      id: true, status: true, draftTitle: true, draftBody: true,
      editedTitle: true, editedBody: true, editDiff: true,
      gateVerdict: true, gateResults: true, promptVersion: true, model: true,
      regenCount: true, declineReason: true, decidedBy: true, decidedAt: true,
      createdPostId: true, createdAt: true,
      rawContent: {
        select: { sourceArticleId: true, sourceSite: true, rawTitle: true, rawBody: true },
      },
    },
  })

  if (row === null) {
    return (
      <PageShell chrome="minimal">
        <main className="mx-auto max-w-3xl px-4 py-16 text-center">
          <h1 className="text-xl font-bold text-content-primary">후보를 찾을 수 없습니다</h1>
          <Link href="/admin/original-post-candidates" className="mt-6 inline-block text-link">
            대기열로 돌아가기
          </Link>
        </main>
      </PageShell>
    )
  }

  const findings = toGateFindings(row.gateResults)
  const all = [...findings.blocks, ...findings.holds]
  const srcLen = [...row.rawContent.rawBody].length
  const drfLen = [...row.draftBody].length

  return (
    <PageShell>
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <Link href="/admin/original-post-candidates" className="text-sm text-[#FF6F61] underline">
          ← 대기열
        </Link>

        <div className="mt-3 mb-4 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold">{row.draftTitle}</h1>
          <span
            className={`rounded-full border px-2 py-0.5 text-xs ${
              OP_VERDICT_TONE[row.gateVerdict] ?? 'border-gray-200 bg-gray-50 text-gray-700'
            }`}
          >
            {OP_VERDICT_LABEL[row.gateVerdict] ?? row.gateVerdict}
          </span>
          <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-700">
            {OP_STATUS_LABEL[row.status] ?? row.status}
          </span>
        </div>

        <p className="mb-5 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          읽기 전용입니다. 이 화면에서 승인·폐기가 저장되지 않으며, 승인해도 발행되지 않습니다.
          <br />
          🔴 왼쪽은 <b>다른 커뮤니티의 원문</b>입니다 — 재료일 뿐 발행 대상이 아닙니다. 공유하지 마세요.
        </p>

        {/* 🔴 판정 사유 — 무엇을 보고 판단해야 하는지가 먼저다 */}
        <section className="mb-5 rounded-lg border border-gray-200 p-4">
          <h2 className="mb-2 text-sm font-bold">판정 사유</h2>
          {all.length === 0 ? (
            <p className="text-sm text-gray-500">걸린 항목이 없습니다.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {all.map((f, i) => (
                <li key={`${f.code}-${i}`} className="flex flex-wrap gap-2">
                  <span className="font-medium">{OP_REASON_LABEL[f.code] ?? f.code}</span>
                  <span className="text-gray-500">{f.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 🔴 원문 ↔ 초안 나란히 */}
        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-lg border border-gray-200 p-4">
            <h2 className="mb-1 text-sm font-bold">
              원문 <span className="ml-1 text-xs font-normal text-gray-500">재료 · 발행하지 않음</span>
            </h2>
            <p className="mb-2 text-xs text-gray-500">
              {row.rawContent.sourceSite}:{row.rawContent.sourceArticleId} · {srcLen}자
            </p>
            <h3 className="mb-2 text-sm font-medium">{row.rawContent.rawTitle}</h3>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
              {row.rawContent.rawBody}
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 p-4">
            <h2 className="mb-1 text-sm font-bold">
              초안 <span className="ml-1 text-xs font-normal text-gray-500">우리 글 · 아직 발행 안 됨</span>
            </h2>
            <p className="mb-2 text-xs text-gray-500">
              {drfLen}자 · 원문의 {srcLen === 0 ? '—' : `${(drfLen / srcLen).toFixed(2)}배`}
            </p>
            <h3 className="mb-2 text-sm font-medium">{row.draftTitle}</h3>
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{row.draftBody}</div>
          </section>
        </div>

        {row.editedBody !== null && (
          <section className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
            <h2 className="mb-2 text-sm font-bold">창업자 수정본</h2>
            {row.editedTitle !== null && <h3 className="mb-2 text-sm font-medium">{row.editedTitle}</h3>}
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{row.editedBody}</div>
          </section>
        )}

        <section className="mt-5 rounded-lg border border-gray-200 p-4">
          <h2 className="mb-2 text-sm font-bold">이력</h2>
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
            <dt className="text-gray-500">판 · 모델</dt>
            <dd>{row.promptVersion} · {row.model}</dd>
            <dt className="text-gray-500">재생성</dt>
            <dd>{row.regenCount}회</dd>
            <dt className="text-gray-500">수정본</dt>
            <dd>{filledMark(row.editedBody)}</dd>
            <dt className="text-gray-500">폐기 사유</dt>
            <dd>{row.declineReason ?? '—'}</dd>
            <dt className="text-gray-500">결정자</dt>
            <dd>{row.decidedBy ?? '—'}</dd>
            <dt className="text-gray-500">결정 시각</dt>
            <dd>{row.decidedAt === null ? '—' : formatKst(row.decidedAt)}</dd>
            <dt className="text-gray-500">발행 글</dt>
            <dd>{row.createdPostId ?? '— (발행 전)'}</dd>
            <dt className="text-gray-500">적재 시각</dt>
            <dd>{formatKst(row.createdAt)}</dd>
          </dl>
        </section>
      </div>
    </PageShell>
  )
}
