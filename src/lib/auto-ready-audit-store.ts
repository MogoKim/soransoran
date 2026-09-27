/**
 * 🔴 **자동 READY 사후 감사 — 독립 감사 러너 · 운영자 결함 신고의 저장 경로** (2026-09-27)
 *
 *   발행(auto-ready:v1) → 감사 선정(`selectAudits`) → **[여기] 규칙 + 의미 감사 → 결과 저장**
 *   → 결함 yes → `confirmedDefectCount` 가 늘고 다음 도장·발행이 각자의 트랜잭션에서 닫힌다.
 *
 * 🔴 **왜 `auto-ready-repo.ts` 를 고치지 않고 새 파일인가** — repo 는 품질 계약 지문 대상이다.
 *    거기 판정 행동을 바꾸면 "행동 불변" 이라고 적을 수 없다. 그래서 repo 의 판정(열림 · 도장 · 발행
 *    재검증 · 확정 결함 수)은 **그대로 부르고**, 이 파일은 그 앞뒤에 더하는 것만 한다.
 *    repo 의 `recordAuditResult` · `runAuditRound`(규칙 단독)는 운영 호출자가 0 이다 — `auto-ready:audit-check`
 *    가 운영 스크립트에서 그 둘을 부르는 줄이 없음을 본다.
 *
 * 🔴 **정확히 한 결과** — 자동 감사의 쓰기는 `defect IS NULL` 일 때만이다(첫 기록이 이긴다). 같은 감사를
 *    두 러너가 동시에 판정해도 한 번만 기록된다. 끈적함은 그대로다 — 어떤 no 도 yes 를 덮지 못한다.
 *    운영자 결함 신고(yes)만 no 를 yes 로 올릴 수 있다.
 *
 * 🔴 **판정 대기 시한** (2026-09-27 마스터 지적) — 판정 대기는 열림을 막지 않는다(repo 계약 그대로).
 *    다만 감사 러너가 멈추면(맥 수면 등) 발행만 계속되고 감사가 쌓인다. 그래서 **선정 뒤
 *    `AUDIT_OVERDUE_HOURS` 를 넘긴 판정 대기**가 하나라도 있으면 도장·발행을 닫는다 —
 *    발행 트랜잭션은 **자기 트랜잭션 안에서**, 도장 회차는 부르기 전에 본다. 감사가 끝나면 다시 열린다.
 *    🔴 이 판정은 품질 계약 digest(`JUDGE_CONTRACT_DIGEST`) 밖이다.
 *
 * 🔴 스위치(`SORAN_AUTO_READY_ENABLED`)가 꺼져 있으면 감사 표를 읽지 않는다 — 표가 없어도 깨지지 않는다.
 * 🔴 Raw SQL 없음 · 새 migration 없음 — 0029 표를 그대로 쓴다.
 */
import { Prisma, type PrismaClient } from '@prisma/client'

import {
  AUDIT_CONTRACT_VERSION, AUTO_DECIDER, HUMAN_DECIDER, auditTarget, autoReadyEnabled, digestOf, readStamp,
  verdictShapeOk, type AuditJudge, type OpenState,
} from './auto-ready-v2'
import {
  INTEGRITY_AUDITOR, INTEGRITY_MODEL, INTEGRITY_PROMPT_VERSION, authoritativeGate, stampRound, type StampOutcome,
} from './auto-ready-repo'
import {
  SEMANTIC_AUDIT_CONTRACT_VERSION, SEMANTIC_AUDIT_MODEL, SEMANTIC_AUDIT_PROMPT_VERSION,
  bindingDigestOf, combineAuditVerdicts, judgeSemantic, semanticNoteHead, stampDigestOf,
  type CombinedAudit, type SemanticAuditProvider, type SemanticContextResult,
} from './auto-ready-semantic-audit'

type Tx = Prisma.TransactionClient
type Db = PrismaClient | Tx
type Env = Readonly<Record<string, string | undefined>>
const SERIALIZABLE = { isolationLevel: 'Serializable' as const, maxWait: 5_000, timeout: 20_000 }
const isConflict = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2034' || e.code === 'P2002')

