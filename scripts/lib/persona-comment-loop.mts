/**
 * 무인 Persona 댓글 루프 **오케스트레이터** — 🔴 대상 선정 → 생성 → 9관문 → PENDING → 발행을 한 회차로 잇는다
 *
 * 🔴 **왜 생겼나** (2026-09-28 · Track B).
 *
 *    부품은 전부 있었다 — `materializeTargets`(대상) · `runEnqueuePipeline`(생성·9관문·적재) ·
 *    `publishCandidateTx`(발행). 그런데 **예약으로 이어 주는 자리가 없었다.**
 *    runner 는 사람이 승인한 행만 발행했고, 후보를 만드는 명령(`persona:comment-queue`)은
 *    사람이 손으로 돌려야 했다. 그래서 공개 Persona 댓글은 0/day 였다.
 *
 * 🔴 **새 판정을 만들지 않는다.** 이 파일이 하는 일은 순서뿐이다.
 *      · 대상 선정 · Persona-first 입력 · Gate 입력 — `materializeTargets` (Queue CLI 와 같은 함수)
 *      · 개인정보 판정 · provider · 9관문 · 적재 계약 — `runEnqueuePipeline` · `planEnqueue`
 *      · 9관문 판정 — `checkCommentCandidate` (완화 없음)
 *      · 발행 · 재검사 — `publishCandidateTx({ autoLane: true })` (Serializable · 재검사 전부)
 *      · 비용 — `SupplyLlmSession` 장부 (댓글 전용 디렉터리 · 하루 상한)
 *    무인 레인이 더하는 규칙 넷(60분 · 글당 1건 · 자기 글 · 단계/주체/상태)은
 *    `src/lib/persona-comment-auto-lane.ts` 에만 있다.
 *
 * 🔴 **실패는 그 한 건만 격리한다.** provider 오류 · Gate 실패 · 적재 충돌 · 발행 차단은
 *    그 대상만 멈추고 다음 글로 간다. 회차 전체를 멈추는 것은 단계·모델·예산처럼
 *    **모든 대상에 같이 걸리는** 조건뿐이다.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { Prisma, PrismaClient } from '@prisma/client'

import {
  judgeModelGate, judgePostAuthor, type ModelSelection,
} from '../../src/lib/persona-comment-release'
import { judgeGateReport } from '../../src/lib/persona-comment-gate-report'
import {
  judgeReadiness, windowFromRows, RATIO_WINDOW_DAYS,
} from '../../src/lib/persona-comment-governor'
import { legacyRunModeFor, readCommentStage, stagePowers } from '../../src/lib/persona-comment-stage'
import { countManagedPostsToday } from '../../src/lib/persona-comment-bootstrap-source'
import { dedupKeyOf } from '../../src/lib/persona-comment-queue'
import type { CommentInput } from '../../src/lib/persona-comment-input'
import type { ModelCanon } from '../../src/lib/persona-comment-provenance'
import { publishCandidateTx, type PublishTxResult } from '../../src/lib/persona-publish-tx'
import {
  AUTO_LANE_DECIDED_BY, AUTO_LANE_EXPIRE_REASON, AUTO_LANE_STAGE,
  firstPerPost, isAutoLaneCandidatePost,
} from '../../src/lib/persona-comment-auto-lane'
import {
  gateInputOf, materializeTargets, type GateContext, type TargetSource,
} from './persona-comment-targets'
import {
  runEnqueuePipeline, type PipelineGate, type PipelineOutcome, type PipelineWriter,
} from './persona-comment-pipeline'
import { checkCommentCandidate } from './persona-comment-candidate.mjs'

// ─────────────────────────────────────────────────────────
// 자리 · 상한
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **댓글 전용 장부 디렉터리.** 공급 장부(`llm-ledger`) · 감사 장부(`auto-ready-audit-ledger`)와 형제이고
 *    섞이지 않는다. 장부 판정은 그 디렉터리의 하루 파일만 세므로 공급 지출이 댓글 여력을 먹지 않고,
 *    댓글 지출이 공급 여력을 먹지 않는다(감사 전용 장부와 같은 결정 · 2026-09-28).
 */
