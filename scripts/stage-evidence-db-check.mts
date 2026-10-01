#!/usr/bin/env tsx
/**
 * 🔴 **단계 승격 운영 증거 — 실제 DB 읽기 · controller 실제 진입점** (2026-09-29 P0 · 격리 Postgres 전용)
 *
 *   ① 실제 행(StageDecision · Queue · Post · Comment · PersonaActivityLog · AutoReadyAudit)을 심고
 *      `readStageEvidenceFacts` → `judgeStageEvidence` 가 PASS 를 낸다
 *   ② 행 하나씩 비틀면(댓글 없음 · 61분 · 지운 댓글 · 자기 글 댓글 · 감사 미판정/시한 초과 · 결함 yes · 표본 0 ·
 *      표본이 자동 target 밖 · 발행 기록 중복 · 같은 Persona 두 번 · 표식 없는 발행 · 편수 부족 · 사람 승인만/혼합 ·
 *      HOLD 결정 · 기록 없는 발행 · 고아 기록) PASS 가 아니다 · 상한 5 에서 5건 PASS · 6건 FAIL
 *   ③ 발행 트랜잭션이 무인 표식을 실제로 남긴다(예약 · unattended) · 수동 단건은 남기지 않는다
 *   ④ `scripts/stage-controller.mts --json` (dry-run) — 전날 FAIL → 계획 d3 재시험 · 전날 PASS → 계획 d5 · DB write 0
 *      🔴 (2026-09-30) 실제 진입점의 preflight 는 Persona 4상태 정본(`readContractValidPersonas`)을 읽는다 — 격리 DB 에는
 *      계약 유효 Persona 가 0 이라 PERSONA_SHORT(personas=0 · 제공자 연결 증명)이다 — 시험이 열리지 않고
 *         지금 단계를 다시 증명한다(REPROVE · 바닥은 PREPARE). 이것이 오늘 운영의 정직한 결과다.
 *   ⑤ REPROVE 증명일 실제 행 → PASS → 다음 날 d5 계획 · HOLD 는 아니다 · controller 진입점: 전날 TRIAL d20 → d20 재시험
 *      계획이어도 preflight(실제 DB·장부 · 계약 유효 Persona 0)가 막는다 · env 단계 키(SORAN_*_STAGE)는 결정에 영향이 없다
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

import { PrismaClient } from '@prisma/client'

import { kstDateString } from '../src/lib/release-canary'
import { previousKstDate, validateStoredDecision, STAGE_DECISION_VERSION, DECISION_WRITER, type ValidatedStageDecision } from '../src/lib/stage-decision-contract'
import { createStageDecision } from '../src/lib/stage-decision-repo'
import { kstDayBounds, readStageEvidenceFacts } from '../src/lib/stage-evidence-repo'
import { publishLatencyHours } from './lib/stage-preflight-facts.mjs'
import { judgeStageEvidence, trialPlanOf, type StageEvidenceVerdict, type EvidenceSideSignals } from '../src/lib/stage-evidence'
import { UNATTENDED_PUBLISH_DECIDED_BY, publishOriginalPostTx } from '../src/lib/original-post-publish-tx'
import { AUTO_FIRST_COMMENT_WINDOW_MS } from '../src/lib/persona-comment-auto-lane'
import { AUDIT_OVERDUE_MS } from '../src/lib/auto-ready-audit-store'
import { AUTOFILL_PROMPT_VERSION, AUTOFILL_MODEL, AUTOFILL_SITE_PREFIX } from '../src/lib/micro-seed-supply-autofill'
import { AUTO_DECIDER } from '../src/lib/auto-ready-v2'
import { observeJob } from './lib/runner-health.mjs'
import { personaCommentCapFor } from '../src/lib/stage-evidence'
import { judgeSlotRelease, publishEventAtOf, releaseStampOf, releaseStampStatusOf, RELEASE_STAMP_KEY } from '../src/lib/source-slot-release'
import { fakeEvidenceGate } from './lib/fake-source-evidence.mjs'

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
        gateVerdict: 'PASS', gateResults: publishedGate(t, `ev-${seq}-${i}`) as never, promptVersion: AUTOFILL_PROMPT_VERSION, model: AUTOFILL_MODEL,
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
  check('편수 3 · 자동 target 3 · 첫 댓글 3 · 감사 기대 ceil(3×20%)=1 · 표본 1', base.counts.published === 3 && base.counts.autoTargets === 3
    && base.counts.firstCommentOk === 3 && base.counts.auditExpected === 1
    && base.counts.auditSampled === 1, JSON.stringify(base.counts))
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
    check('🔴 🔴 **전부 사람 승인(founder) 3건 · 감사 0 → 승격 물량 0 · FAIL (PUBLISH_NOT_AUTO_READY)**',
      v.verdict === 'FAIL' && has(v, 'PUBLISH_NOT_AUTO_READY') && v.counts.autoTargets === 0 && v.counts.humanApproved === 3,
      `${v.verdict} ${v.codes.join(',')} ${JSON.stringify(v.counts)}`)
  }
  await counter('🔴 혼합 — 자동 2 · 사람 승인 1(founder) → PUBLISH_NOT_AUTO_READY', 'PUBLISH_NOT_AUTO_READY', async (s) => {
    await prisma.originalPostApprovalQueue.update({ where: { id: s.queues[2]! }, data: { decidedBy: 'founder' } })
  })
  await counter('🔴 감사 표본이 그날 자동 target 밖(전날 글의 감사를 그날 고름) → AUDIT_OUTSIDE_TARGET', 'AUDIT_OUTSIDE_TARGET', async (s) => {
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
    await prisma.comment.create({ data: { content: '제 글이에요', source: 'SYSTEM', commentOrigin: 'PERSONA', postId: s.posts[0]!, authorId: u,
      personaId: s.authors[0]!, createdAt: new Date(SLOTS[0]!.getTime() + 30 * MIN) } })
  }, undefined, personaCommentCapFor('organic'))
  {
    await wipe()
    const d5 = await storeDecision(TRIAL_D3)
    const s5 = await seedDay()
    for (let k = 0; k < 4; k += 1) {
      const o = await persona(`M${k}-${seq}`)
      const u = (await prisma.persona.findUniqueOrThrow({ where: { id: o }, select: { userId: true } })).userId
      await prisma.comment.create({ data: { content: `저도요 ${k}`, source: 'SYSTEM', commentOrigin: 'PERSONA', postId: s5.posts[0]!, authorId: u,
        personaId: o, createdAt: new Date(SLOTS[0]!.getTime() + (20 + k) * MIN) } })
    }
    const v5 = await verdictOf(d5, personaCommentCapFor('organic'))
    check('🟢 상한 5 — 한 글에 서로 다른 Persona 5건(첫 1 + 추가 4) → PASS', v5.verdict === 'PASS', `${v5.verdict} ${v5.codes.join(',')}`)
    const o6 = await persona(`M6-${seq}`)
    const u6 = (await prisma.persona.findUniqueOrThrow({ where: { id: o6 }, select: { userId: true } })).userId
    await prisma.comment.create({ data: { content: '여섯 번째', source: 'SYSTEM', commentOrigin: 'PERSONA', postId: s5.posts[0]!, authorId: u6,
      personaId: o6, createdAt: new Date(SLOTS[0]!.getTime() + 40 * MIN) } })
    const v6 = await verdictOf(d5, personaCommentCapFor('organic'))
    check('🔴 상한 5 — 6건 → COMMENT_OVER_CAP', v6.verdict === 'FAIL' && has(v6, 'COMMENT_OVER_CAP'), `${v6.verdict} ${v6.codes.join(',')}`)
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
  await counter('🔴 표식 없는 발행(operator — 수동 · 표식 이전)은 자동 target 이 아니다 → PUBLISH_NOT_AUTO_READY', 'PUBLISH_NOT_AUTO_READY', async (s) => {
    await prisma.personaActivityLog.update({ where: { id: s.logs[0]! }, data: { decidedBy: 'operator' } })
  })
  await counter('🔴 2건만 냈다 → PUBLISH_NOT_AUTO_READY', 'PUBLISH_NOT_AUTO_READY', async (s) => {
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
    writeFileSync(join(APP, 'env.local'), [
      'SORAN_RELEASE_STAGE=d1', 'SORAN_CAPACITY_STAGE=d10', 'STAGE_CONTROLLER_ENABLED=on', 'SORAN_PERSONA_COMMENT_STAGE=bootstrap-auto',
      'SORAN_LLM_DAILY_BUDGET_USD=0.5', 'SORAN_LLM_RUN_REQUEST_CAP=20', 'SORAN_LLM_RESERVE_HEADROOM=1.2',
      'SORAN_AUDIT_LLM_DAILY_BUDGET_USD=0.3', 'SORAN_AUDIT_LLM_RUN_REQUEST_CAP=25', 'SORAN_AUDIT_LLM_RESERVE_HEADROOM=1.5', '',
    ].join('\n'), { mode: 0o600 })
    type Out = {
      evidence: StageEvidenceVerdict | null
      plan: { base: string; target: string; basis: string } | null
      result: { decision: { state: string; release: string; capacity: string; reasons: string[]; blocks: { code: string }[]; transition: { trialBase?: string; basis?: string } | null }; brake: string }
      nextPreflight?: { stage: string; verdict: string; codes: string[]; counts: Record<string, number> } | null
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
    {
      /**
       * 🔴 (2026-09-30) 실제 진입점 — Persona 4상태 정본이 연결돼 있다. 격리 DB 에는 계약 유효 Persona 가 0 →
       *    preflight 가 PERSONA_SHORT(personas=0) → 시험은 열리지 않는다. 지속 단계를 다시 증명한다.
       *    🔴 personas 가 null(PERSONA_UNKNOWN)이면 제공자 미연결이다 — 그것도 실패로 본다.
       *    TRIAL 경로 자체(PASS → d5 · FAIL → d3 재시험)는 같은 정본 함수로 `stage:evidence-check` ③ 이 본다.
       */
      const fd = failRun.out?.result.decision
      const pd = passRun.out?.result.decision
      const pfPersonaShort = (o: Out | null): boolean => o?.nextPreflight !== null && o?.nextPreflight !== undefined
        && o.nextPreflight.verdict !== 'PASS' && o.nextPreflight.codes.includes('PERSONA_SHORT')
        && !o.nextPreflight.codes.includes('PERSONA_UNKNOWN') && o.nextPreflight.counts.personas === 0
      const pfBlocked = (d: Out['result']['decision'] | undefined): boolean =>
        d !== undefined && d.blocks.some((b) => b.code === 'PREFLIGHT_UNKNOWN' || b.code === 'PREFLIGHT_FAIL')
      check('🔴 🔴 **러너 수준 — 전날 FAIL → 계획 d3 재시험 · 계약 유효 Persona 0(연결됨) → 시험 없이 바닥 PREPARE d1**',
        fd?.state === 'PREPARE' && fd.release === 'd1' && pfBlocked(fd) && pfPersonaShort(failRun.out),
        `${fd?.state} ${fd?.release} ${JSON.stringify(failRun.out?.nextPreflight)}`)
      if (launchdOk) {
        check('🟢 🔴 **러너 수준 — 전날 PASS → 지속 d3(증명됐다) · 계획 d5 · 계약 유효 Persona 0(연결됨) → REPROVE d3 (d5 를 열지 않는다)**',
          pd?.state === 'REPROVE' && pd.release === 'd3' && pfBlocked(pd) && pfPersonaShort(passRun.out),
          `${pd?.state} ${pd?.release}`)
      }
    }
    for (const r of [failRun, passRun]) {
      const d = r.out?.result.decision
      if (d?.state === 'TRIAL') {
        check(`TRIAL ${d.release} 결정의 근거 칸이 계획과 같다`, d.transition?.basis === r.out?.plan?.basis && d.transition?.trialBase === r.out?.plan?.base)
      }
    }
    check('결정 reasons 에 증거 판정 코드가 남는다',
      [failRun, passRun].every((r) => r.out?.result.decision.reasons.some((x) => x.startsWith(`EVIDENCE ${D} d3 `)) === true))

    console.log('\n⑤ REPROVE 증명일 · D20 진입점 (2026-09-29 generic scheduler 배선)')
    {
      // (가) REPROVE d3 실제 행 — 자동 3편 · 첫 댓글 · 감사 표본 → PASS → 다음 날 d5 시험
      await wipe()
      const reprove = await storeDecision({ release: 'd3', state: 'REPROVE' })
      await seedDay()
      const rv = await verdictOf(reprove)
      check('🟢 REPROVE d3 증명일 · 실제 행 6조건 → PASS', rv.verdict === 'PASS', `${rv.verdict} ${rv.codes.join(',')}`)
      const rp = trialPlanOf(reprove, rv)
      check('🟢 REPROVE PASS 다음 날 = d5 시험 (기반 d3 · PASS)', rp?.target === 'd5' && rp.base === 'd3' && rp.basis === 'PASS', JSON.stringify(rp))
      await wipe()
      const hold = await storeDecision({ release: 'd3', state: 'HOLD' })
      await seedDay()
      const hv = await verdictOf(hold)
      check('🔴 HOLD d3 는 같은 행이어도 DECISION_NOT_TRANSITION → 계획 없음', hv.verdict === 'FAIL' && has(hv, 'DECISION_NOT_TRANSITION')
        && trialPlanOf(hold, hv) === null)

      // (나) controller 진입점 — 전날 TRIAL d20(기반 d10) · 증거 없음 → d20 재시험 계획 · preflight 가 막는다
      const envWith = (release: string, capacity: string): void => {
        writeFileSync(join(APP, 'env.local'), [
          `SORAN_RELEASE_STAGE=${release}`, `SORAN_CAPACITY_STAGE=${capacity}`, 'STAGE_CONTROLLER_ENABLED=on', 'SORAN_PERSONA_COMMENT_STAGE=bootstrap-auto',
          'SORAN_LLM_DAILY_BUDGET_USD=0.5', 'SORAN_LLM_RUN_REQUEST_CAP=20', 'SORAN_LLM_RESERVE_HEADROOM=1.2',
          'SORAN_AUDIT_LLM_DAILY_BUDGET_USD=0.3', 'SORAN_AUDIT_LLM_RUN_REQUEST_CAP=25', 'SORAN_AUDIT_LLM_RESERVE_HEADROOM=1.5', '',
        ].join('\n'), { mode: 0o600 })
      }
      const trialD20 = { capacity: 'd30', release: 'd20', state: 'TRIAL', transition: { kind: 'TRIAL', trialBase: 'd10', previousKstDate: D_PREV, target: 'd20', basis: 'PASS' } }
      await wipe()
      await storeDecision(trialD20)
      await seedStock()
      envWith('d10', 'd10')
      const c1 = runController()
      const r1 = c1.out?.result.decision
      console.log(`   (나-1) 전날 TRIAL d20 · 증거 없음 → ${show(c1.out)} · preflight ${c1.out?.nextPreflight?.verdict} [${c1.out?.nextPreflight?.codes.join(',')}]`)
      check('exit 0 (dry-run)', c1.code === 0, c1.raw)
      check('전날 d20 이 PASS 가 아니다 → 계획 = d20 재시험(기반 d10 · RETEST)', c1.out?.plan?.target === 'd20' && c1.out.plan.base === 'd10'
        && c1.out.plan.basis === 'RETEST', JSON.stringify(c1.out?.plan))
      check('🔴 🔴 **실제 DB · 장부로 모은 d20 preflight 가 PASS 가 아니다(계약 유효 Persona 0 · 단가 모름)**',
        c1.out?.nextPreflight?.stage === 'd20' && c1.out.nextPreflight.verdict !== 'PASS'
        && c1.out.nextPreflight.codes.includes('PERSONA_SHORT') && c1.out.nextPreflight.counts.personas === 0
        && c1.out.nextPreflight.codes.includes('COMMENT_COST_UNKNOWN'),
      JSON.stringify(c1.out?.nextPreflight))
      check('🔴 🔴 **preflight 가 막으면 d20 시험을 열지 않는다 — 지속 d10 을 다시 증명(REPROVE) · capacity 는 다음 증명 d20**', r1 !== undefined
        && !(r1.state === 'TRIAL' && r1.release === 'd20') && r1.release === 'd10' && r1.capacity === 'd20'
        && r1.blocks.some((b) => b.code === 'PREFLIGHT_UNKNOWN' || b.code === 'PREFLIGHT_FAIL'),
      `${r1?.state} ${r1?.release} ${r1?.capacity} ${JSON.stringify(r1?.blocks)}`)
      // 🔴 env 단계 키는 결정의 입력이 아니다 — d50/d100 을 적어도 같은 결정이다
      envWith('d50', 'd100')
      const c2 = runController()
      const r2 = c2.out?.result.decision
      check('🔴 🔴 **env 에 SORAN_RELEASE_STAGE=d50 · CAPACITY=d100 을 적어도 결정은 그대로 — 단계 입력원은 StageDecision 하나**',
        c2.code === 0 && r2 !== undefined && r1 !== undefined && r2.state === r1.state && r2.release === r1.release && r2.capacity === r1.capacity,
        `${r2?.state} ${r2?.release} ${r2?.capacity}`)
      check('🔴 dry-run — 오늘 결정 행 0 (DB write 0)', (await prisma.stageDecision.count({ where: { kstDate: TODAY } })) === 0)
    }
  }
} finally {
  await wipe()
  await prisma.$disconnect()
  rmSync(HOME, { recursive: true, force: true })
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
if (fail > 0) process.exit(1)
