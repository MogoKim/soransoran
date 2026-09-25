/**
 * 🔴 **자동 READY v2 — 저장 경로** (2026-09-25 · feat/auto-ready-v2)
 *
 *   candidate → row eligibility → **auto-ready:v1 도장** → selector 수용
 *   → publish transaction 내부 재검증(+ 자동 행 배정) → Post
 *   → **감사 선정(hash 묶음) → 감사 판정(지금은 규칙 무결성·안전) → 저장 경계의 도장 정합성 대조 → 결과 저장** → 결함 시 다음 회차 자동 중지
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
 * 🔴 **글이 사라진 자동 발행 행 수** — 하나라도 있으면 자동 회차가 닫힌다 (2026-09-25 마스터 지적).
 *    `createdPostId` 는 FK(Restrict)라 정상 경로로는 생기지 않는다. 그래도 생겼다면
 *    감사 선정 여부와 상관없이 시스템 결함이다 — `selectAudits.missingPost` 를 로그로만
 *    흘려보내지 않고, 열림 판정이 이 값을 **매번 DB 에서** 다시 센다.
 */
export async function missingAutoPostCount(db: Db): Promise<number> {
  /**
   * 🔴 관계 필터(`createdPost: { is: null }`)를 쓰지 않는다 — Prisma 는 FK 가 이쪽에 있는
   *    to-one 관계의 null 검사를 `createdPostId IS NULL` 로 바꿔 버려, `createdPostId` 가 있는
   *    유실 행을 **영원히 0 으로 센다**(격리 DB 실측). id 목록과 실제 Post 수를 직접 대조한다.
   */
  const rows = await db.originalPostApprovalQueue.findMany({
    where: { decidedBy: AUTO_DECIDER, createdPostId: { not: null } }, select: { createdPostId: true },
  })
  if (rows.length === 0) return 0
  const found = await db.post.count({ where: { id: { in: rows.map((r) => r.createdPostId!) } } })
  return rows.length - found
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
      // 🔴 사람 기록 v2 의 결속을 지금 행과 견준다 — 최종 문안·상태가 필요하다
      status: true, editedTitle: true, editedBody: true,
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
 * 🔴 **권위 있는 열림 판정** — 스위치 · DB 증거 · 확정 결함 · 글 유실을 **넘겨받은 db 에서** 직접 읽는다.
 *    도장·발행 트랜잭션은 자기 `tx` 를 넘겨 같은 스냅샷에서 판정한다.
 *    스위치가 꺼져 있으면 DB 를 읽지 않고 닫힘이다.
 */
export async function authoritativeGate(db: Db, env: Env): Promise<OpenState> {
  const enabled = autoReadyEnabled(env)
  if (!enabled) {
    return judgeOpen({ enabled: false, evidence: { meetsContract: false, reasons: [] }, confirmedDefects: 0, missingAutoPosts: 0 })
  }
  const evidence = await evidenceFromDb(db)
  const confirmedDefects = await confirmedDefectCount(db)
  const missingAutoPosts = await missingAutoPostCount(db)
  return judgeOpen({ enabled, evidence, confirmedDefects, missingAutoPosts })
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
      return stampRowInTx(tx, i.queueId, i.now)
    }, SERIALIZABLE)
  } catch (e) {
    if (isConflict(e)) return { kind: 'race', reason: '직렬화 충돌 — 다른 회차가 먼저 썼다' }
    throw e
  }
}

/**
 * 🔴 **한 행 도장 — 열림 판정은 부르는 쪽이 같은 트랜잭션에서 이미 했다.**
 *    행별 적격 판정(지금 내보낼 제목·본문)과 CAS(읽은 `decidedBy`·`updatedAt`)는 행마다 한다.
 */
async function stampRowInTx(tx: Tx, queueId: string, now: Date): Promise<StampOutcome> {
  const row = await tx.originalPostApprovalQueue.findUnique({
    where: { id: queueId },
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
      decidedAt: now,
      editDiff: { ...rec(row.editDiff), [AUTO_READY_RECORD_KEY]: makeStamp(title, body, now) } as Prisma.InputJsonValue,
    },
  })
  if (updated.count !== 1) return { kind: 'race', reason: '읽은 뒤 행이 바뀌었다 — 이 회차는 진다' }
  return { kind: 'stamped' }
}

