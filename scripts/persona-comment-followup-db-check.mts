#!/usr/bin/env tsx
/**
 * 🔴 **첫 댓글 뒤 추가 댓글 — 격리 Postgres 실행 검사** (2026-10-14 · PR #704)
 *
 *   실제 경로 그대로 돈다: `runFollowupPhase` → 실제 DB 사실(출처 · 신고 · 반응 분류) → `judgeFollowupTick`·`judgeFollowupPost`
 *   → 9관문 정본(`checkCommentCandidate`) → 도장 PENDING 적재 → `publishCandidateTx({ followupLane: true })`(Serializable).
 *   그날 단계 · 대화 감사는 진입점과 같은 `readFollowupContext` 가 실제 행에서 읽는다.
 *   가짜는 두 곳뿐이다 — **생성 텍스트**(네트워크 0)와 **② 코퍼스 빈도**.
 *
 * 🔴 운영 DB 에 붙지 않는다(sentinel · localhost · soran_test). 운영 장부·자산·env·profile 0 — 전부 임시 HOME 아래.
 *
 *   DATABASE_URL=… DIRECT_URL=… SORAN_ISOLATED_DB=yes-throwaway npm run persona:followup-db-check
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL = process.env.DATABASE_URL ?? ''
{
  const problems: string[] = []
  if ((process.env.SORAN_ISOLATED_DB ?? '').trim() !== 'yes-throwaway') problems.push('SORAN_ISOLATED_DB=yes-throwaway 가 없다')
  if (!/^postgresql:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\//.test(URL)) problems.push('DATABASE_URL 이 localhost 주소가 아니다')
  if (!/\/soran_test(\?|$)/.test(URL)) problems.push('DATABASE_URL 의 DB 이름이 soran_test 가 아니다')
  if (problems.length > 0) {
    console.error('🔴 격리 DB 가 아니다. 멈춘다.')
    for (const p of problems) console.error(`   · ${p}`)
    process.exit(2)
  }
}

// ── 🔴 임시 HOME — 정본 파일·장부·profile 이 전부 이 아래다. 모듈을 읽기 **전에** 바꾼다 ──
const HOME = mkdtempSync(join(tmpdir(), 'soran-followup-db-'))
process.env.HOME = HOME
process.env.SORAN_PERSONA_COMMENT_STAGE = 'bootstrap-auto'
delete process.env.SORAN_PERSONA_COMMENT_FOLLOWUP
delete process.env.SORAN_PERSONA_COMMENT_FOLLOWUP_PROFILE

const { PrismaClient } = await import('@prisma/client')
const { buildCanonFromScoring, provenanceOf, readConfirmedSelection, ARTIFACT_ROOT, MODEL_CANON_FILE } =
  await import('../src/lib/persona-comment-provenance')
const { SANITIZER_VERSION } = await import('../src/lib/persona-eval-invalidation')
const { REFERENCE_MANIFEST_FILE } = await import('../src/lib/persona-reference-asset')
const { GATE_CODES } = await import('../src/lib/persona-comment-gate-report')
const { publishCandidateTx } = await import('../src/lib/persona-publish-tx')
const { AUTO_LANE_ACTIVITY_DECIDED_BY, AUTO_LANE_DECIDED_BY } = await import('../src/lib/persona-comment-auto-lane')
const F = await import('../src/lib/persona-comment-followup')
const {
  FOLLOWUP_LANE_ACTIVITY_DECIDED_BY, FOLLOWUP_LANE_DECIDED_BY, judgeConversationAudit, judgeEvidenceForTarget, personaCommentProvenanceOf,
} = await import('../src/lib/stage-evidence')
const { readStageEvidenceFacts } = await import('../src/lib/stage-evidence-repo')
const { kstDateString } = await import('../src/lib/release-canary')
const { createStageDecision } = await import('../src/lib/stage-decision-repo')
const { validateStoredDecision, STAGE_DECISION_VERSION, DECISION_WRITER } = await import('../src/lib/stage-decision-contract')
const { spawnSync } = await import('node:child_process')
const { fileURLToPath } = await import('node:url')
const { dirname } = await import('node:path')
const { makeDbTargetSource } = await import('./lib/persona-comment-source-db')
const { runCommentLoop, sweepAutoLane } = await import('./lib/persona-comment-loop.mjs')
const { createAttemptStore } = await import('./lib/persona-comment-attempt-store.mjs')
/** 🔴 호출마다 빈 시도 기억 — 이 검사의 시나리오는 서로 이어지지 않는다(첫 댓글 시도 기억 자체는 loop-check 가 시험한다) */
const freshAttemptStore = () => createAttemptStore({ dir: mkdtempSync(join(HOME, 'attempts-')) })
const { runFollowupPhase, readFollowupContext, sweepFollowupLane, FOLLOWUP_EXPIRE_REASON } = await import('./lib/persona-comment-followup-run.mjs')
const { SupplyLlmSession } = await import('./lib/supply-llm-call.mjs')
const { judgeCommentCall } = await import('./lib/persona-comment-call.mjs')
const { readLedgerToday } = await import('./lib/ops-signals.mjs')
const { commentLoopLimitsFromEnv } = await import('../src/lib/persona-comment-auto-lane')
const { BOOTSTRAP_DAILY_MAX } = await import('../src/lib/persona-comment-bootstrap-budget')
type TargetSource = import('./lib/persona-comment-targets').TargetSource
type FollowupGenerate = import('./lib/persona-comment-followup-run.mjs').FollowupGenerate
type FollowupPhaseReport = import('./lib/persona-comment-followup-run.mjs').FollowupPhaseReport

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else { fail += 1; console.log(`  ❌ ${label}${detail === '' ? '' : ` — ${detail}`}`) }
}

// ── 🔴 확정 모델 정본 (임시 HOME · 운영과 같은 모양) ──
const RUN_ID = '20261014-120000'
const SUMMARY = JSON.stringify({
  s: 1,
  referenceManifest: {
    sanitizerVersion: SANITIZER_VERSION, sourceDigest: '0123456789abcdef', sanitizedCorpusDigest: 'fedcba9876543210',
    commentCount: 12, personaBundleDigest: 'aabbccddeeff0011', identityLeakCheck: { ran: true, hits: 0, detail: 'ok' },
  },
})
mkdirSync(join(ARTIFACT_ROOT, RUN_ID), { recursive: true })
writeFileSync(join(ARTIFACT_ROOT, RUN_ID, 'summary.json'), SUMMARY)
writeFileSync(join(ARTIFACT_ROOT, RUN_ID, 'samples.json'), '{"m":2}')
writeFileSync(join(ARTIFACT_ROOT, RUN_ID, 'key.json'), '{"k":3}')
const CANON = buildCanonFromScoring({
  runId: RUN_ID, summaryJson: SUMMARY, samplesJson: '{"m":2}', keyJson: '{"k":3}',
  winner: 'gemini-3.7-flash', decidedBy: 'check', decidedAt: '2026-10-14T00:00:00Z', scoredSamples: 9,
})
writeFileSync(MODEL_CANON_FILE, JSON.stringify(CANON))
mkdirSync(join(REFERENCE_MANIFEST_FILE, '..'), { recursive: true })
writeFileSync(REFERENCE_MANIFEST_FILE, JSON.stringify({
  sanitizedCorpusDigest: 'fedcba9876543210', identityLeakCheck: { ran: true, hits: 0, detail: 'ok' },
}))
const canonRead = readConfirmedSelection()
const PROV = provenanceOf(CANON)

// ── 🔴 승인 profile 파일 (임시 HOME) — 그날 단계 d5 ──
const STAGE = 'd5'
const PROFILE_PATH = join(HOME, 'followup-profile.json')
const PROFILE = {
  v: F.FOLLOWUP_PROFILE_VERSION, stage: F.FOLLOWUP_PROFILE_ALL_STAGES, dailyCount: 40, dailyUsd: 0.08, runMax: 3, perPersonaDailyMax: 3,
  approvedBy: 'fixture-founder', approvedAt: '2026-10-14T09:00:00+09:00',
}
const writeProfile = (p: unknown): void => writeFileSync(PROFILE_PATH, JSON.stringify(p))
const followupOn = (on: boolean): void => {
  if (on) {
    process.env.SORAN_PERSONA_COMMENT_FOLLOWUP = 'on'
    process.env.SORAN_PERSONA_COMMENT_FOLLOWUP_PROFILE = PROFILE_PATH
  } else {
    delete process.env.SORAN_PERSONA_COMMENT_FOLLOWUP
    delete process.env.SORAN_PERSONA_COMMENT_FOLLOWUP_PROFILE
  }
}

const prisma = new PrismaClient()

// ─────────────────────────────────────────────────────────
// fixture
// ─────────────────────────────────────────────────────────
async function wipe(): Promise<void> {
  await prisma.report.deleteMany({})
  await prisma.comment.deleteMany({ where: { parentId: { not: null } } })
  await prisma.comment.deleteMany({})
  await prisma.personaApprovalQueue.deleteMany({})
  await prisma.personaActivityLog.deleteMany({})
  await prisma.post.deleteMany({})
  await prisma.persona.deleteMany({})
  await prisma.account.deleteMany({})
  await prisma.user.deleteMany({})
  await prisma.personaGlobalSwitch.deleteMany({})
  await prisma.stageDecision.deleteMany({})
}
/** 🔴 consumer(`consumerEnvOf`)가 넣는 결정 env 모양 그대로 — 표식 · 공개 · 천장. ⑪ 은 실제 consumer 프로세스로 같은 것을 만든다 */
async function stageDecisionToday(release = STAGE, capacity = 'd10'): Promise<void> {
  process.env.SORAN_STAGE_DECISION_DATE = kstDateString(new Date())
  process.env.SORAN_RELEASE_STAGE = release
  process.env.SORAN_CAPACITY_STAGE = capacity
}
const clearDecisionEnv = (): void => {
  for (const k of ['SORAN_STAGE_DECISION_DATE', 'SORAN_RELEASE_STAGE', 'SORAN_CAPACITY_STAGE', 'SORAN_STAGE_PROOF_STAGE', 'SORAN_STAGE_PROOF_DATE']) delete process.env[k]
}
let seq = 0
type P = { id: string; userId: string; code: string }
async function persona(code: string): Promise<P> {
  seq += 1
  const u = await prisma.user.create({ data: { nickname: `fu${seq}zz` }, select: { id: true } })
  const p = await prisma.persona.create({
    data: {
      code, userId: u.id, status: 'active', ageBand: '50대 초반', region: '경기', lifeStage: '갱년기',
      identity: { menopauseStatus: '중', maritalStatus: '기혼' }, voiceCore: { ending: '요', register: '존댓말', length: '짧게' },
      voiceVariations: {}, dailyCap: 10, weeklyCap: 40,
    },
    select: { id: true },
  })
  return { id: p.id, userId: u.id, code }
}
const MIN = 60_000
const KST_OFFSET_MS = 9 * 60 * MIN
const kstDayStartMs = (nowMs: number): number => {
  const kst = new Date(nowMs + KST_OFFSET_MS)
  return Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - KST_OFFSET_MS
}
const managedCreatedAtMs = (nowMs: number, minutesAgo: number): number =>
  Math.max(nowMs - minutesAgo * MIN, kstDayStartMs(nowMs) + 1)
