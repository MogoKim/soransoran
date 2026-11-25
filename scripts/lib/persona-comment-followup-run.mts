/**
 * 첫 댓글 뒤 **선택적 추가 댓글 회차** — 🔴 기본 OFF · 정기 회차에서만 · 첫 댓글 회차가 끝난 뒤에만
 *
 * 🔴 **새 판정을 만들지 않는다.** 이 파일은 순서와 사실 모으기뿐이다.
 *      · 회차 상한 · 첫 댓글 양보 · profile · 대화 감사 — `judgeFollowupTick`
 *      · 한 글 판정 · 대상 · 제외 Persona · 순서 — `judgeFollowupPost` · `orderFollowupGo` · `pickFollowupPersona`
 *      · 입력 · 댓글 관문 · 적재 계약 — `buildCommentInput` · `runEnqueuePipeline` · `checkCommentCandidate` (첫 댓글과 같은 정본)
 *      · 본문 중복 — `judgeFollowupText`
 *      · 실패 격리 — 첫 댓글과 같은 시도 기억 정책 · 저장소(`persona-comment-attempt-policy` · 추가 댓글 lane 파일)
 *      · 발행 재판정 — `publishCandidateTx({ followupLane: true })` (Serializable · 기존 재검사 전부 + `judgeFollowupPublish`)
 *      · 출처 — #707 정본 `personaCommentProvenanceOf`
 *      · 자리(누가 어디에 어떤 모양으로) — 글의 대화 계획 `persona-thread-plan` · `followupSeatsOf`
 *
 * 🔴 **스위치(`SORAN_PERSONA_COMMENT_FOLLOWUP`)가 꺼져 있으면 DB 읽기도 0** 이다 — OFF 는 아무것도 바꾸지 않는다.
 */
import type { Prisma, PrismaClient } from '@prisma/client'

import {
  FOLLOWUP_KEY_PREFIX, closedFollowupKeyOf, followupEditDiffOf, isFollowupKey, judgeFollowupPost, judgeFollowupText, judgeFollowupTick,
  FOLLOWUP_ATTEMPTS_PER_POST_PER_TICK, addFollowupIsolation, classifyFollowupFailure, followupFailureHaltsRound,
  followupAuthorUnavailableReason, followupIsolationOf, followupPersonaCandidates, followupPlanCap,
  followupSpentRoleKeys, followupStageOf, orderFollowupGo, partitionFollowupSourceContexts, pickFollowupSeat, withoutAuthorOwnPost,
  FOLLOWUP_POST_AGE_MAX_MS, readFollowupProfileRaw, readFollowupSwitch, stampOf, validateFollowupProfile,
  type FollowupCommentRow, type FollowupFailureCode, type FollowupIsolation, type FollowupPersonaFacts, type FollowupPostFacts,
  type FollowupPostVerdict,
} from '../../src/lib/persona-comment-followup'
import {
  FOLLOWUP_LANE_DECIDED_BY, judgeConversationAudit, personaCommentProvenanceOf,
} from '../../src/lib/stage-evidence'
import { readStageEvidenceFacts } from '../../src/lib/stage-evidence-repo'
import { kstDateString } from '../../src/lib/release-canary'
import { decisionStageEnv } from '../../src/lib/scale-runtime'
import { isAutoLaneCandidatePost } from '../../src/lib/persona-comment-auto-lane'
import { OPEN_STATUSES } from '../../src/lib/persona-comment-queue'
import { judgePostAuthor, type ModelSelection } from '../../src/lib/persona-comment-release'
import type { ModelCanon } from '../../src/lib/persona-comment-provenance'
import { buildCommentInput, postPersonaMarksOf, selfFactsOf, voiceEvidenceFromAssets, type CommentInput } from '../../src/lib/persona-comment-input'
import { hasMenopauseExperience, hasSpouseStrain } from '../../src/lib/persona-life-facts'
import { isAdviceForbidden } from '../../src/lib/persona-reaction-roles'
import { judgeSourceContext } from '../../src/lib/persona-comment-source-context'
import { judgeRealMember } from '../../src/lib/real-member-gate'
import { commentLifeBlocksOf, publishCandidateTx, type PublishTxResult } from '../../src/lib/persona-publish-tx'
import { kstDayStart } from '../../src/lib/persona-cap'
import { profileOf, type RuntimeStage } from '../../src/lib/scale-profile'
import { tallyOf, type LedgerEntry } from '../../src/lib/llm-ledger'
import { priceOf } from '../../src/lib/llm-pricing'
import { COMMENT_CALL_SHAPE } from '../../src/lib/persona-comment-cost'
import { gateInputOf, sourceTextsOf, type GateContext, type SourcePost, type TargetSource } from './persona-comment-targets'
import {
  runEnqueuePipeline, type PipelineBeforeProvider, type PipelineGate, type PipelineProvider, type PipelineOutcome, type PipelineResult, type PipelineTarget,
  type PipelineWriter,
} from './persona-comment-pipeline'
import {
  attemptKeyOf, attemptOutcomeOf, postPersonaKeyOf, type AttemptEntry,
} from '../../src/lib/persona-comment-attempt-policy'
import type { AttemptStore } from './persona-comment-attempt-store.mjs'
import { checkCommentCandidate } from './persona-comment-candidate.mjs'
import { judgeGateReport } from '../../src/lib/persona-comment-gate-report'
import { judgeStaticVoiceCapability } from '../../src/lib/persona-voice-repeat'
import { capBlocksForOneMore } from '../../src/lib/persona-cap-usage'
import { HOT_QUEUE_SELECT, hotQueueWhereOf, hotSourceByPost, isHotThread } from '../../src/lib/persona-thread-hot'
import { createPendingCandidateLocked } from '../../src/lib/persona-candidate-write'