/**
 * 🔴 **도장 회차 묶음 크기.** 한 Serializable 트랜잭션이 다루는 행 수의 상한이다 —
 *    회차가 처리하는 **총량의 상한이 아니다**(행은 전부 본다). 너무 크면 트랜잭션이 길어져
 *    발행 트랜잭션과 직렬화 충돌이 잦아지고 timeout(20초)에 닿는다.
 */
export const STAMP_BATCH_SIZE = 20

/**
 * 🔴 **도장 회차 — bounded Serializable batch** (2026-09-25 마스터 권고).
 *
 *    앞판은 행마다 트랜잭션을 열고 그 안에서 `authoritativeGate` 를 불렀다 — founder 증거
 *    전부를 행마다 다시 읽었다(격리 DB 실측: 행당 쿼리 9개 고정, 증거 E 에 비례 —
 *    E30·K100 191ms · E300·K100 597ms · E1000·K100 1.72s).
 *    이제 **묶음마다 한 번** 열림을 판정하고, 같은 트랜잭션 안에서 묶음의 행을 한 행씩 본다.
 *    · 행별 적격 판정과 CAS 는 그대로다 — 한 행이 지면 그 행만 `race` 다
 *    · 열림 판정과 도장 쓰기가 **같은 스냅샷**이다 — 그 사이 증거·결함이 바뀌면 직렬화 충돌로
 *      묶음 전체가 롤백되고 `race` 로 센다(다음 회차가 다시 본다)
 *    · 발행 트랜잭션의 재검증은 그대로 둔다(행당 한 번뿐이다)
 *    🔴 "증거 지문" 으로 판정을 재사용하는 설계는 쓰지 않는다 — 큐 `updatedAt` 은
 *       rawContent 변경을 잡지 못한다(마스터 지적).
 */