// ─────────────────────────────────────────────────────────
// 🔴 판정 대기 시한 — 감사가 멈추면 발행도 멈춘다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **선정 뒤 이 시간 안에 판정되지 않은 감사가 있으면 도장·발행을 닫는다.**
 *
 *    근거 — 감사 러너 템플릿은 08:10~23:40 KST 에 30분마다 깬다(`AUDIT_RUNNER_SLOTS`). 발행 창은
 *    08:00~22:00 이라, 러너가 살아 있으면 판정 대기의 나이는 **한 간격(30분) + 회차 시간** 을 넘지 않는다.
 *    6시간 = 연속 12번 깨지 못한 상태다 — 한두 번의 절전·일시 장애로는 닫지 않고(fail-closed 는 공짜가
 *    아니다), 러너가 죽었으면 **같은 날 안에** 닫는다. 밤사이 맥이 자면 22시 무렵 글의 감사가 새벽에
 *    시한을 넘기고, 아침 첫 감사 회차가 판정할 때까지 자동 도장·발행이 멈춘다 — 의도한 동작이다.
 *    🔴 숫자를 바꾸면 이 근거부터 다시 쓴다.
 */
export const AUDIT_OVERDUE_HOURS = 6
export const AUDIT_OVERDUE_MS = AUDIT_OVERDUE_HOURS * 3600_000

/** 🔴 시한을 넘긴 판정 대기 수 — 스위치가 켜진 쪽만 부른다(표를 읽는다) */
export async function overdueAuditCount(db: Db, now: Date): Promise<number> {
  return db.autoReadyAudit.count({ where: { defect: null, selectedAt: { lt: new Date(now.getTime() - AUDIT_OVERDUE_MS) } } })
}

const overdueReason = (n: number): string =>
  `🔴 판정 없이 ${AUDIT_OVERDUE_HOURS}시간을 넘긴 감사 ${n}건 — 감사 러너가 따라잡을 때까지 자동 회차를 멈춘다`

/**
 * 🔴 **발행 트랜잭션 안에서 부른다** — 같은 스냅샷에서 시한 초과를 센다.
 *    `null` 이면 통과, 문자열이면 막는 이유다. 스위치가 꺼져 있으면 표를 읽지 않는다.
 */
export async function overdueBlockInTx(tx: Tx, env: Env, now: Date): Promise<string | null> {
  if (!autoReadyEnabled(env)) return null
  const n = await overdueAuditCount(tx, now)
  return n > 0 ? overdueReason(n) : null
}

/**
 * 🔴 **열림 판정 + 판정 대기 시한.** 러너의 화면·selector 값이다(쓰기의 근거가 아니다 —
 *    도장·발행은 각자 다시 본다). 정본 `authoritativeGate` 를 먼저 부르고, 켜져 있을 때만 시한을 본다.
 */
export async function auditAwareGate(db: Db, env: Env, now: Date): Promise<OpenState> {
  const g = await authoritativeGate(db, env)
  if (!autoReadyEnabled(env)) return g
  const n = await overdueAuditCount(db, now)
  return n > 0 ? { open: false, reasons: [...g.reasons, overdueReason(n)] } : g
}

/**
 * 🔴 **도장 회차 — 시한 초과면 부르지 않는다.** 정본 `stampRound` 는 그대로 부른다.
 *    시한을 읽는 순간과 도장 트랜잭션 사이에 감사가 시한을 넘길 수 있다 — 그 행은 **발행 트랜잭션이**
 *    같은 트랜잭션 안에서 다시 막는다(도장은 발행 권한이 아니다).
 */
export async function stampRoundAuditAware(
  prisma: PrismaClient, i: { env: Env; now: Date },
): Promise<Map<StampOutcome['kind'], number>> {
  if (autoReadyEnabled(i.env)) {
    const n = await overdueAuditCount(prisma, i.now)
    if (n > 0) {
      const waiting = await prisma.originalPostApprovalQueue.count({
        where: { status: 'APPROVED', createdPostId: null, decidedBy: { startsWith: 'machine:' } },
      })
      return new Map([['closed', waiting]])
    }
  }
  return stampRound(prisma, i)
}

// ─────────────────────────────────────────────────────────
// 🔴 자동 감사 결과 저장 — 규칙 + 의미 · 묶음 대조 · 첫 기록만
// ─────────────────────────────────────────────────────────

export type CombinedRecordOutcome =
  | 'recorded' | 'alreadyJudged' | 'notSelected' | 'rejectedAuditor' | 'staleContract' | 'badVerdict' | 'race'
  /** 🔴 묶음(도장·글·의미 감사의 결속)이 어긋났다 — 판정자 값 대신 무결성 yes 를 남겼다 */
  | 'integrityDefect'

