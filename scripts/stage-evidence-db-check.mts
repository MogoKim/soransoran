#!/usr/bin/env tsx
/**
 * 🔴 **단계 승격 운영 증거 — 실제 DB 읽기 · controller 실제 진입점** (2026-09-29 P0 · 격리 Postgres 전용)
 *
 *   ① 실제 행(StageDecision · Queue · Post · Comment · PersonaActivityLog · AutoReadyAudit)을 심고
 *      `readStageEvidenceFacts` → `judgeStageEvidence` 가 PASS 를 낸다
 *   ② 행 하나씩 비틀면(댓글 없음 · 61분 · 지운 댓글 · 감사 미판정/시한 초과 · 결함 yes · 발행 기록 중복 ·
 *      같은 Persona 두 번 · 표식 없는 발행 · 편수 부족 · HOLD 결정 · 기록 없는 발행 · 고아 기록) PASS 가 아니다
 *   ③ 발행 트랜잭션이 무인 표식을 실제로 남긴다(예약 · unattended) · 수동 단건은 남기지 않는다
 *   ④ `scripts/stage-controller.mts --json` (dry-run) — 전날 FAIL → TRIAL d3 재시험 · 전날 PASS → TRIAL d5 · DB write 0
 *
 * 🔴 운영 DB 에 절대 붙이지 않는다 — sentinel · localhost · 고정 DB 이름을 요구한다. provider 0.
 * 🔴 HOME 을 임시 디렉터리로 바꿔 controller 를 돌린다 — 정본 env · 장부가 전부 가짜 HOME 안이다.
 * 세우는 법은 `stage-decision-db-check.mts` 맨 위 주석과 같다 (SORAN_ISOLATED_DB=yes-throwaway · soran_test).
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PrismaClient } from '@prisma/client'

import { kstDateString } from '../src/lib/release-canary'
import { previousKstDate, validateStoredDecision, STAGE_DECISION_VERSION, DECISION_WRITER, type ValidatedStageDecision } from '../src/lib/stage-decision-contract'
import { createStageDecision } from '../src/lib/stage-decision-repo'
import { readStageEvidenceFacts } from '../src/lib/stage-evidence-repo'
import { judgeStageEvidence, trialPlanOf, type StageEvidenceVerdict, type EvidenceSideSignals } from '../src/lib/stage-evidence'
import { UNATTENDED_PUBLISH_DECIDED_BY, publishOriginalPostTx } from '../src/lib/original-post-publish-tx'
import { AUTO_FIRST_COMMENT_WINDOW_MS } from '../src/lib/persona-comment-auto-lane'
import { AUDIT_OVERDUE_MS } from '../src/lib/auto-ready-audit-store'
import { AUTOFILL_PROMPT_VERSION, AUTOFILL_MODEL, AUTOFILL_SITE_PREFIX } from '../src/lib/micro-seed-supply-autofill'
import { AUTO_DECIDER } from '../src/lib/auto-ready-v2'
import { observeJob } from './lib/runner-health.mjs'
import { personaCommentCapFor } from '../src/lib/stage-evidence'

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
const at = (hh: number, mm: number): Date => new Date(`${D}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+09:00`)
const MIN = 60_000
const SLOTS = [at(9, 30), at(13, 30), at(17, 30)]
const SIDE_OK: EvidenceSideSignals = {
  cost: [{ name: '공급 장부', health: 'ok' }, { name: '댓글 장부', health: 'ok' }, { name: '감사 장부', health: 'ok' }],
  errors: 'ok',
}

/** 🔴 격리 DB 청소 — FK 순서대로. raw SQL 0 */
async function wipe(): Promise<void> {
  await prisma.autoReadyAudit.deleteMany({})
  await prisma.comment.deleteMany({})
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
/** 🔴 09-29 운영 행 모양 — TRIAL d3 · 기반 d1 */
const TRIAL_D3 = { release: 'd3', state: 'TRIAL', transition: { kind: 'TRIAL', trialBase: 'd1', previousKstDate: D_PREV, target: 'd3' } }

async function storeDecision(o: Record<string, unknown>): Promise<ValidatedStageDecision> {
  const v = validateStoredDecision({ row: decisionRow(D, o), expectKstDate: D })
  if (!v.ok) throw new Error(`fixture 결정이 깨졌다 — ${v.reason}`)
  await createStageDecision(prisma, v.decision)
  return v.decision
}

let seq = 0
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
 * 🔴 D 하루 — 무인 발행 3건(자동 READY 도장 행) · 글마다 12분 뒤 다른 Persona 첫 댓글 1건 ·
 *    감사 1건(판정 no) = 정본 표본 ceil(3×0.2)=1
 */
async function seedDay(n = 3, decidedBy: string | null = AUTO_DECIDER): Promise<Seeded> {
  const s: Seeded = { posts: [], authors: [], commenters: [], comments: [], logs: [], queues: [] }
  for (let i = 0; i < n; i += 1) {
    const author = await persona(`A${i}-${seq}`)
    const commenter = await persona(`C${i}-${seq}`)
    const authorUser = (await prisma.persona.findUniqueOrThrow({ where: { id: author }, select: { userId: true } })).userId
    const commenterUser = (await prisma.persona.findUniqueOrThrow({ where: { id: commenter }, select: { userId: true } })).userId
    const t = SLOTS[i]!
    const post = await prisma.post.create({
      data: { boardType: 'FREE', title: `저녁 산책 ${i}`, content: `동네 한 바퀴 ${i}`, source: 'SYSTEM', authorId: authorUser, personaId: author, createdAt: t },
      select: { id: true },
    })
    const q = await prisma.originalPostApprovalQueue.create({
      data: { sourceRawContentId: await rawRow(t), status: 'PUBLISHED', draftTitle: `저녁 산책 ${i}`, draftBody: `동네 한 바퀴 ${i}`,
        gateVerdict: 'PASS', gateResults: {}, promptVersion: AUTOFILL_PROMPT_VERSION, model: AUTOFILL_MODEL,
        decidedBy, dedupKey: `ev-${seq}-${i}`, createdPostId: post.id, matchedPersonaId: author },
      select: { id: true },
    })
    const log = await prisma.personaActivityLog.create({
      data: { personaId: author, kind: 'post', targetId: post.id, gateStatus: 'PASS', decidedBy: UNATTENDED_PUBLISH_DECIDED_BY, publishedAt: t, createdAt: t },
      select: { id: true },
    })
    const c = await prisma.comment.create({
      data: { content: '저도 저녁에 걸어요', source: 'SYSTEM', commentOrigin: 'PERSONA', postId: post.id, authorId: commenterUser,
        personaId: commenter, createdAt: new Date(t.getTime() + 12 * MIN) },
      select: { id: true },
    })
    s.posts.push(post.id); s.authors.push(author); s.commenters.push(commenter); s.comments.push(c.id); s.logs.push(log.id); s.queues.push(q.id)
  }
  if (n > 0 && decidedBy === AUTO_DECIDER) {
    await prisma.autoReadyAudit.create({
      data: { queueId: s.queues[0]!, postId: s.posts[0]!, selectedAtN: n, selectedTarget: 1, selectedAt: new Date(SLOTS[0]!.getTime() + 30 * MIN),
        publishedTitleHash: 'a'.repeat(64), publishedBodyHash: 'b'.repeat(64), stampContractDigest: 'd',
        defect: 'no', judgedAt: new Date(SLOTS[0]!.getTime() + 40 * MIN), auditor: 'machine:fixture',
        auditContractVersion: 'v', auditModel: 'm', auditPromptVersion: 'p' },
    })
  }
  return s
}

const CAP_AUTO = personaCommentCapFor('bootstrap-auto')
async function verdictOf(decision: ValidatedStageDecision | null, cap: number | null = CAP_AUTO): Promise<StageEvidenceVerdict> {
  const facts = await readStageEvidenceFacts(prisma, { kstDate: D, stage: 'd3', decision, now: NOW, commentCapPerPost: cap })
  return judgeStageEvidence(D, 'd3', facts, SIDE_OK)
}
const has = (v: StageEvidenceVerdict, c: string): boolean => (v.codes as readonly string[]).includes(c)

/** 🔴 한 반례 = 깨끗한 하루를 새로 심고, 행 하나만 비튼다 */
async function counter(name: string, code: string, mutate: (s: Seeded) => Promise<void>, decisionOverride?: Record<string, unknown>,
  cap: number | null = CAP_AUTO): Promise<void> {
  await wipe()
  const decision = await storeDecision(decisionOverride ?? TRIAL_D3)
  const s = await seedDay()
  await mutate(s)
  const v = await verdictOf(decision, cap)
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
  check('편수 3 · 무인 3 · 첫 댓글 3 · 감사 대상 3 · 기대 1 · 덮음 1', base.counts.published === 3 && base.counts.unattended === 3
    && base.counts.firstCommentOk === 3 && base.counts.auditTargets === 3 && base.counts.auditExpected === 1
    && base.counts.auditCovered === 1, JSON.stringify(base.counts))
  const plan = trialPlanOf(dec, base)
  check('🟢 다음 날 계획 = d5 시험 (기반 d3 · PASS)', plan?.target === 'd5' && plan.base === 'd3' && plan.basis === 'PASS', JSON.stringify(plan))

  console.log('\n② 행 하나씩 비틀면 PASS 가 아니다')
  await counter('🔴 09:30 글 댓글 삭제(행 없음) → COMMENT_MISSING', 'COMMENT_MISSING', async (s) => {
    await prisma.comment.delete({ where: { id: s.comments[0]! } })
  })
  await counter('🔴 지운 댓글(isDeleted)은 세지 않는다 → COMMENT_MISSING', 'COMMENT_MISSING', async (s) => {
    await prisma.comment.update({ where: { id: s.comments[0]! }, data: { isDeleted: true } })
  })
  await counter('🔴 첫 댓글이 61분 뒤 → COMMENT_LATE', 'COMMENT_LATE', async (s) => {
    await prisma.comment.update({ where: { id: s.comments[0]! }, data: { createdAt: new Date(SLOTS[0]!.getTime() + AUTO_FIRST_COMMENT_WINDOW_MS + MIN) } })
  })
  const secondPersonaComment = async (s: Seeded): Promise<void> => {
    const other = await persona(`X-${seq}`)
    const u = (await prisma.persona.findUniqueOrThrow({ where: { id: other }, select: { userId: true } })).userId
    await prisma.comment.create({ data: { content: '저도요', source: 'SYSTEM', commentOrigin: 'PERSONA', postId: s.posts[0]!, authorId: u,
      personaId: other, createdAt: new Date(SLOTS[0]!.getTime() + 20 * MIN) } })
  }
  await counter('🔴 bootstrap-auto(상한 1) — 60분 안 두 번째 Persona → COMMENT_OVER_CAP', 'COMMENT_OVER_CAP', secondPersonaComment)
  {
    await wipe()
    const d2 = await storeDecision(TRIAL_D3)
    const s2 = await seedDay()
    await secondPersonaComment(s2)
    const v = await verdictOf(d2, personaCommentCapFor('organic'))
    check('🟢 상한 5(장기 1~5) — 같은 두 댓글은 PASS (60분 안 2건은 실패가 아니다)', v.verdict === 'PASS', `${v.verdict} ${v.codes.join(',')}`)
  }
  await counter('🔴 댓글 단계를 모른다(상한 null) → COMMENT_CAP_UNKNOWN', 'COMMENT_CAP_UNKNOWN', async () => undefined, undefined, null)
  await counter('🔴 🔴 **자동 READY 3건인데 감사 행 0 → AUDIT_COVERAGE_ZERO**', 'AUDIT_COVERAGE_ZERO', async (s) => {
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
    check('🟢 자동 READY 0 · 전부 사람 검토(founder) · 감사 행 0 → 이유 있는 0 · PASS',
      v.verdict === 'PASS' && v.counts.auditTargets === 0 && v.counts.humanReviewed === 3, `${v.verdict} ${v.codes.join(',')} ${JSON.stringify(v.counts)}`)
  }
  await counter('🔴 같은 Persona 가 한 글에 두 번 → DUP_COMMENT', 'DUP_COMMENT', async (s) => {
    const u = (await prisma.persona.findUniqueOrThrow({ where: { id: s.commenters[0]! }, select: { userId: true } })).userId
    await prisma.comment.create({ data: { content: '또', source: 'SYSTEM', commentOrigin: 'PERSONA', postId: s.posts[0]!, authorId: u,
      personaId: s.commenters[0]!, createdAt: new Date(SLOTS[0]!.getTime() + 3 * 3600_000) } })
  })
  await counter('🔴 감사 판정 전 · 6시간 넘음 → AUDIT_OVERDUE', 'AUDIT_OVERDUE', async (s) => {
    await prisma.autoReadyAudit.update({ where: { queueId: s.queues[0]! }, data: {
      defect: null, judgedAt: null, auditor: null, auditContractVersion: null, auditModel: null, auditPromptVersion: null,
      selectedAt: new Date(NOW.getTime() - AUDIT_OVERDUE_MS - MIN) } })
  })
  await counter('🔴 그날 감사가 판정 전 → AUDIT_UNJUDGED', 'AUDIT_UNJUDGED', async (s) => {
    await prisma.autoReadyAudit.update({ where: { queueId: s.queues[0]! }, data: {
      defect: null, judgedAt: null, auditor: null, auditContractVersion: null, auditModel: null, auditPromptVersion: null } })
  })
  await counter('🔴 감사 결함 yes → AUDIT_DEFECT', 'AUDIT_DEFECT', async (s) => {
    await prisma.autoReadyAudit.update({ where: { queueId: s.queues[0]! }, data: { defect: 'yes' } })
  })
  await counter('🔴 한 글의 발행 기록 둘 → DUP_PUBLISH_LOG', 'DUP_PUBLISH_LOG', async (s) => {
    await prisma.personaActivityLog.create({ data: { personaId: s.authors[0]!, kind: 'post', targetId: s.posts[0]!, gateStatus: 'PASS',
      decidedBy: UNATTENDED_PUBLISH_DECIDED_BY, createdAt: new Date(SLOTS[0]!.getTime() + MIN) } })
  })
  await counter('🔴 Queue 가 PUBLISHED 가 아니다(1:1 깨짐) → DUP_QUEUE', 'DUP_QUEUE', async (s) => {
    await prisma.originalPostApprovalQueue.update({ where: { id: s.queues[1]! }, data: { status: 'APPROVED' } })
  })
  await counter('🔴 표식 없는 발행(operator — 수동 · 표식 이전) → PUBLISH_NOT_UNATTENDED', 'PUBLISH_NOT_UNATTENDED', async (s) => {
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
  await counter('🔴 HOLD 결정(override · env canary 날)은 세지 않는다 → DECISION_NOT_TRANSITION', 'DECISION_NOT_TRANSITION',
    async () => undefined, { release: 'd3', state: 'HOLD' })
  {
    await wipe()
    await seedDay()
    const v = await verdictOf(null)
    check('🔴 결정 행이 없다 → DECISION_MISSING', v.verdict === 'FAIL' && has(v, 'DECISION_MISSING'), v.codes.join(','))
  }

  console.log('\n③ 발행 트랜잭션이 무인 표식을 실제로 남긴다')
  {
    await wipe()
    const p = await persona('PUB1')
    // 🔴 가장 이른 슬롯 뒤의 시계로 — 트랜잭션 안 슬롯 게이트가 열린다
    const txNow = new Date(`${TODAY}T09:40:00+09:00`)
    const mk = async (k: string): Promise<string> => (await prisma.originalPostApprovalQueue.create({
      data: { sourceRawContentId: await rawRow(new Date(txNow.getTime() - 86_400_000)), status: 'APPROVED', draftTitle: `가을 이불 ${k}`,
        draftBody: `가을 이불을 꺼냈어요 ${k}. 다들 바꾸셨어요?`, gateVerdict: 'PASS', gateResults: {},
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
      mode: { kind: 'scheduled', releaseStage: 'd1',
        planned: { queueId: rowC.id, status: rowC.status, createdPostId: rowC.createdPostId, updatedAt: rowC.updatedAt, decidedBy: rowC.decidedBy } },
    }, { now: () => txNow })
    const lc = c.kind === 'published' ? await prisma.personaActivityLog.findFirst({ where: { targetId: c.postId } }) : null
    check('🔴 예약이어도 unattended 를 안 주면(수동 실행) 표식 없음', lc?.decidedBy === 'operator', `${c.kind} ${lc?.decidedBy ?? '-'}`)
  }

  console.log('\n④ controller 실제 진입점 (dry-run · --json · 가짜 HOME)')
  {
    const APP = join(HOME, 'Library', 'Application Support', 'soransoran')
    mkdirSync(APP, { recursive: true })
    mkdirSync(join(HOME, 'Library', 'LaunchAgents'), { recursive: true })
    writeFileSync(join(APP, 'env.local'), [
      'SORAN_RELEASE_STAGE=d1', 'SORAN_CAPACITY_STAGE=d10', 'STAGE_CONTROLLER_ENABLED=on', 'SORAN_PERSONA_COMMENT_STAGE=bootstrap-auto',
      'SORAN_LLM_DAILY_BUDGET_USD=0.5', 'SORAN_LLM_RUN_REQUEST_CAP=20', 'SORAN_LLM_RESERVE_HEADROOM=1.2',
      'SORAN_AUDIT_LLM_DAILY_BUDGET_USD=0.3', 'SORAN_AUDIT_LLM_RUN_REQUEST_CAP=25', 'SORAN_AUDIT_LLM_RESERVE_HEADROOM=1.5', '',
    ].join('\n'), { mode: 0o600 })
    type Out = {
      evidence: StageEvidenceVerdict | null
      plan: { base: string; target: string; basis: string } | null
      result: { decision: { state: string; release: string; reasons: string[]; transition: { trialBase?: string; basis?: string } | null }; brake: string }
    }
    /**
     * 🔴 **러너 신호는 진짜 launchd 를 본다** — 가짜로 만들지 않는다(fixture 가 실제보다 강할 수 없다).
     *    공급 회차 기록만 가짜 HOME 에 "그날 정상 끝난 회차" 한 개를 둔다(실제 읽기 경로 그대로).
     *    launchd 가 없는 곳(CI · Linux)에서는 러너 신호가 모름이다 → 증거는 PASS 가 될 수 없고,
     *    그때는 **모름 → 머문다(재시험)** 를 검사한다. launchd 가 있는 곳에서는 PASS → d5 를 검사한다.
     */
    const dataDir = join(APP, 'microseed-data')
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(join(dataDir, 'supply-process-evidence-fixture.run.json'), JSON.stringify({
      runId: 'evidence-fixture', startedAt: new Date(`${D}T08:00:00+09:00`).toISOString(), status: 'done',
      completedAt: new Date(`${D}T08:05:00+09:00`).toISOString(), runtimeSha: null, stages: [],
    }))
    const launchdOk = ['com.soransoran.original-post-runner', 'com.soransoran.supply-process']
      .every((l) => observeJob(l).state === 'loaded')
    console.log(`   launchd ${launchdOk ? '있음 — PASS → d5 까지 검사한다' : '없음(CI) — 러너 모름 → 머문다를 검사한다'}`)
    /** 🔴 발행 가능 재고 — 사람이 승인한 행(정본 로더가 그대로 읽는다). 하루 시험 판정이 재고로 막히지 않게 */
    const seedStock = async (): Promise<void> => {
      for (let k = 0; k < 12; k += 1) await persona(`S${k}-${seq}`)
      for (let k = 0; k < 40; k += 1) {
        const captured = new Date(NOW.getTime() - (2 + k * 0.1) * 86_400_000)
        await prisma.originalPostApprovalQueue.create({
          data: { sourceRawContentId: await rawRow(captured), status: 'APPROVED', draftTitle: `가을 이불 꺼낸 날 ${seq}-${k}`,
            draftBody: `가을 이불을 꺼내 햇볕에 말렸어요 ${seq}-${k}. 다들 이불 바꾸셨어요?`, gateVerdict: 'PASS', gateResults: {},
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
      : `evidence=${o.evidence?.verdict ?? '-'} [${o.evidence?.codes.join(',') ?? ''}] · plan=${o.plan === null ? 'none' : `${o.plan.base}→${o.plan.target}:${o.plan.basis}`}`
        + ` · 결정=${o.result.decision.state} ${o.result.decision.release} (brake ${o.result.brake}) · transition=${JSON.stringify(o.result.decision.transition)}`

    // (가) 전날 D3 FAIL — 09:30 글 댓글 없음
    await wipe()
    await storeDecision(TRIAL_D3)
    const s = await seedDay()
    await prisma.comment.delete({ where: { id: s.comments[0]! } })
    await seedStock()
    const failRun = runController()
    console.log(`   (가) 전날 FAIL → ${show(failRun.out)}`)
    check('exit 0 (dry-run)', failRun.code === 0, failRun.raw)
    check('🔴 전날 증거 FAIL · COMMENT_MISSING', failRun.out?.evidence?.verdict === 'FAIL' && failRun.out.evidence.codes.includes('COMMENT_MISSING'))
    check('🔴 🔴 **시험 계획 = d3 재시험 (기반 d1 · RETEST) — d5 아님**',
      failRun.out?.plan?.target === 'd3' && failRun.out.plan.base === 'd1' && failRun.out.plan.basis === 'RETEST', JSON.stringify(failRun.out?.plan))
    check('🔴 결정 공개는 d5 가 아니다', failRun.out !== null && failRun.out.result.decision.release !== 'd5')
    check('🔴 dry-run — 오늘 결정 행 0 (DB write 0)', (await prisma.stageDecision.count({ where: { kstDate: TODAY } })) === 0)

    // (나) 전날 D3 PASS
    await wipe()
    await storeDecision(TRIAL_D3)
    await seedDay()
    await seedStock()
    const passRun = runController()
    console.log(`   (나) 전날 PASS → ${show(passRun.out)}`)
    check('exit 0 (dry-run)', passRun.code === 0, passRun.raw)
    if (launchdOk) {
      check('🟢 전날 증거 PASS', passRun.out?.evidence?.verdict === 'PASS', JSON.stringify(passRun.out?.evidence))
      check('🟢 시험 계획 = d5 (기반 d3 · PASS)', passRun.out?.plan?.target === 'd5' && passRun.out.plan.base === 'd3' && passRun.out.plan.basis === 'PASS')
    } else {
      check('⬚ launchd 없음 — 증거는 PASS 가 아니다(RUNNER_UNKNOWN 하나뿐 · DB 여섯 조건은 다 채웠다)',
        passRun.out?.evidence?.verdict === 'UNKNOWN' && passRun.out.evidence.codes.join(',') === 'RUNNER_UNKNOWN', JSON.stringify(passRun.out?.evidence))
      check('⬚ 모름 → 머문다: 시험 계획 = d3 재시험', passRun.out?.plan?.target === 'd3' && passRun.out.plan.basis === 'RETEST')
    }
    check('🔴 dry-run — 오늘 결정 행 0 (DB write 0)', (await prisma.stageDecision.count({ where: { kstDate: TODAY } })) === 0)
    if (launchdOk) {
      const fd = failRun.out?.result.decision
      const pd = passRun.out?.result.decision
      check('🔴 🔴 **러너 수준 — 전날 FAIL → 결정 TRIAL d3 (재시험)**', fd?.state === 'TRIAL' && fd.release === 'd3', `${fd?.state} ${fd?.release}`)
      check('🟢 🟢 **러너 수준 — 전날 PASS → 결정 TRIAL d5**', pd?.state === 'TRIAL' && pd.release === 'd5', `${pd?.state} ${pd?.release}`)
    }
    for (const r of [failRun, passRun]) {
      const d = r.out?.result.decision
      if (d?.state === 'TRIAL') {
        check(`TRIAL ${d.release} 결정의 근거 칸이 계획과 같다`, d.transition?.basis === r.out?.plan?.basis && d.transition?.trialBase === r.out?.plan?.base)
      }
    }
    check('결정 reasons 에 증거 판정 코드가 남는다',
      [failRun, passRun].every((r) => r.out?.result.decision.reasons.some((x) => x.startsWith(`EVIDENCE ${D} d3 `)) === true))
  }
} finally {
  await wipe()
  await prisma.$disconnect()
  rmSync(HOME, { recursive: true, force: true })
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
if (fail > 0) process.exit(1)