export async function stampRound(
  prisma: PrismaClient, i: { env: Env; now: Date },
): Promise<Map<StampOutcome['kind'], number>> {
  const tally = new Map<StampOutcome['kind'], number>()
  if (!autoReadyEnabled(i.env)) return tally
  const rows = await prisma.originalPostApprovalQueue.findMany({
    where: { status: 'APPROVED', createdPostId: null, decidedBy: { startsWith: 'machine:' } },
    select: { id: true }, orderBy: { createdAt: 'asc' },
  })
  const bump = (k: StampOutcome['kind'], n = 1): void => { tally.set(k, (tally.get(k) ?? 0) + n) }
  for (let at = 0; at < rows.length; at += STAMP_BATCH_SIZE) {
    const batch = rows.slice(at, at + STAMP_BATCH_SIZE)
    try {
      const outs = await prisma.$transaction(async (tx): Promise<StampOutcome['kind'][]> => {
        const gate = await authoritativeGate(tx, i.env)
        if (!gate.open) return batch.map(() => 'closed' as const)
        const got: StampOutcome['kind'][] = []
        for (const r of batch) got.push((await stampRowInTx(tx, r.id, i.now)).kind)
        return got
      }, SERIALIZABLE)
      for (const k of outs) bump(k)
    } catch (e) {
      if (!isConflict(e)) throw e
      // 🔴 묶음 전체가 롤백됐다 — 쓴 것이 없다. 조용히 잃지 않고 race 로 센다
      bump('race', batch.length)
    }
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
  { kind: 'ok'; n: number; target: number; picked: string[]; missingPost: string[] } | { kind: 'race'; reason: string }
> {
  try {
    return await prisma.$transaction(async (tx) => {
      const published = await tx.originalPostApprovalQueue.findMany({
        where: { decidedBy: AUTO_DECIDER, createdPostId: { not: null } },
        select: { id: true, createdPostId: true, editDiff: true },
      })
      /**
       * 🔴 **Post 가 사라진 자동 발행 행은 고르지 않고 값으로 알린다** (2026-09-25).
       *    앞판은 `findUniqueOrThrow` 라 그런 행이 하나만 있어도 **선정 전체가 예외로 멈췄다.**
       *    감사 행은 Post FK 가 있어 만들 수 없으므로, 이 행들은 `missingPost` 로 돌려준다.
       *    🔴 돌려주기만 하지 않는다 — 열림 판정(`missingAutoPostCount`)이 같은 상태를 세서
       *    다음 도장·발행을 닫고, 러너는 이 값이 있으면 회차를 실패로 끝낸다.
       */
      const posts = await tx.post.findMany({
        where: { id: { in: published.map((p) => p.createdPostId!) } }, select: { id: true, title: true, content: true },
      })
      const postOf = new Map(posts.map((p) => [p.id, p]))
      const missingPost = published.filter((p) => !postOf.has(p.createdPostId!)).map((p) => p.id)
      const existing = await tx.autoReadyAudit.findMany({ select: { queueId: true } })
      const { target, pick } = pickAudits({
        autoPublished: published.filter((p) => postOf.has(p.createdPostId!)).map((p) => p.id),
        alreadySelected: new Set(existing.map((e) => e.queueId)),
      })
      const byId = new Map(published.map((p) => [p.id, p]))
      for (const q of pick) {
        const row = byId.get(q)!
        const post = postOf.get(row.createdPostId!)!
        await tx.autoReadyAudit.create({
          data: {
            queueId: q, postId: row.createdPostId!, selectedAtN: published.length, selectedTarget: target,
            publishedTitleHash: digestOf(post.title), publishedBodyHash: digestOf(post.content),
            stampContractDigest: readStamp(row.editDiff)?.contractDigest ?? 'missing-stamp',
          },
        })
      }
      return { kind: 'ok' as const, n: published.length, target, picked: pick, missingPost }
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
  /** 🔴 다른 감사 기록과 동시에 부딪혔다 — 조용히 잃지 않고 값으로 알린다(다음 회차가 다시 본다) */
  | 'race'
  /**
   * 🔴 **시스템 무결성 결함** — 판정자가 무엇을 말했든, 감사 대상의 도장·글·행이 선정 때
   *    묶음과 어긋나거나 사라졌다. 스스로 `yes` 를 기록하고 다음 자동 회차를 닫는다.
   *    🔴 앞판의 `postChanged`·`hashMismatch` 는 여기로 합쳤다 (2026-09-25 마스터 지적) —
   *    그 둘은 감사를 판정 전 대기로 **영원히** 남겼고 아무것도 닫지 않았다.
   */
  | 'integrityDefect'

/**
 * 🔴 **시스템 무결성 결함 기록** (2026-09-25 마스터 지적).
 *    판정자 구현을 믿지 않는다 — 도장 변경·글 유실·행 유실은 **이 저장 경계가 직접** 잡아
 *    `yes` 로 남긴다. `yes` 는 끈적하므로 어떤 판정도 이것을 덮지 못한다.
 *    감사 출처 칸에는 시스템 값을 적는다(DB CHECK 가 출처 누락을 막는다).
 */
export const INTEGRITY_AUDITOR = 'system:integrity'
export const INTEGRITY_MODEL = 'system:integrity-check'
export const INTEGRITY_PROMPT_VERSION = 'integrity-v1'
async function markIntegrityDefect(db: Db, queueId: string, reason: string, now: Date): Promise<void> {
  await db.autoReadyAudit.updateMany({
    where: { queueId },
    data: {
      defect: 'yes', judgedAt: now, auditor: INTEGRITY_AUDITOR, note: `🔴 무결성 — ${reason}`.slice(0, 2000),
      auditContractVersion: AUDIT_CONTRACT_VERSION, auditModel: INTEGRITY_MODEL,
      auditPromptVersion: INTEGRITY_PROMPT_VERSION,
    },
  })
}

/**
 * 🔴 **감사 결과 기록 — 묶음을 대조하고, 끈적하다.**
 *    · 감사 계약 판이 지금 판이어야 한다 · 모델·프롬프트 판이 있어야 한다
 *    · 지금 큐 도장 · 지금 Post · 판정한 글의 hash 가 고를 때 묶은 값과 같아야 한다 —
 *      🔴 하나라도 어긋나면 판정자 값 대신 **무결성 yes** 를 남긴다(대기로 두지 않는다)
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
    /**
     * 🔴 **도장 정합성은 저장 경계가 직접 본다** — 판정자가 `no` 라고 해도 통과시키지 않는다.
     *    선정 때 묶은 도장 계약 판 · 발행 글 hash 와, **지금 큐에 남은 도장**이 같아야 한다.
     *    다르면 누군가 발행 뒤 도장을 바꿨거나 다른 글에 붙었다 — 시스템 결함이다.
     */
    const queue = await tx.originalPostApprovalQueue.findUnique({ where: { id: i.queueId }, select: { editDiff: true } })
    const cur = queue === null ? null : readStamp(queue.editDiff)
    /**
     * 🔴 **지금 Post 도 저장 경계가 직접 본다** (2026-09-25 마스터 지적). 선정 뒤 글이 사라졌거나
     *    제목·본문이 바뀌었으면, 판정자가 무엇을 봤든 **그 판정보다 먼저** 무결성 yes 다.
     *    판정자가 발행 글이 아닌 다른 글을 판정했다고 말해도(hash 불일치) 같다 — 판정자 결함이다.
     */
    const post = await tx.post.findUnique({ where: { id: row.postId }, select: { title: true, content: true } })
    const broken = queue === null ? '감사 대상 큐 행이 없다'
      : cur === null ? '큐의 도장 기록이 없거나 깨졌다'
        : cur.contractDigest !== row.stampContractDigest ? '도장 계약 판이 선정 때와 다르다'
          : cur.titleHash !== row.publishedTitleHash || cur.bodyHash !== row.publishedBodyHash
            ? '도장의 제목·본문 hash 가 발행 글과 다르다'
            : post === null ? '감사 대상 Post 가 없다'
              : digestOf(post.title) !== row.publishedTitleHash || digestOf(post.content) !== row.publishedBodyHash
                ? '선정 뒤 발행 글의 제목·본문이 바뀌었다'
                : i.verdict.judgedTitleHash !== row.publishedTitleHash || i.verdict.judgedBodyHash !== row.publishedBodyHash
                  ? '판정자가 발행 글이 아닌 글을 판정했다' : null
    if (broken !== null) {
      await markIntegrityDefect(tx, i.queueId, broken, i.now)
      return 'integrityDefect'
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
  | { kind: 'ok'; pending: number; tally: Map<RecordOutcome, number> }

/**
 * 🔴 **감사 회차** — 판정 전(`defect IS NULL`) 감사를 **전부** 읽고, 발행된 글을
 *    감사자에게 보이고, 결과를 기록한다.
 *    🔴 개수 제한을 두지 않는다. 사람의 매 회차 허가를 요구하지 않는다.
 *    🔴 감사자는 주입받는다 — 이 파일은 모델을 부르지 않는다(유료 호출 0).
 */
export async function runAuditRound(prisma: PrismaClient, i: {
  env: Env; judge: AuditJudge; auditor: string; now: Date
}): Promise<AuditRoundResult> {
  if (!autoReadyEnabled(i.env)) return { kind: 'off' }
  const pending = await prisma.autoReadyAudit.findMany({ where: { defect: null }, orderBy: { selectedAt: 'asc' } })
  const tally = new Map<RecordOutcome, number>()
  const bump = (k: RecordOutcome): void => { tally.set(k, (tally.get(k) ?? 0) + 1) }
  for (const a of pending) {
    const post = await prisma.post.findUnique({ where: { id: a.postId }, select: { title: true, content: true } })
    const queue = await prisma.originalPostApprovalQueue.findUnique({ where: { id: a.queueId }, select: { editDiff: true } })
    /**
     * 🔴 **감사 대상이 사라졌으면 대기로 남기지 않는다** (2026-09-25 마스터 지적).
     *    앞판은 `noPost` 로 세고 넘어갔다 — 그 감사는 영원히 판정 전으로 남고 아무것도 닫지 않았다.
     *    FK(RESTRICT)가 삭제를 막지만, 그래도 사라졌다면 시스템 결함이다. 스스로 `yes` 를 기록한다.
     */
    if (post === null || queue === null) {
      await markIntegrityDefect(prisma, a.queueId, post === null ? '감사 대상 Post 가 없다' : '감사 대상 큐 행이 없다', i.now)
      bump('integrityDefect'); continue
    }
    const verdict = await i.judge({
      queueId: a.queueId, postId: a.postId, title: post.title, body: post.content,
      stamp: readStamp(queue.editDiff),
    })
    bump(await recordAuditResult(prisma, { queueId: a.queueId, verdict, auditor: i.auditor, now: i.now }))
  }
  return { kind: 'ok', pending: pending.length, tally }
}
