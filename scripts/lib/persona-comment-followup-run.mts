/**
 * 첫 댓글 뒤 **선택적 추가 댓글 회차** — 🔴 기본 OFF · 정기 회차에서만 · 첫 댓글 회차가 끝난 뒤에만
 *
 * 🔴 **새 판정을 만들지 않는다.** 이 파일은 순서와 사실 모으기뿐이다.
 *      · 회차 상한 · 첫 댓글 양보 · profile · 대화 감사 — `judgeFollowupTick`
 *      · 한 글 판정 · 대상 · 제외 Persona · 순서 — `judgeFollowupPost` · `orderFollowupGo` · `pickFollowupPersona`
 *      · 입력 · 9관문 · 적재 계약 — `buildCommentInput` · `runEnqueuePipeline` · `checkCommentCandidate` (첫 댓글과 같은 정본)
 *      · 본문 중복 — `judgeFollowupText`
 *      · 발행 재판정 — `publishCandidateTx({ followupLane: true })` (Serializable · 기존 재검사 전부 + `judgeFollowupPublish`)
 *      · 출처 — #707 정본 `personaCommentProvenanceOf`
 *      · 반응 라벨 — 정본 분류기 `classifyReaction`
 *
 * 🔴 **스위치(`SORAN_PERSONA_COMMENT_FOLLOWUP`)가 꺼져 있으면 DB 읽기도 0** 이다 — OFF 는 아무것도 바꾸지 않는다.
 */
import type { Prisma, PrismaClient } from '@prisma/client'

import {
  FOLLOWUP_KEY_PREFIX, followupEditDiffOf, followupRoleOf, isFollowupKey, judgeFollowupPost, judgeFollowupText, judgeFollowupTick,
  followupStageOf, orderFollowupGo, pickFollowupPersona, readFollowupProfileRaw, readFollowupSwitch, stampOf, validateFollowupProfile,
  type FollowupCommentRow, type FollowupPostFacts, type FollowupPostVerdict,
} from '../../src/lib/persona-comment-followup'
import {
  FOLLOWUP_LANE_DECIDED_BY, judgeConversationAudit, personaCommentCapFor, personaCommentProvenanceOf,
} from '../../src/lib/stage-evidence'
import { readStageEvidenceFacts } from '../../src/lib/stage-evidence-repo'
import { kstDateString } from '../../src/lib/release-canary'
import { decisionStageEnv } from '../../src/lib/scale-runtime'
import { readCommentStage } from '../../src/lib/persona-comment-stage'
import { isAutoLaneCandidatePost } from '../../src/lib/persona-comment-auto-lane'
import { OPEN_STATUSES } from '../../src/lib/persona-comment-queue'
import { judgePostAuthor, type ModelSelection } from '../../src/lib/persona-comment-release'
import type { ModelCanon } from '../../src/lib/persona-comment-provenance'
import { buildCommentInput, voiceEvidenceFromAssets, type CommentInput } from '../../src/lib/persona-comment-input'
import { isAdviceForbidden, isReactionType, type ReactionType } from '../../src/lib/persona-reaction-roles'
import { judgeSourceContext } from '../../src/lib/persona-comment-source-context'
import { judgeRealMember } from '../../src/lib/real-member-gate'
import { publishCandidateTx, type PublishTxResult } from '../../src/lib/persona-publish-tx'
import { kstDayStart } from '../../src/lib/persona-cap'
import { profileOf, type RuntimeStage } from '../../src/lib/scale-profile'
import { tallyOf, type LedgerEntry } from '../../src/lib/llm-ledger'
import { priceOf } from '../../src/lib/llm-pricing'
import { COMMENT_CALL_SHAPE } from '../../src/lib/persona-comment-cost'
import { classifyReaction } from './voice-comment-signals.mjs'
import { gateInputOf, sourceTextsOf, type GateContext, type SourcePost, type TargetSource } from './persona-comment-targets'
import { runEnqueuePipeline, type PipelineGate, type PipelineOutcome, type PipelineWriter } from './persona-comment-pipeline'
import { checkCommentCandidate } from './persona-comment-candidate.mjs'
import { judgeGateReport } from '../../src/lib/persona-comment-gate-report'
import { createPendingCandidateLocked } from '../../src/lib/persona-candidate-write'