async function post(author: P, minutesAgo: number): Promise<string> {
  seq += 1
  const now = Date.now()
  const publishedAt = now - minutesAgo * MIN
  // The bootstrap budget deliberately counts rows created in today's KST
  // operating day. Keep that fact explicit even when CI runs just after
  // midnight and the aged publishAt belongs to yesterday.
  const createdAt = managedCreatedAtMs(now, minutesAgo)
  const p = await prisma.post.create({
    data: {
      boardType: 'FREE', title: `요즘 밤마다 잠이 안 와요 ${seq}`, status: 'PUBLISHED', source: 'SYSTEM',
      content: `새벽 세 시만 되면 눈이 떠져서 다시 잠들기가 어렵네요. 다들 이런 밤 어떻게 보내세요? (${seq})`,
      authorId: author.userId, personaId: author.id, publishAt: new Date(publishedAt),
      createdAt: new Date(createdAt),
    },
    select: { id: true },
  })
  return p.id
}
/** 🔴 무인 첫 댓글 레인이 남기는 세 행 그대로 — Comment · Queue(PUBLISHED · auto 표식) · ActivityLog(auto) */
async function autoFirst(by: P, postId: string, minutesAgo: number, text = '저도 새벽에 깨면 다시 잠들기 힘들더라고요. 그럴 땐 뭐 하세요?'): Promise<string> {
  const at = new Date(Date.now() - minutesAgo * MIN)
  const c = await prisma.comment.create({
    data: { postId, authorId: by.userId, content: text, source: 'SYSTEM', commentOrigin: 'PERSONA', personaId: by.id, createdAt: at },
    select: { id: true },
  })
  seq += 1
  await prisma.personaApprovalQueue.create({ data: {
    personaId: by.id, targetPostId: postId, status: 'PUBLISHED', candidateText: text, reactionType: 'question',
    gateStatus: 'pass', gateResults: [], dedupKey: `comment:${postId}:${by.code}:question:${seq}`,
    decidedBy: AUTO_LANE_DECIDED_BY, decidedAt: at, publishedCommentId: c.id,
  } })
  await prisma.personaActivityLog.create({ data: {
    personaId: by.id, kind: 'comment', targetId: c.id, gateStatus: 'pass', decidedBy: AUTO_LANE_ACTIVITY_DECIDED_BY, publishedAt: at, createdAt: at,
  } })
  return c.id
}
async function member(postId: string, minutesAgo: number, parentId: string | null = null): Promise<string> {
  seq += 1
  const u = await prisma.user.create({ data: { nickname: `mem${seq}qq` }, select: { id: true } })
  await prisma.account.create({ data: { userId: u.id, type: 'oauth', provider: 'kakao', providerAccountId: `k${seq}` } })
  const c = await prisma.comment.create({
    data: { postId, authorId: u.id, content: `저도 그래요 ${seq}`, commentOrigin: 'MEMBER', parentId, createdAt: new Date(Date.now() - minutesAgo * MIN) },
    select: { id: true },
  })
  return c.id
}
/** 🔴 시간이 흐른 것처럼 — 그 글의 댓글 · Queue 결정 · ActivityLog 시각을 **같은 폭**으로 과거로 민다(출처 정합 유지) */
async function ageAll(postId: string, minutes: number): Promise<void> {
  const d = minutes * MIN
  const cs = await prisma.comment.findMany({ where: { postId }, select: { id: true, createdAt: true } })
  for (const c of cs) {
    await prisma.comment.update({ where: { id: c.id }, data: { createdAt: new Date(c.createdAt.getTime() - d) } })
    const qs = await prisma.personaApprovalQueue.findMany({ where: { publishedCommentId: c.id }, select: { id: true, decidedAt: true } })
    for (const q of qs) if (q.decidedAt !== null) await prisma.personaApprovalQueue.update({ where: { id: q.id }, data: { decidedAt: new Date(q.decidedAt.getTime() - d) } })
    const ls = await prisma.personaActivityLog.findMany({ where: { targetId: c.id }, select: { id: true, publishedAt: true, createdAt: true } })
    for (const l of ls) {
      await prisma.personaActivityLog.update({ where: { id: l.id }, data: {
        createdAt: new Date(l.createdAt.getTime() - d), ...(l.publishedAt === null ? {} : { publishedAt: new Date(l.publishedAt.getTime() - d) }),
      } })
    }
  }
  const p = await prisma.post.findUniqueOrThrow({ where: { id: postId }, select: { publishAt: true, createdAt: true } })
  await prisma.post.update({ where: { id: postId }, data: {
    // Keep the managed-post row in today's KST budget cohort while aging the
    // public conversation. Otherwise repeated 75-minute aging crosses midnight
    // and tests a different day's budget instead of the five-comment cap.
    createdAt: new Date(Math.max(p.createdAt.getTime() - d, kstDayStartMs(Date.now()) + 1)),
    ...(p.publishAt === null ? {} : { publishAt: new Date(p.publishAt.getTime() - d) }),
  } })
}

/** 🔴 네트워크 0 — 매번 다른 문장(같은 말 반복 차단에 걸리지 않게) · 부른 횟수를 센다 */
/** 🔴 9관문 정본을 그대로 통과하는 문장만 — 근거 없는 1인칭 경험(⑦)을 넣지 않는다 */
const REPLIES = [
  '그 시간에 깨면 괜히 생각이 많아지죠. 오늘 밤은 조금 더 편히 주무셨으면 해요.',
  '읽기만 해도 그 새벽이 그려지네요. 다들 비슷한 밤을 보내고 있었나 봐요.',
  '맞아요 그런 날은 하루 종일 멍하죠. 낮에 잠깐이라도 쉬실 수 있으면 좋겠어요.',
  '새벽 세 시라니 너무 공감돼요. 이렇게 털어놓으니 조금은 덜 외로우시죠.',
  '어머 그 마음 알 것 같아요. 잠 못 드는 밤엔 시간이 참 느리게 가죠.',
  '고개가 절로 끄덕여지는 이야기네요. 오늘은 꼭 푹 주무시길 바랄게요.',
]
function fakeGen(texts: readonly string[] = REPLIES): { gen: FollowupGenerate; calls: () => number } {
  let n = 0
  return { gen: async () => { const t = texts[n % texts.length]!; n += 1; return { ok: true, text: t, errorCode: null } }, calls: () => n }
}
function source(): TargetSource {
  const base = makeDbTargetSource({ prisma, windowStart: new Date(Date.now() - 7 * 86_400_000) })
  return { ...base, frequency: async () => ({ corpus: { lookup: () => 7, size: 1000, corpusName: 'comment' }, reason: 'fixture corpus' }) }
}
const PASS_AUDIT = { verdict: 'PASS', codes: [], counts: {} }
async function phase(gen: FollowupGenerate, over: Partial<Parameters<typeof runFollowupPhase>[0]> = {}): Promise<FollowupPhaseReport> {
  const now = new Date()
  const ctx = await readFollowupContext({ prisma, now, env: process.env, readText: (p) => readFileSync(p, 'utf-8') })
  return runFollowupPhase({
    prisma, now, env: process.env, source: source(), canon: canonRead,
    makeGenerate: () => gen, generation: { ok: true, reason: '' },
    ledger: { entries: [], capUsd: 0.2, headroom: 1.5 },
    ...ctx, ...over,
  })
}
const personaRows = (postId: string) => prisma.comment.findMany({
  where: { postId, commentOrigin: 'PERSONA' }, orderBy: { createdAt: 'asc' },
  select: { id: true, personaId: true, parentId: true, isDeleted: true, createdAt: true, postId: true },
})
async function provOf(commentId: string): Promise<string> {
  const c = await prisma.comment.findUniqueOrThrow({ where: { id: commentId }, select: { postId: true, personaId: true, createdAt: true, parentId: true } })
  const qs = await prisma.personaApprovalQueue.findMany({ where: { publishedCommentId: commentId },
    select: { targetPostId: true, personaId: true, status: true, decidedBy: true, decidedAt: true } })
  const ls = await prisma.personaActivityLog.findMany({ where: { kind: 'comment', targetId: commentId }, select: { personaId: true, decidedBy: true, publishedAt: true } })
  return personaCommentProvenanceOf({
    comment: { postId: c.postId, personaId: c.personaId, createdAtMs: c.createdAt.getTime(), topLevel: c.parentId === null },
    queues: qs.map((x) => ({ ...x, decidedAtMs: x.decidedAt?.getTime() ?? null })),
    logs: ls.map((x) => ({ ...x, publishedAtMs: x.publishedAt?.getTime() ?? null })),
  })
}
/** 🔴 PENDING 추가 댓글 행을 손으로 넣는다 — planner 를 우회해도 트랜잭션이 막는지 본다 */
async function injectFollowup(
  by: P,
  postId: string,
  stamp: Record<string, unknown>,
  ordinal: number,
  text = '그 시간에 깨면 괜히 생각이 많아지죠. 오늘 밤은 조금 더 편히 주무셨으면 해요.',
): Promise<string> {
  const q = await prisma.personaApprovalQueue.create({
    data: {
      personaId: by.id, targetPostId: postId, status: 'PENDING',
      candidateText: text,
      reactionType: 'experience', gateStatus: 'pass',
      gateResults: GATE_CODES.map((g) => ({ gate: g, outcome: 'pass', detail: 'fx' })),
      dedupKey: F.followupKeyOf(postId, ordinal), editDiff: JSON.parse(JSON.stringify({ [F.FOLLOWUP_STAMP_FIELD]: stamp })),
      generatedModel: PROV.model, canonRunId: PROV.canonRunId, canonDigest: PROV.canonDigest,
    },
    select: { id: true },
  })
  return q.id
}
const stamp = (postId: string, ordinal: number, parentCommentId: string | null, hook = 'question') =>
  ({ v: F.FOLLOWUP_STAMP_VERSION, postId, ordinal, parentCommentId, hook })

