#!/usr/bin/env tsx
/**
 * 🔴 **단계 승격 운영 증거 — 실제 DB 읽기 · controller 실제 진입점** (2026-09-29 P0 · 격리 Postgres 전용)
 *
 *   ① 실제 행(StageDecision · Queue · Post · Comment · PersonaActivityLog · AutoReadyAudit)을 심고
 *      `readStageEvidenceFacts` → `judgeStageEvidence` 가 PASS 를 낸다
 *   ② 행 하나씩 비틀면(댓글 없음 · 61분 · 지운 댓글 · 자기 글 댓글 · 감사 미판정/시한 초과 · 결함 yes · 표본 0 ·
 *      표본이 자동 target 밖 · 발행 기록 중복 · 같은 Persona 두 번 · 표식 없는 발행 · 편수 부족 · 사람 승인만/혼합 ·
 *      HOLD 결정 · 기록 없는 발행 · 고아 기록) PASS 가 아니다 · 글당 댓글·타인 3명 통과선은 표(`ladder-table.ts`)에서 읽는다
 *   ③ 발행 트랜잭션이 무인 표식을 실제로 남긴다(예약 · unattended) · 수동 단건은 남기지 않는다
 *   ④ `scripts/stage-controller.mts --json` (dry-run · 2026-11-19 사다리 재설계) — 전날 미달이어도 공개 단계 유지 ·
 *      PASS 이틀 연속이면 올림 계획 · 올라갈 칸의 Persona 관문(격리 DB 는 계약 유효 Persona 0)이 막으면 유지 ·
 *      옛 되돌림 행(PREPARE 아래 칸)에서 이틀 전 열린 단계를 되찾는다 · `--evidence-date` 미리보기는 DB write 0
 *   ④-b (2026-10-11 Batch A3) 첫 댓글 증거는 Comment ↔ Queue(무인 표식) ↔ ActivityLog 세 행이 맞물린 것만 — 하나씩 비튼다
 *   ④-c (2026-10-13 · PR #704 E1) 추가 댓글 실제 행 — 추가 표식 답글은 글당 댓글에 든다 · 연결이 깨지면 출처 깨짐(무결성) ·
 *      표식이 섞이면 첫 댓글 축 broken · 연결 없는 수동 Persona 댓글은 사람 손(COMMENT_MANUAL_PERSONA)이다
 *   ⑤ 옛 행 판독 · D20 진입점 — env 단계 키(SORAN_*_STAGE)는 결정에 영향이 없다
 *   ⑥ (2026-09-30 · 조항 ⑦) 발행 도장 — 도장 없는 발행 → RELEASE_CONTRACT_MISSING · 옛/ineligible 도장 → STALE_RELEASE
 *
 * 🔴 운영 DB 에 절대 붙이지 않는다 — sentinel · localhost · 고정 DB 이름을 요구한다. provider 0.
 * 🔴 HOME 을 임시 디렉터리로 바꿔 controller 를 돌린다 — 정본 env · 장부가 전부 가짜 HOME 안이다.
 * 세우는 법은 `stage-decision-db-check.mts` 맨 위 주석과 같다 (SORAN_ISOLATED_DB=yes-throwaway · soran_test).
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PrismaClient, type Prisma } from '@prisma/client'

import { kstDateString } from '../src/lib/release-canary'
import { previousKstDate, validateStoredDecision, STAGE_DECISION_VERSION, DECISION_WRITER, type ValidatedStageDecision } from '../src/lib/stage-decision-contract'
import { createStageDecision } from '../src/lib/stage-decision-repo'
import { kstDayBounds, readStageEvidenceFacts } from '../src/lib/stage-evidence-repo'
import { publishLatencyHours } from './lib/stage-preflight-facts.mjs'
import {
  judgeStageEvidence, evidenceReasonOf, FOLLOWUP_LANE_DECIDED_BY, FOLLOWUP_LANE_ACTIVITY_DECIDED_BY,
  type StageEvidenceVerdict, type EvidenceSideSignals,
} from '../src/lib/stage-evidence'
import { UNATTENDED_PUBLISH_DECIDED_BY, publishOriginalPostTx } from '../src/lib/original-post-publish-tx'
import { AUTO_LANE_DECIDED_BY, AUTO_LANE_ACTIVITY_DECIDED_BY } from '../src/lib/persona-comment-auto-lane'
import { AUDIT_OVERDUE_MS } from '../src/lib/auto-ready-audit-store'
import { AUTOFILL_PROMPT_VERSION, AUTOFILL_MODEL, AUTOFILL_SITE_PREFIX } from '../src/lib/micro-seed-supply-autofill'
import { AUTO_DECIDER, digestOf } from '../src/lib/auto-ready-v2'
import {
  DEFECT_RESOLUTION_KEY, DEFECT_RESOLVER, SEMANTIC_DEFECT_RESOLUTION_RECORD_VERSION,
  auditFingerprintOf, reverifyInputDigestOf,
} from '../src/lib/auto-ready-defect-resolution'
import {
  SEMANTIC_AUDITOR, SEMANTIC_AUDIT_CONTRACT_VERSION, SEMANTIC_AUDIT_MODEL, SEMANTIC_AUDIT_PROMPT_VERSION,
} from '../src/lib/auto-ready-semantic-audit'
import { currentQualityContract } from '../src/lib/quality-contract'
import { observeJob } from './lib/runner-health.mjs'
import { consecutivePassDays } from '../src/lib/stage-ladder'
import { LADDER_RULE, commentDepthFloorOf } from '../src/lib/ladder-table'
import { THREAD_SIZE_CAP, threadMeanSizeAt, threadSizeMaxOf } from '../src/lib/persona-thread-target'
import { unresolvedDefectCount } from '../src/lib/auto-ready-repo'
import { judgeSlotRelease, publishEventAtOf, releaseStampOf, releaseStampStatusOf, RELEASE_STAMP_KEY } from '../src/lib/source-slot-release'
import { fakeEvidenceGate } from './lib/fake-source-evidence.mjs'
import { appendLedgerLine, ledgerDirForHome, ledgerPathOf } from './lib/llm-ledger-store.mjs'
import type { LedgerEntry } from '../src/lib/llm-ledger'
import { PRICING_VERSION } from '../src/lib/llm-pricing'
import { SUPPLY_JIT_CONTRACT } from '../src/lib/supply-intent'
import { supplyRunIdOf } from '../src/lib/supply-run-token'
import { SUPPLY_RUN_SLOTS_KST } from '../src/lib/supply-schedule-contract'

const URL = process.env.DATABASE_URL ?? ''
const problems: string[] = []
if ((process.env.SORAN_ISOLATED_DB ?? '').trim() !== 'yes-throwaway') problems.push('SORAN_ISOLATED_DB=yes-throwaway 가 없다')
if (!/^postgresql:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\//.test(URL)) problems.push('DATABASE_URL 이 localhost 주소가 아니다')
if (!/\/soran_test(\?|$)/.test(URL)) problems.push('DATABASE_URL 의 DB 이름이 soran_test 가 아니다')
if (problems.length > 0) {
  // 🔴 값이 아니라 무엇이 틀렸는지만 적는다
  console.error('🔴 격리 DB 가 아니다. 멈춘다.')
  for (const p of problems) console.error(`   · ${p}`)
  process.exit(2)
}

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

const prisma = new PrismaClient()
const NOW = new Date()
const TODAY = kstDateString(NOW)
const D = previousKstDate(TODAY)!
const D_PREV = previousKstDate(D)!
const MIN = 60_000
// 🔴 대화 마감(공개 뒤 8시간)이 그날 안에 닫히는 시각 — 이 검사를 자정 직후에 돌려도 결의 분모가 같다
const slotsOf = (day: string): Date[] => ['09:30', '11:30', '13:30'].map((hm) => new Date(`${day}T${hm}:00+09:00`))
const SLOTS = slotsOf(D)
const SIDE_OK: EvidenceSideSignals = {
  cost: [
    { lane: 'comment', name: '댓글 장부', health: 'ok' },
    { lane: 'audit', name: '감사 장부', health: 'ok' },
  ],

  supplyCostEvidence: {

    wholeDayCriticalHealth: 'ok',
    envelope: { settledRequests: 20, usageUnknownRequests: 0, overrunRequests: 0, ineligibleRequests: 0, riskUsd: 0.08, budgetUsd: 1 },
  },
}

/** 🔴 격리 DB 청소 — FK 순서대로. raw SQL 0 */
/**
 * 🔴 **무인 레인이 남기는 세 행 그대로** (2026-10-11 Batch A3) — Comment · PersonaApprovalQueue(PUBLISHED ·
 *    `AUTO_LANE_DECIDED_BY` · `publishedCommentId`) · PersonaActivityLog(`kind=comment` · `targetId` · `auto`).
 *    `publishCandidateTx({ autoLane: true })` 와 같은 모양이다 — 결정 시각 = 로그 발행 시각 = 그 회차의 now.
 *    🔴 맨 댓글(`prisma.comment.create` 만)은 이제 첫 댓글 증거가 아니다 — 사람이 낸 Persona 댓글과 구별할 수 없다.
 */
let linkSeq = 0
async function autoComment(args: { data: Prisma.CommentUncheckedCreateInput & { personaId: string; createdAt: Date }; select?: { id: true } }): Promise<{ id: string }> {
  const c = await prisma.comment.create({ data: args.data, select: { id: true } })
  linkSeq += 1
  const at = args.data.createdAt
  await prisma.personaApprovalQueue.create({ data: {
    personaId: args.data.personaId, targetPostId: args.data.postId, status: 'PUBLISHED', candidateText: 'fx', reactionType: 'empathy',
    gateStatus: 'pass', gateResults: [], dedupKey: `ev-link-${linkSeq}-${c.id}`,
    decidedBy: AUTO_LANE_DECIDED_BY, decidedAt: at, publishedCommentId: c.id,
  } })
  await prisma.personaActivityLog.create({ data: {
    personaId: args.data.personaId, kind: 'comment', targetId: c.id, gateStatus: 'pass',
    decidedBy: AUTO_LANE_ACTIVITY_DECIDED_BY, publishedAt: at, createdAt: at,
  } })
  return c
}

/**
 * 🔴 **추가 댓글 레인이 남길 세 행** (2026-10-13 · PR #704 E1) — 첫 댓글과 같은 모양 · 표식만 `FOLLOWUP_LANE_*` 다.
 *    `parentId` 로 첫 댓글에 답한다. 결정 시각 = 로그 발행 시각 = 댓글 시각.
 */
