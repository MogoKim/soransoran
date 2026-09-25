/**
 * 🔴 **자동 READY v2 — 저장 경로** (2026-09-25 · feat/auto-ready-v2)
 *
 *   candidate → row eligibility → **auto-ready:v1 도장** → selector 수용
 *   → publish transaction 내부 재검증 → Post → **감사 선정·결과 저장** → 결함 시 자동 중지
 *
 * 🔴 **스위치 기본 OFF** (`SORAN_AUTO_READY_ENABLED`). 꺼져 있으면 이 파일의 쓰기 경로는
 *    돌지 않고, 감사 표(`AutoReadyAudit`)도 읽지 않는다 — 표가 운영에 없어도 깨지지 않는다.
 * 🔴 **founder 를 쓰지 않는다.** 도장은 `auto-ready:v1` 뿐이고, 감사자도 `founder` 일 수 없다.
 * 🔴 **경쟁 조건** — 모든 쓰기는 Serializable 트랜잭션 안의 조건부 쓰기다.
 *    읽은 뒤 쓰는 사이에 누가 먼저 바꿨으면 0건이 되고, 그 회차는 진다(재시도하지 않는다).
 * 🔴 새 대기 기간·pending 상수·승인 규율을 만들지 않는다. 계약 값은 `AUTO_READY_CONTRACT` 다.
 */
import { Prisma, type PrismaClient } from '@prisma/client'

import {
  AUTO_DECIDER, HUMAN_DECIDER, AUTO_READY_RECORD_KEY,
  eligibilityOf, makeStamp, readStamp, stampValidFor, pickAudits, judgeOpen,
  type OpenState, type DefectMark,
} from './auto-ready-v2'
import { cohortSampleOf } from './auto-ready-evidence'
import { profileOf } from './original-post-auto-publish'

type Tx = Prisma.TransactionClient
const SERIALIZABLE = { isolationLevel: 'Serializable' as const, maxWait: 5_000, timeout: 15_000 }

const rec = (v: unknown): Record<string, unknown> =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})

const isConflict = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2034' || e.code === 'P2002')

/** 🔴 확정 결함(yes) 수 — 하나라도 있으면 자동 회차가 닫힌다 */
export async function confirmedDefectCount(db: PrismaClient | Tx): Promise<number> {
  return db.autoReadyAudit.count({ where: { defect: 'yes' } })
}

/**
 * 🔴 **런타임 증거** — DB 에 **저장된** 근거만으로 잰다(fail-closed).
 *    로컬 artifact 로 복원한 근거는 GitHub Actions 러너가 읽을 수 없다. 그것을 여기서
 *    쓰려면 복원 결과를 durable 하게 저장해야 하는데, 그 쓰기는 아직 승인되지 않았다.
 *    그래서 지금은 "사람이 결정한 기계 후보 중, 저장된 게이트만으로 경고 0 인 행" 만 센다.
 */
export async function evidenceFromDb(db: PrismaClient): Promise<ReturnType<typeof cohortSampleOf>> {
  const rows = await db.originalPostApprovalQueue.findMany({
    where: { decidedBy: HUMAN_DECIDER },
    select: {
      decidedBy: true, gateVerdict: true, gateResults: true, draftTitle: true, draftBody: true,
      editDiff: true, declineReason: true, promptVersion: true, model: true,
      rawContent: { select: { sourceSite: true, sourceCapturedAt: true } },
    },
  })
  const eligible = rows.filter((r) => profileOf({
    promptVersion: r.promptVersion, model: r.model, sourceSite: r.rawContent.sourceSite,
    gateResults: r.gateResults,
  } as never) === 'machine' && eligibilityOf({
    gateVerdict: r.gateVerdict, gateResults: r.gateResults,
    title: r.draftTitle, body: r.draftBody, sourceCapturedAt: r.rawContent.sourceCapturedAt,
  }).auto)
  return cohortSampleOf(eligible)
}

/** 🔴 지금 열려 있는가 — 스위치가 꺼져 있으면 **DB 를 읽지 않고** 닫힘이다 */
export async function autoReadyOpenState(db: PrismaClient, enabled: boolean): Promise<OpenState> {
  if (!enabled) return judgeOpen({ enabled: false, evidence: { meetsContract: false, reasons: [] }, confirmedDefects: 0 })
  const [evidence, confirmedDefects] = await Promise.all([evidenceFromDb(db), confirmedDefectCount(db)])
  return judgeOpen({ enabled, evidence, confirmedDefects })
}

export type StampOutcome =
  | { kind: 'stamped' }
  | { kind: 'closed'; reason: string }
  | { kind: 'exception'; reasons: string[] }
  | { kind: 'skip'; reason: string }
  | { kind: 'race'; reason: string }