/** 🔴 무결성 yes — 판정 전일 때만 쓴다(첫 기록이 이긴다 · 이미 yes 면 그대로) */
async function markIntegrityOnce(db: Db, queueId: string, reason: string, now: Date): Promise<boolean> {
  const r = await db.autoReadyAudit.updateMany({
    where: { queueId, defect: null },
    data: {
      defect: 'yes', judgedAt: now, auditor: INTEGRITY_AUDITOR, note: `🔴 무결성 — ${reason}`.slice(0, 2000),
      auditContractVersion: AUDIT_CONTRACT_VERSION, auditModel: INTEGRITY_MODEL, auditPromptVersion: INTEGRITY_PROMPT_VERSION,
    },
  })
  return r.count === 1
}

/** 🔴 사람 종류(`human:*`)와 founder 는 자동 감사자가 될 수 없다 — 사람 기록은 관리자 서버 경계만 쓴다 */
export function automatedAuditorOk(auditor: string): boolean {
  const a = auditor.trim()
  return a !== '' && a !== HUMAN_DECIDER && !a.startsWith('human:')
}

/**
 * 🔴 **자동 감사 결과 한 건 기록.**
 *    · 감사자 — 사람 종류·founder 거절
 *    · 모양 · 감사 계약 판 — repo 와 같은 규칙
 *    · 도장 · 글 · 판정한 글 hash — 선정 때 묶음과 대조(어긋나면 무결성 yes)
 *    · **의미 감사 결속** — 계약·모델·프롬프트 판이 지금 것이어야 하고, 묶음의 글 id·hash·도장 digest 가
 *      DB 의 지금 값과 같아야 하며, 묶음 digest 가 칸에서 다시 계산한 값과 같아야 한다(어긋나면 무결성 yes)
 *    · **no 는 측정된 의미 감사 no 가 있을 때만** — 없으면 무결성 yes
 *    · 쓰기는 `defect IS NULL` 일 때만 — 이미 판정됐으면 `alreadyJudged`(덮지 않는다)
 */
