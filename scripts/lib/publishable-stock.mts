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
  selectAutoTargets, voiceInputOf, profileOf, machineReviewedByHuman, pickPublishTarget,
  type AutoRow, type Reject,
} from '../../src/lib/original-post-auto-publish'
import { prepareCandidates } from '../../src/lib/supply-candidates'
import type { HoldReason } from '../../src/lib/supply-freshness'
import { effectiveWeeklyCap, type ScaleProfile } from '../../src/lib/scale-profile'
import { safetyFilter } from './micro-seed-safety-filter.mjs'
import type { QueueCandidate } from '../../src/lib/supply-candidates'

export type LoadedStock = {
  /** 대기열 전체 (APPROVED·EDITED · 미발행) */
  queueTotal: number
  /** 🔴 `selectAutoTargets` 를 통과한 자동 발행 후보 */
  targets: AutoRow[]
  /** 🔴 정본 `selectAutoTargets` 가 낸 제외 목록 그대로 — 러너가 그대로 소비한다 */
  rejected: Reject[]
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
  /** 🔴 이미 배정된 행을 code 로 바꾸는 표 — 러너가 쓰던 것과 같다 */
  codeOfPersonaId: Map<string, string>
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
    const vc = (r.voiceCore ?? {}) as Record<string, unknown>
    /**
     * 🔴 **발행 러너의 의미를 그대로 옮긴다** — 값을 늘리거나 바꾸지 않는다.
     *    `workStatus`·`economicStatus`·`region` 은 러너가 `null` 로 넘긴다.
     *    여기서 채우면 **배정 결과가 러너와 달라진다** — 그것이 이 함수의 목적을 깬다.
     */
    personas.push({
      code: r.code, status: r.status,
      providerId: r.user?.providerId ?? null,
      accountCount: r.user?._count.accounts ?? null,
      ageBand: typeof id.ageBand === 'string' ? id.ageBand : null,
      maritalStatus: typeof id.maritalStatus === 'string' ? id.maritalStatus : null,
      childrenCount: typeof id.childrenCount === 'number' ? id.childrenCount : null,
      ...(Array.isArray(id.childrenAgeBands) ? { childrenAgeBands: id.childrenAgeBands } : {}),
      parentCare: typeof id.parentCare === 'string' ? id.parentCare : null,
      menopauseStatus: typeof id.menopauseStatus === 'string' ? id.menopauseStatus : null,
      workStatus: null, economicStatus: null, region: null,
      noGoTopics: r.noGoTopics,
      voiceLength: typeof vc.length === 'string' ? vc.length : null,
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

  /**
   * 🔴 **사람 검토는 정본 계약으로 센다** (2026-09-24 마스터 지적).
   *    임의의 non-machine 문자열을 사람 검토로 세면 `null`·모르는 값까지 사람이 본 것이 된다.
   */
  const machineCandidates = rows.filter((r) => profileOf(r) === 'machine').length
  const humanReviewed = rows.filter((r) => machineReviewedByHuman(r.decidedBy)).length

  return {
    queueTotal: rows.length, targets, rejected, rejectedByCode, queueCandidates,
    machineCandidates, humanReviewed, personas, history, publishedToday,
    codeOfPersonaId,
  }
}

/**
 * 🔴 **재고를 단계로 나눈다** (2026-09-24 마스터 지적).
 *    `targets.length` 를 "실제 발행 가능 재고" 라고 부르지 않는다 —
 *    TTL·배정을 거쳐야 그날 낼 수 있는 수가 나온다.
 */
/**
 * 🔴 **발행 상한도 한 곳에서 만든다.** 러너와 probe 가 각자 계산하면
 *    같은 단계인데 다른 배정이 나온다 — 그것이 이 파일의 목적을 깬다.
 */
export const releaseCapsOf = (p: ScaleProfile): { postsPerWeek: number; minDaysBetween: number } => ({
  postsPerWeek: effectiveWeeklyCap(p.postsPerWeek, p.minDaysBetween),
  minDaysBetween: p.minDaysBetween,
})

/**
 * 🔴 **publisher 의 실제 계약대로 센다** (2026-09-24 마스터 지적).
 *
 *    앞판은 `prepared.auto` 를 "publishable" 이라 불렀다. 그것은 **신선도 통과 목록**이지
 *    최종 발행 가능 목록이 아니다. 그리고 `batch.assignments` 에는 `assigned === null`
 *    행도 들어 있다 — 그것을 배정 성공으로 세면 재고가 부풀어 오른다.
 *
 * 🔴 publisher 가 실제로 하는 일:
 *    ```
 *    prepared.auto 로 freshOrdered 를 세우고
 *    brokenRecovery(=recoveryProblem !== null)가 하나라도 있으면 **전체 중단**
 *    pickPublishTarget(freshOrdered, assignedOf, isRecovery) → 이번에 나갈 한 건
 *    ```
 */
export type StockStages = {
  /** ① 전체 미발행 queue */
  queueTotal: number
  /** ② `selectAutoTargets` 통과 */
  selectorTargets: { count: number; ids: string[] }
  /** ③ 신선도 통과 — 🔴 `prepared.auto` 에서 **직접** 가져온다(정규식 분류 없음) */
  freshnessPassed: { count: number; ids: string[] }
  /** ④ 🔴 배정 **성공** — `assigned !== null` 이고 `recoveryProblem === null` 인 행만 */
  successfullyAssigned: { count: number; ids: string[] }
  /**
   * ⑤ 🔴 **지금 돌릴 수 있는가.** broken recovery 가 하나라도 있으면 publisher 는
   *    전체를 중단하므로 0 이다 — 배정이 아무리 많아도 그렇다.
   */
  runnableNow: { count: number; ids: string[] }
  /** 🔴 이번 회차에 실제로 집히는 한 건 — `pickPublishTarget` 결과 */
  nextPickedId: string | null
  /** 🔴 전체 중단 사유 — 있으면 `runnableNow` 는 0 이다 */
  brokenRecovery: { id: string; problem: string }[]
  /** hold 사유별 — 🔴 닫힌 enum 값 그대로다 */
  holdsByReason: { reason: HoldReason; count: number; ids: string[] }[]
}

export function stageStock(input: {
  loaded: LoadedStock
  caps: Parameters<typeof prepareCandidates>[0]['caps']
  at: Date
}): StockStages {
  const { loaded } = input
  /** 🔴 러너와 **같은 `prepareCandidates`** 를 부른다 — 여기서 다시 판정하지 않는다 */
  const prepared = prepareCandidates({
    candidates: loaded.queueCandidates, personas: loaded.personas as never,
    caps: input.caps, at: input.at,
  })
  /** 🔴 `HoldReason` 은 닫힌 enum 이다 — 정규식으로 분류하지 않는다 */
  const holdIds = new Map<HoldReason, string[]>()
  for (const h of prepared.held) {
    holdIds.set(h.hold, [...(holdIds.get(h.hold) ?? []), h.queueId])
  }

  const selectorIds = loaded.targets.map((t) => t.id)
  /** 🔴 신선도 통과는 `prepared.auto` 가 정본이다 */
  const freshIds = prepared.auto.map((c) => c.queueId)

  const assignOf = new Map(prepared.batch.assignments.map((a) => [a.queueId, a]))
  /**
   * 🔴 **배정 성공** — `assigned === null` 은 "이 배치에서 발행하지 않는다" 이고,
   *    `recoveryProblem !== null` 은 기존 배정이 깨진 것이다. 둘 다 성공이 아니다.
   */
  const assignedIds = prepared.batch.assignments
    .filter((a) => a.assigned !== null && (a.recoveryProblem ?? null) === null)
    .map((a) => a.queueId)

  /** 🔴 publisher 와 같은 순서 — `prepared.auto` 순서로 selector 대상을 세운다 */
  const orderById = new Map(prepared.auto.map((c, i) => [c.queueId, i]))
  const freshOrdered = loaded.targets
    .filter((t) => orderById.has(t.id))
    .sort((a, b) => orderById.get(a.id)! - orderById.get(b.id)!)

  /** 🔴 publisher 는 broken recovery 가 하나라도 있으면 **전체 중단**한다 */
  const brokenRecovery = loaded.targets
    .map((t) => ({ id: t.id, problem: assignOf.get(t.id)?.recoveryProblem ?? null }))
    .filter((x): x is { id: string; problem: string } => x.problem !== null)

  const picked = brokenRecovery.length > 0 ? null : pickPublishTarget({
    ordered: freshOrdered,
    assignedOf: (id) => assignOf.get(id)?.assigned ?? null,
    isRecovery: (id) => assignOf.get(id)?.recovery === true,
  }).picked
  const runnableIds = brokenRecovery.length > 0
    ? []
    : freshOrdered.filter((t) => (assignOf.get(t.id)?.assigned ?? null) !== null).map((t) => t.id)

  return {
    queueTotal: loaded.queueTotal,
    selectorTargets: { count: selectorIds.length, ids: selectorIds },
    freshnessPassed: { count: freshIds.length, ids: freshIds },
    successfullyAssigned: { count: assignedIds.length, ids: assignedIds },
    runnableNow: { count: runnableIds.length, ids: runnableIds },
    nextPickedId: picked?.id ?? null,
    brokenRecovery,
    holdsByReason: [...holdIds]
      .map(([reason, ids]) => ({ reason, count: ids.length, ids }))
      .sort((a, b) => b.count - a.count),
  }
}