/**
 * 🔴 **이 회차가 추가 댓글 단계를 돌 수 있는가** — 진입점은 이 함수 하나로 정한다(E6).
 *    정기 회차(`scheduled`) · `--live` · 스위치 on 만. 사건 깨움(`event`) · 복구(`recovery`) · 수동(`manual`) ·
 *    표식이 깨진 회차(`unknown`) · dry-run 은 첫 댓글만 한다. 그날 단계(결정 env)는 이 뒤 `readFollowupContext` 가 본다.
 */
export function followupEligibleFor(i: {
  live: boolean; trigger: string; env: Readonly<Record<string, string | undefined>>
}): { ok: boolean; reason: string } {
  if (!i.live) return { ok: false, reason: 'dry-run — 추가 댓글 단계 없음' }
  if (i.trigger !== 'scheduled') return { ok: false, reason: `${i.trigger} 회차 — 첫 댓글만(추가 댓글은 정기 회차에서만)` }
  const sw = readFollowupSwitch(i.env)
  return sw.enabled ? { ok: true, reason: '정기 회차 · 스위치 on' } : { ok: false, reason: sw.reason }
}

/** 🔴 추가 댓글 행을 닫을 때 남기는 코드 — 첫 댓글(`AUTO_LANE_BLOCKED`)과 다르다 */
export const FOLLOWUP_EXPIRE_REASON = 'FOLLOWUP_LANE_BLOCKED'
/** 🔴 sweep 이 다시 보는 PENDING 의 나이 · 한 번에 보는 행 상한 */
export const FOLLOWUP_SWEEP_LOOKBACK_MS = 24 * 3_600_000
export const FOLLOWUP_SWEEP_MAX = 20
/** 프롬프트에 싣는 답글 대상 요약 길이 — 🔴 원문 전문은 나가지 않는다 */
export const FOLLOWUP_REPLY_DIGEST_CHARS = 120
const DIGEST_CHARS = 600
const COMMENT_DIGEST_CHARS = 60

export type FollowupSweep = { seen: number; published: number; expired: number; errors: number; lines: string[] }

/**
 * 🔴 **추가 댓글 발행 sweep** — 추가 댓글 열쇠 행만 집는다. 막히면 그 행만 닫는다(EXPIRED · 추가 댓글 표식).
 *    첫 댓글 sweep(`sweepAutoLane`)은 이 행을 집지 않는다 — 두 레인이 서로의 행을 닫지 않는다.
 */
