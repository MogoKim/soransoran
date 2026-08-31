import type { Metadata } from 'next'
import Link from 'next/link'
import PageShell from '@/components/layouts/PageShell'
import { requireAdmin } from '@/lib/admin'
import { prisma } from '@/lib/prisma'
import { maskNickname, filledMark, STATUS_LABEL, formatKst } from '@/lib/persona-admin'

/**
 * 페르소나 관제실 — 🔴 읽기 전용
 *
 * 정본: docs/operations/2026-08-31-persona-db-model-design.md
 *       전략 §10-2 — 어드민은 승인 버튼 화면이 아니라 자동화 관제실이다
 *
 * 🔴 이 화면이 존재하는 이유
 *    공개 정책이 "외부 비공개" 라서 고객은 페르소나를 식별할 수 없다.
 *    그 대가로 내부 추적성이 유일한 통제 수단이 된다(전략 §10-3).
 *    실고객과 페르소나가 같은 User 테이블에 섞여 있으므로,
 *    여기서 구분되지 않으면 어디서도 구분되지 않는다.
 *
 * 🔴 이번 판에서 하지 않는 것
 *      · status 전환 · kill switch 조작 · cap 수정 — DB write 없음
 *      · 닉네임 전문 노출 — 목록은 마스킹만 (§3 상세에서 개별 확인)
 *      · 고객 화면 변경 — 이 파일은 고객 경로에서 import 되지 않는다
 */
