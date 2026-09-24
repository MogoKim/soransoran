/**
 * 🔴 **운영 재고 조립은 한 곳이다** (2026-09-24 마스터 지적)
 *
 *   앞판 `stage:probe` 는 APPROVED·미발행 223건을 **전부 `profile:'human'` 으로
 *   하드코딩**해 재고로 넣었다. 그래서 d5 지속 READY 가 나왔다.
 *   같은 시각 배포된 발행 러너의 실제 결과는 **최종 발행 가능 0건** 이었다:
 *   ```
 *   대기열 223 → profile 불일치 214 · 사람 미검토 기계 후보 5 · gate 탈락 3 → 적격 1
 *   남은 1건은 TTL 만료 → 발행 가능 0
 *   ```
 *   축약 조립은 실제보다 강했고, 그 위에서 만든 판정은 거짓이었다.
 *
 * 🔴 **그래서 러너와 probe 가 이 함수 하나를 쓴다.** select · AutoRow 조립 ·
 *    `selectAutoTargets` · 안전 재판정 · QueueCandidate 조립 · TTL · Persona 배정이
 *    전부 여기 있다. 호출부에서 다시 조립하지 않는다.
 *
 * 🔴 읽기만 한다 — DB write 0.
 */
import type { PrismaClient } from '@prisma/client'

import {
  selectAutoTargets, voiceInputOf, type AutoRow,
} from '../../src/lib/original-post-auto-publish'
import { safetyFilter } from './micro-seed-safety-filter.mjs'
import type { QueueCandidate } from '../../src/lib/supply-candidates'

export type LoadedStock = {
  /** 대기열 전체 (APPROVED·EDITED · 미발행) */
  queueTotal: number
  /** 🔴 `selectAutoTargets` 를 통과한 자동 발행 후보 */
  targets: AutoRow[]
  /** 제외 사유별 개수 — 값이다 */
  rejectedByCode: { code: string; count: number; ids: string[] }[]
  /** 정본과 같은 모양의 후보 — 여기서 profile 을 하드코딩하지 않는다 */
  queueCandidates: QueueCandidate[]
  /** 🔴 기계가 만든 후보 수 (decidedBy 가 machine:) */
  machineCandidates: number
  /** 🔴 사람이 검토를 마친 행 수 */
  humanReviewed: number
  personas: Record<string, unknown>[]
  history: { code: string; matchedAts: Date[] }[]
  publishedToday: number
}

const kstDayStart = (now: Date): Date => {
  const kst = new Date(now.getTime() + 9 * 3600_000)
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3600_000)
}

/**
 * 🔴 **발행 러너와 똑같이 읽고 똑같이 조립한다.**
 *    바꾸려면 이 한 곳을 바꾼다 — 그러면 러너와 probe 가 함께 바뀐다.
 */