export async function sweepFollowupLane(prisma: PrismaClient, now: Date): Promise<FollowupSweep> {
  const out: FollowupSweep = { seen: 0, published: 0, expired: 0, errors: 0, lines: [] }
  const rows = await prisma.personaApprovalQueue.findMany({
    where: {
      status: 'PENDING', publishedCommentId: null, canonRunId: { not: null }, targetPostId: { not: null },
      dedupKey: { startsWith: FOLLOWUP_KEY_PREFIX },
      createdAt: { gte: new Date(now.getTime() - FOLLOWUP_SWEEP_LOOKBACK_MS) },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: FOLLOWUP_SWEEP_MAX,
    select: { id: true, dedupKey: true },
  })
  for (const r of rows) {
    if (!isFollowupKey(r.dedupKey)) continue
    out.seen += 1
    let res: PublishTxResult
    try { res = await publishCandidateTx(prisma, { id: r.id, now, followupLane: true }) } catch {
      res = { kind: 'error', message: '발행 호출이 예외로 끝났다' }
    }
    if (res.kind === 'published') {
      out.published += 1
      out.lines.push(`✅ 추가 ${r.id.slice(0, 8)} → comment ${res.commentId.slice(0, 8)}`)
      continue
    }
    if (res.kind === 'blocked') {
      const closed = await prisma.personaApprovalQueue.updateMany({
        where: { id: r.id, status: 'PENDING', publishedCommentId: null },
        data: { status: 'EXPIRED', declineReason: FOLLOWUP_EXPIRE_REASON, decidedBy: FOLLOWUP_LANE_DECIDED_BY, decidedAt: now },
      }).catch(() => ({ count: 0 }))
      if (closed.count === 1) out.expired += 1
      out.lines.push(`⏭️  추가 ${r.id.slice(0, 8)} 막힘 → ${closed.count === 1 ? '닫음' : '닫지 못함'} — ${res.blocks[0]?.message ?? '?'}`)
      continue
    }
    out.errors += 1
    out.lines.push(`⚠️  추가 ${r.id.slice(0, 8)} 오류 — ${res.message} (남겨 둔다)`)
  }
  return out
}

/** 🔴 생성 한 건 — 장부 단계는 호출부가 `commentFollowupGen` 으로 연다 */
export type FollowupGenerate = (args: {
  model: string
  input: CommentInput
  recentTexts: readonly string[]
}) => Promise<{ ok: boolean; text: string | null; errorCode: string | null }>

export type FollowupPhaseDeps = {
  prisma: PrismaClient
  now: Date
  env: Readonly<Record<string, string | undefined>>
  source: TargetSource
  canon: { selection: ModelSelection | null; canon: ModelCanon | null }
  makeGenerate: (personaCodes: readonly string[]) => FollowupGenerate
  /** 🔴 첫 댓글과 같은 유료 생성 문(장부 판정) — 닫혀 있으면 생성 0 · sweep 은 돈다 */
  generation: { ok: boolean; reason: string }
  /** 🔴 댓글 장부 오늘 기록 · 하루 상한 — 못 읽었으면 entries null */
  ledger: { entries: readonly LedgerEntry[] | null; capUsd: number | null; headroom: number | null }
  /** 🔴 승인 profile 원본(파일에서 읽은 JSON) · 그날 런타임 단계(StageDecision.release) */
  profile: unknown
  runtimeStage: string | null
  /** 🔴 최근 단계 증거의 대화 감사(`StageEvidenceVerdict.conversation`) — 그대로 넘긴다 */
  conversationAudit: unknown
}

export type FollowupPhaseReport = {
  outcome: 'OFF' | 'TICK_ZERO' | 'RAN'
  reason: string
  sweepBefore: FollowupSweep | null
  sweepAfter: FollowupSweep | null
  goPosts: number
  providerCalls: number
  enqueued: number
  outcomes: readonly PipelineOutcome[]
  lines: string[]
}

const emptyPhase = (outcome: FollowupPhaseReport['outcome'], reason: string): FollowupPhaseReport => ({
  outcome, reason, sweepBefore: null, sweepAfter: null, goPosts: 0, providerCalls: 0, enqueued: 0, outcomes: [], lines: [],
})

/**
 * 🔴 **회차 준비 읽기 — 그날 단계 · 승인 profile · 대화 감사.** 진입점과 격리 DB 검사가 **같은 함수**를 쓴다.
 *    부르는 쪽은 스위치가 on 일 때만 부른다(OFF 면 이 읽기도 0).
 *    · 단계: **consumer 가 넣은 결정 env**(`decisionStageEnv` — 결정 표식이 있을 때만). 러너는 결정 표를 직접 읽지 않는다
 *      (stage-ladder-check 의 adapter 호출 계약). 표식이 없으면 null → 0건 — 댓글 러너가 consumer 를 거치기 전에는 켜지지 않는다
 *    · 대화 감사: 오늘(KST) 그 단계 증거 사실로 `judgeConversationAudit` — 못 읽으면 undefined → 0건
 */
export async function readFollowupContext(i: {
  prisma: PrismaClient; now: Date; env: Readonly<Record<string, string | undefined>>; readText: (path: string) => string
}): Promise<{ profile: unknown; runtimeStage: string | null; conversationAudit: unknown }> {
  const kstDate = kstDateString(i.now)
  // 🔴 오늘 결정 · 정본 단계 · 공개 ≤ 천장 — 트랜잭션과 같은 판정
  const stage = followupStageOf(decisionStageEnv(i.env), i.now).stage
  const conversationAudit = stage === null ? undefined : await readStageEvidenceFacts(i.prisma, {
    kstDate, stage, decision: null, now: i.now,
    commentCapPerPost: personaCommentCapFor(readCommentStage(i.env).stage),
  }).then((f) => judgeConversationAudit(f.posts)).catch(() => undefined)
  return { profile: readFollowupProfileRaw(i.env, i.readText), runtimeStage: stage, conversationAudit }
}

/** 🔴 1건 예약액 — 확정 모델 단가 × 댓글 호출 모양 × 여유 배수. 모르면 NaN(회차 판정이 0 으로 막는다) */
export function followupReserveUsd(model: string | null, headroom: number | null): number {
  const p = model === null ? null : priceOf(model)
  if (p === null || headroom === null || !Number.isFinite(headroom)) return Number.NaN
  return ((COMMENT_CALL_SHAPE.inputTokens * p.inputPerMTok) + (COMMENT_CALL_SHAPE.outputTokens * p.outputPerMTok)) / 1_000_000 * headroom
}

const reactionOf = (text: string): ReactionType | null => {
  const r: unknown = classifyReaction(text)
  return isReactionType(r) ? r : null
}

/**
 * 🔴 **한 회차의 추가 댓글 단계.** 부르는 쪽(`runCommentLoop`)은 정기 회차 · 첫 댓글 sweep 뒤에만 부른다.
 */
export async function runFollowupPhase(deps: FollowupPhaseDeps): Promise<FollowupPhaseReport> {
  const sw = readFollowupSwitch(deps.env)
  // 🔴 OFF 면 여기서 끝 — DB 읽기 · sweep · provider 전부 0
  if (!sw.enabled) return emptyPhase('OFF', sw.reason)

  const { prisma, now } = deps
  const nowMs = now.getTime()
  const lines: string[] = []
  const sweepBefore = await sweepFollowupLane(prisma, now)

  // ── 사실 — 공개 24시간 안의 Persona 글 ──
  const since = new Date(nowMs - 24 * 3_600_000)
  const dayStart = kstDayStart(now)
  const sourcePosts = await deps.source.posts()
  const srcById = new Map<string, SourcePost>(sourcePosts.map((p) => [p.id, p]))
  const posts = await prisma.post.findMany({
    where: {
      status: 'PUBLISHED', personaId: { not: null },
      OR: [{ publishAt: { gte: since, lte: now } }, { publishAt: null, createdAt: { gte: since, lte: now } }],
    },
    select: { id: true, personaId: true, publishAt: true, createdAt: true, status: true, title: true, content: true },
  })
  const postIds = posts.map((p) => p.id)
  const comments = postIds.length === 0 ? [] : await prisma.comment.findMany({
    where: { postId: { in: postIds } },
    select: {
      id: true, postId: true, parentId: true, createdAt: true, isDeleted: true, authorId: true,
      commentOrigin: true, personaId: true, operatorWriterId: true, content: true,
    },
  })
  const personaCommentIds = comments.filter((c) => c.commentOrigin === 'PERSONA').map((c) => c.id)
  const [qs, ls, reports, openRows, fuRows] = await Promise.all([
    prisma.personaApprovalQueue.findMany({
      where: { publishedCommentId: { in: personaCommentIds } },
      select: { publishedCommentId: true, targetPostId: true, personaId: true, status: true, decidedBy: true, decidedAt: true, reactionType: true },
    }),
    prisma.personaActivityLog.findMany({
      where: { kind: 'comment', targetId: { in: personaCommentIds } },
      select: { targetId: true, personaId: true, decidedBy: true, publishedAt: true },
    }),
    prisma.report.findMany({ where: { commentId: { in: comments.map((c) => c.id) } }, select: { commentId: true } }),
    prisma.personaApprovalQueue.findMany({
      where: { targetPostId: { in: postIds }, status: { in: [...OPEN_STATUSES] } }, select: { targetPostId: true },
    }),
    prisma.personaApprovalQueue.findMany({
      where: { decidedBy: FOLLOWUP_LANE_DECIDED_BY, status: 'PUBLISHED', decidedAt: { gte: dayStart } },
      select: { personaId: true },
    }),
  ])
  const reported = new Set(reports.map((r) => r.commentId))
  const openPosts = new Set(openRows.map((r) => r.targetPostId))
  const contentOf = new Map(comments.map((c) => [c.id, c.content]))
  const factsOf = (p: (typeof posts)[number]): FollowupPostFacts => {
    const src = srcById.get(p.id)
    const author = src === undefined ? null : judgePostAuthor({
      authorPersonaCode: src.authorPersonaCode, authorOperatorWriterId: src.authorOperatorWriterId, source: src.source,
      authorRealMember: src.author === null ? null : { accountCount: src.author.accountCount, providerId: src.author.providerId },
      authorIsAdmin: src.author?.isAdmin ?? null, visibility: src.visibility,
    })
    const rows: FollowupCommentRow[] = comments.filter((c) => c.postId === p.id).map((c) => ({
      id: c.id, postId: c.postId, parentId: c.parentId, createdAt: c.createdAt, isDeleted: c.isDeleted, authorId: c.authorId,
      commentOrigin: c.commentOrigin, personaId: c.personaId, operatorWriterId: c.operatorWriterId,
      reaction: c.commentOrigin === 'PERSONA' ? reactionOf(c.content) : null,
      role: c.commentOrigin === 'PERSONA' ? followupRoleOf(qs.filter((q) => q.publishedCommentId === c.id)) : null,
      reported: reported.has(c.id),
      provenance: c.commentOrigin !== 'PERSONA' ? null : personaCommentProvenanceOf({
        comment: { postId: c.postId, personaId: c.personaId, createdAtMs: c.createdAt.getTime(), topLevel: c.parentId === null },
        queues: qs.filter((q) => q.publishedCommentId === c.id).map((q) => ({
          targetPostId: q.targetPostId, personaId: q.personaId, status: q.status, decidedBy: q.decidedBy, decidedAtMs: q.decidedAt?.getTime() ?? null,
        })),
        logs: ls.filter((l) => l.targetId === c.id).map((l) => ({
          personaId: l.personaId, decidedBy: l.decidedBy, publishedAtMs: l.publishedAt?.getTime() ?? null,
        })),
      }),
    }))
    return {
      postId: p.id, publishedAtMs: (p.publishAt ?? p.createdAt).getTime(), postStatus: p.status,
      authorPersonaId: p.personaId,
      // 🔴 외부로 보낼 수 있는 Persona 글만 — 실회원 · 외부 원문 · 운영자 · 불명은 잇지 않는다
      autoManagedPost: author === null ? null : author.externalSendAllowed,
      postReaction: reactionOf(`${p.title}\n${p.content}`),
      comments: rows,
      hasOpenQueue: openPosts.has(p.id),
    }
  }

  // ── 회차 판정 — 첫 댓글 대기 · 장부 · profile · 대화 감사 ──
  const pendingFirstComments = sourcePosts.filter((p) => {
    const personaComments = p.comments.filter((c) => c.origin === 'PERSONA' || c.personaCode !== null).length
    if (!isAutoLaneCandidatePost({ id: p.id, publishedAtMs: p.publishAtMs, personaComments, hasOpenQueue: false }, nowMs)) return false
    return judgePostAuthor({
      authorPersonaCode: p.authorPersonaCode, authorOperatorWriterId: p.authorOperatorWriterId, source: p.source,
      authorRealMember: p.author === null ? null : { accountCount: p.author.accountCount, providerId: p.author.providerId },
      authorIsAdmin: p.author?.isAdmin ?? null, visibility: p.visibility,
    }).externalSendAllowed
  }).length
  const model = deps.canon.canon?.winner ?? null
  const perCall = followupReserveUsd(model, deps.ledger.headroom)
  const tally = deps.ledger.entries === null ? null : tallyOf(deps.ledger.entries)
  const fuEntries = deps.ledger.entries?.filter((e) => e.stage === 'commentFollowupGen') ?? null
  const followupUsdToday = fuEntries === null ? null : fuEntries.reduce((s, e) =>
    s + (e.status === 'blocked' ? 0 : e.status === 'settled' && e.settledUsd !== null ? e.settledUsd : (e.reservedUsd ?? 0)), 0)
  const remainingUsd = tally === null || deps.ledger.capUsd === null ? null
    : Math.max(0, deps.ledger.capUsd - tally.settledUsd - tally.openReservedUsd)
  // 🔴 오늘 남은 첫 댓글 의무 = 지금 기다리는 글 + 그날 단계 목표 중 아직 공개되지 않은 자리
  const stageOk = deps.runtimeStage !== null && validateFollowupProfile(deps.profile, deps.runtimeStage).ok
  let firstReserveUsd: number | null = null
  if (stageOk && Number.isFinite(perCall)) {
    const managedToday = sourcePosts.filter((p) => p.authorPersonaCode !== null && p.publishAtMs !== null
      && p.publishAtMs >= dayStart.getTime() && p.publishAtMs <= nowMs).length
    const target = profileOf(deps.runtimeStage as RuntimeStage).dailyTarget
    firstReserveUsd = (pendingFirstComments + Math.max(0, target - managedToday)) * perCall
  }
  const tick = judgeFollowupTick({
    switch: sw, commentStage: (deps.env.SORAN_PERSONA_COMMENT_STAGE ?? '').trim(), killSwitchOff: await (async () => {
      try {
        const r = await prisma.personaGlobalSwitch.findUnique({ where: { id: 'global' }, select: { enabled: true } })
        return r === null ? true : !r.enabled
      } catch { return null }
    })(),
    pendingFirstComments, profile: deps.profile, runtimeStage: deps.runtimeStage,
    followupsToday: fuRows.length, followupUsdToday, commentLedgerRemainingUsd: remainingUsd,
    firstCommentReserveUsd: firstReserveUsd, perCallReserveUsd: perCall, conversationAudit: deps.conversationAudit,
  })
  lines.push(`추가 댓글 회차 ${tick.detail}`)
  let allowed = tick.allowed
  if (allowed > 0 && !deps.generation.ok) { lines.push(`생성 문 닫힘 — ${deps.generation.reason}`); allowed = 0 }
  if (allowed === 0) {
    const sweepAfter = await sweepFollowupLane(prisma, now)
    return { ...emptyPhase('TICK_ZERO', tick.blockers[0] ?? tick.detail), sweepBefore, sweepAfter, lines }
  }
  const prof = validateFollowupProfile(deps.profile, deps.runtimeStage)
  const perPersonaMax = prof.ok ? prof.profile.perPersonaDailyMax : 0

  // ── 대상 — 추가가 적은 글부터 · 한 글 한 건 ──
  const ready: { postId: string; publishedAtMs: number; go: Extract<FollowupPostVerdict, { verdict: 'GO' }>; facts: FollowupPostFacts }[] = []
  for (const p of posts) {
    const f = factsOf(p)
    const v = judgeFollowupPost(f, nowMs)
    if (v.verdict === 'GO') ready.push({ postId: p.id, publishedAtMs: f.publishedAtMs ?? 0, go: v, facts: f })
  }
  // ── dedupKey 선제 제거 — provider 전에 이미 존재하는 열쇠는 다시 호출하지 않는다 ──
  const candidateKeys = ready.map((r) => r.go.key)
  const existingDedupRows = candidateKeys.length === 0 ? [] : await prisma.personaApprovalQueue.findMany({
    where: { dedupKey: { in: candidateKeys } },
    select: { dedupKey: true },
  })
  const existingDedupKeys = new Set(existingDedupRows.map((r) => r.dedupKey))
  const eligibleReady = ready.filter((r) => !existingDedupKeys.has(r.go.key))
  if (existingDedupKeys.size > 0) lines.push(`dedupKey 선제 제거 ${existingDedupKeys.size}건 — provider 호출 생략`)
  const personas = await deps.source.personas()
  const [knownNames, frequencyRead] = await Promise.all([deps.source.knownNames(), deps.source.frequency()])
  const fuToday = new Map<string, number>()
  for (const r of fuRows) fuToday.set(r.personaId, (fuToday.get(r.personaId) ?? 0) + 1)
  const personaIdByCode = new Map((await prisma.persona.findMany({ select: { id: true, code: true } })).map((p) => [p.code, p.id]))

  type Planned = { target: Parameters<typeof runEnqueuePipeline>[0]['targets'][number]; gate: GateContext; recentTexts: readonly string[]
    go: Extract<FollowupPostVerdict, { verdict: 'GO' }>; existing: { text: string; persona: boolean }[] }
  const planned: Planned[] = []
  const usedPersonas = new Set<string>()
  for (const { postId, go, facts } of orderFollowupGo(eligibleReady)) {
    if (planned.length >= allowed) break
    const src = srcById.get(postId)
    if (src === undefined) continue
    const eligible = personas.filter((pe) => pe.status === 'active'
      && !judgeRealMember({ accountCount: pe.user?.accountCount ?? null, providerId: pe.user?.providerId ?? null }).real
      && pe.identity !== null && pe.voiceCore !== null && pe.lifeStage !== null && pe.lifeStage.trim() !== '')
    const pick = pickFollowupPersona(go, postId, eligible.flatMap((pe) => {
      const id = personaIdByCode.get(pe.code)
      // 🔴 같은 회차에 한 Persona 는 한 글만
      return id === undefined || usedPersonas.has(id) ? [] : [{ personaId: id, eligible: true, followupsToday: fuToday.get(id) ?? 0 }]
    }), perPersonaMax)
    if (pick.personaId === null) { lines.push(`글 ${postId.slice(0, 8)} — ${pick.reason}`); continue }
    const pe = eligible.find((x) => personaIdByCode.get(x.code) === pick.personaId)!
    const replyToDigest = go.target.kind === 'reply'
      ? (contentOf.get(go.target.commentId) ?? '').slice(0, FOLLOWUP_REPLY_DIGEST_CHARS) : undefined
    const liveComments = facts.comments.filter((c) => !c.isDeleted)
    let built: ReturnType<typeof buildCommentInput> | null = null
    for (const role of go.roles) {
      const b = buildCommentInput({
        persona: {
          code: pe.code, ageBand: pe.ageBand, region: pe.region, lifeStage: pe.lifeStage, identity: pe.identity,
          voiceCore: pe.voiceCore, voiceVariations: pe.voiceVariations, noGoTopics: pe.noGoTopics,
          noGoExpressions: pe.noGoExpressions, forbiddenReactionRoles: pe.forbiddenReactionRoles,
        },
        post: {
          id: postId, title: src.title, bodyDigest: src.content.slice(0, DIGEST_CHARS), boardLabel: src.boardType,
          existingCommentDigests: liveComments.map((c) => (contentOf.get(c.id) ?? '').slice(0, COMMENT_DIGEST_CHARS)),
          ...(replyToDigest === undefined ? {} : { replyToDigest }),
          ...(go.speaker.kind === 'author' ? { authorReply: true as const } : {}),
        },
        reactionRole: role,
        voice: voiceEvidenceFromAssets({ voiceCore: pe.voiceCore, voiceVariations: pe.voiceVariations, recentTexts: pe.comments.map((c) => c.content) }),
        memory: { has: false, note: '' },
      })
      if (b.ok) { built = b; break }
    }
    if (built === null || !built.ok) { lines.push(`글 ${postId.slice(0, 8)} — ${pe.code} 입력을 만들지 못했다`); continue }
    usedPersonas.add(pick.personaId)
    const ctx = judgeSourceContext({ visibility: src.visibility, sourceSite: src.sourceSite, boardType: src.boardType, title: src.title, body: src.content })
    const recentTexts = pe.comments.map((c) => c.content)
    planned.push({
      go, recentTexts,
      existing: [
        { text: `${src.title}\n${src.content}`, persona: false },
        ...liveComments.map((c) => ({ text: contentOf.get(c.id) ?? '', persona: c.commentOrigin === 'PERSONA' })),
      ],
      gate: {
        sourceTexts: sourceTextsOf(built.input), knownNames, frequency: frequencyRead.corpus, priorTexts: recentTexts,
        seedUseCount: await deps.source.seedUseCount(pe.code), adviceForbidden: isAdviceForbidden(pe.forbiddenReactionRoles),
        sourceIsCafeOperational: ctx.operational, sourceContextReason: ctx.reason,
      },
      target: {
        input: built.input,
        author: {
          authorPersonaCode: src.authorPersonaCode, authorOperatorWriterId: src.authorOperatorWriterId, source: src.source,
          authorRealMember: src.author === null ? null : { accountCount: src.author.accountCount, providerId: src.author.providerId },
          authorIsAdmin: src.author?.isAdmin ?? null, visibility: src.visibility,
        },
        facts: {
          postId, personaCode: pe.code, reactionRole: built.input.reactionRole, hasOpenQueue: false,
          personaCommentsOnPost: liveComments.filter((c) => c.commentOrigin === 'PERSONA').length,
          personaAlreadyOnPost: false, postStatus: src.visibility.status, personaActive: true, personaRealMember: false,
        },
      },
    })
  }
  const providerBlockers: string[] = []
  if (knownNames === undefined) providerBlockers.push('knownNames (⑥-A 회원 표시명을 읽지 못했다)')
  if (frequencyRead.corpus === null) providerBlockers.push(`frequencyLookup — ${frequencyRead.reason}`)
  for (const p of planned) if (p.gate.sourceIsCafeOperational === null) providerBlockers.push(`sourceIsCafeOperational — ${p.gate.sourceContextReason}`)

  const byKey = new Map(planned.map((p) => [`${p.target.facts.postId}\u0000${p.target.facts.personaCode}`, p]))
  const planOf = (input: CommentInput) => byKey.get(`${input.post.id}\u0000${input.personaCode}`)
  const generate = planned.length === 0 ? null : deps.makeGenerate(planned.map((p) => p.target.input.personaCode))
  // 🔴 9관문은 첫 댓글과 같은 정본 그대로다(`makeCanonGate` 와 같은 모양 · 완화 없음)
  const gate: PipelineGate = ({ input, text }) => {
    const p = planOf(input)
    if (p === undefined) return { gates: [], gateStatus: 'INPUT_CONTEXT_MISSING', isBootstrap: false }
    try {
      const verdict = checkCommentCandidate(gateInputOf(p.gate, input, text))
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
  const writer: PipelineWriter = async ({ input, text, gates, gateStatus, provenance }) => {
    const p = planOf(input)
    if (p === undefined) return { created: false, reason: '추가 댓글 계획을 찾지 못했다' }
    // 🔴 저장은 공용 계약 하나다 — 트랜잭션 · Post 잠금 · 생성 때 게시판(boardLabel = boardType) 재확인 뒤 create
    //    (persona-candidate-write.ts). provider 호출은 이미 끝났다 — 잠금은 여기서 처음 잡는다.
    const res = await createPendingCandidateLocked(prisma, {
      postId: input.post.id,
      expectedBoardType: input.post.boardLabel,
      data: {
        persona: { connect: { code: input.personaCode } },
        candidateText: text, reactionType: input.reactionRole, gateStatus,
        gateResults: gates as unknown as Prisma.InputJsonValue,
        // 🔴 멱등 열쇠는 (글 · 순번) — 같은 자리에 두 번 들어가지 않는다
        dedupKey: p.go.key,
        editDiff: followupEditDiffOf(stampOf(input.post.id, p.go)) as unknown as Prisma.InputJsonValue,
        generatedModel: provenance.model, canonRunId: provenance.canonRunId, canonDigest: provenance.canonDigest,
      },
    })
    if (res.created) return { created: true, reason: '추가 댓글 PENDING 적재' }
    const code = res.errorCode // 🔴 중복은 unique constraint(P2002)가 가른다
    return { created: false, reason: code === 'P2002' ? '🔴 같은 자리(글·순번) 열쇠가 이미 있다(fail-closed)' : res.reason }
  }
  const result = await runEnqueuePipeline({
    selection: deps.canon.selection, canon: deps.canon.canon, targets: planned.map((p) => p.target),
    preflightOk: providerBlockers.length === 0, preflightBlockers: providerBlockers,
    provider: async ({ model: m, input }) => {
      const p = planOf(input)
      if (p === undefined || generate === null) return { ok: false, text: null, errorCode: 'NO_PLAN' }
      let r: { ok: boolean; text: string | null; errorCode: string | null }
      try { r = await generate({ model: m, input, recentTexts: p.recentTexts }) } catch {
        return { ok: false, text: null, errorCode: 'PROVIDER_EXCEPTION' }
      }
      // 🔴 본문 중복 · 같은 도입 — 9관문 앞에서 막는다(돈은 썼지만 적재 0)
      if (r.ok && r.text !== null && !judgeFollowupText({ text: r.text, existing: p.existing }).ok) {
        return { ok: false, text: null, errorCode: 'FOLLOWUP_TEXT_DUP' }
      }
      return r
    },
    gate, writer, providerCallLimit: planned.length, limit: allowed, oneCreatedPerPost: true,
  })
  if (result.stoppedReason !== null) lines.push(`생성 멈춤: ${result.stoppedReason}`)
  for (const o of result.outcomes) lines.push(`   추가 ${o.personaCode} → 글 ${o.postId.slice(0, 8)} · ${o.step} — ${o.reason}`)
  const sweepAfter = await sweepFollowupLane(prisma, now)
  return {
    outcome: 'RAN', reason: tick.detail, sweepBefore, sweepAfter, goPosts: ready.length,
    providerCalls: result.providerCalls, enqueued: result.created, outcomes: result.outcomes, lines,
  }
}