export const metadata: Metadata = {
  title: '페르소나 관제실',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function AdminPersonasPage() {
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

  const [personas, memberCount, killSwitch, linkedPosts, linkedComments] = await Promise.all([
    prisma.persona.findMany({
      select: {
        id: true, code: true, status: true, dailyCap: true, weeklyCap: true, silenceRate: true,
        identity: true, voiceCore: true, voiceVariations: true, activityRhythm: true,
        noGoTopics: true, noGoExpressions: true, createdAt: true,
        user: { select: { id: true, nickname: true, name: true } },
        _count: {
          select: {
            selfMemories: true, relationships: true,
            communityMemories: true, negativeMemories: true,
            activityLogs: true, moodStates: true,
          },
        },
      },
      orderBy: { code: 'asc' },
    }),
    // 🔴 실회원 = Persona 가 붙지 않은 User
    prisma.user.count({ where: { persona: null } }),
    prisma.personaGlobalSwitch.findFirst({ orderBy: { changedAt: 'desc' } }),
    prisma.post.count({ where: { personaId: { not: null } } }),
    prisma.comment.count({ where: { personaId: { not: null } } }),
  ])

  const switchOn = killSwitch?.enabled === true

  return (
    <PageShell chrome="minimal">
      <main className="mx-auto max-w-5xl px-4 pb-16">
        <h1 className="pt-8 text-xl font-bold text-content-primary">페르소나 관제실</h1>
        <p className="mt-1 text-sm text-content-muted">
          읽기 전용입니다. 상태 전환 · 중지 · 수정은 아직 여기서 하지 않습니다.
        </p>

        {/* ── 구분 요약 — 실고객과 페르소나 ── */}
        <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-subtle bg-surface-card p-4">
            <p className="text-xs text-content-muted">실회원</p>
            <p className="mt-1 text-lg font-bold text-content-primary">{memberCount}명</p>
          </div>
          <div className="rounded-lg border border-subtle bg-surface-card p-4">
            <p className="text-xs text-content-muted">페르소나</p>
            <p className="mt-1 text-lg font-bold text-brand-ink">{personas.length}명</p>
          </div>
          <div className="rounded-lg border border-subtle bg-surface-card p-4">
            <p className="text-xs text-content-muted">페르소나 글</p>
            <p className="mt-1 text-lg font-bold text-content-primary">{linkedPosts}건</p>
          </div>
          <div className="rounded-lg border border-subtle bg-surface-card p-4">
            <p className="text-xs text-content-muted">페르소나 댓글</p>
            <p className="mt-1 text-lg font-bold text-content-primary">{linkedComments}건</p>
          </div>
        </section>

        {/* ── 전체 kill switch — 🔴 읽기 전용 ── */}
        <section className="mt-4 rounded-lg border border-subtle bg-surface-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-content-primary">전체 발화 스위치</span>
            <span
              className={`rounded-md px-2 py-1 text-xs font-bold ${
                switchOn ? 'bg-surface-soft text-brand-ink' : 'bg-surface-soft text-content-muted'
              }`}
            >
              {killSwitch === null ? '미생성 (= 꺼짐)' : switchOn ? '켜짐' : '꺼짐'}
            </span>
            <button
              type="button"
              disabled
              className="cursor-not-allowed rounded-md border border-subtle px-3 py-1 text-xs text-content-muted opacity-60"
            >
              전환 (준비 중)
            </button>
          </div>
          <p className="mt-2 text-xs text-content-muted">
            🔴 이 판에서는 상태만 봅니다. 전환 기능은 별도 승인 후 붙입니다.
            {killSwitch?.reason ? ` · 사유: ${killSwitch.reason}` : ''}
            {killSwitch ? ` · ${formatKst(killSwitch.changedAt)}` : ''}
          </p>
        </section>

        {/* ── 페르소나 목록 ── */}
        {personas.length === 0 ? (
          <p className="py-16 text-center text-content-muted">등록된 페르소나가 없습니다.</p>
        ) : (
          <ul className="mt-6 flex list-none flex-col gap-3 p-0">
            {personas.map((p) => {
              const memoryCount =
                p._count.selfMemories + p._count.relationships +
                p._count.communityMemories + p._count.negativeMemories
              const noGo = p.noGoTopics.length + p.noGoExpressions.length
              return (
                <li key={p.id} className="rounded-lg border border-subtle bg-surface-card p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-surface-soft px-2 py-1 text-xs font-bold text-brand-ink">
                      {p.code}
                    </span>
                    {/* 🔴 마스킹. 전문은 상세에서만 */}
                    <span className="text-sm font-bold text-content-primary">
                      {maskNickname(p.user.nickname ?? p.user.name)}
                    </span>
                    <span className="rounded-md bg-surface-soft px-2 py-1 text-xs text-content-muted">
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                    <Link
                      href={`/admin/personas/${p.id}`}
                      className="ml-auto text-xs text-link"
                    >
                      상세
                    </Link>
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                    <div className="flex gap-1">
                      <dt className="text-content-muted">일 상한</dt>
                      <dd className="text-content-primary">{p.dailyCap ?? '—'}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="text-content-muted">주 상한</dt>
                      <dd className="text-content-primary">{p.weeklyCap ?? '—'}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="text-content-muted">침묵률</dt>
                      <dd className="text-content-primary">{p.silenceRate?.toString() ?? '—'}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="text-content-muted">발화</dt>
                      <dd className="text-content-primary">{p._count.activityLogs}건</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="text-content-muted">identity</dt>
                      <dd className="text-content-primary">{filledMark(p.identity)}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="text-content-muted">voiceCore</dt>
                      <dd className="text-content-primary">{filledMark(p.voiceCore)}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="text-content-muted">variations</dt>
                      <dd className="text-content-primary">{filledMark(p.voiceVariations)}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="text-content-muted">rhythm</dt>
                      <dd className="text-content-primary">{filledMark(p.activityRhythm)}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="text-content-muted">noGo</dt>
                      <dd className="text-content-primary">{noGo > 0 ? `${noGo}개` : '—'}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="text-content-muted">memory</dt>
                      <dd className="text-content-primary">{memoryCount > 0 ? `${memoryCount}건` : '—'}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="text-content-muted">mood</dt>
                      <dd className="text-content-primary">{p._count.moodStates}일</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="text-content-muted">생성</dt>
                      <dd className="text-content-primary">{formatKst(p.createdAt)}</dd>
                    </div>
                  </dl>
                </li>
              )
            })}
          </ul>
        )}

        <p className="mt-8 text-xs text-content-muted">
          🔴 고객 화면에는 페르소나 표시가 없습니다(전략 §10-1). 구분은 여기에서만 합니다.
        </p>
      </main>
    </PageShell>
  )
}