export async function recordCombinedAudit(prisma: PrismaClient, i: {
  queueId: string; combined: CombinedAudit; auditor: string; now: Date
}): Promise<CombinedRecordOutcome> {
  const { verdict, semantic } = i.combined
  if (!automatedAuditorOk(i.auditor)) return 'rejectedAuditor'
  if (!verdictShapeOk(verdict).ok) return 'badVerdict'
  if (verdict.contractVersion !== AUDIT_CONTRACT_VERSION) return 'staleContract'
  try {
    return await prisma.$transaction(async (tx): Promise<CombinedRecordOutcome> => {
      const row = await tx.autoReadyAudit.findUnique({ where: { queueId: i.queueId } })
      if (row === null) return 'notSelected'
      // 🔴 이미 판정된 감사를 여기서 미리 거르지 않는다 — 아래 두 쓰기(무결성 · 결과)가 **각자** `defect IS NULL`
      //    조건부라, 그 조건 하나가 "첫 기록만" 을 보장한다(가드가 둘이면 하나는 시험되지 않는다)
      const queue = await tx.originalPostApprovalQueue.findUnique({
        where: { id: i.queueId }, select: { editDiff: true, gateResults: true, matchedPersona: { select: { code: true } } },
      })
      const cur = queue === null ? null : readStamp(queue.editDiff)
      const post = await tx.post.findUnique({ where: { id: row.postId }, select: { title: true, content: true } })
      const b = semantic.binding
      /**
       * 🔴 **DB 로 다시 잴 수 있는 결속은 전부 여기서 잰다** — 글 id · 제목·본문 hash · 도장 digest ·
       *    큐가 가리키는 artifactId · 배정된 Persona code. 원문 근거·카드 digest 는 로컬 정본에서만 나오므로
       *    저장 경계가 다시 계산할 수 없다 — 묶음 digest 안에 들어가 note 에 남고, 나중에 정본으로 다시 잴 수 있다.
       */
      const rowArtifactId = (() => {
        const g = queue?.gateResults
        const ad = g !== null && typeof g === 'object' && !Array.isArray(g) ? (g as Record<string, unknown>).autoDraft : null
        const v = ad !== null && typeof ad === 'object' && !Array.isArray(ad) ? (ad as Record<string, unknown>).artifactId : null
        return typeof v === 'string' ? v : null
      })()
      const broken = queue === null ? '감사 대상 큐 행이 없다'
        : cur === null ? '큐의 도장 기록이 없거나 깨졌다'
          : cur.contractDigest !== row.stampContractDigest ? '도장 계약 판이 선정 때와 다르다'
            : cur.titleHash !== row.publishedTitleHash || cur.bodyHash !== row.publishedBodyHash
              ? '도장의 제목·본문 hash 가 발행 글과 다르다'
              : post === null ? '감사 대상 Post 가 없다'
                : digestOf(post.title) !== row.publishedTitleHash || digestOf(post.content) !== row.publishedBodyHash
                  ? '선정 뒤 발행 글의 제목·본문이 바뀌었다'
                  : verdict.judgedTitleHash !== row.publishedTitleHash || verdict.judgedBodyHash !== row.publishedBodyHash
                    ? '판정자가 발행 글이 아닌 글을 판정했다'
                    : semantic.contractVersion !== SEMANTIC_AUDIT_CONTRACT_VERSION || semantic.model !== SEMANTIC_AUDIT_MODEL
                      || semantic.promptVersion !== SEMANTIC_AUDIT_PROMPT_VERSION
                      ? '의미 감사의 계약·모델·프롬프트 판이 지금 것이 아니다'
                      : b !== null && (b.postId !== row.postId || b.titleHash !== row.publishedTitleHash
                        || b.bodyHash !== row.publishedBodyHash || b.stampDigest !== stampDigestOf(cur)
                        || b.artifactId !== rowArtifactId || b.personaCode !== (queue?.matchedPersona?.code ?? null)
                        || b.digest !== bindingDigestOf(b))
                        ? '의미 감사가 이 글·이 도장에 묶이지 않았다'
                        : verdict.defect === 'no' && (b === null || !semantic.measured || semantic.defect !== 'no')
                          ? '측정된 의미 감사 없이 결함 없음(no)을 기록하려 했다'
                          : semantic.defect === 'yes' && verdict.defect !== 'yes'
                            ? '의미 감사가 yes 인데 최종 판정이 no 다'
                            : null
      if (broken !== null) {
        return (await markIntegrityOnce(tx, i.queueId, broken, i.now)) ? 'integrityDefect' : 'alreadyJudged'
      }
      const note = `${semanticNoteHead(semantic)} ${verdict.reasons.join(' · ')}`.trim().slice(0, 2000)
      const r = await tx.autoReadyAudit.updateMany({
        where: { queueId: i.queueId, defect: null },
        data: {
          defect: verdict.defect, judgedAt: i.now, auditor: i.auditor.trim(), note,
          auditContractVersion: verdict.contractVersion, auditModel: verdict.model, auditPromptVersion: verdict.promptVersion,
        },
      })
      return r.count === 1 ? 'recorded' : 'alreadyJudged'
    }, SERIALIZABLE)
  } catch (e) {
    if (isConflict(e)) return 'race'
    throw e
  }
}

export type AuditContextLoader = (a: { queueId: string; postId: string }) => Promise<SemanticContextResult>

export type CombinedRoundResult =
  | { kind: 'off' }
  | { kind: 'ok'; pending: number; tally: Map<CombinedRecordOutcome, number>; semanticCalls: number }

/**
 * 🔴 **감사 회차 — 판정 전 감사를 전부 읽고, 규칙 감사와 의미 감사를 둘 다 돌려 기록한다.**
 *    · 스위치 OFF → 표를 읽지 않는다
 *    · 판정 전 0건 → **제공사를 한 번도 부르지 않는다**
 *    · 문맥 로더·제공사의 예외는 그 감사 한 건의 측정 불가(yes)다 — 회차 전체를 멈추지 않는다
 */