/**
 * 🔴 **이 회차가 추가 댓글 단계를 돌 수 있는가** — 진입점은 이 함수 하나로 정한다(E6).
 *    launchd 회차(`scheduled` — 정기 · 사건 깨움 · 복구 kickstart 가 같은 label 이라 모두 이 값) · `--live` · 스위치 on 만.
 *    손으로 띄운 회차(`manual`)와 dry-run 은 첫 댓글만 한다. 그날 단계(결정 env)는 이 뒤 `readFollowupContext` 가 본다.
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
        // 🔴 닫으면서 자리 열쇠를 내놓는다 — 닫힌 행이 (글 · 순번)을 쥐고 그 글을 봉쇄하지 않게
        data: {
          status: 'EXPIRED', declineReason: FOLLOWUP_EXPIRE_REASON, decidedBy: FOLLOWUP_LANE_DECIDED_BY, decidedAt: now,
          dedupKey: closedFollowupKeyOf(r.dedupKey, r.id),
        },
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
  /**
   * 🔴 **추가 댓글 lane 시도 기억**(`followupAttemptStoreInLease`). 첫 댓글 저장소와 다른 파일이다.
   *    다른 lane 저장소이거나 못 읽으면 그 회차 유료 생성 0(fail-closed) — sweep 은 돈다.
   */
  attemptStore: AttemptStore
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
 *    · 대화 감사: 대화가 열린 글의 날짜(오늘 · 마감 `FOLLOWUP_POST_AGE_MAX_MS` 안이면 어제도)의 증거 사실로
 *      `judgeConversationAudit` — 자정 뒤 어제 글에 붙는 추가 댓글도 같은 감사 안에 둔다. 못 읽으면 undefined → 0건
 */
/**
 * 🔴 **대화 감사가 읽는 글 날짜(KST)** — 대화가 아직 열린 글이 공개됐을 수 있는 날 전부.
 *    오늘과 `now − 마감(FOLLOWUP_POST_AGE_MAX_MS)` 의 날짜 — 자정부터 마감 시간 동안은 어제도 든다. 오래된 날짜가 앞이다.
 */
export function conversationAuditDatesOf(now: Date): string[] {
  return [...new Set([kstDateString(new Date(now.getTime() - FOLLOWUP_POST_AGE_MAX_MS)), kstDateString(now)])]
}

export async function readFollowupContext(i: {
  prisma: PrismaClient; now: Date; env: Readonly<Record<string, string | undefined>>; readText: (path: string) => string
}): Promise<{ profile: unknown; runtimeStage: string | null; conversationAudit: unknown }> {
  const openDates = conversationAuditDatesOf(i.now)
  // 🔴 오늘(그날 결정 전이면 전날) 결정 · 정본 단계 · 공개 ≤ 천장 — 트랜잭션과 같은 판정
  const stage = followupStageOf(decisionStageEnv(i.env), i.now).stage
  const conversationAudit = stage === null ? undefined : await Promise.all(openDates.map((kstDate) => readStageEvidenceFacts(i.prisma, {
    kstDate, stage, decision: null, now: i.now,
  }))).then((fs) => judgeConversationAudit(fs.flatMap((f) => f.posts))).catch(() => undefined)
  return { profile: readFollowupProfileRaw(i.env, i.readText), runtimeStage: stage, conversationAudit }
}

/** 🔴 1건 예약액 — 확정 모델 단가 × 댓글 호출 모양 × 여유 배수. 모르면 NaN(회차 판정이 0 으로 막는다) */
export function followupReserveUsd(model: string | null, headroom: number | null): number {
  const p = model === null ? null : priceOf(model)
  if (p === null || headroom === null || !Number.isFinite(headroom)) return Number.NaN
  return ((COMMENT_CALL_SHAPE.inputTokens * p.inputPerMTok) + (COMMENT_CALL_SHAPE.outputTokens * p.outputPerMTok)) / 1_000_000 * headroom
}

