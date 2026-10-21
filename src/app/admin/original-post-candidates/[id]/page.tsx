import type { Metadata } from 'next'
import Link from 'next/link'
import { requireAdmin } from '@/lib/admin'
import { prisma } from '@/lib/prisma'
import { formatKst, filledMark } from '@/lib/persona-admin'
import {
  OP_STATUS_LABEL, OP_VERDICT_LABEL, OP_REASON_LABEL,
  toGateFindings, formatMatchMeta,
} from '@/lib/original-post-admin'
import { adminBadgeClass, type BadgeTone } from '@/components/admin/AdminUi'

/** 판정 배지 색 — 목록 화면과 같은 대응. 🔴 PASS 를 초록으로 칠하지 않는다(승인 신호로 읽힌다) */
const VERDICT_TONE: Record<string, BadgeTone> = { PASS: 'neutral', HOLD: 'warning', BLOCK: 'danger' }

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

  const row = await prisma.originalPostApprovalQueue.findUnique({
    where: { id },
    select: {
      id: true, status: true, draftTitle: true, draftBody: true,
      editedTitle: true, editedBody: true, editDiff: true,
      gateVerdict: true, gateResults: true, promptVersion: true, model: true,
      regenCount: true, declineReason: true, decidedBy: true, decidedAt: true,
      createdPostId: true, createdAt: true,
      matchedAt: true, matchMeta: true,
      // 🔴 code 만 읽는다. 페르소나 닉네임은 어드민에도 내지 않는다
      matchedPersona: { select: { code: true } },
      rawContent: {
        select: { sourceArticleId: true, sourceSite: true, rawTitle: true, rawBody: true },
      },
    },
  })

  if (row === null) {
    return (
      <>
        <div className="mx-auto max-w-3xl px-4 py-16 text-center">
          <h1 className="text-xl font-bold text-content-primary">후보를 찾을 수 없습니다</h1>
          <Link href="/admin/original-post-candidates" className="mt-6 inline-block text-link">
            대기열로 돌아가기
          </Link>
        </div>
      </>
    )
  }

  const findings = toGateFindings(row.gateResults)
  const all = [...findings.blocks, ...findings.holds]
  const srcLen = [...row.rawContent.rawBody].length
  const drfLen = [...row.draftBody].length

  return (
    <>
      <div className="w-full">
        <Link href="/admin/original-post-candidates" className="inline-flex min-h-[52px] lg:min-h-[44px] items-center text-sm text-link">
          ← 대기열
        </Link>

        <div className="mt-1 mb-4 flex flex-wrap items-center gap-2">
          <h1 className="m-0 min-w-0 break-words text-xl font-bold leading-snug text-content-primary">{row.draftTitle}</h1>
          <span className={adminBadgeClass(VERDICT_TONE[row.gateVerdict] ?? 'neutral')}>
            {OP_VERDICT_LABEL[row.gateVerdict] ?? row.gateVerdict}
          </span>
          <span className="inline-flex min-h-[24px] items-center rounded bg-surface-page px-2 text-xs text-content-secondary">
            {OP_STATUS_LABEL[row.status] ?? row.status}
          </span>
        </div>

        <p className="mb-5 rounded-lg border border-state-warning bg-[color:var(--admin-warning-soft)] px-3 py-2 text-xs leading-relaxed text-content-primary">
          읽기 전용입니다. 이 화면에서 승인·폐기가 저장되지 않으며, 승인해도 발행되지 않습니다.
          <br />
          🔴 왼쪽은 <b>다른 커뮤니티의 원문</b>입니다 — 재료일 뿐 발행 대상이 아닙니다. 공유하지 마세요.
        </p>

        {/* 🔴 판정 사유 — 무엇을 보고 판단해야 하는지가 먼저다 */}
        <section className="mb-5 rounded-[10px] border border-subtle bg-surface-card p-4 lg:p-6">
          <h2 className="mb-2 text-base font-bold text-content-primary">판정 사유</h2>
          {all.length === 0 ? (
            <p className="text-sm text-content-muted">걸린 항목이 없습니다.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {all.map((f, i) => (
                <li key={`${f.code}-${i}`} className="flex flex-wrap gap-2">
                  <span className="font-medium">{OP_REASON_LABEL[f.code] ?? f.code}</span>
                  <span className="text-content-muted">{f.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 🔴 원문 ↔ 초안 나란히 */}
        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-[10px] border border-subtle bg-surface-card p-4 lg:p-6">
            <h2 className="mb-1 text-base font-bold text-content-primary">
              원문 <span className="ml-1 text-xs font-normal text-content-muted">재료 · 발행하지 않음</span>
            </h2>
            <p className="mb-2 text-xs text-content-muted">
              {row.rawContent.sourceSite}:{row.rawContent.sourceArticleId} · {srcLen}자
            </p>
            <h3 className="mb-2 text-sm font-medium">{row.rawContent.rawTitle}</h3>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-content-secondary [overflow-wrap:anywhere]">
              {row.rawContent.rawBody}
            </div>
          </section>

          <section className="rounded-[10px] border border-subtle bg-surface-card p-4 lg:p-6">
            <h2 className="mb-1 text-base font-bold text-content-primary">
              초안 <span className="ml-1 text-xs font-normal text-content-muted">우리 글 · 아직 발행 안 됨</span>
            </h2>
            <p className="mb-2 text-xs text-content-muted">
              {drfLen}자 · 원문의 {srcLen === 0 ? '—' : `${(drfLen / srcLen).toFixed(2)}배`}
            </p>
            <h3 className="mb-2 text-sm font-medium">{row.draftTitle}</h3>
            <div className="whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">{row.draftBody}</div>
          </section>
        </div>

        {row.editedBody !== null && (
          <section className="mt-4 rounded-[10px] border border-state-success bg-[color:var(--admin-success-soft)] p-4 lg:p-6">
            <h2 className="mb-2 text-base font-bold text-content-primary">창업자 수정본</h2>
            {row.editedTitle !== null && <h3 className="mb-2 text-sm font-medium">{row.editedTitle}</h3>}
            <div className="whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">{row.editedBody}</div>
          </section>
        )}

        <section className="mt-5 rounded-[10px] border border-subtle bg-surface-card p-4 lg:p-6">
          <h2 className="mb-2 text-base font-bold text-content-primary">이력</h2>
          <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm [overflow-wrap:anywhere]">
            <dt className="text-content-muted">판 · 모델</dt>
            <dd>{row.promptVersion} · {row.model}</dd>
            <dt className="text-content-muted">재생성</dt>
            <dd>{row.regenCount}회</dd>
            <dt className="text-content-muted">수정본</dt>
            <dd>{filledMark(row.editedBody)}</dd>
            <dt className="text-content-muted">폐기 사유</dt>
            <dd>{row.declineReason ?? '—'}</dd>
            <dt className="text-content-muted">결정자</dt>
            <dd>{row.decidedBy ?? '—'}</dd>
            <dt className="text-content-muted">결정 시각</dt>
            <dd>{row.decidedAt === null ? '—' : formatKst(row.decidedAt)}</dd>
            {/* 🔴 배정은 발행이 아니다. 아래 세 줄이 채워져도 글은 나가지 않았다 */}
            <dt className="text-content-muted">배정 페르소나</dt>
            <dd>{row.matchedPersona?.code ?? '— (미배정)'}</dd>
            <dt className="text-content-muted">배정 시각</dt>
            <dd>{row.matchedAt === null ? '—' : formatKst(row.matchedAt)}</dd>
            <dt className="text-content-muted">배정 근거</dt>
            <dd>{formatMatchMeta(row.matchMeta)}</dd>
            <dt className="text-content-muted">발행 글</dt>
            <dd>{row.createdPostId ?? '— (발행 전)'}</dd>
            <dt className="text-content-muted">적재 시각</dt>
            <dd>{formatKst(row.createdAt)}</dd>
          </dl>
        </section>
      </div>
    </>
  )
}