async function main(): Promise<void> {
  console.log('\n══ 첫 댓글 뒤 추가 댓글 — 격리 DB 실행 검사 (운영 DB 0 · 네트워크 0) ══\n')
  check('🔴 임시 HOME 의 확정 정본이 운영과 같은 함수로 확정된다', canonRead.selection?.status === 'confirmed', canonRead.detail)
  const midnightKst = Date.parse('2026-10-15T00:05:00+09:00')
  check('🔴 자정 직후에도 오래된 공개 글의 createdAt 은 오늘 KST 예산 cohort 에 남는다',
    kstDateString(new Date(managedCreatedAtMs(midnightKst, 120))) === '2026-10-15')

  console.log('\n① 기본 OFF — 스위치가 없으면 아무것도 바뀌지 않는다')
  {
    await wipe(); await stageDecisionToday(); writeProfile(PROFILE); followupOn(false)
    const a = await persona('P01'); const b = await persona('P02'); await persona('P03')
    const pid = await post(a, 120); await autoFirst(b, pid, 100)
    const before = { q: await prisma.personaApprovalQueue.count(), c: await prisma.comment.count() }
    const g = fakeGen()
    const r = await phase(g.gen)
    check('🔴 OFF → outcome OFF · provider 0 · Queue·Comment 행 변화 0', r.outcome === 'OFF' && g.calls() === 0
      && (await prisma.personaApprovalQueue.count()) === before.q && (await prisma.comment.count()) === before.c, r.reason)
    process.env.SORAN_PERSONA_COMMENT_FOLLOWUP = 'ON'
    const r2 = await phase(g.gen)
    check('🔴 오타 값(ON) → OFF', r2.outcome === 'OFF' && g.calls() === 0)
    followupOn(false)
  }

  console.log('\n② 첫 댓글 회귀 — 스위치 on 이어도 첫 댓글 경로는 그대로 1건 · 추가 댓글 0(시간차)')
  {
    await wipe(); await stageDecisionToday(); writeProfile(PROFILE); followupOn(true)
    const a = await persona('P01'); await persona('P02'); await persona('P03')
    const pid = await post(a, 5)
    const g = fakeGen()
    const r = await runCommentLoop({
      prisma, now: new Date(), env: process.env, live: true, source: source(), canon: canonRead,
      makeGenerate: () => async () => ({ ok: true, text: '읽으면서 고개가 계속 끄덕여졌어요. 그런 밤은 괜히 마음이 싱숭생숭하죠. 오늘은 푹 주무셨으면 좋겠네요~', errorCode: null }),
      generation: { ok: true, reason: '' }, runRequestCap: 6, attemptStore: freshAttemptStore(),
      followupPhase: () => phase(g.gen),
    })
    const cs = await personaRows(pid)
    check('🔴 첫 댓글 정확히 1건 · 최상위 · 출처 auto', cs.length === 1 && cs[0]!.parentId === null && (await provOf(cs[0]!.id)) === 'auto',
      `${cs.length} ${JSON.stringify(r.sweepAfter?.lines)}`)
    check('🔴 같은 회차 추가 댓글 0 · provider 0(방금 단 첫 댓글 → 시간차)', g.calls() === 0 && r.followup !== null && r.followup?.enqueued === 0,
      JSON.stringify(r.followup?.lines))
    // 🔴 대화 감사 FAIL 이어도 첫 댓글은 멈추지 않는다 — 브레이크는 추가 댓글만 막는다
    const pid2 = await post(a, 5)
    const g2 = fakeGen()
    const r2 = await runCommentLoop({
      prisma, now: new Date(), env: process.env, live: true, source: source(), canon: canonRead,
      makeGenerate: () => async () => ({ ok: true, text: '어머 그 새벽 얼마나 길게 느껴지셨을까요. 오늘은 꼭 푹 주무셨으면 좋겠어요.', errorCode: null }),
      generation: { ok: true, reason: '' }, runRequestCap: 6, attemptStore: freshAttemptStore(),
      followupPhase: () => phase(g2.gen, { conversationAudit: { verdict: 'FAIL', codes: ['FOLLOWUP_SELF'], counts: {} } }),
    })
    const cs2 = await personaRows(pid2)
    check('🔴 대화 감사 FAIL → 첫 댓글은 그대로 1건(auto) · 추가 댓글 provider 0',
      cs2.length === 1 && (await provOf(cs2[0]!.id)) === 'auto' && g2.calls() === 0 && r2.followup?.outcome === 'TICK_ZERO',
      `${cs2.length} ${r2.followup?.reason} ${JSON.stringify(r2.outcomes.map((o) => o.step + ':' + o.reason))}`)
    followupOn(false)
  }

  console.log('\n③ 정상 — 첫 댓글(질문) 뒤 답글 1건 · 정본 표식 · 장부 단계 분리 · 단계 증거 분리')
  {
    await wipe(); await stageDecisionToday(); writeProfile(PROFILE); followupOn(true)
    const a = await persona('P01'); const b = await persona('P02'); await persona('P03'); await persona('P04')
    const pid = await post(a, 200); const first = await autoFirst(b, pid, 180)
    // 🔴 실제 장부 세션 — 추가 댓글 생성이 `commentFollowupGen` 줄로 남는가(가짜 fetch · 네트워크 0)
    const ledgerDir = join(HOME, 'ledger-followup')
    mkdirSync(ledgerDir, { recursive: true })
    const session = new SupplyLlmSession({ runId: 'fu-db', dir: ledgerDir, limits: commentLoopLimitsFromEnv({}).limits })
    const realFetch = globalThis.fetch
    process.env.GEMINI_API_KEY = 'fixture-fake-key'
    let genFetch = 0
    globalThis.fetch = (async (url: string | URL | Request) => {
      if (String(url).includes(':countTokens')) return new Response(JSON.stringify({ totalTokens: 1400 }), { status: 200 })
      genFetch += 1
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ comment: REPLIES[0] }) }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 1400, candidatesTokenCount: 60, totalTokenCount: 1460 },
      }), { status: 200 })
    }) as typeof globalThis.fetch
    let r: FollowupPhaseReport
    try {
      const gen: FollowupGenerate = async ({ model }) => judgeCommentCall(await session.call({
        stage: 'commentFollowupGen', model: model as 'gemini-3.7-flash', systemPrompt: 's', userPayload: 'u', maxOutputTokens: 800, timeoutMs: 5_000,
      }))
      r = await phase(gen)
    } finally { globalThis.fetch = realFetch }
    const cs = await personaRows(pid)
    const fu = cs.find((c) => c.id !== first)
    check('🔴 Persona 댓글 총 2건 — 추가 1건', cs.length === 2, `${cs.length} ${JSON.stringify(r.lines)} ${JSON.stringify(r.sweepAfter?.lines)}`)
    check('🔴 추가 댓글은 첫 댓글(질문)에 글쓴이가 단 답글 · 첫 댓글 Persona 아님',
      fu !== undefined && fu.parentId === first && fu.personaId === a.id && fu.personaId !== b.id)
    const q = fu === undefined ? null : await prisma.personaApprovalQueue.findFirst({ where: { publishedCommentId: fu.id },
      select: { decidedBy: true, status: true, dedupKey: true, editDiff: true } })
    const log = fu === undefined ? null : await prisma.personaActivityLog.findFirst({ where: { targetId: fu.id }, select: { decidedBy: true } })
    check('🔴 Queue PUBLISHED · 정본 표식 · 열쇠 (글·순번2) · 도장', q?.status === 'PUBLISHED' && q.decidedBy === FOLLOWUP_LANE_DECIDED_BY
      && q.dedupKey === F.followupKeyOf(pid, 2) && F.verifyStamp(F.stampFromEditDiff(q.editDiff), { postId: pid, dedupKey: q.dedupKey }).ok)
    check('🔴 ActivityLog 표식 auto-followup', log?.decidedBy === FOLLOWUP_LANE_ACTIVITY_DECIDED_BY)
    check('🔴 출처: 첫 댓글 auto · 추가 댓글 followup', (await provOf(first)) === 'auto' && fu !== undefined && (await provOf(fu.id)) === 'followup')
    const led = readLedgerToday(ledgerDir, new Date())
    const stages = (led.entries ?? []).filter((e) => e.status !== 'blocked' && e.stage !== 'countTokens').map((e) => e.stage)
    check('🔴 장부 — 유료 줄은 commentFollowupGen 만(commentGen 0)', genFetch === 1 && stages.length > 0 && stages.every((s) => s === 'commentFollowupGen'), JSON.stringify(stages))
    // 🔴 단계 증거 — 실제 행의 출처로 증거 입력을 만들어 정본 판정에 넣는다(자동 발행 글 모양 · 첫 댓글 1건만 증거)
    const kstDate = kstDateString(new Date())
    const pub = await prisma.post.findUniqueOrThrow({ where: { id: pid }, select: { publishAt: true } })
    const evPost = async (relabel: boolean) => ({
      postId: pid, queueId: 'q-fx', publishedAtMs: pub.publishAt!.getTime(), unattended: true, queueRows: 1, publishLogs: 1,
      authorPersonaId: a.id, decider: 'auto' as const, release: 'STAMPED_ELIGIBLE' as const,
      personaComments: await Promise.all(cs.map(async (c) => {
        const prov = await provOf(c.id)
        // 🔴 대조군 — #707 분리가 없던 것처럼 추가 댓글을 수동(none)으로 보면 상한 1 에 걸려야 한다
        return { id: c.id, personaId: c.personaId, parentId: c.parentId, reported: false,
          createdAtMs: c.createdAt.getTime(), topLevel: c.parentId === null,
          provenance: (relabel && prov === 'followup' ? 'none' : prov) as never }
      })),
      // 🔴 대화 감사는 발행 당시 순서·삭제 이력·신고 시각을 본다. 실제 repo 경로와 같은 시간순 장부를 준다.
      conversationComments: await Promise.all(cs.map(async (c) => {
        const prov = await provOf(c.id)
        return {
          id: c.id, personaId: c.personaId, parentId: c.parentId, commentOrigin: 'PERSONA' as const,
          isDeleted: false, createdAtMs: c.createdAt.getTime(), reportedAtMs: null,
          provenance: (relabel && prov === 'followup' ? 'none' : prov) as never,
        }
      })),
      replyParentIds: cs.flatMap((c) => c.parentId === null ? [] : [c.parentId]),
    })
    const factsOf = async (relabel: boolean) => ({
      kstDate, stage: 'd5' as const, decision: null, posts: [await evPost(relabel)], orphanPublishLogs: 0, unloggedPublishes: 0,
      commentCapPerPost: 1,
      audits: { rows: [] },
    })
    const ev = judgeEvidenceForTarget(kstDate, 'd5', 1, await factsOf(false), null)
    const COMMENT_FAIL = ['COMMENT_OVER_CAP', 'DUP_COMMENT', 'COMMENT_SELF', 'COMMENT_PROVENANCE_BROKEN', 'COMMENT_MISSING', 'COMMENT_LATE']
    check('🔴 D 단계 증거: 첫 댓글 1건 인정 · 추가 댓글은 상한·중복 밖(COMMENT_* 없음) · followupComments 1',
      !ev.codes.some((c) => COMMENT_FAIL.includes(c)) && ev.counts.firstCommentOk === 1 && ev.counts.followupComments === 1,
      `${ev.codes.join(',')} ${JSON.stringify(ev.counts)}`)
    const evBad = judgeEvidenceForTarget(kstDate, 'd5', 1, await factsOf(true), null)
    check('🔴 대조군 — 같은 행을 수동 출처로 섞으면 COMMENT_OVER_CAP(검사가 빈말이 아니다)', evBad.codes.includes('COMMENT_OVER_CAP'), evBad.codes.join(','))
    check('🔴 대화 감사 PASS(실제 행)', judgeConversationAudit([await evPost(false)]).verdict === 'PASS')
    void readStageEvidenceFacts
    followupOn(false)
  }

  console.log('\n③-b 🔴 seed 공유 수를 못 셌다 — 첫 댓글과 같은 정본: 회차 전체 유료 호출 0 (2026-11-07)')
  {
    await wipe(); await stageDecisionToday(); writeProfile(PROFILE); followupOn(true)
    const a = await persona('P01'); const b = await persona('P02'); await persona('P03'); await persona('P04')
    const pid = await post(a, 200); await autoFirst(b, pid, 180)
    const f = fakeGen()
    const r = await phase(f.gen, { source: { ...source(), seedUseCount: async (code: string) => (code === 'P04' ? null : 1) } })
    check('🔴 🔴 다른 active Persona 하나의 seed 공유 수를 몰라도 회차 전체 유료 호출 0 · 추가 댓글 0 · 사유를 남긴다',
      f.calls() === 0 && r.providerCalls === 0 && (await personaRows(pid)).length === 1 && r.lines.some((l) => l.includes('seedUseCount')),
      `${f.calls()} · ${JSON.stringify(r.lines)}`)
    const f2 = fakeGen()
    const r2 = await phase(f2.gen)
    check('🟢 대조 — 같은 상태에서 seed 를 다 세면 추가 댓글 유료 호출이 난다', f2.calls() > 0 && r2.providerCalls > 0, JSON.stringify(r2.lines))
  }

  console.log('\n④ 글당 총 1~10 — 상한 10 · 일반 Persona 1회 · 글쓴이 답글 최대 3회')
  {
    await wipe(); await stageDecisionToday(); writeProfile(PROFILE); followupOn(true)
    const a = await persona('P01'); const b = await persona('P02')
    for (let i = 3; i <= 12; i += 1) await persona(`P${String(i).padStart(2, '0')}`)
    const pid = await post(a, 90); await autoFirst(b, pid, 80)
    // 🔴 서로 다른 도입·내용의 질문이 계속 생겨도 구조 상한 10에서 멈춰야 한다
    const asks = [
      '잠이 깨는 시간이 길어지면 마음도 지치지요. 오늘 밤은 조금 나아지셨을까요?',
      '새벽 공기가 유난히 무겁게 느껴질 때가 있더라고요. 지금은 괜찮으신가요?',
      '가만히 누워 있으면 생각만 더 많아져서 힘들지요. 따뜻한 물은 드셔보셨어요?',
      '아침이 오기만 기다리는 밤이라니 속상하셨겠어요. 낮에는 좀 쉬셨나요?',
      '뒤척이는 소리까지 크게 들리는 날이 있지요. 요즘 계속 그러신 건가요?',
      '몸은 피곤한데 잠이 달아나면 참 야속하죠. 오늘은 일찍 누우실 수 있나요?',
      '비슷한 시간을 보내는 분들이 생각보다 많네요. 방 온도는 괜찮으셨어요?',
      '긴 밤을 혼자 견딘 느낌이 드셨겠어요. 낮잠은 줄여보신 적 있나요?',
      '마음을 내려놓으려 해도 쉽지 않은 밤이 있죠. 음악을 작게 틀어보셨나요?',
      '잠깐이라도 깊이 자는 게 소원처럼 느껴질 때가 있어요. 오늘 컨디션은 어떠세요?',
      '이야기를 꺼내주셔서 다른 분들도 고개를 끄덕일 것 같아요. 지금도 잠이 부족하신가요?',
      '밤마다 시계를 보게 되면 더 초조해지지요. 시계를 치워보신 적은 있으세요?',
    ]
    const g = fakeGen(asks)
    const roundLines: string[] = []
    for (let round = 0; round < 16; round += 1) {
      const report = await phase(g.gen)
      roundLines.push(
        `r${round + 1}:${report.outcome}:${report.reason}:${report.lines.join(' / ')}`
        + `:before=${report.sweepBefore?.lines.join(' / ') ?? ''}`
        + `:after=${report.sweepAfter?.lines.join(' / ') ?? ''}`,
      )
      await ageAll(pid, 75)
    }
    const cs = await personaRows(pid)
    const queueRows = await prisma.personaApprovalQueue.findMany({
      where: { targetPostId: pid, dedupKey: { startsWith: F.FOLLOWUP_KEY_PREFIX } },
      orderBy: { createdAt: 'asc' },
      select: { dedupKey: true, status: true, declineReason: true, persona: { select: { code: true } } },
    })
    const authorRows = cs.filter((c) => c.personaId === a.id)
    const nonAuthorIds = cs.filter((c) => c.personaId !== a.id).map((c) => c.personaId)
    // 🔴 질문이 계속 이어지는 대화 — 상한까지 실제로 닿아야 "10을 넘지 않는다"가 빈말이 아니다
    check(
      '🔴 Persona 댓글 정확히 10(상한 도달) · 넘지 않음 · 추가 9',
      cs.length === 10,
      `${cs.length} · queues=${JSON.stringify(queueRows)} · ${roundLines.join(' || ')}`,
    )
    check('🔴 일반 Persona는 한 번씩 · 글쓴이는 서로 다른 대상에 답글 최대 3회 · 최상위 0',
      new Set(nonAuthorIds).size === nonAuthorIds.length
      && authorRows.length <= 3
      && authorRows.every((c) => c.parentId !== null),
      `일반=${nonAuthorIds.length}/${new Set(nonAuthorIds).size} 글쓴이=${authorRows.length}`)
    const parents = cs.filter((c) => c.parentId !== null)
    let orphan = 0; let self = 0
    for (const c of parents) {
      const p = await prisma.comment.findUnique({ where: { id: c.parentId! }, select: { postId: true, personaId: true, commentOrigin: true } })
      if (p === null || p.postId !== pid || p.commentOrigin !== 'PERSONA') orphan += 1
      else if (p.personaId === c.personaId) self += 1
    }
    check('🔴 고아·다른 글·실회원 대상 답글 0 · 자기 댓글 답글 0', orphan === 0 && self === 0, `orphan=${orphan} self=${self}`)
    const keys = await prisma.personaApprovalQueue.findMany({ where: { targetPostId: pid, dedupKey: { startsWith: F.FOLLOWUP_KEY_PREFIX } }, select: { dedupKey: true } })
    check('🔴 추가 열쇠는 순번마다 하나', new Set(keys.map((k) => k.dedupKey)).size === keys.length)
    followupOn(false)
  }

  console.log('\n⑤ 실회원 우선 — 1~2건이면 추가 1 · 마지막 말이 실회원이면 0 · 3건이면 0')
  {
    await wipe(); await stageDecisionToday(); writeProfile(PROFILE); followupOn(true)
    const a = await persona('P01'); const b = await persona('P02')
    for (let i = 3; i <= 6; i += 1) await persona(`P0${i}`)
    const one = await post(a, 120); await member(one, 110); await autoFirst(b, one, 100)
    const last = await post(a, 120); await autoFirst(b, last, 100); await member(last, 50)
    const three = await post(a, 120); await member(three, 115); await member(three, 114); await member(three, 113); await autoFirst(b, three, 100)
    const g = fakeGen()
    for (let round = 0; round < 3; round += 1) { await phase(g.gen); for (const p of [one, last, three]) await ageAll(p, 75) }
    check('🔴 실회원 1건 글 — 추가 ≤ 1', (await personaRows(one)).length <= 2 && (await personaRows(one)).length >= 2, `${(await personaRows(one)).length}`)
    check('🔴 마지막 말이 실회원 — 추가 0', (await personaRows(last)).length === 1)
    check('🔴 실회원 3건 — 추가 0', (await personaRows(three)).length === 1)
    followupOn(false)
  }

  console.log('\n⑥ 우회 주입 — planner 를 건너뛴 PENDING 도 트랜잭션이 막는다')
  {
    await wipe(); await stageDecisionToday(); writeProfile(PROFILE); followupOn(true)
    const a = await persona('P01'); const b = await persona('P02'); const c = await persona('P03'); const d = await persona('P04'); const e = await persona('P05'); const f = await persona('P06')
    // 🔴 실회원 댓글은 첫 댓글보다 **앞에** 둔다 — 뒤에 두면 모든 반례가 "마지막 말 실회원" 하나로 막혀 의도한 사유를 못 본다
    const pid = await post(a, 200); const mem = await member(pid, 190); const first = await autoFirst(b, pid, 180)
    const other = await post(a, 200); const otherFirst = await autoFirst(b, other, 180)
    const live = async () => (await personaRows(pid)).filter((x) => !x.isDeleted).length
    const blockedFor = async (qid: string, expect: string): Promise<{ ok: boolean; detail: string }> => {
      const r = await publishCandidateTx(prisma, { id: qid, now: new Date(), followupLane: true })
      const msgs = r.kind === 'blocked' ? r.blocks.map((x) => x.message) : [r.kind]
      return { ok: r.kind === 'blocked' && msgs.some((m) => m.includes(expect)), detail: msgs.join(' | ') }
    }
    const cases: [string, string, () => Promise<string>][] = [
      ['🔴 다른 글의 댓글에 답글(고아)', '고아', () => injectFollowup(c, pid, stamp(pid, 2, otherFirst), 2)],
      ['🔴 실회원 댓글에 답글', 'Persona 댓글이 아니다', () => injectFollowup(c, pid, stamp(pid, 2, mem), 2)],
      // 🔴 글쓴이는 다른 Persona 댓글에 답글로만 말한다 — 최상위(글 hook) 자리는 여전히 자기 글이다
      ['🔴 글쓴 Persona 의 최상위 추가 댓글(자기 글)', '이미 썼거나 글쓴이', () => injectFollowup(a, pid, stamp(pid, 2, null), 2)],
      ['🔴 글쓴이 답글 자리에 다른 Persona(이미 단 Persona)', '글쓴이 답글 자리', () => injectFollowup(b, pid, stamp(pid, 2, first), 2)],
      ['🔴 순번이 지금 자리와 다름', '도장 순번', () => injectFollowup(c, pid, stamp(pid, 3, first), 3)],
      ['🔴 도장 없음', '도장이 없다', async () => {
        const id = await injectFollowup(c, pid, stamp(pid, 2, first), 2)
        await prisma.personaApprovalQueue.update({ where: { id }, data: { editDiff: {} } }); return id
      }],
    ]
    for (const [label, expect, make] of cases) {
      await prisma.personaApprovalQueue.deleteMany({ where: { dedupKey: { startsWith: F.FOLLOWUP_KEY_PREFIX } } })
      const qid = await make()
      const why = await blockedFor(qid, expect)
      const s = await sweepFollowupLane(prisma, new Date())
      const row = await prisma.personaApprovalQueue.findUniqueOrThrow({ where: { id: qid }, select: { status: true, declineReason: true } })
      check(`${label} → 그 사유로 막힘 · 발행 0 · EXPIRED`, why.ok && s.published === 0 && row.status === 'EXPIRED'
        && row.declineReason === FOLLOWUP_EXPIRE_REASON && (await live()) === 1, why.detail)
    }
    // 🔴 삭제된 · 신고된 대상
    await prisma.personaApprovalQueue.deleteMany({ where: { dedupKey: { startsWith: F.FOLLOWUP_KEY_PREFIX } } })
    const rep = await prisma.user.create({ data: { nickname: `rep${seq}x` }, select: { id: true } })
    await prisma.report.create({ data: { reporterId: rep.id, commentId: first, reason: 'fx' } })
    const q1 = await injectFollowup(c, pid, stamp(pid, 2, first), 2)
    const w1 = await blockedFor(q1, '신고')
    const s1 = await sweepFollowupLane(prisma, new Date())
    check('🔴 신고된 댓글에 답글 → 그 사유로 막힘 · 발행 0', w1.ok && s1.published === 0
      && (await prisma.personaApprovalQueue.findUniqueOrThrow({ where: { id: q1 }, select: { status: true } })).status === 'EXPIRED', w1.detail)
    await prisma.report.deleteMany({})
    await prisma.personaApprovalQueue.deleteMany({ where: { dedupKey: { startsWith: F.FOLLOWUP_KEY_PREFIX } } })
    // 삭제는 그 글의 다른 Persona 첫 댓글 위에 추가로 — 첫 댓글 자체를 지우면 첫 댓글 계약에서 먼저 멈춘다
    const extra = await prisma.comment.create({ data: { postId: pid, authorId: d.userId, content: '삭제될 질문 있으세요?', commentOrigin: 'PERSONA', personaId: d.id, source: 'SYSTEM', isDeleted: true, createdAt: new Date(Date.now() - 150 * MIN) }, select: { id: true } })
    const q2 = await injectFollowup(c, pid, stamp(pid, 2, extra.id), 2)
    const w2 = await blockedFor(q2, '지워졌다')
    const s2 = await sweepFollowupLane(prisma, new Date())
    check('🔴 삭제된 댓글에 답글 → 그 사유로 막힘 · 발행 0', w2.ok && s2.published === 0
      && (await prisma.personaApprovalQueue.findUniqueOrThrow({ where: { id: q2 }, select: { status: true } })).status === 'EXPIRED', w2.detail)
    // 🔴 스위치 · profile 이 트랜잭션 시각에 꺼져 있으면
    await prisma.personaApprovalQueue.deleteMany({ where: { dedupKey: { startsWith: F.FOLLOWUP_KEY_PREFIX } } })
    // 삭제된 Persona 댓글도 사건 순번을 소비하므로 다음 멱등 순번은 3이다.
    const q3 = await injectFollowup(a, pid, stamp(pid, 3, first), 3)
    followupOn(false)
    const direct = await publishCandidateTx(prisma, { id: q3, now: new Date(), followupLane: true })
    check('🔴 스위치 OFF 면 트랜잭션을 직접 불러도 막힌다', direct.kind === 'blocked')
    followupOn(true)
    writeProfile({ ...PROFILE, approvedBy: null })
    const d2 = await publishCandidateTx(prisma, { id: q3, now: new Date(), followupLane: true })
    check('🔴 승인 없는 profile(후보) → 트랜잭션이 막는다', d2.kind === 'blocked')
    writeProfile({ ...PROFILE, stage: 'd10' })
    const d3 = await publishCandidateTx(prisma, { id: q3, now: new Date(), followupLane: true })
    check('🔴 profile 단계 ≠ 그날 단계 → 막는다', d3.kind === 'blocked')
    writeProfile(PROFILE)
    const d4 = await publishCandidateTx(prisma, { id: q3, now: new Date(), followupLane: true, autoLane: true })
    check('🔴 첫 댓글 레인과 섞어 부르면 막는다', d4.kind === 'blocked')
    const d5 = await publishCandidateTx(prisma, { id: q3, now: new Date(), autoLane: true })
    check('🔴 추가 댓글 행을 첫 댓글 레인으로 내면 무인 레인 규칙이 막는다', d5.kind === 'blocked' && (await live()) === 1, JSON.stringify(d5))
    const ok = await publishCandidateTx(prisma, { id: q3, now: new Date(), followupLane: true })
    check('🟢 기준선 — 같은 행을 정상 조건에서 내면 발행된다(위 반례가 다른 이유로 막힌 것이 아니다)', ok.kind === 'published' && (await live()) === 2, JSON.stringify(ok))
    // 🔴 실회원이 있는 위 글은 추가 1건이 정본 상한이다. 글쓴이 두 번째 답글의 원자성은
    //    실회원 없는 별도 글에서 실제 followup 출처 사슬을 만든 뒤 검증한다.
    const dialogPid = await post(f, 200)
    const dialogFirst = await autoFirst(b, dialogPid, 180)
    const authorQ1 = await injectFollowup(
      f,
      dialogPid,
      stamp(dialogPid, 2, dialogFirst),
      2,
      '저도 그런 밤을 보내봐서 마음이 쓰이네요. 오늘은 조금 편히 쉬셨으면 해요.',
    )
    const authorR1 = await publishCandidateTx(prisma, { id: authorQ1, now: new Date(), followupLane: true })
    await ageAll(dialogPid, 75)
    const authorFirstReply = (await personaRows(dialogPid)).find((x) => x.personaId === f.id)
    if (authorR1.kind !== 'published' || authorFirstReply === undefined) throw new Error('글쓴이 첫 답글 fixture 실패')
    const otherQ = await injectFollowup(
      d,
      dialogPid,
      stamp(dialogPid, 3, authorFirstReply.id),
      3,
      '저도 읽으면서 계속 마음에 남았어요. 그 뒤에는 조금 나아지셨나요?',
    )
    const otherR = await publishCandidateTx(prisma, { id: otherQ, now: new Date(), followupLane: true })
    await ageAll(dialogPid, 75)
    const freshTarget = (await personaRows(dialogPid)).find((x) => x.personaId === d.id)
    if (otherR.kind !== 'published' || freshTarget === undefined) throw new Error('두 번째 질문 fixture 실패')
    const q4 = await injectFollowup(
      f,
      dialogPid,
      stamp(dialogPid, 4, freshTarget.id),
      4,
      '물어봐주셔서 고마워요. 어제보다는 조금 나아져서 마음을 놓고 있어요.',
    )
    const ok2 = await publishCandidateTx(prisma, { id: q4, now: new Date(), followupLane: true })
    const afterSecond = await personaRows(dialogPid)
    const afterSecondIds = afterSecond.map((x) => x.id)
    check('🟢 글쓴이 두 번째 답글 — 서로 다른 대상 · Comment/Queue/ActivityLog 원자 저장',
      ok2.kind === 'published'
      && afterSecond.filter((x) => x.personaId === f.id).length === 2
      && await prisma.personaApprovalQueue.count({ where: { id: q4, status: 'PUBLISHED', publishedCommentId: { not: null } } }) === 1
      && await prisma.personaActivityLog.count({ where: { personaId: f.id, kind: 'comment', targetId: { in: afterSecondIds } } }) === 2,
      JSON.stringify(ok2))

    // 🔴 글쓴이 3회 상한을 순수 계약만으로 증명하지 않는다. 서로 다른 대상에 3회까지는 실제 저장하고,
    //    planner 우회 PENDING 으로 들어온 4번째를 최종 transaction 이 다시 막는다.
    // 상한 반례는 자연 planner 의 “글 hook 한 번” 선호와 분리해 검사한다. 실제 followup 출처 3행을
    // 직접 만들어 서로 다른 짧은 답글 대상을 추가한다. 이 fixture 자체는 운영 생성 규칙을 시험하지 않고,
    // 이후 3·4번째 글쓴이 답글의 **최종 transaction 재검사**만 시험한다.
    const freshAt = new Date(Date.now() - 75 * MIN)
    const freshTop = await prisma.comment.create({
      data: {
        postId: dialogPid, authorId: c.userId,
        content: '저도 비슷한 밤을 보낸 적이 있어요. 조금 나아지셨다니 다행이에요.',
        source: 'SYSTEM', commentOrigin: 'PERSONA', personaId: c.id, createdAt: freshAt,
      },
      select: { id: true },
    })
    await prisma.personaApprovalQueue.create({ data: {
      personaId: c.id, targetPostId: dialogPid, status: 'PUBLISHED',
      candidateText: '저도 비슷한 밤을 보낸 적이 있어요. 조금 나아지셨다니 다행이에요.',
      reactionType: 'experience', gateStatus: 'pass',
      gateResults: GATE_CODES.map((g) => ({ gate: g, outcome: 'pass', detail: 'fx' })),
      dedupKey: F.followupKeyOf(dialogPid, 5), editDiff: JSON.parse(JSON.stringify({
        [F.FOLLOWUP_STAMP_FIELD]: stamp(dialogPid, 5, null, 'experience'),
      })),
      generatedModel: PROV.model, canonRunId: PROV.canonRunId, canonDigest: PROV.canonDigest,
      decidedBy: FOLLOWUP_LANE_DECIDED_BY, decidedAt: freshAt, publishedCommentId: freshTop.id,
    } })
    await prisma.personaActivityLog.create({ data: {
      personaId: c.id, kind: 'comment', targetId: freshTop.id, gateStatus: 'pass',
      decidedBy: FOLLOWUP_LANE_ACTIVITY_DECIDED_BY, publishedAt: freshAt, createdAt: freshAt,
    } })
    await ageAll(dialogPid, 75)
    const authorThirdQueue = await injectFollowup(
      f,
      dialogPid,
      stamp(dialogPid, 6, freshTop.id),
      6,
      '따뜻하게 말해주셔서 고마워요. 오늘은 더 편히 자보려고요.',
    )
    const authorThirdResult = await publishCandidateTx(prisma, { id: authorThirdQueue, now: new Date(), followupLane: true })
    await ageAll(dialogPid, 75)
    const authorReplies = (await personaRows(dialogPid)).filter((x) => x.personaId === f.id)
    check('🟢 글쓴이 3번째 답글 — 서로 다른 대상에만 실제 저장',
      authorThirdResult.kind === 'published' && authorReplies.length === 3,
      JSON.stringify(authorThirdResult))
    const authorThird = authorReplies.at(-1)
    if (authorThird === undefined) throw new Error('글쓴이 3번째 답글 fixture 실패')
    const fourthTargetQueue = await injectFollowup(
      e,
      dialogPid,
      stamp(dialogPid, 7, authorThird.id),
      7,
      '오늘 밤은 더 편안하시길 바랄게요. 나중에도 소식 들려주세요.',
    )
    const fourthTargetResult = await publishCandidateTx(prisma, { id: fourthTargetQueue, now: new Date(), followupLane: true })
    await ageAll(dialogPid, 75)
    const fourthTarget = (await personaRows(dialogPid)).find((x) => x.personaId === e.id)
    if (fourthTargetResult.kind !== 'published' || fourthTarget === undefined) throw new Error('4번째 글쓴이 답글 대상 fixture 실패')
    const authorFourthQueue = await injectFollowup(
      f,
      dialogPid,
      stamp(dialogPid, 8, fourthTarget.id),
      8,
      '걱정해주셔서 고마워요. 다음에 또 이야기 드릴게요.',
    )
    const authorFourthResult = await publishCandidateTx(prisma, { id: authorFourthQueue, now: new Date(), followupLane: true })
    check('🔴 글쓴이 4번째 답글 → planner 우회 PENDING 이어도 transaction 차단 · write 0',
      authorFourthResult.kind === 'blocked'
      && authorFourthResult.blocks.some((x) => x.message.includes('이미 썼거나 글쓴이'))
      && (await personaRows(dialogPid)).filter((x) => x.personaId === f.id).length === 3,
      JSON.stringify(authorFourthResult))
    followupOn(false)
  }

  console.log('\n⑦ 중복 · 동시성 · 첫 댓글 sweep 분리')
  {
    await wipe(); await stageDecisionToday(); writeProfile(PROFILE); followupOn(true)
    const a = await persona('P01'); const b = await persona('P02'); await persona('P03'); const d = await persona('P04')
    const pid = await post(a, 200); const first = await autoFirst(b, pid, 180)
    const q = await injectFollowup(a, pid, stamp(pid, 2, first), 2)
    let dup = false
    try { await injectFollowup(d, pid, stamp(pid, 2, first), 2) } catch (e) { dup = (e as { code?: string }).code === 'P2002' }
    check('🔴 같은 자리(글·순번) 열쇠는 unique 로 두 번 들어가지 않는다', dup)
    const s = await sweepAutoLane(prisma, new Date())
    check('🔴 첫 댓글 sweep 은 추가 댓글 행을 집지 않는다(닫지도 않는다)', s.seen === 0
      && (await prisma.personaApprovalQueue.findUniqueOrThrow({ where: { id: q }, select: { status: true } })).status === 'PENDING')
    const now = new Date()
    const res = await Promise.all([
      publishCandidateTx(prisma, { id: q, now, followupLane: true }),
      publishCandidateTx(prisma, { id: q, now, followupLane: true }),
    ])
    check('🔴 같은 행 동시 발행 → 1건만', res.filter((x) => x.kind === 'published').length === 1 && (await personaRows(pid)).length === 2, JSON.stringify(res.map((x) => x.kind)))
    // 다른 순번 두 행이 같은 글에 — 순번이 맞는 하나만
    const pid2 = await post(a, 200); const first2 = await autoFirst(b, pid2, 180)
    const x = await injectFollowup(a, pid2, stamp(pid2, 2, first2), 2)
    const y = await injectFollowup(d, pid2, stamp(pid2, 3, null), 3)
    const r2 = await Promise.all([
      publishCandidateTx(prisma, { id: x, now, followupLane: true }),
      publishCandidateTx(prisma, { id: y, now, followupLane: true }),
    ])
    check('🔴 같은 글 두 후보 동시 → 추가 1건 이하', (await personaRows(pid2)).length <= 2 && r2.filter((z) => z.kind === 'published').length <= 1, JSON.stringify(r2.map((z) => z.kind)))
    followupOn(false)
  }

  console.log('\n⑦-b 공용 하루 500 상한 · 세 행 원자성 실패 주입')
  {
    await wipe(); await stageDecisionToday(); writeProfile(PROFILE); followupOn(true)
    const priorAuthor = await persona('P01'); const priorFirst = await persona('P02'); const priorSpeaker = await persona('P03')
    const priorPost = await post(priorAuthor, 200); await autoFirst(priorFirst, priorPost, 180)
    await prisma.comment.create({ data: {
      postId: priorPost, authorId: priorSpeaker.userId, content: '이전에 달았다가 삭제한 댓글',
      source: 'SYSTEM', commentOrigin: 'PERSONA', personaId: priorSpeaker.id, isDeleted: true,
      createdAt: new Date(Date.now() - 190 * MIN),
    } })
    const priorSourcePost = (await source().posts()).find((x) => x.id === priorPost)
    check('🔴 DB source adapter — 삭제 댓글은 공개 문맥에서 빼되 Persona 발화 이력은 보존',
      priorSourcePost !== undefined
      && priorSourcePost.comments.every((x) => x.personaCode !== priorSpeaker.code)
      && priorSourcePost.personaCodesEverOnPost.includes(priorSpeaker.code),
      JSON.stringify(priorSourcePost))
    // 🔴 글쓴이 답글 자리가 아닌 새 최상위 자리에서, 삭제한 일반 Persona 재등장을 정확히 검증한다.
    const priorQueue = await injectFollowup(priorSpeaker, priorPost, stamp(priorPost, 2, null, 'experience'), 2)
    const priorResult = await publishCandidateTx(prisma, { id: priorQueue, now: new Date(), followupLane: true })
    check('🔴 일반 Persona는 삭제된 과거 댓글이 있어도 같은 글에 다시 등장하지 않음',
      priorResult.kind === 'blocked'
      && priorResult.blocks.some((x) => x.message.includes('이미 썼거나'))
      && (await prisma.comment.count({ where: { postId: priorPost, personaId: priorSpeaker.id, isDeleted: false } })) === 0,
      JSON.stringify(priorResult))

    await wipe(); await stageDecisionToday(); writeProfile(PROFILE); followupOn(true)
    const a = await persona('P01'); const b = await persona('P02'); const filler = await persona('P03')
    const pid = await post(a, 200); const first = await autoFirst(b, pid, 180)
    const fillerPost = await post(filler, 160)
    // 삭제된 과거 500건만으로도 오늘 절대 상한은 찼다. 삭제가 자리를 다시 열면 안 된다.
    await prisma.comment.createMany({ data: Array.from({ length: BOOTSTRAP_DAILY_MAX }, (_, i) => ({
      postId: fillerPost, authorId: filler.userId, content: `삭제된 하루 상한 fixture ${i}`,
      source: 'SYSTEM' as const, commentOrigin: 'PERSONA' as const, personaId: filler.id,
      isDeleted: true, createdAt: new Date(Date.now() - MIN),
    })) })
    const cappedQueue = await injectFollowup(a, pid, stamp(pid, 2, first), 2)
    const capped = await publishCandidateTx(prisma, { id: cappedQueue, now: new Date(), followupLane: true })
    const cappedRow = await prisma.personaApprovalQueue.findUniqueOrThrow({
      where: { id: cappedQueue }, select: { status: true, publishedCommentId: true },
    })
    check('🔴 첫 댓글·추가 댓글 공용 하루 500 상한 — 삭제된 과거 500건도 재사용하지 않음',
      capped.kind === 'blocked'
      && capped.blocks.some((x) => x.message.includes(`오늘 상한 ${BOOTSTRAP_DAILY_MAX}건`))
      && cappedRow.status === 'PENDING' && cappedRow.publishedCommentId === null
      && (await personaRows(pid)).length === 1,
      JSON.stringify(capped))

    await wipe(); await stageDecisionToday(); writeProfile(PROFILE); followupOn(true)
    const aa = await persona('P01'); const bb = await persona('P02')
    const atomicPost = await post(aa, 200); const atomicFirst = await autoFirst(bb, atomicPost, 180)
    const atomicQueue = await injectFollowup(aa, atomicPost, stamp(atomicPost, 2, atomicFirst), 2)
    const triggerName = 'soran_fail_followup_activity_log'
    const functionName = 'soran_fail_followup_activity_log_fn'
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "PersonaActivityLog"`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`)
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
      BEGIN
        IF NEW."decidedBy" = '${FOLLOWUP_LANE_ACTIVITY_DECIDED_BY}' THEN
          RAISE EXCEPTION 'fixture followup activity failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `)
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE INSERT ON "PersonaActivityLog"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
    `)
    let atomicResult: Awaited<ReturnType<typeof publishCandidateTx>>
    try {
      atomicResult = await publishCandidateTx(prisma, { id: atomicQueue, now: new Date(), followupLane: true })
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "PersonaActivityLog"`)
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`)
    }
    const atomicRow = await prisma.personaApprovalQueue.findUniqueOrThrow({
      where: { id: atomicQueue }, select: { status: true, publishedCommentId: true },
    })
    const atomicComments = await personaRows(atomicPost)
    check('🔴 ActivityLog insert 실패 → Comment·Queue·ActivityLog 전부 롤백',
      atomicResult.kind === 'error'
      && atomicComments.length === 1
      && atomicRow.status === 'PENDING' && atomicRow.publishedCommentId === null
      && await prisma.personaActivityLog.count({
        where: { targetId: { in: atomicComments.map((c) => c.id) }, decidedBy: FOLLOWUP_LANE_ACTIVITY_DECIDED_BY },
      }) === 0,
      JSON.stringify({ atomicResult, atomicRow, comments: atomicComments.length }))
    followupOn(false)
  }

  console.log('\n⑧ 복구 · 재실행 — 적재 뒤 죽어도 provider 재호출 0 · 발행 뒤 다시 돌아도 중복 행 0')
  {
    await wipe(); await stageDecisionToday(); writeProfile(PROFILE); followupOn(true)
    const a = await persona('P01'); const b = await persona('P02'); await persona('P03'); await persona('P04')
    const pid = await post(a, 200); const first = await autoFirst(b, pid, 180)
    await injectFollowup(a, pid, stamp(pid, 2, first), 2)
    const g = fakeGen()
    const r = await phase(g.gen)
    check('🔴 남은 PENDING 을 먼저 낸다 · provider 0', r.sweepBefore?.published === 1 && g.calls() === 0 && (await personaRows(pid)).length === 2,
      `${JSON.stringify(r.sweepBefore?.lines)} calls=${g.calls()}`)
    const g2 = fakeGen()
    await phase(g2.gen)
    const cs = await personaRows(pid)
    const logs = await prisma.personaActivityLog.count({ where: { targetId: { in: cs.map((x) => x.id) } } })
    const qs = await prisma.personaApprovalQueue.count({ where: { publishedCommentId: { in: cs.map((x) => x.id) } } })
    check('🔴 곧바로 재실행 — provider 0(시간차) · 댓글 2 · Queue 2 · ActivityLog 2', g2.calls() === 0 && cs.length === 2 && logs === 2 && qs === 2, `${g2.calls()} ${cs.length} ${logs} ${qs}`)
    followupOn(false)
  }

  console.log('\n⑨ 예산 · profile · 대화 감사 브레이크 — provider 0')
  {
    await wipe(); await stageDecisionToday(); writeProfile(PROFILE); followupOn(true)
    const a = await persona('P01'); const b = await persona('P02'); await persona('P03'); await persona('P04')
    const pid = await post(a, 200); await autoFirst(b, pid, 180)
    // 🔴 consumer 결정 표식이 없으면(지금 댓글 러너 모양) 그날 단계를 모른다 → 0건
    {
      const keep = process.env.SORAN_STAGE_DECISION_DATE
      delete process.env.SORAN_STAGE_DECISION_DATE
      const g0 = fakeGen()
      const r0 = await phase(g0.gen)
      check('🔴 결정 표식 env 없음(consumer 미경유) → 그날 단계 모름 → provider 0 · 추가 0', g0.calls() === 0 && r0.enqueued === 0, `${r0.outcome} ${r0.reason}`)
      process.env.SORAN_STAGE_DECISION_DATE = keep
    }
    const cases: [string, Partial<Parameters<typeof runFollowupPhase>[0]>][] = [
      ['대화 감사 FAIL', { conversationAudit: { verdict: 'FAIL', codes: ['FOLLOWUP_SELF'], counts: {} } }],
      ['대화 감사 판독 불가', { conversationAudit: undefined }],
      ['profile 없음', { profile: null }],
      ['profile 후보(승인 없음)', { profile: F.FOLLOWUP_CANARY_PROFILE_CANDIDATE }],
      ['그날 단계 모름', { runtimeStage: null }],
      ['장부 못 읽음', { ledger: { entries: null, capUsd: 0.2, headroom: 1.5 } }],
      ['공유 장부 잔량 0', { ledger: { entries: [], capUsd: 0, headroom: 1.5 } }],
      ['생성 문 닫힘(장부 판정)', { generation: { ok: false, reason: 'DAILY_EXHAUSTED' } }],
      ['profile 하루 상한 0 잔량', { profile: { ...PROFILE, dailyCount: 1, runMax: 1 } }],
    ]
    // 하루 상한 잔량 0 을 만들려면 오늘 추가 1건이 있어야 한다
    for (const [label, over] of cases) {
      if (label === 'profile 하루 상한 0 잔량') {
        const extra = await post(a, 200); const f2 = await autoFirst(b, extra, 180)
        const qx = await injectFollowup(a, extra, stamp(extra, 2, f2), 2)
        await publishCandidateTx(prisma, { id: qx, now: new Date(), followupLane: true })
      }
      const g = fakeGen()
      const r = await phase(g.gen, over)
      check(`🔴 ${label} → provider 0 · 추가 0`, g.calls() === 0 && r.enqueued === 0 && (await personaRows(pid)).length === 1, `${r.outcome} ${r.reason}`)
    }
    const g = fakeGen()
    const r = await phase(g.gen, { conversationAudit: PASS_AUDIT })
    check('🟢 기준선 — 같은 글을 정상 조건에서 돌리면 추가 1건', g.calls() === 1 && (await personaRows(pid)).length === 2, `${r.outcome} ${JSON.stringify(r.lines)}`)
    followupOn(false)
  }

  console.log('\n⑩ 첫 댓글 대기 중이면 추가 댓글은 양보한다')
  {
    await wipe(); await stageDecisionToday(); writeProfile(PROFILE); followupOn(true)
    const a = await persona('P01'); const b = await persona('P02'); await persona('P03')
    const old = await post(a, 200); await autoFirst(b, old, 180)
    await post(a, 5) // 🔴 60분 창 안 · 첫 댓글 0
    const g = fakeGen()
    const r = await phase(g.gen)
    check('🔴 첫 댓글 대기 1편 → 추가 댓글 provider 0', g.calls() === 0 && (await personaRows(old)).length === 1 && r.outcome === 'TICK_ZERO', r.reason)
    followupOn(false)
  }

  console.log('\n⑪ E6 — 실제 consumer(stage-consume-exec --by=comment) 가 넣은 오늘 결정으로만 돈다')
  {
    const HERE = dirname(fileURLToPath(import.meta.url))
    const ROOT = join(HERE, '..')
    const TSX = join(ROOT, 'node_modules', '.bin', 'tsx')
    // 🔴 consumer 가 읽는 정본 env(임시 HOME) — controller on. 운영 env 0
    const canon = join(HOME, 'Library', 'Application Support', 'soransoran')
    mkdirSync(canon, { recursive: true })
    writeFileSync(join(canon, 'env.local'), 'STAGE_CONTROLLER_ENABLED=on\n')
    const CWD = mkdtempSync(join(tmpdir(), 'soran-consume-cwd-')) // 🔴 .env.local 없는 작업 디렉터리
    const consume = (over: Record<string, string | undefined>): { env: Record<string, string>; note: string; status: number | null } => {
      const env: Record<string, string> = {}
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
      for (const k of ['SORAN_STAGE_DECISION_DATE', 'SORAN_RELEASE_STAGE', 'SORAN_CAPACITY_STAGE', 'SORAN_PERSONA_COMMENT_FOLLOWUP']) delete env[k]
      for (const [k, v] of Object.entries(over)) if (v === undefined) delete env[k]; else env[k] = v
      const r = spawnSync(TSX, [join(ROOT, 'scripts', 'stage-consume-exec.mts'), '--by=comment', '--print'], { cwd: CWD, env, encoding: 'utf-8' })
      const out: Record<string, string> = {}
      for (const line of (r.stdout ?? '').split('\n')) { const m = /^([A-Z_]+)=(.*)$/.exec(line); if (m !== null) out[m[1]!] = m[2]! }
      return { env: out, note: (r.stderr ?? '').trim(), status: r.status }
    }
    const storeDecision = async (kstDate: string): Promise<void> => {
      const v = validateStoredDecision({
        row: {
          kstDate, capacity: 'd10', release: STAGE, state: 'HOLD', reasons: ['fixture'], blocks: [], dayPinned: false, supply: null,
          decidedAt: new Date(`${kstDate}T07:00:00+09:00`).toISOString(), contractVersion: STAGE_DECISION_VERSION,
          decidedBy: DECISION_WRITER, transition: null,
        },
        expectKstDate: kstDate,
      })
      if (!v.ok) throw new Error(`fixture 결정이 깨졌다 — ${v.reason}`)
      await createStageDecision(prisma, v.decision)
    }
    const applyConsumed = (e: Record<string, string>): void => {
      clearDecisionEnv()
      for (const [k, v] of Object.entries(e)) process.env[k] = v
    }
    const setup = async (): Promise<{ pid: string }> => {
      await wipe(); writeProfile(PROFILE); followupOn(true)
      const a = await persona('P01'); const b = await persona('P02'); await persona('P03'); await persona('P04')
      const pid = await post(a, 200); await autoFirst(b, pid, 180)
      return { pid }
    }
    const today = kstDateString(new Date())

    // (가) 오늘 결정 있음 → consumer 가 표식·공개·천장을 넣고 → 추가 댓글이 profile 범위 안에서 돈다
    {
      const { pid } = await setup()
      await storeDecision(today)
      const c = consume({ SORAN_PERSONA_COMMENT_FOLLOWUP: 'on' })
      check('🔴 consumer — 오늘 결정 표식 · 공개 d5 · 천장 d10 을 넣는다',
        c.status === 0 && c.env.SORAN_STAGE_DECISION_DATE === today && c.env.SORAN_RELEASE_STAGE === STAGE && c.env.SORAN_CAPACITY_STAGE === 'd10', `${c.note} ${JSON.stringify(c.env)}`)
      applyConsumed(c.env)
      const g = fakeGen()
      const r = await phase(g.gen)
      check('🟢 consumer 가 넣은 결정 → 추가 댓글 1건(운영 공통 profile)', (await personaRows(pid)).length === 2 && r.outcome === 'RAN', `${r.reason} ${JSON.stringify(r.lines)}`)
      // 단계 전용 profile 을 쓰면 consumer 결정과 다른 단계에서는 계속 0
      const { pid: pid2 } = await setup(); await storeDecision(today)
      applyConsumed(consume({ SORAN_PERSONA_COMMENT_FOLLOWUP: 'on' }).env)
      writeProfile({ ...PROFILE, stage: 'd10' })
      const g2 = fakeGen()
      await phase(g2.gen)
      check('🔴 consumer 결정 d5 · profile d10 → provider 0 · 추가 0', g2.calls() === 0 && (await personaRows(pid2)).length === 1)
      writeProfile(PROFILE)
    }
    // (나) 결정 없음 → consumer 가 표식 없이 safest → 0
    {
      const { pid } = await setup()
      const c = consume({ SORAN_PERSONA_COMMENT_FOLLOWUP: 'on' })
      applyConsumed(c.env)
      const g = fakeGen()
      await phase(g.gen)
      check('🔴 결정 없음 → 표식 없음 → provider 0 · 추가 0', (c.env.SORAN_STAGE_DECISION_DATE ?? '') === '' && g.calls() === 0 && (await personaRows(pid)).length === 1, c.note)
    }
    // (다) 다른 날짜(어제) 결정만 있음 → consumer 는 오늘 키로만 읽는다 → 0
    {
      const { pid } = await setup()
      const y = kstDateString(new Date(Date.now() - 86_400_000))
      await storeDecision(y)
      const c = consume({ SORAN_PERSONA_COMMENT_FOLLOWUP: 'on' })
      applyConsumed(c.env)
      const g = fakeGen()
      await phase(g.gen)
      check('🔴 어제 결정만 → 표식 없음 → provider 0 · 추가 0', (c.env.SORAN_STAGE_DECISION_DATE ?? '') === '' && g.calls() === 0 && (await personaRows(pid)).length === 1, c.note)
    }
    // (라) 위조·오래된 env — consumer 를 거치지 않고 손으로 넣은 값
    {
      const forged: [string, Record<string, string>][] = [
        ['어제 표식(오래된 프로세스)', { SORAN_STAGE_DECISION_DATE: kstDateString(new Date(Date.now() - 86_400_000)), SORAN_RELEASE_STAGE: STAGE, SORAN_CAPACITY_STAGE: 'd10' }],
        ['공개 > 천장', { SORAN_STAGE_DECISION_DATE: today, SORAN_RELEASE_STAGE: 'd20', SORAN_CAPACITY_STAGE: 'd10' }],
        ['정본 밖 단계', { SORAN_STAGE_DECISION_DATE: today, SORAN_RELEASE_STAGE: 'd7', SORAN_CAPACITY_STAGE: 'd10' }],
        ['천장 없음', { SORAN_STAGE_DECISION_DATE: today, SORAN_RELEASE_STAGE: STAGE }],
      ]
      for (const [name, e] of forged) {
        const { pid } = await setup()
        applyConsumed(e)
        const g = fakeGen()
        await phase(g.gen)
        // 🔴 트랜잭션도 같은 env 를 다시 읽어 막는다 — planner 를 건너뛴 행으로 확인
        const first = (await personaRows(pid))[0]!.id
        const c9 = await persona(`PX${seq}`)
        const qid = await injectFollowup(c9, pid, stamp(pid, 2, first), 2)
        const tx = await publishCandidateTx(prisma, { id: qid, now: new Date(), followupLane: true })
        check(`🔴 위조 env(${name}) → 회차 provider 0 · 트랜잭션도 '단계 모름' 으로 막음`, g.calls() === 0 && tx.kind === 'blocked'
          && tx.blocks.some((x) => x.message.includes('단계를 모른다')) && (await personaRows(pid)).length === 1,
          tx.kind === 'blocked' ? tx.blocks.map((x) => x.message).join(' | ') : tx.kind)
      }
    }
    // (마) 스위치 OFF → consumer 는 결정을 읽지 않는다 — 닿을 수 없는 DB 주소로 증명(ON 이면 읽다가 실패한다)
    {
      const dead = 'postgresql://soran@127.0.0.1:1/soran_test'
      const off = consume({ SORAN_PERSONA_COMMENT_FOLLOWUP: undefined, DATABASE_URL: dead, DIRECT_URL: dead })
      const on = consume({ SORAN_PERSONA_COMMENT_FOLLOWUP: 'on', DATABASE_URL: dead, DIRECT_URL: dead })
      check('🔴 스위치 OFF → consumer 가 결정을 읽지 않는다(DB 시도 0 · 표식 없음)',
        off.status === 0 && off.note.includes('off') && !off.note.includes('읽지 못했다') && (off.env.SORAN_STAGE_DECISION_DATE ?? '') === '', off.note)
      check('대조 — 스위치 ON 이면 같은 주소에서 읽기를 시도한다(실패 → safest)', on.note.includes('읽지 못했다'), on.note)
      // 🔴 회차 단계도 OFF 면 DB 접근 0 — prisma 를 건드리면 세는 가짜를 넣는다
      followupOn(false)
      let touched = 0
      const trap = new Proxy({}, { get: () => { touched += 1; throw new Error('DB 접근') } }) as unknown as InstanceType<typeof PrismaClient>
      const r = await runFollowupPhase({
        prisma: trap, now: new Date(), env: process.env, source: source(), canon: canonRead,
        makeGenerate: () => fakeGen().gen, generation: { ok: true, reason: '' },
        ledger: { entries: [], capUsd: 0.2, headroom: 1.5 }, profile: PROFILE, runtimeStage: STAGE, conversationAudit: PASS_AUDIT,
      })
      check('🔴 스위치 OFF → 추가 댓글 단계의 DB 접근 0 · provider 0', r.outcome === 'OFF' && touched === 0, `${r.outcome} touched=${touched}`)
    }
    // (바) 같은 회차 두 개가 동시에 — 중복 0
    {
      const { pid } = await setup()
      await stageDecisionToday()
      const [x, y] = await Promise.all([phase(fakeGen().gen), phase(fakeGen(REPLIES.slice(3)).gen)])
      const cs = await personaRows(pid)
      const keys = await prisma.personaApprovalQueue.findMany({ where: { targetPostId: pid, dedupKey: { startsWith: F.FOLLOWUP_KEY_PREFIX } }, select: { dedupKey: true } })
      check('🔴 동시 두 회차 → 추가 댓글 1건 이하 · 열쇠 중복 0', cs.length <= 2 && new Set(keys.map((k) => k.dedupKey)).size === keys.length,
        `${cs.length} ${x.outcome}/${y.outcome}`)
      await phase(fakeGen().gen)
      check('🔴 다시 돌아도(같은 자리) 추가 댓글 그대로', (await personaRows(pid)).length === cs.length)
    }
    clearDecisionEnv(); followupOn(false)
  }

  console.log('\n⑫ dedupKey 선제 제거 — EXPIRED · PUBLISHED 열쇠가 이미 있으면 provider 0 · Queue write 0 · Comment write 0')
  {
    // 같은 표로 두 상태를 순서대로 확인한다(복잡도 최소)
    for (const priorStatus of ['EXPIRED', 'PUBLISHED'] as const) {
      await wipe(); await stageDecisionToday(); writeProfile(PROFILE); followupOn(true)
      const a = await persona('P01'); const b = await persona('P02'); await persona('P03')
      const pid = await post(a, 200); await autoFirst(b, pid, 180)
      const key = F.followupKeyOf(pid, 2)
      // 글/ordinal 이 같은 followup dedupKey 를 미리 priorStatus 로 넣는다
      await prisma.personaApprovalQueue.create({
        data: {
          personaId: b.id, targetPostId: pid, status: priorStatus,
          candidateText: '그 시간에 깨면 괜히 생각이 많아지죠.',
          reactionType: 'experience', gateStatus: 'pass', gateResults: [],
          dedupKey: key, decidedBy: FOLLOWUP_LANE_DECIDED_BY, decidedAt: new Date(Date.now() - 170 * MIN),
          ...(priorStatus === 'EXPIRED' ? { declineReason: FOLLOWUP_EXPIRE_REASON } : {}),
        },
      })
      const qBefore = await prisma.personaApprovalQueue.count()
      const cBefore = await prisma.comment.count()
      const g = fakeGen()
      const r = await phase(g.gen)
      const qAfter = await prisma.personaApprovalQueue.count()
      const cAfter = await prisma.comment.count()
      check(`🔴 기존 열쇠 ${priorStatus} → provider 0 · Queue write 0 · Comment write 0`,
        g.calls() === 0 && qAfter === qBefore && cAfter === cBefore,
        `calls=${g.calls()} ΔQ=${qAfter - qBefore} ΔC=${cAfter - cBefore} ${r.outcome}`)
      const row = await prisma.personaApprovalQueue.findFirst({ where: { dedupKey: key }, select: { status: true } })
      check(`🔴 기존 ${priorStatus} 행 보존됨`, row?.status === priorStatus)
      followupOn(false)
    }
  }

  await wipe()
}

try {
  await main()
} finally {
  followupOn(false)
  await prisma.$disconnect()
}
console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail — 운영 DB 0 · 네트워크 0\n`)
process.exit(fail === 0 ? 0 : 1)