export async function runCombinedAuditRound(prisma: PrismaClient, i: {
  env: Env; now: Date; auditor: string
  ruleJudge: AuditJudge
  loadContext: AuditContextLoader
  provider: SemanticAuditProvider
}): Promise<CombinedRoundResult> {
  if (!autoReadyEnabled(i.env)) return { kind: 'off' }
  const pending = await prisma.autoReadyAudit.findMany({ where: { defect: null }, orderBy: { selectedAt: 'asc' } })
  const tally = new Map<CombinedRecordOutcome, number>()
  const bump = (k: CombinedRecordOutcome): void => { tally.set(k, (tally.get(k) ?? 0) + 1) }
  let semanticCalls = 0
  if (pending.length === 0) return { kind: 'ok', pending: 0, tally, semanticCalls }
  // 🔴 호출 수를 센다 — 제공사를 감싸 부른 횟수만 올린다
  const counted: SemanticAuditProvider = {
    model: i.provider.model,
    complete: async (req) => { semanticCalls += 1; return i.provider.complete(req) },
  }
  for (const a of pending) {
    const post = await prisma.post.findUnique({ where: { id: a.postId }, select: { title: true, content: true } })
    const queue = await prisma.originalPostApprovalQueue.findUnique({ where: { id: a.queueId }, select: { editDiff: true } })
    if (post === null || queue === null) {
      const wrote = await markIntegrityOnce(prisma, a.queueId, post === null ? '감사 대상 Post 가 없다' : '감사 대상 큐 행이 없다', i.now)
      bump(wrote ? 'integrityDefect' : 'alreadyJudged'); continue
    }
    const rule = await i.ruleJudge({ queueId: a.queueId, postId: a.postId, title: post.title, body: post.content, stamp: readStamp(queue.editDiff) })
    let ctx: SemanticContextResult
    try {
      ctx = await i.loadContext({ queueId: a.queueId, postId: a.postId })
    } catch (e) {
      ctx = { ok: false, code: 'CONTEXT_ERROR', reason: e instanceof Error ? e.message.slice(0, 200) : 'unknown' }
    }
    const semantic = await judgeSemantic(ctx, counted)
    bump(await recordCombinedAudit(prisma, { queueId: a.queueId, combined: combineAuditVerdicts(rule, semantic), auditor: i.auditor, now: i.now }))
  }
  return { kind: 'ok', pending: pending.length, tally, semanticCalls }
}

// ─────────────────────────────────────────────────────────
// 🔴 운영자 결함 신고 — 관리자 서버 경계(`reportAutoReadyDefect`)만 부른다
// ─────────────────────────────────────────────────────────

/** 🔴 운영자 신고의 판 — 자동 감사 판과 섞지 않는다 */
export const ADMIN_DEFECT_CONTRACT_VERSION = 'auto-ready-admin-defect-v1'
export const ADMIN_DEFECT_MODEL = 'human:admin-defect-report'
export const ADMIN_DEFECT_PROMPT_VERSION = 'admin-defect-report-v1'
/** 🔴 사람 기록의 감사자 종류 — 누가인지의 정본은 note 의 세션 User.id 다 */
export const ADMIN_DEFECT_AUDITOR = 'human:operator'
export const ADMIN_REASON_MAX = 10
export const ADMIN_REASON_CHARS = 300

export type AdminDefectResult =
  | { result: 'recorded'; queueId: string; created: boolean }
  | { result: 'alreadyDefect'; queueId: string }
  | { result: 'reject'; why: string }

/** 🔴 근거는 사람이 적은 문장 목록 — 비면 받지 않는다 */
export function adminReasonsOf(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  const out = v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter((x) => x !== '')
  if (out.length === 0 || out.length > ADMIN_REASON_MAX || out.some((x) => x.length > ADMIN_REASON_CHARS)) return null
  return out
}

/**
 * 🔴 **운영자 결함 신고 — 중대 결함 yes 기록.** 부르는 곳은 관리자 서버 액션 하나다.
 *    · 대상 — auto-ready:v1 로 발행된 글만(큐 `decidedBy=auto-ready:v1` · `createdPostId=글`)
 *    · 감사로 뽑히지 않은 글이면 감사 행을 **지금 글·지금 도장**에 묶어 만든다
 *    · 이미 yes 면 그대로 둔다(`alreadyDefect`) — 동시 신고도 결과는 하나다
 *    · no 를 yes 로 올린다. 어떤 no 도 이 yes 를 덮지 못한다(자동 감사는 판정 전일 때만 쓴다)
 *    · 기록 즉시 `confirmedDefectCount` 가 늘고 다음 도장·발행이 닫힌다
 */