async function followupComment(postId: string, parentId: string | null, createdAt: Date,
  marks: { queue: string; log: string } = { queue: FOLLOWUP_LANE_DECIDED_BY, log: FOLLOWUP_LANE_ACTIVITY_DECIDED_BY }): Promise<{ id: string; personaId: string }> {
  const personaId = await persona(`F-${seq}-${linkSeq}`)
  const u = (await prisma.persona.findUniqueOrThrow({ where: { id: personaId }, select: { userId: true } })).userId
  const c = await prisma.comment.create({ data: { content: '그 얘기 더 듣고 싶어요', source: 'SYSTEM', commentOrigin: 'PERSONA', postId,
    parentId, authorId: u, personaId, createdAt }, select: { id: true } })
  linkSeq += 1
  await prisma.personaApprovalQueue.create({ data: {
    personaId, targetPostId: postId, status: 'PUBLISHED', candidateText: 'fx', reactionType: 'question',
    gateStatus: 'pass', gateResults: [], dedupKey: `ev-fu-${linkSeq}-${c.id}`,
    decidedBy: marks.queue, decidedAt: createdAt, publishedCommentId: c.id,
  } })
  await prisma.personaActivityLog.create({ data: {
    personaId, kind: 'comment', targetId: c.id, gateStatus: 'pass', decidedBy: marks.log, publishedAt: createdAt, createdAt,
  } })
  return { id: c.id, personaId }
}

async function wipe(): Promise<void> {
  await prisma.autoReadyAudit.deleteMany({})
  await prisma.report.deleteMany({})
  await prisma.comment.deleteMany({})
  await prisma.personaApprovalQueue.deleteMany({})
  await prisma.personaActivityLog.deleteMany({})
  await prisma.originalPostApprovalQueue.deleteMany({})
  await prisma.post.deleteMany({})
  await prisma.microSeedRawContent.deleteMany({})
  await prisma.persona.deleteMany({})
  await prisma.user.deleteMany({})
  await prisma.stageDecision.deleteMany({})
}

const decisionRow = (kstDate: string, o: Record<string, unknown>): Record<string, unknown> => ({
  kstDate, capacity: 'd10', release: 'd1', state: 'HOLD', reasons: ['fixture'], blocks: [], dayPinned: false, supply: null,
  decidedAt: new Date(`${kstDate}T07:00:00+09:00`).toISOString(), contractVersion: STAGE_DECISION_VERSION,
  decidedBy: DECISION_WRITER, transition: null, ...o,
})
/** 올린 날의 행 모양 — TRIAL d3 · 기반 d1 */
const TRIAL_D3 = { release: 'd3', state: 'TRIAL', transition: { kind: 'TRIAL', trialBase: 'd1', previousKstDate: D_PREV, target: 'd3' } }

async function storeDecision(o: Record<string, unknown>, day: string = D): Promise<ValidatedStageDecision> {
  const v = validateStoredDecision({ row: decisionRow(day, o), expectKstDate: day })
  if (!v.ok) throw new Error(`fixture 결정이 깨졌다 — ${v.reason}`)
  await createStageDecision(prisma, v.decision)
  return v.decision
}

let seq = 0
/**
 * 🔴 **발행 트랜잭션이 남기는 모양 그대로의 gateResults** — 원문 증거 + 그 시각 정본 판정의 도장(source-slot-v1).
 *    도장은 손으로 적지 않는다: 같은 증거를 `judgeSlotRelease` 에 넣어 나온 판정을 `releaseStampOf` 로 옮긴다.
 */
const publishedGate = (t: Date, id: string): Record<string, unknown> => {
  const ev = fakeEvidenceGate(t, { id })
  const v = judgeSlotRelease({ gateResults: ev, slotAt: t, now: t, hardGates: { ok: true, codes: [] }, assignment: { ok: true }, tieBreak: id })
  return { ...ev, [RELEASE_STAMP_KEY]: releaseStampOf(v) }
}
async function persona(code: string): Promise<string> {
  const u = await prisma.user.create({ data: { nickname: `ev${code}` }, select: { id: true } })
  return (await prisma.persona.create({ data: { code, userId: u.id, status: 'active' }, select: { id: true } })).id
}
async function rawRow(capturedAt: Date): Promise<string> {
  seq += 1
  return (await prisma.microSeedRawContent.create({
    data: { origin: 'live', sourceSite: `${AUTOFILL_SITE_PREFIX}fixture`, sourceUrl: `https://example.invalid/ev${seq}`,
      sourceArticleId: `${9000 + seq}-ev`, sourceCapturedAt: capturedAt, rawTitle: `원문 ${seq}`, rawBody: `원문 본문 ${seq}` },
    select: { id: true },
  })).id
}

type Seeded = { posts: string[]; authors: string[]; commenters: string[]; comments: string[]; logs: string[]; queues: string[] }

/**
 * 🔴 **글당 댓글 수(첫 댓글 포함)는 그 글 공개 시각의 정본 통과선에서 낸다** — 숫자를 박지 않는다.
 *    통과선 = `commentDepthFloorOf(threadMeanSizeAt(공개 시각))`, 그 선에 닿는 가장 작은 정수다(판정의 `below` 와 같은 1e-9).
 *    앞판은 6(첫 1 + 추가 5)을 박아 두었다 — `THREAD_TARGETS` 에 11-26 줄(평균 7 · 통과선 6.3)이 붙자
 *    증거 날짜가 그 줄을 넘은 날(11-27)부터 깨끗한 하루가 COMMENT_DEPTH_SHORT 가 됐다(11-28 사슬).
 */
const passingDepthAt = (publishedAt: Date): number =>
  Math.ceil(commentDepthFloorOf(threadMeanSizeAt(publishedAt.getTime())) - 1e-9)
/** 그날 깨끗한 하루의 글당 댓글 평균 — 판정과 같은 반올림(`round2`) */
const depthAvgOf = (day: string): number =>
  Math.round((slotsOf(day).reduce((n, t) => n + passingDepthAt(t), 0) / slotsOf(day).length) * 100) / 100

/**
 * 🔴 하루 — 무인 발행 3건(자동 READY 도장 행) · 글마다 5분 뒤 다른 Persona 첫 댓글 1건 + 서로 다른 화자의 추가 댓글
 *    (`depthOf(공개 시각)` − 1건 · 기본은 정본 통과선에 닿는 수) · 감사 1건(판정 no) = 정본 표본 ceil(3×0.2)=1.
 *    기본값이면 수와 결의 통과선을 넘는 하루다.
 */
async function seedDay(n = 3, decidedBy: string | null = AUTO_DECIDER, day: string = D,
  depthOf: (publishedAt: Date) => number = passingDepthAt): Promise<Seeded> {
  const DAY_SLOTS = slotsOf(day)
  const s: Seeded = { posts: [], authors: [], commenters: [], comments: [], logs: [], queues: [] }
  for (let i = 0; i < n; i += 1) {
    const author = await persona(`A${i}-${seq}`)
    const commenter = await persona(`C${i}-${seq}`)
    const authorUser = (await prisma.persona.findUniqueOrThrow({ where: { id: author }, select: { userId: true } })).userId
    const commenterUser = (await prisma.persona.findUniqueOrThrow({ where: { id: commenter }, select: { userId: true } })).userId
    const t = DAY_SLOTS[i]!
    const post = await prisma.post.create({
      data: { boardType: 'FREE', title: `저녁 산책 ${i}`, content: `동네 한 바퀴 ${i}`, source: 'SYSTEM', authorId: authorUser, personaId: author, createdAt: t },
      select: { id: true },
    })
    const q = await prisma.originalPostApprovalQueue.create({
      data: { sourceRawContentId: await rawRow(t), status: 'PUBLISHED', draftTitle: `저녁 산책 ${i}`, draftBody: `동네 한 바퀴 ${i}`,
        gateVerdict: 'PASS', gateResults: publishedGate(t, `ev-${seq}-${i}`) as never, promptVersion: AUTOFILL_PROMPT_VERSION, model: AUTOFILL_MODEL,
        decidedBy, dedupKey: `ev-${seq}-${i}`, createdPostId: post.id, matchedPersonaId: author },
      select: { id: true },
    })
    const log = await prisma.personaActivityLog.create({
      data: { personaId: author, kind: 'post', targetId: post.id, gateStatus: 'PASS', decidedBy: UNATTENDED_PUBLISH_DECIDED_BY, publishedAt: t, createdAt: t },
      select: { id: true },
    })
    const c = await autoComment({
      data: { content: '저도 저녁에 걸어요', source: 'SYSTEM', commentOrigin: 'PERSONA', postId: post.id, authorId: commenterUser,
        personaId: commenter, createdAt: new Date(t.getTime() + 5 * MIN) },
      select: { id: true },
    })
    for (let k = 0; k < depthOf(t) - 1; k += 1) await followupComment(post.id, null, new Date(t.getTime() + (k + 2) * 15 * MIN))
    s.posts.push(post.id); s.authors.push(author); s.commenters.push(commenter); s.comments.push(c.id); s.logs.push(log.id); s.queues.push(q.id)
  }
  if (n > 0 && decidedBy === AUTO_DECIDER) {
    await prisma.autoReadyAudit.create({
      data: { queueId: s.queues[0]!, postId: s.posts[0]!, selectedAtN: n, selectedTarget: 1, selectedAt: new Date(DAY_SLOTS[0]!.getTime() + 30 * MIN),
        publishedTitleHash: 'a'.repeat(64), publishedBodyHash: 'b'.repeat(64), stampContractDigest: 'd',
        defect: 'no', judgedAt: new Date(DAY_SLOTS[0]!.getTime() + 40 * MIN), auditor: 'machine:fixture',
        auditContractVersion: 'v', auditModel: 'm', auditPromptVersion: 'p' },
    })
  }
  return s
}

async function verdictOf(decision: ValidatedStageDecision | null): Promise<StageEvidenceVerdict> {
  const facts = await readStageEvidenceFacts(prisma, { kstDate: D, stage: 'd3', decision, now: NOW })
  return judgeStageEvidence(D, 'd3', facts, SIDE_OK)
}
const has = (v: StageEvidenceVerdict, c: string): boolean => (v.codes as readonly string[]).includes(c)

/** 🔴 한 반례 = 깨끗한 하루를 새로 심고, 행 하나만 비튼다 */
async function counter(name: string, code: string, mutate: (s: Seeded) => Promise<void>, decisionOverride?: Record<string, unknown>): Promise<void> {
  await wipe()
  const decision = await storeDecision(decisionOverride ?? TRIAL_D3)
  const s = await seedDay()
  await mutate(s)
  const v = await verdictOf(decision)
  check(name, v.verdict !== 'PASS' && has(v, code), `${v.verdict} ${v.codes.join(',')}`)
}

