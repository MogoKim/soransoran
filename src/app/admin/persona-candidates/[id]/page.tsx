import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import PageShell from '@/components/layouts/PageShell'
import { requireAdmin } from '@/lib/admin'
import { prisma } from '@/lib/prisma'
import {
  CANDIDATE_STATUS_LABEL, GATE_STATUS_LABEL, STATUS_LABEL, formatKst, filledMark,
} from '@/lib/persona-admin'

/**
 * 페르소나 댓글 후보 상세 — 🔴 읽기 전용
 *
 * 정본: docs/operations/2026-08-30-persona-architecture-design.md §13
 *       "대기열 화면에 있어야 할 것" 5축을 그대로 따른다.
 *
 * 🔴 후보 본문 전문은 **여기서만** 노출한다. 목록은 첫 글자 + 길이뿐이다.
 *
 * 🔴 출력하지 않는 것
 *      · 원문 · 원댓글 전문 — 애초에 DB 에 저장하지 않는다(storyRefs 참조만)
 *      · author · sourceUrl · sourceRef — 컬럼 자체가 없다
 *      · 실회원 닉네임
 *
 * 🔴 액션은 read-only 다. 승인 · 반려 write 는 다음 단계로 분리했다.
 *    승인해도 발행되지 않는다 — 발행 경로는 별도 승인 대상이다.
 */