export async function loadPublishableStock(
  prisma: PrismaClient, now: Date,
): Promise<LoadedStock> {
  const raw = await prisma.originalPostApprovalQueue.findMany({
    where: { status: { in: ['APPROVED', 'EDITED'] }, createdPostId: null },
    select: {
      id: true, status: true, createdPostId: true, gateVerdict: true,
      promptVersion: true, model: true, matchedPersonaId: true,
      draftTitle: true, draftBody: true, editedTitle: true, editedBody: true,
      gateResults: true, decidedBy: true, decidedAt: true, createdAt: true,
      rawContent: { select: { sourceSite: true, sourceCapturedAt: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  const rows: AutoRow[] = raw.map((r) => ({
    id: r.id, status: r.status, createdPostId: r.createdPostId, gateVerdict: r.gateVerdict,
    promptVersion: r.promptVersion, model: r.model, matchedPersonaId: r.matchedPersonaId,
    gateResults: r.gateResults,
    title: r.editedTitle ?? r.draftTitle,
    body: r.editedBody ?? r.draftBody,
    sourceSite: r.rawContent.sourceSite,
    draftTitle: r.draftTitle, editedTitle: r.editedTitle,
    decidedBy: r.decidedBy, decidedAt: r.decidedAt, createdAt: r.createdAt,
  }))

  // 🔴 안전 재판정 — 저장된 값을 믿지 않는다. 러너와 **같은 함수**다
  const { targets, rejected } = selectAutoTargets(
    rows, (t, b) => safetyFilter({ title: t, body: b }).verdict,
  )
  const byCode = new Map<string, string[]>()
  for (const r of rejected) byCode.set(r.code, [...(byCode.get(r.code) ?? []), r.id])
  const rejectedByCode = [...byCode]
    .map(([code, ids]) => ({ code, count: ids.length, ids }))
    .sort((a, b) => b.count - a.count)

  const capturedAtOf = new Map(raw.map((r) => [r.id, r.rawContent?.sourceCapturedAt ?? null]))

  const WEEK_AGO = new Date(now.getTime() - 7 * 864e5)
  const personaRows = await prisma.persona.findMany({
    where: { status: 'active' },
    select: {
      id: true, code: true, status: true, identity: true, voiceCore: true, noGoTopics: true,
      user: { select: { providerId: true, _count: { select: { accounts: true } } } },
    },
  })
  const codeOfPersonaId = new Map(personaRows.map((r) => [r.id, r.code]))
  const personas: Record<string, unknown>[] = []
  for (const r of personaRows) {
    const id = (r.identity ?? {}) as Record<string, unknown>
    const postsThisWeek = await prisma.originalPostApprovalQueue.count({
      where: { matchedPersona: { code: r.code }, matchedAt: { gte: WEEK_AGO } },
    })
    const last = await prisma.originalPostApprovalQueue.findFirst({
      where: { matchedPersona: { code: r.code } },
      orderBy: { matchedAt: 'desc' }, select: { matchedAt: true },
    })
    personas.push({
      code: r.code, status: r.status,
      providerId: r.user?.providerId ?? null,
      accountCount: r.user?._count.accounts ?? null,
      ageBand: typeof id.ageBand === 'string' ? id.ageBand : null,
      maritalStatus: typeof id.maritalStatus === 'string' ? id.maritalStatus : null,
      childrenCount: typeof id.childrenCount === 'number' ? id.childrenCount : null,
      childrenAgeBands: Array.isArray(id.childrenAgeBands) ? id.childrenAgeBands : [],
      region: typeof id.region === 'string' ? id.region : null,
      lifeStage: typeof id.lifeStage === 'string' ? id.lifeStage : null,
      noGoTopics: Array.isArray(r.noGoTopics) ? r.noGoTopics : [],
      postsThisWeek,
      daysSinceLastPost: last?.matchedAt == null ? null
        : Math.floor((now.getTime() - last.matchedAt.getTime()) / 864e5),
    })
  }

  /** 🔴 말투·profile 은 정본 `voiceInputOf` 가 만든다 — 여기서 하드코딩하지 않는다 */
  const queueCandidates: QueueCandidate[] = targets.map((t, i) => ({
    queueId: t.id, title: t.title, body: t.body, gateVerdict: t.gateVerdict, createdAt: i,
    assignedPersonaCode: t.matchedPersonaId === null
      ? null
      : (codeOfPersonaId.get(t.matchedPersonaId) ?? `__unknown:${t.matchedPersonaId}`),
    ...voiceInputOf(t),
    capturedAt: capturedAtOf.get(t.id) ?? null,
  }))

  const historyRows = await prisma.personaActivityLog.findMany({
    where: { kind: 'post' }, select: { createdAt: true, persona: { select: { code: true } } },
  })
  const history = personas.map((p) => ({
    code: String(p.code),
    matchedAts: historyRows.filter((l) => l.persona?.code === p.code).map((l) => l.createdAt),
  }))
  const publishedToday = await prisma.personaActivityLog.count({
    where: { kind: 'post', createdAt: { gte: kstDayStart(now) } },
  })

  /** 🔴 세 수를 서로 다른 값으로 낸다 — 섞으면 "재고가 있다" 는 거짓이 된다 */
  const machineCandidates = rows.filter((r) => String(r.decidedBy ?? '').startsWith('machine:')).length
  const humanReviewed = rows.filter((r) => {
    const d = String(r.decidedBy ?? '')
    return d !== '' && !d.startsWith('machine:')
  }).length

  return {
    queueTotal: rows.length, targets, rejectedByCode, queueCandidates,
    machineCandidates, humanReviewed, personas, history, publishedToday,
  }
}