/**
 * 🔴 **도장 — 한 행씩, 조건부로.**
 *    · 기계 도장(`machine:*`)이 찍힌 미발행 APPROVED 행만 다룬다 — 사람 결정·자동 도장은 건드리지 않는다
 *    · 트랜잭션 안에서 **지금 내보낼 제목·본문**으로 다시 판정한다
 *    · 읽은 `decidedBy`·`updatedAt` 이 그대로일 때만 쓴다(CAS) — 그 사이 바뀌었으면 진다
 *    · 트랜잭션 안에서 확정 결함을 다시 센다 — 밖에서 본 "열림" 을 믿지 않는다
 */
export async function stampAutoReady(
  prisma: PrismaClient, i: { queueId: string; open: OpenState; now: Date },
): Promise<StampOutcome> {
  if (!i.open.open) return { kind: 'closed', reason: i.open.reasons.join(' · ') }
  try {
    return await prisma.$transaction(async (tx): Promise<StampOutcome> => {
      if (await confirmedDefectCount(tx) > 0) return { kind: 'closed', reason: '확정 결함이 있다(트랜잭션 안에서 다시 셌다)' }
      const row = await tx.originalPostApprovalQueue.findUnique({
        where: { id: i.queueId },
        select: {
          id: true, status: true, createdPostId: true, decidedBy: true, updatedAt: true,
          draftTitle: true, draftBody: true, editedTitle: true, editedBody: true,
          gateVerdict: true, gateResults: true, editDiff: true, promptVersion: true, model: true,
          rawContent: { select: { sourceSite: true, sourceCapturedAt: true } },
        },
      })
      if (row === null) return { kind: 'skip', reason: '행이 없다' }
      if (row.status !== 'APPROVED' || row.createdPostId !== null) return { kind: 'skip', reason: `상태 ${row.status}` }
      const d = (row.decidedBy ?? '').trim()
      // 🔴 사람이 결정한 행 · 이미 자동 도장된 행은 건드리지 않는다
      if (!d.startsWith('machine:')) return { kind: 'skip', reason: `decidedBy=${d || '(없음)'} — 기계 도장 행이 아니다` }
      if (profileOf({
        promptVersion: row.promptVersion, model: row.model, sourceSite: row.rawContent.sourceSite,
        gateResults: row.gateResults,
      } as never) !== 'machine') return { kind: 'skip', reason: '기계 profile 이 아니다' }
      const title = row.editedTitle ?? row.draftTitle
      const body = row.editedBody ?? row.draftBody
      const v = eligibilityOf({
        gateVerdict: row.gateVerdict, gateResults: row.gateResults,
        title, body, sourceCapturedAt: row.rawContent.sourceCapturedAt,
      })
      if (!v.auto) return { kind: 'exception', reasons: v.reasons }
      const updated = await tx.originalPostApprovalQueue.updateMany({
        where: {
          id: row.id, decidedBy: row.decidedBy, status: 'APPROVED', createdPostId: null,
          updatedAt: row.updatedAt,
        },
        data: {
          // 🔴 자동 표식이다. founder 가 아니다
          decidedBy: AUTO_DECIDER,
          decidedAt: i.now,
          editDiff: { ...rec(row.editDiff), [AUTO_READY_RECORD_KEY]: makeStamp(title, body, i.now) } as Prisma.InputJsonValue,
        },
      })
      if (updated.count !== 1) return { kind: 'race', reason: '읽은 뒤 행이 바뀌었다 — 이 회차는 진다' }
      return { kind: 'stamped' }
    }, SERIALIZABLE)
  } catch (e) {
    if (isConflict(e)) return { kind: 'race', reason: '직렬화 충돌 — 다른 회차가 먼저 썼다' }
    throw e
  }
}

/**
 * 🔴 **도장 회차 — 기계 도장 행 전부를 한 행씩 조건부로.**
 *    러너는 이 함수 하나만 부른다. 대상 조회와 도장이 한 곳에 있어야 러너가 상태를 짓지 않는다.
 */
export async function stampRound(
  prisma: PrismaClient, i: { open: OpenState; now: Date },
): Promise<Map<StampOutcome['kind'], number>> {
  const tally = new Map<StampOutcome['kind'], number>()
  if (!i.open.open) return tally
  const rows = await prisma.originalPostApprovalQueue.findMany({
    where: { status: 'APPROVED', createdPostId: null, decidedBy: { startsWith: 'machine:' } },
    select: { id: true }, orderBy: { createdAt: 'asc' },
  })
  for (const r of rows) {
    const o = await stampAutoReady(prisma, { queueId: r.id, open: i.open, now: i.now })
    tally.set(o.kind, (tally.get(o.kind) ?? 0) + 1)
  }
  return tally
}