export const metadata: Metadata = {
  title: '후보 상세',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

type GateRow = { gate?: unknown; outcome?: unknown; detail?: unknown }

/** 🔴 Json 을 그대로 뿌리지 않는다. 관문 · 판정 · 근거 3칸만 꺼낸다 */
function toGateRows(value: unknown): Array<{ gate: string; outcome: string; detail: string }> {
  if (!Array.isArray(value)) return []
  return value.map((v) => {
    const r = (v ?? {}) as GateRow
    return {
      gate: typeof r.gate === 'string' ? r.gate : '?',
      outcome: typeof r.outcome === 'string' ? r.outcome : '?',
      detail: typeof r.detail === 'string' ? r.detail : '',
    }
  })
}

export default async function PersonaCandidateDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params
  const row = await prisma.personaApprovalQueue.findUnique({
    where: { id },
    select: {
      id: true, status: true, candidateText: true, editedText: true, editDiff: true,
      reactionType: true, gateStatus: true, gateResults: true, aiToneTags: true,
      regenCount: true, storyRefs: true, topicTags: true, seedRef: true,
      targetPostId: true, declineReason: true, decidedBy: true, decidedAt: true,
      createdAt: true,
      persona: {
        select: {
          code: true, status: true, ageBand: true, region: true,
          voiceCore: true, voiceVariations: true, forbiddenReactionRoles: true,
        },
      },
    },
  })
  if (row === null) notFound()

  const gates = toGateRows(row.gateResults)
  const failed = gates.filter((g) => g.outcome !== 'pass' && g.outcome !== 'notRun')
  const notRun = gates.filter((g) => g.outcome === 'notRun')

  return (
    <PageShell>
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        <Link href="/admin/persona-candidates" className="text-sm text-[#FF6F61] underline">
          ← 대기열
        </Link>

        <div className="mt-3 mb-5 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold">후보 상세</h1>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs">
            {CANDIDATE_STATUS_LABEL[row.status] ?? row.status}
          </span>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs">
            Gate {GATE_STATUS_LABEL[row.gateStatus] ?? row.gateStatus}
          </span>
        </div>

        {/* ① 생성물 — 🔴 본문 전문은 여기서만 */}
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-bold text-gray-700">① 생성물</h2>
          <p className="whitespace-pre-wrap rounded-lg border border-gray-200 bg-white px-4 py-3 text-[15px] leading-relaxed">
            {row.candidateText}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            반응 유형 {row.reactionType} · {[...row.candidateText].length}자 · 재생성 {row.regenCount}회
          </p>
          {row.editedText !== null && (
            <div className="mt-3">
              <h3 className="mb-1 text-xs font-bold text-gray-700">수정본</h3>
              <p className="whitespace-pre-wrap rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[15px]">
                {row.editedText}
              </p>
              <p className="mt-1 text-xs text-gray-500">수정 diff {filledMark(row.editDiff)}</p>
            </div>
          )}
        </section>

        {/* ② 페르소나 */}
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-bold text-gray-700">② 페르소나</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-gray-200 px-4 py-3 text-sm">
            <dt className="text-gray-500">코드</dt>
            <dd className="font-mono">{row.persona.code}</dd>
            <dt className="text-gray-500">상태</dt>
            <dd>{STATUS_LABEL[row.persona.status] ?? row.persona.status}</dd>
            <dt className="text-gray-500">밴드</dt>
            <dd>{row.persona.ageBand ?? '—'} · {row.persona.region ?? '—'}</dd>
            <dt className="text-gray-500">Voice Core</dt>
            <dd>{filledMark(row.persona.voiceCore)}</dd>
            <dt className="text-gray-500">variation</dt>
            <dd>{filledMark(row.persona.voiceVariations)}</dd>
            <dt className="text-gray-500">금지 역할</dt>
            <dd>
              {row.persona.forbiddenReactionRoles.length === 0
                ? '—'
                : row.persona.forbiddenReactionRoles.join(' · ')}
            </dd>
          </dl>
          {/* 🔴 매칭 점수 · mood 는 M3 반응 지도가 연결되면 채운다 */}
          <p className="mt-1 text-xs text-gray-400">
            매칭 근거 · 오늘 mood 는 M3 반응 지도 연결 후 표시됩니다.
          </p>
        </section>

        {/* ③ Safety Gate */}
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-bold text-gray-700">
            ③ Safety Gate — 걸림 {failed.length} · 미실행 {notRun.length} / {gates.length}관문
          </h2>
          {gates.length === 0 ? (
            <p className="text-sm text-gray-500">기록된 관문 결과가 없습니다.</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <tbody>
                {gates.map((g) => (
                  <tr key={g.gate} className="border-b border-gray-100">
                    <td className="w-10 py-1.5 text-center">{g.gate}</td>
                    <td className="w-24 py-1.5 text-xs">{GATE_STATUS_LABEL[g.outcome] ?? g.outcome}</td>
                    {/* 🔴 판정부가 코드 · 개수만 담도록 만들어져 있다 */}
                    <td className="py-1.5 text-xs text-gray-600">{g.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-xs text-gray-500">
            AI 티 태그 {row.aiToneTags.length === 0 ? '—' : row.aiToneTags.join(' · ')}
          </p>
        </section>

        {/* ④ 소스 — 🔴 원문 전문은 저장하지 않는다 */}
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-bold text-gray-700">④ 소스</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-gray-200 px-4 py-3 text-sm">
            <dt className="text-gray-500">topicTags</dt>
            <dd>{row.topicTags.length === 0 ? '—' : row.topicTags.join(' · ')}</dd>
            <dt className="text-gray-500">storyRefs</dt>
            <dd>{row.storyRefs.length === 0 ? '—' : `${row.storyRefs.length}건`}</dd>
            <dt className="text-gray-500">seedRef</dt>
            <dd className="font-mono text-xs">{row.seedRef ?? '—'}</dd>
            <dt className="text-gray-500">대상 글</dt>
            <dd className="font-mono text-xs">{row.targetPostId ?? '— (미연결)'}</dd>
          </dl>
          <p className="mt-1 text-xs text-gray-400">
            원문 · 원댓글 전문은 저장하지 않습니다 — 참조만 남깁니다.
          </p>
        </section>

        {/* 결정 이력 */}
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-bold text-gray-700">결정</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-gray-200 px-4 py-3 text-sm">
            <dt className="text-gray-500">생성</dt>
            <dd>{formatKst(row.createdAt)}</dd>
            <dt className="text-gray-500">결정자</dt>
            <dd>{row.decidedBy ?? '—'}</dd>
            <dt className="text-gray-500">결정 시각</dt>
            <dd>{row.decidedAt === null ? '—' : formatKst(row.decidedAt)}</dd>
            <dt className="text-gray-500">폐기 사유</dt>
            <dd>{row.declineReason ?? '—'}</dd>
          </dl>
        </section>

        {/* 🔴 액션은 read-only. write 는 다음 단계로 분리했다 */}
        <div className="rounded-lg bg-amber-50 px-4 py-3">
          <div className="flex flex-wrap gap-2">
            {['승인', '수정 후 승인', '폐기'].map((label) => (
              <button
                key={label}
                type="button"
                disabled
                className="min-h-[52px] cursor-not-allowed rounded-lg border border-gray-300 bg-gray-100 px-4 text-sm text-gray-400"
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-amber-900">
            아직 저장되지 않습니다. 승인·반려 기록은 다음 단계에서 붙입니다.
            <br />
            승인하더라도 발행되지 않습니다 — 발행 경로는 별도 승인 대상입니다.
          </p>
        </div>
      </div>
    </PageShell>
  )
}
