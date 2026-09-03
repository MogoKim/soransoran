import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import PageShell from '@/components/layouts/PageShell'
import { requireAdmin } from '@/lib/admin'
import { prisma } from '@/lib/prisma'
import {
  maskNickname, hasValue, filledMark, STATUS_LABEL, AUDIT_ACTION_LABEL, formatKst,
} from '@/lib/persona-admin'

/**
 * 페르소나 상세 — 🔴 읽기 전용
 *
 * 정본: docs/operations/2026-08-31-persona-db-model-design.md §10
 *       Pool 설계 §3-2 — 어드민에서는 displayName 뒤가 전부 보여야 한다
 *
 * 🔴 여기서만 닉네임 전문을 보여준다.
 *    목록은 마스킹이다(스크린샷 · 화면 공유로 새는 경로가 있다).
 *    상세는 한 명씩 열어야 하므로 노출 범위가 좁다.
 *
 * 🔴 이번 판에서 하지 않는 것
 *      · status 전환 · cap 수정 · kill switch 조작 — DB write 없음
 *      · memory 내용 표시 — 건수만. 회원 관계 기억이 섞여 있다
 */
export const metadata: Metadata = {
  title: '페르소나 상세',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function AdminPersonaDetailPage({
  params,
}: {
  params: Promise<{ personaId: string }>
}) {
  const { ok } = await requireAdmin()
  const { personaId } = await params

  if (!ok) {
    return (
      <PageShell chrome="minimal">
        <main className="mx-auto max-w-3xl px-4 py-16 text-center">
          <h1 className="text-xl font-bold text-content-primary">접근 권한이 없습니다</h1>
          <Link href="/" className="mt-6 inline-block text-link">홈으로 가기</Link>
        </main>
      </PageShell>
    )
  }

  const persona = await prisma.persona.findUnique({
    where: { id: personaId },
    select: {
      id: true, code: true, status: true,
      activatedAt: true, pausedAt: true, retiredAt: true,
      retiredDisplayNames: true,
      ageBand: true, region: true, lifeStage: true,
      identity: true, voiceCore: true, voiceVariations: true, activityRhythm: true,
      noGoTopics: true, noGoExpressions: true, forbiddenReactionRoles: true,
      dailyCap: true, weeklyCap: true, silenceRate: true,
      createdAt: true, updatedAt: true,
      user: { select: { id: true, nickname: true, name: true } },
      _count: {
        select: {
          selfMemories: true, relationships: true,
          communityMemories: true, negativeMemories: true,
          activityLogs: true, moodStates: true,
        },
      },
    },
  })
  if (persona === null) notFound()

  const [auditLogs, killSwitch, postCount, commentCount] = await Promise.all([
    prisma.personaAuditLog.findMany({
      where: { personaId },
      select: {
        id: true, action: true, fromStatus: true, toStatus: true,
        reason: true, changedFields: true, actorUserId: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.personaGlobalSwitch.findFirst({ orderBy: { changedAt: 'desc' } }),
    prisma.post.count({ where: { personaId } }),
    prisma.comment.count({ where: { personaId } }),
  ])

  const rows: Array<[string, string]> = [
    ['personaId', persona.id],
    ['P 코드', persona.code],
    ['userId', persona.user.id],
    ['status', STATUS_LABEL[persona.status] ?? persona.status],
    ['일 상한 / 주 상한', `${persona.dailyCap ?? '—'} / ${persona.weeklyCap ?? '—'}`],
    ['침묵률', persona.silenceRate?.toString() ?? '—'],
    ['ageBand · region · lifeStage', [persona.ageBand, persona.region, persona.lifeStage].map((v) => v ?? '—').join(' · ')],
    ['identity', filledMark(persona.identity)],
    ['voiceCore', filledMark(persona.voiceCore)],
    ['voiceVariations', filledMark(persona.voiceVariations)],
    ['activityRhythm', filledMark(persona.activityRhythm)],
    ['noGoTopics', persona.noGoTopics.length > 0 ? `${persona.noGoTopics.length}개` : '—'],
    ['noGoExpressions', persona.noGoExpressions.length > 0 ? `${persona.noGoExpressions.length}개` : '—'],
    ['forbiddenReactionRoles', persona.forbiddenReactionRoles.length > 0 ? persona.forbiddenReactionRoles.join(' · ') : '—'],
    ['폐기한 이름', persona.retiredDisplayNames.length > 0 ? `${persona.retiredDisplayNames.length}개` : '—'],
    ['발화 (post / comment)', `${postCount} / ${commentCount}`],
    ['activityLog', `${persona._count.activityLogs}건`],
    ['mood 기록', `${persona._count.moodStates}일`],
    ['memory (self / relationship / community / negative)',
      `${persona._count.selfMemories} / ${persona._count.relationships} / ${persona._count.communityMemories} / ${persona._count.negativeMemories}`],
    ['생성 / 수정', `${formatKst(persona.createdAt)} / ${formatKst(persona.updatedAt)}`],
  ]

  return (
    <PageShell chrome="minimal">
      <main className="mx-auto max-w-3xl px-4 pb-16">
        <Link href="/admin/personas" className="mt-8 inline-block text-xs text-link">
          ← 관제실
        </Link>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-surface-soft px-2 py-1 text-xs font-bold text-brand-strong">
            {persona.code}
          </span>
          <h1 className="text-xl font-bold text-content-primary">
            {/* 🔴 상세에서만 전문을 보여준다 */}
            {persona.user.nickname ?? persona.user.name ?? '(이름 없음)'}
          </h1>
          <span className="rounded-md bg-surface-soft px-2 py-1 text-xs text-content-muted">
            {STATUS_LABEL[persona.status] ?? persona.status}
          </span>
        </div>
        <p className="mt-1 text-xs text-content-muted">
          목록에서는 {maskNickname(persona.user.nickname ?? persona.user.name)} 로 마스킹됩니다.
        </p>

        <section className="mt-4 rounded-lg border border-subtle bg-surface-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-content-primary">전체 중지 스위치</span>
            {/* 🔴 enabled = "중지" 다 */}
            <span className="rounded-md bg-surface-soft px-2 py-1 text-xs text-content-muted">
              {killSwitch?.enabled === true
                ? '중지 켜짐'
                : killSwitch === null
                  ? '중지 꺼짐 (미생성)'
                  : '중지 꺼짐'}
            </span>
            {/* 🔴 전환은 목록에서만 한다 — write 경로를 한 곳으로 모은다 */}
            <Link href="/admin/personas" className="text-xs text-link">
              관제실에서 전환
            </Link>
          </div>
          {killSwitch !== null ? (
            <p className="mt-2 text-xs text-content-muted">
              마지막 변경 {formatKst(killSwitch.changedAt)}
              {killSwitch.reason !== null ? ` · 사유: ${killSwitch.reason}` : ''}
            </p>
          ) : null}
        </section>

        <table className="mt-4 w-full table-fixed border-collapse text-sm">
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label} className="border-b border-subtle">
                <th className="w-2/5 py-2 pr-2 text-left align-top font-normal text-content-muted">
                  {label}
                </th>
                <td className="py-2 align-top text-content-primary break-words">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-3 text-xs text-content-muted">
          🔴 identity · voiceCore · memory 는 값의 유무와 건수만 보여줍니다.
          내용 열람은 별도 승인 후 붙입니다 — 관계 기억에는 회원 정보가 섞입니다.
        </p>

        <h2 className="mt-8 text-lg font-bold text-content-primary">변경 이력</h2>
        <p className="mt-1 text-xs text-content-muted">최근 100건 · 총 {auditLogs.length}건</p>
        {auditLogs.length === 0 ? (
          <p className="py-8 text-center text-sm text-content-muted">이력이 없습니다.</p>
        ) : (
          <ul className="mt-3 flex list-none flex-col gap-2 p-0">
            {auditLogs.map((log) => (
              <li key={log.id} className="rounded-lg border border-subtle bg-surface-card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-surface-soft px-2 py-1 text-xs font-bold text-brand-strong">
                    {AUDIT_ACTION_LABEL[log.action] ?? log.action}
                  </span>
                  {log.fromStatus !== null || log.toStatus !== null ? (
                    <span className="text-xs text-content-muted">
                      {log.fromStatus ?? '—'} → {log.toStatus ?? '—'}
                    </span>
                  ) : null}
                  <span className="text-xs text-content-muted">{formatKst(log.createdAt)}</span>
                  <span className="text-xs text-content-muted">
                    {log.actorUserId === null ? '자동' : `운영자 ${log.actorUserId}`}
                  </span>
                </div>
                {hasValue(log.reason) ? (
                  <p className="mt-1 text-sm text-content-primary">{log.reason}</p>
                ) : null}
                {log.changedFields.length > 0 ? (
                  <p className="mt-1 text-xs text-content-muted">
                    바뀐 필드: {log.changedFields.join(' · ')}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </main>
    </PageShell>
  )
}