/**
 * 🔴 **발행 트랜잭션 안의 재검증.** 발행 트랜잭션이 **실제로 발행할** 제목·본문으로 본다.
 *    스위치가 꺼져 있으면 표를 읽지 않고 막는다.
 */
export async function recheckAutoReadyInTx(tx: Tx, i: {
  enabled: boolean
  title: string
  body: string
  editDiff: unknown
  gateVerdict: string
  gateResults: unknown
  sourceCapturedAt: Date | null
}): Promise<{ ok: boolean; reason: string }> {
  if (!i.enabled) return { ok: false, reason: '자동 READY 스위치가 꺼져 있다' }
  const sv = stampValidFor(readStamp(i.editDiff), i.title, i.body)
  if (!sv.ok) return { ok: false, reason: sv.reason }
  const v = eligibilityOf({
    gateVerdict: i.gateVerdict, gateResults: i.gateResults,
    title: i.title, body: i.body, sourceCapturedAt: i.sourceCapturedAt,
  })
  if (!v.auto) return { ok: false, reason: `다시 판정하니 예외다 — ${v.reasons.join(' · ')}` }
  const defects = await confirmedDefectCount(tx)
  if (defects > 0) return { ok: false, reason: `확정 결함 ${defects}건 — 자동 발행을 멈춘다` }
  return { ok: true, reason: '' }
}

/**
 * 🔴 **감사 선정 — 정확히 ceil(N×0.2), 중복 없이.**
 *    N = 자동 도장으로 발행된 글 수(누적). 이미 고른 것은 다시 고르지 않고 모자란 만큼만 더 고른다.
 *    queueId 기본키가 중복을 DB 수준에서도 막는다.
 */
export async function selectAudits(prisma: PrismaClient): Promise<
  { kind: 'ok'; n: number; target: number; picked: string[] } | { kind: 'race'; reason: string }
> {
  try {
    return await prisma.$transaction(async (tx) => {
      const published = await tx.originalPostApprovalQueue.findMany({
        where: { decidedBy: AUTO_DECIDER, createdPostId: { not: null } },
        select: { id: true, createdPostId: true },
      })
      const existing = await tx.autoReadyAudit.findMany({ select: { queueId: true } })
      const { target, pick } = pickAudits({
        autoPublished: published.map((p) => p.id),
        alreadySelected: new Set(existing.map((e) => e.queueId)),
      })
      const postOf = new Map(published.map((p) => [p.id, p.createdPostId!]))
      for (const q of pick) {
        await tx.autoReadyAudit.create({
          data: { queueId: q, postId: postOf.get(q)!, selectedAtN: published.length, selectedTarget: target },
        })
      }
      return { kind: 'ok' as const, n: published.length, target, picked: pick }
    }, SERIALIZABLE)
  } catch (e) {
    if (isConflict(e)) return { kind: 'race', reason: '다른 선정이 먼저 돌았다 — 다음 회차가 모자란 만큼 고른다' }
    throw e
  }
}

export type RecordOutcome = 'recorded' | 'stickyYes' | 'notSelected' | 'rejectedAuditor'

/**
 * 🔴 **감사 결과 기록 — 끈적하다.** `yes` 는 `no` 로 덮이지 않는다.
 *    조건부 쓰기로 지킨다: `no` 는 판정 전이거나 이미 `no` 인 행에만 쓴다.
 */
export async function recordAuditResult(prisma: PrismaClient, i: {
  queueId: string; defect: DefectMark; auditor: string; note?: string; now: Date
}): Promise<RecordOutcome> {
  const auditor = i.auditor.trim()
  // 🔴 감사자는 비어 있을 수 없고 founder 일 수 없다 — 기계가 사람 이름을 쓰지 않는다
  if (auditor === '' || auditor === HUMAN_DECIDER) return 'rejectedAuditor'
  const data = { defect: i.defect, judgedAt: i.now, auditor, note: i.note ?? null }
  const where = i.defect === 'yes'
    ? { queueId: i.queueId }
    : { queueId: i.queueId, OR: [{ defect: null }, { defect: 'no' }] }
  const r = await prisma.autoReadyAudit.updateMany({ where, data })
  if (r.count === 1) return 'recorded'
  const exists = await prisma.autoReadyAudit.findUnique({ where: { queueId: i.queueId }, select: { defect: true } })
  if (exists === null) return 'notSelected'
  return exists.defect === 'yes' ? 'stickyYes' : 'notSelected'
}