/** 회차가 이을 글 하나(정해진 순서) — 시도 기억의 만료 계산에 글 공개 시각이 필요하다 */
export type FollowupSlot = { postId: string; postPublishedAtMs: number }

/**
 * 🔴 이 글에서 지금 고를 Persona 를 정할 때 빼야 하는 것 — 오늘 격리(이번 회차 실패를 더한 사본) · 이번 회차 사용.
 *    같은 글에 머무는 실패(Persona · 글 × Persona · 기억이 막음)는 다시 고르기 **전에** 격리 사본에 들어간다.
 */
export type FollowupExclusion = {
  isolation: FollowupIsolation
  usedPersonaIds: ReadonlySet<string>
}

export type FollowupPlanned = { target: PipelineTarget; personaId: string }

/**
 * 🔴 한 대상의 시도 — 운영은 `runEnqueuePipeline` 에 대상 하나를 넘긴다(호출 1 · 적재 1 상한).
 *    `errorCode`(provider) · `writeCode`(writer)는 분류기가 쓰는 코드다 — 본문 · 사유 문장이 아니다.
 */
export type FollowupAttempt = (target: PipelineTarget, beforeProvider: PipelineBeforeProvider) =>
  Promise<{ result: PipelineResult; errorCode: string | null; writeCode: string | null }>

export type FollowupGenerationReport = {
  providerCalls: number
  created: number
  outcomes: PipelineOutcome[]
  stoppedReason: string | null
  /** 시도마다 붙인 분류 — 글 · Persona · 분류 코드 */
  classified: { postId: string; personaCode: string; code: FollowupFailureCode }[]
  warnings: string[]
  lines: string[]
}

/**
 * 🔴 **추가 댓글 생성 — 실패 분류 · 같은 회차 재선정** (2026-11-14 H1).
 *
 *    글은 정해진 순서(`orderFollowupGo`)로 하나씩 본다. 한 글에서:
 *      1. `planFor` 가 오늘 격리 · 이번 회차 사용 · 이 글 시도를 뺀 Persona 를 고른다(결정적 picker 그대로).
 *         한 자리 · 한 사람이 막히면 그 글의 다음 사람 · 다음 자리로 넘어간 뒤에야 "이 글에 지금 설 사람이 없다" 로 끝난다
 *      2. provider 앞에서 시작 기록(`recordStart`) — 못 남기면 부르지 않는다(IO 면 회차를 멈춘다)
 *      3. 결과를 `classifyFollowupFailure` 로 분류하고 **바로** 기억에 적는다(`FU_*` 를 `blockCodes` 에)
 *      4. Persona 실패 → 그 Persona 를 오늘 빼고 **같은 글에서 다음 정상 Persona** 를 다시 고른다
 *         글 × Persona 실패 → 그 글에서 그 Persona 만 빼고 다시 고른다
 *         글 실패 → 그 글만 오늘 빼고 다음 글로 간다(그 Persona 는 다른 글에서 쓴다)
 *         일시 · 모르는 실패 → 이번 회차를 멈춘다(일시 실패는 아무것도 격리하지 않는다)
 *    🔴 상한 — 적재 `allowed` · 호출 `providerCallBudget`(비용 잔량 건수로 묶인 값) · 한 글 `FOLLOWUP_ATTEMPTS_PER_POST_PER_TICK`.
 *    🔴 첫 댓글 저장소를 받으면 아무것도 하지 않는다 — 첫 댓글 기억을 추가 댓글이 쓰지 않는다.
 */
