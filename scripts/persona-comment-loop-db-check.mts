#!/usr/bin/env tsx
/**
 * 🔴 **무인 댓글 루프 — 격리 Postgres 실행 검사** (2026-09-28 · Track B)
 *
 *   실제 경로 그대로 돈다: `runCommentLoop` → `materializeTargets`(실제 DB source) → 9관문 정본
 *   (`checkCommentCandidate`) → PENDING 적재 → `publishCandidateTx({ autoLane: true })`(Serializable).
 *   가짜는 두 곳뿐이다 — **생성 텍스트**(네트워크 0)와 **② 코퍼스 빈도**(운영 자산 대신 고정 조회).
 *   모델 확정 정본 · artifact · reference manifest 는 **임시 HOME 아래에 실제 모양으로** 만든다 —
 *   provenance 대조가 운영과 같은 함수로 돈다.
 *
 * 🔴 운영 DB 에 붙지 않는다(sentinel · localhost · soran_test). 운영 장부·자산·env 0.
 *
 *   DATABASE_URL=… DIRECT_URL=… SORAN_ISOLATED_DB=yes-throwaway npm run persona:comment-loop-db-check
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
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

// ── 🔴 임시 HOME — 정본 파일·장부·잠금이 전부 이 아래다. 모듈을 읽기 **전에** 바꾼다 ──
const HOME = mkdtempSync(join(tmpdir(), 'soran-comment-loop-db-'))
process.env.HOME = HOME
process.env.SORAN_PERSONA_COMMENT_STAGE = 'bootstrap-auto'

const { PrismaClient } = await import('@prisma/client')
const { buildCanonFromScoring, provenanceOf, readConfirmedSelection, ARTIFACT_ROOT, MODEL_CANON_FILE } =
  await import('../src/lib/persona-comment-provenance')
const { SANITIZER_VERSION } = await import('../src/lib/persona-eval-invalidation')
const { REFERENCE_MANIFEST_FILE } = await import('../src/lib/persona-reference-asset')
const { GATE_CODES } = await import('../src/lib/persona-comment-gate-report')
const { publishCandidateTx } = await import('../src/lib/persona-publish-tx')
const { AUTO_LANE_DECIDED_BY, AUTO_LANE_EXPIRE_REASON, commentLoopLimitsFromEnv } = await import('../src/lib/persona-comment-auto-lane')
const { dedupKeyOf } = await import('../src/lib/persona-comment-queue')
const { makeDbTargetSource } = await import('./lib/persona-comment-source-db')
const { runCommentLoop, sweepAutoLane } = await import('./lib/persona-comment-loop.mjs')
const { SupplyLlmSession } = await import('./lib/supply-llm-call.mjs')
const { judgeCommentCall } = await import('./lib/persona-comment-call.mjs')
const { appendLedgerLine, ledgerPathOf } = await import('./lib/llm-ledger-store.mjs')
const { ledgerDateOf } = await import('../src/lib/llm-ledger')
const { acquireLock, releaseLock } = await import('./lib/collect-lock.mjs')
type CommentGenerate = import('./lib/persona-comment-loop.mjs').CommentGenerate
type TargetSource = import('./lib/persona-comment-targets').TargetSource

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else { fail += 1; console.log(`  ❌ ${label}${detail === '' ? '' : ` — ${detail}`}`) }
}

// ── 🔴 확정 모델 정본을 운영과 같은 모양으로 만든다 (임시 HOME) ──
const RUN_ID = '20260928-120000'
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
  winner: 'gemini-3.7-flash', decidedBy: 'check', decidedAt: '2026-09-28T00:00:00Z', scoredSamples: 9,
})
writeFileSync(MODEL_CANON_FILE, JSON.stringify(CANON))
mkdirSync(join(REFERENCE_MANIFEST_FILE, '..'), { recursive: true })
writeFileSync(REFERENCE_MANIFEST_FILE, JSON.stringify({
  sanitizedCorpusDigest: 'fedcba9876543210', identityLeakCheck: { ran: true, hits: 0, detail: 'ok' },
}))
const canonRead = readConfirmedSelection()
const PROV = provenanceOf(CANON)

const prisma = new PrismaClient()

// ─────────────────────────────────────────────────────────
// fixture
// ─────────────────────────────────────────────────────────
async function wipe(): Promise<void> {
  await prisma.comment.deleteMany({})
  await prisma.personaApprovalQueue.deleteMany({})
  await prisma.personaActivityLog.deleteMany({})
  await prisma.post.deleteMany({})
  await prisma.persona.deleteMany({})
  await prisma.account.deleteMany({})
  await prisma.user.deleteMany({})
  await prisma.personaGlobalSwitch.deleteMany({})
}
let seq = 0
async function persona(code: string, status: 'active' | 'paused' = 'active'): Promise<{ id: string; userId: string; code: string }> {
  seq += 1
  const u = await prisma.user.create({ data: { nickname: `fxu${seq}zz` }, select: { id: true } })
  const p = await prisma.persona.create({
    data: {
      code, userId: u.id, status, ageBand: '50대 초반', region: '경기', lifeStage: '갱년기',
      identity: { menopauseStatus: '중', maritalStatus: '기혼' }, voiceCore: { ending: '요', register: '존댓말', length: '짧게' },
      voiceVariations: {}, dailyCap: 5, weeklyCap: 20,
    },
    select: { id: true },
  })
  return { id: p.id, userId: u.id, code }
}
const TITLE = (n: number) => `요즘 밤마다 잠이 안 와요 ${n}`
const BODY = (n: number) => `새벽 세 시만 되면 눈이 떠져서 다시 잠들기가 어렵네요. 다들 이런 밤 어떻게 보내세요? (${n})`
async function post(author: { id: string; userId: string }, minutesAgo: number): Promise<string> {
  seq += 1
  const p = await prisma.post.create({
    data: {
      boardType: 'FREE', title: TITLE(seq), content: BODY(seq), status: 'PUBLISHED', source: 'SYSTEM',
      authorId: author.userId, personaId: author.id, publishAt: new Date(Date.now() - minutesAgo * 60_000),
    },
    select: { id: true },
  })
  return p.id
}
async function memberComments(postId: string, n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    seq += 1
    const u = await prisma.user.create({ data: { nickname: `mem${seq}qq` }, select: { id: true } })
    await prisma.account.create({ data: { userId: u.id, type: 'oauth', provider: 'kakao', providerAccountId: `k${seq}` } })
    await prisma.comment.create({ data: { postId, authorId: u.id, content: `저도 그래요 ${seq}`, commentOrigin: 'MEMBER' } })
  }
}
/** 🔴 생성 근거·Gate 가 온전한 PENDING 행 — sweep 의 트랜잭션 규칙만 시험할 때 쓴다(planner 우회) */
async function pending(p: { id: string; code: string }, postId: string, role = 'empathy'): Promise<string> {
  const q = await prisma.personaApprovalQueue.create({
    data: {
      personaId: p.id, targetPostId: postId, status: 'PENDING',
      candidateText: '읽으면서 고개가 계속 끄덕여졌어요. 그런 밤은 괜히 마음이 싱숭생숭하죠. 오늘은 푹 주무셨으면 좋겠네요~',
      reactionType: role, gateStatus: 'pass',
      gateResults: GATE_CODES.map((g) => ({ gate: g, outcome: 'pass', detail: 'fx' })),
      dedupKey: dedupKeyOf(postId, p.code, role),
      generatedModel: PROV.model, canonRunId: PROV.canonRunId, canonDigest: PROV.canonDigest,
    },
    select: { id: true },
  })
  return q.id
}