export function commentLoopLedgerDir(home: string = homedir()): string {
  return join(home, 'Library', 'Application Support', 'soransoran', 'persona-comment-ledger')
}
/** 🔴 잠금 디렉터리 — 저장소 밖. `collect-lock` 의 `wx` 잠금을 그대로 쓴다 */
export function commentLoopLockDir(home: string = homedir()): string {
  return join(home, 'Library', 'Application Support', 'soransoran', 'persona-comment-loop')
}
export const COMMENT_LOOP_LOCK_FILE = 'loop.lock'
/** 🔴 잠금 나이 경고 기준 — 뺏지는 않는다(쥔 채 죽으면 사람이 치운다) */
export const COMMENT_LOOP_LOCK_TTL_MS = 30 * 60_000
/** 🔴 한 회차가 만들 수 있는 후보 상한 — Queue CLI(`QUEUE_RUN_MAX`) · 발행 배치(`BATCH_MAX`)와 같다 */
export const COMMENT_LOOP_RUN_MAX = 25
/** 🔴 발행 sweep 이 다시 보는 PENDING 의 나이 — 창(60분)보다 넉넉히, 하루를 넘지 않게 */
export const COMMENT_LOOP_SWEEP_LOOKBACK_MS = 24 * 3_600_000
/** 🔴 sweep 한 번이 보는 행 상한 — 회차가 끝나야 한다 */
export const COMMENT_LOOP_SWEEP_MAX = 50
/** 🔴 inspect 회차 미리보기 수 — provider 0 */
export const COMMENT_LOOP_PREVIEW = 5

// ─────────────────────────────────────────────────────────
// 대상 — 60분 창 안의 새 관리형 글만
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **유료 호출 전에** 창 밖 · 이미 Persona 댓글이 있는 글 · 열린 후보가 있는 글 ·
 *    외부로 보낼 수 없는 글(실회원 · 외부 원문 · 운영자 · 불명)을 뺀다.
 *    판정은 정본 함수(`isAutoLaneCandidatePost` · `judgePostAuthor`)가 한다 — 여기서 다시 적지 않는다.
 *    🔴 이것은 **돈을 아끼는 필터**다. 막는 권한은 발행 트랜잭션에 그대로 있다.
 */
export function autoLaneTargetSource(base: TargetSource, nowMs: number): TargetSource {
  return {
    ...base,
    posts: async () => {
      const [posts, openKeys] = await Promise.all([base.posts(), base.openDedupKeys()])
      const openPostIds = new Set(openKeys.map((k) => k.split(':')[1] ?? '').filter((x) => x !== ''))
      return posts.filter((p) => {
        const personaComments = p.comments.filter((c) => c.origin === 'PERSONA' || c.personaCode !== null).length
        if (!isAutoLaneCandidatePost({
          id: p.id, publishedAtMs: p.publishAtMs, personaComments, hasOpenQueue: openPostIds.has(p.id),
        }, nowMs)) return false
        return judgePostAuthor({
          authorPersonaCode: p.authorPersonaCode,
          authorOperatorWriterId: p.authorOperatorWriterId,
          source: p.source,
          authorRealMember: p.author === null ? null : {
            accountCount: p.author.accountCount, providerId: p.author.providerId,
          },
          authorIsAdmin: p.author?.isAdmin ?? null,
          visibility: p.visibility,
        }).externalSendAllowed
      })
    },
  }
}

// ─────────────────────────────────────────────────────────
// 생성 · Gate · 적재 — Queue CLI 와 같은 정본 함수를 잇는다
// ─────────────────────────────────────────────────────────

/** 🔴 생성 한 건. 운영은 장부를 지나는 provider, 시험은 가짜다(네트워크 0) */
export type CommentGenerate = (args: {
  model: string
  input: CommentInput
  recentTexts: readonly string[]
}) => Promise<{ ok: boolean; text: string | null; errorCode: string | null }>