export async function runFollowupGeneration<S extends FollowupSlot>(i: {
  store: AttemptStore
  nowMs: number
  allowed: number
  /** 🔴 `judgeFollowupTick().providerCallBudget` — 이보다 많이 부르지 않는다 */
  providerCallBudget: number
  slots: readonly S[]
  /** 시도 기억에서 읽은 오늘 격리(`followupIsolationOf`) — 이 함수는 사본에 더한다 */
  isolation: FollowupIsolation
  planFor: (slot: S, ex: FollowupExclusion) => { ok: true; plan: FollowupPlanned } | { ok: false; reason: string }
  attempt: FollowupAttempt
}): Promise<FollowupGenerationReport> {
  const report: FollowupGenerationReport = {
    providerCalls: 0, created: 0, outcomes: [], stoppedReason: null, classified: [], warnings: [], lines: [],
  }
  if (i.store.lane !== 'followup') {
    report.warnings.push('🔴 추가 댓글 단계가 다른 lane 시도 기억을 받았다 — 유료 호출 0')
    report.stoppedReason = '시도 기억 lane 불일치 — provider 0'
    return report
  }
  const iso: FollowupIsolation = {
    personaCodes: new Set(i.isolation.personaCodes), postIds: new Set(i.isolation.postIds),
    postPersonaKeys: new Set(i.isolation.postPersonaKeys),
  }
  const usedPersonaIds = new Set<string>()
  const budget = Math.max(0, i.providerCallBudget)
  const full = (): boolean => report.created >= i.allowed || report.providerCalls >= budget
  const halt = (why: string): void => { report.stoppedReason = why }

  outer: for (const slot of i.slots) {
    if (full()) break
    if (iso.postIds.has(slot.postId)) { report.lines.push(`글 ${slot.postId.slice(0, 8)} — 오늘(KST) 글 쪽 실패로 격리 · 건너뜀`); continue }
    for (let n = 0; n < FOLLOWUP_ATTEMPTS_PER_POST_PER_TICK; n++) {
      if (full()) break outer
      const picked = i.planFor(slot, { isolation: iso, usedPersonaIds })
      if (!picked.ok) { report.lines.push(`글 ${slot.postId.slice(0, 8)} — ${picked.reason}`); break }
      const { target, personaId } = picked.plan
      const facts = target.facts
      const key = attemptKeyOf(facts)
      let started = false
      const beforeProvider: PipelineBeforeProvider = () => {
        const entry: AttemptEntry = {
          postId: facts.postId, personaCode: facts.personaCode, reactionRole: facts.reactionRole,
          postPublishedAtMs: slot.postPublishedAtMs, attemptedAtMs: i.nowMs, step: 'STARTED', failedGates: [], blockCodes: [],
        }
        const w = i.store.recordStart(entry, i.nowMs)
        if (w.ok) { started = true; return { proceed: true } }
        if (w.kind === 'IO') report.warnings.push(`🔴 추가 댓글 시도 기록을 남기지 못했다 ${w.reason} — 남은 provider 0`)
        return { proceed: false, reason: `시도 기록 [${w.kind}] ${w.reason}`, stopRound: w.kind === 'IO' }
      }
      const r = await i.attempt(target, beforeProvider)
      report.providerCalls += r.result.providerCalls
      report.created += r.result.created
      report.outcomes.push(...r.result.outcomes)
      const o = r.result.outcomes.at(-1)
      // 🔴 대상 결과가 없다 = 파이프라인 입구(정본 · 모델 · 관문 입력)가 닫혔다 — 다음 대상도 같다
      if (o === undefined) { halt(r.result.stoppedReason ?? '파이프라인이 결과 없이 끝났다 — provider 0'); break outer }
      if (o.step === 'AUTHOR_BLOCKED') break // 글 성격 — provider 0 · 기록 0 · 다음 글
      if (o.step === 'ATTEMPT_BLOCKED') {
        if (r.result.stoppedReason !== null) { halt(r.result.stoppedReason); break outer }
        iso.postPersonaKeys.add(postPersonaKeyOf(facts)) // 기억이 이미 막고 있다 — 이번 회차에서도 뺀다(호출 0)
        continue
      }
      const code = o.step === 'ENQUEUED' ? null : classifyFollowupFailure({
        step: o.step, errorCode: r.errorCode, writeCode: r.writeCode,
        failedGates: o.plan?.gates.filter((g) => g.outcome !== 'pass').map((g) => `${g.gate}:${g.outcome}`) ?? [],
        blockCodes: o.plan?.blocks.map((b) => b.code) ?? [],
      })
      if (started) {
        const summary = attemptOutcomeOf({ step: o.step, gates: o.plan?.gates ?? [], blockCodes: o.plan?.blocks.map((b) => b.code) ?? [] })
        if (summary !== null) {
          const blockCodes = code === null ? summary.blockCodes : [...summary.blockCodes.slice(0, 31), code]
          const done = i.store.recordOutcomes([{ key, ...summary, blockCodes }], i.nowMs)
          if (!done.ok) {
            // 🔴 결과를 못 적으면 다음 회차는 미완(`STARTED`)으로 읽는다(글 × Persona). 이번 회차는 더 부르지 않는다
            report.warnings.push(`🔴 추가 댓글 시도 결과를 갱신하지 못했다 ${done.reason} — 남은 provider 0`)
            halt('시도 결과 기록 실패 — 남은 provider 0')
            break outer
          }
        }
      }
      if (code === null) {
        if (o.step === 'ENQUEUED') usedPersonaIds.add(personaId)
        break // 적재 · dry-run — 한 글 한 건, 다음 글
      }
      report.classified.push({ postId: facts.postId, personaCode: facts.personaCode, code })
      addFollowupIsolation(iso, facts, code)
      report.lines.push(`   분류 ${facts.personaCode} → 글 ${facts.postId.slice(0, 8)} · ${o.step} · ${code}`)
      if (r.result.stoppedReason !== null) { halt(r.result.stoppedReason); break outer }
      if (followupFailureHaltsRound(code)) { halt(`${code} — 이번 회차 남은 provider 0(격리 ${code === 'FU_TRANSIENT' ? '없음' : '글 × Persona'})`); break outer }
      if (code === 'FU_POST_DAY') break // 그 글만 오늘 뺀다 — 그 Persona 는 다른 글에서 쓴다
      // FU_PERSONA_DAY · FU_COMBO_DAY — 같은 글에서 다음 정상 Persona 를 다시 고른다
      //    (글 × Persona 실패는 그 쌍만 막는다 — 그 Persona 는 이번 회차에도 다른 글에서 쓸 수 있다)
    }
  }
  return report
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

  // ── 사실 — 대화 마감 안의 Persona 글 ──
  const since = new Date(nowMs - FOLLOWUP_POST_AGE_MAX_MS)
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
  const [qs, ls, reports, openRows, fuRows, hotRows] = await Promise.all([
    prisma.personaApprovalQueue.findMany({
      where: { publishedCommentId: { in: personaCommentIds } },
      select: { publishedCommentId: true, targetPostId: true, personaId: true, status: true, decidedBy: true, decidedAt: true },
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
    // 🔴 뜨거운 글 판독 재료 — 발행 트랜잭션과 같은 조회 모양(`persona-thread-hot`)
    prisma.originalPostApprovalQueue.findMany({ where: hotQueueWhereOf(postIds), select: HOT_QUEUE_SELECT }),
  ])
  const hotSourceOf = hotSourceByPost(hotRows)
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
    const publishedAtMs = (p.publishAt ?? p.createdAt).getTime()
    return {
      postId: p.id, publishedAtMs, postStatus: p.status,
      authorPersonaId: p.personaId,
      // 🔴 외부로 보낼 수 있는 Persona 글만 — 실회원 · 외부 원문 · 운영자 · 불명은 잇지 않는다
      autoManagedPost: author === null ? null : author.externalSendAllowed,
      comments: rows,
      hasOpenQueue: openPosts.has(p.id),
      // 🔴 큐 행이 없는 글(사람이 직접 쓴 Persona 글)은 뜨겁지 않다 — 트랜잭션도 같은 판독이다
      hot: isHotThread(hotSourceOf.get(p.id) ?? null, publishedAtMs),
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
  // 🔴 시도 기억 — 추가 댓글 lane 저장소만 · 못 읽으면 유료 생성 0(첫 댓글과 같은 fail-closed)
  const memory = deps.attemptStore.lane === 'followup' ? deps.attemptStore.read(nowMs) : null
  if (memory === null || !memory.ok) {
    const why = memory === null ? '추가 댓글 단계가 다른 lane 시도 기억을 받았다' : `추가 댓글 시도 기억을 읽지 못했다 [${memory.code}] ${memory.reason}`
    lines.push(`🔴 ${why} — 유료 호출 0`)
    const sweepAfter = await sweepFollowupLane(prisma, now)
    return { ...emptyPhase('TICK_ZERO', why), sweepBefore, sweepAfter, lines }
  }
  if (memory.warning !== undefined) lines.push(memory.warning)
  // 🔴 오늘(KST) 격리 — Persona · 글 · 글 × Persona 셋뿐이다. 일시 실패는 어디에도 들지 않는다
  const isolation = followupIsolationOf(memory.entries, nowMs)
  if (isolation.personaCodes.size + isolation.postIds.size + isolation.postPersonaKeys.size > 0) {
    lines.push(`오늘 실패 격리 — Persona ${isolation.personaCodes.size} · 글 ${isolation.postIds.size} · 글×Persona ${isolation.postPersonaKeys.size} (KST 자정에 풀린다)`)
  }
  const prof = validateFollowupProfile(deps.profile, deps.runtimeStage)
  const perPersonaMax = prof.ok ? prof.profile.perPersonaDailyMax : 0

  // ── 대상 — 진척률(추가 ÷ (계획 크기 − 1))이 낮은 글부터 · 한 글 한 건 ──
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
  const knownNames = await deps.source.knownNames()
  const fuToday = new Map<string, number>()
  for (const r of fuRows) fuToday.set(r.personaId, (fuToday.get(r.personaId) ?? 0) + 1)
  const personaIdByCode = new Map((await prisma.persona.findMany({ select: { id: true, code: true } })).map((p) => [p.code, p.id]))

  type Planned = { target: PipelineTarget; gate: GateContext; recentTexts: readonly string[]
    go: Extract<FollowupPostVerdict, { verdict: 'GO' }>; existing: { text: string; persona: boolean }[] }
  /**
   * 🔴 **후보와 무관하게 ⑧ 이 막는 Persona 는 고르지 않는다** (2026-11-07 · 첫 댓글과 같은 함수).
   *    seed 공유 수는 고정 배정 값이라 한 번 읽는다 — 고를 때와 판정할 때 같은 값이다. 반복 이력만으로는 빼지 않는다.
   */
  const seedShareByCode = new Map<string, number | null>()
  for (const pe of personas) if (pe.status === 'active') seedShareByCode.set(pe.code, await deps.source.seedUseCount(pe.code))
  const staticLocked = [...seedShareByCode].filter(([, n]) => !judgeStaticVoiceCapability({ seedShare: n }).capable).map(([c]) => c)
  if (staticLocked.length > 0) lines.push(`planner skip 고정 잠금 ${staticLocked.join(' · ')} — 후보와 무관하게 ⑧ 이 막아 유료 호출 0`)
  // 🔴 자격 사실은 한 번 만든다 — 실회원 판정 · 프로필 · 정적 말투 능력은 기존 정본 그대로다(재선정이 이 값을 바꾸지 않는다)
  /**
   * 🔴 **카드 상한** (2026-11-21 · 11-20 적재 145건 중 40건이 발행에서 상한으로 닫혔다) — 발행 트랜잭션과 같은 `planCap` 을
   *    같은 셈법(활동 로그 오늘/7일 + 열린 대기)으로 고르는 순간에 쓴다. 못 읽으면 회차 유료 호출 0(seedUseCount 와 같은 fail-closed).
   */
  const capStates = await deps.source.capStates()
  const capBlockedOf = (code: string): string | null => {
    if (capStates === null) return null
    const blocks = capBlocksForOneMore(capStates.get(code))
    return blocks.length === 0 ? null : blocks.map((b) => b.message).join(' · ')
  }
  const personaFacts: FollowupPersonaFacts[] = personas.map((pe) => {
    const id = personaIdByCode.get(pe.code) ?? null
    return {
      code: pe.code, personaId: id, active: pe.status === 'active',
      realMember: judgeRealMember({ accountCount: pe.user?.accountCount ?? null, providerId: pe.user?.providerId ?? null }).real,
      profileComplete: pe.identity !== null && pe.voiceCore !== null && pe.lifeStage !== null && pe.lifeStage.trim() !== '',
      voiceCapable: judgeStaticVoiceCapability({ seedShare: seedShareByCode.get(pe.code) ?? null }).capable,
      followupsToday: id === null ? 0 : fuToday.get(id) ?? 0,
      capBlocked: capBlockedOf(pe.code),
    }
  })
  const capFull = personaFacts.filter((p) => p.active && p.capBlocked !== null).map((p) => p.code)
  if (capFull.length > 0) lines.push(`상한 찬 Persona ${capFull.join(' · ')} — 고르지 않는다(발행 트랜잭션과 같은 planCap)`)
  const ordered = orderFollowupGo(eligibleReady)
  // 🔴 출처 문맥은 글 성격이다. 모르는 글만 이 회차에서 격리하고 정상 글은 계속한다.
  //    회차 전체를 막는 옛 규칙은 한 글이 모든 정상 후보의 용량을 막는 두 번째 starvation이었다.
  const ctxByPost = new Map(ordered.map(({ postId }) => {
    const src = srcById.get(postId)
    return [postId, src === undefined ? { operational: null, reason: '원문을 찾지 못했다' } : judgeSourceContext({
      visibility: src.visibility, sourceSite: src.sourceSite, boardType: src.boardType, title: src.title, body: src.content,
    })] as const
  }))
  const sourceContextPartition = partitionFollowupSourceContexts(
    [...ctxByPost].map(([postId, ctx]) => ({ postId, operational: ctx.operational, reason: ctx.reason })),
  )
  const codeByPersonaId = new Map([...personaIdByCode].map(([code, id]) => [id, code]))
  // 🔴 글쓴이는 자기 글에서 글 × Persona 하루 격리를 받지 않는다 — 오늘 이미 보낸 역할 조합(`spentRoleKeys`)만 다시 보내지 않는다
  const ownPostFree = withoutAuthorOwnPost(isolation, posts.flatMap((p) => {
    const code = p.personaId === null ? undefined : codeByPersonaId.get(p.personaId)
    return code === undefined ? [] : [{ postId: p.id, personaCode: code }]
  }))
  const spentRoleKeys = followupSpentRoleKeys(memory.entries, nowMs)
  const phaseIsolation: FollowupIsolation = {
    personaCodes: ownPostFree.personaCodes,
    postIds: new Set([...ownPostFree.postIds, ...sourceContextPartition.blocked.map((x) => x.postId)]),
    postPersonaKeys: ownPostFree.postPersonaKeys,
  }
  for (const b of sourceContextPartition.blocked) {
    lines.push(`출처 문맥 ${b.postId.slice(0, 8)} — ${b.reason} · 이 글만 회차 격리 · provider 0`)
  }
  const providerBlockers: string[] = []
  if (knownNames === undefined) providerBlockers.push('knownNames (⑥-A 회원 표시명을 읽지 못했다)')
  // 🔴 seed 공유 수를 못 셌으면 회차 전체 유료 호출 0 — 첫 댓글 materializer 와 같은 정본(그 사람만 빼고 계속하지 않는다)
  for (const [code, n] of seedShareByCode) if (n === null) providerBlockers.push(`seedUseCount (${code} 의 ⑧ seed 재사용 횟수를 세지 못했다)`)
  if (capStates === null) providerBlockers.push('capStates (카드 상한 사용량을 읽지 못했다)')

  const byKey = new Map<string, Planned>()
  const planOf = (input: CommentInput) => byKey.get(`${input.post.id}\u0000${input.personaCode}`)
  type Slot = FollowupSlot & (typeof ordered)[number]
  /**
   * 🔴 이 글에서 지금 설 (자리 · Persona) 하나 — 자리·사람 넘기기는 `pickFollowupSeat`, 여기는 유료 호출 전 준비(`prepare`)만 한다.
   *    생활사·No-Go 는 발행 트랜잭션과 같은 함수로 **여기서** 본다 — 생성 · 적재 뒤에 닫히면 돈을 쓰고 버린다.
   */
  const planFor = (slot: Slot, ex: FollowupExclusion): { ok: true; plan: FollowupPlanned } | { ok: false; reason: string } => {
    const { postId, go, facts } = slot
    const src = srcById.get(postId)
    const ctx = ctxByPost.get(postId)
    if (src === undefined || ctx === undefined) return { ok: false, reason: '원문을 찾지 못했다' }
    const liveComments = facts.comments.filter((c) => !c.isDeleted)
    const picked = pickFollowupSeat<Planned>({
      go, postId, perPersonaDailyMax: perPersonaMax,
      candidates: followupPersonaCandidates({ postId, personas: personaFacts, isolation: ex.isolation, usedPersonaIds: ex.usedPersonaIds }),
      authorWhy: (authorPersonaId) => followupAuthorUnavailableReason({
        postId, author: personaFacts.find((x) => x.personaId === authorPersonaId),
        isolation: ex.isolation, usedPersonaIds: ex.usedPersonaIds, perPersonaDailyMax: perPersonaMax,
      }),
      prepare: (seatGo, personaId) => {
        const pe = personas.find((x) => personaIdByCode.get(x.code) === personaId)
        if (pe === undefined) return { ok: false, reason: '고른 Persona 를 찾지 못했다' }
        if (commentLifeBlocksOf({ code: pe.code, identity: pe.identity, noGoTopics: pe.noGoTopics }, { title: src.title, content: src.content }).length > 0) {
          return { ok: false, reason: `${pe.code} 는 이 글과 생활사·No-Go 가 충돌한다` }
        }
        const replyToDigest = seatGo.target.kind === 'reply'
          ? (contentOf.get(seatGo.target.commentId) ?? '').slice(0, FOLLOWUP_REPLY_DIGEST_CHARS) : undefined
        // 🔴 오늘 이미 보내 실패한 (글 · Persona · 역할)은 다시 보내지 않는다 — 글쓴이는 남은 역할로 다시 선다
        const roles = seatGo.roles.filter((role) => !spentRoleKeys.has(attemptKeyOf({ postId, personaCode: pe.code, reactionRole: role })))
        // 🔴 자리 순번(꼴 추첨의 열쇠) · 이 글의 앞 Persona 댓글 표지(실회원 댓글 제외 · 표지만) ·
        //    이 사람이 자기 이야기로 말해도 되는 사실(카드 생활 축 · 자기가 쓴 글 제목 — 이미 있는 칸만)
        const threadSeat = {
          ordinal: seatGo.ordinal,
          postPersonaMarks: postPersonaMarksOf(liveComments.filter((c) => c.commentOrigin === 'PERSONA').map((c) => contentOf.get(c.id) ?? '')),
          selfFacts: selfFactsOf({
            ageBand: pe.ageBand, region: pe.region, identity: pe.identity,
            ownPostTitles: sourcePosts.filter((x) => x.authorPersonaCode === pe.code && x.id !== postId).map((x) => x.title),
          }),
          menopauseExperienced: hasMenopauseExperience(
            pe.identity !== null && typeof pe.identity === 'object' ? (pe.identity as { menopauseStatus?: string | null }).menopauseStatus : null),
          spouseStrain: hasSpouseStrain(pe.identity),
        }
        let built: ReturnType<typeof buildCommentInput> | null = null
        for (const role of roles) {
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
              ...(seatGo.speaker.kind === 'author' ? { authorReply: true as const } : {}),
              threadSeat,
            },
            reactionRole: role,
            voice: voiceEvidenceFromAssets({ voiceCore: pe.voiceCore, voiceVariations: pe.voiceVariations, recentTexts: pe.comments.map((c) => c.content) }),
            memory: { has: false, note: '' },
          })
          if (b.ok) { built = b; break }
        }
        if (built === null || !built.ok) {
          return {
            ok: false,
            reason: roles.length === 0
              ? `${pe.code} 는 이 자리의 역할(${seatGo.roles.join('·')})을 오늘 이미 다 보냈다`
              : `${pe.code} 입력을 만들지 못했다(역할 ${roles.join('·')})`,
          }
        }
        const recentTexts = pe.comments.map((c) => c.content)
        return {
          ok: true,
          value: {
            go: seatGo, recentTexts,
            existing: [
              { text: `${src.title}\n${src.content}`, persona: false },
              ...liveComments.map((c) => ({ text: contentOf.get(c.id) ?? '', persona: c.commentOrigin === 'PERSONA' })),
            ],
            gate: {
              sourceTexts: sourceTextsOf(built.input), knownNames, priorTexts: recentTexts,
              seedUseCount: seedShareByCode.get(pe.code) ?? null, adviceForbidden: isAdviceForbidden(pe.forbiddenReactionRoles),
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
          },
        }
      },
    })
    if (!picked.ok) return picked
    byKey.set(`${postId}\u0000${picked.value.target.facts.personaCode}`, picked.value)
    return { ok: true, plan: { target: picked.value.target, personaId: picked.personaId } }
  }
  // 🔴 생성기는 첫 시도에서 한 번 만든다 — 말투 근거는 고를 수 있는 Persona 전체 기준(자산이 하나라도 있으면 전원 강제)
  let generate: FollowupGenerate | null = null
  const generatorOf = (): FollowupGenerate => {
    if (generate === null) {
      generate = deps.makeGenerate(personaFacts.filter((p) => p.active && !p.realMember && p.profileComplete && p.voiceCapable).map((p) => p.code))
    }
    return generate
  }
  // 🔴 댓글 관문은 첫 댓글과 같은 정본 그대로다(`makeCanonGate` 와 같은 모양 · 완화 없음)
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
  // 🔴 분류기가 쓰는 코드 — 대상 하나씩 부르므로 시도마다 비운다(본문 · 사유 문장이 아니다)
  let lastErrorCode: string | null = null
  let lastWriteCode: string | null = null
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
    lastWriteCode = res.code
    const code = res.errorCode // 🔴 중복은 unique constraint(P2002)가 가른다
    return { created: false, reason: code === 'P2002' ? '🔴 같은 자리(글·순번) 열쇠가 이미 있다(fail-closed)' : res.reason }
  }
  const provider: PipelineProvider = async ({ model: m, input }) => {
    const p = planOf(input)
    if (p === undefined) { lastErrorCode = 'NO_PLAN'; return { ok: false, text: null, errorCode: 'NO_PLAN' } }
    let r: { ok: boolean; text: string | null; errorCode: string | null }
    try { r = await generatorOf()({ model: m, input, recentTexts: p.recentTexts }) } catch {
      lastErrorCode = 'PROVIDER_EXCEPTION'
      return { ok: false, text: null, errorCode: 'PROVIDER_EXCEPTION' }
    }
    // 🔴 본문 중복 · 같은 도입 — 댓글 관문 앞에서 막는다(돈은 썼지만 적재 0)
    if (r.ok && r.text !== null && !judgeFollowupText({ text: r.text, existing: p.existing }).ok) {
      lastErrorCode = 'FOLLOWUP_TEXT_DUP'
      return { ok: false, text: null, errorCode: 'FOLLOWUP_TEXT_DUP' }
    }
    lastErrorCode = r.ok ? null : r.errorCode
    return r
  }
  const attempt: FollowupAttempt = async (target, beforeProvider) => {
    lastErrorCode = null
    lastWriteCode = null
    // 🔴 대상 하나 · 호출 1 · 적재 1 — 다음 대상은 이 결과를 분류한 뒤에 고른다(같은 회차 재선정)
    const result = await runEnqueuePipeline({
      selection: deps.canon.selection, canon: deps.canon.canon, targets: [target],
      preflightOk: providerBlockers.length === 0, preflightBlockers: providerBlockers,
      provider, gate, writer, providerCallLimit: 1, limit: 1, oneCreatedPerPost: true, beforeProvider,
    })
    return { result, errorCode: lastErrorCode, writeCode: lastWriteCode }
  }
  const gen = await runFollowupGeneration({
    store: deps.attemptStore, nowMs, allowed, providerCallBudget: Math.min(tick.providerCallBudget, followupPlanCap(allowed)),
    slots: ordered.map((x) => ({ ...x, postPublishedAtMs: x.publishedAtMs })), isolation: phaseIsolation, planFor, attempt,
  })
  for (const w of gen.warnings) lines.push(w)
  for (const l of gen.lines) lines.push(l)
  if (gen.stoppedReason !== null) lines.push(`생성 멈춤: ${gen.stoppedReason}`)
  for (const o of gen.outcomes) lines.push(`   추가 ${o.personaCode} → 글 ${o.postId.slice(0, 8)} · ${o.step} — ${o.reason}`)
  const sweepAfter = await sweepFollowupLane(prisma, now)
  return {
    outcome: 'RAN', reason: tick.detail, sweepBefore, sweepAfter, goPosts: ready.length,
    providerCalls: gen.providerCalls, enqueued: gen.created, outcomes: gen.outcomes, lines,
  }
}