const GOOD = '읽으면서 고개가 계속 끄덕여졌어요. 그런 밤은 괜히 마음이 싱숭생숭하죠. 오늘은 푹 주무셨으면 좋겠네요~'
/** 🔴 네트워크 0 — 정해 둔 텍스트를 돌려주고 부른 횟수를 센다 */
function fakeGenerate(textFor: (postTitle: string) => string | Error = () => GOOD): { gen: CommentGenerate; calls: () => number } {
  let n = 0
  return {
    gen: async ({ input }) => {
      n += 1
      const t = textFor(input.post.title)
      if (t instanceof Error) throw t
      return { ok: true, text: t, errorCode: null }
    },
    calls: () => n,
  }
}
/** 🔴 실제 DB source — ② 코퍼스만 고정 조회(운영 자산 대신) */
function source(): TargetSource {
  const base = makeDbTargetSource({ prisma, windowStart: new Date(Date.now() - 7 * 86_400_000) })
  return { ...base, frequency: async () => ({ corpus: { lookup: () => 7, size: 1000, corpusName: 'comment' }, reason: 'fixture corpus' }) }
}
/**
 * 🔴 **Persona 답글 감시** — 시나리오마다 wipe 하므로 끝에서 한 번 세면 앞 시나리오의 답글을 못 본다.
 *    회차·sweep·직접 발행이 끝날 때마다 센다(부모가 있는 Persona 댓글 = 답글).
 */