/**
 * 🔴 **9관문은 `checkCommentCandidate` 정본 그대로다.** Queue CLI 와 같은 모양으로 감싼다 —
 *    bootstrap 여부는 호출자 주장이 아니라 Gate 모양으로 판정한다.
 *    판정부 결함(관문 수 불일치 throw)은 **그 후보만** 막는다 — 빈 gates 는 `planEnqueue` 가 거절한다.
 */
export function makeCanonGate(ctxOf: (input: CommentInput) => GateContext | undefined): PipelineGate {
  return ({ input, text }) => {
    const ctx = ctxOf(input)
    if (ctx === undefined) return { gates: [], gateStatus: 'INPUT_CONTEXT_MISSING', isBootstrap: false }
    try {
      const verdict = checkCommentCandidate(gateInputOf(ctx, input, text))
      const report = judgeGateReport({ gates: verdict.gates, status: verdict.status })
      return {
        gates: verdict.gates.map((g) => ({ gate: g.gate, outcome: g.outcome, detail: g.detail })),
        gateStatus: verdict.status,
        isBootstrap: report.missingRequired.length === 1 && report.missingRequired[0] === '⑧',
      }
    } catch {
      return { gates: [], gateStatus: 'GATE_ERROR', isBootstrap: false }
    }
  }
}

/**
 * 🔴 **PENDING 적재 — 중복은 unique constraint 가 가른다.** Queue CLI 와 같은 계약이다.
 *    미리 조회해서 이기려 하지 않는다 — 그 사이에 다른 회차가 넣을 수 있다.
 */
export function makePendingWriter(prisma: PrismaClient): PipelineWriter {
  return async ({ input, text, dedupKey, gates, gateStatus, provenance }) => {
    try {
      await prisma.personaApprovalQueue.create({
        data: {
          persona: { connect: { code: input.personaCode } },
          targetPostId: input.post.id,
          status: 'PENDING',
          candidateText: text,
          reactionType: input.reactionRole,
          gateStatus,
          gateResults: gates as unknown as Prisma.InputJsonValue,
          dedupKey,
          generatedModel: provenance.model,
          canonRunId: provenance.canonRunId,
          canonDigest: provenance.canonDigest,
        },
      })
      return { created: true, reason: 'PENDING 적재' }
    } catch (e) {
      const code = (e as { code?: string }).code
      return {
        created: false,
        reason: code === 'P2002'
          ? '🔴 같은 dedupKey 가 이미 있다 — 다른 회차가 먼저 넣었다(fail-closed)'
          : `적재 실패 — ${code ?? 'UNKNOWN'}`,
      }
    }
  }
}

// ─────────────────────────────────────────────────────────
// 발행 sweep — PENDING → (트랜잭션) → PUBLISHED | 닫힘
// ─────────────────────────────────────────────────────────

export type SweepResult = {
  seen: number
  published: number
  /** 🔴 막혀서 닫은 수 — 다음 회차가 같은 글에 다른 Persona 를 붙일 수 있게 자리를 비운다 */
  expired: number
  /** 🔴 경쟁·일시 오류 — 행은 PENDING 으로 남아 다음 회차(창 안이면)가 다시 본다 */
  errors: number
  lines: string[]
}

/**
 * 🔴 **무인 레인 발행.** 생성 근거가 있는 최근 PENDING 을 결정적 순서로 하나씩 트랜잭션에 넣는다.
 *
 *    · published — 끝
 *    · blocked   — 🔴 **그 행만 닫는다**(EXPIRED · `AUTO_LANE_BLOCKED` · 기계 결정 표식).
 *                  닫지 않으면 그 글의 자리를 영원히 차지한다(planner 가 열린 후보로 센다).
 *                  60분 창이 지난 행도 여기서 닫힌다 — 늦은 첫 댓글을 나중에 내보내지 않는다.
 *    · error     — 직렬화 충돌 등. 남겨 둔다 — 창 안이면 다음 회차가 다시 보고, 창 밖이면 막혀 닫힌다.
 *
 * 🔴 이 함수는 단계를 보지 않는다 — 부르는 쪽이 bootstrap-auto 일 때만 부르고,
 *    트랜잭션이 env 에서 단계를 **다시** 읽어 한 번 더 막는다.
 */