const HOME = mkdtempSync(join(tmpdir(), 'stage-ev-home-'))
try {
  console.log('\n══ 단계 승격 운영 증거 — 격리 DB ══')
  console.log(`   증거 날짜 ${D} · 결정 날짜 ${TODAY}`)

  console.log('\n① 깨끗한 D3 하루 → PASS')
  await wipe()
  const dec = await storeDecision(TRIAL_D3)
  await seedDay()
  const base = await verdictOf(dec)
  check('🟢 실제 행 6조건 → PASS', base.verdict === 'PASS', `${base.verdict} ${base.codes.join(',')}`)
  check('편수 3 · 자동 target 3 · 첫 댓글 3 · 감사 기대 ceil(3×20%)=1 · 표본 1', base.counts.published === 3 && base.counts.autoTargets === 3
    && base.counts.firstCommentOk === 3 && base.counts.auditExpected === 1
    && base.counts.auditSampled === 1, JSON.stringify(base.counts))
  check(`🟢 결 — 글당 댓글 ${depthAvgOf(D)}(그 글 공개 시각의 통과선 ${base.counts.commentDepthFloor} 에 닿는 수) · 타인 3명 3편 · 수집 시각을 큐 행에서 읽었다`,
    base.counts.commentDepthAvg === depthAvgOf(D) && base.counts.threeVoicesPosts === 3 && base.counts.collectKnown === 3, JSON.stringify(base.counts))
  check('fixture 전제 — 글당 댓글 수가 그 줄의 크기 상한 · 글당 구조 상한(`THREAD_SIZE_CAP`) 안이다(실제 러너보다 강하지 않다)',
    SLOTS.every((t) => passingDepthAt(t) <= threadSizeMaxOf(threadMeanSizeAt(t.getTime())) && passingDepthAt(t) <= THREAD_SIZE_CAP),
    SLOTS.map((t) => `${passingDepthAt(t)}/${threadSizeMaxOf(threadMeanSizeAt(t.getTime()))}/${THREAD_SIZE_CAP}`).join(' '))
  check('🟢 그 하루는 열린 단계 d3 의 연속 통과 1일이다', consecutivePassDays(TODAY, 'd3', [{ decision: dec, evidence: base }]) === 1)
  {
    // 🔴 글당 댓글 미달 — 글마다 정본 통과선에 닿는 수보다 하나 적다. 다른 축은 그대로 통과선 위다
    await wipe()
    const dShort = await storeDecision(TRIAL_D3)
    await seedDay(3, AUTO_DECIDER, D, (t) => passingDepthAt(t) - 1)
    const v = await verdictOf(dShort)
    const floorD = Math.round(commentDepthFloorOf(SLOTS.reduce((n, t) => n + threadMeanSizeAt(t.getTime()), 0) / SLOTS.length) * 100) / 100
    check('🔴 글당 댓글이 공개 시각 통과선 바로 아래 → COMMENT_DEPTH_SHORT 하나만(타인 3명 · 첫 댓글은 그대로 통과) · 통과선은 그 글들의 줄',
      v.verdict === 'FAIL' && v.codes.length === 1 && has(v, 'COMMENT_DEPTH_SHORT') && v.counts.threeVoicesPosts === 3
      && v.counts.firstCommentOk === 3 && v.counts.commentDepthFloor === floorD,
      `${v.verdict} ${v.codes.join(',')} ${JSON.stringify(v.counts)}`)
  }

  console.log('\n② 행 하나씩 비틀면 PASS 가 아니다')
  await counter('🔴 09:30 글 첫 댓글 삭제(행 없음) → FIRST_COMMENT_SHORT', 'FIRST_COMMENT_SHORT', async (s) => {
    await prisma.comment.delete({ where: { id: s.comments[0]! } })
  })
  // ── 🔴 자동 첫 댓글 출처 (2026-10-11 Batch A3) — 실제 세 행을 하나씩 비튼다 ──
  await counter('🔴 반례⑧ 그 댓글이 사람(운영자) 발행이다(Queue 사람 표식 · 로그 operator) → 자동 증거 0 · COMMENT_MANUAL_PERSONA', 'COMMENT_MANUAL_PERSONA', async (s) => {
    await prisma.personaApprovalQueue.updateMany({ where: { publishedCommentId: s.comments[0]! }, data: { decidedBy: 'admin:fixture' } })
    await prisma.personaActivityLog.updateMany({ where: { kind: 'comment', targetId: s.comments[0]! }, data: { decidedBy: 'operator' } })
  })
  await counter('🔴 반례⑧ 연결 행 없는 맨 PERSONA 댓글 → 자동 증거 0 · COMMENT_MANUAL_PERSONA', 'COMMENT_MANUAL_PERSONA', async (s) => {
    await prisma.personaApprovalQueue.deleteMany({ where: { publishedCommentId: s.comments[0]! } })
    await prisma.personaActivityLog.deleteMany({ where: { kind: 'comment', targetId: s.comments[0]! } })
  })
  await counter('🔴 반례⑩ ActivityLog 없음 → COMMENT_PROVENANCE_BROKEN', 'COMMENT_PROVENANCE_BROKEN', async (s) => {
    await prisma.personaActivityLog.deleteMany({ where: { kind: 'comment', targetId: s.comments[0]! } })
  })
  await counter('🔴 반례⑩ 로그 targetId 가 다른 댓글을 가리킨다 → COMMENT_PROVENANCE_BROKEN', 'COMMENT_PROVENANCE_BROKEN', async (s) => {
    await prisma.personaActivityLog.updateMany({ where: { kind: 'comment', targetId: s.comments[0]! }, data: { targetId: s.comments[1]! } })
  })
  await counter('🔴 반례⑩ 표식 불일치(Queue 무인 · 로그 operator) → COMMENT_PROVENANCE_BROKEN', 'COMMENT_PROVENANCE_BROKEN', async (s) => {
    await prisma.personaActivityLog.updateMany({ where: { kind: 'comment', targetId: s.comments[0]! }, data: { decidedBy: 'operator' } })
  })
  await counter('🔴 반례⑩ 같은 댓글 로그 두 줄 → COMMENT_PROVENANCE_BROKEN', 'COMMENT_PROVENANCE_BROKEN', async (s) => {
    const l = await prisma.personaActivityLog.findFirstOrThrow({ where: { kind: 'comment', targetId: s.comments[0]! },
      select: { personaId: true, publishedAt: true } })
    await prisma.personaActivityLog.create({ data: { personaId: l.personaId, kind: 'comment', targetId: s.comments[0]!, gateStatus: 'pass',
      decidedBy: AUTO_LANE_ACTIVITY_DECIDED_BY, publishedAt: l.publishedAt } })
  })
  await counter('🔴 반례⑩ Queue 대상 글 ≠ 댓글 글 → COMMENT_PROVENANCE_BROKEN', 'COMMENT_PROVENANCE_BROKEN', async (s) => {
    await prisma.personaApprovalQueue.updateMany({ where: { publishedCommentId: s.comments[0]! }, data: { targetPostId: s.posts[1]! } })
  })
  await counter('🔴 반례⑩ 결정 시각 ≠ 로그 발행 시각 → COMMENT_PROVENANCE_BROKEN', 'COMMENT_PROVENANCE_BROKEN', async (s) => {
    await prisma.personaApprovalQueue.updateMany({ where: { publishedCommentId: s.comments[0]! }, data: { decidedAt: new Date(SLOTS[0]!.getTime() + 3 * MIN) } })
  })
  await counter('🔴 지운 댓글(isDeleted)은 세지 않는다 → FIRST_COMMENT_SHORT', 'FIRST_COMMENT_SHORT', async (s) => {
    await prisma.comment.update({ where: { id: s.comments[0]! }, data: { isDeleted: true } })
  })
  await counter('🔴 첫 댓글이 판정 창을 1분 넘겨 달렸다 → FIRST_COMMENT_SHORT', 'FIRST_COMMENT_SHORT', async (s) => {
    await prisma.comment.update({ where: { id: s.comments[0]! }, data: { createdAt: new Date(SLOTS[0]!.getTime() + LADDER_RULE.firstCommentWindowMs + MIN) } })
  })
  const secondPersonaComment = async (s: Seeded): Promise<void> => {
    const other = await persona(`X-${seq}`)
    const u = (await prisma.persona.findUniqueOrThrow({ where: { id: other }, select: { userId: true } })).userId
    await autoComment({ data: { content: '저도요', source: 'SYSTEM', commentOrigin: 'PERSONA', postId: s.posts[0]!, authorId: u,
      personaId: other, createdAt: new Date(SLOTS[0]!.getTime() + 20 * MIN) } })
  }
  {
    await wipe()
    const d2 = await storeDecision(TRIAL_D3)
    const s2 = await seedDay()
    await secondPersonaComment(s2)
    const v = await verdictOf(d2)
    check('🟢 첫 댓글 레인의 두 번째 Persona 댓글은 결함이 아니다 — PASS', v.verdict === 'PASS', `${v.verdict} ${v.codes.join(',')}`)
  }

  console.log('\n④-c 🔴 추가 댓글 실제 행 — 첫 댓글과 다른 축 · 출처 깨짐은 하루 판정도 막는다')
  const thread = async (n: number): Promise<{ d: ValidatedStageDecision; s: Seeded; fu: { id: string; personaId: string }[] }> => {
    await wipe()
    const d = await storeDecision(TRIAL_D3)
    const s = await seedDay()
    const fu: { id: string; personaId: string }[] = []
    let parentId = s.comments[0]!
    for (let k = 0; k < n; k += 1) {
      const row = await followupComment(s.posts[0]!, parentId, new Date(SLOTS[0]!.getTime() + (90 + 40 * k) * MIN))
      fu.push(row)
      parentId = row.id
    }
    return { d, s, fu }
  }
  {
    const { d } = await thread(4)
    const v = await verdictOf(d)
    check('🟢 자동 첫 댓글 1 + 추가 답글 4 → PASS', v.verdict === 'PASS', `${v.verdict} ${v.codes.join(',')}`)
    const numerator = SLOTS.reduce((n, t) => n + passingDepthAt(t), 0) + 4
    check(`그때 counts — 첫 댓글 3 · 글당 댓글의 분자 ${numerator}(글마다 공개 시각 통과선에 닿는 수 + 답글 4) · 수동 0 · 대화 감사 PASS`,
      v.counts.firstCommentOk === 3 && v.counts.personaComments === numerator
      && v.counts.manualPersonaOnTargets === 0 && v.conversation?.verdict === 'PASS', `${JSON.stringify(v.counts)} ${JSON.stringify(v.conversation)}`)
  }
  {
    const { d, fu } = await thread(2)
    await prisma.personaActivityLog.deleteMany({ where: { kind: 'comment', targetId: fu[1]!.id } })
    const v = await verdictOf(d)
    check('🔴 추가 댓글 로그 없음 → 하루 판정 FAIL COMMENT_PROVENANCE_BROKEN(글당 댓글의 근거가 깨졌다) · 첫 댓글 3 은 그대로',
      v.verdict === 'FAIL' && has(v, 'COMMENT_PROVENANCE_BROKEN') && v.counts.firstCommentOk === 3,
      `${v.verdict} ${v.codes.join(',')}`)
    check('🔴 그때 대화 감사 FAIL — FOLLOWUP_PROVENANCE_BROKEN · 이유 줄에 따로 남는다',
      v.conversation?.verdict === 'FAIL' && v.conversation.codes.includes('FOLLOWUP_PROVENANCE_BROKEN')
      && evidenceReasonOf(v).endsWith('CONVERSATION FAIL [FOLLOWUP_PROVENANCE_BROKEN]'), evidenceReasonOf(v))
  }
  {
    const { d, fu } = await thread(1)
    await prisma.personaActivityLog.updateMany({ where: { kind: 'comment', targetId: fu[0]!.id }, data: { decidedBy: AUTO_LANE_ACTIVITY_DECIDED_BY } })
    const v = await verdictOf(d)
    check('🔴 표식 섞임(Queue 추가 · 로그 첫 댓글) → 첫 댓글 축 COMMENT_PROVENANCE_BROKEN FAIL',
      v.verdict === 'FAIL' && has(v, 'COMMENT_PROVENANCE_BROKEN'), `${v.verdict} ${v.codes.join(',')}`)
  }
  {
    const { d, s } = await thread(1)
    const fuPersona = (await prisma.comment.findFirstOrThrow({ where: { postId: s.posts[0]!, parentId: s.comments[0]! }, select: { personaId: true } })).personaId
    await prisma.comment.updateMany({ where: { postId: s.posts[0]!, parentId: s.comments[0]! }, data: { personaId: s.commenters[0]! } })
    const v = await verdictOf(d)
    check('🔴 추가 댓글 Persona 를 첫 댓글 Persona 로 바꾸면 연결이 깨진다 → 하루 판정 FAIL · 대화 감사 FAIL',
      fuPersona !== null && has(v, 'COMMENT_PROVENANCE_BROKEN') && v.conversation?.verdict === 'FAIL', `${v.verdict} ${JSON.stringify(v.conversation)}`)
  }
  {
    const { d } = await thread(6)
    const v = await verdictOf(d)
    check('🔴 실제 DB 사슬 깊이 7 → 단계 판정은 유지 · 대화 감사 FOLLOWUP_CHAIN_OVER_DEPTH',
      v.verdict === 'PASS' && v.conversation?.codes.includes('FOLLOWUP_CHAIN_OVER_DEPTH') === true,
      `${v.verdict} ${JSON.stringify(v.conversation)}`)
  }
  {
    const { d, s, fu } = await thread(2)
    await prisma.comment.update({ where: { id: fu[1]!.id }, data: { parentId: s.comments[0]! } })
    const v = await verdictOf(d)
    check('🔴 실제 DB 같은 답글 대상 재소비 → 대화 감사 FOLLOWUP_TARGET_REUSED',
      v.conversation?.codes.includes('FOLLOWUP_TARGET_REUSED') === true, JSON.stringify(v.conversation))
  }
  {
    const { d, s } = await thread(1)
    const reporter = await prisma.user.findFirstOrThrow({ select: { id: true } })
    await prisma.report.create({ data: {
      reporterId: reporter.id, commentId: s.comments[0]!, reason: 'fixture',
      createdAt: new Date(SLOTS[0]!.getTime() + 20 * MIN),
    } })
    const v = await verdictOf(d)
    check('🔴 실제 DB 발행 전 신고된 답글 대상 → 대화 감사 FOLLOWUP_TARGET_INVALID',
      v.conversation?.codes.includes('FOLLOWUP_TARGET_INVALID') === true, JSON.stringify(v.conversation))
  }
  {
    const { d, s } = await thread(1)
    const reporter = await prisma.user.findFirstOrThrow({ select: { id: true } })
    await prisma.report.create({ data: {
      reporterId: reporter.id, commentId: s.comments[0]!, reason: 'later-fixture',
      createdAt: new Date(SLOTS[0]!.getTime() + 300 * MIN),
    } })
    const v = await verdictOf(d)
    check('🟢 실제 DB Persona 답글 발행 뒤 신고는 과거 대화를 소급 실패로 바꾸지 않음',
      v.conversation?.verdict === 'PASS', JSON.stringify(v.conversation))
  }
  {
    const { d, s } = await thread(1)
    const member = await prisma.user.create({ data: { nickname: `later-member-${seq}` }, select: { id: true } })
    await prisma.comment.create({ data: {
      content: '늦게 합류한 회원 답글', source: 'USER', commentOrigin: 'MEMBER', postId: s.posts[0]!,
      parentId: s.comments[0]!, authorId: member.id, createdAt: new Date(SLOTS[0]!.getTime() + 300 * MIN),
    } })
    const v = await verdictOf(d)
    check('🟢 실제 DB Persona 답글 발행 뒤 실회원의 같은 대상 답글은 소급 재소비가 아님',
      v.conversation?.verdict === 'PASS', JSON.stringify(v.conversation))
  }
  {
    const { d, s } = await thread(1)
    const member = await prisma.user.create({ data: { nickname: `early-member-${seq}` }, select: { id: true } })
    await prisma.comment.create({ data: {
      content: '먼저 소비한 회원 답글', source: 'USER', commentOrigin: 'MEMBER', postId: s.posts[0]!,
      parentId: s.comments[0]!, authorId: member.id, createdAt: new Date(SLOTS[0]!.getTime() + 60 * MIN),
    } })
    const v = await verdictOf(d)
    check('🔴 실제 DB Persona 답글 발행 전 대상을 먼저 소비한 답글은 FOLLOWUP_TARGET_REUSED',
      v.conversation?.codes.includes('FOLLOWUP_TARGET_REUSED') === true, JSON.stringify(v.conversation))
  }
  {
    const { d, fu } = await thread(2)
    await prisma.comment.update({ where: { id: fu[0]!.id }, data: { isDeleted: true } })
    const v = await verdictOf(d)
    check('🟢 실제 DB 정상 발행 뒤 중간 Persona 답글을 삭제해도 사슬 사실은 보존',
      v.conversation?.verdict === 'PASS', JSON.stringify(v.conversation))
  }
  await counter('🔴 연결 없는 수동 Persona 댓글이 자동 글에 있다 → COMMENT_MANUAL_PERSONA', 'COMMENT_MANUAL_PERSONA', async (s) => {
    const other = await persona(`M-${seq}`)
    const u = (await prisma.persona.findUniqueOrThrow({ where: { id: other }, select: { userId: true } })).userId
    await prisma.comment.create({ data: { content: '수동', source: 'SYSTEM', commentOrigin: 'PERSONA', postId: s.posts[0]!, authorId: u,
      personaId: other, createdAt: new Date(SLOTS[0]!.getTime() + 2 * 60 * MIN) } })
  })

  await counter('🔴 🔴 **자동 READY 3건인데 감사 행 0 → AUDIT_COVERAGE_SHORT**', 'AUDIT_COVERAGE_SHORT', async (s) => {
    await prisma.autoReadyAudit.delete({ where: { queueId: s.queues[0]! } })
  })
  await counter('🔴 Queue 결정자가 비었다 → AUDIT_TARGET_UNKNOWN', 'AUDIT_TARGET_UNKNOWN', async (s) => {
    await prisma.originalPostApprovalQueue.update({ where: { id: s.queues[1]! }, data: { decidedBy: null } })
  })
  await counter('🔴 확인 안 된 machine:* 결정자 → AUDIT_TARGET_UNKNOWN', 'AUDIT_TARGET_UNKNOWN', async (s) => {
    await prisma.originalPostApprovalQueue.update({ where: { id: s.queues[1]! }, data: { decidedBy: 'machine:review-v1' } })
  })
  {
    await wipe()
    const d3 = await storeDecision(TRIAL_D3)
    await seedDay(3, 'founder')
    const v = await verdictOf(d3)
    check('🔴 🔴 **전부 사람 승인(founder) 3건 · 감사 0 → 승격 물량 0 · FAIL (PUBLISH_SHORT)**',
      v.verdict === 'FAIL' && has(v, 'PUBLISH_SHORT') && v.counts.autoTargets === 0 && v.counts.humanApproved === 3,
      `${v.verdict} ${v.codes.join(',')} ${JSON.stringify(v.counts)}`)
  }
  await counter('🔴 혼합 — 자동 2 · 사람 승인 1(founder) → PUBLISH_SHORT', 'PUBLISH_SHORT', async (s) => {
    await prisma.originalPostApprovalQueue.update({ where: { id: s.queues[2]! }, data: { decidedBy: 'founder' } })
  })
  await counter('🔴 감사 표본이 그날 자동 target 밖(전날 글의 감사를 그날 고름) → 표본으로 세지 않는다(AUDIT_COVERAGE_SHORT)', 'AUDIT_COVERAGE_SHORT', async (s) => {
    const a = await persona(`O-${seq}`)
    const u = (await prisma.persona.findUniqueOrThrow({ where: { id: a }, select: { userId: true } })).userId
    const old = new Date(SLOTS[0]!.getTime() - 86_400_000)
    const post = await prisma.post.create({ data: { boardType: 'FREE', title: '전날 글', content: '전날', source: 'SYSTEM', authorId: u, personaId: a, createdAt: old }, select: { id: true } })
    const q = await prisma.originalPostApprovalQueue.create({
      data: { sourceRawContentId: await rawRow(old), status: 'PUBLISHED', draftTitle: '전날 글', draftBody: '전날', gateVerdict: 'PASS', gateResults: publishedGate(old, `ev-old-${seq}`) as never,
        promptVersion: AUTOFILL_PROMPT_VERSION, model: AUTOFILL_MODEL, decidedBy: AUTO_DECIDER, dedupKey: `ev-old-${seq}`, createdPostId: post.id, matchedPersonaId: a },
      select: { id: true },
    })
    // 그날 표본을 지우고 전날 글의 감사를 그날 시각으로 고른다
    await prisma.autoReadyAudit.delete({ where: { queueId: s.queues[0]! } })
    await prisma.autoReadyAudit.create({ data: { queueId: q.id, postId: post.id, selectedAtN: 3, selectedTarget: 1, selectedAt: SLOTS[1]!,
      publishedTitleHash: 'a'.repeat(64), publishedBodyHash: 'b'.repeat(64), stampContractDigest: 'd', defect: 'no',
      judgedAt: new Date(SLOTS[1]!.getTime() + MIN), auditor: 'machine:fixture', auditContractVersion: 'v', auditModel: 'm', auditPromptVersion: 'p' } })
  })
  await counter('🔴 글쓴 Persona 가 자기 글에 댓글 → COMMENT_SELF', 'COMMENT_SELF', async (s) => {
    const u = (await prisma.persona.findUniqueOrThrow({ where: { id: s.authors[0]! }, select: { userId: true } })).userId
    await autoComment({ data: { content: '제 글이에요', source: 'SYSTEM', commentOrigin: 'PERSONA', postId: s.posts[0]!, authorId: u,
      personaId: s.authors[0]!, createdAt: new Date(SLOTS[0]!.getTime() + 30 * MIN) } })
  })
  await counter('🔴 같은 Persona 가 한 글에 두 번 → DUP_COMMENT', 'DUP_COMMENT', async (s) => {
    const u = (await prisma.persona.findUniqueOrThrow({ where: { id: s.commenters[0]! }, select: { userId: true } })).userId
    await autoComment({ data: { content: '또', source: 'SYSTEM', commentOrigin: 'PERSONA', postId: s.posts[0]!, authorId: u,
      personaId: s.commenters[0]!, createdAt: new Date(SLOTS[0]!.getTime() + 3 * 3600_000) } })
  })
  await counter('🔴 감사 판정 전 · 6시간 넘음 → 판정 끝난 표본이 없다(AUDIT_COVERAGE_SHORT)', 'AUDIT_COVERAGE_SHORT', async (s) => {
    await prisma.autoReadyAudit.update({ where: { queueId: s.queues[0]! }, data: {
      defect: null, judgedAt: null, auditor: null, auditContractVersion: null, auditModel: null, auditPromptVersion: null,
      selectedAt: new Date(NOW.getTime() - AUDIT_OVERDUE_MS - MIN) } })
  })
  await counter('🔴 그날 감사가 판정 전 → AUDIT_COVERAGE_SHORT', 'AUDIT_COVERAGE_SHORT', async (s) => {
    await prisma.autoReadyAudit.update({ where: { queueId: s.queues[0]! }, data: {
      defect: null, judgedAt: null, auditor: null, auditContractVersion: null, auditModel: null, auditPromptVersion: null } })
  })
  {
    // 감사 결함은 하루 판정이 아니라 브레이크 품질 축이 막는다 — 같은 해소 판정(`unresolvedDefectCount`)으로 그날 감속한다
    await wipe()
    const dDefect = await storeDecision(TRIAL_D3)
    const sDefect = await seedDay()
    await prisma.autoReadyAudit.update({ where: { queueId: sDefect.queues[0]! }, data: { defect: 'yes' } })
    const v = await verdictOf(dDefect)
    check('🔴 🔴 **감사 결함 yes → 하루 판정에는 코드가 없고(표본은 판정 완료) · 미해소 결함 1건이 브레이크 품질 축 입력으로 잡힌다**',
      !v.codes.some((c) => c.startsWith('AUDIT_')) && (await unresolvedDefectCount(prisma)) === 1, `${v.verdict} ${v.codes.join(',')}`)
  }
  {
    await wipe()
    const decision = await storeDecision(TRIAL_D3)
    const s = await seedDay()
    const q = await prisma.originalPostApprovalQueue.findUniqueOrThrow({
      where: { id: s.queues[0]! },
      select: { id: true, createdPostId: true, draftTitle: true, draftBody: true, gateResults: true, editDiff: true },
    })
    const audit = await prisma.autoReadyAudit.update({
      where: { queueId: q.id },
      data: {
        defect: 'yes', auditor: SEMANTIC_AUDITOR,
        note: '[auto-ready-semantic-audit-v1 outcome=measured binding=fixture]',
        publishedTitleHash: digestOf(q.draftTitle), publishedBodyHash: digestOf(q.draftBody),
        auditContractVersion: SEMANTIC_AUDIT_CONTRACT_VERSION, auditModel: SEMANTIC_AUDIT_MODEL,
        auditPromptVersion: SEMANTIC_AUDIT_PROMPT_VERSION,
      },
    })
    const record = {
      recordVersion: SEMANTIC_DEFECT_RESOLUTION_RECORD_VERSION,
      qualityContract: currentQualityContract(),
      audit: { queueId: audit.queueId, postId: audit.postId, fingerprint: auditFingerprintOf(audit) },
      draft: { titleHash: digestOf(q.draftTitle), bodyHash: digestOf(q.draftBody) },
      reverify: {
        gateVersion: 'semantic-only', outcome: 'semanticCleared' as const, failureCodes: [], reviewCodes: [],
        inputDigest: reverifyInputDigestOf({ fixture: 'stage-evidence-resolved' }), artifactId: 'fixture-artifact',
        semanticContractVersion: SEMANTIC_AUDIT_CONTRACT_VERSION, semanticModel: SEMANTIC_AUDIT_MODEL,
        semanticPromptVersion: SEMANTIC_AUDIT_PROMPT_VERSION,
      },
      resolvedAt: NOW.toISOString(), resolvedBy: DEFECT_RESOLVER,
    }
    await prisma.originalPostApprovalQueue.update({
      where: { id: q.id }, data: { editDiff: { [DEFECT_RESOLUTION_KEY]: [record] } as Prisma.InputJsonValue },
    })
    const v = await verdictOf(decision)
    check('🟢 감사 원본 yes 보존 + 지금 계약의 유효한 의미 해소 기록 → PASS', v.verdict === 'PASS', `${v.verdict} ${v.codes.join(',')}`)
  }
  await counter('🔴 한 글의 발행 기록 둘 → DUP_PUBLISH_LOG', 'DUP_PUBLISH_LOG', async (s) => {
    await prisma.personaActivityLog.create({ data: { personaId: s.authors[0]!, kind: 'post', targetId: s.posts[0]!, gateStatus: 'PASS',
      decidedBy: UNATTENDED_PUBLISH_DECIDED_BY, createdAt: new Date(SLOTS[0]!.getTime() + MIN) } })
  })
  await counter('🔴 Queue 가 PUBLISHED 가 아니다(1:1 깨짐) → DUP_QUEUE', 'DUP_QUEUE', async (s) => {
    await prisma.originalPostApprovalQueue.update({ where: { id: s.queues[1]! }, data: { status: 'APPROVED' } })
  })
  await counter('🔴 표식 없는 발행(operator — 수동 · 표식 이전)은 자동 target 이 아니다 → PUBLISH_SHORT', 'PUBLISH_SHORT', async (s) => {
    await prisma.personaActivityLog.update({ where: { id: s.logs[0]! }, data: { decidedBy: 'operator' } })
  })
  await counter('🔴 2건만 냈다 → PUBLISH_SHORT', 'PUBLISH_SHORT', async (s) => {
    await prisma.personaActivityLog.delete({ where: { id: s.logs[2]! } })
    await prisma.autoReadyAudit.deleteMany({ where: { postId: s.posts[2]! } })
    await prisma.comment.deleteMany({ where: { postId: s.posts[2]! } })
    await prisma.originalPostApprovalQueue.delete({ where: { id: s.queues[2]! } })
    await prisma.post.delete({ where: { id: s.posts[2]! } })
  })
  await counter('🔴 발행 기록 없는 Queue 발행 → UNLOGGED_PUBLISH', 'UNLOGGED_PUBLISH', async (s) => {
    await prisma.personaActivityLog.delete({ where: { id: s.logs[2]! } })
  })
  await counter('🔴 글·Queue 없는 발행 기록 → PUBLISH_LOG_ORPHAN', 'PUBLISH_LOG_ORPHAN', async (s) => {
    await prisma.personaActivityLog.create({ data: { personaId: s.authors[0]!, kind: 'post', targetId: 'no-such-post', gateStatus: 'PASS',
      decidedBy: UNATTENDED_PUBLISH_DECIDED_BY, createdAt: SLOTS[1]! } })
  })
  {
    await wipe()
    const hold = await storeDecision({ release: 'd3', state: 'HOLD' })
    await seedDay()
    const v = await verdictOf(hold)
    check('🟢 자연 HOLD 결정도 실제 자동 3편 · 첫 댓글 · 감사 · 비용이 완전하면 PASS', v.verdict === 'PASS', v.codes.join(','))
  }
  {
    await wipe()
    await seedDay()
    const v = await verdictOf(null)
    check('🔴 결정 행이 없다 → DECISION_MISSING', v.verdict === 'FAIL' && has(v, 'DECISION_MISSING'), v.codes.join(','))
  }
  // 🔴 조항 ⑦ — 지금 계약(source-slot-v1)의 eligible 도장 없이 나간 글은 단계 증거가 아니다
  await counter('🔴 🔴 **도장 없는 발행(계약 이전 · 우회) → RELEASE_CONTRACT_MISSING**', 'RELEASE_CONTRACT_MISSING', async (s) => {
    const g = (await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: s.queues[1]! }, select: { gateResults: true } })).gateResults as Record<string, unknown>
    const rest = { ...g }
    delete rest[RELEASE_STAMP_KEY]
    await prisma.originalPostApprovalQueue.update({ where: { id: s.queues[1]! }, data: { gateResults: rest as never } })
  })
  await counter('🔴 🔴 **옛 계약 판 도장 → STALE_RELEASE**', 'STALE_RELEASE', async (s) => {
    const g = (await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: s.queues[1]! }, select: { gateResults: true } })).gateResults as Record<string, unknown>
    await prisma.originalPostApprovalQueue.update({ where: { id: s.queues[1]! }, data: {
      gateResults: { ...g, [RELEASE_STAMP_KEY]: { ...(g[RELEASE_STAMP_KEY] as Record<string, unknown>), contract: 'source-slot-v0' } } as never } })
  })
  await counter('🔴 🔴 **ineligible 도장(원천 72h 초과로 판정된 글이 나갔다) → STALE_RELEASE**', 'STALE_RELEASE', async (s) => {
    const t = SLOTS[2]!
    const ev = fakeEvidenceGate(t, { id: 'stale', ageH: 90 })
    const v = judgeSlotRelease({ gateResults: ev, slotAt: t, now: t, hardGates: { ok: true, codes: [] }, assignment: { ok: true }, tieBreak: 'stale' })
    await prisma.originalPostApprovalQueue.update({ where: { id: s.queues[2]! }, data: { gateResults: { ...ev, [RELEASE_STAMP_KEY]: releaseStampOf(v) } as never } })
  })
  // 🔴 P0-A (2026-09-30 야간) — 도장은 완전한 계약이어야 하고, 도장 시각 = 그 글의 발행 기록 시각(같은 사건)이어야 한다
  const stampOf = async (s: Seeded, i: number): Promise<{ g: Record<string, unknown>; st: Record<string, unknown> }> => {
    const g = (await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: s.queues[i]! }, select: { gateResults: true } })).gateResults as Record<string, unknown>
    return { g, st: g[RELEASE_STAMP_KEY] as Record<string, unknown> }
  }
  const setStamp = async (s: Seeded, i: number, f: (st: Record<string, unknown>) => unknown): Promise<void> => {
    const { g, st } = await stampOf(s, i)
    await prisma.originalPostApprovalQueue.update({ where: { id: s.queues[i]! }, data: { gateResults: { ...g, [RELEASE_STAMP_KEY]: f(st) } as never } })
  }
  await counter('🔴 🔴 **AS-IS 반례 — contract · verdict 두 칸짜리 도장 → STALE_RELEASE** (앞판 STAMPED_ELIGIBLE)', 'STALE_RELEASE',
    (s) => setStamp(s, 1, () => ({ contract: 'source-slot-v1', verdict: 'eligible' })))
  await counter('🔴 🔴 **AS-IS 반례 — slotAt:x · evaluatedAt:x · reasons · issue · evidenceVersion null → STALE_RELEASE**', 'STALE_RELEASE',
    (s) => setStamp(s, 1, () => ({ contract: 'source-slot-v1', verdict: 'eligible', slotAt: 'x', evaluatedAt: 'x', reasons: ['HARD_GATE'], issue: 'broken', evidenceVersion: null })))
  await counter('🔴 evidenceVersion 다른 판 → STALE_RELEASE', 'STALE_RELEASE',
    (s) => setStamp(s, 1, (st) => ({ ...st, evidenceVersion: 'source-evidence-v0' })))
  await counter('🔴 🔴 **도장 시각(정규 ISO)이 발행 기록보다 1분 뒤 → STALE_RELEASE** (다른 사건)', 'STALE_RELEASE',
    (s) => setStamp(s, 1, (st) => {
      const d = new Date(Date.parse(String(st.slotAt)) + MIN).toISOString()
      return { ...st, slotAt: d, evaluatedAt: d }
    }))
  await counter('🔴 🔴 **발행 기록 createdAt 만 1ms 다름(publishedAt ≠ createdAt) → STALE_RELEASE**', 'STALE_RELEASE', async (s) => {
    const l = await prisma.personaActivityLog.findUniqueOrThrow({ where: { id: s.logs[1]! }, select: { createdAt: true } })
    await prisma.personaActivityLog.update({ where: { id: s.logs[1]! }, data: { createdAt: new Date(l.createdAt.getTime() + 1) } })
  })
  await counter('🔴 🔴 **그날 밖(다음 날)에 같은 글의 두 번째 발행 기록 → STALE_RELEASE** (도장 사건은 모든 기록으로 본다)', 'STALE_RELEASE', async (s) => {
    const l = await prisma.personaActivityLog.findUniqueOrThrow({ where: { id: s.logs[1]! }, select: { personaId: true, targetId: true } })
    const next = new Date(SLOTS[1]!.getTime() + 86_400_000)
    await prisma.personaActivityLog.create({ data: { personaId: l.personaId, kind: 'post', targetId: l.targetId, gateStatus: 'PASS',
      decidedBy: UNATTENDED_PUBLISH_DECIDED_BY, publishedAt: next, createdAt: next } })
  })
  await counter('🔴 발행 기록 publishedAt 없음 → STALE_RELEASE', 'STALE_RELEASE', async (s) => {
    await prisma.personaActivityLog.update({ where: { id: s.logs[1]! }, data: { publishedAt: null } })
  })
  {
    // 🟢 Post 시각은 공개 시각이 아니다 — Post.createdAt 을 비틀어도 발행 기록 · 도장이 같은 사건이면 PASS 그대로
    await wipe()
    const decision = await storeDecision(TRIAL_D3)
    const s = await seedDay()
    await prisma.post.update({ where: { id: s.posts[1]! }, data: { createdAt: new Date(SLOTS[1]!.getTime() + 7 * MIN) } })
    const v = await verdictOf(decision)
    check('🟢 🔴 **Post.createdAt 이 달라도 발행 기록 = 도장이면 PASS — 공개 시각 정본은 발행 기록이다**', v.verdict === 'PASS', `${v.verdict} ${v.codes.join(',')}`)
  }

  {
    // 🔴 P0-A (리뷰 후속) — 사전점검 지연의 창도 발행 사건(발행 기록)이 정한다. Post.createdAt 창으로 먼저 자르지 않는다
    await wipe()
    const s = await seedDay()
    const day = kstDayBounds(D)!
    const base = await publishLatencyHours(prisma, day.start, day.end)
    // ⓐ Post 시각만 창 밖(전날) — 발행 기록 · 도장은 창 안 → 여전히 센다
    await prisma.post.update({ where: { id: s.posts[0]! }, data: { createdAt: new Date(day.start.getTime() - 3_600_000) } })
    const a = await publishLatencyHours(prisma, day.start, day.end)
    // ⓑ 발행 기록 · 도장이 창 밖(다음 날) — Post 시각은 창 안 → 세지 않는다(앞판은 Post 창으로 골라 30h 로 셌다)
    const next = new Date(SLOTS[1]!.getTime() + 86_400_000)
    await prisma.personaActivityLog.update({ where: { id: s.logs[1]! }, data: { createdAt: next, publishedAt: next } })
    await setStamp(s, 1, (st) => ({ ...st, slotAt: next.toISOString(), evaluatedAt: next.toISOString() }))
    const b = await publishLatencyHours(prisma, day.start, day.end)
    check('🔴 🔴 **사전점검 지연 — 후보 창은 발행 기록이다: Post 시각만 창 밖이면 센다 · 발행 기록이 창 밖이면 안 센다**',
      base.length === 3 && a.length === 3 && b.length === 2 && b.every((h) => h === base[0]),
      `${JSON.stringify(base)} → ${JSON.stringify(a)} → ${JSON.stringify(b)}`)
  }

  console.log('\n③ 발행 트랜잭션이 무인 표식을 실제로 남긴다')
  {
    await wipe()
    const p = await persona('PUB1')
    // 🔴 가장 이른 슬롯 뒤의 시계로 — 트랜잭션 안 슬롯 게이트가 열린다
    const txNow = new Date(`${TODAY}T09:40:00+09:00`)
    const mk = async (k: string): Promise<string> => (await prisma.originalPostApprovalQueue.create({
      data: { sourceRawContentId: await rawRow(new Date(txNow.getTime() - 86_400_000)), status: 'APPROVED', draftTitle: `가을 이불 ${k}`,
        draftBody: `가을 이불을 꺼냈어요 ${k}. 다들 바꾸셨어요?`, gateVerdict: 'PASS', gateResults: fakeEvidenceGate(txNow, { id: `ev-pub-${k}` }) as never,
        promptVersion: AUTOFILL_PROMPT_VERSION, model: AUTOFILL_MODEL, decidedBy: 'founder', dedupKey: `ev-pub-${k}`, matchedPersonaId: p },
      select: { id: true, status: true, createdPostId: true, updatedAt: true, decidedBy: true },
    })).id
    // 🔴 kill switch 행이 없으면 "중지 꺼짐" 이다(schema 주석) — 남은 행을 지운다
    await prisma.personaGlobalSwitch.deleteMany({})
    const qa = await mk('a')
    const rowA = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: qa }, select: { id: true, status: true, createdPostId: true, updatedAt: true, decidedBy: true } })
    const a = await publishOriginalPostTx(prisma, {
      queueId: qa, publishedToday: 0,
      mode: { kind: 'scheduled', releaseStage: 'd1', unattended: true,
        planned: { queueId: rowA.id, status: rowA.status, createdPostId: rowA.createdPostId, updatedAt: rowA.updatedAt, decidedBy: rowA.decidedBy } },
    }, { now: () => txNow })
    const la = a.kind === 'published' ? await prisma.personaActivityLog.findFirst({ where: { targetId: a.postId } }) : null
    // 🔴 아래에서 발행 기록을 지우기 전에 읽는다 — 도장과 같은 사건인지 대조할 원본이다
    const aLogs = a.kind === 'published' ? await prisma.personaActivityLog.findMany({ where: { kind: 'post', targetId: a.postId }, select: { publishedAt: true, createdAt: true } }) : []
    check('🟢 예약 · unattended → 발행 기록 decidedBy = 무인 표식', la?.decidedBy === UNATTENDED_PUBLISH_DECIDED_BY, `${a.kind} ${la?.decidedBy ?? '-'} ${a.kind === 'blocked' ? a.code + ' ' + a.detail : ''}`)
    await prisma.personaActivityLog.deleteMany({})
    const qb = await mk('b')
    const b = await publishOriginalPostTx(prisma, { queueId: qb, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 1 } }, { now: () => txNow })
    const lb = b.kind === 'published' ? await prisma.personaActivityLog.findFirst({ where: { targetId: b.postId } }) : null
    check('🔴 수동 단건 → 표식 없음(operator)', lb?.decidedBy === 'operator', `${b.kind} ${lb?.decidedBy ?? '-'}`)
    await prisma.personaActivityLog.deleteMany({})
    const qc = await mk('c')
    const rowC = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: qc }, select: { id: true, status: true, createdPostId: true, updatedAt: true, decidedBy: true } })
    const c = await publishOriginalPostTx(prisma, {
      queueId: qc, publishedToday: 0,
      mode: { kind: 'scheduled', releaseStage: 'd1', unattended: false,
        planned: { queueId: rowC.id, status: rowC.status, createdPostId: rowC.createdPostId, updatedAt: rowC.updatedAt, decidedBy: rowC.decidedBy } },
    }, { now: () => txNow })
    const lc = c.kind === 'published' ? await prisma.personaActivityLog.findFirst({ where: { targetId: c.postId } }) : null
    check('🔴 예약이어도 unattended=false(수동 트리거)면 표식 없음', lc?.decidedBy === 'operator', `${c.kind} ${lc?.decidedBy ?? '-'}`)
    const stamped = a.kind === 'published'
      ? (await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: qa }, select: { gateResults: true } })).gateResults as Record<string, unknown>
      : {}
    const st = stamped[RELEASE_STAMP_KEY] as Record<string, unknown> | undefined
    check('🔴 🔴 **발행 트랜잭션이 지금 계약의 완전한 eligible 도장을 실제로 남긴다 — 도장 시각 = 발행 기록 시각 = txNow (조항 ⑦ 입력)**',
      st?.contract === 'source-slot-v1' && st?.verdict === 'eligible'
      && releaseStampStatusOf(stamped, publishEventAtOf(aLogs)) === 'STAMPED_ELIGIBLE'
      && publishEventAtOf(aLogs)?.getTime() === txNow.getTime(), JSON.stringify(st))
  }

  console.log('\n④ controller 실제 진입점 (dry-run · --json · 가짜 HOME)')
  {
    const APP = join(HOME, 'Library', 'Application Support', 'soransoran')
    mkdirSync(APP, { recursive: true })
    mkdirSync(join(HOME, 'Library', 'LaunchAgents'), { recursive: true })
    const envWith = (release: string, capacity: string): void => {
      writeFileSync(join(APP, 'env.local'), [
        `SORAN_RELEASE_STAGE=${release}`, `SORAN_CAPACITY_STAGE=${capacity}`, 'STAGE_CONTROLLER_ENABLED=on', 'SORAN_PERSONA_COMMENT_STAGE=bootstrap-auto',
        'SORAN_LLM_DAILY_BUDGET_USD=0.5', 'SORAN_LLM_RUN_REQUEST_CAP=20', 'SORAN_LLM_RESERVE_HEADROOM=1.2',
        'SORAN_AUDIT_LLM_DAILY_BUDGET_USD=0.3', 'SORAN_AUDIT_LLM_RUN_REQUEST_CAP=25', 'SORAN_AUDIT_LLM_RESERVE_HEADROOM=1.5', '',
      ].join('\n'), { mode: 0o600 })
    }
    envWith('d1', 'd10')
    type Out = {
      evidence: StageEvidenceVerdict | null
      dayBefore: { evidence: StageEvidenceVerdict | null } | null
      result: {
        decision: { state: string; release: string; capacity: string; reasons: string[]; blocks: { code: string }[]; transition: { kind?: string; trialBase?: string; basis?: string; certified?: string } | null }
        brake: string; sustained: string; passDays: number
      }
      nextPreflight?: { stage: string; verdict: string; codes: string[]; warnings: string[]; counts: Record<string, number> } | null
    }
    /**
     * 🔴 **비용 증거는 정본 장부 줄로 만든다** — 요약값을 controller 에 주입하지 않고, 운영과 같은 장부 줄(그날 정기 회차 전부 ·
     *    기록 예산 · 자연 token)을 생산 writer(`appendLedgerLine`)로 가짜 HOME 장부에 쓴다. controller 는 `readCostSignals` 로
     *    그대로 읽는다. 연속 통과는 이틀을 다시 판정하므로 전날과 이틀 전 장부를 둘 다 쓴다.
     *    🔴 하루 판정은 러너 건강을 입력으로 받지 않는다 — launchd 가 없는 곳(CI · Linux)에서도 같은 판정이 나와야 한다.
     */
    const ledgerDir = ledgerDirForHome(HOME)
    mkdirSync(ledgerDir, { recursive: true })
    // 회차 시각은 바퀴 표에서 나온 정본 시각표(`SUPPLY_RUN_SLOTS_KST`)를 그대로 돈다 — 여기 시각을 적지 않는다
    const runSlotLabel = (s: { hour: number; minute: number }): string =>
      `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`
    for (const day of [D_PREV, D]) {
      for (const [i, s] of SUPPLY_RUN_SLOTS_KST.entries()) {
        const hm = runSlotLabel(s)
        const slot = `${day} ${hm}`
        appendLedgerLine(ledgerPathOf(ledgerDir, day), {
          runId: `${supplyRunIdOf(new Date(`${day}T${hm}:02+09:00`))}-d`, stage: 'draftGen',
          attemptId: `evidence-cost-${day}-${i}`, requestNo: 0, provider: 'google',
          apiModelId: 'gemini-3.7-flash', model: 'gemini-3.7-flash', status: 'settled', blockCode: null,
          countedInputTokens: 100, maxOutputTokens: 1024, reservedUsd: 0.006,
          inputTokens: 100, outputTokens: 200, cacheWriteTokens: 0, cacheReadTokens: 0, usageKeys: [],
          settledUsd: 0.004, pricingVersion: PRICING_VERSION,
          startedAt: `${day}T${hm}:30+09:00`, endedAt: `${day}T${hm}:50+09:00`, errorCode: null,
          runKind: 'scheduled', runSlot: slot, budgetDailyUsd: 1.2, budgetCeilingUsd: 1.2, budgetCapUsd: 1.2,
          budgetSource: 'process-override', sourceKey: `evidence-src-${day}-${i}`, supplyContract: SUPPLY_JIT_CONTRACT,
          runTokenShadow: {
            ok: true, code: null, tokenId: `evidence-token-${day}-${i}`, trigger: 'scheduled', launchTrigger: 'scheduled',
            absorbedTrigger: null, absorbedAt: null, pass: 0, budgetWindow: slot,
          },
        } as LedgerEntry)
      }
    }
    const launchdOk = ['com.soransoran.original-post-runner', 'com.soransoran.supply-process']
      .every((l) => observeJob(l).state === 'loaded')
    console.log(`   launchd ${launchdOk ? '있음' : '없음(CI)'} — 하루 판정은 어느 쪽이든 같다`)
    /** 발행 가능 재고 — 사람이 승인한 행(정본 로더가 그대로 읽는다) */
    const seedStock = async (): Promise<void> => {
      for (let k = 0; k < 12; k += 1) await persona(`S${k}-${seq}`)
      for (let k = 0; k < 40; k += 1) {
        const captured = new Date(NOW.getTime() - (2 + k * 0.1) * 86_400_000)
        await prisma.originalPostApprovalQueue.create({
          data: { sourceRawContentId: await rawRow(captured), status: 'APPROVED', draftTitle: `가을 이불 꺼낸 날 ${seq}-${k}`,
            draftBody: `가을 이불을 꺼내 햇볕에 말렸어요 ${seq}-${k}. 다들 이불 바꾸셨어요?`, gateVerdict: 'PASS',
            gateResults: fakeEvidenceGate(NOW, { id: `ev-stock-${seq}-${k}` }) as never,
            promptVersion: AUTOFILL_PROMPT_VERSION, model: AUTOFILL_MODEL, decidedBy: 'founder', dedupKey: `ev-stock-${seq}-${k}` },
        })
      }
    }
    const runController = (): { code: number | null; out: Out | null; raw: string } => {
      const r = spawnSync(process.execPath, [...process.execArgv, 'scripts/stage-controller.mts', '--json'], {
        encoding: 'utf-8', env: { ...process.env, HOME }, timeout: 300_000,
      })
      const text = r.stdout ?? ''
      const i = text.indexOf('{\n')
      let out: Out | null = null
      try { out = i < 0 ? null : JSON.parse(text.slice(i)) as Out } catch { out = null }
      return { code: r.status, out, raw: `${text.slice(-400)} ${(r.stderr ?? '').slice(-400)}` }
    }
    const show = (o: Out | null): string => o === null ? '(출력 없음)'
      : `evidence=${o.evidence?.verdict ?? '-'} [${o.evidence?.codes.join(',') ?? ''}] · 연속 ${o.result.passDays}`
        + ` · 결정=${o.result.decision.state} ${o.result.decision.release} (brake ${o.result.brake} · 열린 단계 ${o.result.sustained}) · transition=${JSON.stringify(o.result.decision.transition)}`
    const noRowToday = async (): Promise<boolean> => (await prisma.stageDecision.count({ where: { kstDate: TODAY } })) === 0
    const pfPersonaShort = (o: Out | null): boolean => o?.nextPreflight !== null && o?.nextPreflight !== undefined
      && o.nextPreflight.verdict === 'FAIL' && o.nextPreflight.codes.includes('PERSONA_SHORT')
      && !o.nextPreflight.codes.includes('PERSONA_UNKNOWN') && o.nextPreflight.counts.personas === 0

    // (가) 전날 올린 d3 가 미달(09:30 글 첫 댓글 없음) — 내리지 않는다
    await wipe()
    await storeDecision(TRIAL_D3)
    const s = await seedDay()
    await prisma.comment.delete({ where: { id: s.comments[0]! } })
    await seedStock()
    const failRun = runController()
    console.log(`   (가) 전날 미달 → ${show(failRun.out)}`)
    check('exit 0 (dry-run)', failRun.code === 0, failRun.raw)
    check('🔴 전날 판정 FAIL · FIRST_COMMENT_SHORT', failRun.out?.evidence?.verdict === 'FAIL' && failRun.out.evidence.codes.includes('FIRST_COMMENT_SHORT'),
      JSON.stringify(failRun.out?.evidence))
    check('🔴 🔴 **미달이어도 공개는 d3 그대로다 — 기반 칸(d1)으로 되돌리지 않는다 · 연속 0 · 올림 없음**',
      failRun.out?.result.decision.release === 'd3' && failRun.out.result.decision.state === 'PREPARE' && failRun.out.result.sustained === 'd3'
      && failRun.out.result.passDays === 0 && failRun.out.result.decision.transition === null, show(failRun.out))
    check('🔴 dry-run — 오늘 결정 행 0 (DB write 0)', await noRowToday())

    // (나) 전날 d3 통과 · 이틀 전 행 없음 — 하루로는 올리지 않는다
    await wipe()
    await storeDecision(TRIAL_D3)
    await seedDay()
    await seedStock()
    const passRun = runController()
    console.log(`   (나) 전날 통과(1일) → ${show(passRun.out)}`)
    check('exit 0 (dry-run)', passRun.code === 0, passRun.raw)
    check('🔴 비용 축은 가짜 HOME 정본 장부에서 읽었다 — 그날 정기 회차 전부의 정산 표본 · 미상·귀속불명 0',
      passRun.out?.evidence?.counts.supplySettledRequests === SUPPLY_RUN_SLOTS_KST.length
      && passRun.out.evidence.counts.supplyUsageUnknown === 0
      && passRun.out.evidence.counts.supplyCostIneligibleRequests === 0
      && !passRun.out.evidence.codes.some((c) => c === 'COST_UNKNOWN' || c === 'COST_BAD'),
      JSON.stringify(passRun.out?.evidence?.counts))
    check('🟢 🔴 **전날 판정 PASS — launchd 유무와 무관하다(러너 건강은 판정의 입력이 아니다)**',
      passRun.out?.evidence?.verdict === 'PASS', JSON.stringify(passRun.out?.evidence))
    check(`🟢 실제 행에서 결 네 칸이 계산된다 — 첫 댓글 3/3 · 글당 댓글 ${depthAvgOf(D)} · 타인 3명 3편 · 수집→공개 중앙값`,
      passRun.out?.evidence?.counts.firstCommentOk === 3 && passRun.out.evidence.counts.commentDepthAvg === depthAvgOf(D)
      && passRun.out.evidence.counts.threeVoicesPosts === 3 && passRun.out.evidence.counts.collectToPublishMedianH !== undefined,
      JSON.stringify(passRun.out?.evidence?.counts))
    check('🔴 하루 통과로는 올리지 않는다 — 연속 1 · 공개 d3', passRun.out?.result.passDays === 1 && passRun.out.result.decision.release === 'd3'
      && passRun.out.result.decision.state !== 'TRIAL', show(passRun.out))
    check('🔴 dry-run — 오늘 결정 행 0 (DB write 0)', await noRowToday())

    // (다) 이틀 연속 통과 — 올릴 조건은 찼지만 격리 DB 의 계약 유효 Persona 는 0 이다 → 관문이 막는다
    await wipe()
    await storeDecision({ release: 'd3', state: 'PREPARE' }, D_PREV)
    await storeDecision({ release: 'd3', state: 'PREPARE' })
    await seedDay(3, AUTO_DECIDER, D_PREV)
    await seedDay()
    await seedStock()
    const twoRun = runController()
    const td = twoRun.out?.result.decision
    console.log(`   (다) 이틀 연속 통과 → ${show(twoRun.out)} · preflight ${twoRun.out?.nextPreflight?.verdict} [${twoRun.out?.nextPreflight?.codes.join(',')}]`)
    check('exit 0 (dry-run)', twoRun.code === 0, twoRun.raw)
    check('🟢 전날·이틀 전 판정이 둘 다 PASS — 연속 2',
      twoRun.out?.evidence?.verdict === 'PASS' && twoRun.out.dayBefore?.evidence?.verdict === 'PASS' && twoRun.out.result.passDays === 2,
      `${JSON.stringify(twoRun.out?.evidence?.codes)} ${JSON.stringify(twoRun.out?.dayBefore?.evidence?.codes)}`)
    check('🔴 🔴 **실제 DB 로 모은 d5 관문 — 계약 유효 Persona 0(연결됨) → PERSONA_SHORT · 비용 추정은 막는 코드에 없다**',
      pfPersonaShort(twoRun.out) && twoRun.out?.nextPreflight?.stage === 'd5'
      && !twoRun.out.nextPreflight.codes.some((c) => /COST|RUNNER/.test(c)), JSON.stringify(twoRun.out?.nextPreflight))
    check('🔴 🔴 **관문이 막으면 올리지 않는다 — PREPARE d3 · PREFLIGHT_FAIL · capacity 는 다음 칸 d5**',
      td?.state === 'PREPARE' && td.release === 'd3' && td.capacity === 'd5' && td.blocks.some((b) => b.code === 'PREFLIGHT_FAIL'),
      `${td?.state} ${td?.release} ${td?.capacity} ${JSON.stringify(td?.blocks)}`)
    check('🔴 dry-run — 오늘 결정 행 0 (DB write 0)', await noRowToday())

    // (라) 배포 첫날 — 옛 사다리가 남긴 행: 이틀 전 TRIAL d5(미달) → 전날 PREPARE d3(되돌림)
    await wipe()
    await storeDecision({ capacity: 'd10', release: 'd5', state: 'TRIAL',
      transition: { kind: 'TRIAL', trialBase: 'd3', previousKstDate: previousKstDate(D_PREV), target: 'd5', basis: 'PASS' } }, D_PREV)
    await storeDecision({ release: 'd3', state: 'PREPARE', blocks: [{ code: 'PREFLIGHT_FAIL', reason: 'd5 preflight FAIL [SUPPLY_COST_SHORT]' }] })
    await seedDay()
    await seedStock()
    const firstMorning = runController()
    console.log(`   (라) 옛 되돌림 행 → ${show(firstMorning.out)}`)
    check('🟢 🔴 **옛 되돌림 행(전날 PREPARE d3 · 이틀 전 TRIAL d5) → 열린 단계 d5 를 되찾는다 · 공개 d5 · 올림 없음**',
      firstMorning.code === 0 && firstMorning.out?.result.sustained === 'd5' && firstMorning.out.result.decision.release === 'd5'
      && firstMorning.out.result.passDays === 0 && firstMorning.out.result.decision.state !== 'TRIAL', show(firstMorning.out))
    check('결정 reasons 에 하루 판정 코드가 남는다',
      [failRun, passRun, twoRun].every((r) => r.out?.result.decision.reasons.some((x) => x.startsWith(`EVIDENCE ${D} d3 `)) === true))

    console.log('\n⑤ 옛 행 판독 · D20 진입점')
    {
      // (가) 옛 사다리가 쓴 REPROVE · HOLD 행의 날도 같은 본체로 판정한다 — 행의 상태는 판정 입력이 아니다
      await wipe()
      const reprove = await storeDecision({ release: 'd3', state: 'REPROVE' })
      await seedDay()
      const rv = await verdictOf(reprove)
      check('🟢 옛 REPROVE d3 행의 날 · 실제 행 → PASS · 연속 1일로 센다', rv.verdict === 'PASS'
        && consecutivePassDays(TODAY, 'd3', [{ decision: reprove, evidence: rv }]) === 1, `${rv.verdict} ${rv.codes.join(',')}`)
      await wipe()
      const hold = await storeDecision({ release: 'd3', state: 'HOLD' })
      await seedDay()
      const hv = await verdictOf(hold)
      check('🟢 HOLD d3 행의 날도 PASS', hv.verdict === 'PASS', hv.codes.join(','))

      // (나) controller 진입점 — 전날 올린 d20(기반 d10) · 그날 글 0 → 미달이어도 d20 유지
      const trialD20 = { capacity: 'd30', release: 'd20', state: 'TRIAL', transition: { kind: 'TRIAL', trialBase: 'd10', previousKstDate: D_PREV, target: 'd20', basis: 'PASS' } }
      await wipe()
      await storeDecision(trialD20)
      await seedStock()
      envWith('d10', 'd10')
      const c1 = runController()
      const r1 = c1.out?.result.decision
      console.log(`   (나-1) 전날 올린 d20 · 글 0 → ${show(c1.out)} · preflight ${c1.out?.nextPreflight?.verdict} [${c1.out?.nextPreflight?.codes.join(',')}]`)
      check('exit 0 (dry-run)', c1.code === 0, c1.raw)
      check('🔴 전날 d20 판정은 PASS 가 아니다(PUBLISH_SHORT) → 연속 0', c1.out?.evidence?.verdict !== 'PASS'
        && c1.out?.evidence?.codes.includes('PUBLISH_SHORT') === true && c1.out.result.passDays === 0, JSON.stringify(c1.out?.evidence))
      check('🔴 🔴 **실제 DB 로 모은 d30 관문 — 계약 유효 Persona 0 → PERSONA_SHORT(막는 코드는 Persona·구조뿐)**',
        c1.out?.nextPreflight?.stage === 'd30' && pfPersonaShort(c1.out) && !c1.out.nextPreflight.codes.some((c) => /COST|RUNNER/.test(c)),
        JSON.stringify(c1.out?.nextPreflight))
      check('🔴 🔴 **미달이어도 d20 을 유지한다 — PREPARE d20 · capacity d30 · 기반 d10 으로 되돌리지 않는다**', r1 !== undefined
        && r1.state === 'PREPARE' && r1.release === 'd20' && r1.capacity === 'd30' && c1.out?.result.sustained === 'd20',
      `${r1?.state} ${r1?.release} ${r1?.capacity} ${JSON.stringify(r1?.blocks)}`)
      // 🔴 env 단계 키는 결정의 입력이 아니다 — d50/d100 을 적어도 같은 결정이다
      envWith('d50', 'd100')
      const c2 = runController()
      const r2 = c2.out?.result.decision
      check('🔴 🔴 **env 에 SORAN_RELEASE_STAGE=d50 · CAPACITY=d100 을 적어도 결정은 그대로 — 단계 입력원은 StageDecision 하나**',
        c2.code === 0 && r2 !== undefined && r1 !== undefined && r2.state === r1.state && r2.release === r1.release && r2.capacity === r1.capacity,
        `${r2?.state} ${r2?.release} ${r2?.capacity}`)
      check('🔴 dry-run — 오늘 결정 행 0 (DB write 0)', await noRowToday())

      // (다) 읽기 전용 미리보기 — `--evidence-date` 는 결정을 계산하지도 쓰지도 않는다
      const rowsBefore = await prisma.stageDecision.count()
      const preview = spawnSync(process.execPath, [...process.execArgv, 'scripts/stage-controller.mts', `--evidence-date=${D}`, '--evidence-days=2', '--json'], {
        encoding: 'utf-8', env: { ...process.env, HOME }, timeout: 300_000,
      })
      let days: { date: string; evidence: StageEvidenceVerdict }[] | null = null
      try { days = JSON.parse((preview.stdout ?? '').slice((preview.stdout ?? '').indexOf('['))) as { date: string; evidence: StageEvidenceVerdict }[] } catch { days = null }
      check('🟢 미리보기 — 그날부터 거꾸로 이틀의 하루 판정을 낸다(이틀 전은 결정 행이 없어 --evidence-stage 없이는 멈춘다)',
        preview.status === 1 || (days !== null && days.length === 2 && days[0]!.date === D), `${preview.status} ${(preview.stderr ?? '').slice(-200)}`)
      const previewOne = spawnSync(process.execPath, [...process.execArgv, 'scripts/stage-controller.mts', `--evidence-date=${D}`], {
        encoding: 'utf-8', env: { ...process.env, HOME }, timeout: 300_000,
      })
      check('🟢 미리보기 — 사람이 읽는 줄(▸ 공개 · 첫 댓글 · 글당 댓글 · 타인 3명 · 수집→공개)이 찍힌다',
        previewOne.status === 0 && /▸ \d\d-\d\d 공개 0\/20편/.test(previewOne.stdout ?? '') && (previewOne.stdout ?? '').includes('read-only · DB write 0'),
        `${previewOne.status} ${(previewOne.stdout ?? '').slice(-300)}`)
      check('🔴 🔴 **미리보기는 결정 행을 쓰지 않는다 — 실행 전후 StageDecision 행 수가 같다**',
        (await prisma.stageDecision.count()) === rowsBefore && await noRowToday())
    }
  }
} finally {
  await wipe()
  await prisma.$disconnect()
  rmSync(HOME, { recursive: true, force: true })
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
if (fail > 0) process.exit(1)
