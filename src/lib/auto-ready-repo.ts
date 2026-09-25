/**
 * 🔴 **자동 READY v2 — 저장 경로** (2026-09-25 · feat/auto-ready-v2)
 *
 *   candidate → row eligibility → **auto-ready:v1 도장** → selector 수용
 *   → publish transaction 내부 재검증(+ 자동 행 배정) → Post
 *   → **감사 선정(hash 묶음) → 독립 감사 판정 → 결과 저장** → 결함 시 다음 회차 자동 중지
 *
 * 🔴 **스위치 기본 OFF** (`SORAN_AUTO_READY_ENABLED`). 꺼져 있으면 이 파일의 쓰기 경로는
 *    돌지 않고, 감사 표(`AutoReadyAudit`)도 읽지 않는다 — 표가 운영에 없어도 깨지지 않는다.
 * 🔴 **열림은 호출자가 정하지 않는다** (2026-09-25 마스터 지적). 앞판은 `open: OpenState` 를
 *    받아 `{ open: true }` 만 넘기면 증거 0/30 이어도 도장이 찍혔다. 이제 도장·발행 쓰기 경계가
 *    **트랜잭션 안에서** 스위치 · DB 증거(30/90%/결함 0) · 확정 결함을 직접 판정한다.
 * 🔴 **founder 를 쓰지 않는다.** 도장은 `auto-ready:v1` 뿐이고, 감사자도 `founder` 일 수 없다.
 * 🔴 **경쟁 조건** — 모든 쓰기는 Serializable 트랜잭션 안의 조건부 쓰기다.
 * 🔴 새 대기 기간·pending 상수·개수 제한·승인 규율을 만들지 않는다.
 */
import { Prisma, type PrismaClient } from '@prisma/client'

import {
  AUTO_DECIDER, HUMAN_DECIDER, AUTO_READY_RECORD_KEY, AUDIT_CONTRACT_VERSION,
  autoReadyEnabled, eligibilityOf, makeStamp, readStamp, stampValidFor, pickAudits, judgeOpen,
  digestOf, verdictShapeOk,
  type OpenState, type AuditJudge, type AuditVerdict,
} from './auto-ready-v2'
import { cohortSampleOf } from './auto-ready-evidence'
import { profileOf } from './original-post-auto-publish'

type Tx = Prisma.TransactionClient
type Db = PrismaClient | Tx
type Env = Readonly<Record<string, string | undefined>>
const SERIALIZABLE = { isolationLevel: 'Serializable' as const, maxWait: 5_000, timeout: 20_000 }

const rec = (v: unknown): Record<string, unknown> =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})

const isConflict = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2034' || e.code === 'P2002')

/** 🔴 확정 결함(yes) 수 — 하나라도 있으면 자동 회차가 닫힌다 */
export async function confirmedDefectCount(db: Db): Promise<number> {
  return db.autoReadyAudit.count({ where: { defect: 'yes' } })
}

/**
 * 🔴 **런타임 증거** — DB 에 **저장된** 근거만으로 잰다(fail-closed).
 *    로컬 artifact 로 복원한 근거는 GitHub Actions 러너가 읽을 수 없다. 그것을 여기서
 *    쓰려면 복원 결과를 durable 하게 저장해야 하는데, 그 쓰기는 아직 승인되지 않았다.
 *    표본 계산은 정본 `cohortSampleOf` 하나다 — 여기서 다시 세지 않는다.
 */