export async function sweepAutoLane(prisma: PrismaClient, now: Date): Promise<SweepResult> {
  const out: SweepResult = { seen: 0, published: 0, expired: 0, errors: 0, lines: [] }
  const rows = await prisma.personaApprovalQueue.findMany({
    where: {
      status: 'PENDING', publishedCommentId: null,
      // 🔴 근거 없는 옛 행은 자동 발행 대상이 아니다(트랜잭션도 막는다) — 애초에 집지 않는다
      canonRunId: { not: null }, targetPostId: { not: null },
      createdAt: { gte: new Date(now.getTime() - COMMENT_LOOP_SWEEP_LOOKBACK_MS) },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: COMMENT_LOOP_SWEEP_MAX,
    select: { id: true, targetPostId: true },
  })
  for (const r of rows) {
    out.seen += 1
    let res: PublishTxResult
    try {
      res = await publishCandidateTx(prisma, { id: r.id, now, autoLane: true })
    } catch {
      res = { kind: 'error', message: '발행 호출이 예외로 끝났다' }
    }
    if (res.kind === 'published') {
      out.published += 1
      out.lines.push(`✅ ${r.id.slice(0, 8)} → comment ${res.commentId.slice(0, 8)} (글 ${res.postId.slice(0, 8)})`)
      continue
    }
    if (res.kind === 'blocked') {
      // 🔴 조건부로 닫는다 — 그 사이 누가 발행했으면 0건이고, 그 사실을 적는다
      const closed = await prisma.personaApprovalQueue.updateMany({
        where: { id: r.id, status: 'PENDING', publishedCommentId: null },
        data: {
          status: 'EXPIRED', declineReason: AUTO_LANE_EXPIRE_REASON,
          decidedBy: AUTO_LANE_DECIDED_BY, decidedAt: now,
        },
      }).catch(() => ({ count: 0 }))
      if (closed.count === 1) out.expired += 1
      out.lines.push(`⏭️  ${r.id.slice(0, 8)} 막힘 → ${closed.count === 1 ? '닫음' : '닫지 못함'} — ${res.blocks[0]?.message ?? '?'}`)
      continue
    }
    out.errors += 1
    out.lines.push(`⚠️  ${r.id.slice(0, 8)} 오류 — ${res.message} (남겨 둔다)`)
  }
  return out
}

// ─────────────────────────────────────────────────────────
// 한 회차
// ─────────────────────────────────────────────────────────

export type CommentLoopDeps = {
  prisma: PrismaClient
  now: Date
  /** 🔴 단계 env — 발행 트랜잭션은 `process.env` 를 **다시** 읽는다(호출부 주장을 믿지 않는다) */
  env: Readonly<Record<string, string | undefined>>
  /** 🔴 false 면 provider 0 · DB write 0 — 무엇을 할지만 보인다 */
  live: boolean
  source: TargetSource
  canon: { selection: ModelSelection | null; canon: ModelCanon | null; detail: string }
  /** 🔴 이번 회차 대상 Persona 가 정해진 뒤 생성기를 만든다(말투 근거 묶음이 그때 정해진다) */
  makeGenerate: (personaCodes: readonly string[]) => CommentGenerate
  /** 🔴 유료 요청을 보내도 되는 예산 상태인가 — 아니면 생성 0 · 발행 sweep 은 돈다 */
  generation: { ok: boolean; reason: string }
  /** 회차 유료 요청 상한(장부 runRequestCap 과 같은 값) */
  runRequestCap: number
}

export type CommentLoopOutcome =
  | 'NOT_AUTO_STAGE'
  | 'MODEL_NOT_CONFIRMED'
  | 'DRY_RUN'
  | 'RAN'

export type CommentLoopReport = {
  outcome: CommentLoopOutcome
  stage: string
  reason: string
  sweepBefore: SweepResult | null
  sweepAfter: SweepResult | null
  /** 이번 회차 대상 글 수(글당 1) */
  targets: number
  providerCalls: number
  enqueued: number
  generationSkipped: string | null
  outcomes: readonly PipelineOutcome[]
  lines: string[]
}

const emptyReport = (outcome: CommentLoopOutcome, stage: string, reason: string): CommentLoopReport => ({
  outcome, stage, reason, sweepBefore: null, sweepAfter: null, targets: 0,
  providerCalls: 0, enqueued: 0, generationSkipped: null, outcomes: [], lines: [],
})

/**
 * 🔴 **한 회차.** 순서는 이렇다.
 *
 *    ① 단계가 bootstrap-auto 가 아니면 아무것도 하지 않는다(provider 0 · write 0)
 *    ② 모델이 확정되지 않았으면 아무것도 하지 않는다
 *    ③ 발행 sweep — 앞 회차가 남긴 PENDING 을 먼저 낸다(창 밖이면 닫는다)
 *    ④ 오늘 예산이 남았으면 60분 창 안의 새 글마다 **한 대상만** 만들고 9관문을 거쳐 PENDING 적재
 *    ⑤ 발행 sweep — 방금 적재한 것을 낸다
 *
 * 🔴 ③ 을 ④ 앞에 두는 이유 — 적재만 되고 발행되지 못한 행이 있으면 그 글에는 **이미 후보가 있다.**
 *    새로 만들면 유료 호출이 두 번이 되고, 둘 중 하나는 글당 1건 규칙에 막혀 버려진다.
 */
export async function runCommentLoop(deps: CommentLoopDeps): Promise<CommentLoopReport> {
  const stage = readCommentStage(deps.env)
  if (stage.stage !== AUTO_LANE_STAGE) {
    return emptyReport('NOT_AUTO_STAGE', stage.stage,
      `${stage.reason} — 무인 루프는 ${AUTO_LANE_STAGE} 에서만 돈다 (provider 0 · write 0)`)
  }
  const modelGate = judgeModelGate({ selection: deps.canon.selection })
  if (!modelGate.canWriteQueue || deps.canon.canon === null) {
    return emptyReport('MODEL_NOT_CONFIRMED', stage.stage, `${modelGate.reason} · ${deps.canon.detail}`)
  }

  const nowMs = deps.now.getTime()
  const windowMs = RATIO_WINDOW_DAYS * 86_400_000
  const lines: string[] = []

  if (!deps.live) {
    const preview = await materializeTargets({
      source: autoLaneTargetSource(deps.source, nowMs), limit: COMMENT_LOOP_PREVIEW, nowMs, windowMs,
    })
    const picked = firstPerPost(preview.targets, (t) => t.target.facts.postId)
    for (const t of picked) {
      lines.push(`대상 예정 글 ${t.target.facts.postId.slice(0, 8)} · ${t.target.facts.personaCode} · ${t.target.facts.reactionRole}`)
    }
    return {
      ...emptyReport('DRY_RUN', stage.stage, '--live 가 없다 — provider 0 · DB write 0'),
      targets: picked.length, lines,
    }
  }

  const sweepBefore = await sweepAutoLane(deps.prisma, deps.now)

  // ── 오늘 예산 — Queue CLI 와 같은 입력으로 같은 정본(`judgeReadiness`)을 부른다 ──
  const kstDayStart = new Date(Math.floor((nowMs + 9 * 3_600_000) / 86_400_000) * 86_400_000 - 9 * 3_600_000)
  const commentWindow = await (async () => {
    try {
      return windowFromRows(await deps.prisma.comment.findMany({
        where: { isDeleted: false, createdAt: { gte: new Date(nowMs - windowMs), lte: deps.now } },
        select: { commentOrigin: true, personaId: true },
      }), RATIO_WINDOW_DAYS)
    } catch { return { measured: false, real: 0, persona: 0, windowDays: RATIO_WINDOW_DAYS } }
  })()
  const publishedToday = await deps.prisma.comment.count({
    where: { isDeleted: false, commentOrigin: 'PERSONA', createdAt: { gte: kstDayStart } },
  }).catch(() => null)
  const killSwitchOff = await (async (): Promise<boolean | null> => {
    try {
      const r = await deps.prisma.personaGlobalSwitch.findUnique({ where: { id: 'global' }, select: { enabled: true } })
      return r === null ? true : !r.enabled
    } catch { return null }
  })()
  const managed = stagePowers(stage.stage).budget === 'bootstrap'
    ? await countManagedPostsToday(deps.prisma, kstDayStart, deps.now)
    : null
  const readiness = judgeReadiness({
    window: commentWindow, mode: legacyRunModeFor(stage.stage), stage: stage.stage,
    publishedToday, killSwitchOff,
    bootstrap: { openSlots: managed?.openSlots ?? Number.NaN, publishedToday, killSwitchOff },
  })
  lines.push(`예산 ${readiness.detail}`)

  const limit = Math.max(0, Math.min(COMMENT_LOOP_RUN_MAX, deps.runRequestCap, readiness.allowance.remaining))
  let generationSkipped: string | null = null
  let providerCalls = 0
  let enqueued = 0
  let targets = 0
  let outcomes: PipelineOutcome[] = []
  if (!deps.generation.ok) generationSkipped = deps.generation.reason
  else if (limit === 0) generationSkipped = `오늘 남은 자리 0 — ${readiness.blockers[0] ?? readiness.detail}`

  if (generationSkipped === null) {
    const material = await materializeTargets({
      source: autoLaneTargetSource(deps.source, nowMs), limit, nowMs, windowMs,
    })
    // 🔴 글당 1건 — planner 가 둘째 자리를 채웠어도 첫 대상만 쓴다
    const picked = firstPerPost(material.targets, (t) => t.target.facts.postId)
    targets = picked.length
    lines.push(`대상 글 ${picked.length}편 (planner ${material.counts.planned} · 입력 ${material.counts.built})`)
    for (const b of material.providerBlockers) lines.push(`유료 호출 차단 사유: ${b}`)

    const ctxByKey = new Map(picked.map((t) => [
      dedupKeyOf(t.target.facts.postId, t.target.facts.personaCode, t.target.facts.reactionRole),
      { gate: t.gate, recentTexts: t.recentTexts },
    ]))
    const ctxOf = (input: CommentInput) => ctxByKey.get(dedupKeyOf(input.post.id, input.personaCode, input.reactionRole))
    const generate = picked.length === 0
      ? null
      : deps.makeGenerate(picked.map((t) => t.target.input.personaCode))

    const result = await runEnqueuePipeline({
      selection: deps.canon.selection,
      canon: deps.canon.canon,
      targets: picked.map((t) => t.target),
      preflightOk: material.providerAllowed,
      preflightBlockers: material.providerBlockers,
      provider: async ({ model, input }) => {
        const ctx = ctxOf(input)
        if (ctx === undefined || generate === null) return { ok: false, text: null, errorCode: 'NO_GATE_CONTEXT' }
        // 🔴 한 건의 예외가 회차를 끝내지 않는다 — 그 대상만 실패다
        try { return await generate({ model, input, recentTexts: ctx.recentTexts }) } catch {
          return { ok: false, text: null, errorCode: 'PROVIDER_EXCEPTION' }
        }
      },
      gate: makeCanonGate((input) => ctxOf(input)?.gate),
      writer: makePendingWriter(deps.prisma),
      providerCallLimit: limit,
      limit,
    })
    providerCalls = result.providerCalls
    enqueued = result.created
    outcomes = result.outcomes
    if (result.stoppedReason !== null) lines.push(`생성 멈춤: ${result.stoppedReason}`)
    for (const o of result.outcomes) lines.push(`   ${o.personaCode} → 글 ${o.postId.slice(0, 8)} · ${o.step} — ${o.reason}`)
  }

  const sweepAfter = await sweepAutoLane(deps.prisma, deps.now)
  return {
    outcome: 'RAN', stage: stage.stage, reason: stage.reason,
    sweepBefore, sweepAfter, targets, providerCalls, enqueued, generationSkipped,
    outcomes, lines,
  }
}