let personaRepliesSeen = 0
const auditReplies = async (): Promise<void> => {
  personaRepliesSeen += await prisma.comment.count({ where: { personaId: { not: null }, parentId: { not: null } } })
}
async function loop(gen: CommentGenerate, over: { generation?: { ok: boolean; reason: string } } = {}) {
  const r = await runCommentLoop({
    prisma, now: new Date(), env: process.env, live: true, source: source(), canon: canonRead,
    makeGenerate: () => gen, generation: over.generation ?? { ok: true, reason: '' }, runRequestCap: 6,
  })
  await auditReplies()
  return r
}
async function sweep() {
  const r = await sweepAutoLane(prisma, new Date())
  await auditReplies()
  return r
}
const personaComments = (postId?: string) => prisma.comment.findMany({
  where: { personaId: { not: null }, ...(postId === undefined ? {} : { postId }) },
  select: { id: true, postId: true, personaId: true, parentId: true, createdAt: true, commentOrigin: true },
})

async function main(): Promise<void> {
  console.log('\n══ 무인 댓글 루프 — 격리 DB 실행 검사 (운영 DB 0 · 네트워크 0) ══\n')
  check('🔴 임시 HOME 의 확정 정본이 운영과 같은 함수로 확정된다', canonRead.selection?.status === 'confirmed', canonRead.detail)

  console.log('\n① 새 글 → 60분 안에 Persona 댓글 정확히 1건')
  {
    await wipe()
    const a = await persona('P01'); await persona('P02'); await persona('P03')
    const pid = await post(a, 10)
    const f = fakeGenerate()
    const r = await loop(f.gen)
    const cs = await personaComments(pid)
    const pub = await prisma.post.findUniqueOrThrow({ where: { id: pid }, select: { publishAt: true } })
    const q = await prisma.personaApprovalQueue.findMany({ select: { status: true, decidedBy: true, publishedCommentId: true } })
    const log = await prisma.personaActivityLog.findMany({ select: { decidedBy: true, kind: true } })
    check('🔴 댓글 정확히 1건', cs.length === 1, `${cs.length} · ${JSON.stringify(r.outcomes.map((o) => o.step + ':' + o.reason))} · ${JSON.stringify(r.sweepAfter?.lines)}`)
    check('🔴 공개 60분 안', cs.length === 1 && cs[0]!.createdAt.getTime() - pub.publishAt!.getTime() <= 60 * 60_000)
    check('🔴 글쓴 Persona 가 아니다', cs.length === 1 && cs[0]!.personaId !== a.id)
    check('🔴 Persona 레인 · 최상위 댓글(답글 아님)', cs.length === 1 && cs[0]!.commentOrigin === 'PERSONA' && cs[0]!.parentId === null)
    check('🔴 Queue 1행 PUBLISHED · 기계 결정 표식', q.length === 1 && q[0]!.status === 'PUBLISHED' && q[0]!.decidedBy === AUTO_LANE_DECIDED_BY && q[0]!.publishedCommentId === cs[0]?.id)
    check('🔴 ActivityLog 1행 · decidedBy auto', log.length === 1 && log[0]!.decidedBy === 'auto' && log[0]!.kind === 'comment')
    check('🔴 provider 1회', f.calls() === 1 && r.providerCalls === 1)
    const f2 = fakeGenerate()
    const r2 = await loop(f2.gen)
    check('🔴 다음 회차 — provider 0 · 댓글 그대로 1건', f2.calls() === 0 && r2.providerCalls === 0 && (await personaComments(pid)).length === 1)
  }

  console.log('\n② 60분 넘은 글 → 댓글 0 · provider 0 · 남은 후보는 닫는다')
  {
    await wipe()
    const a = await persona('P01'); const b = await persona('P02')
    const late = await post(a, 61)
    const f = fakeGenerate()
    await loop(f.gen)
    check('🔴 61분 글 — provider 0 · 댓글 0', f.calls() === 0 && (await personaComments(late)).length === 0)
    const qid = await pending(b, late)
    const s = await sweep()
    const row = await prisma.personaApprovalQueue.findUniqueOrThrow({ where: { id: qid }, select: { status: true, declineReason: true, decidedBy: true } })
    check('🔴 트랜잭션이 막는다 — 창 밖 PENDING 은 발행 0 · EXPIRED 로 닫는다',
      s.published === 0 && row.status === 'EXPIRED' && row.declineReason === AUTO_LANE_EXPIRE_REASON && row.decidedBy === AUTO_LANE_DECIDED_BY
      && (await personaComments(late)).length === 0, JSON.stringify(s.lines))
  }

  console.log('\n③ 자기 글에 달지 않는다')
  {
    await wipe()
    const a = await persona('P01'); await persona('P02', 'paused')
    const pid = await post(a, 5)
    const f = fakeGenerate()
    await loop(f.gen)
    check('🔴 붙일 수 있는 Persona 가 글쓴이뿐 → provider 0 · 댓글 0', f.calls() === 0 && (await personaComments(pid)).length === 0)
    const qid = await pending(a, pid)
    const s = await sweep()
    const row = await prisma.personaApprovalQueue.findUniqueOrThrow({ where: { id: qid }, select: { status: true } })
    check('🔴 🔴 **planner 를 우회해도 트랜잭션이 자기 글을 막는다**', s.published === 0 && row.status === 'EXPIRED'
      && (await personaComments(pid)).length === 0, JSON.stringify(s.lines))
  }

  console.log('\n④ 중복 — 글당 1건 · 같은 Persona 두 번 없음')
  {
    await wipe()
    const a = await persona('P01'); const b = await persona('P02'); const c = await persona('P03'); const d = await persona('P04')
    const pid = await post(a, 5)
    await prisma.comment.create({ data: { postId: pid, authorId: b.userId, content: '먼저 단 댓글이에요', commentOrigin: 'PERSONA', personaId: b.id, source: 'SYSTEM' } })
    const f = fakeGenerate()
    await loop(f.gen)
    check('🔴 이미 Persona 댓글 1건인 글 → provider 0 · 추가 0', f.calls() === 0 && (await personaComments(pid)).length === 1)

    await wipe()
    const a2 = await persona('P01'); const c2 = await persona('P03'); const d2 = await persona('P04')
    const pid2 = await post(a2, 5)
    const q1 = await pending(c2, pid2); const q2 = await pending(d2, pid2)
    const s = await sweep()
    const rows = await prisma.personaApprovalQueue.findMany({ where: { id: { in: [q1, q2] } }, select: { status: true } })
    check('🔴 🔴 **같은 글 PENDING 둘 → 1건만 발행 · 나머지는 닫힌다**', (await personaComments(pid2)).length === 1
      && s.published === 1 && rows.filter((x) => x.status === 'PUBLISHED').length === 1 && rows.filter((x) => x.status === 'EXPIRED').length === 1, JSON.stringify(s.lines))
    let dup = false
    try { await pending(c2, pid2) } catch (e) { dup = (e as { code?: string }).code === 'P2002' }
    check('🔴 같은 글·Persona·역할 후보는 unique 로 두 번 들어가지 않는다', dup)
    void c; void d
  }

  console.log('\n⑤ 실사용자 댓글 3건 이상 → 끼어들지 않는다')
  {
    await wipe()
    const a = await persona('P01'); const b = await persona('P02')
    const busy = await post(a, 5)
    await memberComments(busy, 3)
    const two = await post(a, 5)
    await memberComments(two, 2)
    const f = fakeGenerate()
    await loop(f.gen)
    check('🔴 실사용자 3건 글 → Persona 댓글 0', (await personaComments(busy)).length === 0)
    check('🟢 실사용자 2건 글 → Persona 댓글 1', (await personaComments(two)).length === 1)
    const qid = await pending(b, busy, 'question')
    await sweep()
    const row = await prisma.personaApprovalQueue.findUniqueOrThrow({ where: { id: qid }, select: { status: true } })
    check('🔴 🔴 **planner 를 우회해도 트랜잭션이 3건 글을 막는다**', row.status === 'EXPIRED' && (await personaComments(busy)).length === 0)
  }

  console.log('\n⑥ 9관문 실패 · 예외는 그 한 건만 — 다음 글은 계속')
  {
    await wipe()
    const a = await persona('P01'); await persona('P02'); await persona('P03')
    const p1 = await post(a, 5); const p2 = await post(a, 6); const p3 = await post(a, 7)
    const t1 = (await prisma.post.findUniqueOrThrow({ where: { id: p1 }, select: { title: true, content: true } }))
    const t3 = (await prisma.post.findUniqueOrThrow({ where: { id: p3 }, select: { title: true } })).title
    const f = fakeGenerate((title) => title === t1.title ? t1.content : title === t3 ? new Error('network') : GOOD)
    const r = await loop(f.gen)
    const steps = r.outcomes.map((o) => o.step)
    check('🔴 원문 복제 글 → 9관문에서 막혀 적재·발행 0', (await personaComments(p1)).length === 0
      && (await prisma.personaApprovalQueue.count({ where: { targetPostId: p1 } })) === 0, JSON.stringify(steps))
    check('🔴 provider 예외 글 → 그 글만 실패', (await personaComments(p3)).length === 0 && steps.includes('PROVIDER_FAILED'))
    check('🟢 나머지 글은 계속 — 정확히 1건', (await personaComments(p2)).length === 1, JSON.stringify(r.outcomes.map((o) => `${o.step}:${o.reason}`)))
    check('🔴 세 글 모두 시도했다(한 건 실패로 회차가 끝나지 않았다)', f.calls() === 3)
  }

  console.log('\n⑦ 비용 상한 — 요청 전에 막는다')
  {
    await wipe()
    const a = await persona('P01'); await persona('P02')
    const pid = await post(a, 5)
    const f = fakeGenerate()
    const r = await loop(f.gen, { generation: { ok: false, reason: '예산 env 를 읽지 못했다' } })
    check('🔴 예산 보류 → provider 0 · 댓글 0', f.calls() === 0 && r.providerCalls === 0 && (await personaComments(pid)).length === 0)

    // 🔴 실제 장부 세션 — 오늘 $0.199 썼다. 생성 fetch 는 한 번도 나가지 않아야 한다
    const dir = join(HOME, 'ledger-cap')
    mkdirSync(dir, { recursive: true })
    const day = new Date()
    appendLedgerLine(ledgerPathOf(dir, ledgerDateOf(day)), {
      runId: 'earlier', stage: 'commentGen', attemptId: 'seed', requestNo: 0, provider: 'google', apiModelId: 'gemini-3.7-flash',
      model: 'gemini-3.7-flash', status: 'settled', blockCode: null, countedInputTokens: 1805, maxOutputTokens: 800,
      reservedUsd: 0.199, inputTokens: 1805, outputTokens: 231, cacheWriteTokens: 0, cacheReadTokens: 0, usageKeys: [],
      settledUsd: 0.199, pricingVersion: 'x', startedAt: day.toISOString(), endedAt: day.toISOString(), errorCode: null,
    })
    const session = new SupplyLlmSession({ runId: 'db-cap', dir, limits: commentLoopLimitsFromEnv({}).limits })
    let genFetch = 0
    const realFetch = globalThis.fetch
    process.env.GEMINI_API_KEY = 'fixture-fake-key'
    globalThis.fetch = (async (url: string | URL | Request) => {
      if (String(url).includes(':countTokens')) return new Response(JSON.stringify({ totalTokens: 1805 }), { status: 200 })
      genFetch += 1
      return new Response('{}', { status: 500 })
    }) as typeof globalThis.fetch
    try {
      const ledgerGen: CommentGenerate = async ({ model }) => judgeCommentCall(await session.call({
        stage: 'commentGen', model: model as 'gemini-3.7-flash', systemPrompt: 's', userPayload: 'u', maxOutputTokens: 800, timeoutMs: 5_000,
      }))
      const r2 = await loop(ledgerGen)
      check('🔴 🔴 **하루 $0.20 에 닿으면 생성 요청 0 · 댓글 0 · 장부가 막은 사유가 남는다**',
        genFetch === 0 && (await personaComments(pid)).length === 0
        && r2.outcomes.some((o) => o.step === 'PROVIDER_FAILED' && o.reason.includes('DAILY_EXHAUSTED')),
        JSON.stringify(r2.outcomes.map((o) => o.reason)))
    } finally { globalThis.fetch = realFetch }
  }

  console.log('\n⑧ 동시 실행 — 두 회차가 같은 글에 두 번 달지 않는다')
  {
    await wipe()
    const a = await persona('P01'); await persona('P02'); await persona('P03')
    const pid = await post(a, 5)
    const [r1, r2] = await Promise.all([loop(fakeGenerate().gen), loop(fakeGenerate().gen)])
    const afterRace = (await personaComments(pid)).length
    check('🔴 🔴 **루프 두 개 동시 → 중복 0 (댓글 1건 이하)**', afterRace <= 1,
      `${afterRace} · ${JSON.stringify(r1.sweepAfter?.lines)} / ${JSON.stringify(r2.sweepAfter?.lines)}`)
    // 🔴 경쟁에서 진 쪽은 오류로 남고(PENDING) 다음 회차가 다시 본다 — 그 뒤에는 정확히 1건이다
    await sweep()
    check('🔴 다음 회차 뒤 정확히 1건 — 진 쪽이 두 번째 댓글이 되지 않는다', (await personaComments(pid)).length === 1)

    await wipe()
    const a2 = await persona('P01'); const b2 = await persona('P02'); const c2 = await persona('P03')
    const pid2 = await post(a2, 5)
    const [x, y] = [await pending(b2, pid2), await pending(c2, pid2)]
    const now = new Date()
    const res = await Promise.all([
      publishCandidateTx(prisma, { id: x, now, autoLane: true }),
      publishCandidateTx(prisma, { id: y, now, autoLane: true }),
    ])
    await auditReplies()
    check('🔴 🔴 **다른 Persona 후보 둘을 동시에 발행 → Serializable 이 1건만 남긴다**',
      (await personaComments(pid2)).length === 1 && res.filter((z) => z.kind === 'published').length === 1, JSON.stringify(res.map((z) => z.kind)))
    const lockPath = join(HOME, 'lock-probe.lock')
    const l1 = acquireLock(lockPath, Date.now(), 60_000)
    const l2 = acquireLock(lockPath, Date.now(), 60_000)
    check('🔴 같은 기계의 두 번째 회차는 잠금에서 물러난다', l1.ok && !l2.ok && l2.kind === 'HELD')
    if (l1.ok) releaseLock(l1.handle)
  }

  console.log('\n⑨ 단계가 bootstrap-auto 가 아니면 — provider 0 · write 0 · 트랜잭션도 막는다')
  {
    await wipe()
    const a = await persona('P01'); const b = await persona('P02')
    const pid = await post(a, 5)
    const qid = await pending(b, pid)
    process.env.SORAN_PERSONA_COMMENT_STAGE = 'bootstrap-review'
    const f = fakeGenerate()
    const r = await loop(f.gen)
    const direct = await publishCandidateTx(prisma, { id: qid, now: new Date(), autoLane: true })
    const row = await prisma.personaApprovalQueue.findUniqueOrThrow({ where: { id: qid }, select: { status: true } })
    check('🔴 bootstrap-review → NOT_AUTO_STAGE · provider 0 · 후보 그대로 PENDING',
      r.outcome === 'NOT_AUTO_STAGE' && f.calls() === 0 && row.status === 'PENDING')
    check('🔴 트랜잭션을 직접 불러도 무인 레인은 막힌다', direct.kind === 'blocked' && (await personaComments(pid)).length === 0)
    process.env.SORAN_PERSONA_COMMENT_STAGE = 'bootstrap-auto'
  }

  await auditReplies()
  check('🔴 🔴 **전 시나리오에서 Persona 답글(부모가 있는 Persona 댓글) 0** — Persona 끼리 답글 사슬이 생길 자리가 없다',
    personaRepliesSeen === 0, `${personaRepliesSeen}`)
  await wipe()
}

try {
  await main()
} finally {
  await prisma.$disconnect()
}
console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail — 운영 DB 0 · 네트워크 0\n`)
process.exit(fail === 0 ? 0 : 1)