export async function recordAdminDefectReport(prisma: PrismaClient, i: {
  actor: { userId: string }; postId: string; reasons: unknown; now: Date
}): Promise<AdminDefectResult> {
  const reasons = adminReasonsOf(i.reasons)
  if (reasons === null) return { result: 'reject', why: `근거를 1~${ADMIN_REASON_MAX}줄(줄당 ${ADMIN_REASON_CHARS}자 이하) 적어야 한다` }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx): Promise<AdminDefectResult> => {
        const user = await tx.user.findUnique({ where: { id: i.actor.userId }, select: { id: true } })
        if (user === null) return { result: 'reject', why: '신고자를 찾을 수 없다' }
        const post = await tx.post.findUnique({ where: { id: i.postId }, select: { id: true, title: true, content: true } })
        if (post === null) return { result: 'reject', why: '글이 없다' }
        const queue = await tx.originalPostApprovalQueue.findFirst({
          where: { createdPostId: post.id, decidedBy: AUTO_DECIDER }, select: { id: true, editDiff: true },
        })
        if (queue === null) return { result: 'reject', why: 'auto-ready:v1 로 발행된 글이 아니다' }
        const existing = await tx.autoReadyAudit.findUnique({ where: { queueId: queue.id } })
        // 🔴 이미 yes 인지 여기서 미리 거르지 않는다 — 아래 조건부 쓰기(`null` 또는 `no` 일 때만)가 그 판정 하나다
        const titleHash = digestOf(post.title)
        const bodyHash = digestOf(post.content)
        const drift = existing !== null && (existing.publishedTitleHash !== titleHash || existing.publishedBodyHash !== bodyHash)
        const note = `🔴 운영자 결함 신고 — userId=${i.actor.userId}${drift ? ' · 선정 뒤 글이 바뀌었다' : ''} · ${reasons.join(' · ')}`.slice(0, 2000)
        const judged = {
          defect: 'yes', judgedAt: i.now, auditor: ADMIN_DEFECT_AUDITOR, note,
          auditContractVersion: ADMIN_DEFECT_CONTRACT_VERSION, auditModel: ADMIN_DEFECT_MODEL, auditPromptVersion: ADMIN_DEFECT_PROMPT_VERSION,
        }
        if (existing === null) {
          // 🔴 뽑히지 않은 글 — 지금 글·지금 도장에 묶어 감사 행을 만든다(선정 칸은 지금 N 과 목표)
          const n = await tx.originalPostApprovalQueue.count({ where: { decidedBy: AUTO_DECIDER, createdPostId: { not: null } } })
          await tx.autoReadyAudit.create({
            data: {
              queueId: queue.id, postId: post.id, selectedAtN: Math.max(1, n), selectedTarget: Math.max(1, auditTarget(Math.max(1, n))),
              publishedTitleHash: titleHash, publishedBodyHash: bodyHash,
              stampContractDigest: readStamp(queue.editDiff)?.contractDigest ?? 'missing-stamp',
              ...judged,
            },
          })
          return { result: 'recorded', queueId: queue.id, created: true }
        }
        const u = await tx.autoReadyAudit.updateMany({
          where: { queueId: queue.id, OR: [{ defect: null }, { defect: 'no' }] }, data: judged,
        })
        return u.count === 1 ? { result: 'recorded', queueId: queue.id, created: false } : { result: 'alreadyDefect', queueId: queue.id }
      }, SERIALIZABLE)
    } catch (e) {
      // 🔴 동시 신고와 부딪혔다 — 처음부터 다시 읽는다(이긴 쪽의 yes 를 보고 alreadyDefect 가 된다)
      if (isConflict(e) && attempt < 2) continue
      if (isConflict(e)) return { result: 'reject', why: '다른 기록과 세 번 부딪혔다 — 다시 시도한다' }
      throw e
    }
  }
  return { result: 'reject', why: '기록하지 못했다' }
}

/** 🔴 신고 화면의 목록 — auto-ready:v1 발행 글과 지금 감사 상태(읽기만) */
export type ReportableRow = {
  postId: string; queueId: string; title: string; publishedAt: Date | null
  audit: { defect: string | null; auditor: string | null } | null
}
export async function listReportablePosts(prisma: PrismaClient, limit = 50): Promise<ReportableRow[]> {
  const rows = await prisma.originalPostApprovalQueue.findMany({
    where: { decidedBy: AUTO_DECIDER, createdPostId: { not: null } },
    select: { id: true, createdPostId: true, createdPost: { select: { title: true, createdAt: true } } },
    orderBy: { updatedAt: 'desc' }, take: limit,
  })
  const audits = await prisma.autoReadyAudit.findMany({
    where: { queueId: { in: rows.map((r) => r.id) } }, select: { queueId: true, defect: true, auditor: true },
  })
  const auditOf = new Map(audits.map((a) => [a.queueId, a]))
  return rows.filter((r) => r.createdPost !== null).map((r) => ({
    postId: r.createdPostId!, queueId: r.id, title: r.createdPost!.title, publishedAt: r.createdPost!.createdAt,
    audit: auditOf.has(r.id) ? { defect: auditOf.get(r.id)!.defect, auditor: auditOf.get(r.id)!.auditor } : null,
  }))
}