export async function evidenceFromDb(db: Db): Promise<ReturnType<typeof cohortSampleOf>> {
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

/**
 * 🔴 **권위 있는 열림 판정** — 스위치 · DB 증거 · 확정 결함을 **넘겨받은 db 에서** 직접 읽는다.
 *    도장·발행 트랜잭션은 자기 `tx` 를 넘겨 같은 스냅샷에서 판정한다.
 *    스위치가 꺼져 있으면 DB 를 읽지 않고 닫힘이다.
 */
export async function authoritativeGate(db: Db, env: Env): Promise<OpenState> {
  const enabled = autoReadyEnabled(env)
  if (!enabled) return judgeOpen({ enabled: false, evidence: { meetsContract: false, reasons: [] }, confirmedDefects: 0 })
  const evidence = await evidenceFromDb(db)
  const confirmedDefects = await confirmedDefectCount(db)
  return judgeOpen({ enabled, evidence, confirmedDefects })
}

export type StampOutcome =
  | { kind: 'stamped' }
  | { kind: 'closed'; reason: string }
  | { kind: 'exception'; reasons: string[] }
  | { kind: 'skip'; reason: string }
  | { kind: 'race'; reason: string }

/**
 * 🔴 **도장 — 한 행씩, 조건부로.** 열림은 **트랜잭션 안에서** 다시 판정한다.
 *    · 기계 도장(`machine:*`)이 찍힌 미발행 APPROVED 행만 다룬다
 *    · **지금 내보낼 제목·본문**으로 다시 판정한다
 *    · 읽은 `decidedBy`·`updatedAt` 이 그대로일 때만 쓴다(CAS)
 */
export async function stampAutoReady(
  prisma: PrismaClient, i: { queueId: string; env: Env; now: Date },
): Promise<StampOutcome> {
  if (!autoReadyEnabled(i.env)) return { kind: 'closed', reason: '자동 READY 스위치가 꺼져 있다' }
  try {
    return await prisma.$transaction(async (tx): Promise<StampOutcome> => {
      const gate = await authoritativeGate(tx, i.env)
      if (!gate.open) return { kind: 'closed', reason: gate.reasons.join(' · ') }
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

/** 🔴 도장 회차 — 기계 도장 행 전부를 한 행씩. 러너는 이 함수 하나만 부른다 */
export async function stampRound(
  prisma: PrismaClient, i: { env: Env; now: Date },
): Promise<Map<StampOutcome['kind'], number>> {
  const tally = new Map<StampOutcome['kind'], number>()
  if (!autoReadyEnabled(i.env)) return tally
  const rows = await prisma.originalPostApprovalQueue.findMany({
    where: { status: 'APPROVED', createdPostId: null, decidedBy: { startsWith: 'machine:' } },
    select: { id: true }, orderBy: { createdAt: 'asc' },
  })
  for (const r of rows) {
    const o = await stampAutoReady(prisma, { queueId: r.id, env: i.env, now: i.now })
    tally.set(o.kind, (tally.get(o.kind) ?? 0) + 1)
  }
  return tally
}

/**
 * 🔴 **발행 트랜잭션 안의 재검증.** 발행 트랜잭션이 **실제로 발행할** 제목·본문으로 보고,
 *    증거·결함 게이트도 **같은 트랜잭션에서** 다시 판정한다. 호출자가 준 열림을 믿지 않는다.
 */
export async function recheckAutoReadyInTx(tx: Tx, i: {
  env: Env
  title: string
  body: string
  editDiff: unknown
  gateVerdict: string
  gateResults: unknown
  sourceCapturedAt: Date | null
}): Promise<{ ok: boolean; reason: string }> {
  if (!autoReadyEnabled(i.env)) return { ok: false, reason: '자동 READY 스위치가 꺼져 있다' }
  const sv = stampValidFor(readStamp(i.editDiff), i.title, i.body)
  if (!sv.ok) return { ok: false, reason: sv.reason }
  const v = eligibilityOf({
    gateVerdict: i.gateVerdict, gateResults: i.gateResults,
    title: i.title, body: i.body, sourceCapturedAt: i.sourceCapturedAt,
  })
  if (!v.auto) return { ok: false, reason: `다시 판정하니 예외다 — ${v.reasons.join(' · ')}` }
  const gate = await authoritativeGate(tx, i.env)
  if (!gate.open) return { ok: false, reason: `열림 게이트 — ${gate.reasons.join(' · ')}` }
  return { ok: true, reason: '' }
}

/**
 * 🔴 **감사 선정 — 정확히 ceil(N×0.2), 중복 없이, 무엇을 감사하는지 묶어서.**
 *    고를 때 **발행된 Post 의 제목·본문 hash** 와 그 행의 **도장 계약 판**을 저장한다.
 *    결과는 이 묶음과 같은 글에만 붙는다.
 */
export async function selectAudits(prisma: PrismaClient): Promise<
  { kind: 'ok'; n: number; target: number; picked: string[] } | { kind: 'race'; reason: string }
> {
  try {
    return await prisma.$transaction(async (tx) => {
      const published = await tx.originalPostApprovalQueue.findMany({
        where: { decidedBy: AUTO_DECIDER, createdPostId: { not: null } },
        select: { id: true, createdPostId: true, editDiff: true },
      })
      const existing = await tx.autoReadyAudit.findMany({ select: { queueId: true } })
      const { target, pick } = pickAudits({
        autoPublished: published.map((p) => p.id),
        alreadySelected: new Set(existing.map((e) => e.queueId)),
      })
      const byId = new Map(published.map((p) => [p.id, p]))
      for (const q of pick) {
        const row = byId.get(q)!
        const post = await tx.post.findUniqueOrThrow({
          where: { id: row.createdPostId! }, select: { title: true, content: true },
        })
        await tx.autoReadyAudit.create({
          data: {
            queueId: q, postId: row.createdPostId!, selectedAtN: published.length, selectedTarget: target,
            publishedTitleHash: digestOf(post.title), publishedBodyHash: digestOf(post.content),
            stampContractDigest: readStamp(row.editDiff)?.contractDigest ?? 'missing-stamp',
          },
        })
      }
      return { kind: 'ok' as const, n: published.length, target, picked: pick }
    }, SERIALIZABLE)
  } catch (e) {
    if (isConflict(e)) return { kind: 'race', reason: '다른 선정이 먼저 돌았다 — 다음 회차가 모자란 만큼 고른다' }
    throw e
  }
}

export type RecordOutcome =
  | 'recorded' | 'stickyYes' | 'notSelected' | 'rejectedAuditor'
  /** 🔴 다른 감사 계약 판으로 낸 결과다 — 옛 판정이 붙지 않게 한다 */
  | 'staleContract'
  /** 🔴 결과 모양이 깨졌다(모델·프롬프트 없음 · hash 아님) */
  | 'badVerdict'
  /** 🔴 판정한 글이 고를 때 묶은 글과 다르다 */
  | 'hashMismatch'
  /** 🔴 고른 뒤 발행된 글이 바뀌었다 — 지금 글에 옛 판정을 붙이지 않는다 */
  | 'postChanged'
  /** 🔴 다른 감사 기록과 동시에 부딪혔다 — 조용히 잃지 않고 값으로 알린다(다음 회차가 다시 본다) */
  | 'race'

/**
 * 🔴 **감사 결과 기록 — 묶음을 대조하고, 끈적하다.**
 *    · 감사 계약 판이 지금 판이어야 한다 · 모델·프롬프트 판이 있어야 한다
 *    · 판정한 글의 hash 가 고를 때 묶은 hash 와 같아야 한다
 *    · 지금 Post 의 hash 도 그대로여야 한다(그 사이 글이 바뀌었으면 받지 않는다)
 *    · `yes` 는 `no` 로 덮이지 않는다
 */
export async function recordAuditResult(prisma: PrismaClient, i: {
  queueId: string; verdict: AuditVerdict; auditor: string; now: Date
}): Promise<RecordOutcome> {
  const auditor = i.auditor.trim()
  // 🔴 감사자는 비어 있을 수 없고 founder 일 수 없다 — 기계가 사람 이름을 쓰지 않는다
  if (auditor === '' || auditor === HUMAN_DECIDER) return 'rejectedAuditor'
  if (!verdictShapeOk(i.verdict).ok) return 'badVerdict'
  if (i.verdict.contractVersion !== AUDIT_CONTRACT_VERSION) return 'staleContract'
  try {
  return await prisma.$transaction(async (tx): Promise<RecordOutcome> => {
    const row = await tx.autoReadyAudit.findUnique({ where: { queueId: i.queueId } })
    if (row === null) return 'notSelected'
    if (row.defect === 'yes' && i.verdict.defect === 'no') return 'stickyYes'
    if (i.verdict.judgedTitleHash !== row.publishedTitleHash || i.verdict.judgedBodyHash !== row.publishedBodyHash) {
      return 'hashMismatch'
    }
    const post = await tx.post.findUnique({ where: { id: row.postId }, select: { title: true, content: true } })
    if (post === null || digestOf(post.title) !== row.publishedTitleHash || digestOf(post.content) !== row.publishedBodyHash) {
      return 'postChanged'
    }
    const data = {
      defect: i.verdict.defect, judgedAt: i.now, auditor,
      note: i.verdict.reasons.join(' · ').slice(0, 2000) || null,
      auditContractVersion: i.verdict.contractVersion,
      auditModel: i.verdict.model, auditPromptVersion: i.verdict.promptVersion,
    }
    // 🔴 조건부 — yes 는 no 로 덮이지 않는다(그 사이 다른 감사가 yes 를 썼어도)
    const where = i.verdict.defect === 'yes'
      ? { queueId: i.queueId }
      : { queueId: i.queueId, OR: [{ defect: null }, { defect: 'no' }] }
    const r = await tx.autoReadyAudit.updateMany({ where, data })
    return r.count === 1 ? 'recorded' : 'stickyYes'
  }, SERIALIZABLE)
  } catch (e) {
    if (isConflict(e)) return 'race'
    throw e
  }
}

export type AuditRoundResult =
  | { kind: 'off' }
  | { kind: 'ok'; pending: number; tally: Map<RecordOutcome | 'noPost', number> }

/**
 * 🔴 **독립 감사 회차** — 판정 전(`defect IS NULL`) 감사를 **전부** 읽고, 발행된 글을
 *    감사자에게 보이고, 결과를 기록한다.
 *    🔴 개수 제한을 두지 않는다. 사람의 매 회차 허가를 요구하지 않는다.
 *    🔴 감사자는 주입받는다 — 이 파일은 모델을 부르지 않는다(유료 호출 0).
 */
export async function runAuditRound(prisma: PrismaClient, i: {
  env: Env; judge: AuditJudge; auditor: string; now: Date
}): Promise<AuditRoundResult> {
  if (!autoReadyEnabled(i.env)) return { kind: 'off' }
  const pending = await prisma.autoReadyAudit.findMany({ where: { defect: null }, orderBy: { selectedAt: 'asc' } })
  const tally = new Map<RecordOutcome | 'noPost', number>()
  const bump = (k: RecordOutcome | 'noPost'): void => { tally.set(k, (tally.get(k) ?? 0) + 1) }
  for (const a of pending) {
    const post = await prisma.post.findUnique({ where: { id: a.postId }, select: { title: true, content: true } })
    const queue = await prisma.originalPostApprovalQueue.findUnique({ where: { id: a.queueId }, select: { editDiff: true } })
    if (post === null || queue === null) { bump('noPost'); continue }
    const verdict = await i.judge({
      queueId: a.queueId, postId: a.postId, title: post.title, body: post.content,
      stamp: readStamp(queue.editDiff),
    })
    bump(await recordAuditResult(prisma, { queueId: a.queueId, verdict, auditor: i.auditor, now: i.now }))
  }
  return { kind: 'ok', pending: pending.length, tally }
}
